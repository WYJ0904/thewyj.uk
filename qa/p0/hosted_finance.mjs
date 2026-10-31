// Actual isolated Pages/D1 HTTP; every account and ledger below is synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {currencyDigits,moneyText,convertMinor} from '../../js/finance/money.js';
const root=path.resolve(import.meta.dirname,'../..'),base=path.join(root,'docs/migration-evidence/aeris-p0-closeout/cloud');
const label=process.argv[2];assert.match(label||'',/^[a-z0-9-]+$/);
const driverHash=createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
const out=path.join(base,label);await fs.mkdir(out);
const d=JSON.parse(await fs.readFile(path.join(base,'deployment.json'),'utf8'));
const s=JSON.parse(await fs.readFile(path.join(base,'stage.json'),'utf8'));
const origin=new URL(d.url).origin;assert.match(origin,/^https:\/\/[a-z0-9]+\.aeris-p0-finance-rc\.pages\.dev$/);
const bindings=JSON.parse(await fs.readFile(path.join(base,'verify-r1/result.json'),'utf8'));assert.equal(bindings.status,'PASS');
const users=JSON.parse(await fs.readFile(path.join(base,'private/accounts.json'),'utf8')).users;
assert.deepEqual(users.map(u=>u.id),['synthetic-p0-admin','synthetic-p0-owner']);
let token='',userId='',sequence=0;const prefix='synthetic-p0-'+randomUUID(),rows=[],requests=[];
async function request(route,body,capability='3'){
 assert.ok(route.startsWith('/api/finance/')||['/api/login','/api/logout','/api/admin/entitlement','/api/status?source=cloud'].includes(route));
 const t=performance.now();
 const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Origin:origin,...(token?{'X-Session-Token':token}:{}),...(capability?{'X-Finance-Money-Version':capability}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 requests.push({route,status:response.status,elapsed_ms:Math.round(performance.now()-t)});
 assert.ok(response.headers.get('content-type')?.includes('application/json'),'Non-JSON HTTP '+response.status+' at '+route);
 return {status:response.status,...await response.json()};
}
async function check(id,fn){try{rows.push({id,status:'PASS',actual:await fn()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}
 const currentDriverHash=createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({origin,source_commit:d.source_commit,deployment_id:d.id,checked_utc:new Date().toISOString(),driver_sha256_before:driverHash,driver_sha256_after:currentDriverHash,source_stable:driverHash===currentDriverHash,rows,requests,external_model_calls:0,formal_data_accessed:false},null,2));}
async function login(i){token='';const r=await request('/api/login',{username:users[i].username,secret:users[i].secret});assert.equal(r.status,200,r.code);assert.equal(r.account.id,users[i].id);assert.ok(r.session);token=r.session;userId=r.account.id;return {account_id:userId};}
const sync=op=>request('/api/finance/sync',{schema_version:1,device_id:'synthetic-p0-browser',platform:'web',since_version:0,operations:[op]});
await check('immutable-source-metadata',async()=>{const r=await fetch(origin+'/__preview/build.json',{redirect:'error'});assert.equal(r.status,200);assert.deepEqual(await r.json(),s.metadata);return {commit:d.source_commit,tree:s.metadata.source_tree_sha256};});
await check('public-static-exact-bytes',async()=>{const output=path.join(out,'static-proof');const r=spawnSync(process.env.P0_PYTHON||'python',[path.join(root,'qa/p0/verify_public.py'),'--out',output],{cwd:root,encoding:'utf8',windowsHide:true});
 await fs.writeFile(path.join(out,'static-proof.log'),(r.stdout||'')+(r.stderr||''),{flag:'wx'});assert.equal(r.status,0,'Read-only Python HTTPS proof failed; inspect retained per-file evidence');
 const proof=JSON.parse(await fs.readFile(path.join(output,'result.json'),'utf8'));assert.equal(proof.source_commit,d.source_commit);assert.equal(proof.deployment_id,d.id);
 assert.equal(proof.rows.length,Object.keys(s.files).filter(name=>!name.startsWith('functions/')).length);
 for(const row of proof.rows){assert.equal(row.status,'PASS',row.path);if(row.evidence_kind==='PAGES_INTERNAL_CONFIG'){assert.equal(row.path,'_headers');assert.equal(row.actual_sha256,s.files['index.html']);assert.notEqual(row.actual_sha256,s.files[row.path]);}else assert.equal(row.actual_sha256,s.files[row.path]);}return {public_files:proof.rows.filter(r=>!r.evidence_kind).length,internal_config_non_disclosure:1,transport:'Python HTTPS with verified TLS/proxy and declared application User-Agent; original failures retained'};});
await check('normal-qa-admin-authentication',()=>login(0));
if(token){
 await check('owned-user-finance-entitlement-only',async()=>{const r=await request('/api/admin/entitlement',{user_id:users[1].id,entitlement:'finance_access',allowed:true,note:'Synthetic owned P0 QA only; no formal membership changed'});assert.equal(r.status,200,r.code);return {target:users[1].id};});
 await check('ai-remains-disabled-without-model-call',async()=>{const r=await request('/api/finance/ai/config');assert.equal(r.status,200,r.code);assert.equal(r.available,false);return {available:r.available};});
 const ids=[];
 for(const currency of ['CNY','USD','EUR','HKD','GBP','JPY'])await check('six-currency-'+currency+'-edit-replay',async()=>{
  const id=prefix+'-'+currency;ids.push(id);const payload={currency,amount_minor:12345,amount_exponent:currencyDigits(currency),direction:'expense',merchant:'SYNTHETIC P0 QA',occurred_at_ms:Date.UTC(2026,9,19,12)};
  const operation={operation_id:prefix+'-create-'+(++sequence),type:'transaction.upsert',entity_id:id,base_revision:0,payload};
  const first=await sync(operation);assert.equal(first.status,200,first.code);const original=first.operation_results[0].transaction;assert.equal(original.id,id);assert.equal(original.amount_minor,12345);
  const replay=await sync(operation);assert.equal(replay.operation_results[0].idempotent_replay,true);
  const edit=await sync({...operation,operation_id:prefix+'-edit-'+(++sequence),base_revision:original.revision,payload:{...payload,amount_minor:23456}});assert.equal(edit.operation_results[0].transaction.amount_minor,23456);
  const late=await sync(operation);assert.equal(late.operation_results[0].idempotent_replay,true);
  const read=await request('/api/finance/transactions?limit=200');assert.equal(read.status,200,read.code);const row=read.transactions.find(v=>v.id===id);assert.equal(row.amount_minor,23456);assert.equal(row.currency,currency);
  if(currency==='JPY')assert.equal(row.amount_exponent,0);assert.equal(moneyText(row.amount_minor,currency),currency==='JPY'?'23456':'234.56');
  return {id,currency,amount_minor:row.amount_minor,revision:row.revision,decoded:moneyText(row.amount_minor,currency)};
 });
 await check('old-client-fails-closed',async()=>{const r=await request('/api/finance/transactions',undefined,null);assert.equal(r.status,409);assert.equal(r.code,'currency_client_upgrade_required');});
 await check('missing-currency-never-defaulted',async()=>{const r=await sync({operation_id:prefix+'-invalid',type:'transaction.upsert',entity_id:prefix+'-invalid',base_revision:0,payload:{amount_minor:100,direction:'expense',occurred_at_ms:Date.now()}});assert.equal(r.status,400);assert.equal(r.code,'currency_required');});
 await check('same-currency-jpy-exact-identity',async()=>{const r=await request('/api/finance/fx?base=JPY&quote=JPY&date=2026-10-19');assert.equal(r.status,200,r.code);assert.equal(convertMinor(100,'JPY','JPY',r.rate.rate),100);return r.rate;});
 await check('real-public-reference-fx-and-cache',async()=>{const route='/api/finance/fx?base=USD&quote=CNY&date=2026-10-19';const r=await request(route);assert.equal(r.status,200,r.code);assert.equal(r.rate.base,'USD');assert.equal(r.rate.quote,'CNY');assert.equal(r.rate.source,'Frankfurter v2 daily reference');assert.ok(r.rate.rate_timestamp.slice(0,10)<='2026-10-19');const again=await request(route);assert.equal(again.rate.id,r.rate.id);return {id:r.rate.id,source:r.rate.source,rate_timestamp:r.rate.rate_timestamp,market_reference_only:true};});
 await check('new-login-reopens-six-original-ids',async()=>{await request('/api/logout',{});await login(0);const r=await request('/api/finance/transactions?limit=200');assert.equal(r.transactions.filter(v=>ids.includes(v.id)).length,6);return {reopened:6};});
 await check('other-account-cannot-see-admin-ledger',async()=>{await login(1);const r=await request('/api/finance/transactions?limit=200');assert.equal(r.status,200,r.code);assert.equal(r.transactions.filter(v=>ids.includes(v.id)).length,0);return {owner_rows:0};});
 await request('/api/logout',{});
}
console.log(JSON.stringify({counts:rows.reduce((r,x)=>(r[x.status]=(r[x.status]||0)+1,r),{}),requests:requests.length,source_commit:d.source_commit}));process.exitCode=rows.some(r=>r.status!=='PASS')?1:0;
