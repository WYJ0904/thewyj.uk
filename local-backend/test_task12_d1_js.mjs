import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { sha256Hex } from "../functions/_lib/cloudflare-foundation.mjs";
import { proxyToLegacy } from "../functions/_lib/legacy-api.mjs";
import { handleTask11Request } from "../functions/_lib/task11-api.mjs";
import { handleTask12Request } from "../functions/_lib/task12-api.mjs";
import { __testing as bridgeTesting } from "../functions/_lib/task12-bridge.mjs";
import { hashSecret, sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import {
  adminDeleteUser,
  adminForceLogout,
  adminResetSecret,
  adminSetBan,
  changeOwnSecret,
  loginAccount,
  resolveSession,
} from "../functions/_lib/task12-service.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BRIDGE_SECRET = "task12-isolated-bridge-secret-0123456789";
const PASSWORD_PEPPER = "task12-isolated-password-pepper-0123456789";
const ADMIN_SECRET = "Task12-Admin-Secret!";
const USER_SECRET = "Task12-User-Secret!";
const NEW_USER_SECRET = "Task12-New-User-Secret!";
const IMPORTED_SECRET = "Task12-Imported-Secret!";
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  CLOUD_READS_ENABLED: "false",
  CLOUD_WRITES_ENABLED: "false",
  TASK11_CLOUD_READS_ENABLED: "true",
  TASK11_CLOUD_WRITES_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK12_IMPORT_ENABLED: "true",
  TASK12_PRODUCTION_IMPORT_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "true",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
  WYJ_TASK12_PASSWORD_PEPPER: PASSWORD_PEPPER,
});
const ROLLBACK_LEGACY_ENVIRONMENT = Object.freeze({
  ...ENVIRONMENT,
  LOCAL_API_BASE: "https://legacy-business.invalid",
  WYJ_LEGACY_IDENTITY_BRIDGE_SECRET: BRIDGE_SECRET,
});
const nativeFetch = globalThis.fetch;
let legacyVerificationRequests = 0;
globalThis.fetch = async (input, init = {}) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== "legacy-business.invalid") return await nativeFetch(input, init);
  const userId = decodeURIComponent(request.headers.get(bridgeTesting.BRIDGE_HEADERS.userId) || "");
  const username = decodeURIComponent(request.headers.get(bridgeTesting.BRIDGE_HEADERS.username) || "");
  if (url.pathname === "/api/me") {
    return Response.json({
      ok: true,
      account: {
        id: userId,
        username,
        membership: "legacy_all_monthly",
        memberships: [{ plan_code: "legacy_all_monthly", status: "active" }],
        entitlements: ["language_all_access"],
        membership_summary: { label: "双语言包月", active: true, lifetime: false },
        tools_access: false,
      },
    });
  }
  if (url.pathname === "/api/internal/task12/verify-secret") {
    legacyVerificationRequests += 1;
    assert.equal(request.method, "POST");
    assert.equal(request.headers.has("X-Session-Token"), false);
    const issuedAt = request.headers.get(bridgeTesting.BRIDGE_HEADERS.issuedAt);
    const requestId = request.headers.get(bridgeTesting.BRIDGE_HEADERS.requestId);
    const canonical = bridgeTesting.canonicalIdentity({
      userId,
      username,
      issuedAt,
      requestId,
      method: "POST",
      pathname: "/api/internal/task12/verify-secret",
    });
    const expected = createHmac("sha256", BRIDGE_SECRET).update(canonical).digest("base64url");
    assert.equal(request.headers.get(bridgeTesting.BRIDGE_HEADERS.signature), expected);
    const body = await request.json();
    return Response.json({
      ok: true,
      valid: userId === "task12-imported-stable-id"
        && username === "task12-imported"
        && body.secret === IMPORTED_SECRET,
    });
  }
  return Response.json({ ok: true });
};

