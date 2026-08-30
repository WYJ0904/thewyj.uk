import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { Task12Error } from "./task12-model.mjs";
import { Task11Error } from "./task11-model.mjs";
import { importTask11Batch, task11ImportCounts } from "./task11-import.mjs";
import {
  createFeedback,
  ensureTask11Schema,
  listAdminFeedback,
  listChangelog,
  listFeatureVotes,
  listOwnFeedback,
  listTelemetry,
  recordTelemetry,
  setFeatureVote,
  syncLearningData,
  updateAdminFeedback,
} from "./task11-service.mjs";

const ROUTES = new Map([
  ["GET /api/changelog", { mode: "read", auth: "public", legacy: false, limit: 120, window: 60 }],
  ["HEAD /api/changelog", { mode: "read", auth: "public", legacy: false, limit: 120, window: 60 }],
  ["POST /api/feedback", { mode: "write", auth: "user", limit: 5, window: 600, body: 32 * 1024 }],
  ["GET /api/feedback/mine", { mode: "read", auth: "user", limit: 120, window: 60 }],
  ["GET /api/feedback/voting", { mode: "read", auth: "user", limit: 120, window: 60 }],
  ["POST /api/feedback/vote", { mode: "write", auth: "user", limit: 30, window: 60, body: 4 * 1024 }],
  ["GET /api/admin/feedback", { mode: "read", auth: "admin", limit: 120, window: 60 }],
  ["POST /api/admin/feedback/update", { mode: "write", auth: "admin", limit: 120, window: 60, body: 16 * 1024 }],
  ["POST /api/learning/sync", { mode: "write", auth: "user", limit: 30, window: 60, body: 440 * 1024 }],
  ["POST /api/telemetry", { mode: "write", auth: "public", legacy: false, limit: 60, window: 60, body: 2 * 1024 }],
  ["GET /api/admin/task11/telemetry", { mode: "read", auth: "admin", legacy: false, limit: 120, window: 60 }],
  ["POST /api/admin/task11/import", { mode: "write", auth: "owner", legacy: false, limit: 10, window: 60, body: 512 * 1024, import: true }],
  ["GET /api/admin/task11/import/status", { mode: "write", auth: "owner", legacy: false, limit: 30, window: 60, import: true }],
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

function noStoreJson(payload, status, context, headers = {}) {
  return jsonResponse(payload, status, requestId(context), headers);
}

function publicChangelogResponse(payload, context) {
  const body = requestId(context) && !payload.request_id
    ? { ...payload, request_id: requestId(context) }
    : payload;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) {
    throw new Task11Error("请求内容过大。", 413, "request_too_large");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maximumBytes) {
    throw new Task11Error("请求内容过大。", 413, "request_too_large");
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch (_) {
    throw new Task11Error("请求 JSON 格式无效。", 400, "invalid_json");
  }
}

function authenticationError(result, context) {
  return apiError(
    String(result.code || (result.status === 401 ? "canonical_session_invalid" : "account_unavailable")),
    result.status === 401 ? "登录会话无效，请重新登录" : "账户不可用",
    result.status || 403,
    requestId(context),
  );
}

async function authenticate(context, requirement, flags) {
  if (requirement === "public") return null;
  if (!flags.task12CloudAccounts) {
    throw new Task11Error("云端账户服务当前未启用", 503, "cloud_accounts_disabled", true);
  }
  try {
    const result = await resolveTask12Account(context);
    if (!result.authenticated) return authenticationError(result, context);
    if (requirement === "owner" && !result.account.is_super_admin) {
      return apiError("owner_required", "只有站点所有者可以执行此操作", 403, requestId(context));
    }
    if (requirement === "admin" && !result.account.is_admin) {
      return apiError("forbidden", "无管理员权限", 403, requestId(context));
    }
    return result.account;
  } catch (error) {
    if (error instanceof Task12Error) {
      throw new Task11Error(error.message, error.status, error.code, error.retryable);
    }
    throw error;
  }
}

function rateLimitError(path, rate, context) {
  const isSync = path === "/api/learning/sync";
  const isTelemetry = path.includes("telemetry");
  const code = isSync
    ? "learning_sync_rate_limited"
    : isTelemetry
      ? "telemetry_rate_limited"
      : "feedback_rate_limited";
  const message = isSync
    ? "学习数据同步过于频繁，请稍后再试"
    : isTelemetry
      ? "统计请求过于频繁，请稍后再试"
      : "反馈操作过于频繁，请稍后再试";
  return apiError(code, message, 429, requestId(context), {
    retryable: true,
    headers: { "Retry-After": String(rate.retryAfter || 60) },
  });
}

async function executeRoute(context, descriptor, account) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const method = context.request.method.toUpperCase();
  const db = context.env.WYJ_DB;
  if (method === "GET" || method === "HEAD") {
    if (path === "/api/changelog") {
      const response = publicChangelogResponse({ ok: true, entries: await listChangelog(db) }, context);
      return method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (path === "/api/feedback/mine") {
      return noStoreJson({ ok: true, feedback: await listOwnFeedback(db, account) }, 200, context);
    }
    if (path === "/api/feedback/voting") {
      return noStoreJson({ ok: true, suggestions: await listFeatureVotes(db, account) }, 200, context);
    }
    if (path === "/api/admin/feedback") {
      return noStoreJson({ ok: true, ...await listAdminFeedback(db, url.searchParams) }, 200, context);
    }
    if (path === "/api/admin/task11/telemetry") {
      return noStoreJson({ ok: true, ...await listTelemetry(db, url.searchParams) }, 200, context);
    }
    if (path === "/api/admin/task11/import/status") {
      return noStoreJson({ ok: true, counts: await task11ImportCounts(db) }, 200, context);
    }
  }

  const payload = await readJson(context.request, descriptor.body);
  if (path === "/api/feedback") {
    return noStoreJson({ ok: true, feedback: await createFeedback(db, account, payload) }, 201, context);
  }
  if (path === "/api/feedback/vote") {
    return noStoreJson({ ok: true, suggestion: await setFeatureVote(db, account, payload) }, 200, context);
  }
  if (path === "/api/admin/feedback/update") {
    return noStoreJson({ ok: true, feedback: await updateAdminFeedback(db, account, payload) }, 200, context);
  }
  if (path === "/api/learning/sync") {
    return noStoreJson({ ok: true, ...await syncLearningData(db, account, payload) }, 200, context);
  }
  if (path === "/api/telemetry") {
    return noStoreJson({ ok: true, ...await recordTelemetry(db, payload) }, 202, context);
  }
  if (path === "/api/admin/task11/import") {
    return noStoreJson({ ok: true, ...await importTask11Batch(db, payload) }, 200, context);
  }
  throw new Task11Error("接口不存在", 404, "task11_route_not_found");
}

function featureEnabled(descriptor, flags) {
  return descriptor.mode === "read" ? flags.task11CloudReads : flags.task11CloudWrites;
}

function disabledResponse(descriptor, context) {
  if (new URL(context.request.url).pathname === "/api/telemetry") {
    return noStoreJson({ ok: true, recorded: false, reason: "cloud_writes_disabled" }, 202, context);
  }
  const operation = descriptor.mode === "read" ? "读取" : "写入";
  return apiError(
    descriptor.mode === "read" ? "cloud_reads_disabled" : "cloud_writes_disabled",
    `Task 11 云端${operation}尚未启用。`,
    503,
    requestId(context),
    { retryable: false },
  );
}

function cloudFailure(error, context) {
  const classification = classifyCloudError(error);
  return apiError(
    `task11_${classification}`,
    classification === "quota_exhausted"
      ? "云端免费额度暂时不可用，请稍后重试。"
      : "Task 11 云端服务暂时不可用，请稍后重试。",
    503,
    requestId(context),
    { retryable: true },
  );
}

export async function handleTask11Request(context) {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  const descriptor = ROUTES.get(`${method} ${url.pathname}`);
  if (!descriptor) {
    const allowed = METHODS_BY_PATH.get(url.pathname);
    if (!allowed) return null;
    return apiError("method_not_allowed", "此接口不支持当前请求方法。", 405, requestId(context), {
      headers: { Allow: [...allowed].join(", ") },
    });
  }

  const flags = featureFlags(context.env);
  if (descriptor.import) {
    const importEnabled = ["1", "true", "yes", "on"].includes(
      String(context.env?.TASK11_IMPORT_ENABLED || "").trim().toLowerCase(),
    );
    if (!importEnabled) {
      return apiError("task11_import_disabled", "Task 11 导入接口未启用。", 404, requestId(context));
    }
    if (String(context.env?.WYJ_ENVIRONMENT || "").toLowerCase() === "production") {
      const productionEnabled = ["1", "true", "yes", "on"].includes(
        String(context.env?.TASK11_PRODUCTION_IMPORT_ENABLED || "").trim().toLowerCase(),
      );
      const confirmed = context.request.headers.get("X-WYJ-Task11-Production-Confirm")
        === "TASK11-PRODUCTION-MIGRATION";
      if (!productionEnabled || !confirmed) {
        return apiError(
          "task11_production_import_confirmation_required",
          "Production 导入需要单独启用并明确确认。",
          403,
          requestId(context),
        );
      }
    }
  }
  if (!featureEnabled(descriptor, flags)) {
    return disabledResponse(descriptor, context);
  }
  try {
    const ready = await ensureTask11Schema(context.env.WYJ_DB);
    if (!ready) {
      throw new Task11Error(
        "Task 11 云端数据结构尚未就绪。",
        503,
        "task11_schema_not_ready",
        true,
      );
    }
  } catch (error) {
    if (error instanceof Task11Error) {
      return apiError(error.code, error.message, error.status, requestId(context), {
        retryable: error.retryable,
      });
    }
    return cloudFailure(error, context);
  }

  try {
    const account = await authenticate(context, descriptor.auth, flags);
    if (account instanceof Response) return account;
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account?.id || undefined,
    });
    if (!rate.allowed) return rateLimitError(url.pathname, rate, context);
    return await executeRoute(context, descriptor, account);
  } catch (error) {
    if (error instanceof Task11Error) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    console.error(JSON.stringify({
      event: "task11_cloud_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    return cloudFailure(error, context);
  }
}

export const __testing = { METHODS_BY_PATH, ROUTES, readJson };
