// RFID display hotfix: only clear stale reader/access state when ESP32 is offline.
// The registered RFID owner list is managed by app.js so two scripts do not
// compete to overwrite the same UI.

const HOTFIX_STALE_MS = 15000;
let hotfixStation = {};

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

  if (scanResult) {
    scanResult.className = "scan-result";
    scanResult.textContent = "WAITING FOR HARDWARE SCAN";
  }
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

  startStationWatch();
  setInterval(clearStaleRfidUi, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootRfidHotfix().catch(error => console.error("RFID hotfix failed", error));
  }, { once: true });
} else {
  bootRfidHotfix().catch(error => console.error("RFID hotfix failed", error));
}
