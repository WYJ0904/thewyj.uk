import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const base=new URL(process.env.WYJ_TEST_BASE||'http://127.0.0.1:18919').origin;
const local=new URL(base).hostname==='127.0.0.1';
assert.ok(local || base.endsWith('.thewyj-p07-ui-rc.pages.dev'));
const output=path.resolve(process.env.AERIS_PHASE1_EVIDENCE_DIR||path.join(root,'.wrangler/p07-independent/gaps'));
await fs.mkdir(output,{recursive:true});
const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:19319',baseUrl:base,width:1440,height:960,mobile:false});
await page.send('Page.bringToFront');
await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete globalThis.__WYJ_TEST_MODE__;'});
const checks=[];let identityA,identityB,savedA;
async function shot(name){const value=await page.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name+'.png'),Buffer.from(value.data,'base64'));}
async function check(id,fn){try{const detail=await fn();checks.push({id,status:'PASS',detail});console.log('PASS '+id);}catch(error){await shot('failure-'+id).catch(()=>{});checks.push({id,status:'FAIL',error:error.stack});console.log('FAIL '+id+': '+error.message);}}
async function key(name){const vk={Tab:9,Enter:13,Escape:27,ArrowDown:40,ArrowRight:39}[name];for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:vk});}
async function ready(){await page.waitFor("document.documentElement.dataset.p07Ui==='enabled'&&!document.getElementById('publicHome').classList.contains('hidden')",30000);}
async function edit(card,fields){await page.click(`[data-widget-edit=${card}]`);await page.waitFor("document.getElementById('homeWidgetEditor').open");await page.setFields(Object.fromEntries(Object.entries(fields).map(([name,value])=>[`#homeWidgetEditor [name=${name}]`,value])));await page.click('#homeWidgetEditor [type=submit]');await page.waitFor("!document.getElementById('homeWidgetEditor').open");}
async function currentId(){return page.evaluate("(async()=>{const r=await fetch('/api/me',{headers:{'X-Session-Token':localStorage.getItem('wyjAccountSession')}});if(r.status!==200)throw Error('Authenticated fixture unavailable');return (await r.json()).account.id})()");}
async function login(user){await page.navigate('/login');await page.setFields({'#usernameInput':user.username,'#secretInput':user.secret});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'&&document.getElementById('publicHome').dataset.sessionMode==='authenticated'",30000);await ready();return currentId();}
async function logout(){await page.evaluate("document.getElementById('accountMenu').open=true;true");await page.click('#logoutBtn');await page.waitFor("document.getElementById('publicHome').dataset.sessionMode==='guest'");}
const stored=id=>page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify('aerisHomeWidgets:v2:'+encodeURIComponent(id))})||'null')`);
async function touch(selector){
  const point=await page.evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});
    await Promise.all((e.closest('dialog')?.getAnimations({subtree:true})||[]).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);
    if(e!==hit&&!e.contains(hit))throw Error('Touch target is obstructed');return {x,y};})()`);
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,force:1,radiusX:3,radiusY:3}]});
  await delay(120);await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(300);
}
try{
  await page.navigate('/');await ready();
  await check('keyboard-overlap-focus-visible',async()=>{
    for(const card of ['learning','finance','tools'])await edit(card,{x:'50',y:'50',size:'large',rotation:'0'});
    await page.evaluate("window.__layoutWrites=0;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k).startsWith('aerisHomeWidgets:'))window.__layoutWrites++;return original.call(this,k,v)};document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex');true");
    const rows=[];
    for(let n=0;n<55&&new Set(rows.map(row=>row.card)).size<3;n++){
      await key('Tab');
      const item=await page.evaluate("(()=>{const e=document.activeElement;if(!e?.hasAttribute('data-home-widget-open'))return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {card:e.dataset.homeWidgetOpen,hit:hit?.closest('[data-home-widget]')?.dataset.homeWidget,visible:e===hit||e.contains(hit),focusVisible:e.matches(':focus-visible'),z:getComputedStyle(e.closest('[data-home-widget]')).zIndex,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()");
      if(item){rows.push(item);await shot('keyboard-overlap-'+item.card);}
    }
    await fs.writeFile(path.join(output,'keyboard-overlap.json'),JSON.stringify(rows,null,2));
    assert.equal(new Set(rows.map(row=>row.card)).size,3);assert.ok(rows.every(row=>row.visible&&row.focusVisible),'Focused card must remain visible above overlapping cards');
    assert.equal(await page.evaluate('__layoutWrites'),0,'Focus changes must not persist layout');
    return rows;
  });
  if(local&&!process.argv.includes('--focus-only')){
    await check('two-real-accounts-layout-isolation',async()=>{
      const run=randomBytes(5).toString('hex'),secret=randomBytes(18).toString('base64url');
      const users=[{username:'p07qaA'+run,secret},{username:'p07qaB'+run,secret}];
      for(const user of users){const response=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,secret:user.secret,confirm_secret:user.secret})});assert.equal(response.status,201,'Local isolated account creation must succeed');}
      identityA=await login(users[0]);
      await edit('learning',{size:'large',rotation:'6',x:'15',y:'20'});await edit('finance',{size:'small',rotation:'-4',x:'75',y:'10'});await edit('tools',{size:'large',rotation:'3',x:'80',y:'70'});
      savedA=await stored(identityA);assert.equal(savedA.learning.layouts.desktop.rotation,6);assert.equal(savedA.finance.layouts.desktop.size,'small');
      await page.navigate('/');await ready();await page.waitFor("document.querySelector('[data-home-widget=learning]').dataset.size==='large'");assert.deepEqual(await stored(identityA),savedA);await shot('real-account-a-desktop');
      await logout();identityB=await login(users[1]);assert.notEqual(identityB,identityA);assert.equal(await stored(identityB),null);assert.deepEqual(await stored(identityA),savedA);
      assert.equal(await page.evaluate("document.querySelector('[data-home-widget=learning]').dataset.size"),'medium');
      await edit('learning',{size:'small',rotation:'-6',x:'65',y:'60'});const savedB=await stored(identityB);assert.equal(savedB.learning.layouts.desktop.rotation,-6);assert.deepEqual(await stored(identityA),savedA);
      await shot('real-account-b-desktop');await logout();assert.equal(await page.evaluate("Object.keys(localStorage).some(k=>/^aerisHomeWidgets:.*guest$/.test(k))"),false);
      assert.equal(await login(users[0]),identityA);assert.deepEqual(await stored(identityA),savedA);assert.deepEqual(await stored(identityB),savedB);
      await page.waitFor("document.querySelector('[data-home-widget=learning]').dataset.size==='large'");
      return {accounts:2,real_local_d1_auth:true,account_a_id:identityA,account_b_id:identityB,reload_restore:true,guest_not_persisted:true,cross_account_leak:false};
    });
    await check('mobile-touch-editor-scroll-pinch-restore',async()=>{
      assert.ok(identityA&&savedA,'Requires the real-account fixture');
      await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await page.navigate('/');await ready();
      assert.equal(await page.evaluate("document.getElementById('publicHome').dataset.widgetLayout"),'mobile');
      const coarse=await page.evaluate("matchMedia('(pointer:coarse)').matches");assert.equal(coarse,true);
      const layouts=[];
      for(const [index,card] of ['learning','finance','tools'].entries()){
        await touch(`[data-widget-edit=${card}]`);await page.waitFor("document.getElementById('homeWidgetEditor').open");
        await page.setFields({'#homeWidgetEditor [name=size]':['small','large','medium'][index]});
        const range=await page.evaluate("(()=>{const r=document.querySelector('#homeWidgetEditor [name=rotation]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
        for(let n=0;n<=8;n++){await page.send('Input.dispatchTouchEvent',{type:n===0?'touchStart':'touchMove',touchPoints:[{x:range.x+range.width*(.2+n*.075),y:range.y+range.height/2,id:1,force:1,radiusX:3,radiusY:3}]});await delay(30);}
        await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(200);
        const angle=await page.evaluate("Number(document.querySelector('#homeWidgetEditor [name=rotation]').value)");assert.notEqual(angle,savedA[card].layouts.mobile.rotation,'Touch slider must change its value');
        await touch('#homeWidgetEditor [type=submit]');await page.waitFor("!document.getElementById('homeWidgetEditor').open");
        const saved=await stored(identityA);assert.equal(saved[card].layouts.mobile.rotation,angle);assert.deepEqual(saved[card].layouts.desktop,savedA[card].layouts.desktop);layouts.push({card,angle,size:saved[card].layouts.mobile.size});
      }
      const beforeCancel=await stored(identityA);await touch('[data-widget-edit=learning]');await page.waitFor("document.getElementById('homeWidgetEditor').open");await page.setFields({'#homeWidgetEditor [name=rotation]':'-7'});await touch('[data-widget-cancel]');await page.waitFor("!document.getElementById('homeWidgetEditor').open");assert.deepEqual(await stored(identityA),beforeCancel);
      await page.navigate('/');await ready();assert.deepEqual(await stored(identityA),beforeCancel);await shot('real-touch-mobile-restored');
      await page.evaluate("document.querySelector('[data-home-widget-open=learning]').scrollIntoView({block:'center',behavior:'instant'});true");const y0=await page.evaluate('scrollY');
      for(let n=0;n<=10;n++){await page.send('Input.dispatchTouchEvent',{type:n===0?'touchStart':'touchMove',touchPoints:[{x:190,y:620-n*23,id:1,force:1,radiusX:4,radiusY:4}]});await delay(20);}
      await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(180);const y1=await page.evaluate('scrollY');assert.ok(y1>y0+50,'Touch swipe must scroll the page');assert.equal(await page.evaluate('location.pathname'),'/');
      const pinch={x:195,y:300,scaleFactor:2,relativeSpeed:400,gestureSourceType:'touch'};
      await page.send('Input.synthesizePinchGesture',pinch);const scale=await page.evaluate('visualViewport.scale');
      let pinchResult={status:'PASS',page_scale:scale};
      if(scale<=1.6){
        const control=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:19319',baseUrl:base,width:390,height:844,mobile:true});
        try{
          await control.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
          await control.send('Page.bringToFront');await control.send('Emulation.setFocusEmulationEnabled',{enabled:true});
          await control.send('Page.navigate',{url:'data:text/html,'+encodeURIComponent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="height:3000px">Browser native gesture control</body>')});await delay(300);
          await control.send('Input.synthesizePinchGesture',pinch);const controlScale=await control.evaluate('visualViewport.scale');
          assert.ok(controlScale<=1.6,`Application blocks a supported native pinch: app=${scale}, control=${controlScale}`);
          pinchResult={status:'NOT_TESTED',page_scale:scale,control_scale:controlScale,reason:'Native gesture has no scale effect in the independent browser control'};
        }finally{await control.close();}
      }else{await shot('real-touch-native-pinch');}
      await page.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
      assert.equal(await page.evaluate("document.querySelectorAll('[data-home-widget][data-dragging=true]').length"),0);assert.deepEqual(await stored(identityA),beforeCancel);
      return {cdp_touch_events:true,physical_device:false,pointer_coarse:coarse,layouts,scroll_delta:y1-y0,native_pinch:pinchResult,reload_restore:true,cancel_preserves:true,desktop_layout_preserved:true};
    });
  }
}finally{
  const result={origin:base,checks,pass:checks.filter(row=>row.status==='PASS').length,fail:checks.filter(row=>row.status==='FAIL').length,physical_device:false,runtime_errors:page.runtimeErrors};
  await fs.writeFile(path.join(output,'independent-browser-gaps.json'),JSON.stringify(result,null,2)+'\n');await page.close();
  if(result.fail||result.runtime_errors.length)process.exitCode=1;
}
