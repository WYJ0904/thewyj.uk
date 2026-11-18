/**
 * Task29 Backup Export, Read-Only Precheck Simulation, and Idempotent
 * Transactional Restore Service with Step-Up Auth and Compensation Rollback.
 */

import { hasTask27, eventStatements } from "./task27-store.mjs";
import { authorize, identity as task27Identity } from "./task27-security.mjs";
import { challengeRow } from "./task27-auth.mjs";
import { currencyDigits } from "../../js/finance/money.js";
import {
  BACKUP_CONTAINER_VERSION,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  Task29Error,
  accountBindingDigest,
  canonicalJson,
  computeSectionManifest,
  decryptBackupPackage,
  encryptBackupPackage,
  sha256Hex,
  verifyManifestIntegrity,
} from "./task29-backup-crypto.mjs";
import {
  CAPABILITIES_AND_LIMITATIONS,
  PRIVACY_DECLARATION,
  SECTION_TO_SCOPE,
  assertPrivacyBoundaryClean,
  buildBackupCsv,
  normalizeConflictPolicy,
  normalizeExportFormat,
  normalizeScopes,
  validateRecordSafetyInvariants,
} from "./task29-backup-model.mjs";

const JOB_TTL_MS = 30 * 60 * 1000;
const RESTORE_BATCH_SIZE = 35;

export function nowIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function requireDb(db) {
  if (!db?.prepare) {
    throw new Task29Error("BACKUP_DB_UNAVAILABLE", "备份数据库服务暂时不可用", 503, true);
  }
  return db;
}

export async function ensureTask29Schema(db) {
  if (!db?.prepare) return false;
  try {
    const row = await db.prepare("SELECT value FROM task29_metadata WHERE key = 'schema_version'").first();
    return row?.value === "1";
  } catch (_) {
    return false;
  }
}

async function safeAll(db, sql, args = []) {
  const res = await db.prepare(sql).bind(...args).all();
  return res?.results || [];
}

async function safeFirst(db, sql, args = []) {
  return await db.prepare(sql).bind(...args).first();
}

function stableRecordProjection(section, row) {
  // Ignore volatile sync/version metadata only if desired? No—compare canonical business fields!
  const ignored = new Set(["sync_version", "updated_at", "created_at"]);
  const copy = {};
  for (const key of Object.keys(row || {}).sort()) {
    if (ignored.has(key)) continue;
    copy[key] = row[key];
  }
  return canonicalJson({ section, row: copy });
}

function tableNameForSection(section) {
  const map = {
    categories: "task16_finance_categories",
    budgets: "task16_finance_budgets",
    transactions: "task16_finance_transactions",
    raw_events: "task16_finance_raw_events",
    transaction_events: "task16_finance_transaction_events",
    fx_preferences: "task16_currency_preferences",
    fx_rates: "task16_fx_rates",
    fx_references: "task16_fx_references",
    currency_role_evidence: "task16_currency_role_evidence",
    pending_hints: "task21_notification_pending_hints",
    notification_candidates: "task21_notification_candidates",
    payment_user_decisions: "task21_payment_user_decisions",
    notification_events: "task21_notification_events",
    notification_evidence: "task21_notification_evidence",
    notification_review_aliases: "task21_notification_review_aliases",
    payment_reference_aliases: "task21_payment_reference_aliases",
    payment_lifecycle_guards: "task21_payment_lifecycle_guards",
    notification_currency_units: "task21_currency_units",
    payment_reconciliations: "task21_payment_reconciliations",
    payment_effective_events: "task21_payment_effective_events",
    payment_reconciliation_guards: "task21_payment_reconciliation_guards",
    payment_control_closures: "task21_payment_control_closures",
  };
  return map[section];
}

function recordPrimaryId(section, row) {
  switch (section) {
    case "notification_events":
      return String(row.event_id || "");
    case "transaction_events":
      return `${row.transaction_id}:${row.raw_event_id}`;
    case "fx_preferences":
      return String(row.user_id || "");
    case "fx_references":
      return `${row.transaction_id}:${row.transaction_revision}:${row.display_currency}`;
    case "currency_role_evidence":
    case "payment_user_decisions":
    case "payment_lifecycle_guards":
    case "notification_currency_units":
    case "payment_control_closures":
    case "notification_review_aliases":
    case "payment_effective_events":
      return String(row.event_id || "");
    case "payment_reference_aliases":
      return `${row.reference_provider}:${row.provider_reference}`;
    case "payment_reconciliations":
    case "payment_reconciliation_guards":
      return String(row.operation_id || "");
    default:
      return String(row.id || "");
  }
}

async function readUserSnapshot(db, userId, scopes) {
  const scopeSet = new Set(scopes);
  const queries = [
    db.prepare("SELECT server_version, updated_at FROM task16_finance_user_versions WHERE user_id = ?1").bind(userId),
  ];

  // Query descriptors in fixed order
  const specs = [];
  if (scopeSet.has("finance_core")) {
    specs.push(
      ["categories", "SELECT * FROM task16_finance_categories WHERE user_id = ?1 ORDER BY created_at, id", [userId]],
      ["budgets", "SELECT * FROM task16_finance_budgets WHERE user_id = ?1 ORDER BY created_at, id", [userId]],
      ["transactions", "SELECT * FROM task16_finance_transactions WHERE user_id = ?1 ORDER BY occurred_at_ms, created_at, id", [userId]],
      ["raw_events", "SELECT * FROM task16_finance_raw_events WHERE user_id = ?1 ORDER BY occurred_at_ms, id", [userId]],
      ["transaction_events", `SELECT te.* FROM task16_finance_transaction_events te
        JOIN task16_finance_transactions t ON t.id = te.transaction_id
        WHERE t.user_id = ?1 ORDER BY te.transaction_id, te.raw_event_id`, [userId]],
      ["fx_preferences", "SELECT * FROM task16_currency_preferences WHERE user_id = ?1", [userId]],
      ["fx_references", "SELECT * FROM task16_fx_references WHERE user_id = ?1 ORDER BY transaction_id, transaction_revision, display_currency", [userId]],
      ["fx_rates", `SELECT DISTINCT r.* FROM task16_fx_rates r
        JOIN task16_fx_references ref ON ref.rate_id = r.id
        WHERE ref.user_id = ?1 ORDER BY r.id`, [userId]],
      ["currency_role_evidence", "SELECT * FROM task16_currency_role_evidence WHERE user_id = ?1 ORDER BY event_id", [userId]],
    );
  }
  if (scopeSet.has("finance_review")) {
    specs.push(
      ["pending_hints", "SELECT * FROM task21_notification_pending_hints WHERE user_id = ?1 ORDER BY created_at, id", [userId]],
      ["notification_candidates", "SELECT * FROM task21_notification_candidates WHERE user_id = ?1 ORDER BY occurred_at_ms, id", [userId]],
      ["payment_user_decisions", "SELECT * FROM task21_payment_user_decisions WHERE user_id = ?1 ORDER BY created_at, event_id", [userId]],
    );
  }
  if (scopeSet.has("notifications_cloud")) {
    specs.push(
      ["notification_events", "SELECT * FROM task21_notification_events WHERE user_id = ?1 ORDER BY received_at_ms, event_id", [userId]],
      ["notification_evidence", "SELECT * FROM task21_notification_evidence WHERE user_id = ?1 ORDER BY occurred_at_ms, id", [userId]],
      ["notification_review_aliases", "SELECT * FROM task21_notification_review_aliases WHERE user_id = ?1 ORDER BY created_at, event_id", [userId]],
      ["payment_reference_aliases", "SELECT * FROM task21_payment_reference_aliases WHERE user_id = ?1 ORDER BY created_at, provider_reference", [userId]],
      ["payment_lifecycle_guards", "SELECT * FROM task21_payment_lifecycle_guards WHERE user_id = ?1 ORDER BY event_id", [userId]],
      ["notification_currency_units", "SELECT * FROM task21_currency_units WHERE user_id = ?1 ORDER BY event_id", [userId]],
      ["payment_reconciliations", "SELECT * FROM task21_payment_reconciliations WHERE user_id = ?1 ORDER BY created_at, operation_id", [userId]],
      ["payment_effective_events", "SELECT * FROM task21_payment_effective_events WHERE user_id = ?1 ORDER BY event_id", [userId]],
      ["payment_reconciliation_guards", "SELECT * FROM task21_payment_reconciliation_guards WHERE user_id = ?1 ORDER BY operation_id", [userId]],
      ["payment_control_closures", "SELECT * FROM task21_payment_control_closures WHERE user_id = ?1 ORDER BY created_at, event_id", [userId]],
    );
  }

  for (const [, sql, args] of specs) {
    queries.push(db.prepare(sql).bind(...args));
  }
  queries.push(
    db.prepare("SELECT server_version, updated_at FROM task16_finance_user_versions WHERE user_id = ?1").bind(userId),
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const batchResults = await db.batch(queries);
    const vBefore = Number(batchResults[0]?.results?.[0]?.server_version || 0);
    const vAfter = Number(batchResults[batchResults.length - 1]?.results?.[0]?.server_version || 0);
    if (vBefore !== vAfter) {
      if (attempt < 2) continue;
      throw new Task29Error(
        "BACKUP_SNAPSHOT_CONCURRENT_MODIFICATION",
        "导出期间账户财务版本发生变化，请重试以确保导出快照一致性",
        409,
        true,
      );
    }
    const data = {};
    for (let i = 0; i < specs.length; i += 1) {
      const [sectionName] = specs[i];
      data[sectionName] = batchResults[i + 1]?.results || [];
    }
    return {
      financeServerVersion: vAfter,
      capturedAt: nowIso(),
      data,
    };
  }
  throw new Task29Error("BACKUP_SNAPSHOT_CONCURRENT_MODIFICATION", "快照读取失败，请重试", 409, true);
}

