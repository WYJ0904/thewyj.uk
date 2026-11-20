# 跨路由滚动复位、历史恢复与首屏不透明度保障

## 1. 解决的旧缺陷

1. 旧实现仅对 `/changelog` 调用滚动复位，`showPublicHome` / `showTrial` / `showDownload` / `showAuth` 均未复位滚动位置，导致从长页面底部跳转新公开页时新页面停留在中底部或被吸顶导航遮挡。
2. 未区分正向跳转与浏览器前进/后退，以及返回首页后旧 Hero 动画/透明度可能保持低透明度状态的问题。

## 2. 本轮实现方案

- **`js/core/router.js` (`createRouter.pushRoute`)**：在 `history.pushState` 切换前，先把离场页面的 `{ scrollX: window.scrollX, scrollY: window.scrollY }` 写回当前 `history.state`（`replaceState`）。
- **`app.js` (`popstate` + `applyPublicRouteScroll`)**：
  - `popstate` 事件触发时记录 `pendingPopScroll = event.state`；当各 `show*` 函数以 `pushHistory = false` 被 `routeCurrent()` 调用且 `pendingPopScroll` 含坐标时，精准恢复历史滚动位置而**不强制置顶**。
  - 用户点击链接/按钮以 `pushHistory = true` 正向跳转至新页面时，`applyPublicRouteScroll(true)` 立即并在双 `requestAnimationFrame` 后平滑置顶（`top: 0, behavior: "instant"`），同时触发 `window.WYJPublicScroll?.refresh?.()` 重新校准首页 3D 与 Bento 视差状态。
  - 同页交互切换（`/trial` 五项 Tab 切换、`#publicCapabilityGallery` 预览窗 Tab 切换、登录/注册面板状态更新）均不触发页面跳顶。
- **Hero 永久不透明**：在 `public-experience.css` 与 `spatial-experience.css` 显式锁定 `#publicHome .public-hero, #publicHome .public-intro-copy { opacity: 1; transform: none; }`。

## 3. Chrome 实测结果

- `/` 滚动至底部（`scrollY = 2116`）点击 `#publicDownloadBtn` → `/download` 起始 `scrollY = 0`。
- `/download` 滚动至底部点击 `/changelog` → `/changelog` 起始 `scrollY = 0`。
- 两次 `history.back()` 返回 `/` 后，实测 `#publicHome .public-hero` 计算样式 `opacity === "1"`。
- `/trial` 滚动至 `scrollY = 140` 切换 `[data-trial-tool="json"]` 后保持 `scrollY = 140` 不回弹。
