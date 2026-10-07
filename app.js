import {
  connectFirebase,
  subscribeAuthState,
  signInAdmin,
  signOutAdmin,
  subscribeBookings,
  createBooking,
  deleteBooking,
  deleteAllBookings,
  subscribeRfidUsers,
  saveRfidUser,
  deleteRfidUser,
  deleteAllRfidUsers,
  subscribeStation,
  normalizeUid
} from "./firebase-service.js?v=20261007-stability-v17";

import { chargingEstimate } from "./charging-estimate.js?v=20261007-estimated-v18";

// ============================================
// SMART EV CHARGING STATION - FIREBASE APP
// ============================================

let firebaseMode = false;
let currentAuthUid = "";
let adminMode = false;
let unsubscribeRfidUsers = null;
let latestDetectedUid = "";
let latestDetectedTimestamp = 0;
let lastBookingAutoFillScanKey = "";
let bookingUidEditedByUser = false;

// ---------- PAGE NAVIGATION ----------
const navTabs = [...document.querySelectorAll(".nav-tab")];
const pages = [...document.querySelectorAll(".page")];

function showPage(pageId, updateHash = true) {
  if (pageId === "rfid" && !adminMode) {
    pageId = "dashboard";
  }

  pages.forEach(page => {
    page.classList.toggle("active-page", page.id === pageId);
  });

  navTabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.page === pageId);
  });

  if (updateHash) {
    history.replaceState(null, "", "#" + pageId);
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

navTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    showPage(tab.dataset.page);
  });
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.go);
  });
});

// Open requested page from URL hash
const initialPage = location.hash.replace("#", "");

if (pages.some(page => page.id === initialPage)) {
  showPage(initialPage, false);
} else {
  showPage("dashboard", false);
}


// ============================================
// STORAGE HELPERS
// ============================================

function loadData(key, fallback = []) {
  try {
    return JSON.parse(
      localStorage.getItem(key) || JSON.stringify(fallback)
    );
  } catch {
    return fallback;
  }
}

function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setCloudStatus(mode, message) {
  const pill = document.getElementById("cloudStatus");
  const banner = document.getElementById("projectModeText");
  const tag = document.getElementById("projectModeTag");

  if (pill) {
    pill.dataset.mode = mode;
    pill.innerHTML = `<span class="pulse"></span> ${escapeHtml(message)}`;
  }

  if (banner) {
    if (mode === "cloud") {
      banner.textContent =
        "Booking, RFID and fresh station data are synchronized securely through the Firebase relay.";
    } else if (mode === "station-offline") {
      banner.textContent =
        "Cloud relay is connected. Waiting for fresh live data from the ESP32 station.";
    } else {
      banner.textContent =
        "Firebase is unavailable. Local demo storage remains active so the interface is safe to test.";
    }
  }

  if (tag) {
    tag.textContent = mode === "cloud"
      ? "FIREBASE LIVE"
      : mode === "station-offline"
        ? "STATION OFFLINE"
        : "LOCAL FALLBACK";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const DEFAULT_RFID_USERS = [
  {
    id: "7A-BB-E4-06",
    name: "Soe Moe",
    plate: "N/A",
    uid: "7A BB E4 06",
    active: true
  },
  {
    id: "8D-C9-0D-07",
    name: "Kyaw Zayar Min",
    plate: "N/A",
    uid: "8D C9 0D 07",
    active: true
  },
  {
    id: "BD-B0-50-07",
    name: "Myint Zu Khin",
    plate: "N/A",
    uid: "BD B0 50 07",
    active: true
  },
  {
    id: "42-8D-50-07",
    name: "Dr. Than Than Swe",
    plate: "N/A",
    uid: "42 8D 50 07",
    active: true
  }
];

let rfidUsers = loadData("rfUsers");
let detectedBookingCard = null;


// ============================================
// ADMIN AUTHENTICATION
// ============================================

const adminAccessBtn =
  document.getElementById("adminAccessBtn");

const adminDialog =
  document.getElementById("adminDialog");

const adminCloseBtn =
  document.getElementById("adminCloseBtn");

const adminLoginForm =
  document.getElementById("adminLoginForm");

const adminLoginFields =
  document.getElementById("adminLoginFields");

const adminSessionPanel =
  document.getElementById("adminSessionPanel");

const adminSessionEmail =
  document.getElementById("adminSessionEmail");

const adminAuthMessage =
  document.getElementById("adminAuthMessage");

const adminLogoutBtn =
  document.getElementById("adminLogoutBtn");

function setAdminMessage(message = "", mode = "") {
  if (!adminAuthMessage) return;

  adminAuthMessage.textContent = message;
  adminAuthMessage.className = mode
    ? `form-message ${mode}`
    : "form-message";
}

function openAdminDialog() {
  if (!adminDialog) return;

  setAdminMessage();

  if (typeof adminDialog.showModal === "function") {
    adminDialog.showModal();
  } else {
    adminDialog.setAttribute("open", "");
  }
}

function closeAdminDialog() {
  if (!adminDialog) return;

  if (typeof adminDialog.close === "function") {
    adminDialog.close();
  } else {
    adminDialog.removeAttribute("open");
  }
}

function stopRfidSync() {
  if (unsubscribeRfidUsers) {
    unsubscribeRfidUsers();
    unsubscribeRfidUsers = null;
  }
}

function startRfidSync() {
  if (
    !firebaseMode ||
    !adminMode ||
    unsubscribeRfidUsers
  ) {
    return;
  }

  unsubscribeRfidUsers = subscribeRfidUsers(
    cloudUsers => {
      rfidUsers = cloudUsers;
      renderUsers();
    },
    error => {
      console.error("Admin RFID sync failed", error);
      stopRfidSync();
    }
  );
}

function applyAuthState(state = {}) {
  currentAuthUid = state.uid || "";
  adminMode = Boolean(state.isAdmin);

  document
    .querySelectorAll(".admin-only")
    .forEach(element => {
      element.classList.toggle("hidden", !adminMode);
    });

  const rfidPage = document.getElementById("rfid");
  rfidPage?.classList.toggle("admin-enabled", adminMode);

  if (adminAccessBtn) {
    adminAccessBtn.textContent = adminMode
      ? "ADMIN ACTIVE"
      : "ADMIN LOGIN";
    adminAccessBtn.dataset.admin = String(adminMode);
  }

  adminLoginFields?.classList.toggle("hidden", adminMode);
  adminSessionPanel?.classList.toggle("hidden", !adminMode);

  if (adminSessionEmail) {
    adminSessionEmail.textContent = state.email || "Project owner";
  }

  if (adminMode) {
    startRfidSync();
  } else {
    stopRfidSync();
    rfidUsers = [];
    localStorage.removeItem("rfUsers");
    renderUsers();

    if (location.hash === "#rfid") {
      showPage("dashboard");
    }
  }

  renderBookings();
}

adminAccessBtn?.addEventListener("click", openAdminDialog);
adminCloseBtn?.addEventListener("click", closeAdminDialog);

adminDialog?.addEventListener("click", event => {
  if (event.target === adminDialog) {
    closeAdminDialog();
  }
});

adminLoginForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!firebaseMode) {
    setAdminMessage("Firebase connection is required.", "error");
    return;
  }

  const email = document.getElementById("adminEmail").value;
  const passwordInput = document.getElementById("adminPassword");
  const submitButton = document.getElementById("adminLoginSubmit");

  submitButton.disabled = true;
  setAdminMessage("Signing in...");

  try {
    await signInAdmin(email, passwordInput.value);
    passwordInput.value = "";
    setAdminMessage("Admin access granted.", "ok");
    setTimeout(closeAdminDialog, 500);
  } catch (error) {
    console.error("Admin sign-in failed", error);
    passwordInput.value = "";
    setAdminMessage(
      error.message.includes("not authorized")
        ? "This account is not the project owner."
        : "Email or password is incorrect.",
      "error"
    );
  } finally {
    submitButton.disabled = false;
  }
});

