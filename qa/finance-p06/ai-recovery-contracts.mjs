import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
import {financeAiRequest} from '../../functions/_lib/finance-ai.mjs';
import {dumpD1,restoreD1} from '../finance-p03/phase-a/d1-snapshot.mjs';
import {Miniflare} from 'miniflare';
const out=path.resolve(process.env.FINANCE_P06_OUTPUT);assert(out.startsWith(path.join(root,'docs/migration-evidence/finance-p06')+path.sep));await fs.mkdir(out,{recursive:false});
const rows=[];async function test(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(e){rows.push({id,status:'FAIL',error:e.stack});}}
const f=await fixture();let calls=0,restored;
const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:'@cf/synthetic/recovery',FINANCE_AI_MODEL_VERSION:'recovery-1',FINANCE_AI_DAILY_CALL_LIMIT:'100',FINANCE_AI_MONTHLY_CALL_LIMIT:'100',FINANCE_AI_USER_DAILY_CALL_LIMIT:'100',AI:{run:async(model,input)=>{calls++;const p=JSON.parse(input.messages[1].content);return {response:{schema_version:2,amount_roles:p.candidates.map((c,i)=>({candidate_id:c.id,role:['actual_paid','original','discount'][i]})),selected_candidate_id:'m0',currency:p.currency,direction:p.direction,confidence_per_mille:950,refusal_reason:'none',merchant_normalized:null,category:'other'}};}}};
const req=(route,body,account=f.account)=>financeAiRequest({env},account,'/api/finance/ai/'+route,body);
async function seed(id){
 const reference='SYNTH-P06-RCV-'+(await sha256Hex(id)).slice(0,16);const t=Date.now();
 await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-recovery-device',hints:[{source_event_id:id,source_package:'com.tencent.mm',source_type:'notification',app_label:'SYNTHETIC',amount_minor:null,direction:'expense',currency:'CNY',amount_exponent:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:reference,payment_channel:'wechat',evidence:{reasons:['synthetic_p06_recovery']}}]});
 const evidence={schema_version:1,source_uid:10390,completion_proven:true,direction:'expense',currency:'CNY',captured_at_ms:t,expires_at_ms:t+90000,provider_reference_hash:await sha256Hex(reference),merchant_tokens:[],candidates:[9000,10000,1000].map((amount_minor,i)=>({id:'m'+i,amount_minor,currency:'CNY',amount_exponent:2,phrases:[['本次','扣除'],['原价'],['优惠']][i]}))};
 return req('evidence',{event_id:id,evidence});
}
try{
 await req('consent',{enabled:true,expected_revision:0});
 for(const key of ['FINANCE_AI_DAILY_CALL_LIMIT','FINANCE_AI_MONTHLY_CALL_LIMIT','FINANCE_AI_USER_DAILY_CALL_LIMIT'])await test('zero-'+key,async()=>{
  const id='zero-'+key;await seed(id);env[key]='0';const before=calls,r=await req('suggest',{event_id:id});assert.equal(calls,before);assert.equal(r.error_code,'finance_ai_budget_exhausted');assert.equal((await f.db.prepare('SELECT attempts FROM finance_ai_observations WHERE source_event_id=?1').bind(id).first()).attempts,0);env[key]='100';
 });
 await test('quota-restored-unbilled-denial-retries-exactly-once',async()=>{const id='zero-FINANCE_AI_MONTHLY_CALL_LIMIT';const before=calls;assert.equal((await req('suggest',{event_id:id})).status,'suggestion');assert.equal(calls,before+1);assert.equal((await req('suggest',{event_id:id})).status,'suggestion');assert.equal(calls,before+1);});
 for(const value of ['-1','1.5','NaN','Infinity','01'])await test('invalid-limit-fails-closed-'+value,async()=>{env.FINANCE_AI_DAILY_CALL_LIMIT=value;assert.equal((await req('config',{})).available,false);env.FINANCE_AI_DAILY_CALL_LIMIT='100';});
 await test('cross-account-cannot-read-an-observation',async()=>{
  const other={id:'synthetic-other-owner'},at=new Date().toISOString();
  await f.db.prepare("INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)").bind(other.id,at).run();
  await req('consent',{enabled:true,expected_revision:0},other);const before=calls;await assert.rejects(()=>req('suggest',{event_id:'zero-FINANCE_AI_MONTHLY_CALL_LIMIT'},other));assert.equal(calls,before);
 });
 await test('cold-d1-restore-reuses-decision-without-provider',async()=>{
  const snapshot=await dumpD1(f.db);restored=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic recovery")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});const db=await restored.getD1Database('DB');await restoreD1(db,snapshot);const before=calls;
  const value=await financeAiRequest({env:{...env,WYJ_DB:db}},f.account,'/api/finance/ai/suggest',{event_id:'zero-FINANCE_AI_MONTHLY_CALL_LIMIT'});assert.equal(value.status,'suggestion');assert.equal(calls,before);
 });
 await test('orphaned-running-decision-terminates-without-a-second-call',async()=>{
  const id='orphan-running';await seed(id);const before=calls;const completed=await req('suggest',{event_id:id});assert.equal(calls,before+1);
  await f.db.prepare("UPDATE finance_ai_decisions SET status='running',result_json='',created_at=?2,updated_at=?2 WHERE hint_id=?1").bind(completed.canonical_hint_id,new Date(Date.now()-60000).toISOString()).run();
  const recovered=await req('suggest',{event_id:id});assert.equal(recovered.status,'timed_out');assert.equal(recovered.error_code,'finance_ai_interrupted');assert.equal(recovered.suggestion,null);assert.equal(calls,before+1);
 });
 await test('current-running-claim-is-not-replaced-or-retried',async()=>{
  const id='current-running';await seed(id);const completed=await req('suggest',{event_id:id});const before=calls;
  await f.db.prepare("UPDATE finance_ai_decisions SET status='running',result_json='',created_at=?2,updated_at=?2 WHERE hint_id=?1").bind(completed.canonical_hint_id,new Date().toISOString()).run();assert.equal((await req('suggest',{event_id:id})).status,'running');assert.equal(calls,before);
 });
 await test('no-recovery-case-writes-financial-facts',async()=>{assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task21_notification_pending_hints WHERE amount_minor IS NOT NULL').first()).n,0);});
}finally{if(restored)await restored.dispose();await f.dispose();}
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,mock_model_calls:calls,scope:'Actual local product service/D1 and cold logical restore; controlled mock model; no financial ledger inserts'},null,2));console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
