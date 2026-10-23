# FINANCE-P04 统一最终报告

2026-10-23，Asia/Hong_Kong。**P04 = PARTIAL；本轮授权的非手机实现、修复和验证已完成并本地交付。** 原18项业务合同已验证18 PASS；原607仍602 PASS/5 FAIL，P03原26仍4 FAIL/22 EXPECTED_RED，不能宣布整体COMPLETE。没有以合成数据替代真实交易验收。

## 来源和执行边界

本地接回云端完整代码/证据后执行，云端没有继续接收开发任务。隔离工作树 `C:\Users\78252\.codex\worktrees\finance-p04-multicurrency\thewyj.uk`，分支`codex/finance-p04-multicurrency`。继承`5d96e1e → dd5fc98b → 3b710e3 → 1abeba2 → 02cc8e3 → 70ee5a3 → 1979fcb → 94ab0fc82bc5b21b4f04237ff110574d10da565c`。产品验收源码SHA为 `94ab0fc82bc5b21b4f04237ff110574d10da565c`；后续仅QA路径/报告提交由REVISION.json固定，避免文档自引用。P03仍统一于[同一份报告](../finance-p03/FINANCE_P03_FINAL_REPORT.md)。

完整handoff ZIP SHA-256 `b18fad4b0d6be6582272360d1c01ad79e2fed9bcb9ff8f5f7e53450785813294`，增量bundle SHA-256 `171a0f42cecc8b1dcef1df11871da686c097116bb4f56f90f85be7dd561848bc`。已验证87源码blob与1888证据副本，CRLF差异不当作产品差异。旧Windows检查点和P01/P02历史结论不改。原始JUnit身份另从Windows受保护P03旧目录只读核对，历史PASS不计新通过。

本轮仅在 Windows 隔离工作树完成非手机工程；不读取正式交易/聊天/私库，不操作 ADB、手机、正式 App/权限、Production、签名、推送、PR、合并或发布。P05/P06 未开发。D-01/D-02 保持 CLOSED；P03 另一个历史 Activity 异常仍为 INCONCLUSIVE，未用新的通过结果解释其根因。

原 607 的实际结果为 **602 PASS / 5 FAIL**（588 JVM 中585 PASS/3 FAIL，13 Node PASS，6 Chrome 中4 PASS/2 FAIL；全部执行，无 NOT_RUN）。标准 JVM **716 PASS / 6 FAIL**，其中原681为675 PASS/6 FAIL，P04方法41 PASS（本地新增17，云端原有24，已包含在722中）。这些集合重叠，禁止相加。

原冻结驱动608行 **549 PASS / 8 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED**。保留这份原样重放；另以相同原 fixture/expected/oracle、正确传入原声明参数的版本化驱动复核 P04 后，合同608为 **555 PASS / 8 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED**。两份不是同一个执行结果，不互相覆盖。原 P04 18 项合同 **18 PASS**；原样驱动仍是12 PASS/6 EXPECTED_RED，缺参修复和哈希证明见逐行账本。

本轮完整统计及所有原始错误：[统计](../migration-evidence/finance-p04/local/final-r2/delivery-v2/summary.json)、[607逐项](../migration-evidence/finance-p04/local/final-r2/delivery-v2/original-607.json)、[原样608](../migration-evidence/finance-p04/local/final-r2/delivery-v2/frozen-608.json)、[合同复核608](../migration-evidence/finance-p04/local/final-r2/delivery-v2/contract-608.json)、[6个JVM失败](../migration-evidence/finance-p04/local/final-r2/delivery-v2/jvm-failures.json)。


## 已实现的六币种与资金合同

| 币种 | ISO小数位 | 持久化/精确计算/API/Web/Android |
| --- | --- | --- |
| CNY/USD/EUR/HKD/GBP | 2 | 全部已实现；各币种支出/收入/退款及清算经合成服务/D1验证 |
| JPY | 0 | 明确零位；JPY整数不除100，过精度拒绝/保留待核实；旧未证单位不擅自重标 |

每笔保留原ID、时间、来源、引用、原始金额与币种；交易/账户/展示币种及可空的识别默认币种分开。跨币种不直接累加，参考折算不改原账。JS用BigInt有理数，Kotlin用Long最小单位/BigDecimal换算；统一HALF_EVEN，只在最终目标单位舍入。输入严格精度，溢出/未知币种/缺金额/错误小数/科学计数等失败关闭，不默认为人民币。单笔业务上限沿用1e13最小单位；负值/退款/冲正的换算按精确规则，账务方向与金额绝对值分离。

