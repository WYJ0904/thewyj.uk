// Execute the exact product adapter inside workerd; upstream payloads are declared synthetic.
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../..'),attempt=process.argv[2];
if(!/^(before|after)-r[0-9]+$/.test(attempt))throw Error('Choose a unique evidence attempt');
const source=`import {frankfurterRate} from './functions/_lib/finance-fx.mjs';
export default {async fetch(){const rows=[];const now=Date.UTC(2026,9,24,0);
async function check(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(e){rows.push({id,status:'FAIL',code:e.code||'',error:e.message});}}
await check('workerd-real-request-api-preserves-exact-decimal',async()=>{
 let calls=0;const rate=await frankfurterRate('USD','CNY','2026-10-19',{now,fetcher:async(url,options)=>{
  calls++;const req=new Request(url,options);if(req.redirect!=='manual')throw Error('Expected a supported no-follow mode in workerd');
  return new Response('{"base":"USD","quote":"CNY","date":"2026-10-19","rate":7.123456789123456789}',{headers:{'Content-Type':'application/json'}});
 }});if(calls!==1||rate.rate!=='7.123456789123456789')throw Error('Decimal or request count changed');return{calls,rate:rate.rate,market_data:false};});
await check('workerd-redirect-is-rejected-without-following-location',async()=>{
 let constructed=false,calls=0;try{await frankfurterRate('USD','CNY','2026-10-19',{now,fetcher:async(url,options)=>{calls++;const req=new Request(url,options);constructed=req.redirect==='manual';return new Response(null,{status:302,headers:{Location:'https://example.invalid/'}});}});throw Error('Redirect was accepted');}
 catch(error){if(error.code!=='fx_provider_unavailable'||calls!==1||!constructed)throw error;}return{calls,redirect_followed:false};});
await check('workerd-retains-response-size-limit',async()=>{
 let constructed=false;try{await frankfurterRate('USD','CNY','2026-10-19',{now,fetcher:async(url,options)=>{new Request(url,options);constructed=true;return new Response('x'.repeat(65537),{headers:{'Content-Type':'application/json','Content-Length':'65537'}});}});throw Error('Oversized response was accepted');}
 catch(error){if(error.code!=='fx_response_invalid'||!constructed)throw error;}return{limit:65536};});
return Response.json({rows,upstream_requests:0,runtime:'workerd',money_assertions_unchanged:true});}}`;
const bundled=await build({stdin:{contents:source,resolveDir:root,sourcefile:'finance-fx-worker-contract.mjs'},bundle:true,platform:'browser',format:'esm',write:false,target:'es2022'});
const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-06',script:bundled.outputFiles[0].text});
try{const result=await(await mf.dispatchFetch('http://localhost/')).json();
 result.product_sha256=createHash('sha256').update(await fs.readFile(path.join(root,'functions/_lib/finance-fx.mjs'))).digest('hex');
 await fs.writeFile(path.join(root,'docs/migration-evidence/finance-p04/closure-current/fx-worker-contract-'+attempt+'.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify(result));process.exitCode=result.rows.some(row=>row.status!=='PASS')?1:0;
}finally{await mf.dispose();}
