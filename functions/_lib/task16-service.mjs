import { sha256Hex } from "./cloudflare-foundation.mjs";
import {
  FINANCE_ENTITLEMENT,
  MAX_CHANGE_PAGE,
  MAX_SYNC_OPERATIONS,
  TASK16_SCHEMA_VERSION,
  Task16Error,
  cleanCurrency,
  cleanDirection,
  cleanId,
  cleanText,
  isoNow,
  nonNegativeInteger,
  normalizeManualTransaction,
  normalizeRawEvent,
  positiveInteger,
  publicRawEvent,
  publicTransaction,
  reconciliationScore,
  requireAllowedFields,
  safeJsonObject,
  stableJson,
} from "./task16-model.mjs";

const MAX_CLOCK_MS = 4_102_444_800_000;
const OPERATION_TYPES = new Set([
  "raw_event.ingest",
  "transaction.upsert",
  "transaction.delete",
  "transaction.restore",
  "category.upsert",
  "category.delete",
  "budget.upsert",
  "budget.delete",
]);

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

async function requireOwnedCategory(db, userId, categoryId) {
  if (!categoryId) return;
  const row = await first(db, `SELECT id FROM task16_finance_categories
    WHERE id = ?1 AND user_id = ?2 AND status = 'active'`, [categoryId, userId]);
  if (!row) throw new Task16Error("财务分类不存在", 409, "category_not_found");
}

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

function hasFinanceAccess(account) {
  const entitlements = new Set(Array.isArray(account?.entitlements) ? account.entitlements : []);
  return Boolean(account?.is_super_admin || entitlements.has(FINANCE_ENTITLEMENT) || entitlements.has("all_features_access"));
}

export function requireFinanceAccess(account) {
  if (!account) throw new Task16Error("请先登录", 401, "authentication_required");
  if (!hasFinanceAccess(account)) {
    throw new Task16Error("当前会员不包含财务功能", 403, "finance_membership_required");
  }
  return account;
}

export async function ensureTask16Schema(db) {
  if (!db?.prepare) return false;
  try {
    const row = await first(db, "SELECT value FROM task16_metadata WHERE key = ?1", ["schema_version"]);
    return String(row?.value || "") === TASK16_SCHEMA_VERSION;
  } catch (_) {
    return false;
  }
}

async function ensureUserVersion(db, userId, now = isoNow()) {
  await run(db, `INSERT OR IGNORE INTO task16_finance_user_versions (user_id, server_version, updated_at)
    VALUES (?1, 0, ?2)`, [userId, now]);
  const row = await first(db, "SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1", [userId]);
  return Number(row?.server_version || 0);
}

async function registerDevice(db, userId, input, now = isoNow()) {
  const deviceId = cleanId(input.device_id, "设备标识");
  const platform = String(input.platform || "").trim().toLowerCase();
  if (!["web", "android", "import"].includes(platform)) {
    throw new Task16Error("设备平台无效", 400, "device_platform_invalid");
  }
  const label = cleanText(input.device_label, 80, "设备名称");
  const clientVersion = cleanText(input.client_version, 80, "客户端版本");
  await run(db, `INSERT INTO task16_finance_devices (
      user_id, device_id, platform, label, client_version, last_sync_version, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
    ON CONFLICT(user_id, device_id) DO UPDATE SET
      platform = excluded.platform, label = excluded.label,
      client_version = excluded.client_version, updated_at = excluded.updated_at`,
  [userId, deviceId, platform, label, clientVersion, now]);
  await ensureUserVersion(db, userId, now);
  return { deviceId, platform, clientVersion };
}

async function operationReceipt(db, userId, operationId) {
  return await first(db, `SELECT payload_digest, result_version, result_json
    FROM task16_finance_sync_operations WHERE user_id = ?1 AND operation_id = ?2`, [userId, operationId]);
}

async function operationDigest(operation) {
  return await sha256Hex(stableJson(operation));
}

function receiptResult(row, digest) {
  if (!row) return null;
  if (String(row.payload_digest || "") !== digest) {
    throw new Task16Error("同一操作标识对应了不同内容", 409, "operation_id_conflict");
  }
  const result = safeJsonObject(row.result_json);
  return { ...result, idempotent_replay: true, server_version: Number(row.result_version || result.server_version || 0) };
}

async function recordNoopOperation(db, account, deviceId, operation, digest, result) {
  const now = isoNow();
  const encoded = JSON.stringify(result);
  try {
    await run(db, `INSERT INTO task16_finance_sync_operations (
      user_id, operation_id, device_id, operation_type, payload_digest,
      result_version, result_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`, [
      account.id, cleanId(operation.operation_id, "操作标识"), deviceId,
      String(operation.type || ""), digest, Number(result.server_version || 0), encoded, now,
    ]);
    return result;
  } catch (error) {
    const receipt = await operationReceipt(db, account.id, operation.operation_id);
    const replay = receiptResult(receipt, digest);
    if (replay) return replay;
    throw error;
  }
}

