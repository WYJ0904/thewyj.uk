import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';

const base=new URL(process.env.WYJ_TEST_BASE).origin;
const evidence=path.resolve(process.env.P07_D_EVIDENCE);
const screenshotDir=path.join(evidence,'round3-screenshots');
const targetSha=process.env.P07_D_TARGET_HEAD||'unknown';
const flagMode=process.env.P07_D_FLAG_MODE||'on';
assert.equal(new URL(base).hostname,'127.0.0.1','Round 3 mutations require isolated loopback');
await fs.mkdir(screenshotDir,{recursive:true});

const checks=[],httpTrace=[],networkTrace=[],timeline=[],debugTrace=[];
const observations={};
const tag=randomBytes(4).toString('hex');
const secret=randomBytes(24).toString('base64url');
const reportPath=path.join(evidence,'round3-browser-results.json');
const frameShots=new Map();
let activeFramePath='';

async function api(route,payload=null,session='',expected=null){
  const response=await fetch(base+route,{method:payload===null?'GET':'POST',
    headers:{'Content-Type':'application/json',...(session?{'X-Session-Token':session}:{})},
    body:payload===null?undefined:JSON.stringify(payload)});
  let data=null;
  try{data=await response.json();}catch{}
  httpTrace.push({method:payload===null?'GET':'POST',path:route,status:response.status,
    code:data?.code||data?.error||null});
  if(expected!==null)assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);
  return {status:response.status,data};
}

async function check(id,fn){
  const started=Date.now();
  try{
    const detail=await fn();
    checks.push({id,status:'PASS',duration_ms:Date.now()-started,detail});
  }catch(error){
    const file=`FAIL-${id.replace(/[^a-z0-9-]+/gi,'-')}.png`;
    await saveScreenshot(file).catch(()=>{});
    checks.push({id,status:'FAIL',duration_ms:Date.now()-started,error:error.message,stack:error.stack,
      detail:observations[id]||null,diagnostic:debugTrace.slice(-30),screenshot:file});
    console.log(`FAIL ${id}: ${error.message}`);
  }
  await writeReport();
}

async function writeReport(){
  const out={schema_version:1,target_sha:targetSha,flag_mode:flagMode,
    runtime:'isolated local Pages Functions + local D1/R2 + independent Chrome CDP',
    workers_ai_enabled:false,synthetic_accounts:true,real_payments:0,production_operations:0,
    checks,http_trace:httpTrace,network_trace:networkTrace,timelines:timeline,
    browser:browserInfo,
    runtime_errors:page?.runtimeErrors||[],screenshots:(await fs.readdir(screenshotDir)).filter(x=>x.endsWith('.png')).sort()};
  await fs.writeFile(reportPath,JSON.stringify(out,null,2));
}

async function saveScreenshot(name){
  const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await fs.writeFile(path.join(screenshotDir,name),Buffer.from(shot.data,'base64'));
}

async function waitRaf(){
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}

async function setViewport(width,height=960,mobile=false){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:1});
  await waitRaf();
}

async function clickAt(x,y){
  const hit=await page.evaluate(`(()=>{const e=document.elementFromPoint(${Number(x)},${Number(y)});return e?{
    tag:e.tagName,id:e.id||'',className:typeof e.className==='string'?e.className:'',
    core:e.closest('[data-core-capability]')?.dataset.coreCapability||null,
    nav:e.closest('[data-v3-nav]')?.dataset.v3Nav||null,
    interactive:Boolean(e.closest('a,button,input,select,textarea')),
    pointerEvents:getComputedStyle(e).pointerEvents,
    zIndex:getComputedStyle(e).zIndex
  }:null})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
  return {x,y,hit};
}

async function pointerClick(selector){
  await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});return Boolean(e)})()`);
  await waitRaf();
  const point=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,
      visible:!!e.getClientRects().length&&!e.closest('.hidden')&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),disabled:!!e.disabled,
      hitMatches:Boolean(h&&(h===e||e.contains(h))),hitElement:h?{id:h.id,tag:h.tagName,className:typeof h.className==='string'?h.className:''}:null,
      rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
  assert.ok(point,`missing ${selector}`);
  assert.ok(point.visible,`not visible ${selector}`);
  assert.equal(point.disabled,false,`disabled ${selector}`);
  assert.equal(point.hitMatches,true,`actual pointer target is covered or outside the viewport ${selector}: ${JSON.stringify(point)}`);
  return {...point,...await clickAt(point.x,point.y)};
}

async function openHomeDetails(){
  if(!await page.evaluate("document.getElementById('homeProductDetails').open"))await pointerClick('#homeProductDetails > summary');
  await page.waitFor("document.getElementById('homeProductDetails').open&&document.getElementById('publicCoreCardGallery').checkVisibility({checkVisibilityCSS:true})",5000,'visible expanded feature cards');
}

async function direct(pathname){
  const previous=await page.evaluate('globalThis.__p07R3DocumentId||null').catch(()=>null);
  const navigation=await page.send('Page.navigate',{url:base+pathname});
  assert.ok(!navigation.errorText,`navigation failed: ${navigation.errorText}`);
  await newDocumentReady(previous,pathname);
}

async function newDocumentReady(previous,pathname){
  await page.waitFor(`Boolean(globalThis.__p07R3DocumentId)&&globalThis.__p07R3DocumentId!==${JSON.stringify(previous)}`,20000,`new document ${pathname}`);
  await page.waitFor(`location.pathname===${JSON.stringify(pathname)}`,15000,`route ${pathname}`);
  await page.waitFor("document.readyState==='complete'&&document.getElementById('appShell')&&!document.getElementById('appShell').classList.contains('app-shell-pending')&&!document.getElementById('entryScreen')",30000,`boot completed ${pathname}`);
  await waitRaf();
}

async function createUser(prefix){
  const username=`${prefix}${tag}${randomBytes(2).toString('hex')}`;
  await api('/api/register',{username,secret,confirm_secret:secret},'',201);
  const login=await api('/api/login',{username,secret});
  assert.equal(login.status,200,`synthetic login failed for ${prefix}`);
  assert.ok(login.data?.session,`synthetic session missing for ${prefix}`);
  const me=await api('/api/me',null,login.data.session);
  assert.equal(me.status,200);
  return {username,session:login.data.session,account:me.data.account||me.data.user};
}

async function installSession(session,pathname='/'){
  if(await page.evaluate('location.origin')!==base)await direct('/login');
  await page.evaluate(`(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('wyjAccountSession',${JSON.stringify(session)});return true})()`);
  await direct(pathname);
  await page.waitFor("Boolean(localStorage.getItem('wyjAccountSession'))",10000,'saved synthetic session');
  const ready={
    '/':'Boolean((document.getElementById("publicHome")?.getClientRects().length&&!document.getElementById("publicHome").classList.contains("hidden"))||(document.getElementById("modulePicker")?.getClientRects().length&&!document.getElementById("modulePicker").classList.contains("hidden")))',
    '/account':'document.getElementById("accountModal")?.getClientRects().length>0&&!document.getElementById("accountModal")?.classList.contains("hidden")',
    '/recharge':'document.getElementById("membershipModal")?.getClientRects().length>0&&!document.getElementById("membershipModal")?.classList.contains("hidden")',
    '/finance':'!document.getElementById("financeLocked")?.classList.contains("hidden")||!document.getElementById("financeWorkspace")?.classList.contains("hidden")',
    '/language':'!document.getElementById("projectPicker")?.classList.contains("hidden")',
    '/language/english':'!document.getElementById("projectApp")?.classList.contains("hidden")',
    '/language/japanese':'!document.getElementById("projectApp")?.classList.contains("hidden")',
    '/tools':'!document.getElementById("toolsPanel")?.classList.contains("hidden")',
  }[pathname];
  if(ready)await page.waitFor(ready,30000,`authenticated route ready ${pathname}`);
}

async function surface(selector){
  return page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),shell=document.getElementById('appShell'),canvas=document.getElementById('v3MainCanvas');
    const r=e?.getBoundingClientRect();return {visible:Boolean(e&&e.getClientRects().length&&!e.closest('.hidden')),
      inMainCanvas:Boolean(e&&canvas?.contains(e)),insideModalLayer:Boolean(e?.closest('.modal-layer')),
      role:e?.getAttribute('role')||null,ariaModal:e?.getAttribute('aria-modal')||null,
      ariaHidden:e?.getAttribute('aria-hidden')||null,bodyModalOpen:document.body.classList.contains('modal-open'),
      appShellInert:Boolean(shell?.inert),appShellPending:Boolean(shell?.classList.contains('app-shell-pending')),
      activeNav:[...document.querySelectorAll('#v3Sidebar [aria-current="page"]')].map(n=>n.dataset.v3Nav),
      modalLayers:[...document.querySelectorAll('.modal-layer:not(.hidden)')].map(n=>n.id),
      rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,p07:document.documentElement.dataset.p07Ui||null};})()`);
}

async function visibleHomeSelector(){
  return page.evaluate("(()=>{for(const id of ['publicHome','modulePicker']){const e=document.getElementById(id);if(e&&e.getClientRects().length&&!e.closest('.hidden'))return '#'+id}return null})()");
}

async function waitRouteSurface(pathname){
  if(pathname==='/')return page.waitFor("Boolean((document.getElementById('publicHome')?.getClientRects().length&&!document.getElementById('publicHome').closest('.hidden'))||(document.getElementById('modulePicker')?.getClientRects().length&&!document.getElementById('modulePicker').closest('.hidden')))",15000,'visible home surface');
  const selector=pathname==='/account'?'#accountModal':pathname==='/recharge'?'#membershipModal':pathname==='/finance'?'#financeWorkspace':
    pathname.startsWith('/language/')?'#projectApp':pathname==='/language'?'#projectPicker':pathname.startsWith('/tools')?'#toolsPanel':
    pathname==='/admin'?'#adminPanel':null;
  if(selector)return page.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getClientRects().length>0&&!document.querySelector(${JSON.stringify(selector)})?.closest('.hidden')`,20000,`visible route surface ${pathname}`);
}

