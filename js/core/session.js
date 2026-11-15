import { getSafeStorage, safeStorageSet } from "./storage.js?release=20261115-aeris-s0-p0-release";

export const ACCOUNT_SESSION_KEY = "wyjAccountSession";
export const ACCOUNT_CACHE_KEY = "wyjAccountCache";
export const NATIVE_ACCOUNT_SESSION = "__wyj_native_cookie__";
const LEGACY_SESSION_KEY = "vocabSession";

export function isThewyjAndroidApp() {
  return /(?:^|\s)thewyj-android\/[A-Za-z0-9._+-]+(?:\s|$)/i.test(String(globalThis.navigator?.userAgent || ""));
}

export function accountSessionHeaders(value) {
  const session = String(value || "").trim();
  return session && session !== NATIVE_ACCOUNT_SESSION ? { "X-Session-Token": session } : {};
}

const NATIVE_BRIDGE_INTERVAL_MS = 60;
const nativeBridgeQueue = [];
let nativeBridgeTimer = null;
let nativeBridgeLastSentAt = 0;

function clearNativeBridgeQueue() {
  nativeBridgeQueue.length = 0;
  if (nativeBridgeTimer) {
    globalThis.clearTimeout?.(nativeBridgeTimer);
    nativeBridgeTimer = null;
  }
}

function flushNativeBridgeQueue() {
  nativeBridgeTimer = null;
  if (!isThewyjAndroidApp() || nativeBridgeQueue.length === 0) {
    nativeBridgeQueue.length = 0;
    return false;
  }
  const nextUrl = nativeBridgeQueue.shift();
  nativeBridgeLastSentAt = Date.now();
  window.location.href = nextUrl;
  if (nativeBridgeQueue.length > 0 && typeof globalThis.setTimeout === "function") {
    nativeBridgeTimer = globalThis.setTimeout(flushNativeBridgeQueue, NATIVE_BRIDGE_INTERVAL_MS);
    if (typeof nativeBridgeTimer?.unref === "function") nativeBridgeTimer.unref();
  }
  return true;
}

export function queueNativeBridgeNavigation(url, options = {}) {
  if (!isThewyjAndroidApp()) return false;
  const target = String(url || "").trim();
  if (!target.startsWith("thewyj://")) return false;
  if (options.clearPending) {
    clearNativeBridgeQueue();
    nativeBridgeLastSentAt = Date.now();
    window.location.href = target;
    return true;
  }
  const now = Date.now();
  if (nativeBridgeQueue.length === 0 && !nativeBridgeTimer && now - nativeBridgeLastSentAt >= NATIVE_BRIDGE_INTERVAL_MS) {
    nativeBridgeLastSentAt = now;
    window.location.href = target;
    return true;
  }
  const channel = target.slice("thewyj://".length).split(/[/?#]/, 1)[0];
  if (channel && nativeBridgeQueue.length > 0) {
    for (let i = nativeBridgeQueue.length - 1; i >= 0; i -= 1) {
      if (nativeBridgeQueue[i].startsWith(`thewyj://${channel}/`) || nativeBridgeQueue[i] === `thewyj://${channel}`) {
        nativeBridgeQueue.splice(i, 1);
      }
    }
  }
  if (target.startsWith("thewyj://session/")) nativeBridgeQueue.unshift(target);
  else nativeBridgeQueue.push(target);
  if (!nativeBridgeTimer && typeof globalThis.setTimeout === "function") {
    const waitMs = Math.max(0, NATIVE_BRIDGE_INTERVAL_MS - (now - nativeBridgeLastSentAt));
    nativeBridgeTimer = globalThis.setTimeout(flushNativeBridgeQueue, waitMs);
    if (typeof nativeBridgeTimer?.unref === "function") nativeBridgeTimer.unref();
  }
  return true;
}

export function requestNativeSessionRefresh(code = "session_expired") {
  if (!isThewyjAndroidApp()) return false;
  const reason = encodeURIComponent(String(code || "session_expired").slice(0, 80));
  return queueNativeBridgeNavigation(`thewyj://session/refresh?reason=${reason}`);
}

export function requestNativeLogout() {
  if (!isThewyjAndroidApp()) return false;
  return queueNativeBridgeNavigation("thewyj://session/logout", { clearPending: true });
}

export function restoreAccountSession() {
  const local = getSafeStorage("localStorage");
  const session = getSafeStorage("sessionStorage");
  if (isThewyjAndroidApp()) {
    session.removeItem(LEGACY_SESSION_KEY);
    local.removeItem(LEGACY_SESSION_KEY);
    local.removeItem(ACCOUNT_SESSION_KEY);
    return NATIVE_ACCOUNT_SESSION;
  }
  const canonical = local.getItem(ACCOUNT_SESSION_KEY) || "";
  const restored = canonical || session.getItem(LEGACY_SESSION_KEY) || local.getItem(LEGACY_SESSION_KEY) || "";
  if (!restored) return "";
  const migrated = Boolean(canonical) || safeStorageSet(local, ACCOUNT_SESSION_KEY, restored);
  if (migrated) {
    session.removeItem(LEGACY_SESSION_KEY);
    local.removeItem(LEGACY_SESSION_KEY);
  }
  return restored;
}

export function persistAccountSession(session) {
  if (isThewyjAndroidApp()) return true;
  return safeStorageSet(getSafeStorage("localStorage"), ACCOUNT_SESSION_KEY, session);
}

export function clearAccountSessionStorage() {
  const session = getSafeStorage("sessionStorage");
  const local = getSafeStorage("localStorage");
  session.removeItem(LEGACY_SESSION_KEY);
  local.removeItem(LEGACY_SESSION_KEY);
  local.removeItem(ACCOUNT_SESSION_KEY);
  local.removeItem(ACCOUNT_CACHE_KEY);
}

export function subscribeAccountSessionChanges(listener) {
  const local = getSafeStorage("localStorage");
  const handler = (event) => {
    if ((!event.storageArea || event.storageArea === local.__wyjNative) && event.key === ACCOUNT_SESSION_KEY) {
      listener(String(event.newValue || ""));
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
