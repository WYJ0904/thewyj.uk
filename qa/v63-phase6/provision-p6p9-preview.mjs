import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const FORBIDDEN_DBS = new Set([
  "11c288d8-c584-409f-bb1f-7e7af11793e5", // wyj-cloud-production
  "a3e6253b-689f-49f3-998b-7c5828ea255a", // wyj-cloud-preview (shared P5 / DS SSO / PR preview)
  "d1df54e4-8b2f-4e43-8be6-4a76d74e9d33", // aeris-v63-preview
  "bd1c84a6-dc4d-4814-836e-2b6ce477a641", // I04
  "9e76a190-42db-4ff1-b0b7-476e4b312792", // I05
  "949eb48b-4662-4f63-98d8-043c7afc17b6", // I06
  "db9ec9c6-daa9-4b3b-9792-a6ba8bb3a7f7", // I08
  "f664066f-9abb-45fc-b1fa-913bc65da0af", // I09
  "08e9e646-1059-43bd-adcb-e32c61eee5b8", // V6 Rework Preview
]);
const FORBIDDEN_PROJECTS = new Set(["thewyj-uk", "thewyj-v63-preview", "wyj-ds-sso-preview"]);
const FORBIDDEN_BUCKETS = new Set(["wyj-cloud-production", "wyj-cloud-preview", "aeris-v63-preview-storage"]);

const PROJECT = process.env.P6P9_PREVIEW_PROJECT || "thewyj-v63-p6p9-preview";
const D1_NAME = process.env.P6P9_PREVIEW_D1_NAME || "aeris-v63-p6p9-preview";
const R2_NAME = process.env.P6P9_PREVIEW_R2_NAME || "aeris-v63-p6p9-storage";
const PREVIEW_BRANCH = process.env.P6P9_PREVIEW_BRANCH || "v63-phase6";
const PRODUCTION_BRANCH = "release-held";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const D1_CONFIG_PATH = path.join(ROOT, ".wrangler", "p6p9-preview-d1.jsonc");
const PROVISION_OUT = path.join(ROOT, "docs", "ui-rebuild", "v63-phase6-transfer", "evidence", "p6p9-preview-provision.json");

assert.equal(FORBIDDEN_PROJECTS.has(PROJECT), false, `Refusing forbidden project: ${PROJECT}`);
assert.equal(FORBIDDEN_BUCKETS.has(R2_NAME), false, `Refusing forbidden R2 bucket: ${R2_NAME}`);

