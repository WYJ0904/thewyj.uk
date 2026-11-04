# Aeris V6.2 — P03–P06 最终安全收敛与独立集成审查

2026-11-04，Asia/Hong_Kong。

**工程候选：`FINANCE_P03_P06_INTEGRATION_CANDIDATE_READY`。生产发布：`RELEASE_HELD`。**

本轮完成最小源码整合与可复现本地验证，适合下一轮独立集成验收。它不表示 P03–P06 全部完成，不关闭 OCR 泛化、真实来源、模型质量、生产迁移或三星门禁。
远程 Core CI 在创建本轮 Draft PR 后运行，其**精确 HEAD 的检查结果单列于 Draft PR checks 与交付记录**；本报告为本地源码绑定快照，不把本地 PASS 当成远程 CI PASS，也不为单纯回填 CI 文档触发重复完整构建。

## 1. 血统、被测版本与隔离

| 对象 | 精确版本 / 状态 |
| --- | --- |
| [PR #112](https://github.com/WYJ0904/thewyj.uk/pull/112) | 远程核实 `9ab3a5667b6230560b64531764720a754922b4c7`，OPEN / Draft，base main |
| [PR #118](https://github.com/WYJ0904/thewyj.uk/pull/118) | 远程核实 `fcc499ef4b33cd13d212c19523d82cd7966e2684`，OPEN / Draft，base `codex/finance-release-convergence` |
| 本轮起点 | **PR #118 的上述 SHA**，没有合并整个 P05 历史 |
| P05 原独立实验 | `b22c09bced02e73d070bb20bbb278a95800940e7` |
| P05 R2 业务 / 最终 QA | `2520d677ed1882f42092dd91d75fd589d958fe52` / `6c95d20dde951e12cf58f98d2d00ce2a51933daa`，`P05_R2_PARTIAL` |
| P06 原修复 / 实验室 | `f633fc85d91d339a856bf981e25cc0999e4bde32` / `74ab9f8a03e088d286cb7613a9041dce5ff48b28`，已在 #118 中继承 |
| 本轮最小产品提交 | **`5f4965cc4d8ceeddf50bb4c9fdef7ba00f634f21`** |
| 本轮分支 / 工作树 | `codex/finance-p03-p06-safe-convergence` / `%USERPROFILE%/.codex/worktrees/finance-p03-p06-safe-convergence/thewyj.uk` |
| P07 只读接口对照 | PR #122 `d26bbb8112e7d10a5dfede40af0fe19c4c447866`；不修改其工作树、CSS、HTML 或尚未提交的新页面 |
| Task26 | PR #120 `69ae5327d8e59f07a0307e8c16415a6f3f26a69c`，保持隔离与历史 owner waiver |
| 新 Draft PR 目标 | **`codex/finance-p06-integration`（#118 head）**，不是 main |

本地全量构建运行时为 `fcc499e… + 七个待提交文件`；源码前后哈希稳定，七文件与 `5f4965c…` 逐字节相同。不能把 893 项结果误标成未叠加 P05 的原始 #118 基线结果。
原 P05/P06/#112/#118 工作树及成果保留；没有 reset、clean、覆盖其他智能体内容或切换其分支。

## 2. 实际引入内容与文件

产品增量严格为 **3 个 Kotlin 源文件 + 4 个测试文件**，全部从 `2520d67…` Git 对象提取，并验证与 R2 最终提交相同路径的 blob 完全一致：

| 路径（公共前缀 `android/app/src/`） | 内容 |
| --- | --- |
| `main/java/uk/thewyj/app/task21/payment/ocr/ReferenceOcrEvidence.kt` | R1 候选证据基础及 R2 提供方标签修复；不改字形、不补编号 |
| `main/java/uk/thewyj/app/task21/payment/ocr/ReferenceImagePreprocessor.kt` | SDK symbol 标签/值边界保护；实验处理入口保持未接线 |
| `main/java/uk/thewyj/app/task21/payment/ocr/ReceiptOcrEvidence.kt` | 原始金额角色、完成状态、来源/单位冲突的人工候选注释 |
| `test/java/uk/thewyj/app/task21/payment/ocr/ReferenceOcrEvidenceTest.kt` | 21 项 |
| `test/java/uk/thewyj/app/task21/payment/ocr/ReferenceImagePreprocessorTest.kt` | 5 项 |
| `test/java/uk/thewyj/app/task21/payment/ocr/ReferenceR2RegressionTest.kt` | 3 项 |
| `test/java/uk/thewyj/app/task21/payment/ocr/ReceiptOcrEvidenceTest.kt` | 8 项 |

没有再次引入 `82a33d4` 的编号归一化；#112 的对应实现及原测试保持原样。P03/P04/P06 现有产品文件、Room schema、D1 SQL、依赖、版本、签名、正式配置均未修改。
没有把新 OCR API 连接到正式识别、ticket、账本、Outbox 或 AI；输出 `requiresManualReview` 始终为 true。没有启用新的默认 ROI/缩放策略。

新增专项工具在 `qa/finance-safe-convergence/`：`run.py`、`database-audit.mjs`、`p05-replay.py`、`native-contracts.py`、`prepare-legacy.py`、`interface-audit.mjs`、`summarize.py`、`README.md`。
报告与接口分析在 `docs/finance/`；脱敏机器证据为 [results.json](evidence/safe-convergence/results.json)。原始日志、JUnit、合成备份、旧失败和源哈希在忽略的 `docs/migration-evidence/finance-safe-convergence/` 及既有模块各自允许的忽略目录。
没有复制私人支付凭证或真实用户财务文本进入 Git。

## 3. 本地验收与统计边界

环境：Windows、固定 Node v24.18.1、项目锁定 Wrangler 4.118.0 / Miniflare 5.20260730.0-alpha、既有 Android Studio JDK / SDK。没有升级 lockfile 或 compatibility date。
所有 D1/SQLite、账户、金额、签名测试密钥和模型 binding 都是隔离 synthetic fixture；没有操作正式账号、会员权限、手机或远端数据库。

| 检查 | 本轮实际结果 / 边界 |
| --- | --- |
| Android 完整 JVM | **893 tests / 125 suites，0 fail/error/skip** |
| 其中 P05 四个测试类 | **37 PASS**，已包含于 893，不另加总 |
| 其中 P06 两个测试类 | **32 PASS**，已包含于 893 |
| P03 身份生命周期类 | **24 PASS**，已包含于 893；其余身份/Outbox/币种类见机器索引 |
| 原显式币种/严格身份 QA | **15 PASS**：10 个 versioned currency + 5 个 strict identity，独立列出，不改旧 oracle |
| P05 冻结 SDK 输出重放 | **11 PASS**，原样 26 例金额语义比较；没有新 SDK/设备调用 |
| lintDebug、assembleDebug、assembleDebugAndroidTest | **BUILD SUCCESSFUL**，仅 Debug 构建、未安装 |
| Android release consistency | **36 checks PASS**；正式元数据未变 |
| 财务/通知/状态/历史 Node 合同 | **15 个脚本 PASS**，含真实本地 D1/API 与受控密码学；不当作 15 个独立业务用例 |
| P04 精确金额 / FX / 单位 API | **76 / 22 / 19 PASS**，前两者不是在线 FX 质量认证 |
| P06 确定性评测 | **87/87 PASS**，合成控制，不是模型准确率 |
| P06 本地 D1/API | **40/40 PASS**，mock binding，真实模型调用 0 |
| P06 独立守卫 / 评分器 | **10/10、13/13 PASS** |
| P06 历史 rich / roles | **51 PASS；21 PASS / 2 FAIL**，两项原失败保留 |
| 历史模型重放 | 原 12 份脱敏 payload 可重放；Llama **2/6**、Qwen3 **3/6** 历史成绩未修补 |
| P04 迁移 / 默认币种审查迁移 | **12/12、8/8 PASS** |
| P06 迁移、事务失败、备份恢复 | **7/7 PASS** |
| 集成 D1/SQLite 审计 | **5/5 PASS**，109 个应用表冷恢复一致、外键 0 违规、SQLite integrity=ok |
| Functions 编译、模块图、storage | PASS |
| Pages staging 安全测试 | **28/28 PASS**，仅 allowlisted 发布输入 |
| 源码及报告审计 | 使用仓库原有 audit，最终结果见本轮归档日志 |

以上集合重叠，不能简单相加成整个财务系统的独立“总通过数”。完整输出与源码绑定见机器结果；CI 使用另外的 exact-head 结果，不由此表推断。

## 4. P03 身份与状态机结论

**当前严格合同的本地安全控制通过；P03 总体仍 PARTIAL。**

- 金额、商户、相近时间与 OCR 文本都是字段，不是独立身份。同金额独立可信引用及重复投递保留正确原 ID；缺来源/账号证明的重复通知维持人工候选，不自动变成多笔账。
- 受控 provider 测试使用临时 TEST RSA/AES 密钥，校验账户、merchant/app/payer、operation/reference、签名及缺失策略拒绝；它们不代替真实 provider 证书、账户配置与生产来源验收。
- 账户/设备作用域、状态转换、撤销、更正、退款、并发、Outbox 与重连走原有实现和回归。没有用 AI 或 OCR 候选绕过这些条件。
- P05 库没有任何新增正式消费者；`unambiguousText`、`paidAmount` 或多模型一致不能被当作已付款证明。

### 旧失败必须保持原义

#112 已将部分同名 JVM 正例输入由无上下文 `¥` 改为显式“实付 CNY”，并增加模糊 Yen 不入账的负向轨道。#118 的报告把同名方法通过描述为旧失败均修复，需按输入前提精确理解。
**本轮没有改那些测试。893 全绿只属于当前代码/夹具，不能把历史六个原输入的 FAIL 改成 PASS。**
原 P03 26 集合历史 **4 FAIL / 22 EXPECTED_RED**、C005/C007 缺独立 capture/operation 身份等裁决保留，本轮没有重写它们的期望或宣称已关闭。
新的 versioned 15 项是有明确账户币种/严格身份前提的补充证据，不是旧输入的替代品。

## 5. P04 六币种与汇率结论

**六币种本地金额、缓存、HTTP 能力守卫及迁移回归通过；发布与真实外部依赖验收仍 PARTIAL。**

CNY/USD/EUR/HKD/GBP 精度 2，JPY 精度 0；安全整数 minor 与 exact decimal/string FX 计算分开。JPY 小数、非法 ISO、过精度、缺币种、单位冲突与溢出不能静默接受。
既有明确 CNY 保留原值；旧 JPY 缺指数、默认币种核实和未知单位记录保持审查，不能仅凭 `¥` 补 CNY/JPY，也不原地乘除 100。

分币种汇总/预算不直接混加；跨币种展示使用 reference-only 快照、source/timestamp/expiry、原币与 revision 绑定；缺失、过期、离线和 provider 异常不回退到 1:1。HALF_EVEN 在目标单位一次舍入。
当前 22 项 FX 测试使用明确 mock fetcher，没有验证实时 FX 服务 SLA，也没有把公开参考汇率说成商户实际成交汇率。
老客户端有当前 money capability 守卫；收到不理解的 JPY 或币种核实状态应升级/人工处理，不能降级隐式解释。

## 6. P05 质量与安全结论

**`P05_R2_PARTIAL` 保持。**

本轮重放的是 R2 原样合成 SDK 输出，11 个断言通过，七文件无行为漂移。原 R2 的 641 JVM、105 项 #112 兼容与 186 SDK 调用属于其历史实验，不重复计入本轮 893 或当作本轮新设备测试。
旧单独金额 ranker 在 12 个非实付/不足场景有 9 次不合适建议，新语义层对这 12 例全拒绝；14 个有效例正确建议 12 个。**这些是合成字段建议结果，不是旧完整授权链的错账率，也不是新模块的真实业务错误率。**

原始字符质量没有普遍改善；固定图整页 CER 未变，部分 ROI 实验退化。R2 标签/边界修复可以提取完整提供方编号，但未证明普遍恢复字母精度。
R2 已发出的唯一编号提示仍有错误；模型一致不提供独立身份。不得启用实验性缩放、0/O 或 I/l 猜测，不关闭人工核实。
真实截图、三星字体/来源与时延、系统级 profile/前台归属、正式服务接线及端到端账务仍 NOT_TESTED。

## 7. P06 质量与安全结论

**安全补丁已继承并回归；模型质量仍 PARTIAL / `NOT_TESTED_QUOTA`。财务 AI 不开启。**

Web、Android、Functions 对所有候选角色分别校验原文依据，未选角色也不能越权或借用其他候选动作词。Android 拒绝 schema 字符串/小数伪版本及 confidence Long→Int 溢出；prompt/cache 使用 `finance-assistance-7` 隔离。
账户来源、能力、consent、预算、租期、并发、错误 JSON、数值边界、OFF/Kill、超时和安全恢复在现有离线框架执行。测试的 `@cf/synthetic/*` binding 不消耗真实模型配额。

原 roles 两失败：`refund-role-only-copies-original-source-money` 与 `income-role-is-not-an-expense`，其输入仍为支出短语“本次/扣除”，缺退款/收款证据，实际严格校验拒绝。**原命令仍 exit 1，21 PASS / 2 FAIL，不删除断言、不放宽角色规则，也不改成 PASS。**

历史 Llama 2/6、Qwen3 3/6 没达到发布质量要求；原始响应脱敏回放不修补空 merchant 或截断 JSON。安全测试全绿不证明在线模型好用。
本轮真实模型调用为 0，没有查询或消费新的配额，在线质量标记 `NOT_TESTED_QUOTA`；AI 建议依旧只能供显式人工采纳，不能证明交易完成或替代 P03。

## 8. 数据库、备份与生产迁移阻塞

本轮**没有新增或改动 SQL/Room schema**。基线清单实际为 **33 个 SQL 文件，编号到 0034，没有 0026**。
初版专项审计错误假设编号必须连续，产生 4 PASS / 1 FAIL；原失败保留。更正后与不可变 #118 完整文件清单逐项比较，不删除/补造 migration，5 项通过。
[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) 以已应用文件记录为基础；实际发布需核对 ledger/元数据，不能仅数编号。

复用真实旧 Git 模块，分别验证 0031/0032 的增量单位升级、0033 默认币种审查、0034 AI 附加表：幂等重放、失败 DDL 回滚、金额/ID/receipt 保留、旧服务拒绝新 schema、旧/新客户端能力边界及 consent 冷恢复。
另在完整隔离 D1 建六币种数据，故障 batch 不留下半笔修改；109 应用表 logical backup 冷恢复摘要一致，D1 foreign_key_check 无违规；物理 SQLite integrity=ok 并逐币种读回。

这些不是 Production Time Travel 或正式数据恢复演练。生产迁移仍 **BLOCKED / RELEASE_HELD**，前置条件包括：

1. 所有者另行批准明确目标 database、schema/ledger 只读预检与写入维护窗口。
2. 独立核对当前实际 schema、币种待核实历史数据及旧客户端分布；本轮没有访问正式用户账目或假称其状态已知。
3. 受验证备份/PITR bookmark、R2 对象边界、恢复责任人与恢复演练；确认迁移后旧二进制的拒绝/回滚方式。
4. 最终组合 SHA 的 CI、适用真机/来源、业务身份与单位核实门禁，以及必要的模型质量授权。财务 AI 与不安全 OCR 自动入账继续关闭。

不能把仓库中早期报告的 Production schema 1/2 当成本轮新鲜核查；正式 schema/flags 这里保持未独立验证。

## 9. P07 最小接口与兼容结论

独立方案：[P04_P07_FINANCE_INTERFACE_COMPATIBILITY.md](P04_P07_FINANCE_INTERFACE_COMPATIBILITY.md)。
只读固定 #122 的实际格式器，`JPY minor=123` 从 `JP¥1.23` 对比 P04 的 `JP¥123`；当前后端按能力守卫拒绝旧客户端。
因此不能只把 header 提升为 3 或用 P07 页面覆盖财务控制器；需保留 ISO/exponent、review 状态、分币种预算统计、reference-only FX、原幂等/冲突、OCR 人工状态与 AI 不可用提示。
没有修改 Flash 的 HTML/CSS、走势图、账户中心、学习或首页交互；新的尚未提交 UI 不在本次固定 SHA 的验收范围。

## 10. 原失败与本轮工具问题

原始结果全部保留于机器索引/忽略日志：

- 首次 P06 使用了不被既有 guard 允许的新 output prefix；改用原框架命名空间重跑，不改 guard 或业务断言。
- 首次 P06 migration 少了父输出目录，未进入业务断言；新 label 下原七项通过。
- 历史响应 envelope 没有 `synthetic_only` 字段；校验既有 synthetic budget 与不可变 envelope hash 后才复制三个允许输入，未把未知数据当私人真实凭证重用。
- 新 migration audit 的连续编号假设错误，改为固定基线精确清单；没有为了通过测试变更业务 SQL。
- 原六 JVM 输入、原 P03 与两角色失败单独保留，当前双轨/显式币种通过不能回写历史成绩。

本轮没有因测试失败放宽身份、清算、金额、超时、权限、字形或原始响应约束。

## 11. 回滚方案与发布控制

当前只是 Draft 候选、未部署、无数据库/服务接线变化。需要撤回时仅关闭本轮 PR，或在独立分支撤回 `5f4965c…` 的七文件增量；**不回滚父级 #118 P06 安全补丁，不碰原工作树**。
没有新持久化 OCR 表或单位转换，故本轮不存在需要执行的 down migration。

未来生产整包若升级 schema，不能直接部署不兼容旧服务、反向缩放 JPY、删除合法 receipt 或清空账本。应先停止相关写入/候选功能，再按另行批准的协调恢复计划处理 DB、应用版本与新写入；本报告只是方案，不执行任何正式切换。
若需要 Preview，应先建独立 D1/R2、独立测试账户、无真实 AI binding、明确 OFF/Kill 与合成输入，用既有 allowlisted staging，核对资源哈希和请求 origin。**本轮没有部署新 Preview 或借用正式数据库/凭据。**

## 12. 下一阶段与复现

建议进入**下一轮独立集成验收**：以本轮产品提交/最终 Draft PR HEAD 为输入，审查三模块未接线属性及 P07 接口，复核 exact-head CI，再由所有者决定测试范围。
不建议正式发布、开启财务 AI/OCR 自动入账或以本轮替代三星/真实模型验收。P03/P04/P05/P06 模块状态分别仍为 PARTIAL，整个生产发布保持 `RELEASE_HELD`。

复现见 [专项 README](../../qa/finance-safe-convergence/README.md)。全量 JVM、P05 重放与 versioned 原生检查分别归档，后两项不能加到 893 当独立总数。
保护快照覆盖固定 Hotfix、原 P05/P05R2/P06、#112/#118、Task26、P07 handover 与 Flash；并行树的外部推进不宣称冻结。没有向它们写入，也没有执行 Samsung/ADB、Production D1/R2、正式会员/配置/签名/Stable 操作。
按本轮明确授权，验证后推送本独立安全分支、创建以 #118 分支为目标的 Draft PR，并执行适用 Core CI；不会合并或执行生产发布工作流。
