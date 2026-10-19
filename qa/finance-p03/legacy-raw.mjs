import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Miniflare} from 'miniflare';
import {normalizeRawEvent,reconciliationScore} from '../../functions/_lib/task16-model.mjs';
import {syncFinance} from '../../functions/_lib/task16-service.mjs';
const root=path.resolve(import.meta.dirname,'../..');const output=process.env.FINANCE_P03_OUTPUT;assert.ok(output);
await fs.mkdir(output,{recursive:true});const file=path.join(output,'legacy-raw.ndjson');
try{await fs.access(file);throw Error('Preserve existing evidence')}catch(e){if(e.code!=='ENOENT')throw e;}
const old=await import(pathToFileURL(path.join(process.env.USERPROFILE,'.codex/worktrees/finance-p02-tests/thewyj.uk/functions/_lib/task16-model.mjs')));
const raw=(id,more={})=>({source_type:'notification',source_event_id:id,source_provider:'synthetic-wechat',provider_reference:'',text:'支付成功 28.00元',currency:'CNY',
  merchant:'synthetic merchant',counterparty:'synthetic counterparty',account_last4:'1234',occurred_at_ms:1792368000000,captured_at_ms:1792368000000,metadata:{payment_channel:'wechat'},...more});
const before={iso:old.normalizeRawEvent(raw('synthetic-probe',{text:'已扣款 USD 100.00'})),authorization:old.normalizeRawEvent(raw('synthetic-hold',{text:'预授权扣款成功100元'})),
  similarity:old.reconciliationScore({...raw('synthetic-two'),direction:'expense',amount_minor:2800},{direction:'expense',amount_minor:2800,currency:'CNY',merchant:'synthetic merchant',counterparty:'synthetic counterparty',occurred_at_ms:1792368000000},[{...raw('synthetic-one'),source_type:'sms'}])};
