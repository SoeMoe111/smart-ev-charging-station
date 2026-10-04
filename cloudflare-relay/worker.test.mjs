import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import worker from "./worker.mjs";

// Keep the deployable module default-export-only. Expose its internal handler
// only in this in-memory test copy, so upstream requests can be mocked safely.
const workerSource = await readFile(new URL("./worker.mjs", import.meta.url), "utf8");
const { handleRequest } = await import("data:text/javascript;base64," +
  Buffer.from(workerSource + "\nexport { handleRequest };\n").toString("base64"));

// Structurally JWT-shaped, but NOT a real Firebase credential.
const TOKEN = "eyJ0ZXN0IjoxfQ.eyJzdWIiOiJkZW1vIn0.test-signature";
const ORIGIN = "https://soemoe111.github.io";
const BASE = "https://relay.example";
const API_KEY = "test-public-api-key";
const DB_HOST = "smart-ev-charging-statio-7f04d-default-rtdb.asia-southeast1.firebasedatabase.app";

function request(path = "/firebase/bookings.json", options = {}) {
  const { headers = {}, ...rest } = options;
  return new Request(BASE + path, {
    ...rest, headers: { Authorization: `Bearer ${TOKEN}`, ...headers }
  });
}

function authRequest(path, body, origin = "") {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return new Request(BASE + path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const mustNotFetch = () => { throw new Error("Unexpected upstream request"); };

test("health reports whether auth proxy configuration is present", async () => {
  const plain = await handleRequest(new Request(BASE + "/health"), mustNotFetch);
  assert.deepEqual(await plain.json(), {
    ok: true, service: "smart-ev-relay", authProxy: false
  });
  const configured = await handleRequest(new Request(BASE + "/health"), mustNotFetch, {
    firebaseApiKey: API_KEY
  });
  assert.deepEqual(await configured.json(), {
    ok: true, service: "smart-ev-relay", authProxy: true
  });
});

test("deployed default fetch handler remains safe without a variable", async () => {
  const response = await worker.fetch(new Request(BASE + "/"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authProxy, false);
});

test("time fallback is generated locally without contacting an upstream", async () => {
  const before = Math.floor(Date.now() / 1000);
  const response = await handleRequest(new Request(BASE + "/time"), mustNotFetch);
  const after = Math.floor(Date.now() / 1000);
  assert.equal(response.status, 200);
  const value = (await response.json()).unixTime;
  assert.ok(value >= before && value <= after);
});

test("email/password sign-in is proxied and normalized without logging credentials", async () => {
  const response = await handleRequest(authRequest("/auth/signin", {
    email: "station@example.invalid", password: "not-a-real-password"
  }), async (url, options) => {
    assert.equal(new URL(url).hostname, "identitytoolkit.googleapis.com");
    assert.equal(new URL(url).pathname, "/v1/accounts:signInWithPassword");
    assert.equal(new URL(url).searchParams.get("key"), API_KEY);
    assert.deepEqual(JSON.parse(options.body), {
      email: "station@example.invalid",
      password: "not-a-real-password",
      returnSecureToken: true
    });
    return Response.json({
      idToken: TOKEN,
      refreshToken: "refresh-one",
      expiresIn: "3600",
      localId: "station-uid",
      email: "station@example.invalid"
    });
  }, { firebaseApiKey: API_KEY });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    idToken: TOKEN,
    refreshToken: "refresh-one",
    expiresIn: "3600",
    localId: "station-uid",
    email: "station@example.invalid"
  });
});

test("anonymous sign-in works without a request body", async () => {
  const response = await handleRequest(new Request(BASE + "/auth/anonymous", {
    method: "POST", headers: { Origin: ORIGIN }
  }), async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/accounts:signUp");
    assert.deepEqual(JSON.parse(options.body), { returnSecureToken: true });
    return Response.json({
      idToken: TOKEN,
      refreshToken: "refresh-anon",
      expiresIn: "3600",
      localId: "anonymous-uid"
    });
  }, { firebaseApiKey: API_KEY });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await response.json()).localId, "anonymous-uid");
});

test("refresh token request is converted to Firebase form encoding", async () => {
  const response = await handleRequest(authRequest("/auth/refresh", {
    refreshToken: "refresh-old"
  }), async (url, options) => {
    assert.equal(new URL(url).hostname, "securetoken.googleapis.com");
    assert.equal(new URL(url).pathname, "/v1/token");
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "refresh-old");
    return Response.json({
      id_token: TOKEN,
      refresh_token: "refresh-new",
      expires_in: "3600",
      user_id: "station-uid"
    });
  }, { firebaseApiKey: API_KEY });
  assert.deepEqual(await response.json(), {
    idToken: TOKEN,
    refreshToken: "refresh-new",
    expiresIn: "3600",
    localId: "station-uid"
  });
});

