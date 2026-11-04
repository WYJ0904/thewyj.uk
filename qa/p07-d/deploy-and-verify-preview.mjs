import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, openSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePages, isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROJECT = "thewyj-p07-ui-rc";
const PREVIEW_D1_ID = "ee869f78-b54a-4018-bc99-871089ecb8cd";
const ACCOUNT_ID = "97c274a981e8dd6703aa6388e11c4614";
const BRANCH_NAME = "v62-p07-d-workspaces";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PREVIEW_EVIDENCE_DIR = path.join(ROOT, "docs/p07/evidence/p07-d/preview");

const commitArgIdx = process.argv.indexOf("--commit");
const COMMIT = commitArgIdx >= 0 ? process.argv[commitArgIdx + 1] : "";
assert.match(COMMIT, /^[0-9a-f]{40}$/, "Pass --commit <40-hex-sha>");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function getWranglerToken() {
  const res = spawnSync(process.execPath, [WRANGLER, "auth", "token", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(res.status, 0, "Wrangler auth token unavailable");
  const parsed = JSON.parse(res.stdout);
  const token = parsed.token || parsed.oauth_token || parsed.api_token;
  assert.ok(token, "Empty Wrangler auth token");
  return token;
}

async function cfApiGet(token, route) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${route}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  assert.equal(data.success, true, `Cloudflare API GET ${route} failed`);
  return data.result;
}

await fsp.mkdir(PREVIEW_EVIDENCE_DIR, { recursive: true });
const buildLabel = `p07-d-workspaces-${COMMIT.slice(0, 10)}-${Date.now()}`;
const buildContext = path.join(ROOT, ".wrangler/owned-preview-builds", buildLabel);
await fsp.mkdir(buildContext, { recursive: true });

const token = getWranglerToken();

// 1. Read-only Cloudflare Pages project safety check before building/deploying
const project = await cfApiGet(token, `/pages/projects/${PROJECT}`);
const previewCfg = project.deployment_configs?.preview || {};
assert.equal(project.name, PROJECT);
assert.equal(previewCfg.d1_databases?.WYJ_DB?.id, PREVIEW_D1_ID, "Preview WYJ_DB must match isolated Preview D1");
assert.ok(!previewCfg.r2_buckets || Object.keys(previewCfg.r2_buckets).length === 0, "Preview must have zero R2 bindings");
assert.ok(!previewCfg.ai_bindings || Object.keys(previewCfg.ai_bindings).length === 0, "Preview must have zero AI bindings");
assert.notEqual(BRANCH_NAME, project.production_branch, "Preview branch must never match production_branch");

const plainVars = {};
for (const [k, v] of Object.entries(previewCfg.env_vars || {})) {
  if (v?.type === "plain_text") {
    assert.ok(!/TOKEN|SECRET|PASSWORD|PEPPER|KEY/i.test(k), `Unexpected plaintext secret-like key: ${k}`);
    plainVars[k] = v.value;
  }
}
assert.equal(String(plainVars.WORKERS_AI_ENABLED).toLowerCase(), "false", "WORKERS_AI_ENABLED must be false");
assert.ok([undefined, "false"].includes(plainVars.LEGACY_API_FALLBACK_ENABLED), "LEGACY_API_FALLBACK_ENABLED must not be enabled");

const d1Info = await cfApiGet(token, `/d1/database/${PREVIEW_D1_ID}`);
const baseWrangler = JSON.parse(await fsp.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
const isolatedWrangler = {
  name: PROJECT,
  pages_build_output_dir: "./.wrangler/pages-output",
  compatibility_date: baseWrangler.compatibility_date,
  send_metrics: false,
  vars: { ...plainVars, LEGACY_API_FALLBACK_ENABLED: "false" },
  d1_databases: [
    {
      binding: "WYJ_DB",
      database_name: d1Info.name,
      database_id: PREVIEW_D1_ID,
      preview_database_id: PREVIEW_D1_ID,
    },
  ],
};
await fsp.writeFile(
  path.join(buildContext, "package.json"),
  JSON.stringify({ name: "aeris-p07-d-preview-build", private: true, type: "module" })
);
await fsp.writeFile(path.join(buildContext, "wrangler.jsonc"), `${JSON.stringify(isolatedWrangler, null, 2)}\n`);

// 2. Materialize ONLY committed Git blobs passing stage_pages_deploy.mjs allowlist
const lsTree = spawnSync("git", ["ls-tree", "-rz", COMMIT], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
assert.equal(lsTree.status, 0, "git ls-tree failed");
const rows = lsTree.stdout.split("\0");
const allowlistedFiles = [];
const publicCheckFiles = [];

const publicRootSet = new Set([
  "app.js",
  "changelog.js",
  "design-system.css",
  "favicon.ico",
  "icon-192.png",
  "icon-512.png",
  "index.html",
  "learning-sync.js",
  "manifest.webmanifest",
  "product-ui.css",
  "public-experience.css",
  "spatial-experience.css",
  "styles.css",
  "sw.js",
  "tools.js",
  "workflows.js",
  "workspace-experience.css",
]);

for (const row of rows) {
  if (!row) continue;
  const match = row.match(/^(\d{6})\s+blob\s+([0-9a-f]{40})\t(.+)$/);
  if (!match) continue;
  const [, mode, blobSha, relPath] = match;
  const relName = relPath.replaceAll("\\", "/");
  if (!isAllowedPagesFile(relName)) continue;

  const show = spawnSync("git", ["cat-file", "-p", blobSha], {
    cwd: ROOT,
    maxBuffer: 30 * 1024 * 1024,
  });
  assert.equal(show.status, 0, `Failed to load blob for ${relName}`);
  const raw = show.stdout;
  const dest = path.join(buildContext, relName);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, raw);

  const digest = sha256(raw);
  allowlistedFiles.push({ path: relName, bytes: raw.length, sha256: digest });
  if (publicRootSet.has(relName) || relName.startsWith("assets/") || relName.startsWith("js/") || relName.startsWith("vendor/")) {
    publicCheckFiles.push({ path: relName, bytes: raw.length, sha256: digest });
  }
}
assert.ok(allowlistedFiles.length >= 140, `Expected >=140 allowlisted files, got ${allowlistedFiles.length}`);

const staged = await stagePages({ root: buildContext });
for (const item of allowlistedFiles) {
  const stagedBytes = await fsp.readFile(path.join(staged.output, item.path));
  assert.equal(sha256(stagedBytes), item.sha256, `Staged file hash mismatch: ${item.path}`);
}

// 3. Deploy to isolated Pages Preview project `thewyj-p07-ui-rc`
console.log(`--> Deploying branch ${BRANCH_NAME} to ${PROJECT}...`);
const deployRes = spawnSync(
  process.execPath,
  [
    WRANGLER,
    "pages",
    "deploy",
    staged.output,
    "--project-name",
    PROJECT,
    "--branch",
    BRANCH_NAME,
    "--commit-hash",
    COMMIT,
    "--commit-message",
    "Aeris V6.2 P07-D Business Workspaces isolated Preview",
    "--commit-dirty=false",
  ],
  {
    cwd: buildContext,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 20 * 1024 * 1024,
  }
);
await fsp.writeFile(
  path.join(buildContext, "wrangler-deploy.log"),
  `${deployRes.stdout || ""}\n${deployRes.stderr || ""}`,
  "utf8"
);
assert.equal(deployRes.status, 0, `Wrangler Pages deploy failed:\n${deployRes.stdout}\n${deployRes.stderr}`);

// 4. Verify deployment metadata
const deployments = await cfApiGet(token, `/pages/projects/${PROJECT}/deployments?env=preview&per_page=20`);
const matched = deployments.find((d) => d?.deployment_trigger?.metadata?.commit_hash === COMMIT);
assert.ok(matched, `No preview deployment found matching commit ${COMMIT}`);
assert.equal(matched.environment, "preview");
assert.equal(matched.latest_stage?.status, "success");

const afterProject = await cfApiGet(token, `/pages/projects/${PROJECT}`);
const afterPreviewCfg = afterProject.deployment_configs?.preview || {};
assert.equal(afterPreviewCfg.d1_databases?.WYJ_DB?.id, PREVIEW_D1_ID);
assert.ok(!afterPreviewCfg.r2_buckets || Object.keys(afterPreviewCfg.r2_buckets).length === 0);
assert.ok(!afterPreviewCfg.ai_bindings || Object.keys(afterPreviewCfg.ai_bindings).length === 0);

const previewOrigin = new URL(matched.url).origin;
const branchAliases = matched.aliases || [];
console.log(`--> Live preview URL: ${previewOrigin}`);

// 5. Verify HTTP 200 + SHA-256 integrity of at least 87 public files
async function resilientFetch(url, options = {}, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries) throw err;
      await delay(500 * i);
    }
  }
}

