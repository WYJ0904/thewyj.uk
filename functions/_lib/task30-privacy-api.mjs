import {
  apiError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
  sameOriginResult,
} from './cloudflare-foundation.mjs';
import { authorizeFileMaintenance } from './secure-file-maintenance.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { clearWebDownloadSessionCookies, clearTask20AccessCookie } from './task20-model.mjs';
import {
  CONSENT_DEFINITIONS,
  DEVICE_OS_PERMISSIONS_DISCLOSURE,
  ESSENTIAL_SERVICE_PROCESSING,
  PRIVACY_CATEGORY_ORDER,
  PRIVACY_DATA_CATALOG,
  PrivacyError,
  TASK30_CATALOG_VERSION,
  TASK30_PRIVACY_POLICY_BASELINE,
} from './task30-privacy-catalog.mjs';
import {
  cancelPrivacyErasureRequest,
  commitPrivacyErasure,
  getPrivacyConsents,
  getPrivacyOverview,
  getPrivacyRequestDetail,
  getPrivacyRequests,
  previewPrivacyErasure,
  retryPrivacyErasureRequest,
  runPrivacyRetentionCleanup,
  updatePrivacyConsent,
} from './task30-privacy-service.mjs';

const ROUTES = Object.freeze([
  'GET /api/privacy/v1/catalog',
  'GET /api/privacy/v1/overview',
  'GET /api/privacy/v1/consents',
  'POST /api/privacy/v1/consents',
  'POST /api/privacy/v1/erasure/preview',
  'POST /api/privacy/v1/erasure/commit',
  'POST /api/privacy/v1/erasure/cancel',
  'POST /api/privacy/v1/erasure/retry',
  'GET /api/privacy/v1/requests',
  'GET /api/privacy/v1/requests/detail',
  'POST /api/privacy/v1/cleanup/run',
]);

async function readJsonPayload(request, maximum = 16384) {
  const ct = String(request.headers.get('Content-Type') || '');
  if (!/^application\/json(?:\s*;|$)/i.test(ct)) {
    throw new PrivacyError('json_content_type_required', '请使用 application/json 请求体', 415);
  }
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maximum) {
    throw new PrivacyError('request_too_large', '请求体超过允许大小', 413);
  }
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) {
          await reader.cancel();
          throw new PrivacyError('request_too_large', '请求体超过允许大小', 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes) || '{}');
  } catch {
    throw new PrivacyError('invalid_json', 'JSON 格式无效', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PrivacyError('invalid_json', '请提供有效的 JSON 对象', 400);
  }
  return parsed;
}

async function isTask30FeatureEnabled(env) {
  const flags = featureFlags(env);
  if (!flags.task30Privacy || !flags.cloudFoundation) return false;
  if (!env?.WYJ_DB) return false;
  try {
    const flagRow = await env.WYJ_DB.prepare(
      "SELECT enabled, kill_switch FROM task25_feature_flags WHERE flag_key = 'task30_privacy_v1'",
    ).first();
    if (flagRow && (Number(flagRow.enabled) === 0 || Number(flagRow.kill_switch) === 1)) {
      return false;
    }
  } catch {
    /* Optional flag table in minimal environments */
  }
  return true;
}

