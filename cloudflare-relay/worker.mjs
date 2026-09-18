// Preparation only: deploy and test before changing either client's relay URL.
// No service-account key, database secret, or device password is used here.
const FIREBASE_ORIGIN =
  "https://smart-ev-charging-statio-7f04d-default-rtdb.asia-southeast1.firebasedatabase.app";
const WEBSITE_ORIGIN = "https://soemoe111.github.io";
const ROOTS = new Set(["bookings", "rfidUsers", "accessEvents", "stations"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const QUERY_KEYS = new Set([
  "orderBy", "startAt", "endAt", "equalTo", "limitToFirst", "limitToLast",
  "shallow", "print"
]);
const MAX_BODY_BYTES = 64 * 1024;

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

async function readJsonBody(request) {
  const declaredSize = Number(request.headers.get("Content-Length"));
  if (declaredSize > MAX_BODY_BYTES) {
    return { status: 413, error: "Request body is too large." };
  }
  if (!request.body) {
    return { status: 400, error: "A JSON request body is required." };
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
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
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(body);
    return { body };
  } catch {
    return { status: 400, error: "Request body must be valid JSON." };
  }
}

export async function handleRequest(request, upstreamFetch = fetch,
                                    { timeoutMs = 10000 } = {}) {
  const origin = request.headers.get("Origin");
  const headers = responseHeaders(origin);
  // ESP32 requests do not have Origin. Firebase Rules remain the authorization
  // boundary; this CORS restriction is not a replacement for those Rules.
  if (origin && origin !== WEBSITE_ORIGIN) {
    return errorResponse(403, "Website origin is not allowed.", headers);
  }
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    // Worker health only. This does not check Firebase Auth or RTDB access.
    return new Response(JSON.stringify({ ok: true, service: "smart-ev-relay" }),
                        { headers });
  }
  const path = databasePath(url.pathname);
  if (!path) {
    return errorResponse(404, "Relay path is not allowed.", headers);
  }
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
  for (const [key, value] of url.searchParams) {
    // In particular, do not accept a client-supplied auth/access_token or host.
    if (!QUERY_KEYS.has(key) || upstreamUrl.searchParams.has(key) ||
        value.length > 1024) {
      return errorResponse(400, "Query parameter is not allowed.", headers);
    }
    upstreamUrl.searchParams.set(key, value);
  }
  // Firebase ID tokens authenticate REST requests through auth=, so RTDB
  // evaluates the existing Rules as the original website/device user.
  upstreamUrl.searchParams.set("auth", match[1]);
  let body;
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    let parsed;
    try {
      parsed = await readJsonBody(request);
    } catch {
      return errorResponse(400, "Could not read the request body.", headers);
    }
    if (parsed.error) return errorResponse(parsed.status, parsed.error, headers);
    body = parsed.body;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await upstreamFetch(upstreamUrl.toString(), {
      method: request.method,
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body,
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store"
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return errorResponse(502, "Unexpected database redirect.", headers);
    }
    // Never forward cookies, Authorization, Location, or the upstream URL.
    // There are deliberately no logs containing tokens or request payloads.
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return controller.signal.aborted
      ? errorResponse(504, "Database request timed out.", headers)
      : errorResponse(502, "Database is temporarily unreachable.", headers);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  fetch(request) {
    return handleRequest(request);
  }
};
