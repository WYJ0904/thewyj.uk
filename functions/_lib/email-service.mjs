export const EMAIL_BUILD = "task27-email-center-v6.3";

export const DEFAULT_FROM_EMAIL = "noreply@thewyj.uk";
export const DEFAULT_FROM_NAME = "Aeris";
export const SUPPORT_FROM_EMAIL = "support@thewyj.uk";
export const SUPPORT_FROM_NAME = "Aeris Support";
export const DEFAULT_REPLY_TO_EMAIL = "support@thewyj.uk";
export const DEFAULT_REPLY_TO_NAME = "Aeris Support";

export const ALLOWED_SENDER_ADDRESSES = Object.freeze([
  DEFAULT_FROM_EMAIL,
  SUPPORT_FROM_EMAIL,
]);

export const ALLOWED_REPLY_TO_ADDRESSES = Object.freeze([
  DEFAULT_REPLY_TO_EMAIL,
  DEFAULT_FROM_EMAIL,
]);

export const ALLOWED_TRANSACTIONAL_KINDS = Object.freeze([
  "security_notice",
  "account_security_notice",
  "order_status_notice",
  "test_email",
  "owner_ops_test",
  "verification_code",
  "admin_service_notice",
  "email_bind_verification",
  "login_mfa_code",
  "password_reset_notice",
  "password_changed_notice",
  "mfa_changed_notice",
  "session_security_notice",
  "membership_change_notice",
  "system_maintenance_notice",
  "support_reply",
  "support_auto_ack",
]);

const OTP_REDACTED_KINDS = new Set([
  "verification_code",
  "email_bind_verification",
  "login_mfa_code",
]);

const FORBIDDEN_CUSTOM_HEADERS = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "reply-to",
  "message-id",
  "date",
  "dkim-signature",
  "mime-version",
  "received",
  "return-path",
  "sender",
  "content-type",
  "content-transfer-encoding",
]);

const ALLOWED_STANDARD_CUSTOM_HEADERS = new Set([
  "in-reply-to",
  "references",
  "auto-submitted",
]);

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export class EmailServiceError extends Error {
  constructor(arg1, arg2, arg3, arg4, arg5) {
    // Support both Codex/S0 positional form (message, status, code, retryable, details)
    // and Email Center object form (code, message, status = 400, details = {})
    if (typeof arg2 === "number") {
      const message = String(arg1 || "邮件服务异常");
      const status = Number(arg2) || 400;
      const code = String(arg3 || "email_invalid_request");
      const retryable = Boolean(arg4);
      const details = arg5 && typeof arg5 === "object" ? { ...arg5 } : {};
      super(message);
      this.name = "EmailServiceError";
      this.code = code;
      this.status = status;
      this.retryable = retryable;
      this.details = details;
      return;
    }
    const code = String(arg1 || "email_service_error");
    const message = String(arg2 || "邮件服务异常");
    const status = typeof arg3 === "number" ? arg3 : 400;
    const details = arg4 && typeof arg4 === "object" ? { ...arg4 } : {};
    super(message);
    this.name = "EmailServiceError";
    this.code = code;
    this.status = status;
    this.retryable = Boolean(details.retryable ?? (status >= 500 || status === 429));
    this.details = details;
  }
}

export function emailSendingEnabled(env) {
  return String(env?.EMAIL_SENDING_ENABLED || "").trim().toLowerCase() === "true";
}

export function supportSenderAuthorized(env) {
  return String(env?.EMAIL_SUPPORT_SENDER_AUTHORIZED || "").trim().toLowerCase() === "true";
}

export function emailNativeBindingConfigured(env) {
  return Boolean(env?.EMAIL && typeof env.EMAIL.send === "function");
}

export function resolveEmailTransport(env) {
  const preference = String(env?.EMAIL_TRANSPORT || "").trim().toLowerCase();
  const hasBinding = emailNativeBindingConfigured(env);
  const hasRest = Boolean(
    String(env?.EMAIL_SEND_API_TOKEN || "").trim() &&
    String(env?.EMAIL_CLOUDFLARE_ACCOUNT_ID || "").trim()
  );
  if (preference === "rest" || preference === "cloudflare_rest") {
    if (hasRest) return "cloudflare_rest";
    if (hasBinding) return "workers_binding";
    return "unconfigured";
  }
  if (preference === "binding" || preference === "workers_binding") {
    if (hasBinding) return "workers_binding";
    if (hasRest) return "cloudflare_rest";
    return "unconfigured";
  }
  if (hasBinding) return "workers_binding";
  if (hasRest) return "cloudflare_rest";
  return "unconfigured";
}

export function emailBindingConfigured(env) {
  return resolveEmailTransport(env) !== "unconfigured";
}

export function cleanEmailAddress(value, fieldName = "email") {
  if (typeof value !== "string") {
    throw new EmailServiceError("email_invalid_recipient", `${fieldName} 必须是有效的邮箱字符串`, 400);
  }
  if (/[\r\n\0<>]/.test(value) || CONTROL_CHAR_REGEX.test(value)) {
    throw new EmailServiceError("email_header_injection_rejected", `${fieldName} 包含非法控制字符`, 400);
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || normalized.includes("..")) {
    throw new EmailServiceError("email_invalid_recipient", `${fieldName} 邮箱格式无效`, 400);
  }
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0 || atIndex !== normalized.lastIndexOf("@")) {
    throw new EmailServiceError("email_invalid_recipient", `${fieldName} 邮箱格式无效`, 400);
  }
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (local.startsWith(".") || local.endsWith(".") || !domain.includes(".")) {
    throw new EmailServiceError("email_invalid_recipient", `${fieldName} 邮箱格式无效`, 400);
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new EmailServiceError("email_invalid_recipient", `${fieldName} 邮箱格式无效`, 400);
  }
  return normalized;
}

export function parseAllowedTestRecipients(env) {
  const raw = String(env?.EMAIL_TEST_RECIPIENTS || "").trim();
  if (!raw) return [];
  const items = raw.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
  const valid = [];
  for (const item of items) {
    try {
      const cleaned = cleanEmailAddress(item, "test_recipient");
      if (!valid.includes(cleaned)) valid.push(cleaned);
    } catch {
      // ignore malformed env entries safely
    }
  }
  return valid;
}

