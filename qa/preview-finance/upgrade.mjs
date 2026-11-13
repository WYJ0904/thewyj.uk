import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../finance-p03/phase-a/d1-snapshot.mjs';
import {createAutomaticFinanceTransaction,ensureTask21Schema,ingestNotificationEvents} from '../../functions/_lib/task21-service.mjs';
import {ensureTask16Schema,syncFinance,listFinanceTransactions} from '../../functions/_lib/task16-service.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'docs/migration-evidence/preview-finance','run-'+Date.now());
await mkdir(out,{recursive:true});
const rows=[];const record=(name,details={})=>{rows.push({name,status:'PASS',...details});console.log('PASS '+name)};
const hash=s=>createHash('sha256').update(s).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const q=s=>'"'+s.replaceAll('"','""')+'"';
const now='2026-11-13T00:00:00.000Z';
const files=(await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
const later=files.filter(n=>Number(n.slice(0,4))>=27);
assert.equal(later.length,8);
function split(sql){
 sql=sql.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\r\n]*/g,'');
 const result=[];let part='',quote='',word='',depth=0;
 const flush=()=>{if(/^\s*CREATE\s+TRIGGER/i.test(part)){if(/^(BEGIN|CASE)$/i.test(word))depth++;if(/^END$/i.test(word))depth--;}word=''};
 for(let i=0;i<sql.length;i++){const c=sql[i];part+=c;if(quote){if(c===quote){if(sql[i+1]===quote){part+=sql[++i]}else quote='';}continue;}
  if(c==="'"||c==='"'){flush();quote=c;continue;}if(/[A-Za-z_]/.test(c)){word+=c;continue;}flush();
  if(c===';'&&depth===0){if(part.trim())result.push(part.trim());part='';}
 }if(part.trim())result.push(part.trim());return result;
}
const sql=Object.fromEntries(await Promise.all(later.map(async n=>[n,split(await readFile(path.join(root,'cloudflare/migrations',n),'utf8'))])));
const migrationHashes=Object.fromEntries(await Promise.all(files.filter(n=>Number(n.slice(0,4))>=26).map(async n=>[n,hash(await readFile(path.join(root,'cloudflare/migrations',n)))])));
async function make(persist=false){const mf=new Miniflare({modules:true,script:'export default{fetch(){return new Response("local synthetic preview migration")}}',compatibilityDate:'2026-08-06',d1Databases:{DB:'p0-preview-upgrade-fixture'},resourcePersistencePath:persist||undefined});return {mf,db:await mf.getD1Database('DB')}}
async function insert(db,table,row){const cols=Object.keys(row);await db.prepare(`INSERT INTO ${q(table)}(${cols.map(q)}) VALUES(${cols.map(()=>'?')})`).bind(...cols.map(c=>row[c])).run()}
async function apply(db,name,fault=false){
 const applied=await db.prepare('SELECT name FROM wyj_d1_migrations WHERE name=?1').bind(name).first();if(applied)return false;
 const statements=sql[name].map(s=>db.prepare(s));
 if(fault)statements.splice(Math.min(2,statements.length),0,db.prepare('SELECT * FROM p0_injected_missing_table'));
 statements.push(db.prepare('INSERT INTO wyj_d1_migrations(name) VALUES(?1)').bind(name));await db.batch(statements);return true;
}
async function upgrade(db){const applied=[];for(const name of later)if(await apply(db,name))applied.push(name);return applied}
function preserve(before,after){
 for(const [name,oldRows]of Object.entries(before.tables)){
  if(name==='wyj_d1_migrations')continue;
  const cols=Object.keys(oldRows[0]||{});let a=oldRows,b=after.tables[name];assert.ok(b,'old table retained '+name);
  if(['task16_metadata','task21_metadata'].includes(name)){
   a=a.filter(r=>r.key!=='schema_version');b=b.filter(r=>r.key!=='schema_version');
  }
  const normalized=data=>data.map(r=>Object.fromEntries(cols.map(c=>[c,r[c]]))).map(r=>JSON.stringify(stable(r))).sort();
  assert.deepEqual(normalized(b),normalized(a),'original columns/rows preserved '+name);
 }
}
async function seed(db,remote){
 const accounts=['a','b'].map(n=>({id:'synthetic-preview-'+n,role:'user',entitlements:['finance_access','language_all_access']}));
 for(const a of accounts){await insert(db,'task12_users',{id:a.id,username:a.id,username_normalized:a.id,password_hash:'',password_scheme:'reset_required',password_iterations:0,role:'user',registered_at:now,created_at:now,updated_at:now,source_updated_at:now});
  for(const currency of ['CNY','USD','EUR','HKD','GBP','JPY']){
   const event={event_id:'synthetic-old-'+currency,fingerprint:hash(a.id+currency),payment_channel:'wechat',provider_reference:'',direction:'expense',amount_minor:currency==='JPY'?12345:64800,currency:'CNY',merchant:'synthetic merchant',counterparty:'',occurred_at_ms:1792368000000,received_at_ms:1792368000000,confidence:950,parser_version:'wechat-4'};
   const created=await createAutomaticFinanceTransaction(db,a,'synthetic-old-device',event);
   await db.prepare('UPDATE task16_finance_transactions SET currency=?1 WHERE id=?2').bind(currency,created.transaction_id).run();
   await db.prepare('UPDATE task16_finance_raw_events SET currency=?1 WHERE user_id=?2 AND source_event_id=?3').bind(currency,a.id,event.event_id).run();
  }
  await insert(db,'task11_learning_sync_heads',{user_id:a.id,version:1,updated_at:now});
  await insert(db,'task11_learning_sync_records',{user_id:a.id,data_type:'wrong_book',record_id:'wrong|synthetic-profile|english|word',payload_json:'{"word":"synthetic","profile":"synthetic-profile"}',updated_at:now,deleted:0,client_id:'synthetic-browser',client_version:'synthetic',server_version:1,created_at:now,server_updated_at:now});
  await insert(db,'task11_learning_sync_changes',{user_id:a.id,user_version:1,data_type:'wrong_book',record_id:'wrong|synthetic-profile|english|word',payload_json:'{"word":"synthetic"}',updated_at:now,deleted:0,client_id:'synthetic-browser',client_version:'synthetic',mutation_id:'synthetic-mutation',created_at:now});
  await insert(db,'task26_mastery_states',{user_id:a.id,language:'english',knowledge_id:'synthetic-point',score:50,confidence:0.5,next_review_at:now,algorithm_version:'synthetic-retained-version',state_version:1,last_event_seq:0,state_json:'{"synthetic":true}',updated_at:now});
  await insert(db,'task26_wrong_review_events',{user_id:a.id,event_id:'synthetic-review-event',attempt_id:'synthetic-review-attempt',profile:'synthetic-profile',language:'english',record_id:'synthetic-wrong',review_id:'synthetic-review',kind:'answer',correct:1,corrects:null,accepted_at:now,input_digest:hash(a.id),algorithm_version:'wrong-review-v1'});
  await insert(db,'task26_wrong_review_states',{user_id:a.id,profile:'synthetic-profile',language:'english',review_id:'synthetic-review',last_event_seq:0,state_json:'{"synthetic":true}'});
 }
 const a=accounts[0],txn=await db.prepare("SELECT id FROM task16_finance_transactions WHERE user_id=?1 AND currency='CNY'").bind(a.id).first();
 const op={operation_id:'synthetic-old-notification-operation',type:'event.ingest',payload:{event_id:'synthetic-retained-notification'}};
 await insert(db,'task21_notification_sync_operations',{user_id:a.id,operation_id:op.operation_id,device_id:'synthetic-old-device',operation_type:op.type,payload_digest:hash(JSON.stringify(stable(op))),result_version:0,result_json:JSON.stringify({transaction_id:txn.id,synthetic_original_receipt:true}),created_at:now});
 await insert(db,'task16_finance_sync_operations',{user_id:a.id,operation_id:'synthetic-retained-finance-receipt',device_id:'synthetic-old-device',operation_type:'transaction.upsert',payload_digest:hash('synthetic finance receipt'),result_version:1,result_json:JSON.stringify({transaction:{id:txn.id},synthetic_original_receipt:true}),created_at:now});
 await insert(db,'task21_notification_candidates',{id:'synthetic-old-candidate',user_id:a.id,event_id:'synthetic-pending-event',direction:'expense',amount_minor:remote?0:100,currency:'CNY',merchant:'synthetic pending',counterparty:'',payment_channel:'wechat',occurred_at_ms:1792368000000,confidence:600,status:'pending',finance_transaction_id:'',created_at:now,updated_at:now});
 return {accounts,op,queue:{schema_version:1,device_id:'synthetic-offline-browser',platform:'web',since_version:0,operations:[{operation_id:'synthetic-offline-operation',type:'transaction.upsert',entity_id:'synthetic-offline-transaction',base_revision:0,payload:{currency:'CNY',amount_minor:12300,direction:'expense',merchant:'synthetic queued',occurred_at_ms:1792368000000}}]}};
}
async function verified(db,before){
 const after=await dumpD1(db);preserve(before,after);
 assert.equal((await db.prepare("SELECT value FROM task16_metadata WHERE key='schema_version'").first()).value,'5');
 assert.equal((await db.prepare("SELECT value FROM task21_metadata WHERE key='schema_version'").first()).value,'9');
 assert.equal(await ensureTask16Schema(db),true);assert.equal(await ensureTask21Schema(db),true);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE currency='JPY' AND amount_minor=12345 AND amount_exponent IS NULL").first()).n,2);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE currency<>'JPY' AND amount_exponent=2").first()).n,10);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);return after;
}
const active=[];
try{
 const canonical=await make();active.push(canonical);
 await canonical.db.exec('CREATE TABLE wyj_d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 for(const n of files.filter(n=>Number(n.slice(0,4))<=26)){await canonical.db.exec((await readFile(path.join(root,'cloudflare/migrations',n),'utf8')).replace(/\r?\n/g,' '));await canonical.db.prepare('INSERT INTO wyj_d1_migrations(name) VALUES(?1)').bind(n).run()}
 const unseeded=await dumpD1(canonical.db);
 const remoteSchema=JSON.parse(await readFile(path.join(root,'.wrangler/preview-finance-evidence/schema-select.json'),'utf8'))[0].results;
 const remoteLedger=JSON.parse(await readFile(path.join(root,'.wrangler/preview-finance-evidence/inventory-select.json'),'utf8'))[1].results;
 const mirror=await make();active.push(mirror);
 const mirrorBase={...unseeded,schema:remoteSchema,tables:{...unseeded.tables,wyj_d1_migrations:remoteLedger.map(r=>({...r,applied_at:now}))},sequence:unseeded.sequence.map(r=>r.name==='wyj_d1_migrations'?{...r,seq:remoteLedger.length}:r)};
 for(const r of remoteSchema.filter(r=>r.type==='table'))mirrorBase.tables[r.name]??=[];
 await restoreD1(mirror.db,mirrorBase);
 const originalDDL=new Map(unseeded.schema.map(r=>[r.type+':'+r.name,r.sql.replace(/\s+/g,' ').trim()]));
 const differences=remoteSchema.filter(r=>originalDDL.get(r.type+':'+r.name)!==r.sql.replace(/\s+/g,' ').trim()).map(r=>({type:r.type,name:r.name}));
 record('exact Preview schema reproduced with synthetic rows only',{ddl_differences_from_canonical_26:differences,legacy_ledger_extra:'0021_candidate_unknown_amount.sql'});
 let mirrorBefore,mirrorSeed;
 for(const [label,h,remote]of [['canonical-26',canonical,false],['actual-Preview-DDL',mirror,true]]){
  const fixture=await seed(h.db,remote);const before=await dumpD1(h.db);const queueBytes=JSON.stringify(fixture.queue);await writeFile(path.join(out,label+'-outbox.json'),queueBytes);
  if(remote){mirrorBefore=before;mirrorSeed=fixture;await writeSqliteSnapshot(path.join(out,'before-preview.sqlite'),before)}
  record(label+': base schema probes are recorded separately from money capability',{task16_base_probe:await ensureTask16Schema(h.db),task21_base_probe:await ensureTask21Schema(h.db)});
  assert.equal((await upgrade(h.db)).length,8);const after=await verified(h.db,before);
  assert.equal(await readFile(path.join(out,label+'-outbox.json'),'utf8'),queueBytes);
  record(label+': upgrade retains original IDs/currencies/amounts/relations/Task11/Task26/receipts and outbox',{ledger_before:before.tables.wyj_d1_migrations.length,ledger_after:after.tables.wyj_d1_migrations.length});
  const digest=hash(JSON.stringify(stable(after)));assert.deepEqual(await upgrade(h.db),[]);assert.equal(hash(JSON.stringify(stable(await dumpD1(h.db)))),digest);
  record(label+': ledger-aware repeat is a zero-change no-op');
  const replay=await ingestNotificationEvents(h.db,fixture.accounts[0],{schema_version:1,device_id:'synthetic-old-device',operations:[fixture.op]});
  assert.equal(replay.operation_results[0].idempotent_replay,true);
  const one=await syncFinance(h.db,fixture.accounts[0],fixture.queue),two=await syncFinance(h.db,fixture.accounts[0],fixture.queue);
  assert.equal(one.operation_results[0].transaction.id,two.operation_results[0].transaction.id);assert.equal(two.operation_results[0].idempotent_replay,true);
  const b=await listFinanceTransactions(h.db,fixture.accounts[1],{limit:100});assert.ok(b.transactions.every(t=>t.user_id!==fixture.accounts[0].id&&t.id!=='synthetic-offline-transaction'));
  record(label+': retained notification receipt replay and offline finance delivery are idempotent/account-isolated');
 }
 for(let failAt=0;failAt<(process.argv.includes('--recovery-check')?0:later.length);failAt++){
  const h=await make();try{await restoreD1(h.db,mirrorBefore);for(const n of later.slice(0,failAt))await apply(h.db,n);
   const before=await dumpD1(h.db);await assert.rejects(()=>apply(h.db,later[failAt],true));assert.deepEqual(await dumpD1(h.db),before);
   await upgrade(h.db);await verified(h.db,mirrorBefore);record(later[failAt]+': failed batch rolls back DDL/data/ledger; resume succeeds');
  }finally{await h.mf.dispose()}
 }
 const persisted=path.join(out,'restart-state');let h=await make(persisted);await restoreD1(h.db,mirrorBefore);for(const n of later.slice(0,4))await apply(h.db,n);await h.mf.dispose();
 h=await make(persisted);try{assert.equal((await upgrade(h.db)).length,4);await verified(h.db,mirrorBefore);record('workerd restart after 0030 resumes only 0031-0034 with old rows intact')}finally{await h.mf.dispose()}
 const upgraded=await dumpD1(mirror.db);await writeSqliteSnapshot(path.join(out,'after-preview.sqlite'),upgraded);
 const restored=await make();try{await restoreD1(restored.db,mirrorBefore);assert.deepEqual((await dumpD1(restored.db)).tables,mirrorBefore.tables);record('pre-upgrade logical snapshot restores all original tables/rows/ledger')}finally{await restored.mf.dispose()}
 for(const file of ['before-preview.sqlite','after-preview.sqlite']){const db=new DatabaseSync(path.join(out,file),{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')}finally{db.close()}}
 record('standalone before/after SQLite backup artifacts reopen with integrity_check=ok');
 const before=await dumpD1(mirror.db);await assert.rejects(()=>mirror.db.batch(sql[later[0]].map(s=>mirror.db.prepare(s))));assert.deepEqual(await dumpD1(mirror.db),before);
 record('untracked raw ALTER replay is rejected without changing the already-upgraded database');
}catch(e){rows.push({name:'harness failure',status:'FAIL',error:e.stack});process.exitCode=1;console.error(e.message)}
finally{for(const h of active)await h.mf.dispose();await writeFile(path.join(out,'results.json'),JSON.stringify({scope:'new local Miniflare D1; remote schema only, all account/business rows synthetic',baseline:'29bdbb9e3ae4cd88019b6c0046aabc6df574a942',remote_writes:0,previous_fault_matrix_not_repeated:process.argv.includes('--recovery-check'),migration_hashes:migrationHashes,rows},null,2)+'\n');console.log(JSON.stringify({output:path.relative(root,out),pass:rows.filter(r=>r.status==='PASS').length,fail:rows.filter(r=>r.status==='FAIL').length}))}
