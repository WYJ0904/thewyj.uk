import assert from 'node:assert/strict';import fs from 'node:fs';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8938';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9250',baseUrl,width:390,height:900,mobile:true});
try {
 await p.navigate('/');await p.waitFor('!document.getElementById("entryScreen")');
 const registration=await p.evaluate("navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(r=>({scope:r.scope,state:r.active.state}))");
 await p.waitFor("navigator.serviceWorker.controller!==null",25000);
 await p.evaluate("(async()=>{await Promise.all(['/js/core/lazy-controller.js?v=20261006-p6-closure-2','/js/core/dashboard.js?v=20261006-p6-closure-2','/js/finance/format.js?v=20261006-p6-closure-2','/js/tools/digest-worker.js?v=20261006-p6-closure-2'].map(u=>fetch(u)));return true})()");await delay(500);
 const cache=await p.evaluate("(async()=>{const keys=await caches.keys(),items=await Promise.all(keys.map(k=>caches.open(k).then(c=>c.keys())));return {keys,paths:items.flat().map(r=>new URL(r.url).pathname),sensitive:items.flat().some(r=>new URL(r.url).pathname.startsWith('/api/'))};})()");assert.equal(cache.sensitive,false);assert.ok(cache.keys.every(k=>k.includes('20261006-p6-closure-2')));
 await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await p.send('Page.reload',{ignoreCache:false});await p.waitFor("document.querySelector('#appShell')&&!document.querySelector('#appShell').classList.contains('app-shell-pending')",35000);
 assert.equal(await p.evaluate("document.querySelector('#publicHome').dataset.sessionMode"),'guest');
 await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await p.send('Page.reload',{ignoreCache:true});await p.waitFor("!document.getElementById('entryScreen')",30000);
 const result={registration,cache,offlineGuestShell:true,onlineRecovery:true};fs.mkdirSync('artifacts/aeris-p5',{recursive:true});fs.writeFileSync('artifacts/aeris-p5/pwa.json',JSON.stringify(result,null,2));console.log(JSON.stringify({offlineGuestShell:true,onlineRecovery:true,cacheSensitive:false,versionedStaticCache:true}));
}finally{await p.close();}