export function cleanSingleLineText(value, optionsOrField = {}, maybeMaxLength = undefined) {
  const options = typeof optionsOrField === "string"
    ? { field: optionsOrField, maxLength: Number(maybeMaxLength) || 160, required: true }
    : (optionsOrField || {});
  const { maxLength = 200, field = "text", required = true, allowEmpty = false } = options;
  if (value === undefined || value === null) {
    if (required && !allowEmpty) {
      throw new EmailServiceError("email_invalid_input", `${field} 不能为空`, 400);
    }
    return "";
  }
  if (typeof value !== "string") {
    throw new EmailServiceError("email_invalid_input", `${field} 必须是字符串`, 400);
  }
  if (/[\r\n\0]/.test(value) || CONTROL_CHAR_REGEX.test(value)) {
    throw new EmailServiceError("email_header_injection_rejected", `${field} 禁止包含换行或控制字符`, 400);
  }
  const trimmed = value.replace(/\t+/g, " ").trim();
  if (!trimmed && required && !allowEmpty) {
    throw new EmailServiceError("email_invalid_input", `${field} 不能为空`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new EmailServiceError("email_invalid_input", `${field} 长度不能超过 ${maxLength} 个字符`, 400);
  }
  return trimmed;
}

export function cleanBodyText(value, optionsOrField = {}, maybeMaxLength = undefined) {
  const options = typeof optionsOrField === "string"
    ? { field: optionsOrField, maxLength: Number(maybeMaxLength) || 12000, required: true }
    : (optionsOrField || {});
  const { maxLength = 20000, field = "body", required = true } = options;
  if (value === undefined || value === null) {
    if (required) {
      throw new EmailServiceError("email_invalid_input", `${field} 不能为空`, 400);
    }
    return "";
  }
  if (typeof value !== "string") {
    throw new EmailServiceError("email_invalid_input", `${field} 必须是字符串`, 400);
  }
  if (/\0/.test(value) || CONTROL_CHAR_REGEX.test(value)) {
    throw new EmailServiceError("email_invalid_input", `${field} 包含非法控制字符`, 400);
  }
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized && required) {
    throw new EmailServiceError("email_invalid_input", `${field} 不能为空`, 400);
  }
  if (normalized.length > maxLength) {
    throw new EmailServiceError("email_invalid_input", `${field} 长度不能超过 ${maxLength} 个字符`, 400);
  }
  return normalized;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function maskEmailAddress(email) {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at <= 0) return "***";
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

export function redactSensitiveText(text, forceRedact = false) {
  const source = String(text || "");
  if (!forceRedact) return source;
  return source.replace(/(?<!\d)\d{4,8}(?!\d)/g, "[REDACTED_OTP_CODE]");
}

export function validateCustomHeaders(rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    return {};
  }
  const cleaned = {};
  for (const [rawKey, rawVal] of Object.entries(rawHeaders)) {
    const key = cleanSingleLineText(String(rawKey || ""), { maxLength: 80, field: "header_name", required: true });
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_CUSTOM_HEADERS.has(lowerKey)) {
      throw new EmailServiceError(
        "email_header_not_allowed",
        `邮件头 ${key} 由系统/Cloudflare 协议层控制，禁止放入自定义 headers`,
        400
      );
    }
    const isCustomXHeader = /^x-[a-z0-9_-]{1,64}$/i.test(key);
    if (!isCustomXHeader && !ALLOWED_STANDARD_CUSTOM_HEADERS.has(lowerKey)) {
      throw new EmailServiceError(
        "email_header_not_allowed",
        `不支持的自定义邮件头 ${key}`,
        400
      );
    }
    const value = cleanSingleLineText(String(rawVal ?? ""), { maxLength: 400, field: `header_${key}`, required: true });
    cleaned[key] = value;
  }
  return cleaned;
}

export function renderHtmlEnvelope({ title, eyebrow = "Aeris Mail", subject, paragraphs = [], footer = "" }) {
  const safeTitle = escapeHtml(title || subject || "Aeris 通知");
  const safeEyebrow = escapeHtml(eyebrow);
  const bodyHtml = paragraphs
    .map((line) => String(line ?? ""))
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 12px;color:#1e293b;font-size:15px;line-height:1.65;">${escapeHtml(line)}</p>`
        : `<div style="height:8px;"></div>`
    )
    .join("\n");
  const footerHtml = footer
    ? `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.5;">${escapeHtml(footer)}</p>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '<div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 26px;">',
    `<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#0f766e;font-weight:700;margin-bottom:8px;">${safeEyebrow}</div>`,
    `<h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#0f172a;">${safeTitle}</h1>`,
    bodyHtml,
    footerHtml,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}

function purposeText(purpose = "security") {
  const raw = String(purpose || "").trim();
  const key = raw.toLowerCase();
  if (!raw || key === "security") return "身份安全校验";
  if (key === "bind" || key === "email_bind" || key === "register") return "邮箱绑定与注册确认";
  if (key === "change_bind" || key === "rebind") return "更换绑定邮箱";
  if (key === "login_mfa" || key === "login") return "登录二次认证（MFA）";
  if (key === "mfa_enable" || key === "mfa") return "双因素认证配置";
  if (key === "recovery" || key === "password_reset" || key === "reset") return "账户安全恢复";
  return cleanSingleLineText(raw, { maxLength: 60, field: "purpose" });
}

