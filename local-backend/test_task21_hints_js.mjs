import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask21Request } from "../functions/_lib/task21-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});

const USER = Object.freeze({ id: "task21-hints-user", username: "task21-hints-user", token: "task21-hints-token" });
const ARCHIVE_ONLY = Object.freeze({ id: "task21-hints-archive", username: "task21-hints-archive", token: "task21-hints-archive-token" });

async function insertUser(db, user, token) {
  const now = new Date().toISOString();
  await db.prepare([
    "INSERT INTO task12_users (",
    "id, username, username_normalized, password_hash, password_scheme,",
    "password_iterations, role, registered_at, created_at, updated_at, source_updated_at",
    ") VALUES (?1, ?2, ?3, '', 'reset_required', 0, 'user', ?4, ?4, ?4, ?4)",
  ].join(" ")).bind(user.id, user.username, user.username.toLowerCase(), now).run();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task12_sessions (",
    "token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind",
    ") VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')",
  ].join(" ")).bind(await sessionStorageKey(token), user.id, now, expires).run();
}

async function grantMembership(db, userId, planCode) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task13_user_memberships (",
    "id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,",
    "source, source_ref, created_by, metadata_json, created_at, updated_at",
    ") VALUES (?1, ?2, ?3, ?4, ?5, 0, 'active', 'admin', ?6, '', '{}', ?4, ?4)",
  ].join(" ")).bind(`membership:${userId}:${planCode}`, userId, planCode, now, expires, `fixture:${planCode}`).run();
}

async function request(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleTask21Request({
    env: { ...ENVIRONMENT, WYJ_DB: db },
    data: { requestId: crypto.randomUUID() },
    request: new Request("https://preview.thewyj.uk" + route, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  });
  let payload = null;
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.startsWith("application/json")) payload = await response.json();
  return { response, payload };
}

