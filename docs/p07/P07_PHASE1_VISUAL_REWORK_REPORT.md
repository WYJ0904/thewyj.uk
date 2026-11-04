# Aeris V6.2 — P07 第一阶段视觉重构补正与接管交付报告

- **交付状态**：`P07_PHASE1_VISUAL_REWORK_READY_FOR_REVIEW`
- **接管与收敛分支**：`codex/aeris-p07-phase1-handover`（独立工作树 `%USERPROFILE%\.codex\worktrees\aeris-p07-phase1-handover\thewyj.uk`）
- **基线继承说明**：Argon 原始工作树（`%USERPROFILE%\.codex\worktrees\aeris-p07-phase1-visual-rework\thewyj.uk`）与提交 `01fa730` 100% 完整保留未破坏；交接工作树从 `01fa730` 派生并安全集成 Codex P2 修复。
- **核心代码与测试提交**：
  - `01fa730bf587a54863f83f99ab5b005716e10e15`（Argon 首页视觉、三卡浅底色、侧栏工作台、统一壳层）
  - `7814a567ebd304a55e3bacb4dc9e393cd482d4a0`（集成 Codex P2 键盘重叠焦点可见性修复与测试缺口补齐）
  - `18b3314a6839473b47d0916f205c3e2847eb1332`（部署网络重试鲁棒性增强）
  - `e817bb121185fd1cb72e751a29c4ffbae5a91258`（登录等待条件作用域校准，当前部署 HEAD）
- **关联 Pull Request**：Draft PR（创建后见 GitHub PR 记录）（Draft，未合并）
- **新隔离 Hosted Preview（本次最终交付）**：
  - 部署固定地址：https://d1d88d67.thewyj-p07-ui-rc.pages.dev
  - 分支别名地址：https://v62-p07-phase1-rework.thewyj-p07-ui-rc.pages.dev
  - Deployment ID：`d1d88d67-72e6-4011-af43-95276057ac6c`（Pages 项目 `thewyj-p07-ui-rc`，分支 `v62-p07-phase1-rework`）
  - 校验结果：87 个公开静态资源 SHA-256 100% 匹配 Git blob，`p07Ui: "enabled"`
- **旧隔离 Hosted Preview（PR #119 对照组，完整保留未覆盖）**：
  - 对照地址：https://43c6cb67.thewyj-p07-ui-rc.pages.dev （HTTP `200` 在线可对比）
- **特性开关与生产隔离**：继续受 Task25 `p07_accessibility` 门控；回退开关关闭时 `100%` 恢复旧版公开首页与登录流；正式生产站 `https://thewyj.uk`、正式 D1/R2、PR #111、PR #112、PR #118、PR #119 均零改动。

---

## 一、实际读取的设计参考与开源资源核实清单

### 1.1 设计参考图读取核实（诚实披露）

| 资源项 | 核实状态 | 实际读取与使用说明 |
| --- | --- | --- |
| 所有者上传 V3 首页概念参考图 | **已实际读取并逐区还原** | 已直接读取会话上传的高清 V3 视觉参考图（对应 V3 首页「左侧统一导航栏 + 顶栏状态 + 主标题层级 + 右侧三张业务浅底色水平扇形悬浮卡片 + 底部四列摘要卡片 + 蓝色进度条」完整结构）。 |
| PR #119 旧版 Preview 实机截图（Before） | **已实际读取并逐项比对** | 已直接读取 `docs/p07/evidence/phase1-argon/preview/preview-live-home-1440.png` 及 `docs/p07/evidence/phase1-argon/after/*.png`，定位出首轮被判定为「仅在旧首页微调 CSS」的全部结构差异。 |
| 本地独立目录 `v3_layout/01-首页-三悬浮卡片.png`、`00-全站设计索引.png`、`11-登录与注册.png` | **本地磁盘不存在该独立目录（诚实说明）** | 已检索主工作区与各隔离工作树，本地未存放名义为 `v3_layout/*.png` 的独立文件包；全站色彩体系、导航壳层与 `/login` 页面严格按已读取的 V3 主参考图同一套设计语言（`#f4f6f9` 画布、`#ffffff` 纯白 L 型壳层与圆角卡片、`#2563eb` 皇家蓝主操作、业务浅底色语义 Token）完成统一重构。 |

