# Task 24 Final Acceptance Reopen — Release Candidate Record

**状态：`TASK 24 SOFTWARE RELEASE CANDIDATE — VALIDATION IN PROGRESS`**（不是 `SOFTWARE CLOSED`，也不是 `RELEASED`）。

分支：`codex/task24-reopen-notification-wechat`　PR：`#67`（open，未 merge；base `main`）
Task 25：**BLOCKED BY TASK 24 FINAL ACCEPTANCE**（仓库中不存在任何 Task 25 代码）

证据口径：

- **CI / PR Preview 通过 ≠ Production Closure**。当前所有 CI 证据来自 PR Preview（wrangler pages dev + 本地 D1/R2 + headless Chrome）。
- 每条结论都标注证据来源：`unit` / `integration` / `browser-E2E` / `device-only`。
- 真机：`Samsung SM-S9360 / Android 16`（当前不可用）。真机项在 B 段单列，未执行即未验证。

## A. Software closure matrix

| # | 根因 | 关键改动 | 回归 / E2E | 结果 |
| --- | --- | --- | --- | --- |
| #1 P0 Notification「填写金额并记账」 | amount-unknown capture 只有 ticket，没有 candidate，`saveCorrection` 因空 `candidateId` 直接失败 | `PaymentRecognitionCoordinator.ensureCandidateForRecognition()`；`PaymentVerificationCenter.saveCorrection` recognitionId 回退；UI/state 传递 recognitionId | `PaymentRecognitionCoordinatorTest.manualAmountCreatesTheMissingCandidateAndBooksIt`、新增 `manualAmountChainBooksExactlyOneTransactionAndStaysIdempotent`（candidate → confirm → txn → terminal → 重复确认不再产生第二条）、`manualAmountWithoutDirectionNeverProducesABookableDraft` | 软件侧完成；真机复验待 B-1 |
| #2 P0 Finance 页确认无反应 | 点击到反馈=网络往返；确认后要两次网络 reload 才更新 UI；无陈旧响应保护 | `js/core/perf.js`（同步 pending 反馈 + 打点 + single-flight + latest-only）；`js/finance/candidates.js` 乐观终态 + 后台对账 | `local-backend/test_interaction_feedback_js.mjs`、`local-backend/test_finance_candidates_js.mjs`、服务端 `test_task21_hints_js.mjs` / `test_task21_notification_js.mjs`（重复 confirm → `no_change` 且账本仅一行） | 软件侧完成；真机交互待 B-2 |
| #3 微信 MessagingStyle 识别不到金额 | 正文在 `EXTRA_TEXT_LINES`，旧解析器只看 title/text/bigText/subText | `AndroidPaymentRecognitionHook.outcomeFor()` 合并 textLines；解析器承认「支付+带单位金额」 | `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`、新增 `messagingStyleChatLinesNeverInventAnAmount`（6 类误报防线）、`NotificationParserTest`（含 `支付100元` 的六种写法）、`PaymentParserTest.explicitPaymentAmountIsIndependentOfTitleAndMerchant` | 软件侧完成；真实微信端到端待 B-3 |
| #4 Notification↔Finance 同步延迟 | 无分阶段时间戳；确认后要等周期 pull | Android `CaptureTrace` 阶段；Web `beginInteraction()` 全链打点 + `window.__wyjInteractionTrace`；确认后乐观终态 + 立即 single-flight 对账；canonical id 统一；**Android 侧补有界追平**：`PendingReconciliationPolicy`（1.5s/3s/6s/12s，共 22.5s 后停止，仅在页面存在 `PENDING_SYNC/SYNC_FAILED` 时运行；App 前台/重开已有即时 `PaymentHintSync.sync()`，无固定 delay、无重复 sync） | `NotificationCaptureCoordinatorTest.incompletePaymentRecordsTheHintEventIdForTheServerPull`、`PendingReconciliationPolicyTest`（fake-clock：无 pending 不拉、有 pending 才拉、窗口有界、清空即停、延迟严格递增）、`local-backend/test_interaction_feedback_js.mjs` | RC：软件侧调度已闭环（真机实时耗时待 B-4）；证据=unit+integration | `6bee1eb` + RC 提交 |
| #5 ongoing/计时通知重复归档 | 指纹按内容计算，逐秒变化 → 每条追加 revision | 稳定身份（key，或 package+id+tag）+ `NotificationLiveCoalescer.readoutDecision()`；命中后 Room **就地改写**；带金额事件永不合并；`markRemoved` 关闭槽位生命周期 | `NotificationClassificationTest.recordingTimerUpdatesOneRowInsteadOfAppending` / `identicalMessagesFarApartAreNeverMerged` / `repeatedPaymentReceiptsAreNeverMerged`、`store/NotificationReadoutCoalescingTest`（5 项）、`NotificationCaptureCoordinatorTest.updatingNotificationReachesTheArchiveAsACoalescedUpdate` | 软件侧完成；真机计数待 B-5 |
| #6 通知媒体未归档 | 只读 Bitmap；URI 形式与 MessagingStyle 图片完全没处理 | `NotificationMediaExtractor`（Bitmap/URI/背景图/MessagingStyle 图片）；`mediaSourceUri` 进 sink 后台导入；不可读时如实 `unavailable` 且通知仍入库 | `NotificationMediaExtractorTest`（10 项 fixtures）、`NotificationScreenshotArchiveTest.referencedNotificationImageIsImportedIntoPrivateStorage` / `unreadableReferencedNotificationImageStaysUnavailable` | 软件侧完成；真机 mediaState 待 B-6 |
| #7 全站点击无反馈 | 无交互打点；异步按钮无同步 pending；重复 refresh；陈旧响应可覆盖 | 全局 click 打点 + 每次路由渲染写 `state-apply/render-end`；`withInteractionFeedback()` 统一接入 finance 候选确认/拒绝/刷新、learning sync 立即同步/导入/导出、充值提交、管理员封禁/登出/删除/密钥/充值审批、工作流打开与导入、模块磁贴、站点导航、会话恢复、transfer 创建分享/下载/撤销；`createSingleFlight()`、`createLatestOnly()`、`patchOverlayClickThrough()` | 静态审计 `scripts/audit_async_interactions.mjs`（239 handler，49 个网络等待 **全部** 有反馈，0 漏；报告 `artifacts/async-interaction-audit.md`）+ unit `test_interaction_feedback_js.mjs` + **browser-E2E** `test_interaction_feedback_browser.mjs`（真实 Chrome + 400ms 延迟，finance / learning sync / transfer / tools / membership 五个模块点击后同任务 pending，>150ms 即失败，并校验 `__wyjInteractionTrace` 链路） | RC：主要异步路径已接入并有浏览器级证据；真机帧率手感待 B-7 | `6bee1eb` + RC 提交 |
| #8 文件传输完整性（P0） | 以「分片齐全 + etag」误当完整性结论 | 服务端路径：`local-backend/test_transfer_integrity_js.mjs`（Miniflare，六形状 source == R2 == 下载）；**浏览器路径**：`local-backend/test_transfer_browser_e2e.mjs`（真实 File → `input[type=file]` → `js/transfer/app.js` → `runPartPipeline` → Worker/R2 → 创建分享 → 分享链接新标签下载；EXE/MP4 均 > 16MiB，断言前端分片 ≥2 且全部 ack、文件名/扩展名保留、source SHA-256 == download SHA-256、byte length 相等） | integration + **browser-E2E**（CI Cloud-only Preview job） | RC：软件侧两种路径均已有自动化；仅剩真实 800MB 网络吞吐/延迟（B-8） | `8f1f6ca` + RC 提交 |
| #9 上传性能 | `hash → PUT → 等待 → next` 串行；hash 占住网络槽 | `runPartPipeline()` 哈希 look-ahead + 并发 3；`uploadPerformanceSummary()`；pause 不再把未完成项标记 done | `local-backend/test_transfer_benchmark_js.mjs` — **simulated-latency scheduler benchmark**（固定 30ms hash / 90ms 每分片延迟，测的是调度器本身：串行模型 1921ms → 管线 632ms = 3.04x；最大在途=3；每分片恰好一次；每 PUT 的 SHA-256 与真实字节一致；pause/cancel/failure 语义）+ `test_transfer_isolation_js.mjs` | RC：**不是真实生产吞吐提升 3.04x**；真实 800MB 网络吞吐仍待 B-9（device/real-network） | `6bee1eb` |
| #10 Accessibility 读不到页面 | **本次已定位并修复的 root cause：ticket/cache race**（票据创建晚于 3 秒缓存刷新 → 第一条关键事件被 `no_active_ticket` 丢弃）；另加固 OCR 构造异常不再打断回调 | `PaymentTicketPackageSignal`（创建/重启票据即发布，120s 窗口）；门禁 `cache || signal`，Room 仍为权威；重连清空信号并强制刷新；OCR 不可用降级手动路径 | unit：`PaymentAccessibilityServiceGateTest.firstEventOfABrandNewTicketIsNotDroppedByAStaleCache` / `ticketSignalExpiresAndTheGateClosesAgain` / `reconnectClearsTheSignal`、`PaymentRecognitionCoordinatorTest.openingAVerificationTicketAnnouncesThePackage` / `restartedVerificationAnnouncesThePackageAgain`、既有 `PaymentScreenshotOcrTest` 回退链 | **只声明 ticket/cache race 已修（software-fixed）**。真机仍需确认：真实 window tree 是否有文本、`lines=0`、OCR fallback、微信实际页面结构能否完成 enrichment → 见 B-10；本次**未**证明 Accessibility 全部问题已解决 | `6bee1eb` |

