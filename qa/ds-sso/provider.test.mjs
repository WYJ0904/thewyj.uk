import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { POLICY_VERSIONS } from '../../functions/_lib/task27-policy.mjs';
import { totpAt } from '../../functions/_lib/task27-crypto.mjs';

const path = '/api/internal/ds-identity/v1';
const issuer = 'http://localhost:18992';
const origin = 'http://127.0.0.1:18993';
const clientId = 'ds-local-provider-qa';
const token = () => randomBytes(32).toString('base64url');
const secret = token();
const password = 'Synthetic-Aeris-Workerd-DS-Password-05!';
const changedPassword = 'Aeris-DS-Synthetic-05-New!';
const root = join(import.meta.dirname, '../..');
const migrations = join(root, 'cloudflare', 'migrations');
const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
const bindings = {
  ...config.env.preview.vars, WYJ_ENVIRONMENT: 'development', WORKERS_AI_ENABLED: 'false',
  EMAIL_SENDING_ENABLED: 'false', TASK27_SECURITY_ENABLED: 'true',
  WYJ_TASK12_PASSWORD_PEPPER: 'isolated-task05-aeris-synthetic-pepper',
  WYJ_TASK27_CHALLENGE_SECRET: 'isolated-task05-aeris-synthetic-challenge',
  WYJ_TASK27_TOTP_KEY: Buffer.alloc(32, 5).toString('base64url'),
  AERIS_DS_SSO_ENABLED: 'true', AERIS_DS_SSO_CLIENT_ID: clientId,
  AERIS_DS_SSO_CLIENT_SECRET: secret, AERIS_DS_NATIVE_SEAL_KEY: token(),
  AERIS_DS_SSO_ISSUER: issuer, AERIS_DS_SSO_ORIGIN: origin,
};
const worker = new Miniflare({
  modules: true, scriptPath: join(root, '.wrangler/functions-build/index.js'), compatibilityDate: config.compatibility_date,
  d1Databases: ['WYJ_DB'], r2Buckets: ['WYJ_STORAGE'], bindings,
  serviceBindings: { ASSETS: () => new Response('fixture asset', { status: 404 }) },
});
let db;
const migrate = async name => db.exec((await readFile(join(migrations, name), 'utf8')).replace(/\r?\n/g, ' '));
const first = (sql, ...args) => db.prepare(sql).bind(...args).first();

before(async () => {
  db = await worker.getD1Database('WYJ_DB');
  for (const file of (await readdir(migrations)).filter(name => name < '0038_' || name.startsWith('0041_')).sort()) {
    await migrate(file);
  }
});
after(() => worker.dispose());

