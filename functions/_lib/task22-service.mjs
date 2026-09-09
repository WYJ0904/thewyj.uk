import { sha256Hex } from "./cloudflare-foundation.mjs";
import { hashTemporaryPassword, verifyTemporaryPassword } from "./task14-crypto.mjs";
import { accountMembershipState } from "./task13-service.mjs";
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

async function activeBytes(db, owner) {
  const [sessions, shares] = await Promise.all([
    first(db, `SELECT COALESCE(SUM(total_bytes), 0) AS bytes FROM task22_upload_sessions
      WHERE owner_kind = ?1 AND owner_ref = ?2 AND state = 'active'`, [owner.kind, owner.ref]),
    first(db, `SELECT COALESCE(SUM(total_bytes), 0) AS bytes FROM task22_shares
      WHERE owner_kind = ?1 AND owner_ref = ?2 AND state IN ('active', 'revoked')`, [owner.kind, owner.ref]),
  ]);
  return Number(sessions?.bytes || 0) + Number(shares?.bytes || 0);
}

async function consumeCreateQuota(db, owner) {
  const today = isoNow().slice(0, 10);
  const now = isoNow();
  const dailyLimit = owner.kind === "guest" ? GUEST_DAILY_CREATE_LIMIT : USER_DAILY_CREATE_LIMIT;
  const quota = await first(db, `INSERT INTO task22_usage_daily (owner_ref, usage_date, create_count, updated_at)
    VALUES (?1, ?2, 1, ?3)
    ON CONFLICT(owner_ref, usage_date) DO UPDATE SET
      create_count = task22_usage_daily.create_count + 1,
      updated_at = excluded.updated_at
    WHERE task22_usage_daily.create_count < ?4
    RETURNING create_count`, [owner.ref, today, now, dailyLimit]);
  if (!quota) {
    throw new Task22Error("今天创建的文件分享已达到上限", 429, "transfer_daily_quota_exceeded");
  }
}

function objectKeyFor(environment, fileId, partNumber) {
  const scope = ["production", "preview", "development"].includes(String(environment || "").toLowerCase())
    ? String(environment).toLowerCase() : "development";
  return `transfers/v2/${scope}/files/${fileId}/part-${partNumber}`;
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
  return {
    task: 22,
    schema_version: TASK22_SCHEMA_VERSION,
    schema_ready: schemaReady,
    owner_kind: owner.kind,
    storage_limit_bytes: limit,
    used_bytes: schemaReady && owner.ref ? await activeBytes(db, owner) : 0,
    max_share_bytes: MAX_SHARE_BYTES,
    max_files_per_share: MAX_FILE_COUNT_PER_SHARE,
    part_size_bytes: PART_SIZE_BYTES,
    expiry_minutes: EXPIRY_MINUTES,
    authenticated: Boolean(account?.id),
  };
}

export async function createUploadSession(db, account, env, input) {
  requireAllowedFields(input, new Set([
    "guest_id", "password", "minutes", "max_downloads", "one_time", "file_count", "total_bytes",
  ]));
  const owner = await ownerContext(db, account, input);
  await consumeCreateQuota(db, owner);
  const minutes = expiryMinutes(input.minutes, owner.kind);
  const maxDownloads = safeInteger(input.max_downloads, 1, 100, 5, "最大下载次数");
  const oneTime = Boolean(input.one_time);
  const fileCount = safeInteger(input.file_count || 1, 1, MAX_FILE_COUNT_PER_SHARE, 1, "文件数量");
  const totalBytes = safeInteger(input.total_bytes || 0, 0, MAX_SHARE_BYTES, 0, "总大小");
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
  await run(db, `INSERT INTO task22_upload_sessions (
      id, owner_kind, owner_ref, state, file_count, total_bytes, password_hash,
      minutes, max_downloads, one_time, created_at, updated_at, expires_at
    ) VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)`, [
    id, owner.kind, owner.ref, fileCount, totalBytes,
    await passwordHash(input.password, env), minutes, maxDownloads, oneTime ? 1 : 0,
    now, expiresAt,
  ]);
  return await sessionRow(db, id);
}