### Transfer session 生命周期（本轮新增，属于 #8/#9 闭环）

| 项 | 内容 |
| --- | --- |
| 缺陷 | `js/transfer/app.js::ensureSession()` 复用已创建 session，而服务端 `task22-service.mjs` 按 session 初始 `file_count` 拒绝追加文件 → `transfer_file_count_exceeded`，队列无法发布 |
| 修复 | 新增纯函数 `sessionPlan(queue, session)`：精确批次 → 复用；页面重载后的 restored session → 复用（由服务端 `complete()` 校验数量）；其余情况（追加文件/大小变化/批次不符）→ 为**完整队列**新建 session，重置该批次的分配（协议不支持跨 session 复用分片，因此明确重传），并 **abort 旧 session**；`sessionOpening` 单飞避免快速追加创建多个 session；`uploadItem` 在上传中的分片收敛后才切换；`complete()` 在批次不符时先重开会话而不是混合两个 session |
| 回归 | `local-backend/test_transfer_session_plan_js.mjs`（规划器 8 组断言）、`local-backend/test_transfer_integrity_js.mjs`（服务端确实以 409 拒绝第二文件 → 新 session 发布两文件 → SHA-256 一致 → 旧 session abort 且 R2 对象消失、不可发布）、`local-backend/test_transfer_browser_e2e.mjs`（浏览器：先传 1 个 → 追加第 2 个 → 全队列同一新 session → 两文件下载 SHA-256/长度/文件名/扩展名一致 → 旧 session 不可发布） |
| 安全约束 | 未放宽服务端 `file_count`；未扩大上限；无幽灵文件（旧 session abort）、无重复发布（队列在成功后清空）、无孤立 session |