async function commitMutation(db, account, deviceId, operation, digest, mutationStatements, change) {
  const operationId = cleanId(operation.operation_id, "操作标识");
  const now = isoNow();
  const observedVersion = Number(change.observedServerVersion);
  const hasObservedVersion = Number.isSafeInteger(observedVersion) && observedVersion >= 0;
  const attempts = hasObservedVersion ? 1 : 4;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const existing = receiptResult(await operationReceipt(db, account.id, operationId), digest);
    if (existing) return existing;
    const currentVersion = hasObservedVersion ? observedVersion : await ensureUserVersion(db, account.id, now);
    const nextVersion = currentVersion + 1;
    const result = typeof change.result === "function" ? change.result(nextVersion, now) : { ...change.result };
    result.server_version = nextVersion;
    const encodedResult = JSON.stringify(result);
    const encodedChange = JSON.stringify(typeof change.payload === "function" ? change.payload(nextVersion, now) : change.payload);
    const statements = [
      db.prepare(`INSERT INTO task16_finance_sync_operations (
        user_id, operation_id, device_id, operation_type, payload_digest,
        result_version, result_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(account.id, operationId, deviceId, operation.type, digest, nextVersion, encodedResult, now),
      db.prepare(`UPDATE task16_finance_user_versions SET server_version = ?2, updated_at = ?3
        WHERE user_id = ?1 AND server_version = ?4`).bind(account.id, nextVersion, now, currentVersion),
      ...mutationStatements(nextVersion, now),
      db.prepare(`INSERT INTO task16_finance_changes (
        user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(
          account.id, nextVersion, change.entityType, change.entityId,
          change.operation, Number(change.revision || 0), encodedChange, now,
        ),
    ];
    try {
      await db.batch(statements);
      return result;
    } catch (error) {
      const replay = receiptResult(await operationReceipt(db, account.id, operationId), digest);
      if (replay) return replay;
      if (hasObservedVersion) {
        const latestVersion = await ensureUserVersion(db, account.id, now);
        if (latestVersion !== observedVersion) {
          throw new Task16Error("财务数据已在另一设备更新，请同步后重试", 409, "finance_write_conflict", true, {
            server_version: latestVersion,
          });
        }
        throw error;
      }
      if (attempt === attempts - 1) throw error;
    }
  }
  throw new Task16Error("同步冲突，请重试", 409, "sync_version_conflict", true);
}

function transactionRowFor(account, deviceId, id, value, sourceKind = "manual", now = isoNow()) {
  return {
    id,
    user_id: account.id,
    ...normalizeManualTransaction(value),
    source_kind: sourceKind,
    reconciliation_state: sourceKind === "automatic" ? "automatic" : "confirmed",
    status: "active",
    revision: 1,
    sync_version: 0,
    created_by_device: deviceId,
    import_source_key: "",
    created_at: now,
    updated_at: now,
    deleted_at: "",
  };
}

function transactionInsertStatement(db, row, version, now) {
  return db.prepare(`INSERT INTO task16_finance_transactions (
    id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note,
    occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version,
    created_by_device, import_source_key, created_at, updated_at, deleted_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?14, ?15, ?16, ?17, ?18, '')`)
    .bind(
      row.id, row.user_id, row.direction, row.amount_minor, row.currency, row.category_id,
      row.merchant, row.counterparty, row.note, row.occurred_at_ms, row.source_kind,
      row.reconciliation_state, row.revision, version, row.created_by_device,
      row.import_source_key || "", row.created_at || now, now,
    );
}

function auditStatement(db, account, deviceId, action, entityType, entityId, before, after, now) {
  return db.prepare(`INSERT INTO task16_finance_audit_logs (
    id, user_id, actor_device_id, action, entity_type, entity_id, before_json, after_json, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(
      crypto.randomUUID(), account.id, deviceId, action, entityType, entityId,
      JSON.stringify(before || {}), JSON.stringify(after || {}), now,
    );
}

async function upsertTransaction(db, account, deviceId, operation, digest, observedServerVersion) {
  requireAllowedFields(operation, new Set(["operation_id", "type", "entity_id", "base_revision", "payload"]));
  const id = cleanId(operation.entity_id, "账目标识");
  const baseRevision = nonNegativeInteger(operation.base_revision || 0, "基础版本", 1_000_000_000);
  const existing = await first(db, "SELECT * FROM task16_finance_transactions WHERE id = ?1", [id]);
  if (existing && existing.user_id !== account.id) throw new Task16Error("账目不存在", 404, "transaction_not_found");
  if (!existing && baseRevision !== 0) throw new Task16Error("账目版本冲突", 409, "transaction_conflict");
  if (existing && Number(existing.revision) !== baseRevision) {
    throw new Task16Error("账目已在另一设备更新", 409, "transaction_conflict", false, {
      current: publicTransaction(existing),
    });
  }
  const normalized = normalizeManualTransaction(operation.payload);
  await requireOwnedCategory(db, account.id, normalized.category_id);
  const revision = existing ? baseRevision + 1 : 1;
  const planned = existing ? {
    ...existing, ...normalized, status: "active", revision, updated_at: isoNow(), deleted_at: "",
  } : transactionRowFor(account, deviceId, id, normalized);
  return await commitMutation(db, account, deviceId, operation, digest, (version, now) => [
    existing
      ? db.prepare(`UPDATE task16_finance_transactions SET
          direction = ?2, amount_minor = ?3, currency = ?4, category_id = ?5,
          merchant = ?6, counterparty = ?7, note = ?8, occurred_at_ms = ?9,
          status = 'active', revision = ?10, sync_version = ?11, updated_at = ?12, deleted_at = ''
        WHERE id = ?1 AND user_id = ?13 AND revision = ?14`)
        .bind(
          id, normalized.direction, normalized.amount_minor, normalized.currency, normalized.category_id,
          normalized.merchant, normalized.counterparty, normalized.note, normalized.occurred_at_ms,
          revision, version, now, account.id, baseRevision,
        )
      : transactionInsertStatement(db, planned, version, now),
    auditStatement(db, account, deviceId, existing ? "transaction_edit" : "transaction_create", "transaction", id,
      existing ? publicTransaction(existing) : {}, { ...publicTransaction(planned), sync_version: version }, now),
  ], {
    entityType: "transaction",
    entityId: id,
    operation: "upsert",
    revision,
    result: (version) => ({ transaction: { ...publicTransaction(planned), sync_version: version } }),
    payload: (version) => ({ transaction: { ...publicTransaction(planned), sync_version: version } }),
    observedServerVersion,
  });
}

async function changeTransactionStatus(db, account, deviceId, operation, digest, targetStatus, observedServerVersion) {
  requireAllowedFields(operation, new Set(["operation_id", "type", "entity_id", "base_revision"]));
  const id = cleanId(operation.entity_id, "账目标识");
  const baseRevision = positiveInteger(operation.base_revision, "基础版本", 1_000_000_000);
  const existing = await first(db, `SELECT * FROM task16_finance_transactions
    WHERE id = ?1 AND user_id = ?2`, [id, account.id]);
  if (!existing) throw new Task16Error("账目不存在", 404, "transaction_not_found");
  if (Number(existing.revision) !== baseRevision) throw new Task16Error("账目已在另一设备更新", 409, "transaction_conflict");
  if (existing.status === targetStatus) {
    return await recordNoopOperation(db, account, deviceId, operation, digest, {
      transaction: publicTransaction(existing), server_version: Number(existing.sync_version || 0), no_change: true,
    });
  }
  const revision = baseRevision + 1;
  const deletedAt = targetStatus === "deleted" ? isoNow() : "";
  const planned = { ...existing, status: targetStatus, revision, deleted_at: deletedAt, updated_at: isoNow() };
  const action = targetStatus === "deleted" ? "transaction_delete" : "transaction_restore";
  const changeOperation = targetStatus === "deleted" ? "delete" : "restore";
  return await commitMutation(db, account, deviceId, operation, digest, (version, now) => [
    db.prepare(`UPDATE task16_finance_transactions SET status = ?2, revision = ?3,
      sync_version = ?4, updated_at = ?5, deleted_at = ?6
      WHERE id = ?1 AND user_id = ?7 AND revision = ?8`)
      .bind(id, targetStatus, revision, version, now, targetStatus === "deleted" ? now : "", account.id, baseRevision),
    auditStatement(db, account, deviceId, action, "transaction", id,
      publicTransaction(existing), { ...publicTransaction(planned), sync_version: version }, now),
  ], {
    entityType: "transaction", entityId: id, operation: changeOperation, revision,
    result: (version) => ({ transaction: { ...publicTransaction(planned), sync_version: version } }),
    payload: (version) => ({ transaction: { ...publicTransaction(planned), sync_version: version } }),
    observedServerVersion,
  });
}

function rawDuplicateCompatible(row, event) {
  return String(row.direction) === event.direction
    && Number(row.amount_minor) === event.amount_minor
    && String(row.currency) === event.currency;
}

async function findRawDuplicate(db, account, deviceId, event) {
  return await first(db, `SELECT * FROM task16_finance_raw_events
    WHERE user_id = ?1 AND (
      (device_id = ?2 AND source_type = ?3 AND source_event_id = ?4)
      OR (?5 != '' AND source_provider = ?6 AND provider_reference = ?5)
    ) ORDER BY created_at LIMIT 1`, [
    account.id, deviceId, event.source_type, event.source_event_id,
    event.provider_reference, event.source_provider,
  ]);
}

async function rawDuplicateResult(db, account, deviceId, operation, digest, event, duplicate) {
  if (!rawDuplicateCompatible(duplicate, event)) {
    throw new Task16Error("相同交易参考号对应了冲突金额或方向", 409, "provider_reference_conflict");
  }
  const relation = await first(db, `SELECT transaction_id FROM task16_finance_transaction_events
    WHERE raw_event_id = ?1 AND relation_status = 'active'`, [duplicate.id]);
  return await recordNoopOperation(db, account, deviceId, operation, digest, {
    raw_event: publicRawEvent(duplicate),
    transaction_id: String(relation?.transaction_id || ""),
    server_version: Number(duplicate.sync_version || 0),
    duplicate: true,
  });
}

async function candidateEvents(db, transactionId) {
  return await all(db, `SELECT event.* FROM task16_finance_raw_events AS event
    JOIN task16_finance_transaction_events AS relation ON relation.raw_event_id = event.id
    WHERE relation.transaction_id = ?1 AND relation.relation_status = 'active'`, [transactionId]);
}

async function selectReconciliationCandidate(db, account, event) {
  if (event.classification !== "accepted") return { candidate: null, score: 0, evidence: [] };
  const candidates = await all(db, `SELECT * FROM task16_finance_transactions
    WHERE user_id = ?1 AND status = 'active' AND direction = ?2 AND currency = ?3 AND amount_minor = ?4
      AND occurred_at_ms BETWEEN ?5 AND ?6
    ORDER BY ABS(occurred_at_ms - ?7), occurred_at_ms DESC LIMIT 25`, [
    account.id, event.direction, event.currency, event.amount_minor,
    event.occurred_at_ms - 180_000, event.occurred_at_ms + 180_000, event.occurred_at_ms,
  ]);
  let best = { candidate: null, score: 0, evidence: [] };
  for (const candidate of candidates) {
    const evidenceRows = await candidateEvents(db, candidate.id);
    const scored = reconciliationScore(event, candidate, evidenceRows);
    if (scored.score > best.score) best = { candidate, ...scored };
  }
  return best;
}

async function ingestRawEvent(db, account, deviceId, operation, digest, observedServerVersion) {
  requireAllowedFields(operation, new Set(["operation_id", "type", "payload"]));
  const event = normalizeRawEvent(operation.payload);
  const duplicate = await findRawDuplicate(db, account, deviceId, event);
  if (duplicate) {
    return await rawDuplicateResult(db, account, deviceId, operation, digest, event, duplicate);
  }

  const rawId = `raw:${crypto.randomUUID()}`;
  const textFingerprint = event.text ? await sha256Hex(event.text) : "";
  const candidate = await selectReconciliationCandidate(db, account, event);
  const shouldLink = Boolean(candidate.candidate && candidate.automatic);
  const transactionId = shouldLink ? candidate.candidate.id
    : event.classification === "accepted" ? `txn:${crypto.randomUUID()}` : "";
  const transaction = shouldLink ? candidate.candidate
    : transactionId ? transactionRowFor(account, deviceId, transactionId, {
      direction: event.direction,
      amount_minor: event.amount_minor,
      currency: event.currency,
      category_id: "",
      merchant: event.merchant,
      counterparty: event.counterparty,
      note: "",
      occurred_at_ms: event.occurred_at_ms,
    }, "automatic") : null;
  if (transaction && !shouldLink && candidate.score >= 0.75) transaction.reconciliation_state = "review";
  const nextRevision = shouldLink ? Number(transaction.revision || 1) + 1 : transaction ? 1 : 0;

  try {
    return await commitMutation(db, account, deviceId, operation, digest, (version, now) => {
    const rawStatement = db.prepare(`INSERT INTO task16_finance_raw_events (
      id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference,
      direction, amount_minor, currency, merchant, counterparty, account_last4,
      occurred_at_ms, captured_at_ms, text_fingerprint_sha256, classification,
      classification_reason, metadata_json, sync_version, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`)
      .bind(
        rawId, account.id, deviceId, event.source_type, event.source_event_id, event.source_provider,
        event.provider_reference, event.direction, event.amount_minor, event.currency, event.merchant,
        event.counterparty, event.account_last4, event.occurred_at_ms, event.captured_at_ms,
        textFingerprint, event.classification, event.classification_reason,
        JSON.stringify(event.metadata), version, now,
      );
    const statements = [rawStatement];
    if (transaction) {
      if (shouldLink) {
        statements.push(db.prepare(`UPDATE task16_finance_transactions SET revision = ?2,
          sync_version = ?3, updated_at = ?4 WHERE id = ?1 AND user_id = ?5 AND revision = ?6`)
          .bind(transaction.id, nextRevision, version, now, account.id, Number(transaction.revision)));
      } else {
        statements.push(transactionInsertStatement(db, transaction, version, now));
      }
      statements.push(db.prepare(`INSERT INTO task16_finance_transaction_events (
        transaction_id, raw_event_id, relation_status, confidence_milli, evidence_json,
        linked_by, created_at, updated_at
      ) VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?6)`)
        .bind(
          transaction.id, rawId, Math.round((shouldLink ? candidate.score : 1) * 1000),
          JSON.stringify(shouldLink ? candidate.evidence : ["new_canonical_transaction"]),
          shouldLink ? "automatic" : "automatic", now,
        ));
    }
    statements.push(auditStatement(db, account, deviceId, "raw_event_ingest", "raw_event", rawId, {}, {
      classification: event.classification,
      classification_reason: event.classification_reason,
      transaction_id: transactionId,
      reconciliation_score: candidate.score,
    }, now));
    return statements;
  }, {
    entityType: "raw_event", entityId: rawId, operation: "ingest", revision: nextRevision,
    result: (version, now) => ({
      raw_event: publicRawEvent({ ...event, id: rawId, device_id: deviceId, text_fingerprint_sha256: textFingerprint, sync_version: version, created_at: now }),
      transaction: transaction ? { ...publicTransaction(transaction), revision: nextRevision, sync_version: version, updated_at: now } : null,
      transaction_id: transactionId,
      reconciliation: { score: candidate.score, evidence: candidate.evidence, automatic: shouldLink },
    }),
    payload: (version, now) => ({
      raw_event: publicRawEvent({ ...event, id: rawId, device_id: deviceId, sync_version: version, created_at: now }),
      transaction: transaction ? { ...publicTransaction(transaction), revision: nextRevision, sync_version: version, updated_at: now } : null,
    }),
    observedServerVersion,
    });
  } catch (error) {
    const racedDuplicate = await findRawDuplicate(db, account, deviceId, event);
    if (racedDuplicate) {
      return await rawDuplicateResult(db, account, deviceId, operation, digest, event, racedDuplicate);
    }
    throw error;
  }
}

function normalizeCategory(value) {
  requireAllowedFields(value, new Set(["name", "applies_to", "color"]));
  const appliesTo = String(value.applies_to || "both").trim().toLowerCase();
  if (!["income", "expense", "both"].includes(appliesTo)) throw new Task16Error("分类适用方向无效", 400, "category_direction_invalid");
  const color = cleanText(value.color, 16, "分类颜色");
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Task16Error("分类颜色无效", 400, "category_color_invalid");
  const name = cleanText(value.name, 80, "分类名称");
  if (!name) throw new Task16Error("分类名称不能为空", 400, "category_name_required");
  return { name, applies_to: appliesTo, color };
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeBudget(value) {
  requireAllowedFields(value, new Set(["category_id", "period_type", "amount_minor", "currency", "starts_on", "ends_on"]));
  const period = String(value.period_type || "").trim().toLowerCase();
  if (!["daily", "monthly", "yearly", "custom"].includes(period)) throw new Task16Error("预算周期无效", 400, "budget_period_invalid");
  const startsOn = cleanText(value.starts_on, 10, "预算开始日期");
  const endsOn = cleanText(value.ends_on, 10, "预算结束日期");
  if (startsOn && !validCalendarDate(startsOn)) throw new Task16Error("预算开始日期无效", 400, "budget_date_invalid");
  if (endsOn && !validCalendarDate(endsOn)) throw new Task16Error("预算结束日期无效", 400, "budget_date_invalid");
  if (period === "custom" && (!startsOn || !endsOn || startsOn > endsOn)) throw new Task16Error("自定义预算日期无效", 400, "budget_date_invalid");
  return {
    category_id: value.category_id ? cleanId(value.category_id, "分类标识") : "",
    period_type: period,
    amount_minor: positiveInteger(value.amount_minor, "预算金额", 10000000000000),
    currency: cleanCurrency(value.currency), starts_on: startsOn, ends_on: endsOn,
  };
}

async function mutateSimpleEntity(db, account, deviceId, operation, digest, kind, observedServerVersion) {
  requireAllowedFields(operation, new Set(["operation_id", "type", "entity_id", "base_revision", "payload"]));
  const table = kind === "category" ? "task16_finance_categories" : "task16_finance_budgets";
  const id = cleanId(operation.entity_id, `${kind === "category" ? "分类" : "预算"}标识`);
  const baseRevision = nonNegativeInteger(operation.base_revision || 0, "基础版本", 1_000_000_000);
  const existing = await first(db, `SELECT * FROM ${table} WHERE id = ?1`, [id]);
  if (existing && existing.user_id !== account.id) throw new Task16Error("记录不存在", 404, "finance_record_not_found");
  if (existing && Number(existing.revision) !== baseRevision) throw new Task16Error("记录已在另一设备更新", 409, "finance_record_conflict");
  if (!existing && baseRevision !== 0) throw new Task16Error("记录版本冲突", 409, "finance_record_conflict");
  const removing = operation.type.endsWith(".delete");
  if (removing && !existing) throw new Task16Error("记录不存在", 404, "finance_record_not_found");
  const normalized = removing ? null : kind === "category" ? normalizeCategory(operation.payload) : normalizeBudget(operation.payload);
  if (kind === "budget" && normalized) await requireOwnedCategory(db, account.id, normalized.category_id);
  const revision = existing ? baseRevision + 1 : 1;
  const status = removing ? "deleted" : "active";
  const planned = { ...(existing || {}), ...(normalized || {}), id, user_id: account.id, status, revision };
  return await commitMutation(db, account, deviceId, operation, digest, (version, now) => {
    let statement;
    if (existing) {
      if (kind === "category") {
        statement = db.prepare(`UPDATE task16_finance_categories SET name = ?2, applies_to = ?3, color = ?4,
          status = ?5, revision = ?6, sync_version = ?7, updated_at = ?8, deleted_at = ?9
          WHERE id = ?1 AND user_id = ?10 AND revision = ?11`)
          .bind(id, planned.name, planned.applies_to, planned.color, status, revision, version, now, removing ? now : "", account.id, baseRevision);
      } else {
        statement = db.prepare(`UPDATE task16_finance_budgets SET category_id = ?2, period_type = ?3,
          amount_minor = ?4, currency = ?5, starts_on = ?6, ends_on = ?7, status = ?8,
          revision = ?9, sync_version = ?10, updated_at = ?11, deleted_at = ?12
          WHERE id = ?1 AND user_id = ?13 AND revision = ?14`)
          .bind(id, planned.category_id, planned.period_type, planned.amount_minor, planned.currency,
            planned.starts_on, planned.ends_on, status, revision, version, now, removing ? now : "", account.id, baseRevision);
      }
    } else if (kind === "category") {
      statement = db.prepare(`INSERT INTO task16_finance_categories (
        id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', 1, ?6, ?7, ?7, '')`)
        .bind(id, account.id, planned.name, planned.applies_to, planned.color, version, now);
    } else {
      statement = db.prepare(`INSERT INTO task16_finance_budgets (
        id, user_id, category_id, period_type, amount_minor, currency, starts_on, ends_on,
        status, revision, sync_version, created_at, updated_at, deleted_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', 1, ?9, ?10, ?10, '')`)
        .bind(id, account.id, planned.category_id, planned.period_type, planned.amount_minor,
          planned.currency, planned.starts_on, planned.ends_on, version, now);
    }
    return [statement, auditStatement(db, account, deviceId, `${kind}_${removing ? "delete" : "upsert"}`, kind, id, existing || {}, planned, now)];
  }, {
    entityType: kind, entityId: id, operation: removing ? "delete" : "upsert", revision,
    result: (version) => ({ [kind]: { ...planned, sync_version: version } }),
    payload: (version) => ({ [kind]: { ...planned, sync_version: version } }),
    observedServerVersion,
  });
}

