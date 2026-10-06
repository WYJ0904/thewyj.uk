import { apiError, classifyCloudError, enforceD1RateLimit, featureFlags, jsonResponse } from './cloudflare-foundation.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { Task25Error } from './task25-model.mjs';
import { ensureTask25Schema, listFlags, readFeatureSnapshot, saveFlag, setFlagOverride, setReleasePreference, simulateFlags } from './task25-service.mjs';

const ROUTES = new Map([
  ['GET /api/features', 'user'],
  ['GET /api/release-channel', 'user'],
  ['POST /api/release-channel', 'user'],
  ['GET /api/admin/feature-flags', 'admin'],
  ['POST /api/admin/feature-flags', 'admin'],
  ['POST /api/admin/feature-flags/override', 'admin'],
  ['POST /api/admin/feature-flags/evaluate', 'admin'],
]);

async function readJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 8192) throw new Task25Error('请求内容过大', 413, 'request_too_large');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 8192) throw new Task25Error('请求内容过大', 413, 'request_too_large');
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw new Task25Error('请求 JSON 格式无效', 400, 'invalid_json'); }
}

export async function handleTask25Request(context) {
  const url = new URL(context.request.url), method = context.request.method.toUpperCase();
  const auth = ROUTES.get(`${method} ${url.pathname}`), id = context.data?.requestId || '';
  if (!auth) {
    const allowed = [...ROUTES.keys()].filter(key => key.endsWith(` ${url.pathname}`)).map(key => key.split(' ')[0]);
    return allowed.length ? apiError('method_not_allowed', '此接口不支持当前请求方法', 405, id, { headers: { Allow: allowed.join(', ') } }) : null;
  }
  const flags = featureFlags(context.env);
  if (!flags.task25FeatureFlags) return apiError('task25_disabled', '体验通道服务尚未启用', 503, id, { retryable: true });
  try {
    if (!flags.task12CloudAccounts) throw new Task25Error('云端账户服务尚未启用', 503, 'task25_dependency_unavailable');
    const authenticated = await resolveTask12Account(context, { touch: false });
    if (!authenticated.authenticated) return apiError(authenticated.code, '请使用有效账户登录', authenticated.status, id);
    const actor = authenticated.account;
    if (auth === 'admin' && !actor.is_admin) throw new Task25Error('无管理员权限', 403, 'forbidden');
    if (!await ensureTask25Schema(context.env.WYJ_DB)) throw new Task25Error('体验通道服务尚未就绪', 503, 'task25_schema_not_ready');
    if (url.search) throw new Task25Error('此接口不接受查询参数');
    const rate = await enforceD1RateLimit(context, { enabled: flags.d1RateLimit, limit: method === 'GET' ? 120 : 30,
      windowSeconds: 60, scope: `task25:${method}:${url.pathname}`, subject: actor.id });
    if (!rate.allowed) return apiError('task25_rate_limited', '操作过于频繁，请稍后重试', 429, id,
      { retryable: true, headers: { 'Retry-After': String(rate.retryAfter || 60) } });
    const db = context.env.WYJ_DB;
    let result;
    if (method === 'GET' && url.pathname === '/api/admin/feature-flags') result = await listFlags(db, actor);
    else if (method === 'GET') {
      const snapshot = await readFeatureSnapshot(db, actor.id);
      result = url.pathname === '/api/features' ? { snapshot } : { channel: snapshot.channel, revision: snapshot.channel_revision };
    } else {
      const input = await readJson(context.request);
      if (url.pathname === '/api/release-channel') {
        await setReleasePreference(db, actor, input);
        result = { snapshot: await readFeatureSnapshot(db, actor.id) };
      } else if (url.pathname === '/api/admin/feature-flags') result = { flag: await saveFlag(db, actor, input, id) };
      else if (url.pathname === '/api/admin/feature-flags/override') result = { override: await setFlagOverride(db, actor, input, id) };
      else result = { snapshot: await simulateFlags(db, actor, input), simulation: true };
    }
    return jsonResponse({ ok: true, ...result }, 200, id, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (error instanceof Task25Error) return apiError(error.code, error.message, error.status, id, { retryable: error.status >= 500 });
    console.error(JSON.stringify({ event: 'task25_error', request_id: id, kind: classifyCloudError(error) }));
    return apiError('task25_unavailable', '体验通道服务暂时不可用', 503, id, { retryable: true });
  }
}
