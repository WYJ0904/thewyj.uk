# Aeris V6.3｜Design System Decisions（全站设计规范与模块结构决策）

> 本规范基于 Phase 1 五大 Skill 实跑结果（`frontend-design` / `ui-ux-pro-max` / `design-taste-frontend` / `impeccable` / `hallmark`）及公开产品/开源源码实机研究制定。严格遵循 `DESIGN_SYSTEM_2.md` 与 `qa/i05` ≤ 8px 面板圆角契约。

---

## 1. 全站设计语言与 Token 治理（Unified Design Language）

### 1.1 表面模式分离（Persuade vs. Operate）
| 表面类别 | 覆盖路由 | 视觉基调 | 导航外壳 |
|---|---|---|---|
| **Public（Persuade）** | `/`（guest）、`/trial`、`/download`、`/changelog`、`/login`、`/register`、`/forgot-password`、`/terms`、`/privacy`、`/security-privacy` | 清晰留白、大尺度排版、实机预览舞台、高对比隐私深色段 | 顶部单行全局导航 `#accountBar`；**隐藏左侧 `#v3Sidebar`**（消除访客首页偏右挤压） |
| **Workspace（Operate）** | `/`（authenticated）、`/select`、`/finance`、`/tools`、`/tools/:tool_id`、`/tools/workflows`、`/language*`、`/transfer`、`/account`、`/recharge`、`/admin` | 高密度中性工作台表面、1px 细线分隔、克制语义色、等宽对齐数据 | 顶部紧凑状态栏 + 左侧分组导航 `#v3Sidebar`（移动端收拢为顶栏抽屉） |

### 1.2 字体系统（Typography — 去除通用 AI 默认字体）
- **UI 正文与标题栈**：去除首位的 `"Inter"`，改为系统原生高可读中文/西文混合无衬线栈：
  `--ds-font-sans: "Segoe UI Variable", "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif;`
- **等宽数据栈**（仅用于金额、版本号、SHA-256、快捷键、统计计数与代码输出）：
  `--ds-font-mono: "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, monospace;`
  搭配 `font-variant-numeric: tabular-nums;`。
- **字号与层级**：
  - Public Hero `H1`：`clamp(2rem, 3.8vw, 3.125rem)`，字重 `750`，行高 `1.12`，字距 `-0.025em`（严禁超过 `-0.04em`）。
  - Workspace 页面 `H1`：`1.375rem–1.625rem`（固定清晰标尺，不做营销式夸张缩放）。
  - **严格禁止**：全大写英文眉题（`.section-kicker` / `.workspace-card-kicker` 的 `text-transform: uppercase; letter-spacing: 0.06em`）、中点拼串装饰标题、按钮文本内嵌 `→`。

### 1.3 色彩与表面（Color & Surfaces — 全量 Token 化）
- 所有色彩（含纯白/近黑开关滑块、阴影、边框与禁用态）均收敛至 `:root` 与 `:root[data-theme="dark"]` 语义 Token，消除 CSS 中的 `#fff`/`#ffffff`/`#000` 字面量。
- **中性表面阶梯（Light / Dark）**：
  - 画布 `--ds-workspace-canvas`: `#f6f7f9` / `#0b0e14`
  - 主工作面 `--ds-surface`: `#ffffff` / `#141922`
  - 次级底面 `--ds-surface-subtle`: `#f8fafc` / `#10151e`
  - 细线分隔 `--ds-divider`: `#e5e9f0` / `#1d2532`
- **主动作与克制强调色**：高对比单色主按钮（`#111113` on Light / `#f8fafc` on Dark），品牌蓝 `#2563eb`（Dark `#6ea2ff`）仅用于焦点环、当前激活指示与关键状态；语义绿/橙/红均配文字或图标双重提示且满足 WCAG AA ≥ 4.5:1。
- **禁止项**：禁止卡片单侧 3px 色条（`[side-tab]`）、禁止暗色发光阴影（`[dark-glow]`）、禁止纯 `opacity` 表达禁用态（统一设置 `background` + `color` + `border-color` + `cursor: not-allowed`）。

### 1.4 间距、容器与圆角纪律
- 统一 4px 基准间距 Token（`--ds-space-1`..`--ds-space-20`）。
- Workspace 卡片/面板圆角严格控制为 `6px`–`8px`（满足 `qa/i05` `maxRadius <= 8.5` 硬约束），弹窗 `12px`，微徽标胶囊 `999px`。
- 禁止 `100vw` 宽度计算（统一使用 `100%` + 安全边界内边距与 `overflow-x: clip`）。

### 1.5 动效与焦点规则（Motion & Interaction）
- **复用 `js/core/motion.js`**：保留可中断 FLIP（`flipScale: false`）、标签切换骨架锁高（0px 滚动跳变）、路由进入合成层过渡与安全预取。
- **清除违禁 CSS 动效**：
  - 删除 `.skeleton::after` 与 `.session-recovery-bar::after` 无限循环跑马灯；
  - 将 `--ds-ease-spring` 统一收敛为指数减速 `cubic-bezier(0.16, 1, 0.3, 1)`；
  - 删除 `transition: all` 与 `width`/`height` 过渡；
  - `:focus-visible` 焦点环（`2px solid var(--ds-focus)`）**零延迟瞬时显现**（移除输入框 `box-shadow` 过渡）。

