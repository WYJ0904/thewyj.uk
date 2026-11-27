import { scanFileOrphans, pruneFileAudit, cleanupStorageBudget,enqueueMultipartAbort,retryMultipartAborts,beginMultipartAllocation } from './secure-file-cleanup.mjs';
import { sha256Hex } from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { sessionStorageKey } from "./task12-crypto.mjs";
import { downloadSessionTokenFromRequest } from "./task20-model.mjs";
import { hashTemporaryPassword, verifyTemporaryPassword } from "./task14-crypto.mjs";
import { accountMembershipState } from "./task13-service.mjs";
import {
  fileAuditStatement, inspectFileBytes, readBoundedBytes, requireObjectKey, fileSha256Hex,
  secureDownloadHeaders, isCanonicalObjectKey, HEADER_BYTES,
} from './secure-file-policy.mjs';
import {
  DOWNLOAD_GRANT_TTL_SECONDS,
  EXPIRY_MINUTES,
  FREE_STORAGE_LIMIT_BYTES,
  GUEST_DAILY_CREATE_LIMIT,
  GUEST_STORAGE_LIMIT_BYTES,
  MAX_FILE_COUNT_PER_SHARE,
  MAX_SHARE_BYTES,
  OWNER_STORAGE_LIMIT_BYTES,
  PART_SIZE_BYTES,
  TASK22_SCHEMA_VERSION,
  TOOLS_STORAGE_LIMIT_BYTES,
  Task22Error,
  UPLOAD_SESSION_TTL_MS,
  USER_DAILY_CREATE_LIMIT,
  cleanFileName,
  cleanGuestId,
  cleanId,
  cleanRelativePath,
  expiryMinutes,
  isoNow,
  normalizeMime,
  parseByteRange,
  partCountFor,
  partRange,
  partSizeFor,
  previewPolicyFor,
  randomToken,
  requireAllowedFields,
  safeContentDisposition,
  safeInteger,
  sessionPayload,
  sharePayload,
} from "./task22-model.mjs";

const CLEANUP_LIMIT = 250;
const PART_SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function requireDatabase(db) {
  if (!db?.prepare) throw new Task22Error("文件传输数据库暂时不可用", 503, "transfer_database_unavailable", true);
  return db;
}

