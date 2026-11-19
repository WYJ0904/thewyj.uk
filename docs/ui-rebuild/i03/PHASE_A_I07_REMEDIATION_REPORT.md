# 阶段 A：I07 遗留问题闭环报告（A1–A8）

## A1. Switch / 开关控件溢出与几何异常

- **根因定位**：`design-system.css` 全局设置了 `input[type="checkbox"] { width: 18px; height: 18px; }`，而 `.switch > input[type="checkbox"]` 缺少 `position: absolute; opacity: 0;` 脱离文档流处理，导致原生复选框占据 18px 占位并与 `.slider` 叠加，把 `44px` 宽轨道内的 `.slider` 挤出容器右侧（见既有截图 `docs/ui-rebuild/i07/evidence/preview/preview-fixture-desktop-light.png`）。
- **修复**：在 `design-system.css` 中将 `.switch > input` 设为 `position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0;`，并将滑块尺寸/位移严格约束在 `.switch` 内部（`44x24px` 轨道、`18px` 滑块、`translateX(20px)`），同时补充深色主题滑块对比度、`:focus-within` 聚焦环、`disabled`/`busy` 与 `forced-colors` 规则（零 `!important`）。
- **验证**：`qa/i07/browser-acceptance.mjs` 在 `1440 / 768 / 390 / 375` 四个视口及 Light/Dark/P07 ON-OFF 下测量所有 `.switch` 的 `.slider` 与 `.switch` 外框交集，溢出数为 `0`，键盘 `Space` 切换及模拟失败回滚均正常；新证据见 `docs/ui-rebuild/i07/evidence/switch-fixed-desktop-light.png`。

## A2. Scroll-Driven 3D 展平后停止

- **根因定位**：`js/core/motion.js` 的 `createScrollProgressController` 仅以单段 `[0, 1]` 进度从 `maxRx` 线性插值到 `0deg`，进入 `rect.top <= 0.30 * vh` 后动画永久停平。
- **修复**：保留 `computeScrollProgress()` 向后兼容，新增导出 `computeMultiStageScroll3d(rect, viewportHeight, options)`（支持 `enter -> level -> exit -> settled` 四阶段与可配置 `data-scroll-exit*` 角度/缩放/Z轴纵深参数），增大 `IntersectionObserver` `rootMargin` 至 `360px 0px` 并在离屏边界强制采样防止快滚冻结；`design-system.css` 补充 `--ds-scroll-ry` 与 `--ds-scroll-tz`。
- **验证**：单元测试 `A2`（正向/反向可逆）与真实 Chrome CDP 滚轮测试实测：进入阶段 `rx=11.97deg` → 阅读甜点区 `stage="level", rx=0deg, scale=1` → 继续下滚进入退场阶段 `stage="exit", rx=-3.66deg, tz=-8.78px` → 反向回滚恢复 `rx=12deg`；Reduced Motion 锁定 `0deg`。同时已在 I03 公开首页 `#publicPreviewScrollWrap` 真实消费。

## A3. Preview 隔离资源绑定不一致

- **根因定位**：共享 Preview 项目 `thewyj-p07-ui-rc` 的 Cloudflare 控制台 `deployment_configs.preview` 绑定着共享非 Prod DB `a3e6253b-...` 与 R2 `WYJ_STORAGE`，而 `qa/i07/stage-preview.mjs` 仅断言不等于 Production ID，未校验部署结果是否真等于声明目标 `ee869f78-...` 与空 `r2_buckets`。
- **修复**：在不动 `thewyj-p07-ui-rc` 全局绑定的前提下：
  1. 改造 `qa/i07/stage-preview.mjs`，在 `remoteCheck.bindingConsistent` 与 `--deploy` 后严格断言实际部署的 `WYJ_DB.id === PREVIEW_D1_ID` 且 `r2_buckets` / `ai_bindings` 为空。
  2. 为本轮新建专用隔离 Pages 项目 `thewyj-i03-preview`（仅绑定 `ee869f78-b54a-4018-bc99-871089ecb8cd` 与 0 R2 / 0 AI），由 `qa/i03/stage-preview.mjs` 与 `verify-preview.mjs` 部署后直接校验真实 Cloudflare 部署元数据。

## A4. 共享键盘拖拽排序能力下沉

- **修复**：将原本仅位于 `qa/i07/fixture.js` 的方向键排序下沉到 `js/core/motion.js` 的 `createDragSortController`（支持 `axis: "auto" | "x" | "y" | "both"`、`ArrowUp/Down/Left/Right`、`Escape` 取消、焦点恢复、输入框 `input/textarea/select/[contenteditable]` 豁免及 `onOrderChange(..., { trigger: "keyboard", key })`）；删除 `qa/i07/fixture.js` 原专用 `keydown` 补丁，直接消费共享控制器。

## A5. 动态 Tab 生命周期与异步竞态

- **修复**：在 `installMotionSystem()` 中添加 `pruneDisconnectedTablists()`，监听节点卸载后清理 `observedTablists`、`indicators`、`indicatorFrames` 并重建活跃观察目标；在 `createTabSkeletonSwitcher()` 中加入 `AbortController` 与 `generation` 双重守卫，异步 `Promise` 版 `renderContent(panel, { signal, generation })` 被覆盖后自动中止并禁止写回 DOM 或误清状态，同时在面板内输入框聚焦时不播放位移干扰动画。

## A6. Toast 严重程度、溢出保护与生命周期

- **修复**：在 `createToastManager` 中实现：
  1. 屏幕已满且全为非错误通知时，新 `error` 立即抢占最旧非错误通知（将其安全退回队列前端）；`flushQueue()` 优先弹出 `error`。
  2. 队列满且全为 `error` 时，不再静默 `shift()` 丢弃旧错误，而是将溢出错误合并计数为 `另有 N 条错误待处理（最新：…）` 常驻错误摘要条目。
  3. 增加 `beforeunload`/`pagehide` 定时器清理与 `disposed` 只读属性；`getSharedToastManager(doc)` 在实例已 `disposed` 时自动重建新实例。

## A7. 交接文档 API 修正

- 已在 `docs/ui-rebuild/i07/I03_I04_HANDOFF.md` 同步修正 `reconcileKeyedRows(tbody, items, { key, signature, render, empty: '', flip: true })` 与 `createTabSkeletonSwitcher.switchTab(panel, renderContent, { immediate })`。

## A8. 文件拖放状态逻辑统一

- 为 `attachFileDropFeedback` 增加 `onDropEvent` 参数以适配文件夹/队列自定义拖放处理，并在 `js/transfer/app.js` 使用共享 helper 替换重复的 `dragenter/dragover/dragleave/drop` 状态代码（业务上传逻辑保持不变）。
