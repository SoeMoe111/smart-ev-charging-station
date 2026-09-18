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
const DB_HOST = "smart-ev-charging-statio-7f04d-default-rtdb.asia-southeast1.firebasedatabase.app";

function request(path = "/firebase/bookings.json", options = {}) {
  const { headers = {}, ...rest } = options;
  return new Request(BASE + path, {
    ...rest, headers: { Authorization: `Bearer ${TOKEN}`, ...headers }
  });
}
const mustNotFetch = () => { throw new Error("Unexpected upstream request"); };

test("health is local only and does not claim database health", async () => {
  const response = await handleRequest(new Request(BASE + "/health"), mustNotFetch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "smart-ev-relay" });
});

test("deployed default fetch handler serves root and health", async () => {
  for (const path of ["/", "/health"]) {
    const response = await worker.fetch(new Request(BASE + path));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "smart-ev-relay" });
  }
});

test("deployed default fetch handler rejects database access without a token", async () => {
  const response = await worker.fetch(new Request(BASE + "/firebase/bookings.json"));
  assert.equal(response.status, 401);
});

test("anonymous HTTP requests cannot access database data", async () => {
  const response = await handleRequest(new Request(BASE + "/firebase/bookings.json"), mustNotFetch);
  assert.equal(response.status, 401);
});

test("non-ID-token-shaped Bearer credentials are rejected", async () => {
  const response = await handleRequest(request(undefined, { headers: { Authorization: "Bearer not-a-jwt" } }), mustNotFetch);
  assert.equal(response.status, 401);
});

test("website CORS preflight needs no token", async () => {
  const response = await handleRequest(new Request(BASE + "/firebase/bookings.json", {
    method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" }
  }), mustNotFetch);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.equal(response.headers.get("Access-Control-Max-Age"), "3600");
});

test("unapproved browser origins are rejected", async () => {
  const response = await handleRequest(request(undefined, { headers: { Origin: "https://unapproved.example" } }), mustNotFetch);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("ESP32 requests without Origin preserve the exact station path", async () => {
  const response = await handleRequest(request("/firebase/stations/demo-station/slots/slot1.json"), async (url, options) => {
    const upstream = new URL(url);
    assert.equal(upstream.hostname, DB_HOST);
    assert.equal(upstream.pathname, "/stations/demo-station/slots/slot1.json");
    assert.equal(upstream.searchParams.get("auth"), TOKEN);
    assert.equal(options.method, "GET");
    return new Response('{"updatedAt":123}', { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("browser GET uses caller ID token, strips cookies, and disables caching", async () => {
  const response = await handleRequest(request(undefined, { headers: { Origin: ORIGIN, Cookie: "private-cookie" } }), async (url, options) => {
    assert.equal(new URL(url).searchParams.get("auth"), TOKEN);
    assert.equal(new Headers(options.headers).get("Cookie"), null);
    assert.equal(new Headers(options.headers).get("Authorization"), null);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "manual");
    return new Response('{"booking1":{}}');
  });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(JSON.stringify([...response.headers]).includes(TOKEN), false);
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
  const response = await handleRequest(request("/firebase/bookings/test-only.json", { method: "DELETE" }), async (_url, options) => {
    assert.equal(options.method, "DELETE");
    assert.equal(options.body, undefined);
    return new Response("null");
  });
  assert.equal(response.status, 200);
});

for (const path of ["/firebase/private.json", "/firebase/bookings/%252Fprivate.json", "/firebase/bookings/bad%23key.json", "/firebase/bookings/bad%ZZ.json", "/anything.json"]) {
  test(`unsafe or non-project path rejected: ${path}`, async () => {
    assert.equal((await handleRequest(request(path), mustNotFetch)).status, 404);
  });
}

test("client query cannot override authentication", async () => {
  const response = await handleRequest(request("/firebase/bookings.json?auth=injected"), mustNotFetch);
  assert.equal(response.status, 400);
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

test("duplicate query keys are rejected", async () => {
  assert.equal((await handleRequest(request("/firebase/bookings.json?shallow=true&shallow=false"), mustNotFetch)).status, 400);
});

test("unsupported HTTP method is rejected", async () => {
  assert.equal((await handleRequest(request(undefined, { method: "HEAD" }), mustNotFetch)).status, 405);
});

test("malformed JSON is rejected before reaching Firebase", async () => {
  assert.equal((await handleRequest(request(undefined, { method: "POST", body: "{broken" }), mustNotFetch)).status, 400);
});

test("oversized request is rejected before reaching Firebase", async () => {
  const response = await handleRequest(request(undefined, { method: "PUT", body: JSON.stringify("x".repeat(65536)) }), mustNotFetch);
  assert.equal(response.status, 413);
});

test("Firebase permission denial is forwarded, not bypassed", async () => {
  const response = await handleRequest(request(), async () => new Response('{"error":"Permission denied"}', { status: 403 }));
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

test("upstream timeout returns a bounded generic error", async () => {
  const response = await handleRequest(request(), (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), { timeoutMs: 5 });
  assert.equal(response.status, 504);
});

test("redirects cannot forward an ID token to another host", async () => {
  const response = await handleRequest(request(), async () => new Response(null, { status: 307, headers: { Location: "https://another.example" } }));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Location"), null);
});

test("204 Firebase response remains valid", async () => {
  const response = await handleRequest(request(), async () => new Response(null, { status: 204 }));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("website preparation uses 5-second polling without switching live relay", async () => {
  const source = await readFile(new URL("../firebase-service.js", import.meta.url), "utf8");
  assert.match(source, /const RELAY_POLL_INTERVAL_MS = 5000;/);
  assert.match(source, /https:\/\/smart-ev-firebase-relay\.ldqr-501416499\.chatgpt\.site\/firebase/);
  assert.match(source, /const STATION_ID = "demo-station";/);
});
