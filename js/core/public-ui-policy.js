const FLAG = 'p07_accessibility';
const MAX_AGE_MS = 30000;

/** A UI-only, short-lived public decision cannot grant account/business rights. */
export function parsePublicUiPolicy(value, now = Date.now()) {
  if (value?.schema_version !== 1 || value.flag_key !== FLAG || typeof value.enabled !== 'boolean' ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.reason !== 'string' ||
      value.max_age_seconds !== 30 || typeof value.observed_at !== 'string' || typeof value.expires_at !== 'string' ||
      (value.enabled && value.reason !== 'public_stable')) return null;
  const observed = Date.parse(value.observed_at), expires = Date.parse(value.expires_at);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || expires - observed !== MAX_AGE_MS ||
      observed > now + 5000 || expires <= now || (value.enabled && value.revision === 0)) return null;
  return Object.freeze({ enabled: value.enabled, expiresAt: Math.min(expires, now + MAX_AGE_MS), reason: value.reason, revision: value.revision });
}

export function createPublicUiPolicyController({ apiGet, getAccount, hasSession = () => Boolean(getAccount?.()), document = globalThis.document, onChange = () => {},
  now = Date.now, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, events = globalThis }) {
  let snapshot = null, sequence = 0, expiry = null, renewal = null, disposed = false;
  let owner = String(getAccount?.()?.id || ''), sessionPresent = hasSession(), phase = 'pending', error = '';
  const loggedIn = () => hasSession();
  const valid = () => Boolean(snapshot && snapshot.expiresAt > now());
  function clear(next = 'pending', message = '') {
    snapshot = null; phase = next; error = message;
    clearTimer(expiry); clearTimer(renewal); expiry = renewal = null; onChange();
  }
  function schedule() {
    clearTimer(expiry); clearTimer(renewal);
    const remaining = Math.max(0, snapshot.expiresAt - now());
    expiry = setTimer(() => { sequence++; clear('pending'); void refresh(); }, remaining);
    renewal = setTimer(() => { void refresh(); }, Math.max(1, remaining - Math.min(10000, remaining / 2)));
  }
  async function refresh() {
    if (disposed) return;
    if (loggedIn()) { sequence++; clear('pending'); return; }
    if (globalThis.navigator?.onLine === false) { sequence++; clear('error', '当前离线，界面体验已安全回退。'); return; }
    if (document?.hidden) { if (!valid()) clear('pending'); else onChange(); return; }
    const ticket = ++sequence;
    if (!valid()) clear('pending');
    try {
      const result = await apiGet('/api/ui/features');
      if (disposed || ticket !== sequence || loggedIn()) return;
      snapshot = parsePublicUiPolicy(result?.public_ui, now());
      if (!snapshot) throw new Error('界面设置响应无效');
      phase = snapshot.enabled ? 'enabled' : 'disabled'; error = '';
      onChange(); schedule();
    } catch (failure) { if (!disposed && ticket === sequence && !loggedIn()) clear('error', failure?.message || '界面设置读取失败'); }
  }
  function updateAccount() {
    const next = String(getAccount?.()?.id || ''), nextSession = hasSession();
    if (next === owner && nextSession === sessionPresent) return;
    owner = next; sessionPresent = nextSession; sequence++; clear('pending'); if (!nextSession) void refresh();
  }
  const visibility = () => { sequence++; if (!valid()) clear('pending'); else onChange(); if (!document?.hidden) void refresh(); };
  const offline = () => { sequence++; clear('error', '当前离线，界面体验已安全回退。'); };
  const online = () => void refresh();
  document?.addEventListener?.('visibilitychange', visibility);
  events?.addEventListener?.('offline', offline); events?.addEventListener?.('online', online);
  return Object.freeze({ refresh, updateAccount,
    enabled: () => !disposed && !document?.hidden && !loggedIn() && valid() && snapshot.enabled === true,
    // Presentation may retain a still-valid in-memory decision while the tab is
    // hidden. This never grants business rights or extends the server's TTL.
    decision: () => Object.freeze({ status: disposed || loggedIn() ? 'pending' : valid() ? (snapshot.enabled ? 'enabled' : 'disabled') : phase === 'error' ? 'error' : 'pending',
      reason: valid() ? snapshot.reason : error, revision: valid() ? snapshot.revision : null, expiresAt: valid() ? snapshot.expiresAt : null }),
    dispose() { disposed = true; sequence++; clear(); document?.removeEventListener?.('visibilitychange', visibility);
      events?.removeEventListener?.('offline', offline); events?.removeEventListener?.('online', online); } });
}
