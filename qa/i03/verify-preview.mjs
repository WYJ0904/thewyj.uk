import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i03", "evidence", "preview");
await mkdir(evidenceDir, { recursive: true });

const baseUrl = process.env.I03_PREVIEW_URL || "https://i03-public-pages.thewyj-i03-preview.pages.dev";
assert.equal(new URL(baseUrl).protocol, "https:");
assert.notEqual(new URL(baseUrl).hostname, "thewyj.uk", "Must NEVER run preview checks against Production");

const buildJson = await fetch(`${baseUrl}/__preview/build.json`).then((r) => r.json());
const apiHealth = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
const uiFeatures = await fetch(`${baseUrl}/api/ui/features`).then((r) => r.json());
const plansRes = await fetch(`${baseUrl}/api/membership/plans`).then((r) => r.json());
const appConfig = await fetch(`${baseUrl}/api/app/config`).then((r) => r.json());
assert.equal(uiFeatures.public_ui?.enabled, true, "Isolated Hosted Preview must have public_ui ON");
assert.equal(plansRes.ok, true);

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i03-preview-chrome-"));
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
  buildJson,
  apiHealth,
  uiFeatures,
  plansCount: plansRes.plans?.length || 0,
  appVersion: appConfig?.app?.latest_version_name || "",
  routes: [],
  fixtureChecks: {},
  axeScans: [],
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
  const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, sample: v.nodes[0]?.failureSummary, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
  report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
  assert.equal(res.violations.length, 0, `Preview axe violations on ${label}: ${JSON.stringify(res.violations)}`);
}

try {
  let chromePort;
  for (let i = 0; i < 60 && !chromePort; i += 1) {
    try {
      const portFile = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      chromePort = Number(portFile.trim().split(/\r?\n/)[0]);
    } catch (_) {
      await delay(100);
    }
  }
  assert.ok(chromePort, "Chrome DevToolsActivePort must become available");
  page = await openPage({ cdpUrl: `http://127.0.0.1:${chromePort}`, baseUrl, width: 1440, height: 900, mobile: false });

  for (const route of ["/", "/trial", "/download", "/changelog", "/login", "/register"]) {
    await page.navigate(route);
    await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
    await settle();
    const overflowX = await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)");
    assert.ok(overflowX <= 1, `Hosted overflow on ${route}: ${overflowX}`);
    const slug = route.slice(1) || "home";
    await runAxe(`hosted-${slug}-1440`);
    await shot(`hosted-${slug}-1440.png`);
    report.routes.push({ route, overflowX });
  }

  // Test Hosted Home multi-stage scroll + preview tab switch + Bento lock + bottom -> /download top scroll
  await page.navigate("/");
  await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
  await settle();
  await page.click("#publicToolsTab");
  await page.waitFor("!document.getElementById('capabilityToolsBody').hidden && !document.querySelector('.aeris-window-content')?.hasAttribute('aria-busy')", 4000);
  await page.setFields({ "#publicTextInput": '{"preview":"hosted"}' });
  await page.click("#publicJsonFormatQuickBtn");
  assert.equal(await page.evaluate("document.getElementById('publicTextInput').value.includes('\\n')"), true);

  for (let i = 0; i < 7; i += 1) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: 160 });
    await delay(70);
  }
  await settle();
  const exitRx = await page.evaluate("parseFloat(document.getElementById('publicPreviewScrollWrap').style.getPropertyValue('--ds-scroll-rx') || '0')");
  assert.ok(exitRx < 0, `Hosted Preview scroll exit rx expected < 0, got ${exitRx}`);
  await page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })");
  await page.click("#publicDownloadBtn");
  await page.waitFor("location.pathname === '/download'", 5000);
  await settle();
  assert.ok((await page.evaluate("window.scrollY")) <= 2);

  // Also test /__preview/i07-fixture.html Switch containment on Hosted Preview
  const navFx = await page.send("Page.navigate", { url: `${baseUrl}/__preview/i07-fixture.html` });
  assert.equal(navFx.errorText || "", "");
  await page.waitFor("document.readyState === 'complete' && document.documentElement.getAttribute('data-aeris-motion-ready') === 'true'", 25000);
  await settle();
  const switchBad = await page.evaluate("[...document.querySelectorAll('.switch')].filter(sw => { const sl = sw.querySelector('.slider'); const rSw = sw.getBoundingClientRect(), rSl = sl.getBoundingClientRect(); return rSl.left < rSw.left - 0.5 || rSl.right > rSw.right + 0.5; }).length");
  assert.equal(switchBad, 0, "Hosted i07 fixture Switch thumb must never overflow");
  await shot("hosted-i07-fixture-1440.png");
  report.fixtureChecks = { switchOverflowCount: switchBad, exitRx };

  // Mobile 375px check on Hosted /
  await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.navigate("/");
  await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
  await settle();
  assert.ok((await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)")) <= 1);
  await shot("hosted-home-375.png");

  assert.deepEqual(page.runtimeErrors, [], `Hosted Preview runtime errors: ${JSON.stringify(page.runtimeErrors)}`);
  await writeFile(path.join(evidenceDir, "verify-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "PASS", previewUrl: baseUrl, routes: report.routes.length, axeScans: report.axeScans.length }));
} finally {
  if (page) await page.close().catch(() => {});
  child.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