async function processOperation(db, account, deviceId, operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Task16Error("同步操作无效", 400, "operation_invalid");
  const type = String(operation.type || "").trim();
  if (!OPERATION_TYPES.has(type)) throw new Task16Error("同步操作类型无效", 400, "operation_type_invalid");
  cleanId(operation.operation_id, "操作标识");
  const digest = await operationDigest(operation);
  const replay = receiptResult(await operationReceipt(db, account.id, operation.operation_id), digest);
  if (replay) return replay;
  const observedServerVersion = await ensureUserVersion(db, account.id);
  if (type === "raw_event.ingest") return await ingestRawEvent(db, account, deviceId, operation, digest, observedServerVersion);
  if (type === "transaction.upsert") return await upsertTransaction(db, account, deviceId, operation, digest, observedServerVersion);
  if (type === "transaction.delete") return await changeTransactionStatus(db, account, deviceId, operation, digest, "deleted", observedServerVersion);
  if (type === "transaction.restore") return await changeTransactionStatus(db, account, deviceId, operation, digest, "active", observedServerVersion);
  if (type.startsWith("category.")) return await mutateSimpleEntity(db, account, deviceId, operation, digest, "category", observedServerVersion);
  if (type.startsWith("budget.")) return await mutateSimpleEntity(db, account, deviceId, operation, digest, "budget", observedServerVersion);
  throw new Task16Error("同步操作不存在", 400, "operation_type_invalid");
}

