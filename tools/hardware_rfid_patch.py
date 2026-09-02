from pathlib import Path

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Could not find block: {label}")
    return text.replace(old, new, 1)

# ---------- index.html ----------
p = Path("index.html")
s = p.read_text(encoding="utf-8")

s = replace_once(
    s,
    '''    <p>
      Reserve a charging slot and automatically check for overlapping reservations.
    </p>''',
    '''    <p>
      Reserve a charging slot online. RFID identity is verified automatically when the driver arrives at the station.
    </p>''',
    "booking description",
)

s = replace_once(
    s,
    '''          <label>
            RFID UID
            <input id="uid" placeholder="Optional RFID UID">
          </label>

''',
    "",
    "public booking RFID field",
)

s = replace_once(
    s,
    '''        <ol>
          <li>Select your preferred slot and start time.</li>
          <li>The website checks the shared Firebase reservation calendar.</li>
          <li>Overlapping bookings are rejected automatically.</li>
        </ol>

        <div class="note-box">
          Firebase synchronizes bookings across phones, laptops and the future ESP32 station bridge.
        </div>''',
    '''        <ol>
          <li>Enter driver and vehicle details, then select a slot and time.</li>
          <li>The website checks the shared Firebase calendar and rejects overlaps.</li>
          <li>At the station, the driver taps the enrolled RFID card for automatic verification.</li>
        </ol>

        <div class="note-box">
          Drivers do not need to know or type their RFID UID when booking.
        </div>''',
    "booking instructions",
)

s = replace_once(
    s,
    '''    <p class="eyebrow">USER ACCESS PROTOTYPE</p>
    <h1>RFID access control</h1>

    <p>
      Register users, simulate card scans and demonstrate authorization before hardware-to-cloud integration.
    </p>''',
    '''    <p class="eyebrow">ADMIN · CARD ENROLLMENT & ACCESS MONITOR</p>
    <h1>RFID station access</h1>

    <p>
      The physical RC522 reader sends card scans through ESP32 to Firebase. Admins enroll cards and monitor access without typing UIDs manually.
    </p>''',
    "rfid hero",
)

s = replace_once(
    s,
    '''      <div class="step-card">
        <span>1</span>
        <b>Register user</b>
        <p>Store user details and RFID UID.</p>
      </div>

      <div class="step-card">
        <span>2</span>
        <b>Scan card</b>
        <p>Enter or simulate the RFID UID.</p>
      </div>

      <div class="step-card">
        <span>3</span>
        <b>Authorize charging</b>
        <p>Grant or deny station access.</p>
      </div>''',
    '''      <div class="step-card">
        <span>1</span>
        <b>Enter user details</b>
        <p>Admin enters the driver name and vehicle plate.</p>
      </div>

      <div class="step-card">
        <span>2</span>
        <b>Tap physical card</b>
        <p>RC522 reads the UID and ESP32 sends it to Firebase.</p>
      </div>

      <div class="step-card">
        <span>3</span>
        <b>Enroll & monitor</b>
        <p>Bind the detected card once, then monitor future access automatically.</p>
      </div>''',
    "rfid steps",
)

s = replace_once(
    s,
    '''            <p class="section-kicker">USER REGISTRATION</p>
            <h3>RFID user registration</h3>''',
    '''            <p class="section-kicker">CARD ENROLLMENT</p>
            <h3>Bind a detected card to a user</h3>''',
    "rfid form heading",
)

s = replace_once(
    s,
    '''          <label>
            RFID UID
            <input id="rfUid" placeholder="Example: 7A BB E4 06" required>
          </label>

        </div>

        <button class="primary-btn wide">
          REGISTER RFID USER
        </button>''',
    '''          <div class="note-box">
            <small>LATEST CARD FROM PHYSICAL READER</small><br>
            <strong id="enrollDetectedUid">WAITING FOR CARD</strong><br>
            <span id="enrollDetectedHint">Tap a card on the station RC522 reader.</span>
          </div>

        </div>

        <button id="enrollCardBtn" class="primary-btn wide" disabled>
          ENROLL DETECTED CARD
        </button>''',
    "rfid enrollment field",
)

s = replace_once(
    s,
    '''            <p class="section-kicker">SCAN TERMINAL</p>
            <h3>RFID scan terminal</h3>''',
    '''            <p class="section-kicker">LIVE READER MONITOR</p>
            <h3>Latest station card scan</h3>''',
    "scan heading",
)

s = replace_once(
    s,
    '''          <p>
            Enter a registered UID to simulate a card tap.
          </p>

          <input id="scanUid" placeholder="RFID UID">

          <button id="scanBtn" class="primary-btn wide">
            SIMULATE RFID SCAN
          </button>

          <div id="scanResult" class="scan-result">
            WAITING FOR CARD
          </div>''',
    '''          <p>
            No UID entry is required here. The station reader publishes each scan through ESP32 and Firebase.
          </p>

          <div class="note-box">
            <small>READER STATUS</small><br>
            <strong id="readerStatus">WAITING FOR ESP32</strong><br>
            <span id="latestScanUid">No card detected yet</span><br>
            <span id="latestScanTime">Waiting for hardware data</span>
          </div>

          <div id="scanResult" class="scan-result">
            WAITING FOR HARDWARE SCAN
          </div>''',
    "manual scan controls",
)

