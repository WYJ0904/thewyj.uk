import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildRollback} from './rollback-artifact.mjs';
const source=fs.readFileSync(new URL('../../js/core/design-system.js',import.meta.url),'utf8');
test('rollback build can only restrict P07 presentation, never enable an OFF policy',async()=>{
 const saved=globalThis.document;let legacy=false;globalThis.document={documentElement:{dataset:{}},querySelector:()=>legacy?{content:'legacy'}:null};
 try{const m=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(m.setInterfaceEnhancementsEnabled(true),true);assert.equal(document.documentElement.dataset.p07Ui,'enabled');legacy=true;assert.equal(m.setInterfaceEnhancementsEnabled(true),false);assert.equal(document.documentElement.dataset.p07Ui,'disabled');assert.equal(m.setInterfaceEnhancementsEnabled(false),false);legacy=false;assert.equal(m.setInterfaceEnhancementsEnabled(false),false);assert.equal(m.setInterfaceEnhancementsEnabled('true'),false);}finally{globalThis.document=saved;}
});
test('derived rollback preserves all 81 RC5 identities and rebinds every required Task26 byte',async()=>{
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
 const root=path.resolve('.wrangler/task26-v63-rollback-unit',`${Date.now()}-${process.pid}`);
 const proof=await buildRollback(sha,root),worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 const context={self:{addEventListener(){}}};
 vm.runInNewContext(worker+';globalThis.meta={core:CORE_SHELL,layer:TASK26_SHELL,integrity:TASK26_INTEGRITY,hash:PUBLICATION_HASH};',context);
 const meta=JSON.parse(JSON.stringify(context.meta));
 assert.equal(meta.core.length,81);assert.equal(meta.layer.length,2);
 assert.equal(createHash('sha256').update(JSON.stringify(meta.core.map(s=>s.replace(/\d{8}-aeris-[a-z0-9-]+/g,'RELEASE')))).digest('hex'),'a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae');
 for(const[url,expected]of Object.entries(meta.integrity)){
  const p=new URL(url,'https://isolated.example').pathname;
  const bytes=fs.readFileSync(path.join(proof.output,p==='/'?'index.html':p.slice(1)),'utf8').replace(/\r\n?/g,'\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,url);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(Object.entries(meta.integrity))).digest('hex'),meta.hash);
 assert.match(fs.readFileSync(path.join(proof.output,'index.html'),'utf8'),/name="aeris-p07-presentation" content="legacy"/);
});
