# Aeris Task 27 邮件服务与管理后台对接合同

> **定位与边界**：本文档描述 Aeris V6.3 独立邮件模块（`functions/_lib/email-service.mjs`、`functions/_lib/email-inbound.mjs`、`functions/_lib/email-api.mjs`、`cloudflare/migrations/0036_task27_email_center.sql`）向账户安全中心（Task 27）及站内业务模块提供的最小化、幂等、可审计发信接口。
> - **职责分离**：账户注册校验、密码强度、OTP 生命周期/校验、TOTP 密钥/恢复码及会话安全决策由 Task 27（`codex/task27-security-center`）全权负责；邮件模块**不参与鉴权判决**，也不作为第二套认证系统。
> - **零凭据留存**：所有验证码类与敏感操作邮件在落库审计时均强制设置 `body_redacted = 1` 并脱敏替换数字验证码（`[REDACTED_OTP_CODE]`），绝不写入普通日志或 API 响应。

---

## 1. 模块导出接口（`functions/_lib/email-service.mjs`）

### 1.1 验证码与邮箱绑定

#### `sendEmailBindingCode(env, options)`
用于注册绑定邮箱验证、更换绑定邮箱确认（目标地址尚未标记为已验证）。

- **关键参数**：
  - `to` / `recipient`: 目标绑定邮箱（严格校验 RFC 基础语法，拒绝 `\r`/`\n`/`\0`/多 `@`/`<>`）
  - `code`: 4–12 位字母数字验证码（仅用于邮件模板渲染，**不落库**）
  - `purpose`: `'bind' | 'change_bind' | 'register'`
  - `expiresMinutes`: 有效期（分钟，1–60，默认 `10`）
  - `userId`: 目标用户 ID（用于限流与审计归属）
  - `username`: 展示用户名（可选）
  - `idempotencyKey`: 幂等键（建议格式 `t27:bind:<request_id>`）
- **限制**：`requireVerifiedEmail` 为 `false`，但仍受 `EMAIL_OTP_RATE_LIMIT_MAX`（默认 10 分钟 5 次）和 `EMAIL_TEST_RECIPIENTS`（预览/测试白名单）约束。

#### `sendLoginMfaCode(env, options)`
用于 Task 27 六位登录二次验证码或高敏操作二次认证。

- **关键参数**：同 `sendEmailBindingCode`，额外要求：
  - 若 `env.WYJ_DB` 存在且未显式传入 `requireVerifiedEmail: false`，强制核查 `userId` 在 `email_center_bindings`（或 `task27_user_security`）中存在且 `verified = 1`，**禁止向未绑定或未验证邮箱投递登录 MFA 验证码**（未通过返回 `{ ok: false, error_code: 'email_recipient_not_verified', status_code: 403 }`）。
  - 若未传入 DB，要求显式传 `emailVerified: true`。

#### `sendVerificationCode(env, options)`（Codex 兼容适配器）
与 `codex/task27-security-center` 兼容的统一验证码入口：
- 当 `purpose` 为 `'bind' | 'change_bind' | 'register'` 时路由至 `sendEmailBindingCode`。
- 其余（`login_mfa` / `mfa_enable` / `recovery`）路由至 `sendLoginMfaCode`。

---

### 1.2 安全事件与业务自动通知

均支持 `sendTransactionalEmail(env, ...)` 抛出受控 `EmailServiceError` 或使用非阻塞包装函数 `notifyAutomaticBusinessEmail(contextOrEnv, options)` / `safeSendTransactionalEmail(env, options)`：

