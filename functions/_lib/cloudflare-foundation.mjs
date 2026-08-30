import { passwordPepperConfigured } from "./task12-crypto.mjs";
import { temporarySecretConfigured } from "./task14-crypto.mjs";
import { TASK15_AI_MODEL, TASK15_BUILD } from "./task15-model.mjs";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const SAFE_API_METHODS = new Set(["GET", "HEAD"]);
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_RATE_WINDOW_SECONDS = 60;

const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function integerValue(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function featureFlags(env = {}) {
  const requestedMode = String(env.CLOUD_STATUS_MODE || "cloud").trim().toLowerCase();
  const cloudReads = booleanValue(env.CLOUD_READS_ENABLED, false);
  const cloudWrites = booleanValue(env.CLOUD_WRITES_ENABLED, false);
  return {
    cloudFoundation: booleanValue(env.CLOUD_FOUNDATION_ENABLED, false),
    cloudReads,
    cloudWrites,
    task11CloudReads: booleanValue(env.TASK11_CLOUD_READS_ENABLED, cloudReads),
    task11CloudWrites: booleanValue(env.TASK11_CLOUD_WRITES_ENABLED, cloudWrites),
    task12CloudAccounts: booleanValue(env.TASK12_CLOUD_ACCOUNTS_ENABLED, false),
    task12Import: booleanValue(env.TASK12_IMPORT_ENABLED, false),
    task12ProductionImport: booleanValue(env.TASK12_PRODUCTION_IMPORT_ENABLED, false),
    task13CloudReads: booleanValue(env.TASK13_CLOUD_READS_ENABLED, false),
    task13CloudWrites: booleanValue(env.TASK13_CLOUD_WRITES_ENABLED, false),
    task13Import: booleanValue(env.TASK13_IMPORT_ENABLED, false),
    task13ProductionImport: booleanValue(env.TASK13_PRODUCTION_IMPORT_ENABLED, false),
    task13PaymentPrimary: booleanValue(env.TASK13_PAYMENT_PRIMARY_ENABLED, false),
    task14CloudReads: booleanValue(env.TASK14_CLOUD_READS_ENABLED, false),
    task14CloudWrites: booleanValue(env.TASK14_CLOUD_WRITES_ENABLED, false),
    task14Import: booleanValue(env.TASK14_IMPORT_ENABLED, false),
    task14ProductionImport: booleanValue(env.TASK14_PRODUCTION_IMPORT_ENABLED, false),
    task14TemporaryPrimary: booleanValue(env.TASK14_TEMPORARY_PRIMARY_ENABLED, false),
    task14LegacyWritesFrozen: booleanValue(env.TASK14_LEGACY_WRITES_FROZEN, false),
    task15CloudOnly: booleanValue(env.TASK15_CLOUD_ONLY_ENABLED, false),
    task15Import: booleanValue(env.TASK15_IMPORT_ENABLED, false),
    task15ProductionImport: booleanValue(env.TASK15_PRODUCTION_IMPORT_ENABLED, false),
    task16CloudReads: booleanValue(env.TASK16_CLOUD_READS_ENABLED, false),
    task16CloudWrites: booleanValue(env.TASK16_CLOUD_WRITES_ENABLED, false),
    task16Import: booleanValue(env.TASK16_IMPORT_ENABLED, false),
    task16ProductionImport: booleanValue(env.TASK16_PRODUCTION_IMPORT_ENABLED, false),
    task18AdminMessages: booleanValue(env.TASK18_ADMIN_MESSAGES_ENABLED, false),
    legacyFallback: booleanValue(env.LEGACY_API_FALLBACK_ENABLED, false),
    workersAi: booleanValue(env.WORKERS_AI_ENABLED, false),
    d1RateLimit: booleanValue(env.D1_RATE_LIMIT_ENABLED, true),
    deepHealthChecks: booleanValue(env.CLOUD_DEEP_HEALTH_CHECKS, false),
    statusMode: requestedMode === "cloud" ? "cloud" : "legacy",
    rateLimit: integerValue(env.CLOUD_RATE_LIMIT_REQUESTS, DEFAULT_RATE_LIMIT, 10, 600),
    rateWindowSeconds: integerValue(
      env.CLOUD_RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_RATE_WINDOW_SECONDS,
      10,
      300,
    ),
  };
}

export function statusSourceFor(request, env = {}) {
  const requested = new URL(request.url).searchParams.get("source")?.trim().toLowerCase() || "";
  if (requested === "cloud" || requested === "legacy") return requested;
  return featureFlags(env).statusMode;
}

export function requestIdFor(request) {
  const supplied = String(request?.headers?.get("X-Request-ID") || "").trim();
  if (REQUEST_ID_PATTERN.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export function jsonResponse(payload, status = 200, requestId = "", extraHeaders = {}) {
  const body = requestId && !payload.request_id ? { ...payload, request_id: requestId } : payload;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function apiError(code, message, status, requestId, options = {}) {
  return jsonResponse(
    {
      ok: false,
      error: message,
      code,
      retryable: Boolean(options.retryable),
      ...(options.details && typeof options.details === "object" ? options.details : {}),
    },
    status,
    requestId,
    options.headers || {},
  );
}

export function sameOriginResult(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/") || SAFE_API_METHODS.has(request.method.toUpperCase())) {
    return { allowed: true, reason: "safe_request" };
  }

  const origin = String(request.headers.get("Origin") || "").trim();
  if (origin) {
    try {
      return new URL(origin).origin === url.origin
        ? { allowed: true, reason: "matching_origin" }
        : { allowed: false, reason: "origin_mismatch" };
    } catch (_) {
      return { allowed: false, reason: "invalid_origin" };
    }
  }

  const fetchSite = String(request.headers.get("Sec-Fetch-Site") || "").trim().toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return { allowed: false, reason: `fetch_site_${fetchSite}` };
  }
  return { allowed: true, reason: "non_browser_or_origin_omitted" };
}

export function withSecurityHeaders(response, requestId, isApi = false) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set("X-Request-ID", requestId);
  if (isApi && !headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  const contentType = String(headers.get("Content-Type") || "").toLowerCase();
  if (!isApi && contentType.includes("text/html")) {
    const cacheControl = String(headers.get("Cache-Control") || "public, max-age=0, must-revalidate");
    if (!/(?:^|,)\s*no-transform\s*(?:,|$)/iu.test(cacheControl)) {
      headers.set("Cache-Control", `${cacheControl}, no-transform`);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function classifyCloudError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/quota|limit|exceed|too many|daily.*(?:read|write)/.test(message)) return "quota_exhausted";
  if (/binding|not found|no such table|database/.test(message)) return "binding_unavailable";
  return "temporarily_unavailable";
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function enforceD1RateLimit(context, options = {}) {
  const enabled = options.enabled !== false;
  if (!enabled) return { allowed: true, enabled: false, degraded: false };
  if (!context.env?.WYJ_DB?.prepare) {
    return { allowed: true, enabled: true, degraded: true, reason: "binding_unavailable" };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = integerValue(options.windowSeconds, DEFAULT_RATE_WINDOW_SECONDS, 10, 3600);
  const limit = integerValue(options.limit, DEFAULT_RATE_LIMIT, 1, 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const expiresAt = windowStart + windowSeconds;
  const url = new URL(context.request.url);
  const defaultSubject = String(
    context.request.headers.get("CF-Connecting-IP")
      || context.request.headers.get("X-Forwarded-For")?.split(",")[0]
      || "anonymous",
  ).trim();
  const subject = String(options.subject || defaultSubject).slice(0, 160);
  const scope = String(options.scope || url.pathname).slice(0, 120);
  const route = `${url.pathname}:${scope}`.slice(0, 160);
  const keyHash = await sha256Hex(`${scope}\u0000${subject}\u0000${windowStart}`);

  try {
    const row = await context.env.WYJ_DB.prepare(
      `INSERT INTO cloud_rate_limit_windows
        (bucket_key, route, window_started_at, expires_at, request_count)
       VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET
         request_count = cloud_rate_limit_windows.request_count + 1,
         expires_at = excluded.expires_at
       WHERE cloud_rate_limit_windows.request_count <= ?5
       RETURNING request_count, expires_at`,
      ).bind(keyHash, route, windowStart, expiresAt, limit).first();

    // Deterministic sampling keeps stale rows bounded without doubling D1 writes on every request.
    if (keyHash.endsWith("00") || keyHash.endsWith("01")) {
      const cleanup = context.env.WYJ_DB.prepare(
        "DELETE FROM cloud_rate_limit_windows WHERE expires_at < ?1",
      ).bind(now - 3600).run().catch(() => undefined);
      if (typeof context.waitUntil === "function") context.waitUntil(cleanup);
      else await cleanup;
    }

    const count = row ? Number(row.request_count || 1) : limit + 1;
    return {
      allowed: count <= limit,
      enabled: true,
      degraded: false,
      count,
      limit,
      retryAfter: Math.max(1, expiresAt - now),
    };
  } catch (error) {
    return {
      allowed: true,
      enabled: true,
      degraded: true,
      reason: classifyCloudError(error),
    };
  }
}

export async function enforceCloudRateLimit(context, flags = featureFlags(context.env)) {
  return enforceD1RateLimit(context, {
    enabled: flags.d1RateLimit,
    limit: flags.rateLimit,
    windowSeconds: flags.rateWindowSeconds,
    scope: new URL(context.request.url).pathname,
  });
}

async function bindingHealth(env, flags) {
  const bindings = {
    d1: Boolean(env?.WYJ_DB?.prepare),
    r2: Boolean(env?.WYJ_STORAGE),
    workers_ai: Boolean(env?.AI),
  };
  const degraded = [];
  const task11 = { schema_ready: false, schema_version: "" };
  const task12 = {
    schema_ready: false,
    schema_version: "",
    session_strategy: "invalidate_legacy_sessions",
    password_pepper_configured: passwordPepperConfigured(env?.WYJ_TASK12_PASSWORD_PEPPER),
  };
  const task13 = { schema_ready: false, schema_version: "", payment_primary: flags.task13PaymentPrimary };
  const task14 = {
    schema_ready: false,
    schema_version: "",
    temporary_primary: flags.task14TemporaryPrimary,
    secret_configured: temporarySecretConfigured(env?.WYJ_TASK14_TEMPORARY_SECRET),
  };
  const task15 = { schema_ready: false, schema_version: "", cloud_only: flags.task15CloudOnly };
  const task16 = {
    schema_ready: false,
    schema_version: "",
    cloud_reads: flags.task16CloudReads,
    cloud_writes: flags.task16CloudWrites,
  };
  const task18 = {
    schema_ready: false,
    schema_version: "",
    enabled: flags.task18AdminMessages,
    owner_count: 0,
  };
  if (!bindings.d1) degraded.push("d1_binding_missing");
  if (!bindings.r2) degraded.push("r2_binding_missing");
  if (flags.workersAi && !bindings.workers_ai) degraded.push("workers_ai_binding_missing");

  if (flags.deepHealthChecks && bindings.d1) {
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM cloud_runtime_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      if (String(row?.value || "") !== "1") degraded.push("d1_schema_not_ready");
    } catch (error) {
      degraded.push(`d1_${classifyCloudError(error)}`);
    }
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM task11_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      task11.schema_version = String(row?.value || "");
      task11.schema_ready = task11.schema_version === "1";
      if (!task11.schema_ready && (flags.task11CloudReads || flags.task11CloudWrites)) {
        degraded.push("task11_schema_not_ready");
      }
    } catch (error) {
      if (flags.task11CloudReads || flags.task11CloudWrites) {
        degraded.push(`task11_${classifyCloudError(error)}`);
      }
    }
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM task12_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      task12.schema_version = String(row?.value || "");
      task12.schema_ready = task12.schema_version === "1";
      if (!task12.schema_ready && flags.task12CloudAccounts) degraded.push("task12_schema_not_ready");
    } catch (error) {
      if (flags.task12CloudAccounts) degraded.push(`task12_${classifyCloudError(error)}`);
    }
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM task13_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      task13.schema_version = String(row?.value || "");
      task13.schema_ready = task13.schema_version === "1";
      if (!task13.schema_ready && (
        flags.task13CloudReads || flags.task13CloudWrites || flags.task13PaymentPrimary
      )) degraded.push("task13_schema_not_ready");
    } catch (error) {
      if (flags.task13CloudReads || flags.task13CloudWrites || flags.task13PaymentPrimary) {
        degraded.push(`task13_${classifyCloudError(error)}`);
      }
    }
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM task14_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      task14.schema_version = String(row?.value || "");
      task14.schema_ready = task14.schema_version === "1";
      if (!task14.schema_ready && (
        flags.task14CloudReads || flags.task14CloudWrites || flags.task14TemporaryPrimary
      )) degraded.push("task14_schema_not_ready");
    } catch (error) {
      if (flags.task14CloudReads || flags.task14CloudWrites || flags.task14TemporaryPrimary) {
        degraded.push(`task14_${classifyCloudError(error)}`);
      }
    }
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM task15_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      task15.schema_version = String(row?.value || "");
      task15.schema_ready = task15.schema_version === "1";
      if (!task15.schema_ready && flags.task15CloudOnly) degraded.push("task15_schema_not_ready");
    } catch (error) {
      if (flags.task15CloudOnly) degraded.push(`task15_${classifyCloudError(error)}`);
    }
    try {
      const row = await env.WYJ_DB.prepare(
        "SELECT value FROM task16_metadata WHERE key = ?1",
      ).bind("schema_version").first();
      task16.schema_version = String(row?.value || "");
      task16.schema_ready = task16.schema_version === "1";
      if (!task16.schema_ready && (flags.task16CloudReads || flags.task16CloudWrites)) {
        degraded.push("task16_schema_not_ready");
      }
    } catch (error) {
      if (flags.task16CloudReads || flags.task16CloudWrites) {
        degraded.push(`task16_${classifyCloudError(error)}`);
      }
    }
    try {
      const [metadata, owner] = await env.WYJ_DB.batch([
        env.WYJ_DB.prepare("SELECT value FROM task18_metadata WHERE key = ?1").bind("schema_version"),
        env.WYJ_DB.prepare("SELECT COUNT(*) AS count FROM task12_users WHERE role = 'super_admin' AND banned = 0 AND deleted = 0"),
      ]);
      task18.schema_version = String(metadata?.results?.[0]?.value || "");
      task18.owner_count = Number(owner?.results?.[0]?.count || 0);
      task18.schema_ready = task18.schema_version === "1" && task18.owner_count === 1;
      if (!task18.schema_ready && flags.task18AdminMessages) degraded.push("task18_schema_not_ready");
    } catch (error) {
      if (flags.task18AdminMessages) degraded.push(`task18_${classifyCloudError(error)}`);
    }
  }
  if (flags.task12CloudAccounts && !task12.password_pepper_configured) {
    degraded.push("task12_password_pepper_not_configured");
  }
  if (flags.task13PaymentPrimary && !bindings.r2) degraded.push("task13_r2_binding_missing");
  if (flags.task14TemporaryPrimary && !bindings.r2) degraded.push("task14_r2_binding_missing");
  if (flags.task14TemporaryPrimary && !task14.secret_configured) {
    degraded.push("task14_temporary_secret_not_configured");
  }
  return { bindings, degraded, task11, task12, task13, task14, task15, task16, task18 };
}

