// New precise regressions. Frozen P02 cases and their expected values stay intact.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {applyFinanceChange,calculateFinanceSummary,filterFinanceTransactions,financeLedgerMonths} from '../../../js/finance/app.js';
import {normalizeManualTransaction} from '../../../functions/_lib/task16-model.mjs';
const out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);await fs.mkdir(out,{recursive:true});
const file=path.join(out,'legacy-controls.ndjson');await fs.writeFile(file,'',{flag:'wx'});
const when=Date.UTC(2026,9,20,12);
const hold={id:'synthetic-legacy-auth',direction:'expense',amount_minor:20000,currency:'USD',status:'active',occurred_at_ms:when,payment_state:'pending_authorization',provider_reference:'SYNTH-P02-AUTH',revision:1};
const posted={...hold,id:'synthetic-legacy-posted',amount_minor:17000,payment_state:'posted_settlement'};
const release={...hold,id:'synthetic-legacy-release',direction:'authorization_release',payment_state:'authorization_release'};
const project=rows=>{const store={transactions:{},server_version:0};for(const row of rows)assert.equal(applyFinanceChange(store,{entity_type:'transaction',version:row.revision,payload:{transaction:row}}),true);return store};
const tests=[
 ['LC01-EXPLICIT-AUTHORIZATION-IS-NOT-EXPENSE',()=>assert.deepEqual(calculateFinanceSummary([hold]),{income_minor:0,expense_minor:0,refund_minor:0,balance_minor:0,count:0})],
 ['LC02-FROZEN-AUTH-POST-RELEASE-SEMANTICS',()=>assert.equal(calculateFinanceSummary([hold,posted,release]).expense_minor,17000)],
 ['LC03-HISTORY-EXCLUDES-NON-POSTING-CONTROLS',()=>assert.deepEqual(filterFinanceTransactions([hold,posted,release]).map(r=>r.id),[posted.id])],
 ['LC04-NORMALIZATION-KEEPS-EXPLICIT-STATE',()=>{const s=project([hold]);assert.equal(s.transactions[hold.id].payment_state,'pending_authorization');assert.equal(calculateFinanceSummary(Object.values(s.transactions)).expense_minor,0)}],
 ['LC05-CLOSED-JSON-ROUNDTRIP-PRESERVES-HOLD',()=>{const s=project([hold]);const restored=project(Object.values(JSON.parse(JSON.stringify(s)).transactions));assert.equal(calculateFinanceSummary(Object.values(restored.transactions)).expense_minor,0)}],
 ['LC06-LATER-EXPLICIT-MANUAL-REVISION-WINS',()=>{const s=project([hold]);const edited={...posted,id:hold.id,amount_minor:1234,revision:2};delete edited.payment_state;applyFinanceChange(s,{entity_type:'transaction',version:2,payload:{transaction:edited}});applyFinanceChange(s,{entity_type:'transaction',version:1,payload:{transaction:hold}});assert.equal(s.transactions[hold.id].revision,2);assert.equal(calculateFinanceSummary(Object.values(s.transactions)).expense_minor,1234)}],
 ['LC07-LEGACY-ID-AND-AMOUNT-ARE-RETAINED-FOR-AUDIT',()=>{const s=project([hold,posted,release]);assert.deepEqual(Object.keys(s.transactions).sort(),[hold.id,posted.id,release.id].sort());assert.equal(s.transactions[hold.id].amount_minor,20000);assert.equal(filterFinanceTransactions(Object.values(s.transactions),{status:'all'}).length,3)}],
 ['LC08-EXPIRED-HOLD-IS-NOT-SPEND-OR-REFUND',()=>{const expired={...hold,payment_state:'authorization_expired'};assert.equal(calculateFinanceSummary([expired]).balance_minor,0)}],
 ['LC09-NO-GUESS-FROM-AMOUNT-MERCHANT-OR-REFERENCE',()=>{const ordinary={...hold};delete ordinary.payment_state;assert.equal(calculateFinanceSummary([ordinary,posted]).expense_minor,37000)}],
 ['LC10-REAL-REFUND-AND-INCOME-REMAIN-UNCHANGED',()=>{const refund={...posted,id:'synthetic-refund',direction:'refund',amount_minor:2000};const income={...posted,id:'synthetic-income',direction:'income',amount_minor:50000};assert.deepEqual(calculateFinanceSummary([hold,posted,release,refund,income]),{income_minor:50000,expense_minor:17000,refund_minor:2000,balance_minor:35000,count:3})}],
 ['LC11-MONTH-SELECTOR-DOES-NOT-INVENT-POSTED-HISTORY',()=>assert.deepEqual(financeLedgerMonths([hold]),[])],
 ['LC12-DELETED-AND-MONTH-FILTERS-REMAIN-EFFECTIVE',()=>{assert.equal(calculateFinanceSummary([{...posted,status:'deleted'}]).expense_minor,0);assert.equal(calculateFinanceSummary([posted],{month:'2026-09'}).expense_minor,0)}],
 ['LC13-OLD-MANUAL-WRITER-FAILS-CLOSED-ON-CONTROL-FIELD',()=>assert.throws(()=>normalizeManualTransaction({direction:'expense',amount_minor:20000,currency:'USD',occurred_at_ms:when,payment_state:'pending_authorization'}),e=>e.code==='task16_fields_forbidden')],
 ['LC14-NO-INPUT-MUTATION-OR-ID-REPLACEMENT',()=>{const input=JSON.parse(JSON.stringify([hold,posted,release]));const before=JSON.stringify(input);calculateFinanceSummary(input);filterFinanceTransactions(input);assert.equal(JSON.stringify(input),before)}],
 ['LC15-LEGACY-SOURCE-REFERENCE-AND-RECEIPT-IDS-SURVIVE',()=>{const row={...hold,native_notification_event_id:'synthetic-source-event',notification_event_ids:['synthetic-source-event']};const s=project([row]);assert.equal(s.transactions[hold.id].provider_reference,hold.provider_reference);assert.deepEqual(s.transactions[hold.id].notification_event_ids,row.notification_event_ids);assert.equal(s.transactions[hold.id].native_notification_event_id,row.native_notification_event_id)}],
];
for(const [case_id,fn] of tests){const start=performance.now();let error;try{fn()}catch(e){error=e.stack;process.exitCode=1}const row={case_id,status:error?'FAIL':'PASS',error:error||'',elapsed_ms:performance.now()-start,scope:'real JS projection and manual write validator; synthetic explicit legacy controls'};await fs.appendFile(file,JSON.stringify(row)+'\n');console.log(case_id,row.status)}
