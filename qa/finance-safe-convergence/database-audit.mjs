import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {execFileSync} from 'node:child_process';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../finance-p03/phase-a/d1-snapshot.mjs';
const out=path.resolve(process.env.FINANCE_CONVERGENCE_DB_OUTPUT);
assert.ok(out.startsWith(path.join(root,'docs/migration-evidence/finance-safe-convergence')+path.sep));
await fs.mkdir(out,{recursive:true});
const f=await fixture(),rows=[];let restored;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function test(id,fn){try{rows.push({id,status:'PASS',actual:await fn()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
try{
 await test('ordered-full-migration-chain-and-foreign-keys',async()=>{
   const names=(await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
   const expected=execFileSync('git',['ls-tree','-r','--name-only','fcc499ef4b33cd13d212c19523d82cd7966e2684','--','cloudflare/migrations'],{cwd:root,encoding:'utf8'})
     .trim().split(/\r?\n/).map(x=>path.basename(x)).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
   assert.deepEqual(names,expected,'The exact pinned migration manifest must remain intact');
   const fk=(await f.db.prepare('PRAGMA foreign_key_check').all()).results;assert.deepEqual(fk,[]);
   return {migrations:names,manifest_source:'fcc499ef4b33cd13d212c19523d82cd7966e2684',existing_number_gap:[26],foreign_key_violations:0};
 });
 const ids=[];
 await test('all-six-currency-identities-and-units-persist',async()=>{
   for(const currency of ['CNY','USD','EUR','HKD','GBP','JPY']){
     const amount=currency==='JPY'?123:12345;
     const transaction=await f.transaction(currency,amount,{id:'synthetic-final-'+currency});ids.push(transaction.id);
     const row=await f.db.prepare('SELECT id,currency,amount_minor,amount_exponent FROM task16_finance_transactions WHERE id=?1').bind(transaction.id).first();
     assert.equal(row.currency,currency);assert.equal(row.amount_minor,amount);assert.equal(row.amount_exponent,currency==='JPY'?0:2);
   }
   return {transactions:ids,currency_units:'JPY=0; other supported currencies=2'};
 });
 await test('failed-data-batch-has-no-partial-ledger-write',async()=>{
   const before=await dumpD1(f.db);let rejected=false;
   try{await f.db.batch([
     f.db.prepare("UPDATE task16_finance_transactions SET note='SYNTHETIC MUST ROLL BACK' WHERE id=?1").bind(ids[0]),
     f.db.prepare('INSERT INTO SYNTHETIC_MISSING_TARGET VALUES (1)')]);}catch{rejected=true;}
   assert.ok(rejected);assert.deepEqual((await dumpD1(f.db)).tables,before.tables);
   return {expected_failure:true,application_tables_unchanged:true};
 });
 await test('complete-logical-backup-cold-d1-restore',async()=>{
   const snapshot=await dumpD1(f.db);await fs.writeFile(path.join(out,'synthetic-backup.json'),JSON.stringify(snapshot));
   restored=new Miniflare({modules:true,script:'export default{fetch(){return new Response("synthetic restore")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});
   const db=await restored.getD1Database('DB');await restoreD1(db,snapshot);
   const after=await dumpD1(db);assert.deepEqual(after.tables,snapshot.tables);
   assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
   return {tables:Object.keys(snapshot.tables).length,application_table_digest:digest(snapshot.tables),restored_digest:digest(after.tables)};
 });
 await test('physical-sqlite-backup-integrity-and-currency-readback',async()=>{
   const file=path.join(out,'synthetic-backup.sqlite');await writeSqliteSnapshot(file,await dumpD1(f.db));
   const db=new DatabaseSync(file,{readOnly:true});
   try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
     assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
     const values=db.prepare('SELECT currency,amount_minor,amount_exponent FROM task16_finance_transactions ORDER BY currency').all();
     assert.equal(values.length,6);assert.equal(values.find(x=>x.currency==='JPY').amount_exponent,0);
     return {sqlite_integrity:'ok',foreign_key_violations:0,rows:values};
   }finally{db.close();}
 });
}finally{if(restored)await restored.dispose();await f.dispose();}
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,scope:'isolated local D1/SQLite; synthetic application backup only',production_restore:'NOT_TESTED'},null,2));
console.log(JSON.stringify({PASS:rows.filter(x=>x.status==='PASS').length,FAIL:rows.filter(x=>x.status==='FAIL').length}));
if(rows.some(x=>x.status==='FAIL'))process.exitCode=1;
