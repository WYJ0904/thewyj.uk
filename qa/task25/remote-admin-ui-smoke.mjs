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
  (environment === 'development' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)), 'Only explicit development or existing hosted Preview is allowed');
assert.equal(url.origin, origin, 'Origin cannot include credentials/path/query');
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
  assert.equal(Number(output.slice(index + 1)), expected, `Unexpected HTTP status for ${route}`);
  return JSON.parse(output.slice(0, index));
};
const results = [], fixtureKeys = [];
let user, token, native, deviceId, actor, failure = null, cleanup = true, stage = 'preflight', diagnostic = null;
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
  user = api('/api/register', { username, secret, confirm_secret: secret }, '', 201).account;
  token = api('/api/login', { username, secret }, '').session;
  deviceId = crypto.randomUUID();
  native = api('/api/app/login', { username, secret, device_id: deviceId, app_version: '1.3.34' }, '').access_token;
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
  await adminPage.navigate('/admin');
  await adminPage.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
  await adminPage.waitFor("!document.getElementById('adminFeatureFlagsTab').classList.contains('hidden')");
  await adminPage.click('#adminFeatureFlagsTab');
  // The console deliberately rejects submit while its initial catalogue is
  // loading. A visible tab alone does not establish that its form is ready.
  await adminPage.waitFor("document.getElementById('featureConsoleStatus').textContent === '已读取最新配置' && document.getElementById('featureFlagSelect').options.length >= 2");
  const key = 'task25_hosted_ui_' + randomBytes(5).toString('hex');
  fixtureKeys.push(key); // Cleanup can discover a write even if its response fails.
  const selected = () => adminPage.setFields({ '#featureFlagSelect': key });
  // Check scope and click in the same browser task, so a delayed catalogue
  // render can never redirect a test write to a pre-existing flag.
  const clickOwn = selector => adminPage.evaluate(`(() => {
    const form = document.getElementById('featureFlagForm'), key = ${JSON.stringify(key)};
    if (document.getElementById('featureFlagKey').value !== key ||
        (Number(form.dataset.revision) > 0 && document.getElementById('featureFlagSelect').value !== key) ||
        (${JSON.stringify(selector)} === '#saveFeatureOverrideBtn' && document.getElementById('featureOverrideUser').value !== ${JSON.stringify(user.id)})) {
      throw new Error('Fixture scope lost; no management write performed');
    }
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Fixture control is not ready');
    button.click(); return true;
  })()`);
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
    await adminPage.click('#evaluateFeatureBtn');
    const expected = `${key}: ${enabled ? 'ON' : 'OFF'} (${reason}`;
    await adminPage.waitFor(`document.getElementById('featureEvaluationResult').textContent.includes(${JSON.stringify(expected)})`);
  };
  await adminPage.click('#newFeatureFlagBtn');
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
  await userPage.click('#accountBtn');
  await userPage.waitFor("!document.getElementById('releaseChannelSection').classList.contains('hidden') && !document.getElementById('saveReleaseChannelBtn').disabled");
  for (const channel of ['beta', 'experimental', 'stable']) {
    await userPage.setFields({ '#releaseChannelSelect': channel });
    await userPage.click('#saveReleaseChannelBtn');
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
  await adminPage.click('#adminFeatureFlagsTab');
  await adminPage.waitFor(`Array.from(document.getElementById('featureFlagSelect').options).some(o => o.value === ${JSON.stringify(key)})`);
  await selected();
  assert.equal(await adminPage.evaluate("document.getElementById('featureFlagKillSwitch').checked"), true);
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
  const screenshot = await adminPage.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(arg('output')), { recursive: true });
  fs.writeFileSync(arg('output') + '.png', Buffer.from(screenshot.data, 'base64'));
  results.push('UI_create_read_global_OFF_ON', 'UI_targeting_and_channel_scope', 'UI_percentage_independent_bucket',
    'synthetic_UI_three_channels', 'browser_native_WebView_same_account_contract', 'UI_kill_switch',
    'UI_refresh_persistence_audit', 'ordinary_admin_denied', 'Stable_metadata_preserved');
} catch (error) {
  failure = error.name;
  try {
    if (pages[0]) diagnostic = await pages[0].evaluate(`(() => ({
      console_status: document.getElementById('featureConsoleStatus')?.textContent,
      selected_is_fixture: ${JSON.stringify(fixtureKeys)}.includes(document.getElementById('featureFlagSelect')?.value),
      form_revision: document.getElementById('featureFlagForm')?.dataset.revision,
      evaluate_channel: document.getElementById('featureEvaluateChannel')?.value,
      fixture_evaluation: document.getElementById('featureEvaluationResult')?.textContent.split('\\n').filter(line => ${JSON.stringify(fixtureKeys)}.some(key => line.startsWith(key + ': ')))
    }))()`);
  } catch { /* Diagnostics never replace a failed acceptance. */ }
  console.error('Admin UI acceptance failed:', error.name, 'at', stage);
}
finally {
  for (const key of fixtureKeys) {
    try {
      const current = api('/api/admin/feature-flags').flags.find(flag => flag.flag_key === key);
      if (current) {
        const flag = api('/api/admin/feature-flags', { flag_key: key, description: current.description, enabled: false,
          kill_switch: true, channels: current.channels, rollout_percentage: 0, expected_revision: current.revision }).flag;
        assert.equal(flag.enabled, false); assert.equal(flag.kill_switch, true);
      }
    } catch { cleanup = false; }
  }
  try {
    if (token) {
      const preference = api('/api/release-channel', undefined, token);
      if (preference.channel !== 'stable') api('/api/release-channel', { channel: 'stable', expected_revision: preference.revision }, token);
      api('/api/logout', {}, token);
    }
    if (native) api('/api/app/session/logout', { device_id: deviceId }, native);
  } catch { cleanup = false; }
  for (const page of pages) await page.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
const report = { checked_at_utc: new Date().toISOString(), origin, environment,
  acceptance: !failure && cleanup ? 'PASS' : 'FAILED', checks: results, failure_class: failure, cleanup_pass: cleanup,
  failure_step: failure ? stage : null, diagnostic,
  fixture_flags: fixtureKeys, synthetic_account_id: user?.id, real_user_data_modified: false, stable_pointer_modified: false,
  admin_session_persisted: false, physical_device_acceptance: 'NOT_EXECUTED' };
fs.mkdirSync(path.dirname(arg('output')), { recursive: true });
fs.writeFileSync(arg('output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (failure || !cleanup) process.exitCode = 1;
