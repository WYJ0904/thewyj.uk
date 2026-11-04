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
const BRANCH_NAME = "v62-p07-phase1-rework";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PREVIEW_EVIDENCE_DIR = path.join(ROOT, "docs/p07/evidence/phase1-rework/preview");

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
const buildLabel = `phase1-rework-${COMMIT.slice(0, 10)}-${Date.now()}`;
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
  JSON.stringify({ name: "aeris-p07-phase1-preview-build", private: true, type: "module" })
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
  "THIRD_PARTY_NOTICES.md",
  "tools.js",
  "workspace-experience.css",
  "workflows.js",
]);

for (const row of rows) {
  if (!row || row.length === 0) continue;
  const tabIdx = row.indexOf("\t");
  if (tabIdx < 0) continue;
  const meta = row.slice(0, tabIdx);
  const relName = row.slice(tabIdx + 1);
  const [mode, kind, blobSha] = meta.split(/\s+/);
  if (!["100644", "100755"].includes(mode) || kind !== "blob") continue;
  if (!isAllowedPagesFile(relName)) continue;

  const cat = spawnSync("git", ["cat-file", "blob", blobSha], {
    cwd: ROOT,
    maxBuffer: 25 * 1024 * 1024,
  });
  assert.equal(cat.status, 0, `git cat-file failed for ${relName}`);
  const raw = cat.stdout;
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
    "Aeris V6.2 P07 Phase 1 Visual Rework isolated Preview",
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

// 4. Verify deployment metadata & zero Preview config drift
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

// 5. Verify HTTP 200 + SHA-256 byte integrity of committed public files on live Hosted Preview
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

const indexExpectedSha = publicCheckFiles.find((f) => f.path === "index.html")?.sha256;
let publicPassCount = 0;
const publicFailures = [];

for (const item of publicCheckFiles) {
  const urlPath = item.path === "index.html" ? "/" : `/${item.path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await resilientFetch(`${previewOrigin}${urlPath}`, {
    headers: { "Cache-Control": "no-cache", "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(30_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const actualSha = sha256(buf);
  if (res.status === 200 && actualSha === item.sha256) {
    publicPassCount++;
  } else {
    publicFailures.push({ path: item.path, status: res.status, expected: item.sha256, actual: actualSha });
  }
}
assert.deepEqual(publicFailures, [], `Public static SHA-256 verification failed: ${JSON.stringify(publicFailures.slice(0, 5))}`);

// Verify non-public workspace files are NOT served
const exclusionChecks = [];
for (const forbidden of ["package.json", ".git/config", "wrangler.jsonc", "docs/p07/P07_IMPLEMENTATION_READINESS.md"]) {
  const res = await resilientFetch(`${previewOrigin}/${forbidden}`, {
    headers: { "Cache-Control": "no-cache", "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(20_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const isSpaShell = sha256(buf) === indexExpectedSha;
  const safe = [400, 403, 404].includes(res.status) || (res.status === 200 && isSpaShell);
  assert.ok(safe, `Forbidden path leaked on Preview: ${forbidden} (${res.status})`);
  exclusionChecks.push({ path: forbidden, status: res.status, spaShellFallback: isSpaShell, safe });
}

// 6. Real Headless Chrome Live Verification & Live Hosted Preview Screenshots
const chromeCandidates = [
  process.env.AERIS_QA_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let chromeExe = "";
for (const c of chromeCandidates) {
  try {
    await fsp.access(c);
    chromeExe = c;
    break;
  } catch {}
}
assert.ok(chromeExe, "Headless Chrome/Edge unavailable for live Preview check");

const cdpPort = 19338;
const chromeProfile = path.join(buildContext, "live-chrome-profile");
const chromeLog = openSync(path.join(buildContext, "live-chrome.log"), "w");
const chromeProc = spawn(
  chromeExe,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${chromeProfile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", chromeLog, chromeLog] }
);
closeSync(chromeLog);

let liveBrowserProof = null;
try {
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  for (let i = 0; i < 60; i++) {
    try {
      const ok = (await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
      if (ok) break;
    } catch {}
    await delay(150);
  }

  const page = await openPage({ cdpUrl, baseUrl: previewOrigin, width: 1440, height: 960, mobile: false });
  try {
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "delete globalThis.__WYJ_TEST_MODE__;",
    });
    const uiApi = await fetch(`${previewOrigin}/api/ui/features`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());

    await page.navigate("/");
    await page.waitFor(
      "!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && !document.getElementById('publicHome').classList.contains('hidden')",
      30_000,
      "Live Hosted Preview / ready"
    );
    await delay(400);

    const liveHome = await page.evaluate(`({
      origin: location.origin,
      p07Ui: document.documentElement.dataset.p07Ui,
      previewBannerHidden: document.getElementById("aerisPreviewNotice")?.hidden,
      previewBannerText: document.getElementById("aerisPreviewNotice")?.textContent.trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      sidebarBg: getComputedStyle(document.getElementById("v3Sidebar")).backgroundColor,
      learningCardBg: getComputedStyle(document.querySelector("#publicHome .hero-scene-learning .home-widget-visual")).backgroundColor,
      financeCardBg: getComputedStyle(document.querySelector("#publicHome .hero-scene-finance .home-widget-visual")).backgroundColor,
      toolsCardBg: getComputedStyle(document.querySelector("#publicHome .hero-scene-tools .home-widget-visual")).backgroundColor,
      summaryCardCount: document.querySelectorAll("#homeV3SummaryGrid .v3-summary-card").length,
      demoBadges: document.querySelectorAll("#publicHome [data-widget-demo]:not([hidden])").length,
    })`);

    assert.equal(liveHome.p07Ui, uiApi.public_ui?.enabled ? "enabled" : "disabled");
    if (uiApi.public_ui?.enabled) {
      assert.equal(liveHome.previewBannerHidden, false, "Hosted Preview banner must be visible on *.pages.dev");
      assert.equal(liveHome.bodyBg, "rgb(244, 246, 249)");
      assert.equal(liveHome.sidebarBg, "rgb(255, 255, 255)");
      assert.equal(liveHome.learningCardBg, "rgb(239, 246, 255)");
      assert.equal(liveHome.financeCardBg, "rgb(238, 250, 243)");
      assert.equal(liveHome.toolsCardBg, "rgb(245, 240, 255)");
      assert.equal(liveHome.summaryCardCount, 4);
    }

    const shotHome1440 = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-home-1440.png"), Buffer.from(shotHome1440.data, "base64"));

    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(250);
    const shotHome390 = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-home-390.png"), Buffer.from(shotHome390.data, "base64"));

    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.navigate("/login");
    await page.waitFor(
      "!document.getElementById('entryScreen') && document.getElementById('authPanel').getClientRects().length > 0 && (!uiApi.public_ui?.enabled || document.documentElement.dataset.p07Ui === 'enabled')",
      30_000,
      "Live Hosted Preview /login ready"
    );
    await delay(250);
    const shotLogin1440 = await page.send("Page.captureScreenshot", { format: "png" });
    await fsp.writeFile(path.join(PREVIEW_EVIDENCE_DIR, "preview-live-login-1440.png"), Buffer.from(shotLogin1440.data, "base64"));

    assert.deepEqual(page.runtimeErrors, []);
    liveBrowserProof = {
      uiFeaturesApi: uiApi,
      liveHome,
      runtimeErrors: page.runtimeErrors,
      screenshots: [
        "docs/p07/evidence/phase1-rework/preview/preview-live-home-1440.png",
        "docs/p07/evidence/phase1-rework/preview/preview-live-home-390.png",
        "docs/p07/evidence/phase1-rework/preview/preview-live-login-1440.png",
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
  status: "PREVIEW_DEPLOYED_AND_VERIFIED",
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
  exclusionChecks,
  liveBrowserProof,
};

const proofPath = path.join(PREVIEW_EVIDENCE_DIR, "preview-deployment-proof.json");
await fsp.writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: proof.status,
  url: proof.url,
  aliases: proof.aliases,
  deploymentId: proof.deploymentId,
  publicStaticVerifiedCount: proof.publicStaticVerifiedCount,
  p07Ui: liveBrowserProof?.liveHome?.p07Ui,
}));
