import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..'),out=path.resolve(process.env.P07_D_EVIDENCE);
const upstream=new URL(process.env.WYJ_TEST_BASE),port=Number(upstream.port)+20;
assert.equal(upstream.hostname,'127.0.0.1');
assert.equal(process.env.P07_D_TARGET_HEAD,'21b83316cbfdeb366c587b9e818a2c64e2199215','warm the exact RED source before upgrade');
const oldSha=process.env.P07_D_TARGET_HEAD,newSha=process.env.P07_D_UPGRADE_CANDIDATE_SHA||'fb936d109d0900d02d35eb3493212e4c32c39699';
assert.ok(['fb936d109d0900d02d35eb3493212e4c32c39699','f7949f8253f51ea2621c397743208971c0cec467'].includes(newSha),'upgrade target must be pinned');
const files=['index.html','app.js','spatial-experience.css','js/core/public-experience.js','js/finance/app.js'];
const source=(sha,file)=>{const r=spawnSync('git',['show',sha+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});assert.equal(r.status,0);return r.stdout;};
const next=Object.fromEntries(files.map(file=>[file,source(newSha,file)]));
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const appUrl=html=>html.match(/src="([^\"]*\/app\.js[^\"]*)"/)[1];
const oldUrl=appUrl(source(oldSha,'index.html')),newUrl=appUrl(next['index.html']);
let generation='red';const requests=[],responses=[],phases=[];
const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://127.0.0.1:'+port);
    if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    requests.push({generation,path:url.pathname+url.search});
    const original=await fetch(new URL(request.url,upstream),{signal:AbortSignal.timeout(15000)});
    const headers=Object.fromEntries([...original.headers].filter(([k])=>!['content-encoding','content-length','transfer-encoding','connection'].includes(k)));
    const bytes=generation==='candidate'&&next[file]!==undefined?Buffer.from(next[file]):Buffer.from(await original.arrayBuffer());
    response.writeHead(original.status,headers);response.end(request.method==='HEAD'?undefined:bytes);
  }catch(error){response.writeHead(502,{'Content-Type':'text/plain'});response.end('Local upgrade fixture transport error');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port,exclusive:true},resolve);});
const origin='http://127.0.0.1:'+port;
const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:origin,width:1440,height:960,mobile:false});
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__p07UpgradeDoc=String(performance.timeOrigin)+Math.random()'});
await page.send('Network.setCacheDisabled',{cacheDisabled:false});
page.client.listeners.add(message=>{if(message.method==='Network.responseReceived'){
  const r=message.params.response;if(new URL(r.url).pathname==='/app.js')responses.push({requestId:message.params.requestId,url:r.url,fromServiceWorker:!!r.fromServiceWorker,fromDiskCache:!!r.fromDiskCache});
}});
async function navigate(kind){
  const old=await page.evaluate('globalThis.__p07UpgradeDoc||null'),start=responses.length;
  if(kind==='direct')await page.send('Page.navigate',{url:origin+'/'});
  else await page.send('Page.reload',{ignoreCache:kind==='hard'});
  await page.waitFor(`globalThis.__p07UpgradeDoc&&globalThis.__p07UpgradeDoc!==${JSON.stringify(old)}&&document.readyState==='complete'&&!document.getElementById('entryScreen')`,30000,'upgraded document boot');
  await page.waitFor("document.getElementById('publicHome').getClientRects().length>0&&!document.getElementById('publicHome').closest('.hidden')",15000,'upgrade home');
  const actual=responses.slice(start).at(-1);assert.ok(actual,'actual app.js response absent');
  const body=await page.send('Network.getResponseBody',{requestId:actual.requestId});
  const text=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;
  const dom=await page.evaluate("({accountTag:document.getElementById('accountModal').tagName,accountInsideMain:document.getElementById('v3MainCanvas').contains(document.getElementById('accountModal')),p07:document.documentElement.dataset.p07Ui,controller:navigator.serviceWorker.controller?.scriptURL||null})");
  return {kind,generation,...actual,actual_app_sha256:hash(text),matchesRed:hash(text)===hash(source(oldSha,'app.js')),
    matchesCandidate:hash(text)===hash(next['app.js']),dom};
}
let error=null;
try{
  const warm=await navigate('direct');phases.push(warm);
  await page.evaluate('navigator.serviceWorker.ready.then(()=>true)');
  await page.waitFor('Boolean(navigator.serviceWorker.controller)',10000,'warm Service Worker controller');
  await page.waitFor(`caches.match(${JSON.stringify(origin+oldUrl)}).then(Boolean)`,15000,'old app.js cached');
  generation='candidate';
  phases.push(await navigate('normal'));
  phases.push(await navigate('hard'));
  const cachesState=await page.evaluate(`(async()=>{const rows=[];for(const name of await caches.keys()){const c=await caches.open(name);rows.push({name,appKeys:(await c.keys()).map(r=>r.url).filter(u=>new URL(u).pathname==='/app.js')});}return rows})()`);
  const report={scope:'isolated same-origin upgrade simulation, exact product bytes; public GET only',old_sha:oldSha,new_sha:newSha,oldAppUrl:oldUrl,newAppUrl:newUrl,
    expected_red_app_sha256:hash(source(oldSha,'app.js')),expected_candidate_app_sha256:hash(next['app.js']),phases,caches:cachesState,serverRequests:requests,
    production_operations:0,remote_mutations:0};
  await fs.writeFile(path.join(out,'cache-upgrade.json'),JSON.stringify(report,null,2));
  assert.ok(phases.filter(p=>p.generation==='candidate').every(p=>p.matchesCandidate),'new HTML reused old cached app.js after same-origin upgrade');
}catch(e){error=e.message;}
finally{await page.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({old_sha:oldSha,new_sha:newSha,phases,error},null,2));
if(error)process.exitCode=1;
