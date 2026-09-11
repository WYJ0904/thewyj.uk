import { sha256Hex } from "./cloudflare-foundation.mjs";
import { publicTransaction } from "./task16-model.mjs";
import {
  AUTO_INGEST_CONFIDENCE_MILLI,
  MAX_EVENT_PAGE,
  MAX_INGEST_OPERATIONS,
  NOTIFICATION_ENTITLEMENT,
  TASK21_DB_SCHEMA_VERSION,
  TASK21_SCHEMA_VERSION,
  Task21Error,
  cleanId,
  cleanText,
  isoNow,
  nonNegativeInteger,
  normalizeNotificationEvent,
  positiveInteger,
  publicNotificationCandidate,
  publicNotificationEvent,
  requireAllowedFields,
} from "./task21-model.mjs";

const MAX_CLOCK_MS = 4_102_444_800_000;
const OPERATION_TYPES = new Set(["event.ingest"]);

function requireDatabase(db) {
  if (!db?.prepare) throw new Task21Error("通知归档数据库暂时不可用", 503, "notification_database_unavailable", true);
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

function hasNotificationAccess(account) {
  const entitlements = new Set(Array.isArray(account?.entitlements) ? account.entitlements : []);
  return Boolean(account?.is_super_admin || entitlements.has(NOTIFICATION_ENTITLEMENT) || entitlements.has("all_features_access"));
}

export function requireNotificationAccess(account) {
  if (!account) throw new Task21Error("请先登录", 401, "authentication_required");
  if (!hasNotificationAccess(account)) {
    throw new Task21Error("当前会员不包含通知保存功能", 403, "notification_membership_required");
  }
  return account;
}

/**
 * Finance recognition (ingest, candidates, confirm/reject) is a finance_access
 * capability: a finance-only account may recognise payments without being able
 * to browse the notification archive, and an archive-only account must never
 * create finance records.
 */
function hasFinanceAccess(account) {
  const entitlements = new Set(Array.isArray(account?.entitlements) ? account.entitlements : []);
  return Boolean(
    account?.is_super_admin
    || entitlements.has("finance_access")
    || entitlements.has("all_features_access"),
  );
}

export function requireFinanceRecognitionAccess(account) {
  if (!account) throw new Task21Error("请先登录", 401, "authentication_required");
  if (!hasFinanceAccess(account)) {
    throw new Task21Error("当前会员不包含财务识别功能", 403, "finance_membership_required");
  }
  return account;
}

export async function ensureTask21Schema(db) {
  if (!db?.prepare) return false;
  try {
    const row = await first(db, "SELECT value FROM task21_metadata WHERE key = ?1", ["schema_version"]);
    return String(row?.value || "") === TASK21_DB_SCHEMA_VERSION;
  } catch (_) {
    return false;
  }
}

function operationReceipt(db, userId, operationId) {
  return first(db, `SELECT payload_digest, result_json FROM task21_notification_sync_operations
    WHERE user_id = ?1 AND operation_id = ?2`, [userId, operationId]);
}

async function operationDigest(operation) {
  return await sha256Hex(JSON.stringify(operation, Object.keys(operation).sort()));
}

function replayResult(row, digest) {
  if (!row) return null;
  if (String(row.payload_digest || "") !== digest) {
    throw new Task21Error("同一操作标识对应了不同内容", 409, "operation_id_conflict");
  }
  let result;
  try { result = JSON.parse(String(row.result_json || "{}")); } catch (_) { result = {}; }
  return { ...result, idempotent_replay: true };
}

function validateDeviceId(value) {
  const deviceId = cleanId(value, "设备标识");
  return deviceId;
}

async function nextFinanceVersion(db, userId, now) {
  await run(db, `INSERT OR IGNORE INTO task16_finance_user_versions (user_id, server_version, updated_at)
    VALUES (?1, 0, ?2)`, [userId, now]);
  const row = await first(db, "SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1", [userId]);
  return Number(row?.server_version || 0) + 1;
}

async function findFinanceRawBySourceEvent(db, userId, sourceEventId) {
  return await first(db, `SELECT * FROM task16_finance_raw_events
    WHERE user_id = ?1 AND source_type = 'notification' AND source_event_id = ?2
    ORDER BY created_at LIMIT 1`, [userId, sourceEventId]);
}

async function financeTransactionIdForRaw(db, rawId) {
  const row = await first(db, `SELECT transaction_id FROM task16_finance_transaction_events
    WHERE raw_event_id = ?1 AND relation_status = 'active'`, [rawId]);
  return String(row?.transaction_id || "");
}

async function createAutomaticFinanceTransaction(db, account, deviceId, event) {
  const existing = await findFinanceRawBySourceEvent(db, account.id, event.event_id);
  if (existing) {
    return { transaction_id: await financeTransactionIdForRaw(db, existing.id), duplicate: true };
  }

  const now = isoNow();
  const version = await nextFinanceVersion(db, account.id, now);
  const rawId = `raw:${crypto.randomUUID()}`;
  const transactionId = `txn:${crypto.randomUUID()}`;
  const sourceProvider = event.payment_channel || "notification";
  const occurredAtMs = event.occurred_at_ms || event.received_at_ms;
  const metadata = { capture_version: event.parser_version || "task21", payment_channel: event.payment_channel };

  const rawStatement = db.prepare(`INSERT INTO task16_finance_raw_events (
    id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference,
    direction, amount_minor, currency, merchant, counterparty, account_last4,
    occurred_at_ms, captured_at_ms, text_fingerprint_sha256, classification,
    classification_reason, metadata_json, sync_version, created_at
  ) VALUES (?1, ?2, ?3, 'notification', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '',
    ?12, ?13, ?17, 'accepted', 'structured_notification_parser', ?14, ?15, ?16)`)
    .bind(
      // provider_reference stays empty unless a real provider/order reference is
      // known; the content fingerprint is similarity evidence only and lives in
      // text_fingerprint_sha256. Two real payments with identical text must not
      // collide on the raw-event identity.
      rawId, account.id, deviceId, event.event_id, sourceProvider, "",
      event.direction, event.amount_minor, event.currency, event.merchant, event.counterparty,
      occurredAtMs, event.received_at_ms, JSON.stringify(metadata), version, now,
      String(event.fingerprint || ""),
    );

  const transactionStatement = db.prepare(`INSERT INTO task16_finance_transactions (
    id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note,
    occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version,
    created_by_device, import_source_key, created_at, updated_at, deleted_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, '', ?8, 'automatic', 'automatic', 'active',
    1, ?9, ?10, '', ?11, ?11, '')`)
    .bind(
      transactionId, account.id, event.direction, event.amount_minor, event.currency,
      event.merchant, event.counterparty, occurredAtMs, version, deviceId, now,
    );

  const linkStatement = db.prepare(`INSERT INTO task16_finance_transaction_events (
    transaction_id, raw_event_id, relation_status, confidence_milli, evidence_json, linked_by, created_at, updated_at
  ) VALUES (?1, ?2, 'active', ?3, ?4, 'automatic', ?5, ?5)`)
    .bind(transactionId, rawId, event.confidence, JSON.stringify(["structured_notification_parser"]), now);

  const auditStatement = db.prepare(`INSERT INTO task16_finance_audit_logs (
    id, user_id, actor_device_id, action, entity_type, entity_id, before_json, after_json, created_at
  ) VALUES (?1, ?2, ?3, 'raw_event_ingest', 'raw_event', ?4, '{}', ?5, ?6)`)
    .bind(crypto.randomUUID(), account.id, deviceId, rawId,
      JSON.stringify({ classification: "accepted", transaction_id: transactionId, source: "task21_notification" }), now);

  // The change feed must describe the *transaction*: clients only project
  // transaction/category/budget changes, so an automatic booking previously
  // only emitted a "raw_event" row and every already hydrated Web/Android
  // ledger silently missed the new entry ("通知已识别支付，但财务 0 笔").
  // The raw event row and the transaction↔evidence link above stay as the
  // immutable audit trail; this row is what makes the ledger converge.
  const changeStatement = db.prepare(`INSERT INTO task16_finance_changes (
    user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
  ) VALUES (?1, ?2, 'transaction', ?3, 'upsert', 1, ?4, ?5)`)
    .bind(account.id, version, transactionId,
      JSON.stringify({
        transaction: publicTransaction({
          id: transactionId,
          direction: event.direction,
          amount_minor: event.amount_minor,
          currency: event.currency,
          category_id: "",
          merchant: event.merchant,
          counterparty: event.counterparty,
          note: "",
          occurred_at_ms: occurredAtMs,
          source_kind: "automatic",
          reconciliation_state: "automatic",
          status: "active",
          revision: 1,
          sync_version: version,
          created_at: now,
          updated_at: now,
          deleted_at: "",
        }),
      }), now);

  try {
    await db.batch([
      rawStatement,
      transactionStatement,
      linkStatement,
      auditStatement,
      db.prepare(`UPDATE task16_finance_user_versions SET server_version = ?2, updated_at = ?3
        WHERE user_id = ?1 AND server_version = ?4`).bind(account.id, version, now, version - 1),
      changeStatement,
    ]);
    return { transaction_id: transactionId, duplicate: false };
  } catch (error) {
    const raced = await findFinanceRawBySourceEvent(db, account.id, event.event_id);
    if (raced) return { transaction_id: await financeTransactionIdForRaw(db, raced.id), duplicate: true };
    throw error;
  }
}

async function candidateForEvent(db, account, event, now) {
  const existing = await first(db, `SELECT * FROM task21_notification_candidates
    WHERE user_id = ?1 AND event_id = ?2`, [account.id, event.event_id]);
  if (existing) return { id: existing.id, duplicate: true };
  const reconciled = await reconcileEvidenceCandidate(db, account, event, now);
  if (reconciled) return { id: reconciled, duplicate: false, reconciled: true };
  const id = `cand:${crypto.randomUUID()}`;
  await run(db, `INSERT INTO task21_notification_candidates (
    id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty,
    payment_channel, occurred_at_ms, confidence, status, finance_transaction_id, created_at, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', '', ?12, ?12)`, [
    id, account.id, event.event_id, event.direction, event.amount_minor, event.currency,
    event.merchant, event.counterparty, event.payment_channel, event.occurred_at_ms || event.received_at_ms,
    event.confidence, now,
  ]);
  await linkEvidence(db, account, event, id, false, "pending", now);
  return { id, duplicate: false };
}

/**
 * Multi-source evidence reconciliation. A second source describing the same
 * payment (same amount, direction and channel inside a three minute window)
 * links to the existing candidate instead of creating a duplicate one.
 * Amount alone is never enough: direction and the time window must match too.
 */
async function reconcileEvidenceCandidate(db, account, event, now) {
  const amount = Number(event.amount_minor || 0);
  if (!(amount > 0)) return "";
  const occurred = Number(event.occurred_at_ms || event.received_at_ms || 0);
  if (!(occurred > 0)) return "";
  const direction = String(event.direction || "").toLowerCase();
  if (!["income", "expense", "refund"].includes(direction)) return "";
  const windowMs = 3 * 60 * 1000;
  const row = await first(db, `SELECT * FROM task21_notification_candidates
    WHERE user_id = ?1 AND status IN ('pending', 'confirmed')
      AND amount_minor = ?2 AND direction = ?3
      AND occurred_at_ms BETWEEN ?4 AND ?5
    ORDER BY ABS(occurred_at_ms - ?6) ASC LIMIT 1`, [
    account.id, amount, direction, occurred - windowMs, occurred + windowMs, occurred,
  ]);
  if (!row) return "";
  const alreadyLinked = await first(db, `SELECT id FROM task21_notification_evidence
    WHERE user_id = ?1 AND event_id = ?2`, [account.id, event.event_id]);
  if (alreadyLinked) return row.id;
  // Only cross-source evidence may merge. Two events from the same source with
  // the same amount and time can be two real payments (for example two ¥28
  // payments inside three minutes), so they must stay separate candidates.
  const sameSource = await first(db, `SELECT id FROM task21_notification_evidence
    WHERE user_id = ?1 AND candidate_id = ?2 AND source_type = ?3 AND source_package = ?4
    LIMIT 1`, [
    account.id, row.id,
    String(event.source_type || "notification"), String(event.source_package || ""),
  ]);
  if (sameSource) return "";
  await linkEvidence(db, account, event, row.id, false, "merged", now);
  await run(db, `UPDATE task21_notification_candidates
    SET evidence_count = evidence_count + 1, updated_at = ?2
    WHERE user_id = ?1 AND id = ?3`, [account.id, now, row.id]);
  return row.id;
}

async function linkEvidence(db, account, event, candidateId, primary, reconciliationState, now, transactionId = "") {
  await run(db, `INSERT INTO task21_notification_evidence (
    id, user_id, event_id, candidate_id, finance_transaction_id, source_type, source_package,
    parser_version, amount_minor, direction, provider_reference, occurred_at_ms, is_primary,
    reconciliation_state, created_at, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?15, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
  ON CONFLICT(user_id, event_id) DO UPDATE SET
    candidate_id = excluded.candidate_id,
    finance_transaction_id = excluded.finance_transaction_id,
    reconciliation_state = excluded.reconciliation_state,
    updated_at = excluded.updated_at`, [
    `evd:${crypto.randomUUID()}`, account.id, event.event_id, candidateId || "",
    String(event.source_type || "notification"), String(event.source_package || ""),
    String(event.parser_version || ""), Number(event.amount_minor || 0),
    String(event.direction || "unknown"), String(event.payment_channel || ""),
    Number(event.occurred_at_ms || event.received_at_ms || 0), primary ? 1 : 0,
    reconciliationState, now, transactionId || "",
  ]);
}

async function storeEvent(db, account, event, deviceId) {
  const now = isoNow();
  await run(db, `INSERT INTO task21_notification_events (
    event_id, user_id, device_id, fingerprint, source_package, source_type, event_type,
    parser_version, parse_status, direction, amount_minor, currency, payment_channel,
    merchant, counterparty, confidence, occurred_at_ms, received_at_ms, candidate_id,
    finance_transaction_id, status, created_at, updated_at, deleted_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
    ?17, ?18, '', '', 'active', ?19, ?19, '')`, [
    event.event_id, account.id, deviceId, event.fingerprint, event.source_package, event.source_type,
    event.event_type, event.parser_version, event.parse_status, event.direction, event.amount_minor,
    event.currency, event.payment_channel, event.merchant, event.counterparty, event.confidence,
    event.occurred_at_ms, event.received_at_ms, now,
  ]);
}

async function eventById(db, account, eventId) {
  const row = await first(db, `SELECT * FROM task21_notification_events
    WHERE user_id = ?1 AND event_id = ?2`, [account.id, eventId]);
  if (!row) throw new Task21Error("通知事件不存在", 404, "notification_event_not_found");
  return row;
}

async function candidateById(db, account, candidateId) {
  const row = await first(db, `SELECT * FROM task21_notification_candidates
    WHERE user_id = ?1 AND id = ?2`, [account.id, candidateId]);
  if (!row) throw new Task21Error("通知候选不存在", 404, "notification_candidate_not_found");
  return row;
}

function eventFromStoredRow(row) {
  return {
    event_id: String(row.event_id),
    fingerprint: String(row.fingerprint),
    source_package: String(row.source_package),
    source_type: String(row.source_type),
    event_type: String(row.event_type),
    parser_version: String(row.parser_version),
    parse_status: String(row.parse_status),
    direction: String(row.direction),
    amount_minor: Number(row.amount_minor),
    currency: String(row.currency),
    payment_channel: String(row.payment_channel),
    merchant: String(row.merchant),
    counterparty: String(row.counterparty),
    confidence: Number(row.confidence),
    occurred_at_ms: Number(row.occurred_at_ms),
    received_at_ms: Number(row.received_at_ms),
  };
}

async function attachEventOutcome(db, account, event, deviceId, now) {
  const isTransactionLike = event.event_type === "transaction" || event.event_type === "refund";
  const autoIngest = isTransactionLike && event.parse_status === "parsed"
    && event.confidence >= AUTO_INGEST_CONFIDENCE_MILLI;
  const makeCandidate = isTransactionLike && !autoIngest && event.parse_status !== "unparsed";
  let transactionId = "";
  let candidateId = "";
  if (autoIngest) {
    transactionId = (await createAutomaticFinanceTransaction(db, account, deviceId, event)).transaction_id;
    await linkEvidence(db, account, event, "", true, "confirmed", now, transactionId);
  } else if (makeCandidate) {
    candidateId = (await candidateForEvent(db, account, event, now)).id;
  }
  if (transactionId || candidateId) {
    await run(db, `UPDATE task21_notification_events SET candidate_id = ?2, finance_transaction_id = ?3,
      updated_at = ?4 WHERE user_id = ?1 AND event_id = ?5`, [
      account.id, candidateId, transactionId, now, event.event_id,
    ]);
  }
  return { transactionId, candidateId };
}

async function processIngest(db, account, deviceId, operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Task21Error("采集操作无效", 400, "operation_invalid");
  }
  requireAllowedFields(operation, new Set(["operation_id", "type", "payload"]));
  cleanId(operation.operation_id, "操作标识");
  if (operation.type !== "event.ingest") throw new Task21Error("采集操作类型无效", 400, "operation_type_invalid");
  const event = normalizeNotificationEvent(operation.payload);
  const now = isoNow();

  try {
    await storeEvent(db, account, event, deviceId);
  } catch (error) {
    // Identity is the source event id only: two real payments with identical
    // text are two events, never one.
    const existingEvent = await first(db, `SELECT * FROM task21_notification_events
      WHERE user_id = ?1 AND event_id = ?2`, [account.id, event.event_id]);
    if (!existingEvent) throw error;
    if (existingEvent.finance_transaction_id || existingEvent.candidate_id) {
      return {
        event: publicNotificationEvent(existingEvent),
        duplicate: true,
        transaction_id: existingEvent.finance_transaction_id,
        candidate_id: existingEvent.candidate_id,
      };
    }
    const repaired = eventFromStoredRow(existingEvent);
    const outcome = await attachEventOutcome(db, account, repaired, existingEvent.device_id, now);
    const row = await eventById(db, account, existingEvent.event_id);
    return {
      event: publicNotificationEvent(row),
      duplicate: true,
      recovered: true,
      transaction_id: outcome.transactionId,
      candidate_id: outcome.candidateId,
    };
  }

  const outcome = await attachEventOutcome(db, account, event, deviceId, now);
  const row = await eventById(db, account, event.event_id);
  return {
    event: publicNotificationEvent(row),
    duplicate: false,
    transaction_id: outcome.transactionId,
    candidate_id: outcome.candidateId,
  };
}

