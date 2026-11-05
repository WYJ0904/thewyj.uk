import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {openPage} from '../../local-backend/browser_harness.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const output=path.resolve(process.env.P07_D_EVIDENCE);
const shotDir=path.join(output,'hosted-readonly-screenshots');
await fs.mkdir(shotDir,{recursive:true});
const targets=[
  {sha:'21b83316cbfdeb366c587b9e818a2c64e2199215',origin:'https://3e07b5fd.thewyj-p07-ui-rc.pages.dev'},
  {sha:'fb936d109d0900d02d35eb3493212e4c32c39699',origin:'https://13dbeea6.thewyj-p07-ui-rc.pages.dev'},
  {sha:'f7949f8253f51ea2621c397743208971c0cec467',origin:'https://a6e61c0e.thewyj-p07-ui-rc.pages.dev'},
];
const files=['index.html','app.js','spatial-experience.css','js/core/public-experience.js','js/finance/app.js'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>value.replaceAll('\r\n','\n');
const results=[];

for(const target of targets){
  const row={...target,scope:'guest, read-only Hosted Preview; protected workspaces and administrator identity NOT_TESTED',
    apiMutations:[],assets:[],screenshots:[]};
  let page;
  try{
    page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:target.origin,width:1440,height:960,mobile:false});
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__p07HostedDoc=String(performance.timeOrigin)+Math.random();'});
    await page.intercept([{match:target.origin+'/api/',respond:({method,url})=>{
      if(['GET','HEAD','OPTIONS'].includes(method))return {continue:true};
      row.apiMutations.push({method,path:new URL(url).pathname,action:'blocked_before_network'});
      return {status:403,body:{ok:false,code:'qa_readonly_boundary'}};
    }}]);
    await page.send('Page.bringToFront');
    const nav=await page.send('Page.navigate',{url:target.origin+'/'});
    assert.ok(!nav.errorText,nav.errorText);
    await page.waitFor("Boolean(globalThis.__p07HostedDoc)&&document.readyState==='complete'&&document.getElementById('appShell')&&!document.getElementById('entryScreen')",45000,'Hosted guest boot');
    await page.waitFor("document.getElementById('publicHome')?.getClientRects().length>0&&!document.getElementById('publicHome').closest('.hidden')",20000,'Hosted guest home');
    row.policy=await page.evaluate(`(async()=>{const results={};for(const p of ['/api/status?source=cloud','/api/ui/features']){
      const r=await fetch(p,{credentials:'omit',cache:'no-store'});let body=null;try{body=await r.json()}catch{}
      results[p]={status:r.status,capabilities:body?.capabilities||null,public_ui:body?.public_ui||null,build:body?.build||null,
        service_status:body?.status||null,environment:body?.environment||null,ai_ready:body?.ai_ready??null,model:body?.model||null,
        bindings:body?.bindings||null,admin_messages_enabled:body?.task18?.enabled??null,degraded_reasons:body?.degraded_reasons||[]};}return results;})()`);
    row.browser=await page.evaluate('({userAgent:navigator.userAgent,webdriver:navigator.webdriver,p07:document.documentElement.dataset.p07Ui,sessionPresent:Boolean(localStorage.getItem("wyjAccountSession"))})');
    assert.equal(row.browser.sessionPresent,false,'Hosted read-only check must remain unauthenticated');
    row.layouts=[];
    for(const width of [1440,390]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width===390});
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      row.layouts.push(await page.evaluate(`(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        p07:document.documentElement.dataset.p07Ui,modalLayers:[...document.querySelectorAll('.modal-layer:not(.hidden)')].map(e=>e.id),
        homeVisible:Boolean(document.getElementById('publicHome').getClientRects().length),shellInert:document.getElementById('appShell').inert}))()`));
      const screenshot=`${target.sha.slice(0,7)}-hosted-guest-${width}.png`;
      const shot=await page.send('Page.captureScreenshot',{format:'png'});
      await fs.writeFile(path.join(shotDir,screenshot),Buffer.from(shot.data,'base64'));row.screenshots.push(screenshot);
    }
    const assetResults=await Promise.allSettled(files.map(async file=>{
      const expected=spawnSync('git',['show',target.sha+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
      assert.equal(expected.status,0,'read pinned source '+file);
      const response=await fetch(target.origin+'/'+file,{signal:AbortSignal.timeout(20000)});
      const text=await response.text();
      return {file,status:response.status,normalized_sha256:hash(normalize(text)),expected_sha256:hash(normalize(expected.stdout)),
        matches:response.status===200&&hash(normalize(text))===hash(normalize(expected.stdout))};
    }));
    row.assets=assetResults.map((r,i)=>r.status==='fulfilled'?r.value:{file:files[i],status:'FETCH_ERROR',error:r.reason.message});
    assert.ok(row.assets.every(x=>x.matches),'Hosted selected asset bytes do not match the supplied pinned SHA');
    assert.equal(row.apiMutations.length,0,'guest UI attempted a mutating API');
    assert.ok(row.layouts.every(x=>x.scrollWidth<=x.width+1&&!x.shellInert&&x.modalLayers.length===0),'Hosted home layout or overlay failure');
    row.status='PASS';
  }catch(error){row.status='FAIL';row.error=error.message;}
  finally{if(page)await page.close();}
  results.push(row);
}
await fs.writeFile(path.join(output,'hosted-readonly-results.json'),JSON.stringify({read_only:true,logged_in:false,
  real_ai_calls:0,production_operations:0,results},null,2));
console.log(JSON.stringify(results.map(x=>({sha:x.sha,status:x.status,error:x.error,matchedAssets:x.assets.filter(a=>a.matches).length})),null,2));
if(results.some(x=>x.status!=='PASS'))process.exitCode=1;
