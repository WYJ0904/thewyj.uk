import { mergeLocalNotificationReviews, localNotificationRecovery } from "./notification-ledger.js?release=20261109-aeris-p07-production-r2";
import { randomId } from "../core/capabilities.js?release=20261109-aeris-p07-production-r2";
import { createFinanceDisclosure } from "./disclosure.js?release=20261109-aeris-p07-production-r2";
import { reconcileKeyedRows } from "../core/keyed-list.js?release=20261109-aeris-p07-production-r2";
import { formatFinanceMoney } from "./format.js?release=20261109-aeris-p07-production-r2";
import { SUPPORTED_CURRENCIES, currencyDigits, moneyText } from "./money.js?release=20261109-aeris-p07-production-r2";
import { validateAmountText } from "./app.js?release=20261109-aeris-p07-production-r2";
import {
  INTERACTION_STAGES,
  attachInteractionFeedback,
  beginInteraction,
  createLatestOnly,
  createSingleFlight,
  withInteractionFeedback,
} from "../core/perf.js?release=20261109-aeris-p07-production-r2";
const FINANCE_DEVICE_KEY = "wyjFinanceDevice:v1";
const DIRECTION_LABELS = Object.freeze({ income: "收入", expense: "支出", refund: "退款", unknown: "方向待核实" });
const VALID_DIRECTIONS = new Set(["income", "expense", "refund"]);
const AUTHORIZATION_PHASES = new Set(["AUTHORIZED", "PENDING_AUTHORIZATION"]);
const AUTHORIZATION_OPERATIONS = new Set(["AUTHORIZE", "RELEASE", "EXPIRE"]);
const AUTHORIZATION_STATES = new Set(["pending_authorization", "authorization_release", "authorization_expired"]);

export function isCandidateAuthorization(candidate) {
  return AUTHORIZATION_STATES.has(candidate?.reconciliation_state) ||
    AUTHORIZATION_PHASES.has(candidate?.financial_phase) ||
    AUTHORIZATION_OPERATIONS.has(candidate?.lifecycle_operation);
}

const SOURCE_LABELS = Object.freeze({
  "com.tencent.mm": "微信",
  "com.eg.android.AlipayGphone": "支付宝",
});
const REASON_LABELS = Object.freeze({
  wechat_payment_hint_without_amount: "通知包含微信支付或转账提示，但原通知没有提供金额",
  alipay_hint_without_amount: "通知包含支付宝交易提示，但原通知没有提供金额",
  bank_notification_without_amount: "银行通知提示发生交易，但原通知没有提供金额",
  sms_without_amount: "银行短信提示发生交易，但原短信没有提供金额",
  wechat_amount_without_direction: "已识别金额，收支方向仍需核实",
  alipay_amount_without_direction: "已识别金额，收支方向仍需核实",
  bank_notification_amount_without_direction: "已识别金额，收支方向仍需核实",
  local_incomplete_payment: "结构化交易字段不完整，等待人工核实",
});

/**
 * A one-click confirm may only be sent when the record already carries every
 * value the server requires. Production evidence (2026-09-12): a bank-card hint
 * arrived with amount 10449 but an empty direction, the Finance page still
 * offered「确认记账」, and the API correctly answered 400
 * `hint_direction_required`. The record then stayed pending forever and looked
 * like "confirmed but still in 通知待确认".
 *
 * Multi-currency: unverified currency, legacy JPY without exponent 0, or
 * authorization control items can never be booked with one-click confirm.
 */
export function candidateNeedsEditor(candidate) {
  const amountMissing = !Number(candidate?.amount_minor);
  const directionMissing = !VALID_DIRECTIONS.has(String(candidate?.direction || "").trim().toLowerCase());
  const rawCurrency = candidate?.currency !== undefined && candidate?.currency !== null
    ? String(candidate.currency).trim().toUpperCase()
    : "";
  const currencyNeedsReview = candidate?.currency_review_required === true ||
    (rawCurrency !== "" && (!SUPPORTED_CURRENCIES.includes(rawCurrency) || rawCurrency === "XXX")) ||
    (rawCurrency === "JPY" && candidate?.money_unit_status === "review_required");
  const isAuth = isCandidateAuthorization(candidate);
  return amountMissing || directionMissing || currencyNeedsReview || isAuth || candidate?.local_evidence?.conflict === true;
}

