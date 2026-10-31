# FINANCE P03–P06 统一验收报告

2026-10-26，Asia/Hong_Kong。**P03=PARTIAL；P04=PARTIAL；P05=PARTIAL；P06=PARTIAL。**

本轮实际完成了Samsung OCR修复、P06建议流水线、原生授权/并发缓存修复及当前源码回归。所有失败、EXPECTED_RED和NOT_TESTED均保留；没有满足全部原合同，不能标COMPLETE。

本轮仅开发、隔离测试及本地提交。项目 Production D1/R2/Pages、共享 Preview、既有独立 P04 Preview 均未修改；没有 push、merge、PR、正式签名或发布。真实 Workers AI 调用仅使用脱敏合成字段，独立于项目正式财务环境。

起始封存 `425776f086d5a2b9165f9b9de311826a8d218f9e`。工作树 `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`，分支 `codex/finance-p06-ai`。产品修复提交 `a57ce56e7045167389ebbf7726c49fd043c5c7a7` 与 AI 实施 `07e54f94ea633661f95a8ad3a6ab8e88028fdc07` 分开；后续源绑定修复 `56f5c4921896f540ac0c4b167c26c1a676a00889`、原生授权/并发策略修复 `878f135dfca4d5d100aca65e18c1da7c3d8b3e10` 均保留。最终文档提交由 `finance-p06/FINAL_PROVENANCE.json` 绑定，避免报告包含自身 SHA 的循环引用。

## 最新结果与口径

| 集合 | 当前结果 |
| --- | --- |
| 标准JVM | 821 PASS / 6 FAIL |
| 原607 | 602 PASS / 5 FAIL |
| 原冻结608 | 552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED |
| 版本化前提608 | 558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED |
| 原P04十八项原样 | 6 EXPECTED_RED / 12 PASS |
| 原P04十八项前提转发 | 18 PASS |
| 原P03二十六红项 | 4 FAIL / 22 EXPECTED_RED |
| 既有新增38 | 38 PASS |
| Native P06 | 23 PASS |
| 新增Samsung OCR防回归 | 7 PASS |

SKIP以原始结果为准，未执行项目不算PASS。JVM、607及63/41/99/79等集合重叠，不相加。额外保护集合：`{"63": {"PASS": 58, "FAIL": 4, "NOT_TESTED": 1}, "41": {"PASS": 41}, "99": {"PASS": 99}, "79": {"PASS": 79}}`；独立显式币种v2为`10 PASS`。P04的18条原输入/原断言未改，6条原样红灯因驱动未传递声明前提保留；版本化输入转发有单独证明。

Lint：`{"Warning": 90, "Hint": 13}`，Error/Fatal为0/0；Debug及测试APK构建已执行。组合Gradle命令因原六项失败返回非零，不能写成整个回归PASS。代码来源、命令、JUnit、时间、APK及完整失败栈位于`docs/migration-evidence/finance-p04/p06-validation/final-r3`。

最终全量批次的Node受测文件哈希在续跑前再次核对；手动中断发生在Android生成结果前，旧编译日志另存`interrupted-android-r1`并标INTERRUPTED_NOT_TESTED。只恢复未完成Android和后续阶段，未覆盖旧命令记录。早期P06输出目录被旧QA守卫拒绝的尝试也保留，后改用全新的本轮专属`finance-p04/p06-validation/`，未修改原守卫、冻结源码或oracle。

## 仍未关闭的原始缺陷

| 类 / 方法 | 最终结果 |
| --- | --- |
| AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser | FAIL |
| AndroidPaymentRecognitionHookArchiveTest.incompletePaymentCarriesAuditableReasonCodesWithoutRawText | FAIL |
| FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking | FAIL |
| FinanceP03IdentityLifecycleTest.durableMessageProofSurvivesRegistryCacheReplacement | FAIL |
| FinanceP03IdentityLifecycleTest.multipleOrdersOnOneMessageProofForceASeparateReviewSeries | FAIL |
| LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive | FAIL |

缺少可审计币种前提时，¥不能直接当CNY；不能因原测试曾使用旧默认值就恢复猜币种。原六项的三个源文件哈希未变，C005/C007原样本/真值未改，26条身份红项保持真实结果。需要所有者另行裁定v1→v2合同或提供真实可证明的operation/reference/revision/前驱/账户作用域；隔离合同不等于完整业务支持。

## 真机、模拟器、API与业务证据

Samsung最新joint-r8及独立API36模拟器joint-r3使用相同APK哈希，合成SDK、Room、Outbox、认证API、本地D1、Web人工修改、丢回执、冷恢复和新进程拉回通过。模拟器60轮及先前Samsung60轮均是未登录MainActivity，不能代替登录金融页的真实生命周期。D-01/D-02保持CLOSED；历史财务Activity异常仍INCONCLUSIVE，不凭当前PASS改写。

