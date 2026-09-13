import assert from "node:assert/strict";

import { sessionBatchIds, sessionPlan, sessionIdForQueue } from "../js/transfer/app.js";

/**
 * Task 24 RC regression: one server session is one upload batch.
 *
 * The server fixes `file_count`/`total_bytes` when the session is created and
 * refuses another file afterwards (`transfer_file_count_exceeded`). Picking one
 * file, uploading it, then adding a second file must therefore open a *new*
 * session for the complete queue instead of reusing the old one.
 */

const item = (id, size, status = "pending", sessionId = "", fileId = "") => ({
  id,
  size,
  status,
  sessionId,
  fileId,
});

const batch = (sessionId, fileCount, totalBytes, stack) => ({
  id: sessionId,
  fileCount,
  totalBytes,
  batchIds: stack,
});

// 1. A fresh queue has no session: the plan asks for one sized to the queue.
const fresh = sessionPlan([item("a", 100), item("b", 50)], null);
assert.deepEqual(
  { reuse: fresh.reuse, fileCount: fresh.fileCount, totalBytes: fresh.totalBytes, reason: fresh.reason },
  { reuse: false, fileCount: 2, totalBytes: 150, reason: "no-session" },
);

// 2. One file uploaded into a one-file session: reusing it is correct.
const oneFileQueue = [item("a", 100, "done", "session-1", "file-a")];
const oneFileSession = batch("session-1", 1, 100, ["a"]);
assert.equal(sessionPlan(oneFileQueue, oneFileSession).reuse, true);
assert.equal(sessionPlan(oneFileQueue, oneFileSession).reason, "exact-batch");

// 3. The defect: a second file is appended after the first one uploaded. The old
//    session declared one file, so it can never carry both - a new session is
//    required and both files must be re-uploaded into it.
const grew = [item("a", 100, "done", "session-1", "file-a"), item("b", 50, "pending", "session-1")];
const grewPlan = sessionPlan(grew, oneFileSession);
assert.equal(grewPlan.reuse, false, "a session with file_count=1 must not carry two files");
assert.equal(grewPlan.reason, "file-count-grew");
assert.equal(grewPlan.fileCount, 2);
assert.equal(grewPlan.totalBytes, 150);

// 4. Replacing a file with a different size is also a new batch (total_bytes is
//    fixed server-side as well).
const resized = [item("a", 400, "done", "session-1", "file-a")];
assert.equal(sessionPlan(resized, oneFileSession).reuse, false);
assert.equal(sessionPlan(resized, oneFileSession).reason, "size-changed");

// 5. The new session carries the whole queue: after re-upload both items point at
//    it and the plan is stable (no second session churn on every upload tick).
const newSession = batch("session-2", 2, 150, ["a", "b"]);
const migrated = [
  item("a", 100, "pending", "session-2"),
  item("b", 50, "pending", "session-2"),
];
assert.equal(sessionPlan(migrated, newSession).reuse, true);
assert.equal(sessionPlan(migrated, newSession).reason, "exact-batch");
assert.equal(
  sessionPlan(migrated.map((entry) => ({ ...entry, status: "done", fileId: `file-${entry.id}` })), newSession).reuse,
  true,
  "a finished batch keeps reusing its session",
);

// 6. A queue restored after a reload keeps the persisted session (its declaration
//    is gone from memory, and the server validates the count on complete()).
const restoredQueue = [
  item("a", 100, "done", "session-restored", "file-a"),
  item("b", 50, "done", "session-restored", "file-b"),
];
const restoredPlan = sessionPlan(restoredQueue, { id: sessionIdForQueue(restoredQueue), expiresAt: "" });
assert.equal(restoredPlan.reuse, true);
assert.equal(restoredPlan.reason, "restored-session");
const mixedQueue = [restoredQueue[0], item("c", 10, "pending", "session-other")];
assert.equal(
  sessionPlan(mixedQueue, { id: "session-restored", expiresAt: "" }).reuse,
  false,
  "a restored session may only be reused when the whole queue still points at it",
);

// 7. Cancelled items neither count towards the batch nor keep a session alive.
assert.deepEqual(sessionBatchIds([item("a", 1), { ...item("b", 1), status: "cancelled" }]), ["a"]);
assert.equal(sessionPlan([{ ...item("a", 100), status: "cancelled" }], oneFileSession).fileCount, 0);
assert.equal(sessionPlan([{ ...item("a", 100), status: "cancelled" }], oneFileSession).reuse, true);

// 8. An empty queue never asks for a session.
assert.equal(sessionPlan([], null).reuse, false);
assert.equal(sessionPlan([], null).reason, "empty");

console.log(
  "Task 24 transfer session plan passed (no-session batch, exact reuse, file-count growth, size change, migrated batch stability, restored queue and cancelled items).",
);
