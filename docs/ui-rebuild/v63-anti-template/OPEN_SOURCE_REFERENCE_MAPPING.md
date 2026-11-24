# Aeris V6.3｜Open-Source Reference Mapping（开源源码研究与许可证映射表）

> **合规铁律**：严格遵守每个开源项目的许可证条款。对于 **GPL-3.0**（IT-Tools）与 **Sustainable Use License**（n8n），仅作信息架构与交互模式研究，**严禁复制或移植任何源码**；对于 **MIT** 项目（Actual Budget、Motion、Floating UI），本轮同样以干净室（Clean-Room）方式按 Aeris 原生 Vanilla JS / CSS 架构独立重新实现对应模式，不引入外部运行时依赖或复制整文件。

---

## 1. 开源项目研究总览

| 项目 | 官方仓库 | 核验 Commit SHA | 许可证 | 允许方式 | 是否实际采用设计思想 |
|---|---|---|---|---|---|
| **Actual Budget** | `https://github.com/actualbudget/actual` | `258dcab21006` | **MIT License** | 干净室借鉴结构与交互模式 | **采用**（流水表主导布局、数字右对齐、诚实空状态与筛选条） |
| **IT-Tools** | `https://github.com/CorentinTh/it-tools` | `d505845f918e` | **GNU GPL v3.0** | **仅概念研究，禁止任何源码复制** | **采用（仅概念）**（搜索优先 + 分类目录 + 紧凑工具工作台） |
| **n8n** | `https://github.com/n8n-io/n8n` | `fa015b17861f` | **Sustainable Use License** | **仅概念研究，禁止任何源码复制** | **采用（仅概念）**（画布节点流 + Input/Output 双栏检视） |
| **Motion** | `https://github.com/motiondivision/motion` | `133051adce0f` | **MIT License** | 借鉴三段式可中断 WAAPI 与 FLIP 思路 | **采用**（映射到 `js/core/motion.js` 既有 WAAPI/FLIP 引擎） |
| **Floating UI** | `https://github.com/floating-ui/floating-ui` | `c3042f1f37d9` | **MIT License** | 借鉴溢出祖先监听与视口边界防截断逻辑 | **采用**（修复原生 `<select>` / 弹窗 / HUD 定位与避让） |

---

## 2. 逐项目 10 项强制研究证据

### 2.1 Actual Budget (`actualbudget/actual`)
1. **官方仓库地址**：`https://github.com/actualbudget/actual`（已核验 `master` `@ 258dcab21006`）
2. **实际研究的代码文件与组件**：
   - `packages/desktop-client/src/components/accounts/Header.tsx`
   - `packages/desktop-client/src/components/accounts/Balance.tsx`
   - `packages/desktop-client/src/components/accounts/Account.tsx`
   - `packages/desktop-client/src/components/accounts/AccountEmptyMessage.tsx`
   - `packages/desktop-client/src/components/transactions/SimpleTransactionsTable.tsx`
   - `packages/desktop-client/src/components/transactions/TransactionsTable.tsx`
   - `packages/desktop-client/src/components/budget/BudgetTable.tsx`
3. **对应的设计和交互模式**：
   - `Header.tsx` + `Balance.tsx` 将账户名、正/负结余（`FinancialText` 等宽对齐）、`Add New`、`Filter` 与右置 `Search` 统一压缩在账本表正上方的紧凑栏中；
   - `SimpleTransactionsTable.tsx` 以 `Table` 表头 + `Row` 细线行呈现 `Date | Payee | Category | Notes | Amount`，金额列固定宽度右对齐，斑马/悬停底色轻量区分；
   - `AccountEmptyMessage.tsx` 提供清晰无废话的操作引导按钮（直接触发新增或同步），`BudgetTable.tsx` 保持按月展开/折叠且记录滚动位置。
4. **Aeris 当前存在的问题**：
   - 截图 `before-finance-1440.png` 显示：Aeris 把 3 个币种选择框、4 个汇总卡片与巨大的折线图全放在页面上方，把真正核心的 `#financeRecordedSection`（交易流水表）挤到首屏 `y > 1100px` 以下，且没有像真实账本一样在主视口突出搜索/月份/新增/流水行。
