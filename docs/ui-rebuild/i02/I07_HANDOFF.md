# Aeris I07 Handoff（基于 V1.1 阶段顺序）

> **权威顺序说明**：依 Owner 确认的《Aeris I 系列 UI 重构执行基准 V1.1》及本轮正式执行指令，**I02 之后的下一授权阶段为 I07（共享动效引擎与交互系统）**，而非早期历史交接中提出的直接大改首页（首页视觉重组属 I03）。

## 1. I02 已交付并可由 I07 直接消费的稳定接口

1. **统一 Token 层（`design-system.css` `:root` / `:root[data-theme="dark"]`）**：
   - 时长与曲线 Token：`--ds-duration-fast`、`--ds-duration-base`、`--ds-duration-slow`、`--ds-ease-out`、`--ds-ease-spring` 等已统一保留在 `:root` 中，I07 可直接消费并扩充物理弹簧与微交互变量。
   - Z-index 分层：`--ds-z-nav`、`--ds-z-modal` 等层级关系已在浏览器回归中验证（Modal Z-index 严格大于 `#accountBar`）。
   - 主操作与状态色：`--ds-action-primary*`、`--ds-on-action-primary`、`--ds-surface*`、`--ds-border*` 与 `--ds-{success,warning,error,info}*` 在 Light/Dark 下完整就绪。
2. **模态与 Toast 静态皮肤（`design-system.css` / `product-ui.css`）**：
   - Modal 圆角（`12px`）、边框、阴影、焦点环（`:focus-visible`）及关闭动画护栏（遵循 `test_static.py` 对 `dsModalPanelIn/Out` 不含 `opacity` 的约束）已稳定。
   - Toast 静态视觉 Token（表面、边框、文字对比度）已整理就绪；**I07 负责在此皮肤上接入最多两条排队调度系统与进出场动效**。
3. **Reduced Motion 与 Android WebView 双重护栏**：
   - `@media (prefers-reduced-motion: reduce)` 与 `html[data-android-reduced-motion="true"]` 已作为核心保护保留在 `design-system.css` / `spatial-experience.css` / `public-experience.css`。
   - **I07 强制约束**：任何新增的 FLIP 共享元素过渡、滚轮驱动 3D、弹簧模态或移动端跟手抽屉，必须同时尊重 `prefers-reduced-motion`、`data-android-reduced-motion="true"` 与 `html[data-theme-switching="true"]` 2-RAF 护栏。

## 2. 暂保留过渡状态并留待 I03 / I04 / I05 / I08 处理的事项

| 保留项 | 现状说明 | 预计处理阶段 |
|---|---|---|
| 首页三张 Hero 浮动卡片（`#publicHome .hero-scene-card`） | 保留 I01 过渡结构及拖拽显式 CSS 变量默认值，未固化为终局结构 | **I03**（替换为真实单预览窗 + Bento 墙） |
| 公开/登录后同页切态布局重排与登录注册页重组 | 保留现有 DOM 骨架，仅对齐 Token 与共享控件皮肤 | **I03 / I04** |
| 学习 / 财务 / 工具 / 后台全业务视图深度重构 | 保留现有业务模板与局部网格，已修复重复 `.finance-summary-grid` 冲突与数字等宽对齐 | **I05 / I06** |
| 个别历史模块图标细节、`a.primary` / `button.primary` 文案微调与 Kill Switch 全面交互改造 | 已为 `a.primary` / `button.primary` 建立同源共享基础规则接口 | **I08 / I09** |

## 3. 进入 I07 前的环境确认

- 隔离 Preview 环境 `thewyj-p07-ui-rc` 保留为预览基础设施（`i01-design-foundation` 与 `i02-css-component-foundation` 各自独立分支隔离）。
- 建议 I07 仍采用 stacked branch 或在 Owner 合并 I01/I02 后基于更新后的主线切出分支开发。
