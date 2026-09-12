/**
 * Runtime capability audit (Task 24.2 compatibility).
 *
 * The app is used from desktop browsers, iOS Safari, Android Chrome and the
 * Android WebView, and those runtimes differ in what they implement. Instead of
 * letting a missing API surface as `undefined is not a function` or an
 * unhandled rejection, every capability the app actually relies on is detected
 * once and classified:
 *
 *   REQUIRED                     core path cannot work without it
 *   FALLBACK_AVAILABLE           the app provides an equivalent implementation
 *   NATIVE_BRIDGE                provided by the Android bridge inside the app
 *   OPTIONAL                     feature works without it
 *   UNSUPPORTED                  missing and needs a user-facing error
 *
 * `capabilityProblems()` returns the user-facing messages for anything that is
 * missing without a fallback, so the UI can explain the limitation before the
 * user hits it.
 */

export const CAPABILITY = Object.freeze({
  REQUIRED: "required",
  FALLBACK_AVAILABLE: "fallback-available",
  NATIVE_BRIDGE: "native-bridge",
  OPTIONAL: "optional",
  UNSUPPORTED: "unsupported-with-user-facing-error",
});

export const CAPABILITY_MESSAGE = Object.freeze({
  cryptoRandomUUID: "当前浏览器版本过旧：缺少 crypto.randomUUID，已使用兼容 ID 生成器。",
  cryptoSubtle: "当前浏览器的 WebCrypto 不可用，文件校验与分片上传无法进行；请升级浏览器或改用 thewyj Android 应用。",
  localStorage: "当前浏览器禁用了本地存储，词表与设置无法保存；请关闭无痕模式或允许站点数据。",
  sessionStorage: "当前浏览器禁用了会话存储，登录状态可能无法在标签页间保持。",
  fileApi: "当前浏览器不支持 File/Blob/ArrayBuffer，文件与图片工具不可用。",
  textCodec: "当前浏览器缺少 TextEncoder/TextDecoder，文本与文件工具不可用。",
  audio: "当前浏览器无法播放音频，听写朗读不可用（云端语音仍然可用，只是无法播放）。",
  serviceWorker: "当前浏览器不支持 Service Worker，离线缓存不可用，联网功能不受影响。",
  clipboard: "当前浏览器不允许脚本写入剪贴板，请手动复制。",
  download: "当前浏览器不支持文件下载，请改用其他浏览器或 Android 应用。",
});

export function hasWorkingStorage(globalObject, key) {
  try {
    const storage = globalObject?.[key];
    if (!storage || typeof storage.setItem !== "function") return false;
    const probe = "__wyj_capability_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch (_) {
    return false;
  }
}

export function detectCapabilities(globalObject = globalThis) {
  const navigatorObject = globalObject?.navigator || {};
  const documentObject = globalObject?.document;
  let downloadSupport = false;
  let fileChooser = false;
  try {
    const probe = documentObject?.createElement?.("a");
    downloadSupport = Boolean(probe) && "download" in probe;
    fileChooser = typeof documentObject?.createElement?.("input")?.click === "function";
  } catch (_) {
    downloadSupport = false;
    fileChooser = false;
  }
  return Object.freeze({
    cryptoRandomUUID: typeof globalObject?.crypto?.randomUUID === "function",
    cryptoSubtle: Boolean(globalObject?.crypto?.subtle?.digest),
    localStorage: hasWorkingStorage(globalObject, "localStorage"),
    sessionStorage: hasWorkingStorage(globalObject, "sessionStorage"),
    fileApi: typeof globalObject?.File === "function"
      && typeof globalObject?.Blob === "function"
      && typeof globalObject?.ArrayBuffer === "function",
    textCodec: typeof globalObject?.TextEncoder === "function" && typeof globalObject?.TextDecoder === "function",
    audio: typeof globalObject?.Audio === "function",
    serviceWorker: Boolean(navigatorObject.serviceWorker),
    clipboard: typeof navigatorObject.clipboard?.writeText === "function",
    download: downloadSupport,
    fileChooser,
  });
}

/** Capability → classification for the runtime matrix. */
export function classifyCapabilities(capabilities = {}) {
  const state = (value, fallback, required, optional) => {
    if (value) return required ?? CAPABILITY.REQUIRED;
    if (fallback) return CAPABILITY.FALLBACK_AVAILABLE;
    return optional ? CAPABILITY.OPTIONAL : CAPABILITY.UNSUPPORTED;
  };
  return Object.freeze({
    cryptoRandomUUID: state(capabilities.cryptoRandomUUID, true),
    cryptoSubtle: state(capabilities.cryptoSubtle, false),
    localStorage: state(capabilities.localStorage, false),
    sessionStorage: state(capabilities.sessionStorage, true, CAPABILITY.OPTIONAL, true),
    fileApi: state(capabilities.fileApi, false),
    textCodec: state(capabilities.textCodec, false),
    audio: state(capabilities.audio, true, CAPABILITY.REQUIRED, false),
    serviceWorker: state(capabilities.serviceWorker, true, CAPABILITY.OPTIONAL, true),
    clipboard: state(capabilities.clipboard, true, CAPABILITY.OPTIONAL, true),
    download: state(capabilities.download, false),
    fileChooser: state(capabilities.fileChooser, false),
  });
}

export function capabilityProblems(capabilities = {}) {
  const classification = classifyCapabilities(capabilities);
  return Object.entries(classification)
    .filter(([, value]) => value === CAPABILITY.UNSUPPORTED)
    .map(([key]) => CAPABILITY_MESSAGE[key])
    .filter(Boolean);
}

/**
 * Stable-enough id for non-security purposes (queue ids, guest ids, DOM keys)
 * when `crypto.randomUUID` is missing.
 */
export function fallbackRandomId(globalObject = globalThis) {
  const cryptoObject = globalObject?.crypto;
  if (typeof cryptoObject?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function randomId(globalObject = globalThis) {
  return typeof globalObject?.crypto?.randomUUID === "function"
    ? globalObject.crypto.randomUUID()
    : fallbackRandomId(globalObject);
}

/** Thrown by `requireCapability` so callers can show a real reason. */
export class CapabilityError extends Error {
  constructor(key) {
    super(CAPABILITY_MESSAGE[key] || `当前环境缺少必要能力：${key}`);
    this.name = "CapabilityError";
    this.capability = key;
    this.userMessage = CAPABILITY_MESSAGE[key] || `当前环境缺少必要能力：${key}`;
  }
}

const FALLBACK_KEYS = new Set(["cryptoRandomUUID", "sessionStorage", "serviceWorker", "clipboard"]);

export function requireCapability(key, globalObject = globalThis, capabilities = null) {
  const detected = capabilities || detectCapabilities(globalObject);
  if (detected[key] || FALLBACK_KEYS.has(key)) return true;
  throw new CapabilityError(key);
}
