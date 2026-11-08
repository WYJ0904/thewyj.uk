import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
test('finance browser fixture rejects offline requests before mutating and reconnect acknowledges once',async()=>{
  const historical=process.env.P07_FINANCE_FIXTURE_SOURCE_SHA;
  let source;
  if(historical){assert.equal(historical,'bb6fe72faeb1df28075b39db71539dfd274a92dc');const r=spawnSync('git',['show',historical+':local-backend/test_app_browser.mjs'],{encoding:'utf8'});assert.equal(r.status,0);source=r.stdout;}
  else source=fs.readFileSync(new URL('../../local-backend/test_app_browser.mjs',import.meta.url),'utf8');
  const match=source.match(/const financeStubSource = `([\s\S]*?)`;/);assert.ok(match,'exercise the actual CI fixture, not a parallel implementation');
  const storage=new Map(),navigator={onLine:false};let passthrough=0;
  const window={fetch:async()=>{passthrough++;throw Error('unexpected external transport');}};
  vm.runInNewContext(match[1],{window,navigator,URL,Response,location:{origin:'http://127.0.0.1'},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  const operation={operation_id:'isolated-offline-op',type:'transaction.upsert',entity_id:'isolated-offline-record',base_revision:0,payload:{direction:'expense',amount_minor:100,currency:'CNY'}};
  const sync=()=>window.fetch('/api/finance/sync',{body:JSON.stringify({operations:[operation]})});
  await assert.rejects(sync(),e=>e.name==='TypeError'&&/Failed to fetch/.test(e.message));
  assert.equal(window.__financeBrowserServer.version,0);assert.deepEqual(Object.keys(window.__financeBrowserServer.transactions),[]);
  navigator.onLine=true;const response=await sync(),data=await response.json();assert.equal(response.status,200);assert.equal(data.operation_results.length,1);assert.equal(data.operation_results[0].operation_id,operation.operation_id);assert.equal(window.__financeBrowserServer.version,1);assert.equal(Object.keys(window.__financeBrowserServer.transactions).length,1);assert.equal(passthrough,0);
});
