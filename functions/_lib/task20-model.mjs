import { Task12Error } from "./task12-model.mjs";

export const TASK20_SCHEMA_VERSION = "1";
export const TASK20_ACCESS_TTL_SECONDS = 15 * 60;
export const TASK20_REFRESH_TTL_SECONDS = 180 * 24 * 60 * 60;
export const TASK20_ACCESS_COOKIE = "__Host-wyj_app_access";
export const TASK20_NATIVE_SESSION_SENTINEL = "__wyj_native_cookie__";

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROTATION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const APP_VERSION_PATTERN = /^[A-Za-z0-9._+()-]{1,40}$/;
const ANDROID_USER_AGENT_PATTERN = /(?:^|\s)thewyj-android\/[A-Za-z0-9._+()-]+(?:\s|$)/i;

export function isTask20AndroidClient(request) {
  return ANDROID_USER_AGENT_PATTERN.test(String(request?.headers?.get("User-Agent") || ""));
}

export function requireTask20AndroidClient(request) {
  if (!isTask20AndroidClient(request)) {
    throw new Task12Error("此接口仅供 thewyj Android App 使用", 403, "task20_android_client_required");
  }
}

export function validateTask20DeviceId(value) {
  const deviceId = String(value || "").trim().toLowerCase();
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new Task12Error("设备标识无效", 400, "app_device_id_invalid");
  }
  return deviceId;
}

export function validateTask20RotationKey(value) {
  const rotationKey = String(value || "").trim();
  if (!ROTATION_KEY_PATTERN.test(rotationKey)) {
    throw new Task12Error("会话刷新标识无效", 400, "app_rotation_key_invalid");
  }
  return rotationKey;
}

export function validateTask20AppVersion(value) {
  const version = String(value || "").trim();
  if (!APP_VERSION_PATTERN.test(version)) {
    throw new Task12Error("App 版本标识无效", 400, "app_version_invalid");
  }
  return version;
}

export function task20SessionSecretConfigured(value) {
  return new TextEncoder().encode(String(value || "")).length >= 32;
}

export function requireTask20SessionSecret(value) {
  const secret = String(value || "");
  if (!task20SessionSecretConfigured(secret)) {
    throw new Task12Error(
      "Android 设备会话 Secret 尚未配置",
      503,
      "task20_session_secret_not_configured",
      true,
    );
  }
  return secret;
}

export function task20AccessCookie(token, maxAge = TASK20_ACCESS_TTL_SECONDS) {
  const safeToken = String(token || "").replace(/[^A-Za-z0-9_-]/g, "");
  const age = Math.max(0, Math.min(TASK20_ACCESS_TTL_SECONDS, Number(maxAge) || 0));
  return `${TASK20_ACCESS_COOKIE}=${safeToken}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`;
}

export function clearTask20AccessCookie() {
  return `${TASK20_ACCESS_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

export function task20TokenFromRequest(request) {
  const supplied = String(request?.headers?.get("X-Session-Token") || "").trim();
  if (supplied && supplied !== TASK20_NATIVE_SESSION_SENTINEL) return supplied;
  const cookie = String(request?.headers?.get("Cookie") || "");
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === TASK20_ACCESS_COOKIE) return rest.join("=").trim();
  }
  return "";
}
