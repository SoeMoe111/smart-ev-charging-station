// ================================
// IoT SMART EV CHARGING STATION
// Front-end Prototype Controller
// ================================

// ---------- Mobile Menu ----------
const menuBtn = document.getElementById("menuBtn");
const nav = document.getElementById("nav");

if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
    });
  });
}


// ---------- Storage Helpers ----------
function getData(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}


// ===================================
// BOOKING SYSTEM
// ===================================

const bookingForm = document.getElementById("bookingForm");
const bookingMsg = document.getElementById("bookingMsg");
const bookingsBox = document.getElementById("bookings");

function renderBookings() {
  if (!bookingsBox) return;

  const bookings = getData("evBookings");

  if (bookings.length === 0) {
    bookingsBox.innerHTML = `
      <h3>Current bookings</h3>
      <p>No charging reservations yet.</p>
    `;
    return;
  }

  bookingsBox.innerHTML = `
    <h3>Current bookings</h3>
    ${bookings.map((b, index) => `
      <div style="
        padding:12px 0;
        border-bottom:1px solid #e5ecef;
      ">
        <strong>${b.slot}</strong>
        <br>
        ${b.driver} · ${b.plate}
        <br>
        <small>
          ${b.date || "Date not set"} ·
          ${b.time} ·
          ${b.duration} min
        </small>
        <br>
        <button
          onclick="cancelBooking(${index})"
          style="
            margin-top:8px;
            background:#d94b4b;
            padding:7px 12px;
          "
        >
          CANCEL
        </button>
      </div>
    `).join("")}
  `;
}

window.cancelBooking = function(index) {
  const bookings = getData("evBookings");

  bookings.splice(index, 1);

  saveData("evBookings", bookings);

  renderBookings();

  if (bookingMsg) {
    bookingMsg.innerHTML =
      "<b>BOOKING CANCELLED</b> Reservation removed successfully.";
  }
};


if (bookingForm) {

  bookingForm.addEventListener("submit", function(e) {

    e.preventDefault();

    const driver =
      document.getElementById("driver")?.value.trim();

    const plate =
      document.getElementById("plate")?.value.trim();

    const uid =
      document.getElementById("uid")?.value.trim();

    const date =
      document.getElementById("date")?.value || "";

    const slot =
      document.getElementById("slot")?.value || "Slot 1";

    const time =
      document.getElementById("time")?.value;

    const duration =
      Number(document.getElementById("duration")?.value || 60);


    if (!driver || !plate || !time) {

      bookingMsg.innerHTML =
        "<b>ERROR</b> Please complete the required booking information.";

      return;
    }


    const bookings = getData("evBookings");

    const newStart =
      new Date(`2000-01-01T${time}:00`).getTime();

    const newEnd =
      newStart + duration * 60000;


    const conflict = bookings.some(b => {

      if (b.slot !== slot) return false;

      if (date && b.date && b.date !== date) return false;

      const oldStart =
        new Date(`2000-01-01T${b.time}:00`).getTime();

      const oldEnd =
        oldStart + Number(b.duration) * 60000;

      return newStart < oldEnd && newEnd > oldStart;
    });


    if (conflict) {

      bookingMsg.innerHTML =
        "<b>TIME CONFLICT</b> This charging slot is already reserved during the selected period.";

      return;
    }


    bookings.push({
      driver,
      plate,
      uid,
      date,
      slot,
      time,
      duration
    });


    saveData("evBookings", bookings);

    bookingMsg.innerHTML =
      `<b>BOOKING CONFIRMED</b> ${slot} reserved successfully for ${driver}.`;

    bookingForm.reset();

    renderBookings();
  });
}


// ===================================
// RFID REGISTRATION
// ===================================

const rfidForm =
  document.getElementById("rfidForm");

const scanBtn =
  document.getElementById("scanBtn");

const scanResult =
  document.getElementById("scanResult");


if (rfidForm) {

  rfidForm.addEventListener("submit", function(e) {

    e.preventDefault();

    const name =
      document.getElementById("rfName")?.value.trim();

    const plate =
      document.getElementById("rfPlate")?.value.trim();

    const email =
      document.getElementById("rfEmail")?.value.trim();

    const uid =
      document.getElementById("rfUid")?.value.trim().toUpperCase();


    if (!name || !plate || !uid) return;


    const users =
      getData("evRfidUsers");


    const exists =
      users.some(user =>
        user.uid === uid
      );


    if (exists) {

      alert("This RFID UID is already registered.");

      return;
    }


    users.push({
      name,
      plate,
      email,
      uid,
      status: "ACTIVE"
    });


    saveData(
      "evRfidUsers",
      users
    );


    alert(
      "RFID user registered successfully."
    );


    rfidForm.reset();
  });
}


// ===================================
// RFID SCAN SIMULATION
// ===================================

if (scanBtn) {

  scanBtn.addEventListener("click", function() {

    const uid =
      document.getElementById("scanUid")
      ?.value.trim()
      .toUpperCase();


    if (!uid) {

      scanResult.innerHTML =
        "Enter an RFID UID first.";

      return;
    }


    const users =
      getData("evRfidUsers");


    const user =
      users.find(u =>
        u.uid === uid
      );


    if (user) {

      scanResult.innerHTML = `
        <span style="
          color:#087c52;
          font-weight:700;
        ">
          ✓ ACCESS GRANTED
        </span>
        <br>
        ${user.name}
        <br>
        Vehicle: ${user.plate}
      `;

    } else {

      scanResult.innerHTML = `
        <span style="
          color:#c33;
          font-weight:700;
        ">
          ✕ ACCESS DENIED
        </span>
        <br>
        RFID UID not registered.
      `;
    }
  });
}


// ===================================
// DASHBOARD LIVE SIMULATION
// ===================================

function randomBetween(min, max, decimals = 2) {

  return (
    Math.random() * (max - min) + min
  ).toFixed(decimals);
}


// Simulated ESP32 telemetry.
// Later this section can be replaced
// with actual ESP32/API data.

setInterval(() => {

  const cards =
    document.querySelectorAll(".stats article strong");

  if (cards.length >= 3) {

    cards[0].textContent =
      randomBetween(12.02, 12.12) + " V";

    cards[1].textContent =
      randomBetween(1.50, 1.75) + " A";

    cards[2].textContent =
      randomBetween(11.7, 12.6, 1) + " W";
  }

}, 3000);


// ===================================
// INITIALIZE
// ===================================

renderBookings();

console.log(
  "IoT Smart EV Charging Station dashboard initialized."
);
