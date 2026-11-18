# Task30 隔离 Hosted Preview 验收报告 (`PREVIEW_ACCEPTANCE`)

## 1. 隔离环境资源清单（与 Production 严格物理隔离）

本次 Hosted Preview 全流程部署与验收仅使用独立新建的预览资源，**未改动 Production D1（`wyj-cloud-production`）、Production R2 或正式域名 `https://thewyj.uk`**：

| 资源类型 | 名称 / 标识 | 说明 |
|---|---|---|
| Cloudflare Pages 项目 | `thewyj-task30-preview` (`--production-branch preview`) | 隔离 Preview 项目 |
| 本次验证访问域名 | `https://task30-preview.thewyj-task30-preview.pages.dev`（部署单次 URL：`https://3c48471b.thewyj-task30-preview.pages.dev`） | `--branch task30-preview` |
| D1 数据库 | `thewyj-task30-preview`（`database_id`: `1c8ae968-4b1a-484d-a5b4-10961cbc12cf`） | 通过 `--remote --config .wrangler/wrangler.task30-preview.jsonc` 完成 `0001..0040` 全量迁移 |
| R2 存储桶 | `thewyj-task30-preview-files` | 隔离测试对象存储 |
| Secret 注入 | 通过 `npx wrangler pages secret bulk ... --env preview` 注入 5 个独立合成随机密钥 | 临时 JSON 注入后立即删除，未入库 |
| 仓库配置保护 | 部署时使用 `node scripts/stage_pages_deploy.mjs` 白名单打包，完成后立即 `git checkout -- wrangler.jsonc` 恢复主配置 | 避免破坏共享 `wyj-cloud-preview` 绑定与 Production 块 |

---

## 2. 实时健康检查与端到端验收结果

### 2.1 状态端点实测 (`GET /api/status`)

```json
{"ok":true,"env":"preview","bindings":{"d1":true,"r2":true,"workers_ai":true},"task30":true,"task12":{"schema_ready":true,"schema_version":"1","session_strategy":"invalidate_legacy_sessions","password_pepper_configured":true}}
```

### 2.2 自动化实网 Chrome 端到端验收 (`node qa/task30/preview-acceptance.mjs`)

- 最近完整通过证据目录：`.wrangler\task30\evidence\preview-538028ed-f691-43a9-bcab-a6707aa81105`
- 退出码：`0` · 通过项：`4 / 4`

| 检查项 | 结果 | 说明 |
|---|---|---|
| `Preview /api/status reports task30_privacy enabled & archive 2026-11-18-v1 loads` | **PASS** | 状态接口报告 `task30_privacy: true`，政策归档 `?version=2026-11-18-v1` 返回 HTTP 200 |
| `Register synthetic preview user, seed Task29 backup export, inspect Privacy Center in real Chrome` | **PASS** | 注册/登录隔离测试账户，生成 `finance_core` 范围 JSON 备份导出，Chrome 登录并打开隐私中心渲染 8 大类 |
| `Consent toggle, backups erasure with Step-up, and verifiable report work on HTTPS Preview` | **PASS** | 通过 Step-up 撤回 `cloud_notification_sync`，生成并提交 `backups` 删除预检（输入 `DELETE BACKUPS` + 密码核验），请求记录列表呈现可核验结果 (`completed`) |
| `Mobile 390x844 Dark viewport passes layout & deletes synthetic test account cleanly` | **PASS** | `390×844` Dark 视口零横向溢出，随后以 `privacy_account_delete` Step-up 销毁该合成测试账户，再查 `/api/privacy/v1/overview` 返回 HTTP `401/403` |

- 已目视检查的 HTTPS Preview 截图：
  - `preview-desktop-data.png`（桌面 `1440×900` Light：8 大类卡片、基线版本与计数完整）
  - `preview-desktop-requests.png`（桌面 `1440×900` Light：同意撤回、预检及已完成安全删除请求记录）
  - `preview-mobile-dark.png`（移动 `390×844` Dark：2×2 标签栏与全宽按钮零横向溢出）

### 2.3 真机声明

- Android 真机测试：**`NOT_TESTED — NOT REQUIRED`**。Preview 移动端截图为 headless Chrome 视口模拟，不代表 Android 系统权限撤回或设备 Room 擦除。
