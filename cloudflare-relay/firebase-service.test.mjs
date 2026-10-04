import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../firebase-service.js", import.meta.url), "utf8");

test("website no longer depends on direct Firebase Auth or the blocked Worker", () => {
  assert.doesNotMatch(source, /firebase-auth\.js|signInAnonymously|signInWithEmailAndPassword/);
  assert.doesNotMatch(source, /identitytoolkit|securetoken|smoe49262\.workers\.dev/);
  assert.match(source, /smart-ev-firebase-relay\.ldqr-501416499\.chatgpt\.site/);
  assert.match(source, /\/auth\/|FIREBASE_AUTH_URL/);
});

test("website can sign in anonymously and read through one Worker path", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/anonymous")) {
      return Response.json({
        idToken: "header.payload.signature",
        refreshToken: "refresh-test",
        expiresIn: "3600",
        localId: "anonymous-test"
      });
    }
    if (String(url).endsWith("/firebase/bookings.json")) {
      assert.equal(options.headers.Authorization,
        "Bearer header.payload.signature");
      return Response.json({ booking: { driver: "Test" } });
    }
    throw new Error("Unexpected URL " + url);
  };

  const runnable = source.replace(
    'import { firebaseConfigured } from "./firebase-config.js";',
    "const firebaseConfigured = true;"
  );
  const service = await import("data:text/javascript;base64," +
    Buffer.from(runnable + "\n// test-instance\n").toString("base64"));

  const connected = await service.connectFirebase();
  assert.equal(connected.connected, true);
  assert.equal(connected.isAnonymous, true);

  const snapshots = [];
  const unsubscribe = service.subscribeBookings(value => snapshots.push(value));
  await new Promise(resolve => setTimeout(resolve, 20));
  unsubscribe();

  assert.equal(snapshots[0][0].id, "booking");
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    "/auth/anonymous",
    "/firebase/bookings.json"
  ]);
  assert.equal(calls.some(call => /googleapis|firebaseio/.test(call.url)), false);
});
