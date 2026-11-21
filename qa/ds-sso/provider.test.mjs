import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { onRequest } from '../../functions/api/[[path]].js';
import { POLICY_VERSIONS } from '../../functions/_lib/task27-policy.mjs';
import { sessionStorageKey } from '../../functions/_lib/task12-crypto.mjs';
import { encryptTotp, totpAt } from '../../functions/_lib/task27-crypto.mjs';

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
  AERIS_DS_SSO_ENABLED: 'true', AERIS_DS_OWNERSHIP_ENABLED: 'true', AERIS_DS_SSO_CLIENT_ID: clientId,
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
  const body = JSON.stringify({ op, input, ...binding, ip: options.ip ?? '127.0.0.1' });
  const stamp = String(options.stamp ?? Math.floor(Date.now() / 1000));
  const nonce = token();
  const proof = createHmac('sha256', options.secret ?? secret)
    .update(['ds-native-v1', options.issuer ?? issuer, options.origin ?? origin, clientId, stamp, nonce, body].join('\n')).digest('base64url');
  return { method: 'POST', body, headers: {
    'Content-Type': 'application/json', 'X-DS-Time': stamp, 'X-DS-Nonce': nonce, 'X-DS-Client': clientId, 'X-DS-Proof': proof,
  } };
}

async function identity(op, data, binding, options) {
  return payload(await worker.dispatchFetch(issuer + path, signed(op, data, binding, options)));
}

async function aeris(route, data, session) {
  return payload(await worker.dispatchFetch(issuer + route, {
    method: data ? 'POST' : 'GET',
    body: data ? JSON.stringify(data) : undefined,
    headers: { 'Content-Type': 'application/json', Origin: issuer, ...(session ? { 'X-Session-Token': session } : {}) },
  }));
}

