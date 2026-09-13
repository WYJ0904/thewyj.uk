# Task 24 Final Acceptance Reopen — Failure Matrix

设备：Samsung SM-S9360（`R5CY22MEHJN`），Android 16，App 1.3.2（15）。
现场保留：登录状态、通知历史、Finance 数据、文件传输现场均未清理。

状态图例：`FIXED-TESTED`（代码+回归完成，待部署/真机复验）、`ROOT-CAUSED`（根因与证据已定，修复进行中）、`EVIDENCE-GATHERING`（采集证据中）、`OPEN`。

## 1. P0 Notification 页面「填写金额并记账」无反应 /「修改没有保存，请重试」— FIXED-TESTED

- repro（真机 00:22）：微信 金额待核实 → 填写金额 100 → 保存并记账 → 横幅「修改没有保存，请重试」，条目保持 pending。
- evidence：`PaymentVerificationState.saveAndConfirm` 在 `center.saveCorrection` 返回 false 时输出该文案；
  `PaymentVerificationCenter.saveCorrection` 对空 `candidateId` 直接 `return false`；
  amount-unknown 的 capture 只创建 90 秒 ticket（`PaymentRecognitionCoordinator` line ~92），**从不创建 candidate**，所以 `item.candidateId` 为空。
- code path：PaymentVerificationState → PaymentVerificationCenter.saveCorrection → PaymentRecognitionCoordinator.editCandidate。
- fix：新增 `PaymentRecognitionCoordinator.ensureCandidateForRecognition()`（无 candidate 时按用户输入创建，机器证据保持 null，用户值放 edited* 字段）；`saveCorrection` 增加 `recognitionId` 回退；`PaymentVerificationState` 传入 recognitionId。
- regression：`PaymentRecognitionCoordinatorTest.manualAmountCreatesTheMissingCandidateAndBooksIt`（含“第二次保存复用同一 candidate”）。
- 待办：部署 1.3.3 → 真机重跑该路径（通知页确认 + Finance 页确认两份）。

## 2. P0 Finance 页面「填写金额并确认」经常无反应 — FIXED-TESTED（等待真机复验）

- 与 #1 同源的部分：无 candidate / 缺字段时按钮应当引导补全（Web 端已在 24.4 修 direction/amount 引导）。
- 软件侧补齐（本次）：
  - 点击后**同步**进入 pending 状态（`data-pending` + `aria-busy` + `disabled` + 「处理中…」），不再等网络回来才有反馈；
  - 确认成功后立即进入**乐观终态**（该行移出待确认列表 + 「已记账，正在同步…」），不再等两次 reload；
  - 列表刷新改为 **single-flight**，并用版本令牌丢弃陈旧响应（慢响应不能覆盖新状态）；
  - `decide()` 全链打点：`click → handler-start → request-start → response → state-apply → render-end`，真机可通过
    `window.__wyjInteractionTrace().recent()` 读取每段耗时与 150ms 反馈预算。
- regression：`local-backend/test_interaction_feedback_js.mjs`（同步反馈、打点顺序与单调性、single-flight、陈旧保护）、
  `local-backend/test_finance_candidates_js.mjs`（缺字段必须走编辑而非发送必败请求）。
- 待真机：WebView Finance 页复验「填写金额 → 确认」即时反馈与 exactly-once（D1 终态 + 只出现一条 transaction）。

## 3. P0/P1 微信「已支付100 / 已支付¥100」识别不到金额 — FIXED-TESTED（含一条待真机确认）

- repro：真机 23:46/23:47 两条微信通知进入「金额待核实」，通知历史里对应归档条目显示「(无标题)(无正文)」。
- evidence：微信聊天/支付通知是 **MessagingStyle**，正文在 `EXTRA_TEXT_LINES`；监听器已把它存进 `NotificationCaptureInput.textLines`，
  但 `AndroidPaymentRecognitionHook.outcomeFor()` 只把 `title/text/bigText/subText` 交给支付解析器——**textLines 从未参与解析**，因此正文里的「已支付¥100」不可见。
