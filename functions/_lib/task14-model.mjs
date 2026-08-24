export const TASK14_SCHEMA_VERSION = "1";
export const MAX_TEMP_TEXT_BYTES = 100 * 1024;
export const MAX_TEMP_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEMP_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_ROOM_MESSAGE_BYTES = 4 * 1024;
export const MAX_TEMP_LIFETIME_MINUTES = 7 * 24 * 60;
export const DOWNLOAD_GRANT_TTL_SECONDS = 15 * 60;
export const USER_DAILY_CREATE_LIMIT = 100;
export const USER_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024;
export const GLOBAL_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

export const FILE_TYPES = Object.freeze({
  ".txt": Object.freeze(["text/plain"]),
  ".csv": Object.freeze(["text/csv", "application/csv", "text/plain"]),
  ".json": Object.freeze(["application/json", "text/json", "text/plain"]),
  ".pdf": Object.freeze(["application/pdf"]),
  ".png": Object.freeze(["image/png"]),
  ".jpg": Object.freeze(["image/jpeg"]),
  ".jpeg": Object.freeze(["image/jpeg"]),
  ".webp": Object.freeze(["image/webp"]),
  ".gif": Object.freeze(["image/gif"]),
  ".zip": Object.freeze(["application/zip", "application/x-zip-compressed"]),
  ".mp4": Object.freeze(["video/mp4"]),
  ".m4v": Object.freeze(["video/mp4", "video/x-m4v"]),
  ".mov": Object.freeze(["video/quicktime"]),
  ".webm": Object.freeze(["video/webm"]),
});

export const VIDEO_EXTENSIONS = Object.freeze([".mp4", ".m4v", ".mov", ".webm"]);

const ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/;
const SHARE_TYPES = new Set(["text", "file", "clipboard", "qr", "room"]);
const TEXT_KINDS = new Set(["text", "qr", "wifi", "contact", "url"]);
const VIDEO_SET = new Set(VIDEO_EXTENSIONS);

export class Task14Error extends Error {
  constructor(message, status = 400, code = "task14_error", retryable = false) {
    super(message);
    this.name = "Task14Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
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

export function cleanId(value, label = "分享标识") {
  const text = String(value || "").trim();
  if (!ID_PATTERN.test(text)) throw new Task14Error(`${label}无效`, 400, "temporary_identifier_invalid");
  return text;
}

export function cleanShareType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!SHARE_TYPES.has(text)) throw new Task14Error("临时分享类型无效", 400, "temporary_type_invalid");
  return text;
}

export function cleanTextKind(value, fallback = "text") {
  const text = String(value || fallback).trim().toLowerCase();
  if (!TEXT_KINDS.has(text)) throw new Task14Error("临时内容类型无效", 400, "temporary_kind_invalid");
  return text;
}

export function cleanString(value, maximum, label, options = {}) {
  const text = String(value ?? "");
  const normalized = options.trim === false ? text : text.trim();
  if (options.required && !normalized) throw new Task14Error(`${label}不能为空`, 400, options.code || "temporary_field_required");
  if (normalized.length > maximum || CONTROL_PATTERN.test(normalized.replace(/[\r\n\t]/g, ""))) {
    throw new Task14Error(`${label}无效`, 400, options.code || "temporary_field_invalid");
  }
  return normalized;
}

export function cleanTextContent(value, maximumBytes = MAX_TEMP_TEXT_BYTES, label = "分享内容") {
  const text = cleanString(value, maximumBytes, label, { trim: false });
  const normalized = text.replace(/\0/g, "");
  if (!normalized.trim()) throw new Task14Error(`${label}不能为空`, 400, "temporary_content_required");
  if (new TextEncoder().encode(normalized).byteLength > maximumBytes) {
    throw new Task14Error(`${label}不能超过 ${Math.floor(maximumBytes / 1024)} KB`, 413, "temporary_content_too_large");
  }
  return normalized;
}

export function safeInteger(value, minimum, maximum, fallback, label = "数值") {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const result = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Task14Error(`${label}必须在 ${minimum} 到 ${maximum} 之间`, 400, "temporary_number_invalid");
  }
  return result;
}

export function booleanInteger(value) {
  return value ? 1 : 0;
}

export function expiryValue(minutes, now = new Date()) {
  const duration = safeInteger(minutes, 1, MAX_TEMP_LIFETIME_MINUTES, 60, "有效分钟");
  return isoNow(new Date(now.getTime() + duration * 60 * 1000));
}

