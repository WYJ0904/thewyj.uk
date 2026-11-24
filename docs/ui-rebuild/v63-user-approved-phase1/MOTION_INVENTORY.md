# Aeris V6.3 Phase 1｜全站动效清单（Motion Inventory）

> 依据用户确认版设计规范第 8 题 C（丰富动效）与 Phase 1 专项整改 V2 建立。所有交互动效均以 `transform`、`opacity` 及明确受控的网格列宽过渡为核心，并遵循 `@media (prefers-reduced-motion: reduce)` 无闪烁/零位移降级。

---

## 1. 设计 Token 体系（`design-system.css`）

| Token | 数值 | 用途 |
|---|---|---|
| `--ds-duration-instant` | `80ms` | 按压瞬态反馈 |
| `--ds-duration-fast` | `140ms` | 悬停色彩/边界响应、分段胶囊切换 |
| `--ds-duration-normal` | `200ms` | 常规展开与标签淡入淡出 |
| `--ds-duration-page` | `240ms` | 页面视图切换入场 |
| `--ds-duration-sidebar` | `320ms` | 桌面侧边栏 `256px ↔ 64px` 折叠/展开与主画布重居中同步 |
| `--ds-duration-slow` | `260ms` | 移动抽屉背景遮罩渐显/渐隐 |
| `--ds-pressed-scale` | `0.96` | 弹性按压缩放 |
| `--ds-ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | 布局过渡、侧边栏、页面视图、弹窗与抽屉主弹簧曲线（无廉价抖动） |
| `--ds-ease-elastic` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 按钮/胶囊/图标微弹性微交互 |
| `--ds-ease-bounce-micro` | `cubic-bezier(0.34, 1.45, 0.64, 1)` | 控件触感微回弹 |
| `--ds-ease-decelerate` | `cubic-bezier(0.16, 1, 0.3, 1)` | 下拉浮层/遮罩收敛 |

---

## 2. 全站核心动效条目明细

| 组件 / 场景 | 整改前（Before）问题 | 预期目标效果 | 实际实现方案与文件位置 | 时长与曲线 | 连续打断 / Reduced Motion 行为 |
|---|---|---|---|---|---|
| **桌面侧边栏折叠 / 展开 (`#v3Sidebar` + `.v3-app-frame`)** | 1) 旧版对文字标签/身份区使用 `display: none` 导致第 0 帧瞬间消失；2) `#v3Sidebar` `overflow: visible` + 特异性覆盖导致折叠后“普通注册用户”文字溢出 64px 边界；3) 图标改为居中导致横向跳变；4) 无连续过渡感 | `256px ↔ 64px` 连续宽度过渡，主画布与首页启动台同步重居中；图标水平锁定零跳变；文字/分组标题柔和淡出且保留分组间距；底部头像自然切换且零溢出 | `spatial-experience.css`：`.v3-app-frame` 过渡 `grid-template-columns`、`#v3Sidebar.v3-sidebar` 同步过渡 `width` 与 `overflow-x: hidden`，`32px` 图标位在展开/折叠下保持固定 X 偏移，标签/身份信息用 `opacity` + `max-width` 过渡；`design-system.js` 监听 `transitionend` 重算指示条 | `320ms` `--ds-ease-spring`；标签淡隐 `180ms–220ms` | 原生 CSS transition 自动支持高频连续点击反向中断与恢复，无动画队列积压；`prefers-reduced-motion` 下瞬时完成无过渡 |
| **侧边栏折叠按钮图标 (`#sidebarCollapseBtn svg`)** | 无明显方向转换反馈 | 展开/折叠切换时旋转 `180deg` 指示方向翻转 | `spatial-experience.css`：`[data-collapsed="true"] .v3-sidebar-collapse-btn svg` 旋转 | `320ms` `--ds-ease-spring` | 高频连击平滑插值反转 |
| **侧边栏激活指示条 (`#v3SidebarIndicator`)** | 切换模块与折叠侧栏后指示条同步容易滞后或偏移 | 模块切换、状态变更、窗口缩放及侧栏宽变结束时平滑跟踪激活导航项 | `design-system.js`：`syncSidebarActiveIndicator` + `rAF` + `sidebar transitionend` | `200ms` `--ds-ease-spring` | 自动贴合最终位置，无残影 |
| **页面 / 路由切换入场 (`animateRouteViewEntrance`)** | 仅极少数路径触发入场；若对容器施加 `scale(<1)` 会在入场中瞬时压低触控热区高度至 `<44px` | 统一覆盖公开首页、个人启动台、语言项目选择器、工作区与登录页的连贯轻量入场，同时保持交互按钮尺寸与即时响应 | `js/core/motion.js`：`animateRouteViewEntrance` 采用 `opacity: 0.12 -> 1` 与 `translate3d(0, 14px, 0) -> none`；`app.js` 在 `showPublicHome` / `showProjectPicker` / `showMainShell` / `showAuth` 调用 | `240ms` `--ds-ease-spring` | 切换其他模块时取消上一 Web Animation 句柄并重置；`reduced-motion` 下退化为 `90ms` 纯透明渐变 |
| **认证 Tab 分段胶囊指示器 (`.auth-tabs .ds-tab-indicator.seg-indicator`)** | `data-p07-ui="enabled"` 下曾被 `display: none` 隐藏；且通用 `button:hover` `scale(1.01)` 曾造成桌面端对齐偏移 | 登录/注册切换展示清晰圆角白底胶囊弹性滑动对齐 | `index.html` `.auth-tabs[data-indicator-style="pill"]` + `spatial-experience.css` `.ds-tab-indicator.seg-indicator` + `design-system.css` 排除 `button:not([role="tab"]):hover` | `140ms` `--ds-ease-spring` | Tab 间高速切换零跳动、键盘 Space/Enter 同效 |
| **模态框开关与渐隐退出 (`.modal-layer` / `.modal-panel`)** | `membershipModal`/`accountModal` 与 `closeModal()` 存在直接加 `.hidden` 的竞态导致关闭瞬间闪断；`#commandPaletteModal` 关闭按钮字号 `25px` 过大 | 遮罩与面板统一具备弹性缩放微入场与温和收敛退场（`150ms`），点击外部/Esc/X 均平滑退场且不阻塞路由恢复 | `app.js` `closeModal()` + `modalClosingRoutePass` + `spatial-experience.css` `.is-closing` 动画（`dsModalBackdropOut` / `dsModalPanelOut`）；`#commandPaletteModal` 改用 `.v3-cmd-close-btn` (`30x30` SVG 图标) | 入场 `200ms–240ms` / 退场 `150ms` `--ds-ease-spring` | 快速连点/ESC 可安全恢复路由状态与焦点；`reduced-motion` 下无缩放动画 |
| **左下角账户浮层菜单 (`#accountMenuPopover`)** | 依赖 `<details>` 瞬时显隐，侧栏折叠时易贴边裁切或方向僵硬 | Floating UI 风格 `position: fixed` 方向定位（展开为 `top-start`，折叠为 `right-end`），带渐显缩放开启与退场过渡 | `js/core/design-system.js` `positionAccountPopover` / `openAccountPopover` / `closeAccountPopover` + `spatial-experience.css` `[data-open]` / `[data-closing]` | 开启 `180ms` / 关闭 `170ms` `--ds-ease-spring` | 视口边界钳制防溢出；折叠侧栏自动关闭旧浮层 |
| **自定义下拉选择器 (`.ds-select-popover`)** | 关闭时瞬间销毁无收尾过渡，向上弹出缺乏对应 `transform-origin` | 根据实际翻转方向设置 `top center` / `bottom center` 原点，带开启展开与 `.is-closing` `150ms` 退出 | `js/core/design-system.js` + `spatial-experience.css` `.ds-select-popover.is-closing` (`dsSelectPopoverOut`) | 关闭 `150ms` `--ds-ease-standard` | 快速重新打开直接清理退出定时器 |
| **顶部可关闭更新公告条 (`#versionNotice`)** | 右下角固定气泡容易遮挡页面内容与按钮 | 改为顶部全宽温和提醒条，`dsTopBannerIn` 从 `-10px` 轻柔滑入并支持关闭后同步释放 `--ds-hud-version-offset` | `index.html` 结构规范化 + `spatial-experience.css` `#versionNotice:not(.hidden)` | `220ms` `--ds-ease-spring` | 可随时点击“知道了”或“更新并刷新”，不阻碍主交互 |
| **移动端侧边栏抽屉 (`#v3Sidebar` `<=980px`)** | 仅切换开关类名，缺乏手势跟手拖拽体验与原生返回键适配 | 左侧边缘连续跟手 `touchmove` 实时位移、遮罩透明度按进度联动、松手按阈值弹簧吸附开/合，并响应 `popstate` 返回键关闭 | `js/core/design-system.js` `touchstart`/`touchmove`/`touchend` 连续拖拽与 `popstate` + `wasVisible` 零 CLS 守卫 + `spatial-experience.css` | `300ms` `--ds-ease-spring` / 遮罩 `260ms` `--ds-ease-decelerate` | 水平滚动区（`.ds-segmented` / `table` / `pre`）不劫持横滑；弹窗打开时不响应抽屉手势 |
| **控件悬停与弹性按压微交互** | 交互反馈平淡且部分桌面按钮缺乏按压回弹层次 | 仅在 `@media (hover: hover) and (pointer: fine)` 提供轻量浮起/图标 `scale(1.1)` 提示；按压瞬态回弹至 `--ds-pressed-scale: 0.96` | `design-system.css` + `spatial-experience.css` | 悬停 `150ms–240ms` `--ds-ease-elastic`；按压 `80ms–90ms` | 粗指针/触屏不触发粘滞悬停；`prefers-reduced-motion` 下移除缩放位移 |

---

## 3. 证据留存位置

- Phase 1 整改前后对比与 V2 实测截图及正常倍速演练录屏存放于：`docs/ui-rebuild/v63-user-approved-phase1/` 与 `artifacts/v63-phase1/`（含 `phase1-v2-walkthrough.mp4`）。
- 性能实测采用真点击至关键可交互控件可用、真实模块操作响应与动效稳定全链路指标（详见 `PHASE1_REPORT.md` 与 `qa/v63-phase1/verify_phase1.mjs` 输出）。
