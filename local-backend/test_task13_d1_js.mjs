import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask13Request } from "../functions/_lib/task13-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { accountMembershipState } from "../functions/_lib/task13-service.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK13_IMPORT_ENABLED: "true",
  TASK13_PRODUCTION_IMPORT_ENABLED: "false",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});
const USERS = Object.freeze({
  admin: { id: "task13-admin", username: "task13-admin", role: "super_admin", token: "task13-admin-token" },
  one: { id: "task13-user-one", username: "task13-user-one", role: "user", token: "task13-user-one-token" },
  two: { id: "task13-user-two", username: "task13-user-two", role: "user", token: "task13-user-two-token" },
  three: { id: "task13-user-three", username: "task13-user-three", role: "user", token: "task13-user-three-token" },
  four: { id: "task13-user-four", username: "task13-user-four", role: "user", token: "task13-user-four-token" },
});
const PLAN_PRICES = Object.freeze({
  trial_single_language: 800,
  dual_language_monthly: 2000,
  tools_monthly: 2000,
  all_access_monthly: 3000,
  japanese_lifetime: 7000,
  all_access_lifetime: 10000,
});
const PNG_FIXTURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x54, 0x41, 0x53, 0x4b, 0x31, 0x33,
]);

function account(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    is_super_admin: user.role === "super_admin",
    banned: false,
    deleted: false,
  };
}

