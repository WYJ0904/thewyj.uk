import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { hashSecret, sessionStorageKey } from "../../functions/_lib/task12-crypto.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".wrangler/task29/evidence", `workerd-${crypto.randomUUID()}`);
await mkdir(out, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const bindings = {
  ...config.env.preview.vars,
  WYJ_ENVIRONMENT: "development",
  WORKERS_AI_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "false",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: "task29-workerd-synthetic-pepper-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "task29-workerd-synthetic-device-0123456789",
  WYJ_TASK27_TOTP_KEY: "dGFzazI5LXdvcmtlcmQtc3ludGhldGljLXRvdHA=",
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

const proof = {
  scope: "compiled Pages Worker in local workerd; isolated D1/R2; synthetic records",
  checks: [],
  production: "NOT_TOUCHED",
};

const password = "Synthetic-Workerd-Password-2026!";
const tokenA = "task29_workerd_session_token_a_000000001";
const tokenB = "task29_workerd_session_token_b_000000002";

async function call(route, body, token = tokenA, method = body === undefined ? "GET" : "POST") {
  const response = await mf.dispatchFetch("https://task29.local" + route, {
    method,
    headers: {
      Origin: "https://task29.local",
      "Content-Type": "application/json",
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, status: response.status, body: await response.json().catch(() => null) };
}

async function check(name, fn) {
  await fn();
  proof.checks.push({ name, status: "PASS" });
  console.log(`PASS ${name}`);
}

try {
  const db = await mf.getD1Database("WYJ_DB");
  for (const file of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
    await db.exec((await readFile(path.join(root, "cloudflare/migrations", file), "utf8")).replace(/\r?\n/g, " "));
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const expires = new Date(Date.now() + 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const pwHash = await hashSecret(password, bindings.WYJ_TASK12_PASSWORD_PEPPER);

  for (const [id, uname, tok] of [
    ["task29-wd-a", "task29wda", tokenA],
    ["task29-wd-b", "task29wdb", tokenB],
  ]) {
    await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
      VALUES(?1,?2,?2,?3,'pbkdf2_sha256',100000,'user',?4,?4,?4)`).bind(id, uname, pwHash, now).run();
    await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind)
      VALUES(?1,?2,1,?3,?3,?4,'browser')`).bind(await sessionStorageKey(tok), id, now, expires).run();
    await db.prepare("INSERT INTO task27_security(user_id,password_age_start_at) VALUES(?1,?2)").bind(id, now).run();
  }

  await db.batch([
    db.prepare(`INSERT INTO task16_finance_categories(id,user_id,name,applies_to,color,status,revision,sync_version,created_at,updated_at,deleted_at)
      VALUES('wd_cat_001','task29-wd-a','Workerd Travel','expense','#336699','active',1,1,?1,?1,'')`).bind(now),
    db.prepare(`INSERT INTO task16_finance_transactions(id,user_id,direction,amount_minor,currency,amount_exponent,category_id,merchant,counterparty,note,occurred_at_ms,source_kind,reconciliation_state,status,revision,sync_version,created_by_device,import_source_key,created_at,updated_at,deleted_at,system_superseded_by,system_superseded_operation,currency_review_required,currency_decision_source)
      VALUES('wd_tx_usd_01','task29-wd-a','expense',2550,'USD',2,'wd_cat_001','Airport Shuttle','','workerd fixture',1763350000000,'manual','confirmed','active',1,1,'wd_dev','',?1,?1,'','','',0,'')`).bind(now),
  ]);

  let container;
  const pass = "Workerd-Backup-Pass-2026!";

  await check("compiled workerd exports encrypted package and exposes scopes", async () => {
    assert.equal((await call("/api/backup/v1/scopes", undefined, "")).status, 401);
    const scopes = await call("/api/backup/v1/scopes");
    assert.equal(scopes.status, 200);
    assert.equal(scopes.body.scope_counts.finance_core.transactions, 1);

    const exp = await call("/api/backup/v1/export", { format: "encrypted", passphrase: pass });
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    container = exp.body.container;
    assert.equal(container.format, "aeris-encrypted-backup");
  });

  await check("compiled workerd rejects wrong passphrase & cross-account precheck", async () => {
    const wrong = await call("/api/backup/v1/precheck", { package: container, passphrase: "Wrong-Workerd-Pass!" });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, "BACKUP_DECRYPTION_FAILED");

    const cross = await call("/api/backup/v1/precheck", { package: container, passphrase: pass }, tokenB);
    assert.equal(cross.status, 403);
    assert.equal(cross.body.code, "BACKUP_ACCOUNT_MISMATCH");
  });

  await check("compiled workerd runs precheck, enforces stepup, restores missing tx, and stays idempotent", async () => {
    await db.prepare("DELETE FROM task16_finance_transactions WHERE id = 'wd_tx_usd_01'").run();
    const pre = await call("/api/backup/v1/precheck", { package: container, passphrase: pass });
    assert.equal(pre.status, 200);
    assert.equal(pre.body.can_restore, true);
    assert.equal(pre.body.summary.added, 1);

    const noStepup = await call(`/api/backup/v1/restore/jobs/${pre.body.job_id}/commit`, {});
    assert.equal(noStepup.status, 403);
    assert.equal(noStepup.body.code, "STEPUP_REQUIRED");

    const step = await call("/api/security/stepup", { password, scope: `backup_restore:${pre.body.job_id}` });
    assert.equal(step.status, 200);
    const com = await call(`/api/backup/v1/restore/jobs/${pre.body.job_id}/commit`, { grant: step.body.grant });
    assert.equal(com.status, 200, JSON.stringify(com.body));
    assert.equal(com.body.result_summary.inserted_total, 1);
    assert.equal(com.body.idempotent_replay, false);

    // Repeat commit on new precheck -> idempotent replay
    const pre2 = await call("/api/backup/v1/precheck", { package: container, passphrase: pass });
    const step2 = await call("/api/security/stepup", { password, scope: `backup_restore:${pre2.body.job_id}` });
    const com2 = await call(`/api/backup/v1/restore/jobs/${pre2.body.job_id}/commit`, { grant: step2.body.grant });
    assert.equal(com2.status, 200);
    assert.equal(com2.body.idempotent_replay, true);
  });

  proof.status = "PASS";
} catch (err) {
  proof.status = "FAIL";
  proof.error = err.stack;
  process.exitCode = 1;
  console.error(err.stack);
} finally {
  await writeFile(path.join(out, "result.json"), JSON.stringify(proof, null, 2) + "\n");
  await mf.dispose();
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, evidence: path.relative(root, out) }));
}
