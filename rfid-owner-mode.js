// RFID owner-only mode for the university EV charging prototype.
// A card is bound to a person, not to a vehicle. Vehicle plate belongs to bookings only.

const PROJECT_CARD_OWNERS = Object.freeze({
  "7A BB E4 06": "Soe Moe",
  "BD B0 50 07": "Pwint Phyu Hlaing",
  "8D C9 0D 07": "Kyaw Zayar Min"
});

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
    if (body) body.textContent = "Admin assigns only the card owner's name. No vehicle plate is stored with the RFID card.";
  }

  if (steps[2]) {
    const body = steps[2].querySelector("p");
    if (body) body.textContent = "The card identifies the person. The vehicle plate is taken from that person's active booking.";
  }

  const formTitle = document.querySelector("#rfidForm .panel-head h3");
  if (formTitle) formTitle.textContent = "Bind a detected card to its owner";

  const registeredTitle = [...document.querySelectorAll("#rfid .panel-head h3")]
    .find(node => node.textContent.trim() === "Shared RFID user list");
  if (registeredTitle) registeredTitle.textContent = "Registered card owners";

  const bookingNote = document.querySelector("#booking .booking-info .note-box");
  if (bookingNote) {
    bookingNote.textContent = "Driver Name must match the registered RFID card owner. Vehicle Plate belongs to the booking only and is not stored on the card.";
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
    button.textContent = "REGISTER 3 PROJECT CARDS";
    enrollButton.insertAdjacentElement("afterend", button);
  }
}

function watchDetectedCard() {
  const uidNode = document.getElementById("enrollDetectedUid");
  if (!uidNode) return;

  const syncOwner = () => {
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

    // Override the original enrollment handler so plate/email are never written.
    event.preventDefault();
    event.stopImmediatePropagation();

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
    button.textContent = "REGISTERING...";

    try {
      for (const [uid, name] of Object.entries(PROJECT_CARD_OWNERS)) {
        await service.saveRfidUser({ name, uid });
      }

      setScanMessage(
        "3 PROJECT CARD OWNERS REGISTERED<br>Soe Moe · Pwint Phyu Hlaing · Kyaw Zayar Min",
        "granted"
      );
      button.textContent = "3 PROJECT CARDS REGISTERED";
    } catch (error) {
      console.error("Project card registration failed", error);
      setScanMessage("CARD REGISTRATION FAILED · ADMIN LOGIN REQUIRED", "denied");
      button.disabled = false;
      button.textContent = "REGISTER 3 PROJECT CARDS";
    }
  });

  // Render the owner name on every physical scan, even for denied/no-booking cases.
  const startStationMonitor = () => {
    try {
      service.subscribeStation(station => {
        const latest = station?.rfid?.latestScan || {};
        const uid = normalizeUid(latest.uid);
        if (!uid) return;

        const owner = String(latest.userName || getPresetOwner(uid) || "").trim();
        const plate = String(latest.plate || "").trim();
        const slot = String(latest.slot || "").trim();
        const reason = String(latest.reason || "NOT AUTHORIZED").trim();

        if (latest.granted === true) {
          setScanMessage(
            `ACCESS GRANTED<br>${escapeHtml(owner || "Registered user")}` +
            `${plate ? `<br>BOOKED VEHICLE: ${escapeHtml(plate)}` : ""}` +
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
      // Firebase startup may still be in progress. Retry shortly.
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootOwnerMode, { once: true });
} else {
  bootOwnerMode();
}
