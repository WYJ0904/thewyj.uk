# Aeris I02 Implementation Report（CSS / 组件基础重整）

## 1. 阶段概述与基线对照

- **所属阶段**：Aeris V6.3 — I02｜CSS / 组件基础重整（依《Aeris I 系列 UI 重构执行基准 V1.1》在 I01 基础上推进）
- **仓库与分支**：`WYJ0904/thewyj.uk`
  - I01 基准分支：`hydrogen/i01-design-foundation-shell`（PR #162，Draft / Open，远端 HEAD `3f5cffc3c86d2b92006cc78dab828a80f2068a65`，未修改 I01 工作区与 PR 状态）
  - `main` 基线：`7c111ae4452d8eef493bca6fab71c613e380761c`
  - I02 开发分支：`hydrogen/i02-css-component-foundation`（基于 I01 建 stacked Draft PR #163）
  - 独立 Worktree：`aeris_i02_css_component_foundation`（工作目录 `css_component_foundation`）
  - 隔离 Hosted Preview：`https://i02-css-component-foundation.thewyj-p07-ui-rc.pages.dev`（部署 ID `a7cfa4d7`）

## 2. 本轮核心实施成果

1. **统一 Design Token 真源（`design-system.css`）**：
   - 修复全站 6 个 CSS 文件内原有 **11 处未定义 Token 引用**（包括 `--site-nav-height`、`--ds-overlay-top`、`--ds-overlay-height`、`--ds-menu-height`、`--ds-card-{learning,finance,tools}-*`、`--ds-surface-active`、`--ds-border-hover`、`--ds-{success,warning,error,info}-border` 及 `#publicHome .hero-scene-card` 的 `--widget-*` 默认兜底），当前未定义 Token 数为 **0**。
   - 移除 `html[data-p07-ui="enabled"]` 下重复冲突的颜色与圆角重定义，确立 `:root` 与 `:root[data-theme="dark"]` 为全站唯一 Token 真源，并保留 `--color-*` 旧变量兼容映射。
2. **落地 V1.1 视觉方向至共享 Token 与基础控件**：
   - 浅色主操作： `--ds-action-primary: #111113`、`--ds-on-action-primary: #ffffff`（含 `hover`/`pressed`）。
   - 深色主操作：`--ds-dark-action-primary: #f8fafc`、`--ds-dark-on-action-primary: #111113`。
   - 取消亮蓝色默认大面积强调：移除 `.primary` 蓝色弥散阴影；将 `.dashboard-learning-lane` 从 `var(--ds-brand)` 改为中性表面 + 边框；红/绿仅保留于危险/错误/支出与成功/开启/收入语义。
   - 工作区常规圆角向 `4–8px` 收敛，并引入三档 `--ds-density-radius`（`public: 12px`、`workspace: 8px`、`dense: 6px`），保留弹窗 `12px` 等合理语义差异。
3. **CSS 层叠与 `!important` 治理**：
   - 全站 `!important` 总量从 **137 处降至 56 处（-59.1%）**：主要削减 `spatial-experience.css`（95 → 25）、`product-ui.css`（9 → 1）与 `styles.css`（8 → 5，清除 `.achievement-tier` 旧 `!important` 冲突）。
   - 剩余 56 处逐条审计保留，仅用于 `[hidden]` 状态保护、Reduced Motion / Android Reduced Motion、`2-RAF` 主题切换防闪烁、`200%` 大字重排及 P07 OFF 遗留兼容。
   - 清理重复 `.finance-summary-grid` 冲突规则，修复 `spatial-experience.css` 中 11 处 `< 44px` 的子最小触控目标覆写。
4. **共享组件、输入与排版规范统一**：
   - 统一 `a.primary` 与 `button.primary` / `.button-primary` 尺寸、对齐与色彩，消除 `/download` 等语义链接按钮样式漂移。
   - 保护原生 `checkbox` / `radio` 不被通用 `input` 全宽规则拉伸（保持 `18px–20px` 本体），同时显式保留 `input[type="file"]` 的高对比背景/文字/按钮皮肤（由 `test:task29:browser` 捕获并验证修复）。
   - 建立 `.ds-switch` / `.switch` 共享视觉 Token；扩展 `tabular-nums` 与 `--ds-font-mono` 到金额、百分比、容量、版本与校验摘要。
   - 修复 `public-experience.css` 在 `721px–860px`（含 `768px` 平板断点）的导航栏换行一致性缺陷。
5. **发布版本标识与 SW 完整性同步**：
   - 同步更新全站 30 个前端/Service Worker 文件的 `ASSET_RELEASE` 为 `20261119-aeris-i02-preview`，并执行 `npm run task27:publication` 重算发布完整性清单（`c9e8c6ee751726b8cf510cc6f4134f171c1f382c8b9880014a4b5e3feb9fe478`，20 entries）。

## 3. 交付文档清单（`docs/ui-rebuild/i02/`）

1. `IMPLEMENTATION_REPORT.md`（本报告）
2. `TOKEN_AUDIT.md`（Token 清单、补全与兼容策略）
3. `CSS_CASCADE_AUDIT.md`（6 文件加载顺序、`!important` 前后量化与逐类留存说明）
4. `COMPONENT_CONTRACTS.md`（按钮/链接/表单/开关/卡片/表格/Modal 与 Toast 皮肤契约）
5. `PROTOTYPE_MAPPING.md`（基于 V1.1 执行基准的原型映射与阶段边界）
6. `INTERACTION_ACCEPTANCE.md`（Chrome CDP 真浏览器 9 场景 + 12 视口主题矩阵 + 8 次 `axe-core` 结果）
7. `VISUAL_EVIDENCE.md`（本地验收截图与 Hosted Preview 验证证据索引）
8. `REGRESSION.md`（静态门禁、Python、Task 25–30 全套后端及浏览器回归实测记录）
9. `I07_HANDOFF.md`（面向下一阶段 I07 动效引擎的接口交接）
10. `RISKS_AND_ROLLBACK.md`（已识别风险、缓解闭环与秒级/Git 回滚方案）
