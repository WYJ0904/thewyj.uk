# 本轮执行、环境和失败账本

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


标准Android：{'tests': 614, 'failures': 0, 'errors': 0, 'skipped': 0}；原588 JVM+13 Node+6 DOM为本轮607，非历史PASS。新增P03：{'PASS': 63}（JUnit方法与方法内30次重复分开，不把动态循环伪称独立JUnit）。原夹具调整3项：离线同步补可靠引用；两个旧账保护夹具预置旧版本已有持久账目，不再把fixture setup的“创建新账”混为“保护已有账”。原账目/回执断言均保留，另增无依据新建账目必须0的强断言。7个迁移用例只加10→11链。不能说输入完全相同。

环境：Windows/PowerShell，Node24.18.1、Python3.15.0、JBR21.0.10、Gradle9.4.1、SDK36，Robolectric API34。npm ci原lockfile34包，未升依赖。Workers参考类型仅下载到ignored目录5.20261018.1，不是产品升级。所有原始stdout/stderr、JUnit、NDJSON、APK及hash在ignored finance-p03。Lint成功不等于无告警：归档XML为0 Error/Fatal、85 Warning、12 Hint，未通过新增suppressions掩盖。

| 执行命令/范围 | 结果 | 证据目录/日志 |
| --- | --- | --- |
| 原Gradle unit/lint/assembleDebug，--rerun | PASS，具体数量见上 | reviewed-final-android.log、reviewed-final-junit/、reviewed-final-lint.xml |
| 原Aeris Node13/浏览器DOM6 | 19 PASS | existing-node-state.log、existing-browser-state.log |
| 原Task21/16/17本地后端 | 3脚本PASS | final-task21/16/17.log、final-backend-exits.json |
| P03 server.mjs | 原生ingest/normalize/D1/hint/编辑删除恢复 | server-reviewed/server.ndjson |
| P03 legacy-raw.mjs | 原模型仅读对照+真实raw sync/D1 | legacy-raw-reviewed/、before-p02.json |
| P03 migration.mjs | 2 PASS，含故障注入和旧回执 | d1-migration-attempt1/migration.json |
| Bridge seed/restore（两个Gradle命令）+bridge-server | PASS，两个PID、503丢回执后恢复 | bridge-controlled/、bridge-controlled-seed/restore.log与-junit/ |
| 原P02 Matrix/Timing（最终源码overlay） | 按组非零保留，逐条真实结果 | p02-final-native/、p02-final-native.log与-junit/ |
| 原P02 C8中间专项复验 | C005/C007保持EXPECTED_RED；最终全量再复验 | p02-c-reviewed/ |
| 原P02 Seed/Restore（两个JVM） | 2 PASS | p02-process/、对应-junit/ |
| 原P02 Web/DOM/D1与AI示例 | 非零红灯及F012桩不一致保留 | p02-after-web/、p02-web-exits.json |
| protection.py前后对比 | 外部工作树/证据不变 | protected-final.comparison.json |

完整可复制PowerShell与-D参数见qa/finance-p03/README.md，本轮具体输出参数、退出码、命令与log对应关系见[run-commands.json](../migration-evidence/finance-p03/run-commands.json)。每次输出选新目录；Gradle串行，归档后才运行下一次。Node脚本使用FINANCE_P03_OUTPUT，仅Miniflare或随机loopback，绝不--remote。签名变量仅从本轮子进程移除，不改系统环境。

## 保留的真实失败与纠正

- before-native：12方法8 FAIL；server-before：16例14 FAIL；不是编译成功即宣告完成。
- native-attempt1：发行方夹具错误地用通用sms标识却要求等价95555；改为可观察95555，另加未知短信名称不能借CMB作用域的对照，不按银行正文猜发行方。
- full-android-attempt1：5 FAIL：普通退款被误要求授权引用（产品回归，已修）；parser completion flag与身份门禁混层（已分层）；离线夹具缺可靠身份（补引用）；两条迁移fixture遗漏可选indices（仅QA装配修正）。全部日志保留。
- existing-task21首次：迟到编辑器999/收入被误拒为event冲突，原保护要求重用已入账450/支出的真实receipt。保留失败，修复为现有receipt优先且不附加矛盾新引用，后端重跑PASS。
- unsupported-iso-before：AUD仍为CNY的FAIL保留；扩展明确ISO识别，不支持单位保留待核实；没有新增FX或全币种功能。
- legacy-identity-before：无身份legacy仅凭已知金额新建账的FAIL保留；改为待核实，完整精确非空回执一致后恢复，已有持久账目不删除。
- server-attempt1：新SQL行注释被既有测试flatten换行吞掉导致0案例启动失败，改block注释兼容既有loader；失败栈保留。
- bridge-final-restore：队列仍7项的断言FAIL；该服务最终0请求、0账目，恢复启动时已停止，未验证到实际服务链。六分钟watchdog及文件时间线见bridge-final/和bridge-expiry-diagnosis.json。未修改产品或放宽断言，改在全新bridge-controlled目录连续执行seed→服务→restore；原FAIL及堆栈保留，不能由后续PASS抹除。
- integrity-attempt1：审计脚本直接比较git show的LF字节与Windows CRLF工作副本，触发QA断言；六份配置归一化后相同，改用git hash-object验证原blob。产品未因此修改；诊断和复核见integrity-attempt1.json、integrity-review.json。
- 首次封存将尚未写完的自身stdout日志纳入摘要，独立复核发现仅该日志hash变化；保留seal-attempt1/与provenance-validation-attempt1.json。QA工具改为排除当前manifest及其stdout这两个封存外壳，复用APK时严格验证相同hash，产品和测试结果不改。
- 中间局部/全量运行、冻结P02非零、F012 mock矛盾及所有重跑均保留。最后一次PASS不覆盖它们。Node MODULE_TYPELESS_PACKAGE_JSON告警未通过改package配置消除。

## 实际覆盖边界

Bridge是两个真实JVM、真实磁盘Room/队列、HTTP transport、本地D1服务及实际回执闭环，但合成账户绕过真实登录；不是Hosted或Samsung。ML Kit只运行原mock/假时钟。真实交易/通知/云/生产/旧APK降级等NOT TESTED。性能只可从本轮raw样本读取开发机耗时，CPU并发负载不同不声称比P02更快；OCR硬件P50/P95均NOT TESTED。