### Membership 交互反馈的确定性 CI 证据（本轮新增）

- Preview D1 没有可购买套餐目录，因此该用例改为 **CDP 请求桩**：受控目录（`/api/membership/plans`）+ 受控订单响应（`/api/recharge/request`，≥420ms 延迟）+ 受控二维码（`/api/recharge/qr`），**不写入也不伪造 Preview/Production 业务数据**。
- 断言：成功路径点击后**同任务内** pending（≤150ms）→ 结算恢复 → 显示「订单已生成」；失败路径（500）同样 pending ≤150ms → 结算恢复 → 显示服务端错误；两条路径都要求 `recharge-submit` 的 trace 出现 `state-apply`。
- 证据来源：**browser-E2E**（`local-backend/test_interaction_feedback_browser.mjs`，Cloud-only Preview job）；本地（Windows）8/8 通过（transfer 模块因本机 workerd 限制跳过）。

### 验证证据（按来源）

- **Android unit**：`testDebugUnitTest`（含本轮新增 `PendingReconciliationPolicyTest`）全绿；`lintDebug assembleDebug` 成功。
- **JS unit / static**：`test_transfer_isolation_js.mjs`、`test_finance_candidates_js.mjs`、`test_interaction_feedback_js.mjs`、
  `test_transfer_integrity_js.mjs`、`test_transfer_benchmark_js.mjs`、`test_module_graph_js.mjs`、`test_tools_js.mjs`、
  `scripts/audit_async_interactions.mjs`（0 漏）、`scripts/check_js_module_graph.mjs`、`scripts/check_storage_contract.mjs` 全绿。
- **Browser E2E（CI Preview）**：`test_interaction_feedback_browser.mjs`（多模块即时反馈）、`test_transfer_browser_e2e.mjs`（>16MiB EXE/MP4 round-trip）。
- **Integration**：Miniflare D1/R2 的 transfer/quota/share/range 与 six-shape integrity 测试。
- **Python**：`local-backend` 127 tests 中除 `test_api.py`（需要本机运行中的预览服务）外全绿；CI Python job 通过。
- **CI**：PR #67 各提交的 `Core CI` 全绿记录见 PR checks；**PR Preview ≠ Production**。

## B. Device-only acceptance matrix（未执行 = 未验证）

| ID | 项目 | 需要真机的原因 |
| --- | --- | --- |
| B-1 | Notification 页「填写金额并记账」端到端（含再次确认不重复记账） | WebView → 本地识别 → 服务端账本的实机链路 |
| B-2 | Finance 页确认的 100–150ms 反馈与 exactly-once（D1 终态） | 真机 WebView 手感 + 真实网络 |
| B-3 | 真实微信 Notification MessagingStyle「已支付¥100」 | 微信实际通知结构 |
| B-4 | capture→…→render 分阶段真实耗时 | 真机计时（`__wyjInteractionTrace()` + CaptureTrace） |
| B-5 | Samsung 录屏/截图/计时通知 coalesce 计数与撤回保留 | One UI 通知行为 |
| B-6 | 截图/录屏通知的 mediaState / mediaPath | MediaStore 与权限实况 |
| B-7 | 全站手感 / frame jank 复测 | 真机渲染 |
| B-8 | 真实 800MB EXE/MP4 上传后下载 SHA-256 | 真机 + 真实网络（**>16MiB EXE/MP4 的浏览器级 round-trip 已由 CI Cloud-only Preview 覆盖，仅 800MB 规模仍需真机**） |
| B-9 | 真实网络吞吐（800MB） | 真实带宽；scheduler benchmark 不能替代 |
| B-10 | 真实窗口是否有文本、`lines=0`、OCR fallback、微信页面结构能否完成 enrichment（ticket/cache race 已在软件侧修复，其余仍未知） | 真机窗口与 ML Kit |
| B-11 | Android 1.3.3 安装与最终端到端 | 设备安装与整体回归 |

## Task 25

未开始：仓库中不存在 Task 25 的实现或开关代码。
