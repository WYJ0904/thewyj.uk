import {
  FEEDBACK_PUBLIC_TYPES,
  FEEDBACK_STATUSES,
  LEARNING_SYNC_MAX_TOTAL_RECORDS,
  LEARNING_SYNC_PULL_LIMIT,
  LEARNING_SYNC_SCHEMA_VERSION,
  LEARNING_SYNC_TYPE_LIMITS,
  TASK11_SCHEMA_VERSION,
  Task11Error,
  feedbackAuditSnapshot,
  feedbackPayload,
  learningRecordPayload,
  mergeLearningRecord,
  parseStringArray,
  stableStringify,
  validateAdminFeedbackInput,
  validateFeedbackInput,
  validateLearningSyncRequest,
  validateTelemetryInput,
} from "./task11-model.mjs";

const FEEDBACK_TYPES = new Set([
  "feature_suggestion", "tool_error", "page_issue",
  "account_issue", "new_tool", "other",
]);

function resultsOf(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

async function first(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

async function all(db, sql, bindings = []) {
  return resultsOf(await db.prepare(sql).bind(...bindings).all());
}

function nowIso() {
  return new Date().toISOString().replace(".000Z", "Z");
}

function requireDatabase(db) {
  if (!db?.prepare || typeof db.batch !== "function") {
    throw new Task11Error("云端数据库暂时不可用。", 503, "task11_database_unavailable", true);
  }
  return db;
}

export async function ensureTask11Schema(db) {
  requireDatabase(db);
  const row = await first(db, "SELECT value FROM task11_metadata WHERE key = ?1", ["schema_version"]);
  return String(row?.value || "") === String(TASK11_SCHEMA_VERSION);
}

function changelogPayload(row) {
  return {
    version: String(row.version || ""),
    build: String(row.build || ""),
    date: String(row.release_date || ""),
    title: String(row.title || ""),
    features: parseStringArray(row.features_json),
    improvements: parseStringArray(row.improvements_json),
    fixes: parseStringArray(row.fixes_json),
    security: parseStringArray(row.security_json),
  };
}

export async function listChangelog(db, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, 200));
  const rows = await all(requireDatabase(db), `
    SELECT version, build, release_date, title, features_json,
           improvements_json, fixes_json, security_json
    FROM task11_changelog_entries
    ORDER BY release_date DESC, sort_order ASC, version DESC
    LIMIT ?1
  `, [safeLimit]);
  return rows.map(changelogPayload);
}

async function feedbackRow(db, feedbackId, userId = "") {
  return first(db, `
    SELECT item.*,
           (SELECT COUNT(*) FROM task11_feedback_votes AS vote
            WHERE vote.feedback_id = item.id) AS vote_count,
           CASE WHEN ?2 = '' THEN 0 ELSE EXISTS(
             SELECT 1 FROM task11_feedback_votes AS own
             WHERE own.feedback_id = item.id AND own.user_id = ?2
           ) END AS own_vote
    FROM task11_feedback_items AS item
    WHERE item.id = ?1
  `, [feedbackId, userId]);
}

export async function createFeedback(db, account, payload) {
  const values = validateFeedbackInput(payload);
  const id = crypto.randomUUID();
  const now = nowIso();
  await requireDatabase(db).prepare(`
    INSERT INTO task11_feedback_items (
      id, user_id, username, feedback_type, title, content,
      route, tool_id, app_version, browser_info, error_code,
      status, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?12)
  `).bind(
    id,
    String(account.id),
    String(account.username || ""),
    values.feedback_type,
    values.title,
    values.content,
    values.route,
    values.tool_id,
    values.app_version,
    values.browser_info,
    values.error_code,
    now,
  ).run();
  return feedbackPayload(await feedbackRow(db, id, String(account.id)));
}