async function processOperation(db, account, deviceId, operation) {
  const digest = await operationDigest(operation);
  const operationId = cleanId(operation?.operation_id, "操作标识");
  const replay = replayResult(await operationReceipt(db, account.id, operationId), digest);
  if (replay) return replay;
  const type = String(operation?.type || "").trim();
  if (!OPERATION_TYPES.has(type)) throw new Task21Error("同步操作类型无效", 400, "operation_type_invalid");
  if (type === "event.ingest") {
    const result = await processIngest(db, account, deviceId, operation);
    await recordOperation(db, account, deviceId, operation, digest, result);
    return result;
  }
  throw new Task21Error("同步操作不存在", 400, "operation_type_invalid");
}

async function recordOperation(db, account, deviceId, operation, digest, result) {
  const now = isoNow();
  try {
    await run(db, `INSERT INTO task21_notification_sync_operations (
      user_id, operation_id, device_id, operation_type, payload_digest, result_version, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)`, [
      account.id, operation.operation_id, deviceId, operation.type, digest, JSON.stringify(result), now,
    ]);
  } catch (error) {
    const receipt = replayResult(await operationReceipt(db, account.id, operation.operation_id), digest);
    if (receipt) return receipt;
    throw error;
  }
}

export async function ingestNotificationEvents(db, account, input) {
  requireFinanceRecognitionAccess(account);
  requireAllowedFields(input, new Set(["schema_version", "device_id", "operations"]));
  if (Number(input.schema_version) !== Number(TASK21_SCHEMA_VERSION)) {
    throw new Task21Error("通知采集版本不兼容", 409, "schema_version_unsupported");
  }
  const deviceId = validateDeviceId(input.device_id);
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (operations.length > MAX_INGEST_OPERATIONS) throw new Task21Error("一次采集的事件过多", 413, "too_many_operations");
  const results = [];
  for (const operation of operations) {
    results.push(await processOperation(db, account, deviceId, operation));
  }
  return { schema_version: Number(TASK21_SCHEMA_VERSION), operation_results: results, device_id: deviceId };
}