---

## 2. 分模块专属结构布局决策

### 2.1 第一优先级：登录后首页（`/`、`/select` — Linear Operational Workbench）
- **顶部问候与高频动作条**：左侧展示时间问候（`#dashboardGreeting`）+ 会员等级/到期提示；右侧仅放高频真实入口（如 `新增账目` / `打开工具箱` / `继续学习`），修正已登录态仍显示 `"进入空间 →"` 的语义错误。
- **单行实时状态带（`#homeV3SummaryGrid`）**：4 列紧凑细线指标格，去除虚假进度条（`.v3-summary-track` 隐藏/降噪），直接呈现「今日学习 / 本月结余 / 传输状态 / 最近工具」。
- **可定制工作台矩阵（`#workspaceBentoGrid`）**：
  - `comfortable`（默认 2 列细线网格）与 `compact`（1 列单行条带，行高 `< 72%` comfortable，满足 I04 几何断言）：
  - 隐去英文全大写眉题，头部呈现清晰中文模块名 + 单一语义状态，主体直接显示实时数据与近期动态条目，底部轻量动作栏保留 `详情预览` 与直达路由；
  - 完整保留 `自定义布局`、拖拽/键盘上下排序、隐藏/恢复、全隐藏空态、重置撤销与账户数据隔离。
- **近期活动与快速访问整合**：`.home-quick-access` 改造为紧凑单行横向直达栏，与 `#homeRecentActivity` 实时活动流紧邻，不再占屏堆砌第 4 遍大卡片；`#homeProductDetails` 折叠为纯技术同步诊断区；公开参照段落（`window`..`final`）维持 DOM 可达但作为次级参考区安静置于工作区底部折叠/分隔带之后。

### 2.2 第二优先级：财务账本（`/finance` — Actual Budget Register-First）
- **结构反转（流水首屏前置）**：
  - 顶部紧凑标题栏（含同步徽标、`隐藏金额`、`导出与加密备份`、`新增账目` 主按钮）；
  - 紧接 **单行紧凑收支与币种带**（左侧 4 项等宽收支结余，右侧 3 列精简币种选择器）；
  - **主栏（桌面左 ~68% 宽）**：待核实通知队列（若有）+ **默认展开的流水主表（`#financeRecordedSection` 加 `open`）**，顶部即内联月份/搜索/类型/分类/状态筛选条，紧接对齐表头（`类型 · 摘要与分类时间 | 金额 · 操作`）与高密度细线交易行（等宽右对齐金额、行内编辑/删除/恢复）；
  - **辅栏（桌面右 ~32% 宽）**：月度预算进度 + 分类支出统计 + **紧凑可收起 6 个月收支走势图（`#financeTrendSection`）**（移动端按顺序折叠/单列堆叠）。

### 2.3 第三优先级：工具箱（`/tools` & `/tools/:tool_id` — IT-Tools / Raycast Search-First）
- **搜索优先第一屏**：紧凑单行页头（去右偏与按钮换行）+ 全宽实时搜索栏（`↑↓ 选择 · Enter 打开 · / 聚焦`）+ 同行轻量 `工作流` 跳转入口（取消占屏的独立工作流推广卡，避免 390px 首屏完全看不到工具）。
- **两栏工作区**：左侧紧凑单行分类目录（含收藏与最近使用货架，移动端转为横向紧凑标签条），右侧高密度工具网格/列表（左对齐图标+名称+单行说明+收藏按钮，**去掉每张卡底部重复的分类名标签**）。
- **工具工作台**：聚焦输入/参数/输出分栏与一键复制/配置保存，`Esc` 返回列表并回焦原工具项。

### 2.4 其余全站模块专属布局
- **未登录公开首页（`/` guest）**：隐藏 `#v3Sidebar` 全宽展示；克制 Hero → 去除假红绿灯的交互预览窗 → 非均等分栏能力矩阵（去掉 `01 ·` 编号眉题）→ 深色隐私承诺带 → 套餐对照与底栏。
- **工作流（`/tools/workflows`）**：去外框顶栏 + 精简左侧流程树 + 点阵画布内矢量连线步骤节点 + 对称 `INPUT | OUTPUT` 运行与步级计时检视器。
- **管理后台（`/admin`）**：一体细线 KPI 指标带 + 紧凑标签页 + 表头对齐的高密度细线表格行（替代浮动大卡片）+ Feature Flags 紧急关闭高对比警示区。
- **语言学习（`/language*`）**：对齐合理的语言选择器 + 专注紧凑词表配置 + 居中大字词卡答题台。
- **文件传输（`/transfer`）**：配额条内联页头 + 精简可折叠分享配置 + 明确拖拽区与结构化分享列表。
- **账户与安全中心（`/account`）**：合并重复个人资料卡为单行简洁档案栏 + 分组设置列表 + 明确隔离的危险注销区。
