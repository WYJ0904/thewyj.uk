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

const USERS = Object.freeze({
  subscriber: Object.freeze({ id: "task21-notify-sub", username: "task21-notify-sub", token: "task21-notify-sub-token" }),
  financeOnly: Object.freeze({ id: "task21-finance-only", username: "task21-finance-only", token: "task21-finance-token" }),
  free: Object.freeze({ id: "task21-free", username: "task21-free", token: "task21-free-token" }),
});

const fingerprint = (suffix) => suffix.padStart(64, "0").slice(0, 64);

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

async function grantMembership(db, userId, planCode) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task13_user_memberships (",
    "id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,",
    "source, source_ref, created_by, metadata_json, created_at, updated_at",
    ") VALUES (?1, ?2, ?3, ?4, ?5, 0, 'active', 'admin', ?6, '', '{}', ?4, ?4)",
  ].join(" ")).bind(`task21-${userId}`, userId, planCode, now, expires, `task21-${userId}`).run();
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

function ingestBody(deviceId, operationId, event) {
  return { schema_version: "1", device_id: deviceId, operations: [{ operation_id: operationId, type: "event.ingest", payload: event }] };
}

function transactionEvent(overrides = {}) {
  return {
    event_id: "evt-task21-00000001",
    fingerprint: fingerprint("aa11"),
    source_package: "com.tencent.mm",
    source_type: "notification",
    event_type: "transaction",
    parser_version: "wechat-v1",
    parse_status: "parsed",
    direction: "expense",
    amount_minor: 1280,
    currency: "CNY",
    payment_channel: "wechat",
    merchant: "示例商户",
    counterparty: "示例商户",
    confidence: 950,
    occurred_at_ms: 1_700_000_000_000,
    received_at_ms: 1_700_000_000_100,
    ...overrides,
  };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task21-notify-"));
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

  for (const user of Object.values(USERS)) await insertUser(db, user, user.token);
  await grantMembership(db, USERS.subscriber.id, "notification_archive_access");
  await grantMembership(db, USERS.financeOnly.id, "finance_monthly");

  // 1. Unauthenticated is rejected.
  const anon = await request(db, "/api/notification/events");
  assert.equal(anon.response.status, 401);

  // 2. No entitlement is rejected.
  const freeRead = await request(db, "/api/notification/events", { token: USERS.free.token });
  assert.equal(freeRead.response.status, 403);
  assert.equal(freeRead.payload.code, "notification_membership_required");

  // 3. Finance-only membership must not grant notification archive access.
  const financeRead = await request(db, "/api/notification/events", { token: USERS.financeOnly.token });
  assert.equal(financeRead.response.status, 403);

  // 4. Raw notification content fields are rejected outright.
  const rawReject = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-raw-reject", {
      ...transactionEvent(),
      title: "付款通知",
    }),
  });
  assert.equal(rawReject.response.status, 400);
  assert.equal(rawReject.payload.code, "raw_notification_content_forbidden");

  // 5. High-confidence structured event becomes a finance transaction.
  const high = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-high-1", transactionEvent()),
  });
  assert.equal(high.response.status, 200, JSON.stringify(high.payload));
  assert.equal(high.payload.operation_results[0].duplicate, false);
  assert.match(high.payload.operation_results[0].transaction_id, /^txn:/);
  const financeTxn = await db.prepare(
    "SELECT * FROM task16_finance_transactions WHERE user_id = ?1 AND source_kind = 'automatic'",
  ).bind(USERS.subscriber.id).first();
  assert.ok(financeTxn, "high-confidence event must create a finance transaction");
  assert.equal(financeTxn.direction, "expense");
  assert.equal(financeTxn.amount_minor, 1280);

  // 6. Replaying the same operation is idempotent and does not duplicate finance.
  const replay = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-high-1", transactionEvent()),
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.operation_results[0].idempotent_replay, true);
  const txnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND source_kind = 'automatic'",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(txnCount.count), 1, "replayed ingest must not create a second finance transaction");

  // 7. A different event with the same fingerprint dedupes to the same record.
  const dupFingerprint = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-dup-fingerprint", {
      ...transactionEvent(),
      event_id: "evt-task21-00000002",
    }),
  });
  assert.equal(dupFingerprint.response.status, 200);
  assert.equal(dupFingerprint.payload.operation_results[0].duplicate, true);

  // 8. Low-confidence structured event becomes a review candidate, not finance.
  const low = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-low-1", {
      ...transactionEvent(),
      event_id: "evt-task21-00000003",
      fingerprint: fingerprint("bb22"),
      parse_status: "candidate",
      confidence: 800,
    }),
  });
  assert.equal(low.response.status, 200, JSON.stringify(low.payload));
  assert.match(low.payload.operation_results[0].candidate_id, /^cand:/);
  const candidate = await db.prepare(
    "SELECT * FROM task21_notification_candidates WHERE user_id = ?1 AND status = 'pending'",
  ).bind(USERS.subscriber.id).first();
  assert.ok(candidate, "low-confidence event must create a candidate");

  // 9. Candidate confirm creates a finance transaction; cross-user confirm is rejected.
  const confirm = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: candidate.id, device_id: "device-task21-000001" },
  });
  assert.equal(confirm.response.status, 200, JSON.stringify(confirm.payload));
  assert.match(confirm.payload.transaction_id, /^txn:/);
  const crossConfirm = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.financeOnly.token,
    body: { candidate_id: candidate.id, device_id: "device-task21-000001" },
  });
  assert.equal(crossConfirm.response.status, 403);

  // 10. Malformed amount and unsupported currency are rejected.
  const badAmount = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-bad-amount", {
      ...transactionEvent(),
      event_id: "evt-task21-00000004",
      fingerprint: fingerprint("cc33"),
      amount_minor: -5,
    }),
  });
  assert.equal(badAmount.response.status, 400);
  const badCurrency = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-bad-currency", {
      ...transactionEvent(),
      event_id: "evt-task21-00000005",
      fingerprint: fingerprint("dd44"),
      currency: "XYZ9",
    }),
  });
  assert.equal(badCurrency.response.status, 400);

  // 11. Events and candidates are listed without raw content and are owner-scoped.
  const events = await request(db, "/api/notification/events?limit=50", { token: USERS.subscriber.token });
  assert.equal(events.response.status, 200);
  assert.ok(events.payload.events.length >= 2);
  for (const item of events.payload.events) {
    assert.equal("title" in item, false);
    assert.equal("text" in item, false);
  }
  const candidates = await request(db, "/api/notification/candidates?status=confirmed", { token: USERS.subscriber.token });
  assert.equal(candidates.response.status, 200);
  assert.equal(candidates.payload.candidates.length, 1);

  // 12. Delete is owner-scoped and idempotent.
  const del = await request(db, "/api/notification/events/delete", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { event_id: "evt-task21-00000003" },
  });
  assert.equal(del.response.status, 200);
  assert.equal(del.payload.event.status, "deleted");
  const crossDel = await request(db, "/api/notification/events/delete", {
    method: "POST",
    token: USERS.financeOnly.token,
    body: { event_id: "evt-task21-00000003" },
  });
  assert.equal(crossDel.response.status, 403);

  console.log("Task 21 notification checks passed (privacy boundary, entitlement, idempotent ingest, dedupe, finance integration, candidates).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