export async function listNotificationEvents(db, account, input = {}) {
  requireNotificationAccess(account);
  const before = input.before ? positiveInteger(input.before, "游标", MAX_CLOCK_MS) : MAX_CLOCK_MS;
  const beforeId = input.before_id ? cleanId(input.before_id, "游标事件标识") : "~~~~~~~~";
  const limit = Math.min(MAX_EVENT_PAGE, Math.max(1, Number.parseInt(String(input.limit || 50), 10) || 50));
  const includeDeleted = String(input.include_deleted || "").toLowerCase() === "true";
  const rows = await all(db, `SELECT * FROM task21_notification_events
    WHERE user_id = ?1
      AND (received_at_ms < ?2 OR (received_at_ms = ?2 AND event_id < ?3))
      ${includeDeleted ? "" : "AND status = 'active'"}
    ORDER BY received_at_ms DESC, event_id DESC LIMIT ?4`, [account.id, before, beforeId, limit]);
  const last = rows.length === limit ? rows.at(-1) : null;
  return {
    events: rows.map(publicNotificationEvent),
    next_before: last ? Number(last.received_at_ms) : 0,
    next_before_id: last ? String(last.event_id) : "",
  };
}

export async function listNotificationCandidates(db, account, input = {}) {
  requireFinanceRecognitionAccess(account);
  const status = String(input.status || "pending").trim().toLowerCase();
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    throw new Task21Error("通知候选状态无效", 400, "candidate_status_invalid");
  }
  const limit = Math.min(MAX_EVENT_PAGE, Math.max(1, Number.parseInt(String(input.limit || 50), 10) || 50));
  const rows = await all(db, `SELECT * FROM task21_notification_candidates
    WHERE user_id = ?1 ${status ? "AND status = ?2" : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?3`, [account.id, status, limit]);
  if (!rows.length) return { candidates: [] };
  // Attach the minimal evidence summary (source types/packages and machine
  // values for each contributing event) without any raw notification text.
  const placeholders = rows.map((_, index) => `?${index + 2}`).join(",");
  const evidenceRows = await all(db, `SELECT event_id, candidate_id, source_type, source_package,
    amount_minor, direction, provider_reference, occurred_at_ms, reconciliation_state, created_at
    FROM task21_notification_evidence
    WHERE user_id = ?1 AND candidate_id IN (${placeholders})
    ORDER BY created_at ASC`, [account.id, ...rows.map((row) => row.id)]);
  const byCandidate = new Map();
  for (const evidence of evidenceRows) {
    if (!byCandidate.has(evidence.candidate_id)) byCandidate.set(evidence.candidate_id, []);
    byCandidate.get(evidence.candidate_id).push({
      event_id: String(evidence.event_id || ""),
      source_type: String(evidence.source_type || "notification"),
      source_package: String(evidence.source_package || ""),
      amount_minor: Number(evidence.amount_minor || 0),
      direction: String(evidence.direction || ""),
      provider_reference: String(evidence.provider_reference || ""),
      occurred_at_ms: Number(evidence.occurred_at_ms || 0),
      reconciliation_state: String(evidence.reconciliation_state || ""),
      created_at: String(evidence.created_at || ""),
    });
  }
  return {
    candidates: rows.map((row) => ({
      ...publicNotificationCandidate(row),
      evidence: byCandidate.get(row.id) || [],
    })),
  };
}

