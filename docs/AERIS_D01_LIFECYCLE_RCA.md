# Aeris D-01 生命周期根因与回归报告

日期：2026-10-18，Asia/Hong_Kong。

**最终状态：TEST-HARNESS-ONLY。根因：CONFIRMED（本轮受控复现与反向对照）。D-01 专项关闭；产品代码修改 0。**

故障来自 QA 宿主与 Samsung Freecess 的交互：ActivityScenario 将辅助 EmptyActivity 放在独立测试 APK/UID；目标 QA 应用进入后台后被 Freecess 冻结，承载测试与生命周期调度的进程无法继续工作。将既有 AndroidX Test Core 同时作为 QA 目标包的 Debug 依赖，使辅助 Activity 按测试库原有的 target-first 规则在目标 QA 进程运行，消除了这个触发条件。没有改手机冻结策略、硬件加速或产品生命周期实现。

关闭依据包含：普通 Activity 和旧产品基线对照、相同 QA 源码的撤回/恢复对照、12 组各 30 轮共 **360/360** 成功、原 T11/T15/T16 各 30 次连续断言及 teardown、完整 T01–T16 合成真机矩阵 **16/16 PASS**，以及受控真实息屏/亮屏恢复。最初失败、受控反向失败和一次锁屏未就绪失败均保留，没有被后续 PASS 覆盖。

**这不关闭整个 Android Hotfix。真实微信 0/10、真实通知采集、RC-6、真实云同步及正式 App 端到端仍为独立门禁。未推送、合并、发布或进入生产集成。**

## 1. 基线、授权和证据保存

已读取 AGENTS.md、docs/WINDOWS_WORKSPACE.md、WORKSPACE_MIGRATION_REPORT.md、PAUSED_DEVELOPMENT_HANDOFF.md、第二阶段实施报告、第三阶段验收报告，以及第三阶段全部相关原始矩阵/T11/T15/T16 日志、三条自身线程采样、最终与早期 Compose QA 测试、Runner、manifest、Gradle overlay 和 HTTPS 夹具。根目录没有独立的 WINDOWS_WORKSPACE.md，实际文档位于 docs/。

本轮 D-01 专项授权覆盖暂停交接中针对本专项继续工作的限制；发布、财务 AI 和真实交易验收继续暂停。

| 对象 | 实际状态 |
| --- | --- |
| D-01 工作树 | `%USERPROFILE%/.codex/worktrees/aeris-d01-lifecycle/thewyj.uk` |
| 分支 / 产品基线 | `codex/aeris-d01-lifecycle` / `f6a2ec787f47468b6c0565141a1e4d82cd41330b` |
| 完整继承链 | `e2febc6 → 94f517792edd11bb4c4c744057717df472544626 → 9ff7a7fea6788505ba12014ea37bd86f4187b1bb → f6a2ec7` |
| 未修复产品对照 | managed `aeris-d01-control/thewyj.uk`，detached `94f5177` |
| 原修复树 | `aeris-state-consistency/thewyj.uk` / `codex/aeris-state-consistency` / `f6a2ec7`，包括原未提交验收报告完整保留 |
| 固定主工作区 | `codex/android-accessibility-accounting-hotfix` / `e2febc6d9a33997bd9dc4cb042ecff216d31fde4`，原 WIP 保留 |
| Task 26 | `codex/task26-wrong-review` / `6247c4148904cafa264204fc1816b2e8e1d4360a`，未启动或改门禁 |

两个新工作树均通过 managed worktree 工具创建，分别用于专项隔离与旧产品对照，没有从 e2febc6 直接套补丁。

第三阶段 QA 宿主确实属于 ignored 输入，不在 f6a2ec7 提交中。先对原第三阶段 **140 个文件**建立 SHA-256 清单，再复制所需 13 个宿主文件、原始日志及最终设备证据到本轮 ignored 目录。为使修正可审阅和重建，另将 10 个不含私钥的宿主源码/夹具模板纳入 `qa/aeris/d01/host/`；新准备脚本在 ignored 输出目录生成独立 TLS 密钥，不提交既有或新私钥。