原币/清算/费用角色分别保存，不把授权或参考FX记成支出；多次Capture、部分清算、解除/过期、退款及剩余冻结按P03来源/版本合同处理，同币种内核算净支出与冻结。新币种/展示设置不能构造独立交易身份、清除P03待核实或绕过提供方证明。旧请求、人工修改、原账ID、关系、Outbox和回执控制保持。

本地新增修复：

1. Android hook的policy2不再取决于是否注入Room store；无账户结果不猜CNY。对可信已归属引用的重投冻结原币种决议，偏好变化不另生成记录；不把引用或币种当作独立Capture证明。
2. 默认币种只是账户决议，不冒充通知中的ISO证据。持久化`currency_review_required/decision_source`，可靠支付可先入账并非阻塞提醒；通知拒绝不消耗提醒，成功后重复/重启不再提醒。人工明确编辑和精确当前回执清除标记，旧账户/旧epoch不能覆盖新状态。
3. 仍可调用的raw_event.ingest改走精确金额/币种路径：修复缺币种猜CNY、USD多位小数截断、JPY整数不能使用的问题；有默认时记录来源，无默认时保留未知/待核实。金额恢复仍需原完成语义，不把预计收入、退款申请当实付。旧纯函数兼容默认1只用于冻结/历史调用，实际写入路径固定policy2。
4. Web未知币种编辑器要求显式选择并重新输入金额，源事件不改；Android用独立持久化`/api/notification/review/confirm`命令确认canonical原事件，不重写旧ingest。已确认后旧命令与新人工金额冲突时409，不能覆盖或另入账；提供方语义/预授权门槛不因选币种放松。
5. 同一文件的多个队列实例共用锁；60并发操作完整保留。旧协议拒绝到上限可持久化地仅重试一次capability3，仍拒绝则停止；五列格式、原body/ID不改。空200/错金额/错币种/错事件不能吞掉货币确认请求。

## FX提供方、缓存和历史

采用公开合法、无key的Frankfurter v2 daily reference适配器，接口`/v2/rate/{base}/{quote}?date=YYYY-MM-DD`；来源是市场参考，**不是银行/支付通道成交汇率**。源码保存精确十进制lexeme，验证币种对、类型、日期、正数及范围；参考日期按交易UTC日，允许此前营业日最多7日。保存base/quote/rate/source/rate_timestamp/fetched_at/expires_at/rounding与完整性hash，不重复覆盖交易事实。

当前缓存6小时、同pair/date并发去重、完整性验证、安全更新、离线读取、历史引用按交易ID/revision/展示币种冻结。来源更新不修改旧引用，也不触发第二笔财务同步。同币种/正反向/交叉换算、负数/零/大小额/非法率和日期边界已有独立回归。缺失/过期且无法合法获取时明确不可用；不造1:1。Worker正文按64KiB流式限额及严格UTF-8，保留原8秒请求/7秒批次上限，未延长超时。12项公开提供方实读通过，另22项模拟缓存/错误/边界通过；合成率7等明确market_data=false，不当作真实行情或支付凭证。

## Web及Android适配

| 表面 | 已实施与覆盖 |
| --- | --- |
| 财务首页/余额/收支/月份 | 统一原币或明确参考折算；不可换算部分分币保留 |
| 历史/详情/退款与冲正 | 原币/金额/关系保留，显示参考与来源，不重写ID和原事件 |
| 分类/预算/剩余 | 币种分组和引用一致；缺汇率不显示虚假完整剩余；默认/展示变更失效缓存 |
| 手工新增/修改 | 六币种选择、JPY零位、严格精度；人工优先及CAS仍有效 |
| 待核实 | 未知币种不预选CNY、不预填未证单位；显式选择后重输金额；默认决议提醒可稍后更正 |
| 同步/离线/缓存 | 原Outbox优先保留；FX配额清理不丢财务重放；过期/缺FX有明确提示 |
| Service Worker | shell命名空间finance-money-v3，精度模块仍money_version2，传输capability3；旧缓存更新已由真实Chrome验证 |
| Android原生链 | Kotlin金额模型、Room、Repo、通知/手工/离线队列、原币显示、UI线程与生命周期保护回归；真实手机/UI/锁屏行为NOT_TESTED |

## 增量迁移、兼容与可执行恢复边界

