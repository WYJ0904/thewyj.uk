// Diagnostic only: unchanged refund evidence, a smaller role-classification task.
// Nothing from this probe can write a hint or ledger, or count as product acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {root} from '../finance-p04/fixture.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
const parent=path.join(root,'docs/migration-evidence/finance-p06/provider'),out=path.join(parent,'live-r4');await fs.mkdir(out,{recursive:false});
let prior=0;for(const folder of await fs.readdir(parent)){if(!/^live-r[0-9]+$/.test(folder))continue;try{prior+=JSON.parse(await fs.readFile(path.join(parent,folder,'calls.json'),'utf8')).length;}catch{}}
assert(prior<12,'Twelve-call total cap');
const old=JSON.parse(await fs.readFile(path.join(parent,'live-r2/result.json'),'utf8')).rows.find(r=>r.id==='refund');
const evidence=old.actual.evidence;assert.deepEqual(evidence.candidates.map(c=>c.amount_minor),[2500,5000]);
const schema={type:'object',additionalProperties:false,required:['selected_candidate_id','selected_role','confidence','refusal_reason'],properties:{
 selected_candidate_id:{type:['string','null'],enum:['m0','m1',null],description:'Evidence ID about money refunded in this transaction, not the original purchase price; null if ambiguous'},
 selected_role:{type:'string',enum:['refund','original','unknown']},confidence:{type:'integer',minimum:0,maximum:1000},
 refusal_reason:{type:'string',enum:['none','ambiguous','insufficient_evidence']}}};
const input={messages:[{role:'system',content:'Identify the monetary role described by each supplied phrase. This is a classification suggestion for human review, not payment approval. For direction refund, select the supplied evidence about the current refund, excluding original price. Never invent numbers or an evidence ID; if unclear select null.'},
 {role:'user',content:JSON.stringify(evidence)}],max_tokens:256,temperature:0,response_format:{type:'json_schema',json_schema:schema}};
const model='@cf/meta/llama-3.3-70b-instruct-fp8-fast';let proxy,result;
try{
 await fs.writeFile(path.join(out,'binding-worker.mjs'),'export default {fetch(){return new Response("isolated diagnostic binding")}};');
 const configPath=path.join(out,'binding.jsonc');await fs.writeFile(configPath,JSON.stringify({name:'finance-p06-isolated-binding-diagnostic',main:'binding-worker.mjs',compatibility_date:'2026-10-26',workers_dev:false,preview_urls:false,ai:{binding:'AI',remote:true}}));
 proxy=await getPlatformProxy({configPath,envFiles:[],persist:false,remoteBindings:true});
 const call={model,started_utc:new Date().toISOString(),input_sha256:await sha256Hex(JSON.stringify(input)),max_output_tokens:256};await fs.writeFile(path.join(out,'calls.json'),JSON.stringify([call],null,2));
 const start=performance.now();const raw=await proxy.env.AI.run(model,input);call.duration_ms=Math.round(performance.now()-start);call.provider_usage=raw.usage??null;call.returned_model=raw.model??null;
 await fs.writeFile(path.join(out,'calls.json'),JSON.stringify([call],null,2));await fs.writeFile(path.join(out,'raw.json'),JSON.stringify(raw,null,2));
 const value=typeof raw.response==='string'?JSON.parse(raw.response):raw.response;
 result={status:value?.selected_candidate_id==='m0'&&value?.selected_role==='refund'?'DIAGNOSTIC_MATCH':'DIAGNOSTIC_NO_MATCH',actual:value,
   unchanged_source_evidence:evidence,ledger_writes:0,product_pass_claimed:false,actual_provider_calls:1,actual_billed_cost:null};
}catch(error){result={status:'PROVIDER_VALIDATION_REQUIRED',error:error.message,product_pass_claimed:false};}
finally{if(proxy)await proxy.dispose();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
