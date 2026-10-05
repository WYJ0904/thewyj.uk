import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';import {benchmarkFixture} from './fixture.mjs';
const mode=process.env.AERIS_P5_MODE||'baseline',baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8936';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const fixtureRoot=path.resolve('.tool-e2e/aeris-p5/fixtures');fs.mkdirSync(fixtureRoot,{recursive:true});
const large=benchmarkFixture(),small=path.join(fixtureRoot,'p5-owned-small.bin');fs.writeFileSync(small,Buffer.alloc(32768,35));
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9250',baseUrl,width:390,height:900,mobile:true});
try {
 await p.send('Page.addScriptToEvaluateOnNewDocument',{source:fs.readFileSync('qa/aeris/p5-probe.js','utf8')});await p.send('Performance.enable');
 await p.navigate('/login');await p.waitFor('!document.getElementById("entryScreen")');await p.setFields({'#usernameInput':'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');await p.waitFor("location.pathname==='/'&&document.querySelector('#publicHome').dataset.sessionMode==='authenticated'");
 await p.navigate('/transfer');await p.waitFor("!document.querySelector('#transferQuotaText').textContent.includes('加载中')");const begin=await p.evaluate('__p5Probe.mark()');
 await p.setFile('#transferFileInput',[large,small]);
 await p.waitFor("document.querySelector('#transferCompleteBtn').disabled===false",240000,'owned multipart complete');
 const upload=await p.evaluate(`({...__p5Probe.read(${begin}),queue:JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('wyjTransferQueue:')))||'{}').queue})`);
 assert.equal(upload.queue.length,2);for(const q of upload.queue)assert.equal(q.uploaded,q.size);
 fs.writeFileSync(`artifacts/aeris-p5/${mode}-upload.json`,JSON.stringify(upload,null,2));
 await p.click('#transferCompleteBtn');await p.waitFor("!document.querySelector('#transferShareCard').classList.contains('hidden')",20000);
 const result=await p.evaluate("({link:document.querySelector('#transferShareLink').value})");
 const share=new URL(result.link,baseUrl).hash.replace('#share=','');assert.ok(share);
 const metadata=await p.evaluate(`fetch('/api/transfer/shares/${share}').then(r=>r.json())`);const detail=metadata.share||metadata;
 const grant=await p.evaluate(`fetch('/api/transfer/shares/${share}/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"password":""}'}).then(r=>r.json())`);
 const files=detail.files||[];assert.equal(files.length,2);const integrity=[];
 for(const file of files) {
  const url=new URL(`/api/transfer/shares/${share}/download?file=${encodeURIComponent(file.file_id)}&grant=${encodeURIComponent(grant.download.token)}`,baseUrl);
  const response=await fetch(url);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const source=file.size_bytes===fs.statSync(large).size?large:small;const actual=crypto.createHash('sha256').update(bytes).digest('hex'),expected=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');assert.equal(actual,expected);integrity.push({name:file.file_name,size:bytes.length,sha256:actual,pass:true});
 }
 await p.click('#transferCurrentRevokeBtn');await p.waitFor("document.querySelector('#transferShareCard').classList.contains('hidden')",20000);
 assert.deepEqual(p.runtimeErrors,[]);fs.writeFileSync(`artifacts/aeris-p5/${mode}-transfer.json`,JSON.stringify({mode,scope:'isolated real Pages D1/R2; synthetic owned files; not device/WAN',upload,integrity,revoked:true},null,2));console.log(JSON.stringify({mode,longTasks:upload.longTasks.length,storageWrites:upload.storageWrites.length,queueRootWrites:upload.mutations.filter(x=>x.id==='transferQueue').length,files:integrity.map(x=>({size:x.size,pass:x.pass}))}));
}finally{await p.close();}
