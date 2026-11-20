import { POLICY_VERSIONS } from './task27-policy.mjs';
import { activeUser, assertion, atomic, first, securityState, stmt } from './task27-store.mjs';
import { grantStatements } from './task27-auth.mjs';
import { createSessionToken, sessionStorageKey } from './task12-crypto.mjs';

const requestTtl = 5 * 60;
const codeTtl = 60;
const grantTtl = 8 * 60 * 60;
const retention = 7 * 24 * 60 * 60;
const time = () => Math.floor(Date.now() / 1000);
const policy = [POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy, POLICY_VERSIONS.security];
const selectSource = `
  JOIN task12_sessions AS source ON source.token_digest = r.session_digest AND source.user_id = r.user_id
  JOIN task12_users AS u ON u.id = source.user_id
  JOIN task27_security AS sec ON sec.user_id = u.id
`;
const validSource = `
  source.revoked = 0 AND source.client_kind != 'android_app' AND unixepoch(source.expires_at) > ?
  AND u.banned = 0 AND u.deleted = 0 AND sec.must_change_password = 0
  AND source.session_version = u.session_version AND r.session_version = u.session_version
  AND r.security_version = sec.version
  AND (
    NOT EXISTS (SELECT 1 FROM task12_metadata WHERE key = 'task27_require_policy_reaccept' AND value = '1')
    OR EXISTS (
      SELECT 1 FROM task27_policy_consents AS c WHERE c.user_id = u.id
      AND c.terms_version = ? AND c.privacy_version = ? AND c.security_version = ?
    )
  )
`;

export async function ssoSchemaReady(db) {
  return (await first(db, `SELECT COUNT(*) AS count FROM sqlite_schema
    WHERE type = 'table' AND name IN ('aeris_ds_sso_requests','aeris_ds_sso_grants')`))?.count === 2;
}

export async function prepareAuthorization(db, registration, input, actor) {
  const nonce = createSessionToken();
  const requestDigest = await sessionStorageKey(nonce);
  const now = time();
  const state = await securityState(db, actor.userId);
  const results = await db.batch([
    stmt(db, `DELETE FROM aeris_ds_sso_requests WHERE request_digest IN (
      SELECT request_digest FROM aeris_ds_sso_requests WHERE expires_at < ?
      ORDER BY expires_at LIMIT 100
    )`, [now - retention]),
    stmt(db, `DELETE FROM aeris_ds_sso_grants WHERE grant_id IN (
      SELECT grant_id FROM aeris_ds_sso_grants WHERE expires_at < ?
      ORDER BY expires_at LIMIT 100
    )`, [now - retention]),
    stmt(db, `INSERT INTO aeris_ds_sso_requests(
      request_digest,issuer,client_id,redirect_uri,user_id,session_digest,session_version,
      security_version,browser_state,code_challenge,created_at,expires_at
    ) SELECT ?,?,?,?,?,s.token_digest,s.session_version,?,?,?, ?,?
    FROM task12_sessions AS s
    WHERE s.token_digest = ? AND s.user_id = ? AND s.client_kind != 'android_app'
      AND s.revoked = 0 AND unixepoch(s.expires_at) > ?`, [
      requestDigest, registration.issuer, registration.clientId, registration.redirectUri, actor.userId,
      state.version, input.state, input.challenge, now, now + requestTtl,
      actor.sessionDigest, actor.userId, now,
    ]),
  ]);
  return results[2].meta.changes === 1 ? nonce : null;
}