async function insertAccountAndSession(db, user) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, ?4, ?5, ?5, ?5, ?5)`)
    .bind(user.id, user.username, user.username.toLowerCase(), user.role, now).run();
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
    .bind(await sessionStorageKey(user.token), user.id, now, expires).run();
}

async function requestTask13(db, storage, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_STORAGE: storage, ...(options.env || {}) },
    data: { requestId: options.requestId || crypto.randomUUID() },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  };
  const response = await handleTask13Request(context);
  const contentType = response.headers.get("Content-Type") || "";
  return {
    response,
    payload: contentType.startsWith("application/json") ? await response.json() : null,
    bytes: contentType.startsWith("image/") ? new Uint8Array(await response.arrayBuffer()) : null,
  };
}

async function createOrder(db, storage, user, plan, paymentMethod = "wechat", trialLanguage = "") {
  return await requestTask13(db, storage, "/api/recharge/request", {
    method: "POST",
    token: user.token,
    body: { plan, payment_method: paymentMethod, trial_language: trialLanguage },
  });
}

async function confirmOrder(db, storage, user, id) {
  return await requestTask13(db, storage, "/api/recharge/confirm", {
    method: "POST", token: user.token, body: { request_id: id },
  });
}

async function processOrder(db, storage, id, action = "approve") {
  return await requestTask13(db, storage, "/api/admin/recharge/process", {
    method: "POST",
    token: USERS.admin.token,
    body: { request_id: id, action, admin_note: `Task 13 ${action} fixture` },
  });
}

async function membershipState(db, user) {
  return await accountMembershipState(db, account(user));
}

async function tableCount(db, table, where = "", values = []) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).bind(...values).first();
  return Number(row?.count || 0);
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task13-d1-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
  d1Persist: runtime,
  r2Persist: runtime,
});
let completed = 0;

try {
  const db = await mf.getD1Database("WYJ_DB");
  const storage = await mf.getR2Bucket("WYJ_STORAGE");
  for (const filename of [
    "0001_foundation.sql",
    "0002_low_risk_cloud_services.sql",
    "0003_accounts_sessions.sql",
    "0004_session_limit_trigger.sql",
    "0005_session_limit_ordering.sql",
    "0006_memberships_payments.sql",
  ]) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  for (const user of Object.values(USERS)) await insertAccountAndSession(db, user);
  for (const method of ["wechat", "alipay"]) {
    for (const plan of Object.keys(PLAN_PRICES)) {
      await storage.put(`payments/qrcodes/v1/${method}_${plan}.png`, PNG_FIXTURE, {
        httpMetadata: { contentType: "image/png" },
      });
    }
  }

  const plans = await requestTask13(db, storage, "/api/membership/plans");
  assert.equal(plans.response.status, 200);
  assert.equal(plans.payload.plans.length, 6);
  assert.deepEqual(new Set(plans.payload.plans.map((item) => item.code)), new Set(Object.keys(PLAN_PRICES)));
  assert.equal(plans.payload.plans.find((item) => item.code === "japanese_lifetime").name, "双语言双项永久会员");
  assert.equal(plans.payload.plans.some((item) => item.code === "dual_language_lifetime"), false);
  assert.deepEqual(plans.payload.payment_methods.map((item) => item.code), ["wechat", "alipay"]);
  completed += 1;

  for (const [index, [plan, price]] of Object.entries(Object.entries(PLAN_PRICES))) {
    const method = Number(index) % 2 ? "alipay" : "wechat";
    const language = plan === "trial_single_language" ? "english" : "";
    const created = await createOrder(db, storage, USERS.one, plan, method, language);
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.created, true);
    assert.equal(created.payload.request.plan_code, plan);
    assert.equal(created.payload.request.plan_name, plans.payload.plans.find((item) => item.code === plan).name);
    assert.equal(created.payload.request.amount_cents, price);
    assert.equal(created.payload.request.payment_method, method);
    assert.equal(created.payload.request.status, "pending_payment");
    const cancelled = await requestTask13(db, storage, "/api/recharge/cancel", {
      method: "POST", token: USERS.one.token, body: { request_id: created.payload.request.id },
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.payload.request.status, "cancelled");
  }
  completed += 1;

  const retired = await createOrder(db, storage, USERS.one, "dual_language_lifetime", "wechat");
  assert.equal(retired.response.status, 400);
  assert.equal(retired.payload.code, "plan_retired");
  const tampered = await requestTask13(db, storage, "/api/recharge/request", {
    method: "POST",
    token: USERS.one.token,
    body: { plan: "tools_monthly", payment_method: "wechat", amount_cents: 1 },
  });
  assert.equal(tampered.response.status, 400);
  assert.equal(tampered.payload.code, "task13_fields_forbidden");
  const missingMethod = await createOrder(db, storage, USERS.one, "tools_monthly", "");
  assert.equal(missingMethod.response.status, 400);
  assert.equal(missingMethod.payload.code, "payment_method_invalid");
  completed += 1;

  const toolsOrder = await createOrder(db, storage, USERS.one, "tools_monthly", "wechat");
  const toolsId = toolsOrder.payload.request.id;
  const restored = await requestTask13(db, storage, "/api/recharge/mine", { token: USERS.one.token });
  const restoredOrder = restored.payload.requests.find((item) => item.id === toolsId);
  assert.equal(restoredOrder.payment_method, "wechat");
  assert.equal(restoredOrder.plan_name, "工具箱包月会员");
  const ownQr = await requestTask13(db, storage, `/api/recharge/qr?request_id=${toolsId}`, {
    token: USERS.one.token,
  });
  assert.equal(ownQr.response.status, 200);
  assert.deepEqual(ownQr.bytes, PNG_FIXTURE);
  assert.equal(ownQr.response.headers.get("Cache-Control"), "private, no-store");
  const otherQr = await requestTask13(db, storage, `/api/recharge/qr?request_id=${toolsId}`, {
    token: USERS.two.token,
  });
  assert.equal(otherQr.response.status, 404);
  assert.equal(otherQr.payload.code, "payment_not_found");
  const unavailableQr = await requestTask13(db, storage, `/api/recharge/qr?request_id=${toolsId}`, {
    token: USERS.one.token,
    env: { WYJ_STORAGE: null },
  });
  assert.equal(unavailableQr.response.status, 503);
  assert.equal(unavailableQr.payload.code, "payment_qr_unavailable");
  completed += 1;

  const confirmedTools = await confirmOrder(db, storage, USERS.one, toolsId);
  assert.equal(confirmedTools.payload.request.status, "user_paid");
  const beforeToolsApproval = await membershipState(db, USERS.one);
  assert.equal(beforeToolsApproval.entitlements.includes("tools_access"), false);
  const approvedTools = await processOrder(db, storage, toolsId);
  assert.equal(approvedTools.response.status, 200);
  assert.equal(approvedTools.payload.status, "approved");
  const afterToolsApproval = await membershipState(db, USERS.one);
  assert.equal(afterToolsApproval.entitlements.includes("tools_access"), true);
  assert.equal(afterToolsApproval.entitlements.includes("language_english_access"), false);
  const duplicateToolsApproval = await processOrder(db, storage, toolsId);
  assert.equal(duplicateToolsApproval.response.status, 409);
  assert.equal(duplicateToolsApproval.payload.code, "request_already_processed");
  assert.equal(duplicateToolsApproval.payload.committed, true);
  assert.equal(await tableCount(db, "task13_payment_fulfillments", "WHERE payment_order_id = ?1", [toolsId]), 1);
  completed += 1;

  const firstToolsMembership = await db.prepare(`SELECT expires_at FROM task13_user_memberships
    WHERE user_id = ?1 AND plan_code = 'tools_monthly' ORDER BY created_at LIMIT 1`)
    .bind(USERS.one.id).first();
  const renewalOrder = await createOrder(db, storage, USERS.one, "tools_monthly", "alipay");
  await confirmOrder(db, storage, USERS.one, renewalOrder.payload.request.id);
  await processOrder(db, storage, renewalOrder.payload.request.id);
  const renewalMembership = await db.prepare(`SELECT expires_at FROM task13_user_memberships
    WHERE user_id = ?1 AND plan_code = 'tools_monthly' ORDER BY expires_at DESC LIMIT 1`)
    .bind(USERS.one.id).first();
  assert.ok(Date.parse(renewalMembership.expires_at) > Date.parse(firstToolsMembership.expires_at));
  completed += 1;

  const lifetimeOrder = await createOrder(db, storage, USERS.one, "japanese_lifetime", "wechat");
  await confirmOrder(db, storage, USERS.one, lifetimeOrder.payload.request.id);
  await processOrder(db, storage, lifetimeOrder.payload.request.id);
  const lifetimeState = await membershipState(db, USERS.one);
  assert.equal(lifetimeState.entitlements.includes("language_english_access"), true);
  assert.equal(lifetimeState.entitlements.includes("language_japanese_access"), true);
  assert.equal(lifetimeState.entitlements.includes("tools_access"), true, "independent tools membership remains active");
  const lifetimeOnlyState = await membershipState(db, USERS.two);
  assert.equal(lifetimeOnlyState.entitlements.length, 0);
  const lifetimeOnlyOrder = await createOrder(db, storage, USERS.two, "japanese_lifetime", "alipay");
  await confirmOrder(db, storage, USERS.two, lifetimeOnlyOrder.payload.request.id);
  await processOrder(db, storage, lifetimeOnlyOrder.payload.request.id);
  const lifetimeOnly = await membershipState(db, USERS.two);
  assert.equal(lifetimeOnly.entitlements.includes("language_english_access"), true);
  assert.equal(lifetimeOnly.entitlements.includes("language_japanese_access"), true);
  assert.equal(lifetimeOnly.entitlements.includes("tools_access"), false);
  const secondLifetime = await createOrder(db, storage, USERS.two, "japanese_lifetime", "wechat");
  await confirmOrder(db, storage, USERS.two, secondLifetime.payload.request.id);
  await processOrder(db, storage, secondLifetime.payload.request.id);
  assert.equal(await tableCount(
    db, "task13_user_memberships", "WHERE user_id = ?1 AND plan_code = 'japanese_lifetime'", [USERS.two.id],
  ), 1);
  assert.equal(await tableCount(
    db, "task13_payment_fulfillments", "WHERE user_id = ?1 AND plan_code = 'japanese_lifetime'", [USERS.two.id],
  ), 2);
  completed += 1;

  const concurrentOrder = await createOrder(db, storage, USERS.three, "all_access_monthly", "wechat");
  await confirmOrder(db, storage, USERS.three, concurrentOrder.payload.request.id);
  const concurrent = await Promise.all([
    processOrder(db, storage, concurrentOrder.payload.request.id),
    processOrder(db, storage, concurrentOrder.payload.request.id),
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 409]);
  assert.equal(await tableCount(
    db, "task13_payment_fulfillments", "WHERE payment_order_id = ?1", [concurrentOrder.payload.request.id],
  ), 1);
  const concurrentFinal = await db.prepare("SELECT status, processing_token FROM task13_payment_orders WHERE id = ?1")
    .bind(concurrentOrder.payload.request.id).first();
  assert.equal(concurrentFinal.status, "approved");
  assert.equal(concurrentFinal.processing_token, "");
  const concurrentState = await membershipState(db, USERS.three);
  assert.equal(concurrentState.entitlements.includes("all_features_access"), true);
  completed += 1;

  const rejectOrder = await createOrder(db, storage, USERS.four, "dual_language_monthly", "alipay");
  await confirmOrder(db, storage, USERS.four, rejectOrder.payload.request.id);
  const rejected = await processOrder(db, storage, rejectOrder.payload.request.id, "reject");
  assert.equal(rejected.payload.status, "rejected");
  assert.equal((await membershipState(db, USERS.four)).entitlements.length, 0);
  assert.equal(await tableCount(
    db, "task13_payment_fulfillments", "WHERE payment_order_id = ?1", [rejectOrder.payload.request.id],
  ), 0);
  completed += 1;

  const trialOrder = await createOrder(db, storage, USERS.four, "trial_single_language", "wechat", "japanese");
  await confirmOrder(db, storage, USERS.four, trialOrder.payload.request.id);
  await processOrder(db, storage, trialOrder.payload.request.id);
  const trialState = await membershipState(db, USERS.four);
  assert.equal(trialState.entitlements.includes("language_japanese_access"), true);
  assert.equal(trialState.entitlements.includes("language_english_access"), false);
  completed += 1;

  const override = await requestTask13(db, storage, "/api/admin/entitlement", {
    method: "POST",
    token: USERS.admin.token,
    body: { user_id: USERS.two.id, entitlement: "tools_access", allowed: false, note: "Task 13 override" },
  });
  assert.equal(override.response.status, 200);
  assert.equal(override.payload.user.tools_access, false);
  const clearOverride = await requestTask13(db, storage, "/api/admin/entitlement", {
    method: "POST",
    token: USERS.admin.token,
    body: { user_id: USERS.two.id, entitlement: "tools_access", allowed: null, note: "Task 13 clear" },
  });
  assert.equal(clearOverride.response.status, 200);
  const forbiddenAdmin = await requestTask13(db, storage, "/api/admin/recharge", { token: USERS.one.token });
  assert.equal(forbiddenAdmin.response.status, 403);
  completed += 1;

  const importTime = "2026-08-23T00:00:00Z";
  const importedMembership = {
    id: "task13-import-membership-1",
    user_id: USERS.four.id,
    plan_code: "monthly",
    starts_at: importTime,
    expires_at: "2026-09-23T15:59:59Z",
    is_lifetime: false,
    status: "active",
    source: "legacy_import",
    source_ref: "legacy-membership-1",
    created_by: "migration",
    metadata: {},
    created_at: importTime,
    updated_at: importTime,
  };
  const firstImport = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: { schema_version: "1", kind: "memberships", records: [importedMembership] },
  });
  const repeatedImport = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: { schema_version: "1", kind: "memberships", records: [importedMembership] },
  });
  assert.equal(firstImport.payload.changed, 1);
  assert.equal(repeatedImport.payload.changed, 0);
  const importedPlan = await db.prepare("SELECT plan_code FROM task13_user_memberships WHERE id = ?1")
    .bind(importedMembership.id).first();
  assert.equal(importedPlan.plan_code, "legacy_all_monthly");
  const conflictingMembership = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: {
      schema_version: "1",
      kind: "memberships",
      records: [{ ...importedMembership, user_id: USERS.one.id, updated_at: "2026-08-24T00:00:00Z" }],
    },
  });
  assert.equal(conflictingMembership.response.status, 409);
  assert.equal(conflictingMembership.payload.code, "task13_import_identity_conflict");
  const preservedOwner = await db.prepare("SELECT user_id FROM task13_user_memberships WHERE id = ?1")
    .bind(importedMembership.id).first();
  assert.equal(preservedOwner.user_id, USERS.four.id);
  const existingFulfillment = await db.prepare(`SELECT id, payment_order_id, user_id, plan_code,
    user_membership_id, source, source_ref, fulfilled_at
    FROM task13_payment_fulfillments WHERE payment_order_id = ?1`).bind(toolsId).first();
  const repeatedFulfillment = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: { schema_version: "1", kind: "fulfillments", records: [existingFulfillment] },
  });
  assert.equal(repeatedFulfillment.response.status, 200);
  assert.equal(repeatedFulfillment.payload.changed, 0);
  const conflictingFulfillment = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: {
      schema_version: "1",
      kind: "fulfillments",
      records: [{ ...existingFulfillment, id: "task13-conflicting-fulfillment", source_ref: "payment:conflict" }],
    },
  });
  assert.equal(conflictingFulfillment.response.status, 409);
  assert.equal(conflictingFulfillment.payload.code, "task13_import_identity_conflict");
  assert.equal(await tableCount(db, "task13_payment_fulfillments", "WHERE payment_order_id = ?1", [toolsId]), 1);
  const importStatus = await requestTask13(db, storage, "/api/admin/task13/import/status", {
    token: USERS.admin.token,
  });
  assert.ok(importStatus.payload.counts.memberships >= 1);
  completed += 1;

  const snapshotOrder = {
    id: "task13-old-order-1",
    order_number: "LEGACY-OLD-ORDER-1",
    user_id: USERS.four.id,
    username_snapshot: USERS.four.username,
    plan_code: "trial_single_language",
    plan_name_snapshot: "历史单语言体验",
    amount_cents: 500,
    currency: "CNY",
    lifetime_snapshot: false,
    duration_months_snapshot: 1,
    entitlements_snapshot: [],
    description_snapshot: "历史价格快照",
    trial_language: "english",
    payment_method: "",
    qr_resource_id: "",
    payment_note: "",
    status: "approved",
    requested_at: importTime,
    expires_at: "",
    user_confirmed_at: importTime,
    processing_at: importTime,
    handled_at: importTime,
    handled_by: USERS.admin.username,
    admin_note: "历史订单",
    updated_at: importTime,
  };
  const orderImport = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: { schema_version: "1", kind: "payment_orders", records: [snapshotOrder] },
  });
  assert.equal(orderImport.response.status, 200, JSON.stringify(orderImport.payload));
  const ownOrders = await requestTask13(db, storage, "/api/recharge/mine", { token: USERS.four.token });
  const oldOrder = ownOrders.payload.requests.find((item) => item.id === snapshotOrder.id);
  assert.equal(oldOrder.plan_name, "历史单语言体验");
  assert.equal(oldOrder.amount_cents, 500);
  const conflictingOrder = await requestTask13(db, storage, "/api/admin/task13/import", {
    method: "POST", token: USERS.admin.token,
    body: {
      schema_version: "1",
      kind: "payment_orders",
      records: [{ ...snapshotOrder, user_id: USERS.one.id, updated_at: "2026-08-24T00:00:00Z" }],
    },
  });
  assert.equal(conflictingOrder.response.status, 409);
  assert.equal(conflictingOrder.payload.code, "task13_import_identity_conflict");
  const preservedOrderOwner = await db.prepare("SELECT user_id FROM task13_payment_orders WHERE id = ?1")
    .bind(snapshotOrder.id).first();
  assert.equal(preservedOrderOwner.user_id, USERS.four.id);
  completed += 1;

  const productionImport = await requestTask13(db, storage, "/api/admin/task13/import/status", {
    token: USERS.admin.token,
    env: { WYJ_ENVIRONMENT: "production", TASK13_PRODUCTION_IMPORT_ENABLED: "false" },
  });
  assert.equal(productionImport.response.status, 403);
  assert.equal(productionImport.payload.code, "task13_production_import_confirmation_required");
  const writesDisabled = await createOrder(db, storage, USERS.four, "tools_monthly", "wechat");
  assert.notEqual(writesDisabled.payload.source, "legacy");
  const cloudDisabled = await requestTask13(db, storage, "/api/recharge/request", {
    method: "POST",
    token: USERS.four.token,
    body: { plan: "tools_monthly", payment_method: "wechat", trial_language: "" },
    env: { TASK13_PAYMENT_PRIMARY_ENABLED: "false" },
  });
  assert.equal(cloudDisabled.response.status, 503);
  assert.equal(cloudDisabled.payload.code, "task13_cloud_not_enabled");
  completed += 1;

  const auditCount = await tableCount(db, "task13_admin_audit_logs");
  assert.ok(auditCount >= 5);
  const task13Source = await readFile(path.join(ROOT, "functions", "_lib", "task13-api.mjs"), "utf8");
  assert.doesNotMatch(task13Source, /legacy-api|proxyToLegacy|LOCAL_API_BASE/u);
  completed += 1;
  console.log(`Task 13 Miniflare/D1/R2 checks passed: ${completed}`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
