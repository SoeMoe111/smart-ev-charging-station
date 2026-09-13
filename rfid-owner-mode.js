// RFID owner-only mode for the university EV charging prototype.
// A card is bound to a person, not to a vehicle. Vehicle plate belongs to bookings only.

const PROJECT_CARD_OWNERS = Object.freeze({
  "7A BB E4 06": "Soe Moe",
  "BD B0 50 07": "Myint Zu Khin",
  "8D C9 0D 07": "Kyaw Zayar Min"
});

const TELEMETRY_STALE_MS = 15000;
let lastStationSnapshot = {};

function normalizeUid(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .match(/.{1,2}/g)
    ?.join(" ") || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDetectedUid() {
  const text = document.getElementById("enrollDetectedUid")?.textContent || "";
  return normalizeUid(text);
}

function getPresetOwner(uid) {
  return PROJECT_CARD_OWNERS[normalizeUid(uid)] || "";
}

function setScanMessage(html, mode = "") {
  const result = document.getElementById("scanResult");
  if (!result) return;
  result.className = mode ? `scan-result ${mode}` : "scan-result";
  result.innerHTML = html;
}

function slotTimestampIsFresh(slot = {}) {
  const updatedAt = Number(slot.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;

  const age = Date.now() - updatedAt;
  return age >= 0 && age <= TELEMETRY_STALE_MS;
}

function stationIsFresh(station = lastStationSnapshot) {
  const slot1 = station?.slots?.slot1 || {};
  const slot2 = station?.slots?.slot2 || {};
  return slotTimestampIsFresh(slot1) || slotTimestampIsFresh(slot2);
}

function syncReaderAvailability() {
  const online = stationIsFresh();
  const readerStatus = document.getElementById("readerStatus");
  const latestScanUid = document.getElementById("latestScanUid");
  const latestScanTime = document.getElementById("latestScanTime");
  const enrollDetectedUid = document.getElementById("enrollDetectedUid");
  const enrollDetectedHint = document.getElementById("enrollDetectedHint");
  const enrollButton = document.getElementById("enrollCardBtn");

  if (!online) {
    if (readerStatus) readerStatus.textContent = "READER OFFLINE";
    if (latestScanUid) latestScanUid.textContent = "No live card data";
    if (latestScanTime) latestScanTime.textContent = "ESP32 telemetry offline";
    if (enrollDetectedUid) enrollDetectedUid.textContent = "WAITING FOR CARD";
    if (enrollDetectedHint) {
      enrollDetectedHint.textContent =
        "Power the ESP32 and wait for live telemetry before tapping a card.";
    }
    if (enrollButton) enrollButton.disabled = true;

    const result = document.getElementById("scanResult");
    if (result && !result.classList.contains("granted")) {
      result.className = "scan-result";
      result.textContent = "WAITING FOR HARDWARE SCAN";
    }
    return false;
  }

  if (readerStatus && readerStatus.textContent.trim() === "READER OFFLINE") {
    readerStatus.textContent = "READER ONLINE · WAITING";
  }

  return true;
}

function applyOwnerOnlyUi() {
  const plateInput = document.getElementById("rfPlate");
  plateInput?.closest("label")?.remove();

  const emailInput = document.getElementById("rfEmail");
  emailInput?.closest("label")?.remove();

  const steps = document.querySelectorAll("#rfid .step-card");
  if (steps[0]) {
    const title = steps[0].querySelector("b");
    const body = steps[0].querySelector("p");
    if (title) title.textContent = "Assign card owner";
    if (body) {
      body.textContent =
        "Admin assigns only the card owner's name. No vehicle plate is stored with the RFID card.";
    }
  }

  if (steps[2]) {
    const body = steps[2].querySelector("p");
    if (body) {
      body.textContent =
        "The card identifies the person. The vehicle plate is taken from that person's active booking.";
    }
  }

  const formTitle = document.querySelector("#rfidForm .panel-head h3");
  if (formTitle) formTitle.textContent = "Bind a detected card to its owner";

  const registeredTitle = [...document.querySelectorAll("#rfid .panel-head h3")]
    .find(node => node.textContent.trim() === "Shared RFID user list");
  if (registeredTitle) registeredTitle.textContent = "Registered card owners";

  const bookingNote = document.querySelector("#booking .booking-info .note-box");
  if (bookingNote) {
    bookingNote.textContent =
      "Driver Name must match the registered RFID card owner. Vehicle Plate belongs to the booking only and is not stored on the card.";
  }

  const style = document.createElement("style");
  style.textContent = `
    #rfidUsersList .user-row > span:first-of-type { display: none !important; }
    #rfidUsersList .user-row { grid-template-columns: minmax(150px, 1.4fr) minmax(130px, 1fr) auto !important; }
    #registerProjectCardsBtn { margin-top: 10px; }
  `;
  document.head.appendChild(style);

  const enrollButton = document.getElementById("enrollCardBtn");
  if (enrollButton && !document.getElementById("registerProjectCardsBtn")) {
    const button = document.createElement("button");
    button.id = "registerProjectCardsBtn";
    button.type = "button";
    button.className = "secondary-btn wide";
    button.textContent = "RESTORE 3 PROJECT CARDS";
    enrollButton.insertAdjacentElement("afterend", button);
  }
}

function watchDetectedCard() {
  const uidNode = document.getElementById("enrollDetectedUid");
  if (!uidNode) return;

  const syncOwner = () => {
    if (!stationIsFresh()) return;

    const uid = getDetectedUid();
    const owner = getPresetOwner(uid);
    const nameInput = document.getElementById("rfName");

    if (uid && owner && nameInput) {
      nameInput.value = owner;
    }

    if (uid && owner) {
      const latestResult = document.getElementById("scanResult");
      const text = latestResult?.textContent || "";

      if (
        text.includes("WAITING FOR STATION DECISION") ||
        text.includes("WAITING FOR HARDWARE SCAN") ||
        text.includes("CARD DETECTED")
      ) {
        setScanMessage(
          `CARD DETECTED<br>${escapeHtml(owner)}<br>${escapeHtml(uid)}<br>WAITING FOR STATION DECISION`
        );
      }
    }
  };

  new MutationObserver(syncOwner).observe(uidNode, {
    childList: true,
    subtree: true,
    characterData: true
  });

  syncOwner();
}

async function installOwnerOnlyBehavior() {
  const service = await import("./firebase-service.js");

  document.addEventListener("submit", async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "rfidForm") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!stationIsFresh()) {
      syncReaderAvailability();
      return;
    }

    const uid = getDetectedUid();
    const nameInput = document.getElementById("rfName");
    const name = String(nameInput?.value || "").trim();

    if (!uid) {
      setScanMessage("TAP A CARD ON THE PHYSICAL READER FIRST", "denied");
      return;
    }

    if (!name) {
      setScanMessage("ENTER CARD OWNER NAME", "denied");
      nameInput?.focus();
      return;
    }

    try {
      await service.saveRfidUser({ name, uid });
      form.reset();
      setScanMessage(
        `CARD OWNER REGISTERED<br>${escapeHtml(name)}<br>${escapeHtml(uid)}`,
        "granted"
      );
    } catch (error) {
      console.error("Owner-only RFID enrollment failed", error);
      setScanMessage("FIREBASE SAVE FAILED · ADMIN LOGIN REQUIRED", "denied");
    }
  }, true);

  document.getElementById("registerProjectCardsBtn")?.addEventListener("click", async () => {
    const button = document.getElementById("registerProjectCardsBtn");
    if (!button) return;

    button.disabled = true;
    button.textContent = "RESTORING...";

    try {
      for (const [uid, name] of Object.entries(PROJECT_CARD_OWNERS)) {
        await service.saveRfidUser({ name, uid });
      }

      setScanMessage(
        "3 PROJECT CARD OWNERS RESTORED<br>Soe Moe · Myint Zu Khin · Kyaw Zayar Min",
        "granted"
      );
      button.textContent = "3 PROJECT CARDS RESTORED";
    } catch (error) {
      console.error("Project card restore failed", error);
      setScanMessage("CARD RESTORE FAILED · ADMIN LOGIN REQUIRED", "denied");
      button.disabled = false;
      button.textContent = "RESTORE 3 PROJECT CARDS";
    }
  });

  const startStationMonitor = () => {
    try {
      service.subscribeStation(station => {
        lastStationSnapshot = station || {};

        if (!syncReaderAvailability()) {
          return;
        }

        const latest = station?.rfid?.latestScan || {};
        const uid = normalizeUid(latest.uid);

        const readerStatus = document.getElementById("readerStatus");
        if (readerStatus) {
          readerStatus.textContent = uid
            ? "CARD DETECTED"
            : "READER ONLINE · WAITING";
        }

        if (!uid) return;

        const owner = String(latest.userName || getPresetOwner(uid) || "").trim();
        const plate = String(latest.plate || "").trim();
        const slot = String(latest.slot || "").trim();
        const reason = String(latest.reason || "NOT AUTHORIZED").trim();

        if (latest.granted === true) {
          setScanMessage(
            `ACCESS GRANTED<br>${escapeHtml(owner || "Registered user")}` +
            `${plate && plate !== "N/A" ? `<br>BOOKED VEHICLE: ${escapeHtml(plate)}` : ""}` +
            `${slot ? `<br>${escapeHtml(slot)}` : ""}`,
            "granted"
          );
          return;
        }

        if (latest.granted === false) {
          setScanMessage(
            `ACCESS DENIED` +
            `${owner ? `<br>CARD OWNER: ${escapeHtml(owner)}` : ""}` +
            `<br>${escapeHtml(reason)}`,
            "denied"
          );
          return;
        }

        if (owner) {
          setScanMessage(
            `CARD DETECTED<br>${escapeHtml(owner)}<br>${escapeHtml(uid)}<br>WAITING FOR STATION DECISION`
          );
        }
      }, error => {
        console.error("Owner-mode station monitor failed", error);
      });
    } catch (error) {
      setTimeout(startStationMonitor, 1000);
    }
  };

  startStationMonitor();
}

function bootOwnerMode() {
  applyOwnerOnlyUi();
  watchDetectedCard();
  installOwnerOnlyBehavior().catch(error => {
    console.error("RFID owner-only mode failed to start", error);
  });

  syncReaderAvailability();
  setInterval(syncReaderAvailability, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootOwnerMode, { once: true });
} else {
  bootOwnerMode();
}
