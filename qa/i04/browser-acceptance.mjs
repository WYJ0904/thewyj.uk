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
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i04", "evidence");
await mkdir(evidenceDir, { recursive: true });

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i04 fixture'); } }",
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
});

const db = await mf.getD1Database("WYJ_DB");
const storage = await mf.getR2Bucket("WYJ_STORAGE");
const env = {
  ...(config.vars || {}),
  ...(config.env?.preview?.vars || {}),
  WYJ_DB: db,
  WYJ_STORAGE: storage,
  WYJ_ENVIRONMENT: "development",
  CLOUD_FOUNDATION_ENABLED: "true",
  WORKERS_AI_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "false",
  TTS_MODE: "cache-only",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK18_ADMIN_MESSAGES_ENABLED: "true",
  TASK20_ANDROID_APP_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  TASK22_TRANSFER_READS_ENABLED: "true",
  TASK22_TRANSFER_WRITES_ENABLED: "true",
  TASK25_FEATURE_FLAGS_ENABLED: "true",
  TASK26_ADAPTIVE_LEARNING_ENABLED: "true",
  TASK27_SECURITY_ENABLED: "true",
  TASK29_BACKUP_ENABLED: "true",
  TASK30_PRIVACY_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: "i04-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i04-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i04-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  const sql = (await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/--[^\r\n]*/g, "");
  await db.exec(sql.replace(/\r?\n/g, " "));
}

const password = "Synthetic-I04-Browser-Password!";
const now = new Date().toISOString();

async function setP07Flag(enabled) {
  await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'I04 workspace acceptance flag', ?1, 0, '["stable","beta","experimental"]', 10000, 1, ?2, NULL, 'i04-seed', 'i04-seed')
    ON CONFLICT(flag_key) DO UPDATE SET enabled = excluded.enabled, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`)
    .bind(enabled ? 1 : 0, new Date().toISOString()).run();
}
await setP07Flag(true);

const adminId = "i04-seed-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i04admin', 'i04admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();

const userA = { id: "i04-user-a", username: "i04userA" };
const userB = { id: "i04-user-b", username: "i04userB" };
for (const u of [userA, userB]) {
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, 'pbkdf2_sha256', 100000, 'user', ?5, ?5, ?5)`)
    .bind(u.id, u.username, u.username.toLowerCase(), await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
  await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(u.id, now).run();
}
for (const code of ["tools_access", "finance_access", "temporary_share_access"]) {
  await db.prepare(`INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at)
    VALUES (?1, ?2, 1, 'I04 synthetic entitled test user', 'i04-seed', ?3)`)
    .bind(userA.id, code, now).run();
}

const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
const spaRoutes = new Set([
  "/", "/login", "/register", "/download", "/changelog", "/trial",
  "/transfer", "/select", "/account", "/finance", "/tools", "/language", "/admin", "/recharge",
]);
const mimeFor = (file) => (
  file.endsWith(".js") || file.endsWith(".mjs") ? "text/javascript"
    : file.endsWith(".css") ? "text/css"
      : file.endsWith(".html") ? "text/html"
        : file.endsWith(".json") || file.endsWith(".webmanifest") ? "application/json"
          : file.endsWith(".png") ? "image/png"
            : file.endsWith(".ico") ? "image/x-icon"
              : file.endsWith(".svg") ? "image/svg+xml"
                : "text/plain"
);
const waitUntil = () => {};
const apiErrors = [];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/status" || url.pathname.startsWith("/api/")) {
      const bodyChunks = [];
      for await (const c of req) bodyChunks.push(c);
      const tasks = [];
      const webReq = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(bodyChunks) }),
      });
      const handler = url.pathname === "/api/status" ? status : onRequest;
      const resp = await handler({
        request: webReq,
        env,
        data: { requestId: crypto.randomUUID() },
        params: { path: url.pathname === "/api/status" ? undefined : url.pathname.slice(5).split("/").filter(Boolean) },
        waitUntil(p) { tasks.push(p); },
      });
      if (resp.status >= 500) {
        apiErrors.push({ path: url.pathname, status: resp.status });
      }
      const headersOut = Object.fromEntries(resp.headers);
      const setCookies = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
      if (setCookies.length) headersOut["set-cookie"] = setCookies;
      res.writeHead(resp.status, headersOut);
      res.end(Buffer.from(await resp.arrayBuffer()));
      await Promise.all(tasks);
      return;
    }
    const file = spaRoutes.has(url.pathname) ? "index.html" : url.pathname.slice(1);
    if (!isAllowedPagesFile(file) || file.startsWith("functions/")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const content = await readFile(path.join(root, file));
    res.writeHead(200, {
      "Content-Type": `${mimeFor(file)}; charset=utf-8`,
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    });
    res.end(content);
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i04-chrome-"));
const chrome = process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const chromeProc = spawn(
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
  gitSha,
  startedAt: now,
  scenarios: {},
  viewports: [],
  axeScans: [],
  consoleErrors: [],
  pageErrors: [],
  apiErrors,
};

let page = null;

try {
  let chromePort = 0;
  for (let i = 0; i < 60 && !chromePort; i += 1) {
    try {
      const portFile = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      chromePort = Number(portFile.trim().split(/\r?\n/)[0]);
    } catch (_) {
      await delay(100);
    }
  }
  assert.ok(chromePort, "Chrome DevToolsActivePort must become available");
  const cdpUrl = `http://127.0.0.1:${chromePort}`;
  const versionInfo = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
  report.browserVersion = versionInfo.Browser || "Chrome Headless";
  page = await openPage({ cdpUrl, baseUrl, width: 1440, height: 900, mobile: false });

async function shot(name) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(evidenceDir, `${name}.png`), Buffer.from(data, "base64"));
}

