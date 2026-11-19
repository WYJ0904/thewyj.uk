# Aeris I02 Token Audit

## 1. 审计范围与方法

本审计覆盖全站 6 个核心 CSS 入口（按 `index.html` 加载顺序）：

1. `design-system.css`（1,552 行）：Design System Token 真源与共享基础控件
2. `styles.css`（3,445 行）：遗留基础布局与 P07 OFF 回退样式
3. `product-ui.css`（5,323 行）：产品组件、Admin/Email、Task 27/28/29/30 UI
4. `public-experience.css`（1,615 行）：公开首页、能力切换与 Hero 场景卡片
5. `workspace-experience.css`（1,416 行）：登录后工作台、概览卡、模块壳层
6. `spatial-experience.css`（4,399 行）：空间/P07 UI、学习与财务/传输工作区覆写

静态扫描与自动化门禁由 `local-backend/test_i02_css_contracts.mjs` 持续验证。

## 2. Token 定义与消费总览

| 样式文件 | `:root` / 作用域定义 Token 数 | `var(--*)` 引用 Token 数 | 未定义引用（修复前） | 未定义引用（修复后） |
|---|---:|---:|---:|---:|
| `design-system.css` | 241 | 140 | 1 | 0 |
| `styles.css` | 10 | 9 | 0 | 0 |
| `product-ui.css` | 0 | 85 | 1 | 0 |
| `public-experience.css` | 4 | 67 | 3 | 0 |
| `workspace-experience.css` | 0 | 56 | 2 | 0 |
| `spatial-experience.css` | 1 | 70 | 4 | 0 |
| **合计（去重前引用文件命中）** | **256 处声明** | **全站消费** | **11 处** | **0** |

> 注：以上“未定义引用”统计的是引用了全站 6 个 CSS 文件均未声明默认值的自定义属性。

## 3. 已补全的缺失 Token 定义

| Token 名称 | 修复前缺口 | I02 语义补全位置 | 语义说明 |
|---|---|---|---|
| `--site-nav-height` | 在 `styles.css` / `spatial-experience.css` 被消费但未声明全局兜底 | `design-system.css` `:root` (`64px`) | 顶部导航固定高度基准，确保弹窗与吸顶偏移不依赖 JS 时序 |
| `--ds-overlay-top` | 移动/抽屉遮罩 top 偏移引用无默认 | `design-system.css` `:root` (`0px`) | 全屏或侧栏遮罩顶部基准 |
| `--ds-overlay-height` | 遮罩高度引用无默认 | `design-system.css` `:root` (`100dvh`) | 视口动态高度基准 |
| `--ds-menu-height` | 顶部菜单高度引用无默认 | `design-system.css` `:root` (`calc(100dvh - 84px)`) | 菜单弹层最大高度 |
| `--ds-card-learning-*` / `--ds-card-finance-*` / `--ds-card-tools-*` | 仅在 `html[data-p07-ui="enabled"]` 下存在，P07 OFF 或首帧前消费时回退失效 | `design-system.css` `:root` 与 `:root[data-theme="dark"]` | 学习/财务/工具三类业务卡片背景与边框语义色 |
| `--widget-x` / `--widget-y` / `--widget-angle` / `--widget-width` | `#publicHome .hero-scene-card` 在 JS 首帧注入前消费 | `public-experience.css` (`#publicHome .hero-scene-card`) | 默认 `0px` / `0deg` / `100%` 兜底，消除未初始化 CSS 变量计算失败 |
| `--ds-surface-active` / `--ds-border-hover` | 交互态激活底色与悬停边框缺失统一语义 Token | `design-system.css` `:root` / `[data-theme="dark"]` | 按钮、标签与列表项激活/悬停一致性 |
| `--ds-success-border` / `--ds-warning-border` / `--ds-error-border` / `--ds-info-border` | 状态条与徽标硬编码 16 进制边框色 | `design-system.css` `:root` / `[data-theme="dark"]` | 状态提示与警告面板语义边框 |

## 4. V1.1 视觉方向核心 Token 映射

| 语义分类 | Token 名称 | Light 值 | Dark 值 (`:root[data-theme="dark"]`) | 约束与备注 |
|---|---|---|---|---|
| 主操作填充 | `--ds-action-primary` | `#111113` | `#f8fafc` | 落实 V1.1 极简中性高对比主按钮，移除大面积亮蓝默认强调 |
| 主操作悬停 | `--ds-action-primary-hover` | `#27272a` | `#e2e8f0` | 保持明确反馈且不回落为亮蓝 |
| 主操作按压 | `--ds-action-primary-pressed` | `#09090b` | `#cbd5e1` | 按压状态深化 |
| 主操作前景色 | `--ds-on-action-primary` | `#ffffff` | `#111113` | 浅底配深字、深底配浅字，确保 >= 4.5:1 对比度 |
| 舞台主操作映射 | `--ds-stage-action` | `var(--ds-action-primary)` | `var(--ds-dark-action-primary)` | 兼容已有 `.primary` / 舞台 CTA |
| 品牌/次级高亮 | `--ds-brand` | 保留语义引用 | 保留深色对比适配 | 不再用于 `.dashboard-learning-lane` 等大块默认背景 |
| 焦点描边 | `--ds-focus-ring` | 保持高可见度对比描边 | 深色高亮焦点描边 | `js/core/design-system.js` 与原生 `:focus-visible` 共用 |
| 语义圆角 | `--ds-radius-xs/sm/md/lg/xl` | `4px / 6px / 8px / 12px / 14px` | 同左 | 工作区常规向 4–8px 收敛；Modal/Hero 保留 12px 语义差异 |
| 密度圆角 | `--ds-density-radius` | `public: 12px` / `workspace: 8px` / `dense: 6px` | 同左 | 由 `[data-density]` 控制，不机械一刀切 `6px` |
| 触控最小尺寸 | `--ds-touch-min` | `44px` | `44px` | 原生 checkbox/radio 本体除外（保持 `18px`） |

## 5. 遗留变量兼容映射策略

为保护 P07 OFF 回退（`styles.css` / `product-ui.css`）以及现有静态门禁（`local-backend/test_static.py`）：

- `--color-primary`、`--color-bg`、`--color-surface`、`--color-text`、`--color-error`、`--color-success` 等旧变量保留为映射到 `--ds-*` 或兼容值的过渡接口，不立即删除。
- `--ds-text: #18212f`、`--ds-text-secondary: #475569`、`--ds-text-muted: #5b687a` 与 `--ds-container-wide: 1440px` 按 `test_static.py` 已建立的对比度与容器契约完整保留。
- 移除了 `design-system.css` 内 `html[data-p07-ui="enabled"]` 下重复重定义颜色与圆角的区块，使 `:root` 与 `:root[data-theme="dark"]` 成为全站唯一 Token 真源。
