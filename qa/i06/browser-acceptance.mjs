import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";
import { onRequest } from "../../functions/api/[[path]].js";
import { onRequest as status } from "../../functions/api/status.js";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { assertViewport, captureSource, pngProof, viewportProof } from "../i05/browser-proofs.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceRoot = path.join(root, ".wrangler", "i06-local-runs");
await mkdir(evidenceRoot, { recursive: true });
const evidenceDir = await mkdtemp(path.join(evidenceRoot, "run-"));
const source = await captureSource(root);

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mfPersist = await mkdtemp(path.join(os.tmpdir(), "aeris-i06-mf-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i06 fixture'); } }",
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
  d1Persist: path.join(mfPersist, "d1"),
  r2Persist: path.join(mfPersist, "r2"),
});

let rawDb = await mf.getD1Database("WYJ_DB");
let rawStorage = await mf.getR2Bucket("WYJ_STORAGE");
let refreshLock = null;
const isPoisoned = (err) => /poisoned stub|workerd|network connection lost/i.test(String(err?.message || err || ""));
async function refreshBindings(force = false) {
  if (!refreshLock || force) {
    refreshLock = (async () => {
      await delay(50);
      rawDb = await mf.getD1Database("WYJ_DB");
      rawStorage = await mf.getR2Bucket("WYJ_STORAGE");
    })().finally(() => { refreshLock = null; });
  }
  await refreshLock;
}
async function withDbRetry(fn) {
  try { return await fn(rawDb); }
  catch (err) { if (!isPoisoned(err)) throw err; await refreshBindings(); return await fn(rawDb); }
}
function makeLazyStmt(sql, args = []) {
  const compile = (targetDb) => {
    const stmt = targetDb.prepare(sql);
    return args.length ? stmt.bind(...args) : stmt;
  };
  return {
    _sql: sql,
    _args: args,
    bind(...nextArgs) { return nextArgs.length ? makeLazyStmt(sql, nextArgs) : this; },
    first(col) { return withDbRetry((d) => (col === undefined ? compile(d).first() : compile(d).first(col))); },
    all() { return withDbRetry((d) => compile(d).all()); },
    run() { return withDbRetry((d) => compile(d).run()); },
    raw(opts) { return withDbRetry((d) => (opts === undefined ? compile(d).raw() : compile(d).raw(opts))); },
  };
}
const db = {
  prepare(sql) { return makeLazyStmt(sql); },
  exec(sql) { return withDbRetry((d) => d.exec(sql)); },
  dump() { return withDbRetry((d) => d.dump()); },
  batch(stmts) {
    return withDbRetry((d) => d.batch(stmts.map((s) => {
      if (s && typeof s._sql === "string") {
        const native = d.prepare(s._sql);
        return s._args?.length ? native.bind(...s._args) : native;
      }
      return s;
    })));
  },
};
async function withR2Retry(fn) {
  try { return await fn(rawStorage); }
  catch (err) { if (!isPoisoned(err)) throw err; await refreshBindings(); return await fn(rawStorage); }
}
function wrapMultipart(key, uploadId, initialUpload = null) {
  let current = initialUpload;
  const getUpload = (s) => (current ||= s.resumeMultipartUpload(key, uploadId));
  return {
    key,
    uploadId,
    uploadPart: (partNumber, value) => withR2Retry(async (s) => {
      try { return await getUpload(s).uploadPart(partNumber, value); }
      catch (err) { current = null; throw err; }
    }),
    complete: (parts) => withR2Retry(async (s) => {
      try { return await getUpload(s).complete(parts); }
      catch (err) { current = null; throw err; }
    }),
    abort: () => withR2Retry(async (s) => {
      try { return await getUpload(s).abort(); }
      catch (err) { current = null; throw err; }
    }),
  };
}
const storage = {
  get: (...args) => withR2Retry((s) => s.get(...args)),
  put: (...args) => withR2Retry((s) => s.put(...args)),
  delete: (...args) => withR2Retry((s) => s.delete(...args)),
  head: (...args) => withR2Retry((s) => s.head(...args)),
  list: (...args) => withR2Retry((s) => s.list(...args)),
  async createMultipartUpload(key, options) {
    const upload = await withR2Retry((s) => s.createMultipartUpload(key, options));
    return wrapMultipart(upload.key, upload.uploadId, upload);
  },
  resumeMultipartUpload(key, uploadId) {
    return wrapMultipart(key, uploadId, rawStorage.resumeMultipartUpload(key, uploadId));
  },
};

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
  WYJ_TASK12_PASSWORD_PEPPER: "i06-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i06-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i06-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-I06-Browser-Password!";
const now = new Date().toISOString();
const nowMs = Date.now();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I06 browser acceptance public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i06-seed', 'i06-seed')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();

