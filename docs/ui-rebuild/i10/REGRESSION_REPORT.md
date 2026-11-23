# Aeris V6.3 — I10｜全量回归与多环境验收报告（Regression Report）

> **环境与测试口径**：严格区分 **本地隔离测试（Miniflare / Wrangler）**、**云端隔离预览（`thewyj-i10-preview`）**、**GitHub Core CI（待 Push 后在最终提交 SHA 核验）** 与 **Android 真机 WebView**。每条结论均来自实际执行输出，未通过或未运行的项目按规则明确标注。

---

## 1. 静态门禁、构建与功能审计（Tested SHA: `942f40f4cebf4bb0f9988b95292162a2fb679ee0` 前/同源源码）

| 检查项 | 命令 | 结果 | 实测输出摘要 |
|---|---|---|---|
| SW 发布摘要与完整性 | `npm run task27:publication` | **PASS** | `publication_hash: f6f21340064277c936addb559f7b7274201db7501ffe1cf46561ba741dee4034`（20 integrity entries, `prior_core_shell_preserved: true`） |
| Cloudflare Pages 构建暂存 | `npm run build` | **PASS** | `.wrangler/pages-output` 生成完成（216 文件） |
| Pages Functions 编译检查 | `npm run cf:check` | **PASS** | `Compiled Worker successfully` |
| ES Module 模块图检查 | `node scripts/check_js_module_graph.mjs` | **PASS** | 67 files, 116 imports, zero cycles |
| 前端 Storage Key 契约 | `node scripts/check_storage_contract.mjs` | **PASS** | 31 stable key families audited |
| 全站功能审计门禁 | `python scripts/functional_audit_gate.py` | **PASS** | 27 routes, 24 app flows, 104 tools, 51 tool modes, 7 checkbox controls, 12 workflow capabilities, 27 workflow flows |
| 仓库资产与敏感检查 | `python scripts/repository_audit.py` | **PASS** | 2297 tracked and candidate files checked |

---

## 2. 单元测试与 D1 / Worker 后端回归（全部串行执行完成）

| 套件 | 命令 | 结果 | 实测统计 |
|---|---|---|---|
| I03–I09 & V6 UI 合约 | `node --test local-backend/test_i0*.mjs local-backend/test_v6_ui_contracts.mjs` | **PASS** | 41 / 41 passed, 0 failed |
| Task 16 财务 D1 核心 | `node local-backend/test_task16_d1_js.mjs` | **PASS** | 11 / 11 D1 checks passed |
| Task 17 财务模型与会员 | `npm run test:task17` | **PASS** | Web model + D1 gate passed |
| Aeris 状态一致性 | `npm run test:aeris-state` | **PASS** | 13 / 13 unit + candidates + notification ledger passed |
| Task 27 Web 通知合约 | `node local-backend/test_task27_web_notification_js.mjs` | **PASS** | 8 / 8 isolated API groups passed |
| Task 28 私有文件与分享 | `npm run test:task28` | **PASS** | 31 / 31 checks passed |
| Task 29 加密备份与恢复 | `npm run test:task29` | **PASS** | 7 / 7 checks passed |
| Task 30 隐私中心与删除 | `npm run test:task30` | **PASS** | 8 / 8 checks passed |
| Task 26 错题本与预算 | `npm run test:task26` | **PASS** | D1 13 groups + Client 6 groups + multi-window / outbox passed |

*(注：前期在同源码修复后亦运行通过 `python -m unittest local-backend/test_static.py` 31/31、`npm run test:ds-sso` 23/23、`npm run test:task25` 12 D1 + 19 Web/native、`npm run test:task27:login-guard` 9/9。)*

---

## 3. 浏览器集成与 UI 自动化回归（严格串行，单重型套件并发度 = 1）