export async function approveAuthorization(db, registration, actor, nonce, grant) {
  const requestDigest = await sessionStorageKey(nonce);
  const [user, state] = await Promise.all([activeUser(db, actor.userId), securityState(db, actor.userId)]);
  const stepUp = await grantStatements(db, grant, user, state, actor.sessionDigest, 'ds_sso_authorize:' + nonce);
  const code = createSessionToken();
  const codeDigest = await sessionStorageKey(code);
  const now = time();
  const batch = await atomic(db, [
    ...assertion(db, `EXISTS(SELECT 1 FROM aeris_ds_sso_requests AS r ${selectSource}
      WHERE r.request_digest = ? AND r.issuer = ? AND r.client_id = ? AND r.redirect_uri = ?
        AND r.session_digest = ? AND r.user_id = ? AND r.code_digest IS NULL
        AND r.expires_at > ? AND ${validSource})`, [
      requestDigest, registration.issuer, registration.clientId, registration.redirectUri,
      actor.sessionDigest, actor.userId, now, now, ...policy,
    ]),
    ...stepUp,
    stmt(db, `UPDATE aeris_ds_sso_requests SET code_digest = ?, code_expires_at = ?
      WHERE request_digest = ? RETURNING browser_state`, [codeDigest, now + codeTtl, requestDigest]),
  ]);
  return { code, state: batch.at(-1).results[0].browser_state };
}

function parseGrant(row) {
  return { iss: row.issuer, aud: row.client_id, sub: row.user_id, grant_id: row.grant_id, iat: row.issued_at, exp: row.expires_at };
}

export async function exchangeAuthorization(db, registration, code, challenge) {
  const codeDigest = await sessionStorageKey(code);
  const grantId = createSessionToken();
  const now = time();
  const results = await db.batch([
    stmt(db, `UPDATE aeris_ds_sso_requests SET exchanged_at = ?, issued_grant_id = ?
      WHERE request_digest IN (
        SELECT r.request_digest FROM aeris_ds_sso_requests AS r ${selectSource}
        WHERE r.code_digest = ? AND r.issuer = ? AND r.client_id = ? AND r.redirect_uri = ?
          AND r.exchanged_at IS NULL AND r.code_expires_at > ? AND r.code_challenge = ?
          AND ${validSource}
      )`, [now, grantId, codeDigest, registration.issuer, registration.clientId, registration.redirectUri,
      now, challenge, now, ...policy]),
    stmt(db, `INSERT INTO aeris_ds_sso_grants(
      grant_id,issuer,client_id,redirect_uri,user_id,session_digest,session_version,security_version,
      terms_version,privacy_version,security_policy_version,issued_at,expires_at
    ) SELECT ?,r.issuer,r.client_id,r.redirect_uri,r.user_id,r.session_digest,r.session_version,r.security_version,
      ?,?,?,?,min(?,unixepoch(source.expires_at))
      FROM aeris_ds_sso_requests AS r JOIN task12_sessions AS source ON source.token_digest = r.session_digest
      WHERE r.issued_grant_id = ? RETURNING *`, [grantId, ...policy, now, now + grantTtl, grantId]),
  ]);
  const row = results[1].results[0];
  return row ? parseGrant(row) : null;
}

export async function introspectAuthorization(db, registration, id) {
  const now = time();
  const binding = [id, registration.issuer, registration.clientId, registration.redirectUri];
  const results = await db.batch([
    stmt(db, `UPDATE aeris_ds_sso_grants AS g
      SET revoked_at = ?, revoke_reason = CASE WHEN expires_at <= ? THEN 'expired' ELSE 'source_invalid' END
      WHERE grant_id = ? AND issuer = ? AND client_id = ? AND redirect_uri = ? AND revoked_at IS NULL
        AND (expires_at <= ? OR terms_version != ? OR privacy_version != ? OR security_policy_version != ?
          OR NOT EXISTS (
            SELECT 1 FROM aeris_ds_sso_grants AS r ${selectSource}
            WHERE r.grant_id = g.grant_id AND ${validSource}
          )
        )`, [now, now, ...binding, now, ...policy, now, ...policy]),
    stmt(db, `SELECT * FROM aeris_ds_sso_grants WHERE grant_id = ? AND issuer = ? AND client_id = ?
      AND redirect_uri = ? AND revoked_at IS NULL`, binding),
  ]);
  const row = results[1].results[0];
  return row ? { active: true, ...parseGrant(row) } : { active: false };
}
