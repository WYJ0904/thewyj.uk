import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT = process.env.I05_PREVIEW_PROJECT || "thewyj-i05-preview";
const PREVIEW_BRANCH = process.env.I05_PREVIEW_BRANCH || "i05-workspace-density";
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const PRODUCTION_DB_ID = "11c288d8-c584-409f-bb1f-7e7af11793e5";
const I04_DB_ID = "bd1c84a6-dc4d-4814-836e-2b6ce477a641";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const STAGE_ROOT = path.join(ROOT, ".wrangler", "i05-preview-stage");
const OUTPUT_DIR = path.join(STAGE_ROOT, "pages-output");
const PROVISION_PATH = path.join(ROOT, "docs", "ui-rebuild", "i05", "evidence", "i05-preview-provision.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

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

async function cfApiGet(token, route) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${route}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  assert.equal(data.success, true, `Cloudflare API GET ${route} failed: ${JSON.stringify(data.errors)}`);
  return data.result;
}

let previewD1Id = process.env.I05_PREVIEW_D1_ID || "";
if (!previewD1Id) {
  try {
    const prov = JSON.parse(await fs.readFile(PROVISION_PATH, "utf8"));
    previewD1Id = prov.d1_id || "";
  } catch (_) {}
}

const doDeploy = process.argv.includes("--deploy");
const skipRemoteCheck = process.argv.includes("--local-only");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
assert.match(commit, /^[0-9a-f]{40}$/);

let remoteCheck = { verified: false };
let previewWrangler = null;

if (!skipRemoteCheck) {
  assert.ok(previewD1Id, "Missing I05 preview D1 ID; run qa/i05/provision-preview.mjs first");
  assert.notEqual(previewD1Id, PRODUCTION_DB_ID, "Target preview D1 must never equal Production DB");
  assert.notEqual(previewD1Id, I04_DB_ID, "Target preview D1 must never equal I04 DB");

  const token = getWranglerToken();
  const project = await cfApiGet(token, `/pages/projects/${PROJECT}`);
  const previewCfg = project.deployment_configs?.preview || {};
  assert.equal(project.name, PROJECT);
  assert.notEqual(PREVIEW_BRANCH, project.production_branch, "Preview branch must never match production_branch");
  const priorPreviewD1Id = previewCfg.d1_databases?.WYJ_DB?.id || null;
  const priorPreviewR2 = Object.keys(previewCfg.r2_buckets || {});

  assert.equal(priorPreviewD1Id, previewD1Id, `Project ${PROJECT} preview D1 must match ${previewD1Id}, got ${priorPreviewD1Id}`);
  assert.equal(priorPreviewR2.length, 0, `Project ${PROJECT} preview R2 must be empty, got ${JSON.stringify(priorPreviewR2)}`);

  const plainVars = {};
  for (const [k, v] of Object.entries(previewCfg.env_vars || {})) {
    if (v?.type === "plain_text") {
      assert.ok(k === "ANDROID_APK_KEY" || !/TOKEN|SECRET|PASSWORD|PEPPER|API_KEY|PRIVATE_KEY/i.test(k), `Unexpected secret-like plain var: ${k}`);
      plainVars[k] = v.value;
    }
  }
  const safeVars = {
    ...plainVars,
    WYJ_ENVIRONMENT: "preview",
    WORKERS_AI_ENABLED: "false",
    EMAIL_SENDING_ENABLED: "false",
    LEGACY_API_FALLBACK_ENABLED: "false",
  };
  const d1Info = await cfApiGet(token, `/d1/database/${previewD1Id}`);
  const baseWrangler = JSON.parse(await fs.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const d1Binding = {
    binding: "WYJ_DB",
    database_name: d1Info.name,
    database_id: previewD1Id,
    preview_database_id: previewD1Id,
  };
  previewWrangler = {
    name: PROJECT,
    pages_build_output_dir: "./pages-output",
    compatibility_date: baseWrangler.compatibility_date,
    send_metrics: false,
    vars: { ...safeVars },
    d1_databases: [d1Binding],
    r2_buckets: [],
    env: {
      preview: {
        vars: { ...safeVars },
        d1_databases: [{ ...d1Binding }],
        r2_buckets: [],
      },
    },
  };
  remoteCheck = {
    verified: true,
    project: project.name,
    branch: PREVIEW_BRANCH,
    productionBranch: project.production_branch,
    targetD1Id: previewD1Id,
    targetD1Name: d1Info.name,
    priorPreviewD1Id,
    priorPreviewR2,
    targetR2Count: 0,
    targetAiCount: 0,
    bindingConsistent: priorPreviewD1Id === previewD1Id && priorPreviewR2.length === 0,
  };
}

await fs.rm(STAGE_ROOT, { recursive: true, force: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });
const staged = await stagePages({ root: ROOT });
await fs.cp(staged.output, OUTPUT_DIR, { recursive: true });

const origHtml = await fs.readFile(path.join(OUTPUT_DIR, "index.html"), "utf8");
const banner = `<aside class="owner-preview-banner" id="ownerPreviewBanner" aria-label="隔离 Preview 环境" data-preview-source="${commit}">` +
  `<strong>隔离 Preview · Aeris I05 工作区与后台高密度风格统一</strong><span>独立预览项目 <code>${PROJECT}</code>（分支 <code>${PREVIEW_BRANCH}</code>），仅连接独立测试库 <code>aeris-i05-preview</code>，不接触正式用户与 Production。</span>` +
  `<details><summary>版本与验收入口</summary><small>源码 <code>${commit}</code> · <a href="/__preview/i07-fixture.html">I07 动效/开关 Fixture</a> · <a href="/__preview/build.json">构建证据</a></small></details></aside>`;
let nextHtml = origHtml.replace("</head>", '    <link rel="stylesheet" href="/__preview/preview-ui.css" />\n  </head>');
nextHtml = nextHtml.replace(/<body\b[^>]*>/, (m) => `${m}\n    ${banner}`);
nextHtml = nextHtml.replace("</body>", '    <script type="module" src="/__preview/preview-ui.js"></script>\n  </body>');
await fs.writeFile(path.join(OUTPUT_DIR, "index.html"), nextHtml);

const origHeaders = await fs.readFile(path.join(OUTPUT_DIR, "_headers"), "utf8");
await fs.writeFile(
  path.join(OUTPUT_DIR, "_headers"),
  `${origHeaders}\n/__preview/*\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n`,
);

const previewDir = path.join(OUTPUT_DIR, "__preview");
await fs.mkdir(previewDir, { recursive: true });
await fs.copyFile(path.join(ROOT, "qa/p07ui/preview-ui.js"), path.join(previewDir, "preview-ui.js"));
await fs.copyFile(path.join(ROOT, "qa/p07ui/preview-ui.css"), path.join(previewDir, "preview-ui.css"));
await fs.copyFile(path.join(ROOT, "qa/i07/fixture.html"), path.join(previewDir, "i07-fixture.html"));
await fs.copyFile(path.join(ROOT, "qa/i07/fixture.css"), path.join(previewDir, "i07-fixture.css"));
await fs.copyFile(path.join(ROOT, "qa/i07/fixture.js"), path.join(previewDir, "i07-fixture.js"));

await fs.cp(path.join(ROOT, "functions"), path.join(STAGE_ROOT, "functions"), { recursive: true });
await fs.cp(path.join(ROOT, "js"), path.join(STAGE_ROOT, "js"), { recursive: true });

if (previewWrangler) {
  await fs.writeFile(path.join(STAGE_ROOT, "wrangler.jsonc"), `${JSON.stringify(previewWrangler, null, 2)}\n`);
}

const manifestFiles = [];
async function walk(dir, prefix = "") {
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, rel);
    else if (rel !== "__preview/build.json") {
      const buf = await fs.readFile(full);
      manifestFiles.push({ path: rel, bytes: buf.length, sha256: sha256(buf) });
    }
  }
}
await walk(OUTPUT_DIR);

