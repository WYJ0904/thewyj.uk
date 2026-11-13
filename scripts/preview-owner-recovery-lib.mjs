import {
  PASSWORD_HASH_ITERATIONS,
  hashSecret,
  passwordPepperConfigured,
} from "../functions/_lib/task12-crypto.mjs";
import {
  auditSnapshot,
  isoNow,
  validateSecret,
} from "../functions/_lib/task12-model.mjs";

export const PINNED_PREVIEW_OWNER_IDENTIFIER = "task18-preview-owner-10f06c88";
export const PREVIEW_D1_DATABASE_ID = "a3e6253b-689f-49f3-998b-7c5828ea255a";
export const PREVIEW_D1_DATABASE_NAME = "wyj-cloud-preview";
export const PREVIEW_RECOVERY_CONFIRM_PHRASE = "PREVIEW-OWNER-RECOVERY-10F06C88";
export const FORBIDDEN_USERNAMES = new Set(["wyj"]);

const OPTIONAL_TABLES = Object.freeze([
  "task18_admin_roles",
  "task18_admin_action_audit",
  "task20_device_sessions",
]);

export class PreviewOwnerRecoveryError extends Error {
  constructor(message, code = "preview_owner_recovery_error", status = 400) {
    super(message);
    this.name = "PreviewOwnerRecoveryError";
    this.code = code;
    this.status = status;
  }
}

export function assertPreviewRecoveryTarget(options = {}) {
  const environment = String(options.environment || "preview").trim().toLowerCase();
  if (environment !== "preview") {
    throw new PreviewOwnerRecoveryError(
      `Refusing non-preview environment '${environment}'`,
      "forbidden_environment",
      403,
    );
  }
  if (options.remote) {
    const databaseId = String(options.databaseId || "").trim();
    const databaseName = String(options.databaseName || "").trim();
    if (databaseId !== PREVIEW_D1_DATABASE_ID) {
      throw new PreviewOwnerRecoveryError(
        "Remote recovery is pinned strictly to Preview D1 UUID",
        "pinned_database_id_mismatch",
        403,
      );
    }
    if (databaseName !== PREVIEW_D1_DATABASE_NAME) {
      throw new PreviewOwnerRecoveryError(
        "Remote recovery is pinned strictly to Preview D1 name",
        "pinned_database_name_mismatch",
        403,
      );
    }
  }
}

async function existingTables(db, names) {
  const placeholders = names.map((_, index) => `?${index + 1}`).join(", ");
  const result = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .bind(...names)
    .all();
  return new Set((result.results || []).map((row) => String(row.name)));
}