export function renderTransactionalEmail(options = {}) {
  const kind = cleanSingleLineText(String(options.kind || ""), { maxLength: 64, field: "kind" });
  if (!ALLOWED_TRANSACTIONAL_KINDS.includes(kind)) {
    throw new EmailServiceError("email_invalid_kind", `不支持的邮件类型: ${kind}`, 400);
  }

  const username = options.username ? cleanSingleLineText(String(options.username), { maxLength: 80, field: "username" }) : "用户";
  const expiresMinutes = Math.max(1, Math.min(60, Number(options.expiresMinutes || options.expires_minutes || 10) || 10));
  const detailText = options.detail
    ? cleanBodyText(String(options.detail), { maxLength: 2000, field: "detail" })
    : options.eventSummary
      ? cleanBodyText(String(options.eventSummary), { maxLength: 2000, field: "eventSummary" })
      : "";

  let subject = "";
  let textLines = [];
  let eyebrow = "Aeris Transactional Mail";
  let title = "";
  let sensitiveOtp = OTP_REDACTED_KINDS.has(kind);

  if (kind === "verification_code" || kind === "email_bind_verification" || kind === "login_mfa_code") {
    sensitiveOtp = true;
    const rawCode = cleanSingleLineText(String(options.code || options.otpCode || ""), {
      maxLength: 16,
      field: "code",
    });
    if (!/^[A-Za-z0-9]{4,12}$/.test(rawCode)) {
      throw new EmailServiceError("email_invalid_code", "验证码格式无效，必须为 4-12 位字母或数字", 400);
    }
    const label = purposeText(
      kind === "email_bind_verification"
        ? options.purpose || "bind"
        : kind === "login_mfa_code"
          ? options.purpose || "login_mfa"
          : options.purpose || "security"
    );
    subject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : `Aeris ${label}验证码`;
    eyebrow = "Aeris Security Verification";
    title = `${label}验证码`;
    textLines = [
      `您好 ${username}，`,
      `您正在进行 Aeris「${label}」操作，请使用以下 6 位或安全验证码完成确认：`,
      `验证码：${rawCode}`,
      `有效时间：${expiresMinutes} 分钟内有效，请勿向任何人转发或泄露此验证码。`,
      `如非本人发起此次操作，请立即修改登录密码并检查安全中心会话。`,
    ];
  } else if (kind === "password_reset_notice") {
    subject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : "Aeris 安全通知：您的账户密码已重置";
    eyebrow = "Aeris Account Recovery";
    title = "账户密码已重置";
    textLines = [
      `您好 ${username}，`,
      detailText || "您的 Aeris 账户密码刚刚已完成重置或由授权管理员协助恢复，原有登录会话已失效。",
      `请使用新凭据重新登录；如非本人或未曾申请密码重置，请立即联系 ${SUPPORT_FROM_EMAIL}。`,
    ];
  } else if (kind === "password_changed_notice") {
    subject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : "Aeris 安全提醒：登录密码已修改";
    eyebrow = "Aeris Security Alert";
    title = "登录密码已成功修改";
    textLines = [
      `您好 ${username}，`,
      detailText || "您的 Aeris 登录密码刚刚修改成功，系统已注销此前所有设备会话。",
      `如非本人操作，请立即联系 ${SUPPORT_FROM_EMAIL} 协助冻结账户。`,
    ];
  } else if (kind === "mfa_changed_notice") {
    subject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : "Aeris 安全通知：双因素认证（MFA）设置已变更";
    eyebrow = "Aeris MFA Security";
    title = "双因素认证设置已更新";
    textLines = [
      `您好 ${username}，`,
      detailText || "您的账户双因素认证（MFA / TOTP / 恢复码）配置刚刚发生变更。",
      `如非本人操作，请立即登录账户安全中心核查并联系 ${SUPPORT_FROM_EMAIL}。`,
    ];
  } else if (kind === "session_security_notice" || kind === "security_notice" || kind === "account_security_notice") {
    const occurredAtText = options.occurredAt
      ? `发生时间：${cleanSingleLineText(String(options.occurredAt), { maxLength: 64, field: "occurredAt" })}`
      : "";
    subject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : "Aeris 安全通知：登录与设备会话状态提醒";
    eyebrow = "Aeris Session Security";
    title = "账户安全与会话状态通知";
    textLines = [
      `您好 ${username}，`,
      detailText || cleanBodyText(String(options.body || options.text || "系统检测到与您账户相关的安全事件或全设备会话注销操作，请确认是否为您本人操作。"), { maxLength: 8000, field: "body" }),
      occurredAtText,
      `如确认非本人操作，请立即前往账户安全中心修改密码并检查绑定方式，或联系 ${SUPPORT_FROM_EMAIL}。`,
    ].filter(Boolean);
  } else if (kind === "order_status_notice" || kind === "membership_change_notice") {
    subject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : kind === "order_status_notice"
        ? "Aeris 订单与开通状态通知"
        : "Aeris 会员权益变更通知";
    eyebrow = "Aeris Account & Billing";
    title = kind === "order_status_notice" ? "订单状态更新通知" : "会员权益状态更新";
    const orderInfo = options.orderId ? `订单编号：${cleanSingleLineText(String(options.orderId), { maxLength: 80, field: "orderId" })}` : "";
    const statusInfo = options.statusLabel ? `处理结果：${cleanSingleLineText(String(options.statusLabel), { maxLength: 120, field: "statusLabel" })}` : "";
    textLines = [
      `您好 ${username}，`,
      orderInfo,
      statusInfo,
      detailText || (options.body ? cleanBodyText(String(options.body), { maxLength: 8000, field: "body" }) : "您的会员或订单状态已完成处理，可登录 Aeris 查看最新权益有效期。"),
    ].filter(Boolean);
  } else if (kind === "support_reply") {
    const baseSubject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : "Aeris 客服回复";
    subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
    eyebrow = "Aeris Support Reply";
    title = subject;
    const bodyText = cleanBodyText(String(options.body || ""), { maxLength: 20000, field: "body" });
    const threadNote = options.threadId ? `会话参考号：${cleanSingleLineText(String(options.threadId), { maxLength: 80, field: "threadId" })}` : "";
    textLines = [
      "您好，",
      ...bodyText.split("\n"),
      threadNote,
      `如需继续咨询，请直接回复本邮件至 ${SUPPORT_FROM_EMAIL}。`,
    ].filter(Boolean);
  } else if (kind === "support_auto_ack") {
    const baseSubject = options.subject
      ? cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" })
      : "您的支持请求";
    subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
    eyebrow = "Aeris Support Auto-Acknowledgement";
    title = "已收到您的客服来信";
    textLines = [
      "您好，",
      "我们已收到您发送至 support@thewyj.uk 的来信并完成受理登记，运营与技术支持团队将尽快人工审阅并回复。",
      options.threadId ? `工单会话编号：${cleanSingleLineText(String(options.threadId), { maxLength: 80, field: "threadId" })}` : "",
      "本邮件为系统自动确认回执，无需重复来信。",
    ].filter(Boolean);
  } else {
    // admin_service_notice, system_maintenance_notice, test_email, owner_ops_test
    const isTestKind = kind === "test_email" || kind === "owner_ops_test";
    subject = cleanSingleLineText(
      String(options.subject || (isTestKind ? "Aeris Cloudflare Email 连通性测试" : "Aeris 服务与系统通知")),
      { maxLength: 180, field: "subject" }
    );
    eyebrow = isTestKind ? "Aeris Diagnostics" : "Aeris Service Notice";
    title = subject;
    const bodyText = cleanBodyText(
      String(options.body || options.text || detailText || "这是一封由 Aeris 邮件中心发送的系统服务通知邮件。"),
      { maxLength: 20000, field: "body" }
    );
    textLines = bodyText.split("\n");
  }

  const text = textLines.join("\n\n");
  const footer = kind === "support_reply"
    ? `Aeris 客服支持 · ${SUPPORT_FROM_EMAIL}`
    : `此邮件由 Aeris 系统发出；如需联系人工客服，请致信 ${SUPPORT_FROM_EMAIL}。`;
  const html = renderHtmlEnvelope({
    title,
    eyebrow,
    subject,
    paragraphs: textLines,
    footer,
  });

  return {
    kind,
    subject,
    text,
    html,
    sensitiveOtp,
  };
}

export function buildEmailMessage(options = {}, env = {}) {
  const recipient = cleanEmailAddress(options.to || options.recipient, "recipient");
  const rendered = options.subject && options.text && options.html && !options.forceTemplateRender
    ? {
      kind: cleanSingleLineText(String(options.kind || "admin_service_notice"), { maxLength: 64, field: "kind" }),
      subject: cleanSingleLineText(String(options.subject), { maxLength: 180, field: "subject" }),
      text: cleanBodyText(String(options.text), { maxLength: 20000, field: "text" }),
      html: String(options.html),
      sensitiveOtp: OTP_REDACTED_KINDS.has(String(options.kind || "")),
    }
    : renderTransactionalEmail(options);

  if (!ALLOWED_TRANSACTIONAL_KINDS.includes(rendered.kind)) {
    throw new EmailServiceError("email_invalid_kind", `不支持的邮件类型: ${rendered.kind}`, 400);
  }

  const requestedFrom = options.from ? cleanEmailAddress(options.from, "from") : DEFAULT_FROM_EMAIL;
  if (!ALLOWED_SENDER_ADDRESSES.includes(requestedFrom)) {
    throw new EmailServiceError("email_sender_not_allowed", `发件人地址 ${requestedFrom} 不在系统白名单内`, 400);
  }
  if (requestedFrom === SUPPORT_FROM_EMAIL && !supportSenderAuthorized(env) && !options.allowUnauthorizedSupportTest) {
    throw new EmailServiceError(
      "email_sender_unauthorized",
      "当前环境尚未授权直接以 support@thewyj.uk 发信（需启用 EMAIL_SUPPORT_SENDER_AUTHORIZED=true 或改用 noreply@thewyj.uk 并设置 Reply-To）",
      403
    );
  }

  const fromName = cleanSingleLineText(
    String(options.fromName || (requestedFrom === SUPPORT_FROM_EMAIL ? SUPPORT_FROM_NAME : DEFAULT_FROM_NAME)),
    { maxLength: 80, field: "fromName" }
  );

  const requestedReplyTo = options.replyTo ? cleanEmailAddress(options.replyTo, "replyTo") : DEFAULT_REPLY_TO_EMAIL;
  if (!ALLOWED_REPLY_TO_ADDRESSES.includes(requestedReplyTo)) {
    throw new EmailServiceError("email_reply_to_not_allowed", `Reply-To 地址 ${requestedReplyTo} 不在白名单内`, 400);
  }
  const replyToName = cleanSingleLineText(
    String(options.replyToName || (requestedReplyTo === DEFAULT_FROM_EMAIL ? DEFAULT_FROM_NAME : DEFAULT_REPLY_TO_NAME)),
    { maxLength: 80, field: "replyToName" }
  );

  const rawHeaders = { ...(options.headers || {}) };
  if (options.threadId && !rawHeaders["X-Aeris-Thread"]) {
    rawHeaders["X-Aeris-Thread"] = String(options.threadId);
  }
  if (options.deliveryId && !rawHeaders["X-Aeris-Delivery-Id"]) {
    rawHeaders["X-Aeris-Delivery-Id"] = String(options.deliveryId);
  }
  if (options.inReplyTo && !rawHeaders["In-Reply-To"]) {
    rawHeaders["In-Reply-To"] = String(options.inReplyTo);
  }
  if (options.references && !rawHeaders["References"]) {
    rawHeaders["References"] = String(options.references);
  }
  if (rendered.kind === "support_auto_ack" && !rawHeaders["Auto-Submitted"]) {
    rawHeaders["Auto-Submitted"] = "auto-replied";
  }

  const headers = validateCustomHeaders(rawHeaders);

  return {
    kind: rendered.kind,
    to: recipient,
    from: requestedFrom,
    fromName,
    replyTo: requestedReplyTo,
    replyToName,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers,
    sensitiveOtp: Boolean(rendered.sensitiveOtp || options.redactSensitiveBody),
  };
}

