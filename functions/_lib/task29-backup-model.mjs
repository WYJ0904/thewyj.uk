/**
 * Task29 Backup Data Scope, Schema Validation, P03-P06 Financial/Notification
 * Invariants, Privacy Boundaries, and Injection-Safe CSV Formatting.
 */

import { currencyDigits, CURRENCY_DIGITS } from "../../js/finance/money.js";
import { Task29Error } from "./task29-backup-crypto.mjs";

export const BACKUP_SCOPES = Object.freeze([
  "finance_core",
  "finance_review",
  "notifications_cloud",
]);

export const CONFLICT_POLICIES = Object.freeze([
  "skip_identical_reject_conflict",
  "skip_all_existing",
]);

export const EXPORT_FORMATS = Object.freeze([
  "encrypted",
  "json",
  "csv",
]);

/**
 * Hard privacy boundary: Android local Room stores raw notification text and
 * local media files. Neither cloud exports nor cloud restores may contain or
 * transport raw notification body/title/SMS text fields.
 */
export const FORBIDDEN_RAW_NOTIFICATION_FIELDS = Object.freeze(new Set([
  "raw_text",
  "raw_body",
  "body",
  "text",
  "big_text",
  "bigText",
  "sub_text",
  "subText",
  "ticker",
  "ticker_text",
  "message",
  "messages",
  "extras",
  "notification_body",
  "notification_text",
  "sms_body",
  "ocr_raw",
  "raw_payload",
  "local_media_bytes",
  "verification_code_raw",
  "messaging_style",
  "title",
  "content",
  "summary",
]));

export const PRIVACY_DECLARATION = Object.freeze({
  boundary_version: 1,
  cloud_structured_notifications_included: true,
  android_local_raw_notifications_included: false,
  android_local_media_included: false,
  notice:
    "云端备份仅包含当前账户在服务端合法持有的结构化财务账目、审核候选与云端结构化通知事件摘要；" +
    "Android 设备本地 Room 存储的原始通知正文、短信原文、验证码原文及本地截图媒体从未上传至云端，因此不包含在本次云端备份中。",
});

export const CAPABILITIES_AND_LIMITATIONS = Object.freeze({
  restorable_formats: ["encrypted", "json"],
  non_restorable_formats: ["csv"],
  csv_notice: "CSV 导出仅供表格查看与离线统计分析，不保证复杂关系外键与多表关联状态的无损恢复。",
  p03_p06_limitations: [
    "预授权控制事件（AUTHORIZED / RELEASED / EXPIRED）仅作为控制/状态证据恢复，绝不计入已入账消费总额。",
    "历史未验证最小单位的日元（JPY amount_exponent = null）与待核实币种（¥ 默认推断 currency_review_required = 1）将原样保持待核实状态，不会静默升格为已确认账目。",
    "缺少已验证权威对账依据的高版本修订（lifecycle_revision > 1）受限于 P03 对账门禁，仅按原持久化证据或待核实态恢复。",
    "若加密备份引用了本地暂存文件（R2）且对象已过期清理，相关交易仍可正常恢复，缺失附件引用会显式降级标注而不会阻断账目恢复。",
  ],
});

export const SECTION_ORDER_FOR_EXPORT = Object.freeze([
  "categories",
  "budgets",
  "transactions",
  "raw_events",
  "transaction_events",
  "fx_preferences",
  "fx_rates",
  "fx_references",
  "currency_role_evidence",
  "pending_hints",
  "notification_candidates",
  "payment_user_decisions",
  "notification_events",
  "notification_evidence",
  "notification_review_aliases",
  "payment_reference_aliases",
  "payment_lifecycle_guards",
  "notification_currency_units",
  "payment_reconciliations",
  "payment_effective_events",
  "payment_reconciliation_guards",
  "payment_control_closures",
]);

