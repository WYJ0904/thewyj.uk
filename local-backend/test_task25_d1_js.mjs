import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { onRequest as dispatch } from '../functions/api/[[path]].js';
import { cloudMiddleware } from '../functions/_lib/cloudflare-foundation.mjs';
import { hashSecret, sessionStorageKey } from '../functions/_lib/task12-crypto.mjs';
import { evaluateFlag, deterministicBucket, flagDefinition } from '../functions/_lib/task25-model.mjs';
import { readFeatureSnapshot } from '../functions/_lib/task25-service.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const runtime = await mkdtemp(path.join(os.tmpdir(), 'task25-'));
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } }',
  compatibilityDate: '2026-08-06', d1Databases: ['WYJ_DB'], d1Persist: runtime });
const users = {
  owner: { id: 'task25-owner', role: 'super_admin', token: 'task25-owner-token' },
  one: { id: 'task25-one', role: 'user', token: 'task25-one-token' },
  two: { id: 'task25-two', role: 'user', token: 'task25-two-token' },
};
const env = { TASK12_CLOUD_ACCOUNTS_ENABLED: 'true', TASK18_ADMIN_MESSAGES_ENABLED: 'true',
  TASK20_ANDROID_APP_ENABLED: 'true', TASK25_FEATURE_FLAGS_ENABLED: 'true', D1_RATE_LIMIT_ENABLED: 'false',
  WYJ_ENVIRONMENT: 'preview' };
let completed = 0;
const check = label => { completed++; console.log(`PASS ${completed}: ${label}`); };

