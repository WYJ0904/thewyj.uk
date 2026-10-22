import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture, root } from './fixture.mjs';
import { out } from './output.mjs';
import { currencyPreferences, referenceRate } from '../../functions/_lib/finance-fx.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { handleTask21Request } from '../../functions/_lib/task21-api.mjs';
import { ingestNotificationEvents } from '../../functions/_lib/task21-service.mjs';
import { handleTask16Request } from '../../functions/_lib/task16-api.mjs';
import { sessionStorageKey } from '../../functions/_lib/task12-crypto.mjs';
import { openPage, CdpClient, delay } from '../../local-backend/browser_harness.mjs';

const f=await fixture(), rows=[];
const token='synthetic-p04-chromium-session',now=new Date().toISOString(),today=now.slice(0,10);
const env={WYJ_DB:f.db,WYJ_ENVIRONMENT:'development',CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_WRITES_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',TASK21_NOTIFICATION_READS_ENABLED:'true',TASK21_NOTIFICATION_WRITES_ENABLED:'true'};
await f.db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'browser')`).bind(await sessionStorageKey(token),f.account.id,now,new Date(Date.now()+86400000).toISOString()).run();
await f.db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at) VALUES('synthetic-p04-browser-membership',?1,'finance_monthly',?2,?3,0,'active','fixture','synthetic-p04','fixture','{}',?2,?2)`).bind(f.account.id,now,new Date(Date.now()+86400000).toISOString()).run();
const units={CNY:1,USD:7,EUR:8,HKD:0.9,GBP:9.5,JPY:0.05};
const source=[];for(const currency of Object.keys(units))source.push(await f.transaction(currency,currency==='JPY'?10000:10000));
const legacy=await f.transaction('JPY',12345);await f.db.prepare('UPDATE task16_finance_transactions SET amount_exponent=NULL WHERE id=?1').bind(legacy.id).run();
const pending=(await ingestNotificationEvents(f.db,f.account,{schema_version:1,device_id:'synthetic-p04-pending-device',operations:[{operation_id:'synthetic-p04-pending-operation',type:'event.ingest',payload:{event_id:'synthetic-p04-pending-jpy',fingerprint:'b'.repeat(64),source_package:'cmb.pb',source_type:'notification',event_type:'transaction',parser_version:'bank-notification-4',parse_status:'candidate',direction:'expense',amount_minor:10000,currency:'JPY',amount_exponent:0,currency_evidence:'JPY',identity_review_reason:'identity_unproven_notification',payment_channel:'bank_card',merchant:'synthetic pending JPY',confidence:950,occurred_at_ms:Date.UTC(2026,9,19,12),received_at_ms:Date.UTC(2026,9,19,12)}}]})).operation_results[0];
assert.ok(pending.candidate_id);assert.equal(pending.transaction_id,'');
const legacyPending=(await ingestNotificationEvents(f.db,f.account,{schema_version:1,device_id:'synthetic-p04-pending-device',operations:[{operation_id:'synthetic-p04-legacy-pending-operation',type:'event.ingest',payload:{event_id:'synthetic-p04-legacy-pending-jpy',fingerprint:'c'.repeat(64),source_package:'cmb.pb',source_type:'notification',event_type:'transaction',parser_version:'bank-notification-4',parse_status:'candidate',direction:'expense',amount_minor:10000,currency:'JPY',amount_exponent:0,currency_evidence:'JPY',identity_review_reason:'identity_unproven_notification',payment_channel:'bank_card',merchant:'synthetic legacy pending JPY',confidence:950,occurred_at_ms:Date.UTC(2026,9,19,12),received_at_ms:Date.UTC(2026,9,19,12)}}]})).operation_results[0];
await f.db.prepare('DELETE FROM task21_currency_units WHERE user_id=?1 AND event_id=?2').bind(f.account.id,'synthetic-p04-legacy-pending-jpy').run();
await syncFinance(f.db,f.account,{schema_version:1,device_id:'synthetic-p04-browser-seed',platform:'web',since_version:0,operations:[{operation_id:'synthetic-p04-browser-budget',type:'budget.upsert',entity_id:'synthetic-p04-browser-budget',base_revision:0,payload:{period_type:'monthly',currency:'CNY',amount_minor:100000,starts_on:today.slice(0,7)+'-01',ends_on:today.slice(0,7)+'-31'}}]});
for(const base of Object.keys(units).filter(c=>c!=='GBP'))for(const quote of ['CNY','JPY'])if(base!==quote)for(const date of ['2026-10-19',today])await referenceRate(f.db,base,quote,date,{fetcher:async()=>new Response(JSON.stringify({base,quote,date,rate:units[base]/units[quote]}),{headers:{'Content-Type':'application/json'}})});
// Only the public provider is deliberately offline. All application HTTP is real.
const realFetch=globalThis.fetch;globalThis.fetch=(url,...args)=>String(url).startsWith('https://api.frankfurter.dev/')?Promise.reject(new Error('synthetic provider offline')):realFetch(url,...args);
let offline=false,apiCalls=0;
const index=await readFile(path.join(root,'index.html'),'utf8');
const finance=index.slice(index.indexOf('<section class="finance-page'),index.indexOf('<section class="finance-page')+index.slice(index.indexOf('<section class="finance-page')).indexOf('\n      <section class="'));
const modals=index.slice(index.indexOf('<div class="modal-layer hidden" id="financeTransactionModal"'),index.indexOf('<section class="project-picker'));
const html=`<!doctype html><meta charset="utf-8"><style>.hidden{display:none}body{font:16px sans-serif;max-width:1050px;margin:20px auto}small{display:block}select,input{padding:6px;margin:5px}.finance-transaction-row{padding:8px;border-bottom:1px solid #ddd}</style><div id="appShell">${finance.replace('finance-page hidden','finance-page')}${modals}</div>
<script type="module">
import {createFinanceController} from '/js/finance/app.js';
import {createFinanceCandidatesController} from '/js/finance/candidates.js';
window.offline=false;window.errors=[];
async function call(route,body,options={}){const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'X-Session-Token':${JSON.stringify(token)},'X-Finance-Money-Version':'2',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:options.controller?.signal});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.message||result.error||'synthetic offline'),{code:result.code});return result}
window.controller=createFinanceController({account:()=>({id:${JSON.stringify(f.account.id)}}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,appVersion:'synthetic-p04',apiGet:(p,o)=>call(p,undefined,o),api:call});
window.store=()=>JSON.parse(localStorage.getItem('wyjFinance:v1:'+${JSON.stringify(f.account.id)}));
window.candidates=createFinanceCandidatesController({account:()=>({id:${JSON.stringify(f.account.id)}}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,apiGet:(p,o)=>call(p,undefined,o),api:call});
await controller.show();await candidates.show();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/sw.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(await readFile(path.join(root,'sw.js')));return}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return}
  if(/^\/js\/(finance|core)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(root,url.pathname)));return}
  if((url.pathname.startsWith('/api/finance/') || url.pathname.startsWith('/api/notification/'))){apiCalls++;if(offline){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"message":"synthetic offline"}');return}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    const response=await (url.pathname.startsWith('/api/notification/')?handleTask21Request:handleTask16Request)({env,data:{requestId:'synthetic-browser'},request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return}
  res.writeHead(404);res.end();
}catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}))}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseUrl='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(path.join(os.tmpdir(),'finance-p04-chromium-'));
const child=spawn(process.env.AERIS_TEST_CHROME||'/workspace/.cloud-onboarding/chromium-test',['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore'});
let page,browser;
async function check(id,run){try{const actual=await run();rows.push({id,status:'PASS',actual});console.log('PASS',id)}catch(error){rows.push({id,status:'FAIL',error:error.stack});console.error('FAIL',id,error.message)}}
try{
  let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{await delay(100)}}assert.ok(port);
  const cdpUrl='http://127.0.0.1:'+port;browser=new CdpClient((await(await fetch(cdpUrl+'/json/version')).json()).webSocketDebuggerUrl);await browser.connect();
  page=await openPage({baseUrl,cdpUrl,width:1100,height:1000,mobile:false});await page.navigate('/');await page.waitFor('window.ready===true');
  await check('six-original-currencies-remain-separate-from-references',async()=>{const text=await page.evaluate("document.getElementById('financeTransactionList').textContent");assert.match(text,/参考折算/);assert.match(text,/缺少可用历史汇率/);assert.match(text,/单位待核实/);assert.match(text,/10,000/);const store=await page.evaluate('store()');for(const tx of source)assert.equal(store.transactions[tx.id].amount_minor,tx.amount_minor);return{text}});
  await check('budget-and-category-show-partial-unconverted-amounts',async()=>{await page.waitFor("document.getElementById('financeCategoryStats').getAttribute('aria-busy')==='false'");const text=await page.evaluate("({budget:document.getElementById('financeBudgetSummary').textContent,category:document.getElementById('financeCategoryStats').textContent,status:document.getElementById('financeCurrencyStatus').textContent})");assert.match(text.budget,/剩余待核实/);assert.match(text.category,/原币未换算/);assert.match(text.status,/待换算|待核实/);return text});
  const usd=source.find(t=>t.currency==='USD');
  await check('history-snapshot-survives-provider-cache-update',async()=>{const before=await page.evaluate(`store().fx_snapshots[${JSON.stringify(usd.id+':1:CNY')}]`);assert.equal(before.converted_minor,70000);await referenceRate(f.db,'USD','CNY','2026-10-19',{now:Date.now()+7*3600000,fetcher:async()=>new Response('{"base":"USD","quote":"CNY","date":"2026-10-19","rate":7.2}',{headers:{'Content-Type':'application/json'}})});await page.evaluate('controller.syncNow()');assert.equal((await page.evaluate(`store().fx_snapshots[${JSON.stringify(usd.id+':1:CNY')}]`)).converted_minor,70000)});
  await check('display-currency-change-invalidates-summary-without-ledger-edit',async()=>{await page.evaluate("document.getElementById('financeDisplayCurrency').value='JPY';document.getElementById('financeDisplayCurrency').dispatchEvent(new Event('change',{bubbles:true}));");await page.evaluate('controller.syncNow()');await page.waitFor("store().currency_preferences.display_currency==='JPY' && !store().currency_preferences_pending");assert.equal((await f.db.prepare('SELECT currency,amount_minor FROM task16_finance_transactions WHERE id=?1').bind(usd.id).first()).currency,'USD');assert.match(await page.evaluate("document.getElementById('financeCurrencyStatus').textContent"),/JPY|待换算/)});
  await check('manual-JPY-excess-precision-rejected-before-queue',async()=>{await page.click('#financeAddTransactionBtn');await page.evaluate("document.getElementById('financeTransactionCurrency').value='JPY';document.getElementById('financeTransactionAmount').value='1.25';document.getElementById('financeTransactionForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");const store=await page.evaluate('store()');assert.equal(store.pending.length,0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n,7)});
  let manualId;
  await check('manual-JPY-save-edit-and-sync-retain-zero-unit-and-ID',async()=>{await page.evaluate("document.getElementById('financeTransactionAmount').value='12345';document.getElementById('financeTransactionMerchant').value='synthetic manual JPY';document.getElementById('financeTransactionForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");await page.waitFor("Object.values(store().transactions).some(t=>t.merchant==='synthetic manual JPY')");await page.evaluate('controller.syncNow()');const row=(await f.db.prepare("SELECT * FROM task16_finance_transactions WHERE merchant='synthetic manual JPY'").all()).results[0];manualId=row.id;assert.equal(row.amount_minor,12345);assert.equal(row.amount_exponent,0);await page.evaluate(`document.querySelector('[data-finance-edit="${manualId}"]').click()`);assert.equal(await page.evaluate("document.getElementById('financeTransactionAmount').value"),'12345');await page.evaluate("document.getElementById('financeTransactionAmount').value='100';document.getElementById('financeTransactionForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");await page.evaluate('controller.syncNow()');await page.waitFor(`store().transactions[${JSON.stringify(manualId)}].amount_minor===100 && store().pending.length===0`);const next=await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(manualId).first();assert.equal(next.currency,'JPY');assert.equal(next.amount_minor,100);assert.equal(next.revision,2)});
  await check('pending-JPY-editor-and-confirm-use-original-zero-unit',async()=>{
    const id=pending.candidate_id;await page.evaluate(`document.querySelector('[data-finance-candidate-edit="${id}"]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('[data-finance-candidate-editor="${id}"] [name="amount"]').value`),'10000');
    await page.evaluate(`(()=>{const form=document.querySelector('[data-finance-candidate-editor="${id}"]');form.elements.amount.value='12345';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`);
    await page.waitFor(`!document.querySelector('[data-finance-candidate="${id}"]')`);
    const stored=await f.db.prepare("SELECT * FROM task16_finance_transactions WHERE merchant='synthetic pending JPY'").first();
    assert.ok(stored);assert.equal(stored.currency,'JPY');assert.equal(stored.amount_minor,12345);assert.equal(stored.amount_exponent,0);
    const original=await f.db.prepare("SELECT amount_minor FROM task21_notification_events WHERE event_id='synthetic-p04-pending-jpy'").first();assert.equal(original.amount_minor,10000);
  });
  await check('legacy-unitless-JPY-pending-editor-requires-retyped-zero-unit-amount',async()=>{
    const id=legacyPending.candidate_id;await page.evaluate(`document.querySelector('[data-finance-candidate-edit="${id}"]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('[data-finance-candidate-editor="${id}"] [name="amount"]').value`),'');
    assert.match(await page.evaluate(`document.querySelector('[data-finance-candidate="${id}"]').textContent`),/单位待核实/);
    await page.evaluate(`(()=>{const form=document.querySelector('[data-finance-candidate-editor="${id}"]');form.elements.amount.value='12345';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`);
    await page.waitFor(`!document.querySelector('[data-finance-candidate="${id}"]')`);
    const stored=await f.db.prepare("SELECT * FROM task16_finance_transactions WHERE merchant='synthetic legacy pending JPY'").first();
    assert.equal(stored.amount_minor,12345);assert.equal(stored.amount_exponent,0);
    assert.equal((await f.db.prepare("SELECT amount_minor FROM task21_notification_events WHERE event_id='synthetic-p04-legacy-pending-jpy'").first()).amount_minor,10000);
  });
  await check('concurrent-preference-change-preserves-conflict-and-requires-new-selection',async()=>{
    const current=await currencyPreferences(f.db,f.account.id);
    await currencyPreferences(f.db,f.account.id,{revision:current.revision,display_currency:'GBP'});
    await page.evaluate("document.getElementById('financeDisplayCurrency').value='EUR';document.getElementById('financeDisplayCurrency').dispatchEvent(new Event('change',{bubbles:true}));");
    await page.evaluate('controller.syncNow()');
    await page.waitFor("store().currency_preferences_conflict && !store().currency_preferences_pending");
    const conflict=await page.evaluate('store().currency_preferences_conflict');assert.equal(conflict.local.display_currency,'EUR');assert.equal(conflict.remote.display_currency,'GBP');
    assert.match(await page.evaluate("document.getElementById('financeCurrencyStatus').textContent"),/重新选择/);
    await page.evaluate("document.getElementById('financeDisplayCurrency').value='JPY';document.getElementById('financeDisplayCurrency').dispatchEvent(new Event('change',{bubbles:true}));");await page.evaluate('controller.syncNow()');
    assert.equal((await currencyPreferences(f.db,f.account.id)).display_currency,'JPY');assert.equal(await page.evaluate('store().currency_preferences_conflict'),null);
  });
  await check('offline-reload-retains-history-and-original-money',async()=>{offline=true;await page.navigate('/');await page.waitFor('window.ready===true');assert.equal((await page.evaluate(`store().fx_snapshots[${JSON.stringify(usd.id+':1:CNY')}]`)).converted_minor,70000);assert.equal((await page.evaluate(`store().transactions[${JSON.stringify(usd.id)}]`)).amount_minor,10000);assert.match(await page.evaluate("document.getElementById('financeTransactionList').textContent"),/参考折算|缺少可用历史汇率/);offline=false});
  await check('FX-cache-quota-keeps-durable-refund-and-retry-identity',async()=>{
    offline=true;
    await page.evaluate(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('wyjFinance:v1:')&&Object.keys(JSON.parse(value).fx_snapshots||{}).length)throw new DOMException('synthetic FX quota','QuotaExceededError');return originalSetItem.call(this,key,value)}`);
    await page.click('#financeAddTransactionBtn');await page.evaluate("document.getElementById('financeTransactionCurrency').value='EUR';document.getElementById('financeTransactionDirection').value='refund';document.getElementById('financeTransactionAmount').value='10.25';document.getElementById('financeTransactionMerchant').value='synthetic quota refund';document.getElementById('financeTransactionForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");
    await page.waitFor("store().pending.length===1");const pending=await page.evaluate('store().pending[0]');assert.equal(pending.payload.currency,'EUR');assert.equal(pending.payload.amount_minor,1025);
    assert.equal(Object.keys((await page.evaluate('store()')).fx_snapshots).length,0);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM task16_finance_transactions WHERE merchant='synthetic quota refund'").first()).n,0);
    await page.evaluate('Storage.prototype.setItem=originalSetItem');offline=false;await page.evaluate('controller.syncNow()');await page.waitFor('store().pending.length===0');
    const row=await f.db.prepare("SELECT * FROM task16_finance_transactions WHERE merchant='synthetic quota refund'").first();assert.equal(row.id,pending.entity_id);assert.equal(row.direction,'refund');assert.equal(row.currency,'EUR');assert.equal(row.amount_minor,1025);
  });
  await check('service-worker-replaces-stale-shell-with-money-v2',async()=>{
    await page.evaluate(`(async()=>{const cache=await caches.open('wyj-shell-synthetic-old');await cache.put('/js/finance/money.js',new Response('export const MONEY_VERSION=1'));await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;})()`);
    await page.waitFor('navigator.serviceWorker.controller!==null');
    const keys=await page.evaluate('caches.keys()');assert.equal(keys.includes('wyj-shell-synthetic-old'),false);assert.ok(keys.some(key=>key.endsWith('finance-money-v2')));
    const money=await page.evaluate("fetch('/js/finance/money.js').then(r=>r.text())");assert.match(money,/MONEY_VERSION = 2/);
    await page.evaluate('(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister()})()');
  });
  await check('no-runtime-exceptions-in-real-Chromium',async()=>assert.deepEqual(page.runtimeErrors,[]));
  const screenshot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(out,'currency-browser.png'),Buffer.from(screenshot.data,'base64'));
}catch(error){rows.push({id:'browser-harness',status:'FAIL',error:error.stack,runtimeErrors:page?.runtimeErrors});console.error(error)}
finally{if(page)await page.close().catch(()=>{});if(browser){await browser.send('Browser.close').catch(()=>{});browser.close()}child.kill();await new Promise(r=>server.close(r));globalThis.fetch=realFetch;await f.dispose();await writeFile(path.join(out,'browser.json'),JSON.stringify({synthetic_only:true,real_chromium:true,apiCalls,rows},null,2)+'\n')}
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
