import assert from "node:assert/strict";
import test from "node:test";
import { chargingEstimate } from "../charging-estimate.js";

const now = 1791384000000;
const slot = {
  updatedAt: now, state: "charging", relay: true, protection: "NORMAL",
  voltage: 7.26, current: 0, power: 0, soc: 53
};

test("7.26 V charging estimate stays at 1.5 A and 10.89 W across raw-current glitches", () => {
  for (const measuredCurrent of [0, 0.1, 0, 0.09, 0.2, 0]) {
    const raw = Object.freeze({ ...slot, current: measuredCurrent });
    const estimate = chargingEstimate(raw, now);
    assert.equal(estimate.current, 1.5);
    assert.equal(estimate.power, 10.89);
    assert.equal(estimate.voltage, 7.26);
    assert.equal(raw.current, measuredCurrent);
  }
});

test("READY, relay-off, E-stop and other protections produce zero estimated A/W", () => {
  for (const change of [
    { state: "ready", relay: false }, { state: "charging", relay: false },
    { state: "fault", relay: false, protection: "E-STOP" },
    { state: "charging", relay: true, protection: "E-STOP" },
    { protection: "OVERCURRENT" }, { protection: "OVER-TEMP" },
    { state: "hold" }, { state: "denied" }
  ]) {
    const estimate = chargingEstimate({ ...slot, ...change }, now);
    assert.equal(estimate.current, 0);
    assert.equal(estimate.power, 0);
    assert.equal(estimate.charging, false);
  }
});

test("missing, future and stale telemetry never generates charging estimates", () => {
  for (const updatedAt of [undefined, 0, NaN, now + 1, now - 15001]) {
    const estimate = chargingEstimate({ ...slot, updatedAt }, now);
    assert.equal(estimate.fresh, false);
    assert.equal(estimate.current, 0);
    assert.equal(estimate.power, 0);
  }
});

test("invalid voltage never creates power; the assumed profile tapers at full voltage", () => {
  for (const voltage of [undefined, NaN, -1, 0, Infinity, 8.4, 8.5]) {
    const estimate = chargingEstimate({ ...slot, voltage }, now);
    assert.equal(estimate.power, 0);
    assert.equal(estimate.current, 0);
  }
  const taper = chargingEstimate({ ...slot, voltage: 8.35 }, now);
  assert.ok(Math.abs(taper.current - 0.75) < 1e-10);
  assert.equal(taper.power, taper.voltage * taper.current);
  assert.ok(Math.abs(chargingEstimate({ ...slot, voltage: 5.5 }, now).current - 0.3) < 1e-10);
});
