# Android Accessibility Hotfix：第四阶段候选与回归报告

日期：2026-10-18，Asia/Hong_Kong。

**本轮结论：候选一致性、607 项自动化及合成真机回归 PASS；真实端到端 NOT TESTED，微信 0/10。D-01、D-02 维持 CLOSED。**

已完成隔离候选冻结、重新执行测试、制品留存和保护核验。本轮产品代码修改 0；没有重新做大规模 D-01/D-02 归因，没有正式签名、正式 App 更新/启动/数据迁移、Production 操作、真实交易、推送、合并或发布。

下一阶段仍被所有者授权、专用账户/真实事件、非 Production 后端及完整验收宿主阻塞。这里的 PASS 仅限本文实际执行范围，不等于整个 Hotfix 验收通过或可以发布。

## 1. 候选身份与继承关系

已阅读 AGENTS.md、固定工作区迁移/暂停说明、Hotfix 实施及第三阶段验收报告、D-01/D-02 RCA 和剩余验收矩阵。第三阶段验收报告在原修复树仍属未提交文件，本轮从原位置只读取得并保存 ignored 副本，未假定它已在 f6a2ec7 中。其 SHA-256 为 `c1a5448b0981ff414c25c7f90f88232612b84b797778ec6f34c8dcc0be9a2d92`。

新 managed 工作树：`%USERPROFILE%/.codex/worktrees/aeris-hotfix-acceptance-candidate/thewyj.uk`；分支 `codex/aeris-hotfix-acceptance-candidate`。

候选代码已在测试前本地提交冻结：

```text
e2febc6d9a33997bd9dc4cb042ecff216d31fde4  原 Hotfix
  → 94f517792edd11bb4c4c744057717df472544626  完整 WIP 导入
  → 9ff7a7fea6788505ba12014ea37bd86f4187b1bb  已确认产品修复
  → f6a2ec787f47468b6c0565141a1e4d82cd41330b  产品验收基线/交接
  → 57b622e40e22573ec652f4dfa21e8cd62b36c0e6  D-01 QA 修正
  → 8c0de9ca23ff8fd04c281a0a0bbbcee66d206384  D-02 QA 修正
  → ff11072d96d370125339602f392ead97d9ee121c  本轮候选代码/QA 输入
```

所有祖先关系通过 Git 实核。通过直接继承整合，无 cherry-pick 或 merge，没有复制旧 e2febc6 后重新套补丁。测试后报告提交仅增加本文，候选制品与测试身份仍固定为 **ff11072d96d370125339602f392ead97d9ee121c**。

| 对象 | SHA-256 / 身份 |
| --- | --- |
| 候选源码 tar（`git archive --format=tar`，上述完整 commit） | `287b099eb18ae2f5d09e5e67b426e6193f8d0f395f6910fe228f49b0c0c6f9a7` |
| 产品及构建输入清单（447 项；含 Android 测试、资源、schema 和配置） | `0340a1f2966c4fbfc137df8f02c9ac20501c538cb4311c0631d38cfb9b918d8c` |
| 全壳 Debug APK，仅构建未安装 | `37c9e0b37d4e70ee0274879b122f45abb6c7ea3e8e8c574c3a0abcf6e9f9ee90` |
| 合成 QA 目标 APK，实际安装/运行 | `c14bffd4fb10929b7b75d3bcedcf0768df79a554eb482da375ecd42a0d2d4177` |
| 合成 QA 测试 APK，实际运行 | `416ec8351819b7275aa85526fa1c0bb5788033388da81b340cc8a9f185c868ac` |
| 生成 QA 输入清单 | `7aaa2dddc32389b1157f7745750d7eeea1e4e8650901b4a65aef797dc5990ec4` |

