# Aeris V6.3 — I03 公开页面重构与 I07 遗留闭环联合实施报告

## 1. 任务范围与分支基线

- **仓库**：`WYJ0904/thewyj.uk`
- **基线分支 / SHA**：`hydrogen/i07-motion-interaction-engine`（HEAD `29f81756ffd38e26777d05f8d0a9841179a573ea`，Core CI Run `44492658222` 为 `success`）
- **开发分支**：`hydrogen/i03-public-pages-redesign`（派生自最新 I07 分支，独立 worktree `aeris_i03_public_pages_redesign`）
- **未越界约束**：严格限于 **阶段 A（I07 遗留 A1–A8 补修）** 与 **阶段 B（I03 六个公开页面 `/`、`/trial`、`/download`、`/changelog`、`/login`、`/register` 重构）**；未提前实施 I04 自定义布局、I05–I09 业务模块或 Task53–61。

## 2. 阶段 A：I07 遗留问题闭环摘要

详细根因与回归证明见 [`PHASE_A_I07_REMEDIATION_REPORT.md`](./PHASE_A_I07_REMEDIATION_REPORT.md)。

| 编号 | 问题 | 核心修复文件 | 状态 |
|---|---|---|---|
| A1 | `.switch` 滑块溢出轨道 / 原生复选框未隐藏 | `design-system.css` | 已修复并在桌面/移动端/Light-Dark/P07 ON-OFF 验收通过 |
| A2 | 3D 预览卡展平后停止，未连续演进 | `js/core/motion.js`、`design-system.css`、`qa/i07/fixture.html` | 已实现可配置多阶段 `computeMultiStageScroll3d`（进入→平视→退场→收束，双向可逆） |
| A3 | Preview 隔离资源绑定不一致 | `qa/i07/stage-preview.mjs`、`qa/i03/stage-preview.mjs` | 不篡改共用项目绑定；启用专用隔离 Preview 项目 `thewyj-i03-preview`（仅绑定 `ee869f78` 与 0 R2）并在脚本强校验部署元数据 |
| A4 | 键盘拖拽排序仅存在于 Fixture 补丁 | `js/core/motion.js`、`qa/i07/fixture.js` | 已下沉至共享 `createDragSortController`（`ArrowUp/Down/Left/Right`、`Escape`、焦点保持、输入框隔离） |
| A5 | `observedTablists` 游离节点堆积 + Tab 异步竞态 | `js/core/motion.js` | 卸载自动清理 observer/indicators；`createTabSkeletonSwitcher` 支持 `AbortSignal` 与 async Promise generation 守卫 |
| A6 | Toast 错误饥饿/挤压丢失、dispose 失效实例与卸载定时器 | `js/core/motion.js` | Error 抢占普通可见条并队列优先、满队错误合并计数防丢失、`getSharedToastManager` 重建、卸载清理定时器 |
| A7 | `I03_I04_HANDOFF.md` 示例签名与源码不一致 | `docs/ui-rebuild/i07/I03_I04_HANDOFF.md` | 已修正为真实 `reconcileKeyedRows({ key, signature, render, empty, flip })` 与 `switchTab(...)` |
| A8 | `js/transfer/app.js` 拖放状态监听重复 | `js/core/motion.js`、`js/transfer/app.js` | `attachFileDropFeedback` 新增 `onDropEvent` 回调并接入 `#transferDropZone` |

## 3. 阶段 B：I03 六个公开页面重构摘要

1. **`/`（`#publicHome`）**：彻底移除旧版三张倾斜浮卡（`.hero-scene-card` / `.home-widget-workspace` / `#homeWidgetEditor`）、旧 5 卡折叠演示（`.capability-gallery`）与波浪背景；保留真实 Aeris Logo、简洁标题、高对比主按钮（Light `#111113` / Dark `#F8FAFC`）、Hero 首屏永久 `opacity: 1`；新增单个固定高度（`min-height: 356px`）真实交互预览窗（`createTabSkeletonSwitcher` 140ms 骨架切换 + 语言一题 / JSON 与文本 / 结余试算 / 文件清单），消费多阶段 Scroll 3D 与下方无接缝 12 列 `.apple-bento-wall`（仅 `.tile-inner` 内部视差，外框接缝锁定 `0px`），完整保留登录后 `[data-home-personal]` 与 `#homeV3SummaryGrid` 工作台连续性。
2. **`/trial`（`#trialPage`）**：以紧凑型 `role="tablist"` Segmented Control 替换原 5 张臃肿工具卡片，增加键盘方向键切换，修复 `<select>` 右侧箭头遮挡间距（`padding-right: 36px`），完整保留 5 项本地试用限额与逻辑。
3. **`/download`（`#downloadPage`）**：清晰层级与 `#downloadStatusBadge` 诚实状态标识，单行清晰包裹文件名（`word-break: normal; overflow-wrap: anywhere;`）与独立等宽可换行 `SHA-256` 区块，完整保留 `/api/app/config` 与 `/api/app/download` 契约。
4. **`/changelog`（`#changelogPage`）**：保留纯数据驱动渲染与 `tabular-nums` 等宽对齐，增强加载骨架与错误兜底，不虚构未上线生产版本。
5. **`/login` 与 `/register`（`#authPanel`）**：保持居中极简卡片、清晰 Logo 与输入框尺寸，修正 Tab 选中态文字对比度（`--ds-brand-hover`），100% 保留既有表单 ID 与 Task 27 安全/隐私/条款契约。
6. **跨路由滚动与 P07 兼容**：`js/core/router.js` 与 `app.js` 协同保存离场滚动坐标并仅在正向切页时置顶，`popstate` 后退/前进保持恢复且不误伤同页 Tab 切换；`P07 ON` 与 `P07 OFF` 双态均通过结构与交互校验。
