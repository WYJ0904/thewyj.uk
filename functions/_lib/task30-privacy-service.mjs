import { isAdminAccount } from './task12-model.mjs';
import { cleanupExpiredShares } from './task14-service.mjs';
import { cleanupExpiredTransfers } from './task22-service.mjs';
import { cleanupStorageBudget, retryMultipartAborts } from './secure-file-cleanup.mjs';
import { isCanonicalObjectKey } from './secure-file-policy.mjs';
import { atomic, eventStatements, securityState, stmt } from './task27-store.mjs';
import { authorize } from './task27-security.mjs';
import {
  CONSENT_DEFINITIONS,
  DEVICE_OS_PERMISSIONS_DISCLOSURE,
  ESSENTIAL_SERVICE_PROCESSING,
  PRIVACY_CATEGORY_ORDER,
  PRIVACY_DATA_CATALOG,
  PrivacyError,
  TASK30_CATALOG_VERSION,
  TASK30_PRIVACY_POLICY_BASELINE,
} from './task30-privacy-catalog.mjs';

const CONSENT_BY_KEY = new Map(CONSENT_DEFINITIONS.map((item) => [item.key, item]));
const ALLOWED_SCOPES = new Set(['category', 'account']);
const ALLOWED_REQUEST_STATUSES = new Set([
  'requested',
  'verified',
  'access_revoked',
  'cleanup_pending',
  'completed',
  'retry_pending',
  'partially_completed',
  'blocked_by_retention',
  'failed',
  'cancelled',
]);

function nowIso() {
  return new Date().toISOString();
}

function futureIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function cleanId(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJsonSafe(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function first(db, sql, values = []) {
  return db.prepare(sql).bind(...values).first();
}

async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  return result?.results || [];
}

async function runSql(db, sql, values = []) {
  return db.prepare(sql).bind(...values).run();
}

async function existingTables(db, names) {
  if (!db || !names.length) return new Set();
  const placeholders = names.map((_, idx) => `?${idx + 1}`).join(', ');
  try {
    const rows = await all(
      db,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      names,
    );
    return new Set(rows.map((row) => String(row.name)));
  } catch {
    return new Set();
  }
}

async function countWhere(db, tables, tableName, whereClause, values = []) {
  if (!tables.has(tableName)) return 0;
  const row = await first(db, `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE ${whereClause}`, values);
  return Number(row?.cnt || 0);
}

export async function hasTask30(db) {
  if (!db) return false;
  try {
    const row = await first(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task30_metadata'",
    );
    if (!row) return false;
    const version = await first(db, "SELECT value FROM task30_metadata WHERE key = 'schema_version'");
    return String(version?.value || '') === '2026-11-18-v1';
  } catch {
    return false;
  }
}

export async function ensureTask30Schema(db) {
  if (!(await hasTask30(db))) {
    throw new PrivacyError(
      'task30_schema_not_ready',
      '隐私控制与安全删除数据表尚未完成迁移',
      503,
      { retryable: true },
    );
  }
}

export async function writePrivacyAudit(db, entry) {
  if (!(await hasTask30(db))) return;
  const safeSummary = entry.summary && typeof entry.summary === 'object' ? { ...entry.summary } : {};
  for (const sensitive of ['secret', 'password', 'token', 'content_text', 'message', 'merchant', 'note', 'body']) {
    if (sensitive in safeSummary) delete safeSummary[sensitive];
  }
  await runSql(
    db,
    `INSERT INTO task30_privacy_audit (
      id, user_id, actor_id, action, category_key, target_type, target_id, status, summary_json, request_id, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    [
      `privaud:${crypto.randomUUID()}`,
      String(entry.userId),
      String(entry.actorId || entry.userId),
      String(entry.action || 'privacy_event'),
      entry.categoryKey ? String(entry.categoryKey) : null,
      entry.targetType ? String(entry.targetType) : null,
      entry.targetId ? String(entry.targetId) : null,
      String(entry.status || 'ok'),
      JSON.stringify(safeSummary),
      String(entry.requestId || 'system'),
      nowIso(),
    ],
  );
}

export function computeRecordTombstoneIdentities(categoryKey, entityType, record = {}) {
  const entries = [];
  const seen = new Set();
  const push = (tType, tKey) => {
    const key = cleanId(tKey, 240);
    if (!key) return;
    const composite = `${tType}\0${key}`;
    if (seen.has(composite)) return;
    seen.add(composite);
    entries.push({ categoryKey, entityType: tType, entityKey: key });
  };

  const id = cleanId(record.id, 160);
  const transactionId = cleanId(record.transaction_id || record.finance_transaction_id || record.finance_entry_id, 160);
  const eventId = cleanId(record.event_id, 160);
  const sourceEventId = cleanId(record.source_event_id, 160);
  const sourceType = cleanId(record.source_type, 40).toLowerCase();
  const sourcePackage = cleanId(record.source_package, 160);
  const paymentChannel = cleanId(record.payment_channel || record.source_provider, 60).toLowerCase();
  const providerReference = cleanId(record.provider_reference, 180);
  const lifecycleIdentity = cleanId(record.lifecycle_identity, 180);

  if (entityType === 'transaction') {
    push('transaction', id);
    push('transaction', transactionId);
  } else if (entityType === 'category') {
    push('category', id);
  } else if (entityType === 'budget') {
    push('budget', id);
  } else if (entityType === 'raw_event') {
    push('raw_event', id);
  } else if (entityType === 'notification_event') {
    push('notification_event', eventId || id);
  } else if (entityType === 'notification_candidate') {
    push('notification_candidate', id);
    if (eventId) push('notification_event', eventId);
  } else if (entityType === 'notification_hint') {
    push('notification_hint', id);
  } else if (id) {
    push(entityType, id);
  }

  if (sourceEventId) {
    push('source_event', sourceEventId);
    if (sourceType) push('source_event', `${sourceType}:${sourceEventId}`);
  }
  if (eventId) {
    push('source_event', eventId);
    if (sourceType) push('source_event', `${sourceType}:${eventId}`);
  }
  if (providerReference && paymentChannel) {
    push('provider_reference', `${paymentChannel}:${providerReference}`);
    if (sourcePackage) {
      push('provider_reference', `${sourcePackage}:${paymentChannel}:${providerReference}`);
      push('provider_reference', `${sourcePackage.toLowerCase()}:${providerReference}`);
    }
  } else if (providerReference && sourcePackage) {
    push('provider_reference', `${sourcePackage.toLowerCase()}:${providerReference}`);
  }
  const importSourceKey = cleanId(record.import_source_key, 180);
  if (importSourceKey) {
    push('import_source_key', importSourceKey);
  }
  if (lifecycleIdentity) {
    push('lifecycle_identity', lifecycleIdentity);
  }

  return entries;
}

export async function checkTombstoneCollision(db, userId, identities, options = {}) {
  if (!db || !userId || !Array.isArray(identities) || !identities.length) return null;
  const tables = await existingTables(db, ['task30_erasure_tombstones']);
  if (!tables.has('task30_erasure_tombstones')) return null;

  const now = nowIso();
  const deduped = [];
  const seen = new Set();
  for (const item of identities) {
    if (!item?.entityType || !item?.entityKey) continue;
    const key = `${item.entityType}\0${item.entityKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  if (!deduped.length) return null;

  for (let offset = 0; offset < deduped.length; offset += 25) {
    const chunk = deduped.slice(offset, offset + 25);
    const clauses = [];
    const binds = [userId, now];
    for (const item of chunk) {
      const idxType = binds.push(String(item.entityType));
      const idxKey = binds.push(String(item.entityKey));
      clauses.push(`(entity_type = ?${idxType} AND entity_key = ?${idxKey})`);
    }
    const levelFilter = options.permanentOnly ? "AND tombstone_level = 'permanent_erasure'" : '';
    const match = await first(
      db,
      `SELECT id, category_key, entity_type, entity_key, tombstone_level, erasure_request_id, reason, tombstone_generation, created_at
       FROM task30_erasure_tombstones
       WHERE user_id = ?1
         AND (expires_at IS NULL OR expires_at > ?2)
         ${levelFilter}
         AND (${clauses.join(' OR ')})
       ORDER BY CASE tombstone_level WHEN 'permanent_erasure' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1`,
      binds,
    );
    if (match) return match;
  }
  return null;
}

export function recordTombstonesStatements(db, userId, categoryKey, entries, options = {}) {
  const now = options.now || nowIso();
  const level = options.tombstoneLevel === 'soft_delete' ? 'soft_delete' : 'permanent_erasure';
  const requestId = options.erasureRequestId || null;
  const reason = cleanId(options.reason || 'user_erasure', 120) || 'user_erasure';
  const generation = Number(options.generation || 1);
  const expiresAt = options.expiresAt || null;

  const stmts = [];
  const seen = new Set();
  for (const item of entries) {
    if (!item?.entityType || !item?.entityKey) continue;
    const comp = `${item.entityType}\0${item.entityKey}`;
    if (seen.has(comp)) continue;
    seen.add(comp);
    stmts.push(
      db.prepare(`INSERT INTO task30_erasure_tombstones (
          id, user_id, category_key, entity_type, entity_key, tombstone_level, erasure_request_id,
          reason, tombstone_generation, created_at, expires_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10)
        ON CONFLICT(user_id, entity_type, entity_key) DO UPDATE SET
          category_key = excluded.category_key,
          tombstone_level = CASE
            WHEN task30_erasure_tombstones.tombstone_level = 'permanent_erasure' THEN 'permanent_erasure'
            ELSE excluded.tombstone_level
          END,
          erasure_request_id = COALESCE(excluded.erasure_request_id, task30_erasure_tombstones.erasure_request_id),
          reason = CASE
            WHEN task30_erasure_tombstones.tombstone_level = 'permanent_erasure' AND excluded.tombstone_level = 'soft_delete'
              THEN task30_erasure_tombstones.reason
            ELSE excluded.reason
          END,
          tombstone_generation = MAX(task30_erasure_tombstones.tombstone_generation, excluded.tombstone_generation),
          expires_at = CASE
            WHEN task30_erasure_tombstones.tombstone_level = 'permanent_erasure' THEN NULL
            ELSE excluded.expires_at
          END,
          updated_at = excluded.updated_at`).bind(
        `tomb:${crypto.randomUUID()}`,
        userId,
        item.categoryKey || categoryKey,
        item.entityType,
        item.entityKey,
        level,
        requestId,
        reason,
        generation,
        now,
        level === 'permanent_erasure' ? null : expiresAt,
      ),
    );
  }
  return stmts;
}

export function clearSoftDeleteTombstonesStatements(db, userId, entries) {
  const stmts = [];
  for (const item of entries) {
    if (!item?.entityType || !item?.entityKey) continue;
    stmts.push(
      db.prepare(`DELETE FROM task30_erasure_tombstones
        WHERE user_id = ?1 AND entity_type = ?2 AND entity_key = ?3 AND tombstone_level = 'soft_delete'`)
        .bind(userId, item.entityType, item.entityKey),
    );
  }
  return stmts;
}

export async function currentErasureGeneration(db, userId, categoryKey) {
  const tables = await existingTables(db, ['task30_erasure_generations']);
  if (!tables.has('task30_erasure_generations')) return 0;
  const row = await first(
    db,
    'SELECT generation FROM task30_erasure_generations WHERE user_id = ?1 AND category_key = ?2',
    [userId, categoryKey],
  );
  return Number(row?.generation || 0);
}

export async function getUserErasureGenerationsMap(db, userId) {
  const tables = await existingTables(db, ['task30_erasure_generations']);
  const out = {};
  if (!tables.has('task30_erasure_generations')) return out;
  const rows = await all(
    db,
    'SELECT category_key, generation, last_erasure_request_id, last_erasure_at FROM task30_erasure_generations WHERE user_id = ?1',
    [userId],
  );
  for (const row of rows) {
    out[String(row.category_key)] = {
      generation: Number(row.generation || 0),
      last_erasure_request_id: row.last_erasure_request_id || null,
      last_erasure_at: row.last_erasure_at || null,
    };
  }
  return out;
}

export async function isCloudNotificationSyncAllowed(db, userId) {
  if (!db || !userId) return true;
  const tables = await existingTables(db, ['task30_user_consents']);
  if (!tables.has('task30_user_consents')) return true;
  const row = await first(
    db,
    "SELECT granted FROM task30_user_consents WHERE user_id = ?1 AND consent_key = 'cloud_notification_sync'",
    [userId],
  );
  if (!row) return true;
  return Number(row.granted) === 1;
}

async function gatherCategorySummary(db, userId, tables) {
  const now = nowIso();
  const [
    activeWebSessions,
    activeDeviceSessions,
    recoveryCodes,
    txCount,
    catCount,
    budgetCount,
    rawCount,
    notifEventCount,
    notifCandCount,
    notifHintCount,
    share22Count,
    upload22Count,
    grant22Count,
    share14Count,
    roomMsg14Count,
    grant14Count,
    export29Count,
    restoreJob29Count,
    feedbackCount,
    inboundThreadCount,
    deliveryCount,
    paymentOrderCount,
    learningSyncCount,
    learningQuizCount,
    masteryCount,
    wrongStateCount,
    aiDecisionCount,
    tombstoneCount,
  ] = await Promise.all([
    countWhere(db, tables, 'task12_sessions', 'user_id = ?1 AND revoked = 0 AND expires_at > ?2', [userId, now]),
    countWhere(db, tables, 'task20_device_sessions', 'user_id = ?1 AND revoked = 0', [userId]),
    countWhere(db, tables, 'task27_recovery_codes', 'user_id = ?1 AND used_at = \'\'', [userId]),
    countWhere(db, tables, 'task16_finance_transactions', 'user_id = ?1 AND status = \'active\'', [userId]),
    countWhere(db, tables, 'task16_finance_categories', 'user_id = ?1 AND status = \'active\'', [userId]),
    countWhere(db, tables, 'task16_finance_budgets', 'user_id = ?1 AND status = \'active\'', [userId]),
    countWhere(db, tables, 'task16_finance_raw_events', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task21_notification_events', 'user_id = ?1 AND status = \'active\'', [userId]),
    countWhere(db, tables, 'task21_notification_candidates', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task21_notification_pending_hints', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task22_shares', "owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'", [userId]),
    countWhere(db, tables, 'task22_upload_sessions', "owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'", [userId]),
    tables.has('task22_download_grants') && tables.has('task22_shares')
      ? first(
          db,
          `SELECT COUNT(*) AS cnt FROM task22_download_grants g
           JOIN task22_shares s ON s.id = g.share_id
           WHERE s.owner_kind = 'user' AND s.owner_ref = ?1 AND g.state = 'active'`,
          [userId],
        ).then((r) => Number(r?.cnt || 0))
      : 0,
    countWhere(db, tables, 'task14_shares', "owner_user_id = ?1 AND state IN ('uploading', 'active')", [userId]),
    tables.has('task14_room_messages') && tables.has('task14_shares')
      ? first(
          db,
          `SELECT COUNT(*) AS cnt FROM task14_room_messages m
           JOIN task14_shares s ON s.id = m.room_id
           WHERE s.owner_user_id = ?1`,
          [userId],
        ).then((r) => Number(r?.cnt || 0))
      : 0,
    tables.has('task14_download_grants') && tables.has('task14_shares')
      ? first(
          db,
          `SELECT COUNT(*) AS cnt FROM task14_download_grants g
           JOIN task14_shares s ON s.id = g.share_id
           WHERE s.owner_user_id = ?1 AND g.state = 'active'`,
          [userId],
        ).then((r) => Number(r?.cnt || 0))
      : 0,
    countWhere(db, tables, 'task29_backup_exports', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task29_restore_jobs', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task11_feedback_items', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'email_center_inbound_threads', 'matched_user_id = ?1', [userId]),
    countWhere(db, tables, 'email_center_deliveries', 'target_user_id = ?1', [userId]),
    countWhere(db, tables, 'task13_payment_orders', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task11_learning_sync_records', 'user_id = ?1 AND deleted = 0', [userId]),
    countWhere(db, tables, 'task15_quiz_sessions', 'user_id = ?1 AND expires_at > ?2', [userId, now]),
    countWhere(db, tables, 'task26_mastery_states', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task26_wrong_review_states', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'finance_ai_decisions', 'user_id = ?1', [userId]),
    countWhere(db, tables, 'task30_erasure_tombstones', 'user_id = ?1', [userId]),
  ]);

  let secState = { verified_email: '', mfa_method: 'none' };
  if (tables.has('task27_security')) {
    const row = await first(
      db,
      'SELECT verified_email, mfa_method FROM task27_security WHERE user_id = ?1',
      [userId],
    );
    if (row) secState = row;
  }

  return {
    account_security: {
      active_web_sessions: activeWebSessions,
      active_device_sessions: activeDeviceSessions,
      active_recovery_codes: recoveryCodes,
      verified_email_bound: Boolean(secState.verified_email),
      mfa_method: String(secState.mfa_method || 'none'),
      total_items: activeWebSessions + activeDeviceSessions + recoveryCodes,
    },
    finance: {
      transactions: txCount,
      categories: catCount,
      budgets: budgetCount,
      raw_events: rawCount,
      ai_decisions: aiDecisionCount,
      tombstones: tombstoneCount,
      total_items: txCount + catCount + budgetCount + rawCount,
    },
    notifications_cloud: {
      events: notifEventCount,
      candidates: notifCandCount,
      pending_hints: notifHintCount,
      total_items: notifEventCount + notifCandCount + notifHintCount,
    },
    files: {
      active_shares: share22Count,
      active_upload_sessions: upload22Count,
      active_download_grants: grant22Count,
      total_items: share22Count + upload22Count,
    },
    temporary: {
      active_shares: share14Count,
      room_messages: roomMsg14Count,
      active_download_grants: grant14Count,
      total_items: share14Count + roomMsg14Count,
    },
    backups: {
      export_records: export29Count,
      restore_jobs: restoreJob29Count,
      total_items: export29Count + restoreJob29Count,
    },
    support: {
      feedback_items: feedbackCount,
      inbound_threads_retained: inboundThreadCount,
      email_deliveries_retained: deliveryCount,
      payment_orders_retained: paymentOrderCount,
      total_items: feedbackCount + inboundThreadCount + deliveryCount + paymentOrderCount,
    },
    learning: {
      sync_records: learningSyncCount,
      quiz_sessions: learningQuizCount,
      mastery_states: masteryCount,
      wrong_review_states: wrongStateCount,
      total_items: learningSyncCount + learningQuizCount + masteryCount + wrongStateCount,
    },
  };
}

const ALL_MANAGED_TABLES = [
  'task12_users',
  'task12_sessions',
  'task12_login_audit_logs',
  'task12_account_audit_logs',
  'task20_device_sessions',
  'task20_used_refresh_tokens',
  'task27_security',
  'task27_challenges',
  'task27_recovery_codes',
  'task27_events',
  'task27_notifications',
  'task27_policy_consents',
  'task13_user_memberships',
  'task13_user_entitlement_overrides',
  'task13_payment_orders',
  'task14_shares',
  'task14_room_messages',
  'task14_download_grants',
  'task14_usage_daily',
  'task11_feedback_items',
  'task11_feedback_votes',
  'task11_learning_sync_records',
  'task11_learning_sync_heads',
  'task11_learning_sync_changes',
  'task15_quiz_sessions',
  'task15_ai_cache',
  'task15_tool_favorites',
  'task15_tool_recent_usage',
  'task15_saved_tool_configs',
  'task16_finance_devices',
  'task16_finance_user_versions',
  'task16_finance_categories',
  'task16_finance_budgets',
  'task16_finance_transactions',
  'task16_finance_raw_events',
  'task16_finance_transaction_events',
  'task16_finance_audit_logs',
  'task16_finance_changes',
  'task16_finance_sync_operations',
  'task16_fx_references',
  'task16_currency_preferences',
  'task16_currency_role_evidence',
  'finance_ai_consents',
  'finance_ai_observations',
  'finance_ai_decisions',
  'task18_admin_roles',
  'task21_notification_events',
  'task21_notification_candidates',
  'task21_notification_pending_hints',
  'task21_notification_evidence',
  'task21_notification_review_aliases',
  'task21_notification_sync_operations',
  'task21_payment_reference_aliases',
  'task21_payment_reconciliations',
  'task21_payment_effective_events',
  'task21_payment_reconciliation_guards',
  'task21_payment_user_decisions',
  'task21_payment_control_closures',
  'task21_payment_lifecycle_guards',
  'task21_currency_units',
  'task22_upload_sessions',
  'task22_upload_files',
  'task22_upload_parts',
  'task22_shares',
  'task22_share_files',
  'task22_download_grants',
  'task22_usage_daily',
  'task28_file_events',
  'task28_multipart_cleanup',
  'task25_release_preferences',
  'task25_user_flag_overrides',
  'task26_learning_events',
  'task26_question_tickets',
  'task26_mastery_states',
  'task26_wrong_review_events',
  'task26_wrong_review_states',
  'task29_backup_exports',
  'task29_restore_jobs',
  'task29_restore_idempotency',
  'task29_backup_audit',
  'email_center_bindings',
  'email_center_deliveries',
  'email_center_inbound_threads',
  'email_center_inbound_messages',
  'task30_user_consents',
  'task30_erasure_requests',
  'task30_erasure_tasks',
  'task30_erasure_generations',
  'task30_erasure_tombstones',
  'task30_cleanup_runs',
  'task30_privacy_audit',
];

function formatRequestRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    request_type: String(row.request_type),
    scope_type: String(row.scope_type),
    categories: parseJsonSafe(row.categories_json, []),
    mode: String(row.mode),
    status: String(row.status),
    idempotency_key: row.idempotency_key || null,
    stepup_scope: row.stepup_scope || null,
    stepup_verified: Number(row.stepup_verified) === 1,
    access_revoked_at: row.access_revoked_at || null,
    preview: parseJsonSafe(row.preview_json, {}),
    result: parseJsonSafe(row.result_json, {}),
    exceptions: parseJsonSafe(row.exception_summary_json, []),
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    attempt_count: Number(row.attempt_count || 0),
    max_attempts: Number(row.max_attempts || 5),
    next_retry_at: row.next_retry_at || null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at || null,
  };
}

export async function getPrivacyConsents(context, account) {
  const db = context.env.WYJ_DB;
  await ensureTask30Schema(db);
  const tables = await existingTables(db, [
    'task30_user_consents',
    'finance_ai_consents',
    'task14_shares',
    'task14_download_grants',
    'task22_shares',
    'task22_upload_sessions',
    'task22_download_grants',
  ]);

  const storedRows = tables.has('task30_user_consents')
    ? await all(db, 'SELECT * FROM task30_user_consents WHERE user_id = ?1', [account.id])
    : [];
  const storedMap = new Map(storedRows.map((row) => [String(row.consent_key), row]));

  let financeAiRow = null;
  if (tables.has('finance_ai_consents')) {
    financeAiRow = await first(db, 'SELECT enabled, revision, updated_at FROM finance_ai_consents WHERE user_id = ?1', [
      account.id,
    ]);
  }

  const [activeTempShares, activeFileShares, activeUploadSessions] = await Promise.all([
    countWhere(db, tables, 'task14_shares', "owner_user_id = ?1 AND state IN ('uploading', 'active')", [account.id]),
    countWhere(db, tables, 'task22_shares', "owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'", [account.id]),
    countWhere(db, tables, 'task22_upload_sessions', "owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'", [
      account.id,
    ]),
  ]);

  const consents = CONSENT_DEFINITIONS.map((def) => {
    const stored = storedMap.get(def.key);
    let granted = Boolean(def.default_granted);
    let status = def.default_granted ? 'granted' : 'not_configured';
    let grantedAt = stored?.granted_at || null;
    let revokedAt = stored?.revoked_at || null;
    let updatedAt = stored?.updated_at || null;

    if (def.key === 'finance_ai_assistance' && financeAiRow) {
      granted = Number(financeAiRow.enabled) === 1;
      status = granted ? 'granted' : 'revoked';
      updatedAt = String(financeAiRow.updated_at || updatedAt || '');
      if (granted && !grantedAt) grantedAt = updatedAt;
      if (!granted && !revokedAt) revokedAt = updatedAt;
    } else if (stored) {
      granted = Number(stored.granted) === 1;
      status = String(stored.status || (granted ? 'granted' : 'revoked'));
    }

    const extra = {};
    if (def.key === 'active_shares_and_grants') {
      extra.active_temporary_shares = activeTempShares;
      extra.active_file_shares = activeFileShares;
      extra.active_upload_sessions = activeUploadSessions;
      extra.total_active_grants = activeTempShares + activeFileShares + activeUploadSessions;
      if (stored && Number(stored.granted) === 0 && extra.total_active_grants === 0) {
        status = 'revoked';
        granted = false;
      } else if (extra.total_active_grants > 0) {
        status = 'granted';
        granted = true;
      }
    }

    return {
      ...def,
      granted,
      status,
      granted_at: grantedAt,
      revoked_at: revokedAt,
      updated_at: updatedAt,
      ...extra,
    };
  });

  return {
    consents,
    device_permissions_disclosure: DEVICE_OS_PERMISSIONS_DISCLOSURE,
    essential_processing: ESSENTIAL_SERVICE_PROCESSING,
  };
}

export async function updatePrivacyConsent(context, account, payload) {
  const db = context.env.WYJ_DB;
  const storage = context.env.WYJ_STORAGE;
  await ensureTask30Schema(db);
  if (payload.user_id !== undefined && String(payload.user_id) !== String(account.id)) {
    throw new PrivacyError('privacy_owner_mismatch', '无权修改其他账户的隐私同意设置', 403);
  }
  const consentKey = cleanId(payload.consent_key, 80);
  const def = CONSENT_BY_KEY.get(consentKey);
  if (!def) {
    throw new PrivacyError('consent_key_invalid', '未识别的隐私授权项目', 400);
  }
  if (typeof payload.granted !== 'boolean') {
    throw new PrivacyError('consent_value_invalid', '授权状态必须为布尔值', 400);
  }
  const granted = payload.granted;
  if (consentKey === 'active_shares_and_grants' && granted) {
    throw new PrivacyError('share_grant_restore_unsupported', '临时分享与文件下载链接需在对应页面按需新建，无法从全局恢复旧授权', 400);
  }

  const requestId = String(context.data?.requestId || `req:${crypto.randomUUID()}`);
  const now = nowIso();
  const tables = await existingTables(db, ALL_MANAGED_TABLES);
  const effects = {};

  if (consentKey === 'finance_ai_assistance' && tables.has('finance_ai_consents')) {
    await runSql(
      db,
      `INSERT INTO finance_ai_consents (user_id, enabled, revision, updated_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled,
         revision = finance_ai_consents.revision + 1,
         updated_at = excluded.updated_at`,
      [account.id, granted ? 1 : 0, now],
    );
    if (!granted && tables.has('finance_ai_decisions')) {
      const inv = await runSql(
        db,
        `UPDATE finance_ai_decisions
         SET status = 'invalidated', result_json = '', error_code = 'finance_ai_consent_revoked', updated_at = ?2
         WHERE user_id = ?1 AND status IN ('running', 'suggestion', 'review')`,
        [account.id, now],
      );
      effects.invalidated_ai_decisions = Number(inv?.meta?.changes || 0);
    }
  }

  if (consentKey === 'cloud_notification_sync') {
    effects.cloud_sync_blocked = !granted;
    effects.android_os_permission_unchanged = true;
  }

  if (consentKey === 'learning_ai_explanation' && !granted) {
    effects.learning_ai_disabled = true;
  }

  if (consentKey === 'active_shares_and_grants' && !granted) {
    let revokedTempShares = 0;
    let revokedFileShares = 0;
    let abortedUploads = 0;
    let deletedR2 = 0;
    if (tables.has('task14_shares')) {
      const active14 = await all(
        db,
        "SELECT id, share_type, r2_object_key FROM task14_shares WHERE owner_user_id = ?1 AND state IN ('uploading', 'active')",
        [account.id],
      );
      for (const share of active14) {
        if (tables.has('task14_download_grants')) {
          await runSql(db, "UPDATE task14_download_grants SET state = 'revoked' WHERE share_id = ?1 AND state = 'active'", [
            share.id,
          ]);
        }
        if (share.r2_object_key) {
          await runSql(
            db,
            "UPDATE task14_shares SET state = 'delete_pending', deletion_reason = 'privacy_consent_revoked', updated_at = ?2 WHERE id = ?1",
            [share.id, now],
          );
          const keyValid = isCanonicalObjectKey(String(share.r2_object_key), 'temporary');
          if (keyValid && storage && typeof storage.delete === 'function') {
            try {
              await storage.delete(String(share.r2_object_key));
              deletedR2 += 1;
              await runSql(
                db,
                "UPDATE task14_shares SET state = 'deleted', deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                [share.id, now],
              );
            } catch {
              /* Keep delete_pending for retry cleanup */
            }
          }
        } else {
          await runSql(
            db,
            "UPDATE task14_shares SET state = 'deleted', deletion_reason = 'privacy_consent_revoked', deleted_at = ?2, updated_at = ?2, content_text = '' WHERE id = ?1",
            [share.id, now],
          );
          if (share.share_type === 'room' && tables.has('task14_room_messages')) {
            await runSql(db, 'DELETE FROM task14_room_messages WHERE room_id = ?1', [share.id]);
          }
        }
        revokedTempShares += 1;
      }
    }
    if (tables.has('task22_shares')) {
      const active22 = await all(
        db,
        "SELECT id FROM task22_shares WHERE owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'",
        [account.id],
      );
      for (const share of active22) {
        await runSql(
          db,
          "UPDATE task22_shares SET state = 'revoked', deletion_reason = 'privacy_consent_revoked', updated_at = ?2 WHERE id = ?1",
          [share.id, now],
        );
        if (tables.has('task22_download_grants')) {
          await runSql(
            db,
            "UPDATE task22_download_grants SET state = 'revoked' WHERE share_id = ?1 AND state = 'active'",
            [share.id],
          );
        }
        revokedFileShares += 1;
      }
    }
    if (tables.has('task22_upload_sessions')) {
      const upd = await runSql(
        db,
        "UPDATE task22_upload_sessions SET state = 'aborted', updated_at = ?2, deleted_at = ?2 WHERE owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'",
        [account.id, now],
      );
      abortedUploads = Number(upd?.meta?.changes || 0);
    }
    effects.revoked_temporary_shares = revokedTempShares;
    effects.revoked_file_shares = revokedFileShares;
    effects.aborted_upload_sessions = abortedUploads;
    effects.deleted_r2_objects = deletedR2;
  }

  await runSql(
    db,
    `INSERT INTO task30_user_consents (
      id, user_id, consent_key, granted, status, scope, version, source, granted_at, revoked_at, updated_at, request_id, details_json
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'web', ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(user_id, consent_key) DO UPDATE SET
      granted = excluded.granted,
      status = excluded.status,
      updated_at = excluded.updated_at,
      granted_at = CASE WHEN excluded.granted = 1 THEN excluded.granted_at ELSE task30_user_consents.granted_at END,
      revoked_at = CASE WHEN excluded.granted = 0 THEN excluded.revoked_at ELSE task30_user_consents.revoked_at END,
      request_id = excluded.request_id,
      details_json = excluded.details_json`,
    [
      `consent:${crypto.randomUUID()}`,
      account.id,
      consentKey,
      granted ? 1 : 0,
      granted ? 'granted' : 'revoked',
      def.scope,
      TASK30_CATALOG_VERSION,
      granted ? now : null,
      granted ? null : now,
      now,
      requestId,
      JSON.stringify(effects),
    ],
  );

  const revocationRequestId = `privreq:${crypto.randomUUID()}`;
  await runSql(
    db,
    `INSERT INTO task30_erasure_requests (
      id, user_id, request_type, scope_type, categories_json, mode, status,
      requested_by, request_id, preview_json, result_json, exception_summary_json,
      created_at, updated_at, completed_at
    ) VALUES (?1, ?2, 'consent_revocation', 'category', ?3, 'commit', 'completed', ?2, ?4, '{}', ?5, '[]', ?6, ?6, ?6)`,
    [
      revocationRequestId,
      account.id,
      JSON.stringify([def.category_key]),
      requestId,
      JSON.stringify({ consent_key: consentKey, granted, effects }),
      now,
    ],
  );

  await writePrivacyAudit(db, {
    userId: account.id,
    actorId: account.id,
    action: granted ? 'consent_granted' : 'consent_revoked',
    categoryKey: def.category_key,
    targetType: 'consent',
    targetId: consentKey,
    status: 'completed',
    summary: { granted, effects },
    requestId,
  });

  const updated = await getPrivacyConsents(context, account);
  return {
    updated_consent: updated.consents.find((item) => item.key === consentKey),
    effects,
    request_id: revocationRequestId,
    consents: updated.consents,
  };
}

export async function getPrivacyOverview(context, account) {
  const db = context.env.WYJ_DB;
  await ensureTask30Schema(db);
  const tables = await existingTables(db, ALL_MANAGED_TABLES);
  const [counts, consentsState, generations, activeRequestsRows, recentReqRows, lastCleanup] = await Promise.all([
    gatherCategorySummary(db, account.id, tables),
    getPrivacyConsents(context, account),
    getUserErasureGenerationsMap(db, account.id),
    all(
      db,
      `SELECT * FROM task30_erasure_requests
       WHERE user_id = ?1 AND status IN ('requested', 'verified', 'access_revoked', 'cleanup_pending', 'retry_pending')
       ORDER BY created_at DESC LIMIT 20`,
      [account.id],
    ),
    all(
      db,
      `SELECT * FROM task30_erasure_requests WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 12`,
      [account.id],
    ),
    first(db, 'SELECT * FROM task30_cleanup_runs ORDER BY started_at DESC LIMIT 1'),
  ]);

  const categories = PRIVACY_CATEGORY_ORDER.map((key) => {
    const def = PRIVACY_DATA_CATALOG[key];
    const catCounts = counts[key] || { total_items: 0 };
    const activeReq = activeRequestsRows
      .map(formatRequestRow)
      .find((req) => Array.isArray(req.categories) && req.categories.includes(key));
    return {
      ...def,
      cloud_counts: catCounts,
      erasure_generation: generations[key]?.generation || 0,
      last_erasure_at: generations[key]?.last_erasure_at || null,
      active_request: activeReq || null,
      can_export_via_task29: Boolean(def.present_in_user_backup),
    };
  });

  return {
    policy_version: TASK30_PRIVACY_POLICY_BASELINE,
    catalog_version: TASK30_CATALOG_VERSION,
    account: {
      id: String(account.id),
      username: String(account.username || ''),
      role: String(account.role || 'user'),
      is_admin: Boolean(account.is_admin),
    },
    categories,
    consents: consentsState.consents,
    device_permissions_disclosure: consentsState.device_permissions_disclosure,
    essential_processing: consentsState.essential_processing,
    recent_requests: recentReqRows.map(formatRequestRow),
    last_cleanup_run: lastCleanup
      ? {
          id: String(lastCleanup.id),
          status: String(lastCleanup.status),
          trigger_source: String(lastCleanup.trigger_source),
          started_at: String(lastCleanup.started_at),
          finished_at: lastCleanup.finished_at || null,
          next_scheduled_at: lastCleanup.next_scheduled_at || null,
          summary: parseJsonSafe(lastCleanup.summary_json, {}),
        }
      : null,
  };
}

function normalizeScopeAndCategories(scopeTypeRaw, categoriesRaw) {
  const scopeType = String(scopeTypeRaw || 'category').trim().toLowerCase();
  if (!ALLOWED_SCOPES.has(scopeType)) {
    throw new PrivacyError('erasure_scope_invalid', '删除范围类型无效', 400);
  }
  let categories;
  if (scopeType === 'account') {
    categories = [...PRIVACY_CATEGORY_ORDER];
  } else {
    if (!Array.isArray(categoriesRaw) || !categoriesRaw.length) {
      throw new PrivacyError('erasure_categories_required', '请至少选择一个需要删除的数据类别', 400);
    }
    categories = [...new Set(categoriesRaw.map((item) => String(item || '').trim()))];
    for (const key of categories) {
      if (!PRIVACY_DATA_CATALOG[key]) {
        throw new PrivacyError('erasure_category_invalid', `无效的数据类别: ${key}`, 400);
      }
    }
  }
  const includesAccountSecurity = scopeType === 'account' || categories.includes('account_security');
  const requiredConfirmation = includesAccountSecurity
    ? 'DELETE ACCOUNT'
    : categories.length === 1
      ? `DELETE ${categories[0].toUpperCase()}`
      : 'DELETE SELECTED DATA';
  const stepupScope = includesAccountSecurity ? 'privacy_account_delete' : 'privacy_data_delete';
  return { scopeType, categories, includesAccountSecurity, requiredConfirmation, stepupScope };
}

async function isProtectedAdminUser(db, account) {
  if (account?.is_admin || isAdminAccount(account)) return true;
  const tables = await existingTables(db, ['task18_admin_roles', 'task12_users']);
  if (tables.has('task12_users')) {
    const u = await first(db, 'SELECT role FROM task12_users WHERE id = ?1', [account.id]);
    if (String(u?.role || '') === 'super_admin') return true;
  }
  if (tables.has('task18_admin_roles')) {
    const r = await first(db, 'SELECT role FROM task18_admin_roles WHERE user_id = ?1', [account.id]);
    if (r) return true;
  }
  return false;
}

export async function previewPrivacyErasure(context, account, payload) {
  const db = context.env.WYJ_DB;
  await ensureTask30Schema(db);
  if (payload.user_id !== undefined && String(payload.user_id) !== String(account.id)) {
    throw new PrivacyError('privacy_owner_mismatch', '禁止跨账户预览或发起数据删除', 403);
  }
  const { scopeType, categories, includesAccountSecurity, requiredConfirmation, stepupScope } =
    normalizeScopeAndCategories(payload.scope_type, payload.categories);
  const tables = await existingTables(db, ALL_MANAGED_TABLES);
  const counts = await gatherCategorySummary(db, account.id, tables);
  const adminProtected = includesAccountSecurity ? await isProtectedAdminUser(db, account) : false;

  const r2Keys = [];
  const multipartUploads = [];
  if (categories.includes('temporary') && tables.has('task14_shares')) {
    const rows = await all(
      db,
      "SELECT r2_object_key FROM task14_shares WHERE owner_user_id = ?1 AND r2_object_key != '' AND state != 'deleted'",
      [account.id],
    );
    for (const row of rows) r2Keys.push(String(row.r2_object_key));
  }
  if (categories.includes('files') && tables.has('task22_shares')) {
    const sfRows = await all(
      db,
      `SELECT sf.object_key FROM task22_share_files sf
       JOIN task22_shares s ON s.id = sf.share_id
       WHERE s.owner_kind = 'user' AND s.owner_ref = ?1 AND s.state != 'deleted' AND sf.object_key != ''`,
      [account.id],
    );
    for (const row of sfRows) r2Keys.push(String(row.object_key));
  }
  if (categories.includes('files') && tables.has('task22_upload_sessions')) {
    const ufRows = await all(
      db,
      `SELECT uf.object_key, uf.upload_id FROM task22_upload_files uf
       JOIN task22_upload_sessions us ON us.id = uf.session_id
       WHERE us.owner_kind = 'user' AND us.owner_ref = ?1 AND us.state = 'active'`,
      [account.id],
    );
    for (const row of ufRows) {
      if (row.object_key && row.upload_id) multipartUploads.push({ key: row.object_key, uploadId: row.upload_id });
      else if (row.object_key) r2Keys.push(String(row.object_key));
    }
    if (tables.has('task22_upload_parts')) {
      const partRows = await all(
        db,
        `SELECT DISTINCT up.object_key FROM task22_upload_parts up
         JOIN task22_upload_sessions us ON us.id = up.session_id
         WHERE us.owner_kind = 'user' AND us.owner_ref = ?1 AND us.state = 'active'`,
        [account.id],
      );
      for (const row of partRows) if (row.object_key) r2Keys.push(String(row.object_key));
    }
  }

  const exceptions = [];
  const impactSummary = [];
  const countsByCategory = {};
  for (const key of categories) {
    const def = PRIVACY_DATA_CATALOG[key];
    countsByCategory[key] = counts[key] || { total_items: 0 };
    impactSummary.push({
      category_key: key,
      title: def.title,
      immediate_effect: def.immediate_invalidation_guarantee,
      irreversible: true,
    });
    for (const exc of def.retention_exceptions || []) {
      exceptions.push({ ...exc, category_key: key });
    }
  }
  if (adminProtected) {
    exceptions.unshift({
      category_key: 'account_security',
      code: 'admin_protected',
      label: '管理员角色保护阻断自助注销',
      basis: '数据库触发器与 Task12 管理约束',
      user_facing_reason: '当前账号持有站点所有者/管理员角色，禁止通过自助注销接口直接注销账户。',
    });
  }

  const uniqueR2Keys = [...new Set(r2Keys)];
  const backupRecommended = categories.some((key) => ['finance', 'notifications_cloud'].includes(key));
  const previewObj = {
    scope_type: scopeType,
    categories,
    required_confirmation: requiredConfirmation,
    stepup_scope: stepupScope,
    irreversible: true,
    admin_protected: adminProtected,
    backup_recommended: backupRecommended,
    backup_shortcut_url: '/account#backup',
    counts_by_category: countsByCategory,
    r2_objects_count: uniqueR2Keys.length,
    multipart_uploads_count: multipartUploads.length,
    impact_summary: impactSummary,
    retention_exceptions: exceptions,
  };

  const requestId = String(context.data?.requestId || `req:${crypto.randomUUID()}`);
  const previewRequestId = `privreq:${crypto.randomUUID()}`;
  const now = nowIso();
  await runSql(
    db,
    `INSERT INTO task30_erasure_requests (
      id, user_id, request_type, scope_type, categories_json, mode, status,
      stepup_scope, requested_by, request_id, preview_json, result_json, exception_summary_json,
      created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 'preview', 'requested', ?6, ?2, ?7, ?8, '{}', ?9, ?10, ?10)`,
    [
      previewRequestId,
      account.id,
      includesAccountSecurity ? 'account_erasure' : 'category_erasure',
      scopeType,
      JSON.stringify(categories),
      stepupScope,
      requestId,
      JSON.stringify(previewObj),
      JSON.stringify(exceptions),
      now,
    ],
  );

  await writePrivacyAudit(db, {
    userId: account.id,
    actorId: account.id,
    action: 'erasure_previewed',
    categoryKey: categories.length === 1 ? categories[0] : 'multi',
    targetType: 'erasure_request',
    targetId: previewRequestId,
    status: 'requested',
    summary: { scope_type: scopeType, categories, r2_objects_count: uniqueR2Keys.length },
    requestId,
  });

  return {
    request_id: previewRequestId,
    ...previewObj,
  };
}

export async function cancelPrivacyErasureRequest(context, account, requestIdValue) {
  const db = context.env.WYJ_DB;
  await ensureTask30Schema(db);
  const requestId = cleanId(requestIdValue, 120);
  const existing = await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [requestId]);
  if (!existing) throw new PrivacyError('erasure_request_not_found', '删除请求不存在', 404);
  if (String(existing.user_id) !== String(account.id)) {
    throw new PrivacyError('privacy_owner_mismatch', '无权访问或取消其他账户的删除请求', 403);
  }
  if (!['requested', 'verified'].includes(String(existing.status))) {
    throw new PrivacyError('erasure_cannot_cancel', '当前删除请求已进入不可逆执行阶段，无法撤销', 409);
  }
  const now = nowIso();
  await runSql(
    db,
    "UPDATE task30_erasure_requests SET status = 'cancelled', updated_at = ?2 WHERE id = ?1",
    [requestId, now],
  );
  await writePrivacyAudit(db, {
    userId: account.id,
    actorId: account.id,
    action: 'erasure_cancelled',
    targetType: 'erasure_request',
    targetId: requestId,
    status: 'cancelled',
    summary: {},
    requestId: String(context.data?.requestId || 'cancel'),
  });
  return { request: formatRequestRow(await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [requestId])) };
}

async function authorizeAnyScope(context, account, grantToken, candidateScopes) {
  let lastError = null;
  for (const scope of candidateScopes) {
    if (!scope) continue;
    try {
      const authz = await authorize(context, account, grantToken, scope);
      return { ...authz, scope };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new PrivacyError('stepup_required', '高风险删除操作需要重新完成二次身份核验', 403);
}

function buildFinanceSanitizeAndBumpStatements(db, userId, now, nextVersion, txIds, catIds, budgetIds) {
  const stmts = [];
  stmts.push(
    db.prepare(`UPDATE task16_finance_audit_logs
      SET before_json = '{"redacted":true,"reason":"task30_erasure"}',
          after_json = '{"redacted":true,"reason":"task30_erasure"}'
      WHERE user_id = ?1`).bind(userId),
    db.prepare(`UPDATE task16_finance_changes
      SET payload_json = '{"redacted":true,"deleted":true}'
      WHERE user_id = ?1`).bind(userId),
    db.prepare(`UPDATE task16_finance_sync_operations
      SET result_json = '{"redacted":true,"reason":"task30_erasure"}'
      WHERE user_id = ?1`).bind(userId),
  );
  let ver = nextVersion;
  for (const id of txIds.slice(0, 60)) {
    ver += 1;
    stmts.push(
      db.prepare(`INSERT INTO task16_finance_changes (
        user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
      ) VALUES (?1, ?2, 'transaction', ?3, 'delete', 999999, ?4, ?5)`).bind(
        userId,
        ver,
        id,
        JSON.stringify({ id, status: 'deleted', permanently_erased: true }),
        now,
      ),
    );
  }
  for (const id of catIds.slice(0, 30)) {
    ver += 1;
    stmts.push(
      db.prepare(`INSERT INTO task16_finance_changes (
        user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
      ) VALUES (?1, ?2, 'category', ?3, 'delete', 999999, ?4, ?5)`).bind(
        userId,
        ver,
        id,
        JSON.stringify({ id, status: 'deleted', permanently_erased: true }),
        now,
      ),
    );
  }
  for (const id of budgetIds.slice(0, 30)) {
    ver += 1;
    stmts.push(
      db.prepare(`INSERT INTO task16_finance_changes (
        user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
      ) VALUES (?1, ?2, 'budget', ?3, 'delete', 999999, ?4, ?5)`).bind(
        userId,
        ver,
        id,
        JSON.stringify({ id, status: 'deleted', permanently_erased: true }),
        now,
      ),
    );
  }
  stmts.push(
    db.prepare(`INSERT INTO task16_finance_user_versions (user_id, server_version, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(user_id) DO UPDATE SET server_version = MAX(task16_finance_user_versions.server_version, excluded.server_version), updated_at = excluded.updated_at`).bind(
      userId,
      ver,
      now,
    ),
  );
  return stmts;
}

async function eraseFinanceCategory(db, userId, tables, reqId, nextGen, now) {
  const tombEntries = [];
  let deletedRows = 0;

  const txs = tables.has('task16_finance_transactions')
    ? await all(db, 'SELECT id, import_source_key FROM task16_finance_transactions WHERE user_id = ?1', [userId])
    : [];
  const cats = tables.has('task16_finance_categories')
    ? await all(db, 'SELECT id FROM task16_finance_categories WHERE user_id = ?1', [userId])
    : [];
  const budgets = tables.has('task16_finance_budgets')
    ? await all(db, 'SELECT id FROM task16_finance_budgets WHERE user_id = ?1', [userId])
    : [];
  const raws = tables.has('task16_finance_raw_events')
    ? await all(db, 'SELECT id, source_type, source_event_id, source_provider, provider_reference FROM task16_finance_raw_events WHERE user_id = ?1', [userId])
    : [];

  for (const row of txs) tombEntries.push(...computeRecordTombstoneIdentities('finance', 'transaction', row));
  for (const row of cats) tombEntries.push(...computeRecordTombstoneIdentities('finance', 'category', row));
  for (const row of budgets) tombEntries.push(...computeRecordTombstoneIdentities('finance', 'budget', row));
  for (const row of raws) tombEntries.push(...computeRecordTombstoneIdentities('finance', 'raw_event', row));

  const tombStmts = recordTombstonesStatements(db, userId, 'finance', tombEntries, {
    tombstoneLevel: 'permanent_erasure',
    erasureRequestId: reqId,
    reason: 'finance_category_erasure',
    generation: nextGen,
    now,
  });

  if (tombStmts.length) {
    for (let i = 0; i < tombStmts.length; i += 40) {
      await db.batch(tombStmts.slice(i, i + 40));
    }
  }

  let currentVer = 0;
  if (tables.has('task16_finance_user_versions')) {
    const vRow = await first(db, 'SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1', [userId]);
    currentVer = Number(vRow?.server_version || 0);
  }
  if (tables.has('task16_finance_changes')) {
    const cRow = await first(db, 'SELECT COALESCE(MAX(version), 0) AS max_ver FROM task16_finance_changes WHERE user_id = ?1', [userId]);
    currentVer = Math.max(currentVer, Number(cRow?.max_ver || 0));
  }
  if (tables.has('task16_finance_changes') && tables.has('task16_finance_user_versions')) {
    const changeStmts = buildFinanceSanitizeAndBumpStatements(
      db,
      userId,
      now,
      currentVer + 1,
      txs.map((x) => String(x.id)),
      cats.map((x) => String(x.id)),
      budgets.map((x) => String(x.id)),
    );
    await db.batch(changeStmts);
  }

  /* FK-safe deletion order */
  if (tables.has('task21_payment_reference_aliases')) {
    await runSql(db, 'DELETE FROM task21_payment_reference_aliases WHERE user_id = ?1', [userId]);
  }
  if (tables.has('task16_finance_transaction_events')) {
    await runSql(
      db,
      `DELETE FROM task16_finance_transaction_events
       WHERE transaction_id IN (SELECT id FROM task16_finance_transactions WHERE user_id = ?1)
          OR raw_event_id IN (SELECT id FROM task16_finance_raw_events WHERE user_id = ?1)`,
      [userId],
    );
  }
  for (const tbl of [
    'task16_fx_references',
    'task16_currency_preferences',
    'task16_currency_role_evidence',
    'finance_ai_observations',
    'finance_ai_decisions',
    'task16_finance_transactions',
    'task16_finance_budgets',
    'task16_finance_categories',
    'task16_finance_raw_events',
    'task16_finance_devices',
  ]) {
    if (tables.has(tbl)) {
      const res = await runSql(db, `DELETE FROM ${tbl} WHERE user_id = ?1`, [userId]);
      deletedRows += Number(res?.meta?.changes || 0);
    }
  }

  if (tables.has('task21_notification_events')) {
    await runSql(db, "UPDATE task21_notification_events SET finance_transaction_id = '' WHERE user_id = ?1 AND finance_transaction_id != ''", [userId]);
  }
  if (tables.has('task21_notification_candidates')) {
    await runSql(db, "UPDATE task21_notification_candidates SET finance_transaction_id = '' WHERE user_id = ?1 AND finance_transaction_id != ''", [userId]);
  }
  if (tables.has('task21_notification_pending_hints')) {
    await runSql(db, "UPDATE task21_notification_pending_hints SET finance_entry_id = '' WHERE user_id = ?1 AND finance_entry_id != ''", [userId]);
  }

  return {
    deleted_transactions: txs.length,
    deleted_categories: cats.length,
    deleted_budgets: budgets.length,
    deleted_raw_events: raws.length,
    deleted_rows: deletedRows,
    tombstones_created: tombEntries.length,
    retention_exceptions: ['payment_order_settlement', 'sync_tombstone_minimization'],
  };
}

async function eraseNotificationsCloudCategory(db, userId, tables, reqId, nextGen, now) {
  const tombEntries = [];
  const events = tables.has('task21_notification_events')
    ? await all(db, 'SELECT event_id, source_type, source_package, payment_channel, provider_reference, lifecycle_identity FROM task21_notification_events WHERE user_id = ?1', [userId])
    : [];
  const cands = tables.has('task21_notification_candidates')
    ? await all(db, 'SELECT id, event_id FROM task21_notification_candidates WHERE user_id = ?1', [userId])
    : [];
  const hints = tables.has('task21_notification_pending_hints')
    ? await all(db, 'SELECT id, source_event_id, source_type, source_package, payment_channel, provider_reference, lifecycle_identity FROM task21_notification_pending_hints WHERE user_id = ?1', [userId])
    : [];

  for (const row of events) tombEntries.push(...computeRecordTombstoneIdentities('notifications_cloud', 'notification_event', row));
  for (const row of cands) tombEntries.push(...computeRecordTombstoneIdentities('notifications_cloud', 'notification_candidate', row));
  for (const row of hints) tombEntries.push(...computeRecordTombstoneIdentities('notifications_cloud', 'notification_hint', row));

  const tombStmts = recordTombstonesStatements(db, userId, 'notifications_cloud', tombEntries, {
    tombstoneLevel: 'permanent_erasure',
    erasureRequestId: reqId,
    reason: 'notifications_cloud_erasure',
    generation: nextGen,
    now,
  });
  for (let i = 0; i < tombStmts.length; i += 40) {
    await db.batch(tombStmts.slice(i, i + 40));
  }

  let deletedRows = 0;
  for (const tbl of [
    'task21_notification_review_aliases',
    'task21_payment_reference_aliases',
    'task21_notification_evidence',
    'task21_payment_reconciliations',
    'task21_payment_effective_events',
    'task21_payment_reconciliation_guards',
    'task21_payment_user_decisions',
    'task21_payment_control_closures',
    'task21_payment_lifecycle_guards',
    'task21_currency_units',
    'task21_notification_pending_hints',
    'task21_notification_candidates',
    'task21_notification_events',
    'task21_notification_sync_operations',
  ]) {
    if (tables.has(tbl)) {
      const res = await runSql(db, `DELETE FROM ${tbl} WHERE user_id = ?1`, [userId]);
      deletedRows += Number(res?.meta?.changes || 0);
    }
  }

  return {
    deleted_events: events.length,
    deleted_candidates: cands.length,
    deleted_hints: hints.length,
    deleted_rows: deletedRows,
    tombstones_created: tombEntries.length,
    retention_exceptions: ['android_local_room_boundary'],
  };
}

async function revokeAndQueueTemporaryCategory(db, userId, tables, reqId, now) {
  let shareCount = 0;
  let msgCount = 0;
  const r2Tasks = [];

  if (tables.has('task14_shares')) {
    const shares = await all(
      db,
      "SELECT id, share_type, r2_object_key, state FROM task14_shares WHERE owner_user_id = ?1 AND state != 'deleted'",
      [userId],
    );
    for (const share of shares) {
      shareCount += 1;
      if (tables.has('task14_download_grants')) {
        await runSql(db, "UPDATE task14_download_grants SET state = 'revoked' WHERE share_id = ?1 AND state = 'active'", [
          share.id,
        ]);
      }
      if (share.r2_object_key) {
        await runSql(
          db,
          "UPDATE task14_shares SET state = 'delete_pending', deletion_reason = 'privacy_erasure', updated_at = ?2 WHERE id = ?1",
          [share.id, now],
        );
        const taskId = `prtask:${crypto.randomUUID()}`;
        r2Tasks.push({
          id: taskId,
          categoryKey: 'temporary',
          targetType: 'r2_object',
          targetRef: String(share.id),
          r2Key: String(share.r2_object_key),
          uploadId: null,
        });
        await runSql(
          db,
          `INSERT INTO task30_erasure_tasks (
            id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, upload_id, status, details_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, 'temporary', 'r2_object', ?4, ?5, NULL, 'access_revoked', ?6, ?7, ?7)`,
          [taskId, reqId, userId, share.id, share.r2_object_key, JSON.stringify({ table: 'task14_shares' }), now],
        );
      } else {
        await runSql(
          db,
          "UPDATE task14_shares SET state = 'deleted', deletion_reason = 'privacy_erasure', content_text = '', deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
          [share.id, now],
        );
      }
    }
    if (tables.has('task14_room_messages')) {
      const mRes = await runSql(
        db,
        'DELETE FROM task14_room_messages WHERE room_id IN (SELECT id FROM task14_shares WHERE owner_user_id = ?1)',
        [userId],
      );
      msgCount = Number(mRes?.meta?.changes || 0);
    }
  }
  return { shares_revoked: shareCount, room_messages_deleted: msgCount, queued_r2_tasks: r2Tasks.length };
}

async function revokeAndQueueFilesCategory(db, userId, tables, reqId, now) {
  let shareCount = 0;
  let sessionCount = 0;
  let queuedTasks = 0;

  if (tables.has('task22_shares')) {
    const shares = await all(
      db,
      "SELECT id FROM task22_shares WHERE owner_kind = 'user' AND owner_ref = ?1 AND state != 'deleted'",
      [userId],
    );
    for (const share of shares) {
      shareCount += 1;
      await runSql(
        db,
        "UPDATE task22_shares SET state = 'delete_pending', deletion_reason = 'privacy_erasure', updated_at = ?2 WHERE id = ?1",
        [share.id, now],
      );
      if (tables.has('task22_download_grants')) {
        await runSql(
          db,
          "UPDATE task22_download_grants SET state = 'revoked' WHERE share_id = ?1 AND state = 'active'",
          [share.id],
        );
      }
      if (tables.has('task22_share_files')) {
        const sFiles = await all(
          db,
          "SELECT file_id, object_key FROM task22_share_files WHERE share_id = ?1 AND object_key != ''",
          [share.id],
        );
        for (const sf of sFiles) {
          const taskId = `prtask:${crypto.randomUUID()}`;
          queuedTasks += 1;
          await runSql(
            db,
            `INSERT INTO task30_erasure_tasks (
              id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, upload_id, status, details_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, 'files', 'r2_object', ?4, ?5, NULL, 'access_revoked', ?6, ?7, ?7)`,
            [taskId, reqId, userId, share.id, sf.object_key, JSON.stringify({ table: 'task22_shares', file_id: sf.file_id }), now],
          );
        }
      }
    }
  }

  if (tables.has('task22_upload_sessions')) {
    const sessions = await all(
      db,
      "SELECT id FROM task22_upload_sessions WHERE owner_kind = 'user' AND owner_ref = ?1 AND state = 'active'",
      [userId],
    );
    for (const sess of sessions) {
      sessionCount += 1;
      await runSql(
        db,
        "UPDATE task22_upload_sessions SET state = 'aborted', deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        [sess.id, now],
      );
      if (tables.has('task22_upload_files')) {
        const uFiles = await all(
          db,
          "SELECT id, object_key, upload_id FROM task22_upload_files WHERE session_id = ?1 AND object_key != ''",
          [sess.id],
        );
        for (const uf of uFiles) {
          const targetType = uf.upload_id ? 'r2_multipart' : 'r2_object';
          const taskId = `prtask:${crypto.randomUUID()}`;
          queuedTasks += 1;
          await runSql(
            db,
            `INSERT INTO task30_erasure_tasks (
              id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, upload_id, status, details_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, 'files', ?4, ?5, ?6, ?7, 'access_revoked', ?8, ?9, ?9)`,
            [
              taskId,
              reqId,
              userId,
              targetType,
              sess.id,
              uf.object_key,
              uf.upload_id || null,
              JSON.stringify({ table: 'task22_upload_sessions', file_id: uf.id }),
              now,
            ],
          );
        }
      }
      if (tables.has('task22_upload_parts')) {
        const partKeys = await all(
          db,
          "SELECT DISTINCT object_key FROM task22_upload_parts WHERE session_id = ?1 AND object_key != ''",
          [sess.id],
        );
        for (const pk of partKeys) {
          const taskId = `prtask:${crypto.randomUUID()}`;
          queuedTasks += 1;
          await runSql(
            db,
            `INSERT INTO task30_erasure_tasks (
              id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, upload_id, status, details_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, 'files', 'r2_object', ?4, ?5, NULL, 'access_revoked', ?6, ?7, ?7)`,
            [taskId, reqId, userId, sess.id, pk.object_key, JSON.stringify({ table: 'task22_upload_parts' }), now],
          );
        }
      }
    }
  }

  return {
    shares_revoked: shareCount,
    upload_sessions_aborted: sessionCount,
    queued_r2_tasks: queuedTasks,
  };
}

async function eraseBackupsCategory(db, userId, tables) {
  let deleted = 0;
  for (const tbl of ['task29_restore_idempotency', 'task29_restore_jobs', 'task29_backup_exports', 'task29_backup_audit']) {
    if (tables.has(tbl)) {
      const res = await runSql(db, `DELETE FROM ${tbl} WHERE user_id = ?1`, [userId]);
      deleted += Number(res?.meta?.changes || 0);
    }
  }
  return { deleted_rows: deleted, retention_exceptions: ['user_held_offline_backup_boundary'] };
}

async function eraseLearningCategory(db, userId, tables) {
  let deleted = 0;
  /* Delete task26_learning_events BEFORE task26_question_tickets (FK without ON DELETE CASCADE) and NEVER UPDATE immutable events */
  for (const tbl of [
    'task26_learning_events',
    'task26_wrong_review_events',
    'task26_mastery_states',
    'task26_wrong_review_states',
    'task26_question_tickets',
    'task15_quiz_sessions',
    'task15_tool_favorites',
    'task15_tool_recent_usage',
    'task15_saved_tool_configs',
    'task11_learning_sync_records',
    'task11_learning_sync_heads',
    'task11_learning_sync_changes',
  ]) {
    if (tables.has(tbl)) {
      const res = await runSql(db, `DELETE FROM ${tbl} WHERE user_id = ?1`, [userId]);
      deleted += Number(res?.meta?.changes || 0);
    }
  }
  return { deleted_rows: deleted };
}

async function eraseSupportCategory(db, userId, tables) {
  let deleted = 0;
  for (const tbl of ['task11_feedback_votes', 'task11_feedback_items']) {
    if (tables.has(tbl)) {
      const res = await runSql(db, `DELETE FROM ${tbl} WHERE user_id = ?1`, [userId]);
      deleted += Number(res?.meta?.changes || 0);
    }
  }
  const [inboundThreads, inboundMessages, emailDeliveries, paymentOrders] = await Promise.all([
    countWhere(db, tables, 'email_center_inbound_threads', 'matched_user_id = ?1', [userId]),
    countWhere(db, tables, 'email_center_inbound_messages', 'matched_user_id = ?1', [userId]),
    countWhere(db, tables, 'email_center_deliveries', 'target_user_id = ?1', [userId]),
    countWhere(db, tables, 'task13_payment_orders', 'user_id = ?1', [userId]),
  ]);
  const retainedTotal = inboundThreads + inboundMessages + emailDeliveries + paymentOrders;
  const status = retainedTotal > 0 ? (deleted > 0 ? 'partially_completed' : 'blocked_by_retention') : 'completed';
  return {
    status,
    deleted_feedback_rows: deleted,
    retained_counts: {
      inbound_threads_retained: inboundThreads,
      inbound_messages_retained: inboundMessages,
      email_deliveries_retained: emailDeliveries,
      payment_orders_retained: paymentOrders,
    },
    retention_exceptions: retainedTotal > 0 ? ['support_thread_retention_180d', 'payment_order_audit_retention'] : [],
  };
}

function isCredibleR2NotFound(error, isMultipart = false) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 404) return true;
  const codeOrMsg = `${String(error?.code || '')} ${String(error?.message || '')}`;
  if (isMultipart) {
    return /NoSuchUpload|upload.*not\s*found|upload.*does\s*not\s*exist/i.test(codeOrMsg);
  }
  return /NoSuchKey|object.*not\s*found|key.*not\s*found|no\s*such\s*key/i.test(codeOrMsg);
}

async function verifyTaskOwnershipAndObjectSafety(db, task, parentRequest, tables) {
  if (!parentRequest || String(task.user_id) !== String(parentRequest.user_id)) {
    return { ok: false, permanent: true, error: 'task_owner_mismatch' };
  }
  const key = String(task.r2_key || '');
  const family = task.category_key === 'temporary' ? 'temporary' : 'transfer';
  if (!key || !isCanonicalObjectKey(key, family)) {
    return { ok: false, permanent: true, error: 'invalid_object_key_namespace' };
  }
  const details = parseJsonSafe(task.details_json, {});
  const targetRef = String(task.target_ref || '');
  const userId = String(task.user_id);

  let ownedMatch = null;
  if (details.table === 'task14_shares' && tables.has('task14_shares')) {
    ownedMatch = await first(
      db,
      'SELECT id FROM task14_shares WHERE id = ?1 AND owner_user_id = ?2 AND r2_object_key = ?3',
      [targetRef, userId, key],
    );
  } else if (details.table === 'task22_shares' && tables.has('task22_shares') && tables.has('task22_share_files')) {
    ownedMatch = await first(
      db,
      `SELECT s.id FROM task22_shares s
       JOIN task22_share_files f ON f.share_id = s.id
       WHERE s.id = ?1 AND s.owner_kind = 'user' AND s.owner_ref = ?2 AND f.object_key = ?3
       LIMIT 1`,
      [targetRef, userId, key],
    );
  } else if (details.table === 'task22_upload_sessions' && tables.has('task22_upload_sessions') && tables.has('task22_upload_files')) {
    ownedMatch = await first(
      db,
      `SELECT s.id FROM task22_upload_sessions s
       JOIN task22_upload_files f ON f.session_id = s.id
       WHERE s.id = ?1 AND s.owner_kind = 'user' AND s.owner_ref = ?2 AND f.object_key = ?3
       LIMIT 1`,
      [targetRef, userId, key],
    );
  } else if (details.table === 'task22_upload_parts' && tables.has('task22_upload_sessions') && tables.has('task22_upload_parts')) {
    ownedMatch = await first(
      db,
      `SELECT s.id FROM task22_upload_sessions s
       JOIN task22_upload_parts p ON p.session_id = s.id
       WHERE s.id = ?1 AND s.owner_kind = 'user' AND s.owner_ref = ?2 AND p.object_key = ?3
       LIMIT 1`,
      [targetRef, userId, key],
    );
  }
  if (!ownedMatch) {
    return { ok: false, permanent: true, error: 'target_reference_mismatch' };
  }

  /* Verify object is not actively referenced by any other live business record or winning upload */
  if (tables.has('task14_shares')) {
    const active14 = await first(
      db,
      "SELECT id FROM task14_shares WHERE r2_object_key = ?1 AND state IN ('uploading', 'active') AND id != ?2 LIMIT 1",
      [key, details.table === 'task14_shares' ? targetRef : ''],
    );
    if (active14) return { ok: false, permanent: true, error: 'object_key_referenced_elsewhere' };
  }
  if (tables.has('task22_share_files') && tables.has('task22_shares')) {
    const active22 = await first(
      db,
      `SELECT sf.share_id FROM task22_share_files sf
       JOIN task22_shares s ON s.id = sf.share_id
       WHERE sf.object_key = ?1 AND s.state = 'active' LIMIT 1`,
      [key],
    );
    if (active22) return { ok: false, permanent: true, error: 'object_key_referenced_elsewhere' };
  }
  if (tables.has('task22_upload_files') && tables.has('task22_upload_sessions')) {
    const activeUpload = await first(
      db,
      `SELECT uf.session_id, uf.upload_id FROM task22_upload_files uf
       JOIN task22_upload_sessions us ON us.id = uf.session_id
       WHERE uf.object_key = ?1
         AND (
           us.state = 'active'
           OR (?2 != '' AND uf.upload_id != '' AND uf.upload_id != ?2)
         )
       LIMIT 1`,
      [key, String(task.upload_id || '')],
    );
    if (activeUpload) return { ok: false, permanent: true, error: 'object_key_referenced_elsewhere' };
  }

  return { ok: true, key, details };
}

export async function executeErasureR2Tasks(db, storage, requestId, options = {}) {
  const isProd = String(options.environment || 'development') === 'production';
  const simulateFailure = Boolean(options.simulateR2Failure) && !isProd;
  const simulateD1CommitFailure = Boolean(options.simulateD1CommitFailure) && !isProd;
  const parentRequest = await first(db, 'SELECT id, user_id, scope_type, status FROM task30_erasure_requests WHERE id = ?1', [
    requestId,
  ]);
  const tables = await existingTables(db, [
    'task14_shares',
    'task22_shares',
    'task22_share_files',
    'task22_upload_files',
    'task22_upload_parts',
    'task22_upload_sessions',
  ]);
  const staleCleaningCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const tasks = await all(
    db,
    `SELECT * FROM task30_erasure_tasks
     WHERE request_id_ref = ?1
       AND (status IN ('pending', 'access_revoked', 'retry_pending') OR (status = 'cleaning' AND updated_at <= ?2))
     ORDER BY created_at ASC`,
    [requestId, staleCleaningCutoff],
  );
  const now = nowIso();
  const affectedShareIds14 = new Set();
  const affectedShareIds22 = new Set();
  const affectedSessionIds22 = new Set();
  let inFlightSkipped = 0;

  for (const task of tasks) {
    /* Atomic concurrency claim so two workers never process the same physical deletion simultaneously */
    const claim = await runSql(
      db,
      `UPDATE task30_erasure_tasks
       SET status = 'cleaning', attempt_count = attempt_count + 1, updated_at = ?2
       WHERE id = ?1
         AND (status IN ('pending', 'access_revoked', 'retry_pending') OR (status = 'cleaning' AND updated_at <= ?3))`,
      [task.id, now, staleCleaningCutoff],
    );
    if (Number(claim?.meta?.changes || 0) !== 1) {
      inFlightSkipped += 1;
      continue;
    }

    const details = parseJsonSafe(task.details_json, {});
    if (details.table === 'task14_shares' && task.target_ref) affectedShareIds14.add(String(task.target_ref));
    if (details.table === 'task22_shares' && task.target_ref) affectedShareIds22.add(String(task.target_ref));
    if (
      (details.table === 'task22_upload_sessions' || details.table === 'task22_upload_parts') &&
      task.target_ref
    ) {
      affectedSessionIds22.add(String(task.target_ref));
    }

    let r2Confirmed = false;
    try {
      const safety = await verifyTaskOwnershipAndObjectSafety(db, task, parentRequest, tables);
      if (!safety.ok) {
        const permErr = new Error(safety.error);
        permErr.permanent = Boolean(safety.permanent);
        throw permErr;
      }
      if (simulateFailure) {
        throw new Error('simulated_r2_delete_failure');
      }
      if (!storage || typeof storage !== 'object') {
        throw new Error('r2_binding_missing');
      }

      if (task.target_type === 'r2_multipart') {
        if (!task.upload_id) {
          const permErr = new Error('r2_multipart_upload_id_missing');
          permErr.permanent = true;
          throw permErr;
        }
        if (typeof storage.resumeMultipartUpload !== 'function') {
          throw new Error('r2_multipart_method_unavailable');
        }
        try {
          const mpu = storage.resumeMultipartUpload(safety.key, String(task.upload_id));
          if (!mpu || typeof mpu.abort !== 'function') {
            throw new Error('r2_multipart_abort_unavailable');
          }
          await mpu.abort();
          r2Confirmed = true;
        } catch (err) {
          if (isCredibleR2NotFound(err, true)) {
            r2Confirmed = true;
          } else {
            throw err;
          }
        }
      } else {
        if (typeof storage.delete !== 'function') {
          throw new Error('r2_delete_method_unavailable');
        }
        try {
          await storage.delete(safety.key);
          r2Confirmed = true;
        } catch (err) {
          if (isCredibleR2NotFound(err, false)) {
            r2Confirmed = true;
          } else {
            throw err;
          }
        }
      }

      if (!r2Confirmed) {
        throw new Error('r2_deletion_unconfirmed');
      }
      if (simulateD1CommitFailure) {
        throw new Error('d1_commit_failed_after_r2');
      }

      const upd = await runSql(
        db,
        "UPDATE task30_erasure_tasks SET status = 'completed', last_error = NULL, completed_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'cleaning'",
        [task.id, nowIso()],
      );
      if (Number(upd?.meta?.changes || 0) !== 1) {
        throw new Error('d1_task_finalize_conflict');
      }
    } catch (error) {
      const nextStatus = error?.permanent ? 'failed' : 'retry_pending';
      const errCode = String(error?.message || 'r2_delete_failed').slice(0, 200);
      await runSql(
        db,
        "UPDATE task30_erasure_tasks SET status = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1",
        [task.id, nextStatus, errCode, nowIso()],
      );
    }
  }

  /* Finalize parent share rows ONLY after ALL queued tasks for that share are confirmed completed in D1 */
  if (tables.has('task14_shares')) {
    for (const shareId of affectedShareIds14) {
      const remaining = await first(
        db,
        "SELECT COUNT(*) AS cnt FROM task30_erasure_tasks WHERE target_ref = ?1 AND status != 'completed'",
        [shareId],
      );
      if (Number(remaining?.cnt || 0) === 0) {
        await runSql(
          db,
          "UPDATE task14_shares SET state = 'deleted', content_text = '', deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
          [shareId, nowIso()],
        );
      }
    }
  }
  if (tables.has('task22_shares')) {
    for (const shareId of affectedShareIds22) {
      const remaining = await first(
        db,
        "SELECT COUNT(*) AS cnt FROM task30_erasure_tasks WHERE target_ref = ?1 AND status != 'completed'",
        [shareId],
      );
      if (Number(remaining?.cnt || 0) === 0) {
        await runSql(
          db,
          "UPDATE task22_shares SET state = 'deleted', deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
          [shareId, nowIso()],
        );
        if (tables.has('task22_share_files')) {
          await runSql(db, 'DELETE FROM task22_share_files WHERE share_id = ?1', [shareId]);
        }
      }
    }
  }
  for (const sessionId of affectedSessionIds22) {
    const remaining = await first(
      db,
      "SELECT COUNT(*) AS cnt FROM task30_erasure_tasks WHERE target_ref = ?1 AND status != 'completed'",
      [sessionId],
    );
    if (Number(remaining?.cnt || 0) === 0) {
      if (tables.has('task22_upload_parts')) await runSql(db, 'DELETE FROM task22_upload_parts WHERE session_id = ?1', [sessionId]);
      if (tables.has('task22_upload_files')) await runSql(db, 'DELETE FROM task22_upload_files WHERE session_id = ?1', [sessionId]);
    }
  }

  /* Always recompute authoritative counts from D1 rows for this request */
  const statusRows = await all(
    db,
    'SELECT status, COUNT(*) AS cnt FROM task30_erasure_tasks WHERE request_id_ref = ?1 GROUP BY status',
    [requestId],
  );
  let totalTasks = 0;
  let completedCount = 0;
  let retryPendingCount = 0;
  let failedCount = 0;
  let cleaningCount = 0;
  for (const row of statusRows) {
    const n = Number(row.cnt || 0);
    totalTasks += n;
    if (row.status === 'completed' || row.status === 'skipped') completedCount += n;
    else if (row.status === 'failed') failedCount += n;
    else if (row.status === 'cleaning') cleaningCount += n;
    else retryPendingCount += n;
  }

  return {
    total_tasks: totalTasks,
    completed_count: completedCount,
    retry_pending_count: retryPendingCount,
    failed_count: failedCount,
    cleaning_count: cleaningCount,
    in_flight_skipped: inFlightSkipped,
    physically_erased_confirmed: totalTasks === completedCount && retryPendingCount === 0 && failedCount === 0 && cleaningCount === 0,
  };
}

export async function executeAccountClosureSteps(db, userId, now, tables, options = {}) {
  /* Called from both commitPrivacyErasure(account) and deleteOwnAccount wrapper */
  if (!options.skipUserSessions) {
    if (tables.has('task12_users')) {
      await runSql(
        db,
        `UPDATE task12_users
         SET password_hash = '', password_scheme = 'invalid', password_iterations = 0,
             deleted = 1, session_version = session_version + 1,
             updated_at = ?2, source_updated_at = ?2
         WHERE id = ?1`,
        [userId, now],
      );
    }
    if (tables.has('task12_sessions')) {
      await runSql(db, 'UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0', [
        userId,
        now,
      ]);
    }
  }
  if (tables.has('task20_device_sessions')) {
    if (tables.has('task20_used_refresh_tokens')) {
      await runSql(
        db,
        'DELETE FROM task20_used_refresh_tokens WHERE session_id IN (SELECT id FROM task20_device_sessions WHERE user_id = ?1)',
        [userId],
      );
    }
    await runSql(
      db,
      "UPDATE task20_device_sessions SET revoked = 1, revoked_at = ?2, revoke_reason = 'account_erased' WHERE user_id = ?1 AND revoked = 0",
      [userId, now],
    );
  }
  if (tables.has('task27_security')) {
    await runSql(
      db,
      `UPDATE task27_security
       SET verified_email = '', email_verified_at = '', mfa_method = 'none',
           totp_ciphertext = '', totp_last_step = -1, version = version + 1, must_change_password = 0
       WHERE user_id = ?1`,
      [userId],
    );
  }
  if (tables.has('task27_recovery_codes')) {
    await runSql(db, 'DELETE FROM task27_recovery_codes WHERE user_id = ?1', [userId]);
  }
  if (tables.has('task27_challenges')) {
    await runSql(db, 'DELETE FROM task27_challenges WHERE user_id = ?1', [userId]);
  }
  if (tables.has('email_center_bindings')) {
    await runSql(db, 'DELETE FROM email_center_bindings WHERE user_id = ?1', [userId]);
  }
  if (tables.has('task13_user_memberships')) {
    await runSql(
      db,
      "UPDATE task13_user_memberships SET status = 'cancelled', updated_at = ?2 WHERE user_id = ?1 AND status = 'active'",
      [userId, now],
    );
  }
  if (tables.has('task13_user_entitlement_overrides')) {
    await runSql(db, 'DELETE FROM task13_user_entitlement_overrides WHERE user_id = ?1', [userId]);
  }
  if (tables.has('task13_payment_orders')) {
    await runSql(
      db,
      "UPDATE task13_payment_orders SET status = 'cancelled', updated_at = ?2 WHERE user_id = ?1 AND status IN ('pending_payment', 'user_paid', 'processing')",
      [userId, now],
    );
  }
  if (tables.has('task25_user_flag_overrides')) {
    await runSql(db, 'DELETE FROM task25_user_flag_overrides WHERE user_id = ?1', [userId]);
  }
  if (tables.has('task25_release_preferences')) {
    await runSql(db, 'DELETE FROM task25_release_preferences WHERE user_id = ?1', [userId]);
  }
  if (tables.has('task30_user_consents')) {
    await runSql(
      db,
      "UPDATE task30_user_consents SET granted = 0, status = 'revoked', revoked_at = ?2, updated_at = ?2 WHERE user_id = ?1",
      [userId, now],
    );
  }
  if (tables.has('finance_ai_consents')) {
    await runSql(
      db,
      'UPDATE finance_ai_consents SET enabled = 0, revision = revision + 1, updated_at = ?2 WHERE user_id = ?1',
      [userId, now],
    );
  }
}

export function prepareAccountErasureStatement(db, userId, now, reqId, options = {}) {
  const reqHttpId = String(options.httpRequestId || `acc:${crypto.randomUUID()}`);
  const stepupScope = String(options.stepupScope || 'account_delete');
  return db.prepare(
    `INSERT OR IGNORE INTO task30_erasure_requests (
      id, user_id, request_type, scope_type, categories_json, mode, status,
      confirmation_text, stepup_scope, stepup_verified, access_revoked_at,
      requested_by, request_id, preview_json, result_json, exception_summary_json,
      attempt_count, created_at, updated_at
    ) VALUES (?1, ?2, 'account_erasure', 'account', ?3, 'commit', 'access_revoked', 'DELETE ACCOUNT', ?4, 1, ?5, ?2, ?6, '{}', '{}', '[]', 1, ?5, ?5)`,
  ).bind(reqId, userId, JSON.stringify(PRIVACY_CATEGORY_ORDER), stepupScope, now, reqHttpId);
}

export async function executeAccountErasure(db, storage, account, options = {}) {
  const ready = await hasTask30(db);
  const now = nowIso();
  const tables = await existingTables(db, ALL_MANAGED_TABLES);

  await executeAccountClosureSteps(db, account.id, now, tables, options);
  if (!ready) return { task30_enabled: false };

  const reqId = options.existingRequestId || options.requestRecordId || `privreq:${crypto.randomUUID()}`;
  const reqHttpId = String(options.httpRequestId || `acc:${crypto.randomUUID()}`);
  const environment = String(options.environment || 'development');

  await runSql(
    db,
    `INSERT OR IGNORE INTO task30_erasure_requests (
      id, user_id, request_type, scope_type, categories_json, mode, status,
      confirmation_text, stepup_scope, stepup_verified, access_revoked_at,
      requested_by, request_id, preview_json, result_json, exception_summary_json,
      attempt_count, created_at, updated_at
    ) VALUES (?1, ?2, 'account_erasure', 'account', ?3, 'commit', 'access_revoked', 'DELETE ACCOUNT', 'account_delete', 1, ?4, ?2, ?5, '{}', '{}', '[]', 1, ?4, ?4)`,
    [reqId, account.id, JSON.stringify(PRIVACY_CATEGORY_ORDER), now, reqHttpId],
  );

  try {
    if (options.simulateAccountClosureInterruption && environment !== 'production') {
      throw new Error('simulated_account_closure_interruption');
    }
    const summary = await runCategoryErasureBatch(db, storage, account.id, PRIVACY_CATEGORY_ORDER, tables, reqId, now, {
      environment,
      skipAccountClosureSteps: true,
      simulateR2Failure: Boolean(options.simulateR2Failure),
      simulateD1CommitFailure: Boolean(options.simulateD1CommitFailure),
    });

    await runSql(
      db,
      `UPDATE task30_erasure_requests
       SET status = ?2, result_json = ?3, exception_summary_json = ?4, updated_at = ?5,
           error_code = CASE WHEN ?2 = 'retry_pending' THEN 'r2_cleanup_pending_retry' WHEN ?2 = 'failed' THEN 'erasure_task_failed' ELSE NULL END,
           error_message = CASE WHEN ?2 = 'retry_pending' THEN '账户已立即锁定并撤销全部访问，部分清理待异步重试' ELSE NULL END,
           completed_at = CASE WHEN ?2 IN ('completed', 'partially_completed', 'blocked_by_retention') THEN ?5 ELSE NULL END,
           next_retry_at = CASE WHEN ?2 = 'retry_pending' THEN ?6 ELSE NULL END
       WHERE id = ?1`,
      [
        reqId,
        summary.final_status,
        JSON.stringify(summary.category_results),
        JSON.stringify(summary.retention_exceptions),
        nowIso(),
        futureIso(60_000),
      ],
    );

    await writePrivacyAudit(db, {
      userId: account.id,
      actorId: account.id,
      action: 'account_erasure_executed',
      categoryKey: 'account_security',
      targetType: 'erasure_request',
      targetId: reqId,
      status: summary.final_status,
      summary: { final_status: summary.final_status, r2: summary.r2_summary },
      requestId: reqHttpId,
    });

    return { task30_enabled: true, request_id: reqId, ...summary };
  } catch (error) {
    /* Durable recovery record guarantees account closure cleanup resumes via Retention Worker even if caller crashed */
    await runSql(
      db,
      `UPDATE task30_erasure_requests
       SET status = 'retry_pending', error_code = 'account_erasure_interrupted',
           error_message = ?2, next_retry_at = ?3, updated_at = ?4
       WHERE id = ?1`,
      [reqId, String(error?.message || 'account_erasure_interrupted').slice(0, 200), nowIso(), nowIso()],
    ).catch(() => {});
    throw error;
  }
}

async function runCategoryErasureBatch(db, storage, userId, categories, tables, reqId, now, options = {}) {
  const categoryResults = {};
  const retentionExceptionSet = new Map();

  const bumpGeneration = async (catKey) => {
    await runSql(
      db,
      `INSERT INTO task30_erasure_generations (user_id, category_key, generation, last_erasure_request_id, last_erasure_at)
       VALUES (?1, ?2, 1, ?3, ?4)
       ON CONFLICT(user_id, category_key) DO UPDATE SET
         generation = task30_erasure_generations.generation + 1,
         last_erasure_request_id = excluded.last_erasure_request_id,
         last_erasure_at = excluded.last_erasure_at`,
      [userId, catKey, reqId, now],
    );
    const row = await first(
      db,
      'SELECT generation FROM task30_erasure_generations WHERE user_id = ?1 AND category_key = ?2',
      [userId, catKey],
    );
    return Number(row?.generation || 1);
  };

  if (categories.includes('temporary')) {
    categoryResults.temporary = await revokeAndQueueTemporaryCategory(db, userId, tables, reqId, now);
    await bumpGeneration('temporary');
  }
  if (categories.includes('files')) {
    categoryResults.files = await revokeAndQueueFilesCategory(db, userId, tables, reqId, now);
    await bumpGeneration('files');
  }
  if (categories.includes('finance')) {
    const gen = await bumpGeneration('finance');
    categoryResults.finance = await eraseFinanceCategory(db, userId, tables, reqId, gen, now);
  }
  if (categories.includes('notifications_cloud')) {
    const gen = await bumpGeneration('notifications_cloud');
    categoryResults.notifications_cloud = await eraseNotificationsCloudCategory(db, userId, tables, reqId, gen, now);
  }
  if (categories.includes('backups')) {
    await bumpGeneration('backups');
    categoryResults.backups = await eraseBackupsCategory(db, userId, tables);
  }
  if (categories.includes('learning')) {
    await bumpGeneration('learning');
    categoryResults.learning = await eraseLearningCategory(db, userId, tables);
  }
  if (categories.includes('support')) {
    categoryResults.support = await eraseSupportCategory(db, userId, tables);
    if (categoryResults.support.status === 'completed') await bumpGeneration('support');
  }
  if (categories.includes('account_security')) {
    if (!options.skipAccountClosureSteps) {
      await executeAccountClosureSteps(db, userId, now, tables);
    }
    await bumpGeneration('account_security');
    categoryResults.account_security = {
      account_closed: true,
      sessions_and_devices_revoked: true,
      credentials_and_mfa_cleared: true,
      retention_exceptions: ['security_audit_minimization'],
    };
  }

  for (const catKey of categories) {
    const def = PRIVACY_DATA_CATALOG[catKey];
    for (const exc of def?.retention_exceptions || []) {
      retentionExceptionSet.set(`${catKey}:${exc.code}`, { ...exc, category_key: catKey });
    }
  }

  await runSql(db, "UPDATE task30_erasure_requests SET status = 'cleanup_pending', updated_at = ?2 WHERE id = ?1", [
    reqId,
    nowIso(),
  ]);

  const r2Summary = await executeErasureR2Tasks(db, storage, reqId, {
    simulateR2Failure: options.simulateR2Failure,
    simulateD1CommitFailure: options.simulateD1CommitFailure,
    environment: options.environment,
  });

  let finalStatus = 'completed';
  if (r2Summary.failed_count > 0 && r2Summary.retry_pending_count === 0 && r2Summary.cleaning_count === 0) {
    finalStatus = 'failed';
  } else if (r2Summary.retry_pending_count > 0 || r2Summary.cleaning_count > 0 || !r2Summary.physically_erased_confirmed) {
    finalStatus = 'retry_pending';
  } else if (categories.length === 1 && categories[0] === 'support' && categoryResults.support?.status) {
    finalStatus = categoryResults.support.status;
  } else if (categoryResults.support?.retained_counts && Object.values(categoryResults.support.retained_counts).some((n) => n > 0)) {
    finalStatus = 'partially_completed';
  }

  return {
    final_status: finalStatus,
    category_results: categoryResults,
    r2_summary: r2Summary,
    retention_exceptions: [...retentionExceptionSet.values()],
  };
}

export async function commitPrivacyErasure(context, account, payload) {
  const db = context.env.WYJ_DB;
  const storage = context.env.WYJ_STORAGE;
  await ensureTask30Schema(db);
  if (payload.user_id !== undefined && String(payload.user_id) !== String(account.id)) {
    throw new PrivacyError('privacy_owner_mismatch', '禁止跨账户提交数据删除请求', 403);
  }

  const { scopeType, categories, includesAccountSecurity, requiredConfirmation, stepupScope } =
    normalizeScopeAndCategories(payload.scope_type, payload.categories);
  const idempotencyKey = payload.idempotency_key ? cleanId(payload.idempotency_key, 120) : null;
  const requestId = String(context.data?.requestId || `req:${crypto.randomUUID()}`);
  const previewRequestId = payload.preview_request_id ? cleanId(payload.preview_request_id, 120) : null;

  /* Replay guard before consuming single-use Step-up grant */
  if (idempotencyKey) {
    const existing = await first(
      db,
      "SELECT * FROM task30_erasure_requests WHERE user_id = ?1 AND idempotency_key = ?2",
      [account.id, idempotencyKey],
    );
    if (existing) {
      const existingCats = parseJsonSafe(existing.categories_json, []);
      if (
        String(existing.scope_type) !== scopeType ||
        JSON.stringify([...existingCats].sort()) !== JSON.stringify([...categories].sort())
      ) {
        throw new PrivacyError('privacy_idempotency_conflict', '相同幂等键已被用于不同的删除范围', 409);
      }
      return {
        request: formatRequestRow(existing),
        tasks: await all(db, 'SELECT * FROM task30_erasure_tasks WHERE request_id_ref = ?1 ORDER BY created_at ASC', [
          existing.id,
        ]),
        idempotent_replay: true,
        account_deleted: includesAccountSecurity && existing.status === 'completed',
      };
    }
  }

  if (previewRequestId) {
    const previewRow = await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [previewRequestId]);
    if (!previewRow) throw new PrivacyError('erasure_preview_not_found', '删除预检单不存在', 404);
    if (String(previewRow.user_id) !== String(account.id)) {
      throw new PrivacyError('privacy_owner_mismatch', '无权使用其他账户的预检单', 403);
    }
    if (previewRow.status === 'cancelled') {
      throw new PrivacyError('erasure_preview_cancelled', '该删除请求已被取消，请重新发起预检', 409);
    }
  }

  const confirmation = String(payload.confirmation_text || '').trim();
  if (confirmation !== requiredConfirmation) {
    throw new PrivacyError(
      'privacy_confirmation_mismatch',
      `确认口令不匹配，请准确输入：${requiredConfirmation}`,
      400,
    );
  }

  if (includesAccountSecurity && (await isProtectedAdminUser(db, account))) {
    throw new PrivacyError('admin_protected', '管理员角色需由站点所有者撤销后才能注销账户', 403);
  }

  const grantToken = context.request?.headers?.get('X-Aeris-Stepup') || payload.grant || '';
  const candidateScopes = includesAccountSecurity
    ? ['privacy_account_delete', 'account_delete']
    : ['privacy_data_delete', previewRequestId ? `privacy_data_delete:${previewRequestId}` : ''];
  const authz = await authorizeAnyScope(context, account, grantToken, candidateScopes);

  const now = nowIso();
  const erasureReqId = `privreq:${crypto.randomUUID()}`;
  const tables = await existingTables(db, ALL_MANAGED_TABLES);
  const environment = String(context.env?.WYJ_ENVIRONMENT || 'development');

  /* Step 1: Consume single-use Step-up grant & create verified request atomically */
  const insertReqStmt = db.prepare(`INSERT INTO task30_erasure_requests (
      id, user_id, request_type, scope_type, categories_json, mode, status,
      idempotency_key, confirmation_text, stepup_scope, stepup_verified, access_revoked_at,
      requested_by, request_id, preview_json, result_json, exception_summary_json,
      attempt_count, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 'commit', 'access_revoked', ?6, ?7, ?8, 1, ?9, ?2, ?10, '{}', '{}', '[]', 1, ?9, ?9)`).bind(
    erasureReqId,
    account.id,
    includesAccountSecurity ? 'account_erasure' : 'category_erasure',
    scopeType,
    JSON.stringify(categories),
    idempotencyKey,
    confirmation,
    authz.scope,
    now,
    requestId,
  );

  const task27Events = tables.has('task27_events')
    ? eventStatements(
        db,
        account.id,
        includesAccountSecurity ? 'privacy_account_erased' : 'privacy_erasure_requested',
        account.id,
        requestId,
      )
    : [];

  const accountLockStmts = includesAccountSecurity && tables.has('task12_users')
    ? [
        db.prepare(`UPDATE task12_users
          SET password_hash = '', password_scheme = 'invalid', password_iterations = 0,
              deleted = 1, session_version = session_version + 1,
              updated_at = ?2, source_updated_at = ?2
          WHERE id = ?1`).bind(account.id, now),
        ...(tables.has('task12_sessions')
          ? [db.prepare('UPDATE task12_sessions SET revoked = 1, revoked_at = ?2 WHERE user_id = ?1 AND revoked = 0').bind(account.id, now)]
          : []),
      ]
    : [];

  await atomic(db, [...authz.guards, insertReqStmt, ...accountLockStmts, ...task27Events]);

  /* Step 2: Execute D1 erasure, tombstones, access revocation, and bounded R2 cleanup */
  let summary;
  try {
    if (includesAccountSecurity && payload.simulate_account_closure_interruption && environment !== 'production') {
      throw new Error('simulated_account_closure_interruption');
    }
    summary = await runCategoryErasureBatch(db, storage, account.id, categories, tables, erasureReqId, now, {
      simulateR2Failure: Boolean(payload.simulate_r2_failure),
      simulateD1CommitFailure: Boolean(payload.simulate_d1_commit_failure),
      environment,
      skipAccountClosureSteps: false,
    });
  } catch (error) {
    if (includesAccountSecurity) {
      await runSql(
        db,
        `UPDATE task30_erasure_requests
         SET status = 'retry_pending', error_code = 'account_erasure_interrupted',
             error_message = ?2, next_retry_at = ?3, updated_at = ?4
         WHERE id = ?1`,
        [erasureReqId, String(error?.message || 'account_erasure_interrupted').slice(0, 200), nowIso(), nowIso()],
      ).catch(() => {});
    } else {
      await runSql(
        db,
        "UPDATE task30_erasure_requests SET status = 'failed', error_code = 'erasure_execution_failed', error_message = ?2, updated_at = ?3 WHERE id = ?1",
        [erasureReqId, String(error?.message || 'erasure_execution_failed').slice(0, 200), nowIso()],
      ).catch(() => {});
    }
    throw error;
  }

  const finishedAt = nowIso();
  await runSql(
    db,
    `UPDATE task30_erasure_requests
     SET status = ?2, result_json = ?3, exception_summary_json = ?4, updated_at = ?5,
         error_code = CASE WHEN ?2 = 'retry_pending' THEN 'r2_cleanup_pending_retry' WHEN ?2 = 'failed' THEN 'erasure_task_failed' ELSE NULL END,
         error_message = CASE
           WHEN ?2 = 'retry_pending' THEN '主服务与链接访问已立即撤销，对象存储物理删除遇到暂时故障，已进入异步重试队列。'
           WHEN ?2 = 'failed' THEN '部分清理任务校验未通过，未标记物理完成，请查看明细。'
           ELSE NULL
         END,
         next_retry_at = CASE WHEN ?2 = 'retry_pending' THEN ?6 ELSE NULL END,
         completed_at = CASE WHEN ?2 IN ('completed', 'partially_completed', 'blocked_by_retention') THEN ?5 ELSE NULL END
     WHERE id = ?1`,
    [
      erasureReqId,
      summary.final_status,
      JSON.stringify(summary.category_results),
      JSON.stringify(summary.retention_exceptions),
      finishedAt,
      futureIso(60_000),
    ],
  );

  if (summary.final_status === 'completed' && tables.has('task27_events') && !includesAccountSecurity) {
    try {
      await db.batch(eventStatements(db, account.id, 'privacy_erasure_completed', account.id, requestId));
    } catch {
      /* Non-fatal if user state changed concurrently */
    }
  }

  await writePrivacyAudit(db, {
    userId: account.id,
    actorId: account.id,
    action: includesAccountSecurity ? 'account_erasure_committed' : 'category_erasure_committed',
    categoryKey: categories.length === 1 ? categories[0] : 'multi',
    targetType: 'erasure_request',
    targetId: erasureReqId,
    status: summary.final_status,
    summary: { categories, stepup_scope: authz.scope, r2: summary.r2_summary },
    requestId,
  });

  const finalRow = await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [erasureReqId]);
  const taskRows = await all(db, 'SELECT * FROM task30_erasure_tasks WHERE request_id_ref = ?1 ORDER BY created_at ASC', [
    erasureReqId,
  ]);

  return {
    request: formatRequestRow(finalRow),
    tasks: taskRows,
    idempotent_replay: false,
    account_deleted: includesAccountSecurity,
  };
}