- fix：`outcomeFor()` 合并 `textLines` 后再解析；新增“解析结果审计日志”（只记录包名与长度/状态，不记录内容）。
- regression：`AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`、
  `PaymentParserTest.explicitPaymentAmountIsIndependentOfTitleAndMerchant`（联系人标题 + 已支付100/¥100/￥100/100元/支付100元）。
- 已存在能力：`已支付100`、`已支付 100`、`已支付100元`、`支付100`、`¥100` 等在支付解析器已有回归（PaymentParserTest）。
- 待真机：需要用户再发一条微信「已支付¥100」（或收到同类支付通知）验证端到端。

## 4. P1 Notification ↔ Finance 同步延迟 — FIXED-TESTED（等待真机计时）

- 已有事实：1.3.2 + 服务端 `state=` 修复后，Web 确认 → 设备 pull → 本地收敛已在 ¥104.49 上验证；但缺少**分阶段时间戳**。
- 软件侧补齐（本次）：
  - Android 侧沿用 `CaptureTrace` 的 `finance-parsed / room-committed / room-coalesced / archive-accepted` 阶段；
  - Web 侧新增 `js/core/perf.js`：`beginInteraction()` 记录 `click → handler-start → request-start → response → state-apply → render-end`，
    `window.__wyjInteractionTrace()` 供真机审计读取（只记录阶段与标识，不记录通知/账目内容）；
  - 确认后不再等待下一次周期 pull：乐观终态 + 后台 single-flight 对账；
  - canonical ID 全链统一：device/本地 recognition 的 `uploadEventId` 与 Web 端 `hint_id/candidate_id` 都指向同一 `source_event_id`（已有
    `NotificationCaptureCoordinatorTest.incompletePaymentRecordsTheHintEventIdForTheServerPull` 回归）。
- 待真机：按 capture→recognition→local DB→upload→server hint→finance txn→terminal pull→render 记录真实耗时。

## 5. P1 三星录屏/截图 ongoing 通知被大量重复归档 — FIXED-TESTED

- 已观察：Clash 的 ongoing 通知被正确跳过（`archive-skipped reason=ongoing_flag`），说明 ongoing 分类器有效。
- 仍疑似：录屏计时类通知未带 `FLAG_ONGOING_EVENT`，且每秒变化 → 每次变化按新条目归档。
- 根因：无 `FLAG_ONGOING_EVENT` 的计时类通知每秒变化，旧实现每条都追加一个 revision（前 5 条还会先入库），历史里出现大量行。
- 修复（本次）：
  - 稳定身份 = `notificationKey`，无 key 时 `package + id + tag`（`identityKey` 已在分类层与存储层统一）；
  - `NotificationLiveCoalescer.readoutDecision()`：同一身份在 3 秒内重复同一「数字归一化形状」连续 3 次后判定为更新型读数，
    分类结果带 `coalesceWithPrevious=true`，Room 层**就地改写最新 revision**（不追加、不新增历史行）；
  - 带金额的事件（收款/支付凭证）**永不合并**，1 秒内 3 条真实收款仍各自保留快照；
  - 生命周期：`markRemoved` 关闭该身份（含无 key 的 package+id+tag 槽位），撤回后 archive 保留，撤回后再发为新实例；
  - 无 Android 身份的旧入口不入 coalesce（不会误合并）。
- regression：`NotificationClassificationTest.recordingTimerUpdatesOneRowInsteadOfAppending`、
  `identicalMessagesFarApartAreNeverMerged`、`repeatedPaymentReceiptsAreNeverMerged`、
  `store/NotificationReadoutCoalescingTest`（1 行 1 revision、真实变化仍新增、移除后新生命周期、keyless 槽位）、
  `NotificationCaptureCoordinatorTest.updatingNotificationReachesTheArchiveAsACoalescedUpdate`。
- 待真机：Samsung 录屏/截图通知重复归档计数（device-only）。

## 6. P1 通知媒体图片未正确归档 — FIXED-TESTED

