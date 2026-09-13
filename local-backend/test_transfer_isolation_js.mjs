import assert from "node:assert/strict";

import {
  missingPartNumbers,
  restoreQueueEntry,
  sessionIdForQueue,
  shouldAdoptStoredQueue,
  transferQueueStorageKey,
  uploadWorkerCount,
} from "../js/transfer/app.js";

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

// Task 24.4 Production regression (UbisoftConnectInstaller.exe, 252.5 MB):
// the upload had reached 100% and every part was on the server, but the restored
// queue item still asked for the file again and「创建分享链接」answered
// 「还有文件没有上传完成。」. A fully uploaded item must come back as done and
// must not require a file; the server still validates the parts on /complete.
const fullyUploaded = restoreQueueEntry({
  id: "item-full",
  sessionId: "session-1",
  fileId: "file-1",
  name: "UbisoftConnectInstaller.exe",
  size: 264786072,
  uploaded: 264786072,
  status: "uploading",
  uploadedParts: [1, 2, 3],
});
assert.equal(fullyUploaded.status, "done", "a fully uploaded item must be ready to publish");
assert.equal(fullyUploaded.needsFile, false, "a fully uploaded item must not ask for the file again");
assert.equal(fullyUploaded.file, null, "restored items never carry a File object");

// A genuinely incomplete upload still needs the file, and the persisted
// `uploading` status must fall back to pending: run() never resumes `uploading`,
// so the old mapping left the item permanently stuck even after re-selecting.
const partial = restoreQueueEntry({
  id: "item-partial",
  sessionId: "session-2",
  name: "big.bin",
  size: 1000,
  uploaded: 400,
  status: "uploading",
  uploadedParts: [1],
});
assert.equal(partial.status, "pending", "an interrupted upload must be resumable");
assert.equal(partial.needsFile, true, "an interrupted upload needs the same file again");

const pausedPartial = restoreQueueEntry({ id: "item-paused", size: 1000, uploaded: 10, status: "uploading", paused: true });
assert.equal(pausedPartial.paused, true, "an explicitly paused item stays paused");
assert.equal(pausedPartial.status, "pending");

const doneItem = restoreQueueEntry({ id: "item-done", sessionId: "session-3", size: 10, uploaded: 10, status: "done" });
assert.equal(doneItem.status, "done");
assert.equal(doneItem.needsFile, false);

// The persisted session id is what lets a reloaded page publish a finished queue.
assert.equal(sessionIdForQueue([{ id: "a" }, { id: "b", sessionId: "session-9" }]), "session-9");
assert.equal(sessionIdForQueue([{ id: "a" }]), "");
assert.equal(sessionIdForQueue(null), "");

// Task 24 reopen (#9 upload hot path): multipart uploads used to run strictly
// one part at a time (hash → PUT → wait), which capped real-world throughput.
// The scheduler must keep a bounded number of parts in flight, resume exactly
// the missing ones, and never multiply workers beyond the work left.
assert.deepEqual(missingPartNumbers(4, [1, 3]), [2, 4], "only unfinished parts are retried");
assert.deepEqual(missingPartNumbers(3, [1, 2, 3]), [], "a finished file has no missing parts");
assert.deepEqual(missingPartNumbers(3, []), [1, 2, 3], "a fresh file needs every part");
assert.equal(uploadWorkerCount(10, [], 3), 3, "concurrency is bounded by the configured limit");
assert.equal(uploadWorkerCount(2, [], 3), 2, "never more workers than remaining parts");
assert.equal(uploadWorkerCount(5, [1, 2, 3, 4, 5], 3), 0, "no workers when nothing is left");
assert.equal(uploadWorkerCount(8, [1, 2, 3, 4, 5, 6, 7], 3), 1, "the last part still gets one worker");

console.log("Transfer queue isolation checks passed (per-account keys, stable within one account).");
