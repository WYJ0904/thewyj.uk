import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const FORBIDDEN_DBS = new Set([
  "11c288d8-c584-409f-bb1f-7e7af11793e5", // Production WYJ_DB
  "bd1c84a6-dc4d-4814-836e-2b6ce477a641", // I04
  "9e76a190-42db-4ff1-b0b7-476e4b312792", // I05
  "949eb48b-4662-4f63-98d8-043c7afc17b6", // I06
  "db9ec9c6-daa9-4b3b-9792-a6ba8bb3a7f7", // I08
  "f664066f-9abb-45fc-b1fa-913bc65da0af", // I09
  "08e9e646-1059-43bd-adcb-e32c61eee5b8", // V6 Rework Preview
]);
const PROJECT = process.env.I10_PREVIEW_PROJECT || "thewyj-i10-preview";
const D1_NAME = process.env.I10_PREVIEW_D1_NAME || "aeris-i10-preview";
const R2_NAME = process.env.I10_PREVIEW_R2_NAME || "aeris-i10-preview-storage";
const PREVIEW_BRANCH = process.env.I10_PREVIEW_BRANCH || "i10-interaction-acceptance";
const PRODUCTION_BRANCH = "release-held";
const TEMPLATE_PROJECT = "thewyj-v6-rework-preview";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const D1_CONFIG_PATH = path.join(ROOT, ".wrangler", "i10-preview-d1.jsonc");
const PROVISION_OUT = path.join(ROOT, "docs", "ui-rebuild", "i10", "evidence", "i10-preview-provision.json");

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

const token = getWranglerToken();

// 1. Find or create isolated D1 aeris-i10-preview & R2 aeris-i10-preview-storage
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
assert.equal(FORBIDDEN_DBS.has(d1Id), false, `Refusing to reuse non-I10 D1 ID: ${d1Id}`);

const r2Check = await cfApi(token, `/r2/buckets/${encodeURIComponent(R2_NAME)}`, { allow404: true });
if (!r2Check) {
  await cfApi(token, "/r2/buckets", {
    method: "POST",
    body: { name: R2_NAME },
  });
}

// 2. Read safe non-secret config + secret key names from template project
const templateProject = await cfApi(token, `/pages/projects/${TEMPLATE_PROJECT}`, { allow404: true })
  || await cfApi(token, "/pages/projects/thewyj-i09-preview");
const templateEnvVars = templateProject?.deployment_configs?.preview?.env_vars || {};
const plainVars = {};
const secretNames = new Set([
  "WYJ_TASK12_PASSWORD_PEPPER",
  "WYJ_TASK14_TEMPORARY_SECRET",
  "WYJ_TASK20_DEVICE_SESSION_SECRET",
]);
for (const [k, v] of Object.entries(templateEnvVars)) {
  if (v?.type === "secret_text") {
    secretNames.add(k);
  } else if (v?.type === "plain_text") {
    assert.ok(k === "ANDROID_APK_KEY" || !/TOKEN|SECRET|PASSWORD|PEPPER|API_KEY|PRIVATE_KEY/i.test(k), `Unexpected secret-like plain var: ${k}`);
    plainVars[k] = String(v.value ?? "");
  }
}

const baseWrangler = JSON.parse(await fs.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
const mergedPlainVars = {
  ...(baseWrangler.env?.preview?.vars || {}),
  ...plainVars,
  WYJ_ENVIRONMENT: "preview",
  WORKERS_AI_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK22_TRANSFER_READS_ENABLED: "true",
  TASK22_TRANSFER_WRITES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: plainVars.D1_RATE_LIMIT_ENABLED ?? "false",
};

const envVarsPayload = {};
for (const [k, v] of Object.entries(mergedPlainVars)) {
  envVarsPayload[k] = { type: "plain_text", value: String(v) };
}
for (const secretKey of [...secretNames].sort()) {
  envVarsPayload[secretKey] = { type: "secret_text", value: randomBytes(32).toString("hex") };
}

// 3. Create or update isolated Pages project thewyj-i10-preview
let i10Project = await cfApi(token, `/pages/projects/${PROJECT}`, { allow404: true });
if (!i10Project) {
  i10Project = await cfApi(token, "/pages/projects", {
    method: "POST",
    body: {
      name: PROJECT,
      production_branch: PRODUCTION_BRANCH,
    },
  });
}

const deployCfgPatch = {
  compatibility_date: baseWrangler.compatibility_date,
  d1_databases: { WYJ_DB: { id: d1Id } },
  r2_buckets: { WYJ_STORAGE: { name: R2_NAME } },
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
assert.equal(previewCfg.env_vars?.LEGACY_API_FALLBACK_ENABLED?.value, "false");

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
      migrations_dir: path.join(ROOT, "cloudflare", "migrations").replace(/\\/g, "/"),
    },
  ],
};
await fs.writeFile(D1_CONFIG_PATH, `${JSON.stringify(d1Config, null, 2)}\n`);

const migRes = spawnSync(
  process.execPath,
  [WRANGLER, "d1", "migrations", "apply", D1_NAME, "--remote", "--config", D1_CONFIG_PATH],
  { cwd: ROOT, input: "y\ny\n", encoding: "utf8", timeout: 180_000 },
);
assert.equal(migRes.status, 0, `D1 migrations failed:\n${migRes.stdout}\n${migRes.stderr}`);

const ts = new Date().toISOString();
const seedSql = `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I10 isolated preview public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, '${ts}', NULL, 'i10-provision', 'i10-provision'),
         ('aeris_experimental_badge', 'I10 isolated preview Kill Switch test flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, '${ts}', NULL, 'i10-provision-2', 'i10-provision-2')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at;`;
const seedRes = spawnSync(
  process.execPath,
  [WRANGLER, "d1", "execute", D1_NAME, "--remote", "--config", D1_CONFIG_PATH, "--command", seedSql],
  { cwd: ROOT, input: "y\n", encoding: "utf8", timeout: 60_000 },
);
assert.equal(seedRes.status, 0, `D1 p07 seed failed:\n${seedRes.stdout}\n${seedRes.stderr}`);

await fs.mkdir(path.dirname(PROVISION_OUT), { recursive: true });
const provisionSummary = {
  schema_version: 1,
  environment: "isolated-preview",
  project: PROJECT,
  branch: PREVIEW_BRANCH,
  production_branch: verifiedProject.production_branch,
  d1_name: D1_NAME,
  d1_id: d1Id,
  r2_name: R2_NAME,
  r2_buckets: Object.keys(previewCfg.r2_buckets || {}),
  ai_bindings: Object.keys(previewCfg.ai_bindings || {}),
  workers_ai_enabled: previewCfg.env_vars?.WORKERS_AI_ENABLED?.value,
  email_sending_enabled: previewCfg.env_vars?.EMAIL_SENDING_ENABLED?.value,
  legacy_api_fallback_enabled: previewCfg.env_vars?.LEGACY_API_FALLBACK_ENABLED?.value,
  secret_names: [...secretNames].sort(),
  migrated_and_seeded_p07: true,
  provisioned_at: new Date().toISOString(),
};
await fs.writeFile(PROVISION_OUT, `${JSON.stringify(provisionSummary, null, 2)}\n`);
console.log(JSON.stringify(provisionSummary, null, 2));
