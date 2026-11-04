# Aeris V6.2 — P07 视觉与功能缺陷集中修复与 V3 设计还原交付报告

- **最终结论状态**：`P07_VISUAL_AND_FUNCTIONAL_REWORK_READY_FOR_OWNER_REVIEW`
- **基线与分支**：
  - 基线 PR：PR #121（分支 `codex/aeris-p07-phase1-handover`，基线 Commit `337bb32f1ce349f9c5d58bd6120932fa5e61a745`）
  - 本轮开发分支：`gemini/p07-d-business-workspaces`
  - 核心修复提交 Commit：`d28d21a5a8b952b6440f3558500d1c43e3e208e5`
  - 关联 Pull Request：Draft PR #122 (https://github.com/WYJ0904/thewyj.uk/pull/122)
  - PR 目标分支：`codex/aeris-p07-phase1-handover`（严格以已认可的 PR #121 为基线，绝不直接合入 `main`）
  - 远程 Core CI Run：`41831725422` (https://github.com/WYJ0904/thewyj.uk/actions/runs/41831725422)
- **独立 Hosted Preview（当前实时验证部署）**：
  - 部署固定地址：https://93ffacea.thewyj-p07-ui-rc.pages.dev
  - 分支别名地址：https://v62-p07-d-workspaces.thewyj-p07-ui-rc.pages.dev
  - Pages 项目：`thewyj-p07-ui-rc`
  - 部署 Commit：`d28d21a5a8b952b6440f3558500d1c43e3e208e5`
  - 部署 ID：`93ffacea-c424-4402-9e28-8d00d0d5d76e`
  - 隔离 D1 数据库：`ee869f78-b54a-4018-bc99-871089ecb8cd`（0 R2 绑定，0 AI 绑定，完全隔离，Production 未触碰）
  - 静态资源校验：86 项公开静态资源 SHA-256 100% 匹配，HTTP 200，0 运行时报错
- **测试账号信息**：
  - 用户名：`qa_lifetime_member`
  - 权限：全功能永久会员（`all_access_lifetime`，包含语言学习、在线工具箱、财务账本、通知历史保存）
  - 说明：已在独立 Preview D1 数据库中初始化并完成端到端登录、状态读取与退出重登权益保持验证。不涉及任何真实转账或生产账户。

---

## 一、所有者验收缺陷与 V3 设计还原逐项解决清单

### 1.1 P07-D-001：语言学习工作台结构与答题尺寸返工（P0 优先级）
- **问题现状**：访问英语/日语学习页面时，垂直堆叠了掌握度、词表输入和答题卡片；答题卡片过窄、两侧留白过大；未答题或切换 Tab 时下方残余答题区域暴露。
- **参考设计**：`02-语言学习-沉浸答题.png` 与 `03-错题与Mastery.png`。
- **工程修复与落地**：
  1. **严格视图互斥隔离**：修复 CSS 特异性缺陷，在 `spatial-experience.css` 中增加 `html[data-p07-ui="enabled"] .view:not(.active) { display: none !important; }` 与 `html[data-p07-ui="enabled"] #quizView:not(.active) { display: none !important; }`，彻底根除 ID 选择器覆盖 `.view` 隐藏样式的漏洞。
  2. **双卡沉浸式答题排布**：`#quizView.active` 采用 V3 标准双列网格排布（`grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr); gap: 24px;`），左侧为大字题目词卡片、音标与输入交互，右侧为评测反馈卡片；小屏幕（`<=920px`）自适应单列。
  3. **掌握度面板（Mastery）归位**：将 `#masterySection` 从默认全局堆叠中抽离，仅在切换到“错题”视图（`#workspace[data-active-view="wrongView"]`）时展示，使“词表”与“答题”视图纯净专注。

### 1.2 P07-D-002：双语数据隔离与答题状态残留 Bug（P0 优先级）
- **问题现状**：访问日语页面时，输入框上方或下方残留英语词汇（如 `bird`）及上一次未完成的进度数值。
- **根因分析**：
  1. `#quizView` 之前未加 `:not(.active)` 隐藏，导致其即使在非激活状态下也常驻显示在词表输入框下方。
  2. `enterProject()` 切换语言时，只加载了偏好配置，未主动清理 DOM 中残存的 `#wordText`、`#wordReading`、`#progressLabel`、`#scoreLabel`、`#answerInput`，且未通知 `masteryController` 刷新。
- **工程修复与落地**：
  1. 在 `app.js` 的 `enterProject()` 与 `restoreProjectRuntime()` 中，在无进行中测试或切换语言时，主动将 `#wordText` 重置为 `"-"`，隐藏 `#wordReading`，重置进度标签为 `"0/0"`、得分标签为 `"得分 0"`，清空输入框并隐藏反馈面板。
  2. 显式调用 `masteryController?.update()`，确保掌握度数据随测试语言即时重新读取。
  3. 编写无头浏览器自动化断言：切换至日语时断言 `quizView` 计算样式为 `display: none`，且 `#wordText` 绝不等于 `bird`，已 100% 自动化通过。

### 1.3 P07-D-003：日语发音与离线降级体验（P1 优先级）
- **问题现状**：离线或 Workers AI 未开通时，进行日语题目校验或发音可能弹出阻塞式浏览器 `alert()` 弹窗。
- **工程修复与落地**：
  1. 将 `ensureJapaneseQuestionForms()` 中关于 AI 暂时不可用、未收录假名或网络受限的 `alert(...)` 阻塞调用，全面改造为内联非阻塞浮层 `showAchievementToast(...)`。
  2. 释义练习在离线或规则模式下平滑继续，不再强制弹窗阻断答题心流。

### 1.4 P07-D-004：首页三张悬浮卡片内容防重叠（P1 优先级）
- **问题现状**：卡片内的“继续使用 →”CTA 按钮与底部的“移动 / 缩放 / 旋转”操作提示文字发生挤压与叠字。
- **工程修复与落地**：
  1. 在 `spatial-experience.css` 中增加规则：当卡片存在激活的操作按钮（`[data-has-continue="true"]`）时，自动强制隐藏底部的被动提示文案 `.home-widget-affordance { display: none !important; }`。
  2. 将 `.home-widget-continue` 设定为精致的底栏胶囊操作按钮（`position: absolute; bottom: 12px; right: 14px; z-index: 4;`），带有微发光与点击反馈，与卡片文字完全解耦。

### 1.5 P07-D-005 & P07-D-006：首页底部摘要网格高度优化与全卡点击响应（P1 优先级）
- **问题现状**：`.home-v3-summary-grid` 最小高度达 142px，卡片内留白过大；点击空白区域无反应，仅有点中文本才触发跳转。
- **工程修复与落地**：
  1. **高度紧凑化**：将 `.v3-summary-card` 最小高度从 142px 压缩至 114px，内边距调整为 `16px 18px 14px`，副标题间距从 18px 降至 12px，完全贴合 `01-首页-三悬浮卡片.png` 的精炼质感。
  2. **防遮挡与全表面可点击**：给 `.home-v3-summary-grid` 设置 `position: relative; z-index: 5;`，防止三卡 3D 旋转的不可见外框阻挡点击事件；在 `app.js` 中为每个卡片容器绑定直接点击路由分发，并设置 `:active` 缩放按下反馈（`scale(0.985)`），确保点击卡片任何像素均立即完成路由切换。

### 1.6 P07-D-007 & P07-D-008：财务走势图真实渲染与多币种边界（P1 优先级）
- **问题现状**：财务页面缺少真实走势图；移动端输入框拥挤；多币种缺少清晰架构边界。
- **参考设计**：`04-财务账本-走势与多币种.png` 与 `05-扫码记账候选.png`。
- **工程修复与落地**：
  1. **真实数据 SVG 走势图**：在 `#financeWorkspace` 中新增 `#financeTrendSection`，由 `js/finance/app.js` 的 `renderTrendChart()` 驱动。按最近 6 个月聚合统计真实收支流水，生成包含网格基线、刻度标签、收入（翡翠绿 `#10b981`）与支出（珊瑚红 `#ef4444`）双折线平滑走势及数据节点浮层。
  2. **优雅空状态（Empty State）**：若当前账户无流水，优雅呈现虚线圆角空状态卡片与说明引导：“暂无月度收支走势数据，记录你的第一笔收支或从手机同步账本后，将在此自动生成月度收支对比与走势曲线”，绝无破损空容器。
  3. **多币种边界明确**：前端默认标明“人民币 (CNY)”，明确注明多币种能力（USD, JPY, EUR 等）由 PR #112 / #118 后端网关支持，不凭空捏造虚假的前端假多币种交互。

### 1.7 P07-E-001：会员中心重构为 V3 工作台（P1 优先级）
- **问题现状**：访问 `/recharge` 仅弹出居中小遮罩弹窗，与 V3 左侧导航和空间架构割裂。
- **参考设计**：`06-会员与人工审核.png` 与 `12-扫码支付与人工审核.png`。
- **工程修复与落地**：
  1. **全屏工作区排布**：在 `html[data-p07-ui="enabled"]` 下，将 `#membershipModal` 改造为主画布内的全屏工作区容器（桌面端位于左侧导航栏右侧，移动端占满可用视口），保持左侧导航常驻且“会员”高亮。
  2. **4 阶段流程指示条（Stepper）**：顶栏呈现“1. 选择功能与套餐 -> 2. 扫码支付与备注 -> 3. 管理员人工核对 -> 4. 权益生效与同步”的标准化进度条。
  3. **4 套餐栅格排布**：按设计还原 4 大套餐（财务增强月度 8 CNY、通知推送月度 8 CNY、全功能月度会员 30 CNY、全功能永久会员 100 CNY），呈现大字价格、包含权益与高亮选中卡片。
  4. **完整保留后端映射**：扫码收款、复制订单号、复制打款备注、我已付款提交与管理员审核进度轮询等既有底层能力 100% 保持正常工作。

### 1.8 P07-E-002：账户设置重构为 V3 工作台（P1 优先级）
- **问题现状**：访问 `/account` 仅弹出超长表单弹窗。
- **参考设计**：`07-账户及现有设置.png`。
- **工程修复与落地**：
  1. **空间工作台模块流**：将 `#accountModal` 升级为模块化工作区卡片流：
     - **基本信息与凭证**：大号用户头像初始字符、用户名、用户 ID、登录时间及状态徽章。
     - **体验通道选择**：Stable / Beta / Experimental 独立设置卡片。
     - **安全密钥修改**：独立表单卡片，支持生成安全密钥与保存退出。
     - **注销账户危险区**：独立警示红框卡片。
  2. 左侧导航保持同步高亮，关闭后平滑返回个人首页。

---

## 二、Codex 独立 QA 成果吸收与验证

依照所有者指令，已对 Codex 独立 QA 分支成果进行安全吸收与断言校正：
1. **c62e833（管理员反馈审计日志）**：
   - 在 `functions/_lib/task11-service.mjs` 中接入 `readFeedbackAudit` 与 `listFeedbackAudit`。
   - 在 `functions/_lib/task12-api.mjs` 的 `/api/admin/audit` 聚合接口中纳入 `flags.task11CloudReads` 反馈审计。
   - `local-backend/test_task12_d1_js.mjs` 增补断言并通过验证（15/15 PASS）。
2. **91a06fc（视口高度缩放遮挡防护）**：
   - 在 `spatial-experience.css` 中合入 `@media (max-height: 600px)` 规则，防止浏览器 200%/400% 缩放时顶栏与提示条遮挡可聚焦表单。
3. **flash-readable-tabs.patch（禁用标签可读性）**：
   - 在 `spatial-experience.css` 中将 `#workspace .tabs button:disabled` 的 `opacity` 提升至 `1`，确保文字对比度符合 WCAG AA 规范。
4. **报告真实性断言校正**：
   - 纠正原报告中将离线测试桩断言表述为“真实 AI / 真实语音完全通过”的过度断言；明确标注当前测试环境为离线规则降级与本地 Mock，生产环境需等待上游接口就绪。

---

## 三、自动化测试与多视口验证证据

### 3.1 本地测试门禁通过记录
- `node scripts/test_stage_pages_deploy.mjs`：28/28 测试全部通过。
- `python scripts/repository_audit.py`：1031 项跟踪与候选文件审计 100% 通过，0 密钥泄露。
- `node local-backend/test_task12_d1_js.mjs`：15 项 Miniflare/D1 审计与鉴权测试全部通过。
- `node local-backend/test_finance_js.mjs`：财务模型与收支聚合计算全部通过。
- `node local-backend/test_task25_client_js.mjs`：19 项前后端契约向量通过。
- `node --test local-backend/test_aeris_state_consistency.mjs`：13 项一致性测试全部通过。
- `npm run cf:check`：Cloudflare Worker/Functions 编译 100% 成功。

### 3.2 真实 Chromium 浏览器全视口与全工作台矩阵审计
执行 `node qa/p07-d/verify-p07-d-workspaces.mjs`，在真实 Chromium 浏览器中完成以下检查：
- **审计工作台**：
  1. `P07-03`: Personal Space (Dashboard) —— PASS
  2. `P07-04`: Language Learning & Immersive Quiz —— PASS
  3. `P07-05`: Mastery, Wrong Questions & Stats —— PASS
  4. `P07-08`: Toolbox & Tool Workbench —— PASS
  5. `P07-06`: Finance Ledger Workspace —— PASS
  6. `P07-E-001`: Membership Workspace —— PASS
  7. `P07-E-002`: Account Workspace —— PASS
  8. `P07-07`: Candidate Verification —— PASS
- **视口覆盖**：375px, 390px, 412px, 768px, 1024px, 1440px, 1920px。
- **主题覆盖**：Light / Dark。
- **运行时指标**：`runtimeErrorsCount: 0`，`dialogsCount: 0`。
- **产出截图保存目录**：`docs/p07/evidence/p07-d/`

---

## 四、远程 CI 与独立 Preview 验收入口

1. **Pull Request**：
   - PR #122：https://github.com/WYJ0904/thewyj.uk/pull/122
   - 目标分支：`codex/aeris-p07-phase1-handover`
   - 最新 Commit：`d28d21a5a8b952b6440f3558500d1c43e3e208e5`
2. **GitHub Core CI**：
   - Run URL：https://github.com/WYJ0904/thewyj.uk/actions/runs/41831725422
3. **独立 Hosted Preview 在线验收地址**：
   - 固定地址：https://93ffacea.thewyj-p07-ui-rc.pages.dev
   - 分支别名：https://v62-p07-d-workspaces.thewyj-p07-ui-rc.pages.dev
4. **全功能永久会员测试凭证（仅限独立 Preview D1）**：
   - 用户名：`qa_lifetime_member`
   - 会员权益：全功能永久会员（`all_access_lifetime`）
   - 状态验证：密码登录正常、会员状态实时呈现、所有业务工作台无锁畅通、登出重登权益完美保持。
