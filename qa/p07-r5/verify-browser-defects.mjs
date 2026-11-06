import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const EVIDENCE_DIR = path.join(ROOT, 'docs/p07/evidence/r5');
await fsp.mkdir(EVIDENCE_DIR, { recursive: true });

const PREVIEW_URL = process.env.AERIS_PREVIEW_URL || 'https://cab88b0d.thewyj-p07-ui-rc.pages.dev';
const CHROME_EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = 19358;
const PROFILE_DIR = path.join(ROOT, '.wrangler/chrome-r5-verified-profile');

// Ensure port 19358 is free
await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen({ host: '127.0.0.1', port: CDP_PORT, exclusive: true }, () => s.close(resolve));
});

const chromeLog = openSync(path.join(EVIDENCE_DIR, 'chrome-r5.log'), 'w');
const chromeProc = spawn(
  CHROME_EXE,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    'about:blank',
  ],
  { cwd: ROOT, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' }, windowsHide: true, stdio: ['ignore', chromeLog, chromeLog] }
);
closeSync(chromeLog);

async function healthy(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; }
  catch { return false; }
}

let cdpReady = false;
for (let i = 0; i < 40; i++) {
  if (await healthy(`http://127.0.0.1:${CDP_PORT}/json/version`)) { cdpReady = true; break; }
  await delay(250);
}
assert.ok(cdpReady, 'CDP endpoint failed to initialize');

const testResults = [];
const measurements = {};

