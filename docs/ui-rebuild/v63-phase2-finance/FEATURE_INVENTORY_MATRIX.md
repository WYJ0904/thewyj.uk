# Phase 2 Finance Feature Inventory Matrix（财务功能零删除核对矩阵）

| 功能域 | DOM / 模块入口 | Phase 2 归属子视图 / 位置 | 完整保留验证 |
|---|---|---|---|
| **会员访问控制与付费引导** | `#financeLocked` / `#unlockFinanceBtn` | `/finance` 顶层锁屏区 | 已在 `verify_phase2_finance.mjs` 与 Preview `v63p1_free` 实测通过 |
| **顶栏核心高频操作** | `#financeAddTransactionBtn`, `#financeSyncBtn`, `#financeSyncStatus`, `#financePrivacyBtn`, `#financeBackHomeBtn` | `.finance-header`（全子标签常驻可达） | 新建、同步、隐私模糊脱敏、返回首页跨标签全部保留并由 `test_app_browser.mjs` 实测 |
| **本月收支核心统计与原币分组** | `#financeIncomeTotal`, `#financeExpenseTotal`, `#financeBalanceTotal`, `#financeRefundTotal`, `#financeCurrencyStatus`, `#financeCurrencyGroups` | `总览` `#financePanelOverview` | 整数分/历史汇率折算/JPY 无小数规则、`BigInt` 精确计算全部保留 |
| **收支走势图与月度详情** | `#financeTrendSection`, `#financeTrendChartWrap`, `#toggleFinanceTrendBtn`, `[data-finance-trend-range]`, `#financeChartTooltip` | `总览` `#financePanelOverview` | 升级为容器全宽自适应 + `3/6/12` 个月切换 + 悬停/触控/键盘 HUD + 联动月度表格 + 加载/错误/空态诚实表达 |
| **总览近期动态与预算快览** | `#financeOverviewPendingBanner`, `#financeOverviewRecentList`, `#financeOverviewBudgets` | `总览` `#financePanelOverview` | 保留待核对提醒横幅、最近 5 笔交易点击打开详情抽屉、预算进度快览及直达跳转 |
| **待确认通知交易与本机恢复** | `#financeCandidatesSection`, `#financePendingCount`, `#financeCandidatesRefreshBtn`, `#financeCandidateList`, `#financeRecoverySection`, `#financeRecoveryList` | `账本` `#financePanelLedger` | [js/finance/candidates.js](../../../js/finance/candidates.js) 100% 保留确认/核实/编辑/忽略/冲突与本机恢复；0 条明确观测时自动折叠避免空框占屏，有待确认时自动展开 |
| **已记录账本、历史范围、搜索与筛选** | `#financeRecordedSection`, `#financeAllMonthsBtn`, `#financeSelectedMonthBtn`, `#financeHistoryMonthSelect`, `#financeSearchInput`, `#financeMonthFilter`, `#financeDirectionFilter`, `#financeCategoryFilter`, `#financeStatusFilter`, `#financeLedgerMoreBtn`, `#financeUndoBar` | `账本` `#financePanelLedger` | 默认展开；保留分批分页（`CLIENT_PAGE_SIZE`）、DOM Row Parking、删除局部撤销条（切页清空）、`Android 自动识别` 文案及恢复 |
| **交易抽屉 / 弹窗编辑与删除** | `#financeTransactionModal`, `#financeTransactionDrawerMeta`, `#financeTransactionDrawerDeleteBtn` | 全局弹窗（由总览/账本直接触发） | 保留 AI/自动识别只读元信息、冲突基线、原币输入校验、删除确认与离线队列入队 |
| **分类统计、预算进度、管理弹窗及跨月对照** | `#financeInsightDisclosure`, `#financeCategoryStats`, `#financeBudgetSummary`, `#financeManageBudgetsBtn`, `#financeManageCategoriesBtn`, `#financeAnalyticsMonths` | `分析` `#financePanelAnalytics` | 保留分类色彩圆点（CSP 兼容 CSSOM 渲染）、预算超支/剩余进度及新增跨有效月份实时对比表 |
| **币种偏好、同步与数据备份恢复** | `#financeDisplayCurrency`, `#financeAccountCurrency`, `#financeDefaultCurrency`, `#financeOpenBackupBtn` | `设置` `#financePanelSettings` | 保留 3 项云端偏好与配置入口；新增「账户内快捷入口」直达账本/分类/预算及 `/account` 数据备份恢复 |