export async function allocateUploadFile(db, account, env, input) {
  requireAllowedFields(input, new Set([
    "session_id", "guest_id", "file_id", "relative_path", "file_name", "mime_type", "size_bytes",
  ]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  if (session.state !== "active") throw new Task22Error("上传任务已结束", 409, "transfer_session_not_active");
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
  if (files.length >= session.file_count) {
    throw new Task22Error("该任务的文件数量已用完", 409, "transfer_file_count_exceeded");
  }
  if (files.some((file) => file.relative_path === relativePath)) {
    throw new Task22Error("同一分享内存在重复路径", 409, "transfer_duplicate_path");
  }
  const existing = await first(db, "SELECT * FROM task22_upload_files WHERE id = ?1", [fileId]);
  if (existing) {
    if (existing.session_id !== session.id) {
      throw new Task22Error("文件标识已被其他上传任务使用", 409, "transfer_file_id_conflict");
    }
    if (Number(existing.size_bytes) !== sizeBytes || existing.relative_path !== relativePath) {
      throw new Task22Error("文件标识与既有元数据冲突", 409, "transfer_file_id_conflict");
    }
    return existing;
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
  await run(db, `INSERT INTO task22_upload_files (
      id, session_id, relative_path, file_name, mime_type, size_bytes, part_size,
      part_count, preview_policy, state, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'allocated', ?10, ?10)`, [
    fileId, session.id, relativePath, fileName, mimeType, sizeBytes,
    partSize, count, policy.policy, now,
  ]);
  return await first(db, "SELECT * FROM task22_upload_files WHERE id = ?1", [fileId]);
}

export async function uploadPart(db, storage, account, request, sessionId, fileId, partNumberValue, environment = "development", guestId = "") {
  const owner = await ownerContext(db, account, { guest_id: guestId });
  const session = await requireOwnedSession(db, account, owner, sessionId);
  if (session.state !== "active") throw new Task22Error("上传任务已结束", 409, "transfer_session_not_active");
  if (isExpired(session)) {
    await expireSession(db, storage, session, "expired");
    throw new Task22Error("上传任务已过期", 410, "transfer_session_expired");
  }
  const file = await first(db, "SELECT * FROM task22_upload_files WHERE session_id = ?1 AND id = ?2", [session.id, cleanId(fileId, "文件标识")]);
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
  const bucket = requireStorage(storage);
  const objectKey = objectKeyFor(environment, file.id, partNumber);
  const existing = await first(db, `SELECT * FROM task22_upload_parts
    WHERE session_id = ?1 AND file_id = ?2 AND part_number = ?3`, [session.id, file.id, partNumber]);
  if (existing) {
    // Idempotent retry of an already-uploaded part is accepted without re-upload.
    if (sha256Header && existing.sha256_hex && existing.sha256_hex !== sha256Header) {
      throw new Task22Error("同一分片重传内容不一致", 409, "transfer_part_hash_conflict");
    }
    return { part_number: partNumber, size_bytes: Number(existing.size_bytes), uploaded: true };
  }
  const putOptions = {
    httpMetadata: { contentType: "application/octet-stream", cacheControl: "private, no-store" },
    customMetadata: { task: "22", session: session.id, file: file.id, part: String(partNumber) },
  };
  let uploaded;
  try {
    if (typeof globalThis.FixedLengthStream === "function") {
      const fixed = new globalThis.FixedLengthStream(expected.length);
      const [putResult, pipeResult] = await Promise.allSettled([
        bucket.put(objectKey, fixed.readable, putOptions),
        request.body.pipeTo(fixed.writable),
      ]);
      if (pipeResult.status === "rejected") throw pipeResult.reason;
      if (putResult.status === "rejected") throw putResult.reason;
      uploaded = putResult.value;
    } else {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength !== expected.length) {
        throw new Task22Error("分片大小与声明不一致", 400, "transfer_part_size_mismatch");
      }
      uploaded = await bucket.put(objectKey, bytes, putOptions);
    }
    if (!uploaded || Number(uploaded.size) !== expected.length) {
      throw new Task22Error("分片大小校验失败", 400, "transfer_part_size_mismatch");
    }
    await run(db, `INSERT INTO task22_upload_parts (
        session_id, file_id, part_number, size_bytes, sha256_hex, object_key, uploaded_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`, [
      session.id, file.id, partNumber, expected.length, sha256Header, objectKey, isoNow(),
    ]);
    await run(db, "UPDATE task22_upload_sessions SET updated_at = ?2 WHERE id = ?1", [session.id, isoNow()]);
    return { part_number: partNumber, size_bytes: expected.length, uploaded: false };
  } catch (error) {
    try { await bucket.delete(objectKey); } catch (_) { /* best effort */ }
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

export async function completeUploadSession(db, storage, account, env, input) {
  requireAllowedFields(input, new Set(["session_id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  if (session.state === "published" && session.share_id) {
    const share = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [session.share_id]);
    if (share) return sharePayload(share, await shareFileRows(db, share.id));
  }
  if (session.state !== "active") throw new Task22Error("上传任务已结束", 409, "transfer_session_not_active");
  if (isExpired(session)) {
    await expireSession(db, storage, session, "expired");
    throw new Task22Error("上传任务已过期", 410, "transfer_session_expired");
  }
  const files = await fileRows(db, session.id);
  if (files.length === 0 || files.length > session.file_count) {
    throw new Task22Error("上传文件数量与任务声明不一致", 409, "transfer_incomplete_upload");
  }
  let declaredBytes = 0;
  for (const file of files) {
    declaredBytes += Number(file.size_bytes);
    const parts = await all(db, `SELECT * FROM task22_upload_parts
      WHERE session_id = ?1 AND file_id = ?2 ORDER BY part_number`, [session.id, file.id]);
    if (parts.length !== Number(file.part_count)) {
      throw new Task22Error("仍有分片未上传完成", 409, "transfer_incomplete_upload");
    }
    for (const part of parts) {
      const expected = partRange(Number(part.part_number), Number(file.part_size), Number(file.size_bytes));
      if (Number(part.size_bytes) !== expected.length) {
        throw new Task22Error("分片大小校验失败", 409, "transfer_part_size_mismatch");
      }
      if (!await requireStorage(storage).head(part.object_key)) {
        throw new Task22Error("分片内容缺失，请重传", 409, "transfer_part_missing");
      }
    }
  }
  if (declaredBytes > Number(session.total_bytes)) {
    throw new Task22Error("上传总大小超出任务声明", 409, "transfer_session_size_exceeded");
  }
  const shareId = randomToken(24);
  const now = isoNow();
  const expiresAt = isoNow(new Date(Date.now() + Number(session.minutes) * 60 * 1000));
  await requireDatabase(db).batch([
    db.prepare(`INSERT INTO task22_shares (
        id, owner_kind, owner_ref, password_hash, total_bytes, file_count,
        max_downloads, one_time, state, created_at, updated_at, expires_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?9, ?10)`).bind(
      shareId, owner.kind, owner.ref, session.password_hash, declaredBytes, files.length,
      session.max_downloads, session.one_time, now, expiresAt,
    ),
    ...files.map((file) => db.prepare(`INSERT INTO task22_share_files (
        share_id, file_id, relative_path, file_name, mime_type, size_bytes,
        part_size, part_count, sha256_hex, preview_policy
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
      shareId, file.id, file.relative_path, file.file_name, file.mime_type,
      file.size_bytes, file.part_size, file.part_count, file.sha256_hex, file.preview_policy,
    )),
    db.prepare(`UPDATE task22_upload_sessions SET state = 'published', share_id = ?2,
      completed_at = ?3, updated_at = ?3 WHERE id = ?1 AND state = 'active'`).bind(session.id, shareId, now),
    db.prepare(`UPDATE task22_upload_files SET state = 'complete', updated_at = ?2
      WHERE session_id = ?1 AND state = 'allocated'`).bind(session.id, now),
  ]);
  const share = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [shareId]);
  return sharePayload(share, await shareFileRows(db, shareId));
}

export async function abortUploadSession(db, storage, account, input) {
  requireAllowedFields(input, new Set(["session_id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const session = await requireOwnedSession(db, account, owner, input.session_id);
  if (session.state === "aborted") return { id: session.id, state: "aborted", no_change: true };
  if (session.state === "published") throw new Task22Error("已完成的上传任务不能取消，请撤销分享", 409, "transfer_session_published");
  await expireSession(db, storage, session, "owner_aborted");
  return { id: session.id, state: "aborted" };
}

async function shareFileRows(db, shareId) {
  return await all(db, "SELECT * FROM task22_share_files WHERE share_id = ?1 ORDER BY relative_path", [shareId]);
}

export async function listShares(db, account, input = {}) {
  const owner = await ownerContext(db, account, input);
  const rows = await all(db, `SELECT * FROM task22_shares WHERE owner_kind = ?1 AND owner_ref = ?2
    AND state IN ('active', 'revoked', 'delete_pending') ORDER BY created_at DESC LIMIT 200`, [owner.kind, owner.ref]);
  const files = await all(db, `SELECT * FROM task22_share_files WHERE share_id IN
    (SELECT id FROM task22_shares WHERE owner_kind = ?1 AND owner_ref = ?2) ORDER BY relative_path`, [owner.kind, owner.ref]);
  const byShare = new Map();
  for (const file of files) {
    if (!byShare.has(file.share_id)) byShare.set(file.share_id, []);
    byShare.get(file.share_id).push(file);
  }
  return rows.map((row) => sharePayload(row, byShare.get(row.id) || []));
}

export async function shareMetadata(db, storage, env, input) {
  requireAllowedFields(input, new Set(["id", "password"]));
  const row = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [cleanId(input.id)]);
  if (!row || await expireShare(db, storage, row)) {
    throw new Task22Error("分享不存在或已过期", 404, "share_not_found");
  }
  if (row.state === "revoked") throw new Task22Error("分享已被撤销", 410, "share_revoked");
  await checkPassword(row, input.password, env);
  return sharePayload(row, await shareFileRows(db, row.id));
}

export async function authorizeShareDownload(db, storage, env, input) {
  requireAllowedFields(input, new Set(["id", "password"]));
  const row = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [cleanId(input.id)]);
  if (!row || await expireShare(db, storage, row) || row.state !== "active") {
    throw new Task22Error("分享不存在或已过期", 404, "share_not_found");
  }
  await checkPassword(row, input.password, env);
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
        token_digest, share_id, created_at, expires_at, state
      ) SELECT ?2, id, ?3, ?4, 'active' FROM task22_shares
      WHERE id = ?1 AND state = 'active' AND expires_at > ?3 AND download_count < max_downloads`)
      .bind(row.id, digest, now, expiresAt),
  ]);
  const grant = await first(db, "SELECT * FROM task22_download_grants WHERE token_digest = ?1", [digest]);
  if (!grant) throw new Task22Error("分享下载次数已用完", 410, "transfer_download_limit_reached");
  return {
    token,
    expires_at: grant.expires_at,
    share: sharePayload(row, await shareFileRows(db, row.id)),
  };
}

async function releaseDownloadRequest(db, digest, requestId) {
  await run(db, `UPDATE task22_download_grants SET active_request_id = '',
    active_request_expires_at = '' WHERE token_digest = ?1 AND active_request_id = ?2`, [digest, requestId]);
}

async function finalizeDownload(db, storage, row, digest, requestId) {
  await run(db, `UPDATE task22_download_grants SET state = 'completed', completed_at = ?2,
    last_used_at = ?2, active_request_id = '', active_request_expires_at = ''
    WHERE token_digest = ?1 AND active_request_id = ?3`, [digest, isoNow(), requestId]);
  const nextCount = Number(row.download_count) + 1;
  const destroy = Boolean(row.one_time) || nextCount >= Number(row.max_downloads);
  await run(db, `UPDATE task22_shares SET download_count = ?2,
    state = CASE WHEN ?3 THEN 'delete_pending' ELSE state END,
    deletion_reason = CASE WHEN ?3 THEN 'download_limit' ELSE deletion_reason END,
    updated_at = ?4 WHERE id = ?5`, [row.id, nextCount, destroy ? 1 : 0, isoNow(), row.id]);
  if (destroy) await removeShare(db, storage, row, "download_limit");
}

async function concatenatedParts(storage, parts, offset = 0, length = null, onComplete = null, onCancel = null) {
  let remaining = length;
  let settled = false;
  const once = (callback) => {
    if (settled || !callback) return;
    settled = true;
    callback();
  };
  return new ReadableStream({
    async start(controller) {
      let skipped = 0;
      try {
        for (const part of parts) {
          const partSize = Number(part.size_bytes);
          if (offset > skipped + partSize) { skipped += partSize; continue; }
          const localOffset = Math.max(0, offset - skipped);
          const available = partSize - localOffset;
          if (available <= 0) { skipped += partSize; continue; }
          const take = remaining === null ? available : Math.min(remaining, available);
          const object = await storage.get(part.object_key, { range: { offset: localOffset, length: take } });
          if (!object?.body) throw new Task22Error("分享文件内容缺失", 503, "transfer_file_missing", true);
          const reader = object.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          if (remaining !== null) {
            remaining -= take;
            if (remaining <= 0) break;
          }
          skipped += partSize;
        }
        once(onComplete);
        controller.close();
      } catch (error) {
        once(onCancel);
        controller.error(error);
      }
    },
    async cancel() {
      once(onCancel);
    },
  });
}

export async function streamFileDownload(context, shareIdValue, fileIdValue, token) {
  const db = requireDatabase(context.env.WYJ_DB);
  const storage = requireStorage(context.env.WYJ_STORAGE);
  const shareId = cleanId(shareIdValue);
  const fileId = cleanId(fileIdValue, "文件标识");
  const digest = await sha256Hex(token);
  const now = isoNow();
  const row = await first(db, `SELECT share.*, grant.state AS grant_state, grant.expires_at AS grant_expires_at
    FROM task22_download_grants AS grant
    JOIN task22_shares AS share ON share.id = grant.share_id
    WHERE grant.token_digest = ?1 AND grant.share_id = ?2
      AND grant.state IN ('active', 'completed') AND grant.expires_at > ?3
      AND share.state IN ('active', 'delete_pending')`, [digest, shareId, now]);
  if (!row) throw new Task22Error("下载授权无效或已过期", 403, "transfer_download_grant_invalid");
  const file = await first(db, "SELECT * FROM task22_share_files WHERE share_id = ?1 AND file_id = ?2", [shareId, fileId]);
  if (!file) throw new Task22Error("分享文件不存在", 404, "transfer_share_file_not_found");
  const parts = await all(db, `SELECT * FROM task22_upload_parts WHERE file_id = ?1 ORDER BY part_number`, [fileId]);
  if (parts.length !== Number(file.part_count)) {
    throw new Task22Error("分享文件内容不完整", 503, "transfer_file_missing", true);
  }
  const totalBytes = Number(file.size_bytes);
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
  const headers = new Headers({
    "Content-Type": file.mime_type,
    "Content-Disposition": safeContentDisposition(file.file_name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  if (file.preview_policy !== "preview") {
    headers.set("Content-Security-Policy", "sandbox");
  }
  const length = requestedRange ? requestedRange.length : totalBytes;
  headers.set("Content-Length", String(length));
  if (requestedRange) {
    const start = requestedRange.offset;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${totalBytes}`);
  }
  let settled = false;
  const once = (callback) => {
    if (settled) return;
    settled = true;
    if (typeof context.waitUntil === "function") context.waitUntil(Promise.resolve(callback()).catch(() => undefined));
    else void Promise.resolve(callback()).catch(() => undefined);
  };
  const fullResponse = !requestedRange;
  const body = await concatenatedParts(
    storage,
    parts,
    requestedRange?.offset || 0,
    requestedRange?.length ?? null,
    fullResponse
      ? () => once(() => finalizeDownload(db, storage, row, digest, requestId))
      : () => once(() => releaseDownloadRequest(db, digest, requestId)),
    () => once(() => releaseDownloadRequest(db, digest, requestId)),
  );
  return new Response(body, { status: requestedRange ? 206 : 200, headers });
}

async function expireSession(db, storage, session, reason) {
  const targetState = reason === "owner_aborted" ? "aborted" : "expired";
  await run(db, `UPDATE task22_upload_sessions SET state = ?2, deleted_at = ?3,
    updated_at = ?3 WHERE id = ?1 AND state = 'active'`, [session.id, targetState, isoNow()]);
  await deleteSessionParts(db, storage, session.id, reason);
}

async function deleteSessionParts(db, storage, sessionId, reason) {
  const parts = await all(db, "SELECT object_key FROM task22_upload_parts WHERE session_id = ?1", [sessionId]);
  for (const part of parts) {
    try { await requireStorage(storage).delete(part.object_key); } catch (_) { /* retried by cleanup */ }
  }
  await run(db, "DELETE FROM task22_upload_parts WHERE session_id = ?1", [sessionId]);
}

export async function revokeShare(db, storage, account, input) {
  requireAllowedFields(input, new Set(["id", "guest_id"]));
  const owner = await ownerContext(db, account, input);
  const row = await first(db, "SELECT * FROM task22_shares WHERE id = ?1", [cleanId(input.id)]);
  if (!row) throw new Task22Error("分享不存在", 404, "share_not_found");
  if (row.owner_kind !== owner.kind || row.owner_ref !== owner.ref) {
    throw new Task22Error("只有创建者可以撤销分享", 403, "forbidden");
  }
  if (row.state === "revoked") return { id: row.id, state: "revoked", no_change: true };
  await removeShare(db, storage, row, "owner_revoked");
  return { id: row.id, state: "revoked" };
}

async function removeShare(db, storage, row, reason) {
  const now = isoNow();
  const nextState = row.state === "revoked" ? "revoked" : "delete_pending";
  await run(db, `UPDATE task22_shares SET state = ?2, deletion_reason = ?3,
    cleanup_retry_at = '', updated_at = ?4 WHERE id = ?1 AND state != 'deleted'`, [row.id, nextState, reason, now]);
  const files = await shareFileRows(db, row.id);
  const parts = await all(db, `SELECT object_key FROM task22_upload_parts WHERE file_id IN
    (SELECT file_id FROM task22_share_files WHERE share_id = ?1)`, [row.id]);
  let failed = 0;
  for (const part of parts) {
    try { await requireStorage(storage).delete(part.object_key); } catch (_) { failed += 1; }
  }
  if (failed) {
    await run(db, `UPDATE task22_shares SET cleanup_attempts = cleanup_attempts + 1,
      cleanup_retry_at = ?2, updated_at = ?2 WHERE id = ?1`, [row.id, isoNow(new Date(Date.now() + 30 * 60 * 1000))]);
    return false;
  }
  await run(db, "DELETE FROM task22_shares WHERE id = ?1", [row.id]);
  await run(db, "DELETE FROM task22_upload_parts WHERE file_id IN (SELECT file_id FROM task22_share_files WHERE share_id = ?1)", [row.id]);
  return true;
}

async function expireShare(db, storage, row) {
  if (!row || !isExpired(row)) return false;
  await removeShare(db, storage, row, "expired");
  return true;
}

export async function cleanupExpiredTransfers(db, storage, options = {}) {
  const limit = safeInteger(options.limit, 1, 500, CLEANUP_LIMIT, "清理数量");
  const now = isoNow();
  await run(db, `UPDATE task22_download_grants SET state = 'expired'
    WHERE expires_at <= ?1 AND state = 'active'`, [now]);
  await run(db, `DELETE FROM task22_download_grants
    WHERE expires_at <= ?1 AND state IN ('completed', 'expired', 'revoked')`, [now]);
  const sessions = await all(db, `SELECT * FROM task22_upload_sessions
    WHERE state = 'active' AND expires_at <= ?1 ORDER BY expires_at ASC LIMIT ?2`, [now, limit]);
  let sessionsRemoved = 0;
  for (const session of sessions) {
    await expireSession(db, storage, session, "expired");
    sessionsRemoved += 1;
  }
  const shares = await all(db, `SELECT * FROM task22_shares
    WHERE (expires_at <= ?1 OR state IN ('revoked', 'delete_pending'))
      AND state != 'deleted'
      AND (cleanup_retry_at = '' OR cleanup_retry_at <= ?1)
    ORDER BY expires_at ASC LIMIT ?2`, [now, limit]);
  let removed = 0;
  let failed = 0;
  for (const share of shares) {
    try {
      if (await removeShare(db, storage, share, isExpired(share) ? "expired" : share.deletion_reason || "cleanup")) removed += 1;
      else failed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  let orphanRemoved = 0;
  let orphanInspected = 0;
  if (options.scanOrphans && storage?.list) {
    const prefix = `transfers/v2/${String(options.environment || "development")}/files/`;
    let cursor;
    do {
      const page = await storage.list({ prefix, cursor, limit: Math.min(1000, limit) });
      for (const object of page.objects || []) {
        if (orphanInspected >= limit) break;
        orphanInspected += 1;
        const linked = await first(db, "SELECT session_id FROM task22_upload_parts WHERE object_key = ?1", [object.key]);
        const age = Date.now() - new Date(object.uploaded || 0).getTime();
        if (!linked && age > 24 * 60 * 60 * 1000) {
          await storage.delete(object.key);
          orphanRemoved += 1;
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && orphanInspected < limit);
  }
  return {
    sessions_removed: sessionsRemoved,
    shares_inspected: shares.length,
    shares_removed: removed,
    shares_failed: failed,
    orphan_inspected: orphanInspected,
    orphan_removed: orphanRemoved,
  };
}

export async function task22Counts(db) {
  const tableCount = async (table) => Number((await first(db, `SELECT COUNT(*) AS count FROM ${table}`))?.count || 0);
  const [sessions, files, parts, shares, shareFiles, grants, activeBytesTotal] = await Promise.all([
    tableCount("task22_upload_sessions"),
    tableCount("task22_upload_files"),
    tableCount("task22_upload_parts"),
    tableCount("task22_shares"),
    tableCount("task22_share_files"),
    tableCount("task22_download_grants"),
    first(db, "SELECT COALESCE(SUM(total_bytes), 0) AS bytes FROM task22_shares WHERE state IN ('active', 'revoked')"),
  ]);
  return { sessions, files, parts, shares, shareFiles, grants, active_bytes: Number(activeBytesTotal?.bytes || 0) };
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
