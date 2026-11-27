# Aeris V6.3 Phase 5 — 网络研究、开源参考与设计映射（REFERENCE_MAPPING）

> 本文件记录 Phase 5 工作流 UI/UX 重构的真实互联网搜索、公开官方文档与开源项目源码研读、许可证合规核查、设计模式提取以及在 Aeris 中的独立落地实现。所有设计均基于 Aeris 原生技术栈（HTML/CSS/ES6+ JS、`js/core/motion.js`、`design-system.css`、`spatial-experience.css`）自主实现，**未复制任何第三方代码或品牌资产**。

---

## 一、实际搜索与源码研读记录

### 1. n8n (`n8n-io/n8n`, `docs.n8n.io`)
- **查询来源**：
  - 搜索：`n8n workflow editor canvas add node parameters panel execution status` (`docs.n8n.io`)
  - 源码仓库：`https://github.com/n8n-io/n8n`
  - 实读目录与文件：
    - `packages/frontend/editor-ui/src/features/workflows/canvas/components/Canvas.vue`
    - `packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/nodes/CanvasNode.vue`
    - `packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/edges/CanvasEdge.vue`
    - `packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/buttons/`、`handles/`
- **许可证核查**：`LICENSE.md` 为 **Sustainable Use License 1.0**（含部分 `.ee.` 企业文件限制）。**严格列为纯概念与交互模式参考，零源码复制**。
- **提取的设计模式**：
  1. **列表与编辑器分离**：工作流列表页专注于「工作流条目、步骤概览、新建/导入/模板入口」，点击后进入独立的专业画布编辑器，不再在主界面同时堆砌列表侧栏、参数表单与结果区。
  2. **水平流式画布 + 右侧参数面板 (Focus/NDV)**：画布作为核心工作区占据中央视野；节点带输入/输出端口（Handle）、状态徽章（等待/运行中/完成/错误）与参数摘要；点击节点后在右侧展开参数配置面板，无需离开或遮挡画布全局结构。
  3. **连线中点与末尾「+」添加入口 (`CanvasEdgeToolbar`)**：在节点间连线中点及末尾直接提供 `+` 插入节点动作，触发 `NodeCreator` 检索弹窗。
- **Aeris 对应实现**：
  - `#workflowWorkspace` 拆分为 `data-wf-view="list"`（独立工作流列表 + 模板）与 `data-wf-view="editor"`（顶部工具栏 + 中央交互画布 + 右侧节点参数面板 + 按需展开输入/执行/结果抽屉）。
  - 保持 Aeris 顺序执行语义：禁止自由分叉/循环连线，保留并增强节点间 `+` 插入与 `validateStepSequence()` 实时类型兼容检查。

### 2. Node-RED (`node-red/node-red`, `nodered.org/docs/`)
- **查询来源**：
  - 搜索：`Node-RED workspace flow editor palette nodes wires sidebar config debug` (`nodered.org/docs/`)
  - 源码文件：
    - `packages/node_modules/@node-red/editor-client/src/js/ui/view.js`
    - `packages/node_modules/@node-red/editor-client/src/js/ui/palette.js`
    - `packages/node_modules/@node-red/editor-client/src/js/ui/tray.js`
- **许可证核查**：**Apache License 2.0**（本次仅参考其架构层级与交互逻辑，未复用源码）。
- **提取的设计模式**：
  1. **分层画布 SVG/DOM 结构**（`view.js`）：由底至顶分为背景/网格层（`gridSize = 20`）、连线层（`linkLayer`，`lineCurveScale = 0.75`）与节点层（`nodeLayer`），保证缩放平移时连线与节点坐标严格锁定、不脱节。
  2. **平移与缩放控制**：支持背景拖拽平移、滚轮/按钮缩放、Space 键抓手平移、以及触控手势与键盘快捷键。
  3. **右侧参数抽屉 (`tray.js`) 与调试输出区**：参数编辑在右侧滑出面板完成，运行输出与错误追踪独立在调试/输出面板按步骤查看。
- **Aeris 对应实现**：
  - 画布视口 (`#workflowCanvasViewport`) 内构建统一变换舞台 (`#workflowCanvasStage`)：底层点阵网格随视口平移缩放、SVG 连线层 (`#workflowCanvasEdges`) 与节点层 (`#workflowStepList`) 共用同一舞台坐标系，确保拖拽、缩放、平移时连线零错位。

### 3. React Flow / XYFlow (`xyflow/xyflow`, `reactflow.dev`)
- **查询来源**：
  - 搜索：`React Flow node canvas viewport zoom pan fitView BezierEdge Handle` (`reactflow.dev`)
  - 实读源码：`packages/system/src/utils/edges/bezier-edge.ts`、`packages/system/package.json`
