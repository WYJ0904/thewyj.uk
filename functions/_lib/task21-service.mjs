import {sourceUnitStatement,sourceExponent,assertSourceUnit} from './finance-source-units.mjs';
import {applyPaymentReconciliation,reconciledIngestReceipt,recordPaymentUserDecision} from './task21-reconciliation.mjs';
import { sha256Hex } from "./cloudflare-foundation.mjs";
import { publicTransaction } from "./task16-model.mjs";
import { unitStamp, currencyDecisionStamp, hasCurrencyDecisions } from './finance-money-units.mjs';
import {SUPPORTED_CURRENCIES} from '../../js/finance/money.js';
import {explicitReviewCurrency,finishReviewCurrency} from './finance-review-currency.mjs';
import {lifecycleRows,lifecycleBalance,lifecycleReason,lifecycleGuardStatement,RECOVERABLE_LIFECYCLE_REASONS} from './task21-lifecycle.mjs';
import {paymentReviewReason, financeReferenceProvider, financeReplayReference, referenceNamespaceForSource} from "./task21-event-safety.mjs";
import {
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
const OPERATION_TYPES = new Set(["event.ingest", "payment.reconcile"]);

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
    const finance=await first(db,"SELECT value FROM task16_metadata WHERE key='schema_version'");
    return (String(row?.value||'')==='9' && String(finance?.value||'')==='5')
      || (String(row?.value||'')==='8' && String(finance?.value||'')==='4')
      || (String(row?.value||'')==='6' && String(finance?.value||'')==='3');
  } catch (_) {
    return false;
  }
}

function operationReceipt(db, userId, operationId) {
  return first(db, `SELECT payload_digest, result_json FROM task21_notification_sync_operations
    WHERE user_id = ?1 AND operation_id = ?2`, [userId, operationId]);
}

async function operationDigest(operation) {
  const canonical=(value)=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return await sha256Hex(JSON.stringify(canonical(operation)));
}

