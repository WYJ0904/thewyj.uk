import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { publicUiDecision, handlePublicUiRequest } from '../../functions/_lib/p07-ui-api.mjs';
import { onRequest } from '../../functions/api/[[path]].js';
import { parsePublicUiPolicy, createPublicUiPolicyController } from '../../js/core/public-ui-policy.js';

const instant = Date.parse('2026-10-28T00:00:00Z');
const row = () => ({ flag_key: 'p07_accessibility', enabled: 1, kill_switch: 0,
  channels_json: '["stable","beta","experimental"]', rollout_basis_points: 10000, revision: 1 });
test('public UI default missing is OFF, with no account authority', () => {
  const result = publicUiDecision(null, instant);assert.equal(result.enabled, false);assert.equal(result.revision, 0);
  assert.equal(result.max_age_seconds, 30);assert(!('account_id' in result));
});
test('only complete stable public rollout is ON', () => {
  assert.equal(publicUiDecision(row(), instant).enabled, true);
});
for (const [name, patch] of [
  ['kill switch', { kill_switch: 1 }], ['global OFF', { enabled: 0 }], ['Beta-only', { channels_json: '["beta"]' }],
  ['partial rollout', { rollout_basis_points: 9999 }], ['zero rollout', { rollout_basis_points: 0 }],
  ['invalid amount', { rollout_basis_points: 10001 }], ['boolean coercion', { enabled: '1' }],
  ['duplicate channels', { channels_json: '["stable","stable"]' }], ['malformed channels', { channels_json: '{' }],
  ['wrong feature', { flag_key: 'adaptive_review' }], ['bad revision', { revision: -1 }],
]) test(`public UI rejects ${name}`, () => assert.equal(publicUiDecision({ ...row(), ...patch }, instant).enabled, false));

test('client validates fresh exact public policy', () => assert.equal(parsePublicUiPolicy(publicUiDecision(row(), instant), instant).enabled, true));
for (const [name, patch] of [
  ['wrong key', { flag_key: 'adaptive_review' }], ['wrong schema', { schema_version: 2 }], ['coerced enabled', { enabled: 'true' }],
  ['missing revision proof', { revision: 0 }], ['contradictory kill reason', { reason: 'kill_switch' }],
  ['extended TTL', { max_age_seconds: 60 }], ['future clock', { observed_at: new Date(instant + 6000).toISOString(), expires_at: new Date(instant + 36000).toISOString() }],
  ['overlong validity', { expires_at: new Date(instant + 30001).toISOString() }],
]) test(`client fails closed on ${name}`, () => assert.equal(parsePublicUiPolicy({ ...publicUiDecision(row(), instant), ...patch }, instant), null));
test('client rejects expired decision independently of timers', () => assert.equal(parsePublicUiPolicy(publicUiDecision(row(), instant), instant + 30001), null));

function fixture(apiGet) {
  let time = instant, account = null, id = 0;
  const timers = new Map(), listeners = new Map();
  const document = { hidden: false, addEventListener: (k, f) => listeners.set('doc:' + k, f), removeEventListener: k => listeners.delete('doc:' + k) };
  const events = { addEventListener: (k, f) => listeners.set(k, f), removeEventListener: k => listeners.delete(k) };
  const controller = createPublicUiPolicyController({ apiGet, getAccount: () => account, document, events,
    now: () => time, setTimer: (f, delay) => { timers.set(++id, { f, at: time + delay });return id; }, clearTimer: key => timers.delete(key) });
  return { controller, document, timers, listeners, setTime: value => time = value, setAccount: value => account = value,
    emit: key => listeners.get(key)?.() };
}
const response = enabled => ({ public_ui: publicUiDecision({ ...row(), enabled: Number(enabled) }, instant) });
test('guest uses fresh policy and deadline cannot be prolonged by delayed timers', async () => {
  const f = fixture(async () => response(true));await f.controller.refresh();assert.equal(f.controller.enabled(), true);
  f.setTime(instant + 30001);assert.equal(f.controller.enabled(), false);f.controller.dispose();assert.equal(f.timers.size, 0);
});
test('network error clears a previously valid guest decision', async () => {
  let fail = false;const f = fixture(async () => { if (fail) throw Error('synthetic network loss');return response(true); });
  await f.controller.refresh();fail = true;await f.controller.refresh();assert.equal(f.controller.enabled(), false);f.controller.dispose();
});
test('a retired backend missing the optional public endpoint remains OFF', async () => {
  const f = fixture(async () => { throw Object.assign(new Error('Legacy endpoint is absent'), { status: 404 }); });
  await f.controller.refresh();
  assert.equal(f.controller.enabled(), false);
  assert.equal(f.timers.size, 0);
  f.controller.dispose();
});
test('login invalidates guest request and cannot be overridden by late public ON', async () => {
  let resolve;const f = fixture(() => new Promise(r => resolve = r));const pending = f.controller.refresh();
  f.setAccount({ id: 'synthetic-account' });f.controller.updateAccount();resolve(response(true));await pending;
  assert.equal(f.controller.enabled(), false);f.controller.dispose();
});
test('old overlapping public request cannot replace a newer kill response', async () => {
  let resolve, count = 0;const f = fixture(() => ++count === 1 ? new Promise(r => resolve = r) : response(false));
  const first = f.controller.refresh();await f.controller.refresh();resolve(response(true));await first;
  assert.equal(f.controller.enabled(), false);f.controller.dispose();
});
test('offline and hidden-page signals revoke current guest authority', async () => {
  const f = fixture(async () => response(true));await f.controller.refresh();f.emit('offline');assert.equal(f.controller.enabled(), false);
  await f.controller.refresh();f.document.hidden = true;f.emit('doc:visibilitychange');assert.equal(f.controller.enabled(), false);f.controller.dispose();
});
test('disposal removes listeners and discards pending callback', async () => {
  let resolve;const f = fixture(() => new Promise(r => resolve = r));const pending = f.controller.refresh();f.controller.dispose();
  resolve(response(true));await pending;assert.equal(f.controller.enabled(), false);assert.equal(f.listeners.size, 0);assert.equal(f.timers.size, 0);
});