test("auth endpoint needs Worker configuration and valid fields", async () => {
  assert.equal((await handleRequest(authRequest("/auth/signin", {
    email: "x@example.invalid", password: "x"
  }), mustNotFetch)).status, 503);
  assert.equal((await handleRequest(authRequest("/auth/signin", {
    email: "", password: ""
  }), mustNotFetch, { firebaseApiKey: API_KEY })).status, 400);
  assert.equal((await handleRequest(authRequest("/auth/refresh", {
    refreshToken: ""
  }), mustNotFetch, { firebaseApiKey: API_KEY })).status, 400);
});

test("auth errors expose only a bounded Firebase error code", async () => {
  const response = await handleRequest(authRequest("/auth/signin", {
    email: "x@example.invalid", password: "wrong"
  }), async () => Response.json({
    error: { message: "INVALID_LOGIN_CREDENTIALS : private upstream detail" }
  }, { status: 400 }), { firebaseApiKey: API_KEY });
  assert.deepEqual(await response.json(), { error: "INVALID_LOGIN_CREDENTIALS" });
});

test("auth and database CORS preflight need no credentials", async () => {
  for (const path of ["/auth/signin", "/firebase/bookings.json"]) {
    const response = await handleRequest(new Request(BASE + path, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" }
    }), mustNotFetch, { firebaseApiKey: API_KEY });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.match(response.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  }
});

test("unapproved browser origins are rejected", async () => {
  const response = await handleRequest(authRequest("/auth/signin", {
    email: "x@example.invalid", password: "x"
  }, "https://unapproved.example"), mustNotFetch, { firebaseApiKey: API_KEY });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("anonymous HTTP requests cannot access database data", async () => {
  const response = await handleRequest(new Request(BASE + "/firebase/bookings.json"), mustNotFetch);
  assert.equal(response.status, 401);
});

test("ESP32 requests preserve the exact station path and Firebase Rules token", async () => {
  const response = await handleRequest(request("/firebase/stations/demo-station/slots/slot1.json"), async (url, options) => {
    const upstream = new URL(url);
    assert.equal(upstream.hostname, DB_HOST);
    assert.equal(upstream.pathname, "/stations/demo-station/slots/slot1.json");
    assert.equal(upstream.searchParams.get("auth"), TOKEN);
    assert.equal(options.method, "GET");
    return new Response('{"updatedAt":123}', { status: 200 });
  });
  assert.equal(response.status, 200);
});

for (const method of ["POST", "PUT", "PATCH"]) {
  test(`${method} preserves JSON and Firebase server timestamps`, async () => {
    const body = '{"updatedAt":{".sv":"timestamp"}}';
    const response = await handleRequest(request(undefined, { method, body }), async (_url, options) => {
      assert.equal(options.method, method);
      assert.equal(options.body, body);
      return new Response('{"name":"test-only"}');
    });
    assert.equal(response.status, 200);
  });
}

test("DELETE is still authorized by Firebase, with no extra body", async () => {
  const response = await handleRequest(request("/firebase/bookings/test-only.json", {
    method: "DELETE"
  }), async (_url, options) => {
    assert.equal(options.body, undefined);
    return new Response("null");
  });
  assert.equal(response.status, 200);
});

for (const path of [
  "/firebase/private.json",
  "/firebase/bookings/%252Fprivate.json",
  "/firebase/bookings/bad%23key.json",
  "/firebase/bookings/bad%ZZ.json",
  "/anything.json"
]) {
  test(`unsafe or non-project path rejected: ${path}`, async () => {
    assert.equal((await handleRequest(request(path), mustNotFetch)).status, 404);
  });
}

test("client query cannot override authentication", async () => {
  assert.equal((await handleRequest(request("/firebase/bookings.json?auth=injected"), mustNotFetch)).status, 400);
});

test("documented query filters are preserved", async () => {
  const response = await handleRequest(request('/firebase/bookings.json?orderBy=%22date%22&limitToFirst=5'), async url => {
    const upstream = new URL(url);
    assert.equal(upstream.searchParams.get("orderBy"), '"date"');
    assert.equal(upstream.searchParams.get("limitToFirst"), "5");
    return new Response("{}");
  });
  assert.equal(response.status, 200);
});

test("malformed or oversized JSON is rejected before reaching Firebase", async () => {
  assert.equal((await handleRequest(request(undefined, {
    method: "POST", body: "{broken"
  }), mustNotFetch)).status, 400);
  assert.equal((await handleRequest(request(undefined, {
    method: "PUT", body: JSON.stringify("x".repeat(65536))
  }), mustNotFetch)).status, 413);
});

test("Firebase permission denial is forwarded, not bypassed", async () => {
  const response = await handleRequest(request(), async () =>
    new Response('{"error":"Permission denied"}', { status: 403 }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Permission denied" });
});

test("network errors do not expose credentials or upstream URLs", async () => {
  const response = await handleRequest(request(), async url => { throw new Error(url); });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes(TOKEN), false);
  assert.equal(body.includes(DB_HOST), false);
});

test("redirects cannot forward credentials to another host", async () => {
  const response = await handleRequest(request(), async () =>
    new Response(null, { status: 307, headers: { Location: "https://another.example" } }));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Location"), null);
});