Room主库14→15保留旧单位事实，旧JPY为未证；15→16仅新增3个决议/通知字段，旧行默认false/空，不把历史人民币改币或再生成账。FX/人工币种决议库为新独立v1，**含不可丢的manual decisions/source units/default preferences，不能把它当纯可删缓存**。旧实体升级、全链、事务中断回滚/重试、重复打开、原ID/金额/时间/人工修改/回执/Outbox均验证。旧v14/v15 opener对16拒绝降级，没有清库。

D1用0031/0032/0033增量；当前Task16元数据5、Task21为9。0033只新增决议列并重建有效视图，不删表/重算旧账。12项前迁移/回执/恢复及8项新决议迁移全部通过，涵盖部分失败、重复DDL、旧服务器拒绝新库、精确老回执、新旧协议、完整逻辑恢复和独立SQLite重开。旧客户端不能静默读取外币/丢弃待核实标记；新服务仍可重放已验证旧body，未证JPY不自动缩放。

实际跨两JVM恢复四个合成组件：主库16、FX/人工决议库1、五列Outbox、仅币种偏好SharedPreferences。先停止写入并关闭两库、等待队列和偏好落盘，再保存**同一账户/同一时点/版本+四文件SHA清单**，恢复前拒绝缺件、错账户或校验失败。两个JVM分别PID42184/36996，冷读取恢复决议/默认币种/原始未知值/历史引用与精确队列。凭据不在这四件中，恢复后另正常登录。

**Git回退不是数据库回退。** 只支持完整一致备份在同/更高兼容版本恢复；升级后有新账/新队列时禁止以旧快照配旧APK“回退”，也禁止清库、丢账或重建用户数据。服务端必须先完成隔离验证的5/9迁移及capability3接口，再考虑客户端放行；Production迁移/备份/部署和真正个人备份均NOT_TESTED、没有授权。本地Miniflare物理目录恢复与Production Time Travel不是一回事。

Windows QA另有已确认路径兼容问题：同脚本SHA/同105表快照SHA，253字符SQLite路径失败，217字符短路径通过；具体journal的MAX_PATH调用机制未取得Win32栈，标PROBABLE。框架现自动避开预计journal>=260的Windows运行目录，默认命令恢复/二进制复制/重开105表通过；初始失败与强制长路径FAIL、3次短路径PASS均保存。没有提高timeout、关FK或改数据/断言，也不把它归为Android/Samsung故障。

## 本轮实际回归

| 集合 | 数量与结果 | 证据 |
| --- | --- | --- |
| HTTP_D1 | 39 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/contracts/contracts.json) |
| migration_restore | 12 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/migrations/migrations.json) |
| default_review_migration | 8 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/review-migrations/review-migrations.json) |
| default_review | 11 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/default-currency/default-currency.json) |
| Chromium | 18 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/browser/browser.json) |
| live_FX | 12 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/live-fx/live-fx.json) |
| raw_transport | 36 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/raw-transport/raw-transport.json) |
| unit_review | 19 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/unit-review/unit-review.json) |
| exact_money | 76 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/money.log) |
| simulated_FX | 22 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/fx.log) |
| independent_Decimal_oracle | 219 PASS | [证据](../migration-evidence/finance-p04/local/final-r2/regression/oracle.log) |

标准722、原607、原681及P03重叠集结果见上文与P03统一报告。219为216个Decimal向量加3个边界检查，向量也在JVM方法内执行，不与方法数相加。Node34个脚本整组退出1的原因为原aeris-dom、旧无capability的Task21、P02原web/DOM目标红；其他独立脚本继续执行。只加capability3、不改原输入/221行断言的Task21独立重放全通过，不能覆盖原旧协议FAIL。

Lint **0 Error/Fatal、86 Warning/12 Hint**；比云端76 Warning多出的10项均为依赖/SDK新版本提示，锁定依赖未改。Debug已实际构建（全组`--continue`），applicationId `uk.thewyj.app.debug`，version 1.3.37-debug/50；未安装。APK `83068276` bytes，SHA-256 **`cc73b16ae40271b2299621c0405f15b946f48df565ec9e55f3bf2076b80a3f6f`**，见 [完整构建记录](../migration-evidence/finance-p04/local/final-r2/android-current/command.json)。npm lock SHA `75f023a2e4a47d248d3246e1b3c7e4a86ab7e5739b105b37ca8320021a1fdeb3`；Node22.23.3、JDK21.0.10、SDK36/BuildTools36、Gradle9.4.1，未升级产品依赖。

