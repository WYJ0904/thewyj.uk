import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {root} from '../finance-p04/fixture.mjs';

const label=process.env.AERIS_P0_AI_LABEL;assert(/^r[1-9][0-9]*$/.test(label||''));
const out=path.join(root,'docs/migration-evidence/p0-ai','remote-worker-local-'+label);
await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
const bundle=path.join(out,'worker.mjs');
await build({entryPoints:[path.join(root,'qa/p0-ai/remote-worker.mjs')],outfile:bundle,bundle:true,platform:'browser',format:'esm',target:'es2022'});
const databaseId='08ced2a0-6f77-4550-a34e-2b20fd7119db',token='synthetic-local-only-'.padEnd(43,'x');
const mf=new Miniflare({modules:true,scriptPath:bundle,compatibilityDate:'2026-08-06',d1Databases:['QA_DB'],d1Persist:false,
  bindings:{P0_AI_QA_MODE:'isolated-synthetic-only',P0_AI_QA_DATABASE_ID:databaseId,P0_AI_QA_TOKEN:token}});
const rows=[];
async function test(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
const request=(name,auth='Bearer '+token)=>mf.dispatchFetch('https://synthetic-qa.invalid/run/'+name,{method:'POST',headers:{authorization:auth}});
try{
  const db=await mf.getD1Database('QA_DB');
  for(const file of (await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort()){
    await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',file),'utf8')).replace(/\r?\n/g,' '));
  }
  await test('unauthorized-request-does-not-write',async()=>{
    assert.equal((await request('quota','Bearer wrong')).status,401);
    assert.equal((await request('quota','Bearer '+'é'.repeat(token.length))).status,401);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task12_users').first()).n,0);
  });
  await test('missing-database-marker-refuses-before-seeding',async()=>{
    const response=await request('quota');assert.equal(response.status,503);assert.equal((await response.json()).error_code,'qa_environment_unverified');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task12_users').first()).n,0);
  });
  await db.exec('CREATE TABLE p0_ai_qa_environment(environment_key TEXT PRIMARY KEY,database_id TEXT NOT NULL)');
  await db.prepare('INSERT INTO p0_ai_qa_environment(environment_key,database_id) VALUES(?1,?2)').bind('aeris-p0-ai-isolated-only','synthetic-wrong-database').run();
  await test('mismatched-database-marker-refuses-before-seeding',async()=>{
    assert.equal((await request('quota')).status,503);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task12_users').first()).n,0);
  });
  await db.prepare('UPDATE p0_ai_qa_environment SET database_id=?1').bind(databaseId).run();
  for(const name of ['quota','concurrent-month','event-cap','late-storage-fault','retry-lease'])await test('actual-worker-d1-'+name,async()=>{
    const response=await request(name),result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.status,'PASS');assert.equal(result.external_model_calls,0);assert.equal(result.cleanup_complete,true);
    assert.match(result.prefix,/^synthetic-p0-ai-[a-f0-9]{32}$/);return result;
  });
  await test('owned-synthetic-rows-and-trigger-cleaned',async()=>{
    for(const table of ['task12_users','finance_ai_observations','finance_ai_decisions','finance_ai_budgets','task21_notification_pending_hints','task16_finance_transactions']){
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,0,table);
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'p0_ai_qa_abort_%'").first()).n,0);
  });
}finally{await mf.dispose();}
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,external_model_calls:0,remote_operations:0,scope:'Local workerd Worker/D1 binding; production service code and in-memory mock provider'},null,2));
console.log(JSON.stringify({PASS:rows.filter(row=>row.status==='PASS').length,FAIL:rows.filter(row=>row.status==='FAIL').length,out}));
if(rows.some(row=>row.status==='FAIL'))process.exitCode=1;
