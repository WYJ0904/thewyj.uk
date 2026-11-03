/** Client ingest protocol version (Android payloads send this value). */
import { currencyDigits } from '../../js/finance/money.js';
export const TASK21_SCHEMA_VERSION = "1";
/** Task 21 readiness baseline; migration 0022 is additive for old Pages code. */
export const TASK21_DB_SCHEMA_VERSION = "9";
export const TASK21_BUILD = "2026-09-08-task21-notification";
export const NOTIFICATION_ENTITLEMENT = "notification_archive_access";
export const MAX_INGEST_OPERATIONS = 100;
export const MAX_EVENT_PAGE = 100;

// Confidence is retained as evidence; booking depends on complete money fields.
export const CANDIDATE_CONFIDENCE_MILLI = 700;

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PACKAGE_PATTERN = /^[\p{L}\p{N}._-]{1,160}$/u;
const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;
const LIFECYCLE_IDENTITY_PATTERN = /^[0-9a-f]{64}$/;

export const SOURCE_TYPES = Object.freeze(["notification", "sms", "accessibility"]);
export const EVENT_TYPES = Object.freeze(["transaction", "refund", "marketing", "verification", "other"]);
export const PARSE_STATUSES = Object.freeze(["parsed", "candidate", "unparsed"]);
export const DIRECTIONS = Object.freeze(["income", "expense", "refund"]);
/**
 * Canonical payment channels. `bank` / `bank_sms` are accepted because shipped
 * Android builds emit them for bank notifications and bank SMS; the device
 * normalises to `bank_card` from 1.2.7 on, and the older spellings must keep
 * working for any event already queued on a device.
 */
export const PAYMENT_CHANNELS = Object.freeze([
  "",
  "wechat",
  "alipay",
  "bank_card",
  "bank",
  "bank_sms",
  "other",
]);
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
  "currency", "payment_channel", "provider_reference", "lifecycle_identity",
  "merchant", "counterparty", "confidence",
  "occurred_at_ms", "received_at_ms",
  "financial_phase", "lifecycle_reference", "reference_namespace", "currency_evidence", "identity_review_reason",
  "lifecycle_operation", "lifecycle_revision",
  "currency_roles", "amount_exponent",
  "currency_review_required", "currency_decision_source",
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

export function normalizeCurrencyDecision(value) {
  if (value.currency_review_required === undefined && value.currency_decision_source === undefined) return {};
  if (typeof value.currency_review_required !== 'boolean' ||
      (value.currency_review_required ? value.currency_decision_source !== 'account_default' : Boolean(value.currency_decision_source))) {
    throw new Task21Error('币种决议标记无效',400,'currency_decision_invalid');
  }
  if (!value.currency_review_required) return {};
  if (String(value.currency_evidence || '') || value.currency_roles !== undefined)
    throw new Task21Error('默认币种不能冒充来源明示币种',409,'currency_decision_evidence_conflict');
  try { currencyDigits(value.currency); } catch (_) { throw new Task21Error('默认币种无效',400,'currency_decision_invalid'); }
  return { currency_review_required: true, currency_decision_source: 'account_default' };
}

