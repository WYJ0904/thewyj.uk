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
const suite=process.env.TASK20_OVERLAY_SUITE || 'core';
assert(['core','tools'].includes(suite));
assert(serial && userId && out && Number.isFinite(top));
assert(/^https:\/\/[a-z0-9.-]+\.pages\.dev$/.test(base || ''));
const run = async (...args) => (await exec(adb, ['-s', serial, ...args], { timeout: 25000 })).stdout.trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], errors = [];
let completed = false, failure = null;
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
async function tap(selector, holdMs=0) {
  const size=await run('shell','wm','size');
  const physicalWidth=Number(/(?:Override|Physical) size: (\d+)x\d+/.exec(size)?.[1]);
  assert(physicalWidth>0);
  let p, previous, stable=0;
  await until(async()=>{
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
    p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y),v=visualViewport;
    return {x:x-v.offsetLeft,y:y-v.offsetTop,width:innerWidth,height:innerHeight,
      scrollX,scrollY,docHeight:document.documentElement.scrollHeight,
      viewportHeight:v.height,viewportTop:v.offsetTop,
      visible:r.width>0&&r.height>0&&y>=v.offsetTop&&y<v.offsetTop+v.height,
      hit:e===hit||e.contains(hit),disabled:e.disabled};})()`);
    const position=p&&JSON.stringify([p.x,p.y,p.width,p.height,p.scrollX,p.scrollY,p.docHeight,p.viewportHeight,p.viewportTop]);
    stable=position===previous?stable+1:0;previous=position;
    return stable>=4&&p?.visible&&p.hit&&!p.disabled;
  },`tap target ${selector}`);
  const scale=physicalWidth/p.width;
  await evaluate(`(()=>{window.__task20TouchHit=false;
    document.addEventListener('pointerdown',event=>{
      const target=document.querySelector(${JSON.stringify(selector)});
      window.__task20TouchHit=Boolean(target&&(target===event.target||target.contains(event.target)));
      window.__task20TouchTarget={id:event.target.id,tag:event.target.tagName};
    },{capture:true,once:true});})()`);
  const x=String(Math.round(p.x*scale)),y=String(Math.round(top+p.y*scale));
  if(holdMs)await run('shell','input','swipe',x,y,x,y,String(holdMs));
  else await run('shell','input','tap',x,y);
  assert(await evaluate('window.__task20TouchHit'),`Physical touch missed ${selector}: ${JSON.stringify({
    target:await evaluate('window.__task20TouchTarget'),physical:{x,y},scale,measured:p})}`);
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
  results.push({test:`layer:${id}`,theme,passed:true,geometry:m});
  return m;
}
async function close(id) {
  await tap(`#${id} [data-close-modal="${id}"], #${id} [data-finance-close="${id}"]`);
  await until(()=>evaluate(`document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`),id+' closed');
}
async function enterText(selector, text) {
  await tap(selector);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await command('Input.insertText',{text});
  await run('shell','input','keyevent','KEYCODE_BACK');
}
async function screenshot(name) {
  const device='/data/local/tmp/wyj-overlay-screen.png';
  await run('shell','screencap','-p',device); await run('pull',device,path.join(out,`${name}.png`));
}
async function nativePopupWindowCount() {
  const windows=await run('shell','dumpsys','window','windows');
  return (windows.match(/^\s*Window #[0-9]+ Window\{[^\n]+ PopupWindow[^\n]*$/gm)||[]).length;
}
async function appIsResumed() {
  const activities=await run('shell','dumpsys','activity','activities');
  return /(?:top)?ResumedActivity[^\n]+uk\.thewyj\.app\.debug\//.test(activities);
}
async function picker(selector, kind) {
  await tap(selector);
  const xmlPath='/data/local/tmp/wyj-overlay-ui.xml';
  await until(async()=>{
    await run('shell','uiautomator','dump',xmlPath);
    const xml=await run('shell','cat',xmlPath);
    return /android:id\/(?:alertTitle|select_dialog_listview|button1|date_picker_header_year|month_view|custom)/.test(xml)
      || /class="android.widget.(?:ListView|DatePicker|NumberPicker)"/.test(xml);
  },`native ${kind} ${selector}`,8000);
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
  const financeAccess=await evaluate("(async()=>{const r=await fetch('/api/finance/bootstrap');const d=await r.json();return {status:r.status,code:d.code};})()");
  assert.equal(financeAccess.status,200,`Preview fixture cannot exercise finance dialogs: HTTP ${financeAccess.status} ${financeAccess.code || ''}`);
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
    if(suite==='tools') {
      for(const [tool,fields] of [
        ['random-date',[['#randomStartDate','date'],['#randomEndDate','date']]],
        ['gradient-generator',[['#imageColor','color'],['#imageGradientEnd','color']]],
        ['letter-case',[['#textToolOption','select']]],
        ['image-format',[['#imageFormat','select']]],
        ['temporary-qr',[['#qrKind','select']]],
      ]) {
        await nativeTab('工具','/tools');
        await tap(`[data-open-tool="${tool}"]`);
        await until(()=>evaluate(`location.pathname===${JSON.stringify('/tools/'+tool)}`),tool);
        for(const [field,kind] of fields)await picker(field,kind);
        if(tool==='image-format') {
          // Only verify launch/cancel. Never enumerate, select or screenshot personal files.
          for(let attempt=0;attempt<2;attempt++) {
            await tap('#imageToolInput');
            const xmlPath='/data/local/tmp/wyj-overlay-ui.xml';
            const chooser=/package="(?:com\.google\.android\.documentsui|com\.android\.documentsui|com\.google\.android\.photopicker|com\.android\.providers\.media[^\"]*|com\.google\.android\.providers\.media[^\"]*|com\.sec\.android\.app\.myfiles)"|resource-id="android:id\/resolver_list"/;
            await until(async()=>{
              await run('shell','uiautomator','dump',xmlPath);
              return chooser.test(await run('shell','cat',xmlPath));
            },`native file chooser ${attempt+1}`,8000);
            await run('shell','input','keyevent','KEYCODE_BACK');
            await until(async()=>await appIsResumed() && await evaluate("document.hasFocus() && document.getElementById('imageToolInput').files.length===0"),`file chooser ${attempt+1} cancel`);
            await delay(250);
          }
          results.push({test:'file-chooser-cancel-reopen',theme,passed:true});
        }
        if(tool==='letter-case') {
          await enterText('#textToolInput','Task20 popup fixture');
          await evaluate("document.activeElement?.blur()");
          await delay(350);
          const popupBefore=await nativePopupWindowCount();
          await evaluate(`(()=>{window.__task20ContextMenu=false;
            document.getElementById('textToolInput').addEventListener('contextmenu',()=>{window.__task20ContextMenu=true;},{once:true});})()`);
          await tap('#textToolInput',900);
          const xmlPath='/data/local/tmp/wyj-overlay-ui.xml';
          await run('shell','uiautomator','dump',xmlPath);
          const xml=await run('shell','cat',xmlPath);
          const hierarchyEvidence=/android:id\/(?:floating_toolbar|floating_toolbar_menu_item_text|floating_toolbar_menu_item_image)|text="(?:复制|全选|选择全部|剪切|Copy|Select all|Cut)"/.test(xml);
          const popupAfter=await nativePopupWindowCount();
          const textState=await evaluate(`(()=>{const e=document.getElementById('textToolInput');return {
            focused:document.activeElement===e,value:e.value,contextMenu:window.__task20ContextMenu,
            selectionStart:e.selectionStart,selectionEnd:e.selectionEnd};})()`);
          await screenshot(`${theme}-text-context-menu`);
          assert(textState.focused && textState.value==='Task20 popup fixture','Physical long press lost the text field state');
          assert(hierarchyEvidence || (textState.contextMenu && popupAfter>0),'Native text-selection menu missing');
          await run('shell','input','keyevent','KEYCODE_BACK');
          results.push({test:'text-context-menu',theme,passed:true,
            evidence:hierarchyEvidence?'accessibility-hierarchy':'contextmenu-and-android-popup-window',
            popupBefore,popupAfter,selectionStart:textState.selectionStart,selectionEnd:textState.selectionEnd});
        }
        assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Tool horizontal overflow');
      }
      await nativeTab('主页','/select');await tap('#siteNavToggle');
      await tap('#siteNavPanel a[href="/trial"]');
      await until(()=>evaluate("location.pathname==='/trial'"),'trial route');
      await picker('#trialQuizLanguage','select');
      await tap('[data-trial-tool="image-format"]');await picker('#trialImageFormat','select');
      results.push({test:'trial-navigation-native-selects',theme,passed:true});
      continue;
    }
    await tap('#siteNavToggle');
    await until(()=>evaluate("document.getElementById('siteNavToggle').getAttribute('aria-expanded')==='true'"),'nav opens');
    await until(()=>evaluate("document.getElementById('siteNavPanel').getBoundingClientRect().height>100 && !document.getElementById('siteNavPanel').getAnimations().some(a=>a.playState==='running')"),'nav fully expanded');
    await screenshot(`${theme}-navigation`);
    await run('shell','input','keyevent','KEYCODE_BACK');
    await until(()=>evaluate("document.getElementById('siteNavToggle').getAttribute('aria-expanded')==='false'"),'Android Back closes navigation');
    await tap('#siteNavToggle');
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
      await close(id);results.push({test:id,theme,passed:true,geometry});
    }
    assert(await evaluate("!document.getElementById('appShell').inert && !document.querySelector('.modal-layer:not(.hidden)')"),'Background did not unlock');
    results.push({test:'navigation-membership-account-nested-feedback-keyboard',theme,passed:true});
    await nativeTab('学习','/language');
    await tap('[data-project="english"]');
    await until(()=>evaluate("location.pathname==='/language/english'"),'English workspace');
    await tap('[data-view="setupView"]');
    await picker('#gradingModeSelect','select');await picker('#practiceModeSelect','select');
    await enterText('#wordInput','hello\nworld');
    await tap('#startBtn');
    await until(()=>evaluate("document.getElementById('progressLabel').textContent==='1/2' && !document.getElementById('skipBtn').disabled"),'first question');
    await tap('#skipBtn');
    await until(()=>evaluate("document.getElementById('progressLabel').textContent==='2/2' && !document.getElementById('skipBtn').disabled"),'second question');
    await tap('#skipBtn');await layer('roundSummaryModal');await screenshot(`${theme}-round-summary`);
    await tap('#roundWrongBtn');
    await tap('#clearWrongBtn');await layer('confirmModal');await tap('#cancelConfirmBtn');
    await until(()=>evaluate("document.getElementById('confirmModal').classList.contains('hidden')"),'confirmation cancelled');
    await tap('#wrongList .wrong-rejudge-button');
    await enterText('#wrongList .wrong-rejudge-form:not(.hidden) input','not-the-meaning');
    await tap('#wrongList .wrong-rejudge-form:not(.hidden) .wrong-rejudge-submit');
    await layer('rejudgeResultModal');await screenshot(`${theme}-rejudge-result`);
    await run('shell','input','keyevent','KEYCODE_BACK');
    assert(await evaluate("!document.getElementById('rejudgeResultModal').classList.contains('hidden')"),'Back bypassed confirm-only result');
    await tap('#rejudgeResultConfirmBtn');
    await until(()=>evaluate("document.getElementById('rejudgeResultModal').classList.contains('hidden')"),'rejudge acknowledged');
    results.push({test:'learning-summary-confirm-rejudge-native-back',theme,passed:true});
  }
  assert.deepEqual(errors,[]);completed=true;console.log(JSON.stringify({passed:true,results,errors},null,2));
} catch(error) {
  failure=String(error.message);throw error;
} finally {
  if(socket)socket.close();if(port)await run('forward','--remove',`tcp:${port}`);
  await run('shell','rm','-f','/data/local/tmp/wyj-overlay-ui.xml','/data/local/tmp/wyj-overlay-screen.png');
  await writeFile(path.join(out,'results.json'),JSON.stringify({suite,passed:completed,failure,results,errors},null,2));
}