原18逐行输入/预期/故障/当前实际与责任见 [逐行账本](CURRENCY_18_LEDGER.md)。原26 P03业务目标仍红；E004/E007/E008是P05“已被合成用户领取/无符号0.01”旧文本语义故障，不伪装成金额引擎或新P04修复；`G-REUSED-014`新增FAIL及原607五FAIL明确保留。金额引擎能表示最小单位，不代表未获完成/币种证明的页面必须自动入账。

## 保护、残留和剩余授权

13组保护全部无变更（最终重复核验/完整哈希随provenance）。主工作区仍e2febc6的旧Hotfix分支及原dirty状态，Task26 waiver、Hotfix、D01/D02、P02原证据/材料和正式APK文件均保持；原P03工作树仍5d96e1e，未操作其tracked内容。正式设备/生产数据本身未读取，内容“完全没变”不能冒充已验证。

保留所有raw、失败/控制组、SQLite/物理副本、APK、源/证据SHA、原ZIP/bundle、必要夹具。build/node_modules为可重建本地缓存；三个人工隔离Chrome测试profile还在用户Temp中：删除被自动审批审查以“blocked by policy”拒绝，未给具体理由，未尝试其他删除方式；详见 [残留清单](../migration-evidence/finance-p04/local/final-r2/profile-cleanup-blocked.json)。没有删除手机文件或恢复正式监听。

尚需所有者最少处置：合法真实提供方独立操作/账户/版本/前驱证明；决定旧无币种冻结验收前提与P04新安全合同的冲突；以后单独授权真实通知/无障碍、RC-6、真实云持久化/幂等、真实MainActivity/三页面/后台锁屏、微信W01–W10及个人备份验证。所有这些真实业务项 **NOT_TESTED**；本轮没有自动支付/消息/无关聊天读取或生产财务写入。P03/P04均不具备整体COMPLETE关闭条件，停止等待所有者审核，不进入P05/P06。

## 修改文件与提交

以下为相对P03原5d96e1e的继承变更及本轮QA/报告文件；产品源码固定94ab0fc，最终本地QA/报告提交见[REVISION](../migration-evidence/finance-p04/local/final-r2/REVISION.json)及[完整SHA封存](../migration-evidence/finance-p04/local/final-r2/provenance.json)。未修改主工作区/Task26，没有push、PR、merge或发布。