- 与 #5 同片区域（截图/录屏通知 + MediaStore 通道）。已有 Task 24.1 R4 能力，但真机复现显示媒体缺失。
- 根因：旧实现只看 `EXTRA_PICTURE/EXTRA_LARGE_ICON*` 的 Bitmap；Android 也常用 **content URI** 发布图片，
  而聊天气泡图片在 `MessagingStyle` 的 `EXTRA_MESSAGES[*].data_uri`，因此“有图但没归档”。
- 修复（本次）：新增 `NotificationMediaExtractor`（Bitmap / URI / `EXTRA_BACKGROUND_IMAGE_URI` / MessagingStyle 图片），
  监听器把 `mediaSourceUri` 一并带入；归档 sink 在后台把引用导入 App 私有目录（`NotificationMediaStore.saveUri`），
  读不到时如实保留 `unavailable` 且**通知本身仍然入库**，绝不写入死 URI。
- regression：`NotificationMediaExtractorTest`（BigPictureStyle bitmap、largeIcon、URI 形式、MessagingStyle 图片、
  纯文本会话、非图片附件、无媒体、缺失 extras、picture key 不可读 → unavailable、背景图引用）、
  `NotificationScreenshotArchiveTest.referencedNotificationImageIsImportedIntoPrivateStorage` /
  `unreadableReferencedNotificationImageStaysUnavailable`。
- 待真机：Samsung 截图/录屏通知的 mediaState 与 mediaPath 实地核对（device-only）。

## 7. P1 全站点击数秒无反馈 / 页面突然跳变 — FIXED-TESTED（手感需真机）

- 真机侧证据：Samsung jank 监控在本轮复现时记录 `uk.thewyj.app jank rate: 7362`。
- 已确认的机制（代码层）：
  - session/config 刷新已有 `backendRefreshPromise` 单飞；路由已有 generation 守卫（本轮保留并纳入打点）；
  - 候选列表原先在确认后连续两次网络 reload 才更新 UI（点击到反馈=网络往返）；
  - 无任何交互级打点，无法区分“桥接慢/请求慢/渲染慢”。
- 修复（本次）：
  - `js/core/perf.js`：`beginInteraction()` 全链打点 + 150ms 反馈预算；
  - `attachInteractionFeedback()`：点击同任务内设置 pressed/loading/disabled（下一帧即反馈）；
  - `createSingleFlight()` / `createLatestOnly()`：重复 refresh 合并、陈旧响应丢弃；
  - `patchOverlayClickThrough()`：pending 期间 overlay 不吃点击；
  - app.js 全局捕获阶段 click 打点 + 每次路由渲染写入 `state-apply/render-end`；
    `window.__wyjInteractionTrace()` 暴露最近 60 条时间线供真机审计。
- regression：`local-backend/test_interaction_feedback_js.mjs`（同步反馈、还原、打点单调、single-flight、陈旧保护、ring 上限、overlay 穿透）。
- 待真机：真实 WebView 手感 / frame jank（device-only；用 `__wyjInteractionTrace()` 与 jank 监控读数）。

## 8. P0/P1 文件传输完整性（EXE 扩展名丢失 / MP4 损坏） — FIXED-TESTED（真实 800MB 待真机）

- 已知：服务端 16/16 分片与 etag 齐全**不能**证明下载文件正确（用户已指出）。
- 本次完成：`local-backend/test_transfer_integrity_js.mjs`（CI 已接入）对 jpg / png / mp4-like / exe / 随机 binary / 多分片 binary 六种形状
  做 **source == R2 最终对象 == 下载字节** 的 SHA-256 与 byte length 三方对比，并断言：
  filename 与扩展名（`.exe` 必须保留）、Content-Type、Content-Disposition（含原始文件名）、Content-Length、
  `Accept-Ranges`、跨 16MiB 分片边界的精确 Range 窗口（206 + Content-Range）、以及重复分片 PUT 的幂等 resume。
- 结论口径：不再以「16/16 分片 + etag」作为完整性证据。
- 待真机：真实 800MB 上传（EXE/MP4）下载后 SHA-256 复验（device-only）。

