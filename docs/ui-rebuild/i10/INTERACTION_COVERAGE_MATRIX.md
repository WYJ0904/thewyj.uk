# Aeris V6.3 — I10｜全站交互与动效覆盖矩阵（Interaction Coverage Matrix）

- **阶段定位**：I10 — Full-Site Motion Audit / Full-Site Interaction Acceptance（I 系列最终交互质量审计与修复阶段；不开启 I11，不进行视觉重设计）。
- **设计基线状态**：Owner 已正式接受并**冻结** PR #178（`hydrogen/i-v6-ui-ux-quality-rework`, `dcfe77a3202541460c88f9e3067668af0b3402f5`）的视觉方向；I10 仅针对交互缺陷、可读性、WCAG 对比度、布局/遮挡、动效一致性与性能开展外科手术式修复。
- **代码基准 SHA**：`942f40f4cebf4bb0f9988b95292162a2fb679ee0`（分支 `hydrogen/i10-full-site-interaction-acceptance`）。
- **功能完整性门禁**：`python scripts/functional_audit_gate.py` -> **PASS**（完整保留 **27 个路由、24 个业务流程、104 个工具、51 个工具模式、7 个复选框控件、12 类工作流能力、27 个工作流流程**，零功能删减）。

---

## 1. 全站路由与模块审计清单（27 Routes）

| # | 路由 / 入口 | 所属模块 | I10 审计结论 | 本阶段改动 / 验证依据 |
|---:|---|---|---:|---|
| 1 | `/` | 公开主页 + 登录后工作台 | **FIXED** | 预览 Tab 切换零滚动跳变（`before=yAfter`）；桌面/移动端密度切换 FLIP 关闭 `flipScale` 修复按钮遮挡（`js/core/home-widgets.js`）；时间问候绑定真实账户与本地时段，未登录不泄露账户名。 |
| 2 | `/login` | 认证入口 | `NO_CHANGE_REQUIRED` | 表单校验、回车提交、错误态与返回 `/` 会话恢复在本地/Hosted/CI 回归通过。 |
| 3 | `/register` | 注册入口 | `NO_CHANGE_REQUIRED` | 条款勾选与真实注册跳转 `/login` 在 `verify-preview.mjs` 与 `test_task18_browser.mjs` 通过。 |
| 4 | `/trial` | 试用体验 | `NO_CHANGE_REQUIRED` | `qa/i03`、`qa/aeris/p3-brand-public-browser.mjs` 路由切换、滚动恢复与返回行为通过。 |
| 5 | `/changelog` | 更新日志 | `NO_CHANGE_REQUIRED` | `qa/i03` 公开路由矩阵、Light/Dark 与 0px 溢出验证通过。 |
| 6 | `/download` | 客户端下载 | `NO_CHANGE_REQUIRED` | `qa/i03` 公开路由与多视口通过，保留现有 APK 下载与校验策略。 |
| 7 | `/privacy` | 隐私政策 | `NO_CHANGE_REQUIRED` | 由 `qa/i03` 与 `js/account/policy-page.js` 覆盖。 |
| 8 | `/terms` | 服务条款 | `NO_CHANGE_REQUIRED` | 同上。 |
| 9 | `/security` | 账户安全中心（Task 27） | `NO_CHANGE_REQUIRED` | `qa/i08`、`npm run test:task27:login-guard`、`node local-backend/test_task27_web_notification_js.mjs` 通过。 |
| 10 | `/language` | 外语学习与 SRS 复习 | `NO_CHANGE_REQUIRED` | `qa/i06` M1 焦点恢复与 FSRS 上下文、`local-backend/test_task15_cloud_browser.mjs` 及 `npm run test:tts:browser` 通过。 |
| 11 | `/learning` | 学习别名路由 | `NO_CHANGE_REQUIRED` | 统一映射并由 `functional_audit_gate.py` 与 `test_i05` 校验通过。 |
| 12 | `/finance` | 财务账本（Task 16/17） | **FIXED** | 修复 `[aria-busy="true"] { opacity: 0.76 }` 与 `#financePendingCount` 导致的 `axe` 对比度违规（`design-system.css` / `spatial-experience.css`）；修复右侧抽屉及移动端 Bottom Sheet `animation-fill-mode: backwards` 以确保 `transform: none`，避免截断原生 `<select>` 弹层（`workspace-experience.css`）；验证 6 币种（`CNY/USD/EUR/HKD/GBP/JPY`）原生选择、JPY 整数、HUD/Toast 避让及刷新持久化。 |
| 13 | `/tools` | 开发者工具箱（104 工具 / 51 模式） | **FIXED** | 根因修复 `模糊搜索工具` `1.84:1` WCAG AA 对比度失败（`styles.css` / `product-ui.css` / `spatial-experience.css`）；修复 `<980px` 下 `.tools-two-pane` 横向溢出（400px -> 0px overflow）；补齐 Workbench `Esc` 退出并恢复焦点、卡片启动焦点进入、复制防抖并发竞态、`hide()` 清理 `aria-busy`（`tools.js`）。 |
| 14 | `/workflows` | 工具工作流（12 能力 / 27 流程） | **FIXED** | 补齐 `#copyWorkflowResultBtn` 复制状态反馈与定时器去重；`#closeWorkflowBtn` 关闭时稳定恢复 `#toolsPanel .tools-header`、补渲染空目录并恢复焦点至 `#openWorkflowBtn`（`workflows.js`）。 |
| 15 | `/transfer` | 文件传输与临时分享（Task 14/22/28） | **FIXED** | `#transferShareCard.scrollIntoView` 遵循 `prefers-reduced-motion: reduce`；`#transferCopyLinkBtn` 增加 `execCommand('copy')` 降级路径与定时器防重入状态反馈（`js/transfer/app.js`）。保留分片上传、真实进度条、取消与 Task 28 私有隔离；`npm run test:task28:browser`（5/5）与 `qa/aeris/transfer-clipboard-browser.mjs` 通过。 |
| 16 | `/files` | 私有文件入口别名（Task 28） | `NO_CHANGE_REQUIRED` | 同 `/transfer`，Task 28 D1/浏览器全部通过。 |
| 17 | `/backup` | 加密备份与恢复（Task 29） | `NO_CHANGE_REQUIRED` | `npm run test:task29`（7/7）与 `npm run test:task29:browser`（5/5）通过，含 Web Crypto AES-GCM 导出、precheck 与 Step-up 提交。 |
| 18 | `/privacy-center` | 隐私中心与安全删除（Task 30） | `NO_CHANGE_REQUIRED` | `npm run test:task30`（8/8）与 `npm run test:task30:browser`（4/4）通过，含 375/390/768 >=44px 触控与 0px 溢出。 |
| 19 | `/notifications` | 通知与归档中心（Task 21/27） | `NO_CHANGE_REQUIRED` | `test_task27_web_notification_js.mjs`（8/8）与 `qa/i09` Toast/HUD 队列与撤回保护验证通过。 |
| 20 | `/account` | 账户与发布通道（beta/stable） | `NO_CHANGE_REQUIRED` | `qa/i09` 通道保存、账户切换清空私有状态与 P07 OFF 降级验证通过。 |
| 21 | `/membership` | 会员目录 | `NO_CHANGE_REQUIRED` | `qa/i03`、`local-backend/test_task17_d1_js.mjs` 通过。 |
| 22 | `/recharge` | 会员开通与支付订单 | `NO_CHANGE_REQUIRED` | `local-backend/test_task17_d1_js.mjs` 通过。 |
| 23 | `/admin` | 管理后台（角色/消息/Task 25 Flags/Kill Switch） | `NO_CHANGE_REQUIRED` | `qa/i09`、`qa/task25/feature-flags-browser.mjs`、`local-backend/test_task18_browser.mjs` 及 I10 普通用户 403/侧栏隐藏权限隔离通过。 |
| 24 | `/feedback` | 需求投票与反馈 | `NO_CHANGE_REQUIRED` | 由 `test_interaction_feedback_browser.mjs` 与路由回归覆盖。 |
| 25 | `/health` | 健康检查与诊断状态页 | `NO_CHANGE_REQUIRED` | 未登录 `/api/health` fail-closed（`authentication_required`）在 Hosted Preview 验证通过。 |
| 26 | `/workspace` | 工作台别名路由 | `NO_CHANGE_REQUIRED` | 与 `/` 登录后工作台共享状态机。 |
| 27 | `/s/:token` | 临时分享下载/提取页 | `NO_CHANGE_REQUIRED` | `npm run test:task28` 覆盖游客口令与撤销后立即失效规则。 |