async function sampleReload(pathname,kind){
  const previous=await page.evaluate('globalThis.__p07R3DocumentId||null');
  if(kind==='normal')await page.send('Page.reload',{ignoreCache:false});
  else await page.send('Page.reload',{ignoreCache:true});
  await newDocumentReady(previous,pathname);
  await waitRouteSurface(pathname);
  const probe=await page.evaluate(`(()=>({frames:globalThis.__p07R3Frames||[],changes:globalThis.__p07R3PolicyChanges||[],
    paints:performance.getEntriesByType('paint').map(x=>({name:x.name,startTime:x.startTime})),
    resources:performance.getEntriesByType('resource').filter(x=>/\\/(?:app\\.js|spatial-experience\\.css|design-system\\.css|sw\\.js)/.test(x.name)).map(x=>new URL(x.name).pathname+new URL(x.name).search),
    cacheNames:[],serviceWorkers:[]}))()`);
  const [cacheNames,serviceWorkers]=await Promise.all([
    page.evaluate('caches?caches.keys():[]').catch(()=>[]),
    page.evaluate('navigator.serviceWorker?.getRegistrations().then(x=>x.map(r=>({scope:r.scope,active:r.active?.scriptURL||null})))||[]').catch(()=>[]),
  ]);
  probe.cacheNames=cacheNames;probe.serviceWorkers=serviceWorkers;
  const visible=probe.frames.filter(x=>x.shellVisible&&!x.shellPending&&!x.splashVisible&&x.visibleSurface.length);
  const policyStates=[...new Set(visible.map(x=>x.p07))];
  const p07=await page.evaluate('document.documentElement.dataset.p07Ui||null');
  const result={path:pathname,kind,p07,
    visible_ready_frames:visible.length,visible_policy_states:policyStates,
    policy_changes:probe.changes,paint_entries:probe.paints,app_resource_versions:probe.resources,
    cache_names:probe.cacheNames,service_workers:probe.serviceWorkers,first_frames:probe.frames.slice(0,24)};
  timeline.push(result);
  await saveScreenshot(`${targetSha.slice(0,7)}-${pathname.replaceAll('/','_')||'home'}-${kind}-stable.png`);
  assert.ok(visible.length>0,`${pathname} produced no visible stable frame`);
  if(flagMode==='on')assert.ok(policyStates.every(x=>x==='enabled'),`${pathname} showed a ready frame outside enabled P07: ${JSON.stringify(policyStates)}`);
  if(flagMode!=='on')assert.ok(policyStates.every(x=>x==='disabled'),`${pathname} showed a ready P07 frame while OFF: ${JSON.stringify(policyStates)}`);
  return result;
}

