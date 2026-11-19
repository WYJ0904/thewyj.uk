import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";

const previewUrl = process.env.I02_PREVIEW_URL || "https://i02-css-component-foundation.thewyj-p07-ui-rc.pages.dev";
const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "docs", "ui-rebuild", "i02", "evidence", "preview");
await mkdir(outDir, { recursive: true });

const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i02-preview-"));
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
      if (r && r.status >= 400) {
        failedRequests.push({ url: r.url, status: r.status });
      }
    }
    if (msg.method === "Network.loadingFailed" && !msg.params?.canceled) {
      failedRequests.push({ url: msg.params?.requestId, error: msg.params?.errorText });
    }
  });

  const settle = () => page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  const setTheme = async (target) => {
    for (let i = 0; i < 4; i += 1) {
      if ((await page.evaluate("document.documentElement.dataset.themePreference")) === target) break;
      await page.click("#themeToggleBtn");
      await delay(80);
    }
    await settle();
    assert.equal(await page.evaluate("document.documentElement.dataset.theme"), target);
  };
  const shot = async (name) => {
    await settle();
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(outDir, name), Buffer.from(data, "base64"));
  };

  await page.navigate("/");
  await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
  await settle();

  const homeState = await page.evaluate("({ p07Ui: document.documentElement.dataset.p07Ui, policy: document.documentElement.dataset.interfacePolicy, release: document.querySelector('link[rel=stylesheet]')?.href || '' })");

  await setTheme("light");
  const lightBtn = await page.evaluate("({ bg: getComputedStyle(document.querySelector('#publicLoginBtn')).backgroundColor, color: getComputedStyle(document.querySelector('#publicLoginBtn')).color, overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth) })");
  assert.equal(lightBtn.bg, "rgb(17, 17, 19)");
  assert.equal(lightBtn.color, "rgb(255, 255, 255)");
  assert.ok(lightBtn.overflowX <= 1);
  await shot("preview-desktop-1440-light.png");

  await setTheme("dark");
  const darkBtn = await page.evaluate("({ bg: getComputedStyle(document.querySelector('#publicLoginBtn')).backgroundColor, color: getComputedStyle(document.querySelector('#publicLoginBtn')).color, overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth) })");
  assert.equal(darkBtn.bg, "rgb(248, 250, 252)");
  assert.equal(darkBtn.color, "rgb(17, 17, 19)");
  assert.ok(darkBtn.overflowX <= 1);
  await shot("preview-desktop-1440-dark.png");

  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await setTheme("light");
  const mobLightOverflow = await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)");
  assert.ok(mobLightOverflow <= 1);
  await shot("preview-mobile-390-light.png");

  await setTheme("dark");
  const mobDarkOverflow = await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)");
  assert.ok(mobDarkOverflow <= 1);
  await shot("preview-mobile-390-dark.png");

  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await setTheme("light");

  await page.navigate("/login");
  await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#loginForm')?.checkVisibility()", 20000);
  await shot("preview-login.png");

  await page.navigate("/download");
  await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#downloadMainBtn')?.checkVisibility()", 20000);
  const downloadPrimaryBg = await page.evaluate("getComputedStyle(document.querySelector('#downloadMainBtn')).backgroundColor");
  assert.equal(downloadPrimaryBg, "rgb(17, 17, 19)");
  await shot("preview-download.png");

  await page.navigate("/changelog");
  await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#changelogView, #changelogPage, main')?.checkVisibility()", 20000);
  const changelogOverflow = await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)");
  assert.ok(changelogOverflow <= 1);

  assert.deepEqual(page.runtimeErrors, [], `Preview runtime errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(failedRequests, [], `Preview HTTP/network failures: ${JSON.stringify(failedRequests)}`);

  const summary = {
    status: "PASS",
    previewUrl,
    homeState,
    lightBtn,
    darkBtn,
    mobLightOverflow,
    mobDarkOverflow,
    downloadPrimaryBg,
    changelogOverflow,
    failedRequests,
    runtimeErrors: page.runtimeErrors,
    screenshots: [
      "preview-desktop-1440-light.png",
      "preview-desktop-1440-dark.png",
      "preview-mobile-390-light.png",
      "preview-mobile-390-dark.png",
      "preview-login.png",
      "preview-download.png",
    ],
  };
  await writeFile(path.join(outDir, "preview-report.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  if (page) await page.close().catch(() => {});
  child.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
