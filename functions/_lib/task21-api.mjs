import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { enrichAccountWithTask13 } from "./task13-service.mjs";
import {
  TASK21_BUILD,
  TASK21_SCHEMA_VERSION,
  Task21Error,
} from "./task21-model.mjs";
import {
  confirmNotificationCandidate,
  deleteNotificationEvent,
  ensureTask21Schema,
  ingestNotificationEvents,
  listNotificationCandidates,
  listNotificationEvents,
  rejectNotificationCandidate,
  requireNotificationAccess,
  requireFinanceRecognitionAccess,
} from "./task21-service.mjs";
import {
  confirmNotificationHint,
  ignoreNotificationHint,
  listNotificationHints,
  upsertNotificationHints,
} from "./task21-hints.mjs";

const ROUTES = new Map([
  ["POST /api/notification/ingest", { mode: "write", body: 256 * 1024, limit: 60, window: 60 }],
  ["GET /api/notification/events", { mode: "read", body: 0, limit: 120, window: 60 }],
  ["GET /api/notification/candidates", { mode: "read", body: 0, limit: 120, window: 60 }],
  ["POST /api/notification/candidates/confirm", { mode: "write", body: 16 * 1024, limit: 30, window: 60 }],
  ["POST /api/notification/candidates/reject", { mode: "write", body: 16 * 1024, limit: 30, window: 60 }],
  ["POST /api/notification/events/delete", { mode: "write", body: 16 * 1024, limit: 60, window: 60 }],
  ["POST /api/notification/hints", { mode: "write", body: 64 * 1024, limit: 60, window: 60 }],
  ["GET /api/notification/hints", { mode: "read", body: 0, limit: 120, window: 60 }],
  ["POST /api/notification/hints/confirm", { mode: "write", body: 16 * 1024, limit: 30, window: 60 }],
  ["POST /api/notification/hints/ignore", { mode: "write", body: 16 * 1024, limit: 30, window: 60 }],
]);

