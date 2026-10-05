import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8908';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1','Synthetic rows never target Production');
const results=[];
for(const width of [390,1366,1920]) {
  const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9228',baseUrl,width,height:900,mobile:width===390});
  try {
    await page.navigate('/login');await page.waitFor("!document.getElementById('entryScreen')");
    await page.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await page.click('#loginSubmitBtn');
    await page.waitFor("location.pathname==='/' && document.querySelector('#publicHome').dataset.sessionMode==='authenticated'");
    const rows=Array.from({length:250},(_,i)=>({id:`p4-behavior:${i}`,merchant:`P4 fixture ${i}`,direction:'expense',amount_minor:i+1,currency:'CNY',status:'active',revision:1,occurred_at_ms:new Date(2026,9,5,12).getTime()-i*60000}));
    let changed=false,failed=false,ignore=false,slow=false,serverVersion=1,summaryReads=0;
    const users=Array.from({length:160},(_,i)=>({id:`p4-admin-user-${i}`,username:`P4 isolated member ${i}`,role:'user',is_admin:false,is_super_admin:false,banned:false,entitlements:[],memberships:[]}));
    const reviews=Array.from({length:125},(_,i)=>({id:`p4-review-${i}`,kind:'hint',event_id:`p4-review-event-${i}`,event_ids:[`p4-review-event-${i}`],state:'pending',amount_minor:1,direction:null,occurred_at_ms:rows[i].occurred_at_ms,source_package:'com.tencent.mm',app_label:'微信'}));
    await page.intercept([
      {match:'/api/finance/bootstrap',respond:()=>failed?{status:503,body:{error:'P4 isolated transport failure'}}:{body:{ok:true,server_version:serverVersion,transaction_count:rows.length,categories:[],budgets:[]}}},
      {match:'/api/finance/transactions?',respond:()=>({body:{ok:true,transactions:rows,server_version:serverVersion}})},
      {match:'/api/finance/changes?',respond:({url})=>({body:{ok:true,server_version:serverVersion,has_more:false,changes:changed&&Number(new URL(url).searchParams.get('since'))<2?[{version:2,entity_type:'transaction',entity_id:rows[0].id,payload:{transaction:rows[0]}}]:[]}})},
      {match:'/api/notification/pending-summary',respond:()=>{summaryReads++;return{delayMs:slow?400:0,body:{ok:true,records:ignore?reviews.slice(1):reviews,total_count:ignore?124:125,truncated:false}};}},
      {match:'/api/notification/hints/',respond:()=>{ignore=true;return{body:{ok:true}};}},
      {match:'/api/admin/users?',respond:({url})=>{const params=new URL(url).searchParams,p=Number(params.get('page')||1),query=params.get('q')||params.get('query')||'',filtered=users.filter(u=>!query||u.username.includes(query));return{body:{ok:true,users:filtered.slice((p-1)*30,p*30),page:p,total:filtered.length,has_more:p*30<filtered.length,limit:30,query,match:'partial'}};}},
    ]);
    await page.navigate('/finance');await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#financeRecordedCount').textContent==='250' && document.querySelector('#financePendingCount').textContent==='125'");
    await page.evaluate("document.querySelector('#financeRecordedSection').open=true;document.querySelector('#financeCandidatesSection').open=true;window.__p4Rows=[...document.querySelectorAll('[data-finance-transaction]')];window.__p4Pending=[...document.querySelectorAll('[data-canonical-identity]')];true");
    assert.equal(await page.evaluate("window.__p4Rows.length"),100);
    await page.click('#financeLedgerMoreBtn');assert.equal(await page.evaluate("document.querySelectorAll('[data-finance-transaction]').length"),200);
    assert.equal(await page.evaluate("window.__p4Rows.every(n=>n.isConnected)"),true,'Pagination appends and retains the prior DOM');
    await page.click('#financeLedgerMoreBtn');assert.equal(await page.evaluate("document.querySelectorAll('[data-finance-transaction]').length"),250);
    assert.equal(await page.evaluate("document.querySelector('#financeLedgerMoreBtn').hidden"),true);
    await page.evaluate("window.__p4Rows=[...document.querySelectorAll('[data-finance-transaction]')];true");
    rows[0]={...rows[0],amount_minor:901,revision:2};changed=true;serverVersion=2;
    await page.click('#financeSyncBtn');await page.waitFor("document.querySelector('[data-finance-transaction] .finance-transaction-side').textContent.includes('9.01')");
    const preserved=await page.evaluate("window.__p4Rows.slice(1).every(n=>n.isConnected) && !window.__p4Rows[0].isConnected");assert.equal(preserved,true,'Only the modified transaction row is replaced');
    for(let i=0;i<4;i++)await page.click('#financeRecordedSection > summary');
    await page.waitFor("document.querySelector('#financeRecordedSection').open===true");
    assert.equal(await page.evaluate("window.__p4Rows.slice(1).every(n=>n.isConnected)"),true,'Folding does not rebuild the list');
    await page.setFields({'#financeSearchInput':'P4 fixture 249'});await page.waitFor("document.querySelectorAll('[data-finance-transaction]').length===1");
    await page.setFields({'#financeSearchInput':''});await page.waitFor("document.querySelectorAll('[data-finance-transaction]').length===100");
    await page.click('#financeAllMonthsBtn');assert.ok(await page.evaluate("document.querySelector('#financeFilterSummary').textContent.includes('全部月份')"));
    await page.setFields({'#financeMonthFilter':'2026-09'});assert.equal(await page.evaluate("document.querySelector('#financeRecordedCount').textContent"),'0');
    await page.setFields({'#financeMonthFilter':'2026-10'});assert.equal(await page.evaluate("document.querySelector('#financeRecordedCount').textContent"),'250');
    await page.click('[data-finance-candidate-edit="p4-review-1"]');
    await page.evaluate("const f=document.querySelector('[data-finance-candidate-editor=\"p4-review-1\"]');f.elements.amount.value='0.01';f.elements.direction.value='expense';f.elements.amount.focus();true");
    slow=true;await page.click('#financeCandidatesRefreshBtn');
    assert.equal(await page.evaluate("window.__p4Pending.every(n=>n.isConnected)"),true,'Slow review refresh does not blank the canonical set');
    await page.waitFor("document.querySelector('#financeCandidatesSection').getAttribute('aria-busy')==='false'");
    assert.equal(await page.evaluate("document.querySelector('[data-finance-candidate-editor=\"p4-review-1\"]').elements.amount.value"),'0.01');
    assert.equal(await page.evaluate("window.__p4Pending.every(n=>n.isConnected)"),true,'Unchanged review rows and draft inputs survive refresh');
    slow=false;await page.click('[data-finance-candidate-reject="p4-review-0"]');await page.waitFor("document.querySelector('#financePendingCount').textContent==='124'");
    await page.click('#financeCandidatesRefreshBtn');await page.waitFor("document.querySelector('#financeCandidatesSection').getAttribute('aria-busy')==='false'");
    assert.equal(await page.evaluate("Boolean(document.querySelector('[data-canonical-identity=\"hint:p4-review-0\"]'))"),false,'Terminal identity stays absent after refresh');
    await page.evaluate("window.__p4StableLedger=[...document.querySelectorAll('[data-finance-transaction]')];true");
    failed=true;await page.click('#financeSyncBtn');await page.waitFor("document.querySelector('#financeSyncStatus').textContent==='同步失败'",30000);
    assert.equal(await page.evaluate("window.__p4StableLedger.every(n=>n.isConnected)"),true,'Offline/error state retains existing rows');
    failed=false;
    await page.navigate('/tools');await page.waitFor("!document.getElementById('entryScreen') && document.querySelectorAll('[data-tool-card]').length>20");
    // Catalog paints before remote preferences. Measure the user toggle after
    // that initial hydration, rather than conflating it with saved favorites.
    await page.evaluate("window.WYJTools.show('/tools').then(()=>true)");
    await page.evaluate("window.__p4Tools=[...document.querySelectorAll('[data-tool-card]')];true");
    const toolId=await page.evaluate("window.__p4Tools[0].dataset.toolCard");
    const favoriteBefore=await page.evaluate(`document.querySelector('[data-toggle-favorite="${toolId}"]').getAttribute('aria-pressed')`);
    const favoriteAfter=favoriteBefore==='true'?'false':'true';
    await page.click(`[data-toggle-favorite="${toolId}"]`);await page.waitFor(`document.querySelector('[data-toggle-favorite="${toolId}"]').getAttribute('aria-pressed')===${JSON.stringify(favoriteAfter)}`);
    assert.equal(await page.evaluate("window.__p4Tools.slice(1).every(n=>n.isConnected)"),true,'Favorite update retains all unaffected catalog entries');
    await page.click(`[data-open-tool="${toolId}"]`);await page.waitFor("!document.querySelector('#toolWorkbench').classList.contains('hidden')");
    await page.click('#closeToolWorkbenchBtn');await page.waitFor("document.querySelector('#toolWorkbench').classList.contains('hidden')");
    await page.navigate('/account');await page.waitFor("!document.getElementById('entryScreen') && !document.querySelector('#accountModal').classList.contains('hidden')");
    assert.equal(await page.evaluate("document.querySelectorAll('#accountDetails > .account-setting-row').length"),8);
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await page.waitFor("document.querySelector('#accountModal').classList.contains('hidden')");
    await page.navigate('/admin');await page.waitFor("!document.getElementById('entryScreen') && document.querySelectorAll('[data-user-id]').length===30");
    await page.evaluate("window.__p4AdminRows=[...document.querySelectorAll('[data-user-id]')];true");
    for(const count of [60,90,120]) {await page.click('#adminUserLoadMoreBtn');await page.waitFor(`document.querySelectorAll('[data-user-id]').length===${count}`);}
    assert.equal(await page.evaluate("window.__p4AdminRows.every(n=>n.isConnected)"),true,'Admin pagination appends without replacing existing rows');
    await page.setFields({'#adminUserSearch':'P4 isolated member 159'});
    assert.equal(await page.evaluate("window.__p4AdminRows.every(n=>n.isConnected)"),true,'Search feedback preserves the previous list until the response');
    await page.waitFor("document.querySelectorAll('[data-user-id]').length===1");
    assert.equal(await page.evaluate("document.querySelector('[data-user-id]').dataset.userId"),'p4-admin-user-159');
    await page.navigate('/language/english');await page.waitFor("!document.getElementById('entryScreen') && !document.querySelector('#projectApp').classList.contains('hidden')");
    const fixture=await page.evaluate("(()=>{const q=document.querySelector('#quizView');return{sameDocument:performance.getEntriesByType('navigation').length===1,quizExists:Boolean(q),setupVisible:document.querySelector('#setupView').classList.contains('active')};})()");assert.equal(fixture.quizExists,true);
    // Question transition and round durability are also exercised by the full
    // browser flow; this scope never injects answers into real account data.
    assert.deepEqual(page.runtimeErrors,[]);
    results.push({width,pagination:true,rowPatch:true,foldRetainsRows:true,history:true,canonicalReviews:125,draftPreserved:true,terminalRefresh:true,errorPreservesLedger:true,toolFavoriteLocalUpdate:true,toolBack:true,accountRows:8,escape:true,adminRows:120,adminAppendRetainsRows:true,adminSearch:true,learning:fixture,summaryReads});
    console.log(`P4 workspace behavior PASS ${width}`);
  }finally{await page.close();}
}
const output=path.resolve(process.env.AERIS_P4_BEHAVIOR_OUTPUT||'artifacts/aeris-p4/behavior.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({scope:'Isolated real Chrome presentation contracts; synthetic intercepts are not server lifecycle or physical-device proof',results},null,2));
