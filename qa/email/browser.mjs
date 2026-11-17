import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { cloudMiddleware, statusRouteResponse } from "../../functions/_lib/cloudflare-foundation.mjs";
import { upsertUserEmailBinding } from "../../functions/_lib/email-service.mjs";
import { handleInboundSupportEmail } from "../../functions/_lib/email-inbound.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { onRequest as dispatchApi } from "../../functions/api/[[path]].js";

const REPO_ROOT = process.cwd();
const TEST_PEPPER = "BrowserTestPepper12345678901234567890!";
const OWNER_PASSWORD = "OwnerBrowserPass-2026!";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowserBinary() {
  const candidates = [
    process.env.WYJ_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error("No headless Chrome/Edge browser binary found on Windows");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timeout")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP socket error")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result || {});
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
  }

  send(method, params = {}, sessionId = "") {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function applyMigrations(db) {
  const migrationsDir = path.join(REPO_ROOT, "cloudflare", "migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const rawSql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.exec(rawSql.replace(/\r?\n/g, " "));
  }
}

async function seedUser(db, { id, username, role = "user", password = "UserPass-2026!" }) {
  const now = new Date().toISOString();
  const hashed = await hashSecret(password, TEST_PEPPER);
  const parts = hashed.split("$");
  await db
    .prepare(
      `INSERT INTO task12_users (
        id, username, username_normalized, password_hash, password_scheme, password_iterations,
        role, banned, permanent_ban, ban_reason, deleted, session_version,
        registered_at, last_login_at, created_at, updated_at, source_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '', 0, 1, ?, '', ?, ?, ?)`
    )
    .bind(id, username, username.toLowerCase(), hashed, "pbkdf2_sha256", Number(parts[1]), role, now, now, now, now)
    .run();
}

async function main() {
  const tmpDbDir = await mkdtemp(path.join(os.tmpdir(), "aeris-email-qa-db-"));
  const tmpBrowserDir = await mkdtemp(path.join(os.tmpdir(), "aeris-email-qa-cdp-"));

  let restMode = "delivered";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    if (urlStr.startsWith("https://api.cloudflare.com/client/v4/")) {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      const rcpt = payload?.to?.[0] || "user@thewyj.uk";
      if (restMode === "http_503") {
        return new Response(JSON.stringify({ success: false, errors: [{ code: 5003, message: "Upstream busy" }] }), { status: 503 });
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: { message_id: `<qa-${Date.now()}@thewyj.uk>`, delivered: [rcpt], queued: [], permanent_bounces: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, init);
  };

  const mf = new Miniflare({
    modules: true,
    script: "export default { async fetch() { return new Response('ok'); } }",
    d1Databases: { WYJ_DB: "wyj-qa-db" },
    d1Persist: tmpDbDir,
  });

  let server = null;
  let browserProc = null;
  let cdp = null;

  try {
    const db = await mf.getD1Database("WYJ_DB");
    await applyMigrations(db);

    const ADMIN_PASSWORD = "OpsAdminBrowserPass-2026!";
    await seedUser(db, { id: "u_qa_super", username: "wyj", role: "super_admin", password: OWNER_PASSWORD });
    await seedUser(db, { id: "u_qa_admin", username: "qa_ops", role: "user", password: ADMIN_PASSWORD });
    await db
      .prepare(
        `INSERT INTO task18_admin_roles (user_id, role, granted_by_user_id, granted_by_username, granted_at, updated_at)
         VALUES ('u_qa_admin', 'admin', 'u_qa_super', 'wyj', ?, ?)`
      )
      .bind(new Date().toISOString(), new Date().toISOString())
      .run();
    await seedUser(db, { id: "u_qa_alice", username: "qa_alice", role: "user" });
    await seedUser(db, { id: "u_qa_unv", username: "qa_carol", role: "user" });

    await upsertUserEmailBinding(db, { userId: "u_qa_super", email: "owner-test@thewyj.uk", verified: true, actorUserId: "u_qa_super" });
    await upsertUserEmailBinding(db, { userId: "u_qa_alice", email: "alice-qa@thewyj.uk", verified: true, actorUserId: "u_qa_super" });
    await upsertUserEmailBinding(db, { userId: "u_qa_unv", email: "carol-qa@thewyj.uk", verified: false, actorUserId: "u_qa_super" });

    const apiErrors = [];
    const env = {
      WYJ_DB: db,
      WYJ_TASK12_PASSWORD_PEPPER: TEST_PEPPER,
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
      TASK14_CLOUD_READS_ENABLED: "true",
      TASK14_CLOUD_WRITES_ENABLED: "true",
      TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
      TASK15_CLOUD_ONLY_ENABLED: "true",
      TASK18_ADMIN_MESSAGES_ENABLED: "true",
      TASK20_ANDROID_APP_ENABLED: "true",
      TASK22_TRANSFER_READS_ENABLED: "true",
      TASK22_TRANSFER_WRITES_ENABLED: "true",
      TASK25_FEATURE_FLAGS_ENABLED: "true",
      TASK26_ADAPTIVE_LEARNING_ENABLED: "true",
      CLOUD_DEEP_HEALTH_CHECKS: "true",
      D1_RATE_LIMIT_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "false",
      WYJ_ENVIRONMENT: "preview",
      EMAIL_SENDING_ENABLED: "true",
      EMAIL_CLOUDFLARE_ACCOUNT_ID: "acc_qa_test",
      EMAIL_SEND_API_TOKEN: "tok_qa_test",
      EMAIL_TEST_RECIPIENTS: "owner-test@thewyj.uk,alice-qa@thewyj.uk,support@thewyj.uk",
    };
    const inboundWorkerEnv = {
      ...env,
      EMAIL_FORWARD_TO_ADDRESS: "private-qa-forward.invalid",
    };

    // Seed a retryable failed delivery + an XSS inbound support email
    const ts = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO email_center_deliveries (
          delivery_id, kind, channel, trigger_source, actor_user_id, actor_role, target_user_id,
          recipient_email, from_email, reply_to, subject, body_preview, body_redacted, status,
          transport, error_code, error_message, retryable, retry_count, max_retries, created_at, updated_at
        ) VALUES ('dlv_qa_retry_1', 'admin_service_notice', 'admin_manual', 'admin_manual_send', 'u_qa_super', 'super_admin', 'u_qa_alice',
          'alice-qa@thewyj.uk', 'noreply@thewyj.uk', 'support@thewyj.uk', 'QA Failed Mail', 'Retry check body', 0, 'failed',
          'cloudflare_rest', 'email_provider_unavailable', 'Simulated transient 503', 1, 0, 3, ?, ?)`
      )
      .bind(ts, ts)
      .run();

    await db
      .prepare(
        `INSERT OR REPLACE INTO task25_feature_flags (
          flag_key, description, enabled, kill_switch, channels_json,
          rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id
        ) VALUES (
          'p07_accessibility', 'Email Center QA', 1, 0, '["stable","beta","experimental"]',
          10000, 1, ?, 'u_qa_super', 'qa-email-seed', 'qa-email-seed'
        )`
      )
      .bind(ts)
      .run();

    await handleInboundSupportEmail(
      {
        from: "alice-qa@thewyj.uk",
        to: "support@thewyj.uk",
        rawSize: 220,
        raw: 'From: alice-qa@thewyj.uk\r\nSubject: QA Support XSS Check\r\nMessage-ID: <qa-xss-1@example.net>\r\n\r\nNeed assistance <script>window.__qaInboundXss=1</script><img src=x onerror="window.__qaInboundXss=2">',
        headers: new Headers({ from: "alice-qa@thewyj.uk", subject: "QA Support XSS Check", "message-id": "<qa-xss-1@example.net>" }),
        async forward() {},
      },
      inboundWorkerEnv
    );

    server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, "http://127.0.0.1");
        if (reqUrl.pathname.startsWith("/api/")) {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const bodyBuffer = Buffer.concat(chunks);
          const webHeaders = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) webHeaders.set(k, v.join(", "));
            else if (v !== undefined) webHeaders.set(k, v);
          }
          const webRequest = new Request(`http://${req.headers.host}${reqUrl.pathname}${reqUrl.search}`, {
            method: req.method,
            headers: webHeaders,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : bodyBuffer,
          });
          const context = {
            request: webRequest,
            env,
            data: {},
            waitUntil() {},
            next: async () => (reqUrl.pathname === "/api/status" ? statusRouteResponse(context) : dispatchApi(context)),
          };
          const apiRes = await cloudMiddleware(context);
          if (apiRes.status >= 400) {
            const cloneText = await apiRes.clone().text().catch(() => "");
            apiErrors.push({ path: reqUrl.pathname, status: apiRes.status, body: cloneText.slice(0, 240) });
          }
          res.statusCode = apiRes.status;
          apiRes.headers.forEach((value, key) => res.setHeader(key, value));
          const buf = Buffer.from(await apiRes.arrayBuffer());
          res.end(buf);
          return;
        }

        const relPath = reqUrl.pathname === "/" || !path.extname(reqUrl.pathname) ? "index.html" : reqUrl.pathname.replace(/^\/+/, "");
        const filePath = path.resolve(REPO_ROOT, relPath);
        if (!filePath.startsWith(REPO_ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
        res.end(fs.readFileSync(filePath));
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err?.message || err));
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const cdpPort = 9325 + Math.floor(Math.random() * 400);
    const bin = findBrowserBinary();
    browserProc = spawn(
      bin,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${tmpBrowserDir}`,
        "about:blank",
      ],
      { stdio: "ignore" }
    );

    let versionInfo = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        versionInfo = await originalFetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json());
        if (versionInfo?.webSocketDebuggerUrl) break;
      } catch {
        await delay(150);
      }
    }
    assert.ok(versionInfo?.webSocketDebuggerUrl, "Headless browser CDP endpoint failed to start");

    cdp = new CdpClient(versionInfo.webSocketDebuggerUrl);
    await cdp.connect();
    const { browserContextId } = await cdp.send("Target.createBrowserContext");
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const runtimeErrors = [];
    cdp.listeners.add((msg) => {
      if (msg.sessionId && msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(msg.params?.exceptionDetails?.text || "Runtime exception");
      }
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr) => {
      const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || expr);
      }
      return res.result?.value;
    };

    const waitFor = async (expr, timeout = 15_000, label = expr) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(`Boolean(${expr})`)) return true;
        await delay(80);
      }
      const diag = await evaluate(`({
        path: location.pathname,
        hasSession: Boolean(localStorage.getItem('wyjAccountSession')),
        loginError: document.querySelector('#loginError')?.textContent || '',
        publicHomeHidden: document.querySelector('#publicHome')?.classList.contains('hidden'),
        sessionMode: document.querySelector('#publicHome')?.dataset?.sessionMode || '',
        emailErr: document.querySelector('#adminEmailCenterError')?.textContent || '',
        emailStatus: document.querySelector('#adminEmailCenterStatus')?.textContent || '',
      })`).catch(() => ({}));
      throw new Error(`Timeout waiting for: ${label} | diag=${JSON.stringify(diag)} | apiErrors=${JSON.stringify(apiErrors.slice(-5))} | runtimeErrors=${JSON.stringify(runtimeErrors.slice(-5))}`);
    };

    // 1. Open login page, sign in as owner, navigate to Admin Panel
    await send("Page.navigate", { url: `${baseUrl}/login` });
    await waitFor("!document.querySelector('#appShell')?.classList.contains('app-shell-pending') && !document.querySelector('#loginForm')?.classList.contains('hidden')", 15_000, "login form ready");
    await evaluate(`(() => {
      const u = document.querySelector('#usernameInput');
      const s = document.querySelector('#secretInput');
      u.value = 'wyj';
      u.dispatchEvent(new Event('input', { bubbles: true }));
      u.dispatchEvent(new Event('change', { bubbles: true }));
      s.value = ${JSON.stringify(OWNER_PASSWORD)};
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#loginSubmitBtn').click();
      return true;
    })()`);
    await waitFor("Boolean(localStorage.getItem('wyjAccountSession')) && location.pathname === '/' && !document.querySelector('#publicHome')?.classList.contains('hidden')", 15_000, "super_admin logged in");

    await send("Page.navigate", { url: `${baseUrl}/admin` });
    await waitFor("!document.querySelector('#appShell')?.classList.contains('app-shell-pending') && !document.querySelector('#adminPanel')?.classList.contains('hidden') && Boolean(document.querySelector('#adminEmailTab'))", 15_000, "admin email tab visible");

    // 2. Open 邮件中心 -> Overview
    await evaluate("document.querySelector('#adminEmailTab').click(); true");
    await waitFor("Boolean(document.querySelector('[data-email-subtab=overview]')) && document.querySelectorAll('.admin-email-stat-card').length >= 8", 15_000, "overview loaded");
    const overviewText = await evaluate("document.querySelector('#adminEmailCenterRoot').textContent || ''");
    assert.equal(overviewText.includes("待配置"), false, "BUG-11: Overview must never falsely display '待配置' when Pages env lacks standalone Worker secret");
    assert.equal(overviewText.includes("超级管理员 (super_admin)"), true, "Overview must explicitly identify super_admin role");
    assert.equal(overviewText.includes("发件身份尚未在环境配置授权"), true, "Overview must clarify sender config state vs super_admin role when unauthorized");
    process.stdout.write("[email-browser] PASS overview\n");

    // 3. Compose -> filter verified recipient -> verify template isolation & interpolation -> preview -> confirm & send
    await evaluate("document.querySelector('[data-email-subtab=compose]').click(); true");
    await waitFor("Boolean(document.querySelector('#adminEmailRecipientList')) && document.querySelectorAll('[data-select-recipient]').length >= 1", 10_000, "compose recipients loaded");
    const composeTplKeys = await evaluate("[...document.querySelectorAll('#adminEmailTemplateFill option')].map((o) => o.value)");
    assert.equal(composeTplKeys.includes("system_maintenance_notice"), true, "admin_service template must appear in compose");
    assert.equal(composeTplKeys.includes("support_reply"), false, "BUG-09: support_reply template MUST be excluded from general compose");
    await evaluate(`(() => {
      const sel = document.querySelector('#adminEmailTemplateFill');
      sel.value = 'system_maintenance_notice';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const filledComposeState = await evaluate("({ subject: document.querySelector('#adminEmailSubjectInput')?.value || '', body: document.querySelector('#adminEmailBodyInput')?.value || '' })");
    assert.equal(/\{\{[^}]+\}\}/.test(filledComposeState.subject) || /\{\{[^}]+\}\}/.test(filledComposeState.body), false, "BUG-09: template fill must not leave raw {{...}} placeholders");
    assert.equal(filledComposeState.body.includes("\\n"), false, "BUG-09: template fill must not show literal \\\\n");
    await evaluate(`(() => {
      const cb = document.querySelector('[data-select-recipient="u_qa_alice"]');
      if (!cb) throw new Error('missing verified user u_qa_alice');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      const subj = document.querySelector('#adminEmailSubjectInput');
      const body = document.querySelector('#adminEmailBodyInput');
      subj.value = 'QA Browser Manual Notice';
      subj.dispatchEvent(new Event('input', { bubbles: true }));
      body.value = 'Hello Alice, this notice was previewed and confirmed in the Admin Email Center UI.';
      body.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#adminEmailPreviewBtn').click();
      return true;
    })()`);
    await waitFor("Boolean(document.querySelector('#adminEmailPreviewCard')) && document.querySelector('#adminEmailPreviewCard').textContent.includes('QA Browser Manual Notice')", 10_000, "preview rendered");
    const submitStepup = async () => {
      await waitFor("Boolean(document.querySelector('#task27Prompt [name=password]'))", 10_000, "Task27 step-up modal");
      await evaluate(`(() => {
        const input = document.querySelector('#task27Prompt [name=password]');
        input.value = ${JSON.stringify(OWNER_PASSWORD)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#task27Prompt button[type=submit]').click();
        return true;
      })()`);
    };

    await evaluate(`(() => {
      document.querySelector('#adminEmailConfirmCheckbox').checked = true;
      document.querySelector('#adminEmailConfirmSendBtn').click();
      return true;
    })()`);
    await submitStepup();
    await waitFor("document.querySelector('#adminEmailCenterRoot').textContent.includes('最近投递结果回执')", 10_000, "compose send completed");
    process.stdout.write("[email-browser] PASS compose + preview + confirm + send\n");

    // 4. Deliveries -> Retry failed record -> verify delivered
    await evaluate("document.querySelector('[data-email-subtab=deliveries]').click(); true");
    await waitFor("Boolean(document.querySelector('[data-retry-delivery=\"dlv_qa_retry_1\"]'))", 10_000, "retry button visible");
    await evaluate("document.querySelector('[data-retry-delivery=\"dlv_qa_retry_1\"]').click(); true");
    await submitStepup();
    await waitFor("document.querySelector('#adminEmailCenterStatus').textContent.includes('delivered')", 10_000, "delivery retry succeeded");
    process.stdout.write("[email-browser] PASS deliveries + safe retry\n");

    // 5. Inbound support thread -> XSS escaped -> official reply
    await evaluate("document.querySelector('[data-email-subtab=inbound]').click(); true");
    await waitFor("document.querySelectorAll('[data-open-thread]').length >= 1", 10_000, "inbound thread list loaded");
    await evaluate("document.querySelector('[data-open-thread]').click(); true");
    await waitFor("Boolean(document.querySelector('#adminEmailReplyBody'))", 10_000, "inbound thread detail opened");
    assert.equal(await evaluate("typeof window.__qaInboundXss"), "undefined", "Inbound <script> MUST NOT execute in admin UI");
    await evaluate(`(() => {
      const tplSel = document.querySelector('#adminEmailReplyTemplateFill');
      if (tplSel) {
        tplSel.value = 'support_reply';
        tplSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()`);
    const supportFilled = await evaluate("document.querySelector('#adminEmailReplyBody')?.value || ''");
    assert.equal(/\{\{[^}]+\}\}/.test(supportFilled), false, "Inbound support_reply fill must resolve placeholders");
    assert.equal(supportFilled.includes("thr_"), true, "Inbound support_reply fill must bind real thread_id");
    await evaluate(`(() => {
      const rb = document.querySelector('#adminEmailReplyBody');
      rb.value = 'Official Aeris support reply verified.';
      rb.dispatchEvent(new Event('input', { bubbles: true }));
      const chk = document.querySelector('#adminEmailReplyConfirmCheck');
      chk.checked = true;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#adminEmailSendReplyBtn').click();
      return true;
    })()`);
    await submitStepup();
    await waitFor("document.querySelector('#adminEmailCenterRoot').textContent.includes('Official Aeris support reply verified.')", 10_000, "inbound reply visible in timeline");

    // 5b. Follow-up inbound message -> chronological ascending timeline + collapsed quote history
    await delay(30);
    await handleInboundSupportEmail(
      {
        from: "alice-qa@thewyj.uk",
        to: "support@thewyj.uk",
        rawSize: 360,
        raw: [
          "From: alice-qa@thewyj.uk",
          "Subject: Re: QA Support XSS Check",
          "Message-ID: <qa-followup-2@example.net>",
          "In-Reply-To: <qa-xss-1@example.net>",
          "",
          "Follow-up new message only.",
          "",
          "Aeris <noreply@thewyj.uk> 于 2026年11月15日周日 下午10:28写道：",
          "",
          "> Official Aeris support reply verified.",
          "> Older quoted line.",
        ].join("\r\n"),
        headers: new Headers({
          from: "alice-qa@thewyj.uk",
          subject: "Re: QA Support XSS Check",
          "message-id": "<qa-followup-2@example.net>",
          "in-reply-to": "<qa-xss-1@example.net>",
        }),
        async forward() {},
      },
      inboundWorkerEnv
    );
    await evaluate("document.querySelector('[data-open-thread]')?.click(); true");
    await waitFor("document.querySelectorAll('.admin-email-timeline .admin-email-msg').length === 3", 10_000, "follow-up inbound message added chronologically");
    const timelineCheck = await evaluate(`(() => {
      const msgs = [...document.querySelectorAll('.admin-email-timeline .admin-email-msg')];
      const thirdQuote = msgs[2]?.querySelector('.admin-email-quote');
      return {
        kinds: msgs.map((el) => (el.classList.contains('is-outbound') ? 'outbound' : 'inbound')),
        firstMain: msgs[0]?.querySelector(':scope > .admin-email-pre')?.textContent || '',
        secondMain: msgs[1]?.querySelector(':scope > .admin-email-pre')?.textContent || '',
        thirdMain: msgs[2]?.querySelector(':scope > .admin-email-pre')?.textContent || '',
        hasQuote: Boolean(thirdQuote),
        quoteOpenBefore: Boolean(thirdQuote?.open),
        quotedText: thirdQuote?.querySelector('.admin-email-pre-quoted')?.textContent || '',
      };
    })()`);
    assert.deepEqual(timelineCheck.kinds, ["inbound", "outbound", "inbound"], "timeline must interleave inbound & outbound in chronological ascending order");
    assert.equal(timelineCheck.firstMain.includes("Need assistance"), true, "oldest inbound message must stay at top");
    assert.equal(timelineCheck.secondMain.includes("Official Aeris support reply verified."), true, "admin reply must stay between first inbound and follow-up");
    assert.equal(timelineCheck.thirdMain, "Follow-up new message only.", "follow-up must show only newly added text by default");
    assert.equal(timelineCheck.hasQuote, true, "historical quote block must be rendered in <details>");
    assert.equal(timelineCheck.quoteOpenBefore, false, "historical quote block must be collapsed by default");
    assert.equal(timelineCheck.quotedText.includes("Older quoted line."), true, "full historical quote must remain expandable");
    await evaluate("document.querySelectorAll('.admin-email-timeline .admin-email-msg')[2].querySelector('.admin-email-quote > summary').click(); true");
    assert.equal(await evaluate("Boolean(document.querySelectorAll('.admin-email-timeline .admin-email-msg')[2].querySelector('.admin-email-quote')?.open)"), true, "clicking quote summary must expand historical text");
    process.stdout.write("[email-browser] PASS inbound thread + XSS escape + official reply + chronological order + quote collapse\n");

    // 6. Templates subtab
    await evaluate("document.querySelector('[data-email-subtab=templates]').click(); true");
    await waitFor("Boolean(document.querySelector('#adminEmailTplKey'))", 10_000, "templates loaded");
    process.stdout.write("[email-browser] PASS templates view\n");

    // 6b. Super Admin all_verified phrase clarity check in Compose preview
    await evaluate("document.querySelector('[data-email-subtab=compose]').click(); true");
    await waitFor("Boolean(document.querySelector('#adminEmailTargetMode'))", 10_000, "compose reloaded");
    await evaluate(`(() => {
      const mode = document.querySelector('#adminEmailTargetMode');
      mode.value = 'all_verified';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      const subj = document.querySelector('#adminEmailSubjectInput');
      const body = document.querySelector('#adminEmailBodyInput');
      subj.value = 'QA All Verified Preview Notice';
      subj.dispatchEvent(new Event('input', { bubbles: true }));
      body.value = 'Confirm phrase UI clarity check.';
      body.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#adminEmailPreviewBtn').click();
      return true;
    })()`);
    await waitFor("Boolean(document.querySelector('#adminEmailConfirmPhrase'))", 10_000, "all_verified phrase input visible");
    const bulkPreviewText = await evaluate("document.querySelector('#adminEmailPreviewCard').textContent || ''");
    assert.equal(bulkPreviewText.includes("全站群发二次确认短语"), true, "UI must label CONFIRM-ALL-VERIFIED as 全站群发二次确认短语");
    assert.equal(bulkPreviewText.includes("CONFIRM-ALL-VERIFIED"), true);
    assert.equal(bulkPreviewText.includes("不是超级管理员登录密码"), true);
    process.stdout.write("[email-browser] PASS all_verified phrase UX check\n");

    // 6c. Regular Admin browser context: inbound ticket handling + reply allowed, high-risk controls hidden
    const regCtx = await cdp.send("Target.createBrowserContext");
    const regTarget = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId: regCtx.browserContextId });
    const regAttach = await cdp.send("Target.attachToTarget", { targetId: regTarget.targetId, flatten: true });
    const regSid = regAttach.sessionId;
    const regSend = (method, params = {}) => cdp.send(method, params, regSid);
    await regSend("Page.enable");
    await regSend("Runtime.enable");
    const regEval = async (expr) => {
      const res = await regSend("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || expr);
      return res.result?.value;
    };
    const regWaitFor = async (expr, timeout = 15_000, label = expr) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await regEval(`Boolean(${expr})`)) return true;
        await delay(80);
      }
      throw new Error(`Regular admin browser timeout: ${label}`);
    };
    await regSend("Page.navigate", { url: `${baseUrl}/login` });
    await regWaitFor("!document.querySelector('#appShell')?.classList.contains('app-shell-pending') && !document.querySelector('#loginForm')?.classList.contains('hidden')", 15_000, "reg admin login ready");
    await regEval(`(() => {
      const u = document.querySelector('#usernameInput');
      const s = document.querySelector('#secretInput');
      u.value = 'qa_ops';
      u.dispatchEvent(new Event('input', { bubbles: true }));
      s.value = ${JSON.stringify(ADMIN_PASSWORD)};
      s.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#loginSubmitBtn').click();
      return true;
    })()`);
    await regWaitFor("Boolean(localStorage.getItem('wyjAccountSession')) && location.pathname === '/'", 15_000, "reg admin logged in");
    await regSend("Page.navigate", { url: `${baseUrl}/admin` });
    await regWaitFor("Boolean(document.querySelector('#adminEmailTab')) && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 15_000, "reg admin panel ready");
    await regEval("document.querySelector('#adminEmailTab').click(); true");
    await regWaitFor("document.querySelector('#adminEmailCenterRoot')?.textContent?.includes('普通管理员 (admin)')", 15_000, "reg admin email overview");
    await regEval("document.querySelector('[data-email-subtab=compose]').click(); true");
    await regWaitFor("Boolean(document.querySelector('#adminEmailTargetMode'))", 10_000, "reg admin compose");
    assert.equal(await regEval("Boolean(document.querySelector('#adminEmailTargetMode option[value=all_verified]'))"), false, "Regular admin must NOT see all_verified target option");
    await regEval("document.querySelector('[data-email-subtab=inbound]').click(); true");
    await regWaitFor("document.querySelectorAll('[data-open-thread]').length >= 1", 10_000, "reg admin inbound list");
    await regEval("document.querySelector('[data-open-thread]').click(); true");
    await regWaitFor("Boolean(document.querySelector('#adminEmailReplyBody'))", 10_000, "reg admin thread opened");
    assert.equal(await regEval("Boolean(document.querySelector('[data-thread-status=delete]'))"), false, "Regular admin must NOT see thread delete button");
    await regEval(`(() => {
      const rb = document.querySelector('#adminEmailReplyBody');
      rb.value = 'Handled by regular support admin in browser QA.';
      rb.dispatchEvent(new Event('input', { bubbles: true }));
      const chk = document.querySelector('#adminEmailReplyConfirmCheck');
      chk.checked = true;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#adminEmailSendReplyBtn').click();
      return true;
    })()`);
    await regWaitFor("Boolean(document.querySelector('#task27Prompt [name=password]'))", 10_000, "reg admin step-up modal");
    await regEval(`(() => {
      const input = document.querySelector('#task27Prompt [name=password]');
      input.value = ${JSON.stringify(ADMIN_PASSWORD)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#task27Prompt button[type=submit]').click();
      return true;
    })()`);
    await regWaitFor("document.querySelector('#adminEmailCenterRoot').textContent.includes('Handled by regular support admin in browser QA.')", 10_000, "reg admin reply sent & rendered");
    process.stdout.write("[email-browser] PASS regular_admin RBAC & support reply browser flow\n");

    // 7. Mobile 375x812 responsive check (zero horizontal overflow)
    await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await delay(150);
    for (const sub of ["overview", "compose", "deliveries", "inbound", "templates"]) {
      await evaluate(`document.querySelector('[data-email-subtab=${JSON.stringify(sub)}]').click(); true`);
      await delay(250);
      const overflow = await evaluate(`(() => {
        const sw = document.documentElement.scrollWidth;
        const cw = document.documentElement.clientWidth;
        if (sw <= cw) return { ok: true, sw, cw };
        const offenders = [...document.querySelectorAll('*')]
          .map((el) => ({ tag: el.tagName, id: el.id, cls: String(el.className || '').slice(0, 60), right: Math.round(el.getBoundingClientRect().right), elSw: Math.round(el.scrollWidth) }))
          .filter((x) => x.right > cw + 1 || x.elSw > cw + 1)
          .slice(0, 8);
        return { ok: false, sw, cw, offenders };
      })()`);
      assert.equal(overflow.ok, true, `Horizontal overflow detected on subtab ${sub} at 375px width: ${JSON.stringify(overflow)}`);
    }
    assert.deepEqual(runtimeErrors, [], `Unexpected browser runtime errors: ${JSON.stringify(runtimeErrors)}`);
    process.stdout.write("[email-browser] PASS 375px mobile responsive layout & zero console errors\n");
    process.stdout.write("Admin Email Center browser QA passed: all checks\n");
  } finally {
    globalThis.fetch = originalFetch;
    cdp?.close();
    if (browserProc && !browserProc.killed) browserProc.kill("SIGKILL");
    if (server) await new Promise((resolve) => server.close(resolve));
    await mf.dispose().catch(() => {});
    await rm(tmpDbDir, { recursive: true, force: true }).catch(() => {});
    await rm(tmpBrowserDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
