import { getSafeStorage, safeStorageSet } from "./storage.js?v=20260901-task19-production-final";

export const ACCOUNT_SESSION_KEY = "wyjAccountSession";
export const ACCOUNT_CACHE_KEY = "wyjAccountCache";
const LEGACY_SESSION_KEY = "vocabSession";

export function restoreAccountSession() {
  const local = getSafeStorage("localStorage");
  const session = getSafeStorage("sessionStorage");
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
