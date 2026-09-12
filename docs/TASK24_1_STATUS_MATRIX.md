# Task 24.1 状态矩阵（已知问题修复与真机闭环）

状态取值：`FAIL` / `FIXED / NOT PHYSICALLY VERIFIED` / `PASS AUTOMATED` /
`PASS PHYSICAL` / `BLOCKED`。真机一列只有用户在 SM-S9360 上确认过的才写
`PASS PHYSICAL`；本轮无法自测的写 `PENDING USER PHYSICAL ACCEPTANCE`。

版本基线：

- `1.2.7 (10)`：Round 2 修复（Finance 闭环、撤回历史、移动端折叠、桌面端不折叠）。
- `1.2.8 (11)`：Round 3/4（pending hints 统一、微信本地 OCR、通知媒体历史、
  AppLabelResolver、文件传输双实现统一）。已成为正式版。
- `1.2.9 (12)`：本轮（Samsung 连续截图归档 + Android 14–16 媒体权限能力矩阵）。

## Round 5（1.2.9：连续截图归档 + 媒体权限矩阵）

| ID | Severity | 用户现象 | Reproduction | Root cause | Fix | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-31 | P0 | 三星连拍/连续截图只保留第一张，后续截图整条丢失 | SM-S9360 连续截 3 张 → 通知历史只有 1 条 | One UI 复用同一个「截图已保存」通知（同 key / 同 id / 同正文）覆盖上一张；`recordCapture` 只比较文本 `contentHash`，把第二张之后全部当成 replay 合并 | 截图事件改用证据身份：`ms:<rowId>` > `uri:<sha>` > `nfb:<bitmap>`；Room v6 新增 `mediaFingerprint/mediaFingerprintAlt/mediaOrigin`；文本相同但媒体证据变化 → 新快照；媒体文件按证据命名（绝不覆盖上一张） | `NotificationScreenshotArchiveTest`（单张=1 行、同 key 第二张=2 行、连拍 5 张=5 行、200ms 快拍不合并、回放去重、附件互不覆盖、清除通知后新截图仍保留）、`NotificationDatabaseMigrationTest`（v5→v6 保留媒体） | PASS（本地 + PR CI） | 1.2.9 | 1.2.9 | PENDING USER PHYSICAL ACCEPTANCE（SM-S9360 连续截 3–5 张） | PASS AUTOMATED / PENDING PHYSICAL |
| T24.1-32 | P0 | 系统通知没带图片时截图没有图片可看 | 三星截图后查看详情 | 只有通知 payload 的 bitmap 落地；系统相册里的真实截图从未被读取 | MediaStore ContentObserver（Images/Screenshots）+ 本地私有目录导入；`ms:<rowId>` 水位线 + 证据去重；只在本机处理，不上传 | `NotificationScreenshotArchiveTest.mediaStoreFallbackArchivesADegradedRowWithoutADeadUri`、`ScreenshotEvidenceTest`（行号/URI/像素指纹优先级、合并窗口） | PASS（本地 + PR CI） | 1.2.9 | 1.2.9 | PENDING USER PHYSICAL ACCEPTANCE | PASS AUTOMATED / PENDING PHYSICAL |
| T24.1-33 | P0 | Android 14+「仅允许部分照片」时可能把读不到的截图当成已保存 | Android 16 选择「部分照片」后截图 | 旧实现没有能力判断，observer 收到变化就当作可读 | `MediaReadPolicy` 能力矩阵：`READ_MEDIA_IMAGES`=FULL（可导入）/ `READ_MEDIA_VISUAL_USER_SELECTED`=LIMITED（**禁止导入**）/ 无权限=DENIED；每次扫描重新判定；读不到时保留通知自带图片，否则写明确 `mediaState=unavailable`（绝不写 content URI）；权限中心新增真实状态项与授权入口 | `MediaReadCapabilityTest`（33/34/35/36 × 完整/部分/无权限、运行时请求集合、日志区分、禁止 `DETECT_SCREEN_CAPTURE`） | PASS（本地 + PR CI） | 1.2.9 | 1.2.9 | PENDING USER PHYSICAL ACCEPTANCE（验收时同时报告当前媒体权限状态） | PASS AUTOMATED / PENDING PHYSICAL |
| T24.1-34 | P0 | 同一张截图可能被登记两次（通知 + 相册两条） | 截图后同时收到通知与 MediaStore 变化 | 两条来源各自归档，没有交叉去重 | 双向合并：任一来源先到时，另一来源在 150 秒窗口内合并进同一条记录（MediaStore 全分辨率图片优先），并记录 `duplicate-merged` | `NotificationScreenshotArchiveTest`（通知先/相册先都合并为 1 行、重复导入忽略）、`ScreenshotEvidenceTest.decide` | PASS（本地 + PR CI） | 1.2.9 | 1.2.9 | PENDING USER PHYSICAL ACCEPTANCE | PASS AUTOMATED / PENDING PHYSICAL |
| T24.1-35 | P1 | 普通图片通知被误判成截图 | 微信/Telegram 图片通知 | 若仅凭「有图片」判定截图语义会产生垃圾记录 | 截图语义只由包名（smartcapture 等）/渠道（screenshot）/正文（截图/Screenshot）判定，单独有图片不算；普通通知仍走原有去重 | `ScreenshotEvidenceTest.screenshotDetectionNeverInventsSemanticsFromMediaAlone`、`NotificationScreenshotArchiveTest.ordinaryNotificationDedupeIsUnchanged` | PASS（本地 + PR CI） | 1.2.9 | 1.2.9 | 不适用（逻辑） | PASS AUTOMATED |
| T24.1-36 | P1 | 可审计性：日志无法区分各种媒体状态 | 开发日志 | 状态混在一起 | 增加明确阶段：`screenshot-detected` / `media-resolved` / `media-permission-full|limited|denied` / `notification-fallback-used` / `media-store-fallback-used` / `duplicate-merged`；不写通知正文 | `MediaReadCapabilityTest.logStagesSeparateEveryCapabilityState` | PASS（本地 + PR CI） | 1.2.9 | 1.2.9 | 不适用（日志） | PASS AUTOMATED |

