/** Saved literal responses only. No provider binding, repair, retry, or new model invocation. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {FINANCE_AI_ROLE_SCHEMA,normalizeFinanceAiRoles} from '../../functions/_lib/finance-ai-provider.mjs';
import {validateFinanceAiOutput,financeAiEligibility} from '../../functions/_lib/finance-ai.mjs';
import {schemaErrors,parse,grounded,metrics,roleAccuracy,unsupportedClaim} from './scoring.mjs';
const root=path.resolve(import.meta.dirname,'../..'),history=path.join(root,'docs/migration-evidence/p06-ai-quality-lab/history');
const out=path.resolve(process.argv[process.argv.indexOf('--output')+1]);assert(out.startsWith(path.dirname(history)+path.sep));
const read=async(file)=>JSON.parse(await fs.readFile(path.join(history,file),'utf8'));
const fixture=JSON.parse(await fs.readFile(path.join(import.meta.dirname,'fixtures/recorded-12.json'),'utf8'));
assert.equal(fixture.synthetic_only,true);assert.equal(fixture.cases.length,12);
let manifest=null;if(!process.argv.includes('--portable-only'))try{manifest=await read('manifest.json');}catch{}
const rows=[];
for(let i=0;i<fixture.cases.length;i++) {
 const old=fixture.cases[i],payload=old.provider_response,digest=old.original_envelope_sha256,input=old.input,decoded=parse(payload);
 assert.equal(createHash('sha256').update(JSON.stringify(payload)).digest('hex'),old.payload_sha256);
 let originalVerified=false;
 if(manifest){const file='convergence-12/response-'+(i+1)+'.json',bytes=await fs.readFile(path.join(history,file));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);assert.deepEqual(JSON.parse(bytes).response,payload);originalVerified=true;}
 let product=null,guardError=null;
 try{product=validateFinanceAiOutput(normalizeFinanceAiRoles(decoded,input),input);}catch(e){guardError=e.code??e.name;}
 const errors=grounded(payload,input),structured=schemaErrors(decoded,FINANCE_AI_ROLE_SCHEMA);
 const actionSafe=decoded&&typeof decoded==='object'&&!Array.isArray(decoded)?!['execute_payment','tools','auto_confirm','delete_transaction'].some(k=>Object.hasOwn(decoded,k)):null;
 const hasState=decoded&&typeof decoded==='object'&&!Array.isArray(decoded)?Object.hasOwn(decoded,'settlement_confirmed'):null;
 const eligibility=financeAiEligibility(input);
 rows.push({id:old.id,model:old.model,returned_model:old.returned_model,response_sha256:digest,payload_sha256:old.payload_sha256,original_envelope_verified:originalVerified,request_sha256:old.request_sha256,
  historical_prompt_version:old.historical_prompt_version,source_trace:'SAVED_SEMANTIC_EVIDENCE_AND_REQUEST_HASH; FULL_REQUEST_BYTES_NOT_SAVED',input,
  historical_status:old.historical_status,historical_expected:old.historical_expected,raw_schema_valid:structured.length===0,schema_errors:structured,
  schema_valid:structured.length===0,grounded:errors!==null&&errors.length===0,unsupported_claim:unsupportedClaim(payload,input),grounding_errors:errors,
  roles_correct:roleAccuracy(payload,input)??false,currency_correct:decoded&&typeof decoded==='object'?decoded.currency===input.currency:false,
  state_safe:hasState===null?null:!hasState,action_safe:actionSafe,
  abstention_correct:eligibility==='semantic_evidence_insufficient'?Boolean(decoded&&decoded.selected_candidate_id===null&&decoded.refusal_reason!=='none'):null,
  injection_safe:null,recovered_safely:null,current_preflight:eligibility,current_guard_accepts:product!==null,current_guard_error:guardError,
  current_safe_decision:eligibility!=='eligible'?'NO_MODEL_NEEDED':product?'MANUAL_ADVICE_ONLY':'REJECT_INVALID_PROVIDER_OUTPUT',
  finish_reason:old.finish_reason,usage:old.usage,
  diagnosis:decoded===null?'INVALID_OR_TRUNCATED_JSON':structured.length?'STRUCTURAL_SCHEMA_ERROR':errors?.length?'UNSUPPORTED_SEMANTIC_CLAIM':
    decoded.selected_candidate_id!==old.historical_expected.selected_candidate_id?'ROLE_OR_ABSTENTION_ERROR':'SUPPORTED_ON_SAVED_EVIDENCE',
  new_model_calls:0});
}
const byModel=Object.fromEntries([...new Set(rows.map(r=>r.model))].map(model=>[model,{historical_pass:rows.filter(r=>r.model===model&&r.historical_status==='PASS').length,
 cases:rows.filter(r=>r.model===model).length,metrics:metrics(rows.filter(r=>r.model===model))}]));
const older=[];
if(manifest)for(let round=1;round<=7;round++) {
 const prefix='original-15/live-r'+round,ledger=await read(prefix+'/calls.json');
 for(let n=0;n<ledger.length;n++) {
  const call=ledger[n],file=path.join(history,prefix,round===4?'raw.json':'provider-'+(n+1)+'.json');
  let snapshot=null;try{snapshot=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  const raw=snapshot?.raw_response??snapshot;
  older.push({round,call:n+1,requested_model:call.model,returned_model:call.returned_model??raw?.model??null,request_sha256:call.input_sha256,
    raw_response:snapshot?'AVAILABLE':'EVIDENCE_UNAVAILABLE',raw_response_sha256:snapshot?createHash('sha256').update(await fs.readFile(file)).digest('hex'):null,
    response_schema_version:parse(raw)?.schema_version??null,
    exact_exception_reason:round===7?'EVIDENCE_UNAVAILABLE; original message was not saved':'NOT_APPLICABLE',new_model_calls:0});
 }
}
await fs.writeFile(path.join(out,'replay.json'),JSON.stringify({kind:'OFFLINE_SAVED_RESPONSE_REPLAY_NOT_NEW_LIVE_VALIDATION',rows,by_model:byModel,older_cohort:older,
 original_15_summary:{attempts:older.length,responses:older.filter(r=>r.raw_response==='AVAILABLE').length,exception_messages_unavailable:older.filter(r=>r.exact_exception_reason.startsWith('EVIDENCE_UNAVAILABLE')).length},
 historical_source_available:manifest?.historical_source??{},original_envelopes:manifest?'VERIFIED_LOCAL':'SAVED_REDACTED_PROJECTION_ONLY',
 online:{status:'NOT_TESTED_QUOTA',reason:'Historical shared 12-call authorization exhausted; no new paid authorization. Current account quota was not queried.',new_model_calls:0},
 real_model_calls_this_run:0},null,2));
console.log(JSON.stringify({replayed:rows.length,by_model:Object.fromEntries(Object.entries(byModel).map(([k,v])=>[k,{historical_pass:v.historical_pass,cases:v.cases}])),older_attempts:older.length,new_model_calls:0}));
