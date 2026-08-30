import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import {
  TASK18_BUILD,
  Task18Error,
  requireAllowedFields,
} from "./task18-model.mjs";
import {
  createAdminMessage,
  ensureTask18Schema,
  listAdminActionAudit,
  listAdminMessages,
  listAdminRoles,
  listPendingMessages,
  recordAdminAction,
  revokeAdminMessage,
  setAdminRole,
  task18Readiness,
  updateMessageReceipt,
} from "./task18-service.mjs";

const ROUTES = new Map([
  ["GET /api/messages/pending", { auth: "user", body: 0, limit: 60, window: 60 }],
  ["POST /api/messages/receipt", { auth: "user", body: 2 * 1024, limit: 120, window: 60 }],
  ["GET /api/admin/messages", { auth: "admin", body: 0, limit: 60, window: 60 }],
  ["POST /api/admin/messages", { auth: "admin", body: 8 * 1024, limit: 10, window: 60 }],
  ["POST /api/admin/messages/revoke", { auth: "admin", body: 2 * 1024, limit: 30, window: 60 }],
  ["GET /api/admin/action-audit", { auth: "admin", body: 0, limit: 60, window: 60 }],
  ["GET /api/admin/roles", { auth: "owner", body: 0, limit: 60, window: 60 }],
  ["POST /api/admin/roles", { auth: "owner", body: 2 * 1024, limit: 30, window: 60 }],
  ["GET /api/admin/task18/status", { auth: "owner", body: 0, limit: 30, window: 60 }],
]);

const METHODS_BY_PATH = new Map();
for (const key of ROUTES.keys()) {
  const splitAt = key.indexOf(" ");
  const method = key.slice(0, splitAt);
  const path = key.slice(splitAt + 1);
  if (!METHODS_BY_PATH.has(path)) METHODS_BY_PATH.set(path, new Set());
  METHODS_BY_PATH.get(path).add(method);
}

function requestId(context) {
  return context.data?.requestId || "";
}

function response(payload, status, context, headers = {}) {
  return jsonResponse(payload, status, requestId(context), { "Cache-Control": "private, no-store", ...headers });
}

