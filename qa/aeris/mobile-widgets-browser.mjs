import { ASSET_RELEASE } from '../asset-release.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openPage } from '../../local-backend/browser_harness.mjs';

const baseUrl = process.env.WYJ_TEST_BASE || 'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
const p = await openPage({
  cdpUrl: process.env.WYJ_CDP_URL || 'http://127.0.0.1:9225',
  baseUrl,
  width: 1366,
  height: 900,
  mobile: false,
});

const ready = "!document.getElementById('entryScreen')&&!document.querySelector('#publicHome').classList.contains('hidden')";
const measurePublicMobile = `(()=>{
  const plans=document.querySelector('#publicPlansComparisonGrid');
  const gallery=document.querySelector('#publicCapabilityGallery');
  const gr=gallery.getBoundingClientRect();
  const pr=plans?plans.getBoundingClientRect():{left:0,right:0};
  return {
    width:innerWidth,
    height:innerHeight,
    overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    heroCards:document.querySelectorAll('.hero-scene-card').length,
    widgetEditor:Boolean(document.querySelector('#homeWidgetEditor')),
    galleryInside:gr.left>=-1&&gr.right<=innerWidth+1,
    wallInside:Boolean(plans)&&pr.left>=-1&&pr.right<=innerWidth+1,
  };
})()`;

const rows = [];
async function resize(width, height, coarse = false) {
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: coarse });
  await p.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: coarse,
  });
  await p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
}

try {
  await p.navigate('/');
  await p.waitFor(ready);

  // 1. Mobile I03 public pages across portrait and landscape phone viewports
  for (const [w, h] of [[360, 844], [390, 844], [412, 844], [430, 844], [844, 390], [1040, 390]]) {
    await resize(w, h, true);
    const v = await p.evaluate(measurePublicMobile);
    assert.ok(v.overflow <= 0, `mobile overflow at ${w}x${h}: ${v.overflow}`);
    assert.equal(v.heroCards, 0);
    assert.equal(v.widgetEditor, false);
    assert.ok(v.galleryInside && v.wallInside, `mobile container overflow at ${w}x${h}`);
    rows.push(v);
  }
  assert.equal(
    await p.evaluate("Object.keys(localStorage).some(k=>k.startsWith('aerisHomeWidgets:'))"),
    false,
    'guest session never leaks widget preferences',
  );

  // 2. Reduced motion retains readable static surfaces
  await resize(390, 844, true);
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reduced = await p.evaluate(`(()=>{
    const sb=document.querySelector('#v3Sidebar');
    return {
      sidebarDuration:sb?getComputedStyle(sb).transitionDuration:'none',
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    };
  })()`);
  assert.ok(reduced.overflow <= 0);
  await p.send('Emulation.setEmulatedMedia', { features: [] });

  // 3. Verify underlying mobile layout math & v1/v2 storage isolation retained for I04
  const boundsCheck = await p.evaluate(`(async()=>{
    const l=await import('/js/core/home-widget-layout.js?release=${ASSET_RELEASE}');
    const legacy={version:1,learning:{size:'large',rotation:-4,x:.8,y:.9,contentMode:'wrong'},finance:{size:'large',rotation:-6,x:1,y:1,contentMode:'income'},tools:{size:'small',rotation:4,x:0,y:.5,contentMode:'favorites'}};
    const sanitized=l.sanitizeHomeWidgets(legacy);
    let allInside=true;
    for(const width of [360,390,412,430]){
      for(const size of ['small','medium','large']){
        for(const rotation of [-6,6]){
          const prof=l.widgetProfile(l.defaultHomeWidgets(),'mobile');
          prof.finance={size,rotation,x:rotation<0?0:1,y:rotation<0?0:1};
          const out=l.layoutMobileWidgets(prof,width);
          const fin=out.finance;
          if(!(fin.box.x>=0&&fin.box.x+fin.box.width<=width+1))allInside=false;
        }
      }
    }
    return {
      v1MigratedIncome:sanitized.finance.contentMode==='income',
      v1DesktopKept:sanitized.finance.layouts.desktop.rotation===-6,
      v1MobileIndependent:sanitized.finance.layouts.mobile.rotation===-1.5,
      coarseLandscapeIsMobile:!l.isHomeWidgetDesktop(1040,390,true),
      allInside,
    };
  })()`);
  assert.equal(boundsCheck.v1MigratedIncome, true);
  assert.equal(boundsCheck.v1DesktopKept, true);
  assert.equal(boundsCheck.v1MobileIndependent, true);
  assert.equal(boundsCheck.coarseLandscapeIsMobile, true);
  assert.equal(boundsCheck.allInside, true);

  // 4. Authenticated login/logout transitions cleanly on mobile
  await p.navigate('/login');
  await p.waitFor("!document.getElementById('entryScreen')");
  await p.setFields({
    '#usernameInput': process.env.WYJ_TEST_ADMIN_USER || 'wyj',
    '#secretInput': process.env.WYJ_TEST_ADMIN_SECRET,
  });
  await p.click('#loginSubmitBtn');
  await p.waitFor(`${ready}&&document.querySelector('#publicHome').dataset.sessionMode==='authenticated'`, 30000);
  await p.evaluate("document.querySelector('#accountMenu').open=true");
  await p.click('#logoutBtn');
  await p.waitFor("document.querySelector('#publicHome').dataset.sessionMode==='guest'");

  assert.deepEqual(p.runtimeErrors, []);
  const output = path.resolve(process.env.MOBILE_WIDGET_OUTPUT || 'artifacts/aeris-mobile/mobile-profile-browser.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ pass: true, boundsCheck, reduced, rows }, null, 2));
  console.log(JSON.stringify({ pass: true, viewports: rows.length, zeroOverflow: true, layoutMathPreserved: true }));
} finally {
  await p.close();
}