async function writeAudit(db, { userId, jobId = "", exportId = "", action, outcome, details = {}, requestId = "" }) {
  const id = `baud_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.prepare(`INSERT INTO task29_backup_audit (
    id, user_id, job_id, export_id, action, outcome, details_json, request_id, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(
    id,
    userId,
    String(jobId || ""),
    String(exportId || ""),
    String(action || ""),
    String(outcome || ""),
    JSON.stringify(details || {}),
    String(requestId || "").slice(0, 120),
    nowIso(),
  ).run();
}

export async function getBackupOverview(context, account) {
  const db = requireDb(context.env?.WYJ_DB);
  const snapshot = await readUserSnapshot(db, account.id, ["finance_core", "finance_review", "notifications_cloud"]);
  const scopeCounts = {
    finance_core: {
      categories: snapshot.data.categories.length,
      budgets: snapshot.data.budgets.length,
      transactions: snapshot.data.transactions.length,
      raw_events: snapshot.data.raw_events.length,
      fx_references: snapshot.data.fx_references.length,
      total: snapshot.data.categories.length + snapshot.data.budgets.length + snapshot.data.transactions.length + snapshot.data.raw_events.length,
    },
    finance_review: {
      pending_hints: snapshot.data.pending_hints.length,
      notification_candidates: snapshot.data.notification_candidates.length,
      payment_user_decisions: snapshot.data.payment_user_decisions.length,
      total: snapshot.data.pending_hints.length + snapshot.data.notification_candidates.length + snapshot.data.payment_user_decisions.length,
    },
    notifications_cloud: {
      notification_events: snapshot.data.notification_events.length,
      notification_evidence: snapshot.data.notification_evidence.length,
      payment_reconciliations: snapshot.data.payment_reconciliations.length,
      total: snapshot.data.notification_events.length + snapshot.data.notification_evidence.length + snapshot.data.payment_reconciliations.length,
    },
  };
  const [exportsRows, jobRows] = await Promise.all([
    safeAll(db, `SELECT id, format, schema_version, container_version, scopes_json, counts_json, manifest_sha256, byte_length, created_at
      FROM task29_backup_exports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 10`, [account.id]),
    safeAll(db, `SELECT id, state, conflict_policy, precheck_summary_json, result_summary_json, error_code, error_message, created_at, updated_at, completed_at
      FROM task29_restore_jobs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 10`, [account.id]),
  ]);

  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    container_version: BACKUP_CONTAINER_VERSION,
    finance_server_version: snapshot.financeServerVersion,
    scope_counts: scopeCounts,
    privacy_declaration: PRIVACY_DECLARATION,
    capabilities_and_limitations: CAPABILITIES_AND_LIMITATIONS,
    recent_exports: exportsRows.map((r) => ({
      ...r,
      scopes: JSON.parse(r.scopes_json || "[]"),
      counts: JSON.parse(r.counts_json || "{}"),
    })),
    recent_restore_jobs: jobRows.map((r) => ({
      id: r.id,
      state: r.state,
      conflict_policy: r.conflict_policy,
      summary: r.precheck_summary_json ? JSON.parse(r.precheck_summary_json) : {},
      result_summary: r.result_summary_json ? JSON.parse(r.result_summary_json) : null,
      error_code: r.error_code || "",
      error_message: r.error_message || "",
      created_at: r.created_at,
      updated_at: r.updated_at,
      completed_at: r.completed_at || "",
    })),
  };
}

