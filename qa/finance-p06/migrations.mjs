import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {spawnSync} from 'node:child_process';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {dumpD1,restoreD1} from '../finance-p03/phase-a/d1-snapshot.mjs';
import {financeAiRequest} from '../../functions/_lib/finance-ai.mjs';
const out=path.resolve(process.env.FINANCE_P06_OUTPUT);assert(out.startsWith(path.join(root,'docs','migration-evidence','finance-p06')+path.sep));await fs.mkdir(out,{recursive:false});
const rows=[];async function test(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
const sql=await fs.readFile(path.join(root,'cloudflare/migrations/0034_finance_ai_assistance.sql'),'utf8');
const f=await fixture({before:34});let copy;
const env={WYJ_DB:f.db,FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:'@cf/synthetic/migration',AI:{run:()=>{throw Error('No model may run in a migration check');}}};
try{
 const tx=await f.transaction('CNY',12345,{id:'p06-original-core-id',payload:{note:'SYNTHETIC HUMAN EDIT'}});
 const before=await dumpD1(f.db);await fs.writeFile(path.join(out,'before.json'),JSON.stringify(before));
 await test('old-core-schema-fails-ai-closed',async()=>{const result=await financeAiRequest({env},f.account,'/api/finance/ai/config',{});assert.equal(result.available,false);});
 await test('actual-migration-partial-batch-rolls-back',async()=>{
  const split=spawnSync('python',[path.join(root,'qa/finance-p06/split-sql.py')],{input:sql,encoding:'utf8'});assert.equal(split.status,0,split.stderr);
  const statements=JSON.parse(split.stdout);assert(statements.length>=4);
  const commands=[...statements.slice(0,2),'INSERT INTO SYNTHETIC_MISSING_MIGRATION_TARGET VALUES(1)',...statements.slice(2)];
  let failure;try{await f.db.batch(commands.map(s=>f.db.prepare(s)));}catch(error){failure=error;}
  assert(failure);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'finance_ai_%'").first()).n,0);
  assert.deepEqual((await dumpD1(f.db)).tables,before.tables);return {expected_fault:String(failure.message),core_unchanged:true};
 });
 await test('retry-real-additive-migration-retains-all-core-tables',async()=>{
  await f.db.exec(sql.replace(/\r?\n/g,' '));const migrated=await dumpD1(f.db);
  for(const [name,data]of Object.entries(before.tables))assert.deepEqual(migrated.tables[name],data,name);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'finance_ai_%'").first()).n,4);
  assert.equal((await financeAiRequest({env},f.account,'/api/finance/ai/config',{})).available,true);
 });
 await test('repeat-migration-is-idempotent-with-existing-state',async()=>{
  await financeAiRequest({env},f.account,'/api/finance/ai/consent',{enabled:true,expected_revision:0});
  const saved=await dumpD1(f.db);await f.db.exec(sql.replace(/\r?\n/g,' '));assert.deepEqual((await dumpD1(f.db)).tables,saved.tables);
 });
 await test('actual-d1-logical-backup-cold-restores-core-and-consent',async()=>{
  const saved=await dumpD1(f.db);await fs.writeFile(path.join(out,'backup.json'),JSON.stringify(saved));
  copy=new Miniflare({modules:true,script:'export default {fetch(){return new Response("isolated P06 restore")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});
  const db=await copy.getD1Database('DB');await restoreD1(db,saved);assert.deepEqual((await dumpD1(db)).tables,saved.tables);
  const restored=await db.prepare('SELECT id,amount_minor,currency,note,occurred_at_ms FROM task16_finance_transactions WHERE user_id=?1 AND id=?2').bind(f.account.id,tx.id).first();
  assert.equal(restored.id,'p06-original-core-id');assert.equal(restored.amount_minor,12345);assert.equal(restored.currency,'CNY');assert.equal(restored.note,'SYNTHETIC HUMAN EDIT');
  assert.equal((await db.prepare('SELECT enabled FROM finance_ai_consents WHERE user_id=?1').bind(f.account.id).first()).enabled,1);return {original_id:restored.id,tables:Object.keys(saved.tables).length};
 });
 await test('old-backup-is-valid-core-but-not-a-model-environment',async()=>{
  const temp=new Miniflare({modules:true,script:'export default {fetch(){return new Response("isolated old restore")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});
  try{const db=await temp.getD1Database('DB');await restoreD1(db,before);const config=await financeAiRequest({env:{...env,WYJ_DB:db}},f.account,'/api/finance/ai/config',{});assert.equal(config.available,false);assert.equal((await db.prepare('SELECT amount_minor FROM task16_finance_transactions WHERE id=?1').bind(tx.id).first()).amount_minor,12345);}finally{await temp.dispose();}
 });
 await test('no-ai-migration-can-be-a-financial-data-rollback',async()=>{assert(!/DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+task16|ALTER\s+TABLE\s+task16/i.test(sql));assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,1);});
}finally{if(copy)await copy.dispose();await f.dispose();}
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,scope:'Actual local D1 SQL/batch rollback and cold logical restore; no Production or Time Travel',formal_database_restore:'NOT_TESTED'},null,2));
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
