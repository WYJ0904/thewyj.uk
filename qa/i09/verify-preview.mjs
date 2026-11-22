import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i09", "evidence", "hosted");
await mkdir(evidenceDir, { recursive: true });

const baseUrl = process.env.I09_PREVIEW_URL || "https://i09-system-feedback.thewyj-i09-preview.pages.dev";
assert.equal(new URL(baseUrl).protocol, "https:");
assert.notEqual(new URL(baseUrl).hostname, "thewyj.uk", "Must NEVER run preview verification against Production");
assert.ok(new URL(baseUrl).hostname.includes("thewyj-i09-preview.pages.dev"), "Preview host must be isolated I09 Pages project");

const sourceOnly = process.argv.includes("--source-only");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const buildInfo = await fetch(`${baseUrl}/__preview/build.json`).then((r) => r.json());
const apiStatus = await fetch(`${baseUrl}/api/status`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
assert.equal(buildInfo.stage, "I09-system-feedback");
assert.equal(buildInfo.source_commit, headCommit, `Hosted Preview source_commit (${buildInfo.source_commit}) differs from HEAD (${headCommit})`);
assert.equal(apiStatus.ok, true);
assert.equal(apiHealth.code, "authentication_required", "Unauthenticated /api/health must fail closed");
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated I09 Preview must have public_ui ON");

const verifiedAssets = [];
for (const assetPath of [
  "design-system.css",
  "spatial-experience.css",
  "product-ui.css",
  "app.js",
  "js/core/design-system.js",
  "js/core/motion.js",
  "js/core/feature-console.js",
  "js/core/feature-flags.js",
  "js/core/router.js",
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
  await writeFile(path.join(evidenceDir, "i09-preview-source-check.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const credsFile = process.env.I09_PREVIEW_CREDS_FILE;
assert.ok(credsFile, "Missing I09_PREVIEW_CREDS_FILE for authorized I09 Hosted Preview acceptance");
const rawCreds = await readFile(credsFile, "utf8");
const creds = {};
for (const line of rawCreds.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (m) creds[m[1]] = m[2];
}
const adminUser = creds.I09_ADMIN_USER || "i09admin";
const adminPass = creds.I09_ADMIN_PASS;
const normalUser = creds.I09_USER_NAME || "i09user";
const normalPass = creds.I09_USER_PASS;
assert.ok(adminPass && adminPass.length >= 16, "Missing I09_ADMIN_PASS");
assert.ok(normalPass && normalPass.length >= 16, "Missing I09_USER_PASS");

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i09-preview-chrome-"));
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

const D1_CONFIG_PATH = path.join(root, ".wrangler", "i09-preview-d1.jsonc");
const WRANGLER = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
function runD1(sql) {
  const res = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "aeris-i09-preview", "--remote", "--config", D1_CONFIG_PATH, "--command", sql],
    { cwd: root, input: "y\n", encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(res.status, 0, `D1 command failed:\n${res.stdout}\n${res.stderr}`);
}

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

let page;
let userPage;
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

  const settle = async (target = page) => {
    await target.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  };
  const setViewport = async (width, height = 900, target = page) => {
    await target.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
    await target.send("Emulation.setTouchEmulationEnabled", { enabled: width <= 980 });
    await settle(target);
  };
  const setTheme = async (theme, target = page) => {
    await target.evaluate(`(() => { localStorage.setItem('wyj_theme_preference_v1', ${JSON.stringify(theme)}); location.reload(); })()`);
    await target.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled'", 25_000, `hosted theme ${theme}`);
    await settle(target);
  };
  const shot = async (name, target = page) => {
    await settle(target);
    const data = await target.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
    report.screenshots.push(name);
  };
  const pointerClick = async (selector, target = page) => {
    const hit = await target.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'missing: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const h = document.elementFromPoint(cx, cy);
      return { ok: Boolean(h && (el === h || el.contains(h) || h.contains(el))), cx, cy };
    })()`);
    assert.ok(hit.ok, `Hit-test failed for ${selector}: ${JSON.stringify(hit)}`);
    await target.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy });
    await target.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await target.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await delay(100);
  };
  const runAxe = async (label, target = page) => {
    await target.evaluate(axeSource);
    const res = await target.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)), passes: r.passes.length }))");
    report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
    assert.equal(res.violations.length, 0, `Hosted axe violations on ${label}: ${JSON.stringify(res.violations)}`);
  };

  // 1. Admin login + #versionNotice + simultaneous Toasts non-overlap across 1440 / 390 / 375
  await page.navigate("/login");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && Boolean(document.querySelector('#loginForm'))", 25_000, "hosted login ready");
  await page.evaluate("localStorage.removeItem('wyjSeenChangelogVersion')");
  await page.setFields({ "#usernameInput": adminUser, "#secretInput": adminPass });
  await page.click("#loginSubmitBtn");
  await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('authTransitionScreen') && document.documentElement.dataset.workspaceMount === 'ready'", 25_000, "hosted admin signed in");
  await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 15_000, "hosted site message visible");
  await pointerClick("#siteMessageCloseBtn");
  await page.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 10_000);
  await page.waitFor("!document.getElementById('versionNotice').classList.contains('hidden')", 5_000, "hosted versionNotice visible");

  await page.evaluate(`(() => {
    window.WYJMotion.showToast({ tone: 'error', message: '预览环境校验错误示例：不会被成功消息覆盖' }, {}, document);
    window.WYJMotion.showToast({ tone: 'success', message: '版本状态提示与 Toast 并存验证', duration: 8000 }, {}, document);
  })()`);
  await settle();

  const hudMatrix = {};
  for (const [w, h] of [[1440, 900], [390, 844], [375, 812]]) {
    await setViewport(w, h);
    await delay(80);
    await settle();
    const metrics = await page.evaluate(`(() => {
      const box = (el) => {
        if (!el || el.classList?.contains('hidden') || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
      };
      const overlaps = (a, b) => Boolean(a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5);
      const ver = document.getElementById('versionNotice');
      const toast = document.querySelector('.ds-toast-region');
      const nav = document.getElementById('accountBar');
      const banner = document.getElementById('ownerPreviewBanner');
      const verBox = box(ver);
      const toastBox = box(toast);
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        outsideFrame: !document.getElementById('v3AppFrame').contains(ver),
        verToastOverlap: overlaps(verBox, toastBox),
        toastNavOverlap: overlaps(toastBox, box(nav)),
        toastBannerOverlap: overlaps(toastBox, box(banner)),
        closeTargetH: document.getElementById('dismissVersionNoticeBtn')?.getBoundingClientRect().height || 0,
      };
    })()`);
    assert.ok(metrics.overflow <= 1, `Hosted overflow at ${w}px: ${metrics.overflow}`);
    assert.equal(metrics.outsideFrame, true);
    assert.equal(metrics.verToastOverlap, false);
    assert.equal(metrics.toastNavOverlap, false);
    assert.equal(metrics.toastBannerOverlap, false);
    assert.ok(metrics.closeTargetH >= 43.5);
    hudMatrix[`w${w}`] = metrics;
    if (w === 1440) {
      await runAxe("hosted-i09-hud-coexistence-1440-light");
      await shot("hosted-i09-hud-stack-1440-light.png");
    } else if (w === 390) {
      await shot("hosted-i09-hud-stack-390-light.png");
    }
  }
  await setViewport(1440, 900);
  await pointerClick("#dismissVersionNoticeBtn");
  await page.evaluate("window.WYJMotion.getSharedToastManager(document).clear()");

  // 2. Finance right-docked drawer dark mode + Toast non-overlap
  await pointerClick("#v3Sidebar [data-v3-nav='finance']");
  await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden') && !document.querySelector('#financeAddTransactionBtn')?.disabled", 20_000);
  await setTheme("dark");
  await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden') && !document.querySelector('#financeAddTransactionBtn')?.disabled", 20_000);
  await pointerClick("#financeAddTransactionBtn");
  await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 8_000);
  await page.evaluate("window.WYJMotion.showToast({ tone: 'info', message: '右侧 Drawer 打开时通知左移避让' }, {}, document)");
  await settle();
  const drawerCheck = await page.evaluate(`(() => {
    const panel = document.querySelector('#financeTransactionModal .modal-panel').getBoundingClientRect();
    const toast = document.querySelector('.ds-toast-region').getBoundingClientRect();
    return {
      rightDrawerOpen: document.documentElement.dataset.rightDrawerOpen || '',
      overlap: toast.left < panel.right && toast.right > panel.left && toast.top < panel.bottom && toast.bottom > panel.top,
      toastLeftOfDrawer: toast.right <= panel.left,
    };
  })()`);
  assert.equal(drawerCheck.rightDrawerOpen, "true");
  assert.equal(drawerCheck.overlap, false);
  assert.equal(drawerCheck.toastLeftOfDrawer, true);
  await runAxe("hosted-i09-finance-drawer-dark");
  await shot("hosted-i09-finance-drawer-1440-dark.png");
  await setTheme("light");
  await page.evaluate("window.WYJMotion.getSharedToastManager(document).clear()");

  // 3. Release Channel persistence & Account mobile dark
  await pointerClick("#v3Sidebar [data-v3-nav='account']");
  await page.waitFor("!document.querySelector('#releaseChannelSection')?.classList.contains('hidden') && !document.getElementById('saveReleaseChannelBtn').disabled", 15_000);
  await page.evaluate("const s = document.getElementById('releaseChannelSelect'); s.value='beta'; s.dispatchEvent(new Event('change',{bubbles:true}));");
  await pointerClick("#saveReleaseChannelBtn");
  await page.waitFor("document.getElementById('releaseChannelStatus').dataset.feedbackState === 'success'", 12_000);
  await page.evaluate("const s = document.getElementById('releaseChannelSelect'); s.value='stable'; s.dispatchEvent(new Event('change',{bubbles:true}));");
  await pointerClick("#saveReleaseChannelBtn");
  await page.waitFor("document.getElementById('releaseChannelStatus').dataset.feedbackState === 'success'", 12_000);
  await setViewport(375, 812);
  await setTheme("dark");
  await runAxe("hosted-i09-account-375-dark");
  await shot("hosted-i09-account-375-dark.png");
  await setTheme("light");
  await setViewport(1440, 900);

  // 4. Admin Kill Switch persistence vs unsaved uncheck + step-up
  await pointerClick("#v3Sidebar [data-v3-nav='admin']");
  await page.waitFor("Boolean(document.querySelector('#adminUserList .admin-user-card'))", 20_000);
  await pointerClick("#adminFeatureFlagsTab");
  await page.waitFor("document.querySelectorAll('#featureFlagSummaryList .feature-directory-item').length >= 2", 15_000);
  await pointerClick("#featureFlagSummaryList [data-flag-key='aeris_experimental_badge']");
  await pointerClick("#featureFlagKillSwitch");
  await delay(100);
  assert.equal(await page.evaluate("document.getElementById('featureFlagKillWarning')?.dataset.killMode"), "pending-enable");
  await pointerClick("#saveFeatureFlagBtn");
  await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')", 10_000);
  await page.setFields({ "#task27Prompt input[type='password']": adminPass });
  await pointerClick("#task27Prompt button[type='submit']");
  await page.waitFor("document.getElementById('featureConsoleStatus').dataset.feedbackState === 'success' && document.getElementById('featureFlagKillWarning')?.dataset.killMode === 'active'", 15_000);
  await pointerClick("#featureFlagKillSwitch");
  await delay(100);
  const killClearPending = await page.evaluate(`({
    mode: document.getElementById('featureFlagKillWarning')?.dataset.killMode,
    warnVisible: !document.getElementById('featureFlagKillWarning')?.classList.contains('hidden'),
  })`);
  assert.equal(killClearPending.warnVisible, true);
  assert.equal(killClearPending.mode, "pending-clear");
  await shot("hosted-i09-admin-kill-switch-pending-clear.png");
  await pointerClick("#saveFeatureFlagBtn");
  await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')", 10_000);
  await page.setFields({ "#task27Prompt input[type='password']": adminPass });
  await pointerClick("#task27Prompt button[type='submit']");
  await page.waitFor("document.getElementById('featureConsoleStatus').dataset.feedbackState === 'success'", 15_000);

  // 5. Reduced Motion + Normal User login + P07 OFF verification
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await page.evaluate("window.WYJMotion.showToast({ tone: 'info', message: 'Reduced Motion 在线校验' }, {}, document)");
  await delay(80);
  assert.ok(await page.evaluate("document.querySelector('.ds-toast') !== null"));
  await page.evaluate("window.WYJMotion.getSharedToastManager(document).clear()");
  await page.send("Emulation.setEmulatedMedia", { features: [] });

  userPage = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl, width: 1440, height: 900, mobile: false });
  await userPage.navigate("/login");
  await userPage.waitFor("Boolean(document.querySelector('#loginForm'))", 20_000);
  await userPage.setFields({ "#usernameInput": normalUser, "#secretInput": normalPass });
  await pointerClick("#loginSubmitBtn", userPage);
  await userPage.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('authTransitionScreen')", 25_000);
  runD1("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility';");
  try {
    await userPage.navigate("/account");
    await userPage.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui !== 'enabled'", 20_000);
    const offChev = await userPage.evaluate("getComputedStyle(document.querySelector('#accountModal .account-setting-chevron')).display");
    assert.equal(offChev, "none");
    report.scenarios.p07Off = { offChev, overflow: await userPage.evaluate("document.documentElement.scrollWidth - window.innerWidth") };
  } finally {
    runD1("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility';");
  }

  assert.deepEqual(page.runtimeErrors, []);
  assert.deepEqual(userPage.runtimeErrors, []);
  report.scenarios.hudMatrix = hudMatrix;
  report.scenarios.drawerCheck = drawerCheck;
  report.scenarios.killClearPending = killClearPending;
  report.status = "PASS";
  await writeFile(path.join(evidenceDir, "i09-preview-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, headCommit, axeScans: report.axeScans.length, screenshots: report.screenshots.length }, null, 2));
} finally {
  if (userPage) await userPage.close().catch(() => {});
  if (page) await page.close().catch(() => {});
  try { child.kill(); } catch (_) {}
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
