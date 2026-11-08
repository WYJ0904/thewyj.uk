# Aeris V6.2 — P07 第一阶段（Argon）实施与独立 Preview 验收报告

- **报告日期**：2026-11-04
- **执行阶段**：Aeris V6.2 P07 Phase 1（全站设计系统基础、首页 `/` 视觉重构、三张悬浮卡片空间交互升级、共享顶栏与 `/login` 样板统一、独立 Hosted Preview 部署验证）
- **阶段结论**：`P07_PHASE1_READY_FOR_OWNER_REVIEW`

---

## 1. 基线 `main` SHA

- **起始稳定 `main` SHA**：`3eb268b748a6e7a1aaa7369059db474810bb59d4`（PR #110 合并后稳定主干）
- **其他并行工作区保护核查**：
  - 主工作区 `%USERPROFILE%\Desktop\编程\thewyj.uk`（分支 `codex/android-accessibility-accounting-hotfix`）：只读核查，未作任何修改，未读取任何根级私密口令文件。
  - 财务工作树 `%USERPROFILE%\.codex\worktrees\finance-release-convergence\thewyj.uk`（PR #112）：保持原状，未合并、未改动。
  - 历史 P07 参考工作树 `%USERPROFILE%\.codex\worktrees\aeris-p07-quality-release\thewyj.uk`（PR #117）：仅只读对照参考，未改动。

---

## 2. 本阶段独立分支与 Worktree

- **独立 Worktree**：`%USERPROFILE%\.codex\worktrees\aeris-p07-phase1-argon\thewyj.uk`
- **独立开发分支**：`codex/aeris-p07-phase1-argon`（基于 `origin/main` `3eb268b748a6e7a1aaa7369059db474810bb59d4` 创建）
- **里程碑提交记录**：
  1. `fa1fbcd26b626420ca9430c952bf6b1b8b6a96bf` — `feat(p07-phase1): establish V3 design system tokens and Task25 preview policy`
  2. `29dc85453c2fbe5a81b7246bdba314996f541d88` — `feat(p07-phase1): implement V3 home layout and layered spatial 3-card interactions`
  3. `e37a0263cdc2e0f7e6299b1e63004aaf94fc5366` — `feat(p07-phase1): unify shared navigation and V3 login sample`
  4. `e377abff42b35b08b68b8885f33bc1f5af454583` — `test(p07-phase1): add spatial, accessibility, multi-viewport, and build audit evidence`（即本次 Hosted Preview 部署对应的精确构建 SHA）

---

## 3. 设计稿参考与优先级执行情况

本阶段严格遵循所有者确认的设计优先级：

1. **视觉主语言（最高优先级）**：采用用户确认的 **V3 设计系统与工作台视觉规范**——冷调浅灰画布（`#f4f6f9`）、纯白实体卡片（`#ffffff`）、低对比度清晰描边（`#e2e8f0` / `#cbd5e1`）、统一品牌蓝主按钮（`#2563eb`）、自然克制的多层柔和投影与清晰的留白层级，摒弃厚重深色背景块、大面积玻璃拟态光晕与虚构 SaaS 营销装饰。
2. **首页功能语义（核心保留）**：首页 `/` 完整保留原版 Aeris 真实产品结构——主视觉区（真实 Aeris 图标 + 标题 + 副标题 + 操作按钮）与右侧三张可自由交互的悬浮状态卡片（学习记录、本月账本、最近工具），下方保留快速访问、最近活动与产品说明卡片，不将公开首页改为登录后仪表盘，也不虚构“Pro Plan”等不存在的业务概念。
3. **品牌标识红线**：全站复用既有真实品牌资产 `assets/brand/aeris-lockup.png`、`icon-192.png`、`icon-512.png` 与 `favicon.ico`，未重新生成任何 AI 替代图标。
4. **范围边界**：严格限制在全站设计系统地基、首页 `/`、共享顶部导航栏 `#accountBar` 与 `/login` 登录/注册样板；未提前重做学习、工具箱、账本、文件传输、会员、设置、管理后台等 Phase 2+ 业务子页面，未启动 Task27–52。

---

## 4. 现有功能与路由兼容情况

经自动化测试与真实 Chromium 端到端路由巡检验证，全部既有路由与核心业务流保持零回归：

