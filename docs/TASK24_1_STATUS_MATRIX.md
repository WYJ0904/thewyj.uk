# Task 24.1 状态矩阵（已知问题修复与真机闭环）

> **Round 2（真机验收失败后）**：2026-09-11 真机验收结论为
> `TASK 24.1 PHYSICAL ACCEPTANCE FAILED`。第一轮把「识别到支付 → Finance」标记为
> FIXED 是**错误**的：真机上仍然 0 笔。第二轮找到并修复了真正的 root cause（见下表
> T24.1-17/18），并把通知历史改为逐条快照（T24.1-19）。当前准确状态：
> `TASK 24.1 SOFTWARE FIXED / PHYSICAL ACCEPTANCE PENDING`，未宣布 COMPLETE。

状态取值（第二轮起）：`FAIL` / `FIXED / NOT PHYSICALLY VERIFIED` /
`PASS AUTOMATED` / `PASS PHYSICAL` / `BLOCKED`。

### Round 2 新增条目

| ID | Severity | 用户现象 | 复现 | Root cause | 修复 | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-17 | P0 | 识别到支付（含招商银行「识别到 ¥50.00，等待确认记账」）但 Finance 0 笔 | 真机任意银行/微信支付通知 → 财务 | Android 解析器输出 `payment_channel=bank` / `bank_sms`，服务端白名单只有 `bank_card` → `/api/notification/ingest` 返回 400 `payment_channel_invalid`；客户端把 400 当作「无效丢弃」删掉队列项，于是 UI 永远停在「等待同步」 | 通道改为规范值 `bank_card`；服务端兼容旧值；4xx 不再静默丢弃（保留 payload + 记录/展示原因，仅幂等 replay 丢弃） | `test_task21_notification_js.mjs`（bank 事件必须入账）、`test_static.py`（Android 通道 ⊆ 服务端白名单）、`NotificationCaptureCoordinatorTest`（400 保留 + 原因、409 幂等丢弃） | PASS | 1.2.7 | 1.2.7 | FAIL（1.2.6）→ 待用 1.2.7 复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-18 | P0 | 金额已识别但方向未知的事件永远无法入账 | 微信「已收款 ¥10」类无方向通知 | 客户端把它作为 `candidate` 上传，服务端 `structured_fields_required` 返回 400 → 同样被静默丢弃 | 方向未知/金额未知的提示不再上传，留在本机待用户补全方向后记账 | `NotificationCaptureCoordinatorTest.directionUnknownPaymentIsNeverUploaded` / `completePaymentIsUploaded` | PASS | 1.2.7 | 1.2.7 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-19 | P0 | 消息撤回后历史里对应内容偶发消失 | 微信消息被撤回 → 查看通知历史 | 历史查询只 JOIN 每个 instance 的 *最新* revision，撤回后的新 revision 覆盖显示，旧正文仍在库里但用户看不到 | 历史改为逐条快照（`JOIN notification_revisions`），删除按 revision 精确删除，撤回只更新元数据 | `NotificationStoreJvmTest.removedNotificationKeepsEverySavedSnapshot`、`NotificationCaptureReliabilityTest.updatingOneNotificationAndListsEverySnapshot` | PASS | 1.2.7 | 1.2.7 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-20 | P1 | 桌面 Web 也被做成折叠布局 | 桌面 Chrome 打开财务/学习 | 折叠控件（summary/chevron/边框）在所有宽度都渲染 | `min-width: 900px` 下隐藏 summary 并还原完整布局；手机端改为轻量分区标题（不再卡片套卡片） | `test_app_browser.mjs` 桌面/390px 布局断言 | PASS | 1.2.7 | 1.2.7 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-21 | P1 | 工具页与「我的」未完成折叠 | 390dp 手机 | 第一轮只做了 Finance + 学习部分 | 工具页手机端紧凑两列；「我的」页新增真实权限状态 + 「更新与高级」折叠区 | 静态检查 + 真机（待） | PASS | 1.2.7 | 1.2.7 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-22 | P1 | 微信交易详情页读不到金额 | 真机打开微信交易页 | 微信当前版本不向无障碍树暴露任何文本（`uiautomator dump` 也是 0 条文本） | 保持诚实降级：两次读取失败 → `VERIFICATION_FAILED` + 提示手动填写；新增确定性页面语义 fixture 测试 | `PaymentPageSemanticsFixtureTest`（含支付宝/银行页面、密码页、空页面、聊天页） | PASS | 1.2.7 | 1.2.7 | PASS PHYSICAL（失败闭环）；金额自动核实对微信 BLOCKED | BLOCKED（微信侧限制）/ 其余 FIXED |
| T24.1-23 | P2 | 通知历史缺少截图缩略图等富内容 | 三星「屏幕截图已保存」通知 | 未读取/保存 `Notification` 暴露的 bitmap | 未实现 | 无 | — | — | — | — | FAIL（本轮未完成） |
| T24.1-24 | P1 | payee 文案被当成收入方向 | 支付宝「付款成功 … 收款方 X」页 | `direction()` 先匹配「收款」关键词 | 明确完成语（付款成功/已支付…）优先；对账方标签（收款方/收款账户）先剔除再匹配 | `PaymentPageSemanticsFixtureTest.alipayStyleTransactionPageYieldsAmountAndDirection` | PASS | 1.2.7 | 1.2.7 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |

