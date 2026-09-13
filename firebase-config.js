export const firebaseConfig = {
  apiKey: "AIzaSyBqJzZP0EbNZwo88Vea1tzEQuNfxM3Y59U",
  authDomain: "smart-ev-charging-statio-7f04d.firebaseapp.com",
  databaseURL: "https://smart-ev-charging-statio-7f04d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-ev-charging-statio-7f04d",
  storageBucket: "smart-ev-charging-statio-7f04d.firebasestorage.app",
  messagingSenderId: "875610139503",
  appId: "1:875610139503:web:59cfb32b2dfa1ad342169a",
  measurementId: "G-GY7MZ3SSXG"
};

export const firebaseConfigured = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.databaseURL,
  firebaseConfig.projectId,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId
].every(value => value && !value.startsWith("PASTE_"));

// Load the project-specific RFID owner-only layer after the main module graph
// has finished evaluating. The query string forces GitHub Pages/mobile browsers
// to load the latest RFID code instead of an older cached copy.
setTimeout(() => {
  import("./rfid-owner-mode.js?v=20260913-1528").catch(error => {
    console.error("RFID owner mode could not be loaded", error);
  });
}, 0);
