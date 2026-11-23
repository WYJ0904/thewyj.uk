import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";
import { onRequest } from "../../functions/api/[[path]].js";
import { onRequest as status } from "../../functions/api/status.js";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { captureSource, pngProof, viewportProof } from "../i05/browser-proofs.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceOutDir = path.join(root, "docs", "ui-rebuild", "i10", "evidence");
await mkdir(evidenceOutDir, { recursive: true });
const source = await captureSource(root);

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mfPersist = await mkdtemp(path.join(os.tmpdir(), "aeris-i10-mf-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i10 fixture'); } }",
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
  catch (err) { if (!isPoisoned(err)) throw err; await refreshBindings(true); return await fn(rawDb); }
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
  catch (err) { if (!isPoisoned(err)) throw err; await refreshBindings(true); return await fn(rawStorage); }
}
const storage = {
  get(key, opts) { return withR2Retry((s) => s.get(key, opts)); },
  put(key, val, opts) { return withR2Retry((s) => s.put(key, val, opts)); },
  delete(keys) { return withR2Retry((s) => s.delete(keys)); },
  list(opts) { return withR2Retry((s) => s.list(opts)); },
  head(key) { return withR2Retry((s) => s.head(key)); },
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
  WYJ_TASK12_PASSWORD_PEPPER: "i10-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i10-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i10-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-I10-Browser-Password!";
const now = new Date().toISOString();
const nowMs = Date.now();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I10 browser acceptance public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i10-seed', 'i10-seed'),
         ('aeris_experimental_badge', 'I10 kill switch & channel test flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i10-seed-2', 'i10-seed-2')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();

const adminId = "i10-browser-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i10admin', 'i10admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();

const normalId = "i10-browser-user";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i10user', 'i10user', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3)`)
  .bind(normalId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(normalId, now).run();
await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
  VALUES ('mem_i10_001', ?1, 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i10-fixture', ?1, '{}', ?2, ?2)`)
  .bind(adminId, now).run();
await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_i10_inc', ?1, '合成工资收入', 'income', '#0f766e', 'active', 1, 1, ?2, ?2, ''),
         ('cat_i10_exp', ?1, '合成日常采购', 'expense', '#b91c1c', 'active', 1, 1, ?2, ?2, '')`)
  .bind(adminId, now).run();
for (let i = 1; i <= 4; i += 1) {
  await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_at, updated_at, deleted_at)
    VALUES (?1, ?2, 'expense', ?3, 'CNY', 'cat_i10_exp', ?4, '', 'I10 drawer fixture', ?5, 'manual', 'confirmed', 'active', 1, 1, ?6, ?6, '')`)
    .bind(`tx_i10_000${i}`, adminId, 1000 * i, `Merchant ${i}`, nowMs - i * 1000, now).run();
}

let failNextReceipt503 = false;

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
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname.startsWith("/api/")) {
      if (failNextReceipt503 && url.pathname === "/api/messages/receipt") {
        failNextReceipt503 = false;
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, code: "service_unavailable", error: "通知回执服务暂时繁忙（503），请点击重试。" }));
        return;
      }
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
      if (response.status >= 500) apiErrors.push({ path: url.pathname, status: response.status });
      const headersOut = Object.fromEntries(response.headers);
      delete headersOut["content-length"];
      const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      if (setCookies.length) headersOut["set-cookie"] = setCookies;
      res.writeHead(response.status, headersOut);
      res.end(bodyBuf);
      await Promise.all(tasks);
      return;
    }
    const file = isSpaPath(url.pathname) ? "index.html" : url.pathname.slice(1);
    if (!isAllowedPagesFile(file) || file.startsWith("functions/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": mimeFor(file), "Content-Security-Policy": csp, "Cache-Control": "no-store" });
    res.end(await readFile(path.join(root, file)));
  } catch (error) {
    res.writeHead(500);
    res.end("fixture error");
    console.error(error);
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i10-chrome-"));
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

const axeSource = await readFile(path.join(root, "qa", "p07-f", "vendor", "axe.min.js"), "utf8");
const report = {
  scope: "Isolated local Miniflare D1/R2 + headless Chrome CDP (I10 Full-Site Interaction, Motion, A11y & Perf Acceptance)",
  gitSha: source.commit,
  gitBranch: source.branch,
  worktreeDirty: !source.sourceMatchesCommit,
  checkedAt: new Date().toISOString(),
  scenarios: [],
  axeScans: [],
  contrastAudits: [],
  viewports: [],
  performanceMetrics: {},
  screenshots: [],
  apiErrors: [],
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
  page = await openPage({ cdpUrl: `http://127.0.0.1:${port}`, baseUrl: base, width: 1440, height: 900, mobile: false });
  await page.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});

  const settle = async () => {
    await page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
  };
  const setViewport = async (width, height = 900) => {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: width <= 980 });
    await settle();
  };
  const setTheme = async (theme) => {
    await page.evaluate(`(() => { localStorage.setItem('wyj_theme_preference_v1', ${JSON.stringify(theme)}); location.reload(); })()`);
    await page.waitFor("document.documentElement.dataset.bootState === 'ready'", 20_000, `theme ${theme} ready`);
    await settle();
  };
  const shot = async (name) => {
    await settle();
    const observed = await viewportProof(page);
    const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const png = Buffer.from(data.data, "base64");
    const pixels = pngProof(png);
    assert.deepEqual([pixels.width, pixels.height], [observed.width, observed.height]);
    await writeFile(path.join(evidenceOutDir, name), png);
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
    await delay(80);
  };
  const pressKey = async (key, code = key, modifiers = 0) => {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
    await delay(60);
  };
  const runAxe = async (label) => {
    await page.evaluate(axeSource);
    const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)), passes: r.passes.length }))");
    report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes });
    assert.equal(res.violations.length, 0, `axe violations on ${label}: ${JSON.stringify(res.violations)}`);
  };
  const auditContrast = async (rootSelector, label) => {
    const violations = await page.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(rootSelector)});
      if (!root) throw new Error('missing contrast root: ' + ${JSON.stringify(rootSelector)});
      const parse = (value) => {
        const parts = (String(value).match(/[0-9.]+/g) || []).map(Number);
        return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
      };
      const blend = (top, bottom) => {
        const alpha = Math.max(0, Math.min(1, top[3]));
        return [
          top[0] * alpha + bottom[0] * (1 - alpha),
          top[1] * alpha + bottom[1] * (1 - alpha),
          top[2] * alpha + bottom[2] * (1 - alpha),
          1,
        ];
      };
      const luminance = (rgba) => {
        const channels = rgba.slice(0, 3).map((part) => {
          const value = part / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const backgroundFor = (element) => {
        const chain = [];
        for (let current = element; current; current = current.parentElement) chain.push(current);
        let background = [255, 255, 255, 1];
        chain.reverse().forEach((current) => {
          background = blend(parse(getComputedStyle(current).backgroundColor), background);
        });
        return background;
      };
      const candidates = [...root.querySelectorAll('button,input,textarea,select,p,span,small,strong,h1,h2,h3,h4,label,output,code')];
      const violations = [];
      for (const element of candidates) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (element.classList.contains('visually-hidden') || element.classList.contains('sr-only') || rect.width < 1 || rect.height < 1) continue;
        let rendered = true;
        for (let current = element; current && current !== root.parentElement; current = current.parentElement) {
          const currentStyle = getComputedStyle(current);
          if (current.hidden || currentStyle.display === 'none' || currentStyle.visibility === 'hidden' || Number(currentStyle.opacity) <= 0.01) {
            rendered = false;
            break;
          }
        }
        if (!rendered || style.display === 'none' || style.visibility === 'hidden') continue;
        const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!ownText && !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) continue;
        const background = backgroundFor(element);
        let foreground = blend(parse(style.color), background);
        let opacity = 1;
        for (let current = element; current && current !== root.parentElement; current = current.parentElement) {
          opacity *= Number(getComputedStyle(current).opacity) || 0;
        }
        foreground = blend([foreground[0], foreground[1], foreground[2], opacity], background);
        const ratio = (Math.max(luminance(foreground), luminance(background)) + 0.05)
          / (Math.min(luminance(foreground), luminance(background)) + 0.05);
        if (ratio < 4.5) violations.push({
          selector: element.id ? '#' + element.id : element.tagName.toLowerCase(),
          text: (element.value || element.textContent || '').trim().slice(0, 40),
          ratio: Number(ratio.toFixed(2)),
          color: style.color,
        });
      }
      return violations;
    })()`);
    report.contrastAudits.push({ label, rootSelector, violationCount: violations.length });
    assert.deepEqual(violations, [], `Contrast violations on ${label}: ${JSON.stringify(violations)}`);
  };
  const recordScenario = async (name, fn) => {
    const started = Date.now();
    const detail = await fn();
    report.scenarios.push({ name, status: "PASS", ms: Date.now() - started, detail });
    console.log(`PASS scenario: ${name}`);
  };

  // 1. Public home, tab scroll stability, prefetch hygiene, 5 viewports x Light/Dark
  await recordScenario("i10_public_home_tabs_scroll_and_viewports", async () => {
    await page.navigate("/");
    await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled'", 20_000, "public home ready");
    await page.evaluate(`(() => {
      window.__i10Perf = { cls: 0, longTasks: 0 };
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__i10Perf.cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (_) {}
      try {
        new PerformanceObserver((list) => {
          window.__i10Perf.longTasks += list.getEntries().length;
        }).observe({ type: 'longtask', buffered: true });
      } catch (_) {}
    })()`);

    // Check guest leak isolation
    const guestCheck = await page.evaluate(`({
      mode: document.querySelector('#publicHome')?.dataset.sessionMode,
      greeting: document.querySelector('#dashboardGreeting')?.textContent?.trim() || '',
      adminHidden: document.querySelector('#v3SidebarAdminLink')?.hidden !== false || getComputedStyle(document.querySelector('#v3Sidebar')).display === 'none',
      prefetchLinks: [...document.querySelectorAll('link[rel="prefetch"]')].map(l => l.getAttribute('href')),
    })`);
    assert.equal(guestCheck.mode, "guest");
    assert.equal(guestCheck.greeting, "");
    assert.equal(guestCheck.prefetchLinks.some(h => /\/api\//.test(String(h))), false, "Prefetch must never target /api/");

    // Scroll to preview tabs and verify zero jump across all 4 tabs
    await page.evaluate("document.querySelector('[data-product-window]').scrollIntoView({ block: 'center', behavior: 'instant' })");
    await settle();
    const yBefore = await page.evaluate("window.scrollY");
    const tabTimes = [];
    for (const prod of ["finance", "files", "tools", "learning"]) {
      const t0 = await page.evaluate("performance.now()");
      await pointerClick(`[data-public-product="${prod}"]`);
      await page.waitFor(`document.querySelector('[data-product-window]')?.dataset.selected === ${JSON.stringify(prod)}`, 3_000);
      await delay(180);
      const t1 = await page.evaluate("performance.now()");
      tabTimes.push(Math.round(t1 - t0));
      const yNow = await page.evaluate("window.scrollY");
      assert.ok(Math.abs(yNow - yBefore) <= 2, `Preview tab ${prod} caused scroll jump: ${yBefore} -> ${yNow}`);
    }
    report.performanceMetrics.publicTabSwitchMs = tabTimes;

    // 5 viewports x light/dark
    for (const theme of ["light", "dark"]) {
      await setTheme(theme);
      for (const [w, h] of [[375, 812], [390, 844], [768, 900], [1024, 768], [1440, 900]]) {
        await setViewport(w, h);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
        assert.ok(overflow <= 1, `Public overflow at ${w}px ${theme}: ${overflow}`);
        report.viewports.push({ route: "/", theme, width: w, overflow });
      }
    }
    await setTheme("light");
    await setViewport(1440, 900);
    await runAxe("i10-public-home-1440-light");
    await shot("i10-public-home-1440-light.png");
    return { guestCheck, tabTimes };
  });

  // 2. Admin login + HUD coexistence (#versionNotice + SaveStatus + Toast + Drawer + Sheet)
  await recordScenario("i10_hud_layering_drawer_and_bottom_sheet", async () => {
    await page.navigate("/login");
    await page.waitFor("document.documentElement.dataset.bootState === 'ready' && Boolean(document.querySelector('#loginForm'))", 20_000);
    await page.evaluate("localStorage.removeItem('wyjSeenChangelogVersion')");
    await page.setFields({ "#usernameInput": "i10admin", "#secretInput": password });
    await pointerClick("#loginSubmitBtn");
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && !document.getElementById('authTransitionScreen')", 25_000, "admin signed in");
    await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 10_000);

    // Trigger simultaneous #siteMessageSaveStatus + #versionNotice + Toast
    failNextReceipt503 = true;
    await pointerClick("#siteMessageCloseBtn");
    await page.waitFor("!document.getElementById('siteMessageSaveStatus').classList.contains('hidden') && !document.getElementById('versionNotice').classList.contains('hidden')", 8_000);
    await page.evaluate(`(() => {
      window.WYJMotion.showToast({ tone: 'info', message: 'I10 协同层叠提示：不遮挡版本卡片' }, {}, document);
    })()`);
    await settle();

    for (const [w, h] of [[1440, 900], [1024, 768], [768, 900], [390, 844], [375, 812]]) {
      await setViewport(w, h);
      await delay(60);
      const ov = await page.evaluate(`(() => {
        const box = (el) => {
          if (!el || el.classList?.contains('hidden') || el.hidden) return null;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
        };
        const hit = (a, b) => Boolean(a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5);
        const ver = box(document.getElementById('versionNotice'));
        const save = box(document.getElementById('siteMessageSaveStatus'));
        const toast = box(document.querySelector('.ds-toast-region'));
        const nav = box(document.getElementById('accountBar'));
        return {
          verSave: hit(ver, save),
          verToast: hit(ver, toast),
          saveToast: hit(save, toast),
          toastNav: hit(toast, nav),
          verNav: hit(ver, nav),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      })()`);
      assert.equal(ov.verSave, false, `verSave overlap at ${w}`);
      assert.equal(ov.verToast, false, `verToast overlap at ${w}`);
      assert.equal(ov.saveToast, false, `saveToast overlap at ${w}`);
      assert.equal(ov.toastNav, false, `toastNav overlap at ${w}`);
      assert.equal(ov.verNav, false, `verNav overlap at ${w}`);
      assert.ok(ov.overflow <= 1);
    }

    await setViewport(1440, 900);
    await shot("i10-auth-home-hud-1440-light.png");

    // Verify retry clears save status, keep versionNotice visible for drawer test!
    await pointerClick("#siteMessageRetryBtn");
    await page.waitFor("document.getElementById('siteMessageSaveStatus').classList.contains('hidden')", 8_000);
    return { hudVerified: true };
  });

  // 3. Authenticated Workspace Bento: greeting, edit/reorder/hide/restore/save/reload
  await recordScenario("i10_workspace_bento_edit_and_persistence", async () => {
    await setViewport(1440, 900);
    const greeting = await page.evaluate("document.getElementById('dashboardGreeting')?.textContent || ''");
    assert.ok(greeting.includes("i10admin"), `Expected real account username in greeting, got: ${greeting}`);

    await pointerClick("#workspaceCustomizeBtn");
    await pointerClick("#workspaceDensityBtn");
    await pointerClick("#workspaceDensityBtn");
    await pointerClick("[data-workspace-card='learning'] [data-workspace-action='hide']");
    await page.waitFor("!document.getElementById('hiddenWidgetsBar')?.hidden", 3_000);
    await pointerClick("[data-workspace-restore='learning']");
    await page.waitFor("document.getElementById('hiddenWidgetsBar')?.hidden", 3_000);
    await pointerClick("[data-workspace-card='learning'] [data-workspace-action='down']");
    await pointerClick("#workspaceSaveBtn");
    await pointerClick("#workspaceCustomizeBtn");
    const orderBefore = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
    assert.equal(orderBefore[1], "learning");

    await page.navigate("/");
    await page.waitFor("document.documentElement.dataset.bootState === 'ready' && !document.querySelector('#authWorkspaceSection')?.hidden", 20_000);
    const orderAfter = await page.evaluate("[...document.querySelectorAll('#workspaceBentoGrid .workspace-bento-card:not([hidden])')].map(c => c.dataset.workspaceCard)");
    assert.deepEqual(orderAfter, orderBefore, "Workspace order must persist across reload");
    await pointerClick("#workspaceResetBtn");
    return { greeting, orderAfter };
  });

  // 4. Finance: 6 currencies, right drawer vs #versionNotice & Toast avoidance, transform: none for <select>, JPY contract, reload
  await recordScenario("i10_finance_six_currencies_drawer_and_jpy", async () => {
    await pointerClick("#v3Sidebar [data-v3-nav='finance']");
    await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden') && !document.querySelector('#financeAddTransactionBtn')?.disabled", 15_000);

    const currencies = await page.evaluate("[...document.querySelectorAll('#financeTransactionCurrency option')].map(o => o.value)");
    for (const c of ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"]) {
      assert.ok(currencies.includes(c), `Missing currency ${c}`);
    }

    // Open drawer while #versionNotice + Toast are visible!
    await page.evaluate("window.WYJMotion.showToast({ tone: 'info', message: '账本抽屉避让校验' }, {}, document)");
    await pointerClick("#financeAddTransactionBtn");
    await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 5_000);
    await delay(460); // Wait for entry animation to settle

    const drawerCheck = await page.evaluate(`(() => {
      const panel = document.querySelector('#financeTransactionModal .modal-panel');
      const panelRect = panel.getBoundingClientRect();
      const ver = document.getElementById('versionNotice')?.getBoundingClientRect();
      const toast = document.querySelector('.ds-toast-region')?.getBoundingClientRect();
      const hit = (a, b) => Boolean(a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5);
      return {
        panelTransform: getComputedStyle(panel).transform,
        rightDrawerAttr: document.documentElement.dataset.rightDrawerOpen || '',
        verOverlapsDrawer: hit(ver, panelRect),
        toastOverlapsDrawer: hit(toast, panelRect),
        verOverlapsToast: hit(ver, toast),
      };
    })()`);
    assert.equal(drawerCheck.panelTransform, "none", "Drawer panel transform must settle to none so native <select> popups are never trapped");
    assert.equal(drawerCheck.rightDrawerAttr, "true");
    assert.equal(drawerCheck.verOverlapsDrawer, false, "versionNotice must not collide with right drawer");
    assert.equal(drawerCheck.toastOverlapsDrawer, false, "toast must not collide with right drawer");
    assert.equal(drawerCheck.verOverlapsToast, false, "versionNotice and toast must not collide");
    await shot("i10-finance-drawer-hud-1440-light.png");

    // Check mobile bottom sheet at 375px
    await setViewport(375, 812);
    await delay(420);
    const sheetCheck = await page.evaluate(`(() => {
      const panel = document.querySelector('#financeTransactionModal .modal-panel');
      const panelRect = panel.getBoundingClientRect();
      const toast = document.querySelector('.ds-toast-region')?.getBoundingClientRect();
      return {
        panelTransform: getComputedStyle(panel).transform,
        toastOverlapsSheet: Boolean(toast && toast.left < panelRect.right && toast.right > panelRect.left && toast.top < panelRect.bottom && toast.bottom > panelRect.top),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    assert.equal(sheetCheck.panelTransform, "none", "Mobile bottom sheet transform must settle to none");
    assert.equal(sheetCheck.toastOverlapsSheet, false);
    assert.ok(sheetCheck.overflow <= 1);
    await shot("i10-finance-sheet-375-light.png");
    await setViewport(1440, 900);

    // Create JPY transaction and verify integer validation + persistence
    await page.setFields({
      "#financeTransactionCurrency": "JPY",
      "#financeTransactionAmount": "1250",
      "#financeTransactionMerchant": "I10 Tokyo Store",
    });
    await pointerClick("#financeTransactionModal button[type='submit']");
    await page.waitFor("document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 5_000);
    await pointerClick("#financeSyncBtn");
    await delay(400);
    const jpyVisible = await page.evaluate("document.querySelector('#financeTransactionList')?.textContent?.includes('I10 Tokyo Store')");
    assert.equal(jpyVisible, true);
    await runAxe("i10-finance-1440-light");
    return { currencies, drawerCheck, sheetCheck };
  });

  // 5. Toolbox & Workflows: WCAG AA contrast (light/dark + P07 ON/OFF), Enter launch, Esc return + focus restore, copy double-click
  await recordScenario("i10_tools_keyboard_esc_contrast_and_workflows", async () => {
    await pointerClick("#v3Sidebar [data-v3-nav='tools']");
    await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && window.WYJTools?.isReady?.() === true", 15_000);

    // Dismiss versionNotice now for clean page screenshots after verifying it earlier
    await pointerClick("#dismissVersionNoticeBtn");
    await auditContrast("#toolsPanel", "tools-1440-light-p07-on");
    await shot("i10-tools-1440-light.png");

    // Check 390px Dark mode contrast as well
    await setTheme("dark");
    await pointerClick("#v3Sidebar [data-v3-nav='tools']");
    await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && window.WYJTools?.isReady?.() === true", 15_000);
    await setViewport(390, 844);
    await auditContrast("#toolsPanel", "tools-390-dark-p07-on");
    await shot("i10-tools-390-dark.png");

    await setViewport(1440, 900);
    await setTheme("light");
    await pointerClick("#v3Sidebar [data-v3-nav='tools']");
    await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden') && window.WYJTools?.isReady?.() === true", 15_000);

    // Search + ArrowDown + Enter launches tool and moves focus into workbench
    await page.evaluate("document.getElementById('toolSearchInput').focus()");
    await page.setFields({ "#toolSearchInput": "json" });
    await delay(220);
    await pressKey("ArrowDown", "ArrowDown");
    await pressKey("Enter", "Enter");
    await page.waitFor("!document.querySelector('#toolWorkbench')?.classList.contains('hidden')", 5_000, "Enter opened tool workbench");
    const focusInWorkbench = await page.evaluate("Boolean(document.getElementById('toolWorkbench')?.contains(document.activeElement))");
    assert.equal(focusInWorkbench, true, "Focus must move into #toolWorkbench on keyboard Enter launch");

    // Double-click copy button must restore original label cleanly after 1.3s
    await page.setFields({ "#textToolInput": '{"a":1}' });
    await pointerClick("#runTextToolBtn");
    await delay(80);
    await pointerClick("#copyTextToolBtn");
    await delay(50);
    await pointerClick("#copyTextToolBtn");
    await delay(1400);
    const copyLabel = await page.evaluate("document.getElementById('copyTextToolBtn')?.textContent?.trim()");
    assert.equal(copyLabel, "复制结果", `Copy button label corrupted by rapid clicks: ${copyLabel}`);

    // Escape returns from #toolWorkbench to #toolsDashboard and restores focus
    await pressKey("Escape", "Escape");
    await page.waitFor("!document.querySelector('#toolsDashboard')?.classList.contains('hidden') && document.querySelector('#toolWorkbench')?.classList.contains('hidden')", 5_000, "Esc returned to tools dashboard");
    const focusAfterEsc = await page.evaluate("Boolean(document.getElementById('toolsDashboard')?.contains(document.activeElement))");
    assert.equal(focusAfterEsc, true, "Esc return must restore focus inside #toolsDashboard");

    // Workflows: open, create text workflow, run, copy feedback, close restores focus & header
    await pointerClick("#openWorkflowBtn");
    await page.waitFor("!document.querySelector('#workflowWorkspace')?.classList.contains('hidden') && Boolean(document.querySelector(\"[data-workflow-template='text-clean']\")) && !document.getElementById('openWorkflowBtn')?.disabled", 8_000, "workflow workspace ready");
    await pointerClick("#createWorkflowBtn");
    await page.setFields({ "#workflowToolSelect": "remove-empty-lines" });
    await pointerClick("#addWorkflowStepBtn");
    await page.setFields({ "#workflowTextInput": "b\n\na\n" });
    await pointerClick("#runWorkflowBtn");
    await page.waitFor("document.getElementById('workflowRunState')?.dataset.status === 'success'", 8_000, "workflow run completed");
    await pointerClick("#copyWorkflowResultBtn");
    await delay(80);
    const wfCopyLabel = await page.evaluate("document.getElementById('copyWorkflowResultBtn')?.textContent?.trim()");
    assert.equal(wfCopyLabel, "已复制");
    await pointerClick("#closeWorkflowBtn");
    await page.waitFor("!document.querySelector('#toolsDashboard')?.classList.contains('hidden')", 5_000);
    const wfCloseState = await page.evaluate("({ activeId: document.activeElement?.id || '', headerHidden: Boolean(document.querySelector('#toolsPanel .tools-header')?.classList.contains('hidden')) })");
    assert.equal(wfCloseState.activeId, "openWorkflowBtn");
    assert.equal(wfCloseState.headerHidden, false, ".tools-header must be restored when closing workflows");

    await runAxe("i10-tools-1440-light");
    return { focusInWorkbench, copyLabel, focusAfterEsc, wfCopyLabel, wfCloseState };
  });

  // 6. Command Palette (Ctrl+K, ARIA activedescendant, Esc restore) + Reduced Motion
  await recordScenario("i10_command_palette_and_reduced_motion", async () => {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await pointerClick("#v3CmdTrigger");
    await page.waitFor("!document.querySelector('#commandPaletteModal')?.classList.contains('hidden')", 5_000);
    await pressKey("ArrowDown", "ArrowDown");
    const activeDesc = await page.evaluate("document.getElementById('commandPaletteInput')?.getAttribute('aria-activedescendant') || ''");
    assert.ok(activeDesc.startsWith("v3CmdOption_"), `Expected aria-activedescendant, got: ${activeDesc}`);
    await pressKey("Escape", "Escape");
    await page.waitFor("document.querySelector('#commandPaletteModal')?.classList.contains('hidden')", 5_000);
    const restoredId = await page.evaluate("document.activeElement?.id || ''");
    assert.equal(restoredId, "v3CmdTrigger");
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    return { activeDesc, restoredId };
  });

  // 7. P07 OFF contrast & normal user privilege isolation
  await recordScenario("i10_p07_off_contrast_and_user_isolation", async () => {
    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    try {
      await page.navigate("/tools");
      await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'disabled' && !document.querySelector('#toolsPanel')?.classList.contains('hidden')", 20_000);
      await auditContrast("#toolsPanel", "tools-1440-light-p07-off");
    } finally {
      await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    }

    // Switch to normal non-admin user
    await page.evaluate("localStorage.clear();");
    await page.navigate("/login");
    await page.waitFor("document.documentElement.dataset.bootState === 'ready' && Boolean(document.querySelector('#loginForm'))", 20_000);
    await page.setFields({ "#usernameInput": "i10user", "#secretInput": password });
    await pointerClick("#loginSubmitBtn");
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden", 25_000);
    const priv = await page.evaluate(`(async () => {
      const token = localStorage.getItem('wyjAccountSession') || '';
      const r = await fetch('/api/admin/feature-flags', { headers: { 'X-Session-Token': token } });
      return {
        adminLinkHidden: document.getElementById('v3SidebarAdminLink')?.hidden === true,
        adminStatus: r.status,
      };
    })()`);
    assert.equal(priv.adminLinkHidden, true);
    assert.equal(priv.adminStatus, 403);
    return priv;
  });

  report.performanceMetrics.clsAndLongTasks = await page.evaluate("window.__i10Perf || {}");
  report.apiErrors = apiErrors;
  report.runtimeErrors = page.runtimeErrors;
  assert.deepEqual(apiErrors, [], `Unexpected 5xx API errors: ${JSON.stringify(apiErrors)}`);
  assert.deepEqual(page.runtimeErrors, [], `Unexpected runtime errors: ${JSON.stringify(page.runtimeErrors)}`);

  await writeFile(path.join(evidenceOutDir, "i10-acceptance-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`ALL_I10_ACCEPTANCE_SCENARIOS_PASSED (${report.scenarios.length} scenarios, ${report.axeScans.length} axe scans, ${report.contrastAudits.length} contrast audits, ${report.screenshots.length} screenshots)`);
} finally {
  if (page) await page.close().catch(() => {});
  server.close();
  try { child.kill(); } catch (_) {}
  await mf.dispose().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(mfPersist, { recursive: true, force: true }).catch(() => {});
}
