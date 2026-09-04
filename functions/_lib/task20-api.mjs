import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { loginContext, requireAllowedFields, Task12Error } from "./task12-model.mjs";
import { recordLoginEvent } from "./task12-service.mjs";
import { enrichAccountWithTask13 } from "./task13-service.mjs";
import {
  clearTask20AccessCookie,
  requireTask20AndroidClient,
  task20AccessCookie,
  task20TokenFromRequest,
} from "./task20-model.mjs";
import {
  ensureTask20Schema,
  loginTask20Device,
  logoutTask20Device,
  refreshTask20Device,
  task20DeviceSessionForAccess,
} from "./task20-service.mjs";

const ROUTES = new Map([
  ["GET /api/app/config", { auth: "public", limit: 120, window: 60, schema: false }],
  ["POST /api/app/login", { auth: "public", body: 8 * 1024, limit: 12, window: 300 }],
  ["POST /api/app/session/refresh", { auth: "public", body: 8 * 1024, limit: 60, window: 60 }],
  ["POST /api/app/session/logout", { auth: "optional", body: 4 * 1024, limit: 30, window: 60 }],
  ["GET /api/app/session", { auth: "user", limit: 120, window: 60 }],
]);

const METHODS_BY_PATH = new Map();
for (const key of ROUTES.keys()) {
  const [method, path] = key.split(" ");
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
  if (declared > maximumBytes) throw new Task12Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task12Error("请求内容过大", 413, "request_too_large");
  try { return JSON.parse(new TextDecoder().decode(body) || "{}"); }
  catch (_) { throw new Task12Error("请求 JSON 格式无效", 400, "invalid_json"); }
}

function passwordOptions(context) {
  return {
    passwordPepper: String(context.env.WYJ_TASK12_PASSWORD_PEPPER || ""),
    sessionSecret: String(context.env.WYJ_TASK20_DEVICE_SESSION_SECRET || ""),
  };
}

async function auditLogin(context, username, success, reason, account = null) {
  try {
    await recordLoginEvent(
      context.env.WYJ_DB,
      username,
      success,
      reason,
      { ...loginContext(context.request), source: "android_app" },
      account,
    );
  } catch (_) {
    // Authentication remains available if optional audit retention fails.
  }
}

function authenticationError(result, context) {
  const messages = {
    authentication_required: "请先登录",
    canonical_session_invalid: "登录会话无效，请重新登录",
    session_expired: "登录会话已过期",
    session_revoked: "登录会话已被撤销",
    session_generation_invalid: "账户安全状态已变化，请重新登录",
    account_deleted: "账户已删除",
    account_banned: "账户已被封禁",
  };
  const code = String(result.code || "authentication_required");
  return apiError(code, messages[code] || "账户不可用", result.status || 401, requestId(context));
}

function safeAndroidDownloadUrl(value) {
  const candidate = String(value || "").trim().slice(0, 500);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

async function executeRoute(context, descriptor, account) {
  const path = new URL(context.request.url).pathname;
  const method = context.request.method.toUpperCase();
  const db = context.env.WYJ_DB;
  if (method === "GET" && path === "/api/app/config") {
    return response({
      ok: true,
      app: {
        name: "thewyj",
        application_id: "uk.thewyj.app",
        latest_version_code: Math.max(1, Number.parseInt(String(context.env.ANDROID_LATEST_VERSION_CODE || "1"), 10) || 1),
        latest_version_name: String(context.env.ANDROID_LATEST_VERSION_NAME || "1.0.0").slice(0, 40),
        minimum_version_code: Math.max(1, Number.parseInt(String(context.env.ANDROID_MINIMUM_VERSION_CODE || "1"), 10) || 1),
        download_url: safeAndroidDownloadUrl(context.env.ANDROID_DOWNLOAD_URL),
      },
    }, 200, context);
  }
  if (method === "GET" && path === "/api/app/session") {
    const token = task20TokenFromRequest(context.request);
    const deviceSession = await task20DeviceSessionForAccess(db, token);
    if (!deviceSession) return apiError("app_session_not_found", "当前会话不是有效的 Android 设备会话", 401, requestId(context));
    return response({
      ok: true,
      account: await enrichAccountWithTask13(db, account),
      device_session: deviceSession,
    }, 200, context);
  }
  const payload = await readJson(context.request, descriptor.body);
  if (path === "/api/app/login") {
    requireAllowedFields(payload, new Set(["username", "secret", "device_id", "app_version"]));
    try {
      const result = await loginTask20Device(db, payload, context.request, passwordOptions(context));
      const enriched = await enrichAccountWithTask13(db, result.account);
      await auditLogin(context, payload.username, true, "success", result.account);
      return response(
        { ok: true, ...result, account: enriched },
        200,
        context,
        { "Set-Cookie": task20AccessCookie(result.access_token) },
      );
    } catch (error) {
      if (error instanceof Task12Error) await auditLogin(context, payload.username, false, error.code);
      throw error;
    }
  }
  if (path === "/api/app/session/refresh") {
    requireAllowedFields(payload, new Set(["refresh_token", "device_id", "rotation_key", "app_version"]));
    const result = await refreshTask20Device(db, payload, passwordOptions(context));
    return response(
      { ok: true, ...result, account: await enrichAccountWithTask13(db, result.account) },
      200,
      context,
      { "Set-Cookie": task20AccessCookie(result.access_token) },
    );
  }
  if (path === "/api/app/session/logout") {
    requireAllowedFields(payload, new Set(["refresh_token", "device_id"]));
    await logoutTask20Device(db, payload, task20TokenFromRequest(context.request));
    return response({ ok: true }, 200, context, { "Set-Cookie": clearTask20AccessCookie() });
  }
  throw new Task12Error("Android App 接口不存在", 404, "task20_route_not_found");
}

export async function handleTask20Request(context) {
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
  if (!flags.task20AndroidApp) {
    return apiError("task20_android_app_disabled", "Android App 云端会话尚未启用", 503, requestId(context), { retryable: true });
  }
  try {
    if (url.pathname !== "/api/app/config") requireTask20AndroidClient(context.request);
    if (descriptor.schema !== false && !await ensureTask20Schema(context.env.WYJ_DB)) {
      throw new Task12Error("Android 设备会话数据结构尚未就绪", 503, "task20_schema_not_ready", true);
    }
    let account = null;
    if (descriptor.auth === "user") {
      const authenticated = await resolveTask12Account(context);
      if (!authenticated.authenticated) return authenticationError(authenticated, context);
      account = authenticated.account;
    }
    if (descriptor.limit) {
      const rate = await enforceD1RateLimit(context, {
        enabled: flags.d1RateLimit,
        limit: descriptor.limit,
        windowSeconds: descriptor.window,
        scope: `${method}:${url.pathname}`,
        subject: account?.id || undefined,
      });
      if (!rate.allowed) {
        return apiError("app_rate_limited", "App 请求过于频繁，请稍后重试", 429, requestId(context), {
          retryable: true,
          headers: { "Retry-After": String(rate.retryAfter || 60) },
        });
      }
    }
    return await executeRoute(context, descriptor, account);
  } catch (error) {
    if (error instanceof Task12Error) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    const classification = classifyCloudError(error);
    console.error(JSON.stringify({
      event: "task20_android_session_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    return apiError(`task20_${classification}`, "Android 设备会话暂时不可用，请稍后重试", 503, requestId(context), {
      retryable: true,
    });
  }
}

export const __testing = { METHODS_BY_PATH, ROUTES, readJson, safeAndroidDownloadUrl };
