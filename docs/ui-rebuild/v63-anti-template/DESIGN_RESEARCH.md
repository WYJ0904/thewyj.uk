# Aeris V6.3｜Design Research（五大 Skill 执行与公开网站研究报告）

> **基线**：仓库 `WYJ0904/thewyj.uk` · 分支 `hydrogen/v63-anti-template-structural-redesign`（基于 `hydrogen/i10-full-site-interaction-acceptance` `eb3a824f96c194b707035c1cd77d7b97b200408f` 独立 worktree）  
> **研究原则**：所有外部站点均于 2026-11-24 通过真实浏览器在桌面端（1440×900）与移动端（390×844）实际打开并核验（见 `BROWSER_HOST_FACTS`），仅吸收信息架构、布局节奏、交互模式与设计规范，零复制任何第三方专有品牌、图标、图像或受限源码。

---

## 1. 五大 Skill 实跑记录与核心约束提炼

### 1.1 Frontend Design (`%USERPROFILE%\.gemini\config\skills\frontend-design\SKILL.md`)
- **核心设计观**：把产品当作有独立视角的设计工作室作品，拒绝“通用 SaaS 卡片套件”（同尺寸圆角白卡片、统一软灰阴影、每处标题上方挂全大写英文眉题、`A · B · C` 中点串联、按钮/链接尾部粘连 `→`、数字标记 `01 / 02 / 03` 用于非顺序内容）。
- **在 Aeris 的落地决策**：
  1. 剔除全站模板化英文眉题（如首页卡片上的 `LEARNING` / `FINANCE` / `TOOLS` / `TRANSFER` / `ACTIVITY` / `ACCOUNT`，以及多处无意义的 `.section-kicker`）与标题中点串联（`学习 · 工具 · 账本 · 文件`、`我的账户 · 设置与偏好`），让中文标题与业务真实数据直接说话。
  2. 动作文案回归「动词 + 对象」，去掉按钮内装饰性 `→`（`探索 Aeris →`、`进入空间 →`、`打开工作流 →`），在保留既有 ID 与功能的同时消除引导废话。
  3. 用版式尺度、细线分隔与对齐关系表达信息层级，而非把每块内容都套一层白卡片。

### 1.2 UI UX Pro Max (`%USERPROFILE%\.gemini\config\skills\ui-ux-pro-max\scripts\search.py`)
- **实跑命令**：
  - `python .../search.py "productivity workspace dashboard" --design-system --density 8 -p "Aeris" -f markdown`
  - `python .../search.py "personal finance ledger table" --domain product`
  - `python .../search.py "developer tools catalog search" --domain product`
  - `python .../search.py "admin console dense table" --domain ux`
  - `python .../search.py "typography hierarchy readable scale" --domain typography`
  - `python .../search.py "sidebar breadcrumb navigation" --domain ux`
  - `python .../search.py "reduced motion state transition" --domain ux`
  - `python .../search.py "keyboard focus contrast table" --domain ux`
  - `python .../search.py "responsive breakpoint mobile drawer" --domain ux`
- **关键输出与 Aeris 映射**（不覆盖 Aeris 现有品牌与中性色板，仅提取交互与 Token 规范）：
  - **Density 8/10（高密度工作台）**：Flat Design，零装饰性阴影，4/8px 严格节奏，150–200ms 干净状态切换。
  - **Cancellable State Transitions**：快速切换（标签、筛选、密度）不得依赖 `transitionend`/`animationend` 推进语义状态，必须可中断并立即落定最终状态（复用并强化 `js/core/motion.js`）。
  - **Focus Appearance & Not Obscured**：聚焦环保持 2px 轮廓、≥3:1 状态对比度，持久化浮层（HUD/Toast）不得遮挡当前焦点元素。
  - **Table Responsive Handling**：桌面使用高密度对齐账目表/控制台表，窄屏（≤720px）切换为紧凑结构化行项而非横向溢出。