async function verifiedOperationReplay(db, account, operation, row, digest) {
  if (!row) return null;
  if (row.payload_digest===digest) return replayResult(row,digest);
  // Shipped receipts hashed only top-level keys. Keep them, but never let the
  // old omitted nested payload turn changed money into an accepted replay.
  const legacy=await sha256Hex(JSON.stringify(operation,Object.keys(operation).sort()));
  if (row.payload_digest!==legacy) return replayResult(row,digest);
  const incoming=normalizeNotificationEvent(operation.payload,{legacyUnitless:true});
  const stored=await first(db,`SELECT * FROM task21_notification_events WHERE user_id=?1 AND event_id=?2`,[account.id,incoming.event_id]);
  if (!stored) throw new Task21Error('原操作的事件证据缺失',409,'operation_id_conflict');
  const original=eventFromStoredRow(stored);
  if (Object.keys(incoming).some(key=>incoming[key]!==original[key]))
    throw new Task21Error('旧操作重放的内容不一致',409,'operation_id_conflict');
  return {...replayResult(row,legacy),legacy_receipt_verified:true};
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

async function findFinanceRawByProviderReference(db, userId, sourceProvider, reference) {
  if (!reference) return null;
  const alias=await first(db,`SELECT r.* FROM task21_payment_reference_aliases a JOIN task16_finance_raw_events r ON r.id=a.raw_event_id
    WHERE a.user_id=?1 AND a.reference_provider=?2 AND a.provider_reference=?3`,[userId,sourceProvider,reference]);
  if(alias) return alias;
  return await first(db, `SELECT * FROM task16_finance_raw_events
    WHERE user_id = ?1 AND source_provider = ?2 AND provider_reference = ?3 LIMIT 1`,
  [userId, sourceProvider, reference]);
}

async function financeTransactionIdForRaw(db, rawId) {
  const row = await first(db, `SELECT transaction_id FROM task16_finance_transaction_events
    WHERE raw_event_id = ?1 AND relation_status = 'active'`, [rawId]);
  return String(row?.transaction_id || "");
}

/** Shared with every automatic finance creator, including legacy hint paths.
 * Old wire-v1 callers may omit the new lifecycle fields; that must not make an
 * already corrected operation look like an independent fresh expense. */
async function correctedPaymentIdentity(db,account,event) {
  const ready=await first(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='task21_payment_effective_events'");
  if(!Number(ready?.n))return null;
  const own=await first(db,'SELECT event_id FROM task21_payment_effective_events WHERE user_id=?1 AND event_id=?2',[account.id,event.event_id]);
  if(own)return own;
  if(!event.provider_reference)return null;
  const namespace=event.reference_namespace||referenceNamespaceForSource(event);
  const unknownBank=/^bank/.test(event.payment_channel||'')&&['','bank','sms','notification'].includes(event.source_package||'');
  return first(db,`SELECT o.event_id FROM task21_payment_effective_events o JOIN task21_notification_events e
    ON e.user_id=o.user_id AND e.event_id=o.event_id WHERE o.user_id=?1 AND
    (o.reference_namespace=?2 OR (?6=1 AND o.reference_namespace LIKE 'bank_card:%')) AND o.provider_reference=?3
    AND (?4='' OR o.financial_phase=?4) AND (?5='' OR e.direction=?5) LIMIT 1`,
    [account.id,namespace,event.provider_reference,event.financial_phase||'',event.direction||'',unknownBank?1:0]);
}

/** A corrected event already has a durable source/ledger owner. Legacy hint
 * retries acknowledge that real receipt rather than invent a new hint or run
 * old reference matching against superseded associations. */
export async function correctedPaymentHintReceipt(db,account,event) {
  if(!await correctedPaymentIdentity(db,account,event))return null;
  const receipt=await reconciledIngestReceipt(db,account,event.event_id,{});
  if(receipt.reconciliation_status==='applied'&&receipt.transaction?.status==='active')return {
    ...receipt,event:{event_id:event.event_id},receipt_reconciled:true};
  throw new Task21Error('该核实请求的更正关联仍需权威证据，原请求保留',409,'reconciliation_requires_authority');
}

export async function createAutomaticFinanceTransaction(db, account, deviceId, event) {
  if(await correctedPaymentIdentity(db,account,event)) {
    const receipt=await reconciledIngestReceipt(db,account,event.event_id,{});
    if(receipt.reconciliation_status==='applied'&&receipt.transaction_id)return {transaction_id:receipt.transaction_id,duplicate:true};
    throw new Task21Error('更正后的身份需要精确权威关联，已保留原始证据',409,'reconciliation_requires_authority');
  }
  const providerReference = String(event.provider_reference || "");
  const rawSourceProvider = financeReferenceProvider(event);
  const replayReference=financeReplayReference(event);
  const sameMoney=(row)=>Number(row.amount_minor)===Number(event.amount_minor) && row.currency===event.currency && row.direction===event.direction;
  const existing = await findFinanceRawBySourceEvent(db, account.id, event.event_id);
  if (existing) {
    // A real receipt outranks a stale hint/editor. Return its ID without
    // applying changed money or attaching contradictory new reference proof.
    // Ingest payload changes are rejected at the event/operation boundary.
    if(replayReference && sameMoney(existing)) {
      await run(db,`INSERT OR IGNORE INTO task21_payment_reference_aliases (user_id,reference_provider,provider_reference,raw_event_id,created_at)
        VALUES (?1,?2,?3,?4,?5)`,[account.id,replayReference.provider,replayReference.reference,existing.id,isoNow()]);
      const linked=await findFinanceRawByProviderReference(db,account.id,replayReference.provider,replayReference.reference);
      if(linked?.id!==existing.id) throw new Task21Error('强引用已属于另一笔账目，不能重写历史关联',409,'provider_reference_conflict');
    }
    return { transaction_id: await financeTransactionIdForRaw(db, existing.id), duplicate: true };
  }

  const review=paymentReviewReason(event);
  if (review) throw new Task21Error('该证据仍需核实，不能创建正式账目',409,review);

  // Provider order references can be reused by a later refund. Scope the raw
  // uniqueness key to the money direction while retaining the real reference.
  let referenced = replayReference?await findFinanceRawByProviderReference(db, account.id, replayReference.provider,replayReference.reference):null;
  if (!referenced && providerReference && event.reference_namespace?.startsWith('bank_card:') && !['AUTHORIZED','SETTLED','RELEASED','EXPIRED','REVIEW_REQUIRED'].includes(event.financial_phase)) {
    const old=await all(db,`SELECT r.*,COALESCE(e.source_package,h.source_package,'') AS legacy_package,COALESCE(e.payment_channel,h.payment_channel,'') AS legacy_channel FROM task16_finance_raw_events r
      LEFT JOIN task21_notification_events e ON e.user_id=r.user_id AND e.event_id=r.source_event_id
      LEFT JOIN task21_notification_pending_hints h ON h.user_id=r.user_id AND h.source_event_id=r.source_event_id
      WHERE r.user_id=?1 AND r.provider_reference=?2 AND r.source_provider IN (?3,?4,?5)`,
      [account.id,providerReference,'bank_card:'+event.direction,'bank:'+event.direction,'bank_sms:'+event.direction]);
    const matching=old.filter(r=>r.legacy_package && referenceNamespaceForSource({source_package:r.legacy_package,payment_channel:r.legacy_channel})===event.reference_namespace);
    if(matching.length===1) referenced=matching[0];
    else if(matching.length>1 || old.some(r=>!r.legacy_package || ['sms','bank','notification'].includes(r.legacy_package)))
      throw new Task21Error('旧银行引用缺少唯一发行方证据',409,'legacy_reference_scope_unknown');
    if(referenced && sameMoney(referenced)) await run(db,`INSERT OR IGNORE INTO task21_payment_reference_aliases
      (user_id,reference_provider,provider_reference,raw_event_id,created_at) VALUES (?1,?2,?3,?4,?5)`,
      [account.id,replayReference.provider,replayReference.reference,referenced.id,isoNow()]);
  }
  if (referenced) {
    if (Number(referenced.amount_minor) !== Number(event.amount_minor) || String(referenced.currency)!==String(event.currency) ||
        String(referenced.direction) !== String(event.direction)) {
      throw new Task21Error("同一交易参考号对应不同金额或方向", 409, "provider_reference_conflict");
    }
    return { transaction_id: await financeTransactionIdForRaw(db, referenced.id), duplicate: true };
  }

  const now = isoNow();
  const version = await nextFinanceVersion(db, account.id, now);
  const rawId = `raw:${crypto.randomUUID()}`;
  const transactionId = `txn:notif:${(await sha256Hex(`${account.id}\n${event.event_id}`)).slice(0, 48)}`;
  if(!event.manual_currency_source)await assertSourceUnit(db,account.id,event.event_id,event.currency,event.amount_exponent);
  const unitStatements = await unitStamp(db, transactionId, event.currency, event.currency === 'JPY' ? 0 : undefined);
  const decisionStatements = await currencyDecisionStamp(db,account.id,transactionId,event);
  // This token is a provider-issued reference, never a notification body.
  const occurredAtMs = event.occurred_at_ms || event.received_at_ms;
  const metadata = { capture_version: event.parser_version || "task21", payment_channel: event.payment_channel, source_package:event.source_package||'',
    lifecycle_operation:event.lifecycle_operation||'',lifecycle_revision:event.lifecycle_revision||0,
    financial_phase:event.financial_phase||'',lifecycle_reference:event.lifecycle_reference||'',reference_namespace:event.reference_namespace||'',currency_evidence:event.currency_evidence||'',
    ...(event.currency_review_required ? { currency_review_required: true, currency_decision_source: event.currency_decision_source } : {}),
    ...(event.manual_currency_source ? {manual_currency_source:event.manual_currency_source}: {}) };

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
      rawId, account.id, deviceId, event.event_id, rawSourceProvider, providerReference,
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
          notification_event_ids_json: JSON.stringify([event.event_id]),
          direction: event.direction,
          amount_minor: event.amount_minor,
          currency: event.currency,
          ...(event.currency_review_required ? { currency_review_required: 1, currency_decision_source: event.currency_decision_source } : {}),
          ...(event.manual_currency_source ? {currency_review_required:0,currency_decision_source:'user_confirmed'}:{}),
          ...(event.currency === 'JPY' ? { amount_exponent: 0 } : {}),
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

  let lifecycleGuard=null;
  if(event.financial_phase && event.lifecycle_reference && event.reference_namespace) {
    const rows=await lifecycleRows(db,account.id,event.reference_namespace,event.lifecycle_reference);
    const linkedRefund=event.financial_phase!=='REFUNDED'||event.provider_reference!==event.lifecycle_reference||rows.some(r=>['AUTHORIZED','SETTLED'].includes(r.financial_phase));
    if(linkedRefund)lifecycleGuard=lifecycleGuardStatement(db,account.id,event);
  }
  try {
    await db.batch([
      ...(lifecycleGuard?[lifecycleGuard]:[]),
      rawStatement,
      ...(replayReference?[db.prepare(`INSERT INTO task21_payment_reference_aliases
        (user_id,reference_provider,provider_reference,raw_event_id,created_at) VALUES (?1,?2,?3,?4,?5)`)
        .bind(account.id,replayReference.provider,replayReference.reference,rawId,now)]:[]),
      transactionStatement,
      ...unitStatements,
      ...decisionStatements,
      linkStatement,
      auditStatement,
      db.prepare(`UPDATE task16_finance_user_versions SET server_version = ?2, updated_at = ?3
        WHERE user_id = ?1 AND server_version = ?4`).bind(account.id, version, now, version - 1),
      changeStatement,
      ...(event.financial_phase?[db.prepare(`UPDATE task21_notification_events SET finance_transaction_id=?3 WHERE user_id=?1 AND event_id=?2`)
        .bind(account.id,event.event_id,transactionId)]:[]),
    ]);
    return { transaction_id: transactionId, duplicate: false };
  } catch (error) {
    const raced = await findFinanceRawBySourceEvent(db, account.id, event.event_id);
    if (raced) return { transaction_id: await financeTransactionIdForRaw(db, raced.id), duplicate: true };
    const referencedRace = replayReference?await findFinanceRawByProviderReference(db, account.id, replayReference.provider,replayReference.reference):null;
    if (referencedRace && Number(referencedRace.amount_minor) === Number(event.amount_minor) && String(referencedRace.currency)===String(event.currency) &&
        String(referencedRace.direction) === String(event.direction)) {
      return { transaction_id: await financeTransactionIdForRaw(db, referencedRace.id), duplicate: true };
    }
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
  await linkEvidence(db, account, event, id, false, "pending", now);
  return { id, duplicate: false };
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
    String(event.direction || "unknown"), String(event.provider_reference || ""),
    Number(event.occurred_at_ms || event.received_at_ms || 0), primary ? 1 : 0,
    reconciliationState, now, transactionId || "",
  ]);
}

async function storeEvent(db, account, event, deviceId) {
  const now = isoNow();
  const statement = db.prepare(`INSERT INTO task21_notification_events (
    event_id, user_id, device_id, fingerprint, source_package, source_type, event_type,
    parser_version, parse_status, direction, amount_minor, currency, payment_channel,
    merchant, counterparty, confidence, occurred_at_ms, received_at_ms, candidate_id,
    finance_transaction_id, status, created_at, updated_at, deleted_at,
    provider_reference, lifecycle_identity, financial_phase, lifecycle_reference, reference_namespace, currency_evidence, identity_review_reason, lifecycle_operation, lifecycle_revision
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
    ?17, ?18, '', '', 'active', ?19, ?19, '', ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)`).bind(
    event.event_id, account.id, deviceId, event.fingerprint, event.source_package, event.source_type,
    event.event_type, event.parser_version, event.parse_status, event.direction, event.amount_minor,
    event.currency, event.payment_channel, event.merchant, event.counterparty, event.confidence,
    event.occurred_at_ms, event.received_at_ms, now,
    event.provider_reference || "", event.lifecycle_identity || "",
    event.financial_phase||'',event.lifecycle_reference||'',event.reference_namespace||'',event.currency_evidence||'',event.identity_review_reason||'',event.lifecycle_operation||'',event.lifecycle_revision||0,
  );
  const roles = event.currency_roles ? [db.prepare('INSERT INTO task16_currency_role_evidence(user_id,event_id,roles_json) VALUES(?1,?2,?3)')
    .bind(account.id, event.event_id, JSON.stringify(event.currency_roles))] : [];
  const sourceUnit = await sourceUnitStatement(db,account.id,event.event_id,event.currency,event.amount_exponent);
  const decision = await currencyDecisionStamp(db,account.id,event.event_id,event,'event');
  await db.batch([statement, ...roles, ...(sourceUnit ? [sourceUnit] : []), ...decision]);
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
    ...(Number(row.currency_review_required) === 1 ? { currency_review_required: true, currency_decision_source: row.currency_decision_source } : {}),
    lifecycle_operation:String(row.lifecycle_operation||''),lifecycle_revision:Number(row.lifecycle_revision||0),
    financial_phase:String(row.financial_phase||''),lifecycle_reference:String(row.lifecycle_reference||''),
    reference_namespace:String(row.reference_namespace||''),currency_evidence:String(row.currency_evidence||''),identity_review_reason:String(row.identity_review_reason||''),
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
    provider_reference: String(row.provider_reference || ""),
    lifecycle_identity: String(row.lifecycle_identity || ""),
    merchant: String(row.merchant),
    counterparty: String(row.counterparty),
    confidence: Number(row.confidence),
    occurred_at_ms: Number(row.occurred_at_ms),
    received_at_ms: Number(row.received_at_ms),
  };
}

