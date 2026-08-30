import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { importTask13Batch, task13ImportCounts } from "./task13-import.mjs";
import {
  TASK13_SCHEMA_VERSION,
  Task13Error,
  requireAllowedFields,
} from "./task13-model.mjs";
import {
  adminManageMembership,
  adminSetEntitlementOverride,
  cancelPaymentOrder,
  confirmPaymentOrder,
  createPaymentOrder,
  ensureTask13Schema,
  listAdminPaymentOrders,
  listMembershipPlans,
  listUserPaymentOrders,
  paymentQrAsset,
  processPaymentOrder,
  publicPaymentMethods,
} from "./task13-service.mjs";

const ROUTES = new Map([
  ["GET /api/membership/plans", { mode: "read", auth: "public", limit: 120, window: 60 }],
  ["GET /api/recharge/mine", { mode: "read", auth: "user", limit: 120, window: 60 }],
  ["GET /api/recharge/qr", { mode: "read", auth: "user", limit: 60, window: 60 }],
  ["POST /api/recharge/request", { mode: "write", auth: "user", limit: 10, window: 60, body: 4 * 1024 }],
  ["POST /api/recharge/confirm", { mode: "write", auth: "user", limit: 20, window: 60, body: 2 * 1024 }],
  ["POST /api/recharge/cancel", { mode: "write", auth: "user", limit: 20, window: 60, body: 2 * 1024 }],
  ["GET /api/admin/recharge", { mode: "read", auth: "admin", limit: 120, window: 60 }],
  ["POST /api/admin/recharge/process", { mode: "write", auth: "admin", limit: 60, window: 60, body: 4 * 1024 }],
  ["POST /api/admin/membership/manage", { mode: "write", auth: "admin", limit: 60, window: 60, body: 8 * 1024 }],
  ["POST /api/admin/membership", { mode: "write", auth: "admin", limit: 60, window: 60, body: 4 * 1024 }],
  ["POST /api/admin/entitlement", { mode: "write", auth: "admin", limit: 60, window: 60, body: 4 * 1024 }],
  ["POST /api/admin/task13/import", { mode: "import", auth: "owner", limit: 10, window: 60, body: 512 * 1024 }],
  ["GET /api/admin/task13/import/status", { mode: "import", auth: "owner", limit: 30, window: 60 }],
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
  if (!maximumBytes) return {};
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task13Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task13Error("请求内容过大", 413, "request_too_large");
  try {
    const payload = JSON.parse(new TextDecoder().decode(body) || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch (_) {
    throw new Task13Error("请求 JSON 格式无效", 400, "invalid_json");
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
  if (requirement === "owner" && !result.account.is_super_admin) {
    return apiError("owner_required", "只有站点所有者可以执行此操作", 403, requestId(context));
  }
  if (requirement === "admin" && !result.account.is_admin) {
    return apiError("forbidden", "无管理员权限", 403, requestId(context));
  }
  return result.account;
}

function legacyMembershipInput(payload) {
  const membership = String(payload.membership || "free").trim();
  const map = Object.freeze({
    free: { action: "cancel_all", plan_code: "trial_single_language" },
    trial_single_language: { action: "grant", plan_code: "trial_single_language" },
    monthly: { action: "grant", plan_code: "legacy_all_monthly" },
    lifetime: { action: "grant", plan_code: "legacy_all_lifetime" },
  });
  const selected = map[membership];
  if (!selected) throw new Task13Error("会员等级无效", 400, "membership_invalid");
  return {
    ...selected,
    user_id: payload.user_id,
    membership_start: payload.membership_start,
    membership_expires: payload.membership_expires,
    trial_language: payload.trial_language,
    note: "兼容旧管理员会员接口",
    allow_compatible: true,
  };
}

async function executeRoute(context, descriptor, account) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const method = context.request.method.toUpperCase();
  const db = context.env.WYJ_DB;
  if (method === "GET") {
    if (path === "/api/membership/plans") {
      return response({ ok: true, plans: await listMembershipPlans(db), payment_methods: publicPaymentMethods() }, 200, context);
    }
    if (path === "/api/recharge/mine") {
      return response({ ok: true, requests: await listUserPaymentOrders(db, account) }, 200, context);
    }
    if (path === "/api/recharge/qr") {
      const requestIdValue = url.searchParams.get("request_id") || "";
      const asset = await paymentQrAsset(db, context.env.WYJ_STORAGE, account, requestIdValue);
      const headers = new Headers({
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "Content-Length": String(asset.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      });
      if (asset.etag) headers.set("ETag", asset.etag);
      return new Response(asset.bytes, { status: 200, headers });
    }
    if (path === "/api/admin/recharge") {
      return response({ ok: true, requests: await listAdminPaymentOrders(db) }, 200, context);
    }
    if (path === "/api/admin/task13/import/status") {
      return response({
        ok: true,
        schema_version: TASK13_SCHEMA_VERSION,
        counts: await task13ImportCounts(db),
      }, 200, context);
    }
  }

  const payload = await readJson(context.request, descriptor.body);
  if (path === "/api/recharge/request") {
    requireAllowedFields(payload, new Set(["plan", "payment_method", "trial_language"]));
    const result = await createPaymentOrder(db, account, payload);
    return response({ ok: true, ...result }, result.created ? 201 : 200, context);
  }
  if (path === "/api/recharge/confirm") {
    requireAllowedFields(payload, new Set(["request_id"]));
    return response({ ok: true, request: await confirmPaymentOrder(db, account, payload.request_id) }, 200, context);
  }
  if (path === "/api/recharge/cancel") {
    requireAllowedFields(payload, new Set(["request_id"]));
    return response({ ok: true, request: await cancelPaymentOrder(db, account, payload.request_id) }, 200, context);
  }
  if (path === "/api/admin/recharge/process") {
    requireAllowedFields(payload, new Set(["request_id", "action", "admin_note"]));
    const status = await processPaymentOrder(db, account, payload.request_id, payload.action, payload.admin_note);
    return response({ ok: true, status }, 200, context);
  }
  if (path === "/api/admin/membership/manage") {
    requireAllowedFields(payload, new Set([
      "user_id", "action", "plan_code", "membership_start", "membership_expires",
      "note", "preserve_japanese", "trial_language",
    ]));
    return response({ ok: true, user: await adminManageMembership(db, account, payload) }, 200, context);
  }
  if (path === "/api/admin/membership") {
    requireAllowedFields(payload, new Set([
      "user_id", "membership", "membership_start", "membership_expires", "trial_language",
    ]));
    return response({
      ok: true,
      user: await adminManageMembership(db, account, legacyMembershipInput(payload)),
    }, 200, context);
  }
  if (path === "/api/admin/entitlement") {
    requireAllowedFields(payload, new Set(["user_id", "entitlement", "allowed", "note"]));
    return response({ ok: true, user: await adminSetEntitlementOverride(db, account, payload) }, 200, context);
  }
  if (path === "/api/admin/task13/import") {
    return response({ ok: true, ...await importTask13Batch(db, account, payload) }, 200, context);
  }
  throw new Task13Error("会员与支付接口不存在", 404, "task13_route_not_found");
}

function featureEnabled(descriptor, flags) {
  if (descriptor.mode === "read") return flags.task13CloudReads;
  if (descriptor.mode === "write") return flags.task13CloudWrites && flags.task13PaymentPrimary;
  return flags.task13Import;
}

function cloudFailure(error, context) {
  const classification = classifyCloudError(error);
  const message = classification === "quota_exhausted"
    ? "云端免费额度暂时不可用，请稍后重试"
    : "云端会员与支付服务暂时不可用，请稍后重试";
  return apiError(`task13_${classification}`, message, 503, requestId(context), { retryable: true });
}

function productionImportAllowed(context, flags) {
  if (String(context.env?.WYJ_ENVIRONMENT || "").toLowerCase() !== "production") return true;
  return flags.task13ProductionImport
    && context.request.headers.get("X-WYJ-Task13-Production-Confirm") === "TASK13-PRODUCTION-MEMBERSHIP-PAYMENT-MIGRATION";
}

export async function handleTask13Request(context) {
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
    const code = descriptor.mode === "import" ? "task13_import_disabled" : "task13_cloud_not_enabled";
    return apiError(code, "云端会员与支付服务当前未启用", 503, requestId(context), { retryable: false });
  }
  if (descriptor.mode === "import" && !productionImportAllowed(context, flags)) {
    return apiError(
      "task13_production_import_confirmation_required",
      "Production 会员与支付导入需要单独启用并明确确认",
      403,
      requestId(context),
    );
  }

  try {
    if (!await ensureTask13Schema(context.env.WYJ_DB)) {
      throw new Task13Error("云端会员与支付数据结构尚未就绪", 503, "task13_schema_not_ready", true);
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
      return apiError("task13_rate_limited", "会员与支付操作过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true,
        headers: { "Retry-After": String(rate.retryAfter || 60) },
      });
    }
    return await executeRoute(context, descriptor, account);
  } catch (error) {
    if (error instanceof Task13Error) {
      return apiError(error.code, error.message, error.status, requestId(context), {
        retryable: error.retryable,
        details: error.committed ? { committed: true } : undefined,
      });
    }
    console.error(JSON.stringify({
      event: "task13_cloud_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    return cloudFailure(error, context);
  }
}

export const __testing = {
  METHODS_BY_PATH,
  ROUTES,
  featureEnabled,
  legacyMembershipInput,
  readJson,
};