p.write_text(s, encoding="utf-8")

# ---------- app.js ----------
p = Path("app.js")
s = p.read_text(encoding="utf-8")

s = replace_once(s, "  recordAccessEvent,\n", "", "recordAccessEvent import")
s = replace_once(
    s,
    "let unsubscribeRfidUsers = null;",
    'let unsubscribeRfidUsers = null;\nlet latestDetectedUid = "";\nlet latestDetectedTimestamp = 0;',
    "RFID globals",
)

s = replace_once(
    s,
    '''        uid: normalizeUid(
          document.getElementById("uid").value
        ),''',
    '''        // Public users do not type RFID UIDs. Identity is resolved at the station.
        uid: "",''',
    "booking UID",
)

s = replace_once(
    s,
    '''        uid: normalizeUid(
          document.getElementById("rfUid").value
        )''',
    '''        uid: latestDetectedUid''',
    "enrollment UID",
)

s = replace_once(
    s,
    '''      try {
        if (firebaseMode) {
          await saveRfidUser(user);''',
    '''      if (!latestDetectedUid) {
        if (scanResult) {
          scanResult.className = "scan-result denied";
          scanResult.textContent = "TAP A CARD ON THE PHYSICAL READER FIRST";
        }
        return;
      }

      try {
        if (firebaseMode) {
          await saveRfidUser(user);''',
    "enrollment card check",
)

s = replace_once(
    s,
    "        rfidForm.reset();",
    '''        rfidForm.reset();
        latestDetectedUid = "";
        latestDetectedTimestamp = 0;
        updateRfidEnrollmentUi();''',
    "reset enrollment",
)

start = s.index("// ---------- RFID + ACTIVE BOOKING ACCESS ----------")
end = s.index("const clearUsers =", start)

hardware = r'''// ---------- HARDWARE RFID SCAN MONITOR ----------

function formatStationScanTime(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "Waiting for hardware timestamp";
  }
  return new Date(numeric).toLocaleString();
}

function scanIsRecent(timestamp) {
  const numeric = Number(timestamp);
  return Number.isFinite(numeric) &&
    numeric > 0 &&
    Math.abs(Date.now() - numeric) <= 120000;
}

function updateRfidEnrollmentUi() {
  const uidText = document.getElementById("enrollDetectedUid");
  const hint = document.getElementById("enrollDetectedHint");
  const button = document.getElementById("enrollCardBtn");
  const recent = Boolean(
    latestDetectedUid && scanIsRecent(latestDetectedTimestamp)
  );

  if (uidText) {
    uidText.textContent = latestDetectedUid || "WAITING FOR CARD";
  }

  if (hint) {
    hint.textContent = recent
      ? "Card detected. Enter user details and enroll within 2 minutes."
      : "Tap a card on the station RC522 reader.";
  }

  if (button) {
    button.disabled = !recent;
  }
}

function applyRfidStationState(rfid = {}) {
  const latest = rfid.latestScan || {};
  const uid = normalizeUid(latest.uid);
  const timestamp = Number(latest.timestamp) || 0;

  setText(
    "readerStatus",
    rfid.online === false
      ? "READER OFFLINE"
      : (uid ? "CARD DETECTED" : "READER ONLINE · WAITING")
  );
  setText("latestScanUid", uid ? `UID: ${uid}` : "No card detected yet");
  setText("latestScanTime", formatStationScanTime(timestamp));

  if (uid) {
    latestDetectedUid = uid;
    latestDetectedTimestamp = timestamp;
  }

  updateRfidEnrollmentUi();

  if (!scanResult || !uid) return;

  if (latest.granted === true) {
    scanResult.className = "scan-result granted";
    scanResult.innerHTML =
      `ACCESS GRANTED<br>${escapeHtml(latest.userName || "Registered user")}` +
      `${latest.plate ? ` · ${escapeHtml(latest.plate)}` : ""}` +
      `${latest.slot ? `<br>${escapeHtml(latest.slot)}` : ""}`;
    return;
  }

  if (latest.granted === false) {
    scanResult.className = "scan-result denied";
    scanResult.innerHTML =
      `ACCESS DENIED<br>${escapeHtml(latest.reason || "NOT AUTHORIZED")}`;
    return;
  }

  scanResult.className = "scan-result";
  scanResult.innerHTML =
    `CARD DETECTED<br>${escapeHtml(uid)}<br>WAITING FOR STATION DECISION`;
}


'''

s = s[:start] + hardware + s[end:]

s = replace_once(
    s,
    '''  applySlotTelemetry(1, slot1);
  applySlotTelemetry(2, slot2);''',
    '''  applySlotTelemetry(1, slot1);
  applySlotTelemetry(2, slot2);
  applyRfidStationState(station.rfid || {});''',
    "RFID station hook",
)

p.write_text(s, encoding="utf-8")