const METHODS_BY_PATH = new Map();
const FINANCE_RECOGNITION_PATHS = new Set([
  "/api/notification/ingest",
  "/api/notification/candidates",
  "/api/notification/candidates/confirm",
  "/api/notification/candidates/reject",
  "/api/notification/hints",
  "/api/notification/hints/confirm",
  "/api/notification/hints/ignore",
]);
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
  return jsonResponse(payload, status, requestId(context), headers);
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task21Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task21Error("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(body) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch (_) {
    throw new Task21Error("请求 JSON 格式无效", 400, "invalid_json");
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

function featureEnabled(descriptor, flags) {
  return descriptor.mode === "read" ? flags.task21NotificationReads : flags.task21NotificationWrites;
}

async function execute(context, path, account) {
  const db = context.env.WYJ_DB;
  const url = new URL(context.request.url);
  if (context.request.method.toUpperCase() === "GET") {
    if (path === "/api/notification/events") {
      return response({
        ok: true,
        ...await listNotificationEvents(db, account, {
          before: url.searchParams.get("before") || "",
          before_id: url.searchParams.get("before_id") || "",
          limit: url.searchParams.get("limit") || "",
          include_deleted: url.searchParams.get("include_deleted") || "",
        }),
        build: TASK21_BUILD,
      }, 200, context);
    }
    if (path === "/api/notification/candidates") {
      return response({
        ok: true,
        ...await listNotificationCandidates(db, account, {
          status: url.searchParams.get("status") || "",
          limit: url.searchParams.get("limit") || "",
        }),
        build: TASK21_BUILD,
      }, 200, context);
    }
    if (path === "/api/notification/hints") {
      // Same pending source of truth for Android and Web /finance.
      // An explicit empty `state=` means "every state": the Android pull needs
      // confirmed/ignored hints to close local pending items (real device:
      // ¥104.49 stayed pending after a Web confirm because `'' || "pending"`
      // silently returned the pending default).
      const stateParam = url.searchParams.has("state")
        ? url.searchParams.get("state")
        : "pending";
      return response({
        ok: true,
        ...await listNotificationHints(db, account, {
          state: stateParam ?? "",
          limit: url.searchParams.get("limit") || "",
        }),
        build: TASK21_BUILD,
      }, 200, context);
    }
  }

  const payload = await readJson(context.request, ROUTES.get(`${context.request.method.toUpperCase()} ${path}`).body);
  if (path === "/api/notification/ingest") {
    return response({ ok: true, ...await ingestNotificationEvents(db, account, payload), build: TASK21_BUILD }, 200, context);
  }
  if (path === "/api/notification/candidates/confirm") {
    return response({
      ok: true,
      ...await confirmNotificationCandidate(db, account, payload),
      build: TASK21_BUILD,
    }, 200, context);
  }
  if (path === "/api/notification/candidates/reject") {
    return response({
      ok: true,
      ...await rejectNotificationCandidate(db, account, payload),
      build: TASK21_BUILD,
    }, 200, context);
  }
  if (path === "/api/notification/hints") {
    return response({ ok: true, ...await upsertNotificationHints(db, account, payload), build: TASK21_BUILD }, 200, context);
  }
  if (path === "/api/notification/hints/confirm") {
    return response({ ok: true, ...await confirmNotificationHint(db, account, payload), build: TASK21_BUILD }, 200, context);
  }
  if (path === "/api/notification/hints/ignore") {
    return response({ ok: true, ...await ignoreNotificationHint(db, account, payload), build: TASK21_BUILD }, 200, context);
  }
  if (path === "/api/notification/events/delete") {
    return response({
      ok: true,
      ...await deleteNotificationEvent(db, account, payload.event_id || ""),
      build: TASK21_BUILD,
    }, 200, context);
  }
  throw new Task21Error("通知归档接口不存在", 404, "task21_route_not_found");
}

export async function handleTask21Request(context) {
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
  if (!featureEnabled(descriptor, flags)) {
    return apiError("task21_notification_not_enabled", "通知归档功能尚未启用", 503, requestId(context), { retryable: true });
  }
  try {
    if (!flags.task12CloudAccounts || !flags.task13CloudReads) {
      throw new Task21Error("云端账户或会员服务尚未启用", 503, "task21_dependency_unavailable", true);
    }
    if (!await ensureTask21Schema(context.env.WYJ_DB)) {
      throw new Task21Error("通知归档数据结构尚未就绪", 503, "task21_schema_not_ready", true);
    }
    const authenticated = await resolveTask12Account(context);
    if (!authenticated.authenticated) return authenticationError(authenticated, context);
    const account = await enrichAccountWithTask13(context.env.WYJ_DB, authenticated.account);
    // Route level entitlement split: payment recognition belongs to
    // finance_access, browsing the notification archive needs
    // notification_archive_access.
    if (FINANCE_RECOGNITION_PATHS.has(url.pathname)) requireFinanceRecognitionAccess(account);
    else requireNotificationAccess(account);
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account.id,
    });
    if (!rate.allowed) {
      return apiError("notification_rate_limited", "通知归档请求过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || descriptor.window) },
      });
    }
    return await execute(context, url.pathname, account);
  } catch (error) {
    if (error instanceof Task21Error) {
      return apiError(error.code, error.message, error.status, requestId(context), {
        retryable: error.retryable,
        details: error.details ? { details: error.details } : undefined,
      });
    }
    console.error(JSON.stringify({
      event: "task21_notification_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
      error_message: String(error?.message || "").slice(0, 200),
    }));
    const classification = classifyCloudError(error);
    return apiError(`task21_${classification}`, "通知归档服务暂时不可用，请稍后重试", 503, requestId(context), { retryable: true });
  }
}

export const __testing = Object.freeze({
  METHODS_BY_PATH,
  ROUTES,
  featureEnabled,
  readJson,
});
