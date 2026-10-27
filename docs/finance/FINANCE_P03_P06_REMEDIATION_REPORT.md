# FINANCE P03–P06 缺陷收敛与非真机验收报告

2026-10-27，Asia/Hong_Kong。**P03=PARTIAL / P04=PARTIAL / P05=PARTIAL / P06=PARTIAL。**

本轮全部可安全执行的非真机调查、最小修复和回归已执行。原六项关闭 **0/6**；原始失败没有改判。AI错误分类与有限重试缺陷的13个新增回归场景已通过；主模型原三个合成语义场景本轮3 PASS，完整真实模型质量门禁仍未通过。无新标准JVM/冻结矩阵回归。字母引用实际OCR原场景仍FAIL，数字引用只是独立正向对照。AVD磁盘删除被自动审批拒绝，其余QA应用/进程清理完成。

## 版本、继承与实际改动

- 起始及旧封存：`a065cd15d48b508c2797b9b563cfd24228b6bed9`，旧工作树`finance-p04-multicurrency/thewyj.uk`、分支`codex/finance-p06-ai`保留且干净。
- 本轮工作树：`C:\Users\78252\.codex\worktrees\finance-p03-p06-remediation\thewyj.uk`；分支`codex/finance-p03-p06-remediation`。
- 产品与质量回归提交：`30f190696b31d730bc880ecb4f4158a4e54ac042`；QA驱动/诊断提交：`0bbed3f5b89e2d78cf7bab1300981a51abb6c8d5`。
- 报告提交后的**最终HEAD、tree、干净状态和报告本身SHA**由`docs/migration-evidence/finance-p06/remediation/FINAL_PROVENANCE.json`及`FINAL_VERIFY.json`绑定，避免文档包含自身commit的循环引用。
- 测试执行时HEAD为a065，产品差异尚在工作树；命令保存前后源字节哈希。最终提交产品文件SHA为`2f97d2d0dd36e3ee855d4d5542513c501f5898697bd062ca31a97065ca09a30d`，与受测文件一致。没有把旧HEAD的历史PASS冒充本轮结果。

唯一产品代码文件是`functions/_lib/finance-ai.mjs`，16行增加、4行移除：prompt版本3→4；补充中文金额角色释义及选择角色一致性；按已有结构化HTTP/内部错误代码分类；已知配额耗尽不再无效重试。未知Error继续安全返回不可用，不解析/发布异常原文，不对不支持JSON Schema的模型偷偷降级协议。roles-2结构和金额/来源/确认/授权验证器均未放宽。

Android、Web账务、Room18、FX1、AI可选库1、D1迁移、P03身份状态机和Outbox产品代码无变化。未恢复“¥默认CNY”，未延长90秒/8次扫描/250ms或单SDK10秒。未增加AI自动记账、自动身份合并或自动付款能力。新增文件列表在末尾，旧测试和冻结oracle未改。

## 原六项原样复现与责任划分

修复前命令及完整栈：`finance-p04/remediation/original-six-before/command.json`、`android.log`、`junit/`。修复后：`final-r1/android-current/`。两次都是**6 FAIL、组合Gradle非零**。没有放宽断言、改样本或丢弃失败。

