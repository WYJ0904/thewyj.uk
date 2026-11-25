import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase2-finance/evidence/after-phase1-fixes");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 8798;
const CDP_PORT = 9233;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase2-local-test-pepper-2026";
const VIP_SECRET = "Phase1FixVip#2026!";

function findChrome() {
  for (const p of [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean)) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome/Edge not found");
}

function killPidTree(pid) {
  if (!pid) return;
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {}
}

async function waitForHttp(url, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${url}`);
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
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p1fixes-"));
const stateDir = path.join(tmpDir, "mf-state");
const chromeDir = path.join(tmpDir, "chrome-profile");
const framesDir = path.join(tmpDir, "frames");
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });

let mfProc = null;
let chromeProc = null;
let cdp = null;

try {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const mig = spawnSync(
      process.execPath,
      [path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir],
      { cwd: ROOT, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
    );
    if (mig.status === 0) break;
    await new Promise((r) => setTimeout(r, 600));
  }

  const now = new Date().toISOString();
  const hash = await hashSecret(VIP_SECRET, PEPPER);
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const sqlPath = path.join(tmpDir, "seed.sql");
  fs.writeFileSync(sqlPath, [
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p1f-admin-1', 'wyj', 'wyj', ${q(hash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p1f-vip-1', 'p1f_vip', 'p1f_vip', ${q(hash)}, 'pbkdf2_sha256', 310000, 'user', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('p1f-vip-1', 'finance_access', 1, 'verify', 'wyj', ${q(now)});`,
    `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('p1f-vip-1', 'tools_access', 1, 'verify', 'wyj', ${q(now)});`,
    `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'Phase 1 fix verification', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'p1f-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000;`,
  ].join("\n") + "\n", "utf8");
  const seedRes = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir, "--file", sqlPath],
    { cwd: ROOT, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  assert.equal(seedRes.status, 0, seedRes.stderr);

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
      "--binding", "TASK12_CLOUD_ACCOUNTS_ENABLED=true",
      "--binding", "TASK13_CLOUD_READS_ENABLED=true",
      "--binding", "TASK13_CLOUD_WRITES_ENABLED=true",
      "--binding", "TASK16_CLOUD_READS_ENABLED=true",
      "--binding", "TASK16_CLOUD_WRITES_ENABLED=true",
      "--binding", "TASK21_NOTIFICATION_READS_ENABLED=true",
      "--binding", "TASK25_FEATURE_FLAGS_ENABLED=true",
      "--binding", "LEGACY_API_FALLBACK_ENABLED=false",
      "--binding", `WYJ_TASK12_PASSWORD_PEPPER=${PEPPER}`,
    ],
    { cwd: ROOT, stdio: "ignore", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  await waitForHttp(`${BASE_URL}/api/status?source=cloud`, 45000);

  chromeProc = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeDir}`, "--window-size=1440,900", "about:blank",
  ], { cwd: ROOT, stdio: "ignore", windowsHide: true });

  const versionJson = JSON.parse(await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 25000));
  cdp = new CdpSession(versionJson.webSocketDebuggerUrl);
  await cdp.open();

  const { browserContextId } = await cdp.send("Target.createBrowserContext", {});
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p = {}) => cdp.send(m, p, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const ok = await evalJs(`Boolean(${expr})`).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 60));
    }
    throw new Error(`waitFor timeout: ${expr}`);
  };

  let frameCounter = 0;
  let recordingFrames = false;
  const capturedFrames = [];
  cdp.on("Page.screencastFrame", (params) => {
    if (recordingFrames) {
      const filename = `frame_${String(++frameCounter).padStart(4, "0")}.png`;
      fs.writeFileSync(path.join(framesDir, filename), Buffer.from(params.data, "base64"));
      capturedFrames.push({ file: filename, ts: Number(params.metadata?.timestamp) || Date.now() / 1000 });
    }
    void send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  });

  const runtimeErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.text || "exception"));

  const report = { segmented_checks: [], sidebar_sync_checks: [], reduced_motion_check: null, runtime_errors: runtimeErrors };

  // Check Guest Home segmented tabs (1440 Light/Dark & 390 Mobile) BEFORE starting long walkthrough screencast
  await send("Page.navigate", { url: `${BASE_URL}/` });
  await waitFor(`document?.documentElement?.dataset?.bootState === "ready" && (document.querySelector(".gpt-workbench-header .aeris-product-tabs")?.getBoundingClientRect().width || 0) > 0`);
  await evalJs(`localStorage.setItem("wyj_theme_preference_v1", "light")`);
  await send("Page.reload", { ignoreCache: false });
  await waitFor(`document?.documentElement?.dataset?.bootState === "ready" && (document.querySelector(".gpt-workbench-header .aeris-product-tabs")?.getBoundingClientRect().width || 0) > 0`);

  async function verifyTabGroup(selector, label) {
    const res = await evalJs(`(async () => {
      const box = document.querySelector(${JSON.stringify(selector)});
      box.scrollIntoView({ block: "center" });
      const tabs = [...box.querySelectorAll("[role='tab']")].filter(t => !t.hidden && t.offsetParent !== null);
      const ind = box.querySelector(".ds-tab-indicator");
      const checks = [];
      const inspectOne = () => {
        const br = box.getBoundingClientRect();
        const ir = ind.getBoundingClientRect();
        const sel = box.querySelector("[role='tab'][aria-selected='true']") || box.querySelector("[role='tab'].active");
        const sr = sel.getBoundingClientRect();
        const csBox = getComputedStyle(box);
        const csInd = getComputedStyle(ind);
        const csSel = getComputedStyle(sel);
        const bl = parseFloat(csBox.borderLeftWidth) || 0;
        const brdR = parseFloat(csBox.borderRightWidth) || 0;
        const bt = parseFloat(csBox.borderTopWidth) || 0;
        const bb = parseFloat(csBox.borderBottomWidth) || 0;
        const pl = parseFloat(csBox.paddingLeft) || 0;
        const pr = parseFloat(csBox.paddingRight) || 0;
        const pt = parseFloat(csBox.paddingTop) || 0;
        const pb = parseFloat(csBox.paddingBottom) || 0;
        return {
          tabId: sel.id || sel.dataset.cmdFilter || sel.textContent.trim(),
          boxW: +br.width.toFixed(2),
          boxRadius: csBox.borderRadius,
          indRadius: csInd.borderRadius,
          selRadius: csSel.borderRadius,
          selBg: csSel.backgroundColor,
          indTransition: csInd.transition,
          indInlineStyle: ind.getAttribute("style"),
          indW: +ir.width.toFixed(2),
          indH: +ir.height.toFixed(2),
          selW: +sr.width.toFixed(2),
          selH: +sr.height.toFixed(2),
          indPad: csInd.padding,
          indTransform: csInd.transform,
          panelTransform: getComputedStyle(box.closest(".modal-panel") || box).transform,
          deltaLeftFromInner: +(ir.left - (br.left + bl + pl)).toFixed(2),
          deltaRightFromInner: +((br.right - brdR - pr) - ir.right).toFixed(2),
          deltaTopFromInner: +(ir.top - (br.top + bt + pt)).toFixed(2),
          deltaBottomFromInner: +((br.bottom - bb - pb) - ir.bottom).toFixed(2),
          alignLeftDiff: +(ir.left - sr.left).toFixed(2),
          alignWidthDiff: +(ir.width - sr.width).toFixed(2),
        };
      };
      for (const tab of tabs) {
        tab.click();
        await new Promise(r => setTimeout(r, 420));
        checks.push(inspectOne());
      }
      // Rapid interruption test: 0 -> last -> 1 -> 0
      tabs[0].click(); await new Promise(r => setTimeout(r, 60));
      tabs[tabs.length - 1].click(); await new Promise(r => setTimeout(r, 60));
      tabs[Math.min(1, tabs.length - 1)].click(); await new Promise(r => setTimeout(r, 60));
      tabs[0].click(); await new Promise(r => setTimeout(r, 440));
      const rapidSettled = inspectOne();
      return { checks, rapidSettled };
    })()`);

    for (const c of [...res.checks, res.rapidSettled]) {
      assert.ok(c.deltaLeftFromInner >= -0.6, `${label} ${c.tabId} left overflowed inner bound: ${JSON.stringify(c)}`);
      assert.ok(c.deltaRightFromInner >= -0.6, `${label} ${c.tabId} right overflowed inner bound: ${JSON.stringify(c)}`);
      assert.ok(c.deltaTopFromInner >= -0.6, `${label} ${c.tabId} top overflowed inner bound: ${JSON.stringify(c)}`);
      assert.ok(c.deltaBottomFromInner >= -0.6, `${label} ${c.tabId} bottom overflowed inner bound: ${JSON.stringify(c)}`);
      assert.ok(Math.abs(c.alignLeftDiff) <= 1.0, `${label} ${c.tabId} indicator left misaligned: ${JSON.stringify(c)}`);
      assert.ok(Math.abs(c.alignWidthDiff) <= 1.0, `${label} ${c.tabId} indicator width misaligned: ${JSON.stringify(c)}`);
      assert.equal(c.selBg, "rgba(0, 0, 0, 0)", `${label} ${c.tabId} competing tab bg: ${c.selBg}`);
    }
    report.segmented_checks.push({ label, ...res });
  }

  // 1. Check Guest Home segmented tabs (Light 1440px, first & last shots)
  await verifyTabGroup(".gpt-workbench-header .aeris-product-tabs", "guest-home-light-1440");
  const clipGuest = await evalJs(`(() => { const r = document.querySelector(".gpt-workbench-header").getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left - 16)), y: Math.max(0, Math.floor(r.top - 16)), width: Math.ceil(r.width + 32), height: Math.ceil(r.height + 32), scale: 1 }; })()`);
  await evalJs(`document.getElementById("publicLearningTab").click()`);
  await new Promise((r) => setTimeout(r, 340));
  fs.writeFileSync(path.join(OUT_DIR, "after-guest-tabs-first.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png", clip: clipGuest })).data, "base64"));
  await evalJs(`document.getElementById("publicFilesTab").click()`);
  await new Promise((r) => setTimeout(r, 340));
  fs.writeFileSync(path.join(OUT_DIR, "after-guest-tabs-last.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png", clip: clipGuest })).data, "base64"));

  // Dark 1440px
  await evalJs(`while (document.documentElement.dataset.theme !== "dark") { document.getElementById("themeToggleBtn").click(); }`);
  await verifyTabGroup(".gpt-workbench-header .aeris-product-tabs", "guest-home-dark-1440");
  fs.writeFileSync(path.join(OUT_DIR, "after-guest-tabs-dark.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png", clip: clipGuest })).data, "base64"));
  await evalJs(`while (document.documentElement.dataset.theme !== "light") { document.getElementById("themeToggleBtn").click(); }`);

  // Mobile 390px
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 250));
  await verifyTabGroup(".gpt-workbench-header .aeris-product-tabs", "guest-home-light-390");
  const clipGuestMobile = await evalJs(`(() => { const r = document.querySelector(".gpt-workbench-header").getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left - 12)), y: Math.max(0, Math.floor(r.top - 12)), width: Math.min(390, Math.ceil(r.width + 24)), height: Math.ceil(r.height + 24), scale: 1 }; })()`);
  fs.writeFileSync(path.join(OUT_DIR, "after-guest-tabs-390.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png", clip: clipGuestMobile })).data, "base64"));

  // Check /trial & /login auth-tabs
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evalJs(`document.getElementById("publicTrialBtn").click()`);
  await waitFor(`!document.getElementById("trialPage")?.classList.contains("hidden") && (document.querySelector(".trial-tool-tabs")?.getBoundingClientRect().width || 0) > 0`);
  await verifyTabGroup(".trial-tool-tabs", "trial-tool-tabs-1440");

  await evalJs(`document.getElementById("navLoginBtn").click()`);
  await waitFor(`!document.getElementById("authPanel")?.classList.contains("hidden")`);
  await verifyTabGroup(".auth-tabs", "auth-tabs-1440");

  // Login as p1f_vip
  await evalJs(`(() => {
    document.getElementById("usernameInput").value = "p1f_vip";
    document.getElementById("secretInput").value = ${JSON.stringify(VIP_SECRET)};
    document.getElementById("loginForm").requestSubmit();
  })()`);
  await waitFor(`document.body.classList.contains("is-authenticated") && document.documentElement.dataset.p07Ui === "enabled" && document.documentElement.dataset.workspaceMount !== "pending"`);
  await new Promise((r) => setTimeout(r, 400));

  // Check Command Palette segmented filters
  await evalJs(`document.getElementById("homeLauncherSearchBtn")?.click() || document.querySelector(".v3-cmd-trigger")?.click()`);
  await waitFor(`!document.getElementById("commandPaletteModal")?.classList.contains("hidden") && (document.getElementById("commandPaletteFilters")?.getBoundingClientRect().width || 0) > 0`);
  await new Promise((r) => setTimeout(r, 320));
  await verifyTabGroup("#commandPaletteFilters", "command-palette-filters-1440");
  await evalJs(`document.querySelector('[data-close-modal="commandPaletteModal"]')?.click()`);
  await waitFor(`document.getElementById("commandPaletteModal")?.classList.contains("hidden")`);

  // 2. Frame-by-frame Sidebar + Main Canvas Layout Sync on "/", "/finance", "/tools"
  async function sampleSidebarTransition(routeLabel, navSelector, waitReadyExpr, contentSelector) {
    if (navSelector) {
      await evalJs(`document.querySelector(${JSON.stringify(navSelector)}).click()`);
      await waitFor(waitReadyExpr);
      await new Promise((r) => setTimeout(r, 350));
    }

    const measureAction = async (actionName, rapidInterrupt = false) => {
      const samples = await evalJs(`(async () => {
        const sb = document.getElementById("v3Sidebar");
        const main = document.getElementById("v3MainCanvas");
        const content = document.querySelector(${JSON.stringify(contentSelector)});
        const btn = document.getElementById("sidebarCollapseBtn");
        const records = [];
        const t0 = performance.now();
        btn.click();
        ${rapidInterrupt ? `setTimeout(() => btn.click(), 90); setTimeout(() => btn.click(), 180);` : ""}
        return await new Promise((resolve) => {
          const tick = () => {
            const dt = +(performance.now() - t0).toFixed(1);
            const sr = sb.getBoundingClientRect();
            const mr = main.getBoundingClientRect();
            const cr = content?.getBoundingClientRect();
            records.push({
              t: dt,
              sidebarW: +sr.width.toFixed(2),
              sidebarRight: +sr.right.toFixed(2),
              mainLeft: +mr.left.toFixed(2),
              mainW: +mr.width.toFixed(2),
              gap: +(mr.left - sr.right).toFixed(2),
              contentLeft: cr ? +cr.left.toFixed(2) : null,
              contentW: cr ? +cr.width.toFixed(2) : null,
            });
            if (dt < ${rapidInterrupt ? 650 : 450}) requestAnimationFrame(tick);
            else resolve(records);
          };
          requestAnimationFrame(tick);
        });
      })()`);

      const gaps = samples.map((s) => Math.abs(s.gap));
      const maxGap = Math.max(...gaps);
      assert.ok(maxGap <= 0.6, `${routeLabel} ${actionName} out-of-sync gap detected: maxGap=${maxGap}px, sample=${JSON.stringify(samples.find((s) => Math.abs(s.gap) === maxGap))}`);

      const uniqueWidths = new Set(samples.map((s) => Math.round(s.sidebarW)));
      const uniqueMainLefts = new Set(samples.map((s) => Math.round(s.mainLeft)));
      if (!rapidInterrupt) {
        assert.ok(uniqueWidths.size >= 8, `${routeLabel} ${actionName} too few intermediate sidebar frames: ${uniqueWidths.size} (frameCount=${samples.length}, collapsed=${JSON.stringify(samples.slice(0, 4))})`);
        assert.ok(uniqueMainLefts.size >= 8, `${routeLabel} ${actionName} too few intermediate mainLeft frames: ${uniqueMainLefts.size} (frameCount=${samples.length})`);
        const first = samples[0];
        const hasMid = samples.some((s) => s.sidebarW > 85 && s.sidebarW < 235);
        const last = samples[samples.length - 1];
        // Verify content moves continuously rather than snapping on frame 0 and pausing
        assert.ok(hasMid, `${routeLabel} ${actionName} missing intermediate frames in (85..235): ${JSON.stringify(samples.slice(0, 12).map((s) => s.sidebarW))}`);
        if (actionName === "collapse") {
          assert.ok(first.sidebarW > 200 && last.sidebarW <= 65, `${routeLabel} collapse endpoints invalid: first=${first.sidebarW}, last=${last.sidebarW}`);
        } else {
          assert.ok(first.sidebarW < 100 && last.sidebarW >= 255, `${routeLabel} expand endpoints invalid: first=${first.sidebarW}, last=${last.sidebarW}`);
        }
      }
      report.sidebar_sync_checks.push({
        route: routeLabel,
        action: actionName,
        frameCount: samples.length,
        maxGapPx: +maxGap.toFixed(2),
        intermediateWidthSteps: uniqueWidths.size,
        intermediateMainLeftSteps: uniqueMainLefts.size,
        samplesPreview: samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1).slice(0, 16),
      });
    };

    await measureAction("collapse");
    await measureAction("expand");
    await measureAction("rapid-3click", true);
    // Reset to expanded state if currently collapsed
    if (await evalJs(`document.body.dataset.sidebarCollapsed === "true"`)) {
      await evalJs(`document.getElementById("sidebarCollapseBtn").click()`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // Start 1.0x real-time screencast for sidebar & main canvas sync + guest tab demonstration
  recordingFrames = true;
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sampleSidebarTransition("home-light-1440", null, "true", ".gpt-launcher-inner");
  await sampleSidebarTransition("finance-light-1440", '#v3Sidebar a[data-v3-nav="finance"]', '!document.getElementById("financeWorkspace")?.classList.contains("hidden")', "#financePage");
  await sampleSidebarTransition("tools-light-1440", '#v3Sidebar a[data-v3-nav="tools"]', '!document.getElementById("toolsPanel")?.classList.contains("hidden")', "#toolsPanel");

  // Dark theme sidebar sync on /home
  await evalJs(`document.querySelector('#v3Sidebar a[data-v3-nav="home"]').click()`);
  await waitFor(`!document.getElementById("publicHome")?.classList.contains("hidden")`);
  await evalJs(`while (document.documentElement.dataset.theme !== "dark") { document.getElementById("themeToggleBtn")?.click() || document.getElementById("sidebarThemeMenuBtn")?.click(); }`);
  await waitFor(`!document.documentElement.dataset.themeSwitching`);
  await sampleSidebarTransition("home-dark-1440", null, "true", ".gpt-launcher-inner");
  await evalJs(`while (document.documentElement.dataset.theme !== "light") { document.getElementById("themeToggleBtn")?.click() || document.getElementById("sidebarThemeMenuBtn")?.click(); }`);
  await waitFor(`!document.documentElement.dataset.themeSwitching`);

  // Reduced motion check
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const rm = await evalJs(`(() => ({
    sidebarDur: getComputedStyle(document.getElementById("v3Sidebar")).transitionDuration,
  }))()`);
  assert.ok(rm.sidebarDur === "0s" || parseFloat(rm.sidebarDur) <= 0.001, `Reduced motion duration must be 0s, got ${rm.sidebarDur}`);
  report.reduced_motion_check = rm;

  // Stop screencast and assemble 1.0x MP4
  await send("Page.stopScreencast");
  recordingFrames = false;

  if (capturedFrames.length >= 2) {
    const concatLines = ["ffconcat version 1.0"];
    for (let i = 0; i < capturedFrames.length; i++) {
      concatLines.push(`file '${capturedFrames[i].file}'`);
      if (i < capturedFrames.length - 1) {
        const dt = Math.max(0.016, Math.min(0.5, capturedFrames[i + 1].ts - capturedFrames[i].ts));
        concatLines.push(`duration ${dt.toFixed(4)}`);
      }
    }
    concatLines.push(`file '${capturedFrames[capturedFrames.length - 1].file}'`);
    fs.writeFileSync(path.join(framesDir, "frames.ffconcat"), concatLines.join("\n"));
    const videoOut = path.join(OUT_DIR, "phase1-fixes-sync-walkthrough.mp4");
    const ff = spawnSync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", "frames.ffconcat",
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoOut,
    ], { cwd: framesDir, stdio: "pipe", windowsHide: true });
    assert.equal(ff.status, 0, `ffmpeg failed: ${ff.stderr?.toString()}`);
    report.screencast_frames = capturedFrames.length;
    report.screencast_path = path.relative(ROOT, videoOut).replaceAll("\\", "/");
  }

  assert.equal(runtimeErrors.length, 0, `Runtime errors detected: ${JSON.stringify(runtimeErrors)}`);
  fs.writeFileSync(path.join(OUT_DIR, "phase1-fixes-report.json"), JSON.stringify(report, null, 2));
  console.log("PHASE1_FIXES_PASS", JSON.stringify({
    segmented_count: report.segmented_checks.length,
    sidebar_sync_count: report.sidebar_sync_checks.length,
    max_gap_px: Math.max(...report.sidebar_sync_checks.map((c) => c.maxGapPx)),
    screencast_frames: report.screencast_frames,
    runtime_errors: runtimeErrors.length,
  }));
} finally {
  if (cdp) cdp.close();
  if (chromeProc?.pid) killPidTree(chromeProc.pid);
  if (mfProc?.pid) killPidTree(mfProc.pid);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