export async function confirmNotificationCandidate(db, account, input) {
  requireFinanceRecognitionAccess(account);
  requireAllowedFields(input, new Set(["candidate_id", "device_id", "edits"]));
  const candidateId = cleanId(input.candidate_id, "候选标识");
  const row = await candidateById(db, account, candidateId);
  // Validate edits before any early return so malformed input is always
  // rejected, even for an idempotent re-confirm.
  const edits = candidateEdits(input.edits);
  if (row.status === "confirmed") return { candidate: publicNotificationCandidate(row), no_change: true };
  if (row.status !== "pending") throw new Task21Error("该候选不能确认", 409, "candidate_status_invalid");
  validateDeviceId(input.device_id);
  const event = await eventById(db, account, row.event_id);
  if (event.status !== "active") throw new Task21Error("该候选关联通知已删除", 409, "candidate_status_invalid");
  // A pending candidate may still be missing money fields (amount-unknown
  // hint). The user's edits are the only source that may fill them; an
  // incomplete candidate can never create a zero-amount transaction.
  const amountMinor = edits.amount_minor || Number(row.amount_minor);
  const direction = edits.direction || String(row.direction || "");
  if (!(amountMinor > 0)) {
    throw new Task21Error("请先填写金额后再确认", 400, "candidate_amount_required");
  }
  if (!direction) {
    throw new Task21Error("请先选择收支方向后再确认", 400, "candidate_direction_required");
  }
  // Edit-before-confirm: the user's corrections win and are recorded next to
  // the untouched machine evidence in the same candidate row.
  const finance = await createAutomaticFinanceTransaction(db, account, event.device_id, {
    event_id: event.event_id,
    fingerprint: event.fingerprint,
    direction,
    amount_minor: amountMinor,
    currency: row.currency,
    merchant: edits.merchant ?? row.merchant,
    counterparty: edits.counterparty ?? row.counterparty,
    payment_channel: row.payment_channel,
    occurred_at_ms: edits.occurred_at_ms || Number(row.occurred_at_ms),
    received_at_ms: event.received_at_ms,
    confidence: row.confidence,
    parser_version: event.parser_version,
  });
  const now = isoNow();
  const editedFields = Object.keys(edits);
  await db.batch([
    db.prepare(`UPDATE task21_notification_candidates SET status = 'confirmed',
      finance_transaction_id = ?2, edited_json = ?3,
      correction_count = correction_count + ?4, updated_at = ?5
      WHERE user_id = ?1 AND id = ?6`).bind(
      account.id, finance.transaction_id, JSON.stringify(edits),
      editedFields.length ? 1 : 0, now, candidateId,
    ),
    db.prepare(`UPDATE task21_notification_evidence SET finance_transaction_id = ?3,
      reconciliation_state = 'confirmed', updated_at = ?4
      WHERE user_id = ?1 AND candidate_id = ?2`).bind(account.id, candidateId, finance.transaction_id, now),
    db.prepare(`UPDATE task21_notification_events SET finance_transaction_id = ?2, updated_at = ?3
      WHERE user_id = ?1 AND candidate_id = ?4`).bind(account.id, finance.transaction_id, now, candidateId),
  ]);
  const updated = await candidateById(db, account, candidateId);
  return {
    candidate: publicNotificationCandidate(updated),
    transaction_id: finance.transaction_id,
    edited_fields: editedFields,
  };
}

