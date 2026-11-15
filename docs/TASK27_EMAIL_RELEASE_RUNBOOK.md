# Aeris V6.3 — Task 27 安全中心与邮件中心联合上线、迁移与验收方案

> **当前状态约束**：本文档为 **Release Readiness Runbook**（仅规划与就绪核查）。在实际获准发布前，**严禁**对 Production D1 执行 `0035`/`0036` 迁移、**严禁**开启 Production `EMAIL_SENDING_ENABLED`、**严禁**切换 `support@thewyj.uk` 正式 Email Routing。

---

## 1. 基线核查与分支合并顺序（Merge Order）

### 1.1 当前已知各线状态
- **Production `main` 基线**：已合入 S0 PR `#151`（`7766b80eb2c9e448dc08a3a4b317bfa62e0dff6e`），Production D1 已完成 `0001–0034` 迁移。
- **邮件中心分支（`hydrogen/task27-email-center`, Draft PR `#153`）**：基于最新 `main` 开发，提供 `0036_task27_email_center.sql`、`email-service.mjs`、`email-inbound.mjs`、`email-api.mjs`、管理员邮件中心 UI（`#adminEmailView`）及独立入站 Worker `wrangler.support-inbound.jsonc`。
- **安全中心分支（`codex/task27-security-center`）**：当前产物提交（如 `3b1ff9d7` / `d06e50eb`）分叉于 S0 合并前的 `3f5ea474`；**合入 `main` 前必须先完成对最新 `origin/main` 的 Rebase / 同步**。

### 1.2 推荐合并顺序与集成冲突解决清单
1. **Step 1 — Codex 先同步最新 `origin/main` 并合入 Task 27（含 `0035_task27_security_center.sql`）**（或先合并 PR `#153` 再合入 Task 27，但 **无论 PR 合入先后，向真实 D1 执行迁移时必须严格按 `0035` → `0036` 顺序执行**，绝不可跳号单独先执行 `0036`）。
2. **Step 2 — 集成合入时的关键兼容核对项（已在独立临时集成工作树实测验证）**：
   - **`functions/api/[[path]].js` 与 `/api/admin/email/*` 路由归属**：
     - Codex 分支曾在 `task27-api.mjs` 内置了 5 个精简版 `/api/admin/email/*`（`recipients` / `drafts` / `preview` / `send`）并读写 `0035` 的 `task27_email_drafts` / `task27_email_jobs`。
     - 联合集成时应以完整邮件中心 `handleEmailRequest`（`email-api.mjs`）作为统一后端入口（或确保 `handleEmailRequest` 优先于 `task27-api.mjs` 的 `/api/admin/email/*` 占位路由，避免阴影遮蔽 `test-send` / `overview` / `deliveries` / `retry` / `inbound` / `templates` / `user-binding` 等 13 条完整管理路由）。
     - 若需同时兼容旧式弹窗请求字段，`email-api.mjs` 已补充 `recipients[].id` 与时间戳比较；集成时统一以 `#adminEmailView` 面板为准，避免同一后台入口出现两套草稿库分裂。
   - **`functions/_lib/task12-api.mjs` 异常透传**：
     - 需保留 `EmailServiceError` 捕获分支，确保 `/api/login` 触发 `beginTask27Login` 邮件发送失败或限流时返回精确错误码与 `Retry-After`（而非落入通用 `503 task12_unavailable`）。
   - **`functions/_lib/task27-security.mjs` 安全通知互通**：
     - 建议在 `notify()` 中改为调用 `resolveVerifiedUserEmail(db, userId)`（同时识别 `email_center_bindings` 与 `task27_security`，按较新验证时间戳为准）并传入 `userId`，确保无论是经由安全中心还是后台绑定工具验证的邮箱都能稳定收到安全通知并完整记录至 `email_center_deliveries`。
   - **`functions/_lib/task27-mail.mjs`（若保留过渡适配器）**：
     - `0035` 的 `task27_email_jobs.status` `CHECK` 约束不含 `'suppressed'`，需将 `email-service.mjs` 返回的 `suppressed` / `bounced` 映射为 `'rejected'`，并将 `email_transport_unconfigured` / `email_provider_auth_failed` / `email_provider_rate_limited` / `email_provider_rejected` / `email_provider_unavailable` 纳入错误分类，防止触发 SQLite CHECK 约束失败。
   - **`sw.js` 发布清单**：
     - 任何前端模块合入后，必须执行 `npm run task27:publication`（`node scripts/update_task27_publication.mjs`）重新计算 `TASK26_INTEGRITY` 与 `PUBLICATION_HASH`。

