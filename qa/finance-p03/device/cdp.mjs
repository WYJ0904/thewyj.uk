// Actual phone QA WebView only. Never enumerate other processes, cookies or storage.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../../..'),out=path.join(root,'docs/migration-evidence/finance-p03/device');
const adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true});
const rows=run('devices','-l').split(/\r?\n/).filter(s=>/^\S+\s+device\s+/.test(s));assert.equal(rows.length,1);assert.match(rows[0],/model:SM_S9360\b/);const serial=rows[0].split(/\s+/)[0];
const nls=run('-s',serial,'shell','settings','--user','0','get','secure','enabled_notification_listeners');assert.ok(!nls.includes('uk.thewyj.app/uk.thewyj.app.task21.ThewyjNotificationListenerService'));
const started=run('-s',serial,'shell','am','start','-W','-n','uk.thewyj.app.debug/uk.thewyj.app.MainActivity','-a','android.intent.action.VIEW','-d','thewyj://app?route=%2Ffinance');assert.match(started,/Status: ok/);
let pid;for(let k=0;k<30;k++){pid=run('-s',serial,'shell','pidof','-s','uk.thewyj.app.debug').trim();if(/^\d+$/.test(pid))break;await new Promise(r=>setTimeout(r,100))}assert.match(pid,/^\d+$/);
run('-s',serial,'forward','tcp:19444','localabstract:webview_devtools_remote_'+pid);
let ws,seq=0;const pending=new Map();
try{
 let targets=[];for(let k=0;k<50;k++){try{targets=await(await fetch('http://127.0.0.1:19444/json/list')).json()}catch{}if(targets.some(t=>t.url.startsWith('https://localhost:19443/')))break;await new Promise(r=>setTimeout(r,200))}
 const ownedTargets=targets.filter(t=>t.url.startsWith('https://localhost:19443/'));
 const target=ownedTargets.find(t=>{try{return JSON.parse(t.description).visible}catch{return false}})||ownedTargets[0];assert.ok(target,'Only a QA-local WebView may be inspected');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){const {resolve,reject,timer}=pending.get(v.id);clearTimeout(timer);pending.delete(v.id);v.error?reject(new Error(v.error.message)):resolve(v.result)}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Owned CDP timeout '+method))},5000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
 const js=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
 const capture=()=>js(`(()=>({path:location.pathname,visibility:document.visibilityState,androidWebActive:document.documentElement.dataset.androidWebActive,fields:Object.fromEntries(['financeExpenseTotal','financeRefundTotal','financeBalanceTotal','financeTransactionCount','dashboardFinanceBalance','dashboardFinanceSync'].map(id=>[id,document.getElementById(id)?.textContent])),classes:Object.fromEntries(['publicHome','financePage','financeWorkspace','modulePicker'].map(id=>[id,document.getElementById(id)?.className]))}))()`);
 await new Promise(r=>setTimeout(r,2000));const before=await capture();
 const name=process.argv[2]||'owned-webview-diagnostic';assert.match(name,/^[a-z0-9-]+$/);
 await fs.writeFile(path.join(out,name+'-before.json'),JSON.stringify({before,ownedTargets:ownedTargets.map(t=>({url:t.url,description:t.description}))},null,2),{flag:'wx'});
 if(!process.argv.includes('--no-images'))await fs.writeFile(path.join(out,name+'-finance.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'),{flag:'wx'});
 await js(`document.getElementById('financeRecordedSection').open=true;document.getElementById('financeAllMonthsBtn').click()`);
 await new Promise(r=>setTimeout(r,500));if(!process.argv.includes('--no-images'))await fs.writeFile(path.join(out,name+'-history.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'),{flag:'wx'});
 await js(`document.getElementById('financeBackBtn').click()`);await new Promise(r=>setTimeout(r,1500));const after=await capture();
 if(!process.argv.includes('--no-images'))await fs.writeFile(path.join(out,name+'-back.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'),{flag:'wx'});
 const result={scope:'Actual Samsung QA WebView, not desktop DOM; only whitelisted UI text, no credentials/storage',before,after,pid,synthetic_only:true};await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}finally{ws?.close();run('-s',serial,'forward','--remove','tcp:19444')}
