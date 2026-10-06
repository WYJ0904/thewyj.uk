import assert from 'node:assert/strict';import fs from 'node:fs';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8938';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9250',baseUrl,width:390,height:900,mobile:true});
try {
 await p.navigate('/');await p.waitFor('!document.getElementById("entryScreen")');assert.equal(await p.evaluate("document.querySelectorAll('[data-tool-card]').length"),0);
 await p.navigate('/login');await p.waitFor('!document.getElementById("entryScreen")');await p.setFields({'#usernameInput':'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');await p.waitFor("location.pathname==='/'");
 await p.click('a[data-site-nav][href="/tools"]');await p.waitFor("document.querySelectorAll('[data-tool-card]').length===24");let batches=0;
 while(!(await p.evaluate("document.querySelector('#toolCatalogMoreBtn').hidden"))){await p.click('#toolCatalogMoreBtn');batches++;}
 const total=await p.evaluate("document.querySelectorAll('[data-tool-card]').length");assert.equal(total,103);
 // Entry mounts the public catalogue before account preferences arrive. Settle
 // that owner before comparing row identity across an unchanged model.
 await p.evaluate("window.WYJTools.show('/tools',{})");
 await p.evaluate("document.querySelector('#dismissVersionNoticeBtn')?.click();true");
 await p.evaluate("window.__p5ToolRow=document.querySelector('[data-tool-card]');true");await p.click('a[data-site-nav][href="/"]');await p.waitFor("location.pathname==='/'");assert.equal(await p.evaluate("window.__p5ToolRow.isConnected"),false);
 await p.click('a[data-site-nav][href="/tools"]');await p.waitFor("document.querySelectorAll('[data-tool-card]').length===103");assert.equal(await p.evaluate("window.__p5ToolRow===document.querySelector('[data-tool-card]')"),true);
 await p.click('#openWorkflowBtn');await p.waitFor("!!window.WYJWorkflows && window.WYJTools.isReady() && location.pathname==='/tools/workflows'&&!document.querySelector('#workflowWorkspace').classList.contains('hidden')");
 const rows=Array.from({length:120},(_,i)=>({id:`p5-contract:${i}`,merchant:'P5 contract',direction:'expense',amount_minor:i+1,currency:'CNY',status:'active',revision:1,occurred_at_ms:Date.UTC(2026,9,5,12)-i*60000}));
 const reviews=[{kind:'hint',id:'p5-contract-hint',event_id:'p5-contract-event',event_ids:['p5-contract-event'],state:'pending',amount_minor:null,direction:null,occurred_at_ms:rows[0].occurred_at_ms,source_package:'com.tencent.mm'}];
 await p.intercept([{match:'/api/finance/bootstrap',respond:()=>({body:{ok:true,server_version:1,transaction_count:120,categories:[],budgets:[]}})},{match:'/api/finance/transactions?',respond:()=>({body:{ok:true,server_version:1,transactions:rows}})},{match:'/api/finance/changes?',respond:()=>({body:{ok:true,server_version:1,has_more:false,changes:[]}})},{match:'/api/notification/pending-summary',respond:()=>({body:{ok:true,records:reviews,total_count:1,truncated:false}})}]);
 await p.navigate('/finance');await p.waitFor("document.querySelector('#financeRecordedCount').textContent==='120'&&document.querySelector('#financePendingCount').textContent==='1'");
 await p.click('[data-finance-candidate-edit="p5-contract-hint"]');await p.evaluate("document.querySelector('[data-finance-candidate-editor]').elements.amount.value='0.01';window.__p5LedgerRow=document.querySelector('[data-finance-transaction]');window.__p5ReviewRow=document.querySelector('[data-canonical-identity]');true");
 await p.click('a[data-site-nav][href="/"]');await p.waitFor("location.pathname==='/'");assert.equal(await p.evaluate("window.__p5LedgerRow.isConnected||window.__p5ReviewRow.isConnected"),false);
 // A genuine native payment signal may arrive after Finance has been hidden.
 // It must update the same detached owner rather than create a second DOM set.
 await p.evaluate("document.dispatchEvent(new CustomEvent('thewyj:payment-updated'));true");await delay(200);
 assert.equal(await p.evaluate("document.querySelector('#financeCandidateList').childElementCount"),0,'background reconciliation stays off the connected hidden DOM');
 await p.click('a[data-site-nav][href="/finance"]');await p.waitFor("document.querySelector('#financePendingCount').textContent==='1' && document.querySelector('[data-finance-candidate-editor]')");
 assert.equal(await p.evaluate("document.querySelectorAll('#financeCandidateList [data-canonical-identity]').length"),1,'one canonical record returns as exactly one row');
 assert.equal(await p.evaluate("window.__p5LedgerRow===document.querySelector('[data-finance-transaction]')&&window.__p5ReviewRow===document.querySelector('[data-canonical-identity]')"),true);
 assert.equal(await p.evaluate("document.querySelector('[data-finance-candidate-editor]').elements.amount.value"),'0.01');
 await p.click('a[data-site-nav][href="/"]');await p.waitFor("location.pathname==='/'");reviews[0]={...reviews[0],merchant:'P6 hidden display update'};
 await p.evaluate("document.dispatchEvent(new Event('visibilitychange'));true");await delay(300);
 await p.click('a[data-site-nav][href="/finance"]');await p.waitFor("document.querySelector('#financeCandidateList').textContent.includes('P6 hidden display update')");
 assert.equal(await p.evaluate("document.querySelectorAll('#financeCandidateList [data-canonical-identity]').length"),1);
 assert.equal(await p.evaluate("document.querySelector('[data-finance-candidate-editor]').elements.amount.value"),'0.01','an updated hidden row retains the existing unsubmitted amount');
 assert.deepEqual(p.runtimeErrors,[]);console.log(JSON.stringify({catalogTotal:total,batches,toolsParkedIdentity:true,workflowDeepLink:true,ledgerParkedIdentity:true,reviewDraftPreserved:true,runtimeErrors:0}));
}finally{await p.close();}
