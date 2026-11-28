import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Miniflare } from "../../node_modules/miniflare/dist/src/index.js";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGES_DIR = path.join(ROOT, ".wrangler/pages-output");
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase7-account/evidence/after");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 18827;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase7-verify-local-pepper-2026-32ch";
const FREE_SECRET = "Phase7Free#2026!";
const FREE_SECRET_NEW = "Phase7FreeNew#2026!";
const VIP_SECRET = "Phase7Vip#2026!";
const ADMIN_SECRET = "Phase7Admin#2026!";

// Valid minimal 1x1 PNG bytes for R2 payment QR fixtures
const VALID_PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
  close() {
    try { this.ws.close(); } catch {}
  }
}

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p7-verify-"));
const chromeDir = path.join(tmpDir, "chrome-profile");
const framesDesktopDir = path.join(tmpDir, "frames-desktop");
const framesMobileDir = path.join(tmpDir, "frames-mobile");
fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(framesDesktopDir, { recursive: true });
fs.mkdirSync(framesMobileDir, { recursive: true });

let mf = null;
let server = null;
let chromeProc = null;
let cdp = null;

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
  const r2 = await mf.getR2Bucket("WYJ_STORAGE");
  const migrations = (await fsp.readdir(path.join(ROOT, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  for (const file of migrations) {
    await db.exec((await fsp.readFile(path.join(ROOT, "cloudflare/migrations", file), "utf8")).replace(/\r?\n/g, " "));
  }

  // Seed QR PNGs in R2 for all 8 plans x wechat/alipay
  const planRows = await db.prepare("SELECT code FROM task13_membership_plans WHERE purchasable = 1").all();
  for (const row of planRows.results || []) {
    for (const method of ["wechat", "alipay"]) {
      await r2.put(`payments/qrcodes/v1/${method}_${row.code}.png`, VALID_PNG_1X1, {
        httpMetadata: { contentType: "image/png" },
      });
    }
  }

  const now = new Date().toISOString();
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const freeHash = await hashSecret(FREE_SECRET, PEPPER);
  const vipHash = await hashSecret(VIP_SECRET, PEPPER);
  const adminHash = await hashSecret(ADMIN_SECRET, PEPPER);

  const nearExpiryIso = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p7-free-1', 'p7_free', 'p7_free', ?1, 'pbkdf2_sha256', 310000, 'user', ?2, ?2, ?2, ?2)`).bind(freeHash, now).run();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p7-vip-1', 'p7_vip', 'p7_vip', ?1, 'pbkdf2_sha256', 310000, 'user', ?2, ?2, ?2, ?2)`).bind(vipHash, now).run();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p7-expiring-1', 'p7_expiring', 'p7_expiring', ?1, 'pbkdf2_sha256', 310000, 'user', ?2, ?2, ?2, ?2)`).bind(freeHash, now).run();
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p7-admin-1', 'wyj', 'wyj', ?1, 'pbkdf2_sha256', 310000, 'super_admin', ?2, ?2, ?2, ?2)`).bind(adminHash, now).run();

  // Stacked memberships for p7_vip (lifetime dual language + timed finance monthly) + near-expiry user p7_expiring
  await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at) VALUES ('p7-mem-1', 'p7-vip-1', 'dual_language_lifetime', ?1, '', 1, 'active', 'admin', 'p7-seed-1', 'wyj', '{}', ?1, ?1)`).bind(now).run();
  await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at) VALUES ('p7-mem-2', 'p7-vip-1', 'finance_monthly', ?1, ?2, 0, 'active', 'admin', 'p7-seed-2', 'wyj', '{}', ?1, ?1)`).bind(now, nextMonth).run();
  await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at) VALUES ('p7-mem-3', 'p7-expiring-1', 'tools_monthly', ?1, ?2, 0, 'active', 'admin', 'p7-seed-3', 'wyj', '{}', ?1, ?1)`).bind(now, nearExpiryIso).run();

  await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'Phase 7 verify', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, 'p7-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000`).bind(now).run();

  let forcePaymentQr503 = false;
  server = http.createServer(async (req, res) => {
    try {
      const parsedReqUrl = new URL(req.url || "/", BASE_URL);
      if (forcePaymentQr503 && parsedReqUrl.pathname === "/api/recharge/qr") {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: false, error: "收款二维码在当前预览环境下暂不可用" }));
        return;
      }
      const targetUrl = parsedReqUrl.toString();
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
  const pageErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => pageErrors.push(p?.exceptionDetails?.text || "runtime_exception"));

  const evalJs = async (expression) => {
    const res = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text} :: ${res.exceptionDetails.exception?.description || ""}`);
    }
    return res.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 15000, label = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await evalJs(expr)) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`waitFor timeout (${timeoutMs}ms): ${label}`);
  };
  const click = async (selector) => {
    await waitFor(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el && !el.disabled && el.offsetParent !== null); })()`, 15000, `clickable ${selector}`);
    const clicked = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.click(); return true; })()`);
    assert.equal(clicked, true);
  };
  const setField = async (selector, value) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, 15000, `field ${selector}`);
    await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(String(value))});
      else el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  };
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 220));
    const png = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(png.data, "base64"));
  };
  const axeSource = fs.readFileSync(path.join(ROOT, "qa/p07-f/vendor/axe.min.js"), "utf8");
  const runAxe = async (rootSelector) => {
    const injected = await evalJs("typeof window.axe === 'object'");
    if (!injected) await evalJs(axeSource);
    const violations = await evalJs(`axe.run(document.querySelector(${JSON.stringify(rootSelector)})).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })))`);
    assert.deepEqual(violations, [], `axe violations in ${rootSelector}: ${JSON.stringify(violations)}`);
  };

  let activeRecording = null;
  cdp.on("Page.screencastFrame", async (p) => {
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId);
    } catch {}
    if (!activeRecording) return;
    const idx = activeRecording.frames.length + 1;
    const file = `frame-${String(idx).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(activeRecording.dir, file), Buffer.from(p.data, "base64"));
    activeRecording.frames.push({ file, ts: p.metadata?.timestamp || (Date.now() / 1000) });
  });

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  const report = {
    source: "isolated Miniflare D1/R2 + headless Chrome",
    checks: [],
    geometry: {},
    viewports: [],
    videos: [],
    screenshots: [],
  };
  const pass = (name, details = {}) => {
    report.checks.push({ name, status: "PASS", ...details });
    console.log(`PASS ${name}`);
  };

  // Start desktop recording across Auth -> Account -> Membership walkthrough
  const desktopFrames = [];
  activeRecording = { dir: framesDesktopDir, frames: desktopFrames };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }, sessionId);

  // 1. Auth & Standalone Centering + Wrong password + Registration + Recovery
  await cdp.send("Page.navigate", { url: `${BASE_URL}/login` }, sessionId);
  await waitFor("document.documentElement.dataset.bootState === 'ready' && !document.getElementById('authPanel').classList.contains('hidden')", 25000, "login ready");
  const authGeometry = await evalJs(`(() => {
    const sb = document.getElementById('v3Sidebar');
    const sbStyle = sb ? getComputedStyle(sb).display : 'none';
    const panel = document.getElementById('authPanel').getBoundingClientRect();
    const canvas = document.getElementById('v3MainCanvas').getBoundingClientRect();
    const app = document.getElementById('projectApp').getBoundingClientRect();
    const viewportW = document.documentElement.clientWidth;
    return {
      sidebarDisplay: sbStyle,
      panelLeft: panel.left,
      panelRight: panel.right,
      panelWidth: panel.width,
      canvasLeft: canvas.left,
      canvasWidth: canvas.width,
      appLeft: app.left,
      appWidth: app.width,
      viewportW,
      innerW: window.innerWidth,
      centerDelta: Math.abs((panel.left + panel.width / 2) - viewportW / 2),
      canvasDelta: Math.abs((panel.left + panel.width / 2) - (canvas.left + canvas.width / 2)),
    };
  })()`);
  assert.equal(authGeometry.sidebarDisplay, "none", "Sidebar must be hidden on standalone /login page");
  assert.equal(authGeometry.canvasLeft, 0, "Main canvas must start at left edge when sidebar is hidden");
  assert.ok(authGeometry.canvasDelta <= 2, `Auth card must be centered in available viewport area, got ${JSON.stringify(authGeometry)}`);

  // Verify wrong password preserves username & shows loading state cleanly
  await setField("#usernameInput", "p7_free");
  await setField("#secretInput", "WrongSecret#999!");
  await click("#loginSubmitBtn");
  await waitFor("document.getElementById('loginError').textContent.length > 0 && !document.getElementById('loginSubmitBtn').disabled", 15000, "wrong login message");
  assert.equal(await evalJs("document.getElementById('usernameInput').value"), "p7_free");
  await runAxe("#authPanel");
  await shot("desktop-login-light.png");

  // Switch to /register, test live mismatch hint & consent default
  await click("#showRegisterBtn");
  await waitFor("location.pathname === '/register' && !document.getElementById('registerForm').classList.contains('hidden')", 10000, "register view");
  assert.equal(await evalJs("document.getElementById('registerTermsConsent').checked"), false);
  await setField("#registerSecretInput", "Phase7Reg#2026!");
  await setField("#registerConfirmInput", "Phase7Mismatch#1");
  await waitFor("!document.getElementById('registerConfirmHint').hidden && document.getElementById('registerConfirmHint').dataset.state === 'error'", 5000, "confirm mismatch hint");
  await setField("#registerConfirmInput", "Phase7Reg#2026!");
  await waitFor("document.getElementById('registerConfirmHint').dataset.state === 'ok'", 5000, "confirm match hint");
  const regName = `p7_user_${Date.now().toString(36)}`;
  await setField("#registerUsernameInput", regName);
  await runAxe("#authPanel");
  await shot("desktop-register-light.png");
  await click("#registerTermsConsent");
  await click("#registerSubmitBtn");
  await waitFor("location.pathname === '/login' && document.getElementById('loginError').textContent.includes('注册成功')", 20000, "registration completes to login");
  pass("auth_standalone_centering_and_validation", authGeometry);

  // Verify policy pages reachable without auth
  for (const policyPath of ["/terms", "/privacy", "/security-privacy", "/forgot-password"]) {
    const r = await fetch(`${BASE_URL}${policyPath}`);
    assert.equal(r.status, 200, `${policyPath} returned ${r.status}`);
  }
  pass("auth_policies_and_recovery_routes_200");

  // 2. Log in as p7_free -> /account Hub Centering, 6 Tabs, Expanded/Collapsed Sidebar, Theme Sync, Copy ID
  await setField("#usernameInput", "p7_free");
  await setField("#secretInput", FREE_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/' && Boolean(localStorage.getItem('wyjAccountSession'))", 25000, "free user login");
  await click("#v3Sidebar [data-v3-nav=account]");
  await waitFor("location.pathname === '/account' && !document.getElementById('accountModal').classList.contains('hidden')", 15000, "account route");
  await waitFor("document.getElementById('accountOverviewEmailStatus').textContent === '未绑定邮箱'", 15000, "honest unbound email status");

  assert.equal(await evalJs("document.getElementById('accountHeaderRolePill').textContent.trim()"), "普通用户");
  assert.equal(await evalJs("document.getElementById('accountOverviewPlanBadge').textContent.trim()"), "免费基础版");

  // Copy Account ID feedback
  await evalJs("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async v => { window.__copiedId = v; } } }); true");
  await click("#copyAccountIdBtn");
  await waitFor("window.__copiedId === 'p7-free-1' && document.getElementById('copyAccountIdBtn').textContent === '已复制'", 5000, "copy account ID");
  await evalJs("delete window.__copiedId; true");

  // Measure centerline & container width across all 6 tabs (sidebar expanded AND collapsed)
  const measureAllTabs = async () => {
    const rows = {};
    for (const tab of ["overview", "security", "membership", "data", "preferences", "sync"]) {
      await click(`#accountSubnav [data-account-tab="${tab}"]`);
      await waitFor(`document.getElementById('accountModal').dataset.accountTab === '${tab}'`, 5000, `tab ${tab}`);
      await new Promise((r) => setTimeout(r, 120));
      rows[tab] = await evalJs(`(() => {
        const modal = document.getElementById('accountModal').getBoundingClientRect();
        const canvas = document.getElementById('v3MainCanvas').getBoundingClientRect();
        return {
          left: modal.left,
          width: modal.width,
          modalCenterX: modal.left + modal.width / 2,
          canvasCenterX: canvas.left + canvas.width / 2,
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      })()`);
      assert.equal(rows[tab].overflowX, false, `Overflow on account tab ${tab}`);
    }
    const base = rows.overview;
    for (const [tab, box] of Object.entries(rows)) {
      assert.ok(Math.abs(box.width - base.width) <= 1, `Tab ${tab} width ${box.width} != overview ${base.width}`);
      assert.ok(Math.abs(box.left - base.left) <= 1, `Tab ${tab} left ${box.left} != overview ${base.left}`);
      assert.ok(Math.abs(box.modalCenterX - box.canvasCenterX) <= 2, `Tab ${tab} not centered in #v3MainCanvas`);
    }
    return rows;
  };

  report.geometry.expandedSidebar = await measureAllTabs();
  await click("#accountSubnav [data-account-tab='overview']");
  await shot("desktop-account-overview-light.png");

  // Toggle sidebar collapse & re-measure all 6 tabs
  const collapseBtn = await evalJs("Boolean(document.querySelector('#v3SidebarCollapseBtn'))");
  if (collapseBtn) {
    await click("#v3SidebarCollapseBtn");
    await new Promise((r) => setTimeout(r, 400));
    report.geometry.collapsedSidebar = await measureAllTabs();
    await click("#v3SidebarCollapseBtn");
    await new Promise((r) => setTimeout(r, 400));
  }

  // Test inline security tab & screenshot
  await click("#accountSubnav [data-account-tab='security']");
  await waitFor("document.querySelector('#accountSecurityInlineBody .account-security-rows')", 15000, "inline security rows");
  await shot("desktop-account-security-light.png");

  // Test theme switcher on preferences tab (dark -> screenshot -> light)
  await click("#accountSubnav [data-account-tab='preferences']");
  await click('[data-account-theme="dark"]');
  await waitFor("document.documentElement.dataset.theme === 'dark' && localStorage.getItem('wyj_theme_preference_v1') === 'dark'", 5000, "dark theme toggle");
  await shot("desktop-account-preferences-dark.png");
  await click('[data-account-theme="light"]');
  await waitFor("document.documentElement.dataset.theme === 'light'", 5000, "restore light theme");

  // Axe audit across Account Hub
  await click("#accountSubnav [data-account-tab='overview']");
  await runAxe("#accountModal");

  // Non-admin authorization fails closed
  const adminProbe = await evalJs(`fetch('/api/admin/users', { headers: { 'X-Session-Token': localStorage.getItem('wyjAccountSession') } }).then(r => r.status)`);
  assert.equal(adminProbe, 403, "Ordinary user must receive 403 on /api/admin/users");
  pass("account_hub_centering_tabs_themes_axe_and_rbac", report.geometry);

  // 3. Membership & Recharge (GPT Pro Switchers + Fixed 3-Col Grid + 2-Col Checkout + Agreement + Orders)
  await click("#v3Sidebar [data-v3-nav=recharge]");
  await waitFor("location.pathname === '/recharge' && !document.getElementById('membershipModal').classList.contains('hidden')", 15000, "recharge route");
  await waitFor("document.querySelectorAll('#membershipRecommendedPlanList [data-plan]').length === 3", 15000, "3 recommended cards rendered");

  // Centerline & Fixed 3-Column Horizontal Desktop Geometry (expanded AND collapsed sidebar)
  const measurePlansLayout = async () => evalJs(`(() => {
    const r = document.getElementById('membershipModal').getBoundingClientRect();
    const c = document.getElementById('v3MainCanvas').getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll('#membershipRecommendedPlanList > .plan-card'));
    const cardRects = cards.map((el) => el.getBoundingClientRect());
    const buyRects = cards.map((el) => el.querySelector('[data-plan-buy]').getBoundingClientRect());
    const priceRects = cards.map((el) => el.querySelector('.plan-price-row').getBoundingClientRect());
    return {
      width: r.width,
      centerDelta: Math.abs((r.left + r.width / 2) - (c.left + c.width / 2)),
      cardCount: cards.length,
      rowTopDelta: Math.max(...cardRects.map((x) => x.top)) - Math.min(...cardRects.map((x) => x.top)),
      widthDelta: Math.max(...cardRects.map((x) => x.width)) - Math.min(...cardRects.map((x) => x.width)),
      buyTopDelta: Math.max(...buyRects.map((x) => x.top)) - Math.min(...buyRects.map((x) => x.top)),
      priceTopDelta: Math.max(...priceRects.map((x) => x.top)) - Math.min(...priceRects.map((x) => x.top)),
    };
  })()`);
  const membershipBox = await measurePlansLayout();
  assert.ok(Math.abs(membershipBox.width - report.geometry.expandedSidebar.overview.width) <= 1, "Membership width must match Account Hub width");
  assert.ok(membershipBox.centerDelta <= 2, "Membership must center inside #v3MainCanvas");
  assert.equal(membershipBox.cardCount, 3, "Desktop Plans view must render 3 recommended cards");
  assert.ok(membershipBox.rowTopDelta <= 2, `3 cards must stay on 1 horizontal row (got delta=${membershipBox.rowTopDelta})`);
  assert.ok(membershipBox.widthDelta <= 2, `3 cards must share equal width (got delta=${membershipBox.widthDelta})`);
  assert.ok(membershipBox.buyTopDelta <= 2, `3 card CTA buttons must align horizontally (got delta=${membershipBox.buyTopDelta})`);
  assert.ok(membershipBox.priceTopDelta <= 2, `3 card prices must align horizontally (got delta=${membershipBox.priceTopDelta})`);

  // Verify 3-col horizontal grid stays centered and 3-wide after sidebar collapse too
  if (await evalJs("Boolean(document.querySelector('#v3SidebarCollapseBtn'))")) {
    await click("#v3SidebarCollapseBtn");
    await new Promise((r) => setTimeout(r, 400));
    const collapsedPlansBox = await measurePlansLayout();
    assert.ok(collapsedPlansBox.centerDelta <= 2, "Collapsed sidebar: membership must stay centered inside #v3MainCanvas");
    assert.ok(collapsedPlansBox.rowTopDelta <= 2, "Collapsed sidebar: 3 cards must stay on 1 horizontal row");
    await click("#v3SidebarCollapseBtn");
    await new Promise((r) => setTimeout(r, 400));
  }

  // State 1: Clean Plans Page (zero summary/pending/7-filters/essay; only 2 main tabs; default All-Access = Lifetime + single推荐)
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'plans'", 5000, "initial plans view");
  assert.equal(await evalJs("document.getElementById('membershipPlanStep').dataset.plansScope"), "recommended");
  assert.equal(await evalJs("document.getElementById('membershipTabPlans').textContent.trim()"), "会员套餐");
  assert.equal(await evalJs("document.getElementById('membershipTabOrders').textContent.trim()"), "订单管理");
  assert.equal(await evalJs("document.getElementById('membershipPlansView').contains(document.getElementById('membershipCurrentSummary'))"), false, "Current summary must NOT render on Plans page");
  assert.equal(await evalJs("Boolean(document.getElementById('membershipPurposeGrid'))"), false, "Legacy 7-purpose gate must be removed");
  assert.equal(await evalJs("document.querySelectorAll('#membershipRecommendedPlanList .plan-badge-recommended').length"), 1, "Only one recommendation badge on page");
  assert.equal(await evalJs("document.querySelector('#membershipRecommendedPlanList [data-card-family=\"all\"]').dataset.plan"), "all_access_lifetime", "All-access card defaults to lifetime");
  assert.equal(await evalJs("document.querySelectorAll('#membershipRecommendedPlanList [data-card-family=\"tools\"] [data-card-variant]').length"), 0, "Tools card must not add fake lifetime variant");
  assert.equal(await evalJs("document.getElementById('membershipShowAllPlansBtn').textContent.trim()"), "查看所有套餐");
  await shot("desktop-membership-plans.png");

  // Exercise GPT Pro card-internal variant switchers + inline EN/JA toggle + expandable details
  const reachablePlans = new Set(await evalJs("Array.from(document.querySelectorAll('#membershipPlanList [data-plan]')).map(el => el.dataset.plan)"));
  for (const variant of ["notification_archive_access", "finance_monthly", "trial_single_language"]) {
    await click(`[data-card-family="single"] [data-card-variant="${variant}"]`);
    await waitFor(`document.querySelector('[data-card-family="single"]').dataset.plan === '${variant}'`, 5000, `single switch ${variant}`);
    reachablePlans.add(variant);
  }
  await click('[data-card-family="single"] [data-card-lang="japanese"]');
  assert.equal(await evalJs("document.getElementById('trialLanguageSelect').value"), "japanese", "Inline card language pill syncs trialLanguageSelect");
  await click('[data-card-family="all"] [data-card-variant="all_access_monthly"]');
  await waitFor("document.querySelector('[data-card-family=\"all\"]').dataset.plan === 'all_access_monthly'", 5000, "all switch monthly");
  reachablePlans.add("all_access_monthly");
  await click('[data-card-family="all"] [data-card-variant="all_access_lifetime"]');
  await click('[data-card-family="all"] .plan-full-details summary');
  assert.equal(await evalJs("document.querySelector('[data-card-family=\"all\"] .plan-full-details').open"), true, "Full entitlements drawer expands");
  await click('[data-card-family="all"] .plan-full-details summary');

  // Toggle remaining merged Dual Language card cleanly in-place via bottom button (reaches all 8 SKUs)
  await click("#membershipShowAllPlansBtn");
  await waitFor("document.getElementById('membershipPlanStep').dataset.plansScope === 'all' && document.getElementById('membershipExtraPlansRegion').classList.contains('is-expanded')", 10000, "extra plans expanded");
  reachablePlans.add(await evalJs("document.querySelector('#membershipExtraPlansRegion [data-card-family=\"bilingual\"]').dataset.plan"));
  const extraCardWidth = await evalJs("document.querySelector('#membershipExtraPlansRegion .plan-card').getBoundingClientRect().width");
  assert.ok(extraCardWidth <= 355, `Merged Row 2 card must keep clean width <=355px (got ${extraCardWidth})`);
  await click('[data-card-family="bilingual"] [data-card-variant="japanese_lifetime"]');
  await waitFor("document.querySelector('[data-card-family=\"bilingual\"]').dataset.plan === 'japanese_lifetime'", 5000, "bilingual switch lifetime");
  reachablePlans.add("japanese_lifetime");
  assert.equal(reachablePlans.size, 8, `All 8 real SKUs must be reachable across cards (got ${Array.from(reachablePlans).join(',')})`);
  await shot("desktop-membership-all8.png");
  await click("#membershipShowAllPlansBtn");
  await waitFor("document.getElementById('membershipPlanStep').dataset.plansScope === 'recommended'", 5000, "collapse back to recommended");

  // State 2: Dedicated Two-Column GPT Checkout + Agreement Gate + QR Error Fixture + Real QR Checkout
  await click('[data-card-family="all"] [data-card-variant="all_access_monthly"]');
  await click('[data-plan="all_access_monthly"] [data-plan-buy]');
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'checkout' && document.getElementById('membershipPlansView').classList.contains('hidden')", 10000, "isolated checkout view");
  assert.ok((await evalJs("document.getElementById('membershipSelectedPlanCard').textContent")).includes("30 CNY"));
  const checkoutCols = await evalJs(`(() => {
    const l = document.querySelector('#membershipCheckoutView .gpt-checkout-left').getBoundingClientRect();
    const r = document.querySelector('#membershipCheckoutView .gpt-checkout-right').getBoundingClientRect();
    return { leftRight: l.right, rightLeft: r.left, topDelta: Math.abs(l.top - r.top) };
  })()`);
  assert.ok(checkoutCols.leftRight < checkoutCols.rightLeft && checkoutCols.topDelta <= 4, "Desktop checkout must use 2-column side-by-side layout");

  // Payment Agreement checkbox must block order creation until accepted
  await evalJs("document.querySelector('input[name=paymentMethod][value=wechat]').click(); true");
  assert.equal(await evalJs("document.getElementById('paymentAgreementCheckbox').checked"), false, "Payment agreement starts unchecked");
  assert.equal(await evalJs("document.getElementById('submitRechargeBtn').disabled"), true, "Submit remains disabled without checking payment agreement");
  await shot("desktop-membership-checkout.png");
  await click("#openPaymentAgreementBtn");
  await waitFor("!document.getElementById('paymentAgreementModal').classList.contains('hidden')", 5000, "payment agreement modal opens");
  assert.ok((await evalJs("document.getElementById('paymentAgreementModal').textContent")).includes("24 小时"));
  await shot("desktop-membership-checkout-agreement.png");
  await click("#acceptPaymentAgreementBtn");
  await waitFor("document.getElementById('paymentAgreementModal').classList.contains('hidden') && document.getElementById('paymentAgreementCheckbox').checked", 5000, "payment agreement accepted");
  assert.equal(await evalJs("document.getElementById('submitRechargeBtn').disabled"), false, "Submit enabled once method and agreement selected");

  // Back to plans cleanly
  await click("#membershipBackToPlansBtn");
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'plans'", 5000, "return from checkout to plans");

  // Re-enter checkout and test honest 503 QR unavailable error state
  await click('[data-card-family="all"] [data-card-variant="all_access_monthly"]');
  await click('[data-plan="all_access_monthly"] [data-plan-buy]');
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'checkout'", 10000, "checkout view re-entered");
  await evalJs("document.querySelector('input[name=paymentMethod][value=wechat]').click(); true");
  if (!(await evalJs("document.getElementById('paymentAgreementCheckbox').checked"))) {
    await click("#paymentAgreementCheckbox");
  }
  forcePaymentQr503 = true;
  await click("#submitRechargeBtn");
  await waitFor("document.getElementById('paymentQrWrap').dataset.qrState === 'error' && document.getElementById('paymentQrMessage').textContent.includes('切勿盲目转账')", 15000, "honest 503 QR unavailable state");
  await shot("desktop-membership-qr-error.png");
  forcePaymentQr503 = false;

  // Cancel broken preview QR order and create valid WeChat QR order
  await click("#cancelPaymentOrderBtn");
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'checkout' && document.getElementById('paymentOrderBox').classList.contains('hidden')", 15000, "cancelled order returns to configurator");
  await evalJs("document.querySelector('input[name=paymentMethod][value=wechat]').click(); true");
  if (!(await evalJs("document.getElementById('paymentAgreementCheckbox').checked"))) {
    await click("#paymentAgreementCheckbox");
  }
  await click("#submitRechargeBtn");
  await waitFor("!document.getElementById('paymentOrderBox').classList.contains('hidden') && document.getElementById('paymentOrderBox').dataset.orderMode === 'qr'", 15000, "payment order QR locked");
  await waitFor("document.getElementById('paymentQrImage').complete && document.getElementById('paymentQrImage').naturalWidth > 0", 15000, "payment QR decoded");
  await waitFor("document.querySelectorAll('#paymentOrderTimeline .payment-timeline-item').length === 4", 5000, "timeline rendered");
  await shot("desktop-membership-checkout-qr.png");

  // Cancel and recreate with Alipay, then notify admin ("我已付款") -> Dedicated Waiting-for-Review / Orders View
  await click("#cancelPaymentOrderBtn");
  await waitFor("document.getElementById('paymentOrderBox').classList.contains('hidden')", 15000, "order cancelled before alipay");
  await evalJs("document.querySelector('input[name=paymentMethod][value=alipay]').click(); true");
  if (!(await evalJs("document.getElementById('paymentAgreementCheckbox').checked"))) {
    await click("#paymentAgreementCheckbox");
  }
  await click("#submitRechargeBtn");
  await waitFor("!document.getElementById('confirmPaymentBtn').classList.contains('hidden')", 15000, "recreated alipay order");
  await click("#confirmPaymentBtn");
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'orders' && document.getElementById('paymentOrderBox').dataset.orderMode === 'review'", 15000, "dedicated review view");
  await waitFor("!document.getElementById('membershipReviewBanner').classList.contains('hidden')", 5000, "review banner shown");
  assert.equal(await evalJs("document.getElementById('membershipTabOrders').textContent.trim()"), "订单管理", "Tab label must stay 订单管理 even while under review");
  assert.equal(await evalJs("document.getElementById('paymentOrderActionCard').classList.contains('hidden')"), true, "QR payment card must hide in review view");
  assert.equal(await evalJs("document.getElementById('membershipCurrentSummary').textContent.includes('免费基础版')"), true, "Membership MUST NOT show active before admin approval");
  await waitFor("document.querySelectorAll('#membershipOrderHistoryList .membership-history-row').length >= 1", 15000, "order history updated");
  await runAxe("#membershipModal");
  await shot("desktop-membership-waiting-review.png");
  await shot("desktop-membership-orders.png");

  // Visiting /recharge directly MUST default to browsing Plans even while an order awaits review
  await cdp.send("Page.navigate", { url: `${BASE_URL}/recharge` }, sessionId);
  await waitFor("location.pathname === '/recharge' && document.getElementById('membershipModal').dataset.membershipView === 'plans'", 15000, "direct /recharge defaults to plans even with open review order");
  await click("#membershipTabOrders");
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'orders' && document.getElementById('paymentOrderBox').dataset.orderMode === 'review'", 10000, "orders tab shows pending review order");

  // Approve order as admin via API, then refresh in user view -> becomes approved cleanly
  const adminLoginRes = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE_URL },
    body: JSON.stringify({ username: "wyj", secret: ADMIN_SECRET }),
  });
  const adminLoginJson = await adminLoginRes.json();
  assert.equal(adminLoginRes.status, 200, "Admin login for approval check");
  const pendingOrderId = await evalJs("fetch('/api/recharge/mine', { headers: { 'X-Session-Token': localStorage.getItem('wyjAccountSession') || '' } }).then(r => r.json()).then(d => (d.requests || []).find(item => ['user_paid', 'processing', 'pending_payment'].includes(item.status))?.id || '')");
  assert.ok(pendingOrderId, "Expected open order ID");
  const stepupRes = await fetch(`${BASE_URL}/api/security/stepup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE_URL, "X-Session-Token": adminLoginJson.session },
    body: JSON.stringify({ password: ADMIN_SECRET, scope: "admin_entitlements" }),
  });
  const stepupJson = await stepupRes.json().catch(() => ({}));
  const approveHeaders = {
    "Content-Type": "application/json",
    "Origin": BASE_URL,
    "X-Session-Token": adminLoginJson.session,
    ...(stepupJson?.grant ? { "X-Aeris-Stepup": stepupJson.grant } : {}),
  };
  const approveRes = await fetch(`${BASE_URL}/api/admin/recharge/process`, {
    method: "POST",
    headers: approveHeaders,
    body: JSON.stringify({ request_id: pendingOrderId, action: "approve", admin_note: "p7 verify approved" }),
  });
  assert.equal(approveRes.status, 200, "Admin approval API");
  await click("#refreshReviewOrderBtn");
  await waitFor("document.getElementById('membershipCurrentSummary').textContent.includes('全功能')", 15000, "membership updated after admin approval");
  pass("membership_3states_all8_plans_qr_error_and_waiting_review");

  // Stop desktop recording and encode
  await cdp.send("Page.stopScreencast", {}, sessionId);
  activeRecording = null;
  const desktopMp4 = path.join(OUT_DIR, "desktop-account-walkthrough.mp4");
  encodeFramesToMp4(desktopFrames, framesDesktopDir, desktopMp4);
  report.videos.push("desktop-account-walkthrough.mp4");

  // 4. Stacked VIP + Super Admin Role Separation Check
  await click("#logoutBtn");
  await waitFor("location.pathname === '/login'", 15000, "logout to vip");
  await setField("#usernameInput", "p7_vip");
  await setField("#secretInput", VIP_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "vip login");
  await click("#v3Sidebar [data-v3-nav=account]");
  await click("#accountSubnav [data-account-tab='membership']");
  await waitFor("document.getElementById('accountMembershipStackedList').textContent.includes('双语言') && document.getElementById('accountMembershipStackedList').textContent.includes('财务')", 15000, "stacked plans rendered");
  assert.equal(await evalJs("document.getElementById('accountHeaderRolePill').textContent.trim()"), "普通用户", "Paid VIP must remain普通用户 role, never管理员");
  assert.equal(await evalJs("document.getElementById('membershipExpiryNotice').classList.contains('hidden')"), true, "Lifetime member MUST NOT see expiry or renewal reminder banner");
  await cdp.send("Page.navigate", { url: `${BASE_URL}/recharge` }, sessionId);
  await waitFor("location.pathname === '/recharge' && document.querySelectorAll('#membershipRecommendedPlanList [data-plan]').length === 3", 15000, "vip recharge cards");
  await click('[data-card-family="single"] [data-card-variant="finance_monthly"]');
  await click("#membershipShowAllPlansBtn");
  await click('[data-card-family="bilingual"] [data-card-variant="japanese_lifetime"]');
  await waitFor("document.querySelectorAll('#membershipPlanList [data-owned=\"true\"]').length >= 2", 10000, "vip owned plan cards marked cleanly");

  // Near-expiry timed member MUST see top renewal announcement banner
  await click("#logoutBtn");
  await waitFor("location.pathname === '/login'", 15000, "logout to expiring user");
  await setField("#usernameInput", "p7_expiring");
  await setField("#secretInput", FREE_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "expiring login");
  await waitFor("!document.getElementById('membershipExpiryNotice').classList.contains('hidden')", 10000, "near-expiry top announcement shown");
  assert.ok((await evalJs("document.getElementById('membershipExpiryNotice').textContent")).includes("前往续订"));
  await shot("desktop-membership-expiry-banner.png");

  await click("#logoutBtn");
  await waitFor("location.pathname === '/login'", 15000, "logout to admin");
  await setField("#usernameInput", "wyj");
  await setField("#secretInput", ADMIN_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "admin login");
  await click("#v3Sidebar [data-v3-nav=account]");
  await waitFor("document.getElementById('accountHeaderRolePill').textContent.trim() === '站点所有者'", 10000, "super admin role badge");
  await click("#accountSubnav [data-account-tab='data']");
  assert.equal(await evalJs("Boolean(document.getElementById('openDeleteAccountBtn')?.closest('.danger-zone')?.classList.contains('hidden'))"), true, "Super admin danger zone hidden");
  pass("role_separation_vip_stacked_and_super_admin");

  // 5. Mobile Walkthrough (390x844 Screencast + Responsive Widths 320..2560 + Reduced Motion)
  await click("#logoutBtn");
  await waitFor("location.pathname === '/login'", 15000, "logout before mobile");
  await setField("#usernameInput", "p7_free");
  await setField("#secretInput", FREE_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "free re-login for mobile");

  const mobileFrames = [];
  activeRecording = { dir: framesMobileDir, frames: mobileFrames };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 }, sessionId);

  await cdp.send("Page.navigate", { url: `${BASE_URL}/account` }, sessionId);
  await waitFor("location.pathname === '/account' && !document.getElementById('accountModal').classList.contains('hidden')", 15000, "mobile account");
  await shot("mobile-account-overview-light.png");
  for (const tab of ["security", "membership", "data", "preferences", "sync"]) {
    await click(`#accountSubnav [data-account-tab="${tab}"]`);
    await new Promise((r) => setTimeout(r, 200));
    const ov = await evalJs("document.documentElement.scrollWidth > window.innerWidth + 1");
    assert.equal(ov, false, `Mobile 390px overflow on ${tab}`);
  }
  await click("#accountSubnav [data-account-tab='overview']");
  await cdp.send("Page.navigate", { url: `${BASE_URL}/recharge` }, sessionId);
  await waitFor("location.pathname === '/recharge' && !document.getElementById('membershipModal').classList.contains('hidden')", 15000, "mobile recharge");
  assert.equal(await evalJs("document.documentElement.scrollWidth > window.innerWidth + 1"), false, "Mobile 390px overflow on /recharge");
  await shot("mobile-membership-plans.png");
  await click("#membershipTabOrders");
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'orders'", 5000, "mobile orders view");
  await shot("mobile-membership-review.png");
  await click("#ordersBackToPlansBtn");
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'plans'", 5000, "mobile back to plans");
  await click('[data-card-family="all"] [data-card-variant="all_access_monthly"]');
  await click('[data-plan="all_access_monthly"] [data-plan-buy]');
  await waitFor("document.getElementById('membershipModal').dataset.membershipView === 'checkout'", 10000, "mobile checkout");
  assert.equal(await evalJs("document.documentElement.scrollWidth > window.innerWidth + 1"), false, "Mobile 390px overflow on checkout");
  await shot("mobile-membership-checkout.png");
  await click("#membershipBackToPlansBtn");

  await cdp.send("Page.stopScreencast", {}, sessionId);
  activeRecording = null;
  const mobileMp4 = path.join(OUT_DIR, "mobile-account-walkthrough.mp4");
  encodeFramesToMp4(mobileFrames, framesMobileDir, mobileMp4);
  report.videos.push("mobile-account-walkthrough.mp4");

  // Full responsive width sweep: 320, 375, 390, 768, 1440, 1920, 2560
  for (const [vw, vh, mob] of [[320, 640, true], [375, 812, true], [390, 844, true], [768, 1024, false], [1440, 900, false], [1920, 1080, false], [2560, 1440, false]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: mob }, sessionId);
    await cdp.send("Page.navigate", { url: `${BASE_URL}/recharge` }, sessionId);
    await waitFor("location.pathname === '/recharge' && !document.getElementById('membershipModal').classList.contains('hidden')", 20000, `recharge ${vw}`);
    await new Promise((r) => setTimeout(r, 150));
    const ovRecharge = await evalJs("document.documentElement.scrollWidth > window.innerWidth + 1");
    assert.equal(ovRecharge, false, `Horizontal overflow on /recharge at ${vw}x${vh}`);
    await cdp.send("Page.navigate", { url: `${BASE_URL}/account` }, sessionId);
    await waitFor("location.pathname === '/account' && !document.getElementById('accountModal').classList.contains('hidden')", 20000, `account ${vw}`);
    await new Promise((r) => setTimeout(r, 150));
    const ovAccount = await evalJs("document.documentElement.scrollWidth > window.innerWidth + 1");
    assert.equal(ovAccount, false, `Horizontal overflow on /account at ${vw}x${vh}`);
    report.viewports.push({ width: vw, height: vh, overflow: false });
  }

  // Reduced motion check
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
  await cdp.send("Page.navigate", { url: `${BASE_URL}/account` }, sessionId);
  await waitFor("location.pathname === '/account' && !document.getElementById('accountModal').classList.contains('hidden')", 15000, "account reduced motion");
  await click("#accountSubnav [data-account-tab='preferences']");
  const reducedMotionStatus = await evalJs("document.getElementById('accountReducedMotionStatus').textContent");
  assert.ok(reducedMotionStatus.includes("已启用减弱动效"), `Expected reduced motion status text, got ${reducedMotionStatus}`);
  const reducedMotionOk = await evalJs("parseFloat(getComputedStyle(document.querySelector('#accountSubnav .account-tab')).transitionDuration) <= 0.002");
  assert.equal(reducedMotionOk, true, "prefers-reduced-motion must clamp transition duration");
  pass("responsive_viewports_and_reduced_motion", { count: report.viewports.length });

  // 6. Own Password Change Flow -> session revoked -> old secret rejected -> new secret accepted
  await click("#accountSubnav [data-account-tab='security']");
  await setField("#currentSecretInput", FREE_SECRET);
  await setField("#newSecretInput", FREE_SECRET_NEW);
  await setField("#newSecretConfirmInput", FREE_SECRET_NEW);
  await click("#changeSecretForm button[type=submit]");
  await waitFor("location.pathname === '/login'", 15000, "password change revokes session");
  await setField("#usernameInput", "p7_free");
  await setField("#secretInput", FREE_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("document.getElementById('loginError').textContent.length > 0 && !document.getElementById('loginSubmitBtn').disabled", 10000, "old secret rejected");
  await setField("#secretInput", FREE_SECRET_NEW);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "new secret accepted");
  pass("password_change_revokes_all_sessions");

  assert.deepEqual(pageErrors, [], `Runtime page errors: ${JSON.stringify(pageErrors)}`);
  report.screenshots = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  report.status = "PASS";
  fs.writeFileSync(path.join(OUT_DIR, "verify-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS", checks: report.checks.length, videos: report.videos, screenshots: report.screenshots.length }));
} finally {
  if (cdp) cdp.close();
  if (chromeProc) killPidTree(chromeProc.pid);
  if (server) {
    try { await new Promise((r) => server.close(r)); } catch {}
  }
  if (mf) {
    try { await mf.dispose(); } catch {}
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
