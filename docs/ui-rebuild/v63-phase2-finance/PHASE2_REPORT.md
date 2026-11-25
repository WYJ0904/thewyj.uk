# Aeris V6.3 Phase 2 财务模块重构及 Phase 1 遗留问题整改交付报告

> **授权边界**：本分支仅交付 **Phase 1 遗留问题整改（3.1 分段选择器两端溢出、3.2 侧边栏与主内容动画不同步）** 及 **Phase 2 `/finance` 财务模块 UI/UX 重构** 与 **隔离 Hosted Preview (`v63-phase2`)**。未启动 Phase 3、未新增路线图 Task 编号、未修改 Android Hotfix 工作区、未合并 `main`、未部署 Production、未发布 Android Stable。

---

## 1. Git 基线与隔离 Hosted Preview 环境

| 项目 | 值 |
|---|---|
| 仓库 | `WYJ0904/thewyj.uk` |
| 基线分支 / HEAD | `hydrogen/v63-user-approved-ui-redesign` (`a906c98f0c4d0ea9ec6acdea477d29857274dbe0`) |
| 保留未覆盖的 Phase 1 验收版本 | Draft PR #181 · `https://v63-phase1.thewyj-v63-preview.pages.dev` |
| Phase 2 开发分支 | `hydrogen/v63-phase2-finance-redesign` |
| Phase 2 Hosted Preview 别名 URL | `https://v63-phase2.thewyj-v63-preview.pages.dev` |
| 本次 Pages 部署实例 URL | `https://e466a4c0.thewyj-v63-preview.pages.dev` |
| Preview 隔离验证 | `/api/status?source=cloud` 返回 `"environment": "preview"`，`"bindings": {"d1": true, "r2": true, "workers_ai": true}`，绑定隔离库 `wyj-cloud-preview`（`a3e6253b-689f-49f3-998b-7c5828ea255a`） |

### 隔离 Preview 三角色验证账户（`wyj-cloud-preview` 合成数据）

| 角色 | 用户名 | 密码 | 实测验证表现 |
|---|---|---|---|
| **普通免费注册用户** | `v63p1_free` | `PreviewFree#2026!` | 侧栏财务/工具/工作流带锁标，`#v3SidebarAdminLink` 隐藏；进入 `/finance` 正确展示 `#financeLocked`（`8 CNY/月`）付费墙 |
| **全功能永久会员** | `v63p1_vip` | `PreviewVip#2026!` | 侧栏财务解锁，`#v3SidebarAdminLink` 隐藏；进入 `/finance` 默认打开总览（`wrapW=1089px, svgW=1063px, svgH=277px`），总览/账本/分析切换及合成数据展示正常 |
| **管理员账户** | `v63p1_admin` | `PreviewAdmin#2026!` | 侧栏显示并正常进入 `#adminPanel`，财务模块解锁 |

---

## 2. Phase 1 遗留问题根因定位与实测整改

### 2.1 问题 3.1：分段选择器两端溢出

- **Before 实测根因**（见 [evidence/before/diag-before.json](./evidence/before/diag-before.json) 及 [before-guest-tabs-first.png](./evidence/before/before-guest-tabs-first.png) / [before-guest-tabs-last.png](./evidence/before/before-guest-tabs-last.png)）：
  1. 圆角几何不协同：`.gpt-workbench-header .aeris-product-tabs` 外框圆角为 `999px`，而滑块 `.seg-indicator` 使用 `6px`（`--ds-radius-sm`），首末项直角边角刺出圆角外框。
  2. 选中样式竞争：`public-experience.css` 中 `.capability-trigger[aria-selected="true"]` 仍渲染方角高亮背景 `rgb(234, 234, 234)` 与 `border-radius: 6px 6px 0 0` + `border-bottom: 1px`，并在点击/悬停 `scale(1.01)` 下影响 `getBoundingClientRect()`。
  3. 动画与亚像素定位：`design-system.css` 的 `.seg-indicator` 缺少 `width`/`height` 过渡，`js/core/motion.js` 使用整数 `offsetWidth`/`offsetLeft` 舍入且未归一化弹窗 `scale()` 变换，导致首末项及动态切宽切换时出现跳跃或越界。
