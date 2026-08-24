import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask14Request } from "../functions/_lib/task14-api.mjs";
import { cleanupExpiredShares } from "../functions/_lib/task14-service.mjs";
import { __testing as cleanupWorkerTesting } from "../cloudflare/task14-cleanup-worker.mjs";
import {
  FILE_TYPES,
  MAX_TEMP_FILE_BYTES,
  MAX_TEMP_VIDEO_BYTES,
  fileSizeLimit,
  validateFileContent,
  validateFileMetadata,
} from "../functions/_lib/task14-model.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SECRET = "task14-preview-secret-fixture-0123456789abcdef";
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK14_IMPORT_ENABLED: "true",
  TASK14_PRODUCTION_IMPORT_ENABLED: "false",
  TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
  TASK14_LEGACY_WRITES_FROZEN: "false",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "true",
  WYJ_ENVIRONMENT: "preview",
  WYJ_TASK14_TEMPORARY_SECRET: SECRET,
});
const USERS = Object.freeze({
  admin: { id: "task14-admin", username: "task14-admin", role: "super_admin", token: "task14-admin-token" },
  member: { id: "task14-member", username: "task14-member", role: "user", token: "task14-member-token" },
  other: { id: "task14-other", username: "task14-other", role: "user", token: "task14-other-token" },
  free: { id: "task14-free", username: "task14-free", role: "user", token: "task14-free-token" },
});

const FILE_FIXTURES = Object.freeze({
  "sample.txt": { mime: "text/plain", bytes: new TextEncoder().encode("hello 世界 日本語") },
  "sample.csv": { mime: "text/csv", bytes: new TextEncoder().encode("name,value\n测试,1\n") },
  "sample.json": { mime: "application/json", bytes: new TextEncoder().encode('{"ok":true,"text":"测试"}') },
  "sample.pdf": { mime: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7\nfixture") },
  "sample.png": { mime: "image/png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) },
  "sample.jpg": { mime: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 1]) },
  "sample.jpeg": { mime: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]) },
  "sample.webp": { mime: "image/webp", bytes: new TextEncoder().encode("RIFF0000WEBPfixture") },
  "sample.gif": { mime: "image/gif", bytes: new TextEncoder().encode("GIF89afixture") },
  "sample.zip": { mime: "application/zip", bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1]) },
  "sample.mp4": { mime: "video/mp4", bytes: Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]) },
  "sample.m4v": { mime: "video/x-m4v", bytes: Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x56, 0x20]) },
  "sample.mov": { mime: "video/quicktime", bytes: Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]) },
  "sample.webm": { mime: "video/webm", bytes: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1]) },
});

async function insertAccountAndSession(db, user) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, ?4, ?5, ?5, ?5, ?5)`)
    .bind(user.id, user.username, user.username.toLowerCase(), user.role, now).run();
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
    .bind(await sessionStorageKey(user.token), user.id, now, expires).run();
}

async function grantMembership(db, user) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO task13_user_memberships (
    id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source,
    source_ref, created_by, metadata_json, created_at, updated_at
  ) VALUES (?1, ?2, 'all_access_lifetime', ?3, '', 1, 'active', 'test', ?4, ?5, '{}', ?3, ?3)`)
    .bind(`task14-membership-${user.id}`, user.id, now, `fixture:${user.id}`, USERS.admin.id).run();
}

function jsonBody(value) {
  return { bytes: new TextEncoder().encode(JSON.stringify(value)), contentType: "application/json" };
}

async function requestTask14(db, storage, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  let body;
  if (options.body !== undefined) {
    const encoded = options.raw ? { bytes: options.body, contentType: options.contentType } : jsonBody(options.body);
    body = encoded.bytes;
    headers.set("Content-Type", encoded.contentType || "application/octet-stream");
    headers.set("Content-Length", String(body.byteLength));
  }
  const pending = [];
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_STORAGE: storage, ...(options.env || {}) },
    data: { requestId: crypto.randomUUID() },
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || (options.body === undefined ? "GET" : "POST"), headers, body,
      duplex: body ? "half" : undefined,
    }),
  };
  const legacyCalls = [];
  const response = await handleTask14Request(context, async (legacyContext) => {
    legacyCalls.push(new URL(legacyContext.request.url).pathname);
    return Response.json({ ok: true, source: "legacy" });
  });
  let payload = null;
  let bytes = null;
  if (options.consume !== false) {
    const type = response.headers.get("Content-Type") || "";
    const attachment = String(response.headers.get("Content-Disposition") || "").startsWith("attachment;");
    if (type.includes("application/json") && !attachment) payload = await response.json();
    else bytes = new Uint8Array(await response.arrayBuffer());
    await Promise.allSettled(pending);
  }
  return { response, payload, bytes, pending, legacyCalls };
}

