# FINANCE-P03/P04 失败与范围台账

2026-10-24，Asia/Hong_Kong。**P03 = PARTIAL；P04 = PARTIAL；未达到整体 COMPLETE。** 本台账保留原始失败、目标红项、QA 故障和未执行项，不以专项成功覆盖原合同，也不把阻止入账本身一概计为 PASS。

本文件的整理与修订仅在既有隔离工作树进行，文档整理未运行测试、操作 ADB / Cloud、执行 Git 操作或修改产品。所有者对 P03/P04 收尾的授权不扩展至主树、暂停的 Hotfix、Task26、正式数据或 Production。Task26 仍为 `CLOSED_WITH_OWNER_WAIVER`，豁免不改为 PASS；本台账不进入 P05/P06。

## 1. 证据版本与计数口径

最终本地交付快照是 `docs/migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/`，下文记为 **D/**；本轮设备 / Hosted 证据根为 `docs/migration-evidence/finance-p04/closure-current/`，记为 **E/**。两者均是本机忽略证据，不保证在远端 Git 中可下载。最新快照记录 `tested_head = 73764f77fd02ada240e41c24734e523c5dad8805`，生成时间 `2026-10-24T15:22:28.723049+08:00`。旧 `delivery-current/` 原样保留，只作前一汇总版本。

| 集合 | 本轮实际结果 | 解释与证据 |
| --- | --- | --- |
| 标准 JVM 730 方法 | **724 PASS / 6 FAIL** | [jvm-failures.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/jvm-failures.json)；不是全绿 |
| 原 34 个 Node 命令 | **30 退出 0 / 4 退出 1** | aeris-dom、task21、p02-web、p02-dom 非零退出；不能将整组记为 PASS |
| 原 607 | **602 PASS / 5 FAIL** | 原 JVM 588 为 585/3，Node 13 为 13/0，Chrome 6 为 4/2；[original-607.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/original-607.json) |
| 受保护 681 | **675 PASS / 6 FAIL** | 与上述 JVM 集合存在重叠，不与 730 或 607 相加 |
| P03 原 26 红项 | **4 FAIL / 22 EXPECTED_RED** | 本轮 0 PASS；逐行见第 2 节 |
| 冻结原驱动 608 | **549 PASS / 8 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED** | [frozen-608.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/frozen-608.json) |
| 当前版本化合同 608 | **555 PASS / 8 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED** | 6 项驱动适配差异单列，第 4 节；[contract-608.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/contract-608.json) |
| P04 原 18 项 | 版本化驱动 **18 PASS**；原样驱动 **12 PASS / 6 EXPECTED_RED** | 两种结果同时保留，不能互相替换 |
| P03 重叠集 | 63：58 PASS / 4 FAIL / 1 NOT_TESTED；41：41 PASS；99：99 PASS；79：79 PASS | 是不同重叠视图，不构成额外独立执行总数 |
| 新增 38 行 | **38 PASS** | [new-38.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/new-38.json)；不覆盖原 26 |

总览以 [summary.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/summary.json) 为准。JUnit 方法、矩阵行、方法内部向量、重复轮次和真实业务事件分别计数。`EXPECTED_RED` 是冻结目标未满足，不能改写为 PASS；`NOT_TESTED` 是目标未被执行或执行前提未成立，不能用 mock / 组件成功填补。

## 2. P03 原 26 项逐项保留

输入、原预期与 before/after 均见 [p03-original-26.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/p03-original-26.json)。以下金额均为最小单位；“2 / 129600”表示 2 笔、支出总额 129600。每行 before 与本轮 after 状态相同。

| Case | 原状态 → 本轮状态 | 原冻结真值：笔数 / 支出 | 本轮实际：笔数 / 支出 | 分类 |
| --- | --- | --- | --- | --- |
| A009 | FAIL → **FAIL** | 2 / 129600 | 1 / 64800 | 原身份 / 生命周期合同未满足 |
| A011 | FAIL → **FAIL** | 2 / 129600 | 1 / 64800 | 同上 |
| A021 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A023 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A069 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A071 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A117 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A119 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A165 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A167 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A201 | FAIL → **FAIL** | 2 / 129600 | 1 / 64800 | 原身份 / 生命周期合同未满足 |
| A203 | FAIL → **FAIL** | 2 / 129600 | 1 / 64800 | 同上 |
| A213 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A215 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A261 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A263 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A309 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A311 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A357 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A359 | EXPECTED_RED → **EXPECTED_RED** | 2 / 129600 | 1 / 64800 | 原目标未满足 |
| A393 | EXPECTED_RED → **EXPECTED_RED** | 1 / 64800 | 2 / 129600 | 原版本 / 身份归并目标未满足 |
| A395 | EXPECTED_RED → **EXPECTED_RED** | 1 / 64800 | 2 / 129600 | 同上 |
| A405 | EXPECTED_RED → **EXPECTED_RED** | 1 / 64800 | 2 / 129600 | 同上 |
| A407 | EXPECTED_RED → **EXPECTED_RED** | 1 / 64800 | 2 / 129600 | 同上 |
| C005 | EXPECTED_RED → **EXPECTED_RED** | 支出 **17000**、退款 0 | 支出 **8000**、退款 0 | 原多次 Capture 真值未满足 |
| C007 | EXPECTED_RED → **EXPECTED_RED** | 支出 **17000**、退款 0 | 支出 **0**、退款 0 | 无可靠引用时未完成原目标 |

A 类实际事件 ID / identity 与原夹具一并保存，不能通过同额、同文案、接近时间或槽位猜测独立 operation。可靠操作、账户、版本和前驱证明不足的项目维持原状态。

**C005 原输入是 USD 200 预授权、USD 80 与 USD 90 两次结算、USD 200 解除；80 + 90 = 170，原真值仍为 17000。** 当前只观察到 8000，不能把预期降成 8000，也不能把两次结算改成互相替代来取绿。C007 原输入包含无引用的 USD 170 结算，原真值同样仍为 **17000**；当前 0 不算通过，不虚构提供方引用。显式提供独立操作证据的另一个回放成功，不能替换这两行冻结输入。

## 3. 原 607 五个 FAIL、标准 JVM 六个 FAIL 与 G 复用行

原始清单见 [original-607-failures.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/original-607-failures.json)。五项均保留 **FAIL**；与新安全合同的前提差异是解释，不是改判。

| 原 607 失败项 | 实际失败 | 实证分类 / 未关闭事项 |
| --- | --- | --- |
| JVM `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser` | expected 10000，actual 0 | 原输入未给币种 / 账户默认；P04 policy2 不再隐式猜 CNY；旧前提与当前安全合同冲突仍待处置 |
| JVM `AndroidPaymentRecognitionHookArchiveTest.incompletePaymentCarriesAuditableReasonCodesWithoutRawText` | expected `[amount, direction]`，actual `[amount, direction, currency]` | 新增缺币种理由导致旧断言失败，原断言未删 |
| JVM `LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive` | `NoSuchElementException: List is empty` | 原隐式 CNY fixture 未产生旧预期账目；后续 `single()` 失败，不是已证明回执重放通过 |
| Chrome `T01/T06: actual DOM shows local evidence, two stable identities and independent merchant text` | DOM 未匹配 `/1\.23/` | 原 omitted-currency fixture 未加账户默认，显示金额单位待核实 |
| Chrome `T13: conflict opens deliberate editor and sends no automatic confirmation` | DOM 未匹配 `/9\.99/` | 原 omitted-currency fixture 显示 `XXX · 金额单位待核实`；原显示预期未满足 |

标准 730 JVM 的 6 FAIL 包含上列 3 JVM，另有 `FinanceP03IdentityLifecycleTest` 的三项：

| 方法 | 本轮实际失败 | 状态 |
| --- | --- | --- |
| `laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking` | `NoSuchElementException: List is empty` | **FAIL** |
| `durableMessageProofSurvivesRegistryCacheReplacement` | `NoSuchElementException: List is empty` | **FAIL** |
| `multipleOrdersOnOneMessageProofForceASeparateReviewSeries` | expected 2，actual 0 | **FAIL** |

这些结果见 [jvm-failures.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/jvm-failures.json) 及其引用的最新 JUnit XML。它们不能由另加显式默认币种 / 证明的独立回放覆盖。

`G-REUSED-014` 复用上述 `offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive`，冻结状态 **PASS → FAIL**；它不是额外一次执行。前一版 `delivery-current/failure-ledger.json` 曾继承 `actual.junit = PASS` 及旧说明，与本轮 FAIL 不一致。collector 已在 **delivery-current-r2** 中按当前 JUnit 修正 actual；旧版保留以披露汇总错误，不能用旧继承字段宣称 PASS。

冻结 608 中其余明确 FAIL 是 **E004 / E007 / E008**：原预期 amount_minor=1、EXPENSE、可入账；实际 amount=null、direction=null、completion=false。这是旧“已被合成用户领取 / 无符号 0.01”页面语义目标未满足，不能因金额引擎可表达 0.01 就宣布解决，也不能将其伪装为本轮 P04 已修复。4 个 A FAIL + 3 个 E FAIL + G-REUSED-014 构成冻结 608 的 8 FAIL；完整错误见 [failure-ledger.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/failure-ledger.json)。

## 4. P04 原 18 项：版本化驱动与原样结果并列

逐行 before / frozen_after / after 与适配说明见 [currency-18.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/currency-18.json)；输入完整性见 [input-integrity.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/input-integrity.json)。未改原 fixture 输入、原 `checkExpected` oracle 或 DOM `/800/`、`/200/` 断言。

| Case | 原样驱动 | 版本化驱动 | 差异 |
| --- | --- | --- | --- |
| D004 | EXPECTED_RED | PASS | 转发原 fixture 已声明的 `default_currency`，使用当前 policy2 |
| D008 | EXPECTED_RED | PASS | 同上 |
| D012 | PASS | PASS | 原驱动原断言已通过 |
| D016 | EXPECTED_RED | PASS | 转发原 fixture 已声明的 `default_currency`，使用当前 policy2 |
| D020 | EXPECTED_RED | PASS | 同上 |
| D024 | PASS | PASS | 原驱动原断言已通过 |
| DW-FMT-JPY-10000 | PASS | PASS | 原驱动原断言已通过 |
| DW-FMT-JPY-12345 | PASS | PASS | 原驱动原断言已通过 |
| DW-MIX-USD | PASS | PASS | 原驱动原断言已通过 |
| DW-MIX-EUR | PASS | PASS | 原驱动原断言已通过 |
| DW-MIX-HKD | PASS | PASS | 原驱动原断言已通过 |
| DW-MIX-GBP | PASS | PASS | 原驱动原断言已通过 |
| DW-MIX-JPY | PASS | PASS | 原驱动原断言已通过 |
| DW-HISTORY-2026-10-18 | PASS | PASS | 原驱动原断言已通过 |
| DW-HISTORY-2026-10-19 | PASS | PASS | 原驱动原断言已通过 |
| DW-FX-MISSING-OFFLINE | PASS | PASS | 原驱动原断言已通过 |
| DW-DOM-MIXED-budget | EXPECTED_RED | PASS | 转发原声明 `synthetic_rate=7` / date，使用 protocol2 与真实产品 FX / D1 引用 |
| DW-DOM-MIXED-category | EXPECTED_RED | PASS | 同上 |

因此 18 PASS 是**当前版本化驱动合同**结果；原样驱动仍为 **12 PASS / 6 EXPECTED_RED**。适配补齐调用方未转发的原声明参数，没有改变 800 CNY 的正确折算目标，也没有以拒绝输入代替成功。合成率明确是测试数据，不是实际成交汇率或业务凭证。原 D 驱动的 snake_case 反射探针不等于 FO6 业务结果；FO6 的真实持久化 / 回执 / 通知证据需独立判断。

## 5. 本轮实际产品修复与 OCR 安全余项

| 修复 / attempt | 实际变化 / 结果 | 范围 |
| --- | --- | --- |
| `2e1e224` | 产品 OCR 入口传递账户币种上下文与当前 policy2，避免外币被旧默认策略拒绝、未知 `¥` 被猜成 CNY | 产品修复，不改原七个 bitmap 金额 / 预期 |
| `73764f7` | JPY 二次金额区域确认继续使用币种上下文 / 精度；FX 获取兼容 workerd 的 redirect 行为 | 产品修复；完整源码身份为本台账第 1 节 tested_head |
| 新 OCR unit | **8 PASS** | `E/ocr-unit-r1/junit/TEST-uk.thewyj.app.task21.payment.CurrencyOcrPipelineTest.xml`；已包含标准 730，不另累计 |
| 实际 workerd FX 合同 | **3 FAIL → 3 PASS** | `E/fx-worker-contract-before-r1.json` / `after-r1.json`；实际运行但使用受控响应，upstream_requests=0，不是公开提供方实读 |
| Hosted FX r1 → r2 | 2 PASS / 1 FAIL → **4 PASS** | `E/hosted-fx-r2.json`，含登录与真实参考率缓存；provider-name 断言适配另列第 7 节 |
| 原七个实际 SDK / 产品 OCR 场景 before-r1 | **1 PASS / 6 FAIL** | 外币与未知币种故障原证据保留 |
| 首次修复 after-r1 | **6 PASS / 1 FAIL** | JPY 二次确认仍失败，没有提前关闭 |
| 最终修复 after-r2 | **7 PASS / 0 FAIL** | 实际已安装产品 `MlKitOcrEngine` / `PaymentScreenshotVerifier`，限定组件 |
| 最终同条件重复 | **30 × 7，全部 PASS** | 210 次向量执行，只有 7 个不同合成输入，不是 210 笔真实支付 |

证据为`E/samsung-product-ocr-money-before-r1-cases.json`、`E/samsung-product-ocr-money-after-r1-cases.json`、[最终r2](../migration-evidence/finance-p04/closure-current/samsung-product-ocr-money-after-r2.json)和[30轮系列](../migration-evidence/finance-p04/closure-current/samsung-ocr-series-r2.json)。七项覆盖CNY、JPY、USD、EUR、HKD、GBP及缺可靠币种`¥1.00`的拒绝输出；后者实际SDK曾读成`\1.00`，不能仅据该向量宣称正确识别裸yen后的币种拒绝已证实。下表safety的裸`¥100.00`在必需OCR完整时独立验证拒绝。原七项不验证真实账户角色、提供方operation或完整完成凭证。

最初重复执行器的第30轮输出名与summary冲突，实际上仅执行29轮；旧失败保留，修正独立前缀后重新执行series-r2完整30轮。最终30轮来自新系列，不将首次未运行轮次补成PASS。

新增 safety10 的实际结果是 **8 PASS / 2 NOT_TESTED；组级断言 FAIL**，不是 10 PASS：

| Safety case | 状态 | 实证 |
| --- | --- | --- |
| ambiguous-yen-without-default | PASS | 必需 OCR 证据已识别，产品拒绝 |
| yen-conflicts-with-usd-default | PASS | 同上 |
| jpy-fraction-is-invalid | PASS | 同上 |
| explicit-usd-eur-conflict | **NOT_TESTED** | OCR 将“支付成功”识别成其他字，未保留场景要求的完成证据 |
| multiple-amounts-without-decisive-label | PASS | 必需 OCR 证据已识别，产品拒绝 |
| chat-is-not-a-payment-page | PASS | 所需聊天 / 金额证据已识别，产品拒绝 |
| product-price-is-not-a-payment-page | PASS | 所需商品 / 价格 / 购买证据已识别，产品拒绝 |
| password-page-is-not-evidence | **NOT_TESTED** | 同样未保留“支付成功”；空输出不足以证明目标安全条件 |
| pending-incoming-must-not-complete | PASS | CNY 1、INCOME、completion=false |
| pending-outgoing-must-not-complete | PASS | CNY 1、EXPENSE、completion=false |

[samsung-ocr-safety-r1.json](../migration-evidence/finance-p04/closure-current/samsung-ocr-safety-r1.json) 保留 `missing_observed_ocr` 和组级 FAIL。两项中产品 null 输出可能来自缺少完成文本，不能证明在完整冲突 / 密码证据下正确拒绝，故不计完整 PASS，也不伪称发现误入账。

## 6. 真实微信：方向冲突尚未归因或关闭

所有者声明既有CNY ¥0.01转账由分身付款、主微信收款，且本人已领取。最终取证前后OS metadata稳定在所列用户/`RemittanceDetailUI`，但QA使用UiAutomation全屏截图/根节点，产品API34使用窗口截图；**截图层profile归属NOT TESTED**，不能把OS metadata稳定当作截图/账户一致证明：

| 稳定窗口 | 完整已安装产品 OCR | 财务写入 | 结论 |
| --- | --- | --- | --- |
| OS metadata user0，QA截图profile未证 | CNY / amount_minor **1** / **INCOME** / completion=true | **0 ledger** | 指定截图金额/状态组件观察，不是完整E2E或user0服务采集证明 |
| OS metadata user95，QA截图profile未证 | CNY / amount_minor **1** / **INCOME** / completion=true | **0 ledger** | 标为分身probe与付款声明不一致，**INCONCLUSIVE**；非已确认产品方向缺陷 |

证据见`E/wechat-main-receipt-final-r1-source-window.json`、`E/wechat-clone-receipt-final-r2-source-window.json`、对应组件JSON及[最终角色事实](../migration-evidence/finance-p04/closure-current/wechat-final-role-facts-r2.json)。没有足够证据确认产品方向缺陷或QA跨profile观察缺陷；须先证明截图/窗口/profile同源。当前前台已非指定交易、旧task不可用时，不扫描无关App/聊天重找。也不虚构operationID/revision/交易时间/引用，不用同额跨profile合并或生成第二笔支出/两笔收入。

真实通知 → 识别 / 票据 → Room / Outbox → Hosted 回执 → 同事件三页面链尚未串通，W01–W10 **0/10 完整 PASS，全部完整链路 NOT_TESTED**。只读 probe 不构成完整支付验收。工具没有新增支付、转账、领取或消息操作；原始私人材料保持受限，不在本台账复制金融文本。

## 7. QA / 命令失败与有限重试

以下是测试设施、调用方式或执行过程的实际失败。成功重试仅证明其列明范围，不删除原记录，不把产品断言未执行的命令算通过。命令清单见 [command-failures.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/command-failures.json)，URI 重试明细见 [qa-retries.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/qa-retries.json)。

| 失败 / 诊断 | 原结果与处理 | 当前状态 / 范围 |
| --- | --- | --- |
| Hosted binding / 部署配置错误 | 误绑定到既有共享 Preview；随后改为专用 QA 绑定；对旧 Preview 审计发现本轮 3 次登录 audit | QA 隔离失误已披露；不能宣称整轮零共享 Preview 副作用。`E/hosted-bindings-before-fix/`、`after-fix/`、`final/`、`cloud-old-preview-own-audit/` 保留 |
| `stdin exec-in` 写入 fixture | 280-byte 源到设备成为 0-byte 空文件，非有效 JSON | [原诊断](../migration-evidence/finance-p04/closure-current/hosted-test-fixture-r1-diagnostic.json)；改 `shell -T` 后 27-byte canary 原样读回，[canary](../migration-evidence/finance-p04/closure-current/adb-stdin-canary.json)；只证明传输修正 |
| Native Hosted seed r1 | **1 FAIL**，`app_device_id_invalid`，尚未进入目标 commit 断言 | QA 固定 device ID 无效，改用产品 `DeviceIdentityStore`；原 [r1](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r1.json) / log 保留 |
| Native Hosted seed r2 | **1 FAIL**，`Real hosted commit occurred` 断言失败；已定位 6 条 `provider_reference_invalid`，合成引用长 46 字符，超过现行 40 上限 | [r2](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r2.json) / log 与 `native-hosted-server-diagnostic.json` 保留；原 6 请求未改，实际服务端无对应事件。是 QA 合成输入错误，原 r2 不改 PASS |
| Native Hosted 独立 r3 | 新有效引用的独立数据集 seed **1 PASS**、restore **1 PASS** | [seed-r3](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r3.json) / [restore-r3](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-restore-r3.json)：实际 Task20 / HTTPS，六币种各 1 最小单位，提交后丢 ACK、跨进程重新登录、精确 Outbox 重放、另账户不可见；不是微信，不覆盖原 r2 |
| Gradle `R-def` 缓存缺件 | QA 构建遭遇增量缓存缺失；以 freshTasks 重建所需任务修复 | 属构建设施恢复，不能代替业务断言；保留原失败与后续构建证据，不改产品依赖 / oracle |
| current-projection 第一次 | Windows 绝对路径直接给 ESM `--import` 导致退出 1，产品断言未运行 | 改成对应 `file:///` URI 后 r2 退出 0 / PASS；源码、输入、断言不变，行只计一次，原 FAIL 保留 |
| collector `original` 变量遮蔽及 G 继承 actual | 汇总过程曾 KeyError；前版另有 G 行继承 actual 的时效错误 | 修正后实际生成本文件引用的 D/，G actual 已取当前 JUnit；见 `summary.json` / manifest，是 QA 汇总修复，不改原执行结论 |
| Hosted FX provider-name 断言 | r1 为 2 PASS / 1 FAIL；r2 的名称断言规范为 canonical 大写 `Frankfurter` 后为 4 PASS | `E/hosted-fx-r2-adaptation.json` 披露适配；金额 / 日期 / 货币断言不变，不能写成所有断言逐字未变 |
| 原 aeris-dom | exit 1 | 原两条 Chrome FAIL 保留，第 3 节 |
| 原 task21 旧协议 | exit 1 | 不带 capability3 的原请求仍失败；只补 capability3、保留原输入与 221 行断言的独立派生回放 PASS，不覆盖原协议 FAIL |
| p02-web / p02-dom | 各 exit 1，原目标红 | `expected_red=true` 仍是未满足的合同，不算命令 PASS |
| frozen-native | exit 1 | 矩阵原 FAIL / EXPECTED_RED 保留 |
| legacy-bridge-seed | exit 1；原隐式 CNY seed 预期 3 笔，实际 1 | 原 fixture 未改；restore 未执行，legacy bridge = **NOT_TESTED**、requests=0；显式默认币种的独立回放另列 |

Android 最终组合命令本身 exit 1，虽通过 `--continue` 产生 lint / Debug APK，仍不能把标准 JVM 6 FAIL 抹去。正常进程服务对照和后续组件通过，也不覆盖早期 Samsung instrumentation 的无障碍绑定与通知监听各 1 FAIL；P03 历史 Activity 异常保持 INCONCLUSIVE。

## 8. 尚未执行和关闭边界

本台账没有重新验证其余设备 / Hosted / Production 项目。源版本不对应最终 tested_head 的早期组件通过保持早期身份；最终版本缺少对应重测的完整场景仍 **NOT_TESTED**。实际 Samsung 组件、真实微信和早期对照详见 [SAMSUNG_AND_WECHAT_ACCEPTANCE.md](SAMSUNG_AND_WECHAT_ACCEPTANCE.md)，数据库恢复的合成与正式边界见 [DATABASE_RECOVERY_AND_COMPATIBILITY.md](DATABASE_RECOVERY_AND_COMPATIBILITY.md)。

尚无本轮完整证据的项目包括：真实通知自动交付与同事件服务链、90 秒票据、真实微信账户切换 / 生命周期 / 断网恢复、真实微信 Room / Outbox / 云回执 / 三页闭环、W01–W10、个人正式备份恢复、Production 迁移 / D1 / R2 / Stable / 正式 APK 发布以及 CI 门禁。这些项目均不由本地、合成 Hosted、组件 OCR、桌面浏览器或构建产物自动转成 PASS。独立合成 NativeCloud r3 只关闭其列明的合成云链场景；真实支付宝支付不在最新要求范围，不补造结果。

<!-- FINAL_DEVICE_RETEST_STATUS -->
最终`73764f7`已执行：登录1 PASS、既有合成账冷重读1 PASS、Room3 PASS、六币种3 PASS、MainActivity三个合成Web表面1 PASS（`E/samsung-final-components.json`）；四组件seed/restore各1 PASS且QA偏好SHA原样恢复（`E/samsung-final-backup-guard.json`）；正常进程OS通知4次投递/更新/重投及1移除PASS、实际Room归档/0账目增量（`E/normal-notifications-final.json`）；生命周期矩阵 **30/30 PASS，956–1158ms/轮**（`E/samsung-final-normal-lifecycle-30-r1.json`）。不借计94ab0fc，不把这些合成范围当微信。

最终smoke **1 FAIL**：受控gate此前已开启而原断言要求关闭；封存后仅关闭QA guard，相同断言[1 PASS](../migration-evidence/finance-p04/closure-current/samsung-final-smoke-after-cleanup-r2.json)，不覆盖原FAIL或声称全新安装默认值。最终息屏[1 FAIL](../migration-evidence/finance-p04/closure-current/samsung-final-normal-screen-r1.json)：正常唤醒后secure keyguard仍需本人认证，20秒原检查失败；所有者解锁后仅[观察MainActivity RESUMED](../migration-evidence/finance-p04/closure-current/samsung-post-owner-unlock-observation.json)，未延长/重启断言或绕过认证。

[phone-final-data-seal](../migration-evidence/finance-p04/closure-current/phone-final-data-seal.json) PASS：实际安装APK匹配最终SHA、本轮QA冷数据5,658,112 bytes、SHA-256 `5dacd2735284a15dd94cc968b8270a4741601ce594c3ecf4915d3fe1b5a127a8`；8份受限真实详情密文有DPAPI/AES-GCM恢复校验，未导出明文密钥或正式数据。该封存不证明跨设备凭据恢复，不预支卸载/撤权/正式权限恢复结果。

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
实际清理已完成：4个owned APK卸载、QA敏感授权撤销，正式无障碍TRUE/通知监听FALSE/1.3.37 code50读回；49个exact-owned手机dump删除。最新D1备份恢复105表/19合成账/25财务回执/6通知回执/外键0后，owned Pages项目4部署与2独立D1删除，正式/共享D1和owner Wrangler keyring保留。Windows缓存及5个合成Chrome profile合计13,807文件/1,471,872,541逻辑字节删除；原失败、源码、必要备份及证据保留。详见[CLEANUP_REPORT.md](CLEANUP_REPORT.md)。最终13组保护已PASS（E/protected-final.comparison.json，无added/missing/changed，8个Git工作树HEAD/branch/status相同）；最终Git SHA和总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。

收尾新增QA记录：cloud cleanup r1只在解析Project Name/name时失败，尚未发delete；r2修正输出适配后删除并回读PASS；旧3个Chrome删除政策拒绝保留，本次所有者明确授权fresh whole-root扫描后删除成功，不将历史拒绝抹除。一次403响应headers诊断自动审批拒绝、无更具体理由；动作未执行且未绕过。备份preflight工具9 PASS仅QA内存预检，不是产品备份管理器。所有后续清理成功不改变原业务FAIL/EXPECTED_RED或PARTIAL状态。

P03 原 26、原 607 / 标准 JVM 的失败、安全集两项未执行与真实微信付款角色冲突共同限制结论。后续只能在明确范围内补足合法证据与相应回归，保留冻结真值和既有失败；当前不宣称产品完整验收或发布完成。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。