---

## 2. D1 全量备份与迁移安全检查（Preview → Production）

### 2.1 执行顺序原则
- **强制顺序**：`0001–0034`（已应用） → `0035_task27_security_center.sql` → `0036_task27_email_center.sql`。
- **兼容实证**：`0035` 与 `0036` 均为纯增量 DDL（`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `INSERT OR IGNORE`），**不修改** `task12_users`、`task12_sessions`、`task20_device_sessions`、会员（`task13_*`）、财务（`task16_*`/`task17_*`）或学习数据（`task26_*`）表结构，且已通过正序（`0035 → 0036`）与逆序（`0036 → 0035`）隔离 Miniflare D1 无损验证。

### 2.2 正式迁移前强制操作清单
1. **导出完整远程 D1 备份（Schema + Data，保存在工作区外受保护目录，绝不提交 Git）**：
   ```powershell
   # 先备份 Preview，再备份 Production
   npx wrangler d1 export wyj-cloud-preview --remote --output <BACKUP_DIR>\wyj-cloud-preview-pre-0035-0036.sql
   npx wrangler d1 export wyj-cloud-production --remote --output <BACKUP_DIR>\wyj-cloud-production-pre-0035-0036.sql
   ```
2. **核对迁移基线与核心表行数基线**：
   ```powershell
   npx wrangler d1 migrations list wyj-cloud-production --remote
   npx wrangler d1 execute wyj-cloud-production --remote --command "SELECT COUNT(*) AS users FROM task12_users; SELECT COUNT(*) AS sessions FROM task12_sessions WHERE revoked=0; SELECT COUNT(*) AS memberships FROM task13_memberships;"
   ```
3. **先在 Preview（待 `0035` 与 `0036` 均处于同一集成构建时）执行并验库，再执行 Production**：
   ```powershell
   npx wrangler d1 migrations apply wyj-cloud-production --remote
   ```
4. **迁移后即时校验**：
   - 核查 `d1_migrations` 已按顺序记录 `0035_task27_security_center.sql` 与 `0036_task27_email_center.sql`。
   - 复核 `task12_users`、`task12_sessions`、会员与财务行数与迁移前完全一致。
   - 核查 `email_center_templates` 已预置 8 条模板（含 6 条 `is_system = 1` 系统核心模板与 2 条可维护默认模板）。

---

## 3. Worker / Pages 绑定与代码一致性校验

### 3.1 独立 Email Worker（`wrangler.support-inbound.jsonc`）
当前 Preview 与 Production 均已按 PR `#153`（`2a17c2bb`）代码包部署并写入 `EMAIL_FORWARD_TO_ADDRESS` 加密 Secret：
- Preview：`https://thewyj-support-inbound-preview.wyj20090904.workers.dev/health`
- Production：`https://thewyj-support-inbound-production.wyj20090904.workers.dev/health`
- 就绪探针必须全部满足：
  - `d1_bound: true`
  - `forward_target_configured: true`
  - `email_binding_configured: true`
  - 发布开关保持安全默认：`email_sending_enabled: false`、`auto_ack_enabled: false`
- **发布时代码同步**：由于本分支后续补充了 `email-service.mjs` 的时间戳优先级与错误分类修复，正式发布前建议同步重新部署一次 Worker（`EMAIL_FORWARD_TO_ADDRESS` Secret 会保留，仅更新代码版本）：
  ```powershell
  npx wrangler deploy --config wrangler.support-inbound.jsonc --env preview
  npx wrangler deploy --config wrangler.support-inbound.jsonc --env production
  ```

### 3.2 Cloudflare Pages 环境变量核查
- `EMAIL_SEND_API_TOKEN`（Secret）与 `EMAIL_CLOUDFLARE_ACCOUNT_ID`（已确认具备）。
- `EMAIL_DEFAULT_FROM = "noreply@thewyj.uk"`、`EMAIL_DEFAULT_REPLY_TO = "support@thewyj.uk"`。
- `EMAIL_SUPPORT_SENDER_AUTHORIZED`：仅在 Cloudflare Email Service 控制台明确完成 `support@thewyj.uk` 发信域身份授权后，方可设为 `"true"`；未授权前保持 `"false"`（客服回复将安全降级为 `From: noreply@thewyj.uk` + `Reply-To: support@thewyj.uk`）。
- 发布前始终保持：`EMAIL_SENDING_ENABLED = "false"`。

