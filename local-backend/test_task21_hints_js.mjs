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

  const rawEvidence = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-raw-rejected", {
      evidence: {
        source_type: "notification",
        reasons: ["raw notification sentence"],
        recognised_fields: ["text"],
      },
    }),
  });
  assert.equal(rawEvidence.response.status, 400);
  assert.equal(rawEvidence.payload.code, "hint_evidence_invalid", "free-form notification text must fail closed");

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

  // 3b. The account-scoped summary observes hints and complete candidates in
  // one response. This is the native banner's source of truth; it must not
  // report only candidates while /finance also renders hints.
  const candidateEventId = "evt-hints-complete-candidate";
  const candidateIngest = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USER.token,
    body: {
      schema_version: "1",
      device_id: "device-hints-000001",
      operations: [{
        operation_id: candidateEventId,
        type: "event.ingest",
        payload: {
          event_id: candidateEventId,
          fingerprint: "cd".repeat(32),
          source_package: "com.eg.android.AlipayGphone",
          source_type: "notification",
          event_type: "transaction",
          parser_version: "alipay-2",
          parse_status: "candidate",
          direction: "expense",
          amount_minor: 280,
          currency: "CNY",
          payment_channel: "alipay",
          merchant: "",
          counterparty: "",
          confidence: 650,
          occurred_at_ms: 1_789_350_000_000,
          received_at_ms: 1_789_350_000_000,
        },
      }],
    },
  });
  assert.equal(candidateIngest.response.status, 200, JSON.stringify(candidateIngest.payload));
  assert.match(candidateIngest.payload.operation_results[0].candidate_id, /^cand:/);
  const summary = await request(db, "/api/notification/pending-summary", { token: USER.token });
  assert.equal(summary.response.status, 200, JSON.stringify(summary.payload));
  assert.equal(summary.payload.total_count, 3);
  assert.equal(summary.payload.hint_count, 2);
  assert.equal(summary.payload.candidate_count, 1);
  assert.equal(summary.payload.records.length, 3);
  assert.deepEqual(
    new Set(summary.payload.records.map((record) => record.event_id)),
    new Set(["evt-hints-amount-unknown", "evt-hints-direction-unknown", candidateEventId]),
  );
  assert.equal(
    Object.values(summary.payload.records[0]).some((value) => String(value).includes("notification body")),
    false,
    "the pending summary must expose identities only",
  );

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
      edits: { amount_minor: 10000, direction: "expense" },
    },
  });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.payload));
  assert.match(confirmed.payload.transaction_id, /^txn:/);
  assert.equal(confirmed.payload.hint.state, "confirmed");
  assert.equal(confirmed.payload.hint.finance_entry_id, confirmed.payload.transaction_id);
  assert.equal(confirmed.payload.hint.merchant, "", "merchant is optional and must not block confirmation");
  const ledger = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 10000 AND status = 'active'",
  ).bind(USER.id).first();
  assert.equal(Number(ledger.count), 1);

  const reconciledSummary = await request(
    db,
    "/api/notification/pending-summary?event_ids=evt-hints-amount-unknown",
    { token: USER.token },
  );
  assert.equal(reconciledSummary.response.status, 200, JSON.stringify(reconciledSummary.payload));
  assert.equal(reconciledSummary.payload.total_count, 2, "terminal requested ids do not inflate the pending total");
  const terminalIdentity = reconciledSummary.payload.records.find(
    (item) => item.event_id === "evt-hints-amount-unknown",
  );
  assert.equal(terminalIdentity.state, "confirmed");
  assert.equal(terminalIdentity.transaction_id, confirmed.payload.transaction_id);

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

  // 11. Task 24.4 real-device regression (¥104.49 stayed pending forever):
  // the Android pull asks for every state with an explicit empty `state=`.
  // `'' || "pending"` used to collapse that into the pending default, so a
  // Web-side confirm was never delivered to the device and the local pending
  // row could never close. An explicit empty state must return every state,
  // while an omitted state keeps the web default.
  const everyState = await request(db, "/api/notification/hints?state=", { token: USER.token });
  assert.equal(everyState.response.status, 200, JSON.stringify(everyState.payload));
  const states = new Map(everyState.payload.hints.map((item) => [item.source_event_id, item.state]));
  assert.equal(states.get("evt-hints-amount-unknown"), "confirmed");
  assert.equal(states.get("evt-hints-direction-unknown"), "ignored");
  assert.equal(everyState.payload.pending_count, 0);
  const defaultState = await request(db, "/api/notification/hints", { token: USER.token });
  assert.equal(defaultState.payload.hints.length, 0, "an omitted state still defaults to pending");

  // 12. Real-device Task 24 closure: an amount-unknown hint is enriched by the
  // explicit Android OCR ticket. Android confirms with the *same* event id;
  // event.ingest must create one transaction and close the server hint rather
  // than leaving a second pending card or asking the user to type the amount.
  const deviceEventId = "evt-hints-device-verified";
  const deviceHint = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody(deviceEventId),
  });
  assert.equal(deviceHint.response.status, 200, JSON.stringify(deviceHint.payload));
  const deviceBookingBody = {
    schema_version: "1",
    device_id: "device-hints-000001",
    operations: [{
      operation_id: deviceEventId,
      type: "event.ingest",
      payload: {
        event_id: deviceEventId,
        fingerprint: "ab".repeat(32),
        source_package: "com.tencent.mm",
        source_type: "notification",
        event_type: "transaction",
        parser_version: "verified-on-device",
        parse_status: "parsed",
        direction: "expense",
        amount_minor: 1,
        currency: "CNY",
        payment_channel: "wechat",
        merchant: "",
        counterparty: "",
        confidence: 950,
        occurred_at_ms: 1_789_345_800_000,
        received_at_ms: 1_789_345_800_000,
      },
    }],
  };
  const deviceBooking = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USER.token,
    body: deviceBookingBody,
  });
  assert.equal(deviceBooking.response.status, 200, JSON.stringify(deviceBooking.payload));
  assert.match(deviceBooking.payload.operation_results[0].transaction_id, /^txn:/);
  const deviceHintRow = await db.prepare(
    "SELECT state, amount_minor, direction, finance_entry_id FROM task21_notification_pending_hints WHERE user_id = ?1 AND source_event_id = ?2",
  ).bind(USER.id, deviceEventId).first();
  assert.equal(deviceHintRow.state, "confirmed");
  assert.equal(deviceHintRow.amount_minor, 1);
  assert.equal(deviceHintRow.direction, "expense");
  assert.equal(deviceHintRow.finance_entry_id, deviceBooking.payload.operation_results[0].transaction_id);
  const deviceBookingReplay = await request(db, "/api/notification/ingest", {
    method: "POST",
    token: USER.token,
    body: deviceBookingBody,
  });
  assert.equal(deviceBookingReplay.response.status, 200);
  assert.equal(deviceBookingReplay.payload.operation_results[0].idempotent_replay, true);
  const oneCentLedger = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 1 AND status = 'active'",
  ).bind(USER.id).first();
  assert.equal(Number(oneCentLedger.count), 1, "device enrichment must book exactly one transaction");

  // 13. Schema + row counts stay consistent after the whole flow.
  const hintCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task21_notification_pending_hints WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(hintCount.count), 3);
  const financeCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(financeCount.count), 2, "exactly two independent ledger entries for the whole flow");

  console.log("Task 21 pending-hint checks passed (single pending source, no invented money, idempotent confirm/ignore).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
