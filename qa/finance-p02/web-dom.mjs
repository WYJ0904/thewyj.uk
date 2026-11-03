import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openPage,CdpClient,delay} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..');const rows=[];
const html=`<!doctype html><meta charset="utf-8"><title>Finance P02 synthetic currency summary</title>
<div id="appShell"><div id="financePage"><input id="financeMonthFilter" value="2026-10"><div id="financeBudgetSummary"></div><div id="financeCategoryStats"></div><div id="financeTransactionList"></div></div></div>
<script type="module">
import {createFinanceController} from '/js/finance/app.js';
window.mode='cny';window.writeCalls=0;
window.tx=()=>[{id:'p02-cny-001',currency:'CNY',amount_minor:10000,direction:'expense',status:'active',occurred_at_ms:Date.UTC(2026,9,18,12),category_id:'p02-category',revision:1},
 {id:'p02-other-001',currency:mode==='mixed'?'USD':'CNY',amount_minor:10000,direction:'expense',status:'active',occurred_at_ms:Date.UTC(2026,9,18,12),category_id:'p02-category',revision:1}];
window.controller=createFinanceController({account:()=>({id:'synthetic-finance-p02-dom'}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,appVersion:'synthetic-p02',
 api:async()=>{writeCalls++;throw Error('writes forbidden')},apiGet:async p=>p.includes('bootstrap')?{transaction_count:2,server_version:1,
 categories:[{id:'p02-category',name:'合成分类',applies_to:'expense',status:'active',revision:1}],budgets:[{id:'p02-budget',currency:'CNY',amount_minor:100000,category_id:'p02-category',period:'month',starts_on:'2026-10-01',ends_on:'2026-10-31',status:'active',revision:1}]}:
 p.includes('transactions')?{transactions:tx()}:{changes:[],server_version:1,next_since:1,has_more:false}});
await controller.show();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
 if(!/^\/js\/(core|finance)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(root,url.pathname.slice(1))))}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseUrl='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(path.join(os.tmpdir(),'finance-p02-dom-'));
const child=spawn(process.env.AERIS_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
 ['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,
  '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{windowsHide:true,stdio:'ignore'});
let browser,page;
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{await delay(100)}}
 assert.ok(port,'own isolated Chrome must start');const cdpUrl='http://127.0.0.1:'+port;
 browser=new CdpClient((await(await fetch(cdpUrl+'/json/version')).json()).webSocketDebuggerUrl);await browser.connect();
 page=await openPage({baseUrl,cdpUrl,width:1000,height:900,mobile:false});await page.navigate('/');await page.waitFor('window.ready===true');
 await page.waitFor(`document.querySelector('#financeCategoryStats').getAttribute('aria-busy')==='false'`);
 const read=()=>page.evaluate(`({budget:document.querySelector('#financeBudgetSummary').textContent,budgetUsed:document.querySelector('#financeBudgetSummary small')?.textContent.split('/')[0]||'',category:document.querySelector('#financeCategoryStats').textContent,writeCalls})`);
 let value=await read();
 for(const kind of ['budget','category']){
  const actual=value[kind==='budget'?'budgetUsed':kind];const ok=/200(?:\.00)?/.test(actual);rows.push({case_id:'DW-DOM-CNY-'+kind,group:'D',layer:'CURRENT_BASELINE',expected:'spent 200.00 CNY',actual,status:ok?'PASS':'FAIL',fixture:{currency:['CNY','CNY'],amount_minor:[10000,10000]},coverage:'REAL_CONTROLLER_PRIVATE_SUMMARY_RENDERED_IN_CHROME_SYNTHETIC_HTTP_ONLY'});
 }
 await page.evaluate(`(async()=>{controller.hide();controller.resetAccount();mode='mixed';localStorage.clear();await controller.show();})()`);
 await page.waitFor(`document.querySelector('#financeCategoryStats').getAttribute('aria-busy')==='false'`);
 value=await read();
 for(const kind of ['budget','category']){
  const actual=value[kind==='budget'?'budgetUsed':kind];const ok=/800(?:\.00)?/.test(actual);rows.push({case_id:'DW-DOM-MIXED-'+kind,group:'D',layer:'TARGET_SPEC',expected:'spent 800.00 CNY or explicit unconverted grouping; never unqualified spent 200.00 CNY',actual,status:ok?'PASS':'EXPECTED_RED',fixture:{currency:['CNY','USD'],amount_minor:[10000,10000],synthetic_rate:7,date:'2026-10-18',market_data:false},coverage:'REAL_CONTROLLER_PRIVATE_SUMMARY_RENDERED_IN_CHROME_SYNTHETIC_HTTP_ONLY'});
 }
 assert.equal(value.writeCalls,0);
}catch(e){rows.push({case_id:'DW-DOM-HARNESS',group:'D',layer:'CURRENT_BASELINE',status:'FAIL',coverage:'BROWSER_HARNESS_FAILURE',error:e.stack});}
finally{
 await writeFile(path.join(root,'docs/migration-evidence/finance-p02/matrix/web-dom.ndjson'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 if(page)await page.close().catch(()=>{});if(browser){await browser.send('Browser.close').catch(()=>{});browser.close();}
 child.kill();await new Promise(r=>server.close(r));
}
console.log(JSON.stringify(rows,null,2));if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
