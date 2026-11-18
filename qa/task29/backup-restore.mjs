import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { onRequest } from "../../functions/api/[[path]].js";
import { hashSecret, sessionStorageKey } from "../../functions/_lib/task12-crypto.mjs";
import {
  BACKUP_CONTAINER_FORMAT,
  BACKUP_CONTAINER_VERSION,
  BACKUP_SCHEMA_VERSION,
  decryptBackupPackage,
  encryptBackupPackage,
} from "../../functions/_lib/task29-backup-crypto.mjs";
import { formatMinorExact, sanitizeCsvText } from "../../functions/_lib/task29-backup-model.mjs";
import { pruneExpiredRestoreJobs } from "../../functions/_lib/task29-backup-service.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".wrangler/task29/evidence", `unit-d1-${crypto.randomUUID()}`);
await mkdir(out, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('task29-fixture'); } }",
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
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  WORKERS_AI_ENABLED: "false",
  WYJ_TASK12_PASSWORD_PEPPER: "task29-synthetic-test-pepper-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "task29-synthetic-device-secret-0123456789",
  WYJ_TASK27_TOTP_KEY: "dGFzazI5LXN5bnRoZXRpYy10b3RwLWtleS0xMjM0NTY=",
};

for (const file of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  const sql = await readFile(path.join(root, "cloudflare/migrations", file), "utf8");
  await db.exec(sql.replace(/\r?\n/g, " "));
}

const password = "Synthetic-Task29-Password-2026!";
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const expiresFuture = new Date(Date.now() + 7 * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

async function seedUser(userId, username, sessionToken) {
  const pwHash = await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER);
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme, password_iterations,
    role, registered_at, created_at, updated_at
  ) VALUES (?1, ?2, ?2, ?3, 'pbkdf2_sha256', 100000, 'user', ?4, ?4, ?4)`).bind(userId, username, pwHash, now).run();
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`).bind(await sessionStorageKey(sessionToken), userId, now, expiresFuture).run();
  await db.prepare(`INSERT INTO task13_user_memberships (
    id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at
  ) VALUES (?1, ?2, 'all_access_lifetime', ?3, '', 1, 'active', 'fixture', 'task29-qa', 'fixture', '{}', ?3, ?3)`)
    .bind(`mem_${userId}`, userId, now).run();
  await db.prepare(`INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)`)
    .bind(userId, now).run();
}

const tokenA = "task29_session_token_user_a_0000000000000001";
const tokenB = "task29_session_token_user_b_0000000000000002";
const userA = "task29-user-a-0001";
const userB = "task29-user-b-0002";
await seedUser(userA, "task29usera", tokenA);
await seedUser(userB, "task29userb", tokenB);