function requireStorage(storage) {
  if (!storage?.get || !storage?.put || !storage?.delete) {
    throw new Task22Error("文件传输云存储暂时不可用", 503, "transfer_storage_unavailable", true);
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

function isExpired(row, now = Date.now()) {
  return !Number.isFinite(Date.parse(String(row?.expires_at || ""))) || Date.parse(row.expires_at) <= now;
}

function task22Secret(env) {
  return String(env?.WYJ_TASK14_TEMPORARY_SECRET || "");
}

async function passwordHash(password, env) {
  return await hashTemporaryPassword(password, task22Secret(env));
}

async function checkPassword(row, password, env) {
  if (!await verifyTemporaryPassword(password, String(row?.password_hash || ""), task22Secret(env))) {
    throw new Task22Error("访问密码错误", 403, "share_password_invalid");
  }
}

async function guestOwnerRef(guestId) {
  const digest = await sha256Hex(cleanGuestId(guestId));
  return `guest:${digest.slice(0, 40)}`;
}

async function ownerContext(db, account, input = {}) {
  if (account?.id) return { kind: "user", ref: String(account.id) };
  return { kind: "guest", ref: await guestOwnerRef(input.guest_id || "") };
}

async function entitlementSet(db, account) {
  if (account?.is_super_admin) return new Set(["owner"]);
  const membership = account?.id ? await accountMembershipState(db, account) : null;
  return new Set(Array.isArray(membership?.entitlements) ? membership.entitlements : []);
}

export async function storageLimitBytes(db, account, guestId = "") {
  if (account?.is_super_admin) return OWNER_STORAGE_LIMIT_BYTES;
  if (!account?.id) return GUEST_STORAGE_LIMIT_BYTES;
  const entitlements = await entitlementSet(db, account);
  if (entitlements.has("temporary_share_access") || entitlements.has("all_features_access")) {
    return TOOLS_STORAGE_LIMIT_BYTES;
  }
  return FREE_STORAGE_LIMIT_BYTES;
}

// Logical quota counts every file reference in every currently usable share.
// A download-limit reservation remains usable by its bounded existing grant.
function liveShareSql(alias, now) {
  return `${alias}.expires_at > ${now} AND (${alias}.state = 'active' OR
    (${alias}.state = 'delete_pending' AND ${alias}.deletion_reason = 'download_limit' AND EXISTS (
      SELECT 1 FROM task22_download_grants quota_grant WHERE quota_grant.share_id = ${alias}.id
        AND quota_grant.state IN ('active','completed') AND quota_grant.expires_at > ${now})))`;
}

async function quotaBytes(db, owner) {
  const now = isoNow();
  const [sessions, shares] = await Promise.all([
    first(db, `SELECT COALESCE(SUM(total_bytes), 0) AS bytes FROM task22_upload_sessions
      WHERE owner_kind = ?1 AND owner_ref = ?2 AND state = 'active' AND expires_at > ?3`,
    [owner.kind, owner.ref, now]),
    first(db, `SELECT COALESCE(SUM(file.size_bytes), 0) AS bytes FROM task22_share_files file
      JOIN task22_shares share ON share.id = file.share_id
      WHERE share.owner_kind = ?1 AND share.owner_ref = ?2 AND ${liveShareSql("share", "?3")}`,
    [owner.kind, owner.ref, now]),
  ]);
  const reservedBytes = Number(sessions?.bytes || 0);
  const storedBytes = Number(shares?.bytes || 0);
  return { stored_bytes: storedBytes, reserved_bytes: reservedBytes, used_bytes: storedBytes + reservedBytes };
}

async function activeBytes(db, owner) {
  return (await quotaBytes(db, owner)).used_bytes;
}


const ENVIRONMENT_SCOPES = Object.freeze(["production", "preview", "development"]);

function scopeFor(environment) {
  const value = String(environment || "").toLowerCase();
  return ENVIRONMENT_SCOPES.includes(value) ? value : "development";
}

function objectKeyFor(environment, fileId, partNumber) {
  return `transfers/v2/${scopeFor(environment)}/files/${fileId}/part-${partNumber}`;
}

/** One R2 object per uploaded file; parts are uploaded into this object. */
function fileObjectKeyFor(environment, fileId) {
  return `transfers/v2/${scopeFor(environment)}/objects/${fileId}/file`;
}

async function sessionRow(db, id) {
  return await first(db, "SELECT * FROM task22_upload_sessions WHERE id = ?1", [cleanId(id)]);
}

async function requireOwnedSession(db, account, owner, id) {
  const row = await sessionRow(db, id);
  if (!row || row.owner_kind !== owner.kind || row.owner_ref !== owner.ref) {
    throw new Task22Error("上传任务不存在", 404, "transfer_session_not_found");
  }
  return row;
}

async function fileRows(db, sessionId) {
  return await all(db, "SELECT * FROM task22_upload_files WHERE session_id = ?1 ORDER BY relative_path", [sessionId]);
}

async function partNumbers(db, sessionId, fileId) {
  const rows = await all(db, `SELECT part_number FROM task22_upload_parts
    WHERE session_id = ?1 AND file_id = ?2 ORDER BY part_number`, [sessionId, fileId]);
  return rows.map((row) => Number(row.part_number));
}

export async function ensureTask22Schema(db) {
  if (!db?.prepare) return false;
  try {
    const row = await first(db, "SELECT value FROM task22_metadata WHERE key = ?1", ["schema_version"]);
    return String(row?.value || "") === TASK22_SCHEMA_VERSION;
  } catch (_) {
    return false;
  }
}

export async function transferCapabilities(db, account, input = {}) {
  const schemaReady = await ensureTask22Schema(db);
  let owner;
  if (account?.id) owner = { kind: "user", ref: String(account.id) };
  else if (input?.guest_id) owner = { kind: "guest", ref: await guestOwnerRef(input.guest_id) };
  else owner = { kind: "guest", ref: "" };
  const limit = account?.is_super_admin ? OWNER_STORAGE_LIMIT_BYTES
    : account?.id ? await storageLimitBytes(db, account) : GUEST_STORAGE_LIMIT_BYTES;
  const usage = schemaReady && owner.ref ? await quotaBytes(db, owner)
    : { stored_bytes: 0, reserved_bytes: 0, used_bytes: 0 };
  return {
    task: 22,
    schema_version: TASK22_SCHEMA_VERSION,
    schema_ready: schemaReady,
    owner_kind: owner.kind,
    storage_limit_bytes: limit,
    ...usage,
    max_share_bytes: MAX_SHARE_BYTES,
    max_files_per_share: MAX_FILE_COUNT_PER_SHARE,
    part_size_bytes: PART_SIZE_BYTES,
    expiry_minutes: EXPIRY_MINUTES,
    authenticated: Boolean(account?.id),
  };
}

export async function createUploadSession(db, account, env, input) {
  requireAllowedFields(input, new Set([
    "guest_id", "password", "minutes", "max_downloads", "one_time", "file_count", "total_bytes", "access_scope", "idempotency_key",
  ]));
  const owner = await ownerContext(db, account, input);
  const accessScope = input.access_scope ?? 'share';
  if (!['share', 'private'].includes(accessScope) || (accessScope === 'private' && owner.kind !== 'user')) {
    throw new Task22Error('私有附件需要登录账户', 403, 'file_private_account_required');
  }
  const minutes = expiryMinutes(input.minutes, owner.kind);
  const maxDownloads = safeInteger(input.max_downloads, 1, 100, 5, "最大下载次数");
  const oneTime = Boolean(input.one_time);
  const fileCount = safeInteger(input.file_count || 1, 1, MAX_FILE_COUNT_PER_SHARE, 1, "文件数量");
  const totalBytes = safeInteger(input.total_bytes || 0, 0, MAX_SHARE_BYTES, 0, "总大小");
  const idempotencyKey=String(input.idempotency_key || '');
  if(idempotencyKey && !/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey))throw new Task22Error('上传请求标识无效',400,'file_idempotency_invalid');
  const replay=async()=>{
    if(!idempotencyKey)return null;
    const existing=await first(db,'SELECT * FROM task22_upload_sessions WHERE owner_kind=?1 AND owner_ref=?2 AND idempotency_key=?3',[owner.kind,owner.ref,idempotencyKey]);
    if(!existing)return null;
    if(Number(existing.minutes)!==minutes || Number(existing.max_downloads)!==maxDownloads || Boolean(existing.one_time)!==oneTime
      || Number(existing.file_count)!==fileCount || Number(existing.total_bytes)!==totalBytes || existing.access_scope!==accessScope) {
      throw new Task22Error('同一上传请求标识对应不同参数',409,'file_idempotency_conflict');
    }
    try{await checkPassword(existing,input.password,env);}catch(error){if(error.code!=='share_password_invalid')throw error;throw new Task22Error('同一上传请求标识对应不同参数',409,'file_idempotency_conflict');}
    if(!['active','published'].includes(existing.state) || (existing.state==='active' && isExpired(existing)))throw new Task22Error('原上传请求已失效，请使用新的请求标识',409,'file_idempotency_expired');
    return existing;
  };
  const previous=await replay();if(previous)return previous;
  const limit = await storageLimitBytes(db, account, input.guest_id);
  if (totalBytes + await activeBytes(db, owner) > limit) {
    throw new Task22Error("当前账户的文件存储配额不足", 413, "transfer_storage_quota_exceeded");
  }
  const id = randomToken(24);
  const now = isoNow();
  const expiresAt = isoNow(new Date(Date.now() + Math.min(
    UPLOAD_SESSION_TTL_MS,
    minutes * 60 * 1000,
  )));
  // One SQLite statement serializes the reservation with its quota predicate.
  // The existing session/share rows remain the only quota authority.
  const dailyLimit=owner.kind==='guest'?GUEST_DAILY_CREATE_LIMIT:USER_DAILY_CREATE_LIMIT;
  let result;
  try {result=await db.batch([db.prepare(`INSERT INTO task22_upload_sessions (
      id, owner_kind, owner_ref, state, file_count, total_bytes, password_hash,
      minutes, max_downloads, one_time, created_at, updated_at, expires_at, access_scope, idempotency_key
    ) SELECT ?1, ?2, ?3, 'active', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?13,?14
    WHERE ?5 + COALESCE((SELECT SUM(total_bytes) FROM task22_upload_sessions
      WHERE owner_kind=?2 AND owner_ref=?3 AND state='active' AND expires_at>?10),0)
      + COALESCE((SELECT SUM(f.size_bytes) FROM task22_share_files f JOIN task22_shares s ON s.id=f.share_id
        WHERE s.owner_kind=?2 AND s.owner_ref=?3 AND ${liveShareSql('s', '?10')}),0) <= ?12
      AND COALESCE((SELECT create_count FROM task22_usage_daily WHERE owner_ref=?3 AND usage_date=substr(?10,1,10)),0)<?15
    RETURNING *`).bind(
    id, owner.kind, owner.ref, fileCount, totalBytes,
    await passwordHash(input.password, env), minutes, maxDownloads, oneTime ? 1 : 0,
    now, expiresAt, limit, accessScope,idempotencyKey,dailyLimit,
  ),db.prepare(`INSERT INTO task22_usage_daily(owner_ref,usage_date,create_count,updated_at)
    SELECT ?1,substr(?2,1,10),1,?2 WHERE EXISTS(SELECT 1 FROM task22_upload_sessions WHERE id=?3)
    ON CONFLICT(owner_ref,usage_date) DO UPDATE SET create_count=create_count+1,updated_at=excluded.updated_at`).bind(owner.ref,now,id),
    fileAuditStatement(db,owner.ref,id,'upload_initialized','ok','task22_upload_sessions')]);}
  catch(error){const winner=await replay();if(winner)return winner;throw error;}
  const created=result[0]?.results?.[0];
  if (!created) {
    const quota=await first(db,'SELECT create_count FROM task22_usage_daily WHERE owner_ref=?1 AND usage_date=?2',[owner.ref,now.slice(0,10)]);
    if(Number(quota?.create_count || 0)>=dailyLimit)throw new Task22Error('今天创建的文件分享已达到上限',429,'transfer_daily_quota_exceeded');
    throw new Task22Error('当前账户的文件存储配额不足', 413, 'transfer_storage_quota_exceeded');
  }
  return created;
}

export async function allocateUploadFile(db, account, env, input) {
  const storage = env.WYJ_STORAGE;
  requireAllowedFields(input, new Set([
    "session_id", "guest_id", "file_id", "relative_path", "file_name", "mime_type", "size_bytes",
  ]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  if (session.state !== "active") throw new Task22Error("上传任务已结束", 409, "transfer_session_not_active");
  if (session.finalize_token) throw new Task22Error('上传任务正在校验完成，请稍后重试', 409, 'transfer_finalize_in_progress', true);
  if (isExpired(session)) {
    await expireSession(db, storage, session, "expired");
    throw new Task22Error("上传任务已过期", 410, "transfer_session_expired");
  }
  const fileId = cleanId(input.file_id, "文件标识");
  const relativePath = cleanRelativePath(input.relative_path);
  const fileName = cleanFileName(input.file_name);
  const mimeType = normalizeMime(input.mime_type);
  const sizeBytes = safeInteger(input.size_bytes, 1, MAX_SHARE_BYTES, undefined, "文件大小");
  const policy = previewPolicyFor(fileName, mimeType);
  const partSize = partSizeFor(sizeBytes);
  const count = partCountFor(sizeBytes, partSize);
  const files = await fileRows(db, session.id);
  const existing = await first(db, "SELECT * FROM task22_upload_files WHERE id = ?1", [fileId]);
  if (existing) {
    if (existing.session_id !== session.id) {
      throw new Task22Error("文件标识已被其他上传任务使用", 409, "transfer_file_id_conflict");
    }
    if (Number(existing.size_bytes) !== sizeBytes || existing.relative_path !== relativePath
      || existing.file_name !== fileName || existing.mime_type !== mimeType) {
      throw new Task22Error("文件标识与既有元数据冲突", 409, "transfer_file_id_conflict");
    }
    return existing;
  }
  if (files.length >= session.file_count) {
    throw new Task22Error("该任务的文件数量已用完", 409, "transfer_file_count_exceeded");
  }
  if (files.some((file) => file.relative_path === relativePath)) {
    throw new Task22Error("同一分享内存在重复路径", 409, "transfer_duplicate_path");
  }
  const sessionBytes = files.reduce((sum, file) => sum + Number(file.size_bytes), 0);
  if (sessionBytes + sizeBytes > Number(session.total_bytes)) {
    throw new Task22Error("任务总大小与声明不一致", 413, "transfer_session_size_exceeded");
  }
  const limit = await storageLimitBytes(db, account, input.guest_id);
  // The active session's declared bytes were already charged at creation;
  // only newly allocated bytes beyond that declaration need the limit check.
  const accountedBySession = Number(session.total_bytes || 0);
  const outsideBytes = await activeBytes(db, owner) - accountedBySession;
  if (sizeBytes + Math.max(0, outsideBytes) > limit) {
    throw new Task22Error("当前账户的文件存储配额不足", 413, "transfer_storage_quota_exceeded");
  }
  const now = isoNow();
  // Parts are uploaded straight into one R2 object so downloads can stream it
  // natively instead of being concatenated inside the Worker.
  const bucket = requireStorage(storage);
  const objectKey = fileObjectKeyFor(env?.WYJ_ENVIRONMENT, fileId);
  // Persist the external-operation intent before asking R2 to create an MPU.
  // A lost create acknowledgement must remain visible as recovery work.
  const allocationIntent=await beginMultipartAllocation(db,session.id,fileId,objectKey);
  const multipart = await bucket.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: mimeType, cacheControl: "private, no-store" },
    customMetadata: { task: "22", session: session.id, file: fileId },
  });
  if (!multipart?.uploadId) {
    throw new Task22Error("文件传输云存储暂时不可用", 503, "transfer_storage_unavailable", true);
  }
  try {
    await run(db,"UPDATE task28_multipart_cleanup SET upload_id=?2,intent_kind='abort' WHERE upload_id=?1",[allocationIntent,multipart.uploadId]);
    const inserted = await first(db, `INSERT INTO task22_upload_files (
        id, session_id, relative_path, file_name, mime_type, size_bytes, part_size,
        part_count, preview_policy, state, object_key, upload_id, created_at, updated_at
      ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'allocated', ?10, ?11, ?12, ?12
      FROM task22_upload_sessions s WHERE s.id=?2 AND s.state='active' AND s.finalize_token=''
        AND s.expires_at>?12
        AND (SELECT COUNT(*) FROM task22_upload_files WHERE session_id=?2) < s.file_count
        AND ?6 + COALESCE((SELECT SUM(size_bytes) FROM task22_upload_files WHERE session_id=?2),0) <= s.total_bytes
      RETURNING id`, [
      fileId, session.id, relativePath, fileName, mimeType, sizeBytes,
      partSize, count, policy.policy, objectKey, multipart.uploadId, now,
    ]);
    if (!inserted) throw new Task22Error('任务已变化或文件数量/大小超过预留，请刷新后重试', 409, 'transfer_allocation_conflict', true);
    await run(db,'DELETE FROM task28_multipart_cleanup WHERE upload_id=?1',[multipart.uploadId]);
  } catch (error) {
    const winner = await first(db, 'SELECT * FROM task22_upload_files WHERE id=?1', [fileId]);
    // The INSERT's acknowledgement can be lost after it commits. Do not abort
    // the very MPU that the committed row is about to return to the client.
    if (winner?.upload_id !== multipart.uploadId) {
      try {
        await multipart.abort();
        await run(db,'DELETE FROM task28_multipart_cleanup WHERE upload_id IN(?1,?2)',[multipart.uploadId,allocationIntent]);
      } catch (_) { await enqueueMultipartAbort(db,session.id,fileId,objectKey,multipart.uploadId); }
    }
    if (winner?.session_id === session.id && Number(winner.size_bytes) === sizeBytes
      && winner.relative_path === relativePath && winner.file_name === fileName && winner.mime_type === mimeType) return winner;
    throw error;
  }
  return await first(db, "SELECT * FROM task22_upload_files WHERE id = ?1", [fileId]);
}