## Round 4（1.2.8：文件传输统一 + 正式发布）

| ID | Severity | 用户现象 | Reproduction | Root cause | Fix | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-37 | P0 | 工具箱与「我的」文件传输是两套实现 | 工具箱 → 文件传输 | Task 22 只把 `temporary-file` 从可见目录移除，仍留在 `TOOL_MAP`，深链/最近使用/收藏仍打开 Task 14 旧上传器（500 MB 配额、单选、0 B 卡住） | 两个 id 统一交接 canonical `showTransfer`（同一页面/API/配额/队列/分享列表）；删除旧 `renderTemporaryFile` 与 `/api/temporary/file/*` 调用；新增静态守卫防止旧实现复活 | `test_tools_js.mjs`（38）、`test_tools_browser.mjs`（真实上传→分享→下载 SHA-256 一致）、`test_static.py`（禁止 legacy 引用）、`qa/verify_tool_artifacts.py` | PASS（PR #58 7/7） | PASS | PASS（1.2.8） | PASS PHYSICAL（用户 1.2.8 真机确认「我的 → 文件传输」正常；工具箱入口随 1.2.9 复验） | PASS（双实现已消除） |
| T24.1-25 | P0 | 截图/图片通知整条丢失 | 真机截图后查看通知历史 | 分类层 channel 关键词过宽命中 Samsung 截图 channel → LIVE → 不写库；且没有媒体模型 | channel 关键词收窄；带图片通知永不按 LIVE 过滤；Room v5 媒体模型 + 本地文件 | `NotificationMediaHistoryTest`、`NotificationClassificationTest` | PASS | PASS（1.2.8） | PASS（1.2.8） | PASS PHYSICAL（用户确认截图通知已进入历史；连续截图问题见 T24.1-31） | FIXED（1.2.8）/ 连续截图由 Round 5 收口 |
| T24.1-26 | P0 | 已入账仍显示待确认 | 支付通知自动记账后 | flush 成功只写日志，未回写本地 | `onFinanceOutcome` 回写 recognition/candidate | `PaymentRecognitionCoordinatorTest` | PASS | PASS（1.2.8） | PASS（1.2.8） | PASS PHYSICAL（用户确认支付同步 Finance 正常、pending 消失） | PASS PHYSICAL |
| T24.1-27 | P0 | Finance「通知待确认」为空 | 金额/方向未知的待确认项 | hint 只存本机，Web 看不到 | `task21_notification_pending_hints`（migration 0021）+ hints API + 两侧同一数据源 | `test_task21_hints_js.mjs`（11 组） | PASS（PR #56） | PASS | PASS（migration 已校验） | PASS PHYSICAL（1.2.8 用户验收） | PASS PHYSICAL |
| T24.1-29 | P0 | Android pending 与 Web 两套状态 | 真机 pending + Web `/finance` | 服务端无记录 | Android 幂等上传 hint；cold start/resume/待确认页拉取并回写 | hints 套件 + `PaymentRecognitionCoordinatorTest` | PASS | PASS | PASS | PASS PHYSICAL | PASS PHYSICAL |
| T24.1-30 | P0 | 微信无障碍读不到文本 | 微信交易详情页 | 微信不暴露无障碍文本 | `takeScreenshotOfWindow()/takeScreenshot()` + 本地 ML Kit OCR + 语义层；只补全已有 candidate；截图不落盘不上传 | `PaymentScreenshotOcrTest`（14 fixture） | PASS | PASS | PASS | PASS PHYSICAL（用户确认听写/语速/主题/更新/折叠正常） | PASS PHYSICAL（能力）/ 真机 OCR 效果以人工验收为准 |
| T24.1-28 | P1 | 通知历史显示 `com.tencent.mm` | 通知列表/详情 | 直接用 `sourcePackage` | `PaymentAppLabels` 统一 resolver（系统 label 优先） | `NotificationMediaHistoryTest`、`NotificationRepository` 回归 | PASS | PASS | PASS | PASS PHYSICAL（用户确认显示「微信」） | PASS PHYSICAL |
| T24.1-38 | P1 | Android/Web/D1 财务一致性 | 记账后对比 | 数据源曾分叉 | D1 唯一 source of truth + pending 统一 | finance/hints 套件 | PASS | PASS | PASS | PASS PHYSICAL（用户确认支付识别→记账→Android 财务可见） | PASS PHYSICAL |
| T24.1-39 | P0 | 分享下载时被要求输入并不存在的密码；CI Cloud-only job 卡死 45 分钟 | 打开文件传输分享页 → 点「下载」 | canonical 传输页的 `downloadShareFile` 无条件调用 `window.prompt`，公共分享也会弹出模态密码框；headless 浏览器无人应答 → 渲染进程主线程阻塞 → CDP 调用永不返回 | 只有 `share.password_required` 为真才弹窗；无密码分享直接授权下载；浏览器矩阵增加 JS 对话框自动应答、逐步进度日志与 5 分钟停顿看门狗（避免再次烧掉 45 分钟 CI 超时） | `test_static.py.test_one_canonical_file_transfer_implementation`（禁止无条件 prompt）、`test_tools_browser.mjs`（真实上传→分享→下载 SHA-256，含 `autoAnsweredDialogs` 统计） | PASS（PR #58 rerun） | PASS | PASS（1.2.8 + 修复随 1.2.9 前端发布） | PASS PHYSICAL（用户确认「我的→文件传输」上传/多选/配额正常；下载不再要求密码随 1.2.9 复验） | PASS AUTOMATED / 下载交互待复验 |