async function canonicalHintForEvent(db, account, event, now) {
  const alias = await first(db, `SELECT h.* FROM task21_notification_review_aliases a
    JOIN task21_notification_pending_hints h ON h.user_id = a.user_id AND h.id = a.hint_id
    WHERE a.user_id = ?1 AND a.event_id = ?2 LIMIT 1`, [account.id, event.event_id]);
  const exact = alias || await first(db, `SELECT * FROM task21_notification_pending_hints
    WHERE user_id = ?1 AND source_event_id = ?2 LIMIT 1`, [account.id, event.event_id]);
  if (exact) {
    if ((exact.provider_reference && event.provider_reference && exact.provider_reference !== event.provider_reference) ||
        (exact.lifecycle_identity && event.lifecycle_identity && exact.lifecycle_identity !== event.lifecycle_identity)) {
      throw new Task21Error("同一事件带来冲突的交易身份", 409, "review_identity_conflict");
    }
    return exact;
  }
  for (const [column, value] of [["provider_reference", event.provider_reference],
    ["lifecycle_identity", event.lifecycle_identity]]) {
    if (!value) continue;
    const rows = await all(db, `SELECT * FROM task21_notification_pending_hints
      WHERE user_id = ?1 AND source_package = ?2 AND payment_channel = ?3
        AND ${column} = ?4 AND state != 'superseded' LIMIT 10`,
    [account.id, event.source_package, event.payment_channel, value]);
    const matches = rows.filter((row) =>
      (row.amount_minor === null || Number(row.amount_minor) === Number(event.amount_minor)) &&
      (!row.direction || row.direction === "unknown" || row.direction === event.direction));
    if (matches.length > 1) throw new Task21Error("相同强证据关联多条核实记录", 409, "review_alias_ambiguous");
    const row = matches[0];
    if (!row) {
      if (column === "provider_reference" && rows.some((item) =>
        !item.direction || item.direction === "unknown" || item.direction === event.direction)) {
        throw new Task21Error("同一交易参考号对应不同金额或方向", 409, "provider_reference_conflict");
      }
      continue;
    }
    await run(db, `INSERT OR IGNORE INTO task21_notification_review_aliases
      (user_id, event_id, hint_id, created_at) VALUES (?1, ?2, ?3, ?4)`,
    [account.id, event.event_id, row.id, now]);
    const alias = await first(db, `SELECT hint_id FROM task21_notification_review_aliases
      WHERE user_id = ?1 AND event_id = ?2`, [account.id, event.event_id]);
    if (alias?.hint_id !== row.id) throw new Task21Error("事件已关联另一笔核实记录", 409, "review_alias_conflict");
    return row;
  }
  return null;
}

