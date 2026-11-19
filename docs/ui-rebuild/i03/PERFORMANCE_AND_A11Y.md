# 性能、无障碍（a11y）与多视口响应报告

## 1. 无障碍（axe-core + 键盘导航 + 对比度）

- **`axe-core` 自动扫描（0 违规）**：
  - I03 本轮本地 Chrome 验收覆盖 11 次 `axe.run()` 扫描（`/`、`trial`、`download`、`changelog`、`login`、`register` 浅色桌面端 + `/`, `trial`, `download`, `changelog`, `login` 深色桌面端），`violations = []`。
  - 联合 I07 验收同步修复了 `spatial-experience.css` 与 `product-ui.css` 中 `.section-kicker` 在浅色背景（`#f6f7f9`）上的 `4.41:1` 轻微对比度缺口，统一使用 `--ds-brand-hover`（Light `#1d4ed8` `6.26:1` / Dark `#8eb7ff`）。
- **键盘无障碍**：
  - 预览窗 `.aeris-product-tabs` 与 `/trial` `.trial-tool-tabs` 支持 `ArrowLeft`/`ArrowRight`/`Home`/`End` 切换与 `Tab` 进入内容区。
  - `.switch` 控件保留原生 `<input type="checkbox" role="switch">`，支持 `Tab` 聚焦与 `Space` 切换，绝不使用 `display: none` 破坏读屏或键盘焦点。
  - 共享拖拽排序控制器 `createDragSortController` 原生支持 `ArrowUp/Down/Left/Right` 与 `Escape` 取消，并保留焦点不丢失。

## 2. 多视口矩阵与溢出检查

- 实测矩阵涵盖 **`1440px`、`768px`、`390px`、`375px`**（Light / Dark）：
  - I03 全部 6 个公开路由在 4 个视口下均实现 `scrollWidth - innerWidth <= 1px`（0 横向溢出）。
  - 全部 `.switch` 控件滑块在 `1440/768/390/375` 下完全包含于轨道盒内，无裁切。

## 3. Reduced Motion 与低帧耗保障

- `prefers-reduced-motion: reduce` 与 `data-android-reduced-motion="true"` 下：
  - `createScrollProgressController` 锁定 `rx=0deg`, `scale=1`, `ty=0px`, `tz=0px`，Bento 视差归 `0px`；
  - `createTabSkeletonSwitcher` 骨架等待降为 `0ms` 且不播放位移动画；
  - `qa/i07/browser-acceptance.mjs` 实测 Bento 滚动期间外框位移 `0px`。
