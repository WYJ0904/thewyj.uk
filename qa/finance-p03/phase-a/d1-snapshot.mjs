import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function dumpD1(db) {
  const schema=(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
  const tables={};for(const r of schema.filter(r=>r.type==='table'))tables[r.name]=(await db.prepare('SELECT * FROM '+quote(r.name)).all()).results;
  let sequence=[];try{sequence=(await db.prepare('SELECT name,seq FROM sqlite_sequence').all()).results}catch{}
  return {schema,tables,sequence,scope:'synthetic logical D1 snapshot; not native D1 binary backup'};
}
export async function restoreD1(db,snapshot) {
  const queries=[db.prepare('PRAGMA defer_foreign_keys=ON')];
  for(const r of snapshot.schema.filter(r=>r.type==='table'))queries.push(db.prepare(r.sql));
  for(const [name,rows]of Object.entries(snapshot.tables))for(const row of rows){const cols=Object.keys(row);queries.push(db.prepare('INSERT INTO '+quote(name)+'('+cols.map(quote).join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(k=>row[k])))}
  if(snapshot.sequence.length){queries.push(db.prepare('DELETE FROM sqlite_sequence'));for(const r of snapshot.sequence)queries.push(db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').bind(r.name,r.seq))}
  for(const r of snapshot.schema.filter(r=>r.type!=='table'))queries.push(db.prepare(r.sql));
  await db.batch(queries);
}
/** Standalone inspectable SQLite file. It is an export transport, not a claim
 * to back up Miniflare's internal binary files or Cloudflare Time Travel. */
export async function writeSqliteSnapshot(file,snapshot) {
  try{await fs.access(file);throw Error('Preserve snapshot')}catch(e){if(e.code!=='ENOENT')throw e}
  const sqlite=new DatabaseSync(file);try{
    sqlite.exec('PRAGMA foreign_keys=OFF;BEGIN');
    for(const r of snapshot.schema.filter(r=>r.type==='table'))sqlite.exec(r.sql);
    for(const [name,rows]of Object.entries(snapshot.tables))for(const row of rows){const cols=Object.keys(row);sqlite.prepare('INSERT INTO '+quote(name)+'('+cols.map(quote).join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').run(...cols.map(k=>row[k]))}
    if(snapshot.sequence.length){sqlite.exec('DELETE FROM sqlite_sequence');const s=sqlite.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)');for(const r of snapshot.sequence)s.run(r.name,r.seq)}
    for(const r of snapshot.schema.filter(r=>r.type!=='table'))sqlite.exec(r.sql);
    sqlite.exec('COMMIT');
  }finally{sqlite.close()}
}
