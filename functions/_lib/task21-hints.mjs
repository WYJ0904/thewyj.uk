import {
  Task21Error,
  cleanId,
  cleanText,
  isoNow,
  nonNegativeInteger,
  requireAllowedFields,
} from "./task21-model.mjs";
import { createAutomaticFinanceTransaction, reconcileLegacyCompleteCandidates, requireFinanceRecognitionAccess } from "./task21-service.mjs";

/**
 * Task 24.1 P0-3: unified pending hints.
 *
 * A payment the device recognised but cannot complete (missing amount, missing
 * direction, PAYMENT_LIKELY) becomes a *pending hint* here. A hint remains
 * reviewable while any required money field is missing. If an explicit
 * Accessibility/OCR enrichment supplies both amount and direction, the server books it immediately through the
 * canonical automatic-finance path and closes the hint. Android and Web read and
 * write the same row, so a verified payment does not require a second manual tap.
 */

const STATES = new Set(["pending", "confirmed", "ignored", "superseded", "expired"]);
const RECOGNITION_STATUSES = new Set(["CONFIRMED_PAYMENT", "PAYMENT_LIKELY", "INSUFFICIENT_INFORMATION"]);
const SOURCE_TYPES = new Set(["notification", "sms", "bank", "accessibility"]);
const DIRECTIONS = new Set(["income", "expense", "refund", "unknown"]);
const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;
const LIFECYCLE_IDENTITY_PATTERN = /^[0-9a-f]{64}$/;
const RECOGNITION_STATUS_RANK = Object.freeze({
  INSUFFICIENT_INFORMATION: 0,
  PAYMENT_LIKELY: 1,
  CONFIRMED_PAYMENT: 2,
});

async function first(db, sql, values = []) {
  return await db.prepare(sql).bind(...values).first();
}

async function run(db, sql, values = []) {
  return await db.prepare(sql).bind(...values).run();
}

function cleanDirection(value) {
  const direction = String(value ?? "").trim().toLowerCase();
  if (!direction) return null;
  if (!DIRECTIONS.has(direction)) throw new Task21Error("收支方向无效", 400, "hint_direction_invalid");
  return direction === "unknown" ? null : direction;
}

function cleanAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = nonNegativeInteger(value, "金额", 10_000_000_000_000);
  if (amount <= 0) return null;
  return amount;
}

function cleanProviderReference(value) {
  const reference = String(value || "").trim();
  if (reference && !PROVIDER_REFERENCE_PATTERN.test(reference)) {
    throw new Task21Error("交易参考号无效", 400, "provider_reference_invalid");
  }
  return reference;
}

function cleanLifecycleIdentity(value) {
  const identity = String(value || "").trim().toLowerCase();
  if (identity && !LIFECYCLE_IDENTITY_PATTERN.test(identity)) {
    throw new Task21Error("通知生命周期标识无效", 400, "lifecycle_identity_invalid");
  }
  return identity;
}

function moneyCompatible(row, amountMinor, direction) {
  return (row.amount_minor === null || amountMinor === null || Number(row.amount_minor) === amountMinor) &&
    (!row.direction || !direction || row.direction === direction || row.direction === "unknown");
}

async function exactHintForEvent(db, userId, eventId) {
  const alias = await first(db, `SELECT h.* FROM task21_notification_review_aliases a
    JOIN task21_notification_pending_hints h ON h.user_id = a.user_id AND h.id = a.hint_id
    WHERE a.user_id = ?1 AND a.event_id = ?2 LIMIT 1`, [userId, eventId]);
  if (alias) return alias;
  return await first(db, `SELECT * FROM task21_notification_pending_hints
    WHERE user_id = ?1 AND source_event_id = ?2 LIMIT 1`, [userId, eventId]);
}

