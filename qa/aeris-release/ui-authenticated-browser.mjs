import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';
import { openZoomedBrowser } from './ui-browser-zoom.mjs';

// Actual local registration/login, server policy and DOM/AX evidence. The only
// management writes are the isolated fixture P07 flag and a fresh user's P07
// override. Both are restored. There are no finance/payment/AI/role writes.
const origin = new URL(process.env.WYJ_BASE_URL || process.env.WYJ_TEST_BASE || '').origin;
const cdp = process.env.WYJ_CDP_URL;
const localFixture = origin === 'http://127.0.0.1:8898' && cdp === 'http://127.0.0.1:9238';
const ciFixture = process.env.CI === 'true' && origin === 'http://127.0.0.1:8894' && cdp === 'http://127.0.0.1:9225';
assert(localFixture || ciFixture, 'Only the two explicit paired loopback fixtures are allowed; CI pair additionally requires CI=true');
const adminName = process.env.WYJ_TEST_ADMIN_USERNAME || (ciFixture ? 'wyj' : '');
const adminId = ciFixture ? 'task15-ci-super-admin' : 'aeris-ui-qa-super-admin';
assert(process.env.WYJ_TEST_ADMIN_SECRET && adminName, 'Synthetic fixture credentials required in child environment');
const root = path.resolve(import.meta.dirname, '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.env.AERIS_UI_AUTH_EVIDENCE_DIR || path.join(root, 'docs/migration-evidence/aeris-p03-p07', `ui-auth-actual-${stamp}`));
await fs.mkdir(path.dirname(out), { recursive: true }); await fs.mkdir(out, { recursive: false });
// Browser profiles contain local synthetic sessions. Keep them outside report
// upload globs (including artifacts/) and outside the allowlisted Pages output.
const privateZoomRoot = path.join(root, '.wrangler', `aeris-private-ui-zoom-${stamp}`);
await fs.mkdir(privateZoomRoot, { recursive: false });
const username = `aeris_ui_${randomBytes(6).toString('hex')}`;
const secret = randomBytes(28).toString('base64url');
const secrets = [secret, process.env.WYJ_TEST_ADMIN_SECRET];
const scrub = value => secrets.reduce((text, credential) => text.replaceAll(credential, '<redacted>'), String(value));
const checks = [], captures = [], pages = [], mutations = [];
const localNoticeClosures = [];
const zoomRuntimeErrors = [], zoomDialogs = [];
let admin, user, guest, ordinary = null, originalFlag = null, originalOthers = null, overrideChanged = false;
let policyRestored = false, overrideRestored = false;
const writeProgress = async () => fs.writeFile(path.join(out, 'progress.json'), JSON.stringify({ checks, captures, mutations }, null, 2));
const check = async (id, run) => {
  try { checks.push({ id, status: 'PASS', actual: await run() }); }
  catch (error) { checks.push({ id, status: 'FAIL', error: scrub(error.stack) }); }
  await writeProgress(); console.log(JSON.stringify({ id, status: checks.at(-1).status }));
};
const key = async (page, name, modifiers = 0, code = name) => {
  const vk = { Enter: 13, Tab: 9, Escape: 27, Home: 36, End: 35, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Equal: 187, Digit0: 48 }[code];
  const input = { key: name, code, modifiers, ...(vk ? { windowsVirtualKeyCode: vk } : {}) };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...input, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...input });
};
const click = async (page, selector) => {
  const point = await page.evaluate(String.raw`(() => {
    const node=document.querySelector(${JSON.stringify(selector)});
    if(!node || node.disabled || node.closest('[inert]')) throw new Error('Unavailable control '+${JSON.stringify(selector)});
    node.scrollIntoView({block:'center',behavior:'instant'});
    const rect=node.getBoundingClientRect(), style=getComputedStyle(node);
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2,hit=document.elementFromPoint(x,y);
    if(!rect.width || !rect.height || style.visibility!=='visible' || !hit || !node.contains(hit)) throw new Error('Hidden or occluded control '+${JSON.stringify(selector)}+' '+JSON.stringify({rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},hit:hit?.id||hit?.tagName,menuOpen:document.getElementById('accountMenu')?.open,openDialogs:[...document.querySelectorAll('[role=dialog],dialog')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility==='visible').map(n=>n.id)}));
    return {x,y};
  })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point });
};
const ready = page => page.waitFor("!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && document.getElementById('sessionRecovery').classList.contains('hidden')", 30000, 'visible initialized application');
async function makePage() {
  const page = await openPage({ cdpUrl: cdp, baseUrl: origin, width: 1440, height: 960, mobile: false }); pages.push(page);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete globalThis.__WYJ_TEST_MODE__;' });
  await page.send('Accessibility.enable'); return page;
}
async function api(page, route, payload, expected = 200) {
  assert(/^\/api\/(?:me|features|ui\/features|admin\/users|admin\/feature-flags(?:\/override)?)$/.test(route), 'Explicit UI-test route allowlist');
  const result = await page.evaluate(String.raw`(async () => {
    const token=localStorage.getItem('wyjAccountSession');
    const response=await fetch(${JSON.stringify(route)},{method:${JSON.stringify(payload === undefined ? 'GET' : 'POST')},cache:'no-store',
      headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},
      ${payload === undefined ? '' : `body:${JSON.stringify(JSON.stringify(payload))},`}credentials:'same-origin'});
    return {status:response.status,body:await response.json()};
  })()`);
  assert.equal(result.status, expected, `${route}: unexpected status ${result.status} (${result.body.code || 'no code'})`);
  return result.body;
}
async function login(page, name, credential) {
  await page.navigate('/login'); await ready(page);
  await page.setFields({ '#usernameInput': name, '#secretInput': credential }); await click(page, '#loginSubmitBtn');
  await page.waitFor("location.pathname==='/' && !document.getElementById('accountMenu').classList.contains('hidden') && document.getElementById('sessionRecovery').classList.contains('hidden')", 30000, 'actual authenticated home');
  await settleLocalNotices(page);
}
async function settleLocalNotices(page) {
  // Prior local Task18 acceptance may send a notice to its synthetic admin.
  // Close only a normal, dismissible local notice through its real UI. Never
  // click behind a modal or acknowledge a confirmation-only notice.
  for (let index = 0; index < 10; index++) {
    const state = await page.evaluate("({open:!document.getElementById('siteMessageModal').classList.contains('hidden'),confirmOnly:!document.getElementById('siteMessageAcknowledgeBtn').classList.contains('hidden'),canClose:!document.getElementById('siteMessageCloseBtn').classList.contains('hidden')&&!document.getElementById('siteMessageCloseBtn').disabled})");
    if (!state.open) return;
    assert(!state.confirmOnly && state.canClose, 'A required local message needs separate acceptance; no underlying control clicked');
    await click(page, '#siteMessageCloseBtn'); localNoticeClosures.push({ scope: 'owned_local_fixture_only', action: 'close_non_required_notice', explicitConfirmation: false });
    await page.waitFor("document.getElementById('siteMessageModal').classList.contains('hidden') || !document.getElementById('siteMessageCloseBtn').disabled", 30000, 'local notice close result');
    await delay(120);
  }
  throw new Error('Local notice queue did not settle; no underlying control clicked');
}
async function capture(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(result.data, 'base64'));
  const tree = await page.send('Accessibility.getFullAXTree');
  const ax = tree.nodes.filter(node => !node.ignored).map(node => ({ role: node.role?.value || '', name: scrub(node.name?.value || ''),
    properties: Object.fromEntries((node.properties || []).filter(property => ['focusable', 'focused', 'disabled', 'selected', 'expanded', 'required', 'invalid', 'busy', 'live', 'atomic', 'modal'].includes(property.name)).map(property => [property.name, property.value.value])) }));
  await fs.writeFile(path.join(out, `${name}-ax.json`), JSON.stringify(ax, null, 2));
  const geometry = await page.evaluate(String.raw`(() => {
    const visible=node=>node.getClientRects().length && getComputedStyle(node).visibility==='visible' && !node.closest('[aria-hidden="true"],[inert]');
    const controls=[...document.querySelectorAll('button,a[href],summary,input:not([type=hidden]),select,textarea')].filter(visible);
    const focus=document.activeElement, focusRect=focus.getBoundingClientRect(), focusStyle=getComputedStyle(focus);
    return {path:location.pathname,policy:document.documentElement.dataset.p07Ui,theme:document.documentElement.dataset.theme,testMode:globalThis.__WYJ_TEST_MODE__===true,innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,pageScale:visualViewport.scale,cssZoom:getComputedStyle(document.documentElement).zoom,scrollWidth:document.documentElement.scrollWidth,
      focus:{id:focus.id,top:focusRect.top,bottom:focusRect.bottom,outlineStyle:focusStyle.outlineStyle,outlineWidth:parseFloat(focusStyle.outlineWidth)},
      unlabeled:controls.filter(node=>node.matches('input,select,textarea') && !(node.labels?.length || node.getAttribute('aria-label') || node.getAttribute('aria-labelledby'))).map(node=>node.id),
      clipped:controls.filter(node=>{const r=node.getBoundingClientRect();return r.x< -1 || r.right>innerWidth+1;}).map(node=>node.id||node.tagName)};
  })()`);
  const row = { name, screenshot: `${name}.png`, ax: `${name}-ax.json`, ...geometry }; captures.push(row); return { row, ax };
}
async function currentFlag() {
  const result = await api(admin, '/api/admin/feature-flags');
  const flag = result.flags.find(value => value.flag_key === 'p07_accessibility'); assert(flag); return { flag, others: result.flags.filter(value => value.flag_key !== flag.flag_key) };
}
async function saveFlag(patch) {
  const { flag } = await currentFlag();
  const payload = { flag_key: flag.flag_key, description: flag.description, enabled: flag.enabled, kill_switch: flag.kill_switch,
    channels: flag.channels, rollout_percentage: flag.rollout_percentage, expected_revision: flag.revision, ...patch };
  assert.equal(payload.flag_key, 'p07_accessibility');
  const result = await api(admin, '/api/admin/feature-flags', payload);
  mutations.push({ target: 'local_p07_flag', enabled: result.flag.enabled, kill_switch: result.flag.kill_switch, revision: result.flag.revision });
  return result.flag;
}
async function override(enabled) {
  const { flag } = await currentFlag(); assert(ordinary?.id);
  await api(admin, '/api/admin/feature-flags/override', { flag_key: flag.flag_key, user_id: ordinary.id, enabled, expected_revision: flag.revision });
  mutations.push({ target: 'new_local_ordinary_user_p07_override', enabled }); overrideChanged = enabled !== null;
}
async function accountRefresh(page) {
  await page.navigate('/account'); await ready(page); await page.waitFor("!document.getElementById('accountModal').classList.contains('hidden')");
  await click(page, '#refreshReleaseChannelBtn');
}
async function waitPolicy(page, enabled, label) {
  await page.waitFor(`document.documentElement.dataset.p07Ui===${JSON.stringify(enabled ? 'enabled' : 'disabled')}`, 35000, label);
}

try {
  if (localFixture) {
    const fixtureAttempt = process.env.AERIS_CI_FIXTURE_ATTEMPT || 'r3';
    assert.match(fixtureAttempt, /^r[1-9][0-9]*$/);
    const fixtureSuffix = fixtureAttempt === 'r1' ? '' : `-${fixtureAttempt}`;
    const manifest = JSON.parse(await fs.readFile(path.join(root, `docs/migration-evidence/aeris-p03-p07/ci/browser-fixture${fixtureSuffix}.json`), 'utf8'));
    assert(manifest.no_remote_bindings && manifest.synthetic_admin && manifest.workers_ai_enabled === false);
  }
  const status = await fetch(`${origin}/api/status?source=cloud`).then(response => response.json()); assert.equal(status.environment, 'development'); assert.equal(status.ai_ready, false);
  guest = await makePage(); await guest.navigate('/login'); await ready(guest);
  await check('guest-real-global-on-and-accessible-login', async () => {
    const decision = await api(guest, '/api/ui/features'); assert.equal(decision.public_ui.enabled, true); await waitPolicy(guest, true, 'real guest public decision');
    const privateResult = await api(guest, '/api/features', undefined, 401); assert.equal(privateResult.ok, false);
    const { row, ax } = await capture(guest, 'guest-login-initial');
    assert.equal(row.testMode, false); assert.deepEqual(row.unlabeled, []); assert(ax.some(node => node.role === 'tab' && node.name === '登录' && node.properties.selected));
    assert(ax.some(node => node.role === 'tab' && node.name === '注册')); assert.equal(row.policy, 'enabled'); return { serverReason: decision.public_ui.reason, privateRouteStatus: 401, accessibleControls: true };
  });

  user = await makePage(); admin = await makePage();
  await check('ordinary-real-registration-error-recovery-and-login', async () => {
    await user.navigate('/register'); await ready(user);
    const answers = user.watchResponses('/api/register');
    await user.setFields({ '#registerUsernameInput': username, '#registerSecretInput': secret, '#registerConfirmInput': secret + 'x' });
    await click(user, '#registerSubmitBtn');
    await user.waitFor("document.getElementById('loginError').textContent.includes('不一致')", 20000, 'actual registration mismatch error');
    assert(answers.statuses().includes(400));
    const error = await capture(user, 'ordinary-register-mismatch'); assert(error.ax.some(node => node.role === 'status'));
    await user.setFields({ '#registerConfirmInput': secret }); await click(user, '#registerSubmitBtn');
    await user.waitFor("location.pathname==='/login' && document.getElementById('loginError').textContent.includes('注册成功')", 30000, 'real registration201 success');
    assert(answers.statuses().includes(201)); await click(user, '#loginSubmitBtn');
    await user.waitFor("location.pathname==='/' && !document.getElementById('accountMenu').classList.contains('hidden')", 30000, 'ordinary real login');
    ordinary = (await api(user, '/api/me')).account; assert.equal(ordinary.username, username); assert.equal(Boolean(ordinary.is_admin), false); await settleLocalNotices(user);
    await waitPolicy(user, true, 'ordinary actual Task25 decision');
    return { statuses: answers.statuses(), newLocalAccount: true, normalRole: true, noPrivilegeMutation: true };
  });
  assert(ordinary, 'Ordinary authentication is required for remaining role tests');
  await check('ordinary-admin-denial-and-account-modal-ax', async () => {
    assert.equal(await user.evaluate("document.getElementById('adminBtn').classList.contains('hidden')"), true);
    assert.equal((await api(user, '/api/admin/users', undefined, 403)).ok, false);
    await user.navigate('/admin'); await ready(user); await user.waitFor("location.pathname==='/' && document.getElementById('adminPanel').classList.contains('hidden')");
    await user.navigate('/account'); await ready(user); await user.waitFor("!document.getElementById('accountModal').classList.contains('hidden')");
    const { row, ax } = await capture(user, 'ordinary-account-initial'); assert.deepEqual(row.unlabeled, []);
    assert(ax.some(node => node.role === 'dialog' && node.name === '账户设置' && node.properties.modal));
    assert(ax.some(node => node.name === '当前登录密钥')); assert(ax.some(node => node.name === '新登录密钥（至少 7 个字符）'));
    return { hiddenAdminEntry: true, actualServer403: true, actualRouteDenied: true, namedDialog: true };
  });
  await check('ordinary-feedback-real-empty-loading-fault-and-retry', async () => {
    await key(user, 'Escape'); await user.waitFor("document.getElementById('accountModal').classList.contains('hidden')");
    await user.navigate('/'); await ready(user); await click(user, '#accountMenu > summary'); await click(user, '#feedbackBtn');
    await user.waitFor("!document.getElementById('feedbackModal').classList.contains('hidden') && document.getElementById('myFeedbackList').getAttribute('aria-busy')==='false'");
    await click(user, '#feedbackMineTab');
    assert((await user.evaluate("document.getElementById('myFeedbackList').textContent")).includes('你还没有提交反馈'));
    const empty = await capture(user, 'ordinary-feedback-empty'); assert(empty.ax.some(node => node.role === 'status'));
    let release; const pending = new Promise(resolve => release = resolve); let mode = 'hold', faults = 0;
    await user.intercept([{ match: '/api/feedback/mine', respond: async () => {
      if (mode === 'hold') { await pending; return { continue: true }; }
      if (mode === 'error') { faults++; return { status: 400, body: { ok: false, error: '隔离 UI 故障：读取反馈失败，请重试。', code: 'synthetic_ui_read_failure' } }; }
      return { continue: true };
    } }]);
    await click(user, '#refreshMyFeedbackBtn'); await user.waitFor("document.getElementById('myFeedbackList').getAttribute('aria-busy')==='true'");
    const loading = await capture(user, 'ordinary-feedback-loading'); assert(loading.ax.some(node => node.role === 'status' && node.properties.busy));
    mode = 'pass'; release(); await user.waitFor("document.getElementById('myFeedbackList').getAttribute('aria-busy')==='false'");
    mode = 'error'; await click(user, '#refreshMyFeedbackBtn');
    await user.waitFor("document.getElementById('myFeedbackList').textContent.includes('隔离 UI 故障') && document.getElementById('myFeedbackList').getAttribute('aria-busy')==='false'");
    await capture(user, 'ordinary-feedback-synthetic-http-error');
    mode = 'pass'; await click(user, '#refreshMyFeedbackBtn');
    await user.waitFor("document.getElementById('myFeedbackList').textContent.includes('你还没有提交反馈') && document.getElementById('myFeedbackList').getAttribute('aria-busy')==='false'");
    await key(user, 'Escape'); await user.waitFor("document.getElementById('feedbackModal').classList.contains('hidden')");
    return { realEmptyResult: true, loadingBusyInAX: true, injectedHttp400: faults, errorRecoveredWithRealServer: true, feedbackWrites: 0 };
  });

  await check('actual-synthetic-admin-login-role-tabs-and-ax', async () => {
    await login(admin, adminName, process.env.WYJ_TEST_ADMIN_SECRET);
    const actor = (await api(admin, '/api/me')).account; assert.equal(actor.id, adminId); assert.equal(actor.is_admin, true);
    await admin.navigate('/admin'); await ready(admin);
    await admin.waitFor("document.getElementById('adminPanel').getAttribute('aria-busy')==='false' && document.querySelectorAll('#adminUserList [data-user-id]').length>0");
    await waitPolicy(admin, true, 'administrator actual Task25 decision');
    await admin.evaluate("document.getElementById('adminUsersTab').focus()"); await key(admin, 'End');
    assert.equal(await admin.evaluate('document.activeElement.id'), 'adminFeatureFlagsTab');
    await key(admin, 'Home'); assert.equal(await admin.evaluate('document.activeElement.id'), 'adminUsersTab');
    const { row, ax } = await capture(admin, 'admin-users-initial'); assert.deepEqual(row.unlabeled, []);
    assert(ax.some(node => node.role === 'tablist' && node.name === '后台视图'));
    assert(ax.some(node => node.role === 'tab' && node.name === '用户' && node.properties.selected));
    const flags = await currentFlag(); originalFlag = flags.flag; originalOthers = flags.others;
    return { actor: 'owned_synthetic_admin', actualAdminDataLoaded: true, keyboardHomeEnd: true, namedSelectedTab: true, userAndRightsWrites: 0 };
  });
  assert(originalFlag, 'Administrator authentication required for isolated policy restoration');
  await check('admin-real-empty-filter-loading-error-retains-rows-and-recovers', async () => {
    let release; const pending = new Promise(resolve => release = resolve); let mode = 'hold', faults = 0;
    await admin.intercept([{ match: '/api/admin/users', respond: async () => {
      if (mode === 'hold') { await pending; return { continue: true }; }
      if (mode === 'error') { faults++; return { status: 400, body: { ok: false, error: '隔离 UI 故障：用户列表读取失败。', code: 'synthetic_ui_admin_read_failure' } }; }
      return { continue: true };
    } }]);
    await admin.setFields({ '#adminUserSearch': `no_match_${randomBytes(8).toString('hex')}` });
    await admin.waitFor("document.getElementById('adminUserList').getAttribute('aria-busy')==='true'"); await capture(admin, 'admin-filter-loading');
    mode = 'pass'; release();
    await admin.waitFor("document.getElementById('adminUserList').textContent.includes('没有匹配的用户') && document.getElementById('adminUserList').getAttribute('aria-busy')==='false'");
    await capture(admin, 'admin-filter-real-empty');
    await admin.setFields({ '#adminUserSearch': '' }); await admin.waitFor("document.querySelectorAll('#adminUserList [data-user-id]').length>0 && document.getElementById('adminUserList').getAttribute('aria-busy')==='false'");
    const count = await admin.evaluate("document.querySelectorAll('#adminUserList [data-user-id]').length");
    mode = 'error'; await click(admin, '#refreshAdminBtn');
    await admin.waitFor("document.getElementById('adminError').textContent.includes('隔离 UI 故障') && !document.getElementById('refreshAdminBtn').disabled");
    assert.equal(await admin.evaluate("document.querySelectorAll('#adminUserList [data-user-id]').length"), count);
    await capture(admin, 'admin-synthetic-http-error-retains-data');
    mode = 'pass'; await click(admin, '#refreshAdminBtn'); await admin.waitFor("!document.getElementById('adminError').textContent && document.getElementById('adminPanel').getAttribute('aria-busy')==='false'");
    return { realEmptySearch: true, syntheticHttp400: faults, retainedRows: count, actualServerRefreshRecovered: true, adminDataWrites: 0 };
  });

  await check('three-real-roles-two-themes-actual-browser-100-200-400-percent-zoom-and-ax', async () => {
    let count = 0; const metrics = [], baseline = new Map();
    for (const factor of [1, 2, 4]) {
      let page;
      try {
        page = await openZoomedBrowser(factor, path.join(privateZoomRoot, `browser-zoom-${factor * 100}`), origin);
        for (const role of ['guest', 'ordinary', 'admin']) {
          if (role === 'guest') await page.navigate('/login');
          if (role === 'ordinary') { await login(page, username, secret); await page.navigate('/account'); }
          if (role === 'admin') {
            await key(page, 'Escape'); await page.waitFor("document.getElementById('accountModal').classList.contains('hidden')");
            await click(page, '#accountMenu > summary'); await click(page, '#logoutBtn'); await page.waitFor("document.getElementById('accountMenu').classList.contains('hidden')");
            await login(page, adminName, process.env.WYJ_TEST_ADMIN_SECRET); await page.navigate('/admin');
            await page.waitFor("document.getElementById('adminPanel').getAttribute('aria-busy')==='false'");
          }
          await ready(page); await waitPolicy(page, true, `${role} real policy at actual browser zoom`);
          for (const theme of ['light', 'dark']) {
            const field = {guest:'usernameInput',ordinary:'currentSecretInput',admin:'adminUserSearch'}[role];
            await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById(${JSON.stringify(field)}).focus();true`);
            await key(page, 'Tab'); await delay(120);
            const { row } = await capture(page, `${role}-browser-zoom-${factor * 100}-${theme}`);
            assert.equal(row.testMode, false, 'Actual application runtime, without mock session bindings');
            metrics.push({ role, factor, ...page.zoom, actual: { width: row.innerWidth, height: row.innerHeight, outerWidth: row.outerWidth, outerHeight: row.outerHeight, dpr: row.dpr, pageScale: row.pageScale, cssZoom: row.cssZoom } });
            if (factor === 1) baseline.set(role, row);
            const normal = baseline.get(role); assert(normal);
            assert(Math.abs(row.dpr / normal.dpr - factor) < .01, 'Measured DPR must prove real browser zoom');
            assert(Math.abs(row.innerWidth * factor - normal.innerWidth) <= 3, 'Measured layout viewport must shrink with real zoom');
            assert.equal(row.pageScale, 1, 'No pinch scale substitution'); assert.equal(row.cssZoom, '1', 'No CSS zoom substitution');
            assert(row.scrollWidth <= row.innerWidth + 1, `${role} ${factor * 100}% ${theme}: horizontal document overflow`);
            assert.deepEqual(row.unlabeled, [], `${role} ${factor * 100}% ${theme}: unlabelled control`);
            assert.deepEqual(row.clipped, [], `${role} ${factor * 100}% ${theme}: clipped interactive target`);
            assert(row.focus.top >= -1 && row.focus.bottom <= row.innerHeight + 1, `${role} ${factor * 100}% ${theme}: keyboard focus obscured vertically`);
            assert(row.focus.outlineStyle !== 'none' && row.focus.outlineWidth >= 2, `${role} ${factor * 100}% ${theme}: keyboard focus indicator missing`);
            count++;
          }
        }
      } finally { if (page) { zoomRuntimeErrors.push(...page.runtimeErrors); zoomDialogs.push(...page.dialogs); await page.close(); } }
    }
    return { captures: count, roles: ['guest', 'ordinary', 'administrator'], themes: ['light', 'dark'], metrics,
      mechanism: 'Actual Chromium HostZoomMap initialized from new owned profile default zoom; no CDP metrics, page-scale/pinch or CSS zoom', existingProfilesTouched: 0, profilesDeleted: 0, privateProfilesOutsideReportsAndUploads: true };
  });

  await check('authenticated-account-off-cannot-be-overridden-by-public-on', async () => {
    await override(false); await accountRefresh(user); await waitPolicy(user, false, 'real ordinary override OFF');
    const snapshot = (await api(user, '/api/features')).snapshot, publicPolicy = (await api(guest, '/api/ui/features')).public_ui;
    assert.equal(snapshot.account_id, ordinary.id); assert.equal(snapshot.flags.p07_accessibility.reason, 'user_override'); assert.equal(snapshot.flags.p07_accessibility.enabled, false);
    assert.equal(publicPolicy.enabled, true); await waitPolicy(guest, true, 'guest still follows public ON');
    await user.navigate('/'); await ready(user); assert.equal(await user.evaluate("document.documentElement.dataset.p07Ui"), 'disabled');
    await click(user, '#accountMenu > summary'); await click(user, '#logoutBtn'); await user.waitFor("document.getElementById('accountMenu').classList.contains('hidden')");
    await waitPolicy(user, true, 'logout restores fresh real public authority');
    await login(user, username, secret); await waitPolicy(user, false, 'new login again uses account OFF');
    await override(null); overrideRestored = true; await accountRefresh(user); await waitPolicy(user, true, 'inherit restores real account ON');
    return { guestOnAndAccountOffCoexist: true, logoutGuestOn: true, subsequentLoginStillOff: true, overrideRestoredToInherit: true };
  });
  await check('real-global-off-refresh-fence-and-recovery', async () => {
    const started = Date.now(); await saveFlag({ enabled: false, kill_switch: false });
    const policy = (await api(guest, '/api/ui/features')).public_ui; assert.equal(policy.reason, 'global_off'); assert.equal(policy.enabled, false);
    await Promise.all([waitPolicy(guest, false, 'live guest automatic renewal observes global OFF'), waitPolicy(user, false, 'live ordinary renewal observes global OFF')]);
    const disabledAfterMs = Date.now() - started; await saveFlag({ enabled: true, kill_switch: false });
    await Promise.all([waitPolicy(guest, true, 'live guest renewal restores global ON'), waitPolicy(user, true, 'live ordinary renewal restores ON')]);
    return { serverReason: policy.reason, liveClientsDisabledAfterMs: disabledAfterMs, actualAutomaticRefresh: true, manualComponentOverrides: 0 };
  });
  await check('real-emergency-kill-and-public-account-isolation', async () => {
    const started = Date.now(); await saveFlag({ enabled: true, kill_switch: true });
    const publicPolicy = (await api(guest, '/api/ui/features')).public_ui; assert.equal(publicPolicy.reason, 'kill_switch'); assert.equal(publicPolicy.enabled, false);
    const userSnapshot = (await api(user, '/api/features')).snapshot; assert.equal(userSnapshot.flags.p07_accessibility.reason, 'kill_switch');
    await Promise.all([waitPolicy(guest, false, 'live guest automatic emergency shutdown'), waitPolicy(user, false, 'live account automatic emergency shutdown')]);
    assert(!JSON.stringify(publicPolicy).includes(ordinary.id)); assert(!('account_id' in publicPolicy));
    return { publicReason: publicPolicy.reason, accountReason: userSnapshot.flags.p07_accessibility.reason, liveClientsDisabledAfterMs: Date.now() - started, noPublicAccountIdentity: true };
  });
  await check('browser-runtime-no-uncaught-exceptions-or-native-js-alerts', async () => {
    const errors = [...pages.flatMap(page => page.runtimeErrors), ...zoomRuntimeErrors];
    assert.deepEqual(errors, []); assert.deepEqual([...pages.flatMap(page => page.dialogs), ...zoomDialogs], []); return { uncaughtExceptions: 0, nativeJsAlerts: 0, intentionalHttpFaultsSeparatelyRecorded: true };
  });
} catch (error) { checks.push({ id: 'environment-or-dependency', status: 'FAIL', error: scrub(error.stack) }); }
finally {
  if (admin && originalFlag) {
    try {
      if (overrideChanged) { await override(null); overrideRestored = true; }
      await saveFlag({ description: originalFlag.description, enabled: originalFlag.enabled, kill_switch: originalFlag.kill_switch,
        channels: originalFlag.channels, rollout_percentage: originalFlag.rollout_percentage });
      const current = await currentFlag(); assert.deepEqual(current.others, originalOthers);
      assert.equal((await api(guest, '/api/ui/features')).public_ui.enabled, true);
      await Promise.all([waitPolicy(guest, true, 'guest restored to original actual policy'), waitPolicy(user, true, 'ordinary restored to original actual policy')]); policyRestored = true;
      checks.push({ id: 'local-policy-restored-and-other-flags-preserved', status: 'PASS', actual: { policyRestored, overrideRestored, liveClientsRestored: true, otherFlagsUnchanged: true, auditHistoryRetained: true } });
    } catch (error) { checks.push({ id: 'local-policy-restoration', status: 'FAIL', error: scrub(error.stack) }); }
  }
  for (const page of pages) { try { await page.close(); } catch (error) { checks.push({ id: 'close-owned-browser-context', status: 'FAIL', error: scrub(error.message) }); } }
  const report = { origin, environment: 'ACTUAL_LOCAL_CLOUDFLARE_D1_R2_SYNTHETIC_ACCOUNTS', checks, captures, mutations, localNoticeClosures,
    pass: checks.filter(row => row.status === 'PASS').length, fail: checks.filter(row => row.status === 'FAIL').length, blocked: checks.filter(row => row.status === 'BLOCKED').length,
    limits: ['AX tree and DOM checks are not a professional screen-reader acceptance', 'Browser zoom uses new owned private profiles and is verified independently of page-scale/pinch and CSS zoom', 'HTTP fault injection is synthetic and separate from real server empty responses', 'No field Core Web Vitals or physical-device claims'],
    scope: { realRegistrationAndLogin: true, freshLocalOrdinaryAccount: true, existingOwnedSyntheticAdmin: true, localPolicyRestored: policyRestored,
      productionRequests: 0, financialWrites: 0, paymentRequests: 0, aiCalls: 0, roleOrMembershipWrites: 0, profileDeletes: 0 } };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: path.relative(root, out), pass: report.pass, fail: report.fail, blocked: report.blocked, policyRestored }));
  if (report.fail) process.exitCode = 1;
}