全壳包为 `uk.thewyj.app.debug / 1.3.37-debug / code 50`；实际设备包为 `uk.thewyj.app.qa.hf4` 和 `.test`，二者在本轮初始基线不存在。均使用隔离 Debug 证书 `9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac`，没有提供正式签名材料。正式 `uk.thewyj.app` 的包名、版本、签名和数据不改变。

所有 APK 均使用 Debug 和 loopback 基址 `https://127.0.0.1:18787`。全壳包包含 MainActivity、通知监听、支付无障碍和短信接收器，manifest/AAPT 已核对；该包未安装，不把编译存在当作真实入口已验收。合成 QA 壳移除这些系统入口，仅挂载真实产品组件与自己的 Room/Keystore；避免访问私人数据或接管正式服务。

10 个 instrumentation invocation 的运行事件都携带并实核上述候选完整 commit 和产品清单 SHA。全部使用同一对目标/测试 APK，没有中途改代码或换包；447 项物理输入和生成的 QA 输入在测试后逐项 SHA-256 相同。

## 2. 实际整合差异与完整性

| 比较 | 实际结果 |
| --- | --- |
| e2febc6→94f5177 | 26 文件 WIP 导入；本轮固定主工作区这 26 项原字节与原 imported-wip.json 全部相同 |
| 94f5177→f6a2ec7 | 23 文件，包括既有产品修复、测试与交接报告；完整保留 |
| f6a2ec7→57b622e | 20 文件，仅 D-01 QA/报告；产品差异 0 |
| 57b622e→8c0de9c | 12 文件，仅 D-02 QA/报告；产品差异 0 |
| 8c0de9c→本轮候选 | 9 文件 / 697 新增行，仅新 QA 编排、Room 跨进程回归、身份/保护工具和 W01–W10 准备方案 |
| f6a2ec7→本轮候选的产品及构建输入 | 447 项完全一致；没有无障碍、通知、Room、WebView、同步、账目状态、正式版本/签名配置缺失或额外产品改动 |

`source-consistency.json` 保存逐文件清单与原始工作文件哈希；`integration-diff-inventory.json` 保存完整路径；`imported-wip.diff`、`product-repair.diff`、`qa-and-docs.diff` 分别保留依赖和修正范围。通知/无障碍门禁、完成证明、金额策略、90 秒期限、旧请求/账户/终态保护及 outbox 不变。

冻结前校验器曾把 PNG 错当文本规范换行，随后又未处理继承的 GBK 文本换行，出现两次校验器误报；原 PNG 与 Git blob 原始哈希相同、文本差异仅为正常 checkout 换行。最终采用 Git 自身 clean filter/object 比较，未为通过校验改产品内容或编码。相关失败诊断保留在 `source-checker-initial-error.json`、`source-checker-second-error.log`；它们不计为产品测试失败或被用来放宽检查。

## 3. 本轮完整开发环境回归

| 项目 | 本轮 PASS / FAIL / SKIP | 实际执行证据 |
| --- | --- | --- |
| JVM | **588 / 0 / 0，86 suites** | `:app:testDebugUnitTest --rerun`，日志有实际任务执行，非 FROM-CACHE 的测试结果；新 XML 归档 `junit-fresh/` |
| Node 状态/并发回归 | **13 / 0 / 0** | `node-state-fresh.log`，新进程执行真实模块 |
| headless Chrome DOM | **6 / 0 / 0** | `browser-state-fresh.log`，独立临时 profile、loopback allowlist、backendRequests=0 |
| 合计原 607 | **607 / 0 / 0** | 不计入任何历史执行、真机迭代或额外脚本 |
| 额外既有 candidate/local-ledger Node 套件 | 两脚本 PASS | `node-candidates-extra.log`、`node-ledger-extra.log`，不重复算进 607 |
| 标准 Android Lint | PASS | 85 Warning、12 Hint、0 Error/Fatal，`lint-standard.xml` |
| 标准 Debug 构建 | PASS | `android-standard-fresh.log`，1m55s；全壳 APK 归档 |
| 隔离 QA Debug/AndroidTest/Lint | PASS | `android-qa-build.log`，3m59s；84 Warning、12 Hint、0 Error/Fatal |
| 正式版本/配置本地一致性 | **36 checks PASS** | `release-consistency-local.log`；仅读本地配置，不访问生产 |
| 远端 CI / Hosted / Production / Release 签名及 R8 | **NOT TESTED** | 未运行、未发布；不以 Debug 或本地结果替代 |

