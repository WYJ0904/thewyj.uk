import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STAGE_PATH = path.join(ROOT, "docs", "ui-rebuild", "i05", "evidence", "i05-preview-stage.json");
const D1_CONFIG_PATH = path.join(ROOT, ".wrangler", "i05-preview-d1.jsonc");
const D1_NAME = "aeris-i05-preview";
const PRODUCTION_DB_ID = "11c288d8-c584-409f-bb1f-7e7af11793e5";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const EVIDENCE_DIR = path.join(ROOT, "docs", "ui-rebuild", "i05", "evidence", "preview");
const CREDS_FILE = process.env.I05_PREVIEW_CREDS_FILE
  || "C:\\Users\\78252\\.gemini\\antigravity\\brain\\48514f9a-c549-4c3a-8081-c6b7a3fff6d9\\scratch\\i05-preview-admin.local.txt";

await mkdir(EVIDENCE_DIR, { recursive: true });

let baseUrl = process.env.I05_PREVIEW_URL || "";
if (!baseUrl) {
  try {
    const staged = JSON.parse(await readFile(STAGE_PATH, "utf8"));
    baseUrl = staged.deployResult?.aliasUrl || staged.deployResult?.deployedUrl || "";
  } catch (_) {}
}
if (!baseUrl) baseUrl = "https://i05-workspace-density.thewyj-i05-preview.pages.dev";

const parsedUrl = new URL(baseUrl);
assert.equal(parsedUrl.protocol, "https:");
assert.notEqual(parsedUrl.hostname, "thewyj.uk", "Must NEVER verify Preview against Production");
assert.ok(parsedUrl.hostname.includes("thewyj-i05-preview.pages.dev"), `Unexpected preview host: ${parsedUrl.hostname}`);

const rawCreds = await readFile(CREDS_FILE, "utf8");
const creds = {};
for (const line of rawCreds.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (m) creds[m[1]] = m[2];
}
const adminUser = creds.I05_ADMIN_USER || "i05admin";
const adminPass = creds.I05_ADMIN_PASS;
const memberUser = creds.I05_USER_USER || "i05user";
const memberPass = creds.I05_USER_PASS || adminPass;
assert.ok(adminPass && adminPass.length >= 16, "Missing isolated admin password in scratch creds file");
assert.ok(memberPass && memberPass.length >= 16, "Missing isolated member password in scratch creds file");

// Verify D1 config points only to aeris-i05-preview, never Production
const d1Cfg = JSON.parse(await readFile(D1_CONFIG_PATH, "utf8"));
assert.equal(d1Cfg.d1_databases?.[0]?.database_name, D1_NAME);
assert.ok(d1Cfg.d1_databases?.[0]?.database_id && d1Cfg.d1_databases[0].database_id !== PRODUCTION_DB_ID);

