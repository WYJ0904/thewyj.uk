import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');

export function observeRelease(page,origin,source){
  const responses=[];
  page.client.listeners.add(message=>{
    if(message.method!=='Network.responseReceived')return;
    const response=message.params.response,url=new URL(response.url);
    if(url.origin===origin&&/\.(?:js|css)$/.test(url.pathname)&&source[url.pathname.slice(1)]!==undefined)
      responses.push({requestId:message.params.requestId,url:response.url,fromServiceWorker:!!response.fromServiceWorker});
  });
  return {start:()=>responses.length,async verify(start){
    const rows=[];
    for(const response of responses.slice(start)){
      const url=new URL(response.url),file=url.pathname.slice(1);
      if(!/^\d{8}-aeris-/.test(url.searchParams.get('v')||''))continue;
      const body=await page.send('Network.getResponseBody',{requestId:response.requestId});
      const text=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;
      const row={path:url.pathname,release:url.searchParams.get('v'),fromServiceWorker:response.fromServiceWorker,sha256:hash(text),matchesCommitted:hash(text)===hash(source[file])};
      assert.equal(row.matchesCommitted,true,'mixed release bytes: '+file);rows.push(row);
    }
    assert.ok(rows.filter(r=>r.path.endsWith('.css')).length>=6,'actual style response evidence missing');
    assert.ok(rows.filter(r=>r.path.endsWith('.js')).length>=25,'actual module response evidence missing');
    assert.equal(new Set(rows.map(r=>r.release)).size,1,'one document loaded different release identifiers');
    return rows;
  }};
}

export async function seedUserState(page){
  await page.evaluate(`(async()=>{
    localStorage.setItem('__r4a_synthetic_user_state','preserve');
    const cache=await caches.open('r4a-unrelated-user-cache');await cache.put('/__r4a_user_data',new Response('preserve'));
    await new Promise((resolve,reject)=>{const request=indexedDB.open('r4a-user-state',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put({currency:'CNY',balance:-9001000,synthetic:true},'ledger');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});return true;
  })()`);
}

export async function verifyOfflineAndData(page,{out,release,resources}){
  await page.waitFor(`navigator.serviceWorker.controller?.scriptURL.includes(${JSON.stringify(release)})`,20000,'new release controls the upgraded origin');
  await page.waitFor(`caches.has(${JSON.stringify('wyj-shell-'+release+'-es-modules')})`,20000,'completed new shell cache');
  const old=await page.evaluate('globalThis.__p07UpgradeDoc');
  await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  try{
    await page.send('Page.reload',{ignoreCache:false});
    await page.waitFor(`globalThis.__p07UpgradeDoc&&globalThis.__p07UpgradeDoc!==${JSON.stringify(old)}&&document.readyState==='complete'&&!document.getElementById('entryScreen')`,30000,'offline new release boot');
    await page.waitFor("document.documentElement.dataset.interfacePolicy==='error'&&document.getElementById('publicHome').checkVisibility()",20000,'finite offline fallback');
    const state=await page.evaluate(`(async()=>{
      const local=localStorage.getItem('__r4a_synthetic_user_state'),foreign=await (await caches.open('r4a-unrelated-user-cache')).match('/__r4a_user_data');
      const ledger=await new Promise((resolve,reject)=>{const r=indexedDB.open('r4a-user-state',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('records').objectStore('records').get('ledger');q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)}});
      const logo=[...document.images].find(n=>new URL(n.currentSrc||n.src,location.href).pathname==='/assets/brand/aeris-lockup.png');
      return{local,foreign:foreign?await foreign.text():null,ledger,accountInsideMain:document.getElementById('v3MainCanvas').contains(document.getElementById('accountModal')),logoLoaded:Boolean(logo&&logo.complete&&logo.naturalWidth>0),policy:document.documentElement.dataset.interfacePolicy,p07:document.documentElement.dataset.p07Ui};
    })()`);
    assert.equal(state.local,'preserve');assert.equal(state.foreign,'preserve');
    assert.deepEqual(state.ledger,{currency:'CNY',balance:-9001000,synthetic:true});
    assert.equal(state.accountInsideMain,true);assert.equal(state.logoLoaded,true);assert.equal(state.p07,'disabled');
    const proof={release,actualNormalReloadResources:resources,offlineShell:state,productionOperations:0};
    await fs.writeFile(path.join(out,'upgrade-safety.json'),JSON.stringify(proof,null,2));
    const shot=await page.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'offline-upgraded-shell.png'),Buffer.from(shot.data,'base64'));
    return proof;
  }finally{await page.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
}
