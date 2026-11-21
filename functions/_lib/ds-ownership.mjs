import { featureFlags } from './cloudflare-foundation.mjs';
import { createSessionToken, sessionStorageKey } from './task12-crypto.mjs';
import { Task12Error } from './task12-model.mjs';
import { authenticateTask12Password } from './task12-service.mjs';
import { challengeRow, createChallenge, securityRate, sendCode, verifyChallenge } from './task27-auth.mjs';
import { randomDigits } from './task27-crypto.mjs';
import { acceptLoginPassword, reserveLoginAttempt, settleLoginError } from './task27-login-guard.mjs';
import { POLICY_VERSIONS } from './task27-policy.mjs';
import { first, nowIso, rows, run, securityState, stmt } from './task27-store.mjs';
import { opaque, unixTime } from './ds-native-crypto.mjs';
import { liveNativeGrant, nativeGrantStatus, readEnvelope, saveEnvelope } from './ds-native-store.mjs';

export const ownershipOperations = new Set(['ownership_start', 'ownership_verify', 'ownership_status']);
const purpose = 'ds_account_ownership_v1';
const policy = [POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy, POLICY_VERSIONS.security];
const error = (code, status) => new Task12Error('Ownership verification unavailable', status, code);
const denied = () => error('ownership_denied', 403);

const targetState = `
  u.deleted = 0 AND u.banned = 0 AND sec.must_change_password = 0
  AND NOT EXISTS (SELECT 1 FROM aeris_ds_ownership_recovery_holds h WHERE h.user_id = u.id)
  AND (
    NOT EXISTS (SELECT 1 FROM task12_metadata WHERE key = 'task27_require_policy_reaccept' AND value = '1')
    OR EXISTS (
      SELECT 1 FROM task27_policy_consents c WHERE c.user_id = u.id
        AND c.terms_version = ? AND c.privacy_version = ? AND c.security_version = ?
    )
  )
`;
const targetVersion = `
  u.id = ? AND u.id != ? AND u.session_version = ? AND sec.version = ?
  AND u.password_hash = ? AND sec.mfa_method = ?
  AND ${targetState}
`;

function exact(input, fields) {
  return Object.keys(input).length === fields.length && fields.every(key => Object.hasOwn(input, key));
}

function version(user, state) {
  return [user.id, user.session_version, state.version, user.password_hash, state.mfa_method];
}

function targetParams(snapshot, actor) {
  const [id, userVersion, securityVersion, passwordHash, method] = snapshot;
  return [id, actor.sub, userVersion, securityVersion, passwordHash, method, ...policy];
}

async function password(context, username, secret, ip) {
  const headers = ip ? { 'CF-Connecting-IP': ip } : {};
  const child = { env: context.env, request: new Request(context.request.url, { headers }) };
  const ticket = await reserveLoginAttempt(child, username);
  if (!ticket.allowed) throw error('ownership_rate_limited', 429);
  try {
    const { row } = await authenticateTask12Password(context.env.WYJ_DB, username, secret, {
      passwordPepper: context.env.WYJ_TASK12_PASSWORD_PEPPER,
    });
    await acceptLoginPassword(child, ticket);
    return row;
  } catch (failure) {
    await settleLoginError(child, ticket, failure);
    if (failure instanceof Task12Error && failure.status < 500) throw denied();
    throw failure;
  }
}

async function issue(db, client, actor, binding, snapshot, contact) {
  const now = unixTime();
  const expiry = Math.min(actor.exp, now + 600);
  if (expiry <= now) throw denied();
  const id = createSessionToken();
  const attempt = await sessionStorageKey(binding);
  const live = liveNativeGrant(client, actor.grant_id, now);
  const result = await db.batch([
    stmt(db, `DELETE FROM aeris_ds_ownership_proofs WHERE proof_id IN (
      SELECT proof_id FROM aeris_ds_ownership_proofs WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
    )`, [now]),
    stmt(db, `INSERT INTO aeris_ds_ownership_proofs (
      proof_id, attempt_digest, actor_grant, target_id, target_session_version,
      target_security_version, method, terms_version, privacy_version, security_policy_version, issued_at, expires_at
    ) SELECT ?, ?, ?, u.id, u.session_version, sec.version, sec.mfa_method, ?, ?, ?, ?, ?
      FROM task12_users u JOIN task27_security sec ON sec.user_id = u.id
      WHERE ${targetVersion} AND EXISTS (${live.sql})
      ON CONFLICT DO NOTHING
      RETURNING target_id, target_session_version, target_security_version, method,
        (SELECT username FROM task12_users WHERE id = target_id) AS label,
        (SELECT email_verified_at != '' AND lower(trim(verified_email)) = ?
          FROM task27_security WHERE user_id = target_id) AS contact_matches`,
    [id, attempt, actor.grant_id, ...policy, now, expiry, ...targetParams(snapshot, actor), ...live.args, contact]),
  ]);
  const proof = result[1].results[0];
  if (!proof) throw denied();
  return {
    stage: 'verified',
    proof: {
      iss: client.issuer, aud: client.clientId, actor_sub: actor.sub, actor_grant: actor.grant_id,
      binding, sub: proof.target_id, proof_id: id, purpose, label: proof.label,
      contact_matches: proof.contact_matches === 1, method: proof.method,
      session_version: proof.target_session_version, security_version: proof.target_security_version,
      iat: now, exp: expiry,
    },
  };
}