async function attachEventOutcome(db, account, event, deviceId, now) {
  // Once a reference has an attested correction, a previously unseen alias
  // must prove its relation to that operation. Do not let the old raw amount
  // create a second expense or silently reattach an explicitly detached alias.
  {
    const corrected=await correctedPaymentIdentity(db,account,event);
    if(corrected) {
      const own=await reconciledIngestReceipt(db,account,event.event_id,{});
      if(own.reconciliation_status)return {transactionId:own.transaction_id,candidateId:''};
      const reason='reconciliation_alias_requires_authority';
      await run(db,'UPDATE task21_notification_events SET lifecycle_review_reason=?3 WHERE user_id=?1 AND event_id=?2',[account.id,event.event_id,reason]);
      const candidate=await candidateForEvent(db,account,event,now);
      await run(db,'UPDATE task21_notification_events SET candidate_id=?3 WHERE user_id=?1 AND event_id=?2',[account.id,event.event_id,candidate.id]);
      return {transactionId:'',candidateId:candidate.id};
    }
  }
  if (event.financial_phase && event.lifecycle_reference && event.reference_namespace) {
    financeReferenceProvider(event); // Controls require the same issuer proof as charges.
    const rows=await lifecycleRows(db,account.id,event.reference_namespace,event.lifecycle_reference);
    const completionWitness=rows.some(r=>r.event_id!==event.event_id&&r.financial_phase===event.financial_phase&&
      r.provider_reference===event.provider_reference&&Number(r.amount_minor)===Number(event.amount_minor)&&r.currency===event.currency&&
      !r.lifecycle_review_reason&&(r.finance_transaction_id||r.control_accepted));
    const mayRecover=RECOVERABLE_LIFECYCLE_REASONS.has(event.identity_review_reason)&&
      (event.identity_review_reason!=='lifecycle_completion_unproven'||completionWitness);
    const effective={...event,identity_review_reason:mayRecover?'':event.identity_review_reason};
    const reason=effective.identity_review_reason || lifecycleReason(effective,rows);
    await run(db,`UPDATE task21_notification_events SET lifecycle_review_reason=?3 WHERE user_id=?1 AND event_id=?2`,[account.id,event.event_id,reason]);
    const provenRecovery=!reason&&RECOVERABLE_LIFECYCLE_REASONS.has(event.identity_review_reason)&&['SETTLED','REFUNDED'].includes(event.financial_phase);
    event={...effective,lifecycle_review_reason:reason,parse_status:provenRecovery?'parsed':effective.parse_status};
    if(!reason && ['AUTHORIZED','RELEASED','EXPIRED'].includes(event.financial_phase)) {
      const guard=lifecycleGuardStatement(db,account.id,event);
      try {if(guard)await db.batch([guard])} catch(error) {
        event={...event,lifecycle_review_reason:'lifecycle_concurrent_balance_conflict'};
        await run(db,`UPDATE task21_notification_events SET lifecycle_review_reason=?3 WHERE user_id=?1 AND event_id=?2`,[account.id,event.event_id,event.lifecycle_review_reason]);
      }
    }
  }

  const canonicalHint = event.financial_phase || paymentReviewReason(event) ? null : await canonicalHintForEvent(db, account, event, now);
  if (["ignored", "superseded", "expired"].includes(canonicalHint?.state)) {
    return { transactionId: "", candidateId: "" };
  }
  {
    const rejected = await first(db, `SELECT id FROM task21_notification_candidates
      WHERE user_id = ?1 AND event_id IN (?2, ?3) AND status = 'rejected' LIMIT 1`,
    [account.id, canonicalHint?.source_event_id || event.event_id, event.event_id]);
    if (rejected) return { transactionId: "", candidateId: "" };
  }
  const isTransactionLike = event.event_type === "transaction" || event.event_type === "refund";
  // Earlier Android parsers marked complete-money candidates as parsed without
  // settlement evidence. Preserve their fields for review, not new auto-booking.
  const completionAware = new Set(["wechat-4", "alipay-4", "bank-notification-4", "bank-sms-4",
    "wechat-structured-4", "alipay-structured-4", "local-autobook-v2", "verified-on-device"])
    .has(event.parser_version);
  // Parsed means the device observed completion. A complete-money candidate
  // remains reviewable; amount/direction or confidence cannot settle it.
  const autoIngest = isTransactionLike && SUPPORTED_CURRENCIES.includes(event.currency) && completionAware && !paymentReviewReason(event) && event.parse_status === "parsed" && Number(event.amount_minor) > 0
    && ["income", "expense", "refund"].includes(String(event.direction));
  const hasCanonicalReceipt = canonicalHint?.state === "confirmed" && canonicalHint.finance_entry_id;
  if (canonicalHint && (autoIngest || hasCanonicalReceipt)) {
    const canonicalEvent = { ...event, event_id: canonicalHint.source_event_id };
    const transactionId = canonicalHint.state === "confirmed" && canonicalHint.finance_entry_id
      ? String(canonicalHint.finance_entry_id)
      : (await createAutomaticFinanceTransaction(db, account, deviceId, canonicalEvent)).transaction_id;
    if (!transactionId) throw new Task21Error("原交易账本关联尚未就绪", 503, "finance_link_not_ready", true);
    await closePendingHintForBookedEvent(db, account.id, canonicalEvent, transactionId, now);
    await run(db, `UPDATE task21_notification_candidates
      SET status = 'confirmed', finance_transaction_id = ?3, updated_at = ?4
      WHERE user_id = ?1 AND event_id = ?2 AND status = 'pending'`,
    [account.id, canonicalHint.source_event_id, transactionId, now]);
    await linkEvidence(db, account, event, "", true, "confirmed", now, transactionId);
    await run(db, `UPDATE task21_notification_events
      SET finance_transaction_id = ?3, updated_at = ?4
      WHERE user_id = ?1 AND event_id = ?2`, [account.id, event.event_id, transactionId, now]);
    return { transactionId, candidateId: "" };
  }
  const makeCandidate = isTransactionLike && !autoIngest && event.parse_status !== "unparsed" && Number(event.amount_minor)>0 && ['expense','income','refund'].includes(event.direction);
  let transactionId = "";
  let candidateId = "";
  const existingRaw = await findFinanceRawBySourceEvent(db, account.id, event.event_id);
  const existingReceipt = existingRaw ? await financeTransactionIdForRaw(db, existingRaw.id) : "";
  if (autoIngest || existingReceipt) {
    try {
      transactionId = existingReceipt || (await createAutomaticFinanceTransaction(db, account, deviceId, event)).transaction_id;
    } catch(error) {
      if(!event.financial_phase || !/CHECK constraint failed:\s*passed\s*=\s*1/i.test(String(error?.message)))throw error;
      await run(db,`UPDATE task21_notification_events SET lifecycle_review_reason='lifecycle_concurrent_balance_conflict' WHERE user_id=?1 AND event_id=?2`,[account.id,event.event_id]);
      candidateId=(await candidateForEvent(db,account,event,now)).id;
      await run(db,`UPDATE task21_notification_events SET candidate_id=?3 WHERE user_id=?1 AND event_id=?2`,[account.id,event.event_id,candidateId]);
      return {transactionId:'',candidateId};
    }
    await linkEvidence(db, account, event, "", true, "confirmed", now, transactionId);
    await run(db, `UPDATE task21_notification_candidates
      SET status = 'confirmed', finance_transaction_id = ?3, updated_at = ?4
      WHERE user_id = ?1 AND event_id = ?2 AND status = 'pending'`,
    [account.id, event.event_id, transactionId, now]);
  } else if (makeCandidate) {
    candidateId = (await candidateForEvent(db, account, event, now)).id;
  }
  if (transactionId || candidateId) {
    await run(db, `UPDATE task21_notification_events SET candidate_id = ?2, finance_transaction_id = ?3,
      updated_at = ?4 WHERE user_id = ?1 AND event_id = ?5`, [
      account.id, candidateId, transactionId, now, event.event_id,
    ]);
  }
  await closePendingHintForBookedEvent(db, account.id, event, transactionId, now);
  await closeAuthorizationCandidates(db,account,event,transactionId,now);
  return { transactionId, candidateId };
}