### 1.2 路线图指定开源设计资源读取与应用清单

| 开源仓库 | 实际读取的核心文档 | 本次实际采用的工程与视觉方法 | 明确未采用的部分及原因 |
| --- | --- | --- | --- |
| `elayadesign/redesign-skill` | `SKILL.md`、`references/redesign-existing-projects.md` | 1. 全站壳层与 Token 统一（消除启动屏 `#edf2f4`、工作区 `#f3f2ef`、主页 `#f4f6f9` 三套底色割裂）；<br>2. 在不破坏既有 DOM ID / 路由 / 状态机契约的前提下升级桌面端 App-Shell 布局；<br>3. 清理首屏顶部双横幅堆叠干扰。 | 未引入 Tailwind / 新构建链或整站重写模板，保持仓库原生零打包 ES Modules + CSS Custom Properties 架构。 |
| `elayadesign/ai-design-skills` | `skills/landing-page-design/SKILL.md` | 1. 重建首屏视觉焦点层级（眉标 → `不只是一个网页。` 大字号主标题 → 次级副标题 → `#2563eb` 实心主 CTA）；<br>2. 右侧三卡采用业务浅底色分区 + 底部四列等宽业务摘要卡片，消除通用白卡堆砌感。 | 未使用虚构营销数字、虚假用户评价或不存在的功能模块入口。 |
| `emilkowalski/skills` | `skills/emil-design-eng/SKILL.md`、`references/animation-performance.md`、`references/mobile-native.md` | 1. 严格维持 `.hero-scene-card`（坐标/旋转层）与 `.home-widget-visual`（阴影/微抬升/缩放层）分离；<br>2. 底部摘要进度条改用合成器友好的 `transform: scaleX(var(--v3-bar-scale))` 替代 `width` 动画并彻底满足 `style-src 'self'` CSP；<br>3. 曲线统一为 `cubic-bezier(0.23, 1, 0.32, 1)`，所有可点击控件保持 `>= 44px` 触控热区，移动端折叠左侧栏并紧凑排布首屏。 | 未使用无限循环悬浮动画或高开销大面积动态模糊特效，兼顾桌面与低功耗移动设备帧率。 |

---

## 二、V3 参考图 vs 旧 Preview (`43c6cb67`) vs 本次补正逐项对比

详细前置对比与设计方案见 `docs/p07/P07_PHASE1_V3_VISUAL_DIFF_AND_PLAN.md`，核心落地变更汇总如下：