const adminId = "i06-browser-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i06admin', 'i06admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();
await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
  VALUES ('mem_i06_001', ?1, 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i06-fixture', ?1, '{}', ?2, ?2)`)
  .bind(adminId, now).run();

await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_i06_inc', ?1, '合成工资收入', 'income', '#0f766e', 'active', 1, 1, ?2, ?2, ''),
         ('cat_i06_exp', ?1, '合成日常采购', 'expense', '#b91c1c', 'active', 1, 1, ?2, ?2, '')`)
  .bind(adminId, now).run();
await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('tx_i06_0001', ?1, 'income', 500000, 'CNY', 'cat_i06_inc', 'Synthetic Payroll', '', 'I06 fixture income', ?2, 'manual', 'confirmed', 'active', 1, 1, ?3, ?3, ''),
         ('tx_i06_0002', ?1, 'expense', 12800, 'CNY', 'cat_i06_exp', 'Synthetic Supply', '', 'I06 fixture expense', ?2, 'manual', 'confirmed', 'active', 1, 1, ?3, ?3, '')`)
  .bind(adminId, nowMs, now).run();

const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
const spaRoutes = new Set([
  "/", "/login", "/register", "/forgot-password", "/download", "/changelog", "/trial",
  "/transfer", "/select", "/account", "/recharge", "/finance", "/tools", "/tools/workflows",
  "/language", "/language/english", "/language/japanese", "/admin",
]);
const isSpaPath = (pathname) => spaRoutes.has(pathname) || /^\/tools\/[^/]+$/.test(pathname);
const mimeFor = (file) => (
  file.endsWith(".js") || file.endsWith(".mjs") ? "text/javascript"
    : file.endsWith(".css") ? "text/css"
    : file.endsWith(".html") ? "text/html"
    : file.endsWith(".png") ? "image/png"
    : file.endsWith(".svg") ? "image/svg+xml"
    : file.endsWith(".ico") ? "image/x-icon"
    : file.endsWith(".webmanifest") ? "application/manifest+json"
    : "application/octet-stream"
);

let base;
const apiErrors = [];
let inFlightApi = 0;
const waitForApiIdle = async (timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (inFlightApi === 0) {
      await delay(60);
      if (inFlightApi === 0) return;
    }
    await delay(50);
  }
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname.startsWith("/api/")) {
      inFlightApi += 1;
      try {
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
        const bodyBuf = Buffer.from(await response.arrayBuffer());
        if (response.status >= 500) {
          console.error("SERVER_5XX", url.pathname, response.status, bodyBuf.toString("utf8").slice(0, 240));
          apiErrors.push({ path: url.pathname, status: response.status });
        }
        const headersOut = Object.fromEntries(response.headers);
        const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
        if (setCookies.length) headersOut["set-cookie"] = setCookies;
        res.writeHead(response.status, headersOut);
        res.end(bodyBuf);
        await Promise.all(tasks);
      } finally {
        inFlightApi = Math.max(0, inFlightApi - 1);
      }
      return;
    }
    const file = isSpaPath(url.pathname) ? "index.html" : url.pathname.slice(1);
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
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i06-chrome-"));
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

async function waitForCdpUrl(userDataDir, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  while (Date.now() < deadline) {
    try {
      const content = await readFile(portFile, "utf8");
      const port = content.split(/\r?\n/)[0]?.trim();
      if (port && /^\d+$/.test(port)) {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const info = await res.json();
          return { cdpUrl: `http://127.0.0.1:${port}`, browserVersion: info.Browser || "" };
        }
      }
    } catch (_) {}
    await delay(150);
  }
  throw new Error("Timed out waiting for Chrome DevToolsActivePort");
}

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const report = {
  scope: "Isolated local Miniflare D1/R2 + headless Chrome CDP (I06 Module Experiences)",
  gitSha: source.commit,
  gitBranch: source.branch,
  worktreeDirty: !source.sourceMatchesCommit,
  dirtyFiles: source.changedInputs.map(({ file }) => file),
  source,
  checkedAt: new Date().toISOString(),
  browserVersion: "",
  scenarios: [],
  axeScans: [],
  screenshots: [],
  screenshotProvenance: [],
  apiErrors: [],
  runtimeErrors: [],
  android_physical_device: "NOT_TESTED",
  production_release: "NOT_TOUCHED",
};

const tempUploadFile = path.join(mfPersist, "i06-module-upload-fixture.txt");
await writeFile(tempUploadFile, "I06 synthetic transfer payload\n", "utf8");

