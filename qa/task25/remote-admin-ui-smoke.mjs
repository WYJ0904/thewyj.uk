// Same browser runner for explicit local development and real hosted Preview.
// Existing administrator session only; mutations target new, inert fixtures.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openPage } from '../../local-backend/browser_harness.mjs';

const arg = name => process.argv[process.argv.indexOf('--' + name) + 1];
for (const name of ['origin', 'environment', 'output']) assert.ok(process.argv.includes('--' + name), `Missing --${name}`);
const origin = arg('origin').replace(/\/$/, ''), environment = arg('environment');
const url = new URL(origin);
assert.ok((environment === 'preview' && url.protocol === 'https:' && url.hostname.endsWith('.thewyj-uk.pages.dev')) ||
  (environment === 'development' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) ||
  (environment === 'production' && origin === 'https://thewyj.uk'), 'Origin must match the explicitly selected existing environment');
assert.equal(url.origin, origin, 'Origin cannot include credentials/path/query');
if (process.env.WYJ_TASK25_RATE_LIMIT_REGRESSION === 'true') assert.equal(environment, 'development', 'Quota precharge is development-only');
const admin = process.env.WYJ_TASK25_ADMIN_SESSION;
assert.ok(admin, 'BLOCKED: ADMIN SESSION; no records created');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task25-admin-ui-'));
const headerFile = path.join(temp, 'headers');
fs.writeFileSync(headerFile, '', { mode: 0o600 });
const api = (route, payload = undefined, session = admin, expected = 200, cookie = '') => {
  fs.writeFileSync(headerFile, [`Origin: ${origin}`, 'Content-Type: application/json', 'User-Agent: Thewyj-Android/1.3.34',
    ...(session ? [`X-Session-Token: ${session}`] : []), ...(cookie ? [`Cookie: __Host-wyj_app_access=${cookie}`] : [])].join('\n') + '\n');
  const args = ['--silent', '--show-error', '--max-time', '40', '--header', '@' + headerFile, '--write-out', '\n%{http_code}', origin + route];
  if (payload !== undefined) args.push('--request', 'POST', '--data-binary', '@-');
  const output = execFileSync('curl', args, { input: payload === undefined ? undefined : JSON.stringify(payload), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const index = output.lastIndexOf('\n');
  const code = Number(output.slice(index + 1));
  if (Array.isArray(expected)) assert.ok(expected.includes(code), `Unexpected HTTP status for ${route}`);
  else assert.equal(code, expected, `Unexpected HTTP status for ${route}`);
  return JSON.parse(output.slice(0, index));
};
const results = [], fixtureKeys = [];
const rateBudget = { observed_429: false, cooldown_ms: 0, server_limits_changed: false };
const visibility = { occlusion_guard_enabled: true, development_fixture_messages_dismissed: 0,
  occluded_control_refused: false, hosted_message_receipts_modified: false, console_screenshot_unobstructed: false };
function requireVisibleControl(element) {
  if (!element || element.disabled || element.closest('[inert]')) throw new Error('UI control is unavailable or inert');
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (!rect.width || !rect.height || style.visibility !== 'visible' || !hit || !element.contains(hit)) {
    throw new Error('UI control is hidden or occluded; no click performed');
  }
}
let user, token, native, deviceId, actor, fixtureUsername, fixtureSecret, accountDeleted = false, failure = null, cleanup = true, stage = 'preflight', diagnostic = null, controlSelector = null, controlPage = null;
const pages = [];
try {
  const status = api('/api/status', undefined, '');
  assert.equal(status.environment, environment);
  assert.equal(status.features.task25_feature_flags, true);
  const stable = JSON.parse(fs.readFileSync(new URL('../../android/release-metadata.json', import.meta.url), 'utf8'));
  const originalConfig = api('/api/app/config', undefined, '').app;
  assert.equal(originalConfig.latest_version_code, 46);
  assert.equal(originalConfig.apk_sha256, stable.apkSha256);
  actor = api('/api/me').account;
  assert.ok(actor.is_admin, 'Administrator authorization required before creating fixtures');
  api('/api/admin/feature-flags');
  const username = 't25ui_' + randomBytes(5).toString('hex'), secret = randomBytes(24).toString('base64url');
  fixtureSecret = secret;
  fixtureUsername = username;
  user = api('/api/register', { username, secret, confirm_secret: secret }, '', 201).account;
  token = api('/api/login', { username, secret }, '').session;
  deviceId = crypto.randomUUID();
  native = api('/api/app/login', { username, secret, device_id: deviceId, app_version: '1.3.34' }, '').access_token;
  // Separate acceptance scripts can share the same authorized administrator.
  // Its per-route management quota is authoritative, not a disposable fixture.
  // CI deliberately exhausts only its development actor's read-only simulation
  // quota; all ordinary operations still require their original exact status.
  if (process.env.WYJ_TASK25_RATE_LIMIT_REGRESSION === 'true') {
    assert.equal(environment, 'development', 'Quota precharge is development-only');
    for (let i = 0; i < 61; i++) {
      const response = api('/api/admin/feature-flags/evaluate', { user_id: user.id, channel: 'stable' }, admin, [200, 429]);
      if (response.code === 'task25_rate_limited') {
        assert.equal(response.retryable, true);
        rateBudget.observed_429 = true;
        break;
      }
    }
    assert.equal(rateBudget.observed_429, true, 'Development management quota must actually reject excess requests');
  }
  // Task25 management uses a fixed 60-second server window. Start the UI
  // sequence in the next window rather than disabling limits, clearing rows
  // or retrying a rejected/ambiguous management write. Use server time.
  const serverTime = Date.parse(api('/api/status', undefined, '').time);
  assert.ok(Number.isFinite(serverTime), 'Server timestamp required for management request pacing');
  rateBudget.cooldown_ms = Math.min(60_000, 60_000 - serverTime % 60_000 + 250);
  await new Promise(resolve => setTimeout(resolve, rateBudget.cooldown_ms));
  const authenticatedPage = async account => {
    const page = await openPage({ cdpUrl: process.env.WYJ_CDP_URL || 'http://127.0.0.1:9225', baseUrl: origin, width: 1366, height: 915, mobile: false });
    pages.push(page);
    const latency = Number(process.env.WYJ_TASK25_UI_LATENCY_MS || 0);
    if (environment === 'development' && latency > 0) await page.send('Network.emulateNetworkConditions', {
      offline: false, latency, downloadThroughput: -1, uploadThroughput: -1,
    });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wyjAccountSession', ${JSON.stringify(account.id === actor.id ? admin : token)}); localStorage.setItem('wyjAccountCache', ${JSON.stringify(JSON.stringify(account))});` });
    return page;
  };
  const adminPage = await authenticatedPage(actor), userPage = await authenticatedPage(user);
  const settleFixtureNotices = async page => {
    // Only the explicitly isolated development actor may dismiss preceding
    // test messages. Never mutate a hosted administrator's message receipts.
    if (environment !== 'development') return;
    for (let i = 0; i < 10; i++) {
      if (await page.evaluate("document.getElementById('siteMessageModal').classList.contains('hidden')")) return;
      assert.equal(actor.id, 'task15-ci-super-admin', 'Only the explicit development fixture actor may dismiss test messages');
      assert.equal(await page.evaluate(`(() => {
        try { (${requireVisibleControl.toString()})(document.getElementById('accountBtn')); return false; }
        catch { return true; }
      })()`), true, 'Actual notification must block the underlying control');
      visibility.occluded_control_refused = true;
      await page.click('#siteMessageCloseBtn');
      visibility.development_fixture_messages_dismissed++;
      await page.waitFor("!document.getElementById('siteMessageCloseBtn').disabled");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await page.evaluate("document.getElementById('siteMessageModal').classList.contains('hidden')"), true,
      'Development message fixture queue must settle');
  };
  const waitVisibleControl = async (page, selector) => {
    const deadline = Date.now() + 5000;
    do {
      await settleFixtureNotices(page);
      if (await page.evaluate(`(() => { try { (${requireVisibleControl.toString()})(document.querySelector(${JSON.stringify(selector)})); return true; } catch { return false; } })()`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error('UI control remains blocked; no click performed');
  };
  const visibleClick = async (page, selector) => {
    stage = 'UI_visible_control_' + selector;
    controlSelector = selector;
    controlPage = page;
    await waitVisibleControl(page, selector);
    return page.evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      (${requireVisibleControl.toString()})(button); button.click(); return true;
    })()`);
  };
  await adminPage.navigate('/admin');
  await adminPage.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
  await adminPage.waitFor("!document.getElementById('adminFeatureFlagsTab').classList.contains('hidden')");
  await visibleClick(adminPage, '#adminFeatureFlagsTab');
  // The console deliberately rejects submit while its initial catalogue is
  // loading. A visible tab alone does not establish that its form is ready.
  await adminPage.waitFor("document.getElementById('featureConsoleStatus').textContent === '已读取最新配置' && document.getElementById('featureFlagSelect').options.length >= 2");
  const key = 'task25_hosted_ui_' + randomBytes(5).toString('hex');
  fixtureKeys.push(key); // Cleanup can discover a write even if its response fails.
  const selected = () => adminPage.setFields({ '#featureFlagSelect': key });
  // Check scope and click in the same browser task, so a delayed catalogue
  // render can never redirect a test write to a pre-existing flag.
  const clickOwn = async selector => {
    controlSelector = selector;
    controlPage = adminPage;
    await waitVisibleControl(adminPage, selector);
    return adminPage.evaluate(`(() => {
    const form = document.getElementById('featureFlagForm'), key = ${JSON.stringify(key)};
    if (document.getElementById('featureFlagKey').value !== key ||
        (Number(form.dataset.revision) > 0 && document.getElementById('featureFlagSelect').value !== key) ||
        (${JSON.stringify(selector)} === '#saveFeatureOverrideBtn' && document.getElementById('featureOverrideUser').value !== ${JSON.stringify(user.id)})) {
      throw new Error('Fixture scope lost; no management write performed');
    }
    const button = document.querySelector(${JSON.stringify(selector)});
    (${requireVisibleControl.toString()})(button);
    button.click(); return true;
  })()`);
  };
  const save = async () => {
    stage = 'save_flag';
    const prior = await adminPage.evaluate("Number(document.getElementById('featureFlagForm').dataset.revision)");
    await clickOwn('#saveFeatureFlagBtn');
    await adminPage.waitFor(`Array.from(document.getElementById('featureFlagSelect').options).some(o => o.value === ${JSON.stringify(key)}) && document.getElementById('featureConsoleStatus').textContent === '设置已保存' && !document.getElementById('saveFeatureFlagBtn').disabled`);
    await selected();
    assert.ok(await adminPage.evaluate(`Number(document.getElementById('featureFlagForm').dataset.revision) > ${prior}`));
  };
  const checkbox = (id, checked) => adminPage.evaluate(`document.getElementById(${JSON.stringify(id)}).checked = ${JSON.stringify(checked)}`);
  const evaluate = async (channel, enabled, reason = '') => {
    stage = `evaluate_${channel}_${reason}_${enabled ? 'ON' : 'OFF'}`;
    await adminPage.setFields({ '#featureEvaluateUser': user.id, '#featureEvaluateChannel': channel });
    await adminPage.evaluate("document.getElementById('featureEvaluationResult').textContent = ''");
    await visibleClick(adminPage, '#evaluateFeatureBtn');
    const expected = `${key}: ${enabled ? 'ON' : 'OFF'} (${reason}`;
    await adminPage.waitFor(`document.getElementById('featureEvaluationResult').textContent.includes(${JSON.stringify(expected)})`);
  };
  await visibleClick(adminPage, '#newFeatureFlagBtn');
  await adminPage.setFields({ '#featureFlagKey': key, '#featureFlagDescription': 'Unconsumed harmless Preview acceptance fixture', '#featureFlagPercentage': 0 });
  await save();
  await evaluate('experimental', false, 'global_off');
  await checkbox('featureFlagEnabled', true);
  await save();
  await evaluate('experimental', false, 'percentage_rollout');
  await adminPage.setFields({ '#featureOverrideUser': user.id, '#featureOverrideValue': 'on' });
  await clickOwn('#saveFeatureOverrideBtn');
  await adminPage.waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存' && !document.getElementById('saveFeatureOverrideBtn').disabled");
  await evaluate('experimental', true, 'user_override');
  await evaluate('stable', false, 'channel_excluded');
  await evaluate('beta', false, 'channel_excluded');
  await adminPage.setFields({ '#featureOverrideValue': 'inherit' });
  await clickOwn('#saveFeatureOverrideBtn');
  await adminPage.waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存' && !document.getElementById('saveFeatureOverrideBtn').disabled");
  await adminPage.setFields({ '#featureFlagPercentage': 37.25 });
  for (const channel of ['stable', 'beta', 'experimental']) await checkbox('featureChannel_' + channel, true);
  await save();
  const bucket = Math.floor(createHash('sha256').update(key + '\0' + user.id).digest().readUInt32BE() * 10000 / 2 ** 32);
  for (let i = 0; i < 2; i++) {
    const snapshot = api('/api/admin/feature-flags/evaluate', { user_id: user.id, channel: 'stable' }).snapshot;
    assert.equal(snapshot.flags[key].bucket, bucket);
    await evaluate('stable', bucket < 3725, 'percentage_rollout');
  }
  await userPage.navigate('/');
  await userPage.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
  await visibleClick(userPage, '#accountMenu summary');
  await userPage.waitFor("document.getElementById('accountMenu').open");
  await visibleClick(userPage, '#accountBtn');
  await userPage.waitFor("!document.getElementById('releaseChannelSection').classList.contains('hidden') && !document.getElementById('saveReleaseChannelBtn').disabled");
  for (const channel of ['beta', 'experimental', 'stable']) {
    await userPage.setFields({ '#releaseChannelSelect': channel });
    await visibleClick(userPage, '#saveReleaseChannelBtn');
    await userPage.waitFor(`window.AerisFeatures.channel() === '${channel}' && !document.getElementById('saveReleaseChannelBtn').disabled`);
    const snapshots = [api('/api/features', undefined, token).snapshot, api('/api/features', undefined, native).snapshot,
      api('/api/features', undefined, '', 200, native).snapshot];
    assert.ok(snapshots.every(snapshot => snapshot.account_id === user.id && snapshot.channel === channel));
    assert.deepEqual(snapshots.map(snapshot => snapshot.flags), [snapshots[0].flags, snapshots[0].flags, snapshots[0].flags]);
  }
  await checkbox('featureFlagKillSwitch', true);
  await save();
  await evaluate('stable', false, 'kill_switch');
  await adminPage.navigate('/admin');
  await visibleClick(adminPage, '#adminFeatureFlagsTab');
  await adminPage.waitFor(`Array.from(document.getElementById('featureFlagSelect').options).some(o => o.value === ${JSON.stringify(key)})`);
  await selected();
  assert.equal(await adminPage.evaluate("document.getElementById('featureFlagKillSwitch').checked"), true);
  await visibleClick(adminPage, '#adminFeatureFlagsView details > summary');
  assert.equal(await adminPage.evaluate("document.getElementById('featureFlagAudit').closest('details').open"), true);
  assert.ok(await adminPage.evaluate(`document.getElementById('featureFlagAudit').textContent.includes(${JSON.stringify(key)})`));
  api('/api/admin/feature-flags', undefined, token, 403);
  const current = api('/api/admin/feature-flags').flags.find(flag => flag.flag_key === key);
  api('/api/admin/feature-flags', { flag_key: key, description: current.description, enabled: true,
    kill_switch: false, channels: current.channels, rollout_percentage: 100, expected_revision: current.revision }, token, 403);
  assert.equal(api('/api/admin/feature-flags').flags.find(flag => flag.flag_key === key).revision, current.revision);
  await userPage.navigate('/admin');
  assert.equal(await userPage.evaluate("document.getElementById('adminFeatureFlagsTab').classList.contains('hidden')"), true);
  assert.deepEqual(api('/api/app/config', undefined, '').app, originalConfig);
  assert.deepEqual(adminPage.runtimeErrors, []);
  await settleFixtureNotices(adminPage);
  assert.equal(await adminPage.evaluate("document.querySelector('.modal-layer:not(.hidden)') === null && !document.getElementById('featureFlagForm').closest('[inert]')"), true,
    'A visible unobstructed console is required; DOM assertions behind a modal are insufficient');
  await adminPage.evaluate("window.scrollTo({top: 0, behavior: 'instant'})");
  visibility.console_screenshot_unobstructed = true;
  const layout = (await adminPage.send('Page.getLayoutMetrics')).cssContentSize;
  assert.ok(layout.width <= 2000 && layout.height <= 10000, 'Console capture bounds required');
  const screenshot = await adminPage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 } });
  fs.mkdirSync(path.dirname(arg('output')), { recursive: true });
  fs.writeFileSync(arg('output') + '.png', Buffer.from(screenshot.data, 'base64'));
  results.push('UI_create_read_global_OFF_ON', 'UI_targeting_and_channel_scope', 'UI_percentage_independent_bucket',
    'synthetic_UI_three_channels', 'browser_native_WebView_same_account_contract', 'UI_kill_switch',
    'UI_refresh_persistence_audit', 'ordinary_admin_denied', 'Stable_metadata_preserved');
} catch (error) {
  failure = error.name;
  try {
    if (pages[0]) diagnostic = await (controlPage || pages[0]).evaluate(`(() => ({
      console_status: document.getElementById('featureConsoleStatus')?.textContent,
      selected_is_fixture: ${JSON.stringify(fixtureKeys)}.includes(document.getElementById('featureFlagSelect')?.value),
      form_revision: document.getElementById('featureFlagForm')?.dataset.revision,
      evaluate_channel: document.getElementById('featureEvaluateChannel')?.value,
      fixture_evaluation: document.getElementById('featureEvaluationResult')?.textContent.split('\\n').filter(line => ${JSON.stringify(fixtureKeys)}.some(key => line.startsWith(key + ': '))),
      visible_modal_ids: Array.from(document.querySelectorAll('.modal-layer:not(.hidden)')).map(element => element.id),
      control: (() => { const element = document.querySelector(${JSON.stringify(controlSelector)}); if (!element) return null;
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element), hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2);
        return { selector: ${JSON.stringify(controlSelector)}, inert: Boolean(element.closest('[inert]')), visibility: style.visibility,
          x: rect.x, y: rect.y, width: rect.width, height: rect.height, hit_id: hit?.id, hit_tag: hit?.tagName }; })()
    }))()`);
    if (environment === 'development' && controlPage) {
      const screenshot = await controlPage.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(arg('output')), { recursive: true });
      fs.writeFileSync(arg('output') + '.failed.png', Buffer.from(screenshot.data, 'base64'));
    }
  } catch { /* Diagnostics never replace a failed acceptance. */ }
  console.error('Admin UI acceptance failed:', error.name, 'at', stage);
}
finally {
  for (const key of fixtureKeys) {
    try {
      const current = api('/api/admin/feature-flags').flags.find(flag => flag.flag_key === key);
      if (current) {
        if (user) current.revision = api('/api/admin/feature-flags/override', { flag_key: key,
          user_id: user.id, enabled: null, expected_revision: current.revision }).override.revision;
        const flag = api('/api/admin/feature-flags', { flag_key: key, description: current.description, enabled: false,
          kill_switch: true, channels: current.channels, rollout_percentage: 0, expected_revision: current.revision }).flag;
        assert.equal(flag.enabled, false); assert.equal(flag.kill_switch, true);
      }
    } catch { cleanup = false; }
  }
  try {
    if (user && !token) token = api('/api/login', { username: fixtureUsername, secret: fixtureSecret }, '').session;
    if (token) {
      const preference = api('/api/release-channel', undefined, token);
      if (preference.channel !== 'stable') api('/api/release-channel', { channel: 'stable', expected_revision: preference.revision }, token);
    }
    if (native) api('/api/app/session/logout', { device_id: deviceId }, native);
    if (token) {
      const identity = api('/api/me', undefined, token).account;
      assert.equal(identity.id, user.id); assert.equal(identity.is_admin, false);
      assert.equal(api('/api/account/delete', { secret: fixtureSecret }, token).account_deleted, true);
      assert.equal(api('/api/me', undefined, token, 403).code, 'account_deleted');
      accountDeleted = true;
    }
  } catch { cleanup = false; }
  for (const page of pages) await page.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
const report = { checked_at_utc: new Date().toISOString(), origin, environment,
  acceptance: !failure && cleanup ? 'PASS' : 'FAILED', checks: results, failure_class: failure, cleanup_pass: cleanup,
  failure_step: failure ? stage : null, diagnostic,
  fixture_flags: fixtureKeys, synthetic_account_id: user?.id, real_user_data_modified: false, stable_pointer_modified: false,
  synthetic_account_soft_deleted: accountDeleted, test_flags_retained_for_audit: fixtureKeys.length > 0,
  admin_session_persisted: false, physical_device_acceptance: 'NOT_EXECUTED', management_rate_budget: rateBudget,
  ui_visibility: visibility };
fs.mkdirSync(path.dirname(arg('output')), { recursive: true });
fs.writeFileSync(arg('output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (failure || !cleanup) process.exitCode = 1;
