# Task 24 Final Acceptance Reopen — Closure Record

分支：`codex/task24-reopen-notification-wechat`　PR：`#67`（base `main`）
Task 25：**BLOCKED BY TASK 24 FINAL ACCEPTANCE**（本次未写任何 Task 25 代码）

真机：`Samsung SM-S9360 / Android 16`（当前不可用）。所有真机项在下面 B 段单独列出，未执行即为未验证。

## A. Software closure matrix

| # | 根因 | 关键改动 | 回归 / E2E | 结果 |
| --- | --- | --- | --- | --- |
| #1 P0 Notification「填写金额并记账」 | amount-unknown capture 只有 ticket，没有 candidate，`saveCorrection` 因空 `candidateId` 直接失败 | `PaymentRecognitionCoordinator.ensureCandidateForRecognition()`；`PaymentVerificationCenter.saveCorrection` recognitionId 回退；UI/state 传递 recognitionId | `PaymentRecognitionCoordinatorTest.manualAmountCreatesTheMissingCandidateAndBooksIt`、新增 `manualAmountChainBooksExactlyOneTransactionAndStaysIdempotent`（candidate → confirm → txn → terminal → 重复确认不再产生第二条）、`manualAmountWithoutDirectionNeverProducesABookableDraft` | 软件侧完成；真机复验待 B-1 |
| #2 P0 Finance 页确认无反应 | 点击到反馈=网络往返；确认后要两次网络 reload 才更新 UI；无陈旧响应保护 | `js/core/perf.js`（同步 pending 反馈 + 打点 + single-flight + latest-only）；`js/finance/candidates.js` 乐观终态 + 后台对账 | `local-backend/test_interaction_feedback_js.mjs`、`local-backend/test_finance_candidates_js.mjs`、服务端 `test_task21_hints_js.mjs` / `test_task21_notification_js.mjs`（重复 confirm → `no_change` 且账本仅一行） | 软件侧完成；真机交互待 B-2 |
| #3 微信 MessagingStyle 识别不到金额 | 正文在 `EXTRA_TEXT_LINES`，旧解析器只看 title/text/bigText/subText | `AndroidPaymentRecognitionHook.outcomeFor()` 合并 textLines；解析器承认「支付+带单位金额」 | `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`、新增 `messagingStyleChatLinesNeverInventAnAmount`（6 类误报防线）、`NotificationParserTest`（含 `支付100元` 的六种写法）、`PaymentParserTest.explicitPaymentAmountIsIndependentOfTitleAndMerchant` | 软件侧完成；真实微信端到端待 B-3 |
| #4 Notification↔Finance 同步延迟 | 无分阶段时间戳；确认后要等周期 pull | Android `CaptureTrace` 阶段；Web `beginInteraction()` 全链打点 + `window.__wyjInteractionTrace()`；确认后乐观终态 + 立即 single-flight 对账；canonical id 统一（`uploadEventId`/`source_event_id`） | `NotificationCaptureCoordinatorTest.incompletePaymentRecordsTheHintEventIdForTheServerPull`、`local-backend/test_interaction_feedback_js.mjs` | 软件侧完成；真机计时待 B-4 |
| #5 ongoing/计时通知重复归档 | 指纹按内容计算，逐秒变化 → 每条追加 revision | 稳定身份（key，或 package+id+tag）+ `NotificationLiveCoalescer.readoutDecision()`；命中后 Room **就地改写**；带金额事件永不合并；`markRemoved` 关闭槽位生命周期 | `NotificationClassificationTest.recordingTimerUpdatesOneRowInsteadOfAppending` / `identicalMessagesFarApartAreNeverMerged` / `repeatedPaymentReceiptsAreNeverMerged`、`store/NotificationReadoutCoalescingTest`（5 项）、`NotificationCaptureCoordinatorTest.updatingNotificationReachesTheArchiveAsACoalescedUpdate` | 软件侧完成；真机计数待 B-5 |
| #6 通知媒体未归档 | 只读 Bitmap；URI 形式与 MessagingStyle 图片完全没处理 | `NotificationMediaExtractor`（Bitmap/URI/背景图/MessagingStyle 图片）；`mediaSourceUri` 进 sink 后台导入；不可读时如实 `unavailable` 且通知仍入库 | `NotificationMediaExtractorTest`（10 项 fixtures）、`NotificationScreenshotArchiveTest.referencedNotificationImageIsImportedIntoPrivateStorage` / `unreadableReferencedNotificationImageStaysUnavailable` | 软件侧完成；真机 mediaState 待 B-6 |
| #7 全站点击无反馈 | 无交互打点；异步按钮无同步 pending；重复 refresh；陈旧响应可覆盖 | 全局 click 打点 + 每次路由渲染写 `state-apply/render-end`；`attachInteractionFeedback()` 同任务置 pending/disabled/aria-busy；`createSingleFlight()`、`createLatestOnly()`、`patchOverlayClickThrough()` | `local-backend/test_interaction_feedback_js.mjs`（同步反馈、还原、单调打点、single-flight、陈旧保护、ring 上限、overlay 穿透） | 软件侧完成；真机手感待 B-7 |
| #8 文件传输完整性（P0） | 以「分片齐全 + etag」误当完整性结论 | 新增 `local-backend/test_transfer_integrity_js.mjs`（CI 已接入） | six 形状 × (source == R2 == 下载) SHA-256 + byte length；filename/扩展名、Content-Type、Content-Disposition、Content-Length、Accept-Ranges、跨 16MiB 边界 Range、分片重传幂等 | 软件侧完成；真实 800MB 待 B-8 |
| #9 上传性能 | `hash → PUT → 等待 → next` 串行；hash 占住网络槽 | `runPartPipeline()` 哈希 look-ahead + 并发 3；`uploadPerformanceSummary()`；pause 不再把未完成项标记 done | `local-backend/test_transfer_benchmark_js.mjs`（12 分片：串行 1921ms → 管线 632ms = 3.04x；最大在途=3；每分片恰好一次；每 PUT 的 SHA-256 与真实字节一致；pause/cancel/failure 语义）、`test_transfer_isolation_js.mjs` | 软件侧完成；真实吞吐待 B-9 |
| #10 Accessibility 读不到页面 | 票据创建晚于 3 秒缓存刷新 → 第一条关键事件被 `no_active_ticket` 丢弃；OCR 构造异常会打断回调 | `PaymentTicketPackageSignal`（创建/重启票据即发布，120s 窗口）；门禁 `cache || signal`，Room 仍为权威；重连清空信号并强制刷新；OCR 失败降级手动路径 | `PaymentAccessibilityServiceGateTest.firstEventOfABrandNewTicketIsNotDroppedByAStaleCache` / `ticketSignalExpiresAndTheGateClosesAgain` / `reconnectClearsTheSignal`、`PaymentRecognitionCoordinatorTest.openingAVerificationTicketAnnouncesThePackage` / `restartedVerificationAnnouncesThePackageAgain`、既有 `PaymentScreenshotOcrTest` 回退链 | 软件侧完成；真机窗口/OCR 待 B-10 |

