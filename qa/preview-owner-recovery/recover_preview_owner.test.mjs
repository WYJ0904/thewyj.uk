import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { onRequest as dispatchApi } from "../../functions/api/[[path]].js";
import { sessionStorageKey } from "../../functions/_lib/task12-crypto.mjs";
import {
  PINNED_PREVIEW_OWNER_IDENTIFIER,
  PREVIEW_D1_DATABASE_ID,
  PREVIEW_D1_DATABASE_NAME,
  PREVIEW_RECOVERY_CONFIRM_PHRASE,
  applyPreviewOwnerRecovery,
  assertPreviewRecoveryTarget,
  readPreviewOwnerSnapshot,
} from "../../scripts/preview-owner-recovery-lib.mjs";
import { assertRemoteApplyGates, parseArgs } from "../../scripts/recover_preview_owner.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEST_PEPPER = "preview-owner-recovery-test-pepper-at-least-32-bytes";
const NEW_OWNER_SECRET = "Recovery-Preview-Owner-2026!";

const ENV_FLAGS = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK11_CLOUD_READS_ENABLED: "true",
  TASK11_CLOUD_WRITES_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK18_ADMIN_MESSAGES_ENABLED: "true",
  TASK20_ANDROID_APP_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
  WYJ_TASK12_PASSWORD_PEPPER: TEST_PEPPER,
  WYJ_TASK20_DEVICE_SESSION_SECRET: "preview-owner-recovery-task20-secret-32b",
});

async function createMigratedDb() {
  const persistDir = await mkdtemp(path.join(os.tmpdir(), "wyj-owner-recovery-"));
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-08-06",
    d1Databases: ["WYJ_DB"],
    d1Persist: persistDir,
  });
  const db = await mf.getD1Database("WYJ_DB");
  const migrationsDir = path.join(ROOT, "cloudflare", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  return {
    db,
    async dispose() {
      await mf.dispose();
      await rm(persistDir, { recursive: true, force: true });
    },
  };
}

async function dumpAllTables(db) {
  const tablesResult = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .all();
  const dump = {};
  for (const row of tablesResult.results || []) {
    const tableName = String(row.name);
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await db.prepare(`SELECT * FROM ${quoted}`).all();
    dump[tableName] = rows.results || [];
  }
  return dump;
}

