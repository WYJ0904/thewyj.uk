import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const refs={main:'3eb268b748a6e7a1aaa7369059db474810bb59d4',rc5:'482580b0855e14a61b3f6b51e9d91ae7855296cb',pr136:'f4ce8c7e7abc12b80895a570068fa7aa2f7a2a17'};
const report={kind:'synthetic_pure_model_probe',observed_at:new Date().toISOString(),production_calls:0,source:'functions/_lib/task11-model.mjs',versions:[]};
const at='2026-08-20T08:00:00Z';
for(const [label,sha]of Object.entries(refs)){
 const source=execFileSync('git',['show',`${sha}:functions/_lib/task11-model.mjs`],{encoding:'utf8',windowsHide:true});
 const {mergeLearningRecord}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+sha).toString('base64'));
 const old={data_type:'wrong_book',record_id:'wrong|english|network',payload_json:JSON.stringify({wrong_count:1,correct_answer:'',rubric:{gloss:''}}),updated_at:at,deleted:0,client_id:'client-synthetic-2026',client_version:'preflight',server_version:11,created_at:at,server_updated_at:at};
 const incoming={data_type:old.data_type,record_id:old.record_id,payload:{wrong_count:1,correct_answer:'网络',rubric:{gloss:'网络'}},updated_at:at,deleted:false,base_server_version:11,client_id:old.client_id,client_version:'preflight'};
 const restored=mergeLearningRecord(old,incoming);
 const deletion=mergeLearningRecord({...old,payload_json:JSON.stringify(incoming.payload),server_version:13},{...incoming,payload:{},updated_at:'2026-08-20T08:00:01Z',deleted:true,base_server_version:11});
 const foreign=mergeLearningRecord({...old,server_version:13},{...incoming,payload:{},updated_at:'2026-08-20T08:00:01Z',deleted:true,base_server_version:11,client_id:'another-device-2026'});
 const cases=[{name:'same-client same-timestamp nonempty meaning must survive',expected:'网络',actual:restored.canonical.payload.correct_answer,pass:restored.canonical.payload.correct_answer==='网络'&&restored.canonical.payload.rubric?.gloss==='网络'},{name:'newer same-client offline tombstone with unacknowledged server version',expected:true,actual:deletion.canonical.deleted,pass:deletion.canonical.deleted===true&&deletion.changed===true},{name:'stale other-client tombstone remains rejected',expected:false,actual:foreign.canonical.deleted,pass:foreign.canonical.deleted===false&&foreign.changed===false}];
 report.versions.push({label,sha,source_sha256:(await import('node:crypto')).createHash('sha256').update(source).digest('hex'),cases});
}
await mkdir('docs/p07/release-evidence',{recursive:true});await writeFile('docs/p07/release-evidence/learning-sync-independent-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
process.exitCode=report.versions.find(v=>v.label==='rc5').cases.every(c=>c.pass)?0:1;
