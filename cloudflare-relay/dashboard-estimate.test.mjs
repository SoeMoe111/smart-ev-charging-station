import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../charging-estimate.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

async function dashboard() {
  let clock = 1791384000000;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const elements = new Map();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
    const listeners = new Map();
    const classes = new Set();
    elements.set(id, {
      id, value: "", textContent: "", innerHTML: "", dataset: {}, open: false,
      listeners, style: { setProperty() {} },
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        toggle(value, on) { if (on) classes.add(value); else classes.delete(value); },
        contains: value => classes.has(value)
      },
      addEventListener(name, fn) { listeners.set(name, fn); },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      showModal() { this.open = true; }, close() { this.open = false; },
      reset() {
        if (id === "bookingForm") {
          for (const field of ["bookingCard", "driver", "plate", "date", "time"]) {
            elements.get(field).value = "";
          }
        }
      }
    });
  }
  elements.get("billingRate").value = "750";
  elements.get("billingRate").selectedOptions = [{ textContent: "Private car · K750/kWh" }];
  elements.get("slot").value = "Slot 1";
  elements.get("duration").value = "30";

  const storage = new Map([["evDigitalTwinMeterV3", JSON.stringify({ energyWh: 99 })]]);
  const intervals = [];
  const savedBookings = [];
  let stationListener;
  let writes = 0;
  const context = {
    Date: ClockDate, Intl, Math, Number, String, Map, Set, JSON, console,
    document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [] },
    window: { scrollTo() {}, open() {}, print() {} },
    history: { replaceState() {} }, location: { hash: "#dashboard" },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    setInterval: (fn, ms) => intervals.push({ fn, ms }), setTimeout() {},
    alert: message => { throw new Error(message); }, confirm: () => false,
    connectFirebase: async () => ({ connected: true, isAdmin: true, uid: "test-admin" }),
    subscribeAuthState() {}, subscribeBookings(fn) { fn([]); },
    subscribeRfidUsers(fn) { fn([]); return () => {}; },
    subscribeStation(fn) { stationListener = fn; },
    createBooking: async value => { ++writes; savedBookings.push(value); },
    signInAdmin() {}, signOutAdmin() {}, deleteBooking() {}, deleteAllBookings() {},
    saveRfidUser() {}, deleteRfidUser() {}, deleteAllRfidUsers() {},
    normalizeUid: value => String(value || "").toUpperCase().replace(/[^0-9A-F]/g, "")
      .match(/.{1,2}/g)?.join(" ") || ""
  };
  vm.createContext(context);
  const runnable = helperSource.replace(/^export /gm, "") + "\n" +
    appSource.replace(/^import[\s\S]*?from "[^"\n]+";\s*/gm, "")
      .replace(/^startDataSync\(\);$/m, "globalThis.startupPromise = startDataSync();");
  vm.runInContext(runnable, context);
  await context.startupPromise;
  assert.equal(typeof stationListener, "function");

  const sample = (changes = {}, rfid = {}) => ({
    slots: { slot1: {
      updatedAt: clock, voltage: 7.26, current: 0, power: 0, soc: 53,
      state: "charging", relay: true, protection: "NORMAL", temperature: 33,
      supplyVoltage: 12, uid: "BD B0 50 07", ...changes
    } }, rfid
  });
  return {
    context, elements, storage, intervals, savedBookings,
    advance: ms => { clock += ms; }, sample,
    publish: value => stationListener(value),
    text: id => elements.get(id).textContent,
    energy: () => Number(elements.get("sessionEnergyKwh").textContent.split(" ")[0]),
    writes: () => writes
  };
}

test("actual dashboard renders steady estimates without changing live voltage, SOC or raw data", async () => {
  const ui = await dashboard();
  for (const rawCurrent of [0, 0.1, 0, 0.15, 0]) {
    const station = ui.sample({ current: rawCurrent, power: rawCurrent * 7.26 });
    ui.publish(station);
    assert.equal(ui.text("slot1Voltage"), "7.26 V");
    assert.equal(ui.text("slot1Soc"), "53%");
    assert.equal(ui.text("slot1Current"), "1.50 A");
    assert.equal(ui.text("slot1Power"), "10.89 W");
    assert.equal(ui.text("stationCurrent"), "1.50 A");
    assert.equal(ui.text("projectedVoltage"), "363.0 V");
    assert.equal(ui.text("projectedCurrent"), "7.50 A");
    assert.equal(ui.text("projectedPower"), "2.723 kW");
    assert.equal(ui.text("meterSourceState"), "MODEL ESTIMATE");
    assert.equal(station.slots.slot1.current, rawCurrent);
    ui.advance(5000);
  }
  assert.equal(ui.writes(), 0);
  assert.equal(JSON.parse(ui.storage.get("evDigitalTwinMeterV3")).energyWh, 99);
});

