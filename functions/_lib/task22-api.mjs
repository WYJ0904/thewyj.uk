import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import {
  TASK22_BUILD,
  Task22Error,
  requireAllowedFields,
} from "./task22-model.mjs";
import {
  abortUploadSession,
  allocateUploadFile,
  authorizeShareDownload,
  cleanupExpiredTransfers,
  completeUploadSession,
  createUploadSession,
  ensureTask22Schema,
  listShares,
  revokeShare,
  shareMetadata,
  streamFileDownload,
  transferCapabilities,
  uploadPart,
  uploadSessionState,
} from "./task22-service.mjs";

const ROUTES = new Map([
  ["GET /api/transfer/capabilities", { mode: "read", auth: "public", limit: 120, window: 60 }],
  ["POST /api/transfer/uploads", { mode: "write", auth: "optional", limit: 30, window: 60, body: 8 * 1024 }],
  ["POST /api/transfer/uploads/files", { mode: "write", auth: "optional", limit: 60, window: 60, body: 16 * 1024 }],
  ["PUT /api/transfer/uploads/parts", { mode: "write", auth: "optional", limit: 180, window: 60, raw: true }],
  ["GET /api/transfer/uploads/state", { mode: "read", auth: "optional", limit: 120, window: 60 }],
  ["POST /api/transfer/uploads/complete", { mode: "write", auth: "optional", limit: 30, window: 60, body: 8 * 1024 }],
  ["POST /api/transfer/uploads/abort", { mode: "write", auth: "optional", limit: 30, window: 60, body: 8 * 1024 }],
  ["GET /api/transfer/shares", { mode: "read", auth: "optional", limit: 60, window: 60 }],
  ["GET /api/transfer/shares/metadata", { mode: "read", auth: "public", limit: 60, window: 60 }],
  ["POST /api/transfer/shares/authorize", { mode: "read", auth: "public", limit: 30, window: 60, body: 8 * 1024 }],
  ["GET /api/transfer/shares/download", { mode: "read", auth: "public", limit: 180, window: 60, raw: true }],
  ["POST /api/transfer/shares/revoke", { mode: "write", auth: "optional", limit: 30, window: 60, body: 8 * 1024 }],
  ["POST /api/admin/task22/cleanup", { mode: "admin", auth: "owner", limit: 10, window: 60, body: 2 * 1024 }],
]);

const PATH_PATTERNS = Object.freeze([
  { pattern: /^\/api\/transfer\/uploads\/[A-Za-z0-9_-]{16,80}\/files\/[A-Za-z0-9_-]{16,80}\/parts\/([0-9]{1,4})$/, route: "PUT /api/transfer/uploads/parts" },
  { pattern: /^\/api\/transfer\/uploads\/[A-Za-z0-9_-]{16,80}\/complete$/, route: "POST /api/transfer/uploads/complete" },
  { pattern: /^\/api\/transfer\/uploads\/[A-Za-z0-9_-]{16,80}\/abort$/, route: "POST /api/transfer/uploads/abort" },
  { pattern: /^\/api\/transfer\/uploads\/[A-Za-z0-9_-]{16,80}$/, route: "GET /api/transfer/uploads/state" },
  { pattern: /^\/api\/transfer\/shares\/[A-Za-z0-9_-]{16,80}\/authorize$/, route: "POST /api/transfer/shares/authorize" },
  { pattern: /^\/api\/transfer\/shares\/[A-Za-z0-9_-]{16,80}\/download$/, route: "GET /api/transfer/shares/download" },
  { pattern: /^\/api\/transfer\/shares\/[A-Za-z0-9_-]{16,80}\/revoke$/, route: "POST /api/transfer/shares/revoke" },
  { pattern: /^\/api\/transfer\/shares\/[A-Za-z0-9_-]{16,80}$/, route: "GET /api/transfer/shares/metadata" },
]);

function descriptorFor(method, pathname) {
  for (const entry of PATH_PATTERNS) {
    if (entry.route.startsWith(method) && entry.pattern.test(pathname)) {
      return { descriptor: ROUTES.get(entry.route), routeKey: entry.route };
    }
  }
  const descriptor = ROUTES.get(`${method} ${pathname}`);
  return descriptor ? { descriptor, routeKey: `${method} ${pathname}` } : null;
}

