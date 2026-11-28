import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { CdpClient, openPage, delay } from "../../local-backend/browser_harness.mjs";
import { onRequest } from "../../functions/api/[[path]].js";
import { onRequest as status } from "../../functions/api/status.js";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".wrangler/task29/evidence", `browser-${crypto.randomUUID()}`);
const downloadsDir = path.join(out, "downloads");
await mkdir(downloadsDir, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated fixture'); } }",
  compatibilityDate: config.compatibility_date,
  d1Databases: ["WYJ_DB"],
  r2Buckets: ["WYJ_STORAGE"],
});
const db = await mf.getD1Database("WYJ_DB");
const env = {
  ...config.env.preview.vars,
  WYJ_DB: db,
  WYJ_STORAGE: await mf.getR2Bucket("WYJ_STORAGE"),
  WYJ_ENVIRONMENT: "development",
  WORKERS_AI_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "false",
  TTS_MODE: "cache-only",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK21_NOTIFICATION_READS_ENABLED: "true",
  TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  TASK18_ADMIN_MESSAGES_ENABLED: "true",
  WYJ_TASK12_PASSWORD_PEPPER: "task29-browser-synthetic-pepper-0123456789",
  WYJ_TASK14_TEMPORARY_SECRET: "task29-browser-synthetic-share-0123456789",
  WYJ_TASK20_DEVICE_SESSION_SECRET: "task29-browser-synthetic-device-0123456789",
};

for (const name of (await readdir(path.join(root, "cloudflare/migrations"))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, "cloudflare/migrations", name), "utf8")).replace(/\r?\n/g, " "));
}

const password = "Synthetic-Task29-Browser-Password!";
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const userA = "task29-browser-a";
const userB = "task29-browser-b";

await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
  VALUES(?1,'task29browsera','task29browsera',?2,'pbkdf2_sha256',100000,'user',?3,?3,?3)`)
  .bind(userA, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
  VALUES(?1,'task29browserb','task29browserb',?2,'pbkdf2_sha256',100000,'user',?3,?3,?3)`)
  .bind(userB, await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
  VALUES('task29-fixture-owner','task29-fixture-owner','task29-fixture-owner','','reset_required',0,'super_admin',?1,?1,?1)`).bind(now).run();

await db.batch([
  db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at)
    VALUES('mem_browser_a',?1,'all_access_lifetime',?2,'',1,'active','fixture','task29-browser','fixture','{}',?2,?2)`).bind(userA, now),
  db.prepare(`INSERT INTO task16_finance_categories(id,user_id,name,applies_to,color,status,revision,sync_version,created_at,updated_at,deleted_at)
    VALUES('ui_cat_001',?1,'浏览器测试分类','expense','#3355cc','active',1,1,?2,?2,'')`).bind(userA, now),
  db.prepare(`INSERT INTO task16_finance_transactions(id,user_id,direction,amount_minor,currency,amount_exponent,category_id,merchant,counterparty,note,occurred_at_ms,source_kind,reconciliation_state,status,revision,sync_version,created_by_device,import_source_key,created_at,updated_at,deleted_at,system_superseded_by,system_superseded_operation,currency_review_required,currency_decision_source)
    VALUES
    ('ui_tx_keep_01',?1,'expense',6800,'CNY',2,'ui_cat_001','保留咖啡','','ui keep',1763350000000,'manual','confirmed','active',1,1,'web_ui','',?2,?2,'','','',0,''),
    ('ui_tx_wipe_02',?1,'expense',12900,'USD',2,'ui_cat_001','Restorable Hardware','','=1+1 formula note',1763350100000,'manual','confirmed','active',1,2,'web_ui','',?2,?2,'','','',0,'')`).bind(userA, now),
  db.prepare(`INSERT INTO task21_notification_pending_hints(id,user_id,source_event_id,device_id,source_type,source_package,app_label,evidence_summary,amount_minor,direction,merchant,currency,confidence,recognition_status,state,finance_entry_id,created_at,updated_at,provider_reference,payment_channel,currency_review_required,currency_decision_source)
    VALUES('ui_hint_01',?1,'ui_src_001','dev_ui_01','notification','com.tencent.mm','WeChat','{"reasons":["browser_fixture"]}',2200,'expense','Pending Tea','CNY',700,'PAYMENT_LIKELY','pending','',?2,?2,'wx_ui_01','wechat',0,'')`).bind(userA, now),
]);