await fs.writeFile(path.join(output,'before-p02.json'),JSON.stringify(before,null,2));
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic legacy")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
const account={id:'synthetic-p03-legacy-owner',entitlements:['finance_access']};const rows=[];let db;let sequence=0;
const count=async()=>Number((await db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id=?1').bind(account.id).first()).n);
const ingest=async payload=>(await syncFinance(db,account,{schema_version:1,device_id:'synthetic-raw-device',platform:'android',device_label:'synthetic',client_version:'synthetic',since_version:0,
  operations:[{operation_id:'synthetic-raw-operation-'+sequence++,type:'raw_event.ingest',payload}]})).operation_results[0];
async function check(id,expected,fn){let actual,error;try{actual=await fn()}catch(e){error=e}
 const r={case_id:id,status:error?'FAIL':'PASS',expected,actual,error:error?.stack||'',coverage:'REAL_TASK16_RAW_NORMALIZER_SYNC_AND_D1_SYNTHETIC_ONLY'};rows.push(r);await fs.appendFile(file,JSON.stringify(r)+'\n');}
try{
 db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
 const now=new Date().toISOString();await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
 VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
 await check('L01-LEGACY-AUTH-QUARANTINE','untyped authorization/settlement/release stay pending, no ledger',async()=>{
  assert.equal(before.authorization.classification,'accepted');const n=await count();const result=[];
  for(const [i,text] of ['预授权扣款成功100元','结算成功 已扣款80.00元','预授权解除100.00元'].entries()) {
   const r=await ingest(raw('synthetic-raw-lifecycle-'+i,{text}));assert.equal(r.transaction_id,'');assert.equal(r.raw_event.classification,'pending');result.push(r);
  }assert.equal(await count(),n);return result;
 });
 await check('L02-LEGACY-ISO-QUARANTINE','foreign evidence never creates a CNY transaction',async()=>{
  assert.equal(before.iso.classification,'accepted');assert.equal(before.iso.currency,'CNY');const n=await count();const result=[];
  for(const code of ['USD','EUR','HKD','GBP','JPY','AUD','CAD','BHD']){
   const p=raw('synthetic-raw-iso-'+code,{text:'已扣款 '+code+' 100.00'});const normalized=normalizeRawEvent(p);assert.equal(normalized.currency,code);assert.equal(normalized.classification,'pending');
   const r=await ingest(p);assert.equal(r.transaction_id,'');result.push({code,result:r});
  }assert.equal(await count(),n);return result;
 });
 await check('L03-SIMILARITY-IS-NOT-IDENTITY','full money/time/merchant/card similarity cannot auto-merge',async()=>{
  assert.equal(before.similarity.automatic,true);const n=await count();
  const a=await ingest(raw('synthetic-independent-a'));const b=await ingest(raw('synthetic-independent-b',{source_type:'sms',source_provider:'synthetic-sms'}));
  assert.ok(a.transaction_id);assert.ok(b.transaction_id);assert.notEqual(a.transaction_id,b.transaction_id);assert.equal(await count(),n+2);return {a,b};
 });
 await check('L04-STRONG-REFERENCE-BEYOND-WINDOW','declared same platform reference after six hours keeps one ledger and two evidence rows',async()=>{
  const n=await count();const a=await ingest(raw('synthetic-strong-a',{provider_reference:'SYNTH-RAW-STRONG'}));
  const b=await ingest(raw('synthetic-strong-b',{source_type:'sms',source_provider:'synthetic-sms',provider_reference:'SYNTH-RAW-STRONG',occurred_at_ms:1792389600000}));
  assert.equal(a.transaction_id,b.transaction_id);assert.equal(await count(),n+1);
  const evidence=await db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transaction_events WHERE transaction_id=?1').bind(a.transaction_id).first();assert.equal(evidence.n,2);return {a,b,evidence};
 });
 await check('L05-DIFFERENT-PLATFORM-REFERENCE','same literal reference on different declared platforms stays independent',async()=>{
  const n=await count();const a=await ingest(raw('synthetic-platform-a',{provider_reference:'SYNTH-CROSS-PLATFORM'}));
  const b=await ingest(raw('synthetic-platform-b',{source_provider:'synthetic-alipay',provider_reference:'SYNTH-CROSS-PLATFORM',metadata:{payment_channel:'alipay'}}));
  assert.notEqual(a.transaction_id,b.transaction_id);assert.equal(await count(),n+2);return {a,b};
 });
 await check('L06-RAW-RETRY','same authoritative source event repeats thirty times without another ledger',async()=>{
  const n=await count();const ids=[];for(let i=0;i<30;i++)ids.push((await ingest(raw('synthetic-independent-a'))).transaction_id);
  assert.equal(new Set(ids).size,1);assert.equal(await count(),n);return {ids};
 });
 await check('L07-AMBIGUOUS-HISTORICAL-REFERENCE','two existing transactions with the same declared reference cannot be guessed into one',async()=>{
  await db.prepare("UPDATE task16_finance_raw_events SET provider_reference='SYNTH-AMBIGUOUS-RAW' WHERE user_id=?1 AND source_event_id IN ('synthetic-independent-a','synthetic-independent-b')").bind(account.id).run();
  const n=await count();const r=await ingest(raw('synthetic-ambiguous-third',{source_provider:'synthetic-third',provider_reference:'SYNTH-AMBIGUOUS-RAW'}));
  assert.equal(r.transaction_id,'');assert.equal(r.raw_event.classification,'pending');assert.equal(await count(),n);return r;
 });
 await check('L08-CONFLICTING-REFERENCE-MONEY','a strong reference with conflicting money preserves pending evidence without rewriting earlier money',async()=>{
  const n=await count();const r=await ingest(raw('synthetic-conflicting-money',{source_provider:'synthetic-conflicting',provider_reference:'SYNTH-RAW-STRONG',text:'支付成功 13.00元'}));
  assert.equal(r.transaction_id,'');assert.equal(r.raw_event.classification,'pending');assert.equal(await count(),n);return r;
 });
}finally{await mf.dispose()}
console.log(JSON.stringify({cases:rows.length,pass:rows.filter(r=>r.status==='PASS').length,fail:rows.filter(r=>r.status==='FAIL').length},null,2));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
