import { firebaseConfigured } from "./firebase-config.js?v=20261005-shared-poll-v9";

const FIREBASE_RELAY_ORIGIN =
  "https://smart-ev-firebase-relay.ldqr-501416499.chatgpt.site";
const FIREBASE_RELAY_URL = `${FIREBASE_RELAY_ORIGIN}/firebase`;
const FIREBASE_AUTH_URL = `${FIREBASE_RELAY_ORIGIN}/auth`;

// Match the ESP32's 5-second telemetry cadence and leave free-relay quota headroom.
const RELAY_POLL_INTERVAL_MS = 5000;
const RELAY_POLL_MAX_BACKOFF_MS = 60000;

const STATION_ID = "demo-station";
export const ADMIN_UID = "fM6p0sQzQbaqKAmuQFGA6mNolJU2";

const AUTH_STORAGE_KEY = "smartEvFirebaseRelaySessionV1";
const AUTH_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

let currentSession = null;
let refreshPromise = null;
const authListeners = new Set();
const relayPollers = new Map();

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
  if (!currentSession?.idToken) {
    throw new Error("Firebase is not connected.");
  }
}

function requireAuth() {
  if (!currentSession?.idToken) {
    throw new Error("Firebase Authentication is not connected.");
  }
}

function authState(session = currentSession) {
  return {
    uid: session?.uid || "",
    email: session?.email || "",
    isAnonymous: Boolean(session?.isAnonymous),
    isAdmin: session?.uid === ADMIN_UID
  };
}

function notifyAuthState() {
  const state = authState();
  for (const callback of authListeners) {
    queueMicrotask(() => callback(state));
  }
}

