import {
  COMPATIBLE_PLAN_CODES,
  ENTITLEMENT_CODES,
  OPEN_PAYMENT_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_ORDER_TTL_HOURS,
  PURCHASABLE_PLAN_CODES,
  QR_VISIBLE_STATUSES,
  TASK13_SCHEMA_VERSION,
  Task13Error,
  cleanId,
  cleanNote,
  cleanOrderNumber,
  hasPngSignature,
  isoNow,
  membershipPayload,
  normalizePaymentMethod,
  paymentOrderPayload,
  publicPlanPayload,
  qrObjectKeyFor,
  qrResourceIdFor,
  safeJsonArray,
  safeJsonObject,
  validateTrialLanguage,
} from "./task13-model.mjs";

const MAX_QR_BYTES = 3 * 1024 * 1024;
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const SOLD_PLAN_SET = new Set(PURCHASABLE_PLAN_CODES);
const COMPATIBLE_PLAN_SET = new Set(COMPATIBLE_PLAN_CODES);
const ENTITLEMENT_SET = new Set(ENTITLEMENT_CODES);
const ALL_ACCESS_ENTITLEMENTS = Object.freeze([...ENTITLEMENT_CODES]);

function requireDatabase(db) {
  if (!db?.prepare) throw new Task13Error("云端会员数据库暂时不可用", 503, "task13_database_unavailable", true);
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

function randomHex(byteLength = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function cleanTime(value, label, options = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace(/[年月日./。-]+/g, " ").trim();
  const parts = normalized.split(/\s+/);
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    const [year, month, day] = parts.map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new Task13Error(`${label}格式无效，请使用年/月/日`, 400, options.code || "membership_time_invalid");
    }
    const currentHongKong = new Date(Date.now() + HONG_KONG_OFFSET_MS);
    const hour = options.endOfDay ? 23 : currentHongKong.getUTCHours();
    const minute = options.endOfDay ? 59 : currentHongKong.getUTCMinutes();
    const second = options.endOfDay ? 59 : currentHongKong.getUTCSeconds();
    return isoNow(new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second)));
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Task13Error(`${label}格式无效，请使用年/月/日`, 400, options.code || "membership_time_invalid");
  }
  return isoNow(parsed);
}

function calendarExpiry(startValue, durationMonths = 1) {
  const source = new Date(startValue || Date.now());
  const shifted = new Date(source.getTime() + HONG_KONG_OFFSET_MS);
  const day = shifted.getUTCDate();
  const monthIndex = shifted.getUTCMonth() + Math.max(1, Number(durationMonths || 1));
  const year = shifted.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoNow(new Date(Date.UTC(year, month, Math.min(day, lastDay), 15, 59, 59)));
}

function membershipMetadata(row) {
  return safeJsonObject(row?.metadata_json);
}

function rowEntitlements(row) {
  const metadata = membershipMetadata(row);
  const snapshot = safeJsonArray(metadata.entitlements_snapshot).filter((code) => ENTITLEMENT_SET.has(code));
  let entitlements;
  if (String(row?.source || "") === "payment"
    && Object.prototype.hasOwnProperty.call(metadata, "entitlements_snapshot")) {
    entitlements = snapshot;
  } else {
    entitlements = String(row?.entitlements_csv || "").split(",").filter((code) => ENTITLEMENT_SET.has(code));
  }
  if (["all_access_monthly", "all_access_lifetime"].includes(String(row?.plan_code || ""))
      || entitlements.includes("all_features_access")) {
    entitlements.push("finance_access");
  }
  return [...new Set(entitlements)];
}

function legacyMembershipCode(membership) {
  if (!membership || membership.plan_code === "tools_monthly") return "free";
  if (membership.plan_code === "trial_single_language") return "trial_single_language";
  return membership.is_lifetime ? "lifetime" : "monthly";
}

function summaryFor(account, memberships, entitlements) {
  if (account?.is_super_admin) {
    return {
      code: "super_admin", name: "超级管理员", label: "超级管理员",
      active: true, permanent: true, lifetime: true, starts_at: "", expires_at: "", tools_access: true,
    };
  }
  const top = memberships[0];
  if (!top) {
    return {
      code: "free", name: "普通注册用户", label: "普通注册用户",
      active: false, permanent: false, lifetime: false, starts_at: "", expires_at: "", tools_access: false,
    };
  }
  return {
    code: top.plan_code,
    name: top.plan_name,
    label: top.plan_name,
    active: true,
    permanent: Boolean(top.is_lifetime),
    lifetime: Boolean(top.is_lifetime),
    starts_at: top.starts_at,
    expires_at: top.expires_at,
    tools_access: entitlements.includes("tools_access"),
  };
}

async function userRow(db, userId) {
  return await first(db, "SELECT * FROM task12_users WHERE id = ?1", [cleanId(userId, "用户标识")]);
}

