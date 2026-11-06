import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const base=new URL(process.env.WYJ_TEST_BASE).origin,out=process.env.P07_D_EVIDENCE;
assert.equal(new URL(base).hostname,'127.0.0.1');
const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET})});
assert.equal(response.status,200);const login=await response.json();
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:base,width:1440,height:960,mobile:false});
const results=[],observations={};
async function snapshot(){return p.evaluate(`(()=>{const w=document.getElementById('workflowWorkspace'),b=document.getElementById('runWorkflowBtn'),a=document.getElementById('accountModal');return{path:location.pathname,ready:document.readyState,visibility:document.visibilityState,policy:document.documentElement.dataset.interfacePolicy,p07:document.documentElement.dataset.p07Ui,splash:Boolean(document.getElementById('entryScreen')),splashClass:document.getElementById('entryScreen')?.className,shell:document.getElementById('appShell')?.className,accountVisible:Boolean(a&&a.checkVisibility()),workflowHidden:Boolean(w?.closest('.hidden')),workflowVisible:Boolean(w?.checkVisibility()),workspaceLeft:w?.getBoundingClientRect().left,workspaceRight:w?.getBoundingClientRect().right,runButtonHeight:b?.getBoundingClientRect().height,trace:globalThis.__r4cProbe}})()`);}
async function shot(name){const s=await p.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(s.data,'base64'));}
async function check(name,fn){try{results.push({name,status:'PASS',detail:await fn()});}catch(error){results.push({name,status:'FAIL',error:error.message,detail:observations[name],state:await snapshot()});await shot('FAIL-'+name);}await fs.writeFile(path.join(out,'runtime-probe.json'),JSON.stringify({source:process.env.P07_D_TARGET_HEAD,results,runtimeErrors:p.runtimeErrors},null,2));}
await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__r4cProbe={frames:0,timers:[],events:[]};for(const type of ['DOMContentLoaded','visibilitychange'])document.addEventListener(type,()=>__r4cProbe.events.push({type,t:performance.now(),visibility:document.visibilityState}));for(const ms of [1000,2500,5000])setTimeout(()=>__r4cProbe.timers.push({ms,t:performance.now(),frames:__r4cProbe.frames,splash:Boolean(document.getElementById('entryScreen')),shell:document.getElementById('appShell')?.className}),ms);requestAnimationFrame(function sample(){__r4cProbe.frames++;requestAnimationFrame(sample)});`});
try{
  await p.navigate('/login');await p.waitFor("!document.getElementById('entryScreen')",15000);
  await p.evaluate(`localStorage.setItem('wyjAccountSession',${JSON.stringify(login.session)});true`);
  await check('G02-online-policy-and-workflow-geometry',async()=>{
    await p.navigate('/tools/workflows');await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'&&document.getElementById('workflowWorkspace').checkVisibility()",15000);
    await p.click('[data-workflow-template="text-clean"]');await p.waitFor("document.getElementById('runWorkflowBtn').checkVisibility()&&!document.getElementById('runWorkflowBtn').disabled",5000);
    const before=await snapshot();
    await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await p.waitFor("document.documentElement.dataset.interfacePolicy==='error'",5000);
    await p.evaluate("window.WYJTools.show('/tools/workflows',{offline:true})");const offline=await snapshot();
    let release,observed;const gate=new Promise(r=>release=r),held=new Promise(r=>observed=r);
    await p.intercept([{match:'/api/features',respond:async()=>{const r=await fetch(base+'/api/features',{headers:{'X-Session-Token':login.session}});const body=await r.json();observed();await gate;return{status:r.status,body};}}]);
    await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await Promise.race([held,delay(5000).then(()=>{throw Error('real policy response was not observed')})]);
    const undecided=await snapshot();await shot('G02-undecided-policy');release();
    await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'&&document.getElementById('workflowWorkspace').checkVisibility()",15000);
    const settled=await snapshot();await shot('G02-settled-workflow');
    observations['G02-online-policy-and-workflow-geometry']={before,offline,undecided,settled};
    assert.equal(settled.path,before.path,'online recovery changed the workspace route');assert.equal(settled.workflowHidden,false);
    assert.ok(settled.runButtonHeight>=44);assert.ok(settled.workspaceRight>settled.workspaceLeft);
    return{before,offline,undecided,settled,immediateLegacyGeometryWouldFail:undecided.runButtonHeight===0};
  });
  await p.intercept([]);
  await check('G01-background-account-reload',async()=>{
    await p.navigate('/account');await p.waitFor("!document.getElementById('entryScreen')&&document.getElementById('accountModal').checkVisibility()",15000);
    const {targetInfos}=await p.client.send('Target.getTargets');const self=targetInfos.find(t=>t.targetId===p.targetId);assert.ok(self?.browserContextId);
    const blank=await p.client.send('Target.createTarget',{url:'about:blank',browserContextId:self.browserContextId});
    try{
      await p.client.send('Target.activateTarget',{targetId:blank.targetId});await p.send('Page.reload',{ignoreCache:false});
      await p.waitFor("document.readyState==='complete'&&globalThis.__r4cProbe?.timers.length>=2",10000,'background timers observed');
      const background=await snapshot();await shot('G01-background-bootstrap');
      await p.client.send('Target.activateTarget',{targetId:p.targetId});await p.send('Page.bringToFront');
      await p.waitFor("!document.getElementById('entryScreen')&&document.getElementById('accountModal').checkVisibility()",15000);
      const foreground=await snapshot();
      observations['G01-background-account-reload']={background,foreground};
      assert.equal(background.visibility,'hidden','probe must exercise a real background document');
      assert.equal(background.splash,false,'startup completion must not wait indefinitely for a background animation frame');
      return{background,foreground,backgroundWasActuallyHidden:background.visibility==='hidden',splashRetainedUntilForeground:background.splash};
    }finally{await p.client.send('Target.closeTarget',{targetId:blank.targetId}).catch(()=>{});}
  });
}finally{await p.close();}
console.log(JSON.stringify({results},null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
