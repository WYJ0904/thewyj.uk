# Aeris P0 / P03 身份与结算根因及本地修复

2026-10-31，Asia/Hong_Kong。**P03：部分完成，暂缓发布。** 本轮修复了消息证明读取已接受关联时的真实缺陷；原指定四个 JVM 方法仍为 **0 PASS / 4 FAIL**，没有用新版输入覆盖。最新本地专项运行 **203 方法：199 PASS / 4 FAIL / 0 ERROR / 0 SKIPPED**，不是全量 JVM 或发布验收。

## 1. 授权、工作树与保护

本轮按所有者最新《Aeris V6.2 — P0 非 P07 专项最终收敛、真机验收与安全发布总指令》继续产品修复；该新指令覆盖旧 migration/handoff 中的开发暂停。本子任务仅在既有 `%USERPROFILE%/.codex/worktrees/aeris-p0-p03/thewyj.uk`、`codex/aeris-p0-p03` 工作，基线 `253a776f4bab013b13fdbf7545c932d45c91314b`。先读取 `AGENTS.md`、三份 Windows migration/handoff 文档，再审查和保存继承的两个生产文件修改及两个新增测试，未 reset、stash 或覆盖其他成果。

恢复时四个文件的字节副本及 SHA-256 位于 `docs/migration-evidence/p0-p03/resume-20261031/`。原两测试源与继承失败基线逐字节一致：

| 原测试源 | SHA-256 |
| --- | --- |
| `FinanceP03IdentityLifecycleTest.kt` | `843c29e5ff2a145f90b517aa0ab9e61ebf25866bdd27849a7947b0b09da1a783` |
| `LocalPaymentBookingTest.kt` | `de7451949b00b4e6213021f786c1cd48c79931fa610a8cc7fae85f01492725af` |

本子任务没有操作 ADB、模拟器、Samsung、GitHub 或 Cloudflare；没有 push、merge、远端迁移、模型调用、安装包发布、Production D1/R2/flags/Stable 写入。仅创建本树源码、测试、报告和 ignored 本地证据；未写入父树、旧财务树或其他工作区。下文 E 表示 `docs/migration-evidence/p0-p03/`，该目录被忽略，Git 报告中的路径不表示证据已上传。

## 2. 原四个失败：确认是缺币种前提，未进入后续业务断言

`AndroidPaymentRecognitionHook` 已使用 currency policy 2。`CurrencyDecision.apply` 在没有币种线索、没有已明确设置的账户默认、没有本事件已验证单位时保留待核实；`¥` 不能独立证明 CNY。原四项都在首次通知使用 `¥`，没有明确币种/账户默认。本轮保留这个门禁，不凭微信来源、金额或交易号填 CNY。

| 原方法 | 原输入及预期 | fresh 实际失败 | 根因和验收边界 |
| --- | --- | --- | --- |
| `laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking` | `支付成功¥648.00`；先有账，再补 reference 且不改 ID | 第 110 行 `NoSuchElementException: List is empty.` | 首次无币种不入账，尚未到补引用断言；不能宣称原合同通过 |
| `durableMessageProofSurvivesRegistryCacheReplacement` | `支付成功¥648.00`；先有账，替换 delivery ID 后保持一笔 | 第 78 行同样为空 | 首次无币种不入账；此原运行没有证明缓存替换后的账目结果 |
| `multipleOrdersOnOneMessageProofForceASeparateReviewSeries` | 同一 message、两个 reference、均 `¥648.00`；先有两账，弱重放另审 | 第 92 行 expected 2 / actual 0 | 两个 reference 都没有补齐币种；失败发生在独立审核断言之前 |
| `offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive` | `支付成功 ¥34.00`；先有本地账，再离线/丢回执/恢复 | 第 292 行空列表 | 原输入没有产生预期账，后续重试/回执/归档断言未被证明 |

继承失败 XML 在 E/baseline/junit/；fresh 原输入、原断言结果在 E/resume-protection-r2/junit/。四个方法名称、输入、断言及旧失败均未修改，也没有改判 EXPECTED_RED。

新增 `FinanceP0IdentityProofContractV2Test` 明确使用 CNY，独立验证：缓存替换、同一消息多个订单独立审核、迟到引用不改账目 ID、Room 文件关闭重开及 registry 淘汰、离线与缺回执重试/重启/归档关闭，并额外验证原 `¥` 仍为 XXX/待核实/零账。六方法 **6 PASS**。迟到引用保留旧测试的缺 UID 前提；离线版本保留 attention 状态检查。这是当前安全合同的版本化验证，不等于原四项通过或已批准取消原合同。

## 3. 真实产品缺陷：message-proof 绕过 effective reconciliation overlay

**CONFIRMED。** 原 `RoomPaymentRecognitionStore.recognitionsByMessageProof` 直接将 DAO 的原始 recognition 行 `toModel()`；source-event、upload-event 和 reference 查询已经统一通过 `effective()`。因此同一份已接受 reconciliation，查询入口不同会得到不同业务事实：

