import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
import {ownedBrowser,openPage} from '../p07-release/owned-browser.mjs';
const root=path.resolve(import.meta.dirname,'../..'),local=process.argv.includes('--local');
let origin='https://6d3ca922.thewyj-uk.pages.dev',server;
if(local){server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!isAllowedPagesFile(file)||file.startsWith('functions/')){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'Content-Type':file.endsWith('.ico')?'image/x-icon':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream','Cache-Control':'no-store','Service-Worker-Allowed':'/'});res.end(await readFile(path.join(root,file)))}catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;}
const context={self:{addEventListener(){}}};
const worker=local?await readFile(path.join(root,'sw.js'),'utf8'):execFileSync('git',['show','29bdbb9e3ae4cd88019b6c0046aabc6df574a942:sw.js'],{encoding:'utf8',windowsHide:true});
vm.runInNewContext(worker+';globalThis.meta={required:REQUIRED_SHELL,publication:PUBLICATION_CACHE,release:RELEASE};',context);
const meta=JSON.parse(JSON.stringify(context.meta)),required=new Set(meta.required);
// Resolve the actual local source graph whose bytes were compared with Hosted.
const seen=new Set(),pending=meta.required.filter(a=>new URL(a,origin).pathname.endsWith('.js'));
while(pending.length){const asset=pending.pop();if(seen.has(asset))continue;seen.add(asset);const url=new URL(asset,origin),text=await readFile(path.join(root,url.pathname.slice(1)),'utf8');
 for(const regex of [/(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,/\bimport\(\s*["']([^"']+)["']\s*\)/g,/\bcreateRetryableImport\(\s*new\s+URL\(\s*["']([^"']+)["']/g])for(const m of text.matchAll(regex)){
  const next=new URL(m[1],url);if(next.origin===origin&&next.pathname.endsWith('.js'))pending.push(next.pathname+next.search);
 }
}
const missing=[...seen].filter(a=>!required.has(a));
const b=await ownedBrowser('preview-readonly-pwa');let p;
const proof={origin,baseline:'29bdbb9e3ae4cd88019b6c0046aabc6df574a942',scope:local?'local candidate only; owned Chrome; hard worker network block':'actual Hosted baseline; owned empty Chrome; static image control document; API network blocked',required_count:meta.required.length,api_attempts:[],api_responses:[],module_graph_missing:missing,checks:[]};
try{
 p=await openPage({cdpUrl:b.cdpUrl,baseUrl:origin,width:1200,height:800,mobile:false});
 await p.send('Network.setBlockedURLs',{urls:['*://*/api/*']});
 p.client.listeners.add(m=>{if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(origin+'/api/'))proof.api_attempts.push(m.params.request.url);
  if(m.method==='Network.responseReceived'&&m.params.response.url.startsWith(origin+'/api/'))proof.api_responses.push(m.params.response.status);});
 await p.send('Page.navigate',{url:origin+'/favicon.ico'});await p.waitFor("document.readyState==='complete'",15_000);
 assert.equal(await p.evaluate('location.origin'),origin);
 await p.evaluate(`(async()=>{localStorage.setItem('synthetic-preview-preserved','yes');const c=await caches.open('synthetic-owned-user-cache');await c.put('/synthetic-only',new Response('yes'));await navigator.serviceWorker.register('/sw.js?v='+${JSON.stringify(meta.release)});await navigator.serviceWorker.ready;return true})()`);
 await p.waitFor('!!navigator.serviceWorker.controller',30_000,'actual Hosted SW active');
 const inventory=await p.evaluate(`(async()=>{const keys=await caches.keys(),c=await caches.open(${JSON.stringify(meta.publication)});return {exists:keys.includes(${JSON.stringify(meta.publication)}),missing:(await Promise.all(${JSON.stringify(meta.required)}.map(async u=>[u,!!await c.match(u)]))).filter(x=>!x[1])}})()`);
 assert.equal(inventory.exists,true);assert.deepEqual(inventory.missing,[]);proof.checks.push({name:(local?'Local candidate':'Hosted')+' SW atomically installs '+meta.required.length+' required assets',status:'PASS'});
 await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 // Page-only offline emulation does not reliably stop a worker's own fetch.
 // Block the owned service worker too, and prove an uncached read cannot pass.
 const targets=await p.client.send('Target.getTargets');
 const target=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(origin+'/sw.js'));
 assert.ok(target,'owned Hosted service worker target');
 const {sessionId}=await p.client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await p.client.send('Network.enable',{},sessionId);
 await p.client.send('Network.setBlockedURLs',{urls:['*']},sessionId);
 await p.client.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},sessionId);
 const guard=await p.evaluate("fetch('/__p0_readonly_uncached_probe').then(r=>r.status).catch(()=> 'NETWORK_ERROR')");
 assert.equal(guard,'NETWORK_ERROR','uncached worker fetch must actually be blocked');proof.worker_network_block_verified=true;
 const html=await p.evaluate("fetch('/index.html').then(r=>r.text())");assert.ok(html.includes(meta.release));proof.checks.push({name:'cached shell survives verified network block',status:'PASS'});
 proof.offline_modules=[];
 for(const asset of [...new Set([...missing,...seen].filter(a=>missing.includes(a)||a.startsWith('/js/finance/money.js?')))]){const observed=await p.evaluate(`fetch(${JSON.stringify(asset)}).then(async r=>({status:r.status,bytes:(await r.arrayBuffer()).byteLength})).catch(e=>({status:'NETWORK_ERROR',error:e.message}))`);proof.offline_modules.push({asset,...observed});}
 proof.checks.push({name:'finance/new module graph fully available offline after fresh install',status:proof.offline_modules.every(r=>r.status===200)?'PASS':'FAIL'});
 assert.equal(await p.evaluate("localStorage.getItem('synthetic-preview-preserved')"),'yes');
 assert.equal(await p.evaluate("caches.open('synthetic-owned-user-cache').then(c=>c.match('/synthetic-only')).then(r=>r.text())"),'yes');
 proof.checks.push({name:'owned synthetic localStorage and user cache retained',status:'PASS'});
 assert.equal(proof.api_responses.length,0);assert.equal(proof.api_attempts.length,0);
 proof.remote_api_requests=0;proof.remote_db_writes=0;
}catch(e){proof.error=e.message;process.exitCode=1;}
finally{await p?.close().catch(()=>{});await b.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await writeFile(path.join(root,'.wrangler/preview-finance-evidence/'+(local?'local-pwa-fixed':'hosted-pwa-hardblocked')+'.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));}
