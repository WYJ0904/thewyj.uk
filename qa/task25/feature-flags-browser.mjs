import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openPage } from '../../local-backend/browser_harness.mjs';

const baseUrl = process.env.WYJ_TEST_BASE || 'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname, '127.0.0.1', 'Browser fixture is restricted to isolated local Preview');
const secret = process.env.WYJ_TEST_ADMIN_SECRET;
assert.ok(secret, 'Isolated admin fixture is required');
const results = [];
for (const width of [390, 1366]) {
  const page = await openPage({ cdpUrl: process.env.WYJ_CDP_URL || 'http://127.0.0.1:9225', baseUrl, width, height: 915, mobile: width === 390 });
  const flagKey = `task25_browser_${width}_${Date.now().toString(36)}`;
  try {
    await page.navigate('/login');
    await page.setFields({ '#usernameInput': process.env.WYJ_TEST_ADMIN_USER || 'wyj', '#secretInput': secret });
    await page.click('#loginSubmitBtn');
    await page.waitFor("location.pathname === '/'", 30000);
    await page.navigate('/admin');
    await page.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
    await page.waitFor("!document.getElementById('adminFeatureFlagsTab').classList.contains('hidden')", 30000);
    await page.click('#adminFeatureFlagsTab');
    await page.waitFor("document.getElementById('featureFlagSelect').options.length >= 2");
    await page.click('#newFeatureFlagBtn');
    await page.setFields({ '#featureFlagKey': flagKey, '#featureFlagDescription': '<img src=x onerror="window.task25Xss=1">', '#featureFlagPercentage': 0 });
    await page.click('#featureFlagEnabled');
    await page.click('#saveFeatureFlagBtn');
    await page.waitFor(`Array.from(document.getElementById('featureFlagSelect').options).some(o => o.value === ${JSON.stringify(flagKey)})`);
    await page.setFields({ '#featureFlagSelect': flagKey });
    const accountId = await page.evaluate("JSON.parse(localStorage.getItem('wyjAccountCache')).id");
    await page.setFields({ '#featureEvaluateUser': accountId, '#featureEvaluateChannel': 'experimental' });
    await page.click('#evaluateFeatureBtn');
    await page.waitFor(`document.getElementById('featureEvaluationResult').textContent.includes(${JSON.stringify(flagKey + ': OFF')})`);
    await page.setFields({ '#featureOverrideUser': accountId, '#featureOverrideValue': 'on' });
    await page.click('#saveFeatureOverrideBtn');
    await page.waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存' && !document.getElementById('saveFeatureOverrideBtn').disabled");
    await page.click('#evaluateFeatureBtn');
    await page.waitFor(`document.getElementById('featureEvaluationResult').textContent.includes(${JSON.stringify(flagKey + ': ON')})`);
    await page.click('#featureFlagKillSwitch');
    await page.click('#saveFeatureFlagBtn');
    await page.waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存' && !document.getElementById('saveFeatureFlagBtn').disabled");
    await page.click('#evaluateFeatureBtn');
    await page.waitFor(`document.getElementById('featureEvaluationResult').textContent.includes(${JSON.stringify(flagKey + ': OFF (kill_switch')})`);
    assert.equal(await page.evaluate('window.task25Xss || 0'), 0);
    assert.equal(await page.evaluate("document.querySelectorAll('#featureFlagAudit img, #featureEvaluationResult img').length"), 0);
    assert.ok(await page.evaluate(`document.getElementById('featureFlagAudit').textContent.includes(${JSON.stringify(flagKey)})`));
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));

    const target = path.resolve('artifacts/task25'); fs.mkdirSync(target, { recursive: true });
    await page.evaluate("document.getElementById('adminFeatureFlagsView').scrollIntoView({ block: 'start' })");
    const adminScreenshot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(target, `feature-console-${width}.png`), Buffer.from(adminScreenshot.data, 'base64'));
    // An active harmless fixture proves that losing connectivity actually closes a decision.
    await page.click('#featureFlagKillSwitch');
    await page.click('#featureChannel_stable');
    await page.click('#saveFeatureFlagBtn');
    await page.waitFor("document.getElementById('featureConsoleStatus').textContent === '设置已保存' && !document.getElementById('saveFeatureFlagBtn').disabled");

    // Account preferences are server confirmed and cannot change the formal APK.
    await page.click('#accountBtn');
    await page.waitFor("!document.getElementById('releaseChannelSection').classList.contains('hidden') && !document.getElementById('saveReleaseChannelBtn').disabled");
    for (const channel of ['beta', 'experimental', 'stable']) {
      await page.setFields({ '#releaseChannelSelect': channel });
      await page.click('#saveReleaseChannelBtn');
      await page.waitFor(`document.getElementById('releaseChannelSelect').value === '${channel}' && !document.getElementById('saveReleaseChannelBtn').disabled && window.AerisFeatures.channel() === '${channel}'`);
      const server = await page.evaluate(`fetch('/api/release-channel', { headers: { 'X-Session-Token': localStorage.getItem('wyjAccountSession') } }).then(r => r.json())`);
      assert.equal(server.channel, channel);
    }
    await page.click('#refreshReleaseChannelBtn');
    await page.waitFor(`window.AerisFeatures.enabled(${JSON.stringify(flagKey)}) === true`);
    await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.waitFor(`window.AerisFeatures.enabled(${JSON.stringify(flagKey)}) === false`);
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.click('#refreshReleaseChannelBtn');
    await page.waitFor("!document.getElementById('saveReleaseChannelBtn').disabled");
    await page.waitFor(`window.AerisFeatures.enabled(${JSON.stringify(flagKey)}) === true`);
    assert.deepEqual(page.runtimeErrors, []);
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(target, `feature-channels-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    results.push({ width, adminCreate: true, zeroPercent: true, userOverride: true, killSwitch: true,
      channelPersistence: true, xssSafe: true, noOverflow: true, offlineRecovery: true });
  } finally { await page.close(); }
}
fs.mkdirSync('artifacts/task25', { recursive: true });
fs.writeFileSync('artifacts/task25/browser-acceptance.json', JSON.stringify({ source: 'local isolated Pages/D1/R2', results }, null, 2) + '\n');
console.log(`Task 25 real browser acceptance passed at ${results.map(r => r.width).join('/')}px`);