export async function exportAccountData(context, account, input = {}) {
  const db = requireDb(context.env?.WYJ_DB);
  const format = normalizeExportFormat(input.format);
  const scopes = normalizeScopes(input.scopes);

  if (input.store_temp_cloud === true && format !== "encrypted") {
    throw new Task29Error(
      "BACKUP_PLAINTEXT_CLOUD_STORAGE_FORBIDDEN",
      "明文 JSON/CSV 财务备份禁止写入云端对象存储",
      403,
    );
  }

  const snapshot = await readUserSnapshot(db, account.id, scopes);
  assertPrivacyBoundaryClean(snapshot.data);

  const exportId = `bexp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const createdAt = snapshot.capturedAt;
  const accountIdSha256 = await accountBindingDigest(account.id);
  const cutoff = {
    finance_server_version: snapshot.financeServerVersion,
    captured_at: createdAt,
  };

  const { manifest, manifest_sha256 } = await computeSectionManifest(snapshot.data, {
    export_id: exportId,
    created_at: createdAt,
    account_id_sha256: accountIdSha256,
    scopes,
    cutoff,
  });

  const envelope = {
    schema_version: BACKUP_SCHEMA_VERSION,
    export_id: exportId,
    created_at: createdAt,
    cutoff,
    account_binding: {
      account_id_sha256: accountIdSha256,
      binding_version: 1,
    },
    scopes,
    privacy_declaration: PRIVACY_DECLARATION,
    capabilities_and_limitations: CAPABILITIES_AND_LIMITATIONS,
    manifest_sha256,
    manifest,
    data: snapshot.data,
  };

  const encoder = new TextEncoder();
  const countsMap = Object.fromEntries(
    Object.entries(manifest.sections).map(([k, v]) => [k, v.count]),
  );

  let responsePayload;
  let byteLength = 0;

  if (format === "csv") {
    const csvText = buildBackupCsv(envelope);
    byteLength = encoder.encode(csvText).byteLength;
    if (byteLength > MAX_BACKUP_BYTES) {
      throw new Task29Error("BACKUP_TOO_LARGE", "导出 CSV 超过单次大小限制 (16 MiB)", 413);
    }
    responsePayload = {
      format: "csv",
      restorable: false,
      export_id: exportId,
      filename: `aeris-backup-${createdAt.slice(0, 10)}.csv`,
      mime_type: "text/csv; charset=utf-8",
      manifest,
      manifest_sha256,
      privacy_declaration: PRIVACY_DECLARATION,
      capabilities_and_limitations: CAPABILITIES_AND_LIMITATIONS,
      csv: csvText,
    };
  } else if (format === "json") {
    const jsonBytes = encoder.encode(JSON.stringify(envelope)).byteLength;
    byteLength = jsonBytes;
    if (byteLength > MAX_BACKUP_BYTES) {
      throw new Task29Error("BACKUP_TOO_LARGE", "导出 JSON 超过单次大小限制 (16 MiB)", 413);
    }
    responsePayload = {
      format: "json",
      restorable: true,
      export_id: exportId,
      filename: `aeris-backup-${createdAt.slice(0, 10)}.json`,
      mime_type: "application/json; charset=utf-8",
      manifest,
      manifest_sha256,
      privacy_declaration: PRIVACY_DECLARATION,
      capabilities_and_limitations: CAPABILITIES_AND_LIMITATIONS,
      envelope,
    };
  } else {
    // format === "encrypted"
    const container = await encryptBackupPackage(envelope, input.passphrase);
    byteLength = encoder.encode(JSON.stringify(container)).byteLength;
    if (byteLength > MAX_BACKUP_BYTES) {
      throw new Task29Error("BACKUP_TOO_LARGE", "加密备份包超过单次大小限制 (16 MiB)", 413);
    }
    responsePayload = {
      format: "encrypted",
      restorable: true,
      export_id: exportId,
      filename: `aeris-encrypted-backup-${createdAt.slice(0, 10)}.aeris-backup.json`,
      mime_type: "application/json; charset=utf-8",
      manifest,
      manifest_sha256,
      privacy_declaration: PRIVACY_DECLARATION,
      capabilities_and_limitations: CAPABILITIES_AND_LIMITATIONS,
      container,
    };
  }

  await db.prepare(`INSERT INTO task29_backup_exports (
    id, user_id, format, schema_version, container_version, scopes_json, counts_json,
    manifest_sha256, payload_sha256, cutoff_finance_version, cutoff_notification_at,
    secure_file_id, byte_length, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '', ?12, ?13)`).bind(
    exportId,
    account.id,
    format,
    BACKUP_SCHEMA_VERSION,
    format === "encrypted" ? BACKUP_CONTAINER_VERSION : null,
    JSON.stringify(scopes),
    JSON.stringify(countsMap),
    manifest_sha256,
    manifest.payload_sha256,
    snapshot.financeServerVersion,
    createdAt,
    byteLength,
    createdAt,
  ).run();

  await writeAudit(db, {
    userId: account.id,
    exportId,
    action: `export_${format}`,
    outcome: "ok",
    details: { scopes, total_records: manifest.total_records, byte_length: byteLength },
    requestId: context.data?.requestId || "",
  });

  if (await hasTask27(db)) {
    try {
      await db.batch(eventStatements(db, account.id, "backup_export_created", account.id, context.data?.requestId || ""));
    } catch (_) {
      // Non-fatal if task27 audit fails on older synthetic fixtures
    }
  }

  return responsePayload;
}

function checkRecordOwner(section, row, accountId) {
  const userOwnedSections = new Set([
    "categories",
    "budgets",
    "transactions",
    "raw_events",
    "fx_preferences",
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
  if (userOwnedSections.has(section)) {
    return String(row.user_id || "") === accountId;
  }
  return true;
}

function buildExistingLookupMaps(existingData) {
  const maps = {};
  for (const [section, rows] of Object.entries(existingData)) {
    const byId = new Map();
    const byNatural = new Map();
    for (const row of rows) {
      byId.set(recordPrimaryId(section, row), row);
      if (section === "raw_events") {
        byNatural.set(`src:${row.device_id}:${row.source_type}:${row.source_event_id}`, row);
        if (row.provider_reference) {
          byNatural.set(`pref:${row.source_provider}:${row.provider_reference}`, row);
        }
        if (row.source_type === "notification" && row.source_event_id) {
          byNatural.set(`nsrc:${row.source_event_id}`, row);
        }
      } else if (section === "notification_candidates") {
        byNatural.set(`ev:${row.event_id}`, row);
      } else if (section === "pending_hints") {
        byNatural.set(`se:${row.source_event_id}`, row);
        if (row.provider_reference) {
          byNatural.set(`hpref:${row.source_package}:${row.payment_channel}:${row.provider_reference}:${row.direction || "unknown"}`, row);
        }
        if (row.lifecycle_identity) {
          byNatural.set(`hlc:${row.source_package}:${row.payment_channel}:${row.lifecycle_identity}`, row);
        }
      }
    }
    maps[section] = { byId, byNatural };
  }
  return maps;
}

function findMatchingExisting(section, row, lookup) {
  const id = recordPrimaryId(section, row);
  if (lookup.byId.has(id)) {
    return { existing: lookup.byId.get(id), matched_by: "primary_id" };
  }
  if (section === "raw_events") {
    const k1 = `src:${row.device_id}:${row.source_type}:${row.source_event_id}`;
    if (lookup.byNatural.has(k1)) return { existing: lookup.byNatural.get(k1), matched_by: "source_event_identity" };
    if (row.provider_reference) {
      const k2 = `pref:${row.source_provider}:${row.provider_reference}`;
      if (lookup.byNatural.has(k2)) return { existing: lookup.byNatural.get(k2), matched_by: "provider_reference" };
    }
    if (row.source_type === "notification" && row.source_event_id) {
      const k3 = `nsrc:${row.source_event_id}`;
      if (lookup.byNatural.has(k3)) return { existing: lookup.byNatural.get(k3), matched_by: "notification_source_event" };
    }
  } else if (section === "notification_candidates") {
    const k = `ev:${row.event_id}`;
    if (lookup.byNatural.has(k)) return { existing: lookup.byNatural.get(k), matched_by: "candidate_event_id" };
  } else if (section === "pending_hints") {
    const k1 = `se:${row.source_event_id}`;
    if (lookup.byNatural.has(k1)) return { existing: lookup.byNatural.get(k1), matched_by: "hint_source_event_id" };
    if (row.provider_reference) {
      const k2 = `hpref:${row.source_package}:${row.payment_channel}:${row.provider_reference}:${row.direction || "unknown"}`;
      if (lookup.byNatural.has(k2)) return { existing: lookup.byNatural.get(k2), matched_by: "hint_provider_reference" };
    }
    if (row.lifecycle_identity) {
      const k3 = `hlc:${row.source_package}:${row.payment_channel}:${row.lifecycle_identity}`;
      if (lookup.byNatural.has(k3)) return { existing: lookup.byNatural.get(k3), matched_by: "hint_lifecycle_identity" };
    }
  }
  return null;
}

function summarizeConflictDiff(existing, incoming) {
  const diffs = [];
  const interestingKeys = [
    "amount_minor", "currency", "amount_exponent", "direction", "status", "merchant",
    "name", "period_type", "reconciliation_state", "parse_status", "financial_phase",
    "state", "finance_transaction_id", "finance_entry_id", "currency_review_required",
  ];
  for (const k of interestingKeys) {
    if (existing[k] !== incoming[k] && (existing[k] !== undefined || incoming[k] !== undefined)) {
      diffs.push(`${k}: 现有=${JSON.stringify(existing[k])} vs 备份=${JSON.stringify(incoming[k])}`);
    }
  }
  if (!diffs.length) {
    for (const k of Object.keys(incoming || {})) {
      if (k === "sync_version" || k === "updated_at" || k === "created_at") continue;
      if (existing[k] !== incoming[k]) {
        diffs.push(`${k}: 现有=${JSON.stringify(existing[k])} vs 备份=${JSON.stringify(incoming[k])}`);
        if (diffs.length >= 3) break;
      }
    }
  }
  return diffs.join("; ") || "记录内容与当前云端已有记录不一致";
}

function validateForeignKeys(section, row, validIdSets) {
  if (section === "budgets" && row.category_id && !validIdSets.categories.has(row.category_id)) {
    return { ok: false, reason: "FK_CATEGORY_MISSING", detail: `预算引用了不存在的分类 ID：${row.category_id}` };
  }
  if (section === "transactions") {
    if (row.category_id && !validIdSets.categories.has(row.category_id)) {
      return { ok: false, reason: "FK_CATEGORY_MISSING", detail: `交易引用了不存在的分类 ID：${row.category_id}` };
    }
    if (row.system_superseded_by && !validIdSets.transactions.has(row.system_superseded_by)) {
      return { ok: false, reason: "FK_SUPERSEDED_TX_MISSING", detail: `交易替代关联引用了不存在的交易：${row.system_superseded_by}` };
    }
  }
  if (section === "transaction_events") {
    if (!validIdSets.transactions.has(row.transaction_id)) {
      return { ok: false, reason: "FK_TRANSACTION_MISSING", detail: `关联边引用了不存在的交易：${row.transaction_id}` };
    }
    if (!validIdSets.raw_events.has(row.raw_event_id)) {
      return { ok: false, reason: "FK_RAW_EVENT_MISSING", detail: `关联边引用了不存在的原始事件：${row.raw_event_id}` };
    }
  }
  if (section === "fx_references") {
    if (!validIdSets.transactions.has(row.transaction_id)) {
      return { ok: false, reason: "FK_TRANSACTION_MISSING", detail: `汇率快照引用了不存在的交易：${row.transaction_id}` };
    }
    if (!validIdSets.fx_rates.has(row.rate_id)) {
      return { ok: false, reason: "FK_FX_RATE_MISSING", detail: `汇率引用了不存在的汇率快照：${row.rate_id}` };
    }
  }
  if (section === "notification_candidates") {
    if (row.finance_transaction_id && !validIdSets.transactions.has(row.finance_transaction_id)) {
      return { ok: false, reason: "FK_TRANSACTION_MISSING", detail: `审核候选引用了不存在的交易：${row.finance_transaction_id}` };
    }
  }
  if (section === "pending_hints") {
    if (row.finance_entry_id && !validIdSets.transactions.has(row.finance_entry_id)) {
      return { ok: false, reason: "FK_TRANSACTION_MISSING", detail: `待确认提示引用了不存在的交易：${row.finance_entry_id}` };
    }
  }
  if (section === "notification_review_aliases") {
    if (!validIdSets.pending_hints.has(row.hint_id)) {
      return { ok: false, reason: "FK_HINT_MISSING", detail: `别名引用了不存在的待确认提示：${row.hint_id}` };
    }
  }
  if (section === "payment_reference_aliases") {
    if (!validIdSets.raw_events.has(row.raw_event_id)) {
      return { ok: false, reason: "FK_RAW_EVENT_MISSING", detail: `支付参考别名引用了不存在的原始事件：${row.raw_event_id}` };
    }
  }
  return { ok: true };
}

export async function precheckBackupRestore(context, account, input = {}) {
  const db = requireDb(context.env?.WYJ_DB);
  const conflictPolicy = normalizeConflictPolicy(input.conflict_policy);
  const createJob = input.create_job !== false;
  const requestedScopes = input.scopes ? normalizeScopes(input.scopes) : null;

  let pkgObj = input.package;
  if (!pkgObj && typeof input.package_text === "string") {
    const rawLen = new TextEncoder().encode(input.package_text).byteLength;
    if (rawLen > MAX_BACKUP_BYTES) {
      throw new Task29Error("BACKUP_TOO_LARGE", "上传的备份文件超过 16 MiB 安全上限", 413);
    }
    const trimmed = input.package_text.replace(/^\uFEFF/, "").trim();
    if (trimmed.startsWith("record_section,")) {
      throw new Task29Error(
        "BACKUP_CSV_NOT_RESTORABLE",
        CAPABILITIES_AND_LIMITATIONS.csv_notice,
        400,
      );
    }
    try {
      pkgObj = JSON.parse(trimmed);
    } catch (_) {
      throw new Task29Error("BACKUP_INVALID_FORMAT", "备份文件不是有效的 JSON 或加密备份格式", 400);
    }
  }
  if (!pkgObj || typeof pkgObj !== "object" || Array.isArray(pkgObj)) {
    throw new Task29Error("BACKUP_INVALID_FORMAT", "缺少有效的备份包内容", 400);
  }

  const backupSha256 = await sha256Hex(canonicalJson(pkgObj));
  const checks = [];

  let envelope;
  let integrity;
  let containerVersion = 0;

  if (pkgObj.format === "aeris-encrypted-backup") {
    const decrypted = await decryptBackupPackage(pkgObj, input.passphrase);
    envelope = decrypted.envelope;
    integrity = decrypted.integrity;
    containerVersion = decrypted.container_version;
    checks.push({
      step: "decrypt_and_auth_tag",
      passed: true,
      detail: `容器 v${containerVersion} (${pkgObj.crypto.cipher}, ${pkgObj.crypto.kdf} ${pkgObj.crypto.iterations} 次) 解密与 GCM 认证标签通过`,
    });
  } else {
    // Plaintext structured JSON envelope
    if (pkgObj.envelope && typeof pkgObj.envelope === "object") {
      pkgObj = pkgObj.envelope;
    }
    if (pkgObj.schema_version !== BACKUP_SCHEMA_VERSION || !pkgObj.manifest || !pkgObj.data) {
      throw new Task29Error("BACKUP_UNSUPPORTED_SCHEMA", "备份文件不是合法的 Aeris aeris.backup.v1 格式", 400);
    }
    integrity = await verifyManifestIntegrity(pkgObj.manifest, pkgObj.manifest_sha256, pkgObj.data);
    envelope = pkgObj;
    checks.push({
      step: "plaintext_manifest_verify",
      passed: true,
      detail: "明文 JSON 清单与各数据节 SHA-256 校验通过（非加密容器）",
    });
  }

  // Check schema version
  if (envelope.schema_version !== BACKUP_SCHEMA_VERSION) {
    throw new Task29Error("BACKUP_UNSUPPORTED_SCHEMA", `不支持的备份 Schema 版本：${String(envelope.schema_version)}`, 400);
  }
  checks.push({ step: "schema_version", passed: true, detail: `Schema 版本 ${BACKUP_SCHEMA_VERSION} 兼容` });

  // Account isolation check: binding digest + per-row user_id check
  const expectedBinding = await accountBindingDigest(account.id);
  const actualBinding = String(envelope.account_binding?.account_id_sha256 || "");
  if (actualBinding !== expectedBinding || String(envelope.manifest?.account_id_sha256 || "") !== expectedBinding) {
    throw new Task29Error(
      "BACKUP_ACCOUNT_MISMATCH",
      "该备份文件属于其他账户，禁止跨账户导入或篡改 owner 恢复",
      403,
    );
  }

  // Filter sections by requested scopes if caller restricted scope
  const activeScopes = requestedScopes || normalizeScopes(envelope.scopes);
  const activeScopeSet = new Set(activeScopes);
  const data = {};
  for (const [sec, rows] of Object.entries(envelope.data || {})) {
    const scope = SECTION_TO_SCOPE[sec];
    if (scope && activeScopeSet.has(scope)) {
      data[sec] = Array.isArray(rows) ? rows : [];
    }
  }

  for (const [section, rows] of Object.entries(data)) {
    for (const row of rows) {
      if (!checkRecordOwner(section, row, account.id)) {
        throw new Task29Error(
          "BACKUP_ACCOUNT_MISMATCH",
          `备份记录 (${section}) 内含其他账户的 user_id，已拒绝跨账户导入`,
          403,
        );
      }
    }
  }
  checks.push({ step: "account_ownership", passed: true, detail: "账户绑定摘要与逐条记录归属校验通过" });

  // Strict privacy boundary check
  assertPrivacyBoundaryClean(data);
  checks.push({ step: "privacy_boundary", passed: true, detail: "未包含禁止的 Android 本地原始通知正文/短信字段" });

  // Read current D1 state strictly read-only
  const existingSnapshot = await readUserSnapshot(db, account.id, ["finance_core", "finance_review", "notifications_cloud"]);
  const existingLookup = buildExistingLookupMaps(existingSnapshot.data);

  // Also load ALL referenced fx_rates in D1 for FK checks
  const validIdSets = {};
  for (const sec of Object.keys(existingSnapshot.data)) {
    validIdSets[sec] = new Set(existingSnapshot.data[sec].map((r) => recordPrimaryId(sec, r)));
  }

  // Build context lookup for P03-P06 cross-record validation
  const rawEventsByTxId = new Map();
  const rawById = new Map();
  for (const r of [...(existingSnapshot.data.raw_events || []), ...(data.raw_events || [])]) {
    rawById.set(r.id, r);
  }
  for (const link of [...(existingSnapshot.data.transaction_events || []), ...(data.transaction_events || [])]) {
    if (link.relation_status !== "active") continue;
    const raw = rawById.get(link.raw_event_id);
    if (!raw) continue;
    if (!rawEventsByTxId.has(link.transaction_id)) rawEventsByTxId.set(link.transaction_id, []);
    rawEventsByTxId.get(link.transaction_id).push(raw);
  }
  const invariantCtx = { rawEventsByTxId };

  // Pre-register valid candidate IDs for records in this backup that pass invariants so children can verify FK within same backup
  const sectionOrder = Object.keys(SECTION_TO_SCOPE);
  const validNewIdsBySection = new Map();
  const invariantFailureByRecord = new Map();

  for (const section of sectionOrder) {
    const incomingRows = data[section] || [];
    const set = new Set();
    for (const row of incomingRows) {
      const id = recordPrimaryId(section, row);
      const inv = validateRecordSafetyInvariants(section, row, invariantCtx);
      if (inv.ok) {
        set.add(id);
        validIdSets[section]?.add(id);
      } else {
        invariantFailureByRecord.set(`${section}:${id}`, inv);
      }
    }
    validNewIdsBySection.set(section, set);
  }

  // Validate P03 refund ceiling invariant across lifecycle families (notification_events SETTLED vs REFUNDED)
  const lifecycleEventsAll = new Map();
  for (const ev of [...(existingSnapshot.data.notification_events || []), ...(data.notification_events || [])]) {
    lifecycleEventsAll.set(ev.event_id, ev);
  }
  const settledByFamily = new Map();
  const refundedByFamily = new Map();
  for (const ev of lifecycleEventsAll.values()) {
    if (!ev.reference_namespace || !ev.lifecycle_reference) continue;
    const fkey = `${ev.reference_namespace}::${ev.lifecycle_reference}`;
    if (ev.financial_phase === "SETTLED") {
      settledByFamily.set(fkey, (settledByFamily.get(fkey) || 0) + Number(ev.amount_minor || 0));
    } else if (ev.financial_phase === "REFUNDED") {
      refundedByFamily.set(fkey, (refundedByFamily.get(fkey) || 0) + Number(ev.amount_minor || 0));
    }
  }
  for (const [fkey, refSum] of refundedByFamily.entries()) {
    const setSum = settledByFamily.get(fkey) || 0;
    if (setSum > 0 && refSum > setSum) {
      for (const ev of data.notification_events || []) {
        if (`${ev.reference_namespace}::${ev.lifecycle_reference}` === fkey && ev.financial_phase === "REFUNDED") {
          invariantFailureByRecord.set(`notification_events:${ev.event_id}`, {
            ok: false,
            reason: "REFUND_EXCEEDS_SETTLED",
            detail: `退款累计 (${refSum}) 超过已清算金额 (${setSum})`,
          });
        }
      }
    }
  }

  const diffPreview = {
    added: [],
    skipped_identical: [],
    conflicts: [],
    rejected: [],
  };
  const stagedPlan = [];
  const warnings = [];
  const counts = {
    added: 0,
    skipped_identical: 0,
    conflicts: 0,
    rejected: 0,
    by_section: {},
  };

  for (const section of sectionOrder) {
    const incomingRows = data[section];
    if (!incomingRows) continue;
    counts.by_section[section] = { added: 0, skipped_identical: 0, conflicts: 0, rejected: 0 };
    const lookup = existingLookup[section] || { byId: new Map(), byNatural: new Map() };

    for (const row of incomingRows) {
      const id = recordPrimaryId(section, row);
      const invFail = invariantFailureByRecord.get(`${section}:${id}`);
      if (invFail) {
        counts.rejected += 1;
        counts.by_section[section].rejected += 1;
        diffPreview.rejected.push({ section, id, reason: invFail.reason, detail: invFail.detail });
        continue;
      }

      const fkCheck = validateForeignKeys(section, row, validIdSets);
      if (!fkCheck.ok) {
        counts.rejected += 1;
        counts.by_section[section].rejected += 1;
        diffPreview.rejected.push({ section, id, reason: fkCheck.reason, detail: fkCheck.detail });
        continue;
      }

      if (section === "transactions" && row.currency === "JPY" && (row.amount_exponent === null || row.amount_exponent === undefined)) {
        warnings.push({
          code: "LEGACY_JPY_UNVERIFIED_UNIT",
          section,
          id,
          detail: `交易 ${id} 为历史未确认小数单位的日元记录 (amount_exponent=null)，将原样保留待核实状态`,
        });
      }
      if (section === "transactions" && Number(row.currency_review_required || 0) === 1) {
        warnings.push({
          code: "CURRENCY_REVIEW_PRESERVED",
          section,
          id,
          detail: `交易 ${id} 为待核实币种记录 (${row.currency_decision_source || "account_default"})，不会静默确认`,
        });
      }

      const match = findMatchingExisting(section, row, lookup);
      if (!match) {
        counts.added += 1;
        counts.by_section[section].added += 1;
        stagedPlan.push({ section, row });
        if (diffPreview.added.length < 100) {
          diffPreview.added.push({
            section,
            id,
            summary: row.merchant || row.name || row.source_package || section,
            currency: row.currency || "",
            amount_minor: row.amount_minor ?? null,
          });
        }
      } else {
        const samePayload = stableRecordProjection(section, match.existing) === stableRecordProjection(section, row);
        if (samePayload) {
          counts.skipped_identical += 1;
          counts.by_section[section].skipped_identical += 1;
          if (diffPreview.skipped_identical.length < 100) {
            diffPreview.skipped_identical.push({
              section,
              id,
              matched_by: match.matched_by,
              detail: "云端已存在完全一致记录，恢复时自动幂等跳过",
            });
          }
        } else {
          counts.conflicts += 1;
          counts.by_section[section].conflicts += 1;
          diffPreview.conflicts.push({
            section,
            id,
            matched_by: match.matched_by,
            detail: summarizeConflictDiff(match.existing, row),
          });
        }
      }
    }
  }

  checks.push({
    step: "invariants_fk_and_diff",
    passed: counts.rejected === 0 && (counts.conflicts === 0 || conflictPolicy === "skip_all_existing"),
    detail: `新增 ${counts.added} 条，跳过一致 ${counts.skipped_identical} 条，冲突 ${counts.conflicts} 条，拒绝 ${counts.rejected} 条`,
  });

  const canRestore = counts.rejected === 0 && (counts.conflicts === 0 || conflictPolicy === "skip_all_existing");
  // Ensure parent transactions (without system_superseded_by) come before superseded child transactions.
  stagedPlan.sort((a, b) => {
    const secIdxA = sectionOrder.indexOf(a.section);
    const secIdxB = sectionOrder.indexOf(b.section);
    if (secIdxA !== secIdxB) return secIdxA - secIdxB;
    if (a.section === "transactions" && b.section === "transactions") {
      const aChild = a.row.system_superseded_by ? 1 : 0;
      const bChild = b.row.system_superseded_by ? 1 : 0;
      if (aChild !== bChild) return aChild - bChild;
    }
    return 0;
  });
  const effectivePayloadSha256 = await sha256Hex(canonicalJson({
    scopes: activeScopes,
    payload_sha256: integrity.payload_sha256,
  }));
  let jobId = "";

  if (createJob) {
    jobId = `brjob_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const now = nowIso();
    const expiresAt = new Date(Date.now() + JOB_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const totalBatches = stagedPlan.length === 0 ? 0 : Math.ceil(stagedPlan.length / RESTORE_BATCH_SIZE);
    const summaryObj = {
      added: counts.added,
      skipped_identical: counts.skipped_identical,
      conflicts: counts.conflicts,
      rejected: counts.rejected,
      can_restore: canRestore,
      conflict_policy: conflictPolicy,
      source_export_id: String(envelope.export_id || ""),
      source_created_at: String(envelope.created_at || ""),
    };

    await db.prepare(`INSERT INTO task29_restore_jobs (
      id, user_id, idempotency_key, backup_sha256, manifest_sha256, payload_sha256,
      source_export_id, schema_version, container_version, state, conflict_policy,
      scopes_json, precheck_summary_json, diff_preview_json, staged_plan_json,
      applied_log_json, total_batches, completed_batches, created_at, updated_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'prechecked', ?10, ?11, ?12, ?13, ?14, '[]', ?15, 0, ?16, ?16, ?17)`).bind(
      jobId,
      account.id,
      `${jobId}:${effectivePayloadSha256.slice(0, 16)}`,
      backupSha256,
      integrity.manifest_sha256,
      effectivePayloadSha256,
      String(envelope.export_id || ""),
      envelope.schema_version,
      containerVersion,
      conflictPolicy,
      JSON.stringify(activeScopes),
      JSON.stringify(summaryObj),
      JSON.stringify(diffPreview),
      JSON.stringify(stagedPlan),
      totalBatches,
      now,
      expiresAt,
    ).run();

    await writeAudit(db, {
      userId: account.id,
      jobId,
      exportId: String(envelope.export_id || ""),
      action: "restore_precheck",
      outcome: canRestore ? "ready" : "blocked",
      details: summaryObj,
      requestId: context.data?.requestId || "",
    });
  }

  return {
    job_id: jobId,
    read_only_simulation: true,
    can_restore: canRestore,
    conflict_policy: conflictPolicy,
    source_export_id: String(envelope.export_id || ""),
    source_created_at: String(envelope.created_at || ""),
    payload_sha256: integrity.payload_sha256,
    manifest_sha256: integrity.manifest_sha256,
    privacy_declaration: PRIVACY_DECLARATION,
    limitations: CAPABILITIES_AND_LIMITATIONS.p03_p06_limitations,
    checks,
    summary: {
      added: counts.added,
      skipped_identical: counts.skipped_identical,
      conflicts: counts.conflicts,
      rejected: counts.rejected,
      by_section: counts.by_section,
    },
    diff_preview: diffPreview,
    warnings,
  };
}

