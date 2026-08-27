export const TASK16_SCHEMA_VERSION = "1";
export const TASK16_BUILD = "2026-08-27-task16-finance-core";
export const FINANCE_ENTITLEMENT = "finance_access";
export const FINANCE_PLAN_CODE = "finance_monthly";
export const MAX_SYNC_OPERATIONS = 100;
export const MAX_CHANGE_PAGE = 250;

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const SOURCE_EVENT_PATTERN = /^[\p{L}\p{N}._:@/+\-=]{1,160}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const LAST4_PATTERN = /^\d{4}$/;
const DIRECTIONS = new Set(["income", "expense", "refund"]);
const RAW_SOURCE_TYPES = new Set(["notification", "sms", "accessibility", "legacy_import"]);

const REFUND_TERMS = [
  "退款", "退回", "已退", "原路退回", "退款到账", "退款成功", "退还", "撤销交易", "冲正", "返还",
  "退款到賬", "退還", "撤銷交易", "沖正", "返還",
];
const INCOME_TERMS = [
  "收款", "到账", "入账", "收入", "转入", "收到转账", "收到转帐", "收到付款", "向你付款",
  "向你转账", "收款成功", "红包收入", "已收款", "成功收款", "已到账", "已入账",
  "到賬", "入賬", "轉入", "收到轉賬", "收到轉帳", "向你轉賬", "紅包收入",
];
const EXPENSE_TERMS = [
  "消费", "支付成功", "付款成功", "已付款", "扣款成功", "扣费成功", "已扣款", "已扣费", "支出",
  "扫码付款", "向商家付款", "信用卡消费", "银行卡支付", "转出", "转账成功", "账户转出",
  "消費", "扣費成功", "已扣費", "掃碼付款", "信用卡消費", "銀行卡支付", "轉出", "轉賬成功",
];
const PENDING_TERMS = ["待收款", "请收款", "确认收款", "待确认", "請收款", "確認收款"];
const MARKETING_TERMS = [
  "最高额度", "信用额度", "授信额度", "可用额度", "贷款额度", "借款额度", "额度提升", "提额",
  "最高可借", "可借", "低息贷款", "贷款推荐", "优惠券", "代金券", "折扣券", "满减", "原价",
  "到手价", "秒杀价", "商品价格", "促销", "推广", "营销", "抽奖", "赢取", "免费领取", "点击购买",
  "信用額度", "授信額度", "貸款額度", "優惠券", "代金券", "折扣券", "滿減", "促銷", "推廣", "營銷",
];
const STRONG_COMPLETION_TERMS = [
  "支付成功", "付款成功", "扣款成功", "扣费成功", "已扣款", "已扣费", "退款成功", "退款到账",
  "收款成功", "已到账", "已入账", "转账成功", "支付已完成", "交易成功",
  "扣費成功", "已扣費", "退款到賬", "已到賬", "已入賬", "轉賬成功", "交易成功",
];
const AMOUNT_PATTERNS = [
  /(?:人民币|人民幣|RMB|CNY|￥|¥)\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
  /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:元|圓|块|塊)(?!\s*(?:额度|額度|优惠|優惠|券|起|每月))/,
  /(?:交易金额|交易金額|付款金额|付款金額|收款金额|收款金額|扣款金额|扣款金額|退款金额|退款金額)[:：]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
  /(?:支付成功|付款成功|扣款成功|扣费成功|收款成功|退款成功|已扣款|已扣费|已收款|已付款).{0,16}?([0-9]+\.[0-9]{1,2})/,
];

export class Task16Error extends Error {
  constructor(message, status = 400, code = "task16_error", retryable = false, details = undefined) {
    super(message);
    this.name = "Task16Error";
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
  if (!SAFE_ID_PATTERN.test(text)) throw new Task16Error(`${label}无效`, 400, "identifier_invalid");
  return text;
}

export function cleanSourceEventId(value) {
  const text = String(value || "").trim();
  if (!SOURCE_EVENT_PATTERN.test(text)) {
    throw new Task16Error("来源事件标识无效", 400, "source_event_id_invalid");
  }
  return text;
}

export function cleanText(value, maximum, label = "文本") {
  const text = String(value || "").trim();
  if (text.length > maximum) throw new Task16Error(`${label}过长`, 400, "text_too_long");
  return text;
}

export function cleanCurrency(value = "CNY") {
  const currency = String(value || "CNY").trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new Task16Error("币种无效", 400, "currency_invalid");
  return currency;
}

export function cleanDirection(value) {
  const direction = String(value || "").trim().toLowerCase();
  if (!DIRECTIONS.has(direction)) throw new Task16Error("收支方向无效", 400, "direction_invalid");
  return direction;
}

export function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Task16Error(`${label}无效`, 400, "number_invalid");
  }
  return parsed;
}

