# Aeris V6.3 UI/UX Refactor｜Phase 1 Delivery Report（含 V2 专项整改）

> **阶段边界声明**：本报告仅覆盖 **Phase 1（全局框架、导航、全站动效基础设施及首页）**。依据用户指令，交付 **隔离 Hosted Preview + Draft PR #181（base: `hydrogen/v63-anti-template-structural-redesign`）** 后即暂停等待验收，**未提前开展 Phase 2–9**，未合并 `main`，未触及真实生产 `thewyj.uk` 或 Android Stable。

---

## 1. Git 与隔离 Hosted Preview 环境

| 项目 | 值 |
|---|---|
| 仓库 | `WYJ0904/thewyj.uk` |
| 基线提交 | `820a14b09154a3517c46355766cd83c6f3b9ec83`（PR #180 `hydrogen/v63-anti-template-structural-redesign`） |
| 开发分支 & Draft PR | `hydrogen/v63-user-approved-ui-redesign` · Draft PR #181 |
| 隔离 Hosted Preview Alias | https://v63-phase1.thewyj-v63-preview.pages.dev |
| 最新 V2 Cloudflare Pages 部署 URL | https://0fd87c47.thewyj-v63-preview.pages.dev |
| 预览环境隔离确认 | Pages 项目 `thewyj-v63-preview` 分支 `v63-phase1`，绑定独立预览库 `wyj-cloud-preview`（`a3e6253b-689f-49f3-998b-7c5828ea255a`）；`/api/status?source=cloud` 返回 `"status_env": "preview"`，与生产 `wyj-cloud-production` 完全隔离 |

---

## 2. Hosted Preview 隔离测试账户（已通过真实浏览器在线验证）

> 全部三个账户均建立在隔离预览数据库 `wyj-cloud-preview` 上，使用明确合成标识与独立数据，严禁也不含任何生产账户或生产数据。

| 角色类型 | 用户名 | 登录密码 | 侧边栏身份 / 会员文案 | 权限与隔离验证表现（真实浏览器已测） |
|---|---|---|---|---|
| **隔离管理员账户** | `v63p1_admin` | `PreviewAdmin#2026!` | `管理员 · 全功能永久会员` | `task18_admin_roles` 管理员授权 + `all_access_lifetime` 永久会员；侧栏可见 `/admin` 管理后台入口并正常打开 `#adminPanel`，可使用全功能模块 |
| **普通免费注册用户** | `v63p1_free` | `PreviewFree#2026!` | `普通注册用户` | 财务、工具箱、工作流侧栏显示会员锁图标 `#sidebarFinanceLock` / `#sidebarToolsLock` / `#sidebarWorkflowsLock`；隐藏管理后台入口；直接访问 `/admin` 无法进入 `#adminPanel` |
| **全功能永久会员用户** | `v63p1_vip` | `PreviewVip#2026!` | `全功能永久会员` | 已开通 `all_access_lifetime` 全部 10 项权益；无会员锁图标，可完整打开工具箱、财务账本与语言学习工作区；无管理后台入口 |

---

## 3. V2 专项整改核心实施内容

1. **桌面侧边栏 `256px ↔ 64px` 连续流畅折叠动效与“零溢出”修复**
   - **根因排查**：旧版对文字标签/身份区使用 `display: none` 导致第 0 帧瞬间消失；高特异性规则（`spatial-experience.css:8780`）保留了 `.account-menu-identity { display: flex }` 且 `#v3Sidebar` 为 `overflow: visible`，导致折叠至 `64px` 时“普通注册用户”溢出右侧画布；图标区切换居中引起横向跳变。
   - **修复实现**：[design-system.css](../../../design-system.css) 定义 `--ds-duration-sidebar: 320ms`、`--ds-ease-spring`、`--ds-ease-elastic`；[spatial-experience.css](../../../spatial-experience.css) 令 `.v3-app-frame` `grid-template-columns` 与 `#v3Sidebar` `width` 同步 `320ms` 过渡，`overflow-x: hidden; overflow-y: hidden` 彻底杜绝横向文本溢出，`.v3-nav-icon` 锁定 `32px` 固定槽位（展开/折叠 X 偏移误差 `0px`），标签与分组标题柔和淡隐并保留分组间距，折叠按钮 SVG 随状态旋转 `180deg`，[js/core/design-system.js](../../../js/core/design-system.js) 监听 `transitionend` 重算激活指示条；原生 CSS transition 支持高速连击无缝中断与反向恢复。