| 导出函数 | `kind` | 适用真实业务场景 | 默认 `from` |
| --- | --- | --- | --- |
| `sendPasswordResetNotice(env, options)` | `password_reset_notice` | 管理员重置密码或账户恢复完成 | `noreply@thewyj.uk` |
| `sendPasswordChangedNotice(env, options)` | `password_changed_notice` | 用户自助修改密码成功 | `noreply@thewyj.uk` |
| `sendMfaChangedNotice(env, options)` | `mfa_changed_notice` | MFA / TOTP 启用、关闭或恢复码重生成 | `noreply@thewyj.uk` |
| `sendSessionSecurityNotice(env, options)` | `session_security_notice` | 登录连续失败限流告警、全端退出、管理员强退 | `noreply@thewyj.uk` |
| `sendOrderStatusNotice(env, options)` | `order_status_notice` | 充值订单审批通过 / 驳回 | `noreply@thewyj.uk` |
| `sendMembershipChangeNotice(env, options)` | `membership_change_notice` | 管理员调整会员等级/有效期 | `noreply@thewyj.uk` |
| `sendSystemMaintenanceNotice(env, options)` | `system_maintenance_notice` | 经授权的必要系统维护/服务公告 | `noreply@thewyj.uk` |
| `sendSupportReplyEmail(env, options)` | `support_reply` | 客服人工回复（自动带 `In-Reply-To`/`References`/`X-Aeris-Thread`） | `support@thewyj.uk`（仅已授权时）或 `noreply@thewyj.uk`（`Reply-To: support@thewyj.uk`） |

`notifyAutomaticBusinessEmail` 会主动查询用户是否拥有**已验证绑定邮箱**；若用户未绑定或未验证邮箱，直接静默返回 `{ ok: false, skipped: true, reason: 'no_verified_email' }`，**绝不阻塞或破坏登录、改密、强退或订单会员核心事务状态**。

---

### 1.3 邮箱绑定互操作与投递状态查询

#### `resolveVerifiedUserEmail(db, userId)` / `getUserEmailBinding(db, userId)`
优先查询 `email_center_bindings`；当表中无已验证绑定且数据库中存在 Codex Task 27 迁移（`0035_task27_security_center.sql`）创建的 `task27_security` 表时，自动读取 `task27_security.verified_email` 与 `email_verified_at`（同时兼容 `task27_user_security` 兜底表），返回 `{ user_id, email, email_normalized, verified, verified_at, source } | null`。管理后台 `/api/admin/email/overview`、`/api/admin/email/recipients`、`/api/admin/email/preview`、`/api/admin/email/send` 与入站客服发件人匹配均同步识别两处已验证邮箱。

#### `upsertUserEmailBinding(db, { userId, email, verified, actorUserId })`
写入或更新 `email_center_bindings`；当 `verified = true` 且 `task27_security` 表存在时，会自动同步更新 `task27_security.verified_email` / `email_verified_at`，确保两个工作树间的用户已验证邮箱状态零分裂。

### 1.4 与 `codex/task27-security-center` 的代码级兼容适配与合并边界

1. **函数与签名兼容**：
   - `EmailServiceError` 同时支持 Codex 的五参构造 `new EmailServiceError(message, status, code, retryable, details)` 与本模块的 `(code, message, status, details)`。
   - `cleanSingleLineText(val, fieldLabel, maxLen)` 与 `cleanBodyText(val, fieldLabel, maxLen)` 同时支持 Codex 的位置参数调用与对象配置调用。
   - `emailBindingConfigured(env)` 在 Workers `env.EMAIL` Binding 或 Cloudflare Email REST API（`EMAIL_SEND_API_TOKEN` + `EMAIL_CLOUDFLARE_ACCOUNT_ID`）任一就绪时返回 `true`；同时导出 `emailNativeBindingConfigured(env)` 区分原生绑定与 REST 通道。
   - `ALLOWED_TRANSACTIONAL_KINDS` 已纳入 `account_security_notice` 与 `owner_ops_test`；`sendTransactionalEmail` 支持 `purpose` 传入中文业务标签（如 `'登录验证'`、`'敏感操作验证'`、`'找回密码'`、`'绑定邮箱'`、`'开启邮箱双重验证'`）并原样脱敏渲染；`sendAccountSecurityNotice(env, { to, eventSummary, occurredAt, ... })` 及别名 `sendVerificationCodeEmail` / `sendLoginMfaCodeEmail` / `sendPasswordResetEmail` / `sendMfaStatusChangeNotice` 均已对齐导出。