adminLogoutBtn?.addEventListener("click", async () => {
  adminLogoutBtn.disabled = true;
  setAdminMessage("Signing out...");

  try {
    await signOutAdmin();
    setAdminMessage("Admin signed out.", "ok");
    setTimeout(closeAdminDialog, 400);
  } catch (error) {
    console.error("Admin sign-out failed", error);
    setAdminMessage("Sign out failed. Try again.", "error");
  } finally {
    adminLogoutBtn.disabled = false;
  }
});


// ============================================
// BOOKING SYSTEM
// ============================================

let bookings = loadData("evBookings");

const NO_SHOW_GRACE_MINUTES = 15;
const BOOKING_CLAIMS_STORAGE_KEY = "evBookingClaimsV1";
// Keep previous measured-input receipts separate from estimated-model receipts.
const ENERGY_METER_STORAGE_KEY = "evDigitalTwinEstimatedMeterV1";
const BILLING_RATE_STORAGE_KEY = "evBillingRateV1";
const DIGITAL_TWIN_VOLTAGE_SCALE = 50;
const DIGITAL_TWIN_CURRENT_SCALE = 5;
const DIGITAL_TWIN_POWER_SCALE =
  DIGITAL_TWIN_VOLTAGE_SCALE * DIGITAL_TWIN_CURRENT_SCALE;

let claimedBookingIds = new Set(
  loadData(BOOKING_CLAIMS_STORAGE_KEY)
);

let noShowCleanupRunning = false;

function emptySessionMeter() {
  return {
    active: false,
    completed: false,
    dataPaused: false,
    energyWh: 0,
    lastSampleAt: 0,
    lastPowerW: 0,
    latestVoltage: 0,
    latestCurrent: 0,
    latestModelPowerW: 0,
    startedAt: 0,
    endedAt: 0,
    receiptId: "",
    owner: "",
    uid: "",
    plate: "",
    slot: "Slot 1",
    rate: 0,
    vehicleType: ""
  };
}

let sessionMeter = {
  ...emptySessionMeter(),
  ...loadData(ENERGY_METER_STORAGE_KEY, {})
};

let receiptPresentedFor = "";

const bookingForm =
  document.getElementById("bookingForm");

const bookingMsg =
  document.getElementById("bookingMsg");

const bookingCard =
  document.getElementById("bookingCard");

const bookingDriver =
  document.getElementById("driver");

const bookingCardHint =
  document.getElementById("bookingCardHint");

const bookingSubmitBtn =
  document.getElementById("bookingSubmitBtn");

const billingRate =
  document.getElementById("billingRate");

const chargingReceiptDialog =
  document.getElementById("chargingReceiptDialog");

const meterSessionActions =
  document.getElementById("meterSessionActions");

const viewReceiptBtn =
  document.getElementById("viewReceiptBtn");

const resetSessionBtn =
  document.getElementById("resetSessionBtn");

const printReceiptBtn =
  document.getElementById("printReceiptBtn");

const closeReceiptBtn =
  document.getElementById("closeReceiptBtn");

const slot1Bookings =
  document.getElementById("slot1Bookings");

const slot2Bookings =
  document.getElementById("slot2Bookings");

function maskUid(uid) {
  const parts = normalizeUid(uid).split(" ").filter(Boolean);

  if (parts.length <= 2) {
    return parts.join(" ");
  }

  return [
    ...parts.slice(0, -2).map(() => "••"),
    ...parts.slice(-2)
  ].join(" ");
}

