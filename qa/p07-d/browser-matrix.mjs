import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';

const base=new URL(process.env.WYJ_TEST_BASE).origin;
assert.equal(new URL(base).hostname,'127.0.0.1','Mutating fixtures require loopback');
const cdp=process.env.WYJ_CDP_URL;
const out=path.resolve(process.env.P07_D_EVIDENCE);
const zoom=Number(process.env.P07_D_NATIVE_ZOOM||1);
const zoomOnly=process.env.P07_D_ZOOM_ONLY==='true';
const results=[],requests=[];
await fs.mkdir(path.join(out,'screenshots'),{recursive:true});
async function api(route,payload=null,token='',expected=200){
  let res;
  try{res=await fetch(base+route,{method:payload===null?'GET':'POST',
    headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},
    body:payload===null?undefined:JSON.stringify(payload)});}
  catch(error){throw new Error(`Local fixture ${payload===null?'GET':'POST'} ${route}: ${error.cause?.code||error.message}`,{cause:error});}
  const data=await res.json();assert.equal(res.status,expected,route+': '+JSON.stringify(data));return data;
}
const admin=await api('/api/login',{username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET});
const tag=randomBytes(5).toString('hex'), secret=randomBytes(20).toString('base64url');
const usernames=['p07Dmember'+tag,'p07Dfree'+tag];
const accounts=[];
for(const username of usernames){await api('/api/register',{username,secret,confirm_secret:secret},'',201);
  accounts.push(await api('/api/login',{username,secret}));}
const [member,free]=accounts;
const memberMe=await api('/api/me',null,member.session);
await api('/api/admin/membership/manage',{user_id:memberMe.account.id,action:'grant',plan_code:'all_access_monthly',note:'P07-D local synthetic fixture'},admin.session);
const page=await openPage({cdpUrl:cdp,baseUrl:base,width:1440,height:960,mobile:false});
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete globalThis.__WYJ_TEST_MODE__;'});
await page.send('Page.bringToFront');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
page.client.listeners.add(message=>{if(message.method==='Network.requestWillBeSent'&&message.params?.request?.url)
  requests.push(message.params.request.url);});
if(zoomOnly)await page.send('Emulation.clearDeviceMetricsOverride');
const evalJs=x=>page.evaluate(x);
async function key(name){for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',
  {type,key:name,code:name===' '?'Space':name,windowsVirtualKeyCode:{Tab:9,Enter:13,' ':32,Escape:27}[name],...(name==='Enter'&&type==='keyDown'?{text:'\r'}:{})});}