export const SECTION_TO_SCOPE = Object.freeze({
  categories: "finance_core",
  budgets: "finance_core",
  transactions: "finance_core",
  raw_events: "finance_core",
  transaction_events: "finance_core",
  fx_preferences: "finance_core",
  fx_rates: "finance_core",
  fx_references: "finance_core",
  currency_role_evidence: "finance_core",
  pending_hints: "finance_review",
  notification_candidates: "finance_review",
  payment_user_decisions: "finance_review",
  notification_events: "notifications_cloud",
  notification_evidence: "notifications_cloud",
  notification_review_aliases: "notifications_cloud",
  payment_reference_aliases: "notifications_cloud",
  payment_lifecycle_guards: "notifications_cloud",
  notification_currency_units: "notifications_cloud",
  payment_reconciliations: "notifications_cloud",
  payment_effective_events: "notifications_cloud",
  payment_reconciliation_guards: "notifications_cloud",
  payment_control_closures: "notifications_cloud",
});

export function normalizeScopes(inputScopes) {
  if (!inputScopes || (Array.isArray(inputScopes) && inputScopes.length === 0)) {
    return [...BACKUP_SCOPES];
  }
  if (!Array.isArray(inputScopes)) {
    throw new Task29Error("BACKUP_INVALID_SCOPES", "备份范围参数必须为数组", 400);
  }
  const unique = [];
  const seen = new Set();
  for (const raw of inputScopes) {
    const s = String(raw || "").trim();
    if (!BACKUP_SCOPES.includes(s)) {
      throw new Task29Error("BACKUP_INVALID_SCOPES", `不支持的数据范围：${s}`, 400);
    }
    if (!seen.has(s)) {
      seen.add(s);
      unique.push(s);
    }
  }
  return unique.sort();
}

export function normalizeConflictPolicy(policy) {
  if (!policy) return "skip_identical_reject_conflict";
  const value = String(policy).trim();
  if (!CONFLICT_POLICIES.includes(value)) {
    throw new Task29Error("BACKUP_INVALID_POLICY", `不支持的冲突处理策略：${value}`, 400);
  }
  return value;
}

export function normalizeExportFormat(format) {
  const value = String(format || "encrypted").trim().toLowerCase();
  if (!EXPORT_FORMATS.includes(value)) {
    throw new Task29Error("BACKUP_INVALID_FORMAT", `不支持的导出格式：${value}`, 400);
  }
  return value;
}

/**
 * Recursive check ensuring zero raw notification body/title/text/SMS fields
 * are present anywhere inside cloud notification or financial records.
 */
export function scanForForbiddenRawFields(node, sectionName, recordId, pathPrefix = "") {
  if (!node || typeof node !== "object") return null;
  const stack = [{ value: node, path: pathPrefix }];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const { value, path } = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (value[i] && typeof value[i] === "object") {
          stack.push({ value: value[i], path: `${path}[${i}]` });
        }
      }
      continue;
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_RAW_NOTIFICATION_FIELDS.has(key)) {
        return {
          section: sectionName,
          record_id: String(recordId || ""),
          field: path ? `${path}.${key}` : key,
        };
      }
      const child = value[key];
      if (child && typeof child === "object") {
        stack.push({ value: child, path: path ? `${path}.${key}` : key });
      }
    }
  }
  return null;
}

/**
 * Inspect record sections for forbidden raw fields; also inspects JSON-encoded
 * string fields like `evidence_summary`, `metadata_json`, or `edited_json`.
 */