| 路由 / 能力 | 兼容验证结果 | 说明 |
| :--- | :--- | :--- |
| `/`（未登录公开首页） | PASS | V3 浅灰背景 + 纯白悬浮三卡 + 右上角“演示”徽标 + 快速访问/最近活动/产品详情 |
| `/`（已登录首页） | PASS | 自动隐藏“演示”标识与未登录引导条，展示账户真实学习/账本/工具摘要与个人布局 |
| `/login`（登录与注册切换） | PASS | 统一 V3 登录样板卡片，密码派生、挑战签名、会话恢复、注册口令等逻辑零改动 |
| `/learning`、`/tools`、`/finance`、`/transfer` | PASS | 导航可达、共享设计变量兼容，业务内部结构保持稳定留待 Phase 2+ |
| `/account`、`/membership`、`/settings`、`/admin`、`/changelog` | PASS | 路由切换、权限守卫、模态框焦点与对比度全部通过 |
| Task25 Feature Flags & Kill Switch | PASS | 通过 `GET /api/ui/features` 与 `p07_accessibility` 权威开关统一控制，无冲突新开关 |
| Android WebView / PWA 清单 | PASS | `manifest.webmanifest` 与 `index.html` 品牌元数据同步为 `Aeris` 与 `#f4f6f9` |

---

## 5. 设计 Token 变更摘要（P07-01A）

在 `design-system.css` 与 `spatial-experience.css` 中建立了统一的语义化 V3 设计变量体系（同时提供优雅深色模式映射）：

| 语义类别 | Token 名称 | 浅色模式（V3 标准） | 深色模式（自适应） | 用途说明 |
| :--- | :--- | :--- | :--- | :--- |
| 页面画布 | `--ds-canvas` / `--bg-page` | `#f4f6f9` | `#0f1217` | 全站统一冷浅灰背景，消除公开页与工作区割裂感 |
| 卡片表面 | `--ds-surface` / `--bg-card` | `#ffffff` | `#171c24` | 悬浮三卡、快速访问、登录卡片等纯白承载面 |
| 次级表面 | `--ds-surface-subtle` | `#f8fafc` | `#1d2430` | 分段控制器槽位、次级信息块背景 |
| 常规描边 | `--ds-border` | `#e2e8f0` | `rgba(148, 163, 184, 0.18)` | 1px 干净卡片边界 |
| 强调描边 | `--ds-border-strong` | `#cbd5e1` | `rgba(148, 163, 184, 0.30)` | 悬停态与输入框聚焦前边界 |
| 主文字 | `--ds-text-primary` | `#0f172a` | `#f1f5f9` | 标题、核心金额与主要正文 |
| 次级文字 | `--ds-text-secondary` | `#475569` | `#cbd5e1` | 副标题、说明文案（对比度 >= 7:1） |
| 辅助文字 | `--ds-text-muted` | `#64748b` | `#94a3b8` | 元信息与辅助标签（白底对比度 >= 4.7:1） |
| 禁用文字 | `--ds-text-disabled` | `#516072` | `#97a8bd` | 禁用按钮文字（浅色 `5.55:1` / 深色 `5.98:1`，满足严苛对比度门禁） |
| 品牌主色 | `--ds-brand` | `#2563eb` | `#6ea2ff` | 主操作按钮、激活态指示、键盘焦点环 |
| 状态语义色 | `--ds-success` / `--ds-warning` / `--ds-danger` | `#15803d` / `#b45309` / `#dc2626` | `#4ade80` / `#fbbf24` / `#f87171` | 成功、提醒、错误校验反馈 |
| 悬浮卡片阴影 | `--p07-card-shadow` | `0 12px 28px -12px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04)` | 深色低眩光分层投影 | 自然立体的卡片悬浮层次 |
| 拖拽抬起阴影 | `--p07-card-shadow-dragging` | `0 24px 48px -14px rgba(15,23,42,0.18), 0 6px 16px rgba(37,99,235,0.08)` | 深色抬起投影 | 拖拽中明确的空间高度反馈 |
| 排版与数字 | 字号与数字对齐 | `rem` 相对字号 + `tabular-nums` | 同左 | 支持 200% 字体缩放重排，账本金额与学习统计等宽对齐 |

---

## 6. 首页 `/` 结构与视觉变更对照（P07-01B）

