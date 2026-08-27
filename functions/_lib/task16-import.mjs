import { sha256Hex } from "./cloudflare-foundation.mjs";
import {
  Task16Error,
  cleanCurrency,
  cleanDirection,
  cleanId,
  cleanText,
  isoNow,
  positiveInteger,
  requireAllowedFields,
  safeJsonObject,
  stableJson,
} from "./task16-model.mjs";

const MAX_BATCH_RECORDS = 100;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireDatabase(db) {
  if (!db?.prepare) throw new Task16Error("云端财务数据库暂时不可用", 503, "finance_database_unavailable", true);
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

function resultChanges(result) {
  return Number(result?.meta?.changes || 0);
}

function cleanDigest(value, label) {
  const digest = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(digest)) throw new Task16Error(`${label}无效`, 400, "digest_invalid");
  return digest;
}

function normalizeLegacyRecord(value, expectedUserId) {
  requireAllowedFields(value, new Set([
    "id", "user_id", "direction", "amount_minor", "currency", "merchant", "counterparty", "note",
    "occurred_at_ms", "source", "legacy_timestamp", "legacy_type",
  ]));
  const userId = cleanId(value.user_id, "用户标识");
  if (userId !== expectedUserId) throw new Task16Error("导入记录不属于目标用户", 403, "import_owner_mismatch");
  const source = cleanText(value.source, 80, "旧来源");
  if (!source) throw new Task16Error("旧来源不能为空", 400, "legacy_source_required");
  const legacyType = cleanText(value.legacy_type, 40, "旧记录类型");
  const legacyDirections = new Map([["消费", "expense"], ["收款", "income"], ["退款", "refund"]]);
  if (!legacyDirections.has(legacyType) || legacyDirections.get(legacyType) !== cleanDirection(value.direction)) {
    throw new Task16Error("旧记录类型与收支方向不一致", 400, "legacy_direction_mismatch");
  }
  return {
    id: cleanId(value.id, "账目标识"), user_id: userId,
    direction: legacyDirections.get(legacyType),
    amount_minor: positiveInteger(value.amount_minor, "金额", 10000000000000),
    currency: cleanCurrency(value.currency),
    merchant: cleanText(value.merchant, 160, "商户"),
    counterparty: cleanText(value.counterparty, 160, "对手方"),
    note: cleanText(value.note, 500, "备注"),
    occurred_at_ms: positiveInteger(value.occurred_at_ms, "交易时间"),
    source,
    legacy_timestamp: positiveInteger(value.legacy_timestamp || value.occurred_at_ms, "旧记录时间"),
    legacy_type: legacyType,
  };
}

function legacyTransactionMatches(row, sourceKey, record) {
  return String(row.user_id) === record.user_id
    && String(row.import_source_key) === sourceKey
    && String(row.source_kind) === "legacy_import"
    && String(row.direction) === record.direction
    && Number(row.amount_minor) === record.amount_minor
    && String(row.currency) === record.currency
    && String(row.merchant) === record.merchant
    && String(row.counterparty) === record.counterparty
    && String(row.note) === record.note
    && Number(row.occurred_at_ms) === record.occurred_at_ms;
}

async function recordReceipt(db, sourceKey, recordId) {
  return await first(db, `SELECT record_digest FROM task16_import_record_receipts
    WHERE source_key = ?1 AND record_id = ?2`, [sourceKey, recordId]);
}