---

## 4. 金丝雀（Canary）与真实邮件验收流程

仅当上述 **1–3 步全部通过** 且明确批准灰度放行时，按以下顺序执行真实收发验收：

1. **阶段 A — Preview 灰度白名单实测（零影响普通用户）**：
   - 在 Preview Pages 设置 `EMAIL_TEST_RECIPIENTS` 仅包含运营者受控测试邮箱，并将 Preview `EMAIL_SENDING_ENABLED` 暂切为 `"true"`。
   - 由超级管理员登录 Preview 管理后台 `#adminEmailView` -> 调用 `/api/admin/email/test-send`（指定白名单测试邮箱）：
     - 验证真实收件箱收到来自 `noreply@thewyj.uk`（Reply-To `support@thewyj.uk`）的测试邮件。
     - 验证 `email_center_deliveries` 记录 `delivered`/`queued`、`message_id` 及脱敏字段。
   - 使用 Preview 测试账号执行：**邮箱绑定 OTP** → **邮箱 MFA 登录拦截（未验证代码不可获发 Session）** → **TOTP 恢复码一次性消费** → **改密安全通知**，确认验证码正文均已脱敏（`body_redacted = 1`，`[REDACTED_OTP_CODE]`）。
2. **阶段 B — `support@thewyj.uk` 入站 Worker 安全切换与实测**：
   - 在 Cloudflare Dashboard -> `thewyj.uk` -> **Email Routing -> Routing rules -> `support@thewyj.uk`**：
     - 先在灰度时间窗口内切换为 **`Send to a Worker` -> `thewyj-support-inbound-production`**（确认 Production D1 已有 `0035`+`0036`）。
   - 用外部个人邮箱向 `support@thewyj.uk` 发送一封纯文本/HTML 测试邮件：
     - **检查 1**：运营者私人 Gmail 在 10–30 秒内正常收到原信转发（证明 `message.forward()` 主链路不断）。
     - **检查 2**：Production（或先验证 Preview）管理后台 **客服收件与回复** 列表出现该新线索；在后台发送一条官方回复（带 `In-Reply-To` / `References` / `X-Aeris-Thread`），确认外部测试邮箱顺利收到且归入同一邮件会话线索。
3. **阶段 C — Production 受控放开**：
   - 确认白名单实测与客服转发/回复全部正常后，再于 Production Pages 清空测试限制（保留内部测试限制为非白名单模式或按配置策略放行），并将 `EMAIL_SENDING_ENABLED` 设为 `"true"`。
   - **默认建议继续关闭 `EMAIL_INBOUND_AUTO_ACK_ENABLED="false"`**，待客服后台稳定运行后再评估是否启用自动回执。

---

## 5. 秒级应急回滚预案（Rollback Plan）

若验收或灰度期间发现任何异常（投递率异常、转发失败、MFA 登录阻塞、误触发限流）：

1. **立即止损发信（< 30 秒生效）**：
   - 将 Cloudflare Pages（及 Support Inbound Worker）环境变量 **`EMAIL_SENDING_ENABLED` 改回 `"false"`**。
   - 说明：已配置邮件通知的非阻塞业务（改密/强退/订单/会员/限流告警）会自动静默跳过发信，**不影响核心业务**；尚未开启邮箱 MFA 的原有用户登录与现有有效会话**完全不受影响**。
   - 若同时遇到 Cloudflare Email 发送异常导致已开邮箱 MFA 用户无法收码：保持“失效关闭（Fail-Closed）”安全原则（不可降级绕过 MFA），用户可使用一次性恢复码（Recovery Codes）或 TOTP 认证器登录。
2. **秒级恢复 `support@thewyj.uk` 直转 Gmail（< 10 秒生效）**：
   - 打开 Cloudflare Dashboard -> **Email -> Email Routing -> Routing rules -> Edit `support@thewyj.uk`**。
   - 将 Action 从 `Send to a Worker` 改回 **`Send to an email`** -> 选择已验证的运营者私人 Gmail 并保存。
3. **数据库与代码回滚原则**：
   - `0035` 与 `0036` 均为只增不改表结构的新表迁移，**通常无需删表回滚**；仅关闭开关并回滚 Pages 部署版本即可恢复旧版运行时行为。
   - 极端情况下若需回退 D1 状态，使用第 2.2 节导出的 `<BACKUP_DIR>` 全量备份恢复，绝不执行未备份的手动 `DROP TABLE`。
