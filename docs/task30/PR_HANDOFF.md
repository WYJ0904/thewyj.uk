# Task30 PR 交付清单与变更摘要 (`PR_HANDOFF`)

## 1. 分支与基线信息

- 仓库：`WYJ0904/thewyj.uk`
- 开发分支：`hydrogen/task30-privacy-retention-erasure`
- 基线提交：最新 `origin/main`（`bb41a0a5`，含 PR #160 发布后清单基线）
- 工作树说明：独立隔离工作树（对应任务分支 `hydrogen/task30-privacy-retention-erasure`）

---

## 2. 本次交付文件列表

### 数据库与配置
- `cloudflare/migrations/0040_task30_privacy_retention_erasure.sql` — 新增 `task30_metadata`、`task30_user_consents`、`task30_erasure_requests`、`task30_erasure_tasks`、`task30_erasure_generations`、`task30_erasure_tombstones`、`task30_cleanup_runs`、`task30_privacy_audit` 及 `task25_feature_flags` `'task30_privacy_v1'` 开关。
- `wrangler.jsonc` — 为 `vars`、`env.preview.vars`、`env.production.vars` 增加 `TASK30_PRIVACY_ENABLED: "true"`（`env.preview` 与 `env.production` D1/R2 绑定保持原状未改）。
- `package.json` — 新增脚本 `test:task30`、`test:task30:runtime`、`test:task30:browser`。

### 后端核心与跨模块接入
- `functions/_lib/task30-privacy-catalog.mjs` — 权威 8 大类数据目录、真实留存策略、保留例外、4 项可选同意定义、`DEVICE_OS_PERMISSIONS_DISCLOSURE` 与 `ESSENTIAL_SERVICE_PROCESSING`。
- `functions/_lib/task30-privacy-service.mjs` — 数据概览、双向可选同意管理（联动 `finance_ai_consents` 与批量吊销分享授权）、二步预检/取消/Step-up 提交/幂等/R2 重试状态机、`executeAccountErasure()`、`runPrivacyRetentionCleanup()` 与墓碑引擎。
- `functions/_lib/task30-privacy-api.mjs` & `functions/api/[[path]].js` & `functions/_lib/cloudflare-foundation.mjs` — `/api/privacy/v1/*` 路由处理、同源/有界 JSON/限流/跨账号拦截与 Feature Flag 注册。
- `functions/_lib/task27-auth.mjs` / `task27-store.mjs` / `task27-api.mjs` — 扩展 `privacy_consent_revoke`、`privacy_data_delete`、`privacy_account_delete` Step-up Scope 及审计事件文案。
- `functions/_lib/task12-service.mjs` & `task12-api.mjs` — 将 `deleteOwnAccount()` 接入全业务级 `executeAccountErasure()`（保留既有 `skipUserSessions: true` 兼容）。
- `functions/_lib/task16-service.mjs` — 交易、分类、预算、原始事件及对账合并接入 `task30_erasure_tombstones` 防复活校验。
- `functions/_lib/task21-service.mjs` & `task21-hints.mjs` — 云端通知摄入与线索同步接入 `cloud_notification_sync` 同意门控与墓碑防复活拦截。
- `functions/_lib/task29-backup-service.mjs` — 备份预检与提交接入墓碑拦截及 `erasure_generation_snapshot` 提交前原子失效校验（`BACKUP_PLAN_INVALIDATED_BY_ERASURE`）。
- `docs/task27/policies/privacy-2026-11-18-v1.md` & `functions/_lib/task27-policy-archive.mjs` / `task27-policy.mjs` — 归档 Task30 修订版政策并维持 `2026-11-16-v1` 现行激活。

### 前端 UI 与 Service Worker 清单
- `index.html`、`js/account/security-center.js`、`product-ui.css` — 账户安全中心「隐私与数据管理」4 标签模态窗口（我的数据 / 授权和同意 / 删除我的数据 / 数据请求记录）与 `deleteAccountModal` 引导说明，修复 `.task27-modal` 单选框尺寸。
- `sw.js` — 经 `npm run task27:publication` 重新生成的静态资源完整性校验清单。

### 测试与文档
- `qa/task30/privacy-erasure.mjs`、`qa/task30/workerd.mjs`、`qa/task30/browser.mjs`、`qa/task30/preview-acceptance.mjs`
- `docs/task30/` 下全部 10 份专题交付文档（含本文件）。

---

## 3. 人工审核重点提示

1. 核查 `0040_task30_privacy_retention_erasure.sql` 的字段/索引与既有表迁移兼容性。
2. 核查 `functions/_lib/task12-service.mjs`、`task16-service.mjs`、`task21-service.mjs`、`task21-hints.mjs` 与 `task29-backup-service.mjs` 中的墓碑/同意钩子是否均安全兼容未执行 `0040` 的半升级库（`hasTask30Schema` 保护）。
3. 核查 `wrangler.jsonc` diff 确认仅添加 `"TASK30_PRIVACY_ENABLED": "true"`，未改变任何 D1/R2 绑定。
4. 明确知悉 **Android 真机为 `NOT_TESTED — NOT REQUIRED`**、**Production 未迁移未上线**。
