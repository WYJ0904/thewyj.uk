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
2. **重要事实澄清**：若运营者直接在普通个人 Gmail 客户端中点“回复”，对外发件地址（`From`）将是个人 Gmail 地址而非 `support@thewyj.uk`（除非运营者额外在 Gmail 中单独配置过通过认证的第三方 SMTP 别名）；**只有通过 Aeris 管理后台“客服邮件及回复”面板发送回复**，用户才能稳定收到来自官方域名（`support@thewyj.uk` 或 `noreply@thewyj.uk` + `Reply-To: support@thewyj.uk`）、经过域名 SPF/DKIM 签名且保留 `In-Reply-To`/`References`/`X-Aeris-Thread` 线索关联的正式回复。

---

## 5. 上线前人工 Cloudflare 控制台动作清单

本分支仅完成代码、D1 增量迁移文件 `0036_task27_email_center.sql` 及本地仿真验证，**未对 Production 环境执行任何发布或配置切换**。实际启用前，需由仓库/域名所有者手工核对并完成：
1. 在 Preview / Production D1 执行增量迁移 `cloudflare/migrations/0036_task27_email_center.sql`。
2. 在 Cloudflare Email Service 控制台确认 `thewyj.uk` 的 `noreply@thewyj.uk`（以及如需要直接以 `support@thewyj.uk` 发信，需同时授权 `support@thewyj.uk` 并将环境变量 `EMAIL_SUPPORT_SENDER_AUTHORIZED` 设为 `"true"`）。
3. 部署 `cloudflare/email-worker/support-inbound-worker.mjs`（绑定 `WYJ_DB`、`EMAIL` 发送绑定及 Secret `EMAIL_FORWARD_TO_ADDRESS`），并在验证无误后方可将 Email Routing 中 `support@thewyj.uk` 规则由直转升级为绑定该 Email Worker（内置优先 `message.forward` 转发）。
4. 根据实际灰度节奏，单独决策开启 Production 的 `EMAIL_SENDING_ENABLED="true"`（以及是否需要 `EMAIL_INBOUND_AUTO_ACK_ENABLED="true"`，默认关闭）。