// Separate synthetic fixture accounts also have independent registration clients.
let registrationClient = 10;
async function register(username) {
  const result = await identity('register', {
    username, secret: password, confirm_secret: password, terms_accepted: true, policy_versions: POLICY_VERSIONS,
  }, {}, { ip: '192.0.2.' + registrationClient++ });
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

const ownershipMigration = '0043_ds_account_ownership.sql';
const contact = 'ownership-test@example.test';
// Keep independent fixture workflows in distinct source-IP rate buckets.
const ownershipClient = { ip: '198.51.100.7' };
const startOwnership = (actor, username, binding = token(), secret = password, email = contact) =>
  identity('ownership_start', { username, secret, contact: email }, { grant: actor.grant, binding }, ownershipClient);
const confirmOwnership = (actor, binding, code, email = contact) =>
  identity('ownership_verify', { code, contact: email }, { grant: actor.grant, binding }, ownershipClient);
const ownershipStatus = (actor, ...refs) => identity('ownership_status', { refs }, { grant: actor.grant }, ownershipClient);
const update = (sql, ...args) => db.prepare(sql).bind(...args).run();

test('ownership rollout requires additive 0043; recovery hold backfill and trigger preserve native authentication', async () => {
  const user = await register('ownership-oldrecovery');
  const actor = await login('ownership-oldrecovery');
  assert.equal((await ownershipStatus(actor, token())).status, 503);
  await update("INSERT INTO task27_events(id,user_id,actor_user_id,event_type,created_at) VALUES(?,?,?,'password_recovered',?)",
    crypto.randomUUID(), user, user, new Date().toISOString());
  const before = await first('SELECT count(*) AS n FROM task12_users');
  await migrate(ownershipMigration);
  await migrate(ownershipMigration);
  assert.deepEqual(await first('SELECT count(*) AS n FROM task12_users'), before);
  assert.equal(await first('PRAGMA foreign_key_check'), null);
  assert.equal((await first('SELECT user_id FROM aeris_ds_ownership_recovery_holds WHERE user_id=?', user)).user_id, user);
  assert.equal((await identity('introspect', {}, actor)).body.active, true);
  const another = await register('ownership-held-target');
  await update("INSERT INTO task27_events(id,user_id,actor_user_id,event_type,created_at) VALUES(?,?,?,'password_recovered',?)",
    crypto.randomUUID(), another, another, new Date().toISOString());
  assert.equal((await first('SELECT user_id FROM aeris_ds_ownership_recovery_holds WHERE user_id=?', another)).user_id, another);
});

test('independent password is mandatory and failures disclose no username, contact, policy or account existence', async () => {
  await register('ownership-credential-actor');
  const actor = await login('ownership-credential-actor');
  const target = await register('ownership-credential-target');
  await update('UPDATE task27_security SET verified_email=?, email_verified_at=? WHERE user_id=?',
    contact, new Date().toISOString(), target);

  for (const username of ['ownership-credential-target', 'ownership-absent-target']) {
    const invalidPassword = await startOwnership(actor, username, token(), '123456');
    assert.equal(invalidPassword.status, 403);
    assert.deepEqual(invalidPassword.body, { error: 'ownership_denied' });
  }
  const emailOnly = await identity('ownership_start', { username: 'ownership-credential-target', contact, code: '123456' },
    { grant: actor.grant, binding: token() });
  assert.equal(emailOnly.status, 400);
  const forged = await identity('ownership_start', {
    username: 'ownership-credential-target', contact, secret: password, subject: target, verified: true,
  }, { grant: actor.grant, binding: token() });
  assert.equal(forged.status, 400);
  const own = await startOwnership(actor, 'ownership-credential-actor');
  assert.equal(own.status, 403);
  assert.deepEqual(own.body, { error: 'ownership_denied' });
  await update('UPDATE task12_users SET banned=1 WHERE id=?', target);
  const banned = await startOwnership(actor, 'ownership-credential-target');
  assert.equal(banned.status, 403);
  assert.deepEqual(banned.body, { error: 'ownership_denied' });
  await update('UPDATE task12_users SET banned=0 WHERE id=?', target);
  await update('UPDATE task27_security SET must_change_password=1 WHERE user_id=?', target);
  const forceChange = await startOwnership(actor, 'ownership-credential-target');
  assert.equal(forceChange.status, 403);
  assert.deepEqual(forceChange.body, { error: 'ownership_denied' });

  // Status only accepts bounded references to proofs, including with valid client signatures.
  const query = await identity('ownership_status', { refs: [token()], contact }, { grant: actor.grant });
  assert.equal(query.status, 400);
  assert.deepEqual((await ownershipStatus(actor, token())).body, { active: [] });
});

test('ownership assertions are purpose-, subject-, challenge- and grant-bound with no target session issuance', async () => {
  const actorId = await register('ownership-assertion-actor');
  const actor = await login('ownership-assertion-actor');
  const siblingSession = await login('ownership-assertion-actor');
  const target = await register('ownership-assertion-target');
  await update('UPDATE task27_security SET verified_email=?, email_verified_at=? WHERE user_id=?',
    'assertion-test@example.test', new Date().toISOString(), target);
  const binding = token();
  const args = [actor, 'ownership-assertion-target', binding, password, 'assertion-test@example.test'];
  const race = await Promise.all([startOwnership(...args), startOwnership(...args)]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 403]);
  const accepted = race.find(result => result.status === 200);
  assert.equal(accepted.headers.get('Set-Cookie'), null);
  const { proof, stage } = accepted.body;
  assert.equal(stage, 'verified');
  assert.deepEqual(Object.keys(proof).sort(), [
    'actor_grant', 'actor_sub', 'aud', 'binding', 'contact_matches', 'exp', 'iat', 'iss',
    'label', 'method', 'proof_id', 'purpose', 'security_version', 'session_version', 'sub',
  ].sort());
  assert.deepEqual([proof.iss, proof.aud, proof.actor_sub, proof.actor_grant, proof.binding, proof.sub, proof.purpose],
    [issuer, clientId, actorId, actor.grant, binding, target, 'ds_account_ownership_v1']);
  assert.equal(proof.method, 'none');
  assert.equal(proof.contact_matches, true);
  assert.equal(proof.label, 'ownership-assertion-target');
  assert.ok(proof.exp > proof.iat && proof.exp <= proof.iat + 600);
  assert.equal((await first('SELECT count(*) AS n FROM task12_sessions WHERE user_id=?', target)).n, 0);
  assert.equal((await first('SELECT count(*) AS n FROM aeris_ds_sso_grants WHERE user_id=?', target)).n, 0);
  assert.deepEqual((await ownershipStatus(actor, proof.proof_id)).body, { active: [proof.proof_id] });
  assert.deepEqual((await ownershipStatus(siblingSession, proof.proof_id)).body, { active: [] });
  assert.equal((await identity('profile', {}, { grant: proof.proof_id })).status, 401);
  assert.equal((await confirmOwnership(actor, binding, '123456')).status, 409);
  const direct = await aeris('/api/login', { username: 'ownership-assertion-target', secret: password });
  assert.equal(direct.status, 200);
  const step = await aeris('/api/security/stepup', { password, scope: 'password_change' }, direct.body.session);
  assert.equal(step.status, 200);
  const changed = await aeris('/api/account/secret', {
    grant: step.body.grant, new_secret: changedPassword, confirm_secret: changedPassword,
  }, direct.body.session);
  assert.equal(changed.status, 200);
  assert.deepEqual((await ownershipStatus(actor, proof.proof_id)).body, { active: [] });
  const renewed = await startOwnership(actor, 'ownership-assertion-target', token(), changedPassword);
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.proof.contact_matches, false);
  assert.equal(renewed.body.proof.sub, target);
  assert.equal((await identity('revoke', {}, actor)).status, 200);
  assert.equal((await ownershipStatus(actor, renewed.body.proof.proof_id)).status, 401);
});