普通编译/依赖允许使用构建缓存；原 588 项 Test 任务明确重新执行。QA 仅保留已有局部合成 JS 注解，没有关闭全局 Lint、WebView 线程检查、失败断言或硬件加速。

## 4. Samsung T01–T16：本轮实际合成真机矩阵

SM-S9360，Android 16/API 36，指定序列尾号 EHJN；前后 build fingerprint、WebView provider 一致，provider 为 `com.google.android.webview / 155.0.8059.43`。一次连续 invocation，**16 PASS / 0 FAIL / 0 SKIP**，完整 JUnit 与 teardown 已结束。

| ID | 本轮实际断言与覆盖边界 | 结果 / case ms |
| --- | --- | --- |
| T01 | QA Room→Native/Web，本机 1.23、canonical 金额未知，数量 1、云未确认；不含真实采集 | PASS / 3294 |
| T02 | pending=0 时真实本地桥接与隔离 HTTPS 必需补拉，无手动刷新；系统通知入口未测 | PASS / 1275 |
| T03 | 100 次信号、补拉中再次失效，最终新状态；bootstrap=3、changes=6、POST=0 | PASS / 1332 |
| T04 | HTTPS A/B 顺序、cache token 旧响应拒绝；完整真实 Native summary 解析链未测 | PASS / 1243 |
| T05 | 真实 Room 旧 refresh 后到，新 reconcile 金额不回退 | PASS / 1126 |
| T06 | 合成微信/支付宝包名、同额、反置 label，两个身份独立；不是实际两应用/RC-6 历史证明 | PASS / 2188 |
| T07 | 实际 coordinator/Room 两事件两行，重放无第三笔；真云去重未测 | PASS / 577 |
| T08 | Web A 账户迟到响应不写 B；Native 真登录/凭据轮换未测 | PASS / 1117 |
| T09 | ignored/旧 pending/alias 不复活；全部真实终态组合未测 | PASS / 565 |
| T10 | 实际 TLS socket reset，operation/outbox 保留，合法重试；未切全机网络 | PASS / 1106 |
| T11 | 实际 Activity 停止/恢复，显示新状态；完整 MainActivity 未测 | PASS / 1776 |
| T12 | 真实 90 秒；realElapsed=91502ms、expiry 不变，30s 后补拉数和到期均为 6 | PASS / 92000 |
| T13 | 本机 1.23/云 9.99 冲突必须编辑，automaticBookings=0 | PASS / 2870 |
| T14 | 真实 WebView reload 读取 QA Room 新金额；正式缓存/会话未测 | PASS / 2795 |
| T15 | 无订阅者、同数量金额变化、100 信号后恢复新金额 | PASS / 1747 |
| T16 | 真实 ledger 组件不复活合成已删流水，teardown 完成；真实删除/云回放未测 | PASS / 1700 |

逐 case metrics、截图（仅当前 QA 包）、网络时序和 JUnit 在 `runs/candidate-t01-t16/`；汇总 `verification-summary.json`。这是既有断言在本轮候选上的新运行，没有继承第三阶段或 D-01/D-02 的 PASS，也没有覆盖它们的原始 FAIL。

## 5. 关键补充回归与实际计数