async function importOne(db, sourceKey, record) {
  const recordDigest = await sha256Hex(stableJson(record));
  const priorReceipt = await recordReceipt(db, sourceKey, record.id);
  if (priorReceipt) {
    if (priorReceipt.record_digest !== recordDigest) {
      throw new Task16Error("同一旧记录标识对应了不同内容", 409, "import_record_conflict");
    }
    return { applied: false, resumed: true };
  }
  const existing = await first(db, "SELECT * FROM task16_finance_transactions WHERE id = ?1", [record.id]);
  if (existing) {
    if (!legacyTransactionMatches(existing, sourceKey, record)) {
      throw new Task16Error("导入账目标识与现有数据冲突", 409, "import_identifier_conflict");
    }
    const rawEventId = `raw:${record.id}`;
    const evidence = await first(db, `SELECT relation.raw_event_id FROM task16_finance_transaction_events AS relation
      JOIN task16_finance_raw_events AS event ON event.id = relation.raw_event_id
      WHERE relation.transaction_id = ?1 AND relation.raw_event_id = ?2
        AND relation.relation_status = 'active' AND event.source_type = 'legacy_import'`, [record.id, rawEventId]);
    if (!evidence) throw new Task16Error("旧记录缺少可审计原始证据", 409, "import_evidence_missing");
    await run(db, `INSERT INTO task16_import_record_receipts (
      source_key, record_id, record_digest, created_at
    ) VALUES (?1, ?2, ?3, ?4)`, [sourceKey, record.id, recordDigest, isoNow()]);
    return { applied: false, resumed: true };
  }
  const now = isoNow();
  const rawEventId = `raw:${record.id}`;
  const rawEvent = {
    id: rawEventId,
    device_id: "legacy-import",
    source_type: "legacy_import",
    source_event_id: record.id,
    source_provider: record.source,
    provider_reference: "",
    direction: record.direction,
    amount_minor: record.amount_minor,
    currency: record.currency,
    merchant: record.merchant,
    counterparty: record.counterparty,
    account_last4: "",
    occurred_at_ms: record.occurred_at_ms,
    captured_at_ms: record.legacy_timestamp,
    classification: "accepted",
    classification_reason: "structured_legacy_event",
    sync_version: 0,
    created_at: now,
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await run(db, `INSERT OR IGNORE INTO task16_finance_user_versions (user_id, server_version, updated_at)
      VALUES (?1, 0, ?2)`, [record.user_id, now]);
    const versionRow = await first(db, "SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1", [record.user_id]);
    const current = Number(versionRow?.server_version || 0);
    const next = current + 1;
    const payload = JSON.stringify({
      raw_event: { ...rawEvent, sync_version: next },
      transaction: {
        id: record.id, direction: record.direction, amount_minor: record.amount_minor, currency: record.currency,
        category_id: "", merchant: record.merchant, counterparty: record.counterparty, note: record.note,
        occurred_at_ms: record.occurred_at_ms, source_kind: "legacy_import", reconciliation_state: "confirmed",
        status: "active", revision: 1, sync_version: next, created_at: now, updated_at: now, deleted_at: "",
      },
    });
    try {
      await db.batch([
        db.prepare(`UPDATE task16_finance_user_versions SET server_version = ?2, updated_at = ?3
          WHERE user_id = ?1 AND server_version = ?4`).bind(record.user_id, next, now, current),
        db.prepare(`INSERT INTO task16_finance_transactions (
          id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note,
          occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version,
          created_by_device, import_source_key, created_at, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?8, ?9,
          'legacy_import', 'confirmed', 'active', 1, ?10, 'legacy-import', ?11, ?12, ?12, '')`)
          .bind(record.id, record.user_id, record.direction, record.amount_minor, record.currency,
            record.merchant, record.counterparty, record.note, record.occurred_at_ms, next, sourceKey, now),
        db.prepare(`INSERT INTO task16_finance_raw_events (
          id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference,
          direction, amount_minor, currency, merchant, counterparty, account_last4,
          occurred_at_ms, captured_at_ms, text_fingerprint_sha256, classification,
          classification_reason, metadata_json, sync_version, created_at
        ) VALUES (?1, ?2, 'legacy-import', 'legacy_import', ?3, ?4, '', ?5, ?6, ?7, ?8, ?9, '',
          ?10, ?11, '', 'accepted', 'structured_legacy_event', ?12, ?13, ?14)`)
          .bind(
            rawEventId, record.user_id, record.id, record.source, record.direction,
            record.amount_minor, record.currency, record.merchant, record.counterparty,
            record.occurred_at_ms, record.legacy_timestamp,
            JSON.stringify({ legacy_type: record.legacy_type }), next, now,
          ),
        db.prepare(`INSERT INTO task16_finance_transaction_events (
          transaction_id, raw_event_id, relation_status, confidence_milli, evidence_json,
          linked_by, created_at, updated_at
        ) VALUES (?1, ?2, 'active', 1000, '["legacy_import"]', 'legacy_import', ?3, ?3)`)
          .bind(record.id, rawEventId, now),
        db.prepare(`INSERT INTO task16_finance_changes (
          user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
        ) VALUES (?1, ?2, 'transaction', ?3, 'upsert', 1, ?4, ?5)`)
          .bind(record.user_id, next, record.id, payload, now),
        db.prepare(`INSERT INTO task16_finance_audit_logs (
          id, user_id, actor_device_id, action, entity_type, entity_id, before_json, after_json, created_at
        ) VALUES (?1, ?2, 'legacy-import', 'legacy_import', 'transaction', ?3, '{}', ?4, ?5)`)
          .bind(crypto.randomUUID(), record.user_id, record.id, JSON.stringify({ source_key: sourceKey, legacy_type: record.legacy_type }), now),
        db.prepare(`INSERT INTO task16_import_record_receipts (
          source_key, record_id, record_digest, created_at
        ) VALUES (?1, ?2, ?3, ?4)`).bind(sourceKey, record.id, recordDigest, now),
      ]);
      return { applied: true, resumed: false };
    } catch (error) {
      const racedReceipt = await recordReceipt(db, sourceKey, record.id);
      if (racedReceipt) {
        if (racedReceipt.record_digest !== recordDigest) throw error;
        return { applied: false, resumed: true };
      }
      if (attempt === 3) throw error;
    }
  }
  throw new Task16Error("旧记录导入冲突，请重试", 409, "import_retry_exhausted", true);
}

