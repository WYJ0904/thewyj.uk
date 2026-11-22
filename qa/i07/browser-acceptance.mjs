import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";
import { onRequest } from "../../functions/api/[[path]].js";
import { onRequest as status } from "../../functions/api/status.js";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i07", "evidence");
await mkdir(evidenceDir, { recursive: true });

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i07 fixture'); } }",
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
});

const db = await mf.getD1Database("WYJ_DB");
const storage = await mf.getR2Bucket("WYJ_STORAGE");
const env = {
  ...config.env.preview.vars,
  WYJ_DB: db,
  WYJ_STORAGE: storage,
  WYJ_ENVIRONMENT: "development",
  WORKERS_AI_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "false",
  TTS_MODE: "cache-only",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  TASK22_TRANSFER_READS_ENABLED: "true",
  TASK22_TRANSFER_WRITES_ENABLED: "true",
  TASK25_FEATURE_FLAGS_ENABLED: "true",
  TASK26_ADAPTIVE_LEARNING_ENABLED: "true",
  TASK27_SECURITY_ENABLED: "true",
  TASK29_BACKUP_ENABLED: "true",
  TASK30_PRIVACY_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: "i07-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i07-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i07-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-I07-Browser-Password!";
const now = new Date().toISOString();
const nowMs = Date.now();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I07 browser acceptance public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i07-seed', 'i07-seed')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();

const adminId = "i07-browser-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i07admin', 'i07admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();
await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
  VALUES ('mem_i07_001', ?1, 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i07-fixture', ?1, '{}', ?2, ?2)`)
  .bind(adminId, now).run();
await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_i07_inc', ?1, '合成收入', 'income', '#0f766e', 'active', 1, 1, ?2, ?2, '')`)
  .bind(adminId, now).run();
await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('tx_i07_0001', ?1, 'income', 500000, 'CNY', 'cat_i07_inc', 'Synthetic Payroll', '', 'I07 fixture row', ?2, 'manual', 'confirmed', 'active', 1, 1, ?3, ?3, '')`)
  .bind(adminId, nowMs, now).run();

const memberId = "i07-browser-member";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i07member', 'i07member', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3)`)
  .bind(memberId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(memberId, now).run();

const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
const spaRoutes = new Set([
  "/", "/login", "/register", "/download", "/changelog", "/trial",
  "/transfer", "/select", "/account", "/finance", "/tools", "/language", "/admin",
]);
const previewFiles = new Map([
  ["/__preview/i07-fixture.html", path.join(root, "qa/i07/fixture.html")],
  ["/__preview/i07-fixture.css", path.join(root, "qa/i07/fixture.css")],
  ["/__preview/i07-fixture.js", path.join(root, "qa/i07/fixture.js")],
]);
const mimeFor = (file) => (
  file.endsWith(".js") || file.endsWith(".mjs") ? "text/javascript"
    : file.endsWith(".css") ? "text/css"
    : file.endsWith(".html") ? "text/html"
    : file.endsWith(".png") ? "image/png"
    : file.endsWith(".ico") ? "image/x-icon"
    : file.endsWith(".webmanifest") ? "application/manifest+json"
    : "application/octet-stream"
);

let base;
const apiErrors = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const tasks = [];
      const context = {
        request: new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        }),
        env,
        data: { requestId: crypto.randomUUID() },
        waitUntil(p) { tasks.push(p); },
      };
      const response = await (url.pathname === "/api/status" ? status : onRequest)(context);
      if (response.status >= 500) apiErrors.push({ path: url.pathname, status: response.status });
      const headersOut = Object.fromEntries(response.headers);
      const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      if (setCookies.length) headersOut["set-cookie"] = setCookies;
      res.writeHead(response.status, headersOut);
      res.end(Buffer.from(await response.arrayBuffer()));
      await Promise.all(tasks);
      return;
    }
    if (previewFiles.has(url.pathname)) {
      const targetPath = previewFiles.get(url.pathname);
      res.writeHead(200, {
        "Content-Type": mimeFor(targetPath),
        "Content-Security-Policy": csp,
        "Cache-Control": "no-store",
      });
      res.end(await readFile(targetPath));
      return;
    }
    const file = spaRoutes.has(url.pathname) ? "index.html" : url.pathname.slice(1);
    if (!isAllowedPagesFile(file) || file.startsWith("functions/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeFor(file),
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    });
    res.end(await readFile(path.join(root, file)));
  } catch (error) {
    res.writeHead(500);
    res.end("fixture error");
    console.error(error);
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i07-chrome-"));
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
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const report = {
  scope: "Isolated Miniflare D1/R2 + real headless Chrome CDP",
  gitSha,
  browserVersion: "",
  scenarios: [],
  axeScans: [],
  viewportMatrix: [],
  performance: {},
  screenshots: [],
  android_physical_device: "NOT_TESTED — NOT REQUIRED FOR I07 WEB ACCEPTANCE",
  production_release: "NOT_TOUCHED",
};

let page;
async function settle() {
  await page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
}

async function setViewport(width, height = 900, mobile = width <= 500) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  await settle();
}