async function closeAuthorizationCandidates(db,account,event,transactionId,now) {
  if (!event.financial_phase || !event.lifecycle_reference || !event.reference_namespace) return;
  const rows=await lifecycleRows(db,account.id,event.reference_namespace,event.lifecycle_reference);
  const balance=lifecycleBalance(rows);
  const terminal=balance.closed||balance.remaining_frozen_minor===0;
  const completed=rows.filter(r=>!r.lifecycle_review_reason&&(!r.identity_review_reason||RECOVERABLE_LIFECYCLE_REASONS.has(r.identity_review_reason))&&
    (r.control_accepted||!r.lifecycle_operation)&&(['RELEASED','EXPIRED'].includes(r.financial_phase)||(terminal&&r.financial_phase==='AUTHORIZED')));
  for(const row of completed)await db.batch([
    db.prepare(`INSERT OR IGNORE INTO task21_payment_control_closures SELECT ?1,?2,'system_control_completed',?3
      WHERE EXISTS(SELECT 1 FROM task21_notification_candidates WHERE user_id=?1 AND event_id=?2 AND status='pending')`).bind(account.id,row.event_id,now),
    db.prepare(`UPDATE task21_notification_candidates SET status='rejected',updated_at=?3 WHERE user_id=?1 AND event_id=?2 AND status='pending'`).bind(account.id,row.event_id,now),
  ]);
}

/**
 * Device acceptance (Task 24 P1): a device-side booking must resolve the shared
 * pending hint for the same event.
 *
 * The Android 「填写金额并记账」 flow books through `event.ingest` (the event id
 * is the hint's `source_event_id`) and only flips its *local* candidate. Without
 * this the server hint stayed `pending` forever, so Web /finance kept rendering
 * a 待填写 card for a payment that was already in the ledger - and the same
 * ledger total already counted it. Closing it here keeps Notification and
 * Finance converging for every client, including released APKs that never call
 * the hint confirm API directly.
 *
 * Only a booking (transaction id) closes a hint; candidate-only evidence still
 * needs the user's confirm, so it stays pending. The update is guarded by
 * `state = 'pending'`, which makes concurrent/replayed ingests no-ops.
 */