function d1ExecRemote(sql) {
  const res = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", D1_NAME, "--remote", "--config", D1_CONFIG_PATH, "--command", sql],
    { cwd: ROOT, input: "y\n", encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(res.status, 0, `Remote D1 execute failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

const apiStatus = await fetch(`${baseUrl}/api/status`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
const buildJson = await fetch(`${baseUrl}/__preview/build.json`).then((r) => r.json());
assert.equal(apiStatus.ok, true, `Unexpected /api/status: ${JSON.stringify(apiStatus)}`);
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated Hosted Preview must start with p07_accessibility ON");
assert.equal(buildJson.project_name, "thewyj-i05-preview");
assert.equal(buildJson.remote_check?.targetD1Name, D1_NAME);

const axeSource = await readFile(path.join(ROOT, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i05-preview-chrome-"));
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
  apiStatus: { ok: apiStatus.ok, environment: apiStatus.environment },
  apiHealthOk: Boolean(apiHealth?.ok ?? true),
  uiFeaturesPublicEnabled: Boolean(uiFeatures.public_ui?.enabled),
  buildJson,
  routesChecked: [],
  adminChecks: {},
  accountChecks: {},
  nonAdminIsolation: {},
  p07ToggleChecks: {},
  axeScans: [],
  screenshots: [],
  runtimeErrors: [],
  production_release: "NOT_TOUCHED",
};

let page;
let userPage;
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
  await page.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});

  const settle = async (targetPage = page) => {
    await targetPage.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  };
  const shot = async (name, targetPage = page) => {
    await settle(targetPage);
    // Ensure no password input is currently visible before capturing evidence
    const pwVisible = await targetPage.evaluate("[...document.querySelectorAll('input[type=password]')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; })");
    assert.equal(pwVisible, false, `Refusing screenshot ${name} while a password input is visible`);
    const data = await targetPage.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(EVIDENCE_DIR, name), Buffer.from(data.data, "base64"));
    report.screenshots.push(name);
  };
  const pointerClick = async (selector, targetPage = page) => {
    const hit = await targetPage.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'missing: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return { ok: false, reason: 'zero-size' };
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const h = document.elementFromPoint(cx, cy);
      return { ok: Boolean(h && (el === h || el.contains(h) || h.contains(el))), cx, cy };
    })()`);
    assert.ok(hit.ok, `Hit-test failed for ${selector}: ${JSON.stringify(hit)}`);
    await targetPage.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy, button: "none" });
    await targetPage.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await targetPage.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await settle(targetPage);
    return hit;
  };
  const runAxe = async (label) => {
    await page.evaluate(axeSource);
    const res = await page.evaluate(`axe.run(document).then(r => ({
      violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map(n => ({ target: n.target, data: n.any?.[0]?.data || null })) })),
      passes: r.passes.length,
    }))`);
    report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
    assert.equal(res.violations.length, 0, `Preview axe serious/critical violations on ${label}: ${JSON.stringify(res.violations)}`);
  };

  const signIn = async (targetPage, uname, pass) => {
    await targetPage.navigate("/login");
    await targetPage.waitFor("!document.querySelector('#loginForm')?.classList.contains('hidden')", 25_000, "preview login form");
    await targetPage.setFields({ "#usernameInput": uname, "#secretInput": pass });
    await targetPage.click("#loginSubmitBtn");
    await targetPage.waitFor(
      "document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0",
      35_000,
      `preview ${uname} authenticated`,
    );
    await settle(targetPage);
  };

  await signIn(page, adminUser, adminPass);
  await page.navigate("/select");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.body.dataset.workspaceRoute === 'home'", 25_000, "/select");
  await shot("preview-1440-select.png");
  await runAxe("preview-1440-select");

  const routeSpecs = [
    { nav: "home", expectedRoute: "home", container: "#authWorkspaceSection" },
    { nav: "language", expectedRoute: "language", container: "#projectPicker", altContainer: "#languagePanel" },
    { nav: "tools", expectedRoute: "tools", container: "#toolsPanel" },
    { nav: "finance", expectedRoute: "finance", container: "#financePage" },
    { nav: "transfer", expectedRoute: "transfer", container: "#transferPage" },
    { nav: "account", expectedRoute: "account", container: "#accountModal" },
    { nav: "admin", expectedRoute: "admin", container: "#adminPanel" },
  ];
  for (const spec of routeSpecs) {
    await pointerClick(`#v3Sidebar [data-v3-nav="${spec.nav}"]`);
    await page.waitFor(
      `document.body.dataset.workspaceRoute === ${JSON.stringify(spec.expectedRoute)}`,
      15_000,
      `preview route ${spec.nav}`,
    );
    await delay(200);
    await settle();
    const crumb = await page.evaluate("document.querySelector('#workspaceBreadcrumb li[aria-current=\"page\"]')?.textContent?.trim() || ''");
    const overflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    assert.ok(crumb.length > 0 && overflow <= 1, `Invalid breadcrumb/overflow on ${spec.nav}: ${crumb}, ${overflow}`);
    report.routesChecked.push({ route: spec.nav, crumb, overflow });
  }

  // /account save release channel check
  await pointerClick('#v3Sidebar [data-v3-nav="account"]');
  await page.waitFor("document.body.dataset.workspaceRoute === 'account' && !document.querySelector('#accountModal')?.classList.contains('hidden')", 15_000);
  await pointerClick("#saveReleaseChannelBtn");
  await page.waitFor("document.querySelector('#releaseChannelStatus')?.textContent?.includes('体验通道已保存')", 15_000, "preview release channel saved");
  const releaseChannelStatus = await page.evaluate("document.querySelector('#releaseChannelStatus')?.textContent?.trim() || ''");
  report.accountChecks = { releaseChannelStatus };
  await shot("preview-1440-account.png");
  await runAxe("preview-1440-account");

  // /finance axe check
  await pointerClick('#v3Sidebar [data-v3-nav="finance"]');
  await page.waitFor("document.body.dataset.workspaceRoute === 'finance'", 15_000);
  await delay(250);
  await runAxe("preview-1440-finance");

  // /admin KPIs, tabs, and Feature Flag creation + step-up
  await page.evaluate("const s = document.getElementById('featureConsoleStatus'); if (s) s.textContent = '';");
  await pointerClick('#v3Sidebar [data-v3-nav="admin"]');
  await page.waitFor("document.body.dataset.workspaceRoute === 'admin' && Boolean(document.querySelector('#adminUserList')?.textContent?.trim())", 20_000, "preview admin users");
  const kpiCheck = await page.evaluate(`(async () => {
    const kpiText = document.querySelector('#adminKpiUsers')?.textContent?.trim() || '';
    const token = localStorage.getItem('wyjAccountSession') || '';
    const res = await fetch('/api/admin/users?limit=1', {
      credentials: 'include',
      headers: token ? { 'X-Session-Token': token } : {},
    });
    const data = await res.json();
    return { kpiText, status: res.status, apiTotal: Number(data.total ?? data.pagination?.total ?? 0) };
  })()`);
  assert.equal(kpiCheck.status, 200);
  assert.equal(Number(kpiCheck.kpiText), kpiCheck.apiTotal);

  await pointerClick("#adminFeatureFlagsTab");
  await page.waitFor(
    "document.querySelector('#adminFeatureFlagsView')?.classList.contains('active') && document.querySelectorAll('#featureFlagSelect option').length > 0 && document.querySelector('#featureConsoleStatus')?.textContent?.includes('已读取最新配置')",
    20_000,
    "preview flags ready",
  );
  const flagKey = `i05_preview_${Date.now().toString(36).slice(-6)}`;
  await pointerClick("#newFeatureFlagBtn");
  await page.waitFor("document.getElementById('featureFlagKey')?.readOnly === false", 5_000, "new flag editable");
  await page.setFields({
    "#featureFlagKey": flagKey,
    "#featureFlagDescription": "I05 live preview fixture flag (0%)",
    "#featureFlagPercentage": "0",
  });
  await pointerClick("#saveFeatureFlagBtn");
  try {
    await page.waitFor("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]'))", 15_000, "preview step-up");
  } catch (err) {
    const diag = await page.evaluate(`({
      status: document.querySelector('#featureConsoleStatus')?.textContent || '',
      btnDisabled: document.querySelector('#saveFeatureFlagBtn')?.disabled,
      keyVal: document.querySelector('#featureFlagKey')?.value,
      rev: document.querySelector('#featureFlagForm')?.dataset?.revision,
      promptClass: document.querySelector('#task27Prompt')?.className || 'MISSING',
    })`);
    throw new Error(`${err.message} | diag=${JSON.stringify(diag)}`);
  }
  await page.setFields({ "#task27Prompt input[name='password']": adminPass });
  await pointerClick("#task27Prompt button[type='submit']");
  await page.waitFor("document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存')", 20_000, "preview flag saved");
  await page.waitFor("!document.querySelector('#task27Prompt:not(.hidden)')", 10_000);
  const auditHasKey = await page.evaluate(`document.getElementById('featureFlagAudit')?.textContent?.includes(${JSON.stringify(flagKey)}) || false`);
  assert.equal(auditHasKey, true);
  await shot("preview-1440-admin-flags.png");
  await runAxe("preview-1440-admin");
  report.adminChecks = { kpiCheck, flagKey, auditHasKey };

  // Mobile 390 check & screenshots
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await settle();
  const mobileAdminOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(mobileAdminOverflow <= 1, `Preview 390 /admin overflow: ${mobileAdminOverflow}`);
  await shot("preview-390-admin.png");
  await runAxe("preview-390-admin");
  await page.navigate("/select");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.body.dataset.workspaceRoute === 'home'", 25_000);
  await settle();
  await shot("preview-390-select.png");
  await runAxe("preview-390-select");

  // Non-admin user isolation in separate browser context
  userPage = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl, width: 1440, height: 900, mobile: false });
  await userPage.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});
  await signIn(userPage, memberUser, memberPass);
  const adminLinkHidden = await userPage.evaluate("Boolean(document.getElementById('v3SidebarAdminLink')?.hidden)");
  const nonAdminApiStatus = await userPage.evaluate(`(() => {
    const token = localStorage.getItem('wyjAccountSession') || '';
    return fetch('/api/admin/users', { credentials: 'include', headers: token ? { 'X-Session-Token': token } : {} }).then(r => r.status);
  })()`);
  await userPage.navigate("/admin");
  await userPage.waitFor("location.pathname === '/' && Boolean(document.querySelector('#adminPanel')?.classList.contains('hidden'))", 15_000, "preview non-admin redirect");
  assert.equal(adminLinkHidden, true);
  assert.equal(nonAdminApiStatus, 403);
  report.nonAdminIsolation = { adminLinkHidden, nonAdminApiStatus, redirectedToRoot: true };
  await userPage.close();
  userPage = null;

  // P07 OFF / ON remote toggle check with guaranteed restoration
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  try {
    d1ExecRemote("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility';");
    await page.evaluate("for (const k of Object.keys(localStorage)) { if (/feature|flag|p07|policy/i.test(k)) localStorage.removeItem(k); }");
    await page.navigate("/admin");
    await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui && document.documentElement.dataset.p07Ui !== 'enabled' && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 25_000, "preview P07 OFF");
    const offState = await page.evaluate(`({
      p07Ui: document.documentElement.dataset.p07Ui,
      sidebarDisplay: getComputedStyle(document.getElementById('v3Sidebar')).display,
      breadcrumbDisplay: getComputedStyle(document.getElementById('workspaceBreadcrumb')).display,
      kpiDisplay: getComputedStyle(document.getElementById('adminKpiStrip')).display,
    })`);
    assert.equal(offState.sidebarDisplay, "none");
    assert.equal(offState.breadcrumbDisplay, "none");
    assert.equal(offState.kpiDisplay, "none");
    report.p07ToggleChecks.off = offState;
  } finally {
    d1ExecRemote("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility';");
  }
  await page.evaluate("for (const k of Object.keys(localStorage)) { if (/feature|flag|p07|policy/i.test(k)) localStorage.removeItem(k); }");
  await page.navigate("/admin");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0", 25_000, "preview P07 ON restored");
  report.p07ToggleChecks.restoredOn = true;

  report.runtimeErrors = page.runtimeErrors.slice();
  assert.equal(report.runtimeErrors.length, 0, `Preview runtime errors: ${JSON.stringify(report.runtimeErrors)}`);
  await writeFile(path.join(ROOT, "docs", "ui-rebuild", "i05", "evidence", "i05-preview-verify.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, axeScans: report.axeScans.length, screenshots: report.screenshots.length }, null, 2));
} finally {
  if (userPage) await userPage.close().catch(() => {});
  if (page) await page.close().catch(() => {});
  child.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