function requestId(context) {
  return context.data?.requestId || "";
}

function response(payload, status, context, headers = {}) {
  return jsonResponse(payload, status, requestId(context), headers);
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task22Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task22Error("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(body) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch (_) {
    throw new Task22Error("请求 JSON 格式无效", 400, "invalid_json");
  }
}

function guestIdFrom(context, payload = null) {
  return String(payload?.guest_id || context.request.headers.get("X-Transfer-Guest-Id") || "").trim();
}

async function authenticate(context, requirement) {
  const result = await resolveTask12Account(context);
  if (result.authenticated) {
    if (requirement === "owner" && !result.account.is_super_admin) {
      return apiError("owner_required", "只有站点所有者可以执行此操作", 403, requestId(context));
    }
    return result.account;
  }
  if (requirement === "owner") {
    return apiError("authentication_required", "请先登录", 401, requestId(context));
  }
  return null;
}

function featureEnabled(descriptor, flags) {
  return descriptor.mode === "read" ? flags.task22TransferReads : flags.task22TransferWrites;
}

async function execute(context, account, descriptor) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const method = context.request.method.toUpperCase();
  const db = context.env.WYJ_DB;
  const storage = context.env.WYJ_STORAGE;
  const environment = String(context.env.WYJ_ENVIRONMENT || "development");
  const payloadFor = (maximumBytes) => method === "GET" ? {} : readJson(context.request, maximumBytes);

  if (path === "/api/transfer/capabilities") {
    return response({ ok: true, ...await transferCapabilities(db, account, { guest_id: url.searchParams.get("guest_id") || "" }), build: TASK22_BUILD }, 200, context, { "Cache-Control": "no-store" });
  }
  if (path === "/api/transfer/uploads") {
    const payload = await payloadFor(descriptor.body);
    requireAllowedFields(payload, new Set(["guest_id", "password", "minutes", "max_downloads", "one_time", "file_count", "total_bytes"]));
    const upload = await createUploadSession(db, account, context.env, payload);
    return response({ ok: true, upload: { id: upload.id, state: upload.state, expires_at: upload.expires_at } }, 201, context);
  }
  if (path === "/api/transfer/uploads/files") {
    const payload = await payloadFor(descriptor.body);
    const file = await allocateUploadFile(db, account, context.env, payload);
    return response({ ok: true, file: {
      file_id: file.id,
      relative_path: file.relative_path,
      file_name: file.file_name,
      mime_type: file.mime_type,
      part_size: file.part_size,
      part_count: file.part_count,
      size_bytes: file.size_bytes,
      preview_policy: file.preview_policy,
    } }, 201, context);
  }
  const partMatch = /^\/api\/transfer\/uploads\/([A-Za-z0-9_-]{16,80})\/files\/([A-Za-z0-9_-]{16,80})\/parts\/([0-9]{1,4})$/.exec(path);
  if (partMatch) {
    const part = await uploadPart(db, storage, account, context.request, partMatch[1], partMatch[2], partMatch[3], environment, guestIdFrom(context));
    return response({ ok: true, part }, part.uploaded ? 200 : 201, context);
  }
  const stateMatch = /^\/api\/transfer\/uploads\/([A-Za-z0-9_-]{16,80})$/.exec(path);
  if (stateMatch) {
    const state = await uploadSessionState(db, account, { session_id: stateMatch[1], guest_id: guestIdFrom(context) });
    return response({ ok: true, ...state, build: TASK22_BUILD }, 200, context);
  }
  const completeMatch = /^\/api\/transfer\/uploads\/([A-Za-z0-9_-]{16,80})\/complete$/.exec(path);
  if (completeMatch) {
    const payload = await payloadFor(descriptor.body);
    const share = await completeUploadSession(db, storage, account, context.env, { ...payload, session_id: completeMatch[1] });
    return response({ ok: true, share }, 200, context);
  }
  const abortMatch = /^\/api\/transfer\/uploads\/([A-Za-z0-9_-]{16,80})\/abort$/.exec(path);
  if (abortMatch) {
    const payload = await payloadFor(descriptor.body);
    const result = await abortUploadSession(db, storage, account, { ...payload, session_id: abortMatch[1] });
    return response({ ok: true, upload: result }, 200, context);
  }
  if (path === "/api/transfer/shares") {
    return response({ ok: true, shares: await listShares(db, account, { guest_id: guestIdFrom(context) }), build: TASK22_BUILD }, 200, context);
  }
  const authorizeMatch = /^\/api\/transfer\/shares\/([A-Za-z0-9_-]{16,80})\/authorize$/.exec(path);
  if (authorizeMatch) {
    const payload = await payloadFor(descriptor.body);
    requireAllowedFields(payload, new Set(["password"]));
    const download = await authorizeShareDownload(db, storage, context.env, { ...payload, id: authorizeMatch[1] });
    return response({ ok: true, download }, 200, context, { "Cache-Control": "private, no-store" });
  }
  const downloadMatch = /^\/api\/transfer\/shares\/([A-Za-z0-9_-]{16,80})\/download$/.exec(path);
  if (downloadMatch) {
    return await streamFileDownload(context, downloadMatch[1], url.searchParams.get("file") || "", url.searchParams.get("grant") || "");
  }
  const revokeMatch = /^\/api\/transfer\/shares\/([A-Za-z0-9_-]{16,80})\/revoke$/.exec(path);
  if (revokeMatch) {
    const payload = await payloadFor(descriptor.body);
    const share = await revokeShare(db, storage, account, { ...payload, id: revokeMatch[1] });
    return response({ ok: true, share }, 200, context);
  }
  const metadataMatch = /^\/api\/transfer\/shares\/([A-Za-z0-9_-]{16,80})$/.exec(path);
  if (metadataMatch) {
    const share = await shareMetadata(db, storage, context.env, {
      id: metadataMatch[1],
      password: url.searchParams.get("password") || "",
    });
    return response({ ok: true, share, build: TASK22_BUILD }, 200, context, { "Cache-Control": "no-store" });
  }
  if (path === "/api/admin/task22/cleanup") {
    const payload = await payloadFor(descriptor.body);
    requireAllowedFields(payload, new Set(["limit", "scan_orphans"]));
    const result = await cleanupExpiredTransfers(db, storage, {
      limit: payload.limit,
      scanOrphans: Boolean(payload.scan_orphans),
      environment,
    });
    return response({ ok: true, cleanup: result }, 200, context);
  }
  throw new Task22Error("文件传输接口不存在", 404, "task22_route_not_found");
}

