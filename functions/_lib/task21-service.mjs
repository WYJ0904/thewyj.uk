import { sha256Hex } from "./cloudflare-foundation.mjs";
import {
  AUTO_INGEST_CONFIDENCE_MILLI,
  MAX_EVENT_PAGE,
  MAX_INGEST_OPERATIONS,
  NOTIFICATION_ENTITLEMENT,
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

export async function ensureTask21Schema(db) {
  if (!db?.prepare) return false;
  try {
    const row = await first(db, "SELECT value FROM task21_metadata WHERE key = ?1", ["schema_version"]);
    return String(row?.value || "") === TASK21_SCHEMA_VERSION;
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
    ?12, ?13, '', 'accepted', 'structured_notification_parser', ?14, ?15, ?16)`)
    .bind(
      rawId, account.id, deviceId, event.event_id, sourceProvider, event.fingerprint,
      event.direction, event.amount_minor, event.currency, event.merchant, event.counterparty,
      occurredAtMs, event.received_at_ms, JSON.stringify(metadata), version, now,
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

  const changeStatement = db.prepare(`INSERT INTO task16_finance_changes (
    user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
  ) VALUES (?1, ?2, 'raw_event', ?3, 'ingest', 1, ?4, ?5)`)
    .bind(account.id, version, rawId,
      JSON.stringify({
        raw_event: { id: rawId, source_type: "notification", source_event_id: event.event_id, direction: event.direction, amount_minor: event.amount_minor, currency: event.currency },
        transaction_id: transactionId,
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
  const id = `cand:${crypto.randomUUID()}`;
  await run(db, `INSERT INTO task21_notification_candidates (
    id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty,
    payment_channel, occurred_at_ms, confidence, status, finance_transaction_id, created_at, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', '', ?12, ?12)`, [
    id, account.id, event.event_id, event.direction, event.amount_minor, event.currency,
    event.merchant, event.counterparty, event.payment_channel, event.occurred_at_ms || event.received_at_ms,
    event.confidence, now,
  ]);
  return { id, duplicate: false };
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
    const existingEvent = await first(db, `SELECT * FROM task21_notification_events
      WHERE user_id = ?1 AND (event_id = ?2 OR fingerprint = ?3)`, [
      account.id, event.event_id, event.fingerprint,
    ]);
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
  requireNotificationAccess(account);
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
  requireNotificationAccess(account);
  const status = String(input.status || "pending").trim().toLowerCase();
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    throw new Task21Error("通知候选状态无效", 400, "candidate_status_invalid");
  }
  const limit = Math.min(MAX_EVENT_PAGE, Math.max(1, Number.parseInt(String(input.limit || 50), 10) || 50));
  const rows = await all(db, `SELECT * FROM task21_notification_candidates
    WHERE user_id = ?1 ${status ? "AND status = ?2" : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?3`, [account.id, status, limit]);
  return { candidates: rows.map(publicNotificationCandidate) };
}

export async function confirmNotificationCandidate(db, account, input) {
  requireNotificationAccess(account);
  requireAllowedFields(input, new Set(["candidate_id", "device_id"]));
  const candidateId = cleanId(input.candidate_id, "候选标识");
  const row = await candidateById(db, account, candidateId);
  if (row.status === "confirmed") return { candidate: publicNotificationCandidate(row), no_change: true };
  if (row.status !== "pending") throw new Task21Error("该候选不能确认", 409, "candidate_status_invalid");
  validateDeviceId(input.device_id);
  const event = await eventById(db, account, row.event_id);
  if (event.status !== "active") throw new Task21Error("该候选关联通知已删除", 409, "candidate_status_invalid");
  const finance = await createAutomaticFinanceTransaction(db, account, event.device_id, {
    event_id: event.event_id,
    fingerprint: event.fingerprint,
    direction: row.direction,
    amount_minor: row.amount_minor,
    currency: row.currency,
    merchant: row.merchant,
    counterparty: row.counterparty,
    payment_channel: row.payment_channel,
    occurred_at_ms: row.occurred_at_ms,
    received_at_ms: event.received_at_ms,
    confidence: row.confidence,
    parser_version: event.parser_version,
  });
  const now = isoNow();
  await run(db, `UPDATE task21_notification_candidates SET status = 'confirmed',
    finance_transaction_id = ?2, updated_at = ?3 WHERE user_id = ?1 AND id = ?4`, [
    account.id, finance.transaction_id, now, candidateId,
  ]);
  const updated = await candidateById(db, account, candidateId);
  return { candidate: publicNotificationCandidate(updated), transaction_id: finance.transaction_id };
}

export async function rejectNotificationCandidate(db, account, input) {
  requireNotificationAccess(account);
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