/**
 * Only these fields may be corrected before confirm; each is validated and the
 * machine values in the evidence rows are never overwritten.
 */
function candidateEdits(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Task21Error("修改内容无效", 400, "candidate_edits_invalid");
  }
  try {
    const allowed = new Set(["amount_minor", "direction", "merchant", "counterparty", "occurred_at_ms", "note"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new Task21Error("修改内容无效", 400, "candidate_edits_invalid");
    }
    const edits = {};
    if (value.amount_minor !== undefined) {
      edits.amount_minor = positiveInteger(value.amount_minor, "金额", MAX_CLOCK_MS);
    }
    if (value.direction !== undefined) {
      const direction = String(value.direction || "").trim().toLowerCase();
      if (!["income", "expense", "refund"].includes(direction)) {
        throw new Task21Error("收支方向无效", 400, "candidate_edits_invalid");
      }
      edits.direction = direction;
    }
    if (value.merchant !== undefined) edits.merchant = cleanText(value.merchant, 160, "商户");
    if (value.counterparty !== undefined) edits.counterparty = cleanText(value.counterparty, 160, "对方");
    if (value.occurred_at_ms !== undefined) {
      edits.occurred_at_ms = positiveInteger(value.occurred_at_ms, "交易时间", MAX_CLOCK_MS);
    }
    if (value.note !== undefined) edits.note = cleanText(value.note, 200, "备注");
    return edits;
  } catch (error) {
    // One stable error code for any malformed correction payload.
    if (error instanceof Task21Error) throw new Task21Error("修改内容无效", 400, "candidate_edits_invalid");
    throw error;
  }
}