1. 两个原始 recognition 已合法归并到一个 canonical，消息查询仍返回两条，导致错误的“多订单消息”审核。
2. 已接受金额/修订更正后，消息查询仍返回旧金额、旧 revision。
3. 被解绑的消息仍表现为已入账且无审核原因；无 reference 重放可重新复用早先账目。

E/projection-before/ 为前三项 **0 PASS / 3 FAIL**；E/projection-safety-before/ 加入实际重放后为 **0 PASS / 4 FAIL**。继承 XML 记录了 old amount 64800 而应为 65000、两条 raw ID 而应为一个 canonical、丢失 `reconciliation_detached`、以及解绑重放错误返回旧 transaction ID。这些是可复现产品行为，不是因为原四项缺币种而制造的绿灯。

最小生产修复仅涉及两个文件：

- `PaymentRecognitionStore.kt`：message-proof 行也先走既有 `effective()`，再按 canonical `recognitionId` 去重。沿用原 account 过滤、profile-qualified proof、accepted overlay 和原事实保留机制；不改 DAO/schema，不重写 raw 行、历史 reference 或旧 transaction ID。
- `AndroidPaymentRecognitionHook.kt`：同角色消息若有多条有效记录，或一条处于 `reconciliation_detached` / `reconciliation_canonical_missing`，在无独立 reference 时统一输出 `message_identity_ambiguous`；`prepareIdentity` 将其置为未确认，`onCapture` 不把该证明的旧 `sourceEventId` 当唯一身份复用。新 delivery 形成独立审核候选，旧账保持可审计。

当前 `FinanceP0MessageProofProjectionTest` **5 PASS**：前三种 projection、解绑重放、缺失 canonical 行重放。缺失 canonical 是恢复后新增的破损状态保护，只报告本轮通过，不伪称已有其 before 失败。多 ID 归并用例核对原 A/B reference 没有被改写、旧账 supersession 后仅保留 canonical、跨账户查询为空；两种拒绝重放均核对不沿用旧账、不新增自动账、独立 recognition 和一个待审核候选。

这些测试使用明确标记为 synthetic 的已接受 overlay 存储夹具。它们证明读取和重放行为，不证明任何真实提供方已经授权 reconciliation。默认 `PaymentAuthorityVerifier` 仍拒绝未验证的提供方语义；既有 receipt digest、账户、CAS、operation/revision 和人工决议约束未放宽。

## 4. 原 26 项身份红灯：逐项静态复核，历史状态仍保留

本轮直接检查了 `qa/finance-p02/fixtures/matrix.json` 的以下 26 份原 fixture，副本在 E/resume-20261031/original-26-fixtures.json；没有修改输入/真值或重新执行冻结 608 驱动。下表状态及原实际值继承自 [既有失败台账](../finance-p04/FAILURE_AND_SCOPE_LEDGER.md)，不是本轮新执行结果，不能将其写成 fresh PASS。原 26 与上节原四个 JVM 方法是两个不同计数集合。

| 原 Case | 原状态 | 核查的缺失证明 / 保留结论 |
| --- | --- | --- |
| A009 | FAIL | 零延迟独立事件目标、重启；`new_event_evidence=true` 是 fixture oracle 标记，没有独立金融 operation/message/reference/revision |
| A011 | FAIL | 同上，不重启；通知移除/重投不证明第二笔支付 |
| A021 | EXPECTED_RED | 零延迟、重启，无独立身份，不按同槽位/同文案强拆 |
| A023 | EXPECTED_RED | 同上，不重启 |
| A069 | EXPECTED_RED | 5 秒、重启，等待时间不补独立身份 |
| A071 | EXPECTED_RED | 同上，不重启 |
| A117 | EXPECTED_RED | 30 秒、重启，等待时间不补独立身份 |
| A119 | EXPECTED_RED | 同上，不重启 |
| A165 | EXPECTED_RED | 60 秒、重启，等待时间不补独立身份 |
| A167 | EXPECTED_RED | 同上，不重启 |
| A201 | FAIL | 零延迟独立事件目标、重启；oracle 标记不能成为真实提供方凭证 |
| A203 | FAIL | 同上，不重启 |
| A213 | EXPECTED_RED | 零延迟、重启，无独立身份，不强拆 |
| A215 | EXPECTED_RED | 同上，不重启 |
| A261 | EXPECTED_RED | 5 秒、重启，等待时间不补独立身份 |
| A263 | EXPECTED_RED | 同上，不重启 |
| A309 | EXPECTED_RED | 30 秒、重启，等待时间不补独立身份 |
| A311 | EXPECTED_RED | 同上，不重启 |
| A357 | EXPECTED_RED | 60 秒、重启，等待时间不补独立身份 |
| A359 | EXPECTED_RED | 同上，不重启 |
| A393 | EXPECTED_RED | 5 秒重投、重启；缺同一 operation 的可信前驱证明，不能凭时间归并 |
| A395 | EXPECTED_RED | 同上，不重启 |
| A405 | EXPECTED_RED | 5 秒重投、重启；缺同一 operation 的可信前驱证明 |
| A407 | EXPECTED_RED | 同上，不重启 |
| C005 | EXPECTED_RED | USD 200 授权、80/90 两次结算共用 `SYNTH-P02-AUTH`、200 解除；没有独立 Capture/reference/revision，不能判断 90 是追加、修正或重投 |
| C007 | EXPECTED_RED | USD 200 授权、170 结算、200 解除的 reference 均空，不能由金额/时间恢复对应关系 |

