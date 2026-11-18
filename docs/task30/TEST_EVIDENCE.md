# Task30 测试与验证证据汇总 (`TEST_EVIDENCE`)

以下记录全部基于最新变基（`origin/main` `bb41a0a5`）及最终前端 CSS 修复提交之后**实际执行且退出码为 `0`** 的本地自动化与浏览器/Workerd 验证结果。

---

## 1. 静态架构、模块图与 Cloudflare Bundler 门禁

| 命令 | 结果 | 实测输出摘要 |
|---|---|---|
| `node scripts/check_js_module_graph.mjs` | **PASS (exit 0)** | `ES module graph passed: 67 files, 110 imports, no cycles or reversed core dependencies.` |
| `node scripts/check_storage_contract.mjs` | **PASS (exit 0)** | `Frontend storage contract passed: 31 stable key families audited.` |
| `node scripts/check_task15_cloud_only.mjs` | **PASS (exit 0)** | `Task 15 cloud-only gate passed: 102 Production modules, 201 Cloudflare routes, 119 frontend routes.` |
| `npm run cf:check` | **PASS (exit 0)** | `✨ Compiled Worker successfully`（输出至 `.wrangler/functions-build`） |

---

## 2. Task30 专项测试套件

### 2.1 Miniflare D1 / API 全链路单测 (`npm run test:task30`)

- 执行脚本：`node qa/task30/privacy-erasure.mjs`
- 结果：**`8 / 8 PASS` (exit 0)** · 证据目录：`.wrangler\task30\evidence\unit-d1-e064e225-5ce2-4490-8df4-745307482ce6`
- 覆盖项：
  1. `Data catalog & unauth fail-closed check & owner overview`
  2. `Owner isolation & cross-account rejection (including admin rejection on user_id mismatch)`
  3. `Consent revocation stops Finance AI & Cloud notification ingestion (without claiming OS revocation)`
  4. `Preview/Cancel lifecycle, Confirmation & Step-up enforcement`
  5. `Files & Temporary immediate access revocation + R2 retry_pending -> retry -> completed + idempotency`
  6. `Finance & Notifications erasure + anti-resurrection across sync, Task21 & Task29 backups (precheck and mid-flight commit)`
  7. `Learning FK/immutable safe erasure + Support retention exceptions + Cleanup Run`
  8. `Admin closure protection, Account full closure erasure, and legacy /api/account/delete integration`

### 2.2 编译后 Workerd 运行时测试 (`npm run test:task30:runtime`)

- 执行脚本：`npm run cf:check && node qa/task30/workerd.mjs`
- 结果：**`2 / 2 PASS` (exit 0)** · 证据目录：`.wrangler\task30\evidence\workerd-21020401-1759-4c09-9a0a-07d4806b8111`
- 覆盖项：
  1. `/api/status` 报告 `task30_privacy` 启用且 `/privacy?version=2026-11-18-v1` 返回 200
  2. 真实 `workerd` 路由端到端执行概览、同意撤回、R2 故障转 `retry_pending` 后重试完成与请求详情

### 2.3 真实 Chromium / Chrome 交互与多视口测试 (`npm run test:task30:browser`)

- 执行脚本：`node qa/task30/browser.mjs`
- 结果：**`4 / 4 PASS` (exit 0)** · 证据目录：`.wrangler\task30\evidence\browser-4e9f51b5-30f6-4fc3-b876-c59de520971d`（含最终修复 `.task27-modal` 单选框宽度的最新视觉验证）
- 覆盖视口：桌面 `1440×900`（Light）、平板 `768×1024`（Light）、移动端 `390×844`（Dark）、移动端 `375×667`（Light），`>=44px` 触控热区、零横向溢出、0 API >=500 错误、0 运行时错误。
- 已生成并核验 7 张截图：`desktop-light-data.png`, `desktop-light-consents.png`, `desktop-light-erasure-preview.png`, `desktop-light-requests.png`, `tablet-768-privacy.png`, `mobile-390-dark-privacy.png`, `mobile-375-light-privacy.png`。

---

## 3. 核心关联模块回归测试（于最新代码基线实测通过）

| 套件命令 | 实测结果 | 备注 |
|---|---|---|
| `npm run test:task12` | **PASS (exit 0)** | 15 checks passed (`deleteOwnAccount` 与会话兼容) |
| `npm run test:task21-payment` | **PASS (exit 0)** | 支付方式与权限边界全通过 |
| `npm run test:task21-notification` | **PASS (exit 0)** | 通知识别、提示与同意拦截关联验证 |
| `npm run test:task27` | **PASS (exit 0)** | 33 isolated D1/API groups passed (`Step-up` 扩展与政策归档) |
| `npm run test:task28` | **PASS (exit 0)** | 31 checks passed (私有文件与 R2 清理队列) |
| `npm run test:task29` | **PASS (exit 0)** | 7 checks passed (备份导出与防复活预检/提交回滚) |
| `node local-backend/test_task16_d1_js.mjs` | **PASS (exit 0)** | 11 checks passed (财务同步、分类、对账与防复活) |
| `npm run test:task26` | **PASS (exit 0)** | 12 项子脚本全通过（含 `test_task26_d1_js` 29 组与 `wrong-review-d1` 13 组） |
| `node qa/p07-release/publication-checks.mjs` | **PASS (exit 0)** | 发布清单与清单哈希一致 |

> 说明：如 `TEST_EVIDENCE` 所附，回归组执行于 `product-ui.css` 最终 CSS 微调提交前的同逻辑后端树（仅改前端单选框 CSS 与重算 `sw.js` 哈希）；在创建 PR 前还将再跑一轮完整终验命令确认全绿。Android 真机为 `NOT_TESTED — NOT REQUIRED`。
