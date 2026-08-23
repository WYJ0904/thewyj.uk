import { accountMembershipState } from "./task13-service.mjs";
import {
  connectionCodeDigest,
  grantTokenDigest,
  hashTemporaryPassword,
  legacyConnectionCodeDigest,
  verifyTemporaryPassword,
} from "./task14-crypto.mjs";
import {
  DOWNLOAD_GRANT_TTL_SECONDS,
  GLOBAL_STORAGE_LIMIT_BYTES,
  MAX_ROOM_MESSAGE_BYTES,
  MAX_TEMP_TEXT_BYTES,
  TASK14_SCHEMA_VERSION,
  Task14Error,
  USER_DAILY_CREATE_LIMIT,
  USER_STORAGE_LIMIT_BYTES,
  booleanInteger,
  cleanFileName,
  cleanId,
  cleanString,
  cleanTextContent,
  cleanTextKind,
  expiryValue,
  filePayload,
  isoNow,
  objectKeyFor,
  randomToken,
  safeInteger,
  sharePayload,
  validateFileContent,
  validateFileMetadata,
} from "./task14-model.mjs";

const ACTIVE_STATES = Object.freeze(["active", "delete_pending"]);
const FULL_FILE_VALIDATION_EXTENSIONS = new Set([".txt", ".csv", ".json"]);
const CLEANUP_LIMIT = 100;

function requireDatabase(db) {
  if (!db?.prepare) throw new Task14Error("云端临时分享数据库暂时不可用", 503, "task14_database_unavailable", true);
  return db;
}

function requireStorage(storage) {
  if (!storage?.put || !storage?.get || !storage?.delete) {
    throw new Task14Error("云端临时文件存储暂时不可用", 503, "task14_storage_unavailable", true);
  }
  return storage;
}

async function first(db, sql, values = []) {
  return await requireDatabase(db).prepare(sql).bind(...values).first();
}

async function all(db, sql, values = []) {
  return (await requireDatabase(db).prepare(sql).bind(...values).all()).results || [];
}

async function run(db, sql, values = []) {
  return await requireDatabase(db).prepare(sql).bind(...values).run();
}

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

function task14Secret(env) {
  return String(env?.WYJ_TASK14_TEMPORARY_SECRET || "");
}

function isExpired(row, now = Date.now()) {
  return !Number.isFinite(Date.parse(String(row?.expires_at || ""))) || Date.parse(row.expires_at) <= now;
}

function schedule(context, promise) {
  if (typeof context?.waitUntil === "function") context.waitUntil(Promise.resolve(promise).catch(() => undefined));
  else return promise;
  return undefined;
}

function parseRangeLength(range, fallback) {
  if (!range) return fallback;
  if (Number.isInteger(range.length)) return range.length;
  if (Number.isInteger(range.offset) && Number.isInteger(range.end)) return range.end - range.offset + 1;
  return fallback;
}

function parseByteRange(value, totalBytes) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(text);
  if (!match || (!match[1] && !match[2])) {
    throw new Task14Error("仅支持单段字节范围下载", 416, "temporary_range_invalid");
  }
  let offset;
  let length;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new Task14Error("下载范围无效", 416, "temporary_range_invalid");
    }
    length = Math.min(suffix, totalBytes);
    offset = totalBytes - length;
  } else {
    offset = Number(match[1]);
    const end = match[2] ? Number(match[2]) : totalBytes - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)
        || offset < 0 || end < offset || offset >= totalBytes) {
      throw new Task14Error("下载范围无效", 416, "temporary_range_invalid");
    }
    length = Math.min(end, totalBytes - 1) - offset + 1;
  }
  return { offset, length };
}