本轮原始证据统一位于 `docs/migration-evidence/d01/`。下文证据路径均相对此目录，原第三阶段证据副本位于 `phase3-originals/`，原件未改。

## 2. 设备与环境一致性

唯一指定设备为 Samsung SM-S9360，序列号尾号 EHJN，Android 16 / API 36；实际测试再次断言 Build.MODEL 和 SDK。前后 build fingerprint 相同：`samsung/pa2qzcx/pa2q:16/BP4A.251205.006/S9360ZCSDCZI1_CHCDCZI1:user/release-keys`。

两侧使用同一 Windows JDK/SDK、Gradle 9.4.1、AGP 9.2.1、锁定 AndroidX 依赖、Debug 证书、minSdk30/targetSdk36，以及 `https://127.0.0.1:18787` 合成 HTTPS 服务。没有升级依赖版本、提供正式签名环境值或改正式版本元数据。

| 构建 | 目标包 / 测试包 | 隔离与适配 |
| --- | --- | --- |
| f6a2ec7 | `uk.thewyj.app.qa.d01` / `.test` | 产品 PaymentVerificationScreen、ThewyjWebView、QA 自有 Room/Keystore 与合成账户 |
| 94f5177 | `uk.thewyj.app.qa.d01control` / `.test` | 相同公共生命周期测试、探针、Runner、HTML、CA 和网络配置；仅省略旧 API 不存在的 Result.accountId 与配置时 deactivate 调用 |

旧构建排除依赖新 API 的原 T01–T16 类和其重复包装类，仍编译相同的公共生命周期方法。该比较验证相同合成输入下的生命周期行为，不把旧版已知业务差异当作新修复的回归，也不声称两版产品二进制完全相同。不同 applicationId 是避免覆盖所必需的差异。

当前/旧版 WebView 组分别由对应 checkout 的真实 finance JS 提供服务；HTML、合成 API 与 TLS 夹具一致。只有 loopback 监听和本轮 18787 reverse，标准证书与主机名校验，无 trust-all、SSL error proceed 或系统 CA 安装。

开始时设备曾断开；离线构建和 607 项开发环境测试先完成，所有者恢复连接后才安装/运行 QA。四个 D-01 包在当时只读基线中均不存在，随后由本轮首次安装，之后只对这些同签名包使用 `-r`，从未清数据。

主要 A/B 和矩阵在 10 月 18 日凌晨 HKT 执行；正常解锁后的物理复验与最终反向对照在同日晚上恢复执行。所有者在对话中说明已开启延长解锁，本工具未写锁屏设置，也未读取该设置的内部配置。这个所有者环境变化只影响后段锁屏前置条件，已单独记录；最终反向/恢复两组均在后段相同环境完成。

## 3. 原始 D-01 证据复核

| 原证据 | 复核事实 | 保留边界 |
| --- | --- | --- |
| `device-matrix-activity-scenario.log`、原 results.json | 首次 T11 请求 RESUMED，最后阶段 STOPPED，AssertionError；case elapsed=198543ms | 是 ActivityScenario 生命周期失败，不能简化为金额 UI 没有重组 |
| 原系统 QA 日志 | 存在 Activity destroy/stop timeout，含 T11 保留的 task 20814 | 系统超时本身不指明产品、测试框架或 GPU 的责任 |
| `device-matrix-remaining-safe.log`、T16 checkpoint | 首轮 T16 断言及 QA 截图已完成，退出无完整 JUnit 结果，后来受控停止 | checkpoint 不能替代 teardown/JUnit 成功 |
| 原 T11/T15/T16 单例日志 | 后续分别完整通过，记录 13178 / 13543 / 2076ms | 单例成功未覆盖原失败 |

原 results.json 为 **24 条：20 PASS、4 FAIL**；4 FAIL 中 3 条为早期 T01 宿主尝试，1 条为 T11。未完成的 T16 批次没有完整结果行。第三阶段编号结论仍是历史 **15 PASS / 1 FAIL**。

三条后续 Java 采样均显示测试线程等待 ActivityScenario.close：

