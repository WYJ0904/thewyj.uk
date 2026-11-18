# Task29 现有能力 / 缺口 / 复用方案分析

- **基线提交**: `63bcf0b821d3d381513bcb7cc2dee1926b4e1b30` (`origin/main`)
- **工作分支**: `hydrogen/task29-encrypted-backup-restore`
- **增量迁移编号**: `0039_task29_encrypted_backup_restore.sql`（承接已发布的 `0038_task28_secure_files.sql`）

---

## 1. 现有能力盘点

### 1.1 账户、会话与安全中心（Task12 / Task20 / Task27 / Task25）
- **身份认证与会话隔离 (`functions/_lib/task12-auth.mjs`, `task12-crypto.mjs`)**:
  - `resolveTask12Account(context)` 统一校验 Web Cookie 会话与 `Bearer` Token，并返回包含 `id`、`role`、`session_version` 等字段的受信任 `account` 对象；不接受客户端传入的 owner ID。
  - Cloud D1/Workers `PBKDF2` 运行时受 `workerd` 单次调用 100,000 次迭代限制（见 `task12-crypto.mjs` `CLOUD_PBKDF2_STAGES`）。
- **高风险操作重新验证 Step-up (`functions/_lib/task27-auth.mjs`, `task27-security.mjs`)**:
  - `beginStepup` 与 `verifyStepup` 支持密码/邮箱验证码/TOTP 签发一次性 `grant`（绑定 `user_id`、`session_version`、`security.version`、`session_digest` 与 `scope`），并通过 `task27_atomic_guard` 在单次 D1 `batch` 中完成消费断言。
  - 目前 `beginStepup` 仅允许既有 `scope` 白名单，需要扩展 `backup_restore` 及 `backup_restore:<job_id>`。
- **审计与限流 (`functions/_lib/task27-store.mjs`, `cloudflare-foundation.mjs`)**:
  - `enforceD1RateLimit` 与 `securityRate` 提供 D1 滑动窗口限流。
  - `task25_feature_flags`（`task25-service.mjs`）提供通道/Kill Switch 支持。

### 1.2 财务数据模型与 P03–P06 不变量（Task16 / P03–P06）
- **真实 D1 财务表 (`cloudflare/migrations/0012`, `0030`, `0031`, `0033`)**:
  - 核心台账与规则：`task16_finance_categories`、`task16_finance_budgets`、`task16_finance_transactions`、`task16_finance_raw_events`、`task16_finance_transaction_events`。
  - 币种与 FX：`task16_currency_preferences`、`task16_fx_references`、`task16_fx_rates`、`task16_currency_role_evidence`。
  - 版本与同步幂等：`task16_finance_user_versions`、`task16_finance_changes`、`task16_finance_sync_operations`、`task16_finance_audit_logs`。
- **关键金额与 P03–P06 约束 (`js/finance/money.js`, `functions/_lib/finance-money-units.mjs`, `finance-source-units.mjs`)**:
  - 正式支持 6 种币种：`CNY` / `USD` / `EUR` / `HKD` / `GBP` (`digits = 2`) 与 `JPY` (`digits = 0`)；所有金额均以 `amount_minor` 整数存储并通过 `BigInt` (`moneyText`) 格式化，避免 JS 浮点精度损失。
  - 历史未验证 `JPY` 记录保留 `amount_exponent = NULL`（`money_unit_status = 'review_required'`），导出与恢复不得擅自改写为已验证 `0` 指数。
  - 默认/存疑 `¥` 带有 `currency_review_required = 1` / `currency_decision_source = 'account_default'`，恢复时必须保留核实状态，不得静默升格为已确认普通 `CNY` 账目。

### 1.3 云端结构化通知与本地隐私边界（Task21 / Android Room）
- **隐私边界 (`functions/_lib/task21-model.mjs`, `android/.../NotificationEntities.kt`)**:
  - Android 本地 Room (`notification_instances`, `notification_revisions`) 与本地媒体存储保存原始通知标题 (`title`)、正文 (`text`, `bigText`, `subText`) 与图片路径；原始通知文本严禁上传 Cloudflare D1/R2。
  - `task21-model.mjs` 定义 `FORBIDDEN_RAW_FIELDS`，D1 表 `task21_notification_events`、`task21_notification_candidates`、`task21_notification_pending_hints`、`task21_notification_evidence`、`task21_notification_review_aliases` 及 P03 对账表（`task21_payment_reconciliations`, `task21_payment_effective_events`, `task21_payment_lifecycle_guards`, `task21_payment_user_decisions`, `task21_payment_control_closures`, `task21_currency_units`, `task21_payment_reference_aliases`）仅保存结构化元数据和指纹。
