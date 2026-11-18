# Aeris V6.3 — Task29 数据导出、加密备份与可验证恢复｜工程实施报告

## 1. 交付概览与发布边界

- **工作分支**: `hydrogen/task29-encrypted-backup-restore`（基于 `origin/main` `63bcf0b821d3d381513bcb7cc2dee1926b4e1b30`）
- **状态标志**:
  - `LOCAL_AUTOMATED_TESTS`: **PASS**
  - `LOCAL_BROWSER_DESKTOP_AND_MOBILE`: **PASS**
  - `HOSTED_PREVIEW_E2E`: **PASS**
  - `ANDROID_PHYSICAL_DEVICE`: **NOT_TESTED — NOT REQUIRED FOR TASK29 ACCEPTANCE**
  - `PRODUCTION_NOT_RELEASED`: **YES**（仅创建未合并 PR，未触发 Production 数据库迁移、R2 变更或站点发布）

Task29 为当前已认证账户提供受权限隔离、隐私边界锁定、Web Crypto 认证加密保护、只读模拟预检、Task27 Step-up 核验、幂等恢复以及失败精确补偿回滚的全链路能力。

---

## 2. 架构设计、模块清单与复用矩阵

### 2.1 数据库与增量迁移
- [`cloudflare/migrations/0039_task29_encrypted_backup_restore.sql`](../../cloudflare/migrations/0039_task29_encrypted_backup_restore.sql)：在 Production 已发布的 `0038_task28_secure_files.sql` 之后严格增量新增：
  - `task29_metadata` (`schema_version = '1'`)
  - `task29_backup_exports`（记录导出清单摘要、记录计数、范围与字节大小；不存明文财务备份也不存口令）
  - `task29_restore_jobs`（管理 `prechecked -> applying -> completed / cancelled / rolled_back` 状态机与 `staged_plan_json` / `applied_log_json`）
  - `task29_restore_idempotency`（绑定 `(user_id, scoped_payload_sha256, conflict_policy)` 防止重复写入与重记账）
  - `task29_backup_audit`（记录脱敏操作审计事件，禁止写入任何口令、Token 或原始通知正文）

### 2.2 后端 Cloudflare Pages Functions 模块
- [`functions/_lib/task29-backup-crypto.mjs`](../../functions/_lib/task29-backup-crypto.mjs)：标准 Web Crypto 容器规范（`aeris-encrypted-backup` v1，`AES-256-GCM` 128-bit Auth Tag + `PBKDF2-HMAC-SHA256` `100,000`–`600,000` 分段迭代，每次独立 16B Salt / 12B IV，规范 JSON AAD 绑定 `format`、`container_version`、`schema_version`、`account_id_sha256`、`export_id`、`created_at`、`manifest_sha256` 与分节 SHA-256 校验清单，`16 MiB` 单包上限）。
- [`functions/_lib/task29-backup-model.mjs`](../../functions/_lib/task29-backup-model.mjs)：定义 `finance_core`、`finance_review`、`notifications_cloud` Scopes、隐私声明与能力边界、`FORBIDDEN_RAW_NOTIFICATION_FIELDS` 递归扫描拦截（`422 BACKUP_PRIVACY_BOUNDARY_VIOLATION`）、P03–P06 不变量检查（6 币种最小单位、历史未验证 `JPY amount_exponent = NULL` 保留、存疑 `¥` 隔离、预授权控制态隔离与退款上限校验）、BigInt 无损精度格式化及 RFC 4180 防公式注入 CSV 构建器。
- [`functions/_lib/task29-backup-service.mjs`](../../functions/_lib/task29-backup-service.mjs)：实现并发一致快照读取与导出（`exportAccountData`，严禁将明文备份写入 R2）、严格只读模拟预检（`precheckBackupRestore`，零写入校验归属、外键引用、自然键去重、冲突差异与拓扑排序）、`commitRestoreJob`（Task27 Step-up 单次授权校验 + `RESTORE_BATCH_SIZE = 35` 分批提交 + `task16_finance_user_versions`/`task16_finance_changes` 原子收口 + `rollbackAppliedRecords` 失败逆序精准补偿删除新插入行且绝不伤及已有账目）及 `cancelRestoreJob`。
- [`functions/_lib/task29-backup-api.mjs`](../../functions/_lib/task29-backup-api.mjs) 与 [`functions/api/[[path]].js`](../../functions/api/[[path]].js)：挂载 `/api/backup/v1/{scopes,overview,export,precheck,restore/jobs,restore/jobs/:job_id,restore/jobs/:job_id/commit,restore/jobs/:job_id/cancel}`，强制同源检查、`resolveTask12Account` 会话归属、D1 滑动窗口限流、`task25_feature_flags` (`task29_backup_v1`) 与 `TASK29_BACKUP_ENABLED` 双层 Kill Switch，以及流式有界内存读取。
- [`functions/_lib/task27-auth.mjs`](../../functions/_lib/task27-auth.mjs) 与 [`functions/_lib/task27-store.mjs`](../../functions/_lib/task27-store.mjs)：扩展 Step-up `scope` 白名单支持 `backup_restore(?::[A-Za-z0-9._:-]{8,80})?`，补充 5 项脱敏安全审计事件文案。

