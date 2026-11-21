import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { openPage, delay } from "../../local-backend/browser_harness.mjs";
import { onRequest } from "../../functions/api/[[path]].js";
import { onRequest as status } from "../../functions/api/status.js";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i05", "evidence");
await mkdir(evidenceDir, { recursive: true });

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mfPersist = await mkdtemp(path.join(os.tmpdir(), "aeris-i05-mf-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i05 fixture'); } }",
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
  try {
    return await fn(rawDb);
  } catch (err) {
    if (!isPoisoned(err)) throw err;
    await refreshBindings();
    return await fn(rawDb);
  }
}
function makeLazyStmt(sql, args = []) {
  const compile = (targetDb) => {
    const stmt = targetDb.prepare(sql);
    return args.length ? stmt.bind(...args) : stmt;
  };
  return {
    _sql: sql,
    _args: args,
    bind(...nextArgs) {
      return nextArgs.length ? makeLazyStmt(sql, nextArgs) : this;
    },
    first(col) {
      return withDbRetry((d) => (col === undefined ? compile(d).first() : compile(d).first(col)));
    },
    all() {
      return withDbRetry((d) => compile(d).all());
    },
    run() {
      return withDbRetry((d) => compile(d).run());
    },
    raw(opts) {
      return withDbRetry((d) => (opts === undefined ? compile(d).raw() : compile(d).raw(opts)));
    },
  };
}
const db = {
  prepare(sql) {
    return makeLazyStmt(sql);
  },
  exec(sql) {
    return withDbRetry((d) => d.exec(sql));
  },
  dump() {
    return withDbRetry((d) => d.dump());
  },
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
  try {
    return await fn(rawStorage);
  } catch (err) {
    if (!isPoisoned(err)) throw err;
    await refreshBindings();
    return await fn(rawStorage);
  }
}
function wrapMultipart(key, uploadId, initialUpload = null) {
  let current = initialUpload;
  const getUpload = (s) => (current ||= s.resumeMultipartUpload(key, uploadId));
  return {
    key,
    uploadId,
    uploadPart: (partNumber, value) => withR2Retry(async (s) => {
      try {
        return await getUpload(s).uploadPart(partNumber, value);
      } catch (err) {
        current = null;
        throw err;
      }
    }),
    complete: (parts) => withR2Retry(async (s) => {
      try {
        return await getUpload(s).complete(parts);
      } catch (err) {
        current = null;
        throw err;
      }
    }),
    abort: () => withR2Retry(async (s) => {
      try {
        return await getUpload(s).abort();
      } catch (err) {
        current = null;
        throw err;
      }
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
  WYJ_TASK12_PASSWORD_PEPPER: "i05-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i05-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i05-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-I05-Browser-Password!";
const now = new Date().toISOString();
const nowMs = Date.now();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I05 browser acceptance public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i05-seed', 'i05-seed')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();

const adminId = "i05-browser-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i05admin', 'i05admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();
await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
  VALUES ('mem_i05_001', ?1, 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i05-fixture', ?1, '{}', ?2, ?2)`)
  .bind(adminId, now).run();

await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_i05_inc', ?1, '合成工资收入', 'income', '#0f766e', 'active', 1, 1, ?2, ?2, ''),
         ('cat_i05_exp', ?1, '合成日常采购', 'expense', '#b91c1c', 'active', 1, 1, ?2, ?2, '')`)
  .bind(adminId, now).run();
await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('tx_i05_0001', ?1, 'income', 500000, 'CNY', 'cat_i05_inc', 'Synthetic Payroll', '', 'I05 fixture income', ?2, 'manual', 'confirmed', 'active', 1, 1, ?3, ?3, ''),
         ('tx_i05_0002', ?1, 'expense', 12800, 'CNY', 'cat_i05_exp', 'Synthetic Supply', '', 'I05 fixture expense', ?2, 'manual', 'confirmed', 'active', 1, 1, ?3, ?3, '')`)
  .bind(adminId, nowMs, now).run();

const userId = "i05-browser-user";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i05user', 'i05user', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3)`)
  .bind(userId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(userId, now).run();
await db.prepare(`INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at)
  VALUES (?1, 'tools_access', 1, 'i05 fixture', ?2, ?3),
         (?1, 'finance_access', 1, 'i05 fixture', ?2, ?3),
         (?1, 'temporary_share_access', 1, 'i05 fixture', ?2, ?3)`)
  .bind(userId, adminId, now).run();

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
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i05-chrome-"));
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
  scope: "Isolated local Miniflare D1/R2 + headless Chrome CDP (I05)",
  gitSha,
  browserVersion: "",
  scenarios: [],
  viewportMatrix: [],
  axeScans: [],
  screenshots: [],
  apiErrors: [],
  runtimeErrors: [],
  android_physical_device: "NOT_TESTED",
  production_release: "NOT_TOUCHED",
};

const tempUploadFile = path.join(os.tmpdir(), "i05-long-filename-acceptance-fixture-0123456789abcdefghijklmnopqrstuvwxyz.txt");
await writeFile(tempUploadFile, "I05 synthetic transfer fixture payload\n", "utf8");

let page;
let userPage;
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
    await targetPage.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 500,
    });
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
    const data = await targetPage.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
    report.screenshots.push(name);
    return name;
  };

  const hitTestElement = async (selector, targetPage = page) => {
    return targetPage.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'missing: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        const ancestors = [];
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const ar = a.getBoundingClientRect();
          const as = getComputedStyle(a);
          if (ar.width <= 0 || ar.height <= 0 || as.display === 'none' || a.hidden) {
            ancestors.push({ tag: a.tagName, id: a.id || '', cls: a.className || '', display: as.display, hidden: Boolean(a.hidden), w: ar.width, h: ar.height });
          }
        }
        return {
          ok: false,
          reason: 'zero-size',
          width: r.width,
          height: r.height,
          path: location.pathname,
          p07: document.documentElement.dataset.p07Ui || '',
          elCls: el.className || '',
          elHidden: Boolean(el.hidden),
          elDisplay: getComputedStyle(el).display,
          ancestors,
        };
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const unobstructed = Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el)));
      return { ok: unobstructed, cx, cy, width: r.width, height: r.height, hitTag: hit?.tagName || '', hitId: hit?.id || '', hitClass: String(hit?.className || '') };
    })()`);
  };

  const pointerClick = async (selector, targetPage = page) => {
    const hit = await hitTestElement(selector, targetPage);
    assert.ok(hit.ok, `Hit-test failed for ${selector}: ${JSON.stringify(hit)}`);
    await targetPage.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy, button: "none" });
    await targetPage.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await targetPage.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await settle(targetPage);
    return hit;
  };

  const signIn = async (targetPage, username) => {
    await targetPage.navigate("/login");
    await targetPage.waitFor("!document.querySelector('#loginForm')?.classList.contains('hidden')", 20_000, "login form");
    await targetPage.setFields({ "#usernameInput": username, "#secretInput": password });
    await targetPage.click("#loginSubmitBtn");
    await targetPage.waitFor(
      "document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0",
      30_000,
      `${username} authenticated`,
    );
    await settle(targetPage);
  };

  const isVisibleExpr = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return Boolean(el && !el.hidden && !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true'); })()`;

  const routeSpecs = [
    { nav: "home", path: "/select", expectedRoute: "home", container: "#authWorkspaceSection", heading: "#authWorkspaceTitle", panel: "#authWorkspaceSection" },
    { nav: "language", path: "/language", expectedRoute: "language", container: "#projectPicker", heading: "#projectPicker h1", panel: "#projectPicker", altContainer: "#languagePanel", altHeading: "#languagePanel h1" },
    { nav: "tools", path: "/tools", expectedRoute: "tools", container: "#toolsPanel", heading: "#toolsPanel h1", panel: "#toolsPanel" },
    { nav: "finance", path: "/finance", expectedRoute: "finance", container: "#financePage", heading: "#financeTitle", panel: "#financePage" },
    { nav: "transfer", path: "/transfer", expectedRoute: "transfer", container: "#transferPage", heading: "#transferTitle", panel: "#transferPage" },
    { nav: "account", path: "/account", expectedRoute: "account", container: "#accountModal", heading: "#accountTitle", panel: "#accountModal" },
    { nav: "admin", path: "/admin", expectedRoute: "admin", container: "#adminPanel", heading: "#adminPanel h1", panel: "#adminPanel" },
  ];

  const openSidebarRoute = async (spec, targetPage = page) => {
    await pointerClick(`#v3Sidebar [data-v3-nav="${spec.nav}"]`, targetPage);
    await targetPage.waitFor(
      `document.body.dataset.workspaceRoute === ${JSON.stringify(spec.expectedRoute)} && (${isVisibleExpr(spec.container)} || (${Boolean(spec.altContainer)} && ${isVisibleExpr(spec.altContainer || "")}))`,
      15_000,
      `route ${spec.nav}`,
    );
    await settle(targetPage);
  };

  const recordScenario = async (name, fn) => {
    const started = Date.now();
    const detail = await fn();
    const ms = Date.now() - started;
    report.scenarios.push({ name, status: "PASS", ms, detail });
    console.log(`PASS scenario: ${name} (${ms}ms)`);
  };

  await signIn(page, "i05admin");

  // Scenario a: 1440x900 7-route sidebar navigation + /select check
  await recordScenario("a_seven_route_sidebar_shell", async () => {
    await setViewport(1440, 900);
    await setTheme("light");
    await page.navigate("/select");
    await page.waitFor(`document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && document.body.dataset.workspaceRoute === 'home' && ${isVisibleExpr("#authWorkspaceSection")} && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0`, 20_000, "/select direct load");
    const selectCrumb = await page.evaluate("document.querySelector('#workspaceBreadcrumb li[aria-current=\"page\"]')?.textContent?.trim() || ''");
    assert.ok(selectCrumb.length > 0, "/select missing active breadcrumb");

    const checked = [];
    for (const spec of routeSpecs) {
      await openSidebarRoute(spec);
      const probe = await page.evaluate(`(() => {
        const route = document.body.dataset.workspaceRoute || '';
        const crumbLi = document.querySelector('#workspaceBreadcrumb li[aria-current="page"]');
        const crumbRect = crumbLi ? crumbLi.getBoundingClientRect() : null;
        const primary = document.querySelector(${JSON.stringify(spec.container)});
        const alt = ${JSON.stringify(spec.altContainer || "")} ? document.querySelector(${JSON.stringify(spec.altContainer || "")}) : null;
        const isShown = (el) => Boolean(el && !el.hidden && !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true');
        const container = isShown(primary) ? primary : (isShown(alt) ? alt : null);
        const headingEl = container?.querySelector('h1, h2') || document.querySelector(${JSON.stringify(spec.heading)});
        const hr = headingEl ? headingEl.getBoundingClientRect() : null;
        const hHit = hr ? document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2) : null;
        const headingOk = Boolean(headingEl && hHit && (headingEl === hHit || headingEl.contains(hHit) || hHit.contains(headingEl)));
        const panelEl = container || document.querySelector(${JSON.stringify(spec.panel)});
        const radiusStr = panelEl ? getComputedStyle(panelEl).borderRadius : '0px';
        const maxRadius = Math.max(...radiusStr.split(/\\s+/).map(s => parseFloat(s) || 0));
        return {
          route,
          pathname: location.pathname,
          crumbText: crumbLi?.textContent?.trim() || '',
          crumbVisible: Boolean(crumbRect && crumbRect.width > 0 && crumbRect.height > 0),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          headingOk,
          headingTag: headingEl?.tagName || '',
          maxRadius,
        };
      })()`);
      assert.equal(probe.route, spec.expectedRoute, `Route mismatch for ${spec.nav}`);
      assert.ok(probe.crumbVisible && probe.crumbText.length > 0, `Breadcrumb not visible on ${spec.nav}`);
      assert.ok(probe.overflow <= 1, `Horizontal overflow on ${spec.nav}: ${probe.overflow}`);
      assert.ok(probe.headingOk, `Heading hit-test failed on ${spec.nav}: ${JSON.stringify(probe)}`);
      assert.ok(probe.maxRadius <= 8.5, `Panel borderRadius > 8px on ${spec.nav}: ${probe.maxRadius}`);
      await shot(`1440-route-${spec.nav}.png`);
      checked.push(probe);
    }
    return { selectCrumb, routes: checked };
  });

  // Scenario b: Browser history Back / Forward
  await recordScenario("b_history_back_forward", async () => {
    await openSidebarRoute(routeSpecs[1]); // language
    await openSidebarRoute(routeSpecs[2]); // tools
    await openSidebarRoute(routeSpecs[3]); // finance
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/tools' && document.body.dataset.workspaceRoute === 'tools'", 10_000, "back to /tools");
    const back1Crumb = await page.evaluate("document.querySelector('#workspaceBreadcrumb li[aria-current=\"page\"]')?.textContent?.trim() || ''");
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/language' && document.body.dataset.workspaceRoute === 'language'", 10_000, "back to /language");
    const back2Crumb = await page.evaluate("document.querySelector('#workspaceBreadcrumb li[aria-current=\"page\"]')?.textContent?.trim() || ''");
    await page.evaluate("history.forward()");
    await page.waitFor("location.pathname === '/tools' && document.body.dataset.workspaceRoute === 'tools'", 10_000, "forward to /tools");
    const fwdCrumb = await page.evaluate("document.querySelector('#workspaceBreadcrumb li[aria-current=\"page\"]')?.textContent?.trim() || ''");
    assert.ok(back1Crumb.includes("工具") && back2Crumb.includes("语言") && fwdCrumb.includes("工具"));
    return { back1Crumb, back2Crumb, fwdCrumb };
  });

  // Scenario c: /tools search focus retention + open tool -> breadcrumb -> back
  await recordScenario("c_tools_search_and_workbench", async () => {
    await openSidebarRoute(routeSpecs[2]); // tools
    await page.waitFor("document.querySelectorAll('#toolCatalog [data-open-tool]').length > 0", 15_000, "tool catalog populated");
    await page.evaluate(`(() => {
      const input = document.getElementById('toolSearchInput');
      input.focus();
      input.value = 'json';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await settle();
    const searchState = await page.evaluate(`({
      focusedId: document.activeElement?.id || '',
      value: document.getElementById('toolSearchInput')?.value || '',
      count: document.querySelectorAll('#toolCatalog [data-open-tool]').length,
    })`);
    assert.equal(searchState.focusedId, "toolSearchInput");
    assert.equal(searchState.value, "json");
    assert.ok(searchState.count >= 1, "No matching tool after searching json");
    await pointerClick("#toolCatalog [data-open-tool]");
    await page.waitFor("location.pathname.startsWith('/tools/') && Boolean(document.querySelector('#toolWorkbenchTitle')?.textContent?.trim())", 10_000, "tool workbench opened");
    await settle();
    const opened = await page.evaluate(`({
      pathname: location.pathname,
      title: document.querySelector('#toolWorkbenchTitle')?.textContent?.trim() || '',
      crumb: document.querySelector('#workspaceBreadcrumb li[aria-current="page"]')?.textContent?.trim() || '',
    })`);
    assert.ok(opened.title.length > 0 && opened.crumb.includes(opened.title), `Tool title missing in breadcrumb: ${JSON.stringify(opened)}`);
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/tools' && !document.querySelector('#toolsPanel')?.classList.contains('hidden')", 10_000, "back to /tools catalog");
    await page.evaluate(`(() => {
      const input = document.getElementById('toolSearchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    return { searchState, opened };
  });

  // Scenario d: /finance currency, month, modal cancel focus restore, tabular-nums, 390px
  await recordScenario("d_finance_filters_modal_tabular_mobile", async () => {
    await openSidebarRoute(routeSpecs[3]); // finance
    await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden')", 15_000, "finance workspace");
    const tabular = await page.evaluate("getComputedStyle(document.getElementById('financeIncomeTotal')).fontVariantNumeric");
    assert.ok(tabular.includes("tabular-nums"), `Expected tabular-nums on #financeIncomeTotal, got ${tabular}`);
    await page.evaluate(`(() => {
      const sel = document.getElementById('financeDisplayCurrency');
      sel.value = 'USD';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForApiIdle();
    await page.evaluate(`(() => {
      const sel = document.getElementById('financeDisplayCurrency');
      sel.value = 'CNY';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const month = document.getElementById('financeMonthFilter');
      month.value = new Date().toISOString().slice(0, 7);
      month.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForApiIdle();
    await pointerClick("#financeAddTransactionBtn");
    await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "finance add tx modal");
    await pointerClick("#financeTransactionModal [data-finance-close='financeTransactionModal']");
    await page.waitFor("document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "finance modal closed");
    const restoredFocusId = await page.evaluate("document.activeElement?.id || ''");
    assert.equal(restoredFocusId, "financeAddTransactionBtn", "Modal close did not restore focus to #financeAddTransactionBtn");
    await setViewport(390, 844);
    const mobileOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    assert.ok(mobileOverflow <= 1, `/finance 390px horizontal overflow: ${mobileOverflow}`);
    await setViewport(1440, 900);
    return { tabular, restoredFocusId, mobileOverflow };
  });

  // Scenario e: /transfer synthetic file attach, pending state check, 390px long filename
  await recordScenario("e_transfer_queue_and_mobile", async () => {
    await openSidebarRoute(routeSpecs[4]); // transfer
    await page.throttle(450);
    let queueText = "";
    let mobileOverflow = 0;
    try {
      await page.setFile("#transferFileInput", tempUploadFile);
      await page.waitFor("document.querySelector('#transferQueue')?.textContent?.includes('i05-long-filename')", 10_000, "transfer queue row rendered");
      queueText = await page.evaluate("document.querySelector('#transferQueue')?.textContent || ''");
      assert.ok(!/已完成|上传完成/.test(queueText), `Pending queue item must not falsely report completion: ${queueText}`);
      await setViewport(390, 844);
      mobileOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
      assert.ok(mobileOverflow <= 1, `/transfer 390px horizontal overflow: ${mobileOverflow}`);
    } finally {
      await page.clearThrottle().catch(() => {});
      await setViewport(1440, 900);
    }
    await waitForApiIdle(10_000);
    return { mobileOverflow, queueHasFile: queueText.includes("i05-long-filename") };
  });

  // Scenario f: /account security modal + #saveReleaseChannelBtn hit-test & real pointer click
  await recordScenario("f_account_security_and_release_channel", async () => {
    await openSidebarRoute(routeSpecs[5]); // account
    await pointerClick("#openSecurityCenterBtn");
    await page.waitFor("!document.querySelector('#task27Security')?.classList.contains('hidden')", 15_000, "security modal open");
    await page.waitFor("Boolean(document.querySelector('#task27Security .task27-security-summary'))", 15_000, "security summary rendered");
    await pointerClick("#task27Security [data-task27-close]");
    await page.waitFor("document.querySelector('#task27Security')?.classList.contains('hidden')", 10_000, "security modal closed");
    const saveHit = await pointerClick("#saveReleaseChannelBtn");
    await page.waitFor("document.querySelector('#releaseChannelStatus')?.textContent?.includes('体验通道已保存')", 15_000, "release channel saved status");
    const statusText = await page.evaluate("document.querySelector('#releaseChannelStatus')?.textContent?.trim() || ''");
    return { saveHit, statusText };
  });

  // Scenario g: /admin KPIs, tabs, Feature Flags DOM identity, step-up, offline error
  await recordScenario("g_admin_kpis_flags_dom_identity_and_offline", async () => {
    await openSidebarRoute(routeSpecs[6]); // admin
    await page.waitFor("Boolean(document.querySelector('#adminUserList')?.textContent?.trim())", 15_000, "admin users loaded");
    const kpiCheck = await page.evaluate(`(async () => {
      const kpiText = document.querySelector('#adminKpiUsers')?.textContent?.trim() || '';
      const token = localStorage.getItem('wyjAccountSession') || '';
      const res = await fetch('/api/admin/users?limit=1', {
        credentials: 'include',
        headers: token ? { 'X-Session-Token': token } : {},
      });
      const data = await res.json();
      return { kpiText, status: res.status, apiTotal: Number(data.total ?? data.pagination?.total ?? 0) };
    })()`);
    assert.equal(kpiCheck.status, 200, `Unexpected /api/admin/users status: ${JSON.stringify(kpiCheck)}`);
    assert.equal(Number(kpiCheck.kpiText), kpiCheck.apiTotal, `KPI mismatch: ${JSON.stringify(kpiCheck)}`);

    const tabTrail = [];
    for (const tabId of ["adminRechargeTab", "adminAuditTab", "adminLoginTab", "adminToolStatsTab", "adminFeedbackTab", "adminMessagesTab", "adminEmailTab", "adminRolesTab", "adminUsersTab", "adminFeatureFlagsTab"]) {
      await pointerClick(`#${tabId}`);
      await delay(100);
      await settle();
      const crumb = await page.evaluate("document.querySelector('#workspaceBreadcrumb li[aria-current=\"page\"]')?.textContent?.trim() || ''");
      assert.ok(crumb.length > 0, `Empty breadcrumb for ${tabId}`);
      tabTrail.push({ tabId, crumb });
    }

    await page.waitFor("document.querySelector('#adminFeatureFlagsView')?.classList.contains('active') && document.querySelectorAll('#featureFlagSelect option').length > 0", 15_000, "feature flags view ready");
    await shot("1440-admin-flags-before.png");

    const cbSizes = await page.evaluate(`(() => {
      window.__i05FlagForm = document.getElementById('featureFlagForm');
      window.__i05FlagCb = document.getElementById('featureFlagEnabled');
      window.__i05RemovedCount = 0;
      const view = document.getElementById('adminFeatureFlagsView');
      const obs = new MutationObserver((records) => {
        for (const rec of records) {
          for (const node of rec.removedNodes) {
            if (node === window.__i05FlagForm || node === window.__i05FlagCb || (node.contains && node.contains(window.__i05FlagForm))) {
              window.__i05RemovedCount += 1;
            }
          }
        }
      });
      obs.observe(view, { childList: true, subtree: true });
      const r1 = document.getElementById('featureFlagEnabled').getBoundingClientRect();
      const r2 = document.getElementById('featureFlagKillSwitch').getBoundingClientRect();
      return { enabledBox: [r1.width, r1.height], killBox: [r2.width, r2.height] };
    })()`);
    assert.ok(cbSizes.enabledBox[0] <= 24 && cbSizes.enabledBox[1] <= 24, `Enabled checkbox exceeded 24px: ${JSON.stringify(cbSizes)}`);
    assert.ok(cbSizes.killBox[0] <= 24 && cbSizes.killBox[1] <= 24, `Kill checkbox exceeded 24px: ${JSON.stringify(cbSizes)}`);

    const flagKey = `i05_fixture_${Date.now().toString(36).slice(-6)}`;
    await pointerClick("#newFeatureFlagBtn");
    await page.setFields({
      "#featureFlagKey": flagKey,
      "#featureFlagDescription": "I05 acceptance flag",
      "#featureFlagPercentage": "0",
    });
    await pointerClick("#saveFeatureFlagBtn");
    await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')", 15_000, "task27 step-up modal");
    await page.setFields({ "#task27Prompt input[name='password']": password });
    await pointerClick("#task27Prompt button[type='submit']");
    await page.waitFor("document.querySelector('#featureConsoleStatus')?.textContent?.includes('设置已保存')", 15_000, "feature flag saved status");
    await settle();

    const domIntegrity = await page.evaluate(`(() => {
      return {
        sameForm: window.__i05FlagForm === document.getElementById('featureFlagForm'),
        sameCb: window.__i05FlagCb === document.getElementById('featureFlagEnabled'),
        removedCount: window.__i05RemovedCount,
        auditHasKey: document.getElementById('featureFlagAudit')?.textContent?.includes(${JSON.stringify(flagKey)}) || false,
      };
    })()`);
    assert.equal(domIntegrity.sameForm, true, "Feature flag form node was replaced instead of reused");
    assert.equal(domIntegrity.sameCb, true, "Feature flag checkbox node was replaced instead of reused");
    assert.equal(domIntegrity.removedCount, 0, "Feature flag DOM removed during state save");
    assert.equal(domIntegrity.auditHasKey, true, `New flag ${flagKey} missing from #featureFlagAudit`);
    await shot("1440-admin-flags-after.png");

    // Offline / 503 failure must NOT show "设置已保存"
    await page.intercept([{ match: "/api/admin/feature-flags", respond: () => ({ status: 503, body: { error: "simulated offline" } }) }]);
    await page.setFields({ "#featureFlagDescription": "Should fail offline save" });
    await page.evaluate("document.getElementById('featureConsoleStatus').textContent = ''");
    await pointerClick("#saveFeatureFlagBtn");
    // Step-up prompt if required
    try {
      await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')", 2_000, "optional step-up");
      await page.setFields({ "#task27Prompt input[name='password']": password });
      await pointerClick("#task27Prompt button[type='submit']");
    } catch (_) {}
    await page.waitFor("Boolean(document.querySelector('#featureConsoleStatus')?.textContent?.trim())", 10_000, "offline failure status");
    const offlineStatus = await page.evaluate("document.querySelector('#featureConsoleStatus')?.textContent?.trim() || ''");
    assert.ok(!offlineStatus.includes("设置已保存"), `Offline save falsely claimed success: ${offlineStatus}`);
    await page.intercept([]);

    return { kpiCheck, tabCount: tabTrail.length, cbSizes, flagKey, domIntegrity, offlineStatus };
  });

  // Scenario h: Non-admin i05user isolation
  await recordScenario("h_non_admin_isolation", async () => {
    userPage = await openPage({ cdpUrl: cdp.cdpUrl, baseUrl: base, width: 1440, height: 900, mobile: false });
    await userPage.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {});
    await signIn(userPage, "i05user");
    const adminHidden = await userPage.evaluate("Boolean(document.getElementById('v3SidebarAdminLink')?.hidden)");
    assert.equal(adminHidden, true, "Non-admin must not see #v3SidebarAdminLink");
    const apiStatus = await userPage.evaluate(`(() => {
      const token = localStorage.getItem('wyjAccountSession') || '';
      return fetch('/api/admin/users', {
        credentials: 'include',
        headers: token ? { 'X-Session-Token': token } : {},
      }).then(r => r.status);
    })()`);
    assert.equal(apiStatus, 403, `Expected 403 for non-admin /api/admin/users, got ${apiStatus}`);
    await userPage.navigate("/admin");
    await userPage.waitFor("location.pathname === '/' && Boolean(document.querySelector('#adminPanel')?.classList.contains('hidden'))", 10_000, "non-admin /admin redirect");
    const postState = await userPage.evaluate("({ pathname: location.pathname, adminHidden: document.querySelector('#adminPanel')?.classList.contains('hidden') })");
    await userPage.close();
    userPage = null;
    return { adminHidden, apiStatus, postState };
  });

  // Scenario i: Viewport x Theme x 7-Route Matrix
  await recordScenario("i_responsive_theme_matrix", async () => {
    const viewports = [[1440, 900], [1024, 768], [768, 1024], [390, 844], [375, 812]];
    const themes = ["light", "dark"];
    const namedShots = new Map([
      ["1440:light:home", "1440-select-light.png"],
      ["1440:light:admin", "1440-admin-flags-light.png"],
      ["390:light:home", "390-select-light.png"],
      ["390:dark:finance", "390-finance-dark.png"],
      ["390:light:account", "390-account-light.png"],
      ["390:dark:admin", "390-admin-flags-dark.png"],
    ]);

    await setViewport(1440, 900);
    await setTheme("light");
    for (const theme of themes) {
      await setViewport(1440, 900);
      await setTheme(theme);
      for (const spec of routeSpecs) {
        await setViewport(1440, 900);
        await openSidebarRoute(spec);
        if (spec.nav === "admin") {
          await pointerClick("#adminFeatureFlagsTab");
          await delay(80);
          await settle();
        }
        for (const [w, h] of viewports) {
          const key = `${w}:${theme}:${spec.nav}`;
          await setViewport(w, h, page, !namedShots.has(key));
          const cell = await page.evaluate(`(() => {
            const sb = document.getElementById('v3Sidebar');
            const sbr = sb ? sb.getBoundingClientRect() : null;
            const sbs = sb ? getComputedStyle(sb) : null;
            const bc = document.getElementById('workspaceBreadcrumb');
            const bcr = bc ? bc.getBoundingClientRect() : null;
            const bcs = bc ? getComputedStyle(bc) : null;
            return {
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              sidebarVisible: Boolean(sbr && sbr.width > 0 && sbs?.display !== 'none'),
              breadcrumbVisible: Boolean(bcr && bcr.height > 0 && bcs?.display !== 'none'),
            };
          })()`);
          assert.ok(cell.overflow <= 1, `Overflow at ${w}x${h} ${theme} ${spec.nav}: ${cell.overflow}`);
          assert.equal(cell.sidebarVisible, w >= 981, `Sidebar visibility mismatch at ${w}x${h} ${theme} ${spec.nav}: ${JSON.stringify(cell)}`);
          assert.equal(cell.breadcrumbVisible, true, `Breadcrumb hidden at ${w}x${h} ${theme} ${spec.nav}`);
          report.viewportMatrix.push({ width: w, height: h, theme, route: spec.nav, ...cell });

          if (namedShots.has(key)) {
            await shot(namedShots.get(key));
          }
        }
      }
    }

    // 1440 admin users dark screenshot
    await setViewport(1440, 900);
    await setTheme("dark");
    await openSidebarRoute(routeSpecs[6]);
    await pointerClick("#adminUsersTab");
    await delay(100);
    await shot("1440-admin-users-dark.png");
    await setTheme("light");

    return { totalChecks: report.viewportMatrix.length };
  });

  // Scenario j: Reduced Motion
  await recordScenario("j_reduced_motion", async () => {
    await setViewport(1440, 900);
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await openSidebarRoute(routeSpecs[3]); // finance
    await pointerClick("#financeAddTransactionBtn");
    await page.waitFor("!document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "reduced motion modal open");
    await pointerClick("#financeTransactionModal [data-finance-close='financeTransactionModal']");
    await page.waitFor("document.querySelector('#financeTransactionModal')?.classList.contains('hidden')", 10_000, "reduced motion modal close");
    await openSidebarRoute(routeSpecs[6]); // admin
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    return { reducedMotionOperable: true };
  });

  // Scenario k: P07 OFF Fallback
  await recordScenario("k_p07_off_fallback", async () => {
    await waitForApiIdle();
    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    try {
      await page.navigate("/admin");
      await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.workspaceMount === 'ready' && document.documentElement.dataset.p07Ui && document.documentElement.dataset.p07Ui !== 'enabled' && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 25_000, "P07 OFF admin load");
      const p07Off = await page.evaluate(`({
        p07Ui: document.documentElement.dataset.p07Ui,
        breadcrumbDisplay: getComputedStyle(document.getElementById('workspaceBreadcrumb')).display,
        kpiDisplay: getComputedStyle(document.getElementById('adminKpiStrip')).display,
        sidebarDisplay: getComputedStyle(document.getElementById('v3Sidebar')).display,
        usersVisible: Boolean(document.querySelector('#adminUserList')),
      })`);
      assert.equal(p07Off.breadcrumbDisplay, "none");
      assert.equal(p07Off.kpiDisplay, "none");
      assert.equal(p07Off.sidebarDisplay, "none");
      assert.equal(p07Off.usersVisible, true);
      await page.click("#accountBar [data-site-nav='finance']");
      await page.waitFor("location.pathname === '/finance' && !document.querySelector('#financePage')?.classList.contains('hidden')", 15_000, "P07 OFF /finance reachable");
      return p07Off;
    } finally {
      await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    }
  });

  // Scenario l: CSS failure emergency fallback
  await recordScenario("l_css_failure_fallback", async () => {
    await waitForApiIdle();
    await setViewport(1440, 900);
    await page.intercept([{ match: "spatial-experience.css", respond: () => ({ status: 404, contentType: "text/css", body: "" }) }]);
    try {
      await page.navigate("/admin");
      await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.workspaceMount === 'ready' && document.documentElement.dataset.interfacePolicy !== 'pending' && document.documentElement.dataset.sessionVerification !== 'pending' && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 25_000, "CSS fallback /admin");
      await settle();
      const barHeight = await page.evaluate("document.getElementById('accountBar')?.getBoundingClientRect()?.height || 0");
      const tabHit = await hitTestElement("#adminUsersTab");
      assert.ok(barHeight > 0 && barHeight < 120, `#accountBar emergency height check failed: ${barHeight}`);
      assert.ok(tabHit.ok, `#adminUsersTab obstructed during CSS fallback: ${JSON.stringify(tabHit)}`);
      return { barHeight, tabHit };
    } finally {
      await page.intercept([]);
    }
  });

  // Scenario m: axe-core scan across all 7 routes + zero runtimeErrors / apiErrors
  await recordScenario("m_axe_a11y_and_runtime_clean", async () => {
    await waitForApiIdle();
    await setViewport(1440, 900);
    await page.navigate("/select");
    await page.waitFor(`document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && ${isVisibleExpr("#authWorkspaceSection")} && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0`, 20_000, "P07 ON reload");
    await setTheme("light");
    const routeResults = [];
    for (const spec of routeSpecs) {
      await openSidebarRoute(spec);
      await waitForApiIdle();
      await delay(220);
      await settle();
      await page.evaluate(axeSource);
      const res = await page.evaluate(`axe.run(document).then(r => ({
        violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target, failureSummary: n.failureSummary })) })),
        passes: r.passes.length,
      }))`);
      const seriousOrCritical = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      report.axeScans.push({ route: spec.nav, violationCount: res.violations.length, seriousOrCriticalCount: seriousOrCritical.length, passes: res.passes, violations: res.violations });
      assert.equal(seriousOrCritical.length, 0, `Serious/critical axe violations on ${spec.nav}: ${JSON.stringify(seriousOrCritical)}`);
      routeResults.push({ route: spec.nav, passes: res.passes, minorOrMod: res.violations.length });
    }
    report.runtimeErrors = page.runtimeErrors.slice();
    report.apiErrors = apiErrors.slice();
    assert.equal(report.runtimeErrors.length, 0, `Runtime errors detected: ${JSON.stringify(report.runtimeErrors)}`);
    assert.equal(report.apiErrors.length, 0, `5xx API errors detected: ${JSON.stringify(report.apiErrors)}`);
    return { routes: routeResults };
  });

  await writeFile(path.join(evidenceDir, "i05-acceptance-report.json"), JSON.stringify(report, null, 2));
  console.log(`ALL 13 I05 SCENARIOS PASSED (${report.viewportMatrix.length} viewport/theme cells, ${report.screenshots.length} screenshots)`);
} finally {
  if (userPage) await userPage.close().catch(() => {});
  if (page) await page.close().catch(() => {});
  child.kill("SIGKILL");
  server.close();
  await mf.dispose().catch(() => {});
  await unlink(tempUploadFile).catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(mfPersist, { recursive: true, force: true }).catch(() => {});
}
