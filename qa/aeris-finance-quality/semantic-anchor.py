"""Real validation-path regressions: selected money needs its own movement evidence."""
from common import *
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--label',required=True);args=parser.parse_args()
assert args.label in ['semantic-before','semantic-after']
OUT=E/args.label;OUT.mkdir(exist_ok=False)
code=r'''
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {financeAiEligibility,validateFinanceAiEvidence,validateFinanceAiOutput} from '__AI__';
import {normalizeFinanceAiRoles} from '__PROVIDER__';
const rows=[];
async function test(id,body){try{await body();rows.push({id,status:'PASS'});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
for(const currency of ['CNY','USD','EUR','HKD','GBP','JPY'])for(const direction of ['expense','income','refund']){
 const movement={expense:'扣除',income:'到账',refund:'退款'}[direction];
 const t=Date.now();
 const input=validateFinanceAiEvidence({schema_version:1,source_uid:10390,completion_proven:true,direction,currency,captured_at_ms:t,expires_at_ms:t+90000,provider_reference_hash:'a'.repeat(64),merchant_tokens:[],candidates:[
  {id:'m0',amount_minor:900,currency,amount_exponent:currency==='JPY'?0:2,phrases:['金额']},
  {id:'m1',amount_minor:1000,currency,amount_exponent:currency==='JPY'?0:2,phrases:['本次',movement]}]});
 assert.equal(financeAiEligibility(input),'eligible');
 for(const protocol of ['rich-1','roles-2'])for(const selected of ['m0','m1']){
  const role=direction==='expense'?'actual_paid':direction==='income'?'actual_received':'refund';
  const raw={schema_version:2,amount_roles:input.candidates.map(c=>({candidate_id:c.id,role:c.id===selected?role:'unknown'})),selected_candidate_id:selected,currency,direction,confidence_per_mille:999,refusal_reason:'none',merchant_normalized:null,category:null};
  const rich=normalizeFinanceAiRoles(raw,input);const output=protocol==='roles-2'?normalizeFinanceAiRoles(raw,input):rich;
  await test(`${currency}-${direction}-${protocol}-${selected==='m0'?'reject-unanchored-selection':'accept-source-anchored-selection'}`,()=>{
   if(selected==='m0')assert.throws(()=>validateFinanceAiOutput(output,input),e=>e.code==='finance_ai_semantic_evidence_insufficient');
   else{const value=validateFinanceAiOutput(output,input);assert.equal(value.selected_candidate_id,'m1');assert.equal(value.requires_manual_confirmation,true);assert.equal(value.amount_candidates.find(c=>c.candidate_id==='m1').amount_minor,1000);}
  });
 }
}
for(const marker of ['本次','本笔'])for(const direction of ['expense','income','refund'])await test(`current-marker-without-movement-${marker}-${direction}`,()=>{
 assert.equal(financeAiEligibility({direction,candidates:[{id:'m0',amount_minor:900,currency:'CNY',phrases:[marker]},{id:'m1',amount_minor:1000,currency:'CNY',phrases:['金额']}]}),'semantic_evidence_insufficient');
});
await fs.writeFile(process.env.AERIS_SEMANTIC_OUTPUT,JSON.stringify({rows,external_model_calls:0,ledger_writes:0},null,2));
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));
process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
'''
code=code.replace('__AI__',(ROOT/'functions/_lib/finance-ai.mjs').as_uri()).replace('__PROVIDER__',(ROOT/'functions/_lib/finance-ai-provider.mjs').as_uri())
driver=OUT/'contract.mjs';driver.write_text(code,encoding='utf-8')
before=sha(ROOT/'functions/_lib/finance-ai.mjs');cmd=[str(NODE),str(driver)]
with (OUT/'run.log').open('xb') as log:
    p=subprocess.run(cmd,cwd=ROOT,env=dict(environment(),AERIS_SEMANTIC_OUTPUT=str(OUT/'result.json')),stdout=log,stderr=subprocess.STDOUT,timeout=30)
write(OUT/'command.json',dict(command=cmd,exit_code=p.returncode,source_sha256=before,source_stable=before==sha(ROOT/'functions/_lib/finance-ai.mjs'),external_model_calls=0))
print((OUT/'run.log').read_text());raise SystemExit(p.returncode)
