export const TASK12_SCHEMA_VERSION = "1";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_SESSIONS_PER_USER = 12;
export const MIN_SECRET_LENGTH = 7;
export const LOGIN_AUDIT_RETENTION_DAYS = 90;
export const LOGIN_AUDIT_MAX_RECORDS = 5000;

export class Task12Error extends Error {
  constructor(message, status = 400, code = "account_error", retryable = false) {
    super(message);
    this.name = "Task12Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ");
}

export function validateUsername(username) {
  const value = String(username || "").trim();
  if (!value) throw new Task12Error("用户名不能为空", 400, "username_required");
  if ([...value].length > 40) throw new Task12Error("用户名不能超过 40 个字符", 400, "username_too_long");
  if (/[\r\n\t=\\/]/.test(value)) throw new Task12Error("用户名包含不允许的字符", 400, "username_invalid");
  return value;
}

export function validateSecret(secret) {
  const value = String(secret || "");
  if (!value) throw new Task12Error("登录密钥不能为空", 400, "secret_required");
  if ([...value].length < MIN_SECRET_LENGTH) {
    throw new Task12Error(`登录密钥不能少于 ${MIN_SECRET_LENGTH} 个字符`, 400, "secret_too_short");
  }
  if ([...value].length > 128) throw new Task12Error("登录密钥不能超过 128 个字符", 400, "secret_too_long");
  if (/\r|\n/.test(value)) throw new Task12Error("登录密钥不能包含换行", 400, "secret_invalid");
  return value;
}

export function requireAllowedFields(payload, allowed, code = "account_fields_forbidden") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task12Error("请求内容无效", 400, "invalid_json");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task12Error("请求包含不允许的字段", 400, code);
  }
}

export function clientKind(request) {
  const agent = String(request?.headers?.get("User-Agent") || "").toLowerCase();
  if (/wv|micromessenger|webview/.test(agent)) return "webview";
  if (/android|iphone|ipad|mobile/.test(agent)) return "mobile_browser";
  return "browser";
}

export function loginContext(request) {
  const cf = request?.cf || {};
  return {
    ip_address: String(request?.headers?.get("CF-Connecting-IP") || "").slice(0, 80),
    country: String(cf.country || request?.headers?.get("CF-IPCountry") || "").slice(0, 80),
    region: String(cf.region || cf.regionCode || "").slice(0, 120),
    city: String(cf.city || "").slice(0, 120),
    user_agent: String(request?.headers?.get("User-Agent") || "").slice(0, 400),
    source: "cloudflare_pages",
  };
}

export function accountPayload(row) {
  if (!row) return null;
  const superAdmin = row.role === "super_admin";
  return {
    id: String(row.id),
    username: String(row.username),
    role: String(row.role || "user"),
    membership: superAdmin ? "lifetime" : "free",
    membership_start: "",
    membership_expires: "",
    trial_language: "",
    registered_at: String(row.registered_at || row.created_at || ""),
    last_login_at: String(row.last_login_at || ""),
    banned: Boolean(row.banned),
    permanent_ban: Boolean(row.permanent_ban),
    deleted: Boolean(row.deleted),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    is_super_admin: superAdmin,
    memberships: [],
    entitlements: [],
    membership_summary: {
      label: superAdmin ? "超级管理员" : "普通用户",
      active: superAdmin,
      expires_at: "",
      lifetime: superAdmin,
    },
    tools_access: superAdmin,
    account_source: "cloudflare_d1",
  };
}

export function auditSnapshot(row) {
  if (!row) return {};
  return {
    id: String(row.id || ""),
    username: String(row.username || ""),
    role: String(row.role || "user"),
    banned: Boolean(row.banned),
    permanent_ban: Boolean(row.permanent_ban),
    deleted: Boolean(row.deleted),
    session_version: Number(row.session_version || 1),
    password_scheme: String(row.password_scheme || ""),
  };
}
