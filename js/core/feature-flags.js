export const RELEASE_CHANNEL_LABELS = Object.freeze({ stable: 'Stable', beta: 'Beta', experimental: 'Experimental' });

/** Unknown, expired, malformed and other-account decisions are always OFF. */
export function parseFeatureSnapshot(value, accountId, now = Date.now()) {
  if (!accountId || value?.schema_version !== 1 || value.account_id !== accountId ||
      !Object.hasOwn(RELEASE_CHANNEL_LABELS, value.channel) || !Number.isSafeInteger(value.channel_revision) || value.channel_revision < 0 ||
      !value.flags || typeof value.flags !== 'object' || Array.isArray(value.flags) ||
      !Number.isFinite(value.max_age_seconds) || value.max_age_seconds <= 0 || value.max_age_seconds > 30) return null;
  const expires = Math.min(Date.parse(value.expires_at), now + value.max_age_seconds * 1000);
  if (!Number.isFinite(expires) || expires <= now || Object.keys(value.flags).length > 200) return null;
  const flags = Object.create(null);
  for (const [key, result] of Object.entries(value.flags)) {
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(key) || typeof result?.enabled !== 'boolean' ||
        !Number.isSafeInteger(result.revision) || result.revision < 1 || typeof result.reason !== 'string') return null;
    flags[key] = Object.freeze({ enabled: result.enabled, reason: result.reason, revision: result.revision });
  }
  return Object.freeze({ accountId, channel: value.channel, channelRevision: value.channel_revision,
    expiresAt: expires, flags: Object.freeze(flags) });
}

export function snapshotFeatureEnabled(snapshot, key, accountId, now = Date.now()) {
  return Boolean(snapshot && snapshot.accountId === accountId && snapshot.expiresAt > now &&
    Object.hasOwn(snapshot.flags, key) && snapshot.flags[key].enabled === true);
}

export function createFeatureController({ getAccount, apiGet, api, document = globalThis.document, onAvailable = () => {}, onChange = () => {} }) {
  let available = false, accountId = '', snapshot = null, sequence = 0, timer = null, busy = false, status = '';
  const node = id => document.getElementById(id);
  const currentId = () => String(getAccount()?.id || '');
  function render(message) {
    if (message !== undefined) status = message;
    node('releaseChannelSection')?.classList.toggle('hidden', !available || !accountId);
    node('releaseChannelSelect')?.toggleAttribute('disabled', busy || !snapshot);
    node('saveReleaseChannelBtn')?.toggleAttribute('disabled', busy || !snapshot);
    if (snapshot && node('releaseChannelSelect')) node('releaseChannelSelect').value = snapshot.channel;
    if (node('releaseChannelStatus')) node('releaseChannelStatus').textContent = status || (snapshot ? `当前通道：${RELEASE_CHANNEL_LABELS[snapshot.channel]}` : '正在读取体验设置…');
    node('experimentalFeatureBadge')?.classList.toggle('hidden', !snapshotFeatureEnabled(snapshot, 'aeris_experimental_badge', accountId));
    onChange();
  }
  function clear(message = '') { snapshot = null; clearTimeout(timer); timer = null; render(message); }
  function scheduleExpiry() {
    timer = setTimeout(() => { clear(); void refresh(); }, Math.max(0, snapshot.expiresAt - Date.now()));
  }
  async function refresh() {
    if (!available || !accountId || document.hidden || globalThis.navigator?.onLine === false) { clear(); return; }
    const ticket = ++sequence, owner = accountId;
    busy = false; clear();
    try {
      const response = await apiGet('/api/features');
      if (ticket !== sequence || owner !== currentId()) return;
      snapshot = parseFeatureSnapshot(response.snapshot, owner);
      if (!snapshot) throw new Error('体验设置响应无效，所有预览功能已关闭');
      render(''); scheduleExpiry();
    } catch (error) { if (ticket === sequence && owner === currentId()) clear(error.message || '读取失败，预览功能已关闭'); }
  }
  function updateAccount() {
    const next = currentId(); if (next === accountId) return;
    accountId = next; sequence++; busy = false; clear(); onAvailable(available && Boolean(accountId));
    if (node('releaseChannelSelect')) node('releaseChannelSelect').value = 'stable';
    if (accountId) void refresh();
  }
  function setAvailable(enabled) {
    if (available === (enabled === true)) return;
    available = enabled === true; sequence++; busy = false; clear(); onAvailable(available && Boolean(accountId));
    if (available) void refresh();
  }
  node('saveReleaseChannelBtn')?.addEventListener('click', async () => {
    if (busy || !snapshot) return;
    const owner = accountId, ticket = ++sequence, channel = node('releaseChannelSelect').value;
    const expected_revision = snapshot.channelRevision;
    busy = true; clear('正在保存…');
    try {
      const response = await api('/api/release-channel', { channel, expected_revision });
      if (owner !== currentId() || ticket !== sequence) return;
      snapshot = parseFeatureSnapshot(response.snapshot, owner);
      if (!snapshot) throw new Error('体验设置响应无效');
      render('体验通道已保存'); scheduleExpiry();
    } catch (error) { if (owner === currentId() && ticket === sequence) clear(error.message); }
    finally { if (ticket === sequence) { busy = false; render(); } }
  });
  node('refreshReleaseChannelBtn')?.addEventListener('click', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    sequence++; busy = false; if (document.hidden) clear(); else void refresh();
  });
  globalThis.addEventListener?.('offline', () => { sequence++; busy = false; clear('当前离线，预览功能已关闭'); });
  globalThis.addEventListener?.('online', () => void refresh());
  return Object.freeze({ setAvailable, updateAccount, refresh,
    enabled: key => snapshotFeatureEnabled(snapshot, key, currentId()), channel: () => snapshot?.channel || 'stable' });
}
