import { createSessionToken, sessionStorageKey } from './task12-crypto.mjs';
import { POLICY_VERSIONS } from './task27-policy.mjs';
import { first, stmt } from './task27-store.mjs';
import { unixTime } from './ds-native-crypto.mjs';

const grantTtl = 8 * 60 * 60;
const policy = [POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy, POLICY_VERSIONS.security];
const validSource = `
  s.revoked = 0 AND s.client_kind != 'android_app' AND unixepoch(s.expires_at) > ?
  AND u.deleted = 0 AND u.banned = 0 AND sec.must_change_password = 0
  AND s.session_version = u.session_version
  AND (
    NOT EXISTS (SELECT 1 FROM task12_metadata WHERE key = 'task27_require_policy_reaccept' AND value = '1')
    OR EXISTS (
      SELECT 1 FROM task27_policy_consents AS c WHERE c.user_id = u.id
      AND c.terms_version = ? AND c.privacy_version = ? AND c.security_version = ?
    )
  )
`;

export async function nativeSchemaReady(db) {
  const row = await first(db, `SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name IN (
    'aeris_ds_sso_grants','aeris_ds_native_envelopes','aeris_ds_native_nonces'
  )`);
  return row?.count === 3;
}

export async function reserveNonce(db, nonce) {
  const now = unixTime();
  const result = await db.batch([
    stmt(db, `DELETE FROM aeris_ds_native_nonces WHERE nonce IN (
      SELECT nonce FROM aeris_ds_native_nonces WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
    )`, [now]),
    stmt(db, `INSERT INTO aeris_ds_native_nonces(nonce,expires_at) VALUES(?,?) ON CONFLICT DO NOTHING`, [nonce, now + 65]),
  ]);
  return result[1].meta.changes === 1;
}

export async function saveEnvelope(db, cipher, kind, id, owner, token, expiry, replace = true) {
  const key = await sessionStorageKey(id);
  const sealed = await cipher.seal(kind, key, owner, token);
  const results = await db.batch([
    stmt(db, `DELETE FROM aeris_ds_native_envelopes WHERE (kind,id) IN (
      SELECT kind,id FROM aeris_ds_native_envelopes WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
    )`, [unixTime()]),
    stmt(db, `INSERT INTO aeris_ds_native_envelopes(kind,id,owner,sealed,expires_at) VALUES(?,?,?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET sealed=excluded.sealed,expires_at=excluded.expires_at
      WHERE owner=excluded.owner AND ?`, [kind, key, owner, sealed, expiry, replace ? 1 : 0]),
  ]);
  return results[1].meta.changes === 1;
}

export async function readEnvelope(db, cipher, kind, id, owner) {
  const key = await sessionStorageKey(id);
  const row = await first(db, `SELECT sealed FROM aeris_ds_native_envelopes
    WHERE kind=? AND id=? AND owner=? AND expires_at>?`, [kind, key, owner, unixTime()]);
  return row ? cipher.open(kind, key, owner, row.sealed) : null;
}

function claims(row) {
  return { iss: row.issuer, aud: row.client_id, sub: row.user_id, grant_id: row.grant_id, iat: row.issued_at, exp: row.expires_at };
}

export async function issueNativeGrant(db, client, cipher, sourceToken) {
  const now = unixTime();
  const grant = createSessionToken();
  const digest = await sessionStorageKey(sourceToken);
  const key = await sessionStorageKey(grant);
  const sealed = await cipher.seal('source', key, client.clientId, sourceToken);
  const results = await db.batch([
    stmt(db, `INSERT INTO aeris_ds_sso_grants(
      grant_id,issuer,client_id,redirect_uri,user_id,session_digest,session_version,security_version,
      terms_version,privacy_version,security_policy_version,issued_at,expires_at
    ) SELECT ?,?,?,?,u.id,s.token_digest,u.session_version,sec.version,?,?,?,?,min(?,unixepoch(s.expires_at))
      FROM task12_sessions s JOIN task12_users u ON u.id=s.user_id JOIN task27_security sec ON sec.user_id=u.id
      WHERE s.token_digest=? AND ${validSource}
        AND NOT EXISTS (SELECT 1 FROM aeris_ds_sso_grants g
          WHERE g.session_digest=s.token_digest AND g.client_id=? AND g.redirect_uri=?)
      RETURNING *`,
    [grant, client.issuer, client.clientId, client.origin, ...policy, now, now + grantTtl, digest, now, ...policy, client.clientId, client.origin]),
    stmt(db, `INSERT INTO aeris_ds_native_envelopes(kind,id,owner,sealed,expires_at)
      SELECT 'source',?,?,?,expires_at FROM aeris_ds_sso_grants WHERE grant_id=?`, [key, client.clientId, sealed, grant]),
    stmt(db, `DELETE FROM aeris_ds_native_envelopes WHERE (kind,id) IN (
      SELECT kind,id FROM aeris_ds_native_envelopes WHERE expires_at<=? ORDER BY expires_at LIMIT 100
    )`, [now]),
  ]);
  const row = results[0].results[0];
  return row ? claims(row) : null;
}

