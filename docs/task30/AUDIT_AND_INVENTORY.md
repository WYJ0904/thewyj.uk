# Task30 现状审计与全站隐私数据盘点 (`AUDIT_AND_INVENTORY`)

## 1. 审计结论总览

在 Task30 实施前，对全站云端存储（Cloudflare D1 + R2）及前端/Android 边界进行现状核查，结论如下：

1. **原 `deleteOwnAccount()` 仅为账号逻辑注销，而非全业务物理擦除**：
   - 此前 `functions/_lib/task12-service.mjs` 的 `deleteOwnAccount()` 主要将 `task12_users.deleted = 1`、置空 `password_hash` 并撤销 `task12_sessions`（同时在关闭前触发管理员角色保护检查）。
   - 该逻辑并未联动清理用户持有的财务流水（`task16_*`）、云端支付通知与待确认线索（`task21_*`）、私有文件与 R2 对象（`task22_*`）、临时分享与房间消息（`task14_*`）、备份/恢复作业元数据（`task29_*`）、学习/错题表（`task11_*` / `task15_*` / `task26_*`）或用户可选同意状态。
   - 现状审计后已将 `deleteOwnAccount()` 与 `/api/account/delete` 统一接入 `executeAccountErasure()`（保留既有管理员触发器 `task18_owner_delete_protected` / `task18_admin_account_state_guard` 与兼容调用点 `skipUserSessions: true`）。

2. **已存在但分散的能力（全部复用，不重造第二套模型）**：
   - Task27（`task27-auth.mjs` / `task27-security.mjs`）：会话绑定单次 Step-up 二次核验、TOTP / Recovery / 邮箱验证与政策版本归档。
   - Task28（`secure-file-service.mjs` / `secure-file-cleanup.mjs`）：`task22_*` 下载授权与 R2 对象/MPU 清理队列及维护授权（`authorizeFileMaintenance`）。
   - Task14（`task14-service.mjs`）：临时分享 `expires_at` 过期判断与清理。
   - Task16 & Task21（`task16-service.mjs` / `task21-service.mjs` / `task21-hints.mjs`）：交易 ID、原始来源事件、增量同步游标、支付参考别名与候选审核状态机。
   - Task29（`task29-backup-service.mjs`）：本地 `.wyjbackup` 加密备份/预检/恢复状态机及 `staged_plan_json` 过期清理。

3. **主要缺口与 Task30 补齐点**：
   - 缺少统一的 8 大类权威数据目录、真实留存策略、保留例外与前端「隐私与数据管理」控制中心。
   - 缺少先断流（`access_revoked`）后物理清理的可追踪状态机及 R2 失败重试队列（`task30_erasure_requests` + `task30_erasure_tasks`）。
   - 缺少财务/云端通知删除后的多端防复活墓碑（`task30_erasure_tombstones`）及恢复防重放代际校验（`task30_erasure_generations`）。

---

## 2. 真实数据清单、持有人、留存策略与删除路径映射