function getWranglerToken() {
  const res = spawnSync(process.execPath, [WRANGLER, "auth", "token", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(res.status, 0, `Wrangler auth token failed: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  const token = parsed.token || parsed.oauth_token || parsed.api_token;
  assert.ok(token, "Empty Wrangler token");
  return token;
}

async function cfApi(token, route, { method = "GET", body = null, allow404 = false } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== null ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (allow404 && res.status === 404) return null;
  assert.equal(data.success, true, `Cloudflare API ${method} ${route} failed (${res.status}): ${JSON.stringify(data.errors)}`);
  return data.result;
}

function runD1Query(sql) {
  const res = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", D1_NAME, "--remote", "--config", D1_CONFIG_PATH, "--json", "--command", sql],
    { cwd: ROOT, input: "y\n", encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(res.status, 0, `D1 query failed:\n${res.stdout}\n${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  return parsed?.[0]?.results || [];
}

const token = getWranglerToken();

// 1. Create or reuse strictly isolated D1 aeris-v63-p6p9-preview & R2 aeris-v63-p6p9-storage
const d1List = await cfApi(token, `/d1/database?name=${encodeURIComponent(D1_NAME)}&per_page=50`);
let targetD1 = (Array.isArray(d1List) ? d1List : []).find((db) => db.name === D1_NAME);
if (!targetD1) {
  targetD1 = await cfApi(token, "/d1/database", {
    method: "POST",
    body: { name: D1_NAME },
  });
}
const d1Id = targetD1?.uuid || targetD1?.id;
assert.ok(d1Id, `Missing D1 UUID for ${D1_NAME}`);
assert.equal(FORBIDDEN_DBS.has(d1Id), false, `Refusing to reuse non-P6P9 D1 ID: ${d1Id}`);

const r2Check = await cfApi(token, `/r2/buckets/${encodeURIComponent(R2_NAME)}`, { allow404: true });
if (!r2Check) {
  await cfApi(token, "/r2/buckets", {
    method: "POST",
    body: { name: R2_NAME },
  });
}

// 2. Check existing project (if any) so existing secret_text keys are NEVER rotated underneath existing users
let projectObj = await cfApi(token, `/pages/projects/${PROJECT}`, { allow404: true });
if (!projectObj) {
  projectObj = await cfApi(token, "/pages/projects", {
    method: "POST",
    body: {
      name: PROJECT,
      production_branch: PRODUCTION_BRANCH,
    },
  });
}

const existingEnv = projectObj?.deployment_configs?.preview?.env_vars || {};
const baseWrangler = JSON.parse(await fs.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
const mergedPlainVars = {
  ...(baseWrangler.env?.preview?.vars || {}),
  WYJ_ENVIRONMENT: "preview",
  WORKERS_AI_ENABLED: "false",
  TTS_MODE: "cache-only",
  EMAIL_SENDING_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "true",
  AERIS_DS_SSO_ENABLED: "false",
  AERIS_DS_OWNERSHIP_ENABLED: "false",
  AERIS_DS_OWNERSHIP_REVIEW_ENABLED: "false",
  AERIS_DS_MERGE_PREVIEW_ENABLED: "false",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK12_IMPORT_ENABLED: "false",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK13_IMPORT_ENABLED: "false",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK14_IMPORT_ENABLED: "false",
  TASK15_IMPORT_ENABLED: "false",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK16_IMPORT_ENABLED: "false",
  TASK18_ADMIN_MESSAGES_ENABLED: "true",
  TASK20_ANDROID_APP_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  TASK22_TRANSFER_READS_ENABLED: "true",
  TASK22_TRANSFER_WRITES_ENABLED: "true",
  TASK25_FEATURE_FLAGS_ENABLED: "true",
  TASK26_ADAPTIVE_LEARNING_ENABLED: "true",
  TASK27_SECURITY_ENABLED: "true",
  TASK29_BACKUP_ENABLED: "true",
  TASK30_PRIVACY_ENABLED: "true",
};

const envVarsPayload = {};
for (const [k, v] of Object.entries(mergedPlainVars)) {
  assert.ok(k === "ANDROID_APK_KEY" || !/TOKEN|SECRET|PASSWORD|PEPPER|API_KEY|PRIVATE_KEY/i.test(k), `Unexpected secret-like plain var: ${k}`);
  envVarsPayload[k] = { type: "plain_text", value: String(v) };
}
const secretNames = [
  "WYJ_TASK12_PASSWORD_PEPPER",
  "WYJ_TASK14_TEMPORARY_SECRET",
  "WYJ_TASK20_DEVICE_SESSION_SECRET",
];
for (const secretKey of secretNames) {
  if (existingEnv[secretKey]?.type !== "secret_text") {
    envVarsPayload[secretKey] = { type: "secret_text", value: randomBytes(32).toString("hex") };
  }
}

const existingAiBindings = projectObj?.deployment_configs?.preview?.ai_bindings || {};
const clearAiBindings = Object.fromEntries(Object.keys(existingAiBindings).map((k) => [k, null]));
const deployCfgPatch = {
  compatibility_date: baseWrangler.compatibility_date,
  d1_databases: { WYJ_DB: { id: d1Id } },
  r2_buckets: { WYJ_STORAGE: { name: R2_NAME } },
  ...(Object.keys(clearAiBindings).length ? { ai_bindings: clearAiBindings } : {}),
  env_vars: envVarsPayload,
};

await cfApi(token, `/pages/projects/${PROJECT}`, {
  method: "PATCH",
  body: {
    production_branch: PRODUCTION_BRANCH,
    deployment_configs: {
      preview: deployCfgPatch,
      production: deployCfgPatch,
    },
  },
});

const verifiedProject = await cfApi(token, `/pages/projects/${PROJECT}`);
const previewCfg = verifiedProject.deployment_configs?.preview || {};
assert.equal(verifiedProject.production_branch, PRODUCTION_BRANCH);
assert.notEqual(PREVIEW_BRANCH, verifiedProject.production_branch);
assert.equal(previewCfg.d1_databases?.WYJ_DB?.id, d1Id);
assert.equal(previewCfg.r2_buckets?.WYJ_STORAGE?.name, R2_NAME);
assert.equal(Object.keys(previewCfg.ai_bindings || {}).length, 0);
assert.equal(previewCfg.env_vars?.WORKERS_AI_ENABLED?.value, "false");
assert.equal(previewCfg.env_vars?.EMAIL_SENDING_ENABLED?.value, "false");
assert.equal(previewCfg.env_vars?.D1_RATE_LIMIT_ENABLED?.value, "true");
assert.equal(previewCfg.env_vars?.TASK22_TRANSFER_WRITES_ENABLED?.value, "true");
for (const secretKey of secretNames) {
  assert.equal(previewCfg.env_vars?.[secretKey]?.type, "secret_text", `Missing secret_text ${secretKey}`);
}

// 3. Apply ALL 0001-0045 migrations via Wrangler and verify 1:1 schema integrity
const migrationsDir = path.join(ROOT, "cloudflare", "migrations");
const expectedMigrations = (await fs.readdir(migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort();
assert.equal(expectedMigrations.length, 45, `Expected 45 migration files, found ${expectedMigrations.length}`);

await fs.mkdir(path.dirname(D1_CONFIG_PATH), { recursive: true });
const d1Config = {
  $schema: "../node_modules/wrangler/config-schema.json",
  name: PROJECT,
  compatibility_date: baseWrangler.compatibility_date,
  send_metrics: false,
  d1_databases: [
    {
      binding: "WYJ_DB",
      database_name: D1_NAME,
      database_id: d1Id,
      migrations_table: "wyj_d1_migrations",
      migrations_dir: migrationsDir.replace(/\\/g, "/"),
    },
  ],
};
await fs.writeFile(D1_CONFIG_PATH, `${JSON.stringify(d1Config, null, 2)}\n`);

const migRes = spawnSync(
  process.execPath,
  [WRANGLER, "d1", "migrations", "apply", D1_NAME, "--remote", "--config", D1_CONFIG_PATH],
  { cwd: ROOT, input: "y\ny\n", encoding: "utf8", timeout: 240_000 },
);
assert.equal(migRes.status, 0, `D1 migrations failed:\n${migRes.stdout}\n${migRes.stderr}`);

const appliedRows = runD1Query("SELECT name FROM wyj_d1_migrations ORDER BY name;");
const appliedNames = appliedRows.map((r) => r.name).sort();
assert.deepEqual(appliedNames, expectedMigrations, "Applied D1 migrations mismatch expected 0001-0045 files");

const tableRows = runD1Query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
const tableNames = new Set(tableRows.map((r) => r.name));
for (const requiredTable of [
  "task12_users",
  "task12_sessions",
  "task13_membership_plans",
  "task13_user_memberships",
  "task13_membership_entitlements",
  "task22_upload_sessions",
  "task22_upload_files",
  "task22_upload_parts",
  "task22_shares",
  "task22_share_files",
  "task22_download_grants",
  "task22_metadata",
  "task25_feature_flags",
  "task28_file_events",
  "task28_multipart_cleanup",
  "task29_backup_exports",
  "task30_erasure_requests",
  "aeris_ds_sso_requests",
  "aeris_ds_merge_sandbox",
]) {
  assert.ok(tableNames.has(requiredTable), `Missing expected migrated table: ${requiredTable}`);
}

const task28Meta = runD1Query("SELECT value FROM task22_metadata WHERE key = 'task28_schema_version';");
assert.equal(task28Meta?.[0]?.value, "1", "Missing task28_schema_version=1 metadata");

// 4. Seed p07_accessibility feature flag
const ts = new Date().toISOString();
const seedSql = `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'P6-P9 isolated preview UI presentation flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, '${ts}', NULL, 'p6p9-provision', 'p6p9-provision')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at;`;
runD1Query(seedSql);

await fs.mkdir(path.dirname(PROVISION_OUT), { recursive: true });
const provisionSummary = {
  schema_version: 1,
  environment: "isolated-preview-p6-p9",
  project: PROJECT,
  branch: PREVIEW_BRANCH,
  production_branch: verifiedProject.production_branch,
  d1_name: D1_NAME,
  d1_id: d1Id,
  r2_name: R2_NAME,
  migrations_applied_count: appliedNames.length,
  migrations_first: appliedNames[0],
  migrations_last: appliedNames[appliedNames.length - 1],
  table_count: tableNames.size,
  task28_schema_version: task28Meta[0].value,
  bindings_verified: {
    WORKERS_AI_ENABLED: previewCfg.env_vars?.WORKERS_AI_ENABLED?.value,
    EMAIL_SENDING_ENABLED: previewCfg.env_vars?.EMAIL_SENDING_ENABLED?.value,
    D1_RATE_LIMIT_ENABLED: previewCfg.env_vars?.D1_RATE_LIMIT_ENABLED?.value,
    TASK22_TRANSFER_WRITES_ENABLED: previewCfg.env_vars?.TASK22_TRANSFER_WRITES_ENABLED?.value,
    secrets_configured: secretNames.filter((s) => previewCfg.env_vars?.[s]?.type === "secret_text"),
  },
  preview_host: `https://${PREVIEW_BRANCH}.${PROJECT}.pages.dev`,
  provisioned_at: ts,
};
await fs.writeFile(PROVISION_OUT, `${JSON.stringify(provisionSummary, null, 2)}\n`);
console.log(JSON.stringify(provisionSummary, null, 2));
