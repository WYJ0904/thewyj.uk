import { ACCOUNT_SESSION_KEY, accountSessionHeaders } from "../core/session.js?v=20260911-task24-1-closure-r2";
import { getSafeStorage } from "../core/storage.js?v=20260911-task24-1-closure-r2";

const QUEUE_STORAGE_KEY = "wyjTransferQueue:v1";
const GUEST_ID_KEY = "wyjTransferGuest:v1";
const PART_SIZE_HINT = 16 * 1024 * 1024;
const DEFAULT_EXPIRY_MINUTES = 1440;

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
  let activeSession = null;
  let currentShare = null;
  let running = false;
  let capabilities = { storage_limit_bytes: 500 * 1024 * 1024, used_bytes: 0 };

  const element = (id) => document.getElementById(id);
  const authenticated = () => Boolean(account()?.id);

  function guestId() {
    let value = String(storage.getItem(GUEST_ID_KEY) || "").trim();
    if (!/^guest:[A-Za-z0-9-]{16,80}$/.test(value)) {
      value = `guest:${crypto.randomUUID()}`;
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
      queue: queue.map(({ file, controller, ...item }) => item),
    };
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serializable));
  }

  function restoreQueue() {
    try {
      const saved = JSON.parse(storage.getItem(QUEUE_STORAGE_KEY) || "{}");
      const owner = authenticated() ? String(account().id) : `guest:${guestId()}`;
      if (saved.account === owner && Array.isArray(saved.queue)) {
        queue = saved.queue.map((item) => ({ ...item, file: null, needsFile: true, controller: null, speed: 0, eta: 0 }));
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
        id: crypto.randomUUID(),
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
      const restored = queue.find((item) => item.sessionId);
      if (restored) activeSession = { id: restored.sessionId, expiresAt: "" };
    }
    if (activeSession && queue.some((item) => item.status !== "done")) return activeSession;
    const body = {
      minutes: Number(element("transferExpiry")?.value || DEFAULT_EXPIRY_MINUTES),
      max_downloads: Number(element("transferMaxDownloads")?.value || 5),
      one_time: Boolean(element("transferOneTime")?.checked),
      password: String(element("transferPassword")?.value || ""),
      file_count: Math.max(queue.length, 1),
      total_bytes: queue.reduce((sum, item) => sum + item.size, 0),
    };
    if (!authenticated()) body.guest_id = guestId();
    const payload = await request("/api/transfer/uploads", { method: "POST", body });
    activeSession = { id: payload.upload.id, expiresAt: payload.upload.expires_at };
    for (const item of queue) if (!item.sessionId) item.sessionId = activeSession.id;
    persistQueue();
    return activeSession;
  }

  async function uploadPartBytes(item, partNumber, part) {
    const partDigest = await crypto.subtle.digest("SHA-256", await part.arrayBuffer());
    const partHash = [...new Uint8Array(partDigest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const controller = new AbortController();
    item.controller = controller;
    const response = await fetch(
      `/api/transfer/uploads/${item.sessionId}/files/${item.fileId}/parts/${partNumber}`,
      {
        method: "PUT",
        headers: headers({ "Content-Type": "application/octet-stream", "X-Part-Sha256": partHash }),
        body: part,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `分片上传失败（HTTP ${response.status}）`);
      error.code = data.code || "part_failed";
      error.status = response.status;
      throw error;
    }
  }

  async function allocateItem(item) {
    if (item.fileId) return;
    const body = {
      session_id: item.sessionId,
      file_id: `file-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
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
    const startedAt = Date.now();
    let lastBytes = 0;
    for (let partNumber = 1; partNumber <= item.partCount; partNumber += 1) {
      if (item.status === "cancelled") return;
      while (item.paused && item.status !== "cancelled") {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (item.uploadedParts.includes(partNumber)) continue;
      const offset = (partNumber - 1) * item.partSize;
      const length = Math.min(item.partSize, item.size - offset);
      const part = item.file.slice(offset, offset + length);
      try {
        await uploadPartBytes(item, partNumber, part);
        item.uploadedParts.push(partNumber);
        item.uploaded = Math.min(item.size, offset + length);
        persistQueue();
      } catch (error) {
        if (item.status === "cancelled") return;
        if (error.code === "transfer_part_size_mismatch" || error.code === "transfer_identifier_invalid") {
          item.status = "error";
          item.error = error.message;
          renderQueue();
          return;
        }
        item.status = "error";
        item.error = error.message;
        item.failedPart = partNumber;
        renderQueue();
        return;
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      const delta = item.uploaded - lastBytes;
      lastBytes = item.uploaded;
      if (elapsed > 0.5 && delta > 0) {
        item.speed = delta / Math.max(0.2, (Date.now() - startedAt) / 1000);
        item.eta = item.size > item.uploaded ? (item.size - item.uploaded) / Math.max(1, item.speed) : 0;
      }
      renderQueue();
    }
    item.status = "done";
    item.controller = null;
    persistQueue();
    renderQueue();
    if (queue.every((entry) => entry.status === "done")) setMessage("全部文件已上传，可以创建分享链接。");
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      for (const item of [...queue]) {
        if (item.status === "pending" || item.status === "error") await uploadItem(item);
      }
    } finally {
      running = false;
    }
  }

  async function complete() {
    if (!activeSession || !queue.length || queue.some((item) => item.status !== "done")) {
      setMessage("还有文件没有上传完成。", "error");
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

  async function downloadShareFile(shareId, fileId) {
    const password = window.prompt("该分享可能设有访问密码，如需要请输入：") || "";
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
    item.controller?.abort();
    queue = queue.filter((entry) => entry.id !== id);
    persistQueue();
    renderQueue();
  }

  function pauseItem(id) {
    const item = itemById(id);
    if (!item) return;
    item.paused = true;
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
    else if (button.id === "transferCompleteBtn") void complete();
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
      void downloadShareFile(shareId, fileId);
    }
    else if (button.dataset.transferOpen) void openShare(button.dataset.transferOpen);
    else if (button.dataset.transferRevoke) void revokeShare(button.dataset.transferRevoke);
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
