# Aeris D-02：Compose QA 的 WebView 后台线程异常调查

日期：2026-10-18，Asia/Hong_Kong。

**D-02：CLOSED / TEST-HARNESS-ONLY。根因：CONFIRMED（最小受控对照）。产品代码修改 0。D-01 保持 CLOSED。**

早期 QA 使用 Compose UI Test 默认的 Unconfined 效果调度，三次 IO 挂起返回后，continuation 可在 IO worker 直接继续，随后调用产品 `publishPaymentLedger` 中的 `WebView.getUrl()`。这违反该 WebView 的主线程约束。相同序列不包含产品页面时仍 30/30 复现；普通 Android composition 和显式 Standard 测试调度各 30/30 成功。真实产品 WebView 在显式调度及正确推进测试时钟时，30 次新 publication 成功。

修正限于 QA：显式 `StandardTestDispatcher`，并以 Compose `waitUntil` 推进 UI 测试时钟来等待真实 IO/Chromium。原先阻塞的 `awaitJs` 在只改变调度器后产生过真实 20 秒超时，该失败完整保留。没有增加原断言超时、删除断言、升级库或修改产品来适应测试。

**剩余真实门禁全部 NOT TESTED；真实微信 0/10。** 本文和验收矩阵不授权真实交易、正式包安装/启动、真实通知/私人数据读取、云端生产操作、合并或发布。

## 1. 基线与独立工作树

已复核 AGENTS.md、docs/WINDOWS_WORKSPACE.md、WORKSPACE_MIGRATION_REPORT.md、PAUSED_DEVELOPMENT_HANDOFF.md、Aeris 前序调查/实施/设备验收报告及 `AERIS_D01_LIFECYCLE_RCA.md`。本轮专项授权只恢复 D-02 调查、隔离 QA 修正和合成验证；其他暂停范围继续有效。

| 项目 | 本轮基线 |
| --- | --- |
| D-01 | `57b622e40e22573ec652f4dfa21e8cd62b36c0e6`，CLOSED / TEST-HARNESS-ONLY |
| 新 managed worktree | `%USERPROFILE%/.codex/worktrees/aeris-d02-webview-thread/thewyj.uk` |
| 新分支 | `codex/aeris-d02-webview-thread`，直接继承 57b622e，无 cherry-pick/merge |
| 产品版本 | 沿用 f6a2ec7 的产品内容；未从旧 e2febc6 套补丁 |
| 单一设备 | Samsung SM-S9360，Android 16 / API 36，指定序列尾号 EHJN |
| 新目标/测试包 | `uk.thewyj.app.qa.d02` / `uk.thewyj.app.qa.d02.test`，初始只读基线均不存在 |
| 网络 | `https://127.0.0.1:18787`，本轮独立 TLS 夹具与 reverse，真实后端访问 0 |
| 测试库 | 实际依赖分析：Compose UI Test / JUnit4 Android 1.10.4；未升级 BOM、coroutines 或 AndroidX |

全组公开设备 fingerprint 前后相同；结束时只读 WebView provider 为 `com.google.android.webview / 155.0.8059.43`。本轮未在每轮采集 provider 版本，不宣称逐轮连续监控其更新状态。各对照使用同一 APK 内的同一最小组件；仅测试规则/调度上下文不同。

保留 D-01 的同 UID ActivityScenario 辅助 Activity 修正和 `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES` Runner；QA manifest 不包含正式 MainActivity、通知监听、支付无障碍或短信接收器。QA Room/凭据只属于新包及合成账户。

原始材料属于 ignored 证据，不能假定已在 Git 中。本轮先建立受保护 SHA-256 清单，再复制早期 Compose 源、完整异常日志和相关构建/初次 Runner 错误材料到 `docs/migration-evidence/d02/phase3-originals/`。非秘密旧测试源码纳入 `qa/aeris/d02/legacy/`，SHA-256 为 `1aee83a27b55964326ac0c9223a1dcde6612e4b0f333d3a26e646426910e37be`；原件未修改。

下文本地证据路径均相对于 `docs/migration-evidence/d02/`。私钥、APK、原始设备输出和临时构建继续 ignored。

## 2. 原始异常及本轮复现

原 `device-T01-compose-synchronized.log` 的实际失败为：