### 2.3 前端 UI、PWA 与测试门禁
- [`index.html`](../../index.html)、[`js/account/security-center.js`](../../js/account/security-center.js)、[`app.js`](../../app.js)、[`product-ui.css`](../../product-ui.css)、[`sw.js`](../../sw.js)：
  - 在账户设置 (`#accountBackupOpen`)、账户安全卡片 (`[data-security-backup]`) 与财务中心 (`#finOpenBackupBtn`) 提供入口并集成 `#task29BackupModal`。
  - 在浏览器本地通过 Web Crypto API 直接完成 `.aeris-backup.json` 的加密与解密，口令绝不发送至服务器。
  - 明示区分“已包含云端结构化数据”与“不包含 Android 本地 Room 原始通知正文/短信/截图”；区分加密包/JSON（完整可验证恢复）与 CSV（仅查看分析，不可无损恢复）。
  - 集成只读差异预览、勾选显式确认、Task27 Step-up 复核、取消预检作业及 `ownerBoundRequest` 切换账户清态防串台。
  - 通过 `node scripts/update_task27_publication.mjs` 更新 `sw.js` 发布完整性清单，未破坏 P07 Shell 清单长度约定。
- [`qa/task29/backup-restore.mjs`](../../qa/task29/backup-restore.mjs)、[`qa/task29/workerd.mjs`](../../qa/task29/workerd.mjs)、[`qa/task29/browser.mjs`](../../qa/task29/browser.mjs)、[`package.json`](../../package.json)、[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)：纳入 CI 自动化测试与浏览器/Workerd 验收脚本。

---

## 3. 安全、隐私与 P03–P06 边界保障及已知限制

1. **Android 本地通知原文绝不云端化**：服务端导出与恢复前均递归拒绝任何 `raw_text`、`body`、`bigText`、`sms_body`、`verification_code_raw` 等字段，UI 与 Manifest 明确声明 Android 本地 Room 原始通知正文与媒体不在云端备份范围内。
2. **前置 P03–P06 未通过域不越权放宽**：
   - 支持 `CNY`/`USD`/`EUR`/`HKD`/`GBP` (`digits = 2`) 与 `JPY` (`digits = 0` 或历史未验证 `NULL`)，保留 `amount_exponent = NULL` 与存疑 `¥` (`currency_review_required = 1`) 的待核实状态；
   - `AUTHORIZED`/`RELEASED`/`EXPIRED` 预授权事件仅作为结构化控制证据恢复，绝不计入正式支出总额；
   - `lifecycle_revision > 1` 缺少权威对账依据时按持久态保守恢复，并向用户清晰揭示限制；
   - CSV 仅用于表格统计分析（防公式前缀注入与 `BigInt` 精度格式化），恢复端口拒绝 CSV；
   - 系统不保存用户备份口令，遗失口令无法解密已有 `.aeris-backup.json` 容器。

---

## 4. 验证证据索引

- **Task29 专属套件**：`npm run test:task29` (`6/6 PASS`)、`npm run test:task29:runtime` (`3/3 PASS`)、`npm run test:task29:browser` (`5/5 PASS`，覆盖 `1440`/`768`/`390`/`375` px 浅深双主题与 `axe` 零严重/关键违规)。
- **隔离 Hosted Preview 验收**：详见 [`docs/task29/PREVIEW_ACCEPTANCE.md`](./PREVIEW_ACCEPTANCE.md)（实网 URL `https://thewyj-task29-preview.pages.dev`，`4/4 PASS`，合成用户已验证清零）。
- **回归与基线**：`test:task27` (`33/33`)、`test:task28` (`31/31`)、`test:task12` (`15/15`)、`test_task16_d1_js.mjs` (`11`)、`test:task17`、`test:task20` (`18/18` + Android 契约)、`test:task21-payment`、`test:task21-notification`、`test:task22`、`sw-install.test.mjs` (`20/20`)、`check_js_module_graph.mjs`、`check_storage_contract.mjs`、`audit_async_interactions.mjs` 全数通过；`qa/finance-p04/` 除 `raw-transport.mjs` 因独立 worktree 缺少 git-ignored 基线目录 `docs/migration-evidence/finance-p04/local/baseline-modules` 导致 `old-exact-raw-receipt-stays-CNY-after-additive-upgrade` 失败外（`35 PASS / 1 FAIL`），其余 `unit-review.mjs` (`19/19`)、`default-currency.mjs` (`11/11`)、`contracts.mjs` (`39/39`) 均通过。
- **详细设计文档**：[`EXISTING_CAPABILITIES_AND_GAP_ANALYSIS.md`](./EXISTING_CAPABILITIES_AND_GAP_ANALYSIS.md)、[`DATA_SCOPE_AND_PRIVACY.md`](./DATA_SCOPE_AND_PRIVACY.md)、[`BACKUP_FORMAT_AND_CRYPTO.md`](./BACKUP_FORMAT_AND_CRYPTO.md)、[`EXPORT_RESTORE_CONTRACT.md`](./EXPORT_RESTORE_CONTRACT.md)、[`RESTORE_STATE_MACHINE.md`](./RESTORE_STATE_MACHINE.md)、[`RELEASE_AND_ROLLBACK.md`](./RELEASE_AND_ROLLBACK.md)、[`PREVIEW_ACCEPTANCE.md`](./PREVIEW_ACCEPTANCE.md)、[`VALIDATION_SUMMARY.json`](./VALIDATION_SUMMARY.json)。