export async function retryPrivacyErasureRequest(context, account, requestIdValue, payload = {}) {
  const db = context.env.WYJ_DB;
  const storage = context.env.WYJ_STORAGE;
  await ensureTask30Schema(db);
  const requestId = cleanId(requestIdValue, 120);
  const reqRow = await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [requestId]);
  if (!reqRow) throw new PrivacyError('erasure_request_not_found', '删除请求不存在', 404);
  if (String(reqRow.user_id) !== String(account.id)) {
    throw new PrivacyError('privacy_owner_mismatch', '无权重试其他账户的删除请求', 403);
  }
  if (!['retry_pending', 'cleanup_pending', 'access_revoked'].includes(String(reqRow.status))) {
    return {
      request: formatRequestRow(reqRow),
      tasks: await all(db, 'SELECT * FROM task30_erasure_tasks WHERE request_id_ref = ?1', [requestId]),
      no_op: true,
    };
  }

  const environment = String(context.env?.WYJ_ENVIRONMENT || 'development');
  if (reqRow.request_type === 'account_erasure' && reqRow.error_code === 'account_erasure_interrupted') {
    const resumed = await executeAccountErasure(
      db,
      storage,
      { id: reqRow.user_id },
      {
        existingRequestId: reqId,
        skipUserSessions: false,
        environment,
        simulateR2Failure: Boolean(payload.simulate_r2_failure),
        simulateD1CommitFailure: Boolean(payload.simulate_d1_commit_failure),
      },
    );
    return {
      request: formatRequestRow(await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [requestId])),
      tasks: await all(db, 'SELECT * FROM task30_erasure_tasks WHERE request_id_ref = ?1', [requestId]),
      r2_summary: resumed.r2_summary,
      resumed_account_closure: true,
    };
  }

  const r2Summary = await executeErasureR2Tasks(db, storage, requestId, {
    simulateR2Failure: Boolean(payload.simulate_r2_failure),
    simulateD1CommitFailure: Boolean(payload.simulate_d1_commit_failure),
    environment,
  });

  const now = nowIso();
  const existingResult = parseJsonSafe(reqRow.result_json, {});
  const nextStatus =
    r2Summary.failed_count > 0 && r2Summary.retry_pending_count === 0 && r2Summary.cleaning_count === 0
      ? 'failed'
      : r2Summary.retry_pending_count > 0 || r2Summary.cleaning_count > 0 || !r2Summary.physically_erased_confirmed
        ? 'retry_pending'
        : existingResult?.support?.retained_counts &&
            Object.values(existingResult.support.retained_counts).some((n) => n > 0)
          ? 'partially_completed'
          : 'completed';

  await runSql(
    db,
    `UPDATE task30_erasure_requests
     SET status = ?2, attempt_count = attempt_count + 1,
         error_code = CASE WHEN ?2 = 'retry_pending' THEN 'r2_cleanup_pending_retry' WHEN ?2 = 'failed' THEN 'erasure_task_failed' ELSE NULL END,
         error_message = CASE
           WHEN ?2 = 'retry_pending' THEN '部分 R2 对象清理仍待重试'
           WHEN ?2 = 'failed' THEN '部分清理任务校验失败，未标记物理完成'
           ELSE NULL
         END,
         next_retry_at = CASE WHEN ?2 = 'retry_pending' THEN ?3 ELSE NULL END,
         completed_at = CASE WHEN ?2 IN ('completed', 'partially_completed') THEN ?4 ELSE NULL END,
         updated_at = ?4
     WHERE id = ?1`,
    [requestId, nextStatus, futureIso(60_000), now],
  );

  await writePrivacyAudit(db, {
    userId: account.id,
    actorId: account.id,
    action: 'erasure_retry_executed',
    targetType: 'erasure_request',
    targetId: requestId,
    status: nextStatus,
    summary: r2Summary,
    requestId: String(context.data?.requestId || 'retry'),
  });

  return {
    request: formatRequestRow(await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [requestId])),
    tasks: await all(db, 'SELECT * FROM task30_erasure_tasks WHERE request_id_ref = ?1', [requestId]),
    r2_summary: r2Summary,
  };
}

