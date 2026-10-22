import {projectSourceUnits} from './finance-source-units.mjs';
import { moneyCapability, requireMoneyCapability } from './finance-client-capability.mjs';
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
  normalizeNotificationEvent,
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
  notificationPendingSummary,
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
  ["GET /api/notification/pending-summary", { mode: "read", body: 0, limit: 120, window: 60 }],
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
  "/api/notification/pending-summary",
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

function moneyCapable(context) {
  return moneyCapability(context) >= 2;
}
function containsJpy(value) {
  if (!value || typeof value !== 'object') return false;
  return value.currency === 'JPY' || Object.values(value).some(containsJpy);
}
function response(payload, status, context, headers = {}) {
  if (context.request.method === 'GET') requireMoneyCapability(context,payload,Task21Error);
  if (context.request.method === 'GET' && containsJpy(payload) && !moneyCapable(context))
    throw new Task21Error('请升级客户端后读取日元金额',409,'currency_client_upgrade_required');
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
    if (path === "/api/notification/pending-summary") {
      return response({
        ok: true,
        ...await notificationPendingSummary(db, account, { event_ids: url.searchParams.get("event_ids") || "" }),
        build: TASK21_BUILD,
      }, 200, context);
    }
  }

  const payload = await readJson(context.request, ROUTES.get(`${context.request.method.toUpperCase()} ${path}`).body);
  requireMoneyCapability(context,payload,Task21Error);
  if (path === '/api/notification/ingest' && !moneyCapable(context)) {
    for (const operation of Array.isArray(payload.operations) ? payload.operations : []) {
      const receipt = typeof operation?.operation_id === 'string' ? await db.prepare('SELECT operation_id FROM task21_notification_sync_operations WHERE user_id=?1 AND operation_id=?2').bind(account.id,operation.operation_id).first() : null;
      if (receipt) continue;
      const event = normalizeNotificationEvent(operation?.payload,{legacyUnitless:true});
      if (['parsed','candidate'].includes(event.parse_status))
        throw new Task21Error('请升级客户端后提交新识别的币种信息',409,'currency_client_upgrade_required');
    }
  }
  if (containsJpy(payload) && !moneyCapable(context))
    throw new Task21Error('日元采集需要新版金额协议',409,'currency_client_upgrade_required');
  if (moneyCapability(context) < 3 && ['/api/notification/candidates/confirm','/api/notification/hints/confirm'].includes(path)) {
    const candidate = path.includes('/candidates/');
    const id = candidate ? payload.candidate_id : payload.hint_id;
    if (typeof id === 'string') {
      const table = candidate ? 'task21_notification_candidates' : 'task21_notification_pending_hints';
      // The source event owns a candidate's immutable currency decision. Legacy
      // confirm bodies may omit it. SELECT * also works before the new columns.
      const row = await db.prepare(`SELECT * FROM ${table} WHERE user_id=?1 AND id=?2`).bind(account.id,id).first();
      if (row) requireMoneyCapability(context,row,Task21Error);
      if (candidate && row?.event_id) {
        const event = await db.prepare('SELECT * FROM task21_notification_events WHERE user_id=?1 AND event_id=?2').bind(account.id,row.event_id).first();
        if (event) requireMoneyCapability(context,event,Task21Error);
      }
    }
  }
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
    const result = await execute(context, url.pathname, account);
    if (result.status === 200) {
      const payload = await result.json();
      await projectSourceUnits(context.env.WYJ_DB,account.id,payload);
      return jsonResponse(payload,200,requestId(context));
    }
    return result;
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
