const SCHEMA_VERSION = 1;
const MAX_LOCAL_TRANSACTIONS = 5000;
const MAX_PENDING_OPERATIONS = 500;
const CLIENT_PAGE_SIZE = 100;
const SYNC_BATCH_SIZE = 80;
const VALID_DIRECTIONS = new Set(["income", "expense", "refund"]);
const VALID_ENTITY_KINDS = new Set(["transaction", "category", "budget"]);

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
  return `${prefix}:${crypto.randomUUID()}`;
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

export function amountTextToMinor(value) {
  const text = String(value || "").trim();
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(text)) return 0;
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 10_000_000_000_000 ? amount : 0;
}

export function formatFinanceMoney(minor, currency = "CNY") {
  const amount = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${currency}`;
  }
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
  return {
    id,
    direction,
    amount_minor: amountMinor,
    currency: /^[A-Z]{3}$/.test(String(value.currency || "CNY")) ? String(value.currency || "CNY") : "CNY",
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

export function calculateFinanceSummary(transactions, options = {}) {
  const bounds = options.month ? monthBounds(options.month) : null;
  const active = (Array.isArray(transactions) ? transactions : []).filter((item) => {
    if (!item || item.status === "deleted") return false;
    if (!bounds) return true;
    return item.occurred_at_ms >= bounds.startMs && item.occurred_at_ms < bounds.endMs;
  });
  const summary = { income_minor: 0, expense_minor: 0, refund_minor: 0, balance_minor: 0, count: active.length };
  for (const item of active) {
    if (item.direction === "income") summary.income_minor += Number(item.amount_minor || 0);
    if (item.direction === "expense") summary.expense_minor += Number(item.amount_minor || 0);
    if (item.direction === "refund") summary.refund_minor += Number(item.amount_minor || 0);
  }
  summary.balance_minor = summary.income_minor + summary.refund_minor - summary.expense_minor;
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
  const collection = `${entityType}s`;
  const current = store[collection]?.[clean.id];
  if (!current || Number(clean.revision) >= Number(current.revision || 0)) store[collection][clean.id] = clean;
  store.server_version = Math.max(Number(store.server_version || 0), Number(change.version || clean.sync_version || 0));
  return true;
}

function transactionPayload(transaction) {
  return {
    direction: transaction.direction,
    amount_minor: transaction.amount_minor,
    currency: transaction.currency,
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
}) {
  let store = null;
  let currentAccountId = "";
  let syncPromise = null;
  let syncAgainRequested = false;
  let syncController = null;
  let conflictPending = false;
  let undoTransactionId = "";
  let initialized = false;
  let serverDeniedAccess = false;

  const element = (id) => document.getElementById(id);
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
    if (store && currentAccountId === nextAccountId) return store;
    currentAccountId = nextAccountId;
    store = normalizeStore(safeJson(storage.getItem(storageKey(nextAccountId)), {}), nextAccountId, deviceId());
    return store;
  }

  function persist() {
    if (!store || !currentAccountId) return;
    storage.setItem(storageKey(currentAccountId), JSON.stringify(store));
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
      select.innerHTML = `<option value="">${first}</option>${options}`;
      if ([...select.options].some((item) => item.value === current)) select.value = current;
    }
  }

  function currentMonth() {
    return element("financeMonthFilter")?.value || monthKey();
  }

  function renderSummary() {
    if (!store) return;
    const summary = calculateFinanceSummary(Object.values(store.transactions), { month: currentMonth() });
    if (element("financeIncomeTotal")) element("financeIncomeTotal").textContent = formatFinanceMoney(summary.income_minor);
    if (element("financeExpenseTotal")) element("financeExpenseTotal").textContent = formatFinanceMoney(summary.expense_minor);
    if (element("financeRefundTotal")) element("financeRefundTotal").textContent = formatFinanceMoney(summary.refund_minor);
    if (element("financeBalanceTotal")) element("financeBalanceTotal").textContent = formatFinanceMoney(summary.balance_minor);
    if (element("financeSummaryPeriod")) element("financeSummaryPeriod").textContent = `${currentMonth().replace("-", " 年 ")} 月`;
  }

  function renderTransactions() {
    const list = element("financeTransactionList");
    if (!list || !store) return;
    const filtered = filterFinanceTransactions(Object.values(store.transactions), {
      query: element("financeSearchInput")?.value,
      direction: element("financeDirectionFilter")?.value,
      category_id: element("financeCategoryFilter")?.value,
      status: element("financeStatusFilter")?.value,
      month: currentMonth(),
    });
    if (element("financeTransactionCount")) element("financeTransactionCount").textContent = `${filtered.length} 笔`;
    if (!filtered.length) {
      list.innerHTML = '<div class="finance-empty"><strong>暂无符合条件的账目</strong><p>可以新增一笔，或调整月份和筛选条件。</p></div>';
      return;
    }
    list.innerHTML = filtered.map((item) => {
      const title = item.merchant || item.counterparty || categoryName(item.category_id);
      const sign = item.direction === "expense" ? "-" : "+";
      const directionLabel = { income: "收入", expense: "支出", refund: "退款" }[item.direction];
      return `<article class="finance-transaction${item.status === "deleted" ? " is-deleted" : ""}" data-finance-transaction="${escapeHtml(item.id)}">
        <div class="finance-transaction-main"><span class="finance-direction is-${escapeHtml(item.direction)}">${directionLabel}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(categoryName(item.category_id))} · ${escapeHtml(new Date(item.occurred_at_ms).toLocaleString("zh-CN"))}${item.source_kind === "automatic" ? " · Android 自动识别" : ""}</small>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</div></div>
        <div class="finance-transaction-side"><strong class="is-${escapeHtml(item.direction)}">${sign}${escapeHtml(formatFinanceMoney(item.amount_minor, item.currency))}</strong><div class="finance-row-actions">${item.status === "deleted" ? `<button type="button" data-finance-restore="${escapeHtml(item.id)}">恢复</button>` : `<button type="button" data-finance-edit="${escapeHtml(item.id)}">编辑</button><button class="danger-text" type="button" data-finance-delete="${escapeHtml(item.id)}">删除</button>`}</div></div>
      </article>`;
    }).join("");
  }

  function categoryExpense(categoryId, budget) {
    const start = budget.starts_on ? new Date(`${budget.starts_on}T00:00:00`).getTime() : 0;
    const end = budget.ends_on ? new Date(`${budget.ends_on}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER;
    return Object.values(store.transactions).filter((item) => item.status === "active" && item.direction === "expense"
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
      const spent = categoryExpense(item.category_id, item);
      const remaining = item.amount_minor - spent;
      const percent = Math.min(100, Math.round(spent / item.amount_minor * 100));
      return `<article class="finance-budget-status${remaining < 0 ? " is-over" : ""}"><div><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}</strong><span>${remaining < 0 ? `超出 ${formatFinanceMoney(-remaining)}` : `剩余 ${formatFinanceMoney(remaining)}`}</span></div><progress class="finance-progress" max="100" value="${percent}" aria-label="已使用 ${percent}%"></progress><small>已用 ${formatFinanceMoney(spent)} / ${formatFinanceMoney(item.amount_minor)}</small></article>`;
    }).join("");
  }

  function renderCategoryStats() {
    const list = element("financeCategoryStats");
    if (!list || !store) return;
    const bounds = monthBounds(currentMonth());
    const values = new Map();
    for (const item of Object.values(store.transactions)) {
      if (item.status !== "active" || item.direction !== "expense" || (bounds && (item.occurred_at_ms < bounds.startMs || item.occurred_at_ms >= bounds.endMs))) continue;
      const key = item.category_id || "uncategorized";
      values.set(key, (values.get(key) || 0) + item.amount_minor);
    }
    const entries = [...values.entries()].sort((a, b) => b[1] - a[1]);
    const maximum = entries[0]?.[1] || 1;
    list.innerHTML = entries.length ? entries.slice(0, 8).map(([id, amount]) => `<div class="finance-category-stat"><span>${escapeHtml(id === "uncategorized" ? "未分类" : categoryName(id))}</span><progress max="${maximum}" value="${amount}" aria-label="${escapeHtml(id === "uncategorized" ? "未分类" : categoryName(id))} ${escapeHtml(formatFinanceMoney(amount))}"></progress><strong>${escapeHtml(formatFinanceMoney(amount))}</strong></div>`).join("") : '<p class="finance-empty-inline">本月还没有支出分类数据。</p>';
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
    renderBudgets();
    renderCategoryStats();
    renderUndo();
    const pending = store.pending.length;
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
    if (store[`${kind}s`]?.[entity.id]) store[`${kind}s`][entity.id].revision = baseRevision + 1;
    persist();
    renderAll();
    if (navigator.onLine !== false) syncNow().catch(() => {});
    return operation;
  }

  function applyOperationResult(result) {
    for (const kind of VALID_ENTITY_KINDS) {
      const clean = entityNormalizer(kind)(result?.[kind]);
      if (clean) store[`${kind}s`][clean.id] = clean;
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

  async function fetchAllTransactions(includeDeleted = true) {
    const result = {};
    let before = "";
    let beforeId = "";
    for (let page = 0; page < 60; page += 1) {
      const query = new URLSearchParams({ limit: String(CLIENT_PAGE_SIZE), include_deleted: String(includeDeleted) });
      if (before) query.set("before", before);
      if (beforeId) query.set("before_id", beforeId);
      const data = await apiGet(`/api/finance/transactions?${query}`);
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
    const current = store[`${kind}s`][clean.id];
    if (!hasPending && (!current || clean.revision >= current.revision)) store[`${kind}s`][clean.id] = clean;
  }

  async function hydrate() {
    const bootstrap = await apiGet("/api/finance/bootstrap");
    for (const category of bootstrap.categories || []) mergeServerEntity("category", category);
    for (const budget of bootstrap.budgets || []) mergeServerEntity("budget", budget);
    if (!store.hydrated || Number(bootstrap.transaction_count || 0) > Object.values(store.transactions).filter((item) => item.status === "active").length) {
      const serverTransactions = await fetchAllTransactions(true);
      for (const item of Object.values(serverTransactions)) mergeServerEntity("transaction", item);
      store.hydrated = true;
    }
    store.server_version = Math.max(store.server_version, Number(bootstrap.server_version || 0));
  }

  async function pullChanges() {
    let since = store.server_version;
    for (let page = 0; page < 20; page += 1) {
      const data = await apiGet(`/api/finance/changes?since=${encodeURIComponent(since)}&limit=250`);
      applyChangesPayload(data);
      since = Number(data.next_since || data.server_version || since);
      if (!data.has_more) break;
    }
  }

  async function performSync() {
    ensureStore();
    conflictPending = false;
    store.last_error = "";
    renderAll();
    if (!store.hydrated) await hydrate();
    else await pullChanges();
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
      }, { controller: syncController, timeoutMs: 30000 });
      const completed = new Set(batch.map((item) => item.operation_id));
      store.pending = store.pending.filter((item) => !completed.has(item.operation_id));
      for (const result of data.operation_results || []) applyOperationResult(result);
      applyChangesPayload(data);
      persist();
    }
    await pullChanges();
    store.last_sync_at = timestamp();
    store.last_error = "";
    persist();
  }

  async function syncNow() {
    ensureStore();
    if (!hasAccess()) return false;
    if (syncPromise) {
      syncAgainRequested = true;
      return syncPromise;
    }
    // navigator.onLine is only a hint. A real request is the authoritative
    // connectivity check, especially immediately after a network handoff.
    syncController = new AbortController();
    syncPromise = performSync().catch((error) => {
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
      const shouldSyncAgain = syncAgainRequested
        && hasAccess()
        && store?.pending?.length > 0;
      syncAgainRequested = false;
      syncPromise = null;
      syncController = null;
      renderAll();
      if (shouldSyncAgain) queueMicrotask(() => syncNow());
    });
    renderAll();
    return syncPromise;
  }

  async function resolveConflict() {
    ensureStore();
    const remoteTransactions = await fetchAllTransactions(true);
    const bootstrap = await apiGet("/api/finance/bootstrap");
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
        if (serverItem) store[`${kind}s`][serverItem.id] = serverItem;
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
      if (store[`${kind}s`]?.[id]) store[`${kind}s`][id].revision = revision;
    }
    persist();
    renderAll();
    return syncNow();
  }

  function openLayer(id) {
    const layer = element(id);
    if (!layer) return;
    layer.classList.remove("hidden");
    layer.setAttribute("aria-hidden", "false");
    layer.querySelector("input:not([type=hidden]), select, button")?.focus();
  }

  function closeLayer(id) {
    const layer = element(id);
    if (!layer) return;
    layer.classList.add("hidden");
    layer.setAttribute("aria-hidden", "true");
  }

  function openTransactionEditor(id = "") {
    ensureStore();
    const item = id ? store.transactions[id] : null;
    element("financeTransactionId").value = item?.id || "";
    element("financeTransactionDirection").value = item?.direction || "expense";
    element("financeTransactionAmount").value = item ? (item.amount_minor / 100).toFixed(2) : "";
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
    const amountMinor = amountTextToMinor(element("financeTransactionAmount").value);
    const occurredAt = new Date(element("financeTransactionTime").value).getTime();
    if (!amountMinor) return invalidField(element("financeTransactionAmount"), "请输入大于 0 且最多两位小数的金额");
    if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0) return invalidField(element("financeTransactionTime"), "请选择有效的交易时间");
    const id = element("financeTransactionId").value || randomId("txn");
    const current = store.transactions[id];
    const item = normalizeTransaction({
      id,
      direction: element("financeTransactionDirection").value,
      amount_minor: amountMinor,
      currency: "CNY",
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
    list.innerHTML = budgets.length ? budgets.map((item) => `<div class="finance-manager-row"><span><strong>${escapeHtml(item.category_id ? categoryName(item.category_id) : "月度总预算")}</strong><small>${escapeHtml(item.starts_on)} 至 ${escapeHtml(item.ends_on)} · ${escapeHtml(formatFinanceMoney(item.amount_minor))}</small></span><span><button type="button" data-finance-budget-edit="${escapeHtml(item.id)}">编辑</button><button class="danger-text" type="button" data-finance-budget-delete="${escapeHtml(item.id)}">删除</button></span></div>`).join("") : '<p class="finance-empty-inline">还没有预算。</p>';
  }

  function openBudgetManager() {
    element("financeBudgetId").value = "";
    element("financeBudgetAmount").value = "";
    element("financeBudgetMonth").value = monthKey();
    element("financeBudgetCategory").value = "";
    renderBudgetManager();
    openLayer("financeBudgetModal");
  }

  function editBudget(id) {
    const item = store.budgets[id];
    if (!item) return;
    element("financeBudgetId").value = item.id;
    element("financeBudgetAmount").value = (item.amount_minor / 100).toFixed(2);
    element("financeBudgetMonth").value = item.starts_on?.slice(0, 7) || monthKey();
    element("financeBudgetCategory").value = item.category_id;
    element("financeBudgetAmount").focus();
  }

  function submitBudget(event) {
    event.preventDefault();
    const bounds = monthBounds(element("financeBudgetMonth").value);
    const amountMinor = amountTextToMinor(element("financeBudgetAmount").value);
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
      currency: "CNY",
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
    element("financePage")?.addEventListener("click", handlePageClick);
    for (const id of ["financeTransactionModal", "financeCategoryModal", "financeBudgetModal"]) element(id)?.addEventListener("click", handlePageClick);
    element("financeTransactionForm")?.addEventListener("submit", submitTransaction);
    element("financeCategoryForm")?.addEventListener("submit", submitCategory);
    element("financeBudgetForm")?.addEventListener("submit", submitBudget);
    for (const id of ["financeSearchInput", "financeDirectionFilter", "financeCategoryFilter", "financeStatusFilter", "financeMonthFilter"]) {
      element(id)?.addEventListener(id === "financeSearchInput" ? "input" : "change", renderAll);
    }
    window.addEventListener("online", () => {
      if (!element("financePage")?.classList.contains("hidden")) syncNow();
    });
  }

  async function show() {
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
    for (const id of ["financeTransactionModal", "financeCategoryModal", "financeBudgetModal"]) closeLayer(id);
  }

  function resetAccount() {
    syncController?.abort();
    syncPromise = null;
    syncAgainRequested = false;
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
    const summary = calculateFinanceSummary(Object.values(store.transactions), { month: monthKey() });
    return { ...summary, pending: store.pending.length, available: hasAccess(), last_sync_at: store.last_sync_at };
  }

  return Object.freeze({ show, hide, syncNow, resetAccount, accountUpdated, dashboardSummary, render: renderAll });
}
