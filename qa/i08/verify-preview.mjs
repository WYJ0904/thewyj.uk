import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i08", "evidence", "hosted");
await mkdir(evidenceDir, { recursive: true });

const baseUrl = process.env.I08_PREVIEW_URL || "https://i08-global-polish.thewyj-i08-preview.pages.dev";
assert.equal(new URL(baseUrl).protocol, "https:");
assert.notEqual(new URL(baseUrl).hostname, "thewyj.uk", "Must NEVER run preview verification against Production");
assert.ok(new URL(baseUrl).hostname.includes("thewyj-i08-preview.pages.dev"), "Preview host must be isolated I08 Pages project");

const sourceOnly = process.argv.includes("--source-only");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const buildInfo = await fetch(`${baseUrl}/__preview/build.json`).then((r) => r.json());
const apiStatus = await fetch(`${baseUrl}/api/status`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
assert.equal(buildInfo.stage, "I08-global-polish");
assert.equal(buildInfo.source_commit, headCommit, `Hosted Preview source_commit (${buildInfo.source_commit}) differs from HEAD (${headCommit})`);
assert.equal(apiStatus.ok, true);
assert.equal(apiHealth.code, "authentication_required", "Unauthenticated /api/health must fail closed");
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated I08 Preview must have public_ui ON");

const verifiedAssets = [];
for (const assetPath of [
  "design-system.css",
  "spatial-experience.css",
  "app.js",
  "tools.js",
  "js/core/design-system.js",
  "js/core/feature-console.js",
  "js/core/router.js",
  "js/finance/app.js",
  "js/transfer/app.js",
  "js/admin/formatters.js",
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
  await writeFile(path.join(evidenceDir, "i08-preview-source-check.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const credsFile = process.env.I08_PREVIEW_CREDS_FILE;
assert.ok(credsFile, "Missing I08_PREVIEW_CREDS_FILE for authorized I08 Hosted Preview acceptance");
const rawCreds = await readFile(credsFile, "utf8");
const creds = {};
for (const line of rawCreds.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (m) creds[m[1]] = m[2];
}
const adminUser = creds.I08_ADMIN_USER || "i08admin";
const adminPass = creds.I08_ADMIN_PASS;
const normalUser = creds.I08_USER_NAME || "i08user";
const normalPass = creds.I08_USER_PASS;
assert.ok(adminPass && adminPass.length >= 16, "Missing I08_ADMIN_PASS");
assert.ok(normalPass && normalPass.length >= 16, "Missing I08_USER_PASS");

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i08-preview-chrome-"));
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
  scenarios: {},
  axeScans: [],
  screenshots: [],
  runtimeErrors: [],
};

const WRANGLER = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const D1_CONFIG_PATH = path.join(root, ".wrangler", "i08-preview-d1.jsonc");
function runD1(sql) {
  const res = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "aeris-i08-preview", "--remote", "--config", D1_CONFIG_PATH, "--command", sql],
    { cwd: root, input: "y\n", encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(res.status, 0, `D1 exec failed:\n${res.stdout}\n${res.stderr}`);
}

let page;
let userPage;
async function settle(target = page) {
  await target.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
}
async function shot(name, target = page) {
  await settle(target);
  const pwVisible = await target.evaluate("[...document.querySelectorAll('input[type=password]')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; })");
  assert.equal(pwVisible, false, `Refusing screenshot ${name} while a password input is visible`);
  const data = await target.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
  report.screenshots.push(name);
}
async function setViewport(width, height = 900, target = page) {
  await target.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
  await target.send("Emulation.setTouchEmulationEnabled", { enabled: width <= 980 });
  await settle(target);
}
async function setTheme(targetTheme, target = page) {
  for (let i = 0; i < 4; i += 1) {
    if (await target.evaluate("document.documentElement.dataset.themePreference") === targetTheme) break;
    await target.click("#themeToggleBtn");
    await delay(80);
  }
  await settle(target);
  assert.equal(await target.evaluate("document.documentElement.dataset.themePreference"), targetTheme);
}
async function pointerClick(selector, target = page) {
  const hit = await target.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: 'missing: ' + ${JSON.stringify(selector)} };
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { ok: false, reason: 'zero-size' };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const h = document.elementFromPoint(cx, cy);
    return { ok: Boolean(h && (el === h || el.contains(h) || h.contains(el))), cx, cy };
  })()`);
  assert.ok(hit.ok, `Hit-test failed for ${selector}: ${JSON.stringify(hit)}`);
  await target.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy, button: "none" });
  await target.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
  await target.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
  await delay(80);
  return hit;
}
async function runAxe(label, target = page) {
  await target.evaluate(axeSource);
  const res = await target.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
  report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
  assert.equal(res.violations.length, 0, `Preview axe violations on ${label}: ${JSON.stringify(res.violations)}`);
}

try {
  let port = 0;
  for (let i = 0; i < 60 && !port; i += 1) {
    try {
      const f = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      port = Number(f.trim().split(/\r?\n/)[0]);
    } catch (_) { await delay(100); }
  }
  assert.ok(port, "Chrome DevToolsActivePort must become available");
  page = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl, width: 1440, height: 900, mobile: false });

  // Reset admin mfa_broadcast_at / receipts so post-login security notice triggers for admin, while normalUser tests no-prompt login!
  const nowIso = new Date().toISOString();
  runD1(`DELETE FROM admin_message_receipts WHERE message_id = 'task27-mfa-advice-v1' AND user_id IN (SELECT id FROM task12_users WHERE username_normalized = '${adminUser.toLowerCase()}'); UPDATE task27_security SET mfa_broadcast_at = '' WHERE user_id IN (SELECT id FROM task12_users WHERE username_normalized = '${adminUser.toLowerCase()}'); UPDATE task27_security SET mfa_broadcast_at = '${nowIso}' WHERE user_id IN (SELECT id FROM task12_users WHERE username_normalized = '${normalUser.toLowerCase()}'); INSERT INTO admin_message_receipts (message_id, user_id, first_seen_at, dismissed_at, acknowledged_at, updated_at) SELECT 'task27-mfa-advice-v1', u.id, '${nowIso}', '${nowIso}', '', '${nowIso}' FROM task12_users u WHERE u.username_normalized = '${normalUser.toLowerCase()}' AND EXISTS (SELECT 1 FROM admin_messages WHERE id = 'task27-mfa-advice-v1') ON CONFLICT(message_id, user_id) DO UPDATE SET dismissed_at = excluded.dismissed_at, updated_at = excluded.updated_at;`);

  // 1. Login page R02 copy + R01 full flow: Login -> pending "完善账户安全" -> close -> click sidebar "学习" -> /language
  await page.navigate("/login");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && Boolean(document.querySelector('#loginForm'))", 25_000, "hosted login ready");
  const loginR02 = await page.evaluate("({ label: document.querySelector('#loginForm .auth-field:nth-of-type(2) span')?.textContent || '', placeholder: document.getElementById('secretInput')?.placeholder || '', autocomplete: document.getElementById('secretInput')?.autocomplete || '' })");
  assert.equal(loginR02.label, "登录密码");
  assert.equal(loginR02.autocomplete, "current-password");

  await page.setFields({ "#usernameInput": adminUser, "#secretInput": adminPass });
  await pointerClick("#loginSubmitBtn");
  await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('v3SidebarAdminLink')?.hidden", 30_000, "hosted admin signed in");
  await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 15_000, "hosted 完善账户安全 notice visible");
  const noticeTitle = await page.evaluate("document.getElementById('siteMessageTitle')?.textContent || ''");
  assert.match(noticeTitle, /完善账户安全/);
  await pointerClick("#siteMessageCloseBtn");
  await page.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 10_000, "hosted notice dismissed");
  await settle();
  const inertAfterClose = await page.evaluate("({ appShellInert: document.getElementById('appShell').inert, frameInert: document.getElementById('v3AppFrame').inert })");
  assert.deepEqual(inertAfterClose, { appShellInert: false, frameInert: false });

  await pointerClick("#v3Sidebar [data-v3-nav='language']");
  await page.waitFor("location.pathname === '/language' && !document.querySelector('#projectPicker')?.classList.contains('hidden')", 15_000, "hosted sidebar clicked /language");
  report.scenarios.r01WithPrompt = { noticeTitle, inertAfterClose, navigatedTo: "/language" };

  // 2. R03: /finance 420 -> /tools 0 -> popstate -> exact min(420, maxScrollY)
  await pointerClick("#v3Sidebar [data-v3-nav='finance']");
  await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden') && document.querySelectorAll('#financeTransactionList .finance-transaction').length >= 8", 20_000, "hosted finance hydrated");
  await settle();
  await page.evaluate("window.scrollTo(0, 420)");
  await settle();
  const finBefore = await page.evaluate("({ scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight })");
  assert.ok(finBefore.scrollHeight - finBefore.clientHeight >= 420, `Hosted finance fixture height too short: ${JSON.stringify(finBefore)}`);
  assert.ok(Math.abs(finBefore.scrollY - 420) <= 2);

  await pointerClick("#v3Sidebar [data-v3-nav='tools']");
  await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && document.querySelectorAll('#toolCatalog .tool-card').length > 0", 20_000, "hosted tools hydrated");
  await settle();
  const toolsY = await page.evaluate("window.scrollY");
  assert.ok(toolsY <= 2);

  await page.evaluate("history.back()");
  await page.waitFor("location.pathname === '/finance' && !document.querySelector('#financeWorkspace')?.classList.contains('hidden') && document.querySelectorAll('#financeTransactionList .finance-transaction').length >= 8", 20_000, "hosted popstate finance hydrated");
  await delay(150);
  await settle();
  const finAfter = await page.evaluate("({ scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight })");
  const expectedY = Math.min(finBefore.scrollY, Math.max(0, finAfter.scrollHeight - finAfter.clientHeight));
  assert.ok(Math.abs(finAfter.scrollY - expectedY) <= 2, `Hosted popstate mismatch: ${JSON.stringify({ finAfter, expectedY })}`);
  report.scenarios.r03Scroll = { finBefore, toolsY, finAfter, expectedY };

  // 3. Vector icons + R02 on /account (1440 light/dark, 390 light, 375 dark)
  await pointerClick("#v3Sidebar [data-v3-nav='account']");
  await page.waitFor("!document.querySelector('#accountModal')?.classList.contains('hidden')", 15_000);
  await settle();
  const acctCheck = await page.evaluate(`(() => ({
    sideSvgs: document.querySelectorAll('#v3Sidebar a:not([hidden]) .v3-nav-icon svg').length,
    acctIcons: document.querySelectorAll('#accountModal .account-settings-list > button .account-setting-icon svg').length,
    acctChevrons: document.querySelectorAll('#accountModal .account-settings-list > button .account-setting-chevron').length,
    title: document.querySelector('#changeSecretForm .account-settings-title')?.textContent || '',
    curLabel: document.querySelector('label[for="currentSecretInput"]')?.textContent || '',
    confirmLabel: document.querySelector('label[for="newSecretConfirmInput"]')?.textContent || '',
    hasLegacy: (document.getElementById('accountModal')?.textContent || '').includes('登录密钥'),
  }))()`);
  assert.equal(acctCheck.sideSvgs, 10);
  assert.equal(acctCheck.acctIcons, 3);
  assert.equal(acctCheck.acctChevrons, 3);
  assert.equal(acctCheck.title, "修改登录密码");
  assert.equal(acctCheck.curLabel, "当前密码");
  assert.equal(acctCheck.confirmLabel, "再次输入新密码");
  assert.equal(acctCheck.hasLegacy, false);
  await runAxe("hosted-i08-account-1440-light");
  await shot("hosted-i08-account-1440-light.png");

  await setViewport(390, 844);
  assert.ok(await page.evaluate("document.documentElement.scrollWidth - window.innerWidth <= 1"));
  await shot("hosted-i08-account-390-light.png");

  await setViewport(375, 812);
  await setTheme("dark");
  assert.ok(await page.evaluate("document.documentElement.scrollWidth - window.innerWidth <= 1"));
  await runAxe("hosted-i08-account-375-dark");
  await shot("hosted-i08-account-375-dark.png");
  await setTheme("light");
  await setViewport(1440, 900);

  // 4. Admin Kill Switch + Reduced Motion + Keyboard focus check
  await pointerClick("#v3Sidebar [data-v3-nav='admin']");
  await page.waitFor("Boolean(document.querySelector('#adminUserList .admin-user-card'))", 20_000, "hosted admin ready");
  await pointerClick("#adminFeatureFlagsTab");
  await page.waitFor("document.querySelectorAll('#featureFlagSummaryList .feature-directory-item').length > 0", 15_000);
  await pointerClick("#featureFlagKillSwitch");
  await delay(120);
  await settle();
  const killState = await page.evaluate(`(() => {
    const cb1 = document.getElementById('featureFlagEnabled').getBoundingClientRect();
    const cb2 = document.getElementById('featureFlagKillSwitch').getBoundingClientRect();
    return {
      killActive: document.getElementById('featureFlagForm')?.dataset.killActive || '',
      capsule: document.getElementById('featureFlagStateCapsule')?.dataset.state || '',
      warnVisible: !document.getElementById('featureFlagKillWarning')?.classList.contains('hidden'),
      cb1: [cb1.width, cb1.height],
      cb2: [cb2.width, cb2.height],
    };
  })()`);
  assert.equal(killState.killActive, "true");
  assert.equal(killState.capsule, "kill");
  assert.equal(killState.warnVisible, true);
  assert.ok(killState.cb1[0] <= 24 && killState.cb2[0] <= 24);
  await runAxe("hosted-i08-admin-kill-switch-1440-light");
  await shot("hosted-i08-admin-kill-switch-1440-light.png");
  await setTheme("dark");
  await shot("hosted-i08-admin-kill-switch-1440-dark.png");
  await setTheme("light");

  // Reduced motion + download a.primary alignment
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await page.navigate("/download");
  await page.waitFor("!document.querySelector('#downloadPage')?.classList.contains('hidden')", 15_000);
  await settle();
  const downloadAlign = await page.evaluate(`(() => {
    const a = document.getElementById('downloadMainBtn').getBoundingClientRect();
    const b = document.getElementById('downloadSecondaryBtn').getBoundingClientRect();
    return { aHeight: a.height, bHeight: b.height, topDiff: Math.abs(a.top - b.top) };
  })()`);
  assert.ok(downloadAlign.aHeight >= 44 && downloadAlign.bHeight >= 44 && downloadAlign.topDiff <= 2);
  await page.send("Emulation.setEmulatedMedia", { features: [] });

  // 5. No-prompt login verification with second isolated user
  userPage = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl, width: 1440, height: 900, mobile: false });
  await userPage.navigate("/login");
  await userPage.waitFor("Boolean(document.querySelector('#loginForm'))", 20_000);
  await userPage.setFields({ "#usernameInput": normalUser, "#secretInput": normalPass });
  await pointerClick("#loginSubmitBtn", userPage);
  await userPage.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden", 25_000, "no-prompt user signed in");
  await delay(500);
  await settle(userPage);
  const noPromptState = await userPage.evaluate("({ modalHidden: document.getElementById('siteMessageModal').classList.contains('hidden'), appShellInert: document.getElementById('appShell').inert, frameInert: document.getElementById('v3AppFrame').inert })");
  assert.deepEqual(noPromptState, { modalHidden: true, appShellInert: false, frameInert: false });
  await pointerClick("#v3Sidebar [data-v3-nav='language']", userPage);
  await userPage.waitFor("location.pathname === '/language'", 15_000);

  // 6. P07 OFF verification against isolated aeris-i08-preview D1 (always restored)
  runD1("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility';");
  try {
    await userPage.navigate("/account");
    await userPage.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui !== 'enabled'", 20_000, "hosted P07 OFF");
    const offDisplay = await userPage.evaluate("getComputedStyle(document.querySelector('#accountModal .account-setting-chevron')).display");
    assert.equal(offDisplay, "none");
    report.scenarios.p07Off = { offDisplay, overflow: await userPage.evaluate("document.documentElement.scrollWidth - window.innerWidth") };
  } finally {
    runD1("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility';");
  }

  assert.deepEqual(page.runtimeErrors, [], `Admin runtimeErrors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(userPage.runtimeErrors, [], `User runtimeErrors: ${JSON.stringify(userPage.runtimeErrors)}`);
  report.scenarios.acctCheck = acctCheck;
  report.scenarios.killState = killState;
  report.scenarios.downloadAlign = downloadAlign;
  report.scenarios.noPromptState = noPromptState;
  report.status = "PASS";
  await writeFile(path.join(evidenceDir, "i08-preview-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, headCommit, axeScans: report.axeScans.length, screenshots: report.screenshots.length }, null, 2));
} finally {
  if (userPage) await userPage.close().catch(() => {});
  if (page) await page.close().catch(() => {});
  try { child.kill(); } catch (_) {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