## Round 3（1.2.8 候选）其余条目

| ID | Severity | 用户现象 | 复现 | Root cause | 修复 | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-23 | P2 | 通知历史缺少截图缩略图等富内容 | 三星「屏幕截图已保存」 | 未读取/保存 `Notification` 暴露的 bitmap | Room v5 媒体模型 + 本机文件 + 详情页图片 + 收藏/已关联财务不参与清理 | `NotificationMediaHistoryTest` | PASS | PASS | PASS | PASS PHYSICAL（用户确认图片通知保存、撤回后仍保留） | PASS PHYSICAL |

## Round 2（1.2.7：真机验收失败项）

| ID | Severity | 用户现象 | 复现 | Root cause | 修复 | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-17 | P0 | 识别到支付但 Finance 0 笔（含招商银行 ¥50） | 真机银行/微信支付 → 财务 | 通道值 `bank`/`bank_sms` 不在服务端白名单 → 400 `payment_channel_invalid`；客户端把 400 当无效丢弃 | 通道规范为 `bank_card` + 服务端兼容 + 4xx 不再静默丢弃 | `test_task21_notification_js.mjs`、`test_static.py`、`NotificationCaptureCoordinatorTest` | PASS | PASS | PASS | PASS PHYSICAL（1.2.8 用户确认入账） | PASS PHYSICAL |
| T24.1-18 | P0 | 方向未知事件永远无法入账 | 微信「已收款 ¥10」 | 客户端上传 candidate → 服务端 400 → 丢弃 | 不完整提示改走 pending hint，补全后入账 | `NotificationCaptureCoordinatorTest`、hints 套件 | PASS | PASS | PASS | PASS PHYSICAL（pending 补全闭环） | PASS PHYSICAL |
| T24.1-19 | P0 | 撤回消息后历史正文消失 | 微信撤回 → 通知历史 | 历史只 JOIN 最新 revision | 历史改为逐条快照，删除按 revision | `NotificationStoreJvmTest`、`NotificationCaptureReliabilityTest` | PASS | PASS | PASS | PASS PHYSICAL（用户确认撤回历史正常） | PASS PHYSICAL |
| T24.1-20 | P1 | 桌面 Web 被折叠布局破坏 | 桌面 Chrome | 折叠控件在桌面也渲染 | `min-width:900px` 还原完整布局 | `test_app_browser.mjs` | PASS | PASS | PASS | PASS PHYSICAL（用户确认移动端折叠正常、桌面不受影响） | PASS PHYSICAL |
| T24.1-21 | P1 | 工具页与「我的」未完成折叠 | 390dp 手机 | 首轮只做 Finance + 学习 | 工具页紧凑两列；「我的」真实权限状态 + 折叠区 | 静态检查 + `test_app_browser.mjs` | PASS | PASS | PASS | PASS PHYSICAL（用户确认折叠 UI 正常） | PASS PHYSICAL |
| T24.1-22 | P1 | 微信交易页读不到金额 | 微信交易详情页 | 微信不暴露无障碍文本 | 诚实降级 + fixture 测试；Round 3 增 OCR fallback | `PaymentPageSemanticsFixtureTest`、`PaymentScreenshotOcrTest` | PASS | PASS | PASS | PASS PHYSICAL（失败闭环） | FIXED（自动读取仍受微信限制） |
| T24.1-24 | P1 | payee 文案被当成收入方向 | 支付宝付款成功页 | 「收款」关键词先命中 | 完成语优先 + 对账方标签剔除 | `PaymentPageSemanticsFixtureTest` | PASS | PASS | PASS | 1.2.8 验收未再报告 | FIXED / NOT PHYSICALLY VERIFIED |