| 维度 | 旧版 PR #119 (`43c6cb67`) 问题 | V3 参考图目标 | 本次补正实际落地结果 |
| --- | --- | --- | --- |
| **桌面整体框架** | 仍为旧版无侧栏单栏着陆页，视觉接近旧首页微调 | **顶栏 + 左侧 `204px` 纯白导航栏 + 右侧浅灰蓝主工作区画布** | 新增 `.v3-app-frame`（桌面 `>= 981px` 为 `204px` 固定纯白 `#v3Sidebar` + 右侧 `#f4f6f9` 主画布，顶栏与侧栏无缝构成纯白 L 型工作台框架）。 |
| **导航真实性与权限** | 顶栏内联胶囊链接，缺少左侧空间导航 | 左侧清晰罗列空间模块，当前项蓝点 + 浅蓝胶囊高亮 | 左侧栏仅挂载真实存在的路由（`首页 / 学习 / 免费试用 / 财务 / 工具箱 / 工作流 / 文件 / 会员 / 账户`）；`管理后台` 严格绑定 `account && isAdmin(account)`，游客与普通用户完全隐藏；`/login` 与 `/register` 不误标 `首页` 高亮。 |
| **首屏主文案层级** | 左侧仍是旧版大号 `Aeris` 文本标题 | `把学习、工具与生活放在同一个空间` + `不只是一个网页。` + `而是为你自由排列的数字空间。` + `探索 Aeris →` | 完整还原 V3 四层文案排版与字重对比，1440px / 1920px 下首屏三枚操作按钮（`探索 Aeris →` / `继续学习` / `下载 Android`）单行稳健对齐，同时保留 `#publicHomeTitle` 与 `.home-purpose` 无障碍及测试契约。 |
| **三张悬浮空间卡片** | 三张纯白卡片偏窄纵向堆叠，缺少业务色彩区分与拖动提示 | **学习（极浅蓝）/ 财务（极浅薄荷绿）/ 工具（极浅淡紫）水平错落扇形排布**，含 `⠿ 可拖动` 与 `移动 / 缩放 / 旋转` 胶囊 | 新增 `--ds-card-learning-*` (`#eff6ff`/`#cfe2ff`)、`--ds-card-finance-*` (`#eefaf3`/`#ccebd7`)、`--ds-card-tools-*` (`#f5f0ff`/`#dfd2fe`) 及深色语义色；桌面默认采用 `x: 0.02 / 0.50 / 0.98`、`y: 0.26 / 0.80 / 0.06` 水平错落扇形，三卡间距清晰不遮挡右上角控件，内置 `⠿ 可拖动` 与底部 `移动 / 缩放 / 旋转` 提示胶囊。 |
| **底部四列工作区摘要** | 下方为旧版双栏快速访问列表 | **四列等宽纯白圆角摘要卡片**（`最近学习`、`本月账本`、`最近文件`、`快捷工具`）+ 蓝色进度条 | 新增 `#homeV3SummaryGrid` 四列响应式网格，未登录展示真实可点击试用/能力说明，已登录实时绑定账户错题/学习进度、账本同步状态、传输队列与最近工具，绝不伪造个人数据。 |
| **横幅干扰降噪** | 顶部连续堆叠 Preview 横幅 + 全宽版本更新横幅，把首屏往下顶 | 首屏干净聚焦，无全宽横幅压迫 | `#aerisPreviewNotice` 收敛为紧凑单行胶囊（本地隐藏，`*.pages.dev` 显示）；`#versionNotice` 在桌面端改为右下角非阻塞悬浮卡片，移动端改为页面底部流式卡片（`order: 99`），绝不遮挡首屏或悬浮卡片。 |
| **全站色彩与加载/恢复闭环** | `#entryScreen` 旧青灰底、`#sessionRecovery` 纯裸文字、工作区暖米色 `#f3f2ef` 割裂 | 从首屏 HTML 加载 → 会话恢复 → 首页 → 登录页全链路同一套色彩与卡片语言 | `<meta name="theme-color" content="#f4f6f9">`、`--ds-workspace-canvas` / `--ds-workspace-canvas-warm` / `--ds-stage` 全部统一为浅色 `#f4f6f9` / 深色 `#0f1217`；`#entryScreen` 与 `#sessionRecovery` 统一为居中纯白圆角卡片 + 真实 Aeris 图标 + `#2563eb` 进度条；排查并修复 `requestBackendStatus()` 离线/4xx 重试等待，异常态提供 `重试连接` 与 `返回公开首页` 双出口。 |

---

## 三、Codex P2 修复接入与测试缺口补齐

### 3.1 P07-IQA-001 — 键盘焦点卡片置顶修复

- **问题现象**：在自定义卡片重叠布局中，键盘用户使用 Tab 聚焦到被遮挡的卡片时，未同步更新 `z-index` 层级，导致获得焦点的卡片主内容仍被上方卡片遮挡。
- **实施修复**：在 `js/core/home-widgets.js` 中新增 `focusin` 事件监听 `onCardFocus`，当卡片内元素获得焦点且非交互拖拽中时，自动调用 `syncZOrder(card.dataset.homeWidget)` 同步提升层级至顶层；并在 `dispose` 中完整解绑。
- **验证结果**：
  - 自动化回归 `qa/p07-phase1/independent-browser-gaps.mjs` 中的 `keyboard-overlap-focus-visible`：**PASS**（三张卡片各自聚焦时均命中自身、可见且 `focusVisible: true`，`z-index: 3`，且焦点切换不触发多余持久化写入）。
  - 双真实账户独立 D1 布局隔离用例 `two-real-accounts-layout-isolation`：**PASS**（两账户互不泄露，登出不留 guest 污染）。
  - 手机端触控编辑与滑动用例 `mobile-touch-editor-scroll-pinch-restore`：**PASS**（真实触控输入、滑块角度调节与取消恢复）。

---

## 四、真实 Chromium 截图证据矩阵

所有截图均由真实 Chromium 在启用 `p07_accessibility` 的真实运行时下采集：

