# Aeris V6.3 Phase 5 — 工作流模块 UI/UX 重构交付报告（PHASE5_REPORT）

## 一、交付概览与分支状态

- **阶段目标**：完成 `/tools/workflows` 模块的独立工作流列表与可视化节点画布编辑器重构，在不改动后端 Schema v1、不改变顺序执行语义、不回退 P1–P4 既有成果的前提下，全面升级信息架构、节点编排交互、参数配置体验、执行状态反馈与多端适配。
- **基线来源**：Phase 4 (`hydrogen/v63-phase4-language-redesign`, `d777a4ca715f8aad795480db40e0f730ac1561f0`, Draft PR #185)
- **当前分支**：`hydrogen/v63-phase5-workflow-redesign`
- **范围严守**：仅交付 Phase 5 工作流重构；未启动 Phase 6、未合并 `main`、未部署 Production、未修改 Android Stable 指针、未恢复 Android Hotfix 或财务 AI 开发。

---

## 二、核心重构与架构亮点

1. **双视图解耦 (`#workflowWorkspace[data-wf-view="list" | "editor"]`)**
   - **默认进入独立工作流列表页** (`#workflowListView`)：展示头部操作栏（返回工具箱、权属胶囊、导入 JSON、新建工作流）、我的工作流紧凑行列表（名称、实时步骤数、`输入 → 输出` 契约、最后修改时间、云同步/本地草稿标识、编辑/运行、`···` 浮动菜单、按名称或步骤关键词实时过滤、简洁空状态），以及对称 `2×2` **内置模板**区（含用途描述、类型标记与细线 SVG 节点流缩略图）。不虚构运行次数、成功率或历史自动化统计。
   - **点击工作流或模板进入全幅独立画布编辑器** (`#workflowEditor`)：顶部工具栏（返回工作流列表、可编辑工作流名称、本地/云端保存状态、保存、输入与运行开关、运行、取消、`···` 管理菜单）+ 中央交互节点画布 + 右侧参数配置面板 + 底部按需展开的运行输入与类型化输出抽屉。

2. **真实交互式顺序节点画布 (`workflows.js` + `spatial-experience.css`)**
   - **画布导航**：点阵网格背景、桌面拖拽平移、滚轮缩放、HUD 控制栏（添加节点、`-`/`100%`/`+`/`适应画布`），按账户和工作流 ID 隔离记忆纯 UI 视口位置 (`wyjWorkflowCanvasUi:v1:<accountId>`)，未修改工作流 JSON Schema v1。
   - **实时 SVG 三次贝塞尔连线**：参照 XYFlow 水平控制点公式在 `requestAnimationFrame` 下与节点卡片同步绘制，包含流动箭头、连线状态着色（运行中流动虚线 / 成功 / 失败 / 不兼容）以及连线中点 `+` 插入节点按钮与末尾 `+ 添加下一步` 虚线卡片。
   - **多模态顺位重组与安全拦截**：同时支持指针手柄拖动重排、HTML5 Drag/Drop（兼顾现有自动化合同）、节点页脚与右侧参数面板按钮前移/后移以及键盘方向键调整。任何重排或插入均实时经过 `validateStepSequence()` 校验，不兼容时通过横幅解释原因并保持原有效序列，严禁自由创建 DAG 分支或循环。
   - **移动端响应**：`<= 768px` 自动切换为 1:1 比例纵向管线流、顶部与底部节点端口对齐、避免桌面与移动端缩放相互干扰，并在 `<= 480px` 呈现 4 列等宽节点操作条。

3. **Raycast / n8n 风格节点选择器与右侧参数配置面板**
   - **节点选择器 (`#workflowNodePicker`)**：支持即时搜索与 5 类标签切换（全部 / 文本处理 / 数据转换 / 图片处理 / 文件打包），完整展示全部 12 项真实能力、描述、`输入 → 输出` 契约与当前插入位置的实时兼容性标记（不兼容能力显式禁用并写明原因）。
   - **右侧参数配置面板 (`#workflowInspectorPanel`)**：桌面自然展开（移动端为带 `safe-area` 的底部抽屉），依据 `CONFIG_SCHEMAS` 动态渲染 `<select>` 分段单选组（保留同步原生 `<select>` 兼容性合同）、数字滑杆配对框、颜色选择器与预设色板，以及节点管理操作。后台云端同步完成时保护激活的焦点与编辑中面板不被强制关闭。

4. **按需展开运行区与类型化输出 (`#workflowRunnerPanel`)**
   - 依据首步输入类型动态切换文本输入、文件/图片拖放区（`.aeris-file-drop`）与文件清单摘要；执行过程实时将 `waiting / running / success / skipped / failed / cancelled` 反馈同步至画布节点、连线与步骤列表；支持文本预览/复制、格式化 JSON、图片即时预览、ZIP 压缩包详情卡片及失败节点一触定位（点击「定位到失败节点」自动在画布和参数面板聚焦报错步骤）。

5. **已修复的既有缺陷与 CSP / PWA 契约保护**
   - 彻底解决因旧样式将 `.ds-select-native` 隐藏门槛绑定在 `html[data-p07-ui="enabled"]` 而引起的双重下拉框问题，Phase 5 所有枚举控件与隐藏兼容 `<select>` 均带有 `data-ds-select="native"` 且完全兼容 `p07_accessibility` disabled/error 降级策略。
   - 严格零内联 `style="..."` HTML 属性、零新增 `!important`（`Phase5_CSS_important_count=0`）、保留 `CORE_SHELL = 81` / `REQUIRED_SHELL = 89` 与全部 `wyjToolWorkflows:v1` / `wyjWorkflowAccess:v1` 存储契约。

---

## 三、能力、模板与业务边界核查结果

- **12 项注册能力实测 12/12 全部真实跑通**：`text-encoding`、`remove-empty-lines`、`dedupe-lines`、`sort-lines`、`csv-json`、`json-csv`、`text-split`、`image-resize`、`image-format`、`text-watermark`、`exif-remove`、`files-zip`。
- **4 个内置模板实测 4/4 全部端到端跑通**：`text-clean`、`csv-roundtrip`、`image-publish`、`image-batch`（含批量隔离容错）。
- **多账户与权限隔离**：实测验证了无权/免费用户守卫、永久全功能会员完整编排与云同步、以及超级管理员账号独立本地存储键与 0 跨账号草稿泄漏。

---

## 四、改前 vs 改后（Before / After）核心对比与实测指标

| 评估维度 | 改前（Phase 4 基线） | 改后（Phase 5 重构） | 实测数据 / 证据 |
|---|---|---|---|
| 页面信息架构 | 列表、模板、步骤、输入、运行输出堆叠单页 | 独立列表页 (`list`) + 独立画布编辑器 (`editor`) | `before/*` vs `after/after-list-workflows-1440.png`, `after-editor-canvas-1440.png` |
| 节点拓扑可视化 | 纵向列表卡片堆叠，无流向与端口表达 | 桌面横向流式画布 + GPU 平移缩放 + SVG 贝塞尔连线与 `+` 中点插入 | `after-editor-canvas-1440.png`, `workflow-phase5-desktop-1x.mp4` |
| 节点添加与兼容性 | 单一 `<select>` 筛选，无用途描述与分类 | Raycast 搜索 + 5 类分组 + 输入输出与不兼容原因预览 | `after-editor-picker-1440.png` (`nodePickerOpen: 35ms`) |
| 参数配置连续性 | 嵌入每个步骤卡内占满高度 | 桌面右侧面板 / 移动底部抽屉，编辑态无刷新丢失 | `after-editor-inspector-1440.png`, `after-inspector-mobile-390.png` (`inspectorOpen: 22ms`) |
| 执行反馈与定位 | 仅尾部列表文本状态 | 画布节点 + 流动连线 + 运行轨迹卡片 + 失败节点一键聚焦 | `after-editor-running-1440.png`, `after-editor-completed-1440.png`, `after-editor-dark-1440.png` (`runFeedbackClick: 17ms`) |
| 多视口零溢出 | 390px 局部堆叠与双下拉风险 | `320/375/390/768/1440/1920/2560` 全视口 `overflowPx = 0`，移动按钮 `minHeight = 44px` | `evidence/phase5-verification-report.json` |

### 量化交互响应实测（本地 Wrangler Pages Dev + Headless Chrome `1440×900`）
- 首次打开列表页含鉴权与引导：`6337 ms`
- 新建/进入独立编辑器：`35 ms`
- 打开节点选择器面板：`35 ms`
- 点击节点展开右侧参数面板：`22 ms`
- 画布适应视图重算：`12 ms`
- 点击“运行”至界面呈现“运行中”首帧反馈：`17 ms`
- 四步文本清理工作流真实执行耗时：`117 ms`

---

## 五、测试、门禁与本地资源调度报告

### 1. 已全部通过的本地门禁与浏览器验证
- `npm run task27:publication` -> PASS (`integrity_entries: 80`, `install_shell_total: 89`, `prior_core_shell_preserved: true`)
- `python local-backend/test_static.py` -> PASS (`31 tests OK`)
- `node local-backend/test_workflows_js.mjs` -> PASS (`11 groups passed`)
- `node --test local-backend/test_i05_workspace_shell.mjs local-backend/test_i06_module_experience.mjs` -> PASS (`5/5 passed`)
- `python scripts/functional_audit_gate.py` -> PASS (`27 routes, 24 app flows, 104 tools, 51 tool modes, 7 checkbox controls, 12 workflow capabilities and 27 workflow flows`)
- `node scripts/check_storage_contract.mjs` -> PASS (`31 stable key families`)
- `node scripts/check_js_module_graph.mjs` -> PASS (`67 files, 120 imports`)
- `npm run cf:check` -> PASS (`Compiled Worker successfully`)
- `python scripts/repository_audit.py` -> PASS (`2554 files checked`)
- Phase 5 专项浏览器端到端实测 (`verify_phase5_after.mjs`) -> **全部通过**：覆盖 12 项能力、4 个内置模板、3 种账户权限与隔离、7 档视口、9 个真实登录态 DOM 遮挡/可见/无孤儿行审计、暗色模式、减弱动效与 `p07_accessibility` 关闭降级。
- `qa/aeris/p5-contract-browser.mjs` -> PASS
- `qa/aeris/p5-loading-browser.mjs` -> PASS
- `qa/aeris/p5-pwa-browser.mjs` -> PASS
- `qa/aeris/p2-interaction-browser.mjs` -> PASS
- `qa/p07-release/sw-install-browser.mjs --source WORKTREE --label p5`（CI 默认升级基线）-> **7/7 全部 PASS**（`normal`, `slow`, `failure-retry`, `body-timeout`, `warm`, `task26-failure`, `stale-task26`）。

### 2. 本地 Windows 环境下观测到的 Wrangler 兼容限制（交由远端 Linux Core CI 复核）
- 在本机 Windows + Node `v24.18.1` + `wrangler 4.118.0` 运行长耗时跨路由浏览器回归（`p4-behavior-browser.mjs` 与 `local-backend/test_tools_browser.mjs` 中的非工作流重度上传阶段）时，Miniflare 本地代理在高频 Chrome 导航下触发过 `ProxyController: Error inside ProxyWorker -> Network connection lost`（`.github/workflows/ci.yml` 指定环境为 Ubuntu Linux + Node 22）。未作任何测试跳项、未放宽断言；上述全量矩阵将在推入 Stacked Draft PR 后由 GitHub Actions Core CI 在 Linux + Node 22 完整执行验证。
- 实机手机（Android WebView / 物理触屏）仍属独立实机验证范畴，本次移动端验证范围为 Headless Chrome 设备与触控模拟 (`320–768px`)。

### 3. 重型任务调度与进程清理汇报（`aeris-resource-guard` 合规记录）
- **执行的重型任务**：`capture_before.mjs`（基线截图）、`verify_phase5_after.mjs`（多轮 Phase 5 功能/基准/录屏/DOM 审计）、`run_serial_suites.mjs`（`p5-*`、`p2-*`、`p4-*`、`test_tools_browser.mjs`）、`sw-install-browser.mjs`（7 用例隔离 Chrome + HTTP 服务器）。
- **并发配置**：**严格 100% 串行**；每次仅运行单个 Wrangler Pages Dev + 单个 Headless Chrome（或单个 SW 测试实例），上一组完全退出并清理临时目录后才启动下一组。
- **进程与临时文件清理**：每次测试 `finally` 块均按显式记录的子进程 PID 使用 `taskkill /PID <pid> /T /F` 精准终止所属 `wrangler`/`chrome` 进程，未按进程名误杀任何无关进程，所有 `.wrangler/p5-*` 临时持久化目录已清理完毕。

---

## 六、后续可选演进建议（本次未实施）
- 未来若在引擎层扩展分支/并发执行语义，可引入条件判断 (`branch`) 与并行节点，并在 Schema v2 迁移时兼容当前顺序 `steps[]` 结构。
- 未来可考虑基于现有节点工具栏扩展画布小地图（Minimap）及按步骤历史执行快照回看，前提是不伪造虚假运行数据。


---

## 最终整改交付补充：自由节点编排与方案 A 光流执行动画（2026-11-26）

### 1. 根因修复与 CSS 层叠净化

- 彻底清理 `spatial-experience.css` 中遗留的 `E-02` 与 `P0-E` 旧版规则（原高优先级选择器 `html[data-p07-ui="enabled"] #workflowWorkspace #workflowStepList { display: grid }` 与 `::before`/`::after` 导致桌面端强行竖排且出现双重连线）。
- 在 Phase 5 独立样式层以零 `!important` 实现：
  - `#workflowWorkspace #workflowStepList.wf-node-layer` 桌面端强制水平 `flex-direction: row; flex-wrap: nowrap; gap: 56px`，并显式隐藏任何遗留 `::before` / `::after`。
  - `#toolsPanel:has(#workflowWorkspace:not(.hidden)) > .tools-header { display: none; }` 覆盖 `p07_accessibility` 的 `enabled` / `disabled` / `error` 全三态，不泄漏工具箱头部。
  - 修复节点内“启用”复选框文字竖排折行问题（`white-space: nowrap`），提升卡片标题/IO/2行参数可读性与默认适应画布缩放比，移除打开 Inspector 时的画布跳变。

### 2. 区域内 2D 自由拖拽 + 跨区滞回重排 + 位置持久化

- 通过 CSS `translate: var(--wf-off-x) var(--wf-off-y)` 与 WAAPI `transform` 分离架构实现：
  - 区域内任意 2D 拖动松手后安全钳制并保留偏移量于 `wyjWorkflowCanvasUi:v1:<accountId>`，刷新与重载后自动恢复且与 Schema v1 数据完全隔离。
  - 跨越邻居区域中点 `±22px` 滞回死区时基于未偏移 `slots` 基线触发可中断 WAAPI 兄弟节点让位与 SVG 贝塞尔连线实时同步。
  - 兼容松手即提交新顺序、非兼容换位（经 `validateStepSequence` 校验）精确报错并同步滑回节点与连线、支持 `Escape`/`pointercancel` 撤销及运行中结构锁定。

### 3. 方案 A：光流接力 + 圆角边框环绕动画

- 在 `design-system.css` `:root` 及暗黑主题中新增 `--ds-wf-flow` (`#779bc5` / `#8ab0db`)、`--ds-wf-flow-head`、`--ds-wf-success` 语义令牌。
- 重构 `syncCanvasEdges()` 键控复用 SVG `<g data-edge-id>` 与 `gradientUnits="userSpaceOnUse"` 方向渐变，新增视觉首尾引入/输出虚线提示（不写入 `steps[]`）。
- 基于单调 `runEpoch` 与真实 `executeWorkflow` 状态流同步：`running` 节点触发 `1450ms` `<rect rx="13" ry="13" pathLength="100">` 圆角边描边环绕与浅蓝呼吸底色，节点完成后触发单次边光流脉冲接力；失败或取消立即中止后续全部动画；支持 `visibilitychange` 后台暂停及减弱动态无障碍模式。

### 4. 本轮复核实测指标与交付证据

- **静态与构建全门禁**：`test_static.py` 31/31 通过、`test_workflows_js.mjs` 11 组通过、`test_i05_workspace_shell.mjs` 3/3 通过、`test_i06_module_experience.mjs` 2/2 通过、`functional_audit_gate.py` 通过、`check_storage_contract.mjs` 通过、`check_js_module_graph.mjs` 通过、`cf:check` 编译通过、`sw-install-browser.mjs` 7/7 通过。
- **真实浏览器耗时对比（Chrome CDP 本地 `.wrangler/pages-output`）**：
  - 冷启动直达 `/tools/workflows`：`626 ms`
  - 已打开工具箱后热切换至 `/tools/workflows`：`121 ms`
- **桌面/移动截图与实时 1.0x MP4 证据**（见 `docs/ui-rebuild/v63-phase5-workflow/evidence/final-remediation/`）：
  - `p5-desktop-horizontal.png` / `p5-desktop-inspector.png` / `p5-exec-running.png` / `p5-desktop-dark.png` / `p5-mobile-390.png` / `p5-mobile-320.png`
  - `p5-drag-reorder.mp4` (`8.24s`, 1.0x) / `p5-exec-animation.mp4` (`5.64s`, 1.0x)


## P5 Cache-Skew Remediation & Local Verification (`20261127-aeris-p5-cache-fix`)

### Root Cause Confirmed & Reproduced
Reproduced in persistent Chromium profile upgrading from old P5 (`84ca5209`) to `365a7a5d`:
1. Both releases shared `ASSET_RELEASE = "20261121-aeris-i05-preview"`, causing `app.js` `isTargetWorker()` and `sw.js` `matchingAsset()` to reuse old cached `spatial-experience.css` from old `PUBLICATION_CACHE` while lazily importing new `workflows.js`.
2. `_headers` lacked a `/` root rule, serving `/` with `public, max-age=0, must-revalidate, no-transform` instead of `no-cache, no-store, must-revalidate, no-transform`.
3. Under old CSS mixed with new `workflows.js`, `.wf-node-trace-svg` / `.wf-node-trace-rect` lacked SVG presentation fallback attributes, rendering a static `168.9 x 121.8` solid black (`rgb(0, 0, 0)`) `<rect>` above the node header (`repro_skew.png`) alongside stacked layout rules from older CSS.

### Fixes Implemented
- `_headers`: Added `/` and updated `/index.html` to `Cache-Control: no-cache, no-store, must-revalidate, no-transform`.
- `index.html` & `workflows.js`: Added `width="0" height="0" fill="none"` on `#workflowCanvasEdges` and `.wf-node-trace-svg`, `fill="none" stroke="none" opacity="0"` on `.wf-node-trace-rect`, `stroke="currentColor" stroke-width="2"` on `.wf-edge-base` / `opacity="0"` on `.wf-edge-pulse`, plus runtime `syncNodeTraceGeometry()` `getComputedStyle(svg).position === "absolute"` check.
- `app.js`: Added same-release `controllerchange` skew reload guard with 15s `sessionStorage` loop guard (`wyjSwSkewReload:${ASSET_RELEASE}`).
- Release bump & manifest: Updated `ASSET_RELEASE` to `20261127-aeris-p5-cache-fix` (33 files) and regenerated `sw.js` manifest via `npm run task27:publication` (`PUBLICATION_HASH = 712df0eb0e4a92f1536dcc783216649b1dcd947fbafa5235a730f24e2a5e369f`).

### Local Verification After Code Edits
- `python local-backend/test_static.py`: 31 tests OK
- `node local-backend/test_workflows_js.mjs`: 12 groups passed (including SVG fallback attribute checks)
- `node --test qa/p07-release/sw-install.test.mjs qa/p07-r4c/sw-release.test.mjs`: 24/24 passed
- `node scripts/check_storage_contract.mjs`: PASS (31 families)
- `node scripts/check_js_module_graph.mjs`: PASS (67 files, 120 imports)
- `python scripts/functional_audit_gate.py`: PASS (27 routes, 24 app flows, 104 tools, 51 tool modes, 7 checkbox controls, 12 workflow capabilities, 27 workflow flows)
- `npm run cf:check`: PASS (`Compiled Worker successfully`)
- `python scripts/repository_audit.py`: PASS (2565 files checked)
- `node qa/aeris/p5-cache-upgrade-browser.mjs`: PASS (`20261127-aeris-p5-cache-fix`, `listDisplay: "flex"`, `listFlexDir: "row"`, `svgPos: "absolute"`, `rectFill: "none"`, `persistedOffsets: 1`, `wyjUserRetainedMarker` retained across upgrade, and synthetic stale CSS fallback `svgWidth: 0, svgHeight: 0, rectFill: "none", rectOpacity: "0"`)
- `node qa/p07-release/sw-install-browser.mjs --source WORKTREE --label p5-cache-fix`: PASS (all 7 cases: `normal`, `slow`, `failure-retry`, `body-timeout`, `warm`, `task26-failure`, `stale-task26`)
- Serial Miniflare (`workerd` + D1/R2) + headless Chrome P5 suites: `p5-loading-browser.mjs` PASS, `p5-hash-browser.mjs` PASS, `p5-pwa-browser.mjs` PASS, `p5-contract-browser.mjs` PASS.