export function nonNegativeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Task16Error(`${label}无效`, 400, "number_invalid");
  }
  return parsed;
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

export function requireAllowedFields(payload, allowed, code = "task16_fields_forbidden") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task16Error("请求内容无效", 400, "invalid_json");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task16Error("请求包含不允许的字段", 400, code);
  }
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeRecognitionText(value) {
  return cleanText(value, 2400, "识别文本")
    .replace(/[\r\n\u3000]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,/g, "")
    .trim();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function directionFromSemantics(text) {
  if (includesAny(text, REFUND_TERMS)) return "refund";
  if (includesAny(text, INCOME_TERMS)) return "income";
  if (includesAny(text, EXPENSE_TERMS)) return "expense";
  if (includesAny(text, PENDING_TERMS)) return "pending";
  return "unknown";
}

function amountMinorFromText(text) {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const amount = Number(match[1]);
    if (Number.isFinite(amount) && amount > 0 && amount <= 100000000000) {
      return Math.round(amount * 100);
    }
  }
  return 0;
}

export function classifyFinanceText(value) {
  const text = normalizeRecognitionText(value);
  if (!text) return { classification: "rejected", reason: "text_empty", direction: "unknown", amount_minor: 0 };

  const direction = directionFromSemantics(text);
  const completed = includesAny(text, STRONG_COMPLETION_TERMS);
  if (includesAny(text, MARKETING_TERMS) && !completed) {
    return { classification: "rejected", reason: "marketing_or_credit_offer", direction: "unknown", amount_minor: 0 };
  }
  if (direction === "unknown") {
    return { classification: "rejected", reason: "transaction_semantics_missing", direction, amount_minor: 0 };
  }

  const amountMinor = amountMinorFromText(text);
  if (!amountMinor) {
    return {
      classification: direction === "pending" ? "pending" : "rejected",
      reason: direction === "pending" ? "amount_pending" : "amount_missing",
      direction,
      amount_minor: 0,
    };
  }
  if (direction === "pending") {
    return { classification: "pending", reason: "direction_pending", direction, amount_minor: amountMinor };
  }
  return { classification: "accepted", reason: "transaction_completed", direction, amount_minor: amountMinor };
}

export function normalizeManualTransaction(value = {}) {
  requireAllowedFields(value, new Set([
    "direction", "amount_minor", "currency", "category_id", "merchant", "counterparty", "note", "occurred_at_ms",
  ]));
  return {
    direction: cleanDirection(value.direction),
    amount_minor: positiveInteger(value.amount_minor, "金额", 10000000000000),
    currency: cleanCurrency(value.currency),
    category_id: value.category_id ? cleanId(value.category_id, "分类标识") : "",
    merchant: cleanText(value.merchant, 160, "商户"),
    counterparty: cleanText(value.counterparty, 160, "对手方"),
    note: cleanText(value.note, 500, "备注"),
    occurred_at_ms: positiveInteger(value.occurred_at_ms, "交易时间"),
  };
}

export function normalizeRawEvent(value = {}) {
  requireAllowedFields(value, new Set([
    "source_type", "source_event_id", "source_provider", "provider_reference", "text", "direction", "amount_minor",
    "currency", "merchant", "counterparty", "account_last4", "occurred_at_ms", "captured_at_ms", "metadata",
  ]));
  const sourceType = String(value.source_type || "").trim().toLowerCase();
  if (!RAW_SOURCE_TYPES.has(sourceType)) {
    throw new Task16Error("事件来源类型无效", 400, "source_type_invalid");
  }
  const text = normalizeRecognitionText(value.text);
  if (!text && sourceType !== "legacy_import") {
    throw new Task16Error("采集事件缺少可验证的交易文本", 400, "recognition_text_required");
  }
  const classification = text ? classifyFinanceText(text) : {
    classification: "accepted",
    reason: "structured_legacy_event",
    direction: cleanDirection(value.direction),
    amount_minor: positiveInteger(value.amount_minor, "金额", 10000000000000),
  };
  const accountLast4 = String(value.account_last4 || "").trim();
  if (accountLast4 && !LAST4_PATTERN.test(accountLast4)) {
    throw new Task16Error("账户尾号无效", 400, "account_last4_invalid");
  }
  const metadata = safeJsonObject(value.metadata);
  const metadataKeys = new Set([
    "source_time_precision_ms", "payment_channel", "card_network", "source_locale", "capture_version",
  ]);
  if (Object.keys(metadata).some((key) => !metadataKeys.has(key))) {
    throw new Task16Error("事件元数据包含不允许的字段", 400, "metadata_fields_forbidden");
  }
  for (const [key, item] of Object.entries(metadata)) {
    if (!["string", "number", "boolean"].includes(typeof item)
      || (typeof item === "string" && item.length > 120)
      || (typeof item === "number" && !Number.isFinite(item))) {
      throw new Task16Error(`事件元数据 ${key} 无效`, 400, "metadata_value_invalid");
    }
  }
  const metadataText = JSON.stringify(metadata);
  if (metadataText.length > 8000) throw new Task16Error("事件元数据过大", 400, "metadata_too_large");
  const sourceProvider = cleanText(value.source_provider, 80, "来源服务");
  if (!sourceProvider) throw new Task16Error("来源服务不能为空", 400, "source_provider_required");
  return {
    source_type: sourceType,
    source_event_id: cleanSourceEventId(value.source_event_id),
    source_provider: sourceProvider,
    provider_reference: cleanText(value.provider_reference, 160, "交易参考号"),
    text,
    direction: classification.direction,
    amount_minor: classification.amount_minor,
    currency: cleanCurrency(value.currency),
    merchant: cleanText(value.merchant, 160, "商户"),
    counterparty: cleanText(value.counterparty, 160, "对手方"),
    account_last4: accountLast4,
    occurred_at_ms: positiveInteger(value.occurred_at_ms, "交易时间"),
    captured_at_ms: positiveInteger(value.captured_at_ms || Date.now(), "采集时间"),
    metadata,
    classification: classification.classification,
    classification_reason: classification.reason,
  };
}

