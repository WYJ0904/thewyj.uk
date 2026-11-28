import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePages, isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const PROVISION_PATH = path.join(ROOT, "docs", "ui-rebuild", "v63-phase6-transfer", "evidence", "p6p9-preview-provision.json");
const PHASE8_DEPLOY_PATH = path.join(ROOT, "docs", "ui-rebuild", "v63-phase8-admin", "evidence", "hosted-preview-deploy.json");
const PHASE8_BRANCH = "v63-phase8";

const provision = JSON.parse(await fs.readFile(PROVISION_PATH, "utf8"));
assert.equal(provision.project, "thewyj-v63-p6p9-preview");
assert.equal(provision.d1_name, "aeris-v63-p6p9-preview");
assert.equal(provision.r2_name, "aeris-v63-p6p9-storage");
assert.notEqual(provision.d1_id, "a3e6253b-689f-49f3-998b-7c5828ea255a");
assert.notEqual(provision.d1_id, "11c288d8-c584-409f-bb1f-7e7af11793e5");

function getWranglerToken() {
  const res = spawnSync(process.execPath, [WRANGLER, "auth", "token", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  return parsed.token || parsed.oauth_token || parsed.api_token;
}

const token = getWranglerToken();
const projRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${provision.project}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const projJson = await projRes.json();
assert.equal(projJson.success, true);
const previewCfg = projJson.result.deployment_configs?.preview || {};
assert.equal(previewCfg.d1_databases?.WYJ_DB?.id, provision.d1_id);
assert.equal(previewCfg.r2_buckets?.WYJ_STORAGE?.name, provision.r2_name);
assert.equal(Object.keys(previewCfg.ai_bindings || {}).length, 0);

const plainVars = {};
for (const [k, v] of Object.entries(previewCfg.env_vars || {})) {
  if (v?.type === "plain_text") plainVars[k] = String(v.value ?? "");
}

const { output: stagedOutput } = await stagePages({ root: ROOT });

const baseWrangler = JSON.parse(await fs.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
const deployCtx = path.join(ROOT, ".wrangler", "p6p9-deploy-context");
await fs.rm(deployCtx, { recursive: true, force: true });
await fs.mkdir(deployCtx, { recursive: true });

try {
  await fs.cp(stagedOutput, path.join(deployCtx, ".wrangler", "pages-output"), { recursive: true });

  async function copyAllowlistedDir(srcDir, relBase) {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(srcDir, entry.name);
      const rel = `${relBase}/${entry.name}`;
      if (entry.isDirectory()) {
        await copyAllowlistedDir(abs, rel);
      } else if (entry.isFile() && isAllowedPagesFile(rel)) {
        const dest = path.join(deployCtx, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
      }
    }
  }
  await copyAllowlistedDir(path.join(ROOT, "functions"), "functions");
  await copyAllowlistedDir(path.join(ROOT, "js"), "js");

  const isolatedWrangler = {
    name: provision.project,
    pages_build_output_dir: "./.wrangler/pages-output",
    compatibility_date: baseWrangler.compatibility_date,
    send_metrics: false,
    vars: plainVars,
    d1_databases: [
      {
        binding: "WYJ_DB",
        database_name: provision.d1_name,
        database_id: provision.d1_id,
        preview_database_id: provision.d1_id,
      },
    ],
    r2_buckets: [
      {
        binding: "WYJ_STORAGE",
        bucket_name: provision.r2_name,
        preview_bucket_name: provision.r2_name,
      },
    ],
  };
  await fs.writeFile(path.join(deployCtx, "package.json"), JSON.stringify({ name: "aeris-p6p9-isolated-deploy", private: true, type: "module" }) + "\n");
  await fs.writeFile(path.join(deployCtx, "wrangler.jsonc"), JSON.stringify(isolatedWrangler, null, 2) + "\n");

  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const deployRes = spawnSync(
    process.execPath,
    [
      WRANGLER, "pages", "deploy", ".wrangler/pages-output",
      "--project-name", provision.project,
      "--branch", PHASE8_BRANCH,
      "--commit-hash", headSha,
      "--commit-dirty=false",
    ],
    { cwd: deployCtx, encoding: "utf8", timeout: 180_000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  assert.equal(deployRes.status, 0, `Isolated Pages deploy failed:\n${deployRes.stdout}\n${deployRes.stderr}`);
  assert.ok(deployRes.stdout.includes("Uploading Functions bundle"), "Pages Functions bundle must be built and uploaded!");
  console.log(deployRes.stdout);

  const postRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${provision.project}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const postJson = await postRes.json();
  const postCfg = postJson.result.deployment_configs?.preview || {};
  assert.equal(postCfg.d1_databases?.WYJ_DB?.id, provision.d1_id, "Post-deploy D1 binding drifted!");
  assert.equal(postCfg.r2_buckets?.WYJ_STORAGE?.name, provision.r2_name, "Post-deploy R2 binding drifted!");
  assert.equal(Object.keys(postCfg.ai_bindings || {}).length, 0, "Post-deploy AI binding unexpectedly added!");
  for (const secretKey of ["WYJ_TASK12_PASSWORD_PEPPER", "WYJ_TASK14_TEMPORARY_SECRET", "WYJ_TASK20_DEVICE_SESSION_SECRET"]) {
    assert.equal(postCfg.env_vars?.[secretKey]?.type, "secret_text", `Post-deploy missing secret_text ${secretKey}`);
  }

  const deployUrlMatch = deployRes.stdout.match(/https:\/\/[a-z0-9-]+\.thewyj-v63-p6p9-preview\.pages\.dev/i);
  const record = {
    project: provision.project,
    branch: PHASE8_BRANCH,
    branch_alias_url: `https://${PHASE8_BRANCH}.${provision.project}.pages.dev`,
    latest_deployment_url: deployUrlMatch ? deployUrlMatch[0] : "",
    d1_name: provision.d1_name,
    d1_id: provision.d1_id,
    r2_name: provision.r2_name,
    deployed_commit: headSha,
    deployed_at: new Date().toISOString(),
    p6_branch_preserved: provision.branch,
    p7_branch_preserved: "v63-phase7",
  };
  await fs.mkdir(path.dirname(PHASE8_DEPLOY_PATH), { recursive: true });
  await fs.writeFile(PHASE8_DEPLOY_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log("POST_DEPLOY_ISOLATION_VERIFIED", JSON.stringify(record));
} finally {
  await fs.rm(deployCtx, { recursive: true, force: true }).catch(() => {});
}
