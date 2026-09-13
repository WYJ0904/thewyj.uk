import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask22Request } from "../functions/_lib/task22-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { missingPartNumbers, uploadWorkerCount, UPLOAD_CONCURRENCY } from "../js/transfer/app.js";

/**
 * Task 24 reopen #8: file-transfer integrity is proven by bytes, never by
 * "16/16 parts + etag".
 *
 * For every real file shape the test uploads the same source bytes the browser
 * holds, then compares three SHA-256 digests and three byte lengths:
 *
 *   source bytes  ==  R2 final object  ==  downloaded bytes
 *
 * plus the metadata that made the earlier failures user-visible: filename and
 * extension (an EXE must stay .exe), Content-Type, Content-Disposition,
 * Content-Length, Accept-Ranges and an exact Range window across a part
 * boundary. A multipart resume re-uploads one part and must not change a byte.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
  TASK14_LEGACY_WRITES_FROZEN: "true",
  TASK22_TRANSFER_READS_ENABLED: "true",
  TASK22_TRANSFER_WRITES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});

const USER = Object.freeze({
  id: "task24-integrity",
  username: "task24-integrity",
  token: "task24-integrity-token",
});

async function insertUser(db, user, token) {
  const now = new Date().toISOString();
  await db.prepare([
    "INSERT INTO task12_users (",
    "id, username, username_normalized, password_hash, password_scheme,",
    "password_iterations, role, registered_at, created_at, updated_at, source_updated_at",
    ") VALUES (?1, ?2, ?3, '', 'reset_required', 0, 'user', ?4, ?4, ?4, ?4)",
  ].join(" ")).bind(user.id, user.username, user.username.toLowerCase(), now).run();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task12_sessions (",
    "token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind",
    ") VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')",
  ].join(" ")).bind(await sessionStorageKey(token), user.id, now, expires).run();
}

async function request(db, storage, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.bodyBytes) headers.set("Content-Length", String(options.bodyBytes.byteLength));
  const response = await handleTask22Request({
    env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_STORAGE: storage },
    data: { requestId: crypto.randomUUID() },
    request: new Request("https://preview.thewyj.uk" + route, {
      method: options.method || "GET",
      headers,
      body: options.bodyBytes ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    }),
  });
  const contentType = response.headers.get("Content-Type") || "";
  const payload = contentType.startsWith("application/json")
    ? await response.json()
    : new Uint8Array(await response.arrayBuffer());
  return { response, payload };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

/** Deterministic pseudo-random fill so a failing run can be replayed exactly. */
function pseudoRandom(seed, length) {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = (state >>> 24) & 0xff;
  }
  return bytes;
}

function withEdges(body, leading, trailing) {
  const bytes = new Uint8Array(leading.length + body.length + trailing.length);
  bytes.set(leading, 0);
  bytes.set(body, leading.length);
  bytes.set(trailing, leading.length + body.length);
  return bytes;
}

