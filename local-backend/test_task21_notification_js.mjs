import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask21Request } from "../functions/_lib/task21-api.mjs";
import { handleTask16Request } from "../functions/_lib/task16-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { __testing as task21Testing } from "../functions/_lib/task21-service.mjs";

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
  archiveOnly: Object.freeze({ id: "task21-archive-only", username: "task21-archive-only", token: "task21-archive-token" }),
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
  ].join(" ")).bind(`task21-${userId}-${planCode}`, userId, planCode, now, expires, `task21-${userId}-${planCode}`).run();
}

async function request(db, route, options = {}, environment = ENVIRONMENT) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleTask21Request({
    env: { ...environment, WYJ_DB: db },
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

async function requestTask16(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleTask16Request({
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
  await grantMembership(db, USERS.subscriber.id, "finance_monthly");
  await grantMembership(db, USERS.financeOnly.id, "finance_monthly");
  await grantMembership(db, USERS.archiveOnly.id, "notification_archive_access");

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
  // Finance-only accounts may still use payment recognition and candidates.
  const financeCandidates = await request(db, "/api/notification/candidates", { token: USERS.financeOnly.token });
  assert.equal(financeCandidates.response.status, 200, JSON.stringify(financeCandidates.payload));
  // Archive-only accounts may read history but must never ingest finance events.
  const archiveEvents = await request(db, "/api/notification/events", { token: USERS.archiveOnly.token });
  assert.equal(archiveEvents.response.status, 200, JSON.stringify(archiveEvents.payload));
  const archiveIngest = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.archiveOnly.token,
    body: ingestBody("device-task21-000001", "op-archive-only", transactionEvent()),
  });
  assert.equal(archiveIngest.response.status, 403);
  assert.equal(archiveIngest.payload.code, "finance_membership_required");

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

  // 5c. Real-device regression: a bank notification/SMS used to be sent with
  // payment_channel "bank" / "bank_sms", which the API rejected with 400
  // payment_channel_invalid. The Android client discarded 4xx answers, so the
  // payment stayed "waiting to sync" forever and Finance stayed at 0 entries.
  const bankEvent = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-bank-01", "op-bank-1", transactionEvent({
      event_id: "evt-task21-bank-00001",
      fingerprint: fingerprint("bb22"),
      source_package: "cmb.pb",
      payment_channel: "bank",
      amount_minor: 5100,
      confidence: 950,
    })),
  });
  assert.equal(bankEvent.response.status, 200, JSON.stringify(bankEvent.payload));
  assert.match(bankEvent.payload.operation_results[0].transaction_id, /^txn:/, "bank payment must book");
  const bankTxn = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 5100 AND source_kind = 'automatic'",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(bankTxn.count), 1, "bank payment must create exactly one transaction");
  // The canonical channel used from 1.2.7 on must work as well.
  const bankCardEvent = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-bank-01", "op-bank-2", transactionEvent({
      event_id: "evt-task21-bank-00002",
      fingerprint: fingerprint("bb33"),
      source_package: "cmb.pb",
      payment_channel: "bank_card",
      amount_minor: 6200,
      confidence: 950,
    })),
  });
  assert.equal(bankCardEvent.response.status, 200, JSON.stringify(bankCardEvent.payload));
  // A payload the server refuses must stay a hard error (the client now keeps
  // it and reports the reason instead of deleting it).
  const invalidChannel = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-bank-01", "op-bank-3", transactionEvent({
      event_id: "evt-task21-bank-00003",
      fingerprint: fingerprint("bb44"),
      payment_channel: "totally_unknown_channel",
    })),
  });
  assert.equal(invalidChannel.response.status, 400);
  assert.equal(invalidChannel.payload.code, "payment_channel_invalid");

  // 5b. Regression: "通知历史已识别支付，但财务显示 0 笔".
  // The automatic booking must be published as a *transaction* change, because
  // an already hydrated Web/Android ledger only projects
  // transaction/category/budget changes and never re-reads the full list.
  const financeChangeFeed = await requestTask16(db, "/api/finance/changes?since=0", {
    token: USERS.subscriber.token,
  });
  assert.equal(financeChangeFeed.response.status, 200, JSON.stringify(financeChangeFeed.payload));
  const transactionChange = (financeChangeFeed.payload.changes || []).find(
    (change) => change.entity_type === "transaction" && change.entity_id === financeTxn.id,
  );
  assert.ok(transactionChange, "automatic booking must reach the ledger change feed as a transaction");
  assert.equal(transactionChange.operation, "upsert");
  assert.equal(Number(transactionChange.version), Number(financeTxn.sync_version));
  assert.equal(transactionChange.payload.transaction.id, financeTxn.id);
  assert.equal(transactionChange.payload.transaction.amount_minor, 1280);
  assert.equal(transactionChange.payload.transaction.direction, "expense");
  assert.equal(transactionChange.payload.transaction.status, "active");
  assert.equal(transactionChange.payload.transaction.source_kind, "automatic");
  assert.equal(Number(transactionChange.payload.transaction.revision), 1);
  // The evidence rows stay in place: raw event + link + audit log.
  const evidence = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transaction_events WHERE transaction_id = ?1 AND relation_status = 'active'",
  ).bind(financeTxn.id).first();
  assert.equal(Number(evidence.count), 1, "automatic booking must keep its evidence link");
  // One change row per version: the transaction change replaces the raw_event row.
  const rawEventChanges = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_changes WHERE user_id = ?1 AND version = ?2 AND entity_type = 'raw_event'",
  ).bind(USERS.subscriber.id, Number(financeTxn.sync_version)).first();
  assert.equal(Number(rawEventChanges.count), 0);

  // 6. Replaying the same operation is idempotent and does not duplicate finance.
  const replay = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-high-1", transactionEvent()),
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.operation_results[0].idempotent_replay, true);
  const txnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND source_kind = 'automatic' AND amount_minor = 1280",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(txnCount.count), 1, "replayed ingest must not create a second finance transaction");

  // A prior D1 failure may leave the event row without its finance outcome.
  // Replaying must finish that exact event instead of treating it as complete.
  const partialEvent = transactionEvent({
    event_id: "evt-task21-partial-01",
    fingerprint: fingerprint("aabb"),
    amount_minor: 1450,
  });
  await task21Testing.storeEvent(db, { id: USERS.subscriber.id }, partialEvent, "device-task21-original");
  const repaired = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-retry-99", "op-partial-retry", partialEvent),
  });
  assert.equal(repaired.response.status, 200, JSON.stringify(repaired.payload));
  assert.equal(repaired.payload.operation_results[0].recovered, true);
  assert.match(repaired.payload.operation_results[0].transaction_id, /^txn:/);
  const partialTxnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 1450",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(partialTxnCount.count), 1);

  // 7. Two real payments with identical text are two events: the content
  // fingerprint must never merge them.
  const dupFingerprint = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-dup-fingerprint", {
      ...transactionEvent(),
      event_id: "evt-task21-00000002",
    }),
  });
  assert.equal(dupFingerprint.response.status, 200);
  assert.equal(dupFingerprint.payload.operation_results[0].duplicate, false);
  assert.equal(dupFingerprint.payload.operation_results[0].event.event_id, "evt-task21-00000002");
  const identicalTextTransactions = await db.prepare(
    `SELECT COUNT(*) AS count FROM task16_finance_transactions
     WHERE user_id = ?1 AND amount_minor = 1280 AND direction = 'expense' AND status = 'active'`,
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(identicalTextTransactions.count), 2, "identical text must stay two real payments");

  // 7b. Replaying the same event id is the duplicate case.
  const replaySameEvent = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-replay-same-event", transactionEvent()),
  });
  assert.equal(replaySameEvent.response.status, 200);
  assert.equal(replaySameEvent.payload.operation_results[0].duplicate, true);

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
  // Another finance-entitled account must not see or confirm this candidate:
  // the lookup is account scoped, so it simply does not exist for them.
  assert.equal(crossConfirm.response.status, 404);
  assert.equal(crossConfirm.payload.code, "notification_candidate_not_found");

  // Confirm is idempotent: a second confirm must not create another finance transaction.
  const confirmedTxnCountBefore = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND source_kind = 'automatic' AND amount_minor = 1280",
  ).bind(USERS.subscriber.id).first();
  const confirmAgain = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: candidate.id, device_id: "device-task21-000001" },
  });
  assert.equal(confirmAgain.response.status, 200);
  assert.equal(confirmAgain.payload.no_change, true);
  const confirmedTxnCountAfter = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND source_kind = 'automatic' AND amount_minor = 1280",
  ).bind(USERS.subscriber.id).first();
  assert.equal(
    Number(confirmedTxnCountAfter.count),
    Number(confirmedTxnCountBefore.count),
    "confirming a candidate twice must not duplicate finance",
  );

  // Reject is idempotent and final: reject then confirm is rejected.
  const reject = await request(db, "/api/notification/candidates/reject", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: candidate.id },
  });
  assert.equal(reject.response.status, 409);
  assert.equal(reject.payload.code, "candidate_status_invalid");

  const rejectPending = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-low-2", {
      ...transactionEvent(),
      event_id: "evt-task21-00000006",
      fingerprint: fingerprint("ee55"),
      parse_status: "candidate",
      confidence: 750,
      amount_minor: 990,
    }),
  });
  const rejectCandidate = await db.prepare(
    "SELECT * FROM task21_notification_candidates WHERE user_id = ?1 AND status = 'pending' AND amount_minor = 990",
  ).bind(USERS.subscriber.id).first();
  const rejectOk = await request(db, "/api/notification/candidates/reject", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: rejectCandidate.id },
  });
  assert.equal(rejectOk.response.status, 200);
  assert.equal(rejectOk.payload.candidate.status, "rejected");
  const rejectAgain = await request(db, "/api/notification/candidates/reject", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: rejectCandidate.id },
  });
  assert.equal(rejectAgain.response.status, 200);
  assert.equal(rejectAgain.payload.no_change, true);
  const rejectedTxn = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 990 AND source_kind = 'automatic'",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(rejectedTxn.count), 0, "rejected candidate must never create a finance transaction");

  const deletePending = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-delete-pending", {
      ...transactionEvent(),
      event_id: "evt-task21-delete-pending",
      fingerprint: fingerprint("de18"),
      parse_status: "candidate",
      confidence: 740,
      amount_minor: 3330,
    }),
  });
  const deletePendingId = deletePending.payload.operation_results[0].candidate_id;
  const deletePendingEvent = await request(db, "/api/notification/events/delete", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { event_id: "evt-task21-delete-pending" },
  });
  assert.equal(deletePendingEvent.response.status, 200);
  const deletedCandidate = await db.prepare(
    "SELECT status FROM task21_notification_candidates WHERE id = ?1",
  ).bind(deletePendingId).first();
  assert.equal(deletedCandidate.status, "rejected", "deleting an event must close its pending candidate");
  const confirmDeleted = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: deletePendingId, device_id: "device-task21-000001" },
  });
  assert.equal(confirmDeleted.response.status, 409);

  // 9b. Real-device regression: "已支付100" normalizes to amount 10000 with a
  // completion verb, so the structured event is parsed at high confidence and
  // must create the finance transaction immediately (no manual confirmation).
  const paid100 = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-paid-100", {
      ...transactionEvent(),
      event_id: "evt-task21-paid-100",
      fingerprint: fingerprint("e101"),
      parser_version: "payment-wechat",
      amount_minor: 10_000,
      confidence: 940,
    }),
  });
  assert.equal(paid100.response.status, 200);
  assert.match(paid100.payload.operation_results[0].transaction_id, /^txn:/, "已支付100 must be booked automatically");
  const paid100Txn = await db.prepare(
    "SELECT * FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 10000",
  ).bind(USERS.subscriber.id).first();
  assert.ok(paid100Txn, "已支付100 must exist in the real finance ledger");
  assert.equal(paid100Txn.direction, "expense");

  // 9c. An amount-known hint ("转账 50") is a real pending candidate; the user
  // confirms it (with an edit) and it lands in the real finance ledger.
  const amountHint = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-amount-hint", {
      ...transactionEvent(),
      event_id: "evt-task21-amount-hint",
      fingerprint: fingerprint("f460"),
      parser_version: "payment-wechat",
      parse_status: "candidate",
      direction: "expense",
      amount_minor: 5000,
      confidence: 700,
    }),
  });
  assert.equal(amountHint.response.status, 200, JSON.stringify(amountHint.payload));
  const hintCandidateId = amountHint.payload.operation_results[0].candidate_id;
  assert.match(hintCandidateId, /^cand:/, "amount-known hint must create a review candidate");
  const hintRow = await db.prepare(
    "SELECT * FROM task21_notification_candidates WHERE id = ?1",
  ).bind(hintCandidateId).first();
  assert.equal(Number(hintRow.amount_minor), 5000);
  assert.equal(hintRow.status, "pending");

  const hintTxnBefore = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 5000",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(hintTxnBefore.count), 0, "a pending candidate must not book before confirmation");

  const confirmHint = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: {
      candidate_id: hintCandidateId,
      device_id: "device-task21-000001",
      edits: { merchant: "待确认转账" },
    },
  });
  assert.equal(confirmHint.response.status, 200, JSON.stringify(confirmHint.payload));
  assert.match(confirmHint.payload.transaction_id, /^txn:/);
  const hintTxnAfter = await db.prepare(
    "SELECT * FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 5000",
  ).bind(USERS.subscriber.id).first();
  assert.ok(hintTxnAfter, "user-confirmed candidate must reach the real finance ledger");

  // Amount-unknown hints are rejected upstream on purpose: the device keeps
  // them in the local enrichment flow and never invents an amount.
  const unknownHint = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-unknown-amount-hint", {
      ...transactionEvent(),
      event_id: "evt-task21-hint-amount",
      fingerprint: fingerprint("f461"),
      parser_version: "payment-wechat",
      parse_status: "candidate",
      direction: "expense",
      amount_minor: 0,
      confidence: 460,
    }),
  });
  assert.equal(unknownHint.response.status, 400, "amount-unknown hints must stay on the device");

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
  // Two candidates confirmed above: the low-confidence one and the
  // amount-unknown hint the user completed with an explicit edit.
  assert.equal(candidates.payload.candidates.length, 2);
  const invalidCandidateFilter = await request(db, "/api/notification/candidates?status=unknown", {
    token: USERS.subscriber.token,
  });
  assert.equal(invalidCandidateFilter.response.status, 400);

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

  // 13. An expired session is rejected and does not leak candidate data.
  const expiredSessionUser = Object.freeze({
    id: "task21-expired-session", username: "task21-expired-session", token: "task21-expired-session-token",
  });
  await insertUser(db, expiredSessionUser);
  await grantMembership(db, expiredSessionUser.id, "notification_archive_access");
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  await db.prepare([
    "INSERT INTO task12_sessions (",
    "token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind",
    ") VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')",
  ].join(" ")).bind(
    await sessionStorageKey(expiredSessionUser.token), expiredSessionUser.id,
    new Date().toISOString(), expiredAt,
  ).run();
  const expiredSessionRead = await request(db, "/api/notification/events", { token: expiredSessionUser.token });
  assert.equal(expiredSessionRead.response.status, 401);

  // 14. A lapsed entitlement denies confirm and never creates finance records.
  const lapsedUser = Object.freeze({
    id: "task21-lapsed-entitlement", username: "task21-lapsed-entitlement", token: "task21-lapsed-entitlement-token",
  });
  await insertUser(db, lapsedUser, lapsedUser.token);
  await grantMembership(db, lapsedUser.id, "notification_archive_access");
  await grantMembership(db, lapsedUser.id, "finance_monthly");
  const lapsedIngest = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: lapsedUser.token,
    body: ingestBody("device-task21-000002", "op-lapsed-1", {
      ...transactionEvent(),
      event_id: "evt-task21-00000007",
      fingerprint: fingerprint("ff66"),
      parse_status: "candidate",
      confidence: 750,
    }),
  });
  assert.equal(lapsedIngest.response.status, 200, JSON.stringify(lapsedIngest.payload));
  const lapsedCandidateId = lapsedIngest.payload.operation_results[0].candidate_id;
  assert.match(lapsedCandidateId, /^cand:/);
  await db.prepare(
    // Payment recognition belongs to finance_access, so the finance membership
    // is the one that lapses here.
    "UPDATE task13_user_memberships SET expires_at = ?1 WHERE user_id = ?2 AND plan_code = 'finance_monthly'",
  ).bind(new Date(Date.now() - 60_000).toISOString(), lapsedUser.id).run();
  const lapsedConfirm = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: lapsedUser.token,
    body: { candidate_id: lapsedCandidateId, device_id: "device-task21-000002" },
  });
  assert.equal(lapsedConfirm.response.status, 403);
  assert.equal(lapsedConfirm.payload.code, "finance_membership_required");
  const lapsedTxnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1",
  ).bind(lapsedUser.id).first();
  assert.equal(Number(lapsedTxnCount.count), 0, "expired entitlement must not create finance transactions");
  // The archive membership is still active, so history remains readable.
  const lapsedEvents = await request(db, "/api/notification/events", { token: lapsedUser.token });
  assert.equal(lapsedEvents.response.status, 200, JSON.stringify(lapsedEvents.payload));

  // 15. Reject then confirm is rejected: rejected candidates are terminal.
  const rejectedConfirm = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: rejectCandidate.id, device_id: "device-task21-000001" },
  });
  assert.equal(rejectedConfirm.response.status, 409);
  assert.equal(rejectedConfirm.payload.code, "candidate_status_invalid");

  // 16. Two clients confirming concurrently produce exactly one finance transaction.
  const concurrent = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-concurrent-1", {
      ...transactionEvent(),
      event_id: "evt-task21-00000008",
      fingerprint: fingerprint("aa77"),
      parse_status: "candidate",
      confidence: 760,
      amount_minor: 2220,
    }),
  });
  assert.equal(concurrent.response.status, 200, JSON.stringify(concurrent.payload));
  const concurrentCandidateId = concurrent.payload.operation_results[0].candidate_id;
  const [firstConfirm, secondConfirm] = await Promise.all([
    request(db, "/api/notification/candidates/confirm", {
      method: "POST",
      token: USERS.subscriber.token,
      body: { candidate_id: concurrentCandidateId, device_id: "device-task21-000001" },
    }),
    request(db, "/api/notification/candidates/confirm", {
      method: "POST",
      token: USERS.subscriber.token,
      body: { candidate_id: concurrentCandidateId, device_id: "device-task21-000003" },
    }),
  ]);
  // A racing writer may be asked to retry, but every confirm either succeeds,
  // reports an idempotent no-op, or is retryable — never a partial double entry.
  assert.ok([200, 409, 503].includes(firstConfirm.response.status), JSON.stringify(firstConfirm.payload));
  assert.ok([200, 409, 503].includes(secondConfirm.response.status), JSON.stringify(secondConfirm.payload));
  const settledConfirm = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: { candidate_id: concurrentCandidateId, device_id: "device-task21-000001" },
  });
  assert.equal(settledConfirm.response.status, 200, JSON.stringify(settledConfirm.payload));
  const concurrentTxnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 2220 AND source_kind = 'automatic'",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(concurrentTxnCount.count), 1, "concurrent confirms must create exactly one finance transaction");

  // 17. Feature flag off keeps every Task 21 route fail-closed.
  const flagsOff = {
    ...ENVIRONMENT,
    TASK21_NOTIFICATION_READS_ENABLED: "false",
    TASK21_NOTIFICATION_WRITES_ENABLED: "false",
  };
  const readOff = await request(db, "/api/notification/events", { token: USERS.subscriber.token }, flagsOff);
  assert.equal(readOff.response.status, 503);
  assert.equal(readOff.payload.code, "task21_notification_not_enabled");
  const writeOff = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-flag-off", transactionEvent()),
  }, flagsOff);
  assert.equal(writeOff.response.status, 503);
  assert.equal(writeOff.payload.code, "task21_notification_not_enabled");
  const candidatesOff = await request(db, "/api/notification/candidates", { token: USERS.subscriber.token }, flagsOff);
  assert.equal(candidatesOff.response.status, 503);

  // 18. Multi-source evidence: a bank SMS describing the same payment links to
  // the existing candidate instead of creating a second one.
  const multiPrimary = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-multi-primary", {
      ...transactionEvent(),
      event_id: "evt-task21-00000101",
      fingerprint: fingerprint("bb01"),
      parse_status: "candidate",
      confidence: 700,
      amount_minor: 3360,
      occurred_at_ms: 1_700_000_100_000,
      received_at_ms: 1_700_000_100_100,
    }),
  });
  assert.equal(multiPrimary.response.status, 200, JSON.stringify(multiPrimary.payload));
  const multiCandidateId = multiPrimary.payload.operation_results[0].candidate_id;
  assert.match(multiCandidateId, /^cand:/);

  const multiEvidence = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-multi-evidence", {
      ...transactionEvent(),
      event_id: "evt-task21-00000102",
      fingerprint: fingerprint("bb02"),
      source_package: "com.chinamworld.main",
      source_type: "sms",
      parser_version: "bank-sms-2",
      parse_status: "candidate",
      confidence: 720,
      amount_minor: 3360,
      occurred_at_ms: 1_700_000_130_000,
      received_at_ms: 1_700_000_130_100,
    }),
  });
  assert.equal(multiEvidence.response.status, 200, JSON.stringify(multiEvidence.payload));
  assert.equal(
    multiEvidence.payload.operation_results[0].candidate_id,
    multiCandidateId,
    "a second source describing the same payment must reuse the candidate",
  );
  const evidenceRows = await db.prepare(
    "SELECT event_id, source_type, candidate_id FROM task21_notification_evidence WHERE user_id = ?1 AND candidate_id = ?2 ORDER BY event_id",
  ).bind(USERS.subscriber.id, multiCandidateId).all();
  assert.equal(evidenceRows.results.length, 2, "both sources must be kept as evidence");
  assert.equal(evidenceRows.results[0].source_type, "notification");
  assert.equal(evidenceRows.results[1].source_type, "sms");
  const multiCandidate = await db.prepare(
    "SELECT evidence_count, amount_minor FROM task21_notification_candidates WHERE user_id = ?1 AND id = ?2",
  ).bind(USERS.subscriber.id, multiCandidateId).first();
  assert.equal(Number(multiCandidate.evidence_count), 2);
  assert.equal(Number(multiCandidate.amount_minor), 3360);

  // 18b. A different amount in the same window stays a separate candidate.
  const differentAmount = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-multi-different", {
      ...transactionEvent(),
      event_id: "evt-task21-00000103",
      fingerprint: fingerprint("bb03"),
      parse_status: "candidate",
      confidence: 700,
      amount_minor: 3370,
      occurred_at_ms: 1_700_000_140_000,
      received_at_ms: 1_700_000_140_100,
    }),
  });
  assert.equal(differentAmount.response.status, 200);
  assert.notEqual(differentAmount.payload.operation_results[0].candidate_id, multiCandidateId);

  // 18c. The same source with the same amount inside the window may be two real
  // payments, so it must stay a separate candidate (only cross-source evidence
  // merges).
  const sameSourceAgain = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-multi-same-source", {
      ...transactionEvent(),
      event_id: "evt-task21-00000105",
      fingerprint: fingerprint("bb05"),
      parse_status: "candidate",
      confidence: 700,
      amount_minor: 3360,
      occurred_at_ms: 1_700_000_150_000,
      received_at_ms: 1_700_000_150_100,
    }),
  });
  assert.equal(sameSourceAgain.response.status, 200);
  assert.notEqual(
    sameSourceAgain.payload.operation_results[0].candidate_id,
    multiCandidateId,
    "two payments from the same source must stay two candidates",
  );

  // 19. Edit before confirm: the user's values win, machine evidence is kept.
  const editable = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", "op-edit-before-confirm", {
      ...transactionEvent(),
      event_id: "evt-task21-00000104",
      fingerprint: fingerprint("cc01"),
      parse_status: "candidate",
      confidence: 640,
      amount_minor: 2000,
      direction: "expense",
      occurred_at_ms: 1_700_000_200_000,
      received_at_ms: 1_700_000_200_100,
    }),
  });
  const editableCandidateId = editable.payload.operation_results[0].candidate_id;
  const editedConfirm = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: {
      candidate_id: editableCandidateId,
      device_id: "device-task21-000001",
      edits: { amount_minor: 1850, direction: "income", merchant: "修正商户", note: "用户修正" },
    },
  });
  assert.equal(editedConfirm.response.status, 200, JSON.stringify(editedConfirm.payload));
  assert.deepEqual(editedConfirm.payload.edited_fields.sort(), ["amount_minor", "direction", "merchant", "note"]);
  const editedTransaction = await db.prepare(
    `SELECT direction, amount_minor, merchant FROM task16_finance_transactions
     WHERE user_id = ?1 AND id = ?2`,
  ).bind(USERS.subscriber.id, editedConfirm.payload.transaction_id).first();
  assert.equal(editedTransaction.direction, "income");
  assert.equal(Number(editedTransaction.amount_minor), 1850);
  assert.equal(editedTransaction.merchant, "修正商户");
  const machineEvidence = await db.prepare(
    "SELECT direction, amount_minor FROM task21_notification_candidates WHERE user_id = ?1 AND id = ?2",
  ).bind(USERS.subscriber.id, editableCandidateId).first();
  assert.equal(machineEvidence.direction, "expense", "machine direction must never be overwritten");
  assert.equal(Number(machineEvidence.amount_minor), 2000, "machine amount must never be overwritten");
  const editedJson = await db.prepare(
    "SELECT edited_json, correction_count FROM task21_notification_candidates WHERE user_id = ?1 AND id = ?2",
  ).bind(USERS.subscriber.id, editableCandidateId).first();
  assert.match(editedJson.edited_json, /"amount_minor":1850/);
  assert.equal(Number(editedJson.correction_count), 1);

  // 19b. Illegal edits are rejected and change nothing.
  const invalidEdit = await request(db, "/api/notification/candidates/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: {
      candidate_id: editableCandidateId,
      device_id: "device-task21-000001",
      edits: { amount_minor: -5 },
    },
  });
  assert.equal(invalidEdit.response.status, 400);
  assert.equal(invalidEdit.payload.code, "candidate_edits_invalid");

  // 20. Device acceptance (Task 24 P1, real Samsung evidence): the Android
  // 「填写金额并记账」 flow books through event.ingest with the same event id the
  // hint was published under, and only flips its *local* candidate. The server
  // hint used to stay pending forever, so Web /finance kept showing a 待填写
  // card for a payment that was already in the ledger (and already counted in
  // the monthly total). A device booking must close the shared hint.
  const bookedHintEventId = "evt-task21-device-booked-hint";
  const hintPublish = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USERS.subscriber.token,
    body: {
      device_id: "device-task21-000001",
      hints: [{
        source_event_id: bookedHintEventId,
        source_type: "notification",
        source_package: "com.tencent.mm",
        app_label: "微信",
        amount_minor: null,
        direction: null,
        merchant: "",
        currency: "CNY",
        confidence: 460,
        recognition_status: "INSUFFICIENT_INFORMATION",
        evidence: { source_type: "notification", confidence: 460, reasons: ["local_incomplete_payment"] },
      }],
    },
  });
  assert.equal(hintPublish.response.status, 200, JSON.stringify(hintPublish.payload));
  assert.equal(hintPublish.payload.hints[0].state, "pending");
  const pendingBeforeBooking = await request(db, "/api/notification/hints?state=pending", { token: USERS.subscriber.token });
  assert.equal(pendingBeforeBooking.payload.pending_count, 1);

  const deviceBooking = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", bookedHintEventId, {
      ...transactionEvent(),
      event_id: bookedHintEventId,
      fingerprint: fingerprint("f470"),
      parser_version: "verified-on-device",
      parse_status: "parsed",
      direction: "expense",
      amount_minor: 100,
      confidence: 950,
    }),
  });
  assert.equal(deviceBooking.response.status, 200, JSON.stringify(deviceBooking.payload));
  const bookingTxnId = deviceBooking.payload.operation_results[0].transaction_id;
  assert.match(bookingTxnId, /^txn:/, "device booking must book the ledger transaction");

  const bookedHintRow = await db.prepare(
    "SELECT * FROM task21_notification_pending_hints WHERE user_id = ?1 AND source_event_id = ?2",
  ).bind(USERS.subscriber.id, bookedHintEventId).first();
  assert.equal(bookedHintRow.state, "confirmed", "a device booking must close the matching pending hint");
  assert.equal(bookedHintRow.finance_entry_id, bookingTxnId);
  assert.equal(Number(bookedHintRow.amount_minor), 100);
  assert.equal(bookedHintRow.direction, "expense");

  // Replaying the exact same operation stays idempotent: one transaction, the
  // same ledger id, the hint still terminal.
  const replayBooking = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", bookedHintEventId, {
      ...transactionEvent(),
      event_id: bookedHintEventId,
      fingerprint: fingerprint("f470"),
      parser_version: "verified-on-device",
      parse_status: "parsed",
      direction: "expense",
      amount_minor: 100,
      confidence: 950,
    }),
  });
  assert.equal(replayBooking.response.status, 200, JSON.stringify(replayBooking.payload));
  assert.equal(replayBooking.payload.operation_results[0].transaction_id, bookingTxnId);
  const bookedTxnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 100",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(bookedTxnCount.count), 1, "replayed bookings must never create a second transaction");
  const pendingAfterBooking = await request(db, "/api/notification/hints?state=pending", { token: USERS.subscriber.token });
  assert.equal(pendingAfterBooking.payload.pending_count, 0, "the finance pending list must not offer a booked event");

  // 20b. Read-side repair: a hint that lands *after* the booking (or a row
  // created before the write-side fix) must converge the moment either client
  // reads the shared list - never stay actionable next to its own ledger entry.
  const staleEventId = "evt-task21-stale-hint";
  const staleBooking = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", staleEventId, {
      ...transactionEvent(),
      event_id: staleEventId,
      fingerprint: fingerprint("f471"),
      parse_status: "parsed",
      direction: "expense",
      amount_minor: 233,
      confidence: 950,
    }),
  });
  assert.equal(staleBooking.response.status, 200, JSON.stringify(staleBooking.payload));
  const staleTxnId = staleBooking.payload.operation_results[0].transaction_id;
  const stalePublish = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USERS.subscriber.token,
    body: {
      device_id: "device-task21-000001",
      hints: [{
        source_event_id: staleEventId,
        source_type: "notification",
        source_package: "com.tencent.mm",
        app_label: "微信",
        amount_minor: null,
        direction: null,
        merchant: "",
        currency: "CNY",
        confidence: 460,
        recognition_status: "INSUFFICIENT_INFORMATION",
        evidence: { source_type: "notification", confidence: 460, reasons: ["local_incomplete_payment"] },
      }],
    },
  });
  assert.equal(stalePublish.response.status, 200, JSON.stringify(stalePublish.payload));
  assert.equal(stalePublish.payload.hints[0].state, "pending", "a late hint upload lands pending first");

  const healedList = await request(db, "/api/notification/hints?state=pending", { token: USERS.subscriber.token });
  assert.equal(healedList.payload.pending_count, 0, "a booked event must never be listed as pending");
  const healedRow = await db.prepare(
    "SELECT * FROM task21_notification_pending_hints WHERE user_id = ?1 AND source_event_id = ?2",
  ).bind(USERS.subscriber.id, staleEventId).first();
  assert.equal(healedRow.state, "confirmed");
  assert.equal(healedRow.finance_entry_id, staleTxnId);
  assert.equal(Number(healedRow.amount_minor), 233);
  assert.equal(healedRow.direction, "expense");

  // 20c. Race: the Web page still shows a card for an event the device booked a
  // moment ago. Confirming it must reuse the existing ledger entry - never a
  // second transaction - and the hint must mirror the *booked* values, not the
  // values that were just typed into the stale page.
  const raceEventId = "evt-task21-hint-race";
  const raceBooking = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USERS.subscriber.token,
    body: ingestBody("device-task21-000001", raceEventId, {
      ...transactionEvent(),
      event_id: raceEventId,
      fingerprint: fingerprint("f472"),
      parse_status: "parsed",
      direction: "expense",
      amount_minor: 450,
      confidence: 950,
    }),
  });
  assert.equal(raceBooking.response.status, 200, JSON.stringify(raceBooking.payload));
  const raceTxnId = raceBooking.payload.operation_results[0].transaction_id;
  // The stale page holds a pending copy of this event (rendered before the
  // booking). Insert exactly that row and confirm it through the web API.
  const raceHintId = `hint:race-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO task21_notification_pending_hints (
      id, user_id, source_event_id, device_id, source_type, source_package, app_label,
      evidence_summary, amount_minor, direction, merchant, currency, confidence,
      recognition_status, state, finance_entry_id, created_at, updated_at, confirmed_at, ignored_at
    ) VALUES (?1, ?2, ?3, 'device-task21-000001', 'notification', 'com.tencent.mm', '微信',
      '{}', NULL, NULL, '', 'CNY', 460, 'INSUFFICIENT_INFORMATION', 'pending', '', ?4, ?4, '', '')`)
    .bind(raceHintId, USERS.subscriber.id, raceEventId, new Date().toISOString()).run();

  const raceConfirm = await request(db, "/api/notification/hints/confirm", {
    method: "POST",
    token: USERS.subscriber.token,
    body: {
      hint_id: raceHintId,
      device_id: "device-task21-000001",
      edits: { amount_minor: 999, direction: "income" },
    },
  });
  assert.equal(raceConfirm.response.status, 200, JSON.stringify(raceConfirm.payload));
  assert.equal(raceConfirm.payload.transaction_id, raceTxnId, "a stale confirm must reuse the booked transaction");
  assert.equal(raceConfirm.payload.duplicate_transaction, true);
  const raceTxnCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 450",
  ).bind(USERS.subscriber.id).first();
  assert.equal(Number(raceTxnCount.count), 1, "the stale confirm must not fork a second transaction");
  const raceHintRow = await db.prepare(
    "SELECT * FROM task21_notification_pending_hints WHERE user_id = ?1 AND id = ?2",
  ).bind(USERS.subscriber.id, raceHintId).first();
  assert.equal(raceHintRow.state, "confirmed");
  assert.equal(raceHintRow.finance_entry_id, raceTxnId);
  assert.equal(Number(raceHintRow.amount_minor), 450, "the hint must mirror the booked amount");
  assert.equal(raceHintRow.direction, "expense", "the hint must mirror the booked direction");

  console.log("Task 21 notification checks passed (privacy boundary, entitlement lifecycle, idempotent ingest, dedupe, finance integration, candidate state machine, feature flags, device-booking hint convergence).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