async function importedCanonicalDigest(db, sourceKey) {
  const rows = await all(db, `SELECT
      ledger.id, ledger.user_id, ledger.direction, ledger.amount_minor,
      ledger.currency, ledger.merchant, ledger.counterparty, ledger.note,
      ledger.occurred_at_ms, event.source_provider, event.captured_at_ms, event.metadata_json
    FROM task16_finance_transactions AS ledger
    JOIN task16_finance_transaction_events AS relation
      ON relation.transaction_id = ledger.id AND relation.relation_status = 'active'
    JOIN task16_finance_raw_events AS event
      ON event.id = relation.raw_event_id AND event.source_type = 'legacy_import'
    WHERE ledger.import_source_key = ?1
    ORDER BY ledger.id`, [sourceKey]);
  const canonical = rows.map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    direction: String(row.direction),
    amount_minor: Number(row.amount_minor),
    currency: String(row.currency),
    merchant: String(row.merchant),
    counterparty: String(row.counterparty),
    note: String(row.note),
    occurred_at_ms: Number(row.occurred_at_ms),
    source: String(row.source_provider),
    legacy_timestamp: Number(row.captured_at_ms),
    legacy_type: String(safeJsonObject(row.metadata_json).legacy_type || ""),
  }));
  return { count: canonical.length, digest: await sha256Hex(stableJson(canonical)) };
}