async function planRow(db, planCode, options = {}) {
  const code = String(planCode || "").trim();
  if (!COMPATIBLE_PLAN_SET.has(code)) throw new Task13Error("充值套餐无效", 400, "plan_invalid");
  const row = await first(db, "SELECT * FROM task13_membership_plans WHERE code = ?1", [code]);
  if (!row) throw new Task13Error("会员方案不存在", 409, "plan_invalid");
  if (options.purchasable && (!row.purchasable || !SOLD_PLAN_SET.has(code))) {
    throw new Task13Error("该会员方案已停止销售，请刷新页面后选择当前可购买方案", 400, "plan_retired");
  }
  return row;
}

async function planEntitlements(db, planCode) {
  return await all(db, `SELECT entitlement_code FROM task13_membership_entitlements
    WHERE plan_code = ?1 ORDER BY entitlement_code`, [String(planCode || "")]);
}

async function expireMemberships(db, userId = "", now = isoNow()) {
  const sql = `UPDATE task13_user_memberships SET status = 'expired', updated_at = ?1
    WHERE status = 'active' AND is_lifetime = 0 AND (expires_at = '' OR expires_at <= ?1)
    ${userId ? "AND user_id = ?2" : ""}`;
  await run(db, sql, userId ? [now, String(userId)] : [now]);
}

async function activeMembershipRows(db, userId) {
  await expireMemberships(db, userId);
  return await all(db, `SELECT membership.*, plan.name AS plan_name, plan.priority,
      GROUP_CONCAT(entitlement.entitlement_code, ',') AS entitlements_csv
    FROM task13_user_memberships AS membership
    JOIN task13_membership_plans AS plan ON plan.code = membership.plan_code
    LEFT JOIN task13_membership_entitlements AS entitlement ON entitlement.plan_code = membership.plan_code
    WHERE membership.user_id = ?1 AND membership.status = 'active'
    GROUP BY membership.id
    ORDER BY plan.priority DESC, membership.is_lifetime DESC,
      membership.expires_at DESC, membership.created_at DESC`, [String(userId)]);
}

function membershipFromRow(row) {
  const metadata = membershipMetadata(row);
  const entitlements = rowEntitlements(row);
  if (row.plan_code === "trial_single_language") {
    if (metadata.language === "english") entitlements.push("language_english_access");
    if (metadata.language === "japanese") entitlements.push("language_japanese_access");
  }
  return membershipPayload(row, [...new Set(entitlements)].sort());
}

async function entitlementOverrides(db, userId) {
  return await all(db, `SELECT entitlement_code, allowed, note, updated_by, updated_at
    FROM task13_user_entitlement_overrides WHERE user_id = ?1 ORDER BY entitlement_code`, [String(userId)]);
}

export async function ensureTask13Schema(db) {
  if (!db?.prepare) return false;
  const row = await first(db, "SELECT value FROM task13_metadata WHERE key = ?1", ["schema_version"]);
  return String(row?.value || "") === TASK13_SCHEMA_VERSION;
}

export async function listMembershipPlans(db, includeHidden = false) {
  const rows = await all(db, `SELECT * FROM task13_membership_plans
    ${includeHidden ? "" : "WHERE purchasable = 1"}
    ORDER BY priority DESC, code`);
  const entitlements = await all(db, `SELECT plan_code, entitlement_code
    FROM task13_membership_entitlements ORDER BY plan_code, entitlement_code`);
  const byPlan = new Map();
  for (const item of entitlements) {
    if (!byPlan.has(item.plan_code)) byPlan.set(item.plan_code, []);
    byPlan.get(item.plan_code).push(item);
  }
  return rows.map((row) => publicPlanPayload(row, byPlan.get(row.code) || []));
}

export function publicPaymentMethods() {
  return PAYMENT_METHODS.map((item) => ({ ...item }));
}

export async function accountMembershipState(db, account) {
  if (!account) return null;
  if (account.is_super_admin) {
    const entitlements = [...ALL_ACCESS_ENTITLEMENTS].sort();
    return {
      membership: "lifetime", membership_start: "", membership_expires: "", trial_language: "",
      memberships: [], entitlements, membership_summary: summaryFor(account, [], entitlements),
      tools_access: true, membership_source: "cloudflare_d1",
    };
  }
  const [rows, overrides] = await Promise.all([
    activeMembershipRows(db, account.id), entitlementOverrides(db, account.id),
  ]);
  const memberships = rows.map(membershipFromRow);
  const entitlementSet = new Set(memberships.flatMap((item) => item.entitlements));
  for (const override of overrides) {
    if (!ENTITLEMENT_SET.has(override.entitlement_code)) continue;
    if (override.allowed) entitlementSet.add(override.entitlement_code);
    else entitlementSet.delete(override.entitlement_code);
  }
  const entitlements = [...entitlementSet].sort();
  const top = memberships[0];
  const membership = legacyMembershipCode(top);
  const trialLanguage = membership === "trial_single_language" ? String(top?.metadata?.language || "") : "";
  return {
    membership,
    membership_start: membership === "free" ? "" : String(top?.starts_at || ""),
    membership_expires: ["free", "lifetime"].includes(membership) ? "" : String(top?.expires_at || ""),
    trial_language: trialLanguage,
    memberships,
    entitlements,
    membership_summary: summaryFor(account, memberships, entitlements),
    tools_access: entitlementSet.has("tools_access"),
    membership_source: "cloudflare_d1",
  };
}

