import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8'),origin='https://isolated.example';
function metadata(s){const c={self:{addEventListener(){}}};vm.runInNewContext(s+';globalThis.meta={core:CORE_SHELL,cache:CACHE,release:RELEASE,publication:PUBLICATION_CACHE,layer:TASK26_SHELL,integrity:TASK26_INTEGRITY,fingerprint:PUBLICATION_HASH};',c);return JSON.parse(JSON.stringify(c.meta));}
const meta=metadata(source),normalize=s=>s.replace(/\d{8}-aeris-[a-z0-9-]+/g,'RELEASE');
function worker(network,{stores=new Map()}={}){
 const handlers=new Map(),timers=new Map();let timerId=0,skipped=0;
 const key=v=>new URL(typeof v==='string'?v:v.url,origin).href;
 const caches={keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n),open:async n=>{if(!stores.has(n))stores.set(n,new Map());const m=stores.get(n);return{put:async(k,r)=>{const bytes=await r.arrayBuffer();m.set(key(k),new Response(bytes,{status:r.status,headers:r.headers}));},match:async k=>m.get(key(k))?.clone(),keys:async()=>[...m.keys()].map(url=>({url}))};}};
 vm.runInNewContext(source,{URL,Response,AbortController,crypto,TextEncoder,caches,fetch:network,setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id),self:{location:{origin},addEventListener:(k,v)=>handlers.set(k,v),clients:{claim:async()=>{}},skipWaiting:async()=>{skipped++;}}});
 return{stores,timers,caches,skipped:()=>skipped,install:()=>{let p;handlers.get('install')({waitUntil:x=>p=x});return p;},fetch:(path,mode='cors')=>{let p;handlers.get('fetch')({request:{method:'GET',url:new URL(path,origin).href,mode},respondWith:x=>p=x});return p;}};
}
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const assetPath=asset=>new URL(typeof asset==='string'?asset:asset.url,origin).pathname;
// Use actual publication bytes where the worker verifies integrity. All five
// original RC5 assertions below remain unchanged, including length and hash.
const response=asset=>{const pathname=assetPath(asset),key=typeof asset==='string'?asset:new URL(asset.url).pathname;return new Response(Object.hasOwn(meta.integrity,key)||pathname==='/index.html'||pathname==='/'?fs.readFileSync(new URL('../..'+(pathname==='/'?'/index.html':pathname),import.meta.url)):'exact bytes');};
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

test('the Task26 layer is required and bound to its source fingerprint',async()=>{
 assert.equal(meta.layer.length,2);assert.ok(meta.layer.every(x=>!meta.core.includes(x)));
 assert.equal(createHash('sha256').update(JSON.stringify(Object.entries(meta.integrity))).digest('hex'),meta.fingerprint);
 assert.notEqual(meta.publication,meta.cache);
 const w=worker(async asset=>response(asset));await w.install();
 for(const name of [meta.cache,meta.publication])for(const asset of [...meta.core,...meta.layer])
  assert.ok(await (await w.caches.open(name)).match(asset),`${name}: ${asset}`);
});
test('a failed Task26 import cannot publish or overwrite a legacy shell',async()=>{
 const w=worker(async asset=>meta.layer.includes(asset)?new Response('failed',{status:503}):response(asset));
 const legacy=await w.caches.open(meta.cache);await legacy.put('/index.html',new Response('original legacy HTML'));
 await assert.rejects(w.install(),/Release shell is incomplete/);
 assert.equal(w.stores.has(meta.publication),false);assert.equal(w.skipped(),0);
 assert.equal(await (await legacy.match('/index.html')).text(),'original legacy HTML');
 assert.ok(![...w.stores.keys()].some(x=>x.endsWith('-installing')));
});
test('a stale same-URL Task26 source fails integrity before publishing',async()=>{
 const w=worker(async asset=>asset.startsWith('/app.js?')?new Response('stale main app'):response(asset));
 await assert.rejects(w.install(),/Release shell is incomplete/);
 assert.equal(w.stores.has(meta.publication),false);assert.equal(w.stores.has(meta.cache),false);
});
test('a delayed stale navigation cannot replace committed publication HTML',async()=>{
 let release;const w=worker(async asset=>typeof asset==='string'?response(asset):new Promise(resolve=>{release=resolve;}));
 const late=w.fetch('/','navigate');await turn();await w.install();
 release(new Response(`<script type="module" src="/app.js?release=${meta.release}"></script>`));
 assert.equal(await (await late).text(),html);
 assert.equal(await (await (await w.caches.open(meta.publication)).match('/index.html')).text(),html);
});
test('legacy asynchronous cache writes cannot cover current Task26 assets',async()=>{
 const w=worker(async asset=>response(asset));const legacy=await w.caches.open(meta.cache);
 await legacy.put('/index.html',new Response('legacy HTML'));await w.install();
 // The previous worker owns only its original cache name, even if it finishes late.
 await legacy.put('/index.html',new Response('late old navigation'));
 const app=`/app.js?release=${meta.release}`;await legacy.put(app,new Response('late old app'));
 assert.equal(await (await w.fetch(app)).text(),fs.readFileSync(new URL('../../app.js',import.meta.url),'utf8'));
 assert.equal(await (await (await w.caches.open(meta.publication)).match('/index.html')).text(),html);
});
test('an absent publication never falls back to a partial legacy graph',async()=>{
 const w=worker(async()=>{throw Error('must not fetch a partial release');});
 await (await w.caches.open(meta.cache)).put(`/app.js?release=${meta.release}`,new Response('old app'));
 assert.equal((await w.fetch(`/app.js?release=${meta.release}`)).status,503);
 assert.equal(w.stores.has(meta.publication),false);
});
test('older releases retain their own bytes and unobserved future misses fail closed',async()=>{
 const w=worker(async asset=>response(asset));await w.install();
 const older='20260101-aeris-older',path=`/js/core/api.js?release=${older}`;
 await (await w.caches.open(`wyj-shell-${older}-es-modules`)).put(path,new Response('exact older bytes'));
 assert.equal(await (await w.fetch(path)).text(),'exact older bytes');
 assert.equal((await w.fetch('/app.js?release=20270101-aeris-unobserved')).status,503);
});
test('reinstalling a committed publication is immutable and needs no network',async()=>{
 const first=worker(async asset=>response(asset));await first.install();
 const again=worker(async()=>{throw Error('committed publication must remain immutable');},{stores:first.stores});
 await again.install();assert.equal(again.skipped(),1);
 assert.equal(await (await (await again.caches.open(meta.publication)).match('/index.html')).text(),html);
});
