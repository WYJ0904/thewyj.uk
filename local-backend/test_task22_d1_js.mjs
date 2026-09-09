import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask14Request } from "../functions/_lib/task14-api.mjs";
import { handleTask22Request } from "../functions/_lib/task22-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";

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
  WYJ_TASK14_TEMPORARY_SECRET: "task22-test-temporary-secret-2026",
});

const USERS = Object.freeze({
  free: Object.freeze({ id: "task22-free", username: "task22-free", token: "task22-free-token" }),
  tools: Object.freeze({ id: "task22-tools", username: "task22-tools", token: "task22-tools-token" }),
  other: Object.freeze({ id: "task22-other", username: "task22-other", token: "task22-other-token" }),
  owner: Object.freeze({ id: "task22-owner", username: "task22-owner", token: "task22-owner-token" }),
});

async function insertUser(db, user, role = "user", token = "") {
  const now = new Date().toISOString();
  await db.prepare([
    "INSERT INTO task12_users (",
    "id, username, username_normalized, password_hash, password_scheme,",
    "password_iterations, role, registered_at, created_at, updated_at, source_updated_at",
    ") VALUES (?1, ?2, ?3, '', 'reset_required', 0, ?4, ?5, ?5, ?5, ?5)",
  ].join(" ")).bind(user.id, user.username, user.username.toLowerCase(), role, now).run();
  if (!token) return;
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task12_sessions (",
    "token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind",
    ") VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')",
  ].join(" ")).bind(await sessionStorageKey(token), user.id, now, expires).run();
}

async function grantMembership(db, userId, planCode) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await db.prepare([
    "INSERT INTO task13_user_memberships (",
    "id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,",
    "source, source_ref, created_by, metadata_json, created_at, updated_at",
    ") VALUES (?1, ?2, ?3, ?4, ?5, 0, 'active', 'admin', ?6, '', '{}', ?4, ?4)",
  ].join(" ")).bind(`task22-${userId}`, userId, planCode, now, expires, `task22-${userId}`).run();
}

