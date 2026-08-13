let writeFailed = false;

export function loadJson(key, fallback, storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

export function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, String(value));
    return true;
  } catch (_) {
    writeFailed = true;
    return false;
  }
}

export function hasStorageWriteFailure() {
  return writeFailed;
}
