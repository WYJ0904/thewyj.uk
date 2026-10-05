import assert from 'node:assert/strict';
import {openPage} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8908';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const page=await openPage({baseUrl,cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9228',width:390,height:900,mobile:true});
try {
 await page.navigate('/login');await page.waitFor('!!document.querySelector("#usernameInput")');
 await page.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await page.click('#loginSubmitBtn');
 await page.waitFor('document.querySelector("#publicHome").dataset.sessionMode==="authenticated"');
 const accountId=await page.evaluate('JSON.parse(localStorage.getItem("wyjAccountCache")).id');
 const remote=[0,1,2].map(i=>({id:`remote-${i}`,kind:'hint',state:'pending',event_id:`event-${i}`,event_ids:[`event-${i}`]}));
 const local=[0,1].map(i=>({id:`legacy-${i}`,kind:'hint',state:'pending',event_id:`pay-verify:legacy-${i}`,event_ids:[`pay-verify:legacy-${i}`],app_label:'P4 own recovery',amount_minor:1,direction:'unknown'}));
 let records=remote,status=200,partial=false;
 await page.intercept([{match:'/api/notification/pending-summary',respond:()=>({status,body:status===200?{ok:true,records,total_count:records.filter(r=>r.state==='pending').length,truncated:partial}:{error:'P4 own transport fixture'}})}]);
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.WYJLocalPaymentLedger=${JSON.stringify({account_id:accountId,transactions:[],reviews:local})};`});
 await page.navigate('/finance');await page.waitFor('document.querySelector("#financePendingCount").textContent==="3"&&document.querySelector("#financeRecoveryCount").textContent==="2"');
 assert.equal(await page.evaluate('document.querySelectorAll("[data-canonical-identity]").length'),3);
 assert.equal(await page.evaluate('document.querySelectorAll("[data-recovery-identity]").length'),2);
 assert.deepEqual(await page.evaluate('window.WYJLocalPaymentLedger.reviews.map(r=>r.id)'),['legacy-0','legacy-1']);
 records=[...remote,{...local[0],id:'matched-server',event_id:'new-alias',event_ids:['new-alias',local[0].event_id]}];
 await page.click('#financeCandidatesRefreshBtn');await page.waitFor('document.querySelector("#financePendingCount").textContent==="4"&&document.querySelector("#financeRecoveryCount").textContent==="1"');
 partial=true;await page.click('#financeCandidatesRefreshBtn');await page.waitFor('document.querySelector("#financeCandidateMessage").textContent.includes("不完整")');
 assert.equal(await page.evaluate('document.querySelector("#financePendingCount").textContent'),'4');
 partial=false;status=403;await page.click('#financeCandidatesRefreshBtn');await page.waitFor('document.querySelector("#financeCandidateMessage").textContent.includes("transport fixture")');
 assert.equal(await page.evaluate('document.querySelector("#financeRecoveryCount").textContent'),'1');
 status=200;records=[];await page.click('#financeCandidatesRefreshBtn');await page.waitFor('document.querySelector("#financePendingCount").textContent==="0"&&document.querySelector("#financeRecoveryCount").textContent==="2"');
 assert.deepEqual(await page.evaluate('window.WYJLocalPaymentLedger.reviews.map(r=>r.event_id)'),local.map(r=>r.event_id));
 console.log('P4 canonical 3 / recovery 2, immutable identities, alias convergence and empty/error/partial fallback browser PASS');
}finally{await page.close();}
