// Release failure tests on isolated D1/R2, using Wrangler's migration splitter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery as splitSql } from 'wrangler';
import { onRequest as dispatch } from '../../functions/api/[[path]].js';
import { sessionStorageKey } from '../../functions/_lib/task12-crypto.mjs';
import { saveFlag, setFlagOverride } from '../../functions/_lib/task25-service.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const runtime = await mkdtemp(path.join(os.tmpdir(), 'task25-release-'));
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } }',
  compatibilityDate: '2026-08-06', d1Databases: ['WYJ_DB'], r2Buckets: ['WYJ_STORAGE'], d1Persist: runtime });
const actor = { id: 'release-admin', is_admin: true }, user = 'release-synthetic';
let groups = 0;
const pass = label => console.log(`PASS ${++groups}: ${label}`);

try {
  const db = await mf.getD1Database('WYJ_DB'), storage = await mf.getR2Bucket('WYJ_STORAGE');
  for (const file of (await readdir(path.join(root, 'cloudflare/migrations'))).filter(f => /^\d{4}_/.test(f) && f < '0024_').sort()) {
    await db.batch(splitSql(await readFile(path.join(root, 'cloudflare/migrations', file), 'utf8')).map(sql => db.prepare(sql)));
  }
  const now = new Date().toISOString();
  for (const [id, role] of [[actor.id, 'super_admin'], [user, 'user']]) {
    await db.prepare(`INSERT INTO task12_users(id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
      VALUES (?1, ?1, ?1, '', 'reset_required', 0, ?2, ?3, ?3, ?3, ?3)` ).bind(id, role, now).run();
  }
  const token = 'isolated-release-session';
  await db.prepare(`INSERT INTO task12_sessions(token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind)
    VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`).bind(await sessionStorageKey(token), user, now, new Date(Date.now() + 86400000).toISOString()).run();
  await db.exec('CREATE TABLE wyj_d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT);');
  const metadata = JSON.parse(await readFile(path.join(root, 'android/release-metadata.json'), 'utf8'));
  const apkBytes = new TextEncoder().encode('isolated-46-apk-distribution-fixture');
  await storage.put(metadata.apkKey, apkBytes);
  const env = { WYJ_DB: db, WYJ_STORAGE: storage, TASK12_CLOUD_ACCOUNTS_ENABLED: 'true', TASK20_ANDROID_APP_ENABLED: 'true',
    TASK25_FEATURE_FLAGS_ENABLED: 'true', D1_RATE_LIMIT_ENABLED: 'false',
    ANDROID_LATEST_VERSION_NAME: metadata.versionName, ANDROID_LATEST_VERSION_CODE: String(metadata.versionCode),
    ANDROID_APK_KEY: metadata.apkKey, ANDROID_APK_FILE_NAME: metadata.apkFileName,
    ANDROID_APK_SHA256: metadata.apkSha256, ANDROID_APK_SIZE_BYTES: String(metadata.apkSizeBytes) };
  const request = (route, override = {}) => dispatch({ env: { ...env, ...override }, data: { requestId: crypto.randomUUID() },
    request: new Request('https://thewyj.uk' + route, { headers: { 'X-Session-Token': token, 'User-Agent': 'Thewyj-Android/1.3.33' } }) });
  const configBefore = (await (await request('/api/app/config')).json()).app;
  assert.equal((await request('/api/features')).status, 503);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
  const existingRows = async () => Promise.all(tables.map(async ({ name }) =>
    [name, (await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results]));
  const beforeRows = await existingRows();
  const migration = await readFile(path.join(root, 'cloudflare/migrations/0024_feature_flags_release_channels.sql'), 'utf8');
  const ledger = "INSERT INTO wyj_d1_migrations(name, applied_at) VALUES ('0024_feature_flags_release_channels.sql', 'fixture');";
  await assert.rejects(db.batch(splitSql(migration + '\n' + ledger + '\nINSERT INTO missing_release_table VALUES(1);').map(sql => db.prepare(sql))));
  assert.deepEqual((await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'task25_%'").all()).results, []);
  assert.deepEqual(await existingRows(), beforeRows);
  assert.equal((await request('/api/features')).status, 503);
  assert.deepEqual((await (await request('/api/app/config')).json()).app, configBefore);
  pass('late migration failure rolls back tables, schema marker, seeds and ledger; old client stays available');

  await db.batch(splitSql(migration + '\n' + ledger).map(sql => db.prepare(sql)));
  const migratedRows = await existingRows();
  assert.deepEqual(migratedRows.filter(([name]) => name !== 'wyj_d1_migrations'), beforeRows.filter(([name]) => name !== 'wyj_d1_migrations'));
  assert.deepEqual((await (await request('/api/app/config')).json()).app, configBefore);
  const seedRows = (await db.prepare('SELECT * FROM task25_feature_flags').all()).results;
  assert.ok(seedRows.every(flag => flag.enabled === 0));
  const fresh = (await (await request('/api/features')).json()).snapshot;
  assert.equal(fresh.channel, 'stable');
  assert.ok(Object.values(fresh.flags).every(flag => !flag.enabled));
  pass('retry succeeds additively, preserves every existing business row and uses OFF/Stable defaults');

  let flag = await saveFlag(db, actor, { flag_key: 'task25_release_test', expected_revision: 0,
    enabled: true, channels: ['experimental'], rollout_percentage: 100 }, 'create-release-fixture');
  await setFlagOverride(db, actor, { flag_key: flag.flag_key, user_id: user, enabled: true, expected_revision: flag.revision }, 'override-release-fixture');
  flag.revision++;
  let snapshot = (await (await request('/api/features')).json()).snapshot;
  assert.equal(snapshot.flags[flag.flag_key].reason, 'channel_excluded');
  assert.equal(snapshot.flags[flag.flag_key].enabled, false);
  await db.prepare("INSERT INTO task25_release_preferences(user_id, channel, revision, updated_at) VALUES (?1, 'beta', 1, ?2)").bind(user, now).run();
  assert.equal((await (await request('/api/features')).json()).snapshot.flags[flag.flag_key].enabled, false);
  const state = async () => Promise.all(['task25_metadata','task25_feature_flags','task25_user_flag_overrides',
    'task25_release_preferences','task25_flag_audit'].map(async name => [name, (await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()).results]));
  const configured = await state();
  await db.batch(splitSql(migration).map(sql => db.prepare(sql)));
  assert.deepEqual(await state(), configured);
  pass('migration replay preserves live definitions, overrides, preferences and audit; 100% Experimental cannot reach Stable/Beta');

  const project = value => ({ flag_key: value.flag_key, description: value.description, enabled: value.enabled,
    kill_switch: value.kill_switch, channels: value.channels, rollout_percentage: value.rollout_percentage, expected_revision: value.revision });
  flag = await saveFlag(db, actor, { ...project(flag), channels: ['stable', 'beta', 'experimental'] }, 'enable-fixture');
  assert.equal((await (await request('/api/features')).json()).snapshot.flags[flag.flag_key].enabled, true);
  await db.exec("CREATE TRIGGER release_audit_failure BEFORE INSERT ON task25_flag_audit BEGIN SELECT RAISE(ABORT, 'injected_audit_failure'); END;");
  const beforeFailure = await state();
  await assert.rejects(saveFlag(db, actor, { ...project(flag), kill_switch: true }, 'failed-kill-fixture'));
  assert.deepEqual(await state(), beforeFailure);
  await db.exec('DROP TRIGGER release_audit_failure;');
  flag = await saveFlag(db, actor, { ...project(flag), kill_switch: true }, 'kill-fixture');
  snapshot = (await (await request('/api/features')).json()).snapshot;
  assert.equal(snapshot.flags[flag.flag_key].enabled, false);
  assert.equal(snapshot.flags[flag.flag_key].reason, 'kill_switch');
  pass('audit failure cannot partially commit a kill switch; successful retry overrides targeted ON');

  const unavailableDb = { prepare() { throw new Error('isolated_d1_outage'); } };
  const unavailableFlagQueries = {
    prepare(sql) { if (sql.includes('task25_')) throw new Error('isolated_flag_query_outage'); return db.prepare(sql); },
    batch(statements) { return db.batch(statements); },
  };
  // Also exercise production's enabled D1 rate limiter with only the optional
  // flag queries unavailable; canonical accounts and distribution remain live.
  const flagOnlyFailure = { WYJ_DB: unavailableFlagQueries, D1_RATE_LIMIT_ENABLED: 'true' };
  for (const failure of [{ TASK25_FEATURE_FLAGS_ENABLED: 'false' }, { WYJ_DB: unavailableDb }, flagOnlyFailure]) {
    assert.equal((await request('/api/features', failure)).status, 503);
    assert.deepEqual((await (await request('/api/app/config', failure)).json()).app, configBefore);
    const download = await request('/api/app/download', failure);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), createHash('sha256').update(apkBytes).digest('hex'));
  }
  assert.equal((await request('/api/me', flagOnlyFailure)).status, 200);
  pass('master OFF and flag database outage preserve old-client config/download; moving APK pointer cannot be cached');
  console.log(`Task 25 release resilience: ${groups} groups passed (isolated fixtures; no Production operations)`);
} finally { await mf.dispose(); await rm(runtime, { recursive: true, force: true }); }
