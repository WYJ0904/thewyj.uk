import { randomId } from "../core/capabilities.js?v=20260920-task24-candidate-r6";
import {
  INTERACTION_STAGES,
  attachInteractionFeedback,
  beginInteraction,
  createLatestOnly,
  createSingleFlight,
  withInteractionFeedback,
} from "../core/perf.js?v=20260920-task24-candidate-r6";
const CANDIDATE_PAGE_LIMIT = 100;
const FINANCE_DEVICE_KEY = "wyjFinanceDevice:v1";
const DIRECTION_LABELS = Object.freeze({ income: "收入", expense: "支出", refund: "退款", unknown: "方向待核实" });
const VALID_DIRECTIONS = new Set(["income", "expense", "refund"]);
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
 */
export function candidateNeedsEditor(candidate) {
  const amountMissing = !Number(candidate?.amount_minor);
  const directionMissing = !VALID_DIRECTIONS.has(String(candidate?.direction || "").trim().toLowerCase());
  return amountMissing || directionMissing;
}

export function candidatePresentation(candidate) {
  const amountUnknown = !Number(candidate?.amount_minor);
  const rawDirection = String(candidate?.direction || "").trim().toLowerCase();
  const direction = VALID_DIRECTIONS.has(rawDirection) ? rawDirection : "unknown";
  const merchant = String(candidate?.merchant || candidate?.counterparty || "").trim();
  const missing = [];
  if (amountUnknown) missing.push("金额");
  if (direction === "unknown") missing.push("收支方向");
  return Object.freeze({
    amountUnknown,
    direction,
    directionLabel: DIRECTION_LABELS[direction],
    merchant,
    merchantLabel: merchant || "商户未知（可选）",
    missing,
    primaryAction: missing.length ? "补全并确认" : "确认记账",
  });
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
  const amount = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function evidenceExplanation(candidate, presentation) {
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
  let renderedForAccount = "";
  let bound = false;
  // Task 24 reopen #7: one *automatic* refresh at a time, and only the newest
  // list may paint. A manual refresh must never be answered by a load that
  // started before the user's click (legacy Task 21 gate: the second candidate
  // ingested right before the tap stayed invisible because the click joined an
  // in-flight list request).
  const refreshOnce = createSingleFlight();
  const listVersion = createLatestOnly();
  let refreshInFlight = null;

  const element = (id) => document.getElementById(id);

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
    const editorState = captureEditorState(list);
    currentCandidates = [...candidates];
    const banner = message
      ? `<div class="finance-candidate-message"><p>${escapeHtml(message)}</p></div>`
      : "";
    if (!candidates.length) {
      list.innerHTML = banner || '<div class="finance-candidate-empty"><strong>暂无待确认通知</strong><p>Android 低置信交易会先出现在这里，确认后才进入账目与统计。</p></div>';
      return;
    }
    list.innerHTML = banner + candidates.map((candidate) => {
      const id = String(candidate.id || "");
      const presentation = candidatePresentation(candidate);
      const { direction } = presentation;
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
      const amountValue = presentation.amountUnknown ? "" : (Number(candidate.amount_minor) / 100).toFixed(2);
      const evidenceReason = evidenceExplanation(candidate, presentation);
      return `<article class="finance-candidate" data-finance-candidate="${escapeHtml(id)}">
        <div class="finance-candidate-main">
          <span class="finance-direction is-${escapeHtml(direction)}">${presentation.directionLabel}</span>
          <div class="finance-candidate-copy"><strong>${presentation.amountUnknown ? "金额待补" : escapeHtml(formatMinor(candidate.amount_minor, candidate.currency))}</strong>
          <small>${escapeHtml(sources)} · ${escapeHtml(occurred)}</small>
          <small>${escapeHtml(presentation.merchantLabel)} · ${escapeHtml(missingLabel)}</small>
          <details class="finance-candidate-evidence"><summary>查看识别依据</summary><p>${escapeHtml(evidenceReason)}</p><p>结构化证据 ${evidenceCount} 条 · 置信度 ${confidence}/1000${editedCount ? ` · 用户已修改 ${editedCount} 次` : ""}</p><p>事件标识：${escapeHtml(candidate.event_id || id)}</p></details></div>
        </div>
        <div class="finance-candidate-actions">
          <button type="button" data-finance-candidate-confirm="${escapeHtml(id)}" ${busy ? "disabled" : ""}>${presentation.primaryAction}</button>
          <button class="button-ghost" type="button" data-finance-candidate-edit="${escapeHtml(id)}" ${busy ? "disabled" : ""}>编辑</button>
          <button class="danger-text" type="button" data-finance-candidate-reject="${escapeHtml(id)}" ${busy ? "disabled" : ""}>忽略</button>
          <small>忽略只关闭这条候选，不会撤销实际支付。</small>
        </div>
        <form class="finance-candidate-editor hidden" data-finance-candidate-editor="${escapeHtml(id)}">
          <label>金额<input type="number" step="0.01" min="0.01" name="amount" required inputmode="decimal" value="${escapeHtml(amountValue)}"></label>
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
            <button type="submit" data-finance-candidate-save="${escapeHtml(id)}" ${busy ? "disabled" : ""}>保存并确认记账</button>
            <button class="button-ghost" type="button" data-finance-candidate-cancel="${escapeHtml(id)}">取消</button>
          </div>
        </form>
      </article>`;
    }).join("");
    restoreEditorState(list, editorState);
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
    const amountValue = Number(form.elements.amount.value);
    if (Number.isFinite(amountValue) && Math.round(amountValue * 100) !== Number(candidate.amount_minor)) {
      edits.amount_minor = Math.round(amountValue * 100);
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
    const section = element("financeCandidatesSection");
    const list = element("financeCandidateList");
    if (!section) return;
    if (!hasAccess()) {
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
    // Never blank an already useful list while refreshing. Apart from the
    // visible have/empty/have flicker, rebuilding here destroyed a user's open
    // editor and the amount they had just typed.
    if (list && !list.querySelector("[data-finance-candidate]") && !currentCandidates.length) {
      list.innerHTML = '<div class="finance-candidate-message"><p>正在读取待确认通知…</p></div>';
    }
    try {
      const payload = await apiGet(`/api/notification/candidates?status=pending&limit=${CANDIDATE_PAGE_LIMIT}`);
      const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
      // Task 24.1 P0-3: the same list also shows the unified pending hints, so a
      // payment the device could not complete is actionable here instead of only
      // inside the app. Identity stays the hint id; the server owns the state.
      const loadedHints = await loadPendingHints();
      // A temporary hint-endpoint failure must not make otherwise actionable
      // rows disappear. Keep the last known hints until a successful response
      // replaces them.
      const hints = loadedHints === null
        ? currentCandidates.filter((item) => item.hint === true)
        : loadedHints;
      // A slow earlier refresh must never repaint over a newer list (for example
      // the row the user just confirmed).
      if (!listVersion.isCurrent(version)) return;
      render([...hints, ...candidates]);
      section.setAttribute("aria-busy", "false");
    } catch (error) {
      if (!listVersion.isCurrent(version)) return;
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

  /** Pending hints mapped onto the candidate render shape (id stays the hint id). */
  async function loadPendingHints() {
    try {
      const payload = await apiGet("/api/notification/hints?state=pending&limit=100");
      const rows = Array.isArray(payload?.hints) ? payload.hints : [];
      return rows.map((hint) => ({
        id: String(hint.id || ""),
        hint: true,
        event_id: String(hint.source_event_id || ""),
        direction: String(hint.direction || ""),
        amount_minor: Number(hint.amount_minor) || 0,
        currency: String(hint.currency || "CNY"),
        merchant: String(hint.merchant || ""),
        counterparty: "",
        payment_channel: "",
        occurred_at_ms: Date.parse(String(hint.created_at || "")) || 0,
        confidence: Number(hint.confidence) || 0,
        status: "pending",
        evidence: [{
          source_type: String(hint.source_type || "notification"),
          source_package: String(hint.source_package || ""),
          app_label: String(hint.app_label || ""),
        }],
        evidence_count: 1,
        correction_count: 0,
        recognition_reasons: Array.isArray(hint.evidence?.reasons) ? hint.evidence.reasons : [],
      })).filter((item) => item.id);
    } catch (_) {
      // A missing hint endpoint must not hide the candidate list.
      return null;
    }
  }

  async function decide(id, confirm, edits = null, trigger = null) {
    if (!id || busyIds.has(id)) return;
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
      trace.mark(INTERACTION_STAGES.RESPONSE, String(response?.transaction_id || ""));
      // The server accepted the decision, so the row leaves the pending list
      // immediately (optimistic terminal state). The follow-up refresh below
      // reconciles with the server list; a stale refresh cannot undo this paint
      // because loadCandidates() drops answers from an older version.
      currentCandidates = currentCandidates.filter((item) => String(item.id) !== String(id));
      render(currentCandidates, confirm ? "已记账，正在同步…" : "已忽略。");
      trace.mark(INTERACTION_STAGES.STATE_APPLY, confirm ? "booked" : "ignored");
      succeeded = true;
      onCandidateChanged(confirm ? String(response?.transaction_id || "") : "");
    } catch (error) {
      render(currentCandidates, `操作失败：${error?.message || "请稍后重试"}`);
      trace.mark(INTERACTION_STAGES.STATE_APPLY, "failed");
      trace.mark(INTERACTION_STAGES.RENDER_END, "error");
    } finally {
      busyIds = new Set([...busyIds].filter((item) => item !== id));
      release();
      // Reconcile in the background: the user already sees the result, and the
      // refresh itself is single-flighted so a burst of confirms fetches once.
      if (succeeded) {
        trace.finish(confirm ? "booked" : "ignored");
        void reload();
      }
      else reloadListState();
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
    const amount = Number(form.elements.amount.value);
    const direction = String(form.elements.direction.value || "");
    form.elements.amount.setCustomValidity(Number.isFinite(amount) && amount > 0 ? "" : "请填写大于 0 的金额");
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
      // A hint without an amount or without a direction can never be confirmed
      // as-is: the server rejects it (hint_amount_required /
      // hint_direction_required). Open the editor so the user supplies the
      // missing field instead of sending a request that silently fails.
      if (candidateNeedsEditor(candidate)) {
        const presentation = candidatePresentation(candidate);
        // Render first, then reveal the freshly rendered form: render()
        // rebuilds the list HTML, so revealing the old node had no effect.
        render(currentCandidates, `这笔交易需要补全${presentation.missing.join("和")}后才能确认。`);
        const form = document.querySelector(`[data-finance-candidate-editor="${CSS.escape(id)}"]`);
        if (form) {
          form.classList.remove("hidden");
          if (presentation.amountUnknown) form.elements.amount?.focus();
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
    if (!bound) {
      bound = true;
      element("financeCandidatesSection")?.addEventListener("click", handleClick);
      element("financeCandidatesSection")?.addEventListener("submit", handleSubmit);
    }
    return reload();
  }

  function hide() {
    // Invalidate any request started for the page being left. Its late response
    // must not rebuild state behind the next route.
    listVersion.begin();
    const section = element("financeCandidatesSection");
    if (section) {
      section.classList.add("hidden");
      section.setAttribute("aria-hidden", "true");
    }
  }

  function accountUpdated() {
    if (renderedForAccount && renderedForAccount !== String(account()?.id || "")) {
      hide();
      renderedForAccount = "";
      currentCandidates = [];
    }
    if (!element("financePage")?.classList.contains("hidden")) reload();
  }

  return Object.freeze({ show, hide, reload, accountUpdated, handleClick });
}