| 检查维度 | 重构前基线（`3eb268b`）问题 | 第一阶段重构后（V3 实现） |
| :--- | :--- | :--- |
| 页面与顶栏色调 | 公开页 `#eef1f5` 渐变背景，登录页却跳变为暖灰 `#f3f2ef`，顶栏半透明灰底缺少清晰边界 | 全站统一 `#f4f6f9` 画布 + 纯白顶栏（`rgba(255,255,255,0.94)` + `1px` 底边），跨路由视觉完全连贯 |
| 主按钮色彩统一性 | 顶栏“注册”按钮与 Hero 主按钮受旧样式覆盖出现 `#1d4ed8` / 深色模式白底反色不一致 | 统一收敛为 `--ds-brand`（浅色 `#2563eb` 白字，对比度 `5.17:1`；深色 `#6ea2ff` 深字） |
| 未登录 vs 已登录区分 | 未登录访客查看悬浮三卡时，示例数据与真实个人数据边界不够直观 | 未登录状态下三张卡片右上角清晰显示胶囊型“演示”标识（桌面与 390px 移动端均完整不裁切），编辑布局时自动让位于拖拽手柄；已登录状态自动隐藏全部“演示”标识并展示真实账户摘要 |
| 下方功能区层级 | 快速访问、最近活动与产品说明之间缺少统一的卡片网格节奏 | 统一为 V3 纯白圆角卡片（`16px` 圆角、`1px` `#e2e8f0` 边框、统一内边距与图标徽章），层级一目了然 |
| 移动端首屏高度 | 390px 宽度下附加说明与桌面间距叠加容易令 `.public-hero` 超过 `1100px` | 针对 `<= 600px` 视口精细压缩纵向间距，认证态隐藏访客提示，首屏高度稳定控制在合理区间且零横向滚动 |
| Preview 环境提示 | 缺少面向验收者的环境隔离可视化提示 | 在 `*.pages.dev` 预览域名且 V3 激活时，展示简洁的 `#aerisPreviewNotice` 隔离提示横幅；正式域名默认不显示 |

---

## 7. 三张悬浮卡片空间交互升级与完整能力保留（P07-01C）

针对此前悬浮卡片外层定位与内层视觉状态耦合、悬停与拖拽过渡互相干扰的问题，本阶段实施了**严格的三层职责解耦**：

1. **外层空间权威层（`.hero-scene-card`）**：唯一持有 `left / top` 百分比坐标、`--card-rotate` 旋转角度、`--card-scale` 缩放比例与动态 `--card-z` 层级，不包含任何会干扰指针坐标解算的 hover 缩放过渡。
2. **中层视觉反馈层（`.home-widget-visual`）**：专职承载纯白卡片表面、圆角描边、静态/悬停/拖拽三态自然阴影过渡、轻微悬停抬升（`-2px`）以及释放后的平滑归位（`220ms cubic-bezier(0.22, 1, 0.36, 1)`）。
3. **内层真实内容与控制层（`.home-widget-main` + 控制手柄）**：承载卡片点击跳转、44×44px 无障碍触控目标、拖拽手柄、四角缩放手柄与旋转手柄。同时在 `design-system.css` 中消除了 `[data-widget-drag]:active` 的全局按钮按压缩放/透明度抖动，保证拖拽期间 GPU 合成层稳定。

**完整保留并增强的交互能力验证结果**：
- **点击导航**：未进入布局编辑态时，点击三张卡片分别准确进入 `/learning`、`/finance`、`/tools`。
- **自由拖拽 / 旋转 / 大小调整 / 恢复默认**：全部保留并通过 `qa/aeris/home-widgets-browser.mjs` 与 `phase1-browser-verify.mjs` 实测。
- **动态置顶（`zOrder`）**：点击或拖拽任一卡片（如 `learning`）立即将其提升至最高层级（实测 `learningZ: 3 > toolsZ: 1`），松手后保持新的叠放顺序且不跳回底层。
- **中途取消（`Escape` & `lostpointercapture`）**：拖拽过程中按下 `Escape` 或丢失指针捕获时，卡片立即精确回退至拖拽前坐标并安全退出拖拽态。
- **连续高强度手势稳定性**：自动化执行连续 **30 轮** 拖拽/缩放/旋转复合指针操作（耗时 `13589ms`），**30/30 轮全部通过**，坐标有限无 NaN、无漂移、无卡片飞出边界。
- **持久化与账户隔离**：未登录访客调整仅在当前会话预览生效（`localStorage` 写入次数 `0`，明确提示 `"演示布局仅在本次预览中生效。"`）；已登录用户按 `userId` 独立命名空间持久化，互不串号，关闭 Preview 开关后已保存布局数据完好无损。
- **移动端与减少动态效果适配**：窄屏自动切换为垂直流式槽位（支持上下顺序调整且不阻挡纵向滚动）；`prefers-reduced-motion: reduce` 下自动禁用倾斜与位移动画，保留清晰静态焦点反馈。

