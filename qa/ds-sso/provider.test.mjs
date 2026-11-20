import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { POLICY_VERSIONS } from '../../functions/_lib/task27-policy.mjs';
import { totpAt } from '../../functions/_lib/task27-crypto.mjs';

const prefix = '/api/sso/ds/';
const issuer = 'http://localhost:18992';
const dsOrigin = 'http://127.0.0.1:18993';
const redirectUri = dsOrigin + '/api/auth/callback';
const clientId = 'ds-local-provider-qa';
const token = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('base64url');
const configuredSecret = token();
const auth = 'Basic ' + Buffer.from(clientId + ':' + configuredSecret).toString('base64');
const password = 'Synthetic-Aeris-Workerd-DS-Password-05!';
const root = join(import.meta.dirname, '../..');
const migrations = join(root, 'cloudflare', 'migrations');
const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
const bindings = {
  ...config.env.preview.vars, WYJ_ENVIRONMENT: 'development', WORKERS_AI_ENABLED: 'false',
  EMAIL_SENDING_ENABLED: 'false', TASK27_SECURITY_ENABLED: 'true',
  WYJ_TASK12_PASSWORD_PEPPER: 'isolated-task05-aeris-synthetic-pepper',
  WYJ_TASK27_CHALLENGE_SECRET: 'isolated-task05-aeris-synthetic-challenge',
  WYJ_TASK27_TOTP_KEY: Buffer.alloc(32, 5).toString('base64url'),
  AERIS_DS_SSO_ENABLED: 'true', AERIS_DS_SSO_CLIENT_ID: clientId, AERIS_DS_SSO_CLIENT_SECRET: configuredSecret,
  AERIS_DS_SSO_ISSUER: issuer, AERIS_DS_SSO_CALLBACK: redirectUri,
};

const worker = new Miniflare({
  modules: true, scriptPath: join(root, '.wrangler/functions-build/index.js'),
  compatibilityDate: config.compatibility_date, d1Databases: ['WYJ_DB'], r2Buckets: ['WYJ_STORAGE'], bindings,
  serviceBindings: { ASSETS: () => new Response('fixture asset', { status: 404 }) },
});
let db;
const migrate = async name => db.exec((await readFile(join(migrations, name), 'utf8')).replace(/\r?\n/g, ' '));
const first = async (sql, ...args) => db.prepare(sql).bind(...args).first();

before(async () => {
  db = await worker.getD1Database('WYJ_DB');
  const base = (await readdir(migrations)).filter(name => name <= '0037_~' && /^\d{4}_/.test(name)).sort();
  for (const file of base) await migrate(file);
});
after(() => worker.dispose());

