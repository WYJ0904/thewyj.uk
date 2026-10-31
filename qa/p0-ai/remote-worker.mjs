// Dedicated, temporary QA Worker. Never add these routes to the Pages app.
import {financeAiRequest} from '../../functions/_lib/finance-ai.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';

const DATABASES=new Set(['08ced2a0-6f77-4550-a34e-2b20fd7119db','43285c83-06f1-479f-a381-bf37fd26ddb2']);
const CASES=new Set(['quota','concurrent-month','event-cap','late-storage-fault','retry-lease']);
const MODE='isolated-synthetic-only';
const MARKER='aeris-p0-ai-isolated-only';
class QaFailure extends Error {}
const check=(value,code)=>{if(!value)throw new QaFailure(code);};
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});

function authorized(request,env){
  const expected=env.P0_AI_QA_TOKEN,header=request.headers.get('authorization')||'';
  if(typeof expected!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(expected)||!header.startsWith('Bearer '))return false;
  const received=header.slice(7);
  return /^[A-Za-z0-9_-]{43,128}$/.test(received)&&received.length===expected.length&&crypto.subtle.timingSafeEqual(new TextEncoder().encode(received),new TextEncoder().encode(expected));
}

// Change bound period keys only. The product's five SQL statements and D1
// batch implementation are unchanged; global quota rows cannot mix QA runs.
function namespacedDatabase(db,prefix){
  return {batch:statements=>db.batch(statements),prepare(sql){
    const statement=db.prepare(sql);
    if(!/\bfinance_ai_budgets\b/.test(sql))return statement;
    return {
      bind:(...values)=>statement.bind(...values.map(value=>typeof value==='string'&&/^(day|month):/.test(value)?prefix+':'+value:value)),
      all:()=>statement.all(),first:()=>statement.first(),run:()=>statement.run(),raw:options=>statement.raw(options),
    };
  }};
}

