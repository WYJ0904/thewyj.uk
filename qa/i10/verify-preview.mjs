import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay, registerAndSignIn } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i10", "evidence", "hosted");
await mkdir(evidenceDir, { recursive: true });

const baseUrl = process.env.I10_PREVIEW_URL || "https://i10-interaction-acceptance.thewyj-i10-preview.pages.dev";
assert.equal(new URL(baseUrl).protocol, "https:");
assert.notEqual(new URL(baseUrl).hostname, "thewyj.uk", "Must NEVER run preview verification against Production");
assert.ok(new URL(baseUrl).hostname.includes("thewyj-i10-preview.pages.dev"), "Preview host must be isolated I10 Pages project");

const sourceOnly = process.argv.includes("--source-only");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const buildInfo = await fetch(`${baseUrl}/__preview/build.json`).then((r) => r.json());
const apiStatus = await fetch(`${baseUrl}/api/status`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
assert.equal(buildInfo.stage, "I10-full-site-interaction-acceptance");
assert.equal(buildInfo.source_commit, headCommit, `Hosted Preview source_commit (${buildInfo.source_commit}) differs from HEAD (${headCommit})`);
assert.equal(apiStatus.ok, true);
assert.equal(apiHealth.code, "authentication_required", "Unauthenticated /api/health must fail closed");
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated I10 Preview must have public_ui ON");

const verifiedAssets = [];
for (const assetPath of [
  "styles.css",
  "design-system.css",
  "product-ui.css",
  "spatial-experience.css",
  "workspace-experience.css",
  "app.js",
  "tools.js",
  "workflows.js",
  "js/core/motion.js",
  "js/core/home-widgets.js",
  "js/transfer/app.js",
  "js/finance/app.js",
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
  await writeFile(path.join(evidenceDir, "i10-preview-source-check.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const D1_CONFIG_PATH = path.join(root, ".wrangler", "i10-preview-d1.jsonc");
const WRANGLER = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
function runD1(sql) {
  const res = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "aeris-i10-preview", "--remote", "--config", D1_CONFIG_PATH, "--command", sql],
    { cwd: root, input: "y\n", encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(res.status, 0, `D1 command failed:\n${res.stdout}\n${res.stderr}`);
}

let testUser = "";
let testPass = "";
let authenticatedMode = false;
const credsFile = process.env.I10_PREVIEW_CREDS_FILE;
if (credsFile) {
  const rawCreds = await readFile(credsFile, "utf8");
  const creds = {};
  for (const line of rawCreds.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) creds[m[1]] = m[2];
  }
  testUser = creds.I10_ADMIN_USER || creds.I10_USER_NAME || "";
  testPass = creds.I10_ADMIN_PASS || creds.I10_USER_PASS || "";
  authenticatedMode = Boolean(testUser && testPass);
} else {
  const suffix = randomBytes(4).toString("hex");
  testUser = `i10qa${suffix}`;
  testPass = `I10-Preview-${randomBytes(8).toString("hex")}!`;
}

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i10-preview-chrome-"));
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
  authenticatedMode,
  scenarios: {},
  axeScans: [],
  screenshots: [],
  runtimeErrors: [],
};

let page;
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

  const settle = async () => {
    await page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  };
  const setViewport = async (width, height = 900) => {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: width <= 980 });
    await settle();
  };
  const shot = async (name) => {
    await settle();
    const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
    report.screenshots.push(name);
  };
  const pointerClick = async (selector) => {
    const hit = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'missing: ' + ${JSON.stringify(selector)} };
      const pre = el.getBoundingClientRect();
      const navEl = document.getElementById('accountBar');
      const navStyle = navEl ? getComputedStyle(navEl) : null;
      const navBottom = (navEl && (navStyle?.position === 'sticky' || navStyle?.position === 'fixed'))
        ? Math.max(0, navEl.getBoundingClientRect().bottom)
        : 0;
      if (pre.top < navBottom || pre.bottom > window.innerHeight || pre.left < 0 || pre.right > window.innerWidth) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const h = document.elementFromPoint(cx, cy);
      return { ok: Boolean(h && (el === h || el.contains(h) || h.contains(el))), cx, cy };
    })()`);
    assert.ok(hit.ok, `Hit-test failed for ${selector}: ${JSON.stringify(hit)}`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await delay(100);
  };
  const runAxe = async (label) => {
    await page.evaluate(axeSource);
    const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)), passes: r.passes.length }))");
    report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
    assert.equal(res.violations.length, 0, `Hosted axe violations on ${label}: ${JSON.stringify(res.violations)}`);
  };

  // 1. Public home 1440 & 390 + preview tab scroll stability
  await page.navigate("/");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && document.querySelector('[data-product-window]')?.dataset.initialized === 'true' && !document.querySelector('#publicHome')?.classList.contains('hidden')", 25_000);
  await settle();
  await page.evaluate("document.querySelector('[data-product-window]').scrollIntoView({ block: 'center', behavior: 'instant' })");
  await settle();
  const yBeforeTab = await page.evaluate("window.scrollY");
  await pointerClick('[data-public-product="tools"]');
  await page.waitFor("document.querySelector('[data-product-window]')?.dataset.selected === 'tools'", 5_000);
  await delay(160);
  const yAfterTab = await page.evaluate("window.scrollY");
  assert.ok(Math.abs(yAfterTab - yBeforeTab) <= 2, `Hosted tab scroll jump: before=${yBeforeTab}, after=${yAfterTab}`);
  await page.evaluate("window.scrollTo(0, 0);");
  await settle();
  await runAxe("hosted-i10-public-home-1440-light");
  await shot("hosted-i10-public-home-1440-light.png");

  await setViewport(390, 844);
  const pubMobileOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(pubMobileOverflow <= 1, `Public mobile 390px overflow: ${pubMobileOverflow}`);
  await shot("hosted-i10-public-home-390-light.png");
  report.scenarios.publicHome = { yBeforeTab, yAfterTab, pubMobileOverflow };
  await setViewport(1440, 900);

  if (!authenticatedMode) {
    await page.evaluate("localStorage.removeItem('wyjSeenChangelogVersion')");
    await registerAndSignIn(page, { username: testUser, secret: testPass, label: "i10-preview" });
    const me = await page.evaluate("(() => fetch('/api/me', { headers: { 'X-Session-Token': localStorage.getItem('wyjAccountSession') || '' } }).then(r => r.json()))()");
    const userId = me?.account?.id || me?.id || "";
    assert.ok(userId, "Registered preview user ID missing from /api/me");
    const ts = new Date().toISOString();
    const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
    runD1(`INSERT OR IGNORE INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at) VALUES (${q(`mem_i10_${userId.slice(-8)}`)}, ${q(userId)}, 'all_access_lifetime', ${q(ts)}, '', 1, 'active', 'admin', 'i10-preview-verify', ${q(userId)}, '{}', ${q(ts)}, ${q(ts)});`);
    await page.evaluate("localStorage.clear()");
    await page.navigate("/login");
    await page.waitFor("Boolean(document.querySelector('#loginForm'))", 20_000);
    await page.setFields({ "#usernameInput": testUser, "#secretInput": testPass });
    await page.click("#loginSubmitBtn");
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('authTransitionScreen')", 25_000);
    authenticatedMode = true;
    report.authenticatedMode = true;
  } else {
    await page.navigate("/login");
    await page.waitFor("Boolean(document.querySelector('#loginForm'))", 20_000);
    await page.evaluate("localStorage.removeItem('wyjSeenChangelogVersion')");
    await page.setFields({ "#usernameInput": testUser, "#secretInput": testPass });
    await page.click("#loginSubmitBtn");
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('authTransitionScreen')", 25_000);
  }
  {
    await delay(500);
    if (await page.evaluate("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')")) {
      await pointerClick("#siteMessageCloseBtn");
      await page.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 10_000);
    }

    // Toolbox contrast & mobile reflow
    await pointerClick("#v3Sidebar [data-v3-nav='tools']");
    await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && window.WYJTools?.isReady?.() === true", 20_000);
    await settle();
    const searchContrast = await page.evaluate(`(() => {
      const span = Array.from(document.querySelectorAll('#toolsPanel .tool-search span')).find((el) => el.textContent.trim() === '模糊搜索工具');
      if (!span) return null;
      const st = getComputedStyle(span);
      return { text: span.textContent.trim(), color: st.color };
    })()`);
    assert.ok(searchContrast, "Hosted 模糊搜索工具 element must exist");
    assert.notEqual(searchContrast.color, "rgb(168, 187, 206)");
    await runAxe("hosted-i10-tools-1440-light");
    await shot("hosted-i10-tools-1440-light.png");

    await setViewport(390, 844);
    const toolsMobileOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    assert.ok(toolsMobileOverflow <= 1, `Hosted /tools 390px overflow: ${toolsMobileOverflow}`);
    await shot("hosted-i10-tools-390-light.png");
    await setViewport(1440, 900);

    // Finance right drawer + HUD non-overlap + 6 currencies
    await pointerClick("#v3Sidebar [data-v3-nav='finance']");
    await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden') && !document.querySelector('#financeAddTransactionBtn')?.disabled", 20_000);
    await pointerClick("#financeAddTransactionBtn");
    await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 8_000);
    await delay(460);
    await page.evaluate("window.WYJMotion.showToast({ tone: 'info', message: 'I10 隔离预览右侧 Drawer 与 HUD 避让验证' }, {}, document)");
    await delay(300);
    await settle();
    const drawerHud = await page.evaluate(`(() => {
      const panel = document.querySelector('#financeTransactionModal .modal-panel').getBoundingClientRect();
      const toast = document.querySelector('.ds-toast-region')?.getBoundingClientRect();
      const ver = document.getElementById('versionNotice')?.classList.contains('hidden') ? null : document.getElementById('versionNotice').getBoundingClientRect();
      const overlaps = (a, b) => Boolean(a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5);
      return {
        currencies: [...document.querySelectorAll('#financeTransactionCurrency option')].map((o) => o.value),
        panelTransform: getComputedStyle(document.querySelector('#financeTransactionModal .modal-panel')).transform,
        toastOverlap: overlaps(panel, toast),
        verOverlap: overlaps(panel, ver),
      };
    })()`);
    assert.deepEqual(drawerHud.currencies, ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"]);
    assert.equal(drawerHud.panelTransform, "none");
    assert.equal(drawerHud.toastOverlap, false);
    assert.equal(drawerHud.verOverlap, false);
    await runAxe("hosted-i10-finance-drawer-1440-light");
    await shot("hosted-i10-finance-drawer-1440-light.png");

    report.scenarios.authenticated = { searchContrast, toolsMobileOverflow, drawerHud };
  }

  assert.deepEqual(page.runtimeErrors, []);
  report.runtimeErrors = page.runtimeErrors;
  report.status = "PASS";
  await writeFile(path.join(evidenceDir, "i10-preview-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, headCommit, authenticatedMode, axeScans: report.axeScans.length, screenshots: report.screenshots.length }, null, 2));
} finally {
  if (page) await page.close().catch(() => {});
  try { child.kill(); } catch (_) {}
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
