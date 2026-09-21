# Task 24 Final Acceptance Reopen — Release Candidate Record

**状态：`TASK 24 — OPEN / DEVICE ACCEPTANCE PENDING`**（不是 `COMPLETE`）。

当前修复分支：`codex/task24-candidate-history-r6`（base `main`）；历史支付生命周期修复 PR：`#75`
Task 25：**BLOCKED BY TASK 24 FINAL ACCEPTANCE**（仓库中不存在任何 Task 25 代码）

## 2026-09-21 device regression handoff

用户已确认上一轮要求复测的三个 Android 真机问题全部解决，作为后续 Codex 收尾时不可回退的回归基线：

- 待核实交易的「打开应用」现在可正常拉起来源应用，不再静默无反应。
- 「忽略这笔」现在有即时反馈并能完成终态处理，不再表现为死按钮。
- 同一真实支付的重复卡片问题在该轮复测中已解决；继续保留稳定事件 ID / amount-unknown → amount-known 身份复用，禁止退回按金额/时间猜测合并。

以上三项仅代表对应回归点 PASS，**不等于 B-10 / B-11 整体关闭**。后续仍需继续完成 1.3.13 的跨端终态同步、截图语义及最终 closure gates；Task 24 关闭前 Task 25 继续阻塞。

证据口径：

- **CI / PR Preview 通过 ≠ Production Closure**。当前所有 CI 证据来自 PR Preview（wrangler pages dev + 本地 D1/R2 + headless Chrome）。
- 每条结论都标注证据来源：`unit` / `integration` / `browser-E2E` / `device-only`。
- 真机：`Samsung SM-S9360 / Android 16`，正式签名覆盖安装，未卸载、未清除 App 数据。

## 2026-09-20 candidate/history convergence candidate (Android 1.3.10)

- `/finance` 不再把未知方向渲染成“支出”；金额或方向缺失时显示“补全并确认”，商户保持可选，来源应用与商户分别展示。浏览器会在发请求前阻止缺金额/方向的提交。
- 新增账户隔离的 `/api/notification/pending-summary`：一次只读查询返回 pending hint + candidate 的稳定事件 ID，并按调用方指定事件附带 confirmed/ignored 终态；Android 以集合交集显示两端共有、仅本机、仅云端和无法关联的旧记录。
- Production 只读 dry-run 当前为 10 条 pending hint + 2 条 pending candidate。三个近时间微信组都只有不同 event ID、相同旧原因码和空金额/方向，证据不足以安全合并；两条支付宝 ¥2.80 也因只有同额/同指纹而保持独立。未修改任何真实候选。
- 本地通知 schema v8 新增 `archiveKind`。7→8 仅补元数据：持续状态和分组摘要在主列表折叠为一条，完整快照按 50 条继续加载；普通消息、支付证据、媒体和同一 notification key 下的不同交易仍分别可见。无破坏性迁移回退。
- 支付 lifecycle 使用“Android 槽位 + 哈希化结构证据”；同证据的短时 remove/repost 续用 ID，不同交易号或内容证据创建新 ID。原始通知正文不进入偏好设置、API 或日志。
- 工具最近使用同步限制为一个在途请求并合并快速切换期间的待发送项；本地 104 工具矩阵完成，Worker 不再因并发 recent 写入退出。
- 自动证据：Android 全量 unit、v7→v8 migration、Task 21 D1/privacy/finance、Cloud-only 浏览器 14/14；360/390/412px 与 125% 字体候选布局通过。正式发布、Production 更新和 1.3.10 真机原位升级仍待本分支 CI 后执行。

## 2026-09-14 legacy media compatibility candidate (Android 1.3.9)

- 1.3.8 原位升级后，真机微信筛选与“加载更多”确认普通文字消息不再显示图片提示，支付通知仍保留并标记已关联财务。
- 继续向旧记录扫描后复现繁体 `[相片]` 历史行。稳定旧版没有可信 `mediaOrigin`：直接读取其 `mediaPath` 可能把头像当正文图片，完全忽略又会让明确图片消息无状态。
- 1.3.9 引入展示三态：只有 `picture/background/message_image/notification/media_store` 等可信来源可加载文件；来源不明的旧 `[图片]/[圖片]/[照片]/[相片]` 只显示“图片内容不可用”；普通文字保持无图片区域。
- 自动回归覆盖旧 `large_icon + [图片]`、繁体 `[相片]`、普通文字、可信 MessagingStyle 图片与 screenshot/Room 历史；仍需正式发布后在同一真机复核该旧记录和一条新图片消息。
- 1.3.8 Production 上已完成既有 ¥0.01 闭环：正确 08:29:57 hint 为 `confirmed`，只生成 1 笔 active/automatic 支出；1.3.6 的 08:30:08 重复 hint 单独变为 `ignored`。force-stop/reopen 后账户与 -¥31.05 余额恢复，两个 terminal 状态没有复活。
- force-stop 后 Samsung 自动关闭了支付核实无障碍（通知访问仍开启）；1.3.9 最终核实前需从系统设置重新授权，不能用 ADB 绕过。

