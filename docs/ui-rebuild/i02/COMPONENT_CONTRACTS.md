# Aeris I02 Component Contracts

本文件定义 I02 重整后全站共享组件的基础样式契约。后续阶段（I07 动效引擎、I03 公开页面重排、I04/I05/I06 工作台、I08 专项精修）均以此作为样式接口消费，禁止再于模块局部重新发明独立按钮或表单底座。

## 1. Buttons & Links（按钮与语义链接）

| 语义变体 | 选择器 / 类名 | 视觉 Token 契约 | 尺寸与无障碍要求 |
|---|---|---|---|
| **Primary** | `button.primary`, `a.primary`, `.button-primary`, `#publicLoginBtn`, `#navRegisterBtn`, `.confirm-candidate` | Light: `--ds-action-primary` (`#111113`) / `--ds-on-action-primary` (`#ffffff`)；Dark: `#f8fafc` / `#111113`；悬停使用 `--ds-action-primary-hover`，按压 `--ds-action-primary-pressed`；移除蓝色弥散阴影 | 统一 `display: inline-flex; align-items: center; justify-content: center; text-decoration: none`，最小高度 `var(--ds-touch-min)` (`44px`)；确保 `a.primary` 与 `button.primary` 基线对齐（为 I08 细修保留统一入口） |
| **Secondary** | `button.secondary`, `.button-secondary`, `#publicDownloadBtn` | `--ds-surface` 底色 + `1px solid var(--ds-border)` + `--ds-text`，悬停切换 `--ds-surface-hover` / `--ds-border-hover` | `min-height: var(--ds-touch-min)`；圆角跟随 `var(--ds-radius-md)` / `var(--ds-density-radius)` |
| **Ghost** | `button.button-ghost`, `.button-ghost`, `#homeSearchBtn` | 透明背景 + `var(--ds-text-secondary)`；悬停 `--ds-surface-hover` + `var(--ds-text)` | 必须保留 `:focus-visible` `2px` 以上 `--ds-focus-ring` 外描边 |
| **Destructive** | `.button-danger`, `#openDeleteAccountBtn`, 危险确认提交 | `--ds-error` 语义色边框/底色与高对比文本；危险动作区域配 `.danger-zone` 说明文案 | 不得仅依靠红色区分，须配合明确语义文字与二次确认弹窗 |
| **Text link** | 文本型链接与辅助导航项 | `color: var(--ds-text-secondary)` -> 悬停 `var(--ds-text)`，显式下划线或语义箭头 | 独立交互目标满足触控安全间距 |
| **Icon button** | 工具栏图标按钮 | 正方形/紧凑对称内边距，`var(--ds-touch-min)` 触控安全区 | 必须具有 `aria-label` 或视觉隐藏文本 |
| **Loading / Disabled** | `:disabled`, `[aria-disabled="true"]`, `[aria-busy="true"]` | 保持可读前景/背景对比度，禁止用过低 `opacity` 导致文本不可读（`button:disabled` 遵循 `test_static.py` 对 `opacity: 1` 的回归保护） | `aria-disabled` / `disabled` 可被屏幕阅读器识别，键盘聚焦顺畅或合法跳过 |

## 2. Inputs / Forms / Selection Controls（输入与选择控件）

- **通用文本控件**：`input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])`, `select`, `textarea`
  - 统一消费 `--ds-surface`、`--ds-border`、`--ds-text`、`--ds-radius-md` (`8px`) 与 `--ds-touch-min` (`44px`)。
  - 焦点态统一消费 `--ds-focus-ring`，替换零散 `rgba(37, 99, 235, ...)` 蓝框。
- **原生 Checkbox / Radio 保护**：
  - 显式排除 `:not([type="checkbox"]):not([type="radio"])` 避免全局 `width: 100%; min-height: 44px` 将复选框/单选框拉伸为整行矩形。
  - Checkbox 与 Radio 本体保持 `18px × 18px` 规整比例；触控点击热区由外层 `<label>` 容器承载 `>= 44px` 高度。
- **Switch（开关控件）**：
  - 提供共享 `.ds-switch` / `.switch` Token 皮肤规范，定义轨道底色（未开启 `--ds-border-strong`、开启 `--ds-success`）、滑块前景色与高对比焦点环，兼容减少动态效果（Reduced Motion）。
- **错误与帮助信息**：
  - `.error` / `.form-error` / 危险警告区域结合文字语义、图标或左边框标识与错误语义 Token（`--ds-error`, `--ds-error-bg`, `--ds-error-border`），避免色盲用户无法辨识。

## 3. Cards / Panels / Badges / Tables（卡片、面板、徽标与表格）

- **表面与圆角密度**：
  - 使用 `[data-density="public"]` (`12px`)、`[data-density="workspace"]` (`8px`)、`[data-density="dense"]` (`6px`) 控制常规容器圆角 `--ds-density-radius`。
  - 业务卡片（Learning/Finance/Tools）统一使用 `var(--ds-card-*-bg)` 与 `var(--ds-card-*-border)`，并在 Dark 下自动匹配降饱和度深色表面。
- **状态徽标（`.status-badge`, Task 27/28/29/30 徽章）**：
  - 统一 `normal/enabled/income` -> `--ds-success*`，`warning/pending` -> `--ds-warning*`，`error/danger/expense` -> `--ds-error*`，`info/neutral` -> `--ds-surface-subtle` + `--ds-border`。
- **数字、金额、版本与校验值排版**：
  - 金额（`.finance-summary-grid strong`, `#financeBalanceTotal`, `#financeIncomeTotal`, `#financeExpenseTotal`）、版本号、容量、配额、时间戳与百分比统一启用 `font-variant-numeric: tabular-nums`。
  - SHA-256 摘要、审计日志（`#featureFlagAudit`）、校验值与代码块统一消费 `var(--ds-font-mono)` 与 `tabular-nums`。
- **Empty / Loading / Error 骨架与表格分隔**：
  - 统一表头背景、字重与 `1px solid var(--ds-border)` 行分隔线，不改动任何业务数据结构与脚本绑定。

## 4. Modal / Toast 基础皮肤（非动效引擎）

- **Modal（`#membershipModal`, `#accountModal`, `#deleteAccountModal` 等）**：
  - Z-index 层级严格消费 `--ds-z-modal` (`1000`) > `--ds-z-nav` (`400`)，保证弹窗始终位于顶栏与侧栏之上。
  - 基础圆角保留 `var(--ds-radius-lg)` (`12px`)，表面/边框/阴影分别消费 `--ds-surface`、`--ds-border`、`--ds-shadow-modal`。
  - 保留既有焦点陷阱、Escape 关闭、原触发按钮焦点恢复与 `dsModalPanelIn/Out`（遵守 `test_static.py` 规范，不含 `opacity` 闪烁动画）。
- **Toast 基础皮肤**：
  - 整理共享颜色、边框、圆角、排版与对比度 Token。
  - **严格边界**：本轮仅提供基础静态皮肤，不实现 I07 的弹簧物理动效、双向 FLIP、移动跟手抽屉及双 Toast 排队调度引擎。
