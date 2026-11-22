# Aeris I02 Prototype Mapping & Scope Alignment

## 1. 参考基准说明

- 已直接核对仓库同级目录下的 Owner V1.1 执行基准：`Aeris_I_series_UI_refactor_execution_baseline_v1.1_2026-11-17.txt`（107 行）。
- 注：文件 `Aeris_I_series_UI_interactive_prototype_2026-11-17.html` 在当前本地工作区及可访问目录中未存在，因此本映射严格基于已验证的 `Aeris_I_series_UI_refactor_execution_baseline_v1.1_2026-11-17.txt` 第十章原型规范摘要与本轮指令中核准的设计目标，不编造任何未直接观察的原型 HTML 行号或片段。

## 2. 视觉方向映射表（V1.1 目标 -> Aeris `--ds-*` 实现）

| 设计维度 | V1.1 规范目标 | Aeris `--ds-*` I02 落地 | 阶段归属说明 |
|---|---|---|---|
| **浅色主按钮** | `#111113` 填充 + `#FFFFFF` 文字 | `--ds-action-primary: #111113`；`--ds-on-action-primary: #ffffff` | **I02 已落实到共享 Token 与基础按钮** |
| **深色主按钮** | `#F8FAFC` 填充 + 深色文字 | `--ds-dark-action-primary: #f8fafc`；`--ds-dark-on-action-primary: #111113` | **I02 已落实到 `[data-theme="dark"]` 与基础按钮** |
| **去大面积亮蓝** | 取消亮蓝作为默认大面积强调底色 | 移除 `.primary` 蓝色阴影，将 `.dashboard-learning-lane` 转为中性表面，收敛聚焦环与强调态 | **I02 已完成基础治理；模块精细卡片重构留待 I05/I06** |
| **红绿状态收敛** | 红色仅用于危险/错误；绿色仅用于成功/开启/收入 | `--ds-error*`、`--ds-success*` 集中治理 `.status-badge`、财务收支及 Task 27-30 徽标 | **I02 已完成** |
| **圆角收敛** | 工作区常规圆角向 `4–8px` 收敛（保留语义差异） | `--ds-radius-xs/sm/md` (`4/6/8px`) + `--ds-density-radius` (`public 12px`, `workspace 8px`, `dense 6px`)，弹窗维持 `12px` | **I02 已完成基础 Token 与共享控件收敛** |
| **命名体系** | 避免直接照搬原型 `--brand` / `--bg-*` | 全站统一映射至 `--ds-*` 语义体系，保留旧 `--color-*` 兼容层 | **I02 已完成** |
| **数字与校验排版** | 金额、时间、版本、Hash 整齐对齐 | `tabular-nums` + `--ds-font-mono` 应用于财务数字、审计日志、校验值与版本显示 | **I02 已完成** |

## 3. I02 严格边界对照表（刻意留给后续阶段的过渡结构）

| 目标特性 | 计划所属阶段 | I02 当前状态 | 原因说明 |
|---|---|---|---|
| 共享动效引擎、双向 FLIP、滚轮 3D、弹簧模态、跟手抽屉、双 Toast 队列 | **I07** | 未实施（仅提供静态 Toast/Modal 颜色与圆角 Token） | 依 V1.1 规定紧随 I02 之后在 I07 统一建设 |
| 公开首页真实单预览窗、替换 I01 三张浮动卡片、无缝 Bento 墙、登录注册重构 | **I03** | 保留 I01 过渡三卡，未固化为终局结构 | 按 V1.1 优先原则覆盖旧 `I02_HANDOFF.md` 分工，留给 I03 |
| 登录后个性化工作台、隐藏恢复、账户隔离与持久化 | **I04** | 未实施 | 需 I02 基础与 I07 引擎前置完成 |
| 后台、财务、学习、工具、文件业务页面深度视觉重排 | **I05 / I06** | 仅完成基础组件统一与语义色/圆角对齐，保持业务 DOM 不变 | 防止范围蔓延与破坏现有功能回归 |
| 全站图标与文案精修、系统状态与 Kill Switch 全面交互改造 | **I08 / I09** | 为 `a.primary` / `button.primary` 与 Admin Flags 保留清洁 CSS 接口 | 留待专项阶段处理 |
