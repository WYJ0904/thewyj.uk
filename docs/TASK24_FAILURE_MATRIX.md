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

## 2. P0 Finance 页面「填写金额并确认」经常无反应 — EVIDENCE-GATHERING

- 与 #1 同源的部分：无 candidate / 缺字段时按钮应当引导补全（Web 端已在 24.4 修 direction/amount 引导）。
- 仍需真机证据：点击后是否发出请求、HTTP 状态、response body、D1 终态；以及 #7 的点击反馈问题是否导致“点了没反应”。
- 待办：真机 WebView Finance 页复现 + 抓包/日志；与 #7 一并处理。

## 3. P0/P1 微信「已支付100 / 已支付¥100」识别不到金额 — FIXED-TESTED（含一条待真机确认）

- repro：真机 23:46/23:47 两条微信通知进入「金额待核实」，通知历史里对应归档条目显示「(无标题)(无正文)」。
- evidence：微信聊天/支付通知是 **MessagingStyle**，正文在 `EXTRA_TEXT_LINES`；监听器已把它存进 `NotificationCaptureInput.textLines`，
  但 `AndroidPaymentRecognitionHook.outcomeFor()` 只把 `title/text/bigText/subText` 交给支付解析器——**textLines 从未参与解析**，因此正文里的「已支付¥100」不可见。
- fix：`outcomeFor()` 合并 `textLines` 后再解析；新增“解析结果审计日志”（只记录包名与长度/状态，不记录内容）。
- regression：`AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`、
  `PaymentParserTest.explicitPaymentAmountIsIndependentOfTitleAndMerchant`（联系人标题 + 已支付100/¥100/￥100/100元/支付100元）。
- 已存在能力：`已支付100`、`已支付 100`、`已支付100元`、`支付100`、`¥100` 等在支付解析器已有回归（PaymentParserTest）。
- 待真机：需要用户再发一条微信「已支付¥100」（或收到同类支付通知）验证端到端。

## 4. P1 Notification ↔ Finance 同步延迟 — EVIDENCE-GATHERING

- 已有事实：1.3.2 + 服务端 `state=` 修复后，Web 确认 → 设备 pull → 本地收敛已在 ¥104.49 上验证；但缺少**分阶段时间戳**。
- 计划：在 capture→recognition→local DB→upload→server hint→finance txn→terminal pull→UI render 各段打点（结构化日志），用真机测量实际耗时；本地确认后立即乐观反馈。
- 待办：实现打点 + 真机测量。

## 5. P1 三星录屏/截图 ongoing 通知被大量重复归档 — EVIDENCE-GATHERING

- 已观察：Clash 的 ongoing 通知被正确跳过（`archive-skipped reason=ongoing_flag`），说明 ongoing 分类器有效。
- 仍疑似：录屏计时类通知未带 `FLAG_ONGOING_EVENT`，且每秒变化 → 每次变化按新条目归档。
- 计划：真机复现录屏 → 记录被归档条目的 package/key/id/tag/postTime 与数量 → 按稳定身份 coalesce（update/merge），并补回归。

## 6. P1 通知媒体图片未正确归档 — EVIDENCE-GATHERING

- 与 #5 同片区域（截图/录屏通知 + MediaStore 通道）。已有 Task 24.1 R4 能力，但真机复现显示媒体缺失。
- 计划：真机截图 → 检查 CaptureTrace（media=bitmap/hint/none、media-permission-*）与归档 mediaState。

## 7. P1 全站点击数秒无反馈 / 页面突然跳变 — EVIDENCE-GATHERING

- 真机侧证据：Samsung jank 监控在本轮复现时记录 `uk.thewyj.app jank rate: 7362`。
- 计划：click→handler→network→render 打点；检查重复 session/config/finance 拉取、同步 JSON/DOM 重建、WebView bridge 阻塞、loading overlay 吞点击、重复 listener。

## 8. P0/P1 文件传输完整性（EXE 扩展名丢失 / MP4 损坏） — EVIDENCE-GATHERING

- 已知：服务端 16/16 分片与 etag 齐全**不能**证明下载文件正确（用户已指出）。
- 计划：按类型（jpg/png、mp4、exe、随机 binary）做 source/服务端对象/下载文件三方 SHA-256 + byte length 对比；
  检查 Content-Disposition、原始 filename/extension、Content-Type、chunk offset/order、finalize/assemble、Range/stream 路径。
- 待办：用 CI 浏览器矩阵扩展（真实上传→下载→SHA 对比）+ 真机复验。

## 9. P1 大文件上传速度不合格（约 800 MB > 5 分钟） — EVIDENCE-GATHERING

- 计划：分阶段 profile（local hashing / chunk enqueue / 网络上传 / server processing / D1 metadata / finalize），记录 chunk size、并发、每段耗时与吞吐，再优化 hot path（不关闭 hash/完整性）。

## 10. P1 Accessibility 仍读不到真实页面数据 — EVIDENCE-GATHERING

- 计划：真机触发核实票据 → 记录 accessibility package/event/tree 文本行数/parser 输入与结果（PaymentAccessibilityStatus 已有部分打点）→ 定位是事件未到达、窗口无文本还是 parser 拒绝。

## 11/12. Notification/Finance 主路径异步状态不同步 — 见 #1/#2/#4

## Task 25

**BLOCKED BY TASK 24 FINAL ACCEPTANCE** — 未写任何 Task 25 代码（仓库检索 `flag_key/releaseChannel/rollout_percentage` 无命中）。
