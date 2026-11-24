# Aeris V6.3｜Current UI Anti-Pattern Audit（现状反模板化审计报告）

> **审计基准**：`hydrogen/i10-full-site-interaction-acceptance` (`eb3a824f96c194b707035c1cd77d7b97b200408f`)  
> **审计输入**：实机 Before 截图（`evidence/before/` 及 `docs/ui-rebuild/i10/evidence/`）、`impeccable detect` 机械扫描、`hallmark sloplint` 规则扫描、`design-taste-frontend copy-lint` 扫描与五大 Skill 启发式走查。

---

## 1. 机械扫描与自动检测汇总（实跑输出）

| 检测工具 | 扫描对象 | 实测结果 | 关键命中的代表性问题 |
|---|---|---|---|
| **Impeccable `detect`** | `index.html` + 6 份主 CSS | **29 条反模式 + 3 条建议** | `[low-contrast]` hover/深色警告对比度不足（1.5:1–2.1:1）；`[dark-glow]` 深色发光阴影；`[cramped-padding]` 贴边无内距（`.public-intro`, `.finance-side-panel`, `.admin-editor-section`）；`[skipped-heading]` `h1` 直跳 `h3`；`[marquee]` `.skeleton::after` 与 `.session-recovery-bar::after` 无限循环；`[side-tab]` 6 处左侧 3px 竖条纹；`[bounce-easing]` 3 处 |
| **Hallmark `sloplint`** | `index.html` + 5 份 CSS（`--scope app`） | **484 FAIL · 475 REFLEX · 100 WARN** | Gate `7a`/`48` 大量硬编码色值（`#ffffff`、`rgba(15,23,42,...)` 等）；Gate `10a` 过渡 `width`（`.ds-tab-indicator`）；Gate `15` `box-shadow` 过渡导致 focus 环淡入；Gate `24a`/`24b` 大量未用 `--ds-space-*` 的零散边距；Gate `34` `100vw` 计算溢出；Gate `39a` 纯 `opacity` 禁用态与 `border` focus 态；Gate `67` `.workspace-card-kicker` 小字全大写拉宽字距；Gate `3` 三列均等图标卡片 |
| **Taste `copy-lint`** | `index.html` | **0 FAIL · 0 WARN**（静态壳文本量小） | 虽静态文本字数触发为 0，但人工走查可见大量中点拼串（`学习 · 工具 · 账本 · 文件`）、按钮带箭头（`探索 Aeris →`）与冗余英文眉题（`LEARNING` / `FINANCE`） |

*(注：Impeccable `[broken-image]` 命中 `#trialImagePreview` 与 `#paymentQrImage` 两个在隐藏初始状态下动态写入 `src` 的 `<img>` 标签，属于业务运行时占位元素，重构时可按语义补充默认无破图态或保持隐藏受控状态。)*

---

## 2. 按模块视觉与信息架构反模板化审查（基于真实 Before 截图）

### 2.1 公开首页（`before-public-home-1440` / `i10-public-home-1440-light.png`）
1. **错误套用工作台侧边栏**：未登录访客访问 `/` 时，左侧仍出现 208px 的 `#v3Sidebar` 工作区导航栏，导致原本居中构图的公开 Hero 整体向右偏移，既不像成熟产品官网（Apple/Samsung），又暴露了一串点击后全部被拦截的登录态菜单。
2. **模板化 Hero 堆砌**：顶部依次堆叠「蓝色圆角胶囊 `学习 · 工具 · 账本 · 文件` → 图标+Aeris → 全大写英文眉题 `AERIS WORKSPACE · V6.3` → 大标题 → 说明 → 3 个按钮（含 `探索 Aeris →`）」，信息重点分散。
3. **仿制 OS 窗口装饰**：`.aeris-product-window` 左上角放置 3 个无交互意义的灰色圆形 `.preview-dots`（Hallmark Gate `47a` 明确禁止）。
4. **重复的功能展示墙**：在实时预览窗演示了 4 个模块后，紧接着 `#publicBentoWall` 又以 `01 · 语言学习` 至 `05 · 统一账户与同步` 的数字标号 Bento 卡片把同样的 4 个模块再介绍一遍，缺乏真实页面叙事节奏。

### 2.2 登录后首页（`i10-auth-home-hud-1440-light.png` / `before-auth-home-390.png`）
1. **结构极度重复（4 重叠印）**：
   - 第 1 遍：问候栏右侧 3 个动作按钮（其中 `进入空间 →` 在已进入空间时语义错乱）；
   - 第 2 遍：`#homeV3SummaryGrid` 4 张带装饰性蓝色短进度条的摘要卡片；
   - 第 3 遍：`#workspaceBentoGrid` 6 张几乎等大的带英文大写眉题卡片（`LEARNING`、`FINANCE`、`TOOLS`、`TRANSFER`、`ACTIVITY`、`ACCOUNT`），每张都带圆角胶囊徽标和 `详情预览` + 主按钮；
   - 第 4 遍：屏幕下方 `.home-quick-access` 4 张快速访问卡 + `#homeProductDetails` 折叠卡又重复一遍。