### Round 1 条目（保留，状态按第二轮结论修正）

### Round 3（1.2.8 候选）条目

| ID | Severity | 用户现象 | Reproduction | Root cause | Fix | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-25 | P0 | 截图/图片通知整条丢失 | 真机截图后查看通知历史 | 分类层 channel 关键词过宽（`status`/`media`/`sync` 等）命中 Samsung 截图类 channel → 判定 LIVE → **不写库**；且没有媒体模型 | channel 关键词收窄为 `progress/speed/traffic/vpn/proxy`；**带图片的通知永不按 LIVE 过滤**；新增媒体模型（Room v5 `mediaPath/mediaMime/mediaState`）+ 本地文件保存/清理 | `NotificationMediaHistoryTest`（空正文+图片仍入库、status channel 不再丢、媒体文件读写与删除、路径穿越拒绝）、`NotificationClassificationTest`（Clash/VPN 仍过滤） | 待 CI | 待 1.2.8 | 待 1.2.8 | FAIL(1.2.7) → 待 1.2.8 复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-26 | P0 | 已入账仍显示待确认（自动入账） | 支付通知自动记账后查看通知页 | flush 成功拿到 `transaction_id` 时只写日志，未回写本地 recognition/candidate → 本地一直 pending | flush 成功后调用 `PaymentRecognitionHook.onFinanceOutcome` → 通过 `uploadEventId` 定位识别并 `markFinanceRecorded` | `PaymentRecognitionCoordinatorTest`（upload 身份）+ 待补 flush 回路单测 | 待 CI | 待 1.2.8 | 待 1.2.8 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-27 | P0 | Finance「通知待确认」为空、通知页却有 pending | 有金额未知/方向未知的待确认项 | 这类 hint 原本只存本机（服务端 candidate 表有 `amount_minor > 0` CHECK），Web 端看不到 | 新增独立 `task21_notification_pending_hints`（migration 0021，纯新增）+ `POST/GET /api/notification/hints` + `confirm`/`ignore`；confirm 强制金额+方向并复用既有自动记账路径；Android 与 Web `/finance` 共用同一 pending 源 | `test_task21_hints_js.mjs`（11 组：不猜金额、重复 ingest、重复 confirm、ignore、不复活、边界、行数一致性） | PASS（PR #56 7/7） | PASS（1.2.8） | PASS（1.2.8，migration 0021 已应用并通过 row-count 校验） | 待人工真机验收 | FIXED / PENDING PHYSICAL |

### Round 4（1.2.8 正式发布）

| ID | Severity | 用户现象 | Reproduction | Root cause | Fix | Regression test | CI | Preview | Production | Physical device | Final status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-29 | P0 | Android pending 与 Web 财务两套状态 | 真机 pending + Web `/finance` | Android 只在本机保存待确认，服务端无记录 | Android 以稳定 `source_event_id` 幂等上传 hint；`PaymentHintSync` 在 cold start/resume/待确认页拉取并把 `confirmed→FINANCE_RECORDED+finance_entry_id`、`ignored→IGNORED` 写回；Web `/finance` 读取同一 hints API | hints 套件 + `PaymentRecognitionCoordinatorTest`（hint 路径、方向未知不上传 ingest） | PASS（PR #56） | PASS（1.2.8） | PASS（1.2.8） | 待人工真机验收 | FIXED / PENDING PHYSICAL |
| T24.1-30 | P0 | 微信交易页无障碍无文本 → 无法核实金额 | 真机打开微信交易页 | 微信不向无障碍树暴露文本 | `canTakeScreenshot=true` + `takeScreenshotOfWindow()/takeScreenshot()` + 本地 ML Kit OCR + 同一语义层；截图/OCR 仅本机、不落盘、不上传；只补全已有 candidate/hint；secure window/失败/多金额/价格页/聊天金额全部转人工确认 | `PaymentScreenshotOcrTest`（14 个 fixture：支付/转账/收款成功、聊天金额、商品价格、多金额、决定性标签、密码页、空页、OCR 数字误识、OCR 失败、重复核实、上下文门控、归一化） | PASS（PR #56） | PASS（1.2.8） | PASS（1.2.8） | 待人工真机验收（真机 OCR 效果须实测） | FIXED / PENDING PHYSICAL |
| T24.1-28 | P1 | 通知历史主标题显示 `com.tencent.mm` | 查看通知列表/详情 | 详情弹层直接用 `sourcePackage`；列表回退到包名 | `PaymentAppLabels` 升级为统一 resolver（系统 label → 支付类回退表 → 包名兜底），列表/详情/待确认页共用 | `NotificationMediaHistoryTest.appLabelsResolveToUserFacingNames`、`repositoryAppLabelNeverPrefersThePackageName` | 待 CI | 待 1.2.8 | 待 1.2.8 | 待复验 | FIXED / NOT PHYSICALLY VERIFIED |

