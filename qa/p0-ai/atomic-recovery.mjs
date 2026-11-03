import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';
import {financeAiRequest} from '../../functions/_lib/finance-ai.mjs';
import {dumpD1,restoreD1} from '../finance-p03/phase-a/d1-snapshot.mjs';
const label=process.env.AERIS_P0_AI_LABEL;assert(/^r[1-9][0-9]*$/.test(label||''));
const out=path.join(root,'docs/migration-evidence/p0-ai','atomic-recovery-'+label);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
const rows=[];async function test(id,body){try{rows.push({id,status:'PASS',actual:await body()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
let calls=0;
async function setup(){
 const f=await fixture();
 const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:'@cf/synthetic/p0-atomic',FINANCE_AI_MODEL_VERSION:'p0-atomic-1',FINANCE_AI_DAILY_CALL_LIMIT:'100',FINANCE_AI_MONTHLY_CALL_LIMIT:'100',FINANCE_AI_USER_DAILY_CALL_LIMIT:'100',AI:{run:async(model,wire)=>{calls++;const p=JSON.parse(wire.messages[1].content);return {response:{schema_version:2,amount_roles:p.candidates.map((c,i)=>({candidate_id:c.id,role:['actual_paid','original','discount'][i]})),selected_candidate_id:'m0',currency:p.currency,direction:p.direction,confidence_per_mille:950,refusal_reason:'none',merchant_normalized:null,category:null}};}}};
 const req=(route,body,extra={})=>financeAiRequest({env:{...env,...extra}},f.account,'/api/finance/ai/'+route,body);
 await req('consent',{enabled:true,expected_revision:0});
 async function seed(id){const reference='SYNTH-'+id,t=Date.now();await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-p0-atomic',hints:[{source_event_id:id,source_package:'com.tencent.mm',source_type:'notification',app_label:'SYNTHETIC',amount_minor:null,direction:'expense',currency:'CNY',amount_exponent:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:reference,payment_channel:'wechat',evidence:{reasons:['synthetic_p0_atomic']}}]});
  const input={schema_version:1,source_uid:10390,completion_proven:true,direction:'expense',currency:'CNY',captured_at_ms:t,expires_at_ms:t+90000,provider_reference_hash:await sha256Hex(reference),merchant_tokens:[],candidates:[9000,10000,1000].map((amount_minor,i)=>({id:'m'+i,amount_minor,currency:'CNY',amount_exponent:2,phrases:[['本次','扣除'],['原价'],['优惠']][i]}))};
  assert.equal((await req('evidence',{event_id:id,evidence:input})).status,'evidence_ready');}
 return {...f,env,req,seed};
}
await test('month-limit-concurrent-events-do-not-spend-unused-day-quota',async()=>{
 const f=await setup();try{f.env.FINANCE_AI_MONTHLY_CALL_LIMIT='2';for(let i=0;i<5;i++)await f.seed('parallel-'+i);const before=calls;
  const answers=await Promise.all(Array.from({length:5},(_,i)=>f.req('suggest',{event_id:'parallel-'+i})));assert.equal(calls-before,2);assert.equal(answers.filter(a=>a.status==='suggestion').length,2);
  const budgets=(await f.db.prepare('SELECT reserved_calls,provider_calls FROM finance_ai_budgets').all()).results;assert.equal(budgets.length,4);assert(budgets.every(b=>b.reserved_calls===2&&b.provider_calls===2));return {mock_calls:2,buckets:4};
 }finally{await f.dispose();}});
await test('same-event-across-model-versions-still-has-two-total-attempts',async()=>{
 const f=await setup();try{await f.seed('event-budget');const before=calls;
  await Promise.all(Array.from({length:4},(_,i)=>f.req('suggest',{event_id:'event-budget'},{FINANCE_AI_MODEL_VERSION:'version-'+i})));
  assert.equal(calls-before,2);assert.equal((await f.db.prepare('SELECT attempts FROM finance_ai_observations').first()).attempts,2);
  const budgets=(await f.db.prepare('SELECT reserved_calls,provider_calls FROM finance_ai_budgets').all()).results;assert(budgets.every(b=>b.reserved_calls===2&&b.provider_calls===2));return {mock_calls:2};
 }finally{await f.dispose();}});
await test('late-storage-constraint-failure-rolls-back-all-earlier-budget-writes',async()=>{
 const f=await setup();try{await f.seed('storage-fault');const before=calls;
  await f.db.exec("CREATE TRIGGER synthetic_p0_budget_abort BEFORE UPDATE OF attempts ON finance_ai_observations BEGIN SELECT RAISE(ABORT,'synthetic_private_storage_fault: finance_ai_budget_exhausted'); END");
  const value=await f.req('suggest',{event_id:'storage-fault'});assert.equal(calls,before);assert.equal(value.error_code,'finance_ai_provider_unavailable');assert(!JSON.stringify(value).includes('synthetic_private'));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM finance_ai_budgets').first()).n,0);assert.equal((await f.db.prepare('SELECT attempts FROM finance_ai_observations').first()).attempts,0);
  return {failed_transaction:true,partial_budget_rows:0,provider_calls:0};
 }finally{await f.dispose();}});
await test('new-input-during-reservation-does-not-spend-any-budget',async()=>{
 const f=await setup();try{await f.seed('stale-reserve');const before=calls;let changed=false;
  const db={prepare:f.db.prepare.bind(f.db),batch:async statements=>{
   if(statements.length===5&&!changed){changed=true;await f.db.prepare('UPDATE finance_ai_observations SET input_digest=?1').bind('f'.repeat(64)).run();}
   return f.db.batch(statements);
  }};
  const value=await f.req('suggest',{event_id:'stale-reserve'},{WYJ_DB:db});
  assert(changed);assert.equal(value.error_code,'finance_ai_event_budget_exhausted');assert.equal(calls,before);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM finance_ai_budgets').first()).n,0);
  assert.equal((await f.db.prepare('SELECT attempts FROM finance_ai_observations').first()).attempts,0);
  return {actual_d1_interleaving:true,partial_budget_rows:0,provider_calls:0};
 }finally{await f.dispose();}});
await test('old-unbilled-denial-gets-a-fresh-running-lease-on-retry',async()=>{
 const f=await setup();let pending,release;try{await f.seed('old-denial');const date=new Date().toISOString();f.env.FINANCE_AI_MONTHLY_CALL_LIMIT='1';
  await f.db.prepare("INSERT INTO finance_ai_budgets(period_key,scope_key,reserved_calls,provider_calls,updated_at)VALUES(?1,'global',1,1,?2)").bind('month:'+date.slice(0,7),date).run();
  assert.equal((await f.req('suggest',{event_id:'old-denial'})).error_code,'finance_ai_budget_exhausted');
  const old=new Date(Date.now()-60000).toISOString();await f.db.prepare('UPDATE finance_ai_decisions SET created_at=?1,updated_at=?1').bind(old).run();
  f.env.FINANCE_AI_MONTHLY_CALL_LIMIT='2';const before=calls,baseRun=f.env.AI.run;let started;
  const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.env.AI.run=async(...args)=>{const result=await baseRun(...args);started();await gate;return result;};
  pending=f.req('suggest',{event_id:'old-denial'});await Promise.race([ready,pending.then(()=>{throw new Error('retry ended before provider dispatch');})]);
  const whileRunning=await f.req('suggestions',{event_id:'old-denial'});
  release();const completed=await pending;
  assert.equal(whileRunning.status,'running');assert.equal(completed.status,'suggestion');assert.equal(calls,before+1);
  assert.equal((await f.db.prepare('SELECT created_at FROM finance_ai_decisions').first()).created_at,old);
  assert.equal((await f.req('suggest',{event_id:'old-denial'})).status,'suggestion');assert.equal(calls,before+1);
  return {concurrent_read:true,original_created_at_preserved:true,mock_calls:1};
 }finally{release?.();if(pending)await pending;await f.dispose();}});
await test('cold-backup-restores-denied-quota-without-inventing-a-spent-attempt',async()=>{
 const f=await setup();let restored;try{await f.seed('restore-denied');const date=new Date().toISOString();f.env.FINANCE_AI_MONTHLY_CALL_LIMIT='1';
  await f.db.prepare("INSERT INTO finance_ai_budgets(period_key,scope_key,reserved_calls,provider_calls,updated_at)VALUES(?1,'global',1,1,?2)").bind('month:'+date.slice(0,7),date).run();assert.equal((await f.req('suggest',{event_id:'restore-denied'})).error_code,'finance_ai_budget_exhausted');
  const snapshot=await dumpD1(f.db);await fs.writeFile(path.join(out,'denied-quota-logical-backup.json'),JSON.stringify(snapshot));
  restored=new Miniflare({modules:true,script:'export default{fetch(){return new Response("synthetic AI backup restore")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});const db=await restored.getD1Database('DB');await restoreD1(db,snapshot);
  const before=calls;const value=await financeAiRequest({env:{...f.env,WYJ_DB:db,FINANCE_AI_MONTHLY_CALL_LIMIT:'2'}},f.account,'/api/finance/ai/suggest',{event_id:'restore-denied'});
  assert.equal(value.status,'suggestion');assert.equal(calls,before+1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,0);return {actual_engine_logical_restore:true,real_user_backup:false};
 }finally{if(restored)await restored.dispose();await f.dispose();}});
for(const kind of ['budget','attempt'])await test('unsupported-schema-without-'+kind+'-check-disables-inference',async()=>{
 const f=await setup();try{
  if(kind==='budget')await f.db.exec("DROP TABLE finance_ai_budgets; CREATE TABLE finance_ai_budgets(period_key TEXT NOT NULL,scope_key TEXT NOT NULL,reserved_calls INTEGER NOT NULL DEFAULT 0,provider_calls INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(period_key,scope_key))");
  else await f.db.exec("DROP TABLE finance_ai_observations; CREATE TABLE finance_ai_observations(user_id TEXT NOT NULL,hint_id TEXT NOT NULL,source_event_id TEXT NOT NULL,input_digest TEXT NOT NULL,anchor_digest TEXT NOT NULL,input_json TEXT NOT NULL,expires_at_ms INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,hint_id))");
  const before=calls;assert.equal((await f.req('config',{})).available,false);assert.equal((await f.req('suggest',{event_id:'not-used'})).status,'disabled');assert.equal(calls,before);return {malformed_synthetic_schema_only:true};
 }finally{await f.dispose();}});
for(const token of ['comment','string','quoted-identifier'])await test('schema-'+token+'-cannot-stand-in-for-budget-check',async()=>{
 const f=await setup();try{
  const fakeCheck=token==='comment'?'/* CHECK(reserved_calls >= 0) */':token==='string'?",schema_note TEXT DEFAULT 'CHECK(reserved_calls >= 0)'":',"CHECK(reserved_calls >= 0)" TEXT';
  await f.db.exec('DROP TABLE finance_ai_budgets; CREATE TABLE finance_ai_budgets(period_key TEXT NOT NULL,scope_key TEXT NOT NULL,reserved_calls INTEGER NOT NULL DEFAULT 0,provider_calls INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL'+fakeCheck+',PRIMARY KEY(period_key,scope_key))');
  const before=calls;assert.equal((await f.req('config',{})).available,false);assert.equal((await f.req('suggest',{event_id:'not-used'})).status,'disabled');assert.equal(calls,before);
  return {malformed_synthetic_schema_only:true,provider_calls:0};
 }finally{await f.dispose();}});
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,mock_provider_calls:calls,external_model_calls:0,production_operations:0,scope:'Actual Miniflare/D1, local controlled model; no real provider, account or database'},null,2));
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length,out}));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
