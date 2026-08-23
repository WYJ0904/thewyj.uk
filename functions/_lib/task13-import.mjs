import {
  COMPATIBLE_PLAN_CODES,
  ENTITLEMENT_CODES,
  OPEN_PAYMENT_STATUSES,
  PAYMENT_STATUSES,
  TASK13_SCHEMA_VERSION,
  Task13Error,
  cleanId,
  cleanNote,
  cleanOrderNumber,
  qrResourceIdFor,
  requireAllowedFields,
  safeJsonArray,
  safeJsonObject,
} from "./task13-model.mjs";
import { __testing as serviceTesting, task13Counts } from "./task13-service.mjs";

const IMPORT_KINDS = new Set([
  "memberships", "entitlement_overrides", "payment_orders", "payment_history",
  "fulfillments", "approvals", "admin_audit",
]);
const PLAN_SET = new Set(COMPATIBLE_PLAN_CODES);
const ENTITLEMENT_SET = new Set(ENTITLEMENT_CODES);
const STATUS_SET = new Set(PAYMENT_STATUSES);
const PLAN_ALIASES = Object.freeze({ monthly: "legacy_all_monthly", lifetime: "legacy_all_lifetime" });
const FORBIDDEN_IMPORT_KEYS = /(?:secret|password|token|session|qr_(?:bytes|content)|base64)/i;

function assertNoForbiddenKeys(value, depth = 0) {
  if (depth > 8) {
    throw new Task13Error("导入内容嵌套过深", 400, "task13_import_depth_invalid");
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_IMPORT_KEYS.test(key)) {
      throw new Task13Error("导入内容包含禁止字段", 400, "task13_import_sensitive_field");
    }
    assertNoForbiddenKeys(item, depth + 1);
  }
}

function stringField(value, maximum, required = false) {
  const text = String(value || "").trim();
  if (required && !text) throw new Task13Error("导入字段不能为空", 400, "task13_import_field_required");
  if (text.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new Task13Error("导入字段无效", 400, "task13_import_field_invalid");
  }
  return text;
}

function timeField(value, required = false) {
  const text = stringField(value, 40, required);
  if (text && !Number.isFinite(Date.parse(text))) {
    throw new Task13Error("导入时间无效", 400, "task13_import_time_invalid");
  }
  return text;
}

function booleanInteger(value) {
  return value ? 1 : 0;
}

function planCode(value) {
  const raw = String(value || "").trim();
  const code = PLAN_ALIASES[raw] || raw;
  if (!PLAN_SET.has(code)) throw new Task13Error("导入会员方案无效", 400, "task13_import_plan_invalid");
  return code;
}

function jsonObjectField(value, maximum = 4000) {
  const object = safeJsonObject(value);
  const encoded = JSON.stringify(object);
  if (encoded.length > maximum) throw new Task13Error("导入 JSON 字段过大", 413, "task13_import_field_too_large");
  return encoded;
}

function jsonArrayField(value, maximum = 4000) {
  const array = safeJsonArray(value);
  const encoded = JSON.stringify(array);
  if (encoded.length > maximum) throw new Task13Error("导入 JSON 字段过大", 413, "task13_import_field_too_large");
  return encoded;
}

function membershipRecord(record) {
  const allowed = new Set([
    "id", "user_id", "plan_code", "starts_at", "expires_at", "is_lifetime", "status",
    "source", "source_ref", "created_by", "metadata", "metadata_json", "created_at", "updated_at",
  ]);
  requireAllowedFields(record, allowed, "task13_import_fields_forbidden");
  const status = stringField(record.status || "active", 20);
  if (!new Set(["active", "expired", "cancelled"]).has(status)) {
    throw new Task13Error("导入会员状态无效", 400, "task13_import_membership_status_invalid");
  }
  const metadata = record.metadata ?? record.metadata_json ?? {};
  return {
    id: cleanId(record.id), user_id: cleanId(record.user_id, "用户标识"), plan_code: planCode(record.plan_code),
    starts_at: timeField(record.starts_at, true), expires_at: timeField(record.expires_at),
    is_lifetime: booleanInteger(record.is_lifetime), status,
    source: stringField(record.source || "legacy_import", 40, true),
    source_ref: stringField(record.source_ref, 120), created_by: stringField(record.created_by, 80),
    metadata_json: jsonObjectField(metadata), created_at: timeField(record.created_at, true),
    updated_at: timeField(record.updated_at, true),
  };
}

