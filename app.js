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
  recordAccessEvent,
  subscribeStation,
  normalizeUid
} from "./firebase-service.js";

// ============================================
// SMART EV CHARGING STATION - FIREBASE APP
// ============================================

let firebaseMode = false;
let currentAuthUid = "";
let adminMode = false;
let unsubscribeRfidUsers = null;

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
    banner.textContent = mode === "cloud"
      ? "Booking, RFID and station data are synchronized through Firebase Realtime Database."
      : "Firebase is unavailable. Local demo storage remains active so the interface is safe to test.";
  }

  if (tag) {
    tag.textContent = mode === "cloud"
      ? "FIREBASE LIVE"
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

const bookingForm =
  document.getElementById("bookingForm");

const bookingMsg =
  document.getElementById("bookingMsg");

const slot1Bookings =
  document.getElementById("slot1Bookings");

const slot2Bookings =
  document.getElementById("slot2Bookings");

function canManageBooking(booking) {
  return !firebaseMode ||
    adminMode ||
    (
      currentAuthUid &&
      booking.createdBy === currentAuthUid
    );
}


function renderSlotBookings(slotName, target) {

  if (!target) return;

  const list = bookings
    .map((booking, index) => ({
      ...booking,
      originalIndex: index
    }))
    .filter(booking => booking.slot === slotName)
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
        </span>
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

      const data = {
        driver:
          document.getElementById("driver").value.trim(),

        plate:
          document.getElementById("plate").value.trim(),

        uid: normalizeUid(
          document.getElementById("uid").value
        ),

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
          ? "Booking confirmed and synchronized to Firebase."
          : "Booking confirmed in local fallback mode.";

        bookingForm.reset();
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

renderBookings();


// ============================================
// RFID SYSTEM
// ============================================

let rfidUsers =
  loadData("rfUsers");

const rfidForm =
  document.getElementById("rfidForm");

const rfidUsersList =
  document.getElementById("rfidUsersList");

const scanResult =
  document.getElementById("scanResult");


function renderUsers() {

  if (!rfidUsersList) return;

  if (!rfidUsers.length) {

    rfidUsersList.innerHTML = `
      <div class="empty-state">
        No RFID users registered yet.
      </div>
    `;

    return;
  }


  rfidUsersList.innerHTML =
    rfidUsers.map(
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

        uid: normalizeUid(
          document.getElementById("rfUid").value
        )

      };


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


// ---------- RFID SCAN ----------

const scanBtn =
  document.getElementById("scanBtn");


if (scanBtn) {

  scanBtn.addEventListener(
    "click",
    async () => {

      if (!adminMode) {
        return;
      }

      const uid = normalizeUid(
        document.getElementById("scanUid").value
      );


      const user =
        rfidUsers.find(
          item =>
            item.uid === uid
        );


      if (user) {

        scanResult.className =
          "scan-result granted";

        scanResult.innerHTML =
          `ACCESS GRANTED<br>${escapeHtml(user.name)} · ${escapeHtml(user.plate)}`;

        if (firebaseMode) {
          recordAccessEvent({
            uid,
            granted: true,
            userName: user.name,
            plate: user.plate
          }).catch(error =>
            console.error("Access event log failed", error)
          );
        }

      } else {

        scanResult.className =
          "scan-result denied";

        scanResult.textContent =
          "ACCESS DENIED";

        if (firebaseMode) {
          recordAccessEvent({
            uid,
            granted: false
          }).catch(error =>
            console.error("Access event log failed", error)
          );
        }
      }
    }
  );
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
  const prefix = `slot${slotNumber}`;
  const state = String(slot.state || "offline").toLowerCase();
  const voltage = finiteNumber(slot.voltage);
  const current = finiteNumber(slot.current);
  const power = Number.isFinite(Number(slot.power))
    ? Number(slot.power)
    : voltage * current;
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
  }
}

function applyStationTelemetry(station = {}) {
  const slot1 = station.slots?.slot1 || {};
  const slot2 = station.slots?.slot2 || {};

  applySlotTelemetry(1, slot1);
  applySlotTelemetry(2, slot2);

  const totalCurrent =
    finiteNumber(slot1.current) +
    finiteNumber(slot2.current);

  const totalPower =
    finiteNumber(slot1.power) +
    finiteNumber(slot2.power);

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
    setCloudStatus("cloud", "FIREBASE LIVE");

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
