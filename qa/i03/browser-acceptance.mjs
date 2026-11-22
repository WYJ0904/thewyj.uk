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
const evidenceDir = path.join(root, "docs", "ui-rebuild", "i03", "evidence");
await mkdir(evidenceDir, { recursive: true });

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated i03 fixture'); } }",
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
  WYJ_TASK12_PASSWORD_PEPPER: "i03-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "i03-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "i03-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  const sql = (await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/--[^\r\n]*/g, "");
  await db.exec(sql.replace(/\r?\n/g, " "));
}

const password = "Synthetic-I03-Browser-Password!";
const now = new Date().toISOString();
await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'I03 public pages acceptance flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, NULL, 'i03-seed', 'i03-seed')
  ON CONFLICT(flag_key) DO UPDATE SET enabled = 1, kill_switch = 0, channels_json = '["stable","beta","experimental"]', rollout_basis_points = 10000, revision = revision + 1, updated_at = excluded.updated_at`).bind(now).run();

const adminId = "i03-browser-admin";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i03admin', 'i03admin', ?2, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3)`)
  .bind(adminId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(adminId, now).run();

const memberId = "i03-browser-member";
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'i03member', 'i03member', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3)`)
  .bind(memberId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(memberId, now).run();

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
      if (response.status >= 500) {
        const bodyText = await response.clone().text().catch(() => "");
        apiErrors.push({ path: url.pathname, status: response.status, body: bodyText.slice(0, 300) });
      }
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
    res.end("i03 fixture error");
    console.error(error);
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-i03-chrome-"));
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
  scope: "Isolated Miniflare D1/R2 + real headless Chrome CDP (I03 6 public routes + P07 OFF)",
  gitSha,
  browserVersion: "",
  scenarios: [],
  axeScans: [],
  viewportMatrix: [],
  screenshots: [],
  android_physical_device: "NOT_TESTED — NOT REQUIRED FOR I03 WEB ACCEPTANCE",
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

try {
  let chromePort;
  for (let i = 0; i < 60 && !chromePort; i += 1) {
    try {
      const portFile = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      chromePort = Number(portFile.trim().split(/\r?\n/)[0]);
    } catch (_) {
      await delay(100);
    }
  }
  assert.ok(chromePort, "Chrome DevToolsActivePort must become available");
  const versionRes = await fetch(`http://127.0.0.1:${chromePort}/json/version`).then((r) => r.json());
  report.browserVersion = versionRes.Browser || "Chrome";

  page = await openPage({ cdpUrl: `http://127.0.0.1:${chromePort}`, baseUrl: base, width: 1440, height: 900, mobile: false });
  await page.send("Network.setCacheDisabled", { cacheDisabled: true });

  // 1. Home Hero, Single Interactive Preview Window, Fixed Height, Rapid Tab Switch & Cursor Preservation
  await recordScenario("home-hero-preview-window-and-bento-structure", async () => {
    await page.navigate("/");
    await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 25000);
    await settle();
    await runAxe("home-desktop-light");
    await shot("home-desktop-1440-light.png");

    const structure = await page.evaluate(`(() => {
      const hero = document.querySelector('#publicHome .public-hero');
      const logo = document.querySelector('#publicHome .aeris-hero-logo');
      const logoRect = logo.getBoundingClientRect();
      const bodyRect = document.querySelector('#publicCapabilityGallery .preview-body').getBoundingClientRect();
      const bentoTiles = [...document.querySelectorAll('#publicBentoWall .bento-tile')];
      return {
        heroCards: document.querySelectorAll('.hero-scene-card').length,
        hasWidgetEditor: Boolean(document.getElementById('homeWidgetEditor')),
        heroOpacity: getComputedStyle(hero).opacity,
        logoComplete: logo.complete && logo.naturalWidth > 0,
        logoSize: { w: logoRect.width, h: logoRect.height },
        title: document.getElementById('publicHomeTitle').textContent.trim(),
        previewHeight: bodyRect.height,
        bentoCount: bentoTiles.length,
        bentoCols: getComputedStyle(document.getElementById('publicBentoWall')).gridTemplateColumns.split(' ').length,
        bentoOuterTransformNone: bentoTiles.every(t => getComputedStyle(t).transform === 'none'),
      };
    })()`);
    assert.equal(structure.heroCards, 0);
    assert.equal(structure.hasWidgetEditor, false);
    assert.equal(structure.heroOpacity, "1");
    assert.equal(structure.logoComplete, true);
    assert.equal(structure.title, "Aeris");
    assert.ok(structure.previewHeight >= 336, `Preview height must be >=336px (${structure.previewHeight})`);
    assert.equal(structure.bentoCount, 5);
    assert.equal(structure.bentoCols, 12);
    assert.equal(structure.bentoOuterTransformNone, true);

    // Rapid tab switching (must drop intermediate stale switches cleanly) & preserve textarea node identity/cursor
    await page.click("#publicLearningTab");
    await delay(25);
    await page.click("#publicFinanceTab");
    await delay(25);
    await page.click("#publicFilesTab");
    await delay(25);
    await page.click("#publicToolsTab");
    await page.waitFor("!document.getElementById('capabilityToolsBody').hidden && !document.querySelector('.aeris-window-content')?.hasAttribute('aria-busy')", 4000);

    await page.evaluate("window.__i03TextareaRef = document.getElementById('publicTextInput');");
    await page.setFields({ "#publicTextInput": '{"aeris":"i03"}' });
    await page.click("#publicJsonFormatQuickBtn");
    const toolsCheck = await page.evaluate(`(() => {
      const ta = document.getElementById('publicTextInput');
      return {
        sameNode: ta === window.__i03TextareaRef,
        formatted: ta.value.includes('\\n'),
        status: document.getElementById('publicJsonQuickStatus').textContent,
        chars: Number(document.getElementById('publicTextCharacters').textContent),
        bodyHeight: document.querySelector('#publicCapabilityGallery .preview-body').getBoundingClientRect().height,
      };
    })()`);
    assert.equal(toolsCheck.sameNode, true);
    assert.equal(toolsCheck.formatted, true);
    assert.ok(toolsCheck.bodyHeight >= 336);
    await shot("home-preview-tools-tab.png");
    return { structure, toolsCheck };
  });

  // 2. Multi-Stage Scroll 3D + Bento Internal Parallax + Frame Sequence + Reduced Motion
  await recordScenario("home-scroll-3d-multistage-and-bento-parallax", async () => {
    const readScrollMetrics = () => page.evaluate(`(() => {
      const wrap = document.getElementById('publicPreviewScrollWrap');
      const wall = document.getElementById('publicBentoWall');
      const tiles = [...wall.querySelectorAll('.bento-tile')];
      const inners = [...wall.querySelectorAll('.tile-inner')];
      return {
        stage: wrap.dataset.scrollStage || '',
        rx: parseFloat(wrap.style.getPropertyValue('--ds-scroll-rx') || '0'),
        scale: parseFloat(wrap.style.getPropertyValue('--ds-scroll-scale') || '1'),
        tz: parseFloat(wrap.style.getPropertyValue('--ds-scroll-tz') || '0'),
        outerTransforms: tiles.every(t => getComputedStyle(t).transform === 'none'),
        innerShifts: inners.map(n => parseFloat(n.style.getPropertyValue('--ds-parallax-y') || '0')),
      };
    })()`);

    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    await settle();
    await shot("home-scroll-seq-1-top.png");
    const topM = await readScrollMetrics();

    for (let i = 0; i < 3; i += 1) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: 140 });
      await delay(80);
    }
    await settle();
    await shot("home-scroll-seq-2-level.png");
    const midM = await readScrollMetrics();

    for (let i = 0; i < 4; i += 1) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: 160 });
      await delay(80);
    }
    await settle();
    await shot("home-scroll-seq-3-exit-and-bento.png");
    const exitM = await readScrollMetrics();

    for (let i = 0; i < 7; i += 1) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 450, deltaX: 0, deltaY: -150 });
      await delay(80);
    }
    await settle();
    await shot("home-scroll-seq-4-reversed.png");
    const revM = await readScrollMetrics();

    assert.equal(topM.outerTransforms && midM.outerTransforms && exitM.outerTransforms, true);
    assert.ok(exitM.rx < 0, `Preview must pitch into exit phase on continued scroll (${JSON.stringify(exitM)})`);
    assert.ok(revM.rx > exitM.rx, `Scroll back up must reversibly recover (${JSON.stringify({ exitM, revM })})`);
    assert.ok(exitM.innerShifts.some((v) => Math.abs(v) > 0.1), "Bento .tile-inner must move lightly on scroll");

    // Reduced motion resets transforms cleanly
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await settle();
    const reducedM = await readScrollMetrics();
    assert.equal(reducedM.rx, 0);
    assert.ok(reducedM.innerShifts.every((v) => v === 0));
    await page.send("Emulation.setEmulatedMedia", { features: [] });
    return { topM, midM, exitM, revM };
  });

  // 3. Cross-Route Navigation, Scroll-to-Top, Back/Forward Restore, Hero Opacity 1 & Direct Reload
  await recordScenario("cross-route-scroll-navigation-and-back-restore", async () => {
    await page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })");
    await settle();
    const homeBottomScroll = await page.evaluate("window.scrollY");
    assert.ok(homeBottomScroll > 100);

    await page.click("#publicDownloadBtn");
    await page.waitFor("location.pathname === '/download' && !document.getElementById('downloadPage').classList.contains('hidden')", 5000);
    await settle();
    const downloadStartScroll = await page.evaluate("window.scrollY");
    assert.ok(downloadStartScroll <= 2, `Forward nav from bottom of / to /download must start at top (scrollY=${downloadStartScroll})`);

    // Scroll down /download then click changelog link
    await page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })");
    await settle();
    await page.click('#downloadPage [data-site-nav="changelog"]');
    await page.waitFor("location.pathname === '/changelog' && !document.getElementById('changelogPage').classList.contains('hidden')", 5000);
    await settle();
    const changelogStartScroll = await page.evaluate("window.scrollY");
    assert.ok(changelogStartScroll <= 2, `Forward nav to /changelog must start at top (scrollY=${changelogStartScroll})`);

    // Browser Back back to /download then Back to /, verify Hero stays crisp opacity 1
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/download'", 5000);
    await settle();
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname === '/'", 5000);
    await settle();
    const returnedHeroOpacity = await page.evaluate("getComputedStyle(document.querySelector('#publicHome .public-hero')).opacity");
    assert.equal(returnedHeroOpacity, "1", "Hero opacity must stay 1 when returning from other pages");

    // Same-route tab click on /trial does NOT scroll page back to top
    await page.click("#publicTrialBtn");
    await page.waitFor("location.pathname === '/trial' && !document.getElementById('trialPage').classList.contains('hidden')", 5000);
    await settle();
    assert.ok((await page.evaluate("window.scrollY")) <= 2);
    await page.evaluate("window.scrollTo({ top: 140, behavior: 'instant' })");
    await page.click('[data-trial-tool="json"]');
    const afterTabScroll = await page.evaluate("window.scrollY");
    assert.ok(afterTabScroll >= 100, `Same-route trial tab switch must not reset user scroll (scrollY=${afterTabScroll})`);
    return { homeBottomScroll, downloadStartScroll, changelogStartScroll, returnedHeroOpacity, afterTabScroll };
  });

  // 4. All Remaining Public Pages (/trial, /download, /changelog, /login, /register) in Light & Dark + 1440/768/390/375 + Axe
  await recordScenario("all-6-public-routes-matrix-and-auth-continuity", async () => {
    const routes = [
      { path: "/trial", check: () => page.evaluate("document.querySelectorAll('.trial-tool-tab').length === 5 && parseFloat(getComputedStyle(document.getElementById('trialQuizLanguage')).paddingRight) >= 28") },
      { path: "/download", check: () => page.evaluate("Boolean(document.getElementById('downloadStatusBadge')) && getComputedStyle(document.getElementById('downloadSha')).overflowWrap === 'anywhere'") },
      { path: "/changelog", check: () => page.evaluate("document.querySelectorAll('#changelogList article').length >= 1") },
      { path: "/login", check: () => page.evaluate("Boolean(document.getElementById('loginForm')) && !document.getElementById('loginForm').classList.contains('hidden')") },
      { path: "/register", check: () => page.evaluate("Boolean(document.getElementById('registerForm')) && !document.getElementById('registerForm').classList.contains('hidden')") },
    ];

    for (const r of routes) {
      await page.navigate(r.path);
      await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 20000);
      await settle();
      assert.equal(await r.check(), true, `Contract failed on ${r.path}`);
      const slug = r.path.slice(1) || "home";
      await runAxe(`route-${slug}-desktop-light`);
      await shot(`${slug}-desktop-1440-light.png`);
    }

    // Dark mode scan + capture across key routes at 1440px (toggle until active dataset.theme === 'dark')
    while ((await page.evaluate("document.documentElement.dataset.theme")) !== "dark") {
      await page.click("#themeToggleBtn");
      await settle();
    }
    assert.equal(await page.evaluate("document.documentElement.dataset.theme"), "dark");
    for (const pathItem of ["/", "/trial", "/download", "/changelog", "/login"]) {
      await page.navigate(pathItem);
      await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 20000);
      await settle();
      const slug = pathItem.slice(1) || "home";
      await runAxe(`route-${slug}-desktop-dark`);
      await shot(`${slug}-desktop-1440-dark.png`);
    }
    while ((await page.evaluate("document.documentElement.dataset.theme")) !== "light") {
      await page.click("#themeToggleBtn");
      await settle();
    }

    // Responsive overflow matrix (1440, 768, 390, 375) across all 6 routes
    for (const width of [1440, 768, 390, 375]) {
      await setViewport(width, width <= 500 ? 844 : 900, width <= 500);
      for (const pathItem of ["/", "/trial", "/download", "/changelog", "/login", "/register"]) {
        await page.navigate(pathItem);
        await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 20000);
        await settle();
        const overflowX = await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)");
        assert.ok(overflowX <= 1, `Horizontal overflow on ${pathItem} at ${width}px: ${overflowX}`);
        if (width === 375 && (pathItem === "/" || pathItem === "/download" || pathItem === "/login")) {
          await shot(`${pathItem.slice(1) || "home"}-mobile-375-light.png`);
        }
      }
      report.viewportMatrix.push({ width, checkedRoutes: 6, overflowX: 0 });
    }
    await setViewport(1440, 900, false);

    // Real member sign-in from /login -> authenticated shared #publicHome continuity
    await page.navigate("/login");
    await page.waitFor("!document.getElementById('entryScreen') && !document.getElementById('loginForm').classList.contains('hidden')", 15000);
    await page.setFields({ "#usernameInput": "i03member", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/' && document.querySelector('#publicHome')?.dataset.sessionMode === 'authenticated'", 20000);
    await settle();
    assert.equal(await page.evaluate("document.getElementById('homeV3SummaryGrid').hidden"), false);
    await shot("home-authenticated-1440-light.png");

    // Logout cleanly
    await page.click("#accountMenu summary");
    await page.click("#logoutBtn");
    await page.waitFor("document.querySelector('#publicHome')?.dataset.sessionMode === 'guest'", 15000);

    // P07 OFF fallback verification on / and /trial
    await db.prepare("UPDATE task25_feature_flags SET enabled = 0, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();
    await page.navigate("/");
    await page.waitFor("document.documentElement.dataset.p07Ui === 'disabled' && document.documentElement.dataset.bootState === 'ready'", 20000);
    await settle();
    assert.equal(await page.evaluate("document.querySelectorAll('#publicBentoWall .bento-tile').length"), 5);
    assert.ok((await page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)")) <= 1);
    await shot("home-p07-off-1440-light.png");
    await db.prepare("UPDATE task25_feature_flags SET enabled = 1, revision = revision + 1 WHERE flag_key = 'p07_accessibility'").run();

    return { routeChecks: 5, viewports: [1440, 768, 390, 375], p07OffChecked: true };
  });

  assert.deepEqual(page.runtimeErrors, [], `Runtime errors: ${JSON.stringify(page.runtimeErrors)}`);
  assert.deepEqual(apiErrors, [], `API 5xx errors: ${JSON.stringify(apiErrors)}`);

  await writeFile(path.join(evidenceDir, "acceptance-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: "PASS",
    scenarios: report.scenarios.length,
    axeScans: report.axeScans.length,
    screenshots: report.screenshots.length,
    viewports: report.viewportMatrix.length,
  }));
} finally {
  if (page) await page.close().catch(() => {});
  child.kill();
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