function overrideRecord(record) {
  requireAllowedFields(record, new Set([
    "user_id", "entitlement_code", "allowed", "note", "updated_by", "updated_at",
  ]), "task13_import_fields_forbidden");
  const entitlementCode = stringField(record.entitlement_code, 64, true);
  if (!ENTITLEMENT_SET.has(entitlementCode)) {
    throw new Task13Error("导入权益代码无效", 400, "task13_import_entitlement_invalid");
  }
  return {
    user_id: cleanId(record.user_id, "用户标识"), entitlement_code: entitlementCode,
    allowed: booleanInteger(record.allowed), note: cleanNote(record.note),
    updated_by: stringField(record.updated_by, 80), updated_at: timeField(record.updated_at, true),
  };
}

function paymentOrderRecord(record) {
  requireAllowedFields(record, new Set([
    "id", "order_number", "user_id", "username", "username_snapshot", "plan_code",
    "plan_name", "plan_name_snapshot", "amount_cents", "currency", "lifetime_snapshot",
    "duration_months_snapshot", "entitlements_snapshot", "entitlements_snapshot_json",
    "description_snapshot", "trial_language", "payment_method", "qr_resource_id", "payment_note",
    "status", "requested_at", "expires_at", "user_confirmed_at", "processing_at", "handled_at",
    "handled_by", "admin_note", "updated_at",
  ]), "task13_import_fields_forbidden");
  const code = planCode(record.plan_code);
  const orderNumber = cleanOrderNumber(record.order_number);
  const status = stringField(record.status, 40, true);
  if (!STATUS_SET.has(status)) throw new Task13Error("导入订单状态无效", 400, "task13_import_payment_status_invalid");
  const paymentMethod = stringField(record.payment_method, 20);
  const qrResource = stringField(record.qr_resource_id, 120);
  if (paymentMethod || qrResource || OPEN_PAYMENT_STATUSES.includes(status)) {
    if (!new Set(["wechat", "alipay"]).has(paymentMethod)) {
      throw new Task13Error("导入订单支付方式无效", 400, "task13_import_payment_method_invalid");
    }
    if (qrResource !== qrResourceIdFor(paymentMethod, code)) {
      throw new Task13Error("导入订单二维码资源不匹配", 400, "task13_import_payment_qr_invalid");
    }
  }
  const trialLanguage = stringField(record.trial_language, 20);
  if (!new Set(["", "english", "japanese"]).has(trialLanguage)) {
    throw new Task13Error("导入单语言选择无效", 400, "task13_import_trial_language_invalid");
  }
  const amount = Number(record.amount_cents);
  if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) {
    throw new Task13Error("导入订单金额无效", 400, "task13_import_amount_invalid");
  }
  const durationMonths = Number(record.duration_months_snapshot || 0);
  if (!Number.isInteger(durationMonths) || durationMonths < 0 || durationMonths > 1200) {
    throw new Task13Error("导入订单期限无效", 400, "task13_import_duration_invalid");
  }
  return {
    id: cleanId(record.id), order_number: orderNumber,
    user_id: cleanId(record.user_id, "用户标识"),
    username_snapshot: stringField(record.username_snapshot || record.username, 80, true),
    plan_code: code,
    plan_name_snapshot: stringField(record.plan_name_snapshot || record.plan_name || code, 100, true),
    amount_cents: amount, currency: stringField(record.currency || "CNY", 10, true),
    lifetime_snapshot: booleanInteger(record.lifetime_snapshot), duration_months_snapshot: durationMonths,
    entitlements_snapshot_json: jsonArrayField(record.entitlements_snapshot ?? record.entitlements_snapshot_json ?? []),
    description_snapshot: stringField(record.description_snapshot, 500), trial_language: trialLanguage,
    payment_method: paymentMethod, qr_resource_id: qrResource,
    payment_note: stringField(record.payment_note, 500), status,
    requested_at: timeField(record.requested_at, true), expires_at: timeField(record.expires_at),
    user_confirmed_at: timeField(record.user_confirmed_at), processing_at: timeField(record.processing_at),
    handled_at: timeField(record.handled_at), handled_by: stringField(record.handled_by, 80),
    admin_note: stringField(record.admin_note, 500), updated_at: timeField(record.updated_at, true),
  };
}