export async function getPrivacyRequests(context, account, query = {}) {
  const db = context.env.WYJ_DB;
  await ensureTask30Schema(db);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || 30), 10) || 30));
  const statusFilter = query.status ? String(query.status).trim() : '';
  if (statusFilter && !ALLOWED_REQUEST_STATUSES.has(statusFilter)) {
    throw new PrivacyError('request_status_invalid', '请求状态筛选无效', 400);
  }

  const tables = await existingTables(db, ['task29_backup_exports', 'task29_restore_jobs']);
  const reqRows = statusFilter
    ? await all(
        db,
        'SELECT * FROM task30_erasure_requests WHERE user_id = ?1 AND status = ?2 ORDER BY created_at DESC LIMIT ?3',
        [account.id, statusFilter, limit],
      )
    : await all(
        db,
        'SELECT * FROM task30_erasure_requests WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2',
        [account.id, limit],
      );

  const exportRows = tables.has('task29_backup_exports')
    ? await all(
        db,
        'SELECT id, format, scopes_json, counts_json, created_at FROM task29_backup_exports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20',
        [account.id],
      )
    : [];

  return {
    requests: reqRows.map(formatRequestRow),
    exports: exportRows.map((row) => ({
      id: String(row.id),
      format: String(row.format),
      scopes: parseJsonSafe(row.scopes_json, []),
      counts: parseJsonSafe(row.counts_json, {}),
      created_at: String(row.created_at),
    })),
  };
}