export function reconciliationScore(event, candidate, candidateEvents = []) {
  const evidence = [];
  const references = new Set(candidateEvents.map((item) => String(item.provider_reference || "")).filter(Boolean));
  if (event.provider_reference && references.has(event.provider_reference)) {
    return { score: 1, evidence: ["provider_reference"], automatic: true };
  }
  let score = 0;
  if (event.direction === candidate.direction && event.amount_minor === candidate.amount_minor
      && event.currency === candidate.currency) {
    score += 0.3;
    evidence.push("amount_currency_direction");
  }
  if (event.merchant && candidate.merchant && event.merchant === candidate.merchant) {
    score += 0.18;
    evidence.push("merchant");
  }
  if (event.counterparty && candidate.counterparty && event.counterparty === candidate.counterparty) {
    score += 0.14;
    evidence.push("counterparty");
  }
  const eventLast4 = String(event.account_last4 || "");
  const candidateLast4 = new Set(candidateEvents.map((item) => String(item.account_last4 || "")).filter(Boolean));
  if (eventLast4 && candidateLast4.has(eventLast4)) {
    score += 0.16;
    evidence.push("account_last4");
  }
  const delta = Math.abs(Number(event.occurred_at_ms) - Number(candidate.occurred_at_ms));
  if (delta <= 15_000) {
    score += 0.12;
    evidence.push("time_15s");
  } else if (delta <= 180_000) {
    score += 0.07;
    evidence.push("time_3m");
  }
  const sourceTypes = new Set(candidateEvents.map((item) => String(item.source_type || "")));
  if (sourceTypes.size && !sourceTypes.has(event.source_type)) {
    score += 0.12;
    evidence.push("independent_source");
  } else {
    score = Math.min(score, 0.7);
    evidence.push("same_source_conservative_cap");
  }
  score = Math.min(1, Math.round(score * 1000) / 1000);
  return { score, evidence, automatic: score >= 0.92 };
}

export function publicTransaction(row) {
  return {
    id: String(row.id || ""),
    direction: String(row.direction || ""),
    amount_minor: Number(row.amount_minor || 0),
    currency: String(row.currency || "CNY"),
    category_id: String(row.category_id || ""),
    merchant: String(row.merchant || ""),
    counterparty: String(row.counterparty || ""),
    note: String(row.note || ""),
    occurred_at_ms: Number(row.occurred_at_ms || 0),
    source_kind: String(row.source_kind || ""),
    reconciliation_state: String(row.reconciliation_state || ""),
    status: String(row.status || ""),
    revision: Number(row.revision || 0),
    sync_version: Number(row.sync_version || 0),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    deleted_at: String(row.deleted_at || ""),
  };
}

export function publicRawEvent(row) {
  return {
    id: String(row.id || ""),
    device_id: String(row.device_id || ""),
    source_type: String(row.source_type || ""),
    source_event_id: String(row.source_event_id || ""),
    source_provider: String(row.source_provider || ""),
    provider_reference: String(row.provider_reference || ""),
    direction: String(row.direction || ""),
    amount_minor: Number(row.amount_minor || 0),
    currency: String(row.currency || "CNY"),
    merchant: String(row.merchant || ""),
    counterparty: String(row.counterparty || ""),
    account_last4: String(row.account_last4 || ""),
    occurred_at_ms: Number(row.occurred_at_ms || 0),
    captured_at_ms: Number(row.captured_at_ms || 0),
    classification: String(row.classification || ""),
    classification_reason: String(row.classification_reason || ""),
    sync_version: Number(row.sync_version || 0),
    created_at: String(row.created_at || ""),
  };
}