async function shot(name){const data=await page.send('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(out,'screenshots',name+'.png'),Buffer.from(data.data,'base64'));}
async function check(id,fn){const begin=Date.now();try{const detail=await fn();results.push({id,status:'PASS',ms:Date.now()-begin,detail});}
 catch(error){await shot('FAIL-'+id).catch(()=>{});results.push({id,status:'FAIL',ms:Date.now()-begin,error:error.message});console.log('FAIL '+id+' '+error.message.slice(0,180));}
 await fs.writeFile(path.join(out,zoomOnly?`matrix-native-zoom-${zoom*100}.json`:'matrix-results.json'),JSON.stringify({synthetic_accounts:true,real_local_auth:true,native_zoom:zoom,zoom_only:zoomOnly,results},null,2));}
async function login(session,route='/'){
  await page.navigate('/login');
  await evalJs(`localStorage.clear();localStorage.setItem('wyjAccountSession',${JSON.stringify(session)});true`);
  await page.navigate(route);
  await page.waitFor("document.getElementById('publicHome')?.dataset.sessionMode==='authenticated'&&!document.getElementById('entryScreen')",30000);
}
async function ready(route){await page.navigate(route);await page.waitFor("!document.getElementById('entryScreen')&&!document.getElementById('appShell').classList.contains('app-shell-pending')",30000);
  await page.waitFor("document.documentElement.dataset.p07Ui==='enabled'",15000,'authoritative V3 presentation ready');}
const pages=[
  {id:'home',route:'/',root:'#publicHome',nav:'home',control:'[data-home-widget-open=learning]'},
  {id:'account',route:'/account',root:'#accountModal',nav:'account',control:'#changeSecretForm input'},
  {id:'language',route:'/language',root:'#projectPicker',nav:'language',control:'[data-project=english]'},
  {id:'english',route:'/language/english',root:'#projectApp',nav:'language',control:'#wordInput'},
  {id:'japanese',route:'/language/japanese',root:'#projectApp',nav:'language',control:'#wordInput'},
  {id:'wrong',route:'/language/english',view:'wrongView',root:'#wrongView',nav:'language',control:'#wrongSearchInput'},
  {id:'study',route:'/language/english',view:'studyView',root:'#studyView',nav:'language',control:'#studyGoalInput'},
  {id:'finance',route:'/finance',root:'#financeWorkspace',nav:'finance',control:'#financeAddTransactionBtn'},
  {id:'tools',route:'/tools',root:'#toolsPanel',nav:'tools',control:'#toolSearchInput'},
  {id:'text',route:'/tools/text-stats',root:'#toolWorkbench',nav:'tools',control:'#textToolInput'},
];
try{
 await login(member.session);
 await check('account-v3-policy-preflight',async()=>{
   const detail=await evalJs(`(async()=>{const token=localStorage.getItem('wyjAccountSession'),headers={'X-Session-Token':token};
     const policy=await fetch('/api/features',{headers}).then(r=>r.json()),status=await fetch('/api/status').then(r=>r.json());
     return {p07:document.documentElement.dataset.p07Ui,visible:document.visibilityState,decision:policy.snapshot?.flags?.p07_accessibility,
       capabilities:status.capabilities,enabled:window.AerisFeatures?.enabled('p07_accessibility')};})()`);
   await fs.writeFile(path.join(out,'account-policy-diagnostic.json'),JSON.stringify(detail,null,2));
   await page.waitFor("document.documentElement.dataset.p07Ui==='enabled'",15000,'authoritative authenticated V3 decision');
   return detail;
 });
 if(!zoomOnly){
  await check('formal-ai-off-fail-closed',async()=>{
    const q=await api('/api/quiz/start',{language:'english',words:['p07unlistedfixture']},member.session);
    const res=await api('/api/judge',{word:'p07unlistedfixture',answer:'未知',quiz_session:q.quiz_session},member.session,503);
    assert.equal(res.code,'ai_unavailable');return {http:503,code:res.code,real_ai_calls:0};
  });
  await check('uncached-cloud-tts-ai-off',async()=>{
    const res=await api('/api/tts?text=p07-uncached-synthetic&language=en&voice=default',null,'',503);
    assert.equal(res.code,'tts_unavailable');return {http:503,code:res.code,paid_ai_calls:0};
  });
  await check('guest-and-free-member-isolation',async()=>{
    await login(free.session,'/finance');await page.waitFor("!document.getElementById('financeLocked').classList.contains('hidden')",15000);
    assert.equal(await evalJs("document.getElementById('financeWorkspace').classList.contains('hidden')"),true);
    const res=await api('/api/notification/pending-summary',null,free.session,403);
    await evalJs('localStorage.clear();true');await ready('/finance');
    assert.equal(await evalJs("document.getElementById('publicHome').dataset.sessionMode==='authenticated'"),false);
    assert.equal(await evalJs("document.getElementById('financeWorkspace').classList.contains('hidden')"),true);
    await login(member.session);return {free_denied:true,guest_no_private_workspace:true,notification_status:res.code};
  });
 }
 const widths=process.env.P07_D_INTERACTION_ONLY==='true'?[]:zoomOnly?[null]:[375,390,412,768,1024,1440,1920];
 for(const width of widths)for(const theme of ['light','dark']){
  if(width)await page.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:false});
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await evalJs("localStorage.setItem('wyj_theme_preference_v1','system');true");
  for(const item of pages)await check(`${item.id}-${width||'native'+zoom*100}-${theme}`,async()=>{
    await ready(item.route);
    if(item.view){await page.waitFor("document.querySelector('[data-view="+item.view+"]')?.getClientRects().length>0");await page.click(`[data-view=${item.view}]`);}
    await page.waitFor(`document.querySelector(${JSON.stringify(item.root)})?.getClientRects().length>0&&!document.querySelector(${JSON.stringify(item.root)})?.closest('.hidden')`,15000,item.id+' surface');
    await delay(120);
    const geometry=await evalJs(`(()=>{
      const root=document.querySelector(${JSON.stringify(item.root)}),r=root.getBoundingClientRect(),s=getComputedStyle(root),sidebar=document.getElementById('v3Sidebar'),b=sidebar.getBoundingClientRect();
      const active=[...document.querySelectorAll('#v3Sidebar [aria-current="page"]')].map(e=>e.dataset.v3Nav);
      const logos=[...document.querySelectorAll('img')].filter(e=>e.getClientRects().length&&e.currentSrc.includes('icon-192')).map(e=>({src:new URL(e.currentSrc).pathname,decoded:e.complete&&e.naturalWidth===192}));
      return {route:location.pathname,width:innerWidth,scroll:document.documentElement.scrollWidth,bodyScroll:document.body.scrollWidth,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,
        root:{x:r.x,y:r.y,width:r.width,right:r.right},sidebar:{visible:!!sidebar.getClientRects().length,x:b.x,width:b.width,right:b.right},active,logos,
        p07:document.documentElement.dataset.p07Ui,font:s.fontFamily,canvas:getComputedStyle(document.getElementById('v3MainCanvas')).backgroundColor,theme:document.documentElement.dataset.theme};})()`);
    assert.equal(geometry.route,item.route);assert.ok(geometry.scroll<=geometry.width+2&&geometry.bodyScroll<=geometry.width+2,JSON.stringify(geometry));
    assert.ok(geometry.root.width>0&&geometry.root.right<=geometry.width+2&&geometry.root.x>=-2,JSON.stringify(geometry));
    assert.ok(geometry.active.includes(item.nav),'Sidebar active route: '+JSON.stringify(geometry.active));
    assert.equal(geometry.p07,'enabled','V3 checks require actual authoritative P07 ON');
    if(geometry.width>=1100){assert.equal(geometry.sidebar.visible,true,'Desktop V3 sidebar must be visible');assert.equal(geometry.sidebar.width,204);}
    assert.ok(geometry.logos.length&&geometry.logos.every(x=>x.decoded),'Decoded brand icon');
    if(zoomOnly){assert.ok(Math.abs(geometry.dpr-zoom)<.02,'Native browser zoom DPR');assert.equal(geometry.cssZoom,'1');}
    const control=await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(item.control)});return {exists:!!e,visible:!!e?.getClientRects().length,disabled:!!e?.disabled}})()`);
    assert.ok(control.exists&&control.visible,'Required control available');
    if((width===1440&&theme==='light')||(width===390)||zoomOnly)await shot(`${item.id}-${width||'native'+zoom*100}-${theme}`);
    return {...geometry,control};
  });
 }
 if(!zoomOnly){
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  for(const item of pages)await check('keyboard-'+item.id,async()=>{
    await ready(item.route);
    if(item.view)await page.click(`[data-view=${item.view}]`);
    await page.waitFor(`document.querySelector(${JSON.stringify(item.control)})?.getClientRects().length>0`);
    await evalJs("document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex');true");
    let found;
    for(let step=0;step<160;step++){
      await key('Tab');
      found=await evalJs(`(()=>{const e=document.activeElement;if(!e.matches(${JSON.stringify(item.control)}))return null;
        const r=e.getBoundingClientRect(),s=getComputedStyle(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return {focus_visible:e.matches(':focus-visible'),style:s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0||s.boxShadow!=='none',unobscured:hit===e||e.contains(hit),
          x:r.x,y:r.y,width:r.width,height:r.height};})()`);
      if(found)break;
    }
    assert.ok(found,'Required control reachable by Tab');assert.ok(found.focus_visible&&found.style&&found.unobscured,JSON.stringify(found));
    return found;
  });
  await check('tool-input-error-recovery-and-no-network-text-upload',async()=>{
    await ready('/tools/json-format');await page.waitFor("document.getElementById('textToolInput')?.getClientRects().length");
    const begin=requests.length;
    await page.setFields({'#textToolInput':'{broken'});await page.click('#runTextToolBtn');
    await page.waitFor("Boolean(document.getElementById('toolWorkbenchMessage').textContent)&&!document.getElementById('runTextToolBtn').disabled");
    const invalid=await evalJs("document.getElementById('toolWorkbenchMessage').textContent");
    await page.setFields({'#textToolInput':'{"p07Synthetic":true}'});await page.click('#runTextToolBtn');
    const output=await evalJs("document.getElementById('textToolOutput').value");assert.deepEqual(JSON.parse(output),{p07Synthetic:true});
    const external=requests.slice(begin).filter(x=>x.startsWith('http')&&!x.startsWith(base));assert.deepEqual(external,[]);
    return {invalid,valid_recovered:true,no_external_request:true};
  });
  await check('dialog-keyboard-focus-restore',async()=>{
    await ready('/finance');await page.waitFor("document.getElementById('financeAddTransactionBtn').getClientRects().length>0");
    await evalJs("document.getElementById('financeAddTransactionBtn').focus();true");await key('Enter');
    await page.waitFor("!document.getElementById('financeTransactionModal').classList.contains('hidden')");
    await key('Escape');await page.waitFor("document.getElementById('financeTransactionModal').classList.contains('hidden')");
    assert.equal(await evalJs('document.activeElement.id'),'financeAddTransactionBtn');return {enter:true,escape:true,focus_restored:true};
  });
  await check('space-toggle-tools-favorite',async()=>{
    await ready('/tools/text-stats');await page.waitFor("document.getElementById('favoriteToolBtn')?.getClientRects().length");
    const before=await evalJs("document.getElementById('favoriteToolBtn').textContent");
    await evalJs("document.getElementById('favoriteToolBtn').focus();true");await key(' ');
    await page.waitFor(`document.getElementById('favoriteToolBtn').textContent!==${JSON.stringify(before)}`,8000,'favorite saved after Space');
    const after=await evalJs("document.getElementById('favoriteToolBtn').textContent");assert.notEqual(after,before);
    await key(' ');await page.waitFor(`document.getElementById('favoriteToolBtn').textContent===${JSON.stringify(before)}`,8000,'favorite restored after Space');
    assert.equal(await evalJs("document.getElementById('favoriteToolBtn').textContent"),before);
    return {space_operates:true,restored:true};
  });
  await check('task26-unpublished-fallback',async()=>{
    await ready('/language/english');await page.waitFor("document.querySelector('[data-view=wrongView]')?.getClientRects().length");await page.click('[data-view=wrongView]');
    const visible=await evalJs("!document.getElementById('masterySection').classList.contains('hidden')");
    assert.equal(visible,false,'Unpublished/flag-OFF mastery must fall back to original wrong book');
    assert.equal(await evalJs("Boolean(document.getElementById('wrongSearchInput').getClientRects().length)"),true);return {mastery_hidden:true,original_wrong_book:true};
  });
  await check('reduced-motion-business-surfaces',async()=>{
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const detail=[];
    for(const route of ['/','/language/english','/finance','/tools']){
      await ready(route);await delay(100);
      const motion=await evalJs("({reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,infinite:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length})");
      assert.equal(motion.reduce,true);assert.equal(motion.infinite,0);detail.push({route,...motion});
    }return detail;
  });
  await check('private-notification-boundary',async()=>{
    const denied=await api('/api/notification/pending-summary',null,'',401);
    const own=await api('/api/notification/pending-summary',null,member.session);
    assert.equal(own.total_count,0);assert.equal(own.hint_count,0);assert.equal(own.candidate_count,0);
    assert.deepEqual(own.records,[]);
    return {anonymous_denied:denied.code,own_empty:true,raw_user_notifications_read:false};
  });
  if(process.env.P07_D_INTERACTION_ONLY==='true'){
   await check('hydrated-tool-visual-reflow',async()=>{
    const rows=[];
    for(const route of ['/tools','/tools/text-stats']){
     await ready(route);
     await page.waitFor("!document.getElementById('toolsMembershipStatus').textContent.includes('正在验证')",20000,'actual member tool hydration');
     if(route.endsWith('text-stats'))await page.waitFor("document.getElementById('textToolInput')?.getClientRects().length>0");
     for(const width of [375,390,412,768,1024,1440,1920])for(const theme of ['light','dark']){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:false});
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
      await evalJs('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const row=await evalJs("({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,status:document.getElementById('toolsMembershipStatus').textContent,p07:document.documentElement.dataset.p07Ui})");
      assert.equal(row.p07,'enabled');assert.ok(row.scroll<=row.width+2&&row.body<=row.width+2,JSON.stringify(row));
      rows.push({route,theme,...row});
      if(width===1440&&theme==='light'||width===390)await shot(`hydrated-${route.endsWith('text-stats')?'text':'tools'}-${width}-${theme}`);
     }
    }return rows;
   });
   await check('actual-rule-quiz-wrong-and-study-specimens',async()=>{
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
    await ready('/language/english');
    await page.setFields({'#wordInput':'hello','#practiceModeSelect':'meaning','#gradingModeSelect':'normal'});
    await page.click('#startBtn');await page.waitFor("document.getElementById('quizView').classList.contains('active')&&document.getElementById('wordText').textContent==='hello'");
    await shot('actual-rule-quiz-1440-light');
    await page.setFields({'#answerInput':'完全错误'});await page.click('#submitBtn');
    await page.waitFor("document.getElementById('resultTitle').textContent==='错误'&&!document.getElementById('resultPanel').classList.contains('hidden')");
    await shot('actual-rule-feedback-1440-light');
    await page.click('[data-view=wrongView]');
    await page.waitFor("document.querySelectorAll('#wrongList .wrong-item').length===1");
    await shot('actual-rule-wrong-1440-light');
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:960,deviceScaleFactor:1,mobile:false});
    await shot('actual-rule-wrong-390-light');
    await page.click('[data-view=quizView]');
    if(await evalJs("Boolean(document.getElementById('nextNowBtn').getClientRects().length)&&!document.getElementById('nextNowBtn').disabled"))await page.click('#nextNowBtn');
    await page.waitFor("!document.getElementById('roundSummaryModal').classList.contains('hidden')",10000);
    assert.equal(await evalJs("document.getElementById('roundWrongCount').textContent"),'1');
    await page.click('#roundSetupBtn');await page.click('[data-view=studyView]');
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
    await shot('actual-rule-study-1440-light');
    return {real_local_judge:true,artificial_rubric:false,word:'hello',wrong:1,study_record_created:true};
   });
   await check('manual-cny-invalid-form-and-rapid-physical-save',async()=>{
    await ready('/finance');await page.waitFor("document.getElementById('financeAddTransactionBtn').getClientRects().length>0");
    const before=await api('/api/finance/transactions',null,member.session);
    const oldCount=before.transactions.length;
    await page.click('#financeAddTransactionBtn');
    assert.equal(await evalJs("document.getElementById('financeTransactionForm').checkValidity()"),false,'Empty required amount is invalid');
    const merchant='P07 synthetic long merchant '+('A'.repeat(130));
    await page.setFields({'#financeTransactionAmount':'19.99','#financeTransactionMerchant':merchant,'#financeTransactionNote':'N'.repeat(500)});
    const p=await evalJs("(()=>{const e=document.querySelector('#financeTransactionForm [type=submit]');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    for(let count=1;count<=2;count++)for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mousePressed'?1:0,clickCount:count});
    await page.waitFor("document.getElementById('financeTransactionModal').classList.contains('hidden')");
    let saved;
    for(let attempt=0;attempt<30;attempt++){saved=await api('/api/finance/transactions',null,member.session);if(saved.transactions.length>oldCount)break;await delay(150);}
    assert.equal(saved.transactions.length,oldCount+1,'Rapid real pointer activation must create one transaction');
    const item=saved.transactions.find(x=>x.merchant===merchant);assert.ok(item);assert.equal(item.currency,'CNY');assert.equal(item.amount_minor,1999);
    await page.send('Emulation.setDeviceMetricsOverride',{width:375,height:960,deviceScaleFactor:1,mobile:false});
    await evalJs('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evalJs('document.documentElement.scrollWidth<=innerWidth+2'),true);
    await shot('manual-cny-long-merchant-375-light');
    return {empty_required_rejected:true,rapid_pointer_creates:1,currency:'CNY',amount_minor:1999,merchant_length:merchant.length,note_length:500};
   });
   await check('actual-local-task25-off-and-kill-switch',async()=>{
    let flag=(await api('/api/admin/feature-flags',null,admin.session)).flags.find(x=>x.flag_key==='p07_accessibility');
    assert.ok(flag);
    const change=async patch=>{const {flag_key,description,enabled,kill_switch,channels,rollout_percentage,revision}=flag;
      flag=(await api('/api/admin/feature-flags',{flag_key,description,enabled,kill_switch,channels,rollout_percentage,...patch,expected_revision:revision},admin.session)).flag;};
    const rows=[];
    try{
     for(const [patch,reason] of [[{enabled:false,kill_switch:false},'global_off'],[{enabled:true,kill_switch:true},'kill_switch']]){
      await change(patch);
      const current=(await api('/api/features',null,member.session)).snapshot.flags.p07_accessibility;
      assert.equal(current.enabled,false);assert.equal(current.reason,reason);
      await page.navigate('/language/english');await page.waitFor("!document.getElementById('entryScreen')&&document.getElementById('wordInput').getClientRects().length>0");
      await delay(250);assert.equal(await evalJs('document.documentElement.dataset.p07Ui'),'disabled');
      assert.equal(await evalJs("document.getElementById('wordInput').getClientRects().length>0"),true);
      await shot('local-task25-'+reason);rows.push({reason,enabled:false,ordinary_learning_available:true});
     }
    }finally{await change({enabled:true,kill_switch:false});}
    await ready('/language/english');
    const ledger=await api('/api/finance/transactions',null,member.session);
    assert.equal(ledger.transactions.length,1,'Presentation switches must not mutate the manual ledger');
    return {local_only:true,rows,restored:true,ledger_unchanged:true};
   });
  }
 }
}finally{
 await fs.writeFile(path.join(out,zoomOnly?`matrix-network-zoom-${zoom*100}.json`:'matrix-network.json'),JSON.stringify({requests,nonlocal:requests.filter(x=>/^https?:/.test(x)&&!x.startsWith(base)),runtimeErrors:page.runtimeErrors},null,2));
 await page.close();
}
console.log(JSON.stringify({checks:results.length,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length}));
if(results.some(x=>x.status!=='PASS'))process.exitCode=1;