export function buildCloudflareRestPayload(message = {}) {
  const fromAddress = message.from || message.fromEmail || DEFAULT_FROM_EMAIL;
  const fromName = message.fromName || (fromAddress === SUPPORT_FROM_EMAIL ? SUPPORT_FROM_NAME : DEFAULT_FROM_NAME);
  const toAddress = message.to || message.toEmail || message.recipient;
  const replyToAddress = message.replyTo || message.replyToEmail || DEFAULT_REPLY_TO_EMAIL;
  const replyToName = message.replyToName || (replyToAddress === DEFAULT_FROM_EMAIL ? DEFAULT_FROM_NAME : DEFAULT_REPLY_TO_NAME);
  const subject = message.subject ?? message.payload?.subject ?? "";
  const text = message.text ?? message.payload?.text ?? "";
  const html = message.html ?? message.payload?.html ?? "";
  const payload = {
    from: {
      address: fromAddress,
      name: fromName,
    },
    to: [toAddress],
    reply_to: {
      address: replyToAddress,
      name: replyToName,
    },
    subject,
    text,
    html,
  };
  if (message.headers && Object.keys(message.headers).length > 0) {
    payload.headers = message.headers;
  }
  return payload;
}

export function buildWorkersBindingPayload(message) {
  const payload = {
    from: {
      email: message.from,
      name: message.fromName || DEFAULT_FROM_NAME,
    },
    to: [{ email: message.to }],
    replyTo: {
      email: message.replyTo || DEFAULT_REPLY_TO_EMAIL,
      name: message.replyToName || DEFAULT_REPLY_TO_NAME,
    },
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (message.headers && Object.keys(message.headers).length > 0) {
    payload.headers = message.headers;
  }
  return payload;
}

export function classifyProviderError({ status = 0, payload = null, error = null }) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const firstCode = errors[0]?.code ? String(errors[0].code) : "";
  const rawMsg = errors[0]?.message || payload?.error || error?.message || "邮件服务商请求失败";
  const safeMsg = cleanSingleLineText(String(rawMsg).slice(0, 220), { maxLength: 240, field: "error_message", required: false }) || "邮件服务商请求失败";

  if (error && !payload) {
    const errorText = String(error?.message || "");
    if (/rate[\s_-]?limit|too many requests|\b429\b/i.test(errorText)) {
      return new EmailServiceError("email_provider_rate_limited", "邮件发送触发 Cloudflare 速率限制，请稍后重试", 429, {
        retryable: true,
        provider_status: 429,
        provider_code: firstCode || "E_RATE_LIMITED",
        provider_message: safeMsg,
      });
    }
    if (/unauthorized|forbidden|invalid.?token|auth.*fail|\b(401|403)\b/i.test(errorText)) {
      return new EmailServiceError("email_provider_auth_failed", "Cloudflare 邮件发送凭据或权限校验失败", 502, {
        retryable: false,
        provider_status: status || 401,
        provider_code: firstCode || "E_UNAUTHORIZED",
        provider_message: safeMsg,
      });
    }
    if (/reject|bounce|suppressed|invalid.?recipient|\b(400|422)\b/i.test(errorText)) {
      return new EmailServiceError("email_provider_rejected", "邮件服务商拒绝该收件请求，请核对地址或内容格式", 422, {
        retryable: false,
        provider_status: 422,
        provider_code: firstCode || "E_REJECTED",
        provider_message: safeMsg,
      });
    }
  }

  if (status === 401 || status === 403 || firstCode === "10000" || firstCode === "E_UNAUTHORIZED") {
    return new EmailServiceError("email_provider_auth_failed", `Cloudflare 邮件鉴权失败 (${status || firstCode || "auth"})`, 502, {
      retryable: false,
      provider_status: status,
      provider_code: firstCode,
    });
  }
  if (status === 429 || firstCode === "E_RATE_LIMITED") {
    return new EmailServiceError("email_provider_rate_limited", "Cloudflare 邮件通道触发速率限制，请稍后重试", 429, {
      retryable: true,
      provider_status: status,
      provider_code: firstCode,
    });
  }
  if (status >= 400 && status < 500) {
    return new EmailServiceError("email_provider_rejected", `Cloudflare 拒绝发信请求：${safeMsg}`, 400, {
      retryable: false,
      provider_status: status,
      provider_code: firstCode,
    });
  }
  if (status >= 500 || error?.name === "AbortError" || /timeout|network|fetch/i.test(String(error?.message || ""))) {
    return new EmailServiceError("email_provider_unavailable", `Cloudflare 邮件服务暂时不可用：${safeMsg}`, 503, {
      retryable: true,
      provider_status: status,
      provider_code: firstCode,
    });
  }
  return new EmailServiceError("email_send_failed", safeMsg, 502, {
    retryable: true,
    provider_status: status,
    provider_code: firstCode,
  });
}