const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
let base;
const apiErrors = [];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
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
        waitUntil(p) {
          tasks.push(p);
        },
      };
      const response = await (url.pathname === "/api/status" ? status : onRequest)(context);
      if (response.status >= 500) {
        apiErrors.push({ path: url.pathname, status: response.status, code: (await response.clone().json().catch(() => ({})))?.code });
      }
      const headersOut = Object.fromEntries(response.headers);
      const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      if (setCookies.length) headersOut["set-cookie"] = setCookies;
      res.writeHead(response.status, headersOut);
      res.end(Buffer.from(await response.arrayBuffer()));
      await Promise.all(tasks);
      return;
    }
    const file = ["/", "/login", "/account", "/finance", "/select"].includes(url.pathname) ? "index.html" : url.pathname.slice(1);
    if (!isAllowedPagesFile(file) || file.startsWith("functions/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const mime = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".webmanifest")
              ? "application/manifest+json"
              : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    });
    res.end(await readFile(path.join(root, file)));
  } catch (err) {
    res.writeHead(500);
    res.end("isolated fixture error");
    console.error(err.message);
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-task29-chrome-"));
const chrome =
  process.env.AERIS_TEST_CHROME ||
  process.env.CHROME_BIN ||
  (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
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

let browser;
let page;
const proof = {
  scope: "isolated desktop/tablet/mobile Chrome in Light & Dark themes, real local D1/R2, Web Crypto E2E",
  checks: [],
  screenshots: [],
  viewports_checked: [],
  production: "NOT_TOUCHED",
};

async function check(name, fn) {
  await fn();
  proof.checks.push({ name, status: "PASS" });
  console.log(`PASS ${name}`);
}

async function screenshot(name) {
  const capture = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(out, `${name}.png`), Buffer.from(capture.data, "base64"));
  proof.screenshots.push(`${name}.png`);
}

async function waitForDownloadedFile(ext, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const names = await readdir(downloadsDir);
    const hit = names.find((n) => n.endsWith(ext) && !n.endsWith(".crdownload"));
    if (hit) {
      const full = path.join(downloadsDir, hit);
      const buf = await readFile(full);
      if (buf.byteLength > 10) return full;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for downloaded ${ext} file in ${downloadsDir}`);
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
  assert.ok(port, "isolated Chrome starts");
  const cdpUrl = `http://127.0.0.1:${port}`;
  const version = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
  browser = new CdpClient(version.webSocketDebuggerUrl);
  await browser.connect();
  proof.browser = version.Browser;

  page = await openPage({ cdpUrl, baseUrl: base, width: 1440, height: 900, mobile: false });
  await page.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsDir,
  });
  const axeSource = await readFile(path.join(root, "qa/p07-f/vendor/axe.min.js"), "utf8");
  const backupPass = "Browser-WebCrypto-Pass-2026!";

  await check("desktop login and open backup center from account workspace", async () => {
    await page.navigate("/login");
    await page.waitFor("document.getElementById('usernameInput')?.checkVisibility()", 20_000);
    await page.setFields({ "#usernameInput": "task29browsera", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/' && document.getElementById('notificationBellBtn')?.checkVisibility()", 30_000);

    await page.navigate("/account");
    await page.waitFor("document.getElementById('accountTabData')?.checkVisibility()", 15_000);
    await page.click("#accountTabData");
    await page.waitFor("document.getElementById('accountBackupOpen')?.checkVisibility()", 15_000);
    await page.click("#accountBackupOpen");
    await page.waitFor("document.getElementById('task29BackupModal') && !document.getElementById('task29BackupModal').classList.contains('hidden') && document.getElementById('backupExportSubmitBtn')", 15_000);

    // Privacy boundary banner clearly separates cloud structured items from Android local raw text
    const privacyText = await page.evaluate("document.querySelector('.sc-backup-privacy-banner')?.textContent || ''");
    assert.match(privacyText, /不包含/);
    assert.match(privacyText, /Android/);

    // Eye toggle does not overlap input box geometry
    const nonOverlap = await page.evaluate(`(() => {
      const inp = document.getElementById('backupExportPassphrase');
      const wrap = inp?.closest('.task27-password-input');
      const btn = wrap?.querySelector('button');
      if (!inp || !btn) return false;
      const ri = inp.getBoundingClientRect();
      const rb = btn.getBoundingClientRect();
      return rb.left >= ri.right - 1 && rb.width >= 44 && ri.width > 80;
    })()`);
    assert.equal(nonOverlap, true, "passphrase visibility button sits cleanly beside input without overlap");
  });

  let downloadedEncPath;
  await check("browser Web Crypto encrypts export package, exports CSV safely, and rejects wrong passphrase", async () => {
    await page.evaluate(`(() => {
      const p1 = document.getElementById('backupExportPassphrase');
      const p2 = document.getElementById('backupExportPassphraseConfirm');
      p1.value = ${JSON.stringify(backupPass)};
      p2.value = ${JSON.stringify(backupPass)};
    })()`);
    await page.click("#backupExportSubmitBtn");
    downloadedEncPath = await waitForDownloadedFile(".aeris-backup.json");
    const containerJson = JSON.parse(await readFile(downloadedEncPath, "utf8"));
    assert.equal(containerJson.format, "aeris-encrypted-backup");
    assert.equal(containerJson.crypto.cipher, "AES-256-GCM");
    assert.ok(!JSON.stringify(containerJson).includes(backupPass));

    // Also test CSV export
    await page.evaluate("document.getElementById('backupExportFormat').value = 'csv'; document.getElementById('backupExportFormat').dispatchEvent(new Event('change'));");
    await page.click("#backupExportSubmitBtn");
    const csvPath = await waitForDownloadedFile(".csv");
    const csvContent = await readFile(csvPath, "utf8");
    assert.ok(csvContent.includes("'=1+1 formula note"), "CSV downloaded via UI neutralizes formula injection");

    // Wrong passphrase fails client Web Crypto precheck without mutating anything
    await page.setFile("#backupRestoreFileInput", [downloadedEncPath]);
    await page.evaluate("document.getElementById('backupRestorePassphrase').value = 'Wrong-Pass-999!'");
    await page.click("#backupPrecheckBtn");
    await page.waitFor("document.querySelector('#task29BackupModal [data-task27-status]')?.textContent?.includes('失败')", 15_000);
  });

  await check("read-only precheck preview -> Step-up commit -> D1 restored -> idempotent re-import", async () => {
    // Wipe 1 transaction directly in D1 so backup has 1 missing transaction to recover
    await db.prepare("DELETE FROM task16_finance_transactions WHERE id = 'ui_tx_wipe_02' AND user_id = ?1").bind(userA).run();
    const countBefore = (await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n;
    assert.equal(countBefore, 1);

    await page.evaluate(`document.getElementById('backupRestorePassphrase').value = ${JSON.stringify(backupPass)}`);
    await page.click("#backupPrecheckBtn");
    await page.waitFor("!document.getElementById('backupPrecheckResult').hidden && document.getElementById('backupPrecheckSummary').textContent.includes('1')", 20_000);

    // Proof: precheck did NOT write to D1
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n, 1);

    // Screenshot 1440px Light with precheck diff preview open
    await screenshot("desktop-1440-light");

    await page.click("#backupConfirmCheckbox");
    await page.waitFor("document.getElementById('backupCommitRestoreBtn').disabled === false", 5_000);
    await page.click("#backupCommitRestoreBtn");

    // Fill Step-up password modal
    await page.waitFor("document.getElementById('task27Prompt') && !document.getElementById('task27Prompt').classList.contains('hidden')", 15_000);
    await page.evaluate(`(() => {
      const inp = document.querySelector('#task27Prompt input[name="password"]');
      inp.value = ${JSON.stringify(password)};
    })()`);
    await page.click("#task27Prompt button[type='submit']");

    await page.waitFor("!document.getElementById('backupRestoreReport').hidden && document.getElementById('backupRestoreReport').textContent.includes('新写入')", 20_000);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n, 2);

    // Second restore run with same file -> Idempotent Replay notice
    await page.evaluate(`document.getElementById('backupRestorePassphrase').value = ${JSON.stringify(backupPass)}`);
    await page.click("#backupPrecheckBtn");
    await page.waitFor("!document.getElementById('backupPrecheckResult').hidden && document.getElementById('backupConfirmCheckbox').checked === false", 20_000);
    await page.click("#backupConfirmCheckbox");
    await page.click("#backupCommitRestoreBtn");
    await page.waitFor("document.getElementById('task27Prompt') && !document.getElementById('task27Prompt').classList.contains('hidden')", 15_000);
    await page.evaluate(`document.querySelector('#task27Prompt input[name="password"]').value = ${JSON.stringify(password)}`);
    await page.click("#task27Prompt button[type='submit']");
    await page.waitFor("document.getElementById('backupRestoreReport').textContent.includes('幂等重放完成')", 20_000);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id = ?1").bind(userA).first()).n, 2);
  });

  await check("responsive viewports (1440, 768, 390, 375) in Light & Dark themes with zero overflow & axe pass", async () => {
    await page.evaluate(axeSource);
    const viewports = [
      { label: "1440", width: 1440, height: 900, mobile: false },
      { label: "768", width: 768, height: 1024, mobile: true },
      { label: "390", width: 390, height: 844, mobile: true },
      { label: "375", width: 375, height: 667, mobile: true },
    ];
    for (const vp of viewports) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile,
      });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(`(() => {
          document.documentElement.dataset.theme = '${theme}';
          document.documentElement.dataset.themePreference = '${theme}';
        })()`);
        await delay(400);
        const overflow = await page.evaluate("(() => { const p = document.querySelector('#task29BackupModal .task27-panel'); return (document.documentElement.scrollWidth > window.innerWidth + 1) || (p && p.scrollWidth > p.clientWidth + 2); })()");
        assert.equal(overflow, false, `No horizontal overflow at ${vp.label}px ${theme}`);
        const violations = await page.evaluate("axe.run(document.getElementById('task29BackupModal')).then(r => r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))");
        assert.deepEqual(violations, [], `Zero serious/critical a11y violations at ${vp.label}px ${theme}`);
        await screenshot(`vp-${vp.label}-${theme}`);
        proof.viewports_checked.push(`${vp.width}x${vp.height}:${theme}`);
      }
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.evaluate("document.documentElement.dataset.theme = 'light';");
  });

  await check("account switch clears stale state & rejects cross-account backup import in UI", async () => {
    // Log out and log in as User B
    await page.evaluate("document.querySelector('#task29BackupModal [data-task27-close]').click()");
    await page.evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); })()`);
    await page.navigate("/login");
    await page.waitFor("document.getElementById('usernameInput')?.checkVisibility()", 20_000);
    await page.setFields({ "#usernameInput": "task29browserb", "#secretInput": password });
    await page.click("#loginSubmitBtn");
    await page.waitFor("location.pathname === '/' && document.getElementById('notificationBellBtn')?.checkVisibility()", 30_000);

    await page.navigate("/account");
    await page.waitFor("document.getElementById('accountTabData')?.checkVisibility()", 15_000);
    await page.click("#accountTabData");
    await page.waitFor("document.getElementById('accountBackupOpen')?.checkVisibility()", 15_000);
    await page.click("#accountBackupOpen");
    await page.waitFor("document.getElementById('backupRestoreFileInput')", 15_000);

    // Ensure previous restore report is hidden / reset
    assert.equal(await page.evaluate("document.getElementById('backupRestoreReport').hidden"), true);

    await page.setFile("#backupRestoreFileInput", [downloadedEncPath]);
    await page.evaluate(`document.getElementById('backupRestorePassphrase').value = ${JSON.stringify(backupPass)}`);
    await page.click("#backupPrecheckBtn");
    await page.waitFor("document.querySelector('#task29BackupModal [data-task27-status]')?.textContent?.includes('其他账户')", 15_000);
  });

  assert.deepEqual(apiErrors, []);
  proof.status = "PASS";
} catch (err) {
  proof.status = "FAIL";
  proof.error = err.stack;
  process.exitCode = 1;
  console.error(err.stack);
} finally {
  if (page?.close) await page.close().catch(() => {});
  browser?.close();
  child.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await writeFile(path.join(out, "result.json"), JSON.stringify(proof, null, 2) + "\n");
  await mf.dispose();
  console.log(JSON.stringify({ status: proof.status, checks: proof.checks.length, screenshots: proof.screenshots, evidence: path.relative(root, out) }));
}
