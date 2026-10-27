import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..'),E=path.join(root,'docs/migration-evidence/p07-ui-release');const label=process.argv[2]||'before';assert(/^(before(?:-r[2-4])?|after|final)$/.test(label));const out=path.join(E,'browser-'+label);await fs.mkdir(out,{recursive:false});
const origin=label==='before'?'https://c86217f4.thewyj-p07-ui-rc.pages.dev':'https://p07-ui-rc.thewyj-p07-ui-rc.pages.dev';
assert.equal(JSON.parse(await fs.readFile(path.join(E,'verify-binding-r1/result.json'),'utf8')).verified_database_ids[0],'ee869f78-b54a-4018-bc99-871089ecb8cd');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'p07-browser-'));const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let page;const rows=[],checks=[];const started=new Date().toISOString();
try{
 let port;for(let i=0;i<100;i++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}assert(port);
 page=await openPage({cdpUrl:'http://127.0.0.1:'+port,baseUrl:origin,width:1440,height:960,mobile:false});
 await page.send('Network.setCacheDisabled',{cacheDisabled:false});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`delete globalThis.__WYJ_TEST_MODE__;window.__p07perf={cls:0,lcp:null,interactions:[]};new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__p07perf.cls+=e.value}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())window.__p07perf.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.interactionId)window.__p07perf.interactions.push({id:e.interactionId,duration:e.duration})}).observe({type:'event',buffered:true,durationThreshold:16})}catch{}`});
 const capture=async(name,route,width=1440)=>{
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width<600});
  await page.navigate(route);await delay(500);
  const surface={'/':'#publicHome','/login':'#authPanel','/register':'#authPanel','/tools':'#toolsPanel,#authPanel','/language':'#projectPicker,#authPanel','/download':'#downloadPage','/finance':'#financePage','/account':'#accountModal','/recharge':'#membershipModal'}[route];
  if(surface)await page.waitFor(`[...document.querySelectorAll(${JSON.stringify(surface)})].some(e=>e.getClientRects().length>0) && document.querySelector('#sessionRecovery')?.classList.contains('hidden')`,30000,'visible initialized route '+route);
  const data=await page.evaluate(`(()=>{const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return {path:location.pathname,title:document.title,testMode:globalThis.__WYJ_TEST_MODE__===true,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,unlabelled:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible).filter(e=>!(e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby'))).map(e=>e.id),visibleDialogs:[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(visible).map(e=>e.id||e.getAttribute('aria-labelledby')),smallButtons:[...document.querySelectorAll('button')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.width<24||r.height<24}).map(e=>e.id),perf:window.__p07perf,skipLink:!!document.querySelector('.skip-link'),runningAnimations:document.getAnimations().filter(a=>a.playState==='running').length}})()`);
  const image=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));
  rows.push({id:name,route,source:'HOSTED_REAL_CHROME',...data});await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(rows,null,2));return data;
 };
 await capture('home-desktop','/');await capture('home-mobile','/',375);await capture('login-mobile','/login',375);await capture('register-mobile','/register',375);await capture('tools-desktop','/tools');await capture('learning-mobile','/language',375);await capture('download-mobile','/download',375);
 await page.navigate('/login');const accounts=JSON.parse(await fs.readFile(path.join(E,'private/preview-accounts.json'),'utf8'));const account=accounts.find(r=>r.scope==='validation');
 await page.setFields({'#usernameInput':account.username,'#secretInput':account.secret});await page.click('#loginSubmitBtn');await page.waitFor("!document.querySelector('#accountMenu').classList.contains('hidden')",30000,'isolated validation login');checks.push({id:'normal-preview-login',status:'PASS'});
 await capture('finance-desktop','/finance');await capture('finance-mobile','/finance',375);await capture('finance-small','/finance',320);await capture('account-mobile','/account',375);
 await page.waitFor("!document.querySelector('#accountModal').classList.contains('hidden')",15000,'account modal');
 const labels=await page.evaluate(`['currentSecretInput','newSecretInput','newSecretConfirmInput'].map(id=>({id,labels:document.getElementById(id)?.labels?.length||0}))`);checks.push({id:'permanent-account-secret-labels',status:labels.every(r=>r.labels>0)?'PASS':'FAIL',actual:labels});
 await page.evaluate(`document.querySelector('[data-close-modal="accountModal"]').click()`);
 await capture('membership-mobile','/recharge',375);
 await page.waitFor("!document.querySelector('#membershipModal').classList.contains('hidden')",15000,'membership modal');
 const priceText=await page.evaluate("document.getElementById('membershipModal').innerText");await fs.writeFile(path.join(out,'membership-copy.txt'),priceText);
 await page.evaluate(`document.querySelector('[data-close-modal="membershipModal"]').click()`);
 await page.navigate('/');await page.waitFor("!document.querySelector('#accountMenu').classList.contains('hidden')&&document.querySelector('#sessionRecovery').classList.contains('hidden')",30000,'authenticated navigation');await page.evaluate("document.querySelector('#accountMenu').open=true");await delay(200);const menuItems=await page.evaluate(`(()=>{const items=[...document.querySelectorAll('#accountMenu [role=menuitem]')].filter(e=>e.getClientRects().length&&!e.disabled);items[0]?.focus();return items.map(e=>e.id)})()`);assert(menuItems.length>=2);await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'});const focused=await page.evaluate('document.activeElement.id');checks.push({id:'account-menu-arrow-navigation',status:focused===menuItems[1]?'PASS':'FAIL',actual:focused,expected:menuItems[1]});
 checks.push({id:'skip-navigation-present',status:rows.every(r=>r.skipLink)?'PASS':'FAIL'});
 checks.push({id:'no-horizontal-document-overflow',status:rows.every(r=>r.scrollWidth<=r.width+1)?'PASS':'FAIL',actual:rows.filter(r=>r.scrollWidth>r.width+1).map(r=>r.id)});
 checks.push({id:'normal-runtime-not-test-mode',status:rows.every(r=>!r.testMode)?'PASS':'FAIL'});
 checks.push({id:'no-runtime-exceptions',status:page.runtimeErrors.length===0?'PASS':'FAIL',actual:page.runtimeErrors});
}catch(e){checks.push({id:'audit-environment',status:'FAIL',error:e.stack});}
finally{
 if(page){try{await Promise.race([page.close(),delay(3000)])}catch{}page.client.close();}chrome.kill();await delay(1000);
 let cleaned=false;try{const real=await fs.realpath(profile);assert.equal(real.toLowerCase(),profile.toLowerCase());assert(path.basename(profile).startsWith('p07-browser-')&&path.dirname(profile).toLowerCase()===os.tmpdir().toLowerCase());await fs.rm(profile,{recursive:true,force:false});cleaned=true;}catch{}
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({label,origin,started,finished:new Date().toISOString(),rows,checks,profile_cleaned:cleaned,production_requests:0,synthetic_account_only:true,performance_note:'Cold hosted lab navigations, not field CWV. EventTiming entries are observations, no invented INP.'},null,2));console.log(JSON.stringify({label,rows:rows.length,checks}));
}