function bookingCardDirectory() {
  const source = rfidUsers.length
    ? rfidUsers
    : DEFAULT_RFID_USERS;

  const byUid = new Map();

  source.forEach(user => {
    const uid = normalizeUid(user.uid);
    const name = String(user.name || "").trim();

    if (uid && name && user.active !== false) {
      byUid.set(uid, {
        ...user,
        uid,
        name
      });
    }
  });

  if (detectedBookingCard) {
    const uid = normalizeUid(detectedBookingCard.uid);

    if (uid && detectedBookingCard.name) {
      byUid.set(uid, {
        ...detectedBookingCard,
        uid
      });
    }
  }

  return [...byUid.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function applyBookingCardInput() {
  if (!bookingCard || !bookingDriver) return;

  const selectedUid = normalizeUid(bookingCard.value);
  const selectedCard = bookingCardDirectory().find(
    card => card.uid === selectedUid
  );

  bookingDriver.value = selectedCard?.name || "";
  bookingDriver.readOnly = true;

  if (selectedCard) {
    bookingCard.value = selectedCard.uid;
    bookingCard.setAttribute("aria-invalid", "false");
  } else {
    bookingCard.setAttribute(
      "aria-invalid",
      bookingCard.value.trim() ? "true" : "false"
    );
  }

  if (bookingSubmitBtn) {
    bookingSubmitBtn.disabled = !selectedCard;
  }

  if (bookingCardHint) {
    bookingCardHint.className = selectedCard
      ? "field-hint ok"
      : (bookingCard.value.trim() ? "field-hint error" : "field-hint");
    bookingCardHint.textContent = selectedCard
      ? `Owner verified · UID ${maskUid(selectedCard.uid)}`
      : (bookingCard.value.trim()
          ? "Unregistered RFID card. Check the UID and try again."
          : "Type the UID printed on the card. Spaces are optional.");
  }

  return selectedCard || null;
}

function setBookingCardUid(preferredUid = "") {
  if (!bookingCard) return;

  bookingCard.value = normalizeUid(preferredUid);
  applyBookingCardInput();
}

bookingCard?.addEventListener("input", () => {
  bookingUidEditedByUser = true;
  applyBookingCardInput();
});

bookingCard?.addEventListener(
  "blur",
  applyBookingCardInput
);

function canManageBooking(booking) {
  return !firebaseMode ||
    adminMode ||
    (
      currentAuthUid &&
      booking.createdBy === currentAuthUid
    );
}

function bookingStartTimestamp(booking) {
  const date = String(booking?.date || "");
  const time = String(booking?.time || "");
  const timestamp = Date.parse(`${date}T${time}:00+06:30`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function bookingArrivalDeadline(booking) {
  const start = bookingStartTimestamp(booking);
  return start
    ? start + NO_SHOW_GRACE_MINUTES * 60000
    : 0;
}

function bookingWasClaimed(booking) {
  return Boolean(booking?.id && claimedBookingIds.has(booking.id));
}

function bookingIsNoShowExpired(booking, now = Date.now()) {
  const deadline = bookingArrivalDeadline(booking);
  return Boolean(
    deadline &&
    now >= deadline &&
    !bookingWasClaimed(booking)
  );
}

function formatArrivalDeadline(booking) {
  const deadline = bookingArrivalDeadline(booking);
  if (!deadline) return "";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(deadline));
}

function rememberClaimedBooking(uid, timestamp, slotName = "") {
  const normalizedUid = normalizeUid(uid);
  const scanTime = Number(timestamp);

  if (!normalizedUid || !Number.isFinite(scanTime) || scanTime <= 0) {
    return;
  }

  let changed = false;

  bookings.forEach(booking => {
    const start = bookingStartTimestamp(booking);
    const deadline = bookingArrivalDeadline(booking);

    if (
      booking.id &&
      normalizeUid(booking.uid) === normalizedUid &&
      (!slotName || booking.slot === slotName) &&
      scanTime >= start &&
      scanTime < deadline &&
      !claimedBookingIds.has(booking.id)
    ) {
      claimedBookingIds.add(booking.id);
      changed = true;
    }
  });

  if (changed) {
    saveData(
      BOOKING_CLAIMS_STORAGE_KEY,
      [...claimedBookingIds]
    );
    renderBookings();
  }
}

async function expireNoShowBookings() {
  if (noShowCleanupRunning) return;

  const expired = bookings.filter(bookingIsNoShowExpired);
  if (!expired.length) return;

  noShowCleanupRunning = true;

  try {
    if (firebaseMode) {
      const removable = expired.filter(canManageBooking);
      await Promise.all(
        removable.map(booking => deleteBooking(booking.id))
      );
    } else {
      bookings = bookings.filter(
        booking => !bookingIsNoShowExpired(booking)
      );
      saveData("evBookings", bookings);
    }
  } catch (error) {
    console.error("Automatic no-show cleanup failed", error);
  } finally {
    noShowCleanupRunning = false;
    renderBookings();
  }
}


function renderSlotBookings(slotName, target) {

  if (!target) return;

  const list = bookings
    .map((booking, index) => ({
      ...booking,
      originalIndex: index
    }))
    .filter(booking =>
      booking.slot === slotName &&
      !bookingIsNoShowExpired(booking)
    )
    .sort((a, b) =>
      `${a.date}T${a.time}`.localeCompare(
        `${b.date}T${b.time}`
      )
    );

  if (!list.length) {
    target.innerHTML = `
      <div class="empty-state">
        No charging bookings saved yet.
      </div>
    `;
    return;
  }

  target.innerHTML = list.map(booking => `
    <div class="booking-item">

      <div>
        <b>
          ${escapeHtml(booking.date)}
          ·
          ${escapeHtml(booking.time)}
        </b>

        <span>
          ${escapeHtml(booking.driver)}
          ·
          ${escapeHtml(booking.plate)}
          ·
          ${escapeHtml(booking.duration)} min
          ${booking.uid
            ? ` · RFID ${escapeHtml(maskUid(booking.uid))}`
            : ""}
        </span>

        <small class="booking-arrival-state ${bookingWasClaimed(booking) ? "checked-in" : ""}">
          ${bookingWasClaimed(booking)
            ? "RFID CHECK-IN CONFIRMED"
            : `ARRIVE BY ${escapeHtml(formatArrivalDeadline(booking))} · 15-MINUTE HOLD`}
        </small>
      </div>

      ${canManageBooking(booking) ? `
        <button
          class="ghost-btn"
          onclick="removeBooking(${booking.originalIndex})">
          CANCEL
        </button>
      ` : ""}

    </div>
  `).join("");
}


function renderBookings() {
  renderSlotBookings(
    "Slot 1",
    slot1Bookings
  );

  renderSlotBookings(
    "Slot 2",
    slot2Bookings
  );
}


window.removeBooking = async function(index) {
  const booking = bookings[index];

  if (!booking) return;

  if (!canManageBooking(booking)) {
    alert("Only the booking owner or project admin can cancel this booking.");
    return;
  }

  try {
    if (firebaseMode) {
      await deleteBooking(booking.id);
    } else {
      bookings.splice(index, 1);
      saveData("evBookings", bookings);
      renderBookings();
    }
  } catch (error) {
    console.error(error);
    alert("Booking could not be removed. Please check the Firebase connection.");
  }
};


if (bookingForm) {

  bookingForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      const selectedUid = normalizeUid(
        bookingCard?.value || ""
      );
      const selectedCard = bookingCardDirectory().find(
        card => card.uid === selectedUid
      );

      if (!selectedCard) {
        bookingMsg.className = "form-message error";
        bookingMsg.textContent =
          "Enter a registered RFID card UID before confirming the booking.";
        return;
      }

      const data = {
        driver:
          selectedCard.name,

        plate:
          document.getElementById("plate").value.trim(),

        // The station matches the physical card UID to this booking.
        uid: selectedUid,

        date:
          document.getElementById("date").value,

        slot:
          document.getElementById("slot").value,

        time:
          document.getElementById("time").value,

        duration:
          Number(
            document.getElementById("duration").value
          )
      };


      const newStart =
        new Date(
          `${data.date}T${data.time}`
        ).getTime();

      const newEnd =
        newStart +
        data.duration * 60000;


      const conflict =
        bookings.some(existing => {

          if (bookingIsNoShowExpired(existing)) {
            return false;
          }

          if (
            existing.slot !== data.slot ||
            existing.date !== data.date
          ) {
            return false;
          }

          const oldStart =
            new Date(
              `${existing.date}T${existing.time}`
            ).getTime();

          const oldEnd =
            oldStart +
            Number(existing.duration) *
            60000;

          return (
            newStart < oldEnd &&
            newEnd > oldStart
          );
        });


      if (conflict) {

        bookingMsg.className =
          "form-message error";

        bookingMsg.textContent =
          "Conflict detected: this time overlaps an existing booking.";

        return;
      }


      try {
        if (firebaseMode) {
          await createBooking(data);
        } else {
          bookings.push({
            ...data,
            id: `local-${Date.now()}`
          });

          saveData("evBookings", bookings);
          renderBookings();
        }

        bookingMsg.className = "form-message ok";
        bookingMsg.textContent = firebaseMode
          ? `Booking confirmed for ${selectedCard.name}. Tap the same RFID card at the station.`
          : `Booking confirmed locally for ${selectedCard.name}.`;

        bookingForm.reset();
        bookingUidEditedByUser = false;
        setBookingCardUid();
      } catch (error) {
        console.error(error);
        bookingMsg.className = "form-message error";
        bookingMsg.textContent =
          "Booking was not saved. Check Authentication, Database Rules and internet connection.";
      }
    }
  );
}


const clearBookings =
  document.getElementById("clearBookings");

if (clearBookings) {

  clearBookings.addEventListener(
    "click",
    async () => {

      if (firebaseMode && !adminMode) {
        alert("Admin sign-in is required to clear all bookings.");
        return;
      }

      if (
        confirm(
          "Clear all charging bookings?"
        )
      ) {

        try {
          if (firebaseMode) {
            await deleteAllBookings();
          } else {
            bookings = [];
            saveData("evBookings", bookings);
            renderBookings();
          }
        } catch (error) {
          console.error(error);
          alert("Bookings could not be cleared.");
          return;
        }

        if (bookingMsg) {
          bookingMsg.textContent = "";
        }
      }
    }
  );
}

applyBookingCardInput();
renderBookings();

setInterval(() => {
  expireNoShowBookings();
  renderBookings();
}, 30000);


// ============================================
// RFID SYSTEM
// ============================================

const rfidForm =
  document.getElementById("rfidForm");

const rfidUsersList =
  document.getElementById("rfidUsersList");

const scanResult =
  document.getElementById("scanResult");


function renderUsers() {

  if (!rfidUsersList) return;

  const visibleUsers = rfidUsers.length
    ? rfidUsers
    : DEFAULT_RFID_USERS;

  rfidUsersList.innerHTML =
    visibleUsers.map(
      (user, index) => `

      <div class="user-row">

        <b>
          ${escapeHtml(user.name)}
        </b>

        <span>
          ${escapeHtml(user.plate)}
        </span>

        <span>
          ${escapeHtml(user.uid)}
        </span>

        <button
          class="ghost-btn"
          onclick="removeUser(${index})">

          REMOVE

        </button>

      </div>

    `
    ).join("");

  applyBookingCardInput();
}


window.removeUser = async function(index) {
  if (!adminMode) {
    alert("Admin sign-in is required to manage RFID users.");
    return;
  }

  const user = rfidUsers[index];

  if (!user) return;

  try {
    if (firebaseMode) {
      await deleteRfidUser(user.id);
    } else {
      rfidUsers.splice(index, 1);
      saveData("rfUsers", rfidUsers);
      renderUsers();
    }
  } catch (error) {
    console.error(error);
    alert("RFID user could not be removed.");
  }
};


if (rfidForm) {

  rfidForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      if (!adminMode) {
        return;
      }

      const user = {

        name:
          document
          .getElementById("rfName")
          .value
          .trim(),

        plate:
          document
          .getElementById("rfPlate")
          .value
          .trim(),

        email:
          document
          .getElementById("rfEmail")
          .value
          .trim(),

        uid: latestDetectedUid

      };


      if (!latestDetectedUid) {
        if (scanResult) {
          scanResult.className = "scan-result denied";
          scanResult.textContent = "TAP A CARD ON THE PHYSICAL READER FIRST";
        }
        return;
      }

      try {
        if (firebaseMode) {
          await saveRfidUser(user);
        } else {
          const existingIndex = rfidUsers.findIndex(
            item => item.uid === user.uid
          );

          if (existingIndex >= 0) {
            rfidUsers[existingIndex] = {
              ...user,
              id: rfidUsers[existingIndex].id
            };
          } else {
            rfidUsers.push({
              ...user,
              id: `local-${Date.now()}`
            });
          }

          saveData("rfUsers", rfidUsers);
          renderUsers();
        }

        rfidForm.reset();
        latestDetectedUid = "";
        latestDetectedTimestamp = 0;
        updateRfidEnrollmentUi();
      } catch (error) {
        console.error(error);

        if (scanResult) {
          scanResult.className = "scan-result denied";
          scanResult.textContent = "FIREBASE SAVE FAILED";
        }

        return;
      }


      if (scanResult) {

        scanResult.className =
          "scan-result granted";

        scanResult.textContent =
          "USER REGISTERED";

        setTimeout(() => {

          scanResult.className =
            "scan-result";

          scanResult.textContent =
            "WAITING FOR CARD";

        }, 1500);
      }
    }
  );
}