export function normalizeNotificationEvent(value = {}, {legacyUnitless=false} = {}) {
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
  const providerReference = String(value.provider_reference || "").trim();
  if (providerReference && !PROVIDER_REFERENCE_PATTERN.test(providerReference)) {
    throw new Task21Error("交易参考号无效", 400, "provider_reference_invalid");
  }
  const lifecycleIdentity = String(value.lifecycle_identity || "").trim().toLowerCase();
  if (lifecycleIdentity && !LIFECYCLE_IDENTITY_PATTERN.test(lifecycleIdentity)) {
    throw new Task21Error("通知生命周期标识无效", 400, "lifecycle_identity_invalid");
  }
  const financialPhase = String(value.financial_phase || "").trim();
  if (!["", "AUTHORIZED", "SETTLED", "RELEASED", "EXPIRED", "REFUNDED", "REVIEW_REQUIRED"].includes(financialPhase))
    throw new Task21Error("清算状态无效", 400, "financial_phase_invalid");
  const lifecycleOperation = String(value.lifecycle_operation || "");
  const lifecycleRevision = nonNegativeInteger(value.lifecycle_revision || 0, "状态版本", 999999999);
  const phasesForOperation={AUTHORIZE:['AUTHORIZED'],CAPTURE:['SETTLED','REVIEW_REQUIRED'],REFUND:['REFUNDED','REVIEW_REQUIRED'],RELEASE:['RELEASED','REVIEW_REQUIRED'],CLOSE:['RELEASED','EXPIRED']};
  if(lifecycleOperation && !phasesForOperation[lifecycleOperation]?.includes(financialPhase))
    throw new Task21Error("清算操作与状态不匹配",400,"lifecycle_operation_invalid");
  if(lifecycleRevision && !financialPhase)throw new Task21Error("状态版本缺少清算状态",400,"lifecycle_revision_invalid");
  const lifecycleReference = String(value.lifecycle_reference || "").trim();
  if (lifecycleReference && !PROVIDER_REFERENCE_PATTERN.test(lifecycleReference))
    throw new Task21Error("授权关联无效", 400, "lifecycle_reference_invalid");
  const referenceNamespace = cleanText(value.reference_namespace, 160, "来源命名空间");
  if (referenceNamespace && !/^[A-Za-z0-9._:-]+$/.test(referenceNamespace))
    throw new Task21Error("来源命名空间无效", 400, "reference_namespace_invalid");
  const currencyEvidence = cleanText(value.currency_evidence, 64, "币种证据");
  const currency = cleanCurrency(value.currency || (legacyUnitless ? 'CNY' : 'XXX'));
  const evidenceCodes = currencyEvidence ? currencyEvidence.split(",") : [];
  if (evidenceCodes.some((code) => !/^[A-Z]{3}$/.test(code))) throw new Task21Error("币种证据无效", 400, "currency_evidence_invalid");
  if (evidenceCodes.length === 1 && evidenceCodes[0] !== currency)
    throw new Task21Error("币种与明确证据冲突", 409, "currency_evidence_conflict");
  const identityReviewReason = cleanText(value.identity_review_reason, 80, "核实原因");
  if (identityReviewReason && !/^[a-z0-9_]+$/.test(identityReviewReason))
    throw new Task21Error("核实原因无效", 400, "identity_review_reason_invalid");
  const amountMinor = nonNegativeInteger(value.amount_minor || 0, "金额", 10000000000000);
  if (currency === 'JPY' && value.amount_exponent !== 0 && !(legacyUnitless && value.amount_exponent === undefined))
    throw new Task21Error('日元来源单位需要明确确认',409,'currency_unit_review_required');
  if (value.amount_exponent !== undefined) {
    let digits;try{digits=currencyDigits(currency)}catch{throw new Task21Error('未知币种单位需要核实',409,'currency_unit_review_required')}
    if(value.amount_exponent !== digits)throw new Task21Error('来源金额单位冲突',409,'currency_unit_review_required');
  }
  let currencyRoles;
  if (value.currency_roles !== undefined) {
    requireAllowedFields(value.currency_roles, new Set(['original', 'settlement', 'fee']));
    if (!value.currency_roles.original) throw new Task21Error('缺少原币金额角色', 400, 'currency_roles_invalid');
    currencyRoles = {};
    for (const name of ['original', 'settlement', 'fee']) {
      if (value.currency_roles[name] === undefined) continue;
      const role = value.currency_roles[name];
      requireAllowedFields(role, new Set(['currency', 'amount_minor']));
      try { currencyDigits(role.currency); }
      catch (_) { throw new Task21Error('金额角色币种无效', 400, 'currency_roles_invalid'); }
      if (typeof role.amount_minor !== 'number') throw new Task21Error('角色金额必须使用整数最小单位',400,'currency_roles_invalid');
      currencyRoles[name] = { currency: role.currency, amount_minor: name === 'fee' ? nonNegativeInteger(role.amount_minor, '角色金额', 10000000000000) : positiveInteger(role.amount_minor, '角色金额', 10000000000000) };
    }
    if (currencyRoles.original.currency !== cleanCurrency(value.currency) || currencyRoles.original.amount_minor !== amountMinor) throw new Task21Error('原币金额角色冲突', 409, 'currency_roles_conflict');
  }
  const confidence = Math.min(1000, nonNegativeInteger(value.confidence || 0, "置信度", 1000));

  if (parseStatus !== "unparsed" && eventType !== "transaction" && eventType !== "refund") {
    throw new Task21Error("非交易事件不能声明为已解析", 400, "event_type_conflicts_with_parse_status");
  }
  // Parsed and candidate events must carry the money fields. An amount-unknown
  // hint ("向张三转账" without a number) stays local on the device through the
  // enrichment ticket flow instead of inventing an amount here.
  // Parsed and candidate events must carry the money fields. The candidate table
  // has a `amount_minor > 0` CHECK, and an amount-unknown hint deliberately stays
  // on the device through the 90 second enrichment ticket flow instead of
  // inventing an amount here. (Showing those hints on the web Finance page needs
  // a real pending-hint model, not a relaxed constraint.)
  if ((parseStatus === "parsed" || parseStatus === "candidate") && (!direction || amountMinor <= 0)) {
    throw new Task21Error("已解析事件缺少金额或收支方向", 400, "structured_fields_required");
  }

  return {
    ...normalizeCurrencyDecision(value),
    event_id: eventId,
    fingerprint,
    source_package: sourcePackage,
    source_type: sourceType,
    event_type: eventType,
    parser_version: parserVersion,
    parse_status: parseStatus,
    direction,
    amount_minor: amountMinor,
    ...(currencyRoles ? { currency_roles: currencyRoles } : {}),
    currency,
    ...(currency === 'JPY' && value.amount_exponent === 0 ? { amount_exponent: 0 } : {}),
    payment_channel: paymentChannel,
    provider_reference: providerReference,
    lifecycle_identity: lifecycleIdentity,
    lifecycle_operation: lifecycleOperation, lifecycle_revision: lifecycleRevision,
    financial_phase: financialPhase, lifecycle_reference: lifecycleReference,
    reference_namespace: referenceNamespace, currency_evidence: currencyEvidence,
    identity_review_reason: identityReviewReason || (evidenceCodes.length > 1 ? "currency_evidence_conflict" : currency==='XXX'&&amountMinor>0 ? 'currency_unverified' : ''),
    merchant,
    counterparty,
    confidence,
    occurred_at_ms: nonNegativeInteger(value.occurred_at_ms || value.received_at_ms || Date.now(), "交易时间", Number.MAX_SAFE_INTEGER),
    received_at_ms: positiveInteger(value.received_at_ms, "接收时间"),
  };
}

export function publicNotificationEvent(row) {
  return {
    ...(Number(row.currency_review_required) === 1 ? { currency_review_required: true, currency_decision_source: String(row.currency_decision_source) } : {}),
    lifecycle_operation: String(row.lifecycle_operation || ""), lifecycle_revision: Number(row.lifecycle_revision || 0),
    lifecycle_review_reason: String(row.lifecycle_review_reason || ""),
    financial_phase: String(row.financial_phase || ""),
    lifecycle_reference: String(row.lifecycle_reference || ""),
    reference_namespace: String(row.reference_namespace || ""),
    currency_evidence: String(row.currency_evidence || ""),
    identity_review_reason: String(row.identity_review_reason || ""),
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
  let edited = {};
  try {
    const parsed = JSON.parse(String(row.edited_json || "{}"));
    edited = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    edited = {};
  }
  return {
    ...(row.currency_decision_source ? { currency_review_required: Number(row.currency_review_required) === 1, currency_decision_source: String(row.currency_decision_source) } : {}),
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
    evidence_count: Number(row.evidence_count || 1),
    correction_count: Number(row.correction_count || 0),
    edited,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}