- **许可证核查**：**MIT License**（独立用原生 JS 实现贝塞尔控制点公式，并将在 `THIRD_PARTY_NOTICES.md` / 本文档记录参考来源）。
- **提取的设计模式**：
  1. **水平三次贝塞尔连线公式 (`getBezierPath` / `calculateControlOffset`)**：根据源端口 (`Position.Right`) 与目标端口 (`Position.Left`) 的水平间距 `dx` 动态计算曲率控制点，连线既柔顺又不会在节点紧邻时折角过大；同时直接通过 `getBezierEdgeCenter` (`0.125 * P0 + 0.375 * C1 + 0.375 * C2 + 0.125 * P3`) 计算连线中点坐标放置「插入节点 `+`」按钮。
  2. **Viewport 变换模型 (`{ x, y, zoom }`) 与 `fitView`**：通过读取节点边界包围盒自动计算 `zoom` 与平移偏移量，将整条工作流居中自适应展示在画布视口内，附带右下角/顶部 HUD（`-` / `100%` / `适应视图` / `+`）。
- **Aeris 对应实现**：
  - 在 `workflows.js` 中独立实现轻量 `computeEdgeBezierPath()` 与 `fitCanvasToView()`，以 `translate3d(x, y, 0) scale(z)` 驱动 GPU 合成级平移缩放。

### 4. Rete.js (`retejs.org`, `retejs/rete`)
- **查询来源**：
  - 搜索：`retejs.org pipeline recipe editor visual node workflow UI`
  - 源码元数据：`retejs/rete/package.json` (**MIT License**)
- **提取的设计模式**：
  1. **端口 (Socket) 类型显式表达**：每个节点的左侧输入端口与右侧输出端口以明确的语义标签（如 `text-file`、`text`、`json`、`image`、`image-list`、`archive`）标识契约，并在不兼容时清晰阻断连接。
- **Aeris 对应实现**：
  - 节点卡片与参数面板明确展示真实输入/输出数据类型徽章；在节点选择器及拖拽重排中实时校验序列类型兼容性并给出可理解的原因说明。

### 5. CyberChef (`gchq/CyberChef`, `gchq.github.io/CyberChef/`)
- **查询来源**：
  - 搜索：`gchq.github.io/CyberChef pipeline recipe editor`
  - 仓库结构：`gchq/CyberChef` (`package.json`, `src/web/`) (**Apache-2.0 License**)
- **提取的设计模式**：
  1. **严格顺序 Recipe 管线语义**：CyberChef 将本地浏览器处理的顺序操作流清晰呈现为「输入 → 有序 Recipe 管线 → 类型化输出（文本 / 文件下载 / 预览）」，强调纯本地执行、无虚构云端步骤、单一步骤启用/禁用（Bake / Step disable）与按真实输出类型渲染结果。
- **Aeris 对应实现**：
  - 严格保持 Aeris 顺序步骤执行引擎（不改成伪 DAG 分支）；运行抽屉清晰对应 `INPUT`（文本/文件/单图/多图/批量）→ 实时步骤轨迹 → 类型化 `OUTPUT`（纯文本预览+复制、格式化 JSON、图片实时预览、ZIP 压缩包产物卡片与下载）。

### 6. Linear & Raycast & Apple / ChatGPT
- **查询来源**：`Linear UI list density keyboard menu Raycast command search filter categories`、`WAI-ARIA APG`、`Floating UI`
- **提取的设计模式**：
  1. **Linear 列表密度与克制层次**：工作流列表行保留核心真实字段（名称、步骤数、输入→输出类型、最后更新时间、云同步标记），主行动（「编辑」「运行」）外显，低频管理动作（复制、导出、删除）收纳进明确入口的 `···` 浮动菜单。
  2. **Raycast 节点搜索器**：节点添加浮层提供即时搜索框 + 分类筛选（全部 / 文本处理 / 数据格式转换 / 图片处理 / 文件打包），展示兼容性标记与快捷键提示，支持 `ArrowUp/ArrowDown` + `Enter` 快速插入。
  3. **Apple / ChatGPT 控制语言**：延续 Aeris P1–P4 柔和黑白灰表面、细线 1.65px SVG 图标、低饱和语义色、弹性微交互（`--ds-ease-spring`、`--ds-ease-bounce-micro`）与 `prefers-reduced-motion` 完整降级。

