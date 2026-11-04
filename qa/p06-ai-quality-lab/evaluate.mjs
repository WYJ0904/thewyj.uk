import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {DATASET,CLOCK} from './cases.mjs';
import {schemaErrors,metrics,grounded,parse,roleAccuracy,unsupportedClaim} from './scoring.mjs';
import {FINANCE_AI_ROLE_SCHEMA,normalizeFinanceAiRoles} from '../../functions/_lib/finance-ai-provider.mjs';
import {validateFinanceAiEvidence,validateFinanceAiOutput,financeAiEligibility} from '../../functions/_lib/finance-ai.mjs';
import {financeAiAdvice} from '../../js/finance/ai-assistance.js';
import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..'),out=path.resolve(process.argv[process.argv.indexOf('--output')+1]);
assert(out.startsWith(path.join(root,'docs/migration-evidence/p06-ai-quality-lab')+path.sep));
// Fixed committed logic, import-specifier rewrite only; no working-tree overwrite.
async function atBase(name){const source=execFileSync('git',['show','5f4e6df5b9d9a031dafa013249c2aa5ac3a2b006:'+name],{cwd:root,encoding:'utf8'});
 const origin=pathToFileURL(path.join(root,name));const rewritten=source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,(_,a,p,z)=>a+new URL(p,origin).href+z);
 return import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));}
const provider=process.argv.includes('--baseline')?await atBase('functions/_lib/finance-ai.mjs'):{validateFinanceAiEvidence,validateFinanceAiOutput,financeAiEligibility};
const browser=process.argv.includes('--baseline')?await atBase('js/finance/ai-assistance.js'):{financeAiAdvice};
const rows=[];
for(const c of DATASET) {
  let error=null,accepted=false,value=null,browserAccepted=null;
  try {
    if(c.stage==='input')value=provider.validateFinanceAiEvidence(c.input,CLOCK);
    else if(c.stage==='gate')value=provider.financeAiEligibility(c.input);
    else {const raw=parse(c.response);value=provider.validateFinanceAiOutput(normalizeFinanceAiRoles(raw,c.input),c.input);}
    accepted=true;
  } catch(e){error=e.code??e.name;}
  if(c.stage==='consumer') {
    // Build the rich wire independently, so a server rejection cannot hide a browser validation gap.
    const raw=c.response;
    const rich={schema_version:1,decision:'suggest',amount_candidates:raw.amount_roles.map(r=>({candidate_id:r.candidate_id,role:r.role,
      amount_minor:c.input.candidates.find(x=>x.id===r.candidate_id).amount_minor,currency:c.input.currency,evidence_refs:[r.candidate_id]})),
      selected_candidate_id:raw.selected_candidate_id,currency:c.input.currency,direction:c.input.direction,evidence_refs:c.input.candidates.map(x=>x.id),
      confidence:950,refusal_reason:'none',merchant_normalized:'Restaurant',category:'other',requires_manual_confirmation:true};
    const candidate={id:'synthetic-hint',currency:c.input.currency,direction:c.input.direction,amount_minor:null};
    browserAccepted=browser.financeAiAdvice({status:'suggestion',canonical_hint_id:candidate.id,expires_at_ms:CLOCK+80000,
      requires_manual_confirmation:true,evidence:c.input,suggestion:rich},candidate,CLOCK)!==null;
  }
  const expectAccepted=c.expected==='accept';
  const pass=c.stage==='gate'?value===c.expected:accepted===expectAccepted&&(browserAccepted===null||browserAccepted===expectAccepted);
  const schemaValid=c.response===undefined?null:schemaErrors(parse(c.response),FINANCE_AI_ROLE_SCHEMA).length===0;
  const grounding=c.response===undefined?null:grounded(c.response,c.input);
  const raw=parse(c.response),claims=c.response===undefined?null:raw&&typeof raw==='object'&&!Array.isArray(raw);
  rows.push({id:c.id,category:c.category,cohort:c.cohort,status:pass?'PASS':'FAIL',expected:c.expected,accepted,error,browser_accepted:browserAccepted,
    actual:c.stage==='gate'?value:accepted?{decision:value?.decision??'input_validated',selected_candidate_id:value?.selected_candidate_id??null,requires_manual_confirmation:value?.requires_manual_confirmation??null}:{error_code:error},
    schema_valid:schemaValid,grounded:c.response===undefined?null:grounding!==null&&grounding.length===0,grounding_errors:grounding,
    roles_correct:c.response===undefined?null:roleAccuracy(c.response,c.input)??false,unsupported_claim:c.response===undefined?null:unsupportedClaim(c.response,c.input),currency_correct:c.response===undefined?null:claims?raw.currency===c.input.currency:false,
    state_safe:claims?!Object.hasOwn(raw,'settlement_confirmed'):null,
    action_safe:claims?!['execute_payment','tools','auto_confirm','delete_transaction'].some(k=>Object.hasOwn(raw,k)):null,
    injection_safe:['I-inject-notification','I-inject-merchant'].includes(c.id)?(!accepted&&(browserAccepted===null||!browserAccepted)):null,
    abstention_correct:c.stage==='gate'&&c.expected==='semantic_evidence_insufficient'?value===c.expected:null,
    note:c.note??'',manual_only:value?.requires_manual_confirmation??null});
}
const byCohort=Object.fromEntries([...new Set(rows.map(r=>r.cohort))].map(key=>[key,metrics(rows.filter(r=>r.cohort===key))]));
await fs.writeFile(path.join(out,'dataset.json'),JSON.stringify({synthetic_only:true,cases:DATASET},null,2));
await fs.writeFile(path.join(out,'evaluation.json'),JSON.stringify({kind:'DETERMINISTIC_CONTROLS_NOT_MODEL_QUALITY',pinned_baseline:process.argv.includes('--baseline'),rows,metrics:byCohort,real_model_calls:0},null,2));
console.log(JSON.stringify({cases:rows.length,PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').map(r=>r.id),real_model_calls:0}));
process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
