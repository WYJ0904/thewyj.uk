import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
import {CdpClient,openPage,delay} from '../../local-backend/browser_harness.mjs';
import {onRequest as apiRequest} from '../../functions/api/[[path]].js';
import {onRequest as statusRequest} from '../../functions/api/status.js';
import {policyPage} from '../../functions/_lib/task27-policy.mjs';
import {hashSecret} from '../../functions/_lib/task12-crypto.mjs';
import {isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
import {createAdminMessage} from '../../functions/_lib/task18-service.mjs';
import {userById} from '../../functions/_lib/task12-service.mjs';
import {accountPayload} from '../../functions/_lib/task12-model.mjs';
import {totpAt} from '../../functions/_lib/task27-crypto.mjs';
import {emailCenterIntegrated} from '../../functions/_lib/task27-email-adapter.mjs';
import {pointer} from '../p07-release/owned-browser.mjs';
import {saveFlag} from '../../functions/_lib/task25-service.mjs';

const root=path.resolve(import.meta.dirname,'../..'),run=crypto.randomUUID();
const out=path.join(root,'.wrangler/task27-web-notifications',run);await mkdir(out,{recursive:true});
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('fixture')}}",compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE']});
const db=await mf.getD1Database('WYJ_DB');
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
const password='Synthetic-Task27-Browser-Password!';
const env={...config.env.preview.vars,WYJ_DB:db,WYJ_STORAGE:await mf.getR2Bucket('WYJ_STORAGE'),WYJ_ENVIRONMENT:'development',WORKERS_AI_ENABLED:'false',TTS_MODE:'cache-only',TASK27_SECURITY_ENABLED:'true',EMAIL_SENDING_ENABLED:'false',
  WYJ_TASK12_PASSWORD_PEPPER:'task27-browser-synthetic-pepper-0123456789',WYJ_TASK14_TEMPORARY_SECRET:'task27-browser-synthetic-share-secret-0123456789',WYJ_TASK20_DEVICE_SESSION_SECRET:'task27-browser-synthetic-device-0123456789',
  WYJ_TASK27_CHALLENGE_SECRET:'task27-browser-synthetic-challenge-0123456789',WYJ_TASK27_TOTP_KEY:Buffer.alloc(32,7).toString('base64url'),EMAIL:{async send(){return {messageId:crypto.randomUUID(),queued:[{}]};}}};