export async function listOwnFeedback(db, account, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, 200));
  const userId = String(account.id);
  const rows = await all(requireDatabase(db), `
    SELECT item.*,
           (SELECT COUNT(*) FROM task11_feedback_votes AS vote
            WHERE vote.feedback_id = item.id) AS vote_count,
           EXISTS(SELECT 1 FROM task11_feedback_votes AS own
                  WHERE own.feedback_id = item.id AND own.user_id = ?1) AS own_vote
    FROM task11_feedback_items AS item
    WHERE item.user_id = ?1
    ORDER BY item.created_at DESC, item.id DESC
    LIMIT ?2
  `, [userId, safeLimit]);
  return rows.map((row) => feedbackPayload(row));
}

export async function listFeatureVotes(db, account, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, 200));
  const userId = String(account.id);
  const rows = await all(requireDatabase(db), `
    SELECT item.*,
           (SELECT COUNT(*) FROM task11_feedback_votes AS vote
            WHERE vote.feedback_id = item.id) AS vote_count,
           EXISTS(SELECT 1 FROM task11_feedback_votes AS own
                  WHERE own.feedback_id = item.id AND own.user_id = ?1) AS own_vote
    FROM task11_feedback_items AS item
    WHERE item.feedback_type IN ('feature_suggestion', 'new_tool')
      AND item.status IN ('accepted', 'completed')
      AND item.merged_into_id = ''
    ORDER BY vote_count DESC, item.updated_at DESC, item.id DESC
    LIMIT ?2
  `, [userId, safeLimit]);
  return rows.map((row) => feedbackPayload(row, { includeContent: false }));
}

export async function setFeatureVote(db, account, payload) {
  const allowed = new Set(["feedback_id", "voted"]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task11Error("投票请求包含不允许的字段", 400, "feedback_vote_fields_forbidden");
  }
  const feedbackId = String(payload.feedback_id || "").trim();
  if (!feedbackId || feedbackId.length > 64) {
    throw new Task11Error("缺少功能建议 ID", 400, "feedback_id_required");
  }
  if (typeof payload.voted !== "boolean") {
    throw new Task11Error("投票状态无效", 400, "feedback_vote_invalid");
  }
  const row = await first(requireDatabase(db), "SELECT * FROM task11_feedback_items WHERE id = ?1", [feedbackId]);
  if (!row || !FEEDBACK_PUBLIC_TYPES.has(row.feedback_type)
      || !["accepted", "completed"].includes(row.status) || row.merged_into_id) {
    throw new Task11Error("该建议暂不开放投票", 404, "feedback_vote_unavailable");
  }
  const userId = String(account.id);
  if (payload.voted) {
    await db.prepare(`
      INSERT INTO task11_feedback_votes (feedback_id, user_id, created_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(feedback_id, user_id) DO NOTHING
    `).bind(feedbackId, userId, nowIso()).run();
  } else {
    await db.prepare("DELETE FROM task11_feedback_votes WHERE feedback_id = ?1 AND user_id = ?2")
      .bind(feedbackId, userId).run();
  }
  return feedbackPayload(await feedbackRow(db, feedbackId, userId), { includeContent: false });
}

function safeSearch(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length > 80) throw new Task11Error("搜索内容最多 80 个字符", 400, "feedback_field_too_long");
  if (/[\x00-\x1f\x7f]/.test(text)) throw new Task11Error("搜索内容无效", 400, "feedback_field_invalid");
  return text;
}

