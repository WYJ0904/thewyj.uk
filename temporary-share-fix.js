const TEMP_SHARE_MAX_BYTES = 20 * 1024 * 1024;
const TEMP_SHARE_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
const TEMP_SHARE_VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm"]);
const TEMP_SHARE_VIDEO_ACCEPT = ".mp4,.m4v,.mov,.webm,video/mp4,video/webm,video/quicktime";
let activeTemporaryUpload = null;

function tempShareById(id) {
  return document.getElementById(id);
}

function tempShareMessage(message, error = false) {
  const target = tempShareById("toolWorkbenchMessage");
  if (!target) return;
  target.textContent = message || "";
  target.classList.toggle("success", Boolean(message) && !error);
}

function shareViewerMessage(message) {
  const target = tempShareById("shareViewerMessage");
  if (target) target.textContent = message || "";
}

function temporaryFileExtension(file) {
  const name = String(file?.name || "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function temporaryFileLimit(file) {
  return TEMP_SHARE_VIDEO_EXTENSIONS.has(temporaryFileExtension(file))
    ? TEMP_SHARE_VIDEO_MAX_BYTES
    : TEMP_SHARE_MAX_BYTES;
}

function updateTemporaryFileUi() {
  const input = tempShareById("tempFileInput");
  if (input && input.dataset.videoShareFix !== "true") {
    input.dataset.videoShareFix = "true";
    const existing = String(input.getAttribute("accept") || "").trim();
    input.setAttribute("accept", [existing, TEMP_SHARE_VIDEO_ACCEPT].filter(Boolean).join(","));
    const label = input.closest("label")?.querySelector("span");
    if (label) label.textContent = "选择临时文件（视频最大 30 MB，其他文件最大 20 MB）";
  }

  if (/^\/share\/file\/[^/?#]+/.test(location.pathname)) {
    const meta = tempShareById("shareViewerMeta");
    const button = tempShareById("openShareBtn");
    if (meta && meta.textContent !== "打开此页面不会消耗下载次数；点击下载文件时才计入一次下载。") {
      meta.textContent = "打开此页面不会消耗下载次数；点击下载文件时才计入一次下载。";
    }
    if (button && button.textContent !== "下载文件") button.textContent = "下载文件";
  }
}

function setUploadBusy(busy) {
  const createButton = tempShareById("createTempBtn");
  const cancelButton = tempShareById("cancelTempUploadBtn");
  const progressWrap = tempShareById("tempUploadProgressWrap");
  if (createButton) createButton.disabled = busy;
  if (cancelButton) cancelButton.classList.toggle("hidden", !busy);
  if (progressWrap) progressWrap.classList.toggle("hidden", !busy);
}

function setUploadProgress(percent, text) {
  const progress = tempShareById("tempUploadProgress");
  const label = tempShareById("tempUploadProgressText");
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  if (progress) progress.value = safePercent;
  if (label) label.textContent = text || `${safePercent}%`;
}

function encodeBase64Chunks(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkBytes = 3 * 16384;
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes));
    let binary = "";
    for (let index = 0; index < chunk.length; index += 16384) {
      binary += String.fromCharCode(...chunk.subarray(index, Math.min(chunk.length, index + 16384)));
    }
    parts.push(btoa(binary));
  }
  return parts.join("");
}

function formatTemporaryBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderTemporaryFileResult(file) {
  const container = tempShareById("temporaryResult");
  if (!container || !file?.id) return;
  const url = `${location.origin}/share/file/${encodeURIComponent(file.id)}`;
  container.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = "下载链接";
  const code = document.createElement("code");
  code.textContent = url;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "复制";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = "已复制";
    } catch (_) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      copy.textContent = "请手动复制";
    }
  });
  container.append(title, code, copy);
}

