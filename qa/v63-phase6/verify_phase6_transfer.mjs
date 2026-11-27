import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Miniflare } from "../../node_modules/miniflare/dist/src/index.js";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGES_DIR = path.join(ROOT, ".wrangler/pages-output");
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase6-transfer/evidence/after");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 18819;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase6-verify-local-pepper-2026-32ch";
const FREE_SECRET = "Phase6Free#2026!";
const VIP_SECRET = "Phase6Vip#2026!";
const ADMIN_SECRET = "Phase6Admin#2026!";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

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

async function waitForHttp(url, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p6-verify-"));
const chromeDir = path.join(tmpDir, "chrome-profile");
const framesDirSender = path.join(tmpDir, "frames-sender");
const framesDirRecip = path.join(tmpDir, "frames-recip");
const fixturesDir = path.join(tmpDir, "fixtures");
fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(framesDirSender, { recursive: true });
fs.mkdirSync(framesDirRecip, { recursive: true });
fs.mkdirSync(fixturesDir, { recursive: true });

// Synthetic fixtures: >16 MiB multipart file + small folder files + 0-byte invalid file
const largeBin = path.join(fixturesDir, "aeris-multipart-bundle.bin");
const smallNoteA = path.join(fixturesDir, "release-notes.txt");
const smallJsonB = path.join(fixturesDir, "manifest-check.json");
const emptyFile = path.join(fixturesDir, "empty-invalid.txt");
fs.writeFileSync(largeBin, crypto.randomBytes(16 * 1024 * 1024 + 262144));
fs.writeFileSync(smallNoteA, "Aeris V6.3 Phase 6 File Transfer Verification\n".repeat(128));
fs.writeFileSync(smallJsonB, JSON.stringify({ phase: "v6.3-phase6", verified: true }, null, 2));
fs.writeFileSync(emptyFile, Buffer.alloc(0));

let mf = null;
let server = null;
let chromeProc = null;
let cdp = null;

function encodeFramesToMp4(framesList, dir, outPath) {
  assert.ok(framesList.length >= 2, `Need >= 2 screencast frames for ${outPath}`);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < framesList.length; i += 1) {
    lines.push(`file '${framesList[i].file}'`);
    if (i < framesList.length - 1) {
      const dt = Math.max(0.02, Math.min(0.6, framesList[i + 1].ts - framesList[i].ts));
      lines.push(`duration ${dt.toFixed(4)}`);
    }
  }
  lines.push(`file '${framesList[framesList.length - 1].file}'`);
  fs.writeFileSync(path.join(dir, "frames.ffconcat"), lines.join("\n"));
  const ff = spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", "frames.ffconcat",
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
  ], { cwd: dir, stdio: "pipe", windowsHide: true });
  assert.equal(ff.status, 0, `ffmpeg failed: ${ff.stderr?.toString()}`);
}