export async function uploadPart(db, storage, account, request, sessionId, fileId, partNumberValue, environment = "development", guestId = "") {
  const owner = await ownerContext(db, account, { guest_id: guestId });
  const cleanSessionId = cleanId(sessionId);
  const cleanFileId = cleanId(fileId, "文件标识");
  const [sessionBatch, fileBatch] = await requireDatabase(db).batch([
    db.prepare("SELECT * FROM task22_upload_sessions WHERE id = ?1").bind(cleanSessionId),
    db.prepare("SELECT * FROM task22_upload_files WHERE session_id = ?1 AND id = ?2").bind(cleanSessionId, cleanFileId),
  ]);
  const session = sessionBatch?.results?.[0] || null;
  if (!session || session.owner_kind !== owner.kind || session.owner_ref !== owner.ref) {
    throw new Task22Error("上传任务不存在", 404, "transfer_session_not_found");
  }
  if (session.state !== "active") throw new Task22Error("上传任务已结束", 409, "transfer_session_not_active");
  if (session.finalize_token) throw new Task22Error('上传任务正在校验完成，请稍后重试', 409, 'transfer_finalize_in_progress', true);
  if (isExpired(session)) {
    await expireSession(db, storage, session, "expired");
    throw new Task22Error("上传任务已过期", 410, "transfer_session_expired");
  }
  const file = fileBatch?.results?.[0] || null;
  if (!file) throw new Task22Error("上传文件不存在", 404, "transfer_file_not_found");
  const partNumber = safeInteger(partNumberValue, 1, Number(file.part_count), undefined, "分片编号");
  const expected = partRange(partNumber, Number(file.part_size), Number(file.size_bytes));
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (!Number.isInteger(declaredLength) || declaredLength !== expected.length) {
    throw new Task22Error("分片大小与声明不一致", 400, "transfer_part_size_mismatch");
  }
  if (!request.body) throw new Task22Error("上传分片为空", 400, "transfer_part_empty");
  const sha256Header = String(request.headers.get("X-Part-Sha256") || "").trim().toLowerCase();
  if (sha256Header && !PART_SHA256_PATTERN.test(sha256Header)) {
    throw new Task22Error("分片校验值无效", 400, "transfer_part_hash_invalid");
  }
  // A part is bounded by the server's <=32 MiB plan. Never buffer the full file.
  const bytes = await readBoundedBytes(request, expected.length, expected.length);
  const actualHash = await fileSha256Hex(bytes);
  if (sha256Header && actualHash !== sha256Header) {
    throw new Task22Error('上传字节与分片 SHA-256 不一致，请重传', 400, 'transfer_part_hash_mismatch', true);
  }
  const inspection = partNumber === 1
    ? inspectFileBytes(file.file_name, file.mime_type, bytes, { complete: Number(file.part_count) === 1 }) : null;
  const bucket = requireStorage(storage);
  const objectKey = requireObjectKey(file.object_key || fileObjectKeyFor(environment, file.id), 'transfer', environment);
  const uploadId = String(file.upload_id || "");
  if (!uploadId) {
    throw new Task22Error("上传对象尚未初始化，请重新分配文件", 409, "transfer_upload_not_initialized");
  }
  const multipart = bucket.resumeMultipartUpload(objectKey, uploadId);
  // Reserve an immutable, server-verified digest before any R2 write in one batch.
  const [, existingBatch] = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO task22_upload_parts (
        session_id,file_id,part_number,size_bytes,sha256_hex,object_key,etag,uploaded_at,hash_verified
      ) SELECT ?1,?2,?3,?4,?5,?6,'',?7,1 FROM task22_upload_sessions
        WHERE id=?1 AND state='active' AND finalize_token='' AND expires_at>?7`)
      .bind(session.id, file.id, partNumber, expected.length, actualHash, objectKey, isoNow()),
    db.prepare(`SELECT * FROM task22_upload_parts
      WHERE session_id=?1 AND file_id=?2 AND part_number=?3`)
      .bind(session.id, file.id, partNumber),
  ]);
  const existing = existingBatch?.results?.[0] || null;
  if (!existing) throw new Task22Error('上传任务状态已变化',409,'transfer_session_not_active');
  if (existing.sha256_hex && existing.sha256_hex !== actualHash) {
    throw new Task22Error('同一分片重传内容不一致',409,'transfer_part_hash_conflict');
  }
  if (existing.etag) {
    // Old parts without a server proof remain honestly labelled legacy.
    return { part_number: partNumber, size_bytes: Number(existing.size_bytes), uploaded: true,
      hash_verified: Boolean(existing.hash_verified), sha256_hex: existing.sha256_hex || '' };
  }
  try {
    const uploadedPart = await multipart.uploadPart(partNumber, bytes.buffer);
    if (!uploadedPart?.etag) {
      throw new Task22Error("分片上传校验失败，请重试", 400, "transfer_part_size_mismatch", true);
    }
    const results = await db.batch([
      db.prepare(`UPDATE task22_upload_parts SET etag=?4,uploaded_at=?5
        WHERE session_id=?1 AND file_id=?2 AND part_number=?3 AND sha256_hex=?6
          AND EXISTS(SELECT 1 FROM task22_upload_sessions WHERE id=?1 AND state='active' AND finalize_token='')`)
        .bind(session.id,file.id,partNumber,String(uploadedPart.etag),isoNow(),actualHash),
      ...(inspection ? [db.prepare(`UPDATE task22_upload_files SET validation_status=?2,detected_mime=?3,preview_policy=?4,
        sha256_hex=?5, integrity_status=?6 WHERE id=?1 AND EXISTS(
          SELECT 1 FROM task22_upload_sessions WHERE id=task22_upload_files.session_id AND state='active' AND finalize_token='')`)
        .bind(file.id,inspection.validation_status,inspection.detected_mime,inspection.preview_policy,
          Number(file.part_count) === 1 ? actualHash : '',Number(file.part_count) === 1 ? 'full_sha256_verified' : 'partial_parts_verified')] : []),
    ]);
    if (!Number(results[0]?.meta?.changes)) throw new Task22Error('上传任务状态已变化',409,'transfer_session_not_active');
    return { part_number: partNumber, size_bytes: expected.length, uploaded: false, hash_verified: true, sha256_hex: actualHash };
  } catch (error) {
    const winner = await first(db, `SELECT * FROM task22_upload_parts
      WHERE session_id = ?1 AND file_id = ?2 AND part_number = ?3`, [session.id, file.id, partNumber]);
    if (winner?.etag && winner.sha256_hex === actualHash) {
      return { part_number: partNumber, size_bytes: expected.length, uploaded: true, hash_verified: Boolean(winner.hash_verified), sha256_hex: actualHash };
    }
    throw error;
  }
}

export async function uploadSessionState(db, account, input) {
  requireAllowedFields(input, new Set(["session_id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  const files = await fileRows(db, session.id);
  const parts = {};
  for (const file of files) {
    parts[file.id] = await partNumbers(db, session.id, file.id);
  }
  return sessionPayload(session, files, parts);
}

export async function listUploadSessions(db, account, input = {}) {
  const owner = await ownerContext(db, account, input);
  const rows = await all(db, `SELECT s.id, s.state, s.file_count, s.total_bytes,
      s.created_at, s.updated_at, s.expires_at,
      (SELECT COUNT(*) FROM task22_upload_files f WHERE f.session_id = s.id) AS allocated_files,
      (SELECT COALESCE(SUM(p.size_bytes), 0) FROM task22_upload_parts p
        WHERE p.session_id = s.id) AS uploaded_bytes
    FROM task22_upload_sessions s
    WHERE s.owner_kind = ?1 AND s.owner_ref = ?2 AND s.state = 'active'
      AND s.expires_at > ?3
    ORDER BY s.created_at DESC LIMIT 200`, [owner.kind, owner.ref, isoNow()]);
  return rows.map((row) => ({
    id: row.id,
    state: row.state,
    file_count: Number(row.file_count),
    total_bytes: Number(row.total_bytes),
    allocated_files: Number(row.allocated_files),
    uploaded_bytes: Number(row.uploaded_bytes),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  }));
}

export async function completeUploadSession(db, storage, account, env, input) {
  requireAllowedFields(input, new Set(["session_id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  if (session.state === "published" && session.share_id) {
    const share = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [session.share_id]);
    if (share && !isExpired(share) && !['revoked','deleted'].includes(share.state) && share.deletion_reason !== 'owner_revoked') {
      return sharePayload(share, await shareFileRows(db, share.id));
    }
  }
  if (session.state !== "active") throw new Task22Error("上传任务已结束", 409, "transfer_session_not_active");
  if (isExpired(session)) {
    await expireSession(db, storage, session, "expired");
    throw new Task22Error("上传任务已过期", 410, "transfer_session_expired");
  }
  const finalizeToken = randomToken(24);
  const claimTime = isoNow();
  const claimed = await first(db, `UPDATE task22_upload_sessions SET finalize_token=?2,finalize_until=?3
    WHERE id=?1 AND state='active' AND expires_at>?4 AND (finalize_token='' OR finalize_until<=?4)
    RETURNING id`, [session.id,finalizeToken,isoNow(new Date(Date.now()+10*60*1000)),claimTime]);
  if (!claimed) throw new Task22Error('上传正在校验或状态已变化，请稍后重试',409,'transfer_finalize_in_progress',true);
  try {
  const files = await fileRows(db, session.id);
  if (files.length !== Number(session.file_count)) {
    throw new Task22Error("上传文件数量与任务声明不一致", 409, "transfer_incomplete_upload");
  }
  let declaredBytes = 0;
  const fileParts = new Map();
  const allParts = await all(db, `SELECT * FROM task22_upload_parts
    WHERE session_id = ?1 ORDER BY file_id, part_number`, [session.id]);
  for (const part of allParts) {
    const key = String(part.file_id || "");
    if (!fileParts.has(key)) fileParts.set(key, []);
    fileParts.get(key).push(part);
  }
  for (const file of files) {
    declaredBytes += Number(file.size_bytes);
    const parts = fileParts.get(file.id) || [];
    if (parts.length !== Number(file.part_count)) {
      throw new Task22Error("仍有分片未上传完成", 409, "transfer_incomplete_upload");
    }
    let uploadedBytes = 0;
    for (const [index, part] of parts.entries()) {
      if (Number(part.part_number) !== index + 1) throw new Task22Error('分片序号不连续',409,'transfer_incomplete_upload');
      const expected = partRange(Number(part.part_number), Number(file.part_size), Number(file.size_bytes));
      if (Number(part.size_bytes) !== expected.length) {
        throw new Task22Error("分片大小校验失败", 409, "transfer_part_size_mismatch");
      }
      if (file.upload_id) {
        // Multipart files: the part lives inside the uploaded object and the
        // stored etag is required to complete it.
        if (!part.etag) {
          throw new Task22Error("分片内容缺失，请重传", 409, "transfer_part_missing");
        }
      } else {
        const head = await requireStorage(storage).head(requireObjectKey(part.object_key,'transfer',env?.WYJ_ENVIRONMENT));
        if (!head) {
          throw new Task22Error("分片内容缺失，请重传", 409, "transfer_part_missing");
        }
        if (Number(head.size) !== expected.length) {
          throw new Task22Error("分片内容长度与声明不一致", 409, "transfer_part_size_mismatch");
        }
      }
      uploadedBytes += Number(part.size_bytes);
    }
    if (uploadedBytes !== Number(file.size_bytes)) {
      throw new Task22Error("文件实际上传字节与声明不一致", 409, "transfer_incomplete_upload");
    }
  }
  if (declaredBytes !== Number(session.total_bytes)) {
    throw new Task22Error("上传总大小与任务声明不一致", 409, "transfer_incomplete_upload");
  }
  // Assemble each file into its single R2 object before anything is published, bounded parallel for multi-file batches.
  const bucket = requireStorage(storage);
  const finalizeOneFile = async (file) => {
    if (!file.upload_id) return;
    const objectKey = requireObjectKey(file.object_key || fileObjectKeyFor(env?.WYJ_ENVIRONMENT, file.id),'transfer',env?.WYJ_ENVIRONMENT);
    let head = await bucket.head(objectKey);
    // A previous R2 completion may have succeeded before a D1/network failure.
    // Reuse only the same session's object; never blindly re-complete an MPU.
    if (head && (head.customMetadata?.session !== session.id || head.customMetadata?.file !== file.id)) {
      throw new Task22Error('文件对象所有权校验失败',409,'transfer_object_conflict');
    }
    if (!head) {
      const completed = await bucket.resumeMultipartUpload(objectKey, file.upload_id).complete(
        (fileParts.get(file.id) || []).map((part) => ({
          partNumber: Number(part.part_number),
          etag: String(part.etag),
        })),
      );
      head = completed && Number.isFinite(Number(completed.size)) ? completed : await bucket.head(objectKey);
    }
    if (!head || Number(head.size) !== Number(file.size_bytes)) {
      throw new Task22Error("上传文件合并校验失败", 409, "transfer_file_size_mismatch");
    }
    if (!['content_verified','download_only'].includes(file.validation_status)) {
      const object = await storage.get(objectKey,{range:{offset:0,length:Math.min(HEADER_BYTES,Number(file.size_bytes))}});
      if (!object) throw new Task22Error('上传内容缺失',503,'transfer_file_missing',true);
      const inspection = inspectFileBytes(file.file_name,file.mime_type,new Uint8Array(await object.arrayBuffer()),{complete:Number(file.size_bytes)<=HEADER_BYTES});
      file.validation_status=inspection.validation_status;file.detected_mime=inspection.detected_mime;file.preview_policy=inspection.preview_policy;
    }
    const parts = fileParts.get(file.id) || [];
    file.integrity_status = parts.every(p=>Number(p.hash_verified)===1)
      ? (parts.length===1 ? 'full_sha256_verified' : 'parts_verified') : 'legacy_unverified';
    // Only a single, server-verified part is also a verified whole-file hash.
    file.sha256_hex = file.integrity_status === 'full_sha256_verified' ? parts[0].sha256_hex : '';
  };
  let finalizeIndex = 0;
  const finalizeWorkers = Array.from({ length: Math.min(6, Math.max(1, files.length)) }, async () => {
    while (finalizeIndex < files.length) {
      const idx = finalizeIndex++;
      await finalizeOneFile(files[idx]);
    }
  });
  await Promise.all(finalizeWorkers);
  const shareId = randomToken(24);
  const now = isoNow();
  const expiresAt = isoNow(new Date(Date.now() + Number(session.minutes) * 60 * 1000));
  const published = await requireDatabase(db).batch([
    db.prepare(`UPDATE task22_upload_sessions SET state='published',share_id=?2,completed_at=?3,updated_at=?3
      WHERE id=?1 AND state='active' AND finalize_token=?4 AND finalize_until>?3 AND expires_at>?3`)
      .bind(session.id,shareId,now,finalizeToken),
    db.prepare(`INSERT INTO task22_shares (
        id, owner_kind, owner_ref, password_hash, total_bytes, file_count,
        max_downloads, one_time, state, created_at, updated_at, expires_at, access_scope
      ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?9, ?10, ?11
        FROM task22_upload_sessions WHERE id=?12 AND state='published' AND share_id=?1 AND finalize_token=?13`).bind(
      shareId, owner.kind, owner.ref, session.password_hash, declaredBytes, files.length,
      session.max_downloads, session.one_time, now, expiresAt, session.access_scope || 'share',session.id,finalizeToken,
    ),
    ...files.map((file) => db.prepare(`INSERT INTO task22_share_files (
        share_id, file_id, relative_path, file_name, mime_type, size_bytes,
        part_size, part_count, sha256_hex, preview_policy, object_key, validation_status, detected_mime, integrity_status
      ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
        WHERE EXISTS(SELECT 1 FROM task22_shares WHERE id=?1)`).bind(
      shareId, file.id, file.relative_path, file.file_name, file.mime_type,
      file.size_bytes, file.part_size, file.part_count, file.sha256_hex, file.preview_policy,
      file.object_key || "",file.validation_status || 'legacy_unverified',file.detected_mime || '',file.integrity_status || 'legacy_unverified',
    )),
    db.prepare(`UPDATE task22_upload_files SET state = 'complete', updated_at = ?2,
      validation_status=(SELECT validation_status FROM task22_share_files WHERE share_id=?3 AND file_id=task22_upload_files.id),
      detected_mime=(SELECT detected_mime FROM task22_share_files WHERE share_id=?3 AND file_id=task22_upload_files.id),
      integrity_status=(SELECT integrity_status FROM task22_share_files WHERE share_id=?3 AND file_id=task22_upload_files.id),
      sha256_hex=(SELECT sha256_hex FROM task22_share_files WHERE share_id=?3 AND file_id=task22_upload_files.id)
      WHERE session_id = ?1 AND state = 'allocated' AND EXISTS(
        SELECT 1 FROM task22_upload_sessions WHERE id=?1 AND state='published' AND share_id=?3)`).bind(session.id, now,shareId),
    fileAuditStatement(db,owner.ref,shareId,'file_published','ok','task22_shares'),
  ]);
  if (!Number(published[0]?.meta?.changes)) throw new Task22Error('上传任务状态已变化，请刷新后重试',409,'transfer_finalize_conflict',true);
  const share = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [shareId]);
  return sharePayload(share, await shareFileRows(db, shareId));
  } finally {
    await run(db,"UPDATE task22_upload_sessions SET finalize_token='',finalize_until='' WHERE id=?1 AND finalize_token=?2",[session.id,finalizeToken]);
  }
}

export async function abortUploadSession(db, storage, account, input) {
  requireAllowedFields(input, new Set(["session_id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  if (session.state === "aborted" || session.state === "expired" || session.state === "failed") {
    return { id: session.id, state: session.state, no_change: true,
      cleanup_pending: session.cleanup_state === "pending" };
  }
  if (session.state === "published") throw new Task22Error("已完成的上传任务不能取消，请撤销分享", 409, "transfer_session_published");
  await expireSession(db, storage, session, "owner_aborted");
  const settled = await sessionRow(db, session.id);
  return { id: session.id, state: "aborted", cleanup_pending: settled?.cleanup_state === "pending" };
}

async function shareFileRows(db, shareId) {
  return await all(db, "SELECT * FROM task22_share_files WHERE share_id = ?1 ORDER BY relative_path", [shareId]);
}

export async function listShares(db, account, input = {}) {
  const owner = await ownerContext(db, account, input);
  const rows = await all(db, `SELECT share.* FROM task22_shares share WHERE owner_kind = ?1 AND owner_ref = ?2
    AND ${liveShareSql("share", "?3")} ORDER BY created_at DESC LIMIT 200`, [owner.kind, owner.ref, isoNow()]);
  const files = await all(db, `SELECT * FROM task22_share_files WHERE share_id IN
    (SELECT id FROM task22_shares WHERE owner_kind = ?1 AND owner_ref = ?2) ORDER BY relative_path`, [owner.kind, owner.ref]);
  const byShare = new Map();
  for (const file of files) {
    if (!byShare.has(file.share_id)) byShare.set(file.share_id, []);
    byShare.get(file.share_id).push(file);
  }
  return rows.map((row) => sharePayload(row, byShare.get(row.id) || []));
}

function requireShareAccess(row, account) {
  if (row?.access_scope === 'private' && (!account?.id || row.owner_kind !== 'user' || row.owner_ref !== String(account.id))) {
    throw new Task22Error('文件不存在或无权访问',404,'file_not_found');
  }
}

export async function shareMetadata(db, storage, env, input, account = null) {
  requireAllowedFields(input, new Set(["id", "password"]));
  const row = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [cleanId(input.id)]);
  requireShareAccess(row,account);
  if (!row || await expireShare(db, storage, row)) {
    throw new Task22Error("分享不存在或已过期", 404, "share_not_found");
  }
  if (row.state === "revoked") throw new Task22Error("分享已被撤销", 410, "share_revoked");
  if (row.state === "deleted") throw new Task22Error("分享已终结", 404, "share_not_found");
  if (row.deletion_reason === "owner_revoked") throw new Task22Error("分享已被撤销", 410, "share_revoked");
  await checkPassword(row, input.password, env);
  return sharePayload(row, await shareFileRows(db, row.id));
}

async function resolveGrantSessionBinding(db, accountId, sessionToken) {
  const raw = String(sessionToken || "").trim();
  if (!raw) throw new Task22Error("请先登录有效账户", 401, "authentication_required");
  const digest = await sessionStorageKey(raw);
  const now = isoNow();
  try {
    const device = await first(db, `SELECT d.id
      FROM task20_device_sessions AS d
      JOIN task12_users AS u ON u.id = d.user_id
      WHERE d.access_token_digest = ?1 AND d.user_id = ?2 AND d.revoked = 0
        AND d.refresh_expires_at > ?3 AND d.session_version = u.session_version
        AND u.deleted = 0 AND u.banned = 0`, [digest, String(accountId), now]);
    if (device?.id) return `device:${device.id}`;
  } catch (error) {
    if (!/no such table:\s*task20_device_sessions/i.test(String(error?.message || error || ""))) throw error;
  }
  const web = await first(db, `SELECT s.token_digest
    FROM task12_sessions AS s
    JOIN task12_users AS u ON u.id = s.user_id
    WHERE s.token_digest = ?1 AND s.user_id = ?2 AND s.revoked = 0
      AND s.expires_at > ?3 AND s.session_version = u.session_version
      AND u.deleted = 0 AND u.banned = 0`, [digest, String(accountId), now]);
  if (!web?.token_digest) {
    throw new Task22Error("登录会话已失效，请重新登录", 401, "canonical_session_invalid");
  }
  return `web:${digest}`;
}

export async function authorizeShareDownload(db, storage, env, input, account = null, options = {}) {
  requireAllowedFields(input, new Set(["id", "password", "file_id"]));
  const row = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [cleanId(input.id)]);
  requireShareAccess(row,account);
  if (!row || await expireShare(db, storage, row) || row.state !== "active") {
    throw new Task22Error("分享不存在或已过期", 404, "share_not_found");
  }
  await checkPassword(row, input.password, env);
  const fileId = input.file_id ? cleanId(input.file_id,'文件标识') : '';
  if (row.access_scope === 'private' && !fileId) throw new Task22Error('请选择要访问的附件',400,'file_grant_scope_required');
  const sessionBinding = row.access_scope === 'private'
    ? await resolveGrantSessionBinding(db, account.id, options.sessionToken)
    : '';
  const files = await shareFileRows(db,row.id);
  if (fileId && !files.some(f=>f.file_id===fileId)) throw new Task22Error('文件不存在',404,'file_not_found');
  // A file-scoped authorization checks that object before consuming a count.
  // The legacy whole-share grant must not make up to 500 R2 HEAD subrequests;
  // each file is checked when it is actually streamed, as in the old contract.
  const scopedFiles=fileId?files.filter(f=>f.file_id===fileId):files.length===1?files:[];
  for (const file of scopedFiles) {
    if (file.object_key) {
      const head = await requireStorage(storage).head(requireObjectKey(file.object_key,'transfer',env?.WYJ_ENVIRONMENT));
      if (!head || Number(head.size)!==Number(file.size_bytes)) throw new Task22Error('文件内容暂不可用',503,'transfer_file_missing',true);
    }
  }
  if (Number(row.download_count) >= Number(row.max_downloads)) {
    throw new Task22Error("分享下载次数已用完", 410, "transfer_download_limit_reached");
  }
  const token = randomToken(32);
  const digest = await sha256Hex(token);
  const now = isoNow();
  const expiresAt = isoNow(new Date(Math.min(
    Date.parse(row.expires_at), Date.now() + DOWNLOAD_GRANT_TTL_SECONDS * 1000,
  )));
  await requireDatabase(db).batch([
    db.prepare(`INSERT INTO task22_download_grants (
        token_digest, share_id, created_at, expires_at, state, file_id, session_binding
      ) SELECT ?2, id, ?3, ?4, 'active', ?5, ?6 FROM task22_shares
      WHERE id = ?1 AND state = 'active' AND expires_at > ?3 AND download_count < max_downloads`)
      .bind(row.id, digest, now, expiresAt, fileId, sessionBinding),
    db.prepare(`UPDATE task22_shares SET
        download_count = download_count + 1,
        state = CASE WHEN one_time = 1 OR download_count + 1 >= max_downloads
          THEN 'delete_pending' ELSE state END,
        deletion_reason = CASE WHEN one_time = 1 OR download_count + 1 >= max_downloads
          THEN 'download_limit' ELSE deletion_reason END,
        updated_at = ?2
      WHERE id = ?1 AND state = 'active' AND EXISTS(
        SELECT 1 FROM task22_download_grants WHERE token_digest=?3 AND share_id=?1)`)
      .bind(row.id, now,digest),
    fileAuditStatement(db,account?.id || 'guest',row.id,'download_authorized','ok','task22_download_grants',digest),
  ]);
  const grant = await first(db, "SELECT * FROM task22_download_grants WHERE token_digest = ?1", [digest]);
  if (!grant) throw new Task22Error("分享下载次数已用完", 410, "transfer_download_limit_reached");
  return {
    token,
    expires_at: grant.expires_at,
    share: sharePayload(await first(db,'SELECT * FROM task22_shares WHERE id=?1',[row.id]),files.filter(f=>!fileId || f.file_id===fileId)),
  };
}

async function releaseDownloadRequest(db, digest, requestId) {
  await run(db, `UPDATE task22_download_grants SET active_request_id = '',
    active_request_expires_at = '' WHERE token_digest = ?1 AND active_request_id = ?2`, [digest, requestId]);
}

async function finalizeDownload(db, digest, requestId) {
  await run(db, `UPDATE task22_download_grants SET state = 'completed', completed_at = ?2,
    last_used_at = ?2, active_request_id = '', active_request_expires_at = ''
    WHERE token_digest = ?1 AND active_request_id = ?3`, [digest, isoNow(), requestId]);
  // The existing grant still covers retries and the other files in the share.
  // Scheduled cleanup removes the share after this bounded grant expires.
}

async function finalizeSingleObjectDownload(db, row, digest) {
  const now = isoNow();
  await run(db, `UPDATE task22_download_grants SET state = 'completed', completed_at = ?2,
    last_used_at = ?2 WHERE token_digest = ?1 AND share_id = ?3
      AND state IN ('active', 'completed')`, [digest, now, row.id]);
  // A small initial WebView GET can finish before DownloadListener hands the
  // URL to the native downloader. Keep its grant/files valid through the TTL.
}

/** Observe the native stream pump only after every byte reaches the response. */
function completedSingleObjectBody(context, body, length, onComplete) {
  // Workers derives wire Content-Length from the stream's native length.
  // An ordinary identity TransformStream makes the response chunked even when
  // the manually supplied header contains the correct object size.
  const { readable, writable } = typeof FixedLengthStream === "function"
    ? new FixedLengthStream(length) : new TransformStream();
  const completion = body.pipeTo(writable).then(onComplete).catch(() => undefined);
  if (typeof context.waitUntil === "function") context.waitUntil(completion);
  else void completion;
  return readable;
}

/**
 * Streams the requested window across the uploaded parts without ever running
 * JavaScript per chunk. The response body is the readable half of an identity
 * TransformStream; each part body is handed over with `pipeTo`, which the
 * runtime pumps natively. A `pull`-driven JavaScript ReadableStream costs CPU
 * per chunk and is killed by the Workers CPU limit mid-response (observed as
 * silently truncated downloads), so the pump must stay outside JS.
 */
function concatenatedParts(storage, parts, offset = 0, length = null, onComplete = null, onCancel = null) {
  let remaining = length === null ? Number.POSITIVE_INFINITY : Number(length);
  let settled = false;
  const once = (callback) => {
    if (settled || !callback) return;
    settled = true;
    callback();
  };
  const { readable, writable } = new TransformStream();
  void (async () => {
    let skipped = 0;
    try {
      for (const part of parts) {
        if (remaining <= 0) break;
        const partSize = Number(part.size_bytes);
        if (skipped + partSize <= Number(offset)) {
          skipped += partSize;
          continue;
        }
        const localOffset = Math.max(0, Number(offset) - skipped);
        const available = partSize - localOffset;
        skipped += partSize;
        if (available <= 0) continue;
        const take = Math.min(remaining, available);
        const object = await storage.get(part.object_key, { range: { offset: localOffset, length: take } });
        if (!object?.body) throw new Task22Error("分享文件内容缺失", 503, "transfer_file_missing", true);
        if (typeof object.body.pipeTo === "function") {
          await object.body.pipeTo(writable, { preventClose: true });
        } else {
          // Test runtimes expose the object only as a buffer.
          const bytes = new Uint8Array(await object.arrayBuffer());
          const writer = writable.getWriter();
          try { await writer.write(bytes); } finally { writer.releaseLock(); }
        }
        remaining -= take;
      }
      const writer = writable.getWriter();
      try { await writer.close(); } finally { writer.releaseLock(); }
      once(onComplete);
    } catch (error) {
      try {
        const writer = writable.getWriter();
        try { await writer.abort(error); } finally { writer.releaseLock(); }
      } catch (_) { /* stream already closed or aborted */ }
      once(onCancel);
    }
  })();
  return readable;
}

export async function streamFileDownload(context, shareIdValue, fileIdValue, token) {
  const db = requireDatabase(context.env.WYJ_DB);
  const storage = requireStorage(context.env.WYJ_STORAGE);
  const shareId = cleanId(shareIdValue);
  const fileId = cleanId(fileIdValue, "文件标识");
  const digest = await sha256Hex(token);
  const now = isoNow();
  const row = await first(db, `SELECT share.*, grant.state AS grant_state, grant.expires_at AS grant_expires_at,
      grant.session_binding AS grant_session_binding
    FROM task22_download_grants AS grant
    JOIN task22_shares AS share ON share.id = grant.share_id
    WHERE grant.token_digest = ?1 AND grant.share_id = ?2
      AND grant.state IN ('active', 'completed') AND grant.expires_at > ?3
      AND (grant.file_id='' OR grant.file_id=?4)
      AND (share.access_scope='share' OR grant.file_id=?4)
      AND share.state IN ('active', 'delete_pending') AND share.deletion_reason != 'owner_revoked'
      AND share.expires_at > ?3`, [digest, shareId, now,fileId]);
  if (!row) throw new Task22Error("下载授权无效或已过期", 403, "transfer_download_grant_invalid");
  if (row.access_scope === 'private') {
    const sessionToken = downloadSessionTokenFromRequest(context.request);
    const auth = await resolveTask12Account(context, { token: sessionToken });
    if (!auth.authenticated) {
      throw new Task22Error("请先登录有效账户后再访问私有附件", auth.status || 401, auth.code || "authentication_required");
    }
    if (row.owner_kind !== 'user' || row.owner_ref !== String(auth.account.id)) {
      throw new Task22Error("无权访问该私有附件", 403, "file_access_denied");
    }
    const callerBinding = await resolveGrantSessionBinding(db, auth.account.id, sessionToken);
    if (!row.grant_session_binding || row.grant_session_binding !== callerBinding) {
      throw new Task22Error("下载授权已因会话变更失效，请重新获取下载授权", 403, "transfer_download_grant_invalid");
    }
  }
  const file = await first(db, "SELECT * FROM task22_share_files WHERE share_id = ?1 AND file_id = ?2", [shareId, fileId]);
  if (!file) throw new Task22Error("分享文件不存在", 404, "transfer_share_file_not_found");
  const totalBytes = Number(file.size_bytes);
  const singleObject = file.object_key ? requireObjectKey(file.object_key,'transfer',context.env.WYJ_ENVIRONMENT) : '';
  const parts = singleObject ? [] : await all(db, `SELECT * FROM task22_upload_parts
    WHERE file_id = ?1 ORDER BY part_number`, [fileId]);
  if (!singleObject && parts.length !== Number(file.part_count)) {
    throw new Task22Error("分享文件内容不完整", 503, "transfer_file_missing", true);
  }
  for (const part of parts) requireObjectKey(part.object_key,'transfer',context.env.WYJ_ENVIRONMENT);
  const requestedRange = parseByteRange(context.request.headers.get("Range"), totalBytes);
  const requestId = randomToken(18);
  const claimed = await first(db, `UPDATE task22_download_grants SET
      active_request_id = ?4, active_request_expires_at = expires_at
    WHERE token_digest = ?1 AND share_id = ?2
      AND state IN ('active', 'completed') AND expires_at > ?3
      AND (active_request_id = '' OR active_request_expires_at <= ?3)
    RETURNING token_digest`, [digest, shareId, now, requestId]);
  if (!claimed) {
    throw new Task22Error("该下载授权正在使用，请等待当前下载结束后重试", 409, "transfer_download_in_progress", true);
  }
  try {
    await run(db, `UPDATE task22_download_grants SET
        request_count = request_count + 1,
        range_request_count = range_request_count + ?2,
        last_used_at = ?3
      WHERE token_digest = ?1 AND active_request_id = ?4`, [digest, requestedRange ? 1 : 0, now, requestId]);
  } catch (error) {
    await releaseDownloadRequest(db, digest, requestId).catch(() => undefined);
    throw error;
  }
  const headers = secureDownloadHeaders(file);
  const length = requestedRange ? requestedRange.length : totalBytes;
  headers.set("Content-Length", String(length));
  if (requestedRange) {
    const start = requestedRange.offset;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${totalBytes}`);
  }
  const fullResponse = !requestedRange;
  if (singleObject) {
    // The uploaded file is one R2 object: hand the body to the client as-is so
    // the runtime streams it natively (a JavaScript pump is killed by the
    // Workers CPU limit and truncates large downloads).
    await releaseDownloadRequest(db, digest, requestId);
    const object = requestedRange
      ? await storage.get(singleObject, { range: { offset: requestedRange.offset, length: requestedRange.length } })
      : await storage.get(singleObject);
    if (!object?.body) throw new Task22Error("下载数据暂时不可用", 503, "transfer_file_missing", true);
    if (Number(object.size)!==totalBytes) { await object.body.cancel().catch(()=>undefined); throw new Task22Error('文件大小校验失败',503,'transfer_file_missing',true); }
    const body = fullResponse
      ? completedSingleObjectBody(context, object.body, totalBytes,
        () => finalizeSingleObjectDownload(db, row, digest))
      : object.body;
    return new Response(body, { status: requestedRange ? 206 : 200, headers });
  }
  const body = concatenatedParts(
    storage,
    parts,
    requestedRange?.offset || 0,
    requestedRange?.length ?? null,
    fullResponse
      ? () => void finalizeDownload(db, digest, requestId).catch(() => undefined)
      : () => void releaseDownloadRequest(db, digest, requestId).catch(() => undefined),
    () => void releaseDownloadRequest(db, digest, requestId).catch(() => undefined),
  );
  return new Response(body, { status: requestedRange ? 206 : 200, headers });
}

