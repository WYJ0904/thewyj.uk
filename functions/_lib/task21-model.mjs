/** Client ingest protocol version (Android payloads send this value). */
export const TASK21_SCHEMA_VERSION = "1";
/** Local D1 schema version; bumped by cloudflare/migrations/0020. */
export const TASK21_DB_SCHEMA_VERSION = "2";
export const TASK21_BUILD = "2026-09-08-task21-notification";
export const NOTIFICATION_ENTITLEMENT = "notification_archive_access";
export const MAX_INGEST_OPERATIONS = 100;
export const MAX_EVENT_PAGE = 100;

// High-confidence structured events may become finance transactions directly;
// anything below this stays a review candidate and never affects statistics.
export const AUTO_INGEST_CONFIDENCE_MILLI = 900;
export const CANDIDATE_CONFIDENCE_MILLI = 700;

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PACKAGE_PATTERN = /^[\p{L}\p{N}._-]{1,160}$/u;

export const SOURCE_TYPES = Object.freeze(["notification", "sms", "accessibility"]);
export const EVENT_TYPES = Object.freeze(["transaction", "refund", "marketing", "verification", "other"]);
export const PARSE_STATUSES = Object.freeze(["parsed", "candidate", "unparsed"]);
export const DIRECTIONS = Object.freeze(["income", "expense", "refund"]);
export const PAYMENT_CHANNELS = Object.freeze(["", "wechat", "alipay", "bank_card", "other"]);
export const CANDIDATE_STATUSES = Object.freeze(["pending", "confirmed", "rejected"]);

// Raw notification content fields are a hard privacy boundary. If a client
// sends any of these the request is rejected outright, not silently dropped.
export const FORBIDDEN_RAW_FIELDS = Object.freeze([
  "title", "text", "body", "big_text", "bigText", "sub_text", "subText",
  "ticker", "message", "extras", "raw_text", "notification_body", "content",
  "summary", "messaging_style",
]);

const ALLOWED_EVENT_FIELDS = Object.freeze(new Set([
  "event_id", "fingerprint", "source_package", "source_type",
  "event_type", "parser_version", "parse_status", "direction", "amount_minor",
  "currency", "payment_channel", "merchant", "counterparty", "confidence",
  "occurred_at_ms", "received_at_ms",
]));

export class Task21Error extends Error {
  constructor(message, status = 400, code = "task21_error", retryable = false, details = undefined) {
    super(message);
    this.name = "Task21Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cleanId(value, label = "记录标识") {
  const text = String(value || "").trim();
  if (!SAFE_ID_PATTERN.test(text)) throw new Task21Error(`${label}无效`, 400, "identifier_invalid");
  return text;
}

export function cleanText(value, maximum, label = "文本") {
  const text = String(value || "").trim();
  if (text.length > maximum) throw new Task21Error(`${label}过长`, 400, "text_too_long");
  return text;
}

export function cleanCurrency(value = "CNY") {
  const currency = String(value || "CNY").trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new Task21Error("币种无效", 400, "currency_invalid");
  return currency;
}

export function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Task21Error(`${label}无效`, 400, "number_invalid");
  }
  return parsed;
}

export function nonNegativeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Task21Error(`${label}无效`, 400, "number_invalid");
  }
  return parsed;
}

export function requireAllowedFields(payload, allowed, code = "task21_fields_forbidden") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task21Error("请求内容无效", 400, "invalid_json");
  }
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_RAW_FIELDS.includes(key)) {
      throw new Task21Error("请求包含禁止的原始通知内容字段", 400, "raw_notification_content_forbidden");
    }
    if (!allowed.has(key)) {
      throw new Task21Error("请求包含不允许的字段", 400, code);
    }
  }
}