## 9. P1 大文件上传速度不合格（约 800 MB > 5 分钟） — FIXED-TESTED（真实吞吐待真机）

- repro：`uploadItem` 逐 part 串行：hash → PUT → 等待 → 下一个 part，吞吐被 RTT 限制。
- fix：受控并发（默认 3）：`missingPartNumbers()` / `uploadWorkerCount()` 纯函数 + 3 worker 调度；
  - 进度改为“已确认字节累加”（并发乱序完成时不会跳到 100%）；
  - pause/cancel 会 abort 所有在途 controller（`item.controllers`），resume 只补缺失 part；
  - 首个错误停止调度并把该项置 error（单 part 重试语义保持）；
  - finalize 仍由 `complete()` 单次执行，服务端分片校验不变。
- regression：`local-backend/test_transfer_isolation_js.mjs`（缺失 part 计划、并发上限、剩余 part 不足时收缩、全部完成后 0 worker）。
- 本次补充：
  - hash/upload **管线化**：`runPartPipeline()` 在 PUT 进行时预取并计算后续分片 SHA-256（look-ahead 2），网络不再等哈希；
  - 性能打点：`uploadPerformanceSummary()` 记录 hashMs / uploadMs / totalMs / 有效吞吐；
  - pause 语义修正：暂停不再把未完成的上传标记为 done（旧行为让「开始/继续」失效），恢复只补缺失分片；
  - benchmark：`local-backend/test_transfer_benchmark_js.mjs`（CI 已接入）用真实调度器 + 模拟每分片延迟对比
    `hash → PUT → wait` 串行模型与并发 3 管线：12 分片 1921ms → 632ms（3.04x，实测于本机），
    并断言最大并发=3、每分片只上传一次、每个 PUT 携带的 SHA-256 与分片真实字节一致、pause/cancel/failure 语义与 resume 计划。
  - 800 MiB 仍为 50 个 16 MiB 分片、3 worker；SHA-256 未做任何削弱。
- 待真机：真实网络 800 MB 吞吐数据（device-only）。

## 10. P1 Accessibility 仍读不到真实页面数据 — FIXED-TESTED（真机窗口待验）

- 根因（软件侧竞态）：`PaymentTicketPackageCache` 每 3 秒才从 Room 刷新，票据创建后第一条关键事件可能早于刷新到达，
  被 `no_active_ticket` 直接丢弃；服务重连/账号刷新同样只有缓存路径。
- 修复（本次）：
  - 新增 `PaymentTicketPackageSignal`（进程内、120 秒窗口、内存only）：创建/重启核实票据时立即发布包名；
  - 门禁改为 `cache.contains(pkg) || signal.recentlySignalled(pkg)`，信号路径只放行**读取**，
    Room 票据仍由 worker 线程复核（`no_active_ticket` 兜底），**不放宽为读取所有 app**；
  - `onServiceConnected`（重连/账号刷新）清空信号并按 Room 强制刷新；
  - OCR 回退加固：截图/ML Kit 不可用时降级到手动路径，不再让异常中断 accessibility 回调。
- regression：`PaymentAccessibilityServiceGateTest.firstEventOfABrandNewTicketIsNotDroppedByAStaleCache`、
  `ticketSignalExpiresAndTheGateClosesAgain`、`reconnectClearsTheSignal`、
  `PaymentRecognitionCoordinatorTest.openingAVerificationTicketAnnouncesThePackage` / `restartedVerificationAnnouncesThePackageAgain`、
  既有 `PaymentScreenshotOcrTest`（`rootInActiveWindow empty → packageWindowRoot → OCR → enrichment/manual` 语义）。
- 待真机：真实窗口文本/OCR 读取与 enrichment（device-only）。

## 11/12. Notification/Finance 主路径异步状态不同步 — 见 #1/#2/#4

## Task 25

**BLOCKED BY TASK 24 FINAL ACCEPTANCE** — 未写任何 Task 25 代码（仓库检索 `flag_key/releaseChannel/rollout_percentage` 无命中）。