状态取值：`OPEN` / `INVESTIGATING` / `FIXED` / `PASS` / `BLOCKED`。
真机一列只有实际在 SM-S9360 上验证过的才写 PASS，其余写 `PENDING USER PHYSICAL ACCEPTANCE`。

版本基线：Android `1.2.5 (8)` 已发布；本轮 `1.2.6 (9)` 为本矩阵中 T24.1-03/10/11 的修复版本。

| ID | 用户现象 | 级别 | 复现 | Root cause | 修复 | 回归测试 | CI | Preview | Production | 真机 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-01 | 通知识别到支付金额，财务仍为空 | P0 | 微信支付通知 → 财务 | ① 自动记账只写 `raw_event` 变更（已修）② 银行通道被 400 拒绝且被静默丢弃（Round 2 修复，T24.1-17） | 变更流 + 客户端 repair + 通道规范化 + 不再静默丢弃 | `test_task21_notification_js.mjs`、`test_finance_js.mjs`、`NotificationCaptureCoordinatorTest` | PASS | 1.2.7 | 1.2.7 | FAIL(1.2.6) → 待 1.2.7 复验 | FIXED / NOT PHYSICALLY VERIFIED |
| T24.1-02 | Android 与 Web 财务不一致 | P0 | Android 记账后 Web 查看 | 同上（变更流缺失）+ 客户端仅首次 hydrated | 同上；D1 为唯一 source of truth，客户端 repair 全量补齐 | 同上 + `test_task17_d1_js.mjs` | PASS | 已部署 | 已部署 | 待用户真机验收 | FIXED |
| T24.1-03 | 只有 Finance 完成 Accordion | P1 | 390×844 打开学习/财务/通知/我的 | 移动端页面把所有设置堆在首屏 | 财务筛选/统计（1.2.5）+ 语言学习「智能选词 / 本轮统计」（1.2.6）改为手机端默认收起；工具/通知/我的原生分组 | `test_app_browser.mjs` 390px 布局检查、`data-responsive-collapse` 静态检查 | PASS | 待部署 | 待部署 | 待用户真机验收 | FIXED(部分) |
| T24.1-04 | 通知延迟、漏记、崩溃、状态不一致 | P0 | 真机持续使用通知页 | 通知在主线程序列化写入 + 解析器异常传播；R3 已修崩溃 | 监听服务单线程写入、立即落库、解析隔离；本轮补分类层 | `NotificationCaptureReliabilityTest`、`NotificationHubMainThreadTest` | PASS | 已部署 | 已部署 | 待用户真机验收 | FIXED |
| T24.1-05 | 常驻通知（Clash 网速）导致通知页闪烁、IO 增长 | P0 | Clash 每秒刷新状态通知 | 所有通知（含 ongoing）都写 Room，每次写库触发 UI 重组 | 新增 `NotificationClassification`：ONGOING/PROGRESS/LIVE 默认不归档；第二层数字抖动合并 | `NotificationClassificationTest`、`NotificationPipelineSplitTest`、`NotificationCaptureReliabilityTest` | PASS | 待部署 | 待部署 | 待用户真机验收 | FIXED |
| T24.1-06 | 「等待确认记账」点开后无任何变化 | P0 | 点通知 action 或进 App | action 只打开 `/finance`，未创建 90 秒票据；本地待核实无 UI | 通知 action 真正创建票据 + 原生「待核实 / 待确认交易」页面 + 归属硬约束 | `PaymentRecognitionCoordinatorTest`、`PaymentVerificationGateTest` | PASS | 已部署(1.2.5) | 已部署(1.2.5) | 票据/失败闭环真机 PASS；真实金额核实待用户验收 | FIXED |
| T24.1-07 | 权限中心底部导航失效、偶发跳错页 | P0 | 进入权限中心后点底栏 | `bottomNavigationSelection` 未清理 overlay + 路由竞态 | 统一底栏选择清除 overlay、路由决策集中 | `AppNavigationTest`、`ShellNavigationTest`、`WebRoutePolicyTest` | PASS | 已部署 | 已部署 | 待用户真机验收 | FIXED |
| T24.1-08 | 英语发音错误 / 播放卡顿；需要语速滑块 | P1 | 听写播放 | TTS 引擎重复初始化与语言配置错误（R3 修复） | 复用引擎、按语言 voice、`#speechRateSlider` 0.5–1.5 实时生效并按语言保存 | `SpeechVoicePolicyTest`、`test_language_js.mjs` | PASS | 已部署 | 已部署 | 待用户真机验收 | FIXED |
| T24.1-09 | App 内「检查更新」必须真可用 | P1 | 我的 → 检查更新 | 早期仅跳转链接 | versionCode 比较 + SHA/大小校验 + 损坏重下 + Package Installer | `UpdateFlowTest`、`AppUpdatePolicyTest`、`tests/check_android_release` | PASS | 待部署 | 1.2.5 已可被 1.2.4 发现 | 待用户真机验收 | FIXED |
| T24.1-10 | 通知历史无限增长；无收藏/期限选项 | P1 | 长期使用 | retention 只清理 removed 且未关联财务的记录；无收藏 | 收藏标记（非删除）+ 7/30/90/365/永久 + 占用显示 + Room v4 迁移 | `NotificationDatabaseMigrationTest`（v3→v4）、`test_static.py` | PASS | 待部署 | 待部署 | 待用户真机验收 | FIXED |
| T24.1-11 | 通知保存与支付识别混成一条逻辑 | 架构 | 代码审计 | 归档与识别在同一分支里互相影响 | 拆成 `NotificationArchivePipeline` / `PaymentRecognitionPipeline`，同一原始事件两路独立消费；财务权益不依赖通知保存权益 | `NotificationPipelineSplitTest` | PASS | 待部署 | 待部署 | 不适用（结构） | FIXED |
| T24.1-12 | 无障碍「已开启但无效」 | P0 | 真机开启无障碍 | 服务在主线程查 Room 抛异常被吞，永远 `no_active_ticket` | 主线程只做内存门控+取文本，数据库/解析下放 worker；票据包缓存与节流 | `PaymentAccessibilityServiceGateTest`、`PaymentVerificationGateTest` | PASS | 已部署(1.2.5) | 已部署(1.2.5) | 票据→门控→页面读取真机 PASS | FIXED |
| T24.1-13 | 微信交易页无文本，自动核实读不到金额 | P0 | 微信支付后核实 | 微信 UI 不向无障碍树暴露文本 | 窗口回退 + 两次失败进入 `VERIFICATION_FAILED` 并提示手动填写；不虚构金额 | `PaymentRecognitionCoordinatorTest`（miss 路径） | PASS | 已部署(1.2.5) | 已部署(1.2.5) | 真机 PASS（失败闭环） | FIXED(设计限制) |
| T24.1-14 | 通知显示「该应用」/包名 | P1 | 支付通知 | 未解析应用名 + 双开场景 PackageManager 失败 | `PaymentAppLabels` 统一解析（系统名优先，支付类回退表） | `PaymentVerificationGateTest` | PASS | 已部署(1.2.5) | 已部署(1.2.5) | 真机显示「微信」PASS | FIXED |
| T24.1-15 | 网页浅色而通知/我的固定深色 | P1 | 切换主题 | 启动时的主题未被原生读取 | WebView `onPageFinished` 读取 `documentElement.dataset.theme` 并回传 Compose | `test_app_browser.mjs` 主题断言 | PASS | 已部署(1.2.5) | 已部署(1.2.5) | 待用户真机验收 | FIXED |

## 仍未完成 / 待用户真机验收

以下项目在 Task 24.1 内**未完成**，不计入 FIXED：

1. 工具页与原生「我的」页的移动端折叠分组（T24.1-03 的剩余部分）。
2. 真机专项：真实支付 → 自动记账 → Web `/finance` 一致；通知撤回/删除后历史仍在；Clash 长跑不闪烁；覆盖升级 1.2.4→1.2.6 保留登录/Room/财务队列；TTS 出声与语速；导航与返回键；App 内更新完整链路。
3. 真机复验时的设备状态：SM-S9360 在 1.2.5 发布后被断开（`adb devices` 无设备），因此 1.2.6 的真机验证需在用户重新连接后执行。
