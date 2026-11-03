import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {getPlatformProxy} from 'wrangler';import {fixture,root} from '../finance-p04/fixture.mjs';
import {financeAiRequest} from '../../functions/_lib/finance-ai.mjs';import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
const out=path.join(root,'docs/migration-evidence/finance-p04/convergence/live-models');await fs.mkdir(out,{recursive:false});await fs.mkdir(path.join(out,'private'));
const cap=12,calls=[],rows=[];const sources=['functions/_lib/finance-ai.mjs','functions/_lib/finance-ai-provider.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')])));const before=await hashes();
await fs.writeFile(path.join(out,'budget.json'),JSON.stringify({maximum_new_binding_invocations:cap,max_output_tokens:512,timeout_ms:10000,synthetic_only:true,no_paid_plan_or_subscription_changes:true,source:'Owner current total task section 2.5: at most 12 new actual calls; retries included.'},null,2));
const cases=[
 ['cny-payment','CNY','expense',[9000,10000,1000],[['本次','扣除'],['原价'],['优惠']],'m0'],
 ['usd-refund','USD','refund',[2500,5000],[['本次','退款'],['原价']],'m0'],
 ['eur-income','EUR','income',[12000,50000],[['本次','到账'],['余额']],'m0'],
 ['hkd-fee','HKD','expense',[1100,1000,100],[['本次','扣款'],['原价'],['手续费']],'m0'],
 ['gbp-discount','GBP','expense',[9000,1000,10000],[['本次','支付'],['优惠'],['原价']],'m0'],
 ['jpy-ambiguous','JPY','expense',[900,1000],[['金额'],['金额']],null],
];
let proxy,f;try{
 const configPath=path.join(out,'binding.jsonc');await fs.writeFile(configPath,JSON.stringify({name:'finance-convergence-model-validation',main:'binding.mjs',compatibility_date:'2026-10-27',workers_dev:false,preview_urls:false,ai:{binding:'AI',remote:true}}));await fs.writeFile(path.join(out,'binding.mjs'),'export default {fetch(){return new Response("AI binding diagnostics only")}}');
 proxy=await getPlatformProxy({configPath,envFiles:[],persist:false,remoteBindings:true});f=await fixture();
 for(const [modelIndex,model] of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast','@cf/qwen/qwen3-30b-a3b-fp8'].entries()){
  const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:model,FINANCE_AI_MODEL_VERSION:'convergence-model-'+modelIndex,FINANCE_AI_TIMEOUT_MS:'10000',FINANCE_AI_DAILY_CALL_LIMIT:'12',FINANCE_AI_MONTHLY_CALL_LIMIT:'12',FINANCE_AI_USER_DAILY_CALL_LIMIT:'12',FINANCE_AI_MAX_OUTPUT_TOKENS:'512',AI:{run:async(selected,input)=>{
   assert.equal(selected,model);assert(calls.length<cap);const row={number:calls.length+1,model,started_utc:new Date().toISOString(),input_sha256:await sha256Hex(JSON.stringify(input)),max_tokens:input.max_tokens};calls.push(row);await fs.writeFile(path.join(out,'calls.json'),JSON.stringify(calls,null,2));
   try{const v=await proxy.env.AI.run(selected,input);row.usage=v?.usage??null;row.returned_model=v?.model??null;await fs.writeFile(path.join(out,'response-'+row.number+'.json'),JSON.stringify(v,null,2));return v;}
   catch(e){row.error_name=e?.name??typeof e;row.error_status=e?.status??null;const raw=JSON.stringify({name:e?.name,message:e?.message,stack:e?.stack,status:e?.status,code:e?.code},null,2);await fs.writeFile(path.join(out,'private','error-'+row.number+'.json'),raw);row.error_sha256=await sha256Hex(raw);throw e;}
   finally{row.finished_utc=new Date().toISOString();await fs.writeFile(path.join(out,'calls.json'),JSON.stringify(calls,null,2));}
  }}};const req=(route,payload)=>financeAiRequest({env},f.account,'/api/finance/ai/'+route,payload);
  const consent=(await req('config',{})).consent;if(!consent.enabled)await req('consent',{enabled:true,expected_revision:consent.revision});
  for(const [id,currency,direction,values,phrases,selected] of cases){
   if(calls.length>=cap){rows.push({id,model,status:'NOT_TESTED',reason:'Hard shared 12-call cap reached'});continue;}
   const event='convergence-'+modelIndex+'-'+id,reference='SYNTH-'+event;
   await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-convergence',hints:[{source_event_id:event,source_package:'com.tencent.mm',source_type:'notification',app_label:'SYNTHETIC',amount_minor:null,direction,currency,amount_exponent:currency==='JPY'?0:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:reference,payment_channel:'wechat',evidence:{reasons:['synthetic_convergence']}}]});
   const t=Date.now(),evidence={schema_version:1,source_uid:10390,completion_proven:true,currency,direction,captured_at_ms:t,expires_at_ms:t+90000,provider_reference_hash:await sha256Hex(reference),merchant_tokens:[],candidates:values.map((amount_minor,i)=>({id:'m'+i,amount_minor,currency,amount_exponent:currency==='JPY'?0:2,phrases:phrases[i]}))};
   await req('evidence',{event_id:event,evidence});const before=calls.length;const actual=await req('suggest',{event_id:event});const advice=actual.suggestion;
   const pass=selected===null?actual.status==='review'&&advice?.selected_candidate_id===null:advice?.selected_candidate_id===selected&&advice?.currency===currency&&advice?.direction===direction&&['suggestion','review'].includes(actual.status);
   const n=calls.length;assert.deepEqual(await req('suggest',{event_id:event}),actual);assert.equal(calls.length,n);
   rows.push({id,model,status:pass?'PASS':'FAIL',expected:{selected_candidate_id:selected,currency,direction},actual,calls:calls.length-before,ledger_writes:0});await fs.writeFile(path.join(out,'cases.json'),JSON.stringify(rows,null,2));
  }
 }
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,0);
}finally{if(f)await f.dispose();if(proxy)await proxy.dispose();const after=await hashes();await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,calls:calls.length,cap,source_before:before,source_after:after,source_stable:JSON.stringify(before)===JSON.stringify(after),actual_billed_cost:null,production_mutations:false,physical_device:false},null,2));console.log(JSON.stringify({calls:calls.length,results:rows.map(r=>({id:r.id,model:r.model,status:r.status}))}));}