export async function readPreviewOwnerSnapshot(db, now = isoNow()) {
  if (!db?.prepare) {
    throw new PreviewOwnerRecoveryError("D1 database handle is required", "database_unavailable", 503);
  }
  const tables = await existingTables(db, OPTIONAL_TABLES);
  const superAdminsResult = await db.prepare(`
    SELECT id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, banned, permanent_ban, deleted, session_version,
      registered_at, last_login_at, created_at, updated_at, source_updated_at
    FROM task12_users
    WHERE role = 'super_admin'
    ORDER BY created_at ASC, id ASC
  `).all();
  const superAdmins = superAdminsResult.results || [];
  if (superAdmins.length !== 1) {
    throw new PreviewOwnerRecoveryError(
      `Expected exactly 1 super_admin account, found ${superAdmins.length}`,
      "single_owner_invariant_failed",
      409,
    );
  }
  const owner = superAdmins[0];
  const activeSessionsRow = await db.prepare(`
    SELECT COUNT(*) AS active_count
    FROM task12_sessions
    WHERE user_id = ?1 AND revoked = 0 AND expires_at > ?2
  `).bind(owner.id, now).first();
  const totalSessionsRow = await db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM task12_sessions
    WHERE user_id = ?1
  `).bind(owner.id).first();
  let activeDeviceSessions = 0;
  if (tables.has("task20_device_sessions")) {
    const deviceRow = await db.prepare(`
      SELECT COUNT(*) AS active_count
      FROM task20_device_sessions
      WHERE user_id = ?1 AND revoked = 0 AND refresh_expires_at > ?2
    `).bind(owner.id, now).first();
    activeDeviceSessions = Number(deviceRow?.active_count || 0);
  }
  let assignedAdminRoleCount = 0;
  if (tables.has("task18_admin_roles")) {
    const roleRow = await db.prepare(
      "SELECT COUNT(*) AS count FROM task18_admin_roles WHERE user_id = ?1",
    ).bind(owner.id).first();
    assignedAdminRoleCount = Number(roleRow?.count || 0);
  }
  return {
    owner,
    tables,
    active_sessions: Number(activeSessionsRow?.active_count || 0),
    total_sessions: Number(totalSessionsRow?.total_count || 0),
    active_device_sessions: activeDeviceSessions,
    assigned_admin_role_count: assignedAdminRoleCount,
  };
}

export function validateOwnerPreconditions(snapshot, options = {}) {
  const { owner, active_sessions: activeSessions, active_device_sessions: activeDeviceSessions } = snapshot;
  const requireResetRequired = options.requireResetRequired !== false;
  const requireNoActiveSessions = options.requireNoActiveSessions !== false;

  const normalized = String(owner.username_normalized || "").trim().toLowerCase();
  if (FORBIDDEN_USERNAMES.has(normalized)) {
    throw new PreviewOwnerRecoveryError(
      "Production owner username is strictly forbidden in Preview recovery",
      "forbidden_production_owner_identity",
      403,
    );
  }
  if (String(owner.id) !== PINNED_PREVIEW_OWNER_IDENTIFIER && normalized !== PINNED_PREVIEW_OWNER_IDENTIFIER) {
    throw new PreviewOwnerRecoveryError(
      "Super-admin account does not match pinned Preview Owner identifier",
      "pinned_preview_owner_mismatch",
      403,
    );
  }
  if (String(owner.role) !== "super_admin") {
    throw new PreviewOwnerRecoveryError("Account is not super_admin", "owner_role_invalid", 409);
  }
  if (Number(owner.banned) !== 0 || Number(owner.permanent_ban) !== 0 || Number(owner.deleted) !== 0) {
    throw new PreviewOwnerRecoveryError(
      "Pinned Preview Owner account is banned or deleted",
      "owner_account_unavailable",
      409,
    );
  }
  if (snapshot.assigned_admin_role_count !== 0) {
    throw new PreviewOwnerRecoveryError(
      "Super-admin must not hold a secondary task18_admin_roles entry",
      "owner_admin_role_conflict",
      409,
    );
  }
  if (requireResetRequired) {
    if (String(owner.password_scheme) !== "reset_required" || String(owner.password_hash || "") !== "") {
      throw new PreviewOwnerRecoveryError(
        `Owner password_scheme is '${owner.password_scheme}', expected 'reset_required' with empty hash`,
        "owner_not_reset_required",
        409,
      );
    }
  }
  if (requireNoActiveSessions) {
    if (activeSessions > 0) {
      throw new PreviewOwnerRecoveryError(
        `Owner already has ${activeSessions} active task12 session(s)`,
        "owner_active_session_exists",
        409,
      );
    }
    if (activeDeviceSessions > 0) {
      throw new PreviewOwnerRecoveryError(
        `Owner already has ${activeDeviceSessions} active task20 device session(s)`,
        "owner_active_device_session_exists",
        409,
      );
    }
  }
}

export function sanitizeOwnerReport(snapshot) {
  const { owner } = snapshot;
  return {
    owner_id: String(owner.id),
    username: String(owner.username),
    role: String(owner.role),
    banned: Boolean(owner.banned),
    permanent_ban: Boolean(owner.permanent_ban),
    deleted: Boolean(owner.deleted),
    password_scheme: String(owner.password_scheme),
    password_iterations: Number(owner.password_iterations || 0),
    has_password_hash: Boolean(owner.password_hash),
    session_version: Number(owner.session_version || 1),
    active_sessions: snapshot.active_sessions,
    total_sessions: snapshot.total_sessions,
    active_device_sessions: snapshot.active_device_sessions,
  };
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function renderSql(sql, params) {
  return sql.replace(/\?(\d+)/g, (_, idx) => sqlLiteral(params[Number(idx) - 1]));
}

export async function prepareRecoveryPlan(db, options = {}) {
  assertPreviewRecoveryTarget(options);
  const now = options.now || isoNow();
  const snapshot = await readPreviewOwnerSnapshot(db, now);
  validateOwnerPreconditions(snapshot, options);

  const pepper = String(options.passwordPepper || "");
  if (!passwordPepperConfigured(pepper)) {
    throw new PreviewOwnerRecoveryError(
      "WYJ_TASK12_PASSWORD_PEPPER is missing or shorter than 32 bytes",
      "password_pepper_not_configured",
      503,
    );
  }
  let cleanSecret;
  try {
    cleanSecret = validateSecret(options.newSecret);
  } catch (error) {
    throw new PreviewOwnerRecoveryError(error.message, error.code || "invalid_secret", 400);
  }

  const { owner, tables } = snapshot;
  const beforeSessionVersion = Number(owner.session_version || 1);
  const nextSessionVersion = beforeSessionVersion + 1;
  const passwordHash = await hashSecret(cleanSecret, pepper);
  const beforeAudit = auditSnapshot(owner);
  const afterAudit = {
    ...beforeAudit,
    password_scheme: "pbkdf2_sha256",
    session_version: nextSessionVersion,
  };
  const note = String(
    options.note || "Controlled Preview Owner recovery from reset_required (preserves UUID, role, and single-owner constraints)",
  ).slice(0, 500);
  const requestId = String(options.requestId || `preview-owner-recovery:${crypto.randomUUID()}`).slice(0, 120);
  const accountAuditId = crypto.randomUUID();
  const adminAuditId = crypto.randomUUID();

  const updateOwnerSql = `
    UPDATE task12_users
    SET password_hash = ?2,
        password_scheme = 'pbkdf2_sha256',
        password_iterations = ?3,
        session_version = session_version + 1,
        updated_at = ?4,
        source_updated_at = ?4
    WHERE id = ?1
      AND username_normalized = ?5
      AND role = 'super_admin'
      AND banned = 0
      AND permanent_ban = 0
      AND deleted = 0
      AND password_scheme = 'reset_required'
      AND password_hash = ''
      AND session_version = ?6
      AND (SELECT COUNT(*) FROM task12_users WHERE role = 'super_admin') = 1
  `.trim();
  const updateOwnerParams = [
    owner.id,
    passwordHash,
    PASSWORD_HASH_ITERATIONS,
    now,
    owner.username_normalized,
    beforeSessionVersion,
  ];

  const ownerVerifiedSubquery = `
    EXISTS (
      SELECT 1 FROM task12_users
      WHERE id = ?1
        AND role = 'super_admin'
        AND banned = 0
        AND permanent_ban = 0
        AND deleted = 0
        AND password_scheme = 'pbkdf2_sha256'
        AND password_hash = ?3
        AND session_version = ?4
    )
  `.trim();

  const revokeSessionsSql = `
    UPDATE task12_sessions
    SET revoked = 1, revoked_at = ?2
    WHERE user_id = ?1 AND revoked = 0
      AND ${ownerVerifiedSubquery}
  `.trim();
  const revokeSessionsParams = [owner.id, now, passwordHash, nextSessionVersion];

  const statementsSpec = [
    { sql: updateOwnerSql, params: updateOwnerParams },
    { sql: revokeSessionsSql, params: revokeSessionsParams },
  ];

  if (tables.has("task20_device_sessions")) {
    statementsSpec.push({
      sql: `
        UPDATE task20_device_sessions
        SET revoked = 1, revoked_at = ?2, revoke_reason = 'preview_owner_recovery'
        WHERE user_id = ?1 AND revoked = 0
          AND ${ownerVerifiedSubquery}
      `.trim(),
      params: [owner.id, now, passwordHash, nextSessionVersion],
    });
  }

  statementsSpec.push({
    sql: `
      INSERT INTO task12_account_audit_logs (
        id, actor_user_id, actor_username, target_user_id, target_username,
        action, before_json, after_json, note, created_at
      )
      SELECT ?5, ?1, ?6, ?1, ?6, 'password_reset', ?7, ?8, ?9, ?2
      WHERE ${ownerVerifiedSubquery}
    `.trim(),
    params: [
      owner.id,
      now,
      passwordHash,
      nextSessionVersion,
      accountAuditId,
      owner.username,
      JSON.stringify(beforeAudit),
      JSON.stringify(afterAudit),
      note,
    ],
  });

  if (tables.has("task18_admin_action_audit")) {
    statementsSpec.push({
      sql: `
        INSERT INTO task18_admin_action_audit (
          id, actor_user_id, actor_username, actor_role, target_type, target_id,
          target_label, action, success, before_json, after_json, error_code,
          note, request_id, created_at
        )
        SELECT ?5, ?1, ?6, 'super_admin', 'owner_recovery', ?1, ?6,
               'preview_owner_credential_recovery', 1, ?7, ?8, '', ?9, ?10, ?2
        WHERE ${ownerVerifiedSubquery}
      `.trim(),
      params: [
        owner.id,
        now,
        passwordHash,
        nextSessionVersion,
        adminAuditId,
        owner.username,
        JSON.stringify(beforeAudit),
        JSON.stringify(afterAudit),
        note,
        requestId,
      ],
    });
  }

  if (options.injectFailureAfterUpdate) {
    statementsSpec.push({
      sql: "SELECT * FROM preview_owner_recovery_injected_failure_table",
      params: [],
    });
  }

  return {
    before: sanitizeOwnerReport(snapshot),
    nextSessionVersion,
    requestId,
    accountAuditId,
    adminAuditId,
    statementsSpec,
    sqlText: statementsSpec.map((item) => `${renderSql(item.sql, item.params)};`).join("\n"),
  };
}

export async function applyPreviewOwnerRecovery(db, options = {}) {
  const plan = await prepareRecoveryPlan(db, options);
  const statements = plan.statementsSpec.map((item) => db.prepare(item.sql).bind(...item.params));
  const results = await db.batch(statements);
  const updatedRows = Number(results[0]?.meta?.changes || 0);
  if (updatedRows !== 1) {
    throw new PreviewOwnerRecoveryError(
      `Expected 1 owner row updated, got ${updatedRows}`,
      "owner_recovery_update_mismatch",
      409,
    );
  }
  const afterSnapshot = await readPreviewOwnerSnapshot(db, options.now || isoNow());
  validateOwnerPreconditions(afterSnapshot, {
    requireResetRequired: false,
    requireNoActiveSessions: true,
  });
  if (String(afterSnapshot.owner.password_scheme) !== "pbkdf2_sha256" || !afterSnapshot.owner.password_hash) {
    throw new PreviewOwnerRecoveryError(
      "Post-recovery owner password_scheme verification failed",
      "post_recovery_verification_failed",
      500,
    );
  }
  if (Number(afterSnapshot.owner.session_version) !== plan.nextSessionVersion) {
    throw new PreviewOwnerRecoveryError(
      "Post-recovery session_version mismatch",
      "post_recovery_session_version_mismatch",
      500,
    );
  }
  return {
    ok: true,
    before: plan.before,
    after: sanitizeOwnerReport(afterSnapshot),
    request_id: plan.requestId,
    account_audit_id: plan.accountAuditId,
    admin_audit_id: plan.adminAuditId,
  };
}