async function apiCall(route, { method, body, token = tokenA, headers = {}, envOverrides = {} } = {}) {
  const m = method || (body === undefined ? "GET" : "POST");
  const url = `https://task29.local${route}`;
  const reqHeaders = {
    Origin: "https://task29.local",
    "Content-Type": "application/json",
    ...(token ? { "X-Session-Token": token } : {}),
    ...headers,
  };
  const request = new Request(url, {
    method: m,
    headers: reqHeaders,
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const context = { request, env: { ...env, ...envOverrides }, data: { requestId: crypto.randomUUID() }, waitUntil() {} };
  const response = await onRequest(context);
  const json = await response.json().catch(() => null);
  return { response, status: response.status, body: json };
}

async function getStepupGrant(token, scope = "backup_restore", userPassword = password) {
  const res = await apiCall("/api/security/stepup", {
    token,
    body: { password: userPassword, scope },
  });
  assert.equal(res.status, 200, `stepup failed: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.grant, "stepup grant returned");
  return res.body.grant;
}

const results = [];
async function test(name, fn) {
  await fn();
  results.push({ name, status: "PASS" });
  console.log(`PASS ${name}`);
}

try {
  // Seed comprehensive multi-currency, review, notification, and edge-case data for User A
  await db.batch([
    db.prepare(`INSERT INTO task16_finance_user_versions VALUES (?1, 5, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
      VALUES ('cat_food_001', ?1, '=1+1餐饮, "引号"注入测试', 'expense', '#ff6600', 'active', 1, 1, ?2, ?2, '')`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_budgets (id, user_id, category_id, period_type, amount_minor, currency, amount_exponent, starts_on, ends_on, status, revision, sync_version, created_at, updated_at, deleted_at)
      VALUES ('bud_food_001', ?1, 'cat_food_001', 'monthly', 250000, 'CNY', 2, '2026-11-01', '2026-11-30', 'active', 1, 1, ?2, ?2, '')`).bind(userA, now),
    // 6 currencies + unverified legacy JPY + pending review ¥
    db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, amount_exponent, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_by_device, import_source_key, created_at, updated_at, deleted_at, system_superseded_by, system_superseded_operation, currency_review_required, currency_decision_source)
      VALUES
      ('tx_cny_00001', ?1, 'expense', 12345, 'CNY', 2, 'cat_food_001', '+CMD|calc 商户', '', '普通人民币支出 -100', 1763350000000, 'manual', 'confirmed', 'active', 1, 1, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_usd_00002', ?1, 'expense', 9999, 'USD', 2, 'cat_food_001', 'Cloud Store', '', '美元账目', 1763350100000, 'manual', 'confirmed', 'active', 1, 2, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_eur_00003', ?1, 'expense', 5050, 'EUR', 2, 'cat_food_001', 'Cafe Berlin', '', '欧元', 1763350200000, 'manual', 'confirmed', 'active', 1, 2, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_hkd_00004', ?1, 'expense', 8800, 'HKD', 2, 'cat_food_001', 'HK Transit', '', '港币', 1763350300000, 'manual', 'confirmed', 'active', 1, 2, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_gbp_00005', ?1, 'income', 42000, 'GBP', 2, '', 'Freelance UK', '', '英镑收入', 1763350400000, 'manual', 'confirmed', 'active', 1, 2, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_jpy_verif', ?1, 'expense', 1500, 'JPY', 0, 'cat_food_001', 'Tokyo Ramen', '', '已验证日元(exponent=0)', 1763350500000, 'manual', 'confirmed', 'active', 1, 3, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_jpy_legac', ?1, 'expense', 2500, 'JPY', NULL, '', 'Legacy Tokyo', '', '历史未验证日元(exponent=null)', 1763350600000, 'legacy_import', 'review', 'active', 1, 3, 'dev_web_01', '', ?2, ?2, '', '', '', 1, 'account_default'),
      ('tx_big_int08', ?1, 'income', 9007199254740991, 'CNY', 2, '', 'BigInt Safe Max', '', '超大整数精度无损测试', 1763350700000, 'manual', 'confirmed', 'active', 1, 4, 'dev_web_01', '', ?2, ?2, '', '', '', 0, ''),
      ('tx_refund_09', ?1, 'refund', 2000, 'CNY', 2, 'cat_food_001', '+CMD|calc 商户', '', '关联退款', 1763350800000, 'automatic', 'confirmed', 'active', 1, 5, 'dev_web_01', '', ?2, ?2, '', 'tx_cny_00001', 'refund_link', 0, '')`).bind(userA, now),
    // Raw event & link with @ formula in merchant/reason test + ambiguous ¥ review token
    db.prepare(`INSERT INTO task16_finance_raw_events (id, user_id, device_id, source_type, source_event_id, source_provider, provider_reference, direction, amount_minor, currency, merchant, counterparty, account_last4, occurred_at_ms, captured_at_ms, text_fingerprint_sha256, classification, classification_reason, metadata_json, sync_version, created_at)
      VALUES ('raw_evt_0001', ?1, 'dev_android_01', 'notification', 'notif_src_0001', 'com.tencent.mm', 'wx_ref_10001', 'refund', 2000, 'CNY', 'MerchantA', '', '1234', 1763350800000, 1763350801000, '1111111111111111111111111111111111111111111111111111111111111111', 'accepted', 'refund_matched', '{"currency_source":"explicit_iso"}', 5, ?2)`).bind(userA, now),
    db.prepare(`INSERT INTO task16_finance_transaction_events (transaction_id, raw_event_id, relation_status, confidence_milli, evidence_json, linked_by, created_at, updated_at)
      VALUES ('tx_refund_09', 'raw_evt_0001', 'active', 980, '["provider_ref_match"]', 'automatic', ?1, ?1)`).bind(now),
    // FX rate + reference
    db.prepare(`INSERT INTO task16_fx_rates (id, base, quote, requested_date, rate_timestamp, rate, source, fetched_at, expires_at, rounding, integrity_hash)
      VALUES ('fx:testrate001', 'USD', 'CNY', '2026-11-17', '2026-11-17T00:00:00.000Z', '7.2000', 'Frankfurter v2 daily reference', ?1, ?1, 'HALF_EVEN', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`).bind(now),
    db.prepare(`INSERT INTO task16_fx_references (user_id, transaction_id, transaction_revision, display_currency, rate_id, original_currency, original_minor, amount_exponent, converted_minor, created_at)
      VALUES (?1, 'tx_usd_00002', 1, 'CNY', 'fx:testrate001', 'USD', 9999, 2, 71993, ?2)`).bind(userA, now),
    // Review candidates & pending hints
    db.prepare(`INSERT INTO task21_notification_pending_hints (id, user_id, source_event_id, device_id, source_type, source_package, app_label, evidence_summary, amount_minor, direction, merchant, currency, confidence, recognition_status, state, finance_entry_id, created_at, updated_at, provider_reference, payment_channel, currency_review_required, currency_decision_source)
      VALUES ('hint_ambig_01', ?1, 'src_ambig_001', 'dev_android_01', 'notification', 'com.eg.android.AlipayGphone', 'Alipay', '{"reasons":["unknown_yen_symbol"]}', 3500, 'expense', 'Tokyo Shop', 'CNY', 650, 'PAYMENT_LIKELY', 'pending', '', ?2, ?2, 'ali_pref_01', 'alipay', 1, 'account_default')`).bind(userA, now),
    db.prepare(`INSERT INTO task21_notification_candidates (id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty, payment_channel, occurred_at_ms, confidence, status, finance_transaction_id, created_at, updated_at)
      VALUES ('cand_rev_001', ?1, 'nevt_cand_001', 'expense', 4200, 'CNY', '=PendingMerchant', '', 'wechat', 1763350900000, 720, 'pending', '', ?2, ?2)`).bind(userA, now),
    // Cloud structured notifications (pre-auth control event + candidate event + settled/refund lifecycle pair)
    db.prepare(`INSERT INTO task21_notification_events (event_id, user_id, device_id, fingerprint, source_package, source_type, event_type, parser_version, parse_status, direction, amount_minor, currency, payment_channel, merchant, counterparty, confidence, occurred_at_ms, received_at_ms, candidate_id, finance_transaction_id, status, created_at, updated_at, deleted_at, provider_reference, financial_phase, lifecycle_reference, reference_namespace)
      VALUES
      ('nevt_preauth_01', ?1, 'dev_android_01', '2222222222222222222222222222222222222222222222222222222222222222', 'com.bank.app', 'notification', 'transaction', 'v2', 'parsed', 'expense', 10000, 'CNY', 'bank_card', 'Hotel Hold', '', 950, 1763351000000, 1763351001000, '', '', 'active', ?2, ?2, '', 'auth_ref_01', 'AUTHORIZED', 'fam_hotel_01', 'bank.hold'),
      ('nevt_cand_001', ?1, 'dev_android_01', '3333333333333333333333333333333333333333333333333333333333333333', 'com.tencent.mm', 'notification', 'transaction', 'v2', 'candidate', 'expense', 4200, 'CNY', 'wechat', '=PendingMerchant', '', 720, 1763350900000, 1763350901000, 'cand_rev_001', '', 'active', ?2, ?2, '', 'cand_ref_01', 'REVIEW_REQUIRED', '', '')`).bind(userA, now),
  ]);

  // 12.1 Crypto & Format Tests
  const pass1 = "Strong-Backup-Passphrase-1!";
  let exportedEncrypted, exportedJson, exportedCsv;

  await test("12.1a encrypted/json/csv export with unique salt & iv, privacy declaration, and big-int formatting", async () => {
    const res1 = await apiCall("/api/backup/v1/export", { body: { format: "encrypted", passphrase: pass1 } });
    assert.equal(res1.status, 200, JSON.stringify(res1.body));
    exportedEncrypted = res1.body.container;
    assert.equal(exportedEncrypted.format, BACKUP_CONTAINER_FORMAT);
    assert.equal(exportedEncrypted.container_version, BACKUP_CONTAINER_VERSION);
    assert.equal(exportedEncrypted.schema_version, BACKUP_SCHEMA_VERSION);
    assert.equal(exportedEncrypted.crypto.cipher, "AES-256-GCM");
    assert.equal(exportedEncrypted.crypto.kdf, "PBKDF2-HMAC-SHA256");
    assert.equal(res1.body.privacy_declaration.android_local_raw_notifications_included, false);
    assert.equal(res1.body.privacy_declaration.cloud_structured_notifications_included, true);

    const res2 = await apiCall("/api/backup/v1/export", { body: { format: "encrypted", passphrase: pass1 } });
    assert.equal(res2.status, 200);
    assert.notEqual(res1.body.container.crypto.salt_b64, res2.body.container.crypto.salt_b64);
    assert.notEqual(res1.body.container.crypto.iv_b64, res2.body.container.crypto.iv_b64);

    // Decrypt check & passphrase non-persistence check
    const decrypted = await decryptBackupPackage(exportedEncrypted, pass1);
    assert.equal(decrypted.integrity.verified, true);
    assert.ok(!JSON.stringify(exportedEncrypted).includes(pass1));
    const exportAuditRow = await db.prepare("SELECT * FROM task29_backup_exports WHERE user_id = ?1").bind(userA).all();
    assert.ok(!JSON.stringify(exportAuditRow.results).includes(pass1), "passphrase never stored in D1");

    const jRes = await apiCall("/api/backup/v1/export", { body: { format: "json" } });
    assert.equal(jRes.status, 200);
    exportedJson = jRes.body.envelope;
    assert.equal(exportedJson.manifest.sections.transactions.count, 9);
    const legJpy = exportedJson.data.transactions.find((t) => t.id === "tx_jpy_legac");
    assert.equal(legJpy.amount_exponent, null, "legacy JPY amount_exponent preserved as null on export");

    const cRes = await apiCall("/api/backup/v1/export", { body: { format: "csv" } });
    assert.equal(cRes.status, 200);
    assert.equal(cRes.body.restorable, false);
    exportedCsv = cRes.body.csv;
    assert.ok(exportedCsv.startsWith("\uFEFF"), "CSV has UTF-8 BOM");
    assert.ok(exportedCsv.includes("'+CMD|calc 商户"), "CSV formula injection (+) escaped with leading quote");
    assert.ok(exportedCsv.includes("'=1+1餐饮"), "CSV formula injection (=) escaped with leading quote");
    assert.ok(exportedCsv.includes("90071992547409.91"), "BigInt monetary amount formatted with zero float loss");
    assert.ok(exportedCsv.includes("2500 (JPY_UNVERIFIED_UNIT)"), "Unverified legacy JPY explicitly labeled");
    assert.equal(sanitizeCsvText("-1+1"), "'-1+1");
    assert.equal(sanitizeCsvText("\t@SUM(A1)"), "'\t@SUM(A1)");
    assert.equal(formatMinorExact(-1234, "CNY", 2), "-12.34");
  });

  await test("12.1b wrong passphrase, tampered ciphertext/iv/salt/AAD header/manifest, CSV restore rejected", async () => {
    const badPass = await apiCall("/api/backup/v1/precheck", {
      body: { package: exportedEncrypted, passphrase: "Wrong-Passphrase-999!" },
    });
    assert.equal(badPass.status, 403);
    assert.equal(badPass.body.code, "BACKUP_DECRYPTION_FAILED");

    const tamperCipher = structuredClone(exportedEncrypted);
    tamperCipher.ciphertext_b64 = "AAAA" + tamperCipher.ciphertext_b64.slice(4);
    assert.equal((await apiCall("/api/backup/v1/precheck", { body: { package: tamperCipher, passphrase: pass1 } })).body.code, "BACKUP_DECRYPTION_FAILED");

    const tamperIv = structuredClone(exportedEncrypted);
    tamperIv.crypto.iv_b64 = btoa("0123456789ab");
    assert.equal((await apiCall("/api/backup/v1/precheck", { body: { package: tamperIv, passphrase: pass1 } })).body.code, "BACKUP_DECRYPTION_FAILED");

    const tamperSalt = structuredClone(exportedEncrypted);
    tamperSalt.crypto.salt_b64 = btoa("0123456789abcdef");
    assert.equal((await apiCall("/api/backup/v1/precheck", { body: { package: tamperSalt, passphrase: pass1 } })).body.code, "BACKUP_DECRYPTION_FAILED");

    const tamperHeader = structuredClone(exportedEncrypted);
    tamperHeader.manifest_sha256 = "f".repeat(64);
    assert.equal((await apiCall("/api/backup/v1/precheck", { body: { package: tamperHeader, passphrase: pass1 } })).body.code, "BACKUP_DECRYPTION_FAILED");

    const tamperPlainManifest = structuredClone(exportedJson);
    tamperPlainManifest.data.transactions[0].amount_minor += 1;
    const mRes = await apiCall("/api/backup/v1/precheck", { body: { package: tamperPlainManifest } });
    assert.equal(mRes.status, 422);
    assert.equal(mRes.body.code, "BACKUP_MANIFEST_MISMATCH");

    const csvPre = await apiCall("/api/backup/v1/precheck", { body: { package_text: exportedCsv } });
    assert.equal(csvPre.status, 400);
    assert.equal(csvPre.body.code, "BACKUP_CSV_NOT_RESTORABLE");

    const plainR2 = await apiCall("/api/backup/v1/export", { body: { format: "json", store_temp_cloud: true } });
    assert.equal(plainR2.status, 403);
    assert.equal(plainR2.body.code, "BACKUP_PLAINTEXT_CLOUD_STORAGE_FORBIDDEN");
  });

  // 12.2 Permission & Isolation
  await test("12.2 unauthenticated, cross-account, tampered user_id, missing/wrong stepup rejected", async () => {
    assert.equal((await apiCall("/api/backup/v1/scopes", { token: "" })).status, 401);
    assert.equal((await apiCall("/api/backup/v1/export", { token: "", body: { format: "json" } })).status, 401);

    // Account B tries to precheck/import Account A's encrypted package
    const crossA = await apiCall("/api/backup/v1/precheck", {
      token: tokenB,
      body: { package: exportedEncrypted, passphrase: pass1 },
    });
    assert.equal(crossA.status, 403);
    assert.equal(crossA.body.code, "BACKUP_ACCOUNT_MISMATCH");

    // Account B alters JSON user_id / account_id inside envelope -> rejected by manifest/account check
    const forgedPlain = structuredClone(exportedJson);
    forgedPlain.data.transactions[0].user_id = userB;
    const forgedRes = await apiCall("/api/backup/v1/precheck", { token: tokenB, body: { package: forgedPlain } });
    assert.ok([403, 422].includes(forgedRes.status));
    assert.ok(["BACKUP_ACCOUNT_MISMATCH", "BACKUP_MANIFEST_MISMATCH"].includes(forgedRes.body.code));

    // Step-up check on commit
    const pre = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: exportedEncrypted, passphrase: pass1 },
    });
    assert.equal(pre.status, 200);
    const jobId = pre.body.job_id;
    const noStepup = await apiCall(`/api/backup/v1/restore/jobs/${jobId}/commit`, { token: tokenA, body: {} });
    assert.equal(noStepup.status, 403);
    assert.equal(noStepup.body.code, "STEPUP_REQUIRED");

    const wrongGrant = await getStepupGrant(tokenA, "password_change");
    const wrongScope = await apiCall(`/api/backup/v1/restore/jobs/${jobId}/commit`, { token: tokenA, body: { grant: wrongGrant } });
    assert.equal(wrongScope.status, 403);
    assert.equal(wrongScope.body.code, "STEPUP_SCOPE_MISMATCH");

    // Cancel cleanup
    const cancelRes = await apiCall(`/api/backup/v1/restore/jobs/${jobId}/cancel`, { token: tokenA, body: {} });
    assert.equal(cancelRes.status, 200);
    const commitCancelled = await apiCall(`/api/backup/v1/restore/jobs/${jobId}/commit`, {
      token: tokenA,
      body: { grant: await getStepupGrant(tokenA, `backup_restore:${jobId}`) },
    });
    assert.equal(commitCancelled.status, 409);
    assert.equal(commitCancelled.body.code, "BACKUP_JOB_CANCELLED");
  });

  // 12.3 Read-only precheck, privacy boundaries, P03-P06 invariants, clean restore, idempotency & conflicts
  await test("12.3a privacy boundary blocks raw text & P03-P06 invariants block invalid records", async () => {
    const rawLeakEnv = structuredClone(exportedJson);
    rawLeakEnv.data.notification_events.push({
      ...rawLeakEnv.data.notification_events[0],
      event_id: "nevt_raw_leak_01",
      raw_text: "短信验证码 884211 请勿泄露",
    });
    // Re-sign manifest artificially to reach privacy boundary check
    const rawPre = await apiCall("/api/backup/v1/precheck", { token: tokenA, body: { package: rawLeakEnv } });
    // Fails at manifest mismatch unless envelope is cleanly constructed, so let's build one using encryptBackupPackage helper or verify BOTH manifest & privacy helper!
    assert.equal(rawPre.status, 422);

    // Construct an envelope with a legitimate manifest carrying forbidden raw field to prove backend rejects it independently of client
    const { computeSectionManifest, accountBindingDigest } = await import("../../functions/_lib/task29-backup-crypto.mjs");
    const ownerDigest = await accountBindingDigest(userA);
    const { manifest, manifest_sha256 } = await computeSectionManifest(rawLeakEnv.data, {
      export_id: "bexp_privacy_test",
      created_at: now,
      account_id_sha256: ownerDigest,
      scopes: rawLeakEnv.scopes,
    });
    const signedLeak = { ...rawLeakEnv, manifest, manifest_sha256 };
    const leakRes = await apiCall("/api/backup/v1/precheck", { token: tokenA, body: { package: signedLeak } });
    assert.equal(leakRes.status, 422);
    assert.equal(leakRes.body.code, "BACKUP_PRIVACY_BOUNDARY_VIOLATION");

    // Pre-authorization control record trying to book ledger & JPY exponent=2 & ambiguous ¥ bypass
    const invData = structuredClone(exportedJson.data);
    invData.transactions.push({
      ...invData.transactions[0],
      id: "tx_bad_jpy_exp2",
      currency: "JPY",
      amount_exponent: 2,
    });
    invData.transactions.push({
      ...invData.transactions[0],
      id: "tx_ambig_yen_01",
      currency: "CNY",
      raw_currency_token: "¥",
      currency_review_required: 0,
      reconciliation_state: "confirmed",
    });
    invData.notification_events.push({
      ...invData.notification_events[0],
      event_id: "nevt_preauth_booked",
      financial_phase: "AUTHORIZED",
      finance_transaction_id: "tx_cny_00001",
    });
    const invMan = await computeSectionManifest(invData, {
      export_id: "bexp_inv_test",
      created_at: now,
      account_id_sha256: ownerDigest,
      scopes: exportedJson.scopes,
    });
    const invRes = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: { ...exportedJson, manifest: invMan.manifest, manifest_sha256: invMan.manifest_sha256, data: invData } },
    });
    assert.equal(invRes.status, 200);
    assert.equal(invRes.body.can_restore, false);
    const rejectedReasons = invRes.body.diff_preview.rejected.map((r) => r.reason);
    assert.ok(rejectedReasons.includes("CURRENCY_UNIT_MISMATCH"), "JPY with exponent=2 rejected");
    assert.ok(rejectedReasons.includes("CURRENCY_AMBIGUOUS_UNREVIEWED"), "ambiguous ¥ bypassing review rejected");
    assert.ok(rejectedReasons.includes("LIFECYCLE_CONTROL_CANNOT_BOOK_LEDGER"), "AUTHORIZED control record with active tx rejected");
  });

  await test("12.3b read-only precheck does not mutate tables + empty/clean recovery + idempotent replay + conflict blocking", async () => {
    // Verify precheck on partial missing data is strictly read-only
    await db.prepare("DELETE FROM task16_fx_references WHERE user_id = ?1").bind(userA).run();
    await db.prepare("DELETE FROM task16_finance_transaction_events WHERE transaction_id = 'tx_refund_09'").run();
    await db.prepare("DELETE FROM task16_finance_transactions WHERE id = 'tx_refund_09' AND user_id = ?1").bind(userA).run();
    await db.prepare("DELETE FROM task16_finance_raw_events WHERE id = 'raw_evt_0001' AND user_id = ?1").bind(userA).run();
    await db.prepare("DELETE FROM task21_notification_candidates WHERE id = 'cand_rev_001' AND user_id = ?1").bind(userA).run();
    await db.prepare("DELETE FROM task21_notification_events WHERE event_id = 'nevt_cand_001' AND user_id = ?1").bind(userA).run();

    const beforeVer = await db.prepare("SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1").bind(userA).first();
    const beforeTxCount = (await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n;
    assert.equal(beforeTxCount, 8);

    const pre = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: exportedEncrypted, passphrase: pass1 },
    });
    assert.equal(pre.status, 200);
    assert.equal(pre.body.read_only_simulation, true);
    assert.equal(pre.body.can_restore, true);
    assert.equal(pre.body.summary.added, 7, JSON.stringify(pre.body.summary));
    assert.ok(pre.body.summary.skipped_identical >= 12);
    assert.equal(pre.body.summary.conflicts, 0);
    assert.equal(pre.body.summary.rejected, 0);

    // Proof: precheck did not mutate any table or server version
    const afterPreVer = await db.prepare("SELECT server_version FROM task16_finance_user_versions WHERE user_id = ?1").bind(userA).first();
    const afterPreTxCount = (await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n;
    assert.equal(afterPreVer.server_version, beforeVer.server_version);
    assert.equal(afterPreTxCount, 8);

    // Commit restore with valid Step-up grant
    const grant1 = await getStepupGrant(tokenA, `backup_restore:${pre.body.job_id}`);
    const commit1 = await apiCall(`/api/backup/v1/restore/jobs/${pre.body.job_id}/commit`, {
      token: tokenA,
      body: { grant: grant1 },
    });
    assert.equal(commit1.status, 200, JSON.stringify(commit1.body));
    assert.equal(commit1.body.idempotent_replay, false);
    assert.equal(commit1.body.result_summary.inserted_total, 7);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n, 9);

    // Verify legacy JPY preserved with NULL amount_exponent
    const jpyRestored = await db.prepare("SELECT amount_exponent FROM task16_finance_transactions WHERE id = 'tx_jpy_legac' AND user_id = ?1").bind(userA).first();
    assert.equal(jpyRestored.amount_exponent, null);

    // Repeat commit on SAME backup (new precheck + commit) -> idempotent_replay === true, zero duplicates
    const pre2 = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: exportedEncrypted, passphrase: pass1 },
    });
    assert.equal(pre2.status, 200);
    assert.equal(pre2.body.summary.added, 0);
    const grant2 = await getStepupGrant(tokenA, `backup_restore:${pre2.body.job_id}`);
    const commit2 = await apiCall(`/api/backup/v1/restore/jobs/${pre2.body.job_id}/commit`, {
      token: tokenA,
      body: { grant: grant2 },
    });
    assert.equal(commit2.status, 200);
    assert.equal(commit2.body.idempotent_replay, true);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n, 9);

    // Conflict protection: modify existing transaction locally -> default policy blocks conflict, never overwrites
    await db.prepare("UPDATE task16_finance_transactions SET amount_minor = 77777 WHERE id = 'tx_cny_00001' AND user_id = ?1").bind(userA).run();
    const conflictPre = await apiCall("/api/backup/v1/precheck", {
      token: tokenA,
      body: { package: exportedEncrypted, passphrase: pass1 },
    });
    assert.equal(conflictPre.status, 200);
    assert.equal(conflictPre.body.can_restore, false);
    assert.equal(conflictPre.body.summary.conflicts, 1);
    const blockedCommit = await apiCall(`/api/backup/v1/restore/jobs/${conflictPre.body.job_id}/commit`, {
      token: tokenA,
      body: { grant: await getStepupGrant(tokenA, `backup_restore:${conflictPre.body.job_id}`) },
    });
    assert.equal(blockedCommit.status, 409);
    assert.equal(blockedCommit.body.code, "BACKUP_PRECHECK_BLOCKED");

    // Post-restore finance bootstrap works cleanly and retains modified non-overwritten amount
    const bootRes = await apiCall("/api/finance/bootstrap", { token: tokenA });
    assert.equal(bootRes.status, 200);
    assert.equal(bootRes.body.transaction_count, 9);
    const txMod = await db.prepare("SELECT amount_minor FROM task16_finance_transactions WHERE id = 'tx_cny_00001' AND user_id = ?1").bind(userA).first();
    assert.equal(txMod.amount_minor, 77777);
  });

  // 12.4 Multi-batch fault injection rollback test (must NOT delete pre-existing records!)
  await test("12.4 fault injection mid-restore rolls back newly inserted batch and preserves pre-existing records", async () => {
    // Restore user B with 1 pre-existing category + 1 pre-existing transaction, then import 45 new transactions across 2 batches and fail after batch 1
    await db.batch([
      db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
        VALUES ('cat_b_keep', ?1, 'Existing B Cat', 'expense', '#000', 'active', 1, 1, ?2, ?2, '')`).bind(userB, now),
      db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, amount_exponent, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_by_device, import_source_key, created_at, updated_at, deleted_at, system_superseded_by, system_superseded_operation, currency_review_required, currency_decision_source)
        VALUES ('tx_b_keep_001', ?1, 'expense', 500, 'CNY', 2, 'cat_b_keep', 'Existing Merchant', '', '', 1763350000000, 'manual', 'confirmed', 'active', 1, 1, 'dev_b', '', ?2, ?2, '', '', '', 0, '')`).bind(userB, now),
    ]);

    const txBatch = [];
    for (let i = 1; i <= 45; i += 1) {
      txBatch.push({
        id: `tx_b_rb_${String(i).padStart(4, "0")}`,
        user_id: userB,
        direction: "expense",
        amount_minor: 1000 + i,
        currency: "CNY",
        amount_exponent: 2,
        category_id: "cat_b_keep",
        merchant: `Batch Merchant ${i}`,
        counterparty: "",
        note: "",
        occurred_at_ms: 1763360000000 + i * 1000,
        source_kind: "manual",
        reconciliation_state: "confirmed",
        status: "active",
        revision: 1,
        sync_version: 2,
        created_by_device: "dev_b",
        import_source_key: "",
        created_at: now,
        updated_at: now,
        deleted_at: "",
        system_superseded_by: "",
        system_superseded_operation: "",
        currency_review_required: 0,
        currency_decision_source: "",
      });
    }
    const { computeSectionManifest, accountBindingDigest } = await import("../../functions/_lib/task29-backup-crypto.mjs");
    const ownerB = await accountBindingDigest(userB);
    const dataB = { categories: [], budgets: [], transactions: txBatch, raw_events: [], transaction_events: [], fx_preferences: [], fx_rates: [], fx_references: [], currency_role_evidence: [] };
    const manB = await computeSectionManifest(dataB, { export_id: "bexp_rollback", created_at: now, account_id_sha256: ownerB, scopes: ["finance_core"] });
    const envB = {
      schema_version: BACKUP_SCHEMA_VERSION,
      export_id: "bexp_rollback",
      created_at: now,
      cutoff: { finance_server_version: 2, captured_at: now },
      account_binding: { account_id_sha256: ownerB, binding_version: 1 },
      scopes: ["finance_core"],
      manifest_sha256: manB.manifest_sha256,
      manifest: manB.manifest,
      data: dataB,
    };
    const encB = await encryptBackupPackage(envB, "UserB-Rollback-Pass!");
    const preB = await apiCall("/api/backup/v1/precheck", {
      token: tokenB,
      body: { package: encB, passphrase: "UserB-Rollback-Pass!" },
    });
    assert.equal(preB.status, 200);
    assert.equal(preB.body.summary.added, 45);

    const grantB = await getStepupGrant(tokenB, `backup_restore:${preB.body.job_id}`);
    const failRes = await apiCall(`/api/backup/v1/restore/jobs/${preB.body.job_id}/commit`, {
      token: tokenB,
      body: { grant: grantB, fault_inject_after_batch: 1 },
    });
    assert.equal(failRes.status, 500);
    assert.equal(failRes.body.code, "BACKUP_SIMULATED_WRITE_FAILURE");

    // Verify job state is 'rolled_back', 45 new rows are gone, AND pre-existing 'tx_b_keep_001' stayed untouched!
    const jobRow = await apiCall(`/api/backup/v1/restore/jobs/${preB.body.job_id}`, { token: tokenB });
    assert.equal(jobRow.status, 200);
    assert.equal(jobRow.body.state, "rolled_back");
    const countAfterRollback = (await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userB).first()).n;
    assert.equal(countAfterRollback, 1, "rollback removed all newly inserted batch items without touching pre-existing row");
    const keepRow = await db.prepare("SELECT id, amount_minor FROM task16_finance_transactions WHERE id = 'tx_b_keep_001' AND user_id = ?1").bind(userB).first();
    assert.equal(keepRow?.amount_minor, 500);
    // Rollback scrubbed staged_plan_json immediately
    const rbJob = await db.prepare("SELECT state, staged_plan_json FROM task29_restore_jobs WHERE id = ?1").bind(preB.body.job_id).first();
    assert.equal(rbJob.state, "rolled_back");
    assert.equal(rbJob.staged_plan_json, "[]");
  });

  // 12.5 Staged-plan privacy scrubbing & fail-closed feature flag / env kill switch checks
  await test("12.5 staged_plan_json scrubbed on terminal/expired jobs without deleting applying jobs + fail-closed switches", async () => {
    // Completed and cancelled jobs must already have staged_plan_json === '[]'
    const terminalRows = (await db.prepare(
      "SELECT state, staged_plan_json FROM task29_restore_jobs WHERE state IN ('completed', 'cancelled', 'rolled_back')",
    ).all()).results;
    assert.ok(terminalRows.length >= 3);
    for (const r of terminalRows) {
      assert.equal(r.staged_plan_json, "[]", `terminal state ${r.state} must scrub staged_plan_json`);
    }

    // Create an expired 'prechecked' job and an in-flight 'applying' job for userA
    const pastIso = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const futureIso = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    await db.batch([
      db.prepare(`INSERT INTO task29_restore_jobs (
        id, user_id, idempotency_key, backup_sha256, manifest_sha256, payload_sha256,
        source_export_id, schema_version, container_version, state, conflict_policy,
        scopes_json, precheck_summary_json, diff_preview_json, staged_plan_json,
        applied_log_json, total_batches, completed_batches, created_at, updated_at, expires_at
      ) VALUES ('brjob_expired_scrub_01', ?1, 'idemp_exp_scrub_01', ?2, ?2, ?2, '', 'aeris.backup.v1', 1, 'prechecked', 'skip_identical_reject_conflict',
        '["finance_core"]', '{"can_restore":true}', '{}', '[{"section":"transactions","row":{"id":"tx_secret_exp"}}]', '[]', 1, 0, ?3, ?3, ?3)`).bind(userA, "a".repeat(64), pastIso),
      db.prepare(`INSERT INTO task29_restore_jobs (
        id, user_id, idempotency_key, backup_sha256, manifest_sha256, payload_sha256,
        source_export_id, schema_version, container_version, state, conflict_policy,
        scopes_json, precheck_summary_json, diff_preview_json, staged_plan_json,
        applied_log_json, total_batches, completed_batches, created_at, updated_at, expires_at
      ) VALUES ('brjob_applying_keep_01', ?1, 'idemp_app_keep_01', ?2, ?2, ?2, '', 'aeris.backup.v1', 1, 'applying', 'skip_identical_reject_conflict',
        '["finance_core"]', '{"can_restore":true}', '{}', '[{"section":"transactions","row":{"id":"tx_active_applying"}}]', '[]', 1, 0, ?3, ?3, ?4)`).bind(userA, "b".repeat(64), pastIso, futureIso),
    ]);

    const pruneRes = await pruneExpiredRestoreJobs(db);
    assert.ok(pruneRes.scrubbed >= 1);
    const expAfter = await db.prepare("SELECT state, staged_plan_json FROM task29_restore_jobs WHERE id = 'brjob_expired_scrub_01'").first();
    const appAfter = await db.prepare("SELECT state, staged_plan_json FROM task29_restore_jobs WHERE id = 'brjob_applying_keep_01'").first();
    assert.equal(expAfter.state, "prechecked");
    assert.equal(expAfter.staged_plan_json, "[]", "expired job staged_plan_json scrubbed cleanly");
    assert.notEqual(appAfter.staged_plan_json, "[]", "active applying job must never be scrubbed mid-flight");

    // Expired job still preserves 410 BACKUP_JOB_EXPIRED contract
    const expCommit = await apiCall("/api/backup/v1/restore/jobs/brjob_expired_scrub_01/commit", {
      token: tokenA,
      body: { grant: await getStepupGrant(tokenA, "backup_restore:brjob_expired_scrub_01") },
    });
    assert.equal(expCommit.status, 410);
    assert.equal(expCommit.body.code, "BACKUP_JOB_EXPIRED");

    // Fail-closed switch verification (env kill switch + production flag gate)
    assert.equal((await apiCall("/api/backup/v1/scopes", { token: tokenA, envOverrides: { TASK29_BACKUP_ENABLED: "false" } })).status, 503);
    assert.equal((await apiCall("/api/backup/v1/scopes", { token: tokenA, envOverrides: { WYJ_ENVIRONMENT: "production", TASK29_BACKUP_ENABLED: "true" } })).status, 503);

    await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, updated_at)
      VALUES ('task29_backup_v1', 'Task29 switch test', 0, 0, '["stable","beta","experimental"]', 10000, ?1)`).bind(now).run();
    assert.equal((await apiCall("/api/backup/v1/scopes", { token: tokenA, envOverrides: { WYJ_ENVIRONMENT: "production", TASK29_BACKUP_ENABLED: "true" } })).status, 503);

    await db.prepare("UPDATE task25_feature_flags SET enabled = 1, kill_switch = 0, revision = revision + 1 WHERE flag_key = 'task29_backup_v1'").run();
    assert.equal((await apiCall("/api/backup/v1/scopes", { token: tokenA, envOverrides: { WYJ_ENVIRONMENT: "production", TASK29_BACKUP_ENABLED: "true" } })).status, 200);

    await db.prepare("UPDATE task25_feature_flags SET kill_switch = 1, revision = revision + 1 WHERE flag_key = 'task29_backup_v1'").run();
    assert.equal((await apiCall("/api/backup/v1/scopes", { token: tokenA, envOverrides: { WYJ_ENVIRONMENT: "production", TASK29_BACKUP_ENABLED: "true" } })).status, 503);
  });

  await writeFile(path.join(out, "result.json"), JSON.stringify({ status: "PASS", tests: results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS", passed: results.length, evidence: path.relative(root, out) }));
} catch (err) {
  await writeFile(path.join(out, "result.json"), JSON.stringify({ status: "FAIL", error: err.stack, tests: results }, null, 2) + "\n");
  console.error(err.stack);
  process.exitCode = 1;
} finally {
  await mf.dispose();
}
