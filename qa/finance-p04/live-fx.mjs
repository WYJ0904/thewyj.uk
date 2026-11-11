// Public reference rates only; no credentials, real finance data or deployment.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {EnvHttpProxyAgent,fetch as proxyFetch} from 'undici';
import {frankfurterRate,referenceRate,transactionReferences} from '../../functions/_lib/finance-fx.mjs';
import {convertMinor} from '../../js/finance/money.js';
import {fixture} from './fixture.mjs';
import {outUrl} from './output.mjs';
const agent=new EnvHttpProxyAgent(),rows=[],transport=[];
const now=Date.now(),date='2026-10-19';let f;
const fetcher=async(url,options)=>{
  const started=new Date().toISOString();
  try {
    const response=await proxyFetch(url,{...options,dispatcher:agent});const body=await response.text();
    transport.push({url,started_utc:started,finished_utc:new Date().toISOString(),status:response.status,content_type:response.headers.get('content-type'),body,sha256:createHash('sha256').update(body).digest('hex')});
    return new Response(body,{status:response.status,headers:response.headers});
  }catch(error){transport.push({url,started_utc:started,error:String(error),cause:String(error.cause||'')});throw error}
};
async function check(id,run){try{const actual=await run();rows.push({id,status:'PASS',actual});console.log('PASS',id)}catch(error){const status=error.code==='fx_provider_unavailable'?'BLOCKED':'FAIL';rows.push({id,status,error:error.stack,code:error.code});console.log(status,id)}}
try {
  for(const currency of ['USD','EUR','HKD','GBP','JPY'])for(const [base,quote] of [[currency,'CNY'],['CNY',currency]])
    await check(`LIVE-${base}-${quote}-official-product-adapter`,async()=>{
      const row=await frankfurterRate(base,quote,date,{fetcher,now});assert.equal(row.base,base);assert.equal(row.quote,quote);assert.equal(row.requested_date,date);
      assert.ok(row.rate_timestamp.slice(0,10)<=date);assert.ok(Number.isSafeInteger(convertMinor(10000,base,quote,row.rate)));return row;
    });
  await check('LIVE-weekend-resolves-prior-business-reference-date',async()=>{
    const row=await frankfurterRate('USD','CNY','2026-10-18',{fetcher,now});assert.ok(row.rate_timestamp.slice(0,10)<='2026-10-18');return row;
  });
  await check('LIVE-real-D1-cache-and-immutable-historical-reference',async()=>{
    f=await fixture();const tx=await f.transaction('USD',10000),options={fetcher,now};
    const rate=await referenceRate(f.db,'USD','CNY',date,options),calls=transport.length;
    assert.equal((await referenceRate(f.db,'USD','CNY',date,options)).id,rate.id);assert.equal(transport.length,calls);
    const first=await transactionReferences(f.db,f.account.id,{transaction_ids:[tx.id],display_currency:'CNY'},options);
    const key=`${tx.id}:${tx.revision}:CNY`,historical=first.references[key];assert.ok(historical);assert.equal(historical.original_minor,10000);
    const again=await transactionReferences(f.db,f.account.id,{transaction_ids:[tx.id],display_currency:'CNY'},options);
    assert.deepEqual(again.references[key],historical);assert.equal(transport.length,calls);
    const ledger=await f.db.prepare('SELECT currency,amount_minor FROM task16_finance_transactions WHERE id=?1').bind(tx.id).first();assert.deepEqual(ledger,{currency:'USD',amount_minor:10000});
    return{rate,historical,cache_hit_without_network:true,original_ledger:ledger};
  });
}finally{
  if(f)await f.dispose();await agent.close();
  await writeFile(new URL('live-fx.json',outUrl),JSON.stringify({scope:'Actual public Frankfurter v2 via existing environment proxy and product adapter; synthetic ledger only; reference rates are not execution rates',checked_at:new Date().toISOString(),rows,transport},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,BLOCKED:rows.filter(r=>r.status==='BLOCKED').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));
if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
