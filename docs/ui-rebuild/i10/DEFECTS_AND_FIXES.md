# Aeris V6.3 — I10｜全站交互缺陷与修复记录（Defects & Fixes）

本文件记录 I10 阶段发现、复现并完成根因修复的所有缺陷，均未通过隐藏元素、弱化断言、关闭 `axe` 或跳过测试来掩盖问题。

---

## Defect-01 [P0 / CI Blocker] 工具箱「模糊搜索工具」WCAG AA 对比度失败（1.84:1）

- **来源与追踪**：PR #178 GitHub Core CI Run `45072018235` / Job `137363122787` (`Cloud-only browser, canonical session and toolbox`) -> `local-backend/test_tools_browser.mjs:1496`。
- **现象**：`auditVisibleTextContrast('#toolsPanel')` 报错：`模糊搜索工具` 颜色为 `rgb(168, 187, 206)`，白底对比度仅 `1.84:1`（要求 `>= 4.5:1`）。
- **根因**：PR #178 在 `index.html:1257` 将 `<span>模糊搜索工具</span>` 嵌套进了 `<span class="tool-search-label-row">` 内，导致 `product-ui.css:3119` 的子代选择器 `.tool-search > span` 不再匹配，文本回退继承了 `styles.css:1344` 中面向深色皮肤的 `.tool-search span { color: #a8bbce; }`。
- **修复**：
  - [styles.css](../../../styles.css#L1344-L1358)：`.tool-search span` 与 `.tool-search small` 改用语义 token `var(--ds-text-secondary, #475569)` / `var(--ds-text-muted, #5b687a)`，保证 P07 ON/OFF 与 Light/Dark 均满足 AA。
  - [product-ui.css](../../../product-ui.css#L3119)：将 `.tool-search > span` 放宽为 `.tool-search span`。
  - [spatial-experience.css](../../../spatial-experience.css#L7632)：显式声明 `.tool-search-label-row` 与 `.tool-search-label-row > span` 使用 `var(--ds-text-secondary)`。
- **验证**：
  - 本地运行 `local-backend/test_tools_browser.mjs`：通过全量 104 工具矩阵以及行 1467 / 1496 (`#toolsPanel`) / 1518 (`#toolWorkbench`) 对比度检查（注：本地 Windows Python 缺少 `cv2` 于行 1537 退出，将由 Push 后的 Ubuntu GitHub Core CI 跑完整个文件验证）。
  - `qa/i10/browser-acceptance.mjs`：`tools-1440-light-p07-on`、`tools-390-dark-p07-on`、`tools-1440-light-p07-off` 均为 **0 violations**。
  - Hosted Preview (`thewyj-i10-preview`)：`模糊搜索工具` 实测计算色值 `rgb(71, 85, 105)`，`/tools` `axe-core` **0 violations**（46 passes）。

---

## Defect-02 [P1] 移动端 `/tools` 双栏网格横向溢出（400px / 390px 视口）

- **现象**：390px 移动视口下工具箱出现 10px 横向溢出（页面被撑宽至 400px）。
- **根因**：PR #178 在 [spatial-experience.css](../../../spatial-experience.css#L7695) 的无媒体查询作用域内追加了 `.tools-two-pane { grid-template-columns: 272px minmax(0, 1fr); }`，覆盖了更早 `@media (max-width: 980px)` 的单栏规则；同时 `.tools-search-bar .tool-search` 使用了固定 `flex: 1 1 380px`。
- **修复**：在 [spatial-experience.css](../../../spatial-experience.css) 将桌面两栏布局约束在 `@media (min-width: 981px)`，并在 `@media (max-width: 980px)` 恢复 `grid-template-columns: 1fr; gap: 16px;`，搜索框使用 `flex: 1 1 min(380px, 100%)`。
- **验证**：本地 `qa/i10/browser-acceptance.mjs` 与 Hosted Preview `verify-preview.mjs` 均测得 `/tools` 390px 视口 `overflow = 0`。

---

## Defect-03 [P1] `[aria-busy="true"]` 容器降透明导致 `axe-core` AA 对比度违规

- **现象**：当 `#financeCandidatesSection` 或其它大区块处于加载态（`aria-busy="true"`）时，全容器 `opacity: 0.76` 把前景色压暗/洗淡，使 `#financePendingCount` 对比度降至 `3.13:1`、次级 `<p>` 降至 `4.16:1`。
- **根因**：[design-system.css](../../../design-system.css#L1663) 全局声明 `html[data-p07-ui="enabled"] [aria-busy="true"] { opacity: 0.76; }`。
- **修复**：
  - 在 [design-system.css](../../../design-system.css#L1663) 保留 `cursor: progress;` 并移除会整体削弱文字对比度的 `opacity: 0.76;`。
  - 在 [spatial-experience.css](../../../spatial-experience.css#L2534) 将 `#financePendingCount` 颜色强化为 `var(--ds-brand-hover)` 以提升徽标与浅蓝底对比度。
- **验证**：`qa/i10/browser-acceptance.mjs` 对 `/finance` 执行 `axe-core` 全页扫描，46 passes、**0 violations**；Hosted Preview 37 passes、**0 violations**。

---

## Defect-04 [P1] 工作台密度切换 `flipScale: true` 导致交互瞬态遮挡

- **现象**：点击 `#workspaceDensityBtn` 从 `compact` 切换到 `comfortable` 时，左侧 Bento 卡片按宽度比放大至 ~203%，过渡期间覆盖右侧卡片按钮，造成点击命中失败或视觉重叠。
- **根因**：[js/core/home-widgets.js](../../../js/core/home-widgets.js#L650) 在容器级密度切换启用了 `flipScale: true`。
- **修复**：保持容器 `reconcileKeyedRows` 平滑位移的同时设置 `flipDuration: 240, flipScale: false`，改以精确位置 FLIP 替代形变缩放。
- **验证**：`qa/i10/browser-acceptance.mjs`、`qa/aeris/home-widgets-browser.mjs`、`qa/aeris/mobile-widgets-browser.mjs`、`qa/i04/browser-acceptance.mjs` 全部通过。

---

## Defect-05 [P1] HUD、右侧抽屉/Bottom Sheet `transform` 与页脚遮挡治理

- **现象与隐患**：
  1. 右侧抽屉（如 `#financeTransactionModal`）与桌面 `#workspaceDetailModal` 入场动画使用 `animation-fill-mode: both`，若部分浏览器的合成层残余非 `none` `transform`，会形成局部包含块并截断/错位原生 `<select>` 下拉弹窗及底部安全区。
  2. 桌面 `>980px` 下 `#versionNotice` 与 `#siteMessageSaveStatus`、`.achievement-toast` 未像 `.ds-toast-region` 那样同步避让 `[data-right-drawer-open="true"]`，且页面滚到底部时 `.site-help-footer` 底部可能与持久 HUD 贴近。
- **修复**：
  - [workspace-experience.css](../../../workspace-experience.css#L1949-L1972)：将 `#workspaceDetailModal` 与 `[data-sheet-mode="drawer"] .modal-panel` 动画填充改为 `backwards`，确保入场结束后计算样式 `transform === 'none'`。
  - [spatial-experience.css](../../../spatial-experience.css#L322)：`.site-help-footer` 动态预留 `--ds-hud-version-offset + --ds-hud-save-offset` 底部内边距；`[data-right-drawer-open="true"]` 下使 `#versionNotice:not(.hidden)`、`#siteMessageSaveStatus:not(.hidden)` 与 `.achievement-toast` 统一左移避让。
- **验证**：本地（1440/1024/768/390/375）与 Hosted Preview 均实测 `panelTransform: "none"`，`verOverlapsDrawer: false`、`toastOverlapsDrawer: false`、`verOverlapsToast: false`；`qa/i09/browser-acceptance.mjs` 4/4 通过。

---

## Defect-06 [P1] 工具箱 / 工作流焦点恢复、`Esc` 返回、头栏消失与连击定时器竞态

- **现象**：
  1. 进入 `#toolWorkbench` 后键盘按 `Esc` 无法返回工具目录，关闭工作台也不恢复触发卡片/搜索框焦点；`hide()` 未清理 `#toolCatalog` 的 `aria-busy`。
  2. `tools.js` 连续双击“复制结果”时，先触发的 `setTimeout` 会提前清掉第二次点击的状态文案。
  3. `workflows.js` 中 `#copyWorkflowResultBtn` 无状态反馈；从工作流点击 `#closeWorkflowBtn` 返回后 `.tools-header` 仍被隐藏、且若未先打开工具目录则目录为空、焦点丢失。
- **修复**：
  - [tools.js](../../../tools.js)：监听文档级 `keydown` 捕获 `Escape`（排除 IME 组合、`<select>` 及高优先级弹窗）返回列表并精准回焦触发卡片/搜索框；打开具体工具时主动聚焦 `#toolWorkbench` 标题或首个控件；使用实例级 `copyFeedbackTimer` 消除双击定时器竞态；`hide()` 时显式清理 `aria-busy="false"`。
  - [workflows.js](../../../workflows.js)：为 `#copyWorkflowResultBtn` 补齐 `已复制/复制失败` 状态与去重定时器；`#closeWorkflowBtn` 时显示 `#toolsPanel .tools-header`、必要时确保目录渲染并回焦 `#openWorkflowBtn`（不可用时回退 `#toolSearchInput`）。
- **验证**：`qa/i10/browser-acceptance.mjs` 场景 `i10_tools_keyboard_esc_contrast_and_workflows` 通过，实测 `focusInWorkbench: true`、`focusAfterEsc: true`、`wfCopyLabel: "已复制"`、`headerHidden: false`、`activeId: "openWorkflowBtn"`。

---

## Defect-07 [P2] Command Palette IME 误触发、`aria-activedescendant` 缺失；文件分享降级复制与 Prefetch CORS

- **修复**：
  - [app.js](../../../app.js)：`#commandPaletteInput` 跳过 `event.isComposing` 中文输入法合成按键；`renderCommandPaletteList()` 为候选项赋稳定 `id`、维护 `aria-activedescendant` 并调用 `scrollIntoView({ block: 'nearest' })`。
  - [js/transfer/app.js](../../../js/transfer/app.js)：`#transferShareCard` 滚动尊重 `prefers-reduced-motion: reduce`；`#transferCopyLinkBtn` 补充 `execCommand('copy')` 降级与定时器去重。
  - [js/core/motion.js](../../../js/core/motion.js#L2528)：`createAssetPrefetcher` 设置 `link.crossOrigin = 'anonymous'` 对齐模块预取 CORS，避免重复下载。
- **验证**：`qa/i10/browser-acceptance.mjs` `i10_command_palette_and_reduced_motion` (`activeDesc: "v3CmdOption_1"`, `restoredId: "v3CmdTrigger"`) 及 `qa/aeris/transfer-clipboard-browser.mjs`、`node --test local-backend/test_v6_ui_contracts.mjs` 全部通过。
