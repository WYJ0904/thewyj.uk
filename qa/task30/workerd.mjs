import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { hashSecret, sessionStorageKey } from "../../functions/_lib/task12-crypto.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".wrangler/task30/evidence", `workerd-${crypto.randomUUID()}`);
await mkdir(out, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const bindings = {
  ...config.env.preview.vars,
  WYJ_ENVIRONMENT: "development",
  WORKERS_AI_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "false",
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
  WYJ_TASK12_PASSWORD_PEPPER: "task30-workerd-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "task30-workerd-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "task30-workerd-only-synthetic-device-0123456789",
  WYJ_TASK27_TOTP_KEY: "dGFzazMwLXdvcmtlcmQtc3ludGhldGljLXRvdHAta2V5",
};

const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(root, ".wrangler/functions-build/index.js"),
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
  bindings,
  serviceBindings: { ASSETS: () => new Response("isolated fixture", { status: 404 }) },
});

const token = "task30_workerd_session_token_000001";
const password = "Task30-Workerd-Password-2026!";
const proof = { scope: "compiled Pages Worker in local workerd; isolated D1/R2", checks: [], status: "RUNNING" };

async function call(route, body, method = body === undefined ? "GET" : "POST", headers = {}) {
  const response = await mf.dispatchFetch("https://task30.local" + route, {
    method,
    headers: {
      Origin: "https://task30.local",
      "X-Session-Token": token,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

async function check(name, fn) {
  await fn();
  proof.checks.push({ name, status: "PASS" });
  console.log("PASS " + name);
}

try {
  const db = await mf.getD1Database("WYJ_DB");
  const storage = await mf.getR2Bucket("WYJ_STORAGE");
  for (const file of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
    await db.exec((await readFile(path.join(root, "cloudflare/migrations", file), "utf8")).replace(/\r?\n/g, " "));
  }
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86400_000).toISOString();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
    VALUES ('task30-workerd-user', 'task30wuser', 'task30wuser', ?1, 'pbkdf2_sha256', 100000, 'user', ?2, ?2, ?2)`)
    .bind(await hashSecret(password, bindings.WYJ_TASK12_PASSWORD_PEPPER), now).run();
  await db.prepare(`INSERT INTO task12_sessions (token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind)
    VALUES (?1, 'task30-workerd-user', 1, ?2, ?2, ?3, 'browser')`).bind(await sessionStorageKey(token), now, future).run();
  await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES ('task30-workerd-user', ?1)").bind(now).run();

  await storage.put("transfer/development/files/task30w-share/f1", new Uint8Array([9, 8, 7]));
  await db.prepare(`INSERT INTO task22_shares (id, owner_kind, owner_ref, file_count, total_bytes, state, expires_at, created_at, updated_at)
    VALUES ('t22w_share_000001', 'user', 'task30-workerd-user', 1, 3, 'active', ?2, ?1, ?1)`).bind(now, future).run();
  await db.prepare(`INSERT INTO task22_share_files (share_id, file_id, relative_path, file_name, mime_type, size_bytes, part_size, part_count, sha256_hex, preview_policy, object_key)
    VALUES ('t22w_share_000001', 't22w_file_0000001', 'doc.bin', 'doc.bin', 'application/octet-stream', 3, 5242880, 1, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'download_only', 'transfer/development/files/task30w-share/f1')`).run();

  await check("status reports task30_privacy enabled and policy archive 2026-11-18-v1 loads", async () => {
    const st = await mf.dispatchFetch("https://task30.local/api/status");
    assert.equal(st.status, 200);
    const body = await st.json();
    assert.equal(body.features.task30_privacy, true);
    const pol = await mf.dispatchFetch("https://task30.local/privacy?version=2026-11-18-v1");
    assert.equal(pol.status, 200);
    assert.match(await pol.text(), /Task30/);
  });

  await check("compiled workerd handles overview, consent revoke, R2 failure retry, and requests detail", async () => {
    const ov = await call("/api/privacy/v1/overview");
    assert.equal(ov.status, 200);
    assert.equal(ov.body.categories.length, 8);

    const consentRes = await call("/api/privacy/v1/consents", { consent_key: "cloud_notification_sync", granted: false });
    assert.equal(consentRes.status, 200);

    const stepupRes = await call("/api/security/stepup", { password, scope: "privacy_data_delete" });
    assert.equal(stepupRes.status, 200);

    const commitFail = await call(
      "/api/privacy/v1/erasure/commit",
      {
        scope_type: "category",
        categories: ["files"],
        confirmation_text: "DELETE FILES",
        idempotency_key: "wk_files_1",
        simulate_r2_failure: true,
      },
      "POST",
      { "X-Aeris-Stepup": stepupRes.body.grant },
    );
    assert.equal(commitFail.status, 200);
    assert.equal(commitFail.body.request.status, "retry_pending");

    const retry = await call("/api/privacy/v1/erasure/retry", { request_id: commitFail.body.request.id });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.request.status, "completed");

    const detail = await call(`/api/privacy/v1/requests/detail?request_id=${encodeURIComponent(commitFail.body.request.id)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.status, "completed");
    assert.equal(await storage.get("transfer/development/files/task30w-share/f1"), null);
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