function safeContentDisposition(fileName) {
  const fallback = cleanFileName(fileName).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function requireTemporaryEntitlement(db, account) {
  const membership = await accountMembershipState(db, account);
  if (!account?.is_super_admin && !membership?.entitlements?.includes("temporary_share_access")) {
    throw new Task14Error("当前会员不包含临时分享", 403, "membership_required");
  }
  return membership;
}

async function consumeCreateQuota(db, userId, sizeBytes = 0) {
  const today = isoNow().slice(0, 10);
  const now = isoNow();
  const quota = await first(db, `INSERT INTO task14_usage_daily (user_id, usage_date, create_count, updated_at)
    VALUES (?1, ?2, 1, ?3)
    ON CONFLICT(user_id, usage_date) DO UPDATE SET
      create_count = task14_usage_daily.create_count + 1,
      updated_at = excluded.updated_at
    WHERE task14_usage_daily.create_count < ?4
    RETURNING create_count`, [String(userId), today, now, USER_DAILY_CREATE_LIMIT]);
  if (!quota) throw new Task14Error("今天创建的临时分享已达到上限", 429, "temporary_daily_quota_exceeded");
  if (!sizeBytes) return;
  const [user, global] = await Promise.all([
    first(db, `SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM task14_shares
      WHERE owner_user_id = ?1 AND share_type = 'file' AND state IN ('uploading', 'active', 'delete_pending')`, [String(userId)]),
    first(db, `SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM task14_shares
      WHERE share_type = 'file' AND state IN ('uploading', 'active', 'delete_pending')`),
  ]);
  if (Number(user?.bytes || 0) + sizeBytes > USER_STORAGE_LIMIT_BYTES) {
    throw new Task14Error("当前账户的临时文件存储已达到上限", 413, "temporary_user_storage_quota_exceeded");
  }
  if (Number(global?.bytes || 0) + sizeBytes > GLOBAL_STORAGE_LIMIT_BYTES) {
    throw new Task14Error("临时文件云存储暂时已满，请稍后重试", 503, "temporary_global_storage_quota_exceeded", true);
  }
}

async function passwordHash(password, env) {
  return await hashTemporaryPassword(password, task14Secret(env));
}

async function checkPassword(row, password, env) {
  if (!await verifyTemporaryPassword(password, row?.password_hash, task14Secret(env))) {
    throw new Task14Error("访问密码错误", 403, "share_password_invalid");
  }
}

async function shareRow(db, id, types = []) {
  const shareId = cleanId(id);
  const row = await first(db, `SELECT * FROM task14_shares WHERE id = ?1`, [shareId]);
  if (!row || (types.length && !types.includes(String(row.share_type)))) return null;
  return row;
}

async function removeNonFileShare(db, row, reason = "consumed") {
  await run(db, "DELETE FROM task14_shares WHERE id = ?1", [row.id]);
  return { ...row, state: "delete_pending", deletion_reason: reason };
}

async function markCleanupFailure(db, row, reason = "r2_delete_failed") {
  const attempts = Number(row.cleanup_attempts || 0) + 1;
  const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.min(attempts, 8)));
  const retryAt = isoNow(new Date(Date.now() + delaySeconds * 1000));
  await run(db, `UPDATE task14_shares SET state = 'delete_pending', deletion_reason = ?2,
    cleanup_attempts = cleanup_attempts + 1, cleanup_retry_at = ?3, updated_at = ?4 WHERE id = ?1`,
  [row.id, reason, retryAt, isoNow()]);
}

async function removeFileShare(db, storage, row, reason = "cleanup") {
  const now = isoNow();
  await run(db, `UPDATE task14_shares SET state = 'delete_pending', deletion_reason = ?2,
    cleanup_retry_at = '', updated_at = ?3 WHERE id = ?1 AND state != 'deleted'`, [row.id, reason, now]);
  try {
    if (row.r2_object_key) await requireStorage(storage).delete(row.r2_object_key);
  } catch (_) {
    await markCleanupFailure(db, row);
    return false;
  }
  await run(db, "DELETE FROM task14_shares WHERE id = ?1", [row.id]);
  return true;
}

async function expireIfNeeded(db, storage, row) {
  if (!row || !isExpired(row)) return false;
  if (row.share_type === "file") await removeFileShare(db, storage, row, "expired");
  else await removeNonFileShare(db, row, "expired");
  return true;
}

export async function ensureTask14Schema(db) {
  if (!db?.prepare) return false;
  const row = await first(db, "SELECT value FROM task14_metadata WHERE key = ?1", ["schema_version"]);
  return String(row?.value || "") === TASK14_SCHEMA_VERSION;
}

