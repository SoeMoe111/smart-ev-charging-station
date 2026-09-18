import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parsePublicConfig, runChecks, WORKER_ORIGIN } from "../cloudflare-check.mjs";

const HEALTH = { ok: true, service: "smart-ev-relay" };
const TOKEN = "test-only-token-not-a-credential";
const authenticate = async () => ({ token: TOKEN });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("public config parser reads live config without executing RFID imports", async () => {
  const source = await readFile(new URL("../firebase-config.js", import.meta.url), "utf8");
  const config = parsePublicConfig(source);
  assert.equal(config.projectId, "smart-ev-charging-statio-7f04d");
  assert.equal(Object.keys(config).length, 5);
  assert.throws(() => parsePublicConfig(source.replace("projectId:", "missingId:")), /CONFIG_FORMAT_ERROR/);
  assert.throws(() => parsePublicConfig(source.replace('projectId: "smart-ev-charging-statio-7f04d"', 'projectId: "other-project"')), /CONFIG_PROJECT_MISMATCH/);
});

test("successful check makes exactly three GETs and exposes no token or data", async () => {
  const calls = [];
  const result = await runChecks({ authenticate, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    if (url.endsWith("/health")) {
      assert.deepEqual(options.headers, {});
      return json(HEALTH);
    }
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    return json(url.includes("/stations/") ? { slots: { slot1: { private: "do-not-display" } } } : null);
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(call => call.url), [WORKER_ORIGIN + "/health", WORKER_ORIGIN + "/firebase/stations/demo-station.json", WORKER_ORIGIN + "/firebase/bookings.json"]);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(JSON.stringify(result).includes("do-not-display"), false);
});

test("health failure skips authentication and all database requests", async () => {
  let authCalls = 0;
  const result = await runChecks({ authenticate: async () => { authCalls++; }, fetchImpl: async () => { throw new TypeError("network"); } });
  assert.equal(authCalls, 0);
  assert.equal(result.ok, false);
  assert.deepEqual(result.results.map(r => r.status), ["fail", "skip", "skip", "skip"]);
});

test("wrong health response is not treated as a pass", async () => {
  const result = await runChecks({ authenticate, fetchImpl: async () => json({ ok: true, service: "other" }) });
  assert.equal(result.results[0].detail, "WRONG_WORKER_RESPONSE");
});

test("auth failure skips database reads and shows only a safe code", async () => {
  const result = await runChecks({ authenticate: async () => { throw Object.assign(new Error("private " + TOKEN), { code: "auth/network-request-failed" }); }, fetchImpl: async () => json(HEALTH) });
  assert.equal(result.results[1].detail, "auth/network-request-failed");
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(result.results[2].status, "skip");
});

test("auth timeout is bounded", async () => {
  const result = await runChecks({ authenticate: () => new Promise(() => {}), authTimeoutMs: 5, fetchImpl: async () => json(HEALTH) });
  assert.equal(result.results[1].detail, "TIMEOUT");
});

test("missing token cannot send a database request", async () => {
  let calls = 0;
  const result = await runChecks({ authenticate: async () => ({}), fetchImpl: async () => { calls++; return json(HEALTH); } });
  assert.equal(calls, 1);
  assert.equal(result.results[1].detail, "TOKEN_MISSING");
});

for (const status of [401, 403, 502, 504]) {
  test(`HTTP ${status} is a real failure, not a connectivity pass`, async () => {
    const result = await runChecks({ authenticate, fetchImpl: async url => url.endsWith("/health") ? json(HEALTH) : json({ error: "private" }, status) });
    assert.equal(result.ok, false);
    assert.equal(result.results[2].detail, `HTTP_${status}`);
    assert.equal(result.results[3].detail, `HTTP_${status}`);
  });
}

test("missing station data is distinct from an empty bookings list", async () => {
  const result = await runChecks({ authenticate, fetchImpl: async url => url.endsWith("/health") ? json(HEALTH) : json(null) });
  assert.equal(result.results[2].detail, "NO_STATION_DATA");
  assert.equal(result.results[3].status, "pass");
});

test("malformed JSON and wrong database shape cannot pass", async () => {
  const result = await runChecks({ authenticate, fetchImpl: async url => url.endsWith("/health") ? json(HEALTH) : url.includes("/stations/") ? new Response("invalid") : json(123) });
  assert.equal(result.results[2].detail, "INVALID_JSON_RESPONSE");
  assert.equal(result.results[3].detail, "INVALID_DATABASE_RESPONSE");
});

test("request timeout cancels the read", async () => {
  const result = await runChecks({ authenticate, timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("abort")), { once: true })) });
  assert.equal(result.results[0].detail, "TIMEOUT");
});

test("page is opt-in and never executes service/config hotfix modules", async () => {
  const source = await readFile(new URL("../cloudflare-check.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../cloudflare-check.html", import.meta.url), "utf8");
  assert.equal(/import\s+.*from\s+["']\.\/firebase-(config|service)\.js/.test(source), false);
  assert.equal(/signOut\(|signInWithEmail|localStorage\.clear/.test(source), false);
  assert.match(html, /type="button">RUN TEST/);
  assert.match(source, /button\.addEventListener\("click"/);
  assert.equal(/subscribeStation|setInterval|relayRequest/.test(source), false);
});