| 组 | 本轮实际执行 / 结果 | 范围 |
| --- | --- | --- |
| Native 生命周期 | 30/30 轮，1 JUnit PASS | STOP→RESUME→STOP、恢复、recreate、重新挂载和 DESTROYED；100 次失效后显示 4.56 |
| WebView 生命周期 | 30/30 轮，1 JUnit PASS | 相同生命周期序列、实际 WebView/JS 重新挂载与销毁 |
| Home/外部返回 | 3/3 轮，1 JUnit PASS | 从 Native 可见页 Home、桌面驻留 5s、正常返回，更新可见 |
| WebView UI 线程 | 30/30 迭代，1 JUnit PASS | 沿用 D-02 显式 Standard 调度；受检查操作均 main，无后台调用异常 |
| 产品 publication | 30/30 次新 publication，1 JUnit PASS | 每次 after>before，账户匹配、URL 可读；真实产品 IO→WebView 路径 |
| 原始 Compose T01 修正版 | 1/1 JUnit PASS | Standard+推进测试时钟，保留原业务 assert 与超时 |
| Room 持久化种子 | 1/1 JUnit PASS | 真实 coordinator 建 1 booking，recognition/candidate 关联，2 个 durable outbox operation |
| 新 QA 进程重启与恢复 | 1/1 JUnit PASS | 断言 PID 不同；3 次 recover 后仍 1 booking、相同 transaction/recognition/candidate 与 2 个原 operation；没有网络或正式数据 |
| 实际息屏/亮屏 | 1/1 轮，1 JUnit PASS | 原生 QA 页面→Dozing/AOD→正常唤醒/所有者解锁→同 Activity 新金额可见；完整退出 |

加上 16 项主矩阵，实际 **10 次独立 invocation、25 个 JUnit case：25 PASS / 0 FAIL / 0 SKIP，watchdog 触发 0 次**。连续迭代不是独立 JUnit：生命周期/Home/息屏合计 64 轮，另有 30 UI 线程迭代与 30 publication；不将它们重复计入 607 或十次真实微信。

息屏 3s 后记录 Dozing；正常解锁等待 **5722ms**，解锁后功能恢复 **879ms**。环境等待与原 **20s** 功能检查分开，未延长原断言或 90 秒票据。只有一次物理息屏合格复验；票据跨息屏到期、系统网络切换、完整 MainActivity、真实通知服务和真实业务后台链仍 **NOT TESTED**。

本轮没有执行 D-01/D-02 的故意负向归因矩阵；它们保持 CLOSED。本轮也没有新的直接故障证据要求重开。历史失败和当前原始输出均只增不覆盖。

## 6. RC 状态与真实验收准备

| RC | 代码/本轮合成证据 | 仍未关闭的真实门禁 |
| --- | --- | --- |
| RC-1 | 既有显示修复保留；新 JVM/DOM、T01/T13/T14 PASS | 真实采集→云确认→三处金额/状态，NOT TESTED |
| RC-2 | 既有失效 generation、补拉/outbox 保护；13 Node、T02/T03/T10 PASS | 系统真实通知、MainActivity/真云回补，NOT TESTED |
| RC-3 | 倒计时/不续期 JVM 与真实 90s T12 PASS | 真票据跨真实后台/息屏完整链，NOT TESTED |
| RC-4 | 账户/请求/终态保护、T04/T05/T08/T09/T16 和 Room 进程重启 PASS | Native 真登录切换、真实云终态/持久化组合，NOT TESTED |
| RC-5 | StateFlow 恢复、T11/T15、Native 30 轮 PASS | 系统真实交付与完整服务生命周期，NOT TESTED |
| RC-6 | 来源标签防御、同额不同合成来源 T06 PASS | **历史 INCONCLUSIVE / OPEN**，没有同一真实事件链；微信/支付宝/分身真验 NOT TESTED |

执行方案为 `AERIS_HOTFIX_PHASE4_WECHAT_PLAN.md`，承接 `ANDROID_HOTFIX_REMAINING_ACCEPTANCE_MATRIX.md`：W01–W10 是十个独立真实事件，每个均覆盖系统通知、合法 ticket/无障碍/金额、Room/outbox、指定测试云、WebView/原生核实/财务历史；另列支付宝 A01、聊天/无票据/未完成/过期/冲突/终态负向门禁。