export async function createTextShare(db, account, env, input, shareType = "text") {
  await requireTemporaryEntitlement(db, account);
  const type = shareType === "qr" ? "qr" : "text";
  const kind = cleanTextKind(input.kind, type === "qr" ? "qr" : "text");
  const content = cleanTextContent(input.content);
  const id = randomToken(24);
  const now = isoNow();
  const expiresAt = expiryValue(input.minutes ?? 60);
  const maxViews = safeInteger(input.max_views, 1, 1000, 10, "最大访问次数");
  await consumeCreateQuota(db, account.id);
  await run(db, `INSERT INTO task14_shares (
      id, owner_user_id, share_type, kind, content_text, password_hash,
      created_at, updated_at, expires_at, max_views, destroy_after_read, state
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, 'active')`, [
    id, account.id, type, kind, content, await passwordHash(input.password, env), now, expiresAt,
    maxViews, booleanInteger(input.destroy_after_read),
  ]);
  return sharePayload(await shareRow(db, id));
}

export async function readTextShare(db, storage, env, input) {
  const row = await shareRow(db, input.id, ["text", "qr"]);
  if (!row || await expireIfNeeded(db, storage, row) || row.state !== "active") {
    throw new Task14Error("分享不存在或已过期", 404, "share_not_found");
  }
  await checkPassword(row, input.password, env);
  const now = isoNow();
  const consumed = await first(db, `UPDATE task14_shares SET
      view_count = view_count + 1,
      state = CASE WHEN destroy_after_read = 1 OR view_count + 1 >= max_views
        THEN 'delete_pending' ELSE state END,
      deletion_reason = CASE WHEN destroy_after_read = 1 OR view_count + 1 >= max_views
        THEN 'read_limit' ELSE deletion_reason END,
      updated_at = ?2
    WHERE id = ?1 AND state = 'active' AND view_count < max_views AND expires_at > ?2
    RETURNING *`, [row.id, now]);
  if (!consumed) throw new Task14Error("分享不存在或已过期", 404, "share_not_found");
  const destroyed = consumed.state === "delete_pending";
  return { ...sharePayload(consumed), content: consumed.content_text, destroyed };
}

export async function createClipboard(db, account, env, input) {
  await requireTemporaryEntitlement(db, account);
  const content = cleanTextContent(input.content);
  const id = randomToken(24);
  const now = isoNow();
  const expiresAt = expiryValue(input.minutes ?? 10);
  await consumeCreateQuota(db, account.id);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const digest = await connectionCodeDigest(code, task14Secret(env));
    try {
      await run(db, `INSERT INTO task14_shares (
          id, owner_user_id, share_type, kind, content_text, connection_code_digest,
          created_at, updated_at, expires_at, max_views, destroy_after_read, state
        ) VALUES (?1, ?2, 'clipboard', 'clipboard', ?3, ?4, ?5, ?5, ?6, 1000, ?7, 'active')`, [
        id, account.id, content, digest, now, expiresAt, booleanInteger(input.destroy_after_read !== false),
      ]);
      return { code, expires_at: expiresAt, destroy_after_read: input.destroy_after_read !== false };
    } catch (error) {
      if (!String(error?.message || "").toLowerCase().includes("unique")) throw error;
    }
  }
  throw new Task14Error("暂时无法生成连接码，请重试", 503, "clipboard_code_busy", true);
}

export async function readClipboard(db, storage, env, input) {
  const code = String(input.code || "").trim();
  if (!/^\d{6}$/.test(code)) throw new Task14Error("连接码必须是六位数字", 400, "clipboard_code_invalid");
  const [digest, legacyDigest] = await Promise.all([
    connectionCodeDigest(code, task14Secret(env)),
    legacyConnectionCodeDigest(code, task14Secret(env)),
  ]);
  const row = await first(db, `SELECT * FROM task14_shares
    WHERE share_type = 'clipboard' AND connection_code_digest IN (?1, ?2)`, [digest, legacyDigest]);
  if (!row || await expireIfNeeded(db, storage, row) || row.state !== "active") {
    throw new Task14Error("连接码无效或已过期", 404, "clipboard_not_found");
  }
  const now = isoNow();
  const consumed = await first(db, `UPDATE task14_shares SET
      view_count = view_count + 1,
      state = CASE WHEN destroy_after_read = 1 THEN 'delete_pending' ELSE state END,
      deletion_reason = CASE WHEN destroy_after_read = 1 THEN 'clipboard_read' ELSE deletion_reason END,
      updated_at = ?2
    WHERE id = ?1 AND state = 'active' AND expires_at > ?2 RETURNING *`, [row.id, now]);
  if (!consumed) throw new Task14Error("连接码无效或已过期", 404, "clipboard_not_found");
  const destroyed = consumed.state === "delete_pending";
  return {
    content: consumed.content_text, expires_at: consumed.expires_at,
    read_count: Number(consumed.view_count), destroyed,
  };
}