export async function cloudStatusResponse(context) {
  const requestId = context.data?.requestId || requestIdFor(context.request);
  const flags = featureFlags(context.env);
  const rate = await enforceCloudRateLimit(context, flags);
  if (!rate.allowed) {
    return apiError("rate_limited", "请求过于频繁，请稍后重试。", 429, requestId, {
      retryable: true,
      headers: { "Retry-After": String(rate.retryAfter || flags.rateWindowSeconds) },
    });
  }

  const health = await bindingHealth(context.env, flags);
  const degraded = [...health.degraded];
  if (rate.degraded) degraded.push(`rate_limit_${rate.reason}`);
  const payload = {
    ok: true,
    status: degraded.length ? "degraded" : "ok",
    service: "wyj-cloud-foundation",
    environment: String(context.env?.WYJ_ENVIRONMENT || "development"),
    build: TASK15_BUILD,
    time: new Date().toISOString(),
    auth: Boolean(flags.task12CloudAccounts && health.task12.schema_ready),
    backend_ready: Boolean(flags.task12CloudAccounts && health.task12.schema_ready),
    ai_ready: Boolean(flags.workersAi && health.bindings.workers_ai),
    model: flags.workersAi ? TASK15_AI_MODEL : "Cloudflare rules only",
    bindings: health.bindings,
    task11: health.task11,
    task12: health.task12,
    task13: health.task13,
    task14: health.task14,
    task15: health.task15,
    task16: health.task16,
    task18: health.task18,
    features: {
      cloud_foundation: flags.cloudFoundation,
      cloud_reads: flags.cloudReads,
      cloud_writes: flags.cloudWrites,
      task11_cloud_reads: flags.task11CloudReads,
      task11_cloud_writes: flags.task11CloudWrites,
      task12_cloud_accounts: flags.task12CloudAccounts,
      task12_import: flags.task12Import,
      task12_password_pepper: health.task12.password_pepper_configured,
      task13_cloud_reads: flags.task13CloudReads,
      task13_cloud_writes: flags.task13CloudWrites,
      task13_import: flags.task13Import,
      task13_payment_primary: flags.task13PaymentPrimary,
      task14_cloud_reads: flags.task14CloudReads,
      task14_cloud_writes: flags.task14CloudWrites,
      task14_import: flags.task14Import,
      task14_temporary_primary: flags.task14TemporaryPrimary,
      task14_legacy_writes_frozen: flags.task14LegacyWritesFrozen,
      task14_temporary_secret: health.task14.secret_configured,
      workers_ai: flags.workersAi,
      task15_cloud_only: flags.task15CloudOnly,
      task16_cloud_reads: flags.task16CloudReads,
      task16_cloud_writes: flags.task16CloudWrites,
      task16_import: flags.task16Import,
      task18_admin_messages: flags.task18AdminMessages,
      legacy_api_fallback: flags.legacyFallback,
      payment_cloud_migration: flags.task13PaymentPrimary,
    },
    rate_limit: {
      enabled: rate.enabled,
      degraded: rate.degraded,
      limit: flags.rateLimit,
      window_seconds: flags.rateWindowSeconds,
    },
    degraded_reasons: degraded,
  };
  if (context.request.method.toUpperCase() === "HEAD") {
    const response = jsonResponse(payload, 200, requestId);
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return jsonResponse(payload, 200, requestId);
}

export async function statusRouteResponse(context) {
  const flags = featureFlags(context.env);
  const requestId = context.data?.requestId || requestIdFor(context.request);
  if (statusSourceFor(context.request, context.env) === "legacy") {
    return apiError("legacy_status_retired", "本机后端状态接口已退役", 410, requestId);
  }
  if (!flags.cloudFoundation) {
    return apiError("cloud_foundation_disabled", "云端基础设施当前未启用。", 404, requestId);
  }
  if (!["GET", "HEAD"].includes(context.request.method.toUpperCase())) {
    return apiError("method_not_allowed", "此状态接口只支持 GET 和 HEAD。", 405, requestId, {
      headers: { Allow: "GET, HEAD" },
    });
  }
  return cloudStatusResponse(context);
}

export async function cloudMiddleware(context) {
  const requestId = requestIdFor(context.request);
  if (context.data) context.data.requestId = requestId;
  const url = new URL(context.request.url);
  const isApi = url.pathname.startsWith("/api/");
  const origin = sameOriginResult(context.request);
  if (!origin.allowed) {
    return withSecurityHeaders(
      apiError("cross_origin_rejected", "此 API 只接受同源请求。", 403, requestId),
      requestId,
      isApi,
    );
  }

  try {
    return withSecurityHeaders(await context.next(), requestId, isApi);
  } catch (error) {
    console.error(JSON.stringify({
      event: "pages_function_error",
      request_id: requestId,
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    return withSecurityHeaders(
      apiError("internal_error", "服务暂时不可用，请稍后重试。", 500, requestId, { retryable: true }),
      requestId,
      isApi,
    );
  }
}

export const __testing = {
  bindingHealth,
  booleanValue,
  integerValue,
  sha256Hex,
};
