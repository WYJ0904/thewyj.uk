// Only the newly owned QA deployment and generated synthetic accounts may be used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {currencyDigits,moneyText} from '../../../js/finance/money.js';

const root=path.resolve(import.meta.dirname,'../../..');
const out=path.join(root,'docs/migration-evidence/finance-p04/closure-current');
const origin='https://finance-p03-p04-qa.thewyj-finance-qa.pages.dev';
const attempt=process.argv[2]||'r2'; assert.match(attempt,/^r[0-9]+$/);
const target=path.join(out,'hosted-http-'+attempt+'.json');
await fs.access(target).then(()=>{throw Error('Preserve prior run');},()=>{});
const binding=JSON.parse(await fs.readFile(path.join(out,'hosted-bindings-after-fix/result.json'),'utf8'));
assert.deepEqual(binding.database_ids,['c2eb978f-9f49-4e4c-8286-f6b398fae0de']);
assert.equal(binding.root_configuration_unchanged,true);
const accounts=JSON.parse(await fs.readFile(path.join(out,'private/qa-accounts.json'),'utf8'));
const rows=[], requests=[];
const started=new Date().toISOString();
const prefix='synthetic-hosted-p04-'+randomUUID();
let token='', userId='', sequence=0;
async function request(route,body,capability='3'){
  assert.ok(route.startsWith('/api/finance/')||route==='/api/login'||route==='/api/logout');
  const start=performance.now();
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',redirect:'error',
    signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Origin:origin,
      ...(token?{'X-Session-Token':token}:{}),...(capability?{'X-Finance-Money-Version':capability}:{})},
    body:body===undefined?undefined:JSON.stringify(body)});
  requests.push({route,status:response.status,ms:Math.round(performance.now()-start)});
  // Do not inspect proxy/error response headers or bodies to work around a denied request.
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error(`BLOCKED non-JSON HTTP ${response.status} at ${route}`);
  return {status:response.status,...await response.json()};
}
async function check(id,run){try{const actual=await run();rows.push({id,status:'PASS',actual});}
  catch(error){rows.push({id,status:error.message.startsWith('BLOCKED')?'BLOCKED':'FAIL',error:error.stack});}
  await fs.writeFile(target,JSON.stringify({started,finished:new Date().toISOString(),origin,prefix,rows,requests,
    scope:'Generated synthetic accounts and records only; no real WeChat, formal user or Production data',credentials_logged:false},null,2),{flag:'w'});
}
async function login(index){token='';const response=await request('/api/login',{username:accounts[index].username,secret:accounts[index].secret});
  assert.equal(response.status,200,response.code);assert.equal(response.account.id,accounts[index].id);
  assert.ok(response.session);token=response.session;userId=response.account.id;return {account_id:userId};}
async function sync(operation){return request('/api/finance/sync',{schema_version:1,device_id:'synthetic-hosted-p04',platform:'web',since_version:0,operations:[operation]});}

await check('hosted-normal-authentication',()=>login(0));
if(token){
  const ids=[];
  for(const currency of ['CNY','USD','EUR','HKD','GBP','JPY']){
    await check(`hosted-${currency}-persist-manual-edit-and-exact-replay`,async()=>{
      const id=prefix+'-'+currency;ids.push(id);
      const payload={currency,amount_minor:12345,direction:'expense',merchant:'SYNTHETIC QA',occurred_at_ms:Date.now(),amount_exponent:currency==='JPY'?0:2};
      const operation={operation_id:prefix+'-create-'+(++sequence),type:'transaction.upsert',entity_id:id,base_revision:0,payload};
      const first=await sync(operation);assert.equal(first.status,200,first.code);
      const original=first.operation_results[0];assert.equal(original.transaction.id,id);assert.equal(original.transaction.amount_minor,12345);
      const replay=await sync(operation);assert.equal(replay.operation_results[0].idempotent_replay,true);
      const edit={...operation,operation_id:prefix+'-edit-'+(++sequence),base_revision:original.transaction.revision,payload:{...payload,amount_minor:23456}};
      const updated=await sync(edit);assert.equal(updated.operation_results[0].transaction.amount_minor,23456);
      // A late original delivery cannot overwrite the user's newer amount.
      const late=await sync(operation);assert.equal(late.operation_results[0].idempotent_replay,true);
      const read=await request('/api/finance/transactions?limit=200');assert.equal(read.status,200);
      const row=read.transactions.find(value=>value.id===id);assert.equal(row.amount_minor,23456);assert.equal(row.currency,currency);
      // publicTransaction intentionally emits the unit field only for JPY.
      // Other currencies have their ISO unit; remote D1 storage is checked separately.
      if(currency==='JPY')assert.equal(row.amount_exponent,0);
      else assert.equal(row.amount_exponent,undefined);
      assert.equal(currencyDigits(row.currency),currency==='JPY'?0:2);
      assert.equal(moneyText(row.amount_minor,row.currency),currency==='JPY'?'23456':'234.56');
      return {id,currency,amount_minor:row.amount_minor,amount_exponent:row.amount_exponent??null,
        decoded_amount:moneyText(row.amount_minor,row.currency),revision:row.revision,original_operation_retained:true};
    });
  }
  await check('hosted-legacy-client-fails-closed-for-jpy',async()=>{
    const result=await request('/api/finance/transactions',undefined,null);assert.equal(result.status,409);assert.equal(result.code,'currency_client_upgrade_required');
  });
  await check('hosted-unknown-currency-never-defaults-to-cny',async()=>{
    const result=await sync({operation_id:prefix+'-invalid',type:'transaction.upsert',entity_id:prefix+'-invalid',base_revision:0,
      payload:{amount_minor:100,direction:'expense',occurred_at_ms:Date.now()}});
    assert.equal(result.status,400);assert.equal(result.code,'currency_required');
  });
  await check('hosted-new-login-reopens-persisted-ledger',async()=>{
    await request('/api/logout',{});await login(0);
    const read=await request('/api/finance/transactions?limit=200');assert.equal(read.status,200);
    assert.equal(read.transactions.filter(value=>ids.includes(value.id)).length,6);
    return {reopened_records:6};
  });
  await check('hosted-other-account-cannot-see-owner-ledger',async()=>{
    await login(1);const read=await request('/api/finance/transactions?limit=200');assert.equal(read.status,200);assert.ok(!read.transactions.some(value=>ids.includes(value.id)));
    return {other_account_read:true,owner_rows_visible:0};
  });
}
console.log(JSON.stringify({rows:rows.length,counts:rows.reduce((acc,row)=>(acc[row.status]=(acc[row.status]||0)+1,acc),{}),requests:requests.length}));
process.exitCode=rows.some(row=>row.status!=='PASS')?1:0;