test('enrolled TOTP is required and has scoped, expiring, single-use attempts', async () => {
  await register('ownership-mfa-actor');
  const actor = await login('ownership-mfa-actor');
  const secondSession = await login('ownership-mfa-actor');
  const target = await register('ownership-mfa-target');
  const secret = 'JBSWY3DPEHPK3PXP';
  const ciphertext = await encryptTotp(bindings, target, secret);
  await update("UPDATE task27_security SET mfa_method='totp', totp_ciphertext=? WHERE user_id=?", ciphertext, target);
  const expired = token();
  const expires = await startOwnership(actor, 'ownership-mfa-target', expired);
  assert.equal(expires.status, 200);
  assert.deepEqual(Object.keys(expires.body).sort(), ['expires_at', 'method', 'stage']);
  assert.equal(expires.body.stage, 'mfa_required');
  assert.equal((await first('SELECT count(*) AS n FROM aeris_ds_ownership_proofs WHERE target_id=?', target)).n, 0);
  const step = Math.floor(Date.now() / 30000);
  const code = await totpAt(secret, step);
  await update('UPDATE task27_challenges SET expires_at=? WHERE user_id=? AND scope=?',
    '2000-01-01T00:00:00.000Z', target, 'ds_account_ownership_v1');
  assert.equal((await confirmOwnership(actor, expired, code)).status, 409);

  const binding = token();
  const awaited = await startOwnership(actor, 'ownership-mfa-target', binding);
  assert.equal(awaited.body.method, 'totp');
  assert.equal((await confirmOwnership(secondSession, binding, code)).status, 409);
  assert.equal((await confirmOwnership(actor, token(), code)).status, 409);
  const validWindow = new Set(await Promise.all([-1, 0, 1].map(offset => totpAt(secret, step + offset))));
  const invalidCode = ['000000', '000001', '000002', '000003'].find(code => !validWindow.has(code));
  assert.deepEqual((await confirmOwnership(actor, binding, invalidCode)).body, { error: 'ownership_mfa_failed' });
  assert.equal((await first('SELECT count(*) AS n FROM aeris_ds_ownership_proofs WHERE target_id=?', target)).n, 0);
  const duplicate = await Promise.all([confirmOwnership(actor, binding, code), confirmOwnership(actor, binding, code)]);
  assert.deepEqual(duplicate.map(result => result.status).sort(), [200, 409]);
  const proof = duplicate.find(result => result.status === 200).body.proof;
  assert.equal(proof.sub, target);
  assert.equal(proof.method, 'totp');
  assert.equal((await first('SELECT count(*) AS n FROM task12_sessions WHERE user_id=?', target)).n, 0);
  assert.equal((await confirmOwnership(actor, binding, code)).status, 409);
  await update('UPDATE aeris_ds_ownership_proofs SET issued_at=1, expires_at=2 WHERE proof_id=?', proof.proof_id);
  assert.deepEqual((await ownershipStatus(actor, proof.proof_id)).body, { active: [] });
});

