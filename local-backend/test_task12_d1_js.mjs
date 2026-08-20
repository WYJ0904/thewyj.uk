import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
const ADMIN_SECRET = "Task12-Admin-Secret!";
const USER_SECRET = "Task12-User-Secret!";
const NEW_USER_SECRET = "Task12-New-User-Secret!";
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
  LEGACY_API_FALLBACK_ENABLED: "true",
  LOCAL_API_BASE: "https://legacy-business.invalid",
  WYJ_ENVIRONMENT: "preview",
  WYJ_LEGACY_IDENTITY_BRIDGE_SECRET: BRIDGE_SECRET,
});
const nativeFetch = globalThis.fetch;
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
  return Response.json({ ok: true });
};

async function requestHandler(handler, db, route, options = {}, legacyProxy = async () => Response.json({ ok: true, source: "legacy" })) {
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
  const response = await handler(context, legacyProxy);
  await Promise.all(waits);
  return { context, response, payload: await response.json() };
}

async function accountRequest(db, route, options = {}) {
  return await requestHandler(handleTask12Request, db, route, options, proxyToLegacy);
}

async function insertAdmin(db) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, 'wyj', 'wyj', ?2, 'pbkdf2_sha256', 310000,
    'super_admin', ?3, ?3, ?3, ?3)`)
    .bind("task12-admin-stable-id", await hashSecret(ADMIN_SECRET), now).run();
}

function loginRequest() {
  return new Request("https://thewyj.uk/api/login", {
    method: "POST",
    headers: { "User-Agent": "Mozilla/5.0 MicroMessenger iPhone Mobile" },
  });
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
  const migrationAdminLogin = await loginAccount(db, "wyj", ADMIN_SECRET, loginRequest());
  const importedAt = "2026-08-20T00:00:00Z";
  const importedRecord = {
    id: "task12-imported-stable-id",
    username: "task12-imported",
    username_normalized: "task12-imported",
    password_hash: await hashSecret("Task12-Imported-Secret!"),
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
  const importedLogin = await loginAccount(
    db, "task12-imported", "Task12-Imported-Secret!", loginRequest(),
  );
  const importedAccount = await resolveSession(db, importedLogin.session);
  await changeOwnSecret(
    db, importedAccount, "Task12-Imported-Secret!", "Task12-Imported-New-Secret!",
  );
  const staleImport = await accountRequest(db, "/api/admin/task12/import", {
    method: "POST",
    token: migrationAdminLogin.session,
    body: { schema_version: 1, kind: "accounts", records: [importedRecord] },
  });
  assert.equal(staleImport.payload.changed, 0);
  await assert.rejects(
    () => loginAccount(db, "task12-imported", "Task12-Imported-Secret!", loginRequest()),
  );
  assert.equal(
    (await loginAccount(db, "task12-imported", "Task12-Imported-New-Secret!", loginRequest())).account.id,
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
  assert.ok(storedUser.password_hash.startsWith("pbkdf2_sha256$310000$"));
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
    ["language_all_access"],
    JSON.stringify(login.payload.account),
  );
  const firstToken = login.payload.session;
  const current = await accountRequest(db, "/api/me", { token: firstToken });
  assert.equal(current.response.status, 200);
  assert.deepEqual(current.payload.account.entitlements, ["language_all_access"]);
  const forbiddenAdmin = await accountRequest(db, "/api/admin/users", { token: firstToken });
  assert.equal(forbiddenAdmin.response.status, 403);
  assert.equal(forbiddenAdmin.payload.code, "forbidden");
  const sessionRow = await db.prepare("SELECT token_digest, client_kind FROM task12_sessions WHERE user_id = ?1")
    .bind(userId).first();
  assert.match(sessionRow.token_digest, /^sha256\$[0-9a-f]{64}$/);
  assert.equal(sessionRow.token_digest.includes(firstToken), false);
  assert.equal(sessionRow.client_kind, "webview");
  completed += 1;

  const secondLogin = await loginAccount(db, "task12-user", USER_SECRET, loginRequest());
  const account = await resolveSession(db, secondLogin.session);
  assert.equal(account.id, userId);
  await changeOwnSecret(db, account, USER_SECRET, NEW_USER_SECRET);
  assert.equal(await resolveSession(db, firstToken), null);
  assert.equal(await resolveSession(db, secondLogin.session), null);
  await assert.rejects(() => loginAccount(db, "task12-user", USER_SECRET, loginRequest()));
  const changedLogin = await loginAccount(db, "task12-user", NEW_USER_SECRET, loginRequest());
  assert.equal((await resolveSession(db, changedLogin.session)).id, userId);
  completed += 1;

  const adminLogin = migrationAdminLogin;
  const admin = await resolveSession(db, adminLogin.session);
  await adminSetBan(db, admin, userId, true);
  assert.equal(await resolveSession(db, changedLogin.session), null);
  await assert.rejects(() => loginAccount(db, "task12-user", NEW_USER_SECRET, loginRequest()));
  await adminSetBan(db, admin, userId, false);
  const afterUnban = await loginAccount(db, "task12-user", NEW_USER_SECRET, loginRequest());
  await adminForceLogout(db, admin, userId);
  assert.equal(await resolveSession(db, afterUnban.session), null);
  await adminResetSecret(db, admin, userId, USER_SECRET);
  const afterReset = await loginAccount(db, "task12-user", USER_SECRET, loginRequest());
  assert.equal((await resolveSession(db, afterReset.session)).id, userId);
  completed += 1;

  const concurrent = await Promise.all(
    Array.from({ length: 13 }, () => loginAccount(db, "task12-user", USER_SECRET, loginRequest())),
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

  const ownershipLogin = await loginAccount(db, "task12-user", USER_SECRET, loginRequest());
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
      env: { ...ENVIRONMENT, WYJ_DB: db },
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
      env: { ...ENVIRONMENT, WYJ_DB: db, WYJ_LEGACY_IDENTITY_BRIDGE_SECRET: "" },
    });
    assert.equal(noBridge.status, 503);
    assert.equal((await noBridge.json()).code, "task12_legacy_bridge_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
  }
  completed += 1;

  const deleteLogin = await loginAccount(db, "task12-user", USER_SECRET, loginRequest());
  await adminDeleteUser(db, admin, userId);
  assert.equal(await resolveSession(db, deleteLogin.session), null);
  await assert.rejects(() => loginAccount(db, "task12-user", USER_SECRET, loginRequest()));
  completed += 1;

  console.log(`Task 12 Miniflare/D1 checks passed: ${completed}`);
} finally {
  globalThis.fetch = nativeFetch;
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