2. **D1 迁移顺序（`0035` vs `0036`）**：
   - 当前 `main`（S0 PR `#151` 合入后）最新迁移编号为 `0034_finance_ai_assistance.sql`。
   - Codex 分支新增 `0035_task27_security_center.sql`，本分支新增 `0036_task27_email_center.sql`。
   - `0036_task27_email_center.sql` 仅引用 `task12_users(id)`，**对 `0035` 无外键或表结构硬依赖**；但在 Production D1 执行迁移时**必须等待 `0035_task27_security_center.sql` 先合入并执行后，再执行 `0036_task27_email_center.sql`**，防止 D1 迁移序号跳号导致 `0035` 无法按序应用。
3. **路由归属（合并后接入指南）**：
   - 本分支 `functions/_lib/email-api.mjs` 的 `handleEmailRequest(context)` 完整承担所有 `/api/admin/email/*`（含概览、收件人筛选、草稿、预览、二次确认发送、投递记录、安全重试、客服入站收件与回复、模板、绑定维护、状态与受控测试）权限校验与审计路由；合入 `handleTask27Request(context)` 时，应在 `functions/api/[[path]].js` 中保持 `handleEmailRequest` 优先于 `handleTask27Request`（或在 `task27-api.mjs` 中移除重复的 `/api/admin/email/*` 占位路由）。

#### `getEmailDeliveryStatus(db, { deliveryId, idempotencyKey })`
供 Task 27 查询某次发信的实际处理状态，返回：
- `delivery_id`, `idempotency_key`, `kind`, `channel`, `recipient_masked`
- `delivery_status`: `'delivered' | 'queued' | 'rejected' | 'suppressed' | 'failed'`
- `inbox_delivery_confirmed`: 仅当 Cloudflare 返回明确 `delivered` 时为 `true`；**`queued` 时固定为 `false`**
- `error_code`, `error_message`, `retryable`, `retry_count`, `max_retries`

---

## 2. 统一返回结构与失败状态处理

`sendVerificationCode` / `sendEmailBindingCode` / `sendLoginMfaCode` / `safeSendTransactionalEmail` 均返回确定性结构，不会意外泄漏密码/OTP/Token：

```json
{
  "ok": true,
  "delivery_id": "dlv_...",
  "delivery_status": "queued",
  "inbox_delivery_confirmed": false,
  "transport": "cloudflare_rest",
  "delivered": [],
  "queued": ["user@example.com"],
  "permanent_bounces": [],
  "suppressed_recipients": [],
  "message_id": "<...>",
  "from": "noreply@thewyj.uk",
  "reply_to": "support@thewyj.uk",
  "kind": "login_mfa_code",
  "recipient": "user@example.com",
  "sent_at": "2026-11-15T00:00:00.000Z"
}
```

### Cloudflare 响应与失败语义规范
1. **`delivered`**（`ok: true`, `inbox_delivery_confirmed: true`）：Cloudflare 返回该收件人在 `delivered` 列表。
2. **`queued`**（`ok: true`, `inbox_delivery_confirmed: false`）：Cloudflare 已受理进入异步投递队列；上层 UI 与业务日志**不得将其表述为“已最终送达用户收件箱”**。
3. **`rejected`**（`ok: false`, `error_code: 'email_recipient_bounced'`）：Cloudflare 返回 `permanent_bounces`（永久退信/拒收），不可重试。
4. **`suppressed`**（`ok: false`, `error_code: 'email_recipient_suppressed'`）：收件地址处于抑制名单，不可重试。
5. **`failed`**（`ok: false`）：包括 `email_sending_disabled`（503）、`email_transport_unconfigured`（503）、`email_rate_limited`（429）、`email_recipient_not_allowlisted`（403）、`email_recipient_not_verified`（403）、`email_provider_auth_failed`（502）、`email_provider_rate_limited`（429, `retryable: true`）、`email_provider_unavailable`（503, `retryable: true`）。