async function status(db, client, actor, refs) {
  const now = unixTime();
  const live = liveNativeGrant(client, actor.grant_id, now);
  return { active: (await rows(db, `SELECT p.proof_id FROM aeris_ds_ownership_proofs p
    JOIN task12_users u ON u.id = p.target_id
    JOIN task27_security sec ON sec.user_id = u.id
    WHERE p.actor_grant = ? AND p.expires_at > ?
      AND p.target_session_version = u.session_version AND p.target_security_version = sec.version
      AND p.method = sec.mfa_method
      AND p.terms_version = ? AND p.privacy_version = ? AND p.security_policy_version = ?
      AND ${targetState} AND EXISTS (${live.sql})
      AND p.proof_id IN (${refs.map(() => '?').join(', ')})`,
  [actor.grant_id, now, ...policy, ...policy, ...live.args, ...refs])).map(row => row.proof_id) };
}

async function begin(context, client, cipher, actor, binding, input, ip) {
  if (!exact(input, ['username', 'secret', 'contact']) || typeof input.username !== 'string'
    || !input.username.trim() || input.username.length > 40 || typeof input.secret !== 'string'
    || !input.secret || input.secret.length > 256) throw error('invalid_request', 400);
  const db = context.env.WYJ_DB;
  const user = await password(context, input.username, input.secret, ip);
  const state = await securityState(db, user.id);
  const snapshot = version(user, state);
  if (state.mfa_method === 'none') return issue(db, client, actor, binding, snapshot, input.contact);

  const live = liveNativeGrant(client, actor.grant_id, unixTime());
  if (!await first(db, `SELECT 1 FROM task12_users u JOIN task27_security sec ON sec.user_id = u.id
    WHERE ${targetVersion} AND EXISTS (${live.sql})`, [...targetParams(snapshot, actor), ...live.args])) throw denied();

  // The canonical verifier accepts only the enrolled factor for this independent purpose.
  const method = state.mfa_method;
  await securityRate(context, 'login-challenge', user.id);
  const code = method === 'email' ? randomDigits() : '';
  const challenge = await createChallenge(db, {
    user, state, kind: 'stepup', method, sessionDigest: await sessionStorageKey(binding),
    scope: purpose, code, env: context.env,
  });
  try {
    const expiry = Math.min(actor.exp, Math.floor(Date.parse(challenge.expires_at) / 1000));
    if (!await saveEnvelope(db, cipher, 'ownership_mfa', binding, actor.grant_id, challenge.token, expiry, false)) {
      throw denied();
    }
    if (method === 'email') {
      await sendCode(context.env, state.verified_email, code, 'DS 账户所有权验证', context.data?.requestId,
        { userId: user.id, challengeDigest: challenge.digest });
    }
    return { stage: 'mfa_required', method, expires_at: expiry };
  } catch (failure) {
    await run(db, 'UPDATE task27_challenges SET consumed_at = ? WHERE token_digest = ?', [nowIso(), challenge.digest]);
    if (failure instanceof Task12Error) throw failure;
    throw error('ownership_unavailable', 503);
  }
}

async function confirm(context, client, cipher, actor, binding, input) {
  if (!exact(input, ['code', 'contact']) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) {
    throw error('invalid_request', 400);
  }
  const db = context.env.WYJ_DB;
  const digest = await sessionStorageKey(binding);
  const token = await readEnvelope(db, cipher, 'ownership_mfa', binding, actor.grant_id);
  if (!token) throw error('ownership_challenge_closed', 409);
  let snapshot;
  try {
    const challenge = await challengeRow(db, token, 'stepup', digest);
    if (challenge.scope !== purpose || !['totp', 'email'].includes(challenge.method)) throw denied();
    const { row, user } = await verifyChallenge(db, context.env, token, 'stepup', input.code, { sessionDigest: digest });
    // Use the generations verified by the atomic challenge consumption.
    snapshot = [user.id, row.session_version, row.security_version, user.password_hash, row.method];
  } catch (failure) {
    if (!(failure instanceof Task12Error) || failure.status >= 500) throw failure;
    if (failure.code !== 'security_verification_failed') throw error('ownership_challenge_closed', 409);
    try {
      await challengeRow(db, token, 'stepup', digest);
    } catch (closed) {
      if (!(closed instanceof Task12Error)) throw closed;
      throw error('ownership_challenge_closed', 409);
    }
    throw error('ownership_mfa_failed', 400);
  }
  return issue(db, client, actor, binding, snapshot, input.contact);
}

export async function handleDsOwnership(context, client, cipher, op, input, grant, binding, ip) {
  const { env } = context;
  const db = env.WYJ_DB;
  if (!client.ownershipEnabled || !featureFlags(env).task12CloudAccounts) {
    throw error('ownership_unavailable', 503);
  }
  if (!opaque(grant)) throw error('invalid_request', 400);
  await securityRate(context, op, grant, op === 'ownership_status' ? 90 : 16, 60);
  const actor = await nativeGrantStatus(db, client, grant);
  if (!actor.active) throw error('session_invalid', 401);
  if (op === 'ownership_status') {
    const { refs } = input;
    if (!exact(input, ['refs']) || !Array.isArray(refs) || refs.length < 1 || refs.length > 16
      || !refs.every(opaque) || new Set(refs).size !== refs.length) throw error('invalid_request', 400);
    return status(db, client, actor, refs);
  }
  if (!opaque(binding) || typeof input.contact !== 'string' || input.contact.length > 254
    || !/^[!-~]+@[!-~]+$/.test(input.contact) || input.contact !== input.contact.toLowerCase()) {
    throw error('invalid_request', 400);
  }
  if (await first(db, 'SELECT 1 FROM aeris_ds_ownership_recovery_holds WHERE user_id = ?', [actor.sub])) throw denied();
  if (op === 'ownership_start') return begin(context, client, cipher, actor, binding, input, ip);
  return confirm(context, client, cipher, actor, binding, input);
}
