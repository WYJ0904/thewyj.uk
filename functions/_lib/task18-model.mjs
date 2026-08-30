export const TASK18_SCHEMA_VERSION = "1";
export const TASK18_BUILD = "2026-08-29-admin-messages";
export const MAX_MESSAGE_TITLE = 120;
export const MAX_MESSAGE_BODY = 4000;
export const MAX_MESSAGE_RECIPIENTS = 100;
export const MAX_MESSAGE_LIFETIME_DAYS = 365;

export const MESSAGE_TYPES = Object.freeze(["normal", "important", "maintenance", "account"]);
export const MESSAGE_SCOPES = Object.freeze(["single", "multiple", "all"]);

export const ADMIN_ROLE_POLICY = Object.freeze({
  super_admin: Object.freeze([
    "admin_roles_manage", "admin_roles_view", "users_manage", "payments_manage",
    "memberships_manage", "content_manage", "messages_manage", "operations_view",
  ]),
  admin: Object.freeze([
    "users_manage", "payments_manage", "memberships_manage", "content_manage",
    "messages_manage", "operations_view",
  ]),
});

export class Task18Error extends Error {
  constructor(message, status = 400, code = "task18_invalid_request", retryable = false) {
    super(message);
    this.name = "Task18Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function requireAllowedFields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task18Error("请求 JSON 格式无效", 400, "invalid_json");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task18Error("请求包含不允许的字段", 400, "task18_fields_forbidden");
  }
}

export function cleanUserId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Task18Error("用户标识无效", 400, "user_id_invalid");
  }
  return text;
}

export function cleanMessageId(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new Task18Error("消息标识无效", 400, "message_id_invalid");
  }
  return text;
}

function plainText(value, label, minimum, maximum) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim();
  if (text.length < minimum || text.length > maximum) {
    throw new Task18Error(`${label}长度无效`, 400, `${label === "标题" ? "message_title" : "message_body"}_invalid`);
  }
  return text;
}

export function cleanMessageTitle(value) {
  return plainText(value, "标题", 1, MAX_MESSAGE_TITLE).replace(/\s+/gu, " ");
}

export function cleanMessageBody(value) {
  return plainText(value, "正文", 1, MAX_MESSAGE_BODY);
}

export function cleanMessageType(value) {
  const type = String(value || "normal").trim().toLowerCase();
  if (!MESSAGE_TYPES.includes(type)) throw new Task18Error("消息类型无效", 400, "message_type_invalid");
  return type;
}

export function cleanMessageScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  if (!MESSAGE_SCOPES.includes(scope)) throw new Task18Error("消息目标范围无效", 400, "message_scope_invalid");
  return scope;
}

export function cleanIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,120}$/.test(key)) {
    throw new Task18Error("消息幂等标识无效", 400, "idempotency_key_invalid");
  }
  return key;
}

export function cleanExpiry(value, now = new Date()) {
  const text = String(value || "").trim();
  if (!text) return "";
  const milliseconds = Date.parse(text);
  const maximum = now.getTime() + MAX_MESSAGE_LIFETIME_DAYS * 86400 * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= now.getTime() || milliseconds > maximum) {
    throw new Task18Error("消息到期时间无效", 400, "message_expiry_invalid");
  }
  return isoNow(new Date(milliseconds));
}

export function messagePayload(row) {
  return {
    id: String(row.id || ""),
    title: String(row.title || ""),
    body: String(row.body || ""),
    type: String(row.message_type || "normal"),
    sender_label: "thewyj 管理员通知",
    created_at: String(row.created_at || ""),
    expires_at: String(row.expires_at || ""),
    requires_confirmation: Boolean(row.requires_confirmation),
    status: String(row.status || "active"),
    target_scope: String(row.target_scope || ""),
  };
}

export function safeAuditJson(value) {
  const text = JSON.stringify(value && typeof value === "object" ? value : {});
  return text.length <= 12000 ? text : JSON.stringify({ truncated: true });
}