---

## 8. 共享顶部导航栏与 `/login` 登录样板变更（P07-01D）

- **共享顶栏 `#accountBar`**：桌面端整合真实 `icon-192.png` 品牌标识、主导航项（激活态淡蓝胶囊底色 `#eff6ff` + `#2563eb` 文本）、Android 下载与更新日志入口、全局搜索、亮暗主题切换以及登录/注册操作；移动端自动收敛为高对比度抽屉菜单按钮。
- **`/login` 登录/注册样板卡片（`#authPanel`）**：
  - 居中纯白卡片（最大宽度 `440px`），顶部采用 `80×80` 圆角浅灰底衬框承载真实 `assets/brand/aeris-lockup.png` 品牌标识。
  - 登录/注册切换采用干净的分段胶囊控制器（Segmented Tabs），在 `spatial-experience.css` 中显式抑制了 `.ds-tab-indicator` 底部横线，消除“胶囊背景 + 底部蓝线”双重叠加瑕疵。
  - 动态同步 `#authPanelTitle` 与 `#authSubtitle` 文案（切换至注册页时自动更新说明文案）。
  - 输入框统一为 `46px` 高度、`10px` 圆角、清晰聚焦外环，并定制了浏览器自动填充（`:-webkit-autofill`）浅色/深色背景覆盖，避免黄色/刺眼背景破坏视觉统一。
  - 严格保持原有挑战签名登录、PBKDF2/密钥派生、恢复码提示、错误码映射与会话存储逻辑**零改动**。

---

## 9. 新增与修改文件清单

### 9.1 核心前端视觉与交互（设计系统 / 首页 / 登录样板）
- `spatial-experience.css`（新增）：P07 第一阶段 V3 首页空间布局、三卡分层样式、统一顶栏、`/login` 样板卡片、深色模式与响应式规则。
- `design-system.css`（修改）：升级 V3 语义化色彩/阴影/排版 Token、达标禁用态对比度（`#516072` / `#97a8bd`）、焦点环、减少动态效果与高对比度适配，修正拖拽手柄 `:active` 合成抖动。
- `public-experience.css`、`workspace-experience.css`（修改）：与 V3 背景及顶栏变量对齐，保证回退态与启用态平滑衔接。
- `index.html`、`manifest.webmanifest`、`sw.js`（修改）：接入 `spatial-experience.css`、Aeris 真实品牌元数据、`#aerisPreviewNotice` 隔离预览提示条、三卡 `home-widget-visual` 结构分层与无障碍属性。
- `js/core/home-widgets.js`（修改）：实现三卡空间层与视觉层分离、动态 `zOrder` 置顶、`Escape` 与 `lostpointercapture` 取消恢复、访客会话内预览与已登录账户级持久化边界。
- `js/core/public-ui-policy.js`（新增）：前端读取与缓存 `GET /api/ui/features` 权威 UI 开关状态，控制 `html[data-p07-ui]` 属性与安全回退。
- `js/core/design-system.js`、`js/core/motion.js`、`js/core/ui.js`、`app.js`（修改）：键盘漫游焦点、模态框焦点陷阱、`#authSubtitle` 切换同步、Preview 横幅显隐及路由过渡协调。

### 9.2 后端边缘函数与前后端基础契约（沿用 PR #115/#117 安全基座）
- `functions/_lib/p07-ui-api.mjs`（新增）、`functions/api/[[path]].js`（修改）：提供只读 `GET /api/ui/features` 接口，基于 Task25 `p07_accessibility` 权威配置返回公开 UI 策略，不暴露任何敏感内部配置。
- `js/core/{api,changelog,config,dashboard,keyed-list,session}.js`、`js/finance/{app,candidates}.js`、`js/language/{achievements,history,mastery-journal,mastery,sync-adapter,wrong-book}.js`、`js/tools/{digest-worker,file,image,text}.js`、`js/transfer/app.js`、`tools.js`（修改）：复用 PR #117 经验证的无障碍语义标签、数值格式化与稳定状态辅助代码。

