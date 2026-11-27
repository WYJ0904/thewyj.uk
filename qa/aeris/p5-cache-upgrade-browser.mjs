import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ASSET_RELEASE } from "../asset-release.mjs";
import { CdpClient, delay } from "../../local-backend/browser_harness.mjs";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OLD_P5_REF = "84ca52090670a14bc48f1c3cd3eb76248747f441";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const normSha256 = (buf) => createHash("sha256").update(Buffer.from(buf).toString("utf8").replace(/\r\n?/g, "\n")).digest("hex");

function loadGitFiles(ref) {
  const list = execFileSync("git", ["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", ref], {
    cwd: ROOT,
    maxBuffer: 30 * 1024 * 1024,
  })
    .toString("utf8")
    .trim()
    .split(/\r?\n/)
    .filter((p) => p && isAllowedPagesFile(p) && !p.startsWith("functions/"));
  const map = new Map();
  for (const file of list) {
    map.set(file, execFileSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, maxBuffer: 30 * 1024 * 1024 }));
  }
  return map;
}

async function loadWorktreeFiles() {
  const list = execFileSync("git", ["-c", "core.quotepath=false", "ls-files"], { cwd: ROOT, maxBuffer: 30 * 1024 * 1024 })
    .toString("utf8")
    .trim()
    .split(/\r?\n/)
    .filter((p) => p && isAllowedPagesFile(p) && !p.startsWith("functions/"));
  const map = new Map();
  for (const file of list) {
    map.set(file, await fs.readFile(path.join(ROOT, file)));
  }
  return map;
}

const mimeFor = (file) => {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
};

const filesOldP5 = loadGitFiles(OLD_P5_REF);
const filesCurrent = await loadWorktreeFiles();
let activeFiles = filesOldP5;
let staleCssOverride = false;

const accountObj = {
  id: "usr_p5_upgrade_01",
  username: "p5_upgrade_user",
  role: "member",
  policy_version: "2026-11-16",
  terms_version: "2026-11-16",
  privacy_version: "2026-11-16",
  entitlements: ["tools_access", "tools_batch_access", "save_tool_config"],
  memberships: [{ plan_code: "all_access_lifetime", status: "active", is_lifetime: 1 }],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname.startsWith("/api/")) {
    const json = (obj, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === "/api/status") return json({ ok: true, mode: "cloud", environment: "preview", cloud: { enabled: true, reads: true, writes: true }, capabilities: { tools: true, workflows: true } });
    if (url.pathname === "/api/ui/features") {
      return json({
        ok: true,
        public_ui: {
          schema_version: 1,
          flag_key: "p07_accessibility",
          enabled: true,
          revision: 56,
          reason: "public_stable",
          observed_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30000).toISOString(),
          max_age_seconds: 30,
        },
      });
    }
    if (url.pathname === "/api/features/me") {
      return json({ ok: true, features: { p07_accessibility: { enabled: true } }, flags: [{ flag_key: "p07_accessibility", enabled: true }] });
    }
    if (url.pathname === "/api/health") return json({ ok: true, model: "Cloudflare", ai_ready: true, account: accountObj });
    if (url.pathname === "/api/policies") return json({ ok: true, current_version: "2026-11-16", versions: { terms: "2026-11-16", privacy: "2026-11-16" } });
    if (url.pathname === "/api/changelog") return json({ ok: true, entries: [] });
    if (url.pathname === "/api/login") return json({ ok: true, session: "p5-upgrade-session", model: "Cloudflare account", account: accountObj });
    if (url.pathname === "/api/me") return json({ ok: true, account: accountObj });
    if (url.pathname === "/api/tools/preferences") return json({ ok: true, favorites: [], recents: [], configs: [] });
    if (url.pathname === "/api/learning/sync") return json({ ok: true, server_version: 1, records: [] });
    if (url.pathname === "/api/messages/pending") return json({ ok: true, messages: [] });
    return json({ ok: true });
  }

  if (url.pathname === "/index.html") {
    res.writeHead(308, { Location: "/", "Cache-Control": "no-cache, must-revalidate, no-transform" });
    res.end();
    return;
  }
  let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!activeFiles.has(file) && String(req.headers.accept || "").includes("text/html")) file = "index.html";
  const bytes = activeFiles.get(file);
  if (!bytes) {
    console.error("404 MISSING FILE:", req.url, "-> file:", file);
    res.writeHead(404);
    res.end("not found");
    return;
  }
  let serveBytes = bytes;
  if (staleCssOverride && file === "spatial-experience.css") {
    serveBytes = filesOldP5.get("spatial-experience.css");
  }
  const etag = `"${sha256(serveBytes).slice(0, 32)}"`;
  if (file === "sw.js") {
    res.writeHead(200, { "Content-Type": mimeFor(file), "Cache-Control": "no-cache, no-store, must-revalidate", ETag: etag });
    res.end(serveBytes);
    return;
  }
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  const cc = file === "index.html"
    ? (activeFiles === filesCurrent ? "no-cache, no-store, must-revalidate, no-transform" : "public, max-age=0, must-revalidate, no-transform")
    : "public, max-age=0, must-revalidate";
  res.writeHead(200, { "Content-Type": mimeFor(file), "Cache-Control": cc, ETag: etag });
  res.end(serveBytes);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profile = path.join(os.tmpdir(), "aeris-p5u-" + Date.now());
