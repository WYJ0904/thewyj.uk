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

const { APP_ROUTE_MANIFEST, createRouter, createNativeNavigation, nativeAppRoute } = await import("../js/core/router.js");
const {
  ACCOUNT_CACHE_KEY,
  ACCOUNT_SESSION_KEY,
  NATIVE_ACCOUNT_SESSION,
  accountSessionHeaders,
  clearAccountSessionStorage,
  isThewyjAndroidApp,
  persistAccountSession,
  requestNativeLogout,
  requestNativeSessionRefresh,
  restoreAccountSession,
} = await import("../js/core/session.js");
const { getSafeStorage, hasStorageWriteFailure, loadJson, safeStorageSet, storageWriteFailure } = await import("../js/core/storage.js");
const { createApiClient, isCanonicalSessionFailure } = await import("../js/core/api.js");
const { mergeChangelogEntries } = await import("../js/core/changelog.js");

assert(APP_ROUTE_MANIFEST.includes("/tools/:tool_id"));
const visited = [];
const router = createRouter({ onRouteChange: (path) => visited.push(path) });
router.pushRoute("/select");
router.pushRoute("/select");
router.pushRoute("/login", true);
assert.deepEqual(history.calls, [["push", "/select"], ["replace", "/login"]]);
assert.deepEqual(visited, ["/select", "/login"]);

for (const path of ["/finance", "/tools/json", "/language/japanese", "/share/file/abc_123", "/account?from=native"]) {
  assert.equal(nativeAppRoute(path, "https://thewyj.uk"), path);
}
for (const path of ["//evil.example/finance", "/api/me", "/app.js", "/unknown", "javascript:alert(1)", "/\\evil.example/finance"]) {
  assert.equal(nativeAppRoute(path, "https://thewyj.uk"), null);
}
const nativeVisited = [], nativeRendered = [];
let releaseRoute;
const blockedRoute = new Promise(resolve => { releaseRoute = resolve; });
const native = createNativeNavigation({
  origin: "https://thewyj.uk",
  pushRoute: path => nativeVisited.push(path),
  renderRoute: async () => { nativeRendered.push(nativeVisited.at(-1)); if (nativeRendered.length === 1) await blockedRoute; },
});
const firstNavigation = native.navigate("/language");
await Promise.resolve();
native.navigate("/tools");
const lastNavigation = native.navigate("/finance");
releaseRoute();
await Promise.all([firstNavigation, lastNavigation]);
assert.deepEqual(nativeRendered, ["/language", "/finance"], "rapid tabs keep the final route without concurrent rendering");
assert.equal(await native.navigate("/api/me"), false);
assert.equal(nativeVisited.length, 2, "native routing cannot call an auth/API endpoint");

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
Object.defineProperty(globalThis, "blockedStorage", {
  configurable: true,
  get() { throw new DOMException("blocked", "SecurityError"); },
});
const blockedStorage = getSafeStorage("blockedStorage");
assert.equal(safeStorageSet(blockedStorage, "session", "in-memory-only"), false);
assert.equal(blockedStorage.getItem("session"), "in-memory-only");
delete globalThis.blockedStorage;
const failingStorage = new MemoryStorage();
failingStorage.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
assert.equal(safeStorageSet(failingStorage, "session", "secret-value"), false);
assert.equal(hasStorageWriteFailure(), true);
assert.deepEqual(storageWriteFailure(), { code: "storage_write_failed", key: "session", name: "SecurityError" });

sessionStorage.setItem("vocabSession", "legacy-preserved");
const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
assert.equal(restoreAccountSession(), "legacy-preserved");
assert.equal(sessionStorage.getItem("vocabSession"), "legacy-preserved");
localStorage.setItem = originalSetItem;

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Mozilla/5.0 Android/36 thewyj-android/1.0.0" },
});
localStorage.setItem(ACCOUNT_SESSION_KEY, "must-not-remain-in-web-storage");
localStorage.setItem("vocabSession", "legacy-must-not-remain");
sessionStorage.setItem("vocabSession", "legacy-session-must-not-remain");
assert.equal(isThewyjAndroidApp(), true);
assert.equal(restoreAccountSession(), NATIVE_ACCOUNT_SESSION);
assert.equal(localStorage.getItem(ACCOUNT_SESSION_KEY), null);
assert.equal(localStorage.getItem("vocabSession"), null);
assert.equal(sessionStorage.getItem("vocabSession"), null);
assert.deepEqual(accountSessionHeaders(NATIVE_ACCOUNT_SESSION), {});
assert.equal(persistAccountSession("never-persist-native-token"), true);
assert.equal(localStorage.getItem(ACCOUNT_SESSION_KEY), null);
assert.equal(requestNativeSessionRefresh("canonical_session_invalid"), true);
assert.equal(location.href, "thewyj://session/refresh?reason=canonical_session_invalid");
assert.equal(requestNativeLogout(), true);
assert.equal(location.href, "thewyj://session/logout");
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Mozilla/5.0 Chrome/140 Safari/537.36" },
});

assert.equal(isCanonicalSessionFailure({ code: "canonical_session_invalid" }), true);
assert.equal(isCanonicalSessionFailure({ code: "authentication_required" }), true);
assert.equal(isCanonicalSessionFailure({ code: "dependency_auth_failed" }), false);

const cloudEntry = {
  version: "2026.08.20",
  build: "cloud-older",
  date: "2026-08-20",
  title: "云端旧版本",
  features: [],
  improvements: [],
  fixes: [],
  security: [],
};
const staticEntry = {
  version: "2026.08.23",
  build: "task14-current",
  date: "2026-08-23",
  title: "当前静态版本",
  features: ["Task 14"],
  improvements: [],
  fixes: [],
  security: [],
};
const mergedEntries = mergeChangelogEntries(
  [cloudEntry, { ...cloudEntry, title: "重复项不应覆盖" }],
  [staticEntry],
);
assert.deepEqual(mergedEntries.map((entry) => entry.build), ["task14-current", "cloud-older"]);
assert.equal(mergedEntries[1].title, "云端旧版本");
assert(Object.isFrozen(mergedEntries));

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
  if (path === "/api/business-401") {
    return { ok: false, status: 401, json: async () => ({ error: "dependency", code: "dependency_auth_failed" }) };
  }
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: "expired", code: "canonical_session_invalid" }),
  };
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
await assert.rejects(client.api("/api/business-401"), (error) => error.code === "dependency_auth_failed");
assert.equal(sessionExpired, 0);
await assert.rejects(client.api("/api/expired"), (error) => error.code === "canonical_session_invalid");
assert.equal(sessionExpired, 1);

calls.length = 0;
const nativeClient = createApiClient({
  getSession: () => NATIVE_ACCOUNT_SESSION,
  backendErrorMessage: () => "network unavailable",
  markBackendReachable: () => {},
  markGetReachable: () => {},
  markNetworkFailure: () => {},
  handleSessionExpired: () => {},
  handleMembershipRequired: () => {},
});
await nativeClient.apiGet("/api/private");
assert.equal(Object.hasOwn(calls[0].options.headers, "X-Session-Token"), false);

console.log("Core JS module tests passed (router, storage, session, API).");
