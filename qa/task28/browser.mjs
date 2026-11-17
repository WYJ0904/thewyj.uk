import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { CdpClient, openPage, delay } from '../../local-backend/browser_harness.mjs';
import { onRequest } from '../../functions/api/[[path]].js';
import { onRequest as status } from '../../functions/api/status.js';
import { isAllowedPagesFile } from '../../scripts/stage_pages_deploy.mjs';
import { hashSecret } from '../../functions/_lib/task12-crypto.mjs';

const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'.wrangler/task28/evidence',`browser-${crypto.randomUUID()}`);
const ownerIsolationOnly=process.argv.includes('--owner-isolation-only');
await mkdir(out,{recursive:true});
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('isolated fixture')}}",compatibilityDate:config.compatibility_date,
  d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE']});
const db=await mf.getD1Database('WYJ_DB');
const env={...config.env.preview.vars,WYJ_DB:db,WYJ_STORAGE:await mf.getR2Bucket('WYJ_STORAGE'),WYJ_ENVIRONMENT:'development',
  WORKERS_AI_ENABLED:'false',EMAIL_SENDING_ENABLED:'false',D1_RATE_LIMIT_ENABLED:'false',TTS_MODE:'cache-only',TASK18_ADMIN_MESSAGES_ENABLED:'true',
  WYJ_TASK12_PASSWORD_PEPPER:'task28-browser-only-synthetic-pepper-0123456789',WYJ_TASK14_TEMPORARY_SECRET:'task28-browser-only-synthetic-share-0123456789',
  WYJ_TASK20_DEVICE_SESSION_SECRET:'task28-browser-only-synthetic-device-0123456789'};
