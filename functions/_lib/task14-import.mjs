import {
  TASK14_SCHEMA_VERSION,
  Task14Error,
  cleanFileName,
  cleanId,
  cleanString,
  cleanTextContent,
  cleanTextKind,
  fileSizeLimit,
  isoNow,
  normalizeMime,
  objectKeyFor,
  requireAllowedFields,
  safeInteger,
  validateFileContent,
  validateFileMetadata,
} from "./task14-model.mjs";
import { __testing as serviceTesting, task14Counts } from "./task14-service.mjs";

const IMPORT_KINDS = new Set(["shares", "room_messages"]);
const SHARE_TYPES = new Set(["text", "file", "clipboard", "qr", "room"]);
const STATES = new Set(["active", "delete_pending", "failed"]);
const HEX_64 = /^[a-f0-9]{64}$/;
const FORBIDDEN_IMPORT_KEYS = /^(?:password|connection_code|token|session|base64|content_blob|file_bytes)$/i;

function assertNoForbiddenKeys(value, depth = 0) {
  if (depth > 6) throw new Task14Error("导入内容嵌套过深", 400, "task14_import_depth_invalid");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_IMPORT_KEYS.test(key)) {
      throw new Task14Error("导入内容包含禁止字段", 400, "task14_import_sensitive_field");
    }
    assertNoForbiddenKeys(item, depth + 1);
  }
}

function timeField(value, required = false) {
  const text = cleanString(value, 40, "导入时间", { required });
  if (text && !Number.isFinite(Date.parse(text))) {
    throw new Task14Error("导入时间无效", 400, "task14_import_time_invalid");
  }
  return text;
}

function hashField(value, label, optional = true) {
  const text = cleanString(value, 512, label);
  if (!text && optional) return "";
  if (label === "连接码摘要" && !HEX_64.test(text)) {
    throw new Task14Error(`${label}无效`, 400, "task14_import_hash_invalid");
  }
  if (label === "文件校验值" && !HEX_64.test(text)) {
    throw new Task14Error(`${label}无效`, 400, "task14_import_hash_invalid");
  }
  return text;
}

