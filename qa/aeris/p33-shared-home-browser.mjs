import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const cases=[],restores=[];
const geometry=`(()=>{const home=document.querySelector('#publicHome'),rect=e=>{if(!e)return {x:0,y:0,width:0,height:0,display:'none',visibility:'hidden',transform:'none'};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,display:s.display,visibility:s.visibility,transform:s.transform};};return {width:innerWidth,session:home.dataset.sessionMode,home:rect(home),guestLauncher:rect(home.querySelector('#guestHomeLauncher')),authLauncher:rect(home.querySelector('#authHomeLauncher')),active:rect(home.querySelector('.aeris-product-panel.active')),window:rect(home.querySelector('[data-product-window]')),shortcuts:home.querySelectorAll('#homeQuickShortcuts .gpt-shortcut-chip').length,legacy:rect(document.querySelector('#modulePicker')),duplicateHomes:document.querySelectorAll('#publicHome').length,launchpads:document.querySelectorAll('.aeris-launchpad-card,.aeris-launchpad-heading,#publicBentoWall').length,overflow:document.documentElement.scrollWidth-innerWidth};})()`;
const rendered=r=>r.width>0&&r.height>0&&r.display!=='none'&&r.visibility!=='hidden';
function check(g,width,session){
  assert.equal(g.width,width);assert.equal(g.session,session);assert.equal(g.duplicateHomes,1);assert.equal(g.launchpads,0);assert.equal(g.legacy.height,0);
  if(session==='guest'){
    for(const key of ['home','guestLauncher','active','window'])assert.ok(rendered(g[key]),`${session} ${width} ${key} must render`);
  }else{
    for(const key of ['home','authLauncher'])assert.ok(rendered(g[key]),`${session} ${width} ${key} must render`);
    assert.ok(g.shortcuts>=4);
  }
  assert.ok(g.overflow<=1);
}
for(const width of [320,390,1366,1920]){
  const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:900,mobile:width<=390});
  // Widget ResizeObserver work is applied on the next frame after a viewport or route change.
  const settleLayout=()=>page.evaluate("document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))");
  try{
    await page.navigate('/');await page.waitFor("document.documentElement.dataset.aerisMotionReady==='true' && !document.getElementById('entryScreen') && !document.querySelector('#publicHome').classList.contains('hidden')");
    await page.evaluate("window.__p33Home=document.querySelector('#publicHome');window.__p33Skeleton=[...window.__p33Home.querySelectorAll('#guestHomeLauncher,#authHomeLauncher,[role=tabpanel]')];true");
    for(const session of ['guest','authenticated']){
      if(session==='authenticated'){
        await page.click('#publicLoginBtn');await page.waitFor("location.pathname==='/login'");await page.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await page.click('#loginSubmitBtn');
        await page.waitFor("location.pathname==='/' && document.querySelector('#publicHome').dataset.sessionMode==='authenticated' && !document.querySelector('#publicHome').classList.contains('hidden')",30000,'actual login returns to shared root');
        assert.ok(await page.evaluate("document.querySelector('#accountBadge').textContent.includes("+JSON.stringify(process.env.WYJ_TEST_ADMIN_USER||'wyj')+")"));
        assert.equal(await page.evaluate("window.__p33Home===document.querySelector('#publicHome') && window.__p33Skeleton.every((n,i)=>n===document.querySelectorAll('#publicHome #guestHomeLauncher,#publicHome #authHomeLauncher,#publicHome [role=tabpanel]')[i])"),true,'sign-in must retain the exact original DOM, not mount another template');
      }
      for(const theme of ['light','dark']){
        await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        const previews=[];
        if(session==='guest'){
          for(const kind of ['learning','tools','finance','files']){
            await page.click(`[data-public-product=${kind}]`);await page.waitFor(`document.querySelector('[data-product-window]').dataset.selected===${JSON.stringify(kind)}`);const g=await page.evaluate(geometry);check(g,width,session);previews.push({kind,geometry:g});
            await page.send('Emulation.setDeviceMetricsOverride',{width:Math.floor(width/2),height:450,deviceScaleFactor:2,mobile:false});await settleLayout();const reflow=await page.evaluate(geometry);assert.equal(reflow.width,Math.floor(width/2));assert.ok(reflow.overflow<=1);await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=390});await settleLayout();
          }
        }else{
          const g=await page.evaluate(geometry);check(g,width,session);previews.push({kind:'launcher',geometry:g});
        }
        const copy=await page.evaluate("document.querySelector('#publicHome').textContent");for(const phrase of ['一个账户，日常所需','一处继续','清楚、可靠的产品','不是功能清单','继续今天的事'])assert.equal(copy.includes(phrase),false);
        assert.ok(await page.evaluate("document.querySelector('#publicCapabilitiesTitle').textContent.length > 0 && document.querySelector('#dashboardGreeting').textContent.length >= 0"));
        assert.deepEqual(page.runtimeErrors,[]);cases.push({width,theme,session,previews,aiTemplateReduction:true});
      }
      if(session==='authenticated'){
        const sessionValue=await page.evaluate("localStorage.getItem('wyjAccountSession')");assert.ok(sessionValue?.length>20);const fingerprint=createHash('sha256').update(sessionValue).digest('hex');
        for(const route of ['/','/select','/?native-navigation=1']){
          await page.navigate(route);await page.waitFor("!document.getElementById('entryScreen') && !document.querySelector('#publicHome').classList.contains('hidden') && document.querySelector('#publicHome').dataset.sessionMode==='authenticated'",30000,'session restored shared home');await settleLayout();check(await page.evaluate(geometry),width,'authenticated');assert.equal(await page.evaluate("localStorage.getItem('wyjAccountSession')"),sessionValue);
          if(route.includes('native-navigation'))assert.equal(await page.evaluate("Boolean(window.WYJAndroidNavigation)"),true);
        }
        await page.send('Page.reload',{ignoreCache:true});await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#publicHome').dataset.sessionMode==='authenticated' && !document.querySelector('#publicHome').classList.contains('hidden') && document.querySelector('#publicHome').getBoundingClientRect().height > 0",30000,'hard reload restores visible authenticated home');await settleLayout();check(await page.evaluate(geometry),width,'authenticated');assert.equal(await page.evaluate("localStorage.getItem('wyjAccountSession')"),sessionValue);
        restores.push({width,realLogin:true,hardReload:true,aliasSelect:true,nativeRouteBridge:true,sessionFingerprint:fingerprint,home:'/',sameTemplate:true});
      }
    }
  }finally{await page.close();}
}
const result={pass:true,guestCases:cases.filter(x=>x.session==='guest').length,authenticatedCases:cases.filter(x=>x.session==='authenticated').length,cases,restores};
const output=path.resolve(process.env.AERIS_P33_OUTPUT||'artifacts/aeris-p33-shared-home.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({pass:true,guestCases:result.guestCases,authenticatedCases:result.authenticatedCases,restores:restores.length}));