export async function getPrivacyRequestDetail(context, account, requestIdValue) {
  const db = context.env.WYJ_DB;
  await ensureTask30Schema(db);
  const requestId = cleanId(requestIdValue, 120);
  const row = await first(db, 'SELECT * FROM task30_erasure_requests WHERE id = ?1', [requestId]);
  if (!row) throw new PrivacyError('erasure_request_not_found', '未找到对应的数据请求记录', 404);
  if (String(row.user_id) !== String(account.id)) {
    throw new PrivacyError('privacy_owner_mismatch', '无权查看其他账户的数据请求详情', 403);
  }
  const tasks = await all(db, 'SELECT * FROM task30_erasure_tasks WHERE request_id_ref = ?1 ORDER BY created_at ASC', [
    requestId,
  ]);
  const audits = await all(
    db,
    'SELECT id, action, category_key, status, summary_json, created_at FROM task30_privacy_audit WHERE user_id = ?1 AND target_id = ?2 ORDER BY created_at ASC',
    [account.id, requestId],
  );
  return {
    request: formatRequestRow(row),
    tasks: tasks.map((task) => ({
      id: String(task.id),
      category_key: String(task.category_key),
      target_type: String(task.target_type),
      target_ref: String(task.target_ref),
      has_r2_key: Boolean(task.r2_key),
      status: String(task.status),
      attempt_count: Number(task.attempt_count || 0),
      last_error: task.last_error || null,
      completed_at: task.completed_at || null,
    })),
    audit_trail: audits.map((a) => ({
      id: String(a.id),
      action: String(a.action),
      category_key: a.category_key || null,
      status: String(a.status),
      summary: parseJsonSafe(a.summary_json, {}),
      created_at: String(a.created_at),
    })),
  };
}

