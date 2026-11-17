import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { CdpClient, openPage, delay } from '../../local-backend/browser_harness.mjs';
import { onRequest as apiRequest } from '../../functions/api/[[path]].js';
import { onRequest as statusRequest } from '../../functions/api/status.js';
import { hashSecret } from '../../functions/_lib/task12-crypto.mjs';
import { isAllowedPagesFile } from '../../scripts/stage_pages_deploy.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const mf = new Miniflare({
  modules: true,
  script: "export default {fetch(){return new Response('fixture')}}",
  compatibilityDate: '2026-08-06',
  d1Databases: ['WYJ_DB'],
  r2Buckets: ['WYJ_STORAGE'],
});
const db = await mf.getD1Database('WYJ_DB');
const config = JSON.parse(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));
const password = 'Synthetic-Android-Sync-Password1!';
const env = {
  ...config.env.preview.vars,
  WYJ_DB: db,
  WYJ_STORAGE: await mf.getR2Bucket('WYJ_STORAGE'),
  WYJ_ENVIRONMENT: 'development',
  WORKERS_AI_ENABLED: 'false',
  TTS_MODE: 'cache-only',
  TASK27_SECURITY_ENABLED: 'true',
  EMAIL_SENDING_ENABLED: 'false',
  WYJ_TASK12_PASSWORD_PEPPER: 'android-sync-fixture-pepper-0123456789012345',
  WYJ_TASK14_TEMPORARY_SECRET: 'android-sync-fixture-share-01234567890123456',
  WYJ_TASK20_DEVICE_SESSION_SECRET: 'android-sync-fixture-device-0123456789012345',
  WYJ_TASK27_CHALLENGE_SECRET: 'android-sync-fixture-challenge-012345678901',
  WYJ_TASK27_TOTP_KEY: Buffer.alloc(32, 7).toString('base64url'),
};

for (const name of (await readdir(path.join(root, 'cloudflare/migrations'))).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  await db.exec((await readFile(path.join(root, 'cloudflare/migrations', name), 'utf8')).replace(/\r?\n/g, ' '));
}

const now = new Date().toISOString();
await db.prepare(
  `INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
   VALUES('1234','device1234','device1234',?1,'pbkdf2_sha256',310000,'super_admin',?2,?2,?2,?2)`,
).bind(await hashSecret(password, env.WYJ_TASK12_PASSWORD_PEPPER), now).run();

// Issue real device credentials via /api/app/login (simulating native login).
const loginReq = new Request('https://fixture.thewyj.test/api/app/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'thewyj-android/1.3.39 Android/36',
    Origin: 'https://fixture.thewyj.test',
  },
  body: JSON.stringify({
    username: 'device1234',
    secret: password,
    device_id: '663a75e0-0c27-4c0b-9ed7-608a8d05c235',
    app_version: '1.3.39',
  }),
});
const loginRes = await apiRequest({ request: loginReq, env, data: { requestId: crypto.randomUUID() }, waitUntil() {} });
assert.equal(loginRes.status, 200);
const credentials = await loginRes.json();
assert.equal(credentials.account.id, '1234');

// Toggleable test state simulating WebSessionBridge cookie presence & slow responses.
let installedAccessCookie = '';
let healthDelayMs = 0;

