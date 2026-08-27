import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { sha256Hex } from "../functions/_lib/cloudflare-foundation.mjs";
import { runStructuredAi } from "../functions/_lib/task15-ai.mjs";
import { __testing as serviceTesting } from "../functions/_lib/task15-service.mjs";
import { handleTask12Request } from "../functions/_lib/task12-api.mjs";
import { handleTask15Request } from "../functions/_lib/task15-api.mjs";
import { TASK15_AI_MODEL } from "../functions/_lib/task15-model.mjs";
import { pdfBytesFromJpegs } from "../js/language/pdf.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const PASSWORD_PEPPER = "task15-isolated-password-pepper-0123456789";
const USER_SECRET = "Task15-User-Secret!";
const ENVIRONMENT = Object.freeze({
  WYJ_ENVIRONMENT: "preview",
  CLOUD_FOUNDATION_ENABLED: "true",
  CLOUD_READS_ENABLED: "true",
  CLOUD_WRITES_ENABLED: "true",
  TASK11_CLOUD_READS_ENABLED: "true",
  TASK11_CLOUD_WRITES_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK15_CLOUD_ONLY_ENABLED: "true",
  TASK15_IMPORT_ENABLED: "true",
  TASK15_PRODUCTION_IMPORT_ENABLED: "false",
  WORKERS_AI_ENABLED: "true",
  LEGACY_API_FALLBACK_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: PASSWORD_PEPPER,
});

let aiMode = "success";
let aiCalls = 0;
const fakeAi = {
  async run(model, input) {
    aiCalls += 1;
    assert.equal(model, TASK15_AI_MODEL);
    if (typeof aiMode === "number") {
      const error = new Error(`synthetic AI HTTP ${aiMode}`);
      error.status = aiMode;
      throw error;
    }
    if (aiMode === "invalid_json") return { response: "{" };
    if (aiMode === "invalid_schema") return { response: JSON.stringify({ unexpected: true }) };
    if (aiMode === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const system = String(input?.messages?.[0]?.content || "");
    const userPayload = JSON.parse(String(input?.messages?.at(-1)?.content || "{}"));
    if (system.includes("补全标准假名")) {
      return { response: JSON.stringify({
        forms: (userPayload.words || []).map((word) => ({ word, reading: "てすと", written: word })),
      }) };
    }
    if (system.includes("生成符合指定学习等级")) {
      return { response: JSON.stringify({ words: ["resilient", "portable", "reliable"] }) };
    }
    if (system.includes("判卷复核")) {
      return { response: JSON.stringify({ correct: true, final_gloss: "难以理解", accepted: ["晦涩难懂"] }) };
    }
    return { response: JSON.stringify({
      gloss: "超长词",
      accepted: ["很长的词"],
      notes: "隔离测试释义",
      reading: "",
    }) };
  },
};

async function request(handler, db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  headers.set("CF-Connecting-IP", options.ip || "198.51.100.15");
  const waits = [];
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, AI: fakeAi, ...(options.env || {}) },
    data: { requestId: crypto.randomUUID() },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    waitUntil(promise) { waits.push(Promise.resolve(promise)); },
  };
  const response = await handler(context);
  await Promise.allSettled(waits);
  return { response, payload: await response.json(), context };
}

async function accountRequest(db, route, options = {}) {
  return await request(handleTask12Request, db, route, options);
}

async function learningRequest(db, route, options = {}) {
  return await request(handleTask15Request, db, route, options);
}