async function closePendingHintForBookedEvent(db, userId, event, transactionId, now) {
  if (!transactionId) return;
  const direction = ["income", "expense", "refund"].includes(String(event.direction || ""))
    ? String(event.direction)
    : null;
  const amountMinor = Number(event.amount_minor) > 0 ? Number(event.amount_minor) : null;
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'confirmed', finance_entry_id = ?3,
        amount_minor = COALESCE(?4, amount_minor),
        direction = COALESCE(?5, direction),
        merchant = ?6, confirmed_at = ?7, updated_at = ?7
    WHERE user_id = ?1 AND source_event_id = ?2 AND state = 'pending'`, [
    userId, event.event_id, transactionId, amountMinor, direction,
    String(event.merchant || ""), now,
  ]);
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
    if (event.currency_roles) {
      const stored = await first(db, 'SELECT roles_json FROM task16_currency_role_evidence WHERE user_id=?1 AND event_id=?2', [account.id, event.event_id]);
      const sameRoles = ['original', 'settlement', 'fee'].every(name => {
        const old = stored ? JSON.parse(stored.roles_json)[name] : undefined, next = event.currency_roles[name];
        return old?.currency === next?.currency && old?.amount_minor === next?.amount_minor;
      });
      if (!sameRoles) throw new Task21Error('事件身份对应冲突的币种角色',409,'event_identity_conflict');
    }
    if ((Number(existingEvent.amount_minor)>0 && event.amount_minor>0 && Number(existingEvent.amount_minor)!==event.amount_minor) ||
        (existingEvent.direction && event.direction && existingEvent.direction!==event.direction) ||
        existingEvent.currency!==event.currency || existingEvent.source_package!==event.source_package ||
        String(existingEvent.financial_phase||'')!==event.financial_phase ||
        String(existingEvent.lifecycle_operation||'')!==event.lifecycle_operation || Number(existingEvent.lifecycle_revision||0)!==event.lifecycle_revision ||
        String(existingEvent.lifecycle_reference||'')!==event.lifecycle_reference || String(existingEvent.reference_namespace||'')!==event.reference_namespace ||
        (existingEvent.provider_reference && event.provider_reference && existingEvent.provider_reference!==event.provider_reference))
      throw new Task21Error('事件身份对应冲突的财务证据',409,'event_identity_conflict');
    const sourceUnit = await sourceUnitStatement(db,account.id,event.event_id,event.currency,event.amount_exponent);
    if (sourceUnit) await sourceUnit.run();
    const correction=await reconciledIngestReceipt(db,account,event.event_id,{});
    if(correction.reconciliation_status) return {...correction,event:publicNotificationEvent(existingEvent),duplicate:true};
    if (existingEvent.finance_transaction_id) {
      if((event.provider_reference || event.lifecycle_identity) && !paymentReviewReason(event))
        await createAutomaticFinanceTransaction(db,account,deviceId,event);
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
  if(event.financial_phase && event.lifecycle_reference && event.reference_namespace) {
    const related=await lifecycleRows(db,account.id,event.reference_namespace,event.lifecycle_reference);
    // Exact family only, bounded by the existing event set; no polling loop.
    for(const pending of related.filter(r=>RECOVERABLE_LIFECYCLE_REASONS.has(r.lifecycle_review_reason)))
      await attachEventOutcome(db,account,eventFromStoredRow(pending),pending.device_id,now);
  }

  const row = await eventById(db, account, event.event_id);
  return {
    event: publicNotificationEvent(row),
    duplicate: false,
    transaction_id: outcome.transactionId,
    candidate_id: outcome.candidateId,
  };
}

async function processOperation(db, account, deviceId, operation, authority) {
  if (operation?.type==='payment.reconcile') {
    const result=await applyPaymentReconciliation(db,account,deviceId,operation,authority);
    if(result.reconciliation_status==='applied') {
      const effective=result.effective;
      const related=await lifecycleRows(db,account.id,effective.reference_namespace,effective.lifecycle_reference);
      for(const pending of related.filter(r=>RECOVERABLE_LIFECYCLE_REASONS.has(r.lifecycle_review_reason)))
        await attachEventOutcome(db,account,eventFromStoredRow(pending),pending.device_id,isoNow());
    }
    return result;
  }
  requireAllowedFields(operation,new Set(['operation_id','type','payload']));
  const digest = await operationDigest(operation);
  const operationId = cleanId(operation?.operation_id, "操作标识");
  const replay = await verifiedOperationReplay(db,account,operation,await operationReceipt(db, account.id, operationId),digest);
  if (replay) {
    // A candidate may have been explicitly confirmed, or settled by later
    // evidence, after the immutable ingest receipt was recorded. Return the
    // actual ledger link so an offline client can acknowledge its old outbox.
    const eventId = String(replay.event?.event_id || "");
    if (!replay.transaction_id && eventId) {
      const row = await first(db, `SELECT * FROM task21_notification_events
        WHERE user_id = ?1 AND event_id = ?2`, [account.id, eventId]);
      if (row?.finance_transaction_id) return reconciledIngestReceipt(db,account,eventId,{
        ...replay, event: publicNotificationEvent(row), transaction_id: row.finance_transaction_id,
        receipt_reconciled: true,
      });
    }
    return eventId ? reconciledIngestReceipt(db,account,eventId,replay) : replay;
  }
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
    const receipt = await verifiedOperationReplay(db,account,operation,await operationReceipt(db, account.id, operation.operation_id),digest);
    if (receipt) return receipt;
    throw error;
  }
}

export async function ingestNotificationEvents(db, account, input, authority) {
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
    results.push(await processOperation(db, account, deviceId, operation, authority));
  }
  return { schema_version: Number(TASK21_SCHEMA_VERSION), operation_results: results, device_id: deviceId };
}

export async function listNotificationEvents(db, account, input = {}) {
  requireNotificationAccess(account);
  const before = input.before ? positiveInteger(input.before, "游标", MAX_CLOCK_MS) : MAX_CLOCK_MS;
  const beforeId = input.before_id ? cleanId(input.before_id, "游标事件标识") : "~~~~~~~~";
  const limit = Math.min(MAX_EVENT_PAGE, Math.max(1, Number.parseInt(String(input.limit || 50), 10) || 50));
  const includeDeleted = String(input.include_deleted || "").toLowerCase() === "true";
  const rows = await all(db, `SELECT * FROM task21_payment_effective_view
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
  const decisionProjection = await hasCurrencyDecisions(db) ? `,
    (SELECT e.currency_review_required FROM task21_notification_events e WHERE e.user_id=?1 AND e.event_id=task21_notification_candidates.event_id) AS currency_review_required,
    (SELECT e.currency_decision_source FROM task21_notification_events e WHERE e.user_id=?1 AND e.event_id=task21_notification_candidates.event_id) AS currency_decision_source` : '';
  const rows = await all(db, `SELECT *${decisionProjection} FROM task21_notification_candidates
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
  const currencyChoice=explicitReviewCurrency(edits);
  if(currencyChoice&&!await hasCurrencyDecisions(db))throw new Task21Error('币种核实结构需要增量迁移',503,'currency_decision_schema_required',true);
  if (row.status === "confirmed") {
    if(currencyChoice)await finishReviewCurrency(db,account,input.device_id,row.finance_transaction_id,currencyChoice,edits.amount_minor,edits.direction||row.direction);
    return { candidate: publicNotificationCandidate(row), no_change: true };
  }
  if (row.status !== "pending") throw new Task21Error("该候选不能确认", 409, "candidate_status_invalid");
  validateDeviceId(input.device_id);
  const event = await eventById(db, account, row.event_id);
  const mapped=await first(db,'SELECT excluded FROM task21_payment_effective_events WHERE user_id=?1 AND event_id=?2',[account.id,event.event_id]);
  if(mapped)throw new Task21Error('更正或解除关联的证据须按权威合同核实',409,'reconciliation_requires_authority');
  if (event.financial_phase && !['SETTLED','REFUNDED'].includes(event.financial_phase))
    throw new Task21Error('预授权或未完成清算不能记入正式支出',409,'payment_lifecycle_not_settled');
  if (event.financial_phase && (!event.lifecycle_reference || !event.provider_reference))
    throw new Task21Error('清算关联证据不足',409,'lifecycle_reference_missing');
  const currencyReason=['currency_unverified','currency_review_required','currency_evidence_conflict','currency_symbol_ambiguous','currency_amount_unproven'].includes(event.identity_review_reason);
  if (event.identity_review_reason && !event.identity_review_reason.startsWith('identity_unproven_') && !(currencyChoice&&currencyReason))
    throw new Task21Error('请先核对币种和交易关联',409,event.identity_review_reason);
  if(Number(event.lifecycle_revision)>1 || event.lifecycle_review_reason)
    throw new Task21Error('清算余额或版本证据仍需核实',409,event.lifecycle_review_reason||'lifecycle_revision_requires_reconciliation');
  if (event.status !== "active") throw new Task21Error("该候选关联通知已删除", 409, "candidate_status_invalid");
  // A pending candidate may still be missing money fields (amount-unknown
  // hint). The user's edits are the only source that may fill them; an
  // incomplete candidate can never create a zero-amount transaction.
  if (!currencyChoice && row.currency === 'JPY' && await sourceExponent(db,account.id,row.event_id,row.currency) !== 0 &&
      !(edits.amount_exponent === 0 && edits.amount_minor > 0))
    throw new Task21Error('请重新输入并确认日元原币金额',409,'currency_unit_review_required');
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
  await recordPaymentUserDecision(db,account,event.event_id,"candidate_confirm");
  const bookingEvent = {
    event_id: event.event_id,
    fingerprint: event.fingerprint,
    source_package: event.source_package,
    source_type: event.source_type,
    event_type: event.event_type,
    // This is the explicit authenticated manual-confirm action. It is not an
    // automatic inference from a candidate's monetary fields.
    parse_status: "parsed",
    direction,
    amount_minor: amountMinor,
    currency: currencyChoice?.currency||row.currency,
    ...(currencyChoice|| (row.currency==='JPY'?{amount_exponent:0}:{})),
    ...(currencyChoice?{manual_currency_source:{currency:event.currency,amount_minor:Number(event.amount_minor),currency_evidence:event.currency_evidence||'',currency_review_required:Number(event.currency_review_required)===1,currency_decision_source:event.currency_decision_source||''}}:{}),
    merchant: edits.merchant ?? row.merchant,
    counterparty: edits.counterparty ?? row.counterparty,
    payment_channel: row.payment_channel,
    provider_reference: String(event.provider_reference || ""),
    lifecycle_identity: String(event.lifecycle_identity || ""),
    occurred_at_ms: edits.occurred_at_ms || Number(row.occurred_at_ms),
    received_at_ms: event.received_at_ms,
    confidence: row.confidence,
    parser_version: "verified-on-device",
    lifecycle_operation:event.lifecycle_operation||'',lifecycle_revision:event.lifecycle_revision||0,
    financial_phase:event.financial_phase||'',lifecycle_reference:event.lifecycle_reference||'',
    reference_namespace:event.reference_namespace||'',currency_evidence:currencyChoice?'':event.currency_evidence||'',identity_review_reason:'',
  };
  const now = isoNow();
  const alias = await first(db, `SELECT h.finance_entry_id FROM task21_notification_review_aliases a
    JOIN task21_notification_pending_hints h ON h.user_id = a.user_id AND h.id = a.hint_id
    WHERE a.user_id = ?1 AND a.event_id = ?2`, [account.id, event.event_id]);
  let finance;
  if (alias) {
    const outcome = await attachEventOutcome(db, account, bookingEvent, event.device_id, now);
    if (!outcome.transactionId) throw new Task21Error("原核实记录已终结", 409, "candidate_status_invalid");
    finance = { transaction_id: outcome.transactionId, duplicate: Boolean(alias.finance_entry_id) };
  } else {
    finance = await createAutomaticFinanceTransaction(db, account, event.device_id, bookingEvent);
  }
  const editedFields = Object.keys(edits);
  await finishReviewCurrency(db,account,event.device_id,finance.transaction_id,currencyChoice,amountMinor,direction);
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
    db.prepare(`UPDATE task21_notification_pending_hints
      SET state = 'confirmed', finance_entry_id = ?3, confirmed_at = ?4, updated_at = ?4
      WHERE user_id = ?1 AND source_event_id = ?2 AND state = 'pending'`).bind(
      account.id, row.event_id, finance.transaction_id, now,
    ),
  ]);
  const updated = await candidateById(db, account, candidateId);
  return {
    candidate: publicNotificationCandidate(updated),
    transaction_id: finance.transaction_id,
    edited_fields: editedFields,
  };
}

/** Repair pending state only from an existing ledger receipt, never from money alone. */
export async function reconcileLegacyCompleteCandidates(db, account) {
  requireFinanceRecognitionAccess(account);
  await run(db, `UPDATE task21_notification_candidates
    SET status = 'rejected', updated_at = ?2
    WHERE user_id = ?1 AND status = 'pending' AND event_id IN (
      SELECT a.event_id FROM task21_notification_review_aliases a
      JOIN task21_notification_pending_hints h ON h.user_id = a.user_id AND h.id = a.hint_id
      WHERE a.user_id = ?1 AND h.state IN ('ignored', 'superseded', 'expired'))`,
  [account.id, isoNow()]);
  const rows = await all(db, `SELECT c.id, e.event_id, t.id AS transaction_id,
      t.amount_minor, t.direction, t.merchant FROM task21_notification_candidates c
    JOIN task21_notification_events e ON e.user_id = c.user_id AND e.event_id = c.event_id
    JOIN task16_finance_raw_events r ON r.user_id = c.user_id
      AND r.source_type = 'notification' AND r.source_event_id = e.event_id
    JOIN task16_finance_transaction_events l ON l.raw_event_id = r.id AND l.relation_status = 'active'
    JOIN task16_finance_transactions t ON t.user_id = c.user_id AND t.id = l.transaction_id
      AND t.status = 'active'
    LEFT JOIN task21_notification_pending_hints h
      ON h.user_id = c.user_id AND h.source_event_id = c.event_id
    WHERE c.user_id = ?1 AND c.status = 'pending' AND e.status = 'active'
      AND COALESCE(h.state, '') != 'ignored'
    ORDER BY c.created_at, c.id LIMIT 1000`, [account.id]);
  for (const row of rows) {
    const now = isoNow();
    // A list/refresh is not a manual confirm. Reuse the exact account/event
    // receipt without calling any transaction-creation path.
    await db.batch([
      db.prepare(`UPDATE task21_notification_candidates
        SET status = 'confirmed', finance_transaction_id = ?3, updated_at = ?4
        WHERE user_id = ?1 AND id = ?2 AND status = 'pending'`).bind(
        account.id, row.id, row.transaction_id, now),
      db.prepare(`UPDATE task21_notification_evidence
        SET finance_transaction_id = ?3, reconciliation_state = 'confirmed', updated_at = ?4
        WHERE user_id = ?1 AND candidate_id = ?2 AND EXISTS (
          SELECT 1 FROM task21_notification_candidates c WHERE c.user_id = ?1 AND c.id = ?2
            AND c.status = 'confirmed' AND c.finance_transaction_id = ?3)`).bind(
        account.id, row.id, row.transaction_id, now),
      db.prepare(`UPDATE task21_notification_events
        SET finance_transaction_id = ?3, updated_at = ?4
        WHERE user_id = ?1 AND event_id = ?2 AND EXISTS (
          SELECT 1 FROM task21_notification_candidates c WHERE c.user_id = ?1 AND c.event_id = ?2
            AND c.status = 'confirmed' AND c.finance_transaction_id = ?3)`).bind(
        account.id, row.event_id, row.transaction_id, now),
      db.prepare(`UPDATE task21_notification_pending_hints
        SET state = 'confirmed', finance_entry_id = ?3, amount_minor = ?4, direction = ?5,
          merchant = ?6, confirmed_at = ?7, updated_at = ?7
        WHERE user_id = ?1 AND source_event_id = ?2 AND state = 'pending' AND EXISTS (
          SELECT 1 FROM task21_notification_candidates c WHERE c.user_id = ?1 AND c.event_id = ?2
            AND c.status = 'confirmed' AND c.finance_transaction_id = ?3)`).bind(
        account.id, row.event_id, row.transaction_id, row.amount_minor, row.direction, row.merchant, now),
    ]);
  }
  return rows.length;
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
    const allowed = new Set(["amount_minor", "direction", "merchant", "counterparty", "occurred_at_ms", "note", "amount_exponent", "currency"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new Task21Error("修改内容无效", 400, "candidate_edits_invalid");
    }
    const edits = {};
    if(value.currency!==undefined){if(!Number.isSafeInteger(value.amount_minor))throw new Task21Error('请重新输入金额',400,'candidate_edits_invalid');edits.currency=value.currency;}
    if (value.amount_exponent !== undefined) {
      if (value.amount_exponent !== 0 && value.amount_exponent !== 2) throw new Task21Error('金额单位无效',400,'candidate_edits_invalid');
      edits.amount_exponent = value.amount_exponent;
    }
    if (value.amount_minor !== undefined) {
      edits.amount_minor = positiveInteger(value.amount_minor, "金额", 10000000000000);
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
  if (!["pending","rejected"].includes(row.status)) throw new Task21Error("该候选不能拒绝", 409, "candidate_status_invalid");
  await recordPaymentUserDecision(db,account,row.event_id,"candidate_reject");
  if (row.status === "rejected") return { candidate: publicNotificationCandidate(row), no_change: true };
  const now = isoNow();
  await run(db, `UPDATE task21_notification_candidates SET status = 'rejected',
    updated_at = ?2 WHERE user_id = ?1 AND id = ?3`, [account.id, now, candidateId]);
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'ignored', ignored_at = ?3, updated_at = ?3
    WHERE user_id = ?1 AND source_event_id = ?2 AND state = 'pending'`, [
    account.id, row.event_id, now,
  ]);
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