export async function enrichAccountWithTask13(db, account) {
  return { ...account, ...await accountMembershipState(db, account) };
}

async function expirePaymentOrders(db, userId = "") {
  const now = isoNow();
  const rows = await all(db, `SELECT id FROM task13_payment_orders
    WHERE status = 'pending_payment' AND expires_at != '' AND expires_at <= ?1
    ${userId ? "AND user_id = ?2" : ""}`, userId ? [now, String(userId)] : [now]);
  for (const row of rows) {
    const historyId = crypto.randomUUID();
    await db.batch([
      db.prepare(`UPDATE task13_payment_orders SET status = 'expired', handled_at = ?2, updated_at = ?2
        WHERE id = ?1 AND status = 'pending_payment'`).bind(row.id, now),
      db.prepare(`INSERT INTO task13_payment_status_history (
          id, payment_order_id, from_status, to_status, note, created_at
        ) SELECT ?2, id, 'pending_payment', 'expired', '订单超过有效期自动关闭', ?3
          FROM task13_payment_orders WHERE id = ?1 AND status = 'expired'
          AND NOT EXISTS (SELECT 1 FROM task13_payment_status_history
            WHERE payment_order_id = ?1 AND to_status = 'expired')`).bind(row.id, historyId, now),
    ]);
  }
}

async function paymentOrderById(db, orderId, userId = "") {
  const id = cleanId(orderId, "充值订单标识");
  const row = await first(db, `SELECT payment.*, plan.name AS current_plan_name
    FROM task13_payment_orders AS payment
    LEFT JOIN task13_membership_plans AS plan ON plan.code = payment.plan_code
    WHERE payment.id = ?1 ${userId ? "AND payment.user_id = ?2" : ""}`,
  userId ? [id, String(userId)] : [id]);
  return row;
}

function validateStoredPaymentMethod(row) {
  const method = normalizePaymentMethod(row?.payment_method);
  const expected = qrResourceIdFor(method, row?.plan_code);
  if (String(row?.qr_resource_id || "") !== expected) {
    throw new Task13Error("订单支付方式与二维码不一致，请取消订单后重新创建", 409, "payment_qr_mismatch");
  }
  return method;
}

export async function createPaymentOrder(db, account, input) {
  if (!account || account.deleted || account.banned) throw new Task13Error("账户不可用", 403, "account_unavailable");
  if (account.is_super_admin) throw new Task13Error("管理员账户不能购买会员", 409, "payment_user_invalid");
  const plan = await planRow(db, input.plan, { purchasable: true });
  const method = normalizePaymentMethod(input.payment_method);
  const trialLanguage = validateTrialLanguage(plan.code, input.trial_language);
  const qrResourceId = qrResourceIdFor(method, plan.code);
  await expirePaymentOrders(db, account.id);
  const existing = await first(db, `SELECT payment.*, plan.name AS current_plan_name
    FROM task13_payment_orders AS payment
    LEFT JOIN task13_membership_plans AS plan ON plan.code = payment.plan_code
    WHERE payment.user_id = ?1 AND payment.status IN ('pending_payment', 'user_paid', 'processing')
    ORDER BY payment.requested_at DESC LIMIT 1`, [account.id]);
  if (existing) {
    if (existing.plan_code === plan.code && existing.payment_method === method && existing.trial_language === trialLanguage) {
      return { created: false, request: paymentOrderPayload(existing) };
    }
    throw new Task13Error(
      "已有未完成订单，请先取消原订单；已确认付款的订单不能更换支付方式",
      409,
      "payment_order_conflict",
    );
  }
  const entitlementRows = await planEntitlements(db, plan.code);
  const entitlements = plan.code === "trial_single_language"
    ? [] : entitlementRows.map((item) => item.entitlement_code);
  const now = isoNow();
  const expiresAt = isoNow(new Date(Date.now() + PAYMENT_ORDER_TTL_HOURS * 60 * 60 * 1000));
  const id = crypto.randomUUID();
  const orderNumber = `WYJ-${now.slice(0, 10).replace(/-/g, "")}-${randomHex(4)}`;
  const languageLabel = { english: "英语", japanese: "日语" }[trialLanguage] || "";
  const planLabel = languageLabel ? `${plan.name}（${languageLabel}）` : plan.name;
  const paymentNote = `${account.username} ${orderNumber} ${planLabel}`.slice(0, 500);
  try {
    await db.batch([
      db.prepare(`INSERT INTO task13_payment_orders (
        id, order_number, user_id, username_snapshot, plan_code, plan_name_snapshot,
        amount_cents, currency, lifetime_snapshot, duration_months_snapshot,
        entitlements_snapshot_json, description_snapshot, trial_language,
        payment_method, qr_resource_id, payment_note, status,
        requested_at, expires_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
        ?14, ?15, ?16, 'pending_payment', ?17, ?18, ?17)`)
        .bind(
          id, orderNumber, account.id, account.username, plan.code, plan.name,
          Number(plan.price_cents), plan.currency, Number(plan.lifetime), Number(plan.duration_months),
          JSON.stringify(entitlements), plan.description, trialLanguage,
          method, qrResourceId, paymentNote, now, expiresAt,
        ),
      db.prepare(`INSERT INTO task13_payment_status_history (
        id, payment_order_id, from_status, to_status, actor_user_id,
        actor_username, note, created_at
      ) VALUES (?1, ?2, '', 'pending_payment', ?3, ?4,
        '用户确认套餐与支付方式，订单金额已锁定', ?5)`)
        .bind(crypto.randomUUID(), id, account.id, account.username, now),
    ]);
  } catch (error) {
    const raced = await first(db, `SELECT payment.*, plan.name AS current_plan_name
      FROM task13_payment_orders AS payment
      LEFT JOIN task13_membership_plans AS plan ON plan.code = payment.plan_code
      WHERE payment.user_id = ?1 AND payment.status IN ('pending_payment', 'user_paid', 'processing')
      ORDER BY payment.requested_at DESC LIMIT 1`, [account.id]).catch(() => null);
    if (raced && raced.plan_code === plan.code && raced.payment_method === method && raced.trial_language === trialLanguage) {
      return { created: false, request: paymentOrderPayload(raced) };
    }
    if (raced) throw new Task13Error("已有未完成订单，请先处理原订单", 409, "payment_order_conflict");
    throw error;
  }
  return { created: true, request: paymentOrderPayload(await paymentOrderById(db, id)) };
}

