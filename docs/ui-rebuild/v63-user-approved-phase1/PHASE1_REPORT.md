# Aeris V6.3 UI/UX Refactor｜Phase 1 Delivery Report（全局框架、导航及首页）

> **阶段边界声明**：本报告仅覆盖 **Phase 1（全局框架、导航及首页）**。依据用户指令，交付 **隔离 Hosted Preview + Draft PR（base: `hydrogen/v63-anti-template-structural-redesign`）** 后即暂停等待验收，**未提前开展 Phase 2–9**，未合并 `main`，未触及生产 `thewyj.uk` 或 Android Stable。

---

## 1. Git 与隔离预览环境信息

| 项目 | 值 |
|---|---|
| 仓库 | `WYJ0904/thewyj.uk` |
| 基线提交 | `820a14b09154a3517c46355766cd83c6f3b9ec83`（PR #180 `hydrogen/v63-anti-template-structural-redesign`） |
| 开发分支 | `hydrogen/v63-user-approved-ui-redesign` |
| 隔离 Hosted Preview Alias | https://v63-phase1.thewyj-v63-preview.pages.dev |
| 本次 Cloudflare Pages 部署 URL | https://d09ab353.thewyj-v63-preview.pages.dev |
| 预览环境隔离确认 | Pages 项目 `thewyj-v63-preview` 分支 `v63-phase1`（独立于 PR #180 的 `v63-preview`）；`/api/status?source=cloud` 返回 `"status_env": "preview"` |

---

## 2. 核心架构与界面重构摘要

1. **中性黑白 Design Tokens（[design-system.css](../../../design-system.css)）**
   - 浅色：`#FAFAFA`（页底）、`#F4F4F4`（侧边栏）、`#EAEAEA`（选中态）、`#242424`（主文字）、`#696969`（次文字）。
   - 深色：`#212121`（页底）、`#191919`（侧边栏）、`#303030`（选中态）、`#EAEAEA`（主文字）、`#AAAAAA`（次文字）。
   - 新增 `--ds-sidebar-bg`、`--ds-sidebar-width: 256px`、`--ds-sidebar-collapsed-width: 64px`、`--ds-duration-sidebar: 240ms`、`--ds-ease-bounce-micro`，统一 `overflow-x: clip` 与 `:focus-visible`。
   - 清理 [styles.css](../../../styles.css) `.word-reading` 青色文字发光，并将 [product-ui.css](../../../product-ui.css) 中 `#7b4b0a` 硬编码警告色替换为 `var(--color-warning)`。

2. **GPT 式全局导航与可折叠侧边栏（[index.html](../../../index.html), [spatial-experience.css](../../../spatial-experience.css), [js/core/design-system.js](../../../js/core/design-system.js), [app.js](../../../app.js)）**
   - **桌面登录态**：`body.is-authenticated` 下隐藏顶部大栏 `#accountBar`；左侧 `#v3Sidebar` 支持 `256px` 展开态与 `64px` 图标轨折叠态平滑切换，状态持久化至 `wyj_sidebar_collapsed_v1`，切换模块不擅自折叠；4 个业务分组保持明显组间间距与图标轨悬浮 Tooltip。
   - **权限锁与角色隔离**：普通用户显示 `#sidebarFinanceLock` / `#sidebarToolsLock` / `#sidebarWorkflowsLock` 提示锁图标并保持入口可达；管理员专属 `#v3SidebarAdminLink` 严格仅在 `isAdmin(account)` 时可见。
   - **底部账户菜单**：`#accountMenu` 固定于侧边栏底部，点击向上弹出 `#accountMenuPopover`（账户中心、安全中心、通知收件箱、会员、系统/浅/深三态主题切换、帮助反馈、管理后台、退出登录），含键盘上下导航、`Esc` 关闭与视口防越界。
   - **移动端（`<= 980px`）**：精简顶栏配左上角 `#siteNavToggle` 唤出左侧滑入抽屉，附带边缘滑动手势守卫（避让横向滚动容器）与无底部重复导航栏。

