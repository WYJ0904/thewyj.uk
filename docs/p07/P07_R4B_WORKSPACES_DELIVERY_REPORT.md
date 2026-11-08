# Aeris V6.2 — P07-R4-B V3 工作区重构与用户体验完善交付报告

- **报告标识**：`P07_R4B_READY_FOR_INTEGRATION`
- **交付分支**：`gemini/p07-r4b-workspace-rework`
- **同步目标 PR**：PR #122（`gemini/p07-d-business-workspaces` -> `codex/aeris-p07-phase1-handover`）
- **独立 Preview**：
  - 静态快照：`https://33cc47b2.thewyj-p07-ui-rc.pages.dev`
  - 稳定别名：`https://v62-p07-d-workspaces.thewyj-p07-ui-rc.pages.dev`
- **基线 HEAD**：`f7949f8253f51ea2621c397743208971c0cec467`
- **交付 HEAD**：`295de94`

---

## 一、最高优先级约束执行：官方 Aeris Logo 保护

- [x] **绝对保留官方 Logo 资产**：全站 Header、侧边栏、Drawer、Favicon、PWA Manifest 以及移动端启动图标均完整保留官方现有设计与矢量路径。
- [x] **杜绝错误图稿**：未采用任何由 ChatGPT 概念图生成的新式或变形 Logo，官方 Aeris 品牌视觉资产 0 修改、0 替换。

---

## 二、所有者真实反馈与缺陷闭环

### 1. P0 账户中心全面 V3 重构（依据 `07-账户及现有设置.png`）
- **消除遮罩与弹窗限制**：移除容器上的 `role="dialog"`、`aria-modal="true"` 及内部限制宽度的 `.modal-panel` 浮层样式，转换为全宽响应式工作台。
- **Layer 1 顶部标题区**：规范化页面标题为「我的账户 · 设置与偏好」，提供清晰的功能导引与层级认知。
- **Layer 2 双摘要卡片（个人资料 + 同步本地状态）**：
  - **个人资料卡片**：展示用户头像徽标、用户名（`#accountProfileUsername`）、角色徽章（`#accountProfileRoleBadge`，支持站点所有者/管理员/普通账户/会员等级）、用户 ID 及注册时间。
  - **同步与本地状态卡片**：展示云端状态（Cloudflare D1 已连接/离线模式）、本地持久化状态（按版本迁移就绪）与即时同步健康度。
- **Layer 3 详细设置与权益（保留 8 项核心配置）**：
  - 遵循 `qa/aeris/p4-behavior-browser.mjs` 测试契约，保持 `#accountDetails > .account-setting-row` 结构精确为 8 项，以网格卡片流方式优雅排布。
  - 完整呈现体验通道选择（`#releaseChannelSection`）与登录密钥安全修改（`#changeSecretForm`）。
- **Layer 4 危险操作区**：注销账户模块（`#openDeleteAccountBtn`）独立置于底部风险区域，清晰提示数据清除影响。
- **滚动体验优化**：彻底消除多层嵌套滚动条与内外滚动重叠，全页面统一随主画布顺畅滚动。

### 2. P0 会员中心全面 V3 重构（依据 `06-会员与人工审核.png` & `12-扫码支付与人工审核.png`）
- **消除遮罩与弹窗限制**：移除 `role="dialog"` 与 `aria-modal="true"`，转为主画布宽屏工作台。
- **流程指示步进器**：顶部呈现 4 步清晰指引（1. 选择功能与套餐 -> 2. 扫码支付与备注 -> 3. 管理员人工核对 -> 4. 权益生效与同步）。
- **用途选择器（7 胶囊选项）**：只学英语、只学日语、英语和日语、只用工具箱、只用财务、只用通知保存、全部功能。
- **套餐卡片网格**：根据用途动态展示对应套餐（含 8 CNY/月 财务、8 CNY/月 通知、30 CNY/月 全功能推荐、100 CNY 全功能终身等）。
- **订单与人工审核双卡布局**：
  - **左卡（订单详情）**：显示会员方案、支付方式、应付金额、订单编号（支持一键复制）、付款备注（支持一键复制）与订单状态。
  - **右卡（扫码与审核进度）**：集成专属私有收款码（`#paymentQrWrap`）与 4 步审核时序状态轴（步骤 1 创建 -> 步骤 2 扫码并备注 -> 步骤 3 24 小时内核对 -> 步骤 4 跨端生效）。
- **操作闭环**：保持所有原有按键与状态机完整可用，支持「确认订单并显示二维码」、「我已付款」、「取消并更换」。

### 3. P1 财务走势图折叠与图表优化
- **新增折叠/展开控制**：在走势图标题栏右侧增加 `#toggleFinanceTrendBtn`（「收起走势图」/「展开走势图」），具备完善的 `aria-expanded` 状态联动。
- **高度释放**：收起走势图时容器瞬间折叠收起，大幅释放首屏纵向空间，满足用户快速查看流水列表的需求。
- **Y 轴标签单位清洗**：对大额金额进行优雅紧凑格式化（>= 1 亿格式化为 `¥x.x亿`，>= 1 万格式化为 `¥x.x万`），动态自适应左边距（76px ~ 94px），彻底杜绝极端大额数字重叠或被画布左侧截断。
- **丰富 Hover / Focus 交互**：折线数据点（`<circle>`）增加了同时包含月份、收入、支出、净结余的详细 Tooltip（`<title>`）与无障碍可读标签（`aria-label`）。
- **真实空状态保护**：无数据时优雅展示月度对比空状态与引导。

