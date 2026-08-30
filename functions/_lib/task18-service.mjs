import {
  accountPayload,
  accountRole,
  isAdminAccount,
  isOwnerAccount,
} from "./task12-model.mjs";
import { userById } from "./task12-service.mjs";
import {
  ADMIN_ROLE_POLICY,
  MAX_MESSAGE_RECIPIENTS,
  TASK18_SCHEMA_VERSION,
  Task18Error,
  cleanExpiry,
  cleanIdempotencyKey,
  cleanMessageBody,
  cleanMessageId,
  cleanMessageScope,
  cleanMessageTitle,
  cleanMessageType,
  cleanUserId,
  isoNow,
  messagePayload,
  safeAuditJson,
} from "./task18-model.mjs";

function requireDatabase(db) {
  if (!db?.prepare) throw new Task18Error("云端管理员数据库暂时不可用", 503, "task18_database_unavailable", true);
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

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

function requireOwner(actor) {
  if (!isOwnerAccount(actor)) throw new Task18Error("只有站点所有者可以管理管理员角色", 403, "owner_required");
}

function requireAdmin(actor) {
  if (!isAdminAccount(actor)) throw new Task18Error("无管理员权限", 403, "forbidden");
}

function actorRole(actor) {
  const role = accountRole(actor);
  return role === "super_admin" ? role : "admin";
}

function auditStatement(db, actor, input = {}) {
  return db.prepare(`INSERT INTO task18_admin_action_audit (
    id, actor_user_id, actor_username, actor_role, target_type, target_id,
    target_label, action, success, before_json, after_json, error_code,
    note, request_id, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`)
    .bind(
      crypto.randomUUID(), String(actor.id), String(actor.username), actorRole(actor),
      String(input.targetType || "").slice(0, 40), String(input.targetId || "").slice(0, 120),
      String(input.targetLabel || "").slice(0, 120), String(input.action || "admin_action").slice(0, 80),
      input.success === false ? 0 : 1, safeAuditJson(input.before), safeAuditJson(input.after),
      String(input.errorCode || "").slice(0, 120), String(input.note || "").slice(0, 500),
      String(input.requestId || "").slice(0, 120), isoNow(),
    );
}

export async function recordAdminAction(db, actor, input = {}) {
  requireAdmin(actor);
  await auditStatement(db, actor, input).run();
}

export async function ensureTask18Schema(db) {
  if (!db?.prepare) return false;
  try {
    const [metadata, owner] = await Promise.all([
      first(db, "SELECT value FROM task18_metadata WHERE key = ?1", ["schema_version"]),
      first(db, "SELECT COUNT(*) AS count FROM task12_users WHERE role = 'super_admin' AND banned = 0 AND deleted = 0"),
    ]);
    return String(metadata?.value || "") === TASK18_SCHEMA_VERSION && Number(owner?.count || 0) === 1;
  } catch (_) {
    return false;
  }
}

export async function task18Readiness(db) {
  const row = await first(db, `SELECT
    (SELECT COUNT(*) FROM task12_users WHERE role = 'super_admin' AND banned = 0 AND deleted = 0) AS owners,
    (SELECT COUNT(*) FROM task18_admin_roles) AS admins,
    (SELECT COUNT(*) FROM admin_messages) AS messages,
    (SELECT COUNT(*) FROM admin_messages WHERE status = 'active') AS active_messages,
    (SELECT COUNT(*) FROM admin_message_recipients) AS recipients,
    (SELECT COUNT(*) FROM admin_message_receipts) AS receipts,
    (SELECT COUNT(*) FROM task18_admin_action_audit) AS action_audits`);
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

export async function listAdminRoles(db, actor) {
  requireOwner(actor);
  const [ownerRows, adminRows, auditRows] = await Promise.all([
    all(db, `SELECT id, username, registered_at, last_login_at, created_at, updated_at
      FROM task12_users WHERE role = 'super_admin' AND banned = 0 AND deleted = 0 LIMIT 2`),
    all(db, `SELECT users.id, users.username, users.banned, users.deleted,
      roles.role, roles.granted_by_user_id, roles.granted_by_username,
      roles.granted_at, roles.updated_at
      FROM task18_admin_roles AS roles
      JOIN task12_users AS users ON users.id = roles.user_id
      ORDER BY roles.granted_at DESC, users.username_normalized ASC LIMIT 500`),
    all(db, `SELECT * FROM task18_admin_role_audit
      ORDER BY created_at DESC, id DESC LIMIT 300`),
  ]);
  return {
    owner: ownerRows[0] ? { ...ownerRows[0], role: "super_admin" } : null,
    admins: adminRows.map((row) => ({ ...row, banned: Boolean(row.banned), deleted: Boolean(row.deleted) })),
    policy: ADMIN_ROLE_POLICY,
    audit: auditRows.map((row) => ({ ...row, success: Boolean(row.success) })),
  };
}

export async function setAdminRole(db, actor, input, requestId = "") {
  requireOwner(actor);
  const userId = cleanUserId(input.user_id);
  const desiredRole = String(input.role || "").trim().toLowerCase();
  if (!new Set(["user", "admin"]).has(desiredRole)) {
    throw new Task18Error("管理员角色无效", 400, "admin_role_invalid");
  }
  if (userId === String(actor.id)) throw new Task18Error("站点所有者角色不可修改", 403, "owner_protected");
  const target = await userById(db, userId);
  if (!target || target.deleted) throw new Task18Error("用户不存在", 404, "user_not_found");
  if (isOwnerAccount(target)) throw new Task18Error("站点所有者角色不可修改", 403, "owner_protected");
  if (target.banned && desiredRole === "admin") {
    throw new Task18Error("被封禁用户不能成为管理员", 409, "admin_target_banned");
  }
  const beforeRole = accountRole(target);
  if (beforeRole === desiredRole) {
    return { changed: false, user: accountPayload(target) };
  }
  const now = isoNow();
  const action = desiredRole === "admin" ? "admin_grant" : "admin_revoke";
  const mutation = desiredRole === "admin"
    ? db.prepare(`INSERT INTO task18_admin_roles (
        user_id, role, granted_by_user_id, granted_by_username, granted_at, updated_at
      ) VALUES (?1, 'admin', ?2, ?3, ?4, ?4)`)
      .bind(target.id, actor.id, actor.username, now)
    : db.prepare("DELETE FROM task18_admin_roles WHERE user_id = ?1 AND role = 'admin'").bind(target.id);
  await requireDatabase(db).batch([
    mutation,
    db.prepare(`INSERT INTO task18_admin_role_audit (
      id, actor_user_id, actor_username, actor_role, target_user_id, target_username,
      action, before_role, after_role, success, note, request_id, created_at
    ) VALUES (?1, ?2, ?3, 'super_admin', ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11)`)
      .bind(
        crypto.randomUUID(), actor.id, actor.username, target.id, target.username,
        action, beforeRole, desiredRole, String(input.note || "").slice(0, 500),
        String(requestId || "").slice(0, 120), now,
      ),
    auditStatement(db, actor, {
      targetType: "admin_role", targetId: target.id, targetLabel: target.username,
      action, before: { role: beforeRole }, after: { role: desiredRole },
      requestId, note: input.note,
    }),
  ]);
  return { changed: true, user: accountPayload(await userById(db, target.id)) };
}

async function expireMessages(db, now = isoNow()) {
  await run(db, `UPDATE admin_messages SET status = 'expired', updated_at = ?1
    WHERE status = 'active' AND expires_at != '' AND expires_at <= ?1`, [now]);
}

async function messageTargets(db, messageId) {
  return (await all(db, `SELECT user_id FROM admin_message_recipients
    WHERE message_id = ?1 ORDER BY user_id`, [messageId])).map((row) => String(row.user_id));
}

function canonicalMessageInput(input, now = new Date()) {
  const scope = cleanMessageScope(input.target_scope);
  const targetIds = [...new Set((Array.isArray(input.target_user_ids) ? input.target_user_ids : [])
    .map(cleanUserId))].sort();
  if (scope === "single" && targetIds.length !== 1) {
    throw new Task18Error("单用户消息必须且只能选择一个用户", 400, "message_single_target_required");
  }
  if (scope === "multiple" && (targetIds.length < 2 || targetIds.length > MAX_MESSAGE_RECIPIENTS)) {
    throw new Task18Error(`多用户消息需选择 2 至 ${MAX_MESSAGE_RECIPIENTS} 个用户`, 400, "message_multiple_targets_invalid");
  }
  if (scope === "all" && targetIds.length) {
    throw new Task18Error("全站消息不能附带指定用户", 400, "message_all_targets_forbidden");
  }
  if (scope !== "single" && input.confirm_bulk_send !== true) {
    throw new Task18Error("批量或全站消息需要再次确认", 400, "message_bulk_confirmation_required");
  }
  return {
    title: cleanMessageTitle(input.title),
    body: cleanMessageBody(input.body),
    messageType: cleanMessageType(input.message_type),
    scope,
    targetIds,
    expiresAt: cleanExpiry(input.expires_at, now),
    requiresConfirmation: Boolean(input.requires_confirmation),
    idempotencyKey: cleanIdempotencyKey(input.idempotency_key),
  };
}

async function verifyMessageTargets(db, targetIds) {
  const users = [];
  for (const userId of targetIds) {
    const user = await userById(db, userId);
    if (!user || user.deleted || user.banned) {
      throw new Task18Error("消息目标用户不存在或账户不可用", 409, "message_target_unavailable");
    }
    users.push(user);
  }
  return users;
}

function sameMessage(existing, input, targetIds) {
  return existing.title === input.title
    && existing.body === input.body
    && existing.message_type === input.messageType
    && existing.target_scope === input.scope
    && String(existing.expires_at || "") === input.expiresAt
    && Boolean(existing.requires_confirmation) === input.requiresConfirmation
    && JSON.stringify(targetIds) === JSON.stringify(input.targetIds);
}

export async function createAdminMessage(db, actor, rawInput, requestId = "") {
  requireAdmin(actor);
  const input = canonicalMessageInput(rawInput);
  const existing = await first(db, `SELECT * FROM admin_messages
    WHERE sender_user_id = ?1 AND idempotency_key = ?2`, [actor.id, input.idempotencyKey]);
  if (existing) {
    const targets = await messageTargets(db, existing.id);
    if (!sameMessage(existing, input, targets)) {
      throw new Task18Error("幂等标识已用于另一条消息", 409, "message_idempotency_conflict");
    }
    return { created: false, replayed: true, message: { ...messagePayload(existing), target_user_ids: targets } };
  }
  const users = await verifyMessageTargets(db, input.targetIds);
  const recipientCount = input.scope === "all"
    ? Number((await first(db, "SELECT COUNT(*) AS count FROM task12_users WHERE deleted = 0 AND banned = 0"))?.count || 0)
    : users.length;
  const id = crypto.randomUUID();
  const now = isoNow();
  const statements = [
    db.prepare(`INSERT INTO admin_messages (
      id, title, body, message_type, sender_user_id, sender_username, sender_role,
      target_scope, requires_confirmation, status, expires_at, idempotency_key,
      recipient_count, request_id, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?11, ?12, ?13, ?14, ?14)`)
      .bind(
        id, input.title, input.body, input.messageType, actor.id, actor.username,
        actorRole(actor), input.scope, input.requiresConfirmation ? 1 : 0,
        input.expiresAt, input.idempotencyKey, recipientCount,
        String(requestId || "").slice(0, 120), now,
      ),
    ...(input.scope === "all"
      ? [db.prepare(`INSERT INTO admin_message_recipients (message_id, user_id, created_at)
          SELECT ?1, id, ?2 FROM task12_users WHERE deleted = 0 AND banned = 0`)
        .bind(id, now)]
      : input.targetIds.map((userId) => db.prepare(`INSERT INTO admin_message_recipients (
          message_id, user_id, created_at
        ) VALUES (?1, ?2, ?3)`).bind(id, userId, now))),
    auditStatement(db, actor, {
      targetType: "admin_message", targetId: id, targetLabel: input.scope,
      action: "message_send", after: {
        type: input.messageType, scope: input.scope, recipient_count: recipientCount,
        requires_confirmation: input.requiresConfirmation, expires_at: input.expiresAt,
      }, requestId,
    }),
  ];
  try {
    await requireDatabase(db).batch(statements);
  } catch (error) {
    // A concurrent retry can win the unique idempotency key between the read
    // above and this batch. Resolve that race as a replay, while preserving
    // genuine storage failures and conflicting payloads.
    const concurrent = await first(db, `SELECT * FROM admin_messages
      WHERE sender_user_id = ?1 AND idempotency_key = ?2`, [actor.id, input.idempotencyKey]).catch(() => null);
    if (!concurrent) throw error;
    const targets = await messageTargets(db, concurrent.id);
    if (!sameMessage(concurrent, input, targets)) {
      throw new Task18Error("幂等标识已用于另一条消息", 409, "message_idempotency_conflict");
    }
    return { created: false, replayed: true, message: { ...messagePayload(concurrent), target_user_ids: targets } };
  }
  const row = await first(db, "SELECT * FROM admin_messages WHERE id = ?1", [id]);
  return { created: true, replayed: false, message: { ...messagePayload(row), target_user_ids: input.targetIds } };
}

export async function listAdminMessages(db, actor, limit = 200) {
  requireAdmin(actor);
  await expireMessages(db);
  const safeLimit = Math.max(1, Math.min(Number(limit || 200), 300));
  const rows = await all(db, `SELECT messages.*,
    (SELECT COUNT(*) FROM admin_message_receipts AS receipts
      WHERE receipts.message_id = messages.id AND receipts.first_seen_at != '') AS seen_count,
    (SELECT COUNT(*) FROM admin_message_receipts AS receipts
      WHERE receipts.message_id = messages.id AND receipts.acknowledged_at != '') AS acknowledged_count,
    (SELECT COUNT(*) FROM admin_message_receipts AS receipts
      WHERE receipts.message_id = messages.id AND receipts.dismissed_at != '') AS dismissed_count
    FROM admin_messages AS messages
    ORDER BY messages.created_at DESC, messages.id DESC LIMIT ?1`, [safeLimit]);
  const targetRows = rows.length
    ? await all(db, `SELECT recipients.message_id, recipients.user_id
        FROM admin_message_recipients AS recipients
        JOIN (
          SELECT id FROM admin_messages
          WHERE target_scope != 'all'
          ORDER BY created_at DESC, id DESC LIMIT ?1
        ) AS visible_messages ON visible_messages.id = recipients.message_id
        ORDER BY recipients.message_id, recipients.user_id`, [safeLimit])
    : [];
  const targets = new Map();
  for (const row of targetRows) {
    if (!targets.has(row.message_id)) targets.set(row.message_id, []);
    targets.get(row.message_id).push(String(row.user_id));
  }
  return rows.map((row) => ({
    ...messagePayload(row),
    sender_user_id: String(row.sender_user_id || ""),
    sender_username: String(row.sender_username || ""),
    sender_role: String(row.sender_role || ""),
    recipient_count: Number(row.recipient_count || 0),
    seen_count: Number(row.seen_count || 0),
    acknowledged_count: Number(row.acknowledged_count || 0),
    dismissed_count: Number(row.dismissed_count || 0),
    target_user_ids: targets.get(row.id) || [],
    revoked_at: String(row.revoked_at || ""),
    can_revoke: row.status === "active" && (isOwnerAccount(actor) || String(row.sender_user_id) === String(actor.id)),
  }));
}

export async function revokeAdminMessage(db, actor, messageIdValue, requestId = "") {
  requireAdmin(actor);
  const messageId = cleanMessageId(messageIdValue);
  await expireMessages(db);
  const row = await first(db, "SELECT * FROM admin_messages WHERE id = ?1", [messageId]);
  if (!row) throw new Task18Error("站内消息不存在", 404, "message_not_found");
  if (!isOwnerAccount(actor) && String(row.sender_user_id) !== String(actor.id)) {
    throw new Task18Error("普通管理员只能撤回自己发送的消息", 403, "message_sender_protected");
  }
  if (row.status !== "active") return { changed: false, message: messagePayload(row) };
  const now = isoNow();
  const auditId = crypto.randomUUID();
  const results = await requireDatabase(db).batch([
    db.prepare(`INSERT INTO task18_admin_action_audit (
      id, actor_user_id, actor_username, actor_role, target_type, target_id,
      target_label, action, success, before_json, after_json, error_code,
      note, request_id, created_at
    ) SELECT ?1, ?2, ?3, ?4, 'admin_message', ?5, ?6, 'message_revoke', 1,
      ?7, ?8, '', '', ?9, ?10
      WHERE EXISTS (SELECT 1 FROM admin_messages WHERE id = ?5 AND status = 'active')`)
      .bind(
        auditId, actor.id, actor.username, actorRole(actor), row.id, row.target_scope,
        safeAuditJson({ status: "active" }), safeAuditJson({ status: "revoked" }),
        String(requestId || "").slice(0, 120), now,
      ),
    db.prepare(`UPDATE admin_messages SET status = 'revoked', revoked_at = ?2,
      revoked_by_user_id = ?3, updated_at = ?2 WHERE id = ?1 AND status = 'active'`)
      .bind(row.id, now, actor.id),
  ]);
  if (!changes(results[1])) {
    return { changed: false, message: messagePayload(await first(db, "SELECT * FROM admin_messages WHERE id = ?1", [row.id])) };
  }
  return { changed: true, message: messagePayload(await first(db, "SELECT * FROM admin_messages WHERE id = ?1", [row.id])) };
}

export async function listPendingMessages(db, account, limit = 20) {
  const now = isoNow();
  await expireMessages(db, now);
  const safeLimit = Math.max(1, Math.min(Number(limit || 20), 50));
  const rows = await all(db, `SELECT messages.*, receipts.first_seen_at,
    receipts.dismissed_at, receipts.acknowledged_at
    FROM admin_messages AS messages
    LEFT JOIN admin_message_receipts AS receipts
      ON receipts.message_id = messages.id AND receipts.user_id = ?1
    WHERE messages.status = 'active'
      AND (messages.expires_at = '' OR messages.expires_at > ?2)
      AND EXISTS (
        SELECT 1 FROM admin_message_recipients AS recipients
        WHERE recipients.message_id = messages.id AND recipients.user_id = ?1
      )
      AND (
        (messages.requires_confirmation = 1 AND COALESCE(receipts.acknowledged_at, '') = '')
        OR (messages.requires_confirmation = 0
          AND COALESCE(receipts.dismissed_at, '') = ''
          AND COALESCE(receipts.acknowledged_at, '') = '')
      )
    ORDER BY messages.created_at ASC, messages.id ASC LIMIT ?3`, [account.id, now, safeLimit]);
  if (rows.length) {
    await requireDatabase(db).batch(rows.map((row) => db.prepare(`INSERT INTO admin_message_receipts (
      message_id, user_id, first_seen_at, dismissed_at, acknowledged_at, updated_at
    ) VALUES (?1, ?2, ?3, '', '', ?3)
    ON CONFLICT(message_id, user_id) DO UPDATE SET
      first_seen_at = CASE WHEN admin_message_receipts.first_seen_at = '' THEN excluded.first_seen_at ELSE admin_message_receipts.first_seen_at END,
      updated_at = excluded.updated_at`)
      .bind(row.id, account.id, now)));
  }
  return rows.map(messagePayload);
}

async function eligibleMessage(db, account, messageId, now) {
  return await first(db, `SELECT messages.* FROM admin_messages AS messages
    WHERE messages.id = ?1 AND messages.status = 'active'
      AND (messages.expires_at = '' OR messages.expires_at > ?3)
      AND EXISTS (
        SELECT 1 FROM admin_message_recipients AS recipients
        WHERE recipients.message_id = messages.id AND recipients.user_id = ?2
      )`, [messageId, account.id, now]);
}

export async function updateMessageReceipt(db, account, messageIdValue, actionValue) {
  const messageId = cleanMessageId(messageIdValue);
  const action = String(actionValue || "").trim().toLowerCase();
  if (!new Set(["dismiss", "acknowledge"]).has(action)) {
    throw new Task18Error("消息回执操作无效", 400, "message_receipt_action_invalid");
  }
  const now = isoNow();
  await expireMessages(db, now);
  const message = await eligibleMessage(db, account, messageId, now);
  if (!message) throw new Task18Error("站内消息不存在或已失效", 404, "message_not_available");
  const acknowledge = action === "acknowledge";
  await run(db, `INSERT INTO admin_message_receipts (
    message_id, user_id, first_seen_at, dismissed_at, acknowledged_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?3)
  ON CONFLICT(message_id, user_id) DO UPDATE SET
    first_seen_at = CASE WHEN admin_message_receipts.first_seen_at = '' THEN excluded.first_seen_at ELSE admin_message_receipts.first_seen_at END,
    dismissed_at = CASE WHEN excluded.dismissed_at != '' THEN excluded.dismissed_at ELSE admin_message_receipts.dismissed_at END,
    acknowledged_at = CASE WHEN excluded.acknowledged_at != '' THEN excluded.acknowledged_at ELSE admin_message_receipts.acknowledged_at END,
    updated_at = excluded.updated_at`, [
    message.id,
    account.id,
    now,
    acknowledge ? "" : now,
    acknowledge ? now : "",
  ]);
  return {
    message_id: message.id,
    action,
    acknowledged: acknowledge,
    will_repeat: Boolean(message.requires_confirmation && !acknowledge),
  };
}

export async function listAdminActionAudit(db, actor, limit = 300) {
  requireAdmin(actor);
  const safeLimit = Math.max(1, Math.min(Number(limit || 300), 500));
  const owner = isOwnerAccount(actor);
  const rows = await all(db, `SELECT * FROM task18_admin_action_audit
    ${owner ? "" : "WHERE target_type != 'admin_role'"}
    ORDER BY created_at DESC, id DESC LIMIT ?1`, [safeLimit]);
  return rows.map((row) => {
    const item = { ...row, success: Boolean(row.success) };
    for (const field of ["before_json", "after_json"]) {
      const output = field.replace(/_json$/, "");
      try { item[output] = JSON.parse(item[field] || "{}"); } catch (_) { item[output] = {}; }
      delete item[field];
    }
    return item;
  });
}

export const __testing = Object.freeze({
  canonicalMessageInput,
  expireMessages,
  sameMessage,
});
