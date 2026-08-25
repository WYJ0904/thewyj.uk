import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask11Request } from "../functions/_lib/task11-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOKENS = Object.freeze({
  "task11-user-one": { id: "task11-user-1", username: "task11-user-one", is_super_admin: false },
  "task11-user-two": { id: "task11-user-2", username: "task11-user-two", is_super_admin: false },
  "task11-admin": { id: "task11-admin-1", username: "task11-admin", is_super_admin: true },
});
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  CLOUD_READS_ENABLED: "true",
  CLOUD_WRITES_ENABLED: "true",
  TASK11_CLOUD_READS_ENABLED: "true",
  TASK11_CLOUD_WRITES_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  LEGACY_API_FALLBACK_ENABLED: "false",
  TASK11_IMPORT_ENABLED: "true",
  TASK11_PRODUCTION_IMPORT_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "true",
  WYJ_ENVIRONMENT: "development",
});

async function insertAccountsAndSessions(db) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  for (const [token, account] of Object.entries(TOKENS)) {
    const role = account.is_super_admin ? "super_admin" : "user";
    await db.prepare(`INSERT INTO task12_users (
      id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, registered_at, created_at, updated_at, source_updated_at
    ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, ?4, ?5, ?5, ?5, ?5)`)
      .bind(account.id, account.username, account.username.toLowerCase(), role, now).run();
    await db.prepare(`INSERT INTO task12_sessions (
      token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
    ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
      .bind(await sessionStorageKey(token), account.id, now, expires).run();
  }
}

function syncBody(clientId, sinceVersion, changes) {
  return {
    schema_version: 1,
    client_id: clientId,
    client_version: "task11-d1-test",
    since_version: sinceVersion,
    changes,
  };
}

function learningChange(dataType, recordId, payload, updatedAt, baseServerVersion = 0, deleted = false) {
  return {
    data_type: dataType,
    record_id: recordId,
    payload: deleted ? {} : payload,
    updated_at: updatedAt,
    deleted,
    base_server_version: baseServerVersion,
  };
}

async function task11Request(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const waits = [];
  const response = await handleTask11Request({
    env: { ...ENVIRONMENT, WYJ_DB: db, ...(options.env || {}) },
    data: { requestId: options.requestId || crypto.randomUUID() },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    waitUntil(promise) { waits.push(promise); },
  });
  await Promise.all(waits);
  return { response, payload: await response.json() };
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task11-d1-"));
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
    "0001_foundation.sql", "0002_low_risk_cloud_services.sql", "0003_accounts_sessions.sql",
    "0004_session_limit_trigger.sql", "0005_session_limit_ordering.sql",
  ]) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    // D1Database.exec treats physical lines as separate queries; migration files are formatted SQL.
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  await insertAccountsAndSessions(db);

  const changelogRecord = {
    version: "task11.integration",
    build: "task11-cloud-integration",
    date: "2026-08-20",
    title: "Task 11 integration fixture",
    features: ["cloud changelog"],
    improvements: [],
    fixes: [],
    security: ["isolated data"],
    sort_order: 0,
    source_hash: "a".repeat(64),
  };
  const imported = await task11Request(db, "/api/admin/task11/import", {
    method: "POST",
    token: "task11-admin",
    body: { schema_version: 1, kind: "changelog", records: [changelogRecord] },
  });
  assert.equal(imported.response.status, 200);
  assert.equal(imported.payload.received, 1);
  const changelog = await task11Request(db, "/api/changelog");
  assert.equal(changelog.response.status, 200);
  assert.equal(changelog.payload.entries[0].version, changelogRecord.version);
  completed += 1;

  const created = await task11Request(db, "/api/feedback", {
    method: "POST",
    token: "task11-user-one",
    body: {
      type: "feature_suggestion",
      title: "Task 11 suggestion",
      content: "Please keep the cloud migration local-first.",
      route: "/select",
      tool_id: "",
      app_version: "task11-d1-test",
      browser_info: "",
      error_code: "",
    },
  });
  assert.equal(created.response.status, 201);
  const feedbackId = created.payload.feedback.id;
  const own = await task11Request(db, "/api/feedback/mine", { token: "task11-user-one" });
  const other = await task11Request(db, "/api/feedback/mine", { token: "task11-user-two" });
  assert.equal(own.payload.feedback.length, 1);
  assert.equal(other.payload.feedback.length, 0);
  completed += 1;

  for (let index = 0; index < 4; index += 1) {
    const withinLimit = await task11Request(db, "/api/feedback", {
      method: "POST",
      token: "task11-user-one",
      body: {
        type: "other",
        title: `Rate limit fixture ${index}`,
        content: "Task 11 rate limit integration check.",
      },
    });
    assert.equal(withinLimit.response.status, 201);
  }
  const rateLimited = await task11Request(db, "/api/feedback", {
    method: "POST",
    token: "task11-user-one",
    body: {
      type: "other",
      title: "Rate limit overflow",
      content: "This request must be rejected before another feedback row is created.",
    },
  });
  assert.equal(rateLimited.response.status, 429);
  assert.equal(rateLimited.payload.code, "feedback_rate_limited");
  assert.ok(Number(rateLimited.response.headers.get("Retry-After")) > 0);
  completed += 1;

  const accepted = await task11Request(db, "/api/admin/feedback/update", {
    method: "POST",
    token: "task11-admin",
    body: { feedback_id: feedbackId, action: "update", status: "accepted", admin_note: "Accepted" },
  });
  assert.equal(accepted.payload.feedback.status, "accepted");
  const adminList = await task11Request(db, "/api/admin/feedback?status=accepted", { token: "task11-admin" });
  assert.equal(adminList.payload.feedback.length, 1);
  assert.equal(adminList.payload.task11_audit.length, 1);
  completed += 1;

  for (let index = 0; index < 2; index += 1) {
    const voted = await task11Request(db, "/api/feedback/vote", {
      method: "POST",
      token: "task11-user-two",
      body: { feedback_id: feedbackId, voted: true },
    });
    assert.equal(voted.payload.suggestion.vote_count, 1);
  }
  const voting = await task11Request(db, "/api/feedback/voting", { token: "task11-user-two" });
  assert.equal(voting.payload.suggestions[0].voted, true);
  const unvoted = await task11Request(db, "/api/feedback/vote", {
    method: "POST",
    token: "task11-user-two",
    body: { feedback_id: feedbackId, voted: false },
  });
  assert.equal(unvoted.payload.suggestion.vote_count, 0);
  completed += 1;

  const firstTime = new Date(Date.now() - 60_000).toISOString();
  const initial = await task11Request(db, "/api/learning/sync", {
    method: "POST",
    token: "task11-user-one",
    body: syncBody("task11-client-a", 0, [
      learningChange("wrong_book", "wrong:telephone", { wrong_count: 1, accepted: ["电话"] }, firstTime),
    ]),
  });
  assert.equal(initial.response.status, 200);
  const initialVersion = initial.payload.results[0].server_version;
  const concurrentTime = new Date().toISOString();
  const concurrent = await Promise.all([
    task11Request(db, "/api/learning/sync", {
      method: "POST",
      token: "task11-user-one",
      body: syncBody("task11-client-b", 0, [
        learningChange("wrong_book", "wrong:telephone", { wrong_count: 3, accepted: ["telephone"] }, concurrentTime, initialVersion),
      ]),
    }),
    task11Request(db, "/api/learning/sync", {
      method: "POST",
      token: "task11-user-one",
      body: syncBody("task11-client-c", 0, [
        learningChange("wrong_book", "wrong:telephone", { wrong_count: 2, accepted: ["でんわ"] }, concurrentTime, initialVersion),
      ]),
    }),
  ]);
  assert.ok(concurrent.every(({ response }) => response.status === 200));
  const canonicalRow = await db.prepare(`
    SELECT payload_json, server_version FROM task11_learning_sync_records
    WHERE user_id = ?1 AND data_type = 'wrong_book' AND record_id = 'wrong:telephone'
  `).bind("task11-user-1").first();
  const canonical = JSON.parse(canonicalRow.payload_json);
  assert.equal(canonical.wrong_count, 3);
  assert.deepEqual(new Set(canonical.accepted), new Set(["电话", "telephone", "でんわ"]));
  completed += 1;

  const deleted = await task11Request(db, "/api/learning/sync", {
    method: "POST",
    token: "task11-user-one",
    body: syncBody("task11-client-a", 0, [
      learningChange(
        "wrong_book",
        "wrong:telephone",
        {},
        new Date(Date.now() + 1_000).toISOString(),
        Number(canonicalRow.server_version),
        true,
      ),
    ]),
  });
  assert.equal(deleted.payload.results[0].deleted, true);
  const staleRevive = await task11Request(db, "/api/learning/sync", {
    method: "POST",
    token: "task11-user-one",
    body: syncBody("task11-client-b", 0, [
      learningChange("wrong_book", "wrong:telephone", { wrong_count: 9 }, concurrentTime, initialVersion),
    ]),
  });
  assert.equal(staleRevive.payload.results[0].deleted, true);
  assert.equal(staleRevive.payload.accepted_count, 0);
  completed += 1;

  const isolated = await task11Request(db, "/api/learning/sync", {
    method: "POST",
    token: "task11-user-two",
    body: syncBody("task11-client-d", 0, []),
  });
  assert.equal(isolated.payload.changes.length, 0);
  const invalidSession = await task11Request(db, "/api/learning/sync", {
    method: "POST",
    token: "invalid-token",
    body: syncBody("task11-client-z", 0, []),
  });
  assert.equal(invalidSession.response.status, 401);
  completed += 1;

  const telemetry = await task11Request(db, "/api/telemetry", {
    method: "POST",
    body: { feature_id: "learning.sync", outcome: "success", latency_ms: 275, error_code: "" },
  });
  assert.equal(telemetry.response.status, 202);
  assert.equal(telemetry.payload.recorded, true);
  const privateTelemetry = await task11Request(db, "/api/telemetry", {
    method: "POST",
    body: { feature_id: "learning.sync", outcome: "failure", text: "private answer" },
  });
  assert.equal(privateTelemetry.response.status, 400);
  assert.equal(privateTelemetry.payload.code, "telemetry_fields_forbidden");
  const telemetryList = await task11Request(db, "/api/admin/task11/telemetry", { token: "task11-admin" });
  assert.equal(telemetryList.payload.buckets.length, 1);
  assert.equal(telemetryList.payload.buckets[0].event_count, 1);
  assert.equal("user_id" in telemetryList.payload.buckets[0], false);
  completed += 1;

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  const independent = await task11Request(db, "/api/feedback/mine", { token: "task11-user-one" });
  globalThis.fetch = nativeFetch;
  assert.equal(independent.response.status, 200);
  assert.equal(independent.payload.feedback.length >= 1, true);
  completed += 1;

  console.log(`Task 11 Miniflare/D1 checks passed: ${completed}`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