| 原采样 UTC，2026-10-17 | 阶段 / 阶段年龄 | main 栈顶 |
| --- | --- | --- |
| 12:19:59.639013 | postPause / 10070ms | HardwareRenderer.nDestroy → ThreadedRenderer.destroy → ViewRootImpl.destroyHardwareResources |
| 12:20:38.823042 | preDestroy / 9988ms | Compose pointer input onDetach → LayoutNode.detach → Composition.dispose |
| 12:21:54.881136 | postPause / 10061ms | DisplayEventReceiver.nativeGetLatestVsyncEventData → Choreographer |

阶段年龄不是同一函数持续阻塞时长；这些也不是首轮 198543ms 的全程连续栈。因此不据其归因三星 GPU 驱动。

## 4. 已确认的根因链

1. AndroidX ActivityInvoker 优先在 target context 查找辅助 Activity，找不到才回退到 instrumentation APK。原 QA 目标包没有 Test Core 的辅助 Activity manifest，实际启动的是 `.qa.d01.test/...EmptyActivity`，属于另一个 UID。[官方 monitor 1.8.0 源码制品](https://dl.google.com/dl/android/maven2/androidx/test/monitor/1.8.0/monitor-1.8.0-sources.jar)。
2. ActivityScenario 用该辅助窗口停止目标 Activity；恢复/关闭仍需目标进程内的测试线程执行后续调度。[官方 core 1.7.0 源码制品](https://dl.google.com/dl/android/maven2/androidx/test/core/1.7.0/core-1.7.0-sources.jar)。实际 core sources.jar SHA-256：`82d0bdf80bebb561b9b46f2dee164fa2d1ae839c99918fb3e1e2939633badba7`。
3. 受控异常期间，Samsung `FreecessController` 对同一目标 QA 包/PID 记录 `FZ ... reason: Bg-buff`，FreecessHandler freeze result=0。通过自身 debuggable QA UID 只读 `/proc`，主线程实处 `do_freezer_trap`；反向试验中 QA watchdog 也处于同一内核等待。没有 root、提权或发信号采栈。
4. 同时 Android AMS 仍报告 active instrumentation、curProcState=4、cached=false、isFrozen=false。只看 Android cached-app freeze 标志会漏掉这里的厂商冻结状态。
5. 被冻结的目标无法可靠执行自行恢复/关闭；有时系统的 ActivityDestroyTimeout 将其解冻，有时需要本轮 watchdog 停止 QA 进程。普通 Activity、旧产品基线及关闭主动 Java 栈采样的构建均出现该机制，完整产品页面、9ff7a7f 变更和采样器均不是必要条件。

一个精确的十秒对应关系，来自本轮**未修 QA 宿主的原 T11 单例**，PID 18210：

| UTC，2026-10-17 | 事件 |
| --- | --- |
| 17:36:13.157131 | StateAcceptanceActivity preDestroy |
| 17:36:13.158 | Freecess FZ，同包同 PID，Bg-buff |
| 17:36:23.155 | Freecess UFZ，reason: ActivityDestroyTimeout |
| 17:36:23.167414 | StateAcceptanceActivity destroyed |

该次 JUnit 虽 PASS，case 仍耗时 13209ms。证据为 `runs/current-original-T11-before/freecess-qa-only.log` 和对应 lifecycle events。这给出了先前十秒退出等待缺失的触发证据。

最终相同 QA 源码反向对照再次复现：取消目标包 Test Core 依赖后，Native 第 1 轮成功、第 2 轮 first-stop 冻结；PID 3205 的 main 与 QA watchdog 均为 `do_freezer_trap`，AMS isFrozen 仍为 false。恢复依赖后，同一序列 **30/30** 成功。

**责任划分：** Samsung Freecess 冻结机制已确认；导致本次验收调度失效的是 QA 将辅助 Activity 放在另一个进程、却依赖后台目标自行继续执行的宿主布局。产品页面和本轮产品修复不是复现所必需，未发现需改产品代码的 D-01 根因。本轮不将 Freecess 策略自身定为 GPU/驱动缺陷，也不需要产品侧全局降级措施。

HardwareRenderer 的实例共享 render thread；仅看到资源销毁栈不能定位具体图形驱动责任。[Android 官方说明](https://developer.android.com/reference/android/graphics/HardwareRenderer)。首轮历史 198543ms 全程不能逐毫秒重建；本轮 CONFIRMED 指受控复现、必要条件对照和撤回/恢复因果链，不伪造历史事件的连续栈。

## 5. 最小修正和源码审查

功能修正仅在 QA Gradle overlay：

```groovy
p.dependencies.add('debugImplementation', 'androidx.test:core:1.7.0')
```

`qa/aeris/d01/host/qa.init.gradle` 默认启用，`-Daeris.qa.sameprocess=false` 只用于受控负向对照。沿用已使用的 1.7.0 版本，未升级测试库。manifest 和运行日志确认辅助 Activity 变为 `.qa.d01/...EmptyActivity`，与目标同 UID/进程；被测 Activity 本身仍真实经历 pause、stop、resume、recreate 和 destroy。

没有设置冻结豁免、改 Freecess/电池/安全策略、关闭硬件加速、放宽 ActivityScenario 超时或删除业务断言。

| 产品审查点 | 结论 |
| --- | --- |
| PaymentVerificationScreen 的 LifecycleResumeEffect / 订阅 | 保持不变；真实 STOP/RESUME、无订阅者更新与实际 Native 显示在原 T11/T15 重复中验证 |
| PaymentVerificationState activate/deactivate、refresh/reconcile | 保持代际、账户和旧请求保护；没有猜改 mutex 或 lifecycle gate |
| ThewyjWebView publication / UI 线程 / dispose | 保持原实现；真实 WebView 生命周期、重载和 T16 teardown 回归通过 |
| MainActivity onStart/onStop / 同步触发 | 94f5177→f6a2ec7 未改此文件，本轮未改；QA 壳未完整挂载正式 MainActivity，不把组件结果当成正式入口验收 |
| Android renderer 销毁时序 | 保留原栈，使用冻结日志和同 UID/跨 UID 对照解释等待；未改产品渲染配置 |

额外 QA 工作包括探针、独立 PC watchdog、重复包装、正常 Home/息屏驱动及脱敏采集；不属于产品实现。初版 QA Lint 的三项错误（缩进、NSC 显式 includeSubdomains=false、overlay telephony 可选声明）已直接修正，未禁用 Lint 规则，失败 XML/日志保留。

早期 Compose 测试包装下的 WebView.getUrl 后台线程异常属于保留的 D-02 证据，其调用链含测试 continuation interceptor。当前采用普通 ActivityScenario，未把 D-02 直接充作 D-01 根因，也未改产品线程调度。

## 6. 重复试验与所有失败

完整逐轮状态、实际毫秒耗时、动作边界和生命周期事件在每组 `runs/<label>/device-evidence/events.ndjson`；汇总为 `device-results-summary-final.json`。发生冻结时保存包/PID、kernel wait、AMS 状态和过滤后的 Freecess 日志。被冻结的进程无法保证执行自身采样，故 PC watchdog 独立工作；只停止本轮两个 QA 包。

### 修正前及故意撤回

| 组 | 实际执行 / 成功 / 失败或阻塞 | 结果 |
| --- | --- | --- |
| 首次 current/control 普通 Activity | 各 1 次 / 0 / 1 | Samsung AppBlockDialog 拦截辅助包初始启动；与内核冻结分开记录，所有者通过系统正常流程确认 |
| current 普通 Activity 连续组 | 2 轮 / 1 / 1 | 第 2 轮 first-stop 超时，只停止 QA |
| control 94f5177 普通 Activity，采样关闭 | 2 轮 / 1 / 1 | 同样第 2 轮冻结 |
| current Native，采样关闭 | 1 轮 / 0 / 1 | second-stop 冻结 |
| current 原始 T01–T16 矩阵 | T01–T14 共 14 PASS；T15 冻结；T16 未执行 | 229.187s 后 PC watchdog 结束 QA；不计完整矩阵 PASS |
| current 原 T11 单例 | 1 / 1 / 0 | 13209ms，包含已确认十秒冻结/被动解冻 |
| 同源码 sameprocess=false 反向试验 | 2 轮 / 1 / 1 | 第 2 轮冻结，main/watchdog 内核证据齐全；原计划 30，实际失败即结束，未虚报执行数 |

这些批次不是总体故障率估计。requested=30 不等于已执行 30；失败批次按实际开始/完成计数，所有原结果均保留。

### 修正后连续重复

| 组 | 执行 | 成功 | 失败 | 每轮耗时中位 / 最大 ms |
| --- | ---: | ---: | ---: | ---: |
| f6a2ec7 普通 Activity | 30 | 30 | 0 | 772 / 1613 |
| f6a2ec7 Native 页面 | 30 | 30 | 0 | 3025 / 5672 |
| f6a2ec7 WebView | 30 | 30 | 0 | 1165 / 2205 |
| 94f5177 普通 Activity | 30 | 30 | 0 | 784 / 1634 |
| 94f5177 Native 页面 | 30 | 30 | 0 | 2961.5 / 3919 |
| 94f5177 WebView | 30 | 30 | 0 | 1145 / 2013 |
| 原 T11 断言和 teardown，连续同进程 | 30 | 30 | 0 | 1974 / 3022 |
| 原 T15 断言和 teardown，连续同进程 | 30 | 30 | 0 | 2031 / 2907 |
| 原 T16 断言和 teardown，连续同进程 | 30 | 30 | 0 | 1896 / 2706 |
| Native 已停止、辅助页可见后，整个 QA 应用 Home/外部返回 | 30 | 30 | 0 | 5808.5 / 6911 |
| Native 可见页直接 Home，桌面驻留 5s 后外部正常返回 | 30 | 30 | 0 | 8712 / 10976 |
| 反向失败后恢复修正，再执行 Native 同序列 | 30 | 30 | 0 | 2992.5 / 3964 |

共 **12 组、360 轮完成、360 成功、0 失败**；每组都取得完整 JUnit 结束记录，不依赖强制终止。一个 JUnit 方法内部可包含 30 轮，未把它们伪装成 360 个独立 JUnit 方法。各组时间包含合成配置和测试调度，不作为正式 App 性能基准。

公共生命周期 round 均有 STOPPED→RESUMED→STOPPED、再次恢复、Activity recreate、重新挂载及最终 DESTROYED 断言；Native 还核对停止期间新状态/100 次失效后的可见金额。原 T11/T15/T16 包装直接执行原业务断言和 close，不使用 Compose 测试时钟。

WebView 组记录创建/加载 configure、重新挂载 remount 和 close 的动作边界。当前组 configure 中位 150.5ms、remount 144.5ms；60 次 Activity preDestroy→destroyed 包络中位 4ms、最大 23ms；T16 的 30 次包络中位 5ms、最大 10ms。包络包含 Compose/WebView/Activity 清理，**未单独测量 WebView.destroy 内部 native 耗时**，不据此虚报精确 native 销毁延迟。原始每轮数据与 `lifecycle-timing-summary.json` 保留。

## 7. 物理息屏、锁屏及环境差异

从 Native 可见页执行真实 KEYCODE_SLEEP，记录系统进入 **Dozing / AOD**；再用 KEYCODE_WAKEUP 和正常 Activity 启动恢复，没有关闭 AOD 或绕过 keyguard。

第一次 `fixed-current-physical-screen` 的恢复检查在 keyguard 仍显示时到期，JUnit FAIL 保留，不能抹成 PASS。其 main 正常 epoll wait、keyguard=true，不是本轮已确认的进程冻结。

随后将 PC 唤醒确认、人工正常解锁和功能恢复分成独立阶段：QA 先等待本轮唯一 ack 文件；仅在实际 keyguard 锁定时，进入有记录的正常解锁环境门禁。解锁后才开始原有 **20s** 生命周期/UI 断言；ActivityScenario 与功能超时未延长，任何未解锁/跳过均不能计合格成功。

`fixed-current-physical-screen-owner-gate` 实际完成 **1 次合格复验**：正常解锁等待 **53582ms**，解锁后功能恢复 **917ms**，同一 QA Activity 恢复，新金额可见，JUnit 完整 PASS。所有者说明开启延长解锁的事实单独记录；工具没有更改锁屏设置，也没有读取解锁输入。

物理息屏只有这 1 次合格恢复，另有 1 次环境就绪失败，**不声称已完成 30 次物理息屏稳定性验收**。D-01 的至少 30 次相同故障条件复验由第 6 节连续生命周期、原始场景及撤回/恢复组提供。

## 8. 原 T01–T16 和保护不变量

修正后原始连续矩阵取得 **16/16 PASS，0 FAIL/0 SKIP**；另以独立 instrumentation 单例执行 T11/T15/T16，三者完整 PASS。证据为 `runs/fixed-current-original-matrix/` 和 `fixed-current-t11/t15/t16-single/`。所有输入、账户和交易均为合成数据。

| ID | 本轮实际通过范围 | 不替代的边界 |
| --- | --- | --- |
| T01 | 实际 QA Room→Native/WebView，本机已知/云端未知分开显示 | 真实通知提取、真实云确认 |
| T02 | pending=0 同步中新 Room receipt，经真实桥接/隔离 HTTPS 补拉 | 系统真实新通知入口 |
| T03 | 100 次失效、补拉中再次失效、两笔新事件，POST=0 | 真实采集压力/服务进程死亡 |
| T04 | HTTPS A/B 控制顺序与 cache token，旧写入被拒绝 | 完整真实 Native summary 解析链 |
| T05 | 实际 Room 旧 refresh 后到，新 reconcile 不回退 | 真实云传输 |
| T06 | 合成微信/支付宝来源包、同金额、反置 label 分开显示 | RC-6 历史同一真实事件及分身采集 |
| T07 | QA coordinator 两独立事件、本地幂等重放无第三笔 | 正式云端记账去重 |
| T08 | Web A 账户迟到响应不污染 B store | Native 真实登录/退出与凭据轮换 |
| T09 | ignored 终态、旧 pending、alias 不复活 | confirmed/ignored/deleted 的完整真实后端组合 |
| T10 | 实际 TLS socket reset，outbox/operation_id 保留后合法重试 | 系统断网和正式 MainActivity 网络恢复 |
| T11 | 连续与单例 Activity 恢复、可见新状态 | 完整正式 App/真实采集 |
| T12 | 实际 90s；realElapsed=91868ms，expiry 不变，30s 后调用数 6→6 | 真实支付票据链；未延长业务到期时间 |
| T13 | 1.23/9.99 合成冲突必须进入编辑，未自动记账 | 真实用户保存和云确认 |
| T14 | 实际 WebView reload 读取 QA Room 新 snapshot | 正式站点缓存/真实会话 |
| T15 | 停止订阅、同数量金额变化和 100 次信号后恢复 | 系统真实通知交付 |
| T16 | 真实产品 ledger 组件不插入合成已删流水，teardown 完成 | 正式历史交易删除/云回放 |

旧请求、账户、outbox、无重复补拉、终态、金额冲突和 90 秒票据保护没有被修改。组件通过不代表真实通知采集、真实云合同或 RC-6 已关闭。

## 9. 开发环境自动化、构建和 Lint

- **588 JVM tests / 86 suites：0 failures、0 errors、0 skipped**；明确用 `:app:testDebugUnitTest --rerun` 新执行，最终又运行一次标准 Unit/Lint/Debug 验证，日志有实际测试任务执行，未把 FROM-CACHE 冒充新执行。
- **13 Node + 6 私有 headless Chrome DOM 场景：全部 PASS**；与 JVM 合计原 **607 PASS / 0 FAIL / 0 SKIP**。额外既有 candidate/local-ledger JS 脚本通过，未重复计入 607。
- 标准 Android Lint 和 Debug 构建通过；标准 Lint 为 85 Warning、12 Hint、0 Error/Fatal。
- QA Debug、AndroidTest、旧版兼容与反向构建均实际构建成功；QA Lint 初版 3 错误保留，修正后 84 Warning、12 Hint、0 Error/Fatal，最新环境门禁版本最终 QA Lint 也通过（84 Warning、12 Hint、0 Error/Fatal），未豁免规则。
- 新增真机回归的实际迭代数见第 6–8 节，不计入原 607；远端 CI、Hosted Preview、Production 未执行。

证据：`android-final-local.log`、`junit-final/`、`node-state-final.log`、`browser-state-final.log`、`standard-final-lint-results-debug.*`、`qa-lint-first.xml`、`qa-lint-corrected-build.log`、`qa-lint-owner-gate-final.log`。构建缓存输出曾在后续构建后不再位于生成目录，反向构建已重建；实际测试 APK 独立归档，避免把缓存目录当作唯一证据。

## 10. 隔离和收尾核验

| 保护对象 | 本轮前后实核 |
| --- | --- |
| 固定主工作区 | 829 文件 SHA-256：0 新增/缺失/变化；HEAD、分支、原未提交状态相同 |
| 原 Aeris 修复树 | 840 文件同样 0 变化；包括原未提交验收报告；HEAD/分支/status 相同 |
| Task26 | 826 文件 0 变化；HEAD/分支/status 相同；未重标豁免 PASS |
| 原第三阶段 ignored 证据 | 140 文件集合及 SHA-256 全部相同 |
| 正式 `uk.thewyj.app` | 公开 APK SHA-256 前后均 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`；包元数据和权限 grant/flags 多重集合相同 |
| 正式服务 | 无障碍/通知监听启用集合、standby bucket、后台 app-op 相同；正式无障碍前后 bound |
| 运行中服务保护 | 103 次离散检查均 formalBound=true、QA serviceBound=false；不声称逐毫秒连续监测 |
| 既有 QA | `.debug.test`、`.qa.stateacceptance` 与其 `.test` 的包/权限元数据相同；没有更新、卸载、clear 或 force-stop |
| 本轮 QA | 仅四个本轮创建的包被安装/更新和受控停止；全部数据保留，最终四包已 force-stop |
| 网络/屏幕 | 收尾 18787 无监听、reverse 为空；没有 remove-all 或停止其他服务；Awake、keyguard=false |

证据为 `protected-before.json`、`protected-final.json`、`phase3-source-manifest.json`、`device-before.json`、`device-after-final.json`、`device-protection-final.json`、`cleanup-final.json`、`fixture-final-state.json`。共享 Git 只增加授权的隔离 worktree/分支元数据，不宣称整个 .git 字节不变。

正式数据库、Cookies、通知内容、签名私钥和真实金融文本未读取或写入；**私有数据库字节一致性 NOT MEASURED**，不因公开 APK/元数据相同而冒称正式数据字节完全不变。正式服务在后台的正常行为及所有者自身操作不由 QA 控制。

最终修正 target/test APK 的 SHA-256 分别为 `890c549f8714f8d302e30a5f5483c929d148a86c518d86401c23632bb16993d5` / `b457b89ced555e35f0a8a40ecad454a9c9947ca63f396519ffcbf9165c5b06a5`，独立保存在 `apks/fixed-final/`。Debug 公钥证书 SHA-256 始终为 `9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac`；反向包和旧修订另存，不混为实际运行版本。

没有读取根目录 `访问口令.txt`、上传开发工作区、修改主工作区/Task26、操作正式 App、Production D1/R2、账户/权益、feature flags、APK Stable 指针或发布任务。唯一业务数据为 QA 自有合成数据。

## 11. 交付与剩余门禁

工程交付为本报告及 `qa/aeris/d01/` 的 QA-only 修正、原宿主非秘密模板、诊断/准备/保护和回归代码。代码与报告仅在新隔离分支本地提交；产品源、正式 Gradle/版本、Cloudflare 配置及原工作树无差异。

本轮停止于 D-01 专项：**TEST-HARNESS-ONLY / CONFIRMED**。正式 App 的 MainActivity 完整同步入口、真实 Notification/Accessibility/OCR、RC-6、真实云端持久化、正式三页面一致性、微信 10 次验收以及生产发布均未由本报告替代。后续真实业务阶段需要独立授权，本轮不自动进入。
