import { $, escapeHtml } from "./ui.js?release=20261127-aeris-p5-cache-fix";
import { reconcileKeyedRows } from "./keyed-list.js?release=20261127-aeris-p5-cache-fix";
import { createHomeWidgets } from "./home-widgets.js?release=20261127-aeris-p5-cache-fix";
import { projectHomeWidgets } from "./home-widget-data.js?release=20261127-aeris-p5-cache-fix";
import {
  HOME_SHORTCUT_CATALOG,
  defaultHomeShortcuts,
  homeWidgetStorageKey,
  mergeHomeShortcutsRecord,
  sanitizeHomeShortcuts,
} from "./home-widget-layout.js?release=20261127-aeris-p5-cache-fix";
import { getSafeStorage, safeStorageSet } from "./storage.js?release=20261127-aeris-p5-cache-fix";

const SHORTCUT_ICONS = Object.freeze({
  book: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h6a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5H4zM20 5h-6a2 2 0 0 0-2 2v12a1.5 1.5 0 0 1 1.5-1.5H20z"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/></svg>',
  tool: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.6 5.6a1.5 1.5 0 0 0 2.1 2.1l5.6-5.6a4 4 0 0 0 5.4-5.4l-2.2 2.2-2.1-2.1z"/></svg>',
  workflow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6h3.5a3 3 0 0 1 3 3v.5M8.5 18h3.5a3 3 0 0 0 3-3v-.5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 8-4 4 4 4m8-8 4 4-4 4m-5 2 2-12"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-4.5-4.5L9 18"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 8-8m-3 3 2.5 2.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12l3 5-9 11L3 9zM3 9h18"/></svg>',
});
const bound = new WeakSet();
const setText = (node,value) => { if(node && node.textContent!==String(value))node.textContent=String(value); };

/** Formats time-of-day greeting strictly for verified authenticated accounts. */
export function formatLocalTimeGreeting(account, now = new Date()) {
  const displayName = String(account?.display_name || account?.username || "").trim();
  if (!account || !displayName) return { greeting: "", prompt: "", isLateNight: false };
  const hour = typeof now?.getHours === "function" ? now.getHours() : new Date().getHours();
  if (hour >= 0 && hour <= 4) {
    return {
      greeting: `这么晚不睡，${displayName}，请多注意身体。`,
      prompt: "",
      isLateNight: true,
    };
  }
  const period = hour <= 10 ? "早上好" : hour <= 13 ? "中午好" : hour <= 17 ? "下午好" : "晚上好";
  return {
    greeting: `${displayName}，${period}。`,
    prompt: "Aeris 有什么能帮你？",
    isLateNight: false,
  };
}

