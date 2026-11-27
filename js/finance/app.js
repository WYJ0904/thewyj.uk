import { randomId as capabilityRandomId } from "../core/capabilities.js?release=20261127-aeris-p6-transfer-v1";
import { createFinanceDisclosure } from "./disclosure.js?release=20261127-aeris-p6-transfer-v1";
import { mergeLocalNotificationLedger } from "./notification-ledger.js?release=20261127-aeris-p6-transfer-v1";
import { reconcileKeyedRows } from "../core/keyed-list.js?release=20261127-aeris-p6-transfer-v1";
import { formatFinanceMoney } from "./format.js?release=20261127-aeris-p6-transfer-v1";
import { createParkedRows } from "../core/parked-rows.js?release=20261127-aeris-p6-transfer-v1";
import { moneyText, referenceValue, SUPPORTED_CURRENCIES, currencyDigits } from "./money.js?release=20261127-aeris-p6-transfer-v1";
export { formatFinanceMoney } from "./format.js?release=20261127-aeris-p6-transfer-v1";
// Authorization holds/releases are lifecycle controls, never real spending.
const AUTHORIZATION_CONTROL_STATES = new Set(["pending_authorization", "authorization_release", "authorization_expired"]);
const AUTHORIZATION_CONTROL_DIRECTIONS = new Set(["authorization_release", "authorization_expired"]);
export function isAuthorizationControl(item) {
  return AUTHORIZATION_CONTROL_STATES.has(item?.reconciliation_state) || AUTHORIZATION_CONTROL_DIRECTIONS.has(item?.direction);
}
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const UNCONVERTED_LABELS = Object.freeze({
  missing_historical_rate: "缺少交易日历史汇率",
  fx_rate_expired: "历史汇率已过期",
  currency_unit_review_required: "日元金额单位待复核",
  currency_unsupported: "币种不受支持",
  amount_overflow: "金额超出精确范围",
  fx_snapshot_mismatch: "汇率快照与账目不一致",
  fx_date_mismatch: "汇率日期与交易日期不符",
  fx_pair_invalid: "汇率币种对无效",
});
function supportedCurrency(value) {
  return SUPPORTED_CURRENCIES.includes(value);
}
function safeMinorNumber(value) {
  return value <= MAX_SAFE_MINOR && value >= -MAX_SAFE_MINOR ? Number(value) : null;
}
const SCHEMA_VERSION = 1;
const MAX_LOCAL_TRANSACTIONS = 5000;
const MAX_PENDING_OPERATIONS = 500;
const CLIENT_PAGE_SIZE = 100;
const SYNC_BATCH_SIZE = 80;
const VALID_DIRECTIONS = new Set(["income", "expense", "refund"]);
const VALID_ENTITY_KINDS = new Set(["transaction", "category", "budget"]);
const ENTITY_COLLECTION_KEYS = Object.freeze({
  transaction: "transactions",
  category: "categories",
  budget: "budgets",
});

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function safeText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function randomId(prefix) {
  return `${prefix}:${capabilityRandomId()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function timestamp() {
  return new Date().toISOString();
}

function monthKey(value = Date.now()) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Ledger navigation only; statistics keep their separately selected month. */
export function financeLedgerMonths(transactions, status = "active") {
  const counts = new Map();
  for (const item of transactions || []) {
    if (status !== "all" && item.status !== status) continue;
    const month = monthKey(item.occurred_at_ms);
    if (month) counts.set(month, (counts.get(month) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => b.localeCompare(a)).map(([month, count]) => ({month, count}));
}

function localDateKey(value = Date.now()) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthBounds(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const last = new Date(year, month, 0);
  const endDate = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { startMs: start.getTime(), endMs: end.getTime(), startDate: `${match[1]}-${match[2]}-01`, endDate };
}

export function validateAmountText(value, label = "金额", currency = "CNY") {
  let digits;
  try { digits = currencyDigits(currency); }
  catch (_) { return { valid: false, message: `请选择支持的${label}币种`, amountMinor: 0 }; }
  const text = String(value || "").trim();
  if (!text) {
    return { valid: false, message: `请输入${label}`, amountMinor: 0 };
  }
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) {
    return { valid: false, message: `请输入纯数字的有效${label}`, amountMinor: 0 };
  }
  const [whole, fraction = ""] = text.split(".");
  if (digits === 0 && fraction.length) {
    return { valid: false, message: `${label}日元不支持小数位`, amountMinor: 0 };
  }
  if (fraction.length > digits) {
    return { valid: false, message: `${label}最多支持两位小数`, amountMinor: 0 };
  }
  const limitMessage = `${label}超出系统最大上限（最高支持 1000 亿${currency === "CNY" ? "元" : ` ${currency}`}）`;
  if (whole.replace(/^0+(?=\d)/, "").length > 11) {
    return { valid: false, message: limitMessage, amountMinor: 0 };
  }
  const factor = 10n ** BigInt(digits);
  const exact = BigInt(whole) * factor + BigInt(fraction.padEnd(digits, "0") || "0");
  if (exact <= 0n) {
    return { valid: false, message: `请输入大于 0 的有效${label}`, amountMinor: 0 };
  }
  if (exact > 100_000_000_000n * factor) {
    return { valid: false, message: limitMessage, amountMinor: 0 };
  }
  return { valid: true, message: "", amountMinor: Number(exact), amountExponent: digits, currency };
}

export function amountTextToMinor(value, currency = "CNY") {
  const res = validateAmountText(value, "金额", currency);
  return res.valid ? res.amountMinor : 0;
}

function normalizeTransaction(value) {
  if (!value || typeof value !== "object") return null;
  const id = safeText(value.id, 80);
  const direction = safeText(value.direction, 16).toLowerCase();
  const amountMinor = Number(value.amount_minor);
  const occurredAt = Number(value.occurred_at_ms);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(id) || !VALID_DIRECTIONS.has(direction)
      || !Number.isSafeInteger(amountMinor) || amountMinor <= 0
      || !Number.isSafeInteger(occurredAt) || occurredAt <= 0) return null;
  const currency = /^[A-Z]{3}$/.test(String(value.currency || "CNY")) ? String(value.currency || "CNY") : "CNY";
  const exponent = value.amount_exponent === 0 || value.amount_exponent === 2 ? value.amount_exponent : null;
  // Historical JPY rows without a verified zero exponent stay in unit review;
  // they are never reinterpreted or folded into totals.
  const unitStatus = value.money_unit_status === "review_required" || value.money_unit_status === "verified"
    ? value.money_unit_status
    : currency === "JPY" ? (exponent === 0 ? "verified" : "review_required") : "";
  const decisionSource = safeText(value.currency_decision_source, 32);
  return {
    ...(exponent !== null ? { amount_exponent: exponent } : {}),
    ...(unitStatus ? { money_unit_status: unitStatus } : {}),
    ...(decisionSource ? {
      currency_review_required: value.currency_review_required === true || value.currency_review_required === 1,
      currency_decision_source: decisionSource,
    } : {}),
    id,
    direction,
    amount_minor: amountMinor,
    currency,
    category_id: safeText(value.category_id, 80),
    merchant: safeText(value.merchant, 160),
    counterparty: safeText(value.counterparty, 160),
    note: safeText(value.note, 500),
    occurred_at_ms: occurredAt,
    source_kind: safeText(value.source_kind || "manual", 24),
    reconciliation_state: safeText(value.reconciliation_state || "confirmed", 24),
    status: value.status === "deleted" ? "deleted" : "active",
    revision: Math.max(0, Number(value.revision) || 0),
    sync_version: Math.max(0, Number(value.sync_version) || 0),
    created_at: safeText(value.created_at, 40),
    updated_at: safeText(value.updated_at, 40),
    deleted_at: safeText(value.deleted_at, 40),
    native_notification_event_id: safeText(value.native_notification_event_id, 80),
    native_notification_pending: value.native_notification_pending === true,
    notification_event_ids: Array.isArray(value.notification_event_ids) ? value.notification_event_ids.map(id => safeText(id, 80)).filter(Boolean) : [],
  };
}

function normalizeCategory(value) {
  if (!value || typeof value !== "object") return null;
  const id = safeText(value.id, 80);
  const name = safeText(value.name, 80);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(id) || !name) return null;
  return {
    id,
    name,
    applies_to: ["income", "expense", "both"].includes(value.applies_to) ? value.applies_to : "both",
    color: /^#[0-9A-Fa-f]{6}$/.test(String(value.color || "")) ? value.color : "#2563eb",
    status: value.status === "deleted" ? "deleted" : "active",
    revision: Math.max(0, Number(value.revision) || 0),
    sync_version: Math.max(0, Number(value.sync_version) || 0),
    updated_at: safeText(value.updated_at, 40),
    deleted_at: safeText(value.deleted_at, 40),
  };
}

function normalizeBudget(value) {
  if (!value || typeof value !== "object") return null;
  const id = safeText(value.id, 80);
  const amountMinor = Number(value.amount_minor);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(id) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    id,
    category_id: safeText(value.category_id, 80),
    period_type: ["daily", "monthly", "yearly", "custom"].includes(value.period_type) ? value.period_type : "monthly",
    amount_minor: amountMinor,
    currency: /^[A-Z]{3}$/.test(String(value.currency || "CNY")) ? String(value.currency || "CNY") : "CNY",
    starts_on: safeText(value.starts_on, 10),
    ends_on: safeText(value.ends_on, 10),
    status: value.status === "deleted" ? "deleted" : "active",
    revision: Math.max(0, Number(value.revision) || 0),
    sync_version: Math.max(0, Number(value.sync_version) || 0),
    updated_at: safeText(value.updated_at, 40),
    deleted_at: safeText(value.deleted_at, 40),
  };
}

function entityNormalizer(kind) {
  if (kind === "transaction") return normalizeTransaction;
  if (kind === "category") return normalizeCategory;
  if (kind === "budget") return normalizeBudget;
  return () => null;
}

export function financeCollectionKey(kind) {
  return ENTITY_COLLECTION_KEYS[String(kind || "")] || "";
}

function financeCollection(store, kind) {
  const key = financeCollectionKey(kind);
  const collection = key ? store?.[key] : null;
  return collection && typeof collection === "object" ? collection : null;
}

function normalizeOperation(value) {
  if (!value || typeof value !== "object") return null;
  const operationId = safeText(value.operation_id, 80);
  const entityId = safeText(value.entity_id, 80);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(operationId) || !/^[A-Za-z0-9._:-]{8,80}$/.test(entityId)) return null;
  const type = safeText(value.type, 40);
  if (!/^(transaction|category|budget)\.(upsert|delete|restore)$/.test(type)) return null;
  return {
    operation_id: operationId,
    type,
    entity_id: entityId,
    base_revision: Math.max(0, Number(value.base_revision) || 0),
    ...(type.endsWith(".upsert") ? { payload: value.payload && typeof value.payload === "object" ? value.payload : {} } : {}),
    queued_at_ms: Math.max(0, Number(value.queued_at_ms) || Date.now()),
  };
}

function emptyStore(accountId, deviceId) {
  return {
    schema_version: SCHEMA_VERSION,
    account_id: String(accountId || ""),
    device_id: deviceId,
    server_version: 0,
    hydrated: false,
    notification_identity_hydrated: false,
    transactions: {},
    categories: {},
    budgets: {},
    pending: [],
    last_sync_at: "",
    last_error: "",
  };
}

function normalizeStore(value, accountId, deviceId) {
  const source = value && typeof value === "object" ? value : {};
  if (String(source.account_id || "") !== String(accountId || "")) return emptyStore(accountId, deviceId);
  const result = emptyStore(accountId, safeText(source.device_id, 80) || deviceId);
  result.server_version = Math.max(0, Number(source.server_version) || 0);
  result.hydrated = Boolean(source.hydrated);
  result.notification_identity_hydrated = source.notification_identity_hydrated === true;
  for (const [kind, normalizer] of [["transactions", normalizeTransaction], ["categories", normalizeCategory], ["budgets", normalizeBudget]]) {
    const items = source[kind] && typeof source[kind] === "object" ? Object.values(source[kind]) : [];
    for (const item of items.slice(0, kind === "transactions" ? MAX_LOCAL_TRANSACTIONS : 1000)) {
      const clean = normalizer(item);
      if (clean) result[kind][clean.id] = clean;
    }
  }
  result.pending = Array.isArray(source.pending)
    ? source.pending.map(normalizeOperation).filter(Boolean).slice(-MAX_PENDING_OPERATIONS)
    : [];
  result.last_sync_at = safeText(source.last_sync_at, 40);
  result.last_error = safeText(source.last_error, 240);
  return result;
}

/**
 * Exact per-currency totals plus an optional reference projection.
 * Original minor units of different currencies are never added together: an
 * item only contributes to the display total when it is in the display
 * currency or carries a valid historical reference snapshot. Everything else
 * is reported in `unconverted`. Single-currency results keep the legacy shape.
 */
export function calculateFinanceSummary(transactions, options = {}) {
  const bounds = options.month ? monthBounds(options.month) : null;
  const active = (Array.isArray(transactions) ? transactions : []).filter((item) => {
    if (!item || item.status === "deleted" || isAuthorizationControl(item)) return false;
    if (!bounds) return true;
    return item.occurred_at_ms >= bounds.startMs && item.occurred_at_ms < bounds.endMs;
  });
  const summary = { income_minor: 0, expense_minor: 0, refund_minor: 0, balance_minor: 0, count: active.length };
  const currencies = [...new Set(active.map((item) => item.currency || "CNY"))];
  const quote = options.display_currency || (currencies.length === 1 ? currencies[0] : "CNY");
  const unconverted = [];
  const byCurrency = {};
  const exact = { income_minor: 0n, expense_minor: 0n, refund_minor: 0n };
  for (const item of active) {
    const currency = item.currency || "CNY";
    const key = `${item.direction}_minor`;
    const bucket = byCurrency[currency] ||= { income_minor: 0n, expense_minor: 0n, refund_minor: 0n };
    if (Object.hasOwn(bucket, key) && Number.isSafeInteger(item.amount_minor)) bucket[key] += BigInt(item.amount_minor);
    const value = referenceValue(item.currency ? item : { ...item, currency }, quote, options);
    if (value.status !== "same_currency" && value.status !== "reference") {
      unconverted.push({ id: item.id, currency, reason: value.status });
      continue;
    }
    if (Object.hasOwn(exact, key)) exact[key] += BigInt(value.amount_minor);
  }
  exact.balance_minor = exact.income_minor + exact.refund_minor - exact.expense_minor;
  let overflow = false;
  for (const [key, value] of Object.entries(exact)) {
    summary[key] = safeMinorNumber(value);
    if (summary[key] === null) overflow = true;
  }
  for (const bucket of Object.values(byCurrency)) {
    bucket.balance_minor = bucket.income_minor + bucket.refund_minor - bucket.expense_minor;
    for (const [key, value] of Object.entries(bucket)) {
      // Exact digits are preserved as a decimal string instead of rounding.
      bucket[key] = safeMinorNumber(value) ?? value.toString();
    }
  }
  if (currencies.length > 1 || unconverted.length || (currencies.length === 1 && quote !== currencies[0])) {
    Object.assign(summary, {
      display_currency: quote,
      by_currency: byCurrency,
      unconverted,
      conversion_status: unconverted.length ? unconverted[0].reason : "reference",
      reference_only: true,
    });
  }
  if (overflow) Object.assign(summary, { has_overflow: true, conversion_status: "amount_overflow" });
  return summary;
}

export function filterFinanceTransactions(transactions, filters = {}) {
  const query = safeText(filters.query, 120).toLocaleLowerCase();
  const direction = VALID_DIRECTIONS.has(filters.direction) ? filters.direction : "";
  const categoryId = safeText(filters.category_id, 80);
  const status = filters.status === "deleted" ? "deleted" : filters.status === "all" ? "all" : "active";
  const bounds = filters.month ? monthBounds(filters.month) : null;
  return (Array.isArray(transactions) ? transactions : []).filter((item) => {
    if (!item) return false;
    if (status !== "all" && item.status !== status) return false;
    if (direction && item.direction !== direction) return false;
    if (categoryId && item.category_id !== categoryId) return false;
    if (bounds && (item.occurred_at_ms < bounds.startMs || item.occurred_at_ms >= bounds.endMs)) return false;
    if (query) {
      const haystack = [item.merchant, item.counterparty, item.note, item.currency].join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((left, right) => right.occurred_at_ms - left.occurred_at_ms || right.id.localeCompare(left.id));
}

export function applyFinanceChange(store, change) {
  const entityType = safeText(change?.entity_type, 24);
  if (!VALID_ENTITY_KINDS.has(entityType)) return false;
  const payload = change?.payload?.[entityType];
  const clean = entityNormalizer(entityType)(payload);
  if (!clean) return false;
  const collection = financeCollection(store, entityType);
  if (!collection) return false;
  const current = collection[clean.id];
  if (!current || Number(clean.revision) >= Number(current.revision || 0)) collection[clean.id] = clean;
  store.server_version = Math.max(Number(store.server_version || 0), Number(change.version || clean.sync_version || 0));
  return true;
}

function exponentFor(currency) {
  try { return { amount_exponent: currencyDigits(currency) }; } catch (_) { return {}; }
}

function transactionPayload(transaction, extra = {}) {
  return {
    direction: transaction.direction,
    amount_minor: transaction.amount_minor,
    currency: transaction.currency,
    // Explicit unit declaration; the server rejects JPY without exponent 0.
    ...exponentFor(transaction.currency),
    category_id: transaction.category_id,
    merchant: transaction.merchant,
    counterparty: transaction.counterparty,
    note: transaction.note,
    occurred_at_ms: transaction.occurred_at_ms,
    ...(extra.currency_review_acknowledged === true ? { currency_review_acknowledged: true } : {}),
  };
}

function categoryPayload(category) {
  return { name: category.name, applies_to: category.applies_to, color: category.color };
}

function budgetPayload(budget) {
  return {
    category_id: budget.category_id,
    period_type: budget.period_type,
    amount_minor: budget.amount_minor,
    currency: budget.currency,
    ...exponentFor(budget.currency),
    starts_on: budget.starts_on,
    ends_on: budget.ends_on,
  };
}

export function createFinanceController({
  api,
  apiGet,
  storage,
  account,
  hasEntitlement,
  isSuperAdmin,
  openRecharge,
  navigate,
  appVersion,
  onSummaryChanged = () => {},
  openDialog,
  closeDialog,
}) {
  let store = null;
  let currentAccountId = "";
  let syncPromise = null;
  let invalidationGeneration = 0;
  let observedGeneration = 0;
  let ownerEpoch = 0;
  let suspended = false;
  let syncController = null;
  let conflictPending = false;
  let undoTransactionId = "";
  let initialized = false;
  let serverDeniedAccess = false;
  let ledgerAllMonths = false;
  let ledgerLimit = CLIENT_PAGE_SIZE;
  let ledgerFilter = "";
  let searchTimer = 0;
  let insightsTimer = 0;
  let insightsFrame = 0;
  let insightsSignature = "";
  let messageTimer = 0;
  let activeSubView = "overview";
  let trendRangeMonths = 6;
  let activeChartHoverIdx = -1;
  let lastChartWidth = 0;
  let trendResizeObserver = null;
  let trendResizeFrame = 0;
  // Currency preferences + historical reference snapshots are account-scoped;
  // every async result is checked against its owner before it may paint.
  let currencyPrefs = null; // { account_id, account_currency, display_currency, default_currency, revision, observed }
  let currencyFetch = null;
  let currencySaving = null;
  let currencyMessage = { text: "", tone: "" };
  let referenceCache = new Map();
  let referenceUnavailable = new Map();
  let referenceLoad = null;

  const element = (id) => document.getElementById(id);
  const ledgerRows = createParkedRows(() => element("financeTransactionList"));
  let recordedDisclosure = null;
  const storageKey = (accountId) => `wyjFinance:v1:${encodeURIComponent(String(accountId || "guest"))}`;
  const deviceKey = "wyjFinanceDevice:v1";

  function deviceId() {
    let value = safeText(storage.getItem(deviceKey), 80);
    if (!/^web:[A-Za-z0-9-]{8,76}$/.test(value)) {
      value = randomId("web");
      storage.setItem(deviceKey, value);
    }
    return value;
  }

  function ensureStore() {
    const nextAccountId = String(account()?.id || "");
    if (!nextAccountId) return null;
    if (store && currentAccountId === nextAccountId) {
      if (mergeLocalNotificationLedger(store.transactions, globalThis.window?.WYJLocalPaymentLedger, nextAccountId)) persist();
      return store;
    }
    if (currentAccountId !== nextAccountId) { cancelSync(); resetCurrencyState(); }
    currentAccountId = nextAccountId;
    store = normalizeStore(safeJson(storage.getItem(storageKey(nextAccountId)), {}), nextAccountId, deviceId());
    restoreCachedCurrencyPrefs(nextAccountId);
    if (mergeLocalNotificationLedger(store.transactions, globalThis.window?.WYJLocalPaymentLedger, nextAccountId)) persist();
    return store;
  }

  function cancelSync() {
    ownerEpoch += 1;
    syncController?.abort();
    syncController = null;
    syncPromise = null;
    // Keep invalidation outstanding. Reentry/online/manual retry owns recovery.
    invalidationGeneration += 1;
  }

  function readOwner(controller = new AbortController()) {
    return { epoch: ownerEpoch, accountId: currentAccountId, store, controller };
  }

  function ownerCurrent(owner) {
    return !suspended && owner.epoch === ownerEpoch && owner.store === store &&
      owner.accountId === String(account()?.id || "") && !owner.controller.signal.aborted;
  }

  function requireOwner(owner) {
    if (!ownerCurrent(owner)) throw Object.assign(new Error("财务页面已切换"), { name: "AbortError" });
  }

  async function readForOwner(path, owner) {
    requireOwner(owner);
    const result = await apiGet(path, { controller: owner.controller });
    requireOwner(owner);
    return result;
  }

  function persist() {
    if (!store || !currentAccountId) return;
    storage.setItem(storageKey(currentAccountId), JSON.stringify(store));
    onSummaryChanged();
  }

  // ---- Currency preferences (/api/finance/currencies, revision CAS) ----
  const currencyKey = (accountId) => `wyjFinanceCurrency:v1:${encodeURIComponent(String(accountId || "guest"))}`;

  function resetCurrencyState() {
    currencyPrefs = null;
    currencyFetch = null;
    currencySaving = null;
    currencyMessage = { text: "", tone: "" };
    referenceCache = new Map();
    referenceUnavailable = new Map();
    referenceLoad = null;
  }

  function cleanPrefs(value, accountId, observed) {
    if (!value || typeof value !== "object") return null;
    const revision = Number(value.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) return null;
    return {
      account_id: accountId,
      account_currency: supportedCurrency(value.account_currency) ? value.account_currency : "CNY",
      display_currency: supportedCurrency(value.display_currency) ? value.display_currency : "CNY",
      default_currency: supportedCurrency(value.default_currency) ? value.default_currency : null,
      revision,
      observed,
    };
  }

  function restoreCachedCurrencyPrefs(accountId) {
    // Cached values only paint the last known display currency; a save always
    // waits for a fresh server revision.
    if (currencyPrefs?.account_id === accountId) return;
    currencyPrefs = cleanPrefs(safeJson(storage.getItem(currencyKey(accountId)), null), accountId, false);
  }

  function applyCurrencyPrefs(value, accountId) {
    if (!accountId || accountId !== currentAccountId) return false;
    const next = cleanPrefs(value, accountId, true);
    if (!next) return false;
    if (currencyPrefs?.account_id === accountId && currencyPrefs.observed && next.revision < currencyPrefs.revision) return false;
    const quoteChanged = currencyPrefs?.display_currency !== next.display_currency;
    currencyPrefs = next;
    try {
      const { account_id: _account, observed: _observed, ...cached } = next;
      storage.setItem(currencyKey(accountId), JSON.stringify(cached));
    } catch (_) {}
    if (quoteChanged) referenceUnavailable = new Map();
    return true;
  }

  function displayCurrency() {
    return currencyPrefs?.account_id === currentAccountId ? currencyPrefs.display_currency : "CNY";
  }

  function accountCurrency() {
    return currencyPrefs?.account_id === currentAccountId ? currencyPrefs.account_currency : "CNY";
  }

  function setCurrencyMessage(text = "", tone = "") {
    currencyMessage = { text, tone };
  }

  function renderCurrencyControls() {
    const prefs = currencyPrefs?.account_id === currentAccountId ? currencyPrefs : null;
    const editable = Boolean(prefs?.observed) && !currencySaving && hasAccess();
    for (const [id, field] of [["financeDisplayCurrency", "display_currency"], ["financeAccountCurrency", "account_currency"], ["financeDefaultCurrency", "default_currency"]]) {
      const select = element(id);
      if (!select) continue;
      const value = field === "default_currency" ? (prefs?.default_currency || "") : (prefs?.[field] || "CNY");
      if (select.value !== value) select.value = value;
      select.disabled = !editable;
      select.setAttribute("aria-busy", String(Boolean(currencySaving)));
    }
  }

  async function fetchCurrencyPreferences() {
    ensureStore();
    if (!store || !hasAccess() || suspended) return false;
    if (currencyFetch?.accountId === currentAccountId) return currencyFetch.promise;
    const owner = readOwner(new AbortController());
    const promise = (async () => {
      try {
        const data = await readForOwner("/api/finance/currencies", owner);
        if (!applyCurrencyPrefs(data?.preferences, owner.accountId)) return false;
        if (currencyMessage.tone === "warning") setCurrencyMessage();
        return true;
      } catch (error) {
        if (ownerCurrent(owner) && error?.name !== "AbortError") {
          setCurrencyMessage(`币种设置暂时无法读取：${safeText(error?.message || "请稍后重试", 120)}`, "warning");
        }
        return false;
      } finally {
        if (currencyFetch?.owner === owner) currencyFetch = null;
        if (ownerCurrent(owner)) renderAll();
      }
    })();
    currencyFetch = { accountId: currentAccountId, owner, promise };
    return promise;
  }

  async function saveCurrencyPreference(field, rawValue) {
    ensureStore();
    if (!store || !hasAccess()) return;
    if (currencySaving) { renderCurrencyControls(); return; }
    const value = field === "default_currency" && !rawValue ? null : rawValue;
    if (value !== null && !supportedCurrency(value)) { renderCurrencyControls(); return; }
    const token = {};
    currencySaving = token;
    const owner = readOwner(new AbortController());
    setCurrencyMessage("正在保存币种设置…", "info");
    renderCurrencyControls();
    renderSummary();
    try {
      if (!currencyPrefs?.observed || currencyPrefs.account_id !== owner.accountId) {
        await fetchCurrencyPreferences();
        requireOwner(owner);
        if (!currencyPrefs?.observed) throw Object.assign(new Error("币种设置尚未从云端读取"), { code: "currency_preferences_unavailable" });
      }
      if (currencyPrefs[field] === value) { setCurrencyMessage(); return; }
      const data = await api("/api/finance/currencies", { revision: currencyPrefs.revision, [field]: value }, { controller: owner.controller });
      requireOwner(owner);
      applyCurrencyPrefs(data?.preferences, owner.accountId);
      setCurrencyMessage(field === "default_currency" && value
        ? `已保存。未标明币种的通知将暂按 ${value} 记录，并保留“默认币种待复核”标记。`
        : "币种设置已保存。", "success");
    } catch (error) {
      if (!ownerCurrent(owner) || error?.name === "AbortError") return;
      if (error?.code === "currency_preferences_conflict") {
        setCurrencyMessage("币种设置已在另一设备更新，已重新读取最新设置，请确认后再修改。", "warning");
        if (currencyPrefs) currencyPrefs = { ...currencyPrefs, observed: false };
        currencyFetch = null;
        void fetchCurrencyPreferences();
      } else {
        setCurrencyMessage(`币种设置保存失败：${safeText(error?.message || "请稍后重试", 120)}`, "error");
      }
    } finally {
      if (currencySaving === token) currencySaving = null;
      if (ownerCurrent(owner)) {
        renderAll();
        void loadReferences();
      }
    }
  }

  // ---- Historical reference snapshots (/api/finance/references) ----
  const referenceKey = (item, quote) => `${item.id}:${item.revision || 0}:${quote}`;

  function referenceSnapshots() {
    return Object.fromEntries(referenceCache);
  }

  function summaryOptions(month) {
    return { month, display_currency: displayCurrency(), snapshots: referenceSnapshots() };
  }

  function referenceWindowStart() {
    const now = new Date();
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
    const selected = monthBounds(currentMonth())?.startMs ?? trendStart;
    return Math.min(trendStart, selected);
  }

  async function loadReferences() {
    ensureStore();
    if (!store || !hasAccess() || suspended) return false;
    const quote = displayCurrency();
    const loadKey = `${currentAccountId}|${quote}`;
    if (referenceLoad?.key === loadKey) { referenceLoad.again = true; return referenceLoad.promise; }
    const owner = readOwner(new AbortController());
    const state = { key: loadKey, again: false, promise: null };
    state.promise = (async () => {
      let changed = false;
      try {
        do {
          state.again = false;
          const since = referenceWindowStart();
          const attempted = new Set();
          for (let batch = 0; batch < 5; batch += 1) {
            const ids = Object.values(store.transactions)
              .filter((item) => item.status === "active" && !isAuthorizationControl(item) && item.currency !== quote
                && supportedCurrency(item.currency) && item.money_unit_status !== "review_required"
                && item.occurred_at_ms >= since && !attempted.has(item.id)
                && !referenceCache.has(referenceKey(item, quote)) && !referenceUnavailable.has(referenceKey(item, quote)))
              .sort((a, b) => b.occurred_at_ms - a.occurred_at_ms)
              .slice(0, 100);
            if (!ids.length) break;
            for (const item of ids) attempted.add(item.id);
            const query = new URLSearchParams({ ids: ids.map((item) => item.id).join(","), display_currency: quote });
            const data = await readForOwner(`/api/finance/references?${query}`, owner);
            if (displayCurrency() !== quote) return changed;
            for (const [key, snapshot] of Object.entries(data?.references || {})) {
              if (key.endsWith(`:${quote}`) && snapshot && typeof snapshot === "object") { referenceCache.set(key, snapshot); changed = true; }
            }
            for (const row of Array.isArray(data?.unavailable) ? data.unavailable : []) {
              const item = store.transactions[row?.id];
              // Deferred/provider failures are retried on the next sync.
              if (item && row.reason !== "fx_request_deferred" && row.reason !== "fx_provider_unavailable") {
                referenceUnavailable.set(referenceKey(item, quote), safeText(row.reason, 60));
              }
            }
          }
        } while (state.again && ownerCurrent(owner));
      } catch (error) {
        if (ownerCurrent(owner) && error?.name !== "AbortError") {
          setCurrencyMessage(`参考汇率暂时无法读取，外币账目保持原币显示：${safeText(error?.message || "请稍后重试", 100)}`, "warning");
          changed = true;
        }
      } finally {
        if (referenceLoad === state) referenceLoad = null;
        if (changed && ownerCurrent(owner)) renderAll();
      }
      return changed;
    })();
    referenceLoad = state;
    return state.promise;
  }

  function unconvertedNote(unconverted) {
    if (!unconverted?.length) return "";
    const counts = new Map();
    for (const row of unconverted) counts.set(row.reason, (counts.get(row.reason) || 0) + 1);
    const parts = [...counts].map(([reason, count]) => `${UNCONVERTED_LABELS[reason] || reason} ${count} 笔`);
    return `${unconverted.length} 笔未计入合计（${parts.join("、")}），原币金额保持不变。`;
  }

  function formatSummaryMoney(value, currency) {
    if (value === null || value === undefined) return "超出精确显示范围";
    if (typeof value === "string") return `${currency} ${value} 最小单位（超出精确显示范围）`;
    return formatFinanceMoney(value, currency);
  }

  function hasAccess() {
    const value = account();
    return Boolean(!serverDeniedAccess && value && (isSuperAdmin(value) || hasEntitlement("finance_access", value) || hasEntitlement("all_features_access", value)));
  }

  function activeValues(kind) {
    ensureStore();
    return Object.values(store?.[kind] || {}).filter((item) => item.status !== "deleted");
  }

  function setMessage(message = "", tone = "", { autoDismissMs = 0 } = {}) {
    window.clearTimeout(messageTimer);
    messageTimer = 0;
    const target = element("financeMessage");
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
    target.hidden = !message;
    if (message && autoDismissMs > 0) {
      messageTimer = window.setTimeout(() => {
        messageTimer = 0;
        const current = element("financeMessage");
        if (current && current.textContent === message) {
          current.textContent = "";
          current.dataset.tone = "";
          current.hidden = true;
        }
      }, autoDismissMs);
    }
  }

  const VALID_SUBVIEWS = new Set(["overview", "ledger", "analytics", "settings"]);

  function setSubView(nextView = "overview", { syncHistory = true, focusTab = false } = {}) {
    const resolved = VALID_SUBVIEWS.has(nextView) ? nextView : "overview";
    activeSubView = resolved;
    const workspace = element("financeWorkspace");
    if (workspace) workspace.dataset.financeActiveTab = resolved;
    const subnav = element("financeSubnav");
    if (subnav) {
      subnav.querySelectorAll?.("[data-finance-tab]")?.forEach?.((tab) => {
        const active = tab.dataset.financeTab === resolved;
        tab.setAttribute("aria-selected", String(active));
        tab.classList.toggle("active", active);
        tab.tabIndex = active ? 0 : -1;
        if (active && focusTab) tab.focus({ preventScroll: true });
      });
    }
    document.querySelectorAll?.("#financeWorkspace [data-finance-panel]")?.forEach?.((panel) => {
      const active = panel.dataset.financePanel === resolved;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    if (syncHistory && typeof history !== "undefined" && typeof history.replaceState === "function" && typeof location !== "undefined" && location?.pathname === "/finance") {
      try {
        history.replaceState({ ...(history.state || {}), aerisFinanceTab: resolved }, "", location.href);
      } catch (_) {}
    }
    if (resolved === "overview") {
      globalThis.window?.requestAnimationFrame?.(() => renderTrendChart());
    }
    if (resolved === "analytics" && store) {
      renderBudgets();
      renderCategoryStats();
      renderAnalyticsHistory();
    }
  }

  function invalidField(input, message) {
    if (!input) return;
    input.setCustomValidity(message);
    input.reportValidity();
    input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
  }

  function setSyncState(label, tone = "", detail = "") {
    const badge = element("financeSyncStatus");
    if (badge) {
      badge.textContent = label;
      badge.dataset.tone = tone;
    }
    const detailElement = element("financeSyncDetail");
    if (detailElement) detailElement.textContent = detail || label;
    const syncButton = element("financeSyncBtn");
    if (syncButton) syncButton.disabled = label === "同步中";
  }

  function categoryName(id) {
    return store?.categories?.[id]?.name || "未分类";
  }

  function renderCategoryOptions() {
    const categories = activeValues("categories").sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const options = categories.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    for (const id of ["financeCategoryFilter", "financeTransactionCategory", "financeBudgetCategory"]) {
      const select = element(id);
      if (!select) continue;
      const current = select.value;
      const first = id === "financeCategoryFilter" ? "全部分类" : id === "financeBudgetCategory" ? "总预算（不限定分类）" : "未分类";
      const html = `<option value="">${first}</option>${options}`;
      if (select.innerHTML !== html) select.innerHTML = html;
      if ([...select.options].some((item) => item.value === current)) select.value = current;
    }
  }

  function currentMonth() {
    return element("financeMonthFilter")?.value || monthKey();
  }

  function renderHistoryNavigation() {
    const periods = financeLedgerMonths(Object.values(store.transactions), element("financeStatusFilter")?.value || "active");
    const total = periods.reduce((sum, row) => sum + row.count, 0);
    const scope = ledgerAllMonths ? "全部月份" : currentMonth();
    if (element("financeRecordedScope")) element("financeRecordedScope").textContent = `${scope} · 全部 ${total} 笔`;
    if (element("financeHistoryNotice")) element("financeHistoryNotice").textContent = ledgerAllMonths
      ? `已显示全部月份账目；收支与分类统计仍按 ${currentMonth()} 计算，预算沿用其设置周期。`
      : `当前只显示 ${currentMonth()}，全部月份共 ${total} 笔；可在下面查看历史。`;
    const all = element("financeAllMonthsBtn");
    if (all) { all.textContent = `全部月份 / 历史账目（${total}）`; all.setAttribute("aria-pressed", String(ledgerAllMonths)); }
    const selected = element("financeSelectedMonthBtn");
    if (selected) { selected.textContent = `按 ${currentMonth()} 查看`; selected.disabled = !ledgerAllMonths; }
    const select = element("financeHistoryMonthSelect");
    if (select) {
      const html = '<option value="">选择历史月份</option>' + periods.map(row =>
        `<option value="${row.month}">${row.month} · ${row.count} 笔</option>`).join("");
      if (select.innerHTML !== html) select.innerHTML = html;
      select.value = !ledgerAllMonths && periods.some(row => row.month === currentMonth()) ? currentMonth() : "";
    }
  }

  function renderSummary() {
    if (!store) return;
    const quote = displayCurrency();
    const summary = calculateFinanceSummary(Object.values(store.transactions), summaryOptions(currentMonth()));
    const currency = summary.display_currency || quote;
    if (element("financeIncomeTotal")) element("financeIncomeTotal").textContent = formatSummaryMoney(summary.income_minor, currency);
    if (element("financeExpenseTotal")) element("financeExpenseTotal").textContent = formatSummaryMoney(summary.expense_minor, currency);
    if (element("financeRefundTotal")) element("financeRefundTotal").textContent = formatSummaryMoney(summary.refund_minor, currency);
    if (element("financeBalanceTotal")) element("financeBalanceTotal").textContent = formatSummaryMoney(summary.balance_minor, currency);
    if (element("financeSummaryPeriod")) element("financeSummaryPeriod").textContent = `${currentMonth().replace("-", " 年 ")} 月`;
    if (element("financeOverviewCurrencyChip")) element("financeOverviewCurrencyChip").textContent = `展示币种：${currency}`;
    if (element("financeAnalyticsPeriodNote")) {
      element("financeAnalyticsPeriodNote").textContent = `${currentMonth().replace("-", " 年 ")} 月 · 按 ${currency} 展示分类支出与预算执行`;
    }
    renderCurrencyControls();
    const status = element("financeCurrencyStatus");
    if (status) {
      const notes = [currencyMessage.text];
      if (summary.has_overflow) notes.push("合计金额超出可精确显示的范围，未做近似处理。");
      if (summary.reference_only) notes.push(`合计按 ${currency} 参考折算，仅使用交易日历史汇率快照，不改变原币账目。`);
      notes.push(unconvertedNote(summary.unconverted));
      const reviewCount = Object.values(store.transactions).filter((item) => item.status === "active" && item.currency_review_required === true).length;
      if (reviewCount) notes.push(`${reviewCount} 笔账目按默认币种暂记，需要逐笔复核币种。`);
      const text = notes.filter(Boolean).join(" ");
      if (status.textContent !== text) status.textContent = text;
      status.dataset.tone = summary.has_overflow || summary.unconverted?.length ? "warning" : currencyMessage.tone;
    }
    const groups = element("financeCurrencyGroups");
    if (groups) {
      const rows = summary.by_currency ? Object.entries(summary.by_currency).map(([code, bucket]) =>
        `${code}：收入 ${formatSummaryMoney(bucket.income_minor, code)} · 支出 ${formatSummaryMoney(bucket.expense_minor, code)} · 退款 ${formatSummaryMoney(bucket.refund_minor, code)}`) : [];
      const text = rows.length ? `原币分组 · ${rows.join("；")}` : "";
      if (groups.textContent !== text) groups.textContent = text;
      groups.hidden = !text;
    }
    renderTrendChart();
  }

  function trendStorageKey() {
    return `wyjFinanceFold:v1:${encodeURIComponent(String(account()?.id || "guest"))}:trend:open`;
  }

  function isTrendOpen() {
    try {
      const val = storage.getItem(trendStorageKey());
      return val === "closed" ? false : true;
    } catch {
      return true;
    }
  }

  function setTrendOpen(open) {
    try {
      storage.setItem(trendStorageKey(), open ? "open" : "closed");
    } catch {}
    applyTrendCollapse(open);
  }

  function applyTrendCollapse(open) {
    const wrap = element("financeTrendChartWrap");
    const button = element("toggleFinanceTrendBtn");
    if (wrap) wrap.classList.toggle("collapsed", !open);
    if (button) {
      button.textContent = open ? "收起走势图" : "展开走势图";
      button.setAttribute("aria-expanded", String(open));
    }
  }

  function restoreTrendState() {
    applyTrendCollapse(isTrendOpen());
  }

  function niceAxisScale(rawMax) {
    if (!Number.isFinite(rawMax) || rawMax <= 0) return { max: 100, ticks: [0, 25, 50, 75, 100] };
    const exponent = Math.floor(Math.log10(rawMax));
    const base = 10 ** exponent;
    const fraction = rawMax / base;
    let niceFraction = 10;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 1.5) niceFraction = 1.5;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 2.5) niceFraction = 2.5;
    else if (fraction <= 3) niceFraction = 3;
    else if (fraction <= 4) niceFraction = 4;
    else if (fraction <= 5) niceFraction = 5;
    else if (fraction <= 6) niceFraction = 6;
    else if (fraction <= 8) niceFraction = 8;
    const niceMax = niceFraction * base;
    return {
      max: niceMax,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((r) => niceMax * r),
    };
  }

  function buildMonthlySeries(monthCount) {
    const primaryCurrency = displayCurrency();
    const digits = currencyDigits(primaryCurrency);
    const unit = 10 ** digits;
    const snapshots = referenceSnapshots();
    const now = new Date();
    const months = [];
    for (let i = monthCount - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const shortYear = d.getFullYear() !== now.getFullYear() ? `${String(d.getFullYear()).slice(2)}/` : "";
      const label = `${shortYear}${d.getMonth() + 1}月`;
      months.push({ key: mKey, label, fullLabel: `${d.getFullYear()}年${d.getMonth() + 1}月`, income: 0, expense: 0, incomeMinor: 0n, expenseMinor: 0n, count: 0, hasData: false });
    }
    const allTx = Object.values(store?.transactions || {}).filter((item) => item && item.status !== "deleted" && !isAuthorizationControl(item));
    let trendUnconverted = 0;
    for (const tx of allTx) {
      const txMonth = monthKey(tx.occurred_at_ms);
      const slot = months.find((m) => m.key === txMonth);
      if (!slot) continue;
      slot.hasData = true;
      slot.count += 1;
      if (tx.direction !== "income" && tx.direction !== "expense") continue;
      const value = referenceValue(tx, primaryCurrency, { snapshots });
      if (value.status !== "same_currency" && value.status !== "reference") { trendUnconverted += 1; continue; }
      if (tx.direction === "income") slot.incomeMinor += BigInt(value.amount_minor);
      else slot.expenseMinor += BigInt(value.amount_minor);
    }
    for (const m of months) {
      m.income = Number(m.incomeMinor) / unit;
      m.expense = Number(m.expenseMinor) / unit;
    }
    return { months, primaryCurrency, unit, trendUnconverted, totalTx: allTx.length };
  }

  function renderTrendChart() {
    const wrap = element("financeTrendChartWrap");
    if (!wrap || !store) return;

    const periodEl = element("financeTrendPeriod");
    if (periodEl) periodEl.textContent = `近 ${trendRangeMonths} 个月收支对比趋势`;
    document.querySelectorAll?.("#financeTrendSection [data-finance-trend-range]")?.forEach?.((btn) => {
      const active = Number(btn.dataset.financeTrendRange) === trendRangeMonths;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    const { months, primaryCurrency, unit, trendUnconverted, totalTx } = buildMonthlySeries(trendRangeMonths);

    if (syncPromise && !store.last_sync_at && totalTx === 0) {
      wrap.innerHTML = `
        <div class="finance-chart-state finance-chart-loading" role="status" aria-live="polite">
          <div class="finance-chart-skeleton-bars" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
          <p class="finance-chart-empty-title">正在同步云端账目与走势数据…</p>
        </div>`;
      restoreTrendState();
      return;
    }

    if (!store.last_sync_at && store.last_error && totalTx === 0) {
      wrap.innerHTML = `
        <div class="finance-chart-state finance-chart-error" role="alert">
          <p class="finance-chart-empty-title">收支走势加载失败</p>
          <p class="finance-chart-empty-hint">${escapeHtml(safeText(store.last_error, 140) || "无法读取云端账目，未将缺失数据伪装为零。")}</p>
          <button class="button-secondary" type="button" data-finance-action="sync">重试同步</button>
        </div>`;
      restoreTrendState();
      return;
    }

    if (totalTx === 0) {
      wrap.innerHTML = `
        <div class="finance-chart-empty">
          <svg class="finance-chart-empty-icon" viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
          <p class="finance-chart-empty-title">暂无月度收支走势数据</p>
          <p class="finance-chart-empty-hint">记入你的第一笔收支或从手机端同步账本后，这里会自动展示完整的月度趋势。</p>
          <button class="button-secondary" type="button" data-finance-action="add">新增第一笔账目</button>
        </div>`;
      restoreTrendState();
      return;
    }

    const measuredW = wrap.clientWidth || wrap.parentElement?.clientWidth || 880;
    const svgWidth = Math.max(300, Math.round(measuredW));
    lastChartWidth = svgWidth;
    const compact = svgWidth < 560;
    const svgHeight = compact ? 228 : 284;

    const rawMax = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 10);
    const { max: maxVal, ticks } = niceAxisScale(rawMax);

    const formatYVal = (v) => {
      if (v === 0) return formatFinanceMoney(0, primaryCurrency).replace(/\.00$/, "");
      if (primaryCurrency === "CNY") {
        if (v >= 100_000_000) return `¥${(v / 100_000_000).toFixed(1)}亿`;
        if (v >= 10_000) return `¥${(v / 10_000).toFixed(v % 10_000 === 0 ? 0 : 1)}万`;
      } else if (v >= 10_000) {
        return `${primaryCurrency} ${(v / 1_000).toFixed(0)}k`;
      }
      return formatFinanceMoney(Math.round(v * unit), primaryCurrency).replace(/\.00$/, "");
    };

    const maxTickLen = Math.max(...ticks.map((t) => formatYVal(t).length));
    const leftPad = Math.min(92, Math.max(52, maxTickLen * 8 + 16));
    const padding = { top: 20, right: compact ? 16 : 24, bottom: 34, left: leftPad };
    const chartW = Math.max(120, svgWidth - padding.left - padding.right);
    const chartH = Math.max(110, svgHeight - padding.top - padding.bottom);
    const stepX = months.length > 1 ? chartW / (months.length - 1) : chartW / 2;

    const calcY = (val) => {
      if (val <= 0) return padding.top + chartH;
      const ratio = Math.min(1, val / maxVal);
      const lift = Math.max(3, ratio * chartH);
      return padding.top + chartH - lift;
    };

    const pointsIncome = [];
    const pointsExpense = [];
    months.forEach((m, idx) => {
      const x = months.length > 1 ? padding.left + idx * stepX : padding.left + chartW / 2;
      pointsIncome.push({ idx, x, y: calcY(m.income), val: m.income, label: m.label, fullLabel: m.fullLabel, key: m.key, exp: m.expense, hasData: m.hasData, count: m.count });
      pointsExpense.push({ idx, x, y: calcY(m.expense), val: m.expense, label: m.label, fullLabel: m.fullLabel, key: m.key, inc: m.income, hasData: m.hasData, count: m.count });
    });

    const smoothPath = (pts) => {
      if (pts.length <= 1) return pts.length ? `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` : "";
      if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const cx = (p0.x + p1.x) / 2;
        d += ` C ${cx.toFixed(1)} ${p0.y.toFixed(1)}, ${cx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
      }
      return d;
    };

    const pathInc = smoothPath(pointsIncome);
    const pathExp = smoothPath(pointsExpense);
    const baseY = (padding.top + chartH).toFixed(1);
    const areaInc = pointsIncome.length > 1
      ? `${pathInc} L ${pointsIncome[pointsIncome.length - 1].x.toFixed(1)} ${baseY} L ${pointsIncome[0].x.toFixed(1)} ${baseY} Z`
      : "";

    const xLabelStep = compact && months.length > 8 ? 2 : 1;
    const xLabels = pointsIncome.map((p, idx) => {
      if (idx % xLabelStep !== 0 && idx !== pointsIncome.length - 1) return "";
      return `<text x="${p.x.toFixed(1)}" y="${svgHeight - 10}" text-anchor="middle" font-size="12" font-weight="500" fill="var(--ds-text-secondary)">${escapeHtml(p.label)}</text>`;
    }).join("");

    const gridLines = ticks.map((tickVal, idx) => {
      const y = padding.top + chartH * (1 - idx / (ticks.length - 1));
      const isBase = idx === 0;
      return `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${svgWidth - padding.right}" y2="${y.toFixed(1)}" stroke="${isBase ? "var(--ds-border)" : "var(--ds-border-subtle)"}" stroke-width="1" ${isBase ? "" : 'stroke-dasharray="3 4"'} /><text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11.5" font-weight="500" fill="var(--ds-text-muted)">${escapeHtml(formatYVal(tickVal))}</text>`;
    }).join("");

    const formatMoney = (v) => formatFinanceMoney(Math.round(v * unit), primaryCurrency);
    const colW = months.length > 1 ? stepX : chartW;

    const hitBands = pointsIncome.map((p, idx) => {
      const bandX = Math.max(padding.left, p.x - colW / 2);
      const bandRight = Math.min(svgWidth - padding.right, p.x + colW / 2);
      const bandW = Math.max(16, bandRight - bandX);
      const net = p.val - p.exp;
      const aria = `${p.fullLabel}，收入 ${formatMoney(p.val)}，支出 ${formatMoney(p.exp)}，结余 ${formatMoney(net)}，共 ${p.count} 笔`;
      return `<g class="finance-chart-band" data-trend-idx="${idx}" tabindex="0" role="graphics-symbol" aria-label="${escapeHtml(aria)}">
        <line class="finance-chart-crosshair" x1="${p.x.toFixed(1)}" y1="${padding.top}" x2="${p.x.toFixed(1)}" y2="${baseY}" stroke="var(--ds-border-strong)" stroke-width="1" stroke-dasharray="3 3" opacity="0" />
        <circle class="finance-dot-inc" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${compact ? 3.5 : 4.5}" fill="var(--ds-success)" stroke="var(--ds-surface)" stroke-width="2" />
        <circle class="finance-dot-exp" cx="${pointsExpense[idx].x.toFixed(1)}" cy="${pointsExpense[idx].y.toFixed(1)}" r="${compact ? 3.5 : 4.5}" fill="var(--ds-error)" stroke="var(--ds-surface)" stroke-width="2" />
        <rect x="${bandX.toFixed(1)}" y="${padding.top}" width="${bandW.toFixed(1)}" height="${chartH + 20}" fill="transparent" />
      </g>`;
    }).join("");

    const monthRows = months.map((m, idx) => {
      const net = m.income - m.expense;
      const netSign = net > 0 ? "+" : "";
      const netClass = net >= 0 ? "is-income" : "is-expense";
      return `<button type="button" class="trend-month-card" data-trend-month="${m.key}" data-trend-idx="${idx}" title="查看 ${escapeHtml(m.fullLabel)} 账目">
        <span class="trend-month-name">${escapeHtml(m.label)}</span>
        <span class="trend-month-inc">${escapeHtml(formatMoney(m.income))}</span>
        <span class="trend-month-exp">${escapeHtml(formatMoney(m.expense))}</span>
        <span class="trend-month-net ${netClass}">${netSign}${escapeHtml(formatMoney(net))}</span>
      </button>`;
    }).join("");

    const unconvertedBanner = trendUnconverted > 0
      ? `<p class="finance-currency-note">走势图按 ${escapeHtml(primaryCurrency)} 历史参考汇率折算，另有 ${trendUnconverted} 笔缺少汇率快照的记录未计入曲线。</p>`
      : "";

    wrap.innerHTML = `
      <div class="finance-chart-stage">
        <div class="finance-chart-tooltip hidden" id="financeChartTooltip" role="status" aria-live="polite"></div>
        <svg class="finance-chart-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" role="img" aria-label="近 ${trendRangeMonths} 个月收支走势折线图">
          <defs>
            <linearGradient id="finIncomeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--ds-success)" stop-opacity="0.16" />
              <stop offset="100%" stop-color="var(--ds-success)" stop-opacity="0.01" />
            </linearGradient>
          </defs>
          ${gridLines}
          ${areaInc ? `<path d="${areaInc}" fill="url(#finIncomeGrad)" />` : ""}
          <path d="${pathInc}" fill="none" stroke="var(--ds-success)" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" />
          <path d="${pathExp}" fill="none" stroke="var(--ds-error)" stroke-width="2.25" stroke-dasharray="6 3" stroke-linecap="round" stroke-linejoin="round" />
          ${xLabels}
          ${hitBands}
        </svg>
      </div>
      ${unconvertedBanner}
      <div class="finance-trend-month-table">
        <div class="finance-trend-month-head" aria-hidden="true"><span>月份</span><span>收入</span><span>支出</span><span>收支差额</span></div>
        <div class="finance-trend-month-grid" id="financeTrendMonthList" aria-label="月度收支明细">${monthRows}</div>
        <p class="finance-currency-note">走势与月度收支差额按「收入 − 支出」统计（不含退款）；总览本月结余按「收入 + 退款 − 支出」计算。</p>
      </div>`;

    const stage = wrap.querySelector(".finance-chart-stage");
    const tooltip = wrap.querySelector("#financeChartTooltip");
    const bands = [...wrap.querySelectorAll(".finance-chart-band")];
    const rowEls = [...wrap.querySelectorAll(".trend-month-card")];

    const setActivePoint = (idx) => {
      activeChartHoverIdx = idx;
      bands.forEach((b, i) => {
        const active = i === idx;
        b.classList.toggle("is-active", active);
        const line = b.querySelector(".finance-chart-crosshair");
        if (line) line.setAttribute("opacity", active ? "1" : "0");
        b.querySelector(".finance-dot-inc")?.setAttribute("r", active ? "6" : (compact ? "3.5" : "4.5"));
        b.querySelector(".finance-dot-exp")?.setAttribute("r", active ? "6" : (compact ? "3.5" : "4.5"));
      });
      rowEls.forEach((r, i) => r.classList.toggle("is-highlighted", i === idx));
      if (!tooltip) return;
      if (idx < 0 || idx >= pointsIncome.length) {
        tooltip.classList.add("hidden");
        return;
      }
      const p = pointsIncome[idx];
      const net = p.val - p.exp;
      const netSign = net > 0 ? "+" : "";
      tooltip.innerHTML = `
        <strong>${escapeHtml(p.fullLabel)} <small>${p.count} 笔</small></strong>
        <div class="finance-tooltip-row"><span class="is-income">收入</span><b>${escapeHtml(formatMoney(p.val))}</b></div>
        <div class="finance-tooltip-row"><span class="is-expense">支出</span><b>${escapeHtml(formatMoney(p.exp))}</b></div>
        <div class="finance-tooltip-row"><span>收支差额</span><b>${netSign}${escapeHtml(formatMoney(net))}</b></div>`;
      tooltip.classList.remove("hidden");
      const stageW = stage?.clientWidth || svgWidth;
      const tipW = tooltip.offsetWidth || 156;
      const anchorX = (p.x / svgWidth) * stageW;
      const clampedX = Math.max(8, Math.min(stageW - tipW - 8, anchorX - tipW / 2));
      tooltip.style.left = `${Math.round(clampedX)}px`;
    };

    bands.forEach((band, idx) => {
      band.addEventListener("pointerenter", () => setActivePoint(idx));
      band.addEventListener("pointerdown", () => setActivePoint(idx));
      band.addEventListener("focus", () => setActivePoint(idx));
      band.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" && idx + 1 < bands.length) {
          event.preventDefault();
          bands[idx + 1].focus();
        } else if (event.key === "ArrowLeft" && idx - 1 >= 0) {
          event.preventDefault();
          bands[idx - 1].focus();
        }
      });
    });
    stage?.addEventListener("pointerleave", () => setActivePoint(-1));
    rowEls.forEach((row, idx) => {
      row.addEventListener("pointerenter", () => setActivePoint(idx));
      row.addEventListener("pointerleave", () => setActivePoint(-1));
      row.addEventListener("click", () => {
        const targetMonth = row.dataset.trendMonth;
        if (!targetMonth) return;
        if (element("financeMonthFilter")) element("financeMonthFilter").value = targetMonth;
        ledgerAllMonths = false;
        setSubView("ledger");
        renderAll();
      });
    });
    if (activeChartHoverIdx >= 0 && activeChartHoverIdx < months.length) {
      setActivePoint(activeChartHoverIdx);
    }

    restoreTrendState();
  }

  function renderOverviewPanels() {
    if (!store) return;
    const recentHost = element("financeOverviewRecentList");
    if (recentHost) {
      const recent = Object.values(store.transactions || {})
        .filter((item) => item && item.status === "active")
        .sort((a, b) => Number(b.occurred_at_ms || 0) - Number(a.occurred_at_ms || 0))
        .slice(0, 5);
      if (!recent.length) {
        recentHost.innerHTML = '<p class="finance-empty-inline">暂无最近账目记录。</p>';
      } else {
        recentHost.innerHTML = recent.map((item) => {
          const title = item.merchant || item.counterparty || categoryName(item.category_id);
          const sign = item.direction === "expense" ? "-" : "+";
          const dirLabel = { income: "收入", expense: "支出", refund: "退款" }[item.direction] || "";
          const dateShort = new Date(item.occurred_at_ms).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
          return `<button type="button" class="finance-overview-tx-row" data-finance-edit="${escapeHtml(item.id)}">
            <span class="finance-overview-tx-main"><span class="finance-direction is-${escapeHtml(item.direction)}">${dirLabel}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(categoryName(item.category_id))} · ${escapeHtml(dateShort)}</small></span>
            <strong class="finance-overview-tx-amt is-${escapeHtml(item.direction)}">${sign}${escapeHtml(formatFinanceMoney(item.amount_minor, item.currency))}</strong>
          </button>`;
        }).join("");
      }
    }
    const budgetsHost = element("financeOverviewBudgets");
    if (budgetsHost) {
      const today = localDateKey();
      const budgets = activeValues("budgets").filter((item) => (!item.starts_on || item.starts_on <= today) && (!item.ends_on || item.ends_on >= today));
      if (!budgets.length) {
        budgetsHost.innerHTML = '<div class="finance-empty-inline"><p>尚未设置本月预算。</p><button type="button" class="button-secondary" data-finance-action="budgets">设置月度预算</button></div>';
      } else {
        budgetsHost.innerHTML = budgets.slice(0, 4).map((item) => {
          const currency = item.currency || "CNY";
          const spent = categoryExpense(item.category_id, item);
          const remaining = item.amount_minor - spent;
          const percent = Math.min(100, Math.round((spent / Math.max(1, item.amount_minor)) * 100));
          return `<article class="finance-budget-status${remaining < 0 ? " is-over" : ""}"><div><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}</strong><span>${remaining < 0 ? `超出 ${formatFinanceMoney(-remaining, currency)}` : `剩余 ${formatFinanceMoney(remaining, currency)}`}</span></div><progress class="finance-progress" max="100" value="${percent}"></progress><small>已用 ${percent}% · ${formatFinanceMoney(spent, currency)} / ${formatFinanceMoney(item.amount_minor, currency)}</small></article>`;
        }).join("");
      }
    }
    syncPendingBadges();
  }

  function syncPendingBadges() {
    const candidateCount = Number(element("financePendingCount")?.textContent) || 0;
    const recoveryCount = Number(element("financeRecoveryCount")?.textContent) || 0;
    const totalPending = candidateCount + recoveryCount;
    const tabBadge = element("financeTabLedgerBadge");
    if (tabBadge) {
      tabBadge.textContent = String(totalPending);
      tabBadge.hidden = totalPending <= 0;
      tabBadge.classList.toggle("hidden", totalPending <= 0);
    }
    const banner = element("financeOverviewPendingBanner");
    const textEl = element("financeOverviewPendingText");
    if (banner && textEl) {
      banner.classList.toggle("hidden", totalPending <= 0);
      if (totalPending > 0) textEl.textContent = `有 ${totalPending} 条待核实或本机恢复记录`;
    }
  }

  function renderAnalyticsHistory() {
    const host = element("financeAnalyticsMonths");
    if (!host || !store) return;
    const { months, primaryCurrency, unit } = buildMonthlySeries(12);
    const activeMonths = months.filter((m) => m.hasData).reverse();
    if (!activeMonths.length) {
      host.innerHTML = '<p class="finance-empty-inline">近 12 个月暂无可对比账目。</p>';
      return;
    }
    const fmt = (v) => formatFinanceMoney(Math.round(v * unit), primaryCurrency);
    host.innerHTML = `<div class="finance-analytics-table">
      <div class="finance-analytics-thead"><span>月份</span><span>收入</span><span>支出</span><span>收支差额</span><span>笔数</span></div>
      ${activeMonths.map((m) => {
        const net = m.income - m.expense;
        return `<div class="finance-analytics-trow"><strong>${escapeHtml(m.fullLabel)}</strong><span class="is-income">${escapeHtml(fmt(m.income))}</span><span class="is-expense">${escapeHtml(fmt(m.expense))}</span><span class="${net >= 0 ? "is-income" : "is-expense"}">${net > 0 ? "+" : ""}${escapeHtml(fmt(net))}</span><small>${m.count} 笔</small></div>`;
      }).join("")}
    </div>`;
  }

  function renderTransactions() {
    const list = element("financeTransactionList");
    if (!list || !store) return;
    const filters = {
      query: element("financeSearchInput")?.value,
      direction: element("financeDirectionFilter")?.value,
      category_id: element("financeCategoryFilter")?.value,
      status: element("financeStatusFilter")?.value,
      month: ledgerAllMonths ? "" : currentMonth(),
    };
    const filter = JSON.stringify([currentAccountId, filters]);
    if (ledgerFilter !== filter) { ledgerFilter = filter; ledgerLimit = CLIENT_PAGE_SIZE; }
    const filtered = filterFinanceTransactions(Object.values(store.transactions), filters);
    renderHistoryNavigation();
    if (element("financeTransactionCount")) element("financeTransactionCount").textContent = `${filtered.length} 笔`;
    if (element("financeRecordedCount")) element("financeRecordedCount").textContent = String(filtered.length);
    recordedDisclosure?.restore();
    // Collapsed on phones: the summary line has to state the current filter so
    // the list is never silently filtered by hidden controls.
    const filterSummary = element("financeFilterSummary");
    if (filterSummary) {
      const month = ledgerAllMonths ? "全部月份" : currentMonth();
      const direction = { income: "收入", expense: "支出", refund: "退款" }[element("financeDirectionFilter")?.value || ""] || "全部类型";
      const status = { deleted: "已删除", all: "全部状态" }[element("financeStatusFilter")?.value || "active"] || "当前账目";
      const query = safeText(element("financeSearchInput")?.value, 24);
      filterSummary.textContent = [month, direction, status, query ? `“${query}”` : ""].filter(Boolean).join(" · ");
    }
    const totalAllStatusMatches = Object.values(store.transactions).filter((item) => {
      const targetStatus = filters.status || "active";
      return targetStatus === "all" || (item.status || "active") === targetStatus;
    }).length;
    const totalAllMonthsActive = Object.values(store.transactions).filter((item) => (item.status || "active") === "active").length;
    const hasSearchOrTypeFilter = Boolean(filters.query || filters.direction || filters.category_id);
    let emptyHtml;
    if (!store.last_sync_at && !store.pending?.length && store.last_error) {
      emptyHtml = `<div class="finance-empty"><strong>云端账目读取失败</strong><p>${escapeHtml(safeText(store.last_error, 120) || "请检查网络或服务状态后重试。")}</p><div class="action-row compact"><button class="button-secondary" type="button" data-finance-action="sync">重试读取</button><button class="button-ghost" type="button" data-finance-action="add">新增账目</button></div></div>`;
    } else if (!store.last_sync_at && Object.keys(store.transactions).length === 0) {
      emptyHtml = '<div class="finance-empty"><strong>尚未从云端读取账目</strong><p>点击“立即同步”拉取账户历史记录，或直接记一笔新账。</p><div class="action-row compact"><button class="button-secondary" type="button" data-finance-action="sync">立即同步</button><button class="button-ghost" type="button" data-finance-action="add">新增账目</button></div></div>';
    } else if (hasSearchOrTypeFilter && totalAllStatusMatches > 0) {
      emptyHtml = `<div class="finance-empty"><strong>当前筛选条件下无匹配账目</strong><p>本账户仍保留 ${totalAllMonthsActive} 笔有效历史账目，未做任何删除。</p><div class="action-row compact"><button class="button-secondary" type="button" data-finance-action="clear-filters">清空筛选条件</button></div></div>`;
    } else if (!ledgerAllMonths && totalAllMonthsActive > 0) {
      emptyHtml = `<div class="finance-empty"><strong>${escapeHtml(currentMonth())} 暂无账目，其他月份共有 ${totalAllMonthsActive} 笔历史记录</strong><p>切换至全部月份或选择历史月份即可查看。</p><div class="action-row compact"><button class="button-secondary" type="button" data-finance-action="all-months">查看全部月份（${totalAllMonthsActive}）</button><button class="button-ghost" type="button" data-finance-action="add">新增账目</button></div></div>`;
    } else {
      emptyHtml = '<div class="finance-empty"><strong>当前账户暂无账目记录</strong><p>点击“新增账目”记一笔，或从导出与加密备份导入已有数据。</p><div class="action-row compact"><button class="button-secondary" type="button" data-finance-action="add">新增账目</button></div></div>';
    }

    const visible = filtered.slice(0, ledgerLimit);
    reconcileKeyedRows(list, visible, {
      key: item => item.id,
      signature: item => JSON.stringify([item, categoryName(item.category_id)]),
      empty: emptyHtml,
      render: (item) => {
      const title = item.merchant || item.counterparty || (item.source_kind === "automatic" ? "未识别商户" : categoryName(item.category_id));
      const sign = item.direction === "expense" ? "-" : "+";
      const directionLabel = { income: "收入", expense: "支出", refund: "退款" }[item.direction];
      return `<article class="finance-transaction${item.status === "deleted" ? " is-deleted" : ""}" data-finance-transaction="${escapeHtml(item.id)}">
        <div class="finance-transaction-main"><span class="finance-direction is-${escapeHtml(item.direction)}">${directionLabel}</span><div class="finance-transaction-title-col"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>${item.note ? `<p title="${escapeHtml(item.note)}">${escapeHtml(item.note)}</p>` : ""}</div></div>
        <div class="finance-transaction-cat">${escapeHtml(categoryName(item.category_id))}${isAuthorizationControl(item) ? " · 预授权" : ""}${item.currency_review_required ? " · 待复核币种" : ""}</div>
        <div class="finance-transaction-time">${escapeHtml(new Date(item.occurred_at_ms).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }))}${item.source_kind === "automatic" ? " · Android 自动识别" : ""}${item.native_notification_pending ? " · 等待同步" : ""}${item.status === "deleted" ? " · 已删除" : ""}</div>
        <div class="finance-transaction-side"><strong class="is-${escapeHtml(item.direction)}">${sign}${escapeHtml(formatFinanceMoney(item.amount_minor, item.currency))}</strong><div class="finance-row-actions">${item.status === "deleted" ? `<button class="button-ghost" type="button" data-finance-restore="${escapeHtml(item.id)}">恢复</button>` : `<button class="button-ghost" type="button" data-finance-edit="${escapeHtml(item.id)}">编辑</button><button class="button-ghost danger-text" type="button" data-finance-delete="${escapeHtml(item.id)}">删除</button>`}</div></div>
      </article>`;
      },
    });
    const more = element("financeLedgerMoreBtn");
    if (more) { more.hidden = visible.length >= filtered.length; more.textContent = `加载更多账目（已显示 ${visible.length} / ${filtered.length}）`; }
    list.setAttribute("aria-busy", "false");
  }

  function categoryExpense(categoryId, budget) {
    const start = budget.starts_on ? new Date(`${budget.starts_on}T00:00:00`).getTime() : 0;
    const end = budget.ends_on ? new Date(`${budget.ends_on}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER;
    const budgetCurrency = budget.currency || "CNY";
    return Object.values(store.transactions).filter((item) => item.status === "active" && item.direction === "expense"
      && !isAuthorizationControl(item) && (item.currency || "CNY") === budgetCurrency
      && (!categoryId || item.category_id === categoryId) && item.occurred_at_ms >= start && item.occurred_at_ms <= end)
      .reduce((total, item) => total + item.amount_minor, 0);
  }

  function renderBudgets() {
    const list = element("financeBudgetSummary");
    if (!list || !store) return;
    const today = localDateKey();
    const budgets = activeValues("budgets").filter((item) => (!item.starts_on || item.starts_on <= today) && (!item.ends_on || item.ends_on >= today));
    if (!budgets.length) {
      list.innerHTML = '<p class="finance-empty-inline">尚未设置当前预算。</p>';
      return;
    }
    list.innerHTML = budgets.map((item) => {
      const currency = item.currency || "CNY";
      const spent = categoryExpense(item.category_id, item);
      const remaining = item.amount_minor - spent;
      const percent = Math.min(100, Math.round(spent / item.amount_minor * 100));
      return `<article class="finance-budget-status${remaining < 0 ? " is-over" : ""}"><div><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}${currency !== "CNY" ? `（${currency}）` : ""}</strong><span>${remaining < 0 ? `超出 ${formatFinanceMoney(-remaining, currency)}` : `剩余 ${formatFinanceMoney(remaining, currency)}`}</span></div><progress class="finance-progress" max="100" value="${percent}" aria-label="已使用 ${percent}%"></progress><small>已用 ${formatFinanceMoney(spent, currency)} / ${formatFinanceMoney(item.amount_minor, currency)}</small></article>`;
    }).join("");
  }

  function renderCategoryStats() {
    const list = element("financeCategoryStats");
    if (!list || !store) return;
    const bounds = monthBounds(currentMonth());
    const quote = displayCurrency();
    const snapshots = referenceSnapshots();
    const values = new Map();
    for (const item of Object.values(store.transactions)) {
      if (item.status !== "active" || item.direction !== "expense" || isAuthorizationControl(item) || (bounds && (item.occurred_at_ms < bounds.startMs || item.occurred_at_ms >= bounds.endMs))) continue;
      const ref = referenceValue(item, quote, { snapshots });
      if (ref.status !== "same_currency" && ref.status !== "reference") continue;
      const key = item.category_id || "uncategorized";
      values.set(key, (values.get(key) || 0) + ref.amount_minor);
    }
    const entries = [...values.entries()].sort((a, b) => b[1] - a[1]);
    const totalSpent = entries.reduce((sum, [, amt]) => sum + amt, 0) || 1;
    const maximum = entries[0]?.[1] || 1;
    list.innerHTML = entries.length ? entries.slice(0, 8).map(([id, amount], idx) => {
      const label = id === "uncategorized" ? "未分类" : categoryName(id);
      const pct = Math.max(1, Math.round((amount / totalSpent) * 100));
      const catColor = store.categories?.[id]?.color || `var(--ds-fin-chart-cat-${(idx % 6) + 1}, var(--ds-action-primary))`;
      return `<div class="finance-category-stat"><span class="finance-cat-label"><i class="finance-cat-dot" data-dot-color="${escapeHtml(catColor)}" aria-hidden="true"></i>${escapeHtml(label)} <small>${pct}%</small></span><progress max="${maximum}" value="${amount}" aria-label="${escapeHtml(label)} ${escapeHtml(formatFinanceMoney(amount, quote))}"></progress><strong>${escapeHtml(formatFinanceMoney(amount, quote))}</strong></div>`;
    }).join("") : '<p class="finance-empty-inline">本月还没有支出分类数据。</p>';
    list.querySelectorAll?.("[data-dot-color]")?.forEach?.((dot) => {
      dot.style.backgroundColor = dot.dataset.dotColor || "";
    });
  }

  function cancelDeferredRendering() {
    window.clearTimeout(searchTimer);
    window.clearTimeout(insightsTimer);
    window.cancelAnimationFrame(insightsFrame);
    searchTimer = insightsTimer = insightsFrame = 0;
  }

  function scheduleInsights() {
    const signature = JSON.stringify([currentAccountId, currentMonth(), store.categories, store.budgets,
      Object.values(store.transactions).map(item => [item.id, item.status, item.direction, item.amount_minor, item.category_id, item.occurred_at_ms])]);
    if (signature === insightsSignature) return;
    window.clearTimeout(insightsTimer);
    window.cancelAnimationFrame(insightsFrame);
    const accountId = currentAccountId;
    for (const id of ["financeBudgetSummary", "financeCategoryStats"]) element(id)?.setAttribute("aria-busy", "true");
    // Let the ledger paint before calculating the independent insight panels.
    insightsFrame = window.requestAnimationFrame(() => {
      insightsFrame = 0;
      insightsTimer = window.setTimeout(() => {
        insightsTimer = 0;
        if (!store || accountId !== currentAccountId || element("financePage")?.classList.contains("hidden")) return;
        renderBudgets();
        renderCategoryStats();
        renderAnalyticsHistory();
        insightsSignature = signature;
        for (const id of ["financeBudgetSummary", "financeCategoryStats"]) element(id)?.setAttribute("aria-busy", "false");
      }, 0);
    });
  }

  function renderUndo() {
    const bar = element("financeUndoBar");
    if (!bar) return;
    bar.classList.toggle("hidden", !undoTransactionId);
  }

  function renderAll() {
    if (!store) return;
    if (!hasAccess()) {
      setSyncState("需要财务会员", "warning", "财务数据仍保留，重新开通后可继续使用。 ");
      return;
    }
    renderCategoryOptions();
    renderSummary();
    renderTransactions();
    renderOverviewPanels();
    scheduleInsights();
    renderUndo();
    const pending = store.pending.length + Object.values(store.transactions).filter(item => item.native_notification_pending).length;
    element("financeResolveConflictBtn")?.classList.toggle("hidden", !conflictPending);
    if (conflictPending) setSyncState("需要处理冲突", "warning", `${pending} 项本地修改等待确认后重试。`);
    else if (syncPromise) setSyncState("同步中", "info", `${pending} 项本地修改正在同步。`);
    else if (store.last_error) setSyncState("同步失败", "error", `${store.last_error}${pending ? `；${pending} 项修改已安全保存在本机。` : ""}`);
    else if (pending) setSyncState(navigator.onLine === false ? "等待联网" : "等待同步", "warning", `${pending} 项本地修改尚未上传。`);
    else {
      setSyncState("已同步", "success", store.last_sync_at ? `最近同步：${new Date(store.last_sync_at).toLocaleString("zh-CN")}` : "云端数据已就绪。 ");
      const msgEl = element("financeMessage");
      if (msgEl && msgEl.textContent.includes("正在同步")) {
        setMessage("已保存并同步至云端。", "success", { autoDismissMs: 2800 });
      }
    }
  }

  function queueOperation(type, entity, payload = null) {
    ensureStore();
    const kind = type.split(".")[0];
    if (store.pending.length >= MAX_PENDING_OPERATIONS) throw new Error("本机待同步操作过多，请先联网完成同步");
    const baseRevision = Math.max(0, Number(entity.revision) || 0);
    const operation = {
      operation_id: randomId("op"),
      type,
      entity_id: entity.id,
      base_revision: baseRevision,
      ...(payload ? { payload } : {}),
      queued_at_ms: Date.now(),
    };
    store.pending.push(operation);
    const collection = financeCollection(store, kind);
    if (collection?.[entity.id]) collection[entity.id].revision = baseRevision + 1;
    persist();
    renderAll();
    if (navigator.onLine !== false) syncNow().catch(() => {});
    return operation;
  }

  function applyOperationResult(result) {
    for (const kind of VALID_ENTITY_KINDS) {
      const clean = entityNormalizer(kind)(result?.[kind]);
      const collection = financeCollection(store, kind);
      if (clean && collection) collection[clean.id] = clean;
    }
  }

  function applyChangesPayload(payload) {
    for (const change of Array.isArray(payload?.changes) ? payload.changes : []) {
      const hasPending = store.pending.some((operation) => operation.entity_id === change.entity_id);
      if (!hasPending) applyFinanceChange(store, change);
      else store.server_version = Math.max(store.server_version, Number(change.version || 0));
    }
    store.server_version = Math.max(store.server_version, Number(payload?.server_version || payload?.next_since || 0));
  }

  async function fetchAllTransactions(includeDeleted = true, owner = readOwner()) {
    const result = {};
    let before = "";
    let beforeId = "";
    for (let page = 0; page < 60; page += 1) {
      const query = new URLSearchParams({ limit: String(CLIENT_PAGE_SIZE), include_deleted: String(includeDeleted) });
      if (before) query.set("before", before);
      if (beforeId) query.set("before_id", beforeId);
      const data = await readForOwner(`/api/finance/transactions?${query}`, owner);
      for (const item of data.transactions || []) {
        const clean = normalizeTransaction(item);
        if (clean) result[clean.id] = clean;
      }
      if (!data.next_before || !data.next_before_id || (data.transactions || []).length < CLIENT_PAGE_SIZE) break;
      before = String(data.next_before);
      beforeId = String(data.next_before_id);
    }
    return result;
  }

  function mergeServerEntity(kind, item) {
    const clean = entityNormalizer(kind)(item);
    if (!clean) return;
    const hasPending = store.pending.some((operation) => operation.entity_id === clean.id);
    const collection = financeCollection(store, kind);
    if (!collection) return;
    const current = collection[clean.id];
    if (!hasPending && (!current || clean.revision >= current.revision)) collection[clean.id] = clean;
  }

  async function hydrate(owner) {
    const bootstrap = await readForOwner("/api/finance/bootstrap", owner);
    for (const category of bootstrap.categories || []) mergeServerEntity("category", category);
    for (const budget of bootstrap.budgets || []) mergeServerEntity("budget", budget);
    // A count mismatch means something never reached this client through the
    // change feed; re-read the server pages instead of trusting the cursor.
    const localActive = Object.values(store.transactions).filter((item) => item.status === "active").length;
    if (!store.hydrated || !store.notification_identity_hydrated || Number(bootstrap.transaction_count || 0) > localActive) {
      const serverTransactions = await fetchAllTransactions(true, owner);
      requireOwner(owner);
      for (const item of Object.values(serverTransactions)) mergeServerEntity("transaction", item);
      store.hydrated = true;
      store.notification_identity_hydrated = true;
      // Only a completed snapshot may advance to the bootstrap watermark.
      // A cheap count refresh must not skip edits/deletes in the change feed.
      store.server_version = Math.max(store.server_version, Number(bootstrap.server_version || 0));
    }
  }

  async function pullChanges(owner) {
    let since = store.server_version;
    for (let page = 0; page < 20; page += 1) {
      const data = await readForOwner(`/api/finance/changes?since=${encodeURIComponent(since)}&limit=250`, owner);
      applyChangesPayload(data);
      since = Number(data.next_since || data.server_version || since);
      if (!data.has_more) break;
    }
  }

  async function performSync(owner) {
    requireOwner(owner);
    conflictPending = false;
    store.last_error = "";
    renderAll();
    // Always ask for the bootstrap summary. It is a cheap read and it is the
    // repair path for a ledger that already advanced its cursor past a change
    // it never projected (for example an automatic Android booking that used
    // to be published as a raw_event change): when the server reports more
    // active transactions than this client holds, hydrate() re-pages the full
    // transaction list and merges it.
    await hydrate(owner);
    requireOwner(owner);
    await pullChanges(owner);
    requireOwner(owner);
    while (store.pending.length) {
      const batch = store.pending.slice(0, SYNC_BATCH_SIZE);
      const payloadOperations = batch.map(({ queued_at_ms: _queuedAt, ...operation }) => operation);
      const data = await api("/api/finance/sync", {
        schema_version: SCHEMA_VERSION,
        device_id: store.device_id,
        platform: "web",
        device_label: "浏览器",
        client_version: appVersion,
        since_version: store.server_version,
        operations: payloadOperations,
      }, { controller: owner.controller, timeoutMs: 30000 });
      requireOwner(owner);
      const completed = new Set(batch.map((item) => item.operation_id));
      store.pending = store.pending.filter((item) => !completed.has(item.operation_id));
      for (const result of data.operation_results || []) applyOperationResult(result);
      applyChangesPayload(data);
      persist();
    }
    await pullChanges(owner);
    requireOwner(owner);
    store.last_sync_at = timestamp();
    store.last_error = "";
    persist();
  }

  async function syncNow() {
    ensureStore();
    if (!hasAccess() || suspended) return false;
    invalidationGeneration += 1;
    if (syncPromise) return syncPromise;
    // navigator.onLine is only a hint. A real request is the authoritative
    // connectivity check, especially immediately after a network handoff.
    syncController = new AbortController();
    const owner = readOwner(syncController);
    // One drain owns every joined caller. Signals during a pull advance the
    // target; finite bursts coalesce into a fresh observation, even pending=0.
    // A failure exits without acknowledging its target (no retry spin).
    const run = Promise.resolve().then(async () => {
      do {
        const target = invalidationGeneration;
        await performSync(owner);
        requireOwner(owner);
        observedGeneration = target;
      } while (observedGeneration < invalidationGeneration);
      return true;
    }).catch((error) => {
      if (!ownerCurrent(owner)) return false;
      if (error?.name === "AbortError") return false;
      if (error?.code === "finance_membership_required") {
        serverDeniedAccess = true;
        element("financeLocked")?.classList.remove("hidden");
        element("financeWorkspace")?.classList.add("hidden");
        store.last_error = "当前会员不包含财务账本或权益已到期";
        setSyncState("需要财务会员", "warning", "财务数据仍保留在本机和云端，重新开通后可继续使用。 ");
        persist();
        return false;
      }
      if (["finance_write_conflict", "transaction_conflict", "finance_record_conflict", "sync_version_conflict"].includes(error?.code)) {
        conflictPending = true;
        store.last_error = "另一台设备已修改相关数据";
      } else {
        store.last_error = safeText(error?.message || "同步失败，请稍后重试", 240);
      }
      persist();
      return false;
    }).finally(() => {
      if (syncPromise !== run) return;
      syncPromise = null;
      syncController = null;
      renderAll();
    });
    syncPromise = run;
    renderAll();
    return syncPromise;
  }

  /**
   * Confirming a notification candidate creates a server transaction. Pull the
   * ledger again and verify the returned id is really present locally; if the
   * cursor path missed it, force a full transaction pull before reporting
   * success, so the UI can never claim "记账成功" while the list stays empty.
   */
  async function verifyTransaction(transactionId) {
    ensureStore();
    const owner = readOwner();
    await syncNow();
    if (!ownerCurrent(owner)) return false;
    if (!transactionId) return true;
    if (store.transactions[transactionId]) {
      renderAll();
      return true;
    }
    try {
      const remote = await fetchAllTransactions(true, owner);
      requireOwner(owner);
      for (const item of Object.values(remote)) mergeServerEntity("transaction", item);
      persist();
      renderAll();
    } catch (_) {
      // Fall through: the caller reports the honest result.
    }
    return ownerCurrent(owner) && Boolean(store.transactions[transactionId]);
  }

  async function resolveConflict() {
    ensureStore();
    const owner = readOwner();
    const remoteTransactions = await fetchAllTransactions(true, owner);
    const bootstrap = await readForOwner("/api/finance/bootstrap", owner);
    const remote = {
      transaction: remoteTransactions,
      category: Object.fromEntries((bootstrap.categories || []).map((item) => [item.id, item])),
      budget: Object.fromEntries((bootstrap.budgets || []).map((item) => [item.id, item])),
    };
    const rebased = [];
    const predictedRevision = new Map();
    for (const operation of store.pending) {
      const kind = operation.type.split(".")[0];
      const serverItem = entityNormalizer(kind)(remote[kind][operation.entity_id]);
      const targetStatus = operation.type.endsWith(".delete") ? "deleted" : operation.type.endsWith(".restore") ? "active" : "";
      if (targetStatus && serverItem?.status === targetStatus) {
        const collection = financeCollection(store, kind);
        if (serverItem && collection) collection[serverItem.id] = serverItem;
        continue;
      }
      const revisionKey = `${kind}:${operation.entity_id}`;
      const baseRevision = predictedRevision.has(revisionKey)
        ? predictedRevision.get(revisionKey)
        : Number(serverItem?.revision || 0);
      rebased.push({ ...operation, operation_id: randomId("op"), base_revision: baseRevision, queued_at_ms: Date.now() });
      predictedRevision.set(revisionKey, baseRevision + 1);
    }
    store.pending = rebased;
    store.server_version = Number(bootstrap.server_version || store.server_version);
    conflictPending = false;
    store.last_error = "";
    for (const [revisionKey, revision] of predictedRevision.entries()) {
      const [kind, ...idParts] = revisionKey.split(":");
      const id = idParts.join(":");
      const collection = financeCollection(store, kind);
      if (collection?.[id]) collection[id].revision = revision;
    }
    persist();
    renderAll();
    return syncNow();
  }

  function openLayer(id) {
    if (openDialog) return openDialog(id);
    const layer = element(id);
    if (!layer) return;
    layer.classList.remove("hidden");
    layer.setAttribute("aria-hidden", "false");
    layer.querySelector("input:not([type=hidden]), select, button")?.focus();
  }

  function closeLayer(id) {
    if (closeDialog) return closeDialog(id);
    const layer = element(id);
    if (!layer) return;
    layer.classList.add("hidden");
    layer.setAttribute("aria-hidden", "true");
  }

  function openTransactionEditor(id = "") {
    ensureStore();
    const item = id ? store.transactions[id] : null;
    if (item?.native_notification_pending) { setMessage("已记账，正在等待云端同步；同步完成后可编辑。", "info"); return; }
    const currency = item?.currency || accountCurrency();
    element("financeTransactionId").value = item?.id || "";
    element("financeTransactionDirection").value = item?.direction || "expense";
    if (element("financeTransactionCurrency")) element("financeTransactionCurrency").value = currency;
    element("financeTransactionAmount").value = item ? moneyText(item.amount_minor, currency) : "";
    element("financeTransactionCategory").value = item?.category_id || "";
    element("financeTransactionMerchant").value = item?.merchant || "";
    element("financeTransactionCounterparty").value = item?.counterparty || "";
    element("financeTransactionNote").value = item?.note || "";
    const date = item ? new Date(item.occurred_at_ms) : new Date();
    const offset = date.getTimezoneOffset() * 60000;
    element("financeTransactionTime").value = new Date(date.getTime() - offset).toISOString().slice(0, 16);
    element("financeTransactionModalTitle").textContent = item ? "编辑账目" : "新增账目";
    const metaBox = element("financeTransactionDrawerMeta");
    if (metaBox) {
      if (item) {
        const dirLabel = { income: "收入", expense: "支出", refund: "退款" }[item.direction] || item.direction;
        const sourceLabel = item.source_kind === "automatic" ? "Android 自动识别" : "手动记账";
        const syncLabel = item.native_notification_pending ? "待同步" : "已同步";
        metaBox.innerHTML = `<span class="finance-direction is-${escapeHtml(item.direction)}">${dirLabel}</span><span>${sourceLabel}</span><span>${syncLabel} · v${Number(item.revision || 0)}</span>`;
        metaBox.classList.remove("hidden");
      } else {
        metaBox.innerHTML = "";
        metaBox.classList.add("hidden");
      }
    }
    const drawerDeleteBtn = element("financeTransactionDrawerDeleteBtn");
    if (drawerDeleteBtn) {
      drawerDeleteBtn.classList.toggle("hidden", !item || item.status === "deleted");
    }
    setMessage();
    openLayer("financeTransactionModal");
  }

  function submitTransaction(event) {
    event.preventDefault();
    ensureStore();
    const currency = element("financeTransactionCurrency")?.value || "CNY";
    const amountValidation = validateAmountText(element("financeTransactionAmount").value, "金额", currency);
    if (!amountValidation.valid) return invalidField(element("financeTransactionAmount"), amountValidation.message);
    const amountMinor = amountValidation.amountMinor;
    const occurredAt = new Date(element("financeTransactionTime").value).getTime();
    if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0) return invalidField(element("financeTransactionTime"), "请选择有效的交易时间");
    const id = element("financeTransactionId").value || randomId("txn");
    const current = store.transactions[id];
    const item = normalizeTransaction({
      id,
      direction: element("financeTransactionDirection").value,
      amount_minor: amountMinor,
      currency,
      amount_exponent: amountValidation.amountExponent,
      category_id: element("financeTransactionCategory").value,
      merchant: element("financeTransactionMerchant").value,
      counterparty: element("financeTransactionCounterparty").value,
      note: element("financeTransactionNote").value,
      occurred_at_ms: occurredAt,
      source_kind: current?.source_kind || "manual",
      reconciliation_state: current?.reconciliation_state || "confirmed",
      status: "active",
      revision: current?.revision || 0,
      sync_version: current?.sync_version || 0,
      created_at: current?.created_at || timestamp(),
      updated_at: timestamp(),
      deleted_at: "",
      ...(current?.currency_review_required ? { currency_review_required: false, currency_decision_source: "user_confirmed" } : {}),
    });
    if (!item) return setMessage("账目内容无效，请检查后重试。", "error");
    store.transactions[id] = item;
    queueOperation("transaction.upsert", item, transactionPayload(item, {
      currency_review_acknowledged: Boolean(current?.currency_review_required),
    }));
    closeLayer("financeTransactionModal");
    setMessage(current ? "账目已在本机更新，正在同步。" : "账目已在本机保存，正在同步。", "success");
  }

  function deleteTransaction(id) {
    const item = store.transactions[id];
    if (item?.native_notification_pending) { setMessage("已记账，正在等待云端同步；同步完成后可删除。", "info"); return; }
    if (!item || item.status === "deleted") return;
    store.transactions[id] = { ...item, status: "deleted", deleted_at: timestamp(), updated_at: timestamp() };
    undoTransactionId = id;
    queueOperation("transaction.delete", item);
    setMessage("账目已删除，可立即撤销。", "success");
  }

  function restoreTransaction(id) {
    const item = store.transactions[id];
    if (!item || item.status !== "deleted") return;
    store.transactions[id] = { ...item, status: "active", deleted_at: "", updated_at: timestamp() };
    undoTransactionId = "";
    queueOperation("transaction.restore", item);
    setMessage("账目已恢复。", "success");
  }

  function renderCategoryManager() {
    const list = element("financeCategoryManagerList");
    if (!list) return;
    const categories = activeValues("categories").sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    list.innerHTML = categories.length ? categories.map((item) => `<div class="finance-manager-row"><span><input class="finance-color-chip" type="color" value="${escapeHtml(item.color)}" disabled tabindex="-1" aria-hidden="true" /><strong>${escapeHtml(item.name)}</strong><small>${{ income: "仅收入", expense: "仅支出", both: "收入和支出" }[item.applies_to]}</small></span><span><button type="button" data-finance-category-edit="${escapeHtml(item.id)}">编辑</button><button class="danger-text" type="button" data-finance-category-delete="${escapeHtml(item.id)}">删除</button></span></div>`).join("") : '<p class="finance-empty-inline">还没有自定义分类。</p>';
  }

  function openCategoryManager() {
    element("financeCategoryId").value = "";
    element("financeCategoryName").value = "";
    element("financeCategoryAppliesTo").value = "both";
    element("financeCategoryColor").value = "#2563eb";
    renderCategoryManager();
    openLayer("financeCategoryModal");
  }

  function editCategory(id) {
    const item = store.categories[id];
    if (!item) return;
    element("financeCategoryId").value = item.id;
    element("financeCategoryName").value = item.name;
    element("financeCategoryAppliesTo").value = item.applies_to;
    element("financeCategoryColor").value = item.color;
    element("financeCategoryName").focus();
  }

  function submitCategory(event) {
    event.preventDefault();
    const nameInput = element("financeCategoryName");
    const normalizedName = safeText(nameInput.value, 80);
    if (!normalizedName) return invalidField(nameInput, "请输入分类名称");
    const id = element("financeCategoryId").value || randomId("cat");
    if (activeValues("categories").some((item) => item.id !== id && item.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
      return invalidField(nameInput, "已有同名分类");
    }
    const current = store.categories[id];
    const item = normalizeCategory({
      id,
      name: normalizedName,
      applies_to: element("financeCategoryAppliesTo").value,
      color: element("financeCategoryColor").value,
      status: "active",
      revision: current?.revision || 0,
      sync_version: current?.sync_version || 0,
      updated_at: timestamp(),
    });
    if (!item) return setMessage("分类名称不能为空。", "error");
    store.categories[id] = item;
    queueOperation("category.upsert", item, categoryPayload(item));
    element("financeCategoryId").value = "";
    element("financeCategoryName").value = "";
    renderCategoryManager();
  }

  function deleteCategory(id) {
    if (Object.values(store.transactions).some((item) => item.status === "active" && item.category_id === id)
        || Object.values(store.budgets).some((item) => item.status === "active" && item.category_id === id)) {
      setMessage("该分类仍被账目或预算使用，请先调整相关记录。", "error");
      return;
    }
    const item = store.categories[id];
    if (!item) return;
    store.categories[id] = { ...item, status: "deleted", deleted_at: timestamp() };
    queueOperation("category.delete", item);
    renderCategoryManager();
  }

  function renderBudgetManager() {
    const list = element("financeBudgetManagerList");
    if (!list) return;
    const budgets = activeValues("budgets");
    list.innerHTML = budgets.length ? budgets.map((item) => {
      const currency = item.currency || "CNY";
      return `<div class="finance-manager-row"><span><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}${currency !== "CNY" ? `（${currency}）` : ""}</strong><small>${escapeHtml(item.starts_on)} 至 ${escapeHtml(item.ends_on)} · ${escapeHtml(formatFinanceMoney(item.amount_minor, currency))}</small></span><span><button type="button" data-finance-budget-edit="${escapeHtml(item.id)}">编辑</button><button class="danger-text" type="button" data-finance-budget-delete="${escapeHtml(item.id)}">删除</button></span></div>`;
    }).join("") : '<p class="finance-empty-inline">还没有预算。</p>';
  }

  function openBudgetManager() {
    element("financeBudgetId").value = "";
    element("financeBudgetAmount").value = "";
    element("financeBudgetMonth").value = monthKey();
    element("financeBudgetCategory").value = "";
    if (element("financeBudgetCurrency")) element("financeBudgetCurrency").value = accountCurrency();
    renderBudgetManager();
    openLayer("financeBudgetModal");
  }

  function editBudget(id) {
    const item = store.budgets[id];
    if (!item) return;
    const currency = item.currency || "CNY";
    element("financeBudgetId").value = item.id;
    if (element("financeBudgetCurrency")) element("financeBudgetCurrency").value = currency;
    element("financeBudgetAmount").value = moneyText(item.amount_minor, currency);
    element("financeBudgetMonth").value = item.starts_on?.slice(0, 7) || monthKey();
    element("financeBudgetCategory").value = item.category_id;
    element("financeBudgetAmount").focus();
  }

  function submitBudget(event) {
    event.preventDefault();
    const bounds = monthBounds(element("financeBudgetMonth").value);
    const currency = element("financeBudgetCurrency")?.value || "CNY";
    const amountValidation = validateAmountText(element("financeBudgetAmount").value, "预算金额", currency);
    if (!bounds) return invalidField(element("financeBudgetMonth"), "请选择有效月份");
    if (!amountValidation.valid) return invalidField(element("financeBudgetAmount"), amountValidation.message);
    const amountMinor = amountValidation.amountMinor;
    const categoryId = element("financeBudgetCategory").value;
    const matching = activeValues("budgets").find((item) => item.category_id === categoryId
      && item.starts_on === bounds.startDate && item.ends_on === bounds.endDate
      && (item.currency || "CNY") === currency);
    const id = element("financeBudgetId").value || matching?.id || randomId("budget");
    const current = store.budgets[id];
    const item = normalizeBudget({
      id,
      category_id: categoryId,
      period_type: "monthly",
      amount_minor: amountMinor,
      currency,
      amount_exponent: amountValidation.amountExponent,
      starts_on: bounds.startDate,
      ends_on: bounds.endDate,
      status: "active",
      revision: current?.revision || 0,
      sync_version: current?.sync_version || 0,
      updated_at: timestamp(),
    });
    if (!item) return setMessage("预算内容无效。", "error");
    store.budgets[id] = item;
    queueOperation("budget.upsert", item, budgetPayload(item));
    element("financeBudgetId").value = "";
    element("financeBudgetAmount").value = "";
    renderBudgetManager();
  }

  function deleteBudget(id) {
    const item = store.budgets[id];
    if (!item) return;
    store.budgets[id] = { ...item, status: "deleted", deleted_at: timestamp() };
    queueOperation("budget.delete", item);
    renderBudgetManager();
  }

  function handlePageClick(event) {
    const button = event.target.closest("button");
    if (!button) {
      const row = event.target.closest(".finance-transaction[data-finance-transaction]");
      if (row && !row.classList.contains("is-deleted") && !event.target.closest("a, input, select")) {
        openTransactionEditor(row.dataset.financeTransaction);
      }
      return;
    }
    if (button.dataset.financeTab) {
      setSubView(button.dataset.financeTab);
      return;
    }
    if (button.dataset.financeTrendRange) {
      const months = Number(button.dataset.financeTrendRange);
      if ([3, 6, 12].includes(months) && months !== trendRangeMonths) {
        trendRangeMonths = months;
        activeChartHoverIdx = -1;
        renderTrendChart();
      }
      return;
    }
    if (button.id === "financeAddTransactionBtn") openTransactionEditor();
    else if (button.id === "financeTransactionDrawerDeleteBtn") {
      const txId = element("financeTransactionId")?.value;
      if (txId) { deleteTransaction(txId); closeLayer("financeTransactionModal"); }
    }
    else if (button.id === "financeAllMonthsBtn") { ledgerAllMonths = true; renderAll(); }
    else if (button.id === "financeSelectedMonthBtn") { ledgerAllMonths = false; renderAll(); }
    else if (button.id === "financeLedgerMoreBtn") { ledgerLimit += CLIENT_PAGE_SIZE; renderTransactions(); }
    else if (button.id === "financeManageCategoriesBtn") openCategoryManager();
    else if (button.id === "financeManageBudgetsBtn") openBudgetManager();
    else if (button.id === "financeSyncBtn") syncNow();
    else if (button.id === "financeResolveConflictBtn") resolveConflict().catch((error) => setMessage(error.message, "error"));
    else if (button.id === "toggleFinanceTrendBtn") {
      setTrendOpen(!isTrendOpen());
    }
    else if (button.id === "financePrivacyBtn" || button.dataset.financeAction === "toggle-privacy") {
      const finPage = element("financePage");
      const headerPrivacy = element("financePrivacyBtn");
      if (finPage) {
        const masked = finPage.dataset.privacyMask === "true";
        const next = !masked;
        finPage.dataset.privacyMask = String(next);
        if (headerPrivacy) {
          headerPrivacy.setAttribute("aria-pressed", String(next));
          headerPrivacy.textContent = next ? "显示金额" : "隐藏金额";
        }
      }
    }
    else if (button.id === "financeUpgradeBtn") openRecharge("finance");
    else if (button.id === "financeBackBtn") navigate("/select");
    else if (button.id === "financeUndoBtn" && undoTransactionId) restoreTransaction(undoTransactionId);
    else if (button.dataset.financeEdit) openTransactionEditor(button.dataset.financeEdit);
    else if (button.dataset.financeDelete) deleteTransaction(button.dataset.financeDelete);
    else if (button.dataset.financeRestore) restoreTransaction(button.dataset.financeRestore);
    else if (button.dataset.financeCategoryEdit) editCategory(button.dataset.financeCategoryEdit);
    else if (button.dataset.financeCategoryDelete) deleteCategory(button.dataset.financeCategoryDelete);
    else if (button.dataset.financeBudgetEdit) editBudget(button.dataset.financeBudgetEdit);
    else if (button.dataset.financeBudgetDelete) deleteBudget(button.dataset.financeBudgetDelete);
    else if (button.dataset.financeAction === "sync") syncNow();
    else if (button.dataset.financeAction === "add") openTransactionEditor();
    else if (button.dataset.financeAction === "go-ledger") setSubView("ledger");
    else if (button.dataset.financeAction === "go-analytics") setSubView("analytics");
    else if (button.dataset.financeAction === "go-settings") setSubView("settings");
    else if (button.dataset.financeAction === "categories") openCategoryManager();
    else if (button.dataset.financeAction === "budgets") openBudgetManager();
    else if (button.dataset.financeAction === "all-months") { ledgerAllMonths = true; renderAll(); }
    else if (button.dataset.financeAction === "clear-filters") {
      if (element("financeSearchInput")) element("financeSearchInput").value = "";
      if (element("financeDirectionFilter")) element("financeDirectionFilter").value = "";
      if (element("financeCategoryFilter")) element("financeCategoryFilter").value = "";
      if (element("financeStatusFilter")) element("financeStatusFilter").value = "active";
      renderTransactions();
    }
    else if (button.dataset.financeClose) closeLayer(button.dataset.financeClose);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    recordedDisclosure = createFinanceDisclosure({ element: element("financeRecordedSection"), storage,
      accountId: () => account()?.id, section: "recorded", defaultOpen: true });
    recordedDisclosure.restore();
    restoreTrendState();
    element("financePage")?.addEventListener("click", handlePageClick);
    for (const id of ["financeTransactionModal", "financeCategoryModal", "financeBudgetModal"]) element(id)?.addEventListener("click", handlePageClick);
    element("financeTransactionForm")?.addEventListener("submit", submitTransaction);
    element("financeCategoryForm")?.addEventListener("submit", submitCategory);
    element("financeBudgetForm")?.addEventListener("submit", submitBudget);
    element("financeMonthFilter")?.addEventListener("change", () => { ledgerAllMonths = false; renderAll(); });
    element("financeHistoryMonthSelect")?.addEventListener("change", (event) => {
      if (!/^\d{4}-\d{2}$/.test(event.target.value)) return;
      element("financeMonthFilter").value = event.target.value;
      ledgerAllMonths = false;
      renderAll();
    });
    element("financeSearchInput")?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      element("financeTransactionList")?.setAttribute("aria-busy", "true");
      searchTimer = window.setTimeout(() => { searchTimer = 0; renderTransactions(); }, 160);
    });
    for (const id of ["financeDirectionFilter", "financeCategoryFilter", "financeStatusFilter"]) {
      element(id)?.addEventListener("change", renderTransactions);
    }
    element("financeDisplayCurrency")?.addEventListener("change", (e) => saveCurrencyPreference("display_currency", e.target.value));
    element("financeAccountCurrency")?.addEventListener("change", (e) => saveCurrencyPreference("account_currency", e.target.value));
    element("financeDefaultCurrency")?.addEventListener("change", (e) => saveCurrencyPreference("default_currency", e.target.value));
    window.addEventListener("online", () => {
      if (!element("financePage")?.classList.contains("hidden")) syncNow();
    });
    document.addEventListener("thewyj:payment-updated", () => {
      ensureStore();
      if (!element("financePage")?.classList.contains("hidden")) { renderAll(); void syncNow(); }
    });
  }

  async function show(options = {}) {
    suspended = false;
    ledgerRows.resume();
    initialize();
    ensureStore();
    const allowed = hasAccess();
    element("financeLocked")?.classList.toggle("hidden", allowed);
    element("financeWorkspace")?.classList.toggle("hidden", !allowed);
    if (!allowed) {
      setSyncState("需要财务会员", "warning", "财务会员 8 CNY/月；全功能会员已自动包含。 ");
      return false;
    }
    if (options?.subView) setSubView(options.subView, { syncHistory: false });
    else setSubView(activeSubView || "overview", { syncHistory: false });
    if (element("financeMonthFilter") && !element("financeMonthFilter").value) element("financeMonthFilter").value = monthKey();
    renderAll();
    void fetchCurrencyPreferences();
    void loadReferences();
    await syncNow();
    return true;
  }

  function hide() {
    suspended = true;
    cancelSync();
    ledgerRows.park();
    cancelDeferredRendering();
    for (const id of ["financeTransactionModal", "financeCategoryModal", "financeBudgetModal"]) closeLayer(id);
    // Undo is intentionally page-local. Keeping it across route changes made a
    // stale green「账目已删除 · 撤销」bar reappear on unrelated screens and after
    // returning to Finance long after the delete operation.
    undoTransactionId = "";
    renderUndo();
    setMessage();
  }

  function resetAccount() {
    resetCurrencyState();
    ledgerRows.clear();
    cancelDeferredRendering();
    insightsSignature = "";
    ledgerFilter = "";
    ledgerLimit = CLIENT_PAGE_SIZE;
    ledgerAllMonths = false;
    cancelSync();
    store = null;
    currentAccountId = "";
    conflictPending = false;
    undoTransactionId = "";
    serverDeniedAccess = false;
  }

  function accountUpdated() {
    serverDeniedAccess = false;
    if (element("financePage")?.classList.contains("hidden")) return;
    const nextAccountId = String(account()?.id || "");
    const allowed = hasAccess();
    const lockedHidden = element("financeLocked")?.classList.contains("hidden");
    const sameAccount = Boolean(store) && currentAccountId === nextAccountId;
    const accessChanged = allowed !== Boolean(lockedHidden);
    if (sameAccount && !accessChanged && allowed) {
      void fetchCurrencyPreferences();
      void loadReferences();
      void syncNow();
      return;
    }
    show();
  }

  function dashboardSummary() {
    const value = account();
    if (!value?.id) return { balance_minor: 0, pending: 0, available: false };
    ensureStore();
    const summary = calculateFinanceSummary(Object.values(store.transactions), summaryOptions(monthKey()));
    return { ...summary, pending: store.pending.length, available: hasAccess(), last_sync_at: store.last_sync_at };
  }

  return Object.freeze({ show, hide, syncNow, verifyTransaction, resetAccount, accountUpdated, dashboardSummary, setSubView, render: renderAll });
}
