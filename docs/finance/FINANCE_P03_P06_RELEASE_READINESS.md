# FINANCE P03–P06 当前发布就绪度

2026-10-27，Asia/Hong_Kong。**P03 / P04 / P05 / P06 均为 PARTIAL；完整财务包为 C：保留源码、候选构建和隔离 Preview，不合并、不迁移 Production、不启用财务 AI。**

本报告记录本次无人值守任务的新执行结果，不能用上轮 PASS 代替本轮证据。原六项的旧 oracle 仍为 6 FAIL；所有者已明确采纳显式币种 v2，故另列 `SUPERSEDED_BY_V2`，不把旧失败改成 PASS。D-01、D-02 保持 CLOSED；历史另一财务 Activity 异常仍 INCONCLUSIVE。

## 版本与证据位置

| 项目 | 当前事实 |
| --- | --- |
| 原封存 | `f848ff98e679044da008e786fad8feced4fb0a99`，原树保持干净 |
| 本轮财务分支 | `codex/finance-release-convergence`，工作树 `%USERPROFILE%/.codex/worktrees/finance-release-convergence/thewyj.uk` |
| 受测产品提交 | `1af08aa1731377698c6713ab553606a49ff927b8` |
| 远端 | Draft PR [#112](https://github.com/WYJ0904/thewyj.uk/pull/112)，财务包未合并 |
| 本轮主证据 E | `docs/migration-evidence/finance-p04/convergence` |
| 补充证据 S | `docs/migration-evidence/finance-p06/convergence/supplementary-r1` |
| 当前矩阵与完整失败栈 | `E/final-r1/delivery-current/`，原始日志在同轮各执行目录 |
| 最终报告/源码绑定 | `E/FINAL_PROVENANCE.json`、`FINAL_EVIDENCE_MANIFEST.json`、`FINAL_VERIFY.json`；报告提交后生成，避免自引用 commit |

未初始化或覆盖旧工作树。原 1935、2588 份封存逐文件 SHA-256 再核对，16 组保护状态 PASS，见 `E/protected-final.json`。主工作区、Task26、旧 P02、D-01/D-02、Hotfix WIP 和旧财务树未变；Task26 旧豁免仍是豁免。没有操作 Samsung 或默认 ADB5037。

## 实际产品修复

相对 f848ff9，只有两处产品文件发生逻辑/文案变化：

- `functions/_lib/finance-ai.mjs`：已知不支持所需 JSON Schema 的 8B 模型在调用/消费预算前关闭；无静默 fallback。prompt 4→5。只含泛化“金额”或辅助金额标签、缺乏净收支语义锚点的证据不再交给模型猜测。roles-2 请求的 merchant enum 来自本次输入已许可 token 加 null，不共享或污染其他请求。严格输出验证器没有放宽。
- `android/app/src/main/java/uk/thewyj/app/ui/PaymentVerificationScreen.kt`：引用/币种/状态不能匹配时，明确提示重新识别或人工核实。未引入 0/O 相似匹配，未改变金额、交易身份、90 秒票据、扫描预算或账务写入条件。

新增独立合同、协议与边界测试、实际 SDK 诊断和收集脚本。三处历史报告/QA 的个人路径在当前发布副本改为可移植表达；旧封存副本及其结论未改。Room18、FX1、可选 AI 库1、D1迁移、Outbox、身份与清算产品代码未变。本次没有通过默认 CNY、扩大超时、删断言或重写模型响应取绿。

## 合同裁决与未关闭业务

正式合同在 `docs/finance/contracts/FINANCE_V2_ACCEPTANCE_CONTRACT.json`。六币种精度为 CNY/USD/EUR/HKD/GBP=2、JPY=0；缺失或冲突的单位待核实。交易身份须有可验证来源和账户作用域；`new_event_evidence` 只是旧夹具标签。AI 只提供候选建议，人工确认仍是写入前提。

| 原 JVM 方法 | 本轮原样结果 | v2 责任划分 |
| --- | --- | --- |
| `messagingStyleLinesReachThePaymentParser` | FAIL | 无上下文 ¥100 不能证明 CNY |
| `incompletePaymentCarriesAuditableReasonCodesWithoutRawText` | FAIL | 当前未知单位必须保留 currency 原因，不能隐藏以匹配旧原因集合 |
| `laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking` | FAIL | 首笔缺可信币种，旧 single() 失败，后段不能算执行通过 |
| `durableMessageProofSurvivesRegistryCacheReplacement` | FAIL | 同上；原缓存恢复断言未到达 |
| `multipleOrdersOnOneMessageProofForceASeparateReviewSeries` | FAIL | 缺币种时不能自动产生旧期望的两笔账 |
| `offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive` | FAIL | 无上下文 ¥34.00 被安全门禁拒绝；原后段没有到达 |

这六项逐项分类为 `SUPERSEDED_BY_V2_ORIGINAL_FAIL_RETAINED`。显式账户币种的独立 10 项执行原方法及原后段断言通过；负向账户/单位控制也通过，不能算原六项“修复通过”。

P03 原 26 项仍 **4 FAIL / 22 EXPECTED_RED**，详表 `E/final-r1/delivery-current/p03-original-26.json`。四个 FAIL 为 A009/A011/A201/A203；其他 A 系列及 C005/C007 原状态保留。新增真实 Hook/Room 合同 5 PASS：四种无证明场景保持一条待审核、不自动多记账，独立可信引用的同金额事件与重放保留正确 ID/账户隔离。该集合验证当前安全合同，不补造旧输入的操作证明。

C005 保留 USD200 授权、80+90 清算、200 解除的原输入。共享授权引用不能证明两个 Capture；原净支出8000与期望17000的差异保留。C007 无引用授权/170清算/解除原期望17000、实际0，继续隔离。需要原提供方 operation/capture ID、revision、predecessor、账户与来源证明后才能可靠恢复；本轮未制造凭据。可信多 Capture、部分清算/解除、退款、更正、人工优先由现有 41/99/79、HTTP 与 JVM 桥覆盖，不能由这些独立样本关闭 C005/C007。

F001–F015 逐项迁移解释见 `docs/finance/contracts/FINANCE_F001_F015_PROTOCOL_MIGRATION.json`。十二个原 v1 包确实送入当前产品并拒绝；F013–F015 是另外的冲突/规则/撤回场景。F001/F012 可观察输入相同但旧预期不同；F005–F007 的场景标签并不等于实际坏 JSON/超时/HTTP 错误。未补造缺失角色、来源 UID、完成状态或引用。旧 15 项仍 NOT_TESTED；现代拒绝/人工确认测试是独立证据。

## 本轮回归统计

以下集合互相重叠，**不得相加作为独立总数**。

| 集合 | 本轮实际结果 |
| --- | --- |
| 标准 JVM827 | 821 PASS / 6 FAIL / 0 SKIP |
| 原607 | 602 PASS / 5 FAIL：JVM585/3、Node13/0、真实 Chrome4/2 |
| 冻结608原样 | 552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED |
| 转发已声明前提的版本化608 | 558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED |
| 原P03集合63 | 58 PASS / 4 FAIL / 1 NOT_TESTED |
| P03保护41 / 99 / 79 | 分别41 / 99 / 79 PASS |
| 既有新增38 | 38 PASS |
| 显式币种v2 | 10 PASS |
| 本次身份合同新增 | 5 PASS |
| 本次协议17 | 修复前15 PASS/2 FAIL；修复后17 PASS |
| 本次模型边界8 | 修复前2 PASS/6 FAIL；修复后8 PASS |
| 原AI质量76重新执行 | 76 PASS，22次Mock调用；不是新增外部模型调用 |
| P06 rich/roles/recovery/migration/Chrome | 分别51/23/14/7/11 PASS；模型为Mock |
| Android Lint | 0 Error/Fatal，90 Warning、13 Hint |
| Debug | 实际构建；组合Gradle仍返回1，不能写成全绿 |

当前 Node34 命令为30 exit0、4 exit1；JVM/编排的非零命令全部保存在 `command-failures.json`，不能把编排失败当成另一批独立用例。aeris DOM 的两个旧夹具缺单位，实际显示“金额单位待核实”；Task21旧能力请求被 `currency_client_upgrade_required` 拒绝，能力3独立对照通过。P02原样目标/DOM仍有红灯。旧 implicit-CNY bridge seed FAIL，restore NOT_TESTED；显式币种独立桥 seed/restore PASS，9次HTTP请求。当前四组件备份、坏哈希/错账户/缺组件和扫描恢复记录见 summary 的 backup/bridges 字段。

| P04独立集合 | 本轮结果 |
| --- | --- |
| 实际HTTP/Miniflare/D1 | 39 PASS |
| 迁移/恢复 | 12 PASS |
| 默认审查迁移/业务 | 8 / 11 PASS |
| 实际Chrome | 18 PASS |
| 公开参考FX源 | 12 PASS，与支付成交汇率区分 |
| 原传输/单位审查 | 36 / 19 PASS |
| 精确金额 / 模拟FX | 76 / 22 PASS |
| 独立Python Decimal对照 | 219 PASS，精度100、ROUND_HALF_EVEN、目标端一次舍入 |

P04原18项仍12 PASS、6 EXPECTED_RED。六个原红为 D004/D008/D016/D020、DW-DOM-MIXED-budget/category；只转发原声明币种和FX前提的对照为18 PASS。没有换原金额、币种或oracle。逐行输入、预期、实际和源哈希在 `currency-18.json` / `input-integrity.json`。

主要可重跑入口：`qa/finance-p04/run-regression-jvm.py`、`run-regression-node.py`、`qa/finance-p06/supplementary.py`，完整本次参数见 `E/final-r1/extra-commands.json` 与 `delivery-current/summary.json` 的 commands；本轮使用隔离输出/夹具，由 `prepare-regression.py` 准备。原AI质量76的当前JSON在 `docs/migration-evidence/finance-p04/remediation/convergence-quality-r2/quality.json`，首次缺输出父目录的失败日志保留。原始测试入口和 frozen fixtures 未被修改。收集器只做路径/输出归档适配，不更改 oracle。

## 外部AI：预算用尽，仍不具备上线资格

本轮新增实际 provider 调用严格 **12/12**，全部为合成、脱敏来源；没有真实私人支付内容。无新增付费承诺，无 Production AI 启用。

| 模型 | 调用 | 语义/协议结果 |
| --- | --- | --- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 6 | 2 PASS / 4 FAIL |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 6 | 3 PASS / 3 FAIL |

两组使用相同六场景：CNY付款、USD退款、EUR收入、HKD费用、GBP折扣、JPY泛化歧义。失败包括未许可 merchant 空串、候选角色/决策错误、有限 token 下坏/截断 JSON。原响应、usage、调用账本与预算锁在 `E/live-models/`。累计5 PASS/7 FAIL不是模型合格率保证，实际账单成本 NOT_TESTED。

这些真实调用在 prompt5 / 请求局部 enum / 泛化语义 gate 修改前发生。修复后的局部与Mock回归通过，但**没有修复后真实模型复验**，预算已用完，不能继续调用，也不能凭Mock宣称 provider 问题已修复。旧不兼容8B已关闭，Qwen未晋升正式备选。失败关闭、人工确认、核心记账在AI关闭时继续工作。

## 实际ML Kit、生命周期与环境阻断

原 `SYNTH-P06-JOINT-123456` 像素从旧封存逐字节复制并核验。实际API36 ML Kit使用原图、全图缩放、引用区域缩放和灰度六种不注入期望字符的视图；**0/6 精确恢复**。结果分别包含 J0IN、J01NT、J0INT 和 PO6 等差异，不能形成可靠一致引用。见 `E/ocr-probe-r2/views.json`、六张PNG和 instrument.log。首次QA错误地在不合适线程等待SDK导致空结果/取single失败，修正QA Dispatcher.IO后才执行六视图；失败日志仍保留，产品本已使用相应线程管理。

已新增字母、数字、混合、原字母、低分辨率、模糊、遮挡、重复引用八种实际像素探针，隔离test APK编译成功。执行前 guest shell 卡住，宿主 emulator.log 出现 SDKCtl `Invalid packet signature` / ASSERTION FAILURE；getprop watchdog、正常重启、SDK只读实例和console结束尝试均保存。**本次八种探针实际执行0种，全部NOT_TESTED，不能把安全拒绝或编译成功报成OCR PASS。** 没有连接手机兜底或改变三星策略。

UI提供重新识别/人工核实，不猜0/O；正式金额、引用、Room/Outbox未被错误修改。上轮数字引用/33像素/生命周期60轮记录只是历史证据，本轮没有将它们重算为新PASS。历史另一Activity异常没有新直接根因证据；D-01/D-02不重开。Samsung、银行FLAG_SECURE、真实常驻CPU/电池/RAM、真实通知与付款/收款业务均NOT_TESTED。

## 数据安全与发布裁决

原ID、金额、时间、人工更正、账户、回执与清算关联通过本轮隔离Room/D1、重放、冷恢复和HTTP套件检查；没有新增迁移。Git回退不当作数据库回退。正式个人备份恢复、旧正式APK访问升级后真实库、生产财务迁移/Time Travel恢复与真实跨手机一致性仍NOT_TESTED。隔离迁移不能替代这些门禁。

完整财务分支不能安全接入当前Production schema1，因此保持 Draft #112。另一个基于旧main的P07 UI切片按本任务B级授权交付：PR #113已合并，Production为 f144956，新增UI能力OFF；它不包含本财务包，不能说P03–P06已上线。详细部署与例外在 P07 工作树的 `docs/release/UNATTENDED_EXECUTION_FINAL_REPORT.md`。

云端正式环境仅做配置、版本、flags/schema元数据读取，无真实账目查询或修改。未制作正式签名包、修改Stable APK/R2指针或操作手机权限。

## 封存、清理与关闭条件

16组保护和旧封存结果见 `protected-final.json`。本轮专属ADB5053已要求关闭，未涉及默认5037。新的AVD在SDK致命错误后无法验证包卸载；其约4.145GB逻辑文件保留诊断，实际回收0。旧3.86GiB被策略拒绝的AVD未再次删除或换工具绕过，清理为PARTIAL，详见 `cleanup-current.json`。Preview、独立owner登录材料、源码、报告、必要APK与证据均是交付物，继续保留；密钥/Cookie/私密材料不入Git。

仍需独立关闭：可靠提供方身份/账户语义证据；字母OCR安全恢复或明确的业务范围接受；修复后且更广的真实provider质量门禁及新消费授权；真实Android/通知/生命周期与既有微信证据的安全验收；正式备份/新旧客户端和生产恢复门禁。未经验证一律NOT_TESTED。当前非手机可执行修复与本轮回归已处理，P03–P06没有被宣布COMPLETE；没有进入P08。