export async function financeBootstrap(db, account) {
  requireFinanceAccess(account);
  const version = await ensureUserVersion(db, account.id);
  const [transactionCount, rawCount, categories, budgets] = await Promise.all([
    first(db, "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND status = 'active'", [account.id]),
    first(db, "SELECT COUNT(*) AS count FROM task16_finance_raw_events WHERE user_id = ?1", [account.id]),
    all(db, `SELECT id, name, applies_to, color, status, revision, sync_version, updated_at, deleted_at
      FROM task16_finance_categories WHERE user_id = ?1 ORDER BY status, name, id`, [account.id]),
    all(db, `SELECT id, category_id, period_type, amount_minor, currency, starts_on, ends_on,
      status, revision, sync_version, updated_at, deleted_at
      FROM task16_finance_budgets WHERE user_id = ?1 ORDER BY status, updated_at DESC, id`, [account.id]),
  ]);
  return {
    schema_version: Number(TASK16_SCHEMA_VERSION), server_version: version,
    finance_access: true, transaction_count: Number(transactionCount?.count || 0),
    raw_event_count: Number(rawCount?.count || 0), categories, budgets,
    sync: { max_operations: MAX_SYNC_OPERATIONS, max_change_page: MAX_CHANGE_PAGE, tombstones: true },
  };
}

