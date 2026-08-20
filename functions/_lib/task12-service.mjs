import {
  PASSWORD_HASH_ITERATIONS,
  consumeVerificationWork,
  createSessionToken,
  hashSecret,
  sessionStorageKey,
  verifySecret,
} from "./task12-crypto.mjs";
import {
  LOGIN_AUDIT_MAX_RECORDS,
  LOGIN_AUDIT_RETENTION_DAYS,
  MAX_SESSIONS_PER_USER,
  SESSION_TTL_SECONDS,
  TASK12_SCHEMA_VERSION,
  Task12Error,
  accountPayload,
  auditSnapshot,
  clientKind,
  isoNow,
  normalizeUsername,
  validateSecret,
  validateUsername,
} from "./task12-model.mjs";

function requireDatabase(db) {
  if (!db?.prepare) throw new Task12Error("云端账户数据库暂时不可用", 503, "task12_database_unavailable", true);
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

function expiryFrom(date = new Date()) {
  return isoNow(new Date(date.getTime() + SESSION_TTL_SECONDS * 1000));
}

function isSuperAdmin(row) {
  return Boolean(row && row.role === "super_admin" && !row.deleted && !row.banned);
}

async function userById(db, userId) {
  return await first(db, "SELECT * FROM task12_users WHERE id = ?1", [String(userId || "")]);
}

async function userByName(db, username) {
  return await first(db, "SELECT * FROM task12_users WHERE username_normalized = ?1", [normalizeUsername(username)]);
}

async function revokeSessions(db, userId, now = isoNow()) {
  await run(db, `UPDATE task12_sessions
    SET revoked = 1, revoked_at = ?2
    WHERE user_id = ?1 AND revoked = 0`, [String(userId), now]);
}

async function accountAudit(db, actor, action, target, before = {}, after = {}, note = "") {
  await run(db, `INSERT INTO task12_account_audit_logs (
    id, actor_user_id, actor_username, target_user_id, target_username,
    action, before_json, after_json, note, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`, [
    crypto.randomUUID(), String(actor?.id || target?.id || ""), String(actor?.username || target?.username || ""),
    String(target?.id || ""), String(target?.username || ""), action,
    JSON.stringify(before), JSON.stringify(after), String(note || "").slice(0, 500), isoNow(),
  ]);
}

export async function ensureTask12Schema(db) {
  if (!db?.prepare) return false;
  const row = await first(db, "SELECT value FROM task12_metadata WHERE key = ?1", ["schema_version"]);
  return String(row?.value || "") === TASK12_SCHEMA_VERSION;
}

export async function recordLoginEvent(db, attemptedUsername, success, reason, details = {}, user = null) {
  const now = isoNow();
  const cutoff = isoNow(new Date(Date.now() - LOGIN_AUDIT_RETENTION_DAYS * 86400 * 1000));
  await run(db, `INSERT INTO task12_login_audit_logs (
    id, user_id, username, success, reason, ip_address,
    country, region, city, user_agent, source, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`, [
    crypto.randomUUID(), String(user?.id || ""), String(user?.username || attemptedUsername || "").slice(0, 40),
    success ? 1 : 0, String(reason || (success ? "success" : "failed")).slice(0, 80),
    String(details.ip_address || "").slice(0, 80), String(details.country || "").slice(0, 80),
    String(details.region || "").slice(0, 120), String(details.city || "").slice(0, 120),
    String(details.user_agent || "").slice(0, 400), String(details.source || "cloudflare_pages").slice(0, 40), now,
  ]);
  await run(db, `DELETE FROM task12_login_audit_logs WHERE created_at < ?1 OR id IN (
    SELECT id FROM task12_login_audit_logs ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?2
  )`, [cutoff, LOGIN_AUDIT_MAX_RECORDS]);
}

export async function registerAccount(db, username, secret) {
  const cleanUsername = validateUsername(username);
  const cleanSecret = validateSecret(secret);
  const normalized = normalizeUsername(cleanUsername);
  if (normalized === "wyj") throw new Task12Error("该用户名禁止注册", 409, "reserved_username");
  if (await userByName(db, cleanUsername)) throw new Task12Error("用户名已存在", 409, "username_exists");
  const now = isoNow();
  const user = {
    id: crypto.randomUUID(), username: cleanUsername, username_normalized: normalized,
    password_hash: await hashSecret(cleanSecret), role: "user", registered_at: now,
    created_at: now, updated_at: now,
  };
  try {
    await run(db, `INSERT INTO task12_users (
      id, username, username_normalized, password_hash, password_scheme, password_iterations,
      role, registered_at, created_at, updated_at, source_updated_at
    ) VALUES (?1, ?2, ?3, ?4, 'pbkdf2_sha256', ?5, ?6, ?7, ?8, ?9, ?10)`, [
      user.id, user.username, user.username_normalized, user.password_hash, PASSWORD_HASH_ITERATIONS,
      user.role, user.registered_at, user.created_at, user.updated_at, user.updated_at,
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || error))) {
      throw new Task12Error("用户名已存在", 409, "username_exists");
    }
    throw error;
  }
  return accountPayload(await userById(db, user.id));
}

