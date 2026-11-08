import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8'),origin='https://isolated.example';
function metadata(s){const c={self:{addEventListener(){}}};vm.runInNewContext(s+';globalThis.meta={core:CORE_SHELL,cache:CACHE,release:RELEASE};',c);return JSON.parse(JSON.stringify(c.meta));}
const meta=metadata(source),normalize=s=>s.replace(/\d{8}-aeris-[a-z0-9-]+/g,'RELEASE');
function worker(network){
 const handlers=new Map(),stores=new Map(),timers=new Map();let timerId=0,skipped=0;
 const key=v=>new URL(typeof v==='string'?v:v.url,origin).href;
 const caches={keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n),open:async n=>{if(!stores.has(n))stores.set(n,new Map());const m=stores.get(n);return{put:async(k,r)=>{const bytes=await r.arrayBuffer();m.set(key(k),new Response(bytes,{status:r.status,headers:r.headers}));},match:async k=>m.get(key(k))?.clone(),keys:async()=>[...m.keys()].map(url=>({url}))};}};
 vm.runInNewContext(source,{URL,Response,AbortController,caches,fetch:network,setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id),self:{location:{origin},addEventListener:(k,v)=>handlers.set(k,v),clients:{claim:async()=>{}},skipWaiting:async()=>{skipped++;}}});
 return{stores,timers,caches,skipped:()=>skipped,install:()=>{let p;handlers.get('install')({waitUntil:x=>p=x});return p;}};
}
const html=`<script type="module" src="/app.js?release=${meta.release}"></script>`;
const response=asset=>new Response(asset==='/index.html'?html:'exact bytes');
const turn=()=>new Promise(r=>setImmediate(r));
test('all 81 required RC5 resources remain required after release renaming',()=>{
 // Fingerprint independently taken from the exact RC5 Git blob; no shallow-CI dependency.
 assert.equal(meta.core.length,81);
 assert.equal(createHash('sha256').update(JSON.stringify(meta.core.map(normalize))).digest('hex'),'a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae');
});
test('six bounded downloads publish HTML only after every required resource',async()=>{
 let active=0,max=0;const pending=[];const w=worker((asset)=>new Promise(resolve=>{active++;max=Math.max(max,active);pending.push(()=>{active--;resolve(response(asset));});}));
 const install=w.install();await turn();assert.equal(pending.length,6);assert.equal(w.stores.has(meta.cache),false);
 while(w.skipped()===0){if(pending.length)pending.shift()();await turn();}
 await install;assert.equal(max,6);assert.equal(w.stores.get(meta.cache).has(origin+'/index.html'),true);assert.ok(![...w.stores.keys()].some(x=>x.endsWith('-installing')));
});
test('one required 503 rejects atomic installation and preserves prior and user caches',async()=>{
 const w=worker(async asset=>asset.includes('/js/core/config.js')?new Response('unavailable',{status:503}):response(asset));
 await (await w.caches.open('user-retained')).put('/data',new Response('retain'));await (await w.caches.open('wyj-shell-old-retained')).put('/old',new Response('old bytes'));
 await assert.rejects(w.install(),/Release shell is incomplete/);assert.equal(w.skipped(),0);assert.equal(w.stores.has(meta.cache),false);assert.deepEqual([...w.stores.keys()].sort(),['user-retained','wyj-shell-old-retained']);
});
test('deadline remains live while a response body is stalled',async()=>{
 let bodyController;
 const w=worker(async(asset,options)=>{
  if(!asset.includes('/js/core/config.js'))return response(asset);
  return new Response(new ReadableStream({start(c){bodyController=c;options.signal.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')));}}));
 });
 const install=w.install();await turn();await turn();
 assert.ok(w.timers.size>0,'headers alone must not release the body deadline');
 for(const f of [...w.timers.values()])f();
 await assert.rejects(install,/Release shell is incomplete/);assert.ok(bodyController);assert.equal(w.stores.has(meta.cache),false);assert.equal(w.skipped(),0);
});
test('a mismatched release HTML still rejects the whole installation',async()=>{
 const w=worker(async asset=>new Response(asset==='/index.html'?'<script src="/app.js?release=20260101-aeris-other"></script>':'bytes'));
 await assert.rejects(w.install(),/Release shell is incomplete/);assert.equal(w.stores.has(meta.cache),false);
});
