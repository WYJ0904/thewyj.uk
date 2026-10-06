import { $, escapeHtml } from "./ui.js?v=20261006-mobile-floating-1";
import { reconcileKeyedRows } from "./keyed-list.js?v=20261006-mobile-floating-1";
import { createHomeWidgets } from "./home-widgets.js?v=20261006-mobile-floating-1";
import { projectHomeWidgets } from "./home-widget-data.js?v=20261006-mobile-floating-1";
const bound = new WeakSet();
const setText = (node,value) => { if(node && node.textContent!==String(value))node.textContent=String(value); };

/** Shared home presentation. State and service owners remain in their modules. */
export function createDashboardView(context) {
 const widgets=createHomeWidgets({root:$("publicHome"),accountId:()=>context.state().account?.id,navigate:context.openHomeModule});
 const recentRoot=$("homeRecentActivity");
 recentRoot.addEventListener('click',event=>{const button=event.target.closest('[data-home-activity]');if(button)context.openHomeModule(button.dataset.homeActivity);});
 function present(snapshot) {
  widgets.render(snapshot);
  reconcileKeyedRows(recentRoot,snapshot.activity,{key:x=>x.id,signature:x=>JSON.stringify(x),render:x=>`<li><button type="button" data-home-activity="${escapeHtml(x.path)}">${escapeHtml(x.label)}<small>${escapeHtml(context.formatLocalDateTime(x.at))}</small></button></li>`,empty:'<li>'+(snapshot.demo?'登录后显示自己的学习与工具记录。':'暂无最近活动。完成学习或使用工具后会显示在这里。')+'</li>'});
 }
 function prepare() {widgets.setAccount();if(!context.state().account)present(projectHomeWidgets({demo:true}));}
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