---

## 3. 安全协议约束（Cloudflare API 兼容性）

1. **禁止将保留邮件头放入自定义 `headers`**：
   `email-service.mjs` 已内置 `validateCustomHeaders`，显式拒绝 `From`、`To`、`Cc`、`Bcc`、`Subject`、`Reply-To`、`Message-ID`、`Date`、`DKIM-Signature`、`MIME-Version`、`Received`、`Return-Path` 进入 `headers` 对象，防止触发 Cloudflare API `E_HEADER_USE_API_FIELD` / `E_HEADER_NOT_ALLOWED` 错误；仅允许 `X-*`、`In-Reply-To`、`References`、`Auto-Submitted`。
2. **双发件人身份授权隔离**：
   - `noreply@thewyj.uk`：自动事务邮件与常规后台通知默认发件人。
   - `support@thewyj.uk`：仅当环境显式配置 `EMAIL_SUPPORT_SENDER_AUTHORIZED=true` 时才允许直接作为 `From` 使用；未授权时客服回复自动降级为 `From: noreply@thewyj.uk` + `Reply-To: support@thewyj.uk`，或明确返回 `403 email_sender_unauthorized`。
3. **跨工作树兼容说明**：
   `codex/task27-security-center` 当前版本曾在其独立开发枝的 `buildEmailMessage` 中向 `headers` 传出 `Message-ID`。后续如由集成管理员合并 `codex/task27-security-center` 与 `hydrogen/task27-email-center` 时，应保留本分支的 `email-service.mjs` 与 `email-api.mjs` 路由（使用 `X-Aeris-Thread` / `X-Aeris-Delivery-Id` 及 `In-Reply-To`/`References`）。

---

## 4. 客服入站邮件（`support@thewyj.uk`）与 Gmail 转发说明

1. **优先保留现有转发**：`cloudflare/email-worker/support-inbound-worker.mjs` 在 `handleInboundSupportEmail` 中优先调用 `await message.forward(env.EMAIL_FORWARD_TO_ADDRESS)`，确保运营者私人邮箱继续收到入站邮件；私人邮箱地址仅作为环境变量/Secret 注入，绝不写入仓库代码、前端资源或审计表。
2. **D1 未迁移期间的安全降级**：`handleInboundSupportEmail` 先完成 `message.forward(...)`，再通过 `tableExists(db, ...)` 检查 `email_center_inbound_threads` / `email_center_inbound_messages` 是否存在；即使 `0036_task27_email_center.sql` 尚未执行，转发给运营者私人 Gmail 的主链路仍正常运行，不会中断收信。
3. **只读就绪探针**：`cloudflare/email-worker/support-inbound-worker.mjs` 暴露 `GET /health`，仅返回 `d1_bound`、`forward_target_configured`、`email_binding_configured`、`rest_api_configured`、`email_sending_enabled`、`auto_ack_enabled` 六项布尔状态，**绝不返回** `EMAIL_FORWARD_TO_ADDRESS`、`EMAIL_SEND_API_TOKEN` 或 `EMAIL_CLOUDFLARE_ACCOUNT_ID` 明文值。
4. **重要事实澄清**：若运营者直接在普通个人 Gmail 客户端中点“回复”，对外发件地址（`From`）将是个人 Gmail 地址而非 `support@thewyj.uk`（除非运营者额外在 Gmail 中单独配置过通过认证的第三方 SMTP 别名）；**只有通过 Aeris 管理后台“客服邮件及回复”面板发送回复**，用户才能稳定收到来自官方域名（`support@thewyj.uk` 或 `noreply@thewyj.uk` + `Reply-To: support@thewyj.uk`）、经过域名 SPF/DKIM 签名且保留 `In-Reply-To`/`References`/`X-Aeris-Thread` 线索关联的正式回复。

---

## 5. 独立 Email Worker 部署与零中断上线清单（Cloudflare 控制台步骤）

