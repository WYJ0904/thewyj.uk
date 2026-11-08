import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const sha='3eb268b748a6e7a1aaa7369059db474810bb59d4',source=execFileSync('git',['show',sha+':sw.js'],{encoding:'utf8'}),handlers=new Map();
const keys=new Set(['wyj-shell-20261027-aeris-p07-ui-r1-es-modules','synthetic-user-cache','wyj-shell-20261108-aeris-p07-release-rc6-es-modules']),deleted=[];
vm.runInNewContext(source,{self:{addEventListener:(k,v)=>handlers.set(k,v),clients:{claim:async()=>{}},skipWaiting:async()=>{}},caches:{keys:async()=>[...keys],delete:async k=>{deleted.push(k);return keys.delete(k);}}});
let promise;handlers.get('activate')({waitUntil:p=>promise=p});await promise;
const result={source_sha:sha,kind:'pure VM activation with synthetic cache names; no browser/user storage',deleted,retained:[...keys],unrelated_user_cache_preserved:keys.has('synthetic-user-cache'),production_operations:0};await writeFile('docs/p07/release-evidence/main-rollback-cache-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
