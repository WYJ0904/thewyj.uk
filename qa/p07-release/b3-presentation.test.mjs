import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../js/core/design-system.js',import.meta.url),'utf8');
test('rollback build can only restrict P07 presentation, never enable an OFF policy',async()=>{
 const saved=globalThis.document;let legacy=false;globalThis.document={documentElement:{dataset:{}},querySelector:()=>legacy?{content:'legacy'}:null};
 try{const m=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(m.setInterfaceEnhancementsEnabled(true),true);assert.equal(document.documentElement.dataset.p07Ui,'enabled');legacy=true;assert.equal(m.setInterfaceEnhancementsEnabled(true),false);assert.equal(document.documentElement.dataset.p07Ui,'disabled');assert.equal(m.setInterfaceEnhancementsEnabled(false),false);legacy=false;assert.equal(m.setInterfaceEnhancementsEnabled(false),false);assert.equal(m.setInterfaceEnhancementsEnabled('true'),false);}finally{globalThis.document=saved;}
});