function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export async function listAdminFeedback(db, searchParams) {
  const query = safeSearch(searchParams.get("query"));
  const status = String(searchParams.get("status") || "").trim();
  const type = String(searchParams.get("type") || "").trim();
  if (status && !FEEDBACK_STATUSES.has(status)) {
    throw new Task11Error("反馈状态无效", 400, "feedback_status_invalid");
  }
  if (type && !FEEDBACK_TYPES.has(type)) {
    throw new Task11Error("反馈类型无效", 400, "feedback_type_invalid");
  }
  const clauses = [];
  const bindings = [];
  if (query) {
    clauses.push("(item.title LIKE ? ESCAPE '\\' OR item.username LIKE ? ESCAPE '\\' OR item.id LIKE ? ESCAPE '\\')");
    const pattern = likePattern(query);
    bindings.push(pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("item.status = ?");
    bindings.push(status);
  }
  if (type) {
    clauses.push("item.feedback_type = ?");
    bindings.push(type);
  }
  bindings.push(500);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await all(requireDatabase(db), `
    SELECT item.*,
           (SELECT COUNT(*) FROM task11_feedback_votes AS vote
            WHERE vote.feedback_id = item.id) AS vote_count,
           0 AS own_vote
    FROM task11_feedback_items AS item
    ${where}
    ORDER BY item.updated_at DESC, item.id DESC
    LIMIT ?
  `, bindings);
  const audit = await all(db, `
    SELECT id, actor_user_id, actor_username, action, feedback_id,
           target_user_id, note, created_at
    FROM task11_feedback_audit_logs
    ORDER BY created_at DESC, id DESC
    LIMIT ?1
  `, [100]);
  return {
    feedback: rows.map((row) => feedbackPayload(row, { includeAdmin: true })),
    task11_audit: audit,
  };
}

async function insertFeedbackAudit(db, actor, action, row, before, after, note, statements = null) {
  const statement = db.prepare(`
    INSERT INTO task11_feedback_audit_logs (
      id, actor_user_id, actor_username, action, feedback_id,
      target_user_id, before_json, after_json, note, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `).bind(
    crypto.randomUUID(),
    String(actor.id),
    String(actor.username || ""),
    action,
    String(row.id),
    String(row.user_id || ""),
    stableStringify(before),
    stableStringify(after),
    String(note || "").slice(0, 1000),
    nowIso(),
  );
  if (statements) statements.push(statement);
  else await statement.run();
}

export async function updateAdminFeedback(db, actor, payload) {
  requireDatabase(db);
  const input = validateAdminFeedbackInput(payload);
  const row = await first(db, "SELECT * FROM task11_feedback_items WHERE id = ?1", [input.feedback_id]);
  if (!row) throw new Task11Error("反馈不存在", 404, "feedback_not_found");
  const before = feedbackAuditSnapshot(row);
  const now = nowIso();
  const statements = [];
  if (input.action === "update") {
    const status = input.status || row.status;
    statements.push(db.prepare(`
      UPDATE task11_feedback_items
      SET status = ?1, admin_note = ?2, updated_at = ?3
      WHERE id = ?4
    `).bind(status, input.admin_note, now, input.feedback_id));
    await insertFeedbackAudit(
      db,
      actor,
      "feedback_update",
      row,
      before,
      { ...before, status, admin_note: input.admin_note },
      `状态：${status}`,
      statements,
    );
  } else if (input.action === "merge") {
    if (!input.merged_into_id || input.merged_into_id === input.feedback_id) {
      throw new Task11Error("请选择另一个建议作为合并目标", 400, "feedback_merge_invalid");
    }
    const destination = await first(db, "SELECT * FROM task11_feedback_items WHERE id = ?1", [input.merged_into_id]);
    if (!destination || !FEEDBACK_PUBLIC_TYPES.has(row.feedback_type)
        || !FEEDBACK_PUBLIC_TYPES.has(destination.feedback_type)) {
      throw new Task11Error("只能合并功能建议或新工具建议", 400, "feedback_merge_invalid");
    }
    statements.push(db.prepare(`
      INSERT INTO task11_feedback_votes (feedback_id, user_id, created_at)
      SELECT ?1, user_id, created_at FROM task11_feedback_votes WHERE feedback_id = ?2
      ON CONFLICT(feedback_id, user_id) DO NOTHING
    `).bind(input.merged_into_id, input.feedback_id));
    statements.push(db.prepare("DELETE FROM task11_feedback_votes WHERE feedback_id = ?1").bind(input.feedback_id));
    statements.push(db.prepare(`
      UPDATE task11_feedback_items
      SET status = 'rejected', admin_note = ?1, merged_into_id = ?2, updated_at = ?3
      WHERE id = ?4
    `).bind(input.admin_note, input.merged_into_id, now, input.feedback_id));
    await insertFeedbackAudit(
      db,
      actor,
      "feedback_merge",
      row,
      before,
      { ...before, status: "rejected", merged_into_id: input.merged_into_id, admin_note: input.admin_note },
      `合并至 ${input.merged_into_id}`,
      statements,
    );
  } else {
    statements.push(db.prepare("DELETE FROM task11_feedback_votes WHERE feedback_id = ?1").bind(input.feedback_id));
    statements.push(db.prepare("DELETE FROM task11_feedback_items WHERE id = ?1").bind(input.feedback_id));
    await insertFeedbackAudit(
      db,
      actor,
      "feedback_delete_spam",
      row,
      before,
      { id: input.feedback_id, deleted: true },
      "删除垃圾反馈",
      statements,
    );
  }
  await db.batch(statements);
  if (input.action === "delete_spam") return { id: input.feedback_id, deleted: true };
  return feedbackPayload(await feedbackRow(db, input.feedback_id), { includeAdmin: true });
}

class LearningSyncWriteConflict extends Error {
  constructor() {
    super("learning sync write conflict");
    this.name = "LearningSyncWriteConflict";
  }
}

async function writeLearningRecord(db, userId, record, existing, expectedHeadVersion) {
  const now = nowIso();
  const payloadJson = stableStringify(record.deleted ? {} : record.payload);
  const createdAt = existing?.created_at || now;
  const expectedRecordVersion = Number(existing?.server_version || 0);
  const expectedRecordExists = existing ? 1 : 0;
  const nextVersion = expectedHeadVersion + 1;
  const mutationId = crypto.randomUUID();
  const batch = await db.batch([
    db.prepare(`
      INSERT INTO task11_learning_sync_heads (user_id, version, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(user_id) DO NOTHING
    `).bind(userId, expectedHeadVersion, now),
    db.prepare(`
      UPDATE task11_learning_sync_heads
      SET version = version + 1, updated_at = ?1
      WHERE user_id = ?2 AND version = ?3
        AND (
          (?4 = 0 AND NOT EXISTS(
            SELECT 1 FROM task11_learning_sync_records
            WHERE user_id = ?2 AND data_type = ?5 AND record_id = ?6
          ))
          OR
          (?4 = 1 AND EXISTS(
            SELECT 1 FROM task11_learning_sync_records
            WHERE user_id = ?2 AND data_type = ?5 AND record_id = ?6
              AND server_version = ?7
          ))
        )
    `).bind(
      now,
      userId,
      expectedHeadVersion,
      expectedRecordExists,
      record.data_type,
      record.record_id,
      expectedRecordVersion,
    ),
    db.prepare(`
      INSERT INTO task11_learning_sync_changes (
        user_id, user_version, data_type, record_id, payload_json,
        updated_at, deleted, client_id, client_version, mutation_id, created_at
      )
      SELECT ?1, version, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
      FROM task11_learning_sync_heads
      WHERE user_id = ?1 AND version = ?11
        AND (
          (?12 = 0 AND NOT EXISTS(
            SELECT 1 FROM task11_learning_sync_records
            WHERE user_id = ?1 AND data_type = ?2 AND record_id = ?3
          ))
          OR
          (?12 = 1 AND EXISTS(
            SELECT 1 FROM task11_learning_sync_records
            WHERE user_id = ?1 AND data_type = ?2 AND record_id = ?3
              AND server_version = ?13
          ))
        )
      ON CONFLICT(user_id, user_version) DO NOTHING
    `).bind(
      userId,
      record.data_type,
      record.record_id,
      payloadJson,
      record.updated_at,
      record.deleted ? 1 : 0,
      record.client_id,
      record.client_version,
      mutationId,
      now,
      nextVersion,
      expectedRecordExists,
      expectedRecordVersion,
    ),
    db.prepare(`
      INSERT INTO task11_learning_sync_records (
        user_id, data_type, record_id, payload_json, updated_at, deleted,
        client_id, client_version, server_version, created_at, server_updated_at
      )
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
      FROM task11_learning_sync_changes
      WHERE user_id = ?1 AND user_version = ?9 AND mutation_id = ?12
      ON CONFLICT(user_id, data_type, record_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        client_id = excluded.client_id,
        client_version = excluded.client_version,
        server_version = excluded.server_version,
        server_updated_at = excluded.server_updated_at
    `).bind(
      userId,
      record.data_type,
      record.record_id,
      payloadJson,
      record.updated_at,
      record.deleted ? 1 : 0,
      record.client_id,
      record.client_version,
      nextVersion,
      createdAt,
      now,
      mutationId,
    ),
    db.prepare(`
      SELECT * FROM task11_learning_sync_records
      WHERE user_id = ?1 AND data_type = ?2 AND record_id = ?3
    `).bind(userId, record.data_type, record.record_id),
  ]);
  if (Number(batch[2]?.meta?.changes || 0) !== 1
      || Number(batch[3]?.meta?.changes || 0) !== 1) {
    throw new LearningSyncWriteConflict();
  }
  const row = resultsOf(batch.at(-1))[0];
  if (!row) throw new Error("task11 sync write did not return a record");
  return row;
}

async function enforceLearningRecordLimits(db, userId, dataType, existing, canonical) {
  if (!existing) {
    const [typeCountRow, totalCountRow] = await Promise.all([
      first(db, `
        SELECT COUNT(*) AS count FROM task11_learning_sync_records
        WHERE user_id = ?1 AND data_type = ?2
      `, [userId, dataType]),
      first(db, "SELECT COUNT(*) AS count FROM task11_learning_sync_records WHERE user_id = ?1", [userId]),
    ]);
    if (Number(typeCountRow?.count || 0) >= LEARNING_SYNC_TYPE_LIMITS[dataType]) {
      throw new Task11Error("该类学习记录数量超出限制", 413, "learning_sync_type_limit");
    }
    if (Number(totalCountRow?.count || 0) >= LEARNING_SYNC_MAX_TOTAL_RECORDS) {
      throw new Task11Error("学习记录总数超出限制", 413, "learning_sync_total_limit");
    }
  } else if (!canonical.deleted && Number(existing.deleted || 0)) {
    const activeCount = await first(db, `
      SELECT COUNT(*) AS count FROM task11_learning_sync_records
      WHERE user_id = ?1 AND data_type = ?2 AND deleted = 0
    `, [userId, dataType]);
    if (Number(activeCount?.count || 0) >= LEARNING_SYNC_TYPE_LIMITS[dataType]) {
      throw new Task11Error("该类学习记录数量超出限制", 413, "learning_sync_type_limit");
    }
  }
}

export async function syncLearningData(db, account, payload) {
  requireDatabase(db);
  const request = validateLearningSyncRequest(payload);
  const userId = String(account.id);
  const results = [];
  let mergedCount = 0;
  let acceptedCount = 0;

  for (const incoming of request.changes) {
    let existing;
    let canonical;
    let changed;
    let merged;
    let row;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const [current, head] = await Promise.all([
        first(db, `
          SELECT * FROM task11_learning_sync_records
          WHERE user_id = ?1 AND data_type = ?2 AND record_id = ?3
        `, [userId, incoming.data_type, incoming.record_id]),
        first(db, "SELECT version FROM task11_learning_sync_heads WHERE user_id = ?1", [userId]),
      ]);
      existing = current;
      ({ canonical, changed, merged } = mergeLearningRecord(existing, incoming));
      if (!changed) {
        row = existing;
        break;
      }
      await enforceLearningRecordLimits(db, userId, incoming.data_type, existing, canonical);
      try {
        row = await writeLearningRecord(
          db,
          userId,
          canonical,
          existing,
          Math.max(Number(head?.version || 0), Number(existing?.server_version || 0)),
        );
        break;
      } catch (error) {
        if (!(error instanceof LearningSyncWriteConflict) || attempt === 3) throw error;
      }
    }
    if (changed) acceptedCount += 1;
    if (row) results.push(learningRecordPayload(row));
    if (merged) mergedCount += 1;
  }

  const head = await first(db, "SELECT version FROM task11_learning_sync_heads WHERE user_id = ?1", [userId]);
  const serverVersion = Number(head?.version || 0);
  const resetRequired = request.since_version > serverVersion;
  const sinceVersion = resetRequired ? 0 : request.since_version;
  const rows = await all(db, `
    SELECT * FROM task11_learning_sync_changes
    WHERE user_id = ?1 AND user_version > ?2
    ORDER BY user_version ASC
    LIMIT ?3
  `, [userId, sinceVersion, LEARNING_SYNC_PULL_LIMIT + 1]);
  const hasMore = rows.length > LEARNING_SYNC_PULL_LIMIT;
  const visibleRows = rows.slice(0, LEARNING_SYNC_PULL_LIMIT);
  const nextSinceVersion = hasMore && visibleRows.length
    ? Number(visibleRows.at(-1).user_version)
    : serverVersion;
  return {
    schema_version: LEARNING_SYNC_SCHEMA_VERSION,
    server_version: serverVersion,
    next_since_version: nextSinceVersion,
    has_more: hasMore,
    reset_required: resetRequired,
    accepted_count: acceptedCount,
    merged_count: mergedCount,
    results,
    changes: visibleRows.map(learningRecordPayload),
  };
}