export async function financeChanges(db, account, sinceValue, limitValue) {
  requireFinanceAccess(account);
  const since = nonNegativeInteger(sinceValue || 0, "同步版本", Number.MAX_SAFE_INTEGER);
  const limit = Math.min(MAX_CHANGE_PAGE, Math.max(1, Number.parseInt(String(limitValue || MAX_CHANGE_PAGE), 10) || MAX_CHANGE_PAGE));
  const current = await ensureUserVersion(db, account.id);
  if (since > current) {
    throw new Task16Error("同步游标超出当前服务器版本，请从服务器版本重新同步", 409, "sync_cursor_ahead", false, {
      server_version: current,
    });
  }
  const rows = await all(db, `SELECT version, entity_type, entity_id, operation, revision, payload_json, created_at
    FROM task16_finance_changes WHERE user_id = ?1 AND version > ?2 ORDER BY version LIMIT ?3`, [account.id, since, limit]);
  const changesPayload = rows.map((row) => ({
    version: Number(row.version), entity_type: row.entity_type, entity_id: row.entity_id,
    operation: row.operation, revision: Number(row.revision), payload: safeJsonObject(row.payload_json), created_at: row.created_at,
  }));
  const nextSince = changesPayload.length ? changesPayload.at(-1).version : since;
  return { schema_version: Number(TASK16_SCHEMA_VERSION), server_version: current, changes: changesPayload, next_since: nextSince, has_more: nextSince < current };
}