async function uploadFile(db, storage, fileName, fixture, options = {}) {
  const initialized = await requestTask14(db, storage, "/api/temporary/file/init", {
    method: "POST", token: options.token || USERS.member.token,
    body: {
      file_name: fileName, mime_type: fixture.mime, size_bytes: fixture.bytes.byteLength,
      minutes: options.minutes || 60, max_downloads: options.maxDownloads || 5,
      destroy_after_download: Boolean(options.destroy), password: options.password || "",
    },
  });
  assert.equal(initialized.response.status, 201, JSON.stringify(initialized.payload));
  const id = initialized.payload.upload.id;
  const uploaded = await requestTask14(db, storage, `/api/temporary/file/upload?id=${encodeURIComponent(id)}`, {
    method: "PUT", token: options.token || USERS.member.token, body: fixture.bytes,
    raw: true, contentType: fixture.mime,
  });
  assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.payload));
  return { id, upload: uploaded.payload.file };
}

async function row(db, sql, ...values) {
  return await db.prepare(sql).bind(...values).first();
}

function interruptibleDownloadStorage(storage, fixtureBytes) {
  return {
    head: storage.head.bind(storage),
    put: storage.put.bind(storage),
    delete: storage.delete.bind(storage),
    list: storage.list.bind(storage),
    async get() {
      const bytes = new Uint8Array(fixtureBytes);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 1));
        },
        cancel() {},
      });
      return { body, size: bytes.byteLength };
    },
  };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task14-d1-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"], r2Buckets: ["WYJ_STORAGE"], d1Persist: runtime, r2Persist: runtime,
});
let completed = 0;