- `android/app/schemas/uk.thewyj.app.finance.CurrencyReferenceDatabase/1.json`
- `android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/15.json`
- `android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/16.json`
- `android/app/src/main/java/uk/thewyj/app/core/network/ThewyjApiClient.kt`
- `android/app/src/main/java/uk/thewyj/app/finance/CurrencyDecision.kt`
- `android/app/src/main/java/uk/thewyj/app/finance/CurrencyLedgerUnits.kt`
- `android/app/src/main/java/uk/thewyj/app/finance/CurrencyMoney.kt`
- `android/app/src/main/java/uk/thewyj/app/finance/CurrencyReferenceDatabase.kt`
- `android/app/src/main/java/uk/thewyj/app/finance/CurrencyReferenceRepository.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureContracts.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationIngestClient.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/AndroidPaymentRecognitionHook.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/CanonicalPendingCache.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/LocalPaymentBooking.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/LocalPaymentLedger.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentHintSync.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageSemantics.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionModel.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecords.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentVerificationCenter.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/SourceParsers.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/ThewyjPaymentAccessibilityService.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/NotificationDatabase.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentEntities.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentRecognitionStore.kt`
- `android/app/src/main/java/uk/thewyj/app/ui/NotificationArchiveScreen.kt`
- `android/app/src/main/java/uk/thewyj/app/ui/NotificationHubScreen.kt`
- `android/app/src/main/java/uk/thewyj/app/ui/PaymentVerificationScreen.kt`
- `android/app/src/main/java/uk/thewyj/app/ui/PaymentVerificationState.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyDefaultReviewTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyFrozenDefaultsTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyLedgerMigrationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyMoneyTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyReferenceRoomTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyReviewMigrationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyReviewQueueTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyTransportTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/CurrencyWireAndEnrichmentTest.kt`
- `android/app/src/test/java/uk/thewyj/app/finance/FrozenRoomFixture.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/payment/CurrencyHookParityTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03AMigrationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03CloseoutMigrationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03FinalMigrationTest.kt`
- `cloudflare/migrations/0031_finance_currency_fx.sql`
- `cloudflare/migrations/0032_notification_currency_units.sql`
- `cloudflare/migrations/0033_currency_default_review.sql`
- `docs/CLOUD_FINANCE_ENVIRONMENT.md`
- `docs/finance-p03/FINANCE_P03_FINAL_REPORT.md`
- `docs/finance-p04/CURRENCY_18_LEDGER.md`
- `docs/finance-p04/FINANCE_P04_FINAL_REPORT.md`
- `docs/finance-p04/VALIDATION_COMMANDS.md`
- `docs/finance-p04/WINDOWS_CONTINUATION_CHECKPOINT.md`
- `functions/_lib/cloudflare-foundation.mjs`
- `functions/_lib/finance-client-capability.mjs`
- `functions/_lib/finance-fx.mjs`
- `functions/_lib/finance-money-units.mjs`
- `functions/_lib/finance-raw-currency.mjs`
- `functions/_lib/finance-review-currency.mjs`
- `functions/_lib/finance-source-units.mjs`
- `functions/_lib/task16-api.mjs`
- `functions/_lib/task16-model.mjs`
- `functions/_lib/task16-service.mjs`
- `functions/_lib/task21-api.mjs`
- `functions/_lib/task21-event-safety.mjs`
- `functions/_lib/task21-hints.mjs`
- `functions/_lib/task21-model.mjs`
- `functions/_lib/task21-reconciliation.mjs`
- `functions/_lib/task21-service.mjs`
- `index.html`
- `js/core/api.js`
- `js/core/dashboard.js`
- `js/core/home-widget-data.js`
- `js/finance/app.js`
- `js/finance/candidates.js`
- `js/finance/format.js`
- `js/finance/money.js`
- `js/finance/notification-ledger.js`
- `qa/finance-p03/cloud/collect.py`
- `qa/finance-p03/cloud/fresh-inputs.mjs`
- `qa/finance-p03/cloud/jvm.py`
- `qa/finance-p03/cloud/run.py`
- `qa/finance-p03/nonphone/baseline.py`
- `qa/finance-p03/nonphone/close.py`
- `qa/finance-p03/nonphone/collect.py`
- `qa/finance-p03/nonphone/native-persist.mjs`
- `qa/finance-p03/nonphone/output-redirect.mjs`
- `qa/finance-p03/nonphone/prepare.py`
- `qa/finance-p03/nonphone/protect.py`
- `qa/finance-p03/nonphone/resume.ps1`
- `qa/finance-p03/nonphone/run.ps1`
- `qa/finance-p04/android.py`
- `qa/finance-p04/browser.mjs`
- `qa/finance-p04/collect-local.py`
- `qa/finance-p04/collect.py`
- `qa/finance-p04/contracts.mjs`
- `qa/finance-p04/default-currency.mjs`
- `qa/finance-p04/extra-native.py`
- `qa/finance-p04/fixture-check.mjs`
- `qa/finance-p04/fixture.mjs`
- `qa/finance-p04/fixtures/exact-oracle.json`
- `qa/finance-p04/fresh-inputs.mjs`
- `qa/finance-p04/fx.mjs`
- `qa/finance-p04/legacy-browser-all.mjs`
- `qa/finance-p04/legacy-browser-context.mjs`
- `qa/finance-p04/live-fx.mjs`
- `qa/finance-p04/migrations.mjs`
- `qa/finance-p04/money.mjs`
- `qa/finance-p04/oracle.mjs`
- `qa/finance-p04/oracle.py`
- `qa/finance-p04/output-redirect.mjs`
- `qa/finance-p04/output.mjs`
- `qa/finance-p04/prepare-backup-proof.py`
- `qa/finance-p04/prepare-baselines.py`
- `qa/finance-p04/prepare-contract-drivers.py`
- `qa/finance-p04/prepare-trace.py`
- `qa/finance-p04/raw-transport.mjs`
- `qa/finance-p04/review-migrations.mjs`
- `qa/finance-p04/run-regression-jvm.py`
- `qa/finance-p04/run-regression-node.py`
- `qa/finance-p04/seal-local-delivery.py`
- `qa/finance-p04/unit-review.mjs`
- `qa/finance-p04/upgraded-legacy-http.py`
- `qa/finance-p04/write-local-reports.py`
- `sw.js`
