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
const evidenceRoot = path.join(root, ".wrangler", "i08-local-runs");
await mkdir(evidenceRoot, { recursive: true });
const evidenceDir = await mkdtemp(path.join(evidenceRoot, "run-"));
const source = await captureSource(root);

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mfPersist = await mkdtemp(path.join(os.tmpdir(), "aeris-i08-mf-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i08 fixture'); } }",
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
  d1Persist: path.join(mfPersist, "d1"),
  r2Persist: path.join(mfPersist, "r2"),
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
  WYJ_TASK12_PASSWORD_PEPPER: "i08-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i08-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i08-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-I08-Browser-Password!";
const now = new Date().toISOString();
const nowMs = Date.now();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I08 browser acceptance public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i08-seed', 'i08-seed')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();

const adminId = "i08-browser-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i08admin', 'i08admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();
await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
  VALUES ('mem_i08_001', ?1, 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i08-fixture', ?1, '{}', ?2, ?2)`)
  .bind(adminId, now).run();
await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_i08_inc', ?1, '合成工资收入', 'income', '#0f766e', 'active', 1, 1, ?2, ?2, ''),
         ('cat_i08_exp', ?1, '合成日常采购', 'expense', '#b91c1c', 'active', 1, 1, ?2, ?2, '')`)
  .bind(adminId, now).run();
for (let i = 1; i <= 8; i += 1) {
  await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_at, updated_at, deleted_at)
    VALUES (?1, ?2, 'expense', ?3, 'CNY', 'cat_i08_exp', ?4, '', 'I08 scroll governance fixture', ?5, 'manual', 'confirmed', 'active', 1, 1, ?6, ?6, '')`)
    .bind(`tx_i08_000${i}`, adminId, 1000 * i, `Merchant ${i}`, nowMs - i * 1000, now).run();
}

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
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i08-chrome-"));
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
  scope: "Isolated local Miniflare D1/R2 + headless Chrome CDP (I08 Global Polish, Icons, Controls & Route Scroll)",
  gitSha: source.commit,
  gitBranch: source.branch,
  worktreeDirty: !source.sourceMatchesCommit,
  checkedAt: new Date().toISOString(),
  scenarios: [],
  axeScans: [],
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
  const shot = async (name) => {
    await settle();
    const observed = await viewportProof(page);
    const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const png = Buffer.from(data.data, "base64");
    const pixels = pngProof(png);
    assert.deepEqual([pixels.width, pixels.height], [observed.width, observed.height]);
    await writeFile(path.join(evidenceDir, name), png, { flag: "wx" });
    report.screenshots.push(name);
  };
  const pointerClick = async (selector) => {
    const hit = await page.evaluate(`(() => {
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
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.cx, y: hit.cy });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.cx, y: hit.cy, button: "left", clickCount: 1 });
    await delay(80);
  };
  const runAxe = async (label) => {
    await page.evaluate(axeSource);
    const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.filter(v => ['serious','critical'].includes(v.impact)), passes: r.passes.length }))");
    report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes });
    assert.equal(res.violations.length, 0, `axe violations on ${label}: ${JSON.stringify(res.violations)}`);
  };
  const recordScenario = async (name, fn) => {
    const started = Date.now();
    const detail = await fn();
    report.scenarios.push({ name, status: "PASS", ms: Date.now() - started, detail });
    console.log(`PASS scenario: ${name}`);
  };

  await page.navigate("/login");
  await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled' && Boolean(document.querySelector('#loginForm'))", 20_000, "login ready");
  await settle();
  await page.setFields({ "#usernameInput": "i08admin", "#secretInput": password });
  await page.click("#loginSubmitBtn");
  try {
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated' && !document.querySelector('#authWorkspaceSection')?.hidden && (document.querySelector('#v3Sidebar')?.getBoundingClientRect()?.width || 0) > 0", 25_000, "signed in");
  } catch (err) {
    const diag = await page.evaluate("({ path: location.pathname, err: document.querySelector('#loginError')?.textContent, mode: document.querySelector('#publicHome')?.dataset.sessionMode, boot: document.documentElement.dataset.bootState, rtErr: window.__rtErr })");
    throw new Error(`${err.message} | diag=${JSON.stringify(diag)} | rt=${JSON.stringify(page.runtimeErrors)}`);
  }
  try {
    await page.waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 3000, "site notice");
    await pointerClick("#siteMessageCloseBtn");
    await page.waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 5_000, "site notice dismissed");
  } catch (_) {}
  await settle();

  // Scenario 1: Global route scroll governance (forward scroll-to-top + popstate restoration)
  await recordScenario("i08_route_scroll_governance", async () => {
    await setViewport(1440, 900);
    await pointerClick("#v3Sidebar [data-v3-nav='finance']");
    await page.waitFor("!document.querySelector('#financeWorkspace')?.classList.contains('hidden')", 15_000);
    await settle();
    await page.evaluate("window.scrollTo(0, 420)");
    await settle();
    const scrolledY = await page.evaluate("window.scrollY");
    assert.ok(scrolledY >= 300, `Expected finance scroll >= 300, got ${scrolledY}`);

    await page.evaluate("document.querySelector('#v3Sidebar [data-v3-nav=\"tools\"]').click()");
    await page.waitFor("!document.querySelector('#toolsPanel')?.classList.contains('hidden')", 15_000);
    await settle();
    const toolsScrollY = await page.evaluate("window.scrollY");
    assert.ok(toolsScrollY <= 4, `Forward route navigation must reset scroll to top, got ${toolsScrollY}`);

    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/finance' && !document.querySelector('#financeWorkspace')?.classList.contains('hidden')", 15_000);
    await settle();
    const restoredY = await page.evaluate("window.scrollY");
    assert.ok(restoredY >= 200, `Popstate back must restore finance scroll (>=200), got ${restoredY}`);
    return { scrolledY, toolsScrollY, restoredY };
  });

  // Scenario 2: Vector icon migration (#v3Sidebar & #accountModal) + contrast across admin -> account switch
  await recordScenario("i08_vector_icons_and_sidebar_contrast", async () => {
    await pointerClick("#v3Sidebar [data-v3-nav='admin']");
    await page.waitFor("Boolean(document.querySelector('#adminUserList .admin-user-card'))", 15_000);
    await pointerClick("#v3Sidebar [data-v3-nav='account']");
    await page.waitFor("!document.querySelector('#accountModal')?.classList.contains('hidden')", 15_000);
    await settle();
    const iconMetrics = await page.evaluate(`(() => {
      const sideSvgs = [...document.querySelectorAll('#v3Sidebar a:not([hidden]) .v3-nav-icon svg')];
      const acctIcons = [...document.querySelectorAll('#accountModal .account-settings-list > button .account-setting-icon svg')];
      const acctChevrons = [...document.querySelectorAll('#accountModal .account-settings-list > button .account-setting-chevron')];
      return {
        sideSvgCount: sideSvgs.length,
        sideMinW: Math.min(...sideSvgs.map(s => s.getBoundingClientRect().width)),
        acctIconCount: acctIcons.length,
        acctChevronCount: acctChevrons.length,
        scrollY: window.scrollY,
      };
    })()`);
    assert.equal(iconMetrics.sideSvgCount, 10);
    assert.ok(iconMetrics.sideMinW >= 15);
    assert.equal(iconMetrics.acctIconCount, 3);
    assert.equal(iconMetrics.acctChevronCount, 3);
    assert.ok(iconMetrics.scrollY <= 4);
    await runAxe("i08-account-light");
    await shot("1440-i08-account-icons-light.png");
    await setViewport(390, 844);
    const mobileOverflow = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    assert.ok(mobileOverflow <= 1);
    await shot("390-i08-account-icons-light.png");
    await setViewport(1440, 900);
    return iconMetrics;
  });

  // Scenario 3: Selection controls, Kill Switch warning & <= 24px checkbox invariants
  await recordScenario("i08_kill_switch_and_checkbox_contracts", async () => {
    await pointerClick("#v3Sidebar [data-v3-nav='transfer']");
    await page.waitFor("!document.querySelector('#transferPage')?.classList.contains('hidden')", 15_000);
    await pointerClick("#transferConfigDisclosure > summary");
    await pointerClick("#transferOneTime");
    const transferCb = await page.evaluate(`(() => {
      const cb = document.getElementById('transferOneTime');
      const r = cb.getBoundingClientRect();
      return { checked: cb.checked, width: r.width, height: r.height };
    })()`);
    assert.equal(transferCb.checked, true);
    assert.ok(transferCb.width <= 24 && transferCb.height <= 24);

    await page.evaluate("const s = document.getElementById('featureConsoleStatus'); if (s) s.textContent = '';");
    await pointerClick("#v3Sidebar [data-v3-nav='admin']");
    await page.waitFor("Boolean(document.querySelector('#adminUserList .admin-user-card'))", 15_000);
    await pointerClick("#adminFeatureFlagsTab");
    await page.waitFor("document.querySelectorAll('#featureFlagSummaryList .feature-directory-item').length > 0 && document.querySelector('#featureConsoleStatus')?.textContent?.includes('已读取最新配置')", 15_000, "feature console loaded");

    await pointerClick("#featureFlagKillSwitch");
    await delay(120);
    await settle();
    const killState = await page.evaluate(`(() => {
      const cb1 = document.getElementById('featureFlagEnabled').getBoundingClientRect();
      const cb2El = document.getElementById('featureFlagKillSwitch');
      const cb2 = cb2El.getBoundingClientRect();
      const warn = document.getElementById('featureFlagKillWarning');
      return {
        checked: cb2El.checked,
        cb1: [cb1.width, cb1.height],
        cb2: [cb2.width, cb2.height],
        killActive: document.getElementById('featureFlagForm')?.dataset.killActive || '',
        capsuleState: document.getElementById('featureFlagStateCapsule')?.dataset.state || '',
        warnVisible: warn ? !warn.classList.contains('hidden') : false,
      };
    })()`);
    assert.ok(killState.cb1[0] <= 24 && killState.cb2[0] <= 24);
    assert.equal(killState.checked, true, `Kill switch checkbox should be checked: ${JSON.stringify(killState)}`);
    assert.equal(killState.killActive, "true", `Kill switch form dataset mismatch: ${JSON.stringify(killState)}`);
    assert.equal(killState.capsuleState, "kill");
    assert.equal(killState.warnVisible, true);
    await runAxe("i08-admin-kill-switch");
    await shot("1440-i08-admin-kill-switch-light.png");
    return { transferCb, killState };
  });

  // Scenario 4: a.primary vs button.primary alignment + P07 OFF fallback
  await recordScenario("i08_primary_link_alignment_and_p07_off", async () => {
    await page.navigate("/download");
    await page.waitFor("!document.querySelector('#downloadPage')?.classList.contains('hidden')", 15_000);
    await settle();
    const primaryLink = await page.evaluate(`(() => {
      const a = document.getElementById('downloadMainBtn').getBoundingClientRect();
      const b = document.getElementById('downloadSecondaryBtn').getBoundingClientRect();
      return { aHeight: a.height, bHeight: b.height, topDiff: Math.abs(a.top - b.top) };
    })()`);
    assert.ok(primaryLink.aHeight >= 44 && primaryLink.bHeight >= 44 && primaryLink.topDiff <= 2);

    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    try {
      await page.navigate("/account");
      await page.waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui !== 'enabled'", 15_000);
      const offDisplay = await page.evaluate("getComputedStyle(document.querySelector('#accountModal .account-setting-chevron')).display");
      assert.equal(offDisplay, "none");
    } finally {
      await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    }
    return primaryLink;
  });

  assert.deepEqual(page.runtimeErrors, []);
  assert.deepEqual(apiErrors, []);
  report.status = "PASS";
  console.log(`${report.scenarios.length} I08 SCENARIOS PASSED (${report.screenshots.length} screenshots)`);
} finally {
  const tmpReport = path.join(evidenceDir, "i08-acceptance-report.json.tmp");
  await writeFile(tmpReport, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await rename(tmpReport, path.join(evidenceDir, "i08-acceptance-report.json"));
  console.log(`I08 evidence: ${evidenceDir}`);
  if (page) await page.close().catch(() => {});
  child.kill("SIGKILL");
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(mfPersist, { recursive: true, force: true }).catch(() => {});
}
