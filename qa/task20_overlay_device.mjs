// Opt-in physical Preview audit. Real ADB taps, never element.click/openModal.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const adb = process.env.ADB || 'adb';
const serial = process.env.ANDROID_SERIAL;
const base = process.env.TASK20_PREVIEW_URL;
const userId = process.env.TASK20_FIXTURE_USER_ID;
const out = process.env.TASK20_OVERLAY_REPORT_DIR;
// Measured from the current physical window's status-bar inset, not product CSS.
const top = Number(process.env.TASK20_WEBVIEW_TOP_PX);
assert(serial && userId && out && Number.isFinite(top));
assert(/^https:\/\/[a-z0-9.-]+\.pages\.dev$/.test(base || ''));
const run = async (...args) => (await exec(adb, ['-s', serial, ...args], { timeout: 25000 })).stdout.trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], errors = [];
let socket, port, next = 0;
const calls = new Map();
async function until(check, label, timeout = 20000) {
  const end = Date.now()+timeout;
  while (Date.now()<end) { if (await check()) return; await delay(100); }
  throw new Error(`Did not settle: ${label}`);
}
function command(method, params={}) {
  return new Promise((resolve,reject) => {
    const id=++next;
    const timer=setTimeout(()=>{calls.delete(id);reject(new Error(`${method} timeout`));},20000);
    calls.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  assert(!r.exceptionDetails,'Device page evaluation failed');return r.result.value;
}
async function tap(selector) {
  let p;
  await until(async()=>{
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
    p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y);return {x,y,width:innerWidth,hit:e===hit||e.contains(hit),disabled:e.disabled};})()`);
    return p?.hit&&!p.disabled;
  },`tap target ${selector}`);
  const size=await run('shell','wm','size');
  const physicalWidth=Number(/(?:Override|Physical) size: (\d+)x\d+/.exec(size)?.[1]);
  assert(physicalWidth>0); const scale=physicalWidth/p.width;
  await run('shell','input','tap',String(Math.round(p.x*scale)),String(Math.round(top+p.y*scale)));
}
async function nativeTab(text, route) {
  const xmlPath='/data/local/tmp/wyj-overlay-ui.xml';
  await run('shell','uiautomator','dump',xmlPath);
  const xml=await run('shell','cat',xmlPath);
  const node=(xml.match(/<node\b[^>]+>/g)||[]).findLast(n=>n.includes(`text="${text}"`)&&n.includes('package="uk.thewyj.app.debug"'));
  const b=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node||'');assert(b,'Native tab missing');
  await run('shell','input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2)));
  await until(()=>evaluate(`location.pathname===${JSON.stringify(route)} && document.getElementById('sessionRecovery')?.classList.contains('hidden')`),route);
}
async function layer(id) {
  await until(()=>evaluate(`!document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`),id);
  await until(()=>evaluate(`!document.getElementById(${JSON.stringify(id)}).getAnimations({subtree:true}).some(a=>a.playState==='running')`),id+' animation');
  const m=await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),p=e.querySelector('.modal-panel'),r=p.getBoundingClientRect(),v=visualViewport;
    return {body:e.parentElement===document.body,inert:e.inert,backgroundInert:document.getElementById('appShell').inert,
      x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height,viewportHeight:v.height,viewportTop:v.offsetTop,width:innerWidth,
      overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert(m.body&&!m.inert&&m.backgroundInert,id+' layer ownership');
  assert(m.height>80&&m.x>=-1&&m.right<=m.width+1&&!m.overflow,id+' horizontal bounds');
  assert(m.y>=m.viewportTop-2&&m.bottom<=m.viewportTop+m.viewportHeight+2,id+' vertical bounds');
  return m;
}
async function close(id) {
  await tap(`#${id} [data-close-modal="${id}"], #${id} [data-finance-close="${id}"]`);
  await until(()=>evaluate(`document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`),id+' closed');
}
async function screenshot(name) {
  const device='/data/local/tmp/wyj-overlay-screen.png';
  await run('shell','screencap','-p',device); await run('pull',device,path.join(out,`${name}.png`));
}
async function picker(selector, kind) {
  await tap(selector);
  const xmlPath='/data/local/tmp/wyj-overlay-ui.xml';
  await run('shell','uiautomator','dump',xmlPath);
  const xml=await run('shell','cat',xmlPath);
  const present=/android:id\/(?:alertTitle|select_dialog_listview|button1|date_picker_header_year|month_view|custom)/.test(xml)
    || /class="android.widget.(?:ListView|DatePicker|NumberPicker)"/.test(xml);
  assert(present,`Native ${kind} did not open: ${selector}`);
  await screenshot(`${theme}-${selector.slice(1)}-${kind}`);
  await run('shell','input','keyevent','KEYCODE_BACK');
  results.push({test:selector,theme,kind,passed:true});
}
let theme='';
try {
  await mkdir(out,{recursive:true});
  const pid=await run('shell','pidof','uk.thewyj.app.debug');
  port=await run('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith(base+'/'));assert(tab,'Expected Preview missing');
  socket=new WebSocket(tab.webSocketDebuggerUrl);
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push('runtime_exception');
    const c=calls.get(m.id);if(!c)return;calls.delete(m.id);clearTimeout(c.timer);m.error?c.reject(new Error(m.error.message)):c.resolve(m.result);};
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  await command('Runtime.enable');
  assert(await evaluate(`(async()=>{const r=await fetch('/api/app/session');const d=await r.json();return r.ok&&d.account?.id===${JSON.stringify(userId)}})()`),'Isolated fixture mismatch');
  for(let n=0;n<4;n++) {
    const visible=await evaluate("[...document.querySelectorAll('.modal-layer:not(.hidden)')].filter(e=>!e.inert).at(-1)?.id");
    if(!visible)break;await close(visible);
  }
  if(await evaluate("!document.getElementById('versionNotice').classList.contains('hidden')")) {
    await tap('#dismissVersionNoticeBtn');
    await until(()=>evaluate("document.getElementById('versionNotice').classList.contains('hidden')"),'version notice dismissal');
    results.push({test:'version-notice-dismiss',passed:true});
  }
  for(theme of ['light','dark']) {
    await nativeTab('主页','/select');
    if(await evaluate("document.getElementById('siteNavToggle').getAttribute('aria-expanded')==='true'"))await tap('#siteNavToggle');
    if(await evaluate("document.getElementById('accountMenu').open"))await tap('#accountMenu summary');
    for(let n=0;n<3&&await evaluate('document.documentElement.dataset.themePreference')!==theme;n++)await tap('#themeToggleBtn');
    assert.equal(await evaluate('document.documentElement.dataset.theme'),theme);
    await tap('#siteNavToggle');
    await until(()=>evaluate("document.getElementById('siteNavToggle').getAttribute('aria-expanded')==='true'"),'nav opens');
    await until(()=>evaluate("document.getElementById('siteNavPanel').getBoundingClientRect().height>100 && !document.getElementById('siteNavPanel').getAnimations().some(a=>a.playState==='running')"),'nav fully expanded');
    await screenshot(`${theme}-navigation`);
    await tap('#accountMenu summary');
    await until(()=>evaluate("document.getElementById('accountMenu').open && document.getElementById('siteNavToggle').getAttribute('aria-expanded')==='false'"),'exclusive account menu');
    await tap('#membershipBtn'); await layer('membershipModal');
    await tap('[data-membership-goal="finance"]');
    await until(()=>evaluate("document.querySelectorAll('#membershipPlanList button').length>0"),'plans');
    await screenshot(`${theme}-membership`); await close('membershipModal');
    await tap('#accountMenu summary');await tap('#accountBtn'); await layer('accountModal');
    await tap('#openDeleteAccountBtn');await layer('deleteAccountModal');
    assert(await evaluate("document.getElementById('accountModal').inert"),'Lower dialog remains interactive');
    await screenshot(`${theme}-nested-delete-cancel-only`);await close('deleteAccountModal');await layer('accountModal');await close('accountModal');
    await tap('#accountMenu summary');await tap('#feedbackBtn');await layer('feedbackModal');
    await picker('#feedbackType','select');
    const beforeKeyboard=await evaluate('visualViewport.height');
    await tap('#feedbackTitleInput');
    await until(()=>evaluate(`visualViewport.height<${beforeKeyboard-30}`),'soft keyboard');await layer('feedbackModal');
    await screenshot(`${theme}-feedback-keyboard`);
    await run('shell','input','keyevent','KEYCODE_BACK');
    await until(()=>evaluate(`visualViewport.height>=${beforeKeyboard-3}`),'keyboard dismissed');await close('feedbackModal');
    await nativeTab('财务','/finance');
    for(const [button,id] of [['#financeAddTransactionBtn','financeTransactionModal'],['#financeManageCategoriesBtn','financeCategoryModal'],['#financeManageBudgetsBtn','financeBudgetModal']]) {
      await tap(button); const geometry=await layer(id);await screenshot(`${theme}-${id}`);
      if(id==='financeTransactionModal'){await picker('#financeTransactionDirection','select');await picker('#financeTransactionTime','datetime');}
      if(id==='financeCategoryModal'){await picker('#financeCategoryAppliesTo','select');await picker('#financeCategoryColor','color');}
      if(id==='financeBudgetModal'){await picker('#financeBudgetMonth','month');await picker('#financeBudgetCategory','select');}
      await close(id,true);results.push({test:id,theme,passed:true,geometry});
    }
    assert(await evaluate("!document.getElementById('appShell').inert && !document.querySelector('.modal-layer:not(.hidden)')"),'Background did not unlock');
    results.push({test:'navigation-membership-account-nested-feedback-keyboard',theme,passed:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,errors},null,2));
} finally {
  if(socket)socket.close();if(port)await run('forward','--remove',`tcp:${port}`);
  await run('shell','rm','-f','/data/local/tmp/wyj-overlay-ui.xml','/data/local/tmp/wyj-overlay-screen.png');
  await writeFile(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));
}
