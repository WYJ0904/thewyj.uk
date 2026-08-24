import { safeStorageSet } from "./storage.js?v=20260824-task14-production-r2";

export const ACCOUNT_SESSION_KEY = "wyjAccountSession";
export const ACCOUNT_CACHE_KEY = "wyjAccountCache";
const LEGACY_SESSION_KEY = "vocabSession";

export function restoreAccountSession() {
  const restored = localStorage.getItem(ACCOUNT_SESSION_KEY)
    || sessionStorage.getItem(LEGACY_SESSION_KEY)
    || "";
  if (restored) safeStorageSet(localStorage, ACCOUNT_SESSION_KEY, restored);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  return restored;
}

export function persistAccountSession(session) {
  return safeStorageSet(localStorage, ACCOUNT_SESSION_KEY, session);
}

export function clearAccountSessionStorage() {
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem(ACCOUNT_SESSION_KEY);
  localStorage.removeItem(ACCOUNT_CACHE_KEY);
}