export async function confirmPaymentOrder(db, account, orderId) {
  await expirePaymentOrders(db, account.id);
  let row = await paymentOrderById(db, orderId, account.id);
  if (!row) throw new Task13Error("充值订单不存在", 404, "payment_not_found");
  validateStoredPaymentMethod(row);
  if (row.status === "user_paid") return paymentOrderPayload(row);
  if (row.status !== "pending_payment") throw new Task13Error("该订单不能再确认付款", 409, "payment_status_invalid");
  const now = isoNow();
  const results = await db.batch([
    db.prepare(`UPDATE task13_payment_orders SET status = 'user_paid', user_confirmed_at = ?2,
      updated_at = ?2 WHERE id = ?1 AND user_id = ?3 AND status = 'pending_payment'`)
      .bind(row.id, now, account.id),
    db.prepare(`INSERT INTO task13_payment_status_history (
      id, payment_order_id, from_status, to_status, actor_user_id, actor_username, note, created_at
    ) SELECT ?2, id, 'pending_payment', 'user_paid', ?3, ?4, '用户声明已完成付款', ?5
      FROM task13_payment_orders WHERE id = ?1 AND user_id = ?3 AND status = 'user_paid'
      AND NOT EXISTS (SELECT 1 FROM task13_payment_status_history
        WHERE payment_order_id = ?1 AND to_status = 'user_paid')`)
      .bind(row.id, crypto.randomUUID(), account.id, account.username, now),
  ]);
  row = await paymentOrderById(db, row.id, account.id);
  if (!resultChanges(results[0]) && row?.status !== "user_paid") {
    throw new Task13Error("订单状态已变化，请刷新后重试", 409, "payment_status_invalid");
  }
  return paymentOrderPayload(row);
}

export async function cancelPaymentOrder(db, account, orderId) {
  await expirePaymentOrders(db, account.id);
  let row = await paymentOrderById(db, orderId, account.id);
  if (!row) throw new Task13Error("充值订单不存在", 404, "payment_not_found");
  if (row.status === "cancelled") return paymentOrderPayload(row);
  if (row.status !== "pending_payment") {
    throw new Task13Error("该订单已确认付款，不能取消或更换支付方式", 409, "payment_status_invalid");
  }
  const now = isoNow();
  const results = await db.batch([
    db.prepare(`UPDATE task13_payment_orders SET status = 'cancelled', handled_at = ?2,
      updated_at = ?2 WHERE id = ?1 AND user_id = ?3 AND status = 'pending_payment'`)
      .bind(row.id, now, account.id),
    db.prepare(`INSERT INTO task13_payment_status_history (
      id, payment_order_id, from_status, to_status, actor_user_id, actor_username, note, created_at
    ) SELECT ?2, id, 'pending_payment', 'cancelled', ?3, ?4, '用户取消订单', ?5
      FROM task13_payment_orders WHERE id = ?1 AND user_id = ?3 AND status = 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM task13_payment_status_history
        WHERE payment_order_id = ?1 AND to_status = 'cancelled')`)
      .bind(row.id, crypto.randomUUID(), account.id, account.username, now),
  ]);
  row = await paymentOrderById(db, row.id, account.id);
  if (!resultChanges(results[0]) && row?.status !== "cancelled") {
    throw new Task13Error("订单状态已变化，请刷新后重试", 409, "payment_status_invalid");
  }
  return paymentOrderPayload(row);
}

export async function listUserPaymentOrders(db, account) {
  await expirePaymentOrders(db, account.id);
  const rows = await all(db, `SELECT payment.*, plan.name AS current_plan_name
    FROM task13_payment_orders AS payment
    LEFT JOIN task13_membership_plans AS plan ON plan.code = payment.plan_code
    WHERE payment.user_id = ?1 ORDER BY payment.requested_at DESC LIMIT 50`, [account.id]);
  return rows.map(paymentOrderPayload);
}