async function requestHandler(handler, db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.ip) headers.set("CF-Connecting-IP", options.ip);
  if (options.userAgent) headers.set("User-Agent", options.userAgent);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const waits = [];
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, ...(options.env || {}) },
    data: { requestId: options.requestId || crypto.randomUUID() },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    waitUntil(promise) { waits.push(promise); },
  };
  const response = await handler(context);
  await Promise.all(waits);
  return { context, response, payload: await response.json() };
}

async function accountRequest(db, route, options = {}) {
  return await requestHandler(handleTask12Request, db, route, options);
}

async function insertAdmin(db) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, 'wyj', 'wyj', ?2, 'pbkdf2_sha256', 310000,
    'super_admin', ?3, ?3, ?3, ?3)`)
    .bind("task12-admin-stable-id", await hashSecret(ADMIN_SECRET, PASSWORD_PEPPER), now).run();
}

function legacyHashSecret(secret, iterations = 310000) {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(secret, salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyCloudHashIndependently(secret, encoded, pepper) {
  const [scheme, iterations, encodedSalt, encodedDigest] = String(encoded || "").split("$");
  if (scheme !== "pbkdf2_sha256_cf_v1" || iterations !== "310000") return false;
  const salt = Buffer.from(encodedSalt, "base64url");
  let state = Buffer.from("wyj-task12-cloud-pbkdf2-v1", "utf8");
  for (const [index, rounds] of [100000, 100000, 100000, 10000].entries()) {
    state = pbkdf2Sync(
      secret,
      Buffer.concat([salt, Buffer.from([index]), state]),
      rounds,
      32,
      "sha256",
    );
  }
  const expected = createHmac("sha256", pepper)
    .update(Buffer.concat([
      Buffer.from("wyj-task12-password-verifier-v1", "utf8"),
      salt,
      state,
    ]))
    .digest("base64url");
  return expected === encodedDigest;
}

function passwordOptions() {
  return { passwordPepper: PASSWORD_PEPPER };
}

function loginRequest() {
  return new Request("https://thewyj.uk/api/login", {
    method: "POST",
    headers: { "User-Agent": "Mozilla/5.0 MicroMessenger iPhone Mobile" },
  });
}

function canonicalLearningRecordId(kind, ...components) {
  return ["v1", kind, ...components.map((value) => Buffer.from(String(value), "utf8").toString("base64url"))].join("|");
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task12-d1-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"],
  d1Persist: runtime,
});
let completed = 0;

try {
  const db = await mf.getD1Database("WYJ_DB");
  for (const filename of [
    "0001_foundation.sql",
    "0002_low_risk_cloud_services.sql",
    "0003_accounts_sessions.sql",
    "0004_session_limit_trigger.sql",
    "0005_session_limit_ordering.sql",
  ]) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  await insertAdmin(db);
  const migrationAdminLogin = await loginAccount(db, "wyj", ADMIN_SECRET, loginRequest(), passwordOptions());
  const importedAt = "2026-08-20T00:00:00Z";
  const importedRecord = {
    id: "task12-imported-stable-id",
    username: "task12-imported",
    username_normalized: "task12-imported",
    password_hash: legacyHashSecret(IMPORTED_SECRET),
    password_scheme: "pbkdf2_sha256",
    password_iterations: 310000,
    role: "user",
    banned: false,
    permanent_ban: false,
    ban_reason: "",
    deleted: false,
    session_version: 4,
    registered_at: importedAt,
    last_login_at: "",
    created_at: importedAt,
    updated_at: importedAt,
  };
  const firstImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [importedRecord] },
  });
  const repeatedImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [importedRecord] },
  });
  assert.equal(firstImport.payload.changed, 1);
  assert.equal(repeatedImport.payload.changed, 0);
  const newerRecord = {
    ...importedRecord,
    last_login_at: "2026-08-20T00:00:01Z",
    updated_at: "2026-08-20T00:00:01Z",
  };
  const newerImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [newerRecord] },
  });
  const repeatedNewerImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [newerRecord] },
  });
  assert.equal(newerImport.payload.changed, 1);
  assert.equal(repeatedNewerImport.payload.changed, 0);
  const importAudits = await db.prepare(
    "SELECT COUNT(*) AS count FROM task12_account_audit_logs WHERE action = 'account_import' AND target_user_id = ?1",
  ).bind(importedRecord.id).first();
  assert.equal(importAudits.count, 2);
  const imported = await db.prepare("SELECT id, session_version FROM task12_users WHERE id = ?1")
    .bind(importedRecord.id).first();
  assert.equal(imported.id, importedRecord.id);
  assert.equal(imported.session_version, 4);

  const raceUserId = "task12-login-race-id";
  const raceSecret = "Task12-Race-Secret!";
  const raceIterations = 2_000_000;
  const raceHash = legacyHashSecret(raceSecret, raceIterations);
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, banned, permanent_ban, session_version,
    registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, 'task12-login-race', 'task12-login-race', ?2, 'pbkdf2_sha256',
    ?3, 'user', 0, 0, 2, ?4, ?4, ?4, ?4)`)
    .bind(raceUserId, raceHash, raceIterations, importedAt).run();
  const racingLogin = loginAccount(
    db, "task12-login-race", raceSecret, loginRequest(), passwordOptions(),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  await db.prepare(`UPDATE task12_users SET banned = 1, permanent_ban = 1,
    session_version = session_version + 1 WHERE id = ?1`).bind(raceUserId).run();
  await assert.rejects(
    () => racingLogin,
    (error) => {
      assert.equal(error.code, "account_changed_during_login");
      return true;
    },
  );
  const raceUser = await db.prepare(
    "SELECT password_hash, banned, session_version FROM task12_users WHERE id = ?1",
  ).bind(raceUserId).first();
  assert.equal(raceUser.password_hash, raceHash);
  assert.equal(raceUser.banned, 1);
  assert.equal(raceUser.session_version, 3);
  const raceSessions = await db.prepare(
    "SELECT COUNT(*) AS count FROM task12_sessions WHERE user_id = ?1",
  ).bind(raceUserId).first();
  assert.equal(Number(raceSessions.count), 0);
  completed += 1;

  const wrongImportedLogin = await accountRequest(db, "/api/login", {
    method: "POST",
    ip: "198.51.100.6",
    body: { username: "task12-imported", secret: "Task12-Wrong-Imported-Secret!" },
  });
  assert.equal(wrongImportedLogin.response.status, 403);
  assert.equal(wrongImportedLogin.payload.code, "invalid_credentials");
  const notUpgraded = await db.prepare(
    "SELECT password_hash, password_scheme FROM task12_users WHERE id = ?1",
  ).bind(importedRecord.id).first();
  assert.equal(notUpgraded.password_scheme, "pbkdf2_sha256");
  assert.ok(notUpgraded.password_hash.startsWith("pbkdf2_sha256$310000$"));
  const importedLoginResponse = await accountRequest(db, "/api/login", {
    method: "POST",
    ip: "198.51.100.8",
    body: { username: "task12-imported", secret: IMPORTED_SECRET },
  });
  assert.equal(importedLoginResponse.response.status, 200, JSON.stringify(importedLoginResponse.payload));
  const importedLogin = { session: importedLoginResponse.payload.session };
  const upgradedImported = await db.prepare(
    "SELECT password_hash, password_scheme FROM task12_users WHERE id = ?1",
  ).bind(importedRecord.id).first();
  assert.equal(upgradedImported.password_scheme, "pbkdf2_sha256");
  assert.ok(upgradedImported.password_hash.startsWith("pbkdf2_sha256_cf_v1$310000$"));
  assert.equal(legacyVerificationRequests, 0);
  const importedAccount = await resolveSession(db, importedLogin.session);
  await changeOwnSecret(
    db, importedAccount, IMPORTED_SECRET, "Task12-Imported-New-Secret!", passwordOptions(),
  );
  const staleImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [importedRecord] },
  });
  assert.equal(staleImport.payload.changed, 0);
  await assert.rejects(
    () => loginAccount(db, "task12-imported", IMPORTED_SECRET, loginRequest(), passwordOptions()),
  );
  assert.equal(
    (await loginAccount(db, "task12-imported", "Task12-Imported-New-Secret!", loginRequest(), passwordOptions())).account.id,
    importedRecord.id,
  );
  const resetRecord = {
    ...importedRecord,
    id: "task12-reset-required-id",
    username: "task12-reset-required",
    username_normalized: "task12-reset-required",
    password_hash: "",
    password_scheme: "reset_required",
    password_iterations: 0,
  };
  const resetImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [resetRecord] },
  });
  assert.equal(resetImport.payload.changed, 1);
  const resetLogin = await accountRequest(db, "/api/login", {
    method: "POST",
    ip: "198.51.100.9",
    body: { username: resetRecord.username, secret: "unknown-legacy-secret" },
  });
  assert.equal(resetLogin.response.status, 403);
  assert.equal(resetLogin.payload.code, "password_reset_required");
  completed += 1;

  const missingPepper = await accountRequest(db, "/api/register", {
    method: "POST",
    ip: "198.51.100.7",
    env: { WYJ_TASK12_PASSWORD_PEPPER: "" },
    body: {
      username: "task12-no-pepper",
      secret: USER_SECRET,
      confirm_secret: USER_SECRET,
    },
  });
  assert.equal(missingPepper.response.status, 503);
  assert.equal(missingPepper.payload.code, "task12_password_pepper_not_configured");
  completed += 1;

  const registered = await accountRequest(db, "/api/register", {
    method: "POST",
    ip: "198.51.100.10",
    body: { username: "task12-user", secret: USER_SECRET, confirm_secret: USER_SECRET },
  });
  assert.equal(registered.response.status, 201);
  const userId = registered.payload.account.id;
  const storedUser = await db.prepare("SELECT * FROM task12_users WHERE id = ?1").bind(userId).first();
  assert.equal(storedUser.password_scheme, "pbkdf2_sha256");
  assert.equal(storedUser.password_iterations, 310000);
  assert.ok(storedUser.password_hash.startsWith("pbkdf2_sha256_cf_v1$310000$"));
  assert.equal(verifyCloudHashIndependently(USER_SECRET, storedUser.password_hash, PASSWORD_PEPPER), true);
  assert.equal(verifyCloudHashIndependently("wrong-secret", storedUser.password_hash, PASSWORD_PEPPER), false);
  await assert.rejects(
    () => loginAccount(
      db,
      "task12-user",
      USER_SECRET,
      loginRequest(),
      { ...passwordOptions(), passwordPepper: "different-task12-password-pepper-0123456789" },
    ),
  );
  completed += 1;

  const wrong = await accountRequest(db, "/api/login", {
    method: "POST", ip: "198.51.100.11", body: { username: "task12-user", secret: "incorrect-secret" },
  });
  assert.equal(wrong.response.status, 403);
  assert.equal(wrong.payload.code, "invalid_credentials");
  const missing = await accountRequest(db, "/api/login", {
    method: "POST", ip: "198.51.100.12", body: { username: "missing-user", secret: USER_SECRET },
  });
  assert.equal(missing.response.status, 403);
  assert.equal(missing.payload.code, "invalid_credentials");
  const login = await accountRequest(db, "/api/login", {
    method: "POST",
    ip: "198.51.100.13",
    userAgent: "Mozilla/5.0 MicroMessenger iPhone Mobile",
    body: { username: "task12-user", secret: USER_SECRET },
  });
  assert.equal(login.response.status, 200);
  assert.deepEqual(
    login.payload.account.entitlements,
    [],
    JSON.stringify(login.payload.account),
  );
  const firstToken = login.payload.session;
  const current = await accountRequest(db, "/api/me", { token: firstToken });
  assert.equal(current.response.status, 200);
  assert.deepEqual(current.payload.account.entitlements, []);
  const forbiddenAdmin = await accountRequest(db, "/api/admin/users", { token: firstToken });
  assert.equal(forbiddenAdmin.response.status, 403);
  assert.equal(forbiddenAdmin.payload.code, "forbidden");

  const searchFixtureTime = "2026-08-21T09:00:00.000Z";
  await db.batch(Array.from({ length: 23 }, (_, index) => {
    const suffix = String(index).padStart(2, "0");
    return db.prepare(`INSERT INTO task12_users (
      id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, registered_at, created_at, updated_at, source_updated_at
    ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, 'user', ?4, ?4, ?4, ?4)`)
      .bind(`task19-search-id-${suffix}`, `task19search${suffix}`, `task19search${suffix}`, searchFixtureTime);
  }));
  const firstSearchPage = await accountRequest(
    db,
    "/api/admin/users?q=task19search&match=partial&page=1&limit=10",
    { token: migrationAdminLogin.session },
  );
  assert.equal(firstSearchPage.response.status, 200);
  assert.equal(firstSearchPage.payload.total, 23);
  assert.equal(firstSearchPage.payload.users.length, 10);
  assert.equal(firstSearchPage.payload.has_more, true);
  const finalSearchPage = await accountRequest(
    db,
    "/api/admin/users?q=task19search&match=partial&page=3&limit=10",
    { token: migrationAdminLogin.session },
  );
  assert.equal(finalSearchPage.payload.users.length, 3);
  assert.equal(finalSearchPage.payload.has_more, false);
  const exactSearch = await accountRequest(
    db,
    "/api/admin/users?q=TASK19SEARCH07&match=exact&page=1&limit=10",
    { token: migrationAdminLogin.session },
  );
  assert.equal(exactSearch.payload.total, 1);
  assert.equal(exactSearch.payload.users[0].id, "task19-search-id-07");
  for (const forbiddenField of ["password_hash", "password_scheme", "session", "secret", "token_digest"]) {
    assert.equal(Object.hasOwn(exactSearch.payload.users[0], forbiddenField), false);
  }
  const escapedWildcard = await accountRequest(
    db,
    "/api/admin/users?q=%25&match=partial&page=1&limit=10",
    { token: migrationAdminLogin.session },
  );
  assert.equal(escapedWildcard.payload.total, 0);
  const sessionRow = await db.prepare("SELECT token_digest, client_kind FROM task12_sessions WHERE user_id = ?1")
    .bind(userId).first();
  assert.match(sessionRow.token_digest, /^sha256\$[0-9a-f]{64}$/);
  assert.equal(sessionRow.token_digest.includes(firstToken), false);
  assert.equal(sessionRow.client_kind, "webview");
  completed += 2;

  const secondLogin = await loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions());
  const account = await resolveSession(db, secondLogin.session);
  assert.equal(account.id, userId);
  const sessionLearningId = canonicalLearningRecordId("history", "默认", "task12-session-round");
  const initialLearningSync = await requestHandler(handleTask11Request, db, "/api/learning/sync", {
    method: "POST",
    token: firstToken,
    body: {
      schema_version: 1,
      client_id: "task12-session-client-001",
      client_version: "task12-test",
      since_version: 0,
      changes: [{
        data_type: "test_history",
        record_id: sessionLearningId,
        payload: { id: "task12-session-round", score: 60 },
        updated_at: "2026-08-21T08:00:00.000Z",
        deleted: false,
        base_server_version: 0,
      }],
    },
  });
  assert.equal(initialLearningSync.response.status, 200, JSON.stringify(initialLearningSync.payload));
  assert.equal(initialLearningSync.payload.results[0].record_id, sessionLearningId);
  const initialLearningVersion = initialLearningSync.payload.results[0].server_version;
  await changeOwnSecret(db, account, USER_SECRET, NEW_USER_SECRET, passwordOptions());
  assert.equal(await resolveSession(db, firstToken), null);
  assert.equal(await resolveSession(db, secondLogin.session), null);
  const invalidatedSessionSync = await requestHandler(handleTask11Request, db, "/api/learning/sync", {
    method: "POST",
    token: firstToken,
    body: {
      schema_version: 1,
      client_id: "task12-session-client-001",
      client_version: "task12-test",
      since_version: initialLearningVersion,
      changes: [],
    },
  });
  assert.equal(invalidatedSessionSync.response.status, 401);
  await assert.rejects(() => loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions()));
  const changedLogin = await loginAccount(db, "task12-user", NEW_USER_SECRET, loginRequest(), passwordOptions());
  assert.equal((await resolveSession(db, changedLogin.session)).id, userId);
  const resumedLearningBody = {
    schema_version: 1,
    client_id: "task12-session-client-001",
    client_version: "task12-test-restored",
    since_version: initialLearningVersion,
    changes: [{
      data_type: "test_history",
      record_id: sessionLearningId,
      payload: { id: "task12-session-round", score: 95 },
      updated_at: "2026-08-21T09:00:00.000Z",
      deleted: false,
      base_server_version: initialLearningVersion,
    }],
  };
  const resumedLearningSync = await requestHandler(handleTask11Request, db, "/api/learning/sync", {
    method: "POST",
    token: changedLogin.session,
    body: resumedLearningBody,
  });
  assert.equal(resumedLearningSync.response.status, 200, JSON.stringify(resumedLearningSync.payload));
  const repeatedLearningSync = await requestHandler(handleTask11Request, db, "/api/learning/sync", {
    method: "POST",
    token: changedLogin.session,
    body: resumedLearningBody,
  });
  assert.equal(repeatedLearningSync.response.status, 200, JSON.stringify(repeatedLearningSync.payload));
  const persistedLearningRows = await db.prepare(`SELECT COUNT(*) AS count, MAX(payload_json) AS payload_json
    FROM task11_learning_sync_records WHERE user_id = ?1 AND data_type = 'test_history' AND record_id = ?2`)
    .bind(userId, sessionLearningId).first();
  assert.equal(Number(persistedLearningRows.count), 1);
  assert.equal(JSON.parse(persistedLearningRows.payload_json).score, 95);
  completed += 1;

  const adminLogin = migrationAdminLogin;
  const admin = await resolveSession(db, adminLogin.session);
  await adminSetBan(db, admin, userId, true);
  assert.equal(await resolveSession(db, changedLogin.session), null);
  await assert.rejects(() => loginAccount(db, "task12-user", NEW_USER_SECRET, loginRequest(), passwordOptions()));
  await adminSetBan(db, admin, userId, false);
  const afterUnban = await loginAccount(db, "task12-user", NEW_USER_SECRET, loginRequest(), passwordOptions());
  await adminForceLogout(db, admin, userId);
  assert.equal(await resolveSession(db, afterUnban.session), null);
  await adminResetSecret(db, admin, userId, USER_SECRET, passwordOptions());
  const afterReset = await loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions());
  assert.equal((await resolveSession(db, afterReset.session)).id, userId);
  completed += 1;

  const concurrent = await Promise.all(
    Array.from({ length: 13 }, () => loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions())),
  );
  const resolvedConcurrent = await Promise.all(concurrent.map(({ session }) => resolveSession(db, session)));
  assert.equal(resolvedConcurrent.filter(Boolean).length, 12);
  const activeSessions = await db.prepare(
    "SELECT COUNT(*) AS count FROM task12_sessions WHERE user_id = ?1 AND revoked = 0",
  ).bind(userId).first();
  assert.equal(Number(activeSessions.count), 12);
  completed += 1;

  const expiring = concurrent[resolvedConcurrent.findIndex(Boolean)].session;
  const expiringDigest = await sessionStorageKey(expiring);
  await db.prepare("UPDATE task12_sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE token_digest = ?1")
    .bind(expiringDigest).run();
  assert.equal(await resolveSession(db, expiring), null);
  completed += 1;

  const limitedIp = "198.51.100.90";
  const loginBucket = await sha256Hex(`task12-login\u0000${limitedIp}`);
  await db.prepare(`INSERT INTO task12_auth_failure_windows (bucket_key, failure_count, expires_at)
    VALUES (?1, 8, ?2)`).bind(loginBucket, Math.floor(Date.now() / 1000) + 300).run();
  const limitedLogin = await accountRequest(db, "/api/login", {
    method: "POST", ip: limitedIp, body: { username: "task12-user", secret: "wrong-again" },
  });
  assert.equal(limitedLogin.response.status, 429);
  assert.equal(limitedLogin.payload.code, "login_rate_limited");

  const registerIp = "198.51.100.91";
  const windowSeconds = 600;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const registerScope = "POST:/api/register";
  const registerBucket = await sha256Hex(`${registerScope}\u0000${registerIp}\u0000${windowStart}`);
  await db.prepare(`INSERT INTO cloud_rate_limit_windows
    (bucket_key, route, window_started_at, expires_at, request_count)
    VALUES (?1, '/api/register:POST:/api/register', ?2, ?3, 20)`)
    .bind(registerBucket, windowStart, windowStart + windowSeconds).run();
  const limitedRegister = await accountRequest(db, "/api/register", {
    method: "POST", ip: registerIp,
    body: { username: "rate-limited", secret: USER_SECRET, confirm_secret: USER_SECRET },
  });
  assert.equal(limitedRegister.response.status, 429);
  assert.equal(limitedRegister.payload.code, "account_rate_limited");
  completed += 1;

  const ownershipLogin = await loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions());
  const feedback = await requestHandler(handleTask11Request, db, "/api/feedback", {
    method: "POST",
    token: ownershipLogin.session,
    ip: "198.51.100.100",
    body: {
      type: "feature_suggestion",
      title: "Task 12 ownership",
      content: "This feedback must keep the imported stable D1 user ID.",
    },
  });
  assert.equal(feedback.response.status, 201);
  const owner = await db.prepare("SELECT user_id FROM task11_feedback_items WHERE id = ?1")
    .bind(feedback.payload.feedback.id).first();
  assert.equal(owner.user_id, userId);
  completed += 1;

  const originalFetch = globalThis.fetch;
  let upstreamRequest = null;
  try {
    globalThis.fetch = async (input, init) => {
      upstreamRequest = new Request(input, init);
      return Response.json({ ok: true });
    };
    const context = {
      // The identity bridge remains a rollback-only unit-tested asset. Task 12
      // account routes above never receive these variables or invoke this path.
      env: { ...ROLLBACK_LEGACY_ENVIRONMENT, WYJ_DB: db },
      data: { requestId: "task12-bridge-request-001" },
      request: new Request("https://thewyj.uk/api/tools/preferences", {
        headers: { "X-Session-Token": ownershipLogin.session },
      }),
    };
    const bridged = await proxyToLegacy(context);
    assert.equal(bridged.status, 200);
    assert.ok(upstreamRequest);
    assert.equal(upstreamRequest.headers.has("X-Session-Token"), false);
    const issuedAt = upstreamRequest.headers.get(bridgeTesting.BRIDGE_HEADERS.issuedAt);
    const canonical = bridgeTesting.canonicalIdentity({
      userId,
      username: "task12-user",
      issuedAt,
      requestId: "task12-bridge-request-001",
      method: "GET",
      pathname: "/api/tools/preferences",
    });
    const expected = createHmac("sha256", BRIDGE_SECRET).update(canonical).digest("base64url");
    assert.equal(upstreamRequest.headers.get(bridgeTesting.BRIDGE_HEADERS.signature), expected);
    const noBridge = await proxyToLegacy({
      ...context,
      env: { ...ROLLBACK_LEGACY_ENVIRONMENT, WYJ_DB: db, WYJ_LEGACY_IDENTITY_BRIDGE_SECRET: "" },
    });
    assert.equal(noBridge.status, 503);
    assert.equal((await noBridge.json()).code, "task12_legacy_bridge_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
  }
  completed += 1;

  const deleteLogin = await loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions());
  await adminDeleteUser(db, admin, userId);
  assert.equal(await resolveSession(db, deleteLogin.session), null);
  await assert.rejects(() => loginAccount(db, "task12-user", USER_SECRET, loginRequest(), passwordOptions()));
  completed += 1;

  console.log(`Task 12 Miniflare/D1 checks passed: ${completed}`);
} finally {
  globalThis.fetch = nativeFetch;
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
