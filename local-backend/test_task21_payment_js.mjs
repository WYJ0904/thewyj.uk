import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask13Request } from "../functions/_lib/task13-api.mjs";
import { qrObjectKeyFor, qrResourceIdFor } from "../functions/_lib/task13-model.mjs";
import { accountMembershipState } from "../functions/_lib/task13-service.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const USER = Object.freeze({
  id: "task21-payment-user",
  username: "task21-payment-user",
  token: "task21-payment-user-token",
});
const LEGACY_ALL_ACCESS_USER = Object.freeze({
  id: "task21-legacy-all-access",
  username: "task21-legacy-all-access",
});
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});
const PRODUCTS = Object.freeze([
  Object.freeze({ plan: "finance_monthly", entitlement: "finance_access", method: "wechat", marker: 0x11 }),
  Object.freeze({ plan: "finance_monthly", entitlement: "finance_access", method: "alipay", marker: 0x12 }),
  Object.freeze({ plan: "notification_archive_access", entitlement: "notification_archive_access", method: "wechat", marker: 0x21 }),
  Object.freeze({ plan: "notification_archive_access", entitlement: "notification_archive_access", method: "alipay", marker: 0x22 }),
]);
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const qrFixture = (marker) => new Uint8Array([...PNG_SIGNATURE, marker, 0x54, 0x32, 0x31]);

async function insertUser(db, user, token = "") {
  const now = new Date().toISOString();
  await db.prepare([
    "INSERT INTO task12_users (",
    "id, username, username_normalized, password_hash, password_scheme,",
    "password_iterations, role, registered_at, created_at, updated_at, source_updated_at",
    ") VALUES (?1, ?2, ?3, '', 'reset_required', 0, 'user', ?4, ?4, ?4, ?4)",
  ].join(" ")).bind(user.id, user.username, user.username.toLowerCase(), now).run();
  if (!token) return;
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task12_sessions (",
    "token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind",
    ") VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')",
  ].join(" ")).bind(await sessionStorageKey(token), user.id, now, expires).run();
}

async function request(db, storage, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleTask13Request({
    env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_STORAGE: storage },
    data: { requestId: crypto.randomUUID() },
    request: new Request("https://preview.thewyj.uk" + route, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  });
  const contentType = response.headers.get("Content-Type") || "";
  return {
    response,
    payload: contentType.startsWith("application/json") ? await response.json() : null,
    bytes: contentType.startsWith("image/") ? new Uint8Array(await response.arrayBuffer()) : null,
  };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task21-payment-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
  d1Persist: runtime,
  r2Persist: runtime,
});

