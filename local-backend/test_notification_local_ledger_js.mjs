import assert from "node:assert/strict";
import { mergeLocalNotificationLedger, mergeLocalNotificationReviews } from "../js/finance/notification-ledger.js";
const row = { event_id: "evt-wechat-34", id: "txn:notif:123456789012", local_id: "txn:notif:123456789012",
  amount_minor: 3400, direction: "expense", merchant: "", currency: "CNY", occurred_at_ms: 1791023378000,
  source_kind: "automatic", status: "active", sync_state: "pending" };
const snapshot = { account_id: "account-a", transactions: [row], reviews: [] };
const transactions = {};
assert.equal(mergeLocalNotificationLedger(transactions, snapshot, "other-account"), false);
assert.equal(mergeLocalNotificationLedger(transactions, snapshot, "account-a"), true);
assert.equal(Object.values(transactions)[0].amount_minor, 3400);
assert.equal(mergeLocalNotificationLedger(transactions, snapshot, "account-a"), false);
assert.equal(Object.keys(transactions).length, 1);
assert.deepEqual(mergeLocalNotificationReviews([{ state: "pending", event_id: row.event_id }], snapshot, "account-a"), []);
assert.deepEqual(mergeLocalNotificationReviews([{ state: "pending", event_id: "evt-old-alias" }],
  { ...snapshot, transactions: [{ ...row, event_ids: [row.event_id, "evt-old-alias"] }] }, "account-a"), []);
const restored = JSON.parse(JSON.stringify(transactions));
const receipt = { ...snapshot, transactions: [{ ...row, id: "txn:legacy-server-id", sync_state: "synced" }] };
assert.equal(mergeLocalNotificationLedger(restored, receipt, "account-a"), true);
assert.equal(Object.keys(restored).length, 1);
assert.equal(restored["txn:legacy-server-id"].native_notification_pending, false);
delete restored["txn:legacy-server-id"];
assert.equal(mergeLocalNotificationLedger(restored, receipt, "account-a"), false, "historical receipts must not resurrect deleted cloud records");
const alreadyBooked = { "txn:old-cloud-booking": { id: "txn:old-cloud-booking", notification_event_ids: [row.event_id], amount_minor: 3400 } };
assert.equal(mergeLocalNotificationLedger(alreadyBooked, snapshot, "account-a"), false);
assert.equal(Object.keys(alreadyBooked).length, 1, "an exact old cloud event link prevents provisional duplicate booking");
const missing = { id: "missing-amount", kind: "hint", event_id: "missing-amount", amount_minor: null, direction: "expense", state: "pending" };
assert.equal(mergeLocalNotificationReviews([], { ...snapshot, reviews: [missing] }, "account-a").length, 1);
assert.equal(mergeLocalNotificationReviews([missing], { ...snapshot, reviews: [missing] }, "account-a").length, 1);
assert.equal(mergeLocalNotificationReviews([{ ...missing, state: "ignored" }], { ...snapshot, reviews: [missing] }, "account-a").length, 0);
console.log("notification local ledger: offline projection, receipts, restart, dedupe, account isolation and review union PASS");