export async function loginAccount(db, username, secret, request) {
  const usernameText = String(username || "").trim();
  const secretText = String(secret || "");
  const row = await userByName(db, usernameText);
  if (!row || row.deleted) {
    await consumeVerificationWork(secretText);
    throw new Task12Error("用户名或登录密钥错误", 403, "invalid_credentials");
  }
  if (row.banned) throw new Task12Error("账户已被封禁", 403, "account_banned");
  if (row.password_scheme !== "pbkdf2_sha256" || !row.password_hash) {
    await consumeVerificationWork(secretText);
    throw new Task12Error("此账户需要先重置登录密钥", 403, "password_reset_required");
  }
  const verified = await verifySecret(secretText, row.password_hash);
  if (!verified.valid) throw new Task12Error("用户名或登录密钥错误", 403, "invalid_credentials");
  const now = isoNow();
  const token = createSessionToken();
  const digest = await sessionStorageKey(token);
  const passwordHash = verified.needsUpgrade ? await hashSecret(secretText) : row.password_hash;
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET last_login_at = ?2, updated_at = ?2,
      source_updated_at = ?2, password_hash = ?3, password_iterations = ?4 WHERE id = ?1`)
      .bind(row.id, now, passwordHash, verified.needsUpgrade ? PASSWORD_HASH_ITERATIONS : row.password_iterations),
    db.prepare(`DELETE FROM task12_sessions WHERE expires_at <= ?1 OR revoked = 1`).bind(now),
    db.prepare(`INSERT INTO task12_sessions (
      token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
    ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)`).bind(
      digest, row.id, Number(row.session_version || 1), now, expiryFrom(), clientKind(request),
    ),
    db.prepare(`DELETE FROM task12_sessions WHERE token_digest IN (
      SELECT token_digest FROM task12_sessions WHERE user_id = ?1 AND revoked = 0
      ORDER BY created_at DESC, token_digest DESC LIMIT -1 OFFSET ?2
    )`).bind(row.id, MAX_SESSIONS_PER_USER),
  ]);
  return { session: token, account: accountPayload(await userById(db, row.id)) };
}

export async function resolveSession(db, token, options = {}) {
  const raw = String(token || "");
  if (!raw) return null;
  const digest = await sessionStorageKey(raw);
  const row = await first(db, `SELECT
      s.token_digest, s.session_version AS session_generation, s.created_at AS session_created_at,
      s.last_seen_at, s.expires_at, s.revoked, u.*
    FROM task12_sessions AS s JOIN task12_users AS u ON u.id = s.user_id
    WHERE s.token_digest = ?1`, [digest]);
  const now = new Date();
  const invalid = !row || row.revoked || row.deleted || row.banned
    || Number(row.session_generation) !== Number(row.session_version)
    || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now.getTime();
  if (invalid) {
    if (row) await run(db, "DELETE FROM task12_sessions WHERE token_digest = ?1", [digest]);
    return null;
  }
  if (options.touch !== false && now.getTime() - Date.parse(row.last_seen_at) >= 5 * 60 * 1000) {
    await run(db, `UPDATE task12_sessions SET last_seen_at = ?2, expires_at = ?3
      WHERE token_digest = ?1 AND revoked = 0`, [digest, isoNow(now), expiryFrom(now)]);
  }
  return accountPayload(row);
}

export async function logoutAccount(db, token) {
  const raw = String(token || "");
  if (!raw) return;
  await run(db, "DELETE FROM task12_sessions WHERE token_digest = ?1", [await sessionStorageKey(raw)]);
}

export async function logoutAllAccounts(db, account) {
  const now = isoNow();
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET session_version = session_version + 1,
      updated_at = ?2, source_updated_at = ?2 WHERE id = ?1`)
      .bind(account.id, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(account.id, now),
  ]);
}