const encoder = new TextEncoder();
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const JPEG_TAIL = new Uint8Array([0xff, 0xd9]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TAIL = new Uint8Array([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const MP4_HEAD = encoder.encode("\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000isomiso2");
const EXE_HEAD = encoder.encode("MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000");
const EXE_TAIL = encoder.encode("PE\u0000\u0000Install");

const FIXTURES = Object.freeze([
  Object.freeze({
    label: "jpeg photo",
    fileName: "holiday-photo.jpg",
    relativePath: "photos/holiday-photo.jpg",
    mimeType: "image/jpeg",
    bytes: () => withEdges(pseudoRandom(101, 480 * 1024), JPEG_HEAD, JPEG_TAIL),
  }),
  Object.freeze({
    label: "png image",
    fileName: "design-draft.png",
    relativePath: "images/design-draft.png",
    mimeType: "image/png",
    bytes: () => withEdges(pseudoRandom(202, 320 * 1024), PNG_HEAD, PNG_TAIL),
  }),
  Object.freeze({
    label: "mp4-like video (multi part)",
    fileName: "clip-4k.mp4",
    relativePath: "video/clip-4k.mp4",
    mimeType: "video/mp4",
    bytes: () => withEdges(pseudoRandom(303, 16 * 1024 * 1024 + 123 * 1024), MP4_HEAD, new Uint8Array([0, 0, 0, 0])),
  }),
  Object.freeze({
    label: "windows executable",
    fileName: "UbisoftConnectInstaller.exe",
    relativePath: "downloads/UbisoftConnectInstaller.exe",
    mimeType: "application/x-msdownload",
    bytes: () => withEdges(pseudoRandom(404, 1024 * 1024 + 17), EXE_HEAD, EXE_TAIL),
  }),
  Object.freeze({
    label: "random binary",
    fileName: "random-blob.bin",
    relativePath: "blobs/random-blob.bin",
    mimeType: "application/octet-stream",
    bytes: () => pseudoRandom(505, 700 * 1024),
  }),
  Object.freeze({
    label: "multi-chunk binary",
    fileName: "dataset.bin",
    relativePath: "blobs/dataset.bin",
    mimeType: "application/octet-stream",
    bytes: () => pseudoRandom(606, 16 * 1024 * 1024 + 4 * 1024 * 1024 + 7),
  }),
]);

async function createSession(db, storage, totalBytes) {
  const created = await request(db, storage, "/api/transfer/uploads", {
    method: "POST",
    token: USER.token,
    body: {
      guest_id: "",
      password: "",
      minutes: 1440,
      max_downloads: 5,
      one_time: false,
      file_count: 1,
      total_bytes: totalBytes,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  return created.payload.upload.id;
}

async function allocateFile(db, storage, sessionId, fixture, fileId, sizeBytes) {
  const allocated = await request(db, storage, "/api/transfer/uploads/files", {
    method: "POST",
    token: USER.token,
    body: {
      guest_id: "",
      session_id: sessionId,
      file_id: fileId,
      relative_path: fixture.relativePath,
      file_name: fixture.fileName,
      mime_type: fixture.mimeType,
      size_bytes: sizeBytes,
    },
  });
  assert.equal(allocated.response.status, 201, JSON.stringify(allocated.payload));
  return allocated.payload.file;
}

async function uploadPart(db, storage, sessionId, fileId, partNumber, bytes) {
  return request(db, storage,
    `/api/transfer/uploads/${sessionId}/files/${fileId}/parts/${partNumber}`, {
      method: "PUT",
      token: USER.token,
      bodyBytes: bytes,
      headers: { "X-Part-Sha256": await sha256Hex(bytes) },
    });
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-transfer-integrity-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
  d1Persist: runtime,
  r2Persist: runtime,
});

try {
  const db = await mf.getD1Database("WYJ_DB");
  const storage = await mf.getR2Bucket("WYJ_STORAGE");
  const migrations = (await readdir(path.join(ROOT, "cloudflare", "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  await insertUser(db, USER, USER.token);

  for (const [index, fixture] of FIXTURES.entries()) {
    const sourceBytes = fixture.bytes();
    const size = sourceBytes.byteLength;
    const sourceHash = await sha256Hex(sourceBytes);

    const sessionId = await createSession(db, storage, size);
    const fileId = `file-integrity-${String(index + 1).padStart(4, "0")}`;
    const file = await allocateFile(db, storage, sessionId, fixture, fileId, size);
    const partSize = Number(file.part_size);
    const partCount = Number(file.part_count);
    assert.equal(
      partCount,
      Math.max(1, Math.ceil(size / partSize)),
      `${fixture.label}: the server plan must cover the declared size`,
    );

    // The browser uploader resumes through missingPartNumbers()/uploadWorkerCount();
    // both must agree with the server plan before a single byte is sent.
    assert.deepEqual(
      missingPartNumbers(partCount, []),
      Array.from({ length: partCount }, (_, position) => position + 1),
      `${fixture.label}: a fresh upload plans every part`,
    );
    assert.equal(
      uploadWorkerCount(partCount, [], UPLOAD_CONCURRENCY),
      Math.min(UPLOAD_CONCURRENCY, partCount),
      `${fixture.label}: worker count is bounded by the plan`,
    );

    const partBytes = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const offset = (partNumber - 1) * partSize;
      const length = Math.min(partSize, size - offset);
      const slice = sourceBytes.subarray(offset, offset + length);
      partBytes.push(slice);
      const uploaded = await uploadPart(db, storage, sessionId, fileId, partNumber, slice);
      assert.equal(uploaded.response.status, 201, `${fixture.label}: part ${partNumber}`);
    }

    // Resume semantics: re-sending an already uploaded part must be idempotent
    // and must not alter the object.
    const resumed = await uploadPart(db, storage, sessionId, fileId, partCount, partBytes[partCount - 1]);
    assert.ok(resumed.response.status < 300, `${fixture.label}: part retry must succeed`);
    const resumedPayload = resumed.payload instanceof Uint8Array
      ? JSON.parse(new TextDecoder().decode(resumed.payload))
      : resumed.payload;
    assert.equal(
      resumedPayload.part?.uploaded,
      true,
      `${fixture.label}: retry is recognised as uploaded (${resumed.response.status} ${JSON.stringify(resumedPayload)})`,
    );

    const completed = await request(db, storage, `/api/transfer/uploads/${sessionId}/complete`, {
      method: "POST",
      token: USER.token,
      body: {},
    });
    assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
    const share = completed.payload.share;
    const shareFile = share.files.find((entry) => entry.file_id === fileId);
    assert.ok(shareFile, `${fixture.label}: the share must list the uploaded file`);
    assert.equal(shareFile.file_name, fixture.fileName, `${fixture.label}: file name is preserved`);
    assert.equal(shareFile.mime_type, fixture.mimeType, `${fixture.label}: content type is preserved`);
    assert.equal(Number(shareFile.size_bytes), size, `${fixture.label}: size is preserved`);
    assert.equal(
      path.extname(shareFile.file_name),
      path.extname(fixture.fileName),
      `${fixture.label}: the extension must survive the round trip`,
    );

    // R2 final object equals the source, byte for byte.
    const objectKey = `transfers/v2/preview/objects/${fileId}/file`;
    const stored = await storage.get(objectKey);
    assert.ok(stored, `${fixture.label}: the published object must exist`);
    assert.equal(Number(stored.size), size, `${fixture.label}: R2 object size`);
    const storedBytes = new Uint8Array(await stored.arrayBuffer());
    assert.equal(await sha256Hex(storedBytes), sourceHash, `${fixture.label}: R2 SHA-256`);
    assert.deepEqual(storedBytes, sourceBytes, `${fixture.label}: R2 bytes`);

    const authorized = await request(db, storage, `/api/transfer/shares/${share.id}/authorize`, {
      method: "POST",
      body: {},
    });
    assert.equal(authorized.response.status, 200, JSON.stringify(authorized.payload));
    const grant = authorized.payload.download.token;

    const downloaded = await request(db, storage,
      `/api/transfer/shares/${share.id}/download?file=${fileId}&grant=${grant}`);
    assert.equal(downloaded.response.status, 200, `${fixture.label}: download status`);
    assert.equal(
      Number(downloaded.response.headers.get("Content-Length")),
      size,
      `${fixture.label}: Content-Length`,
    );
    assert.equal(
      downloaded.response.headers.get("Content-Type"),
      fixture.mimeType,
      `${fixture.label}: Content-Type`,
    );
    const disposition = downloaded.response.headers.get("Content-Disposition") || "";
    assert.ok(
      disposition.includes(`filename="${fixture.fileName}"`),
      `${fixture.label}: Content-Disposition keeps the file name (${disposition})`,
    );
    assert.equal(downloaded.response.headers.get("Accept-Ranges"), "bytes", `${fixture.label}: Accept-Ranges`);
    assert.equal(downloaded.payload.byteLength, size, `${fixture.label}: downloaded length`);
    assert.equal(await sha256Hex(downloaded.payload), sourceHash, `${fixture.label}: download SHA-256`);
    assert.deepEqual(downloaded.payload, sourceBytes, `${fixture.label}: downloaded bytes`);

    // A Range window must return exactly the requested source bytes, including
    // the window that crosses a 16 MiB part boundary.
    const rangeStart = partCount > 1 ? partSize - 100 : Math.min(64, size - 200);
    const rangeEnd = rangeStart + 199;
    const ranged = await request(db, storage,
      `/api/transfer/shares/${share.id}/download?file=${fileId}&grant=${grant}`, {
        headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
      });
    assert.equal(ranged.response.status, 206, `${fixture.label}: range status`);
    assert.equal(
      ranged.response.headers.get("Content-Range"),
      `bytes ${rangeStart}-${rangeEnd}/${size}`,
      `${fixture.label}: Content-Range`,
    );
    assert.equal(
      ranged.response.headers.get("Content-Type"),
      fixture.mimeType,
      `${fixture.label}: ranged Content-Type`,
    );
    assert.deepEqual(
      ranged.payload,
      sourceBytes.subarray(rangeStart, rangeEnd + 1),
      `${fixture.label}: range bytes`,
    );
  }

  console.log(
    "Task 24 file-transfer integrity passed (source/R2/download SHA-256 + byte length for jpg, png, mp4, exe, random binary and multi-chunk binary; filename/extension, Content-Type, Content-Disposition, Content-Length, Range across a part boundary and idempotent part resume).",
  );
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
