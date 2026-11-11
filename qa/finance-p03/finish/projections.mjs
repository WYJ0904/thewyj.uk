// Exercise the real Finance projection with this run's actual D1 change feed.
// This is not a browser, phone, real account or three-page acceptance claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {applyFinanceChange,calculateFinanceSummary,filterFinanceTransactions,financeCollectionKey} from '../../../js/finance/app.js';
const out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);await fs.mkdir(out,{recursive:true});const log=path.join(out,'projections.ndjson');await fs.writeFile(log,'',{flag:'wx'});
const base=path.resolve('docs/migration-evidence/finance-p03/finish/device-resolution/cases');
const data=JSON.parse(await fs.readFile(path.join(base,'F01-PROVEN-MULTI-ID-PRESERVES-HISTORY.json'),'utf8'));
const manual=JSON.parse(await fs.readFile(path.join(base,'F20-COMMIT-ERROR-THEN-MANUAL-EDIT-CANNOT-RETURN-STALE-RECEIPT.json'),'utf8'));
const project=changes=>{const store={[financeCollectionKey('transaction')]:{},server_version:0};for(const c of changes)assert.equal(applyFinanceChange(store,{...c,payload:JSON.parse(c.payload_json)}),true);return {store,rows:Object.values(store[financeCollectionKey('transaction')])}};
const changes=data.task16_finance_changes.sort((a,b)=>a.version-b.version);
const tests=[
 ['UI01-CONTIGUOUS-SUPERSESSION-FEED-COUNTS-ONE-EXPENSE',()=>{const {rows,store}=project(changes);assert.equal(rows.length,2);const live=filterFinanceTransactions(rows);assert.equal(live.length,1);assert.equal(live[0].amount_minor,9000);const summary=calculateFinanceSummary(rows);assert.equal(summary.expense_minor,9000);assert.equal(summary.count,1);assert.equal(store.server_version,changes.at(-1).version);return {rows,summary}}],
 ['UI02-REVERSED-AND-THIRTY-REPLAYED-FEEDS-KEEP-OLD-ID-DELETED',()=>{const {rows}=project(Array.from({length:30},()=>[...changes].reverse()).flat());assert.equal(rows.length,2);assert.equal(rows.filter(t=>t.status==='deleted').length,1);assert.equal(calculateFinanceSummary(rows).expense_minor,9000);assert.equal(filterFinanceTransactions(rows,{status:'all'}).length,2)}],
 ['UI03-LATER-USER-EDIT-WINS-OVER-OLD-CORRECTION',()=>{const {rows}=project([...manual.task16_finance_changes].sort((a,b)=>b.version-a.version));assert.equal(calculateFinanceSummary(rows).expense_minor,1234);assert.equal(rows.filter(t=>t.status==='active').length,1);assert.equal(rows.find(t=>t.status==='active').revision,3)}],
];
for(const [case_id,fn]of tests){let error,actual;try{actual=fn()}catch(e){error=e.stack;process.exitCode=1}await fs.appendFile(log,JSON.stringify({case_id,status:error?'FAIL':'PASS',error:error||'',actual,source_evidence:'device-resolution/cases',scope:'actual JS projection with synthetic D1 data; real UI NOT_TESTED'})+'\n');console.log(case_id,error?'FAIL':'PASS')}
