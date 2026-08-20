import {
  FEEDBACK_STATUSES,
  TASK11_SCHEMA_VERSION,
  Task11Error,
  stableStringify,
  validateAdminFeedbackInput,
  validateFeedbackInput,
  validateLearningSyncRequest,
} from "./task11-model.mjs";

const IMPORT_KINDS = new Set([
  "changelog",
  "feedback",
  "feedback_votes",
  "feedback_audit",
  "learning_records",
  "learning_heads",
  "learning_changes",
  "metadata",
]);
const ID_PATTERN = /^[A-Za-z0-9._~:-]{1,80}$/;
const HASH_PATTERN = /^(?:[a-f0-9]{64})?$/;

function invalid(message, code = "task11_import_invalid") {
  throw new Task11Error(message, 400, code);
}

function text(value, field, maximum, required = true) {
  const result = String(value || "").trim();
  if (required && !result) invalid(`${field}不能为空`, "task11_import_field_required");
  if (result.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result)) {
    invalid(`${field}无效`, "task11_import_field_invalid");
  }
  return result;
}

function timestamp(value, field) {
  const result = text(value, field, 40);
  if (!Number.isFinite(Date.parse(result))) invalid(`${field}无效`, "task11_import_time_invalid");
  return new Date(result).toISOString().replace(".000Z", "Z");
}

function objectValue(value, field) {
  let result = value;
  if (typeof result === "string") {
    try { result = JSON.parse(result || "{}"); } catch (_) { invalid(`${field}无效`, "task11_import_json_invalid"); }
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    invalid(`${field}必须是对象`, "task11_import_json_invalid");
  }
  return result;
}

function listValue(value, field) {
  if (!Array.isArray(value) || value.length > 100) invalid(`${field}无效`, "task11_import_list_invalid");
  return value.map((item) => text(item, field, 500)).filter(Boolean);
}

function ensureExactFields(record, allowed) {
  if (!record || typeof record !== "object" || Array.isArray(record)) invalid("导入记录格式无效");
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    invalid("导入记录包含不允许的字段", "task11_import_fields_forbidden");
  }
}

function syncChangeFromRecord(record) {
  return validateLearningSyncRequest({
    schema_version: 1,
    client_id: record.client_id,
    client_version: record.client_version,
    since_version: 0,
    changes: [{
      data_type: record.data_type,
      record_id: record.record_id,
      payload: objectValue(record.payload, "payload"),
      updated_at: record.updated_at,
      deleted: Boolean(record.deleted),
      base_server_version: 0,
    }],
  }).changes[0];
}

