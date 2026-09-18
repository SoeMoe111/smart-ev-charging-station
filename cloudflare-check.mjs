// One-shot, read-only RTDB preflight. Do not import firebase-config.js directly:
// it also imports RFID hotfix modules that are not needed for diagnostics.
export const WORKER_ORIGIN = "https://smart-ev-firebase-relay.smoe49262.workers.dev";
const PROJECT_ID = "smart-ev-charging-statio-7f04d";
const DATABASE_URL = "https://smart-ev-charging-statio-7f04d-default-rtdb.asia-southeast1.firebasedatabase.app";
const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/12.18.0";
const LABELS = { worker: "Worker", auth: "Firebase login", station: "Station read", bookings: "Booking read" };

function checkError(code) {
  return Object.assign(new Error(code), { code });
}

export function parsePublicConfig(source) {
  const config = {};
  for (const key of ["apiKey", "authDomain", "databaseURL", "projectId", "appId"]) {
    const match = source.match(new RegExp("\\b" + key + ':\\s*("(?:[^"\\\\]|\\\\.)*")'));
    if (!match) throw checkError("CONFIG_FORMAT_ERROR");
    config[key] = JSON.parse(match[1]);
  }
  if (config.projectId !== PROJECT_ID ||
      config.databaseURL.replace(/\/+$/, "") !== DATABASE_URL ||
      config.authDomain !== PROJECT_ID + ".firebaseapp.com" ||
      !config.apiKey || !config.appId) throw checkError("CONFIG_PROJECT_MISMATCH");
  return config;
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(checkError("TIMEOUT")), ms); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(fetchImpl, url, headers = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET", headers, cache: "no-store", redirect: "error", signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw checkError("HTTP_" + response.status);
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw checkError("TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(fetchImpl, url, headers = {}, timeoutMs) {
  const text = await fetchText(fetchImpl, url, headers, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw checkError("INVALID_JSON_RESPONSE");
  }
}

let userPromise;
async function authenticateFirebase(fetchImpl) {
  if (!userPromise) {
    userPromise = (async () => {
      // Read only the public string-valued configuration. Never execute it.
      const source = await fetchText(fetchImpl, "./firebase-config.js");
      const config = parsePublicConfig(source);
      const [appSdk, authSdk] = await Promise.all([
        import(`${FIREBASE_CDN}/firebase-app.js`),
        import(`${FIREBASE_CDN}/firebase-auth.js`)
      ]);
      const app = appSdk.getApps().find(app => app.name === "[DEFAULT]") || appSdk.initializeApp(config);
      const auth = authSdk.getAuth(app);
      await auth.authStateReady();
      // Preserve an existing user/admin session. Never sign out or change it.
      return auth.currentUser || (await authSdk.signInAnonymously(auth)).user;
    })();
    userPromise.catch(() => { userPromise = undefined; });
  }
  const user = await userPromise;
  // Force refresh so cached credentials do not falsely prove Auth connectivity.
  return { token: await user.getIdToken(true) };
}

function safeErrorCode(error) {
  const code = String(error?.code || "");
  if (/^(auth\/[a-z-]+|HTTP_\d{3}|TIMEOUT|CONFIG_FORMAT_ERROR|CONFIG_PROJECT_MISMATCH|INVALID_JSON_RESPONSE|WRONG_WORKER_RESPONSE|NO_STATION_DATA|INVALID_DATABASE_RESPONSE|TOKEN_MISSING)$/.test(code)) return code;
  return "NETWORK_OR_CORS_ERROR";
}

export async function runChecks({ fetchImpl = fetch, authenticate = authenticateFirebase, onStatus = () => {}, timeoutMs = 15000, authTimeoutMs = 25000 } = {}) {
  const results = [];
  const report = (id, status, detail = "") => {
    const result = { id, status, detail };
    results.push(result);
    onStatus(result);
  };
  const skipAfter = ids => ids.forEach(id => report(id, "skip", "previous check failed"));
  try {
    const health = await fetchJson(fetchImpl, WORKER_ORIGIN + "/health", {}, timeoutMs);
    if (health?.ok !== true || health?.service !== "smart-ev-relay") throw checkError("WRONG_WORKER_RESPONSE");
    report("worker", "pass", "HTTP 200");
  } catch (error) {
    report("worker", "fail", safeErrorCode(error));
    skipAfter(["auth", "station", "bookings"]);
    return { ok: false, results };
  }
  let token;
  try {
    const credential = await withTimeout(Promise.resolve().then(() => authenticate(fetchImpl)), authTimeoutMs);
    token = credential?.token;
    if (typeof token !== "string" || !token) throw checkError("TOKEN_MISSING");
    report("auth", "pass", "ID token refreshed");
  } catch (error) {
    report("auth", "fail", safeErrorCode(error));
    skipAfter(["station", "bookings"]);
    return { ok: false, results };
  }
  for (const [id, path] of [["station", "stations/demo-station"], ["bookings", "bookings"]]) {
    try {
      const data = await fetchJson(fetchImpl, `${WORKER_ORIGIN}/firebase/${path}.json`, {
        Authorization: `Bearer ${token}`
      }, timeoutMs);
      if (data !== null && (typeof data !== "object" || Array.isArray(data))) throw checkError("INVALID_DATABASE_RESPONSE");
      if (id === "station" && data === null) throw checkError("NO_STATION_DATA");
      report(id, "pass", "HTTP 200");
    } catch (error) {
      report(id, "fail", safeErrorCode(error));
    }
  }
  return { ok: results.every(result => result.status === "pass"), results };
}

if (typeof document !== "undefined") {
  const button = document.getElementById("run");
  const summary = document.getElementById("summary");
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    summary.textContent = "စစ်နေပါတယ်…";
    for (const [id, label] of Object.entries(LABELS)) {
      const element = document.getElementById(id);
      element.className = "";
      element.textContent = label + ": CHECKING…";
    }
    try {
      const result = await runChecks({ onStatus: ({ id, status, detail }) => {
        const element = document.getElementById(id);
        element.className = status;
        element.textContent = `${LABELS[id]}: ${status.toUpperCase()}${detail ? " — " + detail : ""}`;
      } });
      summary.textContent = result.ok ? "READ CHECK PASSED — ဒီ network ကနေ ဖတ်နိုင်ပါတယ်။" : "CHECK FAILED — FAIL ပြတဲ့လိုင်းကို ပြောပေးပါ။";
    } catch {
      summary.textContent = "CHECK FAILED — PAGE ERROR";
    } finally {
      button.disabled = false;
    }
  });
  globalThis.cloudflareCheckReady?.();
}