| 原方法 | 本轮前后 | 证据与处置 |
| --- | --- | --- |
| `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser` | FAIL → FAIL | 无账户上下文的“¥100”不能证明 CNY；原期望10000与v2安全要求冲突。显式账户CNY对照通过；原输入未改。 |
| `AndroidPaymentRecognitionHookArchiveTest.incompletePaymentCarriesAuditableReasonCodesWithoutRawText` | FAIL → FAIL | 原断言只允许amount/direction；v2真实未知单位也必须包含currency，当前集合为amount/direction/currency。不能为旧元数据断言隐藏未知单位。 |
| `FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking` | FAIL → FAIL | 首次“¥648.00”无可审计币种，未建账，原single()先失败；添加显式账户币种的独立对照执行了同一原方法和后到引用断言并通过。 |
| `FinanceP03IdentityLifecycleTest.durableMessageProofSurvivesRegistryCacheReplacement` | FAIL → FAIL | 首次建账前因币种未证被拒，未进入原缓存重放后段；显式账户币种对照执行原方法、缓存替换及长重放断言通过。 |
| `FinanceP03IdentityLifecycleTest.multipleOrdersOnOneMessageProofForceASeparateReviewSeries` | FAIL → FAIL | 原期望两笔“¥648.00”均自动入账，未给币种前提；显式账户币种对照验证两订单及无引用的歧义隔离通过，原FAIL保留。 |
| `LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive` | FAIL → FAIL | “¥34.00”缺少账户币种，原方法在首笔single()即失败；后续回执/重放在原方法中未到达。独立显式币种对照完整执行原方法并通过。 |

分类为**已确认的v1合同/当前币种安全前提冲突**。不是据此认定整个产品无缺陷；五项首先被币种门禁挡住，其原方法未到达的后续断言不能算原样PASS。独立显式币种v2的10项本轮全部PASS，直接调用原身份及离线方法，原方法断言不变，增加的账户设置来源可审计；无账户/错误账户/不相容币种的负向控制也PASS。等待所有者裁定兼容合同，不能恢复猜币种取绿。

## P03身份、清算与原26红项

原26项：**4 FAIL / 22 EXPECTED_RED**，相对a065无变化，逐项如下。

| Case ID | 本轮原样结果 |
| --- | --- |
| A009 | FAIL |
| A011 | FAIL |
| A021 | EXPECTED_RED |
| A023 | EXPECTED_RED |
| A069 | EXPECTED_RED |
| A071 | EXPECTED_RED |
| A117 | EXPECTED_RED |
| A119 | EXPECTED_RED |
| A165 | EXPECTED_RED |
| A167 | EXPECTED_RED |
| A201 | FAIL |
| A203 | FAIL |
| A213 | EXPECTED_RED |
| A215 | EXPECTED_RED |
| A261 | EXPECTED_RED |
| A263 | EXPECTED_RED |
| A309 | EXPECTED_RED |
| A311 | EXPECTED_RED |
| A357 | EXPECTED_RED |
| A359 | EXPECTED_RED |
| A393 | EXPECTED_RED |
| A395 | EXPECTED_RED |
| A405 | EXPECTED_RED |
| A407 | EXPECTED_RED |
| C005 | EXPECTED_RED |
| C007 | EXPECTED_RED |

A009/A011/A201/A203的原真值要求两笔64800；实测同一槽位移除/重贴、零时间间隔、空身份、同正文得到同一事件和一笔64800。`new_event_evidence`是夹具描述，不能凭标签制造独立操作证明。其余A系列原始可观察数据仍不足以区分独立付款与重放；原始事件、金额和失败账本保留。

C005继续使用USD200授权、80+90清算、200解除的原输入，只有共享授权引用，缺少两个独立Capture ID/版本/前驱，不能证明80和90是两次清算而非更正；原观测净支出8000，另一观测隔离，不能为了17000期望伪造operation ID。C007仍是无引用的授权/170清算/解除，原期望17000、实际0；未替换为带引用安全样本。可信操作引用、版本和前驱充分的多Capture、退款、修正、人工优先及跨账户隔离由当前41/99/79及HTTP/JVM桥验证，不能关闭原歧义案例。

## P04原18项与兼容回归

原样12 PASS / 6 EXPECTED_RED；只转发原夹具声明的币种/FX前提的版本化对照18 PASS。六个原红灯保留，所有源输入/金额/币种及oracle均有字节/哈希核查。

| Case ID | 原样 | 前提转发对照 |
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