export function candidatePresentation(candidate) {
  const isAuth = isCandidateAuthorization(candidate);
  const evidenceConflict = candidate?.local_evidence?.conflict === true;
  const localEvidencePending = candidate?.local_evidence?.pending_sync === true;
  const amountMinor = Number(candidate?.amount_minor) || (!evidenceConflict ? Number(candidate?.local_evidence?.amount_minor) : 0) || 0;
  const amountUnknown = !amountMinor;
  const rawCurrency = candidate?.currency !== undefined && candidate?.currency !== null
    ? String(candidate.currency).trim().toUpperCase()
    : "";
  const currency = rawCurrency ? (SUPPORTED_CURRENCIES.includes(rawCurrency) ? rawCurrency : rawCurrency) : "CNY";
  const currencyNeedsReview = candidate?.currency_review_required === true ||
    (rawCurrency !== "" && (!SUPPORTED_CURRENCIES.includes(rawCurrency) || rawCurrency === "XXX")) ||
    (currency === "JPY" && candidate?.money_unit_status === "review_required");
  const rawDirection = String(candidate?.direction || "").trim().toLowerCase();
  const direction = VALID_DIRECTIONS.has(rawDirection) ? rawDirection : "unknown";
  const merchant = String(candidate?.merchant || candidate?.counterparty || "").trim();
  const missing = [];
  if (!Number(candidate?.amount_minor)) missing.push("金额");
  if (direction === "unknown") missing.push("收支方向");
  if (currencyNeedsReview) missing.push("币种核实");
  if (isAuth) missing.push("清算完成");
  let primaryAction = "确认记账";
  if (isAuth) primaryAction = "预授权控制（未结算）";
  else if (evidenceConflict) primaryAction = "核对并确认";
  else if (currencyNeedsReview) primaryAction = "核实币种并确认";
  else if (missing.length) primaryAction = "补全并确认";
  return Object.freeze({
    amountUnknown,
    amountMinor,
    currency,
    currencyNeedsReview,
    isAuth,
    evidenceConflict,
    localEvidencePending,
    direction,
    directionLabel: DIRECTION_LABELS[direction],
    merchant,
    merchantLabel: merchant || "商户未知（可选）",
    missing,
    primaryAction,
  });
}

/** Server summary is the sole user-visible pending identity set on both tabs. */
export function canonicalPendingCandidates(summary) {
  const pending = Array.isArray(summary?.records)
    ? summary.records.filter((row) => row.state === "pending")
    : [];
  return pending.map((row) => {
    const hint = row.kind === "hint";
    const rawCurrency = String(row.currency || "").trim().toUpperCase();
    const currency = SUPPORTED_CURRENCIES.includes(rawCurrency)
      ? rawCurrency
      : (rawCurrency || (row.currency_review_required ? "XXX" : "CNY"));
    const currencyReviewRequired = row.currency_review_required === true ||
      row.currency_review_required === 1 ||
      currency === "XXX" ||
      (rawCurrency !== "" && !SUPPORTED_CURRENCIES.includes(rawCurrency));
    return {
      id: String(row.id || ""), hint, canonical_id: `${row.kind}:${String(row.id || "")}`,
      event_id: String(row.event_id || ""),
      event_ids: [...new Set([String(row.event_id || ""), ...(row.event_ids || [])])].filter(Boolean),
      source_package: String(row.source_package || ""), app_label: String(row.app_label || ""),
      direction: String(row.direction || ""), amount_minor: Number(row.amount_minor) || 0,
      currency,
      currency_review_required: currencyReviewRequired,
      currency_decision_source: String(row.currency_decision_source || ""),
      amount_exponent: row.amount_exponent !== undefined ? row.amount_exponent : null,
      money_unit_status: String(row.money_unit_status || (currency === "JPY" && row.amount_exponent !== 0 ? "review_required" : "")),
      financial_phase: String(row.financial_phase || ""),
      reconciliation_state: String(row.reconciliation_state || ""),
      merchant: String(row.merchant || ""),
      occurred_at_ms: Number(row.occurred_at_ms) || 0, confidence: Number(row.confidence) || 0,
      evidence: [{ source_type: "notification", source_package: String(row.source_package || ""), app_label: String(row.app_label || "") }],
      evidence_count: 1,
      recognition_reasons: Array.isArray(row.recognition_reasons) ? row.recognition_reasons : [], status: "pending",
      local_evidence: row.local_evidence,
    };
  }).filter((item) => item.id);
}

