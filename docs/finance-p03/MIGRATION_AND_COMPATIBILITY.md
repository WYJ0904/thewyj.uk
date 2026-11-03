# 数据迁移、兼容与回退

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


Room 10→11只添加payment_recognitions的identityReviewReason、financialPhase、lifecycleReference、referenceNamespace、currencyEvidence（均默认空，不补猜币种或完成状态），增加payment_event_aliases。既有表、记录ID、金额、currency、receipt/outbox不清空、不重建。schema1–10原导出不改，新增11；原迁移用例续接10→11。

D1 0027增加Task21结构化事件的五个证据字段、生命周期/引用索引和task21_payment_reference_aliases（指向现有raw证据，不是新账本），metadata schema_version=3。Task16/Task21请求schema_version仍1；ingest新增可选结构化字段，旧字段默认空兼容；新增校验/候选行为明确属于P03安全合同。Hint发行方从既有source_package/payment_channel取得，不新增原文或私密字段。

0026编号保留给独立Task26分支，本轮不复制或合并其迁移。局部Miniflare按现有1–25与27验证；正式目标分支迁移顺序、旧schema现状和0026整合仍须所有者审核，本轮无任何远端迁移。

真实本地验证：v10 fixture升级保留旧transaction/event ID与币种和outbox，30次别名重放仍一笔；Room注入DDL后失败，user_version与原行回滚。D1在新DDL中注入失败，已执行DDL及metadata整体回滚，原账/旧回执保留；完整batch后schema3通过。依据[Room迁移指南](https://developer.android.com/training/data-storage/room/migrating-db-versions)与[D1 batch事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)设计，实际结果见机器证据。

**Git回滚不是数据回滚。** Room11没有破坏性降级或down migration；旧APK实际读取11未测试，不得安装旧正式包尝试。D1 metadata3使预期2的旧服务器不ready，以避免旧确认逻辑把hold当支出；不能先单独迁移Production再继续旧服务，也不能只回退旧服务器。上线前须备份、协调服务/迁移顺序并测试能理解新证据的回退候选。本轮仅隔离合成数据库，没有读取真实用户库或正式备份，没有承诺零迁移风险。