function historyRecord(record) {
  requireAllowedFields(record, new Set([
    "id", "payment_order_id", "from_status", "to_status", "actor_user_id",
    "actor_username", "note", "created_at",
  ]), "task13_import_fields_forbidden");
  return {
    id: cleanId(record.id), payment_order_id: cleanId(record.payment_order_id, "订单标识"),
    from_status: stringField(record.from_status, 40), to_status: stringField(record.to_status, 40, true),
    actor_user_id: stringField(record.actor_user_id, 80), actor_username: stringField(record.actor_username, 80),
    note: cleanNote(record.note), created_at: timeField(record.created_at, true),
  };
}

function fulfillmentRecord(record) {
  requireAllowedFields(record, new Set([
    "id", "payment_order_id", "user_id", "plan_code", "user_membership_id",
    "source", "source_ref", "fulfilled_at",
  ]), "task13_import_fields_forbidden");
  return {
    id: cleanId(record.id), payment_order_id: cleanId(record.payment_order_id, "订单标识"),
    user_id: cleanId(record.user_id, "用户标识"), plan_code: planCode(record.plan_code),
    user_membership_id: cleanId(record.user_membership_id, "会员记录标识"),
    source: stringField(record.source || "payment", 40, true), source_ref: stringField(record.source_ref, 120, true),
    fulfilled_at: timeField(record.fulfilled_at, true),
  };
}

function approvalRecord(record) {
  requireAllowedFields(record, new Set([
    "id", "payment_order_id", "action", "admin_user_id", "admin_username", "note", "created_at",
  ]), "task13_import_fields_forbidden");
  const action = stringField(record.action, 20, true);
  if (!new Set(["approve", "reject"]).has(action)) {
    throw new Task13Error("导入审批操作无效", 400, "task13_import_approval_invalid");
  }
  return {
    id: cleanId(record.id), payment_order_id: cleanId(record.payment_order_id, "订单标识"), action,
    admin_user_id: cleanId(record.admin_user_id, "管理员标识"),
    admin_username: stringField(record.admin_username, 80, true), note: cleanNote(record.note),
    created_at: timeField(record.created_at, true),
  };
}

function auditRecord(record) {
  requireAllowedFields(record, new Set([
    "id", "actor_user_id", "actor_username", "target_user_id", "target_username",
    "action", "before", "before_json", "after", "after_json", "note", "created_at",
  ]), "task13_import_fields_forbidden");
  return {
    id: cleanId(record.id), actor_user_id: cleanId(record.actor_user_id, "管理员标识"),
    actor_username: stringField(record.actor_username, 80, true),
    target_user_id: stringField(record.target_user_id, 80), target_username: stringField(record.target_username, 80),
    action: stringField(record.action, 80, true),
    before_json: jsonObjectField(record.before ?? record.before_json ?? {}, 12000),
    after_json: jsonObjectField(record.after ?? record.after_json ?? {}, 12000),
    note: cleanNote(record.note), created_at: timeField(record.created_at, true),
  };
}

async function assertUserExists(db, userId) {
  const row = await serviceTesting.first(db, "SELECT id FROM task12_users WHERE id = ?1", [userId]);
  if (!row) throw new Task13Error("导入记录引用了不存在的用户", 409, "task13_import_user_missing");
}

