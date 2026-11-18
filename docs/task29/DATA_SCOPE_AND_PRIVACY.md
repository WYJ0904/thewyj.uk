# Task29 数据范围、所有权边界与通知隐私隔离规范

## 1. 数据范围定义（User-Level Scopes）

Task29 仅面向当前已通过认证的账户导出及恢复其名下业务数据，绝不扩大为全站管理员 D1 整库备份平台。支持以下 3 个独立勾选的数据域：

| 范围标识 | 涵盖真实 D1 表（按外键依赖顺序） | 用途与包含内容 |
| :--- | :--- | :--- |
| `finance_core` | `task16_finance_categories`, `task16_finance_budgets`, `task16_finance_transactions`, `task16_finance_raw_events`, `task16_finance_transaction_events`, `task16_currency_preferences`, `task16_fx_rates`, `task16_fx_references`, `task16_currency_role_evidence` | 账本分类、预算、交易主账目、6 币种原币最小单位 (`amount_minor`, `amount_exponent`)、参考汇率快照及关联原始结构化证据。 |
| `finance_review` | `task21_notification_pending_hints`, `task21_notification_candidates`, `task21_payment_user_decisions` | 待核实/待确认金额或方向的财务提示、通知候选及用户复核决议。恢复后仅回到审核列表，不混入已确认流水表。 |
| `notifications_cloud` | `task21_notification_events`, `task21_notification_evidence`, `task21_notification_review_aliases`, `task21_payment_reference_aliases`, `task21_payment_lifecycle_guards`, `task21_currency_units`, `task21_payment_reconciliations`, `task21_payment_effective_events`, `task21_payment_reconciliation_guards`, `task21_payment_control_closures` | 服务器实际合法持有的结构化通知事件摘要、生命周期状态、对账映射及源单位证据。 |

## 2. 绝对隐私边界（Android 本地通知原文隔离）

- **本地 vs 云端区分**：Android 客户端本地 Room 数据库（`notification_instances`, `notification_revisions`）与本地媒体存储保存原始通知标题 (`title`)、正文 (`text`, `bigText`, `subText`)、短信正文及图片媒体，**从未上传至 Cloudflare D1/R2**。
- **零伪造声明**：所有导出清单 (`privacy_declaration`) 与 Web UI 均明确区分：
  - `cloud_structured_notifications_included: true`
  - `android_local_raw_notifications_included: false`
  - `android_local_media_included: false`
  并声明 Android 本地原始通知正文与媒体不包含在云端备份中。
- **字段级递归拦截 (`FORBIDDEN_RAW_NOTIFICATION_FIELDS`)**：
  服务端导出前及预检/恢复接收前均递归扫描全部记录与嵌套 JSON 字段（`metadata_json`, `evidence_summary`, `edited_json`），一旦出现 `raw_text`, `raw_body`, `body`, `text`, `big_text`, `bigText`, `sub_text`, `subText`, `ticker`, `ticker_text`, `message`, `messages`, `extras`, `notification_body`, `notification_text`, `sms_body`, `ocr_raw`, `raw_payload`, `local_media_bytes`, `verification_code_raw`, `messaging_style`, `title`, `content`, `summary`，立即返回 `422 BACKUP_PRIVACY_BOUNDARY_VIOLATION`。

## 3. P03–P06 前置安全边界继承与恢复限制

1. **6 币种与小数单位不变量 (`js/finance/money.js`)**：`CNY`/`USD`/`EUR`/`HKD`/`GBP` 固定 `amount_exponent = 2`，`JPY` 合法指数为 `0` 或历史未验证 `NULL`。`JPY` 若误标为 `2` 将被预检拒绝 (`CURRENCY_UNIT_MISMATCH`)；历史未验证 `JPY` (`amount_exponent = NULL`) 在导出、预检和恢复中保持 `NULL`，CSV 中显式标注 `JPY_UNVERIFIED_UNIT`。
2. **存疑 `¥` 与默认推断币种隔离**：包含 `raw_currency_token: "¥"` 或缺少明确源币种证据且试图直接作为已确认 `CNY` 写入的记录会被预检拦截 (`CURRENCY_AMBIGUOUS_UNREVIEWED`)；`currency_review_required = 1` 记录原样保留待核实态。
3. **预授权控制态隔离**：`financial_phase` 为 `AUTHORIZED` / `RELEASED` / `EXPIRED` 的控制事件禁止携带有效的 `finance_transaction_id` 计入正式支出账目 (`LIFECYCLE_CONTROL_CANNOT_BOOK_LEDGER`)。
4. **退款上限不变量**：同一 `reference_namespace + lifecycle_reference` 家族下累计 `REFUNDED` 金额不得超过累计 `SETTLED` 金额 (`REFUND_EXCEEDS_SETTLED`)。
5. **私有对象存储隔离**：严禁将明文 JSON/CSV 财务备份写入 R2 (`BACKUP_PLAINTEXT_CLOUD_STORAGE_FORBIDDEN`)。