async function payload(response) {
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function signed(op, input = {}, binding = {}, options = {}) {
  const body = JSON.stringify({ op, input, ...binding, ip: '127.0.0.1' });
  const stamp = String(options.stamp ?? Math.floor(Date.now() / 1000));
  const nonce = token();
  const proof = createHmac('sha256', options.secret ?? secret)
    .update(['ds-native-v1', issuer, options.origin ?? origin, clientId, stamp, nonce, body].join('\n')).digest('base64url');
  return { method: 'POST', body, headers: {
    'Content-Type': 'application/json', 'X-DS-Time': stamp, 'X-DS-Nonce': nonce, 'X-DS-Client': clientId, 'X-DS-Proof': proof,
  } };
}

async function identity(op, data, binding) {
  return payload(await worker.dispatchFetch(issuer + path, signed(op, data, binding)));
}

async function aeris(route, data, session) {
  return payload(await worker.dispatchFetch(issuer + route, {
    method: data ? 'POST' : 'GET',
    body: data ? JSON.stringify(data) : undefined,
    headers: { 'Content-Type': 'application/json', Origin: issuer, ...(session ? { 'X-Session-Token': session } : {}) },
  }));
}

async function register(username) {
  const result = await identity('register', {
    username, secret: password, confirm_secret: password, terms_accepted: true, policy_versions: POLICY_VERSIONS,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual(result.body, { stage: 'signin_required' });
  return (await first('SELECT id FROM task12_users WHERE username=?', username)).id;
}

async function login(username, pwd = password) {
  const result = await identity('login', { username, secret: pwd }, { binding: token() });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.stage, 'authenticated');
  return { grant: result.body.claims.grant_id, claims: result.body.claims };
}

async function stepup(binding, scope, pwd = password) {
  const result = await identity('stepup', { scope, password: pwd }, binding);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

test('the gated runtime needs scoped additive 0042 and leaves 0037 account rows intact', async () => {
  assert.equal((await identity('policies')).status, 503);
  const snapshot = await first('SELECT count(*) AS n FROM task12_users');
  await migrate('0042_ds_native_identity.sql');
  await migrate('0042_ds_native_identity.sql');
  assert.deepEqual(await first('SELECT count(*) AS n FROM task12_users'), snapshot);
  assert.equal(await first('PRAGMA foreign_key_check'), null);
  const result = await identity('policies');
  assert.equal(result.status, 200);
  assert.equal(result.body.documents.length, 3);
  assert.deepEqual(result.body.versions, POLICY_VERSIONS);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('disabled legacy endpoints, exact registration, signed body, expiry and single use', async () => {
  for (const target of [issuer + '/api/sso/ds/authorize', issuer + '/api/sso/ds/exchange', 'https://thewyj.uk' + path]) {
    const response = await worker.dispatchFetch(target, signed('policies'));
    assert.equal(response.status, 404);
  }
  for (const init of [
    signed('policies', {}, {}, { secret: token() }),
    signed('policies', {}, {}, { origin: 'http://127.0.0.1:4321' }),
    signed('policies', {}, {}, { stamp: Math.floor(Date.now() / 1000) - 90 }),
  ]) assert.equal((await worker.dispatchFetch(issuer + path, init)).status, 401);
  const legitimate = signed('policies');
  const altered = { ...legitimate, body: JSON.stringify({ op: 'register', input: {} }) };
  assert.equal((await worker.dispatchFetch(issuer + path, altered)).status, 401);
  const duplicate = await Promise.all([
    worker.dispatchFetch(issuer + path, legitimate), worker.dispatchFetch(issuer + path, legitimate),
  ]);
  assert.deepEqual(duplicate.map(r => r.status).sort(), [200, 409]);
  assert.equal((await identity('profile', {}, { grant: token() })).status, 401);
});

test('DS registration creates one Aeris account; only successful Aeris login issues a grant', async () => {
  const subject = await register('native-register');
  const actor = await login('native-register');
  assert.deepEqual(Object.keys(actor.claims).sort(), ['aud','exp','grant_id','iat','iss','sub']);
  assert.equal(actor.claims.sub, subject);
  assert.equal(actor.claims.iss, issuer);
  assert.equal(actor.claims.aud, clientId);
  assert.ok(actor.claims.exp > actor.claims.iat && actor.claims.exp <= actor.claims.iat + 28800);
  for (const username of ['native-register', 'missing-account']) {
    const denied = await identity('login', { username, secret: 'not-the-password' }, { binding: token() });
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.body, { error: 'invalid_credentials' });
  }
  assert.equal((await identity('introspect', {}, actor)).body.active, true);
  const direct = await aeris('/api/login', { username: 'native-register', secret: password });
  assert.equal(direct.body.account.id, subject);
  assert.equal((await first('SELECT count(*) AS n FROM task12_users WHERE id=?', subject)).n, 1);
});

test('Aeris and DS profile writes share ownership, step-up and optimistic conflict handling', async () => {
  const user = await register('native-profile');
  const native = await login('native-profile');
  const direct = (await aeris('/api/login', { username: 'native-profile', secret: password })).body.session;
  const before = (await identity('profile', {}, native)).body;
  assert.equal(before.username, 'native-profile');
  const grant = (await aeris('/api/security/stepup', { password, scope: 'profile_change' }, direct)).body.grant;
  const changed = await aeris('/api/account/profile', { username: 'direct-rename', expected_revision: before.revision, grant }, direct);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await identity('profile', {}, native)).body.username, 'direct-rename');
  const proof = await stepup(native, 'profile_change');
  assert.equal(proof.verification, 'ready');
  assert.ok(!('grant' in proof));
  const withoutProof = await identity('profile_save', { username: 'not-saved', expected_revision: changed.body.revision }, native);
  assert.equal(withoutProof.status, 400);
  const stale = await identity('profile_save', { username: 'stale', expected_revision: before.revision, ref: proof.ref }, native);
  assert.equal(stale.status, 409);
  const next = await identity('profile_save', { username: 'native-rename', expected_revision: changed.body.revision, ref: proof.ref }, native);
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal((await aeris('/api/account/profile', null, direct)).body.username, 'native-rename');
  assert.equal((await first('SELECT id FROM task12_users WHERE username=?', 'native-rename')).id, user);
  const another = await stepup(native, 'profile_change');
  const independent = await stepup(native, 'profile_change');
  const race = await Promise.all([
    identity('profile_save', { username: 'native-race-a', expected_revision: next.body.revision, ref: another.ref }, native),
    identity('profile_save', { username: 'native-race-b', expected_revision: next.body.revision, ref: independent.ref }, native),
  ]);
  assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
  assert.equal((await identity('admin_ban', { user_id: user }, native)).status, 400);
});

test('DS logout affects one Aeris source session and Aeris logout-all revokes the others', async () => {
  await register('native-logout');
  const a = await login('native-logout');
  const b = await login('native-logout');
  const direct = (await aeris('/api/login', { username: 'native-logout', secret: password })).body.session;
  assert.equal((await identity('revoke', {}, a)).body.revoked, true);
  assert.deepEqual((await identity('introspect', {}, a)).body, { active: false });
  assert.equal((await identity('introspect', {}, b)).body.active, true);
  assert.equal((await aeris('/api/me', null, direct)).status, 200);
  assert.equal((await aeris('/api/account/logout-all', {}, direct)).status, 200);
  assert.deepEqual((await identity('introspect', {}, b)).body, { active: false });
});

test('forced password change stays in the native workflow without an early session', async () => {
  const user = await register('native-force');
  await db.prepare('UPDATE task27_security SET must_change_password=1 WHERE user_id=?').bind(user).run();
  const binding = { binding: token() };
  const result = await identity('login', { username: 'native-force', secret: password }, binding);
  assert.equal(result.body.stage, 'password_force');
  assert.ok(!('claims' in result.body));
  const other = await identity('password_force', { new_secret: changedPassword, confirm_secret: changedPassword }, { binding: token() });
  assert.equal(other.status, 400);
  const change = await identity('password_force', { new_secret: changedPassword, confirm_secret: changedPassword }, binding);
  assert.deepEqual(change.body, { stage: 'signin_required' });
  assert.equal((await login('native-force', changedPassword)).claims.sub, user);
});

test('actual native MFA, scoped security changes and recovery reuse Task27 challenges', async () => {
  const user = await register('native-mfa');
  const active = await login('native-mfa');
  const proof = await stepup(active, 'mfa_change');
  const setup = await identity('mfa_start', { method: 'totp', ref: proof.ref }, active);
  assert.equal(setup.status, 200);
  const code = await totpAt(setup.body.secret, Math.floor(Date.now() / 30000));
  const enrollment = await identity('mfa_confirm', { ref: setup.body.ref, code }, active);
  assert.equal(enrollment.status, 200, JSON.stringify(enrollment.body));
  assert.equal(enrollment.body.session_invalidated, true);
  assert.deepEqual((await identity('introspect', {}, active)).body, { active: false });
  const flow = { binding: token() };
  const wait = await identity('login', { username: 'native-mfa', secret: password }, flow);
  assert.equal(wait.body.stage, 'login_verify');
  assert.ok(!('challenge' in wait.body));
  const wrongFlow = await identity('login_verify', { code: enrollment.body.recovery_codes[0] }, { binding: token() });
  assert.equal(wrongFlow.status, 400);
  const verified = await identity('login_verify', { code: enrollment.body.recovery_codes[0] }, flow);
  assert.equal(verified.body.claims.sub, user);
  assert.equal((await identity('login_verify', { code: enrollment.body.recovery_codes[0] }, flow)).status, 400);
  const session = { grant: verified.body.claims.grant_id };
  const challenge = await stepup(session, 'profile_change');
  assert.equal(challenge.verification, 'challenge');
  const notAuthorized = await identity('profile_save', { username: 'blocked', revision: 'old', ref: challenge.ref }, session);
  assert.equal(notAuthorized.status, 400);
  const recovery = { binding: token() };
  assert.equal((await identity('recovery_start', { username: 'native-mfa', method: 'recovery' }, recovery)).body.stage, 'recovery_finish');
  const reset = await identity('recovery_finish', {
    code: enrollment.body.recovery_codes[1], new_secret: changedPassword, confirm_secret: changedPassword,
  }, recovery);
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.deepEqual(reset.body, { stage: 'signin_required' });
  assert.equal((await identity('introspect', {}, session)).body.active, false);
  assert.equal((await identity('login', { username: 'native-mfa', secret: changedPassword }, { binding: token() })).body.stage, 'login_verify');
});

test('security changes revoke the grant and cannot resurrect it after policy or standing changes', async () => {
  const user = await register('native-security');
  const active = await login('native-security');
  const proof = await stepup(active, 'password_change');
  assert.equal((await identity('password_change', { ref: proof.ref, new_secret: changedPassword, confirm_secret: changedPassword }, active)).status, 200);
  assert.deepEqual((await identity('introspect', {}, active)).body, { active: false });
  const newer = await login('native-security', changedPassword);
  await db.prepare('UPDATE task12_users SET banned=1 WHERE id=?').bind(user).run();
  assert.deepEqual((await identity('introspect', {}, newer)).body, { active: false });
  await db.prepare('UPDATE task12_users SET banned=0 WHERE id=?').bind(user).run();
  assert.deepEqual((await identity('introspect', {}, newer)).body, { active: false });
});