async function readJson(request, maximumBytes) {
  if (!maximumBytes) return {};
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task18Error("请求内容过大", 413, "request_too_large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maximumBytes) throw new Task18Error("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch (_) {
    throw new Task18Error("请求 JSON 格式无效", 400, "invalid_json");
  }
}

function authenticationError(result, context) {
  const code = String(result.code || (result.status === 401 ? "canonical_session_invalid" : "account_unavailable"));
  return apiError(
    code,
    result.status === 401 ? "登录会话无效，请重新登录" : "账户不可用",
    result.status || 403,
    requestId(context),
  );
}

async function authenticate(context, requirement) {
  const result = await resolveTask12Account(context);
  if (!result.authenticated) return authenticationError(result, context);
  return result.account;
}

function auditAction(path) {
  return new Map([
    ["/api/admin/roles", "admin_role_change"],
    ["/api/admin/messages", "message_send"],
    ["/api/admin/messages/revoke", "message_revoke"],
  ]).get(path) || "admin_action";
}

function auditTarget(path, payload) {
  if (path === "/api/admin/roles") {
    return { targetType: "admin_role", targetId: payload.user_id, targetLabel: payload.role };
  }
  if (path === "/api/admin/messages/revoke") {
    return { targetType: "admin_message", targetId: payload.message_id };
  }
  if (path === "/api/admin/messages") {
    return { targetType: "admin_message", targetLabel: payload.target_scope };
  }
  return {};
}

async function execute(context, path, account, payload) {
  const db = context.env.WYJ_DB;
  const method = context.request.method.toUpperCase();
  if (method === "GET") {
    if (path === "/api/messages/pending") {
      return response({ ok: true, messages: await listPendingMessages(db, account), build: TASK18_BUILD }, 200, context);
    }
    if (path === "/api/admin/messages") {
      return response({ ok: true, messages: await listAdminMessages(db, account), build: TASK18_BUILD }, 200, context);
    }
    if (path === "/api/admin/action-audit") {
      return response({ ok: true, logs: await listAdminActionAudit(db, account), build: TASK18_BUILD }, 200, context);
    }
    if (path === "/api/admin/roles") {
      return response({ ok: true, ...await listAdminRoles(db, account), build: TASK18_BUILD }, 200, context);
    }
    if (path === "/api/admin/task18/status") {
      return response({ ok: true, schema_version: "1", counts: await task18Readiness(db), build: TASK18_BUILD }, 200, context);
    }
  }
  if (path === "/api/messages/receipt") {
    requireAllowedFields(payload, new Set(["message_id", "action"]));
    return response({ ok: true, receipt: await updateMessageReceipt(db, account, payload.message_id, payload.action) }, 200, context);
  }
  if (path === "/api/admin/roles") {
    requireAllowedFields(payload, new Set(["user_id", "role", "note"]));
    return response({ ok: true, ...await setAdminRole(db, account, payload, requestId(context)) }, 200, context);
  }
  if (path === "/api/admin/messages") {
    requireAllowedFields(payload, new Set([
      "title", "body", "message_type", "target_scope", "target_user_ids",
      "expires_at", "requires_confirmation", "idempotency_key", "confirm_bulk_send",
    ]));
    const result = await createAdminMessage(db, account, payload, requestId(context));
    return response({ ok: true, ...result }, result.created ? 201 : 200, context);
  }
  if (path === "/api/admin/messages/revoke") {
    requireAllowedFields(payload, new Set(["message_id"]));
    return response({ ok: true, ...await revokeAdminMessage(db, account, payload.message_id, requestId(context)) }, 200, context);
  }
  throw new Task18Error("管理员与站内消息接口不存在", 404, "task18_route_not_found");
}

export async function handleTask18Request(context) {
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
  if (!flags.task18AdminMessages) {
    return apiError("task18_disabled", "管理员权限与站内消息功能尚未启用", 503, requestId(context), { retryable: true });
  }
  let account = null;
  let payload = {};
  try {
    if (!flags.task12CloudAccounts) {
      throw new Task18Error("云端账户服务尚未启用", 503, "task18_dependency_unavailable", true);
    }
    if (!await ensureTask18Schema(context.env.WYJ_DB)) {
      throw new Task18Error("管理员与站内消息数据结构尚未就绪", 503, "task18_schema_not_ready", true);
    }
    account = await authenticate(context, descriptor.auth);
    if (account instanceof Response) return account;
    if (descriptor.auth === "owner" && !account.is_super_admin) {
      throw new Task18Error("只有站点所有者可以执行此操作", 403, "owner_required");
    }
    if (descriptor.auth === "admin" && !account.is_admin) {
      throw new Task18Error("无管理员权限", 403, "forbidden");
    }
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account.id,
    });
    if (!rate.allowed) {
      return apiError("task18_rate_limited", "操作过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || descriptor.window) },
      });
    }
    payload = method === "POST" ? await readJson(context.request, descriptor.body) : {};
    return await execute(context, url.pathname, account, payload);
  } catch (error) {
    if (account?.is_admin && url.pathname.startsWith("/api/admin/") && method !== "GET") {
      const target = auditTarget(url.pathname, payload);
      await recordAdminAction(context.env.WYJ_DB, account, {
        ...target,
        action: auditAction(url.pathname),
        success: false,
        errorCode: String(error?.code || "task18_operation_failed"),
        after: { status: Number(error?.status || 500) },
        requestId: requestId(context),
      }).catch(() => undefined);
    }
    if (error instanceof Task18Error) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    console.error(JSON.stringify({
      event: "task18_cloud_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    const classification = classifyCloudError(error);
    return apiError(`task18_${classification}`, "管理员与站内消息服务暂时不可用", 503, requestId(context), { retryable: true });
  }
}

export const __testing = Object.freeze({
  METHODS_BY_PATH,
  ROUTES,
  auditAction,
  auditTarget,
  readJson,
});
