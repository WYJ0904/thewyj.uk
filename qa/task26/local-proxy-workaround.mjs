import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {patchLocalProxy} from '../../scripts/prepare_ci_local_proxy.mjs';
const source=fs.readFileSync(new URL('../../node_modules/wrangler/wrangler-dist/cli.js',import.meta.url),'utf8'),patched=patchLocalProxy(source);
assert.equal(patchLocalProxy(patched),patched);
assert.throws(()=>patchLocalProxy('unknown upstream code'),/controller changed/);
let count=0,offset=0;
while((offset=patched.indexOf('onProxyWorkerMessage(message) {',offset))>=0){
  const end=patched.indexOf('\n      }',offset)+8,method=patched.slice(offset,end);offset=end;
  let warnings=0,fatal=[];
  const handler=vm.runInNewContext('({'+method+'})',{console:{warn(){warnings++;}},logger2:{debug(){}}});
  handler.emitErrorEvent=(...args)=>fatal.push(args);
  handler.onProxyWorkerMessage({type:'error',error:{name:'Error',message:'Network connection lost.'}});
  assert.equal(warnings,1);assert.equal(fatal.length,0);
  for(const error of [{name:'Error',message:'real worker failure'},{name:'TypeError',message:'Network connection lost.'},{}])handler.onProxyWorkerMessage({type:'error',error});
  assert.equal(fatal.length,3,'All other errors must keep their original fatal handling');
  assert.equal(fatal[0][1].message,'real worker failure');count++;
}
assert.equal(count,2);console.log('PASS local proxy workaround: exact disconnect only; both controllers retain every other fatal error, no HTTP retry.');
