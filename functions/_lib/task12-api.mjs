import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
  sha256Hex,
} from "./cloudflare-foundation.mjs";
import { resolveLegacyAccount } from "./legacy-api.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { bridgeConfigured } from "./task12-bridge.mjs";
import { importTask12Batch, task12ImportCounts } from "./task12-import.mjs";
import {
  TASK12_SCHEMA_VERSION,
  Task12Error,
  loginContext,
  requireAllowedFields,
} from "./task12-model.mjs";
import {
  adminDeleteUser,
  adminForceLogout,
  adminResetSecret,
  adminSetBan,
  changeOwnSecret,
  deleteOwnAccount,
  ensureTask12Schema,
  listAccountAudit,
  listLoginAudit,
  listUsers,
  loginAccount,
  logoutAccount,
  logoutAllAccounts,
  recordLoginEvent,
  registerAccount,
} from "./task12-service.mjs";

const LOGIN_FAILURE_LIMIT = 8;
const LOGIN_FAILURE_WINDOW_SECONDS = 300;
const ROUTES = new Map([
  ["POST /api/register", { auth: "public", body: 4 * 1024, limit: 20, window: 600 }],
  ["POST /api/login", { auth: "public", body: 4 * 1024 }],
  ["GET /api/me", { auth: "user", limit: 180, window: 60 }],
  ["POST /api/logout", { auth: "optional", body: 0, limit: 180, window: 60 }],
  ["POST /api/account/logout-all", { auth: "user", body: 0, limit: 20, window: 60 }],
  ["POST /api/account/secret", { auth: "user", body: 4 * 1024, limit: 10, window: 600 }],
  ["POST /api/account/delete", { auth: "user", body: 2 * 1024, limit: 5, window: 600 }],
  ["GET /api/admin/users", { auth: "admin", limit: 120, window: 60 }],
  ["GET /api/admin/login-logs", { auth: "admin", limit: 120, window: 60 }],
  ["GET /api/admin/audit", { auth: "admin", limit: 120, window: 60 }],
  ["POST /api/admin/secret", { auth: "admin", body: 4 * 1024, limit: 60, window: 60 }],
  ["POST /api/admin/ban", { auth: "admin", body: 2 * 1024, limit: 60, window: 60 }],
  ["POST /api/admin/logout-user", { auth: "admin", body: 2 * 1024, limit: 60, window: 60 }],
  ["POST /api/admin/delete-user", { auth: "admin", body: 2 * 1024, limit: 30, window: 60 }],
  ["POST /api/admin/task12/import", { auth: "migration_admin", body: 512 * 1024, limit: 10, window: 60, import: true }],
  ["GET /api/admin/task12/import/status", { auth: "migration_admin", limit: 30, window: 60, import: true }],
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
  if (!maximumBytes) return {};
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task12Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task12Error("请求内容过大", 413, "request_too_large");
  try { return JSON.parse(new TextDecoder().decode(body) || "{}"); }
  catch (_) { throw new Task12Error("请求 JSON 格式无效", 400, "invalid_json"); }
}

function authenticationError(result, context) {
  if (result.status === 401) return apiError("authentication_required", "请先登录", 401, requestId(context));
  return apiError("account_unavailable", "账户不可用", result.status || 403, requestId(context));
}

async function cloudAuthentication(context, requirement) {
  if (requirement === "public" || requirement === "optional") return null;
  const result = await resolveTask12Account(context);
  if (!result.authenticated) return authenticationError(result, context);
  if (requirement === "admin" && !result.account.is_super_admin) {
    return apiError("forbidden", "无管理员权限", 403, requestId(context));
  }
  return result.account;
}

async function migrationAuthentication(context, flags) {
  if (flags.task12CloudAccounts) {
    const cloud = await resolveTask12Account(context, { touch: false }).catch(() => null);
    if (cloud?.authenticated && cloud.account.is_super_admin) return cloud.account;
  }
  const legacy = await resolveLegacyAccount(context);
  if (!legacy.authenticated) return authenticationError(legacy, context);
  if (!legacy.account.is_super_admin) return apiError("forbidden", "无管理员权限", 403, requestId(context));
  return legacy.account;
}

function loginSubject(context) {
  return String(context.request.headers.get("CF-Connecting-IP") || "anonymous").slice(0, 80);
}

const LEGACY_BUSINESS_ACCOUNT_FIELDS = Object.freeze([
  "membership", "membership_start", "membership_expires", "trial_language",
  "memberships", "entitlements", "membership_summary", "tools_access", "recharge_status",
]);

function mergeLegacyBusinessAccount(cloudAccount, legacyAccount) {
  if (!legacyAccount || String(legacyAccount.id || "") !== String(cloudAccount?.id || "")) return cloudAccount;
  const merged = { ...cloudAccount };
  for (const field of LEGACY_BUSINESS_ACCOUNT_FIELDS) {
    if (field in legacyAccount) merged[field] = legacyAccount[field];
  }
  return merged;
}

async function legacyBusinessJson(context, path, token, legacyProxy) {
  const url = new URL(path, context.request.url);
  const headers = new Headers(context.request.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Type");
  headers.set("Accept", "application/json");
  headers.set("X-Session-Token", token);
  const request = new Request(url, { method: "GET", headers });
  const response = await legacyProxy({
    ...context,
    request,
    cf: context.request.cf || context.cf || {},
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Task12Error("旧业务数据暂时不可用", 503, "task12_legacy_business_unavailable", true);
  }
  return payload;
}

async function loginFailureKey(context) {
  return await sha256Hex(`task12-login\u0000${loginSubject(context)}`);
}

async function loginFailureState(context) {
  const key = await loginFailureKey(context);
  const now = Math.floor(Date.now() / 1000);
  const row = await context.env.WYJ_DB.prepare(
    "SELECT failure_count, expires_at FROM task12_auth_failure_windows WHERE bucket_key = ?1",
  ).bind(key).first();
  if (!row || Number(row.expires_at) <= now) return { limited: false, key, now };
  return { limited: Number(row.failure_count) >= LOGIN_FAILURE_LIMIT, key, now, retryAfter: Number(row.expires_at) - now };
}

async function recordLoginFailure(context, state) {
  const expiresAt = state.now + LOGIN_FAILURE_WINDOW_SECONDS;
  await context.env.WYJ_DB.prepare(`INSERT INTO task12_auth_failure_windows (bucket_key, failure_count, expires_at)
    VALUES (?1, 1, ?2)
    ON CONFLICT(bucket_key) DO UPDATE SET
      failure_count = CASE WHEN task12_auth_failure_windows.expires_at <= ?3 THEN 1 ELSE failure_count + 1 END,
      expires_at = CASE WHEN task12_auth_failure_windows.expires_at <= ?3 THEN ?2 ELSE expires_at END`)
    .bind(state.key, expiresAt, state.now).run();
}

async function clearLoginFailures(context, state) {
  await context.env.WYJ_DB.prepare("DELETE FROM task12_auth_failure_windows WHERE bucket_key = ?1")
    .bind(state.key).run();
}

async function safeLoginAudit(context, username, success, reason, user = null) {
  try { await recordLoginEvent(context.env.WYJ_DB, username, success, reason, loginContext(context.request), user); }
  catch (_) { /* Audit storage failure must not disclose credentials or block authentication. */ }
}

async function executeRoute(context, descriptor, account, legacyProxy) {
  const path = new URL(context.request.url).pathname;
  const method = context.request.method.toUpperCase();
  const db = context.env.WYJ_DB;
  if (method === "GET") {
    if (path === "/api/me") {
      const legacy = await legacyBusinessJson(
        context, "/api/me", context.request.headers.get("X-Session-Token"), legacyProxy,
      );
      return response({ ok: true, account: mergeLegacyBusinessAccount(account, legacy.account) }, 200, context);
    }
    if (path === "/api/admin/users") {
      const cloudUsers = await listUsers(db, account);
      const legacy = await legacyBusinessJson(
        context, "/api/admin/users", context.request.headers.get("X-Session-Token"), legacyProxy,
      );
      const legacyById = new Map((legacy.users || []).map((item) => [String(item.id || ""), item]));
      return response({
        ok: true,
        users: cloudUsers.map((item) => mergeLegacyBusinessAccount(item, legacyById.get(item.id))),
      }, 200, context);
    }
    if (path === "/api/admin/login-logs") return response({ ok: true, logs: await listLoginAudit(db, account) }, 200, context);
    if (path === "/api/admin/audit") {
      const [cloudLogs, legacy] = await Promise.all([
        listAccountAudit(db, account),
        legacyBusinessJson(
          context, "/api/admin/audit", context.request.headers.get("X-Session-Token"), legacyProxy,
        ),
      ]);
      const logs = [...cloudLogs, ...(legacy.logs || [])]
        .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
        .slice(0, 500);
      return response({ ok: true, logs }, 200, context);
    }
    if (path === "/api/admin/task12/import/status") {
      return response({ ok: true, schema_version: TASK12_SCHEMA_VERSION, counts: await task12ImportCounts(db) }, 200, context);
    }
  }
  const payload = await readJson(context.request, descriptor.body);
  if (path === "/api/register") {
    requireAllowedFields(payload, new Set(["username", "secret", "confirm_secret"]));
    if (String(payload.secret || "") !== String(payload.confirm_secret || "")) {
      throw new Task12Error("两次输入的登录密钥不一致", 400, "secret_mismatch");
    }
    return response({ ok: true, account: await registerAccount(db, payload.username, payload.secret) }, 201, context);
  }
  if (path === "/api/login") {
    requireAllowedFields(payload, new Set(["username", "secret"]));
    const state = await loginFailureState(context);
    if (state.limited) {
      await safeLoginAudit(context, payload.username, false, "login_rate_limited");
      return apiError("login_rate_limited", "登录失败次数过多，请稍后再试", 429, requestId(context), {
        retryable: true, headers: { "Retry-After": String(Math.max(1, state.retryAfter || LOGIN_FAILURE_WINDOW_SECONDS)) },
      });
    }
    try {
      const result = await loginAccount(db, payload.username, payload.secret, context.request);
      await clearLoginFailures(context, state);
      await safeLoginAudit(context, payload.username, true, "success", result.account);
      let enriched = result.account;
      try {
        const legacy = await legacyBusinessJson(context, "/api/me", result.session, legacyProxy);
        enriched = mergeLegacyBusinessAccount(result.account, legacy.account);
      } catch (_) {
        enriched = { ...result.account, membership_state_unavailable: true };
      }
      return response({ ok: true, session: result.session, model: "Cloudflare account", account: enriched }, 200, context);
    } catch (error) {
      if (error instanceof Task12Error) {
        await recordLoginFailure(context, state);
        await safeLoginAudit(context, payload.username, false, error.code);
      }
      throw error;
    }
  }
  if (path === "/api/logout") {
    await logoutAccount(db, context.request.headers.get("X-Session-Token"));
    return response({ ok: true }, 200, context);
  }
  if (path === "/api/account/logout-all") {
    await logoutAllAccounts(db, account);
    return response({ ok: true, session_invalidated: true }, 200, context);
  }
  if (path === "/api/account/secret") {
    requireAllowedFields(payload, new Set(["current_secret", "new_secret", "confirm_secret"]));
    if ("confirm_secret" in payload && String(payload.new_secret || "") !== String(payload.confirm_secret || "")) {
      throw new Task12Error("两次输入的新登录密钥不一致", 400, "secret_mismatch");
    }
    await changeOwnSecret(db, account, payload.current_secret, payload.new_secret);
    return response({ ok: true, session_invalidated: true }, 200, context);
  }
  if (path === "/api/account/delete") {
    requireAllowedFields(payload, new Set(["secret"]));
    await deleteOwnAccount(db, account, payload.secret);
    return response({ ok: true, account_deleted: true }, 200, context);
  }
  const userId = String(payload.user_id || "");
  if (path === "/api/admin/secret") {
    requireAllowedFields(payload, new Set(["user_id", "secret"]));
    await adminResetSecret(db, account, userId, payload.secret);
    return response({ ok: true, session_invalidated: true }, 200, context);
  }
  if (path === "/api/admin/ban") {
    requireAllowedFields(payload, new Set(["user_id", "banned"]));
    await adminSetBan(db, account, userId, Boolean(payload.banned));
    return response({ ok: true, session_invalidated: Boolean(payload.banned) }, 200, context);
  }
  if (path === "/api/admin/logout-user") {
    requireAllowedFields(payload, new Set(["user_id"]));
    await adminForceLogout(db, account, userId);
    return response({ ok: true }, 200, context);
  }
  if (path === "/api/admin/delete-user") {
    requireAllowedFields(payload, new Set(["user_id"]));
    await adminDeleteUser(db, account, userId);
    return response({ ok: true }, 200, context);
  }
  if (path === "/api/admin/task12/import") {
    return response({ ok: true, ...await importTask12Batch(db, account, payload) }, 200, context);
  }
  throw new Task12Error("账户接口不存在", 404, "task12_route_not_found");
}

function cloudFailure(error, context) {
  const classification = classifyCloudError(error);
  return apiError(`task12_${classification}`, "云端账户服务暂时不可用，请稍后重试", 503, requestId(context), { retryable: true });
}

export async function handleTask12Request(context, legacyProxy) {
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
  if (descriptor.import) {
    if (!flags.task12Import) return apiError("task12_import_disabled", "Task 12 导入接口未启用", 404, requestId(context));
    if (String(context.env?.WYJ_ENVIRONMENT || "").toLowerCase() === "production") {
      const confirmed = context.request.headers.get("X-WYJ-Task12-Production-Confirm") === "TASK12-PRODUCTION-ACCOUNT-MIGRATION";
      if (!flags.task12ProductionImport || !confirmed) {
        return apiError("task12_production_import_confirmation_required", "Production 账户导入需要单独启用并明确确认", 403, requestId(context));
      }
    }
  } else if (!flags.task12CloudAccounts) {
    return legacyProxy(context);
  }

  if (!descriptor.import && !bridgeConfigured(context.env)) {
    return apiError(
      "task12_legacy_bridge_not_configured",
      "云端账户已启用，但旧业务身份桥尚未配置",
      503,
      requestId(context),
    );
  }

  try {
    if (!await ensureTask12Schema(context.env.WYJ_DB)) {
      throw new Task12Error("云端账户数据结构尚未就绪", 503, "task12_schema_not_ready", true);
    }
    const account = descriptor.auth === "migration_admin"
      ? await migrationAuthentication(context, flags)
      : await cloudAuthentication(context, descriptor.auth);
    if (account instanceof Response) return account;
    if (descriptor.limit) {
      const rate = await enforceD1RateLimit(context, {
        enabled: flags.d1RateLimit, limit: descriptor.limit, windowSeconds: descriptor.window,
        scope: `${method}:${url.pathname}`, subject: account?.id || undefined,
      });
      if (!rate.allowed) {
        return apiError("account_rate_limited", "账户操作过于频繁，请稍后再试", 429, requestId(context), {
          retryable: true, headers: { "Retry-After": String(rate.retryAfter || 60) },
        });
      }
    }
    return await executeRoute(context, descriptor, account, legacyProxy);
  } catch (error) {
    if (error instanceof Task12Error) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    console.error(JSON.stringify({
      event: "task12_cloud_error", request_id: requestId(context), route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    return cloudFailure(error, context);
  }
}

export const __testing = {
  METHODS_BY_PATH, ROUTES, clearLoginFailures, loginFailureState,
  readJson, recordLoginFailure,
};
