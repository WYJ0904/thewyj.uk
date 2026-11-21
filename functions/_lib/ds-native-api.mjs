import { handleTask12Request } from './task12-api.mjs';
import { handleDsOwnership, ownershipOperations } from './ds-ownership.mjs';
import { handleOwnershipReviewStaff, reviewerRoute } from './ds-ownership-review-staff.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { createSessionToken } from './task12-crypto.mjs';
import { Task12Error } from './task12-model.mjs';
import { handleTask27Request } from './task27-api.mjs';
import { securityRate, task27EnrollmentEnabled } from './task27-auth.mjs';
import { POLICY_CONTENT } from './task27-policy-content.mjs';
import { POLICY_VERSIONS } from './task27-policy.mjs';
import { hasTask27 } from './task27-store.mjs';
import { envelopeCipher, opaque, unixTime, verifyBackchannel } from './ds-native-crypto.mjs';
import {
  issueNativeGrant, nativeGrantStatus, nativeSchemaReady, readEnvelope, reserveNonce, revokeNativeGrant, saveEnvelope,
} from './ds-native-store.mjs';

const route = '/api/internal/ds-identity/v1';
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const scopes = new Set(['profile_change', 'password_change', 'email_change', 'mfa_change', 'recovery_regenerate', 'sessions_revoke']);
const loginActions = new Set(['login', 'login_verify', 'password_force', 'policy_accept', 'recovery_start', 'recovery_finish']);
const accountActions = new Map([
  ['profile', { path: '/api/account/profile', read: true, output: ['username', 'registered_at', 'revision', 'username_editable'] }],
  ['profile_save', { path: '/api/account/profile', fields: ['username', 'expected_revision'], proof: true,
    output: ['username', 'registered_at', 'revision', 'username_editable'] }],
  ['password_change', { path: '/api/account/secret', fields: ['new_secret', 'confirm_secret'], proof: true }],
  ['security', { path: '/api/security/overview', read: true,
    output: ['email', 'email_verified_at', 'mfa_method', 'recovery_codes_remaining', 'enrollment_enabled', 'email_sending_enabled', 'sessions'] }],
  ['stepup', { path: '/api/security/stepup', fields: ['password', 'scope'], outputKind: 'stepup' }],
  ['stepup_verify', { path: '/api/security/stepup/verify', fields: ['code'], challenge: 'stepup', outputKind: 'stepup' }],
  ['email_start', { path: '/api/security/email/start', fields: ['email'], proof: true, outputKind: 'email' }],
  ['email_confirm', { path: '/api/security/email/confirm', fields: ['code'], challenge: 'email' }],
  ['mfa_start', { path: '/api/security/mfa/start', fields: ['method'], proof: true, outputKind: 'mfa',
    output: ['secret', 'otpauth_uri'] }],
  ['mfa_confirm', { path: '/api/security/mfa/confirm', fields: ['code'], challenge: 'mfa', output: ['recovery_codes'] }],
  ['mfa_disable', { path: '/api/security/mfa/disable', proof: true }],
  ['recovery_codes', { path: '/api/security/recovery/regenerate', proof: true, output: ['recovery_codes'] }],
  ['devices_revoke', { path: '/api/security/sessions/revoke', fields: ['mode', 'id', 'kind'], proof: true }],
]);

const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const error = (code, status) => new Task12Error('Identity operation rejected', status, code);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const select = (input, fields = []) => Object.fromEntries(fields.flatMap(key =>
  Object.hasOwn(input, key) ? [[key, input[key]]] : []));

function previewOrigin(url, project) {
  const [branch, projectLabel, ...suffix] = url.hostname.split('.');
  return url.protocol === 'https:' && !url.port && /^[a-z0-9-]+$/.test(branch)
    && projectLabel === project && suffix.join('.') === 'pages.dev';
}

function registration(env, url) {
  const { AERIS_DS_SSO_ENABLED: enabled, AERIS_DS_SSO_CLIENT_ID: clientId, AERIS_DS_SSO_CLIENT_SECRET: secret,
    AERIS_DS_SSO_ISSUER: issuer, AERIS_DS_SSO_ORIGIN: primaryOrigin } = env;
  if (enabled !== 'true' || !task27EnrollmentEnabled(env)
    || !/^[A-Za-z0-9._-]{1,64}$/.test(clientId || '') || !/^[A-Za-z0-9_-]{43,128}$/.test(secret || '')) return null;

  const preview = env.WYJ_ENVIRONMENT === 'preview';
  const ownershipFlag = env.AERIS_DS_OWNERSHIP_ENABLED === 'true';
  const alternate = preview && ownershipFlag && issuer !== url.origin
    && env.AERIS_DS_OWNERSHIP_PREVIEW_HOST === url.origin;
  if (!alternate && issuer !== url.origin) return null;
  const origin = alternate ? env.AERIS_DS_OWNERSHIP_DS_ORIGIN : primaryOrigin;
  if (alternate && origin === primaryOrigin) return null;
  let ds;
  let identity;
  try {
    ds = new URL(origin);
    identity = new URL(issuer);
  } catch { return null; }
  if (ds.origin !== origin || identity.origin !== issuer || origin === issuer) return null;
  if (preview) {
    if (![url, identity].every(host => previewOrigin(host, 'thewyj-uk')) || !previewOrigin(ds, 'ds-thewyj-uk')) return null;
  } else if (env.WYJ_ENVIRONMENT === 'development') {
    if (![url, ds].every(x => ['localhost', '127.0.0.1'].includes(x.hostname) && ['http:', 'https:'].includes(x.protocol))) return null;
  } else return null;

  return { clientId, secret, issuer, origin, ownershipEnabled: ownershipFlag && (alternate || !preview) };
}

