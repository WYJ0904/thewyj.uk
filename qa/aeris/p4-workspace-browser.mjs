import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';
import { benchmarkFixture } from './fixture.mjs';

const baseUrl = process.env.WYJ_TEST_BASE || 'http://127.0.0.1:8908';
assert.equal(new URL(baseUrl).hostname, '127.0.0.1', 'Only isolated local fixtures are allowed');
const mode = process.env.AERIS_P4_MODE || 'after';
const output = path.resolve(process.env.AERIS_P4_OUTPUT || `artifacts/aeris-p4/${mode}.json`);
const cdpUrl = process.env.WYJ_CDP_URL || 'http://127.0.0.1:9228';
const fixtureRoot = path.resolve('.tool-e2e/aeris-p4/fixtures');
fs.mkdirSync(fixtureRoot, { recursive: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
const rows = Array.from({ length: 1500 }, (_, i) => ({
  id: `p4-ledger:${String(i).padStart(5, '0')}`, direction: i % 3 === 0 ? 'income' : 'expense',
  amount_minor: i + 1, occurred_at_ms: new Date(2026, 9, 5, 12).getTime() - i * 60000,
  merchant: i === 3 ? 'P4 长文件与商户名称 '.repeat(12) : `P4 merchant ${i}`,
  category_id: 'p4-category:daily', currency: 'CNY', status: 'active', source_kind: i % 2 ? 'manual' : 'automatic',
  reconciliation_state: 'confirmed', revision: 1, note: i === 4 ? 'P4 long note '.repeat(20) : '',
}));
const pending = Array.from({ length: 120 }, (_, i) => ({
  kind: 'hint', id: `p4-hint-${i}`, event_id: `p4-event-${i}`, event_ids: [`p4-event-${i}`],
  state: 'pending', source_package: 'com.tencent.mm', app_label: '微信',
  amount_minor: i % 2 ? 1 : null, direction: null, merchant: i === 0 ? 'P4 long source '.repeat(10) : '',
  occurred_at_ms: rows[i].occurred_at_ms, confidence: 700,
}));
const instrumentation = `(() => {
  let current = null, previous = 0;
  const ids = new Set(['financeTransactionList','financeCandidateList','financeCategoryStats','financeBudgetSummary','toolCatalog','toolCategoryList','accountDetails','adminUserList','transferQueue']);
  window.__p4Start = () => current = {started:performance.now(),writes:[],longTasks:[],frameGaps:[],inputMs:[]};
  window.__p4Read = () => ({...current,elapsed:performance.now()-current.started});
  const d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  Object.defineProperty(Element.prototype,'innerHTML',{...d,set(v){const at=performance.now();d.set.call(this,v);if(current&&ids.has(this.id))current.writes.push({id:this.id,ms:performance.now()-at,children:this.childElementCount});}});
  new PerformanceObserver(list=>{if(current)for(const e of list.getEntries())if(e.startTime>=current.started)current.longTasks.push(e.duration);}).observe({type:'longtask',buffered:false});
  function frame(at){if(current&&previous>=current.started)current.frameGaps.push(at-previous);previous=at;requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();`;

async function login(page) {
  await page.navigate('/login');
  await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#usernameInput')");
  await page.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER || 'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});
  await page.click('#loginSubmitBtn');
  await page.waitFor("location.pathname==='/' && document.querySelector('#publicHome').dataset.sessionMode==='authenticated'",30000);
}
async function installFixtures(page) {
  await page.intercept([
    {match:'/api/finance/bootstrap',respond:()=>({body:{ok:true,transaction_count:rows.length,server_version:1,categories:[{id:'p4-category:daily',name:'日常',status:'active',revision:1}],budgets:[]}})},
    {match:'/api/finance/transactions?',respond:()=>({body:{ok:true,transactions:rows,server_version:1}})},
    {match:'/api/finance/changes?',respond:()=>({body:{ok:true,changes:[],server_version:1,has_more:false}})},
    {match:'/api/notification/pending-summary',respond:()=>({body:{ok:true,records:pending,total_count:pending.length,truncated:false}})},
    {match:'/api/admin/users?',respond:({url})=>{const params=new URL(url).searchParams,p=Number(params.get('page')||1),query=params.get('q')||params.get('query')||'';const users=Array.from({length:30},(_,i)=>({id:`p4-user-${(p-1)*30+i}`,username:`P4 safe user ${(p-1)*30+i}`,role:'user',is_admin:false,is_super_admin:false,banned:false,registered_at:new Date().toISOString(),entitlements:['tools_access'],memberships:[]}));return{body:{ok:true,users,total:160,page:p,limit:30,has_more:p<6,query,match:'partial'}};}},
  ]);
  if (visualOnly) await page.intercept([
    // Visual-only runs may use an isolated static/legacy gateway when the
    // Windows Wrangler dev proxy exits. Real transfer performance/integrity
    // remains measured separately against Pages D1/R2 and in Core CI.
    {match:'/api/transfer/capabilities',respond:()=>({body:{ok:true,stored_bytes:0,reserved_bytes:0,used_bytes:0,storage_limit_bytes:5*1024**3,authenticated:true}})},
    {match:'/api/transfer/shares',respond:()=>({body:{ok:true,shares:[]}})},
  ]);
}
async function screenshot(page,name) {
  await page.evaluate("(async()=>{await Promise.all(document.getAnimations().filter(a=>a.playState==='running' && a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})()");
  const {data}=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const target=path.join(path.dirname(output),`${mode}-${name}.png`);fs.writeFileSync(target,Buffer.from(data,'base64'));return target;
}
const cases=[],pressures=[];
const visualOnly=process.env.AERIS_P4_VISUAL_ONLY==='true';
for(const width of [390,1366,1920]) {
  const page=await openPage({cdpUrl,baseUrl,width,height:900,mobile:width===390});
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation});
    await login(page);await installFixtures(page);
    for(const theme of ['light','dark']) {
      // Theme survives hard navigation; never alter a real profile or account.
      await page.evaluate(`localStorage.setItem('wyj_theme_preference_v1',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const [name,route,ready] of [
        ['home','/',"document.querySelector('#publicHome').dataset.sessionMode==='authenticated'"],
        ['finance','/finance',"document.querySelector('#financeRecordedCount').textContent==='1500'"],
        ['notifications','/finance',"document.querySelector('#financePendingCount').textContent==='120'"],
        ['files','/transfer',"!document.querySelector('#transferQuotaText').textContent.includes('加载中')"],
        ['learning','/language',"!document.querySelector('#projectPicker').classList.contains('hidden')"],
        ['tools','/tools',"document.querySelectorAll('[data-tool-card]').length>10"],
        ['account','/account',"!document.querySelector('#accountModal').classList.contains('hidden')"],
        ['settings','/account',"!document.querySelector('#accountModal').classList.contains('hidden')"],
        ['admin','/admin',"document.querySelectorAll('[data-user-id]').length===30"],
      ]) {
        await page.navigate(route);await page.waitFor(ready,30000,name);
        await page.waitFor("!document.getElementById('entryScreen') && document.documentElement.dataset.aerisMotionReady==='true'",30000,`${name} visible without entry overlay`);
        await page.click('#dismissVersionNoticeBtn');
        await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);
        if(name==='finance')await page.evaluate("document.querySelector('#financeRecordedSection').open=true;document.querySelector('#financeCandidatesSection').open=false;document.querySelector('#financeTransactionList').scrollIntoView();true");
        if(name==='notifications')await page.evaluate("document.querySelector('#financeCandidatesSection').open=true;document.querySelector('#financeCandidatesSection').scrollIntoView();true");
        const geometry=await page.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};return{overflow:document.documentElement.scrollWidth-innerWidth,theme:document.documentElement.dataset.theme,path:location.pathname,ledgerRows:document.querySelectorAll('[data-finance-transaction]').length,pendingRows:document.querySelectorAll('[data-canonical-identity]').length,bodyNodes:document.body.querySelectorAll('*').length,ledger:rect(document.querySelector('#financeRecordedSection')),insights:rect(document.querySelector('#financeInsightDisclosure')),visibleDialogs:[...document.querySelectorAll('[role=dialog]')].filter(e=>e.getBoundingClientRect().height>0).length};})()`);
        cases.push({width,theme,name,geometry,screenshot:await screenshot(page,`${width}-${theme}-${name}`),scope:name==='notifications'?'Web canonical pending review; native history requires Android':name==='settings'?'Web account settings; native settings require Android':'actual Web workspace'});
        assert.ok(geometry.overflow<=1,`${name} ${width} ${theme} overflow ${geometry.overflow}`);
      }
    }
    if (visualOnly) { assert.deepEqual(page.runtimeErrors,[]); continue; }
    // Identical large-ledger and input workload before and after implementation.
    await page.navigate('/finance');await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#financeRecordedCount').textContent==='1500'");
    await page.evaluate("document.querySelector('#financeRecordedSection').open=true;window.__p4Start();window.__p4OriginalRow=document.querySelector('[data-finance-transaction]');true");
    const search=await page.evaluate(`(async()=>{const input=document.querySelector('#financeSearchInput');for(const value of ['P','P4','P4 ','P4 m','P4 me','P4 mer','P4 merc','P4 merch','P4 mercha','P4 merchant']){const at=performance.now();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));const end=await new Promise(r=>requestAnimationFrame(()=>r(performance.now())));window.__p4Read().inputMs.push(end-at);}return true;})()`);
    assert.equal(search,true);await delay(300);
    const searchMetrics=await page.evaluate("window.__p4Read()");
    await page.setFields({'#financeSearchInput':''});await delay(300);
    await page.evaluate("window.__p4OriginalRow=document.querySelector('[data-finance-transaction]');window.__p4Start();for(let i=0;i<12;i++)financeController.render();true");
    await delay(100);
    const refresh=await page.evaluate("({...window.__p4Read(),retained:window.__p4OriginalRow===document.querySelector('[data-finance-transaction]'),rows:document.querySelectorAll('[data-finance-transaction]').length})");
    await page.navigate('/tools');await page.waitFor("!document.getElementById('entryScreen') && document.querySelectorAll('[data-tool-card]').length>10");
    await page.evaluate("window.__p4Start();true");
    await page.evaluate(`(async()=>{const input=document.querySelector('#toolSearchInput');for(const value of ['j','js','jso','json','jso','js','j','']){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(r));}return true;})()`);await delay(300);
    const tools=await page.evaluate("window.__p4Read()");
    pressures.push({width,financeSearch:searchMetrics,financeRefresh:refresh,toolsSearch:tools,runtimeErrors:page.runtimeErrors});
    assert.deepEqual(page.runtimeErrors,[]);
    console.log(JSON.stringify({mode,width,financeWrites:refresh.writes.filter(x=>x.id==='financeTransactionList').length,retained:refresh.retained,rows:refresh.rows,searchLongTasks:searchMetrics.longTasks.length,toolWrites:tools.writes.filter(x=>x.id==='toolCatalog').length}));
  } finally {await page.close();}
}

