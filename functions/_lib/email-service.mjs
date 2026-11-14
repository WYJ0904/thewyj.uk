export const EMAIL_BUILD = "2026-11-13-email-sending-v1";
export const DEFAULT_FROM_EMAIL = "noreply@thewyj.uk";
export const DEFAULT_FROM_NAME = "Aeris";
export const DEFAULT_REPLY_TO_EMAIL = "support@thewyj.uk";
export const DEFAULT_REPLY_TO_NAME = "Aeris Support";

export const ALLOWED_SENDER_ADDRESSES = Object.freeze(["noreply@thewyj.uk"]);
export const ALLOWED_REPLY_TO_ADDRESSES = Object.freeze(["support@thewyj.uk"]);
export const ALLOWED_TRANSACTIONAL_KINDS = Object.freeze([
  "account_security_notice",
  "order_status_notice",
  "owner_ops_test",
]);

const ALLOWED_SENDER_SET = new Set(ALLOWED_SENDER_ADDRESSES);
const ALLOWED_REPLY_TO_SET = new Set(ALLOWED_REPLY_TO_ADDRESSES);
const ALLOWED_KIND_SET = new Set(ALLOWED_TRANSACTIONAL_KINDS);
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_SUBJECT_LENGTH = 120;
const MAX_BODY_LENGTH = 4000;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export class EmailServiceError extends Error {
  constructor(message, status = 400, code = "email_invalid_request", retryable = false, details = null) {
    super(message);
    this.name = "EmailServiceError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details && typeof details === "object" ? details : null;
  }
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function emailSendingEnabled(env = {}) {
  return booleanFlag(env?.EMAIL_SENDING_ENABLED, false);
}

export function resolveEmailTransport(env = {}) {
  if (typeof env?.EMAIL?.send === "function") return "binding";
  const token = String(env?.EMAIL_SEND_API_TOKEN || "").trim();
  const accountId = String(env?.EMAIL_CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (token && CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
    return "cloudflare_rest";
  }
  return "";
}

export function emailBindingConfigured(env = {}) {
  return Boolean(resolveEmailTransport(env));
}

export function cleanEmailAddress(value, fieldLabel = "收件邮箱") {
  if (typeof value !== "string") {
    throw new EmailServiceError(`${fieldLabel}格式无效`, 400, "email_address_invalid");
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH) {
    throw new EmailServiceError(`${fieldLabel}长度或格式无效`, 400, "email_address_invalid");
  }
  if (/[\u0000-\u001f\u007f<>(),;:"\\\s]/u.test(trimmed)) {
    throw new EmailServiceError(`${fieldLabel}包含不允许的字符`, 400, "email_address_invalid");
  }
  const normalized = trimmed.toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0 || at !== normalized.lastIndexOf("@")) {
    throw new EmailServiceError(`${fieldLabel}格式无效`, 400, "email_address_invalid");
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.length > MAX_LOCAL_LENGTH || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    throw new EmailServiceError(`${fieldLabel}格式无效`, 400, "email_address_invalid");
  }
  if (domain.includes("..") || !EMAIL_PATTERN.test(normalized)) {
    throw new EmailServiceError(`${fieldLabel}格式无效`, 400, "email_address_invalid");
  }
  return normalized;
}

export function parseAllowedTestRecipients(env = {}) {
  const raw = String(env?.EMAIL_TEST_RECIPIENTS || "").trim();
  if (!raw) return new Set();
  const set = new Set();
  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (!candidate) continue;
    set.add(cleanEmailAddress(candidate, "测试白名单邮箱"));
  }
  return set;
}

export function cleanSingleLineText(value, fieldLabel = "内容", maximum = MAX_SUBJECT_LENGTH) {
  const raw = String(value ?? "").normalize("NFKC");
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) {
    throw new EmailServiceError(`${fieldLabel}不能包含换行或控制字符`, 400, "email_header_injection_rejected");
  }
  const text = raw.replace(/\s+/gu, " ").trim();
  if (!text || [...text].length > maximum) {
    throw new EmailServiceError(`${fieldLabel}长度无效`, 400, "email_content_invalid");
  }
  return text;
}

