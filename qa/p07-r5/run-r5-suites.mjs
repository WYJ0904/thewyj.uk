/**
 * Runner for Codex R5 independent-policy.mjs and independent-browser.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, pbkdf2 as pbkdf2Cb } from "node:crypto";
import { promisify } from "node:util";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const QA_WORK_ROOT = path.join(ROOT, ".wrangler", `p07-r5-runner-${Date.now()}`);
const RUNTIME_DIR = path.join(QA_WORK_ROOT, "runtime");
const STATE_DIR = path.join(QA_WORK_ROOT, "state");
const CHROME_DATA_DIR = path.join(QA_WORK_ROOT, "chrome-profile");
const EVIDENCE_DIR = path.join(ROOT, "docs", "p07", "evidence", "p07-r5");

await fsp.mkdir(RUNTIME_DIR, { recursive: true });
await fsp.mkdir(STATE_DIR, { recursive: true });
await fsp.mkdir(CHROME_DATA_DIR, { recursive: true });
await fsp.mkdir(EVIDENCE_DIR, { recursive: true });



function cleanChildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of Object.keys(env)) {
    if (/^(?:CLOUDFLARE_|CF_API_|CF_ACCOUNT_|OPENAI_|ANTHROPIC_|GEMINI_)/i.test(name)) {
      delete env[name];
    }
  }
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ""}`;
  env.WRANGLER_SEND_METRICS = "false";
  env.NO_PROXY = "127.0.0.1,localhost";
  return env;
}

await fsp.writeFile(
  path.join(RUNTIME_DIR, "package.json"),
  JSON.stringify({ name: "aeris-p07-r5-runner", private: true, type: "module" })
);

console.log("--> Staging pages deploy...");
const { output } = await stagePages({ root: ROOT });
const servedOutput = path.join(RUNTIME_DIR, "public");
await fsp.cp(output, servedOutput, { recursive: true });
await fsp.cp(path.join(output, "functions"), path.join(RUNTIME_DIR, "functions"), { recursive: true });
await fsp.cp(path.join(output, "js"), path.join(RUNTIME_DIR, "js"), { recursive: true });

const rootConfig = JSON.parse(await fsp.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
const localConfig = {
  name: "aeris-p07-r5-local",
  pages_build_output_dir: servedOutput,
  compatibility_date: rootConfig.compatibility_date,
  send_metrics: false,
  vars: {
    ...rootConfig.vars,
    WYJ_ENVIRONMENT: "development",
    WORKERS_AI_ENABLED: "false",
    LEGACY_API_FALLBACK_ENABLED: "false",
    TASK16_CLOUD_READS_ENABLED: "true",
    TASK16_CLOUD_WRITES_ENABLED: "true",
    TASK21_NOTIFICATION_READS_ENABLED: "true",
    TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  },
  d1_databases: [
    {
      binding: "WYJ_DB",
      database_name: "aeris-p07-r5-local",
      migrations_table: "wyj_d1_migrations",
      migrations_dir: path.join(ROOT, "cloudflare", "migrations"),
    },
  ],
  r2_buckets: [{ binding: "WYJ_STORAGE", bucket_name: "aeris-p07-r5-local" }],
};
await fsp.writeFile(path.join(RUNTIME_DIR, "wrangler.jsonc"), `${JSON.stringify(localConfig, null, 2)}\n`);

const adminSecret = "local-admin-test-secret";
const secrets = {
  WYJ_TASK12_PASSWORD_PEPPER: randomBytes(32).toString("base64url"),
  WYJ_TASK14_TEMPORARY_SECRET: randomBytes(32).toString("base64url"),
  WYJ_TASK20_DEVICE_SESSION_SECRET: randomBytes(32).toString("base64url"),
};
await fsp.writeFile(
  path.join(RUNTIME_DIR, ".dev.vars"),
  Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
);

console.log("--> Applying D1 migrations...");
let mig = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  mig = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 180_000 }
  );
  if (mig.status === 0) break;
  console.log(`D1 migration attempt ${attempt} returned ${mig.status}, retrying in 1s...`);
  await new Promise(r => setTimeout(r, 1000));
}
assert.equal(mig.status, 0, `D1 migration failed:\n${mig.stdout}\n${mig.stderr}`);

console.log("--> Seeding test fixtures...");
const now = new Date().toISOString();
const pwHash = await hashSecret(adminSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const seedSql = `
  INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
  VALUES ('admin-1', 'wyj', 'wyj', ${q(pwHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
  INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'P07 UI Flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'admin-1', 'p07-seed', 'p07-seed');
`;
const seedFile = path.join(QA_WORK_ROOT, "seed.sql");
await fsp.writeFile(seedFile, seedSql);
const seeded = spawnSync(
  process.execPath,
  [WRANGLER, "d1", "execute", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR, "--file", seedFile],
  { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 90_000 }
);
assert.equal(seeded.status, 0, `D1 seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

const port = 18972;
const cdpPort = 19302;
console.log(`--> Spawning Pages dev server on port ${port}...`);
const pagesDev = spawn(
  process.execPath,
  [
    WRANGLER, "pages", "dev", servedOutput,
    "--port", String(port),
    "--d1", "WYJ_DB",
    "--r2", "WYJ_STORAGE=aeris-p07-r5-local",
    "--persist-to", STATE_DIR,
    "--ip", "127.0.0.1",
    "--show-interactive-dev-session", "false",
    "--log-level", "info",
  ],
  { cwd: RUNTIME_DIR, env: cleanChildEnv({ FORCE_COLOR: "0" }), stdio: ["ignore", "pipe", "pipe"] }
);

pagesDev.stdout.on("data", d => process.stdout.write(`[Pages] ${d}`));
pagesDev.stderr.on("data", d => process.stderr.write(`[Pages ERR] ${d}`));
pagesDev.on("exit", (code, sig) => console.log(`[Pages EXIT] code=${code} signal=${sig}`));

console.log(`--> Spawning headless Chrome on CDP port ${cdpPort}...`);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${CHROME_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--disable-component-update",
    "--window-size=1440,960",
    "about:blank",
  ],
  { stdio: "ignore" }
);

async function waitHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status > 0) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

try {
  await waitHttp(`http://127.0.0.1:${port}/api/health`);
  await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  console.log("[PASS] Server and Headless Chrome ready!");

  const testEnv = cleanChildEnv({
    WYJ_TEST_BASE: `http://127.0.0.1:${port}`,
    WYJ_CDP_URL: `http://127.0.0.1:${cdpPort}`,
    P07_D_EVIDENCE: EVIDENCE_DIR,
    WYJ_TEST_ADMIN_SECRET: adminSecret,
    P07_D_TARGET_HEAD: "gemini-p07-splash-transition-fix",
    ...(process.env.P07_R5_BROWSER_CASE ? { P07_R5_BROWSER_CASE: process.env.P07_R5_BROWSER_CASE } : {}),
  });

  if (!process.env.P07_R5_SKIP_SUITE_1) {
  console.log("\n=======================================================");
  console.log("--> Running Suite 1: independent-policy.mjs");
  console.log("=======================================================");
  const policyRes = spawnSync(
    process.execPath,
    [path.join(ROOT, "qa", "p07-r5", "independent-policy.mjs")],
    { cwd: ROOT, env: testEnv, encoding: "utf8", stdio: "inherit", timeout: 120_000 }
  );
  assert.equal(policyRes.status, 0, "Suite 1 (independent-policy.mjs) failed");
  console.log("[PASS] Suite 1 PASSED!");
  }

  console.log("\n=======================================================");
  console.log("--> Running Suite 2: independent-browser.mjs");
  console.log("=======================================================");
  const browserRes = spawnSync(
    process.execPath,
    [path.join(ROOT, "qa", "p07-r5", "independent-browser.mjs")],
    { cwd: ROOT, env: testEnv, encoding: "utf8", stdio: "inherit", timeout: 360_000 }
  );
  assert.equal(browserRes.status, 0, "Suite 2 (independent-browser.mjs) failed");
  console.log("[PASS] Suite 2 PASSED!");

  console.log("\n=======================================================");
  console.log("[SUCCESS] ALL R5 INDEPENDENT SUITES PASSED CLEANLY!");
  console.log("=======================================================");
} finally {
  try { pagesDev.kill(); } catch (_) {}
  try { chrome.kill(); } catch (_) {}
  try { await fsp.rm(QA_WORK_ROOT, { recursive: true, force: true }); } catch (_) {}
}