| 必交场景类别 | 旧版对照（Before · PR #119） | 本次补正本地实测截图（After） | 新隔离 Hosted Preview 实测截图 |
| --- | --- | --- | --- |
| **1. 桌面 `1440px` 首页** | `docs/p07/evidence/phase1-argon/after/after-home-desktop-1440-light.png` | `docs/p07/evidence/phase1-rework/after/after-home-desktop-1440-light.png`<br>`docs/p07/evidence/phase1-rework/after/after-home-authenticated-1440.png` | `docs/p07/evidence/phase1-rework/preview/preview-live-home-1440.png` |
| **2. 桌面 `1920px` 首页** | `docs/p07/evidence/phase1-argon/after/after-home-1920-light.png` | `docs/p07/evidence/phase1-rework/after/after-home-1920-light.png` | — |
| **3. 手机 `390px`（首页 & 登录）** | `docs/p07/evidence/phase1-argon/after/after-home-mobile-390-light.png` | `docs/p07/evidence/phase1-rework/after/after-home-mobile-390-light.png`<br>`docs/p07/evidence/phase1-rework/after/after-login-mobile-390-light.png` | `docs/p07/evidence/phase1-rework/preview/preview-live-home-390.png` |
| **4. 手机 `412px`（首页 & 登录）** | `docs/p07/evidence/phase1-argon/after/after-home-420-light.png` | `docs/p07/evidence/phase1-rework/after/after-home-mobile-412-light.png`<br>`docs/p07/evidence/phase1-rework/after/after-login-mobile-412-light.png` | — |
| **5. 登录页 `/login` & `/register`** | `docs/p07/evidence/phase1-argon/after/after-login-desktop-1440-light.png` | `docs/p07/evidence/phase1-rework/after/after-login-desktop-1440-light.png`<br>`docs/p07/evidence/phase1-rework/after/after-register-desktop-1440-light.png` | `docs/p07/evidence/phase1-rework/preview/preview-live-login-1440.png` |
| **6. 深色主题（桌面/手机/登录）** | `docs/p07/evidence/phase1-argon/after/after-home-desktop-1440-dark.png` | `docs/p07/evidence/phase1-rework/after/after-home-desktop-1440-dark.png`<br>`docs/p07/evidence/phase1-rework/after/after-home-mobile-390-dark.png`<br>`docs/p07/evidence/phase1-rework/after/after-login-desktop-1440-dark.png` | — |
| **7. 三卡编辑、拖拽与自定义布局态** | `docs/p07/evidence/phase1-argon/after/after-home-dragging-1440.png` | `docs/p07/evidence/phase1-rework/after/after-home-editing-1440-light.png`<br>`docs/p07/evidence/phase1-rework/after/after-home-dragging-1440.png`<br>`docs/p07/evidence/phase1-rework/after/after-home-custom-layout-1440.png` | — |
| **8. 页面加载态、离线恢复态与表单错误态** | — | `docs/p07/evidence/phase1-rework/after/after-loading-splash-1440.png`<br>`docs/p07/evidence/phase1-rework/after/after-loading-session-recovery-1440.png`<br>`docs/p07/evidence/phase1-rework/after/after-error-session-recovery-1440.png`<br>`docs/p07/evidence/phase1-rework/after/after-error-login-1440.png` | — |
| **9. 键盘重叠焦点置顶证据** | `docs/p07/evidence/phase1-independent/before-keyboard-learning.png` | `docs/p07/evidence/phase1-rework/keyboard-overlap-learning.png`<br>`docs/p07/evidence/phase1-rework/keyboard-overlap-finance.png`<br>`docs/p07/evidence/phase1-rework/keyboard-overlap-tools.png` | — |
| **回退证明（`p07_accessibility` OFF）** | `docs/p07/evidence/phase1-argon/after/after-home-flag-off-fallback-1440.png` | `docs/p07/evidence/phase1-rework/after/after-home-flag-off-fallback-1440.png` | — |

---

## 五、全量测试结果分类与诚实披露

根据命令要求，准确区分 **PASS**、**FAIL**、**ENV_FAIL**、**NOT_TESTED**：

### 5.1 自动化全量通过项（PASS）