// Used inside a conditional write or read when a prior grant check can race revocation.
export function liveNativeGrant(client, grant, now) {
  return liveNativeGrants(client, now, { condition:'g.grant_id = ?', args:[grant] });
}

export function liveNativeGrants(client, now, { condition='1', args=[], projection='1' } = {}) {
  return {
    sql: `SELECT ${projection} FROM aeris_ds_sso_grants g
      JOIN task12_sessions s ON s.token_digest = g.session_digest AND s.user_id = g.user_id
      JOIN task12_users u ON u.id = s.user_id JOIN task27_security sec ON sec.user_id = u.id
      WHERE (${condition}) AND g.issuer = ? AND g.client_id = ? AND g.redirect_uri = ?
        AND g.revoked_at IS NULL AND g.expires_at > ?
        AND g.session_version = u.session_version AND g.security_version = sec.version
        AND g.terms_version = ? AND g.privacy_version = ? AND g.security_policy_version = ?
        AND ${validSource}`,
    args: [...args, client.issuer, client.clientId, client.origin, now, ...policy, now, ...policy],
  };
}

export async function nativeGrantStatus(db, client, grant) {
  const now = unixTime();
  const binding = [grant, client.issuer, client.clientId, client.origin];
  const results = await db.batch([
    stmt(db, `UPDATE aeris_ds_sso_grants AS g
      SET revoked_at=?, revoke_reason=CASE WHEN expires_at<=? THEN 'expired' ELSE 'source_invalid' END
      WHERE grant_id=? AND issuer=? AND client_id=? AND redirect_uri=? AND revoked_at IS NULL
        AND (expires_at<=? OR terms_version!=? OR privacy_version!=? OR security_policy_version!=?
          OR NOT EXISTS (
            SELECT 1 FROM task12_sessions s JOIN task12_users u ON u.id=s.user_id JOIN task27_security sec ON sec.user_id=u.id
            WHERE s.token_digest=g.session_digest AND s.user_id=g.user_id
              AND g.session_version=u.session_version AND g.security_version=sec.version AND ${validSource}
          )
        )`, [now, now, ...binding, now, ...policy, now, ...policy]),
    stmt(db, `SELECT * FROM aeris_ds_sso_grants WHERE grant_id=? AND issuer=? AND client_id=?
      AND redirect_uri=? AND revoked_at IS NULL`, binding),
  ]);
  const row = results[1].results[0];
  return row ? { active: true, ...claims(row) } : { active: false };
}

export async function revokeNativeGrant(db, client, grant) {
  const match = [grant, client.issuer, client.clientId, client.origin];
  const now = unixTime();
  const key = await sessionStorageKey(grant);
  await db.batch([
    stmt(db, `UPDATE task12_sessions SET revoked=1, revoked_at=?
      WHERE revoked=0 AND token_digest IN (SELECT session_digest FROM aeris_ds_sso_grants
        WHERE grant_id=? AND issuer=? AND client_id=? AND redirect_uri=?)`, [new Date().toISOString(), ...match]),
    stmt(db, `UPDATE aeris_ds_sso_grants SET revoked_at=?, revoke_reason='source_invalid'
      WHERE grant_id=? AND issuer=? AND client_id=? AND redirect_uri=? AND revoked_at IS NULL`, [now, ...match]),
    stmt(db, "DELETE FROM aeris_ds_native_envelopes WHERE kind='source' AND id=? AND owner=?", [key, client.clientId]),
  ]);
}