let page;
try {
  const cdp = await waitForCdpUrl(profile);
  report.browserVersion = cdp.browserVersion;
  page = await openPage({ cdpUrl: cdp.cdpUrl, baseUrl: base, width: 1440, height: 900, mobile: false });
  await page.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});

  const settle = async (targetPage = page, fast = false) => {
    await targetPage.evaluate(fast
      ? "new Promise(r => requestAnimationFrame(r))"
      : "document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  };

  let lastTouchState = null;
  const setViewport = async (width, height = 900, targetPage = page, fast = false) => {
    await targetPage.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
    const touch = width <= 980;
    if (touch !== lastTouchState || targetPage !== page) {
      await targetPage.send("Emulation.setTouchEmulationEnabled", { enabled: touch });
      if (targetPage === page) lastTouchState = touch;
    }
    await settle(targetPage, fast);
  };

  const setTheme = async (targetTheme, targetPage = page) => {
    for (let i = 0; i < 4; i += 1) {
      const current = await targetPage.evaluate("document.documentElement.dataset.themePreference");
      if (current === targetTheme) break;
      await targetPage.click("#themeToggleBtn");
      await delay(80);
    }
    await settle(targetPage);
    const actual = await targetPage.evaluate("document.documentElement.dataset.themePreference");
    assert.equal(actual, targetTheme, `Expected theme=${targetTheme}, got ${actual}`);
  };

  const shot = async (name, targetPage = page) => {
    await settle(targetPage);
    const observed = await viewportProof(targetPage);
    const data = await targetPage.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const png = Buffer.from(data.data, "base64");
    const pixels = pngProof(png);
    assert.deepEqual([pixels.width, pixels.height], [observed.width, observed.height], `Screenshot viewport mismatch for ${name}`);
    await writeFile(path.join(evidenceDir, name), png, { flag: "wx" });
    report.screenshots.push(name);
    report.screenshotProvenance.push({ name, ...pixels, viewport: observed, pathname: await targetPage.evaluate("location.pathname") });
    return name;
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
      return {
        ok: Boolean(h && (el === h || el.contains(h) || h.contains(el))),
        cx,
        cy,
        hitTag: h?.tagName || null,
        hitId: h?.id || null,
        hitClass: typeof h?.className === 'string' ? h.className : null,
      };
    })()`);
    assert.ok(hit.ok, `Hit-test failed for ${selector}: ${JSON.stringify(hit)}`);
    await targetPage.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy });
    await targetPage.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await targetPage.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await delay(80);
    return hit;
  };

  const recordScenario = async (name, fn) => {
    const started = Date.now();
    try {
      const detail = await fn();
      const ms = Date.now() - started;
      report.scenarios.push({ name, status: "PASS", ms, detail });
      console.log(`PASS scenario: ${name} (${ms}ms)`);
    } catch (error) {
      report.scenarios.push({ name, status: "FAIL", ms: Date.now() - started, error: error.message });
      throw error;
    }
  };

  // Sign in as i06admin (pre-seed cached rubrics for apple/banana so WORKERS_AI_ENABLED=false stays 0-5xx)
  await page.navigate("/login");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready'", 20_000, "initial origin ready");
  await page.evaluate(`localStorage.setItem('rubricCache', JSON.stringify({
    apple: { gloss: '苹果', accepted: ['苹果'] },
    banana: { gloss: '香蕉', accepted: ['香蕉'] }
  }))`);
  await page.navigate("/login");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && Boolean(document.querySelector('#loginForm'))", 20_000, "login ready");
  await page.setFields({ "#usernameInput": "i06admin", "#secretInput": password });
  await pointerClick("#loginSubmitBtn");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0", 25_000, "signed in");
  try {
    await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 2500, "site notice check");
    await pointerClick("#siteMessageCloseBtn");
    await page.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 5_000, "site notice dismissed");
  } catch (_) {}
  await settle();

  // Module 1: /language — single-question focus canvas, progress fill, and wrong-review FSRS context
  await recordScenario("m1_language_focus_and_fsrs_context", async () => {
    await setViewport(1440, 900);
    await setTheme("light");
    await pointerClick("#v3Sidebar [data-v3-nav='language']");
    await page.waitFor("!document.querySelector('#projectPicker')?.classList.contains('hidden')", 15_000, "project picker");
    await pointerClick("#projectPicker [data-project='english']");
    await page.waitFor("!document.querySelector('#workspace')?.classList.contains('hidden')", 15_000, "english workspace");
    await page.setFields({ "#wordInput": "apple\nbanana" });
    await pointerClick("#startBtn");
    await page.waitFor("document.querySelector('#quizView')?.classList.contains('active')", 10_000, "quiz active");
    await settle();
    const checkQuizGeometry = async (label) => {
      const box = await page.evaluate(`(() => {
        const qv = document.getElementById('quizView');
        const fill = document.getElementById('quizProgressFill');
        const word = document.getElementById('wordLabel').getBoundingClientRect();
        const input = document.getElementById('answerInput').getBoundingClientRect();
        const submit = document.getElementById('submitBtn').getBoundingClientRect();
        const skip = document.getElementById('skipBtn').getBoundingClientRect();
        const nav = document.getElementById('accountBar')?.getBoundingClientRect();
        const crumb = document.querySelector('#workspaceBreadcrumb li[aria-current="page"]')?.textContent?.trim() || '';
        return {
          width: qv.getBoundingClientRect().width,
          fillWidth: fill.style.width,
          crumb,
          scrollY: window.scrollY,
          navBottom: nav ? nav.bottom : 0,
          wordTop: word.top,
          wordBottom: word.bottom,
          inputBottom: input.bottom,
          submitHeight: submit.height,
          submitBottom: submit.bottom,
          skipBottom: skip.bottom,
          vh: window.innerHeight,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      })()`);
      assert.ok(box.submitHeight >= 44 && box.submitHeight <= 56, `${label} #submitBtn height out of range (expected ~48px): ${JSON.stringify(box)}`);
      assert.ok(box.wordTop >= box.navBottom - 1, `${label} #wordLabel occluded by sticky header: ${JSON.stringify(box)}`);
      assert.ok(box.submitBottom <= box.vh, `${label} primary submit button below initial viewport: ${JSON.stringify(box)}`);
      assert.ok(box.overflow <= 1, `${label} horizontal overflow: ${JSON.stringify(box)}`);
      return box;
    };

    const quizBox = await checkQuizGeometry("1440-light");
    assert.ok(quizBox.scrollY <= 4, `Start quiz should reset scroll cleanly to top: ${JSON.stringify(quizBox)}`);
    assert.ok(quizBox.width <= 765, `Quiz focus canvas exceeded 760px: ${JSON.stringify(quizBox)}`);
    assert.equal(quizBox.fillWidth, "50%", `Quiz progress fill mismatch: ${JSON.stringify(quizBox)}`);
    assert.equal(quizBox.crumb, "答题", `Breadcrumb should show active language tab 答题: ${JSON.stringify(quizBox)}`);
    assert.ok(quizBox.skipBottom <= quizBox.vh, `Desktop 1440x900 should fit secondary quiz actions cleanly: ${JSON.stringify(quizBox)}`);
    await shot("1440-i06-language-quiz-light.png");

    await setTheme("dark");
    const quiz1440Dark = await checkQuizGeometry("1440-dark");
    await setViewport(390, 844);
    await setTheme("light");
    await page.evaluate("window.scrollTo(0, 0)");
    await settle();
    const quiz390Light = await checkQuizGeometry("390-light");
    await shot("390-i06-language-quiz-light.png");
    await setViewport(375, 812);
    await setTheme("dark");
    await page.evaluate("window.scrollTo(0, 0)");
    await settle();
    const quiz375Dark = await checkQuizGeometry("375-dark");
    await shot("375-i06-language-quiz-dark.png");
    await setTheme("light");
    await setViewport(1440, 900);

    // Skip to populate current wrong book, advance via #nextNowBtn, then inspect wrong-review FSRS badges
    await pointerClick("#skipBtn");
    await page.waitFor("document.querySelector('#progressLabel')?.textContent === '2/2' || !document.querySelector('#nextNowBtn')?.disabled", 10_000, "skip feedback or advance");
    if (await page.evaluate("document.querySelector('#progressLabel')?.textContent !== '2/2'")) {
      await pointerClick("#nextNowBtn");
    }
    await page.waitFor("document.querySelector('#progressLabel')?.textContent === '2/2'", 10_000, "advanced to 2/2");
    await pointerClick("#backBtn");
    await pointerClick("#wrongViewTab");
    await page.waitFor("document.querySelector('#wrongView')?.classList.contains('active') && document.querySelectorAll('#wrongList .wrong-item').length > 0", 10_000, "wrong list rendered");
    const wrongInfo = await page.evaluate(`(() => {
      const item = document.querySelector('#wrongList .wrong-item');
      return {
        count: document.querySelectorAll('#wrongList .wrong-item').length,
        borderLeft: item ? getComputedStyle(item).borderLeftWidth : '',
        reviewStatus: item?.dataset.reviewStatus || '',
      };
    })()`);
    assert.ok(wrongInfo.count >= 1 && wrongInfo.borderLeft === "0px", `Wrong list should be continuous hairline rows: ${JSON.stringify(wrongInfo)}`);
    return { quizBox, quiz1440Dark, quiz390Light, quiz375Dark, wrongInfo };
  });

  // Module 2: /finance — borderless ledger + slide-over edit drawer (1440 & 390 dark)
  await recordScenario("m2_finance_borderless_ledger_and_drawer", async () => {
    await setViewport(1440, 900);
    await pointerClick("#v3Sidebar [data-v3-nav='finance']");
    await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden')", 15_000, "finance workspace");
    await waitForApiIdle();
    await page.evaluate(`(() => {
      const rec = document.getElementById('financeRecordedSection');
      if (rec && !rec.open) rec.open = true;
    })()`);
    await settle();
    const ledgerCheck = await page.evaluate(`(() => {
      const row = document.querySelector('#financeTransactionList .finance-transaction');
      const panel = document.querySelector('.finance-ledger-panel');
      return {
        tabular: getComputedStyle(document.getElementById('financeIncomeTotal')).fontVariantNumeric,
        panelBorderLeft: panel ? getComputedStyle(panel).borderLeftWidth : '',
        rowBorderLeft: row ? getComputedStyle(row).borderLeftWidth : '',
        rowCount: document.querySelectorAll('#financeTransactionList .finance-transaction').length,
      };
    })()`);
    assert.ok(ledgerCheck.tabular.includes("tabular-nums"));
    assert.equal(ledgerCheck.panelBorderLeft, "0px", `Finance ledger panel should be open/borderless: ${JSON.stringify(ledgerCheck)}`);
    assert.equal(ledgerCheck.rowBorderLeft, "0px", `Finance transaction rows should be hairline-divided: ${JSON.stringify(ledgerCheck)}`);
    assert.ok(ledgerCheck.rowCount >= 2, `Expected seeded transactions: ${JSON.stringify(ledgerCheck)}`);

    // Click row directly to open slide-over edit drawer
    await pointerClick("#financeTransactionList .finance-transaction .finance-transaction-main");
    await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "drawer opened");
    await delay(260);
    await settle();
    const drawerDesktop = await page.evaluate(`(() => {
      const modal = document.getElementById('financeTransactionModal');
      const panel = modal.querySelector('.finance-editor-modal');
      const mr = modal.getBoundingClientRect();
      const r = panel.getBoundingClientRect();
      const metaVisible = !document.getElementById('financeTransactionDrawerMeta')?.classList.contains('hidden');
      const deleteVisible = !document.getElementById('financeTransactionDrawerDeleteBtn')?.classList.contains('hidden');
      return { left: r.left, right: r.right, width: r.width, height: r.height, modalRight: mr.right, metaVisible, deleteVisible };
    })()`);
    assert.ok(drawerDesktop.left >= 900 && Math.abs(drawerDesktop.right - drawerDesktop.modalRight) <= 2 && drawerDesktop.right >= 1420 && drawerDesktop.height >= 850,
      `Desktop finance drawer must dock right full-height: ${JSON.stringify(drawerDesktop)}`);
    assert.equal(drawerDesktop.metaVisible, true, "Edit drawer must show transaction metadata strip");
    assert.equal(drawerDesktop.deleteVisible, true, "Edit drawer must show delete button for active tx");
    await shot("1440-i06-finance-drawer-light.png");
    await pointerClick("#financeTransactionModal [data-finance-close='financeTransactionModal']");
    await page.waitFor("document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "drawer closed");

    // Verify add button focus restore + 390px dark bottom sheet
    await setViewport(390, 844);
    await setTheme("dark");
    await pointerClick("#financeAddTransactionBtn");
    await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "mobile sheet opened");
    await delay(260);
    await settle();
    const sheetMobile = await page.evaluate(`(() => {
      const panel = document.querySelector('#financeTransactionModal .finance-editor-modal');
      const r = panel.getBoundingClientRect();
      return { bottom: r.bottom, width: r.width, top: r.top, overflow: document.documentElement.scrollWidth - window.innerWidth };
    })()`);
    assert.ok(sheetMobile.bottom >= 840 && sheetMobile.top > 20 && sheetMobile.overflow <= 1,
      `Mobile finance drawer should render as bottom sheet: ${JSON.stringify(sheetMobile)}`);
    await shot("390-i06-finance-sheet-dark.png");
    await pointerClick("#financeTransactionModal [data-finance-close='financeTransactionModal']");
    await page.waitFor("document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "mobile sheet closed");
    const restoredId = await page.evaluate("document.activeElement?.id || ''");
    assert.equal(restoredId, "financeAddTransactionBtn", `Focus restoration failed: ${restoredId}`);
    await setTheme("light");
    await setViewport(1440, 900);
    return { ledgerCheck, drawerDesktop, sheetMobile, restoredId };
  });

  // Module 3: /tools — two-pane instant search & split input/output workbench
  await recordScenario("m3_tools_two_pane_and_split_workbench", async () => {
    await setViewport(1440, 900);
    await pointerClick("#v3Sidebar [data-v3-nav='tools']");
    await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && Boolean(document.querySelector('#toolCatalog .tool-card'))", 15_000, "tools catalog ready");
    await settle();
    const twoPane = await page.evaluate(`(() => {
      const rail = document.querySelector('.tools-index-rail')?.getBoundingClientRect();
      const main = document.querySelector('.tools-index-main')?.getBoundingClientRect();
      return {
        railRight: rail ? rail.right : 0,
        mainLeft: main ? main.left : 0,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    assert.ok(twoPane.railRight > 0 && twoPane.railRight < twoPane.mainLeft, `Tools desktop two-pane layout broken: ${JSON.stringify(twoPane)}`);
    assert.ok(twoPane.overflow <= 1);
    await shot("1440-i06-tools-twopane-light.png");

    await page.evaluate(`(() => {
      const input = document.getElementById('toolSearchInput');
      input.focus();
      input.value = '大小写';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(250);
    const searchCheck = await page.evaluate(`({
      focusedId: document.activeElement?.id || '',
      count: document.getElementById('toolResultCount')?.textContent?.trim() || '',
    })`);
    assert.equal(searchCheck.focusedId, "toolSearchInput");

    await pointerClick("#toolCatalog [data-open-tool='letter-case']");
    await page.waitFor("!document.querySelector('#toolWorkbench')?.classList.contains('hidden')", 10_000, "letter-case workbench open");
    await settle();
    const splitPane = await page.evaluate(`(() => {
      const inPane = document.querySelector('.tool-pane-input')?.getBoundingClientRect();
      const outPane = document.querySelector('.tool-pane-output')?.getBoundingClientRect();
      return { inRight: inPane ? inPane.right : 0, outLeft: outPane ? outPane.left : 0 };
    })()`);
    assert.ok(splitPane.inRight > 0 && splitPane.inRight < splitPane.outLeft, `Tool workbench split pane failed: ${JSON.stringify(splitPane)}`);
    await page.setFields({ "#textToolInput": "hello aeris" });
    await pointerClick("#runTextToolBtn");
    await page.waitFor("document.getElementById('textToolOutput')?.value === 'HELLO AERIS'", 5_000, "letter-case output");
    await shot("1440-i06-tools-workbench-light.png");
    await pointerClick("#closeToolWorkbenchBtn");
    await page.waitFor("!document.querySelector('#toolsDashboard')?.classList.contains('hidden')", 10_000);
    return { twoPane, searchCheck, splitPane };
  });

  // Module 4: /transfer — collapsible config summary, drag-drop, real progress %
  await recordScenario("m4_transfer_collapsible_config_and_progress", async () => {
    await setViewport(1440, 900);
    await pointerClick("#v3Sidebar [data-v3-nav='transfer']");
    await page.waitFor("!document.querySelector('#transferPage')?.classList.contains('hidden')", 15_000, "transfer ready");
    await settle();
    const initialFold = await page.evaluate(`({
      open: Boolean(document.getElementById('transferConfigDisclosure')?.open),
      summary: document.getElementById('transferConfigSummary')?.textContent?.trim() || '',
    })`);
    assert.equal(initialFold.open, false, `Transfer config disclosure should start collapsed: ${JSON.stringify(initialFold)}`);
    assert.ok(initialFold.summary.includes("1 天") && initialFold.summary.includes("5 次"));

    // Verify 375x812 mobile default /transfer shows primary #transferSelectFilesBtn above the fold with 0 overflow
    await setViewport(375, 812);
    await page.evaluate("window.scrollTo(0, 0)");
    await settle();
    const mobileTransferDefault = await page.evaluate(`(() => {
      const btn = document.getElementById('transferSelectFilesBtn').getBoundingClientRect();
      return {
        selectFilesTop: btn.top,
        selectFilesBottom: btn.bottom,
        vh: window.innerHeight,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    assert.ok(mobileTransferDefault.selectFilesBottom <= mobileTransferDefault.vh, `/transfer 375px default should keep 选择文件 visible above the fold: ${JSON.stringify(mobileTransferDefault)}`);
    assert.ok(mobileTransferDefault.overflow <= 1, `/transfer 375px overflow: ${JSON.stringify(mobileTransferDefault)}`);
    await shot("375-i06-transfer-light.png");
    await setViewport(1440, 900);

    await pointerClick("#transferConfigDisclosure > summary");
    await page.evaluate(`(() => {
      const sel = document.getElementById('transferExpiry');
      sel.value = '4320';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const updatedSummary = await page.evaluate("document.getElementById('transferConfigSummary')?.textContent?.trim() || ''");
    assert.ok(updatedSummary.includes("3 天"), `Transfer config summary failed to update: ${updatedSummary}`);

    await page.throttle(450);
    try {
      await page.setFile("#transferFileInput", tempUploadFile);
      await page.waitFor("document.querySelector('#transferQueue .transfer-item .transfer-item-percent') !== null", 10_000, "queue item with percent");
      const queueProof = await page.evaluate(`({
        percent: document.querySelector('#transferQueue .transfer-item-percent')?.textContent?.trim() || '',
        state: document.querySelector('#transferQueue .transfer-item-state')?.dataset.status || '',
        tabular: getComputedStyle(document.querySelector('#transferQueue .transfer-item-percent')).fontVariantNumeric,
      })`);
      assert.ok(queueProof.tabular.includes("tabular-nums"));
      await shot("1440-i06-transfer-light.png");
      await setViewport(390, 844);
      const mobileOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
      assert.ok(mobileOverflow <= 1, `/transfer 390px overflow: ${mobileOverflow}`);
      await setViewport(1440, 900);
      return { initialFold, updatedSummary, queueProof, mobileOverflow };
    } finally {
      await page.clearThrottle().catch(() => {});
    }
  });

  // Module 5: /admin Flags — Flagsmith-style status capsules, structured audit timeline & DOM identity
  await recordScenario("m5_admin_flags_capsules_timeline_and_dom_identity", async () => {
    await setViewport(1440, 900);
    await pointerClick("#v3Sidebar [data-v3-nav='admin']");
    await page.waitFor("Boolean(document.querySelector('#adminUserList .admin-user-card'))", 15_000, "admin ready");
    await pointerClick("#adminFeatureFlagsTab");
    await page.waitFor("document.querySelectorAll('#featureFlagSummaryList .feature-directory-item').length > 0", 15_000, "flag directory rendered");

    const preNodes = await page.evaluate(`(() => {
      window.__i06FlagForm = document.getElementById('featureFlagForm');
      window.__i06FlagCb = document.getElementById('featureFlagEnabled');
      window.__i06RemovedCount = 0;
      const view = document.getElementById('adminFeatureFlagsView');
      const obs = new MutationObserver((records) => {
        for (const rec of records) {
          for (const node of rec.removedNodes) {
            if (node === window.__i06FlagForm || node === window.__i06FlagCb || (node.contains && node.contains(window.__i06FlagForm))) {
              window.__i06RemovedCount += 1;
            }
          }
        }
      });
      obs.observe(view, { childList: true, subtree: true });
      const r1 = document.getElementById('featureFlagEnabled').getBoundingClientRect();
      const r2 = document.getElementById('featureFlagKillSwitch').getBoundingClientRect();
      return {
        dirCount: document.querySelectorAll('#featureFlagSummaryList .feature-directory-item').length,
        stateCapsule: document.getElementById('featureFlagStateCapsule')?.dataset.state || '',
        cb1: [r1.width, r1.height],
        cb2: [r2.width, r2.height],
      };
    })()`);
    assert.ok(preNodes.dirCount >= 1);
    assert.ok(preNodes.cb1[0] <= 24 && preNodes.cb2[0] <= 24);

    // Create new long-key flag via Task 27 step-up + second mutation so timeline has >= 2 visible nodes
    const flagKey = `i06_long_flag_alignment_${Date.now().toString(36).slice(-5)}`;
    await pointerClick("#newFeatureFlagBtn");
    const newCapsule = await page.evaluate("document.getElementById('featureFlagStateCapsule')?.dataset.state || ''");
    assert.equal(newCapsule, "new");
    await page.setFields({ "#featureFlagKey": flagKey, "#featureFlagDescription": "I06 capsule timeline & mobile alignment check", "#featureFlagPercentage": "50" });
    await pointerClick("#featureFlagEnabled");
    const liveOnState = await page.evaluate("document.getElementById('featureFlagStateCapsule')?.dataset.state || ''");
    assert.equal(liveOnState, "on", "Live toggle should immediately update status capsule to 'on'");
    await pointerClick("#saveFeatureFlagBtn");
    await page.waitFor("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]'))", 15_000, "task27 prompt");
    await page.setFields({ "#task27Prompt input[name='password']": password });
    await pointerClick("#task27Prompt button[type='submit']");
    await page.waitFor("document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存')", 15_000, "flag saved");

    // Perform a second mutation (select the created flag, update rollout to 75%, handle step-up) to produce >= 2 audit timeline rows
    await pointerClick(`#featureFlagSummaryList [data-flag-key="${flagKey}"]`);
    await page.setFields({ "#featureFlagPercentage": "75" });
    await page.evaluate("const s = document.getElementById('featureConsoleStatus'); if (s) s.textContent = '';");
    await pointerClick("#saveFeatureFlagBtn");
    await page.waitFor("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]')) || document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存')", 15_000, "second mutation step-up or save");
    if (await page.evaluate("Boolean(document.querySelector('#task27Prompt:not(.hidden) input[name=\"password\"]'))")) {
      await page.setFields({ "#task27Prompt input[name='password']": password });
      await pointerClick("#task27Prompt button[type='submit']");
    }
    await page.waitFor("document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存') && document.querySelectorAll('#featureFlagAuditTimeline .feature-audit-item').length >= 2", 15_000, "second audit timeline entry");

    // Open audit timeline details and frame multiple timeline nodes
    await page.evaluate(`(() => {
      const details = document.querySelector('#adminFeatureFlagsView details');
      if (details && !details.open) details.open = true;
      document.getElementById('featureFlagAuditTimeline')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    })()`);
    await settle();
    const afterSave = await page.evaluate(`({
      sameForm: window.__i06FlagForm === document.getElementById('featureFlagForm'),
      sameCb: window.__i06FlagCb === document.getElementById('featureFlagEnabled'),
      removedCount: window.__i06RemovedCount,
      auditHasKey: document.getElementById('featureFlagAudit')?.textContent?.includes(${JSON.stringify(flagKey)}) || false,
      timelineCount: document.querySelectorAll('#featureFlagAuditTimeline .feature-audit-item').length,
      timelineHasKey: document.getElementById('featureFlagAuditTimeline')?.textContent?.includes(${JSON.stringify(flagKey)}) || false,
    })`);
    assert.equal(afterSave.sameForm, true);
    assert.equal(afterSave.sameCb, true);
    assert.equal(afterSave.removedCount, 0);
    assert.equal(afterSave.auditHasKey, true);
    assert.ok(afterSave.timelineCount >= 2 && afterSave.timelineHasKey, `Structured audit timeline missing >=2 entries: ${JSON.stringify(afterSave)}`);
    await shot("1440-i06-admin-flags-timeline-light.png");

    // Verify mobile 390 dark and 375 light directory column alignment, touch targets, selection switching, and form proximity
    const checkFlagsMobile = async (label) => {
      await page.evaluate(`(() => {
        const strip = document.getElementById('featureFlagCapsuleStrip');
        const nav = document.getElementById('accountBar');
        const y = window.scrollY + (strip?.getBoundingClientRect().top || 0) - (nav?.getBoundingClientRect().bottom || 0) - 8;
        window.scrollTo(0, Math.max(0, y));
      })()`);
      await settle();
      const stats = await page.evaluate(`(() => {
        const list = document.getElementById('featureFlagSummaryList');
        const items = [...list.querySelectorAll('.feature-directory-item')];
        const pillRights = items.map(el => el.querySelector('.feature-capsule')?.getBoundingClientRect().right || 0);
        const minHeight = Math.min(...items.map(el => el.getBoundingClientRect().height));
        const listRect = list.getBoundingClientRect();
        const formRect = document.getElementById('featureFlagForm').getBoundingClientRect();
        return {
          count: items.length,
          minHeight,
          pillRightSpread: Math.max(...pillRights) - Math.min(...pillRights),
          listHeight: listRect.height,
          formTop: formRect.top,
          vh: window.innerHeight,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      })()`);
      assert.ok(stats.count >= 2, `${label} expected multiple flags: ${JSON.stringify(stats)}`);
      assert.ok(stats.minHeight >= 44, `${label} flag directory touch target < 44px: ${JSON.stringify(stats)}`);
      assert.ok(stats.pillRightSpread <= 2, `${label} ON/OFF pills misaligned horizontally: ${JSON.stringify(stats)}`);
      assert.ok(stats.listHeight <= 230, `${label} mobile directory should stay compact (<=230px): ${JSON.stringify(stats)}`);
      assert.ok(stats.formTop < stats.vh - 180, `${label} edit form pushed too far down (${stats.formTop}): ${JSON.stringify(stats)}`);
      assert.ok(stats.overflow <= 1, `${label} horizontal overflow: ${JSON.stringify(stats)}`);
      return stats;
    };

    await setViewport(390, 844);
    await setTheme("dark");
    // Switch selection to the newly created ON long-key flag and verify form + capsule sync
    await pointerClick(`#featureFlagSummaryList [data-flag-key="${flagKey}"]`);
    const switchedOn = await page.evaluate(`({
      ariaCurrent: document.querySelector('#featureFlagSummaryList [data-flag-key="${flagKey}"]')?.getAttribute('aria-current'),
      formKey: document.getElementById('featureFlagKey')?.value || '',
      capsuleState: document.getElementById('featureFlagStateCapsule')?.dataset.state || '',
    })`);
    assert.equal(switchedOn.ariaCurrent, "true");
    assert.equal(switchedOn.formKey, flagKey);
    assert.equal(switchedOn.capsuleState, "on");
    const mobileFlags390 = await checkFlagsMobile("390-dark");
    await shot("390-i06-admin-flags-dark.png");

    // Switch back to an OFF flag on 375px light
    await setViewport(375, 812);
    await setTheme("light");
    await pointerClick('#featureFlagSummaryList [data-flag-key="adaptive_learning"]');
    const switchedOff = await page.evaluate(`({
      ariaCurrent: document.querySelector('#featureFlagSummaryList [data-flag-key="adaptive_learning"]')?.getAttribute('aria-current'),
      formKey: document.getElementById('featureFlagKey')?.value || '',
      capsuleState: document.getElementById('featureFlagStateCapsule')?.dataset.state || '',
    })`);
    assert.equal(switchedOff.ariaCurrent, "true");
    assert.equal(switchedOff.formKey, "adaptive_learning");
    assert.equal(switchedOff.capsuleState, "off");
    const mobileFlags375 = await checkFlagsMobile("375-light");
    await shot("375-i06-admin-flags-light.png");

    await setTheme("light");
    await setViewport(1440, 900);
    return { preNodes, newCapsule, liveOnState, afterSave, mobileFlags390, mobileFlags375, switchedOn, switchedOff };
  });

  // Cross-module axe-core a11y + P07 OFF + runtime/5xx clean
  await recordScenario("a11y_p07_off_and_runtime_clean", async () => {
    await waitForApiIdle();
    for (const nav of ["language", "finance", "tools", "transfer", "admin"]) {
      await pointerClick(`#v3Sidebar [data-v3-nav="${nav}"]`);
      await waitForApiIdle();
      await delay(180);
      await settle();
      await page.evaluate(axeSource);
      const res = await page.evaluate(`axe.run(document).then(r => ({
        violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 2).map(n => n.target) })),
        passes: r.passes.length,
      }))`);
      const serious = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      report.axeScans.push({ route: nav, violationCount: res.violations.length, seriousOrCriticalCount: serious.length, passes: res.passes });
      assert.equal(serious.length, 0, `Serious/critical axe violations on ${nav}: ${JSON.stringify(serious)}`);
    }

    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    try {
      await page.navigate("/admin");
      await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui !== 'enabled' && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 20_000, "P07 OFF admin");
      await pointerClick("#adminFeatureFlagsTab");
      const p07Off = await page.evaluate(`({
        capsulesDisplay: getComputedStyle(document.getElementById('featureFlagCapsuleStrip')).display,
        timelineDisplay: getComputedStyle(document.getElementById('featureFlagAuditTimeline')).display,
        auditDisplay: getComputedStyle(document.getElementById('featureFlagAudit')).display,
      })`);
      assert.equal(p07Off.capsulesDisplay, "none");
      assert.equal(p07Off.timelineDisplay, "none");
      assert.notEqual(p07Off.auditDisplay, "none");
    } finally {
      await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    }

    report.runtimeErrors = page.runtimeErrors.slice();
    report.apiErrors = apiErrors.slice();
    assert.equal(report.runtimeErrors.length, 0, `Runtime errors: ${JSON.stringify(report.runtimeErrors)}`);
    assert.equal(report.apiErrors.length, 0, `5xx errors: ${JSON.stringify(report.apiErrors)}`);
    return { axeRoutes: report.axeScans.length, p07OffChecked: true };
  });

  const endSource = await captureSource(root);
  assert.equal(endSource.commit, source.commit);
  assert.equal(endSource.inputsSha256, source.inputsSha256);
  report.sourceVerifiedAtEnd = true;
  report.status = "PASS";
  console.log(`${report.scenarios.length} I06 SCENARIOS PASSED (${report.screenshots.length} screenshots)`);
} catch (error) {
  report.status = "FAIL";
  report.error = error.message;
  throw error;
} finally {
  const pendingEvidence = path.join(evidenceDir, "i06-acceptance-report.json.tmp");
  await writeFile(pendingEvidence, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await rename(pendingEvidence, path.join(evidenceDir, "i06-acceptance-report.json"));
  console.log(`I06 evidence: ${evidenceDir}`);
  if (page) await page.close().catch(() => {});
  child.kill("SIGKILL");
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose().catch(() => {});
  await unlink(tempUploadFile).catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(mfPersist, { recursive: true, force: true }).catch(() => {});
}
