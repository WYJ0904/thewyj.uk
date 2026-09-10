export const TASK22_SCHEMA_VERSION = "1";
export const TASK22_BUILD = "2026-09-09-task22-file-transfer-2";

export const PART_SIZE_BYTES = 16 * 1024 * 1024;
export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_PART_SIZE_BYTES = 32 * 1024 * 1024;
export const MAX_FILE_COUNT_PER_SHARE = 500;
export const MAX_SHARE_BYTES = 5 * 1024 * 1024 * 1024;
export const GUEST_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
export const FREE_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024;
export const TOOLS_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const OWNER_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const DOWNLOAD_GRANT_TTL_SECONDS = 30 * 60;
export const USER_DAILY_CREATE_LIMIT = 100;
export const GUEST_DAILY_CREATE_LIMIT = 20;
export const EXPIRY_MINUTES = Object.freeze([60, 1440, 4320, 10080]);
export const MAX_SHARE_EXPIRY_MINUTES = 10080;
export const GUEST_MAX_EXPIRY_MINUTES = 1440;

const ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const GUEST_ID_PATTERN = /^guest:[A-Za-z0-9-]{16,80}$/;
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/;
const PART_NUMBER_MAX = 4096;

export class Task22Error extends Error {
  constructor(message, status = 400, code = "task22_error", retryable = false, details = undefined) {
    super(message);
    this.name = "Task22Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function randomToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function cleanId(value, label = "传输标识") {
  const text = String(value || "").trim();
  if (!ID_PATTERN.test(text)) throw new Task22Error(`${label}无效`, 400, "transfer_identifier_invalid");
  return text;
}

export function cleanGuestId(value) {
  const text = String(value || "").trim();
  if (!GUEST_ID_PATTERN.test(text)) throw new Task22Error("访客设备标识无效", 400, "transfer_guest_identifier_invalid");
  return text;
}

export function guestOwnerRef(guestId) {
  return `guest:${String(guestId || "").slice(6).padStart(40, "0").slice(0, 40)}`;
}

export function normalizeMime(value) {
  return String(value || "application/octet-stream").trim().toLowerCase().split(";", 1)[0];
}

function safeComponent(value, maximum) {
  const text = String(value ?? "").trim();
  if (!text || text === "." || text === ".." || text.length > maximum || CONTROL_PATTERN.test(text)) {
    throw new Task22Error("文件名或路径组件无效", 400, "transfer_name_invalid");
  }
  if (/[\\/]/.test(text)) throw new Task22Error("文件路径不能包含路径分隔符", 400, "transfer_path_invalid");
  return text;
}

export function cleanFileName(value) {
  const name = safeComponent(value, 255);
  if (!/^[\p{L}\p{N} _.,()\[\]+=-]+$/u.test(name)) {
    throw new Task22Error("文件名包含不允许的字符", 400, "transfer_name_invalid");
  }
  return name;
}

export function cleanRelativePath(value) {
  const raw = String(value || "").replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.includes("//") || raw.length > 512 || CONTROL_PATTERN.test(raw)) {
    throw new Task22Error("文件相对路径无效", 400, "transfer_path_invalid");
  }
  // Normalize before validating so a padded component such as " .. " can
  // never be accepted as a literal name and later resolve to a traversal.
  const components = raw.split("/").map((component) => component.trim());
  if (components.some((component) => component === ".." || component === "." || !component)) {
    throw new Task22Error("文件相对路径不能包含目录穿越", 400, "transfer_path_traversal");
  }
  const cleaned = components.map((component) => {
    let decoded = component;
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch (_) {
        throw new Task22Error("路径组件包含无效的编码", 400, "transfer_path_invalid");
      }
    }
    if (decoded !== component && (decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..")) {
      throw new Task22Error("文件相对路径不能包含目录穿越", 400, "transfer_path_traversal");
    }
    const safe = safeComponent(component, 255);
    if (!/^[\p{L}\p{N} _.,()\[\]+=-]+$/u.test(safe)) {
      throw new Task22Error("路径组件包含不允许的字符", 400, "transfer_path_invalid");
    }
    return safe;
  });
  const path = cleaned.join("/");
  if (!path || path.length > 512) throw new Task22Error("文件相对路径无效", 400, "transfer_path_invalid");
  return path;
}

export function extensionFor(fileName) {
  const match = String(fileName || "").toLowerCase().match(/(\.[a-z0-9]{1,16})$/);
  return match ? match[1] : "";
}

const INLINE_PREVIEW_EXTENSIONS = Object.freeze(new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
  ".pdf", ".txt", ".md", ".csv", ".json", ".log",
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus",
  ".mp4", ".m4v", ".mov", ".webm",
]));

const ALWAYS_ATTACHMENT_EXTENSIONS = Object.freeze(new Set([
  ".svg", ".html", ".htm", ".xhtml", ".js", ".mjs", ".cjs", ".ts", ".sh", ".bat",
  ".cmd", ".ps1", ".exe", ".dll", ".msi", ".com", ".scr", ".jar", ".apk", ".iso",
  ".dmg", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".7z", ".rar",
  ".tar", ".gz", ".bz2", ".xz",
]));