### 1.3 Taste Skill (`%USERPROFILE%\.gemini\config\skills\design-taste-frontend\SKILL.md`)
- **实读规范**：`layout-v4.md`、`cards.md`、`copy.md`。
- **实跑脚本**：`node .../copy-lint.mjs index.html`（基线 `index.html` 实测）。
- **核心提炼**：
  1. **公开首页第一屏规范**：Hero 在 1440×900 与 390×844 下独立成屏、叙事克制，真实产品演示（`#publicCapabilityGallery`）位于明确舞台区，不放置手绘 macOS 红绿灯圆点（`.preview-dots`）。
  2. **拒绝两层以上嵌套容器（Two levels, never three）**：公开预览与产品卡片最多「表面 → 内容」，禁止卡片套卡片、卡片套浅灰框再套白框。
  3. **真实文案直白原则**：标题以业务名词为主（例如公开页明确说出「学习、工具、账本与文件在一个账户里协同」），按钮直接给出结果动词，去掉空洞口号。

### 1.4 Impeccable (`%USERPROFILE%\.gemini\config\skills\impeccable\`)
- **实跑命令**：
  - `impeccable.cmd context --target index.html`
  - `impeccable.cmd detect index.html design-system.css product-ui.css public-experience.css spatial-experience.css workspace-experience.css styles.css`
- **实读参考**：`craft-floor.md`、`operate.md`、`critique.md`、`audit.md`、`distill.md`、`layout.md`、`typeset.md`、`animate.md`。
- **核心提炼**：
  1. **Surface Mode 分区**：公开首页属于 **Persuade（叙事与试用转化）**，而登录后首页、财务账本、工具箱、工作流、管理后台、文件传输、账户中心均属于 **Operate（高效任务执行）**。Operate 界面禁止为追求表现力而牺牲扫描效率、稳定密度与可预期布局；不应在登录后的工作台保留公开营销页的居中 Hero 或冗余推广条。
  2. **The Product Slop Test & Distill**：去掉重复信息（当前登录后首页把 4 个模块重复呈现了 4 遍）、去掉单边色条（`[side-tab]`）、去掉彩色暗色发光（`[dark-glow]`）、去掉无限循环扫光动画（`[marquee]`）、修正跳级标题（`[skipped-heading]` `h1` → `h3`）。
  3. **Motion Thesis**：工作台操作保持 150–250ms 瞬捷反馈，使用指数减速曲线（`cubic-bezier(0.16, 1, 0.3, 1)`），禁止弹性回弹默认曲线（`[bounce-easing]`），`prefers-reduced-motion` 保留语义状态切换而非粗暴清除一切反馈。

### 1.5 Hallmark (`%USERPROFILE%\.gemini\config\skills\hallmark\`)
- **实跑命令**：`node .../sloplint.mjs index.html styles.css design-system.css spatial-experience.css workspace-experience.css --scope app`
- **实读规范**：`gates.md`、`redesign.md`。
- **关键门禁（Floor & Reflex）**：
  - **Gate 3 / 4**：禁止卡片套卡片；禁止 3 列等宽图标方块陈列；禁止卡片侧边粗色条。
  - **Gate 10a / 15**：禁止 `transition: all` 与动画化 `width`/`height`/`top`/`left`；`:focus-visible` 焦点环必须瞬时出现（不得因 `box-shadow` 过渡而延迟）。
  - **Gate 24a / 48**：所有颜色与间距回归 `:root` 语义 Token（消除 484 条 FAIL 中的硬编码颜色、`#ffffff` 字面量、非标 `100vw` 计算）。
  - **Gate 39a**：`disabled` 状态需同时具备视觉弱化、光标记号与原生属性，不单靠 `opacity`；输入框禁止用变更 `border-width` 作为 focus 状态。
  - **Gate 47a**：严禁手绘浏览器/窗口红绿灯圆点装饰（`.preview-dots`）。
  - **Gate 54 / 63 / 67**：严禁眉题（Eyebrow）、小字全大写字距拉宽标签（`letter-spacing > 0.03em`）、中点拼串与箭头粘连文本。

---

## 2. 公开网站真实浏览分析（2026-11-24 实机采样）

