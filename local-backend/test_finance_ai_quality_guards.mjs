// Standalone candidate-patch regression: no D1, network, model or UI process.
import assert from 'node:assert/strict';import test from 'node:test';
import {validateFinanceAiOutput} from '../functions/_lib/finance-ai.mjs';
import {financeAiAdvice} from '../js/finance/ai-assistance.js';
const clock=100000;
function input(){return {currency:'CNY',direction:'expense',merchant_tokens:[],candidates:[
 {id:'m0',amount_minor:9000,currency:'CNY',amount_exponent:2,phrases:['本次','扣除']},
 {id:'m1',amount_minor:1000,currency:'CNY',amount_exponent:2,phrases:['金额']}],
};}
function reply(p){return {schema_version:1,decision:'suggest',amount_candidates:p.candidates.map((c,i)=>({candidate_id:c.id,amount_minor:c.amount_minor,currency:c.currency,
 role:i===0?'actual_paid':'unknown',evidence_refs:[c.id]})),selected_candidate_id:'m0',currency:p.currency,direction:p.direction,
 evidence_refs:['m0','m1'],confidence:950,refusal_reason:'none',merchant_normalized:null,category:null};}
function browser(value,p){return financeAiAdvice({status:value.decision==='suggest'?'suggestion':'review',requires_manual_confirmation:true,canonical_hint_id:'synthetic-guard',
 expires_at_ms:clock+90000,evidence:p,suggestion:{...value,requires_manual_confirmation:true}},
 {id:'synthetic-guard',currency:p.currency,direction:p.direction,amount_minor:null},clock);}
for(const role of ['actual_paid','actual_received','refund','original','discount','balance','fee'])test('unselected '+role+' requires its own evidence on server and web',()=>{
 const p=input(),r=reply(p);r.amount_candidates[1].role=role;
 assert.throws(()=>validateFinanceAiOutput(r,p),e=>e.code==='finance_ai_semantic_evidence_insufficient');assert.equal(browser(r,p),null);
});
test('a selected amount cannot borrow another candidate label',()=>{
 const p=input();p.candidates[0].phrases=['金额'];p.candidates[1].phrases=['本次','扣除'];const r=reply(p);
 assert.throws(()=>validateFinanceAiOutput(r,p));assert.equal(browser(r,p),null);
});
test('grounded positive advice remains manual-only and source-exact',()=>{
 const p=input(),before=JSON.stringify(p),r=reply(p),validated=validateFinanceAiOutput(r,p);
 assert.equal(validated.requires_manual_confirmation,true);assert(browser(r,p));assert.equal(JSON.stringify(p),before);
 assert.equal(validated.amount_candidates[0].amount_minor,9000);
});
test('uncertainty can retain an unknown role without inventing another payment',()=>{
 const p=input(),r=reply(p);r.decision='review';r.selected_candidate_id=null;r.confidence=500;r.refusal_reason='insufficient_evidence';
 assert.equal(validateFinanceAiOutput(r,p).requires_manual_confirmation,true);assert(browser(r,p));
});
