import {
  firebaseConfig,
  firebaseConfigured
} from "./firebase-config.js";

const FIREBASE_VERSION = "12.18.0";
const FIREBASE_CDN =
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const FIREBASE_RELAY_URL =
  "https://smart-ev-firebase-relay.ldqr-501416499.chatgpt.site/firebase";

// Match the ESP32's 5-second telemetry cadence and leave free-relay quota headroom.
const RELAY_POLL_INTERVAL_MS = 5000;

const STATION_ID = "demo-station";
export const ADMIN_UID = "fM6p0sQzQbaqKAmuQFGA6mNolJU2";

let authSdk;
let auth;
let currentUser;

export function normalizeUid(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .match(/.{1,2}/g)
    ?.join(" ") || "";
}

function uidKey(value) {
  return normalizeUid(value).replaceAll(" ", "-");
}

function snapshotList(value) {
  value = value || {};

  return Object.entries(value).map(([id, item]) => ({
    id,
    ...item
  }));
}

function requireConnection() {
  if (!auth || !currentUser) {
    throw new Error("Firebase is not connected.");
  }
}

function requireAuth() {
  if (!auth || !authSdk) {
    throw new Error("Firebase Authentication is not connected.");
  }
}

function authState(user = currentUser) {
  return {
    uid: user?.uid || "",
    email: user?.email || "",
    isAnonymous: Boolean(user?.isAnonymous),
    isAdmin: user?.uid === ADMIN_UID
  };
}

function waitForInitialAuthState() {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};

    unsubscribe = authSdk.onAuthStateChanged(
      auth,
      user => {
        unsubscribe();
        resolve(user);
      },
      reject
    );
  });
}

function relayUrl(path) {
  const normalizedPath = String(path || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return `${FIREBASE_RELAY_URL}/${normalizedPath}.json`;
}

async function relayRequest(path, options = {}) {
  requireConnection();

  const token = await currentUser.getIdToken();
  const method = options.method || "GET";
  const headers = {
    Authorization: `Bearer ${token}`
  };

  const request = {
    method,
    headers,
    cache: "no-store"
  };

  if (Object.hasOwn(options, "body")) {
    headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(options.body);
  }

  const response = await fetch(relayUrl(path), request);
  const responseText = await response.text();
  let result = null;

  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      result = responseText;
    }
  }

  if (!response.ok) {
    const detail = typeof result === "object"
      ? result?.error || result?.message
      : result;

    throw new Error(
      `Firebase relay request failed (HTTP ${response.status})` +
      (detail ? `: ${detail}` : "")
    );
  }

  return result;
}

function subscribeRelay(path, transform, callback, errorCallback) {
  let active = true;
  let timer = null;

  const poll = async () => {
    try {
      const value = await relayRequest(path);

      if (active) {
        callback(transform(value));
      }
    } catch (error) {
      if (active) {
        errorCallback?.(error);
      }
    } finally {
      if (active) {
        timer = setTimeout(poll, RELAY_POLL_INTERVAL_MS);
      }
    }
  };

  poll();

  return () => {
    active = false;

    if (timer) {
      clearTimeout(timer);
    }
  };
}

export async function connectFirebase() {
  if (!firebaseConfigured) {
    return {
      connected: false,
      reason: "Firebase configuration has not been added yet."
    };
  }

  const [appSdk, loadedAuthSdk] =
    await Promise.all([
      import(`${FIREBASE_CDN}/firebase-app.js`),
      import(`${FIREBASE_CDN}/firebase-auth.js`)
    ]);

  authSdk = loadedAuthSdk;

  const app = appSdk.initializeApp(firebaseConfig);

  auth = authSdk.getAuth(app);

  await authSdk.setPersistence(
    auth,
    authSdk.browserLocalPersistence
  );

  currentUser = await waitForInitialAuthState();

  if (!currentUser) {
    const credential = await authSdk.signInAnonymously(auth);
    currentUser = credential.user;
  }

  return {
    connected: true,
    ...authState()
  };
}

export function subscribeAuthState(callback, errorCallback) {
  requireAuth();

  return authSdk.onAuthStateChanged(
    auth,
    user => {
      currentUser = user;
      callback(authState(user));
    },
    errorCallback
  );
}

export async function signInAdmin(email, password) {
  requireAuth();

  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Admin email and password are required.");
  }

  const credential = await authSdk.signInWithEmailAndPassword(
    auth,
    normalizedEmail,
    normalizedPassword
  );

  if (credential.user.uid !== ADMIN_UID) {
    await authSdk.signOut(auth);
    const anonymousCredential =
      await authSdk.signInAnonymously(auth);
    currentUser = anonymousCredential.user;
    throw new Error("This account is not authorized as the project admin.");
  }

  currentUser = credential.user;
  return authState();
}

export async function signOutAdmin() {
  requireAuth();

  await authSdk.signOut(auth);

  const credential = await authSdk.signInAnonymously(auth);
  currentUser = credential.user;

  return authState();
}

export function subscribeBookings(callback, errorCallback) {
  requireConnection();

  return subscribeRelay(
    "bookings",
    snapshotList,
    callback,
    errorCallback
  );
}

export async function createBooking(booking) {
  requireConnection();

  await relayRequest("bookings", {
    method: "POST",
    body: {
      ...booking,
      uid: normalizeUid(booking.uid),
      createdAt: { ".sv": "timestamp" },
      createdBy: currentUser.uid,
      status: "confirmed"
    }
  });
}

export async function deleteBooking(id) {
  requireConnection();

  await relayRequest(`bookings/${id}`, {
    method: "DELETE"
  });
}

export async function deleteAllBookings() {
  requireConnection();

  await relayRequest("bookings", {
    method: "DELETE"
  });
}

export function subscribeRfidUsers(callback, errorCallback) {
  requireConnection();

  return subscribeRelay(
    "rfidUsers",
    snapshotList,
    callback,
    errorCallback
  );
}

export async function saveRfidUser(user) {
  requireConnection();

  const normalizedUid = normalizeUid(user.uid);
  const key = uidKey(normalizedUid);

  if (!key) {
    throw new Error("RFID UID is required.");
  }

  await relayRequest(`rfidUsers/${key}`, {
    method: "PUT",
    body: {
      name: String(user.name || "").trim(),
      uid: normalizedUid,
      active: true,
      updatedAt: { ".sv": "timestamp" },
      updatedBy: currentUser.uid
    }
  });
}

export async function deleteRfidUser(id) {
  requireConnection();

  await relayRequest(`rfidUsers/${id}`, {
    method: "DELETE"
  });
}

export async function deleteAllRfidUsers() {
  requireConnection();

  await relayRequest("rfidUsers", {
    method: "DELETE"
  });
}

export async function recordAccessEvent({
  uid,
  granted,
  userName = "",
  plate = "",
  source = "website"
}) {
  requireConnection();

  await relayRequest("accessEvents", {
    method: "POST",
    body: {
      uid: normalizeUid(uid),
      granted,
      userName,
      plate,
      source,
      timestamp: { ".sv": "timestamp" },
      createdBy: currentUser.uid
    }
  });
}

export function subscribeStation(callback, errorCallback) {
  requireConnection();

  return subscribeRelay(
    `stations/${STATION_ID}`,
    value => value || {},
    callback,
    errorCallback
  );
}
