import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask20Request } from "../functions/_lib/task20-api.mjs";
import { resolveTask12Account } from "../functions/_lib/task12-auth.mjs";
import { hashSecret, sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { resolveSession } from "../functions/_lib/task12-service.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PASSWORD_PEPPER = "task20-test-password-pepper-0123456789";
const SESSION_SECRET = "task20-test-device-session-secret-0123456789";
const USER_SECRET = "Task20-User-Secret!";
const DEVICE_ID = "663a75e0-0c27-4c0b-9ed7-608a8d05c235";
const OTHER_DEVICE_ID = "967db6e2-3d9e-4ef4-9a5a-d12a4bfda357";
const ENVIRONMENT = Object.freeze({
  WYJ_ENVIRONMENT: "preview",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK20_ANDROID_APP_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: PASSWORD_PEPPER,
  WYJ_TASK20_DEVICE_SESSION_SECRET: SESSION_SECRET,
  ANDROID_LATEST_VERSION_CODE: "1",
  ANDROID_LATEST_VERSION_NAME: "1.0.0",
  ANDROID_MINIMUM_VERSION_CODE: "1",
  ANDROID_DOWNLOAD_URL: "",
});

async function requestHandler(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  headers.set("User-Agent", options.userAgent || "thewyj-android/1.0.0 Android/36");
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, ...(options.env || {}) },
    data: { requestId: crypto.randomUUID() },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    waitUntil() {},
  };
  const response = await handleTask20Request(context);
  return { context, response, payload: await response.clone().json() };
}