function normalizeCloudflareDeliveryResult(rawResult, message, transport, deliveryId) {
  const data = rawResult?.result && typeof rawResult.result === "object" ? rawResult.result : (rawResult || {});
  const delivered = Array.isArray(data.delivered) ? data.delivered : [];
  const queued = Array.isArray(data.queued) ? data.queued : [];
  const permanentBounces = Array.isArray(data.permanent_bounces)
    ? data.permanent_bounces
    : Array.isArray(data.permanentBounces)
      ? data.permanentBounces
      : [];
  const suppressedRecipients = Array.isArray(data.suppressed_recipients)
    ? data.suppressed_recipients
    : Array.isArray(data.suppressedRecipients)
      ? data.suppressedRecipients
      : [];
  const messageId = String(data.message_id || data.messageId || deliveryId || "");
  const sentAt = new Date().toISOString();

  let deliveryStatus = "queued";
  let ok = true;
  let inboxDeliveryConfirmed = false;
  let errorCode = null;
  let errorMessage = null;
  let retryable = false;

  if (permanentBounces.length > 0) {
    deliveryStatus = "rejected";
    ok = false;
    errorCode = "email_recipient_bounced";
    errorMessage = "Cloudflare 返回永久退信/拒收";
  } else if (suppressedRecipients.length > 0) {
    deliveryStatus = "suppressed";
    ok = false;
    errorCode = "email_recipient_suppressed";
    errorMessage = "收件地址处于服务商抑制名单（Suppressed）";
  } else if (delivered.length > 0 && queued.length === 0) {
    deliveryStatus = "delivered";
    ok = true;
    inboxDeliveryConfirmed = true;
  } else if (queued.length > 0 || messageId) {
    deliveryStatus = "queued";
    ok = true;
    inboxDeliveryConfirmed = false;
  }

  return {
    ok,
    transport,
    delivery_id: deliveryId,
    delivery_status: deliveryStatus,
    inbox_delivery_confirmed: inboxDeliveryConfirmed,
    delivered,
    queued,
    permanent_bounces: permanentBounces,
    suppressed_recipients: suppressedRecipients,
    message_id: messageId,
    from: message.from,
    reply_to: message.replyTo,
    kind: message.kind,
    recipient: message.to,
    sent_at: sentAt,
    error_code: errorCode,
    error_message: errorMessage,
    retryable,
  };
}

async function sendViaCloudflareRest(env, message, deliveryId) {
  const accountId = cleanSingleLineText(String(env?.EMAIL_CLOUDFLARE_ACCOUNT_ID || ""), {
    maxLength: 80,
    field: "EMAIL_CLOUDFLARE_ACCOUNT_ID",
  });
  const token = cleanSingleLineText(String(env?.EMAIL_SEND_API_TOKEN || ""), {
    maxLength: 512,
    field: "EMAIL_SEND_API_TOKEN",
  });
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`;
  const payload = buildCloudflareRestPayload(message);

  const fetchImpl = typeof env?.__EMAIL_FETCH === "function" ? env.__EMAIL_FETCH : fetch;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw classifyProviderError({ status: 0, error });
  }

  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok || parsed?.success === false) {
    throw classifyProviderError({ status: response.status, payload: parsed });
  }

  return normalizeCloudflareDeliveryResult(parsed, message, "cloudflare_rest", deliveryId);
}

async function sendViaWorkersBinding(env, message, deliveryId) {
  const payload = buildWorkersBindingPayload(message);
  let result;
  try {
    result = await env.EMAIL.send(payload);
  } catch (error) {
    throw classifyProviderError({ status: 502, error });
  }
  return normalizeCloudflareDeliveryResult(result, message, "workers_binding", deliveryId);
}

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix) {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function tableExists(db, tableName) {
  if (!db) return false;
  try {
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind(tableName)
      .first();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

export async function hasTask27SecurityTable(db) {
  return tableExists(db, "task27_security");
}

function isNewerVerifiedTimestamp(candidateIso, baselineIso) {
  const cand = String(candidateIso || "").trim();
  if (!cand) return false;
  const base = String(baselineIso || "").trim();
  if (!base) return true;
  const candMs = Date.parse(cand);
  const baseMs = Date.parse(base);
  if (Number.isFinite(candMs) && Number.isFinite(baseMs)) {
    return candMs > baseMs;
  }
  return cand > base;
}

export async function resolveVerifiedUserEmail(db, userId) {
  if (!db || !userId) return null;
  const uid = String(userId).trim();
  if (!uid) return null;

  let verifiedBinding = null;
  let unverifiedBinding = null;
  if (await tableExists(db, "email_center_bindings")) {
    const binding = await db
      .prepare("SELECT user_id, email, verified, verified_at, updated_at FROM email_center_bindings WHERE user_id = ? LIMIT 1")
      .bind(uid)
      .first();
    if (binding?.email) {
      const normalized = String(binding.email).trim().toLowerCase();
      if (Number(binding.verified) === 1) {
        verifiedBinding = {
          user_id: uid,
          email: normalized,
          email_normalized: normalized,
          verified: true,
          verified_at: binding.verified_at || null,
          source: "email_center_bindings",
          updated_at: binding.updated_at || binding.verified_at || null,
        };
      } else {
        unverifiedBinding = {
          user_id: uid,
          email: normalized,
          email_normalized: normalized,
          verified: false,
          verified_at: binding.verified_at || null,
          source: "email_center_bindings",
          updated_at: binding.updated_at || null,
        };
      }
    }
  }

  let task27Verified = null;
  if (await hasTask27SecurityTable(db)) {
    try {
      const sec = await db
        .prepare("SELECT user_id, verified_email, email_verified_at FROM task27_security WHERE user_id = ? LIMIT 1")
        .bind(uid)
        .first();
      const verifiedEmail = String(sec?.verified_email || "").trim().toLowerCase();
      const verifiedAt = String(sec?.email_verified_at || "").trim();
      if (verifiedEmail && verifiedAt) {
        task27Verified = {
          user_id: uid,
          email: verifiedEmail,
          email_normalized: verifiedEmail,
          verified: true,
          verified_at: verifiedAt,
          source: "task27_security",
          updated_at: verifiedAt,
        };
      }
    } catch {
      // ignore incompatible schema cleanly
    }
  }

  if (verifiedBinding && task27Verified) {
    return isNewerVerifiedTimestamp(task27Verified.verified_at, verifiedBinding.verified_at || verifiedBinding.updated_at)
      ? task27Verified
      : verifiedBinding;
  }
  if (verifiedBinding) return verifiedBinding;
  if (task27Verified) return task27Verified;

  if (unverifiedBinding) {
    return unverifiedBinding;
  }

  if (await tableExists(db, "task27_user_security")) {
    try {
      const sec = await db
        .prepare("SELECT user_id, recovery_email, email_verified, email_verified_at FROM task27_user_security WHERE user_id = ? LIMIT 1")
        .bind(uid)
        .first();
      if (sec?.recovery_email) {
        const normalized = String(sec.recovery_email).trim().toLowerCase();
        return {
          user_id: uid,
          email: normalized,
          email_normalized: normalized,
          verified: Number(sec.email_verified) === 1,
          verified_at: sec.email_verified_at || null,
          source: "task27_user_security",
          updated_at: sec.email_verified_at || null,
        };
      }
    } catch {
      // ignore incompatible schema cleanly
    }
  }

  return null;
}

export const getUserEmailBinding = resolveVerifiedUserEmail;

export async function upsertUserEmailBinding(db, { userId, email, verified = false, verifiedAt: customVerifiedAt = null, actorUserId = null }) {
  if (!db) {
    throw new EmailServiceError("email_db_unavailable", "D1 数据库不可用，无法更新邮箱绑定", 503);
  }
  const uid = cleanSingleLineText(String(userId || ""), { maxLength: 80, field: "user_id" });
  const normalized = cleanEmailAddress(email, "email");
  const isVerified = verified ? 1 : 0;
  const ts = nowIso();
  const verifiedAt = isVerified ? (customVerifiedAt || ts) : null;

  await db
    .prepare(
      `INSERT INTO email_center_bindings (user_id, email, verified, verified_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         verified = excluded.verified,
         verified_at = CASE WHEN excluded.verified = 1 THEN COALESCE(email_center_bindings.verified_at, excluded.verified_at) ELSE NULL END,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    )
    .bind(uid, normalized, isVerified, verifiedAt, actorUserId || uid, ts)
    .run();

  if (isVerified === 1 && (await hasTask27SecurityTable(db))) {
    try {
      await db
        .prepare(
          `INSERT INTO task27_security (user_id, verified_email, email_verified_at, password_age_start_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             verified_email = excluded.verified_email,
             email_verified_at = excluded.email_verified_at`
        )
        .bind(uid, normalized, verifiedAt || ts, ts)
        .run();
    } catch {
      // Preserve binding update even if task27_security schema differs in isolated tests
    }
  }

  return {
    user_id: uid,
    email: normalized,
    verified: isVerified === 1,
    verified_at: verifiedAt,
    updated_at: ts,
  };
}