function sourceLabel(evidence) {
  const packageName = String(evidence?.source_package || "");
  if (SOURCE_LABELS[packageName]) return SOURCE_LABELS[packageName];
  const appLabel = String(evidence?.app_label || "").trim();
  if (appLabel) return appLabel;
  if (String(evidence?.source_type || "") === "sms") return "银行短信";
  if (String(evidence?.source_type || "") === "accessibility") return "页面核实";
  if (packageName) return packageName;
  return "通知";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMinor(minor, currency = "CNY") {
  return formatFinanceMoney(minor, currency);
}

function evidenceExplanation(candidate, presentation) {
  if (presentation.isAuth) {
    return "交易处于预授权或冻结控制状态，清算完成前不可直接转为实际支出";
  }
  if (presentation.currencyNeedsReview) {
    return "原始通知未明确支持的币种或按默认设置暂存，记账前须人工核实币种与金额";
  }
  const reasons = Array.isArray(candidate?.recognition_reasons) ? candidate.recognition_reasons : [];
  const labels = [...new Set(reasons.map((reason) => REASON_LABELS[String(reason)]).filter(Boolean))];
  if (labels.length) return labels.join("；");
  if (!presentation.amountUnknown && presentation.direction !== "unknown" && !presentation.merchant) {
    return "已识别金额与收支方向；原通知未提供商户信息，商户不是记账必填项";
  }
  if (presentation.missing.length) return `原始结构化证据缺少${presentation.missing.join("和")}，不会自动补值`;
  return "结构化通知证据已满足记账条件";
}

/**
 * Notification-candidate review UI hosted on /finance. Candidates are
 * structured server records: confirming one creates a formal Task 16/17
 * finance transaction, rejecting one is terminal and cannot be revived by a
 * NotificationListener retry (the backend dedupes the source event).
 */
export function createFinanceCandidatesController({
  api,
  apiGet,
  storage,
  account,
  hasEntitlement,
  isSuperAdmin,
  onCandidateChanged = () => {},
}) {
  let busyIds = new Set();
  let currentCandidates = [];
  let canonicalRecords = [];
  let renderedForAccount = "";
  let hasCanonicalObservation = false;
  let bound = false;
  let active = false;
  let lifecycleVersion = 0;
  // Task 24 reopen #7: one *automatic* refresh at a time, and only the newest
  // list may paint. A manual refresh must never be answered by a load that
  // started before the user's click (legacy Task 21 gate: the second candidate
  // ingested right before the tap stayed invisible because the click joined an
  // in-flight list request).
  const refreshOnce = createSingleFlight();
  const listVersion = createLatestOnly();
  let refreshInFlight = null;

  const element = (id) => document.getElementById(id);
  const reviewRows = createParkedRows(() => element("financeCandidateList"));
  const recoveryRows = createParkedRows(() => element("financeRecoveryList"));
  let pendingDisclosure = null;

  function deviceId() {
    let value = String(storage.getItem(FINANCE_DEVICE_KEY) || "").trim();
    if (!/^web:[A-Za-z0-9-]{8,76}$/.test(value)) {
      value = `web:${randomId()}`;
      storage.setItem(FINANCE_DEVICE_KEY, value);
    }
    return value;
  }

  function hasAccess() {
    const value = account();
    // Candidate review belongs to the finance capability; notification archive
    // is a separate entitlement and is not required here.
    return Boolean(value && (isSuperAdmin(value)
      || hasEntitlement("finance_access", value)
      || hasEntitlement("all_features_access", value)));
  }

  function captureEditorState(list) {
    const active = document.activeElement;
    return [...(list?.querySelectorAll(".finance-candidate-editor:not(.hidden)") || [])].map((form) => {
      const values = {};
      for (const control of form.elements || []) {
        if (control.name) values[control.name] = control.value;
      }
      return {
        id: String(form.dataset.financeCandidateEditor || ""),
        values,
        focusedName: form.contains(active) ? String(active?.name || "") : "",
      };
    });
  }

  function restoreEditorState(list, snapshots) {
    for (const snapshot of snapshots || []) {
      if (!snapshot?.id) continue;
      const form = list.querySelector(`[data-finance-candidate-editor="${CSS.escape(snapshot.id)}"]`);
      if (!form) continue;
      form.classList.remove("hidden");
      for (const [name, value] of Object.entries(snapshot.values || {})) {
        if (form.elements[name]) form.elements[name].value = value;
      }
      const editButton = list.querySelector(`[data-finance-candidate-edit="${CSS.escape(snapshot.id)}"]`);
      if (editButton) editButton.textContent = "收起编辑";
      if (snapshot.focusedName && form.elements[snapshot.focusedName]) {
        form.elements[snapshot.focusedName].focus({ preventScroll: true });
      }
    }
  }

  function render(candidates, message = "") {
    const list = element("financeCandidateList");
    const section = element("financeCandidatesSection");
    if (!list || !section) return;
    const editorState = captureEditorState(rowRenderRoot(list));
    renderRecovery();
    currentCandidates = [...candidates];
    if (element("financePendingCount")) element("financePendingCount").textContent = hasCanonicalObservation ? String(candidates.length) : "待核对";
    pendingDisclosure?.pending(candidates.map(item => item.canonical_id || item.id));
    const banner = element("financeCandidateMessage");
    if (banner) { banner.textContent = message; banner.hidden = !message; }
    reconcileKeyedRows(list, candidates, {
      key: candidate => candidate.canonical_id || candidate.id,
      signature: candidate => JSON.stringify([candidate, busyIds.has(String(candidate.id || ""))]),
      empty: '<div class="finance-candidate-empty"><strong>暂无待处理通知交易</strong><p>已完成核实和记账的交易会直接从待处理移除。</p></div>',
      render: (candidate) => {
      const id = String(candidate.id || "");
      const presentation = candidatePresentation(candidate);
      const { direction, currency, currencyNeedsReview, isAuth } = presentation;
      const occurred = Number(candidate.occurred_at_ms) > 0
        ? new Date(Number(candidate.occurred_at_ms)).toLocaleString("zh-CN")
        : "时间未知";
      const confidence = Math.max(0, Math.min(1000, Number(candidate.confidence) || 0));
      const busy = busyIds.has(id);
      const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
      const sources = [...new Set(evidence.map((item) => sourceLabel(item)))].join(" + ") || "通知";
      const evidenceCount = Math.max(evidence.length, Number(candidate.evidence_count) || 1);
      const editedCount = Number(candidate.correction_count) || 0;
      const missingLabel = presentation.missing.length ? `需补：${presentation.missing.join("、")}` : "信息完整，可直接确认";
      const amountValue = !Number(candidate.amount_minor)
        ? ""
        : (SUPPORTED_CURRENCIES.includes(currency) ? moneyText(candidate.amount_minor, currency) : (Number(candidate.amount_minor) / 100).toFixed(2));
      const evidenceReason = evidenceExplanation(candidate, presentation);
      return `<article class="finance-candidate" data-finance-candidate="${escapeHtml(id)}" data-canonical-identity="${escapeHtml(candidate.canonical_id || "")}">
        <div class="finance-candidate-main">
          <span class="finance-direction is-${escapeHtml(direction)}">${presentation.directionLabel}</span>
          <div class="finance-candidate-copy"><strong>${presentation.amountUnknown ? "金额待补" : escapeHtml(formatMinor(presentation.amountMinor, currency))}</strong>
          ${presentation.evidenceConflict ? `<small role="status">本机与云端金额或方向不一致，请核对后编辑确认${candidate.local_evidence?.amount_minor ? `（本机金额 ${escapeHtml(formatMinor(candidate.local_evidence.amount_minor, currency))}）` : ""}。</small>` : presentation.localEvidencePending ? '<small role="status">本机已识别，等待同步；云端尚未确认。</small>' : ""}
          ${currencyNeedsReview ? `<small role="status" class="warning-text">币种待核实（${escapeHtml(currency)}）· 需人工确认</small>` : ""}
          ${isAuth ? '<small role="status" class="warning-text">预授权控制状态 · 尚未结算，不可记为实际支出</small>' : ""}
          <small>${escapeHtml(sources)} · ${escapeHtml(occurred)}</small>
          <small><span class="finance-candidate-merchant" title="${escapeHtml(presentation.merchantLabel)}">${escapeHtml(presentation.merchantLabel)}</span><span>${escapeHtml(missingLabel)}</span></small>
          <details class="finance-candidate-evidence"><summary>查看识别依据</summary><p>${escapeHtml(evidenceReason)}</p><p>结构化证据 ${evidenceCount} 条 · 置信度 ${confidence}/1000${editedCount ? ` · 用户已修改 ${editedCount} 次` : ""}</p><p>核实标识：${escapeHtml(candidate.canonical_id || "")}</p><p>事件标识：${escapeHtml(candidate.event_id || id)}</p></details></div>
        </div>
        <div class="finance-candidate-actions">
          ${presentation.missing.length && !isAuth ? `<button class="primary" type="button" data-finance-candidate-verify="${escapeHtml(id)}" ${busy ? "disabled" : ""}>核实交易</button>` : ""}
          ${isAuth ? `<button class="button-ghost" type="button" disabled title="预授权交易尚未结算，不能记入实际支出">预授权未结算</button>` : `<button ${presentation.missing.length ? 'class="button-ghost"' : ''} type="button" data-finance-candidate-confirm="${escapeHtml(id)}" ${busy ? "disabled" : ""}>${presentation.primaryAction}</button>`}
          <button class="button-ghost" type="button" data-finance-candidate-edit="${escapeHtml(id)}" ${busy ? "disabled" : ""}>编辑</button>
          <button class="danger-text" type="button" data-finance-candidate-reject="${escapeHtml(id)}" ${busy ? "disabled" : ""}>忽略</button>
          <small>忽略只关闭这条候选，不会撤销实际支付。</small>
        </div>
        <form class="finance-candidate-editor hidden" data-finance-candidate-editor="${escapeHtml(id)}">
          <label>币种
            <select name="currency" required>
              ${SUPPORTED_CURRENCIES.map(code => `<option value="${code}"${(currency === code || (!SUPPORTED_CURRENCIES.includes(currency) && code === 'CNY')) ? ' selected' : ''}>${code}</option>`).join("")}
            </select>
          </label>
          <label>金额<input type="number" step="any" min="0" name="amount" required inputmode="decimal" value="${escapeHtml(amountValue)}"></label>
          <label>方向
            <select name="direction" required>
              <option value=""${direction === "unknown" ? " selected" : ""} disabled>请选择收支方向</option>
              <option value="expense"${direction === "expense" ? " selected" : ""}>支出</option>
              <option value="income"${direction === "income" ? " selected" : ""}>收入</option>
              <option value="refund"${direction === "refund" ? " selected" : ""}>退款</option>
            </select>
          </label>
          <label>商户（可选）<input type="text" name="merchant" maxlength="160" value="${escapeHtml(candidate.merchant || "")}"></label>
          <label>时间<input type="datetime-local" name="occurred" value="${occurredLocalValue(candidate.occurred_at_ms)}"></label>
          <label>备注<input type="text" name="note" maxlength="200" value=""></label>
          <div class="finance-candidate-actions">
            <button type="submit" data-finance-candidate-save="${escapeHtml(id)}" ${busy || isAuth ? "disabled" : ""}>${isAuth ? "预授权不能记账" : "保存并确认记账"}</button>
            <button class="button-ghost" type="button" data-finance-candidate-cancel="${escapeHtml(id)}">取消</button>
          </div>
        </form>
      </article>`;
      },
    });
    restoreEditorState(rowRenderRoot(list), editorState);
  }

  function renderRecovery() {
    const section = element("financeRecoverySection"), list = element("financeRecoveryList");
    if (!section || !list) return;
    const rows = hasAccess() ? localNotificationRecovery(canonicalRecords,
      globalThis.window?.WYJLocalPaymentLedger, String(account()?.id || "")) : [];
    section.classList.toggle("hidden", !rows.length);
    section.setAttribute("aria-hidden", String(!rows.length));
    element("financeRecoveryCount").textContent = String(rows.length);
    reconcileKeyedRows(list, rows, {
      key: row => `${row.kind}:${row.id}`, signature: row => JSON.stringify(row), empty: "",
      render: row => `<article class="finance-candidate" data-recovery-identity="${escapeHtml(`${row.kind}:${row.id}`)}">
        <strong>${escapeHtml(row.app_label || row.source_package || "本机记录")}</strong>
        <p>${Number(row.amount_minor) > 0 ? escapeHtml(formatMinor(row.amount_minor)) : "金额待核实"} · ${escapeHtml(DIRECTION_LABELS[row.direction] || DIRECTION_LABELS.unknown)}</p>
        <small>${Number(row.occurred_at_ms) > 0 ? escapeHtml(new Date(Number(row.occurred_at_ms)).toLocaleString("zh-CN")) : "时间未知"}</small>
      </article>`,
    });
  }

  function occurredLocalValue(value) {
    const ms = Number(value) || 0;
    if (ms <= 0) return "";
    const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
  }

  /** Only send fields the user actually changed; machine values stay evidence. */
  function buildEdits(candidate, form) {
    const edits = {};
    const chosenCurrency = String(form.elements.currency?.value || "").trim().toUpperCase();
    const currency = SUPPORTED_CURRENCIES.includes(chosenCurrency) ? chosenCurrency : (candidate.currency || "CNY");
    const digits = currencyDigits(currency);
    const amountText = String(form.elements.amount?.value || "").trim();
    const amountVal = validateAmountText(amountText, "金额", currency);
    const newMinor = amountVal.valid ? amountVal.amountMinor : 0;
    const currencyChanged = currency !== candidate.currency;
    const amountChanged = newMinor > 0 && newMinor !== Number(candidate.amount_minor);

    if (currencyChanged || candidate.currency_review_required || (currency === "JPY" && candidate.money_unit_status === "review_required")) {
      edits.currency = currency;
      edits.amount_minor = newMinor;
      edits.amount_exponent = digits;
    } else if (amountChanged) {
      edits.amount_minor = newMinor;
      edits.amount_exponent = digits;
    }
    const direction = String(form.elements.direction.value || "");
    if (direction && direction !== String(candidate.direction || "")) edits.direction = direction;
    const merchant = String(form.elements.merchant.value || "").trim();
    if (merchant !== String(candidate.merchant || "")) edits.merchant = merchant;
    const occurredValue = String(form.elements.occurred.value || "");
    if (occurredValue) {
      const parsed = new Date(occurredValue).getTime();
      if (Number.isFinite(parsed) && parsed > 0 && parsed !== Number(candidate.occurred_at_ms)) {
        edits.occurred_at_ms = parsed;
      }
    }
    const note = String(form.elements.note.value || "").trim();
    if (note) edits.note = note;
    return edits;
  }

  async function reload({ force = false } = {}) {
    if (force && refreshInFlight) {
      // Wait for the older request to settle, then fetch again: the manual tap
      // must observe server state at tap time or later, never earlier.
      await refreshInFlight.catch(() => {});
    }
    if (!active) return;
    if (!force && refreshInFlight) return refreshInFlight;
    const started = refreshOnce("finance-candidates", () => loadCandidates());
    refreshInFlight = started;
    try {
      return await started;
    } finally {
      if (refreshInFlight === started) refreshInFlight = null;
    }
  }

  async function loadCandidates() {
    const version = listVersion.begin();
    const lifecycle = lifecycleVersion;
    const section = element("financeCandidatesSection");
    const list = element("financeCandidateList");
    if (!section) return;
    if (!hasAccess()) {
      element("financeRecoverySection")?.classList.add("hidden");
      section.classList.add("hidden");
      section.setAttribute("aria-hidden", "true");
      renderedForAccount = "";
      return;
    }
    const currentAccountId = String(account()?.id || "");
    renderedForAccount = currentAccountId;
    section.classList.remove("hidden");
    section.setAttribute("aria-hidden", "false");
    section.setAttribute("aria-busy", "true");
    if (globalThis.window?.WYJLocalPaymentLedger?.account_id === currentAccountId) {
      render(canonicalPendingCandidates({ records: mergeLocalNotificationReviews(canonicalRecords, globalThis.window?.WYJLocalPaymentLedger, currentAccountId) }));
    }
    // Never blank an already useful list while refreshing. Apart from the
    // visible have/empty/have flicker, rebuilding here destroyed a user's open
    // editor and the amount they had just typed.
    if (list && !list.querySelector("[data-finance-candidate]") && !currentCandidates.length) {
      list.innerHTML = '<div class="finance-candidate-message"><p>正在读取待确认通知…</p></div>';
    }
    try {
      const summary = await apiGet("/api/notification/pending-summary");
      if (!Array.isArray(summary?.records) || summary.truncated ||
          summary.records.filter((row) => row.state === "pending").length !== Number(summary.total_count)) {
        throw new Error("待确认交易列表不完整，请刷新重试");
      }
      // A slow earlier refresh must never repaint over a newer list (for example
      // the row the user just confirmed).
      if (!active || lifecycle !== lifecycleVersion || String(account()?.id || "") !== currentAccountId || !listVersion.isCurrent(version)) return;
      hasCanonicalObservation = true;
      canonicalRecords = summary.records;
      render(canonicalPendingCandidates({ ...summary, records: mergeLocalNotificationReviews(
        summary.records, globalThis.window?.WYJLocalPaymentLedger, currentAccountId) }));
      section.setAttribute("aria-busy", "false");
    } catch (error) {
      if (!active || lifecycle !== lifecycleVersion || String(account()?.id || "") !== currentAccountId || !listVersion.isCurrent(version)) return;
      if (error?.code === "task21_notification_not_enabled") {
        render(currentCandidates, "通知归档功能尚未启用。");
      } else if (["authentication_required", "notification_membership_required", "canonical_session_invalid"].includes(error?.code)) {
        section.classList.add("hidden");
        section.setAttribute("aria-hidden", "true");
      } else {
        render(currentCandidates, `待确认通知暂时无法加载：${error?.message || "请稍后重试"}`);
      }
      section.setAttribute("aria-busy", "false");
    }
  }

  async function decide(id, confirm, edits = null, trigger = null) {
    if (!id || busyIds.has(id)) return;
    const lifecycle = lifecycleVersion, owner = String(account()?.id || "");
    const current = () => active && lifecycle === lifecycleVersion && owner === String(account()?.id || "");
    // Feedback first: the pending state is painted before the first await, so a
    // slow or hanging request can never look like a dead button (#7).
    const trace = beginInteraction(confirm ? "finance-candidate-confirm" : "finance-candidate-reject", { id });
    trace.mark(INTERACTION_STAGES.CLICK);
    const release = attachInteractionFeedback(trigger);
    busyIds = new Set(busyIds).add(id);
    trace.mark(INTERACTION_STAGES.HANDLER_START, confirm ? "confirm" : "reject");
    reloadListState();
    let succeeded = false;
    try {
      const isHint = currentCandidates.some((item) => String(item.id) === id && item.hint === true);
      const body = isHint
        ? {
          hint_id: id,
          ...(confirm ? { device_id: deviceId() } : {}),
          ...(confirm && edits && Object.keys(edits).length ? { edits } : {}),
        }
        : confirm
          ? {
            candidate_id: id,
            device_id: deviceId(),
            ...(edits && Object.keys(edits).length ? { edits } : {}),
          }
          : { candidate_id: id };
      const path = isHint
        ? `/api/notification/hints/${confirm ? "confirm" : "ignore"}`
        : `/api/notification/candidates/${confirm ? "confirm" : "reject"}`;
      trace.mark(INTERACTION_STAGES.REQUEST_START, path);
      const response = await api(path, body);
      if (!current()) return;
      trace.mark(INTERACTION_STAGES.RESPONSE, String(response?.transaction_id || ""));
      // The server accepted the decision, so the row leaves the pending list
      // immediately (optimistic terminal state). The follow-up refresh below
      // reconciles with the server list. Invalidate any request that started
      // before this decision; its response cannot restore the terminal row.
      listVersion.begin();
      canonicalRecords = canonicalRecords.map(row => String(row.id) === String(id)
        ? { ...row, state: confirm ? "confirmed" : "ignored" } : row);
      currentCandidates = currentCandidates.filter((item) => String(item.id) !== String(id));
      render(currentCandidates, confirm ? "已记账，正在同步…" : "已忽略。");
      trace.mark(INTERACTION_STAGES.STATE_APPLY, confirm ? "booked" : "ignored");
      succeeded = true;
      onCandidateChanged(confirm ? String(response?.transaction_id || "") : "");
    } catch (error) {
      if (!current()) return;
      if (error?.code === "currency_client_upgrade_required") {
        render(currentCandidates, "操作需要新版客户端币种能力，请刷新页面或升级客户端后重试。");
      } else if (error?.code === "payment_lifecycle_not_settled") {
        render(currentCandidates, "预授权或未完成清算的记录不能记入正式支出。");
      } else if (error?.code === "currency_amount_confirmation_required") {
        render(currentCandidates, "更正币种时须重新输入并确认原币金额。");
      } else {
        render(currentCandidates, `操作失败：${error?.message || "请稍后重试"}`);
      }
      trace.mark(INTERACTION_STAGES.STATE_APPLY, "failed");
      trace.mark(INTERACTION_STAGES.RENDER_END, "error");
    } finally {
      release();
      if (current()) {
        busyIds = new Set([...busyIds].filter((item) => item !== id));
        // Read after any pre-decision request settles; an older response must
        // not restore a row that this decision has already terminalized.
        if (succeeded) {
          trace.finish(confirm ? "booked" : "ignored");
          void reload({ force: true });
        } else reloadListState();
      }
    }
  }

  function reloadListState() {
    // Re-render without network traffic so buttons reflect their busy state.
    const list = element("financeCandidateList");
    if (!list) return;
    list.querySelectorAll("[data-finance-candidate-confirm], [data-finance-candidate-reject]").forEach((button) => {
      const id = button.dataset.financeCandidateConfirm || button.dataset.financeCandidateReject;
      button.disabled = busyIds.has(id);
    });
  }

  function submitEditor(form, trigger) {
    const id = String(form?.dataset.financeCandidateEditor || "");
    const candidate = currentCandidates.find((item) => String(item.id) === id);
    if (!candidate || !form) return;
    if (isCandidateAuthorization(candidate)) {
      render(currentCandidates, "预授权交易尚未结算，不能记入实际支出。");
      return;
    }
    const chosenCurrency = String(form.elements.currency?.value || candidate.currency || "CNY").trim().toUpperCase();
    const amountVal = validateAmountText(form.elements.amount?.value, "金额", chosenCurrency);
    form.elements.amount.setCustomValidity(amountVal.valid ? "" : amountVal.message);
    const direction = String(form.elements.direction.value || "");
    form.elements.direction.setCustomValidity(VALID_DIRECTIONS.has(direction) ? "" : "请选择收支方向");
    if (!form.reportValidity()) return;
    decide(id, true, buildEdits(candidate, form), trigger);
  }

  function handleSubmit(event) {
    const form = event.target.closest("[data-finance-candidate-editor]");
    if (!form) return;
    event.preventDefault();
    submitEditor(form, form.querySelector("[data-finance-candidate-save]"));
  }

  function handleClick(event) {
    const verifyButton = event.target.closest("[data-finance-candidate-verify]");
    if (verifyButton) {
      const id = verifyButton.dataset.financeCandidateVerify;
      const candidate = currentCandidates.find((item) => String(item.id) === String(id));
      const eventId = String(candidate?.event_id || "");
      if (!/thewyj-android\//.test(navigator.userAgent) || !eventId) {
        render(currentCandidates, "请在收到这笔交易通知的 Android Aeris App 中打开财务页，再点击「核实交易」。");
      } else {
        window.location.href = `thewyj://payment/verify?event_id=${encodeURIComponent(eventId)}`;
      }
      return;
    }
    const editButton = event.target.closest("[data-finance-candidate-edit]");
    if (editButton) {
      const id = editButton.dataset.financeCandidateEdit;
      const form = document.querySelector(`[data-finance-candidate-editor="${CSS.escape(id)}"]`);
      if (form) {
        form.classList.toggle("hidden");
        editButton.textContent = form.classList.contains("hidden") ? "编辑并确认" : "收起编辑";
      }
      return;
    }
    const cancelButton = event.target.closest("[data-finance-candidate-cancel]");
    if (cancelButton) {
      const id = cancelButton.dataset.financeCandidateCancel;
      document.querySelector(`[data-finance-candidate-editor="${CSS.escape(id)}"]`)?.classList.add("hidden");
      const editButton = document.querySelector(`[data-finance-candidate-edit="${CSS.escape(id)}"]`);
      if (editButton) editButton.textContent = "编辑并确认";
      return;
    }
    const saveButton = event.target.closest("[data-finance-candidate-save]");
    if (saveButton) {
      event.preventDefault();
      const form = saveButton.closest("[data-finance-candidate-editor]");
      submitEditor(form, saveButton);
      return;
    }
    const confirmButton = event.target.closest("[data-finance-candidate-confirm]");
    if (confirmButton) {
      const id = confirmButton.dataset.financeCandidateConfirm;
      const candidate = currentCandidates.find((item) => String(item.id) === String(id));
      if (isCandidateAuthorization(candidate)) {
        render(currentCandidates, "此记录为预授权控制状态，尚未完成清算，不可记入实际支出。");
        return;
      }
      // A hint without an amount or without a direction or needing currency review
      // can never be confirmed as-is: open the editor so the user supplies the
      // missing field instead of sending a request that fails.
      if (candidateNeedsEditor(candidate)) {
        const presentation = candidatePresentation(candidate);
        render(currentCandidates, presentation.evidenceConflict
          ? "本机与云端证据不一致，请核对并编辑后确认。"
          : `这笔交易需要补全或核对${presentation.missing.join("和")}后才能确认。`);
        const form = document.querySelector(`[data-finance-candidate-editor="${CSS.escape(id)}"]`);
        if (form) {
          form.classList.remove("hidden");
          if (presentation.currencyNeedsReview) form.elements.currency?.focus();
          else if (presentation.amountUnknown) form.elements.amount?.focus();
          else form.elements.direction?.focus();
        }
        return;
      }
      decide(id, true, null, confirmButton);
      return;
    }
    const rejectButton = event.target.closest("[data-finance-candidate-reject]");
    if (rejectButton) {
      decide(rejectButton.dataset.financeCandidateReject, false, null, rejectButton);
      return;
    }
    const refreshButton = event.target.closest("#financeCandidatesRefreshBtn");
    if (refreshButton) {
      // #7 browser regression: a manual refresh also waits on two requests, so
      // the button must show its pending state before the first await.
      void withInteractionFeedback(refreshButton, "finance-candidates-refresh", () => reload({ force: true }));
      return;
    }
  }

  function show() {
    active = true;
    reviewRows.resume();
    recoveryRows.resume();
    if (!bound) {
      bound = true;
      pendingDisclosure = createFinanceDisclosure({ element: element("financeCandidatesSection"), storage,
        accountId: () => account()?.id, section: "pending", defaultOpen: true });
      pendingDisclosure.restore();
      element("financeCandidatesSection")?.addEventListener("click", handleClick);
      element("financeCandidatesSection")?.addEventListener("submit", handleSubmit);
      document.addEventListener("thewyj:payment-updated", () => {
        if (!active) return;
        const snapshot = globalThis.window?.WYJLocalPaymentLedger;
        render(canonicalPendingCandidates({ records: mergeLocalNotificationReviews(canonicalRecords, snapshot, String(account()?.id || "")) }));
        void reload({ force: true });
      });
      document.addEventListener("visibilitychange", () => {
        if (active && document.visibilityState === "visible" && hasAccess()) void reload({ force: true });
      });
    }
    return reload({ force: true });
  }

  function hide() {
    active = false;
    lifecycleVersion += 1;
    busyIds = new Set();
    reviewRows.park();
    recoveryRows.park();
    // Invalidate any request started for the page being left. Its late response
    // must not rebuild state behind the next route.
    listVersion.begin();
    const section = element("financeCandidatesSection");
    element("financeRecoverySection")?.classList.add("hidden");
    if (section) {
      section.classList.add("hidden");
      section.setAttribute("aria-hidden", "true");
    }
  }

  function accountUpdated() {
    if (renderedForAccount && renderedForAccount !== String(account()?.id || "")) {
      hide();
      reviewRows.clear();
      recoveryRows.clear();
      renderedForAccount = "";
      currentCandidates = [];
      canonicalRecords = [];
      hasCanonicalObservation = false;
    }
    if (!element("financePage")?.classList.contains("hidden")) { active = true; void reload({ force: true }); }
  }

  const dashboardSummary = () => ({ known: hasCanonicalObservation && renderedForAccount === String(account()?.id || ""), count: currentCandidates.length });
  return Object.freeze({ show, hide, reload, accountUpdated, handleClick, dashboardSummary });
}
import { createParkedRows, rowRenderRoot } from "../core/parked-rows.js?release=20261109-aeris-p07-production-r2";