try {
  const db = await mf.getD1Database('WYJ_DB');
  for (const file of (await readdir(path.join(ROOT, 'cloudflare/migrations'))).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    await db.exec((await readFile(path.join(ROOT, 'cloudflare/migrations', file), 'utf8')).replace(/\r?\n/g, ' '));
  }
  const now = new Date().toISOString();
  for (const user of Object.values(users)) {
    await db.prepare(`INSERT INTO task12_users(id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
      VALUES (?1, ?1, ?1, '', 'reset_required', 0, ?2, ?3, ?3, ?3, ?3)`).bind(user.id, user.role, now).run();
    await db.prepare(`INSERT INTO task12_sessions(token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind)
      VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`).bind(await sessionStorageKey(user.token), user.id, now, new Date(Date.now() + 86400000).toISOString()).run();
  }
  async function request(route, { user = users.one, method = 'GET', body, headers = {}, environment = {}, middleware = false } = {}) {
    const h = new Headers(headers);
    if (user) h.set('X-Session-Token', user.token);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const context = { env: { ...env, WYJ_DB: db, ...environment }, data: { requestId: crypto.randomUUID() },
      request: new Request(`https://preview.thewyj.uk${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }) };
    context.next = () => dispatch(context);
    const response = await (middleware ? cloudMiddleware(context) : dispatch(context));
    return { status: response.status, headers: response.headers, payload: await response.json() };
  }
  const get = async (user = users.one) => {
    const result = await request('/api/features', { user });
    assert.equal(result.status, 200, JSON.stringify(result.payload)); return result.payload.snapshot;
  };
  const save = async (input, status = 200) => {
    const result = await request('/api/admin/feature-flags', { method: 'POST', user: users.owner, body: input });
    assert.equal(result.status, status, JSON.stringify(result.payload)); return result.payload.flag;
  };
  let flag = await save({ flag_key: 'task25_test', expected_revision: 0 });
  assert.equal(flag.enabled, false); assert.deepEqual(flag.channels, ['experimental']);
  assert.equal((await get()).flags.task25_test.reason, 'global_off');
  assert.ok(Object.values((await get()).flags).every(v => !v.enabled));
  check('default OFF and default Stable');

  const migration = await readFile(path.join(ROOT, 'cloudflare/migrations/0024_feature_flags_release_channels.sql'), 'utf8');
  await db.exec(migration.replace(/\r?\n/g, ' '));
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM task25_feature_flags').first()).count, 3);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM task25_flag_audit').first()).count, 1);
  check('migration replay preserves records and does not duplicate seeds or audit');

  // API accepts definition fields only, so use a projection rather than sending response metadata.
  const change = async patch => {
    const { flag_key, description, enabled, kill_switch, channels, rollout_percentage, revision } = flag;
    flag = await save({ flag_key, description, enabled, kill_switch, channels, rollout_percentage, ...patch, expected_revision: revision });
  };
  await change({ enabled: true, channels: ['stable', 'beta', 'experimental'] });
  assert.equal((await get()).flags.task25_test.enabled, true); check('global ON at 100%');
  await change({ channels: ['beta'] });
  assert.equal((await get()).flags.task25_test.reason, 'channel_excluded');
  let pref = await request('/api/release-channel', { method: 'POST', body: { channel: 'beta', expected_revision: 0 } });
  assert.equal(pref.status, 200); assert.equal(pref.payload.snapshot.flags.task25_test.enabled, true);
  assert.equal((await get(users.two)).channel, 'stable');
  assert.equal((await request('/api/release-channel', { method: 'POST', body: { channel: 'experimental', expected_revision: 0 } })).status, 409);
  await request('/api/release-channel', { method: 'POST', body: { channel: 'experimental', expected_revision: 1 } });
  assert.equal((await get()).flags.task25_test.reason, 'channel_excluded');
  await change({ channels: ['experimental'] }); assert.equal((await get()).flags.task25_test.enabled, true);
  check('Stable/Beta/Experimental gates, preference isolation and CAS');

  await change({ rollout_percentage: 0 }); assert.equal((await get()).flags.task25_test.enabled, false);
  const override = async (enabled, expected_revision = flag.revision, status = 200) => {
    const response = await request('/api/admin/feature-flags/override', { method: 'POST', user: users.owner,
      body: { flag_key: flag.flag_key, user_id: users.one.id, enabled, expected_revision } });
    assert.equal(response.status, status, JSON.stringify(response.payload));
    if (status === 200) flag.revision = response.payload.override.revision;
    return response;
  };
  await override(true); assert.equal((await get()).flags.task25_test.enabled, true);
  await override(false); assert.equal((await get()).flags.task25_test.enabled, false);
  await override(null); assert.equal((await get()).flags.task25_test.enabled, false);
  await override(true); await change({ enabled: false });
  assert.equal((await get()).flags.task25_test.reason, 'global_off');
  await change({ enabled: true, channels: ['stable'] }); assert.equal((await get()).flags.task25_test.reason, 'channel_excluded');
  await change({ channels: ['experimental'], kill_switch: true });
  assert.equal((await get()).flags.task25_test.reason, 'kill_switch');
  await change({ kill_switch: false }); assert.equal((await get()).flags.task25_test.enabled, true);
  check('ON/OFF/inherit overrides cannot bypass global OFF, channel gate or kill switch');

  const beforeAudit = (await db.prepare('SELECT COUNT(*) AS count FROM task25_flag_audit').first()).count;
  await override(false, flag.revision - 1, 409);
  assert.equal((await get()).flags.task25_test.enabled, true);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM task25_flag_audit').first()).count, beforeAudit);
  const races = await Promise.all([true, false].map(enabled => request('/api/admin/feature-flags/override', {
    user: users.owner, method: 'POST', body: { flag_key: flag.flag_key, user_id: users.one.id, enabled, expected_revision: flag.revision },
  })));
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  assert.equal((await get()).flags.task25_test.enabled, races.find(r => r.status === 200).payload.override.enabled);
  flag.revision++;
  check('losing concurrent override writes neither state nor audit');

  await override(null); await change({ channels: ['stable', 'beta', 'experimental'], rollout_percentage: 37.25 });
  const bucket = await deterministicBucket(flag.flag_key, users.one.id);
  const independent = Math.floor(createHash('sha256').update(`${flag.flag_key}\0${users.one.id}`).digest().readUInt32BE(0) * 10000 / 2 ** 32);
  assert.equal(bucket, independent);
  for (let i = 0; i < 10; i++) assert.equal((await get()).flags.task25_test.bucket, bucket);
  const row = { ...flag, enabled: 1, kill_switch: 0, channels_json: '["stable"]', rollout_basis_points: bucket };
  assert.equal((await evaluateFlag(row, users.one.id, 'stable')).enabled, false);
  assert.equal((await evaluateFlag({ ...row, rollout_basis_points: bucket + 1 }, users.one.id, 'stable')).enabled, true);
  assert.equal((await evaluateFlag({ ...row, rollout_basis_points: 0 }, users.one.id, 'stable')).enabled, false);
  assert.equal((await evaluateFlag({ ...row, rollout_basis_points: 10000 }, users.one.id, 'stable')).enabled, true);
  const assigned = await Promise.all(Array.from({ length: 1000 }, (_, i) => evaluateFlag({ ...row, rollout_basis_points: 5000 }, `synthetic-${i}`, 'stable')));
  assert.ok(assigned.filter(x => x.enabled).length > 430 && assigned.filter(x => x.enabled).length < 570);
  check('independent SHA deterministic bucket, percentage boundary and cohort distribution');

  const adminList = await request('/api/admin/feature-flags', { user: users.owner });
  const lastAudit = adminList.payload.audit[0];
  assert.equal(lastAudit.actor_user_id, users.owner.id); assert.ok(lastAudit.request_id);
  assert.ok(JSON.parse(lastAudit.after_json).revision > JSON.parse(lastAudit.before_json).revision);
  const simulated = await request('/api/admin/feature-flags/evaluate', { user: users.owner, method: 'POST', body: { user_id: users.one.id, channel: 'beta' } });
  assert.equal(simulated.payload.snapshot.channel, 'beta'); assert.equal((await get()).channel, 'experimental');
  check('read-only admin simulation and atomic before/after audit');

  assert.equal((await request('/api/features', { user: null })).status, 401);
  assert.equal((await request('/api/admin/feature-flags')).status, 403);
  assert.equal((await request('/api/admin/feature-flags/override', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/features?channel=beta')).status, 400);
  assert.equal((await request('/api/release-channel', { method: 'POST', body: { channel: 'beta', user_id: users.two.id, expected_revision: 2 } })).status, 400);
  assert.equal((await request('/api/release-channel', { method: 'DELETE' })).status, 405);
  assert.equal((await request('/api/features', { environment: { TASK25_FEATURE_FLAGS_ENABLED: 'false' } })).status, 503);
  assert.equal((await request('/api/features', { environment: { TASK12_CLOUD_ACCOUNTS_ENABLED: 'false' } })).status, 503);
  assert.equal((await request('/api/release-channel', { method: 'POST', middleware: true, headers: { Origin: 'https://attacker.invalid' }, body: { channel: 'beta', expected_revision: 2 } })).status, 403);
  check('authentication, authorization, spoofed identity/channel, methods, master OFF and CSRF');

  const password = 'Task25-Isolated-Android-Secret-2026!';
  const pepper = 'task25-isolated-password-pepper-2026';
  await db.prepare("UPDATE task12_users SET password_hash = ?1, password_scheme = 'pbkdf2_sha256', password_iterations = 310000 WHERE id = ?2")
    .bind(await hashSecret(password, pepper), users.one.id).run();
  const nativeEnvironment = { WYJ_TASK12_PASSWORD_PEPPER: pepper, WYJ_TASK20_DEVICE_SESSION_SECRET: 'task25-isolated-device-session-secret-2026' };
  const nativeLogin = await request('/api/app/login', { user: null, method: 'POST', environment: nativeEnvironment,
    headers: { 'User-Agent': 'thewyj-android/1.3.34' },
    body: { username: users.one.id, secret: password, device_id: 'a16b2c34-8c5b-42b7-bf24-b3d9e4c6f012', app_version: '1.3.34' } });
  assert.equal(nativeLogin.status, 200, JSON.stringify(nativeLogin.payload));
  const native = await request('/api/features', { user: null, headers: { 'X-Session-Token': nativeLogin.payload.access_token, 'User-Agent': 'thewyj-android/1.3.34' } });
  const webView = await request('/api/features', { user: null, headers: { Cookie: `__Host-wyj_app_access=${nativeLogin.payload.access_token}` } });
  const browser = await get();
  for (const response of [native, webView]) {
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    assert.equal(response.payload.snapshot.account_id, browser.account_id);
    assert.equal(response.payload.snapshot.channel, browser.channel);
    assert.deepEqual(response.payload.snapshot.flags, browser.flags);
  }
  check('real device-session token, WebView cookie and browser token share canonical evaluation');

  const limited = await Promise.all(Array.from({ length: 31 }, () => request('/api/admin/feature-flags/evaluate', {
    user: users.owner, method: 'POST', environment: { D1_RATE_LIMIT_ENABLED: 'true' }, body: { user_id: users.two.id },
  })));
  assert.equal(limited.filter(r => r.status === 429).length, 1);
  assert.equal(limited.filter(r => r.status === 200).length, 30);
  assert.ok(Number(limited.find(r => r.status === 429).headers.get('Retry-After')) > 0);
  check('authenticated mutation rate limit and Retry-After contract');

  for (const invalid of ['yes', 1, null]) assert.throws(() => flagDefinition({ flag_key: 'invalid', enabled: invalid, expected_revision: 0 }));
  for (const invalid of [-1, 101, NaN, 0.001, '50']) assert.throws(() => flagDefinition({ flag_key: 'invalid', rollout_percentage: invalid, expected_revision: 0 }));
  assert.equal((await evaluateFlag({ ...row, channels_json: 'null' }, users.one.id, 'stable')).enabled, false);
  assert.equal((await evaluateFlag({ ...row, enabled: 'true' }, users.one.id, 'stable')).enabled, false);
  assert.match((await request('/api/features')).headers.get('Cache-Control'), /private, no-store/);
  await db.prepare("UPDATE task25_metadata SET value = '999' WHERE key = 'schema_version'").run();
  assert.equal((await request('/api/features')).status, 503);
  await db.prepare("UPDATE task25_metadata SET value = '1' WHERE key = 'schema_version'").run();
  const stable = await readFile(path.join(ROOT, 'android/release-metadata.json'), 'utf8');
  const metadata = JSON.parse(stable);
  const stableEnv = { ANDROID_LATEST_VERSION_CODE: String(metadata.versionCode), ANDROID_LATEST_VERSION_NAME: metadata.versionName,
    ANDROID_APK_SHA256: metadata.apkSha256, ANDROID_APK_SIZE_BYTES: String(metadata.apkSizeBytes) };
  for (const channel of ['stable', 'beta', 'experimental']) {
    const current = await get();
    await request('/api/release-channel', { method: 'POST', body: { channel, expected_revision: current.channel_revision } });
    const config = await request('/api/app/config', { environment: stableEnv });
    assert.equal(config.payload.app.latest_version_code, metadata.versionCode);
    assert.equal(config.payload.app.apk_sha256, metadata.apkSha256);
  }
  assert.equal(await readFile(path.join(ROOT, 'android/release-metadata.json'), 'utf8'), stable);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM task12_users').first()).count, 3);
  assert.equal((await readFeatureSnapshot(db, users.two.id)).channel, 'stable');
  check('invalid input/schema fails closed; all channels preserve Stable metadata and other users');
  console.log(`Task 25 D1/API acceptance: ${completed} groups passed`);
} finally { await mf.dispose(); await rm(runtime, { recursive: true, force: true }); }
