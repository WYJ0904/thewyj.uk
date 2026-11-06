import { $, escapeHtml } from "./ui.js?release=20261106-aeris-p07-r5-independent-rc1";
import { reconcileKeyedRows } from "./keyed-list.js?release=20261106-aeris-p07-r5-independent-rc1";
import { createHomeWidgets } from "./home-widgets.js?release=20261106-aeris-p07-r5-independent-rc1";
import { projectHomeWidgets } from "./home-widget-data.js?release=20261106-aeris-p07-r5-independent-rc1";
const bound = new WeakSet();
const setText = (node,value) => { if(node && node.textContent!==String(value))node.textContent=String(value); };

/** Shared home presentation. State and service owners remain in their modules. */
export function createDashboardView(context) {
 const widgets=createHomeWidgets({root:$("publicHome"),accountId:()=>context.state().account?.id,navigate:context.openHomeModule});
 const recentRoot=$("homeRecentActivity");
 const summaryGrid=$("homeV3SummaryGrid");
 recentRoot.addEventListener('click',event=>{const button=event.target.closest('[data-home-activity]');if(button)context.openHomeModule(button.dataset.homeActivity);});
 summaryGrid?.addEventListener('click',event=>{const card=event.target.closest('[data-v3-summary]');if(card)context.openHomeModule(card.dataset.v3Summary);});
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
  reconcileKeyedRows(recentRoot,snapshot.activity,{key:x=>x.id,signature:x=>JSON.stringify(x),render:x=>`<li><button type="button" data-home-activity="${escapeHtml(x.path)}">${escapeHtml(x.label)}<small>${escapeHtml(context.formatLocalDateTime(x.at))}</small></button></li>`,empty:'<li>'+(snapshot.demo?'登录后显示自己的学习与工具记录。':'暂无最近活动。完成学习或使用工具后会显示在这里。')+'</li>'});
 }
 function prepare() {widgets.setAccount();if(!context.state().account){renderGuestV3Summary();present(projectHomeWidgets({demo:true}));}}
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

  setText($("dashboardGreeting"), account.username);
  setText($("dashboardMembershipName"), summary.name || "普通用户");
  setText($("dashboardMembershipExpiry"), summary.permanent
    ? "永久有效"
    : summary.expires_at
      ? `到期 ${formatLocalDateTime(summary.expires_at)}`
      : "无有效会员到期时间");
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
  const financeBalance = financeKnown ? formatFinanceMoney(finance.balance_minor) : "尚未读取";
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
  present(projectHomeWidgets({records,wrongCount:Object.keys(state.historyWrongBook).length,streak:calculateStudyStreak(records),goals:[{language:'english',...englishGoal},{language:'japanese',...japaneseGoal}],finance,financeKnown,tools:toolSummary,toolsReady:window.WYJTools?.isReady?.()||false,workflow:window.WYJWorkflows?.getSummary?.()||{},online:backendAvailable,learningStatus:context.learningStatus(),money:formatFinanceMoney,language:quizLanguageLabel,time:formatLocalDateTime}));
  renderDashboardToolShelf("dashboardFavoriteTools", toolSummary.favorites || [], "还没有收藏工具。");
  renderDashboardToolShelf("dashboardRecentTools", toolSummary.recent || [], "还没有使用记录。");
  const pending = financeCandidatesController?.dashboardSummary?.();
  if ($("dashboardNotificationPending")) setText($("dashboardNotificationPending"), pending?.known ? `${pending.count} 项` : "未读取");
  if ($("dashboardNotificationStatus")) setText($("dashboardNotificationStatus"), pending?.known ? (pending.count ? "有识别交易等待核实。" : "已读取，没有待核实交易。") : "在账本中核实通知识别的交易。");
  const transfer = transferController?.dashboardSummary?.() || { count: 0, paused: 0, running: false };
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
  const canShare = isSuperAdmin(account) || hasAccountEntitlement("temporary_share_access", account);
  setDashboardService(
    "dashboardShareStatus",
    canShare ? (backendAvailable ? "可用" : "离线") : "未开通",
    canShare && backendAvailable ? "is-online" : canShare ? "is-offline" : "is-warning",
  );
}

 return Object.freeze({render,prepare,hide:widgets.hide,setService: setDashboardService});
}