| 类别 | 研究站点（已通过 Host Verified） | 实机观察要点（Desktop 1440×900 / Mobile 390×844） | 映射到 Aeris 对应页面 |
|---|---|---|---|
| **A. 公开官网** | **Apple** (`apple.com`, `apple.com/iphone/`)<br>**Samsung** (`samsung.com`, `samsung.com/us/mobile/`) | 1. 公开页顶部单行通透全局导航栏，**无常驻工作区侧边栏**挤压主舞台；<br>2. 首屏 Hero 采用清晰「主标题 + 一句事实副标题 + 双操作按钮」并与下方产品实机舞台建立强视觉呼应；<br>3. 下滑节奏由「交互产品演示」过渡到「差异化尺寸的模块能力网格（非均等小卡片）」，再过渡到高对比深色隐私/硬件段落与清晰套餐对比；<br>4. 390px 移动端顶部收拢为品牌+核心动作+菜单按钮，CTA 纵向全宽对齐。 | **Aeris 未登录公开首页**（`/`、`data-session-mode="guest"`）：隐藏左侧 `#v3Sidebar`，让公开页恢复全宽居中舞台；首屏展示 Aeris 真实能力定位，紧接真实交互预览窗（去掉假红绿灯），下方能力章节采用「核心主产品分镜 + 紧凑列表」节奏，不再把相同 4 模块以数字标号卡形式铺一遍。 |
| **B. 登录后工作台** | **Linear** (`linear.app`, `linear.app/features`, `linear.app/docs`) | 1. 登录后工作台采用「左侧分组导航栏 + 顶部面包屑与快捷搜索 + 主工作区」三段式，**零营销 Hero**；<br>2. Inbox 与问题列表使用**全宽细线列表（Hairline Dividers）+ 左侧状态标记 + 中部标题与实时摘要 + 右侧紧凑元数据与操作**，而非独立大白卡片网格；<br>3. 强调操作优先、键盘快捷键（`Ctrl+K` / `G+W`）与高信息密度；<br>4. 移动端自动收敛为单列列表，不堆积多排大按钮与虚假进度条。 | **Aeris 登录后首页**（`/`、`/select` authenticated）：砍掉重复的 4 模块摘要卡片条、重复的快速访问卡片和冗余推广文案；将「时间问候 + 核心待办/通知 + 今日学习与本月账本实时摘要 + 6 个可定制/可拖拽工作区模块（列表/紧凑条带视图）+ 近期活动时间线」重组为高密度 Linear 式个人工作台。 |
| **C. 管理后台** | **Cloudflare** (`dash.cloudflare.com` 登录墙 / `developers.cloudflare.com`)<br>**Material 3** (`m3.material.io/components`) | 1. `dash.cloudflare.com` 跳转登录门禁（已记录，未虚构后台图）；`developers.cloudflare.com` 展示极高密度的三栏结构（左侧可筛选树状导航、面包屑、Segmented 切换、语义提示框、紧凑参数表格）；<br>2. `m3.material.io` 将交互组件按用途清晰分组（Action / Containment / Navigation / Selection / Input），导航栏状态清晰、边界一致；<br>3. 危险操作、配置参数与表单控件保持严格等高、明确标签与高对比度反馈。 | **Aeris 管理后台、安全中心与 Feature Flags**（`/admin`、`/account`）：将 `/admin` 用户列表、充值审核、审计日志、登录记录从松散卡片改为紧凑的细线数据表头 + 对齐表格行，KPI 栏收敛为顶部一体细线指标带；Feature Flags 与账户安全中心分离普通配置与危险区（带明确警示与二次确认）。 |
| **D. 财务账本** | **Actual Budget** (`actualbudget.org`, `actualbudget.org/docs/tour/accounts/`) | 1. 账本页**主视觉中心即流水表（Account Register）**，而非大面积走势图或 3 个下拉框；<br>2. 顶部为紧凑 Register Header：账户/月份范围、正负结余等宽数字（绿入红出）、`+ 新增账目`、筛选与搜索同行排列；<br>3. 流水表采用紧凑细线表头与交替/悬停行高（日期 \| 摘要与分类标签 \| 备注/来源 \| 右对齐等宽金额 \| 行内编辑/删除/恢复），币种/图表/预算作为可收起或侧边/次级辅助面板，不再把流水表挤到 `y > 1100px` 首屏之外。 | **Aeris 财务账本**（`/finance`）：重排信息优先级——顶部紧凑财务工具栏（月份/币种快速切换 + 搜索与筛选 + `新增账目`），首屏核心区域直接呈现「收支汇总条 + 待核实通知队列（若有）+ **流水主表**」，右侧（桌面）或折叠区（移动）承载月度预算进度与分类支出排行，趋势折线图默认紧凑可收起置于次级区。 |
| **E. 工具箱** | **IT-Tools** (`it-tools.tech`, `it-tools.tech/hash-text`)<br>**Raycast** (`raycast.com`, `raycast.com/store`) | 1. **Raycast / IT-Tools 搜索优先**：页面顶部即全宽搜索框（支持 `/` 聚焦与 `↑↓ Enter` 键盘打开），下方直接展示「收藏 / 最近使用」与分类目录；<br>2. 分类栏为紧凑单行树/列表（图标 + 名称 + 计数），**不把每个工具都做成占据大量高度的重复双行卡片**，且卡片内不再重复印出当前分类名；<br>3. 工具详情页（`hash-text`）采用极简双栏/单栏工作台：左侧输入/参数，右侧等宽结果行配一键复制按钮，视觉聚焦当前处理任务；<br>4. 修正 IT-Tools 移动端 390px 抽屉遮挡正文的问题：Aeris 在窄屏采用横向可滚动分类条 + 紧凑工具行。 | **Aeris 工具箱**（`/tools`、`/tools/:tool_id`）：顶部紧凑搜索栏（`↑↓ Enter /`）+ 内联工作流轻量入口，取消占屏巨大的工作流介绍卡片；左侧极简分类目录，右侧为紧凑高密度工具目录（图标、名称、一句话说明、收藏星标），去除每张卡片底部冗余的分类复读文字；工具工作台强化输入/参数/输出分栏。 |
| **F. 工作流** | **n8n** (`n8n.io`, `docs.n8n.io/build/understand-workflows`) | 1. `n8n.io` 首页交互工作流画布展示从左到右/自上而下的**有向连线节点拓扑**（节点图标、名称、端口、清晰连接线与状态标注），以及底部工具节点挂载方式；<br>2. `docs.n8n.io` 展示多标签层级导航、树状侧边栏与清晰的运行态/预览标识；<br>3. 编辑器空间组织清晰分离：**左侧流程与模板目录 \| 中央画布节点链路与参数配置 \| 下方/右侧 Input → Output 运行检视面板**（每步状态、耗时、错误重试）。 | **Aeris 工作流**（`/tools/workflows`）：清理外层冗余头部边框，建立清晰的「左侧流程目录 \| 画布式步骤链路编辑器（带真实 SVG 连线、端口节点序号与步骤行内参数编辑）\| 左右对称 INPUT / OUTPUT 运行检视器（逐步运行状态、耗时、失败定位与导出）」。 |
| **G. 动效与交互** | **Motion** (`motion.dev`)<br>**Floating UI** (`floating-ui.com`)<br>**WAI-ARIA APG** (`w3.org/WAI/ARIA/apg/patterns/`) | 1. **Motion**：强调 FLIP 布局动画的可中断性、弹簧/指数减速与 GPU 合成属性（`transform`/`opacity`）；<br>2. **Floating UI**：强调锚点定位、视口边界 `flip`/`shift` 防裁切（特别是弹窗与下拉框不得被 `overflow` 或残余 `transform` 包含块截断）；<br>3. **WAI-ARIA APG**：强调 Tabs 方向键漫游、Listbox `aria-activedescendant`、Dialog 焦点陷阱与关闭回焦、`Reduced Motion` 等语义一致性。 | 统一复用并增强 `js/core/motion.js`：清除残余 `transform`、移除弹簧/弹跳过冲与无限跑马灯、为弹窗/抽屉/Tab/列表重排提供 140–240ms 可中断合成层过渡与完整 Reduced Motion 状态保留。 |