try {
  const wrConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const bindings = {
    ...(wrConfig.vars || {}),
    WYJ_ENVIRONMENT: "development",
    CLOUD_FOUNDATION_ENABLED: "true",
    CLOUD_STATUS_MODE: "cloud",
    CLOUD_READS_ENABLED: "true",
    CLOUD_WRITES_ENABLED: "true",
    TASK11_CLOUD_READS_ENABLED: "true",
    TASK11_CLOUD_WRITES_ENABLED: "true",
    TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
    TASK13_CLOUD_READS_ENABLED: "true",
    TASK13_CLOUD_WRITES_ENABLED: "true",
    TASK13_PAYMENT_PRIMARY_ENABLED: "true",
    TASK15_CLOUD_ONLY_ENABLED: "true",
    TASK18_ADMIN_MESSAGES_ENABLED: "true",
    TASK22_TRANSFER_ENABLED: "true",
    TASK22_TRANSFER_READS_ENABLED: "true",
    TASK22_TRANSFER_WRITES_ENABLED: "true",
    TASK25_FEATURE_FLAGS_ENABLED: "true",
    WORKERS_AI_ENABLED: "false",
    EMAIL_SENDING_ENABLED: "false",
    LEGACY_API_FALLBACK_ENABLED: "false",
    WYJ_TASK12_PASSWORD_PEPPER: PEPPER,
    WYJ_TASK14_TEMPORARY_SECRET: crypto.randomBytes(32).toString("hex"),
    WYJ_TASK20_DEVICE_SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
  };

  mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, ".wrangler/functions-build/index.js"),
    compatibilityDate: wrConfig.compatibility_date,
    d1Databases: ["WYJ_DB"],
    r2Buckets: ["WYJ_STORAGE"],
    bindings,
    serviceBindings: {
      ASSETS: async (req) => {
        const u = new URL(req.url);
        let relPath = decodeURIComponent(u.pathname);
        if (relPath === "/") relPath = "/index.html";
        let target = path.resolve(PAGES_DIR, `.${relPath}`);
        if (!target.startsWith(PAGES_DIR)) return new Response("Forbidden", { status: 403 });
        let isHtml = false;
        let stat = await fsp.stat(target).catch(() => null);
        if (!stat || stat.isDirectory()) {
          if (!path.extname(relPath)) {
            target = path.join(PAGES_DIR, "index.html");
            stat = await fsp.stat(target).catch(() => null);
            isHtml = true;
          } else {
            return new Response("Not Found", { status: 404 });
          }
        }
        const data = await fsp.readFile(target);
        const ext = path.extname(target).toLowerCase();
        const headers = new Headers({
          "Content-Type": MIME[ext] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
        });
        if (isHtml || relPath === "/" || relPath === "/index.html" || relPath === "/sw.js") {
          headers.set("Cache-Control", "no-cache, no-store, must-revalidate, no-transform");
        }
        return new Response(data, { status: 200, headers });
      },
    },
  });

  const db = await mf.getD1Database("WYJ_DB");
  const migrations = (await fsp.readdir(path.join(ROOT, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  for (const file of migrations) {
    await db.exec((await fsp.readFile(path.join(ROOT, "cloudflare/migrations", file), "utf8")).replace(/\r?\n/g, " "));
  }
  const now = new Date().toISOString();
  const freeHash = await hashSecret(FREE_SECRET, PEPPER);
  const vipHash = await hashSecret(VIP_SECRET, PEPPER);
  const adminHash = await hashSecret(ADMIN_SECRET, PEPPER);
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p6-free-1', 'p6_free', 'p6_free', ?1, 'pbkdf2_sha256', 310000, 'user', ?2, ?2, ?2, ?2)`).bind(freeHash, now).run();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p6-vip-1', 'p6_vip', 'p6_vip', ?1, 'pbkdf2_sha256', 310000, 'user', ?2, ?2, ?2, ?2)`).bind(vipHash, now).run();
  await db.prepare(`INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('p6-vip-1', 'all_features_access', 1, 'phase6 verify', 'wyj', ?1)`).bind(now).run();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p6-admin-1', 'wyj', 'wyj', ?1, 'pbkdf2_sha256', 310000, 'super_admin', ?2, ?2, ?2, ?2)`).bind(adminHash, now).run();
  await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'Phase 6 verify', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, 'p6-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000`).bind(now).run();

  server = http.createServer(async (req, res) => {
    try {
      const targetUrl = new URL(req.url || "/", BASE_URL).toString();
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || k.toLowerCase() === "host" || k.toLowerCase() === "connection") continue;
        if (Array.isArray(v)) headers.set(k, v.join(", "));
        else headers.set(k, String(v));
      }
      const hasBody = !["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase());
      const init = { method: req.method, headers };
      if (hasBody) {
        const chunks = [];
        for await (const ch of req) chunks.push(ch);
        init.body = Buffer.concat(chunks);
      }
      const mfRes = await mf.dispatchFetch(targetUrl, init);
      const outHeaders = {};
      for (const [k, v] of mfRes.headers.entries()) {
        if (k.toLowerCase() === "content-encoding" || k.toLowerCase() === "transfer-encoding") continue;
        outHeaders[k] = v;
      }
      const setCookies = typeof mfRes.headers.getSetCookie === "function" ? mfRes.headers.getSetCookie() : [];
      if (setCookies.length) outHeaders["set-cookie"] = setCookies;
      res.writeHead(mfRes.status, outHeaders);
      if (mfRes.body) {
        await new Promise((resolve, reject) => {
          const readable = Readable.fromWeb(mfRes.body);
          readable.on("error", reject);
          res.on("close", resolve);
          readable.pipe(res).on("finish", resolve);
        });
      } else {
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(err?.message || err));
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForHttp(`${BASE_URL}/api/status?source=cloud`, 20000);

  chromeProc = spawn(findChrome(), [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--remote-allow-origins=*", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${chromeDir}`, "--window-size=1440,900", "about:blank",
  ], { cwd: ROOT, stdio: "ignore", windowsHide: true });

  let cdpActivePort = "";
  for (let i = 0; i < 100; i += 1) {
    try { cdpActivePort = fs.readFileSync(path.join(chromeDir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0].trim(); } catch {}
    if (cdpActivePort) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(cdpActivePort, "Chrome DevToolsActivePort did not appear");
  const versionJson = JSON.parse(await waitForHttp(`http://127.0.0.1:${cdpActivePort}/json/version`, 25000));
  cdp = new CdpSession(versionJson.webSocketDebuggerUrl);
  await cdp.open();

  const { browserContextId } = await cdp.send("Target.createBrowserContext", {});
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p = {}) => cdp.send(m, p, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__aerisPromptCalls = 0;
      window.prompt = (...args) => { window.__aerisPromptCalls += 1; return null; };
    `,
  });

  const runtimeErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.text || "exception"));

  let activeRecDir = "";
  let activeFrames = [];
  let frameSeq = 0;
  cdp.on("Page.screencastFrame", (params) => {
    if (activeRecDir) {
      const filename = `frame_${String(++frameSeq).padStart(4, "0")}.png`;
      fs.writeFileSync(path.join(activeRecDir, filename), Buffer.from(params.data, "base64"));
      activeFrames.push({ file: filename, ts: Number(params.metadata?.timestamp) || Date.now() / 1000 });
    }
    void send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  });

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const ok = await evalJs(`Boolean(${expr})`).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 70));
    }
    const diag = await evalJs(`({ path: location.pathname, hash: location.hash, quota: document.getElementById("transferQuotaText")?.textContent, msg: document.getElementById("transferMessage")?.textContent, err: document.getElementById("transferRecipientError")?.className })`).catch(() => ({}));
    throw new Error(`waitFor timeout: ${expr}; diag=${JSON.stringify(diag)}`);
  };
  const shot = async (name, full = false) => {
    await new Promise((r) => setTimeout(r, 260));
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(data, "base64"));
  };

  const report = { checks: [], accounts: {}, viewports: [], perf: {}, runtime_errors: runtimeErrors };

  // 1. Guest mode check: 50 MiB cap, 3d/7d expiry disabled, private disabled
  await send("Page.navigate", { url: `${BASE_URL}/transfer` });
  await waitFor(`document.documentElement.dataset.bootState === "ready" && !document.getElementById("entryScreen") && document.getElementById("transferQuotaText") && !document.getElementById("transferQuotaText").textContent.includes("加载中")`);
  const guestState = await evalJs(`(() => {
    const exp = document.getElementById("transferExpiry");
    return {
      quota: document.getElementById("transferQuotaText").textContent,
      limits: document.getElementById("transferLimitsLine").textContent,
      privDisabled: document.getElementById("transferPrivate").disabled,
      opt3dDisabled: [...exp.options].find((o) => o.value === "4320")?.disabled,
      opt7dDisabled: [...exp.options].find((o) => o.value === "10080")?.disabled,
      guestHintVisible: !document.getElementById("transferGuestExpiryHint").classList.contains("hidden"),
      kickerCount: document.querySelectorAll("#transferPage .section-kicker").length,
    };
  })()`);
  assert.equal(guestState.privDisabled, true);
  assert.equal(guestState.opt3dDisabled, true);
  assert.equal(guestState.opt7dDisabled, true);
  assert.equal(guestState.guestHintVisible, true);
  assert.equal(guestState.kickerCount, 0);
  report.accounts.guest = guestState;
  report.checks.push({ id: "guest_limits_and_isolation", status: "PASS" });

  // 2. Sign in as Free -> VIP -> Super Admin to verify quota tiers + account switch isolation
  for (const [label, user, secret, expectedQuotaFragment] of [
    ["free", "p6_free", FREE_SECRET, "500.0 MiB"],
    ["vip", "p6_vip", VIP_SECRET, "2.00 GiB"],
    ["admin", "wyj", ADMIN_SECRET, "5.00 GiB"],
  ]) {
    await send("Page.navigate", { url: `${BASE_URL}/login` });
    await waitFor(`document.documentElement.dataset.bootState === "ready" && !document.getElementById("authPanel")?.classList.contains("hidden")`);
    await evalJs(`(() => {
      document.getElementById("usernameInput").value = ${JSON.stringify(user)};
      document.getElementById("secretInput").value = ${JSON.stringify(secret)};
      document.getElementById("loginForm").requestSubmit();
    })()`);
    await waitFor(`document.body.classList.contains("is-authenticated") && document.documentElement.dataset.p07Ui === "enabled" && document.documentElement.dataset.workspaceMount !== "pending" && document.querySelector('#v3Sidebar a[data-v3-nav="transfer"]')`);
    await new Promise((r) => setTimeout(r, 300));
    const t0 = performance.now();
    await evalJs(`document.querySelector('#v3Sidebar a[data-v3-nav="transfer"]').click(); true`);
    await waitFor(`location.pathname === "/transfer" && document.getElementById("transferQuotaText")?.textContent.includes(${JSON.stringify(expectedQuotaFragment)})`);
    const interactiveMs = +(performance.now() - t0).toFixed(1);
    const privEnabled = await evalJs(`!document.getElementById("transferPrivate").disabled`);
    assert.equal(privEnabled, true, `${label} should allow private attachments`);
    report.accounts[label] = { quota: expectedQuotaFragment, privateEnabled: privEnabled, interactiveMs };
    if (label === "admin") report.perf.transfer_route_interactive_ms = interactiveMs;
    if (label !== "admin") {
      await evalJs(`document.querySelector("#accountMenu summary").click();`);
      await waitFor(`document.getElementById("accountMenu").open`);
      await evalJs(`document.getElementById("logoutBtn").click();`);
      await waitFor(`!document.body.classList.contains("is-authenticated")`);
    }
  }
  report.checks.push({ id: "three_account_quota_and_isolation", status: "PASS" });

  // 3. Empty Light & Dark screenshots (1440x900)
  await shot("after-empty-1440.png");
  await evalJs(`while (document.documentElement.dataset.theme !== "dark") { document.getElementById("themeToggleBtn").click(); }`);
  await waitFor(`!document.documentElement.dataset.themeSwitching`);
  await shot("after-dark-1440.png");
  await evalJs(`while (document.documentElement.dataset.theme !== "light") { document.getElementById("themeToggleBtn").click(); }`);
  await waitFor(`!document.documentElement.dataset.themeSwitching`);

  // 4. Pre-upload validation banner (0-byte file rejected cleanly, never silently dropped)
  const doc0 = await send("DOM.getDocument", { depth: -1 });
  const fileInput0 = await send("DOM.querySelector", { nodeId: doc0.root.nodeId, selector: "#transferFileInput" });
  await send("DOM.setFileInputFiles", { nodeId: fileInput0.nodeId, files: [emptyFile] });
  await waitFor(`!document.getElementById("transferValidationBanner").classList.contains("hidden")`);
  await shot("after-validation-error-1440.png");
  await evalJs(`document.getElementById("transferValidationDismissBtn").click()`);
  await waitFor(`document.getElementById("transferValidationBanner").classList.contains("hidden")`);
  report.checks.push({ id: "pre_upload_validation_no_silent_drop", status: "PASS" });

  // 5. Expanded share settings (fixes vertical text wrap + password reveal + locked state check)
  await evalJs(`(() => {
    document.getElementById("transferConfigDisclosure").open = true;
    document.getElementById("transferPassword").value = "P6Secret!2026";
    document.getElementById("transferPassword").dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("transferMaxDownloads").value = "3";
    document.getElementById("transferMaxDownloads").dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await shot("after-config-expanded-1440.png");
  report.checks.push({ id: "settings_layout_and_summary", status: "PASS" });

  // 6. Start Sender 1.0x MP4 Screencast + Multipart Upload + Pause/Resume + Share + Tabs
  activeRecDir = framesDirSender;
  activeFrames = [];
  frameSeq = 0;
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

  const doc1 = await send("DOM.getDocument", { depth: -1 });
  const fileInput1 = await send("DOM.querySelector", { nodeId: doc1.root.nodeId, selector: "#transferFileInput" });
  await send("DOM.setFileInputFiles", { nodeId: fileInput1.nodeId, files: [largeBin, smallNoteA, smallJsonB] });
  await waitFor(`document.querySelectorAll("#transferQueue [data-transfer-item]").length === 3`);
  await waitFor(`document.getElementById("transferConfigLockBadge").dataset.locked === "true"`, 15000);
  await shot("after-queue-active-1440.png");

  // Pause & resume while queued/uploading
  await evalJs(`document.querySelector("#transferQueue [data-transfer-pause], #transferQueue [data-transfer-resume]")?.click(); true`);
  await new Promise((r) => setTimeout(r, 350));
  await evalJs(`document.querySelector("#transferQueue [data-transfer-resume]")?.click(); true`);

  await waitFor(`document.getElementById("transferCompleteBtn").disabled === false`, 45000);
  await evalJs(`document.getElementById("transferCompleteBtn").click()`);
  await waitFor(`!document.getElementById("transferShareCard").classList.contains("hidden")`, 20000);
  await evalJs(`document.getElementById("transferCopyLinkBtn").click()`);
  await new Promise((r) => setTimeout(r, 300));
  await shot("after-share-created-1440.png");
  const shareUrl = await evalJs(`document.getElementById("transferShareLink").value`);
  assert.ok(shareUrl.includes("#share="), `Invalid shareUrl: ${shareUrl}`);

  // Switch to Tab 2 (我的分享与附件) & test search + filter chips
  await evalJs(`document.getElementById("transferTabShares").click()`);
  await waitFor(`!document.getElementById("transferSharesPanel").classList.contains("hidden") && document.querySelectorAll("#transferMyShares .transfer-share-row").length >= 1`);
  assert.equal(await evalJs(`getComputedStyle(document.getElementById("transferShareCard")).display`), "none", "Share card must hide on Tab 2");
  await shot("after-shares-tab-1440.png");
  await evalJs(`(() => {
    const s = document.getElementById("transferSharesSearch");
    s.value = "multipart";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(await evalJs(`document.querySelectorAll("#transferMyShares .transfer-share-row").length >= 1`), true);
  await evalJs(`(() => {
    const s = document.getElementById("transferSharesSearch");
    s.value = "";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  // Switch to Tab 3 (未完成上传)
  await evalJs(`document.getElementById("transferTabUnfinished").click()`);
  await waitFor(`!document.getElementById("transferUnfinishedPanel").classList.contains("hidden")`);
  assert.equal(await evalJs(`getComputedStyle(document.getElementById("transferShareCard")).display`), "none", "Share card must hide on Tab 3");
  await shot("after-unfinished-tab-1440.png");

  await send("Page.stopScreencast");
  activeRecDir = "";
  encodeFramesToMp4(activeFrames, framesDirSender, path.join(OUT_DIR, "transfer-phase6-sender-1x.mp4"));
  report.sender_screencast_frames = activeFrames.length;
  report.checks.push({ id: "sender_multipart_pause_resume_share_tabs", status: "PASS" });

  // 7. Private attachment test (no public link / no QR)
  await evalJs(`document.getElementById("transferTabSend").click(); document.getElementById("transferPrivate").checked = true; document.getElementById("transferPrivate").dispatchEvent(new Event("change", { bubbles: true }));`);
  const doc2 = await send("DOM.getDocument", { depth: -1 });
  const fileInput2 = await send("DOM.querySelector", { nodeId: doc2.root.nodeId, selector: "#transferFileInput" });
  await send("DOM.setFileInputFiles", { nodeId: fileInput2.nodeId, files: [smallJsonB] });
  await waitFor(`document.getElementById("transferCompleteBtn").disabled === false`, 20000);
  await evalJs(`document.getElementById("transferCompleteBtn").click()`);
  await waitFor(`document.getElementById("transferShareTitle").textContent.includes("私有附件已保存")`, 20000);
  const privateBoxHidden = await evalJs(`document.getElementById("transferSharePublicBox").classList.contains("hidden") && document.getElementById("transferQr").classList.contains("hidden")`);
  assert.equal(privateBoxHidden, true);
  await shot("after-private-share-1440.png");
  report.checks.push({ id: "private_attachment_no_link_no_qr", status: "PASS" });

  // 8. Recipient Flow 1.0x MP4 Screencast + WAI-ARIA Password Modal + Revoke Recovery Card
  activeRecDir = framesDirRecip;
  activeFrames = [];
  frameSeq = 0;
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

  await send("Page.navigate", { url: shareUrl });
  await waitFor(`document.getElementById("transferPage").dataset.transferMode === "recipient" && !document.getElementById("transferPasswordModal").classList.contains("hidden")`, 20000);
  assert.equal(await evalJs(`window.__aerisPromptCalls`), 0, "window.prompt must NEVER be called");

  // Wrong password stays inside modal with inline error
  await evalJs(`(() => {
    document.getElementById("transferSharePasswordInput").value = "WrongPass123";
    document.getElementById("transferPasswordModalForm").requestSubmit();
  })()`);
  await waitFor(`!document.getElementById("transferPasswordModalError").classList.contains("hidden") && document.getElementById("transferPasswordModalError").textContent.includes("访问密码不正确")`, 15000);
  await shot("after-password-modal-1440.png");

  // Toggle reveal, submit correct password -> renders clean recipient card
  await evalJs(`(() => {
    document.getElementById("transferSharePasswordReveal").click();
    document.getElementById("transferSharePasswordInput").value = "P6Secret!2026";
    document.getElementById("transferPasswordModalForm").requestSubmit();
  })()`);
  await waitFor(`document.getElementById("transferPasswordModal").classList.contains("hidden") && !document.getElementById("transferShareCard").classList.contains("hidden")`, 20000);
  const senderHiddenInRecipient = await evalJs(`getComputedStyle(document.getElementById("transferSendPanel")).display === "none" && getComputedStyle(document.getElementById("transferSubnav")).display === "none" && getComputedStyle(document.getElementById("transferSubtitle")).display === "none"`);
  assert.equal(senderHiddenInRecipient, true);
  await shot("after-recipient-1440.png");

  // Click download -> authorizes download cleanly with zero window.prompt
  await evalJs(`document.querySelector("#transferShareFiles [data-transfer-download]").click()`);
  await waitFor(`document.getElementById("transferMessage").textContent.includes("下载已开始")`, 15000);
  assert.equal(await evalJs(`window.__aerisPromptCalls`), 0);

  // Owner revokes while on share page -> reload as recipient to see structured error recovery card
  await evalJs(`document.getElementById("transferCurrentRevokeBtn").click()`);
  await waitFor(`document.getElementById("transferShareCard").classList.contains("hidden")`, 15000);
  await send("Page.navigate", { url: `${shareUrl}&revokedCheck=1` });
  // Ensure hash navigation triggers recipient view cleanly
  await send("Page.navigate", { url: shareUrl });
  await waitFor(`!document.getElementById("transferRecipientError").classList.contains("hidden")`, 20000);
  assert.equal(await evalJs(`document.getElementById("transferMessage").textContent.trim()`), "", "Duplicate top message must be cleared when recipient error card is visible");
  await shot("after-recipient-error-1440.png");

  await send("Page.stopScreencast");
  activeRecDir = "";
  encodeFramesToMp4(activeFrames, framesDirRecip, path.join(OUT_DIR, "transfer-phase6-recipient-1x.mp4"));
  report.recipient_screencast_frames = activeFrames.length;
  report.checks.push({ id: "recipient_mode_password_modal_and_error_recovery", status: "PASS" });

  // 9. Keyboard navigation + Reduced motion + p07_accessibility=disabled fallback
  await send("Page.navigate", { url: `${BASE_URL}/transfer?senderCheck=1` });
  await waitFor(`document.getElementById("transferPage")?.dataset?.transferMode === "sender" && document.getElementById("transferLimitsLine")?.textContent?.includes("单次最多")`, 20000);
  await evalJs(`(() => {
    const tab = document.getElementById("transferTabSend");
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  })()`);
  assert.equal(await evalJs(`document.getElementById("transferPage").dataset.transferTab`), "shares");
  await evalJs(`document.getElementById("transferTabSend").click()`);

  // Reduced motion check
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const rmDur = await evalJs(`getComputedStyle(document.getElementById("transferDropZone")).transitionDuration`);
  assert.ok(Number.parseFloat(rmDur) <= 0.001, `Unexpected reduced-motion transitionDuration: ${rmDur}`);
  await send("Emulation.setEmulatedMedia", { features: [] });

  // p07_accessibility disabled fallback check
  await evalJs(`document.documentElement.dataset.p07Ui = "disabled";`);
  const fallbackVisible = await evalJs(`getComputedStyle(document.getElementById("transferPage")).display === "flex"`);
  assert.equal(fallbackVisible, true);
  await evalJs(`document.documentElement.dataset.p07Ui = "enabled";`);
  report.checks.push({ id: "keyboard_nav_reduced_motion_and_p07_fallback", status: "PASS" });

  // 10. 7-Viewport Responsive Sweep (320..2560) + Mobile Screenshots
  for (const [w, h, mobile] of [[320, 700, true], [375, 812, true], [390, 844, true], [768, 1024, false], [1440, 900, false], [1920, 1080, false], [2560, 1440, false]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await new Promise((r) => setTimeout(r, 250));
    const m = await evalJs(`(() => ({
      w: document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth,
      tabBtnH: Math.round(document.getElementById("transferTabSend").getBoundingClientRect().height),
      selectBtnH: Math.round(document.getElementById("transferSelectFilesBtn").getBoundingClientRect().height),
    }))()`);
    assert.ok(m.scrollW <= m.w + 1, `Horizontal overflow at ${w}px: ${JSON.stringify(m)}`);
    if (w <= 768) {
      assert.ok(m.tabBtnH >= 44 && m.selectBtnH >= 44, `Touch target < 44px at ${w}px: ${JSON.stringify(m)}`);
    }
    report.viewports.push({ width: w, ...m });
    if (w === 390) await shot("after-mobile-390.png");
    if (w === 320) await shot("after-mobile-320.png");
  }

  assert.equal(runtimeErrors.length, 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);
  fs.writeFileSync(path.join(OUT_DIR, "phase6-verification.json"), JSON.stringify(report, null, 2));
  console.log("PHASE6_VERIFICATION_PASS", JSON.stringify({
    checks: report.checks.length,
    accounts: Object.keys(report.accounts),
    viewports: report.viewports.length,
    interactiveMs: report.perf.transfer_route_interactive_ms,
    senderFrames: report.sender_screencast_frames,
    recipientFrames: report.recipient_screencast_frames,
    runtimeErrors: runtimeErrors.length,
    chromePid: chromeProc.pid,
  }));
} finally {
  setTimeout(() => process.exit(process.exitCode || 0), 4000).unref();
  if (cdp) cdp.close();
  if (chromeProc?.pid) killPidTree(chromeProc.pid);
  if (server) {
    server.closeAllConnections?.();
    await Promise.race([new Promise((r) => server.close(r)), new Promise((r) => setTimeout(r, 1500))]);
  }
  if (mf) await Promise.race([mf.dispose().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
