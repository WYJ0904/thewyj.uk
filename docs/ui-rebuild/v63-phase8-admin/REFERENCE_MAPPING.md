# Aeris V6.3 Phase 8 — 公开设计参考与网络研究映射（REFERENCE_MAPPING）

> 本文件归档 Phase 8 开始前对公开产品界面、官方文档与开源模式的实际网络调研结果，以及向 Aeris 管理员后台（`Operate` 模式）的适配映射。严禁直接复制第三方专有代码。

---

## 一、网络研究对象与核心模式提炼

| 参考来源 | 研究主题 | 提炼的界面与交互原则 | 在 Aeris Phase 8 的具体落地 |
|---|---|---|---|
| **Cloudflare Dashboard / Audit Logs v2 & Configuration** (`dash.cloudflare.com`, `developers.cloudflare.com`) | 控制台信息密度、配置面板、审计日志与安全开关 | 1. 顶部指标概览与列表联动（点击指标直达对应视图）<br>2. 审计日志紧凑列表 + 点击展开前后值 JSON Diff 与请求追踪 ID<br>3. 配置面板清晰分区：目录清单 vs 配置编辑区、显式未保存变更状态、高危开关（Kill Switch）视觉隔离与优先级说明 | 1. `#adminKpiStrip` 4 项真实指标点击可跳转对应管理标签并附真实统计口径说明<br>2. `#adminAuditView` 保留紧凑表格行，长摘要与 `before`/`after` 变更细节通过详情展开查看<br>3. `#adminFeatureFlagsView` 采用左侧目录 + 右侧编辑与预演面板，独立高对比 `紧急关闭` 警告块与优先级提示 |
| **Linear** (`linear.app`) | 高密度列表、筛选、详情面板与键盘交互 | 1. 32–44px 紧凑行高、清晰主次排版、内联筛选栏<br>2. 点击列表项打开侧滑详情面板，保留列表滚动位与搜索状态<br>3. 可预期的键盘焦点与 `Esc` 回焦 | 1. `#adminFeedbackView` 升级为紧凑工单/建议行 + 筛选工具栏 + 详情检视与合并/删除确认区<br>2. 用户管理与订单审核引入右侧详情抽屉（桌面）与全宽面板（移动），关闭后焦点与滚动位保持不变 |
| **Stripe Dashboard** (`docs.stripe.com/dashboard`) | 订单与付款审核、状态标识与详情抽屉 | 1. 金额等宽对齐与清晰状态徽标（语义色+文字双重表达）<br>2. 点击订单展开右侧详情抽屉：订单号/备注一键复制、时间线与状态历史<br>3. 人工审核前明确展示风险边界，确认后等待服务端真实回执 | 1. `#adminRechargeView` 突出 `user_paid` 待审核订单，支持已加载订单状态筛选与详情抽屉<br>2. 明确提示「用户声明已付款不代表资金到账」，批准/拒绝按钮仅在 `user_paid` 显示并带防重入保护 |
| **GitHub Settings** (`github.com/settings`) | 权限分组、协作角色管理与危险操作确认 | 1. 明确区分所有者（Owner）与委派管理员（Delegated Admin）<br>2. 危险操作（封禁/删除/撤销角色/紧急关闭）置于独立隔离的 Danger Zone，附清晰影响说明与明确确认框 | 1. `#adminRolesView` 突出唯一站点所有者保护与委派管理员授权/撤销审计<br>2. `#adminEditModal` 内危险账户操作区独立成区并加固边距与高对比红色语义边界 |
| **TanStack Table / shadcn UI** (`tanstack.com/table`, `ui.shadcn.com`) | 响应式数据表格 + Sheet/Drawer 模式 | 1. 桌面端使用对齐列头的结构化数据表格/行网格，移动端切换为可读堆叠行卡片（不横向挤碎）<br>2. 桌面用右侧 `Sheet`（滑出抽屉），移动端用全宽/底部 `Drawer` | 1. 五大列表视图保留 `.admin-list-head[data-admin-cols]` 列对齐桌面端表格与移动端响应式行<br>2. 统一 `.admin-detail-drawer` 抽屉模式承载用户详情、订单审核详情、审计/反馈详情 |
| **Apple HIG & WAI-ARIA APG** (`w3.org/WAI/ARIA/apg/`) | 连续自然动效、Tabs、Table、Dialog 无障碍规范 | 1. 140–240ms 指数减速过渡，仅用 `transform`/`opacity`，全面兼容 `prefers-reduced-motion`<br>2. `tablist`/`tab`/`tabpanel` 方向键与 `Home`/`End`；`dialog`/`alertdialog` 焦点管理与 `Esc` 返回触发点 | 1. 抽屉与展开面板使用 `MOTION` 时长与 `--ds-ease-decelerate`；不破坏 0ms 瞬时 `:focus-visible`<br>2. 所有标签、抽屉、弹窗保持完整的 `role`、`aria-selected`、`aria-controls`、`aria-modal` 与焦点恢复 |
