const CANDIDATE_PAGE_LIMIT = 100;
const FINANCE_DEVICE_KEY = "wyjFinanceDevice:v1";
const DIRECTION_LABELS = Object.freeze({ income: "收入", expense: "支出", refund: "退款" });

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
      value = `web:${crypto.randomUUID()}`;
      storage.setItem(FINANCE_DEVICE_KEY, value);
    }
    return value;
  }

  function hasAccess() {
    const value = account();
    return Boolean(value && (isSuperAdmin(value)
      || hasEntitlement("notification_archive_access", value)
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
      return `<article class="finance-candidate" data-finance-candidate="${escapeHtml(id)}">
        <div class="finance-candidate-main">
          <span class="finance-direction is-${escapeHtml(direction)}">${label}</span>
          <div><strong>${escapeHtml(formatMinor(candidate.amount_minor, candidate.currency))}</strong>
          <small>${escapeHtml(merchant)} · ${escapeHtml(occurred)} · 置信度 ${confidence}/1000</small></div>
        </div>
        <div class="finance-candidate-actions">
          <button type="button" data-finance-candidate-confirm="${escapeHtml(id)}" ${busy ? "disabled" : ""}>确认记账</button>
          <button class="danger-text" type="button" data-finance-candidate-reject="${escapeHtml(id)}" ${busy ? "disabled" : ""}>拒绝</button>
        </div>
      </article>`;
    }).join("");
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
      render(Array.isArray(payload?.candidates) ? payload.candidates : []);
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

  async function decide(id, confirm) {
    if (!id || busyIds.has(id)) return;
    busyIds = new Set(busyIds).add(id);
    reloadListState();
    let succeeded = false;
    try {
      const body = confirm ? { candidate_id: id, device_id: deviceId() } : { candidate_id: id };
      await api(`/api/notification/candidates/${confirm ? "confirm" : "reject"}`, body);
      succeeded = true;
      onCandidateChanged();
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
    const confirmButton = event.target.closest("[data-finance-candidate-confirm]");
    if (confirmButton) {
      decide(confirmButton.dataset.financeCandidateConfirm, true);
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
