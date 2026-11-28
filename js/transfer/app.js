import { randomId } from "../core/capabilities.js?release=20261128-aeris-p8-admin-v1";
import { ACCOUNT_SESSION_KEY, accountSessionHeaders, isThewyjAndroidApp } from "../core/session.js?release=20261128-aeris-p8-admin-v1";
import { getSafeStorage } from "../core/storage.js?release=20261128-aeris-p8-admin-v1";
import { withInteractionFeedback } from "../core/perf.js?release=20261128-aeris-p8-admin-v1";
import { createTransferUpdateScheduler } from "./updates.js?release=20261128-aeris-p8-admin-v1";
import { putPartWithRecovery } from "./upload-part.js?release=20261128-aeris-p8-admin-v1";
import { reconcileKeyedRows } from "../core/keyed-list.js?release=20261128-aeris-p8-admin-v1";
import { attachFileDropFeedback } from "../core/motion.js?release=20261128-aeris-p8-admin-v1";

const QUEUE_STORAGE_KEY = "wyjTransferQueue:v1";
const GUEST_ID_KEY = "wyjTransferGuest:v1";
const PART_SIZE_HINT = 16 * 1024 * 1024;
const DEFAULT_EXPIRY_MINUTES = 1440;
/**
 * Controlled multipart concurrency. The previous implementation hashed and
 * uploaded one part at a time (hash → PUT → wait → next), which capped a real
 * 800 MB upload far below the available bandwidth. Three parallel parts keeps
 * the pipe busy without unbounded sockets; failures still stop the batch.
 */
export const UPLOAD_CONCURRENCY = 4;
const MAX_CONCURRENT_FILES = 4;
const MAX_ACTIVE_PUTS = 6;

/** Part numbers that still need a PUT, in stable order. */
export function missingPartNumbers(partCount, uploadedParts) {
  const done = new Set((Array.isArray(uploadedParts) ? uploadedParts : []).map(Number));
  const missing = [];
  for (let partNumber = 1; partNumber <= Number(partCount || 0); partNumber += 1) {
    if (!done.has(partNumber)) missing.push(partNumber);
  }
  return missing;
}

/** How many upload workers to start for one item (never zero for real work). */
export function uploadWorkerCount(partCount, uploadedParts, concurrency = UPLOAD_CONCURRENCY) {
  const missing = missingPartNumbers(partCount, uploadedParts).length;
  if (missing <= 0) return 0;
  return Math.max(1, Math.min(Number(concurrency) || 1, missing));
}

/** Hashed parts buffered ahead of the network so a PUT never waits on SHA-256. */
export const HASH_LOOK_AHEAD = 2;

/**
 * Task 24 reopen #9 - hash/upload pipeline.
 *
 * The first multipart rewrite only removed the serial `hash → PUT → wait` loop.
 * Hashing still ran inside the upload slot, so every worker idled for the digest
 * before it could use the socket. This runs two stages with one bounded queue:
 * a look-ahead stage hashes the next parts while the upload stage keeps
 * `workerCount` PUTs in flight. Integrity is untouched: the digest handed to
 * `uploadPart(part, hash)` is still the SHA-256 of exactly those part bytes.
 *
 * `shouldStop()` returns a reason (`"paused"` / `"cancelled"`) when the user
 * interrupted the item; the first upload failure is rethrown with `partNumber`
 * attached so the UI can retry that part.
 */