- **修复实现**（未使用 `overflow: hidden` 掩盖几何）：
  - [design-system.css](../../../design-system.css)：统一 `--ds-seg-radius` 同心圆角（胶囊容器 `999px`，圆角矩形组内圆角 `8px`），为 `.seg-indicator` 增加 `transform / width / height / border-radius` 240ms spring 同步过渡，清除 `.ds-motion-tabs [role="tab"][aria-selected="true"]` 静态重复底色。
  - [public-experience.css](../../../public-experience.css) 与 [spatial-experience.css](../../../spatial-experience.css)：修复 `.aeris-product-tabs`、`.trial-tool-tabs`、`.auth-tabs`、`#commandPaletteFilters` 的同心内间距（`padding: 4px; gap: 4px;`）、禁用选中胶囊与悬停缩放冲突，[index.html](../../../index.html) 为 `#commandPaletteFilters` 补充 `ds-segmented` + `data-indicator-style="pill"`。
  - [js/core/motion.js](../../../js/core/motion.js)：`updateIndicator` 采用 `getBoundingClientRect()` 亚像素差值并用祖先 `scale` 系数归一化；接入 `ResizeObserver` 与 `document.fonts.ready` 重算；处理隐藏容器初次显影的无跳变落位。
- **After 实测结果**（[evidence/after-phase1-fixes/phase1-fixes-report.json](./evidence/after-phase1-fixes/phase1-fixes-report.json)）：
  - 6 组场景全测通过：`guest-home-light-1440`、`guest-home-dark-1440`、`guest-home-light-390`、`trial-tool-tabs-1440`、`auth-tabs-1440`、`command-palette-filters-1440`。
  - `#publicHome .aeris-product-tabs`（浅/深色 `1440px`）首项 `alignLeftDiff=0.01px`、末项 `deltaRightFromInner=-0.47px`、快速连击切换均精准收敛在容器边界内；真实截图见 [after-guest-tabs-first.png](./evidence/after-phase1-fixes/after-guest-tabs-first.png)、[after-guest-tabs-last.png](./evidence/after-phase1-fixes/after-guest-tabs-last.png)、[after-guest-tabs-dark.png](./evidence/after-phase1-fixes/after-guest-tabs-dark.png)、[after-guest-tabs-390.png](./evidence/after-phase1-fixes/after-guest-tabs-390.png)。

### 2.2 问题 3.2：侧边栏与主内容区域动画不同步

- **Before 实测根因**（见 [evidence/before/diag-before.json](./evidence/before/diag-before.json)）：
  - `#v3AppFrame` 在 `design-system.css` 中声明的 `transition: transform ...`（ID 选择器优先级 `(1,0,0)`）覆盖了 `html[data-p07-ui="enabled"] .v3-app-frame`（`(0,2,1)`）的 `grid-template-columns` 过渡，导致点击折叠按钮第 0 帧主内容 `#v3MainCanvas` 瞬间跳变至 `left = 64px`（与 `256px` 侧边栏产生 `-192px` 重叠遮挡），而 `#v3Sidebar` 单独慢速过渡 320ms。
- **修复实现**：
  - [design-system.css](../../../design-system.css) 移除 `#v3AppFrame` 冲突的 `transition: transform` 声明。
  - [spatial-experience.css](../../../spatial-experience.css) 桌面端 `.v3-app-frame` 改为基于共享 Flex 容器的单一尺寸驱动：`#v3Sidebar` `flex: 0 0 auto` 执行唯一的 `width` `320ms var(--ds-ease-spring)` 过渡（`256px <-> 64px`），`#v3MainCanvas` `flex: 1 1 0%; min-width: 0;` 由浏览器同一布局引擎同步约束左边界、可用宽度及居中启动台坐标。