## Round 1（历史条目，状态按后续真机结论修正）

| ID | 现象 | 级别 | Root cause / 修复 | 回归测试 | CI | Production | 真机 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-01 | 通知识别到支付，财务为空 | P0 | 通道 400 静默丢弃（见 T24.1-17） | `test_task21_notification_js.mjs`、`test_finance_js.mjs` | PASS | PASS | PASS PHYSICAL | 关闭 |
| T24.1-02 | Android 与 Web 财务不一致 | P0 | D1 唯一 source of truth + 客户端 repair | `test_task17_d1_js.mjs` | PASS | PASS | PASS PHYSICAL | 关闭 |
| T24.1-03 | 折叠只做了 Finance | P1 | 移动端信息层级统一（1.2.7 完成） | `test_app_browser.mjs` | PASS | PASS | PASS PHYSICAL | 关闭 |
| T24.1-04 | 通知延迟/漏记/崩溃 | P0 | 监听单线程写入 + 解析隔离 + 分类层 | `NotificationCaptureReliabilityTest`、`NotificationHubMainThreadTest` | PASS | PASS | PASS PHYSICAL（普通通知实时入库） | 关闭 |
| T24.1-05 | Clash 常驻通知导致闪烁/IO | P0 | ONGOING/PROGRESS/LIVE 不归档 + 数字抖动合并 | `NotificationClassificationTest`、`NotificationPipelineSplitTest` | PASS | PASS | PASS PHYSICAL（Clash 过滤正常） | 关闭 |
| T24.1-06 | 「等待确认记账」点开无变化 | P0 | 通知 action 创建 90 秒票据 + 待核实页面 | `PaymentRecognitionCoordinatorTest`、`PaymentVerificationGateTest` | PASS | PASS | PASS PHYSICAL | 关闭 |
| T24.1-07 | 权限中心底栏失效 | P0 | 底栏选择清理 overlay + 路由集中 | `AppNavigationTest`、`ShellNavigationTest`、`WebRoutePolicyTest` | PASS | PASS | PASS PHYSICAL（导航/返回键正常） | 关闭 |
| T24.1-08 | 英语发音/语速 | P1 | TTS 引擎复用 + 语速滑块 | `SpeechVoicePolicyTest`、`test_language_js.mjs` | PASS | PASS | PASS PHYSICAL（听写、语速用户确认） | 关闭 |
| T24.1-09 | App 内检查更新 | P1 | versionCode 比较 + SHA/大小校验 + Package Installer | `UpdateFlowTest`、`AppUpdatePolicyTest`、`check_android_release` | PASS | PASS | PASS PHYSICAL（用户确认 1.2.8 升级正常） | 关闭 |
| T24.1-10 | 通知历史无限增长/无收藏 | P1 | 收藏 + 7/30/90/365/永久 + Room v4 | `NotificationDatabaseMigrationTest`、`NotificationRetentionTest` | PASS | PASS | PASS PHYSICAL（收藏持久化用户确认） | 关闭 |
| T24.1-11 | 归档与支付识别耦合 | 架构 | 双流水线拆分 | `NotificationPipelineSplitTest` | PASS | PASS | 不适用 | 关闭 |
| T24.1-12 | 无障碍「已开启但无效」 | P0 | 主线程 Room 异常被吞；改内存门控 + worker | `PaymentAccessibilityServiceGateTest`、`PaymentVerificationGateTest` | PASS | PASS | PASS PHYSICAL（票据→门控→读取） | 关闭 |
| T24.1-13 | 微信页面无文本 | P0 | 降级 + OCR fallback | `PaymentRecognitionCoordinatorTest`、`PaymentScreenshotOcrTest` | PASS | PASS | PASS PHYSICAL（失败闭环） | 关闭（微信限制） |
| T24.1-14 | 通知显示包名 | P1 | `PaymentAppLabels` 统一 resolver | `PaymentVerificationGateTest` | PASS | PASS | PASS PHYSICAL（显示「微信」） | 关闭 |
| T24.1-15 | 通知/我的主题与网页不一致 | P1 | WebView 主题回传 Compose | `test_app_browser.mjs` | PASS | PASS | PASS PHYSICAL（Light/Dark 用户确认） | 关闭 |

## 仍未完成 / 待用户真机验收

1. 1.2.9 真机验收（本矩阵 Round 5）：
   - SM-S9360 连续截 3–5 张 → 通知历史中每张独立存在、图片可查看、重启后仍在；
   - Android 16「仅部分照片」状态下确认应用如实显示「图片内容不可用」而不是假成功；
   - 工具箱 → 文件传输与「我的 → 文件传输」进入同一页面、配额一致；
   - Clash 长跑不产生垃圾历史、页面不闪烁。
2. 设备状态：2026-09-12 用户手机与开发机不在同一地点，本轮不执行 ADB 真机验收；
   所有需要真机的项目保持 `PENDING USER PHYSICAL ACCEPTANCE`，不得写成 PASS。
3. Task 24.1 保持 **OPEN**：等 1.2.9 发布并由用户完成上述真机验收后才可宣布 COMPLETE；
   在此之前不得开始 Task 24.2 / Task 25。
