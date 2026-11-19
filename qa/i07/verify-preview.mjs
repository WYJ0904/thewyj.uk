import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const previewUrl = process.env.I07_PREVIEW_URL || "https://i07-motion-engine.thewyj-p07-ui-rc.pages.dev";
const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "docs", "ui-rebuild", "i07", "evidence", "preview");
await mkdir(outDir, { recursive: true });

const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i07-preview-"));
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
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

let page;
try {
  let port;
  for (let i = 0; i < 100 && !port; i += 1) {
    try {
      port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
    } catch {
      await delay(100);
    }
  }
  assert.ok(port, "Chrome debugging port did not appear");
  const cdpUrl = `http://127.0.0.1:${port}`;
  page = await openPage({ cdpUrl, baseUrl: previewUrl, width: 1440, height: 900, mobile: false });

  const failedRequests = [];
  page.client.listeners.add((msg) => {
    if (msg.method === "Network.responseReceived") {
      const r = msg.params?.response;
      if (r && r.status >= 400) failedRequests.push({ url: r.url, status: r.status });
    }
    if (msg.method === "Network.loadingFailed" && !msg.params?.canceled) {
      failedRequests.push({ url: msg.params?.requestId, error: msg.params?.errorText });
    }
  });

  const settle = () => page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  const shot = async (name, waitSettle = true) => {
    if (waitSettle) await settle();
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(outDir, name), Buffer.from(data, "base64"));
  };

  // 1. Verify live root public home & preview banner
  await page.navigate("/");
  await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
  await settle();
  const homeState = await page.evaluate(`({
    p07Ui: document.documentElement.dataset.p07Ui,
    motionReady: document.documentElement.getAttribute('data-aeris-motion-ready'),
    release: document.querySelector('link[rel=stylesheet]')?.href || '',
    bannerVerified: document.getElementById('ownerPreviewBanner')?.dataset.previewVerified || '',
    fixtureHref: document.querySelector('#ownerPreviewBanner a[href*="i07-fixture"]')?.getAttribute('href') || ''
  })`);
  assert.equal(homeState.motionReady, "true");
  assert.match(homeState.release, /20261119-aeris-i07-preview/);
  assert.equal(homeState.bannerVerified, "true");
  assert.equal(homeState.fixtureHref, "/__preview/i07-fixture.html");
  await shot("preview-home-desktop.png");

  // 2. Navigate to live Hosted Preview I07 Fixture and execute interactive checks
  const navRes = await page.send("Page.navigate", { url: `${previewUrl}/__preview/i07-fixture.html` });
  if (navRes.errorText) throw new Error(navRes.errorText);
  await page.waitFor("document.documentElement.getAttribute('data-aeris-motion-ready') === 'true'", 20000);
  await settle();
  await shot("preview-fixture-desktop-light.png");

  // FLIP Down & Up
  await page.click('[data-flip-down="card-1"]');
  await delay(90);
  const flipMidDown = await page.evaluate("getComputedStyle(document.querySelector('[data-flip-key=\"card-1\"]')).transform");
  await delay(420);
  await page.click('[data-flip-up="card-3"]');
  await delay(90);
  const flipMidUp = await page.evaluate("getComputedStyle(document.querySelector('[data-flip-key=\"card-3\"]')).transform");
  await delay(420);
  assert.notEqual(flipMidDown, "none");
  assert.notEqual(flipMidUp, "none");

  // Toast 5-burst
  await page.click("#btnToastBurst5");
  await delay(100);
  const toastSnap = await page.evaluate("window.__i07FixtureTelemetry().toast");
  assert.equal(toastSnap.visible.length, 2);
  assert.equal(toastSnap.queued.length, 3);
  await shot("preview-fixture-toast-burst.png", false);
  await page.click("#btnToastClear");
  await delay(240);

  // Scroll 3D & Bento seam lock
  const stageTop = await page.evaluate("document.getElementById('secScrollBento').getBoundingClientRect().top + window.scrollY - 680");
  await page.evaluate(`window.scrollTo({ top: ${Math.max(0, Math.round(stageTop))}, behavior: 'instant' })`);
  await settle();
  const scrollBefore = await page.evaluate("getComputedStyle(document.getElementById('fixtureScroll3dCard')).transform");
  for (let i = 0; i < 4; i += 1) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: 220 });
    await delay(80);
  }
  await settle();
  const scrollAfter = await page.evaluate("getComputedStyle(document.getElementById('fixtureScroll3dCard')).transform");
  assert.notEqual(scrollBefore, scrollAfter);
  await shot("preview-fixture-scroll-bento.png");

  // Mobile 375px Drawer swipe-dismiss + Dark mode
  await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await page.click("#fixtureThemeBtn");
  await settle();
  await page.click("#btnOpenFormSheet");
  await delay(280);
  assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').dataset.sheetMode"), "drawer");
  await shot("preview-fixture-mobile-drawer-dark.png");

  const pt = await page.evaluate("(() => { const r = document.querySelector('#fixtureSheetModal .ds-sheet-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()");
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y }] });
  await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x, y: pt.y + 230 }] });
  await delay(60);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(280);
  assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').classList.contains('hidden')"), true);

  const finalTel = await page.evaluate("window.__i07FixtureTelemetry()");
  assert.equal(finalTel.maxSeamDrift, 0);
  assert.deepEqual(page.runtimeErrors, [], `Preview runtime errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(failedRequests, [], `Preview HTTP/network failures: ${JSON.stringify(failedRequests)}`);

  const summary = {
    status: "PASS",
    previewUrl,
    homeState,
    flipMidDown,
    flipMidUp,
    toastSnap,
    scrollBefore,
    scrollAfter,
    maxSeamDrift: finalTel.maxSeamDrift,
    failedRequests,
    runtimeErrors: page.runtimeErrors,
    screenshots: [
      "preview-home-desktop.png",
      "preview-fixture-desktop-light.png",
      "preview-fixture-toast-burst.png",
      "preview-fixture-scroll-bento.png",
      "preview-fixture-mobile-drawer-dark.png",
    ],
  };
  await writeFile(path.join(outDir, "preview-report.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  if (page) await page.close().catch(() => {});
  child.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