5. **值得借鉴的实现思想**：
   - 将 **流水表（Ledger Register）+ 筛选/搜索工具栏** 提升为 `/finance` 的绝对主体，汇总数字收敛为顶部紧凑带，币种配置与趋势图表移至次级/可折叠抽屉或辅助区，保持等宽右对齐金额与 5 分支诚实空状态。
6. **计划映射到 Aeris 的真实文件与组件**：
   - `index.html`（`#financePage` 内部 DOM 结构重排：保留全部既有 ID）
   - `js/finance/app.js`（保持分精度/多币种/5 分支空状态/CRUD 与同步契约不变，优化流水行对齐与默认展开）
   - `spatial-experience.css`（重构 `#financePage` 为 Actual 风格单栏主账本 + 右侧紧凑预算/分类栏）
7. **是否实际采用**：**是**，全面采用其账本主从信息架构。
8. **未采用的部分及理由**：未采用其 React/Redux 虚拟滚动表格实现与银行直连 Plaid/GoCardless 概念，因 Aeris 为原生 Vanilla JS 架构且采用 Cloudflare D1 + Android 通知协同账本模型。
9. **对应许可证及使用限制**：**MIT License**；仅借鉴交互与布局模式，零代码复制，无额外第三方代码合入，不改变 `THIRD_PARTY_NOTICES.md`。
10. **重构后的浏览器验证目标**：在 Phase 3/5 通过 `1440px` 与 `390px` 实机截图及 `verify` 脚本核验：首屏即可看到汇总条、筛选栏与流水记录行，6 种币种切换、抽屉新建/编辑/删除/恢复及移动端单列堆叠全通过。

---

### 2.2 IT-Tools (`CorentinTh/it-tools`)
1. **官方仓库地址**：`https://github.com/CorentinTh/it-tools`（已核验 `main` `@ d505845f918e`）
2. **实际研究的代码文件与组件**：
   - `src/layouts/base.layout.vue`
   - `src/pages/Home.page.vue`
   - `src/components/MenuLayout.vue`
   - `src/modules/command-palette/command-palette.vue`
3. **对应的设计和交互模式**：
   - `base.layout.vue` 与 `Home.page.vue` 将搜索框（`Ctrl + K`）与收藏工具（`favoriteTools`）置于最高优先级；
   - 左侧分类菜单（`CollapsibleToolMenu`）仅显示单行图标与名称，右侧多列网格直观展示工具，进入具体工具页（如 `/hash-text`）后切换为干净聚焦的输入/输出工作台，不附带无关营销说明。
4. **Aeris 当前存在的问题**：
   - `before-tools-1440.png` 与 `before-tools-390.png` 显示：`/tools` 顶部先堆叠了一整张「处理流程 / 工具工作流」推广卡片和冗长本地处理说明，390px 首屏完全看不到任何工具；每张 `.tool-card` 底部还重复打印所在分类名称（如 29 张卡每张都写 `文本处理工具箱`），且带有大片蓝底图标方框，视觉重复感极强。
5. **值得借鉴的实现思想**：
   - 搜索框与快捷键提示紧贴页头下方，工作流入口收敛为与搜索框同行或紧邻的轻量按钮/标签；
   - 剔除工具卡片内重复的分类文字，缩小/弱化装饰图标框，使用高密度、左对齐单行标题 + 一行描述 + 收藏按钮的紧凑工具目录条目；
   - 保留 104 个工具（含已退役 ID 路由兼容）与 `/tools/:tool_id` 聚焦工作台。
6. **计划映射到 Aeris 的真实文件与组件**：
   - `index.html`（`#toolsPanel`、`#toolsDashboard`、`#toolWorkbench` 结构调整）
   - `tools.js`（`toolCard`、`renderShelves`、`renderCategoryGrid`、键盘高亮）
   - `spatial-experience.css`（工具目录紧凑密度、390px 无抽屉遮挡与单列对齐修复）
7. **是否实际采用**：**是（仅布局与交互概念）**。
8. **未采用的部分及理由**：**严禁复制 IT-Tools 任何 Vue 组件、CSS 或工具算法源码**（受 GPL-3.0 传染性约束）；同时弃用 IT-Tools 在 390px 窄屏默认遮盖正文的侧边栏行为（已在实机浏览器中观察到其 390px 缺陷）。
9. **对应许可证及使用限制**：**GNU General Public License v3.0 (GPL-3.0)**；严格执行概念级隔离，Zero Code Reuse。
10. **重构后的浏览器验证目标**：核验 104 工具全部可达、`#toolSearchInput` 全宽聚焦与 `↑↓ Enter` 打开、`390px` 首屏即可见工具、无对比度与横向溢出错误。

