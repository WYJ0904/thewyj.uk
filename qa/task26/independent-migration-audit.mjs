import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Miniflare} from 'miniflare';

// Synthetic local D1 only. No deployment config, credentials or remote bindings.
const root=path.resolve(import.meta.dirname,'../..');
const evidence=path.join(root,'.wrangler/task26-independent-qa');
await mkdir(evidence,{recursive:true});
const directory=await mkdtemp(path.join(evidence,'migration-'));
const names=['BLANK','HISTORY','RESTORED','ROLLBACK','INTERRUPTED'];
const options={modules:true,script:'export default{fetch(){return new Response("local migration audit")}}',
  compatibilityDate:'2026-08-06',d1Databases:names,resourcePersistencePath:path.join(directory,'state')};
let mf=new Miniflare(options),groups=0;
const results=[];
const check=label=>{results.push({status:'PASS',label});console.log(`PASS ${++groups}: ${label}`);};
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const migrations=path.join(root,'cloudflare/migrations');
const oldNames=(await readdir(migrations)).filter(name=>/^\d{4}_.+\.sql$/.test(name)&&name<'0026_').sort();
const sql=await readFile(path.join(migrations,'0026_wrong_book_review.sql'),'utf8');
const statements=sql.trim().split(/;\s*(?=CREATE)/i).map(value=>value.trim().replace(/;$/,''));
assert.equal(statements.length,4,'Update the interruption fixture deliberately if migration structure changes');
const execute=(db,value)=>db.exec(value.replace(/\r?\n/g,' '));
async function oldSchema(db){for(const name of oldNames)await execute(db,await readFile(path.join(migrations,name),'utf8'));}
async function snapshot(db){
  const schema=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all()).results
    .filter(row=>!row.name.startsWith('sqlite_')&&!row.name.startsWith('_cf_'));
  const tables={};
  for(const row of schema.filter(row=>row.type==='table')){
    tables[row.name]=(await db.prepare(`SELECT * FROM ${quote(row.name)}`).all()).results
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  }
  const sequences=(await db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
  return {schema,tables,sequences};
}
async function restore(db,backup){
  for(const row of backup.schema.filter(row=>row.type==='table'))await db.prepare(row.sql).run();
  const inserts=[db.prepare('PRAGMA defer_foreign_keys = ON')];
  for(const [table,rows] of Object.entries(backup.tables))for(const row of rows){
    const columns=Object.keys(row);
    inserts.push(db.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(key=>row[key])));
  }
  for(const row of backup.sequences){
    inserts.push(db.prepare('DELETE FROM sqlite_sequence WHERE name=?1').bind(row.name));
    inserts.push(db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?1,?2)').bind(row.name,row.seq));
  }
  await db.batch(inserts);
  for(const row of backup.schema.filter(row=>row.type!=='table'))await db.prepare(row.sql).run();
}
const now='2026-01-01T00:00:00.000Z';
async function user(db,id){
  await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
    VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(id,now).run();
}
async function seedHistory(db){
  await user(db,'audit-one');await user(db,'audit-two');
  await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind)
    VALUES(?2,'audit-one',1,?1,?1,'2026-12-31T00:00:00.000Z','browser')`).bind(now,'sha256$'+'0'.repeat(64)).run();
  await db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,is_lifetime,source,source_ref,metadata_json,created_at,updated_at)
    VALUES('audit-membership','audit-one','dual_language_lifetime',?1,1,'test','audit-membership','{}',?1,?1)`).bind(now).run();
  for(const id of ['audit-one','audit-two'])await db.prepare(`INSERT INTO task11_learning_sync_records(user_id,data_type,record_id,payload_json,updated_at,client_id,client_version,created_at,server_updated_at)
    VALUES(?1,'wrong_book','audit-legacy-record',?2,?3,'audit-client','1',?3,?3)`).bind(id,JSON.stringify({word:'apple',wrong_count:7,correct_answer:'苹果',language:'english'}),now).run();
  await db.prepare(`INSERT INTO task26_question_tickets(id,user_id,language,knowledge_id,question_id,question_json,point_json,course_version,algorithm_version,mode,issued_at,expires_at)
    VALUES('audit-old-ticket','audit-one','english','old-point','old-question','{}','{}','old-course','mastery-v1','adaptive',?1,'2026-12-31T00:00:00.000Z')`).bind(now).run();
  await db.prepare(`INSERT INTO task26_learning_events(user_id,event_id,ticket_id,language,knowledge_id,question_id,family,kind,correct,difficulty,accepted_at,algorithm_version,source,platform,channel,input_digest)
    VALUES('audit-one','audit-old-event','audit-old-ticket','english','old-point','old-question','old-family','answer_submitted',0,1,?1,'mastery-v1','adaptive','browser','stable',?2)`).bind(now,'a'.repeat(64)).run();
  await db.prepare(`INSERT INTO task26_mastery_states(user_id,language,knowledge_id,score,confidence,algorithm_version,state_version,last_event_seq,state_json,updated_at)
    VALUES('audit-one','english','old-point',20,0.2,'mastery-v1',1,1,'{"historical":true}',?1)`).bind(now).run();
  await db.prepare("UPDATE task25_feature_flags SET enabled=1,channels_json='[\"stable\"]',rollout_basis_points=1234 WHERE flag_key='adaptive_review'").run();
}
const eventFields=['user_id','event_id','attempt_id','profile','language','record_id','review_id','kind','correct','corrects','accepted_at','input_digest','algorithm_version'];
const eventBase={user_id:'audit-one',profile:'我',language:'english',record_id:'audit-record',review_id:'audit-review',kind:'answer',correct:1,corrects:null,accepted_at:now,input_digest:'b'.repeat(64),algorithm_version:'wrong-review-v1'};
function insertEvent(db,patch={}){
  const row={...eventBase,event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),...patch};
  return db.prepare(`INSERT INTO task26_wrong_review_events (${eventFields.join(',')}) VALUES (${eventFields.map(()=>'?').join(',')})`).bind(...eventFields.map(key=>row[key])).run();
}
function insertState(db,{user_id='audit-one',language='english',state_json='{}'}={}){
  return db.prepare('INSERT INTO task26_wrong_review_states(user_id,profile,language,review_id,last_event_seq,state_json) VALUES(?1,\'我\',?2,\'audit-review\',1,?3)').bind(user_id,language,state_json).run();
}
try{
  let blank=await mf.getD1Database('BLANK');
  await oldSchema(blank);await execute(blank,sql);
  assert.equal((await blank.prepare('SELECT COUNT(*) AS n FROM task12_users').first()).n,0);
  assert.equal((await blank.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('task26_wrong_review_events','task26_wrong_review_states','idx_task26_wrong_review_replay','task26_wrong_review_immutable')").first()).n,4);
  check('empty isolated D1 applies the complete 0001–0026 chain without inventing accounts');
  let history=await mf.getD1Database('HISTORY');await oldSchema(history);await seedHistory(history);
  const backup=await snapshot(history);
  await writeFile(path.join(directory,'pre-0026-backup.json'),JSON.stringify(backup,null,2));
  await execute(history,sql);
  const migrated=await snapshot(history);
  for(const [table,rows] of Object.entries(backup.tables))assert.deepEqual(migrated.tables[table],rows,`Migration changed ${table}`);
  assert.deepEqual(migrated.schema.filter(row=>!row.name.includes('wrong_review')),backup.schema);
  check(`historical upgrade preserves all ${Object.keys(backup.tables).length} legacy tables, accounts, sessions, membership, flags and nonempty old Task26 history`);
  await execute(history,sql);assert.deepEqual(await snapshot(history),migrated);
  check('raw 0026 replay preserves schema, rows and AUTOINCREMENT counters exactly');
  const restored=await mf.getD1Database('RESTORED');await restore(restored,JSON.parse(await readFile(path.join(directory,'pre-0026-backup.json'),'utf8')));
  assert.deepEqual(await snapshot(restored),backup);await execute(restored,sql);assert.deepEqual(await snapshot(restored),migrated);
  check('saved pre-migration backup restores into another isolated D1 with identical schema/data hash and upgrades successfully');
  const rollback=await mf.getD1Database('ROLLBACK');await restore(rollback,backup);
  await assert.rejects(rollback.batch([...statements.slice(0,2).map(value=>rollback.prepare(value)),rollback.prepare('INSERT INTO audit_nonexistent_table VALUES(1)')]),/no such table/);
  assert.deepEqual(await snapshot(rollback),backup);await execute(rollback,sql);assert.deepEqual(await snapshot(rollback),migrated);
  check('injected mid-batch SQL failure rolls back DDL; replay after failure completes without legacy changes');
  const interrupted=await mf.getD1Database('INTERRUPTED');await restore(interrupted,backup);
  for(const statement of statements.slice(0,2))await execute(interrupted,statement);
  assert.equal((await interrupted.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='idx_task26_wrong_review_replay'").first()).n,1);
  await mf.dispose();mf=new Miniflare(options);
  const reopened=await mf.getD1Database('INTERRUPTED');
  assert.equal((await reopened.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='idx_task26_wrong_review_replay'").first()).n,1);
  await execute(reopened,sql);assert.deepEqual(await snapshot(reopened),migrated);
  check('runtime shutdown after committed partial DDL recovers on persistent local D1; IF NOT EXISTS safely completes 0026');
  history=await mf.getD1Database('HISTORY');
  for(const patch of [{language:'invalid'},{kind:'invalid'},{correct:2},{algorithm_version:'client-forged'},{user_id:'absent-user'},{profile:null}])await assert.rejects(insertEvent(history,patch),/constraint failed/i);
  const stable={event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID()};await insertEvent(history,stable);
  await assert.rejects(insertEvent(history,{event_id:stable.event_id}),/UNIQUE constraint failed/);
  await assert.rejects(insertEvent(history,{attempt_id:stable.attempt_id}),/UNIQUE constraint failed/);
  await insertEvent(history,{...stable,user_id:'audit-two'});
  check('event CHECK/NOT NULL/FK and per-account event/attempt uniqueness reject invalid writes and permit isolated account identities');
  await assert.rejects(insertState(history,{state_json:'bad json'}),/CHECK constraint failed/);
  await assert.rejects(insertState(history,{language:'invalid'}),/CHECK constraint failed/);
  await insertState(history);await assert.rejects(insertState(history),/UNIQUE constraint failed/);await insertState(history,{user_id:'audit-two'});
  check('state JSON/language constraints and compound primary key hold across users');
  await assert.rejects(history.prepare('UPDATE task26_wrong_review_events SET correct=0').run(),/task26_wrong_review_immutable/);
  const plan=(await history.prepare('EXPLAIN QUERY PLAN SELECT * FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4 AND seq>?5 ORDER BY seq').bind('audit-one','我','english','audit-review',0).all()).results;
  assert.match(JSON.stringify(plan),/idx_task26_wrong_review_replay/);
  check('immutable-event trigger executes and replay query uses the intended compound index');
  await user(history,'audit-cascade');await insertEvent(history,{user_id:'audit-cascade'});await insertState(history,{user_id:'audit-cascade'});
  await history.prepare("DELETE FROM task12_users WHERE id='audit-cascade'").run();
  for(const table of ['task26_wrong_review_events','task26_wrong_review_states'])assert.equal((await history.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id='audit-cascade'`).first()).n,0);
  assert.deepEqual((await history.prepare('PRAGMA foreign_key_check').all()).results,[]);
  // D1 disallows full integrity_check through its SQL authorizer. Preserve that
  // boundary, then inspect only this run's closed local SQLite files read-only.
  await assert.rejects(history.prepare('PRAGMA integrity_check').all(),/not authorized/);
  await mf.dispose();mf=null;
  const integrity=spawnSync('python',['-c',`import sqlite3,pathlib,sys,json
root=pathlib.Path(sys.argv[1]).resolve()
files=[file for file in (root/'state'/'d1').rglob('*.sqlite') if file.name!='metadata.sqlite']
rows=[]
for file in files:
    con=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True)
    rows.append({'file':str(file.relative_to(root)),'integrity':[r[0] for r in con.execute('PRAGMA integrity_check')],'foreign_keys':con.execute('PRAGMA foreign_key_check').fetchall()})
    con.close()
print(json.dumps(rows))
assert len(rows)==5 and all(row['integrity']==['ok'] and not row['foreign_keys'] for row in rows)
`,directory],{encoding:'utf8',windowsHide:true});
  assert.equal(integrity.status,0,integrity.stderr);
  const integrityResults=JSON.parse(integrity.stdout);
  await writeFile(path.join(directory,'read-only-integrity.json'),JSON.stringify(integrityResults,null,2));
  check('user deletion cascades only its rows; D1 FK check is clean and all five persisted databases pass read-only SQLite integrity/FK checks');
  const summary={status:'PASS',groups,local_only:true,legacy_tables:Object.keys(backup.tables).length,
    legacy_rows:Object.values(backup.tables).reduce((n,rows)=>n+rows.length,0),integrity_databases:integrityResults.length,backup_sha256:hash(backup),migrated_sha256:hash(migrated),results};
  await writeFile(path.join(directory,'result.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({...summary,results:undefined,evidence:path.relative(root,directory)}));
}catch(error){
  await writeFile(path.join(directory,'failure.json'),JSON.stringify({groups,error:error.stack,results},null,2));throw error;
}finally{await mf?.dispose();}