---

## 2. 全局壳层、HUD 与共享微交互机制覆盖

| 范围 | 文件 | I10 审计与修复 | 状态 |
|---|---|---|---|
| Command Palette (`Ctrl+K`) | `app.js` | 增加 IME 组合输入保护（`event.isComposing`），方向键更新 `aria-activedescendant` 与 `scrollIntoView({ block: 'nearest' })`，`Esc` 恢复触发按钮焦点。 | **FIXED** |
| HUD 避让与叠加规则 | `spatial-experience.css` | Desktop `>980px` 下右侧抽屉打开时，`#versionNotice:not(.hidden)`、`#siteMessageSaveStatus:not(.hidden)` 与 `.achievement-toast` 同步左移避让；`.site-help-footer` 底部预留 `--ds-hud-version-offset` / `--ds-hud-save-offset` 防止内容被 HUD 遮挡。 | **FIXED** |
| 静态资源预取（Prefetch） | `js/core/motion.js` | `createAssetPrefetcher` 补充 `link.crossOrigin = 'anonymous'` 对齐模块预取 CORS，保留 `saveData` / `2g` / 离线短路与 `/api/` 禁止规则。 | **FIXED** |
| 键盘与模态焦点管理 | `js/core/motion.js`, `js/core/keyed-list.js` | 复用既有 `createMotionScope`、`createTabSkeletonSwitcher`、`createToastManager`、`createDragSortController`、`reconcileKeyedRows`；`test_i0*.mjs` 41/41 合同测试全过。 | `NO_CHANGE_REQUIRED` |
| Service Worker 发布白名单 | `sw.js`, `scripts/update_task27_publication.mjs` | 重算并更新 `publication_hash`（`f6f21340064277c936addb559f7b7274201db7501ffe1cf46561ba741dee4034`，20 条 integrity 校验，保留既有 81/89/89 离线壳层不变量）。 | **UPDATED** |