async function runCase(db,name){
  const nonce=crypto.randomUUID().replaceAll('-',''),prefix='synthetic-p0-ai-'+nonce;
  const account={id:prefix,role:'user',entitlements:['finance_access']},scoped=namespacedDatabase(db,prefix);
  let calls=0,hook=null,trigger='',detail=null,errorCode='',cleanup=true;
  const env={WYJ_DB:scoped,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',
    FINANCE_AI_MODEL:'@cf/synthetic/p0-remote-qa',FINANCE_AI_MODEL_VERSION:'p0-remote-qa-1',FINANCE_AI_TIMEOUT_MS:'10000',
    FINANCE_AI_DAILY_CALL_LIMIT:'100',FINANCE_AI_MONTHLY_CALL_LIMIT:'100',FINANCE_AI_USER_DAILY_CALL_LIMIT:'100',
    AI:{run:async(model,wire)=>{
      check(model==='@cf/synthetic/p0-remote-qa','unexpected_model');calls++;if(hook)await hook();
      const input=JSON.parse(wire.messages[1].content);
      return {response:{schema_version:2,amount_roles:input.candidates.map((candidate,i)=>({candidate_id:candidate.id,role:['actual_paid','original','discount'][i]})),
        selected_candidate_id:'m0',currency:input.currency,direction:input.direction,confidence_per_mille:950,refusal_reason:'none',merchant_normalized:null,category:null}};
    }}};
  const request=(route,event,extra={})=>financeAiRequest({env:{...env,...extra}},account,'/api/finance/ai/'+route,event);
  const budgets=async()=> (await db.prepare('SELECT period_key,scope_key,reserved_calls,provider_calls FROM finance_ai_budgets WHERE period_key LIKE ?1 ORDER BY period_key,scope_key').bind(prefix+':%').all()).results;
  const attempts=async()=>Number((await db.prepare('SELECT SUM(attempts) AS n FROM finance_ai_observations WHERE user_id=?1').bind(prefix).first()).n||0);
  async function seed(label){
    const id=prefix+'-'+label,reference='SYNTH-'+(await sha256Hex(id)).slice(0,24),time=Date.now();
    await upsertNotificationHints(db,account,{device_id:prefix,hints:[{source_event_id:id,source_package:'com.tencent.mm',source_type:'notification',app_label:'SYNTHETIC',
      amount_minor:null,direction:'expense',currency:'CNY',amount_exponent:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:reference,payment_channel:'wechat',evidence:{reasons:['synthetic_p0_remote_qa']}}]});
    const evidence={schema_version:1,source_uid:10390,completion_proven:true,direction:'expense',currency:'CNY',captured_at_ms:time,expires_at_ms:time+90000,
      provider_reference_hash:await sha256Hex(reference),merchant_tokens:[],candidates:[9000,10000,1000].map((amount_minor,i)=>({id:'m'+i,amount_minor,currency:'CNY',amount_exponent:2,phrases:[['本次','扣除'],['原价'],['优惠']][i]}))};
    check((await request('evidence',{event_id:id,evidence})).status==='evidence_ready','evidence_not_ready');return id;
  }
  async function fillLastBucket(){
    const date=new Date().toISOString();env.FINANCE_AI_MONTHLY_CALL_LIMIT='1';
    await db.prepare('INSERT INTO finance_ai_budgets(period_key,scope_key,reserved_calls,provider_calls,updated_at) VALUES(?1,?2,1,1,?3)')
      .bind(prefix+':month:'+date.slice(0,7),'user:'+await sha256Hex(prefix),date).run();
  }
  try{
    const date=new Date().toISOString();
    await db.prepare("INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,substr(?1,1,40),?1,'','reset_required',0,'user',?2,?2,?2,?2)").bind(prefix,date).run();
    check((await request('consent',{enabled:true,expected_revision:0})).consent?.enabled===1,'schema_or_consent_unavailable');
    if(name==='quota'){
      const event=await seed('quota');await fillLastBucket();const before=await budgets();
      const denied=await request('suggest',{event_id:event});
      check(denied.error_code==='finance_ai_budget_exhausted'&&calls===0&&await attempts()===0,'quota_denial_invalid');
      check(JSON.stringify(await budgets())===JSON.stringify(before),'quota_partial_commit');
      env.FINANCE_AI_MONTHLY_CALL_LIMIT='2';const restored=await request('suggest',{event_id:event});
      check(restored.status==='suggestion'&&calls===1,'restored_quota_unusable');
      check((await request('suggest',{event_id:event})).status==='suggestion'&&calls===1,'cache_spent_another_call');
      detail={denied_bucket:3,partial_reservations:0,restored_mock_calls:1};
    }else if(name==='concurrent-month'){
      env.FINANCE_AI_MONTHLY_CALL_LIMIT='2';const events=[];for(let i=0;i<5;i++)events.push(await seed('parallel-'+i));
      const answers=await Promise.all(events.map(event_id=>request('suggest',{event_id})));
      const rows=await budgets();check(calls===2&&answers.filter(answer=>answer.status==='suggestion').length===2,'concurrent_call_cap');
      check(rows.length===4&&rows.every(row=>row.reserved_calls===2&&row.provider_calls===2)&&await attempts()===2,'concurrent_budget_leak');
      detail={events:5,mock_calls:2,buckets:4};
    }else if(name==='event-cap'){
      const event=await seed('event-cap');await Promise.all(Array.from({length:4},(_,i)=>request('suggest',{event_id:event},{FINANCE_AI_MODEL_VERSION:'qa-version-'+i})));
      const rows=await budgets();check(calls===2&&await attempts()===2&&rows.length===4&&rows.every(row=>row.reserved_calls===2&&row.provider_calls===2),'event_attempt_cap');
      detail={versions:4,mock_calls:2,event_attempts:2};
    }else if(name==='late-storage-fault'){
      const event=await seed('late-fault');trigger='p0_ai_qa_abort_'+nonce;
      // The name/account below are server-generated ASCII, never request SQL.
      await db.exec(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF attempts ON finance_ai_observations WHEN NEW.user_id='${prefix}' BEGIN SELECT RAISE(ABORT,'synthetic_private finance_ai_budget_exhausted'); END`);
      const value=await request('suggest',{event_id:event});
      check(value.error_code==='finance_ai_provider_unavailable'&&calls===0,'storage_failure_classification');
      check(!JSON.stringify(value).includes('synthetic_private')&&(await budgets()).length===0&&await attempts()===0,'storage_partial_commit');
      detail={failed_statement:5,partial_budget_rows:0,mock_calls:0};
    }else if(name==='retry-lease'){
      const event=await seed('retry-lease');await fillLastBucket();
      check((await request('suggest',{event_id:event})).error_code==='finance_ai_budget_exhausted','lease_setup_denial');
      const old=new Date(Date.now()-60000).toISOString();await db.prepare('UPDATE finance_ai_decisions SET created_at=?2,updated_at=?2 WHERE user_id=?1').bind(prefix,old).run();
      env.FINANCE_AI_MONTHLY_CALL_LIMIT='2';let release,started,pending;
      const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
      hook=async()=>{started();await gate;};
      try{
        pending=request('suggest',{event_id:event});await Promise.race([ready,pending.then(()=>{throw new QaFailure('lease_no_dispatch');})]);
        const current=await request('suggestions',{event_id:event});release();const completed=await pending;
        check(current.status==='running'&&completed.status==='suggestion'&&calls===1,'fresh_lease_was_interrupted');
        check((await db.prepare('SELECT created_at FROM finance_ai_decisions WHERE user_id=?1').bind(prefix).first()).created_at===old,'created_at_audit_changed');
      }finally{release?.();if(pending)await pending;hook=null;}
      detail={active_lease_preserved:true,original_created_at_preserved:true,mock_calls:1};
    }
    check((await db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id=?1').bind(prefix).first()).n===0,'unexpected_ledger_write');
    check((await db.prepare('SELECT COUNT(*) AS n FROM task21_notification_pending_hints WHERE user_id=?1 AND amount_minor IS NOT NULL').bind(prefix).first()).n===0,'unexpected_hint_money_write');
  }catch(error){errorCode=error instanceof QaFailure?error.message:'qa_execution_failed';}
  finally{
    try{
      if(trigger)await db.exec('DROP TRIGGER IF EXISTS '+trigger);
      await db.batch([db.prepare('DELETE FROM finance_ai_budgets WHERE period_key LIKE ?1').bind(prefix+':%'),db.prepare('DELETE FROM task12_users WHERE id=?1').bind(prefix)]);
    }catch{cleanup=false;}
  }
  return {case:name,prefix,status:errorCode||!cleanup?'FAIL':'PASS',error_code:errorCode||(!cleanup?'qa_cleanup_failed':''),detail,
    mock_provider_calls:calls,external_model_calls:0,cleanup_complete:cleanup};
}

export default {async fetch(request,env){
  if(!authorized(request,env))return json({error_code:'qa_unauthorized'},401);
  if(request.method!=='POST')return json({error_code:'qa_post_required'},405);
  const name=new URL(request.url).pathname.replace(/^\/run\//,'');
  if(!CASES.has(name))return json({error_code:'qa_unknown_case'},404);
  if(env.P0_AI_QA_MODE!==MODE||!DATABASES.has(env.P0_AI_QA_DATABASE_ID)||!env.QA_DB||env.AI||env.WYJ_DB)return json({error_code:'qa_environment_unverified'},503);
  try{
    const marker=await env.QA_DB.prepare('SELECT database_id FROM p0_ai_qa_environment WHERE environment_key=?1').bind(MARKER).first();
    if(marker?.database_id!==env.P0_AI_QA_DATABASE_ID)return json({error_code:'qa_environment_unverified'},503);
  }catch{return json({error_code:'qa_environment_unverified'},503);}
  const result=await runCase(env.QA_DB,name);return json(result,result.status==='PASS'?200:500);
}};