async function assertSessionActive(db, token) {
  const current = await accountRequest(db, "/api/me", { token });
  assert.equal(current.response.status, 200, JSON.stringify(current.payload));
  assert.equal(current.payload.ok, true);
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task15-d1-"));
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
  const migrations = (await readdir(path.join(ROOT, "cloudflare", "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const task15Migrations = [
    "0001_foundation.sql",
    "0002_low_risk_cloud_services.sql",
    "0003_accounts_sessions.sql",
    "0004_session_limit_trigger.sql",
    "0005_session_limit_ordering.sql",
    "0006_memberships_payments.sql",
    "0007_temporary_sharing.sql",
    "0008_task14_user_storage_trigger.sql",
    "0009_task14_global_storage_trigger.sql",
    "0010_task15_cloud_only.sql",
    "0011_task15_import_trigger_order.sql",
  ];
  assert.deepEqual(migrations.slice(0, task15Migrations.length), task15Migrations);
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  assert.equal(
    String((await db.prepare("SELECT value FROM task15_metadata WHERE key = 'schema_version'").first()).value),
    "1",
  );
  completed += 1;

  assert.equal(serviceTesting.validFormsResult({
    forms: [{ word: "未知語", reading: "みちご", written: "未知語" }],
  }, ["未知語", "試験"]), false);
  assert.equal(serviceTesting.validFormsResult({
    forms: [
      { word: "未知語", reading: "みちご", written: "未知語" },
      { word: "未知語", reading: "みちご", written: "未知語" },
    ],
  }, ["未知語", "試験"]), false);
  assert.equal(serviceTesting.validFormsResult({
    forms: [
      { word: "未知語", reading: "みちご", written: "未知語" },
      { word: "試験", reading: "しけん", written: "試験" },
    ],
  }, ["未知語", "試験"]), true);
  completed += 1;

  const registered = await accountRequest(db, "/api/register", {
    method: "POST",
    body: { username: "task15-user", secret: USER_SECRET, confirm_secret: USER_SECRET },
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.payload));
  const login = await accountRequest(db, "/api/login", {
    method: "POST",
    body: { username: "task15-user", secret: USER_SECRET },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.payload));
  const token = login.payload.session;
  const account = login.payload.account;
  assert.ok(token && account.id);
  await assertSessionActive(db, token);
  completed += 1;

  const deniedTools = await learningRequest(db, "/api/tools/access", { token });
  assert.equal(deniedTools.response.status, 403);
  assert.equal(deniedTools.payload.code, "membership_required");
  await assertSessionActive(db, token);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO task13_user_memberships (
      id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
      source, source_ref, created_by, metadata_json, created_at, updated_at
    ) VALUES (?1, ?2, 'all_access_lifetime', ?3, '', 1, 'active',
      'test', ?4, '', '{}', ?3, ?3)`)
    .bind(crypto.randomUUID(), account.id, now, `task15-tools-${account.id}`).run();
  const toolsAccess = await learningRequest(db, "/api/tools/access", { token });
  assert.equal(toolsAccess.response.status, 200, JSON.stringify(toolsAccess.payload));
  assert.equal(toolsAccess.payload.tools_access, true);
  const favorite = await learningRequest(db, "/api/tools/favorite", {
    method: "POST", token, body: { tool_id: "text-stats", favorite: true, pinned: true },
  });
  assert.equal(favorite.response.status, 200, JSON.stringify(favorite.payload));
  await learningRequest(db, "/api/tools/recent", {
    method: "POST", token, body: { tool_id: "text-stats" },
  });
  const saved = await learningRequest(db, "/api/tools/config/save", {
    method: "POST", token,
    body: { tool_id: "text-stats", name: "统计默认值", config: { include_spaces: true } },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  assert.match(saved.payload.id, /^[a-f0-9-]{36}$/u);
  const preferences = await learningRequest(db, "/api/tools/preferences", { token });
  assert.equal(preferences.response.status, 200);
  assert.deepEqual(preferences.payload.favorites.map((item) => item.tool_id), ["text-stats"]);
  assert.deepEqual(preferences.payload.recent.map((item) => item.tool_id), ["text-stats"]);
  assert.equal(preferences.payload.configs[0].config.include_spaces, true);
  await learningRequest(db, "/api/tools/history/clear", { method: "POST", token, body: {} });
  await learningRequest(db, "/api/tools/config/delete", {
    method: "POST", token, body: { id: saved.payload.id },
  });
  const clearedPreferences = await learningRequest(db, "/api/tools/preferences", { token });
  assert.equal(clearedPreferences.payload.recent.length, 0);
  assert.equal(clearedPreferences.payload.configs.length, 0);
  completed += 1;

  const adminSecret = "Task15-Admin-Secret!";
  const adminRegistered = await accountRequest(db, "/api/register", {
    method: "POST",
    body: { username: "task15-admin", secret: adminSecret, confirm_secret: adminSecret },
  });
  assert.equal(adminRegistered.response.status, 201);
  await db.prepare("UPDATE task12_users SET role = 'super_admin' WHERE id = ?1")
    .bind(adminRegistered.payload.account.id).run();
  const adminLogin = await accountRequest(db, "/api/login", {
    method: "POST", body: { username: "task15-admin", secret: adminSecret },
  });
  const adminToken = adminLogin.payload.session;
  const stats = await learningRequest(db, "/api/admin/tool-stats", { token: adminToken });
  assert.equal(stats.response.status, 200, JSON.stringify(stats.payload));
  assert.ok(Array.isArray(stats.payload.tools));
  const userImportDenied = await learningRequest(db, "/api/admin/task15/import/status", { token });
  assert.equal(userImportDenied.response.status, 403);
  assert.equal(userImportDenied.payload.code, "forbidden");
  completed += 1;

  const sourceKey = "task15-test-import";
  const importPayload = {
    source_key: sourceKey,
    kind: "favorites",
    batch_key: "favorites:000000",
    source_count: 2,
    complete: true,
    records: [
      {
        user_id: account.id,
        tool_id: "text-stats",
        pinned: false,
        created_at: now,
        updated_at: now,
      },
      {
        user_id: account.id,
        tool_id: "json-format",
        pinned: false,
        created_at: now,
        updated_at: now,
      },
    ],
  };
  const firstImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: importPayload,
  });
  assert.equal(firstImport.response.status, 200, JSON.stringify(firstImport.payload));
  assert.equal(firstImport.payload.applied, 1);
  const secondImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: importPayload,
  });
  assert.equal(secondImport.response.status, 200);
  assert.equal(secondImport.payload.applied, 0);
  assert.equal(secondImport.payload.replayed, true);
  const importedRows = await db.prepare(
    "SELECT COUNT(*) AS count FROM task15_tool_favorites WHERE user_id = ?1 AND tool_id = 'json-format'",
  ).bind(account.id).first();
  assert.equal(Number(importedRows.count), 1);
  const preservedFavorite = await db.prepare(
    "SELECT pinned, source FROM task15_tool_favorites WHERE user_id = ?1 AND tool_id = 'text-stats'",
  ).bind(account.id).first();
  assert.equal(Number(preservedFavorite.pinned), 1);
  assert.equal(preservedFavorite.source, "cloud");

  await db.batch([
    db.prepare(`INSERT INTO task15_tool_recent_usage (
      id, user_id, tool_id, used_at, source, source_ref
    ) VALUES ('recent-shared-record', ?1, 'text-stats', ?2, 'cloud', '')`).bind(account.id, now),
    db.prepare(`INSERT INTO task15_saved_tool_configs (
      id, user_id, tool_id, name, config_json, created_at, updated_at, source, source_ref
    ) VALUES ('config-shared-record', ?1, 'text-stats', '云端配置', '{"cloud":true}', ?2, ?2, 'cloud', '')`).bind(account.id, now),
  ]);
  const recentImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: {
      source_key: sourceKey,
      kind: "recent",
      batch_key: "recent:000000",
      source_count: 2,
      complete: true,
      records: [
        { id: "recent-shared-record", user_id: account.id, tool_id: "text-stats", used_at: "2026-08-25T00:00:00.000Z" },
        { id: "recent-import-record", user_id: account.id, tool_id: "json-format", used_at: now },
      ],
    },
  });
  assert.equal(recentImport.response.status, 200, JSON.stringify(recentImport.payload));
  assert.equal(recentImport.payload.applied, 1);
  const configImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: {
      source_key: sourceKey,
      kind: "configs",
      batch_key: "configs:000000",
      source_count: 2,
      complete: true,
      records: [
        { id: "config-shared-record", user_id: account.id, tool_id: "text-stats", name: "旧配置", config: { cloud: false }, created_at: now, updated_at: "2026-08-25T00:00:00.000Z" },
        { id: "config-import-record", user_id: account.id, tool_id: "json-format", name: "导入配置", config: { indent: 2 }, created_at: now, updated_at: now },
      ],
    },
  });
  assert.equal(configImport.response.status, 200, JSON.stringify(configImport.payload));
  assert.equal(configImport.payload.applied, 1);
  const importStatus = await learningRequest(db, "/api/admin/task15/import/status", { token: adminToken });
  assert.equal(importStatus.response.status, 200);
  assert.equal(importStatus.payload.counts.complete_batches, 3);
  assert.equal(importStatus.payload.imports.filter((item) => item.source_key === sourceKey).length, 3);
  const scopedImportStatus = await learningRequest(
    db,
    `/api/admin/task15/import/status?source_key=${encodeURIComponent(sourceKey)}`,
    { token: adminToken },
  );
  assert.deepEqual(scopedImportStatus.payload.imports.map((item) => item.kind), ["configs", "favorites", "recent"]);
  const batchStatus = await db.prepare(`SELECT received_count, applied_count
    FROM task15_import_batches WHERE source_key = ?1 AND kind = 'favorites'`).bind(sourceKey).first();
  assert.equal(Number(batchStatus.received_count), 2);
  assert.equal(Number(batchStatus.applied_count), 1);
  const conflictingImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: {
      ...importPayload,
      records: [{ ...importPayload.records[0], pinned: true }],
    },
  });
  assert.equal(conflictingImport.response.status, 409);
  assert.equal(conflictingImport.payload.code, "task15_import_batch_conflict");
  const incompleteSourceKey = "task15-incomplete-import";
  const partialImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: {
      source_key: incompleteSourceKey,
      kind: "favorites",
      batch_key: "favorites:000000",
      source_count: 2,
      complete: false,
      records: [{ user_id: account.id, tool_id: "text-case", pinned: false, created_at: now, updated_at: now }],
    },
  });
  assert.equal(partialImport.response.status, 200, JSON.stringify(partialImport.payload));
  const earlyCompletion = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: {
      source_key: incompleteSourceKey,
      kind: "favorites",
      batch_key: "favorites:000001",
      source_count: 2,
      complete: true,
      records: [],
    },
  });
  assert.equal(earlyCompletion.response.status, 409);
  assert.equal(earlyCompletion.payload.code, "task15_import_incomplete_source");
  await learningRequest(db, "/api/admin/task15/import/rollback", {
    method: "POST", token: adminToken, body: { source_key: incompleteSourceKey },
  });
  const concurrentSourceKey = "task15-concurrent-import";
  const concurrentImports = await Promise.all([
    learningRequest(db, "/api/admin/task15/import", {
      method: "POST", token: adminToken, body: {
        source_key: concurrentSourceKey,
        kind: "favorites",
        batch_key: "favorites:000000",
        source_count: 1,
        complete: true,
        records: [{ user_id: account.id, tool_id: "text-sort", pinned: false, created_at: now, updated_at: now }],
      },
    }),
    learningRequest(db, "/api/admin/task15/import", {
      method: "POST", token: adminToken, body: {
        source_key: concurrentSourceKey,
        kind: "favorites",
        batch_key: "favorites:000001",
        source_count: 1,
        complete: true,
        records: [{ user_id: account.id, tool_id: "text-dedupe", pinned: false, created_at: now, updated_at: now }],
      },
    }),
  ]);
  assert.deepEqual(concurrentImports.map((item) => item.response.status).sort(), [200, 409]);
  assert.equal(
    concurrentImports.find((item) => item.response.status === 409)?.payload.code,
    "task15_import_already_complete",
  );
  const concurrentState = await db.prepare(`SELECT source_count, received_count, complete
    FROM task15_import_batches WHERE source_key = ?1 AND kind = 'favorites'`)
    .bind(concurrentSourceKey).first();
  assert.equal(Number(concurrentState.source_count), 1);
  assert.equal(Number(concurrentState.received_count), 1);
  assert.equal(Number(concurrentState.complete), 1);
  const concurrentRows = await db.prepare(`SELECT COUNT(*) AS count FROM task15_tool_favorites
    WHERE source = 'legacy_import' AND source_ref = ?1`).bind(concurrentSourceKey).first();
  assert.equal(Number(concurrentRows.count), 1);
  await learningRequest(db, "/api/admin/task15/import/rollback", {
    method: "POST", token: adminToken, body: { source_key: concurrentSourceKey },
  });
  const productionImport = await learningRequest(db, "/api/admin/task15/import", {
    method: "POST", token: adminToken, body: importPayload,
    env: { WYJ_ENVIRONMENT: "production", TASK15_PRODUCTION_IMPORT_ENABLED: "false" },
  });
  assert.equal(productionImport.response.status, 403);
  assert.equal(productionImport.payload.code, "task15_production_import_confirmation_required");
  const rollback = await learningRequest(db, "/api/admin/task15/import/rollback", {
    method: "POST", token: adminToken, body: { source_key: sourceKey },
  });
  assert.equal(rollback.response.status, 200, JSON.stringify(rollback.payload));
  const rolledBackRows = await db.prepare(
    "SELECT COUNT(*) AS count FROM task15_tool_favorites WHERE user_id = ?1 AND tool_id = 'json-format'",
  ).bind(account.id).first();
  assert.equal(Number(rolledBackRows.count), 0);
  const rollbackPreserved = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM task15_tool_favorites WHERE user_id = ?1 AND tool_id = 'text-stats' AND source = 'cloud' AND pinned = 1) AS favorite,
    (SELECT COUNT(*) FROM task15_tool_recent_usage WHERE id = 'recent-shared-record' AND source = 'cloud' AND used_at = ?2) AS recent,
    (SELECT COUNT(*) FROM task15_saved_tool_configs WHERE id = 'config-shared-record' AND source = 'cloud' AND name = '云端配置') AS config,
    (SELECT COUNT(*) FROM task15_tool_recent_usage WHERE id = 'recent-import-record') AS imported_recent,
    (SELECT COUNT(*) FROM task15_saved_tool_configs WHERE id = 'config-import-record') AS imported_config`)
    .bind(account.id, now).first();
  assert.equal(Number(rollbackPreserved.favorite), 1);
  assert.equal(Number(rollbackPreserved.recent), 1);
  assert.equal(Number(rollbackPreserved.config), 1);
  assert.equal(Number(rollbackPreserved.imported_recent), 0);
  assert.equal(Number(rollbackPreserved.imported_config), 0);
  completed += 1;

  const healthGet = await learningRequest(db, "/api/health", { token });
  const healthPost = await learningRequest(db, "/api/health", { method: "POST", token, body: {} });
  assert.equal(healthGet.response.status, 200);
  assert.equal(healthPost.response.status, 200);
  assert.equal(healthPost.payload.cloud_only, true);
  completed += 1;

  aiCalls = 0;
  const englishStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "english", words: ["apple", "book"] },
  });
  assert.equal(englishStart.response.status, 200, JSON.stringify(englishStart.payload));
  const englishQuiz = englishStart.payload.quiz_session;
  assert.ok(englishQuiz);
  const appleRubric = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "apple", quiz_session: englishQuiz },
  });
  assert.equal(appleRubric.payload.rubric.gloss, "苹果");
  const appleJudge = await learningRequest(db, "/api/judge", {
    method: "POST", token,
    body: { word: "apple", answer: "苹果", quiz_session: englishQuiz, rubric: appleRubric.payload.rubric, mode: "normal", language: "english" },
  });
  assert.equal(appleJudge.response.status, 200);
  assert.equal(appleJudge.payload.correct, true);
  assert.equal(aiCalls, 0, "common rubric and exact answer must not call Workers AI");
  await assertSessionActive(db, token);
  completed += 1;

  const japaneseStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "japanese", words: ["電話"] },
  });
  assert.equal(japaneseStart.response.status, 200, JSON.stringify(japaneseStart.payload));
  const japaneseQuiz = japaneseStart.payload.quiz_session;
  const readings = await learningRequest(db, "/api/japanese/readings", {
    method: "POST", token, body: { words: ["電話"], quiz_session: japaneseQuiz },
  });
  assert.equal(readings.payload.readings["電話"], "でんわ");
  assert.equal(readings.payload.written_forms["電話"], "電話");
  const phoneJudge = await learningRequest(db, "/api/judge", {
    method: "POST", token,
    body: { word: "電話", answer: "电话", quiz_session: japaneseQuiz, mode: "normal", language: "japanese" },
  });
  assert.equal(phoneJudge.payload.correct, true);
  assert.equal(aiCalls, 0);
  await assertSessionActive(db, token);
  completed += 1;

  const suggested = await learningRequest(db, "/api/vocabulary/suggest", {
    method: "POST", token,
    body: { language: "english", level: "primary_3", count: 10, exclude: [], query: "" },
  });
  assert.equal(suggested.response.status, 200);
  assert.equal(suggested.payload.words.length, 10);
  assert.equal(suggested.payload.selection_source, "local");
  assert.equal(aiCalls, 0);
  const queriedSuggestion = await learningRequest(db, "/api/vocabulary/suggest", {
    method: "POST", token,
    body: { language: "english", level: "primary_3", count: 3, exclude: [], query: "resilient" },
  });
  assert.equal(queriedSuggestion.response.status, 200, JSON.stringify(queriedSuggestion.payload));
  assert.equal(queriedSuggestion.payload.words.length, 3);
  assert.match(queriedSuggestion.payload.selection_source, /workers_ai|cache/u);
  assert.equal(aiCalls, 1);
  completed += 1;

  aiMode = "success";
  const unknownStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "english", words: ["sesquipedalian"] },
  });
  const unknownQuiz = unknownStart.payload.quiz_session;
  const expiredCacheKey = "f".repeat(64);
  await db.prepare(`INSERT INTO task15_ai_cache (
      cache_key, task_type, model, result_json, created_at, expires_at, hit_count, last_hit_at
    ) VALUES (?1, 'rubric', ?2, '{}', '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z', 0, '')`)
    .bind(expiredCacheKey, TASK15_AI_MODEL).run();
  const beforeRubricCalls = aiCalls;
  const firstRubric = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "sesquipedalian", quiz_session: unknownQuiz },
  });
  const secondRubric = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "sesquipedalian", quiz_session: unknownQuiz },
  });
  assert.equal(firstRubric.response.status, 200);
  assert.equal(secondRubric.payload.source, "cache");
  assert.equal(aiCalls, beforeRubricCalls + 1);
  assert.equal(await db.prepare("SELECT cache_key FROM task15_ai_cache WHERE cache_key = ?1")
    .bind(expiredCacheKey).first(), null);
  const reviewedJudge = await learningRequest(db, "/api/judge", {
    method: "POST", token,
    body: {
      word: "sesquipedalian",
      answer: "晦涩得难以理解",
      quiz_session: unknownQuiz,
      rubric: firstRubric.payload.rubric,
      mode: "normal",
      language: "english",
    },
  });
  assert.equal(reviewedJudge.response.status, 200, JSON.stringify(reviewedJudge.payload));
  assert.equal(reviewedJudge.payload.ai_review, true);
  assert.equal(reviewedJudge.payload.rubric.gloss, "难以理解");
  assert.deepEqual(reviewedJudge.payload.rubric.accepted, ["晦涩难懂"]);
  const cacheHits = await db.prepare(
    "SELECT SUM(cache_hit_count) AS count FROM task15_ai_usage_daily",
  ).first();
  assert.ok(Number(cacheHits.count) >= 2);
  completed += 1;

  const failureModes = [401, 403, 429, 500, 502, 503, 504, "invalid_json", "invalid_schema"];
  for (const [index, mode] of failureModes.entries()) {
    aiMode = mode;
    const callsBeforeFailure = aiCalls;
    const result = await learningRequest(db, "/api/judge", {
      method: "POST", token,
      body: {
        word: "sesquipedalian",
        answer: `非常晦涩但不完全相同${index}`,
        quiz_session: unknownQuiz,
        rubric: { language: "英语", gloss: "难以理解", accepted: ["晦涩难懂"], notes: "", reading: "" },
        mode: "normal",
        language: "english",
      },
    });
    assert.equal(result.response.status, 200, `${mode}: ${JSON.stringify(result.payload)}`);
    assert.equal(result.payload.ai_unavailable, true);
    assert.equal(
      aiCalls - callsBeforeFailure,
      [500, 502, 503, 504].includes(mode) ? 2 : 1,
      `${mode}: retry policy mismatch`,
    );
    await assertSessionActive(db, token);
  }
  completed += 1;

  aiMode = "slow";
  const callsBeforeTimeout = aiCalls;
  const timeoutWaits = [];
  const timeoutContext = {
    env: { ...ENVIRONMENT, WYJ_DB: db, AI: fakeAi },
    waitUntil(promise) { timeoutWaits.push(Promise.resolve(promise)); },
  };
  await assert.rejects(
    () => runStructuredAi(timeoutContext, {
      account,
      taskType: "rubric",
      normalizedInput: { language: "英语", word: "timeout-only" },
      schema: { type: "object", properties: { gloss: { type: "string" } }, required: ["gloss"] },
      validate: (value) => Boolean(value?.gloss),
      messages: [{ role: "system", content: "timeout fixture" }, { role: "user", content: "{}" }],
      timeoutMs: 5,
    }),
    (error) => error.code === "ai_timeout",
  );
  await Promise.allSettled(timeoutWaits);
  assert.equal(aiCalls - callsBeforeTimeout, 1, "AI timeout must not start a second non-abortable invocation");
  await assertSessionActive(db, token);
  await db.prepare("UPDATE task15_ai_leases SET lease_token = '', subject_hash = '', leased_until = 0").run();
  completed += 1;

  aiMode = "success";
  const userHash = await sha256Hex(`task15-user\u0000${account.id}`);
  const today = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO task15_ai_usage_daily (
      usage_date, scope_key, scope_type, request_count, success_count, failure_count,
      cache_hit_count, latency_ms_total, updated_at
    ) VALUES (?1, ?2, 'user', 120, 0, 0, 0, 0, ?3)
    ON CONFLICT(usage_date, scope_key) DO UPDATE SET request_count = 120`)
    .bind(today, `user:${userHash}`, new Date().toISOString()).run();
  const globalBeforeUserQuota = Number((await db.prepare(`SELECT request_count FROM task15_ai_usage_daily
    WHERE usage_date = ?1 AND scope_key = 'global'`).bind(today).first())?.request_count || 0);
  const quotaStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "english", words: ["quotaexhaustedword"] },
  });
  const quotaRubric = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "quotaexhaustedword", quiz_session: quotaStart.payload.quiz_session },
  });
  assert.equal(quotaRubric.response.status, 429);
  assert.equal(quotaRubric.payload.code, "quota_exhausted");
  const globalAfterUserQuota = Number((await db.prepare(`SELECT request_count FROM task15_ai_usage_daily
    WHERE usage_date = ?1 AND scope_key = 'global'`).bind(today).first())?.request_count || 0);
  assert.equal(globalAfterUserQuota, globalBeforeUserQuota, "exhausted user quota must not consume global quota");
  await assertSessionActive(db, token);
  await db.prepare("UPDATE task15_ai_usage_daily SET request_count = 0 WHERE usage_date = ?1 AND scope_key = ?2")
    .bind(today, `user:${userHash}`).run();
  await db.prepare(`INSERT INTO task15_ai_usage_daily (
      usage_date, scope_key, scope_type, request_count, success_count, failure_count,
      cache_hit_count, latency_ms_total, updated_at
    ) VALUES (?1, 'global', 'global', 3000, 0, 0, 0, 0, ?2)
    ON CONFLICT(usage_date, scope_key) DO UPDATE SET request_count = 3000`)
    .bind(today, new Date().toISOString()).run();
  const globalQuotaStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "english", words: ["globalquotaonlyword"] },
  });
  const globalQuotaRubric = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "globalquotaonlyword", quiz_session: globalQuotaStart.payload.quiz_session },
  });
  assert.equal(globalQuotaRubric.response.status, 429);
  assert.equal(globalQuotaRubric.payload.code, "quota_exhausted");
  const userAfterGlobalQuota = Number((await db.prepare(`SELECT request_count FROM task15_ai_usage_daily
    WHERE usage_date = ?1 AND scope_key = ?2`).bind(today, `user:${userHash}`).first())?.request_count || 0);
  assert.equal(userAfterGlobalQuota, 0, "exhausted global quota must refund the user reservation");
  await db.prepare("UPDATE task15_ai_usage_daily SET request_count = 0 WHERE usage_date = ?1 AND scope_key = 'global'")
    .bind(today).run();
  completed += 1;

  await db.prepare("UPDATE task15_ai_leases SET lease_token = 'occupied', subject_hash = ?1, leased_until = ?2")
    .bind("a".repeat(64), Math.floor(Date.now() / 1000) + 60).run();
  const busyStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "english", words: ["concurrencyword"] },
  });
  const busyRubric = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "concurrencyword", quiz_session: busyStart.payload.quiz_session },
  });
  assert.equal(busyRubric.response.status, 503);
  assert.equal(busyRubric.payload.code, "ai_busy");
  await assertSessionActive(db, token);
  await db.prepare("UPDATE task15_ai_leases SET lease_token = '', subject_hash = '', leased_until = 0").run();
  completed += 1;

  const localWithoutAi = await learningRequest(db, "/api/rubric", {
    method: "POST", token,
    env: { WORKERS_AI_ENABLED: "false" },
    body: { word: "book", quiz_session: englishQuiz },
  });
  assert.equal(localWithoutAi.response.status, 200);
  const unknownWithoutAi = await learningRequest(db, "/api/rubric", {
    method: "POST", token,
    env: { WORKERS_AI_ENABLED: "false" },
    body: { word: "sesquipedalian", quiz_session: unknownQuiz },
  });
  assert.equal(unknownWithoutAi.response.status, 503);
  assert.equal(unknownWithoutAi.payload.code, "ai_unavailable");
  const unknownJapaneseStart = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token, body: { language: "japanese", words: ["齟齬"] },
  });
  const unknownJapaneseForms = await learningRequest(db, "/api/japanese/readings", {
    method: "POST", token,
    env: { WORKERS_AI_ENABLED: "false" },
    body: { words: ["齟齬"], quiz_session: unknownJapaneseStart.payload.quiz_session },
  });
  assert.equal(unknownJapaneseForms.response.status, 200);
  assert.equal(unknownJapaneseForms.payload.ai_unavailable, true);
  assert.deepEqual(unknownJapaneseForms.payload.unresolved, ["齟齬"]);
  assert.equal(unknownJapaneseForms.payload.written_forms["齟齬"], "齟齬");
  await assertSessionActive(db, token);
  completed += 1;

  const unauthorizedWord = await learningRequest(db, "/api/rubric", {
    method: "POST", token, body: { word: "cat", quiz_session: englishQuiz },
  });
  assert.equal(unauthorizedWord.response.status, 403);
  assert.equal(unauthorizedWord.payload.code, "word_not_authorized");
  await assertSessionActive(db, token);
  const missingSession = await learningRequest(db, "/api/quiz/start", {
    method: "POST", body: { language: "english", words: ["apple"] },
  });
  assert.equal(missingSession.payload.code, "authentication_required");
  const invalidSession = await learningRequest(db, "/api/quiz/start", {
    method: "POST", token: "not-a-real-session", body: { language: "english", words: ["apple"] },
  });
  assert.equal(invalidSession.payload.code, "canonical_session_invalid");
  completed += 1;

  const quizTokenRow = await db.prepare("SELECT token_digest FROM task15_quiz_sessions LIMIT 1").first();
  assert.match(String(quizTokenRow.token_digest), /^[a-f0-9]{64}$/u);
  assert.notEqual(quizTokenRow.token_digest, englishQuiz);
  const cacheRows = await db.prepare("SELECT result_json FROM task15_ai_cache").all();
  const storedAiData = JSON.stringify(cacheRows.results || []);
  assert.equal(storedAiData.includes("非常晦涩但不完全相同"), false);
  assert.equal(storedAiData.includes(token), false);
  completed += 1;

  const pdf = pdfBytesFromJpegs([
    { width: 10, height: 14, bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) },
    { width: 10, height: 14, bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) },
  ]);
  const pdfText = new TextDecoder("latin1").decode(pdf);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 4)), "%PDF");
  assert.match(pdfText, /\/Count 2/u);
  assert.ok(pdfText.endsWith("%%EOF"));
  completed += 1;

  console.log(`Task 15 cloud-only Miniflare checks passed: ${completed}`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}