test('policy and security generations close pending verification; actual account password recovery retains a hold', async () => {
  await register('ownership-policy-actor');
  const actor = await login('ownership-policy-actor');
  const target = await register('ownership-policy-target');
  const targetAccount = await login('ownership-policy-target');
  const secret = 'JBSWY3DPEHPK3PXP';
  const ciphertext = await encryptTotp(bindings, target, secret);
  await update("UPDATE task27_security SET mfa_method='totp', totp_ciphertext=? WHERE user_id=?", ciphertext, target);
  const binding = token();
  assert.equal((await startOwnership(actor, 'ownership-policy-target', binding)).body.stage, 'mfa_required');
  await update('DELETE FROM task27_policy_consents WHERE user_id=?', target);
  await update("INSERT INTO task12_metadata(key,value) VALUES('task27_require_policy_reaccept','1') ON CONFLICT(key) DO UPDATE SET value='1'");
  const code = await totpAt(secret, Math.floor(Date.now() / 30000));
  assert.equal((await confirmOwnership(actor, binding, code)).status, 403);
  await update("DELETE FROM task12_metadata WHERE key='task27_require_policy_reaccept'");

  // Use the actual Task27 password-recovery endpoint with an independent code.
  const recoveryCode = 'ABCD2345-ABCD2345-ABCD2345-ABCD2345';
  await update('INSERT INTO task27_recovery_codes(user_id,code_hash,created_at) VALUES(?,?,?)', target,
    await sessionStorageKey(recoveryCode), new Date().toISOString());
  const recovery = { binding: token() };
  assert.equal((await identity('recovery_start', { username: 'ownership-policy-target', method: 'recovery' }, recovery)).status, 200);
  assert.equal((await identity('recovery_finish', {
    code: recoveryCode, new_secret: changedPassword, confirm_secret: changedPassword,
  }, recovery)).status, 200);
  assert.equal((await first('SELECT user_id FROM aeris_ds_ownership_recovery_holds WHERE user_id=?', target)).user_id, target);
  assert.equal((await identity('introspect', {}, targetAccount)).body.active, false);
  assert.deepEqual((await startOwnership(actor, 'ownership-policy-target', token(), changedPassword)).body, { error: 'ownership_denied' });
  await update("DELETE FROM task27_events WHERE user_id=? AND event_type='password_recovered'", target);
  assert.equal((await first('SELECT user_id FROM aeris_ds_ownership_recovery_holds WHERE user_id=?', target)).user_id, target);
  assert.equal((await identity('login', { username: 'ownership-policy-target', secret: changedPassword }, { binding: token() })).body.stage, 'login_verify');
});

test('Aeris email MFA requires its own delivered code; an email password reset enters ownership review', async () => {
  await register('ownership-email-actor');
  const actor = await login('ownership-email-actor');
  const target = await register('ownership-email-target');
  const mail = 'ownership-email@example.test';
  await update("UPDATE task27_security SET verified_email=?, email_verified_at=?, mfa_method='email' WHERE user_id=?",
    mail, new Date().toISOString(), target);
  const messages = [];
  let available = true;
  const env = {
    ...bindings, WYJ_DB: db, EMAIL_SENDING_ENABLED: 'true', EMAIL_TRANSPORT: 'binding', EMAIL_TEST_RECIPIENTS: mail,
    EMAIL: {
      async send(message) {
        if (!available) throw new Error('Synthetic transport unavailable');
        messages.push(message);
        return { messageId: crypto.randomUUID(), queued: [{ email: mail }] };
      },
    },
  };
  const emailIdentity = async (op, input, binding) => {
    const tasks = [];
    const response = await onRequest({
      env, data: { requestId: crypto.randomUUID() }, request: new Request(issuer + path, signed(op, input, binding, { ip: '198.51.100.14' })),
      waitUntil(work) { tasks.push(work); },
    });
    await Promise.all(tasks);
    return payload(response);
  };
  const mailboxCode = () => {
    const code = messages.at(-1).text.match(/验证码：(\d{6})/u)?.[1];
    assert.match(code ?? '', /^\d{6}$/);
    return code;
  };
  const input = { username: 'ownership-email-target', secret: password, contact: mail };
  available = false;
  const unavailable = await emailIdentity('ownership_start', input, { binding: token(), grant: actor.grant });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, { error: 'ownership_unavailable' });
  assert.equal(messages.length, 0);
  assert.equal((await first("SELECT count(*) AS n FROM task27_challenges WHERE user_id=? AND consumed_at=''", target)).n, 0);

  available = true;
  const binding = token();
  const request = await emailIdentity('ownership_start', input, { binding, grant: actor.grant });
  assert.equal(request.status, 200);
  assert.equal(request.body.method, 'email');
  assert.equal(messages.length, 1);
  const code = mailboxCode();
  const distinctCode = code === '123456' ? '123457' : '123456';
  assert.equal((await confirmOwnership(actor, binding, distinctCode, mail)).status, 400);
  const accepted = await confirmOwnership(actor, binding, code, mail);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.proof.method, 'email');
  assert.equal(accepted.body.proof.contact_matches, true);
  const { proof_id: ref } = accepted.body.proof;
  assert.deepEqual((await ownershipStatus(actor, ref)).body, { active: [ref] });
  const pending = token();
  assert.equal((await emailIdentity('ownership_start', input, { binding: pending, grant: actor.grant })).body.method, 'email');
  const pendingCode = mailboxCode();

  const recovery = { binding: token() };
  assert.equal((await emailIdentity('recovery_start', { username: input.username, method: 'email', email: mail }, recovery)).status, 200);
  assert.equal(messages.length, 3);
  assert.equal((await emailIdentity('recovery_finish', {
    code: mailboxCode(), new_secret: changedPassword, confirm_secret: changedPassword,
  }, recovery)).status, 200);
  assert.equal((await confirmOwnership(actor, pending, pendingCode, mail)).status, 409);
  assert.deepEqual((await ownershipStatus(actor, ref)).body, { active: [] });
  assert.deepEqual((await startOwnership(actor, input.username, token(), changedPassword, mail)).body, { error: 'ownership_denied' });
  assert.equal((await emailIdentity('login', { username: input.username, secret: changedPassword }, { binding: token() })).body.stage, 'login_verify');
});

