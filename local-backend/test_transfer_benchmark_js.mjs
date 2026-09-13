import assert from "node:assert/strict";

import {
  HASH_LOOK_AHEAD,
  UPLOAD_CONCURRENCY,
  missingPartNumbers,
  runPartPipeline,
  uploadPerformanceSummary,
  uploadWorkerCount,
} from "../js/transfer/app.js";

/**
 * Task 24 reopen #9: the multipart path must be measured, not assumed.
 *
 * The old client hashed a part, waited for the PUT, then started the next part
 * (`hash → PUT → wait → next`). The pipeline hashes look-ahead parts while
 * `UPLOAD_CONCURRENCY` PUTs are in flight, so the socket never waits for a
 * digest. This benchmark runs both models against the *real* scheduler with
 * simulated per-part latency and proves:
 *
 *  - every part is uploaded exactly once, in both models;
 *  - the pipeline is materially faster (the old model is latency-bound);
 *  - hashing overlaps the network instead of serialising with it;
 *  - the SHA-256 handed to every PUT is the digest of exactly those bytes;
 *  - pause/cancel/failure stop the batch and keep the resume plan correct.
 */

const PART_BYTES = 16 * 1024 * 1024;
const PART_COUNT = 12;
const HASH_MS = 30;
const UPLOAD_MS = 90;
const PAUSE_AFTER = 4;

const sha256 = async (bytes) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bytes of one part, so the digest can be checked against real content. */
function partBytes(partNumber) {
  const bytes = new Uint8Array(PART_BYTES);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (partNumber * 31 + index) % 251;
  }
  return bytes;
}

function plan(partCount = PART_COUNT) {
  return Array.from({ length: partCount }, (_, index) => {
    const partNumber = index + 1;
    return { partNumber, offset: index * PART_BYTES, length: PART_BYTES };
  });
}

/** The pre-fix client: one part at a time, hash included in the same slot. */
async function runSerialModel(parts, { hashPart, uploadPart }) {
  const startedAt = Date.now();
  let hashMs = 0;
  let uploadMs = 0;
  let uploaded = 0;
  for (const part of parts) {
    const hashStarted = Date.now();
    const hash = await hashPart(part);
    hashMs += Date.now() - hashStarted;
    const uploadStarted = Date.now();
    await uploadPart(part, hash);
    uploadMs += Date.now() - uploadStarted;
    uploaded += 1;
  }
  return { parts: parts.length, uploaded, bytes: uploaded * PART_BYTES, hashMs, uploadMs, totalMs: Date.now() - startedAt };
}

const hashPart = async (part) => {
  await sleep(HASH_MS);
  return sha256(partBytes(part.partNumber));
};

function uploadingHarness() {
  const seen = new Map();
  let inFlight = 0;
  let maxInFlight = 0;
  const uploadPart = async (part, hash) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await sleep(UPLOAD_MS);
      seen.set(part.partNumber, hash);
      return part.length;
    } finally {
      inFlight -= 1;
    }
  };
  return { seen, uploadPart, get maxInFlight() { return maxInFlight; } };
}

// 1. The old model is the baseline this failure was reported against.
const serial = uploadingHarness();
const serialResult = await runSerialModel(plan(), { hashPart, uploadPart: serial.uploadPart });
assert.equal(serialResult.uploaded, PART_COUNT);

// 2. The shipped pipeline with the same latencies.
const pipelined = uploadingHarness();
const pipelineStartedAt = Date.now();
const pipelineResult = await runPartPipeline({
  parts: plan(),
  workerCount: UPLOAD_CONCURRENCY,
  hashPart,
  uploadPart: pipelined.uploadPart,
});
const pipelineTotalMs = Date.now() - pipelineStartedAt;
assert.equal(pipelineResult.uploaded, PART_COUNT, "every part must be uploaded exactly once");
assert.equal(pipelined.seen.size, PART_COUNT, "no part may be uploaded twice");
assert.equal(pipelineResult.stoppedBy, "", "a completed run is not stopped");

const speedup = serialResult.totalMs / pipelineTotalMs;
assert.ok(
  speedup >= 2,
  `the pipeline must be at least 2x faster than the serial model (serial=${serialResult.totalMs}ms pipeline=${pipelineTotalMs}ms)`,
);
assert.ok(
  pipelineTotalMs < pipelineResult.hashMs + pipelineResult.uploadMs,
  "hashing must overlap the uploads instead of serialising with them",
);
assert.equal(
  pipelined.maxInFlight,
  UPLOAD_CONCURRENCY,
  "the pipeline keeps the configured number of PUTs in flight",
);
assert.equal(
  serial.maxInFlight,
  1,
  "the old serial model never had more than one PUT in flight",
);

// 3. Integrity is untouched: every PUT carried the SHA-256 of its own bytes.
for (const [partNumber, hash] of pipelined.seen.entries()) {
  assert.equal(hash, await sha256(partBytes(partNumber)), `part ${partNumber} hash`);
}