async function expireSession(db, storage, session, reason) {
  const targetState = reason === "owner_aborted" ? "aborted" : "expired";
  const now = isoNow();
  const claimed = await first(db, `UPDATE task22_upload_sessions SET state = ?2, deleted_at = ?3,
    updated_at = ?3, cleanup_state = 'pending', cleanup_retry_at = '', cleanup_completed_at = ''
    WHERE id = ?1 AND state = 'active' AND (finalize_token='' OR finalize_until<=?3) RETURNING id`, [session.id, targetState, now]);
  if (!claimed) throw new Task22Error('上传正在校验或状态已变化，请刷新后重试',409,'transfer_finalize_in_progress',true);
  return await deleteSessionObjects(db, storage, session.id);
}

function multipartAlreadyGone(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return status === 404 || /NoSuchUpload|upload.*not found|upload.*does not exist/i
    .test(String(error?.code || error?.message || ""));
}

async function retrySessionCleanupLater(db, sessionId) {
  const retryAt = isoNow(new Date(Date.now() + 30 * 60 * 1000));
  await run(db, `UPDATE task22_upload_sessions SET cleanup_state = 'pending',
    cleanup_attempts = cleanup_attempts + 1, cleanup_retry_at = ?2, updated_at = ?3
    WHERE id = ?1 AND state IN ('aborted', 'expired', 'failed')`, [sessionId, retryAt, isoNow()]);
}