- **逐帧实测验收（3.3）**：
  - 覆盖 `/` 首页、`light`/`dark` 主题、`/finance` 财务、`/tools` 工具箱，每页均采集折叠（collapse）、展开（expand）、连续快速三连击（rapid-3click）共 12 组过程，约 108 帧 rAF/组。
  - 示例帧采样（`home-light-1440` 折叠）：`t=4.5ms (sidebarW=256, mainLeft=256, mainW=1169, contentLeft=500.5, gap=0)` → `t=10.6ms (245.58 / 245.58 / 1179.42 / 495.28 / gap=0)` → `t=44.3ms (168.41 / 168.41 / 1256.59 / 456.7 / gap=0)` → `t=94.3ms (102.78 / 102.78 / 1322.22 / 423.89 / gap=0)`。
  - 全部 12 组序列 **`maxGapPx = 0`（0px 间隙、0px 重叠、0 提前跳变）**；`prefers-reduced-motion: reduce` 实测 `sidebarDur = "1e-06s"`。
  - 1.0x 原速录屏：[phase1-fixes-sync-walkthrough.mp4](./evidence/after-phase1-fixes/phase1-fixes-sync-walkthrough.mp4)（`668` 帧，实际时长 `12.80s`）。

---

## 3. Phase 2 财务模块（`/finance`）重构交付

### 3.1 信息架构与横向二级导航

- 采用 **Cloudflare Dashboard 风格** 横向 4 标签二级导航（`总览` / `账本` / `分析` / `设置`），点击全局侧边栏「财务账本」固定进入 `总览`（Strategy C）；切换二级标签不重新初始化应用，同步更新 `history.state.aerisFinanceTab`，浏览器返回恢复离开时的子视图，支持 `ArrowLeft` / `ArrowRight` / `Home` / `End` 键盘漫游（[index.html](../../../index.html)、[js/core/design-system.js](../../../js/core/design-system.js)、[app.js](../../../app.js)）。

### 3.2 总览与收支走势图专项重构

- **总览页**：顶部轻量化操作栏保留**新增账目 / 立即同步 / 隐藏金额（隐私脱敏）/ 返回个人首页**，下方为 4 项等幅关键指标条（本月收入 / 本月支出 / 本月结余 / 退款，使用 `var(--ds-font-mono)` + `tabular-nums`）与底部分栏近期动态 + 当月预算摘要。
- **收支走势图（`renderTrendChart` in [js/finance/app.js](../../../js/finance/app.js)）**：
  - 通过 `ResizeObserver` 监听 `#financeTrendChartWrap` 容器实际宽度并重算 SVG 坐标与绘图区；在 `1440px` 视口下实测展开态 `svgW=1063px`、侧栏折叠后自动扩展至 `svgW=1255px`（占容器宽度 `>97%`），`svgH >= 200px`（桌面默认 `284px` / 窄屏 `228px`）。
  - 自适应 Y 轴刻度（`niceAxisScale`）、克制横向网格线、低饱和语义双曲线（收入绿色实线+渐变填充、支出红色虚线）、悬浮/触控/键盘交互式十字准星与单行无抖动 HUD 浮层，联动下方**精简月度收支明细表**（3 个月 / 6 个月 / 12 个月切换），以及诚实区分**同步中骨架 / 失败 `role="alert"` 提示（不伪装为零） / 无数据空态**。
  - 修复原同步完成后「正在同步，不会丢弃…」旧状态横幅长期残留的问题：`setMessage(..., { autoDismissMs: 2600 })` 在成功/完成时自动淡隐清除。

### 3.3 账本、分析、设置与 CSP 安全控制

