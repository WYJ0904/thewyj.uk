import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const mode=process.env.AERIS_P5_MODE||'baseline',baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8936',cdpUrl=process.env.WYJ_CDP_URL||'http://127.0.0.1:9250';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const probe=fs.readFileSync('qa/aeris/p5-probe.js','utf8'),results=[];
const rows=Array.from({length:1500},(_,i)=>({id:`p5-ledger:${i}`,direction:i%3?'expense':'income',amount_minor:i+1,currency:'CNY',occurred_at_ms:Date.UTC(2026,9,5,12)-i*60000,merchant:`P5 owned row ${i}`,status:'active',revision:1,source_kind:'manual',reconciliation_state:'confirmed'}));
const pending=Array.from({length:3},(_,i)=>({kind:'hint',id:`p5-hint-${i}`,event_id:`p5-event-${i}`,event_ids:[`p5-event-${i}`],state:'pending',source_package:'com.tencent.mm',app_label:'微信',amount_minor:null,direction:null,occurred_at_ms:rows[i].occurred_at_ms}));
const metrics=async p=>Object.fromEntries((await p.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
for(const width of [390,1366,1920])for(const authenticated of [false,true]) {
 const p=await openPage({cdpUrl,baseUrl,width,height:900,mobile:width===390});
 try {
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:probe});await p.send('Performance.enable');await p.send('DOM.enable');
  await p.intercept([
   {match:'/api/finance/bootstrap',respond:()=>({body:{ok:true,server_version:1,transaction_count:1500,categories:[],budgets:[]}})},
   {match:'/api/finance/transactions?',respond:()=>({body:{ok:true,transactions:rows,server_version:1}})},
   {match:'/api/finance/changes?',respond:()=>({body:{ok:true,server_version:1,changes:[],has_more:false}})},
   {match:'/api/notification/pending-summary',respond:()=>({body:{ok:true,records:pending,total_count:3,truncated:false}})},
  ]);
  if(authenticated){await p.navigate('/login');await p.waitFor('!document.getElementById("entryScreen")');await p.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');await p.waitFor("location.pathname==='/'&&document.querySelector('#publicHome').dataset.sessionMode==='authenticated'");}
  const at=Date.now();await p.navigate('/');await p.waitFor('!document.getElementById("entryScreen")');await delay(600);
  const home={coldReadyMs:Date.now()-at,probe:await p.evaluate('__p5Probe.read()'),cdp:await metrics(p),dom:await p.send('Memory.getDOMCounters')};
  const clickPoint=await p.evaluate(`(()=>{window.__p5First=null;document.querySelector('#themeToggleBtn').addEventListener('click',e=>{const start=e.timeStamp;requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__p5First={eventToFrameMs:performance.now()-start,trusted:e.isTrusted};}));},{once:true});const r=document.querySelector('#themeToggleBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await p.send('Input.dispatchMouseEvent',{type:'mousePressed',...clickPoint,button:'left',clickCount:1});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',...clickPoint,button:'left',clickCount:1});await p.waitFor('!!window.__p5First');home.firstInteraction=await p.evaluate('window.__p5First');
  const routes=[];
  if(authenticated) {
   for(const [route,ready] of [['/tools',"document.querySelectorAll('[data-tool-card]').length>20"],['/finance',"document.querySelector('#financeRecordedCount').textContent==='1500'&&document.querySelector('#financePendingCount').textContent==='3'"],['/transfer',"!document.querySelector('#transferQuotaText').textContent.includes('加载中')"],['/language',"!document.querySelector('#projectPicker').classList.contains('hidden')"],['/account',"!document.querySelector('#accountModal').classList.contains('hidden')"],['/',"document.querySelector('#publicHome').dataset.sessionMode==='authenticated'"]]) {
    const begin=await p.evaluate('__p5Probe.mark()');const before=await metrics(p);
    await p.evaluate(`(()=>{const route=${JSON.stringify(route)},link=document.querySelector('a[data-site-nav][href="'+route+'"]');if(link)link.click();else if(route==='/account')document.querySelector('#accountBtn').click();else throw Error('No real SPA entry for '+route);return true})()`);await p.waitFor(`location.pathname===${JSON.stringify(route)}&&(${ready})`);await delay(160);
    const after=await metrics(p);routes.push({route,readyMs:await p.evaluate(`performance.now()-${begin}`),probe:await p.evaluate(`__p5Probe.read(${begin})`),cdpDelta:Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(k=>[k,(after[k]||0)-(before[k]||0)])),dom:await p.send('Memory.getDOMCounters')});
   }
   for(let i=0;i<8;i++){await p.evaluate(`document.querySelector('a[data-site-nav][href="${i%2?'/':'/tools'}"]').click();true`);await delay(100);}
   await p.waitFor("location.pathname==='/'");
  }
  const final={probe:await p.evaluate('__p5Probe.read()'),cdp:await metrics(p),dom:await p.send('Memory.getDOMCounters')};
  assert.deepEqual(p.runtimeErrors,[]);const result={width,authenticated,home,routes,final};results.push(result);
  console.log(JSON.stringify({mode,width,authenticated,homeElements:home.probe.domElements,homeHidden:home.probe.hiddenElements,scriptCount:home.probe.resources.filter(r=>r.path.endsWith('.js')).length,homeTools:home.probe.generated.tools,intervals:home.probe.intervals.length,observers:home.probe.observers.length,routes:routes.map(r=>({route:r.route,ms:Math.round(r.readyMs),dom:r.probe.domElements,hidden:r.probe.hiddenElements,writes:r.probe.storageWrites.length,longTasks:r.probe.longTasks.length}))}));
 }finally{await p.close();}
}
const output=process.env.AERIS_P5_OUTPUT||`artifacts/aeris-p5/${mode}-browser.json`;fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({mode,source:mode==='baseline'?'4127b7a8165bbcab8f378f025897dd19400e116d':'working-tree',scope:'Windows Chrome, isolated local Pages API, synthetic large-ledger presentation data; not Android or WAN',results},null,2));