3. **登录态 & 访客态首页重构（[index.html](../../../index.html), [js/core/dashboard.js](../../../js/core/dashboard.js), [js/core/home-widget-layout.js](../../../js/core/home-widget-layout.js), [js/core/public-experience.js](../../../js/core/public-experience.js)）**
   - **登录态 `#authHomeLauncher`**：移除原 `#workspaceBentoGrid`、`.home-workspace-overview`、`#homeV3SummaryGrid`、`#homeProductDetails` 等堆叠卡片；保留时间+真实用户昵称问候、副标题、中央搜索触发器（唤出命令面板）、按账户隔离的可自定义快捷功能（`#homeQuickShortcuts` + `#homeShortcutsModal`，存 `aerisHomeWidgets:v2:<accountId>`）及按需显示的上次测验继续入口。
   - **学习同步控件迁移**：将 `#learningSync*` 与 `#dashboardAccountStatus` / `SyncStatus` / `AiStatus` / `ShareStatus` 迁移至 `#accountModal`「安全与数据」分组，完整保留同步与导出导入能力。
   - **访客态 `#guestHomeLauncher`**：移除营销 Hero、倾斜 3D 预览盒与 `#publicBentoWall`，保留内联 4 项实时体验、中央搜索入口、「查看所有套餐」切换（`#toggleAllPublicPlansBtn`）及极简隐私法律底栏。

4. **Raycast 风格命令面板、统一浮动下拉、路由预取与 Strategy C 记忆（[app.js](../../../app.js), [js/core/design-system.js](../../../js/core/design-system.js), [js/core/router.js](../../../js/core/router.js)）**
   - `#commandPaletteModal`：接入 `js/tools/catalog.js` 全部 104 项真实工具及英文别名（如 `prettier` → `JSON 格式化`），支持分类过滤 Tab、按账户隔离的最近使用/收藏排序、中文输入法 `isComposing` 守卫、键盘 `ArrowUp/Down/Enter/Esc` 及关闭后恢复触发焦点。
   - `.ds-select-host` / `.ds-select-popover`：统一原生 `<select>` 浮层渲染，`<= 5` 项为纯列表、`> 5` 项自动带搜索框，支持方向自适应翻转与键盘操作。
   - 路由切换与记忆：侧边栏悬停/聚焦预取、`< 1s` 切换目标及 Strategy C（浏览器前进/后退 `popstate` 恢复滚动/过滤/视图状态；主动点击侧边栏重置为模块默认视图）。

---

## 3. 五大 Skill 审查、参考映射与功能保留矩阵

- 五大 Skill 实跑与 Before → After 对照：[FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md)
- 真实产品与开源项目参考映射：[REFERENCE_MAPPING.md](./REFERENCE_MAPPING.md)
- 全站 27 路由 / 104 工具 / 12 工作流能力零删除核对：[FEATURE_INVENTORY_MATRIX.md](./FEATURE_INVENTORY_MATRIX.md)

---

## 4. 前后对比视觉证据与性能实测

### 4.1 关键截图与全流程视频

- 全流程录屏（475 帧）：[`phase1-walkthrough.mp4`](./evidence/after/phase1-walkthrough.mp4)
- **Before 基线**（[`evidence/before/`](./evidence/before/)）：
  - [`before-public-home-1440.png`](./evidence/before/before-public-home-1440.png) / [`before-public-home-dark-1440.png`](./evidence/before/before-public-home-dark-1440.png)
  - [`before-auth-home-1440.png`](./evidence/before/before-auth-home-1440.png) / [`before-auth-home-dark-1440.png`](./evidence/before/before-auth-home-dark-1440.png)
  - [`before-account-menu-1440.png`](./evidence/before/before-account-menu-1440.png) / [`before-command-palette-1440.png`](./evidence/before/before-command-palette-1440.png)
  - [`before-mobile-nav-390.png`](./evidence/before/before-mobile-nav-390.png) / [`before-auth-home-390.png`](./evidence/before/before-auth-home-390.png)
- **After Phase 1**（[`evidence/after/`](./evidence/after/)）：
  - [`after-guest-home-1440.png`](./evidence/after/after-guest-home-1440.png) / [`after-guest-home-dark-1440.png`](./evidence/after/after-guest-home-dark-1440.png)
  - [`after-auth-home-1440.png`](./evidence/after/after-auth-home-1440.png) / [`after-auth-home-dark-1440.png`](./evidence/after/after-auth-home-dark-1440.png)
  - [`after-sidebar-collapsed-1440.png`](./evidence/after/after-sidebar-collapsed-1440.png) / [`after-account-menu-1440.png`](./evidence/after/after-account-menu-1440.png)
  - [`after-shortcuts-modal-1440.png`](./evidence/after/after-shortcuts-modal-1440.png) / [`after-account-modal-sync-1440.png`](./evidence/after/after-account-modal-sync-1440.png)
  - [`after-command-palette-1440.png`](./evidence/after/after-command-palette-1440.png) / [`after-ultrawide-2560.png`](./evidence/after/after-ultrawide-2560.png)
  - [`after-mobile-home-390.png`](./evidence/after/after-mobile-home-390.png) / [`after-mobile-drawer-390.png`](./evidence/after/after-mobile-drawer-390.png)