test('ownership Preview host preserves the canonical issuer and scopes grants to the exact DS origin', async () => {
  await register('ownership-preview-actor');
  const target = await register('ownership-preview-target');
  const previewIssuer = 'https://canonical-identity.thewyj-uk.pages.dev';
  const primaryOrigin = 'https://primary-ds.ds-thewyj-uk.pages.dev';
  const transport = 'https://isolated-ownership.thewyj-uk.pages.dev';
  const ownershipOrigin = 'https://isolated-ownership.ds-thewyj-uk.pages.dev';
  const preview = {
    ...bindings, WYJ_ENVIRONMENT: 'preview', WYJ_DB: db,
    AERIS_DS_SSO_ISSUER: previewIssuer, AERIS_DS_SSO_ORIGIN: primaryOrigin,
    AERIS_DS_OWNERSHIP_PREVIEW_HOST: transport, AERIS_DS_OWNERSHIP_DS_ORIGIN: ownershipOrigin,
  };
  async function call(host, ds, op, input, binding = {}, env = preview, canonical = previewIssuer) {
    const tasks = [];
    const response = await onRequest({
      env, data: {}, request: new Request(host + path, signed(op, input, binding, { issuer: canonical, origin: ds, ip: '198.51.100.15' })),
      waitUntil(work) { tasks.push(work); },
    });
    await Promise.all(tasks);
    return payload(response);
  }

  const input = { username: 'ownership-preview-actor', secret: password };
  assert.equal((await call(transport, primaryOrigin, 'login', input, { binding: token() })).status, 401);
  assert.equal((await call(transport, ownershipOrigin, 'login', input, { binding: token() }, preview, transport)).status, 401);
  assert.equal((await call('https://elsewhere.thewyj-uk.pages.dev', ownershipOrigin, 'policies', {})).status, 404);
  assert.equal((await call(transport, ownershipOrigin, 'policies', {}, {}, {
    ...preview, AERIS_DS_OWNERSHIP_ENABLED: 'false',
  })).status, 404);
  assert.equal((await call(transport, ownershipOrigin, 'policies', {}, {}, {
    ...preview, AERIS_DS_OWNERSHIP_DS_ORIGIN: 'https://elsewhere.pages.dev',
  })).status, 404);
  const entered = await call(transport, ownershipOrigin, 'login', input, { binding: token() });
  assert.equal(entered.status, 200);
  assert.equal(entered.body.claims.iss, previewIssuer);
  const grant = entered.body.claims.grant_id;
  const started = await call(transport, ownershipOrigin, 'ownership_start',
    { username: 'ownership-preview-target', secret: password, contact }, { grant, binding: token() });
  assert.equal(started.status, 200);
  assert.equal(started.body.proof.iss, previewIssuer);
  assert.equal(started.body.proof.sub, target);
  assert.deepEqual((await call(previewIssuer, primaryOrigin, 'introspect', {}, { grant })).body, { active: false });
  assert.equal((await call(previewIssuer, primaryOrigin, 'ownership_status', { refs: [started.body.proof.proof_id] }, { grant })).status, 503);
  const refs = [started.body.proof.proof_id, ...Array.from({ length: 15 }, token)];
  assert.deepEqual((await call(transport, ownershipOrigin, 'ownership_status', { refs }, { grant })).body,
    { active: [started.body.proof.proof_id] });
  assert.equal((await call(transport, ownershipOrigin, 'ownership_status', { refs: [...refs, token()] }, { grant })).status, 400);
});
