/**
 * Task29 Cloud API Router for /api/backup/v1/*
 * Enforces session auth, same-origin protection, kill-switch check, bounded
 * memory JSON parsing, D1 rate limits, and Step-up enforcement on restore commits.
 */

import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
  sameOriginResult,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { MAX_BACKUP_BYTES, Task29Error } from "./task29-backup-crypto.mjs";
import {
  cancelRestoreJob,
  commitRestoreJob,
  ensureTask29Schema,
  exportAccountData,
  getBackupOverview,
  getRestoreJob,
  precheckBackupRestore,
} from "./task29-backup-service.mjs";

const MAX_BODY_EXPORT_BYTES = 16 * 1024;
const MAX_BODY_PRECHECK_BYTES = MAX_BACKUP_BYTES + 256 * 1024;
const MAX_BODY_COMMIT_BYTES = 16 * 1024;
const SAFE_JOB_ID_PATTERN = /^brjob_[A-Za-z0-9_-]{8,64}$/;

function reqId(context) {
  return context.data?.requestId || "";
}

function respond(payload, status, context) {
  return jsonResponse({ ok: true, ...payload }, status, reqId(context), {
    "Cache-Control": "private, no-store",
  });
}

async function readBoundedJson(request, maxBytes) {
  const ct = String(request.headers.get("Content-Type") || "");
  if (!/^application\/json(?:\s*;|$)/i.test(ct)) {
    throw new Task29Error("BACKUP_CONTENT_TYPE_INVALID", "请求体必须为 application/json", 415);
  }
  const cl = request.headers.get("Content-Length");
  if (cl !== null && (!/^\d+$/.test(cl) || Number(cl) > maxBytes)) {
    throw new Task29Error("BACKUP_TOO_LARGE", "请求体超过安全大小限制", 413);
  }
  const chunks = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          void reader.cancel().catch(() => undefined);
          throw new Task29Error("BACKUP_TOO_LARGE", "请求体超过 16 MiB 有界内存限制", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes) || "{}";
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("object required");
    }
    return parsed;
  } catch (_) {
    throw new Task29Error("BACKUP_INVALID_JSON", "请求 JSON 格式无效或包含非法 UTF-8 编码", 400);
  }
}

async function checkBackupEnabled(env, db) {
  if (String(env?.TASK29_BACKUP_ENABLED || "").toLowerCase() === "false") {
    throw new Task29Error("BACKUP_DISABLED", "数据备份与恢复服务已通过运行开关暂停", 503, true);
  }
  if (!db?.prepare) return;
  try {
    const row = await db.prepare("SELECT enabled, kill_switch FROM task25_feature_flags WHERE flag_key = 'task29_backup_v1'").first();
    if (row && (Number(row.kill_switch) === 1 || Number(row.enabled) === 0)) {
      throw new Task29Error("BACKUP_DISABLED", "数据备份与恢复功能已临时关闭，请稍后再试", 503, true);
    }
  } catch (err) {
    if (err instanceof Task29Error) throw err;
    // Ignore if task25_feature_flags table is absent in minimal environments
  }
}

async function applyRateLimit(context, scope, subject, limit, windowSeconds) {
  const result = await enforceD1RateLimit(context, {
    enabled: true,
    scope: `task29:${scope}`,
    subject,
    limit,
    windowSeconds,
  });
  if (result.degraded) {
    throw new Task29Error("BACKUP_RATE_LIMIT_UNAVAILABLE", "备份限流服务暂时不可用", 503, true);
  }
  if (!result.allowed) {
    throw new Task29Error("BACKUP_RATE_LIMITED", "备份/恢复操作过于频繁，请稍后再试", 429, true);
  }
}

const EXACT_ROUTES = {
  "GET /api/backup/v1/scopes": { name: "scopes" },
  "GET /api/backup/v1/overview": { name: "scopes" },
  "POST /api/backup/v1/export": { name: "export" },
  "POST /api/backup/v1/precheck": { name: "precheck" },
  "POST /api/backup/v1/restore/jobs": { name: "create_job" },
};

const KNOWN_EXACT_PATHS = new Set(Object.keys(EXACT_ROUTES).map((key) => key.split(" ")[1]));