function hintBody(sourceEventId, overrides = {}) {
  return {
    device_id: "device-hints-000001",
    hints: [{
      source_event_id: sourceEventId,
      source_type: "notification",
      source_package: "com.tencent.mm",
      app_label: "微信",
      amount_minor: null,
      direction: null,
      merchant: "",
      currency: "CNY",
      confidence: 460,
      recognition_status: "PAYMENT_LIKELY",
      evidence: { source_type: "notification", confidence: 460, reasons: ["wechat_payment_hint_without_amount"] },
      ...overrides,
    }],
  };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task21-hints-"));
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
  const migrations = (await readdir(path.join(ROOT, "cloudflare", "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }

  await insertUser(db, USER, USER.token);
  await insertUser(db, ARCHIVE_ONLY, ARCHIVE_ONLY.token);
  await grantMembership(db, USER.id, "finance_monthly");
  await grantMembership(db, ARCHIVE_ONLY.id, "notification_archive_access");

  // 1. Archive-only account can never create a pending hint (finance boundary).
  const archiveOnly = await request(db, "/api/notification/hints", {
    method: "POST",
    token: ARCHIVE_ONLY.token,
    body: hintBody("evt-hints-archive-1"),
  });
  assert.equal(archiveOnly.response.status, 403);

  // 2. Amount unknown -> a pending hint, and no finance entry.
  const amountUnknown = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-amount-unknown"),
  });
  assert.equal(amountUnknown.response.status, 200, JSON.stringify(amountUnknown.payload));
  assert.equal(amountUnknown.payload.hints[0].state, "pending");
  assert.equal(amountUnknown.payload.hints[0].amount_minor, null);
  const txnAfterHint = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(txnAfterHint.count), 0, "a pending hint must never book a transaction");

  // 3. Direction unknown -> also a pending hint, still no finance entry.
  const directionUnknown = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-direction-unknown", { amount_minor: 2800, direction: null }),
  });
  assert.equal(directionUnknown.response.status, 200, JSON.stringify(directionUnknown.payload));
  assert.equal(directionUnknown.payload.hints[0].amount_minor, 2800);
  assert.equal(directionUnknown.payload.hints[0].direction, null);

  // 4. Duplicate ingest cannot create a second hint.
  const duplicate = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-amount-unknown"),
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.results[0].duplicate, true);
  const hintRows = await db.prepare(
    "SELECT COUNT(*) AS count FROM task21_notification_pending_hints WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(hintRows.count), 2, "duplicate ingest must not add a row");

  // 5. Android and Web read the same pending list.
  const pending = await request(db, "/api/notification/hints?state=pending", { token: USER.token });
  assert.equal(pending.response.status, 200);
  assert.equal(pending.payload.hints.length, 2);
  assert.equal(pending.payload.pending_count, 2);
  const hintId = pending.payload.hints.find((item) => item.source_event_id === "evt-hints-amount-unknown").id;

  // 6. Confirm without an amount is rejected (never invent money).
  const confirmMissingAmount = await request(db, "/api/notification/hints/confirm", {
    method: "POST",
    token: USER.token,
    body: { hint_id: hintId, device_id: "device-hints-000001", edits: { direction: "expense" } },
  });
  assert.equal(confirmMissingAmount.response.status, 400);
  assert.equal(confirmMissingAmount.payload.code, "hint_amount_required");

  // 7. Confirm with amount + direction creates exactly one finance entry.
  const confirmed = await request(db, "/api/notification/hints/confirm", {
    method: "POST",
    token: USER.token,
    body: {
      hint_id: hintId,
      device_id: "device-hints-000001",
      edits: { amount_minor: 10000, direction: "expense", merchant: "示例商户" },
    },
  });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.payload));
  assert.match(confirmed.payload.transaction_id, /^txn:/);
  assert.equal(confirmed.payload.hint.state, "confirmed");
  assert.equal(confirmed.payload.hint.finance_entry_id, confirmed.payload.transaction_id);
  const ledger = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 10000 AND status = 'active'",
  ).bind(USER.id).first();
  assert.equal(Number(ledger.count), 1);

  // 8. Duplicate confirm cannot create a second entry.
  const reconfirm = await request(db, "/api/notification/hints/confirm", {
    method: "POST",
    token: USER.token,
    body: { hint_id: hintId, device_id: "device-hints-000001" },
  });
  assert.equal(reconfirm.response.status, 200);
  assert.equal(reconfirm.payload.no_change, true);
  const ledgerAfter = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 10000 AND status = 'active'",
  ).bind(USER.id).first();
  assert.equal(Number(ledgerAfter.count), 1, "duplicate confirm must not book twice");

  // 9. Re-ingesting a confirmed event cannot revive it as pending.
  await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-amount-unknown"),
  });
  const afterRevive = await request(db, "/api/notification/hints", { token: USER.token });
  assert.equal(afterRevive.payload.hints.length, 1, "confirmed hints leave the pending list");
  const confirmedRow = await db.prepare(
    "SELECT state FROM task21_notification_pending_hints WHERE user_id = ?1 AND id = ?2",
  ).bind(USER.id, hintId).first();
  assert.equal(confirmedRow.state, "confirmed");

  // 10. Ignore removes the hint from pending and it cannot be confirmed later.
  const directionHintId = pending.payload.hints.find(
    (item) => item.source_event_id === "evt-hints-direction-unknown",
  ).id;
  const ignored = await request(db, "/api/notification/hints/ignore", {
    method: "POST",
    token: USER.token,
    body: { hint_id: directionHintId },
  });
  assert.equal(ignored.response.status, 200);
  assert.equal(ignored.payload.hint.state, "ignored");
  const confirmIgnored = await request(db, "/api/notification/hints/confirm", {
    method: "POST",
    token: USER.token,
    body: { hint_id: directionHintId, device_id: "device-hints-000001", edits: { amount_minor: 500, direction: "expense" } },
  });
  assert.equal(confirmIgnored.response.status, 409);
  const finalPending = await request(db, "/api/notification/hints", { token: USER.token });
  assert.equal(finalPending.payload.hints.length, 0);

  // 11. Schema + row counts stay consistent after the whole flow.
  const hintCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task21_notification_pending_hints WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(hintCount.count), 2);
  const financeCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(financeCount.count), 1, "exactly one ledger entry for the whole flow");

  console.log("Task 21 pending-hint checks passed (single pending source, no invented money, idempotent confirm/ignore).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
