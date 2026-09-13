import {
  firebaseConfig,
  firebaseConfigured
} from "./firebase-config.js";

// ============================================================
// SMART EV CHARGING STATION - FIREBASE REST SERVICE
// ============================================================
// This version intentionally does NOT load the Firebase Web SDK from
// www.gstatic.com.  The previous SDK-based version could leave the page in
// WAITING FOR DATA when a mobile network could load GitHub Pages but failed
// to load the Firebase SDK CDN reliably.
//
// Authentication now uses Firebase Auth REST endpoints and Realtime Database
// data is read/written directly over HTTPS.  Live values are refreshed about
// once per second and the last good station snapshot is cached locally so the
// dashboard does not lose its most recent values during a short network drop.

const STATION_ID = "demo-station";
export const ADMIN_UID = "fM6p0sQzQbaqKAmuQFGA6mNolJU2";

const DATABASE_URL = String(firebaseConfig.databaseURL || "")
  .replace(/\/+$/, "");

const AUTH_BASE =
  "https://identitytoolkit.googleapis.com/v1";

const TOKEN_BASE =
  "https://securetoken.googleapis.com/v1";

const SESSION_KEY =
  "smartEvFirebaseRestSessionV1";

const STATION_CACHE_KEY =
  "smartEvLastStationSnapshotV1";

const POLL_INTERVAL_MS = 1200;
const TOKEN_EARLY_REFRESH_MS = 120000;

let session = null;
let refreshPromise = null;
const authListeners = new Set();


// ============================================================
// BASIC HELPERS
// ============================================================

export function normalizeUid(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .match(/.{1,2}/g)
    ?.join(" ") || "";
}

function uidKey(value) {
  return normalizeUid(value)
    .replaceAll(" ", "-");
}

function snapshotList(value) {
  const object = value || {};

  if (
    typeof object !== "object" ||
    Array.isArray(object)
  ) {
    return [];
  }

  return Object.entries(object)
    .map(([id, item]) => ({
      id,
      ...(item && typeof item === "object" ? item : {})
    }));
}

function safeReadStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is optional. Cloud operation must continue even if disabled.
  }
}

function safeRemoveStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function authState(value = session) {
  return {
    uid: value?.uid || "",
    email: value?.email || "",
    isAnonymous: Boolean(value?.isAnonymous),
    isAdmin: value?.uid === ADMIN_UID
  };
}

function notifyAuthListeners() {
  const state = authState();

  authListeners.forEach(callback => {
    try {
      callback(state);
    } catch (error) {
      console.error("Auth listener failed", error);
    }
  });
}

function persistSession() {
  if (!session) {
    safeRemoveStorage(SESSION_KEY);
    return;
  }

  safeWriteStorage(SESSION_KEY, session);
}

function restoreSession() {
  const stored = safeReadStorage(SESSION_KEY);

  if (
    !stored ||
    !stored.refreshToken ||
    !stored.uid
  ) {
    return null;
  }

  return stored;
}

async function readJsonResponse(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return payload;
  }

  const firebaseMessage =
    payload?.error?.message ||
    payload?.error ||
    `HTTP ${response.status}`;

  const error = new Error(String(firebaseMessage));
  error.status = response.status;
  error.payload = payload;
  throw error;
}

function makeSession(authPayload, isAnonymous) {
  const expiresInSeconds =
    Number(authPayload.expiresIn || 3600);

  return {
    idToken: authPayload.idToken || "",
    refreshToken: authPayload.refreshToken || "",
    uid: authPayload.localId || authPayload.user_id || "",
    email: authPayload.email || "",
    isAnonymous: Boolean(isAnonymous),
    expiresAt:
      Date.now() +
      Math.max(60, expiresInSeconds) * 1000
  };
}


// ============================================================
// FIREBASE AUTH REST
// ============================================================

async function createAnonymousSession() {
  const response = await fetch(
    `${AUTH_BASE}/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        returnSecureToken: true
      })
    }
  );

  const payload = await readJsonResponse(response);
  session = makeSession(payload, true);
  persistSession();
  notifyAuthListeners();
  return session;
}

async function createPasswordSession(email, password) {
  const response = await fetch(
    `${AUTH_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: String(email || "").trim(),
        password: String(password || ""),
        returnSecureToken: true
      })
    }
  );

  const payload = await readJsonResponse(response);
  session = makeSession(payload, false);
  persistSession();
  notifyAuthListeners();
  return session;
}