function insertStatementForRecord(db, section, row) {
  switch (section) {
    case "categories":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task16_finance_categories (
          id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`).bind(
          row.id, row.user_id, row.name, row.applies_to || "both", row.color || "", row.status || "active",
          Number(row.revision || 1), Number(row.sync_version || 0), row.created_at, row.updated_at, row.deleted_at || "",
        ),
      };
    case "budgets":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task16_finance_budgets (
          id, user_id, category_id, period_type, amount_minor, currency, amount_exponent,
          starts_on, ends_on, status, revision, sync_version, created_at, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`).bind(
          row.id, row.user_id, row.category_id || "", row.period_type, Number(row.amount_minor), row.currency,
          row.amount_exponent ?? null, row.starts_on || "", row.ends_on || "", row.status || "active",
          Number(row.revision || 1), Number(row.sync_version || 0), row.created_at, row.updated_at, row.deleted_at || "",
        ),
      };
    case "transactions":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task16_finance_transactions (
          id, user_id, direction, amount_minor, currency, amount_exponent, category_id,
          merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state,
          status, revision, sync_version, created_by_device, import_source_key, created_at,
          updated_at, deleted_at, system_superseded_by, system_superseded_operation,
          currency_review_required, currency_decision_source
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)`).bind(
          row.id, row.user_id, row.direction, Number(row.amount_minor), row.currency, row.amount_exponent ?? null,
          row.category_id || "", row.merchant || "", row.counterparty || "", row.note || "",
          Number(row.occurred_at_ms), row.source_kind || "manual", row.reconciliation_state || "confirmed",
          row.status || "active", Number(row.revision || 1), Number(row.sync_version || 0),
          row.created_by_device || "", row.import_source_key || "", row.created_at, row.updated_at,
          row.deleted_at || "", row.system_superseded_by || "", row.system_superseded_operation || "",
          Number(row.currency_review_required || 0), row.currency_decision_source || "",
        ),
      };
    case "raw_events":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task16_finance_raw_events (
          id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference,
          direction, amount_minor, currency, merchant, counterparty, account_last4, occurred_at_ms,
          captured_at_ms, text_fingerprint_sha256, classification, classification_reason,
          metadata_json, sync_version, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`).bind(
          row.id, row.user_id, row.device_id, row.source_type, row.source_event_id, row.source_provider,
          row.provider_reference || "", row.direction || "unknown", Number(row.amount_minor || 0),
          row.currency || "CNY", row.merchant || "", row.counterparty || "", row.account_last4 || "",
          Number(row.occurred_at_ms), Number(row.captured_at_ms), row.text_fingerprint_sha256 || "",
          row.classification, row.classification_reason || "", row.metadata_json || "{}",
          Number(row.sync_version || 0), row.created_at,
        ),
      };
    case "transaction_events":
      return {
        pkWhere: "transaction_id = ?1 AND raw_event_id = ?2",
        pkArgs: [row.transaction_id, row.raw_event_id],
        stmt: db.prepare(`INSERT INTO task16_finance_transaction_events (
          transaction_id, raw_event_id, relation_status, confidence_milli, evidence_json, linked_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(
          row.transaction_id, row.raw_event_id, row.relation_status || "active",
          Number(row.confidence_milli ?? 1000), row.evidence_json || "[]", row.linked_by || "automatic",
          row.created_at, row.updated_at,
        ),
      };
    case "fx_preferences":
      return {
        pkWhere: "user_id = ?1",
        pkArgs: [row.user_id],
        stmt: db.prepare(`INSERT INTO task16_currency_preferences (
          user_id, account_currency, display_currency, default_currency, revision, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
          row.user_id, row.account_currency || "CNY", row.display_currency || "CNY",
          row.default_currency ?? null, Number(row.revision || 1), row.updated_at,
        ),
      };
    case "fx_rates":
      return {
        pkWhere: "id = ?1",
        pkArgs: [row.id],
        isSharedRate: true,
        stmt: db.prepare(`INSERT OR IGNORE INTO task16_fx_rates (
          id, base, quote, requested_date, rate_timestamp, rate, source, fetched_at, expires_at, rounding, integrity_hash
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`).bind(
          row.id, row.base, row.quote, row.requested_date, row.rate_timestamp, row.rate,
          row.source, row.fetched_at, row.expires_at, row.rounding || "HALF_EVEN", row.integrity_hash,
        ),
      };
    case "fx_references":
      return {
        pkWhere: "user_id = ?1 AND transaction_id = ?2 AND transaction_revision = ?3 AND display_currency = ?4",
        pkArgs: [row.user_id, row.transaction_id, Number(row.transaction_revision), row.display_currency],
        stmt: db.prepare(`INSERT INTO task16_fx_references (
          user_id, transaction_id, transaction_revision, display_currency, rate_id,
          original_currency, original_minor, amount_exponent, converted_minor, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
          row.user_id, row.transaction_id, Number(row.transaction_revision), row.display_currency,
          row.rate_id, row.original_currency, Number(row.original_minor), Number(row.amount_exponent),
          Number(row.converted_minor), row.created_at,
        ),
      };
    case "currency_role_evidence":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare("INSERT INTO task16_currency_role_evidence (user_id, event_id, roles_json) VALUES (?1, ?2, ?3)")
          .bind(row.user_id, row.event_id, row.roles_json),
      };
    case "pending_hints":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task21_notification_pending_hints (
          id, user_id, source_event_id, device_id, source_type, source_package, app_label,
          evidence_summary, amount_minor, direction, merchant, currency, confidence, recognition_status,
          state, finance_entry_id, created_at, updated_at, confirmed_at, ignored_at,
          provider_reference, lifecycle_identity, payment_channel, currency_review_required, currency_decision_source
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)`).bind(
          row.id, row.user_id, row.source_event_id, row.device_id || "", row.source_type || "notification",
          row.source_package || "", row.app_label || "", row.evidence_summary || "{}",
          row.amount_minor ?? null, row.direction ?? null, row.merchant || "", row.currency || "CNY",
          Number(row.confidence || 0), row.recognition_status || "PAYMENT_LIKELY", row.state || "pending",
          row.finance_entry_id || "", row.created_at, row.updated_at, row.confirmed_at || "", row.ignored_at || "",
          row.provider_reference || "", row.lifecycle_identity || "", row.payment_channel || "",
          Number(row.currency_review_required || 0), row.currency_decision_source || "",
        ),
      };
    case "notification_candidates":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task21_notification_candidates (
          id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty,
          payment_channel, occurred_at_ms, confidence, status, finance_transaction_id,
          created_at, updated_at, edited_json, correction_count, evidence_count
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`).bind(
          row.id, row.user_id, row.event_id, row.direction, Number(row.amount_minor),
          row.currency || "CNY", row.merchant || "", row.counterparty || "", row.payment_channel || "",
          Number(row.occurred_at_ms), Number(row.confidence || 0), row.status || "pending",
          row.finance_transaction_id || "", row.created_at, row.updated_at,
          row.edited_json || "{}", Number(row.correction_count || 0), Number(row.evidence_count || 1),
        ),
      };
    case "payment_user_decisions":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare("INSERT INTO task21_payment_user_decisions (user_id, event_id, decision, created_at) VALUES (?1, ?2, ?3, ?4)")
          .bind(row.user_id, row.event_id, row.decision, row.created_at),
      };
    case "notification_events":
      return {
        pkWhere: "event_id = ?1 AND user_id = ?2",
        pkArgs: [row.event_id, row.user_id],
        stmt: db.prepare(`INSERT INTO task21_notification_events (
          event_id, user_id, device_id, fingerprint, source_package, source_type, event_type,
          parser_version, parse_status, direction, amount_minor, currency, payment_channel, merchant,
          counterparty, confidence, occurred_at_ms, received_at_ms, candidate_id, finance_transaction_id,
          status, created_at, updated_at, deleted_at, provider_reference, lifecycle_identity,
          financial_phase, lifecycle_reference, reference_namespace, currency_evidence,
          identity_review_reason, lifecycle_operation, lifecycle_revision, lifecycle_review_reason,
          currency_review_required, currency_decision_source
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36)`).bind(
          row.event_id, row.user_id, row.device_id, row.fingerprint, row.source_package || "",
          row.source_type || "notification", row.event_type || "other", row.parser_version || "",
          row.parse_status || "unparsed", row.direction || "", Number(row.amount_minor || 0),
          row.currency || "CNY", row.payment_channel || "", row.merchant || "", row.counterparty || "",
          Number(row.confidence || 0), Number(row.occurred_at_ms || 0), Number(row.received_at_ms),
          row.candidate_id || "", row.finance_transaction_id || "", row.status || "active",
          row.created_at, row.updated_at, row.deleted_at || "", row.provider_reference || "",
          row.lifecycle_identity || "", row.financial_phase || "", row.lifecycle_reference || "",
          row.reference_namespace || "", row.currency_evidence || "", row.identity_review_reason || "",
          row.lifecycle_operation || "", Number(row.lifecycle_revision || 0),
          row.lifecycle_review_reason || "", Number(row.currency_review_required || 0),
          row.currency_decision_source || "",
        ),
      };
    case "notification_evidence":
      return {
        pkWhere: "id = ?1 AND user_id = ?2",
        pkArgs: [row.id, row.user_id],
        stmt: db.prepare(`INSERT INTO task21_notification_evidence (
          id, user_id, event_id, candidate_id, finance_transaction_id, source_type, source_package,
          parser_version, amount_minor, direction, provider_reference, occurred_at_ms, is_primary,
          reconciliation_state, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`).bind(
          row.id, row.user_id, row.event_id, row.candidate_id || "", row.finance_transaction_id || "",
          row.source_type || "notification", row.source_package || "", row.parser_version || "",
          Number(row.amount_minor || 0), row.direction || "unknown", row.provider_reference || "",
          Number(row.occurred_at_ms || 0), Number(row.is_primary || 0), row.reconciliation_state || "pending",
          row.created_at || "", row.updated_at || "",
        ),
      };
    case "notification_review_aliases":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare("INSERT INTO task21_notification_review_aliases (user_id, event_id, hint_id, created_at) VALUES (?1, ?2, ?3, ?4)")
          .bind(row.user_id, row.event_id, row.hint_id, row.created_at),
      };
    case "payment_reference_aliases":
      return {
        pkWhere: "user_id = ?1 AND reference_provider = ?2 AND provider_reference = ?3",
        pkArgs: [row.user_id, row.reference_provider, row.provider_reference],
        stmt: db.prepare(`INSERT INTO task21_payment_reference_aliases (
          user_id, reference_provider, provider_reference, raw_event_id, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(row.user_id, row.reference_provider, row.provider_reference, row.raw_event_id, row.created_at),
      };
    case "payment_lifecycle_guards":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare("INSERT INTO task21_payment_lifecycle_guards (user_id, event_id, passed) VALUES (?1, ?2, ?3)")
          .bind(row.user_id, row.event_id, Number(row.passed)),
      };
    case "notification_currency_units":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare("INSERT INTO task21_currency_units (user_id, event_id, currency, amount_exponent) VALUES (?1, ?2, ?3, ?4)")
          .bind(row.user_id, row.event_id, row.currency, Number(row.amount_exponent)),
      };
    case "payment_reconciliations":
      return {
        pkWhere: "user_id = ?1 AND operation_id = ?2",
        pkArgs: [row.user_id, row.operation_id],
        stmt: db.prepare(`INSERT INTO task21_payment_reconciliations (
          user_id, operation_id, payload_digest, command_json, status, reason, before_json, result_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
          row.user_id, row.operation_id, row.payload_digest, row.command_json, row.status, row.reason,
          row.before_json, row.result_json, row.created_at, row.updated_at,
        ),
      };
    case "payment_effective_events":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare(`INSERT INTO task21_payment_effective_events (
          user_id, event_id, canonical_event_id, transaction_id, amount_minor, financial_phase,
          lifecycle_operation, lifecycle_revision, lifecycle_reference, provider_reference,
          reference_namespace, operation_id, excluded
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`).bind(
          row.user_id, row.event_id, row.canonical_event_id, row.transaction_id, Number(row.amount_minor),
          row.financial_phase, row.lifecycle_operation, Number(row.lifecycle_revision),
          row.lifecycle_reference, row.provider_reference, row.reference_namespace, row.operation_id, Number(row.excluded),
        ),
      };
    case "payment_reconciliation_guards":
      return {
        pkWhere: "user_id = ?1 AND operation_id = ?2",
        pkArgs: [row.user_id, row.operation_id],
        stmt: db.prepare("INSERT INTO task21_payment_reconciliation_guards (user_id, operation_id, passed) VALUES (?1, ?2, ?3)")
          .bind(row.user_id, row.operation_id, Number(row.passed)),
      };
    case "payment_control_closures":
      return {
        pkWhere: "user_id = ?1 AND event_id = ?2",
        pkArgs: [row.user_id, row.event_id],
        stmt: db.prepare("INSERT INTO task21_payment_control_closures (user_id, event_id, reason, created_at) VALUES (?1, ?2, ?3, ?4)")
          .bind(row.user_id, row.event_id, row.reason, row.created_at),
      };
    default:
      throw new Task29Error("BACKUP_UNSUPPORTED_SECTION", `未知数据节：${section}`, 400);
  }
}

async function authorizeBackupStepup(context, account, grant, jobId) {
  if (!grant || typeof grant !== "string") {
    throw new Task29Error("STEPUP_REQUIRED", "高风险数据恢复操作需要重新验证身份（Step-up 授权）", 403);
  }
  const { db, sessionDigest } = await task27Identity(context, account);
  let row;
  try {
    row = await challengeRow(db, grant, "grant", sessionDigest);
  } catch (_) {
    throw new Task29Error("STEPUP_REQUIRED", "Step-up 授权无效、已使用或已过期", 403);
  }
  const allowedScopes = new Set([`backup_restore:${jobId}`, "backup_restore"]);
  if (!allowedScopes.has(String(row.scope || ""))) {
    throw new Task29Error("STEPUP_SCOPE_MISMATCH", "Step-up 授权范围不匹配，无法执行备份恢复", 403);
  }
  return await authorize(context, account, grant, row.scope);
}

async function rollbackAppliedRecords(db, appliedLog) {
  // Compensate ONLY records newly inserted by this restore job, in reverse dependency order.
  // Never touch pre-existing user rows or shared global FX rate rows.
  for (let i = appliedLog.length - 1; i >= 0; i -= 1) {
    const entry = appliedLog[i];
    if (entry.isSharedRate) continue;
    try {
      await db.prepare(`DELETE FROM ${entry.table} WHERE ${entry.pkWhere}`).bind(...entry.pkArgs).run();
    } catch (_) {
      // Best-effort continue rolling back all remaining newly inserted items
    }
  }
}

export async function commitRestoreJob(context, account, jobId, input = {}) {
  const db = requireDb(context.env?.WYJ_DB);
  const job = await safeFirst(db, "SELECT * FROM task29_restore_jobs WHERE id = ?1 AND user_id = ?2", [jobId, account.id]);
  if (!job) {
    throw new Task29Error("BACKUP_JOB_NOT_FOUND", "恢复作业不存在或无权访问", 404);
  }

  // Always enforce Task27 Step-up authorization before inspecting or executing restore commits.
  const stepupAuth = await authorizeBackupStepup(context, account, input.grant, jobId);

  if (job.state === "cancelled") {
    throw new Task29Error("BACKUP_JOB_CANCELLED", "该恢复作业已取消，请重新发起预检", 409);
  }
  if (job.state === "rolled_back" || job.state === "failed") {
    throw new Task29Error("BACKUP_JOB_ALREADY_ROLLED_BACK", "该恢复作业此前已失败并回滚，请重新预检", 409);
  }
  if (job.expires_at <= nowIso()) {
    throw new Task29Error("BACKUP_JOB_EXPIRED", "预检作业已过期，请重新执行预检后再提交恢复", 410);
  }

  const precheckSummary = JSON.parse(job.precheck_summary_json || "{}");
  if (!precheckSummary.can_restore && job.state !== "completed") {
    throw new Task29Error(
      "BACKUP_PRECHECK_BLOCKED",
      "预检未通过（存在冲突或被拒绝记录），不允许提交恢复",
      409,
    );
  }

  const stagedPlan = JSON.parse(job.staged_plan_json || "[]");
  // Idempotency check: same job/idempotency_key OR repeating an already-applied payload with 0 staged additions.
  const explicitKey = typeof input.idempotency_key === "string" && input.idempotency_key.trim() ? input.idempotency_key.trim() : "";
  const idempKey = (explicitKey || job.idempotency_key || `${job.payload_sha256}:${job.conflict_policy}`).slice(0, 120);
  const existingByKey = explicitKey
    ? await safeFirst(
        db,
        `SELECT * FROM task29_restore_idempotency WHERE user_id = ?1 AND idempotency_key = ?2 LIMIT 1`,
        [account.id, idempKey],
      )
    : null;
  const existingByPayload = await safeFirst(
    db,
    `SELECT * FROM task29_restore_idempotency
     WHERE user_id = ?1 AND payload_sha256 = ?2 AND conflict_policy = ?3 LIMIT 1`,
    [account.id, job.payload_sha256, job.conflict_policy],
  );
  const existingIdemp = existingByKey || (stagedPlan.length === 0 ? existingByPayload : null);

  if (job.state === "completed" || (existingIdemp && existingIdemp.status === "completed")) {
    // Consume step-up grant cleanly without altering business tables.
    await db.batch(stepupAuth.guards);
    const originalResult = existingIdemp?.result_summary_json
      ? JSON.parse(existingIdemp.result_summary_json)
      : JSON.parse(job.result_summary_json || "{}");
    const now = nowIso();
    if (job.state !== "completed") {
      await db.prepare(`UPDATE task29_restore_jobs
        SET state = 'completed', result_summary_json = ?3, stepup_consumed_at = ?4, completed_at = ?4, updated_at = ?4
        WHERE id = ?1 AND user_id = ?2`).bind(job.id, account.id, JSON.stringify(originalResult), now).run();
    }
    await writeAudit(db, {
      userId: account.id,
      jobId: job.id,
      exportId: job.source_export_id,
      action: "restore_idempotent_replay",
      outcome: "skipped_replay",
      details: { idempotency_key: idempKey, original_job_id: existingIdemp?.job_id || job.id },
      requestId: context.data?.requestId || "",
    });
    return {
      ok: true,
      idempotent_replay: true,
      job_id: job.id,
      original_job_id: existingIdemp?.job_id || job.id,
      state: "completed",
      result_summary: originalResult,
    };
  }

  // Atomically consume Step-up grant and move job to 'applying'.
  const nowStart = nowIso();
  try {
    await db.batch([
      ...stepupAuth.guards,
      db.prepare(`UPDATE task29_restore_jobs
        SET state = 'applying', stepup_consumed_at = ?3, updated_at = ?3
        WHERE id = ?1 AND user_id = ?2 AND state IN ('prechecked', 'confirmed')`).bind(job.id, account.id, nowStart),
    ]);
  } catch (err) {
    if (/stepup|atomic_guard|passed = 1/i.test(String(err?.message || ""))) {
      throw new Task29Error("STEPUP_REQUIRED", "安全状态已变化或 Step-up 授权已失效，请重新验证", 403);
    }
    throw err;
  }

  const appliedLog = [];
  const insertedCounts = { total: 0, by_section: {} };
  let liveSkippedCount = 0;

  // Allow deterministic fault injection ONLY in non-production environments when explicitly supplied by automated tests.
  const faultAfterBatch = context.env?.WYJ_ENVIRONMENT !== "production" && Number.isSafeInteger(input.fault_inject_after_batch)
    ? input.fault_inject_after_batch
    : null;

  try {
    // Re-read current user snapshot to detect concurrent writes or concurrent identical inserts.
    const liveSnapshot = await readUserSnapshot(db, account.id, ["finance_core", "finance_review", "notifications_cloud"]);
    const liveLookup = buildExistingLookupMaps(liveSnapshot.data);

    let batchIndex = 0;
    for (let offset = 0; offset < stagedPlan.length; offset += RESTORE_BATCH_SIZE) {
      batchIndex += 1;
      const chunk = stagedPlan.slice(offset, offset + RESTORE_BATCH_SIZE);
      const batchStatements = [];
      const batchLogEntries = [];

      for (const item of chunk) {
        const { section, row } = item;
        const lookup = liveLookup[section] || { byId: new Map(), byNatural: new Map() };
        const liveMatch = findMatchingExisting(section, row, lookup);
        if (liveMatch) {
          const same = stableRecordProjection(section, liveMatch.existing) === stableRecordProjection(section, row);
          if (same) {
            liveSkippedCount += 1;
            continue;
          }
          if (job.conflict_policy === "skip_all_existing") {
            liveSkippedCount += 1;
            continue;
          }
          throw new Task29Error(
            "BACKUP_MIDFLIGHT_CONFLICT",
            `恢复期间检测到记录 ${section}:${recordPrimaryId(section, row)} 在云端发生变更冲突，已触发自动回滚`,
            409,
          );
        }

        const prep = insertStatementForRecord(db, section, row);
        batchStatements.push(prep.stmt);
        batchLogEntries.push({
          section,
          table: tableNameForSection(section),
          pkWhere: prep.pkWhere,
          pkArgs: prep.pkArgs,
          isSharedRate: Boolean(prep.isSharedRate),
          rowId: recordPrimaryId(section, row),
          row,
        });
      }

      if (batchStatements.length > 0) {
        await db.batch(batchStatements);
        for (const entry of batchLogEntries) {
          appliedLog.push({
            section: entry.section,
            table: entry.table,
            pkWhere: entry.pkWhere,
            pkArgs: entry.pkArgs,
            isSharedRate: entry.isSharedRate,
          });
          insertedCounts.total += 1;
          insertedCounts.by_section[entry.section] = (insertedCounts.by_section[entry.section] || 0) + 1;
          // Update in-memory lookup so subsequent batches see parent IDs
          liveLookup[entry.section]?.byId.set(entry.rowId, entry.row);
        }
      }

      await db.prepare(`UPDATE task29_restore_jobs
        SET completed_batches = ?3, applied_log_json = ?4, updated_at = ?5
        WHERE id = ?1 AND user_id = ?2`).bind(job.id, account.id, batchIndex, JSON.stringify(appliedLog), nowIso()).run();

      if (faultAfterBatch !== null && batchIndex >= faultAfterBatch) {
        throw new Task29Error("BACKUP_SIMULATED_WRITE_FAILURE", "模拟恢复中途写入失败以验证回滚", 500, true);
      }
    }

    // Finalize: bump finance server version & emit change log for newly restored finance entities so sync clients converge.
    const doneNow = nowIso();
    await db.prepare(`INSERT OR IGNORE INTO task16_finance_user_versions (user_id, server_version, updated_at) VALUES (?1, 0, ?2)`)
      .bind(account.id, doneNow).run();
    const verRow = await safeFirst(db, "SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1", [account.id]);
    const currentVersion = Number(verRow?.server_version || 0);
    const financeInserted = appliedLog.filter((e) => ["categories", "budgets", "transactions"].includes(e.section));
    const nextVersion = currentVersion + (financeInserted.length > 0 ? 1 : 0);

    const finalizeStatements = [];
    if (financeInserted.length > 0) {
      finalizeStatements.push(
        db.prepare(`UPDATE task16_finance_user_versions SET server_version = ?2, updated_at = ?3
          WHERE user_id = ?1`).bind(account.id, nextVersion, doneNow),
        db.prepare(`INSERT INTO task16_finance_changes (
          user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
        ) VALUES (?1, ?2, 'backup_restore', ?3, 'restore', 1, ?4, ?5)`).bind(
          account.id,
          nextVersion,
          job.id,
          JSON.stringify({
            job_id: job.id,
            inserted_total: insertedCounts.total,
            by_section: insertedCounts.by_section,
          }),
          doneNow,
        ),
        db.prepare(`INSERT INTO task16_finance_audit_logs (
          id, user_id, actor_device_id, action, entity_type, entity_id, before_json, after_json, created_at
        ) VALUES (?1, ?2, 'web-backup', 'backup.restore', 'backup_job', ?3, '{}', ?4, ?5)`).bind(
          `baud_tx_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
          account.id,
          job.id,
          JSON.stringify({ inserted_total: insertedCounts.total, finance_server_version: nextVersion }),
          doneNow,
        ),
      );
    }

    const resultSummary = {
      job_id: job.id,
      inserted_total: insertedCounts.total,
      inserted_by_section: insertedCounts.by_section,
      skipped_identical: Number(precheckSummary.skipped_identical || 0) + liveSkippedCount,
      conflicts_skipped: job.conflict_policy === "skip_all_existing" ? Number(precheckSummary.conflicts || 0) : 0,
      rejected: Number(precheckSummary.rejected || 0),
      finance_server_version: nextVersion,
      completed_at: doneNow,
    };

    finalizeStatements.push(
      db.prepare(`UPDATE task29_restore_jobs
        SET state = 'completed', result_summary_json = ?3, applied_log_json = ?4, completed_at = ?5, updated_at = ?5
        WHERE id = ?1 AND user_id = ?2`).bind(job.id, account.id, JSON.stringify(resultSummary), JSON.stringify(appliedLog), doneNow),
      db.prepare(`INSERT INTO task29_restore_idempotency (
        id, user_id, idempotency_key, backup_sha256, payload_sha256, conflict_policy,
        job_id, status, result_summary_json, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'completed', ?8, ?9, ?9)
      ON CONFLICT(user_id, payload_sha256, conflict_policy) DO UPDATE SET
        idempotency_key = excluded.idempotency_key,
        backup_sha256 = excluded.backup_sha256,
        job_id = excluded.job_id,
        status = 'completed',
        result_summary_json = excluded.result_summary_json,
        updated_at = excluded.updated_at`).bind(
        `brid_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        account.id,
        idempKey,
        job.backup_sha256,
        job.payload_sha256,
        job.conflict_policy,
        job.id,
        JSON.stringify(resultSummary),
        doneNow,
      ),
    );

    if (finalizeStatements.length > 0) {
      await db.batch(finalizeStatements);
    }

    await writeAudit(db, {
      userId: account.id,
      jobId: job.id,
      exportId: job.source_export_id,
      action: "restore_commit",
      outcome: "completed",
      details: resultSummary,
      requestId: context.data?.requestId || "",
    });

    if (await hasTask27(db)) {
      try {
        await db.batch(eventStatements(db, account.id, "backup_restore_completed", account.id, context.data?.requestId || ""));
      } catch (_) {}
    }

    return {
      ok: true,
      idempotent_replay: false,
      job_id: job.id,
      state: "completed",
      result_summary: resultSummary,
    };
  } catch (err) {
    // Compensation rollback: delete ONLY newly inserted records from appliedLog!
    await rollbackAppliedRecords(db, appliedLog);
    const errCode = err instanceof Task29Error ? err.code : "BACKUP_RESTORE_FAILED";
    const errMessage = err?.message || "备份恢复写入失败，已安全回滚本次新建记录";
    const rolledNow = nowIso();
    await db.prepare(`UPDATE task29_restore_jobs
      SET state = 'rolled_back', error_code = ?3, error_message = ?4, applied_log_json = ?5, updated_at = ?6
      WHERE id = ?1 AND user_id = ?2`).bind(
      job.id,
      account.id,
      errCode,
      String(errMessage).slice(0, 400),
      JSON.stringify(appliedLog),
      rolledNow,
    ).run();

    await writeAudit(db, {
      userId: account.id,
      jobId: job.id,
      exportId: job.source_export_id,
      action: "restore_rollback",
      outcome: "rolled_back",
      details: { error_code: errCode, reverted_count: appliedLog.length },
      requestId: context.data?.requestId || "",
    });

    if (await hasTask27(db)) {
      try {
        await db.batch(eventStatements(db, account.id, "backup_restore_rolled_back", account.id, context.data?.requestId || ""));
      } catch (_) {}
    }

    if (err instanceof Task29Error) throw err;
    throw new Task29Error(errCode, errMessage, 500, true, { rolled_back_count: appliedLog.length });
  }
}

export async function getRestoreJob(context, account, jobId) {
  const db = requireDb(context.env?.WYJ_DB);
  const job = await safeFirst(db, "SELECT * FROM task29_restore_jobs WHERE id = ?1 AND user_id = ?2", [jobId, account.id]);
  if (!job) {
    throw new Task29Error("BACKUP_JOB_NOT_FOUND", "恢复作业不存在或无权访问", 404);
  }
  return {
    id: job.id,
    state: job.state,
    conflict_policy: job.conflict_policy,
    source_export_id: job.source_export_id,
    schema_version: job.schema_version,
    container_version: job.container_version,
    scopes: JSON.parse(job.scopes_json || "[]"),
    summary: JSON.parse(job.precheck_summary_json || "{}"),
    diff_preview: JSON.parse(job.diff_preview_json || "{}"),
    result_summary: job.result_summary_json ? JSON.parse(job.result_summary_json) : null,
    total_batches: Number(job.total_batches || 0),
    completed_batches: Number(job.completed_batches || 0),
    error_code: job.error_code || "",
    error_message: job.error_message || "",
    created_at: job.created_at,
    updated_at: job.updated_at,
    expires_at: job.expires_at,
    completed_at: job.completed_at || "",
  };
}

export async function cancelRestoreJob(context, account, jobId) {
  const db = requireDb(context.env?.WYJ_DB);
  const job = await safeFirst(db, "SELECT id, state, source_export_id FROM task29_restore_jobs WHERE id = ?1 AND user_id = ?2", [jobId, account.id]);
  if (!job) {
    throw new Task29Error("BACKUP_JOB_NOT_FOUND", "恢复作业不存在或无权访问", 404);
  }
  if (!["prechecked", "confirmed"].includes(job.state)) {
    throw new Task29Error("BACKUP_JOB_CANNOT_CANCEL", `当前作业状态为 ${job.state}，无法取消`, 409);
  }
  const now = nowIso();
  await db.prepare(`UPDATE task29_restore_jobs SET state = 'cancelled', updated_at = ?3 WHERE id = ?1 AND user_id = ?2`)
    .bind(jobId, account.id, now).run();
  await writeAudit(db, {
    userId: account.id,
    jobId,
    exportId: job.source_export_id || "",
    action: "restore_cancel",
    outcome: "cancelled",
    details: {},
    requestId: context.data?.requestId || "",
  });
  return { ok: true, job_id: jobId, state: "cancelled", updated_at: now };
}