export function assertPrivacyBoundaryClean(data) {
  for (const sectionName of Object.keys(data || {})) {
    const rows = Array.isArray(data[sectionName]) ? data[sectionName] : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const recordId = row.id || row.event_id || row.operation_id || row.raw_event_id || row.transaction_id || "";
      const hit = scanForForbiddenRawFields(row, sectionName, recordId);
      if (hit) {
        throw new Task29Error(
          "BACKUP_PRIVACY_BOUNDARY_VIOLATION",
          `检测到禁止进入云端备份的原始通知字段：${hit.section}.${hit.field}（本地原始通知正文不允许写入云端）`,
          422,
          false,
          hit,
        );
      }
      for (const jsonCol of ["evidence_summary", "metadata_json", "edited_json"]) {
        if (typeof row[jsonCol] === "string" && row[jsonCol].trim().startsWith("{")) {
          try {
            const parsed = JSON.parse(row[jsonCol]);
            const nestedHit = scanForForbiddenRawFields(parsed, sectionName, recordId, jsonCol);
            if (nestedHit) {
              throw new Task29Error(
                "BACKUP_PRIVACY_BOUNDARY_VIOLATION",
                `检测到嵌套原始通知字段：${nestedHit.section}.${nestedHit.field}`,
                422,
                false,
                nestedHit,
              );
            }
          } catch (err) {
            if (err instanceof Task29Error) throw err;
          }
        }
      }
    }
  }
}

/**
 * Exact integer/BigInt monetary formatter without JS floating-point math.
 */
export function formatMinorExact(amountMinor, currency, amountExponent) {
  if (amountMinor === null || amountMinor === undefined || amountMinor === "") return "";
  if (typeof amountMinor !== "number" && typeof amountMinor !== "bigint") return "";
  const bi = typeof amountMinor === "bigint"
    ? amountMinor
    : (Number.isSafeInteger(amountMinor) ? BigInt(amountMinor) : null);
  if (bi === null) return "";

  const abs = bi < 0n ? -bi : bi;
  const sign = bi < 0n ? "-" : "";

  // Preserve unverified historical JPY (amount_exponent === null) without guessing 0 or 2 decimals.
  if (currency === "JPY" && (amountExponent === null || amountExponent === undefined)) {
    return `${sign}${abs.toString()} (JPY_UNVERIFIED_UNIT)`;
  }

  let digits;
  if (amountExponent === 0 || amountExponent === 2) {
    digits = amountExponent;
  } else if (CURRENCY_DIGITS[currency] !== undefined) {
    digits = CURRENCY_DIGITS[currency];
  } else {
    digits = 2;
  }

  if (digits === 0) {
    return `${sign}${abs.toString()}`;
  }
  const factor = 10n ** BigInt(digits);
  const whole = abs / factor;
  const frac = (abs % factor).toString().padStart(digits, "0");
  return `${sign}${whole.toString()}.${frac}`;
}

/**
 * Neutralize spreadsheet formula injection payloads (=, +, -, @, \t, \r, |)
 * and apply strict RFC 4180 CSV quoting.
 */
export function sanitizeCsvText(rawValue) {
  if (rawValue === null || rawValue === undefined) return "";
  let str = String(rawValue);
  // Neutralize formula prefixes including leading whitespace bypass attempts.
  if (/^[\u0000-\u0020]*[=+\-@\t\r|]/.test(str)) {
    str = `'${str}`;
  }
  return str;
}