try {
  const db = await mf.getD1Database("WYJ_DB");
  const storage = await mf.getR2Bucket("WYJ_STORAGE");
  for (const filename of [
    "0001_foundation.sql", "0002_low_risk_cloud_services.sql", "0003_accounts_sessions.sql",
    "0004_session_limit_trigger.sql", "0005_session_limit_ordering.sql",
    "0006_memberships_payments.sql", "0007_temporary_sharing.sql",
    "0008_task14_user_storage_trigger.sql", "0009_task14_global_storage_trigger.sql",
  ]) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  for (const user of Object.values(USERS)) await insertAccountAndSession(db, user);
  await grantMembership(db, USERS.member);
  await grantMembership(db, USERS.other);

  const capabilities = await requestTask14(db, storage, "/api/temporary/capabilities");
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.payload.schema_ready, true);
  assert.equal(capabilities.payload.cloud_upload, true);
  assert.equal(capabilities.payload.limits.file_bytes, MAX_TEMP_FILE_BYTES);
  assert.equal(capabilities.payload.limits.video_bytes, MAX_TEMP_VIDEO_BYTES);
  const legacyMode = await requestTask14(db, storage, "/api/temporary/text", {
    method: "POST", token: USERS.member.token, body: { content: "legacy" },
    env: { TASK14_CLOUD_WRITES_ENABLED: "false", TASK14_TEMPORARY_PRIMARY_ENABLED: "false" },
  });
  assert.deepEqual(legacyMode.legacyCalls, ["/api/temporary/text"]);
  const frozenLegacyMode = await requestTask14(db, storage, "/api/temporary/text", {
    method: "POST", token: USERS.member.token, body: { content: "blocked during migration" },
    env: {
      TASK14_CLOUD_WRITES_ENABLED: "false",
      TASK14_TEMPORARY_PRIMARY_ENABLED: "false",
      TASK14_LEGACY_WRITES_FROZEN: "true",
    },
  });
  assert.equal(frozenLegacyMode.response.status, 503);
  assert.equal(frozenLegacyMode.payload.code, "task14_migration_in_progress");
  assert.deepEqual(frozenLegacyMode.legacyCalls, []);
  completed += 1;

  const unauthenticated = await requestTask14(db, storage, "/api/temporary/text", {
    method: "POST", body: { content: "no session" },
  });
  assert.equal(unauthenticated.response.status, 401);
  const free = await requestTask14(db, storage, "/api/temporary/text", {
    method: "POST", token: USERS.free.token, body: { content: "no entitlement" },
  });
  assert.equal(free.response.status, 403);
  assert.equal(free.payload.code, "membership_required");
  completed += 1;

  for (const kind of ["text", "qr", "wifi", "contact", "url"]) {
    const route = kind === "text" ? "/api/temporary/text" : "/api/temporary/qr";
    const created = await requestTask14(db, storage, route, {
      method: "POST", token: USERS.member.token,
      body: { content: `内容-${kind}-日本語`, kind, password: "share-pass", minutes: 60, max_views: 2 },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    const denied = await requestTask14(db, storage, "/api/share/text/read", {
      method: "POST", body: { id: created.payload.share.id, password: "wrong" },
    });
    assert.equal(denied.response.status, 403);
    const read = await requestTask14(db, storage, "/api/share/text/read", {
      method: "POST", body: { id: created.payload.share.id, password: "share-pass" },
    });
    assert.equal(read.payload.share.content, `内容-${kind}-日本語`);
  }
  const oneShot = await requestTask14(db, storage, "/api/temporary/text", {
    method: "POST", token: USERS.member.token,
    body: { content: "consume once", minutes: 60, max_views: 10, destroy_after_read: true },
  });
  const oneShotRead = await requestTask14(db, storage, "/api/share/text/read", {
    method: "POST", body: { id: oneShot.payload.share.id },
  });
  assert.equal(oneShotRead.payload.share.destroyed, true);
  const gone = await requestTask14(db, storage, "/api/share/text/read", {
    method: "POST", body: { id: oneShot.payload.share.id },
  });
  assert.equal(gone.response.status, 404);
  completed += 1;

  const clipboard = await requestTask14(db, storage, "/api/temporary/clipboard", {
    method: "POST", token: USERS.member.token,
    body: { content: "跨设备剪贴板", minutes: 10, destroy_after_read: true },
  });
  assert.match(clipboard.payload.clipboard.code, /^\d{6}$/);
  const clipboardRead = await requestTask14(db, storage, "/api/share/clipboard/read", {
    method: "POST", body: { code: clipboard.payload.clipboard.code },
  });
  assert.equal(clipboardRead.payload.clipboard.content, "跨设备剪贴板");
  assert.equal(clipboardRead.payload.clipboard.destroyed, true);
  const clipboardGone = await requestTask14(db, storage, "/api/share/clipboard/read", {
    method: "POST", body: { code: clipboard.payload.clipboard.code },
  });
  assert.equal(clipboardGone.response.status, 404);
  completed += 1;

  const room = await requestTask14(db, storage, "/api/temporary/room", {
    method: "POST", token: USERS.member.token,
    body: { password: "room-pass", minutes: 60, max_messages: 2 },
  });
  const roomId = room.payload.room.id;
  for (const message of ["第一条", "第二条", "第三条"]) {
    const posted = await requestTask14(db, storage, "/api/share/room/post", {
      method: "POST", body: { id: roomId, password: "room-pass", author: "访客", message },
    });
    assert.equal(posted.response.status, 201);
  }
  const roomRead = await requestTask14(db, storage, "/api/share/room/read", {
    method: "POST", body: { id: roomId, password: "room-pass" },
  });
  assert.deepEqual(roomRead.payload.room.messages.map((item) => item.message), ["第二条", "第三条"]);
  const forbiddenClear = await requestTask14(db, storage, "/api/temporary/room/clear", {
    method: "POST", token: USERS.other.token, body: { id: roomId },
  });
  assert.equal(forbiddenClear.response.status, 403);
  const ownerClear = await requestTask14(db, storage, "/api/temporary/room/clear", {
    method: "POST", token: USERS.member.token, body: { id: roomId },
  });
  assert.equal(ownerClear.response.status, 200);
  completed += 1;

  for (const [name, fixture] of Object.entries(FILE_FIXTURES)) {
    const metadata = validateFileMetadata(name, fixture.mime, fixture.bytes.byteLength);
    assert.equal(validateFileContent(metadata.extension, fixture.bytes), true, name);
    assert.ok(FILE_TYPES[metadata.extension].includes(fixture.mime));
    const roundTrip = await uploadFile(db, storage, `roundtrip-${name}`, fixture, {
      maxDownloads: 1, destroy: true,
    });
    const authorization = await requestTask14(db, storage, "/api/share/file/authorize", {
      method: "POST", body: { id: roundTrip.id },
    });
    assert.equal(authorization.response.status, 200, name);
    const downloaded = await requestTask14(db, storage, authorization.payload.download.url);
    assert.equal(downloaded.response.status, 200, name);
    assert.deepEqual(downloaded.bytes, fixture.bytes, name);
  }
  assert.equal(fileSizeLimit(".pdf"), MAX_TEMP_FILE_BYTES);
  assert.equal(fileSizeLimit(".mp4"), MAX_TEMP_VIDEO_BYTES);
  assert.doesNotThrow(() => validateFileMetadata("limit.pdf", "application/pdf", MAX_TEMP_FILE_BYTES));
  assert.doesNotThrow(() => validateFileMetadata("limit.mp4", "video/mp4", MAX_TEMP_VIDEO_BYTES));
  assert.throws(() => validateFileMetadata("too-large.pdf", "application/pdf", MAX_TEMP_FILE_BYTES + 1));
  assert.throws(() => validateFileMetadata("too-large.mp4", "video/mp4", MAX_TEMP_VIDEO_BYTES + 1));
  assert.equal(validateFileContent(".json", new TextEncoder().encode("not-json")), false);
  assert.equal(validateFileContent(".png", new TextEncoder().encode("not-png")), false);

  for (const boundary of [
    { name: "limit.pdf", mime: "application/pdf", size: MAX_TEMP_FILE_BYTES, signature: new TextEncoder().encode("%PDF-1.7\n") },
    { name: "limit.mp4", mime: "video/mp4", size: MAX_TEMP_VIDEO_BYTES,
      signature: Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]) },
  ]) {
    const bytes = new Uint8Array(boundary.size);
    bytes.set(boundary.signature);
    const uploadedBoundary = await uploadFile(db, storage, boundary.name, { mime: boundary.mime, bytes });
    const cancelledBoundary = await requestTask14(db, storage, "/api/temporary/file/cancel", {
      method: "POST", token: USERS.member.token, body: { id: uploadedBoundary.id },
    });
    assert.equal(cancelledBoundary.response.status, 200, boundary.name);
  }
  completed += 1;

  const uploadedText = await uploadFile(db, storage, "download.txt", FILE_FIXTURES["sample.txt"], {
    maxDownloads: 1, password: "file-pass",
  });
  const wrongPassword = await requestTask14(db, storage, "/api/share/file/authorize", {
    method: "POST", body: { id: uploadedText.id, password: "wrong" },
  });
  assert.equal(wrongPassword.response.status, 403);
  const authorizationAttempts = await Promise.all([
    requestTask14(db, storage, "/api/share/file/authorize", {
      method: "POST", body: { id: uploadedText.id, password: "file-pass" },
    }),
    requestTask14(db, storage, "/api/share/file/authorize", {
      method: "POST", body: { id: uploadedText.id, password: "file-pass" },
    }),
  ]);
  const authorized = authorizationAttempts.find((item) => item.response.status === 200);
  const deniedFinal = authorizationAttempts.find((item) => item.response.status !== 200);
  assert.ok(authorized);
  assert.ok([404, 410].includes(deniedFinal.response.status));
  const grantUrl = authorized.payload.download.url;
  assert.equal(JSON.stringify(authorized.payload).includes("r2_object_key"), false);
  const ranged = await requestTask14(db, storage, grantUrl, { headers: { Range: "bytes=0-4" } });
  assert.equal(ranged.response.status, 206);
  assert.equal(ranged.response.headers.get("Content-Range"), `bytes 0-4/${FILE_FIXTURES["sample.txt"].bytes.byteLength}`);
  assert.deepEqual(ranged.bytes, FILE_FIXTURES["sample.txt"].bytes.slice(0, 5));
  const cleanupDuringGrant = await cleanupExpiredShares(db, storage, { limit: 100, environment: "preview" });
  assert.ok(await row(db, "SELECT id FROM task14_shares WHERE id = ?1", uploadedText.id));
  assert.equal(cleanupDuringGrant.failed, 0, "cleanup completed while an active retry grant remained protected");
  const invalidRange = await requestTask14(db, storage, grantUrl, { headers: { Range: "bytes=999999-" } });
  assert.equal(invalidRange.response.status, 416);
  assert.equal(invalidRange.payload.code, "temporary_range_invalid");
  const retriedFull = await requestTask14(db, storage, grantUrl);
  assert.equal(retriedFull.response.status, 200);
  assert.deepEqual(retriedFull.bytes, FILE_FIXTURES["sample.txt"].bytes);
  assert.equal(await row(db, "SELECT id FROM task14_shares WHERE id = ?1", uploadedText.id), null);
  completed += 1;

  const interruptedFile = await uploadFile(db, storage, "interrupt.png", FILE_FIXTURES["sample.png"], {
    maxDownloads: 1, destroy: true,
  });
  const interruptGrant = await requestTask14(db, storage, "/api/share/file/authorize", {
    method: "POST", body: { id: interruptedFile.id },
  });
  const lockExpires = new Date(Date.now() + 60000).toISOString();
  await db.prepare(`UPDATE task14_download_grants SET active_request_id = 'concurrent-fixture',
    active_request_expires_at = ?2 WHERE share_id = ?1`).bind(interruptedFile.id, lockExpires).run();
  const concurrentReuse = await requestTask14(db, storage, interruptGrant.payload.download.url);
  assert.equal(concurrentReuse.response.status, 409, JSON.stringify(concurrentReuse.payload));
  assert.equal(concurrentReuse.payload.code, "temporary_download_in_progress");
  const countedOnce = await row(db, `SELECT share.download_count, COUNT(grant.token_digest) AS grants
    FROM task14_shares AS share JOIN task14_download_grants AS grant ON grant.share_id = share.id
    WHERE share.id = ?1`, interruptedFile.id);
  assert.equal(Number(countedOnce.download_count), 1);
  assert.equal(Number(countedOnce.grants), 1);
  await db.prepare(`UPDATE task14_download_grants SET active_request_id = '', active_request_expires_at = ''
    WHERE share_id = ?1`).bind(interruptedFile.id).run();
  const interruptedStorage = interruptibleDownloadStorage(storage, FILE_FIXTURES["sample.png"].bytes);
  const interrupted = await requestTask14(db, interruptedStorage, interruptGrant.payload.download.url, { consume: false });
  assert.equal(interrupted.response.status, 200);
  const reader = interrupted.response.body.getReader();
  await reader.read();
  await reader.cancel("client interrupted");
  await Promise.allSettled(interrupted.pending);
  assert.ok(await row(db, "SELECT id FROM task14_shares WHERE id = ?1", interruptedFile.id));
  const afterInterrupt = await requestTask14(db, storage, interruptGrant.payload.download.url);
  assert.equal(afterInterrupt.response.status, 200);
  assert.deepEqual(afterInterrupt.bytes, FILE_FIXTURES["sample.png"].bytes);
  assert.equal(await row(db, "SELECT id FROM task14_shares WHERE id = ?1", interruptedFile.id), null);
  completed += 1;

  const brokenUpload = await requestTask14(db, storage, "/api/temporary/file/init", {
    method: "POST", token: USERS.member.token,
    body: { file_name: "broken.png", mime_type: "image/png", size_bytes: 10, minutes: 60, max_downloads: 1 },
  });
  const broken = await requestTask14(db, storage, `${brokenUpload.payload.upload.upload_url}`, {
    method: "PUT", token: USERS.member.token, raw: true,
    body: new TextEncoder().encode("not-an-img"), contentType: "image/png",
  });
  assert.equal(broken.response.status, 400);
  assert.equal(broken.payload.code, "file_signature_invalid");
  completed += 1;

  const missingFile = await uploadFile(db, storage, "missing.pdf", FILE_FIXTURES["sample.pdf"]);
  const missingRow = await row(db, "SELECT r2_object_key FROM task14_shares WHERE id = ?1", missingFile.id);
  await storage.delete(missingRow.r2_object_key);
  const missing = await requestTask14(db, storage, "/api/share/file/authorize", {
    method: "POST", body: { id: missingFile.id },
  });
  assert.equal(missing.response.status, 503);
  assert.equal(missing.payload.code, "temporary_file_missing");
  const noR2 = await requestTask14(db, null, "/api/temporary/file/init", {
    method: "POST", token: USERS.member.token,
    body: { file_name: "no-r2.txt", mime_type: "text/plain", size_bytes: 2, minutes: 60, max_downloads: 1 },
  });
  assert.equal(noR2.response.status, 201, "reservation remains available while R2 upload reports the actual outage");
  const noR2Upload = await requestTask14(db, null, noR2.payload.upload.upload_url, {
    method: "PUT", token: USERS.member.token, raw: true,
    body: new TextEncoder().encode("ok"), contentType: "text/plain",
  });
  assert.equal(noR2Upload.response.status, 503);
  completed += 1;

  const today = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO task14_usage_daily (user_id, usage_date, create_count, updated_at)
    VALUES (?1, ?2, 100, ?3) ON CONFLICT(user_id, usage_date) DO UPDATE SET create_count = 100`)
    .bind(USERS.other.id, today, new Date().toISOString()).run();
  const quota = await requestTask14(db, storage, "/api/temporary/text", {
    method: "POST", token: USERS.other.token, body: { content: "over quota" },
  });
  assert.equal(quota.response.status, 429);
  completed += 1;

  const expiredId = "task14-expired-share";
  const expiredKey = `temporary/v1/preview/files/${expiredId}`;
  await storage.put(expiredKey, FILE_FIXTURES["sample.png"].bytes);
  await db.prepare(`INSERT INTO task14_shares (
    id, owner_user_id, share_type, kind, r2_object_key, file_name, file_extension,
    mime_type, size_bytes, created_at, updated_at, expires_at, state
  ) VALUES (?1, ?2, 'file', 'file', ?3, 'expired.png', '.png', 'image/png', ?4, ?5, ?5, ?6, 'active')`)
    .bind(expiredId, USERS.member.id, expiredKey, FILE_FIXTURES["sample.png"].bytes.byteLength,
      new Date(Date.now() - 7200000).toISOString(), new Date(Date.now() - 3600000).toISOString()).run();
  const cleanup = await cleanupExpiredShares(db, storage, { limit: 100, scanOrphans: true, environment: "preview" });
  assert.ok(cleanup.removed >= 1);
  assert.equal(await storage.head(expiredKey), null);
  const boundedOrphanScan = await cleanupExpiredShares(db, storage, {
    limit: 1, scanOrphans: true, environment: "preview",
  });
  assert.ok(boundedOrphanScan.orphan_inspected <= 1);
  const scheduledCleanup = await cleanupWorkerTesting.runCleanup({
    WYJ_DB: db, WYJ_STORAGE: storage, WYJ_ENVIRONMENT: "preview",
  });
  assert.equal(scheduledCleanup.ok, true);
  completed += 1;

  const importPayload = {
    schema_version: 1, source_key: "fixture:shares", kind: "shares", source_count: 1,
    source_bytes: 0, complete: true,
    records: [{
      id: "task14-import-text", owner_user_id: USERS.member.id, share_type: "text", kind: "text",
      content_text: "imported content", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(), max_views: 5, state: "active",
    }],
  };
  const imported = await requestTask14(db, storage, "/api/admin/task14/import", {
    method: "POST", token: USERS.admin.token, body: importPayload,
  });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.payload));
  const importedAgain = await requestTask14(db, storage, "/api/admin/task14/import", {
    method: "POST", token: USERS.admin.token, body: importPayload,
  });
  assert.equal(importedAgain.response.status, 200);
  const importCount = await row(db, "SELECT COUNT(*) AS count FROM task14_shares WHERE id = ?1", "task14-import-text");
  assert.equal(Number(importCount.count), 1);
  const badOwner = structuredClone(importPayload);
  badOwner.source_key = "fixture:missing";
  badOwner.records[0].id = "task14-import-bad-owner";
  badOwner.records[0].owner_user_id = "missing-user";
  const rejectedImport = await requestTask14(db, storage, "/api/admin/task14/import", {
    method: "POST", token: USERS.admin.token, body: badOwner,
  });
  assert.equal(rejectedImport.response.status, 409);
  assert.equal(rejectedImport.payload.code, "task14_import_user_missing");
  const ordinaryImport = await requestTask14(db, storage, "/api/admin/task14/import", {
    method: "POST", token: USERS.member.token, body: importPayload,
  });
  assert.equal(ordinaryImport.response.status, 403);
  completed += 1;

  console.log(`Task 14 D1/R2 integration checks passed: ${completed}`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
