import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CdpClient } from '../../local-backend/browser_harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'docs/migration-evidence/aeris-p03-p07/v62-samsung-preview-r1');
const label = process.argv[2]; assert(/^[a-z0-9-]+$/.test(label));
const pkg = 'uk.thewyj.app.v62spatialqa', origin = 'https://ac8cec2c.thewyj-p07-ui-rc.pages.dev';
const serial=process.env.AERIS_QA_SERIAL;assert(serial&&/^[A-Za-z0-9_-]+$/.test(serial),'Explicit QA device required');
const identities=JSON.parse(await fs.readFile(path.join(root,'docs/migration-evidence/aeris-p03-p07/private/v62-owned-preview-access.json'),'utf8'));
assert.equal(identities.origin,origin);const expectedId=identities.accounts.find(a=>a.scope==='validation').id;
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const run = (...args) => execFileSync(adb, ['-P','5057','-s',serial, ...args], { encoding:'utf8', timeout:20000, windowsHide:true });
const foreground = () => assert(run('shell','dumpsys','window').split('\n').some(line => line.includes('mCurrentFocus=') && line.includes(pkg+'/')), 'Only this QA foreground may be inspected');
let port, client, result;
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error('Read-only QA probe deadline')),10000); })]); }
  finally { clearTimeout(timer); }
};
try {
  foreground();
  const pid = run('shell','pidof',pkg).trim(); assert(/^\d+$/.test(pid));
  const socket = 'webview_devtools_remote_'+pid;
  assert(run('shell','cat','/proc/net/unix').split('\n').some(line=>line.trimEnd().endsWith('@'+socket)), 'Owned process must expose its own debug socket');
  port = run('forward','tcp:0','localabstract:'+socket).trim(); assert(/^\d+$/.test(port));
  const targets = await bounded(fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json()));
  const pages = targets.filter(t=>t.type==='page' && new URL(t.url).origin===origin);
  assert.equal(pages.length,1,'Expected one owned Preview document; own-process page locations='+JSON.stringify(targets.filter(t=>t.type==='page').map(t=>{const u=new URL(t.url);return{origin:u.origin,path:u.pathname};})));
  client = new CdpClient(pages[0].webSocketDebuggerUrl);await client.connect();
  const response=await bounded(client.send('Runtime.evaluate',{expression:`(async () => {const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});const me=await response.json();return {
    accountHttp:response.status,matchesValidationAccount:me.account?.id===${JSON.stringify(expectedId)},
    origin:location.origin,path:location.pathname,readyState:document.readyState,
    policy:document.documentElement.dataset.p07Ui,theme:document.documentElement.dataset.theme,
    nativeReducedMotion:document.documentElement.dataset.androidReducedMotion||null,
    reducedMotionMedia:matchMedia('(prefers-reduced-motion: reduce)').matches,
    runtimeTestMode:globalThis.__WYJ_TEST_MODE__===true,cssWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    nativeUserAgent:navigator.userAgent.includes('thewyj-android/'),sessionPresent:Boolean(localStorage.getItem('wyjAccountSession')),
    layout:{bodyClass:document.body.className,rootClasses:document.documentElement.className,
      nativePageState:window.WYJ_PAGE_ACTIVITY||null,
      elements:['appShell','entryScreen','sessionRecovery','modulePicker','publicHome','projectApp','authPanel'].map(id=>{const n=document.getElementById(id);if(!n)return{id,missing:true};const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{id,className:n.className,display:s.display,visibility:s.visibility,width:r.width,height:r.height,inert:n.inert};})},
    webLoginVisible:document.getElementById('authPanel').getClientRects().length>0,
    cards:[...document.querySelectorAll('[data-home-widget]')].map(n=>({id:n.dataset.homeWidget,visible:n.getClientRects().length>0})),
    scripts:[...document.scripts].filter(n=>n.src).map(n=>new URL(n.src).pathname),
    webFinanceVisible:document.getElementById('financePage').getClientRects().length>0,
    transactionRows:[...document.querySelectorAll('[data-finance-transaction]')].filter(n=>n.getClientRects().length).length
  };})()`,returnByValue:true,awaitPromise:true,userGesture:false}));
  assert(!response.exceptionDetails);const actual=response.result.value;assert.equal(actual.origin,origin);foreground();
  assert.equal(actual.accountHttp,200);assert.equal(actual.matchesValidationAccount,true,'Normal HTTP-only native session must match the separate QA account');
  result={status:'PASS',scope:'Actual Samsung MainActivity WebView, read-only DevTools; no session injection or model/financial writes',actual,screenCapture:false};
} catch(error) { result={status:'FAIL',error:error.message,scope:'Owned QA-only read probe; no foreign WebView inspected'}; }
finally {
  client?.close();if(port)run('forward','--remove','tcp:'+port);
  await fs.writeFile(path.join(out,label+'.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}
if(result.status!=='PASS')process.exitCode=1;