### 9.3 构建白名单、自动化测试与证据文档
- `scripts/stage_pages_deploy.mjs`、`qa/aeris-release/ci-pages-build.mjs`（修改）：将 `spatial-experience.css` 纳入严格白名单发布与 CI 字节一致性审计。
- `qa/aeris/home-widgets-browser.mjs`、`local-backend/test_app_browser.mjs`（修改）：补充 CDP 指针捕获拖拽左键状态与 `/api/ui/features` 本地 Python 后端白名单识别。
- `qa/p07-phase1/public-ui-policy.test.mjs`、`qa/p07-phase1/phase1-browser-verify.mjs`、`qa/p07-phase1/run-phase1-qa.mjs`、`qa/p07-phase1/deploy-and-verify-preview.mjs`（新增）：P07 第一阶段单元、真实浏览器多视口/无障碍/30轮手势/400%缩放及 Hosted Preview 自动部署校验套件。
- `docs/p07/P07_IMPLEMENTATION_READINESS.md`、`docs/p07/P07_PHASE1_ARGON_IMPLEMENTATION_REPORT.md`、`docs/p07/evidence/phase1-argon/**`（新增）：实施前审计、最终实施报告及完整截图与 JSON 证据集。

---

## 10. 复用 PR #115 / PR #117 代码与本阶段独立改进说明

- **审慎复用的工程资产**：
  - 复用 `functions/_lib/p07-ui-api.mjs` 与 `js/core/public-ui-policy.js` 的 Task25 `p07_accessibility` 公开策略读取机制，确保正式环境与 Preview 环境共享同一套权威 Feature Flag 与 Kill Switch，不制造冲突开关。
  - 复用 `js/core/design-system.js` 中的 ARIA 标签修补、Tab 键盘方向键漫游（Roving Tabindex）、模态框焦点陷阱（Focus Trap）及各业务模块的无障碍标签补丁。
- **摒弃与独立重做的部分（Argon Phase 1 核心升级）**：
  - 未直接照搬 PR #117 的旧视觉皮肤，而是严格按所有者最新确认的 V3 设计规范重写 `spatial-experience.css` 与 `design-system.css` Token，统一 `#f4f6f9` 画布、`#ffffff` 卡片与 `#2563eb` 主按钮。
  - 重构 `js/core/home-widgets.js` 与 DOM 层级，新增 `.home-widget-visual` 中间视觉层、动态 `zOrder` 置顶、`Escape` 拖拽取消以及拖拽手柄 `:active` 零抖动保护。
  - 修正 `/login` 分段 Tab 双重下划线问题、移动端首屏超高问题及禁用按钮对比度不足问题。

---

## 11. 自动化测试统计

所有测试均在当前工作树真实运行通过（零跳过掩盖、零修改业务断言造假）：

| 测试套件 / 命令 | 结果 | 统计详情 |
| :--- | :--- | :--- |
| `node --test qa/p07-phase1/public-ui-policy.test.mjs` | **PASS** | 36 / 36 通过（含公开 UI 开关开启、关闭、过期降级与异常容错） |
| `node local-backend/test_home_widgets_js.mjs` | **PASS** | 三卡坐标归一化、边界夹紧、缩放范围与账户存储隔离单测通过 |
| `node local-backend/test_motion_js.mjs` & `test_aeris_public_js.mjs` | **PASS** | 动效降级策略与公开页状态控制器单测通过 |
| `node local-backend/test_core_js.mjs` & `test_aeris_p5_js.mjs` | **PASS** | 核心路由/存储/会话/API 与懒加载控制器单测通过 |
| `python -m unittest local-backend/test_static.py` | **PASS** | 31 / 31 静态结构、CSP、资源引用与契约检查通过 |
| `node --test scripts/test_stage_pages_deploy.mjs` | **PASS** | 28 / 28 白名单构建、凭据扫描拦截、软链接防护测试通过 |
| `node qa/aeris-release/ci-pages-build.mjs` | **PASS** | 147 个发布文件逐字节 SHA-256 校验通过，零私有目录泄露 |
| `check_js_module_graph` / `check_storage_contract` / `audit_async_interactions` | **PASS** | 57 个 ES 模块无环、29 组存储键契约一致、284 个交互处理器零缺失加载反馈 |
| `npm run cf:check` | **PASS** | Cloudflare Pages Worker 编译检查零警告通过 |
| 核心 D1 / 业务集成回归（`task12`, `task13`, `task16`, `task17`, `aeris-state`, `task21-notification`, `task25`） | **PASS** | 登录会话、学习同步、文件传输、账本状态、通知取证、Task25 12 组 D1 门禁与 19 组向量全部通过 |
| `node qa/aeris/home-widgets-browser.mjs`（真实 Chromium） | **PASS** | 三卡指针拖拽、尺寸调整、账户切换隔离、响应式重排与点击跳转全部通过 |
| `node qa/p07-phase1/phase1-browser-verify.mjs`（真实 Chromium） | **PASS** | 5 / 5 大项全绿：V3 Token 实测、16 张多视口亮暗截图、动态 `zOrder` + `Escape` + 连续 30 轮手势、ARIA/对比度/200% 字号重排/Flag 关闭回退、已登录 11 路由巡检 |
| Chromium `HostZoomMap` 真实浏览器页面缩放校验 | **PASS** | `/` 与 `/login` 在 `100%`、`200%`、`400%` 真实浏览器缩放倍率下零横向滚动条溢出 |
| `local-backend/test_app_browser.mjs` 全站浏览器矩阵 | **PASS*** | 启动、匿名试用、注册登录 UI、已登录首页连续性、390px/1920px 布局、公开页与会员弹窗全元素对比度、学习同步、反馈弹窗、离线重连全部通过（*注：仅在读取合成支付二维码 PNG 时因本地最小 Fixture 未预置 R2 二维码对象而终止，属与 UI 无关的既有离线 Fixture 边界） |

