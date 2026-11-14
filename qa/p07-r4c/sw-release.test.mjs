import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8'),origin='https://isolated.example';
const release=source.match(/^const RELEASE = "([^"]+)";/m)[1],currentCache=`wyj-shell-${release}-es-modules`;
function worker(){
  const handlers=new Map(),stores=new Map(),calls=[];let network=()=>new Response('network bytes');
  const key=value=>new URL(typeof value==='string'?value:value.url,origin).href;
  const caches={keys:async()=>[...stores.keys()],open:async name=>{if(!stores.has(name))stores.set(name,new Map());const s=stores.get(name);return{match:async request=>s.get(key(request))?.clone(),put:async(request,response)=>s.set(key(request),response.clone()),keys:async()=>[...s.keys()].map(url=>({url}))};},delete:async name=>stores.delete(name)};
  const context={URL,Response,AbortController,crypto,TextEncoder,setTimeout,clearTimeout,caches,fetch:async(request,options)=>{calls.push({url:key(request),cache:options?.cache});return network(request);},self:{location:{origin},addEventListener:(type,handler)=>handlers.set(type,handler),clients:{claim:async()=>{}},skipWaiting:async()=>{}}};
  vm.runInNewContext(source,context);
  return{caches,calls,network:fn=>network=fn,install:()=>{let p;handlers.get('install')({waitUntil:x=>p=x});return p;},request:async(path,mode='cors')=>{let answer;handlers.get('fetch')({request:{url:new URL(path,origin).href,method:'GET',mode},respondWith:p=>answer=p});return answer?await answer:null;}};
}
test('unobserved old release misses fail closed without fetching current bytes',async()=>{
  const w=worker(),r=await w.request('/app.js?v=20260101-aeris-old');assert.equal(r.status,503);assert.equal(w.calls.length,0);
});
test('an existing old client keeps its exact cached module bytes',async()=>{
  const w=worker(),url='/app.js?v=20260101-aeris-old';await (await w.caches.open('wyj-shell-20260101-aeris-old-es-modules')).put(url,new Response('old exact bytes'));
  assert.equal(await (await w.request(url)).text(),'old exact bytes');assert.equal(w.calls.length,0);
});
test('new HTML authorizes its future release assets without polluting the old offline shell',async()=>{
  const w=worker(),future='20261201-aeris-next';w.network(request=>new URL(request.url).pathname==='/'?new Response(`<script type="module" src="/app.js?release=${future}"></script>`):new Response('future exact bytes'));
  await (await w.caches.open(currentCache)).put('/index.html',new Response('current complete offline shell'));
  await w.request('/','navigate');const result=await w.request('/app.js?release='+future);assert.equal(result.status,200);assert.equal(await result.text(),'future exact bytes');
  assert.equal(w.calls.at(-1).cache,'no-store');assert.equal(await (await (await w.caches.open(currentCache)).match('/index.html')).text(),'current complete offline shell');
  assert.equal((await w.caches.keys()).length,1,'a future partially downloaded shell must not be published');
});
test('current navigation recognizes the canonical release query and APIs bypass Cache Storage',async()=>{
  const w=worker(),html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  // Navigation must start from a complete publication, not manufacture an
  // offline shell from one HTML response before its static imports exist.
  w.network(request=>{const path=new URL(typeof request==='string'?request:request.url,origin).pathname;return new Response(fs.readFileSync(new URL('../..'+(path==='/'?'/index.html':path),import.meta.url)));});await w.install();
  w.network(()=>new Response(html));assert.equal(await (await w.request('/','navigate')).text(),html);
  assert.equal(await (await (await w.caches.open(currentCache)).match('/index.html')).text(),html);
  const before=w.calls.length;assert.equal(await w.request('/api/me'),null);assert.equal(w.calls.length,before);
});
