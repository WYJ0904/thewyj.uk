import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const PRODUCTION_DB_ID = "11c288d8-c584-409f-bb1f-7e7af11793e5";
const I04_DB_ID = "bd1c84a6-dc4d-4814-836e-2b6ce477a641";
const I05_DB_ID = "9e76a190-42db-4ff1-b0b7-476e4b312792";
const PROJECT = process.env.I06_PREVIEW_PROJECT || "thewyj-i06-preview";
const D1_NAME = process.env.I06_PREVIEW_D1_NAME || "aeris-i06-preview";
const PREVIEW_BRANCH = process.env.I06_PREVIEW_BRANCH || "i06-module-experience";
const PRODUCTION_BRANCH = "release-held";
const TEMPLATE_PROJECT = "thewyj-i05-preview";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const D1_CONFIG_PATH = path.join(ROOT, ".wrangler", "i06-preview-d1.jsonc");
const PROVISION_OUT = path.join(ROOT, "docs", "ui-rebuild", "i06", "evidence", "i06-preview-provision.json");

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

// 1. Find or create isolated D1 aeris-i06-preview
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
assert.notEqual(d1Id, PRODUCTION_DB_ID, "Refusing to use Production D1 ID");
assert.notEqual(d1Id, I04_DB_ID, "Refusing to reuse I04 Preview D1 ID");
assert.notEqual(d1Id, I05_DB_ID, "Refusing to reuse I05 Preview D1 ID");

// 2. Read safe non-secret config + secret key names from template project (values never printed)
const templateProject = await cfApi(token, `/pages/projects/${TEMPLATE_PROJECT}`);
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
  D1_RATE_LIMIT_ENABLED: plainVars.D1_RATE_LIMIT_ENABLED ?? "false",
};

const envVarsPayload = {};
for (const [k, v] of Object.entries(mergedPlainVars)) {
  envVarsPayload[k] = { type: "plain_text", value: String(v) };
}
for (const secretKey of [...secretNames].sort()) {
  // Fresh isolated cryptographic secret for I06 Preview only; never logged or stored.
  envVarsPayload[secretKey] = { type: "secret_text", value: randomBytes(32).toString("hex") };
}

// 3. Create or update isolated Pages project thewyj-i06-preview
let i06Project = await cfApi(token, `/pages/projects/${PROJECT}`, { allow404: true });
if (!i06Project) {
  i06Project = await cfApi(token, "/pages/projects", {
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
  r2_buckets: {},
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

// 4. Verify bindings & zero secrets leaked
const verifiedProject = await cfApi(token, `/pages/projects/${PROJECT}`);
const previewCfg = verifiedProject.deployment_configs?.preview || {};
assert.equal(verifiedProject.production_branch, PRODUCTION_BRANCH);
assert.notEqual(PREVIEW_BRANCH, verifiedProject.production_branch);
assert.equal(previewCfg.d1_databases?.WYJ_DB?.id, d1Id);
assert.equal(Object.keys(previewCfg.r2_buckets || {}).length, 0);
assert.equal(Object.keys(previewCfg.ai_bindings || {}).length, 0);
assert.equal(previewCfg.env_vars?.WORKERS_AI_ENABLED?.value, "false");
assert.equal(previewCfg.env_vars?.EMAIL_SENDING_ENABLED?.value, "false");
assert.equal(previewCfg.env_vars?.LEGACY_API_FALLBACK_ENABLED?.value, "false");
for (const secretKey of secretNames) {
  assert.equal(previewCfg.env_vars?.[secretKey]?.type, "secret_text", `Missing secret_text binding for ${secretKey}`);
}

// 5. Write isolated wrangler D1 config (outside git) and apply migrations + seed p07_accessibility=1
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

const seedSql = `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I06 isolated preview public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, '${new Date().toISOString()}', NULL, 'i06-provision', 'i06-provision')
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
