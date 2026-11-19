import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT = process.env.I03_PREVIEW_PROJECT || "thewyj-i03-preview";
const PREVIEW_BRANCH = process.env.I03_PREVIEW_BRANCH || "i03-public-pages";
const PREVIEW_D1_ID = process.env.I03_PREVIEW_D1_ID || "ee869f78-b54a-4018-bc99-871089ecb8cd";
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const PRODUCTION_DB_ID = "11c288d8-c584-409f-bb1f-7e7af11793e5";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const STAGE_ROOT = path.join(ROOT, ".wrangler", "i03-preview-stage");
const OUTPUT_DIR = path.join(STAGE_ROOT, "pages-output");

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

const doDeploy = process.argv.includes("--deploy");
const skipRemoteCheck = process.argv.includes("--local-only");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
assert.match(commit, /^[0-9a-f]{40}$/);

let remoteCheck = { verified: false };
let previewWrangler = null;

if (!skipRemoteCheck) {
  const token = getWranglerToken();
  const project = await cfApiGet(token, `/pages/projects/${PROJECT}`);
  const previewCfg = project.deployment_configs?.preview || {};
  assert.equal(project.name, PROJECT);
  assert.notEqual(PREVIEW_BRANCH, project.production_branch, "Preview branch must never match production_branch");
  const priorPreviewD1Id = previewCfg.d1_databases?.WYJ_DB?.id || null;
  const priorPreviewR2 = Object.keys(previewCfg.r2_buckets || {});

  assert.equal(priorPreviewD1Id, PREVIEW_D1_ID, `Project ${PROJECT} preview D1 must match ${PREVIEW_D1_ID}, got ${priorPreviewD1Id}`);
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
    WORKERS_AI_ENABLED: "false",
    LEGACY_API_FALLBACK_ENABLED: "false",
  };
  const d1Info = await cfApiGet(token, `/d1/database/${PREVIEW_D1_ID}`);
  assert.notEqual(PREVIEW_D1_ID, PRODUCTION_DB_ID, "Target preview D1 must never equal Production DB");
  const baseWrangler = JSON.parse(await fs.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const d1Binding = {
    binding: "WYJ_DB",
    database_name: d1Info.name,
    database_id: PREVIEW_D1_ID,
    preview_database_id: PREVIEW_D1_ID,
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
    targetD1Id: PREVIEW_D1_ID,
    targetD1Name: d1Info.name,
    priorPreviewD1Id,
    priorPreviewR2,
    targetR2Count: 0,
    targetAiCount: 0,
    bindingConsistent: priorPreviewD1Id === PREVIEW_D1_ID && priorPreviewR2.length === 0,
  };
}

await fs.rm(STAGE_ROOT, { recursive: true, force: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });
const staged = await stagePages({ root: ROOT });
await fs.cp(staged.output, OUTPUT_DIR, { recursive: true });

const origHtml = await fs.readFile(path.join(OUTPUT_DIR, "index.html"), "utf8");
const banner = `<aside class="owner-preview-banner" id="ownerPreviewBanner" role="status" data-preview-source="${commit}">` +
  `<strong>隔离 Preview · Aeris I03 公开页面重构 + I07 复验</strong><span>独立预览项目 <code>${PROJECT}</code>（分支 <code>${PREVIEW_BRANCH}</code>），不连接正式账目与生产数据。</span>` +
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
  stage: "I03+I07-closeout",
  source_commit: commit,
  project_name: PROJECT,
  branch: PREVIEW_BRANCH,
  fixture_path: "/__preview/i07-fixture.html",
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
  let deployedD1 = null;
  let deployedR2 = null;
  let deployedAi = null;
  let deploymentId = null;
  let aliases = [];
  if (!skipRemoteCheck) {
    const token = getWranglerToken();
    const list = await cfApiGet(token, `/pages/projects/${PROJECT}/deployments`);
    const matchDep = list.find((item) => item.deployment_trigger?.metadata?.branch === PREVIEW_BRANCH);
    assert.ok(matchDep, `Deployed branch ${PREVIEW_BRANCH} must appear in ${PROJECT} deployments`);
    const fullDep = await cfApiGet(token, `/pages/projects/${PROJECT}/deployments/${matchDep.id}`);
    deploymentId = fullDep.id;
    aliases = fullDep.aliases || [];
    deployedD1 = fullDep.d1_databases || null;
    deployedR2 = fullDep.r2_buckets || null;
    deployedAi = fullDep.ai_bindings || null;
    assert.notEqual(fullDep.d1_databases?.WYJ_DB?.id, PRODUCTION_DB_ID, "Deployed Preview D1 must never equal Production DB");
    assert.equal(fullDep.d1_databases?.WYJ_DB?.id, PREVIEW_D1_ID, `Deployed Preview D1 must equal isolated target ${PREVIEW_D1_ID}`);
    assert.equal(Object.keys(fullDep.r2_buckets || {}).length, 0, "Deployed Preview R2 buckets must be empty");
    assert.equal(Object.keys(fullDep.ai_bindings || {}).length, 0, "Deployed Preview AI bindings must be empty");
  }
  deployResult = {
    deployed: true,
    deploymentId,
    aliases,
    urls: [...new Set([...urls, ...aliases])],
    deployedD1,
    deployedR2,
    deployedAi,
    stdout: dep.stdout.trim(),
  };
}

console.log(JSON.stringify({ status: "PASS", buildJson, deployResult }, null, 2));