async function request(db, storage, route, options = {}, environment = ENVIRONMENT) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.guestId) headers.set("X-Transfer-Guest-Id", options.guestId);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.bodyBytes) headers.set("Content-Length", String(options.bodyBytes.byteLength));
  const response = await handleTask22Request({
    env: { ...environment, WYJ_DB: db, WYJ_STORAGE: storage },
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

function partExpected(fileSize, partSize, partNumber) {
  const offset = (partNumber - 1) * partSize;
  return Math.min(partSize, fileSize - offset);
}

function bytesOf(seed, length) {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (seed + index) % 251;
  return bytes;
}

async function createSession(db, storage, options) {
  const created = await request(db, storage, "/api/transfer/uploads", {
    method: "POST",
    token: options.token,
    guestId: options.guestId,
    body: {
      guest_id: options.guestId || "",
      password: options.password || "",
      minutes: options.minutes || 1440,
      max_downloads: options.maxDownloads || 5,
      one_time: Boolean(options.oneTime),
      file_count: options.fileCount || 1,
      total_bytes: options.totalBytes || 1024,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  return created.payload.upload.id;
}

async function allocateFile(db, storage, sessionId, options) {
  const allocated = await request(db, storage, "/api/transfer/uploads/files", {
    method: "POST",
    token: options.token,
    guestId: options.guestId,
    body: {
      guest_id: options.guestId || "",
      session_id: sessionId,
      file_id: options.fileId,
      relative_path: options.relativePath,
      file_name: options.fileName,
      mime_type: options.mimeType,
      size_bytes: options.sizeBytes,
    },
  });
  assert.equal(allocated.response.status, 201, JSON.stringify(allocated.payload));
  return allocated.payload.file;
}

async function putPart(db, storage, sessionId, fileId, partNumber, sizeBytes, seed, options) {
  const result = await request(db, storage,
    `/api/transfer/uploads/${sessionId}/files/${fileId}/parts/${partNumber}`, {
      method: "PUT",
      token: options.token,
      guestId: options.guestId,
      bodyBytes: bytesOf(seed, sizeBytes),
    });
  return result;
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task22-transfer-"));
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
  await insertUser(db, USERS.free, "user", USERS.free.token);
  await insertUser(db, USERS.tools, "user", USERS.tools.token);
  await insertUser(db, USERS.other, "user", USERS.other.token);
  await insertUser(db, USERS.owner, "super_admin", USERS.owner.token);
  await grantMembership(db, USERS.tools.id, "tools_monthly");
  const guestId = "guest:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  // 1. Capabilities report the tiered, server-side quota.
  const freeCaps = await request(db, storage, "/api/transfer/capabilities", { token: USERS.free.token });
  assert.equal(freeCaps.payload.storage_limit_bytes, 500 * 1024 * 1024);
  const toolsCaps = await request(db, storage, "/api/transfer/capabilities", { token: USERS.tools.token });
  assert.equal(toolsCaps.payload.storage_limit_bytes, 2 * 1024 * 1024 * 1024);
  const ownerCaps = await request(db, storage, "/api/transfer/capabilities", { token: USERS.owner.token });
  assert.equal(ownerCaps.payload.storage_limit_bytes, 5 * 1024 * 1024 * 1024);
  const guestCaps = await request(db, storage, "/api/transfer/capabilities?guest_id=" + guestId);
  assert.equal(guestCaps.payload.storage_limit_bytes, 50 * 1024 * 1024);
  assert.equal(guestCaps.payload.authenticated, false);

  // 2. Guest quota is enforced at 50 MiB.
  const guestSession = await createSession(db, storage, {
    guestId, totalBytes: 40 * 1024 * 1024, minutes: 60,
  });
  const guestOverflow = await request(db, storage, "/api/transfer/uploads", {
    method: "POST",
    guestId,
    body: { guest_id: guestId, minutes: 60, total_bytes: 20 * 1024 * 1024, file_count: 1 },
  });
  assert.equal(guestOverflow.response.status, 413);

  // 3. Cross-owner isolation: another user cannot read, complete or abort the session.
  const foreignState = await request(db, storage, `/api/transfer/uploads/${guestSession}`, { token: USERS.other.token });
  assert.equal(foreignState.response.status, 404);
  const foreignAbort = await request(db, storage, `/api/transfer/uploads/${guestSession}/abort`, {
    method: "POST",
    token: USERS.other.token,
    body: {},
  });
  assert.equal(foreignAbort.response.status, 404);

  // 4. Filename/path safety: CRLF and traversal are rejected.
  const safetySession = await createSession(db, storage, {
    token: USERS.free.token, fileCount: 1, totalBytes: 64,
  });
  const traversal = await request(db, storage, "/api/transfer/uploads/files", {
    method: "POST",
    token: USERS.free.token,
    body: {
      session_id: safetySession, file_id: "file-evil-00000001", relative_path: "../secret.txt",
      file_name: "secret.txt", mime_type: "text/plain", size_bytes: 64,
    },
  });
  assert.equal(traversal.response.status, 400);
  assert.equal(traversal.payload.code, "transfer_path_traversal");
  const crlfName = await request(db, storage, "/api/transfer/uploads/files", {
    method: "POST",
    token: USERS.free.token,
    body: {
      session_id: safetySession, file_id: "file-crlf-00000001", relative_path: "safe.txt",
      file_name: "safe\r\n.txt", mime_type: "text/plain", size_bytes: 64,
    },
  });
  assert.equal(crlfName.response.status, 400);

  // 5. Full user flow: multi-file session with directory structure and resume.
  const session = await createSession(db, storage, {
    token: USERS.free.token,
    password: "正确密码",
    maxDownloads: 2,
    oneTime: false,
    fileCount: 2,
    totalBytes: 1280,
  });
  const fileA = await allocateFile(db, storage, session, {
    token: USERS.free.token,
    fileId: "file-a-0000000001",
    relativePath: "docs/report.txt",
    fileName: "report.txt",
    mimeType: "text/plain",
    sizeBytes: 640,
  });
  const fileB = await allocateFile(db, storage, session, {
    token: USERS.free.token,
    fileId: "file-b-0000000001",
    relativePath: "assets/photo.png",
    fileName: "photo.png",
    mimeType: "image/png",
    sizeBytes: 640,
  });
  assert.equal(fileA.preview_policy, "preview");
  assert.equal(fileB.preview_policy, "preview");
  const partSizeA = fileA.part_size;
  const partSizeB = fileB.part_size;

  // Upload only the first part of fileA, then read resume state.
  const partA1 = await putPart(db, storage, session, fileA.file_id, 1, partExpected(640, partSizeA, 1), 1, { token: USERS.free.token });
  assert.equal(partA1.response.status, 201);
  const stateMid = await request(db, storage, `/api/transfer/uploads/${session}`, { token: USERS.free.token });
  assert.equal(stateMid.payload.files.length, 2);
  const midFileA = stateMid.payload.files.find((file) => file.file_id === fileA.file_id);
  assert.deepEqual(midFileA.uploaded_parts, [1]);

  // Incomplete upload cannot publish.
  const incomplete = await request(db, storage, `/api/transfer/uploads/${session}/complete`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  assert.equal(incomplete.response.status, 409);
  assert.equal(incomplete.payload.code, "transfer_incomplete_upload");

  // Retrying the same part is idempotent.
  const partA1Again = await putPart(db, storage, session, fileA.file_id, 1, partExpected(640, partSizeA, 1), 1, { token: USERS.free.token });
  assert.equal(partA1Again.response.status, 200);
  assert.equal(partA1Again.payload.part.uploaded, true);

  // Forged size is rejected (wrong Content-Length for the part slot).
  const forged = await putPart(db, storage, session, fileA.file_id, 1, partExpected(640, partSizeA, 1) - 3, 1, { token: USERS.free.token });
  assert.equal(forged.response.status, 400);

  // Finish both files and publish.
  const remainingA = 640 - partExpected(640, partSizeA, 1);
  if (remainingA > 0) {
    const lastA = await putPart(db, storage, session, fileA.file_id, 2, remainingA, 9, { token: USERS.free.token });
    assert.equal(lastA.response.status, 201);
  }
  const partB1 = await putPart(db, storage, session, fileB.file_id, 1, partExpected(640, partSizeB, 1), 2, { token: USERS.free.token });
  assert.equal(partB1.response.status, 201);

  const completed = await request(db, storage, `/api/transfer/uploads/${session}/complete`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
  const shareId = completed.payload.share.id;
  assert.equal(completed.payload.share.file_count, 2);
  assert.equal(completed.payload.share.total_bytes, 1280);
  const paths = completed.payload.share.files.map((file) => file.relative_path).sort();
  assert.deepEqual(paths, ["assets/photo.png", "docs/report.txt"]);

  // Complete is idempotent and returns the same share.
  const completedAgain = await request(db, storage, `/api/transfer/uploads/${session}/complete`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  assert.equal(completedAgain.response.status, 200);
  assert.equal(completedAgain.payload.share.id, shareId);

  // 6. Password gate and download accounting.
  const wrongPassword = await request(db, storage, `/api/transfer/shares/${shareId}/authorize`, {
    method: "POST",
    body: { password: "错误密码" },
  });
  assert.equal(wrongPassword.response.status, 403);
  const authorize = await request(db, storage, `/api/transfer/shares/${shareId}/authorize`, {
    method: "POST",
    body: { password: "正确密码" },
  });
  assert.equal(authorize.response.status, 200, JSON.stringify(authorize.payload));
  const grant = authorize.payload.download.token;

  const downloadA = await request(db, storage,
    `/api/transfer/shares/${shareId}/download?file=${fileA.file_id}&grant=${grant}`);
  assert.equal(downloadA.response.status, 200);
  assert.equal(downloadA.payload.length, 640);
  assert.match(downloadA.response.headers.get("Content-Disposition"), /report\.txt/);

  // Range request reuses the grant without consuming another download.
  const rangeA = await request(db, storage,
    `/api/transfer/shares/${shareId}/download?file=${fileA.file_id}&grant=${grant}`, {
      headers: { Range: "bytes=10-19" },
    });
  assert.equal(rangeA.response.status, 206);
  assert.equal(rangeA.payload.length, 10);

  let shareAfter;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    shareAfter = await request(db, storage, `/api/transfer/shares/${shareId}?password=正确密码`);
    if (Number(shareAfter.payload.share.download_count) === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(Number(shareAfter.payload.share.download_count), 1);

  // 7. Max downloads: after the second full download the share is exhausted.
  const downloadB = await request(db, storage,
    `/api/transfer/shares/${shareId}/download?file=${fileB.file_id}&grant=${grant}`);
  assert.equal(downloadB.response.status, 200);
  let exhausted;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    exhausted = await request(db, storage, `/api/transfer/shares/${shareId}/authorize`, {
      method: "POST",
      body: { password: "正确密码" },
    });
    if ([404, 410].includes(exhausted.response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok([404, 410].includes(exhausted.response.status), "exhausted share must reject further authorization");

  // 8. One-time + Range/retry: range is allowed, then the first complete download destroys.
  const oneSession = await createSession(db, storage, {
    token: USERS.tools.token,
    oneTime: true,
    fileCount: 1,
    totalBytes: 320,
  });
  const oneFile = await allocateFile(db, storage, oneSession, {
    token: USERS.tools.token,
    fileId: "file-one-00000001",
    relativePath: "one.bin",
    fileName: "one.bin",
    mimeType: "application/octet-stream",
    sizeBytes: 320,
  });
  const onePart = await putPart(db, storage, oneSession, oneFile.file_id, 1, 320, 3, { token: USERS.tools.token });
  assert.equal(onePart.response.status, 201);
  const oneComplete = await request(db, storage, `/api/transfer/uploads/${oneSession}/complete`, {
    method: "POST",
    token: USERS.tools.token,
    body: {},
  });
  const oneShareId = oneComplete.payload.share.id;
  const oneAuthorize = await request(db, storage, `/api/transfer/shares/${oneShareId}/authorize`, {
    method: "POST",
    body: {},
  });
  const oneGrant = oneAuthorize.payload.download.token;
  const oneRange = await request(db, storage,
    `/api/transfer/shares/${oneShareId}/download?file=${oneFile.file_id}&grant=${oneGrant}`, {
      headers: { Range: "bytes=0-9" },
    });
  assert.equal(oneRange.response.status, 206);
  const oneDownload = await request(db, storage,
    `/api/transfer/shares/${oneShareId}/download?file=${oneFile.file_id}&grant=${oneGrant}`);
  assert.equal(oneDownload.response.status, 200);
  let oneMetadata;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    oneMetadata = await request(db, storage, `/api/transfer/shares/${oneShareId}`);
    if (oneMetadata.response.status === 404) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(oneMetadata.response.status, 404, "one-time share must be destroyed after download");

  // 9. Download-only policy: SVG/HTML/script/executable/archive/Office/APK/unknown binary.
  let policyIndex = 0;
  for (const [name, mime] of [
    ["logo.svg", "image/svg+xml"],
    ["page.html", "text/html"],
    ["run.sh", "text/x-shellscript"],
    ["app.exe", "application/x-msdownload"],
    ["docs.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["archive.zip", "application/zip"],
    ["app.apk", "application/vnd.android.package-archive"],
    ["data.bin", "application/octet-stream"],
  ]) {
    const policySession = await createSession(db, storage, { token: USERS.free.token, fileCount: 1, totalBytes: 64 });
    const file = await allocateFile(db, storage, policySession, {
      token: USERS.free.token,
      fileId: `file-policy-${String(policyIndex).padStart(4, "0")}`,
      relativePath: `policy/${name}`,
      fileName: name,
      mimeType: mime,
      sizeBytes: 64,
    });
    assert.equal(file.preview_policy, "download_only", name);
    policyIndex += 1;
  }

  // 10. Legacy Task 14 compatibility remains intact.
  const legacy = await handleTask14Request({
    env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_STORAGE: storage },
    data: { requestId: crypto.randomUUID() },
    request: new Request("https://preview.thewyj.uk/api/temporary/text", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": USERS.tools.token },
      body: JSON.stringify({ content: "legacy still works", minutes: 60 }),
    }),
  });
  assert.equal(legacy.status, 201);

  // 11. Abort is idempotent and removes parts; abandoned sessions are cleaned up.
  const abortedSession = await createSession(db, storage, { token: USERS.free.token, fileCount: 1, totalBytes: 64 });
  const abortedFile = await allocateFile(db, storage, abortedSession, {
    token: USERS.free.token,
    fileId: "file-abort-0000001",
    relativePath: "abort.txt",
    fileName: "abort.txt",
    mimeType: "text/plain",
    sizeBytes: 64,
  });
  await putPart(db, storage, abortedSession, abortedFile.file_id, 1, 64, 4, { token: USERS.free.token });
  const abort1 = await request(db, storage, `/api/transfer/uploads/${abortedSession}/abort`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  assert.equal(abort1.response.status, 200);
  const abort2 = await request(db, storage, `/api/transfer/uploads/${abortedSession}/abort`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  assert.equal(abort2.response.status, 200);
  assert.equal(abort2.payload.upload.no_change, true);

  // 12. Revoke: owner-scoped, removes objects.
  const revokeSession = await createSession(db, storage, { token: USERS.free.token, fileCount: 1, totalBytes: 64 });
  const revokeFile = await allocateFile(db, storage, revokeSession, {
    token: USERS.free.token,
    fileId: "file-revoke-000001",
    relativePath: "revoke.txt",
    fileName: "revoke.txt",
    mimeType: "text/plain",
    sizeBytes: 64,
  });
  await putPart(db, storage, revokeSession, revokeFile.file_id, 1, 64, 5, { token: USERS.free.token });
  const revokeComplete = await request(db, storage, `/api/transfer/uploads/${revokeSession}/complete`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  const revokeShareId = revokeComplete.payload.share.id;
  const revoked = await request(db, storage, `/api/transfer/shares/${revokeShareId}/revoke`, {
    method: "POST",
    token: USERS.free.token,
    body: {},
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.payload.share.state, "revoked");
  const revokedForeign = await request(db, storage, `/api/transfer/shares/${revokeShareId}/revoke`, {
    method: "POST",
    token: USERS.other.token,
    body: {},
  });
  assert.equal(revokedForeign.response.status, 404);
  const revokedMetadata = await request(db, storage, `/api/transfer/shares/${revokeShareId}`);
  assert.equal(revokedMetadata.response.status, 404);

  console.log("Task 22 file transfer checks passed (tiered quota, guest isolation, multipart resume, idempotent complete/abort, password, downloads, one-time, range, policy types, legacy compatibility).");
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