---

### 2.3 n8n (`n8n-io/n8n`)
1. **官方仓库地址**：`https://github.com/n8n-io/n8n`（已核验 `master` `@ fa015b17861f`）
2. **实际研究的代码文件与组件**：
   - `packages/frontend/editor-ui/src/app/views/NodeView.vue`
   - `packages/frontend/editor-ui/src/features/workflows/canvas/components/WorkflowCanvas.vue`
   - `packages/frontend/editor-ui/src/features/ndv/panel/components/`（`InputPanel.vue`, `OutputPanel.vue`, `NDVHeader.vue`）
3. **对应的设计和交互模式**：
   - `NodeView.vue` + `WorkflowCanvas.vue` 将空间划分为：左侧精简流程与节点目录、中央带网格背景的可视化节点画布（显示真实节点连接线、执行状态色与运行按钮）、以及结构化的 `InputPanel` / `OutputPanel` 数据检视双栏；
   - `CanvasRunWorkflowButton` 将执行主动作固定在清晰的画布动作焦点处。
4. **Aeris 当前存在的问题**：
   - `before-workflows-1440.png` 显示：`/tools/workflows` 的 `.workflow-header` 内部套了一个多余的外框，返回按钮与右徽标分布松散；左侧模板列表以 4 个厚边框卡片呈现；右侧画布未选中流程时只有居中的空卡片，选中后步骤列表用伪元素字符 `"↓"` 作为连接器，表现较为粗糙。
5. **值得借鉴的实现思想**：
   - 去框化 `.workflow-header` 与左侧栏，用紧凑树/列表替代模板大卡片；
   - 强化画布内步骤节点卡片与真实矢量连接线（带端口圆点与箭头）、步级参数内联编辑、以及对称清晰的 `INPUT` / `OUTPUT` 运行轨检视与耗时/重试反馈。
6. **计划映射到 Aeris 的真实文件与组件**：
   - `index.html`（`#workflowWorkspace` 结构精简，保留全部 ID）
   - `workflows.js`（保留 12 项能力、4 套内置模板、全部状态标签与本地/云端契约，优化节点渲染语义）
   - `spatial-experience.css`（画布网格、节点连接器 SVG/CSS、双栏 Input/Output 面板样式）
7. **是否实际采用**：**是（仅空间组织与节点流交互模式）**。
8. **未采用的部分及理由**：未实现自由拖拽二维坐标画布（Vue Flow）及企业版协作成员锁（`.ee.` 文件），因为 Aeris 工作流契约是顺序可重排管线（`#workflowStepList`），且 **Sustainable Use License** 严禁复用源码。
9. **对应许可证及使用限制**：**n8n Sustainable Use License**（非 OSI 宽松开源，含企业版限制）；严格仅作设计参考，Zero Code Reuse。
10. **重构后的浏览器验证目标**：核验 4 套模板加载、步骤增删排序、SVG/节点连线渲染、CSV/文本工作流端到端运行、下载/复制结果与 `Esc`/返回工具箱焦点恢复。

---

### 2.4 Motion (`motiondivision/motion`)
1. **官方仓库地址**：`https://github.com/motiondivision/motion`（已核验 `main` `@ 133051adce0f`）
2. **实际研究的代码文件与组件**：
   - `packages/framer-motion/src/animation/animators/waapi/animate-elements.ts`
3. **对应的设计和交互模式**：
   - `animate-elements.ts` 明确实现「三步无抖动 WAAPI 中断机制」：Step 1 批量读取/停止已有同名动画（写入 DOM）→ Step 2 统一解析关键帧（读取 DOM 几何）→ Step 3 批量启动新 WAAPI 动画，彻底避免循环内的 Style Thrashing，比单循环快 80%。
