import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPage} from '../../local-backend/browser_harness.mjs';
const base=new URL(process.env.WYJ_TEST_BASE).origin,out=process.env.P07_D_EVIDENCE;
assert.equal(new URL(base).hostname,'127.0.0.1');
const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET})});
assert.equal(response.status,200);const login=await response.json();
const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:base,width:1440,height:960,mobile:false}),pending=new Map(),errors=[],rows=[];
page.client.listeners.add(message=>{
  if(message.method==='Network.requestWillBeSent'){const r=message.params.request;pending.set(message.params.requestId,{path:new URL(r.url).pathname,at:Date.now()});}
  if(['Network.loadingFinished','Network.loadingFailed'].includes(message.method))pending.delete(message.params.requestId);
});
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__r4aReload={id:performance.timeOrigin+Math.random(),frames:0,timers:[],events:[],errors:[]};
for(const e of ['DOMContentLoaded','visibilitychange'])document.addEventListener(e,()=>__r4aReload.events.push({event:e,t:performance.now(),visibility:document.visibilityState}));
addEventListener('error',e=>__r4aReload.errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__r4aReload.errors.push(String(e.reason)));
for(const ms of [1000,3000,10000])setTimeout(()=>__r4aReload.timers.push({scheduled:ms,t:performance.now(),frames:__r4aReload.frames,visibility:document.visibilityState,entry:Boolean(document.getElementById('entryScreen'))}),ms);
requestAnimationFrame(function sample(){__r4aReload.frames++;requestAnimationFrame(sample)});`});
async function boot(route,kind){
  const before=await page.evaluate('globalThis.__r4aReload?.id||null');
  if(kind==='direct')await page.send('Page.navigate',{url:base+route});else await page.send('Page.reload',{ignoreCache:kind==='hard'});
  const started=Date.now();
  try{await page.waitFor(`globalThis.__r4aReload?.id&&globalThis.__r4aReload.id!==${JSON.stringify(before)}&&document.readyState==='complete'&&!document.getElementById('entryScreen')&&!document.getElementById('appShell').classList.contains('app-shell-pending')`,30000,'diagnostic actual boot '+route);
    await page.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'",15000,'account policy');
    const state=await page.evaluate("({policy:document.documentElement.dataset.interfacePolicy,p07:document.documentElement.dataset.p07Ui,visibility:document.visibilityState,probe:__r4aReload})");rows.push({route,kind,durationMs:Date.now()-started,...state});
  }catch(error){const state=await page.evaluate("({ready:document.readyState,policy:document.documentElement.dataset.interfacePolicy,p07:document.documentElement.dataset.p07Ui,visibility:document.visibilityState,entry:document.getElementById('entryScreen')?.outerHTML,shell:document.getElementById('appShell')?.className,probe:globalThis.__r4aReload})");
    errors.push({route,kind,error:error.message,state,pending:[...pending.values()]});const shot=await page.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'reload-diagnostic-failure.png'),Buffer.from(shot.data,'base64'));throw error;
  }finally{await fs.writeFile(path.join(out,'reload-diagnostics.json'),JSON.stringify({source:process.env.P07_D_TARGET_HEAD,rows,errors,runtimeErrors:page.runtimeErrors},null,2));}
}
try{
  await page.send('Page.navigate',{url:base+'/login'});await page.waitFor("document.readyState==='complete'&&!document.getElementById('entryScreen')",30000);
  await page.evaluate(`localStorage.setItem('wyjAccountSession',${JSON.stringify(login.session)});true`);
  for(let i=0;i<6;i++)for(const route of ['/account','/recharge','/finance']){
    await boot(route,'direct');await boot(route,'normal');await boot(route,'hard');
  }
}finally{await page.close();}
console.log(JSON.stringify({boots:rows.length,errors:errors.length,foregroundForced:false}));