export async function runPartPipeline({
  parts,
  workerCount,
  hashPart,
  uploadPart,
  onUploaded,
  shouldStop,
  lookAhead = HASH_LOOK_AHEAD,
}) {
  const total = Array.isArray(parts) ? parts.length : 0;
  const metrics = { parts: total, uploaded: 0, bytes: 0, hashMs: 0, uploadMs: 0, stoppedBy: "" };
  if (total === 0) return metrics;
  const limit = Math.max(1, Math.min(Number(workerCount) || 1, total));
  const buffered = Math.max(0, Number(lookAhead) || 0);
  const hashPromises = new Map();
  let nextIndex = 0;
  let failure = null;
  let stopReason = "";

  const reasonNow = () => {
    if (failure) return "failed";
    if (typeof shouldStop !== "function") return "";
    const reason = shouldStop();
    if (!reason) return "";
    if (typeof reason === "string") return reason;
    return reason.kind || reason.reason || "stopped";
  };

  const scheduleHashes = () => {
    while (!reasonNow() && nextIndex < total && hashPromises.size < limit + buffered) {
      const part = parts[nextIndex];
      nextIndex += 1;
      const startedAt = Date.now();
      const promise = Promise.resolve()
        .then(() => hashPart(part))
        .then((hash) => {
          metrics.hashMs += Date.now() - startedAt;
          return { part, hash };
        });
      hashPromises.set(part.partNumber, promise);
    }
  };

  const takeJob = () => {
    scheduleHashes();
    const next = hashPromises.entries().next();
    if (next.done) return null;
    const [partNumber, promise] = next.value;
    hashPromises.delete(partNumber);
    scheduleHashes();
    return promise;
  };

  const worker = async () => {
    while (true) {
      const reason = reasonNow();
      if (reason) {
        stopReason = stopReason || reason;
        return;
      }
      let job;
      try {
        job = await takeJob();
      } catch (error) {
        failure = failure || error;
        stopReason = stopReason || "failed";
        return;
      }
      if (!job) {
        const idleReason = reasonNow();
        if (idleReason) stopReason = stopReason || idleReason;
        return;
      }
      const { part, hash } = job;
      const startedAt = Date.now();
      try {
        const uploadedBytes = await uploadPart(part, hash);
        metrics.uploadMs += Date.now() - startedAt;
        metrics.uploaded += 1;
        metrics.bytes += Number(uploadedBytes) || Number(part.length) || 0;
        onUploaded?.(part, uploadedBytes);
      } catch (error) {
        const interrupted = reasonNow();
        if (interrupted) {
          stopReason = stopReason || interrupted;
        } else {
          if (error && typeof error === "object" && error.partNumber === undefined) {
            error.partNumber = part.partNumber;
          }
          failure = failure || error;
          stopReason = stopReason || "failed";
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  if (failure) throw failure;
  metrics.stoppedBy = stopReason;
  return metrics;
}

/**
 * Upload timing for one item: hash stage, upload stage, wall clock and effective
 * throughput. Recorded on the queue item so a real network run reports numbers
 * instead of a guess.
 */
export function uploadPerformanceSummary({ bytes, hashMs, uploadMs, totalMs }) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const safeTotalMs = Math.max(0, Number(totalMs) || 0);
  const seconds = safeTotalMs / 1000;
  const hash = Math.max(0, Number(hashMs) || 0);
  const upload = Math.max(0, Number(uploadMs) || 0);
  return {
    bytes: safeBytes,
    hashMs: hash,
    uploadMs: upload,
    totalMs: safeTotalMs,
    bytesPerSecond: seconds > 0 ? safeBytes / seconds : 0,
    /** Median-worth share of the wall clock spent hashing (per-part, summed). */
    hashShare: hash + upload > 0 ? hash / (hash + upload) : 0,
  };
}

/**
 * Account-scoped queue identity (Task 24.3 multi-account isolation). The queue
 * used to live under one global key, so switching accounts could adopt or
 * overwrite another user's pending uploads. Each owner now has its own key; the
 * legacy payload is imported once when it really belongs to that owner.
 */
export function transferQueueStorageKey(owner) {
  const safe = String(owner || "guest").trim().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "guest";
  return `wyjTransferQueue:v2:${safe}`;
}

export function transferCleanupStorageKey(owner) {
  return transferQueueStorageKey(owner).replace("wyjTransferQueue:", "wyjTransferCleanup:");
}

/**
 * A stored queue may only replace the in-memory queue when the owner really
 * changed. Re-reading storage for the *same* owner (the transfer page being
 * shown again, or an account refresh) used to replace every live item with its
 * serialized copy - which has no File object - so a running upload silently
 * turned into「已恢复，请重新选择同一文件继续」 and never finished.
 */
export function shouldAdoptStoredQueue(currentOwner, loadedOwner) {
  return String(currentOwner || "") !== String(loadedOwner || "");
}

/**
 * Resolve the next queue slice when ownership changes. If the new owner has no
 * valid saved queue (including a mismatched legacy payload), return an empty
 * queue so the previous account's in-memory items never leak into the new view.
 */
export function restoreQueueStateForOwner(owner, primarySaved, legacySaved = null) {
  const candidate = (!primarySaved?.account || !Array.isArray(primarySaved?.queue)) && legacySaved
    ? legacySaved
    : primarySaved;
  if (candidate?.account === owner && Array.isArray(candidate?.queue)) {
    return { adopted: true, queue: candidate.queue.map(restoreQueueEntry) };
  }
  return { adopted: false, queue: [] };
}

/**
 * Restore one persisted queue item.
 *
 * A page reload cannot carry the File object, so an unfinished upload needs the
 * file again - except when every part was already uploaded (`uploaded >= size`).
 * That upload only waits for the server-side completion and must not be shown
 * as「已恢复，请重新选择同一文件继续」: Production evidence (2026-09-12,
 * UbisoftConnectInstaller.exe 252.5 MB) showed 100% progress while
 * 「创建分享链接」 kept answering「还有文件没有上传完成。」
 *
 * A persisted `uploading` status must also come back as `pending`: `run()` never
 * resumes `uploading`, so re-selecting the file left the item stuck forever.
 */
export function restoreQueueEntry(item) {
  const size = Number(item?.size) || 0;
  const uploaded = Number(item?.uploaded) || 0;
  const wasDone = String(item?.status || "") === "done";
  const fullyUploaded = size > 0 && uploaded >= size;
  const done = wasDone || fullyUploaded;
  return {
    ...item,
    file: null,
    controller: null,
    speed: 0,
    eta: 0,
    needsFile: !done,
    paused: Boolean(item?.paused) && !fullyUploaded,
    status: done ? "done" : "pending",
  };
}

/** Session that the persisted queue belongs to (survives a page reload). */
export function sessionIdForQueue(items) {
  const list = Array.isArray(items) ? items : [];
  const restored = list.find((item) => String(item?.sessionId || "").trim());
  return restored ? String(restored.sessionId) : "";
}

/**
 * Task 24 RC - one server session is one upload batch.
 *
 * `POST /api/transfer/uploads` fixes `file_count` and `total_bytes` for the whole
 * session, and `allocate()` refuses another file once that many exist
 * (`transfer_file_count_exceeded`). A user may pick one file, let it upload and
 * then add a second file before publishing, so the client has to decide whether
 * the current session can still carry the whole queue.
 *
 * The protocol has no cross-session part reuse, so [reuse] = false means: open a
 * new session for the *complete* current queue and re-upload the files (the old
 * session is aborted, never left orphaned).
 */
export function sessionPlan(queue, session) {
  const items = (Array.isArray(queue) ? queue : []).filter((item) => item && item.status !== "cancelled");
  const fileCount = items.length;
  const totalBytes = items.reduce((sum, item) => sum + Math.max(0, Number(item.size) || 0), 0);
  const id = String(session?.id || "").trim();
  if (!fileCount) return { reuse: Boolean(id), fileCount: 0, totalBytes: 0, reason: "empty" };
  if (!id) return { reuse: false, fileCount, totalBytes, reason: "no-session" };
  const declaredCount = Number(session?.fileCount) || 0;
  const declaredBytes = Number(session?.totalBytes) || 0;
  if (!declaredCount) {
    // Restored after a reload: the session object lost its declaration, but every
    // queued item still points at that server session. Its own complete() call
    // validates the count, so the queue stays publishable.
    const sameSession = items.every((item) => String(item.sessionId || "") === id);
    return { reuse: sameSession, fileCount, totalBytes, reason: sameSession ? "restored-session" : "restored-session-mismatch" };
  }
  if (declaredCount !== fileCount) {
    return { reuse: false, fileCount, totalBytes, reason: "file-count-grew" };
  }
  if (declaredBytes !== totalBytes) {
    return { reuse: false, fileCount, totalBytes, reason: "size-changed" };
  }
  const sameSession = items.every((item) => String(item.sessionId || "") === id);
  return { reuse: sameSession, fileCount, totalBytes, reason: sameSession ? "exact-batch" : "batch-changed" };
}

const RECOVERABLE_UPLOAD_SESSION_CODES = new Set([
  "transfer_session_not_found",
  "transfer_session_not_active",
  "transfer_session_expired",
  "transfer_file_not_found",
  "transfer_upload_not_initialized",
]);

/** A persisted server session may safely be replaced, never silently reused. */
export function isRecoverableUploadSessionError(error) {
  return RECOVERABLE_UPLOAD_SESSION_CODES.has(String(error?.code || ""));
}

/**
 * Clears every queue item owned by one stale batch while retaining its File
 * handle. The next pass opens one correctly-sized server session for the whole
 * queue; it cannot mix old file ids or uploaded-part counters into the retry.
 */
export function resetQueueForStaleSession(items, sessionId) {
  const stale = String(sessionId || "").trim();
  if (!stale || !Array.isArray(items)) return 0;
  let reset = 0;
  for (const item of items) {
    if (String(item?.sessionId || "") !== stale) continue;
    item.sessionId = "";
    item.fileId = "";
    item.partSize = 0;
    item.partCount = 0;
    item.uploadedParts = [];
    item.uploaded = 0;
    item.speed = 0;
    item.eta = 0;
    item.status = item.status === "cancelled" ? "cancelled" : "pending";
    item.needsFile = !item.file;
    delete item.error;
    delete item.failedPart;
    delete item.performance;
    reset += 1;
  }
  return reset;
}

/** Rendering and click behaviour share one authoritative item action. */
export function transferItemAction(item) {
  if (item?.paused) return "resume";
  if (item?.status === "preparing") return "preparing";
  if (item?.status === "uploading") return "pause";
  if (item?.status === "error") return "retry";
  if (item?.status === "pending") return "resume";
  return "none";
}

/** Pause is an intent flag even after interrupted PUTs settle to pending. */
export function transferItemStatusLabel(item) {
  if (item?.paused && !["done", "cancelled"].includes(item.status)) return "已暂停";
  return { pending: "等待上传", uploading: "上传中", confirming: "服务端确认中", paused: "已暂停", done: "上传完成", error: "上传失败", cancelled: "已取消" }[item?.status] || "准备中";
}

/** Ids of the queue items a session was opened for. */
export function sessionBatchIds(queue) {
  return (Array.isArray(queue) ? queue : [])
    .filter((item) => item && item.status !== "cancelled")
    .map((item) => String(item.id || ""))
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function formatQuotaBytes(bytes) {
  const value = Number(bytes || 0);
  return value < 1024 * 1024 ? (value === 0 ? "0 MiB" : `${(value / 1048576).toFixed(2)} MiB`) : formatBytes(value);
}

function safeFileRelativePath(file) {
  const full = String(file.aerisRelativePath || file.webkitRelativePath || file.relativePath || file.name || "").replace(/\\/g, "/");
  const parts = full.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.length ? parts.join("/") : String(file.name || "unnamed");
}

function fileTypeIconSvg(fileName) {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"].includes(ext)) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M10 12h4"/><path d="M3 4h18v4H3z"/></svg>';
  }
  if (["mp4", "mov", "webm", "mkv", "avi", "mp3", "wav", "flac", "aac", "ogg"].includes(ext)) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9z"/></svg>';
  }
  if (["json", "csv", "ts", "js", "mjs", "py", "html", "css", "md", "yaml", "yml", "xml", "sql"].includes(ext)) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m13 7-2 10"/></svg>';
  }
  if (["pdf", "doc", "docx", "txt", "rtf", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

export function createTransferController({
  storage = getSafeStorage("localStorage"),
  account = () => null,
  hasEntitlement = () => false,
  isSuperAdmin = () => false,
  navigate = () => {},
  appVersion = "",
}) {
  let initialized = false;
  let visible = false;
  let activeTab = "send";
  let publishingShare = false;
  let queue = [];
  let queueOwner = "";
  let activeSession = null;
  let currentShare = null;
  let ownedShareIds = new Set();
  let loadedShares = [];
  let sharesSearchQuery = "";
  let sharesFilter = "all";
  let ownerGeneration = 0;
  let sharesListGeneration = 0;
  let quotaGeneration = 0;
  const revokingShares = new Set();
  const downloadGrants = new Map();
  const unlockedSharePasswords = new Map();
  let shareRequestGeneration = 0;
  let serverSessions = [];
  let running = false;
  let rerunRequested = false;
  let sessionOpening = null;
  let cleanupOwner = "";
  let cleanupPending = new Set();
  let cleanupInFlight = null;
  let capabilities = { storage_limit_bytes: 500 * 1024 * 1024,
    stored_bytes: 0, reserved_bytes: 0, used_bytes: 0,
    max_share_bytes: 5 * 1024 * 1024 * 1024, max_files_per_share: 500, part_size_bytes: PART_SIZE_HINT };
  let progressNodes = new Map();
  let activePasswordResolver = null;
  let passwordLastTrigger = null;
  let activePutSlots = 0;
  const putWaiters = [];
  const updates = createTransferUpdateScheduler({
    generation: () => ownerGeneration,
    updateProgress: patchQueueProgress,
    persist: writeQueue,
  });

  async function acquirePutSlot(signal) {
    if (signal?.aborted) throw Object.assign(new Error("上传已暂停或取消。"), { name: "AbortError", code: "request_aborted" });
    if (activePutSlots < MAX_ACTIVE_PUTS) {
      activePutSlots += 1;
      return;
    }
    await new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        const idx = putWaiters.indexOf(entry);
        if (idx >= 0) putWaiters.splice(idx, 1);
        reject(Object.assign(new Error("上传已暂停或取消。"), { name: "AbortError", code: "request_aborted" }));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      putWaiters.push(entry);
    });
  }

  function releasePutSlot() {
    while (putWaiters.length) {
      const next = putWaiters.shift();
      if (next) {
        next.resolve();
        return;
      }
    }
    activePutSlots = Math.max(0, activePutSlots - 1);
  }

  function itemInFlightBytes(item) {
    if (!item?._partWire || item.paused || item.status === "cancelled" || item.status === "done") return 0;
    let sum = 0;
    for (const v of item._partWire.values()) sum += Number(v) || 0;
    return sum;
  }

  function itemLiveUploadedBytes(item) {
    if (!item) return 0;
    if (item.status === "done") return Number(item.size || 0);
    return Math.min(Number(item.size || 0), Number(item.uploaded || 0) + itemInFlightBytes(item));
  }

  function itemDisplayPercent(item) {
    if (!item) return 0;
    const size = Number(item.size || 0);
    if (item.status === "done") return 100;
    if (!size) return 0;
    const bytes = (item.status === "uploading" || item.status === "confirming")
      ? itemLiveUploadedBytes(item)
      : Number(item.uploaded || 0);
    return Math.min(99, Math.round((bytes / size) * 100));
  }

  function recordItemWireProgress(item) {
    if (!item || item.paused || item.status !== "uploading") return;
    const now = Date.now();
    const liveBytes = itemLiveUploadedBytes(item);
    const samples = (item._wireSamples = Array.isArray(item._wireSamples) ? item._wireSamples : []);
    const last = samples[samples.length - 1];
    if (!last || now - last.t >= 120 || liveBytes > last.bytes) {
      if (!last || now - last.t >= 120) samples.push({ t: now, bytes: liveBytes });
      else last.bytes = liveBytes;
    }
    const cutoff = now - 3500;
    while (samples.length > 2 && samples[1].t <= cutoff) samples.shift();
    const oldest = samples[0];
    if (oldest && now - oldest.t >= 200) {
      const delta = liveBytes - oldest.bytes;
      const elapsedSec = (now - oldest.t) / 1000;
      if (delta > 0 && elapsedSec > 0) {
        const instantSpeed = delta / elapsedSec;
        item.speed = Number(item.speed) > 0 ? item.speed * 0.45 + instantSpeed * 0.55 : instantSpeed;
        const remaining = Math.max(0, Number(item.size || 0) - liveBytes);
        item.eta = remaining > 0 ? remaining / Math.max(1, item.speed) : 0;
      }
    }
    if (visible && !document.hidden && document.documentElement?.dataset?.androidWebActive !== "false") {
      updates.progress();
    }
  }

  const element = (id) => document.getElementById(id);
  const authenticated = () => Boolean(account()?.id);

  function guestId() {
    let value = String(storage.getItem(GUEST_ID_KEY) || "").trim();
    if (!/^guest:[A-Za-z0-9-]{16,80}$/.test(value)) {
      value = `guest:${randomId()}`;
      storage.setItem(GUEST_ID_KEY, value);
    }
    return value;
  }

  function headers(extra = {}, includeBody = false) {
    const value = {
      ...accountSessionHeaders(storage.getItem(ACCOUNT_SESSION_KEY)),
      ...extra,
    };
    if (!authenticated()) value["X-Transfer-Guest-Id"] = guestId();
    if (includeBody && value["X-Session-Token"]) value["Content-Type"] = "application/json";
    return value;
  }

  async function request(path, options = {}) {
    const init = { method: options.method || "GET", headers: headers(options.headers, options.body !== undefined) };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.bytes) init.body = options.bytes;
    const response = await fetch(path, init);
    const contentType = response.headers.get("Content-Type") || "";
    const payload = contentType.startsWith("application/json") ? await response.json().catch(() => ({})) : null;
    if (!response.ok) {
      const error = new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
      error.code = payload?.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function writeQueue() {
    const value = { account: authenticated() ? String(account().id) : `guest:${guestId()}`, queue };
    const serializable = {
      account: value.account,
    queue: queue.map(({ file, controller, controllers, activeUploads, ...item }) => item),
    };
    storage.setItem(transferQueueStorageKey(value.account), JSON.stringify(serializable));
  }

  // Allocation, pause/error/done and cleanup boundaries stay immediately durable.
  function persistQueue() { updates.persistNow(); }

  function currentOwner() {
    return authenticated() ? String(account().id) : `guest:${guestId()}`;
  }

  function restoreCleanupQueue() {
    const owner = currentOwner();
    if (cleanupOwner === owner) return;
    cleanupOwner = owner;
    try {
      const saved = JSON.parse(storage.getItem(transferCleanupStorageKey(owner)) || "[]");
      cleanupPending = new Set(Array.isArray(saved)
        ? saved.filter((id) => /^[A-Za-z0-9_-]{16,80}$/.test(id)).slice(0, 200) : []);
    } catch (_) {
      cleanupPending = new Set();
    }
  }

  function persistCleanupQueue() {
    storage.setItem(transferCleanupStorageKey(cleanupOwner), JSON.stringify([...cleanupPending]));
  }

  function restoreQueue() {
    try {
      const owner = authenticated() ? String(account().id) : `guest:${guestId()}`;
      if (!shouldAdoptStoredQueue(owner, queueOwner)) return;
      // The owner really changed: stop the previous owner's in-flight uploads
      // before their queue is replaced. Their session and parts belong to the
      // old owner and must not be attached to the new owner's account.
      for (const item of queue) {
        if (!item.file) continue;
        item.status = "cancelled";
        try {
          item.controllers?.forEach((controller) => controller.abort());
          item.controllers?.clear?.();
          item.controller?.abort?.();
        } catch (_) { /* controller already settled */ }
      }
      queueOwner = owner;
      activeSession = null;
      const primarySaved = JSON.parse(storage.getItem(transferQueueStorageKey(owner)) || "{}");
      // One-time import of the pre-account-scoping payload, only when it really
      // belongs to this owner (multi-account isolation: another account's queue
      // must never be adopted, and this account's queue must survive a switch).
      const legacyRaw = (!primarySaved.account || !Array.isArray(primarySaved.queue))
        ? storage.getItem(QUEUE_STORAGE_KEY)
        : "";
      const legacySaved = legacyRaw ? JSON.parse(legacyRaw || "{}") : null;
      const restored = restoreQueueStateForOwner(owner, primarySaved, legacySaved);
      queue = restored.queue;
      if (restored.adopted) persistQueue();
    } catch (_) {
      queue = [];
    }
  }


  function maxFilesLimit() {
    return Math.max(1, Number(capabilities.max_files_per_share || 500));
  }

  function maxShareBytesLimit() {
    return Math.max(1024, Number(capabilities.max_share_bytes || (5 * 1024 * 1024 * 1024)));
  }

  function effectiveRemainingQuota() {
    const limit = Number(capabilities.storage_limit_bytes || 0);
    if (!limit) return 0;
    const used = Number(capabilities.used_bytes ?? (Number(capabilities.stored_bytes || 0) + Number(capabilities.reserved_bytes || 0)));
    const sessionReserved = activeSession?.id ? Number(activeSession.totalBytes || 0) : 0;
    return Math.max(0, limit - Math.max(0, used - sessionReserved));
  }

  function syncTabUi(pushState = false) {
    const page = element("transferPage");
    const isRecipient = recipientShareId() !== null;
    if (page) {
      page.dataset.transferMode = isRecipient ? "recipient" : "sender";
      page.dataset.transferTab = activeTab;
    }
    element("transferRecipientBar")?.classList.toggle("hidden", !isRecipient);
    const tabs = [
      { key: "send", tab: element("transferTabSend"), panel: element("transferSendPanel") },
      { key: "shares", tab: element("transferTabShares"), panel: element("transferSharesPanel") },
      { key: "unfinished", tab: element("transferTabUnfinished"), panel: element("transferUnfinishedPanel") },
    ];
    for (const entry of tabs) {
      const selected = !isRecipient && activeTab === entry.key;
      if (entry.tab) {
        entry.tab.classList.toggle("active", selected);
        entry.tab.setAttribute("aria-selected", selected ? "true" : "false");
        entry.tab.tabIndex = selected ? 0 : -1;
      }
      if (entry.panel) entry.panel.classList.toggle("hidden", !selected);
    }
    if (pushState && !isRecipient && location.pathname === "/transfer") {
      try {
        history.replaceState({ ...(history.state || {}), aerisTransferTab: activeTab }, "");
      } catch (_) {}
    }
  }

  function setActiveTab(tab, { pushState = true } = {}) {
    if (!["send", "shares", "unfinished"].includes(tab)) return;
    activeTab = tab;
    syncTabUi(pushState);
  }

  function updateTabCounts() {
    const sendCount = queue.filter((i) => i.status !== "cancelled").length;
    const sharesCount = loadedShares.filter((s) => s.state !== "revoked").length;
    const unfinishedCount = serverSessions.length + queue.filter((i) => i.needsFile).length;
    const setBadge = (id, count) => {
      const node = element(id);
      if (!node) return;
      node.textContent = String(count);
      node.classList.toggle("hidden", count <= 0);
    };
    setBadge("transferTabSendCount", sendCount);
    setBadge("transferTabSharesCount", sharesCount);
    setBadge("transferTabUnfinishedCount", unfinishedCount);
  }

  function renderLimits() {
    const partSize = Number(capabilities.part_size_bytes || PART_SIZE_HINT);
    const limit = Number(capabilities.storage_limit_bytes || 0);
    if (!limit && capabilities.ok === undefined) {
      setText("transferLimitsLine", "正在获取可用传输限额与存储配额…");
    } else {
      const remaining = effectiveRemainingQuota();
      setText(
        "transferLimitsLine",
        `单次最多 ${maxFilesLimit()} 个文件 · 单批上限 ${formatBytes(maxShareBytesLimit())} · 当前可用配额 ${formatBytes(remaining)} · 分片 ${formatBytes(partSize)}`,
      );
    }
    const expiry = element("transferExpiry");
    const guestHint = element("transferGuestExpiryHint");
    const isGuest = !authenticated();
    if (expiry) {
      for (const option of [...expiry.options]) {
        const mins = Number(option.value || 0);
        option.disabled = isGuest && mins > DEFAULT_EXPIRY_MINUTES;
      }
      if (isGuest && Number(expiry.value || 0) > DEFAULT_EXPIRY_MINUTES) {
        expiry.value = String(DEFAULT_EXPIRY_MINUTES);
      }
    }
    if (guestHint) {
      guestHint.textContent = isGuest ? "当前为游客模式：单次分享有效期上限 1 天；登录后可选 3 天 / 7 天并保存私有附件。" : "";
      guestHint.classList.toggle("hidden", !isGuest);
    }
    renderConfigSummary();
  }

  function updateOverallProgress() {
    const panel = element("transferProgressPanel");
    if (!panel) return;
    const activeItems = queue.filter((item) => item.status !== "cancelled");
    const totalBytes = activeItems.reduce((sum, item) => sum + Number(item.size || 0), 0);
    const uploadedBytes = activeItems.reduce((sum, item) => sum + itemLiveUploadedBytes(item), 0);
    const allDone = activeItems.length > 0 && activeItems.every((i) => i.status === "done");
    const percent = allDone ? 100 : (totalBytes > 0 ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 0);

    let tone = "waiting";
    let stageTitle = "等待选择文件";
    let activeStage = "";
    const doneStages = new Set();
    const errorStages = new Set();

    const anyError = activeItems.some((i) => i.status === "error");
    const anyNeedsFile = activeItems.some((i) => i.needsFile);
    const anyUploading = activeItems.some((i) => i.status === "uploading" && !i.paused);
    const anyPreparing = activeItems.some((i) => i.status === "preparing" && !i.paused);
    const anyConfirming = activeItems.some((i) => i.status === "confirming");
    const anyPaused = activeItems.some((i) => i.paused && i.status !== "done");

    if (publishingShare) {
      tone = "active";
      stageTitle = "正在校验完整性并生成分享…";
      ["prepare", "session", "upload", "confirm"].forEach((s) => doneStages.add(s));
      activeStage = "share";
    } else if (allDone) {
      tone = "complete";
      stageTitle = "分片与完整性已确认，可创建分享";
      ["prepare", "session", "upload", "confirm"].forEach((s) => doneStages.add(s));
      activeStage = "share";
    } else if (anyConfirming) {
      tone = "active";
      stageTitle = "分片已发完，正在等待服务端确认…";
      ["prepare", "session", "upload"].forEach((s) => doneStages.add(s));
      activeStage = "confirm";
    } else if (anyUploading) {
      tone = "active";
      const uploadingCount = activeItems.filter((i) => i.status === "uploading" && !i.paused).length;
      stageTitle = `正在分片上传（${uploadingCount}/${activeItems.length} 个文件进行中）`;
      ["prepare", "session"].forEach((s) => doneStages.add(s));
      activeStage = "upload";
    } else if (anyPreparing || sessionOpening) {
      tone = "active";
      if (activeSession?.id) {
        doneStages.add("prepare");
        activeStage = "session";
        stageTitle = "正在分配文件并校验分片…";
      } else {
        activeStage = "prepare";
        stageTitle = "正在创建安全上传会话…";
      }
    } else if (anyError) {
      tone = "error";
      stageTitle = "部分文件上传失败，可点击重试继续";
      errorStages.add("upload");
    } else if (anyNeedsFile) {
      tone = "paused";
      stageTitle = "已恢复上传进度，请重新选择原文件继续";
      if (activeSession?.id) {
        doneStages.add("prepare");
        doneStages.add("session");
      }
    } else if (anyPaused) {
      tone = "paused";
      stageTitle = "上传已暂停，进度与已确认分片已保留";
      if (activeSession?.id) {
        doneStages.add("prepare");
        doneStages.add("session");
      }
    } else if (activeItems.length > 0) {
      tone = "waiting";
      stageTitle = `已就绪 ${activeItems.length} 个文件，准备开始上传`;
      activeStage = "prepare";
    }

    const totalSpeed = activeItems.reduce((sum, item) => (
      item.status === "uploading" && !item.paused && Number(item.speed) > 0 ? sum + Number(item.speed) : sum
    ), 0);
    const remainingBytes = Math.max(0, totalBytes - uploadedBytes);
    const reliableEta = totalSpeed > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / totalSpeed) : 0;
    const telemetryParts = [];
    if (activeItems.length > 0) telemetryParts.push(`${activeItems.length} 个文件`);
    if (totalSpeed > 0) telemetryParts.push(`${formatBytes(totalSpeed)}/s`);
    if (reliableEta > 0) telemetryParts.push(`预计剩余 ${reliableEta}s`);

    panel.dataset.tone = tone;
    setText("transferStageTitle", stageTitle);
    setText("transferTelemetryText", telemetryParts.join(" · "));
    setText("transferOverallPercent", `${percent}%`);
    const fill = element("transferOverallFill");
    if (fill) fill.style.transform = `scaleX(${(percent / 100).toFixed(4)})`;
    const ring = element("transferOverallRingCircle");
    if (ring) ring.style.strokeDashoffset = (94.25 * (1 - percent / 100)).toFixed(2);
    const bar = element("transferOverallProgressbar");
    if (bar) bar.setAttribute("aria-valuenow", String(percent));

    const pipeline = element("transferPipeline");
    if (pipeline) {
      pipeline.querySelectorAll("li").forEach((li) => {
        const s = li.dataset.stage;
        if (errorStages.has(s)) li.dataset.stepState = "error";
        else if (doneStages.has(s)) li.dataset.stepState = "done";
        else if (activeStage === s) li.dataset.stepState = "active";
        else delete li.dataset.stepState;
      });
    }
  }

  function renderQuota() {
    const hasBreakdown = capabilities.stored_bytes !== undefined &&
      capabilities.reserved_bytes !== undefined;
    const stored = Number(capabilities.stored_bytes || 0);
    const reserved = Number(capabilities.reserved_bytes || 0);
    const used = Number(capabilities.used_bytes ?? (stored + reserved));
    const limit = Number(capabilities.storage_limit_bytes || 0);
    const text = (!limit && capabilities.ok === undefined)
      ? "配额加载中"
      : (hasBreakdown
        ? `已存储 ${formatQuotaBytes(stored)} · 上传预留 ${formatQuotaBytes(reserved)} · 总计 ${formatQuotaBytes(used)} / ${formatQuotaBytes(limit)}`
        : `已用 ${formatQuotaBytes(used)} / ${formatQuotaBytes(limit)}`);
    setText("transferQuotaText", text);
    const progress = element("transferQuotaBar");
    if (progress && Number(progress.max) !== Math.max(1, limit)) progress.max = Math.max(1, limit);
    if (progress && Number(progress.value) !== Math.min(limit, used)) progress.value = Math.min(limit, used);
    setText("transferUploadedBytes", formatBytes(queue.reduce((sum, item) => sum + (item.uploaded || 0), 0)));
    setText("transferTotalBytes", formatBytes(queue.reduce((sum, item) => sum + item.size, 0)));
    renderLimits();
    updateOverallProgress();
    updateTabCounts();
  }

  function setText(id, value) {
    const node = element(id);
    if (node && node.textContent !== value) node.textContent = value;
  }

  function itemById(id) {
    return queue.find((item) => item.id === id);
  }

  function renderConfigSummary() {
    const summary = element("transferConfigSummary");
    const locked = Boolean(activeSession?.id);
    const lockBadge = element("transferConfigLockBadge");
    if (lockBadge) {
      lockBadge.dataset.locked = locked ? "true" : "false";
      lockBadge.textContent = locked ? "会话已创建 · 本批参数已锁定" : "创建会话前可调整";
    }
    const isGuest = !authenticated();
    const oneTimeChecked = Boolean(element("transferOneTime")?.checked);
    const maxDlField = element("transferMaxDownloads");
    if (maxDlField) {
      if (oneTimeChecked) {
        if (!maxDlField.dataset.prevMaxDownloads && maxDlField.value && maxDlField.value !== "1") {
          maxDlField.dataset.prevMaxDownloads = maxDlField.value;
        }
        maxDlField.value = "1";
      } else if (maxDlField.dataset.prevMaxDownloads) {
        maxDlField.value = maxDlField.dataset.prevMaxDownloads;
        delete maxDlField.dataset.prevMaxDownloads;
      }
    }
    for (const id of ["transferExpiry", "transferPassword", "transferMaxDownloads", "transferOneTime"]) {
      const field = element(id);
      if (field) field.disabled = locked || (id === "transferMaxDownloads" && oneTimeChecked);
    }
    if (!summary) return;
    const expiryEl = element("transferExpiry");
    const expiryLabel = expiryEl?.selectedOptions?.[0]?.textContent?.trim() || "1 天";
    const maxDl = oneTimeChecked ? 1 : Number(maxDlField?.value || 5);
    const parts = [expiryLabel, oneTimeChecked ? "阅后即焚（限 1 次）" : `最多 ${maxDl} 次`];
    if (element("transferPassword")?.value?.trim()) parts.push("需密码");
    if (element("transferPrivate")?.checked && !isGuest) parts.push("私有附件");
    summary.textContent = parts.join(" · ");
  }

  function renderQueue() {
    renderConfigSummary();
    const dropZone = element("transferDropZone");
    if (dropZone) dropZone.dataset.hasFiles = queue.length > 0 ? "true" : "false";
    const privacy = element('transferPrivate');
    if (privacy) {
      privacy.disabled = !authenticated() || Boolean(activeSession?.id);
      if (activeSession?.accessScope) privacy.checked = activeSession.accessScope === 'private';
      setText('transferCompleteBtn',privacy.checked ? '保存私有附件' : '创建分享链接');
    }
    updates.cancelProgress();
    const list = element("transferQueue");
    if (!list) return;
    reconcileKeyedRows(list, queue, {
      key: item => item.id,
      // Numeric progress is patched by the existing rAF scheduler. A status
      // change in one file must not replace other uploading files or controls.
      signature: item => JSON.stringify([item.name, item.relativePath, item.size, item.status,
        item.error, item.needsFile, transferItemAction(item)]),
      empty: '<div class="transfer-empty">还没有选择文件。拖入文件、选择文件夹或按 Ctrl+V 粘贴文件。</div>',
      render: (item) => {
        const liveBytes = itemLiveUploadedBytes(item);
        const percent = itemDisplayPercent(item);
        const action = transferItemAction(item);
        const stateKey = item.paused && !["done", "cancelled"].includes(item.status) ? "paused" : (item.status || "pending");
        const phase = action === "preparing" ? " · 正在创建安全上传任务" : item.error ? ` · ${escapeHtml(item.error)}` : "";
        const primaryAction = action === "resume"
          ? `<button class="button-secondary" type="button" data-transfer-resume="${escapeHtml(item.id)}">开始/继续</button>`
          : action === "pause"
            ? `<button class="button-secondary" type="button" data-transfer-pause="${escapeHtml(item.id)}">暂停</button>`
            : action === "preparing"
              ? '<span class="transfer-item-state" data-status="preparing" role="status">准备中…</span>'
              : "";
        return `<article class="transfer-item" data-transfer-item="${escapeHtml(item.id)}" data-state="${escapeHtml(stateKey)}">
          <div class="tf-item-icon" aria-hidden="true">${fileTypeIconSvg(item.name)}</div>
          <div class="transfer-item-main">
            <div class="transfer-item-heading">
              <strong class="tf-item-name" title="${escapeHtml(item.relativePath)}" data-transfer-expand-path="${escapeHtml(item.id)}">${escapeHtml(item.name)}</strong>
              <span class="transfer-item-state" data-status="${escapeHtml(stateKey)}">${escapeHtml(transferItemStatusLabel(item))}</span>
              <span class="transfer-item-percent tabular-nums">${percent}%</span>
            </div>
            <small>${escapeHtml(item.relativePath)} · ${formatBytes(liveBytes)} / ${formatBytes(item.size)}${item.speed ? ` · ${formatBytes(item.speed)}/s` : ""}${item.eta ? ` · 剩余 ${Math.ceil(item.eta)}s` : ""}${item.needsFile ? " · 已恢复，请重新选择同一文件继续" : ""}${phase}</small>
            <progress max="100" value="${percent}" aria-label="${escapeHtml(item.name)} 上传进度"></progress>
          </div>
          <div class="transfer-item-actions">
            ${primaryAction}
            ${action === "retry" ? `<button class="button-secondary" type="button" data-transfer-retry="${escapeHtml(item.id)}">重试</button>` : ""}
            <button class="button-ghost danger-text" type="button" data-transfer-cancel="${escapeHtml(item.id)}">取消</button>
          </div>
        </article>`;
      },
    });
    progressNodes = new Map();
    list.querySelectorAll?.("[data-transfer-item]").forEach((row) => {
      progressNodes.set(row.dataset.transferItem, {
        row, detail: row.querySelector?.("small"), progress: row.querySelector?.("progress"), percent: row.querySelector?.(".transfer-item-percent"),
      });
    });
    const complete = queue.length > 0 && queue.every((item) => item.status === "done");
    element("transferCompleteBtn").disabled = !complete;
    patchQueueProgress();
    updateTabCounts();
  }

  function patchQueueProgress() {
    for (const item of queue) {
      if (item.status !== "uploading") continue;
      const nodes = progressNodes.get(item.id);
      if (!nodes?.row.isConnected) continue;
      const liveBytes = itemLiveUploadedBytes(item);
      const percent = itemDisplayPercent(item);
      const text = `${item.relativePath} · ${formatBytes(liveBytes)} / ${formatBytes(item.size)}`
        + (item.speed ? ` · ${formatBytes(item.speed)}/s` : "")
        + (item.eta ? ` · 剩余 ${Math.ceil(item.eta)}s` : "");
      if (nodes.detail && nodes.detail.textContent !== text) nodes.detail.textContent = text;
      if (nodes.progress && Number(nodes.progress.value) !== percent) nodes.progress.value = percent;
      if (nodes.percent && nodes.percent.textContent !== `${percent}%`) nodes.percent.textContent = `${percent}%`;
    }
    renderQuota();
    updateOverallProgress();
  }

  function setMessage(message, tone = "") {
    const target = element("transferMessage");
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
  }

  function showValidationErrors(rejections) {
    const banner = element("transferValidationBanner");
    const list = element("transferValidationList");
    if (!banner || !list) return;
    if (!rejections.length) {
      banner.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    setText("transferValidationTitle", `${rejections.length} 个文件未加入传输队列（请先调整或清理后重试）`);
    list.innerHTML = rejections.slice(0, 12).map((entry) => (
      `<li><strong>${escapeHtml(entry.name)}</strong>：${escapeHtml(entry.reason)}</li>`
    )).join("") + (rejections.length > 12 ? `<li>其余 ${rejections.length - 12} 个文件同样超出当前限制</li>` : "");
    banner.classList.remove("hidden");
  }

  function addFiles(fileList) {
    const rawFiles = [...(fileList || [])].filter(Boolean);
    if (!rawFiles.length) return;
    const rejections = [];
    const accepted = [];
    let reattached = false;

    const currentActiveCount = queue.filter((i) => i.status !== "cancelled").length;
    const currentBytes = queue.reduce((sum, i) => sum + (i.status !== "cancelled" ? Number(i.size || 0) : 0), 0);
    const maxFiles = maxFilesLimit();
    const maxBatchBytes = maxShareBytesLimit();
    const quotaRemaining = effectiveRemainingQuota();
    let projectedCount = currentActiveCount;
    let projectedBytes = currentBytes;

    for (const file of rawFiles) {
      const fileName = String(file.name || "unnamed");
      const relPath = safeFileRelativePath(file);
      if (!Number.isFinite(file.size) || file.size <= 0) {
        rejections.push({ name: fileName, reason: "文件大小为 0 B，不支持空文件" });
        continue;
      }
      const existing = queue.find((item) => item.needsFile && item.relativePath === relPath && item.size === file.size)
        || queue.find((item) => item.needsFile && item.name === fileName && item.size === file.size);
      if (existing) {
        existing.file = file;
        existing.needsFile = false;
        existing.status = existing.status === "error" ? "pending" : existing.status;
        reattached = true;
        continue;
      }
      if (projectedCount + 1 > maxFiles) {
        rejections.push({ name: relPath, reason: `已达单批数量上限（最多 ${maxFiles} 个文件）` });
        continue;
      }
      if (projectedBytes + file.size > maxBatchBytes) {
        rejections.push({ name: relPath, reason: `超出单批总体积上限（${formatBytes(maxBatchBytes)}）` });
        continue;
      }
      if (quotaRemaining > 0 && projectedBytes + file.size > quotaRemaining) {
        rejections.push({ name: relPath, reason: `超出当前可用存储配额（可用 ${formatBytes(quotaRemaining)}）` });
        continue;
      }
      projectedCount += 1;
      projectedBytes += file.size;
      accepted.push({
        id: randomId(),
        file,
        name: fileName,
        relativePath: relPath,
        size: file.size,
        uploaded: 0,
        speed: 0,
        eta: 0,
        paused: false,
        status: "pending",
        sessionId: activeSession?.id || "",
        fileId: "",
        partSize: 0,
        partCount: 0,
        uploadedParts: [],
      });
    }

    if (accepted.length) queue.push(...accepted);
    showValidationErrors(rejections);
    if (rejections.length) {
      setMessage(`${rejections.length} 个文件未加入队列：${rejections[0].reason}`, "warning");
    } else if (reattached || accepted.length) {
      setMessage("");
    }
    if (!reattached && !accepted.length) return;
    // Clear the previous completed share card once a new batch/file starts so the user never mistakes it for the new upload.
    if (currentShare && recipientShareId() === null) clearShare();
    persistQueue();
    renderQueue();
    void run();
  }

  async function ensureSession() {
    if (!activeSession) {
      const restoredSessionId = sessionIdForQueue(queue);
      if (restoredSessionId) activeSession = { id: restoredSessionId, expiresAt: "" };
    }
    const plan = sessionPlan(queue, activeSession);
    if (plan.reuse && activeSession) return activeSession;
    return openSessionForBatch(plan);
  }

  /**
   * Opens the session that matches the *current* queue. Everything uploaded into
   * the previous session is reset and re-uploaded: the upload protocol has no way
   * to move parts between sessions, so a new batch is an explicit re-upload
   * rather than a silent mix of two server sessions. The previous session is
   * aborted so no orphan session (and no ghost object) is left behind.
   */
  async function openSessionForBatch(plan) {
    // Serialize concurrent appends: two quick "add file" taps must never create
    // two sessions for the same batch.
    if (sessionOpening) {
      await sessionOpening.catch(() => {});
      const settled = sessionPlan(queue, activeSession);
      if (settled.reuse && activeSession) return activeSession;
    }
    const previous = activeSession;
    let openedPlan = plan;
    let openingIds = [];
    sessionOpening = (async () => {
      if (previous?.id) {
        if (!await abortSession(previous.id)) {
          throw new Error("旧上传任务尚未释放，请联网后重试。");
        }
        resetQueueForStaleSession(queue, previous.id);
        if (activeSession?.id === previous.id) activeSession = null;
        persistQueue();
        renderQueue();
      }
      openedPlan = sessionPlan(queue, null);
      if (!openedPlan.fileCount) throw new Error("当前上传队列为空。");
      openingIds = sessionBatchIds(queue);
      const body = {
        minutes: Number(element("transferExpiry")?.value || DEFAULT_EXPIRY_MINUTES),
        max_downloads: Boolean(element("transferOneTime")?.checked) ? 1 : Number(element("transferMaxDownloads")?.value || 5),
        one_time: Boolean(element("transferOneTime")?.checked),
        password: String(element("transferPassword")?.value || ""),
        file_count: openedPlan.fileCount,
        total_bytes: openedPlan.totalBytes,
        idempotency_key: randomId(),
      };
      if (authenticated() && element('transferPrivate')?.checked) body.access_scope = 'private';
      if (!authenticated()) body.guest_id = guestId();
      return await request("/api/transfer/uploads", { method: "POST", body });
    })();
    let payload;
    try {
      payload = await sessionOpening;
    } finally {
      sessionOpening = null;
    }
    const batchIds = sessionBatchIds(queue);
    if (batchIds.length !== openingIds.length || batchIds.some((id, index) => id !== openingIds[index])) {
      await abortSession(payload.upload.id);
      throw new Error("上传列表在创建任务时变化，已释放旧任务；请继续上传。");
    }
    activeSession = {
      id: payload.upload.id,
      expiresAt: payload.upload.expires_at,
      accessScope: payload.upload.access_scope || 'share',
      fileCount: openedPlan.fileCount,
      totalBytes: openedPlan.totalBytes,
      batchIds,
    };
    for (const item of queue) {
      if (item.status === "cancelled") continue;
      if (String(item.sessionId || "") === activeSession.id) continue;
      item.sessionId = activeSession.id;
      // A different session cannot reuse this file's allocation: drop it and let
      // the pipeline re-upload the file into the new batch.
      item.fileId = "";
      item.partSize = 0;
      item.partCount = 0;
      item.uploadedParts = [];
      item.uploaded = 0;
      item.speed = 0;
      item.eta = 0;
      delete item.error;
      delete item.failedPart;
      if (item.status === "done" || item.status === "uploading") item.status = "pending";
    }
    persistQueue();
    renderQueue();
    void Promise.all([loadCapabilities(), loadUnfinishedSessions()]);
    if (plan.reason === "file-count-grew" || plan.reason === "size-changed") {
      setMessage("已按当前文件列表重新创建上传任务，正在重新上传。");
    }
    return activeSession;
  }

  /** Persist failed aborts; the server cron is the backstop when this page is gone. */
  async function abortSession(sessionId) {
    if (!sessionId) return true;
    restoreCleanupQueue();
    cleanupPending.add(sessionId);
    persistCleanupQueue();
    try {
      const body = {};
      if (!authenticated()) body.guest_id = guestId();
      await request(`/api/transfer/uploads/${sessionId}/abort`, { method: "POST", body });
      cleanupPending.delete(sessionId);
      persistCleanupQueue();
      return true;
    } catch (error) {
      if (error?.code === "transfer_session_not_found") {
        cleanupPending.delete(sessionId);
        persistCleanupQueue();
        return true;
      }
      return false;
    }
  }

  async function retryCleanupPending() {
    restoreCleanupQueue();
    if (!cleanupPending.size) return;
    if (cleanupInFlight) return cleanupInFlight;
    cleanupInFlight = (async () => {
      for (const sessionId of [...cleanupPending].slice(0, 20)) {
        if (!await abortSession(sessionId)) continue;
        const affected = queue.filter((item) => item.sessionId === sessionId);
        if (resetQueueForStaleSession(queue, sessionId)) {
          if (activeSession?.id === sessionId) activeSession = null;
          for (const item of affected) item.paused = true;
          persistQueue();
          renderQueue();
          setMessage("旧上传任务已释放；可继续上传保留的文件。", "success");
        }
      }
      await loadCapabilities();
    })();
    try { await cleanupInFlight; } finally { cleanupInFlight = null; }
  }

  /** SHA-256 of exactly one part's bytes; the pipeline runs this ahead of the PUT. */
  async function hashPartBytes(item, part) {
    const slice = item.file.slice(part.offset, part.offset + part.length);
    const partDigest = await crypto.subtle.digest("SHA-256", await slice.arrayBuffer());
    return [...new Uint8Array(partDigest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function uploadPartBytes(item, part, partHash) {
    const partNumber = part.partNumber;
    const body = item.file.slice(part.offset, part.offset + part.length);
    const controller = new AbortController();
    // Several parts are in flight at once: keep every controller so pause and
    // cancel stop all active requests, and run() can see the item is busy.
    item.controllers = item.controllers || new Set();
    item._partWire = item._partWire || new Map();
    item.controllers.add(controller);
    item.controller = controller;
    item.activeUploads = (Number(item.activeUploads) || 0) + 1;
    await acquirePutSlot(controller.signal).then(async () => {
      try {
        await putPartWithRecovery({
          url: `/api/transfer/uploads/${item.sessionId}/files/${item.fileId}/parts/${partNumber}`,
          headers: () => headers({ "Content-Type": "application/octet-stream", "X-Part-Sha256": partHash }),
          body,
          signal: controller.signal,
          onAttemptReset: () => {
            item._partWire?.delete(partNumber);
          },
          onProgress: (loaded) => {
            if (item.paused || item.status === "cancelled") return;
            item._partWire?.set(partNumber, Math.min(part.length, Number(loaded) || 0));
            recordItemWireProgress(item);
          },
        });
      } finally {
        releasePutSlot();
      }
    }).finally(() => {
      item._partWire?.delete(partNumber);
      item.controllers?.delete(controller);
      item.activeUploads = Math.max(0, (Number(item.activeUploads) || 1) - 1);
      if (item.activeUploads === 0) item.controller = null;
    });
    return body.size;
  }

  async function allocateItem(item) {
    if (item.fileId) return;
    const body = {
      session_id: item.sessionId,
      file_id: `file-${randomId().replaceAll("-", "").slice(0, 20)}`,
      relative_path: item.relativePath,
      file_name: item.name,
      mime_type: item.file.type || "application/octet-stream",
      size_bytes: item.size,
    };
    if (!authenticated()) body.guest_id = guestId();
    const payload = await request("/api/transfer/uploads/files", { method: "POST", body });
    item.fileId = payload.file.file_id;
    item.partSize = payload.file.part_size;
    item.partCount = payload.file.part_count;
    item.uploadedParts = [];
    persistQueue();
  }

  async function uploadItem(item) {
    if (!item.file) {
      item.status = "pending";
      item.needsFile = true;
      renderQueue();
      return;
    }
    item.status = "preparing";
    item.paused = false;
    persistQueue();
    renderQueue();
    let prepared = false;
    for (let attempt = 0; attempt < 2 && !prepared; attempt += 1) {
      try {
        await ensureSession();
        if (item.sessionId !== activeSession.id) item.sessionId = activeSession.id;
        persistQueue();
        await allocateItem(item);
        prepared = true;
      } catch (error) {
        const staleSessionId = String(item.sessionId || activeSession?.id || "");
        if (attempt === 0 && staleSessionId && isRecoverableUploadSessionError(error)) {
          resetQueueForStaleSession(queue, staleSessionId);
          if (activeSession?.id === staleSessionId) activeSession = null;
          persistQueue();
          renderQueue();
          setMessage("旧上传任务已失效，正在创建新任务继续上传。", "info");
          continue;
        }
        item.status = "error";
        item.error = error?.message || "上传任务准备失败，请重试。";
        item.controller = null;
        item.activeUploads = 0;
        persistQueue();
        renderQueue();
        setMessage(item.error, "error");
        return;
      }
    }
    if (!prepared) return;
    item.status = "uploading";
    item._partWire = new Map();
    if (item.partCount === 0) item.partCount = Math.max(1, Math.ceil(item.size / item.partSize));
    item.uploadedParts = Array.isArray(item.uploadedParts) ? item.uploadedParts : [];
    // Progress is acknowledged bytes, not "highest part seen": parallel parts
    // finish out of order, and the old formula could jump straight to 100%.
    item.uploaded = item.uploadedParts.reduce((sum, partNumber) => {
      const offset = (Number(partNumber) - 1) * item.partSize;
      return sum + Math.min(item.partSize, item.size - offset);
    }, 0);
    item._wireSamples = [{ t: Date.now(), bytes: item.uploaded }];
    persistQueue();
    renderQueue();
    const queueParts = missingPartNumbers(item.partCount, item.uploadedParts);
    const startedAt = Date.now();
    const startBytes = item.uploaded;
    const plan = queueParts.map((partNumber) => {
      const offset = (partNumber - 1) * item.partSize;
      const length = Math.min(item.partSize, item.size - offset);
      return { partNumber, offset, length };
    });
    let metrics = null;
    let failure = null;
    try {
      metrics = await runPartPipeline({
        parts: plan,
        workerCount: uploadWorkerCount(item.partCount, item.uploadedParts),
        hashPart: (part) => hashPartBytes(item, part),
        uploadPart: (part, hash) => uploadPartBytes(item, part, hash),
        shouldStop: () => {
          if (item.status === "cancelled") return "cancelled";
          if (item.paused) return "paused";
          return "";
        },
        onUploaded: (part, uploadedBytes) => {
          const partNumber = part.partNumber;
          const length = part.length;
          item._partWire?.delete(partNumber);
          if (!item.uploadedParts.includes(partNumber)) item.uploadedParts.push(partNumber);
          item.uploaded = Math.min(item.size, item.uploaded + (uploadedBytes || length));
          delete item.failedPart;
          updates.persistLater();
          const elapsed = (Date.now() - startedAt) / 1000;
          if (!item.speed && elapsed > 0.05 && item.uploaded > startBytes) {
            item.speed = (item.uploaded - startBytes) / Math.max(0.05, elapsed);
          }
          if (item.speed > 0) {
            const live = itemLiveUploadedBytes(item);
            item.eta = item.size > live ? (item.size - live) / Math.max(1, item.speed) : 0;
          }
          if (visible && !document.hidden && document.documentElement?.dataset?.androidWebActive !== "false") updates.progress();
        },
      });
    } catch (error) {
      failure = error;
    }
    if (!failure && !(item.paused || item.status === "cancelled")) {
      item.status = "confirming";
      renderQueue();
    }
    if (metrics) {
      item.performance = uploadPerformanceSummary({
        bytes: metrics.bytes,
        hashMs: metrics.hashMs,
        uploadMs: metrics.uploadMs,
        totalMs: Date.now() - startedAt,
      });
    }
    if (item.status === "cancelled") {
      item._partWire?.clear();
      item.speed = 0;
      item.eta = 0;
      item.controller = null;
      item.activeUploads = 0;
      return;
    }
    // A pause interrupts the in-flight PUTs; acknowledged parts stay recorded and
    // the rest resume. It is not a finished upload, so the item must not be
    // marked done (that used to make「开始/继续」a no-op after pausing).
    if (metrics?.stoppedBy === "paused" || item.paused) {
      item._partWire?.clear();
      item.speed = 0;
      item.eta = 0;
      item.status = "pending";
      item.controller = null;
      item.activeUploads = 0;
      persistQueue();
      renderQueue();
      return;
    }
    if (failure) {
      item._partWire?.clear();
      item.speed = 0;
      item.eta = 0;
      if (item.uploaded === 0 && isRecoverableUploadSessionError(failure)) {
        const staleSessionId = String(item.sessionId || activeSession?.id || "");
        resetQueueForStaleSession(queue, staleSessionId);
        if (activeSession?.id === staleSessionId) activeSession = null;
        item.controller = null;
        item.activeUploads = 0;
        persistQueue();
        renderQueue();
        setMessage("上传任务状态已失效，已安全重建；请继续上传。", "warning");
        return;
      }
      item.status = "error";
      item.error = failure.message;
      item.failedPart = Number(failure.partNumber) || 0;
      item.controller = null;
      item.activeUploads = 0;
      persistQueue();
      renderQueue();
      return;
    }
    item._partWire?.clear();
    item.eta = 0;
    item.status = "done";
    item.controller = null;
    item.activeUploads = 0;
    persistQueue();
    renderQueue();
    if (queue.every((entry) => entry.status === "done")) setMessage("全部文件已上传，可以创建分享链接。");
  }

  async function run() {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      // Ensure one shared batch session before launching bounded parallel file workers
      // so concurrent workers never yank or abort an active session mid-PUT.
      for (let pass = 0; pass < 4; pass += 1) {
        const isRunnable = (item) => Boolean(
          item.file
          && !item.paused
          && item.status !== "done"
          && item.status !== "cancelled"
          && item.status !== "error"
          && !item.controller
          && !(Number(item.activeUploads) > 0),
        );
        const initialBatch = queue.filter(isRunnable);
        if (!initialBatch.length) break;
        try {
          await ensureSession();
        } catch (error) {
          setMessage(error?.message || "上传会话创建失败，请重试。", "error");
          break;
        }
        const attempted = new Set();
        let progressed = false;
        const pickNextItem = () => {
          if (!sessionPlan(queue, activeSession).reuse) return null;
          for (const item of queue) {
            if (attempted.has(item.id)) continue;
            if (isRunnable(item)) {
              attempted.add(item.id);
              return item;
            }
          }
          return null;
        };
        const fileWorkerCount = Math.min(MAX_CONCURRENT_FILES, Math.max(1, initialBatch.length));
        await Promise.all(Array.from({ length: fileWorkerCount }, async () => {
          while (true) {
            const next = pickNextItem();
            if (!next) return;
            await uploadItem(next);
            progressed = true;
          }
        }));
        const needsWork = queue.some((item) =>
          item.file
          && !item.paused
          && item.status !== "done"
          && item.status !== "cancelled"
          && item.status !== "error");
        const plan = sessionPlan(queue, activeSession);
        if (!progressed && plan.reuse) break;
        if (!needsWork && plan.reuse) break;
      }
    } finally {
      running = false;
      if (rerunRequested) {
        rerunRequested = false;
        void run();
      }
    }
  }

  async function complete() {
    const operationOwner=currentOwner();
    if (!queue.length || queue.some((item) => item.status !== "done")) {
      setMessage("还有文件没有上传完成。", "error");
      return;
    }
    if (!activeSession) {
      // The queue survives a page reload; the in-memory session object does
      // not. The persisted session id is the same server-side upload task, so
      // an already uploaded queue can still be published.
      const restoredSessionId = sessionIdForQueue(queue);
      if (restoredSessionId) activeSession = { id: restoredSessionId, expiresAt: "" };
    }
    if (!activeSession) {
      setMessage("还有文件没有上传完成。", "error");
      return;
    }
    // The queue may have grown after the upload finished (a file added while the
    // last one was still uploading). Publishing must never mix two server
    // sessions, so this re-opens the batch when the plan no longer matches.
    const plan = sessionPlan(queue, activeSession);
    if (!plan.reuse) {
      setMessage("文件列表已变化，正在重新上传后再创建分享…");
      try {
        await ensureSession();
      } catch (error) {
        if(operationOwner!==currentOwner())return;
        setMessage(error.message || "重新上传任务创建失败，请重试。", "error");
        return;
      }
      if(operationOwner!==currentOwner())return;
      void run();
      setMessage("已按当前文件列表重新上传，请稍候再创建分享。", "info");
      return;
    }
    setMessage("正在创建分享…");
    publishingShare = true;
    updateOverallProgress();
    try {
      const body = {};
      if (!authenticated()) body.guest_id = guestId();
      const payload = await request(`/api/transfer/uploads/${activeSession.id}/complete`, { method: "POST", body });
      if(operationOwner!==currentOwner())return;
      currentShare = payload.share;
      queue = [];
      activeSession = null;
      persistQueue();
      ownedShareIds.add(payload.share.id);
      renderQueue();
      renderShare(payload.share);
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      element("transferShareCard")?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
      setMessage(payload.share.access_scope === 'private' ? '私有附件已保存，仅当前账户可获取下载授权。' : "分享已创建。", "success");
      // Publication moves the reservation into stored usage; renderShare() already refreshes my-shares.
      void Promise.all([loadCapabilities(), loadUnfinishedSessions()]);
    } catch (error) {
      if(operationOwner!==currentOwner())return;
      setMessage(error.message || "创建分享失败。", "error");
    } finally {
      publishingShare = false;
      updateOverallProgress();
    }
  }

  function qrDataUrl(value) {
    const canvas = element("transferQr");
    if (!canvas || typeof window.qrcode !== "function") return;
    const utf8Encoder = window.qrcode.stringToBytesFuncs?.["UTF-8"];
    if (utf8Encoder) window.qrcode.stringToBytes = utf8Encoder;
    const qr = window.qrcode(0, "M");
    qr.addData(String(value));
    qr.make();
    const cellSize = 6;
    const quiet = 3;
    const count = qr.getModuleCount();
    canvas.width = (count + quiet * 2) * cellSize;
    canvas.height = canvas.width;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (!qr.isDark(row, column)) continue;
        context.fillRect((column + quiet) * cellSize, (row + quiet) * cellSize, cellSize, cellSize);
      }
    }
  }

  function updateCurrentShareActions() {
    const actions = element("transferShareOwnerActions");
    const revoke = element("transferCurrentRevokeBtn");
    const owned = Boolean(currentShare?.id && ownedShareIds.has(currentShare.id));
    actions?.classList.toggle("hidden", !owned);
    if (revoke) {
      if (owned) revoke.dataset.transferRevoke = currentShare.id;
      else delete revoke.dataset.transferRevoke;
    }
  }

  function renderRecipientError(error) {
    const card = element("transferRecipientError");
    if (!card) return;
    element("transferShareCard")?.classList.add("hidden");
    const code = String(error?.code || "");
    const status = Number(error?.status || 0);
    let title = "无法打开此分享";
    let body = error?.message || "分享链接不存在、已过期或网络暂时不可用。";
    if (code === "share_revoked") {
      title = "分享已被创建者撤销";
      body = "该分享已失效，无法继续查看或下载文件。";
    } else if (code === "transfer_download_limit_reached" || (status === 410 && body.includes("次数"))) {
      title = "已达最大下载次数";
      body = "该分享的可用下载配额已用尽，或已触发阅后即焚销毁。";
    } else if (status === 410 || code.includes("expired")) {
      title = "分享已过期";
      body = "该分享超过了设定的有效期，服务端已关闭授权。";
    } else if (status === 404) {
      title = "未找到分享或私有附件无权访问";
      body = "请核对链接是否完整；如果这是其他账户保存的私有附件，请先登录对应账户再访问。";
    }
    setText("transferRecipientErrorTitle", title);
    setText("transferRecipientErrorBody", body);
    card.classList.remove("hidden");
  }

  function clearRecipientError() {
    element("transferRecipientError")?.classList.add("hidden");
  }

  function closePasswordModal(result = null) {
    const modal = element("transferPasswordModal");
    const input = element("transferSharePasswordInput");
    const err = element("transferPasswordModalError");
    const resolver = activePasswordResolver;
    activePasswordResolver = null;
    if (input) {
      input.value = "";
      input.type = "password";
    }
    const reveal = element("transferSharePasswordReveal");
    if (reveal) {
      reveal.textContent = "显示";
      reveal.setAttribute("aria-pressed", "false");
    }
    if (err) {
      err.textContent = "";
      err.classList.add("hidden");
    }
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
    if (passwordLastTrigger?.focus && passwordLastTrigger.isConnected) {
      try { passwordLastTrigger.focus(); } catch (_) {}
    }
    passwordLastTrigger = null;
    if (resolver) resolver(result);
  }

  function promptSharePassword(description = "该分享受访问密码保护，请输入密码以获取本次安全下载授权。", initialError = "") {
    const modal = element("transferPasswordModal");
    const input = element("transferSharePasswordInput");
    if (!modal || !input) return Promise.resolve("");
    if (activePasswordResolver) closePasswordModal(null);
    passwordLastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setText("transferPasswordModalDesc", description);
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    const err = element("transferPasswordModalError");
    if (err) {
      err.textContent = initialError;
      err.classList.toggle("hidden", !initialError);
    }
    input.value = "";
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 20);
    return new Promise((resolve) => {
      activePasswordResolver = resolve;
    });
  }

  function renderShare(share) {
    currentShare = share;
    clearRecipientError();
    element("transferShareCard")?.classList.remove("hidden");
    const privateFile = share.access_scope === 'private';
    const scopeBadge = element("transferShareScopeBadge");
    if (scopeBadge) {
      scopeBadge.textContent = privateFile ? "私有附件" : "公开分享";
      scopeBadge.dataset.tone = privateFile ? "info" : "success";
    }
    setText('transferShareTitle', privateFile ? '私有附件已保存' : (recipientShareId() !== null ? '收到文件分享' : '分享已创建'));
    setText('transferShareAccessHint', privateFile ? `仅当前账户可访问，${new Date(share.expires_at).toLocaleString('zh-CN')} 到期。` : '复制链接或扫码，下载次数与有效期由服务端强制执行。');
    setText('transferCurrentRevokeLabel',privateFile ? '撤销这个附件' : '撤销这个分享');
    setText('transferShareOwnerNote',privateFile ? '附件内容不能就地更改；撤销后可以重新选择文件保存新附件。' : '已发布文件不能就地更改；撤销后可以重新选择文件创建新分享。');

    const metaChips = element("transferShareMetaChips");
    if (metaChips) {
      const dlCount = Number(share.download_count || 0);
      const chips = [
        `${Number(share.file_count || share.files?.length || 0)} 个文件`,
        formatBytes(share.total_bytes || 0),
        share.one_time
          ? `阅后即焚（限 1 次 · 已下载 ${Math.min(1, dlCount)}/1 次）`
          : `下载 ${dlCount} / ${Number(share.max_downloads || 0)} 次`,
        `${new Date(share.expires_at).toLocaleString("zh-CN")} 到期`,
      ];
      if (share.password_required) chips.push("密码保护");
      metaChips.innerHTML = chips.map((c) => `<span class="tf-meta-chip">${escapeHtml(c)}</span>`).join("");
    }

    element('transferSharePublicBox')?.classList.toggle('hidden', privateFile);
    element('transferShareLink')?.parentElement?.classList.toggle('hidden', privateFile);
    element('transferQr')?.classList.toggle('hidden', privateFile);
    const url = privateFile ? '' : `${location.origin}/transfer#share=${encodeURIComponent(share.id)}`;
    element("transferShareLink").value = url;
    element("transferShareLink").href = url;
    if (!privateFile) qrDataUrl(url);
    element("transferShareFiles").innerHTML = (share.files || []).map((file) => `<div class="transfer-share-file">
      <div class="tf-share-file-meta">
        <div class="tf-item-icon" aria-hidden="true">${fileTypeIconSvg(file.file_name)}</div>
        <div class="tf-share-file-copy">
          <strong title="${escapeHtml(file.relative_path || file.file_name)}">${escapeHtml(file.file_name)}</strong>
          <small>${escapeHtml(file.relative_path)} · ${formatBytes(file.size_bytes)} · ${file.integrity_status === 'full_sha256_verified' ? '完整文件 SHA-256 已校验' : file.integrity_status === 'parts_verified' ? '分片 SHA-256 已校验' : '历史文件'} · 安全下载</small>
        </div>
      </div>
      <button class="button-secondary" type="button" data-transfer-download="${escapeHtml(share.id)}|${escapeHtml(file.file_id)}">下载</button>
    </div>`).join("");
    updateCurrentShareActions();
    void loadMyShares();
  }

  async function downloadShareFile(shareId, fileId, passwordRequired = false) {
    const operationOwner=currentOwner();
    // Only a share that really carries a password may open a modal prompt: an
    // unconditional prompt blocked the renderer (and every headless
    // browser flow) even for public shares, and asked users for a password that
    // does not exist.
    const privateFile = currentShare?.id === shareId && currentShare.access_scope === 'private';
    const grantKey = privateFile ? `${operationOwner}:${shareId}:${fileId}` : shareId;
    const cached = downloadGrants.get(grantKey);
    const reusable = cached && cached.expiresAt > Date.now() + 5_000;
    const password = !reusable && passwordRequired
      ? (unlockedSharePasswords.get(shareId) ?? await promptSharePassword())
      : "";
    if (password === null) {
      setMessage("已取消下载。", "info");
      return;
    }
    try {
      const payload = reusable ? cached.payload
        : await request(`/api/transfer/shares/${shareId}/authorize`, { method: "POST", body: { password, ...(privateFile ? {file_id:fileId} : {}) } });
      if(operationOwner!==currentOwner())return;
      if (!reusable) downloadGrants.set(grantKey, {
        payload, expiresAt: Date.parse(payload.download.expires_at) || 0,
      });
      const token = payload.download.token;
      const meta = payload.download.share.files.find((file) => file.file_id === fileId);
      const downloadUrl = `/api/transfer/shares/${shareId}/download?file=${encodeURIComponent(fileId)}&grant=${encodeURIComponent(token)}`;
      const nativeDownload = isThewyjAndroidApp();
      // The authorized endpoint streams an attachment. Browser download and
      // Android's existing DownloadListener handle the bytes, resume and disk
      // destination; advertising a save picker must never change this path.
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = meta?.file_name || "download";
      anchor.rel = "noopener";
      anchor.referrerPolicy = "no-referrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setMessage(nativeDownload ? "正在交给 Android 下载，请等待完整性校验。" : "下载已开始，请查看浏览器下载列表。",
        nativeDownload ? "info" : "success");
    } catch (error) {
      if(operationOwner!==currentOwner())return;
      if (error?.name === "AbortError") setMessage("下载已取消，需要时可再次点击下载。", "info");
      else if (error?.status === 403 || error?.code === "share_password_invalid") {
        unlockedSharePasswords.delete(shareId);
        setMessage("访问密码不正确，请点击下载重新输入。", "error");
      }
      else if (error?.status === 410 || error?.code === "share_revoked" || error?.code === "transfer_download_limit_reached") {
        setMessage(error.message || "分享已失效或达到下载上限。", "error");
        if (recipientShareId() === shareId) renderRecipientError(error);
      } else setMessage(error.message || "下载失败。", "error");
    }
  }

  function renderFilteredShares() {
    const list = element("transferMyShares");
    if (!list) return;
    if (!loadedShares.length) {
      list.innerHTML = '<div class="transfer-empty">还没有创建过文件分享或私有附件。</div>';
      return;
    }
    const query = sharesSearchQuery.trim().toLowerCase();
    const filtered = loadedShares.filter((share) => {
      if (sharesFilter === "public" && share.access_scope === "private") return false;
      if (sharesFilter === "private" && share.access_scope !== "private") return false;
      if (sharesFilter === "password" && !share.password_required) return false;
      if (sharesFilter === "onetime" && !share.one_time) return false;
      if (!query) return true;
      const names = (share.files || []).map((f) => String(f.file_name || "").toLowerCase()).join(" ");
      return names.includes(query) || String(share.id || "").toLowerCase().includes(query);
    });
    if (!filtered.length) {
      list.innerHTML = '<div class="transfer-empty">当前筛选条件下没有匹配的分享记录。</div>';
      return;
    }
    reconcileKeyedRows(list, filtered, {
      key: share => share.id,
      signature: share => JSON.stringify(share),
      render: share => {
        const isPrivate = share.access_scope === "private";
        const tags = [
          `<span class="status-badge" data-tone="${isPrivate ? "info" : "success"}">${isPrivate ? "私有附件" : "公开分享"}</span>`,
          share.password_required ? '<span class="tf-meta-chip">有密码</span>' : "",
          share.one_time ? '<span class="tf-meta-chip">阅后即焚</span>' : "",
        ].filter(Boolean).join("");
        const fileSummary = (share.files || []).map((file) => file.file_name).join("、") || "文件名暂不可用";
        const dlCount = Number(share.download_count || 0);
        const dlSummary = share.one_time
          ? `限 1 次（已下载 ${Math.min(1, dlCount)}/1）`
          : `下载 ${dlCount}/${share.max_downloads}`;
        return `<article class="transfer-share-row">
        <div class="tf-share-row-info">
          <div class="tf-share-row-head">${tags}<strong>${isPrivate ? '私有附件 · ' : ''}${escapeHtml(share.file_count)} 个文件 · ${formatBytes(share.total_bytes)}</strong></div>
          <small>${escapeHtml(fileSummary)}</small>
          <small>${new Date(share.expires_at).toLocaleString("zh-CN")} 到期 · ${escapeHtml(dlSummary)}</small>
        </div>
        <div class="transfer-share-actions">
          ${!isPrivate ? `<button class="button-ghost" type="button" data-transfer-copy-share="${escapeHtml(share.id)}">复制链接</button>` : ""}
          <button class="button-secondary" type="button" data-transfer-open="${escapeHtml(share.id)}">查看</button>
          <button class="button-ghost danger-text" type="button" title="撤销后分享链接立即失效" data-transfer-revoke="${escapeHtml(share.id)}"><span data-pending-label="撤销中…">撤销</span></button>
        </div>
      </article>`;
      },
    });
  }

  async function loadMyShares() {
    const list = element("transferMyShares");
    if (!list) return;
    const generation = ++sharesListGeneration;
    const owner = ownerGeneration;
    try {
      const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
      const payload = await request(`/api/transfer/shares${query}`);
      if (generation !== sharesListGeneration || owner !== ownerGeneration) return;
      const shares = payload.shares || [];
      loadedShares = shares;
      ownedShareIds = new Set(shares.filter((share) => share.state !== "revoked").map((share) => share.id));
      updateCurrentShareActions();
      updateTabCounts();
      renderFilteredShares();
    } catch (error) {
      if (generation !== sharesListGeneration || owner !== ownerGeneration) return;
      list.innerHTML = `<div class="transfer-empty">分享列表加载失败：${escapeHtml(error.message || "请稍后重试")}</div>`;
    }
  }

  async function refreshQueueState() {
    const operationOwner=currentOwner();
    for (const item of queue) {
      if (!item.sessionId || item.status === "done" || item.status === "cancelled") continue;
      try {
        const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
        const payload = await request(`/api/transfer/uploads/${item.sessionId}${query}`);
        if(operationOwner!==currentOwner())return;
        if (!["active", "published"].includes(String(payload.state || ""))) {
          const staleSessionId = item.sessionId;
          resetQueueForStaleSession(queue, staleSessionId);
          if (activeSession?.id === staleSessionId) activeSession = null;
          setMessage("已清理失效的旧上传任务，请重新选择原文件继续。", "warning");
          continue;
        }
        const file = payload.files?.find((entry) => entry.file_id === item.fileId);
        if (file && Array.isArray(file.uploaded_parts)) {
          item.uploadedParts = file.uploaded_parts;
          const partSize = file.part_size || item.partSize;
          item.partSize = partSize;
          item.partCount = file.part_count || item.partCount;
          item.uploaded = file.uploaded_parts.reduce(
            (sum, partNumber) => sum + Math.min(partSize, item.size - (partNumber - 1) * partSize),
            0,
          );
        }
        if (payload.state === "published" && payload.share_id) {
          item.status = "done";
          item.uploaded = item.size;
          const sharePayload = await request(`/api/transfer/shares/${payload.share_id}`);
          if(operationOwner!==currentOwner())return;
          currentShare = sharePayload.share;
          renderShare(currentShare);
        }
      } catch (error) {
        if(operationOwner!==currentOwner())return;
        if (isRecoverableUploadSessionError(error)) {
          const staleSessionId = item.sessionId;
          resetQueueForStaleSession(queue, staleSessionId);
          if (activeSession?.id === staleSessionId) activeSession = null;
          setMessage("旧上传任务已过期，请重新选择原文件继续。", "warning");
        }
      }
    }
    persistQueue();
    renderQueue();
  }

  async function openShare(shareId) {
    const generation = ++shareRequestGeneration;
    clearRecipientError();
    try {
      const savedPw = unlockedSharePasswords.get(shareId) || "";
      const suffix = savedPw ? `?password=${encodeURIComponent(savedPw)}` : "";
      let payload;
      try {
        payload = await request(`/api/transfer/shares/${shareId}${suffix}`);
      } catch (firstErr) {
        if (generation !== shareRequestGeneration) return;
        if (firstErr?.status !== 403 && firstErr?.code !== "share_password_invalid") throw firstErr;
        unlockedSharePasswords.delete(shareId);
        let hint = "";
        while (generation === shareRequestGeneration) {
          const entered = await promptSharePassword(
            "该分享受访问密码保护，请输入访问密码以查看文件列表。",
            hint,
          );
          if (generation !== shareRequestGeneration) return;
          if (entered === null) {
            renderRecipientError({ status: 403, code: "share_password_required", message: "需要输入正确的访问密码才能查看此分享。" });
            setMessage("已取消输入分享密码。", "info");
            return;
          }
          try {
            payload = await request(`/api/transfer/shares/${shareId}?password=${encodeURIComponent(entered)}`);
            if (generation !== shareRequestGeneration) return;
            unlockedSharePasswords.set(shareId, entered);
            break;
          } catch (retryErr) {
            if (retryErr?.status === 403 || retryErr?.code === "share_password_invalid") {
              hint = "访问密码不正确，请重试。";
              continue;
            }
            throw retryErr;
          }
        }
      }
      if (generation !== shareRequestGeneration || !payload) return;
      currentShare = payload.share;
      if (recipientShareId() === null && activeTab !== "send") {
        setActiveTab("send");
      }
      renderShare(payload.share);
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      element("transferShareCard")?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    } catch (error) {
      if (generation !== shareRequestGeneration) return;
      if (recipientShareId() !== null) {
        renderRecipientError(error);
        setMessage("", "info");
      } else {
        setMessage(error.message || "分享不存在或已过期。", "error");
      }
    }
  }

  function recipientShareId() {
    if (!location.hash.startsWith("#share=")) return null;
    try {
      const id = decodeURIComponent(location.hash.slice(7));
      return /^[A-Za-z0-9_-]{16,80}$/.test(id) ? id : "";
    } catch (_) {
      return "";
    }
  }

  function clearShare() {
    shareRequestGeneration += 1;
    currentShare = null;
    clearRecipientError();
    element("transferShareCard")?.classList.add("hidden");
    updateCurrentShareActions();
    if (element("transferShareMetaChips")) element("transferShareMetaChips").innerHTML = "";
    if (element("transferShareFiles")) element("transferShareFiles").innerHTML = "";
    if (element("transferShareLink")) element("transferShareLink").value = "";
    if (element('transferShareLink')) element('transferShareLink').href='';
    const qr=element('transferQr');if(qr){qr.width=0;qr.height=0;}
    setText('transferShareAccessHint','');
  }

  async function revokeShare(shareId) {
    if (revokingShares.has(shareId)) return;
    revokingShares.add(shareId);
    ownerGeneration += 1;
    try {
      const body = {};
      if (!authenticated()) body.guest_id = guestId();
      await request(`/api/transfer/shares/${shareId}/revoke`, { method: "POST", body });
      ownedShareIds.delete(shareId);
      if (currentShare?.id === shareId) clearShare();
      setMessage("分享已撤销。", "success");
      await Promise.all([loadMyShares(), loadCapabilities()]);
    } catch (error) {
      setMessage(error.message || "撤销失败。", "error");
      throw error;
    } finally {
      revokingShares.delete(shareId);
    }
  }

  function renderUnfinishedSessions() {
    const list = element("transferUnfinishedSessions");
    const localBanner = element("transferUnfinishedLocalBanner");
    const reselectItems = queue.filter((i) => i.needsFile && i.status !== "cancelled");
    if (localBanner) {
      if (reselectItems.length) {
        localBanner.textContent = `当前本机队列中有 ${reselectItems.length} 个文件保留了已确认分片，回到「发送文件」重新选择同名原文件即可断点续传。`;
        localBanner.classList.remove("hidden");
      } else {
        localBanner.textContent = "";
        localBanner.classList.add("hidden");
      }
    }
    updateTabCounts();
    if (!list) return;
    if (!serverSessions.length) {
      list.innerHTML = '<div class="transfer-empty">没有未完成的云端上传任务。</div>';
      return;
    }
    list.innerHTML = serverSessions.map((session) => {
      const isCurrent = session.id === activeSession?.id;
      const expired = Date.parse(session.expires_at) <= Date.now();
      const statusBadge = isCurrent
        ? '<span class="status-badge" data-tone="info">当前活跃队列</span>'
        : expired
          ? '<span class="status-badge" data-tone="error">已过期</span>'
          : '<span class="status-badge" data-tone="warning">云端预留中</span>';
      return `<article class="transfer-share-row">
      <div class="tf-share-row-info">
        <div class="tf-share-row-head">${statusBadge}<strong>${Number(session.file_count)} 个文件 · 预留 ${formatBytes(session.total_bytes)}</strong></div>
        <small>已上传 ${formatBytes(session.uploaded_bytes)} · ${escapeHtml(new Date(session.created_at).toLocaleString("zh-CN"))} 创建 · ${escapeHtml(new Date(session.expires_at).toLocaleString("zh-CN"))} 到期${isCurrent ? " · 当前队列" : ""}</small>
      </div>
      <div class="transfer-share-actions"><button class="button-ghost danger-text" type="button"
        data-transfer-release-session="${escapeHtml(session.id)}">释放预留</button></div>
    </article>`;
    }).join("");
  }

  async function loadUnfinishedSessions() {
    const operationOwner=currentOwner();
    try {
      const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
      const payload = await request(`/api/transfer/uploads${query}`);
      if(operationOwner!==currentOwner())return;
      serverSessions = Array.isArray(payload.uploads) ? payload.uploads : [];
      renderUnfinishedSessions();
    } catch (error) {
      if(operationOwner!==currentOwner())return;
      const list = element("transferUnfinishedSessions");
      if (list) list.innerHTML = `<div class="transfer-empty">未完成上传暂时无法读取：${escapeHtml(error.message || "请稍后重试")}</div>`;
    }
  }

  async function releaseServerSession(sessionId) {
    const affected = queue.filter((item) => item.sessionId === sessionId);
    for (const item of affected) {
      item.controllers?.forEach((controller) => controller.abort());
      item.controllers?.clear();
      item.paused = true;
    }
    const released = await abortSession(sessionId);
    if (released) {
      resetQueueForStaleSession(queue, sessionId);
      if (activeSession?.id === sessionId) activeSession = null;
      persistQueue();
      renderQueue();
      setMessage("云端上传预留已释放；本机文件仍可重新选择继续。", "success");
    } else {
      setMessage("释放请求暂未成功，已保留并将在联网后重试。", "warning");
    }
    await Promise.all([loadCapabilities(), loadUnfinishedSessions()]);
  }

  async function cancelItem(id) {
    const item = itemById(id);
    if (!item) return;
    const sessionId = String(item.sessionId || "");
    const survivors = sessionId
      ? queue.filter((entry) => entry.id !== id && entry.sessionId === sessionId) : [];
    const priorPause = new Map(survivors.map((entry) => [entry.id, entry.paused]));
    for (const entry of [item, ...survivors]) {
      entry.controllers?.forEach((controller) => controller.abort());
      entry.controllers?.clear();
      entry.paused = true;
    }
    item.status = "cancelled";
    item.controller = null;
    queue = queue.filter((entry) => entry.id !== id);
    persistQueue();
    renderQueue();
    if (sessionId) {
      if (!await abortSession(sessionId)) {
        setMessage("取消已保存，云端预留释放失败；联网后会重试，剩余文件暂不上传。", "warning");
        await Promise.all([loadCapabilities(), loadUnfinishedSessions()]);
        return;
      }
      resetQueueForStaleSession(queue, sessionId);
      if (activeSession?.id === sessionId) activeSession = null;
      for (const entry of survivors) entry.paused = priorPause.get(entry.id);
      persistQueue();
      renderQueue();
    }
    await Promise.all([loadCapabilities(), loadUnfinishedSessions()]);
    if (survivors.some((entry) => entry.file && !entry.paused)) void run();
  }

  function pauseItem(id) {
    const item = itemById(id);
    if (!item) return;
    item.paused = true;
    // Stop every in-flight part; acknowledged parts stay recorded, so resume
    // simply re-uploads whatever did not finish.
    item.controllers?.forEach((controller) => controller.abort());
    item.controllers?.clear();
    item._partWire?.clear();
    item.speed = 0;
    item.eta = 0;
    item.controller = null;
    renderQueue();
  }

  function resumeItem(id) {
    const item = itemById(id);
    if (!item) return;
    item.paused = false;
    if (item.status === "error") item.status = "pending";
    renderQueue();
    void run();
  }

  function handleClick(event) {
    const expandPathNode = event.target.closest("[data-transfer-expand-path]");
    if (expandPathNode) {
      expandPathNode.dataset.expanded = expandPathNode.dataset.expanded === "true" ? "false" : "true";
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.transferTab) {
      setActiveTab(button.dataset.transferTab);
      return;
    }
    if (button.dataset.transferShareFilter) {
      sharesFilter = button.dataset.transferShareFilter;
      element("transferSharesPanel")?.querySelectorAll("[data-transfer-share-filter]").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.transferShareFilter === sharesFilter);
      });
      renderFilteredShares();
      return;
    }
    if (button.id === "transferValidationDismissBtn") {
      showValidationErrors([]);
      return;
    }
    if (button.id === "transferPasswordToggle") {
      const input = element("transferPassword");
      if (!input) return;
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.textContent = reveal ? "隐藏" : "显示";
      button.setAttribute("aria-pressed", reveal ? "true" : "false");
      return;
    }
    if (button.id === "transferRefreshSharesBtn") {
      void withInteractionFeedback(button, "transfer-refresh-shares", () => loadMyShares()).catch(() => undefined);
      return;
    }
    if (button.id === "transferRefreshUnfinishedBtn") {
      void withInteractionFeedback(button, "transfer-refresh-unfinished", () => loadUnfinishedSessions()).catch(() => undefined);
      return;
    }
    if (button.id === "transferGoSendBtn" || button.id === "transferRecipientHomeBtn") {
      navigate("/transfer");
      return;
    }
    if (button.id === "transferRecipientRetryBtn") {
      const id = recipientShareId();
      if (id) void openShare(id);
      return;
    }
    if (button.dataset.transferCopyShare) {
      const shareUrl = `${location.origin}/transfer#share=${encodeURIComponent(button.dataset.transferCopyShare)}`;
      const applyRowCopy = (ok) => {
        setMessage(ok ? "分享链接已复制。" : "复制失败，请点击查看后复制。", ok ? "success" : "error");
        const prev = button.dataset.origLabel || button.textContent;
        button.dataset.origLabel = prev;
        button.textContent = ok ? "已复制" : "失败";
        window.setTimeout(() => { if (button.isConnected) button.textContent = prev; }, 1200);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => applyRowCopy(true)).catch(() => applyRowCopy(false));
      } else {
        applyRowCopy(false);
      }
      return;
    }
    if (button.id === "transferSelectFilesBtn") element("transferFileInput")?.click();
    else if (button.id === "transferSelectFolderBtn") element("transferFolderInput")?.click();
    // #7: creating the share and downloading a file both wait on the server; the
    // pressed control shows the pending state before the first await.
    else if (button.id === "transferCompleteBtn") {
      void withInteractionFeedback(button, "transfer-complete", () => complete()).catch(() => undefined);
    }
    else if (button.id === "transferCopyLinkBtn") {
      const link = element("transferShareLink");
      const value = link?.value || "";
      link?.select();
      const applyCopyUi = (copied) => {
        setMessage(copied ? "链接已复制。" : "复制失败，请手动复制。", copied ? "success" : "error");
        if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
        const prevTimer = Number(button.dataset.copyTimer || 0);
        if (prevTimer) window.clearTimeout(prevTimer);
        button.textContent = copied ? "已复制" : "复制失败";
        button.dataset.copyTimer = String(window.setTimeout(() => {
          delete button.dataset.copyTimer;
          if (button.isConnected && button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
        }, 1200));
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(value).then(() => applyCopyUi(true)).catch(() => {
          let copied = false;
          try { copied = document.execCommand("copy"); } catch (_) { copied = false; }
          applyCopyUi(copied);
        });
      } else {
        let copied = false;
        try { copied = document.execCommand("copy"); } catch (_) { copied = false; }
        applyCopyUi(copied);
      }
    }
    else if (button.id === "transferBackBtn") navigate("/select");
    else if (button.dataset.transferPause) pauseItem(button.dataset.transferPause);
    else if (button.dataset.transferResume) resumeItem(button.dataset.transferResume);
    else if (button.dataset.transferRetry) resumeItem(button.dataset.transferRetry);
    else if (button.dataset.transferCancel) void cancelItem(button.dataset.transferCancel);
    else if (button.dataset.transferReleaseSession) {
      void withInteractionFeedback(button, "transfer-release-session",
        () => releaseServerSession(button.dataset.transferReleaseSession)).catch(() => undefined);
    }
    else if (button.dataset.transferDownload) {
      const [shareId, fileId] = button.dataset.transferDownload.split("|");
      void withInteractionFeedback(
        button,
        "transfer-download",
        () => downloadShareFile(shareId, fileId, Boolean(currentShare?.password_required)),
      ).catch(() => undefined);
    }
    else if (button.dataset.transferOpen) void openShare(button.dataset.transferOpen);
    else if (button.dataset.transferRevoke) {
      void withInteractionFeedback(button, "transfer-revoke", () => revokeShare(button.dataset.transferRevoke))
        .catch(() => undefined);
    }
  }

  async function readDroppedEntries(items) {
    const collected = [];
    const readEntry = async (entry, prefix = "") => {
      if (!entry) return;
      if (entry.isFile) {
        const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
        if (file) {
          const rel = prefix ? `${prefix}/${file.name}` : file.name;
          try { Object.defineProperty(file, "aerisRelativePath", { value: rel, configurable: true }); } catch (_) {}
          collected.push(file);
        }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const batchPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        const readAll = async () => {
          const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
          if (!batch?.length) return;
          for (const child of batch) await readEntry(child, batchPrefix);
          await readAll();
        };
        await readAll();
      }
    };
    const entries = [...items]
      .filter((item) => item?.kind === "file" && typeof item.webkitGetAsEntry === "function")
      .map((item) => item.webkitGetAsEntry())
      .filter(Boolean);
    for (const entry of entries) await readEntry(entry, "");
    return collected;
  }

  function handleDrop(event) {
    event.preventDefault();
    const items = event.dataTransfer?.items;
    const hasDirectoryEntry = items && [...items].some((item) => item?.kind === "file" && typeof item.webkitGetAsEntry === "function" && item.webkitGetAsEntry()?.isDirectory);
    if (hasDirectoryEntry) {
      void readDroppedEntries(items).then((files) => {
        if (files.length) addFiles(files);
      });
      return;
    }
    const files = event.dataTransfer?.files;
    if (files?.length) addFiles(files);
  }

  function handlePaste(event) {
    // This listener survives SPA navigation. A paste into another screen or
    // an editable control belongs to that control, never to the upload queue.
    if (!visible || location.pathname !== "/transfer" || recipientShareId() !== null || event.defaultPrevented) return;
    const targets = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    if (targets.some((target) => target?.isContentEditable
      || target?.matches?.('input, textarea, select, [role="textbox"], [role="searchbox"]'))) return;
    const pasteOwner = ownerGeneration;
    const items = event.clipboardData?.items || [];
    const files = [];
    const textParts = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      } else if (item.kind === "string") {
        textParts.push(item);
      }
    }
    if (!files.length && !textParts.length) return;
    event.preventDefault();
    if (files.length) addFiles(files);
    if (textParts.length) {
      const values = [];
      let pending = textParts.length;
      textParts.forEach((item) => item.getAsString((value) => {
        values.push(value);
        pending -= 1;
        if (pending === 0 && values.join("\n").trim() && pasteOwner === ownerGeneration
          && visible && location.pathname === "/transfer" && recipientShareId() === null) {
          addFiles([new File([values.join("\n")], `粘贴文本-${Date.now()}.txt`, { type: "text/plain" })]);
        }
      }));
    }
  }

  async function loadCapabilities() {
    const generation = ++quotaGeneration;
    const owner = ownerGeneration;
    try {
      const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
      const payload = await request(`/api/transfer/capabilities${query}`);
      if (generation !== quotaGeneration || owner !== ownerGeneration) return;
      if (!payload || typeof payload.storage_limit_bytes !== "number") {
        throw new Error("配额响应不完整");
      }
      capabilities = payload;
      const privacy = element('transferPrivate');
      if (privacy) { privacy.disabled = !authenticated() || Boolean(activeSession?.id); if (!authenticated()) privacy.checked = false; }
      renderQuota();
    } catch (error) {
      if (generation !== quotaGeneration || owner !== ownerGeneration) return;
      setMessage(`配额刷新失败，保留上次结果：${error.message || "请稍后重试"}`, "error");
    }
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    document.addEventListener("thewyj:webview-active", (event) => {
      if (event.detail?.active && visible) {
        renderQueue();
        patchQueueProgress();
      } else {
        updates.cancelProgress();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) updates.cancelProgress();
      else if (visible) patchQueueProgress();
    });
    element("transferPage")?.addEventListener("click", handleClick);
    element("transferSubnav")?.addEventListener("keydown", (event) => {
      const tabs = ["send", "shares", "unfinished"];
      const tabBtn = event.target?.closest?.("[data-transfer-tab]");
      const current = tabBtn?.dataset?.transferTab;
      const idx = tabs.indexOf(current);
      if (idx === -1) return;
      let nextIdx = -1;
      if (event.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIdx = 0;
      else if (event.key === "End") nextIdx = tabs.length - 1;
      if (nextIdx === -1) return;
      event.preventDefault();
      const targetTab = tabs[nextIdx];
      setActiveTab(targetTab);
      const btnId = targetTab === "send" ? "transferTabSend" : targetTab === "shares" ? "transferTabShares" : "transferTabUnfinished";
      element(btnId)?.focus();
    });
    element("transferSharesSearch")?.addEventListener("input", (event) => {
      sharesSearchQuery = String(event.target?.value || "");
      renderFilteredShares();
    });
    const pwModal = element("transferPasswordModal");
    element("transferPasswordModalForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = element("transferSharePasswordInput");
      const val = String(input?.value || "");
      if (!val.trim()) {
        const err = element("transferPasswordModalError");
        if (err) { err.textContent = "请输入访问密码"; err.classList.remove("hidden"); }
        input?.focus();
        return;
      }
      closePasswordModal(val);
    });
    element("transferPasswordCancelBtn")?.addEventListener("click", () => closePasswordModal(null));
    element("transferPasswordCloseBtn")?.addEventListener("click", () => closePasswordModal(null));
    element("transferSharePasswordReveal")?.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      const input = element("transferSharePasswordInput");
      if (!input) return;
      const showPw = input.type === "password";
      input.type = showPw ? "text" : "password";
      btn.textContent = showPw ? "隐藏" : "显示";
      btn.setAttribute("aria-pressed", showPw ? "true" : "false");
    });
    pwModal?.addEventListener("click", (event) => {
      if (event.target === pwModal) closePasswordModal(null);
    });
    document.addEventListener("keydown", (event) => {
      if (!activePasswordResolver) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePasswordModal(null);
      }
    }, true);
    element('transferPrivate')?.addEventListener('change',renderQueue);
    for (const id of ["transferExpiry", "transferPassword", "transferMaxDownloads", "transferOneTime"]) {
      element(id)?.addEventListener("input", renderConfigSummary);
      element(id)?.addEventListener("change", renderConfigSummary);
    }
    const dropZone = element("transferDropZone");
    attachFileDropFeedback(dropZone, {
      doc: document,
      onDropEvent: (event) => handleDrop(event),
    });
    element("transferFileInput")?.addEventListener("change", (event) => {
      addFiles(event.target.files);
      event.target.value = "";
    });
    element("transferFolderInput")?.addEventListener("change", (event) => {
      addFiles(event.target.files);
      event.target.value = "";
    });
    document.addEventListener("paste", handlePaste);
    window.addEventListener("thewyj:transfer-download", (event) => {
      const detail = event.detail || {};
      if (detail.state === "progress") {
        setMessage(`正在下载 ${formatBytes(detail.bytes)} / ${formatBytes(detail.total)}`, "info");
      } else if (detail.state === "completed") {
        setMessage(detail.message || "下载完成。", "success");
      } else if (detail.state === "failed") {
        setMessage(detail.message || "下载未完成，请重试。", "error");
      } else if (detail.state === "started") {
        setMessage(detail.message || "正在下载。", "info");
      }
    });
    window.addEventListener("online", () => {
      if (location.pathname === "/transfer" && recipientShareId() === null) {
        void retryCleanupPending();
        void loadUnfinishedSessions();
      }
    });
    window.addEventListener("hashchange", () => {
      if (location.pathname === "/transfer") void show();
    });
    window.addEventListener("popstate", () => {
      if (location.pathname === "/transfer" && recipientShareId() === null) {
        const st = history.state?.aerisTransferTab;
        if (["send", "shares", "unfinished"].includes(st)) {
          activeTab = st;
          syncTabUi(false);
        }
      }
    });
  }

  async function show() {
    visible = true;
    initialize();
    restoreQueue();
    restoreCleanupQueue();
    void retryCleanupPending();
    const recipient = recipientShareId();
    if (recipient === null && ["send", "shares", "unfinished"].includes(history.state?.aerisTransferTab)) {
      activeTab = history.state.aerisTransferTab;
    }
    syncTabUi(false);
    renderQueue();
    if (recipient !== null) {
      if (currentShare?.id !== recipient) clearShare();
      if (!recipient) {
        renderRecipientError({ status: 404, message: "分享链接格式无效或已损坏。" });
        setMessage("分享链接无效。", "error");
        return true;
      }
      await openShare(recipient);
      return true;
    }
    clearRecipientError();
    await Promise.all([loadCapabilities(), loadMyShares(), loadUnfinishedSessions(), refreshQueueState()]);
    return true;
  }

  function hide() {
    // Pausing is safe: queue state persists and resumes on the next visit.
    visible = false;
    unlockedSharePasswords.clear();
    if (activePasswordResolver) closePasswordModal(null);
    updates.flushPending();
    updates.cancelProgress();
  }

  function accountUpdated({deferLoad=false}={}) {
    const ownerChanged=currentOwner()!==queueOwner;
    updates.cancel();
    ownerGeneration += 1;
    ownedShareIds = new Set();
    if(ownerChanged) {
      if (activePasswordResolver) closePasswordModal(null);
      clearShare();downloadGrants.clear();unlockedSharePasswords.clear();serverSessions=[];loadedShares=[];
      capabilities={storage_limit_bytes:0,stored_bytes:0,reserved_bytes:0,used_bytes:0,
        max_share_bytes:5*1024*1024*1024,max_files_per_share:500,part_size_bytes:PART_SIZE_HINT};
      if(element('transferPrivate'))element('transferPrivate').checked=false;
      if(element('transferMyShares'))element('transferMyShares').innerHTML='<div class="transfer-empty">正在加载当前账户的分享与附件…</div>';
      if(element('transferQueue'))element('transferQueue').innerHTML='';progressNodes=new Map();
      if(element('transferUnfinishedSessions'))element('transferUnfinishedSessions').innerHTML='<div class="transfer-empty">正在加载当前账户的上传任务…</div>';
      setText('transferQuotaText','配额加载中');
      const quotaBar=element('transferQuotaBar');if(quotaBar){quotaBar.value=0;quotaBar.max=1;}
      showValidationErrors([]);
      setMessage('');
      updateTabCounts();
    }
    updateCurrentShareActions();
    restoreQueue();
    restoreCleanupQueue();
    if(deferLoad || (!authenticated() && Boolean(storage.getItem(ACCOUNT_SESSION_KEY)))) {visible=false;return;}
    if (visible) {
      renderQueue();
      void loadCapabilities();
      void loadMyShares();
    }
    if (location.pathname === "/transfer" && recipientShareId() === null) {
      void Promise.all([loadUnfinishedSessions(), retryCleanupPending()]);
    }
  }

  const dashboardSummary = () => ({ count: queue.length, paused: queue.filter(entry => entry.paused).length, running });
  return Object.freeze({ show, hide, accountUpdated, addFiles, renderQueue, dashboardSummary });
}
