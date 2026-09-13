// RFID display hotfix: clear stale access results when ESP32 is offline
// and keep the registered owner list synced for an active admin session.

const HOTFIX_STALE_MS = 15000;
let hotfixStation = {};
let ownerListUnsubscribe = null;
let ownerListRetryTimer = null;

function hotfixEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hotfixSlotFresh(slot = {}) {
  const updatedAt = Number(slot.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  const age = Date.now() - updatedAt;
  return age >= 0 && age <= HOTFIX_STALE_MS;
}

function hotfixStationFresh() {
  const slot1 = hotfixStation?.slots?.slot1 || {};
  const slot2 = hotfixStation?.slots?.slot2 || {};
  return hotfixSlotFresh(slot1) || hotfixSlotFresh(slot2);
}

function clearStaleRfidUi() {
  if (hotfixStationFresh()) return;

  const readerStatus = document.getElementById("readerStatus");
  const latestScanUid = document.getElementById("latestScanUid");
  const latestScanTime = document.getElementById("latestScanTime");
  const enrollDetectedUid = document.getElementById("enrollDetectedUid");
  const enrollDetectedHint = document.getElementById("enrollDetectedHint");
  const enrollButton = document.getElementById("enrollCardBtn");
  const scanResult = document.getElementById("scanResult");

  if (readerStatus) readerStatus.textContent = "READER OFFLINE";
  if (latestScanUid) latestScanUid.textContent = "No live card data";
  if (latestScanTime) latestScanTime.textContent = "ESP32 telemetry offline";
  if (enrollDetectedUid) enrollDetectedUid.textContent = "WAITING FOR CARD";
  if (enrollDetectedHint) {
    enrollDetectedHint.textContent =
      "Power the ESP32 and wait for live telemetry before tapping a card.";
  }
  if (enrollButton) enrollButton.disabled = true;

  // Important: never leave a previous ACCESS GRANTED result visible while offline.
  if (scanResult) {
    scanResult.className = "scan-result";
    scanResult.textContent = "WAITING FOR HARDWARE SCAN";
  }
}

function renderOwnerList(users, service) {
  const list = document.getElementById("rfidUsersList");
  if (!list) return;

  if (!Array.isArray(users) || users.length === 0) {
    list.innerHTML = '<div class="empty-state">No RFID users registered yet.</div>';
    return;
  }

  list.innerHTML = users.map(user => `
    <div class="user-row">
      <b>${hotfixEscapeHtml(user.name || "Unnamed user")}</b>
      <span>${hotfixEscapeHtml(user.plate || "N/A")}</span>
      <span>${hotfixEscapeHtml(user.uid || "")}</span>
      <button class="ghost-btn hotfix-remove-user" data-user-id="${hotfixEscapeHtml(user.id || "")}">
        REMOVE
      </button>
    </div>
  `).join("");

  list.querySelectorAll(".hotfix-remove-user").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.userId || "";
      if (!id) return;
      if (!confirm("Remove this RFID user?")) return;

      try {
        button.disabled = true;
        await service.deleteRfidUser(id);
      } catch (error) {
        console.error("RFID user remove failed", error);
        alert("RFID user could not be removed.");
        button.disabled = false;
      }
    });
  });
}

function showOwnerListSyncError(message) {
  const list = document.getElementById("rfidUsersList");
  if (!list) return;
  list.innerHTML = `
    <div class="empty-state">
      RFID LIST SYNC ERROR<br>
      <small>${hotfixEscapeHtml(message || "Check Firebase Database Rules and admin login.")}</small>
    </div>
  `;
}

async function bootRfidHotfix() {
  const service = await import("./firebase-service.js");

  const startStationWatch = () => {
    try {
      service.subscribeStation(
        station => {
          hotfixStation = station || {};
          clearStaleRfidUi();
        },
        error => {
          console.error("RFID hotfix station watch failed", error);
          setTimeout(startStationWatch, 1500);
        }
      );
    } catch (error) {
      setTimeout(startStationWatch, 1500);
    }
  };

  const startOwnerListWatch = () => {
    if (ownerListUnsubscribe) return;

    const adminButton = document.getElementById("adminAccessBtn");
    const adminActive = adminButton?.dataset.admin === "true";

    if (!adminActive) {
      ownerListRetryTimer = setTimeout(startOwnerListWatch, 1000);
      return;
    }

    try {
      ownerListUnsubscribe = service.subscribeRfidUsers(
        users => renderOwnerList(users, service),
        error => {
          console.error("RFID hotfix owner list sync failed", error);
          ownerListUnsubscribe = null;
          showOwnerListSyncError(error?.message);
          ownerListRetryTimer = setTimeout(startOwnerListWatch, 2000);
        }
      );
    } catch (error) {
      ownerListUnsubscribe = null;
      ownerListRetryTimer = setTimeout(startOwnerListWatch, 1000);
    }
  };

  startStationWatch();
  startOwnerListWatch();

  setInterval(() => {
    clearStaleRfidUi();

    const adminButton = document.getElementById("adminAccessBtn");
    const adminActive = adminButton?.dataset.admin === "true";

    if (!adminActive && ownerListUnsubscribe) {
      ownerListUnsubscribe();
      ownerListUnsubscribe = null;
    }

    if (adminActive && !ownerListUnsubscribe && !ownerListRetryTimer) {
      startOwnerListWatch();
    }

    if (ownerListRetryTimer) {
      clearTimeout(ownerListRetryTimer);
      ownerListRetryTimer = null;
      startOwnerListWatch();
    }
  }, 1500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootRfidHotfix().catch(error => console.error("RFID hotfix failed", error));
  }, { once: true });
} else {
  bootRfidHotfix().catch(error => console.error("RFID hotfix failed", error));
}
