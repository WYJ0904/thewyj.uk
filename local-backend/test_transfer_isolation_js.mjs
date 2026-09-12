import assert from "node:assert/strict";

import { transferQueueStorageKey } from "../js/transfer/app.js";

// Task 24.3 multi-account isolation: the upload queue is now scoped per owner,
// so switching accounts can neither adopt nor overwrite another user's pending
// uploads, and returning to an account restores that account's own queue.
const accountA = transferQueueStorageKey("user-A");
const accountB = transferQueueStorageKey("user-B");
const guest = transferQueueStorageKey("");

assert.notEqual(accountA, accountB, "two accounts must never share one queue");
assert.equal(accountA, transferQueueStorageKey("user-A"), "the same account must keep a stable queue identity");
assert.equal(guest, transferQueueStorageKey(""), "guest identity must stay stable across visits");
assert.equal(transferQueueStorageKey(" guest "), transferQueueStorageKey("guest"), "whitespace must not fork the queue");
assert.ok(accountA.startsWith("wyjTransferQueue:v2:"), "the scoped key keeps the transfer namespace");
assert.notEqual(transferQueueStorageKey("user-A"), transferQueueStorageKey("user-a"), "ids stay case-sensitive");

console.log("Transfer queue isolation checks passed (per-account keys, stable within one account).");
