import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import {
  ALLOWED_REPLY_TO_ADDRESSES,
  ALLOWED_SENDER_ADDRESSES,
  ALLOWED_TRANSACTIONAL_KINDS,
  DEFAULT_REPLY_TO_EMAIL,
  EMAIL_BUILD,
  EmailServiceError,
  emailBindingConfigured,
  emailSendingEnabled,
  parseAllowedTestRecipients,
  sendTransactionalEmail,
} from "./email-service.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";

const ROUTES = new Map([
  ["GET /api/admin/email/status", { body: 0, limit: 30, window: 60 }],
  ["POST /api/admin/email/test-send", { body: 2 * 1024, limit: 5, window: 300 }],
]);

const METHODS_BY_PATH = new Map();
for (const key of ROUTES.keys()) {
  const splitAt = key.indexOf(" ");
  const method = key.slice(0, splitAt);
  const path = key.slice(splitAt + 1);
  if (!METHODS_BY_PATH.has(path)) METHODS_BY_PATH.set(path, new Set());
  METHODS_BY_PATH.get(path).add(method);
}

const TEST_SEND_FIELDS = new Set(["recipient", "kind", "note"]);

function requestId(context) {
  return context.data?.requestId || "";
}

function response(payload, status, context, headers = {}) {
  return jsonResponse(payload, status, requestId(context), { "Cache-Control": "private, no-store", ...headers });
}

async function readJson(request, maximumBytes) {
  if (!maximumBytes) return {};
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new EmailServiceError("请求内容过大", 413, "request_too_large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maximumBytes) throw new EmailServiceError("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    if (Object.keys(payload).some((key) => !TEST_SEND_FIELDS.has(key))) {
      throw new EmailServiceError("请求包含不允许的字段", 400, "email_fields_forbidden");
    }
    return payload;
  } catch (error) {
    if (error instanceof EmailServiceError) throw error;
    throw new EmailServiceError("请求 JSON 格式无效", 400, "invalid_json");
  }
}

function authenticationError(result, context) {
  const code = String(result.code || (result.status === 401 ? "authentication_required" : "account_unavailable"));
  return apiError(
    code,
    result.status === 401 ? "登录会话无效，请重新登录" : "账户不可用",
    result.status || 403,
    requestId(context),
  );
}

export async function handleEmailRequest(context) {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  const descriptor = ROUTES.get(`${method} ${url.pathname}`);
  if (!descriptor) {
    const allowed = METHODS_BY_PATH.get(url.pathname);
    if (!allowed) return null;
    return apiError("method_not_allowed", "此接口不支持当前请求方法", 405, requestId(context), {
      headers: { Allow: [...allowed].join(", ") },
    });
  }

  const flags = featureFlags(context.env);
  try {
    if (!flags.task12CloudAccounts) {
      throw new EmailServiceError("云端账户服务尚未启用", 503, "email_dependency_unavailable", true);
    }
    const auth = await resolveTask12Account(context);
    if (!auth.authenticated) return authenticationError(auth, context);
    if (!auth.account?.is_super_admin) {
      throw new EmailServiceError("只有站点所有者可以访问邮件管理接口", 403, "owner_required");
    }

    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: auth.account.id,
    });
    if (!rate.allowed) {
      return apiError("email_rate_limited", "邮件接口请求过于频繁，请稍后重试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || descriptor.window) },
      });
    }

    if (method === "GET") {
      const testAllowlist = parseAllowedTestRecipients(context.env);
      return response({
        ok: true,
        enabled: emailSendingEnabled(context.env),
        binding_configured: emailBindingConfigured(context.env),
        allowed_senders: ALLOWED_SENDER_ADDRESSES,
        allowed_reply_to: ALLOWED_REPLY_TO_ADDRESSES,
        default_reply_to: DEFAULT_REPLY_TO_EMAIL,
        allowed_kinds: ALLOWED_TRANSACTIONAL_KINDS,
        test_recipient_count: testAllowlist.size,
        build: EMAIL_BUILD,
      }, 200, context);
    }

    const payload = await readJson(context.request, descriptor.body);
    const kind = String(payload.kind || "owner_ops_test").trim().toLowerCase();
    if (kind !== "owner_ops_test") {
      throw new EmailServiceError("管理测试接口仅允许 owner_ops_test 类型", 400, "email_test_kind_forbidden");
    }
    const sent = await sendTransactionalEmail(context.env, {
      kind,
      to: payload.recipient,
      note: payload.note,
      enforceTestAllowlist: true,
      requestId: requestId(context),
    });
    return response({ ...sent, build: EMAIL_BUILD }, 200, context);
  } catch (error) {
    if (error instanceof EmailServiceError) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    if (error?.name === "Task12Error") {
      return apiError(error.code || "task12_unavailable", error.message, error.status || 503, requestId(context), {
        retryable: Boolean(error.retryable),
      });
    }
    console.error(JSON.stringify({
      event: "email_api_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    const classification = classifyCloudError(error);
    return apiError(`email_${classification}`, "云端邮件服务暂时不可用", 503, requestId(context), { retryable: true });
  }
}

export const __testing = Object.freeze({
  METHODS_BY_PATH,
  ROUTES,
});
