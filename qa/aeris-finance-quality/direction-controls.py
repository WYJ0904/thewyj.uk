"""Disjoint controls for direction-mismatched labels; original roles tests stay red."""
from common import *
OUT=E/'direction-controls-r1';OUT.mkdir(exist_ok=False)
code=r'''
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {financeAiEligibility,validateFinanceAiOutput} from '__AI__';
import {normalizeFinanceAiRoles} from '__PROVIDER__';
const rows=[];
const phrases={expense:'扣除',income:'到账',refund:'退款'};
for(const direction of Object.keys(phrases))for(const wrong of Object.keys(phrases).filter(d=>d!==direction)){
 const input={currency:'CNY',direction,merchant_tokens:[],candidates:[
  {id:'m0',amount_minor:900,currency:'CNY',amount_exponent:2,phrases:['本次',phrases[wrong]]},
  {id:'m1',amount_minor:1000,currency:'CNY',amount_exponent:2,phrases:['本次',phrases[direction]]}]};
 const role=direction==='expense'?'actual_paid':direction==='income'?'actual_received':'refund';
 const raw={schema_version:2,amount_roles:[{candidate_id:'m0',role},{candidate_id:'m1',role:'unknown'}],selected_candidate_id:'m0',currency:'CNY',direction,confidence_per_mille:999,refusal_reason:'none',merchant_normalized:null,category:null};
 let error='';
 try{assert.equal(financeAiEligibility(input),'eligible');assert.throws(()=>validateFinanceAiOutput(normalizeFinanceAiRoles(raw,input),input),e=>e.code==='finance_ai_semantic_evidence_insufficient');}
 catch(e){error=e.stack;}
 rows.push({id:`reject-${direction}-selection-with-${wrong}-label`,status:error?'FAIL':'PASS',error,ledger_writes:0});
}
await fs.writeFile(process.env.AERIS_DIRECTION_OUTPUT,JSON.stringify({rows,external_model_calls:0,original_roles_fixture_unchanged:true},null,2));
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));
process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
'''
code=code.replace('__AI__',(ROOT/'functions/_lib/finance-ai.mjs').as_uri()).replace('__PROVIDER__',(ROOT/'functions/_lib/finance-ai-provider.mjs').as_uri())
driver=OUT/'contract.mjs';driver.write_text(code,encoding='utf-8')
before=sha(ROOT/'functions/_lib/finance-ai.mjs');cmd=[str(NODE),str(driver)]
with (OUT/'run.log').open('xb') as log:
    p=subprocess.run(cmd,cwd=ROOT,env=dict(environment(),AERIS_DIRECTION_OUTPUT=str(OUT/'result.json')),stdout=log,stderr=subprocess.STDOUT,timeout=30)
write(OUT/'command.json',dict(command=cmd,exit_code=p.returncode,source_sha256=before,source_stable=before==sha(ROOT/'functions/_lib/finance-ai.mjs'),external_model_calls=0))
print((OUT/'run.log').read_text());raise SystemExit(p.returncode)
