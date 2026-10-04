// Read-only preflight for the deployed Smart EV relay.
// Authentication and database traffic both go through the relay so the test
// matches the ESP32 V7 and website network path.
export const RELAY_ORIGIN = "https://smart-ev-firebase-relay.ldqr-501416499.chatgpt.site";
// Keep the old export name so existing offline tests/bookmarks remain compatible.
export const WORKER_ORIGIN = RELAY_ORIGIN;
const LABELS = {
  worker: "Worker",
  auth: "Relay login",
  station: "Station read",
  bookings: "Booking read"
};

function checkError(code) {
  return Object.assign(new Error(code), { code });
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(checkError("TIMEOUT")), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : null;
    } catch {
      throw checkError("INVALID_JSON_RESPONSE");
    }
    if (!response.ok) throw checkError("HTTP_" + response.status);
    return value;
  } catch (error) {
    if (controller.signal.aborted) throw checkError("TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function authenticateFirebase(fetchImpl) {
  const value = await fetchJson(fetchImpl, RELAY_ORIGIN + "/auth/anonymous", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }, 25000);
  return { token: value?.idToken };
}

function safeErrorCode(error) {
  const code = String(error?.code || "");
  if (/^(HTTP_\d{3}|TIMEOUT|INVALID_JSON_RESPONSE|WRONG_WORKER_RESPONSE|AUTH_PROXY_NOT_READY|NO_STATION_DATA|INVALID_DATABASE_RESPONSE|TOKEN_MISSING)$/.test(code)) {
    return code;
  }
  return "NETWORK_OR_CORS_ERROR";
}

export async function runChecks({
  fetchImpl = fetch,
  authenticate = authenticateFirebase,
  onStatus = () => {},
  timeoutMs = 15000,
  authTimeoutMs = 30000
} = {}) {
  const results = [];
  const report = (id, status, detail = "") => {
    const result = { id, status, detail };
    results.push(result);
    onStatus(result);
  };
  const skipAfter = ids => ids.forEach(id =>
    report(id, "skip", "previous check failed"));

  try {
    const health = await fetchJson(fetchImpl, RELAY_ORIGIN + "/health", {}, timeoutMs);
    if (health?.ok !== true || health?.service !== "smart-ev-relay") {
      throw checkError("WRONG_WORKER_RESPONSE");
    }
    if (health?.authProxy !== true) throw checkError("AUTH_PROXY_NOT_READY");
    report("worker", "pass", "HTTP 200 · AUTH PROXY READY");
  } catch (error) {
    report("worker", "fail", safeErrorCode(error));
    skipAfter(["auth", "station", "bookings"]);
    return { ok: false, results };
  }

  let token;
  try {
    const credential = await withTimeout(
      Promise.resolve().then(() => authenticate(fetchImpl)), authTimeoutMs);
    token = credential?.token;
    if (typeof token !== "string" || !token) throw checkError("TOKEN_MISSING");
    report("auth", "pass", "ID token issued through Worker");
  } catch (error) {
    report("auth", "fail", safeErrorCode(error));
    skipAfter(["station", "bookings"]);
    return { ok: false, results };
  }

  for (const [id, path] of [
    ["station", "stations/demo-station"],
    ["bookings", "bookings"]
  ]) {
    try {
      const data = await fetchJson(
        fetchImpl,
        `${RELAY_ORIGIN}/firebase/${path}.json`,
        { headers: { Authorization: `Bearer ${token}` } },
        timeoutMs
      );
      if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
        throw checkError("INVALID_DATABASE_RESPONSE");
      }
      if (id === "station" && data === null) throw checkError("NO_STATION_DATA");
      report(id, "pass", "HTTP 200");
    } catch (error) {
      report(id, "fail", safeErrorCode(error));
    }
  }
  return {
    ok: results.every(result => result.status === "pass"),
    results
  };
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
      const result = await runChecks({
        onStatus: ({ id, status, detail }) => {
          const element = document.getElementById(id);
          element.className = status;
          element.textContent = `${LABELS[id]}: ${status.toUpperCase()}` +
            (detail ? " — " + detail : "");
        }
      });
      summary.textContent = result.ok
        ? "FULL RELAY CHECK PASSED — VPN မလိုဘဲ အသုံးပြုနိုင်ပါတယ်။"
        : "CHECK FAILED — Backup demo ကို အသင့်ထားပါ။";
    } catch {
      summary.textContent = "CHECK FAILED — PAGE ERROR";
    } finally {
      button.disabled = false;
    }
  });
  globalThis.cloudflareCheckReady?.();
}