async function refreshSessionToken() {
  if (!session?.refreshToken) {
    return createAnonymousSession();
  }

  const response = await fetch(
    `${TOKEN_BASE}/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken
      })
    }
  );

  const payload = await readJsonResponse(response);

  session = {
    ...session,
    idToken: payload.id_token || payload.idToken || "",
    refreshToken:
      payload.refresh_token ||
      payload.refreshToken ||
      session.refreshToken,
    uid:
      payload.user_id ||
      payload.localId ||
      session.uid,
    expiresAt:
      Date.now() +
      Math.max(60, Number(payload.expires_in || 3600)) * 1000
  };

  persistSession();
  notifyAuthListeners();
  return session;
}

async function ensureValidSession(forceRefresh = false) {
  if (!session) {
    session = restoreSession();
  }

  if (!session) {
    return createAnonymousSession();
  }

  const tokenStillValid =
    session.idToken &&
    session.expiresAt &&
    Date.now() <
      session.expiresAt - TOKEN_EARLY_REFRESH_MS;

  if (!forceRefresh && tokenStillValid) {
    return session;
  }

  if (!refreshPromise) {
    refreshPromise = refreshSessionToken()
      .catch(async error => {
        console.warn(
          "Firebase token refresh failed; creating a new anonymous session.",
          error
        );

        safeRemoveStorage(SESSION_KEY);
        session = null;
        return createAnonymousSession();
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}


// ============================================================
// DATABASE REST
// ============================================================

function databaseUrl(path, token, query = {}) {
  const cleanPath = String(path || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  const params = new URLSearchParams({
    auth: token
  });

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });

  return `${DATABASE_URL}/${cleanPath}.json?${params.toString()}`;
}

async function databaseRequest(
  method,
  path,
  body = undefined,
  query = {},
  retryAuth = true
) {
  await ensureValidSession(false);

  if (!session?.idToken) {
    throw new Error("Firebase Authentication is not connected.");
  }

  const options = {
    method,
    headers: {}
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(
    databaseUrl(path, session.idToken, query),
    options
  );

  if (
    (response.status === 401 || response.status === 403) &&
    retryAuth
  ) {
    await ensureValidSession(true);

    return databaseRequest(
      method,
      path,
      body,
      query,
      false
    );
  }

  return readJsonResponse(response);
}

async function databaseGet(path, query = {}) {
  return databaseRequest(
    "GET",
    path,
    undefined,
    query
  );
}

async function databasePost(path, value) {
  return databaseRequest(
    "POST",
    path,
    value
  );
}

async function databasePut(path, value) {
  return databaseRequest(
    "PUT",
    path,
    value
  );
}

async function databaseDelete(path) {
  return databaseRequest(
    "DELETE",
    path
  );
}

function requireConnection() {
  if (!session?.uid) {
    throw new Error("Firebase is not connected.");
  }
}

function requireAdmin() {
  requireConnection();

  if (session.uid !== ADMIN_UID) {
    throw new Error("This account is not authorized as the project admin.");
  }
}


// ============================================================
// CONNECTION / AUTH PUBLIC API
// ============================================================

export async function connectFirebase() {
  if (!firebaseConfigured) {
    return {
      connected: false,
      reason: "Firebase configuration has not been added yet."
    };
  }

  if (
    !firebaseConfig.apiKey ||
    !DATABASE_URL
  ) {
    return {
      connected: false,
      reason: "Firebase API key or database URL is missing."
    };
  }

  try {
    session = restoreSession();
    await ensureValidSession(false);

    // Small authenticated read proves that both Auth and RTDB are reachable.
    await databaseGet(
      `stations/${STATION_ID}`,
      { shallow: true }
    );

    return {
      connected: true,
      ...authState()
    };
  } catch (error) {
    console.error("Firebase REST connection failed", error);

    return {
      connected: false,
      reason: error?.message || "Firebase connection failed."
    };
  }
}

export function subscribeAuthState(callback, errorCallback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  authListeners.add(callback);

  queueMicrotask(() => {
    try {
      callback(authState());
    } catch (error) {
      errorCallback?.(error);
    }
  });

  return () => {
    authListeners.delete(callback);
  };
}

export async function signInAdmin(email, password) {
  const normalizedEmail =
    String(email || "").trim();

  const normalizedPassword =
    String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Admin email and password are required.");
  }

  const previousSession = session;

  try {
    await createPasswordSession(
      normalizedEmail,
      normalizedPassword
    );

    if (session.uid !== ADMIN_UID) {
      throw new Error(
        "This account is not authorized as the project admin."
      );
    }

    return authState();
  } catch (error) {
    // Never leave a non-admin password account active after a failed admin try.
    session = previousSession;
    persistSession();

    if (!session?.uid) {
      await createAnonymousSession();
    } else {
      notifyAuthListeners();
    }

    throw error;
  }
}

export async function signOutAdmin() {
  safeRemoveStorage(SESSION_KEY);
  session = null;

  await createAnonymousSession();
  return authState();
}


// ============================================================
// RESILIENT LIVE POLLING
// ============================================================

function createPollingSubscription({
  path,
  transform = value => value,
  callback,
  errorCallback,
  cacheKey = ""
}) {
  let stopped = false;
  let inFlight = false;
  let lastSignature = "";
  let lastErrorSignature = "";

  const cachedValue =
    cacheKey ? safeReadStorage(cacheKey) : null;

  if (cachedValue !== null && cachedValue !== undefined) {
    try {
      callback(transform(cachedValue));
      lastSignature = JSON.stringify(cachedValue);
    } catch (error) {
      console.warn("Cached station data could not be rendered", error);
    }
  }

  const poll = async () => {
    if (stopped || inFlight) return;

    inFlight = true;

    try {
      const value = await databaseGet(path);
      const signature = JSON.stringify(value ?? null);

      if (cacheKey) {
        safeWriteStorage(cacheKey, value ?? {});
      }

      if (signature !== lastSignature) {
        lastSignature = signature;
        callback(transform(value));
      }

      lastErrorSignature = "";
    } catch (error) {
      const signature =
        `${error?.status || ""}:${error?.message || error}`;

      if (signature !== lastErrorSignature) {
        lastErrorSignature = signature;
        console.error(`Firebase sync failed for ${path}`, error);
        errorCallback?.(error);
      }
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(
    poll,
    POLL_INTERVAL_MS
  );

  const handleOnline = () => poll();

  if (typeof window !== "undefined") {
    window.addEventListener(
      "online",
      handleOnline
    );
  }

  poll();

  return () => {
    stopped = true;
    clearInterval(timer);

    if (typeof window !== "undefined") {
      window.removeEventListener(
        "online",
        handleOnline
      );
    }
  };
}


// ============================================================
// BOOKINGS
// ============================================================

export function subscribeBookings(callback, errorCallback) {
  requireConnection();

  return createPollingSubscription({
    path: "bookings",
    transform: snapshotList,
    callback,
    errorCallback
  });
}

export async function createBooking(booking) {
  requireConnection();

  return databasePost(
    "bookings",
    {
      ...booking,
      uid: normalizeUid(booking.uid),
      createdAt: Date.now(),
      createdBy: session.uid,
      status: "confirmed"
    }
  );
}

export async function deleteBooking(id) {
  requireConnection();

  return databaseDelete(
    `bookings/${id}`
  );
}

export async function deleteAllBookings() {
  requireAdmin();
  return databaseDelete("bookings");
}


// ============================================================
// RFID USERS
// ============================================================

export function subscribeRfidUsers(callback, errorCallback) {
  requireConnection();

  return createPollingSubscription({
    path: "rfidUsers",
    transform: snapshotList,
    callback,
    errorCallback
  });
}

export async function saveRfidUser(user) {
  requireAdmin();

  const normalizedUid = normalizeUid(user.uid);
  const key = uidKey(normalizedUid);

  if (!key) {
    throw new Error("RFID UID is required.");
  }

  return databasePut(
    `rfidUsers/${key}`,
    {
      ...user,
      uid: normalizedUid,
      active: true,
      updatedAt: Date.now(),
      updatedBy: session.uid
    }
  );
}

export async function deleteRfidUser(id) {
  requireAdmin();
  return databaseDelete(`rfidUsers/${id}`);
}

export async function deleteAllRfidUsers() {
  requireAdmin();
  return databaseDelete("rfidUsers");
}


// ============================================================
// ACCESS EVENTS
// ============================================================

export async function recordAccessEvent({
  uid,
  granted,
  userName = "",
  plate = "",
  source = "website"
}) {
  requireAdmin();

  return databasePost(
    "accessEvents",
    {
      uid: normalizeUid(uid),
      granted: Boolean(granted),
      userName,
      plate,
      source,
      timestamp: Date.now(),
      createdBy: session.uid
    }
  );
}


// ============================================================
// STATION TELEMETRY
// ============================================================

export function subscribeStation(callback, errorCallback) {
  requireConnection();

  return createPollingSubscription({
    path: `stations/${STATION_ID}`,
    transform: value => value || {},
    callback,
    errorCallback,
    cacheKey: STATION_CACHE_KEY
  });
}