export async function runPrivacyRetentionCleanup(context, options = {}) {
  const db = context.env.WYJ_DB;
  const storage = context.env.WYJ_STORAGE;
  await ensureTask30Schema(db);

  const now = nowIso();
  const runId = `cleanrun:${crypto.randomUUID()}`;
  const environment = String(context.env?.WYJ_ENVIRONMENT || 'development');
  const triggerSource = String(options.triggerSource || 'api');
  const triggeredBy = options.triggeredBy ? String(options.triggeredBy) : null;
  const limit = Math.min(50, Math.max(1, Number(options.limit || 25)));
  const tables = await existingTables(db, ALL_MANAGED_TABLES);

  await runSql(
    db,
    `INSERT INTO task30_cleanup_runs (id, trigger_source, triggered_by, status, environment, started_at, next_scheduled_at)
     VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6)`,
    [runId, triggerSource, triggeredBy, environment, now, futureIso(6 * 3600 * 1000)],
  );

  const includeLegacyShareSweep = options.includeLegacyShareSweep !== false;
  const summary = {
    task14_cleanup: null,
    task22_cleanup: null,
    task28_multipart_cleanup: null,
    task12_expired_sessions_deleted: 0,
    task20_expired_device_sessions_deleted: 0,
    task27_expired_challenges_deleted: 0,
    task29_expired_restore_jobs_deleted: 0,
    task15_expired_sessions_deleted: 0,
    task15_expired_ai_cache_deleted: 0,
    email_inbound_expired_deleted: 0,
    tombstones_expired_deleted: 0,
    pending_erasure_requests_retried: 0,
    interrupted_account_erasures_resumed: 0,
    failed_erasure_requests: 0,
    errors: [],
  };

  if (includeLegacyShareSweep && storage) {
    const budget = cleanupStorageBudget(storage, 40);

    if (tables.has('task14_shares')) {
      try {
        summary.task14_cleanup = await cleanupExpiredShares(db, budget, {
          limit,
          objectBudget: 25,
          scanOrphans: false,
          environment,
        });
      } catch (error) {
        summary.errors.push(`task14:${error?.message || 'failed'}`);
      }
    }

    if (tables.has('task22_shares')) {
      try {
        summary.task22_cleanup = await cleanupExpiredTransfers(db, budget, {
          limit,
          objectBudget: 25,
          scanOrphans: false,
          environment,
        });
      } catch (error) {
        summary.errors.push(`task22:${error?.message || 'failed'}`);
      }
    }

    if (tables.has('task28_multipart_cleanup')) {
      try {
        summary.task28_multipart_cleanup = await retryMultipartAborts(db, budget, 10);
      } catch (error) {
        summary.errors.push(`task28_multipart:${error?.message || 'failed'}`);
      }
    }
  }

  if (tables.has('task12_sessions')) {
    const res = await runSql(
      db,
      `DELETE FROM task12_sessions WHERE token_digest IN (
        SELECT token_digest FROM task12_sessions WHERE expires_at < ?1 ORDER BY expires_at ASC LIMIT 100
      )`,
      [now],
    );
    summary.task12_expired_sessions_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('task20_device_sessions')) {
    if (tables.has('task20_used_refresh_tokens')) {
      await runSql(
        db,
        `DELETE FROM task20_used_refresh_tokens WHERE session_id IN (
          SELECT id FROM task20_device_sessions WHERE refresh_expires_at < ?1 ORDER BY refresh_expires_at ASC LIMIT 100
        )`,
        [now],
      );
    }
    const res = await runSql(
      db,
      `DELETE FROM task20_device_sessions WHERE id IN (
        SELECT id FROM task20_device_sessions WHERE refresh_expires_at < ?1 ORDER BY refresh_expires_at ASC LIMIT 100
      )`,
      [now],
    );
    summary.task20_expired_device_sessions_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('task27_challenges')) {
    const res = await runSql(db, 'DELETE FROM task27_challenges WHERE expires_at < ?1', [now]);
    summary.task27_expired_challenges_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('task29_restore_jobs')) {
    const res = await runSql(
      db,
      "DELETE FROM task29_restore_jobs WHERE state IN ('prechecked', 'failed', 'rolled_back') AND expires_at != '' AND expires_at < ?1",
      [now],
    );
    summary.task29_expired_restore_jobs_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('task15_quiz_sessions')) {
    const res = await runSql(db, 'DELETE FROM task15_quiz_sessions WHERE expires_at < ?1', [now]);
    summary.task15_expired_sessions_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('task15_ai_cache')) {
    const res = await runSql(db, 'DELETE FROM task15_ai_cache WHERE expires_at < ?1', [now]);
    summary.task15_expired_ai_cache_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('email_center_inbound_messages')) {
    await runSql(db, 'DELETE FROM email_center_inbound_messages WHERE retention_expires_at < ?1', [now]);
  }
  if (tables.has('email_center_inbound_threads')) {
    const res = await runSql(db, 'DELETE FROM email_center_inbound_threads WHERE retention_expires_at < ?1', [now]);
    summary.email_inbound_expired_deleted = Number(res?.meta?.changes || 0);
  }
  if (tables.has('task30_erasure_tombstones')) {
    const res = await runSql(
      db,
      'DELETE FROM task30_erasure_tombstones WHERE expires_at IS NOT NULL AND expires_at < ?1',
      [now],
    );
    summary.tombstones_expired_deleted = Number(res?.meta?.changes || 0);
  }

  /* Retry due Task30 pending/retry_pending erasure requests & interrupted account closures */
  const staleCutoff = new Date(Date.now() - 60_000).toISOString();
  const dueRequests = await all(
    db,
    `SELECT id, user_id, request_type, error_code, result_json FROM task30_erasure_requests
     WHERE (
       (status IN ('retry_pending', 'cleanup_pending') AND (next_retry_at IS NULL OR next_retry_at <= ?1 OR ?2 = 1))
       OR (request_type = 'account_erasure' AND status = 'access_revoked' AND (error_code = 'account_erasure_interrupted' OR updated_at <= ?3 OR ?2 = 1))
     )
     ORDER BY updated_at ASC LIMIT 10`,
    [now, options.forceRetry ? 1 : 0, staleCutoff],
  );
  for (const reqRow of dueRequests) {
    try {
      if (reqRow.request_type === 'account_erasure' && (reqRow.error_code === 'account_erasure_interrupted' || reqRow.result_json === '{}')) {
        await executeAccountErasure(db, storage, { id: reqRow.user_id }, {
          existingRequestId: reqRow.id,
          skipUserSessions: false,
          environment,
        });
        summary.interrupted_account_erasures_resumed += 1;
        summary.pending_erasure_requests_retried += 1;
        continue;
      }

      const r2Res = await executeErasureR2Tasks(db, storage, reqRow.id, { environment });
      const resJson = parseJsonSafe(reqRow.result_json, {});
      const status =
        r2Res.failed_count > 0 && r2Res.retry_pending_count === 0 && r2Res.cleaning_count === 0
          ? 'failed'
          : r2Res.retry_pending_count > 0 || r2Res.cleaning_count > 0 || !r2Res.physically_erased_confirmed
            ? 'retry_pending'
            : resJson?.support?.retained_counts && Object.values(resJson.support.retained_counts).some((n) => n > 0)
              ? 'partially_completed'
              : 'completed';
      if (status === 'failed') summary.failed_erasure_requests += 1;
      await runSql(
        db,
        `UPDATE task30_erasure_requests
         SET status = ?2, attempt_count = attempt_count + 1,
             error_code = CASE WHEN ?2 = 'retry_pending' THEN 'r2_cleanup_pending_retry' WHEN ?2 = 'failed' THEN 'erasure_task_failed' ELSE NULL END,
             next_retry_at = CASE WHEN ?2 = 'retry_pending' THEN ?3 ELSE NULL END,
             completed_at = CASE WHEN ?2 IN ('completed', 'partially_completed') THEN ?4 ELSE NULL END,
             updated_at = ?4
         WHERE id = ?1`,
        [reqRow.id, status, futureIso(60_000), nowIso()],
      );
      summary.pending_erasure_requests_retried += 1;
    } catch (error) {
      summary.errors.push(`erasure:${reqRow.id}:${error?.message || 'failed'}`);
    }
  }

  const finalRunStatus = (summary.errors.length > 0 || summary.failed_erasure_requests > 0) ? 'partial' : 'completed';
  const finishedAt = nowIso();
  await runSql(
    db,
    `UPDATE task30_cleanup_runs
     SET status = ?2, summary_json = ?3, error_message = ?4, finished_at = ?5
     WHERE id = ?1`,
    [
      runId,
      finalRunStatus,
      JSON.stringify(summary),
      summary.errors.length ? summary.errors.join('; ').slice(0, 400) : null,
      finishedAt,
    ],
  );

  return {
    run_id: runId,
    status: finalRunStatus,
    started_at: now,
    finished_at: finishedAt,
    next_scheduled_at: futureIso(6 * 3600 * 1000),
    summary,
  };
}