async function checkD1RateLimit(db, { recipientEmail, kind, targetUserId, windowSeconds = 600, maxCount = 5 }) {
  if (!db || !(await tableExists(db, "email_center_deliveries"))) return { allowed: true, count: 0 };
  const threshold = new Date(Date.now() - windowSeconds * 1000).toISOString();
  let countRow;
  if (OTP_REDACTED_KINDS.has(kind)) {
    countRow = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM email_center_deliveries
         WHERE recipient_email = ? AND kind IN ('verification_code', 'email_bind_verification', 'login_mfa_code')
           AND created_at >= ? AND status IN ('delivered', 'queued')`
      )
      .bind(recipientEmail, threshold)
      .first();
  } else if (targetUserId) {
    countRow = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM email_center_deliveries
         WHERE target_user_id = ? AND kind = ? AND created_at >= ? AND status IN ('delivered', 'queued')`
      )
      .bind(targetUserId, kind, threshold)
      .first();
  } else {
    countRow = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM email_center_deliveries
         WHERE recipient_email = ? AND kind = ? AND created_at >= ? AND status IN ('delivered', 'queued')`
      )
      .bind(recipientEmail, kind, threshold)
      .first();
  }
  const cnt = Number(countRow?.cnt || 0);
  return { allowed: cnt < maxCount, count: cnt, limit: maxCount, window_seconds: windowSeconds };
}

function sanitizeMetadataForStorage(meta) {
  if (!meta || typeof meta !== "object") return null;
  const redacted = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/^(code|otp|otpcode|secret|token|password|recovery_code|api_key)$/i.test(k)) {
      redacted[k] = "[REDACTED]";
    } else if (v !== undefined) {
      redacted[k] = v;
    }
  }
  return JSON.stringify(redacted).slice(0, 1500);
}

export async function recordEmailDelivery(db, record) {
  if (!db || !(await tableExists(db, "email_center_deliveries"))) return null;
  const ts = nowIso();
  const redacted = Boolean(record.body_redacted);
  const safeSubject = redactSensitiveText(record.subject || "", redacted).slice(0, 200);
  const safePreview = redactSensitiveText(record.body_preview || "", redacted).slice(0, 260);
  await db
    .prepare(
      `INSERT INTO email_center_deliveries (
        delivery_id, idempotency_key, kind, channel, trigger_source,
        actor_user_id, actor_role, target_user_id, recipient_email,
        from_email, reply_to, subject, body_preview, body_redacted,
        status, transport, provider_message_id, error_code, error_message,
        retryable, retry_count, max_retries, parent_delivery_id,
        batch_id, thread_id, inbound_message_id, metadata_json,
        sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.delivery_id,
      record.idempotency_key || null,
      record.kind,
      record.channel || "transactional",
      record.trigger_source || "system_event",
      record.actor_user_id || null,
      record.actor_role || null,
      record.target_user_id || null,
      record.recipient_email,
      record.from_email,
      record.reply_to || null,
      safeSubject,
      safePreview,
      redacted ? 1 : 0,
      record.status,
      record.transport || null,
      record.provider_message_id || null,
      record.error_code || null,
      record.error_message ? String(record.error_message).slice(0, 240) : null,
      record.retryable ? 1 : 0,
      Number(record.retry_count || 0),
      Number(record.max_retries || 3),
      record.parent_delivery_id || null,
      record.batch_id || null,
      record.thread_id || null,
      record.inbound_message_id || null,
      sanitizeMetadataForStorage(record.metadata),
      record.sent_at || null,
      ts,
      ts
    )
    .run();
  return record.delivery_id;
}

