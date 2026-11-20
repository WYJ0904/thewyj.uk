import { explicitWebSessionToken } from './task20-model.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { sessionStorageKey } from './task12-crypto.mjs';
import { Task12Error } from './task12-model.mjs';
import { equalText } from './task27-crypto.mjs';
import { readJsonBounded } from './task27-api.mjs';
import { securityRate, task27EnrollmentEnabled } from './task27-auth.mjs';
import { fail, hasTask27 } from './task27-store.mjs';
import { authorizationPage, callbackUrl, secureHeaders } from './ds-sso-page.mjs';
import {
  approveAuthorization, exchangeAuthorization, introspectAuthorization, prepareAuthorization, ssoSchemaReady,
} from './ds-sso-store.mjs';

const prefix = '/api/sso/ds/';
const methods = new Map([
  ['authorize', 'GET'], ['prepare', 'POST'], ['approve', 'POST'], ['exchange', 'POST'], ['introspect', 'POST'],
]);
const authParams = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'prompt'];
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function response(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...secureHeaders, ...headers } });
}

function registeredClient(env, target) {
  const { AERIS_DS_SSO_ENABLED: enabled, AERIS_DS_SSO_ISSUER: issuer, AERIS_DS_SSO_CALLBACK: redirectUri,
    AERIS_DS_SSO_CLIENT_ID: clientId, AERIS_DS_SSO_CLIENT_SECRET: clientSecret } = env;
  if (enabled !== 'true' || issuer !== target.origin || !task27EnrollmentEnabled(env)) return null;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clientId || '')
    || !/^[A-Za-z0-9_-]{43,128}$/.test(clientSecret || '')) return null;
  let callback;
  try { callback = new URL(redirectUri); } catch { return null; }
  if (redirectUri !== callback.origin + '/api/auth/callback' || callback.origin === target.origin) return null;
  if (env.WYJ_ENVIRONMENT === 'preview') {
    if (target.protocol !== 'https:' || callback.protocol !== 'https:' || target.port || callback.port
      || !/^[a-z0-9-]+\.thewyj-uk\.pages\.dev$/.test(target.hostname)
      || !/^[a-z0-9-]+\.ds-thewyj-uk\.pages\.dev$/.test(callback.hostname)) return null;
  } else if (env.WYJ_ENVIRONMENT === 'development') {
    const isLoopback = (url) => ['127.0.0.1', 'localhost'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
    if (!isLoopback(target) || !isLoopback(callback)) return null;
  } else {
    return null;
  }
  return { issuer, redirectUri, clientId, clientSecret };
}

function fieldsMatch(iterable, expected) {
  const fields = [...iterable];
  return fields.length === expected.length && expected.every(key => fields.includes(key));
}

function authorizationInput(url, client) {
  const query = url.searchParams;
  if (url.search.length > 2048 || !fieldsMatch(query.keys(), authParams)
    || query.get('client_id') !== client.clientId || query.get('redirect_uri') !== client.redirectUri
    || query.get('response_type') !== 'code' || query.get('prompt') !== 'select_account'
    || query.get('code_challenge_method') !== 'S256') return null;
  const state = query.get('state');
  const challenge = query.get('code_challenge');
  return opaque(state) && opaque(challenge) ? { state, challenge } : null;
}

async function webActor(context) {
  const identity = await resolveTask12Account(context, { token: explicitWebSessionToken(context.request), touch: false });
  if (!identity.authenticated) fail(identity.code, '请先登录 Aeris 并完成所需的安全确认', identity.status);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(identity.account.id)) fail('account_unavailable', '此账户暂不可授权', 403);
  return {
    userId: identity.account.id,
    username: identity.account.username,
    sessionDigest: await sessionStorageKey(identity.token),
  };
}

async function formParams(request, expected) {
  const limit = 1024;
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    fail('invalid_request', '请求格式无效', 415);
  }
  if (Number(request.headers.get('Content-Length') || 0) > limit) fail('request_too_large', '请求过大', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('invalid_request', '请求格式无效');
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > limit) {
        await reader.cancel();
        fail('request_too_large', '请求过大', 413);
      }
      buffer.set(value, size);
      size += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const input = new URLSearchParams(new TextDecoder().decode(buffer.subarray(0, size)));
  if (!fieldsMatch(input.keys(), expected)) fail('invalid_request', '请求字段无效');
  return input;
}