function matchRoute(method, pathname) {
  const exact = EXACT_ROUTES[`${method} ${pathname}`];
  if (exact) return exact;
  if (KNOWN_EXACT_PATHS.has(pathname)) {
    return { name: "method_not_allowed" };
  }
  const jobMatch = /^\/api\/backup\/v1\/restore\/jobs\/([^/]+)(?:\/(commit|cancel))?$/.exec(pathname);
  if (jobMatch) {
    const jobId = decodeURIComponent(jobMatch[1]);
    const action = jobMatch[2] || "";
    if (!action && method === "GET") return { name: "get_job", jobId };
    if (action === "commit" && method === "POST") return { name: "commit_job", jobId };
    if (action === "cancel" && method === "POST") return { name: "cancel_job", jobId };
    return { name: "method_not_allowed" };
  }
  if (pathname.startsWith("/api/backup/v1/")) {
    return { name: "not_found" };
  }
  return null;
}

export async function handleTask29Request(context) {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  const route = matchRoute(method, url.pathname);
  if (!route) return null;

  if (route.name === "method_not_allowed") {
    return apiError("method_not_allowed", "请求方法不支持", 405, reqId(context));
  }
  if (route.name === "not_found") {
    return apiError("api_route_not_found", "备份接口不存在", 404, reqId(context));
  }

  try {
    if (method !== "GET" && method !== "HEAD" && !sameOriginResult(context.request).allowed) {
      throw new Task29Error("cross_origin_rejected", "只接受同源请求", 403);
    }

    const db = context.env?.WYJ_DB;
    if (!await ensureTask29Schema(db)) {
      throw new Task29Error("BACKUP_SCHEMA_NOT_READY", "备份服务数据结构尚未完成迁移", 503, true);
    }
    if (!featureFlags(context.env).task12CloudAccounts) {
      throw new Task29Error("cloud_accounts_disabled", "账户服务不可用", 503, true);
    }
    await checkBackupEnabled(context.env, db);

    const auth = await resolveTask12Account(context);
    if (!auth.authenticated) {
      return apiError(
        String(auth.code || "authentication_required"),
        auth.status === 401 ? "请重新登录账户" : "账户不可用",
        auth.status || 401,
        reqId(context),
      );
    }
    const account = auth.account;

    if (route.name === "scopes") {
      await applyRateLimit(context, "scopes", account.id, 60, 60);
      return respond(await getBackupOverview(context, account), 200, context);
    }

    if (route.name === "export") {
      await applyRateLimit(context, "export", account.id, 20, 300);
      const body = await readBoundedJson(context.request, MAX_BODY_EXPORT_BYTES);
      return respond(await exportAccountData(context, account, body), 200, context);
    }

    if (route.name === "precheck" || route.name === "create_job") {
      await applyRateLimit(context, "precheck", account.id, 20, 300);
      const body = await readBoundedJson(context.request, MAX_BODY_PRECHECK_BYTES);
      return respond(await precheckBackupRestore(context, account, body), 200, context);
    }

    if (!SAFE_JOB_ID_PATTERN.test(String(route.jobId || ""))) {
      throw new Task29Error("BACKUP_JOB_ID_INVALID", "恢复作业标识格式无效", 400);
    }

    if (route.name === "get_job") {
      await applyRateLimit(context, "job-read", account.id, 60, 60);
      return respond(await getRestoreJob(context, account, route.jobId), 200, context);
    }

    if (route.name === "commit_job") {
      await applyRateLimit(context, "commit", account.id, 10, 300);
      const body = await readBoundedJson(context.request, MAX_BODY_COMMIT_BYTES);
      return respond(await commitRestoreJob(context, account, route.jobId, body), 200, context);
    }

    if (route.name === "cancel_job") {
      await applyRateLimit(context, "cancel", account.id, 20, 300);
      return respond(await cancelRestoreJob(context, account, route.jobId), 200, context);
    }

    return null;
  } catch (err) {
    if (err instanceof Task29Error) {
      return apiError(err.code, err.message, err.status, reqId(context), {
        retryable: err.retryable,
        details: err.details,
        headers: err.status === 429 ? { "Retry-After": "60", "Cache-Control": "private, no-store" } : { "Cache-Control": "private, no-store" },
      });
    }
    const classified = classifyCloudError(err);
    // Log only non-secret diagnostic identifiers
    console.error(JSON.stringify({
      event: "task29_backup_error",
      request_id: reqId(context),
      route: url.pathname,
      error_name: String(err?.name || "Error"),
      code: classified.code || "task29_internal_error",
    }));
    return apiError(
      classified.code || "BACKUP_SERVICE_UNAVAILABLE",
      classified.message || "备份与恢复服务暂时不可用",
      classified.status || 503,
      reqId(context),
      { retryable: true, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export const __testing = { matchRoute };
