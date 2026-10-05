import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openPage } from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8908';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const page=await openPage({baseUrl,cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9228',width:1366,height:900,mobile:false});
let version=1,changesRead=[];
const row={id:'p4-cursor:fixture',merchant:'P4 cursor fixture',direction:'expense',amount_minor:1,currency:'CNY',status:'active',revision:1,occurred_at_ms:new Date(2026,9,5,12).getTime()};
try {
  await page.navigate('/login');await page.waitFor("!document.getElementById('entryScreen')");
  await page.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'");
  await page.intercept([
    {match:'/api/finance/bootstrap',respond:()=>({body:{ok:true,server_version:version,transaction_count:1,categories:[],budgets:[]}})},
    {match:'/api/finance/transactions?',respond:()=>({body:{ok:true,transactions:[row],server_version:version}})},
    {match:'/api/finance/changes?',respond:({url})=>{const since=Number(new URL(url).searchParams.get('since'));changesRead.push(since);return{body:{ok:true,server_version:version,has_more:false,changes:since<version?[{version,entity_type:'transaction',entity_id:row.id,payload:{transaction:row}}]:[]}};}},
  ]);
  await page.navigate('/finance');await page.waitFor("!document.getElementById('entryScreen') && document.querySelector('#financeSyncStatus').textContent==='已同步' && document.querySelector('#financeRecordedCount').textContent==='1'");
  row.amount_minor=901;row.revision=2;version=2;
  await page.click('#financeSyncBtn');await page.waitFor("document.querySelector('#financeSyncStatus').textContent==='已同步'");
  const edited=await page.evaluate("document.querySelector('[data-finance-transaction] .finance-transaction-side').textContent.includes('9.01')");
  row.status='deleted';row.revision=3;version=3;
  await page.click('#financeSyncBtn');await page.waitFor("document.querySelector('#financeSyncStatus').textContent==='已同步'");
  const removed=await page.evaluate("document.querySelector('#financeRecordedCount').textContent==='0'");
  const result={scope:'Real browser/controller; isolated bootstrap/change-feed responses with unchanged count',baseUrl,edited,removed,changesRead,runtimeErrors:page.runtimeErrors};
  const output=path.resolve(process.env.AERIS_P4_CURSOR_OUTPUT||'artifacts/aeris-p4/finance-cursor.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(process.env.AERIS_P4_EXPECT_CURSOR_GAP==='true'){assert.equal(edited,false);assert.equal(removed,false);}
  else{assert.equal(edited,true,'Count-only bootstrap must not skip an edit');assert.equal(removed,true,'Count-only bootstrap must not skip a tombstone');}
  assert.deepEqual(page.runtimeErrors,[]);
}finally{await page.close();}
