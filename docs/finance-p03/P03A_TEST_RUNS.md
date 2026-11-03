# P03-A 运行、失败账本、保护与变更

最终本地提交、Git tree、APK SHA-256及证据seal见 [REVISION.json](../migration-evidence/finance-p03/phase-a/REVISION.json)；本轮无发布。

## 最终选取与真实命令

标准JVM/Lint/Debug选closure-full；矩阵选closure-p02-native、closure-p02-process；Node选node-closure；新服务选server-closure；新迁移选migration-final-role；桥接选closure-legacy、closure-closeout、closure-a-bridge。这是本轮新执行，不引用历史PASS。

Gradle实际参数向量、时间和真实退出码见各*-run.json。标准命令为 `./android/gradlew.bat -p ./android :app:testDebugUnitTest --rerun --no-daemon --console=plain :app:lintDebug --rerun :app:assembleDebug --rerun`。源JVM不加载桥接overlay；双JVM另按seed/restore执行，防止缺端口测试混入标准集合。完整复验示例见qa/finance-p03/phase-a/README.md。

| Node入口 | exit | 日志 |
| --- | --- | --- |
| `node local-backend/test_aeris_state_consistency.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/aeris-node.log` |
| `node qa/aeris/state-consistency-browser.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/aeris-dom.log` |
| `node local-backend/test_task21_notification_js.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/task21.log` |
| `node local-backend/test_task16_d1_js.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/task16.log` |
| `node local-backend/test_task17_d1_js.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/task17.log` |
| `node qa/finance-p03/server.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/p03-server.log` |
| `node qa/finance-p03/legacy-raw.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/p03-legacy.log` |
| `node qa/finance-p03/migration.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/p03-migration.log` |
| `node qa/finance-p03/closeout/clearing.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/closeout-server.log` |
| `node qa/finance-p03/closeout/migration.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/closeout-d1.log` |
| `node --import ./qa/finance-p03/phase-a/output-redirect.mjs qa/finance-p02/web-contracts.mjs` | 1 | `docs/migration-evidence/finance-p03/phase-a/node-closure/p02-web.log` |
| `node --import ./qa/finance-p03/phase-a/output-redirect.mjs qa/finance-p02/web-dom.mjs` | 1 | `docs/migration-evidence/finance-p03/phase-a/node-closure/p02-dom.log` |
| `node --import ./qa/finance-p03/phase-a/output-redirect.mjs qa/finance-p02/ledger-d1.mjs` | 0 | `docs/migration-evidence/finance-p03/phase-a/node-closure/p02-d1.log` |

P02 Web/DOM exit1包含原红灯；原608预期不修改。前轮607三项夹具合同已披露，本轮没有追加金额/身份例外。既有测试只续接Room13 / D1v5迁移注册、目标及相应旧版本报错文字；原SQL/schema不变。新A29草案零金额与Task16正金额合同不符，保留失败后改为原支出+独立全额退款，未放宽数据库约束或冻结真值。

## 中间执行完整统计