export async function recordTelemetry(db, payload) {
  const event = validateTelemetryInput(payload);
  const timeBucket = new Date().toISOString().slice(0, 13);
  const now = nowIso();
  await requireDatabase(db).prepare(`
    INSERT INTO task11_usage_buckets (
      time_bucket, feature_id, outcome, latency_bucket, error_code, event_count, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
    ON CONFLICT(time_bucket, feature_id, outcome, latency_bucket, error_code)
    DO UPDATE SET event_count = task11_usage_buckets.event_count + 1, updated_at = excluded.updated_at
  `).bind(
    timeBucket,
    event.feature_id,
    event.outcome,
    event.latency_bucket,
    event.error_code,
    now,
  ).run();
  return { recorded: true, time_bucket: timeBucket };
}

export async function listTelemetry(db, searchParams) {
  const hours = Math.max(1, Math.min(Number.parseInt(searchParams.get("hours"), 10) || 168, 720));
  const feature = String(searchParams.get("feature_id") || "").trim().toLowerCase();
  if (feature && !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(feature)) {
    throw new Task11Error("统计功能 ID 无效", 400, "telemetry_feature_invalid");
  }
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().slice(0, 13);
  const rows = feature
    ? await all(requireDatabase(db), `
      SELECT time_bucket, feature_id, outcome, latency_bucket, error_code, event_count, updated_at
      FROM task11_usage_buckets
      WHERE time_bucket >= ?1 AND feature_id = ?2
      ORDER BY time_bucket DESC, feature_id, outcome
      LIMIT 500
    `, [cutoff, feature])
    : await all(requireDatabase(db), `
      SELECT time_bucket, feature_id, outcome, latency_bucket, error_code, event_count, updated_at
      FROM task11_usage_buckets
      WHERE time_bucket >= ?1
      ORDER BY time_bucket DESC, feature_id, outcome
      LIMIT 500
    `, [cutoff]);
  return { hours, buckets: rows };
}

export const __testing = { changelogPayload, resultsOf, writeLearningRecord };