async function insertUser(db, id = "task20-stable-user-id", username = "task20-user") {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, ?2, ?2, ?3, 'pbkdf2_sha256', 310000, 'user', ?4, ?4, ?4, ?4)`)
    .bind(id, username, await hashSecret(USER_SECRET, PASSWORD_PEPPER), now).run();
}

function loginPayload(deviceId = DEVICE_ID) {
  return {
    username: "task20-user",
    secret: USER_SECRET,
    device_id: deviceId,
    app_version: "1.0.0",
  };
}

function refreshPayload(session, rotationKey = crypto.randomUUID(), deviceId = DEVICE_ID) {
  return {
    refresh_token: session.refresh_token,
    device_id: deviceId,
    rotation_key: rotationKey,
    app_version: "1.0.0",
  };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task20-d1-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"],
  d1Persist: runtime,
});
let completed = 0;

async function test(name, callback) {
  await callback();
  completed += 1;
  console.log(`ok ${completed} - ${name}`);
}

try {
  const db = await mf.getD1Database("WYJ_DB");
  const migrations = (await readdir(path.join(ROOT, "cloudflare", "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  await insertUser(db);

  await test("app configuration exposes stable Android identity without secrets", async () => {
    const result = await requestHandler(db, "/api/app/config");
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.app.name, "thewyj");
    assert.equal(result.payload.app.application_id, "uk.thewyj.app");
    assert.equal(JSON.stringify(result.payload).includes(SESSION_SECRET), false);
    const unsafe = await requestHandler(db, "/api/app/config", {
      env: { ANDROID_DOWNLOAD_URL: "intent://untrusted-app/#Intent;end" },
    });
    assert.equal(unsafe.payload.app.download_url, "");
    const secure = await requestHandler(db, "/api/app/config", {
      env: { ANDROID_DOWNLOAD_URL: "https://thewyj.uk/download/android" },
    });
    assert.equal(secure.payload.app.download_url, "https://thewyj.uk/download/android");
  });

  await test("feature flag keeps Android session endpoints closed by default", async () => {
    const result = await requestHandler(db, "/api/app/config", {
      env: { TASK20_ANDROID_APP_ENABLED: "false" },
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.code, "task20_android_app_disabled");
  });

  await test("long-lived device credentials reject ordinary browser clients", async () => {
    const result = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: loginPayload(),
      userAgent: "Mozilla/5.0 Chrome/140 Safari/537.36",
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "task20_android_client_required");
  });

  await test("invalid password is rejected without issuing device credentials", async () => {
    const result = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: { ...loginPayload(), secret: "wrong-password" },
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "invalid_credentials");
    const count = await db.prepare("SELECT COUNT(*) AS count FROM task20_device_sessions").first();
    assert.equal(Number(count.count), 0);
  });

  let initial;
  await test("Android login preserves stable user ID and issues short access plus rotating refresh", async () => {
    const result = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: loginPayload(),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.account.id, "task20-stable-user-id");
    assert.equal(result.payload.account.username, "task20-user");
    assert.equal(result.payload.access_token.length >= 40, true);
    assert.equal(result.payload.refresh_token.length >= 40, true);
    assert.equal(Date.parse(result.payload.access_expires_at) - Date.now() <= 15 * 60 * 1000, true);
    assert.equal(Date.parse(result.payload.refresh_expires_at) - Date.now() > 170 * 24 * 60 * 60 * 1000, true);
    const cookie = result.response.headers.get("Set-Cookie");
    assert.match(cookie, /^__Host-wyj_app_access=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    initial = result.payload;
  });

  await test("D1 stores token digests only", async () => {
    const row = await db.prepare("SELECT * FROM task20_device_sessions WHERE id = ?1")
      .bind(initial.device_session.id).first();
    assert.equal(row.user_id, "task20-stable-user-id");
    assert.match(row.access_token_digest, /^sha256\$[a-f0-9]{64}$/);
    assert.match(row.refresh_token_digest, /^sha256\$[a-f0-9]{64}$/);
    assert.notEqual(row.access_token_digest, initial.access_token);
    assert.notEqual(row.refresh_token_digest, initial.refresh_token);
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes(initial.access_token), false);
    assert.equal(serialized.includes(initial.refresh_token), false);
  });

  await test("native access works through both header and HttpOnly cookie bridge", async () => {
    const headerAuth = await requestHandler(db, "/api/app/session", { token: initial.access_token });
    assert.equal(headerAuth.response.status, 200);
    assert.equal(headerAuth.payload.account.id, "task20-stable-user-id");
    const cookieAuth = await requestHandler(db, "/api/app/session", {
      headers: { "X-Session-Token": "__wyj_native_cookie__" },
      cookie: `__Host-wyj_app_access=${initial.access_token}`,
    });
    assert.equal(cookieAuth.response.status, 200);
    assert.equal(cookieAuth.payload.account.id, "task20-stable-user-id");
    const resolved = await resolveTask12Account(cookieAuth.context, { touch: false });
    assert.equal(resolved.authenticated, true);
    assert.equal(resolved.account.id, "task20-stable-user-id");
  });

  let rotated;
  const rotationKey = crypto.randomUUID();
  await test("refresh rotates both credentials and invalidates the previous access", async () => {
    const result = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(initial, rotationKey),
    });
    assert.equal(result.response.status, 200);
    assert.notEqual(result.payload.access_token, initial.access_token);
    assert.notEqual(result.payload.refresh_token, initial.refresh_token);
    assert.equal(result.payload.account.id, initial.account.id);
    assert.equal(await resolveSession(db, initial.access_token), null);
    assert.equal((await resolveSession(db, result.payload.access_token)).id, initial.account.id);
    rotated = result.payload;
  });

  await test("same refresh request ID is idempotent after an ambiguous response", async () => {
    const result = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(initial, rotationKey),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.idempotent, true);
    assert.equal(result.payload.access_token, rotated.access_token);
    assert.equal(result.payload.refresh_token, rotated.refresh_token);
  });

  await test("concurrent refresh attempts with different request IDs revoke the token family", async () => {
    const login = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: loginPayload(OTHER_DEVICE_ID),
    });
    const [firstResult, secondResult] = await Promise.all([
      requestHandler(db, "/api/app/session/refresh", {
        method: "POST",
        body: refreshPayload(login.payload, crypto.randomUUID(), OTHER_DEVICE_ID),
      }),
      requestHandler(db, "/api/app/session/refresh", {
        method: "POST",
        body: refreshPayload(login.payload, crypto.randomUUID(), OTHER_DEVICE_ID),
      }),
    ]);
    const results = [firstResult, secondResult];
    assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 401]);
    const rejected = results.find((result) => result.response.status === 401);
    const accepted = results.find((result) => result.response.status === 200);
    assert.equal(rejected.payload.code, "app_refresh_reuse_detected");
    assert.equal(await resolveSession(db, accepted.payload.access_token), null);
    const row = await db.prepare("SELECT revoked, revoke_reason FROM task20_device_sessions WHERE id = ?1")
      .bind(login.payload.device_session.id).first();
    assert.equal(Number(row.revoked), 1);
    assert.equal(row.revoke_reason, "refresh_reuse");
  });

  await test("reusing a rotated refresh with a different request ID revokes the token family", async () => {
    const result = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(initial, crypto.randomUUID()),
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.payload.code, "app_refresh_reuse_detected");
    assert.equal(await resolveSession(db, rotated.access_token), null);
    const row = await db.prepare("SELECT revoked, revoke_reason FROM task20_device_sessions WHERE id = ?1")
      .bind(initial.device_session.id).first();
    assert.equal(Number(row.revoked), 1);
    assert.equal(row.revoke_reason, "refresh_reuse");
  });

  let generationSession;
  await test("account session generation invalidates every Android credential", async () => {
    const login = await requestHandler(db, "/api/app/login", { method: "POST", body: loginPayload() });
    generationSession = login.payload;
    await db.prepare("UPDATE task12_users SET session_version = session_version + 1 WHERE id = ?1")
      .bind("task20-stable-user-id").run();
    const refresh = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(generationSession),
    });
    assert.equal(refresh.response.status, 401);
    assert.equal(refresh.payload.code, "session_generation_invalid");
    assert.equal(await resolveSession(db, generationSession.access_token), null);
    await db.prepare("UPDATE task12_users SET session_version = session_version - 1 WHERE id = ?1")
      .bind("task20-stable-user-id").run();
  });

  await test("device mismatch is rejected and revokes the copied credential", async () => {
    const login = await requestHandler(db, "/api/app/login", { method: "POST", body: loginPayload() });
    const refresh = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(login.payload, crypto.randomUUID(), OTHER_DEVICE_ID),
    });
    assert.equal(refresh.response.status, 401);
    assert.equal(refresh.payload.code, "app_device_mismatch");
    assert.equal(await resolveSession(db, login.payload.access_token), null);
  });

  await test("explicit logout revokes the device session and clears the cookie", async () => {
    const login = await requestHandler(db, "/api/app/login", { method: "POST", body: loginPayload() });
    const result = await requestHandler(db, "/api/app/session/logout", {
      method: "POST",
      token: login.payload.access_token,
      body: { refresh_token: login.payload.refresh_token, device_id: DEVICE_ID },
    });
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get("Set-Cookie"), /Max-Age=0/);
    assert.equal(await resolveSession(db, login.payload.access_token), null);
    const refresh = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(login.payload),
    });
    assert.equal(refresh.payload.code, "app_session_revoked");
  });

  await test("logout with a consumed refresh token revokes an ambiguously rotated session", async () => {
    const login = await requestHandler(db, "/api/app/login", { method: "POST", body: loginPayload() });
    const rotation = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(login.payload),
    });
    assert.equal(rotation.response.status, 200);

    const logout = await requestHandler(db, "/api/app/session/logout", {
      method: "POST",
      body: { refresh_token: login.payload.refresh_token, device_id: DEVICE_ID },
    });
    assert.equal(logout.response.status, 200);
    assert.equal(await resolveSession(db, rotation.payload.access_token), null);
    const refresh = await requestHandler(db, "/api/app/session/refresh", {
      method: "POST",
      body: refreshPayload(rotation.payload),
    });
    assert.equal(refresh.response.status, 401);
    assert.equal(refresh.payload.code, "app_session_revoked");
  });

  await test("same device login replaces any previous account binding", async () => {
    await insertUser(db, "task20-second-user-id", "task20-second");
    const firstLogin = await requestHandler(db, "/api/app/login", { method: "POST", body: loginPayload() });
    const secondLogin = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: { ...loginPayload(), username: "task20-second" },
    });
    assert.equal(secondLogin.payload.account.id, "task20-second-user-id");
    assert.equal(await resolveSession(db, firstLogin.payload.access_token), null);
    const active = await db.prepare(`SELECT user_id FROM task20_device_sessions
      WHERE revoked = 0 AND device_id_digest = (
        SELECT device_id_digest FROM task20_device_sessions WHERE id = ?1
      )`).bind(secondLogin.payload.device_session.id).all();
    assert.deepEqual(active.results.map((row) => row.user_id), ["task20-second-user-id"]);
  });

  await test("missing session secret fails closed", async () => {
    const result = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: { ...loginPayload(), username: "task20-second" },
      env: { WYJ_TASK20_DEVICE_SESSION_SECRET: "" },
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.code, "task20_session_secret_not_configured");
  });

  await test("six-character historical secret logs in without weakening new-secret rules", async () => {
    await insertUser(db, "task20-legacy-six", "task20-six");
    await db.prepare("UPDATE task12_users SET password_hash = ?1 WHERE id = ?2")
      .bind(await hashSecret("123456", PASSWORD_PEPPER), "task20-legacy-six").run();
    const login = await requestHandler(db, "/api/app/login", {
      method: "POST",
      body: { ...loginPayload(crypto.randomUUID()), username: "task20-six", secret: "123456" },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.payload.account.id, "task20-legacy-six");
    const { validateSecret } = await import("../functions/_lib/task12-model.mjs");
    assert.throws(() => validateSecret("123456"));
    assert.equal(validateSecret("1234567"), "1234567");
  });

  console.log(`Task 20 D1 integration tests passed: ${completed}`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
