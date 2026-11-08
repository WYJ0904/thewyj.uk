import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {sessionStorageKey} from '../../functions/_lib/task12-crypto.mjs';
const OLD='e4844a5304709263a2810332eca5d2a87b069d3d';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?null:process.argv[i+1];};
const output=arg('--out')||'docs/migration-evidence/p07-closeout/b1-matrix.json';
const realD1=process.argv.includes('--d1');let mf,db;const apiVersions={};
const get=async(file,old)=>old?execFileSync('git',['show',OLD+':'+file],{encoding:'utf8'}):readFile(file,'utf8');
const models={};for(const old of [true,false]){const s=await get('functions/_lib/task11-model.mjs',old);models[old?'old':'new']=await import('data:text/javascript;base64,'+Buffer.from(s+'\n//'+old).toString('base64'));}
if(realD1){
 const dir=path.resolve('.wrangler/b1-api-matrix-'+Date.now()),oldRoot=path.join(dir,'old');await mkdir(oldRoot,{recursive:true});
 const list=execFileSync('git',['ls-tree','-r','--name-only',OLD,'--','functions'],{encoding:'utf8'}).trim().split(/\r?\n/);
 for(const file of list){const dest=path.join(oldRoot,file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,execFileSync('git',['show',OLD+':'+file]));}
 for(const version of ['old','new']){const outfile=path.join(dir,version+'.mjs');await build({entryPoints:[path.resolve(version==='old'?path.join(oldRoot,'functions/_lib/task11-api.mjs'):'functions/_lib/task11-api.mjs')],bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent'});apiVersions[version]=await import(pathToFileURL(outfile).href);}
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("isolated")}}',compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],d1Persist:await mkdtemp(path.join(os.tmpdir(),'p07-b1-api-'))});db=await mf.getD1Database('WYJ_DB');
 for(const file of ['0001_foundation.sql','0002_low_risk_cloud_services.sql','0003_accounts_sessions.sql','0004_session_limit_trigger.sql','0005_session_limit_ordering.sql'])await db.exec((await readFile('cloudflare/migrations/'+file,'utf8')).replace(/\r?\n/g,' '));
}
class Storage{constructor(){this.m=new Map();}getItem(k){return this.m.get(k)??null;}setItem(k,v){this.m.set(k,String(v));}removeItem(k){this.m.delete(k);}}
class Online{constructor(){this.navigator={onLine:true};this.listeners=new Map();}addEventListener(k,f){this.listeners.set(k,f);}removeEventListener(k){this.listeners.delete(k);}set(value){this.navigator.onLine=value;this.listeners.get(value?'online':'offline')?.();}}
async function web(old){let time=Date.now();class ClockDate extends Date{constructor(...a){super(...(a.length?a:[time]));}static now(){return time;}}
 const context={module:{exports:{}},crypto,TextEncoder,TextDecoder,Buffer,URL,AbortController,Date:ClockDate,setTimeout,clearTimeout,console};vm.runInNewContext(await get('learning-sync.js',old),context);
 return{sync:context.module.exports,tick:(ms=1001)=>time+=ms};}
function server(model,seconds=false){const data=new Map(),history=[];let version=0,calls=0;return{data,get calls(){return calls;},async transport(req){calls++;const valid=model.validateLearningSyncRequest(req),results=[];
 for(const raw of valid.changes){const c={...raw};if(seconds)c.updated_at=c.updated_at.replace(/\.\d{3}Z$/,'Z');const key=c.data_type+'\u001f'+c.record_id,existing=data.get(key);const merged=model.mergeLearningRecord(existing,c);
 if(merged.changed){version++;const v={...merged.canonical,server_version:version,server_updated_at:new Date().toISOString(),created_at:existing?.created_at||new Date().toISOString()};data.set(key,{...v,deleted:Number(v.deleted),payload_json:JSON.stringify(v.payload)});history.push({...v,deleted:!!v.deleted});}
 const row=data.get(key);results.push({...model.learningRecordPayload(row)});}
 return{schema_version:1,results,changes:history.filter(r=>r.server_version>req.since_version),next_since_version:version,server_version:version,has_more:false,merged_count:0};}};}
async function d1Server(old){const users=[];for(let i=0;i<2;i++){const id='b1-'+randomBytes(10).toString('hex'),token=randomBytes(24).toString('base64url'),now=new Date().toISOString();await db.prepare("INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)").bind(id,now).run();await db.prepare("INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'browser')").bind(await sessionStorageKey(token),id,now,new Date(Date.now()+86400000).toISOString()).run();users.push({id,token});}
 const data=new Map();let calls=0;async function call(req,user){calls++;const waits=[];const r=await apiVersions[old?'old':'new'].handleTask11Request({env:{WYJ_DB:db,CLOUD_FOUNDATION_ENABLED:'true',CLOUD_READS_ENABLED:'true',CLOUD_WRITES_ENABLED:'true',TASK11_CLOUD_READS_ENABLED:'true',TASK11_CLOUD_WRITES_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'true',WYJ_ENVIRONMENT:'development'},data:{requestId:crypto.randomUUID()},request:new Request('https://isolated.invalid/api/learning/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':user.token},body:JSON.stringify(req)}),waitUntil:p=>waits.push(p)});await Promise.all(waits);const body=await r.json();assert.equal(r.status,200,'actual Task11 API '+body.code);if(user===users[0])for(const row of [...body.results,...body.changes])data.set(row.data_type+'\u001f'+row.record_id,{...row,payload_json:JSON.stringify(row.payload),deleted:Number(row.deleted)});return body;}
 return{data,get calls(){return calls;},transport:req=>call(req,users[0]),foreignRead:req=>call(req,users[1])};}
