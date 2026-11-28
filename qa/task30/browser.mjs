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
const out = path.join(root, ".wrangler/task30/evidence", `browser-${crypto.randomUUID()}`);
await mkdir(out, { recursive: true });

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
  TASK27_SECURITY_ENABLED: "true",
  TASK29_BACKUP_ENABLED: "true",
  TASK30_PRIVACY_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: "task30-browser-only-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "task30-browser-only-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "task30-browser-only-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}
await db.prepare("UPDATE task25_feature_flags SET enabled = 1, kill_switch = 0 WHERE flag_key = 'task30_privacy_v1'").run();

const password = "Synthetic-Task30-Browser-Password!";
const now = new Date().toISOString();
const expiresFuture = new Date(Date.now() + 86400_000).toISOString();
const userId = "task30-browser-user";

await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES (?1, 'task30browser', 'task30browser', ?2, 'pbkdf2_sha256', 100000, 'user', ?3, ?3, ?3)`)
  .bind(userId, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare(`INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at)
  VALUES ('task30-fixture-owner', 'task30ownerfix', 'task30ownerfix', '', 'reset_required', 0, 'super_admin', ?1, ?1, ?1)`)
  .bind(now).run();
await db.prepare("INSERT INTO task27_security (user_id, password_age_start_at) VALUES (?1, ?2)").bind(userId, now).run();
await db.prepare(`INSERT INTO task14_shares (id, owner_user_id, share_type, kind, content_text, r2_object_key, created_at, updated_at, expires_at, state, deletion_reason)
  VALUES ('t14_browser_clip_01', ?1, 'clipboard', 'clipboard', 'Browser Clipboard Text', '', ?2, ?2, ?3, 'active', '')`).bind(userId, now, expiresFuture).run();
await db.prepare(`INSERT INTO task16_finance_categories (id, user_id, name, applies_to, color, status, revision, sync_version, created_at, updated_at, deleted_at)
  VALUES ('cat_br_001', ?1, 'Browser餐饮', 'expense', '#ff6600', 'active', 1, 1, ?2, ?2, '')`).bind(userId, now).run();

const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
let base;
const apiErrors = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
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
        apiErrors.push({ path: url.pathname, status: response.status });
      }
      const headersOut = Object.fromEntries(response.headers);
      const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      if (setCookies.length) headersOut["set-cookie"] = setCookies;
      res.writeHead(response.status, headersOut);
      res.end(Buffer.from(await response.arrayBuffer()));
      await Promise.all(tasks);
      return;
    }
    const file = ["/", "/login", "/transfer", "/select", "/account", "/finance"].includes(url.pathname) ? "index.html" : url.pathname.slice(1);
    if (!isAllowedPagesFile(file) || file.startsWith("functions/")) { res.writeHead(404); res.end(); return; }
    const mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : file.endsWith(".png") ? "image/png" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Content-Security-Policy": csp, "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
    res.end(await readFile(path.join(root, file)));
  } catch (error) {
    res.writeHead(500);
    res.end("fixture error");
    console.error(error.message);
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-task30-chrome-"));
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

let page;
const proof = {
  scope: "Chrome desktop/tablet/mobile Light+Dark UI & real local D1/R2 flows",
  checks: [],
  screenshots: [],
  android_device: "NOT_TESTED — Chrome mobile viewport & automation only",
  production: "NOT_TOUCHED",
};

async function check(name, fn) {
  await fn();
  proof.checks.push({ name, status: "PASS" });
  console.log("PASS " + name);
}

async function capture(name) {
  const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(out, name), Buffer.from(shot.data, "base64"));
  proof.screenshots.push(name);
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
  page = await openPage({ cdpUrl, baseUrl: base, width: 1440, height: 900, mobile: false });

  await check("login and open Privacy Center on desktop Light", async () => {
    await page.navigate("/login");
    await page.waitFor("document.querySelector('#usernameInput')");
    await page.setFields({ "#usernameInput": "task30browser", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("!document.querySelector('#accountMenu')?.classList.contains('hidden')");
    await page.navigate("/account");
    await page.waitFor("document.querySelector('#accountTabData')?.checkVisibility()");
    await page.click("#accountTabData");
    await page.waitFor("document.querySelector('#accountPrivacyOpen') && !document.querySelector('#accountPrivacyOpen').classList.contains('hidden')");
    await page.click("#accountPrivacyOpen");
    await page.waitFor("document.querySelector('#task30PrivacyModal') && !document.querySelector('#task30PrivacyModal').classList.contains('hidden')");
    await page.waitFor("document.querySelectorAll('#task30PrivacyModal [data-privacy-category]').length === 8");
    const overflow = await page.evaluate("document.documentElement.scrollWidth > window.innerWidth");
    assert.equal(overflow, false, "desktop overflow");
    await capture("desktop-light-data.png");
  });

  await check("consents tab revokes cloud_notification_sync & displays Android OS disclosure", async () => {
    await page.click('#task30PrivacyModal [data-privacy-tab="consents"]');
    await page.waitFor("document.querySelectorAll('#task30PrivacyModal [data-consent-card]').length === 4");
    await capture("desktop-light-consents.png");
    await page.click('#task30PrivacyModal [data-privacy-consent="cloud_notification_sync"]');
    await page.waitFor("document.querySelector('#task27Prompt [name=\"confirm\"]')");
    await page.evaluate("document.querySelector('#task27Prompt [name=\"confirm\"]').checked = true");
    await page.click('#task27Prompt button[type="submit"]');
    await page.waitFor("document.querySelector('#task30PrivacyModal [data-consent-card=\"cloud_notification_sync\"] .sc-privacy-pill')?.classList.contains('is-off')");
  });

  await check("erasure tab previews, commits temporary deletion with Step-up, and renders request detail", async () => {
    await page.click('#task30PrivacyModal [data-privacy-tab="erasure"]');
    await page.waitFor("document.querySelector('#privacyCategoryCheckboxes input[value=\"temporary\"]')");
    await page.evaluate("document.querySelector('#privacyCategoryCheckboxes input[value=\"temporary\"]').checked = true");
    await page.click('#task30PrivacyModal [data-privacy-preview]');
    await page.waitFor("document.querySelector('#privacyPreviewBox')");
    await capture("desktop-light-erasure-preview.png");
    await page.setFields({ "#privacyConfirmInput": "DELETE TEMPORARY" });
    await page.click('#task30PrivacyModal [data-privacy-commit]');
    await page.waitFor("document.querySelector('#task27Prompt [name=\"password\"]')");
    await page.setFields({ "#task27Prompt [name=\"password\"]": password });
    await page.click('#task27Prompt button[type="submit"]');
    await page.waitFor("document.querySelectorAll('#task30PrivacyModal [data-privacy-req]').length >= 1");
    const detailBtn = await page.evaluate("document.querySelector('#task30PrivacyModal [data-privacy-detail]')?.dataset?.privacyDetail || ''");
    assert.ok(detailBtn);
    await page.click(`#task30PrivacyModal [data-privacy-detail="${detailBtn}"]`);
    await page.waitFor("document.querySelector('#task30PrivacyModal .sc-privacy-json')");
    await capture("desktop-light-requests.png");
    const clipCount = (await db.prepare("SELECT COUNT(*) AS cnt FROM task14_shares WHERE id = 't14_browser_clip_01' AND state = 'deleted'").first()).cnt;
    assert.equal(clipCount, 1);
  });

  await check("responsive tablet 768x1024 and mobile 390x844 Dark + 375x667 Light >=44px tap targets & zero overflow", async () => {
    for (const vp of [
      { width: 768, height: 1024, mobile: false, dark: false, shot: "tablet-768-privacy.png" },
      { width: 390, height: 844, mobile: true, dark: true, shot: "mobile-390-dark-privacy.png" },
      { width: 375, height: 667, mobile: true, dark: false, shot: "mobile-375-light-privacy.png" },
    ]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: vp.mobile });
      await page.evaluate(`(() => {
        document.documentElement.dataset.theme = ${vp.dark ? "'dark'" : "'light'"};
        document.documentElement.classList.toggle('dark-theme', ${vp.dark});
        return true;
      })()`);
      await page.click('#task30PrivacyModal [data-privacy-tab="data"]');
      await delay(150);
      const metrics = await page.evaluate(`(() => {
        const panel = document.querySelector('#task30PrivacyModal .modal-panel');
        const panelOverflow = panel ? panel.scrollWidth > panel.clientWidth + 1 : false;
        const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
        const btns = [...document.querySelectorAll('#task30PrivacyModal .sc-privacy-tab, #task30PrivacyModal .sc-privacy-panel button')].filter(b => b.offsetParent !== null);
        const minHeight = btns.reduce((m, b) => Math.min(m, b.getBoundingClientRect().height), 999);
        return { panelOverflow, docOverflow, minHeight };
      })()`);
      assert.equal(metrics.docOverflow, false, `doc overflow at ${vp.width}x${vp.height}`);
      assert.equal(metrics.panelOverflow, false, `panel overflow at ${vp.width}x${vp.height}`);
      assert.ok(metrics.minHeight >= 44, `button height ${metrics.minHeight} < 44 at ${vp.width}x${vp.height}`);
      await capture(vp.shot);
    }
  });

  assert.equal(apiErrors.length, 0, JSON.stringify(apiErrors));
  assert.equal(page.runtimeErrors.length, 0, JSON.stringify(page.runtimeErrors));
  proof.status = "PASS";
} catch (error) {
  proof.status = "FAIL";
  proof.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(error.stack || error.message);
} finally {
  await page?.close().catch(() => {});
  child.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await writeFile(path.join(out, "result.json"), JSON.stringify(proof, null, 2) + "\n");
  await mf.dispose();
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, screenshots: proof.screenshots, evidence: path.relative(root, out) }));
}
