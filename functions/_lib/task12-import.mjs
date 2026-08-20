import { parsePasswordHash } from "./task12-crypto.mjs";
import {
  TASK12_SCHEMA_VERSION,
  Task12Error,
  auditSnapshot,
  isoNow,
  requireAllowedFields,
  validateUsername,
} from "./task12-model.mjs";
import { __testing as serviceTesting, accountCounts } from "./task12-service.mjs";

const IMPORT_KINDS = new Set(["accounts", "login_audit"]);
const ACCOUNT_FIELDS = new Set([
  "id", "username", "username_normalized", "password_hash", "password_scheme",
  "password_iterations", "role", "banned", "permanent_ban", "ban_reason", "deleted",
  "session_version", "registered_at", "last_login_at", "created_at", "updated_at",
]);
const LOGIN_AUDIT_FIELDS = new Set([
  "id", "user_id", "username", "success", "reason", "ip_address", "country",
  "region", "city", "user_agent", "source", "created_at",
]);
const FORBIDDEN_IMPORT_KEYS = /^(?:secret|password|token|session|raw_session)$/i;

function stringField(value, maximum, required = false) {
  const text = String(value || "").trim();
  if (required && !text) throw new Task12Error("导入字段不能为空", 400, "task12_import_field_required");
  if (text.length > maximum || /[\x00-\x1f\x7f]/.test(text)) {
    throw new Task12Error("导入字段无效", 400, "task12_import_field_invalid");
  }
  return text;
}

function timeField(value, required = false) {
  const text = stringField(value, 40, required);
  if (text && !Number.isFinite(Date.parse(text))) {
    throw new Task12Error("导入时间无效", 400, "task12_import_time_invalid");
  }
  return text;
}

function booleanInteger(value) {
  return value === true || value === 1 ? 1 : 0;
}

function accountRecord(record) {
  requireAllowedFields(record, ACCOUNT_FIELDS, "task12_import_fields_forbidden");
  if (Object.keys(record).some((key) => FORBIDDEN_IMPORT_KEYS.test(key))) {
    throw new Task12Error("导入包含禁止字段", 400, "task12_import_sensitive_field");
  }
  const id = stringField(record.id, 80, true);
  const username = validateUsername(record.username);
  const normalized = stringField(record.username_normalized, 80, true);
  const role = record.role === "super_admin" ? "super_admin" : "user";
  const passwordScheme = String(record.password_scheme || "");
  const passwordHash = String(record.password_hash || "");
  let iterations = 0;
  if (passwordScheme === "pbkdf2_sha256") {
    const parsed = parsePasswordHash(passwordHash);
    if (!parsed || parsed.iterations !== Number(record.password_iterations || parsed?.iterations)) {
      throw new Task12Error("密码摘要元数据无效", 400, "task12_import_password_invalid");
    }
    iterations = parsed.iterations;
  } else if (!new Set(["reset_required", "invalid"]).has(passwordScheme) || passwordHash) {
    throw new Task12Error("密码迁移状态无效", 400, "task12_import_password_invalid");
  }
  return {
    id, username, username_normalized: normalized, password_hash: passwordHash,
    password_scheme: passwordScheme, password_iterations: iterations, role,
    banned: booleanInteger(record.banned), permanent_ban: booleanInteger(record.permanent_ban),
    ban_reason: stringField(record.ban_reason, 500), deleted: booleanInteger(record.deleted),
    session_version: Math.max(1, Number.parseInt(String(record.session_version || 1), 10) || 1),
    registered_at: timeField(record.registered_at, true), last_login_at: timeField(record.last_login_at),
    created_at: timeField(record.created_at, true), updated_at: timeField(record.updated_at, true),
  };
}

function loginAuditRecord(record) {
  requireAllowedFields(record, LOGIN_AUDIT_FIELDS, "task12_import_fields_forbidden");
  return {
    id: stringField(record.id, 80, true), user_id: stringField(record.user_id, 80),
    username: stringField(record.username, 40), success: booleanInteger(record.success),
    reason: stringField(record.reason, 80), ip_address: stringField(record.ip_address, 80),
    country: stringField(record.country, 80), region: stringField(record.region, 120),
    city: stringField(record.city, 120), user_agent: stringField(record.user_agent, 400),
    source: stringField(record.source || "legacy_import", 40), created_at: timeField(record.created_at, true),
  };
}

