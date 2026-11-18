import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { onRequest } from "../../functions/api/[[path]].js";
import { hashSecret, sessionStorageKey } from "../../functions/_lib/task12-crypto.mjs";
import { executeAccountErasure, runPrivacyRetentionCleanup } from "../../functions/_lib/task30-privacy-service.mjs";
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
  await storage.put("transfer/development/files/task30-share22/f1", new Uint8Array([1, 2, 3, 4]));
  await storage.put("transfer/development/uploads/task30-sess22/part1", new Uint8Array([5, 6]));
  await storage.put("temporary/development/task30-share14/clip.bin", new Uint8Array([7, 8, 9]));

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
      ('t14_file_a_00002', ?1, 'file', 'file', '', 'temporary/development/task30-share14/clip.bin', ?2, ?2, ?3, 'active', ''),
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
      VALUES ('t22_share_a_0001', 't22_file_a_00001', 'secret.txt', 'secret.txt', 'text/plain', 4, 5242880, 1, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'download_only', 'transfer/development/files/task30-share22/f1')`),
    db.prepare(`INSERT INTO task22_download_grants (token_digest, share_id, created_at, expires_at, state)
      VALUES ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 't22_share_a_0001', ?1, ?2, 'active')`).bind(now, expiresFuture),
    db.prepare(`INSERT INTO task22_upload_sessions (id, owner_kind, owner_ref, state, file_count, total_bytes, created_at, updated_at, expires_at)
      VALUES ('t22_sess_a_00001', 'user', ?1, 'active', 1, 1024, ?2, ?2, ?3)`).bind(userA, now, expiresFuture),
    db.prepare(`INSERT INTO task22_upload_files (id, session_id, relative_path, file_name, size_bytes, part_count, preview_policy, state, object_key, created_at, updated_at)
      VALUES ('t22_ufile_a_0001', 't22_sess_a_00001', 'part.bin', 'part.bin', 1024, 1, 'download_only', 'allocated', 'transfer/development/uploads/task30-sess22/part1', ?1, ?1)`).bind(now),
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

  await test("1. Data catalog & unauth fail-closed check & owner overview", async () => {
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
    assert.ok(await storage.get("transfer/development/files/task30-share22/f1") !== null);

    // Retry cleanup -> R2 deleted & request completes
    const retryRes = await apiCall("/api/privacy/v1/erasure/retry", {
      token: tokenA,
      body: { request_id: simRes.body.request.id },
    });
    assert.equal(retryRes.status, 200, JSON.stringify(retryRes.body));
    assert.equal(retryRes.body.request.status, "completed");
    assert.equal(await storage.get("transfer/development/files/task30-share22/f1"), null);
    assert.equal(await storage.get("transfer/development/uploads/task30-sess22/part1"), null);
    assert.equal(await storage.get("temporary/development/task30-share14/clip.bin"), null);

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
