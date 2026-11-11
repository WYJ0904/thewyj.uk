import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {fixture} from './fixture.mjs';
import {syncFinance} from '../../functions/_lib/task16-service.mjs';
import {currencyPreferences} from '../../functions/_lib/finance-fx.mjs';
import {outUrl} from './output.mjs';
const f=await fixture(),rows=[];let sequence=0;
async function check(id,run){try{await run();rows.push({id,status:'PASS'})}catch(error){rows.push({id,status:'FAIL',error:error.stack})}console.log(rows.at(-1).status,id)}
function body(input,id=++sequence){return{schema_version:1,device_id:'synthetic-raw-unit-device',platform:'web',since_version:0,operations:[{operation_id:'synthetic-raw-unit-operation-'+id,type:'raw_event.ingest',payload:{source_type:'notification',source_event_id:'synthetic-raw-unit-source-'+id,source_provider:'synthetic-raw-unit-provider',provider_reference:'SYNTH-RAW-UNIT-'+id,merchant:'synthetic',occurred_at_ms:1000,captured_at_ms:1000,...input}}]}}
const ingest=async input=>(await syncFinance(f.db,f.account,body(input))).operation_results[0];
let saved,first;
try{
 for(const [id,input,expected] of [
  ['missing-source-currency-never-invents-CNY',{text:'已扣款 100.00'},null],
  ['JPY-integer-keeps-zero-decimal-unit',{text:'交易金额100 已扣款',currency:'JPY'},100],
  ['JPY-excess-precision-does-not-book',{text:'已扣款 JPY 100.00',currency:'JPY'},null],
  ['USD-excess-precision-is-not-truncated',{text:'已扣款 USD 1.239',currency:'USD'},null],
 ])await check(id,async()=>{const result=await ingest(input);if(expected===null)assert.equal(result.transaction_id,'');else{assert.ok(result.transaction_id);assert.equal(result.transaction.amount_minor,expected);assert.equal(result.transaction.amount_exponent,0)}});
 for(const currency of ['CNY','USD','EUR','HKD','GBP','JPY'])for(const [word,direction]of [['已扣款','expense'],['收款成功','income'],['退款成功','refund']])await check(currency+'-'+direction+'-uses-exact-original-minor-unit',async()=>{
  const result=await ingest({text:word+' '+currency+(currency==='JPY'?' 12345':' 123.45'),currency});assert.ok(result.transaction_id,JSON.stringify(result));
  const row=await f.db.prepare('SELECT currency,amount_minor,direction,amount_exponent FROM task16_finance_transactions WHERE id=?1').bind(result.transaction_id).first();assert.equal(row.currency,currency);assert.equal(row.direction,direction);assert.equal(row.amount_minor,12345);assert.equal(row.amount_exponent,currency==='JPY'?0:2);
 });
 for(const [id,text]of [['negative','已扣款 USD -1.00'],['zero','已扣款 USD 0.00'],['exponent','已扣款 USD 1e3'],['decimal-comma','已扣款 USD 100,50'],['amount-not-an-invoice-reference','已扣款 INV123'],['mixed-currencies','已扣款 USD 100.00 清算 CNY 700.00'],['forecast-with-no-completion','预计收入 USD100'],['refund-with-no-completion','申请退款 USD100']])await check(id+'-cannot-create-a-guessed-formal-expense',async()=>assert.equal((await ingest({text,currency:'USD'})).transaction_id,''));
 await check('grouped-major-value-remains-exact',async()=>{const result=await ingest({text:'已扣款 USD 1,234.56',currency:'USD'});assert.equal(result.transaction.amount_minor,123456)});
 await check('provided-minor-cannot-conflict-with-source-major',async()=>assert.equal((await ingest({text:'已扣款 USD 100.00',currency:'USD',amount_minor:9000})).transaction_id,''));
 await check('legacy-untyped-authorization-stays-reviewable',async()=>{const result=await ingest({text:'预授权 已扣款 USD 100.00',currency:'USD'});assert.equal(result.transaction_id,'');assert.equal(result.raw_event.classification,'pending')});
 await check('explicit-account-default-is-durable-and-nonblocking',async()=>{
  await currencyPreferences(f.db,f.account.id,{revision:0,default_currency:'USD'});saved=body({text:'已扣款 $100.00'});first=(await syncFinance(f.db,f.account,saved)).operation_results[0];assert.ok(first.transaction_id);assert.equal(first.transaction.currency,'USD');assert.equal(first.transaction.amount_minor,10000);assert.equal(first.transaction.currency_review_required,true);
  const raw=await f.db.prepare('SELECT metadata_json FROM task16_finance_raw_events WHERE source_event_id=?1').bind(saved.operations[0].payload.source_event_id).first();assert.equal(JSON.parse(raw.metadata_json).currency_decision_source,'account_default');assert.equal(first.raw_event.currency_review_required,true);
 });
 await check('preference-change-and-a-new-delivery-operation-keep-the-original-default-decision',async()=>{
  await currencyPreferences(f.db,f.account.id,{revision:1,default_currency:'EUR'});const replay=structuredClone(saved);replay.operations[0].operation_id='synthetic-raw-unit-repost';const result=(await syncFinance(f.db,f.account,replay)).operation_results[0];assert.equal(result.transaction_id,first.transaction_id);assert.equal(result.raw_event.currency,'USD');
 });
 await check('old-exact-raw-receipt-stays-CNY-after-additive-upgrade',async()=>{
  const old=await fixture({before:31});try{
   const base=path.resolve(process.env.FINANCE_P04_BASELINE_ROOT||fileURLToPath(new URL('../../docs/migration-evidence/finance-p04/local/baseline-modules',import.meta.url)));
   const {syncFinance:previous}=await import(pathToFileURL(path.join(base,'p03-server-baseline/functions/_lib/task16-service.mjs')));
   const request=body({text:'已扣款 100.00'},'synthetic-old');const original=(await previous(old.db,old.account,request)).operation_results[0];assert.ok(original.transaction_id);const wire=JSON.stringify(request);
   for(const name of ['0031_finance_currency_fx.sql','0032_notification_currency_units.sql','0033_currency_default_review.sql'])await old.db.exec((await readFile(new URL('../../cloudflare/migrations/'+name,import.meta.url),'utf8')).replace(/\r?\n/g,' '));
   const replay=(await syncFinance(old.db,old.account,JSON.parse(wire))).operation_results[0];assert.equal(replay.transaction_id,original.transaction_id);assert.equal(replay.transaction.currency,'CNY');assert.equal(replay.transaction.amount_minor,10000);assert.equal((await old.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n,1);
  }finally{await old.dispose()}
 });
}finally{await f.dispose();await writeFile(new URL('raw-transport.json',outUrl),JSON.stringify({synthetic_only:true,real_product_services_and_D1:true,rows},null,2)+'\n',{flag:'wx'})}
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