export function formatCsvCell(value, { isNumeric = false } = {}) {
  if (value === null || value === undefined) return "";
  if (isNumeric) {
    const str = String(value);
    if (/^-?\d+(?:\.\d+)?$/.test(str)) {
      return str;
    }
  }
  const safe = sanitizeCsvText(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Build a multi-section CSV suitable for human review and spreadsheet analysis.
 * Explicitly declares non-lossless relational status and prevents formula injection
 * and floating-point rounding bugs.
 */
export function buildBackupCsv(envelope) {
  const manifest = envelope.manifest || {};
  const data = envelope.data || {};
  const lines = [];

  lines.push([
    "record_section",
    "record_id",
    "status",
    "direction",
    "currency",
    "amount_minor",
    "signed_amount_minor",
    "amount_exponent",
    "amount_display",
    "occurred_at_iso",
    "occurred_at_ms",
    "merchant",
    "counterparty",
    "category_id",
    "source_kind_or_type",
    "reconciliation_or_phase",
    "currency_review_required",
    "currency_decision_source",
    "linked_or_ref_id",
    "revision",
    "note_or_reason",
    "backup_meta_notice",
  ].map((h) => formatCsvCell(h)).join(","));

  // Informational header row documenting schema, cutoff, privacy boundary, and CSV non-lossless warning.
  lines.push([
    "_export_header",
    envelope.export_id || "",
    "readonly_export",
    "",
    "",
    "",
    "",
    "",
    "",
    envelope.created_at || "",
    "",
    `schema=${envelope.schema_version || ""}`,
    `finance_cutoff_version=${envelope.cutoff?.finance_server_version ?? 0}`,
    "",
    `scopes=${(envelope.scopes || []).join("+")}`,
    `manifest_sha256=${manifest.manifest_sha256 || envelope.manifest_sha256 || ""}`,
    "",
    "",
    `owner_digest=${String(envelope.account_binding?.account_id_sha256 || "").slice(0, 16)}`,
    "1",
    PRIVACY_DECLARATION.notice,
    CAPABILITIES_AND_LIMITATIONS.csv_notice,
  ].map((cell) => formatCsvCell(cell)).join(","));

  const toIso = (ms) => {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "";
    try {
      return new Date(n).toISOString().replace(/\.\d{3}Z$/, "Z");
    } catch (_) {
      return "";
    }
  };

  for (const tx of Array.isArray(data.transactions) ? data.transactions : []) {
    const signedMinor = tx.direction === "expense" ? -Math.abs(Number(tx.amount_minor || 0)) : Number(tx.amount_minor || 0);
    lines.push([
      formatCsvCell("transaction"),
      formatCsvCell(tx.id),
      formatCsvCell(tx.status),
      formatCsvCell(tx.direction),
      formatCsvCell(tx.currency),
      formatCsvCell(tx.amount_minor, { isNumeric: true }),
      formatCsvCell(signedMinor, { isNumeric: true }),
      formatCsvCell(tx.amount_exponent === null || tx.amount_exponent === undefined ? "NULL_UNVERIFIED" : tx.amount_exponent),
      formatCsvCell(formatMinorExact(tx.amount_minor, tx.currency, tx.amount_exponent)),
      formatCsvCell(toIso(tx.occurred_at_ms)),
      formatCsvCell(tx.occurred_at_ms, { isNumeric: true }),
      formatCsvCell(tx.merchant || ""),
      formatCsvCell(tx.counterparty || ""),
      formatCsvCell(tx.category_id || ""),
      formatCsvCell(tx.source_kind || ""),
      formatCsvCell(tx.reconciliation_state || ""),
      formatCsvCell(tx.currency_review_required ? "1" : "0", { isNumeric: true }),
      formatCsvCell(tx.currency_decision_source || ""),
      formatCsvCell(tx.system_superseded_by || tx.import_source_key || ""),
      formatCsvCell(tx.revision || 1, { isNumeric: true }),
      formatCsvCell(tx.note || ""),
      formatCsvCell("analysis_only_use_encrypted_json_to_restore"),
    ].join(","));
  }

  const catNameMap = new Map();
  for (const cat of Array.isArray(data.categories) ? data.categories : []) {
    catNameMap.set(cat.id, cat.name);
    lines.push([
      formatCsvCell("category"),
      formatCsvCell(cat.id),
      formatCsvCell(cat.status),
      formatCsvCell(cat.applies_to),
      "",
      "",
      "",
      "",
      "",
      formatCsvCell(cat.created_at || ""),
      "",
      formatCsvCell(cat.name || ""),
      "",
      formatCsvCell(cat.id),
      "category",
      "",
      "",
      "",
      formatCsvCell(cat.color || ""),
      formatCsvCell(cat.revision || 1, { isNumeric: true }),
      "",
      formatCsvCell("analysis_only"),
    ].join(","));
  }

  for (const b of Array.isArray(data.budgets) ? data.budgets : []) {
    lines.push([
      formatCsvCell("budget"),
      formatCsvCell(b.id),
      formatCsvCell(b.status),
      "expense",
      formatCsvCell(b.currency),
      formatCsvCell(b.amount_minor, { isNumeric: true }),
      formatCsvCell(-Math.abs(Number(b.amount_minor || 0)), { isNumeric: true }),
      formatCsvCell(b.amount_exponent === null || b.amount_exponent === undefined ? "NULL_UNVERIFIED" : b.amount_exponent),
      formatCsvCell(formatMinorExact(b.amount_minor, b.currency, b.amount_exponent)),
      formatCsvCell(b.created_at || ""),
      "",
      formatCsvCell(catNameMap.get(b.category_id) || ""),
      "",
      formatCsvCell(b.category_id || ""),
      formatCsvCell(b.period_type || ""),
      "",
      "",
      "",
      formatCsvCell(`${b.starts_on || ""}..${b.ends_on || ""}`),
      formatCsvCell(b.revision || 1, { isNumeric: true }),
      "",
      formatCsvCell("analysis_only"),
    ].join(","));
  }

  for (const c of Array.isArray(data.notification_candidates) ? data.notification_candidates : []) {
    lines.push([
      formatCsvCell("review_candidate"),
      formatCsvCell(c.id),
      formatCsvCell(c.status),
      formatCsvCell(c.direction),
      formatCsvCell(c.currency),
      formatCsvCell(c.amount_minor, { isNumeric: true }),
      formatCsvCell(c.direction === "expense" ? -Math.abs(Number(c.amount_minor || 0)) : Number(c.amount_minor || 0), { isNumeric: true }),
      formatCsvCell(CURRENCY_DIGITS[c.currency] ?? ""),
      formatCsvCell(formatMinorExact(c.amount_minor, c.currency, CURRENCY_DIGITS[c.currency])),
      formatCsvCell(toIso(c.occurred_at_ms)),
      formatCsvCell(c.occurred_at_ms, { isNumeric: true }),
      formatCsvCell(c.merchant || ""),
      formatCsvCell(c.counterparty || ""),
      "",
      formatCsvCell(c.payment_channel || ""),
      "candidate",
      "",
      "",
      formatCsvCell(c.event_id || c.finance_transaction_id || ""),
      formatCsvCell(c.correction_count || 0, { isNumeric: true }),
      "",
      formatCsvCell("candidate_not_booked_until_confirmed"),
    ].join(","));
  }

  for (const h of Array.isArray(data.pending_hints) ? data.pending_hints : []) {
    lines.push([
      formatCsvCell("pending_hint"),
      formatCsvCell(h.id),
      formatCsvCell(h.state),
      formatCsvCell(h.direction || "unknown"),
      formatCsvCell(h.currency || ""),
      formatCsvCell(h.amount_minor ?? "", { isNumeric: h.amount_minor !== null && h.amount_minor !== undefined }),
      "",
      "",
      formatCsvCell(h.amount_minor ? formatMinorExact(h.amount_minor, h.currency, CURRENCY_DIGITS[h.currency]) : ""),
      formatCsvCell(h.created_at || ""),
      "",
      formatCsvCell(h.merchant || h.app_label || ""),
      "",
      "",
      formatCsvCell(h.source_type || ""),
      formatCsvCell(h.recognition_status || ""),
      formatCsvCell(h.currency_review_required ? "1" : "0", { isNumeric: true }),
      formatCsvCell(h.currency_decision_source || ""),
      formatCsvCell(h.source_event_id || ""),
      "1",
      formatCsvCell(h.evidence_summary || ""),
      formatCsvCell("structured_hint_no_raw_text"),
    ].join(","));
  }

  for (const ev of Array.isArray(data.notification_events) ? data.notification_events : []) {
    lines.push([
      formatCsvCell("cloud_notification_event"),
      formatCsvCell(ev.event_id),
      formatCsvCell(ev.status),
      formatCsvCell(ev.direction || ""),
      formatCsvCell(ev.currency || ""),
      formatCsvCell(ev.amount_minor ?? 0, { isNumeric: true }),
      "",
      "",
      formatCsvCell(ev.amount_minor > 0 ? formatMinorExact(ev.amount_minor, ev.currency, CURRENCY_DIGITS[ev.currency]) : ""),
      formatCsvCell(toIso(ev.occurred_at_ms || ev.received_at_ms)),
      formatCsvCell(ev.occurred_at_ms || ev.received_at_ms || 0, { isNumeric: true }),
      formatCsvCell(ev.merchant || ""),
      formatCsvCell(ev.counterparty || ""),
      "",
      formatCsvCell(ev.source_type || ""),
      formatCsvCell(ev.financial_phase || ev.parse_status || ""),
      formatCsvCell(ev.currency_review_required ? "1" : "0", { isNumeric: true }),
      formatCsvCell(ev.currency_decision_source || ""),
      formatCsvCell(ev.finance_transaction_id || ev.provider_reference || ""),
      formatCsvCell(ev.lifecycle_revision || 0, { isNumeric: true }),
      formatCsvCell(ev.identity_review_reason || ev.lifecycle_review_reason || ""),
      formatCsvCell("cloud_structured_only_no_android_raw_body"),
    ].join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * Validate a single financial/notification record against Task16/Task21/P03-P06
 * schema & monetary safety invariants. Returns `{ ok: true }` or `{ ok: false, reason, detail }`.
 */
export function validateRecordSafetyInvariants(section, row, contextMaps) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, reason: "RECORD_NOT_OBJECT", detail: "记录格式不是合法对象" };
  }

  if (section === "transactions") {
    const id = String(row.id || "");
    if (id.length < 8 || id.length > 80) {
      return { ok: false, reason: "INVALID_RECORD_ID", detail: "交易 ID 长度不合法" };
    }
    if (!["income", "expense", "refund"].includes(row.direction)) {
      return { ok: false, reason: "INVALID_DIRECTION", detail: `无效交易方向：${String(row.direction)}` };
    }
    const currency = String(row.currency || "");
    let expectedDigits;
    try {
      expectedDigits = currencyDigits(currency);
    } catch (_) {
      return { ok: false, reason: "CURRENCY_UNSUPPORTED", detail: `不支持的交易币种：${currency}` };
    }
    if (!Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0) {
      return { ok: false, reason: "INVALID_AMOUNT_MINOR", detail: "交易金额最小单位必须为正安全整数" };
    }
    // Check P05 minor unit rules.
    if (currency === "JPY") {
      if (row.amount_exponent !== 0 && row.amount_exponent !== null && row.amount_exponent !== undefined) {
        return {
          ok: false,
          reason: "CURRENCY_UNIT_MISMATCH",
          detail: `日元(JPY)金额指数无效（${String(row.amount_exponent)}），禁止按 2 位小数写入`,
        };
      }
    } else if (row.amount_exponent !== undefined && row.amount_exponent !== null && row.amount_exponent !== expectedDigits) {
      return {
        ok: false,
        reason: "CURRENCY_UNIT_MISMATCH",
        detail: `币种 ${currency} 金额指数应为 ${expectedDigits}，实际为 ${String(row.amount_exponent)}`,
      };
    }

    // Check unknown/ambiguous ¥ or unverified default currency rules:
    // Must not silently promote an ambiguous ¥ / unverified currency record to confirmed CNY.
    const meta = parseSafeMetadata(row.metadata);
    const linkedRawEvents = contextMaps?.rawEventsByTxId?.get(id) || [];
    const hasAmbiguousSymbolEvidence =
      row.raw_currency_token === "¥" ||
      meta.raw_currency_token === "¥" ||
      linkedRawEvents.some((raw) => {
        const rm = parseSafeMetadata(raw.metadata_json);
        return raw.raw_currency_token === "¥" || rm.raw_currency_token === "¥" || rm.currency_ambiguous === true;
      });
    const verifiedSource = ["explicit_iso", "explicit_symbol", "channel_fixed", "user_confirmed"].includes(
      row.currency_decision_source || row.currency_source || meta.currency_source || "",
    );
    if (hasAmbiguousSymbolEvidence && !verifiedSource && Number(row.currency_review_required || 0) === 0 && row.reconciliation_state === "confirmed") {
      return {
        ok: false,
        reason: "CURRENCY_AMBIGUOUS_UNREVIEWED",
        detail: "检测到未知 ¥ 或来源证据不足的币种记录，禁止静默记为已确认 CNY 账目",
      };
    }
    if (Number(row.currency_review_required || 0) === 1 && row.currency_decision_source !== "account_default" && !verifiedSource) {
      // keep consistent review source if flagged
      return {
        ok: false,
        reason: "CURRENCY_REVIEW_SOURCE_INVALID",
        detail: "待核实币种记录缺少合法 currency_decision_source",
      };
    }

    // Pre-authorization control records must never masquerade as active settled expenses.
    const lifecycleStatus = String(row.lifecycle_status || meta.lifecycle_status || "").trim();
    if (["AUTHORIZED", "RELEASED", "EXPIRED"].includes(lifecycleStatus) && row.status === "active" && row.reconciliation_state === "confirmed") {
      return {
        ok: false,
        reason: "LIFECYCLE_CONTROL_CANNOT_BOOK_LEDGER",
        detail: `预授权控制状态（${lifecycleStatus}）不得作为正式已清算支出写入账本`,
      };
    }
  }

  if (section === "budgets") {
    const currency = String(row.currency || "");
    let expectedDigits;
    try {
      expectedDigits = currencyDigits(currency);
    } catch (_) {
      return { ok: false, reason: "CURRENCY_UNSUPPORTED", detail: `不支持的预算币种：${currency}` };
    }
    if (!Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0) {
      return { ok: false, reason: "INVALID_AMOUNT_MINOR", detail: "预算金额必须为正整数" };
    }
    if (currency === "JPY") {
      if (row.amount_exponent !== 0 && row.amount_exponent !== null && row.amount_exponent !== undefined) {
        return { ok: false, reason: "CURRENCY_UNIT_MISMATCH", detail: "日元预算指数必须为 0 或 NULL" };
      }
    } else if (row.amount_exponent !== undefined && row.amount_exponent !== null && row.amount_exponent !== expectedDigits) {
      return { ok: false, reason: "CURRENCY_UNIT_MISMATCH", detail: `预算币种 ${currency} 指数不匹配` };
    }
  }

  if (section === "notification_events") {
    const currency = String(row.currency || "");
    if (currency !== "XXX" && CURRENCY_DIGITS[currency] === undefined) {
      return { ok: false, reason: "CURRENCY_UNSUPPORTED", detail: `通知事件币种不受支持：${currency}` };
    }
    if (!Number.isSafeInteger(row.amount_minor) || row.amount_minor < 0) {
      return { ok: false, reason: "INVALID_AMOUNT_MINOR", detail: "通知金额不能为负数或非整数" };
    }
    // Control phases must never hold an active linked finance transaction.
    if (["AUTHORIZED", "RELEASED", "EXPIRED"].includes(row.financial_phase) && String(row.finance_transaction_id || "") !== "") {
      return {
        ok: false,
        reason: "LIFECYCLE_CONTROL_CANNOT_BOOK_LEDGER",
        detail: `通知事件 ${row.event_id} 处于控制状态 ${row.financial_phase}，禁止直接关联正式财务交易`,
      };
    }
  }

  return { ok: true };
}

function parseSafeMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}