历史 A 前 20 行目标 2 笔/129600、实际 1 笔/64800；后 4 行 replay 目标 1 笔/64800、实际 2 笔/129600。C005 原目标 17000、历史实际 8000，C007 原目标 17000、历史实际 0，均不改真值。`qa/finance-p03/finish/analyze-cases.py` 与 trace 源还明确区分“安全隔离成立”和“业务原目标满足”，本轮保持该界限。

安全降级是保留来源及冲突证据、进入独立人工审核，不靠金额、商户、时间、字符串近似或伪造引用合并/拆分。解除这些门禁需要合法取得账户/提供方/source 作用域内的独立 operation/message identity，或可信前驱/revision，并通过既有授权与精确回执校验。现有合成 fixture 缺这些字段是已确认的事实；真实支付平台是否提供足够凭证仍须真实授权链路核验，本轮没有作该外部结论。

## 5. fresh 运行、计数和证据保全

唯一 fresh 最终专项运行是 E/resume-protection-r2/，结束于 `2026-10-31T01:59:04Z`。命令参数在 `run.json`，原始 Gradle 输出、逐方法 XML、所有失败和互斥分类在 `gradle.log`、`junit/`、`summary.json`。

| 互斥集合 | 实际结果 |
| --- | --- |
| 原指定四方法 | **0 PASS / 4 FAIL** |
| 显式币种 V2 新方法 | **6 PASS** |
| overlay 新方法 | **5 PASS** |
| 其他相关保护 | **188 PASS** |
| 本次合计 | **203：199 PASS / 4 FAIL，0 ERROR / 0 SKIPPED**；Gradle exit **1** |

保护范围包括 P03 reconciliation/清算/control/resolution、Room 迁移/持久性、通知 ledger/message 身份、registry/profile、source scope、local booking、币种 hook/default/money。`FinanceP0*` 通配还执行了部分已有 P05/P06 OCR 组件测试，已包含在 188 中，不额外累加为其他专项完整验收。

这次实际重新编译了 unit Kotlin 并执行 `:app:testDebugUnitTest`，不是 UP-TO-DATE 测试任务。受测 `app/src/main`、`app/src/test` 及 Gradle 文件的 before/after manifest 完全一致，两份 manifest SHA-256 均为 `8a2f25a617e9a064f6b3fa626e507a6af8eca4bc1813b3f53ed3bcaaf4a114d2`。原四个失败及新 11 项、188 保护的拆分没有重复方法 identity。

提交前再次逐文件核对 289 个受测文件，运行后修改数为 0；`git diff --check` 和仓库敏感内容审计通过，后者核查 1467 个 tracked/candidate 文件。这些是本地审计，不是远端 CI。

此前恢复调用 E/resume-targeted-r1/ 命中已有 6+4 方法结果，明确只作复核，不另记 fresh 执行。早期 E/contract-v2-before/ 的 Room 文件打开失败是测试宿主 Windows 长路径问题；仅把该测试自己创建的持久库放到短的独占临时目录，保留真实文件关闭重开和断言。E/collector-corrections/ 记载了早期错误复制 prior-path-failure XML 到后次目录的更正；旧 XML/失败仍保留，该重复副本不是另一轮失败或后次成功依据。E/resume-protection-r2/ 的 fresh XML 关闭了这处采集缺口。

全量原 607、冻结 608、标准 JVM833、GitHub Actions、Hosted Preview、Production、模拟器、Samsung 和真实支付未由本子任务复跑；历史结果不更新为本轮结果。当前用例为 Robolectric API34 / Room / 合成通知及 transport，不是 Samsung API36 或真实业务端到端证明。

## 6. 交付与剩余门禁

可交付的是局部消息证明一致性修复、11 个明确区分的新测试及本地可审阅提交；P03 总体仍是部分完成。没有改变业务价格/品牌、P07 页面、schema、外部提供方授权、签名、权限或正式数据。

集成后需要在独立候选 SHA 上运行适用全量/CI；在安全 Preview 隔离被证明之前仍不得推送触发共享部署。原四项缺币种合同、原 26 可靠身份目标、真实支付/设备/升级及生产恢复门禁继续阻止将 P03 全体标记完成。不得用本次 11 PASS 或 188 PASS 替换这些未关闭项。

交接：基于本树独立提交审查两个生产文件和两份新增测试；复验 E/resume-protection-r2/ 的 manifest/原四失败；保留所有旧失败。后续取得真实独立身份/清算凭证时再验证对应操作与 accepted receipt，凭证不足继续独立审核，不补造 reference，不把 provider verifier 改成无条件通过。
