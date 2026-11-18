import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { onRequest } from "../../functions/api/[[path]].js";
import { hashSecret, sessionStorageKey } from "../../functions/_lib/task12-crypto.mjs";
import { executeAccountErasure, executeErasureR2Tasks, runPrivacyRetentionCleanup } from "../../functions/_lib/task30-privacy-service.mjs";
import { __testing as retentionWorker } from "../../cloudflare/task30-retention-worker.mjs";
import { PRIVACY_CATEGORY_ORDER } from "../../functions/_lib/task30-privacy-catalog.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".wrangler/task30/evidence", `unit-d1-${crypto.randomUUID()}`);
await mkdir(out, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('task30-fixture'); } }",
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
});

const db = await mf.getD1Database("WYJ_DB");
const storage = await mf.getR2Bucket("WYJ_STORAGE");
const env = {
  ...config.env.preview.vars,
  WYJ_DB: db,
  WYJ_STORAGE: storage,
  WYJ_ENVIRONMENT: "development",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  TASK22_TRANSFER_READS_ENABLED: "true",
  TASK22_TRANSFER_WRITES_ENABLED: "true",
  TASK26_ADAPTIVE_LEARNING_ENABLED: "true",
  TASK27_SECURITY_ENABLED: "true",
  TASK29_BACKUP_ENABLED: "true",
  TASK30_PRIVACY_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  WORKERS_AI_ENABLED: "false",
  WYJ_TASK12_PASSWORD_PEPPER: "task30-synthetic-test-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "task30-synthetic-share-secret-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "task30-synthetic-device-secret-0123456789",
  WYJ_TASK27_TOTP_KEY: "dGFzazMwLXN5bnRoZXRpYy10b3RwLWtleS0xMjM0NTY=",
};

for (const file of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  const sql = await readFile(path.join(root, "cloudflare/migrations", file), "utf8");
  await db.exec(sql.replace(/\r?\n/g, " "));
}

const password = "Synthetic-Task30-Password-2026!";
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const expiresFuture = new Date(Date.now() + 7 * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const expiresPast = new Date(Date.now() - 2 * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

async function seedUser(userId, username, sessionToken, role = "user") {
  const pwHash = await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER);
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme, password_iterations,
    role, registered_at, created_at, updated_at
  ) VALUES (?1, ?2, ?2, ?3, 'pbkdf2_sha256', 100000, ?4, ?5, ?5, ?5)`).bind(userId, username, pwHash, role, now).run();
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`).bind(await sessionStorageKey(sessionToken), userId, now, expiresFuture).run();
  await db.prepare(`INSERT INTO task13_user_memberships (
    id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at
  ) VALUES (?1, ?2, 'all_access_lifetime', ?3, '', 1, 'active', 'fixture', 'task30-qa', 'fixture', '{}', ?3, ?3)`)
    .bind(`mem_${userId}`, userId, now).run();
  await db.prepare(`INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)`).bind(userId, now).run();
}

const ownerToken = "task30_owner_token_0000000000000001";
const tokenA = "task30_user_a_token_0000000000000002";
const tokenB = "task30_user_b_token_0000000000000003";
const tokenDelLegacy = "task30_user_del_token_00000000000004";
const ownerId = "task30-owner-0001";
const userA = "task30-user-a-0001";
const userB = "task30-user-b-0002";
const userDelLegacy = "task30-user-del-0003";

await seedUser(ownerId, "task30owner", ownerToken, "super_admin");
await seedUser(userA, "task30usera", tokenA, "user");
await seedUser(userB, "task30userb", tokenB, "user");
await seedUser(userDelLegacy, "task30userdel", tokenDelLegacy, "user");