// ---------- HARDWARE RFID SCAN MONITOR ----------

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

  if (
    uid &&
    latest.userName &&
    scanIsRecent(timestamp)
  ) {
    detectedBookingCard = {
      uid,
      name: String(latest.userName).trim(),
      plate: String(latest.plate || "").trim(),
      active: true
    };

    const scanKey = `${uid}|${timestamp}`;

    // A newly scanned card may assist an untouched booking form once. Polling
    // the same Firebase record must never overwrite a UID the user clears or
    // types manually.
    if (scanKey !== lastBookingAutoFillScanKey) {
      lastBookingAutoFillScanKey = scanKey;

      if (!bookingUidEditedByUser) {
        setBookingCardUid(uid);
      }
    }
  }

  updateRfidEnrollmentUi();

  if (!scanResult || !uid) return;

  if (latest.granted === true) {
    rememberClaimedBooking(uid, timestamp, String(latest.slot || ""));
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


const clearUsers =
  document.getElementById("clearUsers");


if (clearUsers) {

  clearUsers.addEventListener(
    "click",
    async () => {

      if (!adminMode) {
        return;
      }

      if (
        confirm(
          "Clear all RFID users?"
        )
      ) {

        try {
          if (firebaseMode) {
            await deleteAllRfidUsers();
          } else {
            rfidUsers = [];
            saveData("rfUsers", rfidUsers);
            renderUsers();
          }
        } catch (error) {
          console.error(error);
          alert("RFID users could not be cleared.");
          return;
        }

        if (scanResult) {

          scanResult.className =
            "scan-result";

          scanResult.textContent =
            "WAITING FOR CARD";
        }
      }
    }
  );
}

renderUsers();


// ============================================
// LIVE STATION TELEMETRY
// ============================================

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
const TELEMETRY_STALE_MS = 15000;
let lastStationSnapshot = {};

function slotIsFresh(slot = {}) {
  const updatedAt = Number(slot.updatedAt);

  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return false;
  }

  const age = Date.now() - updatedAt;

  return age >= 0 && age <= TELEMETRY_STALE_MS;
}