// Actual disk File -> multipart D1/R2 on loopback, with exact acknowledgements.
const transfers=[];
for(let repeat=0;repeat<(visualOnly?0:3);repeat++) {
  const page=await openPage({cdpUrl,baseUrl,width:1366,height:900,mobile:false});
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation});await login(page);await page.navigate('/transfer');
    await page.waitFor("!document.querySelector('#transferQuotaText').textContent.includes('加载中')");
    const fixture=benchmarkFixture();const files=[fixture];
    for(let i=0;i<12;i++){const f=path.join(fixtureRoot,`p4-small-${i}.bin`);if(!fs.existsSync(f))fs.writeFileSync(f,Buffer.alloc(32768,i));files.push(f);}
    await page.evaluate("window.__p4Start();true");await page.setFile('#transferFileInput',files);
    await page.waitFor("document.querySelector('#transferCompleteBtn').disabled===false",240000,'real multipart files complete');
    const metric=await page.evaluate(`(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('wyjTransferQueue:')),items=JSON.parse(localStorage.getItem(key)||'{}').queue||[];return{...window.__p4Read(),items:items.map(x=>({name:x.name,size:x.size,uploaded:x.uploaded,status:x.status,partSize:x.partSize,partCount:x.partCount,acknowledged:x.uploadedParts?.length,performance:x.performance}))};})()`);
    for(const item of metric.items){assert.equal(item.uploaded,item.size);assert.equal(item.status,'done');assert.equal(item.acknowledged,item.partCount);}
    assert.equal(metric.items.length,13);assert.deepEqual(page.runtimeErrors,[]);
    transfers.push({repeat,...metric,runtimeErrors:page.runtimeErrors});console.log(JSON.stringify({mode,repeat,uploadMs:metric.items[0].performance?.totalMs,queueRootWrites:metric.writes.filter(x=>x.id==='transferQueue').length,longTasks:metric.longTasks.length}));
  }finally{await page.close();}
}
fs.writeFileSync(output,JSON.stringify({mode,scope:'Isolated Windows headless Chrome / actual Pages D1 R2 on loopback. No physical Android or WAN claim.',baseUrl,cases,pressures,transfers},null,2));
console.log(`P4 evidence: ${output}`);
