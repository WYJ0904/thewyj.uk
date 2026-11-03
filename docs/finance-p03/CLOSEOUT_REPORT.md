# FINANCE-P03 收尾报告

日期：2026-10-19（Asia/Hong_Kong；执行UTC时间见机器日志）。基线 `81d5aa7cc51b55d386b59414019c4a0f01272032`；实施提交 `69993ac2e738147ca49e5c407eae6eab39aa90f4`；分支 `codex/finance-p03-identity-preauth`。最终交付HEAD、tree和Debug APK SHA-256见 [CLOSEOUT_REVISION.json](../migration-evidence/finance-p03/closeout/CLOSEOUT_REVISION.json)。


**最终状态：PARTIAL。可提交所有者进行范围审核，不建议据此无条件关闭整个P03。**

开始时实际HEAD严格等于交接SHA、分支正确且工作树干净，才进行修改。已逐项读取原十一份报告、冻结608行及原始JSON/NDJSON；原报告、P02源码和800份既有P03证据字节hash保持。没有重置、重建仓库或覆盖旧工作。

已补足：处理中/完成事实区分、完成见证恢复与旧intent回放保护；显式授权家族+独立操作引用下的多次部分Capture、部分解除、多次/完整退款、超额退款/解冻阻断、乱序依赖恢复、显式到期、原授权与清算额不相等、不可安全表示的历史总额隔离。授权本身不入支出。已增加可重建的源清算投影和两项可选结构化证据，复用原recognition、candidate、outbox和正式账本，保持已有ID。D1账本写入与余额CHECK及回执可见性同批提交，避免两个并发退款通过各自JavaScript检查后共同超额。

C005仍保留原170目标和EXPECTED_RED：原80账目保留，90证据待核实。本轮中间实现曾把全量解除残额错误断言为120；新增可失败回归后改为未知/null。C007原170目标同样未改，缺引用时0正式账不能冒充其PASS。有明确独立Capture引用的80+90实际路径则记两笔、合计170，解除原授权残余30。状态版本>1明确识别并保留，但自动修正已有账目尚未实现；不会把90当作新支出或覆盖80。

| 本轮有效集合 | 结果 |
| --- | --- |
| 原607方法/脚本集合 | 607 PASS / 0 FAIL / 0 SKIP；保留前轮已披露的3个夹具合同条件 |
| 原P03新增63 | {'PASS': 63}；迁移目标续接12/4，原ID/金额/回执断言保留 |
| 本轮新增41 | {'PASS': 41}；18 JVM、16服务、5 D1迁移/恢复、2新桥接 |
| 标准JVM总数 | 632 PASS；包含588原有+26前轮P03+18本轮新增，不与上述集合相加 |
| DB/outbox快照加强复验 | 同5个方法另跑PASS，不另计5个新用例 |
| Lint / Debug | PASS；告警实际为 {'Warning': 85, 'Hint': 12} |
| 冻结608行 | {'PASS': 536, 'FAIL': 7, 'EXPECTED_RED': 42, 'NOT_TESTED': 23}；26条复用本轮JUnit，不重复计数 |

两组双JVM桥接均真实使用Room文件、outbox、HTTP和本地D1。原场景最终3账/2待核实/9请求；新清算场景4账/1版本修正待核实/至少15请求，USD支出170、退款50、源净额120，队列空且ID稳定。前者首笔支付已提交后503；后者首个授权事件已提交后503，均使用原操作ID恢复。二者都是合成账户，不能当作Hosted登录、真实云同步或Samsung验收。

迁移结果：Room11→12增量成功，中断事务回滚后重试成功，重复DDL明确拒绝；真实v11 Room opener对v12失败关闭且旧行不变。D1 3→4同样验证回滚、重试及重复拒绝；从81提取的实际旧v3 API返回503 schema_not_ready。逻辑快照在新D1 runtime恢复全部应用表、原财务ID/回执及自增水位700；Room关闭后的DB和outbox分别配对快照已验证。持久化Miniflare二进制快照探针阻断，真实云端/正式App备份与恢复仍NOT TESTED。

剩余范围：自动修正/Capture重归属、弱引用历史候选到权威账目的安全映射、真实提供方对操作ID/版本语义的证明、真实备份/回退门禁。净额投影表示已接收源清算事实；用户编辑/删除后的正式账本统计仍由原Task16链路负责，不拿源投影覆盖它。P04币种展示/FX、P05 OCR、P06 AI继续保留原红灯，未开发。

建议所有者只接受“可靠独立操作的基础清算及明确隔离合同”子范围；未接受上述业务边界、未补完修正映射和正式备份条件前，P03保持PARTIAL。没有进行手机/ADB、真实支付、正式App数据迁移、Production、PR、推送、合并、正式签名或发布；D-01/D-02保持CLOSED，Task26豁免不改成PASS。

- [身份、金额与隔离合同](CLOSEOUT_LIFECYCLE_CONTRACT.md)
- [迁移、回退与部署阻断手册](CLOSEOUT_MIGRATION_RUNBOOK.md)
- [全部608行及新增/既有P03矩阵](CLOSEOUT_TEST_MATRIX.md)
- [命令、失败账本与保护核验](CLOSEOUT_TEST_RUNS.md)

## 本轮全部产品差异

- `android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/12.json`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureContracts.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationIngestClient.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/AndroidPaymentRecognitionHook.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/LocalPaymentLedger.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentEventSafety.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentLifecycleBalance.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionModel.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecords.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentVerificationCenter.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/NotificationDatabase.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentEntities.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentRecognitionStore.kt`
- `cloudflare/migrations/0028_payment_lifecycle_accounting.sql`
- `functions/_lib/task21-event-safety.mjs`
- `functions/_lib/task21-lifecycle.mjs`
- `functions/_lib/task21-model.mjs`
- `functions/_lib/task21-service.mjs`