export async function handleTask22Request(context) {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  const matched = descriptorFor(method, url.pathname);
  if (!matched) return null;
  const { descriptor } = matched;
  const flags = featureFlags(context.env);
  if (descriptor.mode !== "admin" && !featureEnabled(descriptor, flags)) {
    return apiError("task22_transfer_not_enabled", "文件传输 2.0 尚未启用", 503, requestId(context), { retryable: true });
  }
  try {
    if (!await ensureTask22Schema(context.env.WYJ_DB)) {
      throw new Task22Error("文件传输数据结构尚未就绪", 503, "task22_schema_not_ready", true);
    }
    const account = await authenticate(context, descriptor.auth);
    if (account instanceof Response) return account;
    if (descriptor.auth === "optional" && !account && !guestIdFrom(context)) {
      return apiError("authentication_required", "请先登录或提供访客设备标识", 401, requestId(context));
    }
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account?.id || `guest:${guestIdFrom(context)}`,
    });
    if (!rate.allowed) {
      return apiError("transfer_rate_limited", "文件传输访问过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || descriptor.window) },
      });
    }
    return await execute(context, account, descriptor);
  } catch (error) {
    if (error instanceof Task22Error) {
      return apiError(error.code, error.message, error.status, requestId(context), {
        retryable: error.retryable,
        details: error.details,
      });
    }
    console.error(JSON.stringify({
      event: "task22_transfer_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    const classification = classifyCloudError(error);
    const message = classification === "quota_exhausted"
      ? "Cloudflare 免费额度暂时不可用，新的文件传输已暂停"
      : "文件传输服务暂时不可用，请稍后重试";
    return apiError(`task22_${classification}`, message, 503, requestId(context), { retryable: true });
  }
}

export const __testing = Object.freeze({
  PATH_PATTERNS,
  ROUTES,
  descriptorFor,
  featureEnabled,
  guestIdFrom,
});