### 本地验证（本次）

- Android：`testDebugUnitTest` 344+ tests 全绿；`lintDebug assembleDebug` 成功。
- JS：`test_transfer_isolation_js.mjs`、`test_finance_candidates_js.mjs`、`test_interaction_feedback_js.mjs`、
  `test_transfer_integrity_js.mjs`、`test_transfer_benchmark_js.mjs`、`test_module_graph_js.mjs`、`test_tools_js.mjs` 全绿；
  `scripts/check_js_module_graph.mjs`、`scripts/check_storage_contract.mjs` 通过。
- Python：`local-backend` 127 tests 中除 `test_api.py`（需要本机运行中的预览服务）外全绿；CI 的 Python job 已通过。
- CI：`Core CI` 在 `8f1f6ca` 全绿（cloud-only job 首轮为基础设施抖动，重跑通过）；`6bee1eb` / `3739a28` 见 PR #67 最新 run。

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
| B-8 | 真实 800MB EXE/MP4 上传后下载 SHA-256 | 真实网络与文件 |
| B-9 | 真实网络吞吐（800MB） | 真实带宽 |
| B-10 | 真实窗口文本 / OCR → enrichment 或手动路径 | 真机窗口与 ML Kit |
| B-11 | Android 1.3.3 安装与最终端到端 | 设备安装与整体回归 |

## Task 25

未开始：仓库中不存在 Task 25 的实现或开关代码。
