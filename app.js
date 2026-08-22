// ============================================
// SMART EV CHARGING STATION - PREMIUM APP
// ============================================

// ---------- PAGE NAVIGATION ----------
const navTabs = [...document.querySelectorAll(".nav-tab")];
const pages = [...document.querySelectorAll(".page")];

function showPage(pageId, updateHash = true) {
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


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
        No bookings saved on this device yet.
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

      <button
        class="ghost-btn"
        onclick="removeBooking(${booking.originalIndex})">
        CANCEL
      </button>

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


window.removeBooking = function(index) {

  bookings.splice(index, 1);

  saveData(
    "evBookings",
    bookings
  );

  renderBookings();
};


if (bookingForm) {

  bookingForm.addEventListener(
    "submit",
    event => {

      event.preventDefault();

      const data = {
        driver:
          document.getElementById("driver").value.trim(),

        plate:
          document.getElementById("plate").value.trim(),

        uid:
          document.getElementById("uid").value.trim(),

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


      bookings.push(data);

      saveData(
        "evBookings",
        bookings
      );


      bookingMsg.className =
        "form-message ok";

      bookingMsg.textContent =
        "Booking confirmed successfully on this device.";


      bookingForm.reset();

      renderBookings();
    }
  );
}


const clearBookings =
  document.getElementById("clearBookings");

if (clearBookings) {

  clearBookings.addEventListener(
    "click",
    () => {

      if (
        confirm(
          "Clear all local bookings?"
        )
      ) {

        bookings = [];

        saveData(
          "evBookings",
          bookings
        );

        renderBookings();

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
        No RFID users registered on this device yet.
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


window.removeUser = function(index) {

  rfidUsers.splice(index, 1);

  saveData(
    "rfUsers",
    rfidUsers
  );

  renderUsers();
};


if (rfidForm) {

  rfidForm.addEventListener(
    "submit",
    event => {

      event.preventDefault();

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

        uid:
          document
          .getElementById("rfUid")
          .value
          .trim()
          .toUpperCase()

      };


      const existingIndex =
        rfidUsers.findIndex(
          item =>
            item.uid === user.uid
        );


      if (existingIndex >= 0) {

        rfidUsers[existingIndex] =
          user;

      } else {

        rfidUsers.push(user);
      }


      saveData(
        "rfUsers",
        rfidUsers
      );

      renderUsers();

      rfidForm.reset();


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
    () => {

      const uid =
        document
        .getElementById("scanUid")
        .value
        .trim()
        .toUpperCase();


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

      } else {

        scanResult.className =
          "scan-result denied";

        scanResult.textContent =
          "ACCESS DENIED";
      }
    }
  );
}


const clearUsers =
  document.getElementById("clearUsers");


if (clearUsers) {

  clearUsers.addEventListener(
    "click",
    () => {

      if (
        confirm(
          "Clear all local RFID users?"
        )
      ) {

        rfidUsers = [];

        saveData(
          "rfUsers",
          rfidUsers
        );

        renderUsers();

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
