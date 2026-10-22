import { randomId as capabilityRandomId } from "../core/capabilities.js?v=20261014-aeris-task26-r9";
import { createFinanceDisclosure } from "./disclosure.js?v=20261014-aeris-task26-r9";
import { mergeLocalNotificationLedger } from "./notification-ledger.js?v=20261014-aeris-task26-r9";
import { reconcileKeyedRows } from "../core/keyed-list.js?v=20261014-aeris-task26-r9";
import { formatFinanceMoney } from "./format.js?v=20261014-aeris-task26-r9";
import { createParkedRows } from "../core/parked-rows.js?v=20261014-aeris-task26-r9";
import { parseMoney, moneyText, referenceValue, SUPPORTED_CURRENCIES, currencyDigits } from './money.js';
export { formatFinanceMoney } from "./format.js?v=20261014-aeris-task26-r9";
const SCHEMA_VERSION = 1;
const MAX_LOCAL_TRANSACTIONS = 5000;
const MAX_PENDING_OPERATIONS = 500;
const CLIENT_PAGE_SIZE = 100;
const SYNC_BATCH_SIZE = 80;
const VALID_DIRECTIONS = new Set(["income", "expense", "refund"]);
const AUTHORIZATION_CONTROL_STATES = new Set(["pending_authorization", "authorization_release", "authorization_expired"]);
const AUTHORIZATION_CONTROL_DIRECTIONS = new Set(["authorization_release", "authorization_expired"]);
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

