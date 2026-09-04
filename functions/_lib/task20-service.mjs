import { createSessionToken, sessionStorageKey } from "./task12-crypto.mjs";
import { loginAccount, userById } from "./task12-service.mjs";
import { accountPayload, isoNow, Task12Error } from "./task12-model.mjs";
import { deriveTask20Token, task20DeviceDigest } from "./task20-crypto.mjs";
import {
  TASK20_ACCESS_TTL_SECONDS,
  TASK20_REFRESH_TTL_SECONDS,
  TASK20_SCHEMA_VERSION,
  requireTask20SessionSecret,
  validateTask20AppVersion,
  validateTask20DeviceId,
  validateTask20RotationKey,
} from "./task20-model.mjs";

function requireDatabase(db) {
  if (!db?.prepare) throw new Task12Error("云端账户数据库暂时不可用", 503, "task20_database_unavailable", true);
  return db;
}

async function first(db, sql, values = []) {
  return await requireDatabase(db).prepare(sql).bind(...values).first();
}

async function all(db, sql, values = []) {
  return (await requireDatabase(db).prepare(sql).bind(...values).all()).results || [];
}

async function run(db, sql, values = []) {
  return await requireDatabase(db).prepare(sql).bind(...values).run();
}

function expiresFrom(now, seconds) {
  return isoNow(new Date(now.getTime() + seconds * 1000));
}

export async function ensureTask20Schema(db) {
  if (!db?.prepare) return false;
  try {
    const row = await first(db, "SELECT value FROM task20_metadata WHERE key = ?1", ["schema_version"]);
    return String(row?.value || "") === TASK20_SCHEMA_VERSION;
  } catch (_) {
    return false;
  }
}

function publicDeviceSession(row) {
  return {
    id: String(row.id),
    device_id_hash: String(row.device_id_digest).slice(0, 12),
    app_version: String(row.app_version || ""),
    created_at: String(row.created_at),
    last_seen_at: String(row.last_seen_at),
    access_expires_at: String(row.access_expires_at),
    refresh_expires_at: String(row.refresh_expires_at),
  };
}

function appSessionResult({ accessToken, refreshToken, row, account, idempotent = false }) {
  return {
    access_token: accessToken,
    access_expires_at: String(row.access_expires_at),
    refresh_token: refreshToken,
    refresh_expires_at: String(row.refresh_expires_at),
    token_type: "Task12Session",
    account: accountPayload(account),
    device_session: publicDeviceSession(row),
    idempotent,
  };
}

