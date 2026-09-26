import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask21Request } from "../functions/_lib/task21-api.mjs";
import { handleTask16Request } from "../functions/_lib/task16-api.mjs";
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

async function requestFinance(db, route, options = {}) {
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
  return { response, payload: await response.json() };
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

  // 3b. The account-scoped summary is the same canonical set used by Finance.
  // A complete structured payment is booked immediately and is not pending.
  const summary = await request(db, "/api/notification/pending-summary", { token: USER.token });
  assert.equal(summary.response.status, 200, JSON.stringify(summary.payload));
  assert.equal(summary.payload.total_count, 2);
  assert.equal(summary.payload.hint_count, 2);
  assert.equal(summary.payload.candidate_count, 0);
  assert.equal(summary.payload.records.length, 2);
  assert.deepEqual(
    new Set(summary.payload.records.map((record) => record.event_id)),
    new Set(["evt-hints-amount-unknown", "evt-hints-direction-unknown"]),
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

  // 6b. The same event becomes richer after Android Accessibility/OCR verifies
  // it. A complete CONFIRMED_PAYMENT money shape must update the same identity,
  // book immediately, and leave neither Android nor /finance waiting for a
  // second manual confirmation tap.
  const enriched = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-amount-unknown", {
      amount_minor: 10000,
      direction: "expense",
      confidence: 950,
      recognition_status: "CONFIRMED_PAYMENT",
      evidence: {
        source_type: "accessibility",
        confidence: 950,
        reasons: ["accessibility_verified_amount"],
        recognised_fields: ["amount", "direction"],
      },
    }),
  });
  assert.equal(enriched.response.status, 200, JSON.stringify(enriched.payload));
  assert.equal(enriched.payload.results[0].duplicate, true);
  assert.equal(enriched.payload.results[0].updated, true);
  assert.equal(enriched.payload.hints[0].id, hintId, "enrichment keeps the canonical hint identity");
  assert.equal(enriched.payload.hints[0].amount_minor, 10000);
  assert.equal(enriched.payload.hints[0].direction, "expense");
  assert.equal(enriched.payload.hints[0].state, "confirmed");
  assert.match(enriched.payload.hints[0].finance_entry_id, /^txn:/);
  const autoBookedTransactionId = enriched.payload.hints[0].finance_entry_id;
  const ledgerAfterEnrichment = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1 AND amount_minor = 10000 AND status = 'active'",
  ).bind(USER.id).first();
  assert.equal(Number(ledgerAfterEnrichment.count), 1, "verified enrichment must auto-book exactly once");
  const afterAutoBook = await request(db,
    "/api/notification/pending-summary?event_ids=evt-hints-amount-unknown", { token: USER.token });
  assert.equal(afterAutoBook.payload.records.find((row) =>
    row.event_id === "evt-hints-amount-unknown")?.state, "confirmed");
  assert.equal(afterAutoBook.payload.records.filter((row) =>
    row.event_id === "evt-hints-amount-unknown" && row.state === "pending").length, 0,
  "verified auto-book has zero pending identities for this event");
  const enrichmentReplay = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-amount-unknown", {
      amount_minor: 10000,
      direction: "expense",
      confidence: 950,
      recognition_status: "CONFIRMED_PAYMENT",
      evidence: {
        source_type: "accessibility",
        confidence: 950,
        reasons: ["accessibility_verified_amount"],
        recognised_fields: ["amount", "direction"],
      },
    }),
  });
  assert.equal(enrichmentReplay.response.status, 200);
  assert.equal(enrichmentReplay.payload.results[0].updated, false, "terminal enrichment replay is a no-op");
  assert.equal(enrichmentReplay.payload.hints[0].finance_entry_id, autoBookedTransactionId);
  const hintRowsAfterEnrichment = await db.prepare(
    "SELECT COUNT(*) AS count FROM task21_notification_pending_hints WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(hintRowsAfterEnrichment.count), 2, "enrichment never creates a second hint");

  // 7. A manual confirm arriving after auto-book is idempotent and cannot
  // create a second finance entry.
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
  assert.equal(confirmed.payload.no_change, true);
  assert.equal(confirmed.payload.transaction_id, autoBookedTransactionId);
  assert.equal(confirmed.payload.hint.state, "confirmed");
  assert.equal(confirmed.payload.hint.finance_entry_id, autoBookedTransactionId);
  assert.equal(confirmed.payload.hint.merchant, "", "merchant is optional and must not block booking");
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
  assert.equal(reconciledSummary.payload.total_count, 1, "terminal requested ids do not inflate the pending total");
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
    "SELECT state, amount_minor, direction FROM task21_notification_pending_hints WHERE user_id = ?1 AND id = ?2",
  ).bind(USER.id, hintId).first();
  assert.equal(confirmedRow.state, "confirmed");
  assert.equal(Number(confirmedRow.amount_minor), 10000);
  assert.equal(confirmedRow.direction, "expense");

  const terminalReplay = await request(db, "/api/notification/hints", {
    method: "POST",
    token: USER.token,
    body: hintBody("evt-hints-amount-unknown", {
      amount_minor: 99999,
      direction: "income",
      confidence: 1000,
      recognition_status: "CONFIRMED_PAYMENT",
    }),
  });
  assert.equal(terminalReplay.payload.results[0].updated, false, "terminal hints are immutable");
  const terminalAfterReplay = await db.prepare(
    "SELECT state, amount_minor, direction FROM task21_notification_pending_hints WHERE user_id = ?1 AND id = ?2",
  ).bind(USER.id, hintId).first();
  assert.equal(terminalAfterReplay.state, "confirmed");
  assert.equal(Number(terminalAfterReplay.amount_minor), 10000);
  assert.equal(terminalAfterReplay.direction, "expense");

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
  const afterAndroidIgnore = await request(db,
    "/api/notification/pending-summary?event_ids=evt-hints-direction-unknown", { token: USER.token });
  assert.equal(afterAndroidIgnore.payload.records.find((row) =>
    row.event_id === "evt-hints-direction-unknown")?.state, "ignored");
  assert.equal(afterAndroidIgnore.payload.records.filter((row) =>
    row.event_id === "evt-hints-direction-unknown" && row.state === "pending").length, 0,
  "Android ignore must disappear from Finance's canonical pending set immediately");
  const lateIgnoredEvent = await request(db, "/api/notification/ingest", {
    method: "POST", token: USER.token,
    body: { schema_version: "1", device_id: "device-hints-000001", operations: [{
      operation_id: "evt-hints-direction-unknown-late",
      type: "event.ingest",
      payload: {
        event_id: "evt-hints-direction-unknown", fingerprint: "ef".repeat(32),
        source_package: "com.tencent.mm", source_type: "notification",
        event_type: "transaction", parser_version: "late-after-ignore",
        parse_status: "candidate", direction: "expense", amount_minor: 2800,
        currency: "CNY", payment_channel: "wechat", merchant: "", counterparty: "",
        confidence: 650, occurred_at_ms: 1_789_345_700_000,
        received_at_ms: 1_789_345_700_000,
      },
    }] },
  });
  assert.equal(lateIgnoredEvent.response.status, 200, JSON.stringify(lateIgnoredEvent.payload));
  assert.equal(lateIgnoredEvent.payload.operation_results[0].candidate_id, "",
    "late structured evidence cannot revive an ignored identity");
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

  // 12b. Deleting a Finance transaction must revoke the Task 21 linkage, and
  // restoring it must restore the same source-event linkage. Notification
  // history remains historical evidence; only the finance outcome converges.
  const bookedTransactionId = deviceBooking.payload.operation_results[0].transaction_id;
  const bookedRow = await db.prepare(
    "SELECT revision FROM task16_finance_transactions WHERE user_id = ?1 AND id = ?2",
  ).bind(USER.id, bookedTransactionId).first();
  const financeSyncBody = (type, baseRevision, operationId) => ({
    schema_version: 1,
    device_id: "device-hints-000001",
    platform: "android",
    device_label: "Task 24 hint fixture",
    client_version: "task24-test",
    since_version: 0,
    operations: [{
      operation_id: operationId,
      type,
      entity_id: bookedTransactionId,
      base_revision: baseRevision,
    }],
  });
  const deletedFinance = await requestFinance(db, "/api/finance/sync", {
    method: "POST",
    token: USER.token,
    body: financeSyncBody("transaction.delete", Number(bookedRow.revision), "op-delete-device-booking"),
  });
  assert.equal(deletedFinance.response.status, 200, JSON.stringify(deletedFinance.payload));
  const afterDeleteHints = await request(db, "/api/notification/hints?state=", { token: USER.token });
  const deletedHint = afterDeleteHints.payload.hints.find((item) => item.source_event_id === deviceEventId);
  assert.equal(deletedHint.state, "ignored");
  assert.equal(deletedHint.finance_entry_id, "");
  const deletedSummary = await request(
    db,
    "/api/notification/pending-summary?event_ids=" + encodeURIComponent(deviceEventId),
    { token: USER.token },
  );
  const deletedIdentity = deletedSummary.payload.records.find((item) => item.event_id === deviceEventId);
  assert.equal(deletedIdentity.state, "ignored");
  assert.equal(deletedIdentity.transaction_id, "");

  const deletedRow = await db.prepare(
    "SELECT revision FROM task16_finance_transactions WHERE user_id = ?1 AND id = ?2",
  ).bind(USER.id, bookedTransactionId).first();
  const restoredFinance = await requestFinance(db, "/api/finance/sync", {
    method: "POST",
    token: USER.token,
    body: financeSyncBody("transaction.restore", Number(deletedRow.revision), "op-restore-device-booking"),
  });
  assert.equal(restoredFinance.response.status, 200, JSON.stringify(restoredFinance.payload));
  const afterRestoreHints = await request(db, "/api/notification/hints?state=", { token: USER.token });
  const restoredHint = afterRestoreHints.payload.hints.find((item) => item.source_event_id === deviceEventId);
  assert.equal(restoredHint.state, "confirmed");
  assert.equal(restoredHint.finance_entry_id, bookedTransactionId);

  // 13. Schema + row counts stay consistent after the whole flow.
  const hintCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task21_notification_pending_hints WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(hintCount.count), 3);
  const financeCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task16_finance_transactions WHERE user_id = ?1",
  ).bind(USER.id).first();
  assert.equal(Number(financeCount.count), 2, "exactly two independent ledger entries for the whole flow");

  // A one-cent OCR result can fill the same hint while direction remains
  // unknown. Only a later, explicit direction makes that event bookable.
  const partialEventId = "evt-hints-partial-cent";
  const partialInitial = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token, body: hintBody(partialEventId),
  });
  assert.equal(partialInitial.response.status, 200);
  const partialAmount = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody(partialEventId, {
      amount_minor: 1, direction: null, confidence: 820,
      recognition_status: "PAYMENT_LIKELY",
      evidence: { source_type: "accessibility", confidence: 820,
        reasons: ["accessibility_partial_enrichment"], recognised_fields: ["amount"] },
    }),
  });
  assert.equal(partialAmount.response.status, 200, JSON.stringify(partialAmount.payload));
  assert.equal(partialAmount.payload.hints[0].id, partialInitial.payload.hints[0].id);
  assert.equal(partialAmount.payload.hints[0].amount_minor, 1);
  assert.equal(partialAmount.payload.hints[0].direction, null);
  assert.equal(partialAmount.payload.hints[0].state, "pending");
  const linkedTransactionCount = async () => {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM task16_finance_raw_events raw
      JOIN task16_finance_transaction_events link ON link.raw_event_id = raw.id
      WHERE raw.user_id = ?1 AND raw.source_event_id = ?2 AND link.relation_status = 'active'`)
      .bind(USER.id, partialEventId).first();
    return Number(row.count);
  };
  assert.equal(await linkedTransactionCount(), 0, "partial enrichment must not book");
  const completedAmount = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody(partialEventId, {
      amount_minor: 1, direction: "expense", confidence: 820,
      recognition_status: "PAYMENT_LIKELY",
      evidence: { source_type: "accessibility", confidence: 820,
        reasons: ["accessibility_verified_payment"], recognised_fields: ["amount", "direction"] },
    }),
  });
  assert.equal(completedAmount.response.status, 200, JSON.stringify(completedAmount.payload));
  assert.equal(completedAmount.payload.hints[0].id, partialInitial.payload.hints[0].id);
  assert.equal(completedAmount.payload.hints[0].state, "confirmed");
  assert.equal(await linkedTransactionCount(), 1);
  const completedReplay = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody(partialEventId, {
      amount_minor: 1, direction: "expense", confidence: 820,
      recognition_status: "PAYMENT_LIKELY",
    }),
  });
  assert.equal(completedReplay.response.status, 200);
  assert.equal(completedReplay.payload.hints[0].finance_entry_id,
    completedAmount.payload.hints[0].finance_entry_id);
  assert.equal(await linkedTransactionCount(), 1, "completed enrichment is exactly once");

  // One WeChat message can be reposted under several notification keys. Its
  // MessagingStyle lifecycle hash, never the amount/time, links the review.
  const life = "a".repeat(64);
  const lifeEvents = ["evt-life-incomplete", "evt-life-update", "evt-life-enrichment"];
  const lifeInitial = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody(lifeEvents[0], {
      payment_channel: "wechat", lifecycle_identity: life,
      evidence: { source_type: "notification", confidence: 460,
        reasons: ["wechat_payment_hint_without_amount"], occurred_at_ms: 1_789_000_000_000 },
    }),
  });
  assert.equal(lifeInitial.response.status, 200, JSON.stringify(lifeInitial.payload));
  const lifeHintId = lifeInitial.payload.hints[0].id;
  const lifeUpdate = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody(lifeEvents[1], {
      payment_channel: "wechat", lifecycle_identity: life,
      amount_minor: 1, direction: null, confidence: 720,
    }),
  });
  assert.equal(lifeUpdate.response.status, 200, JSON.stringify(lifeUpdate.payload));
  assert.equal(lifeUpdate.payload.hints[0].id, lifeHintId);
  const lifePending = await request(db, "/api/notification/pending-summary", { token: USER.token });
  assert.equal(lifePending.response.status, 200, JSON.stringify(lifePending.payload));
  const lifeCard = lifePending.payload.records.find((row) => row.id === lifeHintId);
  assert.equal(lifePending.payload.total_count, 1);
  assert.equal(lifeCard.state, "pending");
  assert.deepEqual(new Set(lifeCard.event_ids), new Set(lifeEvents.slice(0, 2)));
  assert.equal(lifeCard.amount_minor, 1);
  assert.equal(lifeCard.direction, null);
  assert.equal(lifeCard.source_package, "com.tencent.mm");
  assert.equal(lifeCard.app_label, "微信");
  assert.equal(lifeCard.occurred_at_ms, 1_789_000_000_000);
  assert.equal(lifeCard.confidence, 720);
  for (const forbidden of ["title", "text", "body", "big_text", "extras"]) {
    assert.equal(forbidden in lifeCard, false, `pending summary must not expose ${forbidden}`);
  }

  const lifeBooked = await request(db, "/api/notification/ingest", {
    method: "POST", token: USER.token,
    body: { schema_version: "1", device_id: "device-hints-000001", operations: [{
      operation_id: "op-life-enrichment", type: "event.ingest", payload: {
        event_id: lifeEvents[2], fingerprint: "cd".repeat(32),
        source_package: "com.tencent.mm", source_type: "notification",
        event_type: "transaction", parser_version: "wechat-2", parse_status: "parsed",
        direction: "expense", amount_minor: 1, currency: "CNY", payment_channel: "wechat",
        lifecycle_identity: life, merchant: "", counterparty: "", confidence: 720,
        occurred_at_ms: 1_789_000_000_000, received_at_ms: 1_789_000_002_000,
      },
    }] },
  });
  assert.equal(lifeBooked.response.status, 200, JSON.stringify(lifeBooked.payload));
  assert.match(lifeBooked.payload.operation_results[0].transaction_id, /^txn:/);
  const lifeTerminal = await request(db,
    `/api/notification/pending-summary?event_ids=${lifeEvents[2]}`, { token: USER.token });
  assert.equal(lifeTerminal.payload.total_count, 0);
  const terminalCard = lifeTerminal.payload.records.find((row) => row.id === lifeHintId);
  assert.equal(terminalCard.state, "confirmed");
  assert.deepEqual(new Set(terminalCard.event_ids), new Set(lifeEvents));
  const lifeRaw = await db.prepare(`SELECT COUNT(*) AS count FROM task16_finance_raw_events
    WHERE user_id = ?1 AND source_event_id = ?2`).bind(USER.id, lifeEvents[0]).first();
  assert.equal(Number(lifeRaw.count), 1);

  const eventFirstId = "evt-life-booked-before-hint";
  const eventFirst = await request(db, "/api/notification/ingest", {
    method: "POST", token: USER.token,
    body: { schema_version: "1", device_id: "device-hints-000001", operations: [{
      operation_id: "op-life-event-first", type: "event.ingest", payload: {
        event_id: eventFirstId, fingerprint: "de".repeat(32),
        source_package: "com.tencent.mm", source_type: "notification",
        event_type: "transaction", parser_version: "wechat-2", parse_status: "parsed",
        direction: "expense", amount_minor: 567, currency: "CNY", payment_channel: "wechat",
        lifecycle_identity: "d".repeat(64), merchant: "", counterparty: "", confidence: 650,
        occurred_at_ms: 1_789_000_100_000, received_at_ms: 1_789_000_100_100,
      },
    }] },
  });
  assert.equal(eventFirst.response.status, 200, JSON.stringify(eventFirst.payload));
  const eventFirstTxn = eventFirst.payload.operation_results[0].transaction_id;
  const lateHint = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-life-late-hint", {
      payment_channel: "wechat", lifecycle_identity: "d".repeat(64),
      amount_minor: null, direction: null,
    }),
  });
  assert.equal(lateHint.response.status, 200, JSON.stringify(lateHint.payload));
  assert.equal(lateHint.payload.hints[0].state, "confirmed");
  assert.equal(lateHint.payload.hints[0].finance_entry_id, eventFirstTxn);
  const lateSummary = await request(db,
    "/api/notification/pending-summary?event_ids=evt-life-late-hint", { token: USER.token });
  assert.equal(lateSummary.payload.total_count, 0,
    "a late hint for an already booked lifecycle must never revive pending");

  const distinct = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-life-distinct", { payment_channel: "wechat", lifecycle_identity: "b".repeat(64),
      amount_minor: 1, direction: null }),
  });
  assert.equal(distinct.response.status, 200, JSON.stringify(distinct.payload));
  assert.notEqual(distinct.payload.hints[0].id, lifeHintId,
    "equal amount and nearby time without shared lifecycle stay separate");
  const ignoredDistinct = await request(db, "/api/notification/hints/ignore", {
    method: "POST", token: USER.token, body: { hint_id: distinct.payload.hints[0].id },
  });
  assert.equal(ignoredDistinct.response.status, 200);

  const referenceFirst = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-reference-first", { payment_channel: "wechat",
      provider_reference: "WECHATREF0002", amount_minor: 280, direction: null }),
  });
  const referenceUpdate = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-reference-update", { payment_channel: "wechat",
      provider_reference: "WECHATREF0002", amount_minor: 280, direction: null }),
  });
  assert.equal(referenceFirst.response.status, 200, JSON.stringify(referenceFirst.payload));
  assert.equal(referenceUpdate.response.status, 200, JSON.stringify(referenceUpdate.payload));
  assert.equal(referenceUpdate.payload.hints[0].id, referenceFirst.payload.hints[0].id);
  const referenceSummary = await request(db, "/api/notification/pending-summary", { token: USER.token });
  assert.equal(referenceSummary.payload.total_count, 1);
  assert.deepEqual(new Set(referenceSummary.payload.records[0].event_ids),
    new Set(["evt-reference-first", "evt-reference-update"]));
  const referenceIgnored = await request(db, "/api/notification/hints/ignore", {
    method: "POST", token: USER.token, body: { hint_id: referenceFirst.payload.hints[0].id },
  });
  assert.equal(referenceIgnored.response.status, 200);
  const afterReferenceIgnore = await request(db,
    "/api/notification/pending-summary?event_ids=evt-reference-update", { token: USER.token });
  assert.equal(afterReferenceIgnore.payload.total_count, 0);
  assert.equal(afterReferenceIgnore.payload.records.find((row) => row.id === referenceFirst.payload.hints[0].id).state,
    "ignored");

  const originalMovement = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-shared-ref-expense", { payment_channel: "wechat",
      provider_reference: "WECHATREF7777", amount_minor: null, direction: "expense" }),
  });
  const refundMovement = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-shared-ref-refund", { payment_channel: "wechat",
      provider_reference: "WECHATREF7777", amount_minor: null, direction: "refund" }),
  });
  assert.equal(originalMovement.response.status, 200);
  assert.equal(refundMovement.response.status, 200, JSON.stringify(refundMovement.payload));
  assert.notEqual(originalMovement.payload.hints[0].id, refundMovement.payload.hints[0].id,
    "a refund cannot be folded into the original expense by shared order reference");
  for (const hint of [originalMovement, refundMovement]) {
    const ignoredMovement = await request(db, "/api/notification/hints/ignore", {
      method: "POST", token: USER.token, body: { hint_id: hint.payload.hints[0].id },
    });
    assert.equal(ignoredMovement.response.status, 200);
  }

  // Old APKs may already have split one archive notification instance into
  // separate event ids. Exact instance proof can retire the duplicate row
  // without deleting its history or using amount/time proximity.
  const legacyA = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-legacy-slot-a", { amount_minor: 10_200, direction: null }),
  });
  const legacyB = await request(db, "/api/notification/hints", {
    method: "POST", token: USER.token,
    body: hintBody("evt-legacy-slot-b", { amount_minor: null, direction: null }),
  });
  assert.notEqual(legacyA.payload.hints[0].id, legacyB.payload.hints[0].id);
  const beforeArchiveLink = await request(db, "/api/notification/pending-summary", { token: USER.token });
  assert.equal(beforeArchiveLink.payload.total_count, 2);
  const archiveHash = "c".repeat(64);
  for (const eventId of ["evt-legacy-slot-a", "evt-legacy-slot-b"]) {
    const repair = await request(db, "/api/notification/hints", {
      method: "POST", token: USER.token,
      body: hintBody(eventId, { payment_channel: "wechat", lifecycle_identity: archiveHash }),
    });
    assert.equal(repair.response.status, 200, JSON.stringify(repair.payload));
  }
  const afterArchiveLink = await request(db, "/api/notification/pending-summary", { token: USER.token });
  assert.equal(afterArchiveLink.payload.total_count, 1);
  assert.deepEqual(new Set(afterArchiveLink.payload.records[0].event_ids),
    new Set(["evt-legacy-slot-a", "evt-legacy-slot-b"]));
  const superseded = await db.prepare(`SELECT state FROM task21_notification_pending_hints
    WHERE user_id = ?1 AND id = ?2`).bind(USER.id, legacyB.payload.hints[0].id).first();
  assert.equal(superseded.state, "superseded", "duplicate history remains but is no longer pending");
  const ignoreLegacy = await request(db, "/api/notification/hints/ignore", {
    method: "POST", token: USER.token, body: { hint_id: legacyA.payload.hints[0].id },
  });
  assert.equal(ignoreLegacy.response.status, 200);
  const afterLegacyIgnore = await request(db,
    "/api/notification/pending-summary?event_ids=evt-legacy-slot-b", { token: USER.token });
  assert.equal(afterLegacyIgnore.payload.total_count, 0);
  assert.equal(afterLegacyIgnore.payload.records[0].state, "ignored");

  console.log("Task 21 pending-hint checks passed (single pending source, no invented money, idempotent confirm/ignore).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
