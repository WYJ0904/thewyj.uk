# Task 24.1 状态矩阵（已知问题修复与真机闭环）

状态取值：`OPEN` / `INVESTIGATING` / `FIXED` / `PASS` / `BLOCKED`。
真机一列只有实际在 SM-S9360 上验证过的才写 PASS，其余写 `PENDING USER PHYSICAL ACCEPTANCE`。

版本基线：Android `1.2.5 (8)` 已发布；本轮 `1.2.6 (9)` 为本矩阵中 T24.1-03/10/11 的修复版本。

| ID | 用户现象 | 级别 | 复现 | Root cause | 修复 | 回归测试 | CI | Preview | Production | 真机 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T24.1-01 | 通知识别到支付金额，财务仍为空 | P0 | 微信支付通知 → 财务 | 自动记账只写 `raw_event` 变更，客户端只投影 `transaction`；已 hydrated 账本永不更新 | `task21-service.mjs` 发布 `transaction` 变更 + 客户端每次同步执行 bootstrap 全量修复 | `test_task21_notification_js.mjs`（变更流断言）、`test_finance_js.mjs`（变更投影 + 自动账目可见） | PASS | 已随 1.2.5/1.2.6 部署 | 1.2.5 已上线，`/api/app/config` 返回 1.2.6 | 财务列表已显示自动账目（QA 构建）；真实支付 → 记账待用户验收 | FIXED / PASS(软件) |
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