// Explicit legacy control metadata is evidence of a hold, never a posted cash
// movement. Preserve the original row for audit; do not infer links by amount.
function isAuthorizationControl(item) {
  return AUTHORIZATION_CONTROL_STATES.has(safeText(item?.payment_state, 40).toLowerCase())
    || AUTHORIZATION_CONTROL_DIRECTIONS.has(safeText(item?.direction, 24).toLowerCase());
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
    if (status !== "all" && isAuthorizationControl(item)) continue;
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

export function amountTextToMinor(value, currency = 'CNY') {
  try { const amount = parseMoney(value, currency); return amount > 0 && amount <= 10_000_000_000_000 ? amount : 0; }
  catch (_) { return 0; }
}

function normalizeTransaction(value) {
  if (!value || typeof value !== "object") return null;
  const id = safeText(value.id, 80);
  const direction = safeText(value.direction, 24).toLowerCase();
  const amountMinor = Number(value.amount_minor);
  const occurredAt = Number(value.occurred_at_ms);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(id) || (!VALID_DIRECTIONS.has(direction) && !AUTHORIZATION_CONTROL_DIRECTIONS.has(direction))
      || !Number.isSafeInteger(amountMinor) || amountMinor <= 0
      || !Number.isSafeInteger(occurredAt) || occurredAt <= 0) return null;
  return {
    id,
    direction,
    ...(value.payment_state ? { payment_state: safeText(value.payment_state, 40).toLowerCase() } : {}),
    ...(value.provider_reference ? { provider_reference: safeText(value.provider_reference, 160) } : {}),
    amount_minor: amountMinor,
    currency: String(value.currency || '').trim().toUpperCase(),
    ...(value.currency === 'JPY' ? { amount_exponent: value.amount_exponent === 0 ? 0 : null,
      money_unit_status: value.amount_exponent === 0 ? 'verified' : 'review_required' } : {}),
    ...(!SUPPORTED_CURRENCIES.includes(value.currency) ? { money_unit_status: 'review_required' } : {}),
    ...(value.fx_snapshot ? { fx_snapshot: value.fx_snapshot } : {}),
    ...(value.fx_snapshots ? { fx_snapshots: value.fx_snapshots } : {}),
    ...(value.currency_role_evidence ? { currency_role_evidence: value.currency_role_evidence } : {}),
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
    currency: String(value.currency || ''),
    ...(value.currency === 'JPY' ? { amount_exponent: value.amount_exponent === 0 ? 0 : null, money_unit_status: value.amount_exponent === 0 ? 'verified' : 'review_required' } : {}),
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
    ...(value.legacy_authorization_control === true ? { legacy_authorization_control: true } : {}),
    ...(value.legacy_authorization_original_payload && typeof value.legacy_authorization_original_payload === "object"
      ? { legacy_authorization_original_payload: value.legacy_authorization_original_payload } : {}),
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
    money_version: 0,
    currency_preferences: { account_currency: 'CNY', display_currency: 'CNY', default_currency: null, revision: 0 },
    currency_preferences_pending: null,
    currency_preferences_conflict: null,
    fx_snapshots: {},
    currency_error: '',
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
  result.money_version = source.money_version === 2 ? 2 : 0;
  if (SUPPORTED_CURRENCIES.includes(source.currency_preferences?.display_currency)) result.currency_preferences = source.currency_preferences;
  result.currency_preferences_pending = source.currency_preferences_pending || null;
  result.currency_preferences_conflict = source.currency_preferences_conflict || null;
  if (source.fx_snapshots && typeof source.fx_snapshots === 'object') result.fx_snapshots = source.fx_snapshots;
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
  for (const operation of result.pending) {
    if (operation.type.startsWith("transaction.") && (operation.legacy_authorization_control || isAuthorizationControl(operation.payload) || isAuthorizationControl(result.transactions[operation.entity_id]))) {
      operation.legacy_authorization_control = true;
      if (operation.type === "transaction.upsert") {
        // Preserve the original structured payload. A marker in the queued
        // copy also makes pre-fix clients fail the existing server allowlist,
        // rather than dropping our local flag and uploading a hold as spend.
        operation.legacy_authorization_original_payload ||= operation.payload;
        operation.payload = { ...operation.payload, payment_state: operation.payload.payment_state || "pending_authorization" };
      }
    }
  }
  result.last_sync_at = safeText(source.last_sync_at, 40);
  result.last_error = safeText(source.last_error, 240);
  return result;
}

export function calculateFinanceSummary(transactions, options = {}) {
  const bounds = options.month ? monthBounds(options.month) : null;
  const active = (Array.isArray(transactions) ? transactions : []).filter((item) => {
    if (!item || item.status === "deleted" || isAuthorizationControl(item)) return false;
    if (!bounds) return true;
    return item.occurred_at_ms >= bounds.startMs && item.occurred_at_ms < bounds.endMs;
  });
  const summary = { income_minor: 0, expense_minor: 0, refund_minor: 0, balance_minor: 0, count: active.length };
  const currencies = [...new Set(active.map(item => item.currency || 'CNY'))];
  const quote = options.display_currency || (currencies.length === 1 ? currencies[0] : 'CNY');
  const unconverted = [], byCurrency = {};
  const exact = { income_minor: 0n, expense_minor: 0n, refund_minor: 0n };
  for (const item of active) {
    const value = referenceValue(item, quote, options);
    const bucket = byCurrency[item.currency] ||= { income_minor: 0n, expense_minor: 0n, refund_minor: 0n };
    if (Object.hasOwn(bucket, item.direction + '_minor') && Number.isSafeInteger(item.amount_minor)) bucket[item.direction + '_minor'] += BigInt(item.amount_minor);
    if (!['same_currency', 'reference'].includes(value.status)) { unconverted.push({ id: item.id, currency: item.currency, reason: value.status }); continue; }
    if (Object.hasOwn(exact, item.direction + '_minor')) exact[item.direction + '_minor'] += BigInt(value.amount_minor);
  }
  exact.balance_minor = exact.income_minor + exact.refund_minor - exact.expense_minor;
  for (const [key, value] of Object.entries(exact)) {
    summary[key] = value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  const overflow = Object.values(summary).some(value => value === null);
  for (const bucket of Object.values(byCurrency)) for (const [key, value] of Object.entries(bucket)) bucket[key] = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (currencies.length > 1 || unconverted.length || (currencies.length === 1 && quote !== currencies[0])) {
    Object.assign(summary, { display_currency: quote, by_currency: byCurrency, unconverted,
      conversion_status: unconverted.length ? unconverted[0].reason : 'reference', reference_only: true });
  }
  if (overflow) Object.assign(summary, { has_overflow: true, conversion_status: 'amount_overflow' });
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
    if (status !== "all" && isAuthorizationControl(item)) return false;
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

function transactionPayload(transaction) {
  return {
    direction: transaction.direction,
    amount_minor: transaction.amount_minor,
    currency: transaction.currency,
    ...(transaction.currency === 'JPY' ? { amount_exponent: transaction.amount_exponent } : {}),
    category_id: transaction.category_id,
    merchant: transaction.merchant,
    counterparty: transaction.counterparty,
    note: transaction.note,
    occurred_at_ms: transaction.occurred_at_ms,
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
    ...(budget.currency === 'JPY' ? { amount_exponent: budget.amount_exponent } : {}),
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

  function mergeNativeReferences(snapshot, accountId) {
    if (!store || snapshot?.account_id !== accountId || !snapshot.fx_snapshots) return false;
    let changed = false;
    for (const item of Object.values(store.transactions)) for (const quote of SUPPORTED_CURRENCIES) {
      const key = `${item.id}:${item.revision || 0}:${quote}`;
      const reference = snapshot.fx_snapshots[key];
      if (!reference || store.fx_snapshots[key] || !reference.historical_reference || reference.original_minor !== item.amount_minor || reference.base !== item.currency) continue;
      if (referenceValue(item, quote, { snapshots: { [key]: reference } }).status !== 'reference') continue;
      store.fx_snapshots[key] = reference; changed = true;
    }
    return changed;
  }

  function mergeNativeSnapshot(accountId) {
    const snapshot = globalThis.window?.WYJLocalPaymentLedger;
    const ledgerChanged = mergeLocalNotificationLedger(store.transactions, snapshot, accountId);
    const referencesChanged = mergeNativeReferences(snapshot, accountId);
    if (ledgerChanged || referencesChanged) persist();
  }

  function ensureStore() {
    const nextAccountId = String(account()?.id || "");
    if (!nextAccountId) return null;
    if (store && currentAccountId === nextAccountId) {
      mergeNativeSnapshot(nextAccountId);
      return store;
    }
    if (currentAccountId !== nextAccountId) cancelSync();
    currentAccountId = nextAccountId;
    store = normalizeStore(safeJson(storage.getItem(storageKey(nextAccountId)), {}), nextAccountId, deviceId());
    mergeNativeSnapshot(nextAccountId);
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
    const result = await apiGet(path, { controller: owner.controller, financeMoneyVersion: 2 });
    requireOwner(owner);
    return result;
  }

  function persist() {
    if (!store || !currentAccountId) return;
    try {
      storage.setItem(storageKey(currentAccountId), JSON.stringify({ ...store, currency_cache_warning: '' }));
      store.currency_cache_warning = '';
    } catch (error) {
      if (!Object.keys(store.fx_snapshots || {}).length) throw error;
      // Cache pressure must not discard ledger data or durable operations.
      store.currency_cache_warning = '汇率缓存空间不足；原币账本和待同步操作已保留。历史参考可联网重新读取。';
      storage.setItem(storageKey(currentAccountId), JSON.stringify({ ...store, fx_snapshots: {} }));
    }
    onSummaryChanged();
  }

  function hasAccess() {
    const value = account();
    return Boolean(!serverDeniedAccess && value && (isSuperAdmin(value) || hasEntitlement("finance_access", value) || hasEntitlement("all_features_access", value)));
  }

  function activeValues(kind) {
    ensureStore();
    return Object.values(store?.[kind] || {}).filter((item) => item.status !== "deleted");
  }

  function setMessage(message = "", tone = "") {
    const target = element("financeMessage");
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
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
    const currency = store.currency_preferences.display_currency;
    const summary = calculateFinanceSummary(Object.values(store.transactions), { month: currentMonth(), display_currency: currency, snapshots: store.fx_snapshots });
    if (element("financeIncomeTotal")) element("financeIncomeTotal").textContent = formatFinanceMoney(summary.income_minor, currency);
    if (element("financeExpenseTotal")) element("financeExpenseTotal").textContent = formatFinanceMoney(summary.expense_minor, currency);
    if (element("financeRefundTotal")) element("financeRefundTotal").textContent = formatFinanceMoney(summary.refund_minor, currency);
    if (element("financeBalanceTotal")) element("financeBalanceTotal").textContent = formatFinanceMoney(summary.balance_minor, currency);
    if (element('financeDisplayCurrency')) element('financeDisplayCurrency').value = currency;
    if (element('financeAccountCurrency')) element('financeAccountCurrency').value = store.currency_preferences.account_currency;
    if (element('financeDefaultCurrency')) element('financeDefaultCurrency').value = store.currency_preferences.default_currency || '';
    if (element('financeCurrencyStatus')) element('financeCurrencyStatus').textContent = summary.unconverted?.length
      ? `${summary.unconverted.length} 笔待换算或单位待核实；上方仅汇总已核实部分。原币金额保留。${store.currency_error || ''}`
      : `展示币种 ${currency}${summary.reference_only ? ' · 市场参考折算，不是实际成交金额' : ''}${store.currency_error ? ' · ' + store.currency_error : ''}`;
    if (store.currency_cache_warning && element('financeCurrencyStatus')) element('financeCurrencyStatus').textContent += ' · ' + store.currency_cache_warning;
    if (store.currency_preferences_conflict && element('financeCurrencyStatus')) element('financeCurrencyStatus').textContent += ' · 其他端已更新币种设置；本机原选择已保留，请核对后重新选择。';
    if (element('financeCurrencyGroups')) element('financeCurrencyGroups').textContent = summary.unconverted?.length
      ? Object.entries(summary.by_currency || {}).map(([code, values]) => `${code}：收入 ${formatFinanceMoney(values.income_minor, code)}，支出 ${formatFinanceMoney(values.expense_minor, code)}，退款 ${formatFinanceMoney(values.refund_minor, code)}`).join('；') : '';
    if (summary.has_overflow) {
      for (const id of ['financeIncomeTotal', 'financeExpenseTotal', 'financeRefundTotal', 'financeBalanceTotal']) if (element(id)) element(id).textContent = '超出汇总范围';
      if (element('financeCurrencyStatus')) element('financeCurrencyStatus').textContent = '合计超出可计算范围，请按原币逐笔查看；原记录未修改。';
    }
    if (element("financeSummaryPeriod")) element("financeSummaryPeriod").textContent = `${currentMonth().replace("-", " 年 ")} 月`;
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
    const visible = filtered.slice(0, ledgerLimit);
    reconcileKeyedRows(list, visible, {
      key: item => item.id,
      signature: item => JSON.stringify([item, categoryName(item.category_id), store.currency_preferences.display_currency,
        store.fx_snapshots[`${item.id}:${item.revision || 0}:${store.currency_preferences.display_currency}`]]),
      empty: '<div class="finance-empty"><strong>暂无符合条件的账目</strong><p>可以新增一笔，或调整月份和筛选条件。</p></div>',
      render: (item) => {
      const title = item.merchant || item.counterparty || (item.source_kind === "automatic" ? "未识别商户" : categoryName(item.category_id));
      const control = isAuthorizationControl(item);
      const reference = referenceValue(item, store.currency_preferences.display_currency, { snapshots: store.fx_snapshots });
      const referenceLabel = reference.status === 'reference'
        ? `参考折算 ${formatFinanceMoney(reference.amount_minor, reference.currency)} · ${reference.snapshot.rate_timestamp || reference.snapshot.date} · ${reference.snapshot.source || '历史快照'}`
        : reference.status === 'same_currency' ? '' : reference.status === 'currency_unit_review_required' ? '原金额单位待核实，未纳入汇总' : '缺少可用历史汇率 · 保留原币，待换算';
      const sign = control ? "" : item.direction === "expense" ? "-" : "+";
      const directionLabel = control ? "预授权控制 · 不计收支" : { income: "收入", expense: "支出", refund: "退款" }[item.direction];
      const roleLabel = (item.currency_role_evidence || []).slice(0, 3).map(evidence => {
        const roles = evidence.roles || {};
        return [['original', '来源原币'], ['settlement', '来源清算'], ['fee', '来源手续费']].filter(([key]) => roles[key])
          .map(([key, title]) => `${title} ${formatFinanceMoney(roles[key].amount_minor, roles[key].currency)}`).join(' · ');
      }).join('；');
      return `<article class="finance-transaction${item.status === "deleted" ? " is-deleted" : ""}" data-finance-transaction="${escapeHtml(item.id)}">
        <div class="finance-transaction-main"><span class="finance-direction is-${escapeHtml(item.direction)}">${directionLabel}</span><div><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><small>${escapeHtml(categoryName(item.category_id))} · ${escapeHtml(new Date(item.occurred_at_ms).toLocaleString("zh-CN"))}${item.source_kind === "automatic" ? " · Android 自动识别" : ""}${item.native_notification_pending ? " · 等待同步" : ""}${item.status === "deleted" ? " · 已删除" : ""}</small>${roleLabel ? `<small>${escapeHtml(roleLabel)} · 来源金额角色，不重复记账</small>` : ''}${item.note ? `<p title="${escapeHtml(item.note)}">${escapeHtml(item.note)}</p>` : ""}</div></div>
        <div class="finance-transaction-side"><strong class="is-${escapeHtml(item.direction)}">${item.money_unit_status === 'review_required' ? '原币单位待核实' : sign + escapeHtml(formatFinanceMoney(item.amount_minor, item.currency))}</strong>${!control && referenceLabel ? `<small>${escapeHtml(referenceLabel)}</small>` : ''}<div class="finance-row-actions">${item.status === "deleted" ? `<button type="button" data-finance-restore="${escapeHtml(item.id)}">恢复</button>` : `<button type="button" data-finance-edit="${escapeHtml(item.id)}">编辑</button><button class="danger-text" type="button" data-finance-delete="${escapeHtml(item.id)}">删除</button>`}</div></div>
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
    return calculateFinanceSummary(Object.values(store.transactions).filter((item) => item.status === 'active' && item.direction === 'expense'
      && (!categoryId || item.category_id === categoryId) && item.occurred_at_ms >= start && item.occurred_at_ms <= end),
    { display_currency: budget.currency, snapshots: store.fx_snapshots });
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
      if (item.money_unit_status === 'review_required') return '<article class="finance-budget-status">历史预算金额单位待核实；重新确认原币金额后启用。</article>';
      const calculation = categoryExpense(item.category_id, item);
      if (calculation.has_overflow) return '<article class="finance-budget-status">预算汇总超出范围，剩余待核实；原币记录保留。</article>';
      const spent = calculation.expense_minor;
      const remaining = item.amount_minor - spent;
      const percent = Math.min(100, Math.round(spent / item.amount_minor * 100));
      return `<article class="finance-budget-status${remaining < 0 ? " is-over" : ""}"><div><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}</strong><span>${calculation.unconverted?.length ? '剩余待核实' : remaining < 0 ? `超出 ${formatFinanceMoney(-remaining, item.currency)}` : `剩余 ${formatFinanceMoney(remaining, item.currency)}`}</span></div><progress class="finance-progress" max="100" value="${percent}" aria-label="已使用 ${percent}%"></progress><small>已用 ${formatFinanceMoney(spent, item.currency)} / ${formatFinanceMoney(item.amount_minor, item.currency)}${calculation.unconverted?.length ? ` · ${calculation.unconverted.length} 笔未换算，不含在已用金额内` : calculation.reference_only ? ' · 含历史参考折算' : ''}</small></article>`;
    }).join("");
  }

  function renderCategoryStats() {
    const list = element("financeCategoryStats");
    if (!list || !store) return;
    const bounds = monthBounds(currentMonth());
    const values = new Map();
    for (const item of Object.values(store.transactions)) {
      if (item.status !== "active" || item.direction !== "expense" || isAuthorizationControl(item) || (bounds && (item.occurred_at_ms < bounds.startMs || item.occurred_at_ms >= bounds.endMs))) continue;
      const key = item.category_id || "uncategorized";
      const converted = referenceValue(item, store.currency_preferences.display_currency, { snapshots: store.fx_snapshots });
      const group = ['same_currency', 'reference'].includes(converted.status) ? key : `${key}\u0000${item.currency}`;
      const previous = values.get(group) || { amount: 0n, currency: converted.currency || item.currency, unconverted: !converted.currency, category: key, unitReview: item.money_unit_status === 'review_required' };
      previous.amount += BigInt(converted.amount_minor ?? item.amount_minor);
      values.set(group, previous);
    }
    const entries = [...values.values()].map(item => ({ ...item, overflow: item.amount > BigInt(Number.MAX_SAFE_INTEGER), amount: item.amount > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(item.amount) })).sort((a, b) => a.currency.localeCompare(b.currency) || (b.amount || 0) - (a.amount || 0));
    const maximum = Math.max(1, ...entries.filter(item => !item.unconverted).map(item => item.amount));
    list.innerHTML = entries.length ? entries.slice(0, 8).map(item => `<div class="finance-category-stat"><span>${escapeHtml(item.category === 'uncategorized' ? '未分类' : categoryName(item.category))}${item.unconverted ? ' · 原币未换算' : ''}</span>${item.unconverted ? '' : `<progress max="${maximum}" value="${item.amount}"></progress>`}<strong>${item.unitReview ? '金额单位待核实' : item.overflow ? '汇总超出范围' : escapeHtml(formatFinanceMoney(item.amount, item.currency))}</strong></div>`).join('') : '<p class="finance-empty-inline">本月还没有支出分类数据。</p>';
  }

  function cancelDeferredRendering() {
    window.clearTimeout(searchTimer);
    window.clearTimeout(insightsTimer);
    window.cancelAnimationFrame(insightsFrame);
    searchTimer = insightsTimer = insightsFrame = 0;
  }

  function scheduleInsights() {
    const signature = JSON.stringify([currentAccountId, currentMonth(), store.categories, store.budgets, store.currency_preferences, store.fx_snapshots,
      Object.values(store.transactions).map(item => [item.id, item.status, item.direction, item.amount_minor, item.currency, item.money_unit_status, item.category_id, item.occurred_at_ms, item.payment_state, item.fx_snapshot])]);
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
    scheduleInsights();
    renderUndo();
    const pending = store.pending.length + Object.values(store.transactions).filter(item => item.native_notification_pending).length;
    element("financeResolveConflictBtn")?.classList.toggle("hidden", !conflictPending);
    if (conflictPending) setSyncState("需要处理冲突", "warning", `${pending} 项本地修改等待确认后重试。`);
    else if (syncPromise) setSyncState("同步中", "info", `${pending} 项本地修改正在同步。`);
    else if (store.last_error) setSyncState("同步失败", "error", `${store.last_error}${pending ? `；${pending} 项修改已安全保存在本机。` : ""}`);
    else if (pending) setSyncState(navigator.onLine === false ? "等待联网" : "等待同步", "warning", `${pending} 项本地修改尚未上传。`);
    else setSyncState("已同步", "success", store.last_sync_at ? `最近同步：${new Date(store.last_sync_at).toLocaleString("zh-CN")}` : "云端数据已就绪。 ");
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
    store.money_version = bootstrap.money_version === 2 ? 2 : 0;
    if (!store.currency_preferences_pending && SUPPORTED_CURRENCIES.includes(bootstrap.currency_preferences?.display_currency)) store.currency_preferences = bootstrap.currency_preferences;
    for (const category of bootstrap.categories || []) mergeServerEntity("category", category);
    for (const budget of bootstrap.budgets || []) mergeServerEntity("budget", budget);
    // A count mismatch means something never reached this client through the
    // change feed; re-read the server pages instead of trusting the cursor.
    const localActive = Object.values(store.transactions).filter((item) => item.status === "active" && !isAuthorizationControl(item)).length;
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
      const batch = store.pending.filter((operation) => !operation.type.startsWith("transaction.") ||
        !(operation.legacy_authorization_control || isAuthorizationControl(operation.payload) || isAuthorizationControl(store.transactions[operation.entity_id]))).slice(0, SYNC_BATCH_SIZE);
      if (!batch.length) throw Object.assign(new Error("旧预授权操作已隔离，原记录和待同步操作已保留，需核实后恢复。"), { code: "legacy_authorization_requires_review" });
      const payloadOperations = batch.map(({ queued_at_ms: _queuedAt, legacy_authorization_control: _legacyControl,
        legacy_authorization_original_payload: _legacyOriginal, ...operation }) => operation);
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
    if (store.money_version === 2) {
      try {
        if (store.currency_preferences_pending) {
          try {
            const preferences = await api('/api/finance/currencies', store.currency_preferences_pending, { controller: owner.controller });
            requireOwner(owner);
            store.currency_preferences = preferences.preferences;
            store.currency_preferences_pending = null;
          } catch (error) {
            requireOwner(owner);
            if (error.code !== 'currency_preferences_conflict') throw error;
            const remote = await readForOwner('/api/finance/currencies', owner);
            store.currency_preferences_conflict = { local: store.currency_preferences_pending, remote: remote.preferences };
            store.currency_preferences = remote.preferences;
            store.currency_preferences_pending = null;
          }
        }
        let referenceBatches = 0;
        const quotes = [...new Set([store.currency_preferences.display_currency, ...activeValues('budgets').map(item => item.currency)])];
        for (const quote of quotes) {
          if (!SUPPORTED_CURRENCIES.includes(quote)) continue;
          const ids = Object.values(store.transactions).filter(item => item.status === 'active' && !isAuthorizationControl(item) && item.currency !== quote
            && item.money_unit_status !== 'review_required' && !store.fx_snapshots[`${item.id}:${item.revision || 0}:${quote}`]).map(item => item.id);
          for (let offset = 0; offset < ids.length && referenceBatches < 2; offset += 25) {
            referenceBatches++;
            const result = await readForOwner(`/api/finance/references?ids=${encodeURIComponent(ids.slice(offset, offset + 25).join(','))}&display_currency=${quote}`, owner);
            requireOwner(owner);
            Object.assign(store.fx_snapshots, result.references || {});
            store.currency_error = result.unavailable?.length ? '部分参考汇率暂不可用，原币记录不受影响。' : '';
          }
        }
      } catch (error) {
        requireOwner(owner);
        store.currency_error = error.message || '参考折算暂不可用，原币记录保留。';
      }
    }
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
    element("financeTransactionId").value = item?.id || "";
    element("financeTransactionDirection").value = item?.direction || "expense";
    const currency = item?.currency || store.currency_preferences.default_currency || store.currency_preferences.account_currency;
    if (element('financeTransactionCurrency')) element('financeTransactionCurrency').value = currency;
    element("financeTransactionAmount").value = item && item.money_unit_status !== 'review_required' ? moneyText(item.amount_minor, currency) : '';
    element("financeTransactionCategory").value = item?.category_id || "";
    element("financeTransactionMerchant").value = item?.merchant || "";
    element("financeTransactionCounterparty").value = item?.counterparty || "";
    element("financeTransactionNote").value = item?.note || "";
    const date = item ? new Date(item.occurred_at_ms) : new Date();
    const offset = date.getTimezoneOffset() * 60000;
    element("financeTransactionTime").value = new Date(date.getTime() - offset).toISOString().slice(0, 16);
    element("financeTransactionModalTitle").textContent = item ? "编辑账目" : "新增账目";
    setMessage();
    openLayer("financeTransactionModal");
  }

  function submitTransaction(event) {
    event.preventDefault();
    ensureStore();
    const currency = element('financeTransactionCurrency')?.value;
    if (!SUPPORTED_CURRENCIES.includes(currency)) return invalidField(element('financeTransactionCurrency'), '请选择原币币种');
    const amountMinor = amountTextToMinor(element("financeTransactionAmount").value, currency);
    const occurredAt = new Date(element("financeTransactionTime").value).getTime();
    if (!amountMinor) return invalidField(element("financeTransactionAmount"), `请输入大于 0 且最多 ${currencyDigits(currency)} 位小数的 ${currency} 金额`);
    if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0) return invalidField(element("financeTransactionTime"), "请选择有效的交易时间");
    const id = element("financeTransactionId").value || randomId("txn");
    const current = store.transactions[id];
    const item = normalizeTransaction({
      id,
      direction: element("financeTransactionDirection").value,
      amount_minor: amountMinor,
      currency,
      ...(currency === 'JPY' ? { amount_exponent: 0 } : {}),
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
    });
    if (!item) return setMessage("账目内容无效，请检查后重试。", "error");
    store.transactions[id] = item;
    queueOperation("transaction.upsert", item, transactionPayload(item));
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
    list.innerHTML = budgets.length ? budgets.map((item) => `<div class="finance-manager-row"><span><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}</strong><small>${escapeHtml(item.starts_on)} 至 ${escapeHtml(item.ends_on)} · ${item.money_unit_status === 'review_required' ? '原币单位待核实' : escapeHtml(formatFinanceMoney(item.amount_minor, item.currency))}</small></span><span><button type="button" data-finance-budget-edit="${escapeHtml(item.id)}">编辑</button><button class="danger-text" type="button" data-finance-budget-delete="${escapeHtml(item.id)}">删除</button></span></div>`).join("") : '<p class="finance-empty-inline">还没有预算。</p>';
  }

  function openBudgetManager() {
    element("financeBudgetId").value = "";
    element("financeBudgetAmount").value = "";
    element("financeBudgetMonth").value = monthKey();
    element("financeBudgetCategory").value = "";
    if (element('financeBudgetCurrency')) element('financeBudgetCurrency').value = store.currency_preferences.display_currency;
    renderBudgetManager();
    openLayer("financeBudgetModal");
  }

  function editBudget(id) {
    const item = store.budgets[id];
    if (!item) return;
    element("financeBudgetId").value = item.id;
    if (element('financeBudgetCurrency')) element('financeBudgetCurrency').value = item.currency;
    element("financeBudgetAmount").value = item.money_unit_status === 'review_required' ? '' : moneyText(item.amount_minor, item.currency);
    element("financeBudgetMonth").value = item.starts_on?.slice(0, 7) || monthKey();
    element("financeBudgetCategory").value = item.category_id;
    element("financeBudgetAmount").focus();
  }

  function submitBudget(event) {
    event.preventDefault();
    const bounds = monthBounds(element("financeBudgetMonth").value);
    const currency = element('financeBudgetCurrency')?.value;
    if (!SUPPORTED_CURRENCIES.includes(currency)) return invalidField(element('financeBudgetCurrency'), '请选择预算币种');
    const amountMinor = amountTextToMinor(element("financeBudgetAmount").value, currency);
    if (!bounds) return invalidField(element("financeBudgetMonth"), "请选择有效月份");
    if (!amountMinor) return invalidField(element("financeBudgetAmount"), "请输入大于 0 且最多两位小数的预算金额");
    const categoryId = element("financeBudgetCategory").value;
    const matching = activeValues("budgets").find((item) => item.category_id === categoryId
      && item.starts_on === bounds.startDate && item.ends_on === bounds.endDate);
    const id = element("financeBudgetId").value || matching?.id || randomId("budget");
    const current = store.budgets[id];
    const item = normalizeBudget({
      id,
      category_id: categoryId,
      period_type: "monthly",
      amount_minor: amountMinor,
      currency,
      ...(currency === 'JPY' ? { amount_exponent: 0 } : {}),
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
    if (!button) return;
    if (button.id === "financeAddTransactionBtn") openTransactionEditor();
    else if (button.id === "financeAllMonthsBtn") { ledgerAllMonths = true; renderAll(); }
    else if (button.id === "financeSelectedMonthBtn") { ledgerAllMonths = false; renderAll(); }
    else if (button.id === "financeLedgerMoreBtn") { ledgerLimit += CLIENT_PAGE_SIZE; renderTransactions(); }
    else if (button.id === "financeManageCategoriesBtn") openCategoryManager();
    else if (button.id === "financeManageBudgetsBtn") openBudgetManager();
    else if (button.id === "financeSyncBtn") syncNow();
    else if (button.id === "financeResolveConflictBtn") resolveConflict().catch((error) => setMessage(error.message, "error"));
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
    else if (button.dataset.financeClose) closeLayer(button.dataset.financeClose);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    recordedDisclosure = createFinanceDisclosure({ element: element("financeRecordedSection"), storage,
      accountId: () => account()?.id, section: "recorded", defaultOpen: false });
    recordedDisclosure.restore();
    element("financePage")?.addEventListener("click", handlePageClick);
    for (const id of ["financeTransactionModal", "financeCategoryModal", "financeBudgetModal"]) element(id)?.addEventListener("click", handlePageClick);
    element("financeTransactionForm")?.addEventListener("submit", submitTransaction);
    element("financeCategoryForm")?.addEventListener("submit", submitCategory);
    element("financeBudgetForm")?.addEventListener("submit", submitBudget);
    for (const [id, field] of [['financeDisplayCurrency', 'display_currency'], ['financeAccountCurrency', 'account_currency'], ['financeDefaultCurrency', 'default_currency']]) element(id)?.addEventListener('change', event => {
      ensureStore();
      const currency = event.target.value;
      if (!SUPPORTED_CURRENCIES.includes(currency) && !(field === 'default_currency' && currency === '')) return;
      store.currency_preferences_conflict = null;
      store.currency_preferences = { ...store.currency_preferences, [field]: currency || null };
      store.currency_preferences_pending = { ...store.currency_preferences };
      persist(); renderAll(); void syncNow();
    });
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
    window.addEventListener("online", () => {
      if (!element("financePage")?.classList.contains("hidden")) syncNow();
    });
    document.addEventListener("thewyj:payment-updated", () => {
      ensureStore();
      if (!element("financePage")?.classList.contains("hidden")) { renderAll(); void syncNow(); }
    });
  }

  async function show() {
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
    if (element("financeMonthFilter") && !element("financeMonthFilter").value) element("financeMonthFilter").value = monthKey();
    renderAll();
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
    if (!element("financePage")?.classList.contains("hidden")) show();
  }

  function dashboardSummary() {
    const value = account();
    if (!value?.id) return { balance_minor: 0, pending: 0, available: false };
    ensureStore();
    const summary = calculateFinanceSummary(Object.values(store.transactions), { month: monthKey(), display_currency: store.currency_preferences.display_currency, snapshots: store.fx_snapshots });
    return { ...summary, pending: store.pending.length, available: hasAccess(), last_sync_at: store.last_sync_at };
  }

  return Object.freeze({ show, hide, syncNow, verifyTransaction, resetAccount, accountUpdated, dashboardSummary, render: renderAll });
}