async function boundedBody(request) {
  const capacity = 8192;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw error('invalid_request', 415);
  if (Number(request.headers.get('Content-Length') || 0) > capacity) throw error('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw error('invalid_request', 400);
  const bytes = new Uint8Array(capacity);
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > capacity) {
        await reader.cancel();
        throw error('request_too_large', 413);
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}

async function canonical(context, path, { session = '', payload, ip = '' } = {}) {
  const issuer = new URL(context.request.url).origin;
  const headers = new Headers({ Origin: issuer, 'User-Agent': 'DS account gateway' });
  if (session) headers.set('X-Session-Token', session);
  if (ip) headers.set('CF-Connecting-IP', ip);
  if (payload) headers.set('Content-Type', 'application/json');
  const request = new Request(issuer + path, {
    method: payload ? 'POST' : 'GET', headers, body: payload ? JSON.stringify(payload) : undefined,
  });
  const child = { request, env: context.env, data: context.data, waitUntil: work => context.waitUntil(work) };
  const response = await handleTask27Request(child) || await handleTask12Request(child);
  if (!response) throw error('operation_unavailable', 503);
  const body = await response.json();
  if (!response.ok) {
    const code = typeof body.code === 'string' && /^[a-z0-9_]{1,80}$/.test(body.code) ? body.code : 'operation_failed';
    throw error(code, response.status);
  }
  return body;
}

async function authResult(context, client, cipher, binding, result) {
  const db = context.env.WYJ_DB;
  const expires = Math.min(unixTime() + 300, Math.floor(Date.parse(result.expires_at) / 1000) || Infinity);
  if (opaque(result.session)) {
    const request = new Request(client.issuer + '/api/me', { headers: { 'X-Session-Token': result.session } });
    const source = await resolveTask12Account({ request, env: context.env }, { touch: false });
    if (source.status === 428) {
      await saveEnvelope(db, cipher, 'policy_accept', binding, client.clientId, result.session, expires);
      return { stage: 'policy_required' };
    }
    if (!source.authenticated) throw error('authentication_required', source.status || 401);
    const grant = await issueNativeGrant(db, client, cipher, result.session);
    if (!grant) throw error('authentication_required', 401);
    return { stage: 'authenticated', claims: grant };
  }
  const stage = result.password_change_required ? 'password_force' : result.mfa_required ? 'login_verify' : null;
  const token = stage === 'password_force' ? result.password_change_token : result.challenge;
  if (!stage || !opaque(token)) throw error('operation_unavailable', 503);
  await saveEnvelope(db, cipher, stage, binding, client.clientId, token, expires);
  return { stage, ...select(result, ['method', 'expires_at']) };
}

async function unauthenticated(context, client, cipher, action, input, binding, ip) {
  const db = context.env.WYJ_DB;
  if (!opaque(binding)) throw error('invalid_request', 400);
  if (action === 'login') {
    const result = await canonical(context, '/api/login', { payload: select(input, ['username', 'secret']), ip });
    return authResult(context, client, cipher, binding, result);
  }
  if (action === 'recovery_start') {
    const result = await canonical(context, '/api/security/password/request', {
      payload: select(input, ['username', 'email', 'method']), ip,
    });
    await saveEnvelope(db, cipher, 'recovery_finish', binding, client.clientId, result.challenge, unixTime() + 300);
    return { stage: 'recovery_finish', ...select(result, ['expires_at']) };
  }
  const token = await readEnvelope(db, cipher, action, binding, client.clientId);
  if (!token) throw error('flow_expired', 400);
  if (action === 'policy_accept') {
    await canonical(context, '/api/policies/accept', { session: token, payload: select(input, ['terms_accepted', 'policy_versions']), ip });
    return authResult(context, client, cipher, binding, { session: token });
  }
  if (action === 'login_verify') {
    const result = await canonical(context, '/api/security/login/verify', { payload: { challenge: token, code: input.code }, ip });
    return authResult(context, client, cipher, binding, result);
  }
  const path = action === 'password_force' ? '/api/security/password/complete' : '/api/security/password/reset';
  await canonical(context, path, { payload: { ...select(input, ['code', 'new_secret', 'confirm_secret']), challenge: token }, ip });
  return { stage: 'signin_required' };
}

async function accountOperation(context, client, cipher, definition, action, input, grant, ip) {
  const db = context.env.WYJ_DB;
  const active = await nativeGrantStatus(db, client, grant);
  if (!active.active) throw error('session_invalid', 401);
  const source = await readEnvelope(db, cipher, 'source', grant, client.clientId);
  if (!source) throw error('session_invalid', 401);
  if (action === 'stepup' && !scopes.has(input.scope)) throw error('invalid_request', 400);
  const payload = definition.read ? undefined : select(input, definition.fields);
  if (definition.proof || definition.challenge) {
    if (!opaque(input.ref)) throw error('flow_expired', 400);
    const token = await readEnvelope(db, cipher, definition.proof ? 'proof' : definition.challenge, input.ref, grant);
    if (!token) throw error('flow_expired', 400);
    payload[definition.proof ? 'grant' : 'challenge'] = token;
  }
  const result = await canonical(context, definition.path, { session: source, payload, ip });
  if (result.session_invalidated) await revokeNativeGrant(db, client, grant);
  const safe = { ...select(result, definition.output), ...select(result, ['session_invalidated', 'method', 'expires_at']) };
  if (opaque(result.grant) || opaque(result.challenge)) {
    const ref = createSessionToken();
    await saveEnvelope(db, cipher, result.grant ? 'proof' : definition.outputKind, ref, grant,
      result.grant || result.challenge, unixTime() + 300);
    return { ...safe, ref, verification: result.grant ? 'ready' : 'challenge' };
  }
  return safe;
}

export async function handleDsNativeRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname===reviewerRoute) return handleOwnershipReviewStaff(context, registration(env,url), boundedBody);
  if (url.pathname.startsWith('/api/sso/ds/')) return json({ error: 'not_found' }, 404);
  if (url.pathname !== route) return null;
  const client = registration(env, url);
  if (!client) return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (url.search) return json({ error: 'invalid_request' }, 400);
  let auditOperation = 'invalid';
  try {
    const raw = await boundedBody(request);
    const nonce = await verifyBackchannel(request, client, raw);
    if (!nonce) return json({ error: 'invalid_client' }, 401);
    const db = env.WYJ_DB;
    if (!opaque(env.AERIS_DS_NATIVE_SEAL_KEY) || !await hasTask27(db) || !await nativeSchemaReady(db)) {
      return json({ error: 'operation_unavailable' }, 503);
    }
    if (!await reserveNonce(db, nonce)) return json({ error: 'request_replayed' }, 409);
    let envelope;
    try { envelope = JSON.parse(raw); } catch { throw error('invalid_request', 400); }
    if (!object(envelope) || !object(envelope.input)) throw error('invalid_request', 400);
    const { op, input, binding, grant } = envelope;
    const ip = typeof envelope.ip === 'string' && /^[0-9a-f:.]{1,45}$/i.test(envelope.ip) ? envelope.ip : '';
    if (op === 'introspect' || op === 'revoke') {
      auditOperation = op;
      if (!opaque(grant)) throw error('invalid_request', 400);
      await securityRate(context, 'ds-native-' + op, client.clientId, 600, 60);
      if (op === 'introspect') return json(await nativeGrantStatus(db, client, grant));
      await revokeNativeGrant(db, client, grant);
      return json({ revoked: true });
    }
    if (op === 'policies') {
      return json({ versions: POLICY_VERSIONS, documents: Object.values(POLICY_CONTENT).map(x => ({ title: x.title, body: x.body })) });
    }
    await securityRate(context, 'ds-native-operate', ip || client.clientId, 90, 60);
    if (op === 'register') {
      auditOperation = op;
      await canonical(context, '/api/register', { payload: select(input, ['username', 'secret', 'confirm_secret', 'terms_accepted', 'policy_versions']), ip });
      return json({ stage: 'signin_required' }, 201);
    }
    const cipher = await envelopeCipher(env.AERIS_DS_NATIVE_SEAL_KEY);
    if (ownershipOperations.has(op)) {
      auditOperation = op;
      return json(await handleDsOwnership(context, client, cipher, op, input, grant, binding, ip));
    }
    if (loginActions.has(op)) {
      auditOperation = op;
      return json(await unauthenticated(context, client, cipher, op, input, binding, ip));
    }
    const definition = accountActions.get(op);
    if (definition && opaque(grant)) {
      auditOperation = op;
      return json(await accountOperation(context, client, cipher, definition, op, input, grant, ip));
    }
    return json({ error: 'invalid_request' }, 400);
  } catch (failure) {
    if (failure instanceof Task12Error) return json({ error: failure.code }, failure.status);
    console.error(JSON.stringify({ event: 'ds_native_identity_unavailable', operation: auditOperation }));
    return json({ error: 'operation_unavailable' }, 503);
  }
}