export function normalizeMime(value) {
  return String(value || "application/octet-stream").trim().toLowerCase().split(";", 1)[0];
}

export function cleanFileName(value) {
  const input = String(value || "").replace(/\\/g, "/");
  const name = input.split("/").pop() || "";
  if (!name || name === "." || name === ".." || name.length > 120 || CONTROL_PATTERN.test(name)
      || !/^[\p{L}\p{N} _().-]+$/u.test(name)) {
    throw new Task14Error("文件名无效", 400, "file_name_invalid");
  }
  return name;
}

export function extensionFor(fileName) {
  const match = String(fileName || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function fileSizeLimit(extension) {
  return VIDEO_SET.has(String(extension || "").toLowerCase()) ? MAX_TEMP_VIDEO_BYTES : MAX_TEMP_FILE_BYTES;
}

export function validateFileMetadata(fileNameValue, mimeValue, sizeValue) {
  const fileName = cleanFileName(fileNameValue);
  const extension = extensionFor(fileName);
  const mimeType = normalizeMime(mimeValue);
  const allowed = FILE_TYPES[extension];
  if (!allowed || !allowed.includes(mimeType)) {
    throw new Task14Error("不支持该文件类型或类型与扩展名不匹配", 400, "file_type_invalid");
  }
  const sizeBytes = Number(sizeValue);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Task14Error("文件不能为空", 400, "file_empty");
  }
  const limit = fileSizeLimit(extension);
  if (sizeBytes > limit) {
    throw new Task14Error(`临时${VIDEO_SET.has(extension) ? "视频" : "文件"}不能超过 ${limit / (1024 * 1024)} MB`, 413, "file_too_large");
  }
  return { fileName, extension, mimeType, sizeBytes, sizeLimit: limit, isVideo: VIDEO_SET.has(extension) };
}

function startsWith(bytes, signature) {
  return bytes.byteLength >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function textForValidation(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || 0);
  let encoding = "utf-8";
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) encoding = "utf-16";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return text.includes("\0") ? null : text;
  } catch (_) {
    return null;
  }
}

export function validateFileContent(extensionValue, value) {
  const extension = String(extensionValue || "").toLowerCase();
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  if (!bytes.byteLength) return false;
  if (extension === ".pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (extension === ".png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if ([".jpg", ".jpeg"].includes(extension)) return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (extension === ".gif") return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  if (extension === ".zip") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
      || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
      || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
  if (extension === ".webp") return bytes.byteLength >= 12
      && startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if ([".mp4", ".m4v", ".mov"].includes(extension)) return bytes.byteLength >= 12
      && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  if (extension === ".webm") return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if ([".txt", ".csv", ".json"].includes(extension)) {
    const text = textForValidation(bytes);
    if (text === null) return false;
    if (extension !== ".json") return true;
    try { JSON.parse(text); return true; } catch (_) { return false; }
  }
  return false;
}

export function objectKeyFor(environment, id) {
  const scope = ["production", "preview", "development"].includes(String(environment || "").toLowerCase())
    ? String(environment).toLowerCase() : "development";
  return `temporary/v1/${scope}/files/${cleanId(id)}`;
}

export function sharePayload(row) {
  return {
    id: String(row.id || ""),
    kind: String(row.kind || row.share_type || ""),
    expires_at: String(row.expires_at || ""),
    max_views: Number(row.max_views || 0),
    view_count: Number(row.view_count || 0),
    destroy_after_read: Boolean(row.destroy_after_read),
    password_required: Boolean(row.password_hash),
    destroyed: String(row.state || "") === "delete_pending",
  };
}

export function filePayload(row) {
  return {
    id: String(row.id || ""),
    file_name: String(row.file_name || ""),
    mime_type: String(row.mime_type || ""),
    size_bytes: Number(row.size_bytes || 0),
    expires_at: String(row.expires_at || ""),
    max_downloads: Number(row.max_downloads || 0),
    download_count: Number(row.download_count || 0),
    destroy_after_download: Boolean(row.destroy_after_download),
    password_required: Boolean(row.password_hash),
    destroyed: String(row.state || "") === "delete_pending",
  };
}

export function requireAllowedFields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task14Error("请求内容无效", 400, "invalid_json");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Task14Error("请求包含不允许的字段", 400, "task14_fields_forbidden");
  }
}

export const __testing = Object.freeze({
  CONTROL_PATTERN,
  ID_PATTERN,
  SHARE_TYPES,
  TEXT_KINDS,
  VIDEO_SET,
  textForValidation,
});
