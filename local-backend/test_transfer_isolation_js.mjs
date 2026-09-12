import assert from "node:assert/strict";

import { shouldAdoptStoredQueue, transferQueueStorageKey } from "../js/transfer/app.js";

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

// Task 24.3 CI regression (real main-CI failure): re-showing the transfer page
// or refreshing the account must not re-read storage for the same owner. The
// serialized queue has no File objects, so re-adopting it mid-upload replaced a
// running upload with「已恢复，请重新选择同一文件继续」 and the upload never
// finished (the toolbox browser matrix hung until its 180s deadline).
assert.equal(
  shouldAdoptStoredQueue("user-A", "user-A"),
  false,
  "the same owner must keep the live in-memory queue (and its File handles)",
);
assert.equal(
  shouldAdoptStoredQueue("guest:g-1", "guest:g-1"),
  false,
  "a re-shown guest page must keep its live queue",
);
assert.equal(
  shouldAdoptStoredQueue("user-B", "user-A"),
  true,
  "a real account switch must adopt the new owner's stored queue",
);
assert.equal(
  shouldAdoptStoredQueue("user-A", ""),
  true,
  "the first load has no loaded owner yet and must restore from storage",
);
assert.equal(
  shouldAdoptStoredQueue("", ""),
  false,
  "an empty owner pair is not a change",
);

console.log("Transfer queue isolation checks passed (per-account keys, stable within one account).");
