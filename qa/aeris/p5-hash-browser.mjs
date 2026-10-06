import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const mode=process.env.AERIS_P5_MODE||'after',baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8938';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9250',baseUrl,width:390,height:900,mobile:true});
fs.mkdirSync('artifacts/aeris-p5',{recursive:true});
try {
 await p.send('Page.addScriptToEvaluateOnNewDocument',{source:fs.readFileSync('qa/aeris/p5-probe.js','utf8')});
 await p.navigate('/login');await p.waitFor('!document.getElementById("entryScreen")');await p.setFields({'#usernameInput':'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');await p.waitFor("location.pathname==='/'");await p.navigate('/tools/file-md5');await p.waitFor("!document.querySelector('#toolWorkbench').classList.contains('hidden')");
 const n=32*1024**2,expected=crypto.createHash('md5').update(Buffer.alloc(n,21)).digest('hex');
 const result=await p.evaluate(`(async()=>{const start=__p5Probe.mark(),before=performance.now(),frames=[];let stopped=false,last=performance.now();const sample=at=>{frames.push(at-last);last=at;if(!stopped)requestAnimationFrame(sample)};requestAnimationFrame(sample);const m=await import('/js/tools/file.js?v=20261006-home-refinement-1'),hash=await m.digestFile(new File([new Uint8Array(${n}).fill(21)],'p5-own-32MiB.bin'),'MD5');stopped=true;await new Promise(r=>requestAnimationFrame(r));return {hash,elapsedMs:performance.now()-before,frames,probe:__p5Probe.read(start)}})()`);
 assert.equal(result.hash,expected);await delay(50);result.probe=await p.evaluate(`__p5Probe.read(${result.probe.started})`);fs.writeFileSync(`artifacts/aeris-p5/${mode}-hash.json`,JSON.stringify({mode,size:n,...result},null,2));console.log(JSON.stringify({mode,size:n,hash:result.hash,elapsedMs:result.elapsedMs,maxFrameGap:Math.max(...result.frames),longTasks:result.probe.longTasks.map(t=>t.duration)}));
}finally{await p.close();}
