import assert from "node:assert/strict";

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.window = globalThis;
globalThis.location = { pathname: "/" };
globalThis.history = {
  calls: [],
  pushState(_state, _title, path) {
    this.calls.push(["push", path]);
    location.pathname = path;
  },
  replaceState(_state, _title, path) {
    this.calls.push(["replace", path]);
    location.pathname = path;
  },
};
globalThis.localStorage = new MemoryStorage({ vocabSession: "legacy-local" });
globalThis.sessionStorage = new MemoryStorage({ vocabSession: "legacy-session" });

const { APP_ROUTE_MANIFEST, createRouter } = await import("../js/core/router.js");
const {
  ACCOUNT_CACHE_KEY,
  ACCOUNT_SESSION_KEY,
  clearAccountSessionStorage,
  persistAccountSession,
  restoreAccountSession,
} = await import("../js/core/session.js");
const { loadJson, safeStorageSet } = await import("../js/core/storage.js");
const { createApiClient } = await import("../js/core/api.js");

assert(APP_ROUTE_MANIFEST.includes("/tools/:tool_id"));
const visited = [];
const router = createRouter({ onRouteChange: (path) => visited.push(path) });
router.pushRoute("/select");
router.pushRoute("/select");
router.pushRoute("/login", true);
assert.deepEqual(history.calls, [["push", "/select"], ["replace", "/login"]]);
assert.deepEqual(visited, ["/select", "/login"]);

assert.equal(restoreAccountSession(), "legacy-session");
assert.equal(localStorage.getItem(ACCOUNT_SESSION_KEY), "legacy-session");
assert.equal(localStorage.getItem("vocabSession"), null);
assert.equal(sessionStorage.getItem("vocabSession"), null);
assert.equal(persistAccountSession("new-session"), true);
localStorage.setItem(ACCOUNT_CACHE_KEY, "cached-account");
clearAccountSessionStorage();
assert.equal(localStorage.getItem(ACCOUNT_SESSION_KEY), null);
assert.equal(localStorage.getItem(ACCOUNT_CACHE_KEY), null);

assert.deepEqual(loadJson("missing", { ok: true }, new MemoryStorage()), { ok: true });
const storage = new MemoryStorage();
assert.equal(safeStorageSet(storage, "answer", 42), true);
assert.equal(storage.getItem("answer"), "42");

const calls = [];
let sessionExpired = 0;
let membershipPrompted = 0;
globalThis.fetch = async (path, options) => {
  calls.push({ path, options });
  if (path === "/api/private") {
    return { ok: true, status: 200, json: async () => ({ account: { id: "u1" } }) };
  }
  if (path === "/api/membership") {
    return { ok: false, status: 403, json: async () => ({ error: "membership", code: "membership_required" }) };
  }
  return { ok: false, status: 401, json: async () => ({ error: "expired" }) };
};

const client = createApiClient({
  getSession: () => "session-token",
  backendErrorMessage: () => "network unavailable",
  markBackendReachable: () => {},
  markGetReachable: () => {},
  markNetworkFailure: () => {},
  handleSessionExpired: () => { sessionExpired += 1; },
  handleMembershipRequired: () => { membershipPrompted += 1; },
});

assert.deepEqual(await client.apiGet("/api/private"), { account: { id: "u1" } });
assert.equal(calls[0].options.headers["X-Session-Token"], "session-token");
await assert.rejects(client.api("/api/membership"), (error) => error.code === "membership_required");
assert.equal(membershipPrompted, 1);
await assert.rejects(client.api("/api/expired"));
assert.equal(sessionExpired, 1);

console.log("Core JS module tests passed (router, storage, session, API).");