function changelogStatement(db, record) {
  ensureExactFields(record, new Set([
    "version", "build", "date", "title", "features", "improvements",
    "fixes", "security", "sort_order", "source_hash",
  ]));
  const version = text(record.version, "version", 80);
  const build = text(record.build, "build", 120);
  const date = text(record.date, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("更新日期无效");
  const sourceHash = text(record.source_hash, "source_hash", 64, false).toLowerCase();
  if (!HASH_PATTERN.test(sourceHash)) invalid("source_hash 无效");
  const now = new Date().toISOString().replace(".000Z", "Z");
  return db.prepare(`
    INSERT INTO task11_changelog_entries (
      version, build, release_date, title, features_json, improvements_json,
      fixes_json, security_json, sort_order, source_hash, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
    ON CONFLICT(version) DO UPDATE SET
      build = excluded.build,
      release_date = excluded.release_date,
      title = excluded.title,
      features_json = excluded.features_json,
      improvements_json = excluded.improvements_json,
      fixes_json = excluded.fixes_json,
      security_json = excluded.security_json,
      sort_order = excluded.sort_order,
      source_hash = excluded.source_hash,
      updated_at = excluded.updated_at
  `).bind(
    version,
    build,
    date,
    text(record.title, "title", 160),
    stableStringify(listValue(record.features, "features")),
    stableStringify(listValue(record.improvements, "improvements")),
    stableStringify(listValue(record.fixes, "fixes")),
    stableStringify(listValue(record.security, "security")),
    Number.isSafeInteger(record.sort_order) ? record.sort_order : 0,
    sourceHash,
    now,
  );
}

function feedbackStatement(db, record) {
  ensureExactFields(record, new Set([
    "id", "user_id", "username", "feedback_type", "title", "content",
    "route", "tool_id", "app_version", "browser_info", "error_code",
    "status", "admin_note", "merged_into_id", "created_at", "updated_at",
  ]));
  const values = validateFeedbackInput({
    type: record.feedback_type,
    title: record.title,
    content: record.content,
    route: record.route,
    tool_id: record.tool_id,
    app_version: record.app_version,
    browser_info: record.browser_info,
    error_code: record.error_code,
  });
  const status = text(record.status, "status", 20);
  if (!FEEDBACK_STATUSES.has(status)) invalid("反馈状态无效");
  const admin = validateAdminFeedbackInput({
    feedback_id: text(record.id, "feedback id", 64),
    action: "update",
    status,
    admin_note: record.admin_note,
    merged_into_id: record.merged_into_id,
  });
  return db.prepare(`
    INSERT INTO task11_feedback_items (
      id, user_id, username, feedback_type, title, content, route, tool_id,
      app_version, browser_info, error_code, status, admin_note, merged_into_id,
      created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      username = excluded.username,
      feedback_type = excluded.feedback_type,
      title = excluded.title,
      content = excluded.content,
      route = excluded.route,
      tool_id = excluded.tool_id,
      app_version = excluded.app_version,
      browser_info = excluded.browser_info,
      error_code = excluded.error_code,
      status = excluded.status,
      admin_note = excluded.admin_note,
      merged_into_id = excluded.merged_into_id,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= task11_feedback_items.updated_at
  `).bind(
    admin.feedback_id,
    text(record.user_id, "user id", 80),
    text(record.username, "username", 80),
    values.feedback_type,
    values.title,
    values.content,
    values.route,
    values.tool_id,
    values.app_version,
    values.browser_info,
    values.error_code,
    status,
    admin.admin_note,
    admin.merged_into_id,
    timestamp(record.created_at, "created_at"),
    timestamp(record.updated_at, "updated_at"),
  );
}

function voteStatement(db, record) {
  ensureExactFields(record, new Set(["feedback_id", "user_id", "created_at"]));
  return db.prepare(`
    INSERT INTO task11_feedback_votes (feedback_id, user_id, created_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(feedback_id, user_id) DO NOTHING
  `).bind(
    text(record.feedback_id, "feedback id", 64),
    text(record.user_id, "user id", 80),
    timestamp(record.created_at, "created_at"),
  );
}

function auditStatement(db, record) {
  ensureExactFields(record, new Set([
    "id", "actor_user_id", "actor_username", "action", "feedback_id",
    "target_user_id", "before", "after", "note", "created_at",
  ]));
  const action = text(record.action, "action", 40);
  if (!["feedback_update", "feedback_merge", "feedback_delete_spam", "feedback_import"].includes(action)) {
    invalid("审计操作无效");
  }
  return db.prepare(`
    INSERT INTO task11_feedback_audit_logs (
      id, actor_user_id, actor_username, action, feedback_id, target_user_id,
      before_json, after_json, note, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    text(record.id, "audit id", 64),
    text(record.actor_user_id, "actor user id", 80),
    text(record.actor_username, "actor username", 80),
    action,
    text(record.feedback_id, "feedback id", 64),
    text(record.target_user_id, "target user id", 80, false),
    stableStringify(objectValue(record.before, "before")),
    stableStringify(objectValue(record.after, "after")),
    text(record.note, "note", 1000, false),
    timestamp(record.created_at, "created_at"),
  );
}

function learningRecordStatement(db, record) {
  ensureExactFields(record, new Set([
    "user_id", "data_type", "record_id", "payload", "updated_at", "deleted",
    "client_id", "client_version", "server_version", "created_at", "server_updated_at",
  ]));
  const clean = syncChangeFromRecord(record);
  const version = Number(record.server_version);
  if (!Number.isSafeInteger(version) || version < 0) invalid("server_version 无效");
  return db.prepare(`
    INSERT INTO task11_learning_sync_records (
      user_id, data_type, record_id, payload_json, updated_at, deleted,
      client_id, client_version, server_version, created_at, server_updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(user_id, data_type, record_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      client_id = excluded.client_id,
      client_version = excluded.client_version,
      server_version = excluded.server_version,
      server_updated_at = excluded.server_updated_at
    WHERE excluded.server_version > task11_learning_sync_records.server_version
       OR (excluded.server_version = task11_learning_sync_records.server_version
           AND excluded.updated_at >= task11_learning_sync_records.updated_at)
  `).bind(
    text(record.user_id, "user id", 80),
    clean.data_type,
    clean.record_id,
    stableStringify(clean.deleted ? {} : clean.payload),
    clean.updated_at,
    clean.deleted ? 1 : 0,
    clean.client_id,
    clean.client_version,
    version,
    timestamp(record.created_at, "created_at"),
    timestamp(record.server_updated_at, "server_updated_at"),
  );
}

function learningHeadStatement(db, record) {
  ensureExactFields(record, new Set(["user_id", "version", "updated_at"]));
  const version = Number(record.version);
  if (!Number.isSafeInteger(version) || version < 0) invalid("sync head version 无效");
  return db.prepare(`
    INSERT INTO task11_learning_sync_heads (user_id, version, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id) DO UPDATE SET
      version = MAX(task11_learning_sync_heads.version, excluded.version),
      updated_at = CASE
        WHEN excluded.version >= task11_learning_sync_heads.version THEN excluded.updated_at
        ELSE task11_learning_sync_heads.updated_at
      END
  `).bind(
    text(record.user_id, "user id", 80),
    version,
    timestamp(record.updated_at, "updated_at"),
  );
}

function learningChangeStatement(db, record) {
  ensureExactFields(record, new Set([
    "user_id", "user_version", "data_type", "record_id", "payload", "updated_at",
    "deleted", "client_id", "client_version", "created_at",
  ]));
  const clean = syncChangeFromRecord(record);
  const version = Number(record.user_version);
  if (!Number.isSafeInteger(version) || version <= 0) invalid("user_version 无效");
  return db.prepare(`
    INSERT INTO task11_learning_sync_changes (
      user_id, user_version, data_type, record_id, payload_json, updated_at,
      deleted, client_id, client_version, mutation_id, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(user_id, user_version) DO NOTHING
  `).bind(
    text(record.user_id, "user id", 80),
    version,
    clean.data_type,
    clean.record_id,
    stableStringify(clean.deleted ? {} : clean.payload),
    clean.updated_at,
    clean.deleted ? 1 : 0,
    clean.client_id,
    clean.client_version,
    `import:${text(record.user_id, "user id", 80)}:${version}`,
    timestamp(record.created_at, "created_at"),
  );
}

function metadataStatement(db, record) {
  ensureExactFields(record, new Set(["key", "value", "updated_at"]));
  const key = text(record.key, "metadata key", 80);
  if (!ID_PATTERN.test(key)) invalid("metadata key 无效");
  return db.prepare(`
    INSERT INTO task11_metadata (key, value, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(key, text(record.value, "metadata value", 500), timestamp(record.updated_at, "updated_at"));
}

function statementFor(db, kind, record) {
  if (kind === "changelog") return changelogStatement(db, record);
  if (kind === "feedback") return feedbackStatement(db, record);
  if (kind === "feedback_votes") return voteStatement(db, record);
  if (kind === "feedback_audit") return auditStatement(db, record);
  if (kind === "learning_records") return learningRecordStatement(db, record);
  if (kind === "learning_heads") return learningHeadStatement(db, record);
  if (kind === "learning_changes") return learningChangeStatement(db, record);
  return metadataStatement(db, record);
}

export function validateImportEnvelope(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid("导入请求格式无效");
  if (Object.keys(payload).some((key) => !["schema_version", "kind", "records"].includes(key))) {
    invalid("导入请求包含不允许的字段", "task11_import_fields_forbidden");
  }
  if (payload.schema_version !== TASK11_SCHEMA_VERSION) invalid("导入版本不受支持", "task11_import_schema_unsupported");
  const kind = String(payload.kind || "").trim();
  if (!IMPORT_KINDS.has(kind)) invalid("导入数据类型无效", "task11_import_kind_invalid");
  const maximum = ["feedback_votes", "learning_changes"].includes(kind) ? 200 : 100;
  if (!Array.isArray(payload.records) || payload.records.length > maximum) {
    invalid("单次导入记录数量超出限制", "task11_import_record_limit");
  }
  return { kind, records: payload.records };
}

export async function importTask11Batch(db, payload) {
  const envelope = validateImportEnvelope(payload);
  const statements = envelope.records.map((record) => statementFor(db, envelope.kind, record));
  if (!statements.length) return { kind: envelope.kind, received: 0, changed: 0 };
  const results = await db.batch(statements);
  const changed = results.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0);
  return { kind: envelope.kind, received: envelope.records.length, changed };
}

export async function task11ImportCounts(db) {
  const tables = Object.freeze({
    changelog: "task11_changelog_entries",
    feedback: "task11_feedback_items",
    feedback_votes: "task11_feedback_votes",
    feedback_audit: "task11_feedback_audit_logs",
    learning_records: "task11_learning_sync_records",
    learning_heads: "task11_learning_sync_heads",
    learning_changes: "task11_learning_sync_changes",
    telemetry_buckets: "task11_usage_buckets",
  });
  const statements = Object.entries(tables).map(([kind, table]) => ({
    kind,
    statement: db.prepare(`SELECT COUNT(*) AS count FROM ${table}`),
  }));
  const results = await db.batch(statements.map((item) => item.statement));
  return Object.fromEntries(results.map((result, index) => [
    statements[index].kind,
    Number(result?.results?.[0]?.count || 0),
  ]));
}

export const __testing = { IMPORT_KINDS, statementFor };