async function importAccounts(db, actor, records) {
  let changed = 0;
  for (const raw of records) {
    const record = accountRecord(raw);
    const [existingId, existingName] = await Promise.all([
      serviceTesting.first(db, "SELECT * FROM task12_users WHERE id = ?1", [record.id]),
      serviceTesting.first(db, "SELECT id FROM task12_users WHERE username_normalized = ?1", [record.username_normalized]),
    ]);
    if (existingId && existingId.username_normalized !== record.username_normalized) {
      throw new Task12Error("用户 ID 与用户名映射冲突", 409, "task12_import_user_id_conflict");
    }
    if (existingName && existingName.id !== record.id) {
      throw new Task12Error("规范化用户名与用户 ID 冲突", 409, "task12_import_username_conflict");
    }
    const result = await serviceTesting.run(db, `INSERT INTO task12_users (
      id, username, username_normalized, password_hash, password_scheme, password_iterations,
      role, banned, permanent_ban, ban_reason, deleted, session_version,
      registered_at, last_login_at, created_at, updated_at, source_updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      username_normalized = excluded.username_normalized,
      password_hash = excluded.password_hash,
      password_scheme = excluded.password_scheme,
      password_iterations = excluded.password_iterations,
      role = excluded.role,
      banned = excluded.banned,
      permanent_ban = excluded.permanent_ban,
      ban_reason = excluded.ban_reason,
      deleted = excluded.deleted,
      session_version = MAX(task12_users.session_version, excluded.session_version),
      registered_at = excluded.registered_at,
      last_login_at = excluded.last_login_at,
      updated_at = excluded.updated_at,
      source_updated_at = excluded.source_updated_at
    WHERE excluded.source_updated_at > task12_users.source_updated_at`, [
      record.id, record.username, record.username_normalized, record.password_hash,
      record.password_scheme, record.password_iterations, record.role, record.banned,
      record.permanent_ban, record.ban_reason, record.deleted, record.session_version,
      record.registered_at, record.last_login_at, record.created_at, record.updated_at,
    ]);
    const rowChanges = Number(result?.meta?.changes || 0);
    changed += rowChanges;
    if (rowChanges > 0) {
      await serviceTesting.run(db, `INSERT INTO task12_account_audit_logs (
        id, actor_user_id, actor_username, target_user_id, target_username,
        action, before_json, after_json, note, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'account_import', ?6, ?7, 'SQLite 到 D1 账户迁移', ?8)`, [
        crypto.randomUUID(), actor.id, actor.username, record.id, record.username,
        JSON.stringify(auditSnapshot(existingId)), JSON.stringify(auditSnapshot(record)), isoNow(),
      ]);
    }
  }
  return changed;
}

async function importLoginAudit(db, records) {
  let changed = 0;
  for (const raw of records) {
    const record = loginAuditRecord(raw);
    const result = await serviceTesting.run(db, `INSERT OR IGNORE INTO task12_login_audit_logs (
      id, user_id, username, success, reason, ip_address,
      country, region, city, user_agent, source, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`, [
      record.id, record.user_id, record.username, record.success, record.reason,
      record.ip_address, record.country, record.region, record.city,
      record.user_agent, record.source, record.created_at,
    ]);
    changed += Number(result?.meta?.changes || 0);
  }
  return changed;
}

export async function importTask12Batch(db, actor, payload) {
  requireAllowedFields(payload, new Set(["schema_version", "kind", "records"]), "task12_import_fields_forbidden");
  if (String(payload.schema_version) !== TASK12_SCHEMA_VERSION) {
    throw new Task12Error("导入版本不受支持", 409, "task12_import_schema_unsupported");
  }
  const kind = String(payload.kind || "");
  if (!IMPORT_KINDS.has(kind)) throw new Task12Error("导入数据类型无效", 400, "task12_import_kind_invalid");
  if (!Array.isArray(payload.records) || payload.records.length > 100) {
    throw new Task12Error("单次导入记录数量超出限制", 413, "task12_import_record_limit");
  }
  const changed = kind === "accounts"
    ? await importAccounts(db, actor, payload.records)
    : await importLoginAudit(db, payload.records);
  return { kind, received: payload.records.length, changed, session_strategy: "invalidate_legacy_sessions" };
}

export async function task12ImportCounts(db) {
  return await accountCounts(db);
}

export const __testing = { accountRecord, importAccounts, importLoginAudit, loginAuditRecord };