async function importMemberships(db, records) {
  let changed = 0;
  for (const raw of records) {
    const record = membershipRecord(raw);
    await assertUserExists(db, record.user_id);
    const existing = await serviceTesting.first(
      db, "SELECT user_id, plan_code FROM task13_user_memberships WHERE id = ?1", [record.id],
    );
    if (existing && (existing.user_id !== record.user_id || existing.plan_code !== record.plan_code)) {
      throw new Task13Error("会员记录身份与目标数据冲突", 409, "task13_import_identity_conflict");
    }
    const result = await serviceTesting.run(db, `INSERT INTO task13_user_memberships (
      id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
      source, source_ref, created_by, metadata_json, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id, plan_code = excluded.plan_code,
      starts_at = excluded.starts_at, expires_at = excluded.expires_at,
      is_lifetime = excluded.is_lifetime, status = excluded.status,
      source = excluded.source, source_ref = excluded.source_ref,
      created_by = excluded.created_by, metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > task13_user_memberships.updated_at`, Object.values(record));
    changed += Number(result?.meta?.changes || 0);
  }
  return changed;
}

async function importOverrides(db, records) {
  let changed = 0;
  for (const raw of records) {
    const record = overrideRecord(raw);
    await assertUserExists(db, record.user_id);
    const result = await serviceTesting.run(db, `INSERT INTO task13_user_entitlement_overrides (
      user_id, entitlement_code, allowed, note, updated_by, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, entitlement_code) DO UPDATE SET
      allowed = excluded.allowed, note = excluded.note,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
    WHERE excluded.updated_at > task13_user_entitlement_overrides.updated_at`, Object.values(record));
    changed += Number(result?.meta?.changes || 0);
  }
  return changed;
}

async function importPayments(db, records) {
  let changed = 0;
  for (const raw of records) {
    const record = paymentOrderRecord(raw);
    await assertUserExists(db, record.user_id);
    const existing = await serviceTesting.first(
      db, "SELECT user_id, order_number FROM task13_payment_orders WHERE id = ?1", [record.id],
    );
    if (existing && (existing.user_id !== record.user_id || existing.order_number !== record.order_number)) {
      throw new Task13Error("支付订单身份与目标数据冲突", 409, "task13_import_identity_conflict");
    }
    const result = await serviceTesting.run(db, `INSERT INTO task13_payment_orders (
      id, order_number, user_id, username_snapshot, plan_code, plan_name_snapshot,
      amount_cents, currency, lifetime_snapshot, duration_months_snapshot,
      entitlements_snapshot_json, description_snapshot, trial_language,
      payment_method, qr_resource_id, payment_note, status, requested_at,
      expires_at, user_confirmed_at, processing_at, handled_at, handled_by,
      admin_note, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
      ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
    ON CONFLICT(id) DO UPDATE SET
      order_number = excluded.order_number, user_id = excluded.user_id,
      username_snapshot = excluded.username_snapshot, plan_code = excluded.plan_code,
      plan_name_snapshot = excluded.plan_name_snapshot, amount_cents = excluded.amount_cents,
      currency = excluded.currency, lifetime_snapshot = excluded.lifetime_snapshot,
      duration_months_snapshot = excluded.duration_months_snapshot,
      entitlements_snapshot_json = excluded.entitlements_snapshot_json,
      description_snapshot = excluded.description_snapshot, trial_language = excluded.trial_language,
      payment_method = excluded.payment_method, qr_resource_id = excluded.qr_resource_id,
      payment_note = excluded.payment_note, status = excluded.status,
      requested_at = excluded.requested_at, expires_at = excluded.expires_at,
      user_confirmed_at = excluded.user_confirmed_at, processing_at = excluded.processing_at,
      handled_at = excluded.handled_at, handled_by = excluded.handled_by,
      admin_note = excluded.admin_note, updated_at = excluded.updated_at
    WHERE excluded.updated_at > task13_payment_orders.updated_at`, Object.values(record));
    changed += Number(result?.meta?.changes || 0);
  }
  return changed;
}

function importedValuesMatch(existing, record, columns) {
  return columns.every((column) => String(existing?.[column] ?? "") === String(record[column] ?? ""));
}

