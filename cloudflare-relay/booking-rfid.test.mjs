import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function readProjectFile(name) {
  return readFile(new URL(name, projectRoot), "utf8");
}

test("booking form selects a registered RFID card and locks the owner field", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /<select id="bookingCard" required>/);
  assert.match(html, /<input id="driver"[^>]*readonly[^>]*required>/);
  assert.match(html, /Its UID must match the confirmed booking/);
});

test("booking payload stores the selected card UID and verified owner", async () => {
  const app = await readProjectFile("app.js");

  assert.match(app, /driver:\s*selectedCard\.name/);
  assert.match(app, /uid:\s*selectedUid/);
  assert.match(app, /renderBookingCardOptions\(uid\)/);
  assert.match(app, /Dr\. Than Than Swe/);
  assert.match(app, /42 8D 50 07/);
});

test("legacy RFID owner helper preserves all four project cards", async () => {
  const helper = await readProjectFile("rfid-owner-mode.js");

  assert.match(helper, /"42 8D 50 07": "Dr\. Than Than Swe"/);
  assert.match(helper, /RESTORE 4 PROJECT CARDS/);
  assert.doesNotMatch(helper, /Driver Name must match/);
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
