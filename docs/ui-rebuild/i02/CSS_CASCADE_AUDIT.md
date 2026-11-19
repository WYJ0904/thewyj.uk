# Aeris I02 CSS Cascade & Specificity Audit

## 1. 加载顺序与层叠架构

`index.html` 中 6 个核心 CSS 的加载顺序经核验保持为：

```text
1. design-system.css       -> 唯一 Token 真源 + 共享基础组件层 + 无障碍/Reduced Motion 兜底
2. styles.css              -> 遗留样式与 P07 OFF 回退基础层
3. product-ui.css          -> 通用产品组件、Admin/Email、Task 27-30 安全与隐私面板
4. public-experience.css   -> 公开首页与 3 卡舞台局部样式
5. workspace-experience.css-> 工作台概览与模块壳层局部样式
6. spatial-experience.css  -> P07 空间/学习/财务/传输模块增强与开关状态隔离层
```

I02 将重复覆写收敛回 `design-system.css` 共享规则，消除了多个文件对同一基础控件（如 `a.primary`、原生 `input[type="checkbox"]`、主按钮、卡片圆角与状态徽标）各自硬编码的冲突。

## 2. `!important` 治理量化对比

| 文件名 | I02 前 `!important` 数 | I02 后 `!important` 数 | 净减少 | 主要清理内容 |
|---|---:|---:|---:|---|
| `design-system.css` | 11 | 11 | 0 | 全部为规范必须保留的安全/无障碍护栏（见第 3 节） |
| `styles.css` | 8 | **5** | **-3** | 移除 `.achievement-tier` (`#8bbdd3 !important`, `11px !important`) 与 `.achievement-item.unlocked .achievement-tier` (`#7fe8b0 !important`)，改以 `.achievement-item .achievement-tier` 自然层叠与语义 Token 兜底 |
| `product-ui.css` | 9 | **1** | **-8** | 清理状态徽标、Task 27/29/30 徽章及 `.achievement-item.unlocked .achievement-tier` 非必要 `!important`，补充 `--color-success-soft` 语义背景 |
| `public-experience.css` | 11 | 11 | 0 | 均为 `[hidden]`、拖拽瞬态、Reduced Motion 与 200% 大字重排护栏 |
| `workspace-experience.css` | 3 | 3 | 0 | 均为卡片悬停与大字重排网格降级规则 |
| `spatial-experience.css` | 95 | **25** | **-70** | 批量移除 `#membershipModal`/`#accountModal`(26)、`#quizView`/`.view`/`#masterySection`(18)、`.transfer-config`(8)、重复 `.finance-summary-grid`(7)、`.finance-trend-toggle-btn`(3) 等非必要 `!important` |
| **合计** | **137** | **56** | **-81 (-59.1%)** | 严格遵循“禁止一次性删除全部 `!important`”，按可证明局部优先治理 |

## 3. 剩余 60 处 `!important` 逐类保留说明

所有剩余 `!important` 均已逐行核查其行号与不可替代原因：

1. **`design-system.css`（11 处）**：
   - L605 (`[hidden] { display: none !important; }`)：防止 flex/grid 组件样式覆盖原生 `[hidden]`。
   - L1074 (`.danger-text`)：危险文本在表单提示或继承颜色下的终态语义保护。
   - L1118–1121 (`@media (prefers-reduced-motion: reduce)`)：4 处系统级减弱动画强制归零（`scroll-behavior`/`animation-duration`/`animation-iteration-count`/`transition-duration`）。
   - L1138–1141 (`html[data-android-reduced-motion="true"]`)：4 处 Android WebView 无障碍减弱动画开关等价护栏。
   - L1185 (`html[data-theme-switching="true"] *`)：2-RAF 主题切换瞬间禁用过渡，防止 I01 已修复的对比度闪烁回退。
2. **`spatial-experience.css`（25 处）**：
   - 状态显隐 `[hidden]` / 折叠隔离（11 处，L41/226/463/710/720/847/1050/1059/3218/3222/3682/4320 中显隐与折叠状态）。
   - 启动闪屏锁定防滚动泄漏（3 处，L1044–1046：`overflow: hidden !important; height: 100dvh !important; max-height: 100dvh !important`）。
   - 拖拽/Reduced Motion/Android 减弱动画护栏（L566, L1241–1255, L4394–4396）。
3. **`public-experience.css`（11 处）**：
   - L1128, L1291, L1390 (`[hidden]` 状态保护)、L1387 (拖拽瞬态 `transition:none`)、L1431/1490/1513 (移动端隐藏与顶栏紧凑隐藏)、L1501–1502 (Reduced Motion & Android Reduced Motion)、L1553/1577 (`data-large-text="true"` 200% 大字重排自适应高度与换行)。
4. **`workspace-experience.css`（3 处）**：
   - L1186（安全禁用态 `transform: none`）、L1405–1406（`data-large-text="true"` 网格单列降级 `grid-column: auto; grid-row: auto`）。
5. **`product-ui.css`（1 处）与 `styles.css`（5 处）**：
   - `product-ui.css` L123：`.error` 明确校验/错误反馈文字色彩终态保护。
   - `styles.css` L188/1064/1925/2678/3117：仅余遗留隐藏规则、按钮布局与聚焦/警告边框兼容保护；成就卡片 `.achievement-tier` 与 `.achievement-item.unlocked .achievement-tier` 的 3 处 `!important` 已全部清除。
6. **CI Run `44448189085` 实测级联冲突闭环**：
   - 首版 I02 仅移除 `product-ui.css` `.project-app .achievement-tier` 上的 `!important`，导致 `styles.css` 旧规则 `color: #8bbdd3 !important` 重新胜出并压过 `product-ui.css` 语义 Token（Light 下 `1.84:1`）。
   - 修复方式：移除 `styles.css` 3 处成就 `!important` 与 `product-ui.css` L2941 `!important`，改由 `.achievement-item .achievement-tier` (`0,2,0`) 胜过 `.achievement-item span` (`0,1,1`)，并由加载顺序在后的 `product-ui.css`（`--color-text-secondary` / `--color-success` / `--color-success-soft`）自然接管。Light/Dark × P07 ON/OFF 均实测 `>= 5.20:1`。

## 4. 关键层叠与特异性修复案例

1. **Duplicate `.finance-summary-grid` 覆盖冲突**：`spatial-experience.css` 中存在重复的 `.finance-summary-grid` 宣言并用 `!important` 锁定了固定多列高度，导致 `data-large-text="true"` 时摘要卡重叠/裁剪风险。I02 移除重复区块并保留响应式网格。
2. **亮蓝大面积默认背景覆写**：`workspace-experience.css` `.dashboard-learning-lane` 原先以 `background: var(--ds-brand)` 渲染大块亮蓝底色；I02 迁移为 `var(--ds-surface-subtle)` + `1px solid var(--ds-border)` + `var(--ds-text)`。
3. **11 处子 44px 触控目标修复**：`spatial-experience.css` 中原存在 `36px–42px` 的按钮与分页控件 `min-height` 覆写，I02 统一迁移为 `var(--ds-touch-min)`（`44px`）。
4. **硬编码深色/浅色状态色清理**：清理 `spatial-experience.css` 与 `product-ui.css` 中的 `#16a34a`、`#10b981`、`#ef4444`、`#dc2626 !important`、`#ffffff` 与 `rgba(37, 99, 235, ...)` 焦点框，全部改用 `--ds-*` 语义 Token，从而在 Dark 模式下自动获得合适对比度。