```text
A WebView method was called on thread 'DefaultDispatcher-worker-2'
Expected Looper: main; actual Looper: null
WebView.checkThread → WebView.getUrl
→ ThewyjWebViewKt.publishPaymentLedger(ThewyjWebView.kt:208)
→ ApplyingContinuationInterceptor$SendApplyContinuation.resumeWith(:52)
→ FrameDeferringContinuationInterceptor$FrameDeferredContinuation.resumeWith(:187)
→ DispatchedCoroutine.afterResume → LimitedDispatcher$Worker
```

这段为定位摘要，**完整原始 Throwable 和 cause** 在保留的原日志中。它确实由产品 `getUrl()` 抛出，而非单纯由测试断言读取 URL 抛出；仅凭这一点仍不足以认定产品正常运行时主动把 WebView 送到后台。

本轮 `default-unconfined-minimal-30` 在完全不含 PaymentVerificationScreen、Room 或产品 WebView 的最小 Activity 中复现同一 `checkThread/getUrl → Applying(:52) → FrameDeferring(:187) → IO worker` 栈。每轮保存 round、UTC、elapsed、thread、tid、Looper、continuation interceptor、WebView 操作和完整 exception stack，位于该组 `d02-evidence/<new-session>/rounds.ndjson`。

实际产品默认 Compose 组 `current-product-default-compose` 与原始 T01 的隔离重放 `original-compose-t01-default` 也均取得真实失败 JUnit，并保留产品 `publishPaymentLedger:208` 的完整栈。没有把有意负向试验改标 PASS。

## 3. 因果链与框架行为