function showSlotOffline(slotNumber) {
  const prefix = `slot${slotNumber}`;

  const card =
    document.getElementById(`${prefix}Card`);

  const badge =
    document.getElementById(`${prefix}Status`);

  const ring =
    document.getElementById(`${prefix}SocRing`);

  const relay =
    document.getElementById(`${prefix}Relay`);

  const protection =
    document.getElementById(`${prefix}Protection`);

  if (card) {
    card.classList.remove("charging");
    card.classList.add("hold");
  }

  if (badge) {
    badge.textContent = "OFFLINE";
    badge.className = "badge badge-amber";
  }

  if (ring) {
    ring.style.setProperty("--p", 0);
  }

  if (relay) {
    relay.textContent = "OFF";
    relay.className = "warn";
  }

  if (protection) {
    protection.textContent = "OFFLINE";
    protection.className = "warn";
  }

  setText(`${prefix}Soc`, "--%");
  setText(`${prefix}Voltage`, "-- V");
  setText(`${prefix}Current`, "-- A");
  setText(`${prefix}Power`, "-- W");
  setText(`${prefix}Temperature`, "-- °C");

  if (slotNumber === 1) {
    setText("telemetrySoc", "--%");
    setText("telemetryVoltage", "-- V");
    setText("telemetryCurrent", "-- A");
    setText("telemetryTemperature", "-- °C");
    setText("meterSourceState", "STATION OFFLINE");
    setText("projectedVoltage", "-- V");
    setText("projectedCurrent", "-- A");
    setText("projectedPower", "-- kW");
    setText("projectedHourEnergy", "-- kWh");
    setText("projectedHourCost", "--");

    if (sessionMeter.active) {
      sessionMeter.dataPaused = true;
      setText("sessionMeterStatus", "DATA PAUSED");
    }
  }
}
function slotStateLabel(state) {
  const labels = {
    ready: "READY",
    charging: "CHARGING",
    hold: "TIME-SLICE HOLD",
    denied: "ACCESS DENIED",
    fault: "FAULT",
    offline: "OFFLINE"
  };

  return labels[state] || "WAITING FOR DATA";
}