---

## 12. 真实浏览器视觉截图清单与前后对照

全部 30 张真实 Chromium 渲染截图已归档于 `docs/p07/evidence/phase1-argon/`（所有关键截图均经过人工逐张检视确认无重叠、无裁切、无错位）：

- **重构前基线截图（`docs/p07/evidence/phase1-argon/baseline/`，6 张）**：
  - `before-home-desktop-1440-light.png` / `before-home-desktop-1440-dark.png` / `before-home-mobile-390-light.png`
  - `before-login-desktop-1440-light.png` / `before-login-desktop-1440-dark.png` / `before-login-mobile-390-light.png`
- **重构后本地全矩阵截图（`docs/p07/evidence/phase1-argon/after/`，21 张）**：
  - 首页多断点（浅色）：`after-home-375-light.png`、`after-home-mobile-390-light.png`、`after-home-420-light.png`、`after-home-768-light.png`、`after-home-1024-light.png`、`after-home-1366-light.png`、`after-home-desktop-1440-light.png`、`after-home-1920-light.png`
  - 首页深色模式：`after-home-desktop-1440-dark.png`、`after-home-mobile-390-dark.png`
  - 三卡交互与状态截图：`after-home-dragging-1440.png`（拖拽抬起态）、`after-home-custom-layout-1440.png`（自定义布局与旋转缩放态）、`after-home-authenticated-1440.png`（已登录隐藏演示徽标态）、`after-home-reduced-motion-1440.png`（减少动态效果态）、`after-home-flag-off-fallback-1440.png`（Flag 关闭安全回退旧版态）
  - 登录与注册样板多断点/亮暗截图：`after-login-375-light.png`、`after-login-mobile-390-light.png`、`after-login-768-light.png`、`after-login-desktop-1440-light.png`、`after-login-desktop-1440-dark.png`、`after-register-desktop-1440-light.png`
- **在线 Hosted Preview 实测截图（`docs/p07/evidence/phase1-argon/preview/`，3 张）**：
  - `preview-live-home-1440.png`、`preview-live-home-390.png`、`preview-live-login-1440.png`

---

## 13. 无障碍（Accessibility）验证结果

- **表单与语义关联**：全站 7 组核心动态输入控件（`wordInput`、`answerInput`、`currentSecretInput`、`newSecretInput`、`newSecretConfirmInput`、`deleteSecretInput`、`adminNewSecretInput`）均具备唯一显式关联标签，未绑定 Tab 面板数为 `0`（`brokenTabs: []`）。
- **颜色对比度（WCAG AA >= 4.5:1）**：
  - 主按钮（`#2563eb` 底 / `#ffffff` 字）：`5.17 : 1`（浅色）/ `5.17 : 1`（深色语义按钮）
  - 危险/错误语义状态：`5.50 : 1`（浅色）/ `9.43 : 1`（深色）
  - 禁用态按钮（如 `#submitRechargeBtn`）：将 `--ds-text-disabled` 从 `#64748b`（`4.23:1`）提升至浅色 `#516072`（`5.55 : 1`）与深色 `#97a8bd`（`5.98 : 1`），通过 `test_app_browser.mjs` 全控件对比度扫描。
- **字号放大与 400% 页面缩放**：
  - 200% 根字体放大跨越桌面与移动端 5 组视口组合均无横向溢出或按钮遮挡。
  - Chromium 原生 `HostZoomMap` `100%`、`200%`、`400%` 页面缩放下，`scrollWidth <= innerWidth` 恒成立（400% 下 `innerWidth = 354px`，`scrollWidth = 350px`）。
