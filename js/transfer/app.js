import { randomId } from "../core/capabilities.js?v=20260912-task24-4-r2";
import { ACCOUNT_SESSION_KEY, accountSessionHeaders } from "../core/session.js?v=20260912-task24-4-r2";
import { getSafeStorage } from "../core/storage.js?v=20260912-task24-4-r2";
import { withInteractionFeedback } from "../core/perf.js?v=20260912-task24-4-r2";

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
export const UPLOAD_CONCURRENCY = 3;

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
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function safeFileRelativePath(file) {
  const full = String(file.webkitRelativePath || file.relativePath || file.name || "").replace(/\\/g, "/");
  const parts = full.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.length ? parts.join("/") : String(file.name || "unnamed");
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
  let queue = [];
  let queueOwner = "";
  let activeSession = null;
  let currentShare = null;
  let running = false;
  let sessionOpening = null;
  let capabilities = { storage_limit_bytes: 500 * 1024 * 1024, used_bytes: 0 };

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

  function persistQueue() {
    const value = { account: authenticated() ? String(account().id) : `guest:${guestId()}`, queue };
    const serializable = {
      account: value.account,
    queue: queue.map(({ file, controller, controllers, activeUploads, ...item }) => item),
    };
    storage.setItem(transferQueueStorageKey(value.account), JSON.stringify(serializable));
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
        try { item.controller?.abort?.(); } catch (_) { /* controller already settled */ }
      }
      queueOwner = owner;
      let saved = JSON.parse(storage.getItem(transferQueueStorageKey(owner)) || "{}");
      // One-time import of the pre-account-scoping payload, only when it really
      // belongs to this owner (multi-account isolation: another account's queue
      // must never be adopted, and this account's queue must survive a switch).
      if ((!saved.account || !Array.isArray(saved.queue)) && storage.getItem(QUEUE_STORAGE_KEY)) {
        saved = JSON.parse(storage.getItem(QUEUE_STORAGE_KEY) || "{}");
      }
      if (saved.account === owner && Array.isArray(saved.queue)) {
        queue = saved.queue.map(restoreQueueEntry);
        persistQueue();
      }
    } catch (_) {
      queue = [];
    }
  }


  function renderQuota() {
    const used = capabilities.used_bytes || 0;
    const limit = capabilities.storage_limit_bytes || 0;
    element("transferQuotaText").textContent = `已用 ${formatBytes(used)} / ${formatBytes(limit)}`;
    const progress = element("transferQuotaBar");
    if (progress) progress.max = String(Math.max(1, limit));
    if (progress) progress.value = String(Math.min(limit, used));
    element("transferUploadedBytes").textContent = formatBytes(queue.reduce((sum, item) => sum + (item.uploaded || 0), 0));
    element("transferTotalBytes").textContent = formatBytes(queue.reduce((sum, item) => sum + item.size, 0));
  }

  function itemById(id) {
    return queue.find((item) => item.id === id);
  }

  function renderQueue() {
    const list = element("transferQueue");
    if (!list) return;
    if (!queue.length) {
      list.innerHTML = '<div class="transfer-empty">还没有选择文件。拖入文件、选择文件或粘贴图片。</div>';
    } else {
      list.innerHTML = queue.map((item) => {
        const percent = item.size ? Math.min(100, Math.round((item.uploaded / item.size) * 100)) : 0;
        const paused = item.paused;
        return `<article class="transfer-item" data-transfer-item="${escapeHtml(item.id)}">
          <div class="transfer-item-main">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.relativePath)} · ${formatBytes(item.uploaded)} / ${formatBytes(item.size)}${item.speed ? ` · ${formatBytes(item.speed)}/s` : ""}${item.eta ? ` · 剩余 ${Math.ceil(item.eta)}s` : ""}${item.needsFile ? " · 已恢复，请重新选择同一文件继续" : ""}</small>
            <progress max="100" value="${percent}"></progress>
          </div>
          <div class="transfer-item-actions">
            ${item.status === "pending" || paused ? `<button type="button" data-transfer-resume="${escapeHtml(item.id)}">开始/继续</button>` : `<button type="button" data-transfer-pause="${escapeHtml(item.id)}">暂停</button>`}
            ${item.status === "error" ? `<button type="button" data-transfer-retry="${escapeHtml(item.id)}">重试</button>` : ""}
            <button class="danger-text" type="button" data-transfer-cancel="${escapeHtml(item.id)}">取消</button>
          </div>
        </article>`;
      }).join("");
    }
    const complete = queue.length > 0 && queue.every((item) => item.status === "done");
    element("transferCompleteBtn").disabled = !complete;
    renderQuota();
  }

  function setMessage(message, tone = "") {
    const target = element("transferMessage");
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
  }

  function addFiles(fileList) {
    const files = [...fileList].filter((file) => file && Number.isFinite(file.size) && file.size > 0);
    if (!files.length) return;
    for (const file of files) {
      const existing = queue.find((item) => item.needsFile && item.name === (file.name || "unnamed") && item.size === file.size);
      if (existing) {
        existing.file = file;
        existing.needsFile = false;
        existing.status = existing.status === "error" ? "pending" : existing.status;
        persistQueue();
        renderQueue();
        void run();
        continue;
      }
      queue.push({
        id: randomId(),
        file,
        name: file.name || "unnamed",
        relativePath: safeFileRelativePath(file),
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
    const body = {
      minutes: Number(element("transferExpiry")?.value || DEFAULT_EXPIRY_MINUTES),
      max_downloads: Number(element("transferMaxDownloads")?.value || 5),
      one_time: Boolean(element("transferOneTime")?.checked),
      password: String(element("transferPassword")?.value || ""),
      file_count: Math.max(plan.fileCount, 1),
      total_bytes: plan.totalBytes,
    };
    if (!authenticated()) body.guest_id = guestId();
    sessionOpening = request("/api/transfer/uploads", { method: "POST", body });
    let payload;
    try {
      payload = await sessionOpening;
    } finally {
      sessionOpening = null;
    }
    const batchIds = sessionBatchIds(queue);
    activeSession = {
      id: payload.upload.id,
      expiresAt: payload.upload.expires_at,
      fileCount: Math.max(plan.fileCount, 1),
      totalBytes: plan.totalBytes,
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
    if (previous?.id && previous.id !== activeSession.id) {
      void abortSession(previous.id, plan.reason);
    }
    if (plan.reason === "file-count-grew" || plan.reason === "size-changed") {
      setMessage("已按当前文件列表重新创建上传任务，正在重新上传。");
    }
    return activeSession;
  }

  /** Best-effort cleanup so a superseded batch cannot linger on the server. */
  async function abortSession(sessionId, reason = "") {
    try {
      const body = {};
      if (!authenticated()) body.guest_id = guestId();
      await request(`/api/transfer/uploads/${sessionId}/abort`, { method: "POST", body });
      if (reason) setMessage("已废弃旧的上传任务，正在重新上传。");
    } catch (_) {
      // The server also expires abandoned sessions; a failed abort must never
      // block the new batch.
    }
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
    item.controllers.add(controller);
    item.controller = controller;
    item.activeUploads = (Number(item.activeUploads) || 0) + 1;
    const response = await fetch(
      `/api/transfer/uploads/${item.sessionId}/files/${item.fileId}/parts/${partNumber}`,
      {
        method: "PUT",
        headers: headers({ "Content-Type": "application/octet-stream", "X-Part-Sha256": partHash }),
        body,
        signal: controller.signal,
      },
    ).finally(() => {
      item.controllers?.delete(controller);
      item.activeUploads = Math.max(0, (Number(item.activeUploads) || 1) - 1);
      if (item.activeUploads === 0) item.controller = null;
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `分片上传失败（HTTP ${response.status}）`);
      error.code = data.code || "part_failed";
      error.status = response.status;
      throw error;
    }
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
    item.status = "uploading";
    item.paused = false;
    await ensureSession();
    if (item.sessionId !== activeSession.id) item.sessionId = activeSession.id;
    persistQueue();
    await allocateItem(item);
    if (item.partCount === 0) item.partCount = Math.max(1, Math.ceil(item.size / item.partSize));
    item.uploadedParts = Array.isArray(item.uploadedParts) ? item.uploadedParts : [];
    // Progress is acknowledged bytes, not "highest part seen": parallel parts
    // finish out of order, and the old formula could jump straight to 100%.
    item.uploaded = item.uploadedParts.reduce((sum, partNumber) => {
      const offset = (Number(partNumber) - 1) * item.partSize;
      return sum + Math.min(item.partSize, item.size - offset);
    }, 0);
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
          if (!item.uploadedParts.includes(partNumber)) item.uploadedParts.push(partNumber);
          item.uploaded = Math.min(item.size, item.uploaded + (uploadedBytes || length));
          delete item.failedPart;
          persistQueue();
          const elapsed = (Date.now() - startedAt) / 1000;
          if (elapsed > 0.5 && item.uploaded > startBytes) {
            item.speed = (item.uploaded - startBytes) / Math.max(0.2, elapsed);
            item.eta = item.size > item.uploaded ? (item.size - item.uploaded) / Math.max(1, item.speed) : 0;
          }
          renderQueue();
        },
      });
    } catch (error) {
      failure = error;
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
      item.controller = null;
      item.activeUploads = 0;
      return;
    }
    // A pause interrupts the in-flight PUTs; acknowledged parts stay recorded and
    // the rest resume. It is not a finished upload, so the item must not be
    // marked done (that used to make「开始/继续」a no-op after pausing).
    if (metrics?.stoppedBy === "paused" || item.paused) {
      item.status = "pending";
      item.controller = null;
      item.activeUploads = 0;
      persistQueue();
      renderQueue();
      return;
    }
    if (failure) {
      item.status = "error";
      item.error = failure.message;
      item.failedPart = Number(failure.partNumber) || 0;
      item.controller = null;
      item.activeUploads = 0;
      persistQueue();
      renderQueue();
      return;
    }
    item.status = "done";
    item.controller = null;
    item.activeUploads = 0;
    persistQueue();
    renderQueue();
    // A file added while this one was uploading makes the active session too
    // small for the queue. Switch after the in-flight parts settled (never by
    // yanking an allocation out from under a running PUT), then re-upload.
    const batchPlan = sessionPlan(queue, activeSession);
    if (!batchPlan.reuse) {
      await ensureSession();
      void run();
      return;
    }
    if (queue.every((entry) => entry.status === "done")) setMessage("全部文件已上传，可以创建分享链接。");
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      for (const item of [...queue]) {
        if (item.paused) continue;
        if (item.status === "done" || item.status === "cancelled") continue;
        // Only an item that still holds its File can be resumed; restored items
        // stay in「待重新选择文件」until addFiles() attaches it again.
        if (item.file && !item.controller && !(Number(item.activeUploads) > 0)) await uploadItem(item);
      }
    } finally {
      running = false;
    }
  }

  async function complete() {
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
        setMessage(error.message || "重新上传任务创建失败，请重试。", "error");
        return;
      }
      void run();
      setMessage("已按当前文件列表重新上传，请稍候再创建分享。", "info");
      return;
    }
    setMessage("正在创建分享…");
    try {
      const body = {};
      if (!authenticated()) body.guest_id = guestId();
      const payload = await request(`/api/transfer/uploads/${activeSession.id}/complete`, { method: "POST", body });
      currentShare = payload.share;
      queue = [];
      activeSession = null;
      persistQueue();
      renderShare(payload.share);
      setMessage("分享已创建。", "success");
    } catch (error) {
      setMessage(error.message || "创建分享失败。", "error");
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

  function renderShare(share) {
    element("transferShareCard")?.classList.remove("hidden");
    const url = `${location.origin}/transfer#share=${encodeURIComponent(share.id)}`;
    element("transferShareLink").value = url;
    element("transferShareLink").href = url;
    qrDataUrl(url);
    element("transferShareFiles").innerHTML = share.files.map((file) => `<div class="transfer-share-file"><strong>${escapeHtml(file.file_name)}</strong><small>${escapeHtml(file.relative_path)} · ${formatBytes(file.size_bytes)} · ${file.preview_policy === "preview" ? "可预览" : "仅下载"}</small><button type="button" data-transfer-download="${escapeHtml(share.id)}|${escapeHtml(file.file_id)}">下载</button></div>`).join("");
    void loadMyShares();
  }

  async function downloadShareFile(shareId, fileId, passwordRequired = false) {
    // Only a share that really carries a password may open a modal prompt: an
    // unconditional window.prompt blocked the renderer (and every headless
    // browser flow) even for public shares, and asked users for a password that
    // does not exist.
    const password = passwordRequired
      ? (window.prompt("该分享设有访问密码，请输入：") || "")
      : "";
    try {
      const payload = await request(`/api/transfer/shares/${shareId}/authorize`, { method: "POST", body: { password } });
      const token = payload.download.token;
      const meta = payload.download.share.files.find((file) => file.file_id === fileId);
      const size = Number(meta?.size_bytes || 0);
      const downloadUrl = `/api/transfer/shares/${shareId}/download?file=${encodeURIComponent(fileId)}&grant=${encodeURIComponent(token)}`;
      const pickerAvailable = typeof window.showSaveFilePicker === "function";
      if (!size || size <= 4 * 1024 * 1024 || !pickerAvailable) {
        // Let the browser stream the response straight to disk; the page never
        // holds the file contents in memory.
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = meta?.file_name || "download";
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setMessage("下载已开始，请查看浏览器下载列表。", "success");
        return;
      }
      // Bounded-memory streaming: each ranged response is piped straight into
      // the destination file, so even a 1 GiB transfer never becomes a Blob.
      const rangeSize = 8 * 1024 * 1024;
      const handle = await window.showSaveFilePicker({ suggestedName: meta?.file_name || "download" });
      const writable = await handle.createWritable();
      try {
        let offset = 0;
        setMessage(`正在下载 ${formatBytes(0)} / ${formatBytes(size)}`);
        while (offset < size) {
          const length = Math.min(rangeSize, size - offset);
          let lastError = null;
          let settled = false;
          for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
            try {
              const response = await fetch(downloadUrl, {
                headers: { ...headers(), Range: `bytes=${offset}-${offset + length - 1}` },
              });
              if (response.status !== 206 || !response.body) {
                throw new Error(`下载失败（HTTP ${response.status}）`);
              }
              const reader = response.body.getReader();
              let written = 0;
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Position-based writes keep retries idempotent.
                await writable.write({ type: "write", position: offset + written, data: value });
                written += value.byteLength;
              }
              if (written !== length) {
                throw new Error(`下载分片长度不一致（${written}/${length}）`);
              }
              settled = true;
            } catch (error) {
              lastError = error;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
            }
          }
          if (!settled) throw lastError || new Error("下载失败");
          offset += length;
          setMessage(`正在下载 ${formatBytes(offset)} / ${formatBytes(size)}`);
        }
        await writable.close();
        setMessage("下载完成。", "success");
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    } catch (error) {
      setMessage(error.message || "下载失败。", "error");
    }
  }

  async function loadMyShares() {
    const list = element("transferMyShares");
    if (!list) return;
    try {
      const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
      const payload = await request(`/api/transfer/shares${query}`);
      const shares = payload.shares || [];
      if (!shares.length) {
        list.innerHTML = '<div class="transfer-empty">还没有创建过文件分享。</div>';
        return;
      }
      list.innerHTML = shares.map((share) => `<article class="transfer-share-row">
        <div><strong>${escapeHtml(share.file_count)} 个文件 · ${formatBytes(share.total_bytes)}</strong><small>${new Date(share.expires_at).toLocaleString("zh-CN")} 到期 · 下载 ${share.download_count}/${share.max_downloads}${share.password_required ? " · 有密码" : ""}</small></div>
        <div class="transfer-share-actions">
          <button type="button" data-transfer-open="${escapeHtml(share.id)}">查看</button>
          <button class="danger-text" type="button" data-transfer-revoke="${escapeHtml(share.id)}">撤销</button>
        </div>
      </article>`).join("");
    } catch (error) {
      list.innerHTML = `<div class="transfer-empty">分享列表加载失败：${escapeHtml(error.message || "请稍后重试")}</div>`;
    }
  }

  async function refreshQueueState() {
    for (const item of queue) {
      if (!item.sessionId || item.status === "done" || item.status === "cancelled") continue;
      try {
        const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
        const payload = await request(`/api/transfer/uploads/${item.sessionId}${query}`);
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
          currentShare = sharePayload.share;
          renderShare(currentShare);
        }
      } catch (_) {
        // The session may have expired; the next upload attempt re-creates it.
      }
    }
    renderQueue();
  }

  async function openShare(shareId) {
    try {
      const payload = await request(`/api/transfer/shares/${shareId}`);
      renderShare(payload.share);
    } catch (error) {
      setMessage(error.message || "分享不存在或已过期。", "error");
    }
  }

  async function revokeShare(shareId) {
    try {
      const body = {};
      if (!authenticated()) body.guest_id = guestId();
      await request(`/api/transfer/shares/${shareId}/revoke`, { method: "POST", body });
      setMessage("分享已撤销。", "success");
      await loadMyShares();
    } catch (error) {
      setMessage(error.message || "撤销失败。", "error");
    }
  }

  function cancelItem(id) {
    const item = itemById(id);
    if (!item) return;
    item.status = "cancelled";
    item.controllers?.forEach((controller) => controller.abort());
    item.controllers?.clear();
    item.controller = null;
    queue = queue.filter((entry) => entry.id !== id);
    persistQueue();
    renderQueue();
  }

  function pauseItem(id) {
    const item = itemById(id);
    if (!item) return;
    item.paused = true;
    // Stop every in-flight part; acknowledged parts stay recorded, so resume
    // simply re-uploads whatever did not finish.
    item.controllers?.forEach((controller) => controller.abort());
    item.controllers?.clear();
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
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "transferSelectFilesBtn") element("transferFileInput")?.click();
    else if (button.id === "transferSelectFolderBtn") element("transferFolderInput")?.click();
    // #7: creating the share and downloading a file both wait on the server; the
    // pressed control shows the pending state before the first await.
    else if (button.id === "transferCompleteBtn") {
      void withInteractionFeedback(button, "transfer-complete", () => complete()).catch(() => undefined);
    }
    else if (button.id === "transferCopyLinkBtn") {
      const link = element("transferShareLink");
      link?.select();
      navigator.clipboard?.writeText(link?.value || "").then(() => setMessage("链接已复制。", "success")).catch(() => setMessage("复制失败，请手动复制。"));
    }
    else if (button.id === "transferBackBtn") navigate("/select");
    else if (button.dataset.transferPause) pauseItem(button.dataset.transferPause);
    else if (button.dataset.transferResume) resumeItem(button.dataset.transferResume);
    else if (button.dataset.transferRetry) resumeItem(button.dataset.transferRetry);
    else if (button.dataset.transferCancel) cancelItem(button.dataset.transferCancel);
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

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) addFiles(files);
  }

  function handlePaste(event) {
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
        if (pending === 0 && values.join("\n").trim()) {
          addFiles([new File([values.join("\n")], `粘贴文本-${Date.now()}.txt`, { type: "text/plain" })]);
        }
      }));
    }
  }

  async function loadCapabilities() {
    try {
      const query = authenticated() ? "" : `?guest_id=${encodeURIComponent(guestId())}`;
      const payload = await request(`/api/transfer/capabilities${query}`);
      capabilities = payload;
      renderQuota();
    } catch (_) {
      capabilities = { storage_limit_bytes: 0, used_bytes: 0 };
    }
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    element("transferPage")?.addEventListener("click", handleClick);
    element("transferDropZone")?.addEventListener("dragover", (event) => event.preventDefault());
    element("transferDropZone")?.addEventListener("drop", handleDrop);
    element("transferFileInput")?.addEventListener("change", (event) => {
      addFiles(event.target.files);
      event.target.value = "";
    });
    element("transferFolderInput")?.addEventListener("change", (event) => {
      addFiles(event.target.files);
      event.target.value = "";
    });
    document.addEventListener("paste", handlePaste);
  }

  async function show() {
    initialize();
    restoreQueue();
    renderQueue();
    await Promise.all([loadCapabilities(), loadMyShares(), refreshQueueState()]);
    const hash = location.hash;
    const shareMatch = /^#share=(.+)$/.exec(hash);
    if (shareMatch) void openShare(decodeURIComponent(shareMatch[1]));
    return true;
  }

  function hide() {
    // Pausing is safe: queue state persists and resumes on the next visit.
  }

  function accountUpdated() {
    restoreQueue();
    renderQueue();
    void loadCapabilities();
  }

  return Object.freeze({ show, hide, accountUpdated, addFiles, renderQueue });
}
