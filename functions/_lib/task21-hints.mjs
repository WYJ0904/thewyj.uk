import {
  Task21Error,
  cleanId,
  cleanText,
  isoNow,
  nonNegativeInteger,
  requireAllowedFields,
} from "./task21-model.mjs";
import { createAutomaticFinanceTransaction, requireFinanceRecognitionAccess } from "./task21-service.mjs";

/**
 * Task 24.1 P0-3: unified pending hints.
 *
 * A payment the device recognised but cannot complete (missing amount, missing
 * direction, PAYMENT_LIKELY) becomes a *pending hint* here. Hints never create a
 * Finance entry on their own: confirmation always requires a real amount and
 * direction, and then reuses the same automatic-booking path as every other
 * payment. Android and Web read and write the same rows through this API, so the
 * notification page and /finance can never disagree about what is pending.
 */

const STATES = new Set(["pending", "confirmed", "ignored", "superseded", "expired"]);
const RECOGNITION_STATUSES = new Set(["CONFIRMED_PAYMENT", "PAYMENT_LIKELY", "INSUFFICIENT_INFORMATION"]);
const SOURCE_TYPES = new Set(["notification", "sms", "bank", "accessibility"]);
const DIRECTIONS = new Set(["income", "expense", "refund", "unknown"]);

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

function cleanEvidence(value) {
  if (value === undefined || value === null) return "{}";
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
  }
  const allowed = new Set(["source_type", "confidence", "reasons", "recognised_fields", "parser_version", "occurred_at_ms"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Task21Error("识别证据无效", 400, "hint_evidence_invalid");
  }
  return JSON.stringify(value);
}

function publicHint(row) {
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
  };
}

async function hintById(db, account, hintId) {
  const row = await first(db, `SELECT * FROM task21_notification_pending_hints
    WHERE user_id = ?1 AND id = ?2`, [account.id, hintId]);
  if (!row) throw new Task21Error("待确认记录不存在", 404, "notification_hint_not_found");
  return row;
}

/**
 * Upsert one or more hints. Identity is (user, source_event_id), so a duplicate
 * ingest can never create a second pending row, and a confirmed/ignored event is
 * never revived as pending (only a real, still-pending row is updated).
 */
export async function upsertNotificationHints(db, account, input) {
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
      "recognition_status", "evidence",
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
    const merchant = cleanText(raw.merchant, 160, "商户");
    const currency = cleanText(raw.currency || "CNY", 8, "币种") || "CNY";
    const confidence = Math.min(1000, nonNegativeInteger(raw.confidence || 0, "置信度", 1000));
    const evidence = cleanEvidence(raw.evidence);

    const existing = await first(db, `SELECT * FROM task21_notification_pending_hints
      WHERE user_id = ?1 AND source_event_id = ?2`, [account.id, sourceEventId]);
    if (existing) {
      results.push({ hint: publicHint(existing), duplicate: true });
      continue;
    }
    const id = `hint:${crypto.randomUUID()}`;
    try {
      await run(db, `INSERT INTO task21_notification_pending_hints (
        id, user_id, source_event_id, device_id, source_type, source_package, app_label,
        evidence_summary, amount_minor, direction, merchant, currency, confidence,
        recognition_status, state, finance_entry_id, created_at, updated_at, confirmed_at, ignored_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'pending', '', ?15, ?15, '', '')`, [
        id, account.id, sourceEventId, deviceId, sourceType, sourcePackage, appLabel,
        evidence, amountMinor, direction, merchant, currency, confidence,
        recognitionStatus, now,
      ]);
      results.push({ hint: publicHint(await hintById(db, account, id)), duplicate: false });
    } catch (error) {
      // A concurrent ingest of the same event is a duplicate, not a failure.
      const raced = await first(db, `SELECT * FROM task21_notification_pending_hints
        WHERE user_id = ?1 AND source_event_id = ?2`, [account.id, sourceEventId]);
      if (!raced) throw error;
      results.push({ hint: publicHint(raced), duplicate: true });
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
  return {
    hints: (rows?.results || []).map(publicHint),
    pending_count: (rows?.results || []).filter((row) => row.state === "pending").length,
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
  const direction = cleanDirection(edits.direction) || row.direction;
  if (!amountMinor) throw new Task21Error("请先填写金额后再确认", 400, "hint_amount_required");
  if (!direction) throw new Task21Error("请先选择收支方向后再确认", 400, "hint_direction_required");
  const merchant = cleanText(edits.merchant ?? row.merchant, 160, "商户");
  const occurredAtMs = cleanAmount(edits.occurred_at_ms) || Date.parse(row.created_at) || Date.now();

  const finance = await createAutomaticFinanceTransaction(db, account, deviceId, {
    event_id: row.source_event_id,
    fingerprint: "",
    direction,
    amount_minor: amountMinor,
    currency: row.currency,
    merchant,
    counterparty: "",
    payment_channel: "",
    occurred_at_ms: occurredAtMs,
    received_at_ms: occurredAtMs,
    confidence: Number(row.confidence || 0),
    parser_version: "pending-hint",
  });
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'confirmed', finance_entry_id = ?2, amount_minor = ?3, direction = ?4,
        merchant = ?5, confirmed_at = ?6, updated_at = ?6
    WHERE user_id = ?1 AND id = ?7`, [
    account.id, finance.transaction_id, amountMinor, direction, merchant, now, hintId,
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
  const now = isoNow();
  await run(db, `UPDATE task21_notification_pending_hints
    SET state = 'ignored', ignored_at = ?3, updated_at = ?3
    WHERE user_id = ?1 AND id = ?2`, [account.id, hintId, now]);
  return { hint: publicHint(await hintById(db, account, hintId)) };
}

export const __testing = { publicHint, cleanAmount, cleanDirection, cleanEvidence };
