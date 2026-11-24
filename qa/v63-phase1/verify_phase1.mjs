import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_DIR = path.join(ROOT, "docs/ui-rebuild/v63-user-approved-phase1/evidence");
const AFTER_DIR = path.join(EVIDENCE_DIR, "after");
fs.mkdirSync(AFTER_DIR, { recursive: true });

const PORT = 8796;
const CDP_PORT = 9231;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase1-local-test-pepper-2026";
const ADMIN_SECRET = "AdminTest#2026Phase1!";
const USER_SECRET = "UserTest#2026Phase1!";

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome/Edge executable not found");
}

function killPidTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch (_) {}
}

async function waitForHttp(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.events.has(msg.method)) {
        for (const fn of this.events.get(msg.method)) fn(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(fn);
  }
  async send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function apiJson(pathname, body = null, token = "") {
  const headers = { Origin: BASE_URL };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-phase1-"));
  const stateDir = path.join(tmpDir, "mf-state");
  const chromeDir = path.join(tmpDir, "chrome-profile");
  const framesDir = path.join(tmpDir, "frames");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(chromeDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  let mfProc = null;
  let chromeProc = null;
  let cdp = null;
  const report = {
    started_at: new Date().toISOString(),
    checks: [],
    responsive: [],
    benchmarks_ms: {},
    screenshots: [],
    screencast: null,
  };

  try {
    // 1. Apply D1 migrations & seed isolated super_admin user (retry once on transient workerd port bind)
    let mig = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      mig = spawnSync(
        process.execPath,
        [
          path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
          "d1", "migrations", "apply", "WYJ_DB", "--local",
          "--config", "wrangler.local.jsonc", "--persist-to", stateDir,
        ],
        { cwd: ROOT, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
      );
      if (mig.status === 0) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    assert.equal(mig.status, 0, `D1 migration failed: ${mig.stderr || mig.stdout}`);

    const now = new Date().toISOString();
    const adminHash = await hashSecret(ADMIN_SECRET, PEPPER);
    const userHash = await hashSecret(USER_SECRET, PEPPER);
    const quote = (v) => `'${String(v).replaceAll("'", "''")}'`;
    const sqlPath = path.join(tmpDir, "seed.sql");
    fs.writeFileSync(
      sqlPath,
      [
        `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('v63-admin-1', 'wyj', 'wyj', ${quote(adminHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${quote(now)}, ${quote(now)}, ${quote(now)}, ${quote(now)});`,
        `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('v63-normal-1', 'v63_normal', 'v63_normal', ${quote(userHash)}, 'pbkdf2_sha256', 310000, 'user', ${quote(now)}, ${quote(now)}, ${quote(now)}, ${quote(now)});`,
        `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('v63-vip-1', 'v63_vip', 'v63_vip', ${quote(userHash)}, 'pbkdf2_sha256', 310000, 'user', ${quote(now)}, ${quote(now)}, ${quote(now)}, ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'finance_access', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'tools_access', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'tools_batch_access', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'save_tool_config', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'temporary_share_access', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'english_access', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('v63-vip-1', 'japanese_access', 1, 'v63 phase1 test', 'wyj', ${quote(now)});`,
        `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'V6.3 Phase 1 verification', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${quote(now)}, 'v63-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000;`,
      ].join("\n") + "\n",
      "utf8",
    );
    const execSeed = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
        "d1", "execute", "WYJ_DB", "--local",
        "--config", "wrangler.local.jsonc", "--persist-to", stateDir, "--file", sqlPath,
      ],
      { cwd: ROOT, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
    );
    assert.equal(execSeed.status, 0, `D1 seed failed: ${execSeed.stderr || execSeed.stdout}`);

    // 2. Start isolated Miniflare/Wrangler Pages server
    mfProc = spawn(
      process.execPath,
      [
        path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
        "pages", "dev", path.join(ROOT, ".wrangler/pages-output"),
        "--ip", "127.0.0.1", "--port", String(PORT),
        "--persist-to", stateDir, "--d1", "WYJ_DB", "--r2", "WYJ_STORAGE",
        "--show-interactive-dev-session", "false",
        "--binding", "WYJ_ENVIRONMENT=development",
        "--binding", "CLOUD_FOUNDATION_ENABLED=true",
        "--binding", "CLOUD_STATUS_MODE=cloud",
        "--binding", "CLOUD_READS_ENABLED=true",
        "--binding", "CLOUD_WRITES_ENABLED=true",
        "--binding", "TASK11_CLOUD_READS_ENABLED=true",
        "--binding", "TASK11_CLOUD_WRITES_ENABLED=true",
        "--binding", "TASK12_CLOUD_ACCOUNTS_ENABLED=true",
        "--binding", "TASK13_CLOUD_READS_ENABLED=true",
        "--binding", "TASK13_CLOUD_WRITES_ENABLED=true",
        "--binding", "TASK13_PAYMENT_PRIMARY_ENABLED=true",
        "--binding", "TASK14_CLOUD_READS_ENABLED=true",
        "--binding", "TASK14_CLOUD_WRITES_ENABLED=true",
        "--binding", "TASK14_TEMPORARY_PRIMARY_ENABLED=true",
        "--binding", "TASK14_LEGACY_WRITES_FROZEN=true",
        "--binding", "TASK15_CLOUD_ONLY_ENABLED=true",
        "--binding", "TASK16_CLOUD_READS_ENABLED=true",
        "--binding", "TASK16_CLOUD_WRITES_ENABLED=true",
        "--binding", "TASK18_ADMIN_MESSAGES_ENABLED=true",
        "--binding", "TASK20_ANDROID_APP_ENABLED=true",
        "--binding", "TASK21_NOTIFICATION_READS_ENABLED=true",
        "--binding", "TASK21_NOTIFICATION_WRITES_ENABLED=true",
        "--binding", "TASK22_TRANSFER_READS_ENABLED=true",
        "--binding", "TASK22_TRANSFER_WRITES_ENABLED=true",
        "--binding", "TASK25_FEATURE_FLAGS_ENABLED=true",
        "--binding", "TASK26_ADAPTIVE_LEARNING_ENABLED=true",
        "--binding", "WORKERS_AI_ENABLED=false",
        "--binding", "LEGACY_API_FALLBACK_ENABLED=false",
        "--binding", `WYJ_TASK12_PASSWORD_PEPPER=${PEPPER}`,
        "--binding", "WYJ_TASK14_TEMPORARY_SECRET=v63-temp-secret-2026",
        "--binding", "WYJ_TASK20_DEVICE_SESSION_SECRET=v63-dev-secret-2026",
      ],
      { cwd: ROOT, stdio: "pipe", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
    );
    await waitForHttp(`${BASE_URL}/api/status?source=cloud`, 60000);

    // 3. Synthetic users (wyj admin, v63_normal unentitled, v63_vip entitled) seeded in isolated local D1.

    // 4. Launch single isolated Headless Chrome
    const chromeBin = findChrome();
    chromeProc = spawn(
      chromeBin,
      [
        "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        "--disable-background-networking", "--remote-allow-origins=*",
        "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${chromeDir}`, "about:blank",
      ],
      { cwd: ROOT, stdio: "ignore", windowsHide: true },
    );
    const versionJson = JSON.parse(await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 30000));
    cdp = new CdpSession(versionJson.webSocketDebuggerUrl);
    await cdp.open();

    const { browserContextId } = await cdp.send("Target.createBrowserContext", {});
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (m, p = {}) => cdp.send(m, p, sessionId);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("DOM.enable");
    await send("Network.enable");

    const evalJs = async (expr) => {
      const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "eval error");
      }
      return res.result?.value;
    };
    const waitFor = async (predicateExpr, timeoutMs = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (await evalJs(`Boolean(${predicateExpr})`)) return;
        await new Promise((r) => setTimeout(r, 60));
      }
      throw new Error(`waitFor timed out: ${predicateExpr}`);
    };
    const shot = async (name) => {
      await new Promise((r) => setTimeout(r, 260));
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      const file = path.join(AFTER_DIR, name);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      report.screenshots.push(name);
    };
    const resetViewport = async (width, height, mobile = false) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await new Promise((r) => setTimeout(r, 120));
    };

    let frameCounter = 0;
    let recordingFrames = false;
    cdp.on("Page.screencastFrame", (params) => {
      if (recordingFrames) {
        const idx = String(++frameCounter).padStart(4, "0");
        fs.writeFileSync(path.join(framesDir, `frame_${idx}.png`), Buffer.from(params.data, "base64"));
      }
      void send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
    });

    const coldTimes = [];
    const hotTimes = [];
    const throttledTimes = [];
    const runtimeErrors = [];
    cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.text || "exception"));

    // --- BENCHMARK 1: Cold Guest Load ---
    await resetViewport(1440, 900, false);
    const tCold0 = performance.now();
    await send("Page.navigate", { url: `${BASE_URL}/` });
    await waitFor(`document?.documentElement?.dataset?.bootState === "ready" && !document.getElementById("publicHome")?.classList.contains("hidden")`);
    coldTimes.push(performance.now() - tCold0);

    // Check Guest Mode Light
    await evalJs(`(() => { localStorage.setItem("wyj_theme_preference_v1", "light"); })()`);
    await send("Page.reload", { ignoreCache: false });
    await waitFor(`document?.documentElement?.dataset?.bootState === "ready" && !document.getElementById("publicHome")?.classList.contains("hidden")`);

    const guestMetrics = await evalJs(`(() => {
      const sb = document.getElementById("v3Sidebar");
      const ab = document.getElementById("accountBar");
      const gl = document.getElementById("guestHomeLauncher");
      const al = document.getElementById("authHomeLauncher");
      const bento = document.getElementById("publicBentoWall");
      return {
        p07Ui: document.documentElement.dataset.p07Ui,
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor,
        sidebarBg: getComputedStyle(sb).backgroundColor,
        sidebarVisible: sb.getBoundingClientRect().width > 100,
        accountBarVisible: getComputedStyle(ab).display !== "none",
        guestVisible: !gl.hidden && gl.getBoundingClientRect().height > 50,
        authHidden: al.hidden,
        bentoExists: Boolean(bento),
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      };
    })()`);
    assert.equal(guestMetrics.theme, "light");
    assert.equal(guestMetrics.sidebarVisible, true, "Guest sidebar must remain visible");
    assert.equal(guestMetrics.accountBarVisible, true, "Guest slim brand bar must remain visible");
    assert.equal(guestMetrics.guestVisible, true);
    assert.equal(guestMetrics.authHidden, true);
    assert.equal(guestMetrics.bentoExists, false, "Bento wall must be removed");
    assert.equal(guestMetrics.overflowX, false, "Zero horizontal overflow in Guest 1440px");
    report.checks.push({ id: "guest_home_light_1440", status: "PASS", detail: guestMetrics });
    await shot("after-guest-home-1440.png");

    // Guest interactive tab + plans expand + dark screenshot
    await evalJs(`document.getElementById("publicToolsTab").click()`);
    await waitFor(`!document.getElementById("capabilityToolsBody").hidden`);
    await evalJs(`document.getElementById("publicTextInput").value = '{"aeris":true}'; document.getElementById("publicTextInput").dispatchEvent(new Event("input")); document.getElementById("publicJsonFormatQuickBtn").click();`);
    await evalJs(`document.getElementById("toggleAllPublicPlansBtn").click();`);
    assert.equal(await evalJs(`document.getElementById("publicPlansSection").dataset.plansExpanded`), "true");
    await evalJs(`document.getElementById("themeToggleBtn").click();`); // cycle to dark (from light -> dark or system)
    await evalJs(`while (document.documentElement.dataset.theme !== "dark") { document.getElementById("themeToggleBtn").click(); }`);
    await shot("after-guest-home-dark-1440.png");
    await evalJs(`while (document.documentElement.dataset.theme !== "light") { document.getElementById("themeToggleBtn").click(); }`);

    // --- Test Normal User (Non-Admin, Unentitled Lock Indicators) ---
    await evalJs(`document.getElementById("navLoginBtn").click()`);
    await waitFor(`!document.getElementById("authPanel").classList.contains("hidden")`);
    await evalJs(`(() => {
      document.getElementById("usernameInput").value = "v63_normal";
      document.getElementById("secretInput").value = ${JSON.stringify(USER_SECRET)};
      document.getElementById("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    })()`);
    await waitFor(`document.body.classList.contains("is-authenticated") && !document.body.classList.contains("auth-transition-active") && document.documentElement.dataset.p07Ui === "enabled"`);
    if (await evalJs(`document.getElementById("publicHome").classList.contains("hidden")`)) {
      await evalJs(`document.querySelector('#v3Sidebar [data-v3-nav="home"]').click()`);
      await waitFor(`!document.getElementById("publicHome").classList.contains("hidden")`);
    }
    await waitFor(`Boolean(document.getElementById("dashboardGreeting")?.textContent)`);

    const normalChecks = await evalJs(`(() => ({
      financeLocked: !document.getElementById("sidebarFinanceLock").hidden,
      toolsLocked: !document.getElementById("sidebarToolsLock").hidden,
      adminHidden: document.getElementById("v3SidebarAdminLink").hidden,
      p07Ui: document.documentElement.dataset.p07Ui,
      bodyClass: document.body.className,
      innerWidth: window.innerWidth,
      accountBarDisplay: getComputedStyle(document.getElementById("accountBar")).display,
      accountBarHiddenDesktop: getComputedStyle(document.getElementById("accountBar")).display === "none",
      bg: getComputedStyle(document.body).backgroundColor,
      sidebarBg: getComputedStyle(document.getElementById("v3Sidebar")).backgroundColor,
      greeting: document.getElementById("dashboardGreeting").textContent,
      groupsGapOk: parseFloat(getComputedStyle(document.querySelectorAll("#v3Sidebar .v3-sidebar-group")[1]).marginTop) >= 20,
    }))()`);
    console.log("normalChecks:", JSON.stringify(normalChecks));
    assert.equal(normalChecks.financeLocked, true, "Normal user should see lock indicator on Finance");
    assert.equal(normalChecks.toolsLocked, true, "Normal user should see lock indicator on Tools");
    assert.equal(normalChecks.adminHidden, true, "Normal user must NOT see Admin entry");
    assert.equal(normalChecks.accountBarHiddenDesktop, true, "Authenticated desktop must hide #accountBar");
    assert.equal(normalChecks.groupsGapOk, true, "Sidebar group gap must be >= 20px");
    report.checks.push({ id: "normal_user_permissions_and_shell", status: "PASS", detail: normalChecks });

    // Logout normal user via upward accountMenu
    await evalJs(`document.querySelector("#accountMenu summary").click()`);
    await waitFor(`document.getElementById("accountMenu").open`);
    await evalJs(`document.getElementById("logoutBtn").click()`);
    await waitFor(`!document.body.classList.contains("is-authenticated")`);

    // --- Test VIP Entitled User & Start Screencast ---
    recordingFrames = true;
    await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

    await evalJs(`document.getElementById("navLoginBtn").click()`);
    await waitFor(`!document.getElementById("authPanel").classList.contains("hidden")`);
    await evalJs(`(() => {
      document.getElementById("usernameInput").value = "v63_vip";
      document.getElementById("secretInput").value = ${JSON.stringify(USER_SECRET)};
      document.getElementById("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    })()`);
    await waitFor(`document.body.classList.contains("is-authenticated") && !document.body.classList.contains("auth-transition-active") && document.documentElement.dataset.p07Ui === "enabled"`);
    if (await evalJs(`document.getElementById("publicHome").classList.contains("hidden")`)) {
      await evalJs(`document.querySelector('#v3Sidebar [data-v3-nav="home"]').click()`);
      await waitFor(`!document.getElementById("publicHome").classList.contains("hidden")`);
    }
    await waitFor(`Boolean(document.getElementById("dashboardGreeting")?.textContent)`);

    const authChecks = await evalJs(`(() => ({
      financeUnlocked: document.getElementById("sidebarFinanceLock").hidden,
      toolsUnlocked: document.getElementById("sidebarToolsLock").hidden,
      adminHidden: document.getElementById("v3SidebarAdminLink").hidden,
      greeting: document.getElementById("dashboardGreeting").textContent,
      shortcutsCount: document.querySelectorAll("#homeQuickShortcuts .gpt-shortcut-chip").length,
      bentoGridGone: !document.getElementById("workspaceBentoGrid"),
      summaryGridGone: !document.getElementById("homeV3SummaryGrid"),
    }))()`);
    assert.equal(authChecks.financeUnlocked, true);
    assert.equal(authChecks.toolsUnlocked, true);
    assert.equal(authChecks.adminHidden, true);
    assert.ok(authChecks.shortcutsCount >= 4);
    assert.equal(authChecks.bentoGridGone, true);
    assert.equal(authChecks.summaryGridGone, true);
    report.checks.push({ id: "vip_auth_launcher_pure", status: "PASS", detail: authChecks });
    await shot("after-auth-home-1440.png");

    // Dark theme auth screenshot
    await evalJs(`document.querySelector("#accountMenu summary").click(); while (document.documentElement.dataset.theme !== "dark") { document.getElementById("sidebarThemeMenuBtn").click(); } document.getElementById("accountMenu").open = false;`);
    await shot("after-auth-home-dark-1440.png");
    await evalJs(`while (document.documentElement.dataset.theme !== "light") { document.getElementById("sidebarThemeMenuBtn").click(); }`);

    // Sidebar collapse + hover tooltip + icon coordinate stability + persistence across reload/module nav
    const expandedIconX = await evalJs(`document.querySelector('#v3Sidebar [data-v3-nav="home"] .v3-nav-icon').getBoundingClientRect().left`);
    await evalJs(`document.getElementById("sidebarCollapseBtn").click()`);
    await new Promise((r) => setTimeout(r, 320));
    const collapsedState = await evalJs(`(() => {
      const sb = document.getElementById("v3Sidebar");
      const btn = document.getElementById("sidebarCollapseBtn");
      const iconX = document.querySelector('#v3Sidebar [data-v3-nav="home"] .v3-nav-icon').getBoundingClientRect().left;
      return {
        collapsedAttr: sb.dataset.collapsed,
        width: Math.round(sb.getBoundingClientRect().width),
        expandBtnVisible: btn.getBoundingClientRect().width >= 30,
        stored: localStorage.getItem("wyj_sidebar_collapsed_v1"),
        iconXDelta: Math.abs(iconX - ${expandedIconX}),
      };
    })()`);
    assert.equal(collapsedState.collapsedAttr, "true");
    assert.ok(collapsedState.width <= 72, `Collapsed width expected ~64px, got ${collapsedState.width}`);
    assert.equal(collapsedState.expandBtnVisible, true, "Expand button must remain visible when collapsed");
    assert.equal(collapsedState.stored, "true");
    // Trigger hover tooltip on collapsed sidebar item
    await evalJs(`document.querySelector('#v3Sidebar [data-v3-nav="tools"]').dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 120));
    const tooltipText = await evalJs(`document.getElementById("v3SidebarTooltip")?.hidden ? "" : document.getElementById("v3SidebarTooltip")?.textContent`);
    assert.equal(tooltipText, "在线工具箱");
    await shot("after-sidebar-collapsed-1440.png");
    await evalJs(`document.querySelector('#v3Sidebar [data-v3-nav="tools"]').dispatchEvent(new PointerEvent("pointerout", { bubbles: true }))`);
    // Expand back
    await evalJs(`document.getElementById("sidebarCollapseBtn").click()`);
    await new Promise((r) => setTimeout(r, 320));

    // Upward accountMenu popover verification
    await evalJs(`document.querySelector("#accountMenu summary").click()`);
    await waitFor(`document.getElementById("accountMenu").open`);
    const menuRect = await evalJs(`(() => {
      const r = document.getElementById("accountMenuPopover").getBoundingClientRect();
      const s = document.querySelector("#accountMenu summary").getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, summaryTop: s.top, inViewport: r.top >= 0 && r.bottom <= window.innerHeight };
    })()`);
    assert.ok(menuRect.top < menuRect.summaryTop, "Account menu must open upward");
    assert.equal(menuRect.inViewport, true);
    await shot("after-account-menu-1440.png");
    await evalJs(`document.getElementById("accountMenu").open = false;`);

    // Quick Shortcuts Customization Modal
    await evalJs(`document.getElementById("customizeShortcutsBtn").click()`);
    await waitFor(`!document.getElementById("homeShortcutsModal").classList.contains("hidden")`);
    await evalJs(`(() => {
      const cb = document.querySelector('#homeShortcutsOptions input[value="tool:json-format"]');
      if (cb && !cb.checked) cb.click();
    })()`);
    await shot("after-shortcuts-modal-1440.png");
    await evalJs(`document.getElementById("saveHomeShortcutsBtn").click()`);
    await waitFor(`document.getElementById("homeShortcutsModal").classList.contains("hidden")`);
    assert.equal(await evalJs(`Boolean(document.querySelector('#homeQuickShortcuts [data-home-shortcut-id="tool:json-format"]'))`), true);
    report.checks.push({ id: "quick_shortcuts_customization", status: "PASS" });

    // Relocated Account Sync + Floating Select Verification (<=5 vs >5)
    await evalJs(`document.querySelector('#v3Sidebar [data-v3-nav="account"]').click()`);
    await waitFor(`!document.getElementById("accountModal").classList.contains("hidden")`);
    const syncInAccount = await evalJs(`(() => ({
      syncBtn: Boolean(document.getElementById("accountModal")?.querySelector("#learningSyncNowBtn")),
      statusBadge: document.getElementById("dashboardAccountStatus")?.textContent,
      selectEnhanced: Boolean(document.querySelector("#releaseChannelSelect")?.closest(".ds-select-host")?.querySelector(".ds-select-trigger")),
    }))()`);
    assert.equal(syncInAccount.syncBtn, true, "Learning sync controls must be inside #accountModal");
    assert.equal(syncInAccount.selectEnhanced, true, "Select controls must be enhanced with unified dropdown");
    // Open #releaseChannelSelect floating dropdown (<=5 options -> NO search box)
    await evalJs(`document.querySelector("#releaseChannelSelect")?.closest(".ds-select-host")?.querySelector(".ds-select-trigger")?.click()`);
    const smallDropdownInfo = await evalJs(`(() => ({
      open: Boolean(document.querySelector(".ds-select-popover")),
      hasSearch: Boolean(document.querySelector(".ds-select-popover .ds-select-search")),
      optionsCount: document.querySelectorAll(".ds-select-popover .ds-select-option").length,
    }))()`);
    assert.equal(smallDropdownInfo.open, true);
    assert.equal(smallDropdownInfo.hasSearch, false, "Dropdown with <=5 options must NOT show search box");
    await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await shot("after-account-modal-sync-1440.png");
    await evalJs(`document.querySelector('#accountModal [data-close-modal="accountModal"]').click()`);
    await waitFor(`document.getElementById("accountModal").classList.contains("hidden")`);

    // Check >5 options searchable dropdown in Feedback Modal (#feedbackType has 6 options)
    await evalJs(`document.querySelector("#accountMenu summary").click(); document.getElementById("feedbackBtn").click();`);
    await waitFor(`!document.getElementById("feedbackModal").classList.contains("hidden")`);
    await evalJs(`document.querySelector("#feedbackType")?.closest(".ds-select-host")?.querySelector(".ds-select-trigger")?.click()`);
    const largeDropdownInfo = await evalJs(`(() => ({
      open: Boolean(document.querySelector(".ds-select-popover")),
      hasSearch: Boolean(document.querySelector(".ds-select-popover .ds-select-search")),
      optionsCount: document.querySelectorAll(".ds-select-popover .ds-select-option").length,
    }))()`);
    assert.equal(largeDropdownInfo.open, true);
    assert.equal(largeDropdownInfo.hasSearch, true, "Dropdown with >5 options MUST render inline search box");
    await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await evalJs(`document.querySelector('#feedbackModal [data-close-modal="feedbackModal"]').click()`);
    await waitFor(`document.getElementById("feedbackModal").classList.contains("hidden")`);
    report.checks.push({ id: "unified_floating_dropdowns", status: "PASS", detail: { smallDropdownInfo, largeDropdownInfo } });

    // Raycast Command Palette: Ctrl+K, 104 tools + English alias + focus restoration
    await evalJs(`document.getElementById("homeLauncherSearchBtn").focus()`);
    await evalJs(`document.getElementById("homeLauncherSearchBtn").click()`);
    await waitFor(`!document.getElementById("commandPaletteModal").classList.contains("hidden")`);
    await evalJs(`(() => {
      const inp = document.getElementById("commandPaletteInput");
      inp.value = "prettier";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 80));
    const cmdSearchHits = await evalJs(`[...document.querySelectorAll("#commandPaletteList .v3-cmd-item-label")].map(n => n.textContent)`);
    assert.ok(cmdSearchHits.some((t) => t.includes("JSON")), `Command palette must resolve English alias "prettier" -> JSON tool; got ${JSON.stringify(cmdSearchHits)}`);
    await shot("after-command-palette-1440.png");
    await evalJs(`document.querySelector('#commandPaletteModal [data-close-modal="commandPaletteModal"]').click()`);
    await waitFor(`document.getElementById("commandPaletteModal").classList.contains("hidden")`);
    const restoredFocusId = await evalJs(`document.activeElement?.id`);
    assert.equal(restoredFocusId, "homeLauncherSearchBtn", "Closing Command Palette must restore trigger focus");
    report.checks.push({ id: "command_palette_and_focus", status: "PASS", detail: { cmdSearchHits, restoredFocusId } });

    // --- BENCHMARK 2: Warm/Hot Route Transitions (<1s gate) + Strategy C ---
    const measureRoute = async (navKey, readyExpr, targetBucket) => {
      const t0 = await evalJs(`(() => { window.__v63NavStart = performance.now(); document.querySelector('#v3Sidebar [data-v3-nav="${navKey}"]').click(); return window.__v63NavStart; })()`);
      await waitFor(readyExpr);
      const elapsed = await evalJs(`performance.now() - window.__v63NavStart`);
      targetBucket.push(elapsed);
      assert.ok(elapsed < 1000, `Route ${navKey} exceeded 1000ms gate: ${elapsed.toFixed(1)}ms`);
    };

    for (let i = 0; i < 2; i++) {
      await measureRoute("tools", `!document.getElementById("toolsPanel").classList.contains("hidden")`, hotTimes);
      await measureRoute("language", `!document.getElementById("projectPicker").classList.contains("hidden")`, hotTimes);
      await measureRoute("finance", `!document.getElementById("financePage").classList.contains("hidden")`, hotTimes);
      await measureRoute("transfer", `!document.getElementById("transferPage").classList.contains("hidden")`, hotTimes);
      await measureRoute("home", `!document.getElementById("publicHome").classList.contains("hidden")`, hotTimes);
    }

    // Strategy C test: filter in /tools -> sidebar click /language -> history.back() restores filter -> sidebar click /tools clears filter
    await measureRoute("tools", `!document.getElementById("toolsDashboard").classList.contains("hidden")`, hotTimes);
    await evalJs(`(() => { const inp = document.getElementById("toolSearchInput"); inp.value = "json"; inp.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 80));
    await measureRoute("language", `!document.getElementById("projectPicker").classList.contains("hidden")`, hotTimes);
    await evalJs(`history.back()`);
    await waitFor(`location.pathname === "/tools" && !document.getElementById("toolsDashboard").classList.contains("hidden")`);
    await new Promise((r) => setTimeout(r, 150));
    const poppedSearch = await evalJs(`document.getElementById("toolSearchInput")?.value`);
    assert.equal(poppedSearch, "json", "Strategy C: Browser Back must restore prior filter state");
    await measureRoute("tools", `!document.getElementById("toolsDashboard").classList.contains("hidden")`, hotTimes);
    // Navigate via language then click sidebar Tools -> resets to default
    await measureRoute("language", `!document.getElementById("projectPicker").classList.contains("hidden")`, hotTimes);
    await measureRoute("tools", `!document.getElementById("toolsDashboard").classList.contains("hidden")`, hotTimes);
    const resetSearch = await evalJs(`document.getElementById("toolSearchInput")?.value`);
    assert.equal(resetSearch, "", "Strategy C: Explicit sidebar click must open module default state");
    await measureRoute("home", `!document.getElementById("publicHome").classList.contains("hidden")`, hotTimes);
    report.checks.push({ id: "strategy_c_memory", status: "PASS", detail: { poppedSearch, resetSearch } });

    // --- BENCHMARK 3: Throttled Network (1.6Mbps / 150ms RTT) Route Transitions ---
    await send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200 * 1024, uploadThroughput: 100 * 1024 });
    await measureRoute("tools", `!document.getElementById("toolsPanel").classList.contains("hidden")`, throttledTimes);
    await measureRoute("finance", `!document.getElementById("financePage").classList.contains("hidden")`, throttledTimes);
    await measureRoute("home", `!document.getElementById("publicHome").classList.contains("hidden")`, throttledTimes);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    report.benchmarks_ms = {
      cold_load_ms: Number(coldTimes[0].toFixed(1)),
      hot_p50_ms: percentile(hotTimes, 50),
      hot_p95_ms: percentile(hotTimes, 95),
      hot_max_ms: Number(Math.max(...hotTimes).toFixed(1)),
      slow_3g_p95_ms: percentile(throttledTimes, 95),
      slow_3g_max_ms: Number(Math.max(...throttledTimes).toFixed(1)),
      samples: { hot: hotTimes.map((x) => Number(x.toFixed(1))), slow_3g: throttledTimes.map((x) => Number(x.toFixed(1))) },
    };

    // --- Responsive & Ultrawide Viewport Matrix ---
    const viewports = [
      [375, 812, true],
      [390, 844, true],
      [768, 1024, true],
      [1280, 720, false],
      [1440, 900, false],
      [1920, 1080, false],
      [2560, 1080, false],
      [3440, 1440, false],
      [3840, 2160, false],
    ];
    for (const [w, h, mobile] of viewports) {
      await resetViewport(w, h, mobile);
      const metrics = await evalJs(`(() => ({
        w: window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        navToggleVisible: document.getElementById("siteNavToggle")?.getClientRects().length > 0,
      }))()`);
      assert.equal(metrics.overflowX, false, `Horizontal overflow at ${w}x${h}: scrollW=${metrics.scrollW}`);
      if (w <= 980) assert.equal(metrics.navToggleVisible, true, `Mobile drawer trigger missing at ${w}x${h}`);
      report.responsive.push({ width: w, height: h, mobile, ...metrics });
      if (w === 390) {
        await shot("after-mobile-home-390.png");
        await evalJs(`document.getElementById("siteNavToggle").click()`);
        await new Promise((r) => setTimeout(r, 320));
        assert.equal(await evalJs(`document.getElementById("v3Sidebar").classList.contains("mobile-drawer-open")`), true);
        await shot("after-mobile-drawer-390.png");
        await evalJs(`document.getElementById("v3SidebarBackdrop").click()`);
        await new Promise((r) => setTimeout(r, 320));
      }
      if (w === 2560) {
        await shot("after-ultrawide-2560.png");
      }
    }

    // Reduced motion check
    await resetViewport(1440, 900, false);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const reducedDur = await evalJs(`getComputedStyle(document.getElementById("v3Sidebar")).transitionDuration`);
    assert.ok(parseFloat(reducedDur) <= 0.001, `Reduced motion must disable sidebar transition, got ${reducedDur}`);
    report.checks.push({ id: "prefers_reduced_motion", status: "PASS", detail: { reducedDur } });

    recordingFrames = false;
    await send("Page.stopScreencast").catch(() => {});
    if (frameCounter >= 3) {
      const mp4Path = path.join(AFTER_DIR, "phase1-walkthrough.mp4");
      const ff = spawnSync("ffmpeg", [
        "-y", "-framerate", "4", "-i", path.join(framesDir, "frame_%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        mp4Path,
      ], { cwd: ROOT, stdio: "pipe", windowsHide: true });
      if (ff.status === 0 && fs.existsSync(mp4Path)) {
        report.screencast = { path: "docs/ui-rebuild/v63-user-approved-phase1/evidence/after/phase1-walkthrough.mp4", frames: frameCounter };
      }
    }

    // Verify zero runtime JS exceptions
    assert.deepEqual(runtimeErrors, [], `Unexpected browser JS errors: ${JSON.stringify(runtimeErrors)}`);
    report.checks.push({ id: "zero_runtime_errors", status: "PASS" });

    // --- Admin User Isolation Check ---
    await evalJs(`(() => { localStorage.clear(); sessionStorage.clear(); })()`);
    await send("Page.navigate", { url: `${BASE_URL}/login` });
    await waitFor(`document?.documentElement?.dataset?.bootState === "ready" && document?.getElementById("authPanel")?.classList && !document.getElementById("authPanel").classList.contains("hidden")`);
    await evalJs(`(() => {
      document.getElementById("usernameInput").value = "wyj";
      document.getElementById("secretInput").value = ${JSON.stringify(ADMIN_SECRET)};
      document.getElementById("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    })()`);
    await waitFor(`document?.body?.classList?.contains("is-authenticated") && !document.body.classList.contains("auth-transition-active") && document.documentElement.dataset.p07Ui === "enabled"`);
    const adminVisible = await evalJs(`!document.getElementById("v3SidebarAdminLink").hidden`);
    assert.equal(adminVisible, true, "Admin user must see /admin entry in sidebar");
    report.checks.push({ id: "admin_sidebar_entry_visible", status: "PASS" });

    fs.writeFileSync(path.join(EVIDENCE_DIR, "phase1-verification.json"), JSON.stringify(report, null, 2));
    console.log("PHASE1_VERIFICATION_PASSED", JSON.stringify(report.benchmarks_ms));
  } finally {
    cdp?.close();
    killPidTree(chromeProc?.pid);
    killPidTree(mfProc?.pid);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch((err) => {
  console.error("PHASE1_VERIFICATION_FAILED:", err);
  process.exitCode = 1;
});