async function apiCall(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const waits = [];
  const context = {
    env: { ...ENV_FLAGS, WYJ_DB: db, ...(options.env || {}) },
    data: { requestId: crypto.randomUUID() },
    request: new Request(`https://preview.thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    waitUntil(promise) { waits.push(promise); },
  };
  const response = await dispatchApi(context);
  await Promise.all(waits);
  const contentType = response.headers.get("Content-Type") || "";
  return {
    status: response.status,
    payload: contentType.includes("application/json") ? await response.json() : null,
  };
}

async function seedSyntheticPreviewState(db, ownerId, ownerUsername = PINNED_PREVIEW_OWNER_IDENTIFIER) {
  const now = "2026-11-12T10:00:00Z";
  const expiredAt = "2026-11-12T12:00:00Z";
  const activeUntil = "2026-11-20T12:00:00Z";
  const adminId = "qa-admin-user-001";
  const regularId = "qa-regular-user-001";

  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, 'super_admin', ?4, ?4, ?4, ?4)`)
    .bind(ownerId, ownerUsername, ownerUsername.toLowerCase(), now).run();

  for (const [id, name] of [[adminId, "qa_normal_admin"], [regularId, "qa_regular_one"]]) {
    await db.prepare(`INSERT INTO task12_users (
      id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, registered_at, created_at, updated_at, source_updated_at
    ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, 'user', ?4, ?4, ?4, ?4)`)
      .bind(id, name, name, now).run();
  }

  // Grant normal admin role via owner (historical Task 18 state).
  await db.prepare(`INSERT INTO task18_admin_roles (
    user_id, role, granted_by_user_id, granted_by_username, granted_at, updated_at
  ) VALUES (?1, 'admin', ?2, ?3, ?4, ?4)`).bind(adminId, ownerId, ownerUsername, now).run();
  await db.prepare(`INSERT INTO task18_admin_role_audit (
    id, actor_user_id, actor_username, actor_role, target_user_id, target_username,
    action, before_role, after_role, success, note, request_id, created_at
  ) VALUES ('role-audit-001', ?1, ?2, 'super_admin', ?3, 'qa_normal_admin', 'admin_grant', 'user', 'admin', 1, 'seed', 'seed-req-1', ?4)`)
    .bind(ownerId, ownerUsername, adminId, now).run();

  // Historical stale (expired, unrevoked) session for owner + active session for normal admin.
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
    .bind(await sessionStorageKey("stale-owner-token"), ownerId, now, expiredAt).run();
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
    .bind(await sessionStorageKey("qa-admin-token"), adminId, now, activeUntil).run();

  // Historical Task 11 / Task 16 rows tied to owner and regular user.
  await db.prepare(`INSERT INTO task11_learning_sync_records (
    user_id, data_type, record_id, payload_json, updated_at, deleted,
    client_id, client_version, server_version, created_at, server_updated_at
  ) VALUES (?1, 'wrong_book', 'hist-rec-1', '{"word":"aeris"}', ?2, 0, 'client-seed-001', '1', 1, ?2, ?2)`)
    .bind(ownerId, now).run();
  await db.prepare(`INSERT INTO task16_finance_transactions (
    id, user_id, direction, amount_minor, currency, note, occurred_at_ms,
    source_kind, created_at, updated_at
  ) VALUES ('hist-tx-001', ?1, 'expense', 1200, 'CNY', 'historical', 1792368000000, 'manual', ?2, ?2)`)
    .bind(regularId, now).run();

  return { adminId, adminToken: "qa-admin-token", regularId };
}

async function testRecoveryLifecycleWithOwnerId(ownerId, label) {
  const fixture = await createMigratedDb();
  try {
    const seeded = await seedSyntheticPreviewState(fixture.db, ownerId);

    // 1. Pre-recovery checks: login and app login fail with password_reset_required.
    const preWebLogin = await apiCall(fixture.db, "/api/login", {
      method: "POST",
      body: { username: PINNED_PREVIEW_OWNER_IDENTIFIER, secret: NEW_OWNER_SECRET },
    });
    assert.equal(preWebLogin.status, 403);
    assert.equal(preWebLogin.payload.code, "password_reset_required");

    const preAppLogin = await apiCall(fixture.db, "/api/app/login", {
      method: "POST",
      headers: { "User-Agent": "thewyj-android/1.3.37" },
      body: {
        username: PINNED_PREVIEW_OWNER_IDENTIFIER,
        secret: NEW_OWNER_SECRET,
        device_id: "11111111-1111-4111-8111-111111111111",
        app_version: "1.3.37",
      },
    });
    assert.equal(preAppLogin.status, 403);
    assert.equal(preAppLogin.payload.code, "password_reset_required");

    // 2. Existing endpoints cannot reset/recover owner.
    const unauthChange = await apiCall(fixture.db, "/api/account/secret", {
      method: "POST",
      body: { current_secret: "anything1", new_secret: NEW_OWNER_SECRET, confirm_secret: NEW_OWNER_SECRET },
    });
    assert.equal(unauthChange.status, 401);

    const adminResetOwner = await apiCall(fixture.db, "/api/admin/secret", {
      method: "POST",
      token: seeded.adminToken,
      body: { user_id: ownerId, secret: NEW_OWNER_SECRET },
    });
    assert.equal(adminResetOwner.status, 403);
    assert.equal(adminResetOwner.payload.code, "owner_protected");

    // 3. Controlled recovery succeeds and preserves UUID, role, and historical data.
    const result = await applyPreviewOwnerRecovery(fixture.db, {
      environment: "preview",
      newSecret: NEW_OWNER_SECRET,
      passwordPepper: TEST_PEPPER,
      now: "2026-11-13T08:00:00Z",
    });
    assert.equal(result.ok, true);
    assert.equal(result.before.owner_id, ownerId);
    assert.equal(result.before.password_scheme, "reset_required");
    assert.equal(result.before.session_version, 1);
    assert.equal(result.after.owner_id, ownerId);
    assert.equal(result.after.username, PINNED_PREVIEW_OWNER_IDENTIFIER);
    assert.equal(result.after.role, "super_admin");
    assert.equal(result.after.password_scheme, "pbkdf2_sha256");
    assert.equal(result.after.password_iterations, 310000);
    assert.equal(result.after.session_version, 2);

    // Ensure no secret or hash leaked in result JSON.
    const resultJson = JSON.stringify(result);
    assert.equal(resultJson.includes(NEW_OWNER_SECRET), false);
    assert.equal(resultJson.includes(TEST_PEPPER), false);
    assert.equal(resultJson.includes("pbkdf2_sha256_cf_v1"), false);

    // 4. Verify stored hash format, revoked stale session, and preserved historical rows.
    const ownerRow = await fixture.db.prepare("SELECT * FROM task12_users WHERE id = ?1").bind(ownerId).first();
    assert.equal(ownerRow.role, "super_admin");
    assert.equal(ownerRow.password_scheme, "pbkdf2_sha256");
    assert.equal(ownerRow.password_hash.startsWith("pbkdf2_sha256_cf_v1$310000$"), true);
    assert.equal(ownerRow.session_version, 2);

    const staleSession = await fixture.db
      .prepare("SELECT revoked FROM task12_sessions WHERE token_digest = ?1")
      .bind(await sessionStorageKey("stale-owner-token")).first();
    assert.equal(staleSession.revoked, 1);

    const staleMe = await apiCall(fixture.db, "/api/me", { token: "stale-owner-token" });
    assert.equal(staleMe.status, 401);

    const histLearning = await fixture.db
      .prepare("SELECT record_id FROM task11_learning_sync_records WHERE user_id = ?1").bind(ownerId).first();
    assert.equal(histLearning.record_id, "hist-rec-1");
    const histTx = await fixture.db
      .prepare("SELECT amount_minor FROM task16_finance_transactions WHERE id = 'hist-tx-001'").first();
    assert.equal(histTx.amount_minor, 1200);

    // 5. Verify audits exist without leaking secret/hash.
    const accountAudit = await fixture.db
      .prepare("SELECT * FROM task12_account_audit_logs WHERE id = ?1").bind(result.account_audit_id).first();
    assert.equal(accountAudit.action, "password_reset");
    assert.equal(accountAudit.target_user_id, ownerId);
    assert.equal(JSON.parse(accountAudit.before_json).password_scheme, "reset_required");
    assert.equal(JSON.parse(accountAudit.after_json).password_scheme, "pbkdf2_sha256");
    assert.equal(accountAudit.after_json.includes(NEW_OWNER_SECRET), false);

    const adminAudit = await fixture.db
      .prepare("SELECT * FROM task18_admin_action_audit WHERE id = ?1").bind(result.admin_audit_id).first();
    assert.equal(adminAudit.action, "preview_owner_credential_recovery");
    assert.equal(adminAudit.actor_role, "super_admin");
    assert.equal(adminAudit.success, 1);

    // 6. Post-recovery normal web login & owner-only endpoints work.
    const wrongLogin = await apiCall(fixture.db, "/api/login", {
      method: "POST",
      body: { username: PINNED_PREVIEW_OWNER_IDENTIFIER, secret: "Wrong-Secret-123" },
    });
    assert.equal(wrongLogin.status, 403);
    assert.equal(wrongLogin.payload.code, "invalid_credentials");

    const login = await apiCall(fixture.db, "/api/login", {
      method: "POST",
      body: { username: PINNED_PREVIEW_OWNER_IDENTIFIER, secret: NEW_OWNER_SECRET },
    });
    assert.equal(login.status, 200, JSON.stringify(login.payload));
    assert.equal(login.payload.account.id, ownerId);
    assert.equal(login.payload.account.is_super_admin, true);
    assert.equal(login.payload.account.role, "super_admin");
    const ownerToken = login.payload.session;

    const rolesRes = await apiCall(fixture.db, "/api/admin/roles", { token: ownerToken });
    assert.equal(rolesRes.status, 200);
    assert.equal(rolesRes.payload.owner.id, ownerId);
    assert.equal(rolesRes.payload.admins.length, 1);

    const task18Status = await apiCall(fixture.db, "/api/admin/task18/status", { token: ownerToken });
    assert.equal(task18Status.status, 200);
    assert.equal(task18Status.payload.counts.owners, 1);

    // 7. Task 20 Android login also works after recovery.
    const appLogin = await apiCall(fixture.db, "/api/app/login", {
      method: "POST",
      headers: { "User-Agent": "thewyj-android/1.3.37" },
      body: {
        username: PINNED_PREVIEW_OWNER_IDENTIFIER,
        secret: NEW_OWNER_SECRET,
        device_id: "11111111-1111-4111-8111-111111111111",
        app_version: "1.3.37",
      },
    });
    assert.equal(appLogin.status, 200, JSON.stringify(appLogin.payload));
    assert.equal(appLogin.payload.account.id, ownerId);
    assert.equal(appLogin.payload.account.is_super_admin, true);

    // 8. Re-running recovery after owner already has pbkdf2_sha256 must fail closed.
    await assert.rejects(
      applyPreviewOwnerRecovery(fixture.db, {
        environment: "preview",
        newSecret: "Another-Secret-2026!",
        passwordPepper: TEST_PEPPER,
      }),
      (err) => err.code === "owner_not_reset_required",
    );

    // 9. Single-owner DB triggers remain enforced.
    await assert.rejects(
      fixture.db.prepare("UPDATE task12_users SET role = 'user' WHERE id = ?1").bind(ownerId).run(),
      /task18_owner_role_protected/,
    );
    console.log(`PASS recovery lifecycle (${label})`);
  } finally {
    await fixture.dispose();
  }
}

async function testAtomicRollbackAndGuards() {
  const fixture = await createMigratedDb();
  try {
    const ownerId = "10f06c88-aaaa-4bbb-8ccc-000000000002";
    await seedSyntheticPreviewState(fixture.db, ownerId);
    const beforeDump = await dumpAllTables(fixture.db);

    // Mid-batch SQL failure must roll back all changes byte-for-byte.
    await assert.rejects(
      applyPreviewOwnerRecovery(fixture.db, {
        environment: "preview",
        newSecret: NEW_OWNER_SECRET,
        passwordPepper: TEST_PEPPER,
        injectFailureAfterUpdate: true,
      }),
    );
    const afterRollbackDump = await dumpAllTables(fixture.db);
    assert.deepEqual(afterRollbackDump, beforeDump, "Failed batch must roll back every table atomically");

    // Guard: weak secret & missing pepper must reject with zero mutations.
    await assert.rejects(
      applyPreviewOwnerRecovery(fixture.db, {
        environment: "preview",
        newSecret: "short",
        passwordPepper: TEST_PEPPER,
      }),
      (err) => err.code === "secret_too_short",
    );
    await assert.rejects(
      applyPreviewOwnerRecovery(fixture.db, {
        environment: "preview",
        newSecret: NEW_OWNER_SECRET,
        passwordPepper: "too-short",
      }),
      (err) => err.code === "password_pepper_not_configured",
    );
    assert.deepEqual(await dumpAllTables(fixture.db), beforeDump);

    // Guard: reject non-preview / wrong database ID.
    assert.throws(
      () => assertPreviewRecoveryTarget({ environment: "production" }),
      (err) => err.code === "forbidden_environment",
    );
    assert.throws(
      () => assertPreviewRecoveryTarget({
        environment: "preview",
        remote: true,
        databaseId: "11c288d8-c584-409f-bb1f-7e7af11793e5",
        databaseName: PREVIEW_D1_DATABASE_NAME,
      }),
      (err) => err.code === "pinned_database_id_mismatch",
    );

    // Guard: reject if an active session already exists for owner.
    await fixture.db.prepare(`INSERT INTO task12_sessions (
      token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
    ) VALUES (?1, ?2, 1, '2026-11-13T00:00:00Z', '2026-11-13T00:00:00Z', '2099-01-01T00:00:00Z', 'browser')`)
      .bind(await sessionStorageKey("active-owner-token"), ownerId).run();
    await assert.rejects(
      applyPreviewOwnerRecovery(fixture.db, {
        environment: "preview",
        newSecret: NEW_OWNER_SECRET,
        passwordPepper: TEST_PEPPER,
      }),
      (err) => err.code === "owner_active_session_exists",
    );
    await fixture.db.prepare("DELETE FROM task12_sessions WHERE user_id = ?1").bind(ownerId).run();

    // Guard: reject non-pinned owner or 'wyj' production identity.
    await fixture.db.exec("DROP TRIGGER task18_owner_role_protected;");
    await fixture.db.prepare("UPDATE task12_users SET username = 'wyj', username_normalized = 'wyj' WHERE id = ?1")
      .bind(ownerId).run();
    await assert.rejects(
      readPreviewOwnerSnapshot(fixture.db).then((snap) =>
        applyPreviewOwnerRecovery(fixture.db, {
          environment: "preview",
          newSecret: NEW_OWNER_SECRET,
          passwordPepper: TEST_PEPPER,
        }),
      ),
      (err) => err.code === "forbidden_production_owner_identity",
    );

    await fixture.db.prepare("UPDATE task12_users SET username = 'other-owner', username_normalized = 'other-owner' WHERE id = ?1")
      .bind(ownerId).run();
    await assert.rejects(
      applyPreviewOwnerRecovery(fixture.db, {
        environment: "preview",
        newSecret: NEW_OWNER_SECRET,
        passwordPepper: TEST_PEPPER,
      }),
      (err) => err.code === "pinned_preview_owner_mismatch",
    );
    console.log("PASS atomic rollback and identity/environment guards");
  } finally {
    await fixture.dispose();
  }
}

function testRemoteCliGates() {
  const base = [
    "--mode", "apply",
    "--remote",
    "--env", "preview",
    "--database-id", PREVIEW_D1_DATABASE_ID,
    "--database-name", PREVIEW_D1_DATABASE_NAME,
    "--write-window-confirmed",
    "--owner-approval-confirmed",
    "--backup-confirmed",
    "--confirm-phrase", PREVIEW_RECOVERY_CONFIRM_PHRASE,
  ];
  assertRemoteApplyGates(parseArgs(base));

  for (const [omittedFlag, expectedCode] of [
    ["--write-window-confirmed", "write_window_unconfirmed"],
    ["--owner-approval-confirmed", "owner_approval_required"],
    ["--backup-confirmed", "backup_unconfirmed"],
  ]) {
    const filtered = base.filter((token) => token !== omittedFlag);
    assert.throws(
      () => assertRemoteApplyGates(parseArgs(filtered)),
      (err) => err.code === expectedCode,
    );
  }
  assert.throws(
    () => assertRemoteApplyGates(parseArgs([...base.slice(0, -1), "WRONG-PHRASE"])),
    (err) => err.code === "confirm_phrase_mismatch",
  );
  console.log("PASS remote CLI authorization gates");
}

await testRecoveryLifecycleWithOwnerId("10f06c88-1111-4222-8333-000000000001", "uuid-id-pinned-username");
await testRecoveryLifecycleWithOwnerId(PINNED_PREVIEW_OWNER_IDENTIFIER, "matching-id-and-username");
await testAtomicRollbackAndGuards();
testRemoteCliGates();
console.log("All Preview Owner minimal recovery tests passed.");
