import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i04", "evidence", "preview");
await mkdir(evidenceDir, { recursive: true });

const baseUrl = process.env.I04_PREVIEW_URL || "https://i04-workspace.thewyj-i04-preview.pages.dev";
assert.equal(new URL(baseUrl).protocol, "https:");
assert.notEqual(new URL(baseUrl).hostname, "thewyj.uk", "Must NEVER run preview verification against Production");
assert.ok(new URL(baseUrl).hostname.includes("thewyj-i04-preview.pages.dev"), "Preview host must be isolated I04 Pages project");

const apiStatus = await fetch(`${baseUrl}/api/status`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
const plansRes = await fetch(`${baseUrl}/api/membership/plans`).then((r) => r.json());
assert.equal(apiStatus.ok, true);
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated Hosted Preview must have public_ui ON");
assert.equal(plansRes.ok, true);

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i04-preview-chrome-"));
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
  checkedAt: new Date().toISOString(),
  apiStatus,
  apiHealth,
  uiFeatures,
  plansCount: plansRes.plans?.length || 0,
  checks: {},
  axeScans: [],
};

let page;
async function settle() {
  await page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
}
async function shot(name) {
  await settle();
  const data = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
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
  await page.waitFor("document.documentElement.dataset.bootState === 'ready'", 25_000);
  assert.equal(await page.evaluate("document.querySelector('#authWorkspaceSection').hidden"), true, "Guest `/` hides private workspace");
  await shot("preview-guest-1440.png");

  // Register two fresh synthetic accounts cleanly against isolated preview D1
  const policies = await fetch(`${baseUrl}/api/policies`).then((r) => r.json());
  const suffix = Date.now().toString(36);
  const userA = `i04pa_${suffix}`;
  const userB = `i04pb_${suffix}`;
  const pass = "I04Preview!Synthetic-2026";
  for (const uname of [userA, userB]) {
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
    assert.equal(reg.status, 201, `Failed registering synthetic preview account ${uname}`);
  }

  // Sign in as synthetic preview user A
  await page.navigate("/login");
  await page.waitFor("!document.querySelector('#authPanel')?.classList.contains('hidden')", 20_000);
  await page.setFields({ "#usernameInput": userA, "#secretInput": pass });
  await page.click("#loginSubmitBtn");
  await page.waitFor("location.pathname === '/' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection').hidden", 25_000);
  await page.navigate("/select");
  await page.waitFor("location.pathname === '/select' && document.documentElement.dataset.bootState === 'ready' && !document.querySelector('#authWorkspaceSection').hidden", 25_000);
  await shot("preview-select-1440.png");

  // Edit, reorder, density toggle, save & reload on Hosted Preview
  await page.click("#workspaceCustomizeBtn");
  await page.click('[data-workspace-card="finance"] [data-workspace-action="down"]');
  await page.click("#workspaceDensityBtn");
  await delay(360);
  await page.click("#workspaceSaveBtn");
  await page.waitFor("document.querySelector('#workspaceSaveStatus')?.dataset.saveState === 'saved'", 5_000);
  await shot("preview-compact-1440.png");
  await page.send("Page.reload", { ignoreCache: false });
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.querySelector('#workspaceBentoGrid')?.dataset.density === 'compact'", 25_000);
  const reloadedOrder = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
  assert.equal(reloadedOrder[2], "finance");

  // Open detail modal on desktop + axe scan
  await page.click('[data-workspace-preview="learning"]');
  await page.waitFor("!document.querySelector('#workspaceDetailModal').classList.contains('hidden')", 5_000);
  await runAxe("preview-desktop-modal");
  await page.click("#closeWorkspaceDetailBtn");
  await delay(250);
  // Reset back cleanly
  await page.click("#workspaceResetBtn");
  await delay(250);

  // Mobile 390 drawer preview check
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settle();
  await shot("preview-mobile-390.png");
  await runAxe("preview-mobile-390");

  // Sign out and verify isolated user B has default layout
  await page.evaluate("document.querySelector('#accountMenu').open = true; true");
  await page.click("#logoutBtn");
  await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'guest' || !document.querySelector('#authPanel')?.classList.contains('hidden')", 15_000);
  await page.navigate("/login");
  await page.waitFor("!document.querySelector('#authPanel')?.classList.contains('hidden')", 20_000);
  await page.setFields({ "#usernameInput": userB, "#secretInput": pass });
  await page.click("#loginSubmitBtn");
  await page.waitFor("location.pathname === '/' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated'", 25_000);
  const userBOrder = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
  assert.deepEqual(userBOrder, ["learning", "finance", "tools", "transfer", "activity", "account"]);

  assert.deepEqual(page.runtimeErrors, [], `Preview runtimeErrors: ${JSON.stringify(page.runtimeErrors)}`);
  report.checks = { reloadedOrder, userBOrder, isolatedAccountsVerified: true };
  await writeFile(path.join(evidenceDir, "i04-preview-verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, axeScans: report.axeScans.length }, null, 2));
} finally {
  if (page) await page.close().catch(() => {});
  try { child.kill(); } catch (_) {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
