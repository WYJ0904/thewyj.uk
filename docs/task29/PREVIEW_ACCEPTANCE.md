# Task29 隔离 Hosted Preview 实网验收报告

- **任务**: Aeris V6.3 — Task29 数据导出、加密备份与可验证恢复 (`P1`)
- **验收状态**: `PASS`（real headless Chrome `Chrome/157.0.8103.79` 端到端实测通过）
- **最近复核部署**: `https://89d4e1b2.thewyj-task29-preview.pages.dev`（`https://thewyj-task29-preview.pages.dev`）

---

## 1. 隔离环境拓扑与绑定核验

| 资源类型 | 隔离 Preview 实例 | 状态与核验结果 |
| :--- | :--- | :--- |
| **Pages 项目** | `thewyj-task29-preview` | 已部署最终待发布静态资源 + Functions Bundle |
| **Preview 访问地址** | `https://thewyj-task29-preview.pages.dev`（部署实例 `https://89d4e1b2.thewyj-task29-preview.pages.dev`） | `GET /api/status` 返回 `200 OK`，`environment = "preview"` |
| **隔离 D1 数据库** | `thewyj-task29-preview` (`88ba104f-1855-47ae-843e-a527b63979b4`) | `wyj_d1_migrations` 已应用全部 `39` 个增量迁移（`0001_foundation.sql` 至 `0039_task29_encrypted_backup_restore.sql`），`task29_*` 表就绪 |
| **隔离 R2 存储桶** | `thewyj-task29-preview-files` | `bindings.r2 = true` |
| **环境变量与密钥** | `WYJ_ENVIRONMENT="preview"`, `TASK27_SECURITY_ENABLED="true"`, `TASK29_BACKUP_ENABLED="true"`, `D1_RATE_LIMIT_ENABLED="true"`, `EMAIL_SENDING_ENABLED="false"`，配合 `5` 个仅用于 Preview 的合成签名/加盐 Secret | `rate_limit.enabled = true`, `degraded = false`，`task12`/`task16`/`task20`/`task22` Schema 就绪 |

---

## 2. Real Chrome 端到端实网测试项（`5/5 PASS`）

测试脚本 `.wrangler/task29/hosted-preview-verify.mjs` 使用真实 Chrome (`Chrome/157.0.8103.79`) 连接 `https://thewyj-task29-preview.pages.dev` 并核验远端 Preview D1 状态：

1. **HTTPS Status 与安全策略就绪 (`PASS`)**：验证 `/api/status` 返回 `ok: true`、`environment: "preview"`、`bindings.d1: true`、`bindings.r2: true`。
2. **浏览器登录 -> 数据备份中心 -> Web Crypto AES-256-GCM 加密导出 (`PASS`)**：临时用户 A 在 `/account` 打开 `#task29BackupModal`，生成并下载 `.aeris-backup.json`（`format = "aeris-encrypted-backup"`），确认导出包不包含明文口令。
3. **只读模拟预检 -> Task27 Step-up 恢复 -> 幂等重放 -> 历史未验证 `JPY` 保真 (`PASS`)**：
   - 从远端 Preview D1 删除 `JPY` (`amount_minor = 3200`, `amount_exponent = NULL`, `currency_review_required = 1`) 记录，确认剩余 `1` 条；
   - 执行**只读预检**，验证新增 `1` 条、跳过一致 `3` 条、冲突 `0` 条、拒绝 `0` 条，且远端 D1 交易数保持 `1` 条；
   - 通过 Task27 Step-up 恢复提交后验证 `JPY` `amount_exponent = null` 原样恢复；
   - 再次预检并提交同一加密包，返回 `幂等重放完成`，远端 D1 保持 `2` 条不重复记账。
4. **退出登录失效 + 跨账户隔离拦截 (`PASS`)**：点击 `#accountMenu summary` -> `#logoutBtn` 退出后，立即验证 `/api/backup/v1/scopes` 返回 `401/403`；随后登录临时用户 B 上传用户 A 加密备份包执行预检，明确拒绝并提示属于“其他账户”。
5. **手机 390px 与 375px 视口响应式与交互可用性 (`PASS`)**：模拟移动设备切换至 `390x844` 与 `375x667` 视口，验证 `#task29BackupModal` 零横向溢出、`#backupPrecheckBtn` 与 `#backupRestoreFileInput` 均可见且边界不超出视口。

本地留证目录（git-ignored）：`.wrangler/task29/evidence/hosted-preview-56d92c49-de8a-4769-8f34-4ead8513f5e4/`（含 `result.json`、`hosted-preview-precheck.png`、`hosted-preview-restored.png`、`hosted-preview-mobile-375.png`）。

---

## 3. 测试数据清理与状态标志

- **测试用户清理验证**：对 `thewyj-task29-preview` D1 执行 `SELECT COUNT(*) AS leftover_test_users FROM task12_users WHERE id LIKE 'prv_t29_%'` 返回 `0`。
- `HOSTED_PREVIEW_E2E`: `PASS`
- `ANDROID_PHYSICAL_DEVICE`: `NOT_TESTED — NOT REQUIRED FOR TASK29 ACCEPTANCE`
