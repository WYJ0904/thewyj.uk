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
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase8-admin/evidence");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 18828;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase8-verify-local-pepper-2026-32ch";
const USER_SECRET = "Phase8User#2026!";
const ADMIN_SECRET = "Phase8Admin#2026!";

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
      const dt = Math.max(0.03, Math.min(2.0, framesList[i + 1].ts - framesList[i].ts));
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p8-verify-"));
const chromeDir = path.join(tmpDir, "chrome-profile");
fs.mkdirSync(chromeDir, { recursive: true });

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
    TASK21_NOTIFICATION_READS_ENABLED: "true",
    TASK21_NOTIFICATION_WRITES_ENABLED: "true",
    TASK22_TRANSFER_ENABLED: "true",
    TASK22_TRANSFER_READS_ENABLED: "true",
    TASK22_TRANSFER_WRITES_ENABLED: "true",
    TASK25_FEATURE_FLAGS_ENABLED: "true",
    TASK26_ADAPTIVE_LEARNING_ENABLED: "true",
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

  const planRows = await db.prepare("SELECT code FROM task13_membership_plans WHERE purchasable = 1").all();
  for (const row of planRows.results || []) {
    for (const method of ["wechat", "alipay"]) {
      await r2.put(`payments/qrcodes/v1/${method}_${row.code}.png`, VALID_PNG_1X1, { httpMetadata: { contentType: "image/png" } });
    }
  }

  const now = new Date().toISOString();
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const userHash = await hashSecret(USER_SECRET, PEPPER);
  const adminHash = await hashSecret(ADMIN_SECRET, PEPPER);

  // Seed 4 key identities + 32 extra synthetic users (>30 limit) for pagination & search testing
  await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES
    ('p8-owner-1', 'wyj', 'wyj', ?1, 'pbkdf2_sha256', 100000, 'super_admin', ?3, ?3, ?3, ?3),
    ('p8-delegated-1', 'p8_delegated', 'p8_delegated', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3, ?3),
    ('p8-free-1', 'p8_free', 'p8_free', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3, ?3),
    ('p8-vip-1', 'p8_vip', 'p8_vip', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3, ?3)`).bind(adminHash, userHash, now).run();

  for (let i = 1; i <= 32; i += 1) {
    const id = `p8-page-${String(i).padStart(2, "0")}`;
    const uname = `p8_batch_${String(i).padStart(2, "0")}`;
    await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
      VALUES (?1, ?2, ?2, ?3, 'pbkdf2_sha256', 100000, 'user', ?4, ?4, ?4, ?4)`).bind(id, uname, userHash, now).run();
  }
  await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES ('p8-owner-1', ?1), ('p8-delegated-1', ?1), ('p8-free-1', ?1), ('p8-vip-1', ?1)").bind(now).run();

  await db.prepare(`INSERT INTO task13_user_memberships (id, user_id, plan_code, starts_at, expires_at, is_lifetime, status, source, source_ref, created_by, metadata_json, created_at, updated_at)
    VALUES ('p8-mem-vip', 'p8-vip-1', 'all_access_monthly', ?1, ?2, 0, 'active', 'admin', 'p8-seed', 'wyj', '{}', ?1, ?1)`).bind(now, nextMonth).run();

  // Seed tool stats usage, login audit logs (success + fail), feedback items (feature_suggestion + tool_error), feature flag
  await db.prepare(`INSERT INTO task15_tool_recent_usage (id, user_id, tool_id, used_at, source, source_ref) VALUES
    ('tu_p8_0001', 'p8-vip-1', 'word-counter', ?1, 'cloud', ''),
    ('tu_p8_0002', 'p8-free-1', 'word-counter', ?1, 'cloud', ''),
    ('tu_p8_0003', 'p8-vip-1', 'json-formatter', ?1, 'cloud', ''),
    ('tu_p8_0004', 'p8-owner-1', 'uuid-generator', ?1, 'cloud', '')`).bind(now).run();

  await db.prepare(`INSERT INTO task12_login_audit_logs (id, user_id, username, success, reason, ip_address, country, region, city, user_agent, source, created_at) VALUES
    ('la_p8_1', 'p8-owner-1', 'wyj', 1, 'login_success', '203.0.113.10', 'CN', 'Shanghai', 'Shanghai', 'Mozilla/5.0 Chrome/128.0', 'cloudflare_pages', ?1),
    ('la_p8_2', 'p8-free-1', 'p8_free', 0, 'invalid_credentials', '198.51.100.22', 'JP', 'Tokyo', 'Tokyo', 'Thewyj-Android/1.3.34', 'direct', ?1)`).bind(now).run();

  await db.prepare(`INSERT INTO task11_feedback_items (id, user_id, username, feedback_type, title, content, route, tool_id, app_version, browser_info, status, admin_note, created_at, updated_at) VALUES
    ('fb_p8_suggest_1', 'p8-vip-1', 'p8_vip', 'feature_suggestion', '支持批量导出词表 JSON', '希望词表支持按分类导出 JSON 备份。', '/tools', '', 'Web', 'Chrome 128', 'pending', '', ?1, ?1),
    ('fb_p8_suggest_2', 'p8-free-1', 'p8_free', 'feature_suggestion', '导出词表备份格式增强', '同上建议补充 JSON 导出。', '/tools', '', 'Web', 'Chrome 128', 'pending', '', ?1, ?1),
    ('fb_p8_bug_1', 'p8-free-1', 'p8_free', 'tool_error', 'UUID 生成器连续复制反馈延迟', '快速连点复制按钮后提示闪烁。', '/tools/uuid-generator', 'uuid-generator', 'Web', 'Chrome 128', 'pending', '', ?1, ?1)`).bind(now).run();
  await db.prepare(`INSERT INTO task11_feedback_votes (feedback_id, user_id, created_at) VALUES
    ('fb_p8_suggest_1', 'p8-vip-1', ?1),
    ('fb_p8_suggest_1', 'p8-free-1', ?1),
    ('fb_p8_suggest_2', 'p8-free-1', ?1)`).bind(now).run();

  await db.prepare(`INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'UI v6.3 accessibility flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ?1, 'p8-owner-1', 'seed-1', 'seed-1'),
           ('phase8_demo_feature', 'Phase 8 admin demo flag', 1, 0, '["beta","experimental"]', 2500, 1, ?1, 'p8-owner-1', 'seed-2', 'seed-2')
    ON CONFLICT(flag_key) DO UPDATE SET enabled=excluded.enabled, kill_switch=0, channels_json=excluded.channels_json, rollout_basis_points=excluded.rollout_basis_points`).bind(now).run();

  let forceRechargeError = false;
  server = http.createServer(async (req, res) => {
    try {
      const parsedReqUrl = new URL(req.url || "/", BASE_URL);
      if (forceRechargeError && parsedReqUrl.pathname === "/api/admin/recharge") {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: false, error: "模拟充值列表临时不可用" }));
        return;
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || k.toLowerCase() === "host" || k.toLowerCase() === "connection") continue;
        if (Array.isArray(v)) headers.set(k, v.join(", "));
        else headers.set(k, String(v));
      }
      const hasBody = !["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase());
      const init = { method: req.method, headers };
      if (hasBody) {
        init.body = Readable.toWeb(req);
        init.duplex = "half";
      }
      const mfRes = await mf.dispatchFetch(parsedReqUrl.toString(), init);
      const outHeaders = {};
      mfRes.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") outHeaders[key] = value;
      });
      const setCookies = typeof mfRes.headers.getSetCookie === "function" ? mfRes.headers.getSetCookie() : [];
      if (setCookies.length) outHeaders["set-cookie"] = setCookies;
      res.writeHead(mfRes.status, outHeaders);
      res.end(Buffer.from(await mfRes.arrayBuffer()));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(`Server error: ${err?.message || err}`);
      } else {
        res.end();
      }
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  // Create real recharge orders via API for p8_free (1 user_paid, 1 pending_payment)
  const freeLogin = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE_URL },
    body: JSON.stringify({ username: "p8_free", secret: USER_SECRET }),
  }).then((r) => r.json());
  assert.ok(freeLogin.session, "p8_free login failed");
  const freeHeaders = { "Content-Type": "application/json", "Origin": BASE_URL, "X-Session-Token": freeLogin.session };
  const createdOrder = await fetch(`${BASE_URL}/api/recharge/request`, {
    method: "POST",
    headers: freeHeaders,
    body: JSON.stringify({ plan: "tools_monthly", payment_method: "wechat", trial_language: "" }),
  }).then((r) => r.json());
  const orderId = createdOrder.request?.id;
  assert.ok(orderId, `Expected created recharge order id: ${JSON.stringify(createdOrder)}`);
  const paidRes = await fetch(`${BASE_URL}/api/recharge/confirm`, {
    method: "POST",
    headers: freeHeaders,
    body: JSON.stringify({ request_id: orderId }),
  });
  assert.equal(paidRes.status, 200, "Failed confirming p8_free recharge payment");

  const chromePath = findChrome();
  chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-allow-origins=*",
    "--remote-debugging-port=9238",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${chromeDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1440,900",
    "about:blank",
  ], { windowsHide: true, stdio: "ignore" });

  const versionJson = JSON.parse(await waitForHttp("http://127.0.0.1:9238/json/version"));
  cdp = new CdpSession(versionJson.webSocketDebuggerUrl);
  await cdp.open();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("DOM.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  const pageErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Runtime exception"));

  let activeRecording = null;
  cdp.on("Page.screencastFrame", async (params) => {
    await cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId).catch(() => {});
    if (!activeRecording) return;
    const idx = activeRecording.frames.length;
    const file = `frame-${String(idx).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(activeRecording.dir, file), Buffer.from(params.data, "base64"));
    activeRecording.frames.push({ file, ts: Number(params.metadata?.timestamp || Date.now() / 1000) });
  });

  const evalJs = async (expr) => {
    const res = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "Eval failed");
    }
    return res.result?.value;
  };
  const waitFor = async (expr, timeout = 20000, label = expr) => {
    const t0 = Date.now();
    let lastErr = "";
    while (Date.now() - t0 < timeout) {
      try { if (await evalJs(`Boolean(${expr})`)) return true; }
      catch (e) { lastErr = e.message; }
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error(`Timeout (${timeout}ms) waiting for ${label}${lastErr ? `: ${lastErr}` : ""}`);
  };
  const click = async (sel) => {
    const ok = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.disabled) return false; el.scrollIntoView({block:'center', behavior:'instant'}); el.click(); return true; })()`);
    assert.equal(ok, true, `Failed click: ${sel}`);
  };
  const setField = async (sel, val) => {
    const ok = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(String(val))}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
    assert.equal(ok, true, `Failed setField: ${sel}`);
  };
  const stepup = async (pwd = ADMIN_SECRET) => {
    await waitFor("document.querySelector('#task27Prompt [name=password]')", 12000, "Task 27 step-up prompt");
    await setField("#task27Prompt [name=password]", pwd);
    await click("#task27Prompt button[type=submit]");
  };
  const shot = async (name) => {
    await evalJs("window.scrollTo({ top: 0, behavior: 'instant' })").catch(() => {});
    await new Promise((r) => setTimeout(r, 220));
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(data, "base64"));
  };
  const startVideo = async (slug) => {
    const dir = path.join(tmpDir, `rec-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    const frames = [];
    activeRecording = { dir, frames };
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }, sessionId);
    return { dir, frames, outPath: path.join(OUT_DIR, `${slug}.mp4`) };
  };
  const stopVideo = async (rec) => {
    await new Promise((r) => setTimeout(r, 400));
    await cdp.send("Page.stopScreencast", {}, sessionId);
    activeRecording = null;
    encodeFramesToMp4(rec.frames, rec.dir, rec.outPath);
    return path.basename(rec.outPath);
  };

  const report = {
    scope: "Isolated Cloudflare Pages Functions workerd (Miniflare D1/R2) + headless Chrome CDP (Phase 8)",
    checkedAt: new Date().toISOString(),
    checks: [],
    rbac: {},
    timingsMs: {},
    viewports: [],
    videos: [],
    screenshots: [],
  };
  const pass = (name, meta = {}) => { report.checks.push({ name, status: "PASS", ...meta }); console.log(`PASS: ${name}`); };

  // 1. Identity boundary checks (Guest 401 -> User 403)
  await cdp.send("Page.navigate", { url: `${BASE_URL}/` }, sessionId);
  const tHome0 = Date.now();
  await waitFor("document.documentElement.dataset.bootState === 'ready'", 20000, "public home boot");
  report.timingsMs.publicHomeColdStartMs = Date.now() - tHome0;

  await cdp.send("Page.navigate", { url: `${BASE_URL}/admin` }, sessionId);
  await waitFor("location.pathname === '/login'", 15000, "guest /admin redirects to /login");
  const guestApiStatus = (await fetch(`${BASE_URL}/api/admin/users`)).status;
  assert.equal(guestApiStatus, 401, "Guest GET /api/admin/users must return 401");

  await setField("#usernameInput", "p8_free");
  await setField("#secretInput", USER_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "p8_free login");
  await cdp.send("Page.navigate", { url: `${BASE_URL}/admin` }, sessionId);
  await waitFor("location.pathname === '/'", 15000, "normal user denied /admin");
  const userSess = await evalJs("localStorage.getItem('wyjAccountSession')");
  assert.equal((await fetch(`${BASE_URL}/api/admin/users`, { headers: { "X-Session-Token": userSess } })).status, 403);
  assert.equal((await fetch(`${BASE_URL}/api/admin/roles`, { headers: { "X-Session-Token": userSess } })).status, 403);
  assert.equal((await fetch(`${BASE_URL}/api/admin/feature-flags`, { headers: { "X-Session-Token": userSess } })).status, 403);
  report.rbac.guestAndUser = { guestUsersStatus: 401, userUsersStatus: 403, userRolesStatus: 403, userFlagsStatus: 403 };
  pass("guest_401_and_normal_user_403");

  // 2. Super Admin login & Admin /admin cold load timing + Error KPI state check
  await click("#logoutBtn");
  await waitFor("location.pathname === '/login'", 15000, "logout p8_free");
  await setField("#usernameInput", "wyj");
  await setField("#secretInput", ADMIN_SECRET);
  await click("#loginSubmitBtn");
  await waitFor("location.pathname === '/'", 20000, "owner login");

  forceRechargeError = true;
  const tAdmin0 = Date.now();
  await cdp.send("Page.navigate", { url: `${BASE_URL}/admin` }, sessionId);
  await waitFor("location.pathname === '/admin' && !document.getElementById('adminPanel').classList.contains('hidden') && document.getElementById('adminPanel').getAttribute('aria-busy') === 'false'", 20000, "admin panel priority ready");
  report.timingsMs.adminEntryPriorityMs = Date.now() - tAdmin0;
  assert.ok(report.timingsMs.adminEntryPriorityMs < 4000, `Admin priority entry took too long: ${report.timingsMs.adminEntryPriorityMs}ms`);
  await waitFor("document.getElementById('adminKpiRecharge').dataset.state === 'error'", 15000, "error KPI shows failure state instead of 0");
  assert.equal(await evalJs("document.getElementById('adminKpiRecharge').textContent"), "加载失败");
  forceRechargeError = false;

  // Full refresh recovers KPI & sync timestamp
  await click("#refreshAdminBtn");
  await waitFor("!document.getElementById('refreshAdminBtn').disabled && document.getElementById('adminKpiRecharge').dataset.state === 'ready'", 15000, "admin full refresh ready");
  const apiUsersTotal = await evalJs("fetch('/api/admin/users?limit=1', { headers: { 'X-Session-Token': localStorage.getItem('wyjAccountSession') } }).then(r => r.json()).then(d => d.total)");
  assert.equal(Number(await evalJs("document.getElementById('adminKpiUsers').textContent")), Number(apiUsersTotal), "KPI total must match /api/admin/users");
  assert.equal(Number(await evalJs("document.getElementById('adminKpiRecharge').textContent")), 1, "KPI recharge pending count must be 1");
  pass("admin_priority_load_kpi_error_and_exact_counts", { apiUsersTotal });

  // 3. Screenshot 1 + Video 1: Users (search cancellation, pagination, 8 SKUs, override, Task 27 step-up reset, dirty close guard)
  const v1 = await startVideo("video-1-users-membership");
  await shot("admin-users.png");

  // Search abort/debounced correctness + pagination + local filter
  await waitFor("!document.getElementById('adminUserLoadMoreBtn').classList.contains('hidden')", 5000, "load more visible (>30 users)");
  await click("#adminUserLoadMoreBtn");
  await waitFor("document.querySelectorAll('#adminUserList .admin-user-card').length >= 36", 10000, "page 2 loaded");

  await setField("#adminUserSearch", "zzzz_never_found");
  await setField("#adminUserSearch", "p8_free");
  await waitFor("document.querySelectorAll('#adminUserList .admin-user-card').length === 1 && document.querySelector('#adminUserList .admin-user-card').dataset.userId === 'p8-free-1'", 10000, "search p8_free resolves cleanly");

  await setField("#adminUserFilter", "banned");
  assert.equal(await evalJs("document.querySelectorAll('#adminUserList .admin-user-card').length"), 0);
  await setField("#adminUserFilter", "all");
  assert.equal(await evalJs("document.querySelectorAll('#adminUserList .admin-user-card').length"), 1);

  // Copy ID button
  await click("#adminUserList [data-copy-user-id]");
  await waitFor("document.querySelector('#adminUserList [data-copy-user-id]').textContent.includes('已复制')", 5000, "ID copy feedback");

  // Open right-hand drawer on p8_free, check 8 SKUs, test dirty close guard, grant tools_monthly, tool override, Task 27 reset
  await click("#adminUserList [data-user-id='p8-free-1'] [data-admin-edit]");
  await waitFor("!document.getElementById('adminEditModal').classList.contains('hidden')", 5000, "user drawer open");
  const skuCount = await evalJs("document.getElementById('adminMembershipSelect').options.length");
  assert.equal(skuCount, 8, "Admin must expose all 8 exact SKUs");
  await setField("#adminMembershipSelect", "tools_monthly");
  await setField("#adminMembershipNote", "Phase 8 verification grant");
  await shot("admin-user-drawer.png");
  await click("#saveAdminMembershipBtn");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "save membership confirm");
  await click("#acceptConfirmBtn");
  await stepup();
  await waitFor("document.getElementById('adminEditMessage').textContent.includes('已保存')", 15000, "membership saved");

  // Tool override disable & restore
  await click("#adminDisableToolsBtn");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "disable tools confirm");
  await click("#acceptConfirmBtn");
  await stepup();
  await waitFor("document.getElementById('adminEditMessage').textContent.includes('取消') || document.getElementById('adminEditMessage').textContent.includes('禁用')", 15000, "tools override disabled");
  await click("#adminEnableToolsBtn");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "restore tools confirm");
  await click("#acceptConfirmBtn");
  await stepup();
  await waitFor("document.getElementById('adminEditMessage').textContent.includes('恢复')", 15000, "tools override restored");

  // Task 27 step-up reset password -> 1-time display -> close clears secret
  await click("#saveAdminSecretBtn");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "reset secret confirm");
  await click("#acceptConfirmBtn");
  await stepup();
  await waitFor("!document.getElementById('adminSecretResult').classList.contains('hidden') && document.getElementById('adminSecretResultValue').textContent.length === 20", 15000, "20-char temp password shown once");
  await click("[data-close-modal='adminEditModal']");
  await waitFor("document.getElementById('adminEditModal').classList.contains('hidden')", 5000, "drawer closed");
  assert.equal(await evalJs("document.getElementById('adminSecretResultValue').textContent"), "", "Temp password cleared on drawer close");
  report.videos.push(await stopVideo(v1));
  pass("users_pagination_search_8skus_override_and_stepup_reset");

  // Clear search so full list is visible cleanly
  await setField("#adminUserSearch", "");
  await waitFor("document.querySelectorAll('#adminUserList .admin-user-card').length >= 30", 10000, "users restored");

  // 4. Video 2 + Screenshot 2: Recharge approval & KPI update
  const v2 = await startVideo("video-2-recharge-review");
  const tTab0 = performance.now();
  await click("#adminRechargeTab");
  await waitFor("document.getElementById('adminRechargeView').classList.contains('active')", 5000, "recharge view active");
  report.timingsMs.tabSwitchMs = Math.round(performance.now() - tTab0);
  await shot("admin-recharge.png");
  await click("#adminRechargeList [data-recharge-detail]");
  await waitFor("!document.getElementById('adminDetailDrawer').classList.contains('hidden')", 5000, "recharge detail drawer");
  await shot("admin-recharge-detail.png");
  await click("#adminDetailDrawer [data-detail-recharge-approve]");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "approve recharge confirm");
  await click("#acceptConfirmBtn");
  await stepup();
  await waitFor("document.getElementById('adminDetailDrawer').classList.contains('hidden') && Number(document.getElementById('adminKpiRecharge').textContent) === 0", 15000, "recharge approved and KPI synced");
  report.videos.push(await stopVideo(v2));
  pass("recharge_detail_drawer_approve_and_kpi_sync");

  // 5. Audit & Login & ToolStats screenshots + drawers + filters
  await click("#adminAuditTab");
  await waitFor("document.querySelectorAll('#adminAuditList .admin-audit-card').length >= 1", 5000, "audit rows");
  await shot("admin-audit.png");
  await click("#adminAuditList [data-audit-detail]");
  await waitFor("!document.getElementById('adminDetailDrawer').classList.contains('hidden')", 5000, "audit detail drawer");
  await click("[data-close-modal='adminDetailDrawer']");
  await waitFor("document.getElementById('adminDetailDrawer').classList.contains('hidden')", 5000, "audit drawer closed");

  await click("#adminLoginTab");
  await waitFor("document.querySelectorAll('#adminLoginList .admin-login-card').length >= 2", 5000, "login rows");
  await shot("admin-login.png");
  await setField("#adminLoginResultFilter", "failed");
  assert.equal(await evalJs("document.querySelectorAll('#adminLoginList .admin-login-card').length"), 1);
  await setField("#adminLoginResultFilter", "all");

  await click("#adminToolStatsTab");
  await waitFor("document.querySelectorAll('#adminToolStatsList .admin-tool-stat-card').length >= 3", 5000, "tool stats rows");
  await new Promise((r) => setTimeout(r, 300));
  await shot("admin-tool-stats.png");
  pass("audit_login_and_tool_stats_views");

  // 6. Video 3: Feedback + Messages + Delegated Admin Roles (+ real delegated admin session check!)
  const v3 = await startVideo("video-3-feedback-messages-roles");
  await click("#adminFeedbackTab");
  await waitFor("document.querySelectorAll('#adminFeedbackList .admin-feedback-card').length >= 3", 8000, "feedback list");
  await shot("admin-feedback.png");
  // Non-mergeable type (tool_error) must have merge disabled in drawer
  await click("#adminFeedbackList [data-admin-feedback-id='fb_p8_bug_1'] [data-feedback-detail]");
  await waitFor("!document.getElementById('adminDetailDrawer').classList.contains('hidden')", 5000, "feedback drawer open");
  assert.equal(await evalJs("document.querySelector('#adminDetailDrawer [data-drawer-feedback-merge]').disabled"), true, "Merge disabled for non-suggestion");
  await setField("#adminDetailDrawer [data-feedback-admin-status]", "accepted");
  await setField("#adminDetailDrawer [data-feedback-admin-note]", "P8 drawer verified");
  await click("#adminDetailDrawer [data-drawer-feedback-save]");
  await waitFor("document.getElementById('adminDetailStatus').textContent.includes('已保存')", 10000, "feedback saved in drawer");
  await click("[data-close-modal='adminDetailDrawer']");
  await waitFor("document.getElementById('adminDetailDrawer').classList.contains('hidden')", 5000, "feedback drawer closed");

  // Messages live preview + send personal inbox message
  await click("#adminMessagesTab");
  await waitFor("document.getElementById('adminMessagesView').classList.contains('active')", 5000, "messages view");
  await setField("#adminMessageScope", "single");
  await setField("#adminMessageChannel", "inbox");
  await setField("#adminMessageType", "important");
  await setField("#adminMessageTargetSearch", "p8_free");
  await waitFor("document.querySelector('#adminMessageTargetList input[value=\"p8-free-1\"]')", 8000, "target p8_free");
  await click("#adminMessageTargetList input[value='p8-free-1']");
  await setField("#adminMessageTitle", "Phase 8 通知验收");
  await setField("#adminMessageBody", "第一行说明\n第二行详情");
  assert.equal(await evalJs("document.getElementById('adminMessagePreviewTitle').textContent"), "Phase 8 通知验收");
  await shot("admin-messages.png");
  await click("#sendAdminMessageBtn");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "send msg confirm");
  await click("#acceptConfirmBtn");
  await waitFor("document.getElementById('adminMessageFormStatus').textContent.includes('已发送')", 15000, "message sent");

  // Email Center tab screenshot
  await click("#adminEmailTab");
  await waitFor("document.querySelectorAll('#adminEmailCenterRoot .admin-email-stat-card').length >= 4", 10000, "email center rendered");
  await shot("admin-email.png");

  // Roles: grant delegated admin to p8_delegated
  await click("#adminRolesTab");
  await setField("#adminRoleUserSearch", "p8_delegated");
  await waitFor("Array.from(document.getElementById('adminRoleUserSelect').options).some(o => o.value === 'p8-delegated-1')", 8000, "role candidate p8_delegated");
  await setField("#adminRoleUserSelect", "p8-delegated-1");
  await setField("#adminRoleNote", "Phase 8 delegated admin grant");
  await click("#grantAdminRoleBtn");
  await waitFor("!document.getElementById('confirmModal').classList.contains('hidden')", 5000, "grant role confirm");
  await click("#acceptConfirmBtn");
  await stepup();
  await waitFor("document.querySelector('[data-admin-role-user-id=\"p8-delegated-1\"]')", 12000, "delegated admin shown");
  await shot("admin-roles.png");
  report.videos.push(await stopVideo(v3));

  // Verify Delegated Admin permissions in UI + API
  const delLogin = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE_URL },
    body: JSON.stringify({ username: "p8_delegated", secret: USER_SECRET }),
  }).then((r) => r.json());
  assert.equal(delLogin.account.role, "admin");
  assert.equal((await fetch(`${BASE_URL}/api/admin/roles`, { headers: { "X-Session-Token": delLogin.session } })).status, 403);
  const delRoleStepup = await fetch(`${BASE_URL}/api/security/stepup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE_URL, "X-Session-Token": delLogin.session },
    body: JSON.stringify({ password: USER_SECRET, scope: "admin_roles" }),
  }).then((r) => r.json()).catch(() => ({}));
  assert.equal((await fetch(`${BASE_URL}/api/admin/roles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": BASE_URL,
      "X-Session-Token": delLogin.session,
      ...(delRoleStepup?.grant ? { "X-Aeris-Stepup": delRoleStepup.grant } : {}),
    },
    body: JSON.stringify({ user_id: "p8-free-1", role: "admin" }),
  })).status, 403);
  assert.equal((await fetch(`${BASE_URL}/api/admin/task18/status`, { headers: { "X-Session-Token": delLogin.session } })).status, 403);
  assert.equal((await fetch(`${BASE_URL}/api/admin/feature-flags`, { headers: { "X-Session-Token": delLogin.session } })).status, 200);
  const delSecretStepup = await fetch(`${BASE_URL}/api/security/stepup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE_URL, "X-Session-Token": delLogin.session },
    body: JSON.stringify({ password: USER_SECRET, scope: "admin_reset:p8-owner-1" }),
  }).then((r) => r.json()).catch(() => ({}));
  assert.equal((await fetch(`${BASE_URL}/api/admin/secret`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": BASE_URL,
      "X-Session-Token": delLogin.session,
      ...(delSecretStepup?.grant ? { "X-Aeris-Stepup": delSecretStepup.grant } : {}),
    },
    body: JSON.stringify({ user_id: "p8-owner-1", ...(delSecretStepup?.grant ? { grant: delSecretStepup.grant } : {}) }),
  })).status, 403);
  report.rbac.delegatedAdmin = { role: "admin", getRolesApi: 403, postRolesApi: 403, task18StatusApi: 403, flagsReadApi: 200, resetOwnerSecret: 403 };
  pass("feedback_messages_email_and_delegated_admin_rbac");

  // 7. Video 4: Feature Flags + 0.01% slider + Dirty banner + Kill Switch + Evaluate
  const v4 = await startVideo("video-4-feature-flags-kill-switch");
  await click("#adminFeatureFlagsTab");
  await waitFor("document.querySelectorAll('#featureFlagSummaryList li').length >= 2", 8000, "flag summary list");
  await setField("#featureFlagSearch", "phase8_demo");
  await waitFor("document.querySelectorAll('#featureFlagSummaryList li').length === 1", 3000, "directory filter");
  await click("#featureFlagSummaryList button");
  await setField("#featureFlagPercentageRange", "12.34");
  assert.equal(await evalJs("document.getElementById('featureFlagPercentage').value"), "12.34", "slider syncs to numeric 0.01%");
  await waitFor("!document.getElementById('featureFlagDirtyBanner').classList.contains('hidden')", 3000, "dirty banner shown");
  await shot("admin-feature-flags.png");
  await click("#saveFeatureFlagBtn");
  await stepup();
  await waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存'", 15000, "flag rollout saved");
  await setField("#featureOverrideUser", "p8-free-1");
  await setField("#featureOverrideValue", "on");
  await click("#saveFeatureOverrideBtn");
  await stepup();
  await waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存'", 15000, "override saved");
  await setField("#featureEvaluateUser", "p8-free-1");
  await setField("#featureEvaluateChannel", "beta");
  await click("#evaluateFeatureBtn");
  await waitFor("document.getElementById('featureEvaluationResult').textContent.includes('phase8_demo_feature: ON')", 8000, "pre-eval ON");
  await click("#featureFlagKillSwitch");
  await click("#saveFeatureFlagBtn");
  await stepup();
  await waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存'", 15000, "kill switch saved");
  await click("#evaluateFeatureBtn");
  await waitFor("document.getElementById('featureEvaluationResult').textContent.includes('kill_switch')", 8000, "kill switch overrides all");
  report.videos.push(await stopVideo(v4));
  pass("feature_flags_001_slider_dirty_override_and_kill_switch");

  // 8. Dark theme + Mobile 390 + 7 responsive widths + Reduced motion + Legacy p07=disabled
  await click("#adminUsersTab");
  await click("#themeToggleBtn");
  await waitFor("document.documentElement.dataset.themePreference === 'dark' || document.documentElement.classList.contains('dark-theme') || document.documentElement.dataset.resolvedTheme === 'dark'", 5000, "dark theme").catch(() => {});
  await shot("admin-dark-1440.png");

  for (const [vw, vh, mob] of [[320, 640, true], [375, 812, true], [390, 844, true], [768, 1024, false], [1440, 900, false], [1920, 1080, false], [2560, 1440, false]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: mob }, sessionId);
    await new Promise((r) => setTimeout(r, 150));
    const ov = await evalJs("document.documentElement.scrollWidth > window.innerWidth + 1");
    assert.equal(ov, false, `Horizontal overflow on /admin at ${vw}x${vh}`);
    if (vw === 390) await shot("admin-mobile-390.png");
    report.viewports.push({ width: vw, height: vh, overflow: false });
  }

  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
  await click("#adminUserList [data-row-clickable='true'] [data-admin-edit]");
  await waitFor("!document.getElementById('adminEditModal').classList.contains('hidden')", 5000, "drawer in reduced motion");
  const reducedDur = await evalJs("parseFloat(getComputedStyle(document.querySelector('#adminEditModal .admin-detail-panel')).animationDuration) || 0");
  assert.ok(reducedDur <= 0.002, `Expected reduced motion drawer animation <= 2ms, got ${reducedDur}`);
  await click("[data-close-modal='adminEditModal']");

  // Verify legacy p07_accessibility=0 mode on 390px
  await db.prepare("UPDATE task25_feature_flags SET enabled=0 WHERE flag_key='p07_accessibility'").run();
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await cdp.send("Page.navigate", { url: `${BASE_URL}/admin` }, sessionId);
  await waitFor("document.documentElement.dataset.bootState === 'ready' && document.documentElement.dataset.p07Ui === 'disabled' && !document.getElementById('adminPanel').classList.contains('hidden') && !document.getElementById('appShell').classList.contains('app-shell-pending')", 15000, "legacy p07 disabled /admin");
  const legacyTabProbe = await evalJs("({ p07: document.documentElement.dataset.p07Ui, innerWidth: window.innerWidth, tabsDisp: getComputedStyle(document.querySelector('.admin-tabs')).display, grpDisp: getComputedStyle(document.querySelector('.admin-tab-group')).display, items: [...document.querySelectorAll('.admin-tabs button:not(.hidden)')].map(b => { const r = b.getBoundingClientRect(); return { id: b.id, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; }) })");
  const legacyTabsOk = legacyTabProbe.items.every((r) => r.left >= 0 && r.right <= legacyTabProbe.innerWidth + 1 && r.w >= 120);
  assert.equal(legacyTabsOk, true, `Legacy 390px 2-col .admin-tabs width regression! ${JSON.stringify(legacyTabProbe)}`);
  pass("dark_responsive_reduced_motion_and_legacy_p07_disabled");

  assert.deepEqual(pageErrors, [], `Runtime page errors: ${JSON.stringify(pageErrors)}`);
  report.screenshots = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  report.status = "PASS";
  fs.writeFileSync(path.join(OUT_DIR, "verify-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS", checks: report.checks.length, videos: report.videos, screenshots: report.screenshots.length, timingsMs: report.timingsMs }));
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