async function insertOnly(db, records, parser, table, columns, uniqueColumn = "") {
  let changed = 0;
  for (const raw of records) {
    const record = parser(raw);
    const selected = columns.join(", ");
    const existingById = await serviceTesting.first(
      db, `SELECT ${selected} FROM ${table} WHERE id = ?1`, [record.id],
    );
    if (existingById && !importedValuesMatch(existingById, record, columns)) {
      throw new Task13Error("导入记录与目标数据冲突", 409, "task13_import_identity_conflict");
    }
    if (uniqueColumn) {
      const existingByUnique = await serviceTesting.first(
        db, `SELECT ${selected} FROM ${table} WHERE ${uniqueColumn} = ?1`, [record[uniqueColumn]],
      );
      if (existingByUnique && !importedValuesMatch(existingByUnique, record, columns)) {
        throw new Task13Error("导入记录与目标数据冲突", 409, "task13_import_identity_conflict");
      }
    }
    const values = columns.map((column) => record[column]);
    const placeholders = values.map((_, index) => `?${index + 1}`).join(", ");
    const result = await serviceTesting.run(db,
      `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`, values);
    changed += Number(result?.meta?.changes || 0);
  }
  return changed;
}

export async function importTask13Batch(db, actor, payload) {
  requireAllowedFields(payload, new Set(["schema_version", "kind", "records"]), "task13_import_fields_forbidden");
  if (String(payload.schema_version) !== TASK13_SCHEMA_VERSION) {
    throw new Task13Error("导入版本不受支持", 409, "task13_import_schema_unsupported");
  }
  const kind = String(payload.kind || "");
  if (!IMPORT_KINDS.has(kind)) throw new Task13Error("导入数据类型无效", 400, "task13_import_kind_invalid");
  if (!Array.isArray(payload.records) || payload.records.length > 100) {
    throw new Task13Error("单次导入记录数量超出限制", 413, "task13_import_record_limit");
  }
  assertNoForbiddenKeys(payload.records);
  const operations = {
    memberships: () => importMemberships(db, payload.records),
    entitlement_overrides: () => importOverrides(db, payload.records),
    payment_orders: () => importPayments(db, payload.records),
    payment_history: () => insertOnly(db, payload.records, historyRecord, "task13_payment_status_history", [
      "id", "payment_order_id", "from_status", "to_status", "actor_user_id", "actor_username", "note", "created_at",
    ]),
    fulfillments: () => insertOnly(db, payload.records, fulfillmentRecord, "task13_payment_fulfillments", [
      "id", "payment_order_id", "user_id", "plan_code", "user_membership_id", "source", "source_ref", "fulfilled_at",
    ], "payment_order_id"),
    approvals: () => insertOnly(db, payload.records, approvalRecord, "task13_admin_approvals", [
      "id", "payment_order_id", "action", "admin_user_id", "admin_username", "note", "created_at",
    ], "payment_order_id"),
    admin_audit: () => insertOnly(db, payload.records, auditRecord, "task13_admin_audit_logs", [
      "id", "actor_user_id", "actor_username", "target_user_id", "target_username",
      "action", "before_json", "after_json", "note", "created_at",
    ]),
  };
  const changed = await operations[kind]();
  if (changed) {
    await serviceTesting.run(db, `INSERT INTO task13_admin_audit_logs (
      id, actor_user_id, actor_username, action, before_json, after_json, note, created_at
    ) VALUES (?1, ?2, ?3, 'task13_import', '{}', ?4, ?5, ?6)`, [
      crypto.randomUUID(), actor.id, actor.username,
      JSON.stringify({ kind, received: payload.records.length, changed }),
      `SQLite 到 D1 ${kind} 迁移`, new Date().toISOString(),
    ]);
  }
  return { kind, received: payload.records.length, changed };
}

export async function task13ImportCounts(db) {
  return await task13Counts(db);
}

export const __testing = {
  approvalRecord,
  auditRecord,
  fulfillmentRecord,
  historyRecord,
  membershipRecord,
  overrideRecord,
  paymentOrderRecord,
  planCode,
};