export async function handleTask30Request(context) {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  if (!url.pathname.startsWith('/api/privacy/v1/')) return null;

  const requestId = String(context.data?.requestId || '');
  try {
    if (!sameOriginResult(context.request).allowed) {
      throw new PrivacyError('cross_origin_rejected', '隐私控制接口仅接受同源请求', 403);
    }
    if (!(await isTask30FeatureEnabled(context.env))) {
      throw new PrivacyError('privacy_feature_disabled', '隐私控制与安全删除功能当前已停用', 503, { retryable: true });
    }

    const routeKey = `${method} ${url.pathname}`;
    if (!ROUTES.includes(routeKey)) {
      const pathExists = ROUTES.some((r) => r.endsWith(` ${url.pathname}`));
      if (pathExists) {
        throw new PrivacyError('method_not_allowed', '请求方法不支持', 405);
      }
      throw new PrivacyError('privacy_route_not_found', '隐私控制接口不存在', 404);
    }

    if (routeKey === 'GET /api/privacy/v1/catalog') {
      return jsonResponse(
        {
          ok: true,
          policy_version: TASK30_PRIVACY_POLICY_BASELINE,
          catalog_version: TASK30_CATALOG_VERSION,
          categories: PRIVACY_CATEGORY_ORDER.map((key) => PRIVACY_DATA_CATALOG[key]),
          consents: CONSENT_DEFINITIONS,
          device_permissions_disclosure: DEVICE_OS_PERMISSIONS_DISCLOSURE,
          essential_processing: ESSENTIAL_SERVICE_PROCESSING,
        },
        200,
        requestId,
        { 'Cache-Control': 'private, no-store' },
      );
    }

    const auth = await resolveTask12Account(context);
    if (!auth.authenticated || !auth.account) {
      return apiError(auth.code || 'unauthorized', '请先登录有效账户后访问隐私控制中心', auth.status || 401, requestId);
    }

    const flags = featureFlags(context.env);
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: method === 'GET' ? 90 : 30,
      windowSeconds: 60,
      scope: `privacy-v1:${url.pathname}`,
      subject: auth.account.id,
    });
    if (!rate.allowed) {
      return apiError('privacy_rate_limited', '操作过于频繁，请稍后重试', 429, requestId, {
        retryable: true,
        headers: { 'Retry-After': String(rate.retryAfter || 60) },
      });
    }

    const headers = { 'Cache-Control': 'private, no-store' };

    if (routeKey === 'GET /api/privacy/v1/overview') {
      const overview = await getPrivacyOverview(context, auth.account);
      return jsonResponse({ ok: true, ...overview }, 200, requestId, headers);
    }

    if (routeKey === 'GET /api/privacy/v1/consents') {
      const consents = await getPrivacyConsents(context, auth.account);
      return jsonResponse({ ok: true, ...consents }, 200, requestId, headers);
    }

    if (routeKey === 'POST /api/privacy/v1/consents') {
      const payload = await readJsonPayload(context.request, 4096);
      const updated = await updatePrivacyConsent(context, auth.account, payload);
      return jsonResponse({ ok: true, ...updated }, 200, requestId, headers);
    }

    if (routeKey === 'POST /api/privacy/v1/erasure/preview') {
      const payload = await readJsonPayload(context.request, 8192);
      const preview = await previewPrivacyErasure(context, auth.account, payload);
      return jsonResponse({ ok: true, preview }, 200, requestId, headers);
    }

    if (routeKey === 'POST /api/privacy/v1/erasure/commit') {
      const payload = await readJsonPayload(context.request, 8192);
      const result = await commitPrivacyErasure(context, auth.account, payload);
      if (result.account_deleted) {
        return jsonResponse(
          { ok: true, ...result },
          200,
          requestId,
          {
            ...headers,
            'Set-Cookie': [clearTask20AccessCookie(), ...clearWebDownloadSessionCookies(context.request)],
          },
        );
      }
      return jsonResponse({ ok: true, ...result }, 200, requestId, headers);
    }

    if (routeKey === 'POST /api/privacy/v1/erasure/cancel') {
      const payload = await readJsonPayload(context.request, 4096);
      const cancelled = await cancelPrivacyErasureRequest(context, auth.account, payload.request_id);
      return jsonResponse({ ok: true, ...cancelled }, 200, requestId, headers);
    }

    if (routeKey === 'POST /api/privacy/v1/erasure/retry') {
      const payload = await readJsonPayload(context.request, 4096);
      const retried = await retryPrivacyErasureRequest(context, auth.account, payload.request_id, payload);
      return jsonResponse({ ok: true, ...retried }, 200, requestId, headers);
    }

    if (routeKey === 'GET /api/privacy/v1/requests') {
      const list = await getPrivacyRequests(context, auth.account, {
        limit: url.searchParams.get('limit'),
        status: url.searchParams.get('status'),
      });
      return jsonResponse({ ok: true, ...list }, 200, requestId, headers);
    }

    if (routeKey === 'GET /api/privacy/v1/requests/detail') {
      const detail = await getPrivacyRequestDetail(context, auth.account, url.searchParams.get('request_id'));
      return jsonResponse({ ok: true, ...detail }, 200, requestId, headers);
    }

    if (routeKey === 'POST /api/privacy/v1/cleanup/run') {
      if (!auth.account.is_owner) {
        throw new PrivacyError('forbidden', '定期全球数据保留清理仅限站点所有者/维护身份执行', 403);
      }
      await authorizeFileMaintenance(context, auth.account);
      const payload = await readJsonPayload(context.request, 4096);
      const runResult = await runPrivacyRetentionCleanup(context, {
        triggerSource: 'api',
        triggeredBy: auth.account.id,
        limit: payload.limit,
        forceRetry: Boolean(payload.force_retry),
      });
      return jsonResponse({ ok: true, cleanup: runResult }, 200, requestId, headers);
    }

    throw new PrivacyError('privacy_route_not_found', '隐私控制接口不存在', 404);
  } catch (error) {
    if (error?.name === 'PrivacyError' || (error?.code && typeof error?.status === 'number')) {
      return apiError(error.code, error.message, error.status, requestId, {
        retryable: Boolean(error.retryable),
      });
    }
    console.error(
      JSON.stringify({
        event: 'task30_privacy_error',
        request_id: requestId,
        error_name: String(error?.name || 'Error'),
      }),
    );
    return apiError('privacy_service_unavailable', '隐私控制服务暂不可用，请稍后重试', 503, requestId, {
      retryable: true,
    });
  }
}