4. **Aeris 当前存在的问题**：
   - `js/core/motion.js` 已实现良好的 `captureFlipSnapshot` / `playFlipSnapshot` 与 `createMotionScope`，但 CSS 层面仍存在以下问题：`design-system.css` 与 `spatial-experience.css` 中仍有 `.skeleton::after` / `.session-recovery-bar::after` 无限循环跑马灯（Impeccable `[marquee]`）、`--ds-ease-spring` 在弹窗上的弹跳感（`[bounce-easing]`）、部分标签切换过渡 `width`（Hallmark `10a`）及 `box-shadow` 过渡导致 `:focus-visible` 焦点环淡入延迟（Hallmark `15`）。
5. **值得借鉴的实现思想**：
   - 保留 `js/core/motion.js` 既有轻量级 WAAPI + FLIP 架构（不引入 `motion` NPM 运行时依赖以守住 89 资产离线包契约）；
   - 将所有非状态必要的无限动画、宽度动画、弹跳曲线和焦点环过渡清除，改用瞬时焦点环 + `transform`/`opacity` 指数减速曲线（140–220ms）与完整的 `prefers-reduced-motion` 状态保留降级。
6. **计划映射到 Aeris 的真实文件与组件**：
   - `js/core/motion.js`、`design-system.css`、`spatial-experience.css`、`workspace-experience.css`、`public-experience.css`
7. **是否实际采用**：**是（思想映射到既有 `js/core/motion.js`）**。
8. **未采用的部分及理由**：不安装 `framer-motion` / `motion` NPM 包，避免破坏 Aeris 零打包原生 ESM 静态架构与 Service Worker 离线资产清单。
9. **对应许可证及使用限制**：**MIT License**；仅借鉴原理，未复制源码。
10. **重构后的浏览器验证目标**：验证 I07 动效回归（`maxSeamDriftPx: 0`）、Reduced Motion 下状态切换不丢失、焦点环瞬时可见。

---

### 2.5 Floating UI (`floating-ui/floating-ui`)
1. **官方仓库地址**：`https://github.com/floating-ui/floating-ui`（已核验 `master` `@ c3042f1f37d9`）
2. **实际研究的代码文件与组件**：
   - `packages/core/src/computePosition.ts`
   - `packages/dom/src/autoUpdate.ts`
3. **对应的设计和交互模式**：
   - `computePosition.ts` 通过有序中间件管线（`offset` → `flip` → `shift` → `size`）保证浮层在视口边缘或局部滚动容器内不会溢出或被遮挡；
   - `autoUpdate.ts` 精确监听溢出祖先滚动/缩放及 `ResizeObserver`（并在尺寸回调中临时 `unobserve` 防止 ResizeObserver 循环报错），及时刷新浮层位置并在关闭时完全注销。
4. **Aeris 当前存在的问题**：
   - 虽然 I10 修复了部分弹窗 `transform` 问题，但全站弹窗/抽屉、原生 `<select>` 包含块、账户菜单弹出层（`#accountMenuPopover`）及底部 HUD 避让仍依赖硬编码像素偏置与非标准的 `100vw` 宽度计算（`min(390px, calc(100vw - ...))` 触发 Hallmark Gate 34）。
5. **值得借鉴的实现思想**：
   - 彻底清理 `100vw` 计算，改用 `100%` 与视口安全边界（`env(safe-area-inset-*)`）；
   - 确保所有包含原生 `<select>` 的抽屉/面板结束后计算 `transform: none`，避免浏览器将原生下拉弹窗锚定在错误坐标；
   - 让弹出菜单/命令面板在视口缩小时自适应 `max-height` 与安全位置。
6. **计划映射到 Aeris 的真实文件与组件**：
   - `design-system.css`、`public-experience.css`、`workspace-experience.css`、`spatial-experience.css`、`js/core/motion.js`
7. **是否实际采用**：**是（边界避让与无包含块污染原则）**。
8. **未采用的部分及理由**：不引入 `@floating-ui/dom` 包，因 Aeris 多数弹出组件采用原生 `<dialog>`/模态层与固定位置锚定，现有纯 CSS + `js/core/motion.js` 即可零依赖实现。
9. **对应许可证及使用限制**：**MIT License**；仅借鉴原理，未复制源码。
10. **重构后的浏览器验证目标**：核验 375/390/768/1024/1440px 下原生 `<select>` 弹出、账户菜单、右抽屉与底部 HUD 零裁切、零重叠、零水平溢出。
