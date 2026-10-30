import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const label = process.env.AERIS_SPATIAL_LABEL;
assert(/^spatial-(before|after)-r[1-9][0-9]*$/.test(label || ''));
const origin = new URL(process.env.WYJ_TEST_BASE).origin;
const hosted = origin === 'https://ac8cec2c.thewyj-p07-ui-rc.pages.dev' && process.env.AERIS_OWNED_PREVIEW === 'true';
assert(hosted || origin === 'http://127.0.0.1:8898', 'Only owned fixtures may receive synthetic ledger writes');
if (!hosted) assert.equal(process.env.WYJ_CDP_URL, 'http://127.0.0.1:9238');
const attempt = process.env.AERIS_CI_FIXTURE_ATTEMPT;
assert(/^r[1-9][0-9]*$/.test(attempt || ''));
const manifest = hosted ? null : JSON.parse(await fs.readFile(path.join(root, `docs/migration-evidence/aeris-p03-p07/ci/browser-fixture-${attempt}.json`), 'utf8'));
if (!hosted) assert(manifest.no_remote_bindings && manifest.workers_ai_enabled === false && manifest.synthetic_admin);
const out = path.join(root, 'docs/migration-evidence/aeris-p03-p07', label);
await fs.mkdir(out, { recursive: false });
const pages = [], captures = [], checks = [], source = {};
for (const name of ['index.html', 'app.js', 'design-system.css', 'public-experience.css', 'workspace-experience.css', 'product-ui.css', 'styles.css', 'js/core/motion.js', 'js/core/home-widgets.js', 'spatial-experience.css']) {
  try { const raw = hosted ? execFileSync('git', ['show', '80139a03b5b655b4f4d7ba4e865778c7654bb91d:'+name], {cwd:root}) : await fs.readFile(path.join(root, manifest.output, name)); source[name] = { sha256: createHash('sha256').update(raw).digest('hex'), lines: raw.toString('utf8').split('\n').length }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const ready = page => page.waitFor("!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && document.getElementById('sessionRecovery').classList.contains('hidden')", 30000);
async function click(page, selector) {
  await page.send('Page.bringToFront');
  const point = await page.evaluate(`(async () => {const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.closest('[inert]'))throw Error('Unavailable '+${JSON.stringify(selector)});n.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(!r.width||!r.height||!h||!n.contains(h))throw Error('Hidden or occluded '+${JSON.stringify(selector)}+' '+JSON.stringify({rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:h?.id||h?.tagName,hiddenParent:n.closest('.hidden')?.id}));return {x,y};})()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
}
const key = async (page, name) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: name === 'Escape' ? 27 : 13, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: name === 'Escape' ? 27 : 13 });
};
async function makePage() {
  const page = await openPage({ cdpUrl: process.env.WYJ_CDP_URL, baseUrl: origin, width: 1440, height: 960 });
  pages.push(page);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete globalThis.__WYJ_TEST_MODE__;' });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  return page;
}
async function login(page) {
  await page.send('Page.bringToFront');
  await page.navigate('/login'); await ready(page);
  await page.waitFor("!document.getElementById('authPanel').classList.contains('hidden') && !document.getElementById('loginForm').classList.contains('hidden')", 30000);
  await page.waitFor("document.documentElement.dataset.p07Ui==='enabled'", 30000, 'chosen ON presentation has settled before geometry-based input');
  await page.setFields({ '#usernameInput': process.env.AERIS_SPATIAL_USERNAME || 'wyj', '#secretInput': process.env.WYJ_TEST_ADMIN_SECRET });
  await click(page, '#loginSubmitBtn');
  await page.waitFor("location.pathname==='/' && !document.getElementById('accountMenu').classList.contains('hidden')", 30000);
}
async function capture(page, name, route, width, theme, openLedger=false) {
  await page.send('Page.bringToFront');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 420 ? 844 : 960, deviceScaleFactor: 1, mobile: width <= 420 });
  await page.navigate(route); await ready(page);
  await page.waitFor("document.documentElement.dataset.p07Ui==='enabled'", 30000, 'actual authoritative UI decision for the visible page');
  if (route === '/finance') await page.waitFor("!document.getElementById('financePage').classList.contains('hidden') && document.getElementById('financeTransactionList').textContent.includes('AERIS V6.2 合成')", 30000);
  if (openLedger && !await page.evaluate("document.getElementById('financeRecordedSection').open")) {
    await click(page, '#financeRecordedSection > summary');
    await page.waitFor("document.getElementById('financeRecordedSection').open && [...document.querySelectorAll('[data-finance-transaction]')].filter(n=>n.getClientRects().length).length===3",30000);
  }
  await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);
  await delay(160);
  const geometry = await page.evaluate(`(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,policy:document.documentElement.dataset.p07Ui,testMode:globalThis.__WYJ_TEST_MODE__===true,cards:[...document.querySelectorAll('[data-home-widget]')].map(e=>({id:e.dataset.homeWidget,shown:e.getClientRects().length>0,transform:getComputedStyle(e).transform,visualLayers:e.querySelectorAll('.home-widget-visual').length}))}))()`);
  assert.equal(geometry.testMode, false); assert.equal(geometry.policy, 'enabled');
  assert(geometry.scrollWidth <= width + 1, `${name}: horizontal overflow ${geometry.scrollWidth}/${width}`);
  if (route === '/') assert.equal(geometry.cards.filter(row => row.shown).length, 3);
  const dimensions = await page.send('Page.getLayoutMetrics');
  const height = Math.min(6000, Math.ceil(dimensions.cssContentSize.height));
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
  captures.push({ name, route, theme, ...geometry, capturedHeight: height, actualDevice: false, staticCaptureReducedMotion: true });
}
try {
  const guest = await makePage(), member = await makePage();
  await guest.navigate('/'); await ready(guest);
  const rules = await guest.evaluate(`(() => {const rows=[];function visit(rules,file,scope=[]){for(const rule of rules){if(rule.selectorText&&rule.style){rows.push({file,scope:scope.join(' / '),selector:rule.selectorText,declarations:[...rule.style].map(name=>({name,value:rule.style.getPropertyValue(name),important:rule.style.getPropertyPriority(name)==='important'}))});}else if(rule.cssRules)visit(rule.cssRules,file,[...scope,rule.conditionText||rule.name||rule.constructor.name]);}}for(const sheet of document.styleSheets){if(sheet.href&&new URL(sheet.href).origin===location.origin)visit(sheet.cssRules,new URL(sheet.href).pathname);}return rows;})()`);
  const duplicates = new Map();
  for (const row of rules) { const k = `${row.scope}|${row.selector}`; if (!duplicates.has(k)) duplicates.set(k, []); duplicates.get(k).push(row); }
  const overlap = [...duplicates].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, rules: rows }));
  await fs.writeFile(path.join(out, 'css-cascade-audit.json'), JSON.stringify({ source, parsedBy: 'Actual Chromium CSSOM; conditional scopes retained', ruleCount: rules.length, repeatedSelectorGroups: overlap.length, importantDeclarations: rules.flatMap(row => row.declarations).filter(row => row.important).length, repeated: overlap }, null, 2));
  await login(member); await member.navigate('/finance'); await ready(member);
  await member.waitFor("!document.getElementById('financePage').classList.contains('hidden')", 30000);
  await member.waitFor("!document.getElementById('financeWorkspace').classList.contains('hidden')", 30000, 'actual finance owner initialized and workspace accessible');
  const existing = await member.evaluate("document.getElementById('financeTransactionList').textContent");
  if (!existing.includes('AERIS V6.2 合成')) {
    for (const [direction, amount, merchant] of [['income', '1800.00', 'AERIS V6.2 合成 · 收入样本'], ['expense', '68.40', 'AERIS V6.2 合成 · 餐饮样本'], ['refund', '9.20', 'AERIS V6.2 合成 · 退款样本']]) {
      await click(member, '#financeAddTransactionBtn'); await member.waitFor("!document.getElementById('financeTransactionModal').classList.contains('hidden')");
      await member.setFields({ '#financeTransactionDirection': direction, '#financeTransactionAmount': amount, '#financeTransactionTime': '2026-10-29T10:00', '#financeTransactionMerchant': merchant, '#financeTransactionNote': '隔离 Preview 合成记录，不是真实交易。' });
      await click(member, '#financeTransactionForm [type=submit]');
      await member.waitFor("document.getElementById('financeTransactionModal').classList.contains('hidden')", 30000);
      await member.waitFor(`document.getElementById('financeTransactionList').textContent.includes(${JSON.stringify(merchant)})`, 30000);
    }
  }
  checks.push({ id: 'synthetic-local-ledger-fixtures-through-real-form', status: 'PASS', currency: 'CNY', scope: hosted ? 'owned Preview separate registered validation user' : 'owned local fixture synthetic super-admin only', formalDataWrites: 0, providedBusinessEvidence: false });
  for (const width of [320, 375, 390, 420, 768, 1024, 1366, 1440, 1920]) {
    for (const theme of ['light', 'dark']) {
      for (const [page, route, name] of [[guest, '/', 'home'], [guest, '/login', 'login'], [member, '/finance', 'finance']]) {
        await capture(page, `${name}-${width}-${theme}`, route, width, theme);
      }
    }
    console.log(JSON.stringify({ width, captures: captures.length }));
  }
  for (const page of pages) { assert.deepEqual(page.runtimeErrors, []); assert.deepEqual(page.dialogs, []); }
  checks.push({ id: 'three-actual-pages-nine-widths-two-themes-no-overflow', status: 'PASS', captures: captures.length });
  await capture(member, 'finance-open-1440-light', '/finance', 1440, 'light', true);
  checks.push({id:'dense-ledger-opened-through-actual-disclosure',status:'PASS',visibleRows:3,additionalState:true,notUsedAsClosedStatePixelBaseline:true});
} catch (error) {
  checks.push({ id: 'audit-or-browser-failure', status: 'FAIL', error: String(error.stack).replaceAll(process.env.WYJ_TEST_ADMIN_SECRET || '<absent>', '<redacted>') });
  for (const [i, page] of pages.entries()) {
    try {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(out, `failure-page-${i}.png`), Buffer.from(shot.data, 'base64'));
      const state = await page.evaluate(`(() => ({path:location.pathname,innerWidth,innerHeight,visualHeight:visualViewport.height,scrollY,focus:document.activeElement?.id,elements:['projectApp','authPanel','loginForm','loginSubmitBtn','financePage','financeWorkspace','financeTransactionModal'].map(id=>{const n=document.getElementById(id),s=getComputedStyle(n),r=n.getBoundingClientRect();return {id,class:n.className,hidden:n.hidden,inert:n.inert,display:s.display,visibility:s.visibility,pointerEvents:s.pointerEvents,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};})}))()`);
      await fs.writeFile(path.join(out, `failure-page-${i}.json`), JSON.stringify(state, null, 2));
    } catch {}
  }
}
finally {
  for (const page of pages) await page.close().catch(() => {});
  const result = { label, origin, environment: hosted ? 'HOSTED_OWNED_PREVIEW_SYNTHETIC_VALIDATION_LEDGER' : 'ACTUAL_LOCAL_CLOUDFLARE_SYNTHETIC_FIXTURE', source, checks, captures, pass: checks.filter(r => r.status === 'PASS').length, fail: checks.filter(r => r.status === 'FAIL').length, externalAiCalls: 0, realFinancialWrites: 0, deviceClaims: false };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output: path.relative(root, out), captures: captures.length, fail: result.fail }));
  if (result.fail) process.exitCode = 1;
}