function applySlotTelemetry(slotNumber, slot = {}) {
  if (!slotIsFresh(slot)) {
    showSlotOffline(slotNumber);
    return false;
  }
  const prefix = `slot${slotNumber}`;
  const state = String(slot.state || "offline").toLowerCase();
  const voltage = finiteNumber(slot.voltage);
  const estimate = chargingEstimate(slot);
  const current = slotNumber === 1
    ? estimate.current : finiteNumber(slot.current);
  const power = slotNumber === 1
    ? estimate.power : (Number.isFinite(Number(slot.power))
        ? Number(slot.power) : voltage * current);
  const temperature = finiteNumber(slot.temperature);
  const soc = Math.max(0, Math.min(100, finiteNumber(slot.soc)));
  const protection = String(slot.protection || "waiting").toUpperCase();

  const card = document.getElementById(`${prefix}Card`);
  const badge = document.getElementById(`${prefix}Status`);
  const ring = document.getElementById(`${prefix}SocRing`);
  const relay = document.getElementById(`${prefix}Relay`);
  const protectionElement = document.getElementById(`${prefix}Protection`);

  if (card) {
    card.classList.toggle("charging", state === "charging");
    card.classList.toggle("hold", state !== "charging");
  }

  if (badge) {
    badge.textContent = slotStateLabel(state);
    badge.className = state === "charging"
      ? "badge badge-green"
      : "badge badge-amber";
  }

  if (ring) {
    ring.style.setProperty("--p", soc);
  }

  if (relay) {
    relay.textContent = slot.relay ? "ENABLE" : "OFF";
    relay.className = slot.relay ? "good" : "warn";
  }

  if (protectionElement) {
    protectionElement.textContent = protection;
    protectionElement.className = protection === "NORMAL"
      ? "good"
      : "warn";
  }

  setText(`${prefix}Soc`, `${soc.toFixed(0)}%`);
  setText(`${prefix}Voltage`, `${voltage.toFixed(2)} V`);
  setText(`${prefix}Current`, `${current.toFixed(2)} A`);
  setText(`${prefix}Power`, `${power.toFixed(2)} W`);
  setText(`${prefix}Temperature`, `${temperature.toFixed(1)} °C`);

  if (slotNumber === 1) {
    setText("telemetrySoc", `${soc.toFixed(0)}%`);
    setText("telemetryVoltage", `${voltage.toFixed(2)} V`);
    setText("telemetryCurrent", `${current.toFixed(2)} A`);
    setText("telemetryTemperature", `${temperature.toFixed(1)} °C`);
    updateSessionEnergyMeter(slot);
  }
  return true;
}

function selectedBillingRate() {
  const rate = Number(billingRate?.value || 750);
  const optionText =
    billingRate?.selectedOptions?.[0]?.textContent || "Private car";

  return {
    rate: Number.isFinite(rate) && rate > 0 ? rate : 750,
    vehicleType: optionText.split("·")[0].trim() || "Private car"
  };
}

function sessionIdentity(slot = {}) {
  const latest = lastStationSnapshot?.rfid?.latestScan || {};
  const uid = normalizeUid(
    slot.uid || slot.cardUid || latest.uid || latestDetectedUid
  );
  const knownCard = bookingCardDirectory().find(card => card.uid === uid);

  return {
    uid,
    owner: String(
      slot.owner ||
      slot.userName ||
      latest.userName ||
      knownCard?.name ||
      "Registered RFID user"
    ).trim(),
    plate: String(
      slot.plate || latest.plate || knownCard?.plate || ""
    ).trim(),
    slot: String(slot.slot || latest.slot || "Slot 1").trim()
  };
}

