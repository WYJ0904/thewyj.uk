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
  importLegacyFinance,
  rollbackTask16Import,
  task16ImportCounts,
  task16ImportStatus,
} from "./task16-import.mjs";
import {
  TASK16_BUILD,
  TASK16_SCHEMA_VERSION,
  Task16Error,
  requireAllowedFields,
} from "./task16-model.mjs";
import {
  ensureTask16Schema,
  financeBootstrap,
  financeChanges,
  listFinanceTransactions,
  mergeFinanceTransactions,
  requireFinanceAccess,
  splitFinanceTransaction,
  syncFinance,
} from "./task16-service.mjs";

const ROUTES = new Map([
  ["GET /api/finance/bootstrap", { mode: "read", body: 0, limit: 120, window: 60 }],
  ["GET /api/finance/changes", { mode: "read", body: 0, limit: 180, window: 60 }],
  ["GET /api/finance/transactions", { mode: "read", body: 0, limit: 120, window: 60 }],
  ["POST /api/finance/sync", { mode: "write", body: 512 * 1024, limit: 90, window: 60 }],
  ["POST /api/finance/reconcile/merge", { mode: "write", body: 16 * 1024, limit: 30, window: 60 }],
  ["POST /api/finance/reconcile/split", { mode: "write", body: 16 * 1024, limit: 30, window: 60 }],
  ["POST /api/admin/task16/import", { mode: "import", body: 512 * 1024, limit: 10, window: 60, admin: true }],
  ["POST /api/admin/task16/import/rollback", { mode: "import", body: 4 * 1024, limit: 5, window: 60, admin: true }],
  ["GET /api/admin/task16/import/status", { mode: "import", body: 0, limit: 30, window: 60, admin: true }],
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
  return jsonResponse(payload, status, requestId(context), headers);
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task16Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task16Error("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(body) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch (_) {
    throw new Task16Error("请求 JSON 格式无效", 400, "invalid_json");
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
  if (descriptor.mode === "read") return flags.task16CloudReads;
  if (descriptor.mode === "write") return flags.task16CloudWrites;
  return flags.task16Import;
}

function productionImportAllowed(context, flags) {
  if (String(context.env?.WYJ_ENVIRONMENT || "").toLowerCase() !== "production") return true;
  return flags.task16ProductionImport
    && context.request.headers.get("X-WYJ-Task16-Production-Confirm") === "TASK16-PRODUCTION-FINANCE-MIGRATION";
}

async function execute(context, path, account) {
  const db = context.env.WYJ_DB;
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  if (method === "GET") {
    if (path === "/api/finance/bootstrap") {
      return response({ ok: true, ...await financeBootstrap(db, account), build: TASK16_BUILD }, 200, context);
    }
    if (path === "/api/finance/changes") {
      return response({
        ok: true,
        ...await financeChanges(db, account, url.searchParams.get("since") || 0, url.searchParams.get("limit") || 0),
        build: TASK16_BUILD,
      }, 200, context);
    }
    if (path === "/api/finance/transactions") {
      return response({
        ok: true,
        ...await listFinanceTransactions(db, account, {
          before: url.searchParams.get("before") || "",
          before_id: url.searchParams.get("before_id") || "",
          limit: url.searchParams.get("limit") || "",
          include_deleted: url.searchParams.get("include_deleted") || "",
        }),
        build: TASK16_BUILD,
      }, 200, context);
    }
    if (path === "/api/admin/task16/import/status") {
      const sourceKey = url.searchParams.get("source_key") || "";
      return response({
        ok: true,
        schema_version: Number(TASK16_SCHEMA_VERSION),
        counts: await task16ImportCounts(db),
        imports: await task16ImportStatus(db, sourceKey),
        build: TASK16_BUILD,
      }, 200, context);
    }
  }

  const payload = await readJson(context.request, ROUTES.get(`${method} ${path}`).body);
  if (path === "/api/finance/sync") {
    return response({ ok: true, ...await syncFinance(db, account, payload), build: TASK16_BUILD }, 200, context);
  }
  if (path === "/api/finance/reconcile/merge") {
    return response({ ok: true, ...await mergeFinanceTransactions(db, account, payload), build: TASK16_BUILD }, 200, context);
  }
  if (path === "/api/finance/reconcile/split") {
    return response({ ok: true, ...await splitFinanceTransaction(db, account, payload), build: TASK16_BUILD }, 200, context);
  }
  if (path === "/api/admin/task16/import") {
    return response({ ok: true, ...await importLegacyFinance(db, payload), build: TASK16_BUILD }, 200, context);
  }
  if (path === "/api/admin/task16/import/rollback") {
    requireAllowedFields(payload, new Set(["source_key"]));
    return response({ ok: true, rollback: await rollbackTask16Import(db, payload), build: TASK16_BUILD }, 200, context);
  }
  throw new Task16Error("财务接口不存在", 404, "task16_route_not_found");
}

export async function handleTask16Request(context) {
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
    return apiError("task16_cloud_not_enabled", "云端财务功能尚未启用", 503, requestId(context), { retryable: true });
  }
  if (descriptor.mode === "import" && !productionImportAllowed(context, flags)) {
    return apiError(
      "task16_production_import_confirmation_required",
      "Production 财务迁移需要单独启用并明确确认",
      403,
      requestId(context),
    );
  }
  try {
    if (!flags.task12CloudAccounts || !flags.task13CloudReads) {
      throw new Task16Error("云端账户或会员服务尚未启用", 503, "task16_dependency_unavailable", true);
    }
    if (!await ensureTask16Schema(context.env.WYJ_DB)) {
      throw new Task16Error("云端财务数据结构尚未就绪", 503, "task16_schema_not_ready", true);
    }
    const authenticated = await resolveTask12Account(context);
    if (!authenticated.authenticated) return authenticationError(authenticated, context);
    const account = await enrichAccountWithTask13(context.env.WYJ_DB, authenticated.account);
    if (descriptor.admin) {
      if (!account.is_super_admin) throw new Task16Error("无管理员权限", 403, "forbidden");
    } else {
      requireFinanceAccess(account);
    }
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account.id,
    });
    if (!rate.allowed) {
      return apiError("finance_rate_limited", "财务请求过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || descriptor.window) },
      });
    }
    return await execute(context, url.pathname, account);
  } catch (error) {
    if (error instanceof Task16Error) {
      return apiError(error.code, error.message, error.status, requestId(context), {
        retryable: error.retryable,
        details: error.details ? { details: error.details } : undefined,
      });
    }
    console.error(JSON.stringify({
      event: "task16_cloud_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    const classification = classifyCloudError(error);
    return apiError(`task16_${classification}`, "云端财务服务暂时不可用，请稍后重试", 503, requestId(context), { retryable: true });
  }
}

export const __testing = Object.freeze({
  METHODS_BY_PATH,
  ROUTES,
  featureEnabled,
  productionImportAllowed,
  readJson,
});
