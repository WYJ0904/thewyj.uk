import assert from 'node:assert/strict';import test from 'node:test';
import {FINANCE_AI_ROLE_SCHEMA} from '../../functions/_lib/finance-ai-provider.mjs';
import {DATASET,packet,answer} from './cases.mjs';
import {schemaErrors,parse,grounded,metrics,roleAccuracy,unsupportedClaim} from './scoring.mjs';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
test('schema positive, missing fields and exact numeric types',()=>{
 const r=answer(packet());assert.deepEqual(schemaErrors(r,FINANCE_AI_ROLE_SCHEMA),[]);
 for(const value of [{...r,schema_version:'2'},{...r,confidence_per_mille:1.5},{...r,confidence_per_mille:1001}])assert(schemaErrors(value,FINANCE_AI_ROLE_SCHEMA).length);
 delete r.category;assert(schemaErrors(r,FINANCE_AI_ROLE_SCHEMA).some(s=>s.includes('category')));
});
test('malformed JSON is not silently repaired or completed',()=>{assert.equal(parse('{broken'),null);assert.equal(parse('```json\n{}\n```'),null);});
test('unselected movement assertions need their own evidence',()=>{
 const p=packet();p.candidates[2].phrases=['金额'];const r=answer(p);r.amount_roles[2].role='actual_paid';
 assert(grounded(r,p).includes('unproven_movement_role'));assert.equal(unsupportedClaim(r,p),true);
});
test('unselected opposite direction is not a source fact',()=>{
 const p=packet();const r=answer(p);r.amount_roles[0].role='actual_received';assert.equal(roleAccuracy(r,p),false);
});
test('source amount and currency are never scored by similarity',()=>{
 const p=packet(),r=answer(p);r.currency='USD';assert(grounded(r,p).includes('currency'));assert.equal(unsupportedClaim(r,p),true);
});
test('category/merchant errors do not contaminate role accuracy',()=>{
 const p=packet(),r=answer(p);r.merchant_normalized='';assert.equal(roleAccuracy(r,p),true);assert.equal(unsupportedClaim(r,p),true);
});
test('missing fields fail validity without pretending absence is a fabricated claim',()=>{
 assert.equal(unsupportedClaim({},packet()),false);assert(schemaErrors({},FINANCE_AI_ROLE_SCHEMA).length);
});
test('incomplete role list and duplicate candidate IDs fail role accuracy',()=>{
 const p=packet(),r=answer(p);r.amount_roles.pop();assert.equal(roleAccuracy(r,p),false);
 r.amount_roles.push({...r.amount_roles[0]});assert.equal(roleAccuracy(r,p),false);
});
test('malformed role arrays and elements cannot crash a report',()=>{
 const p=packet();for(const roles of ['m0',{},[null]])assert.doesNotThrow(()=>grounded({...answer(p),amount_roles:roles},p));
});
test('zero denominators are NOT_APPLICABLE, not 100 percent',()=>{
 const m=metrics([]);for(const v of Object.values(m)){assert.equal(v.value,null);assert.equal(v.denominator,0);assert.equal(v.status,'NOT_APPLICABLE');}
});
test('unsupported claim rate counts explicit claims independently of schema rejection',()=>{
 const m=metrics([{unsupported_claim:true,schema_valid:true},{unsupported_claim:false,schema_valid:false}]);
 assert.equal(m.unsupported_claim_rate.numerator,1);assert.equal(m.unsupported_claim_rate.denominator,2);assert.equal(m.unsupported_claim_rate.value,.5);
});
test('dataset provenance and safety contract cover A through H',()=>{
 assert.equal(new Set(DATASET.map(c=>c.id)).size,DATASET.length);
 assert.deepEqual([...new Set(DATASET.map(c=>c.category))].sort(),['A','B','C','D','E','F','G','H']);
 for(const c of DATASET){assert.equal(c.source.kind,'synthetic');assert(c.forbidden.includes('settlement_approval'));assert.equal(c.uncertainty_allowed,true);}
});
test('saved payload projection preserves all hashes, paired evidence and original failures',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/recorded-12.json',import.meta.url),'utf8'));
 assert.equal(fixture.synthetic_only,true);assert.equal(fixture.cases.length,12);
 assert.equal(fixture.cases.filter(c=>c.historical_status==='PASS').length,5);
 assert.equal(fixture.cases.filter(c=>parse(c.provider_response)===null).length,1);
 for(const c of fixture.cases)assert.equal(createHash('sha256').update(JSON.stringify(c.provider_response)).digest('hex'),c.payload_sha256);
 for(let i=0;i<6;i++){assert.equal(fixture.cases[i].id,fixture.cases[i+6].id);assert.deepEqual(fixture.cases[i].input,fixture.cases[i+6].input);}
});
