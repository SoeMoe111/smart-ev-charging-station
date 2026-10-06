import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function readProjectFile(name) {
  return readFile(new URL(name, projectRoot), "utf8");
}

test("booking form accepts a typed RFID UID and locks the owner field", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /id="bookingCard"[\s\S]*placeholder="Example: 42 8D 50 07"/);
  assert.match(html, /<input id="driver"[^>]*readonly[^>]*required>/);
  assert.match(html, /id="bookingSubmitBtn"[^>]*disabled/);
  assert.match(html, /Its UID must match the confirmed booking/);
});

test("booking payload stores the selected card UID and verified owner", async () => {
  const app = await readProjectFile("app.js");

  assert.match(app, /driver:\s*selectedCard\.name/);
  assert.match(app, /uid:\s*selectedUid/);
  assert.match(app, /setBookingCardUid\(uid\)/);
  assert.match(app, /Unregistered RFID card/);
  assert.match(app, /Dr\. Than Than Swe/);
  assert.match(app, /42 8D 50 07/);
});

test("booking policy releases no-shows after 15 minutes and remembers RFID check-in", async () => {
  const app = await readProjectFile("app.js");
  const html = await readProjectFile("index.html");

  assert.match(app, /NO_SHOW_GRACE_MINUTES = 15/);
  assert.match(app, /bookingIsNoShowExpired/);
  assert.match(app, /rememberClaimedBooking\(uid, timestamp, slotName = ""\)/);
  assert.match(app, /\(!slotName \|\| booking\.slot === slotName\)/);
  assert.match(app, /expired\.filter\(canManageBooking\)/);
  assert.match(html, /Arrive within 15 minutes/);
});

test("live INA219 power is integrated into kWh and priced at both published rates", async () => {
  const app = await readProjectFile("app.js");
  const html = await readProjectFile("index.html");

  assert.match(app, /averagePower \* elapsedMs \/ 3600000/);
  assert.match(app, /energyKwh \* rate/);
  assert.match(html, /Private car · K750\/kWh/);
  assert.match(html, /Passenger EV \/ Taxi · K700\/kWh/);
  assert.match(html, /1 electricity unit = 1 kWh/);
});

test("legacy RFID owner helper preserves all four project cards", async () => {
  const helper = await readProjectFile("rfid-owner-mode.js");

  assert.match(helper, /"42 8D 50 07": "Dr\. Than Than Swe"/);
  assert.match(helper, /RESTORE 4 PROJECT CARDS/);
  assert.doesNotMatch(helper, /Driver Name must match/);
  assert.match(helper, /within 15 minutes/);
});

test("database rules require and index RFID UID bookings", async () => {
  const rules = JSON.parse(await readProjectFile("database.rules.json"));
  const bookingRules = rules.rules.bookings;

  assert.ok(bookingRules[".indexOn"].includes("uid"));
  assert.match(
    bookingRules.$bookingId[".validate"],
    /'uid'/
  );
  assert.match(
    bookingRules.$bookingId.uid[".validate"],
    /length > 0/
  );
});
