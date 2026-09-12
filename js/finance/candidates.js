import { randomId } from "../core/capabilities.js?v=20260912-task24-4-r2";
const CANDIDATE_PAGE_LIMIT = 100;
const FINANCE_DEVICE_KEY = "wyjFinanceDevice:v1";
const DIRECTION_LABELS = Object.freeze({ income: "收入", expense: "支出", refund: "退款" });
const SOURCE_LABELS = Object.freeze({
  "com.tencent.mm": "微信",
  "com.eg.android.AlipayGphone": "支付宝",
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
  const directionMissing = !String(candidate?.direction || "").trim();
  return amountMissing || directionMissing;
}

function sourceLabel(evidence) {
  const packageName = String(evidence?.source_package || "");
  if (SOURCE_LABELS[packageName]) return SOURCE_LABELS[packageName];
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

  function render(candidates, message = "") {
    const list = element("financeCandidateList");
    const section = element("financeCandidatesSection");
    if (!list || !section) return;
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
      const direction = String(candidate.direction || "expense");
      const label = DIRECTION_LABELS[direction] || "交易";
      const merchant = String(candidate.merchant || candidate.counterparty || "未知来源");
      const occurred = Number(candidate.occurred_at_ms) > 0
        ? new Date(Number(candidate.occurred_at_ms)).toLocaleString("zh-CN")
        : "时间未知";
      const confidence = Math.max(0, Math.min(1000, Number(candidate.confidence) || 0));
      const busy = busyIds.has(id);
      const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
      const sources = [...new Set(evidence.map((item) => sourceLabel(item)))].join(" + ") || "通知";
      const evidenceCount = Math.max(evidence.length, Number(candidate.evidence_count) || 1);
      const editedCount = Number(candidate.correction_count) || 0;
      const missing = [];
      const amountUnknown = !Number(candidate.amount_minor);
      const directionUnknown = !String(candidate.direction || "").trim();
      if (amountUnknown) missing.push("金额");
      if (directionUnknown) missing.push("方向");
      if (!String(candidate.merchant || candidate.counterparty || "")) missing.push("商户");
      const missingLabel = missing.length ? ` · 缺少：${missing.join("、")}` : "";
      const confirmLabel = amountUnknown
        ? "填写金额并确认"
        : directionUnknown ? "选择方向并确认" : "确认记账";
      return `<article class="finance-candidate" data-finance-candidate="${escapeHtml(id)}">
        <div class="finance-candidate-main">
          <span class="finance-direction is-${escapeHtml(direction)}">${label}</span>
          <div><strong>${amountUnknown ? "金额待填写" : escapeHtml(formatMinor(candidate.amount_minor, candidate.currency))}</strong>
          <small>${escapeHtml(merchant)} · ${escapeHtml(occurred)} · 置信度 ${confidence}/1000</small>
          <small>来源：${escapeHtml(sources)} · 证据 ${evidenceCount} 条${editedCount ? ` · 已修改 ${editedCount} 次` : ""}${escapeHtml(missingLabel)}</small></div>
        </div>
        <div class="finance-candidate-actions">
          <button class="button-ghost" type="button" data-finance-candidate-edit="${escapeHtml(id)}" ${busy ? "disabled" : ""}>编辑并确认</button>
          <button type="button" data-finance-candidate-confirm="${escapeHtml(id)}" ${busy ? "disabled" : ""}>${confirmLabel}</button>
          <button class="danger-text" type="button" data-finance-candidate-reject="${escapeHtml(id)}" ${busy ? "disabled" : ""}>拒绝</button>
        </div>
        <form class="finance-candidate-editor hidden" data-finance-candidate-editor="${escapeHtml(id)}">
          <label>金额<input type="number" step="0.01" min="0.01" name="amount" value="${escapeHtml((Number(candidate.amount_minor) / 100).toFixed(2))}"></label>
          <label>方向
            <select name="direction">
              <option value="expense"${direction === "expense" ? " selected" : ""}>支出</option>
              <option value="income"${direction === "income" ? " selected" : ""}>收入</option>
              <option value="refund"${direction === "refund" ? " selected" : ""}>退款</option>
            </select>
          </label>
          <label>商户<input type="text" name="merchant" maxlength="160" value="${escapeHtml(candidate.merchant || "")}"></label>
          <label>时间<input type="datetime-local" name="occurred" value="${occurredLocalValue(candidate.occurred_at_ms)}"></label>
          <label>备注<input type="text" name="note" maxlength="200" value=""></label>
          <div class="finance-candidate-actions">
            <button type="button" data-finance-candidate-save="${escapeHtml(id)}" ${busy ? "disabled" : ""}>保存并确认记账</button>
            <button class="button-ghost" type="button" data-finance-candidate-cancel="${escapeHtml(id)}">取消</button>
          </div>
        </form>
      </article>`;
    }).join("");
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

  async function reload() {
    const section = element("financeCandidatesSection");
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
    render([], "");
    try {
      const payload = await apiGet(`/api/notification/candidates?status=pending&limit=${CANDIDATE_PAGE_LIMIT}`);
      const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
      // Task 24.1 P0-3: the same list also shows the unified pending hints, so a
      // payment the device could not complete is actionable here instead of only
      // inside the app. Identity stays the hint id; the server owns the state.
      const hints = await loadPendingHints();
      render([...hints, ...candidates]);
    } catch (error) {
      if (error?.code === "task21_notification_not_enabled") {
        render([], "通知归档功能尚未启用。");
      } else if (["authentication_required", "notification_membership_required", "canonical_session_invalid"].includes(error?.code)) {
        section.classList.add("hidden");
        section.setAttribute("aria-hidden", "true");
      } else {
        render([], `待确认通知暂时无法加载：${error?.message || "请稍后重试"}`);
      }
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
        merchant: String(hint.merchant || hint.app_label || ""),
        counterparty: "",
        payment_channel: "",
        occurred_at_ms: Date.parse(String(hint.created_at || "")) || 0,
        confidence: Number(hint.confidence) || 0,
        status: "pending",
        evidence: [{ source_type: String(hint.source_type || "notification") }],
        evidence_count: 1,
        correction_count: 0,
      })).filter((item) => item.id);
    } catch (_) {
      // A missing hint endpoint must not hide the candidate list.
      return [];
    }
  }

  async function decide(id, confirm, edits = null) {
    if (!id || busyIds.has(id)) return;
    busyIds = new Set(busyIds).add(id);
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
      const response = await api(path, body);
      succeeded = true;
      onCandidateChanged(confirm ? String(response?.transaction_id || "") : "");
    } catch (error) {
      render(currentCandidates, `操作失败：${error?.message || "请稍后重试"}`);
    } finally {
      busyIds = new Set([...busyIds].filter((item) => item !== id));
      if (succeeded) await reload();
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
      const id = saveButton.dataset.financeCandidateSave;
      const candidate = currentCandidates.find((item) => String(item.id) === String(id));
      const form = document.querySelector(`[data-finance-candidate-editor="${CSS.escape(id)}"]`);
      if (!candidate || !form) return;
      decide(id, true, buildEdits(candidate, form));
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
        const amountMissing = !Number(candidate?.amount_minor);
        // Render first, then reveal the freshly rendered form: render()
        // rebuilds the list HTML, so revealing the old node had no effect.
        render(currentCandidates, amountMissing
          ? "这笔交易缺少金额：请填写金额与方向后保存确认。"
          : "这笔交易缺少收支方向：请选择方向后保存确认。");
        const form = document.querySelector(`[data-finance-candidate-editor="${CSS.escape(id)}"]`);
        if (form) {
          form.classList.remove("hidden");
          if (amountMissing) form.elements.amount?.focus();
          else form.elements.direction?.focus();
        }
        return;
      }
      decide(id, true);
      return;
    }
    const rejectButton = event.target.closest("[data-finance-candidate-reject]");
    if (rejectButton) {
      decide(rejectButton.dataset.financeCandidateReject, false);
      return;
    }
    if (event.target.closest("#financeCandidatesRefreshBtn")) reload();
  }

  function show() {
    if (!bound) {
      bound = true;
      element("financeCandidatesSection")?.addEventListener("click", handleClick);
    }
    return reload();
  }

  function hide() {
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
