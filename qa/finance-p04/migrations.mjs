import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixture.mjs';
import { dumpD1, restoreD1, writeSqliteSnapshot } from '../finance-p03/phase-a/d1-snapshot.mjs';
import { ensureTask16Schema } from '../../functions/_lib/task16-service.mjs';
import { ensureTask21Schema } from '../../functions/_lib/task21-service.mjs';
import { ensureFxSchema, transactionReferences } from '../../functions/_lib/finance-fx.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const baseline=path.resolve(process.env.FINANCE_P04_BASELINE_ROOT || fileURLToPath(new URL('../../docs/migration-evidence/finance-p04/local/baseline-modules',import.meta.url)));
const {ensureTask16Schema:oldTask16}=await import(pathToFileURL(path.join(baseline,'p03-server-baseline/functions/_lib/task16-service.mjs')));
const {ensureTask21Schema:oldTask21,ingestNotificationEvents:oldIngest}=await import(pathToFileURL(path.join(baseline,'p03-server-baseline/functions/_lib/task21-service.mjs')));
import { ingestNotificationEvents } from '../../functions/_lib/task21-service.mjs';
import { outUrl as out } from './output.mjs';

const f=await fixture({before:31}), rows=[];
async function check(id,run){try{const actual=await run();rows.push({id,status:'PASS',actual});console.log('PASS',id)}catch(error){rows.push({id,status:'FAIL',error:error.stack});console.error('FAIL',id,error.message)}}
// D1 batch is the migration transaction: complete CREATE TRIGGER bodies stay together.
const sql=(await Promise.all(['0031_finance_currency_fx.sql','0032_notification_currency_units.sql'].map(name=>readFile(new URL('../../cloudflare/migrations/'+name,import.meta.url),'utf8')))).join('\n').replace(/\/\*[\s\S]*?\*\//g,'');
const statements=[];let remaining=sql.trim();
while(remaining){const end=/^CREATE TRIGGER/i.test(remaining)?remaining.indexOf('END;')+3:remaining.indexOf(';');assert.ok(end>=0);statements.push(remaining.slice(0,end+1));remaining=remaining.slice(end+1).trim()}
let restored;
try{
  const cny=await f.transaction('CNY',64800), legacy=await f.transaction('CNY',12345);
  await f.db.prepare('UPDATE task16_finance_transactions SET currency=?2 WHERE id=?1').bind(legacy.id,'JPY').run();
  const oldEvent={event_id:'synthetic-p04-old-jpy-wire',fingerprint:'b'.repeat(64),source_package:'cmb.pb',source_type:'notification',event_type:'transaction',
    parser_version:'bank-notification-4',parse_status:'parsed',direction:'expense',amount_minor:12345,currency:'JPY',payment_channel:'bank_card',
    confidence:950,occurred_at_ms:1792400000000,received_at_ms:1792400000000};
  const oldRequest={schema_version:'1',device_id:'synthetic-old-device',operations:[{operation_id:'synthetic-p04-old-jpy-operation',type:'event.ingest',payload:oldEvent}]};
  const oldReceipt=await oldIngest(f.db,f.account,oldRequest);
  const weakOperation={...oldRequest.operations[0],operation_id:'synthetic-p04-legacy-weak-jpy-operation',payload:{...oldEvent,event_id:'synthetic-p04-legacy-weak-jpy-event'}};
  const weakRequest={...oldRequest,operations:[weakOperation]};
  const weakReceipt=await oldIngest(f.db,f.account,weakRequest);
  const legacyDigest=createHash('sha256').update(JSON.stringify(weakOperation,Object.keys(weakOperation).sort())).digest('hex');
  await f.db.prepare('UPDATE task21_notification_sync_operations SET payload_digest=?1 WHERE user_id=?2 AND operation_id=?3').bind(legacyDigest,f.account.id,weakOperation.operation_id).run();
  const before=await dumpD1(f.db);
  await writeSqliteSnapshot(fileURLToPath(new URL('before-p04.sqlite',out)),before);
  await check('pre-migration-server-and-CNY-compatible',async()=>{assert.equal(await ensureTask16Schema(f.db),true);assert.equal(await ensureTask21Schema(f.db),true);assert.equal(await oldTask16(f.db),true);assert.equal(await oldTask21(f.db),true)});
  await check('migration-transaction-failure-rolls-back-DDL-and-money',async()=>{
    await assert.rejects(()=>f.db.batch([...statements.map(sql=>f.db.prepare(sql)),f.db.prepare('INSERT INTO synthetic_deliberately_missing_table VALUES(1)')]));
    const columns=(await f.db.prepare('PRAGMA table_info(task16_finance_transactions)').all()).results;assert.equal(columns.some(row=>row.name==='amount_exponent'),false);
    assert.deepEqual((await dumpD1(f.db)).tables,before.tables);await assert.rejects(()=>ensureFxSchema(f.db));
  });
  await f.db.batch(statements.map(sql=>f.db.prepare(sql)));
  await check('additive-upgrade-keeps-original-amount-ID-time-and-receipts',async()=>{
    for(const row of before.tables.task16_finance_transactions){const after=await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(row.id).first();const {amount_exponent,...unchanged}=after;assert.deepEqual(unchanged,row);assert.equal(amount_exponent,row.currency==='JPY'?null:2)}
    for(const table of ['task16_finance_operations','task16_finance_audit','task21_notification_events','task21_ingest_operations'])
      if(before.tables[table])assert.deepEqual((await dumpD1(f.db)).tables[table],before.tables[table]);
    assert.equal(await ensureFxSchema(f.db),true);assert.equal(await ensureTask21Schema(f.db),true);
  });
  await check('legacy-JPY-is-not-rescaled-or-silently-converted',async()=>{
    const result=await transactionReferences(f.db,f.account.id,{transaction_ids:[legacy.id],display_currency:'CNY'},{fetcher:()=>{throw Error('must not fetch')}});
    assert.deepEqual(result.references,{});assert.equal(result.unavailable[0].reason,'currency_unit_review_required');
    const row=await f.db.prepare('SELECT amount_minor,currency FROM task16_finance_transactions WHERE id=?1').bind(legacy.id).first();assert.equal(row.amount_minor,12345);assert.equal(row.currency,'JPY');
  });
  await check('old-server-binaries-reject-upgraded-D1',async()=>{assert.equal(await oldTask16(f.db),false);assert.equal(await oldTask21(f.db),false)});
  await check('legacy-unitless-JPY-receipt-replays-exact-money-and-identity-across-both-migrations',async()=>{
    const replay=await ingestNotificationEvents(f.db,f.account,oldRequest);
    const {idempotent_replay,...actual}=replay.operation_results[0];
    assert.equal(idempotent_replay,true);assert.deepEqual(actual,oldReceipt.operation_results[0]);
    assert.equal(actual.event.amount_minor,12345);assert.equal(actual.event.currency,'JPY');
    const stamp=await f.db.prepare('SELECT * FROM task21_currency_units WHERE user_id=?1 AND event_id=?2').bind(f.account.id,oldEvent.event_id).first();assert.equal(stamp,null);
    const receiptBefore=before.tables.task21_notification_sync_operations.find(row=>row.operation_id===oldRequest.operations[0].operation_id);
    assert.deepEqual(await f.db.prepare('SELECT * FROM task21_notification_sync_operations WHERE user_id=?1 AND operation_id=?2').bind(f.account.id,receiptBefore.operation_id).first(),receiptBefore);
    return{original_wire_unchanged:true,transaction_id:actual.transaction_id};
  });
  await check('new-unitless-JPY-operation-rejected-without-rewriting-the-legacy-queue',async()=>{
    await assert.rejects(()=>ingestNotificationEvents(f.db,f.account,{...oldRequest,operations:[{...oldRequest.operations[0],operation_id:'synthetic-new-unproven-jpy-operation',payload:{...oldEvent,event_id:'synthetic-new-unitless-jpy'}}]}),error=>error.code==='currency_unit_review_required');
    assert.equal((await f.db.prepare('SELECT count(*) n FROM task21_notification_events WHERE event_id=?1').bind('synthetic-new-unitless-jpy').first()).n,0);
  });
  await check('legacy-weak-digest-JPY-receipt-verifies-stored-facts-and-rejects-changed-money',async()=>{
    const result=(await ingestNotificationEvents(f.db,f.account,weakRequest)).operation_results[0];
    const {idempotent_replay,legacy_receipt_verified,...actual}=result;
    assert.equal(idempotent_replay,true);assert.equal(legacy_receipt_verified,true);assert.deepEqual(actual,weakReceipt.operation_results[0]);
    await assert.rejects(()=>ingestNotificationEvents(f.db,f.account,{...weakRequest,operations:[{...weakOperation,payload:{...weakOperation.payload,amount_minor:99999}}]}),error=>error.code==='operation_id_conflict');
    assert.equal((await f.db.prepare('SELECT amount_minor FROM task21_notification_events WHERE user_id=?1 AND event_id=?2').bind(f.account.id,weakOperation.payload.event_id).first()).amount_minor,12345);
  });
  await check('untracked-repeated-DDL-rejected-without-clearing-data',async()=>{await assert.rejects(()=>f.db.batch(statements.map(sql=>f.db.prepare(sql))));assert.equal((await f.db.prepare('SELECT amount_minor FROM task16_finance_transactions WHERE id=?1').bind(cny.id).first()).amount_minor,64800)});
  const upgraded=await dumpD1(f.db);await writeSqliteSnapshot(fileURLToPath(new URL('after-p04.sqlite',out)),upgraded);
  restored=new Miniflare({modules:true,script:'export default{fetch(){return new Response("synthetic restore")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});
  const restoredDb=await restored.getD1Database('DB');await restoreD1(restoredDb,upgraded);
  await check('D1-logical-backup-restore-keeps-every-table-and-new-metadata',async()=>{const actual=await dumpD1(restoredDb);assert.deepEqual(actual.tables,upgraded.tables);assert.equal(await ensureFxSchema(restoredDb),true);return{tables:Object.keys(actual.tables).length,transport:'logical D1 restore'}});
  await check('standalone-SQLite-backup-reopens-without-data-loss',async()=>{const db=new DatabaseSync(fileURLToPath(new URL('after-p04.sqlite',out)),{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('SELECT amount_minor FROM task16_finance_transactions WHERE id=?').get(cny.id).amount_minor,64800);return{tables:Object.keys(upgraded.tables).length}}finally{db.close()}});
  await check('partially-added-column-cannot-enable-JPY-before-migration-commit',async()=>{
    const partial=await fixture({before:31});try{
      await partial.db.exec('ALTER TABLE task16_finance_transactions ADD COLUMN amount_exponent INTEGER');
      await assert.rejects(()=>partial.transaction('JPY',100),error=>error.code==='currency_unit_capability_required');
      assert.equal((await partial.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n,0);
    }finally{await partial.dispose()}
  });
}finally{await f.dispose();if(restored)await restored.dispose();await writeFile(new URL('migrations.json',out),JSON.stringify({synthetic_only:true,rows},null,2)+'\n')}
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
