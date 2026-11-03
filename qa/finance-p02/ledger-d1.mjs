import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {createAutomaticFinanceTransaction} from '../../functions/_lib/task21-service.mjs';
import {applyFinanceChange,calculateFinanceSummary} from '../../js/finance/app.js';
const root=path.resolve(import.meta.dirname,'../..');const output=path.join(root,'docs/migration-evidence/finance-p02/matrix');const rows=[];
async function check(id,input,expected,fn){
 let actual,error;const start=performance.now();try{actual=await fn();assert.deepEqual(actual,expected)}catch(e){error=e}
 rows.push({case_id:id,group:'G',layer:'CURRENT_BASELINE',fixture:input,expected,actual,status:error?'FAIL':'PASS',error:error?.stack||'',elapsed_ms:performance.now()-start,coverage:id.includes('D1')?'REAL_PRODUCT_SERVICE_LOCAL_MINIFLARE_D1':'REAL_PRODUCT_CLIENT_CHANGE_PROJECTION'});
}
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local synthetic P02")}}',
 compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
try{
 const db=await mf.getD1Database('DB');
 const migrations=(await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort();
 for(const name of migrations)await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
 const account={id:'synthetic-p02-d1-account'};const now=new Date().toISOString();
 await db.prepare(`INSERT INTO task12_users (id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
 VALUES (?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
 const base={event_id:'synthetic-p02-event-a',fingerprint:'a'.repeat(64),payment_channel:'wechat',provider_reference:'',direction:'expense',amount_minor:64800,currency:'CNY',merchant:'synthetic merchant',counterparty:'',occurred_at_ms:1792281600000,received_at_ms:1792281600000,parser_version:'synthetic-p02',confidence:950};
 const count=async()=>Number((await db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id=?1').bind(account.id).first()).n);
 let first;
 await check('G-D1-TRIPLE-RETRY',{event:base,retries:3},{count:1,uniqueIds:1},async()=>{
  const replies=[];for(let i=0;i<3;i++)replies.push(await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',base));first=replies[0].transaction_id;
  return {count:await count(),uniqueIds:new Set(replies.map(r=>r.transaction_id)).size};
 });
 await check('G-D1-CROSS-DEVICE-RECEIPT',{eventId:base.event_id,secondDevice:'synthetic-device-b'},{count:1,idPreserved:true,duplicate:true},async()=>{
  const r=await createAutomaticFinanceTransaction(db,account,'synthetic-device-b',base);return {count:await count(),idPreserved:r.transaction_id===first,duplicate:r.duplicate};
 });
 await check('G-D1-INDEPENDENT-SAME-AMOUNT',{sameFingerprint:true,eventId:'synthetic-p02-event-b'},{count:2,newId:true},async()=>{
  const r=await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',{...base,event_id:'synthetic-p02-event-b'});return {count:await count(),newId:r.transaction_id!==first};
 });
 let referenceId;
 await check('G-D1-RELIABLE-REFERENCE',{reference:'SYNTH-PROVIDER-REF',aliases:['synthetic-p02-ref-a','synthetic-p02-ref-b']},{count:3,oneId:true},async()=>{
  const a=await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',{...base,event_id:'synthetic-p02-ref-a',provider_reference:'SYNTH-PROVIDER-REF'});
  const b=await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',{...base,event_id:'synthetic-p02-ref-b',provider_reference:'SYNTH-PROVIDER-REF'});referenceId=a.transaction_id;
  return {count:await count(),oneId:a.transaction_id===b.transaction_id};
 });
 await check('G-D1-CROSS-CHANNEL-REFERENCE',{reference:'SYNTH-PROVIDER-REF',channel:'bank_card'},{count:4,separateId:true},async()=>{
  const r=await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',{...base,event_id:'synthetic-p02-bank-event',provider_reference:'SYNTH-PROVIDER-REF',payment_channel:'bank_card'});
  return {count:await count(),separateId:r.transaction_id!==referenceId};
 });
 await check('G-D1-REFERENCE-CONFLICT',{reference:'SYNTH-PROVIDER-REF',conflicting_minor:64600},{count:4,rejected:true},async()=>{
  let rejected=false;try{await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',{...base,event_id:'synthetic-p02-conflict',provider_reference:'SYNTH-PROVIDER-REF',amount_minor:64600})}catch(e){rejected=e.code==='provider_reference_conflict'}
  return {count:await count(),rejected};
 });
 await check('G-D1-ORIGINAL-CURRENCY',{currency:'USD',amount_minor:10000},{currency:'USD',amount_minor:10000},async()=>{
  const r=await createAutomaticFinanceTransaction(db,account,'synthetic-device-a',{...base,event_id:'synthetic-p02-usd-event',currency:'USD',amount_minor:10000});
  const value=await db.prepare('SELECT currency,amount_minor FROM task16_finance_transactions WHERE id=?1').bind(r.transaction_id).first();return {currency:value.currency,amount_minor:value.amount_minor};
 });
 const original={id:'synthetic-p02-client-tx',currency:'CNY',amount_minor:64800,direction:'expense',status:'active',occurred_at_ms:1792281600000,revision:1};
 const store={transactions:{[original.id]:original},categories:{},budgets:{},server_version:1};
 const change=(revision,status,amount=64600)=>({entity_type:'transaction',version:revision,payload:{transaction:{...original,revision,status,amount_minor:amount}}});
 await check('G-WEB-EDIT-STABLE-ID',{original,edit_minor:64600},{count:1,id:original.id,amount:64600},()=>{applyFinanceChange(store,change(2,'active'));return {count:Object.keys(store.transactions).length,id:store.transactions[original.id].id,amount:store.transactions[original.id].amount_minor}});
 await check('G-WEB-DELETE-TOMBSTONE',{id:original.id,revision:3},{active:0,stored:1},()=>{applyFinanceChange(store,change(3,'deleted'));return {active:calculateFinanceSummary(Object.values(store.transactions)).count,stored:Object.keys(store.transactions).length}});
 await check('G-WEB-RESTORE',{id:original.id,revision:4},{active:1,stored:1,amount:64600},()=>{applyFinanceChange(store,change(4,'active'));return {active:calculateFinanceSummary(Object.values(store.transactions)).count,stored:Object.keys(store.transactions).length,amount:store.transactions[original.id].amount_minor}});
 await check('G-WEB-LATE-OLD-RECEIPT',{id:original.id,old_revision:1},{active:1,revision:4,amount:64600},()=>{applyFinanceChange(store,change(1,'active',64800));return {active:calculateFinanceSummary(Object.values(store.transactions)).count,revision:store.transactions[original.id].revision,amount:store.transactions[original.id].amount_minor}});
}finally{await mf.dispose();await fs.writeFile(path.join(output,'ledger-d1.ndjson'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');}
console.log(JSON.stringify({cases:rows.length,pass:rows.filter(r=>r.status==='PASS').length,fail:rows.filter(r=>r.status==='FAIL').length},null,2));if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
