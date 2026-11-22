# I03 六个公开页面架构报告

## 1. 覆盖路由清单

| 路由 | 容器 ID | 关键重构点 | 业务数据 owner |
|---|---|---|---|
| `/` | `#publicHome` | Editorial Hero（真实 Logo、永久 `opacity: 1`）→ 单一真实交互预览窗（`#publicPreviewScrollWrap` / `#publicCapabilityGallery`）→ 无缝 12 列 Bento 墙（`#publicBentoWall`，5 个真实模块入口）→ 数据处理原则 → 实时套餐目录 → 底部下载/日志 CTA | `renderHomeSessionUi`、`dashboard.js`、`loadMembershipPlans()` |
| `/trial` | `#trialPage` | 5 卡臃肿网格替换为紧凑型 `.trial-tool-tabs.ds-segmented`（支持左右键/Home/End 导航），修复 `<select>` 右边距，保留单个工作台清晰展示 | `trialState` / `setTrialTool` / `processTrialImage` |
| `/download` | `#downloadPage` | 顶部新增诚实状态徽章 `#downloadStatusBadge`（正式版可下载 / 配置待完善 / 读取失败兜底），文件名自然断行，独立全宽等宽 `#downloadSha` 与可禁用状态 `#downloadCopyShaBtn` | `createAndroidDownloadController`（`/api/app/config`、`/api/app/download`） |
| `/changelog` | `#changelogPage` | 右侧正文两栏特性网格、时间/版本 `tabular-nums` 等宽字体、移动端单列重排与加载占位样式 | `changelog.js` + `staticChangelogEntries` + `/api/changelog` |
| `/login` & `/register` | `#authPanel` | 极简居中卡片与 Aeris Lockup Logo、高对比度 `.auth-tabs`、`46px` 输入控件、清晰隐私协议与错误提示区域 | `app.js` + Task 27 `security-center.js` |

## 2. 已登录首页连续性保护

- 未登录态（`#publicHome[data-session-mode="guest"]`）隐藏 `[data-home-personal]`、`#homeV3SummaryGrid`、`.home-workspace-overview` 与 `#homeProductDetails`，避免公开首屏混杂个人业务占位。
- 已登录态（`#publicHome[data-session-mode="authenticated"]`）复用同一 `#publicHome` 宿主（`window.__p33Home` 节点身份不变），自动显示个人身份胶囊、通知待核实计数、4 个真实摘要卡片（`#homeV3SummaryGrid`）、快速访问/最近活动与 `#homeProductDetails` 同步面板。

## 3. CSS 层级与 `P07 ON/OFF` 双态兼容

- 结构与现代布局规则统一写入随核心 Shell 始终加载的 `public-experience.css`；`P07 ON` 增强细节补充至 `spatial-experience.css`，未新增任何未声明 CSS 自定义属性，未增加 `!important` 规则。
- 在 `P07 OFF`（`p07_accessibility = 0`）下，公开首页与 5 项子路由保持零横向溢出、可点击与可读。