| run | 实际counts | raw |
| --- | --- | --- |
| a-bridge-acceptance-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-acceptance-restore-junit` |
| a-bridge-acceptance-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-acceptance-seed-junit` |
| a-bridge-attempt1-restore-junit | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-attempt1-restore-junit` |
| a-bridge-attempt1-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-attempt1-seed-junit` |
| a-bridge-attempt2-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-attempt2-restore-junit` |
| a-bridge-attempt2-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-attempt2-seed-junit` |
| a-bridge-final-role-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-final-role-restore-junit` |
| a-bridge-final-role-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/a-bridge-final-role-seed-junit` |
| alias-version-before-junit | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/alias-version-before-junit` |
| audit-capacity-before | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/audit-capacity-before/reconciliation.ndjson` |
| audit-capacity-diagnostic | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/audit-capacity-diagnostic/reconciliation.ndjson` |
| before | {'FAIL': 3} | `docs/migration-evidence/finance-p03/phase-a/before/before.ndjson` |
| closure-a-bridge-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-a-bridge-restore-junit` |
| closure-a-bridge-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-a-bridge-seed-junit` |
| closure-closeout-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-closeout-restore-junit` |
| closure-closeout-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-closeout-seed-junit` |
| closure-full-junit | {'PASS': 663} | `docs/migration-evidence/finance-p03/phase-a/closure-full-junit` |
| closure-legacy-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-legacy-restore-junit` |
| closure-legacy-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-legacy-seed-junit` |
| closure-p02-junit | {'FAIL': 4, 'PASS': 3} | `docs/migration-evidence/finance-p03/phase-a/closure-p02-junit` |
| closure-p02-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-p02-restore-junit` |
| closure-p02-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/closure-p02-seed-junit` |
| complete-a-bridge-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-a-bridge-restore-junit` |
| complete-a-bridge-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-a-bridge-seed-junit` |
| complete-closeout-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-closeout-restore-junit` |
| complete-closeout-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-closeout-seed-junit` |
| complete-full-junit | {'PASS': 661} | `docs/migration-evidence/finance-p03/phase-a/complete-full-junit` |
| complete-legacy-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-legacy-restore-junit` |
| complete-legacy-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-legacy-seed-junit` |
| complete-p02-junit | {'FAIL': 4, 'PASS': 3} | `docs/migration-evidence/finance-p03/phase-a/complete-p02-junit` |
| complete-p02-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-p02-restore-junit` |
| complete-p02-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/complete-p02-seed-junit` |
| existing-capture-before | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/existing-capture-before/reconciliation.ndjson` |
| existing-capture-native-before-junit | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/existing-capture-native-before-junit` |
| legacy-bypass-before | {'FAIL': 2} | `docs/migration-evidence/finance-p03/phase-a/legacy-bypass-before/reconciliation.ndjson` |
| migration-attempt1 | {} | `docs/migration-evidence/finance-p03/phase-a/migration-attempt1/migration.ndjson` |
| migration-attempt2 | {'PASS': 6} | `docs/migration-evidence/finance-p03/phase-a/migration-attempt2/migration.ndjson` |
| migration-attempt3 | {'PASS': 6, 'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/migration-attempt3/migration.ndjson` |
| migration-complete | {'PASS': 8} | `docs/migration-evidence/finance-p03/phase-a/migration-complete/migration.ndjson` |
| migration-final | {'PASS': 7, 'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/migration-final/migration.ndjson` |
| migration-final-role | {'PASS': 8} | `docs/migration-evidence/finance-p03/phase-a/migration-final-role/migration.ndjson` |
| native-and-migration-attempt4-junit | {'PASS': 36, 'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/native-and-migration-attempt4-junit` |
| native-and-migration-attempt5-junit | {'PASS': 40} | `docs/migration-evidence/finance-p03/phase-a/native-and-migration-attempt5-junit` |
| native-attempt3-junit | {'PASS': 17} | `docs/migration-evidence/finance-p03/phase-a/native-attempt3-junit` |
| native-final-junit | {'PASS': 28} | `docs/migration-evidence/finance-p03/phase-a/native-final-junit` |
| role-control-before | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/role-control-before/reconciliation.ndjson` |
| server-acceptance | {'PASS': 56} | `docs/migration-evidence/finance-p03/phase-a/server-acceptance/reconciliation.ndjson` |
| server-attempt1 | {'PASS': 13, 'FAIL': 19} | `docs/migration-evidence/finance-p03/phase-a/server-attempt1/reconciliation.ndjson` |
| server-attempt2 | {'PASS': 14, 'FAIL': 18} | `docs/migration-evidence/finance-p03/phase-a/server-attempt2/reconciliation.ndjson` |
| server-attempt3 | {'PASS': 31, 'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/server-attempt3/reconciliation.ndjson` |
| server-attempt4 | {'PASS': 41} | `docs/migration-evidence/finance-p03/phase-a/server-attempt4/reconciliation.ndjson` |
| server-attempt5 | {'PASS': 47} | `docs/migration-evidence/finance-p03/phase-a/server-attempt5/reconciliation.ndjson` |
| server-closure | {'PASS': 58} | `docs/migration-evidence/finance-p03/phase-a/server-closure/reconciliation.ndjson` |
| server-complete | {'PASS': 48} | `docs/migration-evidence/finance-p03/phase-a/server-complete/reconciliation.ndjson` |
| server-final | {'PASS': 56} | `docs/migration-evidence/finance-p03/phase-a/server-final/reconciliation.ndjson` |
| server-final-role | {'PASS': 57} | `docs/migration-evidence/finance-p03/phase-a/server-final-role/reconciliation.ndjson` |
| server-verified | {'PASS': 49} | `docs/migration-evidence/finance-p03/phase-a/server-verified/reconciliation.ndjson` |
| shared-booking-bypass-before | {'FAIL': 1} | `docs/migration-evidence/finance-p03/phase-a/shared-booking-bypass-before/reconciliation.ndjson` |
| verified-a-bridge-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-a-bridge-restore-junit` |
| verified-a-bridge-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-a-bridge-seed-junit` |
| verified-closeout-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-closeout-restore-junit` |
| verified-closeout-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-closeout-seed-junit` |
| verified-full-junit | {'PASS': 662} | `docs/migration-evidence/finance-p03/phase-a/verified-full-junit` |
| verified-legacy-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-legacy-restore-junit` |
| verified-legacy-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-legacy-seed-junit` |
| verified-p02-junit | {'FAIL': 4, 'PASS': 3} | `docs/migration-evidence/finance-p03/phase-a/verified-p02-junit` |
| verified-p02-restore-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-p02-restore-junit` |
| verified-p02-seed-junit | {'PASS': 1} | `docs/migration-evidence/finance-p03/phase-a/verified-p02-seed-junit` |

全栈逐项在failure-ledger.json；不由后续PASS覆盖。主要处置：

- before三项API能力探针FAIL，记录09442c2缺少修正接口，不冒充已执行业务场景。
- server-attempt1/2：真实SQL缺闭合括号及列数/绑定修复；QA手动编辑请求误用last_server_version改since_version；草案0金额不符合正式账本，采用现有退款冲正合同。原32例失败保存。
- server-attempt3：退款先到、映射后未触发依赖重检，A10真实FAIL；修复后按精确家族做有界重检。
- native-attempt1：测试RuntimeEnvironment泛型误用编译失败；attempt2迁移注册脚本误改默认参数编译失败，均无新鲜JUnit，不把旧XML计PASS。
- native-and-migration-attempt4：37方法1FAIL，旧opener测试仍匹配12而实际13；更新版本文字，保留拒绝降级及旧行检查。
- a-bridge-attempt1：实际原生v2完成消息因身份门禁上传candidate，初始修正合同无法接受，真实FAIL。现在必须另有精确完成源digest；没有该证明的processing仍不升级，A27/A48保留负断言。
- audit-capacity-before/diagnostic：真实D1 `CHECK length(before_json)<=12000`，整批回滚。完整快照留新日志，旧审计只保存SHA指针与摘要，A49全八候选通过，并独立核对指针。
- alias-version-before：实际95后旧别名仍90，1FAIL；读取主recognition最新事实，原源记录90保留，当前多版本测试通过。
- legacy-bypass-before及shared-booking-bypass-before：generic raw、旧structured、hint共用函数可重复创建支出；统一保护并保留实际回执恢复，A50–56通过。
- role-control-before：错误MAP可消耗已接受授权，原A丢失；拒绝控制角色作为Capture别名，A57通过。
- existing-capture-before / existing-capture-native-before：弱候选映射到已经入账的权威Capture分别缺少canonical predecessor、未确认已有本地booking；保留失败后支持选取证据的现有正式ID并更新原booking回执，A58及原生新增方法通过。
- migration-attempt1：合成旧事件遗漏confidence，D1绑定undefined启动失败、0业务case；早期shell尾部Get-Content掩盖child exit，未用shell0算PASS。后续run-one记录真实退出码。
- migration-attempt3：AM07错用Finance而非Cloud写flag，实际返回cloud_not_enabled；修正测试配置。migration-final的AM08漏DeepHealth flag，未执行深查而为空；明确开启后验证DB2。不是生产配置更改。
- node-attempt1：旧closeout迁移基线只排0028却误含新0029，readiness前即失败；P02输出重定向旧safe前缀拒绝新phase-a目录，三项没跑业务。修正QA边界，原输出保留，不把这些exit1冒充EXPECTED_RED。
- protection-attempt1：误假设四份材料都新到；开工清单证实三份已存在且hash一致，仅路线图新增。新审计只接受该精确集合差，保留原832文件/HEAD/branch/dirty检查，未忽略未知修改。
- 报告生成器先后遇到3行没有fixture键、8个NOT_TESTED行fixture为字符串；保留失败及draft，按原值存fixture_original并生成展示元数据，没有改变输入、真值或状态。

原P03/P02及closeout的全部旧失败日志仍保持，新增99之外的能力探针、startup失败、同方法重跑和30次内部循环不计新用例。测试程序/fixture修改的源diff与每轮源码hash在candidate-source-deltas和provenance。

## 保护核验

| 范围 | 原文件数 | added / missing / changed | HEAD / branch / dirty |
| --- | --- | --- | --- |
| main | 832 | 1 / 0 / 0 | True / True / True |
| repair | 840 | 0 / 0 / 0 | True / True / True |
| task26 | 826 | 0 / 0 / 0 | True / True / True |
| d01 | 859 | 0 / 0 / 0 | True / True / True |
| d01control | 829 | 0 / 0 / 0 | True / True / True |
| d02 | 871 | 0 / 0 / 0 | True / True / True |
| candidate | 881 | 0 / 0 / 0 | True / True / True |
| p02 | 901 | 0 / 0 / 0 | True / True / True |
| phase3 | 140 | 0 / 0 / 0 | N/A / N/A / N/A |
| d01Evidence | 870 | 0 / 0 / 0 | N/A / N/A / N/A |
| d02Evidence | 207 | 0 / 0 / 0 | N/A / N/A / N/A |
| candidateEvidence | 366 | 0 / 0 / 0 | N/A / N/A / N/A |
| p02Evidence | 196 | 0 / 0 / 0 | N/A / N/A / N/A |

主工作区新增1仅为所有者提供路线图，SHA与owner-materials清单相符；原材料3份及其余832原文件不变。1537份历史资料无变化。原closeout于开工的45/698 seal成功，后续产品差异是已授权P03-A变更，不声称旧产品源码仍相同。正式App实际设备状态、真实生产数据及正式签名均未查询/操作。

## 本轮修改/新增文件

- `android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/13.json`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureContracts.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/AndroidPaymentRecognitionHook.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/LocalPaymentLedger.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentReconciliation.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/NotificationDatabase.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentRecognitionStore.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentReconciliationDao.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentReconciliationEntities.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP03AReconciliationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03AMigrationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03CloseoutMigrationTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03PersistenceTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/NotificationDatabaseMigrationTest.kt`
- `cloudflare/migrations/0029_payment_reconciliation.sql`
- `docs/finance-p03/P03A_MIGRATION_AND_RECOVERY.md`
- `docs/finance-p03/P03A_P03B_HANDOFF.md`
- `docs/finance-p03/P03A_PLAN.md`
- `docs/finance-p03/P03A_RECONCILIATION_CONTRACT.md`
- `docs/finance-p03/P03A_REPORT.md`
- `docs/finance-p03/P03A_TEST_MATRIX.md`
- `docs/finance-p03/P03A_TEST_RUNS.md`
- `functions/_lib/cloudflare-foundation.mjs`
- `functions/_lib/task16-service.mjs`
- `functions/_lib/task21-hints.mjs`
- `functions/_lib/task21-lifecycle.mjs`
- `functions/_lib/task21-model.mjs`
- `functions/_lib/task21-reconciliation.mjs`
- `functions/_lib/task21-service.mjs`
- `qa/finance-p03/closeout/migration.mjs`
- `qa/finance-p03/kotlin/P03ABridgeTest.kt`
- `qa/finance-p03/kotlin/P03BridgeTest.kt`
- `qa/finance-p03/migration.mjs`
- `qa/finance-p03/phase-a/README.md`
- `qa/finance-p03/phase-a/audit.py`
- `qa/finance-p03/phase-a/before.mjs`
- `qa/finance-p03/phase-a/bridge-server.mjs`
- `qa/finance-p03/phase-a/d1-snapshot.mjs`
- `qa/finance-p03/phase-a/freeze.py`
- `qa/finance-p03/phase-a/migration.mjs`
- `qa/finance-p03/phase-a/output-redirect.mjs`
- `qa/finance-p03/phase-a/prepare-v4.py`
- `qa/finance-p03/phase-a/provenance.py`
- `qa/finance-p03/phase-a/reconciliation.mjs`
- `qa/finance-p03/phase-a/report.py`
- `qa/finance-p03/phase-a/run-bridge.ps1`
- `qa/finance-p03/phase-a/run-closure.ps1`
- `qa/finance-p03/phase-a/run-complete.ps1`
- `qa/finance-p03/phase-a/run-gradle.ps1`
- `qa/finance-p03/phase-a/run-node.ps1`
- `qa/finance-p03/phase-a/run-one.ps1`
- `qa/finance-p03/phase-a/run-reconciliation-bridge.ps1`
- `qa/finance-p03/phase-a/run-verified.ps1`

未删除测试/夹具/旧报告。四份一次性实现变换脚本转入ignored implementation-transforms保留，未作为可重复测试交付；所有业务方法和原断言保留。

暂存检查另保留 staging-check-before.json/log：8份新QA辅助文件末尾多空行使git diff --cached --check返回2；只规范EOF换行，产品、fixture和断言未改变，复查返回0。候选源码hash已重新捕获，前份清单归档保留。
