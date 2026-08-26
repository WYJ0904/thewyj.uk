let writeFailed = false;
let lastWriteFailure = null;
const storageFacades = new Map();

function recordStorageFailure(key, error) {
  writeFailed = true;
  lastWriteFailure = Object.freeze({
    code: "storage_write_failed",
    key: String(key || "").slice(0, 80),
    name: String(error?.name || "Error").slice(0, 80),
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][Number(index)] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

export function getSafeStorage(name = "localStorage") {
  const storageName = String(name || "localStorage");
  if (storageFacades.has(storageName)) return storageFacades.get(storageName);
  const fallback = memoryStorage();
  let nativeStorage = null;
  let persistent = true;
  try {
    nativeStorage = globalThis[storageName] || null;
    if (!nativeStorage?.getItem || !nativeStorage?.setItem) throw new TypeError("storage_unavailable");
    nativeStorage.getItem("__wyj_storage_probe__");
  } catch (error) {
    persistent = false;
    recordStorageFailure(storageName, error);
  }
  const facade = {
    get __wyjNative() { return nativeStorage; },
    get __wyjPersistent() { return persistent; },
    get length() {
      try { return nativeStorage ? nativeStorage.length : fallback.length; }
      catch (error) { persistent = false; recordStorageFailure(storageName, error); return fallback.length; }
    },
    key(index) {
      try { return nativeStorage ? nativeStorage.key(index) : fallback.key(index); }
      catch (error) { persistent = false; recordStorageFailure(storageName, error); return fallback.key(index); }
    },
    getItem(key) {
      try {
        if (!nativeStorage) return fallback.getItem(key);
        const value = nativeStorage.getItem(key);
        if (value === null) fallback.removeItem(key);
        else fallback.setItem(key, value);
        return value;
      } catch (error) {
        persistent = false;
        recordStorageFailure(key, error);
        return fallback.getItem(key);
      }
    },
    setItem(key, value) {
      fallback.setItem(key, value);
      if (!nativeStorage) return;
      try {
        nativeStorage.setItem(key, value);
        if (nativeStorage.getItem(key) !== String(value)) throw new Error("storage_readback_mismatch");
      } catch (error) {
        persistent = false;
        recordStorageFailure(key, error);
      }
    },
    removeItem(key) {
      fallback.removeItem(key);
      if (!nativeStorage) return;
      try { nativeStorage.removeItem(key); }
      catch (error) { persistent = false; recordStorageFailure(key, error); }
    },
    clear() {
      fallback.clear();
      if (!nativeStorage) return;
      try { nativeStorage.clear(); }
      catch (error) { persistent = false; recordStorageFailure(storageName, error); }
    },
  };
  storageFacades.set(storageName, facade);
  return facade;
}

export function loadJson(key, fallback, storage = null) {
  try {
    const target = storage || getSafeStorage("localStorage");
    return JSON.parse(target.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

export function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, String(value));
    if (storage.getItem(key) !== String(value)) throw new Error("storage_readback_mismatch");
    if (storage?.__wyjPersistent === false) return false;
    return true;
  } catch (error) {
    recordStorageFailure(key, error);
    return false;
  }
}

export function hasStorageWriteFailure() {
  return writeFailed;
}

export function storageWriteFailure() {
  return lastWriteFailure;
}