async function json(path, body, session, headers = {}) {
  const response = await worker.dispatchFetch(issuer + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: issuer, 'X-Aeris-SSO': '1',
      ...(session ? { 'X-Session-Token': session } : {}), ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function backchannel(action, input, authorization = auth) {
  const response = await worker.dispatchFetch(issuer + prefix + action, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(input),
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  return { status: response.status, body: await response.json() };
}

function authorizeInput() {
  const verifier = token();
  const state = token();
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', prompt: 'select_account',
    state, code_challenge: hash(verifier), code_challenge_method: 'S256',
  });
  return { verifier, state, query };
}

async function register(username) {
  const response = await json('/api/register', {
    username, secret: password, confirm_secret: password, terms_accepted: true, policy_versions: POLICY_VERSIONS,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.account.id;
}

async function signIn(username, secret = password) {
  const response = await json('/api/login', { username, secret });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.body.session, /^[A-Za-z0-9_-]{43}$/);
  return response.body.session;
}

async function prepare(session, input = authorizeInput()) {
  const response = await json(prefix + 'prepare?' + input.query, {}, session);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { ...input, nonce: response.body.authorization, name: response.body.account };
}

async function stepup(session, scope) {
  const result = await json('/api/security/stepup', { password, scope }, session);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function approve(session, prepared, grant) {
  const result = await json(prefix + 'approve', { authorization: prepared.nonce, grant, confirm: true }, session);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const callback = new URL(result.body.redirect);
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), prepared.state);
  assert.equal(callback.searchParams.get('iss'), issuer);
  assert.equal(callback.searchParams.has('sub'), false);
  return { ...prepared, code: callback.searchParams.get('code') };
}

async function issue(session) {
  const prepared = await prepare(session);
  const { grant } = await stepup(session, 'ds_sso_authorize:' + prepared.nonce);
  return approve(session, prepared, grant);
}

function exchange(approval, overrides = {}, authorization = auth) {
  return backchannel('exchange', {
    grant_type: 'authorization_code', code: approval.code,
    redirect_uri: redirectUri, code_verifier: approval.verifier, ...overrides,
  }, authorization);
}

const introspect = grant => backchannel('introspect', { grant_id: grant.grant_id });

test('provider is unavailable on the 0037 schema until the additive SSO migration', async () => {
  const path = prefix + 'authorize?' + authorizeInput().query;
  const missing = await worker.dispatchFetch(issuer + path);
  assert.equal(missing.status, 503);
  await missing.body.cancel();
  const before = await first('SELECT count(*) AS n FROM task12_users');
  await migrate('0041_ds_sso_provider.sql');
  assert.deepEqual(await first('SELECT count(*) AS n FROM task12_users'), before);
  await migrate('0041_ds_sso_provider.sql');
  assert.deepEqual(await first('SELECT count(*) AS n FROM task12_users'), before);
  assert.equal(await first('PRAGMA foreign_key_check'), null);
  const page = await worker.dispatchFetch(issuer + path, { redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await page.text();
  assert.match(html, /sso-approval/);
  assert.match(html, /access_denied/);
  assert.ok(!html.includes(configuredSecret));
});

test('exact HTTPS registration rules and first-party consent are enforced', async () => {
  const input = authorizeInput();
  input.query.append('redirect_uri', 'https://unexpected.example/');
  const invalid = await worker.dispatchFetch(issuer + prefix + 'authorize?' + input.query);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('location'), null);
  const fresh = authorizeInput();
  assert.equal((await json(prefix + 'prepare?' + fresh.query, {}, '', { Origin: dsOrigin })).status, 403);
  assert.equal((await json(prefix + 'prepare?' + fresh.query, {}, '', { Cookie: 'unrelated=fixture' })).status, 401);
  assert.equal((await json(prefix + 'approve', { authorization: token(), grant: token(), confirm: false }, '')).status, 400);
  const production = await worker.dispatchFetch('https://thewyj.uk' + prefix + 'authorize?' + fresh.query);
  assert.equal(production.status, 404);
});

test('source session, consent nonce, current policy and step-up scope all gate issuance', async () => {
  await register('sso-actor-a');
  await register('sso-actor-b');
  const webA = await signIn('sso-actor-a');
  const webB = await signIn('sso-actor-b');
  const pending = await prepare(webA);
  assert.equal(pending.name, 'sso-actor-a');
  assert.equal((await json(prefix + 'approve', { authorization: pending.nonce, grant: token(), confirm: true }, webA)).status, 400);
  const { grant } = await stepup(webA, 'ds_sso_authorize:' + pending.nonce);
  assert.equal((await json(prefix + 'approve', { authorization: pending.nonce, grant, confirm: true }, webB)).status, 400);
  const second = await prepare(webA);
  assert.equal((await json(prefix + 'approve', { authorization: second.nonce, grant, confirm: true }, webA)).status, 403);
  const wrongScope = await stepup(webA, 'sessions_revoke');
  assert.equal((await json(prefix + 'approve', { authorization: pending.nonce, grant: wrongScope.grant, confirm: true }, webA)).status, 403);
  const valid = await approve(webA, pending, grant);
  assert.ok(valid.code);
  assert.equal((await json('/api/security/sessions/revoke', { mode: 'all', grant }, webA)).status, 400);
  assert.equal((await json('/api/admin/ban', { user_id: 'untrusted-identity', banned: true }, webA)).status, 403);
});

test('client authentication, exact redirect and PKCE precede atomic one-time exchange', async () => {
  const subject = await register('sso-exchange-qa');
  const web = await signIn('sso-exchange-qa');
  const approval = await issue(web);
  assert.equal((await exchange(approval, {}, 'Basic invalid')).status, 401);
  assert.equal((await exchange(approval, { redirect_uri: dsOrigin + '/' })).status, 400);
  assert.equal((await exchange(approval, { code_verifier: token() })).status, 400);
  const responses = await Promise.all([exchange(approval), exchange(approval)]);
  assert.deepEqual(responses.map(({status}) => status).sort(), [200, 400]);
  const { body: grant } = responses.find(({status}) => status === 200);
  assert.equal(grant.iss, issuer);
  assert.equal(grant.aud, clientId);
  assert.equal(grant.sub, subject);
  assert.deepEqual(Object.keys(grant).sort(), ['aud', 'exp', 'grant_id', 'iat', 'iss', 'sub']);
  assert.ok(grant.exp > grant.iat && grant.exp <= grant.iat + 28800);
  assert.deepEqual((await introspect(grant)).body, { active: true, ...grant });
});

test('expired codes, single-device logout and logout-all independently revoke authorization', async () => {
  const userId = await register('sso-revocation-qa');
  const web = await signIn('sso-revocation-qa');
  const other = await signIn('sso-revocation-qa');
  const old = await issue(web);
  await db.prepare('UPDATE aeris_ds_sso_requests SET code_expires_at = unixepoch() WHERE user_id = ?')
    .bind(userId).run();
  assert.equal((await exchange(old)).status, 400);
  const firstGrant = (await exchange(await issue(web))).body;
  const otherGrant = (await exchange(await issue(other))).body;
  const unused = await issue(web);
  assert.equal((await json('/api/logout', {}, web)).status, 200);
  assert.equal((await exchange(unused)).status, 400);
  assert.deepEqual((await introspect(firstGrant)).body, { active: false });
  assert.equal((await introspect(otherGrant)).body.active, true);
  const status = await first('SELECT revoked_at,revoke_reason FROM aeris_ds_sso_grants WHERE grant_id = ?', firstGrant.grant_id);
  assert.ok(status.revoked_at);
  assert.equal(status.revoke_reason, 'source_invalid');
  assert.equal((await json('/api/account/logout-all', {}, other)).status, 200);
  assert.deepEqual((await introspect(otherGrant)).body, { active: false });
});

test('password change and policy reacceptance invalidate grants', async () => {
  const subject = await register('sso-security-version-qa');
  const session = await signIn('sso-security-version-qa');
  const firstGrant = (await exchange(await issue(session))).body;
  const { grant } = await stepup(session, 'password_change');
  const nextPassword = password + 'changed';
  assert.equal((await json('/api/account/secret', { new_secret: nextPassword, confirm_secret: nextPassword, grant }, session)).status, 200);
  assert.deepEqual((await introspect(firstGrant)).body, { active: false });
  const otherSubject = await register('sso-policy-qa');
  const active = await signIn('sso-policy-qa');
  const secondGrant = (await exchange(await issue(active))).body;
  await db.prepare("INSERT OR REPLACE INTO task12_metadata(key,value) VALUES('task27_require_policy_reaccept','1')").run();
  await db.prepare('DELETE FROM task27_policy_consents WHERE user_id = ?').bind(otherSubject).run();
  assert.equal((await json(prefix + 'prepare?' + authorizeInput().query, {}, active)).status, 428);
  assert.deepEqual((await introspect(secondGrant)).body, { active: false });
  assert.equal((await json('/api/policies/accept', { terms_accepted: true, policy_versions: POLICY_VERSIONS }, active)).status, 200);
  assert.deepEqual((await introspect(secondGrant)).body, { active: false });
  assert.ok(subject);
});

test('registered MFA must be completed before the source can approve DS', async () => {
  await register('sso-mfa-qa');
  const web = await signIn('sso-mfa-qa');
  const { grant } = await stepup(web, 'mfa_change');
  const setup = await json('/api/security/mfa/start', { method: 'totp', grant }, web);
  assert.equal(setup.status, 200);
  const enroll = await json('/api/security/mfa/confirm', {
    challenge: setup.body.challenge, code: await totpAt(setup.body.secret, Math.floor(Date.now() / 30000)),
  }, web);
  assert.equal(enroll.status, 200);
  const pending = await json('/api/login', { username: 'sso-mfa-qa', secret: password });
  assert.equal(pending.body.mfa_required, true);
  assert.equal(pending.body.session, undefined);
  const login = await json('/api/security/login/verify', {
    challenge: pending.body.challenge, code: enroll.body.recovery_codes[0],
  });
  assert.equal(login.status, 200);
  const session = login.body.session;
  const prepared = await prepare(session);
  const proof = await stepup(session, 'ds_sso_authorize:' + prepared.nonce);
  assert.equal(proof.grant, undefined);
  assert.equal(proof.method, 'totp');
  assert.equal((await json(prefix + 'approve', {
    authorization: prepared.nonce, grant: proof.challenge, confirm: true,
  }, session)).status, 400);
  const verified = await json('/api/security/stepup/verify', {
    challenge: proof.challenge, code: enroll.body.recovery_codes[1],
  }, session);
  assert.equal(verified.status, 200);
  assert.equal((await exchange(await approve(session, prepared, verified.body.grant))).status, 200);
});
