import { getSafeStorage, safeStorageSet } from "./storage.js?v=20260904-task20-android-r1";

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

export function requestNativeSessionRefresh(code = "session_expired") {
  if (!isThewyjAndroidApp()) return false;
  const reason = encodeURIComponent(String(code || "session_expired").slice(0, 80));
  window.location.href = `thewyj://session/refresh?reason=${reason}`;
  return true;
}

export function requestNativeLogout() {
  if (!isThewyjAndroidApp()) return false;
  window.location.href = "thewyj://session/logout";
  return true;
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