export async function syncFinance(db, account, input) {
  requireFinanceAccess(account);
  requireAllowedFields(input, new Set([
    "schema_version", "device_id", "platform", "device_label", "client_version", "since_version", "operations",
  ]));
  if (Number(input.schema_version) !== Number(TASK16_SCHEMA_VERSION)) throw new Task16Error("财务同步版本不兼容", 409, "schema_version_unsupported");
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (operations.length > MAX_SYNC_OPERATIONS) throw new Task16Error("一次同步的操作过多", 413, "too_many_operations");
  const device = await registerDevice(db, account.id, input);
  const results = [];
  for (const operation of operations) results.push(await processOperation(db, account, device.deviceId, operation));
  const changesPayload = await financeChanges(db, account, input.since_version || 0, MAX_CHANGE_PAGE);
  await run(db, `UPDATE task16_finance_devices SET last_sync_version = ?3, updated_at = ?4
    WHERE user_id = ?1 AND device_id = ?2`, [account.id, device.deviceId, changesPayload.next_since, isoNow()]);
  return { ...changesPayload, operation_results: results, device_id: device.deviceId };
}

export async function listFinanceTransactions(db, account, input = {}) {
  requireFinanceAccess(account);
  const before = input.before ? positiveInteger(input.before, "游标", MAX_CLOCK_MS) : MAX_CLOCK_MS;
  const beforeId = input.before_id ? cleanId(input.before_id, "游标账目标识") : "~~~~~~~~";
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(input.limit || 50), 10) || 50));
  const includeDeleted = String(input.include_deleted || "").toLowerCase() === "true";
  const rows = await all(db, `SELECT * FROM task16_finance_transactions
    WHERE user_id = ?1
      AND (occurred_at_ms < ?2 OR (occurred_at_ms = ?2 AND id < ?3))
      ${includeDeleted ? "" : "AND status = 'active'"}
    ORDER BY occurred_at_ms DESC, id DESC LIMIT ?4`, [account.id, before, beforeId, limit]);
  const last = rows.length === limit ? rows.at(-1) : null;
  return {
    transactions: rows.map(publicTransaction),
    next_before: last ? Number(last.occurred_at_ms) : 0,
    next_before_id: last ? String(last.id) : "",
  };
}