- **键盘与系统偏好适配**：支持 `:focus-visible` 高清晰度双层焦点环、Tab 键顺序漫游、模态框 `Escape` 关闭与焦点陷阱、`prefers-reduced-motion: reduce` 零位移过渡及 `forced-colors: active` 系统边框保留。

---

## 14. 性能与资源体积对比

### 14.1 关键前端资源体积对比（未压缩原始字节）

| 资源文件 | 基线 `3eb268b` (Bytes) | Phase 1 实现后 (Bytes) | 变化说明 |
| :--- | ---: | ---: | :--- |
| `design-system.css` | 25,135 | 33,955 | +8,820（补齐 V3 Token、深色映射、无障碍焦点与高对比度规则） |
| `public-experience.css` | 56,133 | 59,223 | +3,090（公开首页兼容性与过渡整理） |
| `workspace-experience.css` | 34,040 | 35,410 | +1,370（共享顶栏与工作区背景衔接） |
| `spatial-experience.css` | 0 | 21,453 | +21,453（新增独立 V3 首页空间布局、三卡分层与 `/login` 样板样式） |
| `styles.css` + `product-ui.css` | 166,449 | 166,449 | 0（未改动既有业务样式表） |
| `js/core/public-ui-policy.js` | 0 | 3,383 | +3,383（新增轻量级 Task25 UI 开关策略客户端） |
| `js/core/home-widgets.js` | 14,202 | 15,777 | +1,575（新增动态 `zOrder`、`Escape` 取消与分层控制） |
| `js/core/design-system.js` | 8,615 | 15,080 | +6,465（键盘焦点漫游、模态焦点陷阱与 ARIA 增强） |
| **全量允许发布包（147 文件）** | — | **总计经 `ci-pages-build` 审计** | 零第三方重型 UI 框架引入，纯原生 CSS + ES Modules |

### 14.2 运行时指标与客观边界说明
- **桌面 Chromium 本地与在线 Preview 实测**：首屏 First Contentful Paint (FCP) 约 `1792ms`（本地冷启动含 Worker 初始化），DOM 节点数 `3590`，本地与在线 Hosted Preview 浏览器控制台错误与未捕获异常均为 **`0`**。
- **动画与合成稳定性**：三卡拖拽仅更新空间层坐标与轻量级 `transform/box-shadow`，连续 30 轮复合手势平均每轮约 `453ms`（含断言等待），无布局抖动。
- **诚实边界声明**：以上性能与帧稳定性数据来自 Windows 桌面端 Headless Chromium 自动化实测与 Cloudflare Pages 在线验证；本阶段未连接物理 Android 真机采集 GPU 帧率曲线，不将桌面端测试等同于所有移动设备恒定 60fps。

---

## 15. 独立 Hosted Preview 部署信息与环境隔离证明

本阶段已通过 `qa/p07-phase1/deploy-and-verify-preview.mjs` 将精确提交 `e377abff42b35b08b68b8885f33bc1f5af454583` 部署至隔离的 Cloudflare Pages 预览项目，并完成在线字节校验与真实浏览器渲染取证（详见 `docs/p07/evidence/phase1-argon/preview/preview-deployment-proof.json`）：

- **独立单次部署 Preview URL（不可变快照）**：`https://43c6cb67.thewyj-p07-ui-rc.pages.dev`
- **独立分支 Preview 别名 URL**：`https://v62-p07-phase1-argon.thewyj-p07-ui-rc.pages.dev`
- **Cloudflare Pages 项目名**：`thewyj-p07-ui-rc`（独立于正式项目，未覆盖既有其他分支快照如 `ac8cec2c.thewyj-p07-ui-rc.pages.dev`）
- **Preview Deployment ID**：`43c6cb67-9e8a-4b99-b3f7-e1d8a81967fd`
- **对应精确 Git SHA**：`e377abff42b35b08b68b8885f33bc1f5af454583`
- **已在线验证入口**：
  - `https://43c6cb67.thewyj-p07-ui-rc.pages.dev/`（桌面 1440px 与移动 390px 均渲染 V3 浅灰背景 + 纯白悬浮三卡 + “演示”徽标 + 隔离 Preview 提示条，零控制台报错）
  - `https://43c6cb67.thewyj-p07-ui-rc.pages.dev/login`（渲染 V3 登录样板卡片与真实 Aeris Logo，零控制台报错）
  - `https://43c6cb67.thewyj-p07-ui-rc.pages.dev/api/ui/features`（返回 `enabled: true, flag_key: "p07_accessibility", revision: 17`）
