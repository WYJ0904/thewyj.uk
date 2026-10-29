import { apiError, enforceD1RateLimit, featureFlags, jsonResponse } from './cloudflare-foundation.mjs';
import { RELEASE_CHANNELS, TASK25_SNAPSHOT_TTL_SECONDS } from './task25-model.mjs';
import { ensureTask25Schema } from './task25-service.mjs';

export const PUBLIC_UI_FLAG = 'p07_accessibility';
const PUBLIC_UI_ROUTE = 'GET /api/ui/features';

/** Public UI has no account identity; percentage rollouts remain account-only. */
export function publicUiDecision(row, now = Date.now()) {
  let enabled = false, reason = row ? 'invalid_configuration' : 'missing', revision = 0;
  if (row?.flag_key === PUBLIC_UI_FLAG && Number.isSafeInteger(row.revision) && row.revision > 0) {
    revision = row.revision;
    try {
      const channels = JSON.parse(row.channels_json);
      const valid = Array.isArray(channels) && channels.length <= 3 && new Set(channels).size === channels.length &&
        channels.every(x => RELEASE_CHANNELS.includes(x)) && [0, 1].includes(row.enabled) && [0, 1].includes(row.kill_switch) &&
        Number.isInteger(row.rollout_basis_points) && row.rollout_basis_points >= 0 && row.rollout_basis_points <= 10000;
      if (valid) {
        if (row.kill_switch === 1) reason = 'kill_switch';
        else if (row.enabled !== 1) reason = 'global_off';
        else if (!channels.includes('stable')) reason = 'channel_excluded';
        else if (row.rollout_basis_points !== 10000) reason = 'account_only_rollout';
        else { enabled = true; reason = 'public_stable'; }
      }
    } catch (_) { /* Malformed configuration remains OFF. */ }
  }
  return { schema_version: 1, flag_key: PUBLIC_UI_FLAG, enabled, revision, reason,
    observed_at: new Date(now).toISOString(), expires_at: new Date(now + TASK25_SNAPSHOT_TTL_SECONDS * 1000).toISOString(),
    max_age_seconds: TASK25_SNAPSHOT_TTL_SECONDS };
}

/** Only one non-sensitive presentation decision, never user/channel/override data. */
export async function handlePublicUiRequest(context) {
  const url = new URL(context.request.url), id = context.data?.requestId || '';
  if (url.pathname !== PUBLIC_UI_ROUTE.slice(4)) return null;
  if (context.request.method.toUpperCase() !== 'GET') return apiError('method_not_allowed', '此接口只支持读取', 405, id, { headers: { Allow: 'GET' } });
  if (url.search) return apiError('p07_invalid_query', '此接口不接受查询参数', 400, id);
  const flags = featureFlags(context.env);
  if (!flags.task25FeatureFlags) return apiError('p07_ui_unavailable', '界面配置暂不可用', 503, id, { retryable: true });
  try {
    if (!await ensureTask25Schema(context.env.WYJ_DB)) return apiError('p07_ui_unavailable', '界面配置暂不可用', 503, id, { retryable: true });
    const rate = await enforceD1RateLimit(context, { enabled: flags.d1RateLimit, limit: 120, windowSeconds: 60, scope: 'p07:public-ui' });
    if (!rate.allowed) return apiError('p07_ui_rate_limited', '读取过于频繁', 429, id,
      { retryable: true, headers: { 'Retry-After': String(rate.retryAfter || 60) } });
    const row = await context.env.WYJ_DB.prepare('SELECT flag_key, enabled, kill_switch, channels_json, rollout_basis_points, revision FROM task25_feature_flags WHERE flag_key = ?1').bind(PUBLIC_UI_FLAG).first();
    return jsonResponse({ ok: true, public_ui: publicUiDecision(row) }, 200, id, { 'Cache-Control': 'no-store' });
  } catch (_) {
    return apiError('p07_ui_unavailable', '界面配置暂不可用', 503, id, { retryable: true });
  }
}
