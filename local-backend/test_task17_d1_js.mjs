import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask13Request } from "../functions/_lib/task13-api.mjs";
import { handleTask16Request } from "../functions/_lib/task16-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { qrObjectKeyFor, qrResourceIdFor } from "../functions/_lib/task13-model.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});
const USERS = Object.freeze({
  admin: { id: "task17-admin", username: "task17-admin", role: "super_admin", token: "task17-admin-token" },
  finance: { id: "task17-finance", username: "task17-finance", role: "user", token: "task17-finance-token" },
  alipay: { id: "task17-alipay", username: "task17-alipay", role: "user", token: "task17-alipay-token" },
  allAccessWechat: { id: "task17-all-wechat", username: "task17-all-wechat", role: "user", token: "task17-all-wechat-token" },
  allAccessAlipay: { id: "task17-all-alipay", username: "task17-all-alipay", role: "user", token: "task17-all-alipay-token" },
  free: { id: "task17-free", username: "task17-free", role: "user", token: "task17-free-token" },
});
const FINANCE_QR_FIXTURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x46, 0x49, 0x4e, 0x41, 0x4e, 0x43, 0x45,
]);
const ALL_ACCESS_QR_FIXTURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x41, 0x4c, 0x4c, 0x2d, 0x41, 0x43, 0x43, 0x45, 0x53, 0x53,
]);

async function insertAccountAndSession(db, user) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
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