export async function createRoom(db, account, env, input) {
  await requireTemporaryEntitlement(db, account);
  const id = randomToken(22);
  const now = isoNow();
  const expiresAt = expiryValue(input.minutes ?? 60);
  const maxMessages = safeInteger(input.max_messages, 1, 200, 50, "最大留言数量");
  await consumeCreateQuota(db, account.id);
  await run(db, `INSERT INTO task14_shares (
      id, owner_user_id, share_type, kind, password_hash, created_at, updated_at,
      expires_at, max_messages, state
    ) VALUES (?1, ?2, 'room', 'room', ?3, ?4, ?4, ?5, ?6, 'active')`, [
    id, account.id, await passwordHash(input.password, env), now, expiresAt, maxMessages,
  ]);
  return {
    id, expires_at: expiresAt, max_messages: maxMessages, password_required: Boolean(input.password),
  };
}

async function activeRoom(db, storage, env, input) {
  const row = await shareRow(db, input.id, ["room"]);
  if (!row || await expireIfNeeded(db, storage, row) || row.state !== "active") {
    throw new Task14Error("留言房间不存在或已过期", 404, "room_not_found");
  }
  await checkPassword(row, input.password, env);
  return row;
}

export async function readRoom(db, storage, env, input) {
  const room = await activeRoom(db, storage, env, input);
  const messages = await all(db, `SELECT id, author, message, created_at FROM task14_room_messages
    WHERE room_id = ?1 ORDER BY created_at ASC, rowid ASC`, [room.id]);
  return { id: room.id, expires_at: room.expires_at, max_messages: Number(room.max_messages), messages };
}

export async function postRoomMessage(db, storage, env, input) {
  const room = await activeRoom(db, storage, env, input);
  const author = cleanString(input.author || "访客", 30, "显示名称", { required: true });
  const message = cleanTextContent(input.message, MAX_ROOM_MESSAGE_BYTES, "留言").trim();
  const id = randomToken(20);
  const now = isoNow();
  await requireDatabase(db).batch([
    db.prepare(`INSERT INTO task14_room_messages (id, room_id, author, message, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)`).bind(id, room.id, author, message, now),
    db.prepare(`DELETE FROM task14_room_messages WHERE id IN (
      SELECT id FROM task14_room_messages WHERE room_id = ?1
      ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?2
    )`).bind(room.id, Number(room.max_messages)),
  ]);
  return await readRoom(db, storage, env, input);
}

export async function clearRoom(db, account, input) {
  const id = cleanId(input.id, "房间标识");
  const row = await first(db, "SELECT owner_user_id FROM task14_shares WHERE id = ?1 AND share_type = 'room'", [id]);
  if (!row) throw new Task14Error("留言房间不存在", 404, "room_not_found");
  if (row.owner_user_id !== account.id && !account.is_super_admin) {
    throw new Task14Error("只有创建者可以清空房间", 403, "forbidden");
  }
  await run(db, "DELETE FROM task14_room_messages WHERE room_id = ?1", [id]);
}