export async function paymentQrAsset(db, storage, account, orderId) {
  await expirePaymentOrders(db, account.id);
  const row = await paymentOrderById(db, orderId, account.id);
  if (!row) throw new Task13Error("充值订单不存在", 404, "payment_not_found");
  if (!QR_VISIBLE_STATUSES.includes(row.status)) {
    throw new Task13Error("该订单当前不能查看收款二维码", 409, "payment_qr_status_invalid");
  }
  const method = validateStoredPaymentMethod(row);
  if (!storage?.get || !storage?.head) {
    throw new Task13Error("收款二维码存储暂时不可用", 503, "payment_qr_unavailable", true);
  }
  const key = qrObjectKeyFor(method, row.plan_code);
  const metadata = await storage.head(key);
  if (!metadata || metadata.size < 8 || metadata.size > MAX_QR_BYTES) {
    throw new Task13Error("该收款二维码暂不可用，请联系管理员", 503, "payment_qr_unavailable", true);
  }
  const object = await storage.get(key);
  if (!object?.arrayBuffer) throw new Task13Error("该收款二维码暂不可用，请联系管理员", 503, "payment_qr_unavailable", true);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== Number(metadata.size) || !hasPngSignature(bytes)) {
    throw new Task13Error("二维码资源格式无效", 503, "payment_qr_invalid", true);
  }
  return { bytes, etag: object.httpEtag || metadata.httpEtag || "" };
}

async function paymentHistory(db, orderIds) {
  if (!orderIds.length) return new Map();
  const placeholders = orderIds.map((_, index) => `?${index + 1}`).join(",");
  const rows = await all(db, `SELECT payment_order_id, from_status, to_status,
      actor_username, note, created_at FROM task13_payment_status_history
    WHERE payment_order_id IN (${placeholders}) ORDER BY created_at, id`, orderIds);
  const byOrder = new Map();
  for (const row of rows) {
    if (!byOrder.has(row.payment_order_id)) byOrder.set(row.payment_order_id, []);
    byOrder.get(row.payment_order_id).push({
      from_status: row.from_status, to_status: row.to_status,
      actor_username: row.actor_username, note: row.note, created_at: row.created_at,
    });
  }
  return byOrder;
}

export async function listAdminPaymentOrders(db) {
  await expirePaymentOrders(db);
  const rows = await all(db, `SELECT payment.*, plan.name AS current_plan_name
    FROM task13_payment_orders AS payment
    LEFT JOIN task13_membership_plans AS plan ON plan.code = payment.plan_code
    ORDER BY payment.requested_at DESC LIMIT 500`);
  const history = await paymentHistory(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...paymentOrderPayload(row), history: history.get(row.id) || [] }));
}

function effectiveMembershipExpiry(existingRows, now, durationMonths) {
  let base = new Date(now);
  for (const row of existingRows) {
    const expires = new Date(row.expires_at || 0);
    if (Number.isFinite(expires.getTime()) && expires > base) base = expires;
  }
  return calendarExpiry(base, durationMonths);
}

async function matchingActiveMemberships(db, userId, planCode, trialLanguage = "") {
  const rows = await all(db, `SELECT * FROM task13_user_memberships
    WHERE user_id = ?1 AND plan_code = ?2 AND status = 'active'
    ORDER BY is_lifetime DESC, expires_at DESC, created_at DESC`, [userId, planCode]);
  if (planCode !== "trial_single_language") return rows;
  return rows.filter((row) => membershipMetadata(row).language === trialLanguage);
}

function auditSnapshotFromAccount(account) {
  return {
    id: String(account?.id || ""), username: String(account?.username || ""),
    memberships: account?.memberships || [], entitlements: account?.entitlements || [],
    membership_summary: account?.membership_summary || {},
  };
}