已有真实收款页只得到0.01未知单位候选和收款状态观察；实际历史通知、付款侧同笔身份、来源与引用、RC-6、真实云持久化和完整W01–W10仍NOT_TESTED。没有新付款/领取/消息，没有访问无关账目。真实模型15次binding调用与合成Mock链路分开；当前主模型三种独立语义场景1 PASS/2 FAIL，第二模型3异常，发票费用NOT_TESTED。

## 数据、兼容性、保护及清理

主Room18/FX1不变，AI可选库1和D1四表增量独立于金融事实。迁移/异常回滚/重放/Outbox/四组件备份、独立JVM与真实本地D1恢复按原合同重跑。正式数据库从未打开；正式个人备份恢复、Production迁移/回退和Hosted持久化NOT_TESTED。Git回退不能替代数据库回退。

13组保护逐文件/HEAD/branch/status核验一致；原37份源字节已归档，956份上轮raw、再前2779份raw/51份源档案、4142份更旧文件均核验；原107个缺失编译缓存及原因未确定的旧FAIL继续保留。冻结13文件和原失败3文件哈希未变。

正式App1.3.37/code50及APK/权限与测试前一致，微信UID及profile未变。本轮QA两个包再次移除，私有ADB5043和专属AVD停止；磁盘/ChromeProfile/冗余APK清单见`local-cleanup/result.json`。原有其他QA、Task25/26、Hotfix工作树、签名材料、正式APK及数据保留。私人原件使用Windows CurrentUser DPAPI+用途entropy加密，全部解密hash核对后才移除明文；可用`privacy-read.py --label r1/r2 --verify-all`复核，不输出私人原文。

## 所有者后续最少条件

1. 对原v1币种默认合同及无法观察的身份场景作明确范围裁决，或提供合法脱敏且包含独立操作/版本/前驱/账户作用域的真实提供方凭证。不能伪造这些字段。
2. 在未来自然发生、持有人亲自完成的真实事件中取得完整来源通知和匹配凭证；不要求为本轮重付或重领旧转账。真实通知、RC-6和W01–W10分项保留数量与证据边界。
3. 真实模型需取得可诊断错误及独立校准数据，并完成受控预算下的真实模型+设备联合验证；未达到质量门禁前不启用正式AI。
4. 正式备份恢复、登录后金融页生命周期、Hosted金融库及Production发布仍须相应独立门禁与有效授权。本轮没有将代码推送、合并、正式签名或部署到任何现有站点。

完整实现/边界见 `FINANCE_P06_AI_IMPLEMENTATION_REPORT.md`，Samsung细节见 `FINANCE_P03_P04_P05_DEVICE_ACCEPTANCE_REPORT.md`。最终Git SHA、干净状态、全部证据hash和保护结果由`docs/migration-evidence/finance-p06/FINAL_PROVENANCE.json`及`FINAL_VERIFY.json`绑定。完成本轮交付后停止，不自动进入新阶段或发布。

## 原P04十八项逐条结果

| Case ID | 原样冻结 | 声明前提转发 |
| --- | --- | --- |
| D004 | EXPECTED_RED | PASS |
| D008 | EXPECTED_RED | PASS |
| D012 | PASS | PASS |
| D016 | EXPECTED_RED | PASS |
| D020 | EXPECTED_RED | PASS |
| D024 | PASS | PASS |
| DW-FMT-JPY-10000 | PASS | PASS |
| DW-FMT-JPY-12345 | PASS | PASS |
| DW-MIX-USD | PASS | PASS |
| DW-MIX-EUR | PASS | PASS |
| DW-MIX-HKD | PASS | PASS |
| DW-MIX-GBP | PASS | PASS |
| DW-MIX-JPY | PASS | PASS |
| DW-HISTORY-2026-10-18 | PASS | PASS |
| DW-HISTORY-2026-10-19 | PASS | PASS |
| DW-FX-MISSING-OFFLINE | PASS | PASS |
| DW-DOM-MIXED-budget | EXPECTED_RED | PASS |
| DW-DOM-MIXED-category | EXPECTED_RED | PASS |

## 修改清单