// Only this synthetic transport is enabled. A configured Preview recipient
// allowlist must never be edited in order to run the local fixture.
env.EMAIL_TEST_RECIPIENTS='fixture@example.test';env.EMAIL_TRANSPORT='binding';
for(const name of (await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())await db.exec((await readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
const when=new Date().toISOString();
for(const [id,role]of [['fixture-owner','super_admin'],['mail-fixture','user']])await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,?2,'pbkdf2_sha256',310000,?3,?4,?4,?4,?4)`).bind(id,await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER),role,when).run();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES('legacy-browser','legacy-browser','legacy-browser',?1,'pbkdf2_sha256',310000,'user','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`).bind(await hashSecret('123456',env.WYJ_TASK12_PASSWORD_PEPPER)).run();
await db.prepare("INSERT INTO task27_security(user_id,verified_email,email_verified_at,password_age_start_at) VALUES('mail-fixture','fixture@example.test',?1,?1)").bind(when).run();
let registerCalls=0;
let lastEnrollment=null;
const apiErrors=[],receipts=[];let rejectReceipts=false,receiptDelay=0;

const spa=new Set(['/','/login','/register','/account','/admin','/forgot-password','/changelog','/language','/recharge']);
const csp=(await readFile(path.join(root,'_headers'),'utf8')).match(/Content-Security-Policy: (.+)/)[1].trim();
let base;
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,base);
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname.startsWith('/api/') || ['/terms','/privacy','/security-privacy'].includes(url.pathname)) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      const tasks=[],context={request,env,data:{requestId:crypto.randomUUID()},waitUntil(p){tasks.push(p);}};
      if(url.pathname==='/api/register')registerCalls++;
      if(url.pathname==='/api/messages/receipt'){receipts.push(JSON.parse(Buffer.concat(chunks).toString()||'{}'));if(receiptDelay)await delay(receiptDelay);if(rejectReceipts){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,code:'synthetic_unavailable',error:'模拟保存失败'}));return;}}
      const response=url.pathname==='/api/status'?await statusRequest(context):url.pathname==='/terms'?policyPage(context,'terms'):url.pathname==='/privacy'?policyPage(context,'privacy'):url.pathname==='/security-privacy'?policyPage(context,'security'):await apiRequest(context);
      if(url.pathname==='/api/security/mfa/start'&&response.ok){const enrollment=await response.clone().json();if(enrollment.method==='totp')lastEnrollment={secret:enrollment.secret,uri:enrollment.otpauth_uri};}
      if(response.status>=500)apiErrors.push({path:url.pathname,status:response.status,code:(await response.clone().json()).code});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));await Promise.all(tasks);return;
    }
    const file=spa.has(url.pathname)?'index.html':url.pathname.slice(1);
    if(!isAllowedPagesFile(file)||file.startsWith('functions/')){res.writeHead(404);res.end();return;}
    const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Content-Security-Policy':csp,'Cache-Control':'no-store','Service-Worker-Allowed':'/'});res.end(await readFile(path.join(root,file)));
  } catch(error){res.writeHead(500);res.end('isolated fixture error');console.error(error.name+': '+error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(os.tmpdir(),'aeris-task27-chrome-'));
const chrome=process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN || (process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'google-chrome');
const child=spawn(chrome,['--headless=new',...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{windowsHide:true,stdio:'ignore'});
let browser,page;
const proof={baseline:process.argv.includes('--baseline'),scope:'loopback Chrome, actual application UI, Node API dispatcher and isolated Miniflare D1; synthetic mail only',run,checks:[],screenshots:[],real_email:'NOT_TESTED',android_device:'OWNER_OPERATED_NOT_TESTED',hosted:'NOT_TESTED',production:'NOT_TOUCHED'};
async function check(name,fn){await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function screenshot(name){const capture=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(out,name+'.png'),Buffer.from(capture.data,'base64'));proof.screenshots.push(name+'.png');}
async function closeBroadcast(){await page.evaluate("(()=>{const b=document.querySelector('#siteMessageCloseBtn');if(b&&b.getClientRects().length)b.click();return true})()");}
async function prompt(fields={}){await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')",15000,'security prompt');if(Object.keys(fields).length)await page.setFields(Object.fromEntries(Object.entries(fields).map(([name,value])=>[`#task27Prompt [name=${name}]`,value])));await page.click('#task27Prompt button[type=submit]');}
const baseline=process.argv.includes('--baseline');
const owner={id:'fixture-owner',username:'fixture-owner',is_admin:true,is_super_admin:true,role:'super_admin'};
const oldFlag=await db.prepare("SELECT revision FROM task25_feature_flags WHERE flag_key='p07_accessibility'").first();
await saveFlag(db,owner,{flag_key:'p07_accessibility',description:'Isolated UI notification regression',enabled:true,kill_switch:false,channels:['stable','beta','experimental'],rollout_percentage:100,expected_revision:Number(oldFlag?.revision||0)},'synthetic-web-fix');
const probeSource=`(()=>{const data={events:[],frames:[],mutations:[]};window.__webNoticeProbe=data;
 document.addEventListener('animationstart',e=>data.events.push({name:e.animationName,id:e.target.id,tag:e.target.tagName,classes:String(e.target.className).slice(0,180),at:performance.now()}),true);
 const obs=new MutationObserver(records=>{for(const r of records)if(['appShell','publicHome','v3AppFrame','accountBar'].includes(r.target.id)||r.target===document.documentElement||r.target===document.body)data.mutations.push({id:r.target.id||r.target.tagName,name:r.attributeName,value:r.target.getAttribute(r.attributeName),at:performance.now()});});
 obs.observe(document,{attributes:true,subtree:true,attributeFilter:['class','inert','aria-hidden','data-p07-ui','data-interface-policy','data-experience']});
 window.__startWebNoticeProbe=()=>{data.events=[];data.frames=[];data.mutations=[];const until=performance.now()+850;const frame=()=>{data.frames.push({at:performance.now(),scrollY,viewport:document.documentElement.clientWidth,nodes:['appShell','v3AppFrame','publicHome','accountBar'].map(id=>{const n=document.getElementById(id),s=n&&getComputedStyle(n);return {id,x:n?.getBoundingClientRect().x,opacity:s?.opacity,display:s?.display,visibility:s?.visibility,transform:s?.transform,width:n?.getBoundingClientRect().width};})});if(performance.now()<until)requestAnimationFrame(frame);};requestAnimationFrame(frame);};})()`;
async function stableHome(){await page.waitFor("document.documentElement.dataset.bootState==='ready' && document.getElementById('publicHome').checkVisibility() && !document.getElementById('entryScreen')",30000);await delay(850);}
async function measure(label,selector){if(!await page.evaluate("typeof __startWebNoticeProbe==='function'"))await page.evaluate(probeSource);await page.evaluate('__startWebNoticeProbe()');await pointer(page,selector);await delay(900);const data=await page.evaluate('JSON.parse(JSON.stringify(__webNoticeProbe))');proof.actions||=[];proof.actions.push({label,selector,...data});await screenshot(label);return data;}
function motionSummary(){return proof.actions.map(a=>({label:a.label,animations:a.events.map(e=>({id:e.id,name:e.name,classes:e.classes})),root_min_opacity:Math.min(...a.frames.flatMap(f=>f.nodes.filter(n=>['appShell','v3AppFrame','accountBar'].includes(n.id)&&n.display!=='none').map(n=>Number(n.opacity)))),background_width_ranges:Object.fromEntries(['appShell','v3AppFrame','accountBar'].map(id=>{const widths=a.frames.flatMap(f=>f.nodes.filter(n=>n.id===id&&n.display!=='none').map(n=>n.width));return[id,Math.max(...widths)-Math.min(...widths)];})),root_mutations:a.mutations.length}));}
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await delay(100);}}
 assert.ok(port);const cdpUrl=`http://127.0.0.1:${port}`;proof.browser=(await(await fetch(cdpUrl+'/json/version')).json()).Browser;
 page=await openPage({cdpUrl,baseUrl:base,width:1366,height:900,mobile:false});await page.send('Page.addScriptToEvaluateOnNewDocument',{source:probeSource});
 await page.navigate('/login');await page.setFields({'#usernameInput':'legacy-browser','#secretInput':'123456'});await pointer(page,'#loginSubmitBtn');await stableHome();
 await page.waitFor("document.getElementById('siteMessageModal').checkVisibility()",15000);
 assert.match(await page.evaluate("document.getElementById('siteMessageTitle').textContent"),/完善账户安全/);
 await screenshot('broadcast-before-close');
 await pointer(page,'#siteMessageCloseBtn');
 if(baseline){await page.waitFor("document.getElementById('siteMessageError').textContent.includes('消息标识无效')",10000);proof.broadcast_failure={text:await page.evaluate("document.getElementById('siteMessageError').textContent"),blocked:await page.evaluate("document.getElementById('appShell').inert"),receipts:[...receipts]};await screenshot('broadcast-invalid-id');}
 else{await page.waitFor("document.getElementById('siteMessageModal').classList.contains('hidden') && document.getElementById('siteMessageSaveStatus').classList.contains('hidden')",10000);assert.ok((await db.prepare("SELECT dismissed_at FROM admin_message_receipts WHERE user_id='legacy-browser' AND message_id='task27-mfa-advice-v1'").first())?.dismissed_at);}
 await page.send('Page.reload',{ignoreCache:true});await stableHome();
 assert.equal(await page.evaluate("document.getElementById('siteMessageModal').classList.contains('hidden')"),true);
 proof.after_refresh={mfa:await db.prepare("SELECT mfa_broadcast_at FROM task27_security WHERE user_id='legacy-browser'").first(),receipt:await db.prepare("SELECT first_seen_at,dismissed_at,acknowledged_at FROM admin_message_receipts WHERE user_id='legacy-browser' AND message_id='task27-mfa-advice-v1'").first()};
 await measure('home-account-menu','#accountMenu > summary');
 await measure('account-settings','#accountBtn');await page.waitFor("document.getElementById('accountModal').checkVisibility()",10000);
 await measure('security-open','#openSecurityCenterBtn');await page.waitFor("document.querySelector('#task27Security [data-task27-body]')?.textContent.includes('双重验证')",15000);
 await measure('security-close','#task27Security [data-task27-close]');
 await measure('inbox-open','#notificationBellBtn');await page.waitFor("document.querySelector('#task27Inbox [data-read-all]')",15000);
 await measure('inbox-close','#task27Inbox [data-task27-close]');
 await measure('ordinary-password-button','#toggleCurrentSecretBtn');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(350);
 await measure('narrow-account-menu','#accountMenu > summary');
 await measure('narrow-inbox-open','#notificationInboxMenuBtn');await measure('narrow-inbox-close','#task27Inbox [data-task27-close]');
 assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);
 proof.summary=motionSummary();
 if(!baseline){assert.ok(proof.summary.every(a=>a.root_min_opacity===1),JSON.stringify(proof.summary));assert.ok(proof.summary.every(a=>Object.values(a.background_width_ranges).every(delta=>delta<0.5)),JSON.stringify(proof.summary));}

 if(!baseline){
  // A failed ordinary close releases the page immediately and retains a visible,
  // explicit manual retry. It does not acknowledge anything or claim persistence.
  await page.send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  const created=await createAdminMessage(db,owner,{title:'Synthetic failed-close notice',body:'Local fixture only',target_scope:'single',target_user_ids:['legacy-browser'],requires_confirmation:false,delivery_channel:'broadcast',purpose:'general',idempotency_key:'web-close-failure-'+crypto.randomUUID()},'synthetic-close');
  const failedId=created.message.id;
  await page.send('Page.reload',{ignoreCache:true});await page.waitFor("document.getElementById('siteMessageTitle').textContent==='Synthetic failed-close notice' && document.getElementById('siteMessageModal').checkVisibility()",15000);
  rejectReceipts=true;receiptDelay=500;await pointer(page,'#siteMessageCloseBtn');
  await page.waitFor("document.getElementById('siteMessageModal').classList.contains('hidden') && !document.getElementById('appShell').inert",350);
  await page.waitFor("document.getElementById('siteMessageSaveText').textContent.includes('未保存')",5000);await screenshot('close-failure-unblocked');
  assert.equal(receipts.filter(r=>r.message_id===failedId).length,1);
  await page.send('Page.reload',{ignoreCache:true});await page.waitFor("document.getElementById('siteMessageTitle').textContent==='Synthetic failed-close notice' && document.getElementById('siteMessageModal').checkVisibility()",15000);
  await pointer(page,'#siteMessageCloseBtn');await page.waitFor("document.getElementById('siteMessageSaveText').textContent.includes('未保存')",5000);
  const beforeRetry=receipts.filter(r=>r.message_id===failedId).length;assert.equal(beforeRetry,2);
  rejectReceipts=false;receiptDelay=0;await pointer(page,'#siteMessageRetryBtn');await page.waitFor("document.getElementById('siteMessageSaveStatus').classList.contains('hidden')",5000);
  assert.equal(receipts.filter(r=>r.message_id===failedId).length,beforeRetry+1);
  const saved=await db.prepare("SELECT dismissed_at,acknowledged_at FROM admin_message_receipts WHERE message_id=?1 AND user_id='legacy-browser'").bind(failedId).first();assert.ok(saved.dismissed_at);assert.equal(saved.acknowledged_at,'');
  await page.close();page=await openPage({cdpUrl,baseUrl:base,width:1366,height:900,mobile:false});
  await page.navigate('/login');await page.setFields({'#usernameInput':'legacy-browser','#secretInput':'123456'});await pointer(page,'#loginSubmitBtn');await stableHome();
  assert.equal(await page.evaluate("document.getElementById('siteMessageModal').classList.contains('hidden')"),true);proof.failure_retry_and_relogin='PASS';proof.checks.push({name:'failed close releases page; refresh repeats unsaved broadcast; explicit retry persists; fresh login stays closed',status:'PASS'});

  const required=await createAdminMessage(db,owner,{title:'Synthetic required confirmation',body:'Explicit acknowledgement remains required',target_scope:'single',target_user_ids:['legacy-browser'],requires_confirmation:true,delivery_channel:'broadcast',purpose:'general',idempotency_key:'web-required-'+crypto.randomUUID()},'synthetic-required');
  await page.send('Page.reload',{ignoreCache:true});await page.waitFor("document.getElementById('siteMessageTitle').textContent==='Synthetic required confirmation' && document.getElementById('siteMessageModal').checkVisibility()",15000);
  assert.equal(await page.evaluate("document.getElementById('siteMessageCloseBtn').textContent"),'稍后确认');
  rejectReceipts=true;await pointer(page,'#siteMessageCloseBtn');await page.waitFor("document.getElementById('siteMessageSaveText').textContent.includes('未保存') && !document.getElementById('appShell').inert",5000);
  rejectReceipts=false;await pointer(page,'#siteMessageRetryBtn');await page.waitFor("document.getElementById('siteMessageSaveStatus').classList.contains('hidden')",5000);
  assert.equal((await db.prepare("SELECT acknowledged_at FROM admin_message_receipts WHERE message_id=?1 AND user_id='legacy-browser'").bind(required.message.id).first()).acknowledged_at,'');
  await page.send('Page.reload',{ignoreCache:true});await page.waitFor("document.getElementById('siteMessageTitle').textContent==='Synthetic required confirmation' && document.getElementById('siteMessageModal').checkVisibility()",15000);
  await pointer(page,'#siteMessageAcknowledgeBtn');await page.waitFor("document.getElementById('siteMessageModal').classList.contains('hidden')",5000);
  assert.ok((await db.prepare("SELECT acknowledged_at FROM admin_message_receipts WHERE message_id=?1 AND user_id='legacy-browser'").bind(required.message.id).first()).acknowledged_at);
  proof.checks.push({name:'required broadcast close failure remains retryable and repeats until explicit acknowledgement',status:'PASS'});
  await pointer(page,'#themeToggleBtn');await pointer(page,'#themeToggleBtn');await delay(300);assert.equal(await page.evaluate("document.documentElement.dataset.theme"),'dark');await measure('dark-inbox-open','#notificationBellBtn');await measure('dark-inbox-close','#task27Inbox [data-task27-close]');
  const dark=proof.actions.slice(-2);for(const a of dark){for(const id of ['appShell','v3AppFrame','accountBar']){const widths=a.frames.flatMap(f=>f.nodes.filter(n=>n.id===id).map(n=>n.width));assert.ok(Math.max(...widths)-Math.min(...widths)<0.5);}}proof.checks.push({name:'dark theme dialogs retain stable background geometry',status:'PASS'});
 }
 proof.summary=motionSummary();if(!baseline)assert.ok(proof.summary.every(a=>a.root_min_opacity===1&&Object.values(a.background_width_ranges).every(delta=>delta<0.5)));
 proof.status=baseline?'REPRODUCED':'PASS';
}catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;if(page)await screenshot('failure').catch(()=>{});console.error(error.stack);}
finally{proof.requests=receipts;proof.service_worker=await page?.evaluate("({controller:navigator.serviceWorker.controller?.scriptURL||null,registrations:performance.getEntriesByType('navigation').length})").catch(()=>null);await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({status:proof.status,evidence:path.relative(root,out),summary:proof.summary,error:proof.error}));await page?.close().catch(()=>{});child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await mf.dispose();if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(profile).startsWith('aeris-task27-chrome-'))await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:300}).catch(()=>{});}