/**
 * Releases every R2 resource of an unfinished session: the in-progress
 * multipart upload, the merged object (if it already completed) and any legacy
 * per-part objects.
 */
async function deleteSessionObjects(db, storage, sessionId) {
  const session=await sessionRow(db,sessionId);
  if(!session || !['aborted','expired','failed'].includes(session.state))return false;
  let bucket;
  try { bucket=requireStorage(storage); if(bucket.cleanupRemaining===undefined)bucket=cleanupStorageBudget(bucket); }
  catch {await retrySessionCleanupLater(db,sessionId);return false;}
  let progress;try{progress=JSON.parse(session.cleanup_progress || '{}');}catch{progress={};}
  const save=()=>run(db,'UPDATE task22_upload_sessions SET cleanup_progress=?2 WHERE id=?1',[sessionId,JSON.stringify(progress)]);
  try {
    const files=await all(db,`SELECT id,object_key,upload_id FROM task22_upload_files
      WHERE session_id=?1 AND id>?2 ORDER BY id`,[sessionId,String(progress.last_file || '')]);
    for(const file of files) {
      if(file.object_key)requireObjectKey(file.object_key,'transfer');
      if(file.object_key && file.upload_id)try{await bucket.resumeMultipartUpload(file.object_key,file.upload_id).abort();}
      catch(error){if(!multipartAlreadyGone(error))throw error;}
      progress.last_file=file.id;await save();
    }
    const keys=await all(db,`SELECT object_key FROM task22_upload_files WHERE session_id=?1 AND object_key!='' AND object_key>?2
      UNION SELECT object_key FROM task22_upload_parts WHERE session_id=?1 AND object_key>?2 ORDER BY object_key`,
    [sessionId,String(progress.last_key || '')]);
    for(const {object_key:key}of keys) {
      requireObjectKey(key,'transfer');
      const referenced=await first(db,`SELECT 1 AS present FROM task22_share_files WHERE object_key=?1 OR file_id IN(
        SELECT file_id FROM task22_upload_parts WHERE object_key=?1) LIMIT 1`,[key]);
      if(referenced)throw new Task22Error('清理对象仍被分享引用',409,'transfer_cleanup_referenced',true);
      await bucket.delete(key);progress.last_key=key;await save();
    }
    const now=isoNow();
    await db.batch([
      db.prepare('DELETE FROM task22_upload_parts WHERE session_id=?1').bind(sessionId),
      db.prepare(`UPDATE task22_upload_sessions SET cleanup_state='complete',cleanup_retry_at='',cleanup_completed_at=?2,
        updated_at=?2 WHERE id=?1 AND state IN ('aborted','expired','failed')`).bind(sessionId,now),
      fileAuditStatement(db,session.owner_ref,sessionId,'upload_cleaned'),
    ]);
    return true;
  } catch {await retrySessionCleanupLater(db,sessionId);return false;}
}