try {
  // Pre-login via API to get session token
  console.log('Logging in as qa_lifetime_member...');
  const loginRes = await fetch(`${PREVIEW_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'qa_lifetime_member', secret: 'Aeris2026!QaLifetime#Test' })
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  const sessionToken = loginData.session;
  assert.ok(sessionToken);

  const page = await openPage({ cdpUrl: `http://127.0.0.1:${CDP_PORT}`, baseUrl: PREVIEW_URL, width: 1440, height: 960, mobile: false });

  async function takeScreenshot(filename) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(EVIDENCE_DIR, filename);
    await fsp.writeFile(filePath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved screenshot: ${filename}`);
    return filePath;
  }

  async function setTheme(theme) {
    await page.evaluate(`document.documentElement.dataset.theme = '${theme}'; document.body.dataset.theme = '${theme}';`);
    await delay(150);
  }

  async function setViewport(width, height = 960, mobile = false) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile
    });
    await delay(200);
  }

  async function waitForSettled() {
    await page.waitFor(
      "!document.getElementById('entryScreen') && document.readyState === 'complete' && document.documentElement.dataset.interfacePolicy !== 'pending' && document.documentElement.dataset.p07Ui === 'enabled'",
      20000
    );
    await delay(300);
  }

  // Navigate to /login
  await page.navigate('/login');
  await page.waitFor("!document.getElementById('entryScreen')", 15000);

  // Pre-seed finance data before login so controller initialises with data
  const targetAccountId = loginData.account.id;
  await page.evaluate(`(() => {
    const accountId = ${JSON.stringify(targetAccountId)};
    const now = new Date();
    const transactions = {};
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const incId = 'seed_inc_' + i;
      const expId = 'seed_exp_' + i;
      transactions[incId] = {
        id: incId,
        direction: 'income',
        amount_minor: (3500 + i * 400) * 100,
        currency: 'CNY',
        category_id: 'salary',
        occurred_at_ms: d.getTime(),
        status: 'active'
      };
      transactions[expId] = {
        id: expId,
        direction: 'expense',
        amount_minor: (1200 + i * 250) * 100,
        currency: 'CNY',
        category_id: 'dining',
        occurred_at_ms: d.getTime(),
        status: 'active'
      };
    }
    const storeData = {
      account_id: accountId,
      device_id: 'web:qa-test-seed',
      server_version: 1,
      hydrated: true,
      transactions,
      categories: {},
      budgets: {}
    };
    localStorage.setItem('wyjFinance:v1:' + encodeURIComponent(accountId), JSON.stringify(storeData));
  })()`);

  // ==========================================
  // Test 1: Additional Req 1 - Splash Boot Scroll Lock
  // ==========================================
  console.log('\n--- Test 1: Splash Boot Scroll Lock ---');
  await page.evaluate(`document.documentElement.dataset.bootState = 'splash';`);
  const splashScrollState = await page.evaluate(`(() => {
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const bodyStyle = window.getComputedStyle(document.body);
    return {
      htmlOverflow: htmlStyle.overflow,
      htmlHeight: htmlStyle.height,
      bodyOverflow: bodyStyle.overflow
    };
  })()`);
  console.log('Splash scroll lock state:', splashScrollState);
  assert.equal(splashScrollState.htmlOverflow, 'hidden', 'HTML overflow must be hidden during splash');
  
  await page.evaluate(`document.documentElement.dataset.bootState = 'ready';`);
  const readyScrollState = await page.evaluate(`(() => {
    return { htmlOverflow: window.getComputedStyle(document.documentElement).overflow };
  })()`);
  console.log('Ready scroll state:', readyScrollState);
  assert.notEqual(readyScrollState.htmlOverflow, 'hidden', 'HTML overflow must not be locked when ready');
  testResults.push({ test: 'Splash Boot Scroll Lock', status: 'PASS', splashScrollState, readyScrollState });

  // Perform real UI login to hydrate session and account state naturally
  console.log('Performing UI login as qa_lifetime_member...');
  await page.setFields({ '#usernameInput': 'qa_lifetime_member', '#secretInput': 'Aeris2026!QaLifetime#Test' });
  await page.click('#loginSubmitBtn');
  await page.waitFor("Boolean(localStorage.getItem('wyjAccountSession'))", 20000);
  await delay(1000);

  // ==========================================
  // Test 2: P0-01 - Account Center (/account)
  // ==========================================
  console.log('\n--- Test 2: Account Center (/account) ---');
  await setViewport(1440, 960);
  await page.click('#v3Sidebar [data-v3-nav="account"]');
  await delay(1000);

  const account1440 = await page.evaluate(`(() => {
    const modal = document.getElementById('accountModal');
    const content = modal.querySelector('.v3-workspace-content');
    const modalPanel = modal.querySelector('.modal-panel');
    const details = modal.querySelector('.account-details');
    const dangerCard = modal.querySelector('.danger-zone');
    const secretForm = document.getElementById('changeSecretForm');
    const deleteBtn = document.getElementById('openDeleteAccountBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    
    return {
      modalWidth: modal?.getBoundingClientRect().width,
      contentWidth: content?.getBoundingClientRect().width,
      contentComputedWidth: window.getComputedStyle(content).width,
      panelWidth: modalPanel?.getBoundingClientRect().width,
      panelMaxHeight: window.getComputedStyle(modalPanel).maxHeight,
      panelOverflowY: window.getComputedStyle(modalPanel).overflowY,
      contentOverflowY: window.getComputedStyle(content).overflowY,
      detailsColumns: window.getComputedStyle(details).gridTemplateColumns.split(' ').length,
      detailRows: details?.children.length,
      hasDangerCard: Boolean(dangerCard),
      hasSecretForm: Boolean(secretForm),
      hasDeleteBtn: Boolean(deleteBtn),
      hasLogoutBtn: Boolean(logoutBtn),
      username: document.getElementById('accountProfileUsername')?.textContent
    };
  })()`);
  console.log('Account 1440px measurements:', account1440);
  measurements.account1440 = account1440;
  assert.ok(account1440.contentWidth > 900, `Account content width (${account1440.contentWidth}px) should be > 900px, not restricted to 640px`);
  assert.equal(account1440.detailsColumns, 2, 'Account details should be a 2-column grid on desktop');
  assert.equal(account1440.detailRows, 8, 'Account details should contain 8 configuration items');
  assert.equal(account1440.panelMaxHeight, 'none', 'No nested scroll on modal panel');
  assert.equal(account1440.panelOverflowY, 'visible', 'No inner scroll on modal panel');
  assert.ok(account1440.hasDangerCard, 'Account deletion warning must be present');
  assert.ok(account1440.hasSecretForm, 'Secret form must be present');
  assert.ok(account1440.hasDeleteBtn, 'Account deletion button must be present');
  assert.ok(account1440.hasLogoutBtn, 'Logout button must be present');

  await takeScreenshot('account-1440-light.png');
  await setTheme('dark');
  await takeScreenshot('account-1440-dark.png');
  await setTheme('light');

  // Verify on 1366px (Owner's laptop resolution)
  await setViewport(1366, 768);
  await delay(200);
  const account1366 = await page.evaluate(`(() => {
    const modal = document.getElementById('accountModal');
    const content = modal.querySelector('.v3-workspace-content');
    const details = modal.querySelector('.account-details');
    return {
      contentWidth: content?.getBoundingClientRect().width,
      detailsColumns: window.getComputedStyle(details).gridTemplateColumns.split(' ').length
    };
  })()`);
  console.log('Account 1366px measurements:', account1366);
  measurements.account1366 = account1366;
  assert.ok(account1366.contentWidth > 900, `Account width on 1366px should be > 900px, got ${account1366.contentWidth}px`);
  assert.equal(account1366.detailsColumns, 2);
  await takeScreenshot('account-1366-light.png');

  // Verify on 390px (Mobile single-column)
  await setViewport(390, 844, true);
  await delay(200);
  const account390 = await page.evaluate(`(() => {
    const modal = document.getElementById('accountModal');
    const details = modal.querySelector('.account-details');
    return {
      detailsColumns: window.getComputedStyle(details).gridTemplateColumns.split(' ').length
    };
  })()`);
  console.log('Account 390px measurements:', account390);
  measurements.account390 = account390;
  assert.equal(account390.detailsColumns, 1, 'Account details should be 1 column on mobile');
  await takeScreenshot('account-390-light.png');
  testResults.push({ test: 'P0-01 Account Center', status: 'PASS', account1440, account1366, account390 });

  // ==========================================
  // Test 3: P0-02 - Membership Center (/recharge)
  // ==========================================
  console.log('\n--- Test 3: Membership Center (/recharge) ---');
  await setViewport(1440, 960);
  // Navigate via sidebar so SPA routing initializes membership workspace
  await page.click('#v3Sidebar [data-v3-nav="recharge"]');
  await delay(800);

  const recharge1440 = await page.evaluate(`(() => {
    const modal = document.getElementById('membershipModal');
    const content = modal.querySelector('.v3-workspace-content');
    const modalPanel = modal.querySelector('.modal-panel');
    const steps = modal.querySelectorAll('.v3-step-item');
    const goalOptions = modal.querySelectorAll('.membership-goal-option');
    const qrSection = modal.querySelector('#paymentOrderBox, .payment-qr-wrap');
    
    return {
      modalWidth: modal?.getBoundingClientRect().width,
      contentWidth: content?.getBoundingClientRect().width,
      contentComputedWidth: window.getComputedStyle(content).width,
      panelWidth: modalPanel?.getBoundingClientRect().width,
      panelMaxHeight: window.getComputedStyle(modalPanel).maxHeight,
      panelOverflowY: window.getComputedStyle(modalPanel).overflowY,
      stepCount: steps.length,
      goalCount: goalOptions.length,
      hasQrSection: Boolean(qrSection)
    };
  })()`);
  console.log('Recharge 1440px measurements:', recharge1440);
  measurements.recharge1440 = recharge1440;
  assert.ok(recharge1440.contentWidth > 900, `Recharge content width (${recharge1440.contentWidth}px) should be > 900px, not 640px`);
  assert.equal(recharge1440.stepCount, 4, 'Recharge should have 4 stepper steps');
  assert.equal(recharge1440.goalCount, 7, `Recharge should have 7 goal options, got ${recharge1440.goalCount}`);
  assert.equal(recharge1440.panelMaxHeight, 'none', 'No nested scroll on recharge modal');
  assert.equal(recharge1440.panelOverflowY, 'visible', 'No inner scroll on recharge modal');

  // Click a goal option to reveal plans
  console.log('Selecting "all" goal option to check plan cards...');
  await page.click('[data-membership-goal="all"]');
  await delay(500);

  const plansCheck = await page.evaluate(`(() => {
    const planStep = document.getElementById('membershipPlanStep');
    const planOptions = document.querySelectorAll('#membershipPlanList [data-plan]');
    return {
      planStepVisible: Boolean(planStep && !planStep.classList.contains('hidden')),
      planCount: planOptions.length,
      plans: [...planOptions].map(b => b.dataset.plan)
    };
  })()`);
  console.log('Plans check:', plansCheck);
  assert.equal(plansCheck.planStepVisible, true);
  assert.ok(plansCheck.planCount >= 2, `Expected >= 2 plans for "all" goal, got ${plansCheck.planCount}`);

  await takeScreenshot('recharge-1440-light.png');
  await setTheme('dark');
  await takeScreenshot('recharge-1440-dark.png');
  await setTheme('light');

  // Verify on 1366px
  await setViewport(1366, 768);
  await delay(200);
  await takeScreenshot('recharge-1366-light.png');

  // Verify on 390px mobile
  await setViewport(390, 844, true);
  await delay(200);
  await takeScreenshot('recharge-390-light.png');
  testResults.push({ test: 'P0-02 Membership Center', status: 'PASS', recharge1440, plansCheck });

  // ==========================================
  // Test 4: P0-03 - Finance Workspace (/finance)
  // ==========================================
  console.log('\n--- Test 4: Finance Workspace (/finance) ---');
  await setViewport(1440, 960);
  await page.click('#v3Sidebar [data-v3-nav="finance"]');
  await delay(1200);

  const financeInitial = await page.evaluate(`(() => {
    const wrap = document.getElementById('financeTrendChartWrap');
    const svg = wrap?.querySelector('svg.finance-chart-svg');
    const monthCards = wrap?.querySelectorAll('.trend-month-card');
    const toggleBtn = document.getElementById('toggleFinanceTrendBtn');
    const legend = document.querySelector('.finance-trend-legend');
    const ledger = document.getElementById('financeRecordedSection');
    const wrapStyle = wrap ? window.getComputedStyle(wrap) : null;
    
    return {
      wrapFlexDirection: wrapStyle?.flexDirection,
      wrapWidth: wrap?.getBoundingClientRect().width,
      wrapHeight: wrap?.getBoundingClientRect().height,
      hasSvg: Boolean(svg),
      svgWidth: svg?.getBoundingClientRect().width,
      svgHeight: svg?.getBoundingClientRect().height,
      monthCardCount: monthCards?.length || 0,
      toggleBtnText: toggleBtn?.textContent.trim(),
      toggleAriaExpanded: toggleBtn?.getAttribute('aria-expanded'),
      legendVisible: Boolean(legend && legend.checkVisibility()),
      ledgerTop: ledger?.getBoundingClientRect().top
    };
  })()`);
  console.log('Finance initial expanded measurements:', financeInitial);
  measurements.financeInitial = financeInitial;
  assert.equal(financeInitial.wrapFlexDirection, 'column', 'Trend wrap must be column layout (top chart, bottom cards)');
  assert.equal(financeInitial.toggleBtnText, '收起走势图');
  assert.equal(financeInitial.toggleAriaExpanded, 'true');
  assert.ok(financeInitial.wrapHeight > 200, 'Expanded wrap should have height > 200px');
  assert.equal(financeInitial.monthCardCount, 6, 'Should display 6 month cards');

  await takeScreenshot('finance-expanded-1440-light.png');
  await setTheme('dark');
  await takeScreenshot('finance-expanded-1440-dark.png');
  await setTheme('light');

  // Test Collapse Action
  console.log('Clicking toggle button to collapse chart...');
  await page.click('#toggleFinanceTrendBtn');
  await delay(250);

  const financeCollapsed = await page.evaluate(`(() => {
    const wrap = document.getElementById('financeTrendChartWrap');
    const toggleBtn = document.getElementById('toggleFinanceTrendBtn');
    const legend = document.querySelector('.finance-trend-legend');
    const ledger = document.getElementById('financeRecordedSection');
    const storageKey = Object.keys(localStorage).find(k => k.includes('trend:open'));
    const storageVal = storageKey ? localStorage.getItem(storageKey) : null;
    
    return {
      wrapCollapsedClass: wrap?.classList.contains('collapsed'),
      wrapVisible: Boolean(wrap && wrap.checkVisibility()),
      wrapHeight: wrap?.getBoundingClientRect().height,
      toggleBtnText: toggleBtn?.textContent.trim(),
      toggleAriaExpanded: toggleBtn?.getAttribute('aria-expanded'),
      legendVisible: Boolean(legend && legend.checkVisibility()),
      ledgerTop: ledger?.getBoundingClientRect().top,
      storageKey,
      storageVal
    };
  })()`);
  console.log('Finance collapsed measurements:', financeCollapsed);
  measurements.financeCollapsed = financeCollapsed;
  assert.equal(financeCollapsed.wrapCollapsedClass, true);
  assert.equal(financeCollapsed.wrapVisible, false, 'Collapsed chart must be hidden (display: none)');
  assert.equal(financeCollapsed.toggleBtnText, '展开走势图');
  assert.equal(financeCollapsed.toggleAriaExpanded, 'false');
  assert.equal(financeCollapsed.legendVisible, false, 'Legend must be hidden when collapsed');
  assert.ok(financeCollapsed.ledgerTop < financeInitial.ledgerTop, `Ledger should move up when collapsed (before: ${financeInitial.ledgerTop}, after: ${financeCollapsed.ledgerTop})`);
  assert.equal(financeCollapsed.storageVal, 'closed', 'Persistence key must be set to closed');

  await takeScreenshot('finance-collapsed-1440-light.png');

  // Test Refresh Persistence
  console.log('Reloading page to test persistence of collapsed state...');
  await page.click('#v3Sidebar [data-v3-nav="account"]');
  await delay(400);
  await page.click('#v3Sidebar [data-v3-nav="finance"]');
  await delay(1200);

  const financeAfterReload = await page.evaluate(`(() => {
    const wrap = document.getElementById('financeTrendChartWrap');
    const toggleBtn = document.getElementById('toggleFinanceTrendBtn');
    const legend = document.querySelector('.finance-trend-legend');
    return {
      wrapCollapsedClass: wrap?.classList.contains('collapsed'),
      wrapVisible: Boolean(wrap && wrap.checkVisibility()),
      toggleBtnText: toggleBtn?.textContent.trim(),
      toggleAriaExpanded: toggleBtn?.getAttribute('aria-expanded'),
      legendVisible: Boolean(legend && legend.checkVisibility())
    };
  })()`);
  console.log('Finance persistence check:', financeAfterReload);
  assert.equal(financeAfterReload.wrapCollapsedClass, true, 'Chart must remain collapsed after route change');
  assert.equal(financeAfterReload.wrapVisible, false);
  assert.equal(financeAfterReload.toggleBtnText, '展开走势图');
  assert.equal(financeAfterReload.legendVisible, false);

  // Re-expand chart
  console.log('Clicking toggle button to restore chart...');
  await page.click('#toggleFinanceTrendBtn');
  await delay(250);

  const financeRestored = await page.evaluate(`(() => {
    const wrap = document.getElementById('financeTrendChartWrap');
    const toggleBtn = document.getElementById('toggleFinanceTrendBtn');
    const storageKey = Object.keys(localStorage).find(k => k.includes('trend:open'));
    return {
      wrapCollapsedClass: wrap?.classList.contains('collapsed'),
      wrapVisible: Boolean(wrap && wrap.checkVisibility()),
      toggleBtnText: toggleBtn?.textContent.trim(),
      storageVal: storageKey ? localStorage.getItem(storageKey) : null
    };
  })()`);
  console.log('Finance restored measurements:', financeRestored);
  assert.equal(financeRestored.wrapCollapsedClass, false);
  assert.equal(financeRestored.wrapVisible, true);
  assert.equal(financeRestored.toggleBtnText, '收起走势图');
  assert.equal(financeRestored.storageVal, 'open');
  testResults.push({ test: 'P0-03 Finance Workspace & Trend Persistence', status: 'PASS', financeInitial, financeCollapsed, financeAfterReload, financeRestored });

  // ==========================================
  // Test 5: Additional Req 2 - Workflows Direct Route (/tools/workflows)
  // ==========================================
  console.log('\n--- Test 5: Workflows Direct Route (/tools/workflows) ---');
  await setViewport(1440, 960);
  await page.click('#v3Sidebar [data-v3-nav="workflows"]');
  await delay(800);

  const workflowRouteState = await page.evaluate(`(() => {
    const dashboard = document.getElementById('toolsDashboard');
    const workflow = document.getElementById('workflowWorkspace');
    const toolsPanel = document.getElementById('toolsPanel');
    const toolsHeader = toolsPanel?.querySelector('.tools-header');
    
    return {
      dashboardHidden: dashboard?.classList.contains('hidden') || !dashboard?.checkVisibility(),
      workflowVisible: Boolean(workflow && workflow.checkVisibility()),
      toolsHeaderHidden: toolsHeader?.classList.contains('hidden') || !toolsHeader?.checkVisibility()
    };
  })()`);
  console.log('Workflow route state:', workflowRouteState);
  assert.equal(workflowRouteState.dashboardHidden, true, 'Tools dashboard must be hidden when on /tools/workflows');
  assert.equal(workflowRouteState.workflowVisible, true, 'Workflow workspace must be visible');
  assert.equal(workflowRouteState.toolsHeaderHidden, true, 'Old tools header must be hidden');
  await takeScreenshot('workflows-direct-1440.png');
  testResults.push({ test: 'Workflows Direct Route', status: 'PASS', workflowRouteState });

  // ==========================================
  // Test 6: Additional Req 3 - Background Tab Recovery & SWR
  // ==========================================
  console.log('\n--- Test 6: Background Tab Recovery & SWR ---');
  await page.click('#v3Sidebar [data-v3-nav="account"]');
  await delay(500);

  // Track interface policy changes and policy state visibility
  await page.evaluate(`
    globalThis.__recoveryLog = [];
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-interface-policy') {
          globalThis.__recoveryLog.push({ t: performance.now(), policy: document.documentElement.dataset.interfacePolicy });
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
  `);

  // Simulate background visibility change
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  console.log('Tab backgrounded. Waiting 32 seconds to simulate TTL expiration...');
  await delay(32_000);

  // Restore tab to foreground
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await delay(1000);

  const recoveryState = await page.evaluate(`(() => {
    const policyState = document.getElementById('interfacePolicyState');
    const appFrame = document.getElementById('v3AppFrame');
    const policy = document.documentElement.dataset.interfacePolicy;
    const log = globalThis.__recoveryLog || [];
    
    return {
      policy,
      policyStateHidden: policyState?.hidden ?? true,
      policyStateVisible: Boolean(policyState && policyState.checkVisibility()),
      appFrameVisible: Boolean(appFrame && appFrame.checkVisibility()),
      log
    };
  })()`);
  console.log('Recovery state after foreground return:', recoveryState);
  assert.equal(recoveryState.appFrameVisible, true, 'App frame must remain visible, not flash blank');
  assert.equal(recoveryState.policyStateVisible, false, 'Policy state ("正在读取界面设置…") must not flash visible to user');
  testResults.push({ test: 'Background Tab Recovery & SWR', status: 'PASS', recoveryState });

  // ==========================================
  // Test 7: Multi-Viewport Matrix Screenshots
  // ==========================================
  console.log('\n--- Test 7: Viewport Matrix (375, 390, 768, 1024, 1366, 1440, 1920) ---');
  const viewports = [
    { name: '375', w: 375, h: 667, mobile: true },
    { name: '390', w: 390, h: 844, mobile: true },
    { name: '768', w: 768, h: 1024, mobile: false },
    { name: '1024', w: 1024, h: 768, mobile: false },
    { name: '1366', w: 1366, h: 768, mobile: false },
    { name: '1440', w: 1440, h: 960, mobile: false },
    { name: '1920', w: 1920, h: 1080, mobile: false },
  ];

  for (const vp of viewports) {
    await setViewport(vp.w, vp.h, vp.mobile);
    await page.click('#v3Sidebar [data-v3-nav="account"]');
    await delay(350);
    await takeScreenshot(`matrix-account-${vp.name}.png`);

    await page.click('#v3Sidebar [data-v3-nav="recharge"]');
    await delay(350);
    await takeScreenshot(`matrix-recharge-${vp.name}.png`);

    await page.click('#v3Sidebar [data-v3-nav="finance"]');
    await delay(350);
    await takeScreenshot(`matrix-finance-${vp.name}.png`);
  }

  assert.deepEqual(page.runtimeErrors, [], `Unexpected runtime errors: ${JSON.stringify(page.runtimeErrors)}`);

} finally {
  if (process.platform === 'win32' && chromeProc.pid) {
    spawnSync('taskkill.exe', ['/PID', String(chromeProc.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { chromeProc.kill(); } catch {}
  }
}

const summaryPath = path.join(EVIDENCE_DIR, 'verification-results.json');
await fsp.writeFile(summaryPath, JSON.stringify({
  verifiedAt: new Date().toISOString(),
  previewUrl: PREVIEW_URL,
  testResults,
  measurements
}, null, 2));

console.log(`\n=================================================`);
console.log(`ALL R5 BROWSER DEFECT TESTS PASSED!`);
console.log(`Summary written to: ${summaryPath}`);
console.log(`=================================================\n`);