async function request(handler, db, storage, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_STORAGE: storage, ...(options.env || {}) },
    data: { requestId: crypto.randomUUID() },
    request: new Request(`https://preview.thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  };
  const response = await handler(context);
  const type = response.headers.get("Content-Type") || "";
  return {
    response,
    payload: type.startsWith("application/json") ? await response.json() : null,
    bytes: type.startsWith("image/") ? new Uint8Array(await response.arrayBuffer()) : null,
  };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task17-d1-"));
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
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  for (const user of Object.values(USERS)) await insertAccountAndSession(db, user);
  for (const method of ["wechat", "alipay"]) {
    await storage.put(qrObjectKeyFor(method, "finance_monthly"), FINANCE_QR_FIXTURE, {
      httpMetadata: { contentType: "image/png" },
    });
    await storage.put(qrObjectKeyFor(method, "all_access_monthly"), ALL_ACCESS_QR_FIXTURE, {
      httpMetadata: { contentType: "image/png" },
    });
  }
  assert.equal(qrResourceIdFor("wechat", "finance_monthly"), "qr-v1:wechat:finance_monthly");
  assert.equal(
    qrObjectKeyFor("wechat", "finance_monthly"),
    "payments/qrcodes/v1/wechat_finance_monthly.png",
  );
  assert.equal(qrObjectKeyFor("alipay", "finance_monthly"), "payments/qrcodes/v1/alipay_finance_monthly.png");
  assert.notEqual(qrObjectKeyFor("wechat", "finance_monthly"), qrObjectKeyFor("wechat", "all_access_monthly"));
  assert.notEqual(qrObjectKeyFor("alipay", "finance_monthly"), qrObjectKeyFor("alipay", "all_access_monthly"));

  const plans = await request(handleTask13Request, db, storage, "/api/membership/plans");
  assert.equal(plans.response.status, 200);
  assert.equal(plans.payload.plans.length, 7);
  const financePlan = plans.payload.plans.find((item) => item.code === "finance_monthly");
  assert.deepEqual({ name: financePlan.name, price_cents: financePlan.price_cents, entitlements: financePlan.entitlements }, {
    name: "财务会员", price_cents: 800, entitlements: ["finance_access"],
  });

  const alipayOrder = await request(handleTask13Request, db, storage, "/api/recharge/request", {
    method: "POST", token: USERS.alipay.token,
    body: { plan: "finance_monthly", payment_method: "alipay", trial_language: "" },
  });
  assert.equal(alipayOrder.response.status, 201, JSON.stringify(alipayOrder.payload));
  assert.equal(alipayOrder.payload.request.payment_method, "alipay");
  const alipayQr = await request(handleTask13Request, db, storage, `/api/recharge/qr?request_id=${alipayOrder.payload.request.id}`, {
    token: USERS.alipay.token,
  });
  assert.equal(alipayQr.response.status, 200);
  assert.deepEqual(alipayQr.bytes, FINANCE_QR_FIXTURE);
  const cancelled = await request(handleTask13Request, db, storage, "/api/recharge/cancel", {
    method: "POST", token: USERS.alipay.token, body: { request_id: alipayOrder.payload.request.id },
  });
  assert.equal(cancelled.payload.request.status, "cancelled");

  for (const [method, user] of [
    ["wechat", USERS.allAccessWechat],
    ["alipay", USERS.allAccessAlipay],
  ]) {
    const allAccessOrder = await request(handleTask13Request, db, storage, "/api/recharge/request", {
      method: "POST", token: user.token,
      body: { plan: "all_access_monthly", payment_method: method, trial_language: "" },
    });
    assert.equal(allAccessOrder.response.status, 201, JSON.stringify(allAccessOrder.payload));
    assert.equal(allAccessOrder.payload.request.amount_cents, 3000);
    assert.equal(allAccessOrder.payload.request.payment_method, method);
    assert.equal(allAccessOrder.payload.request.status, "pending_payment");
    const allAccessQr = await request(
      handleTask13Request,
      db,
      storage,
      `/api/recharge/qr?request_id=${allAccessOrder.payload.request.id}`,
      { token: user.token },
    );
    assert.equal(allAccessQr.response.status, 200);
    assert.deepEqual(allAccessQr.bytes, ALL_ACCESS_QR_FIXTURE);
    assert.notDeepEqual(allAccessQr.bytes, FINANCE_QR_FIXTURE);
    const allAccessCancelled = await request(handleTask13Request, db, storage, "/api/recharge/cancel", {
      method: "POST", token: user.token, body: { request_id: allAccessOrder.payload.request.id },
    });
    assert.equal(allAccessCancelled.payload.request.status, "cancelled");
  }

  const created = await request(handleTask13Request, db, storage, "/api/recharge/request", {
    method: "POST", token: USERS.finance.token,
    body: { plan: "finance_monthly", payment_method: "wechat", trial_language: "" },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.request.amount_cents, 800);
  assert.equal(created.payload.request.payment_method, "wechat");
  assert.equal(created.payload.request.status, "pending_payment");
  const wechatQr = await request(handleTask13Request, db, storage, `/api/recharge/qr?request_id=${created.payload.request.id}`, {
    token: USERS.finance.token,
  });
  assert.equal(wechatQr.response.status, 200);
  assert.deepEqual(wechatQr.bytes, FINANCE_QR_FIXTURE);
  const confirmed = await request(handleTask13Request, db, storage, "/api/recharge/confirm", {
    method: "POST", token: USERS.finance.token, body: { request_id: created.payload.request.id },
  });
  assert.equal(confirmed.payload.request.status, "user_paid");
  const beforeApproval = await request(handleTask16Request, db, storage, "/api/finance/bootstrap", { token: USERS.finance.token });
  assert.equal(beforeApproval.response.status, 403, "clicking paid must not grant finance access");
  const approved = await request(handleTask13Request, db, storage, "/api/admin/recharge/process", {
    method: "POST", token: USERS.admin.token,
    body: { request_id: created.payload.request.id, action: "approve", admin_note: "Task 17 isolated approval" },
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.status, "approved");

  const financeAccess = await request(handleTask16Request, db, storage, "/api/finance/bootstrap", { token: USERS.finance.token });
  assert.equal(financeAccess.response.status, 200);
  assert.equal(financeAccess.payload.finance_access, true);
  const freeAccess = await request(handleTask16Request, db, storage, "/api/finance/bootstrap", { token: USERS.free.token });
  assert.equal(freeAccess.response.status, 403);
  assert.equal(freeAccess.payload.code, "finance_membership_required");

  const entitlementRows = await db.prepare(`SELECT entitlement_code FROM task13_membership_entitlements
    WHERE plan_code = 'finance_monthly' ORDER BY entitlement_code`).all();
  assert.deepEqual(entitlementRows.results.map((item) => item.entitlement_code), ["finance_access"]);
  const history = await db.prepare(`SELECT to_status FROM task13_payment_status_history
    WHERE payment_order_id IN (SELECT id FROM task13_payment_orders WHERE user_id = ?1)
    ORDER BY created_at, id`).bind(USERS.finance.id).all();
  assert.equal(history.results.length, 4);
  assert.deepEqual(new Set(history.results.map((item) => item.to_status)), new Set(["pending_payment", "user_paid", "processing", "approved"]));

  console.log("Task 17 D1 tests passed (plan, WeChat/Alipay QR contract, manual approval, entitlement isolation, finance gate).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