const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:base,width:1440,height:960,mobile:false});
const chromeVersion=await fetch(process.env.WYJ_CDP_URL+'/json/version').then(r=>r.json());
const browserInfo={product:chromeVersion.Browser,protocolVersion:chromeVersion['Protocol-Version'],userAgent:chromeVersion['User-Agent'],platform:process.platform};
page.client.listeners.add(message=>{
  if(message.method==='Network.requestWillBeSent'){
    try{const u=new URL(message.params.request.url);if(u.origin===base)networkTrace.push({method:message.params.request.method,path:u.pathname});}catch{}
  }
  if(message.method==='Network.responseReceived'){
    try{const u=new URL(message.params.response.url);if(u.origin===base)networkTrace.push({status:message.params.response.status,path:u.pathname});}catch{}
  }
  if(message.method==='Page.frameNavigated'&&!message.params.frame.parentId){
    try{activeFramePath=new URL(message.params.frame.url).pathname;}catch{activeFramePath='';}
  }
  if(message.method==='Page.screencastFrame'){
    if(activeFramePath&&!frameShots.has(activeFramePath))frameShots.set(activeFramePath,message.params.data);
    page.send('Page.screencastFrameAck',{sessionId:message.params.sessionId}).catch(()=>{});
  }
});
await page.send('Page.bringToFront');
await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.send('Page.startScreencast',{format:'png',everyNthFrame:2,maxWidth:1440,maxHeight:960}).catch(()=>{});
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  globalThis.__p07R3DocumentId=String(performance.timeOrigin)+'-'+Math.random().toString(36).slice(2);
  globalThis.__p07CardClicks=[];
  document.addEventListener('click',e=>{const c=e.target.closest?.('[data-core-capability]');if(c)globalThis.__p07CardClicks.push({id:c.dataset.coreCapability,
    target:e.target.id||e.target.className||e.target.tagName,interactive:Boolean(e.target.closest('a,button,input,select,textarea')),trusted:e.isTrusted,detail:e.detail})},true);
  const probe=()=>{
    const rows=[];globalThis.__p07R3Frames=rows;globalThis.__p07R3PolicyChanges=[];
    const visible=e=>Boolean(e&&e.getClientRects().length&&!e.closest('.hidden')&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
    const snap=()=>{if(rows.length>=600)return;const d=document.documentElement,s=document.getElementById('appShell'),side=document.getElementById('v3Sidebar'),home=document.getElementById('publicHome');
      const visibleSurface=[...document.querySelectorAll('#publicHome,#projectPicker,#projectApp,#financePage,#membershipModal,#accountModal,#adminPanel')]
        .filter(visible).map(e=>e.id);
      rows.push({t:performance.now(),path:location.pathname,p07:d?.dataset.p07Ui||null,shellPending:Boolean(s?.classList.contains('app-shell-pending')),
        shellVisible:visible(s),sidebarVisible:visible(side),splashVisible:visible(document.getElementById('entryScreen')),
        homeVisible:visible(home),visibleSurface,
        modalOpen:document.body?.classList.contains('modal-open')||false,shellInert:Boolean(s?.inert)});
      requestAnimationFrame(snap);};
    new MutationObserver(records=>{for(const r of records)if(r.target===document.documentElement&&r.attributeName==='data-p07-ui')globalThis.__p07R3PolicyChanges.push({t:performance.now(),value:document.documentElement.dataset.p07Ui||null});})
      .observe(document,{subtree:true,attributes:true,attributeFilter:['data-p07-ui']});
    requestAnimationFrame(snap);
  };
  probe();
})()`});

try{
  const flagResponse=await api('/api/ui/features');
  const statusResponse=await api('/api/status?source=cloud');
  if(flagMode!=='on'){
    await direct('/');
    await check(`feature-policy-${flagMode}-settles-disabled`,async()=>{
      const final=await page.evaluate(`(()=>({p07:document.documentElement.dataset.p07Ui,root:document.documentElement.outerHTML.slice(0,120),
        shellPending:document.getElementById('appShell').classList.contains('app-shell-pending'),
        sidebarVisible:!!document.getElementById('v3Sidebar').getClientRects().length,
        publicHomeVisible:!!document.getElementById('publicHome').getClientRects().length,
        bodyModalOpen:document.body.classList.contains('modal-open'),appShellInert:document.getElementById('appShell').inert,
        policy:(globalThis.__p07R3PolicyChanges||[]),frames:(globalThis.__p07R3Frames||[])}))()`);
      assert.equal(final.p07,'disabled','OFF/Kill Switch must settle to the legacy fallback');
      const ready=final.frames.filter(x=>x.shellVisible&&!x.shellPending&&!x.splashVisible&&x.visibleSurface.length);
      const forbidden=ready.filter(x=>x.p07==='enabled');
      assert.equal(forbidden.length,0,`static HTML enabled P07 on a visible frame before OFF policy applied (${forbidden.length} frames)`);
      assert.equal(final.bodyModalOpen,false);assert.equal(final.appShellInert,false);
      await saveScreenshot(`${targetSha.slice(0,7)}-flag-${flagMode}-stable.png`);
      return {api_policy:flagResponse.data?.public_ui||null,capabilities:statusResponse.data?.capabilities||null,
        final:{...final,frames:final.frames.slice(0,40)},readyFrames:ready.length,forbiddenFrames:forbidden.length};
    });
    await check(`feature-policy-${flagMode}-authenticated-safe-fallback`,async()=>{
      const user=await createUser('p07r3fallback');
      const accountPolicy=await api('/api/features',null,user.session);
      assert.equal(accountPolicy.data.snapshot.flags.p07_accessibility.enabled,false);
      await installSession(user.session,'/account');
      await page.waitFor("document.documentElement.dataset.p07Ui==='disabled'",10000,'authenticated P07 OFF');
      const account=await surface('#accountModal');
      const hit=await pointerClick('#currentSecretInput');
      assert.equal(await page.evaluate('document.activeElement.id'),'currentSecretInput','fallback account form cannot receive real focus');
      await saveScreenshot(`${targetSha.slice(0,7)}-${flagMode}-account-fallback.png`);
      const accountRefresh=await sampleReload('/account','hard');
      await direct('/recharge');await waitRouteSurface('/recharge');
      await page.waitFor("document.getElementById('membershipPlanList').getAttribute('aria-busy')==='false'",15000,'fallback membership loaded');
      await pointerClick('[data-membership-goal="finance"]');
      await page.waitFor("document.querySelectorAll('#membershipPlanList [data-plan]').length===3",8000,'fallback finance choices');
      const membership=await surface('#membershipModal');
      await saveScreenshot(`${targetSha.slice(0,7)}-${flagMode}-membership-fallback.png`);
      const membershipRefresh=await sampleReload('/recharge','normal');
      await direct('/finance');
      await page.waitFor("!document.getElementById('financeLocked').classList.contains('hidden')",15000,'fallback retains finance membership guard');
      assert.equal((await surface('#financeWorkspace')).visible,false);
      const denied=await api('/api/admin/users',null,user.session);
      assert.equal(denied.status,403);
      assert.equal(await page.evaluate('document.documentElement.dataset.p07Ui'),'disabled');
      return {accountPolicy:accountPolicy.data.snapshot.flags.p07_accessibility,account,hit,accountRefresh,membership,membershipRefresh,
        financeGuard:true,adminStatus:denied.status};
    });
  }else{
    const adminLogin=await api('/api/login',{username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET});
    assert.equal(adminLogin.status,200,'local administrator fixture login');
    const free=await createUser('p07r3free');
    const fin=await createUser('p07r3finance');
    await api('/api/admin/membership/manage',{user_id:fin.account.id,action:'grant',plan_code:'all_access_lifetime',note:'Round 3 isolated synthetic permanent-member fixture'},adminLogin.data.session,200);

    await direct('/');
    await check('first-paint-home-and-p07-decision',async()=>{
      await page.waitFor("document.getElementById('publicHome')?.getClientRects().length>0&&!document.getElementById('publicHome').classList.contains('hidden')",20000,'public home');
      const home=await surface('#publicHome');
      await saveScreenshot(`${targetSha.slice(0,7)}-home-stable.png`);
      const probe=await page.evaluate(`(()=>({frames:globalThis.__p07R3Frames||[],changes:globalThis.__p07R3PolicyChanges||[],
        paints:performance.getEntriesByType('paint').map(x=>({name:x.name,startTime:x.startTime}))}))()`);
      const ready=probe.frames.filter(x=>x.shellVisible&&!x.shellPending&&!x.splashVisible&&x.visibleSurface.length);
      const states=[...new Set(ready.map(x=>x.p07))];
      timeline.push({path:'/',kind:'first-navigation',readyFrames:ready.length,visiblePolicyStates:states,changes:probe.changes,paints:probe.paints,firstFrames:probe.frames.slice(0,30)});
      assert.equal(home.p07,'enabled','authoritative ON policy must reach V3');
      assert.ok(states.every(x=>x==='enabled'),`visible first paint changed P07 policy during startup: ${JSON.stringify(states)}`);
      return {home,p07States:states,readyFrames:ready.length,policyChanges:probe.changes,paintEntries:probe.paints};
    });

    await installSession(free.session,'/finance');
    await check('free-account-finance-guard-is-visible',async()=>{
      await page.waitFor("!document.getElementById('financeLocked').classList.contains('hidden')",15000,'finance membership gate');
      const gate=await surface('#financeLocked');
      assert.equal(gate.visible,true);assert.equal(gate.insideModalLayer,false);
      assert.equal((await surface('#financeWorkspace')).visible,false);
      return {gate,workspace:await surface('#financeWorkspace')};
    });

    await check('finance-upgrade-shortcut-selects-finance-plans',async()=>{
      const hit=await pointerClick('#financeUpgradeBtn');
      await page.waitFor("location.pathname==='/recharge'&&document.getElementById('membershipModal').getClientRects().length>0&&!document.getElementById('membershipModal').classList.contains('hidden')",15000,'membership workspace via finance');
      await page.waitFor("document.getElementById('membershipPlanList').getAttribute('aria-busy')==='false'",15000,'membership plan load settled');
      const state=await page.evaluate(`(()=>({selected:[...document.querySelectorAll('[data-membership-goal].selected')].map(e=>e.dataset.membershipGoal),
        ariaPressed:[...document.querySelectorAll('[data-membership-goal]')].map(e=>({goal:e.dataset.membershipGoal,value:e.getAttribute('aria-pressed')})),
        plans:[...document.querySelectorAll('#membershipPlanList [data-plan]')].map(e=>e.dataset.plan),
        planHtml:document.getElementById('membershipPlanList').innerHTML,
        planStepHidden:document.getElementById('membershipPlanStep').classList.contains('hidden'),
        route:location.pathname,modalLayers:[...document.querySelectorAll('.modal-layer:not(.hidden)')].map(e=>e.id),
        bodyModalOpen:document.body.classList.contains('modal-open'),shellInert:document.getElementById('appShell').inert,
        insideCanvas:document.getElementById('v3MainCanvas').contains(document.getElementById('membershipModal')),
        ariaModal:document.querySelector('#membershipModal [aria-modal="true"]')?.getAttribute('aria-modal')||null}))()`);
      await saveScreenshot(`${targetSha.slice(0,7)}-membership-from-finance.png`);
      observations['finance-upgrade-shortcut-selects-finance-plans']={hit,state};
      assert.deepEqual(state.selected,['finance'],'finance shortcut must select the finance goal in the visible UI');
      assert.deepEqual(state.plans,['finance_monthly','all_access_monthly','all_access_lifetime'],`finance shortcut plan list mismatch: ${JSON.stringify(state)}`);
      assert.equal(state.modalLayers.length,0,'membership workspace must not be covered by a modal overlay');
      assert.equal(state.bodyModalOpen,false);assert.equal(state.shellInert,false);assert.equal(state.insideCanvas,true);
      return {hit,state};
    });

    await check('membership-is-an-independent-main-workspace',async()=>{
      const memberPage=await surface('#membershipModal');
      const semantics=await page.evaluate("({nestedModal:Boolean(document.querySelector('#membershipModal [aria-modal=true]')),activeElement:document.activeElement?.id||document.activeElement?.tagName})");
      observations['membership-is-an-independent-main-workspace']={memberPage,semantics};
      assert.equal(memberPage.visible,true);assert.equal(memberPage.inMainCanvas,true);assert.equal(memberPage.insideModalLayer,false);
      assert.equal(memberPage.bodyModalOpen,false);assert.equal(memberPage.appShellInert,false);assert.equal(memberPage.modalLayers.length,0);
      return {memberPage,semantics};
    });

    await check('finance-upgrade-manual-goal-remains-usable',async()=>{
      await pointerClick('[data-membership-goal="finance"]');
      await page.waitFor("document.querySelectorAll('#membershipPlanList [data-plan]').length===3",8000,'finance package list');
      const plans=await page.evaluate("[...document.querySelectorAll('#membershipPlanList [data-plan]')].map(e=>({code:e.dataset.plan,text:e.textContent.trim()}))");
      assert.deepEqual(plans.map(x=>x.code),['finance_monthly','all_access_monthly','all_access_lifetime']);
      return {plans};
    });

    await check('membership-order-and-admin-review-boundary',async()=>{
      await page.waitFor("document.querySelectorAll('#membershipPlanList [data-plan]').length===3",8000,'financial choices before order');
      await pointerClick('#membershipPlanList [data-plan="finance_monthly"]');
      await page.waitFor("!document.getElementById('paymentMethodField').classList.contains('hidden')",5000,'payment methods');
      const method=await page.evaluate("document.querySelector('#paymentMethodList input[name=\"paymentMethod\"]')?.value||null");
      assert.ok(method,'no payment method offered');
      await pointerClick(`#paymentMethodList input[name="paymentMethod"][value="${method}"]`);
      await pointerClick('#submitRechargeBtn');
      await page.waitFor("!document.getElementById('paymentOrderBox').classList.contains('hidden')",15000,'local synthetic order');
      const order=await page.evaluate(`(()=>({plan:document.getElementById('paymentPlan').textContent.trim(),amount:document.getElementById('paymentAmount').textContent.trim(),
        method:document.getElementById('paymentMethod').textContent.trim(),status:document.getElementById('paymentStatus').textContent.trim(),
        confirmVisible:!document.getElementById('confirmPaymentBtn').classList.contains('hidden'),orderNumber:document.getElementById('paymentOrderNumber').textContent.trim(),
        qr:document.getElementById('paymentQrImage').src.startsWith('blob:')}))()`);
      assert.match(order.amount,/8(?:\.00)?\s*CNY/);assert.equal(order.status,'等待付款');assert.equal(order.confirmVisible,true);
      const mine=await api('/api/recharge/mine',null,free.session);
      assert.equal(mine.status,200);
      assert.ok((mine.data.requests||[]).some(r=>r.status==='pending_payment'),'created order is absent from own order list');
      await page.waitFor("document.getElementById('paymentQrImage').complete&&document.getElementById('paymentQrImage').naturalWidth>0",10000,'synthetic QR hydration settled');
      const confirmHit=await pointerClick('#confirmPaymentBtn');
      observations['membership-order-and-admin-review-boundary']={order,confirmHit};
      await page.waitFor("document.getElementById('rechargeMessage').textContent.includes('已通知管理员')",10000,'synthetic payment notice');
      const notice=await api('/api/recharge/mine',null,free.session);
      assert.ok(notice.data.requests.some(r=>r.status==='user_paid'),'local user-paid notice was not stored');
      const rights=await api('/api/finance/bootstrap',null,free.session);
      assert.equal(rights.status,403,'user-paid marker must not grant membership');
      return {order:{...order,orderNumber:'[synthetic redacted]'},pendingOrders:(mine.data.requests||[]).length,
        syntheticUserPaidNotice:true,financeBeforeAdmin:403,real_payment:0,scope:'local D1 and synthetic QR object only'};
    });

    await check('membership-route-sidebar-cross-navigation',async()=>{
      const before=await surface('#membershipModal');
      const hit=await pointerClick('#v3Sidebar [data-v3-nav="finance"]');
      await page.waitFor("location.pathname==='/finance'",6000,'sidebar leaves membership');
      const after=await surface('#financePage');
      assert.equal(after.visible,true);assert.equal(after.activeNav.includes('finance'),true);
      assert.equal(after.modalLayers.length,0);assert.equal(after.bodyModalOpen,false);assert.equal(after.appShellInert,false);
      return {before,hit,after};
    });

    await installSession(fin.session,'/account');
    await check('account-is-a-main-workspace-not-a-modal',async()=>{
      await page.waitFor("document.getElementById('accountModal').getClientRects().length>0&&!document.getElementById('accountModal').classList.contains('hidden')",12000,'account workspace');
      const account=await surface('#accountModal');
      const semantics=await page.evaluate("(()=>{const d=document.querySelector('#accountModal [role=dialog]');return d?{role:d.getAttribute('role'),ariaModal:d.getAttribute('aria-modal'),inert:Boolean(d.closest('[inert]'))}:null})()");
      await saveScreenshot(`${targetSha.slice(0,7)}-account.png`);
      observations['account-is-a-main-workspace-not-a-modal']={account,dialogSemantics:semantics};
      assert.equal(account.visible,true);assert.equal(account.inMainCanvas,true);assert.equal(account.insideModalLayer,false);
      assert.equal(account.modalLayers.length,0);assert.equal(account.bodyModalOpen,false);assert.equal(account.appShellInert,false);
      return {account,dialogSemantics:semantics};
    });

    await check('account-workspace-sidebar-remains-in-keyboard-order',async()=>{
      await direct('/account');
      await page.evaluate("document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex');true");
      let focused=null;
      for(let i=0;i<100;i++){
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        focused=await page.evaluate(`(()=>{const e=document.activeElement;return{nav:e?.dataset?.v3Nav||null,id:e?.id||null,tag:e?.tagName||null,
          insideInert:Boolean(e?.closest('[inert]')),rect:(()=>{const r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()}})()`);
        if(['finance','language','tools','home'].includes(focused.nav))break;
      }
      assert.ok(['finance','language','tools','home'].includes(focused?.nav),`Tab could not reach workspace navigation from account: ${JSON.stringify(focused)}`);
      const hit=await page.evaluate(`(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{nav:e.dataset.v3Nav,
        hitNav:h?.closest('[data-v3-nav]')?.dataset.v3Nav||null,ariaModal:document.querySelector('#accountModal [aria-modal="true"]')?.getAttribute('aria-modal')||null}})()`);
      assert.equal(hit.hitNav,hit.nav,'focused sidebar item is covered at its actual center');
      return {focused,hit};
    });

    await check('legacy-account-escape-diagnostic-and-sidebar-exit',async()=>{
      await direct('/account');await waitRouteSurface('/account');
      const before=await surface('#accountModal');
      for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await page.waitFor("!document.body.classList.contains('modal-open')&&!document.getElementById('appShell').inert",5000,'Escape or page navigation remains available');
      const after=await surface('#accountModal');
      const diagnostic={before,after,pathAfterEscape:await page.evaluate('location.pathname'),
        originalCIHiddenAssertionWouldPass:!after.visible};
      await fs.writeFile(path.join(evidence,'legacy-account-escape-observation.json'),JSON.stringify(diagnostic,null,2));
      const hit=await pointerClick('#v3Sidebar [data-v3-nav="finance"]');
      await page.waitFor("location.pathname==='/finance'&&!document.getElementById('financeWorkspace').classList.contains('hidden')",12000,'actual sidebar exit after Escape');
      return {...diagnostic,sidebarHit:hit,actualNavigationSucceeded:true};
    });

    await check('main-workspace-pages-do-not-announce-aria-modal',async()=>{
      const pages=[];
      for(const [route,id] of [['/account','accountModal'],['/recharge','membershipModal']]){
        await direct(route);await waitRouteSurface(route);
        pages.push(await page.evaluate(`(()=>{const p=document.getElementById(${JSON.stringify(id)});return{route:location.pathname,inMain:document.getElementById('v3MainCanvas').contains(p),
          modalSemantics:[...p.querySelectorAll('[aria-modal="true"]')].map(e=>({role:e.getAttribute('role'),className:e.className}))}})()`));
      }
      observations['main-workspace-pages-do-not-announce-aria-modal']=pages;
      assert.ok(pages.every(x=>x.modalSemantics.length===0),`standalone pages retain modal ARIA semantics: ${JSON.stringify(pages)}`);
      return pages;
    });

    await check('synthetic-account-secret-change-revokes-old-session',async()=>{
      const security=await createUser('p07r3security');
      const replacement=randomBytes(24).toString('base64url');
      await installSession(security.session,'/account');
      await page.setFields({'#currentSecretInput':secret,'#newSecretInput':replacement,'#newSecretConfirmInput':replacement});
      await pointerClick('#changeSecretForm button[type="submit"]');
      await page.waitFor("!localStorage.getItem('wyjAccountSession')||location.pathname==='/login'",15000,'security update session revocation');
      const oldSession=await api('/api/me',null,security.session);
      const oldLogin=await api('/api/login',{username:security.username,secret});
      const newLogin=await api('/api/login',{username:security.username,secret:replacement});
      assert.ok([401,403].includes(oldSession.status),`old session survived account key change: ${oldSession.status}`);
      assert.notEqual(oldLogin.status,200,'old key remained valid after change');
      assert.equal(newLogin.status,200,'new key could not sign in');
      return {oldSessionStatus:oldSession.status,oldKeyLoginStatus:oldLogin.status,newKeyLoginStatus:newLogin.status,
        syntheticAccount:true,realAccount:false};
    });

    await check('account-to-learning-tools-home-sidebar-navigation',async()=>{
      await installSession(fin.session,'/account');
      const transitions=[];
      for(const [nav,route,selector] of [['language','/language','#projectPicker'],['tools','/tools','#toolsPanel'],['home','/','#publicHome']]){
        const hit=await pointerClick(`#v3Sidebar [data-v3-nav="${nav}"]`);
        await page.waitFor(`location.pathname===${JSON.stringify(route)}`,8000,`sidebar ${nav}`);
        await page.waitFor(`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).classList.contains('hidden')`,12000,`${nav} visible content`);
        const view=await surface(selector);assert.equal(view.modalLayers.length,0);assert.equal(view.appShellInert,false);
        transitions.push({nav,route,hit,view});
      }
      return transitions;
    });

    await check('browser-back-forward-and-direct-route',async()=>{
      await installSession(fin.session,'/account');
      await pointerClick('#v3Sidebar [data-v3-nav="language"]');
      await page.waitFor("location.pathname==='/language'",8000,'language after account');
      await pointerClick('#v3Sidebar [data-v3-nav="tools"]');
      await page.waitFor("location.pathname==='/tools'",8000,'tools after language');
      await page.evaluate('history.back()');
      await page.waitFor("location.pathname==='/language'",8000,'browser back');
      await page.evaluate('history.forward()');
      await page.waitFor("location.pathname==='/tools'",8000,'browser forward');
      await direct('/account');
      await sampleReload('/account','normal');
      await direct('/account');
      await sampleReload('/account','hard');
      const state=await surface('#accountModal');
      assert.equal(state.visible,true);assert.equal(state.activeNav.includes('account'),true);
      return {backForward:true,normalAndHardRefresh:true,account:state};
    });

    await check('homepage-core-card-coordinate-hit-matrix',async()=>{
      await page.evaluate('localStorage.clear();sessionStorage.clear();true');
      await direct('/');
      await page.waitFor("document.getElementById('publicHome')?.getClientRects().length>0&&!document.getElementById('publicHome').classList.contains('hidden')",15000,'guest public home');
      await openHomeDetails();
      await page.evaluate("document.getElementById('publicCoreCardGallery').scrollIntoView({block:'start',behavior:'instant'});true");await waitRaf();
      await page.evaluate('globalThis.__p07CardClicks=[];true');
      const ids=await page.evaluate("[...document.querySelectorAll('#publicCoreCardGallery [data-core-capability]')].map(e=>e.dataset.coreCapability)");
      assert.ok(ids.length>=5,`expected all capability cards, found ${ids.length}`);
      const rows=[],misses=[];
      for(let i=0;i<ids.length;i++){
        const id=ids[i],other=ids[(i+1)%ids.length];
        debugTrace.push({stage:'card-loop-start',id,other,path:await page.evaluate('location.pathname')});
        if(await visibleHomeSelector()!=='#publicHome'){
          await page.evaluate('localStorage.clear();sessionStorage.clear();true');await direct('/');
          await page.waitFor("document.getElementById('publicHome')?.getClientRects().length>0&&!document.getElementById('publicHome').classList.contains('hidden')",15000,'return to guest home');
        }
        await openHomeDetails();
        await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});true`);await waitRaf();
        const exists=await page.evaluate(`Boolean(document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]'))`);
        debugTrace.push({stage:'card-exists',id,exists,path:await page.evaluate('location.pathname')});
        if(!exists){misses.push({id,point:'card-exists',path:await page.evaluate('location.pathname')});continue;}
        const reset=async()=>{
          const otherExists=await page.evaluate(`Boolean(document.querySelector('#publicCoreCardGallery [data-core-capability="${other}"] .capability-trigger'))`);
          if(otherExists)await pointerClick(`#publicCoreCardGallery [data-core-capability="${other}"] .capability-trigger`);
        };
        const rect=await page.evaluate(`(()=>{const e=document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]'),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
        const targets=[];
        await reset();
        const title=await pointerClick(`#publicCoreCardGallery [data-core-capability="${id}"] .capability-trigger`);
        debugTrace.push({stage:'title-clicked',id,hit:title.hit,path:await page.evaluate('location.pathname')});
        await page.waitFor(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')`,3000,'card title expands').catch(()=>{});
        const titleActive=await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')||false`);
        if(!titleActive)misses.push({id,point:'title',hit:title.hit,active:false});
        targets.push({point:'title',...title,active:titleActive});
        await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"] .capability-copy p')?.scrollIntoView({block:'center',behavior:'instant'});true`);await waitRaf();
        const description=await page.evaluate(`(()=>{const c=document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]'),e=c?.querySelector('.capability-copy p');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,visible:!!e.getClientRects().length}})()`);
        if(description?.visible){const hit=await clickAt(description.x,description.y);if(hit.hit?.core!==id)misses.push({id,point:'description',hit:hit.hit});targets.push({point:'description',...hit,active:(await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')||false`))});}
        for(const [point,rx,ry] of [['left-top-blank',0.02,0.45],['center-blank',0.5,0.84],['right-bottom-blank',0.98,0.9]]){
          await reset();
          await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});true`);await waitRaf();
          const p=await page.evaluate(`(()=>{const c=document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]'),r=c.getBoundingClientRect();return{x:r.x+r.width*${rx},y:r.y+r.height*${ry}}})()`);
          const clicked=await clickAt(p.x,p.y);
          const active=await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')||false`);
          const cardHit=clicked.hit?.core===id;
          if(!cardHit||!active)misses.push({id,point,hit:clicked.hit,active});
          targets.push({point,...clicked,active});
        }
        await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await waitRaf();
        await reset();
        await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"] .capability-trigger').scrollIntoView({block:'center',behavior:'instant'});true`);await waitRaf();
        const touch=await page.evaluate(`(()=>{const e=document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"] .capability-trigger'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
        await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitFor(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')`,3000,'touch expands card').catch(()=>{});
        const touchActive=await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')||false`);
        if(!touchActive)misses.push({id,point:'touch-trigger',hit:await page.evaluate(`document.elementFromPoint(${touch.x},${touch.y})?.outerHTML||null`),active:false});
        targets.push({point:'touch-trigger',...touch,active:touchActive});
        await setViewport(1440,960,false);
        await reset();
        await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"] .capability-trigger')?.focus()`);
        const enterBefore=await page.evaluate('(globalThis.__p07CardClicks||[]).length');
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await page.waitFor(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')`,3000,'Enter expands card').catch(()=>{});
        const enterActive=await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')||false`);
        const enterClick=await page.evaluate(`(globalThis.__p07CardClicks||[]).slice(${enterBefore}).some(e=>e.id===${JSON.stringify(id)}&&e.trusted&&e.detail===0)`);
        if(!enterActive||!enterClick)misses.push({id,point:'keyboard-enter',active:enterActive,nativeClick:enterClick});
        targets.push({point:'keyboard-enter',active:enterActive,nativeClick:enterClick});
        await reset();
        await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"] .capability-trigger')?.focus()`);
        const spaceBefore=await page.evaluate('(globalThis.__p07CardClicks||[]).length');
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await page.waitFor(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')`,3000,'Space expands card').catch(()=>{});
        const spaceActive=await page.evaluate(`document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]')?.classList.contains('active')||false`);
        const spaceClick=await page.evaluate(`(globalThis.__p07CardClicks||[]).slice(${spaceBefore}).some(e=>e.id===${JSON.stringify(id)}&&e.trusted&&e.detail===0)`);
        if(!spaceActive||!spaceClick)misses.push({id,point:'keyboard-space',active:spaceActive,nativeClick:spaceClick});
        targets.push({point:'keyboard-space',active:spaceActive,nativeClick:spaceClick});
        const cta=await page.evaluate(`(()=>{const c=document.querySelector('#publicCoreCardGallery [data-core-capability="${id}"]'),e=[...(c?.querySelectorAll('.capability-body a,.capability-body button')||[])].find(n=>n.getClientRects().length&&!n.closest('.hidden')&&!n.classList.contains('capability-trigger'));if(!e)return null;const r=e.getBoundingClientRect();return{selector:e.id?'#'+e.id:e.matches('a')?'a[data-public-capability="'+e.dataset.publicCapability+'"]':'button[data-module="'+e.dataset.module+'"]',text:e.innerText.trim(),x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        if(cta){
          const pathBefore=await page.evaluate('location.pathname');
          const hit=await pointerClick(cta.selector);
          await page.waitFor("location.pathname!=='/'||Boolean(document.getElementById('authPanel')&&!document.getElementById('authPanel').closest('.hidden'))",5000,`${id} internal CTA`).catch(()=>{});
          const after=await page.evaluate("({path:location.pathname,authVisible:Boolean(document.getElementById('authPanel')&&!document.getElementById('authPanel').closest('.hidden')),loginVisible:Boolean(document.getElementById('entryScreen')&&!document.getElementById('entryScreen').closest('.hidden'))})");
          const acted=after.path!==pathBefore||after.authVisible||after.loginVisible;
          if(!acted)misses.push({id,point:'internal-cta',hit,after});
          targets.push({point:'internal-cta',selector:cta.selector,text:cta.text,hit,after,acted});
          await direct('/');
        }else{misses.push({id,point:'internal-cta',reason:'no visible independent action'});}
        rows.push({id,rect,targets});
      }
      const eventLog=await page.evaluate('globalThis.__p07CardClicks||[]');
      await saveScreenshot(`${targetSha.slice(0,7)}-home-feature-card-expanded.png`);
      observations['homepage-core-card-coordinate-hit-matrix']={ids,rows,event_log:eventLog.slice(-60),misses};
      await fs.writeFile(path.join(evidence,'round3-card-hit-matrix.json'),JSON.stringify(observations['homepage-core-card-coordinate-hit-matrix'],null,2));
      assert.equal(misses.length,0,`card coordinate and keyboard/touch misses: ${JSON.stringify(misses)}`);
      return {ids,rows,event_log:eventLog.slice(-60),misses};
    });

    await check('standalone-english-japanese-views-and-quiz-card-geometry',async()=>{
      const languageResults=[],geometryFailures=[];
      for(const language of ['english','japanese']){
        await installSession(fin.session,`/language/${language}`);
        await page.waitFor("!document.getElementById('projectApp').classList.contains('hidden')",12000,`${language} workspace`);
        const viewIds=await page.evaluate("[...document.querySelectorAll('#projectApp [data-view]')].map(e=>e.dataset.view)");
        assert.deepEqual(viewIds,['setupView','quizView','wrongView','achievementsView','studyView']);
        const input=language==='english'?'hello\nworld':'電話\n先生';
        await page.setFields({'#wordInput':input});
        await pointerClick('#startBtn');
        await page.waitFor("document.getElementById('quizView').classList.contains('active')",12000,`${language} quiz start`);
        const geometry=[];
        for(const width of [1024,1440,1920]){
          await setViewport(width,960,false);
          const g=await page.evaluate(`(()=>{const c=document.getElementById('v3MainCanvas').getBoundingClientRect(),q=document.querySelector('#quizView .quiz-card').getBoundingClientRect();return{
            viewport:innerWidth,canvas:{x:c.x,width:c.width,center:c.x+c.width/2},card:{x:q.x,y:q.y,width:q.width,height:q.height,center:q.x+q.width/2},
            centerDelta:(q.x+q.width/2)-(c.x+c.width/2),rightPanel:[...document.querySelectorAll('#projectApp aside,#projectApp .side-panel')].filter(e=>e.getClientRects().length).map(e=>({text:e.innerText.trim().slice(0,100),width:e.getBoundingClientRect().width}))};})()`);
          geometry.push(g);
          if(Math.abs(g.centerDelta)>3)geometryFailures.push({language,width,issue:'not_centered_in_main_canvas',...g});
          if(!(g.card.width>0&&g.card.x>=g.canvas.x-2&&g.card.x+g.card.width<=g.canvas.x+g.canvas.width+2))geometryFailures.push({language,width,issue:'outside_main_canvas',...g});
          if(width===1440)await saveScreenshot(`${targetSha.slice(0,7)}-${language}-quiz-1440.png`);
        }
        for(const view of viewIds){
          await pointerClick(`#projectApp [data-view="${view}"]`);
          await page.waitFor(`document.getElementById(${JSON.stringify(view)}).classList.contains('active')`,5000,`${language} ${view} view`);
          assert.ok(await page.evaluate(`Boolean(document.getElementById(${JSON.stringify(view)}).getClientRects().length)`),`${language} ${view} has no visible surface`);
        }
        await pointerClick('#projectApp [data-view="quizView"]');
        const word=await page.evaluate("document.getElementById('wordText').textContent");
        languageResults.push({language,viewIds,geometry,question:word});
      }
      await setViewport(1440,960,false);
      observations['standalone-english-japanese-views-and-quiz-card-geometry']={languageResults,geometryFailures};
      assert.equal(geometryFailures.length,0,`learning-card geometry failed: ${JSON.stringify(geometryFailures)}`);
      return {languageResults,geometryFailures};
    });

    await check('learning-submit-next-skip-refresh-and-language-isolation',async()=>{
      await installSession(fin.session,'/language/english');
      const fixtures={english:{words:['hello','world','school'],answers:{hello:'你好',world:'世界',school:'学校'}},
        japanese:{words:['電話','花','水'],answers:{'電話':'电话','花':'花','水':'水'}}};
      const rows=[];
      for(const language of ['english','japanese']){
        if(language!=='english'){await direct('/language/'+language);await waitRouteSurface('/language/'+language);}
        await pointerClick('#setupViewTab');
        await page.setFields({'#wordInput':fixtures[language].words.join('\n'),'#practiceModeSelect':'meaning'});
        await pointerClick('#startBtn');
        await page.waitFor("document.getElementById('quizView').classList.contains('active')",15000,language+' active round');
        const first=await page.evaluate("document.getElementById('wordText').textContent.trim()");
        assert.ok(fixtures[language].answers[first],`unexpected ${language} question ${first}`);
        await page.setFields({'#answerInput':fixtures[language].answers[first]});
        await pointerClick('#submitBtn');
        await page.waitFor("document.getElementById('scoreLabel').textContent==='得分 1'&&!document.getElementById('resultPanel').classList.contains('hidden')",12000,language+' actual feedback');
        const feedback=await page.evaluate("({title:document.getElementById('resultTitle').textContent,gloss:document.getElementById('resultGloss').textContent,score:document.getElementById('scoreLabel').textContent})");
        await pointerClick('#nextNowBtn');
        await page.waitFor("document.getElementById('progressLabel').textContent==='2/3'",5000,language+' next question');
        const skipped=await page.evaluate("document.getElementById('wordText').textContent.trim()");
        await pointerClick('#skipBtn');
        await page.waitFor("!document.getElementById('nextNowBtn').disabled&&document.getElementById('statWrong').textContent==='1'",12000,language+' skip result');
        await pointerClick('#nextNowBtn');
        await page.waitFor("document.getElementById('progressLabel').textContent==='3/3'",5000,language+' third question');
        const before=await page.evaluate("({word:document.getElementById('wordText').textContent.trim(),progress:document.getElementById('progressLabel').textContent,score:document.getElementById('scoreLabel').textContent,wrong:document.getElementById('statWrong').textContent})");
        const previous=await page.evaluate('globalThis.__p07R3DocumentId');
        await page.send('Page.reload',{ignoreCache:false});
        await newDocumentReady(previous,'/language/'+language);await waitRouteSurface('/language/'+language);
        await page.waitFor("document.getElementById('quizView').classList.contains('active')",10000,language+' restored active round');
        const after=await page.evaluate("({word:document.getElementById('wordText').textContent.trim(),progress:document.getElementById('progressLabel').textContent,score:document.getElementById('scoreLabel').textContent,wrong:document.getElementById('statWrong').textContent})");
        assert.deepEqual(after,before,language+' active question changed on ordinary refresh');
        await pointerClick('#wrongViewTab');
        const wrongText=await page.evaluate("document.getElementById('wrongView').textContent");
        assert.ok(wrongText.includes(skipped),language+' skipped word missing from wrong view');
        await saveScreenshot(`${targetSha.slice(0,7)}-${language}-wrong-after-refresh.png`);
        rows.push({language,first,feedback,skipped,before,after,wrongContainsSkipped:true});
      }
      const isolation=[];
      for(const language of ['english','japanese']){
        await direct('/language/'+language);await waitRouteSurface('/language/'+language);
        await pointerClick('#setupViewTab');
        const words=await page.evaluate("document.getElementById('wordInput').value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean)");
        assert.deepEqual([...words].sort(),[...fixtures[language].words].sort(),language+' word list leaked or was lost');
        await pointerClick('#wrongViewTab');
        const wrong=await page.evaluate("document.getElementById('wrongView').textContent");
        const own=rows.find(r=>r.language===language).skipped;
        const other=rows.find(r=>r.language!==language).skipped;
        assert.ok(wrong.includes(own));assert.equal(wrong.includes(other),false,language+' wrong view leaked the other language');
        isolation.push({language,words,ownWrongVisible:true,otherLanguageWrongVisible:false});
      }
      return {rows,isolation,real_ai_quality:'NOT_TESTED',known_local_dictionary_words:true};
    });

    await check('japanese-ai-off-reading-failure-leaves-meaning-ui-usable',async()=>{
      await installSession(fin.session,'/language/japanese');
      await pointerClick('#setupViewTab');
      await page.setFields({'#wordInput':'超稀有漢字語','#practiceModeSelect':'meaning'});
      const dialogsBefore=page.dialogs.length,requestsBefore=networkTrace.length;
      await pointerClick('#startBtn');
      await page.waitFor("document.getElementById('quizView').classList.contains('active')",15000,'unresolved kana does not prevent meaning round');
      const ui=await page.evaluate("({question:document.getElementById('wordText').textContent,answerEnabled:!document.getElementById('answerInput').disabled,skipEnabled:!document.getElementById('skipBtn').disabled,toast:document.getElementById('achievementToast').textContent,webdriver:navigator.webdriver})");
      assert.equal(ui.answerEnabled,true);assert.equal(ui.skipEnabled,true);
      await pointerClick('#backBtn');
      await page.waitFor("document.getElementById('setupView').classList.contains('active')",5000,'return to word list after AI unavailable');
      return {ui,readingRequests:networkTrace.slice(requestsBefore).filter(x=>x.path==='/api/japanese/readings'),
        automationDialogsAcknowledged:page.dialogs.slice(dialogsBefore),workers_ai_enabled:false,
        scope:'actual AI_OFF response; WebDriver alert is acknowledged by the existing harness; no model quality acceptance'};
    });

    await check('english-local-rubric-and-ai-off-fail-closed',async()=>{
      const quiz=await api('/api/quiz/start',{language:'english',words:['hello']},free.session);
      assert.equal(quiz.status,200);
      const rubric=await api('/api/rubric',{word:'hello',quiz_session:quiz.data.quiz_session},free.session);
      const unknownQuiz=await api('/api/quiz/start',{language:'english',words:['p07round3unlistedzz']},free.session);
      const unknownRubric=await api('/api/rubric',{word:'p07round3unlistedzz',quiz_session:unknownQuiz.data.quiz_session},free.session);
      assert.equal(rubric.status,200,`known English local rubric unavailable: ${JSON.stringify(rubric.data)}`);
      assert.equal(rubric.data.source,'local','known English term should use local dictionary');
      assert.equal(unknownRubric.status,503);assert.equal(unknownRubric.data.code,'ai_unavailable');
      const judged=await api('/api/judge',{word:'hello',answer:rubric.data.rubric.gloss,quiz_session:quiz.data.quiz_session,
        rubric:rubric.data.rubric,mode:'normal',language:'english'},free.session);
      assert.equal(judged.status,200);assert.equal(judged.data.ai_review,false);assert.equal(judged.data.correct,true);
      return {known_rubric_source:rubric.data.source,known_judgement:{correct:judged.data.correct,ai_review:judged.data.ai_review,kind:judged.data.kind},
        unlisted_rubric:{status:unknownRubric.status,code:unknownRubric.data.code},workers_ai_enabled:false,real_ai_calls:0};
    });

    await check('japanese-reading-and-meaning-services-are-distinct',async()=>{
      const quiz=await api('/api/quiz/start',{language:'japanese',words:['電話']},free.session);
      assert.equal(quiz.status,200);
      const reading=await api('/api/japanese/readings',{words:['電話'],quiz_session:quiz.data.quiz_session},free.session);
      const rubric=await api('/api/rubric',{word:'電話',quiz_session:quiz.data.quiz_session},free.session);
      const unknownQuiz=await api('/api/quiz/start',{language:'japanese',words:['超稀有漢字語']},free.session);
      const unknownReading=await api('/api/japanese/readings',{words:['超稀有漢字語'],quiz_session:unknownQuiz.data.quiz_session},free.session);
      assert.equal(rubric.status,200,`known Japanese rubric unavailable: ${JSON.stringify(rubric.data)}`);
      return {reading:{status:reading.status,code:reading.data?.code||null,readings:reading.data?.readings||null,
          ai_unavailable:reading.data?.ai_unavailable||false},
        meaning_rubric:{status:rubric.status,source:rubric.data.source||null,gloss:rubric.data.rubric?.gloss||null},
        unlisted_reading:{status:unknownReading.status,code:unknownReading.data?.code||null,
          ai_unavailable:unknownReading.data?.ai_unavailable||false,unresolved:unknownReading.data?.unresolved||[]},
        endpoints:{furigana:'/api/japanese/readings',meaning:'/api/rubric + /api/judge'},workers_ai_enabled:false,real_ai_calls:0};
    });

    await check('finance-real-ledger-summary-and-chart',async()=>{
      await installSession(fin.session,'/finance');
      await page.waitFor("!document.getElementById('financeWorkspace').classList.contains('hidden')",15000,'finance member ledger');
      await setViewport(1440,960,false);
      await page.waitFor("document.getElementById('financeSyncStatus').textContent==='已同步'",20000,'initial finance sync');
      await page.evaluate("document.getElementById('financeRecordedSection').open=true;true");
      const initial=await page.evaluate(`(()=>({income:document.getElementById('financeIncomeTotal').textContent,expense:document.getElementById('financeExpenseTotal').textContent,
        balance:document.getElementById('financeBalanceTotal').textContent,empty:document.getElementById('financeTransactionList').innerText.trim(),
        chart:document.getElementById('financeTrendChartWrap').innerText.trim()}))()`);
      const records=[
        {direction:'income',amount:'1000000.00',merchant:'P07 R3 income'},
        {direction:'expense',amount:'10000000.00',merchant:'P07 R3 expense large'},
        {direction:'expense',amount:'1000.00',merchant:'P07 R3 expense small'},
      ];
      const now=new Date(),dateTime=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T12:00`;
      let recordIndex=0;
      for(const r of records){
        await pointerClick('#financeAddTransactionBtn');
        await page.waitFor("!document.getElementById('financeTransactionModal').classList.contains('hidden')",5000,'transaction editor');
        await page.setFields({'#financeTransactionDirection':r.direction,'#financeTransactionAmount':r.amount,
          '#financeTransactionTime':dateTime,'#financeTransactionMerchant':r.merchant});
        await pointerClick('#financeTransactionForm button[type="submit"]');
        recordIndex++;
        await page.waitFor(`Number(document.getElementById('financeRecordedCount').textContent)>=${recordIndex}`,12000,`saved ${r.merchant}`);
      }
      await page.waitFor("document.getElementById('financeSyncStatus').textContent==='已同步'",20000,'synthetic finance sync');
      const totals=await page.evaluate(`(()=>({income:document.getElementById('financeIncomeTotal').textContent,expense:document.getElementById('financeExpenseTotal').textContent,
        balance:document.getElementById('financeBalanceTotal').textContent,count:document.getElementById('financeRecordedCount').textContent,
        summaryWrap:[...document.querySelectorAll('.finance-summary-grid strong')].map(e=>({text:e.textContent,rect:{x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height},clientRects:e.getClientRects().length})),
        chart:document.getElementById('financeTrendChartWrap').innerText.trim(),svg:document.querySelector('#financeTrendChartWrap svg')?.outerHTML||null,
        axis:[...document.querySelectorAll('#financeTrendChartWrap svg text')].map(e=>({text:e.textContent,x:e.getAttribute('x'),y:e.getAttribute('y'),anchor:e.getAttribute('text-anchor')})),
        rows:[...document.querySelectorAll('[data-finance-transaction]')].map(e=>({id:e.dataset.financeTransaction,text:e.innerText.trim()})),
        chartPoints:[...document.querySelectorAll('#financeTrendChartWrap svg circle')].map(e=>({cx:Number(e.getAttribute('cx')),cy:Number(e.getAttribute('cy')),title:e.querySelector('title')?.textContent||e.getAttribute('aria-label')})),
        tickBounds:[...document.querySelectorAll('#financeTrendChartWrap svg text[text-anchor=end]')].map(e=>({text:e.textContent,x:e.getBBox().x,right:e.getBBox().x+e.getBBox().width})),
        rowCount:document.querySelectorAll('[data-finance-transaction]').length}))()`);
      const numeric=text=>Number(String(text).replace(/,/g,'').replace(/[^0-9.-]/g,''));
      assert.equal(numeric(totals.income),1000000);assert.equal(numeric(totals.expense),10001000);assert.equal(numeric(totals.balance),-9001000);
      assert.equal(totals.rowCount,3);
      const ledger=await api('/api/finance/transactions?limit=100',null,fin.session);
      assert.equal(ledger.status,200);
      const transactions=ledger.data.transactions||[];
      const persisted={income_minor:transactions.filter(x=>x.direction==='income').reduce((n,x)=>n+x.amount_minor,0),
        expense_minor:transactions.filter(x=>x.direction==='expense').reduce((n,x)=>n+x.amount_minor,0),count:transactions.length,
        currencies:[...new Set(transactions.map(x=>x.currency))]};
      assert.equal(persisted.income_minor,100000000);assert.equal(persisted.expense_minor,1000100000);assert.equal(persisted.count,3);
      assert.deepEqual(persisted.currencies,['CNY']);
      assert.equal(totals.chartPoints.length,12,'six actual monthly points per series');
      assert.ok(totals.chartPoints[5].title.replaceAll(',','').includes('1000000.00'),'current month income point mismatch');
      assert.ok(totals.chartPoints[11].title.replaceAll(',','').includes('10001000.00'),'current month expense point mismatch');
      const axisText=totals.axis.map(x=>x.text).join(' ');
      const axisFormatted=/万|千|\d{1,3}(,\d{3})/.test(axisText);
      await saveScreenshot(`${targetSha.slice(0,7)}-finance-extreme-values.png`);
      const amountWidths=[],amountWraps=[];
      for(const width of [1024,1440,1920]){
        await setViewport(width,960,false);
        const layout=await page.evaluate(`(()=>({width:innerWidth,amounts:[...document.querySelectorAll('.finance-summary-grid strong')].map(e=>{
          const r=document.createRange();r.selectNodeContents(e);const rects=[...r.getClientRects()],cs=getComputedStyle(e);
          return{text:e.textContent.trim(),lines:rects.length,height:e.getBoundingClientRect().height,lineHeight:cs.lineHeight,fontSize:cs.fontSize,width:e.getBoundingClientRect().width}})}))()`);
        amountWidths.push(layout);
        for(const item of layout.amounts)if(item.lines>1)amountWraps.push({viewport:layout.width,...item});
      }
      await setViewport(1440,960,false);
      await page.setFields({'#financeDirectionFilter':'expense'});
      await page.waitFor("document.querySelectorAll('[data-finance-transaction]').length===2",5000,'expense filter');
      const filtered=await page.evaluate("document.querySelectorAll('[data-finance-transaction]').length");
      assert.equal(filtered,2);
      const clippedTicks=totals.tickBounds.filter(x=>x.x<0);
      observations['finance-real-ledger-summary-and-chart']={initial,totals,persisted,axisFormatted,amountWidths,amountWraps,clippedTicks,expenseFilterRows:filtered};
      assert.ok(axisFormatted&&amountWraps.length===0&&clippedTicks.length===0,`finance formatting issue: axisFormatted=${axisFormatted}, axis=${axisText}, wraps=${JSON.stringify(amountWraps)}, clippedTicks=${JSON.stringify(clippedTicks)}`);
      return {initial,totals:{income:totals.income,expense:totals.expense,balance:totals.balance,count:totals.count,
        chart:totals.chart,axis:totals.axis,rowCount:totals.rowCount,rows:totals.rows,chartPoints:totals.chartPoints},persisted,axisFormatted,amountWidths,amountWraps,clippedTicks,expenseFilterRows:filtered};
    });

    await check('finance-edit-delete-chart-update-and-empty-ledger',async()=>{
      await installSession(fin.session,'/finance');
      await page.waitFor("!document.getElementById('financeWorkspace').classList.contains('hidden')",15000,'finance ledger for edits');
      await page.waitFor("document.getElementById('financeSyncStatus').textContent==='已同步'",20000,'reloaded finance sync');
      if(!await page.evaluate("document.getElementById('financeRecordedSection').open"))await pointerClick('#financeRecordedSection > summary');
      await page.waitFor("document.getElementById('financeRecordedSection').open",5000,'expanded ledger');
      await page.setFields({'#financeDirectionFilter':'','#financeSearchInput':''});
      await page.waitFor("document.querySelectorAll('[data-finance-transaction]').length===3",10000,'all synthetic ledger rows');
      const incomeRow=await page.evaluate(`(()=>{const r=[...document.querySelectorAll('[data-finance-transaction]')].find(e=>e.textContent.includes('P07 R3 income'));return r?{id:r.dataset.financeTransaction,edit:r.querySelector('[data-finance-edit]')?.dataset.financeEdit||null,html:r.outerHTML}:null})()`);
      assert.ok(incomeRow?.edit,`income row edit action missing: ${JSON.stringify(incomeRow)}`);
      const chartBefore=await page.evaluate("document.querySelector('#financeTrendChartWrap svg')?.innerHTML||''");
      await pointerClick(`[data-finance-edit="${incomeRow.edit}"]`);
      await page.waitFor("!document.getElementById('financeTransactionModal').classList.contains('hidden')",5000,'edit transaction modal');
      await page.setFields({'#financeTransactionAmount':'2000000.00'});
      await pointerClick('#financeTransactionForm button[type="submit"]');
      await page.waitFor("document.getElementById('financeIncomeTotal').textContent.includes('2,000,000')",10000,'edited income total');
      const edited=await page.evaluate(`(()=>({income:document.getElementById('financeIncomeTotal').textContent,
        chart:document.querySelector('#financeTrendChartWrap svg')?.innerHTML||'',rows:document.querySelectorAll('[data-finance-transaction]').length}))()`);
      assert.notEqual(edited.chart,chartBefore,'finance chart did not change after edit');
      const smallRow=await page.evaluate(`(()=>{const r=[...document.querySelectorAll('[data-finance-transaction]')].find(e=>e.textContent.includes('P07 R3 expense small'));return r?{id:r.dataset.financeTransaction,del:r.querySelector('[data-finance-delete]')?.dataset.financeDelete||null}:null})()`);
      assert.ok(smallRow?.del,'small expense delete action missing');
      const chartEdited=edited.chart;
      await pointerClick(`[data-finance-delete="${smallRow.del}"]`);
      await page.waitFor("document.querySelectorAll('[data-finance-transaction]').length===2",10000,'deleted expense leaves two rows');
      const deleted=await page.evaluate(`(()=>({expense:document.getElementById('financeExpenseTotal').textContent,
        chart:document.querySelector('#financeTrendChartWrap svg')?.innerHTML||'',rows:document.querySelectorAll('[data-finance-transaction]').length}))()`);
      assert.notEqual(deleted.chart,chartEdited,'finance chart did not change after delete');
      for(let remaining=2;remaining>0;remaining--){
        const del=await page.evaluate("document.querySelector('[data-finance-transaction] [data-finance-delete]')?.dataset.financeDelete||null");
        assert.ok(del,'delete control missing while clearing synthetic ledger');
        await pointerClick(`[data-finance-delete="${del}"]`);
        await page.waitFor(`document.querySelectorAll('[data-finance-transaction]').length===${remaining-1}`,10000,'ledger row removed');
      }
      const empty=await page.evaluate(`(()=>({income:document.getElementById('financeIncomeTotal').textContent,expense:document.getElementById('financeExpenseTotal').textContent,
        balance:document.getElementById('financeBalanceTotal').textContent,count:document.getElementById('financeRecordedCount').textContent,
        list:document.getElementById('financeTransactionList').innerText.trim(),chart:document.getElementById('financeTrendChartWrap').innerText.trim()}))()`);
      assert.equal(Number(empty.count),0);
      assert.match(empty.list,/暂无符合条件的账目/);assert.match(empty.chart,/暂无月度收支走势数据/);
      assert.ok([empty.income,empty.expense,empty.balance].every(x=>Number(x.replace(/[^0-9.-]/g,''))===0),'empty ledger summary must be zero');
      return {edited:{income:edited.income,rows:edited.rows,chart_changed:true},deleted:{expense:deleted.expense,rows:deleted.rows,chart_changed:true},empty};
    });

    await check('admin-and-member-authorization-isolation',async()=>{
      const noAuth=await api('/api/admin/users');
      const member=await api('/api/admin/users',null,free.session);
      const adminLogin=await api('/api/login',{username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET});
      const adminUsers=await api('/api/admin/users',null,adminLogin.data.session);
      assert.equal(noAuth.status,401);assert.equal(member.status,403);assert.equal(adminUsers.status,200);
      await installSession(free.session,'/admin');
      const memberPage=await surface('#adminPanel');
      assert.equal(memberPage.visible,false,'ordinary member must not see admin panel');
      await installSession(adminLogin.data.session,'/admin');
      await page.waitFor("!document.getElementById('adminPanel').classList.contains('hidden')",15000,'admin panel');
      await page.waitFor("document.getElementById('adminPanel').getAttribute('aria-busy')==='false'",15000,'admin data loaded');
      const desktop=await surface('#adminPanel');
      await saveScreenshot(`${targetSha.slice(0,7)}-admin-desktop.png`);
      await setViewport(390,844,true);
      const mobile=await page.evaluate(`(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panelWidth:document.getElementById('adminPanel').getBoundingClientRect().width,
        tabs:[...document.querySelectorAll('.admin-tabs button:not(.hidden)')].map(e=>({text:e.textContent.trim(),right:e.getBoundingClientRect().right,disabled:e.disabled})),
        users:document.querySelectorAll('#adminUserList [data-user-id],#adminUserList .admin-user-card').length}))()`);
      await saveScreenshot(`${targetSha.slice(0,7)}-admin-mobile-390.png`);
      assert.ok(mobile.scrollWidth<=mobile.width+1,`mobile admin overflows: ${JSON.stringify(mobile)}`);
      const views=await page.evaluate("[...document.querySelectorAll('[data-admin-view]')].map(e=>e.dataset.adminView)");
      const checked=[];
      for(const view of ['adminUsersView','adminRechargeView','adminAuditView']){
        assert.ok(views.includes(view),`required admin view missing: ${view}`);
        await pointerClick(`[data-admin-view="${view}"]`);
        await page.waitFor(`document.getElementById(${JSON.stringify(view)}).classList.contains('active')`,5000,`admin ${view}`);
        checked.push(view);
      }
      await pointerClick('[data-admin-view="adminRechargeView"]');
      const request=await page.evaluate(`(()=>{const r=[...document.querySelectorAll('#adminRechargeList [data-request-id]')].find(e=>e.textContent.includes(${JSON.stringify(free.username)}));return r?{id:r.dataset.requestId,text:r.textContent,approve:Boolean(r.querySelector('[data-recharge-approve]'))}:null})()`);
      assert.ok(request?.approve,'synthetic user-paid order has no administrator approval action');
      await pointerClick(`#adminRechargeList [data-request-id="${request.id}"] [data-recharge-approve]`);
      await page.waitFor("!document.getElementById('confirmModal').classList.contains('hidden')",5000,'admin approval confirmation');
      await pointerClick('#acceptConfirmBtn');
      await page.waitFor(`Boolean(document.querySelector('#adminRechargeList [data-request-id="${request.id}"]'))&&!document.querySelector('#adminRechargeList [data-request-id="${request.id}"] [data-recharge-approve]')`,15000,'approved order rendered');
      const afterApproval=await api('/api/finance/bootstrap',null,free.session);
      assert.equal(afterApproval.status,200,'administrator approval did not grant the purchased finance entitlement');
      const ownOrders=await api('/api/recharge/mine',null,free.session);
      assert.ok(ownOrders.data.requests.some(r=>r.id===request.id&&['activated','approved'].includes(r.status)),'order was not activated');
      await pointerClick('[data-admin-view="adminAuditView"]');
      await page.waitFor("document.querySelectorAll('#adminAuditList .admin-log-card').length>0",10000,'admin audit entries');
      const audit=await api('/api/admin/audit',null,adminLogin.data.session);
      assert.equal(audit.status,200);assert.ok((audit.data.logs||[]).length>0,'admin audit API empty after local approval');
      assert.equal((await api('/api/admin/users',null,free.session)).status,403,'new membership must not grant administrator privileges');
      await saveScreenshot(`${targetSha.slice(0,7)}-admin-audit-mobile-390.png`);
      await setViewport(1440,960,false);
      return {api:{anonymous:noAuth.status,member:member.status,admin:adminUsers.status},memberPanel:memberPage,
        adminPanel:desktop,mobile,adminViews:checked,syntheticApproval:{financeBeforeAdmin:403,financeAfterAdmin:afterApproval.status,
          orderActivated:true,auditEntries:(audit.data.logs||[]).length,realPayment:0}};
    });

    await check('refresh-continuity-all-required-pages',async()=>{
      const routes=[['/','home'],['/language/english','projectApp'],['/language/japanese','projectApp'],
        ['/finance','financeWorkspace'],['/recharge','membershipModal'],['/account','accountModal']];
      const rows=[];
      for(const [route,selector] of routes){
        await installSession(fin.session,route);
        if(route==='/')await waitRouteSurface(route);
        else await page.waitFor(`document.querySelector(${JSON.stringify('#'+selector)})`,10000,`${route} surface exists`);
        const selectorActual=route==='/'?await visibleHomeSelector():('#'+selector);
        assert.ok(selectorActual,`no visible home workspace at ${route}`);
        const state=await surface(selectorActual);
        assert.equal(state.visible,true,`${route} content did not render before refresh`);
        const normal=await sampleReload(route,'normal');
        const hard=await sampleReload(route,'hard');
        await waitRouteSurface(route);
        const finalSelector=route==='/'?await visibleHomeSelector():selectorActual;
        const final=await surface(finalSelector);
        assert.equal(final.visible,true,`${route} content missing after hard refresh`);
        rows.push({route,normal,hard,final});
        observations['refresh-continuity-all-required-pages']=rows;
      }
      return rows;
    });

    await check('delayed-authoritative-policy-does-not-flash-legacy-layout',async()=>{
      await page.evaluate('localStorage.clear();sessionStorage.clear();true');
      const fixture={transport_delay_ms:1200,api:'/api/ui/features',response:'fresh actual local server policy',
        uiChanges:false,real_ai_calls:0};
      await page.intercept([{match:'/api/ui/features',respond:async()=>{
        const response=await fetch(base+'/api/ui/features');return{status:response.status,body:await response.json(),delayMs:fixture.transport_delay_ms};
      }}]);
      await direct('/');await waitRouteSurface('/');
      const first=await surface('#publicHome');
      if(first.p07!=='enabled')await saveScreenshot(`${targetSha.slice(0,7)}-policy-delayed-visible-legacy.png`);
      await page.waitFor("document.documentElement.dataset.p07Ui==='enabled'",10000,'delayed real policy arrives');
      await waitRaf();
      await saveScreenshot(`${targetSha.slice(0,7)}-policy-delayed-final-v3.png`);
      const frames=await page.evaluate('globalThis.__p07R3Frames||[]');
      const visible=frames.filter(x=>x.shellVisible&&!x.shellPending&&!x.splashVisible&&x.visibleSurface.length);
      const legacy=visible.filter(x=>x.p07!=='enabled');
      const result={fixture,first,visibleFrames:visible,visibleLegacyFrames:legacy.length,
        visibleLegacyDurationMs:legacy.length?legacy.at(-1).t-legacy[0].t:0};
      observations['delayed-authoritative-policy-does-not-flash-legacy-layout']=result;
      timeline.push({path:'/',kind:'deterministic-policy-latency',...result});
      assert.equal(legacy.length,0,`actual browser painted legacy layout before P07 ON policy: ${legacy.length} frames over ${Math.round(result.visibleLegacyDurationMs)}ms`);
      return result;
    });
  }
}finally{
  await page.send('Page.stopScreencast').catch(()=>{});
  for(const [route,data] of frameShots)await fs.writeFile(path.join(screenshotDir,
    `${targetSha.slice(0,7)}-${route.replaceAll('/','_')||'home'}-first.png`),Buffer.from(data,'base64')).catch(()=>{});
  await writeReport();
  await page.close();
}

const failed=checks.filter(x=>x.status==='FAIL');
console.log(JSON.stringify({target_sha:targetSha,flag_mode:flagMode,passed:checks.length-failed.length,failed:failed.length,
  failures:failed.map(x=>({id:x.id,error:x.error,screenshot:x.screenshot})),report:reportPath},null,2));
if(failed.length)process.exitCode=1;

