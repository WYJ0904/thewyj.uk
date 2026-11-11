// Owned synthetic persistence experiment, never a Cloudflare remote operation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {dumpD1,restoreD1} from '../phase-a/d1-snapshot.mjs';
const base=path.resolve('docs/migration-evidence/finance-p03/final');
const out=path.join(base,process.env.FINANCE_P03_PERSIST_NAME||'native-persist');await fs.mkdir(out,{recursive:false});
const phase=async name=>{await fs.appendFile(path.join(out,'phases.ndjson'),JSON.stringify({phase:name,pid:process.pid,utc:new Date().toISOString()})+'\n');console.log(name)};
const original=JSON.parse(await fs.readFile(path.join(base,'unified-bridge-final2/d1-logical-snapshot.json'),'utf8'));
const make=folder=>new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic persistent D1")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],resourcePersistencePath:folder});
let mf;
try{
 await phase('create_owned_native_persistent_runtime');mf=make(path.join(out,'active'));
 const db=await mf.getD1Database('DB');await phase('restore_synthetic_finance_snapshot');await restoreD1(db,original);
 assert.deepEqual((await dumpD1(db)).tables,original.tables);await mf.dispose();mf=null;await phase('closed_native_runtime');
 await fs.cp(path.join(out,'active'),path.join(out,'restored'),{recursive:true,errorOnExist:true,force:false});
 await phase('open_independent_binary_copy');mf=make(path.join(out,'restored'));const copy=await mf.getD1Database('DB');
 const restored=await dumpD1(copy);assert.deepEqual(restored.tables,original.tables);assert.deepEqual(restored.sequence,original.sequence);
 await mf.dispose();mf=null;
 const files={};async function scan(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await scan(p);else files[path.relative(out,p)]=createHash('sha256').update(await fs.readFile(p)).digest('hex')}}await scan(path.join(out,'active'));
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({case_id:'FM09-NATIVE-MINIFLARE-BINARY-COPY',status:'PASS',pid:process.pid,tables:Object.keys(original.tables).length,files,scope:'actual local Miniflare binary persistence only; real Cloudflare backup NOT_TESTED'},null,2));
 await phase('complete');
}catch(e){await fs.writeFile(path.join(out,'result.json'),JSON.stringify({case_id:'FM09-NATIVE-MINIFLARE-BINARY-COPY',status:'FAIL',error:e.stack,pid:process.pid},null,2));process.exitCode=1}finally{if(mf)await mf.dispose()}