let publicPassCount = 0;
const publicFailures = [];

for (const item of publicCheckFiles) {
  const targetUrl = `${previewOrigin}/${item.path}`;
  const res = await resilientFetch(targetUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res || !res.ok) {
    publicFailures.push({ path: item.path, status: res ? res.status : "network_error" });
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const actualHash = sha256(buf);
  if (actualHash !== item.sha256) {
    publicFailures.push({ path: item.path, expected: item.sha256, actual: actualHash });
  } else {
    publicPassCount++;
  }
}
assert.equal(publicFailures.length, 0, `Public file hash failures: ${JSON.stringify(publicFailures)}`);
assert.ok(publicPassCount >= 87, `Expected >= 87 verified public files, got ${publicPassCount}`);
console.log(`[PASS] Verified ${publicPassCount} public static assets SHA-256 on live preview.`);

// 6. Access Live Hosted Preview via headless Chromium and capture screenshots
const chromeCandidates = [
  process.env.AERIS_QA_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let chromeExe = "";
for (const cand of chromeCandidates) {
  if (await exists(cand)) {
    chromeExe = cand;
    break;
  }
}
assert.ok(chromeExe, "Headless Chrome/Edge not found");

const cdpPort = 19328;
const chromeLog = openSync(path.join(buildContext, "chrome-preview.log"), "w");
const chromeProc = spawn(
  chromeExe,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${path.join(buildContext, "chrome-profile")}`,
    "about:blank",
  ],
  { cwd: buildContext, env: { ...process.env, NO_PROXY: "127.0.0.1,localhost" }, windowsHide: true, stdio: ["ignore", chromeLog, chromeLog] }
);
closeSync(chromeLog);

let liveBrowserProof = null;
try {
  let cdpReady = false;
  for (let i = 0; i < 40; i++) {
    if (await healthy(`http://127.0.0.1:${cdpPort}/json/version`)) {
      cdpReady = true;
      break;
    }
    await delay(250);
  }
  assert.ok(cdpReady, "CDP endpoint failed to initialize");

  const page = await openPage({ cdpUrl: `http://127.0.0.1:${cdpPort}`, baseUrl: previewOrigin, width: 1440, height: 960, mobile: false });
  try {
    await page.send("Page.bringToFront");
    await page.navigate("/");
    await page.waitFor(
      "!document.getElementById('entryScreen') && !document.getElementById('publicHome').classList.contains('hidden')",
      30_000,
      "Live preview home ready"
    );
    await delay(300);

    const shotHome1440 = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-home-1440.png"), Buffer.from(shotHome1440.data, "base64"));

    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    const shotHome390 = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-home-390.png"), Buffer.from(shotHome390.data, "base64"));

    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.navigate("/tools");
    await delay(300);
    const shotTools = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-tools-1440.png"), Buffer.from(shotTools.data, "base64"));

    await page.navigate("/language");
    await delay(300);
    const shotLang = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-language-1440.png"), Buffer.from(shotLang.data, "base64"));

    assert.deepEqual(page.runtimeErrors, []);
    liveBrowserProof = {
      previewUrl: previewOrigin,
      runtimeErrors: page.runtimeErrors,
      screenshots: [
        "docs/p07/evidence/p07-d/preview/preview-live-home-1440.png",
        "docs/p07/evidence/p07-d/preview/preview-live-home-390.png",
        "docs/p07/evidence/p07-d/preview/preview-live-tools-1440.png",
        "docs/p07/evidence/p07-d/preview/preview-live-language-1440.png",
      ],
    };
  } finally {
    await page.close().catch(() => {});
  }
} finally {
  if (process.platform === "win32" && chromeProc.pid) {
    spawnSync("taskkill.exe", ["/PID", String(chromeProc.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      chromeProc.kill();
    } catch {}
  }
}

const proof = {
  deployedAt: new Date().toISOString(),
  status: "P07_D_PREVIEW_DEPLOYED_AND_VERIFIED",
  commit: COMMIT,
  project: PROJECT,
  branch: BRANCH_NAME,
  deploymentId: matched.id,
  url: previewOrigin,
  aliases: branchAliases,
  isolatedPreviewD1Id: PREVIEW_D1_ID,
  r2BindingsCount: 0,
  aiBindingsCount: 0,
  safePreviewVars: {
    WORKERS_AI_ENABLED: plainVars.WORKERS_AI_ENABLED,
    LEGACY_API_FALLBACK_ENABLED: plainVars.LEGACY_API_FALLBACK_ENABLED ?? "false",
    TASK25_FEATURE_FLAGS_ENABLED: plainVars.TASK25_FEATURE_FLAGS_ENABLED,
    WYJ_ENVIRONMENT: plainVars.WYJ_ENVIRONMENT,
  },
  productionTouched: false,
  productionMutations: 0,
  remoteMigrations: 0,
  aiCalls: 0,
  allowlistedFileCount: allowlistedFiles.length,
  publicStaticVerifiedCount: publicPassCount,
  liveBrowserProof,
};

const proofPath = path.join(PREVIEW_EVIDENCE_DIR, "preview-deployment-proof.json");
await fsp.writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(`[PASS] Published preview deployment proof: ${proofPath}`);