### 7. Web Animations API / `js/core/motion.js` & WAI-ARIA APG
- **查询来源**：`WAI-ARIA APG listbox combobox menu dialog disclosure keyboard navigation`（`w3.org`）
- **提取的设计模式**：
  1. **可中断动画与 FLIP**：复用 `js/core/motion.js` 的 WAAPI FLIP 快照与 `prefersReducedMotion` 检查，节点新增、删除、重排时由 `requestAnimationFrame` 每帧同步重绘 SVG 贝塞尔连线，确保连线绝不滞留旧坐标。
  2. **WAI-ARIA 与 WCAG 2.2 AA 单指针替代**：拖拽节点调整顺序外，同时在节点工具栏、参数面板和移动端提供明确「前移 / 后移」按钮及键盘方向键调整；浮层（节点选择器、更多菜单、移动端底部参数抽屉）实现 `Escape` 关闭与焦点回归。

---

## 二、验收证据索引

- 改前基线截图：`docs/ui-rebuild/v63-phase5-workflow/evidence/before/`（5 张，覆盖空态、模板、运行、暗色、390px 移动端）
- 改后实测截图：`docs/ui-rebuild/v63-phase5-workflow/evidence/after/`（14 张，覆盖列表空态/有数据、空白编辑器、多节点画布、Raycast 节点选择器、右侧参数面板、运行中、完成态、暗色、1920px、390px 列表/画布/底部参数抽屉、320px）
- 正常速度 1.0x 操作录屏：
  - `docs/ui-rebuild/v63-phase5-workflow/evidence/workflow-phase5-desktop-1x.mp4`
  - `docs/ui-rebuild/v63-phase5-workflow/evidence/workflow-phase5-mobile-1x.mp4`
- 量化与 9 态真机 DOM 审计数据：`docs/ui-rebuild/v63-phase5-workflow/evidence/phase5-verification-report.json`


---

## 最终整改增补调研（自由编排与方案 A 执行光流）

本轮针对桌面端横向连线冲突、区域内 2D 自由拖拽、跨区域自动让位换位以及方案 A（光流接力 + 圆角边框环绕）完成真实网页与开源代码核对：

| 研究对象 | 实际核对页面 / 源码机制 | 提取的核心设计模式 | Aeris 对应实现 (`workflows.js` / `spatial-experience.css` / `design-system.css`) | 实际验收证据 |
|---|---|---|---|---|
| **React Flow / XYFlow** | `reactflow.dev` 自由节点坐标与 `getBezierPath` 端口公式 | 画布世界坐标与 viewport pan/zoom 解耦；水平方向右出左入、垂直方向下出上入动态三次贝塞尔连线 | `#workflowStepList.wf-node-layer` 桌面强制横向 `row / nowrap`，`syncCanvasEdges()` 基于未缩放世界坐标实时重算端口连接，并分离 `translate: var(--wf-off-x) var(--wf-off-y)` 与节点流式槽位 | `evidence/final-remediation/p5-desktop-horizontal.png`、`evidence/final-remediation/p5-mobile-390.png` |
| **SortableJS** | `sortablejs.github.io/Sortable/#thresholds` 与交换阈值模型 | 双向中点交换阈值 + 滞回死区（hysteresis deadband），避免边界来回闪烁 | `bindCanvasInteractions()` 基于稳定无偏移的 `slots` 槽位中心计算 `mid ± 22px` 滞回换位区，避免借用 live 动画中的兄弟坐标导致抖动 | `evidence/final-remediation/p5-drag-reorder.mp4` |
| **Motion / dnd-kit** | `motion.dev/docs/react-reorder` 与 `dnd-kit` `closestCenter` | 拖拽体紧贴指针（零过渡延迟）、兄弟节点可中断 WAAPI FLIP 让位、`Escape` / `pointercancel` / 不兼容时的完整同步回退 | CSS `translate` 专职承接自由拖拽与已保存偏移，WAAPI `transform` (`animateSiblingShift`) 专职承接可中断兄弟让位；非法换位触发 `validateStepSequence()` 校验失败后节点与 SVG 连线同步滑回原位 | `evidence/final-remediation/p5-verify-report.json` (`drag_checks`) |
| **Apple HIG / SVG WAAPI** | `developer.apple.com/design/human-interface-guidelines/` 克制动效与 SVG `pathLength="100"` `strokeDashoffset` | 避免无限循环高频闪烁；低饱和中性冷静蓝色，严格绑定真实生命周期，支持 `prefers-reduced-motion` 与后台标签页 `visibilitychange` 暂停 | 在 `design-system.css` `:root` / `[data-theme="dark"]` 定义 `--ds-wf-flow` (`#779bc5` / `#8ab0db`)、`--ds-wf-flow-head`、`--ds-wf-success`；以单调 `runEpoch` 解耦 UI 动效与真实 `executeWorkflow`，仅 `"running"` 节点激活 `<rect class="wf-node-trace-rect" rx="13" ry="13" pathLength="100">` 圆角描边环绕，切出/完成/失败/取消立即停止 | `evidence/final-remediation/p5-exec-running.png`、`evidence/final-remediation/p5-exec-animation.mp4` |
