import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
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
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i02", "evidence");
await mkdir(evidenceDir, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated fixture'); } }",
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
  WYJ_TASK12_PASSWORD_PEPPER: "i02-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i02-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i02-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-I02-Browser-Password!";
const now = new Date().toISOString();
const nowMs = Date.now();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I02 browser acceptance public UI flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i02-seed', 'i02-seed')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();
const userId = "i02-browser-admin";

await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i02admin', 'i02admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3),
         ('i02-browser-user', 'i02user', 'i02user', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3)`)
  .bind(userId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2), ('i02-browser-user', ?2)").bind(userId, now).run();
await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
  VALUES ('mem_i02_001', ?1, 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i02-fixture', ?1, '{}', ?2, ?2),
         ('mem_i02_002', 'i02-browser-user', 'all_access_lifetime', ?2, '', 1, 'active', 'admin', 'i02-fixture', ?1, '{}', ?2, ?2)`)
  .bind(userId, now).run();
await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_i02_inc', ?1, '工资薪金', 'income', '#0f766e', 'active', 1, 1, ?2, ?2, ''),
         ('cat_i02_exp', ?1, '餐饮日常', 'expense', '#c23333', 'active', 1, 2, ?2, ?2, '')`)
  .bind(userId, now).run();
await db.prepare(`INSERT INTO task16_finance_transactions (id, user_id, direction, amount_minor, currency, category_id, merchant, counterparty, note, occurred_at_ms, source_kind, reconciliation_state, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('tx_i02_0001', ?1, 'income', 1285000, 'CNY', 'cat_i02_inc', 'Synthetic Payroll', '', 'I02 fixture income', ?2, 'manual', 'confirmed', 'active', 1, 1, ?3, ?3, ''),
         ('tx_i02_0002', ?1, 'expense', 4250, 'CNY', 'cat_i02_exp', 'Synthetic Cafe', '', 'I02 fixture expense', ?2, 'manual', 'confirmed', 'active', 1, 2, ?3, ?3, '')`)
  .bind(userId, nowMs, now).run();

const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
const spaRoutes = new Set([
  "/", "/login", "/register", "/download", "/changelog", "/trial",
  "/transfer", "/select", "/account", "/finance", "/tools", "/language", "/admin",
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
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i02-chrome-"));
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
  scope: "Isolated local Miniflare D1/R2 + headless Chrome CDP",
  browserVersion: "",
  viewports: [1440, 1024, 768, 390, 375, 320],
  scenarios: [],
  viewportMatrix: [],
  axeScans: [],
  componentSnapshot: {},
  screenshots: [],
  android_physical_device: "NOT_TESTED — NOT REQUIRED FOR I02 ACCEPTANCE",
  production_release: "NOT_TOUCHED",
};

let page;
async function settle() {
  await page.evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
}

async function setViewport(width, height = 900, mobile = width <= 500) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  await settle();
}

async function setThemeViaClick(targetTheme) {
  for (let i = 0; i < 4; i += 1) {
    const current = await page.evaluate("document.documentElement.dataset.themePreference");
    if (current === targetTheme) break;
    await page.click("#themeToggleBtn");
    await delay(80);
  }
  await settle();
  const actualPref = await page.evaluate("document.documentElement.dataset.themePreference");
  assert.equal(actualPref, targetTheme, `Expected themePreference=${targetTheme}, got ${actualPref}`);
}

async function dispatchKey(key, code = key, modifiers = 0) {
  const keyCode = key === "Tab" ? 9 : key === "Escape" ? 27 : key === "Enter" ? 13 : key === " " ? 32 : 0;
  for (const type of ["keyDown", "keyUp"]) {
    await page.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      ...(key === " " && type === "keyDown" ? { text: " " } : {}),
    });
  }
}

async function shot(name) {
  await settle();
  const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(evidenceDir, name), Buffer.from(data.data, "base64"));
  report.screenshots.push(name);
  return name;
}

async function runAxe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate("axe.run(document).then(r => ({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), passes: r.passes.length }))");
  report.axeScans.push({ label, violationCount: res.violations.length, passes: res.passes, violations: res.violations });
  assert.equal(res.violations.length, 0, `axe violations on ${label}: ${JSON.stringify(res.violations)}`);
}

async function recordScenario(name, fn) {
  const detail = await fn();
  report.scenarios.push({ name, status: "PASS", detail });
  console.log(`PASS scenario: ${name}`);
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
  const cdpUrl = `http://127.0.0.1:${port}`;
  const versionInfo = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
  report.browserVersion = versionInfo.Browser || "Chrome";

  page = await openPage({ cdpUrl, baseUrl: base, width: 1440, height: 900, mobile: false });
  await page.navigate("/");
  try {
    await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'enabled'", 12000);
  } catch (err) {
    const diag = await page.evaluate("Promise.resolve(fetch('/api/ui/features').then(r => r.text()).catch(e => String(e))).then(ui => ({ dataset: { ...document.documentElement.dataset }, hasEntry: Boolean(document.getElementById('entryScreen')), bodyClass: document.body.className, ui }))");
    console.error("BOOT DIAG:", JSON.stringify({ diag, runtimeErrors: page.runtimeErrors, apiErrors }));
    throw err;
  }
  await settle();

  // 1. Theme switching on /, /login, and /account (later after login)
  await recordScenario("theme-switch-public-and-login", async () => {
    await setThemeViaClick("light");
    await shot("desktop-home-light.png");
    await shot("theme-seq-1-light.png");
    const lightBtn = await page.evaluate(`(() => {
      const b = document.querySelector('#publicLoginBtn');
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, color: s.color, radius: s.borderRadius, switching: document.documentElement.dataset.themeSwitching || null };
    })()`);
    assert.equal(lightBtn.bg, "rgb(17, 17, 19)", `Light primary bg must be #111113, got ${lightBtn.bg}`);
    assert.equal(lightBtn.color, "rgb(255, 255, 255)", `Light primary text must be #ffffff, got ${lightBtn.color}`);
    assert.equal(lightBtn.switching, null);

    await setThemeViaClick("dark");
    await shot("desktop-home-dark.png");
    await shot("theme-seq-2-dark.png");
    const darkBtn = await page.evaluate(`(() => {
      const b = document.querySelector('#publicLoginBtn');
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, color: s.color, theme: document.documentElement.dataset.theme, switching: document.documentElement.dataset.themeSwitching || null };
    })()`);
    assert.equal(darkBtn.theme, "dark");
    assert.equal(darkBtn.bg, "rgb(248, 250, 252)", `Dark primary bg must be #f8fafc, got ${darkBtn.bg}`);
    assert.equal(darkBtn.color, "rgb(17, 17, 19)", `Dark primary text must be #111113, got ${darkBtn.color}`);
    assert.equal(darkBtn.switching, null);

    await setThemeViaClick("system");
    await shot("theme-seq-3-system.png");
    await runAxe("home-1440-light-system");

    await setThemeViaClick("dark");
    await runAxe("home-1440-dark");
    await setThemeViaClick("light");
    return { lightBtn, darkBtn };
  });

  // 2. Buttons & a.primary vs button.primary parity + keyboard focus + disabled
  await recordScenario("buttons-and-link-primary-parity", async () => {
    await page.navigate("/download");
    await page.waitFor("document.querySelector('#downloadMainBtn')?.checkVisibility()");
    await settle();
    await shot("desktop-download-light.png");
    const downloadPrimary = await page.evaluate(`(() => {
      const a = document.querySelector('#downloadMainBtn');
      const sec = document.querySelector('#downloadSecondaryBtn');
      const sa = getComputedStyle(a), ss = getComputedStyle(sec);
      return {
        aBg: sa.backgroundColor, aColor: sa.color, aHeight: a.getBoundingClientRect().height, aRadius: sa.borderRadius,
        secBg: ss.backgroundColor, secColor: ss.color, secHeight: sec.getBoundingClientRect().height
      };
    })()`);
    assert.equal(downloadPrimary.aBg, "rgb(17, 17, 19)");
    assert.equal(downloadPrimary.aColor, "rgb(255, 255, 255)");
    assert.ok(downloadPrimary.aHeight >= 44);
    assert.ok(downloadPrimary.secHeight >= 44);

    // Tab focus visibility + keyboard activation check on home button
    await page.navigate("/");
    await page.waitFor("document.querySelector('#publicLoginBtn')?.checkVisibility()");
    await page.evaluate("document.querySelector('#publicRegisterBtn').focus()");
    await dispatchKey("Tab");
    const focused = await page.evaluate(`(() => {
      const e = document.activeElement, s = getComputedStyle(e);
      return { tag: e.tagName, id: e.id, outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth) };
    })()`);
    assert.ok(focused.outlineStyle !== "none" && focused.outlineWidth >= 2, `Focus outline missing: ${JSON.stringify(focused)}`);
    await runAxe("download-1440-light");
    return { downloadPrimary, focused };
  });

  // 3. Forms: typing, clearing, validation error + login
  await recordScenario("forms-input-validation-and-login", async () => {
    await setThemeViaClick("dark");
    await page.navigate("/login");
    await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready' && document.querySelector('#loginForm')?.checkVisibility()", 20000);
    await settle();
    await shot("desktop-login-dark.png");
    await runAxe("login-1440-dark");

    // Submit invalid/empty login to verify visible error cue
    await page.setFields({ "#usernameInput": "i02admin", "#secretInput": "wrong-pass-check" });
    await page.click("#loginSubmitBtn");
    await page.waitFor("document.querySelector('#loginError')?.textContent.trim().length > 0", 10000);
    const errStyle = await page.evaluate(`(() => {
      const e = document.querySelector('#loginError'), s = getComputedStyle(e);
      return { text: e.textContent.trim(), visible: e.checkVisibility(), color: s.color, bg: s.backgroundColor };
    })()`);
    assert.ok(errStyle.text.length > 0 && errStyle.visible);
    assert.notEqual(errStyle.color, "rgb(24, 33, 47)", "Error message should use error semantic color");

    // Real login
    await setThemeViaClick("light");
    await page.setFields({ "#usernameInput": "i02admin", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/' && document.querySelector('#accountBadge')?.textContent.includes('i02admin')", 20000);
    return { errStyle };
  });

  // 4. Selection controls (checkboxes not stretched) + Feature Flags Admin + Finance numerals
  await recordScenario("selection-controls-numerals-and-workbench", async () => {
    await page.navigate("/transfer");
    await page.waitFor("document.querySelector('#transferOneTime')?.checkVisibility()");
    await settle();
    const cbBefore = await page.evaluate("document.querySelector('#transferOneTime').checked");
    await page.click("#transferOneTime");
    const cbMetrics = await page.evaluate(`(() => {
      const cb = document.querySelector('#transferOneTime');
      const r = cb.getBoundingClientRect();
      return { checked: cb.checked, width: r.width, height: r.height };
    })()`);
    assert.equal(cbMetrics.checked, !cbBefore);
    assert.ok(cbMetrics.width <= 24 && cbMetrics.height <= 24, `Checkbox must not stretch: ${JSON.stringify(cbMetrics)}`);

    // Finance numerals & Light/Dark capture
    await page.navigate("/finance");
    await page.waitFor("!document.getElementById('entryScreen') && !document.querySelector('#sessionRecovery')?.checkVisibility() && document.querySelector('#financePage')?.checkVisibility() && document.querySelector('#financeIncomeTotal')?.textContent.includes('12,850')", 20000);
    await settle();
    await shot("desktop-finance-light.png");
    const financeMetrics = await page.evaluate(`(() => {
      const total = document.querySelector('#financeBalanceTotal');
      const inc = document.querySelector('#financeIncomeTotal');
      const exp = document.querySelector('#financeExpenseTotal');
      const ts = getComputedStyle(total);
      return {
        totalText: total.textContent.trim(),
        fontVariantNumeric: ts.fontVariantNumeric,
        incColor: getComputedStyle(inc).color,
        expColor: getComputedStyle(exp).color,
        cardRadius: getComputedStyle(document.querySelector('.finance-summary-grid article')).borderRadius,
      };
    })()`);
    assert.ok(financeMetrics.fontVariantNumeric.includes("tabular-nums"));
    await runAxe("finance-1440-light");

    await setThemeViaClick("dark");
    await shot("desktop-finance-dark.png");
    await runAxe("finance-1440-dark");
    await setThemeViaClick("light");

    // Admin Feature Flags checkboxes & monospace audit log
    await page.navigate("/admin");
    await page.waitFor("document.querySelector('#adminFeatureFlagsTab')?.checkVisibility()", 15000);
    await page.click("#adminFeatureFlagsTab");
    await page.waitFor("document.querySelector('#featureFlagEnabled')?.checkVisibility()", 10000);
    await page.click("#adminFeatureFlagsView details summary");
    await settle();
    await shot("desktop-admin-flags-light.png");
    const adminMetrics = await page.evaluate(`(() => {
      const cb = document.querySelector('#featureFlagEnabled');
      const ks = document.querySelector('#featureFlagKillSwitch');
      const audit = document.querySelector('#featureFlagAudit');
      return {
        cbW: cb.getBoundingClientRect().width, cbH: cb.getBoundingClientRect().height,
        ksW: ks.getBoundingClientRect().width, ksH: ks.getBoundingClientRect().height,
        auditFont: getComputedStyle(audit).fontFamily,
      };
    })()`);
    assert.ok(adminMetrics.cbW <= 24 && adminMetrics.cbH <= 24);
    assert.ok(adminMetrics.ksW <= 24 && adminMetrics.ksH <= 24);
    assert.ok(/mono|consolas|cascadia|jetbrains/i.test(adminMetrics.auditFont), `Expected mono font on audit, got ${adminMetrics.auditFont}`);
    await runAxe("admin-1440-light");
    return { cbMetrics, financeMetrics, adminMetrics };
  });

  // 5. Account theme switching + Modal focus trap, Tab/Shift+Tab, Escape, reopen, z-index
  await recordScenario("modal-focus-trap-and-account-theme", async () => {
    await page.evaluate("localStorage.removeItem('wyjAccountSession'); true");
    await page.navigate("/login");
    await page.waitFor("document.querySelector('#loginForm')?.checkVisibility()", 10000);
    await page.setFields({ "#usernameInput": "i02user", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/' && document.querySelector('#accountBadge')?.textContent.includes('i02user')", 20000);
    await page.navigate("/account");
    await page.waitFor("document.querySelector('#openDeleteAccountBtn')?.checkVisibility()", 15000);
    await setThemeViaClick("dark");
    await shot("desktop-account-dark.png");
    await runAxe("account-1440-dark");
    await setThemeViaClick("light");

    await setViewport(375, 812, true);
    await page.evaluate("document.getElementById('openDeleteAccountBtn').focus(); true");
    await page.click("#openDeleteAccountBtn");
    await page.waitFor("document.querySelector('#deleteAccountModal')?.checkVisibility()", 5000);
    await settle();
    await shot("mobile-modal-light.png");

    const zCheck = await page.evaluate(`(() => {
      const navZ = Number(getComputedStyle(document.querySelector('#accountBar')).zIndex) || 0;
      const modalZ = Number(getComputedStyle(document.querySelector('#deleteAccountModal')).zIndex) || 0;
      return { navZ, modalZ };
    })()`);
    assert.ok(zCheck.modalZ > zCheck.navZ, `Modal z-index (${zCheck.modalZ}) must exceed nav (${zCheck.navZ})`);

    for (let i = 0; i < 6; i += 1) {
      await dispatchKey("Tab");
      const inside = await page.evaluate("document.getElementById('deleteAccountModal').contains(document.activeElement)");
      assert.equal(inside, true, "Tab escaped modal trap");
    }
    await dispatchKey("Tab", "Tab", 8); // Shift+Tab
    assert.equal(await page.evaluate("document.getElementById('deleteAccountModal').contains(document.activeElement)"), true);

    await dispatchKey("Escape");
    await page.waitFor("!document.getElementById('deleteAccountModal').checkVisibility() && !document.getElementById('appShell').inert", 5000);
    await page.waitFor("document.activeElement?.id === 'openDeleteAccountBtn'", 5000);
    const restoredId = await page.evaluate("document.activeElement?.id");
    assert.equal(restoredId, "openDeleteAccountBtn", `Focus did not restore to trigger: ${restoredId}`);

    // Reopen once more
    await page.click("#openDeleteAccountBtn");
    await page.waitFor("document.querySelector('#deleteAccountModal')?.checkVisibility()", 5000);
    await dispatchKey("Escape");
    await page.waitFor("!document.getElementById('deleteAccountModal').checkVisibility()", 5000);
    await setViewport(1440, 900, false);
    return { zCheck, restoredId };
  });

  // 6. Routing & Back navigation
  await recordScenario("routing-and-history-back", async () => {
    await page.navigate("/");
    await page.waitFor("document.querySelector('#publicHome')?.checkVisibility()");
    await page.click('#accountBar a[data-site-nav="finance"]');
    await page.waitFor("location.pathname === '/finance' && document.querySelector('#financePage')?.checkVisibility()", 15000);
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/' && document.querySelector('#publicHome')?.checkVisibility()", 15000);
    const overflow = await page.evaluate("document.documentElement.scrollWidth - innerWidth");
    assert.ok(overflow <= 1);
    return { backRoute: "/", overflow };
  });

  // 7. Viewport matrix (1440, 1024, 768, 390, 375, 320) Light & Dark
  for (const width of [1440, 1024, 768, 390, 375, 320]) {
    const mobile = width <= 500;
    await setViewport(width, mobile ? 844 : 900, mobile);
    await page.navigate("/");
    await page.waitFor("document.querySelector('#publicHome')?.checkVisibility()");
    for (const mode of ["light", "dark"]) {
      await setThemeViaClick(mode);
      if (width === 390 && mode === "light") await shot("mobile-home-light.png");
      if (width === 390 && mode === "dark") await shot("mobile-home-dark.png");
      const metrics = await page.evaluate(`(() => {
        const nav = document.querySelector('#accountBar');
        const small = [...document.querySelectorAll('button, a.primary, .button-link')]
          .filter(el => el.checkVisibility() && !el.closest('.hero-scene-card'))
          .filter(el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 43.5; })
          .map(el => ({ id: el.id, cls: el.className, h: el.getBoundingClientRect().height }));
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          navHeight: Math.round(nav.getBoundingClientRect().height),
          smallTargets: small,
        };
      })()`);
      assert.ok(metrics.overflowX <= 1, `Horizontal overflow at ${width}px ${mode}: ${metrics.overflowX}`);
      assert.equal(metrics.smallTargets.length, 0, `Touch targets < 44px at ${width}px ${mode}: ${JSON.stringify(metrics.smallTargets)}`);
      if (width >= 768) {
        assert.ok(metrics.navHeight <= 70, `Desktop/tablet header wrapped at ${width}px: ${metrics.navHeight}px`);
      }
      report.viewportMatrix.push({ width, mode, ...metrics });
    }
  }
  await setThemeViaClick("light");
  await setViewport(1440, 900, false);

  // 8. Reduced Motion ON
  await recordScenario("reduced-motion-operability", async () => {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.navigate("/account");
    await page.waitFor("document.querySelector('#openDeleteAccountBtn')?.checkVisibility()", 15000);
    const dur = await page.evaluate("getComputedStyle(document.querySelector('#openDeleteAccountBtn')).transitionDuration");
    await page.click("#openDeleteAccountBtn");
    await page.waitFor("document.querySelector('#deleteAccountModal')?.checkVisibility()", 5000);
    await dispatchKey("Escape");
    await page.waitFor("!document.getElementById('deleteAccountModal').checkVisibility()", 5000);
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    return { transitionDuration: dur, modalOperable: true };
  });

  // 9. Offline interaction
  await recordScenario("offline-degradation-and-local-tool", async () => {
    await page.navigate("/language/english");
    await page.waitFor("document.querySelector('#statusDot')?.checkVisibility()", 15000);
    try {
      await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      await page.waitFor("document.getElementById('modelLabel')?.textContent === '离线模式'", 8000);
      const offlineState = await page.evaluate("({ label: document.getElementById('modelLabel').textContent, online: document.getElementById('statusDot').classList.contains('online'), bg: getComputedStyle(document.body).backgroundColor })");
      assert.equal(offlineState.online, false);
      assert.notEqual(offlineState.bg, "rgba(0, 0, 0, 0)");
      return offlineState;
    } finally {
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
  });

  // 10. P07 OFF fallback verification
  await recordScenario("p07-off-fallback-regression", async () => {
    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    await page.navigate("/");
    await page.waitFor("document.documentElement.dataset.p07Ui === 'disabled' && document.documentElement.dataset.bootState === 'ready'", 20000);
    await settle();
    await shot("desktop-p07-off-light.png");
    const p07Off = await page.evaluate(`(() => ({
      p07: document.documentElement.dataset.p07Ui,
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      sidebarDisplay: getComputedStyle(document.querySelector('#v3Sidebar')).display,
      financeLinkVisible: document.querySelector('#accountBar a[data-site-nav="finance"]')?.checkVisibility() ?? true,
    }))()`);
    assert.equal(p07Off.p07, "disabled");
    assert.equal(p07Off.sidebarDisplay, "none");
    assert.ok(p07Off.overflowX <= 1);
    await page.navigate("/finance");
    await page.waitFor("document.querySelector('#financePage')?.checkVisibility()", 15000);
    await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    return p07Off;
  });

  // Shared component computed snapshot (Light vs Dark)
  await page.navigate("/");
  await page.waitFor("document.querySelector('#publicHome')?.checkVisibility()", 15000);
  for (const mode of ["light", "dark"]) {
    await setThemeViaClick(mode);
    report.componentSnapshot[mode] = await page.evaluate(`(() => {
      const btn = document.querySelector('#publicLoginBtn');
      const sec = document.querySelector('#publicDownloadBtn');
      const ghost = document.querySelector('#homeSearchBtn');
      const card = document.querySelector('.home-widget-visual');
      return {
        primaryBtn: { bg: getComputedStyle(btn).backgroundColor, color: getComputedStyle(btn).color, radius: getComputedStyle(btn).borderRadius, height: btn.getBoundingClientRect().height },
        secondaryBtn: { bg: getComputedStyle(sec).backgroundColor, color: getComputedStyle(sec).color, border: getComputedStyle(sec).borderColor, radius: getComputedStyle(sec).borderRadius },
        ghostBtn: { bg: getComputedStyle(ghost).backgroundColor, color: getComputedStyle(ghost).color },
        card: { bg: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderColor, radius: getComputedStyle(card).borderRadius },
      };
    })()`);
  }

  assert.deepEqual(page.runtimeErrors, [], `Runtime console errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(apiErrors, [], `API 5xx errors: ${JSON.stringify(apiErrors)}`);

  await writeFile(path.join(evidenceDir, "i02-acceptance-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: "PASS",
    scenarios: report.scenarios.length,
    viewportChecks: report.viewportMatrix.length,
    axeScans: report.axeScans.length,
    screenshots: report.screenshots.length,
  }));
} finally {
  if (page) await page.close().catch(() => {});
  child.kill();
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
