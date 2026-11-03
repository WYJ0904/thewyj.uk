import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openPage,CdpClient,delay} from '../../local-backend/browser_harness.mjs';

// No account login or backend exists here. Only allowlisted JS and synthetic
// controller transports are served, from a private loopback browser profile.
const root=path.resolve(import.meta.dirname,'../..');
const html=`<!doctype html><meta charset="utf-8"><title>Aeris synthetic state regression</title>
<div id="appShell"><main id="financePage"><section id="financeCandidatesSection"><button id="financeCandidatesRefreshBtn">刷新</button>
<span id="financePendingCount"></span><div id="financeCandidateMessage"></div><div id="financeCandidateList"></div></section>
<section id="financeRecoverySection"><span id="financeRecoveryCount"></span><div id="financeRecoveryList"></div></section>
<section id="financeRecordedSection"><div id="financeTransactionList"></div></section></main></div>
<script type="module">
import {createFinanceCandidatesController} from '/js/finance/candidates.js';
import {createFinanceController} from '/js/finance/app.js';
window.owner='synthetic-account';window.summaryCalls=0;window.writeCalls=0;
window.records=[{kind:'hint',id:'wechat-a',event_id:'event-a',event_ids:['event-a'],state:'pending',source_package:'com.tencent.mm',app_label:'支付宝',amount_minor:null,direction:'unknown'},
{kind:'hint',id:'alipay-b',event_id:'event-b',event_ids:['event-b'],state:'pending',source_package:'com.eg.android.AlipayGphone',app_label:'微信',amount_minor:123,direction:'income'}];
window.WYJLocalPaymentLedger={account_id:owner,transactions:[],reviews:[{...records[0],amount_minor:123,direction:'income'}]};
window.getSummary=async()=>({records:structuredClone(records),total_count:records.filter(r=>r.state==='pending').length,truncated:false});
window.candidates=createFinanceCandidatesController({account:()=>({id:owner}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,
api:async()=>{writeCalls++;throw Error('writes prohibited')},apiGet:()=>{summaryCalls++;return getSummary()}});
window.ledger=createFinanceController({account:()=>({id:owner}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,appVersion:'synthetic',
api:async()=>{writeCalls++;throw Error('writes prohibited')},apiGet:async p=>p.includes('bootstrap')?{transaction_count:1,server_version:1}:p.includes('transactions')?{transactions:[{id:'txn:synthetic-merchant',amount_minor:123,direction:'income',occurred_at_ms:Date.now(),merchant:'支付宝',source_kind:'automatic',revision:1,status:'active'}]}:{changes:[],server_version:1,next_since:1,has_more:false}});
await candidates.show();await ledger.show();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
  if(!/^\/js\/(core|finance)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type','text/javascript;charset=utf-8');res.end(await readFile(path.join(root,url.pathname.slice(1))))}
  catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseUrl='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(path.join(os.tmpdir(),'aeris-state-browser-'));
const chrome=process.env.AERIS_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const child=spawn(chrome,['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-component-update','--disable-default-apps','--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{windowsHide:true,stdio:'ignore'});
let page, browser;
const results=[];
try {
  let port;
  for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await delay(100);}}
  assert.ok(port,'private test browser started');
  const cdpUrl='http://127.0.0.1:'+port;
  browser=new CdpClient((await(await fetch(cdpUrl+'/json/version')).json()).webSocketDebuggerUrl);await browser.connect();
  page=await openPage({baseUrl,cdpUrl,width:390,height:900,mobile:true});
  await page.navigate('/');await page.waitFor('window.ready===true');
  const read=()=>page.evaluate(`({count:document.querySelector('#financePendingCount').textContent,
    cards:[...document.querySelectorAll('[data-canonical-identity]')].map(e=>({id:e.dataset.canonicalIdentity,text:e.textContent})),
    ledger:document.querySelector('#financeTransactionList').textContent,writes:writeCalls})`);
  let state=await read();
  assert.equal(state.count,'2');assert.match(state.cards[0].text,/微信/);assert.doesNotMatch(state.cards[0].text,/支付宝/);
  assert.match(state.cards[0].text,/1\.23/);assert.match(state.cards[0].text,/本机已识别/);assert.match(state.cards[0].text,/云端尚未确认/);
  assert.match(state.cards[1].text,/支付宝/);assert.doesNotMatch(state.cards[1].text,/微信/);
  assert.match(state.ledger,/支付宝/);assert.match(state.ledger,/Android 自动识别/);assert.equal(state.writes,0);
  results.push('T01/T06: actual DOM shows local evidence, two stable identities and independent merchant text');

  await page.evaluate(`(async()=>{records[0].amount_minor=999;records[0].direction='income';await candidates.reload({force:true});})()`);
  state=await read();assert.match(state.cards[0].text,/不一致/);assert.match(state.cards[0].text,/9\.99/);assert.match(state.cards[0].text,/1\.23/);
  await page.click('[data-finance-candidate-confirm="wechat-a"]');
  assert.equal(await page.evaluate(`document.querySelector('[data-finance-candidate-editor="wechat-a"]').classList.contains('hidden')`),false);
  assert.equal(await page.evaluate('writeCalls'),0);results.push('T13: conflict opens deliberate editor and sends no automatic confirmation');

  await page.evaluate(`(async()=>{records[0].amount_minor=123;await candidates.reload({force:true});})()`);
  state=await read();assert.doesNotMatch(state.cards[0].text,/本机已识别|不一致/);results.push('T01: fresh cloud observation converges');
  await page.evaluate(`records[0].state='ignored';document.dispatchEvent(new CustomEvent('thewyj:payment-updated'));`);
  await page.waitFor(`document.querySelector('#financePendingCount').textContent==='1'`);
  assert.equal((await read()).cards[0].id,'hint:alipay-b');results.push('T09: terminal server identity is not resurrected by retained local evidence');

  await page.evaluate(`window.savedSummary=getSummary;window.olderSummary=structuredClone(records);window.held=false;
    window.getSummary=()=>{held=true;return new Promise(r=>{window.finishOld=()=>r({records:olderSummary,total_count:1,truncated:false})})};
    void candidates.reload({force:true});`);
  await page.waitFor('held');
  await page.evaluate(`owner='synthetic-b';records=[{kind:'hint',id:'account-b',event_id:'event-b-only',state:'pending',source_package:'com.tencent.mm',amount_minor:456,direction:'income'}];
    getSummary=savedSummary;candidates.accountUpdated();finishOld();`);
  await page.waitFor(`document.querySelector('[data-canonical-identity="hint:account-b"]')!==null`);
  state=await read();assert.deepEqual(state.cards.map(r=>r.id),['hint:account-b']);results.push('T04/T08: delayed prior-account summary never paints new owner');

  await page.navigate('/');await page.waitFor('window.ready===true');
  assert.match((await read()).cards[0].text,/本机已识别/);results.push('T14: document reload receives prepublished snapshot and renders evidence');
  assert.equal(await page.evaluate('writeCalls'),0);
  assert.deepEqual(page.runtimeErrors,[]);
  console.log(JSON.stringify({kind:'LOCAL_HEADLESS_BROWSER_SYNTHETIC',tests:results.length,pass:results.length,fail:0,phoneTest:false,backendRequests:0,results},null,2));
} finally {
  await page?.close();
  if(browser){await browser.send('Browser.close').catch(()=>{});browser.close();}
  child.kill();
  await new Promise(resolve=>server.close(resolve));
}