| 类别 Key | 真实存储位置 | 持有人与隔离 | 当前真实留存政策 | 自助删除与清理路径 |
|---|---|---|---|---|
| `account_security` | D1: `task12_users`, `task12_sessions`, `task20_device_sessions`, `task20_used_refresh_tokens`, `task27_security`, `task27_challenges`, `task27_recovery_codes`, `task27_events`, `task27_notifications`, `task27_policy_consents`, `task25_release_preferences` + 设备 Cookie/Keystore | 账户本人（`user_id` 强隔离） | 账号存续期间保留；挑战凭据与已过期会话到期清理 | `executeAccountErasure()`：立即递增 `session_version`、撤销 Web/Android 会话及刷新令牌、`deleted=1`、清空密码哈希/邮箱/MFA 凭据；保留最小化审计摘要与管理员触发器保护 |
| `finance` | D1: `task16_finance_transactions`, `task16_finance_categories`, `task16_finance_budgets`, `task16_finance_raw_events`, `task16_finance_transaction_events`, `task16_finance_devices`, `task16_finance_user_versions`, `task16_finance_changes`, `task16_finance_audit_logs`, `task16_finance_sync_operations`, `task16_fx_references`, `task16_currency_preferences`, `task16_currency_role_evidence`, `finance_ai_observations`, `finance_ai_decisions` + 本地离线缓存 | 账户本人（`user_id` 强隔离） | 账户存续期间长期保留，无强制到期自动删除 | 清理名下财务流水、分类、预算、原始事件、AI 决策/观察及偏好；递增财务同步版本；写入 `task30_erasure_tombstones`（交易 ID / 来源事件 / 分类 / 预算）；保留 `task13_payment_orders` 订单对账例外 |
| `notifications_cloud` | D1: `task21_notification_events`, `task21_notification_candidates`, `task21_notification_pending_hints`, `task21_notification_evidence`, `task21_notification_review_aliases`, `task21_notification_sync_operations`, `task21_payment_reference_aliases`, `task21_payment_reconciliations`, `task21_payment_effective_events`, `task21_payment_reconciliation_guards`, `task21_payment_user_decisions`, `task21_payment_control_closures`, `task21_payment_lifecycle_guards`, `task21_currency_units` + Android Room `notification_history` / `notification_settings` | 账户本人（云端仅结构化支付事件；本机 Room 在用户手机本地） | 云端随账户保留并支持随时撤销同步与清空；Android 本机 Room 默认可选 `7/30/90/365/0` 天（兼容 `1/3` 天，星标免自动清理） | 云端清空所有 `task21_*` 用户表记录并写入防复活墓碑；不远程擦除手机本地 Room（界面明确提示端云边界） |
| `files` | D1: `task22_upload_sessions`, `task22_upload_files`, `task22_upload_parts`, `task22_shares`, `task22_share_files`, `task22_download_grants`, `task28_file_events`, `task28_multipart_cleanup`, `task22_usage_daily` + R2: `transfer/*` | 账户本人（`user_id` 强隔离） | 按文件/分享有效期（`expires_at`）或主动撤销后到期清理 | 第一步立即将 `task22_shares` / `task22_upload_sessions` 置为失效/撤销并删除 `task22_download_grants`；第二步创建 `task30_erasure_tasks` 删除 R2 对象及中止未完成分片，失败入 `retry_pending` |
| `temporary` | D1: `task14_shares`, `task14_room_messages`, `task14_download_grants`, `task14_usage_daily` + R2 临时文件对象 | 账户关联分享由创建者控制（匿名游客分享无归属账号） | 遵循创建时设定的 `expires_at` 短时有效期 + Cleanup 清理 | 第一步立即置 `task14_shares.state='deleted'`、撤销 `task14_download_grants`、清空 `task14_room_messages` 文本；第二步清理关联 R2 对象 |
| `backups` | D1: `task29_backup_exports`, `task29_restore_jobs`, `task29_restore_idempotency`, `task29_backup_audit` + 用户自行持有的本地 `*.wyjbackup` | 账户本人（服务端不托管密文文件或口令） | 未提交恢复暂存计划按 `expires_at` 清理；作业与导出记录可自删 | 立即清空未提交 `staged_plan_json`、取消进行中未提交恢复作业、清除导出/恢复作业元数据；递增 `task30_erasure_generations` 以阻断旧预检提交 |
| `support` | D1: `email_center_inbound_threads`, `email_center_inbound_messages`, `email_center_deliveries`, `task11_feedback_items`, `task11_feedback_votes`, `task13_user_memberships`, `task13_payment_orders` | 账户关联 + 站点合规/对账留存约束 | `email_center_inbound_threads` 默认 180 天留存（`retention_expires_at`）；支付订单与发信审计不可自删；反馈与投票可自删 | 删除用户反馈与投票（`task11_feedback_items` / `task11_feedback_votes`）；若仍存在 180 天内支持邮件或会员订单则清晰上报 `partially_completed` / `blocked_by_retention` |
| `learning` | D1: `task11_learning_sync_records`, `task11_learning_sync_heads`, `task11_learning_sync_changes`, `task15_quiz_sessions`, `task15_ai_cache`, `task15_ai_usage_daily`, `task15_tool_favorites`, `task15_tool_recent_usage`, `task15_saved_tool_configs`, `task26_learning_events`, `task26_question_tickets`, `task26_mastery_states`, `task26_wrong_review_events`, `task26_wrong_review_states` | 账户本人（`user_id` 强隔离） | 学习档案长期保留；`task15_quiz_sessions`（2 小时）与 `task15_ai_cache`（7 天）到期清理 | 按外键及防触发器拦截安全顺序清理（`task26_wrong_review_events` / `task26_learning_events` / `task26_question_tickets` / `task26_mastery_states` 等遵循只删禁改逻辑，绕开不可变更新锁） |