const buildJson = {
  schema_version: 1,
  environment: "isolated-preview",
  stage: "I05-workspace-admin-density",
  source_commit: commit,
  project_name: PROJECT,
  branch: PREVIEW_BRANCH,
  remote_check: remoteCheck,
  file_count: manifestFiles.length,
  artifact_tree_sha256: sha256(Buffer.from(JSON.stringify(manifestFiles))),
};
await fs.writeFile(path.join(previewDir, "build.json"), `${JSON.stringify(buildJson, null, 2)}\n`);

let deployResult = null;
if (doDeploy) {
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
  assert.equal(dirty, "", "Commit changes before deploying Hosted Preview so source_commit matches exact bytes");
  const dep = spawnSync(
    process.execPath,
    [WRANGLER, "pages", "deploy", "./pages-output", "--project-name", PROJECT, "--branch", PREVIEW_BRANCH, "--commit-hash", commit, "--commit-dirty=false"],
    { cwd: STAGE_ROOT, encoding: "utf8", timeout: 180_000 },
  );
  assert.equal(dep.status, 0, `Wrangler deploy failed:\n${dep.stdout}\n${dep.stderr}`);
  const projectPattern = new RegExp(`https:\\/\\/[a-z0-9-]+\\.${PROJECT.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\.pages\\.dev`, "g");
  const urls = (dep.stdout + "\n" + dep.stderr).match(projectPattern) || [];
  let deploymentId = "";
  let deployedD1Id = null;
  let deployedR2Count = 0;
  let deployedAiEnabled = null;
  if (!skipRemoteCheck) {
    const token = getWranglerToken();
    const afterProject = await cfApiGet(token, `/pages/projects/${PROJECT}`);
    assert.equal(afterProject.deployment_configs?.preview?.d1_databases?.WYJ_DB?.id, previewD1Id);
    assert.equal(Object.keys(afterProject.deployment_configs?.preview?.r2_buckets || {}).length, 0);
    const deps = await cfApiGet(token, `/pages/projects/${PROJECT}/deployments`);
    const latest = deps[0];
    assert.ok(latest, "Latest deployment metadata missing");
    assert.equal(latest.d1_databases?.WYJ_DB?.id, previewD1Id, "Live deployment D1 must match aeris-i05-preview");
    deploymentId = latest.id || "";
    deployedD1Id = latest.d1_databases?.WYJ_DB?.id || null;
    deployedR2Count = Object.keys(latest.r2_buckets || {}).length;
    deployedAiEnabled = latest.env_vars?.WORKERS_AI_ENABLED?.value ?? afterProject.deployment_configs?.preview?.env_vars?.WORKERS_AI_ENABLED?.value ?? null;
  }
  deployResult = {
    deployedUrl: urls[0] || `https://${PREVIEW_BRANCH}.${PROJECT}.pages.dev`,
    aliasUrl: `https://${PREVIEW_BRANCH}.${PROJECT}.pages.dev`,
    deploymentId,
    deployedD1Id,
    deployedR2Count,
    deployedAiEnabled,
  };
}

await fs.mkdir(path.join(ROOT, "docs", "ui-rebuild", "i05", "evidence"), { recursive: true });
await fs.writeFile(
  path.join(ROOT, "docs", "ui-rebuild", "i05", "evidence", "i05-preview-stage.json"),
  `${JSON.stringify({ buildJson, deployResult }, null, 2)}\n`,
);
console.log(JSON.stringify({ ok: true, project: PROJECT, branch: PREVIEW_BRANCH, commit, deployResult }, null, 2));
