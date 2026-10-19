import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {createAutomaticFinanceTransaction,ensureTask21Schema} from '../../functions/_lib/task21-service.mjs';
const root=path.resolve(import.meta.dirname,'../..');const output=process.env.FINANCE_P03_OUTPUT;
assert.ok(output);await fs.mkdir(output,{recursive:true});
const file=path.join(output,'migration.json');try{await fs.access(file);throw Error('Preserve evidence')}catch(e){if(e.code!=='ENOENT')throw e;}
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic migration")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
const records=[];
try{
  const db=await mf.getD1Database('DB');
  for(const name of (await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)&&Number(n.slice(0,4))<27).sort())
    await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
  const account={id:'synthetic-p03-migration-owner'};const now=new Date().toISOString();
  await db.prepare(`INSERT INTO task12_users (id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
  VALUES (?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
  const old=await createAutomaticFinanceTransaction(db,account,'synthetic-old-device',{event_id:'synthetic-p03-old-event',fingerprint:'e'.repeat(64),payment_channel:'wechat',provider_reference:'',direction:'expense',amount_minor:64800,currency:'CNY',merchant:'synthetic merchant',counterparty:'',occurred_at_ms:1792368000000,received_at_ms:1792368000000,confidence:950,parser_version:'wechat-4'});
  await db.prepare(`INSERT INTO task21_notification_sync_operations (user_id,operation_id,device_id,operation_type,payload_digest,result_version,result_json,created_at)
  VALUES (?1,'synthetic-old-operation','synthetic-old-device','event.ingest',?2,0,?3,?4)`).bind(account.id,'f'.repeat(64),JSON.stringify({transaction_id:old.transaction_id}),now).run();
  const original=await db.prepare('SELECT id,amount_minor,currency FROM task16_finance_transactions WHERE id=?1').bind(old.transaction_id).first();
  const before=await db.prepare("SELECT value FROM task21_metadata WHERE key='schema_version'").first();assert.equal(before.value,'2');
  const statements=(await fs.readFile(path.join(root,'cloudflare/migrations/0027_payment_identity_lifecycle.sql'),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'').split(';').map(s=>s.trim()).filter(Boolean);
  let failure;
  try{await db.batch([...statements.slice(0,3).map(s=>db.prepare(s)),db.prepare('SELECT * FROM synthetic_missing_migration_table')])}catch(e){failure=e.stack}
  assert.ok(failure,'fault injection must actually fail');
  const columns=(await db.prepare('PRAGMA table_info(task21_notification_events)').all()).results.map(c=>c.name);
  assert.ok(!columns.includes('financial_phase'),'partial DDL must roll back');
  assert.deepEqual(await db.prepare('SELECT id,amount_minor,currency FROM task16_finance_transactions WHERE id=?1').bind(old.transaction_id).first(),original);
  assert.equal((await db.prepare("SELECT value FROM task21_metadata WHERE key='schema_version'").first()).value,'2');
  records.push({case_id:'M01-D1-FAILED-MIGRATION',status:'PASS',actual:{original,failure,partial_ddl_rolled_back:true,metadata:'2'},coverage:'REAL_D1_BATCH_FAILURE_INJECTION'});
  await db.batch(statements.map(s=>db.prepare(s)));
  const next=(await fs.readFile(path.join(root,'cloudflare/migrations/0028_payment_lifecycle_accounting.sql'),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'').split(';').map(s=>s.trim()).filter(Boolean);
  await db.batch(next.map(s=>db.prepare(s)));
  assert.equal((await db.prepare("SELECT value FROM task21_metadata WHERE key='schema_version'").first()).value,'4');
  assert.equal(await ensureTask21Schema(db),true);
  assert.deepEqual(await db.prepare('SELECT id,amount_minor,currency FROM task16_finance_transactions WHERE id=?1').bind(old.transaction_id).first(),original);
  const receipt=await db.prepare("SELECT result_json FROM task21_notification_sync_operations WHERE user_id=?1 AND operation_id='synthetic-old-operation'").bind(account.id).first();
  assert.equal(JSON.parse(receipt.result_json).transaction_id,old.transaction_id);
  records.push({case_id:'M02-D1-ADDITIVE-UPGRADE',status:'PASS',actual:{original,receipt,metadata:'4',old_server_readiness_v2:false},coverage:'REAL_PRE_P03_SCHEMA_UPGRADE_AND_OLD_RECEIPT_RETENTION'});
}catch(e){records.push({case_id:'M-HARNESS-FAIL',status:'FAIL',error:e.stack});process.exitCode=1}
finally{await fs.writeFile(file,JSON.stringify(records,null,2));await mf.dispose()}
console.log(JSON.stringify(records.map(r=>({case_id:r.case_id,status:r.status})),null,2));
