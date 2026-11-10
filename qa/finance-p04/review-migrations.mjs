import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Miniflare} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './fixture.mjs';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../finance-p03/phase-a/d1-snapshot.mjs';
import {ensureTask16Schema} from '../../functions/_lib/task16-service.mjs';
import {ensureTask21Schema,ingestNotificationEvents} from '../../functions/_lib/task21-service.mjs';
import {outUrl} from './output.mjs';
const baseline=path.resolve(process.env.FINANCE_P04_BASELINE_ROOT||fileURLToPath(new URL('../../docs/migration-evidence/finance-p04/local/baseline-modules',import.meta.url)));
const {ensureTask16Schema:previous16}=await import(pathToFileURL(path.join(baseline,'p04-pre-review-baseline/functions/_lib/task16-service.mjs')));
const {ensureTask21Schema:previous21}=await import(pathToFileURL(path.join(baseline,'p04-pre-review-baseline/functions/_lib/task21-service.mjs')));
const sql=(await readFile(new URL('../../cloudflare/migrations/0033_currency_default_review.sql',import.meta.url),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
const rows=[];
async function check(id,run){try{await run();rows.push({id,status:'PASS'})}catch(error){rows.push({id,status:'FAIL',error:error.stack})}console.log(rows.at(-1).status,id)}
const f=await fixture({before:33});let restored;
try{
 const original=await f.transaction('CNY',64800);
 const before=await dumpD1(f.db);
 await check('pre-review-version-is-readable-without-inventing-new-flags',async()=>{
  assert.equal(await previous16(f.db),true);assert.equal(await previous21(f.db),true);
  assert.equal(await ensureTask16Schema(f.db),true);assert.equal(await ensureTask21Schema(f.db),true);
 });
 await check('interrupted-review-DDL-rolls-back-view-columns-and-metadata',async()=>{
  await assert.rejects(()=>f.db.batch([...statements.map(s=>f.db.prepare(s)),f.db.prepare('INSERT INTO synthetic_review_missing VALUES(1)')]));
  assert.deepEqual(await dumpD1(f.db),before);
  assert.equal((await f.db.prepare('SELECT value FROM task16_metadata WHERE key=?1').bind('schema_version').first()).value,'4');
 });
 await f.db.batch(statements.map(s=>f.db.prepare(s)));
 await check('review-migration-preserves-all-old-money-IDs-and-receipt-relations',async()=>{
  const after=await dumpD1(f.db);
  for(const [table,records] of Object.entries(before.tables)){
   if(table==='task16_metadata'||table==='task21_metadata')continue;
   const projected=after.tables[table].map(row=>Object.fromEntries(Object.keys(records[0]||{}).map(key=>[key,row[key]])));
   assert.deepEqual(projected,records,table);
  }
  const row=await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(original.id).first();
  assert.equal(row.currency_review_required,0);assert.equal(row.currency_decision_source,'');assert.equal(row.amount_minor,64800);
 });
 await check('old-pre-review-server-binaries-refuse-upgraded-D1',async()=>{
  // Fresh binding avoids intentionally cached readiness from the pre-migration check.
  const mf=new Miniflare({modules:true,script:'export default{fetch(){return new Response("synthetic old server")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});
  try{const db=await mf.getD1Database('DB');await restoreD1(db,await dumpD1(f.db));assert.equal(await previous16(db),false);assert.equal(await previous21(db),false)}finally{await mf.dispose()}
 });
 const event={event_id:'synthetic-review-backup',fingerprint:'f'.repeat(64),source_package:'cmb.pb',source_type:'notification',event_type:'transaction',parser_version:'bank-notification-4',parse_status:'parsed',direction:'expense',currency:'USD',currency_evidence:'',amount_minor:10000,currency_review_required:true,currency_decision_source:'account_default',provider_reference:'SYNTH-REVIEW-BACKUP-001',payment_channel:'bank_card',confidence:950,occurred_at_ms:1000,received_at_ms:1000};
 const request={schema_version:1,device_id:'synthetic-review-backup-device',operations:[{operation_id:'synthetic-review-backup-operation',type:'event.ingest',payload:event}]};
 const first=await ingestNotificationEvents(f.db,f.account,request);
 await check('untracked-repeated-review-DDL-fails-without-resetting-money',async()=>{
  const snapshot=await dumpD1(f.db);await assert.rejects(()=>f.db.batch(statements.map(s=>f.db.prepare(s))));assert.deepEqual(await dumpD1(f.db),snapshot);
 });
 const snapshot=await dumpD1(f.db);
 restored=new Miniflare({modules:true,script:'export default{fetch(){return new Response("synthetic review restore")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});
 const copy=await restored.getD1Database('DB');await restoreD1(copy,snapshot);
 await check('logical-backup-restore-preserves-review-provenance-and-idempotent-receipt',async()=>{
  assert.deepEqual(await dumpD1(copy),snapshot);
  const replay=await ingestNotificationEvents(copy,f.account,request);assert.equal(replay.operation_results[0].transaction_id,first.operation_results[0].transaction_id);assert.equal(replay.operation_results[0].idempotent_replay,true);
  assert.equal((await copy.prepare('SELECT currency_review_required FROM task16_finance_transactions WHERE id=?1').bind(first.operation_results[0].transaction_id).first()).currency_review_required,1);
 });
 await check('standalone-review-SQLite-backup-is-integral-and-keeps-both-originals',async()=>{
  const file=fileURLToPath(new URL('review-backup.sqlite',outUrl));await writeSqliteSnapshot(file,snapshot);
  const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').get().n,2);assert.equal(db.prepare('SELECT currency,amount_minor FROM task16_finance_transactions WHERE id=?').get(original.id).amount_minor,64800)}finally{db.close()}
 });
 await check('partial-review-schema-cannot-commit-a-default-currency-capture',async()=>{
  const partial=await fixture({before:33});try{
   await partial.db.exec('ALTER TABLE task21_notification_events ADD COLUMN currency_review_required INTEGER NOT NULL DEFAULT 0');
   const beforePartial=await dumpD1(partial.db);
   await assert.rejects(()=>ingestNotificationEvents(partial.db,partial.account,request));
   assert.deepEqual(await dumpD1(partial.db),beforePartial);
  }finally{await partial.dispose()}
 });
}finally{await f.dispose();if(restored)await restored.dispose();await writeFile(new URL('review-migrations.json',outUrl),JSON.stringify({synthetic_only:true,rows},null,2)+'\n',{flag:'wx'})}
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