| 仓库内文件 | 范围 |
| --- | --- |
| android/app/schemas/uk.thewyj.app.finance.FinanceAiDatabase/1.json | 产品 |
| android/app/src/main/java/uk/thewyj/app/finance/FinanceAiCoordinator.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/finance/FinanceAiDatabase.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/finance/FinanceAiEvidence.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentHintSync.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageAmountSelection.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageEvidence.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/task21/payment/ThewyjPaymentAccessibilityService.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/ui/PaymentVerificationScreen.kt | 产品 |
| android/app/src/main/java/uk/thewyj/app/ui/PaymentVerificationState.kt | 产品 |
| android/app/src/test/java/uk/thewyj/app/finance/FinanceAiTest.kt | 测试/QA |
| android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP06DeviceOcrRegressionTest.kt | 测试/QA |
| cloudflare/migrations/0034_finance_ai_assistance.sql | 产品 |
| docs/finance/FINANCE_P03_P04_P05_DEVICE_ACCEPTANCE_REPORT.md | 报告 |
| docs/finance/FINANCE_P03_P06_UNIFIED_ACCEPTANCE_REPORT.md | 报告 |
| docs/finance/FINANCE_P06_AI_IMPLEMENTATION_REPORT.md | 报告 |
| functions/_lib/finance-ai-provider.mjs | 产品 |
| functions/_lib/finance-ai.mjs | 产品 |
| functions/_lib/task16-api.mjs | 产品 |
| functions/_lib/task21-api.mjs | 产品 |
| js/finance/ai-assistance.js | 产品 |
| js/finance/candidates.js | 产品 |
| qa/finance-p06/README.md | 测试/QA |
| qa/finance-p06/ai-contracts.mjs | 测试/QA |
| qa/finance-p06/ai-recovery-contracts.mjs | 测试/QA |
| qa/finance-p06/ai-v2-contracts.mjs | 测试/QA |
| qa/finance-p06/android.py | 测试/QA |
| qa/finance-p06/baseline.py | 测试/QA |
| qa/finance-p06/cleanup-local.ps1 | 测试/QA |
| qa/finance-p06/cleanup-private-plaintext.ps1 | 测试/QA |
| qa/finance-p06/collect.py | 测试/QA |
| qa/finance-p06/compact-provider-probe.mjs | 测试/QA |
| qa/finance-p06/device-baseline.py | 测试/QA |
| qa/finance-p06/device-res/xml/network_security_config.xml | 测试/QA |
| qa/finance-p06/device.init.gradle | 测试/QA |
| qa/finance-p06/device/AndroidManifest.xml | 测试/QA |
| qa/finance-p06/device/FinanceP06JointTest.kt | 测试/QA |
| qa/finance-p06/device/FinanceP06LifecycleTest.kt | 测试/QA |
| qa/finance-p06/device/FinanceP06Runner.kt | 测试/QA |
| qa/finance-p06/device/FinanceP06SdkProbeTest.kt | 测试/QA |
| qa/finance-p06/finish-emulator.py | 测试/QA |
| qa/finance-p06/formal-apk-baseline.py | 测试/QA |
| qa/finance-p06/full-regression.py | 测试/QA |
| qa/finance-p06/joint-browser.mjs | 测试/QA |
| qa/finance-p06/joint-diagnose.py | 测试/QA |
| qa/finance-p06/joint-server.mjs | 测试/QA |
| qa/finance-p06/live-provider.mjs | 测试/QA |
| qa/finance-p06/migrations.mjs | 测试/QA |
| qa/finance-p06/phone-finish.py | 测试/QA |
| qa/finance-p06/phone-open-wechat.py | 测试/QA |
| qa/finance-p06/phone-privacy.py | 测试/QA |
| qa/finance-p06/phone-query.py | 测试/QA |
| qa/finance-p06/phone-tap.py | 测试/QA |
| qa/finance-p06/phone-tree.py | 测试/QA |
| qa/finance-p06/prepare-compatible-regression.py | 测试/QA |
| qa/finance-p06/prepare-phone-pacing.py | 测试/QA |
| qa/finance-p06/prepare-policy-probe.py | 测试/QA |
| qa/finance-p06/prepare-regression.py | 测试/QA |
| qa/finance-p06/prepare-runner.py | 测试/QA |
| qa/finance-p06/preserve-interruption.py | 测试/QA |
| qa/finance-p06/privacy-read.py | 测试/QA |
| qa/finance-p06/privacy-seal.py | 测试/QA |
| qa/finance-p06/promote-policy-regressions.py | 测试/QA |
| qa/finance-p06/provenance.py | 测试/QA |
| qa/finance-p06/provider-preflight.py | 测试/QA |
| qa/finance-p06/resume-final.py | 测试/QA |
| qa/finance-p06/run-device-sdk.py | 测试/QA |
| qa/finance-p06/run-joint.py | 测试/QA |
| qa/finance-p06/split-sql.py | 测试/QA |
| qa/finance-p06/supplementary.py | 测试/QA |
| qa/finance-p06/web-ai.mjs | 测试/QA |
| qa/finance-p06/write-final-reports.py | 测试/QA |

完整补丁可审阅本地 `425776f..最终HEAD`；没有向远端提交这些变更。最终文件哈希由新封存manifest绑定。
