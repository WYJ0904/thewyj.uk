import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {CdpClient,delay} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..'),pkg='uk.thewyj.app.v62spatialqa';
const serial=process.env.AERIS_QA_SERIAL;assert(serial&&/^[A-Za-z0-9_-]+$/.test(serial));
const out=path.join(root,'docs/migration-evidence/aeris-p03-p07/v62-samsung-touch-r1');await fs.mkdir(out);
const adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const run=(...args)=>execFileSync(adb,['-P','5057','-s',serial,...args],{encoding:'utf8',timeout:20000,windowsHide:true});
const foreground=()=>assert(run('shell','dumpsys','window').split('\n').some(l=>l.includes('mCurrentFocus=')&&l.includes(pkg+'/')),'Only owned QA foreground');
let port,c;const checks=[];let prefs;
async function evaluate(expression){const r=await Promise.race([c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:false}),delay(8000).then(()=>{throw Error('QA observation watchdog');})]);assert(!r.exceptionDetails);return r.result.value;}
async function touch(selector){
 foreground();const p=await evaluate(`(async()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw Error('Unavailable QA target');n.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=n.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;if(x<0||y<0||x>=innerWidth||y>=innerHeight||!n.contains(document.elementFromPoint(x,y)))throw Error('Target must be visible and unoccluded');return{x,y};})()`);
 await delay(8000);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1,radiusX:1,radiusY:1,force:1}]});
 await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(350);
}
try{
 foreground();const pid=run('shell','pidof',pkg).trim();assert(/^\d+$/.test(pid));const socket='webview_devtools_remote_'+pid;
 assert(run('shell','cat','/proc/net/unix').split('\n').some(l=>l.trimEnd().endsWith('@'+socket)));
 port=run('forward','tcp:0','localabstract:'+socket).trim();assert(/^\d+$/.test(port));
 const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());const target=targets.find(t=>t.type==='page'&&new URL(t.url).origin==='https://ac8cec2c.thewyj-p07-ui-rc.pages.dev');assert(target);
 c=new CdpClient(target.webSocketDebuggerUrl);await c.connect();
 prefs=await evaluate("JSON.stringify(Object.entries(localStorage).filter(([key])=>key.startsWith('aerisHomeWidgets:')))");
 for(const card of ['learning','finance','tools']){
  await touch('[data-widget-edit='+card+']');assert.equal(await evaluate("document.getElementById('homeWidgetEditor').open"),true);
  const screenshot=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,card+'-editor.png'),Buffer.from(screenshot.data,'base64'));
  await touch('#homeWidgetEditor [data-widget-cancel]');assert.equal(await evaluate("document.getElementById('homeWidgetEditor').open"),false);assert.equal(await evaluate('location.pathname'),'/');
  checks.push({card,status:'PASS',actualTouchInput:true,editorOpened:true,cancelReturnedHome:true});
 }
 assert.equal(await evaluate("JSON.stringify(Object.entries(localStorage).filter(([key])=>key.startsWith('aerisHomeWidgets:')))"),prefs);
 checks.push({id:'cancel-preserves-layout-storage',status:'PASS'});
}catch(error){checks.push({id:'touch-qa-failure',status:'FAIL',error:error.message});}
finally{c?.close();if(port)run('forward','--remove','tcp:'+port);const result={scope:'Actual Samsung owned MainActivity WebView, CDP touch input and real UI handlers; temporary scroll/editor/cancel only',checks,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length,financialWrites:0,productionOperations:0};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.fail)process.exitCode=1;}