export async function mergeFinanceTransactions(db, account, input) {
  requireFinanceAccess(account);
  requireAllowedFields(input, new Set(["operation_id", "device_id", "target_transaction_id", "source_transaction_ids", "base_revisions"]));
  const operationId = cleanId(input.operation_id, "操作标识");
  const deviceId = cleanId(input.device_id, "设备标识");
  const targetId = cleanId(input.target_transaction_id, "目标账目标识");
  const sourceIds = [...new Set(Array.isArray(input.source_transaction_ids) ? input.source_transaction_ids.map((item) => cleanId(item, "来源账目标识")) : [])]
    .filter((id) => id !== targetId);
  if (!sourceIds.length || sourceIds.length > 20) throw new Task16Error("请选择需要合并的账目", 400, "merge_sources_invalid");
  const base = safeJsonObject(input.base_revisions);
  const operation = { operation_id: operationId, type: "transaction.merge", target_transaction_id: targetId, source_transaction_ids: sourceIds, base_revisions: base };
  const digest = await operationDigest(operation);
  const replay = receiptResult(await operationReceipt(db, account.id, operationId), digest);
  if (replay) return replay;
  const observedServerVersion = await ensureUserVersion(db, account.id);
  const ids = [targetId, ...sourceIds];
  const placeholders = ids.map((_, index) => `?${index + 2}`).join(",");
  const rows = await all(db, `SELECT * FROM task16_finance_transactions WHERE user_id = ?1 AND id IN (${placeholders})`, [account.id, ...ids]);
  if (rows.length !== ids.length) throw new Task16Error("合并账目不存在", 404, "transaction_not_found");
  const byId = new Map(rows.map((row) => [row.id, row]));
  const target = byId.get(targetId);
  if (rows.some((row) => row.status !== "active" || row.direction !== target.direction
      || row.amount_minor !== target.amount_minor || row.currency !== target.currency)) {
    throw new Task16Error("只有金额、币种和方向一致的有效账目可以手动合并", 409, "merge_fields_conflict");
  }
  if (rows.some((row) => Number(base[row.id]) !== Number(row.revision))) throw new Task16Error("账目已在另一设备更新", 409, "transaction_conflict");
  const targetRevision = Number(target.revision) + 1;
  const mergePayload = (version, now) => ({
    target_transaction_id: targetId,
    source_transaction_ids: sourceIds,
    target_transaction: {
      ...publicTransaction(target), reconciliation_state: "confirmed",
      revision: targetRevision, sync_version: version, updated_at: now,
    },
    source_transactions: sourceIds.map((sourceId) => {
      const source = byId.get(sourceId);
      return {
        ...publicTransaction(source), status: "deleted", revision: Number(source.revision) + 1,
        sync_version: version, updated_at: now, deleted_at: now,
      };
    }),
    sync_version: version,
  });
  return await commitMutation(db, account, deviceId, operation, digest, (version, now) => {
    const statements = [
      db.prepare(`UPDATE task16_finance_transactions SET revision = ?2, sync_version = ?3,
        reconciliation_state = 'confirmed', updated_at = ?4
        WHERE id = ?1 AND user_id = ?5 AND revision = ?6`)
        .bind(targetId, targetRevision, version, now, account.id, target.revision),
    ];
    for (const sourceId of sourceIds) {
      const source = byId.get(sourceId);
      statements.push(
        db.prepare(`UPDATE task16_finance_transaction_events SET transaction_id = ?2,
          linked_by = 'user', updated_at = ?3 WHERE transaction_id = ?1 AND relation_status = 'active'`)
          .bind(sourceId, targetId, now),
        db.prepare(`UPDATE task16_finance_transactions SET status = 'deleted', revision = ?2,
          sync_version = ?3, updated_at = ?4, deleted_at = ?4
          WHERE id = ?1 AND user_id = ?5 AND revision = ?6`)
          .bind(sourceId, Number(source.revision) + 1, version, now, account.id, source.revision),
      );
    }
    statements.push(auditStatement(db, account, deviceId, "transaction_merge", "transaction", targetId,
      { target: publicTransaction(target), sources: sourceIds }, { target_id: targetId, sources_deleted: sourceIds }, now));
    return statements;
  }, {
    entityType: "transaction", entityId: targetId, operation: "merge", revision: targetRevision,
    result: mergePayload,
    payload: mergePayload,
    observedServerVersion,
  });
}