async function uploadTemporaryFile() {
  if (activeTemporaryUpload) return;
  const input = tempShareById("tempFileInput");
  const file = input?.files?.[0];
  if (!file) throw new Error("请选择文件");
  const sizeLimit = temporaryFileLimit(file);
  if (file.size > sizeLimit) throw new Error(`该文件不能超过 ${sizeLimit / (1024 * 1024)} MB`);
  const session = localStorage.getItem("wyjAccountSession") || "";
  if (!session) throw new Error("登录状态已失效，请重新登录");

  setUploadBusy(true);
  setUploadProgress(0, "准备读取…");
  tempShareMessage("");
  try {
    const buffer = await file.arrayBuffer();
    setUploadProgress(12, "正在编码…");
    const base64 = encodeBase64Chunks(buffer);
    const payload = JSON.stringify({
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      base64,
      password: tempShareById("tempPassword")?.value || "",
      minutes: tempShareById("tempMinutes")?.value || "60",
      max_downloads: tempShareById("tempMaxDownloads")?.value || "5",
      destroy_after_download: Boolean(tempShareById("tempDestroy")?.checked),
    });

    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeTemporaryUpload = xhr;
      xhr.open("POST", "/api/temporary/file", true);
      xhr.timeout = 240000;
      xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
      xhr.setRequestHeader("X-Session-Token", session);
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const ratio = event.loaded / event.total;
        setUploadProgress(15 + ratio * 84, `上传 ${Math.round(ratio * 100)}%`);
      });
      xhr.addEventListener("load", () => {
        let result = {};
        try { result = JSON.parse(xhr.responseText || "{}"); } catch (_) { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300 && result?.file) resolve(result);
        else reject(new Error(result?.error || `上传失败（HTTP ${xhr.status || 0}）`));
      });
      xhr.addEventListener("error", () => reject(new Error("上传连接中断，请检查网络后重试")));
      xhr.addEventListener("timeout", () => reject(new Error("上传超时，请检查网络后重试")));
      xhr.addEventListener("abort", () => {
        const error = new Error("上传已取消");
        error.name = "AbortError";
        reject(error);
      });
      xhr.send(payload);
    });

    setUploadProgress(100, "上传完成");
    renderTemporaryFileResult(data.file);
    tempShareMessage(`已安全保存，${formatTemporaryBytes(data.file.size_bytes)}，可直接复制链接发送。`);
  } finally {
    activeTemporaryUpload = null;
    setUploadBusy(false);
  }
}

function publicNativeDownloadAvailable() {
  const host = location.hostname.toLowerCase();
  return location.protocol === "https:" && (
    host === "thewyj.uk"
    || host.endsWith(".thewyj.uk")
    || host.endsWith(".pages.dev")
  );
}

function submitNativeTemporaryDownload() {
  const match = location.pathname.match(/^\/share\/file\/([^/?#]+)/);
  if (!match || !publicNativeDownloadAvailable()) return false;
  const id = decodeURIComponent(match[1]);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/share/file/download";
  form.target = "_self";
  form.hidden = true;
  const idField = document.createElement("input");
  idField.type = "hidden";
  idField.name = "id";
  idField.value = id;
  const passwordField = document.createElement("input");
  passwordField.type = "hidden";
  passwordField.name = "password";
  passwordField.value = tempShareById("sharePasswordInput")?.value || "";
  form.append(idField, passwordField);
  document.body.appendChild(form);
  shareViewerMessage("正在连接文件服务并开始下载…");
  form.submit();
  setTimeout(() => form.remove(), 1000);
  return true;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.("#createTempBtn");
  if (button && tempShareById("tempFileInput")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    uploadTemporaryFile().catch((error) => {
      if (error?.name === "AbortError") tempShareMessage("已取消上传");
      else tempShareMessage(error?.message || "上传失败", true);
    });
    return;
  }

  const cancel = event.target.closest?.("#cancelTempUploadBtn");
  if (cancel && activeTemporaryUpload) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activeTemporaryUpload.abort();
    return;
  }

  const openShare = event.target.closest?.("#openShareBtn");
  if (openShare && /^\/share\/file\//.test(location.pathname) && publicNativeDownloadAvailable()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    submitNativeTemporaryDownload();
  }
}, true);

const temporaryShareObserver = new MutationObserver(updateTemporaryFileUi);
temporaryShareObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener("popstate", updateTemporaryFileUi);
updateTemporaryFileUi();