test('actual D1/public dispatch is read-only and preserves authenticated route access control', async t => {
  const root = path.resolve(import.meta.dirname, '../..');await fs.mkdir(path.join(root, '.wrangler'), { recursive: true });
  const runtime = await fs.mkdtemp(path.join(root, '.wrangler/aeris-public-policy-'));
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("fixture")}}', compatibilityDate: '2026-08-06', d1Databases: ['WYJ_DB'], d1Persist: runtime });
  try {
    const db = await mf.getD1Database('WYJ_DB');
    for (const name of (await fs.readdir(path.join(root, 'cloudflare/migrations'))).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort())
      await db.exec((await fs.readFile(path.join(root, 'cloudflare/migrations', name), 'utf8')).replace(/\r?\n/g, ' '));
    const queries = [], observed = { prepare(sql) { queries.push(sql);return db.prepare(sql); } };
    const env = { WYJ_DB: observed, TASK25_FEATURE_FLAGS_ENABLED: 'true', TASK12_CLOUD_ACCOUNTS_ENABLED: 'true', D1_RATE_LIMIT_ENABLED: 'false' };
    async function request(route = '/api/ui/features', method = 'GET', environment = env) {
      const response = await onRequest({ request: new Request('https://preview.thewyj.uk' + route, { method }), env: environment, data: { requestId: 'synthetic-public-ui' } });
      return { status: response.status, headers: response.headers, body: await response.json() };
    }
    await t.test('unauthenticated public read has default OFF and no user-data query', async () => {
      const result = await request();assert.equal(result.status, 200);assert.equal(result.body.public_ui.enabled, false);
      assert.equal(result.headers.get('Cache-Control'), 'no-store');assert(!JSON.stringify(result.body).includes('account_id'));
      assert(queries.every(sql => /^SELECT /i.test(sql) && !/task12_|override|release_preferences|finance/i.test(sql)));
    });
    await db.prepare('INSERT INTO task25_feature_flags(flag_key,description,enabled,kill_switch,channels_json,rollout_basis_points,updated_at) VALUES (?1,?2,1,0,?3,10000,?4)').bind('p07_accessibility', 'synthetic', '["stable"]', new Date().toISOString()).run();
    await t.test('global public ON then kill is reflected without account/session writes', async () => {
      assert.equal((await request()).body.public_ui.enabled, true);
      await db.prepare('UPDATE task25_feature_flags SET kill_switch=1, revision=revision+1 WHERE flag_key=?1').bind('p07_accessibility').run();
      assert.equal((await request()).body.public_ui.enabled, false);
    });
    await t.test('arbitrary query and writes are denied', async () => {
      assert.equal((await request('/api/ui/features?user_id=another')).status, 400);
      assert.equal((await request('/api/ui/features', 'POST')).status, 405);
      assert.equal((await request('/api/ui/features', 'DELETE')).status, 405);
    });
    await t.test('private feature/admin APIs still require authentication', async () => {
      assert.equal((await request('/api/features')).status, 401);
      assert.equal((await request('/api/admin/feature-flags')).status, 401);
    });
    await t.test('server disable and missing binding fail closed', async () => {
      assert.equal((await request('/api/ui/features', 'GET', { ...env, TASK25_FEATURE_FLAGS_ENABLED: 'false' })).status, 503);
      assert.equal((await request('/api/ui/features', 'GET', { ...env, WYJ_DB: undefined })).status, 503);
    });
  } finally { await mf.dispose(); }
});