export async function revokeShare(db, storage, account, input) {
  requireAllowedFields(input, new Set(["id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const row = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [cleanId(input.id)]);
  if (!row) throw new Task22Error("分享不存在", 404, "share_not_found");
  if (row.owner_kind !== owner.kind || row.owner_ref !== owner.ref) {
    throw new Task22Error("只有创建者可以撤销分享", 403, "forbidden");
  }
  if (row.state === "revoked" || (row.state === "deleted" && row.deletion_reason === "owner_revoked")) {
    return { id: row.id, state: "revoked", no_change: true,cleanup_pending:row.state!=='deleted' };
  }
  // Invalidate the public link and all bearer grants before touching R2. A
  // storage failure must never leave a revoked file downloadable.
  await db.batch([
    db.prepare("UPDATE task22_shares SET state='revoked', deletion_reason='owner_revoked', updated_at=?2 WHERE id=?1")
      .bind(row.id, isoNow()),
    db.prepare("UPDATE task22_download_grants SET state='revoked', active_request_id='', active_request_expires_at='' WHERE share_id=?1")
      .bind(row.id),
    fileAuditStatement(db,owner.ref,row.id,'file_revoked'),
  ]);
  const cleaned = await removeShare(db, storage, { ...row, state: "revoked" }, "owner_revoked");
  return { id: row.id, state: "revoked", cleanup_pending: !cleaned };
}

async function removeShare(db, storage, row, reason) {
  const now=isoNow(),nextState=row.state==='revoked'?'revoked':'delete_pending';
  const current=await first(db,`UPDATE task22_shares SET state=?2,deletion_reason=?3,updated_at=?4
    WHERE id=?1 AND state!='deleted' RETURNING *`,[row.id,nextState,reason,now]);
  if(!current)return true;
  let progress;try{progress=JSON.parse(current.cleanup_progress || '{}');}catch{progress={};}
  let bucket=requireStorage(storage);if(bucket.cleanupRemaining===undefined)bucket=cleanupStorageBudget(bucket);
  try {
    const keys=await all(db,`SELECT object_key FROM task22_share_files WHERE share_id=?1 AND object_key!='' AND object_key>?2
      UNION SELECT object_key FROM task22_upload_parts WHERE file_id IN(SELECT file_id FROM task22_share_files WHERE share_id=?1)
        AND object_key>?2 ORDER BY object_key`,[row.id,String(progress.last_key || '')]);
    for(const {object_key:key}of keys) {
      requireObjectKey(key,'transfer');
      const other=await first(db,`SELECT 1 AS present FROM task22_share_files sf JOIN task22_shares share ON share.id=sf.share_id
        WHERE share.id!=?1 AND (sf.object_key=?2 OR sf.file_id IN(SELECT file_id FROM task22_upload_parts WHERE object_key=?2))
          AND ${liveShareSql('share','?3')} LIMIT 1`,[row.id,key,now]);
      if(!other)await bucket.delete(key);
      progress.last_key=key;
      await run(db,'UPDATE task22_shares SET cleanup_progress=?2 WHERE id=?1',[row.id,JSON.stringify(progress)]);
    }
    await db.batch([
      db.prepare(`DELETE FROM task22_upload_parts WHERE file_id IN(SELECT file_id FROM task22_share_files WHERE share_id=?1)
        AND NOT EXISTS(SELECT 1 FROM task22_share_files sf WHERE sf.file_id=task22_upload_parts.file_id AND sf.share_id!=?1)`).bind(row.id),
      db.prepare('DELETE FROM task22_share_files WHERE share_id=?1').bind(row.id),
      db.prepare("UPDATE task22_shares SET state='deleted',updated_at=?2,deleted_at=?2,cleanup_retry_at='' WHERE id=?1").bind(row.id,now),
      fileAuditStatement(db,row.owner_ref,row.id,'file_cleaned'),
    ]);
    return true;
  } catch {
    await run(db,`UPDATE task22_shares SET cleanup_attempts=cleanup_attempts+1,cleanup_retry_at=?2,updated_at=?3 WHERE id=?1`,
      [row.id,isoNow(new Date(Date.now()+1800000)),now]);
    return false;
  }
}

async function expireShare(db, storage, row) {
  if (!row || !isExpired(row)) return false;
  await removeShare(db, storage, row, "expired");
  return true;
}

export async function cleanupExpiredTransfers(db, storage, options = {}) {
  const limit = safeInteger(options.limit, 1, 500, CLEANUP_LIMIT, "清理数量");
  if(!storage?.delete)throw new Task22Error('文件清理存储暂时不可用',503,'transfer_storage_unavailable',true);
  storage=cleanupStorageBudget(storage,safeInteger(options.objectBudget,1,80,40,'对象操作预算'));
  const now = isoNow();
  await run(db, `UPDATE task22_download_grants SET state = 'expired'
    WHERE rowid IN(SELECT rowid FROM task22_download_grants WHERE expires_at<=?1 AND state='active' ORDER BY expires_at LIMIT ?2)`, [now,limit]);
  await run(db, `DELETE FROM task22_download_grants
    WHERE rowid IN(SELECT rowid FROM task22_download_grants WHERE expires_at<=?1 AND state IN('completed','expired','revoked') ORDER BY expires_at LIMIT ?2)`, [now,limit]);
  const orphanShareFiles = await run(db, `DELETE FROM task22_share_files WHERE rowid IN(
    SELECT rowid FROM task22_share_files WHERE NOT EXISTS (SELECT 1 FROM task22_shares s WHERE s.id = task22_share_files.share_id)
      AND NOT EXISTS (SELECT 1 FROM task22_download_grants g
        WHERE g.share_id = task22_share_files.share_id AND g.state = 'active' AND g.expires_at > ?1) LIMIT ?2)`, [now,limit]);
  const multipartCleanup=await retryMultipartAborts(db,storage,limit);
  const sessions = await all(db, `SELECT * FROM task22_upload_sessions
    WHERE state = 'active' AND expires_at <= ?1 ORDER BY expires_at ASC LIMIT ?2`, [now, limit]);
  let sessionsRemoved = 0;
  let sessionsCleanupPending = 0;
  for (const session of sessions) {
    if(storage.cleanupRemaining===0)break;
    try {
      if (!await expireSession(db, storage, session, "expired")) sessionsCleanupPending += 1;
      sessionsRemoved += 1;
    } catch (_) {
      sessionsCleanupPending += 1;
    }
  }
  const cleanupPending = await all(db, `SELECT id FROM task22_upload_sessions
    WHERE state IN ('aborted', 'expired', 'failed') AND cleanup_state = 'pending'
      AND (cleanup_retry_at = '' OR cleanup_retry_at <= ?1)
    ORDER BY updated_at ASC LIMIT ?2`, [now, limit]);
  let sessionsRetried = 0;
  let sessionsRetryFailed = 0;
  for (const session of cleanupPending) {
    if(storage.cleanupRemaining===0)break;
    try {
      if (await deleteSessionObjects(db, storage, session.id)) sessionsRetried += 1;
      else sessionsRetryFailed += 1;
    } catch (_) {
      sessionsRetryFailed += 1;
    }
  }
  const shares = await all(db, `SELECT * FROM task22_shares
    WHERE (expires_at <= ?1 OR state IN ('revoked', 'delete_pending'))
      AND state != 'deleted'
      AND NOT (state = 'delete_pending' AND EXISTS (
        SELECT 1 FROM task22_download_grants AS grant
        WHERE grant.share_id = task22_shares.id
          AND grant.state IN ('active', 'completed') AND grant.expires_at > ?1))
      AND (cleanup_retry_at = '' OR cleanup_retry_at <= ?1)
    ORDER BY expires_at ASC LIMIT ?2`, [now, limit]);
  let removed = 0;
  let failed = 0;
  for (const share of shares) {
    if(storage.cleanupRemaining===0)break;
    try {
      if (await removeShare(db, storage, share, isExpired(share) ? "expired" : share.deletion_reason || "cleanup")) removed += 1;
      else failed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  const orphans = options.scanOrphans && storage.cleanupRemaining>0
    ? await scanFileOrphans(db,storage,{family:'transfer',environment:options.environment,limit})
    : {orphan_inspected:0,orphan_removed:0,orphan_failed:0};
  const auditPruned=await pruneFileAudit(db,limit);
  return {
    sessions_removed: sessionsRemoved,
    sessions_cleanup_pending: sessionsCleanupPending,
    sessions_retried: sessionsRetried,
    sessions_retry_failed: sessionsRetryFailed,
    shares_inspected: shares.length,
    shares_removed: removed,
    shares_failed: failed,
    orphan_share_files_removed: Number(orphanShareFiles?.meta?.changes || 0),
    ...orphans,
    ...multipartCleanup,
    object_operations:Math.min(80,Number(options.objectBudget || 40))-storage.cleanupRemaining,
    audit_pruned: auditPruned,
  };
}

export async function task22Counts(db) {
  const tableCount = async (table) => Number((await first(db, `SELECT COUNT(*) AS count FROM ${table}`))?.count || 0);
  const now = isoNow();
  const [sessions, files, parts, shares, shareFiles, grants, sessionBytes, shareBytes] = await Promise.all([
    tableCount("task22_upload_sessions"),
    tableCount("task22_upload_files"),
    tableCount("task22_upload_parts"),
    tableCount("task22_shares"),
    tableCount("task22_share_files"),
    tableCount("task22_download_grants"),
    first(db, `SELECT
      COALESCE(SUM(CASE WHEN state = 'active' AND expires_at > ?1 THEN total_bytes ELSE 0 END), 0) AS reserved_bytes,
      COALESCE(SUM(CASE WHEN state = 'active' AND expires_at <= ?1 THEN total_bytes ELSE 0 END), 0) AS expired_reserved_bytes
      FROM task22_upload_sessions`, [now]),
    first(db, `SELECT COALESCE(SUM(file.size_bytes), 0) AS stored_bytes FROM task22_share_files file
      JOIN task22_shares share ON share.id=file.share_id WHERE ${liveShareSql("share", "?1")}`, [isoNow()]),
  ]);
  const reservedBytes = Number(sessionBytes?.reserved_bytes || 0);
  const storedBytes = Number(shareBytes?.stored_bytes || 0);
  return {
    sessions, files, parts, shares, shareFiles, grants,
    stored_bytes: storedBytes,
    reserved_bytes: reservedBytes,
    expired_reserved_bytes: Number(sessionBytes?.expired_reserved_bytes || 0),
    used_bytes: storedBytes + reservedBytes,
    active_bytes: storedBytes + reservedBytes,
  };
}

export const __testing = Object.freeze({
  activeBytes,
  allocateUploadFile,
  completeUploadSession,
  concatenatedParts,
  createUploadSession,
  guestOwnerRef,
  objectKeyFor,
  previewPolicyFor,
  storageLimitBytes,
  uploadPart,
});
