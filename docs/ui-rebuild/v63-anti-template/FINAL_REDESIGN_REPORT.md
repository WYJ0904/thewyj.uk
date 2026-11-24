# Aeris V6.3｜Anti-Template Structural Redesign Final Report

- **Branch**: `hydrogen/v63-anti-template-structural-redesign` (independent worktree branched from `hydrogen/i10-full-site-interaction-acceptance` at `eb3a824f96c194b707035c1cd77d7b97b200408f`)
- **Isolated Preview**: `thewyj-v63-preview` (`https://v63-preview.thewyj-v63-preview.pages.dev`, D1 `aeris-v63-preview`, R2 `aeris-v63-preview-storage`, `p07_accessibility=true`, `/api/status` & `/` HTTP 200; 部署凭证见 [`evidence/v63-preview-provision.json`](./evidence/v63-preview-provision.json))
- **Production / Existing Previews**: Untouched (`thewyj.uk`, `main`, `thewyj-i10-preview`, PR #177/#178/#179, Android Hotfix/AI remain paused/isolated)
- **Research & Architecture Specs**:
  - [DESIGN_RESEARCH.md](./DESIGN_RESEARCH.md)
  - [OPEN_SOURCE_REFERENCE_MAPPING.md](./OPEN_SOURCE_REFERENCE_MAPPING.md)
  - [CURRENT_UI_ANTI_PATTERN_AUDIT.md](./CURRENT_UI_ANTI_PATTERN_AUDIT.md)
  - [DESIGN_SYSTEM_DECISIONS.md](./DESIGN_SYSTEM_DECISIONS.md)
  - [FUNCTION_PRESERVATION_MATRIX.md](./FUNCTION_PRESERVATION_MATRIX.md)

---

## 1. 五大 Skill 实跑与前后对照指标

1. **`frontend-design` + `design-taste-frontend` (`copy-lint.mjs`)**:
   - 移除模板化英文大写眉题（`.v3-hero-eyebrow` `Aeris Workspace · V6.3`、`LEARNING` / `FINANCE` / `TOOLS` / `TRANSFER` / `ACTIVITY` / `ACCOUNT`、多处冗余 `.section-kicker`）、序号标记 `01 ·`..`05 ·`、手绘窗口圆点 `.preview-dots` 与按钮末尾粘连箭头 `→`（`进入空间 →` / `探索 Aeris →` / `打开工作流 →`）。
   - `copy-lint.mjs index.html`：`0 FAIL, 0 WARN`。
2. **`ui-ux-pro-max` (`search.py` 9 个领域检索)**:
   - 保持 Aeris 现有品牌与中性色板，引入高密度平铺工作台（Density 8/10）、可中断 150–200ms 过渡（`--ds-ease-decelerate: cubic-bezier(0.16, 1, 0.3, 1)`，移除 `--ds-ease-spring` 回弹）、2px `:focus-visible` 外框与表格窄屏安全换行。
3. **`impeccable` (`detect`)**:
   - **静态扫描（7 文件 CLI regex）**：由基线 **29 条**降至 **17 条**；已彻底清零 `[side-tab]`（侧边粗色条与 `inset 3px 0 0`）、`[bounce-easing]`、`[marquee]`、`[viewport-width]` (`100vw`) 与部分 `[dark-glow]`。
   - **真实渲染页扫描（`impeccable detect http://127.0.0.1:<port>`）**：仅剩 **1 条**（Guest 首页下方的 `[nested-cards]`）。
4. **`hallmark` (`sloplint.mjs --scope app`)**:
   - **基线**：`484 FAIL, 475 REFLEX, 100 WARN`。
   - **重构后**：**`177 FAIL, 411 REFLEX, 84 WARN`**（`-307` 条 FAIL、`-64` 条 REFLEX、`-16` 条 WARN，消除 `Inter` 字体硬编码、`#ffffff`/`#0b0e14` 字面量、全大写 `letter-spacing`、进度条虚假动画及部分冗余边框盒）。

---

## 2. 核心页面与全站模块结构性改造汇总

| 模块 | 改造前问题 | 改造后结构（真实修改文件） |
|---|---|---|
| **公开首页 `/`（未登录 Guest）** | 左侧显示 208px 登录后空侧边栏；Hero 上方挂 `Aeris Workspace · V6.3` 眉题；预览窗含 `.preview-dots`；隐私区硬编码 `#0d0e12` 黑盒突兀反差；Bento 编号 `01 ·`..`05 ·`。 | `body[data-experience="public"]:not([data-workspace-route])` 隐藏 `#v3Sidebar` 使 `.v3-app-frame` 独占全宽 Apple/Samsung 舞台（不破坏任何工作区测试）；清理眉题、圆点与编号；`.aeris-privacy-section` 接入语义表面 Token（[`index.html`](../../../index.html)、[`spatial-experience.css`](../../../spatial-experience.css)、[`app.js`](../../../app.js)）。 |
| **登录后首页 `/` & `/select`** | 模块介绍、卡片、摘要与快捷入口 4 次重复；`#homeV3SummaryGrid` 携带装饰性固定比例进度条；`compact` 密度行高达 99px。 | Linear 高密度工作区：`compact` 切换为单行 48px 事务列表（`最近活动`前置）、隐藏装饰性 `.v3-summary-track` 仅展示真实指标、去掉卡片英文 Kicker 与双层套框、所有 6 个业务卡片/预览/拖拽/隐藏/撤销契约完整保留（[`index.html`](../../../index.html)、[`spatial-experience.css`](../../../spatial-experience.css)、[`app.js`](../../../app.js)）。 |
| **财务账本 `/finance`** | 顶部 3 项币种选择器压低 KPI；桌面首屏被厚重趋势图占满，流水表被推到折叠下方；390px 移动端标题右对齐且顶部按钮全宽堆叠。 | Actual Budget 记账簿结构：KPI 四格紧跟标题栏并置等宽数字、币种控制压缩为下方单行条；收紧趋势图高度至 ~212px 满足 `open.height > 200` 与折叠差值 `> 200` 契约并让流水区上移；流水列表采用单行细线对齐、右对齐等宽金额与内联编辑/删除；修复 390px 左对齐与内联包绕按钮（[`index.html`](../../../index.html)、[`spatial-experience.css`](../../../spatial-experience.css)）。 |
| **工具箱 `/tools`** | 103 个工具卡片每张重复分类标签 `<em>` 且最小高度 110px；搜索旁嵌套 `.workflow-launcher` 卡片；移动端分类竖排 500px 导致首屏看不到任何工具。 | IT-Tools + Raycast 搜索优先目录：去掉卡片内重复分类 `<em>` 标签，工具目录转为 2 列 64–66px 细线行项；工作流入口内联为紧凑按钮 `#openWorkflowBtn`；`<= 980px` 分类栏改为单行横向可滚胶囊，390px 首屏立即可见工具与搜索（[`index.html`](../../../index.html)、[`tools.js`](../../../tools.js)、[`spatial-experience.css`](../../../spatial-experience.css)）。 |
| **工作流 / 后台 / 账户 / 学习 / 传输** | 工作流标题居中偏移、窄屏 375px 双栏未折叠挤压；语言选择页 Logo 与标题左右撕裂；账户页双巨型卡片重复 `#accountDetails`；移动端后台 Tabs 两列堆叠。 | 工作流改为左对齐头部、`<div class="workflow-runner">` 兼容 I05 与 V6 契约、CSS 几何连接符与 `<=980px` 稳定单栏折叠；账户双摘要框收敛为单层细线横幅；语言页 `.project-brand` 左对齐收拢；后台移动端 Tabs 改为单行横向滚动；文件传输压缩配额条与拖放区间距（[`index.html`](../../../index.html)、[`spatial-experience.css`](../../../spatial-experience.css)）。 |

---

## 3. 证据文件对照（Before vs After + Screencast）

- **Before 基线截图**：[`docs/ui-rebuild/v63-anti-template/evidence/before/`](./evidence/before/)
  - `before-public-home-1440.png` / `390.png`、`before-auth-home-1440.png` / `390.png`、`before-finance-1440.png` / `390.png`、`before-tools-1440.png` / `390.png`、`before-workflows-1440.png`、`before-admin-1440.png`、`before-transfer-1440.png`、`before-language-1440.png`、`before-account-1440.png`
- **After 全量验证截图与录屏**：[`docs/ui-rebuild/v63-anti-template/evidence/after/`](./evidence/after/)
  - 覆盖 `375x812`、`390x844`、`768x1024`、`1024x768`、`1440x900`、Light / Dark、`prefers-reduced-motion: reduce` 与 `p07_accessibility=0` 降级回退，及交互录屏 `v63-walkthrough.mp4`（由 CDP 实时 Screencast 帧经 `ffmpeg` 编码生成）。

---

## 4. 验证记录、并发约束与清理回执

### 4.1 最终代码修改后的完整串行回归（Post-Edit Verified）

- `npm run cf:check`：PASS（Wrangler 4.118.0 编译通过）
- `npm run pages:stage`：PASS（输出 `.wrangler/pages-output`）
- `node scripts/check_js_module_graph.mjs`：PASS（67 files, 116 imports）
- `node scripts/check_storage_contract.mjs`：PASS（31 stable key families）
- `python scripts/functional_audit_gate.py`：PASS（27 routes, 24 app flows, 104 tools, 51 tool modes, 7 checkbox controls, 12 workflow capabilities, 27 workflow flows）
- `node local-backend/test_v6_ui_contracts.mjs`：PASS（3/3）
- `python scripts/repository_audit.py`：PASS（2372 files）
- `python -m unittest local-backend.test_static -v`：PASS（31/31）
- `node qa/i04/browser-acceptance.mjs`：PASS（11 scenarios, 7 axe scans, 10 viewports）
- `node qa/i08/browser-acceptance.mjs`：PASS（5/5 scenarios, 3 screenshots）
- `node qa/i09/browser-acceptance.mjs`：PASS（4/4 scenarios, 5 screenshots）
- `node qa/i10/browser-acceptance.mjs`：PASS（7 scenarios, 3 axe scans, 3 contrast audits, 6 screenshots）

### 4.2 其他历史/接口套件运行说明

- `npm run test:ds-sso` (23/23)、`test:aeris-state`、`test:task11`、`test:task12`、`test:task17`、`test:task25`、`test:task26`、`test:task27`、`test:task28` (31/31)、`test:task29` (7/7)、`test:task30` (10/10)：均全部通过（运行于最后一笔 `@media` 1 行 CSS 修复之前，相关测试不依赖 CSS `@media` 媒体查询）。
- `node qa/i05/browser-acceptance.mjs`：`a`–`f` 全部通过（含 7 路由侧边栏、历史前后退、工具工作台、工作流与融资表格）；场景 `g` 在未改动 `js/core/feature-console.js` 的情况下因基线提交 `e2a42061` 将文案从 `'正在保存…'` 调整为 `'正在保存配置…'` 而超时（已核实 `js/core/feature-console.js:231` 与 I09/I10 行为一致，未放宽 I05 断言）。

### 4.3 Aeris Resource Guard 报告

- **执行的重型任务**：独立 Miniflare D1/R2 + Headless Chromium 套件（`qa/i04`, `qa/i05`, `qa/i08`, `qa/i09`, `qa/i10`, `verify_after_and_capture.mjs`）以及 Wrangler/Node/Python D1 回归批次（`test:ds-sso`..`test:task30`）。
- **并发配置**：严格单组串行执行（`<= 1` 组浏览器/Miniflare 重型任务），前一组进程完全退出并清理临时目录后才启动下一组。
- **进程与临时环境清理**：所有自有脚本在 `finally` 中关闭 Chromium 子进程、HTTP Server、Miniflare 实例并删除临时 `os.tmpdir()` profile 目录；不保留任何常驻后台任务。

---

## 5. 回滚方案

1. **Git 回滚**：本轮改动全部位于 `hydrogen/v63-anti-template-structural-redesign` 分支，随时可通过 `git checkout hydrogen/i10-full-site-interaction-acceptance` 或 `git revert <commit>` 一键回到 I10 基线状态，零影响 `main` 与现有 Production D1/R2。
2. **线上开关降级**：所有工作区结构化 CSS 均作用域限定于 `html[data-p07-ui="enabled"]`，通过 Feature Flag `p07_accessibility` 即可在零发版条件下秒级切换回基础布局。