## 2026-09-14 notification/Finance convergence candidate (Android 1.3.8)

- 1.3.7 已在 Samsung SM-S9360 上从 1.3.6 原位升级，`firstInstallTime` 不变，账户、通知访问、支付核实无障碍及通知权限保留。
- 真机复现 Finance 候选刷新会先清空列表并重建 DOM：编辑中的 ¥0.01 金额被丢弃，其他候选同步闪烁。1.3.8 不再用空列表作为加载态，丢弃旧请求结果，并在有效刷新中保留展开表单、输入值和未处理候选。
- 通知媒体 root cause 是 `EXTRA_LARGE_ICON(_BIG)` 被当成消息正文图片；这些字段以及 `MessagingStyle.Person.icon` 只是应用/联系人头像。1.3.8 只接受 BigPicture、背景内容 URI 或 MessagingStyle `data_uri/type=image/*`，并对旧头像误标记录做展示兼容。
- 支付通知与 Finance 候选曾经过两个独立 pipeline；当银行/支付 App 把收据标成 ongoing/progress 时，Finance 会保留候选但通知档案会过滤它。1.3.8 将结构化 transaction/refund candidate 设为必须归档的支付证据（用户显式关闭该 App 仍然有效）。
- 通知历史没有数据库 25 条保留限制：当前首屏是 50 条，显式“加载更多”上限 500，数据库继续执行 7/30/90/365/永久保留与收藏保护。1.3.7 真机已显示 32+ 条，确认旧“保存 25 条”来自旧首屏截断而非数据清空。
- `financeUndoBar` 过去只在恢复/账户 reset 时清理；1.3.8 在离开财务页时结束该页面局部 undo 生命周期并清空旧成功提示。
- 自动证据：Android `testDebugUnitTest`、`lintDebug`、`assembleDebug`；Cloud-only 浏览器 14/14；应用浏览器 24/24。新增覆盖头像/Person.icon、真实图片、无 payload 图片、支付候选归档、刷新不假空、编辑值保留、处理 A 不影响 B、跨路由 undo 清理。
- 1.3.8 已完成 ¥0.01 exactly-once、旧重复 hint 忽略、Android/Finance 收敛与 force-stop/reopen；最终 closure 由 1.3.10 的候选/历史收敛与真机回归继续承接。完成前 Task 25 继续阻塞。

## 2026-09-14 payment lifecycle closure candidate (Android 1.3.7)

- 真实 ¥0.01 详情在 90 秒 ticket 内由本机 OCR 得到 `amount=1 / EXPENSE`，`ocr-enrichment result=applied`；没有自动入账。
- 同一微信 notification key 在 11 秒后的更新改变了 `postTime`，1.3.6 将它误作第二个 source event，产生重复 recognition/hint。1.3.7 改为持久化 lifecycle registry：同一 Android slot 在 remove 前复用一个随机 event ID，remove 后才创建新 ID；registry 不保存正文、金额、账号或凭据。
- OCR 后的 `ENRICHMENT_VERIFIED` 现在由设备确认，即使初始 amount-unknown hint 已上传；确认沿用该 hint 的 event ID，服务端建账与关闭 hint 为同一幂等链路，不要求用户重复填写金额。
- 1.3.7 真机微信图片通知仅提供 `largeIcon`，没有消息图片 Bitmap/URI；后续录像证明该字段其实是联系人头像，普通文字也因此错误显示“图片内容不可用”。该结论由 1.3.8 的媒体语义修复取代。
- 自动回归覆盖：同 key/postTime 变化只留一个 hint、remove 后开启新 lifecycle、进程重建身份保持、registry 隐私、设备 OCR event ingest 关闭 hint、重复 ingest 只生成一笔账。
- Cloud-only toolbox 的真实失败来自 `/transfer` 后测试直接调用隐藏工具 API，并在 canonical Session 恢复前继续；矩阵改为先回 `/tools`，等待 bridge + account + session，再继续全部 104 个工具。隔离本地矩阵 104/104 通过，86 次下载、51 个模式、27 个工作流，`failures=[]`、`runtimeErrors=[]`。
- 手机暂时离线；1.3.7 尚需覆盖安装后完成：确认 ¥0.01 → 服务端 terminal → Android convergence → force-stop/reopen。完成前 Task 24 保持等待，Task 25 继续阻塞。

## 2026-09-14 device closure evidence (Android 1.3.6)