export async function processPaymentOrder(db, actor, orderId, actionValue, noteValue = "") {
  const action = String(actionValue || "").trim().toLowerCase();
  if (!new Set(["approve", "reject"]).has(action)) throw new Task13Error("处理操作无效", 400, "action_invalid");
  const adminNote = cleanNote(noteValue);
  const row = await paymentOrderById(db, orderId);
  if (!row) throw new Task13Error("充值申请不存在", 404, "request_not_found");
  if (row.status !== "user_paid") {
    const committed = row.status === "approved" && Boolean(await first(
      db, "SELECT id FROM task13_payment_fulfillments WHERE payment_order_id = ?1", [row.id],
    ));
    throw new Task13Error("只有用户已确认付款的订单可以处理", 409, "request_already_processed", false, committed);
  }
  const target = await userRow(db, row.user_id);
  if (!target || target.deleted || target.banned) throw new Task13Error("订单用户不存在或账户不可用", 409, "payment_user_invalid");
  if (target.role === "super_admin") throw new Task13Error("管理员账户不能购买会员", 409, "payment_user_invalid");
  const plan = await planRow(db, row.plan_code);
  if (!String(row.order_number || "").startsWith("LEGACY-")) validateStoredPaymentMethod(row);
  const now = isoNow();
  const processingToken = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const statements = [
    db.prepare(`UPDATE task13_payment_orders SET status = 'processing', processing_at = ?2,
      updated_at = ?2, handled_by = ?3, admin_note = ?4, processing_token = ?5
      WHERE id = ?1 AND status = 'user_paid'`)
      .bind(row.id, now, actor.username, adminNote, processingToken),
    db.prepare(`INSERT INTO task13_payment_status_history (
      id, payment_order_id, from_status, to_status, actor_user_id, actor_username, note, created_at
    ) SELECT ?2, id, 'user_paid', 'processing', ?3, ?4, ?5, ?6
      FROM task13_payment_orders WHERE id = ?1 AND status = 'processing' AND processing_token = ?7`)
      .bind(row.id, crypto.randomUUID(), actor.id, actor.username, adminNote || "管理员开始核对订单", now, processingToken),
  ];
  let fulfillment = null;
  if (action === "approve") {
    const language = String(row.trial_language || "");
    if (row.plan_code === "trial_single_language" && !new Set(["english", "japanese"]).has(language)) {
      throw new Task13Error("订单缺少有效的单语言选择", 409, "trial_language_invalid");
    }
    const existing = await matchingActiveMemberships(db, row.user_id, row.plan_code, language);
    const reuseLifetime = Boolean(row.lifetime_snapshot && existing.length);
    const membershipId = reuseLifetime ? existing[0].id : crypto.randomUUID();
    const startsAt = now;
    const expiresAt = row.lifetime_snapshot
      ? ""
      : effectiveMembershipExpiry(existing, now, row.duration_months_snapshot || plan.duration_months);
    const snapshotEntitlements = safeJsonArray(row.entitlements_snapshot_json)
      .filter((code) => ENTITLEMENT_SET.has(code));
    const metadata = {
      ...(language ? { language } : {}),
      entitlements_snapshot: snapshotEntitlements,
      plan_name_snapshot: row.plan_name_snapshot,
    };
    if (!reuseLifetime) {
      statements.push(db.prepare(`INSERT INTO task13_user_memberships (
        id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
        source, source_ref, created_by, metadata_json, created_at, updated_at
      ) SELECT ?2, user_id, plan_code, ?3, ?4, lifetime_snapshot, 'active',
        'payment', ?5, ?6, ?7, ?3, ?3 FROM task13_payment_orders
        WHERE id = ?1 AND status = 'processing' AND processing_token = ?8`)
        .bind(
          row.id, membershipId, startsAt, expiresAt, `payment:${row.id}`,
          actor.username, JSON.stringify(metadata), processingToken,
        ));
    }
    const fulfillmentId = crypto.randomUUID();
    statements.push(db.prepare(`INSERT INTO task13_payment_fulfillments (
      id, payment_order_id, user_id, plan_code, user_membership_id, source, source_ref, fulfilled_at
    ) SELECT ?2, id, user_id, plan_code, ?3, 'payment', ?4, ?5
      FROM task13_payment_orders WHERE id = ?1 AND status = 'processing' AND processing_token = ?6`)
      .bind(row.id, fulfillmentId, membershipId, `payment:${row.id}`, now, processingToken));
    fulfillment = { membership_id: membershipId, plan_code: row.plan_code, starts_at: startsAt, expires_at: expiresAt };
  }
  const finalStatus = action === "approve" ? "approved" : "rejected";
  statements.push(
    db.prepare(`INSERT INTO task13_admin_approvals (
      id, payment_order_id, action, admin_user_id, admin_username, note, created_at
    ) SELECT ?2, id, ?3, ?4, ?5, ?6, ?7 FROM task13_payment_orders
      WHERE id = ?1 AND status = 'processing' AND processing_token = ?8`)
      .bind(row.id, approvalId, action, actor.id, actor.username, adminNote, now, processingToken),
    db.prepare(`UPDATE task13_payment_orders SET status = ?2, updated_at = ?3, handled_at = ?3,
      handled_by = ?4, admin_note = ?5 WHERE id = ?1 AND status = 'processing' AND processing_token = ?6`)
      .bind(row.id, finalStatus, now, actor.username, adminNote, processingToken),
    db.prepare(`INSERT INTO task13_payment_status_history (
      id, payment_order_id, from_status, to_status, actor_user_id, actor_username, note, created_at
    ) SELECT ?2, id, 'processing', ?3, ?4, ?5, ?6, ?7 FROM task13_payment_orders
      WHERE id = ?1 AND status = ?3 AND processing_token = ?8`)
      .bind(
        row.id, crypto.randomUUID(), finalStatus, actor.id, actor.username,
        adminNote || (action === "approve" ? "付款核对通过" : "付款核对未通过"), now, processingToken,
      ),
    db.prepare(`INSERT INTO task13_admin_audit_logs (
      id, actor_user_id, actor_username, target_user_id, target_username,
      action, before_json, after_json, note, created_at
    ) SELECT ?2, ?3, ?4, user_id, username_snapshot, ?5, ?6, ?7, ?8, ?9
      FROM task13_payment_orders WHERE id = ?1 AND status = ?10 AND processing_token = ?11`)
      .bind(
        row.id, auditId, actor.id, actor.username,
        action === "approve" ? "payment_approve" : "payment_reject",
        JSON.stringify({ order_number: row.order_number, status: row.status }),
        JSON.stringify({ order_number: row.order_number, status: finalStatus, fulfillment: fulfillment || {} }),
        adminNote, now, finalStatus, processingToken,
      ),
    db.prepare(`UPDATE task13_payment_orders SET processing_token = ''
      WHERE id = ?1 AND status = ?2 AND processing_token = ?3`)
      .bind(row.id, finalStatus, processingToken),
  );
  try {
    const results = await db.batch(statements);
    if (!resultChanges(results[0])) {
      const current = await paymentOrderById(db, row.id);
      const committed = current?.status === "approved" && Boolean(await first(
        db, "SELECT id FROM task13_payment_fulfillments WHERE payment_order_id = ?1", [row.id],
      ));
      throw new Task13Error("充值申请已处理", 409, "request_already_processed", false, committed);
    }
  } catch (error) {
    if (error instanceof Task13Error) throw error;
    const current = await paymentOrderById(db, row.id).catch(() => null);
    const committed = current?.status === "approved" && Boolean(await first(
      db, "SELECT id FROM task13_payment_fulfillments WHERE payment_order_id = ?1", [row.id],
    ).catch(() => null));
    throw new Task13Error(
      committed ? "充值已完成，请刷新查看会员状态" : "充值处理失败，未产生会员变更",
      committed ? 409 : 503,
      committed ? "request_already_processed" : "payment_processing_failed",
      !committed,
      committed,
    );
  }
  return finalStatus;
}