export async function rejectNotificationCandidate(db, account, input) {
  requireFinanceRecognitionAccess(account);
  requireAllowedFields(input, new Set(["candidate_id"]));
  const candidateId = cleanId(input.candidate_id, "候选标识");
  const row = await candidateById(db, account, candidateId);
  if (row.status === "rejected") return { candidate: publicNotificationCandidate(row), no_change: true };
  if (row.status !== "pending") throw new Task21Error("该候选不能拒绝", 409, "candidate_status_invalid");
  const now = isoNow();
  await run(db, `UPDATE task21_notification_candidates SET status = 'rejected',
    updated_at = ?2 WHERE user_id = ?1 AND id = ?3`, [account.id, now, candidateId]);
  const updated = await candidateById(db, account, candidateId);
  return { candidate: publicNotificationCandidate(updated) };
}

export async function deleteNotificationEvent(db, account, eventIdValue) {
  requireNotificationAccess(account);
  const eventId = cleanId(eventIdValue, "事件标识");
  const row = await eventById(db, account, eventId);
  if (row.status === "deleted") return { event: publicNotificationEvent(row), no_change: true };
  const now = isoNow();
  await db.batch([
    db.prepare(`UPDATE task21_notification_events SET status = 'deleted', deleted_at = ?2,
      updated_at = ?2 WHERE user_id = ?1 AND event_id = ?3`).bind(account.id, now, eventId),
    db.prepare(`UPDATE task21_notification_candidates SET status = 'rejected', updated_at = ?2
      WHERE user_id = ?1 AND event_id = ?3 AND status = 'pending'`).bind(account.id, now, eventId),
  ]);
  const updated = await eventById(db, account, eventId);
  return { event: publicNotificationEvent(updated) };
}

export const __testing = {
  all,
  candidateForEvent,
  changes,
  createAutomaticFinanceTransaction,
  first,
  hasNotificationAccess,
  operationDigest,
  processOperation,
  run,
  storeEvent,
};