async function runAxe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
  report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
  assert.equal(res.violations.length, 0, `Serious/critical axe violations on ${label}: ${JSON.stringify(res.violations)}`);
}

async function signIn(username, extraLocalSeed = null) {
  await page.navigate("/login");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && !document.querySelector('#authPanel')?.classList.contains('hidden')", 20_000);
  await page.setFields({ "#usernameInput": username, "#secretInput": password });
  await page.click("#loginSubmitBtn");
  await page.waitFor("location.pathname === '/' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated'", 20_000);
  if (extraLocalSeed) {
    await page.evaluate(extraLocalSeed);
  }
  await delay(180);
}

async function signOut() {
  await page.evaluate("(() => { const m = document.querySelector('#accountMenu'); if (m) m.open = true; return true; })()");
  await page.click("#logoutBtn");
  await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'guest' || !document.querySelector('#authPanel')?.classList.contains('hidden')", 15_000);
}

async function centerOf(selector) {
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  })()`);
}
  // 1. Desktop 1440 Setup + Sign-in Account A + /select check
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.navigate("/");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready'", 25_000);
  // Guest `/` must keep I04 personal workspace hidden cleanly
  assert.equal(await page.evaluate("document.querySelector('#publicHome').dataset.sessionMode"), "guest");
  assert.equal(await page.evaluate("document.querySelector('#authWorkspaceSection').hidden"), true);

  await signIn(userA.username, `(() => {
    localStorage.setItem('studyRecords', JSON.stringify([{ id: 'i04-rec-1', language: 'english', practiceMode: 'meaning', total: 10, correct: 9, accuracy: 90, finishedAt: new Date().toISOString() }]));
    renderDashboard();
    return true;
  })()`);

  await page.navigate("/select");
  await page.waitFor("location.pathname === '/select' && document.documentElement.dataset.bootState === 'ready' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection').hidden", 20_000);
  await delay(120);
  const entryCheck = await page.evaluate(`(() => ({
    path: location.pathname,
    greeting: document.querySelector('#dashboardGreeting')?.textContent || '',
    p07: document.documentElement.dataset.p07Ui,
    cards: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => ({
      id: c.dataset.workspaceCard,
      value: c.querySelector('[data-ws-value]')?.textContent,
      status: c.querySelector('[data-ws-status]')?.textContent,
    })),
    summaryVisible: !document.querySelector('#homeV3SummaryGrid')?.hidden,
  }))()`);
  assert.equal(entryCheck.path, "/select");
  assert.ok(entryCheck.greeting.includes("i04userA"));
  assert.equal(entryCheck.cards.length, 6);
  assert.equal(entryCheck.summaryVisible, true);
  report.scenarios.entryAndSelect = entryCheck;
  await shot("i04-1440-comfortable-light");

  // 2. Capture DOM Node Identity & Bidirectional FLIP (↑ & ↓)
  await page.click("#workspaceCustomizeBtn");
  await page.waitFor("document.querySelector('#workspaceBentoGrid').dataset.editing === 'true'", 5_000);
  await shot("i04-1440-editing");

  await page.evaluate(`(() => {
    window.__i04Refs = Object.fromEntries([...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card')].map(el => [el.dataset.workspaceCard, el]));
    window.__i04Flips = [];
    const origAnimate = Element.prototype.animate;
    Element.prototype.animate = function(...args) {
      if (this.classList?.contains('workspace-bento-card')) {
        window.__i04Flips.push({ id: this.dataset.workspaceCard, keyframes: args[0], duration: args[1]?.duration });
      }
      return origAnimate.apply(this, args);
    };
    return true;
  })()`);

  // Move 2nd card (finance) DOWN -> expected index 2
  const downFocusBefore = await page.evaluate("(() => { const btn = document.querySelector('[data-workspace-card=\"finance\"] [data-workspace-action=\"down\"]'); btn.focus(); btn.click(); return { activeId: document.activeElement?.closest('[data-workspace-card]')?.dataset.workspaceCard }; })()");
  await delay(380);
  const afterDown = await page.evaluate(`(() => ({
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    identityPreserved: Object.entries(window.__i04Refs).every(([id, el]) => document.querySelector('[data-workspace-card=\"' + id + '\"]') === el),
    flipsCount: window.__i04Flips.length,
    downFlips: window.__i04Flips.slice(),
    focusCard: document.activeElement?.closest('[data-workspace-card]')?.dataset.workspaceCard,
  }))()`);
  assert.deepEqual(afterDown.order, ["learning", "tools", "finance", "transfer", "activity", "account"]);
  assert.equal(afterDown.identityPreserved, true);
  assert.ok(afterDown.flipsCount >= 2, `Expected bidirectional FLIP animations on down move, got ${afterDown.flipsCount}`);
  assert.equal(afterDown.focusCard, "finance");

  // Move finance UP -> back to index 1
  await page.evaluate("window.__i04Flips.length = 0; document.querySelector('[data-workspace-card=\"finance\"] [data-workspace-action=\"up\"]').click(); true");
  await delay(380);
  const afterUp = await page.evaluate(`(() => ({
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    identityPreserved: Object.entries(window.__i04Refs).every(([id, el]) => document.querySelector('[data-workspace-card=\"' + id + '\"]') === el),
    flipsCount: window.__i04Flips.length,
    focusCard: document.activeElement?.closest('[data-workspace-card]')?.dataset.workspaceCard,
  }))()`);
  assert.deepEqual(afterUp.order, ["learning", "finance", "tools", "transfer", "activity", "account"]);
  assert.equal(afterUp.identityPreserved, true);
  assert.ok(afterUp.flipsCount >= 2, `Expected bidirectional FLIP animations on up move, got ${afterUp.flipsCount}`);
  assert.equal(afterUp.focusCard, "finance");
  report.scenarios.bidirectionalFlip = { down: afterDown, up: afterUp };

  // 3. Keyboard Arrow Sorting + Live Region
  await page.evaluate("document.querySelector('[data-workspace-card=\"learning\"] [data-workspace-drag-handle]').focus(); true");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await delay(320);
  const afterArrow = await page.evaluate(`(() => ({
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    activeIsHandle: document.activeElement?.matches('[data-workspace-drag-handle]') && document.activeElement?.closest('[data-workspace-card]')?.dataset.workspaceCard === 'learning',
    liveText: document.querySelector('#workspaceLiveRegion')?.textContent || '',
  }))()`);
  assert.deepEqual(afterArrow.order.slice(0, 2), ["finance", "learning"]);
  assert.equal(afterArrow.activeIsHandle, true);
  assert.ok(afterArrow.liveText.length > 0);
  report.scenarios.keyboardSort = afterArrow;

  // 4. Real Pointer Drag & Escape Cancel + Real Pointer Drag Commit
  await page.evaluate(`(() => {
    document.querySelector('#workspaceBentoGrid')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  })()`);
  await delay(80);
  const escapeDragCoords = await page.evaluate(`(() => {
    const h = document.querySelector('[data-workspace-card="finance"] [data-workspace-drag-handle]').getBoundingClientRect();
    const t = document.querySelector('[data-workspace-card="tools"]').getBoundingClientRect();
    return {
      hx: Math.round(h.left + h.width / 2), hy: Math.round(h.top + h.height / 2),
      tx: Math.round(t.left + t.width / 2), ty: Math.round(t.top + t.height / 2),
    };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: escapeDragCoords.hx, y: escapeDragCoords.hy, button: "left", clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    const nx = Math.round(escapeDragCoords.hx + ((escapeDragCoords.tx - escapeDragCoords.hx) * i) / 6);
    const ny = Math.round(escapeDragCoords.hy + ((escapeDragCoords.ty - escapeDragCoords.hy) * i) / 6);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: nx, y: ny, button: "left", buttons: 1 });
    await delay(25);
  }
  const midDragOrder = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
  assert.notEqual(midDragOrder[0], "finance", "Drag must have moved finance before Escape cancel");
  // Press Escape mid-drag -> must restore order prior to drag & clear inline transform
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: escapeDragCoords.tx, y: escapeDragCoords.ty, button: "left", clickCount: 1 });
  await delay(300);
  const afterEscapeCancel = await page.evaluate(`(() => ({
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    residualTransforms: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card')].filter(c => Boolean(c.style.transform)).length,
  }))()`);
  assert.deepEqual(afterEscapeCancel.order.slice(0, 2), ["finance", "learning"], "Escape must cancel drag and restore order");
  assert.equal(afterEscapeCancel.residualTransforms, 0);

  // Now commit real pointer drag from finance -> tools
  const dragCoords = await page.evaluate(`(() => {
    const h = document.querySelector('[data-workspace-card="finance"] [data-workspace-drag-handle]').getBoundingClientRect();
    const t = document.querySelector('[data-workspace-card="tools"]').getBoundingClientRect();
    return {
      hx: Math.round(h.left + h.width / 2), hy: Math.round(h.top + h.height / 2),
      tx: Math.round(t.left + t.width / 2), ty: Math.round(t.top + t.height / 2),
    };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragCoords.hx, y: dragCoords.hy, button: "left", clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    const nx = Math.round(dragCoords.hx + ((dragCoords.tx - dragCoords.hx) * i) / 8);
    const ny = Math.round(dragCoords.hy + ((dragCoords.ty - dragCoords.hy) * i) / 8);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: nx, y: ny, button: "left", buttons: 1 });
    await delay(25);
  }
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragCoords.tx, y: dragCoords.ty, button: "left", clickCount: 1 });
  await delay(320);
  const afterPointerDrag = await page.evaluate(`(() => ({
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    identityPreserved: Object.entries(window.__i04Refs).every(([id, el]) => document.querySelector('[data-workspace-card=\"' + id + '\"]') === el),
    residualTransforms: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card')].filter(c => Boolean(c.style.transform)).length,
    saveState: document.querySelector('#workspaceSaveStatus')?.dataset.saveState,
  }))()`);
  assert.notEqual(afterPointerDrag.order[0], "finance", "Pointer drag must reorder card");
  assert.equal(afterPointerDrag.identityPreserved, true);
  assert.equal(afterPointerDrag.residualTransforms, 0);
  assert.equal(afterPointerDrag.saveState, "dirty");
  report.scenarios.dragAndEscape = { afterEscapeCancel, afterPointerDrag };

  // 5. Density Switch: Comfortable (2-col) <-> Compact (1-col strip)
  const comfortableGeom = await page.evaluate(`(() => {
    const rects = [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.getBoundingClientRect());
    return { cols: new Set(rects.map(r => Math.round(r.left))).size, avgH: Math.round(rects.reduce((s, r) => s + r.height, 0) / rects.length) };
  })()`);
  await page.click("#workspaceDensityBtn");
  await delay(380);
  const compactGeom = await page.evaluate(`(() => {
    const rects = [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.getBoundingClientRect());
    return { density: document.querySelector('#workspaceBentoGrid').dataset.density, cols: new Set(rects.map(r => Math.round(r.left))).size, avgH: Math.round(rects.reduce((s, r) => s + r.height, 0) / rects.length) };
  })()`);
  assert.equal(comfortableGeom.cols, 2);
  assert.equal(compactGeom.density, "compact");
  assert.equal(compactGeom.cols, 1);
  assert.ok(compactGeom.avgH < comfortableGeom.avgH * 0.72, `Compact strip (${compactGeom.avgH}px) must be meaningfully shorter than comfortable (${comfortableGeom.avgH}px)`);
  await shot("i04-1440-compact-light");
  report.scenarios.densityToggle = { comfortableGeom, compactGeom };

  // 6. Save -> Refresh Persistence -> Hide All -> Empty State -> Restore All -> Reset + Undo
  await page.click("#workspaceSaveBtn");
  await page.waitFor("document.querySelector('#workspaceSaveStatus')?.dataset.saveState === 'saved'", 5_000);
  const savedOrderBeforeReload = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
  await page.send("Page.reload", { ignoreCache: false });
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.querySelector('#workspaceBentoGrid')?.dataset.density === 'compact'", 20_000);
  const orderAfterReload = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
  assert.deepEqual(orderAfterReload, savedOrderBeforeReload);

  await page.click("#workspaceCustomizeBtn");
  await page.waitFor("document.querySelector('#workspaceBentoGrid').dataset.editing === 'true'", 5_000);
  // Hide every visible card
  for (let i = 0; i < 6; i++) {
    await page.click('#workspaceBentoGrid .workspace-bento-card:not([hidden]) [data-workspace-action="hide"]');
    await delay(40);
  }
  await delay(280);
  const emptyCheck = await page.evaluate(`(() => ({
    allHiddenVisible: !document.querySelector('#workspaceAllHiddenState').hidden,
    text: document.querySelector('#workspaceAllHiddenState').textContent,
    gridHidden: document.querySelector('#workspaceBentoGrid').hidden,
    toolbarVisible: document.querySelector('#workspaceConsoleToolbar').getBoundingClientRect().height > 0,
    hiddenBarVisible: !document.querySelector('#hiddenWidgetsBar').hidden,
  }))()`);
  assert.equal(emptyCheck.allHiddenVisible, true);
  assert.ok(emptyCheck.text.includes("当前工作台模块已全部隐藏"));
  assert.equal(emptyCheck.gridHidden, true);
  assert.equal(emptyCheck.toolbarVisible, true);
  assert.equal(emptyCheck.hiddenBarVisible, true);
  await shot("i04-1440-all-hidden");

  await page.click("#restoreAllWidgetsBtn");
  await delay(320);
  assert.equal(await page.evaluate("document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])').length"), 6);
  // Dirty check: restoring back to exact saved config disables redundant Save button; hide 1 card to test partial restore + save.
  assert.equal(await page.evaluate("document.querySelector('#workspaceSaveBtn').disabled"), true);
  await page.click('[data-workspace-card="transfer"] [data-workspace-action="hide"]');
  await delay(180);
  assert.equal(await page.evaluate("document.querySelector('#workspaceSaveBtn').disabled"), false);
  await page.click("#workspaceSaveBtn");
  await delay(100);
  await page.click('[data-workspace-restore="transfer"]');
  await delay(320);
  assert.equal(await page.evaluate("document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])').length"), 6);
  await page.click("#workspaceCustomizeBtn");
  await delay(100);

  // Reset + Undo verification
  await page.click("#workspaceResetBtn");
  await delay(320);
  assert.equal(await page.evaluate("document.querySelector('#workspaceBentoGrid').dataset.density"), "comfortable");
  assert.equal(await page.evaluate("document.querySelector('#workspaceResetUndoBar').hidden"), false);
  await page.click("#workspaceUndoResetBtn");
  await delay(320);
  assert.equal(await page.evaluate("document.querySelector('#workspaceBentoGrid').dataset.density"), "compact");
  report.scenarios.hideEmptyResetUndo = emptyCheck;

  // 7. Controlled Storage Save Failure (never lies or clears valid saved layout)
  const failCheck = await page.evaluate(`(() => {
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); };
    try {
      document.querySelector('#workspaceDensityBtn').click();
      return {
        saveState: document.querySelector('#workspaceSaveStatus')?.dataset.saveState,
        statusText: document.querySelector('#workspaceSaveStatus')?.textContent || '',
      };
    } finally {
      Storage.prototype.setItem = origSetItem;
    }
  })()`);
  assert.equal(failCheck.saveState, "failed");
  assert.ok(failCheck.statusText.includes("保存失败"));
  report.scenarios.controlledFailure = failCheck;

  // Reload once cleanly to verify original valid persisted layout was NOT corrupted
  await page.send("Page.reload", { ignoreCache: false });
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.querySelector('#workspaceBentoGrid')?.dataset.density === 'compact'", 20_000);

  // 8. Desktop Centered Spring Modal (`1440px`: Focus, Tab trap, Escape return)
  const previewBtnSel = '[data-workspace-preview="learning"]';
  await page.click(previewBtnSel);
  await page.waitFor("!document.querySelector('#workspaceDetailModal').classList.contains('hidden')", 5_000);
  await delay(460);
  const modalCheck = await page.evaluate(`(() => {
    const layer = document.querySelector('#workspaceDetailModal');
    const panel = layer.querySelector('.modal-panel');
    const rect = panel.getBoundingClientRect();
    return {
      sheetMode: layer.dataset.sheetMode,
      bgScale: getComputedStyle(document.documentElement).getPropertyValue('--ds-bg-scale').trim() || document.documentElement.style.getPropertyValue('--ds-bg-scale'),
      panelWidth: rect.width,
      centered: Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < 40,
      locked: document.documentElement.dataset.modalScrollLocked,
      title: document.querySelector('#workspaceDetailTitle')?.textContent,
    };
  })()`);
  assert.equal(modalCheck.sheetMode, "modal");
  assert.equal(modalCheck.centered, true);
  assert.ok(modalCheck.panelWidth <= 560);
  // Cycle Tab 10 times and ensure activeElement never escapes #workspaceDetailModal
  for (let t = 0; t < 10; t++) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await page.evaluate("Boolean(document.activeElement?.closest('#workspaceDetailModal'))"), true);
  }
  await runAxe("desktop-authenticated-modal-light");
  await shot("i04-1440-desktop-modal");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.waitFor("document.querySelector('#workspaceDetailModal').classList.contains('hidden')", 5_000);
  assert.equal(await page.evaluate("document.activeElement?.dataset.workspacePreview"), "learning");
  report.scenarios.desktopModal = modalCheck;

  // Switch back to comfortable for clean default view on viewport matrix + run A/B Account Isolation
  await page.click("#workspaceDensityBtn");
  await delay(340);

  // 9. Cross-account isolation A <-> B
  await signOut();
  await signIn(userB.username);
  const bState = await page.evaluate(`(() => ({
    density: document.querySelector('#workspaceBentoGrid')?.dataset.density,
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    greeting: document.querySelector('#dashboardGreeting')?.textContent || '',
  }))()`);
  assert.ok(bState.greeting.includes("i04userB"));
  assert.equal(bState.density, "comfortable", "Account B must not inherit Account A's compact density");
  assert.deepEqual(bState.order, ["learning", "finance", "tools", "transfer", "activity", "account"]);
  report.scenarios.accountIsolation = { bState };

  await signOut();
  await signIn(userA.username);
  // Must stay isolated per A! (A last saved compact earlier before reset-undo? Note line 333 toggled back to comfortable for A cleanly)

  // 10. Mobile Swipeable Bottom Drawer (`390x844`): slow drag snap-back, reverse drag, threshold dismiss
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await page.click('[data-workspace-preview="finance"]');
  await page.waitFor("!document.querySelector('#workspaceDetailModal').classList.contains('hidden')", 5_000);
  await delay(380);
  const drawerOpen = await page.evaluate(`(() => {
    const layer = document.querySelector('#workspaceDetailModal');
    const panel = layer.querySelector('.modal-panel');
    const r = panel.getBoundingClientRect();
    return { sheetMode: layer.dataset.sheetMode, width: r.width, bottom: r.bottom, innerHeight, dockedBottom: Math.abs(r.bottom - innerHeight) <= 3 };
  })()`);
  assert.equal(drawerOpen.sheetMode, "drawer");
  assert.equal(drawerOpen.dockedBottom, true);
  await shot("i04-390-mobile-drawer");

  const handleRect = await centerOf("#workspaceDetailModal .ds-sheet-handle");
  // Slow small downward drag (+36px) -> snap back & remain open
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: handleRect.x, y: handleRect.y, id: 1 }] });
  for (const dy of [12, 24, 36]) {
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: handleRect.x, y: handleRect.y + dy, id: 1 }] });
    await delay(30);
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(300);
  assert.equal(await page.evaluate("document.querySelector('#workspaceDetailModal').classList.contains('hidden')"), false, "Small drag must snap back open");

  // Down then reverse back up -> snap back open
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: handleRect.x, y: handleRect.y, id: 1 }] });
  for (const dy of [30, 80, 95, 50, 10]) {
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: handleRect.x, y: handleRect.y + dy, id: 1 }] });
    await delay(25);
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(300);
  assert.equal(await page.evaluate("document.querySelector('#workspaceDetailModal').classList.contains('hidden')"), false, "Reverse drag must snap back open");

  // Fast downward swipe past close threshold -> dismisses cleanly
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: handleRect.x, y: handleRect.y, id: 1 }] });
  for (const dy of [50, 130, 220]) {
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: handleRect.x, y: handleRect.y + dy, id: 1 }] });
    await delay(14);
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitFor("document.querySelector('#workspaceDetailModal').classList.contains('hidden')", 5_000);
  report.scenarios.mobileDrawer = { drawerOpen, dismissedOnThreshold: true };

  // 11. Responsive Viewport & Theme Matrix (`1440`, `1024`, `768`, `390`, `375`, Light + Dark) + Axe
  for (const width of [1440, 1024, 768, 390, 375]) {
    const mobile = width < 768;
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
      await delay(160);
      const metrics = await page.evaluate(`({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        cardsVisible: document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])').length,
        rectOk: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].every(c => c.getBoundingClientRect().right <= innerWidth + 1),
      })`);
      assert.ok(metrics.overflow <= 1, `Horizontal overflow at ${width} ${theme}: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.cardsVisible, 6);
      assert.equal(metrics.rectOk, true, `Card clipped at ${width} ${theme}`);
      report.viewports.push({ width, theme, ...metrics });
      if ((width === 1440 || width === 390) && theme === "dark") {
        await shot(`i04-${width}-comfortable-dark`);
      }
      if ([1440, 768, 375].includes(width)) {
        await runAxe(`workspace-${width}-${theme}`);
      }
    }
  }
  await page.evaluate("document.documentElement.dataset.theme = 'light'; true");

  // 12. Reduced Motion ON
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await page.click("#workspaceDensityBtn");
  await delay(120);
  assert.equal(await page.evaluate("document.querySelector('#workspaceBentoGrid').dataset.density"), "compact");
  await page.click("#workspaceDensityBtn");
  await delay(120);
  await page.send("Emulation.setEmulatedMedia", { features: [] });

  // 13. Browser Back / Forward
  await page.navigate("/select");
  await page.waitFor("location.pathname === '/select' && document.documentElement.dataset.bootState === 'ready' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection').hidden", 15_000);
  await page.click('[data-workspace-card="tools"] a[data-workspace-route="/tools"]');
  await page.waitFor("location.pathname === '/tools'", 10_000);
  await page.evaluate("history.back(); true");
  await page.waitFor("location.pathname === '/select' && !document.querySelector('#authWorkspaceSection').hidden", 10_000);
  await page.evaluate("history.forward(); true");
  await page.waitFor("location.pathname === '/tools'", 10_000);
  await page.evaluate("history.back(); true");
  await page.waitFor("location.pathname === '/select'", 10_000);

  // 14. P07 OFF fallback check (feature flag disabled in D1 -> reload -> workspace still usable!)
  await setP07Flag(false);
  await page.send("Page.reload", { ignoreCache: true });
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'disabled' && !document.querySelector('#authWorkspaceSection').hidden", 20_000);
  const p07Before = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
  await page.click("#workspaceCustomizeBtn");
  await page.click(`[data-workspace-card="${p07Before[1]}"] [data-workspace-action="down"]`);
  await page.click("#workspaceDensityBtn");
  await delay(150);
  const p07Off = await page.evaluate(`({
    p07: document.documentElement.dataset.p07Ui,
    density: document.querySelector('#workspaceBentoGrid').dataset.density,
    order: [...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard),
    overflow: document.documentElement.scrollWidth - innerWidth,
  })`);
  assert.equal(p07Off.p07, "disabled");
  assert.equal(p07Off.density, "compact");
  assert.equal(p07Off.order[2], p07Before[1]);
  assert.equal(p07Off.order[1], p07Before[2]);
  assert.ok(p07Off.overflow <= 1);
  report.scenarios.p07Off = p07Off;
  await shot("i04-1440-p07-off");

  // Restore P07 ON cleanly
  await setP07Flag(true);

  assert.deepEqual(page.runtimeErrors || [], [], `Unexpected runtime/console errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(report.apiErrors, [], `Unexpected API >=500 errors: ${JSON.stringify(report.apiErrors)}`);

  await writeFile(path.join(evidenceDir, "i04-browser-acceptance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: "PASS",
    gitSha,
    axeScans: report.axeScans.length,
    viewports: report.viewports.length,
    scenarios: Object.keys(report.scenarios).length,
  }, null, 2));
} finally {
  if (page) await page.close().catch(() => {});
  try { chromeProc.kill(); } catch (_) {}
  server.close();
  await mf.dispose();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