1. **三卡空间交互回归（`qa/aeris/home-widgets-browser.mjs`）**：**PASS**
2. **P07 Phase 1 综合浏览器验收（`qa/p07-phase1/phase1-browser-verify.mjs`）**：**6/6 PASS**
3. **Codex P2 修复与缺口测试（`qa/p07-phase1/independent-browser-gaps.mjs`）**：**3/3 PASS**
4. **真实 Chromium 原生页面缩放（`Chromium HostZoomMap 100%/200%/400%`）**：**12/12 PASS**
5. **公开 UI Policy 契约测试（`qa/p07-phase1/public-ui-policy.test.mjs`）**：**36/36 PASS**
6. **Pages Staging 与安全防泄露（`scripts/test_stage_pages_deploy.mjs`）**：**28/28 PASS**
7. **Pages 发布资产审计（`qa/aeris-release/ci-pages-build.mjs`）**：**147 audited files PASS**
8. **Python 静态与全量单元测试（`local-backend/test_*.py`）**：**186/186 PASS**（含 `test_static.py` 31/31）
9. **仓库整洁度与跨平台路径审计（`scripts/repository_audit.py`）**：**988 files PASS**
10. **全站功能与路由守卫门禁（`scripts/functional_audit_gate.py`）**：**23 routes, 24 app flows, 104 tools PASS**
11. **Android 发布版本与资产一致性（`scripts/check_android_release_consistency.py`）**：**36/36 PASS**
12. **Hosted Preview 87 个公开静态资源 SHA-256 在线校验**：**87/87 PASS**

### 5.2 业务浏览器矩阵（`local-backend/test_app_browser.mjs` 状态细化）

- **PASS（12 组）**：启动与匿名导航、受限匿名试用、注册登录、已登录首页连续性、学习同步/第二设备更新、私有反馈、离线会话恢复、工具与直达路由守卫/套餐、微信及支付宝测试订单刷新恢复、单词导入导出清空、免费上限/空答案/跳过、错题搜索/JSON/PDF/离线复习。
- **ENV_FAIL（1 组，环境依赖缺口，未伪造 PASS）**：第 13 组 `mobile language question state and rejudge scenarios A-H`。在隔离环境（`WORKERS_AI_ENABLED=false` 且无外部 AI 绑定）下，因测试词在本地词典无预设规则，`/api/judge` 返回 503（`ai_unavailable`）。系统严格遵守 fail-closed 安全原则，此环境失败真实保留，未修改预期掩盖。
- **NOT_TESTED（11 组）**：后续英语听写、日语语法解析、管理员权益完整表单、财务 CRUD/预算/重连（生产财务 AI OFF）、管理员会话与密钥、投票、全会员工具/AI词汇、账户删除、移动启动/Reduced Motion、native tab 与后台会话导航。
- **NOT_TESTED（物理硬件与生产）**：
  - 物理手机真机（Samsung / iOS）真实手势与系统原生控件；
  - 真实读屏器（NVDA / VoiceOver）实机播报；
  - 生产正式数据库（D1 / R2）、正式支付、正式域名 `https://thewyj.uk`。

---

## 六、安全边界核验与待所有者二次视觉验收事项

- **未触碰生产与受保护分支**：正式站 `https://thewyj.uk` 零部署、正式 D1/R2 零迁移、零 AI 调用、零密钥读取；PR #119 原 Preview `https://43c6cb67.thewyj-p07-ui-rc.pages.dev` 保持 HTTP `200` 未被覆盖，可直接与新 Preview `https://d1d88d67.thewyj-p07-ui-rc.pages.dev` 左右并排对比。
- **范围严格收敛在 P07 第一阶段**：仅重构共享导航壳层、`/` 首页 V3 工作空间、三卡视觉呈现、`/login` 登录注册样板、加载/恢复态以及接入 Codex P2 键盘焦点修复，未提前改动 P07 第二阶段内部业务子页或 Task27–52。
- **下一步等待所有者操作**：请直接打开新隔离 Preview（https://d1d88d67.thewyj-p07-ui-rc.pages.dev）与旧版 Preview（https://43c6cb67.thewyj-p07-ui-rc.pages.dev）进行二次浏览器视觉对比验收。

最终状态：`P07_PHASE1_VISUAL_REWORK_READY_FOR_REVIEW`
