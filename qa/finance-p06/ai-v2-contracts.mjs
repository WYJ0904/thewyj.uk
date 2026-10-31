import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';
import {FINANCE_AI_ROLE_SCHEMA,normalizeFinanceAiRoles} from '../../functions/_lib/finance-ai-provider.mjs';
import {financeAiRequest,validateFinanceAiOutput} from '../../functions/_lib/finance-ai.mjs';
const out=path.resolve(process.env.FINANCE_P06_OUTPUT);assert(out.startsWith(path.join(root,'docs/migration-evidence/finance-p06')+path.sep));await fs.mkdir(out,{recursive:false});
const rows=[];async function test(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
const p={schema_version:1,source_uid:10390,completion_proven:true,direction:'expense',currency:'CNY',captured_at_ms:Date.now(),expires_at_ms:Date.now()+90000,provider_reference_hash:await sha256Hex('SYNTH-P06-ROLES'),merchant_tokens:['Restaurant'],candidates:[
 {id:'m0',amount_minor:9000,currency:'CNY',amount_exponent:2,phrases:['本次','扣除']},{id:'m1',amount_minor:10000,currency:'CNY',amount_exponent:2,phrases:['原价']},{id:'m2',amount_minor:1000,currency:'CNY',amount_exponent:2,phrases:['优惠']}]};
const raw=()=>({schema_version:2,amount_roles:[{candidate_id:'m0',role:'actual_paid'},{candidate_id:'m1',role:'original'},{candidate_id:'m2',role:'discount'}],selected_candidate_id:'m0',currency:'CNY',direction:'expense',confidence_per_mille:950,refusal_reason:'none',merchant_normalized:'Restaurant',category:'food'});
const decode=(value,input=p)=>validateFinanceAiOutput(normalizeFinanceAiRoles(value,input),input);
await test('provider-never-generates-financial-number',()=>{assert(!JSON.stringify(FINANCE_AI_ROLE_SCHEMA).includes('amount_minor'));const v=decode(raw());assert.equal(v.amount_candidates[0].amount_minor,9000);assert.equal(v.requires_manual_confirmation,true);});
for(const [id,edit]of[
 ['extra-number',x=>x.amount_minor=123456],['extra-reference',x=>x.transaction_id='invented'],['wrong-currency',x=>x.currency='USD'],['wrong-direction',x=>x.direction='income'],
 ['unknown-id',x=>x.selected_candidate_id='m5'],['role-mismatch',x=>x.amount_roles[0].role='fee'],['original-price',x=>x.selected_candidate_id='m1'],['discount',x=>x.selected_candidate_id='m2'],
 ['duplicate-ids',x=>x.amount_roles[1].candidate_id='m0'],['fractional-confidence',x=>x.confidence_per_mille=0.95],['negative-confidence',x=>x.confidence_per_mille=-1],
 ['confidence-overflow',x=>x.confidence_per_mille=1001],['unknown-category',x=>x.category='invented'],['private-merchant',x=>x.merchant_normalized='SYNTHETIC_PERSON'],
 ['unknown-field',x=>x.approved=true],['unknown-schema',x=>x.schema_version=1],
])await test('reject-'+id,()=>{const v=raw();edit(v);assert.throws(()=>decode(v));});
await test('low-confidence-is-never-multiplied',()=>{const v=raw();v.confidence_per_mille=1;const value=decode(v);assert.equal(value.confidence,1);assert.equal(value.decision,'review');});
await test('refund-role-only-copies-original-source-money',()=>{const v=raw(),input={...p,direction:'refund'};v.direction='refund';v.amount_roles[0].role='refund';assert.equal(decode(v,input).amount_candidates[0].amount_minor,9000);});
await test('income-role-is-not-an-expense',()=>{const v=raw(),input={...p,direction:'income'};v.direction='income';v.amount_roles[0].role='actual_received';assert.equal(decode(v,input).direction,'income');});
const f=await fixture();let calls=0;
const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:'@cf/synthetic/roles',FINANCE_AI_MODEL_VERSION:'roles-test-1',AI:{run:async(model,input)=>{calls++;assert.equal(input.response_format.json_schema.properties.schema_version.enum[0],2);return {model:'@cf/synthetic/roles-observed',response:raw(),usage:{prompt_tokens:90,completion_tokens:70}};}}};
const context={env};const request=(name,value)=>financeAiRequest(context,f.account,'/api/finance/ai/'+name,value);
try{
 await test('actual-d1-v2-cache-and-protocol-version',async()=>{
  await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-p06-role-device',hints:[{source_event_id:'p06-roles-event',source_package:'com.tencent.mm',source_type:'notification',app_label:'SYNTHETIC',amount_minor:null,direction:'expense',currency:'CNY',amount_exponent:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:'SYNTH-P06-ROLES',payment_channel:'wechat',evidence:{reasons:['synthetic_p06_roles']}}]});
  await request('consent',{enabled:true,expected_revision:0});await request('evidence',{event_id:'p06-roles-event',evidence:p});
  const result=await request('suggest',{event_id:'p06-roles-event'});assert.equal(result.status,'suggestion');assert.equal(result.provider_model,'@cf/synthetic/roles-observed');assert.match(result.model_version,/:roles-2$/);assert.equal(result.suggestion.amount_candidates[0].amount_minor,9000);
  assert.deepEqual(await request('suggest',{event_id:'p06-roles-event'}),result);assert.equal(calls,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM task16_finance_transactions').first()).count,0);
 });
 await test('zero-daily-budget-blocks-the-first-call',async()=>{
  const event='p06-zero-budget';await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-p06-role-device',hints:[{source_event_id:event,source_package:'com.tencent.mm',source_type:'notification',app_label:'SYNTHETIC',amount_minor:null,direction:'expense',currency:'CNY',amount_exponent:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:'SYNTH-P06-BUDGET',payment_channel:'wechat',evidence:{reasons:['synthetic_p06_budget']}}]});
  const input={...p,captured_at_ms:Date.now(),expires_at_ms:Date.now()+90000,provider_reference_hash:await sha256Hex('SYNTH-P06-BUDGET')};
  await request('evidence',{event_id:event,evidence:input});env.FINANCE_AI_DAILY_CALL_LIMIT='0';const before=calls;const result=await request('suggest',{event_id:event});assert.equal(calls,before);assert.equal(result.error_code,'finance_ai_budget_exhausted');
 });
 await test('withdrawal-works-with-model-killed',async()=>{env.FINANCE_AI_KILL_SWITCH='true';assert.equal((await request('config',{})).consent.enabled,1);assert.equal((await request('consent',{enabled:false,expected_revision:1})).consent.enabled,0);assert.equal(calls,1);});
}finally{await f.dispose();}
await fs.writeFile(path.join(out,'contracts.json'),JSON.stringify({rows,provider:'MOCK v2 role classifier; actual D1/product service; no external provider call',mock_provider_calls:calls},null,2));
console.log(JSON.stringify({PASS:rows.filter(x=>x.status==='PASS').length,FAIL:rows.filter(x=>x.status==='FAIL').length}));process.exitCode=rows.some(x=>x.status==='FAIL')?1:0;