await fs.mkdir(profile, { recursive: true });
const chromeBin = process.env.CHROME_BIN || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe") : "google-chrome");

async function launchChrome(userDataDir) {
  await fs.rm(path.join(userDataDir, "DevToolsActivePort"), { force: true }).catch(() => {});
  const child = spawn(chromeBin, [
    "--headless=new",
    ...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let port = "";
  const deadline = Date.now() + 20_000;
  while (!port && Date.now() < deadline) {
    try { port = (await fs.readFile(path.join(userDataDir, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0].trim(); } catch {}
    if (!port) await delay(100);
  }
  assert.ok(port, "Chrome DevToolsActivePort must become available");
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  const targets = await client.send("Target.getTargets");
  let targetId = targets.targetInfos.find((t) => t.type === "page")?.targetId;
  if (!targetId) targetId = (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  client.listeners.add((m) => {
    if (m.method === "ServiceWorker.workerErrorReported") console.error("SW ERROR:", m.params);
  });
  const send = (m, p = {}) => client.send(m, p, sessionId);
  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Network.enable"), send("ServiceWorker.enable")]);
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const waitFor = async (cond, ms = 25_000, label = cond) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await evaluate(`(async () => Boolean(${cond}))()`)) return true; } catch {}
      await delay(100);
    }
    const snap = await evaluate(`(async () => ({
      path: location.pathname,
      controller: navigator.serviceWorker.controller?.scriptURL || null,
      caches: await caches.keys(),
      regs: await navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => ({ scope: r.scope, active: r.active?.scriptURL, waiting: r.waiting?.scriptURL, installing: r.installing?.scriptURL })))
    }))()`).catch(() => ({}));
    throw new Error(`timeout waiting for ${label}: ${JSON.stringify(snap)}`);
  };
  return {
    child,
    send,
    evaluate,
    waitFor,
    close: async () => {
      await client.send("Browser.close").catch(() => {});
      await delay(300);
      client.close();
      if (child.exitCode === null) child.kill();
      await delay(400);
    },
  };
}

let session;
const staleProfile = path.join(os.tmpdir(), "aeris-p5s-" + Date.now());
await fs.mkdir(staleProfile, { recursive: true });

try {
  // 1. Visit Old P5 (84ca5209) with real HTTP cache + SW enabled
  session = await launchChrome(profile);
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await session.send("Page.navigate", { url: baseUrl + "/login" });
  await session.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready' && document.querySelector('#loginForm')");
  await session.evaluate(`(() => {
    localStorage.setItem('wyjUserRetainedMarker', 'keep-user-data');
    document.querySelector('#usernameInput').value = 'p5_upgrade_user';
    document.querySelector('#usernameInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#secretInput').value = 'Pass1234!';
    document.querySelector('#secretInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#loginSubmitBtn').click();
    return true;
  })()`);
  await session.waitFor("location.pathname === '/' && !document.querySelector('#publicHome')?.classList.contains('hidden')");
  await session.send("Page.navigate", { url: baseUrl + "/tools/workflows" });
  await session.waitFor("window.WYJWorkflows && !document.getElementById('workflowWorkspace')?.classList.contains('hidden')");
  await session.waitFor("Boolean(navigator.serviceWorker.controller)");
  await session.waitFor("(await caches.keys()).some(k => k.includes('task26'))");
  await session.close();
  session = null;

  // 2. Upgrade server to current build without clearing Chrome profile, cache, or storage
  activeFiles = filesCurrent;
  session = await launchChrome(profile);
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await session.send("Page.navigate", { url: baseUrl + "/" });
  await session.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'");
  await session.waitFor(`navigator.serviceWorker.controller?.scriptURL?.includes(${JSON.stringify(ASSET_RELEASE)})`, 30_000, "new SW controller active");

  if (await session.evaluate("document.querySelector('#publicHome')?.dataset.sessionMode !== 'authenticated'")) {
    await session.send("Page.navigate", { url: baseUrl + "/login" });
    await session.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready' && document.querySelector('#loginForm')");
    await session.evaluate(`(() => {
      document.querySelector('#usernameInput').value = 'p5_upgrade_user';
      document.querySelector('#usernameInput').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#secretInput').value = 'Pass1234!';
      document.querySelector('#secretInput').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#loginSubmitBtn').click();
      return true;
    })()`);
    await session.waitFor("location.pathname === '/' && !document.querySelector('#publicHome')?.classList.contains('hidden')");
  }

  await session.evaluate("document.querySelector('[data-v3-nav=\"workflows\"]')?.click(); true;");
  await session.waitFor("window.WYJWorkflows && !document.getElementById('workflowWorkspace')?.classList.contains('hidden')");
  await session.evaluate("document.querySelector('[data-workflow-template=\"text-clean\"]')?.click(); true;");
  await session.waitFor("document.querySelectorAll('#workflowStepList > li').length === 4");
  await delay(300);

  const upgradeState = await session.evaluate(`(async () => {
    const list = document.getElementById('workflowStepList');
    const step = list?.querySelector('li');
    const svg = step?.querySelector('.wf-node-trace-svg');
    const rect = step?.querySelector('.wf-node-trace-rect');
    const appScript = document.querySelector('script[src*="/app.js"]')?.src || '';
    const cssLink = [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => l.href.includes('spatial-experience.css'))?.href || '';
    const cssText = await fetch('/spatial-experience.css?release=${ASSET_RELEASE}').then(r => r.text());
    const jsText = await fetch('/workflows.js?release=${ASSET_RELEASE}').then(r => r.text());
    const enc = new TextEncoder();
    const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s.replace(/\\r\\n?/g, '\\n'))))].map(b => b.toString(16).padStart(2, '0')).join('');
    return {
      retainedMarker: localStorage.getItem('wyjUserRetainedMarker'),
      controller: navigator.serviceWorker.controller?.scriptURL,
      appScript,
      cssLink,
      cssSha: await sha(cssText),
      jsSha: await sha(jsText),
      listDisplay: getComputedStyle(list).display,
      listFlexDir: getComputedStyle(list).flexDirection,
      svgPos: svg ? getComputedStyle(svg).position : null,
      rectFill: rect ? getComputedStyle(rect).fill : null,
      rectOpacity: rect ? getComputedStyle(rect).opacity : null,
      firstStepRect: step.getBoundingClientRect().toJSON(),
      secondStepRect: list.querySelectorAll('li')[1].getBoundingClientRect().toJSON(),
      editorHidden: document.getElementById('workflowEditor')?.classList.contains('hidden'),
      p07Ui: document.documentElement.dataset.p07Ui,
    };
  })()`);

  assert.equal(upgradeState.retainedMarker, "keep-user-data");
  assert.ok(upgradeState.controller.includes(ASSET_RELEASE));
  assert.ok(upgradeState.appScript.includes(ASSET_RELEASE));
  assert.ok(upgradeState.cssLink.includes(ASSET_RELEASE));
  assert.equal(upgradeState.cssSha, normSha256(filesCurrent.get("spatial-experience.css")));
  assert.equal(upgradeState.jsSha, normSha256(filesCurrent.get("workflows.js")));
  assert.equal(upgradeState.listDisplay, "flex", JSON.stringify(upgradeState));
  assert.equal(upgradeState.listFlexDir, "row", JSON.stringify(upgradeState));
  assert.ok(upgradeState.secondStepRect.left > upgradeState.firstStepRect.right, "desktop nodes must be horizontal: " + JSON.stringify(upgradeState));
  assert.equal(upgradeState.svgPos, "absolute");
  assert.equal(upgradeState.rectFill, "none");
  assert.equal(upgradeState.rectOpacity, "0");

  // Verify unrestricted 2D free drag (>200px X & Y), reorder without center snap, mobile non-clobbering, and reload persistence.
  const dragStep2 = await session.evaluate(`(() => {
    const h = document.querySelector('#workflowStepList li:nth-child(2) [data-wf-drag-handle]');
    const r = h.getBoundingClientRect();
    return { id: document.querySelector('#workflowStepList li:nth-child(2)').dataset.stepId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragStep2.x, y: dragStep2.y });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragStep2.x, y: dragStep2.y, button: "left", clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragStep2.x + 220, y: dragStep2.y - 190, button: "left" });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragStep2.x + 220, y: dragStep2.y - 190, button: "left", clickCount: 1 });
  await delay(300);

  // Also drag last node outward (+260px right, +140px down).
  const dragLast = await session.evaluate(`(() => {
    const items = document.querySelectorAll('#workflowStepList > li');
    const last = items[items.length - 1];
    const h = last.querySelector('[data-wf-drag-handle]');
    const r = h.getBoundingClientRect();
    return { id: last.dataset.stepId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragLast.x, y: dragLast.y });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragLast.x, y: dragLast.y, button: "left", clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragLast.x + 260, y: dragLast.y + 140, button: "left" });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragLast.x + 260, y: dragLast.y + 140, button: "left", clickCount: 1 });
  await delay(300);

  const offsetsBeforeMobile = await session.evaluate("window.WYJWorkflows.test.nodeOffsets()");
  assert.ok(offsetsBeforeMobile[dragStep2.id] && Math.abs(offsetsBeforeMobile[dragStep2.id].y) > 120, `expected >120px Y offset, got ${JSON.stringify(offsetsBeforeMobile)}`);
  assert.ok(offsetsBeforeMobile[dragLast.id] && offsetsBeforeMobile[dragLast.id].x > 200 && offsetsBeforeMobile[dragLast.id].y > 100, `expected large outward X/Y offset, got ${JSON.stringify(offsetsBeforeMobile)}`);

  // Fit canvas to view should include far nodes, and mobile resize must NOT wipe stored desktop offsets.
  await session.evaluate("document.querySelector('#canvasFitViewBtn')?.click(); true;");
  await delay(350);
  await session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(200);
  const offsetsOnMobile = await session.evaluate("window.WYJWorkflows.test.nodeOffsets()");
  assert.deepEqual(offsetsOnMobile, offsetsBeforeMobile, "mobile view must not overwrite desktop offsets");
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(250);

  // Reload and verify coordinates survive cache reload.
  await session.send("Page.reload", { ignoreCache: false });
  await session.waitFor("window.WYJWorkflows && !document.getElementById('workflowWorkspace')?.classList.contains('hidden')");
  await session.evaluate("(() => { const w = window.WYJWorkflows.test.workflows()[0]; if (w) window.WYJWorkflows.test.openWorkflow(w.id); return true; })()");
  await session.waitFor("document.querySelectorAll('#workflowStepList > li').length === 4");
  const offsetsAfterReload = await session.evaluate("window.WYJWorkflows.test.nodeOffsets()");
  assert.deepEqual(offsetsAfterReload, offsetsBeforeMobile, "desktop offsets must persist across reload");

  // Verify unified file queue, instant 21-image validation, no-ZIP image multi-select, per-item removal, and workflow isolation!
  const fileQaResult = await session.evaluate(`(async () => {
    const imgIcon = await fetch('/icon-192.png').then(r => r.blob());
    document.querySelector('#workflowBackToListBtn')?.click();
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('[data-workflow-template="image-publish"]')?.click();
    await new Promise(r => setTimeout(r, 120));
    const imgWf = window.WYJWorkflows.test.selectedWorkflow();
    document.querySelector('#toggleWorkflowRunnerBtn')?.click();
    await new Promise(r => setTimeout(r, 80));

    const inputEl = document.getElementById('workflowFileInput');
    const policyImg = window.WYJWorkflows.test.inputPolicy();
    const hintText = document.getElementById('workflowInputHint')?.textContent || '';

    // Attempt 21 PNGs drop -> immediately blocked from queuedFiles with instant validation alert.
    const dropWrap = document.getElementById('workflowFileInputWrap');
    const dt21 = new DataTransfer();
    for (let i = 0; i < 21; i += 1) {
      dt21.items.add(new File([imgIcon], 'batch-' + String(i + 1).padStart(2, '0') + '.png', { type: 'image/png' }));
    }
    dropWrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt21 }));
    await new Promise(r => setTimeout(r, 80));
    const after21 = {
      queued: window.WYJWorkflows.test.queuedFiles().length,
      rejected: window.WYJWorkflows.test.rejectedFiles().length,
      alertText: document.getElementById('workflowInputValidation')?.textContent || '',
    };

    // Remove 1st rejected item -> remaining 20 promote to ready queue automatically!
    document.querySelector('[data-wf-remove-rejected="0"]')?.click();
    await new Promise(r => setTimeout(r, 80));
    const afterRemoveExcess = {
      queued: window.WYJWorkflows.test.queuedFiles().length,
      rejected: window.WYJWorkflows.test.rejectedFiles().length,
      renderedRows: document.querySelectorAll('#workflowReadyFileList > li').length,
    };

    // Remove first, middle, last items individually.
    document.querySelector('[data-wf-remove-file="0"]')?.click();
    document.querySelector('[data-wf-remove-file="9"]')?.click();
    const lastIdx = document.querySelectorAll('[data-wf-remove-file]').length - 1;
    document.querySelector('[data-wf-remove-file="' + lastIdx + '"]')?.click();
    await new Promise(r => setTimeout(r, 60));
    const afterIndividualRemove = window.WYJWorkflows.test.queuedFiles().length;

    // Clear and test initial + append drop (2 + 1 = 3).
    document.getElementById('clearWorkflowFilesBtn')?.click();
    const dt2 = new DataTransfer();
    dt2.items.add(new File([imgIcon], 'a.png', { type: 'image/png' }));
    dt2.items.add(new File([imgIcon], 'b.png', { type: 'image/png' }));
    dropWrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
    const dt1 = new DataTransfer();
    dt1.items.add(new File([imgIcon], 'c.png', { type: 'image/png' }));
    dropWrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt1 }));
    await new Promise(r => setTimeout(r, 60));
    const imgQueuedNames = window.WYJWorkflows.test.queuedFiles().map(f => f.name);

    // Switch to text-clean -> ensure image queue does NOT leak!
    const textWf = window.WYJWorkflows.test.workflows().find(w => w.steps.some(s => s.tool_id === 'text-encoding'));
    window.WYJWorkflows.test.openWorkflow(textWf.id, { openRunner: true });
    await new Promise(r => setTimeout(r, 80));
    const textPolicy = window.WYJWorkflows.test.inputPolicy();
    const textQueuedCount = window.WYJWorkflows.test.queuedFiles().length;

    // Switch back to image-publish -> ensure its 3 images are retained within session!
    window.WYJWorkflows.test.openWorkflow(imgWf.id, { openRunner: true });
    await new Promise(r => setTimeout(r, 80));
    const restoredImgNames = window.WYJWorkflows.test.queuedFiles().map(f => f.name);

    return {
      multiple: inputEl.multiple,
      policyImgMax: policyImg.maxFiles,
      hintText,
      after21,
      afterRemoveExcess,
      afterIndividualRemove,
      imgQueuedNames,
      textPolicyMax: textPolicy.maxFiles,
      textMultiple: textPolicy.multiple,
      textQueuedCount,
      restoredImgNames,
    };
  })()`);

  assert.equal(fileQaResult.multiple, true);
  assert.equal(fileQaResult.policyImgMax, 20);
  assert.ok(fileQaResult.hintText.includes("20") && !fileQaResult.hintText.includes("50 个"), fileQaResult.hintText);
  assert.equal(fileQaResult.after21.queued, 0);
  assert.equal(fileQaResult.after21.rejected, 21);
  assert.ok(fileQaResult.after21.alertText.includes("20") && fileQaResult.after21.alertText.includes("1"));
  assert.equal(fileQaResult.afterRemoveExcess.queued, 20);
  assert.equal(fileQaResult.afterRemoveExcess.rejected, 0);
  assert.equal(fileQaResult.afterRemoveExcess.renderedRows, 20);
  assert.equal(fileQaResult.afterIndividualRemove, 17);
  assert.deepEqual(fileQaResult.imgQueuedNames, ["a.png", "b.png", "c.png"]);
  assert.equal(fileQaResult.textPolicyMax, 1);
  assert.equal(fileQaResult.textMultiple, false);
  assert.equal(fileQaResult.textQueuedCount, 0);
  assert.deepEqual(fileQaResult.restoredImgNames, ["a.png", "b.png", "c.png"]);

  const offsets = offsetsAfterReload;

  await session.close();
  session = null;

  // 3. Synthetic stale/missing CSS fallback: verify SVG collapses to 0x0 and fill is never black
  staleCssOverride = true;
  session = await launchChrome(staleProfile);
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await session.send("Page.navigate", { url: baseUrl + "/login" });
  await session.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready' && document.querySelector('#loginForm')");
  await session.evaluate(`(() => {
    document.querySelector('#usernameInput').value = 'p5_upgrade_user';
    document.querySelector('#usernameInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#secretInput').value = 'Pass1234!';
    document.querySelector('#secretInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#loginSubmitBtn').click();
    return true;
  })()`);
  await session.waitFor("location.pathname === '/' && !document.querySelector('#publicHome')?.classList.contains('hidden')");
  await session.send("Page.navigate", { url: baseUrl + "/tools/workflows" });
  await session.waitFor("window.WYJWorkflows && !document.getElementById('workflowWorkspace')?.classList.contains('hidden')");
  await session.evaluate("document.querySelector('[data-workflow-template=\"text-clean\"]')?.click(); true;");
  await session.waitFor("document.querySelectorAll('#workflowStepList > li').length === 4");
  const fallbackDiag = await session.evaluate(`(() => {
    const svg = document.querySelector('#workflowStepList .wf-node-trace-svg');
    const rect = document.querySelector('#workflowStepList .wf-node-trace-rect');
    const r = svg.getBoundingClientRect();
    return {
      svgWidth: r.width,
      svgHeight: r.height,
      rectFill: getComputedStyle(rect).fill,
      rectOpacity: getComputedStyle(rect).opacity,
    };
  })()`);
  assert.equal(fallbackDiag.svgWidth, 0);
  assert.equal(fallbackDiag.svgHeight, 0);
  assert.equal(fallbackDiag.rectFill, "none");
  assert.equal(fallbackDiag.rectOpacity, "0");

  console.log(JSON.stringify({
    status: "PASS",
    release: ASSET_RELEASE,
    upgradeState: {
      listDisplay: upgradeState.listDisplay,
      listFlexDir: upgradeState.listFlexDir,
      svgPos: upgradeState.svgPos,
      rectFill: upgradeState.rectFill,
      persistedOffsets: Object.keys(offsets).length,
    },
    staleCssFallback: fallbackDiag,
  }, null, 2));
} finally {
  if (session) await session.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  await fs.rm(staleProfile, { recursive: true, force: true }).catch(() => {});
}