| Gate | 真机 / Production 证据 | 结果 |
| --- | --- | --- |
| B-3 | 已确认普通微信聊天“明天8点见”只进入通知归档，没有创建 Finance 候选 | PASS |
| B-4 | CaptureTrace、OCR、候选生成均有阶段日志；本次没有把不匹配的既有转账确认进账本 | PARTIAL — 需要一笔与待核实项匹配的既有交易完成 confirm/terminal/convergence |
| B-5 | Samsung 原生录屏 100 秒：124 个 `CHANNEL_ID_RECORDING_SCREEN` tick 全部 `archive-skipped`，0 accepted/committed；停止录屏只保存 1 个含媒体终态。Clash 120 秒 140 个 tick 同样 0 持久化，保存数保持 135 | PASS |
| B-6 | Samsung 截图通知可打开真实截图；录屏终态媒体可用。普通图片通知与微信图片仍缺一轮可识别素材 | PARTIAL |
| Permissions | 通知访问、POST_NOTIFICATIONS、READ_MEDIA_IMAGES、RECEIVE_SMS 均开启；无障碍从系统设置开启后 `accessibility-connected`，权限中心即时显示“无障碍已连接” | PASS（侧载覆盖安装后 Samsung 会要求重新确认无障碍） |
| B-7 | 通知/财务连续 12 次切换：563 帧，jank 16（2.84%），P50 10ms、P95 19ms、P99 57ms、0 missed-vsync | PASS |
| B-8 | 真机 SAF 800 MiB：过期 session 自动重建；失效旧 URI 隔离；上传从 0 B 实际推进至 838,860,800 B，创建 Production 分享成功 | PASS |
| B-9 | 下载 Content-Length 838,860,800；filename/filename*、MIME、Accept-Ranges 正确；源与下载 SHA-256 同为 `326a880029794febbfa3cfaa9c2ecc22083d5b1dae641c8dc63d1efa65a11a59`。1 MiB Range 返回 206 和正确 Content-Range | PASS |
| TTS | Production 英语、日语听写真机均由 WebView AudioTrack 播放，未触发 `ThewyjSpeech` 本机 fallback；日语汉字 API 200 且重复请求命中缓存 | PASS |
| B-10 | 活跃 90 秒 ticket → 双开微信详情 → Samsung 安全弹层 → window/full-display fallback → bundled ML Kit OCR（19–21 行）→ `context=true`、`decisive=true` → `amount=83317 direction=EXPENSE` → 本地候选“已核实金额”；未自动写入 Finance | PASS 到候选；最终匹配交易确认同 B-4 待用户验收 |

本轮发现并修复：Android 原生上传复用过期 session、不可读 SAF 项阻塞队列、短期 access token 过期不续期、完成清单不一致；Android 14+ 窗口截图误传 display ID；窗口截图异步失败/空图不回退；R8 删除 ML Kit registrar 构造器；OCR 节流吞掉稳定详情；ticket 两次 miss 约 8 秒提前失败且金额未知 ticket 不会过期；繁体转账金额/服务费主金额与支出方向识别。

测试产生的 800 MiB Production 分享已撤销，手机合成源文件与录屏文件已删除；不删除审计记录。

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

### Android 正式发布封装（1.3.10 / versionCode 23）

| 项 | 值 |
| --- | --- |
| 源码版本 | `android/app/build.gradle.kts` → `versionName 1.3.10` / `versionCode 23`（Task 24 候选、历史与计数收敛） |
| APK | `dist/thewyj-android-1.3.10.apk`（本地构建产物，`dist/` 按仓库约定不入库）；目标 R2 key = `app/android/thewyj-android-1.3.10.apk` |
| applicationId / minSdk / targetSdk | `uk.thewyj.app` / `30` / `36` |
| BASE_URL | `https://thewyj.uk` |
| APK size | `47,627,681` bytes |
| APK SHA-256 | `e30c055a697fa508ba67fe09b10d95a01f2023d31ed5f9e22db55d9bbeb0d4d2` |
| 签名证书 SHA-256 | `2B:32:20:29:A9:B8:4D:E6:F2:D1:EF:60:37:78:B5:07:99:97:A3:F8:DF:21:D0:1C:A8:CB:30:C7:6B:4F:7D:03`（`thewyj-release`，与 1.3.1–1.3.4 同一正式证书，非 debug 签名） |
| releaseBuild | `2026-09-20-task24-candidate-history-r6` |
| release notes | 候选字段语义、稳定 ID 集合对账、状态历史折叠与同额不同交易保护。 |
| 一致性 gate | `scripts/check_android_release_consistency.py`（build.gradle ↔ release-metadata.json ↔ wrangler 三段 vars ↔ APK manifest/SHA/size/证书，共 46 checks）+ `scripts/test_check_android_release_consistency.py`（6 项负向自测，证明 gate 真的会拒绝不一致） |
| CI 接入 | Python job（跨文件一致性）、Android job（构建出的 APK manifest 与 metadata 对齐） |

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