export async function importLegacyFinance(db, input) {
  requireAllowedFields(input, new Set([
    "source_key", "user_id", "source_count", "canonical_sha256", "batch_key", "records", "complete",
  ]));
  const sourceKey = cleanId(input.source_key, "迁移来源标识");
  const userId = cleanId(input.user_id, "用户标识");
  const sourceCount = Number(input.source_count);
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 0 || sourceCount > 1_000_000) throw new Task16Error("源记录数量无效", 400, "source_count_invalid");
  const canonicalSha = cleanDigest(input.canonical_sha256, "源数据摘要");
  const batchKey = cleanId(input.batch_key, "批次标识");
  const records = Array.isArray(input.records) ? input.records : [];
  if (records.length > MAX_BATCH_RECORDS) throw new Task16Error("迁移批次过大", 413, "import_batch_too_large");
  const complete = Boolean(input.complete);
  const normalized = records.map((record) => normalizeLegacyRecord(record, userId));
  if (new Set(normalized.map((record) => record.id)).size !== normalized.length) {
    throw new Task16Error("迁移批次包含重复旧记录", 409, "import_batch_duplicate_record");
  }
  const batchDigest = await sha256Hex(stableJson(normalized));
  const receipt = await first(db, `SELECT batch_digest, received_count, applied_count
    FROM task16_import_receipts WHERE source_key = ?1 AND batch_key = ?2`, [sourceKey, batchKey]);
  if (receipt) {
    if (receipt.batch_digest !== batchDigest) throw new Task16Error("同一迁移批次内容不一致", 409, "import_batch_conflict");
    return { source_key: sourceKey, batch_key: batchKey, received: Number(receipt.received_count), applied: Number(receipt.applied_count), idempotent_replay: true };
  }
  const user = await first(db, "SELECT id FROM task12_users WHERE id = ?1 AND deleted = 0", [userId]);
  if (!user) throw new Task16Error("迁移目标用户不存在", 404, "import_user_missing");
  let batch = await first(db, "SELECT * FROM task16_import_batches WHERE source_key = ?1", [sourceKey]);
  if (batch && (batch.user_id !== userId || Number(batch.source_count) !== sourceCount || batch.canonical_sha256 !== canonicalSha)) {
    throw new Task16Error("迁移来源信息冲突", 409, "import_source_conflict");
  }
  if (batch?.complete) throw new Task16Error("迁移来源已经完成", 409, "import_already_complete");
  if (batch?.status === "rolled_back") throw new Task16Error("迁移来源已经回滚，请使用新的来源标识", 409, "import_already_rolled_back");
  if (!batch) {
    const now = isoNow();
    await run(db, `INSERT INTO task16_import_batches (
      source_key, user_id, source_count, received_count, applied_count, complete,
      status, canonical_sha256, created_at, updated_at, rolled_back_at
    ) VALUES (?1, ?2, ?3, 0, 0, 0, 'started', ?4, ?5, ?5, '')`, [sourceKey, userId, sourceCount, canonicalSha, now]);
    batch = await first(db, "SELECT * FROM task16_import_batches WHERE source_key = ?1", [sourceKey]);
  }

  const receiptCountBefore = await first(db, `SELECT COUNT(*) AS count
    FROM task16_import_record_receipts WHERE source_key = ?1`, [sourceKey]);
  const placeholders = normalized.map((_, index) => `?${index + 2}`).join(",");
  const knownRows = normalized.length ? await all(db, `SELECT record_id FROM task16_import_record_receipts
    WHERE source_key = ?1 AND record_id IN (${placeholders})`, [sourceKey, ...normalized.map((record) => record.id)]) : [];
  const receivedBefore = Number(receiptCountBefore?.count || 0);
  const missingCount = normalized.length - knownRows.length;
  if (receivedBefore + missingCount > sourceCount) throw new Task16Error("迁移记录数量超过源计数", 409, "import_count_overflow");
  if (complete && receivedBefore + missingCount !== sourceCount) throw new Task16Error("迁移完成计数与源数据不一致", 409, "import_incomplete_source");

  let applied = 0;
  let resumed = 0;
  for (const record of normalized) {
    const result = await importOne(db, sourceKey, record);
    if (result.applied) applied += 1;
    if (result.resumed) resumed += 1;
  }
  const receiptCountAfter = await first(db, `SELECT COUNT(*) AS count
    FROM task16_import_record_receipts WHERE source_key = ?1`, [sourceKey]);
  const transactionCountAfter = await first(db, `SELECT COUNT(*) AS count
    FROM task16_finance_transactions WHERE import_source_key = ?1`, [sourceKey]);
  const receivedAfter = Number(receiptCountAfter?.count || 0);
  const importedAfter = Number(transactionCountAfter?.count || 0);
  if (receivedAfter !== importedAfter) throw new Task16Error("迁移记录与账目数量不一致", 409, "import_target_count_mismatch");
  if (complete) {
    const verified = await importedCanonicalDigest(db, sourceKey);
    if (verified.count !== sourceCount || verified.digest !== canonicalSha) {
      throw new Task16Error("云端迁移数据摘要与源数据不一致", 409, "import_canonical_digest_mismatch");
    }
  }
  const now = isoNow();
  await db.batch([
    db.prepare(`UPDATE task16_import_batches SET received_count = ?2, applied_count = ?3,
      complete = ?4, status = ?5, updated_at = ?6 WHERE source_key = ?1`)
      .bind(sourceKey, receivedAfter, importedAfter, Number(complete), complete ? "completed" : "started", now),
    db.prepare(`INSERT INTO task16_import_receipts (
      source_key, batch_key, batch_digest, received_count, applied_count, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(sourceKey, batchKey, batchDigest, normalized.length, applied, now),
  ]);
  return { source_key: sourceKey, batch_key: batchKey, received: normalized.length, applied, resumed, complete };
}

export async function task16ImportStatus(db, sourceKey = "") {
  const key = sourceKey ? cleanId(sourceKey, "迁移来源标识") : "";
  const imports = await all(db, `SELECT source_key, user_id, source_count, received_count,
      applied_count, complete, status, canonical_sha256, created_at, updated_at, rolled_back_at
    FROM task16_import_batches ${key ? "WHERE source_key = ?1" : ""}
    ORDER BY updated_at DESC`, key ? [key] : []);
  return imports.map((row) => ({ ...row, source_count: Number(row.source_count), received_count: Number(row.received_count), applied_count: Number(row.applied_count), complete: Boolean(row.complete) }));
}

export async function rollbackTask16Import(db, input) {
  requireAllowedFields(input, new Set(["source_key"]));
  const sourceKey = cleanId(input.source_key, "迁移来源标识");
  const batch = await first(db, "SELECT * FROM task16_import_batches WHERE source_key = ?1", [sourceKey]);
  if (!batch) return { source_key: sourceKey, rolled_back: 0, no_change: true };
  if (batch.status === "rolled_back") return { source_key: sourceKey, rolled_back: 0, no_change: true };
  const versionRow = await first(db, "SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1", [batch.user_id]);
  let expectedServerVersion = Number(versionRow?.server_version || 0);
  const conflicts = await first(db, `SELECT COUNT(*) AS count FROM task16_finance_transactions
    WHERE import_source_key = ?1 AND (revision != 1 OR source_kind != 'legacy_import')`, [sourceKey]);
  if (Number(conflicts?.count || 0) > 0) throw new Task16Error("部分导入账目已被修改，不能自动回滚", 409, "rollback_conflict");
  const rows = await all(db, `SELECT * FROM task16_finance_transactions
    WHERE import_source_key = ?1 AND status = 'active' ORDER BY id`, [sourceKey]);
  let rolledBack = 0;
  for (const row of rows) {
    const now = isoNow();
    const nextVersion = expectedServerVersion + 1;
    const revision = Number(row.revision) + 1;
    const transaction = {
      id: row.id, direction: row.direction, amount_minor: Number(row.amount_minor), currency: row.currency,
      category_id: row.category_id, merchant: row.merchant, counterparty: row.counterparty, note: row.note,
      occurred_at_ms: Number(row.occurred_at_ms), source_kind: row.source_kind,
      reconciliation_state: row.reconciliation_state, status: "deleted", revision,
      sync_version: nextVersion, created_at: row.created_at, updated_at: now, deleted_at: now,
    };
    await db.batch([
      db.prepare(`UPDATE task16_finance_user_versions SET server_version = ?2, updated_at = ?3
        WHERE user_id = ?1 AND server_version = ?4`).bind(row.user_id, nextVersion, now, expectedServerVersion),
      db.prepare(`UPDATE task16_finance_transactions SET status = 'deleted', revision = ?2,
        sync_version = ?3, updated_at = ?4, deleted_at = ?4
        WHERE id = ?1 AND import_source_key = ?5 AND revision = 1`)
        .bind(row.id, revision, nextVersion, now, sourceKey),
      db.prepare(`INSERT INTO task16_finance_changes (
        user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
      ) VALUES (?1, ?2, 'transaction', ?3, 'delete', ?4, ?5, ?6)`)
        .bind(row.user_id, nextVersion, row.id, revision, JSON.stringify({ transaction }), now),
      db.prepare(`INSERT INTO task16_finance_audit_logs (
        id, user_id, actor_device_id, action, entity_type, entity_id, before_json, after_json, created_at
      ) VALUES (?1, ?2, 'legacy-import', 'legacy_import_rollback', 'transaction', ?3, ?4, ?5, ?6)`)
        .bind(crypto.randomUUID(), row.user_id, row.id, JSON.stringify({ status: row.status, revision: row.revision }), JSON.stringify(transaction), now),
    ]);
    expectedServerVersion = nextVersion;
    rolledBack += 1;
  }
  const now = isoNow();
  await run(db, `UPDATE task16_import_batches SET status = 'rolled_back', complete = 0,
    rolled_back_at = ?2, updated_at = ?2 WHERE source_key = ?1`, [sourceKey, now]);
  return { source_key: sourceKey, rolled_back: rolledBack };
}

export async function task16ImportCounts(db) {
  const tables = {
    devices: "task16_finance_devices", raw_events: "task16_finance_raw_events",
    transactions: "task16_finance_transactions", transaction_events: "task16_finance_transaction_events",
    categories: "task16_finance_categories", budgets: "task16_finance_budgets",
    changes: "task16_finance_changes", audits: "task16_finance_audit_logs",
    import_record_receipts: "task16_import_record_receipts",
  };
  const counts = {};
  for (const [key, table] of Object.entries(tables)) {
    const row = await first(db, `SELECT COUNT(*) AS count FROM ${table}`);
    counts[key] = Number(row?.count || 0);
  }
  return counts;
}

export const __testing = { importOne, normalizeLegacyRecord, resultChanges };
