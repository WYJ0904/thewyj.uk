// Validity samples, not a performance optimization or a field INP claim.
import {assert,fs,path,base,out,fixtures,page,session} from '../p07-r5/harness.mjs';
const {A}=await fixtures(),samples=[],probe=await fs.readFile(new URL('./preflight-probe.js',import.meta.url),'utf8');
const contexts=[['public-home','/',null,'publicHome'],['authenticated-home','/',A.session,'publicHome'],['account-workspace','/account',A.session,'accountModal'],['finance-workspace','/finance',A.session,'financePage']];
for(const [context,route,token,id] of contexts){
  for(let repeat=1;repeat<=3;repeat++){
    const p=await page();
    try{
      await p.send('Network.setBypassServiceWorker',{bypass:true});await p.send('Network.setCacheDisabled',{cacheDisabled:true});await p.send('Emulation.setCPUThrottlingRate',{rate:1});
      if(token)await session(p,token,'/account');
      await p.send('Page.addScriptToEvaluateOnNewDocument',{source:probe+`;globalThis.__fLcpEntries=[];new PerformanceObserver(list=>{for(const e of list.getEntries()){const el=e.element;__fLcpEntries.push({time:e.startTime,size:e.size,tag:el?.tagName,id:el?.id,splash:!!el?.closest('#entryScreen'),workspace:el?.closest('#publicHome,#accountModal,#workspace,#financePage')?.id||null,inPublicHero:!!el?.closest('.public-hero'),sessionMode:document.getElementById('publicHome')?.dataset.sessionMode||null})}}).observe({type:'largest-contentful-paint',buffered:true});`});
      await p.navigate(route);await p.waitFor(`document.documentElement.dataset.interfacePolicy==='enabled'&&document.getElementById('${id}').checkVisibility()`,15000);
      if(token)assert.equal(await p.evaluate("document.getElementById('publicHome').dataset.sessionMode"),'authenticated');
      await p.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      // End the observation at the first trusted input, as the normal LCP lifecycle does.
      for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await p.evaluate('new Promise(r=>requestAnimationFrame(r))');
      const data=await p.evaluate(`({url:location.href,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},userAgent:navigator.userAgent,visible:document.visibilityState,boot:document.documentElement.dataset.bootState,sessionMode:document.getElementById('publicHome').dataset.sessionMode,metrics:__aerisPreflightProbe.getMetrics(),entries:__fLcpEntries})`);
      const lcp=data.metrics.lcpElement,entry=data.entries.at(-1);data.standardLcpArea=entry?.inPublicHero?'public-hero':entry?.splash?'splash':entry?.workspace;data.attribution={entry,rawProbeElement:lcp,timeMatches:!!entry&&Math.abs(entry.time-data.metrics.lcp)<1};data.workspaceReadyMs=await p.evaluate('performance.now()');const valid=Boolean(entry&&data.attribution.timeMatches&&!entry.splash&&entry.workspace===id);
      data.validForPrivateWorkbench=valid&&['account-workspace','finance-workspace'].includes(context)&&data.standardLcpArea!=='public-hero';
      const shot=await p.send('Page.captureScreenshot',{format:'png'}),screenshot=`lab-${context}-${repeat}.png`;await fs.writeFile(path.join(out,screenshot),Buffer.from(shot.data,'base64'));
      samples.push({context,repeat,validForRequestedWorkspace:valid,invalidReason:valid?null:entry?.splash?'LCP belongs to Splash':'LCP attribution does not match requested workspace',conditions:{runtime:'compiled local Pages + Miniflare + real Windows Chrome',CPUThrottle:1,network:'unthrottled loopback',browserCache:'disabled',serviceWorker:'bypassed for this lab only',observationEnds:'first trusted Tab after page ready and fonts',device:'desktop emulation, 1440x960 CSS px, DPR 1'},...data,screenshot});
    }finally{await p.close();}
  }
}
const report={source:process.env.P07_D_TARGET_HEAD,sampleCount:samples.length,repetitionsPerContext:3,samples,fieldINP:{status:'NOT_TESTED',reason:'No real-user field cohort; scripted lab input is not field INP'},status:'LAB_VALIDITY_RECORDED',scope:'No architecture, production, policy or cache strategy changes'};
await fs.writeFile(path.join(out,'f-workspace-lab.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({samples:samples.length,valid:samples.filter(x=>x.validForRequestedWorkspace).length,fieldINP:'NOT_TESTED'}));