export async function getEmailDeliveryStatus(db, { deliveryId = null, idempotencyKey = null } = {}) {
  if (!db || !(await tableExists(db, "email_center_deliveries"))) return null;
  let row = null;
  if (deliveryId) {
    row = await db
      .prepare("SELECT * FROM email_center_deliveries WHERE delivery_id = ? LIMIT 1")
      .bind(String(deliveryId))
      .first();
  } else if (idempotencyKey) {
    row = await db
      .prepare("SELECT * FROM email_center_deliveries WHERE idempotency_key = ? LIMIT 1")
      .bind(String(idempotencyKey))
      .first();
  }
  if (!row) return null;
  return {
    delivery_id: row.delivery_id,
    idempotency_key: row.idempotency_key,
    kind: row.kind,
    channel: row.channel,
    trigger_source: row.trigger_source,
    target_user_id: row.target_user_id,
    recipient_masked: maskEmailAddress(row.recipient_email),
    from_email: row.from_email,
    reply_to: row.reply_to,
    delivery_status: row.status,
    inbox_delivery_confirmed: row.status === "delivered",
    transport: row.transport,
    message_id: row.provider_message_id,
    error_code: row.error_code,
    error_message: row.error_message,
    retryable: Number(row.retryable) === 1,
    retry_count: Number(row.retry_count || 0),
    max_retries: Number(row.max_retries || 3),
    batch_id: row.batch_id,
    thread_id: row.thread_id,
    sent_at: row.sent_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function sendTransactionalEmail(env, options = {}) {
  const db = env?.WYJ_DB || options.db || null;
  const deliveryId = cleanSingleLineText(String(options.deliveryId || generateId("dlv")), {
    maxLength: 80,
    field: "deliveryId",
  });
  const idempotencyKey = options.idempotencyKey
    ? cleanSingleLineText(String(options.idempotencyKey), { maxLength: 140, field: "idempotencyKey" })
    : null;

  if (idempotencyKey && db && (await tableExists(db, "email_center_deliveries"))) {
    const existing = await db
      .prepare("SELECT * FROM email_center_deliveries WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first();
    if (existing) {
      return {
        ok: existing.status === "delivered" || existing.status === "queued",
        idempotent_reused: true,
        duplicate_prevented: true,
        delivery_id: existing.delivery_id,
        transport: existing.transport || "cached",
        delivery_status: existing.status,
        inbox_delivery_confirmed: existing.status === "delivered",
        delivered: existing.status === "delivered" ? [existing.recipient_email] : [],
        queued: existing.status === "queued" ? [existing.recipient_email] : [],
        permanent_bounces: existing.status === "rejected" ? [existing.recipient_email] : [],
        suppressed_recipients: existing.status === "suppressed" ? [existing.recipient_email] : [],
        message_id: existing.provider_message_id || existing.delivery_id,
        from: existing.from_email,
        reply_to: existing.reply_to || DEFAULT_REPLY_TO_EMAIL,
        kind: existing.kind,
        recipient: existing.recipient_email,
        sent_at: existing.sent_at || existing.created_at,
        error_code: existing.error_code || null,
        error_message: existing.error_message || null,
        retryable: Number(existing.retryable) === 1,
      };
    }
  }

  const message = buildEmailMessage({ ...options, deliveryId }, env);

  if (options.requireVerifiedEmail === true && db) {
    const uid = options.userId || options.targetUserId;
    if (!uid) {
      throw new EmailServiceError("email_verified_user_required", "需要提供有效用户 ID 以校验已验证邮箱", 400);
    }
    const verifiedBinding = await resolveVerifiedUserEmail(db, uid);
    if (!verifiedBinding || !verifiedBinding.verified || verifiedBinding.email !== message.to) {
      throw new EmailServiceError("email_recipient_not_verified", "收件邮箱尚未完成绑定验证，禁止发送此类安全邮件", 403);
    }
  } else if (options.requireVerifiedEmail === true && options.emailVerified !== true) {
    throw new EmailServiceError("email_recipient_not_verified", "收件邮箱尚未完成验证，禁止发送此类安全邮件", 403);
  }

  const allowedTestRecipients = parseAllowedTestRecipients(env);
  if (allowedTestRecipients.length > 0 && !allowedTestRecipients.includes(message.to)) {
    throw new EmailServiceError(
      "email_recipient_not_allowlisted",
      "当前环境已启用测试收件人白名单限制，仅允许发送给授权测试邮箱",
      403
    );
  }

  if (options.enforceRateLimit !== false && db) {
    const maxCount = OTP_REDACTED_KINDS.has(message.kind)
      ? Math.max(1, Number(env?.EMAIL_OTP_RATE_LIMIT_MAX || 5) || 5)
      : Math.max(1, Number(env?.EMAIL_TRANSACTIONAL_RATE_LIMIT_MAX || 20) || 20);
    const rate = await checkD1RateLimit(db, {
      recipientEmail: message.to,
      kind: message.kind,
      targetUserId: options.userId || options.targetUserId || null,
      windowSeconds: 600,
      maxCount,
    });
    if (!rate.allowed) {
      const rateErr = new EmailServiceError("email_rate_limited", "该收件人短期内发信过于频繁，请稍后再试", 429, {
        retryable: true,
        limit: rate.limit,
        window_seconds: rate.window_seconds,
      });
      await recordEmailDelivery(db, {
        delivery_id: deliveryId,
        idempotency_key: idempotencyKey,
        kind: message.kind,
        channel: options.channel || "transactional",
        trigger_source: options.triggerSource || "system_event",
        actor_user_id: options.actorUserId || null,
        actor_role: options.actorRole || null,
        target_user_id: options.userId || options.targetUserId || null,
        recipient_email: message.to,
        from_email: message.from,
        reply_to: message.replyTo,
        subject: message.subject,
        body_preview: message.text.slice(0, 240),
        body_redacted: message.sensitiveOtp,
        status: "failed",
        transport: resolveEmailTransport(env),
        error_code: rateErr.code,
        error_message: rateErr.message,
        retryable: true,
        parent_delivery_id: options.parentDeliveryId || null,
        batch_id: options.batchId || null,
        thread_id: options.threadId || null,
        inbound_message_id: options.inboundMessageId || null,
        metadata: options.metadata,
      });
      throw rateErr;
    }
  }

  if (!emailSendingEnabled(env)) {
    const disabledErr = new EmailServiceError("email_sending_disabled", "当前环境未开启 EMAIL_SENDING_ENABLED", 503, {
      retryable: true,
    });
    await recordEmailDelivery(db, {
      delivery_id: deliveryId,
      idempotency_key: idempotencyKey,
      kind: message.kind,
      channel: options.channel || "transactional",
      trigger_source: options.triggerSource || "system_event",
      actor_user_id: options.actorUserId || null,
      actor_role: options.actorRole || null,
      target_user_id: options.userId || options.targetUserId || null,
      recipient_email: message.to,
      from_email: message.from,
      reply_to: message.replyTo,
      subject: message.subject,
      body_preview: message.text.slice(0, 240),
      body_redacted: message.sensitiveOtp,
      status: "failed",
      transport: resolveEmailTransport(env),
      error_code: disabledErr.code,
      error_message: disabledErr.message,
      retryable: true,
      parent_delivery_id: options.parentDeliveryId || null,
      batch_id: options.batchId || null,
      thread_id: options.threadId || null,
      inbound_message_id: options.inboundMessageId || null,
      metadata: options.metadata,
    });
    throw disabledErr;
  }

  const transport = resolveEmailTransport(env);
  if (transport === "unconfigured") {
    const cfgErr = new EmailServiceError(
      "email_transport_unconfigured",
      "未配置 Workers EMAIL Binding 或 Cloudflare Email REST 凭据",
      503,
      { retryable: true }
    );
    await recordEmailDelivery(db, {
      delivery_id: deliveryId,
      idempotency_key: idempotencyKey,
      kind: message.kind,
      channel: options.channel || "transactional",
      trigger_source: options.triggerSource || "system_event",
      actor_user_id: options.actorUserId || null,
      actor_role: options.actorRole || null,
      target_user_id: options.userId || options.targetUserId || null,
      recipient_email: message.to,
      from_email: message.from,
      reply_to: message.replyTo,
      subject: message.subject,
      body_preview: message.text.slice(0, 240),
      body_redacted: message.sensitiveOtp,
      status: "failed",
      transport,
      error_code: cfgErr.code,
      error_message: cfgErr.message,
      retryable: true,
      parent_delivery_id: options.parentDeliveryId || null,
      batch_id: options.batchId || null,
      thread_id: options.threadId || null,
      inbound_message_id: options.inboundMessageId || null,
      metadata: options.metadata,
    });
    throw cfgErr;
  }

  try {
    const result =
      transport === "workers_binding"
        ? await sendViaWorkersBinding(env, message, deliveryId)
        : await sendViaCloudflareRest(env, message, deliveryId);

    await recordEmailDelivery(db, {
      delivery_id: deliveryId,
      idempotency_key: idempotencyKey,
      kind: message.kind,
      channel: options.channel || "transactional",
      trigger_source: options.triggerSource || "system_event",
      actor_user_id: options.actorUserId || null,
      actor_role: options.actorRole || null,
      target_user_id: options.userId || options.targetUserId || null,
      recipient_email: message.to,
      from_email: message.from,
      reply_to: message.replyTo,
      subject: message.subject,
      body_preview: message.text.slice(0, 240),
      body_redacted: message.sensitiveOtp,
      status: result.delivery_status,
      transport: result.transport,
      provider_message_id: result.message_id,
      error_code: result.error_code,
      error_message: result.error_message,
      retryable: false,
      retry_count: Number(options.retryCount || 0),
      parent_delivery_id: options.parentDeliveryId || null,
      batch_id: options.batchId || null,
      thread_id: options.threadId || null,
      inbound_message_id: options.inboundMessageId || null,
      metadata: options.metadata,
      sent_at: result.ok ? result.sent_at : null,
    });

    return result;
  } catch (error) {
    const serviceErr =
      error instanceof EmailServiceError
        ? error
        : new EmailServiceError("email_send_failed", error?.message || "发信失败", 502, { retryable: true });

    await recordEmailDelivery(db, {
      delivery_id: deliveryId,
      idempotency_key: idempotencyKey,
      kind: message.kind,
      channel: options.channel || "transactional",
      trigger_source: options.triggerSource || "system_event",
      actor_user_id: options.actorUserId || null,
      actor_role: options.actorRole || null,
      target_user_id: options.userId || options.targetUserId || null,
      recipient_email: message.to,
      from_email: message.from,
      reply_to: message.replyTo,
      subject: message.subject,
      body_preview: message.text.slice(0, 240),
      body_redacted: message.sensitiveOtp,
      status: "failed",
      transport,
      error_code: serviceErr.code,
      error_message: serviceErr.message,
      retryable: serviceErr.retryable,
      retry_count: Number(options.retryCount || 0),
      parent_delivery_id: options.parentDeliveryId || null,
      batch_id: options.batchId || null,
      thread_id: options.threadId || null,
      inbound_message_id: options.inboundMessageId || null,
      metadata: options.metadata,
    });

    serviceErr.details = { ...(serviceErr.details || {}), delivery_id: deliveryId };
    throw serviceErr;
  }
}

export async function safeSendTransactionalEmail(env, options = {}) {
  const deliveryId = cleanSingleLineText(String(options.deliveryId || generateId("dlv")), {
    maxLength: 80,
    field: "deliveryId",
  });
  try {
    return await sendTransactionalEmail(env, { ...options, deliveryId });
  } catch (error) {
    const err = error instanceof EmailServiceError
      ? error
      : new EmailServiceError("email_send_failed", error?.message || "邮件投递失败", 502, { retryable: true });
    return {
      ok: false,
      delivery_id: err.details?.delivery_id || deliveryId,
      delivery_status: "failed",
      inbox_delivery_confirmed: false,
      delivered: [],
      queued: [],
      permanent_bounces: [],
      suppressed_recipients: [],
      error_code: err.code,
      error_message: err.message,
      status_code: err.status,
      retryable: Boolean(err.retryable),
      transport: resolveEmailTransport(env),
      kind: options.kind || "security_notice",
      recipient: options.to || options.recipient || null,
    };
  }
}

export async function sendEmailBindingCode(env, options = {}) {
  return safeSendTransactionalEmail(env, {
    ...options,
    kind: "email_bind_verification",
    channel: "transactional",
    triggerSource: options.triggerSource || "task27_email_bind",
    purpose: options.purpose || "bind",
    requireVerifiedEmail: false,
    redactSensitiveBody: true,
  });
}

export async function sendLoginMfaCode(env, options = {}) {
  return safeSendTransactionalEmail(env, {
    ...options,
    kind: "login_mfa_code",
    channel: "transactional",
    triggerSource: options.triggerSource || "task27_login_mfa",
    purpose: options.purpose || "login_mfa",
    requireVerifiedEmail: options.requireVerifiedEmail !== false,
    redactSensitiveBody: true,
  });
}

export async function sendVerificationCode(env, options = {}) {
  const purpose = String(options.purpose || "").trim().toLowerCase();
  if (purpose === "bind" || purpose === "change_bind" || purpose === "register") {
    return sendEmailBindingCode(env, options);
  }
  return sendLoginMfaCode(env, {
    ...options,
    kind: options.kind || "verification_code",
    requireVerifiedEmail: options.requireVerifiedEmail !== false,
  });
}

export async function sendPasswordResetNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: "password_reset_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "password_reset",
  });
}

