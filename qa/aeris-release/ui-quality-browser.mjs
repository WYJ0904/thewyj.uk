import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';

// Independent UI contracts against a real browser and the served application.
// No account creation, payment, financial writes, AI requests or profile deletion.
const origin = new URL(process.env.WYJ_BASE_URL || process.env.WYJ_TEST_BASE || 'http://127.0.0.1:8788').origin;
const host = new URL(origin).hostname;
assert(host === '127.0.0.1' || host === 'localhost' ||
  (origin === process.env.AERIS_UI_ALLOWED_ORIGIN && host.endsWith('.pages.dev')),
  'Use localhost or the exact explicitly allowed isolated Pages origin');
const out = path.resolve(process.env.AERIS_UI_EVIDENCE_DIR ||
  `artifacts/aeris-ui-quality/${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out, { recursive: false });
const checks = [], viewports = [];
let page;
const key = async (name, shift = false) => {
  const code = { Enter: 13, Tab: 9, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Escape: 27 }[name];
  const params = { key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
  // Enter needs a character event as well as its virtual key. Without text,
  // CDP delivered keydown but never activated the focused native button.
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params,
    ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
};
const check = async (id, run) => {
  try { const actual = await run(); checks.push({ id, status: 'PASS', actual }); }
  catch (error) { checks.push({ id, status: 'FAIL', error: error.stack }); }
};
const policy = async enabled => page.evaluate(String.raw`window.__uiQualityDesign.setInterfaceEnhancementsEnabled(${enabled}); true`);
const screenshot = async name => {
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(result.data, 'base64'));
};
const screenshotWidgets = async name => {
  const clip = await page.evaluate(String.raw`(() => {const rect=document.querySelector('#publicHome .public-hero-scene').getBoundingClientRect();return {x:Math.max(0,rect.x+scrollX),y:Math.max(0,rect.y+scrollY),width:Math.min(innerWidth,rect.width),height:rect.height,scale:1};})()`);
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  await fs.writeFile(path.join(out, `${name}-widgets.png`), Buffer.from(result.data, 'base64'));
};

try {
  page = await openPage({ cdpUrl: process.env.WYJ_CDP_URL || 'http://127.0.0.1:9225', baseUrl: origin, width: 1440, height: 960, mobile: false });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete globalThis.__WYJ_TEST_MODE__;' });
  await page.navigate('/login');
  await page.waitFor("!document.getElementById('entryScreen') && document.getElementById('authPanel').getClientRects().length > 0", 30000, 'real guest login route');
  await page.evaluate(String.raw`(async () => {
    const script = [...document.scripts].find(node => /\/app\.js(?:\?|$)/.test(node.src));
    const source = await fetch(script.src).then(response => response.text());
    const match = source.match(/from\s+["']([^"']*\/design-system\.js[^"']*)["']/);
    if (!match) throw new Error('Served design-system import missing');
    window.__uiQualityDesign = await import(new URL(match[1], script.src).href);
    return true;
  })()`);

  await check('aeris-brand-and-pwa', async () => {
    const actual = await page.evaluate(String.raw`(async () => ({title:document.title,
      application:document.querySelector('meta[name="application-name"]').content,
      site:document.querySelector('meta[property="og:site_name"]')?.content,
      canonicalDomain:document.querySelector('meta[property="og:url"]').content,
      manifest:await fetch(document.querySelector('link[rel="manifest"]').href).then(response=>response.json()),
      testMode:globalThis.__WYJ_TEST_MODE__===true}))()`);
    assert(actual.title.startsWith('Aeris')); assert.equal(actual.application, 'Aeris'); assert.equal(actual.site, 'Aeris');
    assert.equal(actual.manifest.name, 'Aeris'); assert.equal(actual.manifest.short_name, 'Aeris');
    assert.equal(actual.canonicalDomain, 'https://thewyj.uk/'); assert.equal(actual.testMode, false);
    return actual;
  });
  await check('permanent-labels-and-tab-associations', async () => {
    const actual = await page.evaluate(String.raw`(() => ({
      labels:['wordInput','answerInput','currentSecretInput','newSecretInput','newSecretConfirmInput','deleteSecretInput','adminNewSecretInput'].map(id=>({id,count:document.getElementById(id).labels.length})),
      broken:[...document.querySelectorAll('.auth-tabs [role="tab"], .feedback-tabs [role="tab"], .admin-tabs [role="tab"], #workspace > .tabs [role="tab"]')].filter(tab=>{
        const panel=document.getElementById(tab.getAttribute('aria-controls'));
        return !tab.id || !panel || panel.getAttribute('role')!=='tabpanel' || panel.getAttribute('aria-labelledby')!==tab.id;
      }).map(tab=>tab.id)
    }))()`);
    assert(actual.labels.every(item => item.count === 1)); assert.deepEqual(actual.broken, []); return actual;
  });
  await check('real-skip-link-enter', async () => {
    await policy(true); await page.evaluate("document.getElementById('skipToContent').focus()"); await key('Enter');
    const actual = await page.evaluate(String.raw`({target:document.activeElement.id,hasAuth:document.activeElement.contains(document.getElementById('authPanel')),hasNavigation:document.activeElement.contains(document.getElementById('accountBar'))})`);
    assert(actual.hasAuth && !actual.hasNavigation); return actual;
  });
  await check('auth-tabs-arrow-home-end-and-roving-focus', async () => {
    await policy(true); await page.evaluate("document.getElementById('showLoginBtn').click();document.getElementById('showLoginBtn').focus()");
    await key('ArrowRight'); assert.equal(await page.evaluate('document.activeElement.id'), 'showRegisterBtn');
    assert.equal(await page.evaluate("document.getElementById('registerForm').classList.contains('hidden')"), false);
    await key('Home'); assert.equal(await page.evaluate('document.activeElement.id'), 'showLoginBtn');
    assert.deepEqual(await page.evaluate("[...document.querySelectorAll('.auth-tabs [role=tab]')].map(tab=>tab.tabIndex)"), [0, -1]);
    await key('End'); assert.equal(await page.evaluate('document.activeElement.id'), 'showRegisterBtn');
    await key('Home'); return { keyboard: true, registrationAndLoginRetained: true };
  });
  await check('native-validation-inline-association-and-kill-reset', async () => {
    await page.evaluate("document.getElementById('showLoginBtn').click()");
    await policy(true);
    const invalid = await page.evaluate(String.raw`(() => {document.getElementById('loginForm').reportValidity();const input=document.getElementById('usernameInput');return {invalid:input.getAttribute('aria-invalid'),description:input.getAttribute('aria-describedby'),message:document.getElementById('p07-validation-usernameInput')?.textContent};})()`);
    assert.equal(invalid.invalid, 'true'); assert(invalid.description.includes('p07-validation-usernameInput')); assert(invalid.message);
    await page.setFields({ '#usernameInput': 'synthetic-ui-validation' });
    assert.equal(await page.evaluate("document.getElementById('p07-validation-usernameInput')"), null);
    await policy(false);
    assert.equal(await page.evaluate("document.querySelectorAll('.field-validation').length"), 0);
    assert.equal(await page.evaluate("document.getElementById('secretInput').hasAttribute('aria-invalid')"), false);
    return { nativeValidationRetained: true, messagesClearedOnKill: true };
  });
  await check('admin-feedback-keyboard-contracts-with-hidden-disabled-tabs', async () => {
    // Read-only DOM disclosure of the real markup, without login, data reads or
    // permission changes. The next suite separately exercises real modal entry.
    await policy(true);
    await page.evaluate(String.raw`document.getElementById('adminPanel').classList.remove('hidden');document.getElementById('adminPanel').setAttribute('aria-hidden','false');document.getElementById('adminRechargeTab').disabled=true;document.getElementById('adminUsersTab').focus();true`);
    await key('ArrowRight'); assert.equal(await page.evaluate('document.activeElement.id'), 'adminAuditTab');
    await key('End'); assert.equal(await page.evaluate('document.activeElement.id'), 'adminMessagesTab');
    await key('Home'); assert.equal(await page.evaluate('document.activeElement.id'), 'adminUsersTab');
    await page.evaluate(String.raw`document.getElementById('adminRechargeTab').disabled=false;document.getElementById('adminPanel').classList.add('hidden');document.getElementById('adminPanel').setAttribute('aria-hidden','true');document.getElementById('feedbackModal').classList.remove('hidden');document.getElementById('feedbackModal').setAttribute('aria-hidden','false');document.getElementById('feedbackSubmitTab').focus();true`);
    await key('End'); assert.equal(await page.evaluate('document.activeElement.id'), 'feedbackVotingTab');
    assert.equal(await page.evaluate("document.getElementById('feedbackVotingView').classList.contains('active')"), true);
    await key('Home'); assert.equal(await page.evaluate('document.activeElement.id'), 'feedbackSubmitTab');
    await page.evaluate(String.raw`document.getElementById('feedbackModal').classList.add('hidden');document.getElementById('feedbackModal').setAttribute('aria-hidden','true');true`);
    return { realMarkupDomFixture: true, hiddenAndDisabledSkipped: true, noAdminWrites: true };
  });
  await check('menu-summary-entry-arrows-and-escape', async () => {
    await policy(true);
    await page.evaluate(String.raw`(() => {const menu=document.getElementById('accountMenu');menu.classList.remove('hidden');menu.querySelectorAll('[role=menuitem]').forEach(button=>button.classList.remove('hidden'));menu.open=false;menu.querySelector('summary').focus();})()`);
    await key('ArrowDown'); assert.equal(await page.evaluate('document.activeElement.id'), 'homeBtn');
    await key('End'); assert.equal(await page.evaluate('document.activeElement.id'), 'logoutBtn');
    await key('Escape'); assert.equal(await page.evaluate("document.getElementById('accountMenu').open"), false);
    assert.equal(await page.evaluate("document.activeElement===document.querySelector('#accountMenu > summary')"), true);
    await page.evaluate("document.getElementById('accountMenu').classList.add('hidden')");
    return { realMenuDomFixture: true, businessActionsTriggered: 0 };
  });
  await check('actual-nested-modal-focus-trap-return-and-valid-targets', async () => {
    await policy(true);
    await page.evaluate("document.getElementById('showLoginBtn').focus();document.getElementById('accountBtn').click()");
    assert.equal(await page.evaluate("document.getElementById('appShell').inert"), true);
    assert.equal(await page.evaluate("document.activeElement.closest('#accountModal')?.id"), 'accountModal');
    await page.evaluate("document.getElementById('openDeleteAccountBtn').focus()");
    await key('Enter');
    assert.equal(await page.evaluate("document.activeElement.hasAttribute('data-dialog-initial-focus')"), true);
    assert.equal(await page.evaluate("document.getElementById('accountModal').inert"), true);
    await page.evaluate("document.getElementById('deleteSecretInput').focus()"); await key('Tab', true);
    assert.equal(await page.evaluate('document.activeElement.id'), 'confirmDeleteAccountBtn');
    await key('Tab'); assert.equal(await page.evaluate('document.activeElement.id'), 'deleteSecretInput');
    const excluded = await page.evaluate(String.raw`(() => {
      const layer=document.getElementById('deleteAccountModal');const input=document.createElement('input');input.id='uiQualityNegativeTab';input.tabIndex=-1;layer.append(input);
      const targets=window.__uiQualityDesign.dialogFocusTargets(layer).map(node=>node.id);
      input.remove();return targets;
    })()`);
    assert(!excluded.includes('uiQualityNegativeTab'));
    await key('Escape');
    await page.waitFor("document.getElementById('deleteAccountModal').classList.contains('hidden')");
    assert.equal(await page.evaluate('document.activeElement.id'), 'openDeleteAccountBtn');
    await key('Escape');
    await page.waitFor("document.getElementById('accountModal').classList.contains('hidden')");
    assert.equal(await page.evaluate("document.getElementById('appShell').inert"), false);
    assert.equal(await page.evaluate('document.activeElement.id'), 'showLoginBtn');
    return { nestedFocusRestored: true, destructiveActionTriggered: false, negativeTabindexExcluded: true };
  });
  await check('empty-dialog-fallback-keeps-tab-focus', async () => {
    await page.evaluate(String.raw`(() => {const layer=document.createElement('div');layer.id='uiQualityEmptyDialog';layer.className='modal-layer';layer.innerHTML='<section class="modal-panel" role="dialog" aria-label="UI quality empty dialog"></section>';document.body.append(layer);window.__uiQualityDesign.focusDialog(layer);})()`);
    assert.equal(await page.evaluate("document.activeElement.getAttribute('role')"), 'dialog');
    await key('Tab'); assert.equal(await page.evaluate("document.activeElement.getAttribute('role')"), 'dialog');
    await page.evaluate("document.getElementById('uiQualityEmptyDialog').remove()");
    return { noFocusableControlsFallback: true };
  });
  await check('dark-and-light-danger-button-contrast', async () => {
    const actual = [];
    for (const theme of ['light', 'dark']) {
      actual.push(await page.evaluate(String.raw`(() => {
        document.documentElement.dataset.theme=${JSON.stringify(theme)};
        const style=getComputedStyle(document.getElementById('acceptConfirmBtn'));
        const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
        const a=luminance(style.color),b=luminance(style.backgroundColor);
        return {theme:${JSON.stringify(theme)},foreground:style.color,background:style.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      })()`));
    }
    assert(actual.every(item => item.ratio >= 4.5)); return actual;
  });
  await check('flag-off-removes-keyboard-enhancements-and-labels', async () => {
    await page.evaluate("document.getElementById('showLoginBtn').click();document.getElementById('showLoginBtn').focus()");
    // Route selection reapplies the current server decision. Set the isolated
    // component policy only after preparing the visible Login tab.
    await policy(false);
    await key('ArrowRight'); assert.equal(await page.evaluate('document.activeElement.id'), 'showLoginBtn');
    assert.deepEqual(await page.evaluate("[...document.querySelectorAll('.auth-tabs [role=tab]')].map(tab=>tab.tabIndex)"), [0, 0]);
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('label[for=wordInput]')).display"), 'none');
    return { accountGateUntouched: true, uiDisabled: true };
  });

  await page.navigate('/');
  await page.waitFor("!document.getElementById('entryScreen') && document.getElementById('publicHome').getClientRects().length > 0", 30000, 'real public home');
  // Navigation creates a new module instance. Resolve its served asset identity.
  await page.evaluate(String.raw`(async () => {const script=[...document.scripts].find(node=>/\/app\.js(?:\?|$)/.test(node.src));const source=await fetch(script.src).then(response=>response.text());const match=source.match(/from\s+["']([^"']*\/design-system\.js[^"']*)["']/);window.__uiQualityDesign=await import(new URL(match[1],script.src).href);return true;})()`);
  await check('portrait-landscape-tablet-and-enlarged-text-reflow', async () => {
    for (const [name, width, height, mobile] of [['small',320,740,true],['phone',390,844,true],['landscape',844,390,true],['tablet',768,1024,false],['desktop',1440,960,false]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      for (const scale of [1, 2]) {
        await policy(true);
        await page.evaluate(String.raw`document.documentElement.style.fontSize=${JSON.stringify(`${scale * 100}%`)};window.dispatchEvent(new Event('resize'));true`);
        await delay(250);
        const actual = await page.evaluate(String.raw`(() => {const cards=[...document.querySelectorAll('#publicHome [data-home-widget]')].map(node=>{const r=node.getBoundingClientRect();return {id:node.dataset.homeWidget,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});const clippedControls=[...document.querySelectorAll('#accountBar a,#accountBar button,#accountBar summary,#publicHome .public-actions>*')].filter(node=>node.getClientRects().length && getComputedStyle(node).visibility==='visible' && !node.closest('[aria-hidden="true"],[inert]')).filter(node=>{const r=node.getBoundingClientRect();return r.left< -1 || r.right>innerWidth+1;}).map(node=>node.id||node.textContent.trim());return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,largeText:document.documentElement.dataset.largeText,cards,clippedControls,smallControls:[...document.querySelectorAll('#homeLayoutReset,.site-release-actions>a')].filter(node=>node.getClientRects().length).map(node=>({id:node.id,height:node.getBoundingClientRect().height}))};})()`);
        viewports.push({ name, width, height, scale, ...actual });
        await screenshot(`${name}-text-${scale * 100}`);
        if (scale === 2) await screenshotWidgets(`${name}-text-${scale * 100}`);
        assert(actual.scrollWidth <= actual.width + 1, `${name} at ${scale * 100}% text overflows`);
        assert.deepEqual(actual.clippedControls, [], `${name} at ${scale * 100}% has clipped navigation/actions`);
        assert(actual.smallControls.every(control => control.height >= 43), '44px touch target contract');
        if (scale === 2) {
          assert.equal(actual.largeText, 'true');
          assert(actual.cards.every(card => card.x >= -1 && card.right <= actual.width + 1), 'Enlarged widget stays on screen');
          for (let i = 0; i < actual.cards.length; i++) for (let j = i + 1; j < actual.cards.length; j++) {
            const a = actual.cards[i], b = actual.cards[j];
            assert(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, 'Enlarged widgets must not overlap');
          }
        }
      }
    }
    return { combinations: viewports.length, textSizeMethod: 'Root font 100% and 200%, separate from browser page zoom', fieldCWV: false };
  });
  await check('reduced-motion-final-state', async () => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await delay(80);
    const actual = await page.evaluate("document.getAnimations().filter(animation=>animation.playState==='running' && Number(animation.effect?.getTiming().duration)>1).map(animation=>animation.animationName)");
    assert.deepEqual(actual, []); return { runningLongAnimations: actual };
  });
  await check('runtime-no-exceptions-or-js-dialogs', async () => {
    assert.deepEqual(page.runtimeErrors, []); assert.deepEqual(page.dialogs, []); return { exceptions: [], dialogs: [] };
  });
} catch (error) { checks.push({ id: 'environment-or-setup', status: 'FAIL', error: error.stack }); }
finally {
  if (page) { try { await page.close(); } catch (error) { checks.push({ id: 'close-browser-context', status: 'FAIL', error: error.message }); } }
  const report = { origin, evidence: 'REAL_CHROME_LOCAL_OR_EXPLICIT_ISOLATED_PREVIEW', checks, viewports,
    passed: checks.filter(item=>item.status==='PASS').length, failed: checks.filter(item=>item.status==='FAIL').length,
    limits: ['DOM disclosure fixtures are not authenticated role acceptance', 'Root font scaling is not browser page zoom or assistive technology acceptance', 'No field Core Web Vitals claim'],
    protected: { productionWrites: 0, paymentRequests: 0, paidAiCalls: 0, profileDeletes: 0 } };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: out, passed: report.passed, failed: report.failed, checks: checks.map(({id,status,error})=>({id,status,...(error?{error}: {})})) }, null, 2));
  if (report.failed) process.exitCode = 1;
}
