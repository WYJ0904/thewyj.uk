import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { importTask14Batch, rollbackTask14Import, task14ImportStatus } from "./task14-import.mjs";
import {
  FILE_TYPES,
  MAX_TEMP_FILE_BYTES,
  MAX_TEMP_LIFETIME_MINUTES,
  MAX_TEMP_TEXT_BYTES,
  MAX_TEMP_VIDEO_BYTES,
  TASK14_SCHEMA_VERSION,
  Task14Error,
  requireAllowedFields,
} from "./task14-model.mjs";
import {
  authorizeFileDownload,
  cancelFileReservation,
  cleanupExpiredShares,
  clearRoom,
  createClipboard,
  createFileReservation,
  createRoom,
  createTextShare,
  ensureTask14Schema,
  postRoomMessage,
  readClipboard,
  readRoom,
  readTextShare,
  streamFileDownload,
  uploadFileObject,
} from "./task14-service.mjs";

const ROUTES = new Map([
  ["GET /api/temporary/capabilities", { mode: "capability", auth: "public", limit: 120, window: 60, cloudOnly: true }],
  ["POST /api/temporary/text", { mode: "write", auth: "user", limit: 30, window: 60, body: 104 * 1024, legacy: true }],
  ["POST /api/temporary/qr", { mode: "write", auth: "user", limit: 30, window: 60, body: 104 * 1024, legacy: true }],
  ["POST /api/temporary/clipboard", { mode: "write", auth: "user", limit: 30, window: 60, body: 104 * 1024, legacy: true }],
  ["POST /api/temporary/room", { mode: "write", auth: "user", limit: 20, window: 60, body: 4 * 1024, legacy: true }],
  ["POST /api/temporary/room/clear", { mode: "write", auth: "user", limit: 30, window: 60, body: 2 * 1024, legacy: true }],
  ["POST /api/temporary/file/init", { mode: "write", auth: "user", limit: 20, window: 60, body: 8 * 1024, cloudOnly: true }],
  ["PUT /api/temporary/file/upload", { mode: "write", auth: "user", limit: 30, window: 60, raw: true, cloudOnly: true }],
  ["POST /api/temporary/file/cancel", { mode: "write", auth: "user", limit: 30, window: 60, body: 2 * 1024, cloudOnly: true }],
  ["POST /api/share/text/read", { mode: "read", auth: "public", limit: 60, window: 60, body: 4 * 1024, legacy: true }],
  ["POST /api/share/file/authorize", { mode: "read", auth: "public", limit: 30, window: 60, body: 4 * 1024, cloudOnly: true }],
  ["GET /api/share/file/download", { mode: "read", auth: "public", limit: 180, window: 60, raw: true, cloudOnly: true }],
  ["POST /api/share/clipboard/read", { mode: "read", auth: "public", limit: 30, window: 60, body: 2 * 1024, legacy: true }],
  ["POST /api/share/room/read", { mode: "read", auth: "public", limit: 120, window: 60, body: 4 * 1024, legacy: true }],
  ["POST /api/share/room/post", { mode: "read", auth: "public", limit: 60, window: 60, body: 8 * 1024, legacy: true }],
  ["POST /api/admin/task14/cleanup", { mode: "import", auth: "admin", limit: 10, window: 60, body: 2 * 1024, cloudOnly: true }],
  ["POST /api/admin/task14/import", { mode: "import", auth: "admin", limit: 10, window: 60, body: 512 * 1024, cloudOnly: true }],
  ["POST /api/admin/task14/import/rollback", { mode: "import", auth: "admin", limit: 5, window: 60, body: 4 * 1024, cloudOnly: true }],
  ["GET /api/admin/task14/import/status", { mode: "import", auth: "admin", limit: 30, window: 60, cloudOnly: true }],
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
  if (declared > maximumBytes) throw new Task14Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task14Error("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(body) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch (_) {
    throw new Task14Error("请求 JSON 格式无效", 400, "invalid_json");
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

async function authenticate(context, requirement) {
  if (requirement === "public") return null;
  const result = await resolveTask12Account(context);
  if (!result.authenticated) return authenticationError(result, context);
  if (requirement === "admin" && !result.account.is_super_admin) {
    return apiError("forbidden", "无管理员权限", 403, requestId(context));
  }
  return result.account;
}

function featureEnabled(descriptor, flags) {
  if (descriptor.mode === "capability") return true;
  if (descriptor.mode === "read") return flags.task14CloudReads;
  if (descriptor.mode === "write") return flags.task14CloudWrites && flags.task14TemporaryPrimary;
  return flags.task14Import;
}

function productionImportAllowed(context, flags) {
  if (String(context.env?.WYJ_ENVIRONMENT || "").toLowerCase() !== "production") return true;
  return flags.task14ProductionImport
    && context.request.headers.get("X-WYJ-Task14-Production-Confirm") === "TASK14-PRODUCTION-TEMPORARY-SHARING-MIGRATION";
}

async function capabilities(context, flags) {
  let schemaReady = false;
  try { schemaReady = await ensureTask14Schema(context.env.WYJ_DB); } catch (_) { schemaReady = false; }
  return response({
    ok: true,
    task: 14,
    schema_version: TASK14_SCHEMA_VERSION,
    schema_ready: schemaReady,
    cloud_reads: Boolean(flags.task14CloudReads && schemaReady),
    cloud_upload: Boolean(flags.task14CloudWrites && flags.task14TemporaryPrimary && schemaReady),
    temporary_primary: Boolean(flags.task14TemporaryPrimary),
    legacy_writes_frozen: Boolean(flags.task14LegacyWritesFrozen),
    limits: {
      text_bytes: MAX_TEMP_TEXT_BYTES,
      file_bytes: MAX_TEMP_FILE_BYTES,
      video_bytes: MAX_TEMP_VIDEO_BYTES,
      lifetime_minutes: MAX_TEMP_LIFETIME_MINUTES,
    },
    file_extensions: Object.keys(FILE_TYPES),
  }, 200, context, { "Cache-Control": "no-store" });
}

async function executeRoute(context, descriptor, account, flags) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const method = context.request.method.toUpperCase();
  const db = context.env.WYJ_DB;
  const storage = context.env.WYJ_STORAGE;
  const env = context.env;
  if (path === "/api/temporary/capabilities") return await capabilities(context, flags);
  if (method === "GET") {
    if (path === "/api/share/file/download") {
      return await streamFileDownload(context, url.searchParams.get("id"), url.searchParams.get("grant"));
    }
    if (path === "/api/admin/task14/import/status") {
      return response({ ok: true, ...await task14ImportStatus(db) }, 200, context);
    }
  }
  if (method === "PUT" && path === "/api/temporary/file/upload") {
    const file = await uploadFileObject(db, storage, account, context.request, url.searchParams.get("id"));
    return response({ ok: true, file }, 201, context);
  }
  const payload = await readJson(context.request, descriptor.body);
  if (path === "/api/temporary/text" || path === "/api/temporary/qr") {
    requireAllowedFields(payload, new Set(["content", "kind", "password", "minutes", "max_views", "destroy_after_read"]));
    const share = await createTextShare(db, account, env, payload, path.endsWith("/qr") ? "qr" : "text");
    return response({ ok: true, share }, 201, context);
  }
  if (path === "/api/temporary/clipboard") {
    requireAllowedFields(payload, new Set(["content", "minutes", "destroy_after_read"]));
    return response({ ok: true, clipboard: await createClipboard(db, account, env, payload) }, 201, context);
  }
  if (path === "/api/temporary/room") {
    requireAllowedFields(payload, new Set(["password", "minutes", "max_messages"]));
    return response({ ok: true, room: await createRoom(db, account, env, payload) }, 201, context);
  }
  if (path === "/api/temporary/room/clear") {
    requireAllowedFields(payload, new Set(["id"]));
    await clearRoom(db, account, payload);
    return response({ ok: true }, 200, context);
  }
  if (path === "/api/temporary/file/init") {
    requireAllowedFields(payload, new Set([
      "file_name", "mime_type", "size_bytes", "password", "minutes", "max_downloads", "destroy_after_download",
    ]));
    return response({ ok: true, upload: await createFileReservation(db, account, env, payload) }, 201, context);
  }
  if (path === "/api/temporary/file/cancel") {
    requireAllowedFields(payload, new Set(["id"]));
    await cancelFileReservation(db, storage, account, payload.id);
    return response({ ok: true }, 200, context);
  }
  if (path === "/api/share/text/read") {
    requireAllowedFields(payload, new Set(["id", "password"]));
    return response({ ok: true, share: await readTextShare(db, storage, env, payload) }, 200, context);
  }
  if (path === "/api/share/clipboard/read") {
    requireAllowedFields(payload, new Set(["code"]));
    return response({ ok: true, clipboard: await readClipboard(db, storage, env, payload) }, 200, context);
  }
  if (path === "/api/share/room/read") {
    requireAllowedFields(payload, new Set(["id", "password"]));
    return response({ ok: true, room: await readRoom(db, storage, env, payload) }, 200, context);
  }
  if (path === "/api/share/room/post") {
    requireAllowedFields(payload, new Set(["id", "password", "author", "message"]));
    return response({ ok: true, room: await postRoomMessage(db, storage, env, payload) }, 201, context);
  }
  if (path === "/api/share/file/authorize") {
    requireAllowedFields(payload, new Set(["id", "password"]));
    return response({ ok: true, download: await authorizeFileDownload(db, storage, env, payload) }, 200, context, {
      "Cache-Control": "private, no-store",
    });
  }
  if (path === "/api/admin/task14/cleanup") {
    requireAllowedFields(payload, new Set(["limit", "scan_orphans"]));
    const result = await cleanupExpiredShares(db, storage, {
      limit: payload.limit,
      scanOrphans: Boolean(payload.scan_orphans),
      environment: env.WYJ_ENVIRONMENT,
    });
    return response({ ok: true, cleanup: result }, 200, context);
  }
  if (path === "/api/admin/task14/import") {
    return response({ ok: true, ...await importTask14Batch(db, storage, account, env, payload) }, 200, context);
  }
  if (path === "/api/admin/task14/import/rollback") {
    return response({ ok: true, rollback: await rollbackTask14Import(db, storage, payload) }, 200, context);
  }
  throw new Task14Error("临时分享接口不存在", 404, "task14_route_not_found");
}

function cloudFailure(error, context) {
  const classification = classifyCloudError(error);
  const message = classification === "quota_exhausted"
    ? "Cloudflare 免费额度暂时不可用，新的临时上传已暂停，本地工具仍可使用"
    : "云端临时分享暂时不可用，请稍后重试";
  return apiError(`task14_${classification}`, message, 503, requestId(context), { retryable: true });
}

export async function handleTask14Request(context) {
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
    if (descriptor.mode === "write" && flags.task14LegacyWritesFrozen) {
      return apiError(
        "task14_migration_in_progress",
        "临时分享正在进行短暂迁移维护，请稍后重试",
        503,
        requestId(context),
        { retryable: true, headers: { "Retry-After": "30" } },
      );
    }
    return apiError("task14_cloud_not_enabled", "云端临时分享尚未启用", 503, requestId(context), { retryable: true });
  }
  if (descriptor.mode === "import" && !productionImportAllowed(context, flags)) {
    return apiError(
      "task14_production_import_confirmation_required",
      "Production 临时分享导入需要单独启用并明确确认",
      403,
      requestId(context),
    );
  }
  try {
    if (descriptor.mode !== "capability" && !await ensureTask14Schema(context.env.WYJ_DB)) {
      throw new Task14Error("云端临时分享数据结构尚未就绪", 503, "task14_schema_not_ready", true);
    }
    const account = await authenticate(context, descriptor.auth);
    if (account instanceof Response) return account;
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account?.id || undefined,
    });
    if (!rate.allowed) {
      return apiError("share_rate_limited", "临时分享访问过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || descriptor.window) },
      });
    }
    return await executeRoute(context, descriptor, account, flags);
  } catch (error) {
    if (error instanceof Task14Error) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    console.error(JSON.stringify({
      event: "task14_cloud_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    return cloudFailure(error, context);
  }
}

export const __testing = Object.freeze({
  METHODS_BY_PATH,
  ROUTES,
  featureEnabled,
  productionImportAllowed,
  readJson,
});
