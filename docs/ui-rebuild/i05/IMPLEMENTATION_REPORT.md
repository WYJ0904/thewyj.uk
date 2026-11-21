# Aeris V6.3 — I05 Workspace & Admin High-Density Unification: Implementation Report

## 规范核对后的修复与复验

本节对应 2026-11-21 差距核对，保留原轮验收记录供追溯。原远端头为 [`c579b222`](https://github.com/WYJ0904/thewyj.uk/commit/c579b222ff9d72814afb996951b37f7e4fb455dd)，续接现有 `workspace_admin_density` 工作树中的先行修复。产品输入冻结在 [`f85438a876f3c209d96c1a257420417b16df3cb0`](https://github.com/WYJ0904/thewyj.uk/commit/f85438a876f3c209d96c1a257420417b16df3cb0)。保留 [Draft #172](https://github.com/WYJ0904/thewyj.uk/pull/172) 到 I04 的叠加关系。

| 核对项 | 修复位置与前后变化 |
| --- | --- |
| A01 充值 | 页面采用统一内容边界。1440px 左侧起点从 208px 到 232px，与面包屑对齐，375/390px 从贴边到 14px。手机功能选择缩成双列，保留每项用途说明。套餐、支付方式、金额摘要及创建订单顺序明确。付款确认和更换放在实际订单详情与二维码之后。审核和权益说明单独成组。 [页面结构](../../../index.html) · [I05 密度层](../../../spatial-experience.css) |
| A02 工作流 | [隐藏控件](../../../design-system.css)、[表单默认样式](../../../product-ui.css)与 [工作流布局](../../../spatial-experience.css)分别约束输入和内容。1440px 侧栏由 `clientWidth/scrollWidth = 318/619` 收敛到 `318/318`。375/390px 的根元素横向溢出归零，文件输入为 1×1px，保留有名称的导入交互。 |
| A03 后台动作 | [后台布局](../../../spatial-experience.css)让窄屏选择器单占一行，主次动作双列。375px 和 390px 的浅、深主题下两个按钮均为单行并达到 44px 触控高度。 |
| A04 面包屑 | [壳层密度样式](../../../spatial-experience.css)将面包屑放在实际顶栏和 Preview 标识下方。滚动 420px 后的本地实测，1440px 位于 61px、375/390px 位于 108px，均与顶栏底边一致。后台折行时只保留选中按钮标记，左右键继续同步焦点、选中态和内容面板。 |
| A05 后台字段 | [页面列标题](../../../index.html)和 [列表渲染](../../../app.js)按用户、充值、审计、登录、工具统计定义各自字段。窄屏保留组内语义与动作。使用合成记录实查五类列表，含长字段及动作数量不同的订单。 |
| A06 用户列对齐 | [共享列宽与间距](../../../spatial-experience.css)用于表头和正文。981、1024、1440、1707px 的数据列起点无偏差，动作容器继续对齐右侧。安全列的最后登录时间使用完整列宽。 |
| A07 KPI | 报告修正为实际的真实 API 数字、占位和错误状态、既有节点的原位更新。 |

### B01–B04 与受影响回归

| 核对项 | 实际结果 |
| --- | --- |
| B01 失败恢复 | 在隔离 D1 的合成开关上完成实际 Task 27 重新验证。只拦截目标保存的一次 POST 并返回 503。等到失败末态，按钮恢复，草稿仍在，D1 修订仍为 1。解除拦截后重试写入修订 2，刷新读回。 |
| B02 通道持久化 | 隔离 Hosted 普通测试用户的 Stable 修订 0 保存为 Beta 修订 1，重新加载读回 Beta，再恢复 Stable 修订 2 并重新加载确认。实际保存和 GET 均为 200，普通用户访问后台用户接口为 403，测试会话已退出。 [读回记录](evidence/followup/hosted/b02-channel-readback.json) · [恢复后的画面](evidence/followup/hosted/hosted-1440-account-channel-restored.png) |
| B03 布局与主题 | 本地 Chrome 13/13 场景、9 路由 × 5 个实测视口 × 2 个主题共 90/90。涵盖充值及工作流、内部侧栏和导入控件、后台动作命中、Reduced Motion 和 P07 OFF。21 张截图记录实际尺寸与哈希。9 次 axe 扫描严重或关键问题为 0，运行时错误和意外 API 5xx 为 0。 [本地结果](evidence/followup/local-i05-acceptance.json) |
| B04 来源 | 本地以冻结产品 `f85438a` 执行，报告记录了当时 QA 工作树和 251 个源输入的 SHA-256，结束时复核相同。首次记录的 I04 基线原样保留。Hosted 二次独立校验部署、测试库、产物清单以及站点实际返回的四个脚本和样式的 Git 字节。 [最终来源校验](evidence/followup/hosted/independent-final-source.json) |

早期诊断保留了操作列本身的 26px 差异、Task 27 弹窗、未选择新合成开关和刷新仍在恢复态导致的用例中止。复测校验真实数据列和操作列右边界，选中准确的测试键，等待页面已渲染的控件再提交。I05 本地复验另外覆盖有效 375px 导入按钮打开原生选择器。 [前后测量](evidence/followup/layout-before.json) · [候选测量](evidence/followup/layout-candidate.json) · [后台局部测量](evidence/followup/i05-admin-focused.json)

I03 公共页 4/4，I04 工作区 11/11，Task 27–30 隔离回归分别为 33、31、7、10 项通过。最终代码的 45 项静态测试、Pages 允许列表构建和 Functions 编译通过。标准产物的本地 Chrome PWA 验证包含 89 项完整缓存、离线访客壳和联网恢复，保留旧客户端及用户缓存，API 响应未进入壳缓存。SW 安装护栏 20/20。 [I03](evidence/followup/i03-regression.json) · [I04](evidence/followup/i04-regression.json) · [标准 PWA](evidence/followup/pwa-standard-shell.json)

### Hosted Preview

当前隔离部署为 `ae3e538d-8bbc-4fe1-9a30-ff6cc336045e`，对应 `f85438a`，保留既有独立 D1 `9e76a190-42db-4ff1-b0b7-476e4b312792`，外键异常 0。 [现有 Preview 入口](https://i05-workspace-density.thewyj-i05-preview.pages.dev) · [固定部署](https://ae3e538d.thewyj-i05-preview.pages.dev) · [产物与部署证明](evidence/followup/hosted/final-hosted-deployment.json)

上一冻结部署 `cdee886e` 完成 30 项实际视口/路由及后台动作检查。Hosted 用户与登录的实列对齐通过。充值申请、审计的 Hosted 夹具为空，核对了表头和空态。含数据的五类后台列表另已在本地隔离库测量。前一部署在充值说明中发现重复辅助地标，最终将说明改为命名组，刷新 Worker 完整性。最终部署在 1440、375、390px 的充值布局和 scoped axe 均重新通过，三个视口 axe 各 0 项违规。其余产品脚本和样式与前一冻结部署对照一致。 [初次观察](evidence/followup/hosted/initial-layout-and-column-observation.json) · [后台对齐](evidence/followup/hosted/targeted-admin-column-recheck.json) · [最终充值复测](evidence/followup/hosted/final-hosted-recharge-recheck.json) · [辅助地标规则](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/complementary.html)

| 视口 | 可审阅截图 |
| --- | --- |
| 1440px | [充值](evidence/followup/hosted/hosted-final-1440-recharge.png) · [工作流](evidence/followup/hosted/hosted-1440-workflows.png) · [后台吸顶](evidence/followup/hosted/hosted-final-1440-admin-sticky.png) · [用户列表](evidence/followup/hosted/hosted-final-1440-admin-users.png) |
| 375px | [充值](evidence/followup/hosted/hosted-final-375-recharge.png) · [工作流](evidence/followup/hosted/hosted-375-workflows.png) · [后台动作](evidence/followup/hosted/hosted-375-admin-toolbar-focus.png) |
| 390px | [充值](evidence/followup/hosted/hosted-final-390-recharge.png) · [工作流](evidence/followup/hosted/hosted-390-workflows.png) · [后台动作](evidence/followup/hosted/hosted-390-admin-toolbar-focus.png) |

Hosted 使用新鲜网络页面。隔离包装保留原 Preview 标识，Hosted 离线安装单列未测，标准产物的本地 PWA 测试见上。实体手机、手工读屏、真实付款与 Production 未验收。I02 触控目标与 I07 夹具的历史失败保留在 [回归记录](REGRESSION.md)。远端检查以 [Draft #172 当前头](https://github.com/WYJ0904/thewyj.uk/pull/172/checks) 为准。

账户、权限、订单及安全 API 合同保持独立。后补微交互方案中的逐控件状态台账、迟到响应、复制失败及跨模块动效验证沿 [I06 交接](I06_HANDOFF.md) 和原 I08–I10 边界跟进。本轮 Owner 视觉状态为 `PENDING_REVIEW`。

## 原 I05 交付记录

## 1. Executive Summary
- **Stage**: `I05` — Authenticated Workspace & Admin High-Density Unification (`Cloudflare Dashboard` information density + `Samsung One UI` grouped list logic + Aeris brand identity).
- **Branch & Worktree**: `hydrogen/i05-workspace-admin-density` in `workspace_admin_density` (derived cleanly from verified I04 baseline `origin/hydrogen/i04-authenticated-workspace-redesign` at `b5ebd1dadb523e442166be6dde7518f19ef9e5ef`).
- **Stacked Draft PR Base**: `hydrogen/i04-authenticated-workspace-redesign`.
- **Commits**:
  - `b8c2731c19fcbbf26d19c7d8e4898a03267dc200` — `feat(ui-i05): unify workspace shell HTML, breadcrumb sync, and admin KPIs`
  - `d95c938038f33b3ec70c7488b3f3209dc4a704ea` — `style(ui-i05): apply Cloudflare-dense console and One UI account grouping`
  - `e4e781f2ad5e4cc791f70a2880952d683c041368` — `chore(ui-i05): update asset release manifest, CI, tests, and browser evidence`
  - Docs & live preview verification follow-up commit adding `qa/i05/verify-preview.mjs` race fix and `docs/ui-rebuild/i05/` reports.
- **Boundary Compliance**:
  - Strictly excluded I06 module reworks (FSRS study UI, borderless finance ledger/drawer edit, two-pane instant tool search, transfer drag-progress rewrite, Flagsmith pills/audit timeline), I08 icon replacement / global checkbox/toast/scroll fixes, I09 `#versionNotice` & toast stacking, and Task 53–61 new backend features.
  - Preserved PWA shell counts (`CORE_SHELL = 81`, `REQUIRED_SHELL = 89`, `INSTALL_SHELL = 89`), `aerisHomeWidgets:v2:<owner>` storage contract, and `P07 OFF` graceful degradation.
  - Added zero third-party npm packages, zero React/framework bundles, and zero `!important` declarations in the I05 stylesheet layer.

## 2. Code & Asset Changes
- **`index.html`**:
  - Added `#v3Sidebar` grouped labels, sticky `#workspaceBreadcrumb` navigation, `#adminRoleContext`, and the four-cell `#adminKpiStrip`. The Users, Recharge, Audit, Login, and Tool Statistics tabs have desktop `.admin-list-head` visual column labels aligned with the corresponding record fields. At narrower widths, records use a stacked layout with their field text in the row. The account page groups its summary and settings with `.account-settings-list`.
- **`js/core/design-system.js`**:
  - Implemented `workspaceRouteMeta(pathname, options)` mapping `/`, `/select`, `/language`, `/language/english`, `/language/japanese`, `/tools`, `/tools/workflows`, `/tools/:tool_id`, `/finance`, `/transfer`, `/account`, `/recharge`, and `/admin` (+ section trail).
  - Implemented `syncWorkspaceShell(doc, meta)` setting `document.body.dataset.workspaceRoute` and updating `#workspaceBreadcrumb` with `<li>` node reuse (no full DOM destruction) and `aria-current="page"`.
- **`app.js`**:
  - Added `refreshWorkspaceShell()` hooked into route/view transitions (`showModulePicker`, `showDashboard`, `showLanguageWorkspace`, `showToolsPanel`, `showToolsRoute`, `showWorkflowsRoute`, `showFinancePage`, `showTransferPage`, `openAccountModal`, `openRechargePage`, `showAdminPanel`, `selectAdminTab`, `openPublicTool`, and `hidePrimaryScreens`).
  - `setAdminKpi(id, value, status)` updates the existing value node and its state when the corresponding admin API loads or fails. `resetAdminKpis()` restores the pending placeholder when the session is cleared.
- **`design-system.css`, `styles.css`, `workspace-experience.css`, `spatial-experience.css`**:
  - Added `--ds-container-console: 1320px` and expanded `tabular-nums` coverage (`account-detail-grid`, admin KPI values, audit/log rows, quotas, SHA-256).
  - Replaced 25 literal `border-radius` values on existing workspace/card selectors with `--ds-radius-lg` / `--ds-radius-md` / `--ds-radius-sm` (4–8px scale).
  - Appended the `I05 Workspace Console Layer` in `spatial-experience.css` (0 `!important` declarations), unifying authenticated module density, page header/filter/action bar rhythm, One UI grouped `/account` settings rows, `/admin` Cloudflare-dense KPI strip + `.admin-list-head` table rhythm, dark mode token contrast, and P07 OFF hiding rules (`html:not([data-p07-ui="enabled"]) :is(.workspace-breadcrumb, .admin-kpi-strip, .admin-list-head) { display: none; }`).
  - Preserved native `20×20` sizing for `#featureFlagEnabled` and `#featureFlagKillSwitch` (`<= 24px`).
- **Release Manifest & QA/CI**:
  - Updated `?release=20261121-aeris-i05-preview` across `index.html`, `sw.js`, `app.js`, `tools.js`, `js/**/*.js`, and regenerated `task27:publication` integrity manifest (`publication_hash: 3b1eca2919cb12d31cb53d60326dbb68b830d010064e72882e870659289aa353`, `integrity_entries: 20`).
  - Added `local-backend/test_i05_workspace_shell.mjs`, `qa/i05/browser-acceptance.mjs`, `qa/i05/provision-preview.mjs`, `qa/i05/stage-preview.mjs`, and `qa/i05/verify-preview.mjs`; integrated `test_i05_workspace_shell.mjs` into `.github/workflows/ci.yml`.

## 3. Verification Summary
- **Unit / Static / Build**: All static & unit suites PASS (`test_i02_css_contracts.mjs` 6/6, `test_i03_public_pages.mjs`, `test_i04_workspace.mjs`, `test_i05_workspace_shell.mjs`, `test_motion_js.mjs`, `test_core_js.mjs`, `test_home_widgets_js.mjs`, `test_stage_pages_deploy.mjs` 28/28, `check_js_module_graph.mjs`, `check_storage_contract.mjs`, `test:task27` 33/33, `test:task28` 31/31, `test:task29` 7/7, `test:task30` 10/10, `npm run cf:check`, `npm run build`).
- **Local Browser Acceptance (`qa/i05/browser-acceptance.mjs`)**: **PASS** (`13/13` scenarios, `70` viewport×theme×route cells `overflow <= 1`, `0` axe-core violations across all 7 routes, `0` runtime errors, `0` 5xx API errors, `16` PNG screenshots).
- **Regression Browsers**: `qa/i03/browser-acceptance.mjs` **PASS**, `qa/i04/browser-acceptance.mjs` **PASS**; `qa/i02` observed pre-existing `/` homepage `#publicLearningReset` `43.32px` scaled rect (`exit 1`); `qa/i07` observed known scenario-11 SW fixture navigation timeout (`exit 1`). See [`REGRESSION.md`](./REGRESSION.md).
- **Isolated Hosted Preview (`thewyj-i05-preview`)**: Provisioned (`aeris-i05-preview`), deployed (`deploymentId: f3304762-c50d-4ead-a52b-fa079838e0ee`, `https://i05-workspace-density.thewyj-i05-preview.pages.dev`), and verified via `node qa/i05/verify-preview.mjs` (**PASS**, `6` axeScans with `0` violations, `5` clean screenshots, `nonAdminApiStatus === 403`, `p07ToggleChecks.restoredOn === true`).

## 4. Gate Status Overview
- `OWNER_VISUAL_ACCEPTANCE`: `PENDING`
- `ANDROID_PHYSICAL_DEVICE`: `NOT_TESTED`
- `PRODUCTION_RELEASE`: `NOT_TOUCHED`
- `PR_MERGE`: `NOT_MERGED` (Stacked Draft PR against `hydrogen/i04-authenticated-workspace-redesign`)