async function requireUser(db, userId) {
  const row = await serviceTesting.first(db, "SELECT id FROM task12_users WHERE id = ?1", [userId]);
  if (!row) throw new Task14Error("导入记录引用了不存在的用户", 409, "task14_import_user_missing");
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateImportedObject(storage, record) {
  if (!storage?.get) throw new Task14Error("导入所需 R2 binding 不可用", 503, "task14_storage_unavailable", true);
  const object = await storage.get(record.r2_object_key);
  if (!object) throw new Task14Error("导入文件在 R2 中不存在", 409, "task14_import_r2_missing");
  if (Number(object.size) !== record.size_bytes) {
    throw new Task14Error("导入文件字节数与 R2 不一致", 409, "task14_import_size_mismatch");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!validateFileContent(record.file_extension, bytes)) {
    throw new Task14Error("导入文件签名无效", 409, "task14_import_signature_invalid");
  }
  if (await sha256Hex(bytes) !== record.sha256_hex) {
    throw new Task14Error("导入文件校验值与 R2 不一致", 409, "task14_import_checksum_mismatch");
  }
}

function shareRecord(raw, environment, sourceKey) {
  requireAllowedFields(raw, new Set([
    "id", "owner_user_id", "share_type", "kind", "content", "content_text",
    "file_name", "mime_type", "size_bytes", "sha256_hex", "password_hash",
    "connection_code_digest", "created_at", "updated_at", "expires_at",
    "max_views", "view_count", "max_downloads", "download_count",
    "destroy_after_read", "destroy_after_download", "max_messages", "state",
  ]));
  const id = cleanId(raw.id);
  const shareType = String(raw.share_type || "").trim().toLowerCase();
  if (!SHARE_TYPES.has(shareType)) throw new Task14Error("导入分享类型无效", 400, "task14_import_type_invalid");
  const state = String(raw.state || "active").trim().toLowerCase();
  if (!STATES.has(state)) throw new Task14Error("导入分享状态无效", 400, "task14_import_state_invalid");
  const common = {
    id,
    owner_user_id: cleanString(raw.owner_user_id, 80, "用户标识", { required: true }),
    share_type: shareType,
    kind: shareType === "room" || shareType === "clipboard" || shareType === "file"
      ? shareType : cleanTextKind(raw.kind, shareType),
    content_text: "",
    r2_object_key: "",
    file_name: "",
    file_extension: "",
    mime_type: "",
    size_bytes: 0,
    sha256_hex: "",
    password_hash: hashField(raw.password_hash, "密码摘要"),
    connection_code_digest: hashField(raw.connection_code_digest, "连接码摘要"),
    created_at: timeField(raw.created_at, true),
    updated_at: timeField(raw.updated_at || raw.created_at, true),
    expires_at: timeField(raw.expires_at, true),
    max_views: safeInteger(raw.max_views, 1, 1000, 1, "最大访问次数"),
    view_count: safeInteger(raw.view_count, 0, 1_000_000, 0, "访问次数"),
    max_downloads: safeInteger(raw.max_downloads, 1, 100, 1, "最大下载次数"),
    download_count: safeInteger(raw.download_count, 0, 1_000_000, 0, "下载次数"),
    destroy_after_read: raw.destroy_after_read ? 1 : 0,
    destroy_after_download: raw.destroy_after_download ? 1 : 0,
    max_messages: safeInteger(raw.max_messages, 1, 200, 50, "最大留言数量"),
    state,
    source: `legacy:${sourceKey}`.slice(0, 40),
    source_updated_at: timeField(raw.updated_at || raw.created_at, true),
  };
  if (["text", "qr", "clipboard"].includes(shareType)) {
    common.content_text = cleanTextContent(raw.content_text ?? raw.content, 100 * 1024);
  }
  if (shareType === "clipboard" && !common.connection_code_digest) {
    throw new Task14Error("剪贴板导入记录缺少连接码摘要", 400, "task14_import_code_digest_required");
  }
  if (shareType === "file") {
    const metadata = validateFileMetadata(raw.file_name, raw.mime_type, Number(raw.size_bytes));
    common.file_name = metadata.fileName;
    common.file_extension = metadata.extension;
    common.mime_type = metadata.mimeType;
    common.size_bytes = metadata.sizeBytes;
    common.sha256_hex = hashField(raw.sha256_hex, "文件校验值", false);
    common.r2_object_key = objectKeyFor(environment, id);
  }
  return common;
}

function messageRecord(raw) {
  requireAllowedFields(raw, new Set(["id", "room_id", "author", "message", "created_at"]));
  return {
    id: cleanId(raw.id, "留言标识"),
    room_id: cleanId(raw.room_id, "房间标识"),
    author: cleanString(raw.author || "访客", 30, "显示名称", { required: true }),
    message: cleanTextContent(raw.message, 4 * 1024, "留言").trim(),
    created_at: timeField(raw.created_at, true),
  };
}

async function importShare(db, storage, record) {
  await requireUser(db, record.owner_user_id);
  const existing = await serviceTesting.first(db, "SELECT owner_user_id, share_type FROM task14_shares WHERE id = ?1", [record.id]);
  if (existing && (existing.owner_user_id !== record.owner_user_id || existing.share_type !== record.share_type)) {
    throw new Task14Error("导入分享身份与现有记录冲突", 409, "task14_import_identity_conflict");
  }
  if (record.share_type === "file") await validateImportedObject(storage, record);
  const values = [
    record.id, record.owner_user_id, record.share_type, record.kind, record.content_text,
    record.r2_object_key, record.file_name, record.file_extension, record.mime_type,
    record.size_bytes, record.sha256_hex, record.password_hash, record.connection_code_digest,
    record.created_at, record.updated_at, record.expires_at, record.max_views, record.view_count,
    record.max_downloads, record.download_count, record.destroy_after_read,
    record.destroy_after_download, record.max_messages, record.state, record.source,
    record.source_updated_at,
  ];
  const result = await serviceTesting.run(db, `INSERT INTO task14_shares (
      id, owner_user_id, share_type, kind, content_text, r2_object_key, file_name,
      file_extension, mime_type, size_bytes, sha256_hex, password_hash,
      connection_code_digest, created_at, updated_at, expires_at, max_views,
      view_count, max_downloads, download_count, destroy_after_read,
      destroy_after_download, max_messages, state, source, source_updated_at
    ) VALUES (${values.map((_, index) => `?${index + 1}`).join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, content_text = excluded.content_text,
      r2_object_key = excluded.r2_object_key, file_name = excluded.file_name,
      file_extension = excluded.file_extension, mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes, sha256_hex = excluded.sha256_hex,
      password_hash = excluded.password_hash,
      connection_code_digest = excluded.connection_code_digest,
      expires_at = excluded.expires_at, max_views = excluded.max_views,
      view_count = MAX(task14_shares.view_count, excluded.view_count),
      max_downloads = excluded.max_downloads,
      download_count = MAX(task14_shares.download_count, excluded.download_count),
      destroy_after_read = excluded.destroy_after_read,
      destroy_after_download = excluded.destroy_after_download,
      max_messages = excluded.max_messages, state = excluded.state,
      source = excluded.source, source_updated_at = excluded.source_updated_at,
      updated_at = excluded.updated_at
    WHERE excluded.source_updated_at >= task14_shares.source_updated_at`, values);
  return Number(result?.meta?.changes || 0);
}

async function importMessage(db, record) {
  const room = await serviceTesting.first(db, "SELECT id FROM task14_shares WHERE id = ?1 AND share_type = 'room'", [record.room_id]);
  if (!room) throw new Task14Error("导入留言引用的房间不存在", 409, "task14_import_room_missing");
  const result = await serviceTesting.run(db, `INSERT INTO task14_room_messages
      (id, room_id, author, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO NOTHING`, Object.values(record));
  return Number(result?.meta?.changes || 0);
}

export async function importTask14Batch(db, storage, actor, env, payload) {
  assertNoForbiddenKeys(payload);
  requireAllowedFields(payload, new Set([
    "schema_version", "source_key", "kind", "records", "source_count", "source_bytes", "complete",
  ]));
  if (Number(payload.schema_version) !== Number(TASK14_SCHEMA_VERSION)) {
    throw new Task14Error("Task 14 导入版本不兼容", 400, "task14_import_schema_invalid");
  }
  const sourceKey = cleanString(payload.source_key, 32, "导入来源", { required: true });
  if (!/^[A-Za-z0-9._:-]{8,32}$/.test(sourceKey)) {
    throw new Task14Error("导入来源标识无效", 400, "task14_import_source_invalid");
  }
  const kind = String(payload.kind || "").trim();
  if (!IMPORT_KINDS.has(kind)) throw new Task14Error("导入数据类型无效", 400, "task14_import_kind_invalid");
  if (!Array.isArray(payload.records) || payload.records.length > 100) {
    throw new Task14Error("每批最多导入 100 条记录", 413, "task14_import_batch_too_large");
  }
  const sourceCount = safeInteger(payload.source_count, 0, 1_000_000, 0, "源记录数");
  const sourceBytes = safeInteger(payload.source_bytes, 0, 20_000_000_000, 0, "源文件字节数");
  const startedAt = isoNow();
  await serviceTesting.run(db, `INSERT INTO task14_import_runs (
      source_key, source_kind, source_count, source_bytes, imported_count,
      imported_bytes, status, started_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, 0, 0, 'started', ?5, ?5)
    ON CONFLICT(source_key) DO UPDATE SET
      source_count = MAX(task14_import_runs.source_count, excluded.source_count),
      source_bytes = MAX(task14_import_runs.source_bytes, excluded.source_bytes),
      status = CASE WHEN task14_import_runs.status = 'completed' THEN 'completed' ELSE 'started' END,
      updated_at = excluded.updated_at`, [sourceKey, kind, sourceCount, sourceBytes, startedAt]);
  let changed = 0;
  for (const raw of payload.records) {
    if (kind === "shares") {
      const record = shareRecord(raw, env?.WYJ_ENVIRONMENT, sourceKey);
      changed += await importShare(db, storage, record);
    } else {
      changed += await importMessage(db, messageRecord(raw));
    }
  }
  const completedAt = payload.complete ? isoNow() : "";
  const sourceTag = `legacy:${sourceKey}`;
  const imported = kind === "shares"
    ? await serviceTesting.first(db, `SELECT COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN share_type = 'file' THEN size_bytes ELSE 0 END), 0) AS bytes
      FROM task14_shares WHERE source = ?1`, [sourceTag])
    : await serviceTesting.first(db, `SELECT COUNT(*) AS count, 0 AS bytes
      FROM task14_room_messages AS message
      JOIN task14_shares AS room ON room.id = message.room_id
      WHERE room.source = ?1`, [`legacy:${sourceKey.replace(/:room_messages$/, ":shares")}`]);
  await serviceTesting.run(db, `UPDATE task14_import_runs SET
      imported_count = ?2,
      imported_bytes = ?3,
      status = CASE WHEN ?4 = 1 THEN 'completed' ELSE status END,
      completed_at = CASE WHEN ?4 = 1 THEN ?5 ELSE completed_at END,
      updated_at = ?5 WHERE source_key = ?1`, [
    sourceKey, Number(imported?.count || 0), Number(imported?.bytes || 0),
    payload.complete ? 1 : 0, isoNow(),
  ]);
  return { kind, received: payload.records.length, changed, complete: Boolean(payload.complete) };
}

export async function rollbackTask14Import(db, storage, payload) {
  requireAllowedFields(payload, new Set(["source_key"]));
  const sourceKey = cleanString(payload.source_key, 32, "导入来源", { required: true });
  const source = `legacy:${sourceKey}`.slice(0, 40);
  const rows = await serviceTesting.all(db, "SELECT id, r2_object_key FROM task14_shares WHERE source = ?1", [source]);
  for (const row of rows) {
    if (row.r2_object_key) await storage.delete(row.r2_object_key);
  }
  await serviceTesting.run(db, "DELETE FROM task14_shares WHERE source = ?1", [source]);
  await serviceTesting.run(db, `UPDATE task14_import_runs SET status = 'rolled_back',
    completed_at = ?2, updated_at = ?2 WHERE source_key = ?1`, [sourceKey, isoNow()]);
  return { source_key: sourceKey, removed: rows.length };
}

export async function task14ImportStatus(db) {
  const runs = await serviceTesting.all(db, `SELECT source_key, source_kind, source_count,
    source_bytes, imported_count, imported_bytes, status, started_at, completed_at, updated_at
    FROM task14_import_runs ORDER BY updated_at DESC LIMIT 100`);
  return { schema_version: TASK14_SCHEMA_VERSION, counts: await task14Counts(db), runs };
}

export const __testing = Object.freeze({
  IMPORT_KINDS,
  assertNoForbiddenKeys,
  messageRecord,
  shareRecord,
  sha256Hex,
  validateImportedObject,
});
