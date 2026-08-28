export const TASK13_SCHEMA_VERSION = "1";
export const PAYMENT_ORDER_TTL_HOURS = 24;
export const PAYMENT_METHODS = Object.freeze([
  Object.freeze({ code: "wechat", name: "微信支付" }),
  Object.freeze({ code: "alipay", name: "支付宝" }),
]);
export const ENTITLEMENT_CODES = Object.freeze([
  "language_english_access",
  "language_japanese_access",
  "language_all_access",
  "tools_access",
  "tools_batch_access",
  "temporary_share_access",
  "save_tool_config",
  "finance_access",
  "all_features_access",
]);
export const PURCHASABLE_PLAN_CODES = Object.freeze([
  "trial_single_language",
  "finance_monthly",
  "dual_language_monthly",
  "tools_monthly",
  "all_access_monthly",
  "japanese_lifetime",
  "all_access_lifetime",
]);
export const COMPATIBLE_PLAN_CODES = Object.freeze([
  ...PURCHASABLE_PLAN_CODES,
  "dual_language_lifetime",
  "legacy_all_monthly",
  "legacy_all_lifetime",
]);
export const PAYMENT_STATUSES = Object.freeze([
  "pending_payment", "user_paid", "processing", "approved",
  "rejected", "cancelled", "expired",
]);
export const QR_VISIBLE_STATUSES = Object.freeze(["pending_payment", "user_paid", "processing"]);
export const OPEN_PAYMENT_STATUSES = Object.freeze(["pending_payment", "user_paid", "processing"]);

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
const ORDER_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const QR_ASSET_PLAN_ALIASES = Object.freeze({
  finance_monthly: "all_access_monthly",
});

export class Task13Error extends Error {
  constructor(message, status = 400, code = "task13_error", retryable = false, committed = false) {
    super(message);
    this.name = "Task13Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.committed = committed;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cleanId(value, label = "记录标识") {
  const text = String(value || "").trim();
  if (!ID_PATTERN.test(text)) throw new Task13Error(`${label}无效`, 400, "identifier_invalid");
  return text;
}

export function cleanOrderNumber(value) {
  const text = String(value || "").trim();
  if (!ORDER_PATTERN.test(text)) throw new Task13Error("订单编号无效", 400, "order_number_invalid");
  return text;
}

export function cleanNote(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

export function safeJsonObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

export function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function normalizePaymentMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  if (!PAYMENT_METHODS.some((item) => item.code === method)) {
    throw new Task13Error("请选择微信支付或支付宝", 400, "payment_method_invalid");
  }
  return method;
}

export function validateTrialLanguage(planCode, value) {
  const language = String(value || "").trim().toLowerCase();
  if (planCode === "trial_single_language") {
    if (!new Set(["english", "japanese"]).has(language)) {
      throw new Task13Error("单语言包月体验必须选择英语或日语", 400, "trial_language_invalid");
    }
    return language;
  }
  return "";
}

export function qrResourceIdFor(paymentMethod, planCode) {
  const method = normalizePaymentMethod(paymentMethod);
  const plan = String(planCode || "").trim();
  if (![...PURCHASABLE_PLAN_CODES, "dual_language_lifetime"].includes(plan)) {
    throw new Task13Error("该套餐未配置收款二维码", 400, "payment_qr_not_configured");
  }
  return `qr-v1:${method}:${plan}`;
}

export function qrObjectKeyFor(paymentMethod, planCode) {
  const resource = qrResourceIdFor(paymentMethod, planCode);
  const [, method, plan] = resource.split(":");
  const assetPlan = QR_ASSET_PLAN_ALIASES[plan] || plan;
  return `payments/qrcodes/v1/${method}_${assetPlan}.png`;
}

export function hasPngSignature(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  return view.byteLength >= PNG_SIGNATURE.byteLength
    && PNG_SIGNATURE.every((byte, index) => view[index] === byte);
}

export function publicPlanPayload(row, entitlementRows = []) {
  const price = Number(row.price_cents || 0) / 100;
  return {
    code: String(row.code || ""),
    name: String(row.name || row.code || ""),
    price_cents: Number(row.price_cents || 0),
    price: Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""),
    currency: String(row.currency || "CNY"),
    lifetime: Boolean(row.lifetime),
    duration_months: Number(row.duration_months || 0),
    purchasable: Boolean(row.purchasable),
    priority: Number(row.priority || 0),
    description: String(row.description || ""),
    entitlements: row.code === "trial_single_language"
      ? []
      : entitlementRows.map((item) => String(item.entitlement_code || item)).filter(Boolean),
  };
}

export function membershipPayload(row, entitlementRows = []) {
  return {
    id: String(row.id || ""),
    user_id: String(row.user_id || ""),
    plan_code: String(row.plan_code || ""),
    plan_name: String(row.plan_name || row.plan_code || ""),
    starts_at: String(row.starts_at || ""),
    expires_at: String(row.expires_at || ""),
    is_lifetime: Boolean(row.is_lifetime),
    status: String(row.status || ""),
    source: String(row.source || ""),
    source_ref: String(row.source_ref || ""),
    created_by: String(row.created_by || ""),
    metadata: safeJsonObject(row.metadata_json),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    priority: Number(row.priority || 0),
    entitlements: entitlementRows.map((item) => String(item.entitlement_code || item)).filter(Boolean),
  };
}

export function paymentOrderPayload(row) {
  return {
    id: String(row.id || ""),
    order_number: String(row.order_number || ""),
    user_id: String(row.user_id || ""),
    username: String(row.username_snapshot || row.username || ""),
    plan_code: String(row.plan_code || ""),
    plan_name: String(row.plan_name_snapshot || row.current_plan_name || row.plan_code || ""),
    amount_cents: Number(row.amount_cents || 0),
    currency: String(row.currency || "CNY"),
    payment_method: String(row.payment_method || ""),
    qr_resource_id: String(row.qr_resource_id || ""),
    trial_language: String(row.trial_language || ""),
    payment_note: String(row.payment_note || ""),
    status: String(row.status || ""),
    requested_at: String(row.requested_at || ""),
    expires_at: String(row.expires_at || ""),
    user_confirmed_at: String(row.user_confirmed_at || ""),
    processing_at: String(row.processing_at || ""),
    handled_at: String(row.handled_at || ""),
    admin_note: String(row.admin_note || ""),
    updated_at: String(row.updated_at || ""),
  };
}

export function requireAllowedFields(payload, allowed, code = "task13_fields_forbidden") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task13Error("请求内容无效", 400, "invalid_json");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task13Error("请求包含不允许的字段", 400, code);
  }
}