async function revokeDeviceSession(db, row, reason) {
  const now = isoNow();
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task20_device_sessions SET revoked = 1, revoked_at = ?2, revoke_reason = ?3
      WHERE id = ?1 AND revoked = 0`).bind(row.id, now, String(reason || "revoked").slice(0, 80)),
    db.prepare("DELETE FROM task12_sessions WHERE token_digest = ?1").bind(row.access_token_digest),
  ]);
}

async function deviceSessionByRefresh(db, digest) {
  return await first(db, `SELECT sessions.*, users.banned AS user_banned,
      users.deleted AS user_deleted, users.session_version AS user_session_version
    FROM task20_device_sessions AS sessions
    JOIN task12_users AS users ON users.id = sessions.user_id
    WHERE sessions.refresh_token_digest = ?1`, [digest]);
}

async function deviceSessionByAccess(db, digest) {
  return await first(db, `SELECT sessions.*, users.banned AS user_banned,
      users.deleted AS user_deleted, users.session_version AS user_session_version
    FROM task20_device_sessions AS sessions
    JOIN task12_users AS users ON users.id = sessions.user_id
    WHERE sessions.access_token_digest = ?1`, [digest]);
}

function assertDeviceSessionActive(row, deviceDigest) {
  if (!row) throw new Task12Error("设备会话无效，请重新登录", 401, "app_refresh_invalid");
  if (String(row.device_id_digest) !== deviceDigest) {
    throw new Task12Error("设备会话与当前设备不匹配", 401, "app_device_mismatch");
  }
  if (row.user_deleted) throw new Task12Error("账户已删除", 403, "account_deleted");
  if (row.user_banned) throw new Task12Error("账户已被封禁", 403, "account_banned");
  if (row.revoked) throw new Task12Error("设备会话已被撤销", 401, "app_session_revoked");
  if (Number(row.session_version) !== Number(row.user_session_version)) {
    throw new Task12Error("账户安全状态已变化，请重新登录", 401, "session_generation_invalid");
  }
  if (!Number.isFinite(Date.parse(row.refresh_expires_at)) || Date.parse(row.refresh_expires_at) <= Date.now()) {
    throw new Task12Error("设备会话已过期，请重新登录", 401, "app_refresh_expired");
  }
}

export async function loginTask20Device(db, payload, request, options = {}) {
  const deviceId = validateTask20DeviceId(payload.device_id);
  const appVersion = validateTask20AppVersion(payload.app_version);
  requireTask20SessionSecret(options.sessionSecret);
  const now = new Date();
  const login = await loginAccount(db, payload.username, payload.secret, request, {
    passwordPepper: options.passwordPepper,
    sessionTtlSeconds: TASK20_ACCESS_TTL_SECONDS,
    clientKind: "android_app",
  });
  const sessionId = crypto.randomUUID();
  const refreshToken = createSessionToken();
  const refreshDigest = await sessionStorageKey(refreshToken);
  const accessDigest = await sessionStorageKey(login.session);
  const deviceDigest = await task20DeviceDigest(deviceId);
  const accessExpiresAt = expiresFrom(now, TASK20_ACCESS_TTL_SECONDS);
  const refreshExpiresAt = expiresFrom(now, TASK20_REFRESH_TTL_SECONDS);
  const previous = await all(db, `SELECT id, access_token_digest FROM task20_device_sessions
    WHERE device_id_digest = ?1 AND revoked = 0`, [deviceDigest]);
  const statements = previous.flatMap((row) => [
    db.prepare(`UPDATE task20_device_sessions SET revoked = 1, revoked_at = ?2, revoke_reason = 'device_relogin'
      WHERE id = ?1 AND revoked = 0`).bind(row.id, isoNow(now)),
    db.prepare("DELETE FROM task12_sessions WHERE token_digest = ?1").bind(row.access_token_digest),
  ]);
  statements.push(db.prepare(`INSERT INTO task20_device_sessions (
    id, user_id, device_id_digest, refresh_token_digest, access_token_digest,
    session_version, rotation_counter, app_version, created_at, last_seen_at,
    access_expires_at, refresh_expires_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?8, ?9, ?10)`).bind(
    sessionId, login.account.id, deviceDigest, refreshDigest, accessDigest,
    Number((await userById(db, login.account.id)).session_version || 1),
    appVersion, isoNow(now), accessExpiresAt, refreshExpiresAt,
  ));
  statements.push(db.prepare("DELETE FROM task20_used_refresh_tokens WHERE expires_at <= ?1").bind(isoNow(now)));
  try {
    await requireDatabase(db).batch(statements);
  } catch (error) {
    await run(db, "DELETE FROM task12_sessions WHERE token_digest = ?1", [accessDigest]);
    throw error;
  }
  const row = await first(db, "SELECT * FROM task20_device_sessions WHERE id = ?1", [sessionId]);
  return appSessionResult({ accessToken: login.session, refreshToken, row, account: await userById(db, login.account.id) });
}

async function idempotentRotationResult(db, used, rotationKey, secret, deviceDigest) {
  const row = await first(db, `SELECT sessions.*, users.banned AS user_banned,
      users.deleted AS user_deleted, users.session_version AS user_session_version
    FROM task20_device_sessions AS sessions
    JOIN task12_users AS users ON users.id = sessions.user_id
    WHERE sessions.id = ?1`, [used.session_id]);
  if (!row || String(used.rotation_key) !== rotationKey || String(row.last_rotation_key) !== rotationKey) return null;
  assertDeviceSessionActive(row, deviceDigest);
  const accessToken = await deriveTask20Token(secret, "access", row.id, row.rotation_counter);
  const refreshToken = await deriveTask20Token(secret, "refresh", row.id, row.rotation_counter);
  const accessDigest = await sessionStorageKey(accessToken);
  const storedAccess = await first(db, "SELECT token_digest FROM task12_sessions WHERE token_digest = ?1", [accessDigest]);
  if (!storedAccess || accessDigest !== String(row.access_token_digest)) return null;
  return appSessionResult({
    accessToken, refreshToken, row, account: await userById(db, row.user_id), idempotent: true,
  });
}

async function rejectRefreshReuse(db, sessionId) {
  const reused = await first(db, "SELECT * FROM task20_device_sessions WHERE id = ?1", [sessionId]);
  if (reused) await revokeDeviceSession(db, reused, "refresh_reuse");
  throw new Task12Error(
    "检测到设备会话凭据重复使用，请重新登录",
    401,
    "app_refresh_reuse_detected",
  );
}

export async function refreshTask20Device(db, payload, options = {}) {
  const deviceId = validateTask20DeviceId(payload.device_id);
  const rotationKey = validateTask20RotationKey(payload.rotation_key);
  const appVersion = validateTask20AppVersion(payload.app_version);
  const secret = requireTask20SessionSecret(options.sessionSecret);
  const refreshDigest = await sessionStorageKey(String(payload.refresh_token || ""));
  const deviceDigest = await task20DeviceDigest(deviceId);
  let row = await deviceSessionByRefresh(db, refreshDigest);
  if (!row) {
    const used = await first(db, "SELECT * FROM task20_used_refresh_tokens WHERE token_digest = ?1", [refreshDigest]);
    if (used) {
      const repeated = await idempotentRotationResult(db, used, rotationKey, secret, deviceDigest);
      if (repeated) return repeated;
      await rejectRefreshReuse(db, used.session_id);
    }
    throw new Task12Error("设备会话无效，请重新登录", 401, "app_refresh_invalid");
  }
  try {
    assertDeviceSessionActive(row, deviceDigest);
  } catch (error) {
    if (row && !row.revoked) await revokeDeviceSession(db, row, error.code || "refresh_rejected");
    throw error;
  }
  const now = new Date();
  const counter = Number(row.rotation_counter) + 1;
  const accessToken = await deriveTask20Token(secret, "access", row.id, counter);
  const refreshToken = await deriveTask20Token(secret, "refresh", row.id, counter);
  const accessDigest = await sessionStorageKey(accessToken);
  const nextRefreshDigest = await sessionStorageKey(refreshToken);
  const accessExpiresAt = expiresFrom(now, TASK20_ACCESS_TTL_SECONDS);
  const refreshExpiresAt = expiresFrom(now, TASK20_REFRESH_TTL_SECONDS);
  try {
    await requireDatabase(db).batch([
      db.prepare(`INSERT INTO task20_used_refresh_tokens (
        token_digest, session_id, rotation_key, used_at, expires_at
      ) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(
        refreshDigest, row.id, rotationKey, isoNow(now), row.refresh_expires_at,
      ),
      db.prepare(`UPDATE task20_device_sessions SET
          refresh_token_digest = ?2, access_token_digest = ?3, rotation_counter = ?4,
          last_rotation_key = ?5, app_version = ?6, last_seen_at = ?7,
          access_expires_at = ?8, refresh_expires_at = ?9
        WHERE id = ?1 AND refresh_token_digest = ?10 AND revoked = 0`).bind(
        row.id, nextRefreshDigest, accessDigest, counter, rotationKey, appVersion,
        isoNow(now), accessExpiresAt, refreshExpiresAt, refreshDigest,
      ),
      db.prepare("DELETE FROM task12_sessions WHERE token_digest = ?1").bind(row.access_token_digest),
      db.prepare(`INSERT INTO task12_sessions (
        token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
      ) SELECT ?1, id, session_version, ?2, ?2, ?3, 'android_app'
        FROM task12_users
        WHERE id = ?4 AND session_version = ?5 AND banned = 0 AND deleted = 0`).bind(
        accessDigest, isoNow(now), accessExpiresAt, row.user_id, Number(row.session_version),
      ),
      db.prepare("DELETE FROM task20_used_refresh_tokens WHERE expires_at <= ?1").bind(isoNow(now)),
    ]);
  } catch (error) {
    const used = await first(db, "SELECT * FROM task20_used_refresh_tokens WHERE token_digest = ?1", [refreshDigest]);
    if (used) {
      const repeated = await idempotentRotationResult(db, used, rotationKey, secret, deviceDigest);
      if (repeated) return repeated;
      await rejectRefreshReuse(db, used.session_id);
    }
    throw error;
  }
  row = await deviceSessionByRefresh(db, nextRefreshDigest);
  const storedAccess = await first(db, "SELECT token_digest FROM task12_sessions WHERE token_digest = ?1", [accessDigest]);
  if (!row || !storedAccess) {
    if (row) await revokeDeviceSession(db, row, "rotation_incomplete");
    throw new Task12Error("设备会话刷新未完整提交，请重新登录", 409, "app_refresh_incomplete", true);
  }
  return appSessionResult({ accessToken, refreshToken, row, account: await userById(db, row.user_id) });
}

