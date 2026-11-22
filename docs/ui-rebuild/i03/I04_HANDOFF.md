# I04 交接指南（来自阶段 A + I03）

## 1. 为 I04 保留的首页自定义布局基础设施

- **`js/core/home-widget-layout.js`（完整未改）**：网格计算、安全清洗（`sanitizeHomeWidgets`）、桌面/移动断点判定（`isHomeWidgetDesktop`）以及存储键空间 `homeWidgetStorageKey`（`aerisHomeWidgets:v2:<owner>`）原封不动保留给 I04 工作台使用。
- **`js/core/home-widgets.js`**：已加入安全防呆守卫——当当前公开首页不存在 `.public-hero-scene` / `#homeWidgetEditor` 时安全退化为无操作控制器，后续 I04 在登录工作台视图挂载对应卡片宿主与编辑器后即可直接复用，不破坏既有本地存储契约。

## 2. 已就绪的可直接消费 I07+I03 基础能力

- **Switch 组件**：`.switch` 几何碰撞已在 `design-system.css` 根治（桌面/移动/深浅色/`forced-colors`/失败回滚全验证）。
- **多阶段 Scroll 3D 与 Bento 内视差**：`computeMultiStageScroll3d` 与 `createScrollProgressController` 支持 `enter → level → exit → settled` 多段演进及 `tile-inner` 视差，I04 Bento 工作区可直接挂载 `[data-bento-wall]` 与 `[data-scroll-3d]`。
- **共享键盘排序**：`createDragSortController` 原生包含 `ArrowUp/Down/Left/Right` 与 `Escape` 取消，I04 卡片排序无需再编写额外键盘事件补丁。
- **异步 Tab 竞争守卫 & Toast 优先级**：`createTabSkeletonSwitcher` 原生传出 `AbortSignal`，`createToastManager` 原生保证严重错误抢占与零静默丢弃。
- **路由滚动管理**：正向跳转默认置顶、`history.back()` 恢复离开坐标的机制已在 `js/core/router.js` 与 `app.js` 确立，I04 新增子视图切换沿用此模式即可避免滚动错位。