2. **工作内容被淹没**：在 390px 移动端（`before-auth-home-390.png`），3 个全宽按钮加上 2×2 的摘要方块把整屏占满，用户向下滑一整屏才看到第一个真正的业务模块状态；真正有价值的「近期动态」、「未完成学习/待核实账单」、「常用工具快捷直达」反而被淹没在模板卡片里。

### 2.3 财务账本（`before-finance-1440.png` / `before-finance-390.png`）
1. **主次颠倒（账本页面看不到流水）**：1440×900 首屏被「同步状态框 → 3 个并排巨大币种下拉框 + 4 个汇总数字盒 → 巨大的 6 个月折线图」完全占满，核心交易流水表（`#financeRecordedSection`）甚至连第一行都看不见。
2. **移动端操作链路极长**：390×844 首屏出现「全宽绿框状态条 + 3 个垂直全宽操作按钮 + 同步卡片 + 全宽新增按钮 + 币种选择器」，操作台冗长松散。
3. **账本质感不足**：交易行仍呈独立带外框列表卡片，缺乏 Actual Budget 的紧凑账本表头对齐、金额与日期视觉锚点以及紧邻流水表的内联筛选条。

### 2.4 工具箱（`i10-tools-1440-light.png` / `before-tools-390.png`）
1. **首屏被非核心元素挤占**：在搜到或点到任何工具前，先出现 3 个页头按钮 + 搜索框 + 安全提示语 + 一整张「工具工作流」推广卡片；在 390px 移动端，首屏 844px 内连第一个工具都看不到，且页头标题区出现莫名右对齐偏斜。
2. **工具卡冗余与低密度**：104 个工具以带大蓝底图标方块的卡片矩阵展示，每张卡片底部都重复一遍当前分类名（例如 `文本处理工具箱` 重复出现 29 次），降低目录扫描效率。

### 2.5 其他模块（工作流 / 管理后台 / 语言学习 / 文件传输 / 账户中心）
1. **工作流（`before-workflows-1440.png`）**：顶栏外框冗余、返回按钮位置偏左孤立、右侧模板列表套多层边框卡片、步骤连线使用文本 `"↓"` 而非真实节点端口拓扑。
2. **管理后台（`before-admin-1440.png`）**：所有模块页头、4 个 KPI 框、搜索条都套用完全一致的卡片框；用户列表为一张张松散的独立圆角块，而非密集对齐的后台表格。
3. **语言学习（`before-language-1440.png`）**：语言选择页 Logo 靠左、标题靠右极度分裂；进入学习视图后又是一排带阴影卡片，缺少答题专注感。
4. **账户中心（`before-account-1440.png`）**：顶部两大块带大图标圆角的资料卡与下方「详细信息与权益」表格完全重复展示同一份用户名、ID 与角色信息；`.section-kicker` 与中点标题（`我的账户 · 设置与偏好`）随处可见。
5. **文件传输（`before-transfer-1440.png`）**：配额进度条偏弱，参数折叠面板与拖拽区层次平淡，待传/已分享队列缺乏结构化文件表感。

---

## 3. 本轮结构性重构核心靶向清单

1. **移除全局模板症状**：清零全站 `100vw` 溢出、清除手绘红绿灯圆点、消除 `transition: all` / 弹簧弹跳 / 跑马灯无限动画、消除 `side-tab` 单边色条与全大写 tracked-caps 英文眉题。
2. **区分 Public（Persuade）与 Workspace（Operate）**：访客公开首页隐藏 `#v3Sidebar`，还原真正全宽产品展示舞台；登录后首页彻底去掉多遍重复卡片，重组为 Linear 风格「状态概览 + 可定制紧凑工作台列表 + 近期活动与待办流」。
3. **按业务重构核心三页**：
   - **登录后首页**：一屏内直达问候、核心业务实时数值、近期活动流与可排序/隐藏的 6 模块紧凑工作台；
   - **财务账本**：Actual Budget 式紧凑顶部工具条 + 流水表首屏前置 + 右侧/折叠预算分类面板 + 可收起趋势图；
   - **工具箱**：Raycast/IT-Tools 式搜索栏 + 内联工作流跳转 + 左侧紧凑单行分类栏 + 高密度去重工具目录。
4. **全站模块差异化收敛**：工作流（真实节点端口拓扑与分栏检视）、管理后台（密集后台表格与清晰操作确认）、语言学习（对齐专注的语言选择与沉浸答题）、文件传输与账户安全中心（去重资料摘要与清晰设置分组）。