test("fresh E-stop remains online, zeros all estimated output and stays latched until READY", async () => {
  const ui = await dashboard();
  ui.publish(ui.sample());
  ui.advance(5000);
  ui.publish(ui.sample({ state: "fault", relay: false, voltage: 0, protection: "E-STOP" }));
  assert.equal(ui.text("slot1Status"), "FAULT");
  assert.equal(ui.text("slot1Relay"), "OFF");
  assert.equal(ui.text("stationProtection"), "E-STOP");
  assert.match(ui.elements.get("cloudStatus").innerHTML, /FIREBASE LIVE/);
  for (const id of ["slot1Current", "stationCurrent", "projectedCurrent"]) {
    assert.equal(ui.text(id), "0.00 A");
  }
  assert.equal(ui.text("slot1Power"), "0.00 W");
  assert.equal(ui.text("projectedPower"), "0.000 kW");
  assert.equal(ui.elements.get("chargingReceiptDialog").open, true);
  ui.advance(5000);
  ui.publish(ui.sample({ state: "fault", relay: false, protection: "E-STOP" }));
  assert.equal(ui.text("slot1Status"), "FAULT");
  ui.advance(5000);
  ui.publish(ui.sample({ state: "ready", relay: false }));
  assert.equal(ui.text("slot1Status"), "READY");
  assert.equal(ui.text("slot1Current"), "0.00 A");
  assert.equal(ui.writes(), 0);
});

test("projected units use estimated power once per sample and do not accrue across an offline gap", async () => {
  const ui = await dashboard();
  ui.publish(ui.sample());
  ui.advance(5000);
  const station = ui.sample();
  ui.publish(station);
  assert.ok(Math.abs(ui.energy() - 0.00378125) < 0.0000006);
  const initialEnergy = ui.energy();
  ui.publish(station);
  assert.equal(ui.energy(), initialEnergy);
  ui.advance(16000);
  ui.intervals.find(value => value.ms === 3000).fn();
  assert.equal(ui.text("slot1Status"), "OFFLINE");
  assert.equal(ui.text("projectedCurrent"), "-- A");
  assert.equal(ui.text("sessionMeterStatus"), "DATA PAUSED");
  assert.equal(ui.energy(), initialEnergy);
  ui.advance(30000);
  ui.publish(ui.sample());
  assert.equal(ui.energy(), initialEnergy);
  ui.advance(5000);
  ui.publish(ui.sample());
  assert.ok(Math.abs(ui.energy() - initialEnergy * 2) < 0.000001);
  ui.advance(5000);
  ui.publish(ui.sample({ state: "ready", relay: false, voltage: 0 }));
  assert.equal(ui.text("projectedCurrent"), "0.00 A");
  assert.equal(ui.text("projectedPower"), "0.000 kW");
  assert.equal(ui.text("sessionMeterStatus"), "SESSION COMPLETE");
});

test("manual UID edits survive repeated/new scans and the submitted reservation uses that UID", async () => {
  const ui = await dashboard();
  const scanned = () => ({ latestScan: {
    uid: "BD B0 50 07", userName: "Myint Zu Khin", timestamp: ui.sample().slots.slot1.updatedAt
  } });
  ui.publish(ui.sample({ state: "ready", relay: false }, scanned()));
  const card = ui.elements.get("bookingCard");
  assert.equal(card.value, "BD B0 50 07");
  card.value = "";
  card.listeners.get("input")();
  ui.publish(ui.sample({ state: "ready", relay: false }, scanned()));
  assert.equal(card.value, "");
  card.value = "7ABBE406";
  card.listeners.get("input")();
  ui.advance(5000);
  ui.publish(ui.sample({ state: "ready", relay: false }, scanned()));
  assert.equal(card.value, "7A BB E4 06");
  assert.equal(ui.elements.get("driver").value, "Soe Moe");
  ui.elements.get("plate").value = "TEST-001";
  ui.elements.get("date").value = "2026-10-08";
  ui.elements.get("time").value = "10:00";
  await ui.elements.get("bookingForm").listeners.get("submit")({ preventDefault() {} });
  assert.equal(ui.savedBookings.length, 1);
  assert.equal(ui.savedBookings[0].uid, "7A BB E4 06");
  assert.equal(ui.savedBookings[0].driver, "Soe Moe");
  assert.equal(card.value, "");
  ui.publish(ui.sample({ state: "ready", relay: false }, scanned()));
  assert.equal(card.value, "");
});