### 4.2 页面切换耗时实测（[`phase1-verification.json`](./evidence/phase1-verification.json)）

在本地隔离 Wrangler Miniflare（`127.0.0.1:8796`）+ 单实例无头 Chromium（`127.0.0.1:9231`）环境下实测：
- 冷加载 `cold_load_ms`：`2384.4 ms`
- 热切换 `hot_p50_ms`：`79.6 ms`（16 次采样）
- 热切换 `hot_p95_ms`：`138.8 ms`
- 热切换 `hot_max_ms`：`138.8 ms`
- Slow 3G 限速 `slow_3g_p95_ms`：`95.3 ms`（3 次采样，`slow_3g_max_ms: 95.3 ms`）

---

## 5. 测试与质量门禁状态分类（严格实事求是）

| 检查项 | 状态 | 说明 |
|---|---|---|
| `npm run task27:publication` | **PASS** | 构建产物清单发布清单通过（20 条目完整性校验） |
| `npm run cf:check` + `npm run pages:stage` | **PASS** | Cloudflare Workers/Pages 静态与打包输出校验通过 |
| `python scripts/repository_audit.py` | **PASS** | 仓内路径、大小写与冗余文件审计通过（2399 项文件校验） |
| `node scripts/check_js_module_graph.mjs` | **PASS** | ESM 模块依赖图校验通过（67 文件、120 条导入） |
| `node scripts/check_storage_contract.mjs` | **PASS** | 存储键契约校验通过（31 组键族，含账户隔离键） |
| `python scripts/functional_audit_gate.py` | **PASS** | 全站功能完整性门禁通过（27 路由、24 流程、104 工具、51 模式、12 工作流能力） |
| `python -m unittest local-backend.test_static` | **PASS** | 31/31 通过（已同步更新对应退役旧版首页卡片选择器的断言，安全与对比度契约未放宽） |
| `node --test` 契约与 SW 测试套件（7 个测试文件） | **PASS** | 25/25 通过，含修复原 PR #180 `qa/p07-r4c/sw-release.test.mjs` 失败 |
| `node qa/v63-phase1/verify_phase1.mjs`（隔离 E2E） | **PASS** | Guest/Normal/VIP/Admin 权限隔离、折叠持久化、浮动下拉、命令面板、Strategy C、9 档视口（375–3840）零横向溢出、`prefers-reduced-motion`（`1e-06s`）、零运行时报错 |
| 隔离 Hosted Preview 冒烟验证（HTTP + 单实例 Chrome） | **PASS** | `https://v63-phase1.thewyj-v63-preview.pages.dev` `/`、`?source=cloud`（`env: preview`）、`/api/ui/features` 均 HTTP 200；Guest 首页渲染无报错、零横向溢出 |
| Five Skills 静态核查（`copy-lint.mjs`、`sloplint.mjs`、`impeccable detect`） | **PASS** | 详见 [FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md) |
| 旧版多文件浏览器回归套件（`test_app_browser.mjs`、`test_task15_cloud_browser.mjs`、`qa/aeris/*`） | **NOT_TESTED_LOCALLY / PENDING_CI** | 已因退役旧首页选择器（如 `#workspaceBentoGrid`、`#publicBentoWall`）同步更新并通过 `node --check` 语法检查，本地未逐一全量跑旧 Python 后端浏览器套件，将在 Draft PR CI 中执行 |
| `hallmark` `sloplint.mjs --render` 交互渲染模式 | **NOT_TESTED** | 本轮实际运行静态扫描 `sloplint.mjs index.html --scope app`，未以 `--render` 参数挂载交互渲染模式 |

---

## 6. Aeris 资源守卫与进程清理记录

- **重型任务清单**：
  1. `node qa/v63-phase1/verify_phase1.mjs`（本地隔离 Miniflare `127.0.0.1:8796` + 单实例无头 Chrome `127.0.0.1:9231`）
  2. `wrangler pages deploy .wrangler/pages-output --project-name=thewyj-v63-preview --branch=v63-phase1 --commit-dirty=true`（task-767）
  3. 隔离 Hosted Preview 冒烟脚本 `preview_smoke.mjs`（单实例无头 Chrome `127.0.0.1:9232`，PID `37396`）
- **并发控制**：所有重型浏览器与 Wrangler/Miniflare 任务均严格**串行执行**，无同时并发多个 Chromium 或 Miniflare 实例。
- **进程与临时目录清理**：所有受管子进程及临时目录均在各自脚本 `finally` 中显式终止并清理；task-767 与 task-780 均已正常退出且 `manage_task list` 确认无遗留后台任务。未测量、未编造任何 CPU 或内存占用百分比数字。