### 4. P1 金额校验颗粒度诊断提示
- **根因分析**：原代码直接使用正则 `\d{0,10}` 检验整数部分，超过 1000 亿元（如用户测试输入的 `123131231312`）会静默返回 0，导致直接触发兜底的「请输入大于 0 且最多两位小数的金额」，造成提示不准确与困惑。
- **解决方案**：引入 `validateAmountText` 独立校验引擎，分级精确反馈：
  1. 空值：提示「请输入金额」
  2. 非数字字符：提示「请输入纯数字的有效金额」
  3. 小数位超限：提示「金额最多支持两位小数」
  4. 整数位/总额超限：明确提示「金额超出系统最大上限（最高支持 1000 亿元）」
  5. 小于等于 0：提示「请输入大于 0 的有效金额」
- 在记账提交（`submitTransaction`）与预算设定（`submitBudget`）中全量接入。

### 5. P1 日语练习非阻塞交互改造
- **根因分析**：`ensureJapaneseQuestionForms` 在离线、词库解析失败或 AI 降级时调用了浏览器原生 `alert()`，造成弹窗阻断操作。
- **非阻塞式改造**：
  - 彻底移除 `alert()` 调用。
  - 接入 Aeris V3 非阻塞式 Toast（`showAchievementToast`）并同步在界面 `#answerValidation` 显示行内提示，测试流程顺畅不被阻断。
  - 更新 `local-backend/test_task15_cloud_browser.mjs` 测试断言，支持捕获 Toast 及行内验证文本，保证 CI 自动化回归 100% 绿色。

### 6. R3-01 单一主表面（Single Primary Surface）修复
- **根因分析**：在财务页面点击升级会员时，`openRecharge` 直接解除了 `membershipModal` 的隐藏状态，未调用 `hidePrimaryScreens()`，导致 `#financePage` 与 `#membershipModal` 在 DOM 中同时处于可见状态。
- **解决方案**：
  - `openRecharge` 记录 `state.membershipReturnPath = "/finance"` 并调用 `showMembership(true, { goal })`（内部执行 `hidePrimaryScreens()`）。
  - 在 `closeModal("membershipModal")` 中检测若存在返回路径 `/finance`，则自动切换路由回 `/finance` 并恢复 `#financePage` 与 `#financeBackBtn`。
  - 完美符合独立 QA 的单一主工作台隔离标准。

---

## 三、工程验证与质量门禁结果

| 验证项 | 范围 / 目标 | 结果 | 耗时 / 详情 |
| :--- | :--- | :--- | :--- |
| **Pages Staging Allowlist** | `node scripts/test_stage_pages_deploy.mjs` | **28/28 PASS** | 2079ms，零敏感资产泄露 |
| **ES Module Graph** | `node scripts/check_js_module_graph.mjs` | **PASS** | 57 文件，92 个引用，无环依赖 |
| **Repository Audit** | `python scripts/repository_audit.py` | **PASS** | 1034 个代码文件与分支状态审计通过 |
| **Cloudflare Worker Compile** | `npm run cf:check` | **PASS** | Functions 构建编译成功 |
| **P07-D 业务工作台真机矩阵** | `node qa/p07-d/verify-p07-d-workspaces.mjs` | **8/8 PASS** | 覆盖 7 种视口（375/390/412/768/1024/1440/1920）与双主题，0 运行期错误，0 弹窗 |
| **财务 Web 模型与 D1 测试** | `npm run test:task17` | **PASS** | 货币单位、合并逻辑、D1 支付与权限隔离完全正常 |
| **Aeris 状态一致性测试** | `npm run test:aeris-state` | **13/13 PASS** | 状态流转、候选项核对、本地账本无残留 |
| **独立 Preview 在线静态校验** | `qa/p07-d/deploy-and-verify-preview.mjs` | **PASS** | 86 项静态资源 SHA-256 线上一致性比对通过 |

---

## 四、建议与后续步骤

1. **推送并同步 PR #122**：将 `gemini/p07-r4b-workspace-rework` 推送并合并至 PR #122（目标分支 `codex/aeris-p07-phase1-handover`），触发 GitHub Core CI 跑通。
2. **所有者真实浏览器人工验收**：
   - 访问 Preview：`https://v62-p07-d-workspaces.thewyj-p07-ui-rc.pages.dev`
   - 检验 `/account`：顶部个人资料卡与同步卡、8 项设置行、无内部滚动条。
   - 检验 `/recharge`：4 步流程、7 胶囊过滤、订单与人工审核双卡布局。
   - 检验 `/finance`：走势图折叠按钮、大额金额输入诊断提示（如输入超大数字时的友好报错）。
   - 检验 `/language`：日语练习启动过程无阻塞式 `alert`。