- **环境安全与数据隔离证明**：
  1. **D1 数据库隔离**：仅绑定独立 Preview D1（`ee869f78-b54a-4018-bc99-871089ecb8cd`），未连接正式生产数据库，无任何私人真实账本、通知或账户数据，部署期间远程迁移执行次数为 `0`。
  2. **R2 与 AI 零绑定**：`r2BindingsCount = 0`，`aiBindingsCount = 0`，环境变量 `WORKERS_AI_ENABLED = "false"`，`LEGACY_API_FALLBACK_ENABLED = "false"`，AI 调用次数为 `0`。
  3. **白名单构建与防泄露验证**：仅从已提交 Git 对象树提取通过 `stage_pages_deploy.mjs` 审核的 `147` 个文件；在线对全部 `87` 个公开静态资源逐一完成 HTTP 200 + SHA-256 哈希比对（`87/87` 完全一致）；对 `package.json`、`.git/config`、`wrangler.jsonc`、`docs/p07/P07_IMPLEMENTATION_READINESS.md` 在线探测均仅返回 SPA 外壳 HTML，无任何源码工程配置或文档泄露。
  4. **Production 零改动**：正式站点 `thewyj.uk`、Production D1/R2、正式 Android 签名与发布指针均保持 `0` 修改。

---

## 16. 尚存问题与已知边界

1. **后续业务页面尚未切换为 V3 工作台布局（符合分阶段指令）**：`/learning`、`/tools`、`/finance`、`/transfer`、`/membership`、`/settings`、`/admin` 等内部业务视图按本轮要求保持既有结构，仅共享基础 CSS 变量与顶部导航，留待所有者验收第一阶段后在 P07 第二阶段推进。
2. **本地全量浏览器脚本的离线二维码 Fixture 边界**：`local-backend/test_app_browser.mjs` 在最后一步请求支付收款码图片时，因本地临时 SQLite/R2 空 Fixture 未内置合成二维码 PNG 而停止；在此之前的首页、登录、对比度、学习同步、反馈弹窗及离线恢复检查均已通过。
3. **财务 PR #112 与错题复习 PR #111 仍保持独立 Draft**：按全局门禁要求，本阶段未合并 PR #111 / PR #112，也未启用 P05 自动入账或 P06 生产财务 AI。

---

## 17. 旧版视觉安全回退方案

本阶段具备双层即时无损回退能力：

1. **Task25 权威开关秒级回退（无需重新发版）**：
   - 新版 V3 视觉全部挂载在 `html[data-p07-ui="enabled"]` 作用域下，由 Task25 `p07_accessibility` Feature Flag 驱动（通过 `GET /api/ui/features` 下发，TTL 30 秒）。
   - 一旦在对应环境的 Task25 管理配置中将 `p07_accessibility` 设为关闭（或触发 Kill Switch），前端自动切换为 `data-p07-ui="disabled"`，立即恢复原有公开首页与登录视觉样式，且**完全保留用户已保存的三张悬浮卡片坐标、旋转与大小配置**（已在 `after-home-flag-off-fallback-1440.png` 实测验证）。
2. **代码与环境级物理隔离回退**：
   - 本阶段全部代码位于独立分支 `codex/aeris-p07-phase1-argon`（Draft PR）与独立预览项目 `thewyj-p07-ui-rc`（分支 `v62-p07-phase1-argon`），正式环境 `main` 与 `thewyj.uk` 尚未合入任何变更，天然处于零风险状态。

---

## 18. 下一阶段（P07 Phase 2）实施建议

在所有者通过浏览器体验本次 Hosted Preview 并确认第一阶段首页、三卡手感、色彩层级与登录样板满意后，建议按以下顺序启动 **P07 第二阶段**：

1. **统一工作台壳层（Sidebar + Top Header）落地**：将已验证的 V3 纯白侧边栏 + 浅灰内容画布规范推广至登录后的核心工作区（学习、工具箱、账本、文件传输）。
2. **账本与数据可视化升级**：在保持 PR #112 财务安全边界的前提下，引入简洁清晰的收支趋势图、分类占比与等宽金额表格视觉优化。
3. **学习与工具箱子页面卡片标准化**：复用第一阶段已沉淀的按钮、分段 Tab、表单域与空状态组件，逐页消除旧版内联样式差异。

---

**当前阶段交付状态**：`P07_PHASE1_READY_FOR_OWNER_REVIEW`
