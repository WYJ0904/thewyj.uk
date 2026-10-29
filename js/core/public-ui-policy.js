const FLAG = 'p07_accessibility';
const MAX_AGE_MS = 30000;

/** A UI-only, short-lived public decision cannot grant account/business rights. */
export function parsePublicUiPolicy(value, now = Date.now()) {
  if (value?.schema_version !== 1 || value.flag_key !== FLAG || typeof value.enabled !== 'boolean' ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.reason !== 'string' ||
      value.max_age_seconds !== 30 || typeof value.observed_at !== 'string' || typeof value.expires_at !== 'string' ||
      value.enabled && value.reason !== 'public_stable') return null;
  const observed = Date.parse(value.observed_at), expires = Date.parse(value.expires_at);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || expires - observed !== MAX_AGE_MS ||
      observed > now + 5000 || expires <= now || value.enabled && value.revision === 0) return null;
  return Object.freeze({ enabled: value.enabled, expiresAt: Math.min(expires, now + MAX_AGE_MS) });
}

export function createPublicUiPolicyController({ apiGet, getAccount, document = globalThis.document, onChange = () => {},
  now = Date.now, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, events = globalThis }) {
  let snapshot = null, sequence = 0, expiry = null, renewal = null, disposed = false;
  let account = getAccount?.() || null;
  const loggedIn = () => Boolean(getAccount?.());
  function clear() {
    snapshot = null; clearTimer(expiry); clearTimer(renewal); expiry = renewal = null; onChange();
  }
  function schedule() {
    clearTimer(expiry); clearTimer(renewal);
    const remaining = Math.max(0, snapshot.expiresAt - now());
    expiry = setTimer(() => { sequence++; clear(); void refresh(); }, remaining);
    renewal = setTimer(() => { void refresh(); }, Math.max(1, remaining - Math.min(10000, remaining / 2)));
  }
  async function refresh() {
    if (disposed) return;
    if (loggedIn() || document?.hidden || globalThis.navigator?.onLine === false) { sequence++; clear(); return; }
    const ticket = ++sequence;
    if (!snapshot || snapshot.expiresAt <= now()) clear();
    try {
      const result = await apiGet('/api/ui/features');
      if (disposed || ticket !== sequence || loggedIn()) return;
      snapshot = parsePublicUiPolicy(result?.public_ui, now());
      if (!snapshot) { clear(); return; }
      onChange(); schedule();
    } catch (_) { if (!disposed && ticket === sequence && !loggedIn()) clear(); }
  }
  function updateAccount() {
    const next = getAccount?.() || null;
    if (next === account) return;
    account = next; sequence++; clear(); if (!next) void refresh();
  }
  const visibility = () => { sequence++; clear(); if (!document?.hidden) void refresh(); };
  const offline = () => { sequence++; clear(); };
  const online = () => void refresh();
  document?.addEventListener?.('visibilitychange', visibility);
  events?.addEventListener?.('offline', offline); events?.addEventListener?.('online', online);
  return Object.freeze({ refresh, updateAccount,
    enabled: () => !disposed && !loggedIn() && snapshot?.enabled === true && snapshot.expiresAt > now(),
    dispose() { disposed = true; sequence++; clear(); document?.removeEventListener?.('visibilitychange', visibility);
      events?.removeEventListener?.('offline', offline); events?.removeEventListener?.('online', online); } });
}