export function previewPolicyFor(fileName, mimeValue) {
  const extension = extensionFor(fileName);
  const mime = normalizeMime(mimeValue);
  if (ALWAYS_ATTACHMENT_EXTENSIONS.has(extension)) return { policy: "download_only", disposition: "attachment", mimeType: mime };
  if (INLINE_PREVIEW_EXTENSIONS.has(extension)) {
    const inline = mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")
      || mime === "application/pdf" || mime.startsWith("text/") || mime === "application/json"
      || mime === "application/csv";
    return inline
      ? { policy: "preview", disposition: "inline", mimeType: mime }
      : { policy: "download_only", disposition: "attachment", mimeType: mime };
  }
  // Unknown and ordinary binary formats remain downloadable; they are never inline.
  return { policy: "download_only", disposition: "attachment", mimeType: mime };
}

export function safeContentDisposition(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function safeInteger(value, minimum, maximum, fallback, label = "数值") {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const result = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Task22Error(`${label}必须在 ${minimum} 到 ${maximum} 之间`, 400, "transfer_number_invalid");
  }
  return result;
}

export function expiryMinutes(value, ownerKind, fallback = 1440) {
  const minutes = safeInteger(value, 60, MAX_SHARE_EXPIRY_MINUTES, fallback, "有效分钟");
  if (!EXPIRY_MINUTES.includes(minutes)) {
    throw new Task22Error("有效期仅支持 1 小时、1 天、3 天或 7 天", 400, "transfer_expiry_invalid");
  }
  if (ownerKind === "guest" && minutes > GUEST_MAX_EXPIRY_MINUTES) {
    throw new Task22Error("访客分享最长保存 1 天", 400, "transfer_expiry_invalid");
  }
  return minutes;
}

export function partSizeFor(sizeBytes) {
  if (sizeBytes <= PART_SIZE_BYTES) return Math.max(MIN_PART_SIZE_BYTES, Math.ceil(sizeBytes / 4096) * 4096);
  return PART_SIZE_BYTES;
}

export function partCountFor(sizeBytes, partSize) {
  const count = Math.ceil(sizeBytes / partSize);
  if (!Number.isSafeInteger(count) || count < 1 || count > PART_NUMBER_MAX) {
    throw new Task22Error("文件分片数量超出限制", 413, "transfer_part_count_exceeded");
  }
  return count;
}

export function partRange(partNumber, partSize, sizeBytes) {
  const offset = (partNumber - 1) * partSize;
  const length = Math.min(partSize, sizeBytes - offset);
  return { offset, length };
}

export function parseByteRange(value, totalBytes) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(text);
  if (!match || (!match[1] && !match[2])) {
    throw new Task22Error("仅支持单段字节范围下载", 416, "transfer_range_invalid");
  }
  let offset;
  let length;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Task22Error("下载范围无效", 416, "transfer_range_invalid");
    length = Math.min(suffix, totalBytes);
    offset = totalBytes - length;
  } else {
    offset = Number(match[1]);
    const end = match[2] ? Number(match[2]) : totalBytes - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)
        || offset < 0 || end < offset || offset >= totalBytes) {
      throw new Task22Error("下载范围无效", 416, "transfer_range_invalid");
    }
    length = Math.min(end, totalBytes - 1) - offset + 1;
  }
  return { offset, length };
}

export function requireAllowedFields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task22Error("请求内容无效", 400, "invalid_json");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task22Error("请求包含不允许的字段", 400, "task22_fields_forbidden");
  }
}

export function sessionPayload(row, files = [], parts = {}) {
  return {
    id: String(row.id || ""),
    state: String(row.state || ""),
    owner_kind: String(row.owner_kind || ""),
    file_count: Number(row.file_count || 0),
    total_bytes: Number(row.total_bytes || 0),
    expires_at: String(row.expires_at || ""),
    share_id: String(row.share_id || ""),
    files: files.map((file) => ({
      file_id: String(file.id || ""),
      relative_path: String(file.relative_path || ""),
      file_name: String(file.file_name || ""),
      mime_type: String(file.mime_type || ""),
      size_bytes: Number(file.size_bytes || 0),
      part_size: Number(file.part_size || 0),
      part_count: Number(file.part_count || 0),
      preview_policy: String(file.preview_policy || "download_only"),
      state: String(file.state || ""),
      uploaded_parts: parts[String(file.id)] || [],
    })),
  };
}

export function sharePayload(row, files = []) {
  return {
    id: String(row.id || ""),
    expires_at: String(row.expires_at || ""),
    total_bytes: Number(row.total_bytes || 0),
    file_count: Number(row.file_count || 0),
    max_downloads: Number(row.max_downloads || 0),
    download_count: Number(row.download_count || 0),
    one_time: Boolean(row.one_time),
    password_required: Boolean(row.password_hash),
    revoked: String(row.state || "") === "revoked",
    destroyed: String(row.state || "") === "delete_pending",
    files: files.map((file) => ({
      file_id: String(file.file_id || ""),
      relative_path: String(file.relative_path || ""),
      file_name: String(file.file_name || ""),
      mime_type: String(file.mime_type || ""),
      size_bytes: Number(file.size_bytes || 0),
      part_size: Number(file.part_size || 0),
      part_count: Number(file.part_count || 0),
      preview_policy: String(file.preview_policy || "download_only"),
    })),
  };
}

export const __testing = Object.freeze({
  CONTROL_PATTERN,
  ID_PATTERN,
  GUEST_ID_PATTERN,
  INLINE_PREVIEW_EXTENSIONS,
  ALWAYS_ATTACHMENT_EXTENSIONS,
});