| 套件 | 运行环境 | 结果 | 实测详情 |
|---|---|---|---|
| `node qa/i10/browser-acceptance.mjs` | 本地 Miniflare + Chrome (`942f40f4`, dirty=false) | **PASS** | 7/7 场景通过、3 axe scans (0 violations)、3 contrast audits (0 violations)、6 截图、0 API/JS 错误 |
| `node qa/i09/browser-acceptance.mjs` | 本地 Miniflare + Chrome | **PASS** | 4/4 scenarios passed (HUD coexistence, drawer, toast, kill switch + P07 OFF) |
| `node qa/i08/browser-acceptance.mjs` | 本地 Miniflare + Chrome | **PASS** | 5/5 scenarios passed |
| `node qa/i06/browser-acceptance.mjs` | 本地 Miniflare + Chrome | **PASS** | 6/6 scenarios passed (12 screenshots) |
| `node qa/i04/browser-acceptance.mjs` | 本地 Miniflare + Chrome | **PASS** | 11 scenarios, 7 axe scans, 10 viewports |
| `node qa/i03/browser-acceptance.mjs` | 本地 Miniflare + Chrome | **PASS** | 4 scenarios, 11 axe scans, 4 viewports |
| `npm run test:aeris-state-browser` | 本地合成浏览器 | **PASS** | 6 / 6 passed |
| `npm run test:task28:browser` | 本地 Miniflare + Chrome | **PASS** | 5 / 5 passed |
| `npm run test:task29:browser` | 本地 Miniflare + Chrome | **PASS** | 5 / 5 passed (1440/768/390/375 Light/Dark) |
| `npm run test:task30:browser` | 本地 Miniflare + Chrome | **PASS** | 4 / 4 passed (768/390/375 >=44px & 0 overflow) |
| `npm run test:tts:browser` | 本地 Loopback Chrome + Synthetic | **PASS** | `PASS_SYNTHETIC_TRANSPORT_ONLY` (14 checks, `actual_azure_requests: 0`) |
| `local-backend/test_interaction_feedback_browser.mjs` | 本地 Wrangler Pages Dev (8894) + Chrome | **PASS** | 全模块即时 pending 反馈通过 |
| `qa/aeris/transfer-clipboard-browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | 剪贴板粘贴与非激活态隐私回归通过 |
| `qa/aeris/home-widgets-browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | 首页组件渲染、原生导航与登出状态清空通过 |
| `qa/aeris/mobile-widgets-browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | 移动端 390px 组件与布局通过 |
| `qa/aeris/p2-interaction-browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | P2 交互流通过 |
| `qa/task25/feature-flags-browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | 390px & 1366px Admin Feature Flags XSS 防护与 Step-up 通过 |
| `qa/aeris/p3-brand-public-browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | 390/1366/1920 Light/Dark `CLS=0`, `overflow=false` |
| `local-backend/test_task18_browser.mjs` | 本地 Wrangler Pages Dev + Chrome | **PASS** | 5/5 flows (XSS modal, message dismiss, owner role UI, bulk send) |
| `local-backend/test_tools_browser.mjs` | 本地 Wrangler + Chrome（早期运行于修复后同源 CSS） | **PARTIAL / WIN_ENV** | 通过全部 104 工具与行 1467 / 1496 (`#toolsPanel`) / 1518 (`#toolWorkbench`) 对比度检查；行 1537 调用 `qa/verify_tool_artifacts.py` 因本地 Windows 缺 `cv2` 模块退出。**将由 Push 后 GitHub Core CI Ubuntu 完整跑通并核验最终 SHA 结果。** |
| `local-backend/test_app_browser.mjs` | 本地 Wrangler Pages Dev（错配后端形态） | **NOT_MATCHED_LOCAL / CI_COVERED** | CI 中该脚本绑定 Python `local-backend/server.py` + `VOCAB_PAYMENT_QR_DIR` 夹具（`Browser flow (application)`），不支持无 QR 目录的纯粹 `wrangler pages dev` 离线恢复后的下单测试；交由 GitHub Core CI `Browser flow (application)` 在最终 SHA 完整核验。 |
| `npm run test:task27:browser` | 本地 Windows 工作树 | **SKIPPED (MISSING_LOCAL_REF)** | 依赖未提交的本地缓存目录 `.wrangler/task27-reference/otpauth-lab/node_modules/jsqr`；由 Unit/D1/Login-Guard 与 CI 覆盖。 |

---

## 4. 云端隔离 Preview 验收（`thewyj-i10-preview`）

- **部署地址**：`https://i10-interaction-acceptance.thewyj-i10-preview.pages.dev`（独立 D1 `aeris-i10-preview` / `dde3e526-eee3-4690-bdd8-a7168c318681`，独立 R2 `aeris-i10-preview-storage`，部署版本 `942f40f4cebf4bb0f9988b95292162a2fb679ee0`）。
- **验证脚本**：`node qa/i10/verify-preview.mjs` -> **PASS**（[i10-preview-verification.json](evidence/hosted/i10-preview-verification.json)）：
  - 12 个修改及核心前端静态资源 SHA-256 与本地 Git 提交完全一致；
  - `authenticatedMode: true`，真实完成注册、隔离测试会员写入及登录验证；
  - `模糊搜索工具` 计算前景色 `rgb(71, 85, 105)`，`/tools` 390px 溢出 `0`；
  - `/finance` 6 币种列表、抽屉 `transform: none`、Toast/版本提示无重叠；
  - 3 项线上 `axe-core` 全页审计 **0 violations**，保存 5 张 Hosted 截图于 `docs/ui-rebuild/i10/evidence/hosted/`。

---

## 5. GitHub Core CI 与真机状态

- **GitHub Core CI**：将在提交本报告与证据、Push `hydrogen/i10-full-site-interaction-acceptance` 并创建 Draft PR 后，盯控并核验对应**最终提交 SHA** 的真实 GitHub Core CI 结果（状态将记录/补充或随 PR 核验）。
- **Android 真机 WebView**：当前工作区未连接物理测试设备，按规范显式标记为 **`NOT_TESTED`**（不以模拟器或桌面 Chrome 冒充真机 PASS）。