- **账本页（`ledger`）**：引入 **Actual Budget + Linear** 4 列无边框表格行（类型徽章 + 商户备注 | 分类 | 时间 | 金额 + 编辑/删除），`#financeRecordedSection` 在专用账本页默认展开，`#financeCandidatesSection`（`Android 自动识别` / 待核对通知）在明确观测到 0 条待确认时自动折叠为紧凑标题栏、有新增待确认或恢复记录时自动展开；支持点击整行打开抽屉弹窗预览详情与删除。
- **分析与设置页**：`分析` 聚合按月分类占比条与预算进度 + 跨有效月份历史对比表；`设置` 收拢展示/账户/未标明默认币种偏好、分类与预算配置入口、`离线排队` 与 `备份/隐私中心` 入口。
- **Strict CSP 兼容**：在 `test_app_browser.mjs` 捕获并修复 `style-src 'self'` 下 HTML 内联 `style="..."` 拦截问题——分类圆点改用 `data-dot-color` 配合 CSSOM `dot.style.backgroundColor` 渲染，实现全流程 `0` 控制台 / CSP 报错。
- **视觉与录屏证据**：
  - 本地隔离 E2E 录屏：[phase2-finance-walkthrough.mp4](./evidence/after/phase2-finance-walkthrough.mp4)（`321` 帧 · `10.64s` · 1.0x 原速）
  - 重点对比截图：Before（[before-finance-1440.png](./evidence/before/before-finance-1440.png)、[before-finance-390.png](./evidence/before/before-finance-390.png)）→ After（[after-finance-overview-1440.png](./evidence/after/after-finance-overview-1440.png)、[after-finance-ledger-1440.png](./evidence/after/after-finance-ledger-1440.png)、[after-finance-analytics-1440.png](./evidence/after/after-finance-analytics-1440.png)、[after-finance-settings-1440.png](./evidence/after/after-finance-settings-1440.png)、[after-finance-drawer-1440.png](./evidence/after/after-finance-drawer-1440.png)、[after-finance-overview-dark-1440.png](./evidence/after/after-finance-overview-dark-1440.png)、[after-finance-ledger-dark-1440.png](./evidence/after/after-finance-ledger-dark-1440.png)、[after-finance-390.png](./evidence/after/after-finance-390.png)、[after-finance-2560.png](./evidence/after/after-finance-2560.png)）。

---

## 4. 配套文档与规范索引

- 真实开源/成熟产品参考映射：[REFERENCE_MAPPING.md](./REFERENCE_MAPPING.md)
- 全量财务功能清查与零删除确认：[FEATURE_INVENTORY_MATRIX.md](./FEATURE_INVENTORY_MATRIX.md)
- 五大 Skill 实跑执行与整改明细：[FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md)

---

## 5. 全量验证与测试结果清单（全部在最终代码改动后实跑通过）