- **P03–P06 对账与生命周期限制 (`task21-lifecycle.mjs`, `task21-reconciliation.mjs`)**:
  - `AUTHORIZED` / `RELEASED` / `EXPIRED` 属于授权控制事件，绝不能成为直接计入已结算消费支出的正式账目。
  - `payment.reconcile` 在无经验证厂商适配器前默认拒绝未验证外部授权声明；`lifecycle_revision > 1` 需要显式对账证据，在备份导出时必须按原始持久化态导出，对缺乏对账依据的记录在恢复限制中显式标注。

### 1.4 统一安全文件基础层（Task28 `secureFilesV1`）
- `functions/_lib/secure-file-service.mjs` 与 `cloudflare/migrations/0038_task28_secure_files.sql` 已实现私有 `access_scope='private'` 上传/下载授权与清理机制；可用于按需生成短期加密包私有下载句柄，但不应长期存放明文财务备份。

### 1.5 前端架构与静态安全门禁
- `index.html`、`app.js`、`js/account/security-center.js`、`product-ui.css` 与 `sw.js`。
- `qa/p07-release/sw-install.test.mjs` 严格校验 `sw.js` Shell 数组长度（总计 89 项），且 `scripts/update_task27_publication.mjs` 自动维护 `TASK26_INTEGRITY` 与 `PUBLICATION_HASH`。因此前端 Task29 控制器与 Web Crypto 逻辑应复用并集成到已在 Shell 清单中的 `js/account/security-center.js`，避免破坏 P07 离线缓存合同。

---

## 2. 识别的缺口

1. **无用户级跨范围导出与版本化 Manifest 契约**：缺少同时覆盖用户财务账目、审核候选/待处理提示与云端结构化通知的统一版本化导出器、CSV 防注入格式化器与 SHA-256 节摘要校验清单。
2. **无认证加密备份容器规范**：缺少独立的、绑定 `account_id_sha256` + `manifest_sha256` AAD 的 `AES-256-GCM` + `PBKDF2-HMAC-SHA256` 加密容器（与 Task27 TOTP 密钥完全隔离）。
3. **无只读恢复模拟与预检机制**：缺少在不写入业务表前提下对备份包执行解密、完整性、账户归属、外键引用、P03–P06 不变量与新增/跳过/冲突/拒绝分类的只读预检服务。
4. **无幂等、Step-up 保护且可回滚的恢复状态机**：`task27-auth.mjs` 尚无 `backup_restore` Step-up scope；D1 尚无 `task29_restore_jobs`、`task29_restore_idempotency`、`task29_backup_exports` 与 `task29_backup_audit` 状态表，缺少分段批量写入与失败精准补偿回滚机制。
5. **无账户中心/财务中心内的备份与恢复 UI**：缺少面向桌面/平板/移动端的响应式导出、加密、只读预检差异预览与 Step-up 恢复确认界面。

---

## 3. Task29 复用与实施方案

1. **增量迁移 `0039_task29_encrypted_backup_restore.sql`**：仅新增 `task29_metadata`、`task29_backup_exports`、`task29_restore_jobs`、`task29_restore_idempotency`、`task29_backup_audit`，不复制业务账目表。
2. **复用 `task12-auth` + `task27` 安全中心**：在 `task27-auth.mjs` 增加 `backup_restore` Step-up scope，`EVENT_TEXT` 增加脱敏审计事件，API 限流复用 `enforceD1RateLimit` / `securityRate`。
3. **复用 Web Crypto (`AES-256-GCM` + `PBKDF2-HMAC-SHA256`, 100k/stage 兼容 Workers 与浏览器)**：独立口令派生，绑定 AAD，严格拒绝错误口令、篡改密文/Nonce/Salt/Header 及 Manifesto 校验失败。
4. **严格隐私边界与 P03–P06 不变量守护**：导出明确声明不包含 Android 本地原始通知正文与媒体；预检和恢复禁止携带 `FORBIDDEN_RAW_FIELDS`；严格守护 6 币种 `amount_exponent`、历史未验证 `JPY`、`currency_review_required=1` 存疑 `¥`、预授权控制状态边界。
5. **前端集成到 `js/account/security-center.js`、`index.html`、`app.js`、`product-ui.css`**：在账户设置与财务中心提供入口，使用 `ownerBoundRequest` 防止切换账户串台，复用 `password-fields` 显隐开关且不遮挡输入。