四个原生驱动未转发default_currency且调用兼容policy1；两个DOM mock未提供协议2及原声明的非市场汇率/日期。对照没有换币种或金额，使用实际产品FX/D1不可变引用；不是原样红灯的替代PASS。

| 当前P04独立集合 | 本轮结果 | 证据 |
| --- | --- | --- |
| HTTP_D1 | 39 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/contracts/contracts.json` |
| migration_restore | 12 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/migrations/migrations.json` |
| default_review_migration | 8 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/review-migrations/review-migrations.json` |
| default_review | 11 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/default-currency/default-currency.json` |
| Chromium | 18 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/browser/browser.json` |
| live_FX | 12 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/live-fx/live-fx.json` |
| raw_transport | 36 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/raw-transport/raw-transport.json` |
| unit_review | 19 PASS | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/unit-review/unit-review.json` |
| exact_money | {'suite': 'P04 exact monetary units and projections', 'PASS': 76} | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/money.log` |
| simulated_FX | {'suite': 'P04 D1 reference cache, provider contract and history', 'PASS': 22, 'live_provider': 'NOT EXERCISED by this simulated suite; see separate live-fx evidence'} | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/fx.log` |
| independent_Decimal_oracle | {'suite': 'Independent Decimal vs JS rational arithmetic', 'PASS': 219, 'oracle': 'Python Decimal precision 100; ROUND_HALF_EVEN; one destination rounding'} | `docs/migration-evidence/finance-p04/remediation/final-r1/regression/oracle.log` |

## AI修复、真实模型与质量边界

旧主模型支付/JPY响应同时选择m0、将m0标为fee；服务端`finance_ai_rule_conflict`拒绝是正确行为。录制响应不重写，新质量集继续验证它们被拒。提示词补充“扣除/扣款”不等于手续费、原价/优惠/余额/费用角色及方向约束，prompt版本更新令缓存隔离。原候选金额、币种、方向和语义断言未改。

