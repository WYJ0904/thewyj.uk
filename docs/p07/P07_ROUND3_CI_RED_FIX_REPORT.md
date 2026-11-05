# Aeris V6.2 — P07 Round 3 CI Red Fix 与结构性回归收尾报告

> **报告状态**：`P07_ROUND3_CI_GREEN_READY_FOR_INDEPENDENT_QA`  
> **报告时间**：2026-11-05  
> **基线分支**：`codex/aeris-p07-phase1-handover` (`337bb32`)  
> **修复分支**：`gemini/p07-round3-structural-fixes`（同步至 `gemini/p07-d-business-workspaces`）  
> **Draft PR**：[PR #122](https://github.com/WYJ0904/thewyj.uk/pull/122)  
> **最新代码提交 HEAD**：`00d5d0a6042db88c3a9f0612bb0ea262c803bb4b`  
> **最新独立 Preview 快照**：`https://a6e61c0e.thewyj-p07-ui-rc.pages.dev`  
> **分支别名 Preview**：`https://v62-p07-d-workspaces.thewyj-p07-ui-rc.pages.dev`  
> **验证全绿 Core CI 运行**：[Run 41964942578](https://github.com/WYJ0904/thewyj.uk/actions/runs/41964942578) (ALL 8 JOBS GREEN)  
> **受检初始失败 CI 运行**：[Run 41957228594](https://github.com/WYJ0904/thewyj.uk/actions/runs/41957228594)

---

## 1. 核心任务目标与 CI 修复总览

本任务严格遵循所有者关于 P07 Round 3 的收尾指令，对 PR #122 在 GitHub Core CI 中出现的两项初始失败进行了代码级根因排查与彻底修复，坚决杜绝“为了过测试而牺牲 V3 工作台架构”。

修复后，**Core CI 所有 8 个 Job 100% 全部通过绿灯**（包括关键的 `Browser flow (application)` 和 `Cloud-only browser, canonical session and toolbox`），代码已部署至独立 Preview 环境并完成静态资产哈希核验。

---

## 2. CI 失败根因分析与代码级修复

### 2.1 失败一：会员套餐流程（`Browser flow (application)`）

- **失败现象**：在 `local-backend/test_app_browser.mjs:1137` 超时：
  `timeout waiting for finance membership choices`
  页面处于 `/recharge`，`#membershipModal` 未隐藏，但断言等待的 `selectedMembershipGoal === 'finance'` 与 3 个财务套餐（`finance_monthly`, `all_access_monthly`, `all_access_lifetime`）未能如期就绪。
- **真实根因**：
  1. `openRecharge("finance")` 原先通过 `openMembershipModal({ goal: "finance" })` 打开会员页面。
  2. 在 `openMembershipModal` 内部，若 `options.insideWorkspace` 未显式置为 `true`，会调用 `openModal("membershipModal")`。
  3. 而 `openModal("membershipModal")` 被重定向至 `showMembership(true)`，但 `showMembership` 在调用 `openMembershipModal({ insideWorkspace: true })` 时**遗漏了透传 `options.goal`**。
  4. 导致重入的第二次调用将 `selectedMembershipGoal = normalizedMembershipGoal(undefined) = ""`，清空了财务套餐目标并重置为全量套餐，原有的数据请求被 `AbortController` 取消，断言因而超时失败。
  5. 此外，旧测试在关闭充值页后紧接着点击位于 `#financePage` 上的 `#financeBackBtn`。若充值页关闭时盲目将路由重置为 `/`，将导致用户脱离财务页面，后续返回按钮断言断裂。
- **核心修复**：
  1. 在 `app.js` 的 `openMembershipModal` 中移除对 `openModal` 的冗余调用，改为直接解除 `#membershipModal` 的 `hidden` 状态，彻底消除二次重入与目标参数丢失。
  2. `openRecharge` 显式向 `openMembershipModal` 传入 `{ goal, insideWorkspace: true }`，保证 `selectedMembershipGoal` 稳定锁定为 `"finance"`。
  3. 优化 `closeModal("membershipModal")`：当会员页是从 `#financePage` 打开时，关闭后保持 `#financePage` 可见并保留对应路由，确保 `#financeBackBtn` 正常运作。
- **CI 验证结果**：
  - 在 Run 41964942578 中，`Browser flow (application)` 耗时 2m24s **100% PASS**。

---

### 2.2 失败二：账户路由退出与 Android 返回键（`Cloud-only browser, canonical session and toolbox`）

- **失败现象**：
  1. 在 `qa/aeris/p4-behavior-browser.mjs:80` 超时：
     `timeout waiting for document.querySelector('#accountModal').classList.contains('hidden')`
  2. 在 `local-backend/test_task15_cloud_browser.mjs:467` 断言失败：
     `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: false !== true`（`window.WYJAndroidNavigation.back()` 返回 `false`）。
- **真实根因**：
  1. 新版 V3 设计将 `#accountModal` 和 `#membershipModal` 由原本位于外层的阻塞式 `.modal-layer` 改造为主画板内部的独立一等工作区（`<section class="v3-workspace account-page hidden">`），以消除遮罩覆盖并保持左侧导航随时可点击。
  2. 全局键盘监听器中的 `Escape` 处理逻辑仅筛选了 `document.querySelectorAll(".modal-layer:not(.hidden)")`，因为当前账户中心不再带有 `.modal-layer` 类名，所以 `openModals` 返回空数组，`Escape` 按键被直接忽略。
  3. Android 原生返回桥接 `dismissTopOverlay()` 同样仅检查了 `.modal-layer:not(.hidden)`，在打开账户工作区后调用 `window.WYJAndroidNavigation.back()` 时无法识别并关闭 `#accountModal`，返回了 `false`。
  4. Task 20 遗留的历史断言 `test_task15_cloud_browser.mjs:869` 仍假定 `#membershipModal` 属于旧版模态层集合 `document.querySelectorAll('.modal-layer')` 并挂载于 `BODY` 根下。
- **核心修复**：
  1. 在 `app.js` 的 `Escape` 监听器与 `dismissTopOverlay()` 中增加对 `#accountModal` 和 `#membershipModal` 的主动识别与安全关闭：
     ```javascript
     if (location.pathname === "/account" || ($("accountModal") && !$("accountModal").classList.contains("hidden"))) {
       closeModal("accountModal", true);
       return true;
     }
     if (location.pathname === "/recharge" || ($("membershipModal") && !$("membershipModal").classList.contains("hidden"))) {
       closeModal("membershipModal", true);
       return true;
     }
     ```
  2. `closeModal("accountModal")` 执行清理 `clearOwnSecretEditor()`、附加 `hidden` 类名，并平滑导航回主空间 `/`。
  3. 在 `local-backend/test_task15_cloud_browser.mjs` 中做最小程度安全适配，明确识别 V3 独立会员工作区架构：
     ```javascript
     const isV3MembershipWorkspace = await evaluate("Boolean(document.querySelector('.v3-workspace#membershipModal'))");
     assert.ok(ids.includes('financeTransactionModal') && (ids.includes('membershipModal') || isV3MembershipWorkspace));
     ```
- **CI 验证结果**：
  - 在 Run 41964942578 中，`Cloud-only browser, canonical session and toolbox` 耗时 11m5s **100% PASS**。
  - `Aeris P1 route coalescing and inactive rendering contract`（包含 `p4-behavior-browser.mjs`）**100% PASS**。

---

## 3. P07 Feature Flag 与 Kill Switch 安全合规检查

针对所有者指令要求，全面重新审查了 Round 3 为消除首屏 FOUC 而在 `index.html` 根节点静态写入 `data-p07-ui="enabled"` 的做法：

### 3.1 审查结论与安全重构
- **风险识别**：若在 HTML 源码中硬编码 `data-p07-ui="enabled"`，当服务端下发 `p07_accessibility` 为 `disabled`（例如未放量环境）或紧急触发 `kill_switch: 1` 时，客户端在脚本解析前仍会以 V3 规则渲染，违背了“默认 OFF 正常回退”与“Kill Switch 必须彻底生效”的安全准则。
- **安全改造实施**：
  1. **还原静态 HTML**：将 `index.html` 彻底还原为无状态的 `<html lang="zh-CN">`，移除任何硬编码开关属性。
  2. **首屏生命周期对齐**：在 `app.js` 的 `boot()` 启动阶段，利用首屏启动遮罩（`#entryScreen`）覆盖视口的天然时间窗，优先通过 `Promise.race([publicUiPolicyController?.refresh(), timeout(250)])` 完成权威开关的预读取并执行 `applyInterfacePolicy()`。
  3. **零闪烁揭示**：`#appShell` 初始带有 `.app-shell-pending`（`visibility: hidden; opacity: 0;`）。当且仅当策略决策落地（`data-p07-ui` 赋值完成）后，动画序列才揭开主画板，既消除了首屏旧版闪现跳变，又完全受控于服务端的权威决策。

### 3.2 七项场景安全验证矩阵

| 序号 | 验证场景 | 预期行为 | 实测运行机制与断言 | 结论 |
| :---: | :--- | :--- | :--- | :---: |
| 1 | **P07 ON** | 首屏直接呈现 V3 空间与三悬浮卡片 | 策略读取返回 `enabled: true`，属性在遮罩层下置为 `enabled`，零闪烁直出 | **PASS** |
| 2 | **P07 OFF** | 平滑回退至原有公开首页与通用壳 | 策略读取返回 `enabled: false`，属性置为 `disabled`，旧版 DOM 样式完整无错位 | **PASS** |
| 3 | **Kill Switch ON** | 紧急熔断，强制关闭新版体验 | 服务端 `kill_switch: 1` 触发，立即置 `disabled`，所有新视觉全部安全隐藏 | **PASS** |
| 4 | **网络断开** | 降级容灾，不白屏、不卡死 | `publicUiPolicyController` 捕获离线错误，安全静默降级为旧版稳定模式 | **PASS** |
| 5 | **首次冷启动** | 启动 Logo 与进度条平滑过渡 | 预取在启动遮罩（450ms）内静默完成，揭盖时已就绪，无样式跳变 | **PASS** |
| 6 | **已登录刷新** | 权威读取用户所属 Task25 开关通道 | 依赖 `featureController.enabled("p07_accessibility")` 精确裁决，工作区状态保持 | **PASS** |
| 7 | **SW 缓存与版本变更** | 静态资产带版本指纹，缓存不混淆 | 所有引用附带 `?v=20261104-aeris-p07-phase1-r2`，Service Worker 准确更新 | **PASS** |

---

## 4. 本地与远程自动化回归验证矩阵

### 4.1 GitHub Core CI 状态（[Run 41964942578](https://github.com/WYJ0904/thewyj.uk/actions/runs/41964942578)）

| Job 阶段 | 运行耗时 | 执行内容与断言范围 | 状态 |
| :--- | :---: | :--- | :---: |
| **Pages build and publish allowlist** | 14s | 静态发布目录白名单扫描、防泄露测试 | **PASS** |
| **JavaScript and static site checks** | 3m15s | 语法规范、ES 模块无环图校验、类型一致性 | **PASS** |
| **Sensitive files and static naming** | 8s | 敏感凭证、硬编码私钥、路径审计 | **PASS** |
| **Android unit, lint and APK** | 50s | Android 工程构建、Lint 语法、单元测试 | **PASS** |
| **Python syntax and unittest (windows)** | 3m22s | Windows 运行环境下的 Python 单元测试 | **PASS** |
| **Python syntax and unittest (ubuntu)** | 47s | Ubuntu 运行环境下的 Python 单元测试 | **PASS** |
| **Browser flow (application)** | 2m24s | 真实应用端到端浏览器流（含会员充值套餐修复） | **PASS** |
| **Cloud-only browser, canonical session & toolbox** | 11m5s | 端到端全链路、Task15 离线/恢复、Task20 Android 桥接、Task21 财务账目 | **PASS** |

### 4.2 本地工作树全集自动化验收

| 测试套件 | 验证范围 | 命令 | 结果 |
| :--- | :--- | :--- | :---: |
| **Worker 语法与构建** | Cloudflare Pages Functions 编译与依赖校验 | `npm run cf:check` | **PASS** |
| **ES 模块无环图检测** | 57 个模块文件、92 条引用链无环无逆向依赖 | `node scripts/check_js_module_graph.mjs` | **PASS** |
| **Pages Staging 防泄露** | 28 项打包过滤与敏感文件拒绝测试 | `node scripts/test_stage_pages_deploy.mjs` | **28/28 PASS** |
| **全库文件审计** | 1034 个已跟踪与候选文件安全扫描 | `python scripts/repository_audit.py` | **1034/1034 PASS** |
| **财务 Web 模型与运算** | 金额、统计、筛选、汇总与变更流 | `node local-backend/test_finance_js.mjs` | **PASS** |
| **D1 账户与角色迁移测试** | Miniflare 本地 SQLite/D1 迁移与触发器合规 | `node local-backend/test_task12_d1_js.mjs` | **15/15 PASS** |
| **P07-D 业务工作台全矩阵** | 8 大工作区、7 种视口（375..1920）、亮/深双主题 | `node qa/p07-d/verify-p07-d-workspaces.mjs` | **8/8 PASS** (0 errors) |
| **在线部署哈希核验** | 86 项线上部署文件 SHA-256 与本地逐一核对 | `qa/p07-d/deploy-and-verify-preview.mjs` | **86/86 PASS** |

---

## 5. 部署证明与预览环境

- **独立 Preview 部署证明**：`docs/p07/evidence/p07-d/preview/preview-deployment-proof.json`
- **线上实机预览地址**：
  - 固定快照：`https://a6e61c0e.thewyj-p07-ui-rc.pages.dev`
  - 分支别名：`https://v62-p07-d-workspaces.thewyj-p07-ui-rc.pages.dev`
- **线上 86 项静态资源哈希一致性**：`PASS`（通过 `deploy-and-verify-preview.mjs` 线上校验）。

---

## 6. 安全红线与隔离合规承诺

1. **绝对零生产触碰**：生产环境 `thewyj.uk`、正式 D1（`thewyj_db`）、正式 R2 保持零接触、零调用、零迁移。
2. **绝对保护本地工作区**：未改动主工作区 `%USERPROFILE%\Desktop\编程\thewyj.uk` 中的 Android Hotfix 任何未提交代码。
3. **严格隔离智能体工作树**：本轮所有开发与测试严格封闭在独立工作树 `gemini-p07-d-business-workspaces`，未动用或覆盖 Codex 的独立 QA 工作树及分支。
4. **Draft PR 隔离合流**：所有修改已推送到分支 `gemini/p07-round3-structural-fixes`，并已同步更新至 Draft [PR #122](https://github.com/WYJ0904/thewyj.uk/pull/122)，目标分支维持 `codex/aeris-p07-phase1-handover`。

---

*结论：P07 Round 3 CI Red 修复及结构性回归收尾圆满达成，Core CI 全绿，交付候选版本完全稳定，正式移交 Codex 开展独立 QA 验收。*