for(const name of(await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())
  await db.exec((await readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
const password='Synthetic-Task28-Browser-Password!',now=new Date().toISOString();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
  VALUES('task28-browser','task28-browser','task28-browser',?1,'pbkdf2_sha256',310000,'user',?2,?2,?2)`)
  .bind(await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER),now).run();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
  VALUES('task28-browser-other','task28-browser-other','task28-browser-other',?1,'pbkdf2_sha256',310000,'user',?2,?2,?2)`)
  .bind(await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER),now).run();
// Task18 readiness requires exactly one owner even when the browser exercises
// an ordinary account. This is an isolated fixture, never a remote account.
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
  VALUES('task28-fixture-owner','task28-fixture-owner','task28-fixture-owner','','reset_required',0,'super_admin',?1,?1,?1)`).bind(now).run();
const fixture=path.join(out,'synthetic-attachment.txt');await writeFile(fixture,'Synthetic attachment integrity 中文\n'.repeat(64));
const csp=(await readFile(path.join(root,'_headers'),'utf8')).match(/Content-Security-Policy: (.+)/)[1].trim();
let base;const apiErrors=[];let holdAuthorization=false,releaseAuthorization=null;
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,base);
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const tasks=[],context={request:new Request(url,{method:req.method,headers:req.headers,
        ...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,data:{requestId:crypto.randomUUID()},waitUntil(p){tasks.push(p);}};
      const response=await (url.pathname==='/api/status'?status:onRequest)(context);
      if(response.status>=500)apiErrors.push({path:url.pathname,status:response.status,code:(await response.clone().json()).code});
      if(holdAuthorization && /\/api\/transfer\/shares\/.+\/authorize$/.test(url.pathname) && response.ok) {
        holdAuthorization=false;await new Promise(resolve=>{releaseAuthorization=resolve;});
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));await Promise.all(tasks);return;
    }
    const file=['/','/login','/transfer','/select','/account'].includes(url.pathname)?'index.html':url.pathname.slice(1);
    if(!isAllowedPagesFile(file)||file.startsWith('functions/')){res.writeHead(404);res.end();return;}
    const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':file.endsWith('.webmanifest')?'application/manifest+json':'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Content-Security-Policy':csp,'Cache-Control':'no-store','Service-Worker-Allowed':'/'});res.end(await readFile(path.join(root,file)));
  }catch(error){res.writeHead(500);res.end('isolated fixture error');console.error(error.name+': '+error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(os.tmpdir(),'aeris-task28-chrome-'));
const chrome=process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN || (process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'google-chrome');
const child=spawn(chrome,['--headless=new',...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{windowsHide:true,stdio:'ignore'});
let browser,page,guest;
const proof={scope:'isolated desktop Chrome + mobile viewport, real local D1/R2, synthetic account/files',mode:ownerIsolationOnly?'owner-isolation-handoff':'full',checks:[],screenshots:[],hosted:'NOT_TESTED',android_webview:'NOT_TESTED',production:'NOT_TOUCHED'};
async function check(name,fn){
  if(ownerIsolationOnly && (name.startsWith('375px') || name.startsWith('revoke removes'))) {
    proof.checks.push({name,status:'SKIPPED',reason:'already passed; outside targeted owner-isolation handoff check'});console.log('SKIPPED '+name);return;
  }
  await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);
}
async function screenshot(name){const capture=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(out,name+'.png'),Buffer.from(capture.data,'base64'));proof.screenshots.push(name+'.png');}
try {
  let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await delay(100);}}
  assert.ok(port,'isolated Chrome starts');const cdpUrl=`http://127.0.0.1:${port}`,version=await fetch(cdpUrl+'/json/version').then(r=>r.json());
  browser=new CdpClient(version.webSocketDebuggerUrl);await browser.connect();proof.browser=version.Browser;
  await browser.send('Browser.setDownloadBehavior',{behavior:'deny'});
  page=await openPage({cdpUrl,baseUrl:base,width:1440,height:1100,mobile:false});
  await check('account login exposes the private attachment option in the existing transfer page',async()=>{
    await page.navigate('/login');await page.waitFor("document.getElementById('usernameInput')?.checkVisibility()",15000);
    await page.setFields({'#usernameInput':'task28-browser','#secretInput':password});await page.click('#loginSubmitBtn');
    await page.waitFor("location.pathname==='/'&&document.getElementById('notificationBellBtn').checkVisibility()",45000);
    await page.navigate('/transfer');await page.waitFor("document.getElementById('transferPrivate')?.disabled===false",20000);
    assert.equal(await page.evaluate("document.getElementById('transferPrivate').checked"),false);
    assert.match(await page.evaluate("document.getElementById('transferSafetyHint').textContent"),/HTML、SVG/);
  });
  await check('private upload, validated completion, owner-only management and file-scoped download use the real UI',async()=>{
    if(!(await page.evaluate("document.getElementById('transferPrivate').checked")))await page.click('#transferPrivate');
    await page.setFile('#transferFileInput',[fixture]);
    await page.waitFor("document.getElementById('transferCompleteBtn').disabled===false",60000,'synthetic upload completed');
    await page.click('#transferCompleteBtn');await page.waitFor("document.getElementById('transferShareTitle').textContent==='私有附件已保存'",30000);
    assert.equal(await page.evaluate("document.getElementById('transferShareLink').value"),'');
    assert.equal(await page.evaluate("document.getElementById('transferShareLink').parentElement.checkVisibility()"),false);
    assert.match(await page.evaluate("document.getElementById('transferShareFiles').textContent"),/完整文件 SHA-256 已校验/);
    const share=await db.prepare("SELECT * FROM task22_shares WHERE owner_ref='task28-browser' AND state='active'").first();assert.equal(share.access_scope,'private');
    await page.click('[data-transfer-download]');await page.waitFor("document.getElementById('transferMessage').textContent.includes('下载已开始')",20000);
    const grant=await db.prepare('SELECT file_id FROM task22_download_grants WHERE share_id=?1').bind(share.id).first();assert.ok(grant.file_id);
    const denied=await fetch(base+`/api/transfer/shares/${share.id}/authorize`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,404);
    await screenshot('private-desktop');
  });
  await check('375px mobile layout keeps controls visible and the transfer region has no serious accessibility violations',async()=>{
    await page.send('Emulation.setDeviceMetricsOverride',{width:375,height:1000,deviceScaleFactor:1,mobile:true});
    await page.evaluate("document.getElementById('transferPage').scrollIntoView({block:'start',behavior:'instant'})");
    assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);
    await page.evaluate(await readFile(path.join(root,'qa/p07-f/vendor/axe.min.js'),'utf8'));
    const violations=await page.evaluate("axe.run(document.getElementById('transferPage')).then(r=>r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))");
    assert.deepEqual(violations,[]);await screenshot('private-mobile');
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  });
  await check('account switches clear private views and grants and discard a late authorization from the previous owner',async()=>{
    async function logout(){await page.click('#accountMenu summary');await page.click('#logoutBtn');await page.waitFor("location.pathname==='/login'&&document.getElementById('usernameInput').checkVisibility()",20000);}
    async function login(name){await page.setFields({'#usernameInput':name,'#secretInput':password});await page.click('#loginSubmitBtn');await page.waitFor(`location.pathname==='/'&&document.getElementById('accountBadge').textContent.includes('${name}')`,30000);await page.click('a[data-site-nav=transfer]');await page.waitFor("document.getElementById('transferPage').checkVisibility()&&!document.getElementById('transferQuotaText').textContent.includes('加载中')",20000);}
    await logout();
    assert.equal(await page.evaluate("document.getElementById('transferShareFiles').textContent"),'','logout clears private file metadata from the DOM');
    await login('task28-browser-other');
    assert.equal(await page.evaluate("document.getElementById('transferShareCard').classList.contains('hidden')"),true);
    assert.equal(await page.evaluate("document.getElementById('transferMyShares').textContent.includes('synthetic-attachment.txt')"),false);
    await logout();await login('task28-browser');await page.waitFor("document.querySelector('[data-transfer-open]')",20000);await page.click('[data-transfer-open]');
    await page.waitFor("document.getElementById('transferShareFiles').textContent.includes('synthetic-attachment.txt')",20000);
    await page.evaluate("window.__task28DownloadClicks=0;window.__task28HeldDownloadButton=document.querySelector('[data-transfer-download]');const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__task28DownloadClicks++;return original.call(this);};");
    holdAuthorization=true;await page.click('[data-transfer-download]');
    for(let i=0;i<100&&!releaseAuthorization;i++)await delay(50);
    assert.ok(releaseAuthorization,'a fresh owner-bound authorization reached the isolated server');
    await logout();await login('task28-browser-other');const release=releaseAuthorization;releaseAuthorization=null;release();
    await page.waitFor('window.__task28HeldDownloadButton?.disabled===false',10000,'old owner authorization settles while the other account remains active');
    assert.equal(await page.evaluate('window.__task28DownloadClicks'),0,'old owner authorization cannot start a download after switching accounts');
    assert.equal(await page.evaluate("document.getElementById('transferShareFiles').textContent"),'');
    await logout();await login('task28-browser');await page.waitFor("document.querySelector('[data-transfer-open]')",20000);await page.click('[data-transfer-open]');
    await page.waitFor("document.getElementById('transferShareFiles').textContent.includes('synthetic-attachment.txt')",20000);
  });
  await check('revoke removes private access and ordinary shared links still open in an independent guest browser context',async()=>{
    await page.click('#transferCurrentRevokeBtn');await page.waitFor("document.getElementById('transferShareCard').classList.contains('hidden')",20000);
    if(await page.evaluate("document.getElementById('transferPrivate').checked"))await page.click('#transferPrivate');
    await page.setFile('#transferFileInput',[fixture]);
    await page.waitFor("document.getElementById('transferCompleteBtn').disabled===false",60000);await page.click('#transferCompleteBtn');
    await page.waitFor("document.getElementById('transferShareLink').value.includes('#share=')",30000);
    const link=await page.evaluate("document.getElementById('transferShareLink').value");
    const recipient=new URL(link);
    guest=await openPage({cdpUrl,baseUrl:base,width:390,height:1000,mobile:true});await guest.navigate(recipient.pathname+recipient.hash);
    await guest.waitFor("document.getElementById('transferShareFiles').textContent.includes('synthetic-attachment.txt')",20000);
    assert.equal(await guest.evaluate("document.getElementById('transferPrivate').disabled"),true);
    assert.deepEqual(page.runtimeErrors,[]);assert.deepEqual(guest.runtimeErrors,[]);assert.deepEqual(apiErrors,[]);
  });
  proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{
  releaseAuthorization?.();
  await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');
  if(guest)await guest.close();if(page)await page.close();if(browser){await Promise.race([browser.send('Browser.close').catch(()=>undefined),delay(1000)]);browser.close();}
  child.kill();await new Promise(resolve=>server.close(resolve));await mf.dispose();
  // This directory was created by mkdtemp for this synthetic browser alone.
  const resolved=path.resolve(profile),temporary=path.resolve(os.tmpdir())+path.sep;
  if(resolved.startsWith(temporary))await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,passed:proof.checks.filter(c=>c.status==='PASS').length,skipped:proof.checks.filter(c=>c.status==='SKIPPED').length,mode:proof.mode,evidence:path.relative(root,out)}));
}
