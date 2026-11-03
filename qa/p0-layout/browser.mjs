/** Full-product-CSS finance layout regression. Local synthetic D1/HTTP only. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(Array.from({length:(process.argv.length-2)/2}, (_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
const root = path.resolve(args['--product-root'] || '');
const label = args['--label'];
assert.ok(root !== own && /^[a-z][a-z0-9-]+$/.test(label));
const out = path.join(own,'docs/migration-evidence/p0-finance-layout',label);
await mkdir(out,{recursive:false});
const sha = value => createHash('sha256').update(value).digest('hex');
const driverBefore = sha(await readFile(fileURLToPath(import.meta.url)));
await writeFile(path.join(out,'executed-driver.mjs'),await readFile(fileURLToPath(import.meta.url)));
const sourceFiles = ['index.html','styles.css','product-ui.css','design-system.css','public-experience.css','workspace-experience.css','qa/finance-p04/fixture.mjs','local-backend/browser_harness.mjs'];
for (const folder of ['js/finance','js/core','functions/_lib','cloudflare/migrations']) for (const name of await readdir(path.join(root,folder)))
  if (/\.(?:js|mjs|sql)$/.test(name)) sourceFiles.push(folder+'/'+name);
const sourceLock = async()=>({head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,sha(await readFile(path.join(root,name)))])))});
const before = await sourceLock();
await mkdir(path.join(out,'product-inputs'));
for(const name of sourceFiles.filter(name=>name.endsWith('.css')))await writeFile(path.join(out,'product-inputs',name),await readFile(path.join(root,name)));
const imported = name => import(pathToFileURL(path.join(root,name)).href);
const {fixture} = await imported('qa/finance-p04/fixture.mjs');
const {referenceRate} = await imported('functions/_lib/finance-fx.mjs');
const {handleTask16Request} = await imported('functions/_lib/task16-api.mjs');
const {sessionStorageKey} = await imported('functions/_lib/task12-crypto.mjs');
const {openPage,CdpClient,delay} = await imported('local-backend/browser_harness.mjs');
const f = await fixture();
const rows = [], requests = [], geometries = [];
const token='synthetic-p0-layout-session', now=new Date().toISOString();
const env={WYJ_DB:f.db,WYJ_ENVIRONMENT:'development',CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_WRITES_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false'};
await f.db.prepare("INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'browser')").bind(await sessionStorageKey(token),f.account.id,now,new Date(Date.now()+86400000).toISOString()).run();
await f.db.prepare("INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at) VALUES('synthetic-p0-layout-membership',?1,'finance_monthly',?2,?3,0,'active','fixture','synthetic-layout','fixture','{}',?2,?2)").bind(f.account.id,now,new Date(Date.now()+86400000).toISOString()).run();
const currencies=['CNY','USD','EUR','HKD','GBP','JPY'];
const rate={CNY:'1',USD:'7',EUR:'8',HKD:'0.9',GBP:'9.5',JPY:'0.05'};
const source=[];
for(const currency of currencies){
  source.push(await f.transaction(currency,1,{id:'synthetic-layout-'+currency,payload:{merchant:'synthetic layout '+currency,note:'Synthetic layout regression; no payment evidence.'}}));
  if(currency!=='CNY') await referenceRate(f.db,currency,'CNY','2026-10-19',{fetcher:async()=>new Response(JSON.stringify({base:currency,quote:'CNY',date:'2026-10-19',rate:rate[currency]}),{headers:{'Content-Type':'application/json'}})});
}
const factual = row=>Object.fromEntries(['id','currency','amount_minor','amount_exponent','direction','merchant','note','occurred_at_ms','source_kind'].map(k=>[k,row[k]??null]));
// Compare persistence to persistence, not a public response projection that
// intentionally omits redundant non-JPY exponent fields.
const originalFacts=await Promise.all(source.map(async row=>factual(await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(row.id).first())));
const realFetch=globalThis.fetch;
let blockedProviderCalls=0;
globalThis.fetch=(url,...rest)=>{if(String(url).startsWith('https://api.frankfurter.dev/')){blockedProviderCalls++;return Promise.reject(Error('No external provider in isolated layout regression'));}return realFetch(url,...rest);};
const index=await readFile(path.join(root,'index.html'),'utf8');
const financeStart=index.indexOf('<section class="finance-page');
const finance=index.slice(financeStart,financeStart+index.slice(financeStart).indexOf('\n      <section class="'));
const modals=index.slice(index.indexOf('<div class="modal-layer hidden" id="financeTransactionModal"'),index.indexOf('<section class="project-picker'));
const stylesheetTags=[...index.matchAll(/<link rel="stylesheet"[^>]+>/g)].map(x=>x[0]);
assert.equal(stylesheetTags.length,5);
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${stylesheetTags.join('\n')}</head><body><main class="app-shell app-shell-ready" id="appShell" aria-hidden="false">${finance}${modals}</main>
<script type="module">
import{createFinanceController}from'/js/finance/app.js';
async function call(route,body,options={}){const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'X-Session-Token':${JSON.stringify(token)},'X-Finance-Money-Version':'3',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:options.controller?.signal});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||value.error),{code:value.code});return value;}
// The normal app router owns route visibility. Preserve its visible-route
// state while mounting the exact finance template/controller in isolation.
document.getElementById('financePage').classList.remove('hidden');document.getElementById('financePage').setAttribute('aria-hidden','false');
window.controller=createFinanceController({account:()=>({id:${JSON.stringify(f.account.id)}}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,appVersion:'synthetic-p0-layout',apiGet:(p,o)=>call(p,undefined,o),api:call});
window.store=()=>JSON.parse(localStorage.getItem('wyjFinance:v1:'+${JSON.stringify(f.account.id)}));
await controller.show();document.getElementById('financeRecordedSection').open=true;window.ready=true;
</script></body></html>`;
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
  if(sourceFiles.includes(url.pathname.slice(1)) && /\.(css|js)$/.test(url.pathname)){
    res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');
    const raw=await readFile(path.join(root,url.pathname.slice(1)));requests.push({path:url.pathname,sha256:sha(raw)});res.end(raw);return;
  }
  if(url.pathname.startsWith('/api/finance/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    const response=await handleTask16Request({env,data:{requestId:'synthetic-p0-layout'},request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})})});
    requests.push({path:url.pathname,status:response.status});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  res.writeHead(404);res.end();
}catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseUrl='http://127.0.0.1:'+server.address().port;
const profile=path.join(out,'owned-chrome-profile');await mkdir(profile);
const chrome=process.env.AERIS_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child=spawn(chrome,['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore'});
let browser,page,browserVersion;
async function check(id,run){const started=performance.now();try{const actual=await run();rows.push({id,status:'PASS',actual,elapsed_ms:Math.round(performance.now()-started)});console.log('PASS',id);}catch(error){rows.push({id,status:'FAIL',error:error.stack,elapsed_ms:Math.round(performance.now()-started)});console.error('FAIL',id,error.message);}}
async function clickVisible(selector){
  const point=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest'});return new Promise(r=>requestAnimationFrame(()=>{const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;const target=document.elementFromPoint(x,y);r({x,y,w:b.width,h:b.height,hit:e===target||e.contains(target),disabled:e.disabled})}))})()`);
  assert.ok(point.hit && !point.disabled && point.w>0 && point.h>0,JSON.stringify(point));
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
}
try{
  let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await delay(100);}}assert.ok(port,'owned Chrome startup');
  const cdpUrl='http://127.0.0.1:'+port;browser=new CdpClient((await(await fetch(cdpUrl+'/json/version')).json()).webSocketDebuggerUrl);await browser.connect();
  browserVersion=await browser.send('Browser.getVersion');
  for(const width of [320,384,600,1100]) for(const theme of ['light','dark']){
    const prefix=`${width}-${theme}`;
    page=await openPage({baseUrl,cdpUrl,width,height:1000,mobile:false});await page.navigate('/');await page.waitFor('window.ready===true');
    await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.fonts.ready`);await delay(500);
    await check(prefix+'-exact-product-css-and-six-rows',async()=>{
      const actual=await page.evaluate("({width:innerWidth,css:[...document.styleSheets].map(s=>new URL(s.href).pathname),rows:document.querySelectorAll('[data-finance-transaction]').length,financeWidth:document.getElementById('financePage').getBoundingClientRect().width,workspaceHeight:document.getElementById('financeWorkspace').getBoundingClientRect().height,colorScheme:getComputedStyle(document.documentElement).colorScheme})");
      assert.equal(actual.width,width);assert.deepEqual(actual.css,['/styles.css','/product-ui.css','/design-system.css','/public-experience.css','/workspace-experience.css']);assert.equal(actual.rows,6);assert.equal(actual.colorScheme,theme);assert.ok(actual.financeWidth>0 && actual.workspaceHeight>0,'visible route prerequisite');return actual;
    });
    for(const tx of source){
      const selector=`[data-finance-transaction="${tx.id}"]`;
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      const geometry=await page.evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(selector)}),main=row.querySelector('.finance-transaction-main'),side=row.querySelector('.finance-transaction-side'),reference=side.querySelector(':scope>small');const box=e=>{if(!e)return null;const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,overflow:s.overflow,whiteSpace:s.whiteSpace,textOverflow:s.textOverflow,lineClamp:s.webkitLineClamp,text:e.textContent};};return{viewport:innerWidth,theme:document.documentElement.dataset.theme,id:row.dataset.financeTransaction,row:box(row),main:box(main),side:box(side),reference:box(reference),amount:box(side.querySelector(':scope>strong')),metadata:box(main.querySelector('small')),actions:[...side.querySelectorAll('button')].map(box),documentWidth:document.documentElement.scrollWidth};})()`);
      geometries.push(geometry);
      await check(prefix+'-'+tx.currency+'-readable-unclipped-row',async()=>{
        assert.ok(geometry.main.width>=Math.min(120,width/3),`main ${geometry.main.width}px is below readable minimum ${Math.min(120,width/3)}px`);
        assert.ok(geometry.documentWidth<=width+1,`document overflow ${geometry.documentWidth}>${width}`);
        assert.ok(geometry.side.right<=geometry.row.right+1 && geometry.side.x>=geometry.row.x-1,'side escapes row');
        assert.ok(geometry.amount.width>0 && geometry.amount.right<=geometry.row.right+1,'original amount clipped');
        assert.equal(geometry.actions.length,2);for(const button of geometry.actions)assert.ok(button.width>=44 && button.height>=44 && button.x>=geometry.row.x-1 && button.right<=geometry.row.right+1,'edit/delete clipped');
        assert.ok(geometry.metadata.width>0 && geometry.metadata.height>0,'metadata disappeared');
        if(tx.currency==='CNY')assert.equal(geometry.reference,null);
        else {assert.match(geometry.reference.text,/参考折算.*Frankfurter v2 daily reference/);assert.ok(geometry.reference.clientWidth>=geometry.reference.scrollWidth-1,'reference horizontal clipping');assert.ok(geometry.reference.clientHeight>=geometry.reference.scrollHeight-1,'reference vertical clipping');assert.equal(geometry.reference.lineClamp,'none');assert.notEqual(geometry.reference.textOverflow,'ellipsis');}
        return {main:geometry.main.width,row:geometry.row.width,reference:geometry.reference?.text||null};
      });
    }
    await page.evaluate("document.getElementById('financeTransactionList').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const screenshot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(out,prefix+'.png'),Buffer.from(screenshot.data,'base64'));
    const ledgerClip=await page.evaluate("(()=>{const b=document.getElementById('financeTransactionList').getBoundingClientRect();return{x:0,y:b.y+scrollY,width:innerWidth,height:b.height,scale:1}})()");
    const ledgerShot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:ledgerClip});await writeFile(path.join(out,prefix+'-ledger.png'),Buffer.from(ledgerShot.data,'base64'));
    for(const tx of source){
      await check(prefix+'-'+tx.currency+'-visible-edit-delete-undo-keeps-facts',async()=>{
        await clickVisible(`[data-finance-edit="${tx.id}"]`);await page.waitFor("!document.getElementById('financeTransactionModal').classList.contains('hidden')");
        const actual=await page.evaluate("({id:document.getElementById('financeTransactionId').value,currency:document.getElementById('financeTransactionCurrency').value,amount:document.getElementById('financeTransactionAmount').value,merchant:document.getElementById('financeTransactionMerchant').value,note:document.getElementById('financeTransactionNote').value})");
        assert.equal(actual.id,tx.id);assert.equal(actual.currency,tx.currency);assert.equal(actual.amount,tx.currency==='JPY'?'1':'0.01');assert.equal(actual.merchant,tx.merchant);assert.equal(actual.note,tx.note);
        await clickVisible('#financeTransactionModal .modal-close');
        await clickVisible(`[data-finance-delete="${tx.id}"]`);await page.waitFor(`store().transactions[${JSON.stringify(tx.id)}].status==='deleted'`);
        await clickVisible('#financeUndoBtn');await page.waitFor(`store().transactions[${JSON.stringify(tx.id)}].status==='active'`);
        await page.evaluate('controller.syncNow()');await page.waitFor('store().pending.length===0');
        const persisted=await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(tx.id).first();assert.deepEqual(factual(persisted),originalFacts.find(row=>row.id===tx.id));return actual;
      });
    }
    await check(prefix+'-no-runtime-errors',async()=>assert.deepEqual(page.runtimeErrors,[]));
    await page.close();page=null;
  }
}catch(error){rows.push({id:'layout-harness',status:'FAIL',error:error.stack,runtimeErrors:page?.runtimeErrors});console.error(error);}
finally{
  if(page)await page.close().catch(()=>{});if(browser){await browser.send('Browser.close').catch(()=>{});browser.close();}child.kill();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch;await f.dispose();
  const after=await sourceLock();
  const sourceStable=JSON.stringify(before.files)===JSON.stringify(after.files);
  if(!sourceStable)rows.push({id:'tested-source-stability',status:'FAIL',error:'Product inputs changed while browser regression was running'});
  const driverAfter=sha(await readFile(fileURLToPath(import.meta.url)));if(driverAfter!==driverBefore)rows.push({id:'driver-stability',status:'FAIL',error:'Layout driver changed during execution'});
  const result={label,synthetic_only:true,real_chrome:true,real_local_http:true,real_miniflare_d1:true,browser_version:browserVersion,node_version:process.version,external_provider_calls:0,blocked_provider_calls:blockedProviderCalls,real_payment_operations:0,production_operations:0,product_root:root,source_before:before,source_after:after,source_stable:sourceStable,driver_sha256_before:driverBefore,driver_sha256_after:driverAfter,driver_stable:driverAfter===driverBefore,fixture:{originalFacts,reference_rates:rate,market_data:false},base_url:baseUrl,requests,rows,counts:{PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length},finished_utc:new Date().toISOString()};
  await writeFile(path.join(out,'geometry.json'),JSON.stringify(geometries,null,2)+'\n');await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.counts));
}
if(rows.some(row=>row.status==='FAIL'))process.exitCode=1;
