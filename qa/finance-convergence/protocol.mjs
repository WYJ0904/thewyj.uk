import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {financeAiRequest,validateFinanceAiEvidence} from '../../functions/_lib/finance-ai.mjs';
import {normalizeFinanceAiRoles} from '../../functions/_lib/finance-ai-provider.mjs';
const out=path.resolve(process.env.FINANCE_CONVERGENCE_OUTPUT);assert(out.startsWith(path.join(root,'docs/migration-evidence/finance-p04/convergence')+path.sep));await fs.mkdir(out,{recursive:false});
const rows=[];async function test(id,body){try{await body();rows.push({id,status:'PASS'});}catch(e){rows.push({id,status:'FAIL',error:e.stack});}}
const f=await fixture();let calls=0;const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:'@cf/meta/llama-3.1-8b-instruct-fp8',AI:{run:async()=>{calls++;throw Error('must not call unsupported provider');}}};
const req=(name,p={})=>financeAiRequest({env},f.account,'/api/finance/ai/'+name,p);
try{
 for(const protocol of ['roles-2','rich-1'])await test('known-incompatible-model-disabled-'+protocol,async()=>{env.FINANCE_AI_PROVIDER_PROTOCOL=protocol;assert.equal((await req('config')).available,false);assert.equal((await req('suggest',{event_id:'synthetic-source'})).status,'disabled');assert.equal(calls,0);});
 await test('supported-primary-can-be-configured-without-a-fallback',async()=>{env.FINANCE_AI_MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';assert.equal((await req('config')).available,true);assert.equal((await req('consent',{enabled:true,expected_revision:0})).consent.enabled,1);});
 await test('withdrawal-still-works-when-incompatible-model-disabled',async()=>{env.FINANCE_AI_MODEL='@cf/meta/llama-3.1-8b-instruct-fp8';assert.equal((await req('consent',{enabled:false,expected_revision:1})).consent.enabled,0);assert.equal(calls,0);});
 const frozen=JSON.parse(await fs.readFile(path.join(root,'qa/finance-p02/fixtures/matrix.json'),'utf8')).cases.filter(r=>r.group==='F');
 for(const row of frozen)await test('legacy-'+row.case_id+'-requires-provenance-and-roles',()=>{assert.throws(()=>normalizeFinanceAiRoles(row.response,{candidates:[]}));assert.throws(()=>validateFinanceAiEvidence(row.original_fields));});
 await test('disabled-ai-does-not-write-financial-facts',async()=>{assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,0);assert.equal(calls,0);});
}finally{await f.dispose();}
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,external_provider_calls:0,original_frozen_results_not_replaced:true},null,2));console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