export async function changeOwnSecret(db, account, currentSecret, newSecret) {
  const row = await userById(db, account.id);
  if (!row || row.deleted) throw new Task12Error("账户不存在", 404, "user_not_found");
  if (isSuperAdmin(row)) throw new Task12Error("固定管理员密钥不能在此修改", 403, "admin_protected");
  const verified = await verifySecret(String(currentSecret || ""), row.password_hash);
  if (!verified.valid) throw new Task12Error("当前登录密钥错误", 403, "invalid_secret");
  const hash = await hashSecret(validateSecret(newSecret));
  const now = isoNow();
  const before = auditSnapshot(row);
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET password_hash = ?2, password_scheme = 'pbkdf2_sha256',
      password_iterations = ?3, session_version = session_version + 1,
      updated_at = ?4, source_updated_at = ?4 WHERE id = ?1`)
      .bind(row.id, hash, PASSWORD_HASH_ITERATIONS, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(row.id, now),
  ]);
  await accountAudit(db, row, "password_change", row, before, auditSnapshot(await userById(db, row.id)));
}

export async function deleteOwnAccount(db, account, secret) {
  const row = await userById(db, account.id);
  if (!row || row.deleted) throw new Task12Error("账户不存在", 404, "user_not_found");
  if (isSuperAdmin(row)) throw new Task12Error("固定管理员账户不能注销", 403, "admin_protected");
  const verified = await verifySecret(String(secret || ""), row.password_hash);
  if (!verified.valid) throw new Task12Error("当前登录密钥错误", 403, "invalid_secret");
  const now = isoNow();
  const before = auditSnapshot(row);
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET password_hash = '', password_scheme = 'invalid',
      password_iterations = 0, deleted = 1, session_version = session_version + 1,
      updated_at = ?2, source_updated_at = ?2 WHERE id = ?1`).bind(row.id, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(row.id, now),
  ]);
  await accountAudit(db, row, "self_delete", row, before, auditSnapshot(await userById(db, row.id)));
}

export async function listUsers(db, actor) {
  if (!isSuperAdmin(actor)) throw new Task12Error("无管理员权限", 403, "forbidden");
  return (await all(db, `SELECT * FROM task12_users WHERE deleted = 0
    ORDER BY registered_at DESC, username_normalized ASC LIMIT 1000`)).map(accountPayload);
}

export async function listLoginAudit(db, actor, limit = 300) {
  if (!isSuperAdmin(actor)) throw new Task12Error("无管理员权限", 403, "forbidden");
  const safeLimit = Math.max(1, Math.min(Number(limit || 300), 500));
  return await all(db, `SELECT id, user_id, username, success, reason, ip_address,
    country, region, city, user_agent, source, created_at
    FROM task12_login_audit_logs ORDER BY created_at DESC, id DESC LIMIT ?1`, [safeLimit]);
}

export async function listAccountAudit(db, actor, limit = 200) {
  if (!isSuperAdmin(actor)) throw new Task12Error("无管理员权限", 403, "forbidden");
  const safeLimit = Math.max(1, Math.min(Number(limit || 200), 500));
  const rows = await all(db, `SELECT * FROM task12_account_audit_logs
    ORDER BY created_at DESC, id DESC LIMIT ?1`, [safeLimit]);
  return rows.map((row) => {
    const item = { ...row };
    for (const field of ["before_json", "after_json"]) {
      const output = field.replace(/_json$/, "");
      try { item[output] = JSON.parse(item[field] || "{}"); } catch (_) { item[output] = {}; }
      delete item[field];
    }
    return item;
  });
}

