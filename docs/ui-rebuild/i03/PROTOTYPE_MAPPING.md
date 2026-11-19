# 原型、V1.1 基线、I07 接口与真实源码对应关系

> [!NOTE]
> 本地参考目录存在权威文档 `Aeris_I_series_UI_refactor_execution_baseline_v1.1_2026-11-17.txt`；参考文件名 `Aeris_I_series_UI_interactive_prototype_2026-11-17.html` 在本地磁盘与仓库中均不存在（与 I02 / I07 交接文档记录一致），因此本映射严格依据 V1.1 正式执行基线与真实 Aeris 源码契约建立。

| V1.1 目标元素 | 真实 Aeris 源码 / 选择器 | 消费的 I07 共享能力 | 保留的既有业务/状态契约 |
|---|---|---|---|
| 真实 Logo + 简洁标题 + 高对比主 CTA | `index.html` `#publicHome .home-brand` / `#publicHomeTitle` / `#publicLoginBtn` | 按压缩放与焦点管理（`installMotionSystem`）、浅 `#111113`/深 `#F8FAFC` 主按钮令牌 | `renderHomeSessionUi()` 区分游客「探索 Aeris →」与已登录「进入空间 →」及 `#publicRegisterBtn` / `#publicDownloadBtn` |
| 彻底替换旧 3 张倾斜浮卡与波浪背景 | 移除 `.hero-scene-card` / `.home-widget-workspace` / `#homeWidgetEditor` 与波浪层；Hero 固定 `opacity: 1` | 样式分层收口至 `public-experience.css` 与 `spatial-experience.css`（零多余 `!important`） | `js/core/home-widget-layout.js` 与 `aerisHomeWidgets:v2:*` 存储键完整保留给 I04；`js/core/home-widgets.js` 无旧卡节点时安全空操作 |
| 单个真实交互预览窗 + 120–150ms 骨架过渡 | `#publicPreviewScrollWrap > #publicCapabilityGallery`（`.preview-shell` / `.preview-toolbar` / `.preview-body` `min-height: 356px`） | `createTabSkeletonSwitcher`（`MOTION.skeleton=140ms` + `AbortSignal`）+ `.seg-indicator` + `computeMultiStageScroll3d` | `initPublicExperience()` 本机语言一题、JSON 格式化与字符统计（保留 `#publicTextInput` DOM 身份）、结余试算、本地文件清单（零虚构上传） |
| 无缝 12 列 Bento 拼接墙 + 仅内部视差 | `#publicBentoWall.apple-bento-wall > .bento-tile > .tile-inner[data-parallax-speed]` | `createScrollProgressController`（外框 `gap: 0`、`transform: none`，仅 `.tile-inner` 移动） | 5 个真实模块跳转入口（`data-site-nav` + `data-public-capability`） |
| `/trial` 紧凑型工具切换与工作台 | `#trialPage .trial-tool-tabs.ds-segmented` | `.seg-indicator` 药丸指示条 + 方向键无障碍切换 + `<select>` 右边距修复 | `TRIAL_MAX_QUESTIONS=10`、`TRIAL_MAX_TEXT_CHARS=200000`、12MB/20MP 单图本地处理契约 |
| `/download` 清晰层级与校验值 | `#downloadPage #downloadStatusBadge` / `#downloadCard` / `#downloadSha` | `showToast` / 语义 状态徽章（`success`/`warning`/`error`） | `js/core/download.js` 读取 `/api/app/config`，`#downloadMainBtn` 指向 `/api/app/download` |
| `/changelog` 版本记录与诚实状态 | `#changelogPage #changelogList` | `tabular-nums` 对齐与骨架加载状态 | `WYJ_CHANGELOG` + `/api/changelog` `mergeChangelogEntries()` |
| `/login` 与 `/register` 极简卡片 | `#authPanel #loginForm` / `#registerForm` / `.auth-tabs` | `.seg-indicator` + `--ds-brand-hover` 达标对比度 | 完整保留 `#usernameInput`、`#secretInput`、`#register*` 与 Task 27 条款勾选校验 |
