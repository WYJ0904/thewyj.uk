import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {createAutomaticFinanceTransaction,ensureTask21Schema} from '../../../functions/_lib/task21-service.mjs';

const root=path.resolve(import.meta.dirname,'../../..');const output=process.env.FINANCE_P03_OUTPUT;
assert.ok(output);await fs.mkdir(output,{recursive:true});const file=path.join(output,'migration.ndjson');
try{await fs.access(file);throw Error('Preserve every migration run')}catch(e){if(e.code!=='ENOENT')throw e;}
const baseline=path.join(root,'docs/migration-evidence/finance-p03/closeout/baseline-v3/functions/_lib');
const old=await import(pathToFileURL(path.join(baseline,'task21-service.mjs')));
const oldApi=await import(pathToFileURL(path.join(baseline,'task21-api.mjs')));
const make=(folder)=>new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic migration")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
const active=path.join(output,'active');let mf=make(active);let db=await mf.getD1Database('DB');const records=[];
async function snapshot(connection) {
  const schema=(await connection.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
  const tables=[];
  for(const item of schema.filter(s=>s.type==='table')) {
    assert.match(item.name,/^[A-Za-z0-9_]+$/);
    tables.push({name:item.name,rows:(await connection.prepare('SELECT * FROM "'+item.name+'" ORDER BY rowid').all()).results});
  }
  const sequences=(await connection.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
  return {synthetic_only:true,schema,tables,sequences};
}
async function restore(snapshot) {
  assert.equal(snapshot.synthetic_only,true);
  const runtime=make();const connection=await runtime.getD1Database('DB');
  try {
    await connection.batch(snapshot.schema.filter(s=>s.type==='table').map(s=>connection.prepare(s.sql)));
    const inserts=[connection.prepare('PRAGMA defer_foreign_keys=ON')];
    for(const table of snapshot.tables)for(const row of table.rows) {
      const columns=Object.keys(row);assert.ok(columns.every(c=>/^[A-Za-z0-9_]+$/.test(c)));
      inserts.push(connection.prepare('INSERT INTO "'+table.name+'" ('+columns.map(c=>'"'+c+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...columns.map(c=>row[c])));
    }
    await connection.batch(inserts);
    // Deleted historical numeric IDs must not be reused after restoring a snapshot.
    const sequenceStatements=[];
    for(const row of snapshot.sequences) {
      assert.ok(Number.isSafeInteger(row.seq)&&row.seq>=0);
      sequenceStatements.push(connection.prepare('INSERT INTO sqlite_sequence(name,seq) SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?1)').bind(row.name,row.seq));
      sequenceStatements.push(connection.prepare('UPDATE sqlite_sequence SET seq=MAX(seq,?2) WHERE name=?1').bind(row.name,row.seq));
    }
    if(sequenceStatements.length)await connection.batch(sequenceStatements);
    const indices=snapshot.schema.filter(s=>s.type!=='table').map(s=>connection.prepare(s.sql));if(indices.length)await connection.batch(indices);
    return {runtime,connection};
  }catch(error){await runtime.dispose();throw error;}
}

const account={id:'synthetic-closeout-db-owner'};const now=new Date().toISOString();
const sql=(text)=>text.replace(/\/\*[\s\S]*?\*\//g,'').split(';').map(s=>s.trim()).filter(Boolean);
async function check(id,fn){let actual,error;try{actual=await fn()}catch(e){error=e.stack;process.exitCode=1}const row={case_id:id,status:error?'FAIL':'PASS',actual,error:error||'',synthetic_only:true};records.push(row);await fs.appendFile(file,JSON.stringify(row)+'\n')}
const rows=(connection)=>connection.prepare('SELECT id,amount_minor,currency FROM task16_finance_transactions ORDER BY id').all().then(r=>r.results);
const event=(id)=>({event_id:id,fingerprint:'e'.repeat(64),payment_channel:'wechat',source_package:'com.tencent.mm',provider_reference:'',direction:'expense',amount_minor:3400,currency:'CNY',merchant:'synthetic',counterparty:'',occurred_at_ms:1792368000000,received_at_ms:1792368000000,confidence:950,parser_version:'wechat-4'});
try {
  for(const name of (await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)&&!n.startsWith('0028_')).sort())
    await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
  await db.prepare(`INSERT INTO task12_users (id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
    VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
  const original=await createAutomaticFinanceTransaction(db,account,'synthetic-db-device',event('synthetic-old-event'));
  await db.prepare(`INSERT INTO task21_notification_sync_operations(user_id,operation_id,device_id,operation_type,payload_digest,result_version,result_json,created_at)
    VALUES(?1,'synthetic-original-operation','synthetic-db-device','event.ingest',?2,0,?3,?4)`).bind(account.id,'f'.repeat(64),JSON.stringify(original),now).run();
  assert.equal(await old.ensureTask21Schema(db),true);assert.equal(await ensureTask21Schema(db),false);
  const priorRows=await rows(db);
  // Simulate a durable allocation watermark whose later rows no longer exist.
  await db.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'task11_learning_sync_changes',700 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='task11_learning_sync_changes')").run();
  await db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,700) WHERE name='task11_learning_sync_changes'").run();
  const snapshotV3=await snapshot(db);await fs.writeFile(path.join(output,'snapshot-v3.json'),JSON.stringify(snapshotV3));
  await mf.dispose();const restarted=await restore(snapshotV3);mf=restarted.runtime;db=restarted.connection;
  const statements=sql(await fs.readFile(path.join(root,'cloudflare/migrations/0028_payment_lifecycle_accounting.sql'),'utf8'));
  await check('DM01-INTERRUPTION-ROLLBACK',async()=>{
    let failure;try{await db.batch([...statements.slice(0,2).map(s=>db.prepare(s)),db.prepare('SELECT * FROM synthetic_missing_closeout_table')])}catch(e){failure=e.stack}
    assert.ok(failure);assert.deepEqual(await rows(db),priorRows);
    const columns=(await db.prepare('PRAGMA table_info(task21_notification_events)').all()).results.map(r=>r.name);
    assert.ok(!columns.includes('lifecycle_operation'));assert.equal(await old.ensureTask21Schema(db),true);return {failure,rows:priorRows,metadata:'3'};
  });
  await check('DM02-RETRY-ADDITIVE-UPGRADE',async()=>{
    await db.batch(statements.map(s=>db.prepare(s)));assert.equal(await ensureTask21Schema(db),true);assert.equal(await old.ensureTask21Schema(db),false);
    assert.deepEqual(await rows(db),priorRows);
    const receipt=await db.prepare("SELECT result_json FROM task21_notification_sync_operations WHERE operation_id='synthetic-original-operation'").first();
    assert.equal(JSON.parse(receipt.result_json).transaction_id,original.transaction_id);return {rows:priorRows,receipt,metadata:'4'};
  });
  await check('DM03-REPEATED-DDL-FAILS-CLOSED',async()=>{
    await assert.rejects(()=>db.batch(statements.map(s=>db.prepare(s))),/duplicate column/);assert.deepEqual(await rows(db),priorRows);
    assert.equal(await ensureTask21Schema(db),true);return {rows:await rows(db),metadata:'4',raw_ddl_replay:'REFUSED_NOT_A_DESTRUCTIVE_RETRY'};
  });
  await check('DM04-ACTUAL-OLD-API-FAILS-READINESS',async()=>{
    const response=await oldApi.handleTask21Request({request:new Request('https://synthetic.invalid/api/notification/ingest',{method:'POST',body:'{}'}),env:{WYJ_DB:db,
      TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK21_NOTIFICATION_WRITES_ENABLED:'true'},data:{requestId:'synthetic-closeout'}});
    const body=await response.json();assert.equal(response.status,503);assert.equal(body.code,'task21_schema_not_ready');assert.deepEqual(await rows(db),priorRows);
    return {http_status:response.status,body,baseline_module:'81d5aa7 actual API/service/model'};
  });
  await createAutomaticFinanceTransaction(db,account,'synthetic-db-device',event('synthetic-new-after-upgrade'));
  const newRows=await rows(db);assert.equal(newRows.length,2);
  const snapshotV4=await snapshot(db);await fs.writeFile(path.join(output,'snapshot-v4.json'),JSON.stringify(snapshotV4));
  await mf.dispose();mf=null;
  await check('DM05-CLOSED-SNAPSHOT-RESTORE-V3-AND-V4',async()=>{
    const snapshots=[];
    for(const [version,expected,data] of [['3',priorRows,snapshotV3],['4',newRows,snapshotV4]]) {
      const serialized=JSON.stringify(data);const digest=createHash('sha256').update(serialized).digest('hex');
      const restored=await restore(JSON.parse(serialized));
      try {
        assert.deepEqual(await rows(restored.connection),expected);
        assert.equal(await old.ensureTask21Schema(restored.connection),version==='3');assert.equal(await ensureTask21Schema(restored.connection),version==='4');
        const after=await snapshot(restored.connection);assert.deepEqual(after.tables,data.tables);assert.deepEqual(after.sequences,data.sequences);
        snapshots.push({version,rows:expected,sha256:digest,tables:data.tables.length,sequences:data.sequences,mode:'LOGICAL_SQL_SCHEMA_AND_ROWS_RESTORE_IN_NEW_D1_RUNTIME'});
      } finally {await restored.runtime.dispose()}
    }
    return {snapshots,note:'v3 snapshot predates the new write. New writes must remain fenced; this is not lossless database downgrade.'};
  });
} finally {if(mf)await mf.dispose()}
console.log(JSON.stringify(records.map(({case_id,status})=>({case_id,status}))));