function saveSession(session) {
  if (!session) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const value = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (!value || typeof value.idToken !== "string" ||
        typeof value.refreshToken !== "string" ||
        typeof value.uid !== "string" || !Number.isFinite(value.expiresAt)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function commitSession(session) {
  currentSession = session;
  saveSession(session);
  notifyAuthState();
  return session;
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal
    });
    const text = await response.text();
    let value = null;
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("Relay returned invalid data.");
      }
    }
    if (!response.ok) {
      const detail = value?.error || value?.message || `HTTP ${response.status}`;
      throw new Error(`Firebase relay request failed: ${detail}`);
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Firebase relay request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function authRequest(action, body) {
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const value = await fetchJson(`${FIREBASE_AUTH_URL}/${action}`, options);
  if (!value?.idToken || !value?.refreshToken || !value?.localId) {
    throw new Error("Firebase relay returned an incomplete login.");
  }
  return value;
}

function sessionFromAuth(value, previous = {}) {
  const expiresIn = Math.max(300, Number(value.expiresIn) || 3600);
  return {
    idToken: value.idToken,
    refreshToken: value.refreshToken,
    uid: value.localId,
    email: value.email || previous.email || "",
    isAnonymous: Boolean(previous.isAnonymous),
    expiresAt: Date.now() + expiresIn * 1000
  };
}

async function createAnonymousSession() {
  const value = await authRequest("anonymous");
  return sessionFromAuth(value, { isAnonymous: true });
}

async function refreshSession(force = false) {
  requireAuth();
  if (!force && Date.now() < currentSession.expiresAt - AUTH_REFRESH_MARGIN_MS) {
    return currentSession;
  }
  if (!refreshPromise) {
    const previous = currentSession;
    refreshPromise = authRequest("refresh", {
      refreshToken: previous.refreshToken
    }).then(value => commitSession(sessionFromAuth(value, previous)))
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function getIdToken() {
  requireConnection();
  if (Date.now() >= currentSession.expiresAt - AUTH_REFRESH_MARGIN_MS) {
    try {
      await refreshSession(true);
    } catch (error) {
      if (Date.now() >= currentSession.expiresAt) throw error;
    }
  }
  return currentSession.idToken;
}

function relayUrl(path) {
  const normalizedPath = String(path || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return `${FIREBASE_RELAY_URL}/${normalizedPath}.json`;
}

async function relayRequest(path, options = {}) {
  requireConnection();

  const token = await getIdToken();
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  request.signal = controller.signal;
  try {
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Firebase relay request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pollDelay(failureCount) {
  if (failureCount <= 0) return RELAY_POLL_INTERVAL_MS;

  return Math.min(
    RELAY_POLL_INTERVAL_MS * (2 ** Math.min(failureCount, 4)),
    RELAY_POLL_MAX_BACKOFF_MS
  );
}

function notifyRelaySubscriber(subscriber, value) {
  try {
    subscriber.callback(subscriber.transform(value));
  } catch (error) {
    subscriber.errorCallback?.(error);
  }
}

function notifyRelayError(subscriber, error) {
  try {
    subscriber.errorCallback?.(error);
  } catch (callbackError) {
    console.error("Relay subscription error handler failed", callbackError);
  }
}

function createRelayPoller(path) {
  const poller = {
    path,
    subscribers: new Set(),
    timer: null,
    running: false,
    failureCount: 0,
    hasValue: false,
    value: null
  };

  const schedule = delay => {
    if (!poller.subscribers.size) {
      relayPollers.delete(path);
      return;
    }

    poller.timer = setTimeout(poll, delay);
  };

  const poll = async () => {
    if (poller.running || !poller.subscribers.size) return;

    poller.running = true;
    poller.timer = null;

    try {
      const value = await relayRequest(path);
      poller.value = value;
      poller.hasValue = true;
      poller.failureCount = 0;

      for (const subscriber of [...poller.subscribers]) {
        notifyRelaySubscriber(subscriber, value);
      }
    } catch (error) {
      poller.failureCount += 1;

      for (const subscriber of [...poller.subscribers]) {
        notifyRelayError(subscriber, error);
      }
    } finally {
      poller.running = false;
      schedule(pollDelay(poller.failureCount));
    }
  };

  poller.start = () => { void poll(); };
  return poller;
}

function subscribeRelay(path, transform, callback, errorCallback) {
  const subscriber = {
    transform,
    callback,
    errorCallback,
    active: true
  };

  let poller = relayPollers.get(path);
  if (!poller) {
    poller = createRelayPoller(path);
    relayPollers.set(path, poller);
  }

  poller.subscribers.add(subscriber);

  if (poller.hasValue) {
    queueMicrotask(() => {
      if (subscriber.active) {
        notifyRelaySubscriber(subscriber, poller.value);
      }
    });
  } else if (!poller.running && !poller.timer) {
    poller.start();
  }

  return () => {
    if (!subscriber.active) return;

    subscriber.active = false;
    poller.subscribers.delete(subscriber);

    if (!poller.subscribers.size) {
      if (poller.timer) clearTimeout(poller.timer);
      poller.timer = null;
      relayPollers.delete(path);
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

  currentSession = loadSession();
  if (currentSession) {
    try {
      await refreshSession(true);
    } catch (error) {
      if (Date.now() >= currentSession.expiresAt) {
        commitSession(null);
      } else {
        console.warn("Using an unexpired cached Firebase session.", error);
      }
    }
  }
  if (!currentSession) {
    commitSession(await createAnonymousSession());
  }

  return {
    connected: true,
    ...authState()
  };
}

export function subscribeAuthState(callback, errorCallback) {
  requireAuth();
  const guarded = state => {
    try {
      callback(state);
    } catch (error) {
      errorCallback?.(error);
    }
  };
  authListeners.add(guarded);
  queueMicrotask(() => guarded(authState()));
  return () => authListeners.delete(guarded);
}

export async function signInAdmin(email, password) {
  requireAuth();

  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Admin email and password are required.");
  }

  const value = await authRequest("signin", {
    email: normalizedEmail,
    password: normalizedPassword
  });
  if (value.localId !== ADMIN_UID) {
    commitSession(await createAnonymousSession());
    throw new Error("This account is not authorized as the project admin.");
  }
  commitSession(sessionFromAuth(value, {
    email: normalizedEmail,
    isAnonymous: false
  }));
  return authState();
}

export async function signOutAdmin() {
  requireAuth();

  commitSession(null);
  commitSession(await createAnonymousSession());
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
      createdBy: currentSession.uid,
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
      updatedBy: currentSession.uid
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
      createdBy: currentSession.uid
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
