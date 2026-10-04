// Smart EV relay: Firebase Authentication + Realtime Database transport.
// The Firebase Web API key is supplied as the FIREBASE_API_KEY Worker variable.
// No service-account key, database secret, user password, or refresh token is stored.
const FIREBASE_ORIGIN =
  "https://smart-ev-charging-statio-7f04d-default-rtdb.asia-southeast1.firebasedatabase.app";
const IDENTITY_ORIGIN = "https://identitytoolkit.googleapis.com";
const TOKEN_ORIGIN = "https://securetoken.googleapis.com";
const WEBSITE_ORIGIN = "https://soemoe111.github.io";
const ROOTS = new Set(["bookings", "rfidUsers", "accessEvents", "stations"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const QUERY_KEYS = new Set([
  "orderBy", "startAt", "endAt", "equalTo", "limitToFirst", "limitToLast",
  "shallow", "print"
]);
const MAX_DATABASE_BODY_BYTES = 64 * 1024;
const MAX_AUTH_BODY_BYTES = 8 * 1024;

function responseHeaders(origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  });
  if (origin === WEBSITE_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function errorResponse(status, message, headers) {
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function databasePath(pathname) {
  const prefix = "/firebase/";
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith(prefix) || !decoded.endsWith(".json") ||
      decoded.length > 2048 || /\\|%[0-9a-f]{2}/i.test(decoded)) {
    return null;
  }
  const segments = decoded.slice(prefix.length, -5).split("/");
  if (!ROOTS.has(segments[0]) || segments.some(segment =>
    !segment || /[.#$\[\]\u0000-\u001f\u007f]/.test(segment))) {
    return null;
  }
  return `/${segments.map(encodeURIComponent).join("/")}.json`;
}

async function readBody(request, maximumBytes) {
  const declaredSize = Number(request.headers.get("Content-Length"));
  if (declaredSize > maximumBytes) {
    return { status: 413, error: "Request body is too large." };
  }
  if (!request.body) {
    return { status: 400, error: "A request body is required." };
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      return { status: 413, error: "Request body is too large." };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: 400, error: "Request body is not valid UTF-8." };
  }
}

async function readJsonBody(request, maximumBytes = MAX_DATABASE_BODY_BYTES) {
  const result = await readBody(request, maximumBytes);
  if (result.error) return result;
  try {
    return { body: result.body, value: JSON.parse(result.body) };
  } catch {
    return { status: 400, error: "Request body must be valid JSON." };
  }
}

function safeFirebaseError(value) {
  const code = String(value || "AUTH_REQUEST_FAILED").split(" : ")[0];
  return /^[A-Z0-9_.:-]{1,120}$/.test(code) ? code : "AUTH_REQUEST_FAILED";
}

function normalizedAuthResponse(value, refresh = false) {
  return {
    idToken: refresh ? value.id_token : value.idToken,
    refreshToken: refresh ? value.refresh_token : value.refreshToken,
    expiresIn: refresh ? value.expires_in : value.expiresIn,
    localId: refresh ? value.user_id : value.localId,
    email: refresh ? undefined : value.email
  };
}

async function fetchWithTimeout(upstreamFetch, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await upstreamFetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store"
    });
    if (response.status >= 300 && response.status < 400) {
      throw Object.assign(new Error("Unexpected upstream redirect."), {
        relayCode: "UPSTREAM_REDIRECT"
      });
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Upstream request timed out."), {
        relayCode: "UPSTREAM_TIMEOUT"
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function handleAuth(request, upstreamFetch, headers, {
  firebaseApiKey,
  timeoutMs
}) {
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "3600");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("Allow", "POST, OPTIONS");
    return errorResponse(405, "Method is not allowed.", headers);
  }
  if (!firebaseApiKey) {
    return errorResponse(503, "Relay authentication is not configured.", headers);
  }

  const pathname = new URL(request.url).pathname;
  let upstreamUrl;
  let upstreamBody;
  let contentType;
  let refresh = false;

  if (pathname === "/auth/anonymous") {
    upstreamUrl = `${IDENTITY_ORIGIN}/v1/accounts:signUp?key=${encodeURIComponent(firebaseApiKey)}`;
    upstreamBody = JSON.stringify({ returnSecureToken: true });
    contentType = "application/json";
  } else {
    const parsed = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
    if (parsed.error) return errorResponse(parsed.status, parsed.error, headers);

    if (pathname === "/auth/signin") {
      const email = typeof parsed.value?.email === "string" ? parsed.value.email.trim() : "";
      const password = typeof parsed.value?.password === "string" ? parsed.value.password : "";
      if (!email || email.length > 254 || !password || password.length > 4096) {
        return errorResponse(400, "Email and password are required.", headers);
      }
      upstreamUrl = `${IDENTITY_ORIGIN}/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKey)}`;
      upstreamBody = JSON.stringify({ email, password, returnSecureToken: true });
      contentType = "application/json";
    } else if (pathname === "/auth/refresh") {
      const refreshToken = typeof parsed.value?.refreshToken === "string"
        ? parsed.value.refreshToken : "";
      if (!refreshToken || refreshToken.length > 4096) {
        return errorResponse(400, "A refresh token is required.", headers);
      }
      upstreamUrl = `${TOKEN_ORIGIN}/v1/token?key=${encodeURIComponent(firebaseApiKey)}`;
      upstreamBody = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }).toString();
      contentType = "application/x-www-form-urlencoded";
      refresh = true;
    } else {
      return errorResponse(404, "Relay path is not allowed.", headers);
    }
  }

  try {
    const upstream = await fetchWithTimeout(upstreamFetch, upstreamUrl, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": contentType },
      body: upstreamBody
    }, timeoutMs);
    let value;
    try {
      value = await upstream.json();
    } catch {
      return errorResponse(502, "Authentication service returned invalid data.", headers);
    }
    if (!upstream.ok) {
      return errorResponse(upstream.status,
        safeFirebaseError(value?.error?.message), headers);
    }
    const result = normalizedAuthResponse(value, refresh);
    if (!result.idToken || !result.refreshToken || !result.localId) {
      return errorResponse(502, "Authentication service returned incomplete data.", headers);
    }
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    return errorResponse(error?.relayCode === "UPSTREAM_TIMEOUT" ? 504 : 502,
      error?.relayCode === "UPSTREAM_TIMEOUT"
        ? "Authentication service timed out."
        : "Authentication service is temporarily unreachable.", headers);
  }
}