async function requireAdminTarget(db, actor, userId) {
  if (!isSuperAdmin(actor)) throw new Task12Error("无管理员权限", 403, "forbidden");
  const target = await userById(db, userId);
  if (!target || target.deleted) throw new Task12Error("用户不存在", 404, "user_not_found");
  if (isSuperAdmin(target)) throw new Task12Error("不能修改固定管理员账户", 403, "admin_protected");
  return target;
}

export async function adminResetSecret(db, actor, userId, secret) {
  const target = await requireAdminTarget(db, actor, userId);
  const now = isoNow();
  const before = auditSnapshot(target);
  const hash = await hashSecret(validateSecret(secret));
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET password_hash = ?2, password_scheme = 'pbkdf2_sha256',
      password_iterations = ?3, session_version = session_version + 1,
      updated_at = ?4, source_updated_at = ?4 WHERE id = ?1`)
      .bind(target.id, hash, PASSWORD_HASH_ITERATIONS, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(target.id, now),
  ]);
  await accountAudit(db, actor, "password_reset", target, before, auditSnapshot(await userById(db, target.id)), "管理员重置登录密钥并注销全部会话");
}

export async function adminSetBan(db, actor, userId, banned) {
  const target = await requireAdminTarget(db, actor, userId);
  const now = isoNow();
  const value = banned ? 1 : 0;
  const before = auditSnapshot(target);
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET banned = ?2, permanent_ban = ?2,
      session_version = session_version + 1, updated_at = ?3,
      source_updated_at = ?3 WHERE id = ?1`).bind(target.id, value, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(target.id, now),
  ]);
  await accountAudit(db, actor, value ? "ban" : "unban", target, before, auditSnapshot(await userById(db, target.id)));
}

export async function adminForceLogout(db, actor, userId) {
  const target = await requireAdminTarget(db, actor, userId);
  const now = isoNow();
  const before = auditSnapshot(target);
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET session_version = session_version + 1,
      updated_at = ?2, source_updated_at = ?2 WHERE id = ?1`)
      .bind(target.id, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(target.id, now),
  ]);
  await accountAudit(db, actor, "force_logout", target, before, auditSnapshot(await userById(db, target.id)));
}

export async function adminDeleteUser(db, actor, userId) {
  const target = await requireAdminTarget(db, actor, userId);
  const now = isoNow();
  const before = auditSnapshot(target);
  await requireDatabase(db).batch([
    db.prepare(`UPDATE task12_users SET password_hash = '', password_scheme = 'invalid',
      password_iterations = 0, deleted = 1, session_version = session_version + 1,
      updated_at = ?2, source_updated_at = ?2 WHERE id = ?1`).bind(target.id, now),
    db.prepare("UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0")
      .bind(target.id, now),
  ]);
  await accountAudit(db, actor, "admin_delete", target, before, auditSnapshot(await userById(db, target.id)));
}

async function optionalCount(db, sql, values = []) {
  try { return Number((await first(db, sql, values))?.count || 0); } catch (_) { return 0; }
}

export async function accountCounts(db) {
  const now = isoNow();
  const [users, active, banned, deleted, admins, sessions, audits] = await Promise.all([
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_users"),
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_users WHERE deleted = 0 AND banned = 0"),
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_users WHERE deleted = 0 AND banned = 1"),
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_users WHERE deleted = 1"),
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_users WHERE role = 'super_admin'"),
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_sessions WHERE revoked = 0 AND expires_at > ?1", [now]),
    optionalCount(db, "SELECT COUNT(*) AS count FROM task12_login_audit_logs"),
  ]);
  const orphaned = await optionalCount(db, `SELECT COUNT(*) AS count FROM (
    SELECT user_id FROM task11_feedback_items
    UNION SELECT user_id FROM task11_feedback_votes
    UNION SELECT user_id FROM task11_learning_sync_records
    UNION SELECT user_id FROM task11_learning_sync_heads
    UNION SELECT user_id FROM task11_learning_sync_changes
  ) AS refs LEFT JOIN task12_users AS users ON users.id = refs.user_id WHERE users.id IS NULL`);
  return { users, active, banned, deleted, admins, sessions, login_audit: audits, task11_orphaned_user_ids: orphaned };
}

export const __testing = { all, first, isSuperAdmin, requireDatabase, revokeSessions, run, userById, userByName };
