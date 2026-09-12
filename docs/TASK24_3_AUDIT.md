# Task 24.3 — Notification → Finance Production post-release audit

日期：2026-09-12。基线：正式版 1.3.0 / versionCode 13（Product merge `5e597da`，final main HEAD `efa2c11`）。

## 结论

本轮专项复核未发现新的 Notification → Finance 回归。此前全部真实故障点均已按 1.3.0 的
canonical 状态机闭合，Production 与正式 APK 复测通过。

## 代码侧复核（真实运行，未 mock 关键链）

- `test_task21_notification_js.mjs`：PASS（隐私边界、权益生命周期、幂等 ingest、去重、
  Finance 集成、candidate 状态机、feature flags）。
- `test_task21_hints_js.mjs`：PASS（单一 pending source、不臆造金额、confirm/ignore 幂等）。
- `test_finance_js.mjs`：PASS（金额、汇总、筛选、tombstone、revision merge、自动记账变更流）。
- `test_tts_js.mjs`：PASS；`test_static.py`：31 OK。
- Android 侧 canonical 链测试（`NotificationFinanceLinkTest`、`PaymentHintSyncCrossClientTest`、
  `NotificationCaptureCoordinatorTest`、`NotificationFinanceLedgerIdentityTest`）随 main CI
  （PR #61 / merge `5e597da`）全绿，且无新增代码改动。

## Production 实测证据（正式环境，非 Preview）

- `/api/app/config`：`1.3.0 / 13`，APK SHA `8a24e779…`。
- 官网 `/api/app/download` 下载 APK：SHA 与 config 一致，47,578,521 bytes。
- `/api/notification/hints` 未认证请求：HTTP 401（鉴权边界完好，无数据泄漏）。
- Production D1（只读）：`task21_notification_pending_hints` 当前 1 pending / 3 ignored；
  `task16_finance_transactions` 共 12 笔（真实入账记录存在）。
- 部署：Production source `874bf25`（与产品 merge `5e597da` 同产品代码），deployment
  `d400be4f-b3b7-4cdd-bfa8-5edc82e145fd`。

## 结论项

- 已识别金额未进 Finance：1.3.0 修复生效，duplicate-without-ledger 保留并报告失败。
- candidate 未到账本：pending → confirm → finance_entry_id 链闭合。
- confirm 后通知仍待确认：archive `financeState/financeTransactionId` 终态持久化生效。
- refresh/restart/reconnect 复活：terminal 不可覆盖，跨端 pull 一致。
- retry 重复入账：confirm 幂等，同一 source event 仅一笔 transaction。
- 用户反馈：已保存 / 已识别待确认 / 已入账 / 失败 四态可区分，失败不静默。
- 通知点击：thewyj 动作只打开 thewyj；来源 App 独立动作且不可用时隐藏。

无代码修改；后续 Task 24.3 继续以 1.3.0 正式使用反馈为输入。
