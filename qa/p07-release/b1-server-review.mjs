import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.env.P07_B1_REVIEW_OUT||'docs/migration-evidence/p07-closeout/b1-initial-red.json';
const versions=[['rc6','e4844a5304709263a2810332eca5d2a87b069d3d'],['raw-pr136','f4ce8c7e7abc12b80895a570068fa7aa2f7a2a17'],['reviewed','WORKTREE']];
const report={kind:'independent synthetic pure-model review; no live data',production_operations:0,versions:[]};
for(const [label,sha]of versions){
 const source=sha==='WORKTREE'?await readFile('functions/_lib/task11-model.mjs','utf8'):execFileSync('git',['show',sha+':functions/_lib/task11-model.mjs'],{encoding:'utf8'});
 const {mergeLearningRecord:m}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//'+label).toString('base64'));
 const at='2026-11-08T08:00:00Z',existing={data_type:'wrong_book',record_id:'wrong|english|network',payload_json:JSON.stringify({wrong_count:1,correct_answer:'',rubric:{gloss:''}}),updated_at:at,deleted:0,client_id:'same-client',client_version:'old-web',server_version:13,created_at:at,server_updated_at:at};
 const change={data_type:existing.data_type,record_id:existing.record_id,payload:{wrong_count:1,correct_answer:'网络',rubric:{gloss:'网络'}},updated_at:at,deleted:false,client_id:'same-client',client_version:'old-web',base_server_version:13};
 const run=(name,base,input,check)=>{try{const r=m(base,input);return{name,pass:check(r),canonical_deleted:r.canonical.deleted,canonical_meaning:r.canonical.payload?.correct_answer,changed:r.changed};}catch(e){return{name,pass:name==='same-time stale delete cannot erase later own live record'&&e.code==='learning_sync_refresh_required'&&e.status===409,error_code:e.code};}};
 const results=[
  run('same-time acknowledged same-client meaning update',existing,change,r=>r.canonical.payload.correct_answer==='网络'),
  run('newer same-client offline delete after lost acknowledgement',existing,{...change,deleted:true,payload:{},updated_at:'2026-11-08T08:00:01Z',base_server_version:11},r=>r.canonical.deleted===true),
  run('same-time stale live replay cannot resurrect own tombstone',{...existing,deleted:1,payload_json:'{}'},{...change,base_server_version:11},r=>r.canonical.deleted===true&&!r.changed),
  run('same-time acknowledged live replay cannot resurrect tombstone',{...existing,deleted:1,payload_json:'{}'},change,r=>r.canonical.deleted===true&&!r.changed),
  run('same-time stale delete cannot erase later own live record',existing,{...change,deleted:true,payload:{},base_server_version:11},()=>false),
  run('stale other-device tombstone rejected',existing,{...change,deleted:true,payload:{},updated_at:'2026-11-08T08:00:01Z',base_server_version:11,client_id:'other-device'},r=>r.canonical.deleted===false&&!r.changed),
  run('old nonempty meaning survives newer empty payload',{...existing,payload_json:JSON.stringify(change.payload)},{...change,payload:{wrong_count:1,correct_answer:'',rubric:{gloss:''}},updated_at:'2026-11-08T08:00:01Z'},r=>r.canonical.payload.correct_answer==='网络'),
  run('exact repeated acknowledged payload is idempotent',{...existing,payload_json:JSON.stringify(change.payload)},change,r=>!r.changed),
 ];
 report.versions.push({label,sha,source_sha256:createHash('sha256').update(source).digest('hex'),results});
}
await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.versions.map(v=>({label:v.label,pass:v.results.filter(r=>r.pass).length,total:v.results.length,failed:v.results.filter(r=>!r.pass).map(r=>r.name)}))));
if(!report.versions.find(v=>v.label==='reviewed').results.every(r=>r.pass))process.exitCode=1;