本轮 W01–W10 **全部 NOT TESTED，0/10**。无授权账户/测试 origin/事件/profile，不虚构交易来凑数。完整 MainActivity 和真实通知链不由 QA 壳代验；RC-6 没有历史证据就继续 INCONCLUSIVE，不以合成或新事件通过推翻旧事故边界。

## 7. 保护核验与收尾

| 对象 | 本轮前后核验 |
| --- | --- |
| 固定主工作区 | 829 文件，HEAD/branch/status 相同，0 新增/缺失/内容变化，原 WIP 保留 |
| 原 Aeris 修复树 | 840 文件，同样 0 变化，包括原未提交第三阶段报告 |
| Task26 | 826 文件，同样 0 变化；未修改、启动或重标 waiver 为 PASS |
| D-01 / control / D-02 工作树 | 859 / 829 / 871 文件，HEAD/branch/status 与内容均相同 |
| 原第三阶段 / D-01 / D-02 原始证据 | 140 / 870 / 207 文件，各自集合与 SHA-256 全部相同；可重建 build-* 缓存不算原始证据 |
| 正式 App | APK SHA-256 前后均 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`；包/权限、服务启用集合、standby、后台 app-op 相同 |
| 已有 QA 包 | `.debug.test`、第三阶段、D-01/control、D-02 的元数据和权限相同；未更新、停止、卸载或 clear |
| 服务运行保护 | 测试期间 28 次离散检查 formalBound=true、qaServiceBound=false；初始/最终也 bound；不声称逐毫秒连续监测 |
| 本轮新增状态 | 仅新 hf4 目标/测试包安装，数据保留；收尾只 force-stop 这两包，无清数据/卸载 |
| 网络与设备 | 只停止唯一确认的本轮 loopback fixture、移除自身 18787 reverse，端口无监听、reverse 恢复为空；最终 Awake/keyguard=false |

保护证据：`protected-before.json`、`protected-final.comparison.json`、`device-before/after.json`、`device-protection.json`、`cleanup.json`、`fixture-process/stopped.json`。共享 Git 仅增加授权的新 worktree/分支/本地提交元数据，不宣称整个 .git 字节不变。

正式数据库、通知正文、Cookie、token、真实金融文本、根目录口令文件、正式签名私钥未读取或写入；**正式私有数据字节一致性 NOT MEASURED**，不能用公开 APK/元数据相同冒称私有库完全未变。正式服务正常后台行为不由 QA 控制。没有 Production D1/R2、账户/权益、feature flags、Stable 指针或发布任务操作。

## 8. 交付与授权边界

证据根为 `docs/migration-evidence/hotfix-phase4/`，含候选 source tar、三份 APK、输入清单、运行身份、全新 JVM/XML、Node/DOM、Lint、16 项/关键重复回归、TLS/network、系统 QA 日志和保护快照。所有可重建输出与 TLS 私钥 ignored，仅 QA 代码和报告进入本地 Git。

本轮自动化和候选一致性门禁现已通过，可以向所有者申请**下一阶段必要授权**：仅独立全壳 Debug、明确非 Production 测试 origin/专用账户别名、指定微信/支付宝/profile、正常系统权限启用、限定云合同读写及最小脱敏观察；真实事件和任何支付由所有者自行操作。当前 loopback APK 仍需按获准环境重建/核验连接，不能直接当作真云可用候选。

这个申请不含正式包覆盖/迁移、正式签名、Production、发送微信消息、读取无关聊天或自动支付，也不含推送、合并、发布。授权与所需测试环境/事件到位前，W01–W10 保持 NOT TESTED。本轮完成后停止，等待所有者审核，不自动进入真实业务阶段或财务 AI。