function makeReceiptId(timestamp) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Yangon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date(timestamp || Date.now()))
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return `SEV-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function formatReceiptTime(timestamp) {
  const numeric = Number(timestamp);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(numeric));
}

function formatSessionDuration(startedAt, endedAt) {
  const seconds = Math.max(
    0,
    Math.round((Number(endedAt) - Number(startedAt)) / 1000)
  );
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes > 0
    ? `${minutes} min ${remainingSeconds} sec`
    : `${remainingSeconds} sec`;
}

function meterProjection() {
  const prototypeEnergyWh = Math.max(0, Number(sessionMeter.energyWh) || 0);
  const projectedEnergyKwh =
    prototypeEnergyWh * DIGITAL_TWIN_POWER_SCALE / 1000;
  const liveOutput = sessionMeter.active && !sessionMeter.dataPaused;
  const projectedVoltage = liveOutput
    ? Math.max(0, Number(sessionMeter.latestVoltage) || 0) *
      DIGITAL_TWIN_VOLTAGE_SCALE : 0;
  const projectedCurrent = liveOutput
    ? Math.max(0, Number(sessionMeter.latestCurrent) || 0) *
      DIGITAL_TWIN_CURRENT_SCALE : 0;
  const projectedPowerKw = liveOutput
    ? Math.max(0, Number(sessionMeter.latestModelPowerW) || 0) / 1000 : 0;
  const selectedRate = selectedBillingRate();
  const rate = Number(sessionMeter.rate) > 0
    ? Number(sessionMeter.rate)
    : selectedRate.rate;
  const sessionCost = projectedEnergyKwh * rate;
  const projectedHourEnergyKwh = projectedPowerKw;
  const projectedHourCost = projectedHourEnergyKwh * rate;

  return {
    projectedEnergyKwh,
    projectedVoltage,
    projectedCurrent,
    projectedPowerKw,
    projectedHourEnergyKwh,
    projectedHourCost,
    rate,
    sessionCost
  };
}

function renderChargingReceipt(projection = meterProjection()) {
  setText("receiptId", sessionMeter.receiptId || "—");
  setText("receiptOwner", sessionMeter.owner || "Registered RFID user");
  setText("receiptUid", sessionMeter.uid || "—");
  setText("receiptPlate", sessionMeter.plate || "—");
  setText("receiptSlot", sessionMeter.slot || "Slot 1");
  setText("receiptVehicleType", sessionMeter.vehicleType || "Private car");
  setText("receiptStartedAt", formatReceiptTime(sessionMeter.startedAt));
  setText("receiptEndedAt", formatReceiptTime(sessionMeter.endedAt));
  setText(
    "receiptDuration",
    formatSessionDuration(sessionMeter.startedAt, sessionMeter.endedAt)
  );
  setText(
    "receiptEnergy",
    `${projection.projectedEnergyKwh.toFixed(6)} kWh`
  );
  setText("receiptRate", `K${projection.rate.toFixed(2)} / kWh`);
  setText("receiptTotal", `K${projection.sessionCost.toFixed(2)}`);
}

function renderSessionEnergyMeter() {
  const projection = meterProjection();
  const hasSession =
    sessionMeter.active ||
    sessionMeter.completed ||
    projection.projectedEnergyKwh > 0;

  setText("projectedVoltage", `${projection.projectedVoltage.toFixed(1)} V`);
  setText("projectedCurrent", `${projection.projectedCurrent.toFixed(2)} A`);
  setText("projectedPower", `${projection.projectedPowerKw.toFixed(3)} kW`);
  setText("sessionEnergyKwh", `${projection.projectedEnergyKwh.toFixed(6)} kWh`);
  setText("sessionCost", `K${projection.sessionCost.toFixed(2)}`);
  setText(
    "projectedHourEnergy",
    `${projection.projectedHourEnergyKwh.toFixed(3)} kWh`
  );
  setText("projectedHourCost", `K${projection.projectedHourCost.toFixed(2)}`);
  setText(
    "sessionMeterStatus",
    sessionMeter.active
      ? (sessionMeter.dataPaused ? "DATA PAUSED" : "CHARGING ESTIMATE")
      : (hasSession ? "SESSION COMPLETE" : "WAITING FOR CHARGING")
  );
  setText(
    "meterSourceState",
    sessionMeter.active
      ? (sessionMeter.dataPaused ? "STATION OFFLINE" : "MODEL ESTIMATE")
      : (hasSession ? "COMPLETE" : "WAITING")
  );

  if (billingRate) {
    billingRate.disabled = sessionMeter.active || sessionMeter.completed;
  }

  if (meterSessionActions) {
    meterSessionActions.hidden = !sessionMeter.completed;
  }

  renderChargingReceipt(projection);
}

function closeReceipt() {
  if (!chargingReceiptDialog) return;

  if (typeof chargingReceiptDialog.close === "function" && chargingReceiptDialog.open) {
    chargingReceiptDialog.close();
  } else {
    chargingReceiptDialog.removeAttribute("open");
  }
}

function showReceipt(automatic = false) {
  if (!sessionMeter.completed || !chargingReceiptDialog) return;

  if (
    automatic &&
    receiptPresentedFor === sessionMeter.receiptId
  ) {
    return;
  }

  renderChargingReceipt();
  receiptPresentedFor = sessionMeter.receiptId;

  if (!chargingReceiptDialog.open) {
    if (typeof chargingReceiptDialog.showModal === "function") {
      chargingReceiptDialog.showModal();
    } else {
      chargingReceiptDialog.setAttribute("open", "");
    }
  }
}

function clearCompletedSession() {
  if (sessionMeter.active) return;

  sessionMeter = emptySessionMeter();
  receiptPresentedFor = "";
  saveData(ENERGY_METER_STORAGE_KEY, sessionMeter);
  closeReceipt();
  renderSessionEnergyMeter();
}

function updateSessionEnergyMeter(slot = {}) {
  const timestamp = Number(slot.updatedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    renderSessionEnergyMeter();
    return;
  }

  const estimate = chargingEstimate(slot);
  if (!estimate.fresh) return;

  const { charging, voltage, current, power } = estimate;
  const modelPower = power * DIGITAL_TWIN_POWER_SCALE;
  let sessionJustCompleted = false;

  if (charging && !sessionMeter.active) {
    const identity = sessionIdentity(slot);
    const billing = selectedBillingRate();

    sessionMeter = {
      ...emptySessionMeter(),
      active: true,
      startedAt: timestamp,
      receiptId: makeReceiptId(timestamp),
      owner: identity.owner,
      uid: identity.uid,
      plate: identity.plate,
      slot: identity.slot,
      rate: billing.rate,
      vehicleType: billing.vehicleType,
      lastSampleAt: timestamp,
      lastPowerW: power,
      latestVoltage: voltage,
      latestCurrent: current,
      latestModelPowerW: modelPower
    };
    receiptPresentedFor = "";
    closeReceipt();
  } else if (
    charging &&
    timestamp > Number(sessionMeter.lastSampleAt || 0)
  ) {
    const elapsedMs = sessionMeter.dataPaused ? 0 : Math.min(
      timestamp - Number(sessionMeter.lastSampleAt || timestamp),
      15000
    );
    const averagePower =
      (Math.max(0, Number(sessionMeter.lastPowerW) || 0) + power) / 2;

    sessionMeter.energyWh =
      Math.max(0, Number(sessionMeter.energyWh) || 0) +
      averagePower * elapsedMs / 3600000;
    sessionMeter.lastSampleAt = timestamp;
    sessionMeter.lastPowerW = power;
    sessionMeter.latestVoltage = voltage;
    sessionMeter.latestCurrent = current;
    sessionMeter.latestModelPowerW = modelPower;
    sessionMeter.dataPaused = false;
  } else if (!charging && sessionMeter.active) {
    const elapsedMs = sessionMeter.dataPaused ? 0 : Math.min(
      Math.max(
        0,
        timestamp - Number(sessionMeter.lastSampleAt || timestamp)
      ),
      15000
    );
    const finalPower = Math.max(0, Number(sessionMeter.lastPowerW) || 0);

    sessionMeter.energyWh =
      Math.max(0, Number(sessionMeter.energyWh) || 0) +
      finalPower * elapsedMs / 3600000;
    sessionMeter.active = false;
    sessionMeter.completed = true;
    sessionMeter.dataPaused = false;
    sessionMeter.endedAt = timestamp;
    sessionMeter.receiptId =
      sessionMeter.receiptId || makeReceiptId(sessionMeter.startedAt || timestamp);
    sessionMeter.lastSampleAt = timestamp;
    sessionMeter.lastPowerW = 0;
    sessionJustCompleted = true;
  }

  saveData(ENERGY_METER_STORAGE_KEY, sessionMeter);
  renderSessionEnergyMeter();

  if (sessionJustCompleted) {
    showReceipt(true);
  }
}

if (billingRate) {
  billingRate.value = localStorage.getItem(BILLING_RATE_STORAGE_KEY) || "750";
  billingRate.addEventListener("change", () => {
    localStorage.setItem(BILLING_RATE_STORAGE_KEY, billingRate.value);

    if (!sessionMeter.active && !sessionMeter.completed) {
      renderSessionEnergyMeter();
    }
  });
}

viewReceiptBtn?.addEventListener("click", () => showReceipt(false));
resetSessionBtn?.addEventListener("click", clearCompletedSession);
closeReceiptBtn?.addEventListener("click", closeReceipt);
printReceiptBtn?.addEventListener("click", () => window.print());

chargingReceiptDialog?.addEventListener("click", event => {
  if (event.target === chargingReceiptDialog) {
    closeReceipt();
  }
});

renderSessionEnergyMeter();

function applyStationTelemetry(station = {}) {
  lastStationSnapshot = station || {};
  const slot1 = station.slots?.slot1 || {};
  const slot2 = station.slots?.slot2 || {};

  const slot1Live = applySlotTelemetry(1, slot1);
  const slot2Live = applySlotTelemetry(2, slot2);
  applyRfidStationState(station.rfid || {});

  if (!slot1Live && !slot2Live) {
    setCloudStatus("station-offline", "STATION OFFLINE");
    setText("stationSupply", "-- V");
    setText("stationCurrent", "-- A");
    setText("stationPower", "-- W");
    setText("stationProtection", "OFFLINE");
    return;
  }

  setCloudStatus("cloud", "FIREBASE LIVE");

  const slot1Estimate = chargingEstimate(slot1);
  const totalCurrent =
    slot1Estimate.current +
    (slot2Live ? finiteNumber(slot2.current) : 0);

  const totalPower =
    slot1Estimate.power +
    (slot2Live ? finiteNumber(slot2.power) : 0);

  const supplyVoltage = finiteNumber(
    station.supplyVoltage,
    finiteNumber(slot1.supplyVoltage)
  );

  const protection = String(
    station.protection ||
    slot1.protection ||
    "waiting"
  ).toUpperCase();

  setText("stationSupply", `${supplyVoltage.toFixed(2)} V`);
  setText("stationCurrent", `${totalCurrent.toFixed(2)} A`);
  setText("stationPower", `${totalPower.toFixed(2)} W`);
  setText("stationProtection", protection);
}


// ============================================
// FIREBASE STARTUP AND REALTIME LISTENERS
// ============================================

async function startDataSync() {
  setCloudStatus("starting", "CONNECTING");

  try {
    const result = await connectFirebase();

    if (!result.connected) {
      firebaseMode = false;
      setCloudStatus("local", "LOCAL DEMO");
      console.warn(result.reason);
      return;
    }

    firebaseMode = true;
    setCloudStatus("station-offline", "WAITING FOR STATION");

    applyAuthState(result);

    subscribeAuthState(
      state => applyAuthState(state),
      error => {
        console.error("Authentication state failed", error);
        applyAuthState({});
      }
    );

    subscribeBookings(
      cloudBookings => {
        bookings = cloudBookings;
        saveData("evBookings", bookings);
        renderBookings();
      },
      error => {
        console.error("Booking sync failed", error);
        setCloudStatus("error", "SYNC ERROR");
      }
    );

    subscribeStation(
      station => applyStationTelemetry(station),
      error => {
        console.error("Station telemetry sync failed", error);
      }
    );
  } catch (error) {
    firebaseMode = false;
    setCloudStatus("error", "FIREBASE ERROR");
    console.error("Firebase startup failed", error);
  }
}

startDataSync();
setInterval(() => {
  if (firebaseMode) {
    applyStationTelemetry(lastStationSnapshot);
  }
}, 3000);


// ============================================
// YANGON CHARGER MAP BUTTONS
// ============================================

document
.querySelectorAll(".map-btn")
.forEach(button => {

  button.addEventListener(
    "click",
    () => {

      const query =
        encodeURIComponent(
          button.dataset.map
        );

      window.open(
        `https://www.google.com/maps/search/?api=1&query=${query}`,
        "_blank",
        "noopener"
      );
    }
  );
});


// ============================================
// PRESENTATION FULL SCREEN
// ============================================

const fullscreenBtn =
  document.getElementById("fullscreenBtn");


if (fullscreenBtn) {

  fullscreenBtn.addEventListener(
    "click",
    async () => {

      try {

        if (
          !document.fullscreenElement
        ) {

          await document
          .documentElement
          .requestFullscreen();

        } else {

          await document
          .exitFullscreen();
        }

      } catch {

        alert(
          "Full screen is not supported by this browser. You can add the website to your Home Screen for presentation mode."
        );
      }
    }
  );
}


// ============================================
// READY
// ============================================

console.log(
  "Smart EV Charging Station Premium UI loaded."
);