// 4. A real 800 MB upload is 50 parts on the 16 MiB chunk size the server
//    declares, and the resume plan only ever sends the missing ones.
const bigSize = 800 * 1024 * 1024;
const bigPartCount = Math.ceil(bigSize / PART_BYTES);
assert.equal(bigPartCount, 50);
assert.equal(uploadWorkerCount(bigPartCount, []), UPLOAD_CONCURRENCY, "a 50 part upload runs 3 workers");
const halfDone = Array.from({ length: 37 }, (_, index) => index + 1);
assert.deepEqual(
  missingPartNumbers(bigPartCount, halfDone),
  Array.from({ length: 13 }, (_, index) => 38 + index),
  "resume must plan only the missing parts",
);
assert.equal(uploadWorkerCount(bigPartCount, Array.from({ length: 50 }, (_, index) => index + 1)), 0, "a finished file has no workers");
assert.ok(HASH_LOOK_AHEAD >= 1, "the hasher must be able to run ahead of the uploads");

// 5. Pause stops the batch, keeps the acknowledged parts and leaves the rest to
//    the resume plan. The item may never be reported as done.
const pausable = uploadingHarness();
let pauseSignal = "";
const paused = await runPartPipeline({
  parts: plan(),
  workerCount: UPLOAD_CONCURRENCY,
  hashPart,
  uploadPart: pausable.uploadPart,
  shouldStop: () => pauseSignal,
  onUploaded: () => {
    if (pausable.seen.size >= PAUSE_AFTER) pauseSignal = "paused";
  },
});
assert.equal(paused.stoppedBy, "paused", "an interrupted batch reports why it stopped");
assert.ok(paused.uploaded < PART_COUNT, "a paused batch is incomplete");
assert.deepEqual(
  missingPartNumbers(PART_COUNT, [...pausable.seen.keys()]).length,
  PART_COUNT - pausable.seen.size,
  "resume re-plans exactly the parts that never finished",
);

// 6. Cancelling stops immediately and a failed part is reported with its number.
const cancelSignal = { kind: "cancelled" };
const cancelled = await runPartPipeline({
  parts: plan(),
  workerCount: UPLOAD_CONCURRENCY,
  hashPart,
  uploadPart: uploadingHarness().uploadPart,
  shouldStop: () => cancelSignal,
});
assert.equal(cancelled.uploaded, 0, "a cancelled batch uploads nothing");
assert.equal(cancelled.stoppedBy, "cancelled");

const failingPart = 5;
const failing = await runPartPipeline({
  parts: plan(),
  workerCount: 1,
  hashPart,
  uploadPart: async (part, hash) => {
    if (part.partNumber === failingPart) {
      const error = new Error("part 5 rejected");
      throw error;
    }
    return uploadingHarness().uploadPart(part, hash);
  },
}).then(
  () => null,
  (error) => error,
);
assert.ok(failing, "a failing part must reach the caller");
assert.equal(failing.partNumber, failingPart, "the failure keeps the part number for retry");

// 7. Reported numbers: hash time, upload time, wall clock, effective throughput.
const summary = uploadPerformanceSummary({
  bytes: pipelineResult.bytes,
  hashMs: pipelineResult.hashMs,
  uploadMs: pipelineResult.uploadMs,
  totalMs: pipelineTotalMs,
});
assert.equal(summary.bytes, PART_COUNT * PART_BYTES);
assert.ok(summary.bytesPerSecond > 0, "throughput must be computed from real numbers");
assert.ok(summary.totalMs >= summary.uploadMs / UPLOAD_CONCURRENCY, "wall clock covers the in-flight uploads");

const mbPerSecond = (bytesPerSecond) => (bytesPerSecond / (1024 * 1024)).toFixed(1);
const projected = uploadPerformanceSummary({
  bytes: bigSize,
  hashMs: summary.hashMs,
  uploadMs: summary.uploadMs,
  // The simulated per-part latency is fixed, so the 50 part plan scales linearly
  // with parts per worker. This is a projection, not a device measurement.
  totalMs: (pipelineTotalMs * bigPartCount) / PART_COUNT,
});
console.log(
  [
    "Task 24 upload pipeline benchmark (simulated per-part latency, real scheduler):",
    `  serial model        : ${serialResult.totalMs}ms for ${PART_COUNT} parts`,
    `  pipeline (${UPLOAD_CONCURRENCY} workers): ${pipelineTotalMs}ms for ${PART_COUNT} parts (${speedup.toFixed(2)}x)`,
    `  hash stage          : ${pipelineResult.hashMs}ms summed, overlapped with the PUTs`,
    `  upload stage        : ${pipelineResult.uploadMs}ms summed across workers`,
    `  effective throughput: ${mbPerSecond(summary.bytesPerSecond)} MiB/s`,
    `  projected 800 MiB   : ${mbPerSecond(projected.bytesPerSecond)} MiB/s, ${bigPartCount} parts, ${UPLOAD_CONCURRENCY} workers`,
  ].join("\n"),
);
console.log(
  "Task 24 upload benchmark passed (pipeline concurrency and hash look-ahead, exactly-once part uploads, SHA-256 per part preserved, pause/cancel/failure semantics and the resume plan).",
);