同一套76项质量oracle：a065实际模块**63 PASS / 13 FAIL**，当前**76 PASS / 0 FAIL**。13项是HTTP400/401/403/404/408/413/429及结构化5007/5018/5035/3007/3036/3040的分类/重试/回放。已知3036配额耗尽一次失败即停止；临时限流/服务错误仍最多两次，事件/账户/全局预算不增加。分类依据当前[Cloudflare Workers AI错误表](https://developers.cloudflare.com/workers-ai/platform/errors/)；公开参考文档与当前Workers types已另行封存，未升级项目依赖。完整错误堆栈位于baseline-r2，最终command/stdout/源锁位于`ai-quality-final-command`。本轮还执行过一次70项探索（60 PASS/10 FAIL），其中三个是新QA的merchant前提及过短事件ID；修正并保留探索结果。76项中18个六币种/方向组合、17个输入拒绝、15个输出拒绝、角色冲突/低置信度/重复证据、录制失败、异常响应、并发/重放/零账务写入均实际执行；多次运行不相加为不同用例。

| 实际外部模型 | 本轮调用 | 结果与限制 |
| --- | --- | --- |
| 主模型`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（返回`@cf/meta/llama-3.3-70b-json`） | 3 | 原付款、退款、JPY均PASS；confidences为800/1000/800，均须人工确认。重放0新增调用，0 ledger写入。 |
| 备选`@cf/meta/llama-3.1-8b-instruct-fp8` | 1 | FAIL；当前真实错误`5025: This model doesn't support JSON Schema`，结构化status/code缺失；无重试。未启用无验证fallback。 |

本轮实际调用**4/4硬上限**、每次max_tokens512、10秒；只有AI binding远端，D1本地、未部署Worker/Pages，无密钥或生产账户素材上传。Wrangler既有授权只读核验通过。请求/输出/来源哈希、usage和异常哈希位于`finance-p06/remediation/provider/`；实际发票费用NOT_TESTED。旧15次调用不计入本轮。旧备选三次消息未保存，不能追溯确认；当前兼容性原因CONFIRMED，旧三次同源只为PROBABLE。

主模型原两种失败本轮已实际通过，但没有同一时间窗口的旧prompt真实A/B，也未用真实模型覆盖完整六币种/对抗质量集，提示词因果解释为PROBABLE。**完整真实模型质量门禁=NOT_PASSED / PARTIAL_EVIDENCE**。正式AI启用配置未修改，本地/构建默认关闭；未探测或启用正式AI。

| 既有AI独立本地集合 | 本轮结果 | 证据 |
| --- | --- | --- |
| ai-contracts | 51 PASS | `docs\migration-evidence\finance-p06\remediation\supplementary-r1\ai-contracts\contracts.json` |
| roles | 23 PASS | `docs\migration-evidence\finance-p06\remediation\supplementary-r1\roles\contracts.json` |
| recovery | 14 PASS | `docs\migration-evidence\finance-p06\remediation\supplementary-r1\recovery\result.json` |
| migration | 7 PASS | `docs\migration-evidence\finance-p06\remediation\supplementary-r1\migration\result.json` |
| chrome | 11 PASS | `docs\migration-evidence\finance-p06\remediation\supplementary-r1\chrome\result.json` |

这些集合中的模型是Mock，实际HTTP/auth/D1/Chrome组件真实运行；不能计为真实模型PASS。Native P06 `FinanceAiTest`23项、Samsung OCR `FinanceP06DeviceOcrRegressionTest`7项均在本轮标准JVM中PASS，是重叠子集，不另外累计。Functions bundle、module graph和storage contract全部通过。

冻结F001–F015原驱动仍未连接当前产品协议，保持NOT_TESTED。F001/F012可观察业务字段相同，旧驱动却要求accept/review（旧自检F012也失败）；`expected.module=NOT_IMPLEMENTED`是未更新的阶段标记。十二个原v1响应已实际送入当前roles-2 normalizer做协议拒绝探测，均拒绝；没有凭scenario标签补造角色、来源UID、完成状态或引用。F013–F015的现代规则/冲突/撤回对照有独立产品验证，但不是原冻结合同的自动关闭。精确输入关系、12探测及原驱动位置见`contract-audit/`。

## 模拟器、生命周期与资源

仅新建本轮API36 `FinanceRemediationIsolated`、私有ADB5051、console5596，`--one-device FINANCE_REMEDIATION_NO_USB`；只选择qemu/API36核验过的TCP序列号。没有枚举或操作默认ADB5037/Samsung，无新手机权限、通知、付款、领取、微信消息或银行账户访问。

| 实验 | 本轮结果 | 边界 |
| --- | --- | --- |
| r1原字母引用 | FAIL | 实际ML Kit把`SYNTH-P06-JOINT-123456`读成`SYNTH-P06-J0IN-123456`，来源引用不相等，原生observer安全拒绝；保留原断言/图像/栈/数据库，0模型及正式账务写入。 |
| r2数字引用正向对照 | PASS | 实际SDK→Room/Outbox→认证HTTP/本地D1→Mock建议→Chrome人工将90改为88→丢回执/重启恢复→新Android进程拉回；一笔CNY8800，不重复。fixture不同，不能覆盖r1 FAIL。 |
| SDK像素矩阵 | 每轮33/33 PASS | 相同33个合成配方，本轮执行两遍；不累计成66种场景，不是Samsung/真实支付像素。 |
| 生命周期 | 每轮60/60 PASS | Plain30、未登录MainActivity30，停止/恢复/重建；两轮共120次受控重复，但只有同两种宿主。不证明登录财务WebView的实际同步，也不关闭历史另一Activity异常。 |
| 新Robolectric资源/解绑/销毁 | 3 PASS | 各1000个合成无关事件；噪声刷新合并为1次后台查询，解绑/销毁后0查询，0文本读取/截图/账务写入。计时是本地JVM，不是手机CPU/电池基准。 |

原字母失败在旧`joint-r4/native-seed.log`已有同断言，并非本轮新回归。精确引用绑定是安全保护，不能做0/O、缺字或相似度猜测。D-01、D-02维持CLOSED；历史另一财务Activity问题继续INCONCLUSIVE。银行应用兼容、实际常驻CPU/电池/RAM、系统FLAG_SECURE及手机锁屏行为仍NOT_TESTED，不能由模拟器推断。

r1首次tar归档读取报unexpected end of data；原残缺tar和失败保留。随后只对本轮QA目录逐文件读取，读取前后远端SHA和本地字节一致，恢复78份文件及3份关闭的合成数据库。该补取在测试结束后进行，不伪称原tar完整。33个像素结果、60轮日志、PNG及来源/状态保存在独立`artifact-recovery`。新资源测试首次因protected生命周期方法的QA调用方式未编译（0 JUnit），改为Robolectric反射调用原方法后3 PASS，未改产品可见性、事件数或断言。

## 数据库、恢复与安全

主Room18 / FX1 / AI可选库1和D1迁移源/导出schema均与a065一致。实际隔离SQLite、Miniflare/D1运行增量迁移、中断事务回滚、重试/重复DDL无损拒绝、旧读写端失败关闭、原账ID/金额/时间/人工编辑/回执及序列保留。当前保护集合41/99/79各全PASS；P04迁移12、币种审查迁移8、P06可选AI迁移7均PASS。

四组件关闭备份（Room、FX、Outbox、币种配置）seed/独立JVM restore通过；真实文件校验、错误账户/缺组件/坏哈希拒绝均执行。独立JVM→Outbox→本地HTTP/D1、提交成功丢回执、重复恢复和人工优先通过；旧implicit-CNY bridge seed FAIL，restore因此NOT_TESTED；显式币种独立桥seed/restore PASS、9个HTTP请求，原seed/restore未替换。多设备修正冲突、并发旧请求、回执冷恢复由现有实际服务/D1套件覆盖；不能冒充真实Hosted/多手机云验收。Git回退没有当作DB回退。

正式个人备份、旧正式APK访问升级后的用户数据库、Production Time Travel/恢复、实际提供方账户语义及真实跨设备云持久化均NOT_TESTED。本轮没有读取正式财务库或解密旧私人微信证据。

## 当前完整回归与失败统计

| 集合（互相重叠，不合计） | 本轮实际结果 | 相对a065 |
| --- | --- | --- |
| 标准JVM827 | 821 PASS / 6 FAIL | 不变 |
| 原607（588 JVM+13 Node+6 Chrome） | 602 PASS / 5 FAIL | 不变 |
| 冻结608 | 552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED | 不变 |
| 版本化前提608 | 558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED | 不变 |
| P03原26 | 4 FAIL / 22 EXPECTED_RED | 不变 |
| P03集合63 | 58 PASS / 4 FAIL / 1 NOT_TESTED | 不变 |
| P03集合41 / 99 / 79 | 41 PASS / 99 PASS / 79 PASS，各自独立 | 不变 |
| 既有新增38 | 38 PASS | 不变 |
| 显式币种v2 | 10 PASS | 不变 |
| 新AI质量76 | 76 PASS（a065同oracle为63 PASS/13 FAIL） | 改善13个新覆盖行为，不是原六项关闭 |
| 新资源测试 | 3 PASS，首次0用例编译失败保留 | 新覆盖 |
| Lint | 0 Error / 0 Fatal / 90 Warning / 13 Hint | 不变 |
| Debug及隔离test APK | 已实际构建 | 未签正式包/未发布 |

矩阵/JVM中SKIP=0；未执行用NOT_TESTED。原607为585/3 JVM、13/0 Node、4/2 Chrome。**组合Gradle返回1**，其后续Lint/Debug任务实际执行成功，不能将组合命令写为PASS。当前Node完整34命令：29个exit0、5个exit1；其中一次是读取缺失的ignored v3旧模块、尚未执行测试；从81d5/09442c/75e6561精确Git对象恢复仅测试基线后，原5条D1迁移断言另目录全部PASS。该失败命令和原缺失堆栈保留。其余旧协议/原样断言非零仍保留，不由能力3请求对照PASS覆盖。

冻结账本5 FAIL / 28 EXPECTED_RED，与标准JVM6 FAIL、原607五FAIL相互重叠，不能合计成独立缺陷总数。另有字母OCR E2E原场景FAIL、备选模型本轮1次不可用；不是把这些省略为“全通过”。`current-vs-a065.json`对827/608/版本化608逐ID比较，**0状态变化、0新失败身份**。collector中的`frozen_changes`比较更早P03，所列D/E历史改善不得算本轮新修复。

## 命令、证据与构建产物

完整逐条命令、开始/结束UTC、退出码、环境/源码锁和输出路径见`docs/migration-evidence/finance-p06/remediation/RUN_INDEX.json`及各command.json。主要入口如下（全部在本轮工作树）：

```text
python qa/finance-remediation/baseline.py
python qa/finance-remediation/prepare.py
python qa/finance-p04/android.py --tests <原六个完整方法>   [original-six-before]
python qa/finance-remediation/replay-baseline.py
python qa/finance-remediation/run-quality.py
python qa/finance-remediation/provider-preflight.py
python qa/finance-remediation/prepare-live.py
node docs/migration-evidence/finance-p06/remediation/provider/driver.mjs [r1主模型3例、r2备选1例]
python qa/finance-remediation/regression.py
python docs/migration-evidence/finance-p06/remediation/drivers/supplementary.py
python qa/finance-remediation/tail.py
python qa/finance-remediation/service-retry.py
python qa/finance-remediation/recover-emulator-artifacts.py
python qa/finance-remediation/recover-emulator-databases.py
python qa/finance-remediation/cleanup-emulator.py
python docs/migration-evidence/finance-p04/remediation/preparation/collector-r2.py
python qa/finance-remediation/contract-audit.py
python qa/finance-remediation/protect.py
python qa/finance-remediation/seal.py raw
python qa/finance-remediation/seal.py final
```

Node22、原锁定依赖、Gradle9.4.1/AGP9.2.1/JDK21、SDK36；未升级依赖。实际选项、JVM11条桥命令、Node34条及所有额外命令全部在run index，不以这里的简写取代真实日志。生成驱动仅调整新目录/绝对import/私有AVD端口或已声明的测试前提，差异及哈希单独保存，旧oracle原样。

标准Debug APK SHA256：`d4eaf79d5522348db50ba69c2ff9f9402b430e6e97a1a8358c13b0c954edeffc`。独立模拟器APK：`c91ec86299b519361465fb24a33431d28ded18cffcf05c6a2a51af6728b225cc`；test APK：`b1d0d6a3fbdc53c9cb3849568c60442e9aeb1f3c4f58735a4576a57825777f20`。二者不是正式交付APK，不覆盖正式App。

封存`FINAL_EVIDENCE_MANIFEST.json`共**1935文件**，SHA256：`7ff88c4c634d86ed3772eec1460cc0c6dbeea3b32676e873fd0c2f3fb29ea37c`。私有授权诊断仅本地保管、清单只列hash；不把Cookie/token/账户标识放进报告或Git。最终验证逐文件重算，并绑定最终提交与源文件。构建缓存/已停止AVD磁盘不算原始验收证据；配置、必要源码/PNG/数据库、失败日志和旧2588份封存均保留。

## 保护、清理与所有者后续裁决

14组保护（原13组加旧finance工作树）逐文件、HEAD、branch、status一致；旧a065封存2588/2588校验一致。Task25/26、固定主目录、Hotfix、D-01/D-02、P02原证据、旧APK/签名/正式数据均未修改。Task26的历史豁免仍为WAIVED，不改为PASS。本轮无push/merge/PR/发布/正式签名，无Production/共享Preview/既有P04 Preview变更。

本轮QA两个包已经从自己的虚拟设备卸载，权限随包移除，反向端口清零，模拟器及专属ADB5051关闭；Samsung和正式App权限未操作。自动审批在执行进程创建前拒绝删除本轮AVD磁盘（`blocked by policy`），**没有重试或改工具绕过**。该目录保留`4142872143`逻辑字节，路径`C:\Users\78252\.codex\worktrees\finance-p03-p06-remediation\thewyj.uk\docs\migration-evidence\finance-p06\remediation\avd\home`；本轮实际回收字节0。源码、测试报告、必要APK/备份保留；本轮node_modules/Android构建缓存也保留供复核。清理状态PARTIAL，详细记录见`local-cleanup.json`。

需要所有者最终裁决/外部条件，而非重复普通开发授权：

1. 是否以显式币种v2替代六项v1自动CNY/旧missingFields合同，并批准原P04前提转发协议作为新版本合同；没有裁决前原FAIL/EXPECTED_RED原样保留。
2. 对26项独立身份要求提供可验证operation/reference/revision/前驱/账户作用域，或明确接受隔离范围；不能仅宣布隔离等于完整业务支持。C005/C007不得用新编引用改真值。
3. 明确冻结F组旧响应及冲突预期如何接入当前只返回角色/ID、证据齐全、人工确认的P06合同；特别是F001/F012及F014的规则自动入账与AI不可记账边界。当前15项不虚报PASS。
4. 备选模型JSON Schema不兼容，需选合法兼容模型/明确停用该备选，并在新增有界预算下完成独立真实质量集；本轮4调用预算已用尽，正式AI不启用。
5. 真手机/真实通知与业务来源、RC-6、登录后财务页生命周期、真实银行兼容、个人备份/旧正式APK及Hosted/Production门禁留待相应数据与独立授权。本轮不读取真实账户补证。
6. AVD磁盘删除须先解决工具审批或由所有者处理；这是清理阻断，未影响其余本地验证和报告。保留目录不作为业务PASS。

后续最小工作是裁定这些合同、补有证明的来源/真实质量证据及处理清理阻断；不是重新开发P03–P06。不进入P07，不自动部署，交付后停止。

## 本轮修改文件

- `functions/_lib/finance-ai.mjs`
- `qa/finance-remediation/ai-quality.mjs`
- `qa/finance-remediation/baseline.py`
- `qa/finance-remediation/cleanup-emulator.py`
- `qa/finance-remediation/contract-audit.py`
- `qa/finance-remediation/kotlin/ServiceResourceContractTest.kt`
- `qa/finance-remediation/prepare-collector.py`
- `qa/finance-remediation/prepare-emulator.py`
- `qa/finance-remediation/prepare-live.py`
- `qa/finance-remediation/prepare.py`
- `qa/finance-remediation/protect.py`
- `qa/finance-remediation/provider-diagnosis.py`
- `qa/finance-remediation/provider-preflight.py`
- `qa/finance-remediation/recover-emulator-artifacts.py`
- `qa/finance-remediation/recover-emulator-databases.py`
- `qa/finance-remediation/reference-material.py`
- `qa/finance-remediation/regression.py`
- `qa/finance-remediation/replay-baseline.py`
- `qa/finance-remediation/residual-and-delta.py`
- `qa/finance-remediation/retry-baseline.py`
- `qa/finance-remediation/run-quality.py`
- `qa/finance-remediation/seal.py`
- `qa/finance-remediation/service-retry.py`
- `qa/finance-remediation/tail.py`
- `qa/finance-remediation/write-report.py`
- 本报告：`docs/finance/FINANCE_P03_P06_REMEDIATION_REPORT.md`。