export async function createFileReservation(db, account, env, input) {
  await requireTemporaryEntitlement(db, account);
  const metadata = validateFileMetadata(input.file_name, input.mime_type, Number(input.size_bytes));
  const id = randomToken(24);
  const now = isoNow();
  const expiresAt = expiryValue(input.minutes ?? 60);
  const maxDownloads = safeInteger(input.max_downloads, 1, 100, 5, "最大下载次数");
  await consumeCreateQuota(db, account.id, metadata.sizeBytes);
  const objectKey = objectKeyFor(env?.WYJ_ENVIRONMENT, id);
  try {
    await run(db, `INSERT INTO task14_shares (
        id, owner_user_id, share_type, kind, r2_object_key, file_name, file_extension,
        mime_type, size_bytes, password_hash, created_at, updated_at, expires_at,
        max_downloads, destroy_after_download, state
      ) VALUES (?1, ?2, 'file', 'file', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12, 'uploading')`, [
      id, account.id, objectKey, metadata.fileName, metadata.extension, metadata.mimeType,
      metadata.sizeBytes, await passwordHash(input.password, env), now, expiresAt,
      maxDownloads, booleanInteger(input.destroy_after_download),
    ]);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("task14_user_storage_quota")) {
      throw new Task14Error("当前账户的临时文件存储已达到上限", 413, "temporary_user_storage_quota_exceeded");
    }
    if (message.includes("task14_global_storage_quota")) {
      throw new Task14Error("临时文件云存储暂时已满，请稍后重试", 503, "temporary_global_storage_quota_exceeded", true);
    }
    throw error;
  }
  return {
    id,
    upload_url: `/api/temporary/file/upload?id=${encodeURIComponent(id)}`,
    size_bytes: metadata.sizeBytes,
    expires_at: expiresAt,
    max_bytes: metadata.sizeLimit,
  };
}

async function validationBytes(storage, row) {
  const object = FULL_FILE_VALIDATION_EXTENSIONS.has(row.file_extension)
    ? await storage.get(row.r2_object_key)
    : await storage.get(row.r2_object_key, { range: { offset: 0, length: Math.min(4096, Number(row.size_bytes)) } });
  if (!object) throw new Task14Error("上传文件未写入云存储", 503, "temporary_upload_missing", true);
  return new Uint8Array(await object.arrayBuffer());
}

