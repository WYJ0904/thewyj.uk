import {ASSET_RELEASE} from '../asset-release.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import vm from 'node:vm';
import {openPage} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8938';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const expectedCacheName=fs.readFileSync('sw.js','utf8').match(/^const CACHE = "([^"]+)";/m)?.[1];
assert.ok(expectedCacheName?.startsWith('wyj-shell-'),'Service Worker must name its release cache');
const metadata={self:{addEventListener(){}}};
vm.runInNewContext(fs.readFileSync('sw.js','utf8')+';globalThis.releaseMeta={publication:PUBLICATION_CACHE,marker:PUBLICATION_MARKER,hash:PUBLICATION_HASH,required:REQUIRED_SHELL,integrity:TASK26_INTEGRITY,optional:OPTIONAL_BRAND_ASSETS};',metadata);
const publication=JSON.parse(JSON.stringify(metadata.releaseMeta));
assert.equal(publication.required.length,83);assert.notEqual(publication.publication,expectedCacheName);
const oldCache='wyj-shell-20261001-aeris-p5-retained-fixture-es-modules',userCache='p5-user-fixture';
const oldPath='/js/p5-old-client-fixture.js?v=20261001-aeris-p5-retained-fixture',userPath='/p5-user-fixture.txt';
const expectedScript=new URL('/sw.js?v='+ASSET_RELEASE,baseUrl).href;
const expectedApp=fs.readFileSync('index.html','utf8').match(/\bsrc="([^\"]*\/app\.js[^\"]*)"/)?.[1];assert.ok(expectedApp,'HTML must name its release-qualified app entry');
const artifact=path.resolve(process.env.AERIS_P5_PWA_OUTPUT||'artifacts/aeris-p5/pwa.json');
const proof={release:ASSET_RELEASE,cache:null,registration:null,offlineGuestShell:false,onlineRecovery:false,fixtureScope:'synthetic local retention; real same-origin release-byte upgrade tested separately'};
const save=()=>{fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,JSON.stringify(proof,null,2));};
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9250',baseUrl,width:390,height:900,mobile:true});
try {
 // Install fixtures before the real worker activates. The previous blanket
 // cache deletion fails these exact preservation assertions.
 await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__p5SeedReady=Promise.all([
   caches.open(${JSON.stringify(oldCache)}).then(c=>c.put(${JSON.stringify(oldPath)},new Response('isolated old client bytes'))),
   caches.open(${JSON.stringify(userCache)}).then(c=>c.put(${JSON.stringify(userPath)},new Response('isolated user bytes')))
 ]).then(()=>true);`});
 await p.navigate('/');await p.waitFor('!document.getElementById("entryScreen")');await p.evaluate('globalThis.__p5SeedReady');
 // Match the application registration; bare /sw.js starts a second update.
 await p.evaluate(`navigator.serviceWorker.register(${JSON.stringify(expectedScript)}).then(()=>true)`);
 await p.waitFor(`navigator.serviceWorker.controller?.scriptURL===${JSON.stringify(expectedScript)}`,25000,'current release controls the page');
 await p.waitFor(`(async()=>{const keys=await caches.keys();if(!keys.includes(${JSON.stringify(publication.publication)})||keys.some(k=>k.endsWith('-installing')))return false;const cache=await caches.open(${JSON.stringify(publication.publication)}),marker=await cache.match(${JSON.stringify(publication.marker)});return marker&&await marker.text()===${JSON.stringify(publication.hash)}&&Boolean(await cache.match(${JSON.stringify(expectedApp)}));})()`,25000,'complete release publication committed');
 proof.registration=await p.evaluate('navigator.serviceWorker.getRegistration().then(r=>({scope:r.scope,state:r.active.state,script:r.active.scriptURL}))');
 await p.evaluate(`Promise.all(['/js/core/lazy-controller.js?release=${ASSET_RELEASE}','/js/core/dashboard.js?release=${ASSET_RELEASE}','/js/finance/format.js?release=${ASSET_RELEASE}','/js/tools/digest-worker.js?release=${ASSET_RELEASE}'].map(u=>fetch(u).then(r=>{if(!r.ok)throw Error('release module unavailable');return r.text()}))).then(()=>true)`);
 proof.cache=await p.evaluate(String.raw`(async()=>{const keys=await caches.keys(),items=await Promise.all(keys.map(k=>caches.open(k).then(c=>c.keys())));
   const read=async(name,url)=>{const r=await (await caches.open(name)).match(url);return r?await r.text():null};
   const meta=${JSON.stringify(publication)},cache=await caches.open(meta.publication),missing=[],invalid=[];
   for(const asset of meta.required)if(!await cache.match(asset))missing.push(asset);
   for(const [asset,expected]of Object.entries(meta.integrity)){const response=await cache.match(asset);if(!response){invalid.push(asset);continue;}const bytes=new TextEncoder().encode((await response.text()).replace(/\r\n?/g,'\n'));const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(actual!==expected)invalid.push(asset);}
   const allowed=[...meta.required,meta.marker,...meta.optional],unexpected=(await cache.keys()).map(r=>{const u=new URL(r.url);return u.pathname+u.search}).filter(asset=>!allowed.includes(asset));
   return{keys,paths:items.flat().map(r=>new URL(r.url).pathname),sensitive:items.flat().some(r=>new URL(r.url).pathname.startsWith('/api/')),
     publication:{missing,invalid,unexpected,marker:await read(meta.publication,meta.marker)},
     oldBytes:await read(${JSON.stringify(oldCache)},${JSON.stringify(oldPath)}),userBytes:await read(${JSON.stringify(userCache)},${JSON.stringify(userPath)})}})()`);save();
 assert.equal(proof.cache.sensitive,false,'API responses must never enter shell caches');
 assert.deepEqual([...proof.cache.keys].sort(),[expectedCacheName,publication.publication,oldCache,userCache].sort(),'unexpected or unfinished cache lifecycle');
 assert.deepEqual(proof.cache.publication.missing,[],'all 83 required resources must exist');
 assert.deepEqual(proof.cache.publication.invalid,[],'Task26 publication source hashes must match');
 assert.deepEqual(proof.cache.publication.unexpected,[],'publication may contain only required assets, marker and reviewed optional artwork');
 assert.equal(proof.cache.publication.marker,publication.hash);
 assert.equal(proof.cache.oldBytes,'isolated old client bytes','an old client must retain its exact assets');
 assert.equal(proof.cache.userBytes,'isolated user bytes','worker activation must preserve unrelated user storage');
 await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await p.send('Page.reload',{ignoreCache:false});await p.waitFor("!document.getElementById('entryScreen')&&!document.getElementById('appShell').classList.contains('app-shell-pending')&&document.getElementById('publicHome').checkVisibility()",35000,'visible offline guest shell');
 assert.equal(await p.evaluate("document.querySelector('#publicHome').dataset.sessionMode"),'guest');
 proof.offlineGuestShell=true;
 await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await p.send('Page.reload',{ignoreCache:true});await p.waitFor("!document.getElementById('entryScreen')&&document.documentElement.dataset.interfacePolicy!=='pending'&&document.getElementById('publicHome').checkVisibility()",30000,'visible online guest recovery');
 proof.onlineRecovery=true;save();console.log(JSON.stringify({offlineGuestShell:true,onlineRecovery:true,cacheSensitive:false,versionedStaticCache:true,priorClientBytesPreserved:true,userBytesPreserved:true}));
}catch(error){proof.error=error.message;save();throw error;}finally{await p.close();}