export async function sendPasswordChangedNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: "password_changed_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "password_changed",
  });
}

export async function sendMfaChangedNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: "mfa_changed_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "mfa_changed",
  });
}

export async function sendSessionSecurityNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: "session_security_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "session_security",
  });
}

export async function sendAccountSecurityNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: options.kind || "account_security_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "account_security",
  });
}

export const sendVerificationCodeEmail = sendVerificationCode;
export const sendLoginMfaCodeEmail = sendLoginMfaCode;
export const sendPasswordResetEmail = sendPasswordResetNotice;
export const sendMfaStatusChangeNotice = sendMfaChangedNotice;

export async function sendOrderStatusNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: options.kind || "order_status_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "order_status",
  });
}

export async function sendMembershipChangeNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: "membership_change_notice",
    channel: "transactional",
    triggerSource: options.triggerSource || "membership_change",
  });
}

export async function sendSystemMaintenanceNotice(env, options = {}) {
  return sendTransactionalEmail(env, {
    ...options,
    kind: options.kind || "system_maintenance_notice",
    channel: options.channel || "admin_manual",
    triggerSource: options.triggerSource || "system_maintenance",
  });
}

export async function sendSupportReplyEmail(env, options = {}) {
  const authorized = supportSenderAuthorized(env);
  const requestedFrom = options.from
    ? cleanEmailAddress(options.from, "from")
    : authorized
      ? SUPPORT_FROM_EMAIL
      : DEFAULT_FROM_EMAIL;

  if (requestedFrom === SUPPORT_FROM_EMAIL && !authorized) {
    throw new EmailServiceError(
      "email_sender_unauthorized",
      "support@thewyj.uk 发件身份尚未在 Cloudflare 授权，已拒绝直接伪造发件身份；请启用 EMAIL_SUPPORT_SENDER_AUTHORIZED=true 或使用 noreply@thewyj.uk + Reply-To: support@thewyj.uk",
      403
    );
  }

  return sendTransactionalEmail(env, {
    ...options,
    kind: "support_reply",
    from: requestedFrom,
    fromName: requestedFrom === SUPPORT_FROM_EMAIL ? SUPPORT_FROM_NAME : DEFAULT_FROM_NAME,
    replyTo: SUPPORT_FROM_EMAIL,
    replyToName: SUPPORT_FROM_NAME,
    channel: "support_reply",
    triggerSource: options.triggerSource || "support_reply",
  });
}

export async function sendSupportAutoAckEmail(env, options = {}) {
  return safeSendTransactionalEmail(env, {
    ...options,
    kind: "support_auto_ack",
    from: DEFAULT_FROM_EMAIL,
    fromName: DEFAULT_FROM_NAME,
    replyTo: SUPPORT_FROM_EMAIL,
    replyToName: SUPPORT_FROM_NAME,
    channel: "transactional",
    triggerSource: "inbound_auto_ack",
    enforceRateLimit: true,
  });
}

export async function notifyAutomaticBusinessEmail(contextOrEnv, options = {}) {
  const env = contextOrEnv?.env || contextOrEnv || {};
  const db = env?.WYJ_DB || options.db || null;
  const userId = options.userId || options.targetUserId || null;

  try {
    let recipientEmail = options.recipient || options.to || null;
    if (!recipientEmail && userId && db) {
      const binding = await resolveVerifiedUserEmail(db, userId);
      if (!binding || !binding.verified) {
        return { ok: false, skipped: true, reason: "no_verified_email" };
      }
      recipientEmail = binding.email;
    }
    if (!recipientEmail) {
      return { ok: false, skipped: true, reason: "missing_recipient" };
    }

    return await safeSendTransactionalEmail(env, {
      ...options,
      to: recipientEmail,
      userId,
      targetUserId: userId,
      channel: "transactional",
      triggerSource: options.triggerSource || options.kind || "business_event",
    });
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      delivery_status: "failed",
      error_code: error?.code || "email_auto_notify_failed",
      error_message: error?.message || "自动通知邮件失败",
    };
  }
}
