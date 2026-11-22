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
assert.equal(buildInfo.source_commit, headCommit, `Hosted Preview source_commit (${buildInfo.source_commit}) differs from HEAD (${headCommit})`);
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
let adminPage;
async function settle(targetPage = page) {
  await targetPage.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
}
async function shot(name, targetPage = page) {
  await settle(targetPage);
  const pwVisible = await targetPage.evaluate("[...document.querySelectorAll('input[type=password]')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; })");
  assert.equal(pwVisible, false, `Refusing screenshot ${name} while a password input is visible`);
  const data = await targetPage.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
}
async function setViewport(width, height = 900, targetPage = page) {
  await targetPage.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
  await targetPage.send("Emulation.setTouchEmulationEnabled", { enabled: width <= 980 });
  await settle(targetPage);
}
async function setTheme(targetTheme, targetPage = page) {
  for (let i = 0; i < 4; i += 1) {
    if (await targetPage.evaluate("document.documentElement.dataset.themePreference") === targetTheme) break;
    await targetPage.click("#themeToggleBtn");
    await delay(80);
  }
  await settle(targetPage);
  assert.equal(await targetPage.evaluate("document.documentElement.dataset.themePreference"), targetTheme);
}
async function pointerClick(selector, targetPage = page) {
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
  await delay(80);
  return hit;
}
async function runAxe(label, targetPage = page) {
  await targetPage.evaluate(axeSource);
  const res = await targetPage.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
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
    await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 2500, "site notice");
    await page.click("#siteMessageCloseBtn");
    await page.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 5_000, "site notice dismissed");
  } catch (_) {}

  // Verify unpaid synthetic user fail-closed gate on /tools -> /recharge, then /transfer I06 disclosure & /trial
  await page.click("#v3Sidebar [data-v3-nav='tools']");
  await page.waitFor("location.pathname === '/recharge' && !document.querySelector('#membershipModal')?.classList.contains('hidden') && !document.querySelector('#v3Sidebar [aria-busy=\"true\"]')", 15_000, "unpaid /tools gate -> /recharge");
  await shot("hosted-i06-recharge.png");
  await runAxe("hosted-recharge");

  await page.click("#v3Sidebar [data-v3-nav='transfer']");
  await page.waitFor("!document.querySelector('#transferPage')?.classList.contains('hidden') && Boolean(document.querySelector('#transferConfigDisclosure')) && !document.querySelector('#v3Sidebar [aria-busy=\"true\"]')", 15_000, "hosted transfer");
  await setViewport(375, 812);
  await page.evaluate("window.scrollTo(0, 0)");
  await settle();
  const hostedTransfer375 = await page.evaluate(`(() => {
    const btn = document.getElementById('transferSelectFilesBtn').getBoundingClientRect();
    return { selectFilesBottom: btn.bottom, vh: window.innerHeight, overflow: document.documentElement.scrollWidth - window.innerWidth };
  })()`);
  assert.ok(hostedTransfer375.selectFilesBottom <= hostedTransfer375.vh, `Hosted 375px /transfer should keep 选择文件 above the fold: ${JSON.stringify(hostedTransfer375)}`);
  assert.ok(hostedTransfer375.overflow <= 1);
  await shot("hosted-i06-transfer-375.png");
  await setViewport(1440, 900);
  await page.click("#transferConfigDisclosure > summary");
  await settle();
  await shot("hosted-i06-transfer.png");
  await runAxe("hosted-transfer");

  await page.click("#v3Sidebar [data-v3-nav='trial']");
  await page.waitFor("!document.querySelector('#trialPage')?.classList.contains('hidden') && !document.querySelector('#v3Sidebar [aria-busy=\"true\"]')", 15_000, "hosted trial");
  await runAxe("hosted-trial");

  report.moduleChecks = {
    registeredUser: uname,
    unpaidToolsRedirectedToRecharge: true,
    transferDisclosureAndExpanded: true,
    hostedTransfer375,
    trialPageReachable: true,
  };

  const credsFile = process.env.I06_PREVIEW_CREDS_FILE;
  if (credsFile) {
    const rawCreds = await readFile(credsFile, "utf8");
    const creds = {};
    for (const line of rawCreds.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) creds[m[1]] = m[2];
    }
    const adminUser = creds.I06_ADMIN_USER || "i06admin";
    const adminPass = creds.I06_ADMIN_PASS;
    assert.ok(adminPass && adminPass.length >= 16, "Missing I06_ADMIN_PASS in I06_PREVIEW_CREDS_FILE");

    adminPage = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl, width: 1440, height: 900, mobile: false });
    await adminPage.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});
    await adminPage.navigate("/login");
    await adminPage.waitFor("Boolean(document.querySelector('#loginForm'))", 20_000, "admin login ready");
    await adminPage.setFields({ "#usernameInput": adminUser, "#secretInput": adminPass });
    await pointerClick("#loginSubmitBtn", adminPage);
    await adminPage.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('v3SidebarAdminLink')?.hidden", 30_000, "hosted admin signed in");
    try {
      await adminPage.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 2500, "admin site notice");
      await pointerClick("#siteMessageCloseBtn", adminPage);
      await adminPage.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 5_000, "admin site notice closed");
    } catch (_) {}

    // 1. Hosted V01 /language quiz verification (1440 light/dark, 390 light, 375 dark)
    await pointerClick("#v3Sidebar [data-v3-nav='language']", adminPage);
    await adminPage.waitFor("!document.querySelector('#projectPicker')?.classList.contains('hidden')", 15_000, "hosted language picker");
    await pointerClick("#projectPicker [data-project='english']", adminPage);
    await adminPage.waitFor("!document.querySelector('#workspace')?.classList.contains('hidden')", 15_000, "hosted english workspace");
    await adminPage.setFields({ "#wordInput": "hello\nworld" }, adminPage);
    await pointerClick("#startBtn", adminPage);
    await adminPage.waitFor("document.querySelector('#quizView')?.classList.contains('active')", 10_000, "hosted quiz active");
    await settle(adminPage);
    const checkHostedQuiz = async (label) => {
      const box = await adminPage.evaluate(`(() => {
        const word = document.getElementById('wordLabel').getBoundingClientRect();
        const submit = document.getElementById('submitBtn').getBoundingClientRect();
        const skip = document.getElementById('skipBtn').getBoundingClientRect();
        const nav = document.getElementById('accountBar')?.getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          navBottom: nav ? nav.bottom : 0,
          wordTop: word.top,
          submitHeight: submit.height,
          submitBottom: submit.bottom,
          skipBottom: skip.bottom,
          vh: window.innerHeight,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      })()`);
      assert.ok(box.submitHeight >= 44 && box.submitHeight <= 56, `${label} hosted #submitBtn height out of range: ${JSON.stringify(box)}`);
      assert.ok(box.wordTop >= box.navBottom - 1, `${label} hosted #wordLabel occluded by sticky header: ${JSON.stringify(box)}`);
      assert.ok(box.submitBottom <= box.vh, `${label} hosted #submitBtn below initial fold: ${JSON.stringify(box)}`);
      assert.ok(box.overflow <= 1, `${label} hosted quiz overflow: ${JSON.stringify(box)}`);
      return box;
    };
    const hostedQuiz1440 = await checkHostedQuiz("hosted-1440-light");
    assert.ok(hostedQuiz1440.scrollY <= 4, `Hosted quiz start did not reset scroll: ${JSON.stringify(hostedQuiz1440)}`);
    await shot("hosted-i06-language-quiz-1440.png", adminPage);
    await setTheme("dark", adminPage);
    const hostedQuiz1440Dark = await checkHostedQuiz("hosted-1440-dark");
    await setViewport(390, 844, adminPage);
    await setTheme("light", adminPage);
    await adminPage.evaluate("window.scrollTo(0, 0)");
    await settle(adminPage);
    const hostedQuiz390 = await checkHostedQuiz("hosted-390-light");
    await shot("hosted-i06-language-quiz-390.png", adminPage);
    await setViewport(375, 812, adminPage);
    await setTheme("dark", adminPage);
    await adminPage.evaluate("window.scrollTo(0, 0)");
    await settle(adminPage);
    const hostedQuiz375 = await checkHostedQuiz("hosted-375-dark");
    await shot("hosted-i06-language-quiz-375-dark.png", adminPage);
    await setTheme("light", adminPage);
    await setViewport(1440, 900, adminPage);

    // 2. Hosted /finance borderless ledger + desktop slide-over drawer + 390 dark bottom sheet
    await pointerClick("#v3Sidebar [data-v3-nav='finance']", adminPage);
    await adminPage.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden')", 15_000, "hosted finance workspace");
    await adminPage.evaluate("const rec = document.getElementById('financeRecordedSection'); if (rec && !rec.open) rec.open = true;");
    await adminPage.waitFor("document.querySelectorAll('#financeTransactionList .finance-transaction').length >= 2", 15_000, "hosted finance rows");
    await pointerClick("#financeTransactionList .finance-transaction .finance-transaction-main", adminPage);
    await adminPage.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "hosted finance drawer");
    await delay(260);
    await shot("hosted-i06-finance-drawer-1440.png", adminPage);
    await runAxe("hosted-finance", adminPage);
    await pointerClick("#financeTransactionModal [data-finance-close='financeTransactionModal']", adminPage);
    await setViewport(390, 844, adminPage);
    await setTheme("dark", adminPage);
    await pointerClick("#financeAddTransactionBtn", adminPage);
    await adminPage.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "hosted mobile finance sheet");
    await delay(260);
    await shot("hosted-i06-finance-sheet-390-dark.png", adminPage);
    await pointerClick("#financeTransactionModal [data-finance-close='financeTransactionModal']", adminPage);
    await setTheme("light", adminPage);
    await setViewport(1440, 900, adminPage);

    // 3. Hosted /tools two-pane + split workbench
    await pointerClick("#v3Sidebar [data-v3-nav='tools']", adminPage);
    await adminPage.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && Boolean(document.querySelector('#toolCatalog .tool-card'))", 15_000, "hosted tools");
    await shot("hosted-i06-tools-twopane-1440.png", adminPage);
    await pointerClick("#toolCatalog [data-open-tool='letter-case']", adminPage);
    await adminPage.waitFor("!document.querySelector('#toolWorkbench')?.classList.contains('hidden')", 10_000, "hosted tool workbench");
    await adminPage.setFields({ "#textToolInput": "hello aeris" }, adminPage);
    await pointerClick("#runTextToolBtn", adminPage);
    await adminPage.waitFor("document.getElementById('textToolOutput')?.value === 'HELLO AERIS'", 5_000, "hosted tool output");
    await shot("hosted-i06-tools-workbench-1440.png", adminPage);
    await runAxe("hosted-tools", adminPage);
    await pointerClick("#closeToolWorkbenchBtn", adminPage);

    // 4. Hosted V02 /admin Flags (create/update + multi-row timeline + 390 dark / 375 light alignment)
    await pointerClick("#v3Sidebar [data-v3-nav='admin']", adminPage);
    await adminPage.waitFor("Boolean(document.querySelector('#adminUserList .admin-user-card'))", 20_000, "hosted admin ready");
    await pointerClick("#adminFeatureFlagsTab", adminPage);
    await adminPage.waitFor("document.querySelectorAll('#featureFlagSummaryList .feature-directory-item').length > 0", 15_000, "hosted flag directory");

    const hostedFlagKey = `i06_hosted_align_${Date.now().toString(36).slice(-4)}`;
    await pointerClick("#newFeatureFlagBtn", adminPage);
    await adminPage.setFields({ "#featureFlagKey": hostedFlagKey, "#featureFlagDescription": "Hosted V02 alignment & audit timeline verification", "#featureFlagPercentage": "50" }, adminPage);
    await pointerClick("#featureFlagEnabled", adminPage);
    await pointerClick("#saveFeatureFlagBtn", adminPage);
    await adminPage.waitFor("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]'))", 15_000, "hosted task27 step-up");
    await adminPage.setFields({ "#task27Prompt input[name='password']": adminPass }, adminPage);
    await pointerClick("#task27Prompt button[type='submit']", adminPage);
    await adminPage.waitFor("document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存')", 20_000, "hosted flag created");

    await pointerClick(`#featureFlagSummaryList [data-flag-key="${hostedFlagKey}"]`, adminPage);
    await adminPage.setFields({ "#featureFlagPercentage": "75" }, adminPage);
    await adminPage.evaluate("const s = document.getElementById('featureConsoleStatus'); if (s) s.textContent = '';");
    await pointerClick("#saveFeatureFlagBtn", adminPage);
    await adminPage.waitFor("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]')) || document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存')", 15_000, "hosted second save step-up");
    if (await adminPage.evaluate("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]'))")) {
      await adminPage.setFields({ "#task27Prompt input[name='password']": adminPass }, adminPage);
      await pointerClick("#task27Prompt button[type='submit']", adminPage);
    }
    await adminPage.waitFor("document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存') && document.querySelectorAll('#featureFlagAuditTimeline .feature-audit-item').length >= 2", 20_000, "hosted >=2 timeline rows");

    await adminPage.evaluate(`(() => {
      const details = document.querySelector('#adminFeatureFlagsView details');
      if (details && !details.open) details.open = true;
      document.getElementById('featureFlagAuditTimeline')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    })()`);
    await settle(adminPage);
    await shot("hosted-i06-admin-flags-timeline-1440.png", adminPage);
    await runAxe("hosted-admin-flags", adminPage);

    await setViewport(390, 844, adminPage);
    await setTheme("dark", adminPage);
    await pointerClick(`#featureFlagSummaryList [data-flag-key="${hostedFlagKey}"]`, adminPage);
    await adminPage.evaluate(`(() => {
      const strip = document.getElementById('featureFlagCapsuleStrip');
      const nav = document.getElementById('accountBar');
      window.scrollTo(0, Math.max(0, window.scrollY + (strip?.getBoundingClientRect().top || 0) - (nav?.getBoundingClientRect().bottom || 0) - 8));
    })()`);
    await settle(adminPage);
    const hostedFlags390 = await adminPage.evaluate(`(() => {
      const list = document.getElementById('featureFlagSummaryList');
      const items = [...list.querySelectorAll('.feature-directory-item')];
      const pillRights = items.map(el => el.querySelector('.feature-capsule')?.getBoundingClientRect().right || 0);
      return {
        count: items.length,
        minHeight: Math.min(...items.map(el => el.getBoundingClientRect().height)),
        pillRightSpread: Math.max(...pillRights) - Math.min(...pillRights),
        listHeight: list.getBoundingClientRect().height,
        formTop: document.getElementById('featureFlagForm').getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    assert.ok(hostedFlags390.count >= 2 && hostedFlags390.minHeight >= 44 && hostedFlags390.pillRightSpread <= 2 && hostedFlags390.listHeight <= 230 && hostedFlags390.overflow <= 1, `Hosted 390 flags alignment failed: ${JSON.stringify(hostedFlags390)}`);
    await shot("hosted-i06-admin-flags-390-dark.png", adminPage);

    await setViewport(375, 812, adminPage);
    await setTheme("light", adminPage);
    await pointerClick('#featureFlagSummaryList [data-flag-key="p07_accessibility"]', adminPage);
    await adminPage.evaluate(`(() => {
      const strip = document.getElementById('featureFlagCapsuleStrip');
      const nav = document.getElementById('accountBar');
      window.scrollTo(0, Math.max(0, window.scrollY + (strip?.getBoundingClientRect().top || 0) - (nav?.getBoundingClientRect().bottom || 0) - 8));
    })()`);
    await settle(adminPage);
    await shot("hosted-i06-admin-flags-375-light.png", adminPage);

    report.authorizedChecks = {
      adminUser,
      hostedQuiz1440,
      hostedQuiz1440Dark,
      hostedQuiz390,
      hostedQuiz375,
      hostedFlagKey,
      hostedFlags390,
    };
    assert.deepEqual(adminPage.runtimeErrors, [], `Admin Preview runtimeErrors: ${JSON.stringify(adminPage.runtimeErrors)}`);
  }

  assert.deepEqual(page.runtimeErrors, [], `Preview runtimeErrors: ${JSON.stringify(page.runtimeErrors)}`);
  report.status = "PASS";
  await writeFile(path.join(evidenceDir, "i06-preview-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, headCommit, axeScans: report.axeScans.length, authorizedVerified: Boolean(credsFile) }, null, 2));
} finally {
  if (adminPage) await adminPage.close().catch(() => {});
  if (page) await page.close().catch(() => {});
  try { child.kill(); } catch (_) {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
