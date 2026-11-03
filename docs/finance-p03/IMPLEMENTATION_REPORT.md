# P03 实施与产品差异

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


所有者本轮P03授权覆盖原暂停要求中的本阶段代码修复；不解除发布、手机、Production或P04/P05/P06边界。以P02完整HEAD新建managed worktree，没有cherry-pick、重置、合并或复制无关WIP。

既有架构保留：recognition/candidate、Room本地账目/outbox、Task16正式交易、Task21结构化事件/回执。新增的是身份别名与证据字段，不是第二套财务账本。既有金额、transactionId、receipt/operation ID、编辑/删除关系不批量重建。

Android产品路径只在PaymentParserRegistry安全装配、notification→hook→coordinator、持久化/回执和确认门禁增加字段与检查。既有PaymentText、PaymentPageSemantics、PaymentScreenshotVerifier、ML Kit模型和WebView/MainActivity生命周期源码未改；新增明确ISO配对金额和授权角色解析属于P0/生命周期最小支持，不宣称“金额解析完全没变”。90秒ticket与8次预算源码不改。确认页面只补安全提示与正确币种/身份传递，无大规模UI重构。

本地冲突判定在捕获后再次进入上传门禁，避免本地待核实而云端parsed；持久账目/真实回执作为引用权威，未入账冲突候选不能靠再次投递自证。已存在账目继续保留，新的legacy identity_pending无可靠证明先待核实，全部精确别名回执一致才解除阻断。

Worker修改包括payload完整摘要与旧摘要兼容、引用/消息别名、命名空间、清算门禁、回执不覆盖用户修改；普通hint补足发行方身份以和ingest一致。旧raw接口禁止相似度自动合并，强引用不依赖三分钟，冲突或扫描不完整待核实；未结构化清算与冲突外币不新建正式账。

依赖、版本、签名、Manifest权限、会员/旗标、发布配置、Task26、Web财务FX/格式源码均未修改。schema/API变更见迁移报告。

## 全部产品文件

- `android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/11.json`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureContracts.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationCaptureCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/NotificationIngestClient.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/AndroidPaymentNotificationLifecycleRegistry.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/AndroidPaymentRecognitionHook.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/LocalPaymentLedger.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/LocalPaymentReceiptReconciler.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentEventSafety.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentHintSync.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionCoordinator.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionModel.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecords.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentVerificationCenter.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/NotificationDatabase.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentDao.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentEntities.kt`
- `android/app/src/main/java/uk/thewyj/app/task21/store/PaymentRecognitionStore.kt`
- `cloudflare/migrations/0027_payment_identity_lifecycle.sql`
- `functions/_lib/payment-currency-evidence.mjs`
- `functions/_lib/task16-model.mjs`
- `functions/_lib/task16-service.mjs`
- `functions/_lib/task21-event-safety.mjs`
- `functions/_lib/task21-hints.mjs`
- `functions/_lib/task21-model.mjs`
- `functions/_lib/task21-service.mjs`

## 新增/修改测试与工具

- `android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP03IdentityLifecycleTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/payment/LocalPaymentBookingTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/FinanceP03PersistenceTest.kt`
- `android/app/src/test/java/uk/thewyj/app/task21/store/NotificationDatabaseMigrationTest.kt`
- `qa/finance-p03/README.md`
- `qa/finance-p03/bridge-server.mjs`
- `qa/finance-p03/kotlin/P03BridgeTest.kt`
- `qa/finance-p03/legacy-raw.mjs`
- `qa/finance-p03/migration.mjs`
- `qa/finance-p03/protection.py`
- `qa/finance-p03/provenance.py`
- `qa/finance-p03/report.py`
- `qa/finance-p03/server.mjs`
- `qa/finance-p03/test.init.gradle`
