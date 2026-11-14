import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {convertMinor} from '../../../js/finance/money.js';
const out=path.resolve(import.meta.dirname,'../../../docs/migration-evidence/finance-p04/closure-current');
const target=path.join(out,'hosted-fx-r1.json');
await fs.access(target).then(()=>{throw Error('Preserve prior run');},()=>{});
const origin='https://finance-p03-p04-qa.thewyj-finance-qa.pages.dev';
const account=JSON.parse(await fs.readFile(path.join(out,'private/qa-accounts.json'),'utf8'))[0];
const rows=[];let token='',rate=null;
async function request(route,body){assert.ok(route==='/api/login'||route.startsWith('/api/finance/'));
 const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{'Content-Type':'application/json',Origin:origin,'X-Finance-Money-Version':'3',...(token?{'X-Session-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('BLOCKED non-JSON HTTP '+response.status);
 return{status:response.status,...await response.json()};}
async function check(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(error){rows.push({id,status:error.message.startsWith('BLOCKED')?'BLOCKED':'FAIL',error:error.stack});}
 await fs.writeFile(target,JSON.stringify({origin,checked_at:new Date().toISOString(),rows,scope:'Actual hosted public reference adapter/cache and generated synthetic history only; not a payment execution rate'},null,2));}
await check('normal-qa-login',async()=>{const result=await request('/api/login',{username:account.username,secret:account.secret});assert.equal(result.status,200);assert.equal(result.account.id,account.id);token=result.session;});
if(token){
 await check('hosted-reference-pair-source-date-and-cache',async()=>{
  const first=await request('/api/finance/fx?base=USD&quote=CNY&date=2026-10-19');assert.equal(first.status,200,first.code);rate=first.rate;
  const again=await request('/api/finance/fx?base=USD&quote=CNY&date=2026-10-19');assert.equal(again.status,200);assert.equal(again.rate.id,rate.id);
  assert.equal(rate.base,'USD');assert.equal(rate.quote,'CNY');assert.ok(rate.source.includes('frankfurter'));assert.ok(rate.rate_timestamp.slice(0,10)<='2026-10-19');return rate;
 });
 await check('hosted-same-currency-is-exact-identity',async()=>{const result=await request('/api/finance/fx?base=JPY&quote=JPY&date=2026-10-19');assert.equal(result.status,200,result.code);assert.equal(convertMinor(100,'JPY','JPY',result.rate.rate),100);return result.rate;});
 if(rate)await check('hosted-history-reference-does-not-mutate-original-or-create-another-ledger-row',async()=>{
  const id='synthetic-hosted-fx-'+randomUUID();const operation={operation_id:id+'-op',type:'transaction.upsert',entity_id:id,base_revision:0,
   payload:{currency:'USD',amount_minor:10000,amount_exponent:2,direction:'expense',merchant:'SYNTHETIC FX QA',occurred_at_ms:Date.UTC(2026,9,19,12)}};
  const result=await request('/api/finance/sync',{schema_version:1,device_id:'synthetic-hosted-fx',platform:'web',since_version:0,operations:[operation]});assert.equal(result.status,200,result.code);
  const transaction=result.operation_results[0].transaction;
  const before=await request('/api/finance/transactions?limit=200');
  const first=await request('/api/finance/references?ids='+encodeURIComponent(id)+'&display_currency=CNY');assert.equal(first.status,200,first.code);
  const key=id+':'+transaction.revision+':CNY',reference=first.references[key];assert.ok(reference);assert.equal(reference.original_minor,10000);
  assert.equal(reference.converted_minor,convertMinor(10000,'USD','CNY',rate.rate));
  const again=await request('/api/finance/references?ids='+encodeURIComponent(id)+'&display_currency=CNY');assert.deepEqual(again.references[key],reference);
  const after=await request('/api/finance/transactions?limit=200');assert.deepEqual(after.transactions,before.transactions);return{transaction_id:id,reference};
 });
}
console.log(JSON.stringify({rows:rows.length,counts:rows.reduce((r,x)=>(r[x.status]=(r[x.status]||0)+1,r),{})}));
process.exitCode=rows.some(row=>row.status!=='PASS')?1:0;