async function targetAccount(db, userId) {
  const row = await userRow(db, userId);
  if (!row || row.deleted) throw new Task13Error("用户不存在", 404, "user_not_found");
  const account = {
    id: String(row.id), username: String(row.username), role: String(row.role || "user"),
    is_super_admin: row.role === "super_admin", banned: Boolean(row.banned), deleted: Boolean(row.deleted),
    registered_at: String(row.registered_at || ""), last_login_at: String(row.last_login_at || ""),
    created_at: String(row.created_at || ""), updated_at: String(row.updated_at || ""),
  };
  if (account.is_super_admin) throw new Task13Error("不能修改固定管理员的会员", 403, "admin_protected");
  return account;
}

export async function adminManageMembership(db, actor, input) {
  const action = String(input.action || "").trim().toLowerCase();
  const planCode = String(input.plan_code || "").trim();
  if (!["grant", "extend", "cancel", "cancel_all"].includes(action)) {
    throw new Task13Error("会员操作无效", 400, "membership_action_invalid");
  }
  const target = await targetAccount(db, input.user_id);
  const before = await enrichAccountWithTask13(db, target);
  const now = isoNow();
  const note = cleanNote(input.note);
  const statements = [];
  let auditAfter = { action, plan_code: planCode };
  if (["grant", "extend", "cancel"].includes(action)) {
    const plan = await planRow(db, planCode, {
      purchasable: action !== "cancel" && input.allow_compatible !== true,
    });
    if (["grant", "extend"].includes(action)) {
      const language = validateTrialLanguage(plan.code, input.trial_language);
      const existingRows = await matchingActiveMemberships(db, target.id, plan.code, language);
      const existing = existingRows[0] || null;
      const rawStart = String(input.membership_start || "").trim();
      const rawExpires = String(input.membership_expires || "").trim();
      let startsAt = rawStart ? cleanTime(rawStart, "会员开始日期", { code: "membership_start_invalid" }) : now;
      let expiresAt = "";
      if (!plan.lifetime) {
        if (action === "extend") {
          startsAt = existing?.starts_at || startsAt;
          expiresAt = rawExpires
            ? cleanTime(rawExpires, "会员截止日期", { endOfDay: true, code: "membership_expires_invalid" })
            : effectiveMembershipExpiry(existingRows, now, plan.duration_months);
        } else {
          expiresAt = rawExpires
            ? cleanTime(rawExpires, "会员截止日期", { endOfDay: true, code: "membership_expires_invalid" })
            : calendarExpiry(startsAt, plan.duration_months);
        }
      }
      const metadata = language ? { language } : {};
      if (existing) {
        statements.push(db.prepare(`UPDATE task13_user_memberships SET starts_at = ?2, expires_at = ?3,
          is_lifetime = ?4, status = 'active', source = 'admin', created_by = ?5,
          metadata_json = ?6, updated_at = ?7 WHERE id = ?1`)
          .bind(existing.id, startsAt, expiresAt, Number(plan.lifetime), actor.username, JSON.stringify(metadata), now));
      } else {
        statements.push(db.prepare(`INSERT INTO task13_user_memberships (
          id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
          source, source_ref, created_by, metadata_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 'admin', ?7, ?8, ?9, ?10, ?10)`)
          .bind(
            crypto.randomUUID(), target.id, plan.code, startsAt, expiresAt, Number(plan.lifetime),
            `admin:${plan.code}`, actor.username, JSON.stringify(metadata), now,
          ));
      }
      auditAfter = { ...auditAfter, starts_at: startsAt, expires_at: expiresAt, trial_language: language };
    } else {
      const compatibleCodes = planCode === "japanese_lifetime"
        ? ["japanese_lifetime", "dual_language_lifetime"] : [planCode];
      const placeholders = compatibleCodes.map((_, index) => `?${index + 3}`).join(",");
      statements.push(db.prepare(`UPDATE task13_user_memberships SET status = 'cancelled', updated_at = ?1
        WHERE user_id = ?2 AND status = 'active' AND plan_code IN (${placeholders})`)
        .bind(now, target.id, ...compatibleCodes));
    }
  } else {
    const preserveBilingualLifetime = Boolean(input.preserve_japanese);
    statements.push(db.prepare(`UPDATE task13_user_memberships SET status = 'cancelled', updated_at = ?1
      WHERE user_id = ?2 AND status = 'active'
      ${preserveBilingualLifetime ? "AND plan_code NOT IN ('japanese_lifetime', 'dual_language_lifetime')" : ""}`)
      .bind(now, target.id));
    auditAfter = { ...auditAfter, preserve_bilingual_lifetime: preserveBilingualLifetime };
  }
  statements.push(db.prepare(`INSERT INTO task13_admin_audit_logs (
    id, actor_user_id, actor_username, target_user_id, target_username,
    action, before_json, after_json, note, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(
      crypto.randomUUID(), actor.id, actor.username, target.id, target.username,
      `membership_${action}`, JSON.stringify(auditSnapshotFromAccount(before)),
      JSON.stringify(auditAfter), note, now,
    ));
  await db.batch(statements);
  return await enrichAccountWithTask13(db, target);
}

export async function adminSetEntitlementOverride(db, actor, input) {
  const target = await targetAccount(db, input.user_id);
  const entitlement = String(input.entitlement || "").trim();
  if (!ENTITLEMENT_SET.has(entitlement)) throw new Task13Error("权益代码无效", 400, "entitlement_invalid");
  if (![true, false, null].includes(input.allowed)) throw new Task13Error("权益覆盖状态无效", 400, "entitlement_allowed_invalid");
  const before = await enrichAccountWithTask13(db, target);
  const now = isoNow();
  const note = cleanNote(input.note);
  const mutation = input.allowed === null
    ? db.prepare(`DELETE FROM task13_user_entitlement_overrides
        WHERE user_id = ?1 AND entitlement_code = ?2`).bind(target.id, entitlement)
    : db.prepare(`INSERT INTO task13_user_entitlement_overrides (
        user_id, entitlement_code, allowed, note, updated_by, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(user_id, entitlement_code) DO UPDATE SET
        allowed = excluded.allowed, note = excluded.note,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(target.id, entitlement, input.allowed ? 1 : 0, note, actor.username, now);
  await db.batch([
    mutation,
    db.prepare(`INSERT INTO task13_admin_audit_logs (
      id, actor_user_id, actor_username, target_user_id, target_username,
      action, before_json, after_json, note, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
      .bind(
        crypto.randomUUID(), actor.id, actor.username, target.id, target.username,
        input.allowed === null ? "entitlement_override_clear" : "entitlement_override",
        JSON.stringify(auditSnapshotFromAccount(before)),
        JSON.stringify({ entitlement, allowed: input.allowed }), note, now,
      ),
  ]);
  return await enrichAccountWithTask13(db, target);
}

export async function listTask13Audit(db, limit = 500) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 500), 500));
  const rows = await all(db, `SELECT * FROM task13_admin_audit_logs
    ORDER BY created_at DESC, id DESC LIMIT ?1`, [safeLimit]);
  return rows.map((row) => ({
    id: row.id, actor_user_id: row.actor_user_id, actor_username: row.actor_username,
    target_user_id: row.target_user_id, target_username: row.target_username,
    action: row.action, before: safeJsonObject(row.before_json), after: safeJsonObject(row.after_json),
    note: row.note, created_at: row.created_at, source: "task13_cloud",
  }));
}

export async function task13Counts(db) {
  const tables = Object.freeze({
    plans: "task13_membership_plans",
    plan_entitlements: "task13_membership_entitlements",
    memberships: "task13_user_memberships",
    entitlement_overrides: "task13_user_entitlement_overrides",
    payment_orders: "task13_payment_orders",
    payment_history: "task13_payment_status_history",
    fulfillments: "task13_payment_fulfillments",
    approvals: "task13_admin_approvals",
    audit_logs: "task13_admin_audit_logs",
  });
  const result = {};
  for (const [key, table] of Object.entries(tables)) {
    const row = await first(db, `SELECT COUNT(*) AS count FROM ${table}`);
    result[key] = Number(row?.count || 0);
  }
  const statusRows = await all(db, `SELECT status, COUNT(*) AS count FROM task13_payment_orders GROUP BY status`);
  result.payment_statuses = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count || 0)]));
  return result;
}

export const __testing = {
  activeMembershipRows,
  all,
  calendarExpiry,
  cleanTime,
  expireMemberships,
  expirePaymentOrders,
  first,
  matchingActiveMemberships,
  planEntitlements,
  planRow,
  resultChanges,
  run,
  validateStoredPaymentMethod,
};