export function cleanBodyText(value, fieldLabel = "邮件正文", maximum = MAX_BODY_LENGTH) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim();
  if (!text || [...text].length > maximum) {
    throw new EmailServiceError(`${fieldLabel}长度无效`, 400, "email_content_invalid");
  }
  return text;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtmlEnvelope(title, paragraphs, footerNote) {
  const bodyHtml = paragraphs
    .map((line) => `<p style="margin:0 0 12px;color:#1e293b;font-size:14px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join("");
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    '<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">',
    `<h1 style="margin:0 0 16px;font-size:18px;color:#0f172a;">${escapeHtml(title)}</h1>`,
    bodyHtml,
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">`,
    `<p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">${escapeHtml(footerNote)}</p>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}

export function renderTransactionalEmail(options = {}) {
  const kind = String(options.kind || "").trim().toLowerCase();
  if (!ALLOWED_KIND_SET.has(kind)) {
    throw new EmailServiceError("不支持的事务邮件类型", 400, "email_kind_invalid");
  }
  const footer = `此邮件由 Aeris 系统自动发送，请勿直接回复 ${DEFAULT_FROM_EMAIL}；如有问题请回复 ${DEFAULT_REPLY_TO_EMAIL}。`;

  if (kind === "account_security_notice") {
    const summary = cleanBodyText(options.eventSummary || options.summary || "您的 Aeris 账户发生了一次安全操作。", "安全通知摘要", 1000);
    const occurredAt = cleanSingleLineText(options.occurredAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), "发生时间", 40);
    const subject = cleanSingleLineText(options.subject || "[Aeris] 账户安全通知", "邮件主题");
    const lines = [
      summary,
      `操作时间 (UTC): ${occurredAt}`,
      "如非本人操作，请尽快修改登录密钥并联系客服。",
    ];
    return {
      kind,
      subject,
      text: `${lines.join("\n\n")}\n\n${footer}`,
      html: renderHtmlEnvelope("Aeris 账户安全通知", lines, footer),
    };
  }

  if (kind === "order_status_notice") {
    const orderId = cleanSingleLineText(options.orderId || "", "订单编号", 80);
    const statusLabel = cleanSingleLineText(options.statusLabel || "", "订单状态", 60);
    const amountSummary = options.amountSummary
      ? cleanSingleLineText(options.amountSummary, "金额说明", 80)
      : "";
    const subject = cleanSingleLineText(options.subject || `[Aeris] 订单状态更新 (${statusLabel})`, "邮件主题");
    const lines = [
      `订单编号：${orderId}`,
      `当前状态：${statusLabel}`,
      ...(amountSummary ? [`金额说明：${amountSummary}`] : []),
      "您可随时登录 thewyj.uk 查看完整记录。",
    ];
    return {
      kind,
      subject,
      text: `${lines.join("\n\n")}\n\n${footer}`,
      html: renderHtmlEnvelope("Aeris 订单状态通知", lines, footer),
    };
  }

  // owner_ops_test: strict plain-text test delivery verification without arbitrary HTML payloads.
  const note = options.note
    ? cleanBodyText(options.note, "测试备注", 400)
    : "Cloudflare Email Sending 与 Gmail 回复链路测试邮件。";
  const subject = cleanSingleLineText(options.subject || "[Aeris] Cloudflare Email Service 测试邮件", "邮件主题");
  const lines = [
    note,
    `系统发件人: ${DEFAULT_FROM_EMAIL}`,
    `回复承接 (Reply-To): ${DEFAULT_REPLY_TO_EMAIL}`,
  ];
  return {
    kind,
    subject,
    text: `${lines.join("\n\n")}\n\n${footer}`,
    html: renderHtmlEnvelope("Aeris 邮件链路测试", lines, footer),
  };
}

export function buildEmailMessage(options = {}) {
  if (Array.isArray(options.to) || options.cc !== undefined || options.bcc !== undefined) {
    throw new EmailServiceError("仅允许单收件人事务邮件", 400, "email_bulk_recipients_forbidden");
  }
  const fromEmail = options.from ? cleanEmailAddress(options.from, "发件邮箱") : DEFAULT_FROM_EMAIL;
  if (!ALLOWED_SENDER_SET.has(fromEmail)) {
    throw new EmailServiceError("发件邮箱不在允许列表中", 403, "email_sender_forbidden");
  }
  const replyToEmail = options.replyTo ? cleanEmailAddress(options.replyTo, "回复邮箱") : DEFAULT_REPLY_TO_EMAIL;
  if (!ALLOWED_REPLY_TO_SET.has(replyToEmail)) {
    throw new EmailServiceError("Reply-To 地址不在允许列表中", 403, "email_reply_to_forbidden");
  }
  const toEmail = cleanEmailAddress(options.to, "收件邮箱");
  const rendered = renderTransactionalEmail(options);
  return {
    kind: rendered.kind,
    fromEmail,
    toEmail,
    replyToEmail,
    payload: {
      from: { email: fromEmail, name: DEFAULT_FROM_NAME },
      to: [{ email: toEmail }],
      replyTo: { email: replyToEmail, name: DEFAULT_REPLY_TO_NAME },
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    },
  };
}

function classifyProviderError(error, httpStatus = 0) {
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 503, code: "email_credentials_invalid", retryable: false, publicError: "云端邮件发信凭据无效或权限不足" };
  }
  if (httpStatus === 429) {
    return { status: 429, code: "email_rate_limited", retryable: true, publicError: "邮件发送触发频率或每日配额限制，请稍后重试" };
  }
  const message = String(error?.message || error || "").toLowerCase();
  if (/rate|quota|limit|429|too many/.test(message)) {
    return { status: 429, code: "email_rate_limited", retryable: true, publicError: "邮件发送触发频率或每日配额限制，请稍后重试" };
  }
  if (/reject|suppression|bounce|invalid|unverified|domain|sender/.test(message)) {
    return { status: 400, code: "email_rejected", retryable: false, publicError: "收件人或发件域未通过邮件服务校验" };
  }
  return { status: 502, code: "email_delivery_failed", retryable: true, publicError: "云端邮件发送暂时失败，请稍后重试" };
}

export function buildCloudflareRestPayload(built) {
  return {
    from: { address: built.fromEmail, name: DEFAULT_FROM_NAME },
    to: [built.toEmail],
    reply_to: { address: built.replyToEmail, name: DEFAULT_REPLY_TO_NAME },
    subject: built.payload.subject,
    text: built.payload.text,
    html: built.payload.html,
  };
}

async function sendViaCloudflareRest(env, built) {
  const accountId = String(env?.EMAIL_CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(env?.EMAIL_SEND_API_TOKEN || "").trim();
  if (!token || !CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new EmailServiceError("Cloudflare Email Sending 通道尚未就绪", 503, "email_binding_unavailable", true);
  }
  const endpoint = `${CLOUDFLARE_API_BASE}/accounts/${accountId}/email/sending/send`;
  const fetchFn = typeof env?.__EMAIL_FETCH === "function" ? env.__EMAIL_FETCH : fetch;
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildCloudflareRestPayload(built)),
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || body?.success !== true) {
    const firstErr = Array.isArray(body?.errors) && body.errors[0] && typeof body.errors[0] === "object"
      ? body.errors[0]
      : null;
    const firstError = firstErr?.message ? String(firstErr.message) : `http_${response.status}`;
    const providerCode = firstErr?.code !== undefined && firstErr?.code !== null ? String(firstErr.code).slice(0, 40) : "";
    const classified = classifyProviderError(new Error(firstError), response.status);
    const details = {
      delivery_status: "rejected",
      provider_status: response.status,
      ...(providerCode ? { provider_code: providerCode } : {}),
    };
    throw new EmailServiceError(classified.publicError, classified.status, classified.code, classified.retryable, details);
  }
  const result = body?.result || {};
  return {
    messageId: String(result.message_id || result.messageId || result.id || "").slice(0, 160),
    delivered: Array.isArray(result.delivered) ? result.delivered : [],
    queued: Array.isArray(result.queued) ? result.queued : [],
    permanentBounces: Array.isArray(result.permanent_bounces) ? result.permanent_bounces : [],
    suppressedRecipients: Array.isArray(result.suppressed_recipients) ? result.suppressed_recipients : [],
  };
}

export async function sendTransactionalEmail(env, options = {}) {
  if (!emailSendingEnabled(env)) {
    throw new EmailServiceError("云端事务邮件服务尚未启用", 503, "email_sending_disabled", true);
  }
  const transport = resolveEmailTransport(env);
  if (!transport) {
    throw new EmailServiceError("Cloudflare Email Sending 通道尚未就绪", 503, "email_binding_unavailable", true);
  }
  const built = buildEmailMessage(options);
  if (options.enforceTestAllowlist === true) {
    const allowed = parseAllowedTestRecipients(env);
    if (!allowed.has(built.toEmail)) {
      throw new EmailServiceError("目标邮箱不在允许的测试收件白名单内", 403, "email_recipient_not_allowlisted");
    }
  }
  try {
    const result = transport === "binding"
      ? await env.EMAIL.send(built.payload)
      : await sendViaCloudflareRest(env, built);
    const delivered = Array.isArray(result?.delivered) ? result.delivered : [];
    const queued = Array.isArray(result?.queued) ? result.queued : [];
    const permanentBounces = Array.isArray(result?.permanentBounces) ? result.permanentBounces : [];
    const suppressedRecipients = Array.isArray(result?.suppressedRecipients) ? result.suppressedRecipients : [];
    if (permanentBounces.length > 0 || suppressedRecipients.length > 0) {
      throw new EmailServiceError("收件人处于永久退信或抑制列表，无法投递", 400, "email_rejected", false, {
        delivery_status: "rejected",
        permanent_bounces: permanentBounces,
        suppressed_recipients: suppressedRecipients,
      });
    }
    const deliveryStatus = delivered.length > 0
      ? "delivered"
      : (queued.length > 0 ? "queued" : "accepted");
    const messageId = String(result?.messageId || result?.message_id || result?.id || "").slice(0, 160);
    const sentAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    console.info(JSON.stringify({
      event: "aeris_email_sent",
      request_id: String(options.requestId || ""),
      transport,
      kind: built.kind,
      from: built.fromEmail,
      reply_to: built.replyToEmail,
      recipient_domain: built.toEmail.split("@")[1] || "",
      delivery_status: deliveryStatus,
      message_id: messageId,
    }));
    return {
      ok: true,
      transport,
      delivery_status: deliveryStatus,
      delivered,
      queued,
      permanent_bounces: permanentBounces,
      suppressed_recipients: suppressedRecipients,
      message_id: messageId,
      from: built.fromEmail,
      reply_to: built.replyToEmail,
      kind: built.kind,
      recipient: built.toEmail,
      sent_at: sentAt,
    };
  } catch (error) {
    if (error instanceof EmailServiceError) {
      console.error(JSON.stringify({
        event: "aeris_email_failed",
        request_id: String(options.requestId || ""),
        transport,
        kind: built.kind,
        code: error.code,
        status: error.status,
        ...(error.details?.provider_code ? { provider_code: error.details.provider_code } : {}),
        ...(error.details?.provider_status ? { provider_status: error.details.provider_status } : {}),
      }));
      throw error;
    }
    const classified = classifyProviderError(error);
    console.error(JSON.stringify({
      event: "aeris_email_failed",
      request_id: String(options.requestId || ""),
      transport,
      kind: built.kind,
      code: classified.code,
      status: classified.status,
      error_name: String(error?.name || "Error"),
    }));
    throw new EmailServiceError(classified.publicError, classified.status, classified.code, classified.retryable);
  }
}

export async function sendAccountSecurityNotice(env, { to, eventSummary, occurredAt, subject, requestId } = {}) {
  return await sendTransactionalEmail(env, {
    kind: "account_security_notice",
    to,
    eventSummary,
    occurredAt,
    subject,
    requestId,
  });
}

export async function sendOrderStatusNotice(env, { to, orderId, statusLabel, amountSummary, subject, requestId } = {}) {
  return await sendTransactionalEmail(env, {
    kind: "order_status_notice",
    to,
    orderId,
    statusLabel,
    amountSummary,
    subject,
    requestId,
  });
}