async function shot(name, waitSettle = true) {
  if (waitSettle) await settle();
  const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
  report.screenshots.push(name);
  return name;
}

async function dispatchKey(key, code = key, modifiers = 0) {
  const keyCode = key === "Tab" ? 9 : key === "Escape" ? 27 : key === "Enter" ? 13 : key === " " ? 32 : key === "ArrowUp" ? 38 : key === "ArrowDown" ? 40 : key === "ArrowRight" ? 39 : key === "ArrowLeft" ? 37 : 0;
  for (const type of ["keyDown", "keyUp"]) {
    await page.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      ...(key === " " && type === "keyDown" ? { text: " " } : {}),
      ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}),
    });
  }
}

async function runAxe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, sample: v.nodes[0]?.failureSummary, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
  report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
  assert.equal(res.violations.length, 0, `axe violations on ${label}: ${JSON.stringify(res.violations)}`);
}

async function recordScenario(name, fn) {
  const detail = await fn();
  report.scenarios.push({ name, status: "PASS", detail });
  console.log(`PASS scenario: ${name}`);
}

async function openFixture() {
  const res = await page.send("Page.navigate", { url: `${base}/__preview/i07-fixture.html` });
  if (res.errorText) throw new Error(res.errorText);
  await page.waitFor("document.documentElement.getAttribute('data-aeris-motion-ready') === 'true'", 15000);
  await settle();
}

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
  console.log("[i07] Chrome port:", port);
  const cdpUrl = `http://127.0.0.1:${port}`;
  const versionInfo = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
  report.browserVersion = versionInfo.Browser || "Chrome";
  console.log("[i07] Opening page...");
  page = await openPage({ cdpUrl, baseUrl: base, width: 1440, height: 900, mobile: false });
  console.log("[i07] Navigating to fixture...");
  await openFixture();
  console.log("[i07] Running axe...");
  await runAxe("fixture-desktop-light");
  console.log("[i07] Capturing initial screenshot...");
  await shot("fixture-desktop-1440-light.png");

  await recordScenario("controls-buttons-switch-form", async () => {
    await page.evaluate("document.getElementById('btnPrimaryTap').scrollIntoView({ block: 'center' })");
    await settle();
    // Press/release with real mouse pointer
    const btnBox = await page.evaluate("(() => { const r = document.getElementById('btnPrimaryTap').getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), hitId: hit?.id, hitTag: hit?.tagName }; })()");
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: btnBox.x, y: btnBox.y });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: btnBox.x, y: btnBox.y, button: "left", buttons: 1, clickCount: 1 });
    await delay(30);
    const pressedAttr = await page.evaluate("document.getElementById('btnPrimaryTap').getAttribute('data-aeris-pressed')");
    assert.equal(pressedAttr, "true", `button should mark data-aeris-pressed during press (box=${JSON.stringify(btnBox)})`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: btnBox.x, y: btnBox.y, button: "left", buttons: 0, clickCount: 1 });
    await delay(120);
    assert.equal(await page.evaluate("document.getElementById('btnPrimaryTap').getAttribute('data-aeris-pressed')"), null);

    // Simulated async fail button must set error state, NOT success
    await page.click("#btnAsyncFail");
    await delay(300);
    assert.equal(await page.evaluate("document.getElementById('btnAsyncFail').getAttribute('data-feedback-state')"), "error");

    // A1: Switch geometry containment & keyboard Space toggle across unchecked/checked
    const assertSwitchContainment = async (label) => {
      const checks = await page.evaluate(`(() => {
        const list = [...document.querySelectorAll('.switch')];
        return list.map((sw, idx) => {
          const input = sw.querySelector('input[type="checkbox"]');
          const slider = sw.querySelector('.slider');
          const rSw = sw.getBoundingClientRect();
          const rSl = slider ? slider.getBoundingClientRect() : rSw;
          const rIn = input ? input.getBoundingClientRect() : rSw;
          const parentRect = sw.parentElement?.getBoundingClientRect();
          return {
            idx,
            id: input?.id || '',
            checked: Boolean(input?.checked),
            sw: { l: rSw.left, t: rSw.top, r: rSw.right, b: rSw.bottom, w: rSw.width, h: rSw.height },
            sl: { l: rSl.left, t: rSl.top, r: rSl.right, b: rSl.bottom, w: rSl.width, h: rSl.height },
            inBox: { l: rIn.left, t: rIn.top, r: rIn.right, b: rIn.bottom },
            insideX: rSl.left >= rSw.left - 0.5 && rSl.right <= rSw.right + 0.5,
            insideY: rSl.top >= rSw.top - 0.5 && rSl.bottom <= rSw.bottom + 0.5,
            notClipped: !parentRect || (rSw.right <= parentRect.right + 2 && rSw.left >= parentRect.left - 2),
          };
        });
      })()`);
      assert.ok(checks.length >= 2, `Expected >=2 .switch controls for ${label}`);
      for (const c of checks) {
        assert.equal(c.insideX, true, `Switch thumb overflowed X on ${label} (${c.id}): ${JSON.stringify(c)}`);
        assert.equal(c.insideY, true, `Switch thumb overflowed Y on ${label} (${c.id}): ${JSON.stringify(c)}`);
      }
      return checks;
    };

    await assertSwitchContainment("fixture-initial-1440");
    await page.evaluate("document.getElementById('fixtureSwitchSuccess').focus()");
    const beforeSpaceChecked = await page.evaluate("document.getElementById('fixtureSwitchSuccess').checked");
    await dispatchKey(" ", "Space");
    await delay(260);
    const afterSpaceChecked = await page.evaluate("document.getElementById('fixtureSwitchSuccess').checked");
    assert.notEqual(afterSpaceChecked, beforeSpaceChecked, "Space key must toggle switch checkbox natively");
    await assertSwitchContainment("fixture-space-toggled-1440");
    await shot("switch-fixed-desktop-light.png", false);

    // Simulated switch failure rolls back checkbox
    await page.click("#fixtureSwitchFail");
    await delay(340);
    const failSwitchState = await page.evaluate("({ checked: document.getElementById('fixtureSwitchFail').checked, text: document.getElementById('fixtureSwitchFailText').textContent })");
    assert.equal(failSwitchState.checked, false, "failed switch must roll back to unchecked");
    assert.match(failSwitchState.text, /回滚/);
    await assertSwitchContainment("fixture-after-rollback");

    // Form invalid -> fix -> submit
    await page.click("#fixtureFormSubmitBtn");
    assert.equal(await page.evaluate("document.getElementById('fixtureInputTitle').getAttribute('aria-invalid')"), "true");
    await page.setFields({ "#fixtureInputTitle": "I07 真实表单验收" });
    await page.click("#fixtureFormSubmitBtn");
    await delay(340);
    assert.equal(await page.evaluate("document.getElementById('fixtureFormSubmitBtn').getAttribute('data-feedback-state')"), "success");
    return { pressedAttr, failSwitchState };
  });

  // 2. Rapid Tab Switching + 140ms Skeleton Cancellation
  await recordScenario("tabs-rapid-skeleton-cancellation", async () => {
    await page.click("#tabTools");
    await delay(40);
    await page.click("#tabFinance");
    await delay(40);
    await page.click("#tabShare");
    await delay(240);
    const title = await page.evaluate("document.getElementById('fixtureTabTitle').textContent");
    const telemetry = await page.evaluate("window.__i07FixtureTelemetry()");
    assert.match(title, /文件传输/);
    assert.ok(telemetry.staleDroppedCount >= 2, `Expected >=2 dropped stale tabs, got ${telemetry.staleDroppedCount}`);
    return { title, staleDroppedCount: telemetry.staleDroppedCount };
  });

  // 3. Bidirectional FLIP (Down + Up + Mid-flight Reversal + Density Toggle + Keyboard Sort)
  await recordScenario("flip-bidirectional-reversal-density-keyboard", async () => {
    await page.evaluate("document.getElementById('secFlip').scrollIntoView({ block: 'start' })");
    await settle();
    await shot("flip-seq-1-initial.png");

    // Move card-1 DOWN
    await page.click('[data-flip-down="card-1"]');
    await delay(90);
    const midDownTransform = await page.evaluate("getComputedStyle(document.querySelector('[data-flip-key=\"card-1\"]')).transform");
    await shot("flip-seq-2-mid-down.png", false);
    await delay(420);

    // Move card-3 UP (verify symmetric upward FLIP!)
    await page.click('[data-flip-up="card-3"]');
    await delay(90);
    const midUpTransform = await page.evaluate("getComputedStyle(document.querySelector('[data-flip-key=\"card-3\"]')).transform");
    await shot("flip-seq-3-mid-up.png", false);
    await delay(420);

    // Mid-flight reversal
    await page.click("#btnFlipReverse");
    await delay(560);

    // 2-col -> 1-col -> 2-col density toggle
    await page.click("#btnFlipDensity");
    await delay(120);
    await shot("flip-seq-4-single-col.png", false);
    await delay(380);
    await page.click("#btnFlipDensity");
    await delay(480);

    // Keyboard ArrowDown reorder on drag handle
    await page.evaluate("document.querySelector('[data-flip-key=\"card-1\"] [data-drag-handle]').focus()");
    await dispatchKey("ArrowDown", "ArrowDown");
    await delay(480);

    // Hide all -> empty state -> restore all
    await page.click("#btnFlipHideAll");
    await settle();
    assert.equal(await page.evaluate("!document.getElementById('fixtureFlipEmpty').classList.contains('hidden')"), true);
    await page.click("#btnFlipEmptyRestore");
    await page.waitFor("!document.querySelector('#fixtureFlipGrid [data-flip-moving=\"true\"]')", 5000);
    await settle();

    const telemetry = await page.evaluate("window.__i07FixtureTelemetry()");
    assert.equal(telemetry.flipIdentity, "4 / 4", "All 4 card DOM nodes must keep identity");
    assert.notEqual(midDownTransform, "none", "downward move must animate via transform");
    assert.notEqual(midUpTransform, "none", "upward move must animate via transform");
    return { midDownTransform, midUpTransform, flipIdentity: telemetry.flipIdentity };
  });

  // 4. Pointer Drag-to-Sort + Escape Cancel
  await recordScenario("pointer-drag-sort-and-cancel", async () => {
    await page.evaluate("document.getElementById('secFlip').scrollIntoView({ block: 'start' })");
    await settle();
    const dragDebug = await page.evaluate(`(() => {
      const order = [...document.querySelectorAll('#fixtureFlipGrid [data-flip-key]')].map(n => n.dataset.flipKey);
      const h1 = document.querySelector('[data-flip-key="card-1"] [data-drag-handle]').getBoundingClientRect();
      const c2 = document.querySelector('[data-flip-key="card-2"]').getBoundingClientRect();
      return {
        order,
        sx: Math.round(h1.left + h1.width / 2), sy: Math.round(h1.top + h1.height / 2),
        tx: Math.round(c2.left + c2.width / 2), ty: Math.round(c2.top + c2.height / 2),
        h1, c2
      };
    })()`);
    const coords = dragDebug;
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.sx, y: coords.sy });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.sx, y: coords.sy, button: "left", buttons: 1, clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round((coords.sx + coords.tx) / 2), y: coords.sy, button: "left", buttons: 1 });
    await delay(20);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.tx, y: coords.ty, button: "left", buttons: 1 });
    await delay(120);
    await shot("drag-seq-1-lifting.png", false);
    const midOrder = await page.evaluate("({ order: [...document.querySelectorAll('#fixtureFlipGrid [data-flip-key]')].map(n => n.dataset.flipKey), dragging: document.querySelector('[data-flip-key=\"card-1\"]').getAttribute('data-dragging'), transform: document.querySelector('[data-flip-key=\"card-1\"]').style.transform })");
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.tx, y: coords.ty, button: "left", buttons: 0, clickCount: 1 });
    await delay(360);
    await shot("drag-seq-2-settled.png");

    const orderAfterDrop = await page.evaluate("[...document.querySelectorAll('#fixtureFlipGrid [data-flip-key]')].map(n => n.dataset.flipKey)");
    assert.equal(orderAfterDrop[0], "card-2", `Dragging card-1 over card-2 should reorder cards (before=${JSON.stringify(dragDebug)}, mid=${JSON.stringify(midOrder)}, after=${JSON.stringify(orderAfterDrop)})`);

    // Drag and cancel via Escape
    const coords2 = await page.evaluate(`(() => {
      const h = document.querySelector('[data-flip-key="card-2"] [data-drag-handle]').getBoundingClientRect();
      const c1 = document.querySelector('[data-flip-key="card-1"]').getBoundingClientRect();
      return { sx: h.left + h.width/2, sy: h.top + h.height/2, tx: c1.left + c1.width/2, ty: c1.top + c1.height/2 };
    })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords2.sx, y: coords2.sy });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coords2.sx, y: coords2.sy, button: "left", buttons: 1, clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords2.tx, y: coords2.ty, button: "left", buttons: 1 });
    await delay(80);
    await dispatchKey("Escape", "Escape");
    await delay(340);
    const orderAfterCancel = await page.evaluate("[...document.querySelectorAll('#fixtureFlipGrid [data-flip-key]')].map(n => n.dataset.flipKey)");
    assert.deepEqual(orderAfterCancel, orderAfterDrop, "Escape during drag must revert to pre-drag order");
    return { orderAfterDrop, orderAfterCancel };
  });

  // 5. Keyed Table Inline Switch + Kill Switch (0 tbody rebuilds)
  await recordScenario("keyed-table-node-identity-and-kill-switch", async () => {
    await page.evaluate("window.__firstTrRef = document.querySelector('#fixtureKeyedTbody tr');");
    await page.click("#sw-motion_engine");
    await delay(260);
    await page.click("#btnToggleKillSwitch");
    await delay(100);
    const sameRef = await page.evaluate("document.querySelector('#fixtureKeyedTbody tr') === window.__firstTrRef");
    const rowRebuilds = await page.evaluate("window.__i07FixtureTelemetry().rowRebuilds");
    const lockedDisabled = await page.evaluate("document.getElementById('sw-motion_engine').disabled");
    assert.equal(sameRef, true, "<tr> DOM node identity must be preserved");
    assert.equal(rowRebuilds, 0, "tbody must NOT rebuild child nodes during inline toggle or Kill Switch");
    assert.equal(lockedDisabled, true);
    await page.click("#btnToggleKillSwitch");
    return { sameRef, rowRebuilds, lockedDisabled };
  });

  // 6. Toast 5-Burst Queue (Max 2 Visible)
  await recordScenario("toast-5-burst-max-2-queue", async () => {
    await page.click("#btnToastClear");
    await delay(260);
    await page.click("#btnToastBurst5");
    await delay(100);
    await shot("toast-seq-1-burst.png", false);
    const snap = await page.evaluate("window.__i07FixtureTelemetry().toast");
    assert.equal(snap.visible.length, 2, "Max 2 toasts visible simultaneously");
    assert.equal(snap.queued.length, 3, "Remaining 3 toasts queued");
    assert.equal(snap.visible[0].tone, "error", "Error toast protected at slot 0");
    await page.click("#btnToastClear");
    await delay(240);
    return snap;
  });

  // 7. Scroll 3D Multi-Stage Reversible Wheel + Bento Seam Lock
  await recordScenario("scroll-3d-reversible-and-bento-seam-lock", async () => {
    const readScrollCard = () => page.evaluate(`(() => {
      const el = document.getElementById('fixtureScroll3dCard');
      return {
        stage: el.dataset.scrollStage || '',
        rx: parseFloat(el.style.getPropertyValue('--ds-scroll-rx') || '0'),
        scale: parseFloat(el.style.getPropertyValue('--ds-scroll-scale') || '1'),
        tz: parseFloat(el.style.getPropertyValue('--ds-scroll-tz') || '0'),
        transform: getComputedStyle(el).transform,
      };
    })()`);

    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    await settle();
    const stageTop = await page.evaluate("document.getElementById('secScrollBento').getBoundingClientRect().top + window.scrollY - 680");
    await page.evaluate(`window.scrollTo({ top: ${Math.max(0, Math.round(stageTop))}, behavior: 'instant' })`);
    await settle();
    await shot("scroll-seq-1-entry.png");
    const entryState = await readScrollCard();

    // Real mouse wheel downward into flat level focal pose
    for (let i = 0; i < 4; i += 1) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: 160 });
      await delay(90);
    }
    await settle();
    await shot("scroll-seq-2-flattened.png");
    const flatState = await readScrollCard();

    // A2: Continue scrolling past level zone -> must continue into exit pitch (negative rx & tz), NOT stop dead at 0deg!
    for (let i = 0; i < 4; i += 1) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: 160 });
      await delay(90);
    }
    await settle();
    await shot("scroll-seq-3-exit-stage.png");
    const exitState = await readScrollCard();

    // Reverse wheel back upward smoothly back toward entry
    for (let i = 0; i < 8; i += 1) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: -160 });
      await delay(90);
    }
    await settle();
    await shot("scroll-seq-4-reversed.png");
    const reversedState = await readScrollCard();

    const telemetry = await page.evaluate("window.__i07FixtureTelemetry()");
    assert.equal(telemetry.maxSeamDrift, 0, `Bento outer seams must remain locked (drift=${telemetry.maxSeamDrift})`);
    assert.ok(entryState.rx > flatState.rx, `Entry must pitch downward toward level (${JSON.stringify({ entryState, flatState })})`);
    assert.ok(exitState.rx < 0, `Continued scroll past level must enter negative pitch exit phase instead of stopping at 0deg (${JSON.stringify(exitState)})`);
    assert.ok(reversedState.rx > exitState.rx, `Scrolling back up must reversibly recover posture (${JSON.stringify({ exitState, reversedState })})`);
    return { entryState, flatState, exitState, reversedState, maxSeamDrift: telemetry.maxSeamDrift };
  });

  // 8. Desktop Modal (Spring, Focus Trap, Escape) & Mobile Gesture Drawer (375px Touch Drag, Snap-Back, Dismiss)
  await recordScenario("desktop-modal-and-mobile-gesture-drawer", async () => {
    await page.evaluate("document.getElementById('btnOpenFormSheet').scrollIntoView({ block: 'center' }); document.getElementById('btnOpenFormSheet').focus();");
    await dispatchKey("Enter", "Enter");
    await delay(280);
    await shot("desktop-modal-open.png");
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').dataset.sheetMode"), "modal");
    await dispatchKey("Escape", "Escape");
    await delay(260);
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').classList.contains('hidden')"), true);
    assert.equal(await page.evaluate("document.activeElement?.id"), "btnOpenFormSheet", "Focus must return to trigger button");

    // Switch to Mobile 375px touch viewport
    await setViewport(375, 812, true);
    await page.click("#btnOpenFormSheet");
    await delay(280);
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').dataset.sheetMode"), "drawer");
    await page.setFields({ "#fixtureSheetInput": "保留不丢失的输入" });
    await shot("mobile-drawer-seq-1-open.png");

    // Touch drag down 42px slowly (under threshold & low velocity) -> release -> must snap back AND keep input value!
    const handlePt = await page.evaluate("(() => { const r = document.querySelector('#fixtureSheetModal .ds-sheet-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()");
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: handlePt.x, y: handlePt.y }] });
    await delay(50);
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: handlePt.x, y: handlePt.y + 20 }] });
    await delay(60);
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: handlePt.x, y: handlePt.y + 42 }] });
    await delay(80);
    await shot("mobile-drawer-seq-2-dragging.png", false);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await delay(320);
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').classList.contains('hidden')"), false, "Short drag must snap back");
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetInput').value"), "保留不丢失的输入");

    // Touch drag down 240px (over threshold) -> dismiss
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: handlePt.x, y: handlePt.y }] });
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: handlePt.x, y: handlePt.y + 240 }] });
    await delay(60);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await delay(280);
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetModal').classList.contains('hidden')"), true, "Long downward swipe must dismiss drawer");
    assert.equal(await page.evaluate("document.body.classList.contains('modal-open')"), false, "Scroll lock must release after swipe dismiss");

    // Re-open confirms preserved form input value
    await page.click("#btnOpenFormSheet");
    await delay(240);
    assert.equal(await page.evaluate("document.getElementById('fixtureSheetInput').value"), "保留不丢失的输入");
    await dispatchKey("Escape", "Escape");
    await delay(240);
    await shot("fixture-mobile-375-light.png");

    // Also test Dark mode + Reduced Motion on Fixture
    await page.click("#fixtureThemeBtn");
    await page.click("#fixtureReducedBtn");
    await settle();
    await shot("fixture-mobile-375-dark-reduced.png");
    await runAxe("fixture-mobile-375-dark");
    await page.click("#fixtureReducedBtn");
    await page.click("#fixtureThemeBtn");
    await setViewport(1440, 900, false);
    return { desktopModal: "PASS", mobileDrawerSnapAndDismiss: "PASS", formValuePreserved: true };
  });

  // 9. Dark Mode + Performance Telemetry Snapshot on Fixture
  await recordScenario("dark-theme-and-performance-telemetry", async () => {
    await page.click("#fixtureThemeBtn");
    await settle();
    await shot("fixture-desktop-1440-dark.png");
    await runAxe("fixture-desktop-dark");
    const perf = await page.evaluate("window.__i07FixtureTelemetry()");
    report.performance = {
      worstFrameMs: Number(perf.worstFrameMs.toFixed(2)),
      longTaskCount: perf.longTaskCount,
      maxSeamDriftPx: perf.maxSeamDrift,
    };
    await page.click("#fixtureThemeBtn");
    return report.performance;
  });

  // 10. Real Aeris App Routes (/ , /login -> /select , /finance , /admin , /account modal , P07 OFF)
  await recordScenario("real-app-routes-modal-tabs-p07off", async () => {
    await page.navigate("/");
    await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
    await settle();
    assert.equal(await page.evaluate("document.documentElement.getAttribute('data-aeris-motion-ready')"), "true");
    await runAxe("real-app-public-home");

    // Login as synthetic admin
    await page.navigate("/login");
    await page.waitFor("document.querySelector('#loginForm')?.checkVisibility()", 15000);
    await page.setFields({ "#usernameInput": "i07admin", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("document.documentElement.dataset.workspaceMount === 'ready' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated'", 20000);
    await settle();

    // Open Feedback Modal (tests real app modal + tab indicator inside modal + Escape close)
    await page.click("#accountMenu summary");
    await page.click("#feedbackBtn");
    await page.waitFor("document.querySelector('#feedbackModal')?.checkVisibility()", 5000);
    await page.click("#feedbackVotingTab");
    await delay(200);
    await shot("real-app-feedback-modal-tabs.png");
    await dispatchKey("Escape", "Escape");
    await page.waitFor("document.getElementById('feedbackModal').classList.contains('hidden')", 5000);

    // Navigate mid-animation / check Admin Flags
    await page.navigate("/admin");
    await page.waitFor("document.querySelector('#adminFeatureFlagsTab')?.checkVisibility()", 15000);
    await page.click("#adminFeatureFlagsTab");
    await page.waitFor("document.querySelector('#featureFlagEnabled')?.checkVisibility()", 10000);
    await settle();
    await shot("real-app-admin-flags.png");
    await runAxe("real-app-admin-flags");

    // Navigate to /finance workspace & verify route
    await page.navigate("/finance");
    await page.waitFor("document.querySelector('#financePage')?.checkVisibility()", 15000);

    // Logout admin and login regular member so .danger-zone / #openDeleteAccountBtn is available
    await page.click("#accountMenu summary");
    await page.click("#logoutBtn");
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'guest'", 15000);
    await page.navigate("/login");
    await page.waitFor("document.querySelector('#loginForm')?.checkVisibility()", 15000);
    await page.setFields({ "#usernameInput": "i07member", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("document.documentElement.dataset.workspaceMount === 'ready' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated'", 20000);
    await settle();

    // Mobile 390px check on real app dismissible modal (drawer) vs delete alertdialog (centered modal)
    await setViewport(390, 844, true);
    await page.click("#accountMenu summary");
    await page.click("#feedbackBtn");
    await page.waitFor("document.querySelector('#feedbackModal')?.checkVisibility()", 5000);
    const feedbackMobileMode = await page.evaluate("document.getElementById('feedbackModal').dataset.sheetMode");
    assert.equal(feedbackMobileMode, "drawer", "#feedbackModal should use drawer presentation on 390px mobile");
    await dispatchKey("Escape", "Escape");
    await page.waitFor("document.getElementById('feedbackModal').classList.contains('hidden')", 5000);

    await page.navigate("/account");
    await page.waitFor("document.querySelector('#openDeleteAccountBtn')?.checkVisibility()", 15000);
    await page.click("#openDeleteAccountBtn");
    await page.waitFor("document.querySelector('#deleteAccountModal')?.checkVisibility()", 5000);
    const deleteMode = await page.evaluate("document.getElementById('deleteAccountModal').dataset.sheetMode");
    assert.equal(deleteMode, "modal", "#deleteAccountModal must remain non-swipeable alertdialog modal on mobile");
    await shot("real-app-mobile-delete-confirm.png");
    await page.click('#deleteAccountModal [data-close-modal="deleteAccountModal"]');
    await page.waitFor("document.getElementById('deleteAccountModal').classList.contains('hidden')", 5000);
    await setViewport(1440, 900, false);

    // P07 OFF fallback verification (clicks & modals remain operable)
    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    await page.navigate("/");
    await page.waitFor("document.documentElement.dataset.p07Ui === 'disabled' && document.documentElement.dataset.bootState === 'ready'", 20000);
    await page.click("#accountMenu summary");
    await page.click("#feedbackBtn");
    await page.waitFor("document.querySelector('#feedbackModal')?.checkVisibility()", 5000);
    await dispatchKey("Escape", "Escape");
    await page.waitFor("document.getElementById('feedbackModal').classList.contains('hidden')", 5000);
    const p07Off = await page.evaluate("({ p07: document.documentElement.dataset.p07Ui, modalOperable: true, overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth) })");
    assert.equal(p07Off.p07, "disabled");
    assert.ok(p07Off.overflowX <= 1);
    await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    return { realAppMotionReady: true, feedbackMobileMode, deleteMode, p07Off };
  });

  // 11. Viewport overflow + switch containment matrix (1440, 768, 390, 375)
  await openFixture();
  for (const width of [1440, 768, 390, 375]) {
    await setViewport(width, width <= 500 ? 844 : 900, width <= 500);
    const metrics = await page.evaluate(`(() => {
      const overflowX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
      const badSwitches = [...document.querySelectorAll('.switch')].filter((sw) => {
        const sl = sw.querySelector('.slider');
        if (!sl) return false;
        const rSw = sw.getBoundingClientRect();
        const rSl = sl.getBoundingClientRect();
        return rSl.left < rSw.left - 0.5 || rSl.right > rSw.right + 0.5 || rSl.top < rSw.top - 0.5 || rSl.bottom > rSw.bottom + 0.5;
      }).length;
      return { overflowX, badSwitches };
    })()`);
    assert.ok(metrics.overflowX <= 1, `Horizontal overflow on fixture at ${width}px: ${metrics.overflowX}`);
    assert.equal(metrics.badSwitches, 0, `Switch thumb overflowed container at ${width}px`);
    report.viewportMatrix.push({ width, ...metrics });
  }

  assert.deepEqual(page.runtimeErrors, [], `Runtime console errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(apiErrors, [], `API 5xx errors: ${JSON.stringify(apiErrors)}`);

  await writeFile(path.join(evidenceDir, "acceptance-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: "PASS",
    scenarios: report.scenarios.length,
    axeScans: report.axeScans.length,
    screenshots: report.screenshots.length,
    performance: report.performance,
  }));
} finally {
  if (page) await page.close().catch(() => {});
  child.kill();
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