2. **全站动效升级（Motion Inventory）**
   - 建立 [MOTION_INVENTORY.md](./MOTION_INVENTORY.md)，覆盖侧边栏折叠、路由入场（[js/core/motion.js](../../../js/core/motion.js) `animateRouteViewEntrance`：纯 `opacity + translate3d(0, 14px, 0)`，`240ms` spring，不缩容器以保护 `>=44px` 触控目标）、`.auth-tabs .ds-tab-indicator.seg-indicator` 分段胶囊滑动、全局模态框（含 `membershipModal` / `accountModal`）`.is-closing` 渐隐退出、`#accountMenuPopover` 固定方向弹出、`.ds-select-popover` 方向自适应退出、顶部 `#versionNotice` 横幅滑入及移动端连续手势拖曳抽屉。
   - 修复 `#v3SidebarBackdrop` 在初始桌面关闭状态下误移除 `hidden` 270ms 导致桌面首屏 CLS=0.53 的真实问题（现 `p3-brand-public-browser.mjs` 实测 `CLS = 0`），以及桌面端 `button[role="tab"]` `:hover scale(1.01)` 导致的胶囊指示器对齐超差问题。
3. **全部 7 项视觉细节问题整改**
   - (7.1) 折叠侧边栏底部身份区 `opacity + max-width` 收敛 + `#v3Sidebar` `overflow-x: hidden`，消除“普通注册用户”溢出。
   - (7.2) `@media (max-width: 980px), (pointer: coarse)` 隐藏所有 `.v3-kbd`（`Ctrl K` / `Esc` 键帽），移动端可访问性文本不拼快捷键。
   - (7.3) `#versionNotice` 改为顶部可关闭公告条，并通过 `#appShell { padding-top: var(--ds-hud-version-offset, 0px) }`（`versionOffset = h` 无多余间隙）保证不遮挡访客页 `<h1>Aeris</h1>` 或登录页顶栏。
   - (7.4) 移除 `#guestHomeLauncher` 中重复 `.gpt-guest-logo` 及 `#sidebarGuestFooter` 中重复 `#sidebarGuestLoginBtn`；`#publicCapabilityGallery` 采用无边框轻量呈现。
   - (7.5) `#commandPaletteModal` 关闭按钮由 `25px` 大字号“关闭”文本重构为紧凑 `.v3-cmd-close-btn` SVG 图标按钮（`29x29px`）。
   - (7.6) 严格拆分身份角色与会员方案显示：`站点所有者` / `管理员 · 全功能永久会员` / `管理员` / `全功能永久会员` / `普通注册用户`（同步更新 `#sidebarAccountPlan` 与 `#accountModal`）。
   - (7.7) 登录态桌面 `/` 改为基于 `body` Flex 弹性铺满 `100dvh` 并令 `#v3Sidebar` `min-height: 0; max-height: 100%`、精简 `.site-help-footer` 内边距，确保在 `1440x900` 视口下即使顶部公告条展示时仍保持 `scrollHeight === 900 === innerHeight`（零无意义纵向滚动）。

---

## 4. 文档、Skill 与参考映射索引

- 全站动效清单：[MOTION_INVENTORY.md](./MOTION_INVENTORY.md)
- 五大 Skill 实跑审查（含 V2 动态渲染与 Doctor 复查）：[FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md)
- 真实产品与开源项目参考映射：[REFERENCE_MAPPING.md](./REFERENCE_MAPPING.md)
- 全站 27 路由 / 104 工具 / 12 工作流能力零删除核对：[FEATURE_INVENTORY_MATRIX.md](./FEATURE_INVENTORY_MATRIX.md)