const spa = new Set(['/', '/login', '/register', '/account', '/admin', '/forgot-password', '/changelog', '/language', '/select', '/tools', '/finance', '/transfer', '/recharge']);
const csp = (await readFile(path.join(root, '_headers'), 'utf8')).match(/Content-Security-Policy: (.+)/)[1].trim();
let base;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/health' && healthDelayMs > 0) await delay(healthDelayMs);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers(req.headers);
      if (installedAccessCookie && !String(headers.get('cookie') || '').includes('__Host-wyj_app_access=')) {
        headers.set('cookie', `__Host-wyj_app_access=${installedAccessCookie}`);
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const tasks = [];
      const context = { request, env, data: { requestId: crypto.randomUUID() }, waitUntil(p) { tasks.push(p); } };
      const response = url.pathname === '/api/status' ? await statusRequest(context) : await apiRequest(context);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      await Promise.all(tasks);
      return;
    }
    const file = spa.has(url.pathname) ? 'index.html' : url.pathname.slice(1);
    if (!isAllowedPagesFile(file) || file.startsWith('functions/')) { res.writeHead(404); res.end(); return; }
    const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' });
    res.end(await readFile(path.join(root, file)));
  } catch (error) {
    res.writeHead(500);
    res.end(error.message);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}`;
const androidUa = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 thewyj-android/1.3.39';
const profile = await mkdtemp(path.join(os.tmpdir(), 'aeris-android-sync-chrome-'));
const chrome = process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const child = spawn(chrome, [
  '--headless=new',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  'about:blank',
], { windowsHide: true, stdio: 'ignore' });

let browser;
let page;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { await delay(100); }
  }
  assert.ok(port, 'isolated Chrome started');
  const cdpUrl = `http://127.0.0.1:${port}`;
  const version = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
  browser = new CdpClient(version.webSocketDebuggerUrl);
  await browser.connect();
  page = await openPage({ cdpUrl, baseUrl: base, width: 412, height: 915, mobile: true });
  await page.send('Emulation.setUserAgentOverride', { userAgent: androidUa });

  // Case 1: Startup timeout (>2500ms) + missing cookie -> #exitSessionRecoveryBtn MUST be
  // physically invisible, clicking it cannot degrade Android to guest home, and delayed
  // /api/health recovery with installed cookie mounts authenticated /language cleanly.
  healthDelayMs = 2900;
  installedAccessCookie = '';
  await page.navigate('/select');
  await page.waitFor("document.documentElement.dataset.bootState === 'recovering'", 8000, 'recovering state after timeout');
  const duringRecovery = await page.evaluate(`(() => {
    const recovery = document.getElementById('sessionRecovery');
    const exitBtn = document.getElementById('exitSessionRecoveryBtn');
    const guest = document.getElementById('navGuestActions');
    const r = exitBtn.getBoundingClientRect();
    return {
      recoveryHidden: recovery.classList.contains('hidden'),
      exitHidden: exitBtn.hidden,
      exitClassHidden: exitBtn.classList.contains('hidden'),
      exitDisplay: getComputedStyle(exitBtn).display,
      exitWidth: r.width,
      exitHeight: r.height,
      guestHidden: guest.classList.contains('hidden'),
    };
  })()`);
  assert.equal(duringRecovery.recoveryHidden, false);
  assert.equal(duringRecovery.exitHidden, true);
  assert.equal(duringRecovery.exitClassHidden, true);
  assert.equal(duringRecovery.exitDisplay, 'none');
  assert.equal(duringRecovery.exitWidth, 0);
  assert.equal(duringRecovery.exitHeight, 0);
  assert.equal(duringRecovery.guestHidden, true);

  // Even a synthetic click on the hidden exit button must not clear session or show login/register.
  await page.evaluate(`document.getElementById('exitSessionRecoveryBtn').click()`);
  await delay(150);
  assert.equal(await page.evaluate(`document.getElementById('navGuestActions').classList.contains('hidden')`), true);
  assert.equal(await page.evaluate(`document.getElementById('publicHome').classList.contains('hidden')`), true);
  console.log('PASS Case 1a: #exitSessionRecoveryBtn stays physically hidden and non-destructive on Android');

  // Case 2: Native session refresh installs the cookie, retry button recovers seamlessly
  // across /select, /language, and /tools with identical account 1234.
  healthDelayMs = 0;
  installedAccessCookie = credentials.access_token;
  await page.evaluate(`document.getElementById('retrySessionRecoveryBtn').click()`);
  await page.waitFor("document.getElementById('sessionRecovery').classList.contains('hidden') && !document.getElementById('accountMenu').classList.contains('hidden')", 8000, 'authenticated after retry');

  const homeState = await page.evaluate(`({
    guestHidden: document.getElementById('navGuestActions').classList.contains('hidden'),
    menuHidden: document.getElementById('accountMenu').classList.contains('hidden'),
    recoveryHidden: document.getElementById('sessionRecovery').classList.contains('hidden'),
    badge: document.getElementById('accountBadge').textContent,
    bootState: document.documentElement.dataset.bootState,
  })`);
  assert.equal(homeState.guestHidden, true);
  assert.equal(homeState.menuHidden, false);
  assert.equal(homeState.recoveryHidden, true);
  assert.equal(homeState.bootState, 'ready');
  assert.match(homeState.badge, /device1234/);
  console.log('PASS Case 1b: retry recovers into authenticated WebView home with zero guest UI');

  // Navigate to Learning (/language) and Tools (/tools) via WYJAndroidNavigation
  await page.evaluate(`window.WYJAndroidNavigation.navigate('/language')`);
  await page.waitFor("location.pathname === '/language' && !document.getElementById('projectPicker').classList.contains('hidden')", 5000, 'learning view');
  assert.equal(await page.evaluate(`document.getElementById('sessionRecovery').classList.contains('hidden')`), true);
  assert.equal(await page.evaluate(`document.getElementById('navGuestActions').classList.contains('hidden')`), true);

  await page.evaluate(`window.WYJAndroidNavigation.navigate('/tools')`);
  await page.waitFor("location.pathname === '/tools' && !document.getElementById('toolsPanel').classList.contains('hidden')", 5000, 'tools view');
  assert.equal(await page.evaluate(`document.getElementById('sessionRecovery').classList.contains('hidden')`), true);
  assert.equal(await page.evaluate(`document.getElementById('navGuestActions').classList.contains('hidden')`), true);
  console.log('PASS Case 2: Learning and Tools routes preserve unified Android identity without recovery loop');

  // Case 3: Slow health check (>2500ms) that succeeds at ~2.8s without user clicking retry
  // auto-completes splash -> recovery -> mounted authenticated page with zero flicker.
  healthDelayMs = 2800;
  await page.navigate('/language');
  await page.waitFor("!document.getElementById('sessionRecovery').classList.contains('hidden')", 5000, 'timeout recovery during slow startup');
  await page.waitFor("document.getElementById('sessionRecovery').classList.contains('hidden') && !document.getElementById('projectPicker').classList.contains('hidden')", 6000, 'auto-mount after slow health');
  assert.equal(await page.evaluate(`document.getElementById('navGuestActions').classList.contains('hidden')`), true);
  console.log('PASS Case 3: Slow boot auto-recovers into authenticated Learning route once /api/health settles');
} finally {
  try { await page?.close(); } catch {}
  // Chrome may exit before acknowledging Browser.close; bound teardown only.
  try { if(browser)await Promise.race([browser.send('Browser.close').catch(()=>undefined),delay(1000)]); } catch {}
  try { await browser?.close?.(); } catch {}
  child.kill();
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose();
  const resolvedProfile=path.resolve(profile);
  assert.ok(resolvedProfile.startsWith(path.resolve(os.tmpdir())+path.sep),'only remove this isolated temporary Chrome profile');
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries:5, retryDelay:200 });
}
