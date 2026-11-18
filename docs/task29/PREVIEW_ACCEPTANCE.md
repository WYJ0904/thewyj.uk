# Task29 隔离 Hosted Preview 实网验收报告

- **任务**: Aeris V6.3 — Task29 数据导出、加密备份与可验证恢复 (`P1`)
- **验收状态**: `PASS`（real headless Chrome `Chrome/157.0.8103.79` 端到端实测通过）
- **发布状态**: `PRODUCTION_NOT_RELEASED`（仅部署于完全隔离的 Preview 项目；Production 零改动）

---

## 1. 隔离环境拓扑与绑定核验

| 资源类型 | 隔离 Preview 实例 | 状态与核验结果 |
| :--- | :--- | :--- |
| **Pages 项目** | `thewyj-task29-preview` | 已部署静态资源 + Functions Bundle |
| **Preview 访问地址** | `https://thewyj-task29-preview.pages.dev`（部署实例 `https://0c0db46c.thewyj-task29-preview.pages.dev`） | `GET /api/status` 返回 `200 OK`，`environment = "preview"` |
| **隔离 D1 数据库** | `thewyj-task29-preview` (`88ba104f-1855-47ae-843e-a527b63979b4`) | `wyj_d1_migrations` 已应用全部 `39` 个增量迁移（`0001_foundation.sql` 至 `0039_task29_encrypted_backup_restore.sql`），`task29_metadata` / `task29_backup_exports` / `task29_restore_jobs` / `task29_restore_idempotency` / `task29_backup_audit` 已就绪 |
| **隔离 R2 存储桶** | `thewyj-task29-preview-files` | `bindings.r2 = true` |
| **环境变量与密钥** | `WYJ_ENVIRONMENT="preview"`, `TASK27_SECURITY_ENABLED="true"`, `D1_RATE_LIMIT_ENABLED="true"`, `EMAIL_SENDING_ENABLED="false"`，配合 `5` 个仅用于 Preview 的合成签名/加盐 Secret | `rate_limit.enabled = true`, `degraded = false`，`task12`/`task16`/`task20`/`task22` Schema 就绪 |
| **Production 资源** | `wyj-cloud-production` D1/R2、`thewyj.uk` 正式站、Android Stable `1.3.41` (`versionCode 54`) | **完全未触碰** (`production_touched: false`) |

---

## 2. Real Chrome 端到端实网测试项（`4/4 PASS`）

测试脚本 `.wrangler/task29/hosted-preview-verify.mjs` 使用真实 Chrome (`Chrome/157.0.8103.79`) 连接远端 `https://thewyj-task29-preview.pages.dev` 并核验远端 Preview D1 状态：

1. **HTTPS Status 与安全策略就绪 (`PASS`)**：验证 `/api/status` 返回 `ok: true`、`environment: "preview"`、`bindings.d1: true`、`bindings.r2: true`。
2. **浏览器登录 -> 数据备份中心 -> Web Crypto AES-256-GCM 加密导出 (`PASS`)**：使用临时测试用户 A 登录，在 `/account` 打开 `#task29BackupModal`，输入 10+ 位口令生成并下载 `.aeris-backup.json`（容器 `format = "aeris-encrypted-backup"`），确认导出包不包含明文口令。
3. **只读模拟预检 -> Task27 Step-up 恢复 -> 幂等重放 -> 历史未验证 `JPY` 保真 (`PASS`)**：
   - 从远端 Preview D1 删除用户 A 的一条 `JPY` (`amount_minor = 3200`, `amount_exponent = NULL`, `currency_review_required = 1`) 遗留记录，确认剩余 `1` 条；
   - 在真实浏览器上传加密备份包与解密口令并执行**只读预检**，验证摘要显示新增 `1` 条、跳过一致 `3` 条、冲突 `0` 条、拒绝 `0` 条，且远端 D1 交易数仍严格维持 `1` 条；
   - 勾选确认复选框并通过 Task27 Step-up 密码复核提交恢复，验证远端 D1 精确恢复该记录为 `currency = "JPY"`、`amount_minor = 3200`、`amount_exponent = null`（不擅自补全 `0` 指数或破坏已有记录）；
   - 再次上传同一加密包执行二次预检与 Step-up 提交，界面明确提示 **幂等重放完成**，远端 D1 交易总数保持 `2` 条不重复记账。
4. **跨账户隔离拦截 (`PASS`)**：通过右上角账户菜单安全退出用户 A 后登录临时测试用户 B，上传用户 A 的加密备份包执行预检，服务端与前端正确拒绝并提示属于“其他账户”。

本地留证目录（git-ignored）：`.wrangler/task29/evidence/hosted-preview-41bbea75-b43e-4b7f-800b-cd4db7463fd7/`（含 `result.json`、`hosted-preview-precheck.png`、`hosted-preview-restored.png`）。

---

## 3. 测试数据清理与限制声明

- **测试用户清理验证**：验收脚本 `finally` 块自动删除 `prv_t29_%` 临时账户及级联数据；后续对 `thewyj-task29-preview` D1 执行 `SELECT COUNT(*) AS leftover_test_users FROM task12_users WHERE id LIKE 'prv_t29_%'` 返回 `0`。
- **端到端验收声明**：
  - `HOSTED_PREVIEW_E2E`: `PASS`
  - `ANDROID_PHYSICAL_DEVICE`: `NOT_TESTED — NOT REQUIRED FOR TASK29 ACCEPTANCE`（本轮明确免除真机 APK 安装与 USB 调试，移动端已通过真实 Chrome 移动视口与触摸仿真完成覆盖）。