async function apiCall(route, { method, body, token = tokenA, headers = {}, envOverrides = {} } = {}) {
  const m = method || (body === undefined ? "GET" : "POST");
  const request = new Request(`https://task30.local${route}`, {
    method: m,
    headers: {
      Origin: "https://task30.local",
      "Content-Type": "application/json",
      "X-Finance-Money-Version": "3",
      ...(token ? { "X-Session-Token": token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tasks = [];
  const response = await onRequest({
    request,
    env: { ...env, ...envOverrides },
    data: { requestId: `req-${crypto.randomUUID()}` },
    waitUntil(p) { tasks.push(p); },
  });
  await Promise.all(tasks);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json, headers: response.headers };
}

async function getStepupGrant(token, scope) {
  const res = await apiCall("/api/security/stepup", { token, body: { password, scope } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.grant, "expected immediate grant without MFA");
  return res.body.grant;
}

const proof = { scope: "Miniflare D1 + R2 local unit/integration checks", checks: [], status: "RUNNING" };
async function test(name, fn) {
  await fn();
  proof.checks.push({ name, status: "PASS" });
  console.log("PASS " + name);
}

try {
  // Seed diverse business data for User A and User B
  const CANON_FILE_A = "transfers/v2/development/objects/task30share22f100001/file";
  const CANON_PART_A = "transfers/v2/development/files/task30sess22f100001/part-1";
  const CANON_TEMP_A = "temporary/v1/development/files/task30share14clip01";
  await storage.put(CANON_FILE_A, new Uint8Array([1, 2, 3, 4]));
  await storage.put(CANON_PART_A, new Uint8Array([5, 6]));
  await storage.put(CANON_TEMP_A, new Uint8Array([7, 8, 9]));

  await db.batch([
    db.prepare(`INSERT INTO task16_finance_user_versions VALUES (?1, 3, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_user_versions VALUES (?1, 1, ?2)`).bind(userB, now),
    db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
      VALUES ('cat_a_001', ?1, '餐饮日常', 'expense', '#ff6600', 'active', 1, 1, ?2, ?2, ''),
             ('cat_b_001', ?3, 'UserB交通', 'expense', '#0066ff', 'active', 1, 1, ?2, ?2, '')`).bind(userA, now, userB),
    db.prepare(`INSERT INTO task16_finance_budgets (id, user_id, category_id, period_type, amount_minor, currency, amount_exponent, starts_on, ends_on, status, revision, sync_version, created_at, updated_at, deleted_at)
      VALUES ('bud_a_001', ?1, 'cat_a_001', 'monthly', 150000, 'CNY', 2, '2026-11-01', '2026-11-30', 'active', 1, 1, ?2, ?2, '')`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, amount_exponent, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_by_device, import_source_key, created_at, updated_at, deleted_at)
      VALUES
      ('tx_a_secret_01', ?1, 'expense', 3850, 'CNY', 2, 'cat_a_001', 'SENSITIVE_MERCHANT_STARBUCKS', '', 'SENSITIVE_NOTE_COFFEE', 1763350000000, 'automatic', 'confirmed', 'active', 1, 2, 'dev_android_a', '', ?2, ?2, ''),
      ('tx_b_keep_01', ?3, 'expense', 1200, 'CNY', 2, 'cat_b_001', 'UserBMerchant', '', '', 1763350000000, 'manual', 'confirmed', 'active', 1, 1, 'dev_b', '', ?2, ?2, '')`).bind(userA, now, userB),
    db.prepare(`INSERT INTO task16_finance_raw_events (id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference, direction, amount_minor, currency, merchant, counterparty, account_last4, occurred_at_ms, captured_at_ms, text_fingerprint_sha256, classification, classification_reason, metadata_json, sync_version, created_at)
      VALUES ('raw_a_0001', ?1, 'dev_android_a', 'notification', 'ev_paid_a_001', 'com.tencent.mm', 'wx_order_a_001', 'expense', 3850, 'CNY', 'SENSITIVE_MERCHANT_STARBUCKS', '', '', 1763350000000, 1763350001000, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'accepted', 'direct_match', '{}', 2, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_transaction_events (transaction_id, raw_event_id, relation_status, confidence_milli, evidence_json, linked_by, created_at, updated_at)
      VALUES ('tx_a_secret_01', 'raw_a_0001', 'active', 1000, '["new_canonical_transaction"]', 'automatic', ?1, ?1)`).bind(now),
    db.prepare(`INSERT INTO task16_finance_audit_logs (id, user_id, actor_device_id, action, entity_type, entity_id, before_json, after_json, created_at)
      VALUES ('faud_a_001', ?1, 'dev_android_a', 'transaction_create', 'transaction', 'tx_a_secret_01', '{}', '{"merchant":"SENSITIVE_MERCHANT_STARBUCKS"}', ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_changes (user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at)
      VALUES (?1, 1, 'transaction', 'tx_a_secret_01', 'upsert', 1, '{"merchant":"SENSITIVE_MERCHANT_STARBUCKS","note":"SENSITIVE_NOTE_COFFEE"}', ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task21_notification_events (event_id, user_id, device_id, fingerprint, source_package, source_type, event_type, parser_version, parse_status, direction, amount_minor, currency, payment_channel, merchant, counterparty, confidence, occurred_at_ms, received_at_ms, candidate_id, finance_transaction_id, status, created_at, updated_at, deleted_at, provider_reference)
      VALUES ('ev_paid_a_001', ?1, 'dev_android_a', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'com.tencent.mm', 'notification', 'transaction', 'v2', 'parsed', 'expense', 3850, 'CNY', 'wechat', 'SENSITIVE_MERCHANT_STARBUCKS', '', 950, 1763350000000, 1763350001000, '', 'tx_a_secret_01', 'active', ?2, ?2, '', 'wx_order_a_001')`).bind(userA, now),
    db.prepare(`INSERT INTO task21_notification_candidates (id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty, payment_channel, occurred_at_ms, confidence, status, finance_transaction_id, created_at, updated_at)
      VALUES ('cand_a_001', ?1, 'ev_paid_a_001', 'expense', 3850, 'CNY', 'SENSITIVE_MERCHANT_STARBUCKS', '', 'wechat', 1763350000000, 950, 'confirmed', 'tx_a_secret_01', ?2, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task21_notification_pending_hints (id, user_id, source_event_id, device_id, source_type, source_package, app_label, evidence_summary, amount_minor, direction, merchant, currency, confidence, recognition_status, state, finance_entry_id, created_at, updated_at, provider_reference, payment_channel)
      VALUES ('hint_a_001', ?1, 'hint_ev_a_001', 'dev_android_a', 'notification', 'com.eg.android.AlipayGphone', '支付宝', '{}', 1900, 'expense', 'HintMerchantA', 'CNY', 700, 'PAYMENT_LIKELY', 'pending', '', ?2, ?2, 'ali_ref_a_001', 'alipay')`).bind(userA, now),
    db.prepare(`INSERT INTO finance_ai_consents (user_id, enabled, revision, updated_at) VALUES (?1, 1, 1, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO finance_ai_decisions (user_id, hint_id, input_digest, model_version, model, prompt_version, consent_revision, lease_token, status, input_json, created_at, updated_at)
      VALUES (?1, 'hint_a_001', 'cccc', 'v1', '@cf/mock', 'finance-assistance-6', 1, 'lease1', 'running', '{}', ?2, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task14_shares (id, owner_user_id, share_type, kind, content_text, r2_object_key, created_at, updated_at, expires_at, state, deletion_reason)
      VALUES
      ('t14_clip_a_00001', ?1, 'clipboard', 'clipboard', 'SENSITIVE_CLIPBOARD_SECRET', '', ?2, ?2, ?3, 'active', ''),
      ('t14_file_a_00002', ?1, 'file', 'file', '', 'temporary/v1/development/files/task30share14clip01', ?2, ?2, ?3, 'active', ''),
      ('t14_exp_a_000003', ?1, 'text', 'text', 'Expired Temp Text', '', ?2, ?2, ?4, 'active', '')`).bind(userA, now, expiresFuture, expiresPast),
    db.prepare(`INSERT INTO task14_room_messages (id, room_id, author, message, created_at)
      VALUES ('t14_msg_a_000001', 't14_clip_a_00001', 'usera', 'SENSITIVE_ROOM_CHAT_LINE', ?1)`).bind(now),
    db.prepare(`INSERT INTO task14_download_grants (token_digest, share_id, created_at, expires_at, state)
      VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 't14_file_a_00002', ?1, ?2, 'active')`).bind(now, expiresFuture),
    db.prepare(`INSERT INTO task22_shares (id, owner_kind, owner_ref, file_count, total_bytes, state, expires_at, created_at, updated_at)
      VALUES
      ('t22_share_a_0001', 'user', ?1, 1, 4, 'active', ?3, ?2, ?2),
      ('t22_exp_share_a_2', 'user', ?1, 0, 0, 'active', ?4, ?2, ?2)`).bind(userA, now, expiresFuture, expiresPast),
    db.prepare(`INSERT INTO task22_share_files (share_id, file_id, relative_path, file_name, mime_type, size_bytes, part_size, part_count, sha256_hex, preview_policy, object_key)
      VALUES ('t22_share_a_0001', 't22_file_a_00001', 'secret.txt', 'secret.txt', 'text/plain', 4, 5242880, 1, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'download_only', 'transfers/v2/development/objects/task30share22f100001/file')`),
    db.prepare(`INSERT INTO task22_download_grants (token_digest, share_id, created_at, expires_at, state)
      VALUES ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 't22_share_a_0001', ?1, ?2, 'active')`).bind(now, expiresFuture),
    db.prepare(`INSERT INTO task22_upload_sessions (id, owner_kind, owner_ref, state, file_count, total_bytes, created_at, updated_at, expires_at)
      VALUES ('t22_sess_a_00001', 'user', ?1, 'active', 1, 1024, ?2, ?2, ?3)`).bind(userA, now, expiresFuture),
    db.prepare(`INSERT INTO task22_upload_files (id, session_id, relative_path, file_name, size_bytes, part_count, preview_policy, state, object_key, created_at, updated_at)
      VALUES ('t22_ufile_a_0001', 't22_sess_a_00001', 'part.bin', 'part.bin', 1024, 1, 'download_only', 'allocated', 'transfers/v2/development/files/task30sess22f100001/part-1', ?1, ?1)`).bind(now),
    db.prepare(`INSERT INTO task26_question_tickets (id, user_id, language, knowledge_id, question_id, question_json, point_json, course_version, algorithm_version, mode, issued_at, expires_at)
      VALUES ('tkt_a_001', ?1, 'english', 'k1', 'q1', '{}', '{}', 'v1', 'alg1', 'adaptive', ?2, ?3)`).bind(userA, now, expiresFuture),
    db.prepare(`INSERT INTO task26_learning_events (user_id, event_id, ticket_id, language, knowledge_id, question_id, family, kind, correct, difficulty, accepted_at, algorithm_version, source, platform, channel, input_digest)
      VALUES (?1, 'evt_learn_a_001', 'tkt_a_001', 'english', 'k1', 'q1', 'fam1', 'answer_submitted', 1, 1, ?2, 'alg1', 'adaptive', 'browser', 'stable', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`).bind(userA, now),
    db.prepare(`INSERT INTO task26_wrong_review_events (user_id, event_id, attempt_id, profile, language, record_id, review_id, kind, correct, accepted_at, input_digest, algorithm_version)
      VALUES (?1, 'wrev_evt_001', 'att_001', 'default', 'english', 'rec1', 'rev1', 'answer', 1, ?2, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'wrong-review-v1')`).bind(userA, now),
    db.prepare(`INSERT INTO task26_wrong_review_states (user_id, profile, language, review_id, last_event_seq, state_json)
      VALUES (?1, 'default', 'english', 'rev1', 1, '{}')`).bind(userA),
    db.prepare(`INSERT INTO task26_mastery_states (user_id, language, knowledge_id, score, confidence, algorithm_version, state_version, last_event_seq, state_json, updated_at)
      VALUES (?1, 'english', 'k1', 50, 0.5, 'alg1', 1, 1, '{}', ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task11_learning_sync_records (user_id, data_type, record_id, payload_json, updated_at, deleted, client_id, client_version, server_version, created_at, server_updated_at)
      VALUES (?1, 'wrong_book', 'w1', '{}', ?2, 0, 'client_a_01', '1.0', 1, ?2, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task11_feedback_items (id, user_id, username, feedback_type, title, content, created_at, updated_at)
      VALUES ('fb_a_001', ?1, 'task30usera', 'feature_suggestion', 'Test Feedback', 'Clean me up', ?2, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO email_center_inbound_threads (thread_id, normalized_subject, original_subject, sender_email, matched_user_id, status, message_count, last_message_at, retention_expires_at, created_at, updated_at)
      VALUES ('th_ret_a_001', 'help', 'Help retained', 'a@example.test', ?1, 'open', 1, ?2, ?3, ?2, ?2),
             ('th_exp_a_002', 'old', 'Old expired', 'a@example.test', ?1, 'closed', 1, ?4, ?4, ?4, ?4)`).bind(userA, now, expiresFuture, expiresPast),
    db.prepare(`INSERT INTO task13_payment_orders (id, order_number, user_id, username_snapshot, plan_code, plan_name_snapshot, amount_cents, currency, status, requested_at, updated_at)
      VALUES ('ord_a_001', 'ORD-30-A1', ?1, 'task30usera', 'all_access_lifetime', 'All Access', 9900, 'CNY', 'approved', ?2, ?2)`).bind(userA, now),
  ]);

  await test("1. 0040 default-off & Feature Flag Fail-Closed checks + Data catalog & owner overview", async () => {
    const seedFlag = await db.prepare("SELECT enabled, kill_switch FROM task25_feature_flags WHERE flag_key = 'task30_privacy_v1'").first();
    assert.equal(Number(seedFlag?.enabled), 0, "0040 migration must seed task30_privacy_v1 with enabled=0");
    assert.equal(Number(seedFlag?.kill_switch), 0, "0040 migration must keep kill_switch=0");

    // Disabled by default (enabled=0) -> fail closed 503
    assert.equal((await apiCall("/api/privacy/v1/catalog", { token: "" })).status, 503);
    assert.equal((await apiCall("/api/privacy/v1/overview", { token: tokenA })).status, 503);

    // Env switch off, missing WYJ_DB, D1 query error/timeout, missing flag row, kill_switch=1 -> all 503
    assert.equal((await apiCall("/api/privacy/v1/overview", { token: tokenA, envOverrides: { TASK30_PRIVACY_ENABLED: "false" } })).status, 503);
    assert.equal((await apiCall("/api/privacy/v1/overview", { token: tokenA, envOverrides: { WYJ_DB: null } })).status, 503);
    const failingDb = {
      prepare() {
        return {
          bind() { return this; },
          first() { return Promise.reject(new Error("D1_TIMEOUT")); },
          all() { return Promise.reject(new Error("D1_TIMEOUT")); },
          run() { return Promise.reject(new Error("D1_TIMEOUT")); },
        };
      },
    };
    assert.equal((await apiCall("/api/privacy/v1/overview", { token: tokenA, envOverrides: { WYJ_DB: failingDb } })).status, 503);

    // Activate feature flag explicitly
    await db.prepare("UPDATE task25_feature_flags SET enabled = 1, kill_switch = 0 WHERE flag_key = 'task30_privacy_v1'").run();

    // Missing flag row still fails closed
    await db.prepare("DELETE FROM task25_feature_flags WHERE flag_key = 'task30_privacy_v1'").run();
    assert.equal((await apiCall("/api/privacy/v1/overview", { token: tokenA })).status, 503);

    // Re-insert enabled=1 & test kill_switch=1
    await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, mutation_id, request_id)
      VALUES ('task30_privacy_v1', 'Task30', 1, 1, '["production","preview","local"]', 10000, 2, ?1, 'm2', 'r2')`).bind(now).run();
    assert.equal((await apiCall("/api/privacy/v1/overview", { token: tokenA })).status, 503);

    await db.prepare("UPDATE task25_feature_flags SET enabled = 1, kill_switch = 0 WHERE flag_key = 'task30_privacy_v1'").run();

    const unauth = await apiCall("/api/privacy/v1/overview", { token: "" });
    assert.equal(unauth.status, 401);

    const catRes = await apiCall("/api/privacy/v1/catalog", { token: "" });
    assert.equal(catRes.status, 200);
    assert.deepEqual(catRes.body.categories.map((c) => c.key), [...PRIVACY_CATEGORY_ORDER]);
    for (const cat of catRes.body.categories) {
      assert.ok(Array.isArray(cat.storage_locations) && cat.storage_locations.length > 0);
      assert.ok(cat.owner && cat.purpose && cat.retention_policy && cat.immediate_invalidation_guarantee && cat.cleanup_completion_criteria);
      assert.equal(typeof cat.self_service_erasable, "boolean");
      assert.equal(typeof cat.present_in_user_backup, "boolean");
    }

    const ov = await apiCall("/api/privacy/v1/overview", { token: tokenA });
    assert.equal(ov.status, 200, JSON.stringify(ov.body));
    const fin = ov.body.categories.find((c) => c.key === "finance");
    assert.equal(fin.cloud_counts.transactions, 1);
    const filesCat = ov.body.categories.find((c) => c.key === "files");
    assert.equal(filesCat.cloud_counts.active_shares, 2);
  });

  await test("2. Owner isolation & cross-account rejection (including admin rejection on user_id mismatch)", async () => {
    const spoofPreview = await apiCall("/api/privacy/v1/erasure/preview", {
      token: tokenB,
      body: { user_id: userA, scope_type: "category", categories: ["finance"] },
    });
    assert.equal(spoofPreview.status, 403);
    assert.equal(spoofPreview.body.code, "privacy_owner_mismatch");

    const adminSpoof = await apiCall("/api/privacy/v1/consents", {
      token: ownerToken,
      body: { user_id: userA, consent_key: "cloud_notification_sync", granted: false },
    });
    assert.equal(adminSpoof.status, 403);
    assert.equal(adminSpoof.body.code, "privacy_owner_mismatch");
  });

  await test("3. Consent revocation stops Finance AI & Cloud notification ingestion (without claiming OS revocation)", async () => {
    const revAi = await apiCall("/api/privacy/v1/consents", {
      token: tokenA,
      body: { consent_key: "finance_ai_assistance", granted: false },
    });
    assert.equal(revAi.status, 200);
    assert.equal(revAi.body.effects.invalidated_ai_decisions, 1);
    const aiDec = await db.prepare("SELECT status FROM finance_ai_decisions WHERE user_id = ?1").bind(userA).first();
    assert.equal(aiDec.status, "invalidated");

    const revNotif = await apiCall("/api/privacy/v1/consents", {
      token: tokenA,
      body: { consent_key: "cloud_notification_sync", granted: false },
    });
    assert.equal(revNotif.status, 200);
    assert.equal(revNotif.body.effects.android_os_permission_unchanged, true);
    assert.equal(revNotif.body.updated_consent.requires_os_action, true);

    const ingestBlocked = await apiCall("/api/notification/ingest", {
      token: tokenA,
      body: {
        schema_version: 1,
        device_id: "dev_android_a",
        operations: [{
          operation_id: "op_blocked_after_revoke_01",
          type: "event.ingest",
          payload: {
            event_id: "ev_new_blocked_001",
            source_type: "notification",
            source_package: "com.tencent.mm",
            direction: "expense",
            amount_minor: 500,
            currency: "CNY",
            occurred_at_ms: 1763359999000,
          },
        }],
      },
    });
    assert.equal(ingestBlocked.status, 403, JSON.stringify(ingestBlocked.body));
    assert.equal(ingestBlocked.body.code, "cloud_notification_sync_revoked");

    const hintBlocked = await apiCall("/api/notification/hints", {
      token: tokenA,
      body: {
        device_id: "dev_android_a",
        hints: [{
          source_event_id: "hint_blocked_001",
          source_type: "notification",
          source_package: "com.tencent.mm",
          amount_minor: 500,
          direction: "expense",
          currency: "CNY",
        }],
      },
    });
    assert.equal(hintBlocked.status, 403, JSON.stringify(hintBlocked.body));
    assert.equal(hintBlocked.body.code, "cloud_notification_sync_revoked");

    const restoreNotif = await apiCall("/api/privacy/v1/consents", {
      token: tokenA,
      body: { consent_key: "cloud_notification_sync", granted: true },
    });
    assert.equal(restoreNotif.status, 200);
  });

  await test("4. Preview/Cancel lifecycle, Confirmation & Step-up enforcement", async () => {
    const pre = await apiCall("/api/privacy/v1/erasure/preview", {
      token: tokenA,
      body: { scope_type: "category", categories: ["files"] },
    });
    assert.equal(pre.status, 200, JSON.stringify(pre.body));
    assert.equal(pre.body.preview.required_confirmation, "DELETE FILES");
    assert.ok(pre.body.preview.r2_objects_count >= 2);

    // Other user cannot cancel User A preview
    const foreignCancel = await apiCall("/api/privacy/v1/erasure/cancel", {
      token: tokenB,
      body: { request_id: pre.body.preview.request_id },
    });
    assert.equal(foreignCancel.status, 403);

    const cancelOk = await apiCall("/api/privacy/v1/erasure/cancel", {
      token: tokenA,
      body: { request_id: pre.body.preview.request_id },
    });
    assert.equal(cancelOk.status, 200);
    assert.equal(cancelOk.body.request.status, "cancelled");

    // Wrong confirmation rejected
    const badConfirm = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["files"],
        confirmation_text: "WRONG",
      },
      headers: { "X-Aeris-Stepup": await getStepupGrant(tokenA, "privacy_data_delete") },
    });
    assert.equal(badConfirm.status, 400);
    assert.equal(badConfirm.body.code, "privacy_confirmation_mismatch");

    // Wrong stepup scope rejected
    const badScopeGrant = await getStepupGrant(tokenA, "password_change");
    const badScope = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["files"],
        confirmation_text: "DELETE FILES",
      },
      headers: { "X-Aeris-Stepup": badScopeGrant },
    });
    assert.equal(badScope.status, 403);
  });

  await test("5. Files & Temporary immediate access revocation + R2 retry_pending -> retry -> completed + idempotency", async () => {
    const idemp = "idem_files_temp_0001";
    const grant = await getStepupGrant(tokenA, "privacy_data_delete");
    const simRes = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["files", "temporary"],
        confirmation_text: "DELETE SELECTED DATA",
        idempotency_key: idemp,
        simulate_r2_failure: true,
      },
      headers: { "X-Aeris-Stepup": grant },
    });
    assert.equal(simRes.status, 200, JSON.stringify(simRes.body));
    assert.equal(simRes.body.request.status, "retry_pending");
    assert.ok(simRes.body.request.access_revoked_at);
    assert.ok(simRes.body.tasks.some((t) => t.status === "retry_pending"));

    // Verify immediate access revocation BEFORE retry completes!
    const s22 = await db.prepare("SELECT state FROM task22_shares WHERE id = 't22_share_a_0001'").first();
    assert.equal(s22.state, "delete_pending");
    const g22 = await db.prepare("SELECT state FROM task22_download_grants WHERE share_id = 't22_share_a_0001'").first();
    assert.equal(g22.state, "revoked");
    const s14 = await db.prepare("SELECT state, content_text FROM task14_shares WHERE id = 't14_clip_a_00001'").first();
    assert.equal(s14.state, "deleted");
    assert.equal(s14.content_text, "");
    const roomMsgs = await db.prepare("SELECT COUNT(*) AS cnt FROM task14_room_messages WHERE room_id = 't14_clip_a_00001'").first();
    assert.equal(roomMsgs.cnt, 0);
    // R2 object still exists while retry_pending
    assert.ok(await storage.get(CANON_FILE_A) !== null);

    // Retry cleanup -> R2 deleted & request completes
    const retryRes = await apiCall("/api/privacy/v1/erasure/retry", {
      token: tokenA,
      body: { request_id: simRes.body.request.id },
    });
    assert.equal(retryRes.status, 200, JSON.stringify(retryRes.body));
    assert.equal(retryRes.body.request.status, "completed");
    assert.equal(retryRes.body.r2_summary.physically_erased_confirmed, true);
    assert.equal(await storage.get(CANON_FILE_A), null);
    assert.equal(await storage.get(CANON_PART_A), null);
    assert.equal(await storage.get(CANON_TEMP_A), null);

    // Idempotent replay without consuming another Step-up grant
    const replayRes = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["files", "temporary"],
        confirmation_text: "DELETE SELECTED DATA",
        idempotency_key: idemp,
      },
    });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.idempotent_replay, true);
    assert.equal(replayRes.body.request.id, simRes.body.request.id);

    // Same idempotency_key with different scope/categories -> 409 conflict
    const idempConflict = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["learning"],
        confirmation_text: "DELETE LEARNING",
        idempotency_key: idemp,
      },
    });
    assert.equal(idempConflict.status, 409);
  });

  await test("6. Finance & Notifications erasure + anti-resurrection across sync, Task21 & Task29 backups (precheck and mid-flight commit)", async () => {
    // Export JSON backup BEFORE erasing finance/notifications
    const expRes = await apiCall("/api/backup/v1/export", { token: tokenA, body: { format: "json" } });
    assert.equal(expRes.status, 200, JSON.stringify(expRes.body));
    const preErasureEnvelope = expRes.body.envelope;

    // Seed an extra transaction tx_a_midflight and precheck it BEFORE erasing finance (to test precheck->erase->commit invalidation)
    await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, amount_exponent, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_by_device, import_source_key, created_at, updated_at, deleted_at)
      VALUES ('tx_a_midflight', ?1, 'expense', 9900, 'CNY', 2, 'cat_a_001', 'Midflight Cafe', '', '', 1763350100000, 'manual', 'confirmed', 'active', 1, 3, 'dev_android_a', '', ?2, ?2, '')`).bind(userA, now).run();
    const cleanPre = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: preErasureEnvelope },
    });
    assert.equal(cleanPre.status, 200);
    // Note: in cleanPre, tx_a_secret_01 is identical -> skipped, can_restore = true with job_id
    assert.ok(cleanPre.body.job_id);

    // Erase finance AND notifications_cloud for User A
    const grantFin = await getStepupGrant(tokenA, "privacy_data_delete");
    const eraseFin = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["finance", "notifications_cloud"],
        confirmation_text: "DELETE SELECTED DATA",
        idempotency_key: "idem_fin_notif_001",
      },
      headers: { "X-Aeris-Stepup": grantFin },
    });
    assert.equal(eraseFin.status, 200, JSON.stringify(eraseFin.body));
    assert.equal(eraseFin.body.request.status, "completed");

    // Verify D1 wiped + logs redacted + User B intact
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).cnt, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task21_notification_events WHERE user_id = ?1").bind(userA).first()).cnt, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task16_finance_transactions WHERE user_id = ?1").bind(userB).first()).cnt, 1);
    const auditSanitized = await db.prepare("SELECT after_json FROM task16_finance_audit_logs WHERE id = 'faud_a_001'").first();
    assert.ok(!auditSanitized.after_json.includes("SENSITIVE_MERCHANT_STARBUCKS"));
    const changeSanitized = await db.prepare("SELECT payload_json FROM task16_finance_changes WHERE user_id = ?1 AND version = 1").bind(userA).first();
    assert.ok(!changeSanitized.payload_json.includes("SENSITIVE_MERCHANT_STARBUCKS"));

    // Attempt resurrection via Task16 transaction.upsert, raw_event.ingest, Task21 ingest, Task21 hints
    const resUpsert = await apiCall("/api/finance/sync", {
      token: tokenA,
      body: {
        schema_version: 1,
        device_id: "old_phone_99",
        platform: "android",
        since_version: 1,
        operations: [{
          operation_id: "op_resurrect_tx_1",
          type: "transaction.upsert",
          entity_id: "tx_a_secret_01",
          base_revision: 0,
          payload: { direction: "expense", amount_minor: 3850, currency: "CNY", category_id: "", occurred_at_ms: 1763350000000, merchant: "Ghost" },
        }],
      },
    });
    assert.equal(resUpsert.status, 409, JSON.stringify(resUpsert.body));
    assert.equal(resUpsert.body.code, "erased_record_resurrection_blocked");

    const resRaw = await apiCall("/api/finance/sync", {
      token: tokenA,
      body: {
        schema_version: 1,
        device_id: "old_phone_99",
        platform: "android",
        since_version: 1,
        operations: [{
          operation_id: "op_resurrect_raw_1",
          type: "raw_event.ingest",
          payload: {
            source_type: "notification",
            source_event_id: "ev_paid_a_001",
            source_provider: "com.tencent.mm",
            provider_reference: "wx_order_a_001",
            text: "微信支付消费 38.50 元",
            direction: "expense",
            amount_minor: 3850,
            currency: "CNY",
            occurred_at_ms: 1763350000000,
            captured_at_ms: 1763350001000,
          },
        }],
      },
    });
    assert.equal(resRaw.status, 409, JSON.stringify(resRaw.body));
    assert.equal(resRaw.body.code, "erased_record_resurrection_blocked");

    const resNotif = await apiCall("/api/notification/ingest", {
      token: tokenA,
      body: {
        schema_version: 1,
        device_id: "old_phone_99",
        operations: [{
          operation_id: "op_resurrect_notif_1",
          type: "event.ingest",
          payload: {
            event_id: "ev_paid_a_001",
            fingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            source_type: "notification",
            event_type: "transaction",
            parse_status: "parsed",
            parser_version: "v2",
            payment_channel: "wechat",
            source_package: "com.tencent.mm",
            provider_reference: "wx_order_a_001",
            direction: "expense",
            amount_minor: 3850,
            currency: "CNY",
            occurred_at_ms: 1763350000000,
            received_at_ms: 1763350001000,
          },
        }],
      },
    });
    assert.equal(resNotif.status, 409, JSON.stringify(resNotif.body));
    assert.equal(resNotif.body.code, "erased_record_resurrection_blocked");

    const resHint = await apiCall("/api/notification/hints", {
      token: tokenA,
      body: {
        device_id: "old_phone_99",
        hints: [{
          source_event_id: "hint_ev_a_001",
          source_type: "notification",
          source_package: "com.eg.android.AlipayGphone",
          payment_channel: "alipay",
          provider_reference: "ali_ref_a_001",
          amount_minor: 1900,
          direction: "expense",
          currency: "CNY",
        }],
      },
    });
    assert.equal(resHint.status, 409);
    assert.equal(resHint.body.code, "erased_record_resurrection_blocked");

    // Precheck old backup -> REJECTED due to permanent erasure tombstones
    const blockedPre = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: preErasureEnvelope },
    });
    assert.equal(blockedPre.status, 200);
    assert.equal(blockedPre.body.can_restore, false);
    assert.ok(blockedPre.body.summary.rejected > 0);
    assert.ok(blockedPre.body.diff_preview.rejected.some((r) => /ERASED_/.test(r.reason)));

    // Commit the precheck job created BEFORE erasure -> rolled_back BACKUP_PLAN_INVALIDATED_BY_ERASURE
    const backupGrant = await getStepupGrant(tokenA, `backup_restore:${cleanPre.body.job_id}`);
    const invalidatedCommit = await apiCall(`/api/backup/v1/restore/jobs/${cleanPre.body.job_id}/commit`, {
      token: tokenA,
      body: { grant: backupGrant },
    });
    assert.equal(invalidatedCommit.status, 409);
    assert.equal(invalidatedCommit.body.code, "BACKUP_PLAN_INVALIDATED_BY_ERASURE");
    assert.equal((await db.prepare("SELECT state FROM task29_restore_jobs WHERE id = ?1").bind(cleanPre.body.job_id).first()).state, "rolled_back");
  });

  await test("7. Learning FK/immutable safe erasure + Support retention exceptions + Cleanup Run", async () => {
    const grantLearn = await getStepupGrant(tokenA, "privacy_data_delete");
    const eraseLearn = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["learning"],
        confirmation_text: "DELETE LEARNING",
        idempotency_key: "idem_learn_001",
      },
      headers: { "X-Aeris-Stepup": grantLearn },
    });
    assert.equal(eraseLearn.status, 200, JSON.stringify(eraseLearn.body));
    assert.equal(eraseLearn.body.request.status, "completed");
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task26_learning_events WHERE user_id = ?1").bind(userA).first()).cnt, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task26_question_tickets WHERE user_id = ?1").bind(userA).first()).cnt, 0);

    // Support partial then blocked_by_retention
    const grantSupp1 = await getStepupGrant(tokenA, "privacy_data_delete");
    const suppPartial = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["support"],
        confirmation_text: "DELETE SUPPORT",
        idempotency_key: "idem_supp_001",
      },
      headers: { "X-Aeris-Stepup": grantSupp1 },
    });
    assert.equal(suppPartial.status, 200, JSON.stringify(suppPartial.body));
    assert.equal(suppPartial.body.request.status, "partially_completed");
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task11_feedback_items WHERE user_id = ?1").bind(userA).first()).cnt, 0);

    const grantSupp2 = await getStepupGrant(tokenA, "privacy_data_delete");
    const suppBlocked = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "category",
        categories: ["support"],
        confirmation_text: "DELETE SUPPORT",
        idempotency_key: "idem_supp_002",
      },
      headers: { "X-Aeris-Stepup": grantSupp2 },
    });
    assert.equal(suppBlocked.status, 200);
    assert.equal(suppBlocked.body.request.status, "blocked_by_retention");

    // Non-owner cannot trigger global cleanup
    const denyCleanup = await apiCall("/api/privacy/v1/cleanup/run", {
      token: tokenA,
      body: {},
    });
    assert.equal(denyCleanup.status, 403);

    // Owner with files_cleanup Step-up executes global cleanup
    const ownerCleanupGrant = await getStepupGrant(ownerToken, "files_cleanup");
    const cleanRes = await apiCall("/api/privacy/v1/cleanup/run", {
      token: ownerToken,
      body: { limit: 20 },
      headers: { "X-Aeris-Stepup": ownerCleanupGrant },
    });
    assert.equal(cleanRes.status, 200, JSON.stringify(cleanRes.body));
    assert.ok(["completed", "partial"].includes(cleanRes.body.cleanup.status));
    const thExpired = await db.prepare("SELECT COUNT(*) AS cnt FROM email_center_inbound_threads WHERE thread_id = 'th_exp_a_002'").first();
    assert.equal(thExpired.cnt, 0);
    const thRetained = await db.prepare("SELECT COUNT(*) AS cnt FROM email_center_inbound_threads WHERE thread_id = 'th_ret_a_001'").first();
    assert.equal(thRetained.cnt, 1);

    // Audit redaction check
    const audits = await db.prepare("SELECT summary_json FROM task30_privacy_audit").all();
    const auditBlob = JSON.stringify(audits.results || []);
    assert.ok(!auditBlob.includes(password));
    assert.ok(!auditBlob.includes("SENSITIVE_MERCHANT_STARBUCKS"));
    assert.ok(!auditBlob.includes("SENSITIVE_CLIPBOARD_SECRET"));
  });

  await test("8. Admin closure protection, Account full closure erasure, and legacy /api/account/delete integration", async () => {
    const adminAttempt = await apiCall("/api/privacy/v1/erasure/commit", {
      token: ownerToken,
      body: { scope_type: "account", categories: ["account_security"], confirmation_text: "DELETE ACCOUNT" },
      headers: { "X-Aeris-Stepup": await getStepupGrant(ownerToken, "privacy_account_delete") },
    });
    assert.equal(adminAttempt.status, 403);
    assert.equal(adminAttempt.body.code, "admin_protected");

    // Account closure via Privacy Center
    const delGrantA = await getStepupGrant(tokenA, "privacy_account_delete");
    const delResA = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenA,
      body: {
        scope_type: "account",
        categories: ["account_security"],
        confirmation_text: "DELETE ACCOUNT",
        idempotency_key: "idem_acc_a_1",
      },
      headers: { "X-Aeris-Stepup": delGrantA },
    });
    assert.equal(delResA.status, 200, JSON.stringify(delResA.body));
    assert.equal(delResA.body.account_deleted, true);

    const userRowA = await db.prepare("SELECT deleted, password_hash FROM task12_users WHERE id = ?1").bind(userA).first();
    assert.equal(userRowA.deleted, 1);
    assert.equal(userRowA.password_hash, "");
    const oldSessionCheck = await apiCall("/api/privacy/v1/overview", { token: tokenA });
    assert.ok([401, 403].includes(oldSessionCheck.status), JSON.stringify(oldSessionCheck.body));
    const sessRowsA = await db.prepare("SELECT revoked FROM task12_sessions WHERE user_id = ?1").bind(userA).all();
    assert.ok(sessRowsA.results.every((r) => Number(r.revoked) === 1));

    // Legacy /api/account/delete triggers executeAccountErasure cleanly
    const legacyGrant = await getStepupGrant(tokenDelLegacy, "account_delete");
    const legacyDel = await apiCall("/api/account/delete", {
      token: tokenDelLegacy,
      body: { secret: password },
      headers: { "X-Aeris-Stepup": legacyGrant },
    });
    assert.equal(legacyDel.status, 200, JSON.stringify(legacyDel.body));
    assert.equal(legacyDel.body.account_deleted, true);
    const reqsDel = await db.prepare("SELECT request_type, status FROM task30_erasure_requests WHERE user_id = ?1").bind(userDelLegacy).all();
    assert.ok(reqsDel.results.some((r) => r.request_type === "account_erasure"));

    // Extra sanity test for executeAccountErasure helper & cleanup runner
    const directCleanup = await runPrivacyRetentionCleanup({ env }, { triggerSource: "scheduled" });
    assert.ok(["completed", "partial"].includes(directCleanup.status));
    assert.ok(executeAccountErasure);
  });

  await test("9. R2 fault injection: missing binding/method, delete/abort errors, not-found idempotency, D1 commit fail, concurrent claim, owner/key mismatch", async () => {
    const reqR2 = `privreq:fault:${crypto.randomUUID()}`;
    const objKey = "temporary/v1/development/files/task30faulttemp0001";
    const mpuKey = "transfers/v2/development/objects/task30faultmpu00001/file";
    await storage.put(objKey, new Uint8Array([1, 2, 3]));
    await db.batch([
      db.prepare(`INSERT INTO task14_shares (id, owner_user_id, share_type, kind, r2_object_key, created_at, updated_at, expires_at, state, deletion_reason)
        VALUES ('t14_fault_share_0001', ?1, 'file', 'file', ?2, ?3, ?3, ?4, 'delete_pending', 'privacy_erasure')`).bind(userB, objKey, now, expiresFuture),
      db.prepare(`INSERT INTO task22_upload_sessions (id, owner_kind, owner_ref, state, file_count, total_bytes, created_at, updated_at, expires_at)
        VALUES ('t22_fault_session_01', 'user', ?1, 'aborted', 1, 10, ?2, ?2, ?3)`).bind(userB, now, expiresFuture),
      db.prepare(`INSERT INTO task22_upload_files (id, session_id, relative_path, file_name, size_bytes, part_count, preview_policy, state, object_key, upload_id, created_at, updated_at)
        VALUES ('t22_fault_ufile_0001', 't22_fault_session_01', 'a.bin', 'a.bin', 10, 1, 'download_only', 'allocated', ?1, 'mpu_fault_001', ?2, ?2)`).bind(mpuKey, now),
      db.prepare(`INSERT INTO task30_erasure_requests (id, user_id, request_type, scope_type, categories_json, mode, status, confirmation_text, stepup_verified, requested_by, request_id, created_at, updated_at)
        VALUES (?1, ?2, 'category_erasure', 'category', '["files","temporary"]', 'commit', 'cleanup_pending', 'DELETE SELECTED DATA', 1, ?2, 'req-fault', ?3, ?3)`).bind(reqR2, userB, now),
      db.prepare(`INSERT INTO task30_erasure_tasks (id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, status, details_json, created_at, updated_at)
        VALUES ('prtask_fault_obj_0001', ?1, ?2, 'temporary', 'r2_object', 't14_fault_share_0001', ?3, 'access_revoked', '{"table":"task14_shares"}', ?4, ?4)`).bind(reqR2, userB, objKey, now),
      db.prepare(`INSERT INTO task30_erasure_tasks (id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, upload_id, status, details_json, created_at, updated_at)
        VALUES ('prtask_fault_mpu_0001', ?1, ?2, 'files', 'r2_multipart', 't22_fault_session_01', ?3, 'mpu_fault_001', 'access_revoked', '{"table":"task22_upload_sessions"}', ?4, ?4)`).bind(reqR2, userB, mpuKey, now),
    ]);

    // 1) Missing R2 binding -> must NEVER complete
    const noStorage = await executeErasureR2Tasks(db, null, reqR2, { environment: "development" });
    assert.equal(noStorage.physically_erased_confirmed, false);
    assert.equal(noStorage.retry_pending_count, 2);
    assert.ok(await storage.get(objKey) !== null);

    // 2) Missing methods on storage -> retry_pending
    const noMethods = await executeErasureR2Tasks(db, {}, reqR2, { environment: "development" });
    assert.equal(noMethods.physically_erased_confirmed, false);
    assert.equal(noMethods.retry_pending_count, 2);

    // 3) Throwing delete & non-404 abort -> retry_pending
    let abortErrCalls = 0;
    const errStorage = {
      async delete() { throw new Error("R2_NET_503"); },
      resumeMultipartUpload() { return { async abort() { abortErrCalls += 1; throw new Error("MPU_NET_503"); } }; },
    };
    const errRes = await executeErasureR2Tasks(db, errStorage, reqR2, { environment: "development" });
    assert.equal(abortErrCalls, 1);
    assert.equal(errRes.retry_pending_count, 2);
    assert.equal(errRes.physically_erased_confirmed, false);

    // 4) Simulate D1 commit failure after R2 succeeds -> must stay incomplete and retry idempotently
    const d1FailRes = await executeErasureR2Tasks(db, {
      async delete(k) { return storage.delete(k); },
      resumeMultipartUpload() { return { async abort() {} }; },
    }, reqR2, { environment: "development", simulateD1CommitFailure: true });
    assert.equal(d1FailRes.retry_pending_count, 2);
    assert.equal(d1FailRes.physically_erased_confirmed, false);

    // 5) Retry after object & upload already gone (credible 404/NoSuchKey/NoSuchUpload) -> completes cleanly & idempotently
    let deleteCalls = 0;
    const goneStorage = {
      async delete() {
        deleteCalls += 1;
        const e = new Error("NoSuchKey");
        e.status = 404;
        throw e;
      },
      resumeMultipartUpload() {
        return {
          async abort() {
            const e = new Error("NoSuchUpload");
            e.status = 404;
            throw e;
          },
        };
      },
    };
    const [concurrent1, concurrent2] = await Promise.all([
      executeErasureR2Tasks(db, goneStorage, reqR2, { environment: "development" }),
      executeErasureR2Tasks(db, goneStorage, reqR2, { environment: "development" }),
    ]);
    assert.equal(deleteCalls, 1, "concurrent claim must prevent duplicate R2 delete on same task");
    assert.ok(concurrent1.physically_erased_confirmed || concurrent2.physically_erased_confirmed);
    assert.equal(concurrent1.failed_count + concurrent2.failed_count, 0);

    // Duplicate retry after completion is a safe no-op
    const replayR2 = await executeErasureR2Tasks(db, goneStorage, reqR2, { environment: "development" });
    assert.equal(deleteCalls, 1);
    assert.equal(replayR2.physically_erased_confirmed, true);

    // 6) Invalid namespace / mismatched owner -> rejected permanently as failed without touching R2
    const foreignKey = "backups/private/secret.wyjbackup";
    await storage.put(foreignKey, new Uint8Array([9, 9]));
    const badReq = `privreq:bad:${crypto.randomUUID()}`;
    await db.batch([
      db.prepare(`INSERT INTO task30_erasure_requests (id, user_id, request_type, scope_type, categories_json, mode, status, confirmation_text, stepup_verified, requested_by, request_id, created_at, updated_at)
        VALUES (?1, ?2, 'category_erasure', 'category', '["files"]', 'commit', 'cleanup_pending', 'DELETE FILES', 1, ?2, 'req-bad', ?3, ?3)`).bind(badReq, userB, now),
      db.prepare(`INSERT INTO task30_erasure_tasks (id, request_id_ref, user_id, category_key, target_type, target_ref, r2_key, status, details_json, created_at, updated_at)
        VALUES ('prtask_bad_key_00001', ?1, ?2, 'files', 'r2_object', 't14_fault_share_0001', ?3, 'access_revoked', '{"table":"task14_shares"}', ?4, ?4)`).bind(badReq, userB, foreignKey, now),
    ]);
    const badRes = await executeErasureR2Tasks(db, storage, badReq, { environment: "development" });
    assert.equal(badRes.failed_count, 1);
    assert.equal(badRes.physically_erased_confirmed, false);
    assert.ok(await storage.get(foreignKey) !== null, "non-canonical key must NEVER be deleted from R2");
  });

  await test("10. Account closure interruption resumes via Scheduled Retention Worker & protections stay active while Task30 flag is OFF", async () => {
    const userC = "task30-user-c-0009";
    const tokenC = "task30_user_c_token_00000000000009";
    await seedUser(userC, "task30userc", tokenC, "user");
    await db.batch([
      db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
        VALUES ('cat_c_001', ?1, 'C分类', 'expense', '#112233', 'active', 1, 1, ?2, ?2, '')`).bind(userC, now),
      db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, amount_exponent, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_by_device, import_source_key, created_at, updated_at, deleted_at)
        VALUES ('tx_c_001', ?1, 'expense', 4200, 'CNY', 2, 'cat_c_001', 'InterruptMerchant', '', '', 1763350000000, 'manual', 'confirmed', 'active', 1, 2, 'dev_android_c01', '', ?2, ?2, '')`).bind(userC, now),
      db.prepare(`INSERT INTO task16_finance_raw_events (id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference, direction, amount_minor, currency, merchant, counterparty, account_last4, occurred_at_ms, captured_at_ms, text_fingerprint_sha256, classification, classification_reason, metadata_json, sync_version, created_at)
        VALUES ('raw_c_001', ?1, 'dev_android_c01', 'notification', 'ev_c_001', 'com.tencent.mm', 'wx_c_001', 'expense', 4200, 'CNY', 'InterruptMerchant', '', '', 1763350000000, 1763350001000, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'accepted', 'direct_match', '{}', 2, ?2)`).bind(userC, now),
    ]);

    const expC = await apiCall("/api/backup/v1/export", { token: tokenC, body: { format: "json" } });
    assert.equal(expC.status, 200);
    const oldBackupPkgC = expC.body.envelope;

    // Also test Task16 raw_event ingest with altered raw id / op id while task30_privacy_v1 is later OFF
    // First, inject interruption during account closure commit -> account locked immediately, durable retry_pending job recorded
    const grantC = await getStepupGrant(tokenC, "privacy_account_delete");
    const interrupted = await apiCall("/api/privacy/v1/erasure/commit", {
      token: tokenC,
      body: {
        scope_type: "account",
        categories: ["account_security"],
        confirmation_text: "DELETE ACCOUNT",
        idempotency_key: "idem_acc_c_interrupt",
        simulate_account_closure_interruption: true,
      },
      headers: { "X-Aeris-Stepup": grantC },
    });
    assert.equal(interrupted.status, 503);

    const rowC = await db.prepare("SELECT deleted, password_hash FROM task12_users WHERE id = ?1").bind(userC).first();
    assert.equal(rowC.deleted, 1, "interrupted closure must NOT roll back account lock");
    assert.equal(rowC.password_hash, "");
    const pendingReqC = await db.prepare("SELECT id, status, error_code FROM task30_erasure_requests WHERE user_id = ?1 AND request_type = 'account_erasure'").bind(userC).first();
    assert.equal(pendingReqC.status, "retry_pending");
    assert.equal(pendingReqC.error_code, "account_erasure_interrupted");

    // Scheduled Task30 Retention Worker resumes interrupted closure cleanly!
    const cronRes = await retentionWorker.runRetention(env);
    assert.equal(cronRes.ok, true, JSON.stringify(cronRes));
    assert.ok(cronRes.cleanup.summary.interrupted_account_erasures_resumed >= 1);
    const finishedReqC = await db.prepare("SELECT status FROM task30_erasure_requests WHERE id = ?1").bind(pendingReqC.id).first();
    assert.equal(finishedReqC.status, "completed");
    assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM task16_finance_transactions WHERE user_id = ?1").bind(userC).first()).cnt, 0);

    // Turn Task30 UI/API kill_switch=1 & enabled=0 -> new requests fail closed 503, YET prior tombstones & backup guards stay active!
    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, kill_switch = 1 WHERE flag_key = 'task30_privacy_v1'").run();
    assert.equal((await apiCall("/api/privacy/v1/erasure/commit", { token: tokenB, body: {} })).status, 503);

    // Test Task29 precheck STILL rejects old valid backup & Task16 STILL blocks altered-ID source_event sync while task30_privacy_v1 is OFF!
    await db.prepare("UPDATE task12_users SET deleted = 0 WHERE id = ?1").bind(userC).run();
    await db.prepare("UPDATE task13_user_memberships SET status = 'active' WHERE user_id = ?1").bind(userC).run();
    await db.prepare("INSERT INTO task12_sessions (token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind) VALUES (?1, ?2, (SELECT session_version FROM task12_users WHERE id = ?2), ?3, ?3, ?4, 'browser')").bind(await sessionStorageKey("temp_verify_tomb_c"), userC, now, expiresFuture).run();
    const preBlockedWhileOff = await apiCall("/api/backup/v1/precheck", { token: "temp_verify_tomb_c", body: { package: oldBackupPkgC } });
    assert.equal(preBlockedWhileOff.status, 200);
    assert.equal(preBlockedWhileOff.body.can_restore, false);
    assert.ok(preBlockedWhileOff.body.summary.rejected > 0);
    assert.ok(preBlockedWhileOff.body.diff_preview.rejected.some((r) => /ERASED_/.test(r.reason)));

    const syncSourceBlockedWhileOff = await apiCall("/api/finance/sync", {
      token: "temp_verify_tomb_c",
      body: {
        schema_version: 1,
        platform: "android",
        device_id: "dev_old_android_offline",
        since_version: 0,
        operations: [{
          operation_id: "op_offline_replay_c_01",
          type: "raw_event.ingest",
          payload: {
            source_type: "notification",
            source_event_id: "ev_c_001",
            source_provider: "com.tencent.mm",
            provider_reference: "wx_c_001",
            text: "微信支付消费 42.00 元",
            direction: "expense",
            amount_minor: 4200,
            currency: "CNY",
            occurred_at_ms: 1763350000000,
            captured_at_ms: 1763350001000,
          },
        }],
      },
    });
    assert.equal(syncSourceBlockedWhileOff.status, 409, JSON.stringify(syncSourceBlockedWhileOff.body));
    assert.equal(syncSourceBlockedWhileOff.body.code, "erased_record_resurrection_blocked");
    await db.prepare("UPDATE task13_user_memberships SET status = 'cancelled' WHERE user_id = ?1").bind(userC).run();
    await db.prepare("UPDATE task12_users SET deleted = 1 WHERE id = ?1").bind(userC).run();
  });

  proof.status = "PASS";
} catch (error) {
  proof.status = "FAIL";
  proof.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(error.stack || error.message);
} finally {
  await writeFile(path.join(out, "result.json"), JSON.stringify(proof, null, 2) + "\n");
  await mf.dispose();
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, evidence: path.relative(root, out) }));
}