本分支仅完成代码、Wrangler 独立配置 `wrangler.support-inbound.jsonc`、D1 增量迁移文件 `0036_task27_email_center.sql` 及本地仿真验证，**未对 Production 环境执行任何发布、迁移或路由切换**。在实际切换 `support@thewyj.uk` 之前，现有 Cloudflare Email Routing 至 Gmail 的直转**保持原样不中断**。

### 5.1 前置核查（已完成项）
- Production `EMAIL_SEND_API_TOKEN`（加密 Secret）与 `EMAIL_CLOUDFLARE_ACCOUNT_ID` 已配置。
- Production `EMAIL_SENDING_ENABLED="false"` 保持关闭。
- `support@thewyj.uk` 当前 Email Routing 至运营者 Gmail 转发已验证可用（**在以下 5.2–5.5 完成前切勿修改此规则**）。

### 5.2 步骤 1：创建 / 部署独立 Email Worker（不影响现有路由）
仓库已提供独立配置文件 `wrangler.support-inbound.jsonc`（入口 `cloudflare/email-worker/support-inbound-worker.mjs`，默认 `EMAIL_SENDING_ENABLED="false"`、`EMAIL_INBOUND_AUTO_ACK_ENABLED="false"`）：
- **方式 A（本地 Wrangler CLI，推荐）**：
  - 部署预览环境 Worker：`npx wrangler deploy --config wrangler.support-inbound.jsonc --env preview`（Worker 名：`thewyj-support-inbound-preview`）
  - 部署生产环境 Worker：`npx wrangler deploy --config wrangler.support-inbound.jsonc --env production`（Worker 名：`thewyj-support-inbound-production`）
  - 注意：刚部署的 Worker 尚未被 Email Routing 引用，因此**不会拦截或改变**任何线上的 `support@thewyj.uk` 来信。
- **方式 B（Cloudflare 控制台新建 Worker 后接管）**：
  - 登录 Cloudflare Dashboard -> **Workers & Pages** -> **Create** -> **Create Worker** -> 命名为 `thewyj-support-inbound-production`（或预览 `thewyj-support-inbound-preview`），完成后再通过方式 A 发布正式代码包以带入 `functions/_lib/email-inbound.mjs` 等共享依赖。

### 5.3 步骤 2：在控制台核对 / 配置三大绑定与 Secret
进入目标 Worker（先测试 `-preview`，确认无误再配 `-production`）-> **Settings**：
1. **D1 Database Binding（`Bindings` -> `Add` -> `D1 Database`）**：
   - Variable name 填写：`WYJ_DB`
   - Preview 选择：`wyj-cloud-preview`（`a3e6253b-689f-49f3-998b-7c5828ea255a`）
   - Production 选择：`wyj-cloud-production`（`11c288d8-c584-409f-bb1f-7e7af11793e5`）
2. **Send Email Binding（`Bindings` -> `Add` -> `Send Email`）**：
   - Variable name 填写：`EMAIL`
   - Destination / Scope：建议放行已验证收件人或保持通用 Send Email 绑定（`wrangler.support-inbound.jsonc` 中已声明 `send_email: [{ "name": "EMAIL" }]`）。
   - 注意：当 `EMAIL_INBOUND_AUTO_ACK_ENABLED="false"` 且 `EMAIL_SENDING_ENABLED="false"` 时，Worker 即使绑定了 `EMAIL` 也不会主动对外发信，仅用于就绪状态验证及未来开启自动回执。
3. **加密 Secret `EMAIL_FORWARD_TO_ADDRESS`（`Variables and Secrets` -> `Add` -> Type 选 `Secret`）**：
   - Name 填写：`EMAIL_FORWARD_TO_ADDRESS`
   - Value 填写：**已在 Cloudflare Email Routing -> Destination addresses 中完成验证的同一个运营者私人 Gmail 地址**（若填入未经 Cloudflare 验证的目标地址，`message.forward()` 将报错）。
   - 若使用 CLI 设置：`npx wrangler secret put EMAIL_FORWARD_TO_ADDRESS --config wrangler.support-inbound.jsonc --env production`。
   - **安全要求**：切勿将私人 Gmail 地址提交至仓库、截图或明文写在 `wrangler*.jsonc` 中。