| 检查项 | 状态 | 实测输出摘要 |
|---|---|---|
| `npm run task27:publication` + `npm run cf:check` + `npm run pages:stage` | **PASS** | `publication_hash: a7db15...`（20 条目），Worker 编译与白名单 `.wrangler/pages-output` 成功 |
| `node --test local-backend/test_i05_workspace_shell.mjs local-backend/test_i06_module_experience.mjs` | **PASS** | 5/5 通过（`0 !important` 在 I05/I06 层、PWA 与 HTML 标记完整） |
| `node --test local-backend/test_aeris_state_consistency.mjs` + 模型/历史/折叠/候选/核心单元测试 + `audit_async_interactions.mjs` | **PASS** | 13/13 状态一致性通过 + 全部财务与核心单元脚本通过 |
| `python -m unittest discover` (`local-backend/test_*.py`) + `python scripts/functional_audit_gate.py` + `python scripts/repository_audit.py` | **PASS** | Python 单元测试全通过；`functional_audit_gate` 27 路由 / 24 流程 / 104 工具 / 12 工作流全通过；`repository_audit` 2455 文件通过 |
| `node qa/v63-phase2/verify_phase1_fixes.mjs` | **PASS** | `segmented_count: 6`, `sidebar_sync_count: 12`, `max_gap_px: 0`, `screencast_frames: 668`, `runtime_errors: 0` |
| `node qa/v63-phase2/verify_phase2_finance.mjs` | **PASS** | `checks: 4`, `viewports: 7` (`375..3440`, 0 溢出), `perf_ms: 72.8`, `screencast_frames: 321`, `runtime_errors: 0` |
| `local-backend/test_app_browser.mjs` | **PASS** | 24/24 应用矩阵全通过，`0` 运行时与 CSP 报错（已适配 Phase 2 财务子标签切换） |
| Aeris Core CI 浏览器契约套（`p1`, `p2`, `p3`, `p31`, `p32`, `p33`, `p4-behavior`, `p4-finance-cursor`, `p4-pending-recovery`, `p5-contract`, `p5-loading`, `p5-hash`, `p5-pwa`, `p6-experience`, `p6-parked-rows`, `home-widgets-browser`, `mobile-widgets-browser`） | **PASS** | 以上 17 项全部通过（注：基准脚本 `qa/aeris/p4-workspace-browser.mjs` 因内置 2026-10 硬编码日期在 2026-11 月份触发当前月筛选计数 `0!==1500` 超时，该脚本不在 CI `.github/workflows/ci.yml` 阻断列表内） |
| Five Skills 审查（Taste / Hallmark 静态 & `--render` / Impeccable / Frontend Design / UI UX Pro Max） | **PASS** | 见 [FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md)；`copy-lint`: 0 FAIL / 0 WARN；Hallmark 财务新 CSS 0 FAIL / 0 WARN；Hallmark `--render` 财务页 0 FAIL / 0 WARN |
| 隔离 Hosted Preview (`https://v63-phase2.thewyj-v63-preview.pages.dev`) | **PASS** | `HOSTED_PREVIEW_PASS` · 游客 / `v63p1_free` / `v63p1_vip` / `v63p1_admin` + `v63-phase1` 留存验证全通过，0 运行时报错 |

---

## 6. Aeris 资源守卫与进程清理说明

- **执行的大负荷任务**：
  1. `verify_phase1_fixes.mjs`（单实例 Wrangler Miniflare `127.0.0.1:8798` + 单实例无头 Chrome `127.0.0.1:9233` + ffmpeg MP4 合成）。
  2. `verify_phase2_finance.mjs`（单实例 Wrangler Miniflare `127.0.0.1:8799` + 单实例无头 Chrome `127.0.0.1:9234` + ffmpeg MP4 合成）。
  3. Core CI 本地隔离测试 Group A（`local-backend/server.py` `8892` + `ci_ollama_stub.py` `11435` + Chrome `9223` 运行 `test_app_browser.mjs`）。
  4. Core CI Aeris 回归 Group B（Wrangler Miniflare `8894` + Chrome `9225` 依次运行 17 个 `qa/aeris/*.mjs` 套件；关闭 Chrome 后单独运行 Hallmark `--render`）。
  5. Hosted Preview 在线验收 Group C（单实例 Chrome `9236` 访问 `https://v63-phase2.thewyj-v63-preview.pages.dev`）。
- **并发形态**：**严格全串行（100% Serial）**。以上 5 组任务均等前一组完全终止且 `finally` 完成 PID 树与临时目录清理后再启动下一组；运行 Hallmark `--render` 前亦显式终止了同一组的 Chrome CDP 进程，避免任何多浏览器或双 Miniflare 并发。
- **进程与临时目录清理结果**：每个任务均通过 `taskkill /PID <pid> /T /F` 精确回收自身启动的子进程 PID（未按 broad name 强杀其他进程），并清理 `.tool-e2e/`、`.hallmark/`、临时 `artifacts/` 及 `%TEMP%` 下的独立 `d1-state`/`chrome-profile` 目录。**未编造任何未实测的 CPU 或内存占用数字**。