---

## 5. V2 视觉证据、1.0x 正常倍速录屏与多阶段耗时实测

### 5.1 证据目录（保留 `before/` 与初版 `after/`，新增 `after-v2/` 与 `preview/`）
- **1.0x 正常倍速全流程录屏**：[`phase1-v2-walkthrough.mp4`](./evidence/after-v2/phase1-v2-walkthrough.mp4)（`992` 帧 · 真实时长 `28.31s` · `1.0x` 原速 `ffconcat` 合成，完整覆盖顶部通知条展示与关闭、普通用户与永久会员与管理员三账户切换及退出、侧边栏 `256↔64px` 连续动画与快速连击打断、底部上弹菜单、Command Palette、下拉选择器、工具/语言/财务/传输模块切换、Strategy C 返回恢复与移动端 `390x844` 抽屉交互）
- **V2 本地隔离验收截图（[`evidence/after-v2/`](./evidence/after-v2/)）**：
  - [`after-guest-home-1440.png`](./evidence/after-v2/after-guest-home-1440.png) / [`after-top-version-banner-1440.png`](./evidence/after-v2/after-top-version-banner-1440.png) / [`after-guest-home-dark-1440.png`](./evidence/after-v2/after-guest-home-dark-1440.png)
  - [`after-auth-home-1440.png`](./evidence/after-v2/after-auth-home-1440.png) / [`after-auth-home-dark-1440.png`](./evidence/after-v2/after-auth-home-dark-1440.png) / [`after-sidebar-collapsed-1440.png`](./evidence/after-v2/after-sidebar-collapsed-1440.png)
  - [`after-account-menu-1440.png`](./evidence/after-v2/after-account-menu-1440.png) / [`after-command-palette-1440.png`](./evidence/after-v2/after-command-palette-1440.png) / [`after-mobile-drawer-390.png`](./evidence/after-v2/after-mobile-drawer-390.png)
- **Hosted Preview 在线实测截图（[`evidence/preview/`](./evidence/preview/)）**：
  - [`preview-free-collapsed-1440.png`](./evidence/preview/preview-free-collapsed-1440.png)（`v63p1_free` 折叠 64px 零溢出 + 锁标）
  - [`preview-vip-home-1440.png`](./evidence/preview/preview-vip-home-1440.png)（`v63p1_vip` 900x900 零滚动）
  - [`preview-admin-panel-1440.png`](./evidence/preview/preview-admin-panel-1440.png)（`v63p1_admin` 管理后台）

### 5.2 模块切换全链路多阶段耗时实测（[`phase1-verification.json`](./evidence/phase1-verification.json)）

在本地隔离 Wrangler Miniflare（`127.0.0.1:8796`）+ 单实例无头 Chromium（`127.0.0.1:9231`）实测：
- 冷加载 `cold_load_ms`：`2291.2 ms`
- 热切换关键控件可交互汇总：`hot_p50_ms: 31.8 ms` · `hot_p95_ms: 94.2 ms` · `hot_max_ms: 94.2 ms`（11 次采样全部 `< 1000 ms`）
- Slow 3G 限速切换：`slow_3g_p95_ms: 59.6 ms` · `slow_3g_max_ms: 59.6 ms`

| 模块路由 | 点击至首帧反馈 | 页面容器切换完成 | 关键控件可交互（目标 `<1000ms`） | 真实用户操作响应完成 | 动画收敛稳定 |
|---|---|---|---|---|---|
| `tools`（输入搜索 `json`） | `85.2 ms` | `91.3 ms` | **`94.2 ms`** | `109.6 ms` | `356.2 ms` |
| `language`（进入英语工作区） | `23.8 ms` | `26.3 ms` | **`30.4 ms`** | `88.0 ms` | `338.4 ms` |
| `finance`（打开并关闭新增账目弹窗） | `55.8 ms` | `71.9 ms` | **`77.0 ms`** | `114.2 ms` | `366.9 ms` |
| `transfer`（配额与选文件就绪） | `38.6 ms` | `41.4 ms` | **`42.5 ms`** | `44.2 ms` | `289.0 ms` |
| `home`（返回个人启动台） | `37.1 ms` | `40.0 ms` | **`41.1 ms`** | `41.1 ms` | `284.2 ms` |