4. **保持关闭状态的安全开关（Plaintext Variables，默认已在 `wrangler.support-inbound.jsonc` 设为 `"false"`）**：
   - `EMAIL_SENDING_ENABLED = "false"`
   - `EMAIL_INBOUND_AUTO_ACK_ENABLED = "false"`
   - 如需 Worker 作为兜底发信回落也可同时补充 `EMAIL_SEND_API_TOKEN` Secret 与 `EMAIL_CLOUDFLARE_ACCOUNT_ID` 变量（当前 `EMAIL_SENDING_ENABLED="false"` 时非必需）。

### 5.4 步骤 3：切换路由前的只读自检（零风险）
1. 在 Cloudflare Dashboard -> 该 Worker -> **Preview / Visit `/health`**（或使用受权预览 URL 请求 `/health`）：
   - 确认返回 HTTP `200` 且 JSON 为：
     - `service`: `"thewyj-support-inbound"`
     - `readiness.d1_bound`: `true`
     - `readiness.forward_target_configured`: `true`
     - `readiness.email_binding_configured`: `true`
     - `readiness.email_sending_enabled`: `false`
     - `readiness.auto_ack_enabled`: `false`
   - 同时目视确认响应体**不包含**私人邮箱或任何 Token 明文。
2. 检查 D1 迁移前置条件：确认 Codex `0035_task27_security_center.sql` 已合入并按序在目标库执行完 `0035` 与 `0036_task27_email_center.sql` 后，管理后台才具备入站邮件落库视图；此前请继续保持仅检查 Worker `/health`，**勿跳号单独对 Production 执行 `0036`**。

### 5.5 步骤 4：零中断路由切换与秒级回滚（待正式验收时再执行）
在确认上述 `5.2`–`5.4` 全部就绪、且正式迁移与功能灰度均已批准后：
1. **切换路由**：进入 Cloudflare Dashboard -> 域名 `thewyj.uk` -> **Email** -> **Email Routing** -> **Routing rules**，找到 `support@thewyj.uk`，点击 **Edit**：
   - 将 **Action** 从 `Send to an email` 修改为 **`Send to a Worker`**。
   - **Destination** 选择 `thewyj-support-inbound-production`。
   - 保存规则。
2. **立即实测验证**：使用外部邮箱向 `support@thewyj.uk` 发送一封测试邮件，确认三件事：
   - 运营者私人 Gmail 在 10–30 秒内正常收到由 Worker `message.forward()` 转发的原信；
   - 若 D1 `0036` 已就绪，Aeris 管理后台 -> **邮件管理 -> 客服收件与回复** 出现对应线索与发件记录；
   - Cloudflare Worker Logs 显示 `email` 事件执行成功无未捕获异常。
3. **秒级回滚预案（如发现转发异常）**：
   - 立即回到 **Email Routing -> Routing rules -> Edit `support@thewyj.uk`**，将 **Action** 改回 `Send to an email` -> 选择原 Gmail 地址并保存，10 秒内恢复纯直转。

### 5.6 正式启用发信与官方身份授权（后续单独决策）
1. 在 Cloudflare Email Service 控制台确认 `thewyj.uk` 的 `noreply@thewyj.uk`（如需要直接以 `support@thewyj.uk` 作为 `From` 发信，需同时授权 `support@thewyj.uk` 并将 Pages 与 Worker 的 `EMAIL_SUPPORT_SENDER_AUTHORIZED` 设为 `"true"`）。
2. 待 Task 27 合并及灰度验收就绪后，再单独决策将 Pages 与 Worker 的 `EMAIL_SENDING_ENABLED` 切为 `"true"`（以及是否开启 `EMAIL_INBOUND_AUTO_ACK_ENABLED="true"`，默认保持关闭）。
