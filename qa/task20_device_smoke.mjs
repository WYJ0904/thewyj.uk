// Requires an already signed-in isolated fixture on a USB-authorized physical device.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { authVisibilityProbe } from './task20_ui_probe.mjs';

const exec = promisify(execFile);
const adb = process.env.ADB || 'adb';
const serial = process.env.ANDROID_SERIAL;
const base = process.env.TASK20_PREVIEW_URL;
const expectedAccount = process.env.TASK20_FIXTURE_USER_ID;
const pkg = 'uk.thewyj.app.debug';
assert(serial && expectedAccount && /^https:\/\/[a-z0-9.-]+\.pages\.dev$/.test(base || ''),
  'Explicit physical device, Preview origin and isolated fixture ID are required');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const runAdb = async (...args) => (await exec(adb, ['-s', serial, ...args], { timeout: 20000 })).stdout.trim();
async function until(check, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* A document/process may be changing. */ }
    await delay(150);
  }
  throw new Error('Physical device state did not settle');
}
async function connect() {
  const pid = await runAdb('shell', 'pidof', pkg);
  assert(/^\d+$/.test(pid));
  const port = await runAdb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`);
  let tab;
  try {
    await until(async () => {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
      tab = tabs.find(t => t.type === 'page' && t.url.startsWith(`${base}/`));
      return Boolean(tab);
    });
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const pending = new Map();
    const documents = [];
    const authRequests = [];
    let id = 0;
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) {
        documents.push(new URL(message.params.frame.url).pathname);
      }
      if (message.method === 'Network.requestWillBeSent') {
        const path = new URL(message.params.request.url).pathname;
        if (['/api/me', '/api/status', '/api/health', '/api/app/session/refresh'].includes(path)) authRequests.push(path);
      }
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timeout`)); }, 20000);
      pending.set(key, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, 'WebView evaluation failed');
      return result.result.value;
    };
    await command('Page.enable');
    await command('Network.enable');
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `(${authVisibilityProbe.toString()})();` });
    await until(() => evaluate(`location.origin===${JSON.stringify(base)} && document.readyState==='complete'`));
    return { documents, authRequests, evaluate, close: async () => { ws.close(); await runAdb('forward', '--remove', `tcp:${port}`); } };
  } catch (error) { await runAdb('forward', '--remove', `tcp:${port}`); throw error; }
}
async function verifyIdentity(connection) {
  await until(() => connection.evaluate(`(() => {
    const recovery=document.getElementById('sessionRecovery');
    return recovery?.classList.contains('hidden') && document.getElementById('appShell')?.classList.contains('app-shell-ready');
  })()`));
  const state = await connection.evaluate(`(async()=>{
    const r=await fetch('/api/app/session');const d=await r.json();
    const probe=document.createElement('div');probe.style.cssText='position:fixed;visibility:hidden;height:100dvh;width:1px';document.body.append(probe);
    const cssViewport=probe.getBoundingClientRect().height;probe.remove();
    return {status:r.status,id:d.account?.id,code:d.code,cssViewport,visualHeight:visualViewport.height,
      readableCookie:document.cookie.includes('wyj_app_access'),
      storedToken:Boolean(localStorage.getItem('wyjAccountSession')||localStorage.getItem('vocabSession')),
      overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.equal(state.status, 200, state.code);
  assert.equal(state.id, expectedAccount, 'Native/Web account ownership changed');
  assert.equal(state.readableCookie, false);
  assert.equal(state.storedToken, false);
  assert.equal(state.overflow, false);
  assert.ok(state.cssViewport > 100, 'Android WebView CSS viewport collapsed to zero');
  assert.ok(Math.abs(state.cssViewport-state.visualHeight)<3, 'CSS and visible viewport diverged');
}
async function tapNavigation(label) {
  // Read current semantic bounds, never rely on one model's screen resolution.
  await runAdb('shell', 'uiautomator', 'dump', '/data/local/tmp/thewyj-task20-smoke.xml');
  const xml = await runAdb('shell', 'cat', '/data/local/tmp/thewyj-task20-smoke.xml');
  const nodes = xml.match(/<node\b[^>]+>/g) || [];
  const node = nodes.findLast(n => n.includes(`text="${label}"`) && n.includes(`package="${pkg}"`));
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node || '');
  assert(bounds, 'Native navigation target missing');
  const [, x1, y1, x2, y2] = bounds.map(Number);
  await runAdb('shell', 'input', 'tap', String(Math.round((x1+x2)/2)), String(Math.round((y1+y2)/2)));
}
async function nativeRefreshCount() {
  const log = await runAdb('logcat', '-d', '-s', 'ThewyjSession:I', '*:S');
  return (log.match(/POST \/api\/app\/session\/refresh HTTP/g) || []).length;
}
let connection;
try {
  connection = await connect();
  await verifyIdentity(connection);
  const refreshes = await nativeRefreshCount();
  for (const [label, route] of [['工具','/tools'],['学习','/language'],['财务','/finance'],['主页','/select'],['工具','/tools'],['财务','/finance']]) {
    connection.documents.length = 0;
    connection.authRequests.length = 0;
    await connection.evaluate(`(${authVisibilityProbe.toString()})();`);
    await tapNavigation(label);
    await until(() => connection.evaluate(`(location.pathname===${JSON.stringify(route)} || (${JSON.stringify(route)}==='/tools' && !document.getElementById('membershipModal').classList.contains('hidden'))) && document.readyState==='complete'`));
    await verifyIdentity(connection);
    // Observation window for an unwanted follow-up reload, not a product delay.
    await delay(1800);
    assert.deepEqual(connection.documents, [], 'Warm navigation must not load a main document');
    // Periodic status polling is independent of routing; /api/me and refresh are not.
    assert.equal(connection.authRequests.filter(path => ['/api/me', '/api/app/session/refresh'].includes(path)).length, 0, 'Warm navigation reauthenticated');
    const frames = await connection.evaluate('window.__qa20AuthFrames');
    assert.ok(frames?.frames > 0, 'Visible-frame observer missing');
    assert.equal(frames.loginFrames, 0, JSON.stringify({route,frames}));
    assert.equal(frames.guestFrames, 0, JSON.stringify({route,frames}));
    assert.equal(frames.restoringFrames, 0, 'Warm navigation showed a recovery/loading screen');
    assert.ok(frames.events.some(event => event.state === 'content'), 'Target content never became visible');
    results.push({ test:`navigate:${route}`, passed:true, documentLoads:0, authRequests:connection.authRequests, frames });
  }
  const marker = String(Date.now());
  await connection.evaluate(`window.__qa20PageMarker=${JSON.stringify(marker)}`);
  connection.documents.length = 0;
  await runAdb('shell','input','keyevent','KEYCODE_HOME');
  await delay(1200);
  await runAdb('shell','am','start','-W','-n',`${pkg}/uk.thewyj.app.MainActivity`);
  await verifyIdentity(connection);
  assert.equal(await connection.evaluate('window.__qa20PageMarker'), marker);
  assert.deepEqual(connection.documents, []);
  assert.equal(await nativeRefreshCount(), refreshes, 'Ordinary navigation/foreground must not rotate credentials');
  results.push({ test:'home-return-no-reload', passed:true });
  await connection.close(); connection = null;

  for (const mode of ['kill', 'force-stop']) {
    const previousPid = await runAdb('shell','pidof',pkg);
    await runAdb('shell','input','keyevent','KEYCODE_HOME');
    await delay(1000);
    await runAdb('shell','am',mode,'--user','0',pkg);
    await runAdb('shell','am','start','-W','-n',`${pkg}/uk.thewyj.app.MainActivity`);
    connection = await connect();
    assert.notEqual(await runAdb('shell','pidof',pkg), previousPid, 'Process was not recreated');
    await verifyIdentity(connection);
    results.push({ test:`${mode}-restore-same-account`, passed:true });
    await connection.close(); connection = null;
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  if (connection) await connection.close();
  await runAdb('shell','rm','-f','/data/local/tmp/thewyj-task20-smoke.xml');
  if (process.env.TASK20_REPORT) await writeFile(process.env.TASK20_REPORT, JSON.stringify({ results }, null, 2));
}