async function handleDatabase(request, upstreamFetch, headers, path, timeoutMs) {
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("Access-Control-Request-Method");
    if (requestedMethod && !METHODS.has(requestedMethod)) {
      return errorResponse(405, "Method is not allowed.", headers);
    }
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "3600");
    return new Response(null, { status: 204, headers });
  }
  if (!METHODS.has(request.method)) {
    headers.set("Allow", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    return errorResponse(405, "Method is not allowed.", headers);
  }
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i
    .exec(authorization);
  if (!match || match[1].length > 8192) {
    return errorResponse(401, "A Firebase ID token is required.", headers);
  }
  const upstreamUrl = new URL(path, FIREBASE_ORIGIN);
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!QUERY_KEYS.has(key) || upstreamUrl.searchParams.has(key) || value.length > 1024) {
      return errorResponse(400, "Query parameter is not allowed.", headers);
    }
    upstreamUrl.searchParams.set(key, value);
  }
  upstreamUrl.searchParams.set("auth", match[1]);
  let body;
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    const parsed = await readJsonBody(request);
    if (parsed.error) return errorResponse(parsed.status, parsed.error, headers);
    body = parsed.body;
  }
  try {
    const upstream = await fetchWithTimeout(upstreamFetch, upstreamUrl.toString(), {
      method: request.method,
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body
    }, timeoutMs);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return errorResponse(error?.relayCode === "UPSTREAM_TIMEOUT" ? 504 : 502,
      error?.relayCode === "UPSTREAM_TIMEOUT"
        ? "Database request timed out."
        : "Database is temporarily unreachable.", headers);
  }
}

async function handleRequest(request, upstreamFetch = fetch, {
  timeoutMs = 10000,
  firebaseApiKey = ""
} = {}) {
  const origin = request.headers.get("Origin");
  const headers = responseHeaders(origin);
  if (origin && origin !== WEBSITE_ORIGIN) {
    return errorResponse(403, "Website origin is not allowed.", headers);
  }
  const url = new URL(request.url);
  if (["/", "/health"].includes(url.pathname) && request.method === "GET") {
    return new Response(JSON.stringify({
      ok: true,
      service: "smart-ev-relay",
      authProxy: Boolean(firebaseApiKey)
    }), { headers });
  }
  if (url.pathname === "/time" && request.method === "GET") {
    return new Response(JSON.stringify({
      unixTime: Math.floor(Date.now() / 1000)
    }), { headers });
  }
  if (url.pathname.startsWith("/auth/")) {
    return handleAuth(request, upstreamFetch, headers, { firebaseApiKey, timeoutMs });
  }
  const path = databasePath(url.pathname);
  if (!path) return errorResponse(404, "Relay path is not allowed.", headers);
  return handleDatabase(request, upstreamFetch, headers, path, timeoutMs);
}

export default {
  fetch(request, env = {}) {
    return handleRequest(request, fetch, {
      firebaseApiKey: env.FIREBASE_API_KEY || ""
    });
  }
};
