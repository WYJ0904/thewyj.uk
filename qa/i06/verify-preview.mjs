import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i06", "evidence", "hosted");
await mkdir(evidenceDir, { recursive: true });

const baseUrl = process.env.I06_PREVIEW_URL || "https://i06-module-experience.thewyj-i06-preview.pages.dev";
assert.equal(new URL(baseUrl).protocol, "https:");
assert.notEqual(new URL(baseUrl).hostname, "thewyj.uk", "Must NEVER run preview verification against Production");
assert.ok(new URL(baseUrl).hostname.includes("thewyj-i06-preview.pages.dev"), "Preview host must be isolated I06 Pages project");

const sourceOnly = process.argv.includes("--source-only");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const buildInfo = await fetch(`${baseUrl}/__preview/build.json`).then((r) => r.json());
const apiStatus = await fetch(`${baseUrl}/api/status`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
assert.equal(buildInfo.stage, "I06-module-experience");
assert.match(buildInfo.source_commit, /^[0-9a-f]{40}$/);
assert.equal(apiStatus.ok, true);
assert.equal(apiHealth.code, "authentication_required", "Unauthenticated /api/health must fail closed");
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated I06 Preview must have public_ui ON");

const verifiedAssets = [];
for (const assetPath of [
  "design-system.css",
  "spatial-experience.css",
  "app.js",
  "tools.js",
  "js/core/design-system.js",
  "js/core/feature-console.js",
  "js/finance/app.js",
  "js/transfer/app.js",
]) {
  const remoteBytes = Buffer.from(await fetch(`${baseUrl}/${assetPath}`).then((r) => r.arrayBuffer()));
  const localBytes = await readFile(path.join(root, assetPath));
  const remoteHash = sha256(remoteBytes);
  const localHash = sha256(localBytes);
  assert.equal(remoteHash, localHash, `Hosted Preview mismatch for ${assetPath}`);
  verifiedAssets.push({ assetPath, sha256: remoteHash, bytes: remoteBytes.length });
}

if (sourceOnly) {
  const summary = { status: "PASS", mode: "source-only", previewUrl: baseUrl, headCommit, verifiedAssets };
  await writeFile(path.join(evidenceDir, "i06-preview-source-check.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i06-preview-chrome-"));
const chrome = process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const child = spawn(
  chrome,
  [
    "--headless=new",
    ...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

const report = {
  previewUrl: baseUrl,
  headCommit,
  checkedAt: new Date().toISOString(),
  buildInfo,
  apiStatus,
  apiHealth,
  uiFeatures,
  verifiedAssets,
  bannerChecks: {},
  moduleChecks: {},
  axeScans: [],
  runtimeErrors: [],
};

let page;
async function settle() {
  await page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
}
async function shot(name) {
  await settle();
  const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
}
async function runAxe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
  report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
  assert.equal(res.violations.length, 0, `Preview axe violations on ${label}: ${JSON.stringify(res.violations)}`);
}

try {
  let port = 0;
  for (let i = 0; i < 60 && !port; i += 1) {
    try {
      const f = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      port = Number(f.trim().split(/\r?\n/)[0]);
    } catch (_) {
      await delay(100);
    }
  }
  assert.ok(port, "Chrome DevToolsActivePort must become available");
  page = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl, width: 1440, height: 900, mobile: false });

  await page.navigate("/");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled'", 25_000, "preview guest ready");
  assert.equal(await page.evaluate("document.querySelector('#authWorkspaceSection').hidden"), true, "Guest `/` hides private workspace");
  await shot("hosted-i06-guest-light.png");
  await runAxe("hosted-guest-light");

  // Switch theme to dark and verify owner-preview-banner contrast lock
  for (let i = 0; i < 4; i += 1) {
    if (await page.evaluate("document.documentElement.dataset.themePreference === 'dark'")) break;
    await page.click("#themeToggleBtn");
    await delay(80);
  }
  await settle();
  const darkBanner = await page.evaluate(`(() => {
    const b = document.getElementById('ownerPreviewBanner');
    const s = b?.querySelector('strong');
    return {
      theme: document.documentElement.dataset.themePreference,
      strongColor: s ? getComputedStyle(s).color : '',
      bg: b ? getComputedStyle(b).backgroundColor : '',
    };
  })()`);
  assert.equal(darkBanner.theme, "dark");
  assert.equal(darkBanner.strongColor, "rgb(67, 20, 7)", `Dark banner contrast mismatch: ${JSON.stringify(darkBanner)}`);
  report.bannerChecks = darkBanner;
  await shot("hosted-i06-guest-dark.png");

  // Switch back light, register one ephemeral synthetic user against isolated Preview D1, verify /tools & /finance & /transfer
  for (let i = 0; i < 4; i += 1) {
    if (await page.evaluate("document.documentElement.dataset.themePreference === 'light'")) break;
    await page.click("#themeToggleBtn");
    await delay(80);
  }
  const policies = await fetch(`${baseUrl}/api/policies`).then((r) => r.json());
  const uname = `i06p_${Date.now().toString(36)}`;
  const pass = "I06Preview!Synthetic-2026";
  const reg = await fetch(`${baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      username: uname,
      secret: pass,
      confirm_secret: pass,
      terms_accepted: true,
      policy_versions: policies.versions,
    }),
  });
  assert.equal(reg.status, 201, `Failed registering synthetic preview user ${uname}`);

  await page.navigate("/login");
  await page.waitFor("Boolean(document.querySelector('#loginForm'))", 20_000);
  await page.setFields({ "#usernameInput": uname, "#secretInput": pass });
  await page.click("#loginSubmitBtn");
  await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden", 25_000, "preview signed in");
  try {
    await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 2000, "site notice");
    await page.click("#siteMessageCloseBtn");
  } catch (_) {}

  await page.navigate("/tools/letter-case");
  await page.waitFor("!document.querySelector('#toolsWorkspace')?.classList.contains('hidden') && Boolean(document.querySelector('.tool-split-pane'))", 15_000, "hosted tool split pane");
  await shot("hosted-i06-tools-workbench.png");
  await runAxe("hosted-tools-workbench");

  await page.navigate("/transfer");
  await page.waitFor("!document.querySelector('#transferWorkspace')?.classList.contains('hidden') && Boolean(document.querySelector('#transferConfigDisclosure'))", 15_000, "hosted transfer");
  await shot("hosted-i06-transfer.png");
  await runAxe("hosted-transfer");

  report.moduleChecks = { registeredUser: uname, toolsSplitPane: true, transferDisclosure: true };
  assert.deepEqual(page.runtimeErrors, [], `Preview runtimeErrors: ${JSON.stringify(page.runtimeErrors)}`);
  report.status = "PASS";
  await writeFile(path.join(evidenceDir, "i06-preview-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, headCommit, axeScans: report.axeScans.length }, null, 2));
} finally {
  if (page) await page.close().catch(() => {});
  try { child.kill(); } catch (_) {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