/** Shared home presentation. State and service owners remain in their modules. */
export function createDashboardView(context) {
 let lastDetailModel = null;
 function makeFactRow(doc, label, value) {
  const row = doc.createElement("div");
  row.className = "workspace-detail-fact";
  const dt = doc.createElement("span");
  dt.textContent = label;
  const dd = doc.createElement("strong");
  dd.className = "tabular-nums";
  dd.textContent = value;
  row.append(dt, dd);
  return row;
 }
 function makeModalActionButton(doc, label, className, handler) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", handler);
  return btn;
 }
 function openWorkspaceDetailModal(moduleId, triggerEl = null) {
  const modal = $("workspaceDetailModal");
  if (!modal || typeof context.openModal !== "function") {
   context.openHomeModule(moduleId);
   return;
  }
  const doc = modal.ownerDocument;
  if (triggerEl && triggerEl.isConnected && typeof triggerEl.focus === "function" && doc.activeElement !== triggerEl) {
   triggerEl.focus({ preventScroll: true });
  }
  const data = lastDetailModel || { snapshot: projectHomeWidgets({ demo: false }), summary: {}, entitlements: [], account: null, resumable: [], pending: null, transfer: { count: 0 }, financeKnown: false, toolSummary: { favorites: [], recent: [] }, backendAvailable: false };
  const kickerEl = $("workspaceDetailKicker");
  const titleEl = $("workspaceDetailTitle");
  const bodyEl = $("workspaceDetailBody");
  const actionsEl = $("workspaceDetailActions");
  if (!bodyEl || !actionsEl) return;

  bodyEl.replaceChildren();
  actionsEl.replaceChildren();
  const facts = doc.createElement("div");
  facts.className = "workspace-detail-facts";
  const lead = doc.createElement("p");
  lead.className = "workspace-detail-lead";

  const goRoute = (target) => {
   context.closeModal?.("workspaceDetailModal", true);
   context.openHomeModule(target);
  };

  if (moduleId === "learning") {
   setText(kickerEl, "LEARNING · 语言学习");
   setText(titleEl, "学习进度与错题复习");
   const latest = data.snapshot.learning?.modes?.latest || {};
   lead.textContent = latest.detail || "完成测试后自动汇总学习记录与错题本。";
   facts.append(
    makeFactRow(doc, "最近练习", latest.value || "暂无记录"),
    makeFactRow(doc, "连续学习", data.snapshot.learning?.modes?.streak?.value || "0 天"),
    makeFactRow(doc, "待复习错题", data.snapshot.learning?.modes?.wrong?.value || "0 个"),
    makeFactRow(doc, "今日进度", data.snapshot.learning?.modes?.today?.detail || "尚未开始"),
   );
   bodyEl.append(lead, facts);
   if (data.resumable?.includes("english")) {
    actionsEl.append(makeModalActionButton(doc, "继续英语测试", "primary", () => { context.closeModal?.("workspaceDetailModal", true); $("dashboardResumeEnglish")?.click(); }));
   }
   if (data.resumable?.includes("japanese")) {
    actionsEl.append(makeModalActionButton(doc, "继续日语测试", "primary", () => { context.closeModal?.("workspaceDetailModal", true); $("dashboardResumeJapanese")?.click(); }));
   }
   actionsEl.append(
    makeModalActionButton(doc, "立即同步学习数据", "button-secondary", () => { context.closeModal?.("workspaceDetailModal", true); $("learningSyncNowBtn")?.click(); }),
    makeModalActionButton(doc, "打开学习工作区", "button-secondary", () => goRoute("/language")),
   );
  } else if (moduleId === "finance") {
   setText(kickerEl, "FINANCE · 财务账本");
   setText(titleEl, "本月账本与收支摘要");
   const f = data.snapshot.finance?.modes || {};
   lead.textContent = data.financeKnown ? (data.snapshot.finance?.extra || "仅展示当前账户真实收支。") : "当前尚未拉取完整账本记录，点击下方可进入账本页实时读取。";
   facts.append(
    makeFactRow(doc, "本月余额", f.balance?.value || "尚未读取"),
    makeFactRow(doc, "本月收入", f.income?.value || "尚未读取"),
    makeFactRow(doc, "本月支出", f.expense?.value || "尚未读取"),
    makeFactRow(doc, "同步状态", f.balance?.status || "尚未读取"),
   );
   bodyEl.append(lead, facts);
   actionsEl.append(makeModalActionButton(doc, "打开财务账本", "primary", () => goRoute("/finance")));
  } else if (moduleId === "tools") {
   setText(kickerEl, "TOOLS · 实用工具");
   setText(titleEl, "收藏与最近使用工具");
   lead.textContent = data.snapshot.tools?.extra || "所有文本、JSON 与图片工具均在当前浏览器本机运行。";
   facts.append(
    makeFactRow(doc, "最近工具", data.snapshot.tools?.modes?.recent?.value || "暂无最近工具"),
    makeFactRow(doc, "收藏数量", `${data.toolSummary?.favorites?.length || 0} 项`),
    makeFactRow(doc, "最近记录", `${data.toolSummary?.recent?.length || 0} 项`),
   );
   bodyEl.append(lead, facts);
   if (data.snapshot.tools?.continuePath) {
    actionsEl.append(makeModalActionButton(doc, "继续最近工具", "primary", () => goRoute(data.snapshot.tools.continuePath)));
   }
   actionsEl.append(makeModalActionButton(doc, "打开全部工具箱", "button-secondary", () => goRoute("/tools")));
  } else if (moduleId === "transfer") {
   setText(kickerEl, "TRANSFER · 文件传输");
   setText(titleEl, "文件传输与受控分享");
   const tr = data.snapshot.transfer || {};
   lead.textContent = tr.detail || "文件由本人显式选择上传与管理。";
   facts.append(
    makeFactRow(doc, "传输状态", tr.value || "尚未读取"),
    makeFactRow(doc, "分享权限", tr.state === "restricted" ? "受限 / 未开通" : "账户权限可用"),
    makeFactRow(doc, "服务可用性", tr.status || "尚未读取"),
   );
   bodyEl.append(lead, facts);
   actionsEl.append(makeModalActionButton(doc, "打开文件传输页", "primary", () => goRoute("/transfer")));
  } else if (moduleId === "activity") {
   setText(kickerEl, "ACTIVITY · 最近动态");
   setText(titleEl, "账户活动与待核实通知");
   lead.textContent = "以下摘要仅来自当前登录账户的本地与服务端记录。";
   facts.append(
    makeFactRow(doc, "最近动态", `${data.snapshot.activity?.length || 0} 条`),
    makeFactRow(doc, "待核实通知", data.pending?.known ? `${data.pending.count} 项` : "未读取"),
   );
   bodyEl.append(lead, facts);
   if (data.snapshot.activity?.length) {
    const ul = doc.createElement("ul");
    ul.className = "workspace-detail-activity";
    for (const entry of data.snapshot.activity) {
     const li = doc.createElement("li");
     li.textContent = `${entry.label}（${context.formatLocalDateTime(entry.at)}）`;
     ul.appendChild(li);
    }
    bodyEl.appendChild(ul);
   }
   actionsEl.append(
    makeModalActionButton(doc, "核实通知与账单", "primary", () => goRoute("/finance")),
    makeModalActionButton(doc, "打开安全与通知中心", "button-secondary", () => { context.closeModal?.("workspaceDetailModal", true); $("dashboardNotificationsBtn")?.click(); }),
   );
  } else {
   setText(kickerEl, "ACCOUNT · 账户与权益");
   setText(titleEl, "当前账户会员与服务状态");
   lead.textContent = "会员身份、服务连通性与本地隔离状态真实反映当前会话。";
   facts.append(
    makeFactRow(doc, "当前账户", data.account?.username || "未登录"),
    makeFactRow(doc, "会员套餐", data.snapshot.account?.memberName || "普通用户"),
    makeFactRow(doc, "到期说明", data.snapshot.account?.memberExpiry || "无有效会员到期时间"),
    makeFactRow(doc, "服务端连接", data.backendAvailable ? "在线" : "离线"),
   );
   bodyEl.append(lead, facts);
   actionsEl.append(
    makeModalActionButton(doc, "管理账户与安全", "primary", () => goRoute("/account")),
    makeModalActionButton(doc, "查看会员方案", "button-secondary", () => goRoute("/recharge")),
    makeModalActionButton(doc, "查看更新日志", "button-ghost", () => goRoute("/changelog")),
   );
  }

  context.openModal("workspaceDetailModal");
 }
 const widgets=createHomeWidgets({root:$("publicHome"),accountId:()=>context.state().account?.id,navigate:context.openHomeModule,onOpenPreview:(id,triggerEl)=>openWorkspaceDetailModal(id,triggerEl)});
 const recentRoot=$("homeRecentActivity");
 const summaryGrid=$("homeV3SummaryGrid");
 const shortcutsRoot=$("homeQuickShortcuts");
 const storage = getSafeStorage();
 recentRoot?.addEventListener('click',event=>{const button=event.target.closest('[data-home-activity]');if(button)context.openHomeModule(button.dataset.homeActivity);});
 summaryGrid?.addEventListener('click',event=>{const card=event.target.closest('[data-v3-summary]');if(card)context.openHomeModule(card.dataset.v3Summary);});
 const readRawAccountWidgetRecord = (accountId) => {
  if (!accountId || !storage) return null;
  try {
    const raw = storage.getItem(homeWidgetStorageKey(accountId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
 };
 const readAccountShortcuts = () => {
  const accountId = context.state().account?.id;
  const parsed = readRawAccountWidgetRecord(accountId);
  return sanitizeHomeShortcuts(parsed?.quickShortcuts);
 };
 const saveAccountShortcuts = (list) => {
  const accountId = context.state().account?.id;
  if (!accountId || !storage) return;
  const next = mergeHomeShortcutsRecord(readRawAccountWidgetRecord(accountId), list);
  safeStorageSet(storage, homeWidgetStorageKey(accountId), JSON.stringify(next));
 };
 const renderQuickShortcuts = (account) => {
  if (!shortcutsRoot || !account) return;
  const ids = readAccountShortcuts();
  const byId = new Map(HOME_SHORTCUT_CATALOG.map((item) => [item.id, item]));
  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  reconcileKeyedRows(shortcutsRoot, items, {
   key: (item) => item.id,
   signature: (item) => {
    const locked = Boolean(item.entitlement && !isSuperAdmin(account) && !hasAccountEntitlement(item.entitlement, account));
    return `${item.id}:${locked ? "locked" : "open"}`;
   },
   render: (item) => {
    const locked = Boolean(item.entitlement && !isSuperAdmin(account) && !hasAccountEntitlement(item.entitlement, account));
    const iconSvg = SHORTCUT_ICONS[item.icon] || SHORTCUT_ICONS.tool;
    const lockHtml = locked ? '<span class="gpt-shortcut-lock" aria-label="需要会员权益" title="需要会员权益"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>' : '';
    return `<button type="button" class="gpt-shortcut-chip${locked ? " is-locked" : ""}" data-home-shortcut-id="${escapeHtml(item.id)}"><span class="gpt-shortcut-icon">${iconSvg}</span><span class="gpt-shortcut-label">${escapeHtml(item.label)}</span>${lockHtml}</button>`;
   },
   empty: "",
  });
 };
 if (shortcutsRoot && !bound.has(shortcutsRoot)) {
  bound.add(shortcutsRoot);
  shortcutsRoot.addEventListener("click", (event) => {
   const btn = event.target.closest("[data-home-shortcut-id]");
   if (!btn) return;
   const item = HOME_SHORTCUT_CATALOG.find((x) => x.id === btn.dataset.homeShortcutId);
   if (!item) return;
   if (item.kind === "tool") context.openTool(item.target);
   else context.openHomeModule(item.target);
  });
 }
 const shortcutsEditorBtn = $("customizeShortcutsBtn");
 const shortcutsOptionsRoot = $("homeShortcutsOptions");
 const populateShortcutsModal = () => {
  if (!shortcutsOptionsRoot) return;
  const selected = new Set(readAccountShortcuts());
  const doc = shortcutsOptionsRoot.ownerDocument;
  shortcutsOptionsRoot.replaceChildren();
  HOME_SHORTCUT_CATALOG.forEach((item) => {
   const label = doc.createElement("label");
   label.className = "shortcut-option-row";
   const checkbox = doc.createElement("input");
   checkbox.type = "checkbox";
   checkbox.value = item.id;
   checkbox.checked = selected.has(item.id);
   checkbox.addEventListener("change", () => {
    const checkedCount = shortcutsOptionsRoot.querySelectorAll("input:checked").length;
    if (checkedCount > 6) checkbox.checked = false;
   });
   const span = doc.createElement("span");
   span.textContent = item.label;
   label.append(checkbox, span);
   shortcutsOptionsRoot.append(label);
  });
 };
 shortcutsEditorBtn?.addEventListener("click", () => {
  populateShortcutsModal();
  context.openModal?.("homeShortcutsModal");
 });
 $("saveHomeShortcutsBtn")?.addEventListener("click", () => {
  if (!shortcutsOptionsRoot) return;
  const picked = [...shortcutsOptionsRoot.querySelectorAll("input:checked")].map((i) => i.value);
  saveAccountShortcuts(picked);
  if (context.state().account) renderQuickShortcuts(context.state().account);
  context.closeModal?.("homeShortcutsModal", true);
 });
 $("resetHomeShortcutsBtn")?.addEventListener("click", () => {
  saveAccountShortcuts(defaultHomeShortcuts());
  populateShortcutsModal();
  if (context.state().account) renderQuickShortcuts(context.state().account);
 });
 function setSummaryBar(id, percent) {
  const bar=$(id); if(bar) bar.style.setProperty("--v3-bar-scale", (Math.max(8, Math.min(100, Math.round(percent))) / 100).toFixed(2));
 }
 function renderGuestV3Summary() {
  setText($("v3SummaryLearningText"), "英语与日语词表练习 · 免费试做最多 10 题");
  setSummaryBar("v3SummaryLearningBar", 58);
  setText($("v3SummaryFinanceText"), "收入与支出按照账户真实数据云端同步");
  setSummaryBar("v3SummaryFinanceBar", 34);
  setText($("v3SummaryTransferText"), "仅展示当前账户的文件与受控分享");
  setSummaryBar("v3SummaryTransferBar", 72);
  setText($("v3SummaryToolsText"), "文本、JSON、图片本机即开即用");
  setSummaryBar("v3SummaryToolsBar", 48);
 }
 function present(snapshot) {
  widgets.render(snapshot);
  if (recentRoot) {
   reconcileKeyedRows(recentRoot,snapshot.activity,{key:x=>x.id,signature:x=>JSON.stringify(x),render:x=>`<li><button type="button" data-home-activity="${escapeHtml(x.path)}">${escapeHtml(x.label)}<small>${escapeHtml(context.formatLocalDateTime(x.at))}</small></button></li>`,empty:'<li>'+(snapshot.demo?'登录后显示自己的学习与工具记录。':'暂无最近活动。完成学习或使用工具后会显示在这里。')+'</li>'});
  }
 }
 function prepare() {
  widgets.setAccount();
  if (!context.state().account) {
    setText($("dashboardGreeting"), "");
    const promptEl = $("dashboardGreetingPrompt");
    if (promptEl) {
      promptEl.textContent = "";
      promptEl.hidden = true;
    }
    renderGuestV3Summary();
    present(projectHomeWidgets({ demo: true }));
  }
}
 const { accountMembershipSummary, accountEntitlements, entitlementLabel, calculateStudyStreak, dashboardGoal, formatLocalDateTime, quizLanguageLabel, practiceModeLabel, formatFinanceMoney, loadProjectRuntime, renderLatestUpdate, renderLearningSyncDashboardStatus, isSuperAdmin, hasAccountEntitlement }=context;
 function setDashboardService(id,label,status) { const node=$(id);if(!node)return;setText(node,label);const wanted="dashboard-service "+status;if(node.dataset.serviceTone===status)return;node.classList.remove("is-online","is-offline","is-warning");node.classList.add(status);node.dataset.serviceTone=status; }
 function renderDashboardToolShelf(id,items,emptyMessage) {
  const target=$(id);if(!target)return;
  reconcileKeyedRows(target,items.slice(0,5),{key:x=>x.tool_id,signature:x=>x.name||x.tool_id,render:x=>'<button type="button" class="dashboard-tool-link" data-dashboard-tool="'+escapeHtml(x.tool_id)+'">'+escapeHtml(x.name||x.tool_id)+'</button>',empty:'<p class="dashboard-empty">'+escapeHtml(emptyMessage)+'</p>'});
  if(!bound.has(target)){bound.add(target);target.addEventListener("click",e=>{const button=e.target.closest("[data-dashboard-tool]");if(button&&target.contains(button))context.openTool(button.dataset.dashboardTool);});}
 }
 function render() {
  prepare();
  const state=context.state(),financeController=context.finance(),financeCandidatesController=context.pending(),transferController=context.transfer(),backendAvailable=context.online(),aiAvailable=context.ai();
  if (!state.session || !state.account || $("publicHome")?.classList.contains("hidden") || document.hidden || document.documentElement.dataset.androidWebActive === "false") return;
  const account = state.account;
  const summary = accountMembershipSummary(account);
  const entitlements = [...accountEntitlements(account)].map(entitlementLabel);
  const records = [...state.studyRecords].sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt));
  const latest = records[0];
  const englishGoal = dashboardGoal("english");
  const japaneseGoal = dashboardGoal("japanese");

  renderQuickShortcuts(account);
  const greetingModel = formatLocalTimeGreeting(account);
  setText($("dashboardGreeting"), greetingModel.greeting || account.username);
  const promptEl = $("dashboardGreetingPrompt");
  if (promptEl) {
    promptEl.textContent = greetingModel.prompt;
    promptEl.hidden = !greetingModel.prompt;
  }
  setText($("dashboardMembershipName"), summary.name || "普通用户");
  setText($("dashboardMembershipExpiry"), summary.permanent
    ? "永久有效"
    : summary.expires_at
      ? `到期 ${formatLocalDateTime(summary.expires_at)}`
      : "");
  setText($("dashboardEntitlements"), entitlements.length ? entitlements.join("、") : "基础功能");
  setText($("dashboardStreak"), String(calculateStudyStreak(records)));
  setText($("dashboardWrongCount"), String(Object.keys(state.historyWrongBook).length));
  setText($("dashboardEnglishGoal"), `${englishGoal.completed} / ${englishGoal.goal} 题`);
  setText($("dashboardJapaneseGoal"), `${japaneseGoal.completed} / ${japaneseGoal.goal} 题`);
  setText($("dashboardLatestResult"), latest
    ? `最近一次：${quizLanguageLabel(latest.language)} ${practiceModeLabel(latest.practiceMode)}，${latest.total} 题，正确率 ${latest.accuracy}%`
    : "完成第一轮测试后显示结果。");

  const finance = financeController?.dashboardSummary?.() || { balance_minor: 0, pending: 0, available: false };
  const financeKnown = finance.available && Number.isFinite(finance.balance_minor) && Boolean(finance.last_sync_at || finance.pending);
  const financeBalance = financeKnown ? formatFinanceMoney(finance.balance_minor, finance.display_currency || 'CNY') + (finance.unconverted?.length ? ' · 部分未换算' : '') : "尚未读取";
  if ($("dashboardFinanceBalance")) setText($("dashboardFinanceBalance"), financeBalance);
  document.querySelectorAll("[data-dashboard-balance-copy]").forEach((element) => { setText(element, financeBalance); });
  if ($("dashboardFinanceSync")) {
    const financeStatus = financeKnown
      ? finance.pending
        ? `${finance.pending} 项本机修改等待同步`
        : finance.last_sync_at
          ? `最近同步 ${formatLocalDateTime(finance.last_sync_at)}`
          : "打开财务账本后开始同步"
      : "打开账本读取账户数据。";
    setText($("dashboardFinanceSync"), financeStatus);
    document.querySelectorAll("[data-dashboard-finance-copy]").forEach((element) => { setText(element, financeStatus); });
  }

  const resumable = ["english", "japanese"].filter((language) => Boolean(loadProjectRuntime(language)?.roundActive));
  $("dashboardResumeSection").classList.toggle("hidden", !resumable.length);
  [["dashboardResumeEnglish", "english"], ["dashboardResumeJapanese", "japanese"]].forEach(([id, language]) => {
    $(id).classList.toggle("hidden", !resumable.includes(language));
  });

  const toolSummary = window.WYJTools?.getSummary?.() || { favorites: [], recent: [] };
  const pending = financeCandidatesController?.dashboardSummary?.();
  const transfer = transferController?.dashboardSummary?.() || { count: 0, paused: 0, running: false };
  const canShare = isSuperAdmin(account) || hasAccountEntitlement("temporary_share_access", account);
  const memberExpiryCopy = summary.permanent
    ? "永久有效"
    : summary.expires_at
      ? `到期 ${formatLocalDateTime(summary.expires_at)}`
      : "无有效会员到期时间";
  const snapshotPayload = projectHomeWidgets({
    records,
    wrongCount: Object.keys(state.historyWrongBook).length,
    streak: calculateStudyStreak(records),
    goals: [{ language: 'english', ...englishGoal }, { language: 'japanese', ...japaneseGoal }],
    finance,
    financeKnown,
    tools: toolSummary,
    toolsReady: window.WYJTools?.isReady?.() || false,
    workflow: window.WYJWorkflows?.getSummary?.() || {},
    transfer: {
      count: transfer.count,
      known: Boolean(transferController),
      allowed: canShare,
      detail: !canShare
        ? "未开通文件分享权限 · 基础本地传输仍受账户边界保护"
        : !transfer.count
          ? "暂无本机传输任务。"
          : transfer.running
            ? "传输正在进行，打开查看进度。"
            : transfer.paused
              ? `${transfer.paused} 个任务已暂停。`
              : "打开传输页继续管理队列。",
    },
    membership: {
      name: summary.name || "普通用户",
      expiry: memberExpiryCopy,
      entitlements: entitlements.length ? entitlements.join("、") : "基础功能",
    },
    account: { username: account.username },
    notifications: { pendingCount: pending?.known ? pending.count : null },
    online: backendAvailable,
    learningStatus: context.learningStatus(),
    money: formatFinanceMoney,
    language: quizLanguageLabel,
    time: formatLocalDateTime,
  });
  lastDetailModel = { snapshot: snapshotPayload, summary, entitlements, account, resumable, pending, transfer, financeKnown, toolSummary, backendAvailable };
  present(snapshotPayload);
  renderDashboardToolShelf("dashboardFavoriteTools", toolSummary.favorites || [], "还没有收藏工具。");
  renderDashboardToolShelf("dashboardRecentTools", toolSummary.recent || [], "还没有使用记录。");
  if ($("dashboardNotificationPending")) setText($("dashboardNotificationPending"), pending?.known ? `${pending.count} 项` : "未读取");
  if ($("dashboardNotificationStatus")) setText($("dashboardNotificationStatus"), pending?.known ? (pending.count ? "有识别交易等待核实。" : "已读取，没有待核实交易。") : "在账本中核实通知识别的交易。");
  if ($("dashboardTransferCount")) setText($("dashboardTransferCount"), `${transfer.count} 个任务`);
  if ($("dashboardTransferStatus")) setText($("dashboardTransferStatus"), !transfer.count ? "暂无本机传输任务。" : transfer.running ? "传输正在进行，打开查看进度。" : transfer.paused ? `${transfer.paused} 个任务已暂停。` : "打开传输页继续管理队列。");

  const wrongTotal = Object.keys(state.historyWrongBook).length;
  const totalGoalTarget = Math.max(1, englishGoal.goal + japaneseGoal.goal);
  const totalGoalDone = englishGoal.completed + japaneseGoal.completed;
  if (wrongTotal > 0) {
    setText($("v3SummaryLearningText"), `错题待复习 ${wrongTotal} 题 · 今日已完成 ${totalGoalDone} 题`);
    setSummaryBar("v3SummaryLearningBar", Math.max(24, (totalGoalDone / totalGoalTarget) * 100));
  } else if (records.length > 0) {
    setText($("v3SummaryLearningText"), `已完成 ${records.length} 轮练习 · 当前无待复习错题`);
    setSummaryBar("v3SummaryLearningBar", Math.max(30, (totalGoalDone / totalGoalTarget) * 100));
  } else {
    setText($("v3SummaryLearningText"), "暂无错题与学习记录 · 点击开始练习");
    setSummaryBar("v3SummaryLearningBar", 10);
  }
  if (financeKnown) {
    setText($("v3SummaryFinanceText"), `本月结余 ${financeBalance} · ${finance.pending ? `${finance.pending} 项待同步` : "真实数据已同步"}`);
    setSummaryBar("v3SummaryFinanceBar", 68);
  } else {
    setText($("v3SummaryFinanceText"), "尚未读取本月收支 · 打开账本同步数据");
    setSummaryBar("v3SummaryFinanceBar", 12);
  }
  if (transfer.count > 0) {
    setText($("v3SummaryTransferText"), `当前账户 ${transfer.count} 个文件传输任务${transfer.running ? " · 传输中" : ""}`);
    setSummaryBar("v3SummaryTransferBar", 66);
  } else {
    setText($("v3SummaryTransferText"), "仅展示当前账户的文件 · 暂无传输任务");
    setSummaryBar("v3SummaryTransferBar", 12);
  }
  const recentToolsCount = (toolSummary.recent || []).length;
  const favToolsCount = (toolSummary.favorites || []).length;
  if (recentToolsCount > 0 || favToolsCount > 0) {
    setText($("v3SummaryToolsText"), `最近使用 ${recentToolsCount} 项 · 收藏 ${favToolsCount} 项 · 本地处理`);
    setSummaryBar("v3SummaryToolsBar", Math.min(100, 24 + recentToolsCount * 15));
  } else {
    setText($("v3SummaryToolsText"), "文本、JSON、图片处理 · 暂无最近记录");
    setSummaryBar("v3SummaryToolsBar", 14);
  }
  renderLatestUpdate();

  setDashboardService("dashboardAccountStatus", backendAvailable ? "在线" : "离线", backendAvailable ? "is-online" : "is-offline");
  renderLearningSyncDashboardStatus();
  setDashboardService(
    "dashboardAiStatus",
    !backendAvailable ? "网络不可用" : aiAvailable ? "可用" : "规则模式",
    backendAvailable && aiAvailable ? "is-online" : "is-warning",
  );
  setDashboardService(
    "dashboardShareStatus",
    canShare ? (backendAvailable ? "可用" : "离线") : "未开通",
    canShare && backendAvailable ? "is-online" : canShare ? "is-offline" : "is-warning",
  );
}

 return Object.freeze({render,prepare,hide:()=>{widgets.hide();context.closeModal?.("workspaceDetailModal",true);},setService: setDashboardService});
}