export async function splitFinanceTransaction(db, account, input) {
  requireFinanceAccess(account);
  requireAllowedFields(input, new Set([
    "operation_id", "device_id", "transaction_id", "new_transaction_id", "raw_event_ids", "base_revision",
  ]));
  const operationId = cleanId(input.operation_id, "操作标识");
  const deviceId = cleanId(input.device_id, "设备标识");
  const transactionId = cleanId(input.transaction_id, "账目标识");
  const newId = cleanId(input.new_transaction_id, "新账目标识");
  const baseRevision = positiveInteger(input.base_revision, "基础版本", 1_000_000_000);
  const rawIds = [...new Set(Array.isArray(input.raw_event_ids) ? input.raw_event_ids.map((id) => cleanId(id, "原始事件标识")) : [])];
  if (!rawIds.length) throw new Task16Error("请选择需要拆分的原始事件", 400, "split_events_invalid");
  const operation = { operation_id: operationId, type: "transaction.split", transaction_id: transactionId, new_transaction_id: newId, raw_event_ids: rawIds, base_revision: baseRevision };
  const digest = await operationDigest(operation);
  const replay = receiptResult(await operationReceipt(db, account.id, operationId), digest);
  if (replay) return replay;
  const observedServerVersion = await ensureUserVersion(db, account.id);
  const transaction = await first(db, `SELECT * FROM task16_finance_transactions
    WHERE id = ?1 AND user_id = ?2 AND status = 'active'`, [transactionId, account.id]);
  if (!transaction) throw new Task16Error("账目不存在", 404, "transaction_not_found");
  if (Number(transaction.revision) !== baseRevision) throw new Task16Error("账目已在另一设备更新", 409, "transaction_conflict");
  if (await first(db, "SELECT id FROM task16_finance_transactions WHERE id = ?1", [newId])) throw new Task16Error("新账目标识已存在", 409, "identifier_conflict");
  const links = await all(db, `SELECT raw_event_id FROM task16_finance_transaction_events
    WHERE transaction_id = ?1 AND relation_status = 'active'`, [transactionId]);
  const available = new Set(links.map((row) => row.raw_event_id));
  if (rawIds.some((id) => !available.has(id)) || rawIds.length >= available.size) {
    throw new Task16Error("拆分事件必须属于原账目且不能移走全部证据", 409, "split_events_invalid");
  }
  const newTransaction = {
    ...transaction, id: newId, revision: 1, reconciliation_state: "confirmed",
    source_kind: "manual", created_by_device: deviceId,
  };
  const splitPayload = (version, now) => ({
    transaction_id: transactionId,
    new_transaction_id: newId,
    moved_raw_event_ids: rawIds,
    transaction: {
      ...publicTransaction(transaction), revision: baseRevision + 1, sync_version: version, updated_at: now,
    },
    new_transaction: {
      ...publicTransaction({ ...newTransaction, created_at: now, updated_at: now }), sync_version: version,
    },
    sync_version: version,
  });
  return await commitMutation(db, account, deviceId, operation, digest, (version, now) => {
    const placeholders = rawIds.map((_, index) => `?${index + 4}`).join(",");
    return [
      transactionInsertStatement(db, { ...newTransaction, created_at: now }, version, now),
      db.prepare(`UPDATE task16_finance_transactions SET revision = ?2, sync_version = ?3, updated_at = ?4
        WHERE id = ?1 AND user_id = ?5 AND revision = ?6`)
        .bind(transactionId, baseRevision + 1, version, now, account.id, baseRevision),
      db.prepare(`UPDATE task16_finance_transaction_events SET transaction_id = ?2,
        linked_by = 'user', updated_at = ?3 WHERE transaction_id = ?1 AND raw_event_id IN (${placeholders})`)
        .bind(transactionId, newId, now, ...rawIds),
      auditStatement(db, account, deviceId, "transaction_split", "transaction", transactionId,
        { transaction_id: transactionId, raw_event_ids: [...available] }, { new_transaction_id: newId, moved_raw_event_ids: rawIds }, now),
    ];
  }, {
    entityType: "transaction", entityId: transactionId, operation: "split", revision: baseRevision + 1,
    result: splitPayload,
    payload: splitPayload,
    observedServerVersion,
  });
}

export const __testing = {
  all,
  candidateEvents,
  changes,
  commitMutation,
  ensureUserVersion,
  first,
  hasFinanceAccess,
  operationDigest,
  processOperation,
  rawDuplicateResult,
  run,
  selectReconciliationCandidate,
};
