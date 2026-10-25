import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getPlatformProxy} from 'wrangler';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';
import {financeAiRequest} from '../../functions/_lib/finance-ai.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';

const label=process.env.FINANCE_P06_LIVE_LABEL||'live-r1';assert.match(label,/^live-r[0-9]+$/);
const out=path.join(root,'docs/migration-evidence/finance-p06/provider',label);await fs.mkdir(out,{recursive:false});
const model='@cf/meta/llama-3.3-70b-instruct-fp8-fast';const rows=[],calls=[],waits=[];
const scopeFiles=['functions/_lib/finance-ai.mjs','cloudflare/migrations/0034_finance_ai_assistance.sql'];
const hashes=async()=>Object.fromEntries(await Promise.all(scopeFiles.map(async n=>[n,createHash('sha256').update(await fs.readFile(path.join(root,n))).digest('hex')])));
const before=await hashes();let proxy,f;
try{
 const configPath=path.join(out,'binding.jsonc');
 await fs.writeFile(configPath,JSON.stringify({name:'finance-p06-isolated-binding-validation',main:'binding-worker.mjs',compatibility_date:'2026-10-26',workers_dev:false,preview_urls:false,ai:{binding:'AI',remote:true}},null,2));
 await fs.writeFile(path.join(out,'binding-worker.mjs'),'export default { fetch(){return new Response("Isolated AI binding only; no financial storage")} };');
 // Only AI is remote. No D1/R2/Pages/Production resources are bound or deployed.
 proxy=await getPlatformProxy({configPath,envFiles:[],persist:false,remoteBindings:true});
 f=await fixture();
 const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:model,
   FINANCE_AI_MODEL_VERSION:'p06-live-1',FINANCE_AI_TIMEOUT_MS:'10000',FINANCE_AI_DAILY_CALL_LIMIT:'6',FINANCE_AI_MONTHLY_CALL_LIMIT:'6',FINANCE_AI_USER_DAILY_CALL_LIMIT:'6',FINANCE_AI_MAX_OUTPUT_TOKENS:'512',
   AI:{run:async(selected,input)=>{
      assert.equal(selected,model);assert(calls.length<6,'Hard validation-run limit');
      const wire=JSON.stringify(input);assert(!/SYNTHETIC_RAW_NEVER_SEND|SYNTHETIC_PERSON_NEVER_SEND/.test(wire));
      const row={call:calls.length+1,model:selected,started_utc:new Date().toISOString(),input_sha256:await sha256Hex(wire),input_bytes:Buffer.byteLength(wire),max_output_tokens:input.max_tokens};calls.push(row);
      await fs.writeFile(path.join(out,'calls.json'),JSON.stringify(calls,null,2));
      const started=performance.now();
      try{const result=await proxy.env.AI.run(selected,input);row.duration_ms=Math.round(performance.now()-started);row.provider_usage=result?.usage??null;
          await fs.writeFile(path.join(out,`provider-${row.call}.json`),JSON.stringify({synthetic_only:true,model,raw_response:result},null,2));return result;
      }catch(error){row.error_name=error.name;row.error_status=error.status??null;throw error;}
      finally{row.finished_utc=new Date().toISOString();await fs.writeFile(path.join(out,'calls.json'),JSON.stringify(calls,null,2));}
   }}};
 const context={env,waitUntil:p=>waits.push(p)};
 const request=(route,payload)=>financeAiRequest(context,f.account,'/api/finance/ai/'+route,payload);
 await request('consent',{enabled:true,expected_revision:0});
 for(const [id,unit,direction,values,phrases] of [
   ['payment','CNY','expense',[9000,10000,1000],[['本次','扣除'],['原价'],['优惠']]],
   ['refund','CNY','refund',[2500,5000],[['本次','退款'],['原价']]],
   ['jpy','JPY','expense',[900,1000,100],[['本次','扣除'],['原价'],['优惠']]],
 ]){
   const event='synthetic-p06-live-'+id,reference='SYNTH-P06-LIVE-'+id;
   await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-p06-live',hints:[{source_event_id:event,source_type:'notification',source_package:'com.tencent.mm',app_label:'SYNTHETIC',
     amount_minor:null,direction,currency:unit,amount_exponent:unit==='JPY'?0:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:reference,payment_channel:'wechat',evidence:{reasons:['synthetic_p06_live'],recognised_fields:['direction','provider_reference']}}]});
   const t=Date.now(),input={schema_version:1,source_uid:10390,completion_proven:true,direction,currency:unit,captured_at_ms:t,expires_at_ms:t+90000,provider_reference_hash:await sha256Hex(reference),merchant_tokens:['Restaurant'],
     candidates:values.map((amount_minor,i)=>({id:'m'+i,amount_minor,currency:unit,amount_exponent:unit==='JPY'?0:2,phrases:phrases[i]}))};
   await request('evidence',{event_id:event,evidence:input});
   const started=performance.now();const result=await request('suggest',{event_id:event});const actual=result.suggestion;
   const semantic=actual?.selected_candidate_id==='m0'&&actual?.currency===unit&&actual?.direction===direction;
   const replayBefore=calls.length;const replay=await request('suggest',{event_id:event});
   assert.equal(calls.length,replayBefore,'Replay must never spend another model call');assert.deepEqual(replay,result);
   rows.push({id,status:semantic&&['suggestion','review'].includes(result.status)?'PASS':'FAIL',duration_ms:Math.round(performance.now()-started),actual:result,
     expected:{selected_candidate_id:'m0',currency:unit,direction},replay_extra_calls:0,ledger_writes:0,synthetic_only:true});
   await fs.writeFile(path.join(out,'cases.json'),JSON.stringify(rows,null,2));
 }
 const ledger=await f.db.prepare('SELECT COUNT(*) AS count FROM task16_finance_transactions').first();assert.equal(ledger.count,0);
}catch(error){rows.push({id:'provider-environment',status:'PROVIDER_VALIDATION_REQUIRED',error:error.message});}
finally{
 if(waits.length)await Promise.allSettled(waits);
 if(f)await f.dispose();if(proxy)await proxy.dispose();
 const after=await hashes();const stable=JSON.stringify(before)===JSON.stringify(after);
 const result={status:rows.length===3&&rows.every(r=>r.status==='PASS')&&stable?'PASS':'PARTIAL',model,rows,actual_provider_calls:calls.length,
   source_before:before,source_after:after,source_stable:stable,maximum_run_calls:6,maximum_output_tokens_per_call:512,
   actual_billed_cost:null,billing_note:'Provider does not report an attributable billed USD charge; token/latency observations are actual, invoice cost is NOT_TESTED. Reference pricing is not an invoice.',
   phone_operations:false,production_d1_or_preview_mutations:false,only_remote_binding:'AI',production_deploy:false,synthetic_only:true};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,actual_provider_calls:calls.length,rows:rows.map(r=>({id:r.id,status:r.status,error:r.error})),actual_billed_cost:null}));
 process.exitCode=result.status==='PASS'?0:1;
}