export async function uploadFileObject(db, storage, account, request, id) {
  await requireTemporaryEntitlement(db, account);
  const row = await shareRow(db, id, ["file"]);
  if (!row || row.owner_user_id !== account.id || row.state !== "uploading") {
    throw new Task14Error("上传任务不存在或已结束", 404, "temporary_upload_not_found");
  }
  if (isExpired(row)) {
    await removeFileShare(db, storage, row, "upload_expired");
    throw new Task14Error("上传任务已过期", 410, "temporary_upload_expired");
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (!Number.isInteger(declaredLength) || declaredLength !== Number(row.size_bytes)) {
    throw new Task14Error("上传文件大小与预留信息不一致", 400, "temporary_upload_size_mismatch");
  }
  const contentType = String(request.headers.get("Content-Type") || "").toLowerCase().split(";", 1)[0];
  if (contentType !== row.mime_type) {
    throw new Task14Error("上传文件类型与预留信息不一致", 400, "temporary_upload_mime_mismatch");
  }
  if (!request.body) throw new Task14Error("上传文件为空", 400, "file_empty");
  const bucket = requireStorage(storage);
  let uploaded;
  try {
    const putOptions = {
      httpMetadata: { contentType: row.mime_type, cacheControl: "private, no-store" },
      customMetadata: { task: "14", share: row.id },
    };
    if (typeof globalThis.FixedLengthStream === "function") {
      const fixed = new globalThis.FixedLengthStream(Number(row.size_bytes));
      const [putResult, pipeResult] = await Promise.allSettled([
        bucket.put(row.r2_object_key, fixed.readable, putOptions),
        request.body.pipeTo(fixed.writable),
      ]);
      if (pipeResult.status === "rejected") throw pipeResult.reason;
      if (putResult.status === "rejected") throw putResult.reason;
      uploaded = putResult.value;
    } else {
      // Miniflare's in-process binding does not expose FixedLengthStream. The
      // metadata limit still caps this compatibility path at 30 MiB.
      const bytes = await request.arrayBuffer();
      uploaded = await bucket.put(row.r2_object_key, bytes, putOptions);
    }
    if (!uploaded || Number(uploaded.size) !== Number(row.size_bytes)) {
      throw new Task14Error("上传文件大小校验失败", 400, "temporary_upload_size_mismatch");
    }
    const bytes = await validationBytes(bucket, row);
    if (!validateFileContent(row.file_extension, bytes)) {
      throw new Task14Error("文件内容与扩展名不匹配或格式无效", 400, "file_signature_invalid");
    }
    const updated = await first(db, `UPDATE task14_shares SET state = 'active', updated_at = ?2
      WHERE id = ?1 AND state = 'uploading' RETURNING *`, [row.id, isoNow()]);
    if (!updated) throw new Task14Error("上传任务状态已变化，请重试", 409, "temporary_upload_state_conflict");
    return filePayload(updated);
  } catch (error) {
    try { await bucket.delete(row.r2_object_key); } catch (_) { /* cleanup retries use metadata below */ }
    await run(db, `UPDATE task14_shares SET state = 'failed', deletion_reason = ?2,
      cleanup_retry_at = ?3, cleanup_attempts = cleanup_attempts + 1, updated_at = ?3 WHERE id = ?1`, [
      row.id, error instanceof Task14Error ? error.code : "temporary_upload_failed", isoNow(),
    ]).catch(() => undefined);
    throw error;
  }
}

export async function cancelFileReservation(db, storage, account, id) {
  const row = await shareRow(db, id, ["file"]);
  if (!row || (row.owner_user_id !== account.id && !account.is_super_admin)) {
    throw new Task14Error("上传任务不存在", 404, "temporary_upload_not_found");
  }
  await removeFileShare(db, storage, row, "owner_cancelled");
}

export async function authorizeFileDownload(db, storage, env, input) {
  const row = await shareRow(db, input.id, ["file"]);
  if (!row || await expireIfNeeded(db, storage, row) || row.state !== "active") {
    throw new Task14Error("文件不存在或已过期", 404, "share_not_found");
  }
  await checkPassword(row, input.password, env);
  if (!await requireStorage(storage).head(row.r2_object_key)) {
    await markCleanupFailure(db, row, "r2_object_missing");
    throw new Task14Error("临时文件内容暂时不可用", 503, "temporary_file_missing", true);
  }
  const token = randomToken(32);
  const digest = await grantTokenDigest(token);
  const now = isoNow();
  const expiresAt = isoNow(new Date(Math.min(
    Date.parse(row.expires_at), Date.now() + DOWNLOAD_GRANT_TTL_SECONDS * 1000,
  )));
  await requireDatabase(db).batch([
    db.prepare(`INSERT INTO task14_download_grants (
        token_digest, share_id, created_at, expires_at, state
      ) SELECT ?2, id, ?3, ?4, 'active' FROM task14_shares
      WHERE id = ?1 AND share_type = 'file' AND state = 'active'
        AND expires_at > ?3 AND download_count < max_downloads`)
      .bind(row.id, digest, now, expiresAt),
    db.prepare(`UPDATE task14_shares SET
        download_count = download_count + 1,
        state = CASE WHEN destroy_after_download = 1 OR download_count + 1 >= max_downloads
          THEN 'delete_pending' ELSE state END,
        deletion_reason = CASE WHEN destroy_after_download = 1 OR download_count + 1 >= max_downloads
          THEN 'download_limit' ELSE deletion_reason END,
        updated_at = ?3
      WHERE id = ?1 AND EXISTS (
        SELECT 1 FROM task14_download_grants WHERE token_digest = ?2 AND share_id = ?1
      )`).bind(row.id, digest, now),
  ]);
  const grant = await first(db, `SELECT share.*, grant.expires_at AS grant_expires_at
    FROM task14_download_grants AS grant
    JOIN task14_shares AS share ON share.id = grant.share_id
    WHERE grant.token_digest = ?1`, [digest]);
  if (!grant) throw new Task14Error("文件下载次数已用完", 410, "temporary_download_limit_reached");
  return {
    token,
    url: `/api/share/file/download?id=${encodeURIComponent(grant.id)}&grant=${encodeURIComponent(token)}`,
    expires_at: grant.grant_expires_at,
    file: filePayload(grant),
  };
}

async function releaseDownloadRequest(db, digest, requestId) {
  await run(db, `UPDATE task14_download_grants SET active_request_id = '',
    active_request_expires_at = '' WHERE token_digest = ?1 AND active_request_id = ?2`, [digest, requestId]);
}

async function finalizeFullDownload(db, storage, row, digest, requestId) {
  await run(db, `UPDATE task14_download_grants SET state = 'completed', completed_at = ?2,
    last_used_at = ?2, active_request_id = '', active_request_expires_at = ''
    WHERE token_digest = ?1 AND active_request_id = ?3`, [digest, isoNow(), requestId]);
  if (row.state === "delete_pending") await removeFileShare(db, storage, row, row.deletion_reason || "download_limit");
}

function streamWithCallbacks(body, onComplete, onCancel) {
  const reader = body.getReader();
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          if (cancelled) onCancel();
          else onComplete();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        if (!cancelled) controller.error(error);
        onCancel();
      }
    },
    async cancel(reason) {
      cancelled = true;
      try { await reader.cancel(reason); } finally { onCancel(); }
    },
  });
}