const proof={kind:realD1?'old/new Web sync library x actual old/new authenticated Task11 API + Miniflare D1; rate limits enabled':'old/new Web x old/new validated server model; separate legacy second-rounding simulation; synthetic only',old_sha:OLD,production_operations:0,cases:[]};
async function scenario(label,oldWeb,oldServer,seconds,kind){const W=await web(oldWeb),S=realD1?await d1Server(oldServer):server(models[oldServer?'old':'new'],seconds),online=new Online(),storage=new Storage();let lost=false;
 const manager=new W.sync.LearningSyncManager({storage,onlineSource:online,crypto,transport:async(req,opts)=>{const r=await S.transport(req);if(lost){lost=false;throw new TypeError('synthetic acknowledgement lost');}return r;}});manager.start({accountId:'synthetic-b1-account',clientVersion:oldWeb?'old-web':'new-web'});manager.stop(false);
 const id=W.sync.makeRecordId('wrong',['default','current','network']),key='wrong_book\u001f'+id,put=payload=>manager.upsert({data_type:'wrong_book',record_id:id,payload},{schedule:false});
 let result;
 try{
  if(kind==='meaning'){
   put({wrong_count:1,correct_answer:'',rubric:{gloss:''}});await manager.syncNow();manager.stop(false);
   put({wrong_count:1,correct_answer:'网络',rubric:{gloss:'网络'}});await manager.syncNow();manager.stop(false);
   const record=manager.state.records[key];result={local_meaning:record.payload.correct_answer,server_meaning:JSON.parse(S.data.get(key).payload_json).correct_answer,pending:manager.dirtyRecords().length};assert.equal(result.local_meaning,'网络');assert.equal(result.server_meaning,'网络');assert.equal(result.pending,0);
  }else if(kind==='offline-delete'||kind==='equal-time-delete'){
   put({wrong_count:1,correct_answer:'网络',rubric:{gloss:'网络'}});await manager.syncNow();manager.stop(false);if(kind!=='equal-time-delete')W.tick();
   lost=true;put({wrong_count:2,correct_answer:'网络',rubric:{gloss:'网络'}});await manager.syncNow();manager.stop(false);online.set(false);if(kind!=='equal-time-delete')W.tick();
   manager.upsert({data_type:'wrong_book',record_id:id,payload:{},deleted:true},{schedule:false});const before=manager.state.records[key].deleted;online.set(true);manager.stop(false);await manager.syncNow();manager.stop(false);
   if(kind==='equal-time-delete'&&oldWeb&&!oldServer){assert.equal(manager.state.records[key].deleted,true,'legacy intent stays deleted locally on conflict');assert.equal(manager.dirtyRecords().length,1,'ambiguous delete stays queued, never falsely acknowledged');manager.destroy();const upgraded=await web(false),next=new upgraded.sync.LearningSyncManager({storage,onlineSource:new Online(),crypto,transport:req=>S.transport(req)});next.start({accountId:'synthetic-b1-account',clientVersion:'refreshed-new-web'});next.stop(false);await next.syncNow();next.stop(false);result={legacy_queued_without_resurrection:true,refreshed_deleted:next.state.records[key].deleted,server_deleted:!!S.data.get(key).deleted,pending:next.dirtyRecords().length};assert.equal(result.refreshed_deleted,true);assert.equal(result.server_deleted,true);assert.equal(result.pending,0);next.destroy();}
   else{result={offline_local_deleted:before,local_deleted:manager.state.records[key].deleted,server_deleted:!!S.data.get(key).deleted,pending:manager.dirtyRecords().length};assert.equal(result.local_deleted,true);assert.equal(result.server_deleted,true);assert.equal(result.pending,0);}
  }else if(kind==='duplicate'){
   put({wrong_count:1,correct_answer:'网络'});await manager.syncNow();manager.stop(false);const row=S.data.get(key),v=row.server_version;
   await S.transport({schema_version:1,client_id:manager.clientId,client_version:manager.clientVersion,since_version:0,changes:[{data_type:row.data_type,record_id:row.record_id,payload:JSON.parse(row.payload_json),updated_at:row.updated_at,deleted:false,base_server_version:row.server_version}]});result={before_version:v,after_version:S.data.get(key).server_version};assert.equal(result.after_version,v);
  }else if(kind==='backup-isolation'){
   put({wrong_count:1,correct_answer:'网络'});await manager.syncNow();manager.stop(false);if(S.foreignRead){const other=await S.foreignRead({schema_version:1,client_id:'different-tenant-client',client_version:'matrix',since_version:0,changes:[]});assert.equal(other.changes.length,0,'authenticated tenant isolation');}const backup=manager.exportBackup();manager.start({accountId:'different-synthetic-account',clientVersion:'same'});manager.stop(false);assert.throws(()=>manager.importBackup(backup));result={cross_account_backup_rejected:true,authenticated_tenant_isolation:!!S.foreignRead};
  }
  proof.cases.push({label,kind,old_web:oldWeb,old_server:oldServer,legacy_seconds:seconds,status:'PASS',result,calls:S.calls});
 }catch(e){proof.cases.push({label,kind,old_web:oldWeb,old_server:oldServer,legacy_seconds:seconds,status:'FAIL',error:e.message,result,calls:S.calls});}
 finally{manager.destroy();}
}
try{for(const oldW of [true,false])for(const oldS of [true,false])for(const seconds of oldS&&!realD1?[false,true]:[false])for(const kind of ['meaning','offline-delete','equal-time-delete','duplicate','backup-isolation'])await scenario(`${oldW?'old':'new'}-web/${oldS?'old':'new'}-server${seconds?'-seconds':''}`,oldW,oldS,seconds,kind);}finally{if(mf)await mf.dispose();}
await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});await writeFile(output,JSON.stringify(proof,null,2)+'\n');
const supported=proof.cases.filter(c=>!(c.old_web&&c.old_server));console.log(JSON.stringify({supported_pass:supported.filter(c=>c.status==='PASS').length,supported_total:supported.length,negative_controls:proof.cases.filter(c=>c.old_web&&c.old_server).map(c=>({kind:c.kind,seconds:c.legacy_seconds,status:c.status})),failures:supported.filter(c=>c.status==='FAIL')}));if(supported.some(c=>c.status!=='PASS'))process.exitCode=1;