try {
  const db = await mf.getD1Database("WYJ_DB");
  const storage = await mf.getR2Bucket("WYJ_STORAGE");
  const migrations = (await readdir(path.join(ROOT, "cloudflare", "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  const task21Migration = await readFile(
    path.join(ROOT, "cloudflare", "migrations", "0016_notification_archive_payment.sql"),
    "utf8",
  );
  await db.exec(task21Migration.replace(/\r?\n/g, " "));
  const productCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task13_membership_plans WHERE code = 'notification_archive_access'",
  ).first();
  assert.equal(Number(productCount.count), 1, "Task 21 payment migration must be repeatable");
  await insertUser(db, USER, USER.token);
  await insertUser(db, LEGACY_ALL_ACCESS_USER);

  const keys = PRODUCTS.map(({ plan, method }) => qrObjectKeyFor(method, plan));
  assert.equal(new Set(keys).size, 4, "each product and payment method must have a distinct private key");
  assert.doesNotMatch(qrResourceIdFor.toString(), /price|amount|800/iu);
  assert.doesNotMatch(qrObjectKeyFor.toString(), /price|amount|800/iu);
  for (const product of PRODUCTS) {
    await storage.put(qrObjectKeyFor(product.method, product.plan), qrFixture(product.marker), {
      httpMetadata: { contentType: "image/png" },
    });
  }

  const plans = await request(db, storage, "/api/membership/plans");
  assert.equal(plans.response.status, 200);
  assert.equal(plans.payload.plans.length, 8);
  const byCode = new Map(plans.payload.plans.map((plan) => [plan.code, plan]));
  assert.deepEqual(
    {
      name: byCode.get("notification_archive_access").name,
      price_cents: byCode.get("notification_archive_access").price_cents,
      duration_months: byCode.get("notification_archive_access").duration_months,
      entitlements: byCode.get("notification_archive_access").entitlements,
    },
    {
      name: "通知保存",
      price_cents: 800,
      duration_months: 1,
      entitlements: ["notification_archive_access"],
    },
  );
  assert.deepEqual(byCode.get("finance_monthly").entitlements, ["finance_access"]);
  for (const code of ["all_access_monthly", "all_access_lifetime"]) {
    assert.equal(byCode.get(code).entitlements.includes("finance_access"), true);
    assert.equal(byCode.get(code).entitlements.includes("notification_archive_access"), true);
  }

  const observed = [];
  for (const product of PRODUCTS) {
    const created = await request(db, storage, "/api/recharge/request", {
      method: "POST",
      token: USER.token,
      body: { plan: product.plan, payment_method: product.method, trial_language: "" },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    const order = created.payload.request;
    assert.equal(order.plan_code, product.plan);
    assert.equal(order.amount_cents, 800);
    assert.equal(order.payment_method, product.method);
    assert.equal(order.qr_resource_id, qrResourceIdFor(product.method, product.plan));
    assert.equal(order.status, "pending_payment");
    const snapshot = await db.prepare(
      "SELECT entitlements_snapshot_json FROM task13_payment_orders WHERE id = ?1",
    ).bind(order.id).first();
    assert.deepEqual(JSON.parse(snapshot.entitlements_snapshot_json), [product.entitlement]);

    const qr = await request(db, storage, "/api/recharge/qr?request_id=" + order.id, { token: USER.token });
    assert.equal(qr.response.status, 200);
    assert.deepEqual(qr.bytes, qrFixture(product.marker));
    observed.push(Buffer.from(qr.bytes).toString("hex"));

    await storage.delete(qrObjectKeyFor(product.method, product.plan));
    const missing = await request(db, storage, "/api/recharge/qr?request_id=" + order.id, { token: USER.token });
    assert.equal(missing.response.status, 503);
    assert.equal(missing.payload.code, "payment_qr_unavailable");
    const otherConfigured = PRODUCTS.find((candidate) => candidate.plan !== product.plan);
    assert.ok(await storage.head(qrObjectKeyFor(otherConfigured.method, otherConfigured.plan)));

    const cancelled = await request(db, storage, "/api/recharge/cancel", {
      method: "POST",
      token: USER.token,
      body: { request_id: order.id },
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.payload.request.status, "cancelled");
    await storage.put(qrObjectKeyFor(product.method, product.plan), qrFixture(product.marker), {
      httpMetadata: { contentType: "image/png" },
    });
  }
  assert.equal(new Set(observed).size, 4, "equal-price products and payment methods must not share bytes");

  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task13_user_memberships (",
    "id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,",
    "source, source_ref, created_by, metadata_json, created_at, updated_at",
    ") VALUES (?1, ?2, 'all_access_monthly', ?3, ?4, 0, 'active',",
    "'payment', 'legacy-all-access-snapshot', 'system', ?5, ?3, ?3)",
  ].join(" ")).bind(
    "task21-legacy-all-access-membership",
    LEGACY_ALL_ACCESS_USER.id,
    now,
    expiry,
    JSON.stringify({ entitlements_snapshot: ["language_all_access", "tools_access", "all_features_access"] }),
  ).run();
  const compatible = await accountMembershipState(db, {
    id: LEGACY_ALL_ACCESS_USER.id,
    username: LEGACY_ALL_ACCESS_USER.username,
    role: "user",
    is_super_admin: false,
  });
  assert.equal(compatible.entitlements.includes("finance_access"), true);
  assert.equal(compatible.entitlements.includes("notification_archive_access"), true);

  console.log("Task 21 payment checks passed (four product/method mappings, fail-closed assets, all-access compatibility).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