export async function logoutTask20Device(db, payload, accessToken = "") {
  const deviceId = validateTask20DeviceId(payload.device_id);
  const deviceDigest = await task20DeviceDigest(deviceId);
  let row = null;
  if (payload.refresh_token) {
    const refreshDigest = await sessionStorageKey(payload.refresh_token);
    row = await deviceSessionByRefresh(db, refreshDigest);
    if (!row) {
      const used = await first(db, "SELECT session_id FROM task20_used_refresh_tokens WHERE token_digest = ?1", [refreshDigest]);
      if (used) row = await first(db, "SELECT * FROM task20_device_sessions WHERE id = ?1", [used.session_id]);
    }
  }
  if (!row && accessToken) row = await deviceSessionByAccess(db, await sessionStorageKey(accessToken));
  if (row && String(row.device_id_digest) === deviceDigest) await revokeDeviceSession(db, row, "user_logout");
}

export async function task20DeviceSessionForAccess(db, accessToken) {
  if (!accessToken) return null;
  const row = await deviceSessionByAccess(db, await sessionStorageKey(accessToken));
  if (!row) return null;
  return publicDeviceSession(row);
}

export const __testing = {
  appSessionResult,
  assertDeviceSessionActive,
  expiresFrom,
  publicDeviceSession,
};