async function supersedeExactHint(db, account, duplicate, canonical, now) {
  if (duplicate.id === canonical.id) return canonical;
  if (duplicate.state !== "pending" || !moneyCompatible(canonical, cleanAmount(duplicate.amount_minor),
    cleanDirection(duplicate.direction))) {
    throw new Task21Error("旧核实记录含冲突状态或金额", 409, "review_alias_conflict");
  }
  await db.batch([
    db.prepare(`UPDATE task21_notification_pending_hints
      SET state = 'superseded', updated_at = ?3
      WHERE user_id = ?1 AND id = ?2 AND state = 'pending'`).bind(account.id, duplicate.id, now),
    db.prepare(`UPDATE task21_notification_review_aliases SET hint_id = ?3
      WHERE user_id = ?1 AND hint_id = ?2`).bind(account.id, duplicate.id, canonical.id),
    db.prepare(`INSERT OR IGNORE INTO task21_notification_review_aliases
      (user_id, event_id, hint_id, created_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(account.id, duplicate.source_event_id, canonical.id, now),
  ]);
  const alias = await first(db, `SELECT hint_id FROM task21_notification_review_aliases
    WHERE user_id = ?1 AND event_id = ?2`, [account.id, duplicate.source_event_id]);
  if (alias?.hint_id !== canonical.id) throw new Task21Error("旧事件 alias 冲突", 409, "review_alias_conflict");
  return canonical;
}

async function matchingHintByStrongEvidence(db, userId, sourcePackage, paymentChannel,
  providerReference, lifecycleIdentity, amountMinor, direction) {
  if (!providerReference && !lifecycleIdentity) return null;
  for (const [column, value] of [["provider_reference", providerReference], ["lifecycle_identity", lifecycleIdentity]]) {
    if (!value) continue;
    const rows = (await db.prepare(`SELECT * FROM task21_notification_pending_hints
      WHERE user_id = ?1 AND source_package = ?2 AND payment_channel = ?3
        AND ${column} = ?4 AND state != 'superseded' LIMIT 10`)
      .bind(userId, sourcePackage, paymentChannel, value).all()).results || [];
    const matches = rows.filter((row) => moneyCompatible(row, amountMinor, direction));
    if (matches.length > 1) {
      throw new Task21Error("已有多条相同强证据的核实记录，需要先收敛", 409, "review_alias_ambiguous");
    }
    if (matches.length === 1) return matches[0];
    if (column === "provider_reference" && rows.some((row) => !direction || !row.direction || row.direction === direction)) {
      throw new Task21Error("同一交易参考号对应不同金额或方向", 409, "provider_reference_conflict");
    }
  }
  return null;
}

function cleanEvidence(value) {
  if (value === undefined || value === null) return "{}";
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
  }
  const allowed = new Set(["source_type", "confidence", "reasons", "recognised_fields", "parser_version", "occurred_at_ms"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
  }
  const evidence = {};
  if (value.source_type !== undefined) {
    const sourceType = String(value.source_type || "").trim().toLowerCase();
    if (!SOURCE_TYPES.has(sourceType)) throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
    evidence.source_type = sourceType;
  }
  if (value.confidence !== undefined) {
    evidence.confidence = Math.min(1000, nonNegativeInteger(value.confidence, "置信度", 1000));
  }
  if (value.reasons !== undefined) {
    if (!Array.isArray(value.reasons) || value.reasons.length > 12) {
      throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
    }
    evidence.reasons = value.reasons.map((reason) => {
      const code = String(reason || "").trim();
      if (!/^[a-z0-9][a-z0-9_.:-]{0,79}$/u.test(code)) {
        throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
      }
      return code;
    });
  }
  if (value.recognised_fields !== undefined) {
    const allowedFields = new Set(["amount", "direction", "merchant", "counterparty", "provider_reference", "occurred_at"]);
    if (!Array.isArray(value.recognised_fields) || value.recognised_fields.length > allowedFields.size) {
      throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
    }
    evidence.recognised_fields = [...new Set(value.recognised_fields.map((field) => String(field || "").trim()))];
    if (evidence.recognised_fields.some((field) => !allowedFields.has(field))) {
      throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
    }
  }
  if (value.parser_version !== undefined) {
    const parserVersion = String(value.parser_version || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/u.test(parserVersion)) {
      throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
    }
    evidence.parser_version = parserVersion;
  }
  if (value.occurred_at_ms !== undefined) {
    evidence.occurred_at_ms = nonNegativeInteger(value.occurred_at_ms, "发生时间", 10_000_000_000_000);
  }
  return JSON.stringify(evidence);
}

async function autoBookVerifiedHint(db, account, deviceId, row) {
  if (!row || String(row.state || "") !== "pending") return row;
  const amountMinor = cleanAmount(row.amount_minor);
  const direction = cleanDirection(row.direction);
  if (!amountMinor || !direction) return row;

  const evidence = (() => {
    try {
      const parsed = JSON.parse(String(row.evidence_summary || "{}"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  })();
  const occurredAtMs = Number(evidence.occurred_at_ms) > 0
    ? Number(evidence.occurred_at_ms)
    : (Date.parse(String(row.created_at || "")) || Date.now());

  const finance = await createAutomaticFinanceTransaction(db, account, deviceId, {
    event_id: String(row.source_event_id),
    fingerprint: "",
    direction,
    amount_minor: amountMinor,
    currency: String(row.currency || "CNY"),
    merchant: String(row.merchant || ""),
    counterparty: "",
    payment_channel: String(row.payment_channel || ""),
    provider_reference: String(row.provider_reference || ""),
    occurred_at_ms: occurredAtMs,
    received_at_ms: occurredAtMs,
    confidence: Number(row.confidence || 0),
    parser_version: "pending-hint-auto",
  });
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'confirmed', finance_entry_id = ?2, confirmed_at = ?3, updated_at = ?3
    WHERE user_id = ?1 AND id = ?4 AND state = 'pending'`, [
    account.id, finance.transaction_id, now, row.id,
  ]);
  await run(db, `UPDATE task21_notification_candidates
    SET status = 'confirmed', finance_transaction_id = ?3, updated_at = ?4
    WHERE user_id = ?1 AND status = 'pending' AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`, [
    account.id, row.source_event_id, finance.transaction_id, now,
    row.id,
  ]);
  await run(db, `UPDATE task21_notification_events
    SET finance_transaction_id = ?3, updated_at = ?4
    WHERE user_id = ?1 AND finance_transaction_id = '' AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`, [
    account.id, row.source_event_id, finance.transaction_id, now, row.id,
  ]);
  await run(db, `UPDATE task21_notification_evidence
    SET finance_transaction_id = ?3, reconciliation_state = 'confirmed', updated_at = ?4
    WHERE user_id = ?1 AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`, [
    account.id, row.source_event_id, finance.transaction_id, now, row.id,
  ]);
  return await hintById(db, account, row.id);
}

function publicHint(row) {
  const evidence = (() => {
    try {
      const value = JSON.parse(String(row.evidence_summary || "{}"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  })();
  return {
    id: String(row.id || ""),
    source_event_id: String(row.source_event_id || ""),
    device_id: String(row.device_id || ""),
    source_type: String(row.source_type || ""),
    source_package: String(row.source_package || ""),
    app_label: String(row.app_label || ""),
    amount_minor: row.amount_minor === null || row.amount_minor === undefined ? null : Number(row.amount_minor),
    direction: row.direction === null || row.direction === undefined ? null : String(row.direction),
    merchant: String(row.merchant || ""),
    currency: String(row.currency || "CNY"),
    confidence: Number(row.confidence || 0),
    recognition_status: String(row.recognition_status || ""),
    state: String(row.state || ""),
    finance_entry_id: String(row.finance_entry_id || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    confirmed_at: String(row.confirmed_at || ""),
    ignored_at: String(row.ignored_at || ""),
    // This object was allow-list validated on ingest and contains reason codes
    // and parser metadata only. Raw notification text is never accepted.
    evidence,
  };
}

async function hintById(db, account, hintId) {
  const row = await first(db, `SELECT * FROM task21_notification_pending_hints
    WHERE user_id = ?1 AND id = ?2`, [account.id, hintId]);
  if (!row) throw new Task21Error("待确认记录不存在", 404, "notification_hint_not_found");
  return row;
}

/**
 * Real ledger booking behind a notification event id, if any.
 *
 * Two booking paths share the same event identity: `event.ingest` writes
 * `task21_notification_events.finance_transaction_id`, and the raw-event ledger
 * (`task16_finance_raw_events` -> `task16_finance_transaction_events`) records
 * every automatic booking. Checking both keeps the reconciliation correct no
 * matter which client booked first.
 */
async function ledgerBookingForEvent(db, userId, eventId) {
  const eventRow = await first(db, `SELECT finance_transaction_id FROM task21_notification_events
    WHERE user_id = ?1 AND event_id = ?2`, [userId, eventId]);
  let transactionId = String(eventRow?.finance_transaction_id || "");
  if (!transactionId) {
    const rawRow = await first(db, `SELECT link.transaction_id AS transaction_id
      FROM task16_finance_raw_events raw
      JOIN task16_finance_transaction_events link
        ON link.raw_event_id = raw.id AND link.relation_status = 'active'
      WHERE raw.user_id = ?1 AND raw.source_type = 'notification' AND raw.source_event_id = ?2
      ORDER BY raw.created_at LIMIT 1`, [userId, eventId]);
    transactionId = String(rawRow?.transaction_id || "");
  }
  if (!transactionId) return null;
  const ledger = await first(db, `SELECT direction, amount_minor, merchant FROM task16_finance_transactions
    WHERE user_id = ?1 AND id = ?2 AND status = 'active'`, [userId, transactionId]);
  if (!ledger) return null;
  return { transactionId, ledger };
}

async function ledgerBookingForHint(db, account, row) {
  const direct = await ledgerBookingForEvent(db, account.id, row.source_event_id);
  if (direct) return direct;
  const aliases = (await db.prepare(`SELECT event_id FROM task21_notification_review_aliases
    WHERE user_id = ?1 AND hint_id = ?2 LIMIT 100`).bind(account.id, row.id).all()).results || [];
  for (const alias of aliases) {
    const booked = await ledgerBookingForEvent(db, account.id, alias.event_id);
    if (booked) return booked;
  }
  return null;
}

async function ledgerBookingByStrongEvidence(db, account, sourcePackage, paymentChannel,
  providerReference, lifecycleIdentity, amountMinor, direction) {
  for (const [column, value] of [["provider_reference", providerReference],
    ["lifecycle_identity", lifecycleIdentity]]) {
    if (!value) continue;
    const rows = (await db.prepare(`SELECT txn.id AS transaction_id, txn.amount_minor,
        txn.direction, txn.merchant
      FROM task21_notification_events e
      JOIN task16_finance_transactions txn
        ON txn.user_id = e.user_id AND txn.id = e.finance_transaction_id AND txn.status = 'active'
      WHERE e.user_id = ?1 AND e.source_package = ?2 AND e.payment_channel = ?3
        AND e.${column} = ?4 LIMIT 10`)
      .bind(account.id, sourcePackage, paymentChannel, value).all()).results || [];
    const matches = rows.filter((row) =>
      (amountMinor === null || Number(row.amount_minor) === amountMinor) &&
      (!direction || row.direction === direction));
    if (new Set(matches.map((row) => row.transaction_id)).size > 1) {
      throw new Task21Error("强证据已关联多笔账本交易", 409, "review_alias_ambiguous");
    }
    const row = matches[0];
    if (!row) continue;
    return { transactionId: String(row.transaction_id), ledger: row };
  }
  return null;
}

/**
 * Device acceptance (Task 24 P1): a pending hint whose event is already in the
 * ledger can never stay actionable.
 *
 * This is the read-side half of the convergence fix (the write-side half closes
 * hints inside `attachEventOutcome`). It also repairs rows created before that
 * fix, and the ordering where a hint upload arrives *after* the booking of the
 * same event: the shared state must agree with the ledger the moment either the
 * Web page or the Android pull reads it.
 */
async function reconcilePendingHint(db, account, row) {
  const booking = await ledgerBookingForHint(db, account, row);
  if (!booking) return row;
  const amountMinor = Number(booking.ledger.amount_minor) > 0 ? Number(booking.ledger.amount_minor) : null;
  const direction = ["income", "expense", "refund"].includes(String(booking.ledger.direction))
    ? String(booking.ledger.direction)
    : null;
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'confirmed', finance_entry_id = ?3,
        amount_minor = COALESCE(?4, amount_minor),
        direction = COALESCE(?5, direction),
        merchant = ?6, confirmed_at = ?7, updated_at = ?7
    WHERE user_id = ?1 AND id = ?2 AND state = 'pending'`, [
    account.id, row.id, booking.transactionId, amountMinor, direction,
    String(booking.ledger.merchant || ""), now,
  ]);
  await run(db, `UPDATE task21_notification_candidates
    SET status = 'confirmed', finance_transaction_id = ?3, updated_at = ?4
    WHERE user_id = ?1 AND status = 'pending' AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`,
  [account.id, row.source_event_id, booking.transactionId, now, row.id]);
  await run(db, `UPDATE task21_notification_events
    SET finance_transaction_id = ?3, updated_at = ?4
    WHERE user_id = ?1 AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`,
  [account.id, row.source_event_id, booking.transactionId, now, row.id]);
  await run(db, `UPDATE task21_notification_evidence
    SET finance_transaction_id = ?3, reconciliation_state = 'confirmed', updated_at = ?4
    WHERE user_id = ?1 AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`,
  [account.id, row.source_event_id, booking.transactionId, now, row.id]);
  return await hintById(db, account, row.id);
}

async function reconcileConfirmedHint(db, account, row) {
  if (String(row.state || "") !== "confirmed") return row;
  const booking = await ledgerBookingForEvent(db, account.id, String(row.source_event_id || ""));
  if (booking) return row;
  const financeId = String(row.finance_entry_id || "");
  if (!financeId) return row;
  const active = await first(db, `SELECT id FROM task16_finance_transactions
    WHERE user_id = ?1 AND id = ?2 AND status = 'active'`, [account.id, financeId]);
  if (active) return row;
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'ignored', finance_entry_id = '', ignored_at = ?3, updated_at = ?3
    WHERE user_id = ?1 AND id = ?2 AND state = 'confirmed'`, [account.id, row.id, now]);
  return await hintById(db, account, row.id);
}

/**
 * Upsert one or more hints. Identity is (user, source_event_id), so a duplicate
 * ingest can never create a second pending row, and a confirmed/ignored event is
 * never revived as pending (only a real, still-pending row is updated).
 */
export async function upsertNotificationHints(db, account, input, retryDepth = 0) {
  requireFinanceRecognitionAccess(account);
  requireAllowedFields(input, new Set(["device_id", "hints"]));
  const deviceId = cleanId(input.device_id, "设备标识");
  const hints = Array.isArray(input.hints) ? input.hints : [];
  if (hints.length > 50) throw new Task21Error("一次提交的待确认记录过多", 413, "too_many_hints");
  const now = isoNow();
  const results = [];
  for (const raw of hints) {
    requireAllowedFields(raw, new Set([
      "source_event_id", "source_type", "source_package", "app_label",
      "amount_minor", "direction", "merchant", "currency", "confidence",
      "recognition_status", "evidence", "provider_reference", "payment_channel",
      "lifecycle_identity",
    ]));
    const sourceEventId = cleanId(raw.source_event_id, "事件标识");
    const sourceType = String(raw.source_type || "notification").trim().toLowerCase();
    if (!SOURCE_TYPES.has(sourceType)) throw new Task21Error("事件来源类型无效", 400, "hint_source_type_invalid");
    const recognitionStatus = String(raw.recognition_status || "PAYMENT_LIKELY").trim().toUpperCase();
    if (!RECOGNITION_STATUSES.has(recognitionStatus)) {
      throw new Task21Error("识别状态无效", 400, "hint_status_invalid");
    }
    const amountMinor = cleanAmount(raw.amount_minor);
    const direction = cleanDirection(raw.direction);
    const sourcePackage = cleanText(raw.source_package, 160, "来源应用");
    const appLabel = cleanText(raw.app_label, 80, "应用名称");
    const paymentChannel = cleanText(raw.payment_channel, 40, "支付渠道").toLowerCase();
    const providerReference = cleanProviderReference(raw.provider_reference);
    const lifecycleIdentity = cleanLifecycleIdentity(raw.lifecycle_identity);
    const merchant = cleanText(raw.merchant, 160, "商户");
    const currency = cleanText(raw.currency || "CNY", 8, "币种") || "CNY";
    const confidence = Math.min(1000, nonNegativeInteger(raw.confidence || 0, "置信度", 1000));
    const evidence = cleanEvidence(raw.evidence);

    const exact = await exactHintForEvent(db, account.id, sourceEventId);
    const strong = await matchingHintByStrongEvidence(db, account.id, sourcePackage, paymentChannel,
      providerReference, lifecycleIdentity, amountMinor, direction);
    let existing = exact || strong;
    if (exact && strong && exact.id !== strong.id) {
      if ((exact.provider_reference && providerReference && exact.provider_reference !== providerReference) ||
          (exact.lifecycle_identity && lifecycleIdentity && exact.lifecycle_identity !== lifecycleIdentity)) {
        throw new Task21Error("旧事件强证据冲突", 409, "review_identity_conflict");
      }
      existing = await supersedeExactHint(db, account, exact, strong, now);
    }
    if (existing && existing.source_event_id !== sourceEventId) {
      await run(db, `INSERT OR IGNORE INTO task21_notification_review_aliases
        (user_id, event_id, hint_id, created_at) VALUES (?1, ?2, ?3, ?4)`,
      [account.id, sourceEventId, existing.id, now]);
      const alias = await first(db, `SELECT hint_id FROM task21_notification_review_aliases
        WHERE user_id = ?1 AND event_id = ?2`, [account.id, sourceEventId]);
      if (alias?.hint_id !== existing.id) {
        throw new Task21Error("事件已关联另一笔核实记录", 409, "review_alias_conflict");
      }
    }

    // A late device upload must inherit an exact structured candidate's
    // terminal outcome. It cannot reopen a payment the user already rejected
    // or ask for review after that event was booked.
    const candidate = await first(db, `SELECT c.status, c.finance_transaction_id,
        txn.id AS active_transaction_id
      FROM task21_notification_candidates c
      LEFT JOIN task16_finance_transactions txn
        ON txn.user_id = c.user_id AND txn.id = c.finance_transaction_id AND txn.status = 'active'
      WHERE c.user_id = ?1 AND c.event_id = ?2`, [account.id, sourceEventId]);
    const booked = await ledgerBookingForEvent(db, account.id, sourceEventId) ||
      await ledgerBookingByStrongEvidence(db, account, sourcePackage, paymentChannel,
        providerReference, lifecycleIdentity, amountMinor, direction);
    const candidateTerminalState = booked ? "confirmed"
      : candidate && candidate.status !== "pending"
        ? (candidate.active_transaction_id ? "confirmed" : "ignored") : "";
    const candidateTransactionId = String(booked?.transactionId || candidate?.active_transaction_id || "");
    const terminalAmountMinor = Number(booked?.ledger?.amount_minor) > 0
      ? Number(booked.ledger.amount_minor) : amountMinor;
    const terminalDirection = ["income", "expense", "refund"].includes(String(booked?.ledger?.direction))
      ? String(booked.ledger.direction) : direction;
    const terminalMerchant = booked ? String(booked.ledger.merchant || "") : merchant;

    if (existing) {
      if ((existing.provider_reference && providerReference && existing.provider_reference !== providerReference) ||
          (existing.lifecycle_identity && lifecycleIdentity && existing.lifecycle_identity !== lifecycleIdentity)) {
        throw new Task21Error("同一事件带来冲突的交易身份", 409, "review_identity_conflict");
      }
      const previousEvidence = JSON.parse(String(existing.evidence_summary || "{}"));
      const incomingEvidence = JSON.parse(evidence);
      incomingEvidence.reasons = [...new Set([
        ...(Array.isArray(previousEvidence.reasons) ? previousEvidence.reasons : []),
        ...(Array.isArray(incomingEvidence.reasons) ? incomingEvidence.reasons : []),
      ])].slice(0, 12);
      if (!Number(incomingEvidence.occurred_at_ms) && Number(previousEvidence.occurred_at_ms) > 0) {
        incomingEvidence.occurred_at_ms = Number(previousEvidence.occurred_at_ms);
      }
      const mergedEvidence = JSON.stringify(incomingEvidence);
      if (existing.state === "pending" && candidateTerminalState) {
        await run(db, `UPDATE task21_notification_pending_hints
          SET state = ?3, finance_entry_id = ?4,
              amount_minor = COALESCE(?6, amount_minor),
              direction = COALESCE(?7, direction),
              merchant = CASE WHEN ?3 = 'confirmed' THEN ?8 ELSE merchant END,
              confirmed_at = CASE WHEN ?3 = 'confirmed' THEN ?5 ELSE confirmed_at END,
              ignored_at = CASE WHEN ?3 = 'ignored' THEN ?5 ELSE ignored_at END,
              updated_at = ?5
          WHERE user_id = ?1 AND id = ?2 AND state = 'pending'`, [
          account.id, existing.id, candidateTerminalState, candidateTransactionId, now,
          terminalAmountMinor, terminalDirection, terminalMerchant,
        ]);
        results.push({ hint: publicHint(await hintById(db, account, existing.id)), duplicate: true, updated: true });
        continue;
      }
      // A single event can become richer after its initial notification. The
      // common Android path is amount-unknown hint -> explicit Accessibility/OCR
      // verification. Keep the same row/id and fill only fields that were
      // missing; conflicting existing money evidence is never overwritten.
      // Terminal rows stay immutable, so a replay can never revive them.
      if (existing.state === "pending") {
        const previousStatus = String(existing.recognition_status || "INSUFFICIENT_INFORMATION");
        const mergedStatus = (RECOGNITION_STATUS_RANK[recognitionStatus] ?? 0) >
          (RECOGNITION_STATUS_RANK[previousStatus] ?? 0)
          ? recognitionStatus
          : previousStatus;
        const improved =
          (existing.amount_minor === null && amountMinor !== null) ||
          (existing.direction === null && direction !== null) ||
          (!String(existing.merchant || "") && Boolean(merchant)) ||
          (!String(existing.provider_reference || "") && Boolean(providerReference)) ||
          (!String(existing.lifecycle_identity || "") && Boolean(lifecycleIdentity)) ||
          (!String(existing.payment_channel || "") && Boolean(paymentChannel)) ||
          (!String(existing.app_label || "") && Boolean(appLabel)) ||
          (!Number(previousEvidence.occurred_at_ms) && Number(incomingEvidence.occurred_at_ms) > 0) ||
          confidence > Number(existing.confidence || 0) ||
          mergedStatus !== previousStatus;
        if (improved) {
          await run(db, `UPDATE task21_notification_pending_hints
            SET amount_minor = COALESCE(amount_minor, ?3),
                direction = COALESCE(direction, ?4),
                merchant = CASE WHEN merchant = '' AND ?5 != '' THEN ?5 ELSE merchant END,
                confidence = MAX(confidence, ?6),
                 recognition_status = ?7,
                 evidence_summary = CASE WHEN ?6 >= confidence THEN ?8 ELSE evidence_summary END,
                 provider_reference = CASE WHEN provider_reference = '' THEN ?10 ELSE provider_reference END,
                 lifecycle_identity = CASE WHEN lifecycle_identity = '' THEN ?11 ELSE lifecycle_identity END,
                 payment_channel = CASE WHEN payment_channel = '' THEN ?12 ELSE payment_channel END,
                 app_label = CASE WHEN app_label = '' THEN ?13 ELSE app_label END,
                 updated_at = ?9
            WHERE user_id = ?1 AND id = ?2 AND state = 'pending'`, [
            account.id, existing.id, amountMinor, direction, merchant, confidence,
             mergedStatus, mergedEvidence, now, providerReference, lifecycleIdentity, paymentChannel, appLabel,
          ]);
        }
        const updated = await hintById(db, account, existing.id);
        const terminal = await autoBookVerifiedHint(db, account, deviceId, updated);
        results.push({ hint: publicHint(terminal), duplicate: true, updated: improved });
      } else {
        results.push({ hint: publicHint(existing), duplicate: true, updated: false });
      }
      continue;
    }
    const id = `hint:${crypto.randomUUID()}`;
    try {
      await run(db, `INSERT INTO task21_notification_pending_hints (
        id, user_id, source_event_id, device_id, source_type, source_package, app_label,
        evidence_summary, amount_minor, direction, merchant, currency, confidence,
        recognition_status, state, finance_entry_id, created_at, updated_at, confirmed_at, ignored_at,
        provider_reference, lifecycle_identity, payment_channel
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
        ?16, ?17, ?15, ?15, ?18, ?19, ?20, ?21, ?22)`, [
        id, account.id, sourceEventId, deviceId, sourceType, sourcePackage, appLabel,
        evidence, terminalAmountMinor, terminalDirection, terminalMerchant, currency, confidence,
        recognitionStatus, now, candidateTerminalState || "pending", candidateTransactionId,
        candidateTerminalState === "confirmed" ? now : "",
        candidateTerminalState === "ignored" ? now : "",
        providerReference, lifecycleIdentity, paymentChannel,
      ]);
      const created = await hintById(db, account, id);
      const terminal = await autoBookVerifiedHint(db, account, deviceId, created);
      results.push({ hint: publicHint(terminal), duplicate: false });
    } catch (error) {
      // A concurrent ingest of the same event is a duplicate, not a failure.
      const raced = await exactHintForEvent(db, account.id, sourceEventId);
      if (!raced && retryDepth === 0 && (providerReference || lifecycleIdentity)) {
        const retried = await upsertNotificationHints(db, account,
          { device_id: deviceId, hints: [raw] }, 1);
        results.push(retried.results[0]);
        continue;
      }
      if (!raced) throw error;
      const terminal = await autoBookVerifiedHint(db, account, deviceId, raced);
      results.push({ hint: publicHint(terminal), duplicate: true });
    }
  }
  return { hints: results.map((item) => item.hint), results, device_id: deviceId };
}

export async function listNotificationHints(db, account, input = {}) {
  requireFinanceRecognitionAccess(account);
  // Absent state keeps the web default (pending); an explicitly empty state is
  // the Android pull asking for every state so it can close confirmed/ignored
  // local rows. `||` used to collapse both cases to "pending".
  const state = input.state === undefined || input.state === null
    ? "pending"
    : String(input.state).trim().toLowerCase();
  if (state && !STATES.has(state)) throw new Task21Error("待确认状态无效", 400, "hint_state_invalid");
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(input.limit || 100), 10) || 100));
  const rows = await db.prepare(`SELECT * FROM task21_notification_pending_hints
    WHERE user_id = ?1 AND (?2 = '' OR state = ?2)
    ORDER BY created_at DESC LIMIT ?3`).bind(account.id, state, limit).all();
  const results = [];
  for (const row of rows?.results || []) {
    if (row.state === "pending") {
      results.push(await reconcilePendingHint(db, account, row));
    } else if (row.state === "confirmed") {
      results.push(await reconcileConfirmedHint(db, account, row));
    } else {
      results.push(row);
    }
  }
  return {
    hints: results.map(publicHint),
    pending_count: results.filter((row) => row.state === "pending").length,
  };
}

/**
 * One account-scoped observation of every actionable notification payment.
 *
 * The Android notification hub used to compare its local Room count with only
 * `task21_notification_candidates`, while /finance also renders pending hints.
 * That produced numbers such as "local 5 / cloud 2" beside a 12-row Finance
 * list. The response contains the exact canonical review identity plus safe
 * structured display fields; no notification title/body is accepted or returned.
 */
export async function notificationPendingSummary(db, account, input = {}) {
  requireFinanceRecognitionAccess(account);
  // A refresh is also the bounded repair point for candidates created solely
  // by the former confidence gate. Each booking retains its source event id.
  await reconcileLegacyCompleteCandidates(db, account);
  const aliasedPending = (await db.prepare(`SELECT DISTINCT h.* FROM task21_notification_pending_hints h
    JOIN task21_notification_review_aliases a ON a.user_id = h.user_id AND a.hint_id = h.id
    WHERE h.user_id = ?1 AND h.state = 'pending'`).bind(account.id).all()).results || [];
  for (const hint of aliasedPending) await reconcilePendingHint(db, account, hint);
  const requested = String(input.event_ids || "").split(",").filter(Boolean);
  if (requested.length > 200) throw new Task21Error("一次查询事件过多", 413, "too_many_events");
  const eventIds = [...new Set(requested.map((id) => cleanId(id, "事件标识")))];
  // One SQLite statement observes identities, terminal outcomes and counts
  // after the legacy reconciliation above.
  const result = await db.prepare(`WITH booking AS (
    SELECT raw.user_id, raw.source_event_id, MIN(link.transaction_id) AS transaction_id
    FROM task16_finance_raw_events raw
    JOIN task16_finance_transaction_events link
      ON link.raw_event_id = raw.id AND link.relation_status = 'active'
    JOIN task16_finance_transactions txn
      ON txn.user_id = raw.user_id AND txn.id = link.transaction_id AND txn.status = 'active'
    WHERE raw.user_id = ?1 AND raw.source_type = 'notification' AND raw.source_event_id != ''
    GROUP BY raw.user_id, raw.source_event_id
  ), review AS (
    SELECT 'hint' AS kind, h.id, h.source_event_id AS event_id, h.device_id,
      CASE
        WHEN COALESCE(et.id, b.transaction_id, ht.id, '') != '' THEN 'confirmed'
        WHEN h.state = 'confirmed' AND h.finance_entry_id != '' THEN 'ignored'
        ELSE h.state
      END AS state,
      COALESCE(et.id, b.transaction_id, ht.id, '') AS transaction_id,
      h.updated_at, json_insert(COALESCE((SELECT json_group_array(a.event_id)
        FROM task21_notification_review_aliases a
        WHERE a.user_id = h.user_id AND a.hint_id = h.id), json_array()),
        '$[#]', h.source_event_id) AS event_ids,
      h.source_package, COALESCE(NULLIF(h.app_label, ''),
        CASE h.source_package WHEN 'com.tencent.mm' THEN '微信'
          WHEN 'com.eg.android.AlipayGphone' THEN '支付宝' ELSE h.source_package END) AS app_label,
      h.amount_minor,
      CASE WHEN h.direction IN ('income', 'expense', 'refund') THEN h.direction ELSE NULL END AS direction,
      h.merchant,
      COALESCE(NULLIF(CAST(json_extract(h.evidence_summary, '$.occurred_at_ms') AS INTEGER), 0),
        CAST(strftime('%s', h.created_at) AS INTEGER) * 1000, 0) AS occurred_at_ms,
      h.confidence, COALESCE(json_extract(h.evidence_summary, '$.reasons'), '[]') AS recognition_reasons
    FROM task21_notification_pending_hints h
    LEFT JOIN task21_notification_events e ON e.user_id = h.user_id AND e.event_id = h.source_event_id
    LEFT JOIN task16_finance_transactions et
      ON et.user_id = h.user_id AND et.id = e.finance_transaction_id AND et.status = 'active'
    LEFT JOIN booking b ON b.user_id = h.user_id AND b.source_event_id = h.source_event_id
    LEFT JOIN task16_finance_transactions ht
      ON ht.user_id = h.user_id AND ht.id = h.finance_entry_id AND ht.status = 'active'
    WHERE h.user_id = ?1 AND NOT EXISTS (
      SELECT 1 FROM task21_notification_review_aliases a
      WHERE a.user_id = h.user_id AND a.event_id = h.source_event_id AND a.hint_id != h.id
    ) AND NOT EXISTS (
      SELECT 1 FROM task21_notification_candidates c
      WHERE c.user_id = h.user_id AND (c.event_id = h.source_event_id OR EXISTS (
        SELECT 1 FROM task21_notification_events ev
        WHERE ev.user_id = h.user_id AND ev.event_id = h.source_event_id AND ev.candidate_id = c.id
      ))
    )
    UNION ALL
    SELECT 'candidate', c.id, c.event_id, COALESCE(e.device_id, ''),
      CASE
        WHEN COALESCE(ct.id, et.id, cb.transaction_id, ht.id, '') != '' THEN 'confirmed'
        WHEN c.status = 'confirmed' AND c.finance_transaction_id != '' THEN 'rejected'
        WHEN h.state = 'ignored' THEN 'rejected'
        ELSE c.status
      END,
      COALESCE(ct.id, et.id, cb.transaction_id, ht.id, ''), c.updated_at,
      COALESCE((SELECT json_group_array(ev.event_id) FROM task21_notification_events ev
        WHERE ev.user_id = c.user_id AND ev.candidate_id = c.id), json_array(c.event_id)),
      COALESCE(e.source_package, '') AS source_package,
      CASE e.source_package WHEN 'com.tencent.mm' THEN '微信'
        WHEN 'com.eg.android.AlipayGphone' THEN '支付宝'
        ELSE COALESCE(e.source_package, '') END AS app_label,
      c.amount_minor, c.direction, c.merchant, c.occurred_at_ms, c.confidence,
      '[]' AS recognition_reasons
    FROM task21_notification_candidates c
    LEFT JOIN task21_notification_events e ON e.user_id = c.user_id AND e.event_id = c.event_id
    LEFT JOIN task16_finance_transactions ct
      ON ct.user_id = c.user_id AND ct.id = c.finance_transaction_id AND ct.status = 'active'
    LEFT JOIN task16_finance_transactions et
      ON et.user_id = c.user_id AND et.id = e.finance_transaction_id AND et.status = 'active'
    LEFT JOIN booking cb ON cb.user_id = c.user_id AND cb.source_event_id = c.event_id
    LEFT JOIN task21_notification_pending_hints h ON h.user_id = c.user_id AND h.source_event_id = c.event_id
    LEFT JOIN task16_finance_transactions ht
      ON ht.user_id = c.user_id AND ht.id = h.finance_entry_id AND ht.status = 'active'
    WHERE c.user_id = ?1
  ), visible AS (
    SELECT * FROM review WHERE state = 'pending' OR EXISTS (
      SELECT 1 FROM json_each(review.event_ids) ids WHERE ids.value IN (SELECT value FROM json_each(?2))
    )
  ) SELECT *,
    SUM(CASE WHEN state = 'pending' AND kind = 'hint' THEN 1 ELSE 0 END) OVER () AS hint_count,
    SUM(CASE WHEN state = 'pending' AND kind = 'candidate' THEN 1 ELSE 0 END) OVER () AS candidate_count,
    COUNT(*) OVER () AS record_count
  FROM visible ORDER BY updated_at DESC, id DESC`).bind(account.id, JSON.stringify(eventIds)).all();
  const rows = result?.results || [];
  const records = rows.map((row) => ({
    kind: String(row.kind), id: String(row.id), event_id: String(row.event_id),
    event_ids: [...new Set([String(row.event_id), ...JSON.parse(row.event_ids || "[]")])],
    device_id: String(row.device_id), state: String(row.state),
    transaction_id: String(row.transaction_id || ""), updated_at: String(row.updated_at),
    source_package: String(row.source_package || ""), app_label: String(row.app_label || ""),
    amount_minor: Number(row.amount_minor) > 0 ? Number(row.amount_minor) : null,
    direction: ["income", "expense", "refund"].includes(String(row.direction)) ? String(row.direction) : null,
    merchant: String(row.merchant || ""),
    occurred_at_ms: Number(row.occurred_at_ms || 0),
    confidence: Number(row.confidence || 0),
    recognition_reasons: JSON.parse(String(row.recognition_reasons || "[]")),
  }));
  const hintCount = Number(rows[0]?.hint_count || 0);
  const candidateCount = Number(rows[0]?.candidate_count || 0);
  return {
    observed_at: isoNow(),
    total_count: hintCount + candidateCount,
    hint_count: hintCount,
    candidate_count: candidateCount,
    truncated: Number(rows[0]?.record_count || 0) > rows.length,
    records,
  };
}

/**
 * Confirm a hint: requires the user's amount + direction, then books through the
 * same automatic transaction path as every other payment (one ledger, one id).
 */
export async function confirmNotificationHint(db, account, input) {
  requireFinanceRecognitionAccess(account);
  requireAllowedFields(input, new Set(["hint_id", "device_id", "edits"]));
  const hintId = cleanId(input.hint_id, "待确认标识");
  const row = await hintById(db, account, hintId);
  const edits = input.edits && typeof input.edits === "object" && !Array.isArray(input.edits) ? input.edits : {};
  requireAllowedFields(edits, new Set(["amount_minor", "direction", "merchant", "occurred_at_ms"]));
  if (row.state === "confirmed") return { hint: publicHint(row), no_change: true, transaction_id: row.finance_entry_id };
  if (row.state !== "pending") throw new Task21Error("该待确认记录不能确认", 409, "hint_state_invalid");
  const deviceId = cleanId(input.device_id, "设备标识");
  const amountMinor = cleanAmount(edits.amount_minor) || cleanAmount(row.amount_minor);
  const direction = cleanDirection(edits.direction) || cleanDirection(row.direction);
  if (!amountMinor) throw new Task21Error("请先填写金额后再确认", 400, "hint_amount_required");
  if (!direction) throw new Task21Error("请先选择收支方向后再确认", 400, "hint_direction_required");
  const merchant = cleanText(edits.merchant ?? row.merchant, 160, "商户");
  const storedEvidence = JSON.parse(String(row.evidence_summary || "{}"));
  const occurredAtMs = cleanAmount(edits.occurred_at_ms) ||
    cleanAmount(storedEvidence.occurred_at_ms) || Date.parse(row.created_at) || Date.now();

  const finance = await createAutomaticFinanceTransaction(db, account, deviceId, {
    event_id: row.source_event_id,
    fingerprint: "",
    direction,
    amount_minor: amountMinor,
    currency: row.currency,
    merchant,
    counterparty: "",
    payment_channel: String(row.payment_channel || ""),
    provider_reference: String(row.provider_reference || ""),
    occurred_at_ms: occurredAtMs,
    received_at_ms: occurredAtMs,
    confidence: Number(row.confidence || 0),
    parser_version: "pending-hint",
  });
  // A device may have booked this exact event between the page render and the
  // click. The booking is deduplicated by event identity, so the stored hint
  // must mirror the *existing* ledger entry rather than the just-typed values.
  let bookedAmountMinor = amountMinor;
  let bookedDirection = direction;
  let bookedMerchant = merchant;
  if (finance.duplicate) {
    const ledger = await first(db, `SELECT direction, amount_minor, merchant FROM task16_finance_transactions
      WHERE user_id = ?1 AND id = ?2 AND status = 'active'`, [account.id, finance.transaction_id]);
    if (ledger) {
      bookedAmountMinor = Number(ledger.amount_minor) > 0 ? Number(ledger.amount_minor) : amountMinor;
      bookedDirection = ["income", "expense", "refund"].includes(String(ledger.direction))
        ? String(ledger.direction)
        : direction;
      bookedMerchant = String(ledger.merchant ?? merchant);
    }
  }
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'confirmed', finance_entry_id = ?2, amount_minor = ?3, direction = ?4,
        merchant = ?5, confirmed_at = ?6, updated_at = ?6
    WHERE user_id = ?1 AND id = ?7`, [
    account.id, finance.transaction_id, bookedAmountMinor, bookedDirection, bookedMerchant, now, hintId,
  ]);
  await run(db, `UPDATE task21_notification_candidates
    SET status = 'confirmed', finance_transaction_id = ?3, updated_at = ?4
    WHERE user_id = ?1 AND status = 'pending' AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`, [
    account.id, row.source_event_id, finance.transaction_id, now, row.id,
  ]);
  await run(db, `UPDATE task21_notification_events
    SET finance_transaction_id = ?3, updated_at = ?4
    WHERE user_id = ?1 AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`, [
    account.id, row.source_event_id, finance.transaction_id, now, row.id,
  ]);
  await run(db, `UPDATE task21_notification_evidence
    SET finance_transaction_id = ?3, reconciliation_state = 'confirmed', updated_at = ?4
    WHERE user_id = ?1 AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?5))`, [
    account.id, row.source_event_id, finance.transaction_id, now, row.id,
  ]);
  return {
    hint: publicHint(await hintById(db, account, hintId)),
    transaction_id: finance.transaction_id,
    duplicate_transaction: Boolean(finance.duplicate),
  };
}

export async function ignoreNotificationHint(db, account, input) {
  requireFinanceRecognitionAccess(account);
  requireAllowedFields(input, new Set(["hint_id"]));
  const hintId = cleanId(input.hint_id, "待确认标识");
  const row = await hintById(db, account, hintId);
  if (row.state === "ignored") return { hint: publicHint(row), no_change: true };
  if (row.state !== "pending") throw new Task21Error("该待确认记录不能忽略", 409, "hint_state_invalid");
  const booked = await ledgerBookingForHint(db, account, row);
  if (booked) {
    return { hint: publicHint(await reconcilePendingHint(db, account, row)), no_change: true };
  }
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'ignored', ignored_at = ?3, updated_at = ?3
    WHERE user_id = ?1 AND id = ?2`, [account.id, hintId, now]);
  await run(db, `UPDATE task21_notification_candidates
    SET status = 'rejected', updated_at = ?3
    WHERE user_id = ?1 AND status = 'pending' AND (event_id = ?2 OR event_id IN (
      SELECT event_id FROM task21_notification_review_aliases WHERE user_id = ?1 AND hint_id = ?4))`, [
    account.id, row.source_event_id, now, row.id,
  ]);
  return { hint: publicHint(await hintById(db, account, hintId)) };
}

export const __testing = { publicHint, cleanAmount, cleanDirection, cleanEvidence };