---

## 6. 门禁与 CI 状态清单（实事求是）

| 检查项 | 状态 | 实测结果与范围 |
|---|---|---|
| `npm run cf:check` + `npm run pages:stage` + `npm run task27:publication` | **PASS** | Functions 编译、20 条目发布清单及 `.wrangler/pages-output` 通过 |
| 静态安全与仓内审计（`repository_audit.py` / `check_js_module_graph.mjs` / `check_storage_contract.mjs` / `functional_audit_gate.py`） | **PASS** | 2419 文件、67 ESM 模块 / 120 导入、31 存储键族、27 路由 / 104 工具 / 12 工作流能力全通过 |
| `python -m unittest local-backend.test_static` | **PASS** | 31/31 通过 |
| `node --test` 契约与 SW 套件（9 个测试文件） | **PASS** | 31/31 通过，0 failed / 0 skipped |
| `node qa/v63-phase1/verify_phase1.mjs`（本地隔离 E2E） | **PASS** | 全部 V2 视觉/动效/三角色/9 档视口/`prefers-reduced-motion`（`1e-06s`）/Strategy C/0 报错通过 |
| Hallmark `sloplint.mjs --render --url http://127.0.0.1:8796 --scope app` | **PASS** | `0 FAIL, 0 REFLEX, 1 WARN`（`F19` 字体字重提醒），覆盖 1280/1440/1920 折叠与 1440/375 整页渲染 |
| Impeccable `doctor` & `detect` | **PASS（带提示）** | `detect` 无新增 Phase 1 对比度/内边距/发光错误；`doctor` 提示未安装 `.agents/hooks.json`（按规则未安装未授权 hooks） |
| Taste Skill `copy-lint.mjs index.html --kind software` | **PASS** | `0 FAIL, 0 WARN` |
| Core CI Job 复现：`local-backend/test_app_browser.mjs` | **PASS** | 本轮修改测试选择器适配 `#v3Sidebar` 后本地隔离跑通 24/24 |
| Core CI Job 复现：`qa/aeris/*.mjs`（17 套）+ `test_interaction_feedback` + `transfer-clipboard` + `test_task15_cloud` + `test_task18` + `qa/task25` | **PASS** | 22 套浏览器套件本地隔离全通过（`p3` 首屏 CLS=0）；注：末次仅针对登录态桌面 `/` 的 footer/sidebar 高度 CSS 微调未更改公开页/模块页交互逻辑，最终远程 CI 结果以 PR #181 推送触发为准 |
| 隔离 Hosted Preview 在线三账户实测（[`hosted-preview-verification.json`](./evidence/preview/hosted-preview-verification.json)） | **PASS** | `https://v63-phase1.thewyj-v63-preview.pages.dev` 游客/`v63p1_free`/`v63p1_vip`/`v63p1_admin` 全通过，0 运行时错误 |

---

## 7. Aeris 资源守卫与清理说明

- **串行调度**：所有本地 Miniflare / Wrangler / 无头 Chrome / Hallmark `--render` 任务均严格串行执行，每次在同一端口仅启动单个 Chromium 与单个后台服务进程（`verify_phase1.mjs` 在调用 `sloplint.mjs --render` 前显式关闭验证用 Chrome 并清理 PID 树），无并发资源竞争。
- **进程与临时文件清理**：已删除 `sloplint.mjs --render` 产生的临时目录 `.hallmark/`；所有受控临时目录与后台进程均已终止清理，`manage_task list` 无残留任务。未编造或估算未测量的 CPU/内存数值。