async function exchange(context, client) {
  const params = await formParams(context.request, ['grant_type', 'code', 'redirect_uri', 'code_verifier']);
  const code = params.get('code');
  const verifier = params.get('code_verifier');
  if (!opaque(code) || !opaque(verifier) || params.get('grant_type') !== 'authorization_code'
    || params.get('redirect_uri') !== client.redirectUri) return response({ error: 'invalid_grant' }, 400);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const result = await exchangeAuthorization(context.env.WYJ_DB, client, code, challenge);
  return result ? response(result) : response({ error: 'invalid_grant' }, 400);
}

export async function handleDsSsoRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  const action = url.pathname.slice(prefix.length);
  const method = methods.get(action);
  const client = registeredClient(env, url);
  if (!method || !client) return response({ error: 'not_found' }, 404);
  if (request.method !== method) return response({ error: 'method_not_allowed' }, 405, { Allow: method });

  const browser = ['authorize', 'prepare', 'approve'].includes(action);
  const db = env.WYJ_DB;
  try {
    if (browser && method === 'POST' && (
      request.headers.get('Origin') !== client.issuer || request.headers.get('X-Aeris-SSO') !== '1'
    )) return response({ error: 'csrf_rejected' }, 403);
    if (!browser) {
      const expected = 'Basic ' + btoa(client.clientId + ':' + client.clientSecret);
      const authorization = request.headers.get('Authorization') ?? '';
      if (authorization.length !== expected.length || !equalText(authorization, expected)) {
        return response({ error: 'invalid_client' }, 401);
      }
    }
    if (!db || !await hasTask27(db) || !await ssoSchemaReady(db)) return response({ error: 'sso_unavailable' }, 503);
    if (action === 'authorize' || action === 'prepare') {
      const input = authorizationInput(url, client);
      if (!input) return response({ error: 'invalid_request' }, 400);
      if (action === 'authorize') {
        await securityRate(context, 'ds-sso-authorize', '', 90, 60);
        return authorizationPage(client, input);
      }
      const payload = await readJsonBounded(request, 128);
      if (Object.keys(payload).length) return response({ error: 'invalid_request' }, 400);
      const actor = await webActor(context);
      await securityRate(context, 'ds-sso-prepare', actor.userId, 12, 60);
      const nonce = await prepareAuthorization(db, client, input, actor);
      if (!nonce) return response({ error: 'authentication_required' }, 401);
      return response({ authorization: nonce, account: actor.username });
    }
    if (url.search) return response({ error: 'invalid_request' }, 400);
    if (action === 'approve') {
      const payload = await readJsonBounded(request, 512);
      if (!fieldsMatch(Object.keys(payload), ['authorization', 'grant', 'confirm'])
        || !opaque(payload.authorization) || !opaque(payload.grant) || payload.confirm !== true) {
        return response({ error: 'invalid_request' }, 400);
      }
      const actor = await webActor(context);
      await securityRate(context, 'ds-sso-approve', actor.userId, 12, 60);
      const approval = await approveAuthorization(db, client, actor, payload.authorization, payload.grant);
      return response({ redirect: callbackUrl(client, approval.state, approval.code) });
    }
    await securityRate(context, 'ds-sso-' + action, client.clientId, action === 'exchange' ? 120 : 600, 60);
    if (action === 'exchange') return await exchange(context, client);
    const params = await formParams(request, ['grant_id']);
    const grant = params.get('grant_id');
    return opaque(grant)
      ? response(await introspectAuthorization(db, client, grant))
      : response({ error: 'invalid_request' }, 400);
  } catch (error) {
    if (error instanceof Task12Error) {
      return response({ error: error.code }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
    }
    console.error(JSON.stringify({ event: 'aeris_ds_sso_unavailable', route: action }));
    return response({ error: 'sso_unavailable' }, 503);
  }
}