1. 产品 `publishPaymentLedger` 从 `LaunchedEffect` 或 `rememberCoroutineScope` 启动，依次 `withContext(Dispatchers.IO)` 读取请求账户、本地 snapshot、当前账户，再读取 visibility/URL 并 evaluateJavascript。源码中没有在 IO block 内主动读写 WebView。
2. 当前实际 1.10.4 测试环境在没有自定义 TestDispatcher 时选择 `UnconfinedTestDispatcher`，并外包 Applying / FrameDeferring interceptor。FrameDeferring 在 parent dispatcher 不需要 dispatch 时直接恢复 continuation；Unconfined 不绑定 UI 线程。该行为与本轮 worker/Looper=null 的实测对应，不是看到 interceptor 名字就猜测。[准确版本官方 ui-test 源码制品](https://dl.google.com/dl/android/maven2/androidx/compose/ui/ui-test-android/1.10.4/ui-test-android-1.10.4-sources.jar)，[Unconfined 官方语义](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/kotlinx.coroutines.test/-unconfined-test-dispatcher.html)。
3. 普通 Activity 没有 Compose 测试规则接管 recomposer，三次 IO 返回后继续由 AndroidUiDispatcher 回到主线程。同一最小组件 30/30 成功。
4. 显式 StandardTestDispatcher 将返回任务排入 scheduler；该版本的 `AbstractMainTestClock` 通过 `runOnUiThread` 执行 runCurrent/advance。30/30 的 IO 后线程实测均为 main。**Standard 本身不是 UI Dispatcher**，安全性还依赖 Compose 在 UI 线程推进 scheduler；不能由 instrumentation 线程自行调用 scheduler.runCurrent。[准确版本官方 JUnit4 源码制品](https://dl.google.com/dl/android/maven2/androidx/compose/ui/ui-test-junit4-android/1.10.4/ui-test-junit4-android-1.10.4-sources.jar)，[Standard 官方语义](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/kotlinx.coroutines.test/-standard-test-dispatcher.html)。
5. 原宿主 `awaitJs` 用阻塞 sleep/轮询等待 Chromium。只换 Standard 后，外部 IO 完成所排入的任务没有得到时钟推进，因此原 T01 在 20 秒内等不到新 snapshot。`original-compose-t01-standard` 的 JUnit FAIL/timeout 证明该中间版本仍不完整；显式调度与带时钟推进的等待必须配套。

官方源码按版本下载并保存 SHA-256：ui-test 为 `7bf08c206d0d96b4df7320ae6a0cf0af7b11c88bcf173fa9df66bc387bbe768c`；ui-test-junit4 为 `a1c9c9e84c25b2280a46414aeb3a171137ca43f3c3e031df114772d509ba1bb1`。提取文件和依赖分析在 `framework-sources/`、`build-final-controls.log`，没有以仓库最新源码替代实际运行版本。

## 4. 责任划分与最小 QA 修正

| 对象 | 证据结论 |
| --- | --- |
| 早期 QA 默认规则 | **CONFIRMED**：选择了不保 UI 线程的效果调度；IO 返回直接触发 getUrl 后台访问；最小组件不含产品也可复现 |
| 旧 QA 阻塞 JS 等待 | **CONFIRMED**：显式 Standard 之后未推进测试时钟；规则单改版真实超时，最终等待驱动配套修正 |
| 产品调用点 | getUrl 实际位于产品代码；正常 Android composition 下未复现本故障。无证据支持产品回归，不修改产品 |
| Android WebView | 正常执行所有者线程检查；不是通过禁用检查得到 PASS。[官方 WebView 线程约束](https://developer.android.com/reference/android/webkit/WebView#getUrl()) |
| Samsung / 图形栈 | 本轮不归因驱动或 D-01 Freecess；本故障是 continuation 线程错误，有直接最小对照，未改任何系统策略 |

原 Compose QA 的核心修正如下；精确变换差异保存在 `qa-fix-exact.diff`：

```kotlin
createAndroidComposeRule<StateAcceptanceActivity>(effectContext = StandardTestDispatcher())
private fun awaitJs(condition: String, timeoutMs: Long = 20_000) {
    compose.waitUntil(timeoutMs) { a.eval("Boolean($condition)") == "true" }
}
```

生成器保留三个独立版本：Default 原规则、Standard 仅换调度器的中间失败版、StandardPumped 最终配套版；类名和包名只为隔离。业务 assert、条件字符串和 20s 默认/显式 30s 等待预算保持不变。StandardPumped 其他未执行的旧 Compose 方法只算已编译，不能因 T01 成功就标全类 PASS。

没有改产品 PublicationGate、账户/请求代际、生命周期 gate、outbox、金额/完成确认策略、90 秒票据期限、RC-1 至 RC-6 或正式 Gradle/签名/版本。

## 5. UI 线程审查与实际覆盖

| 调用路径 | 审查 / 实测 |
| --- | --- |
| 创建、settings、AndroidView 挂载、DisposableEffect destroy | 产品在 composition/UI 上创建和清理；最小对照最终 destroy 均记录 main。未通过关闭硬件加速避开清理 |
| LaunchedEffect 导航、reload、onPause/onResume、active JS、返回操作 | 来源为 composition 上下文；普通/正确调度 QA 保持 UI；默认 Unconfined 正是非法替换该线程语义的条件 |
| publication 三次 IO 后 getUrl/evaluateJavascript | 最小普通/Standard 各 30 轮共 242 次受检查 WebView 调用均 main；默认组 30 次 getUrl 均 off-main；真实产品 30 次必须出现新 publication 并保持账户匹配 |
| WebViewClient、WebChromeClient、ActivityResult | 常规 UI callback 中的读写按调用来源审查；下载异步状态显式通过 `downloadView.post` 回 UI |
| QA eval/URL 观察 | `runOnUiThread` / `runOnMainSync` / `compose.runOnIdle`；没有将测试线程直接读取 WebView 当成产品异常 |
| awaitViewport 取消、文件选择/下载/语音及外部路由全部边界 | 静态复核调用环境；本轮未逐项真实执行，动态结果 **NOT TESTED** |

以上是有限路径的源码与运行证据，不是对所有未来调度、所有 Android 版本或整个正式 App 的形式证明。真实 MainActivity、真实网络恢复、私人文件/下载和正式会话均未执行。没有把静态调用约定等同于无限范围动态 PASS。

## 6. 执行结果及失败保留

| 组 | 实际执行 | 成功 / 失败 | 证据与边界 |
| --- | ---: | --- | --- |
| 初次 collector | 0 测试 | 基础设施失败 | PowerShell 空数组产生 scalar、两个包名连接；两包已独立验证/安装；记录原 ledger，修正数组后才开始 instrumentation |
| 最小普通 Activity 初版 | 30 轮，1 JUnit | 0 / 30 轮错误，JUnit FAIL | 全部 IO 后仍 main；漏启 JS 导致脚本值断言失败，不算 D-02 getUrl 复现；v1 APK 与原记录保留 |
| 普通 Activity 正确内联页面 | 30 轮，1 JUnit | 30 / 0，PASS | 121 次 WebView 操作 main（包含最终 destroy），三次 IO 返回均 main |
| Default Compose 最小负向 | 30 轮，1 JUnit | 0 / 30，FAIL | 每轮 getUrl 在 worker、Looper=null，完整异常；destroy 在 main |
| Standard Compose 最小修正 | 30 轮，1 JUnit | 30 / 0，PASS | 同页面/IO/断言，121 次操作 main |
| 当前产品 + Default Compose | 1 JUnit | 0 / 1，FAIL | 实际 publishPaymentLedger:208 相同异常 |
| 原始 Compose T01 默认规则重放 | 1 JUnit | 0 / 1，FAIL | 原业务断言及完整失败栈，独立 QA 包 |
| 原始 Compose T01 仅换 Standard | 1 JUnit | 0 / 1，FAIL | 原 awaitJs 20s 超时；未隐藏这个不完整中间版本 |
| 当前产品 + Standard / 正确时钟等待 | 30 次新 publication，1 JUnit | 30 / 0，PASS | 每轮都要求 publicationAfter > before、账户匹配及 UI URL 可读 |
| 原始 Compose T01 + StandardPumped | 1 JUnit | 1 / 0，PASS | 最终包原业务断言全部保留；完整 JUnit 3.693s，含 teardown |
| D-01 普通宿主的原 T01–T16 | 16 JUnit | 16 / 0，PASS | 连续 JUnit 130.808s；T11/T15/T16 teardown 完成；不是旧 Compose 全类通过 |

合计实际 **25 个 JUnit case：20 PASS、5 FAIL、0 SKIP**，另有 1 次 instrumentation 开始前的 collector 失败。5 个 FAIL 分别为初版 JS 配置遗漏、最小默认规则、当前产品默认规则、原 T01 默认规则、只改调度器的旧等待；全部保留。三个 30 轮最小组和一个 30 次 publication 组各只是一个 JUnit case，不把迭代伪装成独立用例。

最小普通 / 默认 / Standard 每轮 beforeIO→complete 的中位耗时分别为 28 / 26 / 48ms，最大为 31 / 29 / 54ms；仅用于受控序列时序，不是正式 App 性能结论。原矩阵 T12 `realElapsedMs=91594`、expiryUnchanged=true、30s 后补拉数与到期时均为 6；真实 90 秒没有被虚拟时钟或延长票据替代。完整逐 case 耗时和指标在 `verification-summary.json`。

v2 APK 执行最小对照，v3 执行真实 publication/负向/16 项普通矩阵，final 执行配套修正版原 Compose T01。三者 target APK 字节完全相同；测试 APK 分别包含当时诊断类。最终新增 StandardPumped 后未重新运行完整普通矩阵，未把其 v3 运行误标为 final 测试 APK 的全量执行。各版 APK、v2/v3 诊断源码与最终生成器均保留；初版 v1 只保存 APK/日志，没有事先单独归档该版最小组件源码，不声称历史源码快照完全齐全。

首次 collector 将以前自己的 session 目录也复制进当前批次。原始副本完整保留；统计使用当前新建时间戳 session，不把旧失败/成功累计重算。随后 collector 改为比较运行前后 entry，仅复制新 session。每组完整 stdout、JUnit、before/after 服务核验和设备自有诊断均保留。

本轮没有重跑原 607 项开发环境套件：它们是 D-01 已验证基线；**D-02 当轮 607：NOT TESTED**。产品源码未改，本轮执行专门 QA 对照、实际 WebView publication、组件回归和 QA Lint/Debug 构建，不把历史 607 复制为本轮新 PASS。远端 CI、Hosted Preview、Production、真实通知/支付和正式三页均 NOT TESTED。

## 7. 改动、构建及隔离

新增仅为本报告、剩余验收矩阵和 `qa/aeris/d02/`。其中包含最小组件、对照与产品回归测试、原 Compose 非秘密模板、可重建准备脚本、包名/签名/所有权安装保护、只读快照、独立 watchdog 与证据汇总。D-01 目录、报告和提交保持原样。

Debug 目标/AndroidTest 初版、内联页面纠正版本、原始 Compose 对照及最终配套版本均构建成功；最终 QA Lint 为 **84 Warning、12 Hint、0 Error/Fatal**。最小组件使用局部 SetJavaScriptEnabled 注解来启用自己的内联合成 JS；未关闭全局 Lint 门禁、线程检查或失败断言。Python 准备/保护/控制/汇总脚本语法编译通过；仓库审计通过（871 个 tracked/candidate 文件）。证据为 `build-first.log`、`build-minimal-doc-correction.log`、`build-final-controls.log`、`build-final-pumped.log`、`lint-final.xml`。

初始保护快照：固定主工作区 829 文件、原修复树 840、Task26 826、D-01 树 859、D-01 control 829、原第三阶段证据 140、D-01 原始/归档输入 870。D-01 的 rebuildable Gradle build-* 目录不计入原始证据集合；所有 runs、归档 APK、源码/夹具、报告输入和结果保留。

正式 APK 初始 SHA-256 为 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`。仅读取公开包/权限/服务元数据及 APK 哈希；正式数据库、Cookies、凭据、真实通知正文和交易未读取，私有数据字节一致性 **NOT MEASURED**。

最终 `protected-final.json` 与前置清单比较：上述七组文件均 **0 新增、0 缺失、0 内容变化**；五个受保护源码 checkout 的 HEAD/branch/status 均相同。D-01 的提交、报告、870 个原始/归档证据及第三阶段 140 个原始输入全部保留。共享 Git 仅增加授权的新 worktree/分支/本地提交元数据，不声称整个 .git 字节不变。

`device-protection.json` 全部公开保护项相同：正式 APK 哈希、元数据/权限 grants、无障碍/通知监听启用集合、standby bucket、后台 app-op、build/model/API，以及旧 QA、D-01 四包的元数据/权限。21 次逐批离散检查均 formalBound=true、没有启用 D-02 QA 采集服务；不是持续毫秒级监测。

本轮只有新 D-02 两包被安装/同签名 `-r` 更新与受控 force-stop；没有卸载、清数据或停止正式/旧 QA 包。所有测试都取得完整 JUnit 结尾，watchdog 触发 0 次。收尾仅停止 D-02 两包和唯一确认的自有 loopback Node fixture，保留 QA 数据，仅移除自身 18787 reverse；端口无监听、reverse 恢复为空。结束为 Awake/keyguard=false。原设备从 AOD 由所有者正常解锁，因此不声称屏幕状态与开始逐项相同。

所有版本 APK SHA 在 `verification-summary.json`；最终 target/test 分别为 `c3a28f366f80765c71cc74919cced6cb89a9602c3628441246f604110233b674` / `f4b3dba3e792ce8c25ac50f9b7461de595afb3ba596801816ef2ca063edf33be`。所有安装都验证相同隔离 Debug 公钥证书 `9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac`，未提供正式签名材料。原始 device before/after、cleanup、fixture-process/stopped 和各失败材料均保留。

开始设备为 AOD/keyguard=true，所有者按正常流程确认解锁；工具未写锁屏或 Extend Unlock 设置、未输入凭据。本轮没有物理息屏测试，不能把这次正常解锁记作息屏回归 PASS。

## 8. 下一阶段与停止点

可执行但尚未授权的真实业务方案见 `ANDROID_HOTFIX_REMAINING_ACCEPTANCE_MATRIX.md`：七项门禁均含前提、步骤、预期、失败判据、证据，另列 W01–W10 十次独立事件计划和具体授权清单。

正式候选整合/安装、真实系统采集权限、专用云账户和限定数据读写、真实微信事件、正式三页、MainActivity 会 flush 的启动/网络操作、完整后台/息屏链路及真实数据截图均待所有者分别授权。特别是正式 MainActivity 的“打开/刷新”和 pending-summary GET 可能处理 outbox 或触发服务器 reconciliation，不能伪装成无写入检查。

本轮限于 **D-02 的 QA 根因、隔离合成修正与剩余验收准备**。D-01 仍 CLOSED，Task26 标签不变，财务 AI 不启动；不推送、不合并、不发布，完成交付后停止等待审核。