export function normalizeNotificationEvent(value = {}) {
  requireAllowedFields(value, ALLOWED_EVENT_FIELDS);
  const sourceType = String(value.source_type || "notification").trim().toLowerCase();
  if (!SOURCE_TYPES.includes(sourceType)) throw new Task21Error("事件来源类型无效", 400, "source_type_invalid");
  const eventType = String(value.event_type || "other").trim().toLowerCase();
  if (!EVENT_TYPES.includes(eventType)) throw new Task21Error("事件类型无效", 400, "event_type_invalid");
  const parseStatus = String(value.parse_status || "unparsed").trim().toLowerCase();
  if (!PARSE_STATUSES.includes(parseStatus)) throw new Task21Error("解析状态无效", 400, "parse_status_invalid");
  const direction = String(value.direction || "").trim().toLowerCase();
  if (direction && !DIRECTIONS.includes(direction)) throw new Task21Error("收支方向无效", 400, "direction_invalid");
  const paymentChannel = String(value.payment_channel || "").trim().toLowerCase();
  if (!PAYMENT_CHANNELS.includes(paymentChannel)) throw new Task21Error("支付渠道无效", 400, "payment_channel_invalid");

  const eventId = cleanId(value.event_id, "事件标识");
  const fingerprint = cleanText(value.fingerprint, 64, "指纹").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Task21Error("事件指纹无效", 400, "fingerprint_invalid");

  const sourcePackage = cleanText(value.source_package, 160, "来源应用");
  if (sourcePackage && !PACKAGE_PATTERN.test(sourcePackage)) {
    throw new Task21Error("来源应用无效", 400, "source_package_invalid");
  }
  const parserVersion = cleanText(value.parser_version, 40, "解析器版本");
  const merchant = cleanText(value.merchant, 160, "商户");
  const counterparty = cleanText(value.counterparty, 160, "对手方");
  const amountMinor = nonNegativeInteger(value.amount_minor || 0, "金额", 10000000000000);
  const confidence = Math.min(1000, nonNegativeInteger(value.confidence || 0, "置信度", 1000));

  if (parseStatus !== "unparsed" && eventType !== "transaction" && eventType !== "refund") {
    throw new Task21Error("非交易事件不能声明为已解析", 400, "event_type_conflicts_with_parse_status");
  }
  if ((parseStatus === "parsed" || parseStatus === "candidate") && (!direction || amountMinor <= 0)) {
    throw new Task21Error("已解析事件缺少金额或收支方向", 400, "structured_fields_required");
  }

  return {
    event_id: eventId,
    fingerprint,
    source_package: sourcePackage,
    source_type: sourceType,
    event_type: eventType,
    parser_version: parserVersion,
    parse_status: parseStatus,
    direction,
    amount_minor: amountMinor,
    currency: cleanCurrency(value.currency),
    payment_channel: paymentChannel,
    merchant,
    counterparty,
    confidence,
    occurred_at_ms: nonNegativeInteger(value.occurred_at_ms || value.received_at_ms || Date.now(), "交易时间", Number.MAX_SAFE_INTEGER),
    received_at_ms: positiveInteger(value.received_at_ms, "接收时间"),
  };
}

export function publicNotificationEvent(row) {
  return {
    event_id: String(row.event_id || ""),
    device_id: String(row.device_id || ""),
    source_package: String(row.source_package || ""),
    source_type: String(row.source_type || ""),
    event_type: String(row.event_type || ""),
    parser_version: String(row.parser_version || ""),
    parse_status: String(row.parse_status || ""),
    direction: String(row.direction || ""),
    amount_minor: Number(row.amount_minor || 0),
    currency: String(row.currency || "CNY"),
    payment_channel: String(row.payment_channel || ""),
    merchant: String(row.merchant || ""),
    counterparty: String(row.counterparty || ""),
    confidence: Number(row.confidence || 0),
    occurred_at_ms: Number(row.occurred_at_ms || 0),
    received_at_ms: Number(row.received_at_ms || 0),
    candidate_id: String(row.candidate_id || ""),
    finance_transaction_id: String(row.finance_transaction_id || ""),
    status: String(row.status || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

export function publicNotificationCandidate(row) {
  return {
    id: String(row.id || ""),
    event_id: String(row.event_id || ""),
    direction: String(row.direction || ""),
    amount_minor: Number(row.amount_minor || 0),
    currency: String(row.currency || "CNY"),
    merchant: String(row.merchant || ""),
    counterparty: String(row.counterparty || ""),
    payment_channel: String(row.payment_channel || ""),
    occurred_at_ms: Number(row.occurred_at_ms || 0),
    confidence: Number(row.confidence || 0),
    status: String(row.status || ""),
    finance_transaction_id: String(row.finance_transaction_id || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}
