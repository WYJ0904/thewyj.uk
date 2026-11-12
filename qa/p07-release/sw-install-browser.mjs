// Owned, new Chrome profiles only. No remote origins, credentials or real user data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';
import {isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const sha=arg('--source','HEAD'),label=arg('--label','candidate'),cases=arg('--cases','normal,slow,failure-retry,body-timeout,warm,task26-failure,stale-task26').split(',');
assert.match(label,/^[a-z0-9-]+$/);
const out=path.resolve(arg('--out',`docs/migration-evidence/p07-release/sw-install-${label}`));
assert.equal(await fs.stat(out).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false,'Do not overwrite prior evidence');
await fs.mkdir(out,{recursive:true});
const git=(...args)=>execFileSync('git',args,{maxBuffer:30*1024*1024,windowsHide:true});
const sourceSha=git('rev-parse',sha==='WORKTREE'?'HEAD':sha).toString().trim();
function blobs(ref){const list=git('ls-tree','-r','--name-only',ref).toString().trim().split(/\r?\n/).filter(p=>isAllowedPagesFile(p)&&!p.startsWith('functions/')&&p!=='_headers');return Object.fromEntries(list.map(p=>[p,git('show',ref+':'+p)]));}
const baseSha=git('rev-parse',arg('--base','482580b0855e14a61b3f6b51e9d91ae7855296cb')).toString().trim();
const current=blobs(sourceSha),old=blobs(baseSha);
if(sha==='WORKTREE')for(const file of Object.keys(current))current[file]=await fs.readFile(file);
function metadata(files){const source=files['sw.js'].toString(),context={self:{addEventListener(){}}};vm.runInNewContext(source+';globalThis.meta={release:RELEASE,cache:CACHE,core:CORE_SHELL,publication:typeof PUBLICATION_CACHE===\"undefined\"?CACHE:PUBLICATION_CACHE,layer:typeof TASK26_SHELL===\"undefined\"?[]:TASK26_SHELL};',context);return JSON.parse(JSON.stringify(context.meta));}
const meta=metadata(current),oldMeta=metadata(old),hash=x=>createHash('sha256').update(x).digest('hex');
const required=[...meta.core,...meta.layer];
const proof={source_sha:sourceSha,base_sha:baseSha,qa_sha256:hash(await fs.readFile(import.meta.filename)),release:meta.release,publication:meta.publication,sw_sha256:hash(current['sw.js']),core_count:meta.core.length,required_count:required.length,fixture:'actual Chrome; HTTP/1 six-connection queue, 900ms response latency; loopback only',production_operations:0,model_calls:0,cases:[]};
proof.source_mode=sha==='WORKTREE'?'working-tree':'git-ref';
proof.source_manifest=Object.fromEntries(Object.entries(current).map(([file,bytes])=>[file,hash(bytes)]));
const save=()=>fs.writeFile(path.join(out,'results.json'),JSON.stringify(proof,null,2)+'\n');
let sequence=0;
for(const name of cases){
 const entry={name,requests:[],worker_errors:[],started_at:new Date().toISOString()};proof.cases.push(entry);await save();
 const warm=name.startsWith('warm');
 let mode=name==='failure-retry'?'failure':name,generation=warm?'old':'candidate',active=0,maxActive=0,child,page,server;
 const profile=path.resolve('.wrangler/p07-sw-profiles',`${label}-${name}-${Date.now()}-${sequence++}`);await fs.mkdir(profile,{recursive:true});
 try{
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost'),files=generation==='old'?old:current;
   if(url.pathname==='/__control'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><title>Isolated SW installation</title>');return;}
   if(url.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store','Service-Worker-Allowed':'/'});res.end(files['sw.js']);return;}
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1),bytes=files[file];
   if(!bytes){res.writeHead(404);res.end();return;}
   const row={path:req.url,generation,start_ms:Date.now(),completed:false,closed_early:false};entry.requests.push(row);active++;maxActive=Math.max(maxActive,active);
   res.once('close',()=>{active--;row.closed_early=!row.completed;row.closed_ms=Date.now();});
   const send=()=>{if(res.destroyed)return;const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.png')?'image/png':'application/octet-stream';
    if(mode==='failure'&&url.pathname==='/js/core/config.js'||generation==='candidate'&&mode.includes('task26-failure')&&meta.layer.some(asset=>new URL(asset,origin).pathname===url.pathname)){res.writeHead(503);row.status=503;row.completed=true;res.end('synthetic single resource failure');return;}
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});row.status=200;
    if(mode==='body-timeout'&&url.pathname==='/js/core/config.js'){res.flushHeaders();setTimeout(()=>{if(!res.destroyed){row.completed=true;res.end(bytes);}},11000);}
    else{row.completed=true;res.end(generation==='candidate'&&mode==='stale-task26'&&url.pathname==='/app.js'?old['app.js']:bytes);}
   };setTimeout(send,mode==='slow'?900:2);
  });await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const origin='http://127.0.0.1:'+server.address().port;
  const chrome=process.env.CHROME_BIN||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe'):'google-chrome');
  child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--disable-background-networking','--remote-allow-origins=*','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;const deadline=Date.now()+20000;
  while(!port&&Date.now()<deadline){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{}if(!port)await new Promise(r=>setTimeout(r,100));}
  assert.ok(port,'owned Chrome ready');
  page=await openPage({cdpUrl:'http://127.0.0.1:'+port,baseUrl:origin,width:1100,height:800,mobile:false});
  page.client.listeners.add(m=>{if(m.method==='ServiceWorker.workerErrorReported')entry.worker_errors.push(m.params.errorMessage);});await page.send('ServiceWorker.enable');
  await page.send('Page.navigate',{url:origin+'/__control'});await page.waitFor("document.readyState==='complete'",10000,'control page');
  await page.evaluate(`(async()=>{localStorage.setItem('synthetic-retained','yes');const c=await caches.open('synthetic-user-cache');await c.put('/retained',new Response('yes'));await new Promise((resolve,reject)=>{const r=indexedDB.open('synthetic-retained',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction('records','readwrite');t.objectStore('records').put('yes','retained');t.oncomplete=()=>{d.close();resolve()};}});return true})()`);
  async function install(release){const start=Date.now();await page.evaluate(`(async()=>{const previous=(await navigator.serviceWorker.getRegistration())?.active;const ticket=(globalThis.installSequence||0)+1;globalThis.installSequence=ticket;globalThis.installState='pending';navigator.serviceWorker.register('/sw.js?v='+${JSON.stringify(release)}).then(r=>{const expected=new URL('/sw.js?v='+${JSON.stringify(release)},location.href).href;const watch=()=>{const w=[r.installing,r.waiting,r.active].find(w=>w&&w!==previous&&w.scriptURL===expected);if(!w)return;const update=()=>{if(globalThis.installSequence===ticket&&(w.state==='activated'||w.state==='redundant'))globalThis.installState=w.state;};w.addEventListener('statechange',update);update();};r.addEventListener('updatefound',watch);watch();if(r.active===previous&&!r.installing)void r.update();}).catch(e=>{if(globalThis.installSequence===ticket)globalThis.installState='registration-error:'+e.message});return true;})()`);await page.waitFor("globalThis.installState!=='pending'",45000,'installation terminal state');return {state:await page.evaluate('globalThis.installState'),duration_ms:Date.now()-start};}
  const first=await install(generation==='old'?oldMeta.release:meta.release);entry.first=first;
  const snapshot=async()=>page.evaluate(`(async()=>{const keys=await caches.keys(),c=keys.includes(${JSON.stringify(meta.publication)})?await caches.open(${JSON.stringify(meta.publication)}):null;const missing=[];if(c){for(const asset of ${JSON.stringify(required)})if(!await c.match(asset))missing.push(asset);}const user=await (await caches.open('synthetic-user-cache')).match('/retained');const idb=await new Promise((resolve,reject)=>{const r=indexedDB.open('synthetic-retained',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,q=d.transaction('records').objectStore('records').get('retained');q.onsuccess=()=>{resolve(q.result);d.close()}}});return {keys,missing,currentExists:!!c,html:!!c&&!!(await c.match('/index.html')),user:user?await user.text():null,local:localStorage.getItem('synthetic-retained'),idb}})()`);
  entry.after_first=await snapshot();
  if(name==='failure-retry'||name==='body-timeout'||name==='task26-failure'||name==='stale-task26'){
   assert.equal(first.state,'redundant','a failed required resource must reject installation');assert.equal(entry.after_first.currentExists,false,'failed install must not publish a release cache');assert.ok(!entry.after_first.keys.some(k=>k.endsWith('-installing')),'failed staging removed');
   if(name==='failure-retry'){mode='normal';entry.retry=await install(meta.release);assert.equal(entry.retry.state,'activated');}
  }else assert.equal(first.state,'activated','complete shell must install');
  if(warm){
   const oldCacheDigest=()=>page.evaluate(`(async()=>{const c=await caches.open(${JSON.stringify(oldMeta.cache)}),rows=[];for(const r of await c.keys()){const b=await(await c.match(r)).arrayBuffer();rows.push([r.url,[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('')]);}return rows.sort((a,b)=>a[0].localeCompare(b[0]));})()`);
   entry.old_cache_before=await oldCacheDigest();
   generation='candidate';entry.upgrade=await install(meta.release);assert.equal(entry.upgrade.state,name==='warm-task26-failure'?'redundant':'activated');
   entry.old_cache_after=await oldCacheDigest();assert.deepEqual(entry.old_cache_after,entry.old_cache_before,'upgrade must never rewrite the base release');
   const oldPath=oldMeta.core.find(u=>u.startsWith('/js/core/api.js?'));await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
   entry.old_client_sha256=await page.evaluate(`fetch(${JSON.stringify(oldPath)}).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);assert.equal(entry.old_client_sha256,hash(old['js/core/api.js']));await page.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  }
  entry.final=await snapshot();assert.equal(entry.final.user,'yes');assert.equal(entry.final.local,'yes');assert.equal(entry.final.idb,'yes');
  const rejected=['body-timeout','task26-failure','stale-task26','warm-task26-failure'].includes(name);
  if(!rejected){assert.equal(entry.final.currentExists,true);assert.deepEqual(entry.final.missing,[]);assert.equal(entry.final.html,true);await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});entry.offline_html=await page.evaluate(`fetch('/index.html').then(r=>r.text()).then(t=>t.includes(${JSON.stringify(meta.release)}))`);assert.equal(entry.offline_html,true);
   const expected=required.map(asset=>[asset,hash(current[new URL(asset,origin).pathname==='/'?'index.html':new URL(asset,origin).pathname.slice(1)])]);
   entry.offline_graph=await page.evaluate(`(async()=>{const rows=[];for(const [asset,expected] of ${JSON.stringify(expected)}){const r=await fetch(asset);if(!r.ok)throw Error('offline graph '+asset+': '+r.status);const b=await r.arrayBuffer(),actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');if(actual!==expected)throw Error('stale offline graph: '+asset);rows.push({asset,sha256:actual});}return rows;})()`);assert.equal(entry.offline_graph.length,required.length);
  }else if(name==='warm-task26-failure'){
   assert.equal(entry.final.currentExists,false);await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
   entry.rollback_html_sha256=await page.evaluate("fetch('/index.html').then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join(''))");assert.equal(entry.rollback_html_sha256,hash(old['index.html']));
  }
  entry.status='PASS';
 }catch(error){entry.status='FAIL';entry.error=error.message;process.exitCode=1;}
 finally{entry.max_server_active=maxActive;entry.ended_at=new Date().toISOString();await save();if(page){try{await page.close();}catch{}}if(child?.exitCode===null)child.kill();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}console.log(JSON.stringify({case:name,status:entry.status,error:entry.error,first:entry.first,max_server_active:maxActive}));}
}
await save();