export async function streamFileDownload(context, id, token) {
  const db = requireDatabase(context.env.WYJ_DB);
  const storage = requireStorage(context.env.WYJ_STORAGE);
  const shareId = cleanId(id);
  const digest = await grantTokenDigest(token);
  const now = isoNow();
  const row = await first(db, `SELECT share.*, grant.state AS grant_state,
      grant.expires_at AS grant_expires_at
    FROM task14_download_grants AS grant
    JOIN task14_shares AS share ON share.id = grant.share_id
    WHERE grant.token_digest = ?1 AND grant.share_id = ?2
      AND grant.state IN ('active', 'completed') AND grant.expires_at > ?3
      AND share.state IN ('active', 'delete_pending')`, [digest, shareId, now]);
  if (!row) throw new Task14Error("下载授权无效或已过期", 403, "temporary_download_grant_invalid");
  const rangeHeader = context.request.headers.get("Range");
  const requestedRange = parseByteRange(rangeHeader, Number(row.size_bytes));
  const requestId = randomToken(18);
  const claimed = await first(db, `UPDATE task14_download_grants SET
      active_request_id = ?4, active_request_expires_at = expires_at
    WHERE token_digest = ?1 AND share_id = ?2
      AND state IN ('active', 'completed') AND expires_at > ?3
      AND (active_request_id = '' OR active_request_expires_at <= ?3)
    RETURNING token_digest`, [digest, shareId, now, requestId]);
  if (!claimed) {
    throw new Task14Error("该下载授权正在使用，请等待当前下载结束后重试", 409, "temporary_download_in_progress", true);
  }
  const options = requestedRange ? { range: requestedRange } : {};
  let object;
  try {
    object = await storage.get(row.r2_object_key, options);
  } catch (error) {
    await releaseDownloadRequest(db, digest, requestId).catch(() => undefined);
    throw error;
  }
  if (!object?.body) {
    await releaseDownloadRequest(db, digest, requestId).catch(() => undefined);
    await markCleanupFailure(db, row, "r2_object_missing");
    throw new Task14Error("临时文件内容暂时不可用", 503, "temporary_file_missing", true);
  }
  try {
    await run(db, `UPDATE task14_download_grants SET
        request_count = request_count + 1,
        range_request_count = range_request_count + ?2,
        last_used_at = ?3
      WHERE token_digest = ?1 AND active_request_id = ?4`, [digest, rangeHeader ? 1 : 0, now, requestId]);
  } catch (error) {
    await releaseDownloadRequest(db, digest, requestId).catch(() => undefined);
    throw error;
  }
  const headers = new Headers({
    "Content-Type": row.mime_type,
    "Content-Disposition": safeContentDisposition(row.file_name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  const length = parseRangeLength(object.range, Number(object.size || row.size_bytes));
  headers.set("Content-Length", String(length));
  if (requestedRange) {
    const start = requestedRange.offset;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${Number(row.size_bytes)}`);
  }
  let settled = false;
  const once = (callback) => {
    if (settled) return;
    settled = true;
    schedule(context, callback());
  };
  const fullResponse = !requestedRange;
  const body = streamWithCallbacks(
    object.body,
    () => once(() => fullResponse
      ? finalizeFullDownload(db, storage, row, digest, requestId)
      : releaseDownloadRequest(db, digest, requestId)),
    () => once(() => releaseDownloadRequest(db, digest, requestId)),
  );
  return new Response(body, { status: requestedRange ? 206 : 200, headers });
}

async function cleanupOne(db, storage, row, reason) {
  if (row.share_type === "file") return await removeFileShare(db, storage, row, reason);
  await removeNonFileShare(db, row, reason);
  return true;
}

export async function cleanupExpiredShares(db, storage, options = {}) {
  const limit = safeInteger(options.limit, 1, 500, CLEANUP_LIMIT, "清理数量");
  const now = isoNow();
  await run(db, `UPDATE task14_download_grants SET state = 'expired'
    WHERE expires_at <= ?1 AND state = 'active'`, [now]);
  await run(db, `DELETE FROM task14_download_grants
    WHERE expires_at <= ?1 AND state IN ('completed', 'expired', 'revoked')`, [now]);
  const rows = await all(db, `SELECT * FROM task14_shares
    WHERE expires_at <= ?1
       OR state = 'failed' AND (cleanup_retry_at = '' OR cleanup_retry_at <= ?1)
       OR state = 'delete_pending'
          AND (cleanup_retry_at = '' OR cleanup_retry_at <= ?1)
          AND NOT EXISTS (
            SELECT 1 FROM task14_download_grants AS grant
            WHERE grant.share_id = task14_shares.id
              AND ((grant.state = 'active' AND grant.expires_at > ?1)
                OR grant.active_request_expires_at > ?1)
          )
    ORDER BY expires_at ASC LIMIT ?2`, [now, limit]);
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (await cleanupOne(db, storage, row, isExpired(row) ? "expired" : row.deletion_reason || "cleanup")) removed += 1;
      else failed += 1;
    } catch (_) {
      failed += 1;
      await markCleanupFailure(db, row).catch(() => undefined);
    }
  }
  let orphanRemoved = 0;
  let orphanInspected = 0;
  if (options.scanOrphans && storage?.list) {
    const prefix = `temporary/v1/${String(options.environment || "development")}/files/`;
    let cursor;
    do {
      const page = await storage.list({ prefix, cursor, limit: Math.min(1000, limit) });
      for (const object of page.objects || []) {
        if (orphanInspected >= limit) break;
        orphanInspected += 1;
        const linked = await first(db, "SELECT id FROM task14_shares WHERE r2_object_key = ?1", [object.key]);
        const age = Date.now() - new Date(object.uploaded || 0).getTime();
        if (!linked && age > 60 * 60 * 1000) {
          await storage.delete(object.key);
          orphanRemoved += 1;
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && orphanInspected < limit);
  }
  return { inspected: rows.length, removed, failed, orphan_inspected: orphanInspected, orphan_removed: orphanRemoved };
}

export async function task14Counts(db) {
  const tableCount = async (table) => Number((await first(db, `SELECT COUNT(*) AS count FROM ${table}`))?.count || 0);
  const [shares, files, bytes, rooms, messages, grants, uploading, cleanupPending, orphanUsers] = await Promise.all([
    tableCount("task14_shares"),
    first(db, "SELECT COUNT(*) AS count FROM task14_shares WHERE share_type = 'file'"),
    first(db, "SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM task14_shares WHERE share_type = 'file'"),
    first(db, "SELECT COUNT(*) AS count FROM task14_shares WHERE share_type = 'room'"),
    tableCount("task14_room_messages"),
    tableCount("task14_download_grants"),
    first(db, "SELECT COUNT(*) AS count FROM task14_shares WHERE state = 'uploading'"),
    first(db, "SELECT COUNT(*) AS count FROM task14_shares WHERE state IN ('failed', 'delete_pending')"),
    first(db, `SELECT COUNT(*) AS count FROM task14_shares AS share
      LEFT JOIN task12_users AS users ON users.id = share.owner_user_id WHERE users.id IS NULL`),
  ]);
  return {
    shares, files: Number(files?.count || 0), file_bytes: Number(bytes?.bytes || 0),
    rooms: Number(rooms?.count || 0), messages, download_grants: grants,
    uploading: Number(uploading?.count || 0), cleanup_pending: Number(cleanupPending?.count || 0),
    orphaned_user_ids: Number(orphanUsers?.count || 0),
  };
}

export const __testing = Object.freeze({
  ACTIVE_STATES,
  all,
  checkPassword,
  consumeCreateQuota,
  first,
  removeFileShare,
  requireDatabase,
  requireStorage,
  requireTemporaryEntitlement,
  run,
  safeContentDisposition,
  parseByteRange,
  releaseDownloadRequest,
  streamWithCallbacks,
  task14Secret,
});
