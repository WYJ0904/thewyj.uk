import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {handleTask16Request} from '../../functions/_lib/task16-api.mjs';
import {handleTask21Request} from '../../functions/_lib/task21-api.mjs';
import {sessionStorageKey} from '../../functions/_lib/task12-crypto.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
import {openPage,CdpClient,delay} from '../../local-backend/browser_harness.mjs';

const out=path.resolve(process.env.FINANCE_P06_OUTPUT);assert(out.startsWith(path.join(root,'docs','migration-evidence','finance-p06')+path.sep));await fs.mkdir(out,{recursive:false});
const privateDir=path.join(out,'private');await fs.mkdir(privateDir);const rows=[],wire=[];let modelCalls=0,gate=null;
const diagnosticSaveFirst=process.env.FINANCE_P06_DIAGNOSTIC_SAVE_FIRST==='true';
async function test(id,run){try{rows.push({id,status:'PASS',actual:await run()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(rows,null,2));}
const f=await fixture();const owner=f.account.id;const session=crypto.randomUUID()+crypto.randomUUID();
const at=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
await f.db.prepare("INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'android')").bind(await sessionStorageKey(session),owner,at,expires).run();
await f.db.prepare("INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at) VALUES('synthetic-p06-web-membership',?1,'finance_monthly',?2,?3,0,'active','fixture','synthetic-p06','fixture','{}',?2,?2)").bind(owner,at,expires).run();
const env={WYJ_DB:f.db,WYJ_ENVIRONMENT:'development',CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_WRITES_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',TASK21_NOTIFICATION_READS_ENABLED:'true',TASK21_NOTIFICATION_WRITES_ENABLED:'true',WORKERS_AI_ENABLED:'true',FINANCE_AI_ENABLED:'false',FINANCE_AI_KILL_SWITCH:'false',FINANCE_AI_MODEL:'@cf/synthetic/browser',FINANCE_AI_MODEL_VERSION:'browser-1',AI:{run:async(model,input)=>{
 modelCalls++;if(gate)await gate;const data=JSON.parse(input.messages[1].content);
 return {model,response:{schema_version:2,amount_roles:data.candidates.map((c,i)=>({candidate_id:c.id,role:['actual_paid','original','discount'][i]})),selected_candidate_id:'m0',currency:data.currency,direction:data.direction,confidence_per_mille:950,refusal_reason:'none',merchant_normalized:'Restaurant',category:'food'},usage:{prompt_tokens:100,completion_tokens:80}};
}}};
const index=await fs.readFile(path.join(root,'index.html'),'utf8'),start=index.indexOf('<section class="finance-page'),end=index.slice(start).indexOf('\n      <section class="');assert(start>=0&&end>0);
const html=`<!doctype html><meta charset="utf-8"><title>Synthetic P06 browser acceptance</title><style>.hidden{display:none}body{font:16px sans-serif;max-width:1000px;margin:20px auto}small{display:block}button,input,select{padding:6px;margin:4px}</style><p>本地合成P06验收；独立账户/D1，模型为受控Mock，非真实支付。</p><div id="appShell">${index.slice(start,start+end).replace('finance-page hidden','finance-page')}</div>
<script type="module">
import {createFinanceCandidatesController} from '/js/finance/candidates.js';
window.owner={id:${JSON.stringify(owner)}};window.session=${JSON.stringify(session)};
async function call(route,body){const r=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'X-Session-Token':window.session,'X-Finance-Money-Version':'3',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.message||value.error||'unavailable'),{code:value.code});return value;}
window.controller=createFinanceCandidatesController({api:call,apiGet:p=>call(p),storage:localStorage,account:()=>window.owner,hasEntitlement:()=>true,isSuperAdmin:()=>false});await controller.show();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
 if(/^\/js\/(finance|core)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,url.pathname)));return;}
 if(url.pathname.startsWith('/api/')){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert(size<=262144);chunks.push(chunk);}const body=Buffer.concat(chunks);
  const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})});
  const result=await (url.pathname.startsWith('/api/notification/')?handleTask21Request:handleTask16Request)({env,request,data:{requestId:'synthetic-p06-web'}});
  assert(result);const text=await result.text();wire.push({path:req.url,method:req.method,status:result.status,body:body.length?JSON.parse(body):null,response:JSON.parse(text),synthetic_only:true});
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(text);return;
 }res.writeHead(404);res.end();
}catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
async function api(route,body,token=session){const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{'X-Session-Token':token,'X-Finance-Money-Version':'3',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const event='synthetic-p06-browser-event',reference='SYNTH-P06-BROWSER';
assert.equal((await api('/api/notification/hints',{device_id:'synthetic-p06-browser-device',hints:[{source_event_id:event,source_type:'notification',source_package:'com.tencent.mm',app_label:'SYNTHETIC',amount_minor:null,direction:'expense',currency:'CNY',amount_exponent:2,confidence:700,recognition_status:'PAYMENT_LIKELY',provider_reference:reference,payment_channel:'wechat',evidence:{reasons:['synthetic_p06_browser']}}]})).status,200);
const profile=path.join(out,'owned-chrome-profile');await fs.mkdir(profile);let browser,page;
const child=spawn(process.env.AERIS_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await delay(100)}}assert(port);
 const cdp='http://127.0.0.1:'+port;browser=new CdpClient((await(await fetch(cdp+'/json/version')).json()).webSocketDebuggerUrl);await browser.connect();
 page=await openPage({cdpUrl:cdp,baseUrl:url,width:1100,height:1200,mobile:false});await page.navigate('/');await page.waitFor('window.ready===true');await page.waitFor('document.querySelector("[data-finance-candidate]")');
 await test('default-feature-off-no-ai-ui-or-call',async()=>{assert.equal(await page.evaluate('document.querySelectorAll("[data-finance-ai-action]").length'),0);assert.equal(modelCalls,0);});
 env.FINANCE_AI_ENABLED='true';await page.evaluate('controller.reload({force:true})');
 await test('existing-evidence-disclosure-hosts-opt-in',async()=>{await page.waitFor('document.querySelector("[data-finance-ai-action=request]")');await page.evaluate('document.querySelector("details.finance-candidate-evidence").open=true;document.querySelector("[data-finance-ai-action=request]").click()');await page.waitFor('document.querySelector("[data-finance-ai-action=consent]")');assert.equal(modelCalls,0);});
 await test('consent-alone-does-not-invent-evidence',async()=>{await page.evaluate('document.querySelector("[data-finance-ai-action=consent]").click()');await page.waitFor('document.getElementById("financeCandidateMessage").textContent.includes("Android")');assert.equal(modelCalls,0);});
 const clock=Date.now();const packet={schema_version:1,source_uid:10390,completion_proven:true,direction:'expense',currency:'CNY',captured_at_ms:clock,expires_at_ms:clock+90000,provider_reference_hash:await sha256Hex(reference),merchant_tokens:['Restaurant'],candidates:[{id:'m0',amount_minor:9000,currency:'CNY',amount_exponent:2,phrases:['本次','扣除']},{id:'m1',amount_minor:10000,currency:'CNY',amount_exponent:2,phrases:['原价']},{id:'m2',amount_minor:1000,currency:'CNY',amount_exponent:2,phrases:['优惠']}]};
 assert.equal((await api('/api/finance/ai/evidence',{event_id:event,evidence:packet})).status,200);
 await test('real-http-d1-and-controller-show-validated-advice',async()=>{await page.evaluate('document.querySelector("[data-finance-ai-action=request]").click()');await page.waitFor('document.querySelector("[data-finance-ai-action=use]")');const text=await page.evaluate('document.querySelector(".finance-ai-assistance").textContent');assert.match(text,/90\.00/);assert.match(text,/餐饮/);assert.equal(modelCalls,1);});
 await test('adoption-only-fills-existing-editor-no-booking',async()=>{await page.evaluate('document.querySelector("[data-finance-ai-action=use]").click()');await page.waitFor('document.querySelector("[data-finance-candidate-editor]").elements.amount.value==="90.00"');assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,0);assert.equal(modelCalls,1);});
 await test('unsaved-human-edit-wins-over-ai',async()=>{await page.evaluate('document.querySelector("[data-finance-candidate-editor]").elements.amount.value="88.00";document.querySelector("[data-finance-ai-action=use]").click()');await page.waitFor('document.getElementById("financeCandidateMessage").textContent.includes("人工修改")');assert.equal(await page.evaluate('document.querySelector("[data-finance-candidate-editor]").elements.amount.value'),'88.00');});
 await test('existing-editor-save-is-reenabled-after-ai-without-a-reload',async()=>assert.equal(await page.evaluate('document.querySelector("[data-finance-candidate-save]").disabled'),false));
 if(!diagnosticSaveFirst)await test('withdrawal-remains-available-while-kill-switch-on',async()=>{env.FINANCE_AI_KILL_SWITCH='true';await page.evaluate('controller.reload({force:true})');await page.waitFor('document.querySelector("[data-finance-ai-action=disable]")',3000);const deadline=Date.now()+3000;await page.evaluate('document.querySelector("[data-finance-ai-action=disable]").click()');await page.waitFor('!document.querySelector("[data-finance-ai-action=disable]")',Math.max(1,deadline-Date.now()));await page.waitFor(`localStorage.getItem(${JSON.stringify('wyjFinanceAiConsentBlock:v1:'+owner)})===null`,Math.max(1,deadline-Date.now()),'server withdrawal acknowledgement within original 3s');const c=await f.db.prepare('SELECT enabled FROM finance_ai_consents WHERE user_id=?1').bind(owner).first();assert.equal(c.enabled,0);assert.equal(modelCalls,1);});
 else rows.push({id:'withdrawal-remains-available-while-kill-switch-on',status:'NOT_TESTED',reason:'Explicit diagnostic ordering subset; the original default still runs this assertion unchanged'});
 await fs.writeFile(path.join(out,'form-before-save.json'),JSON.stringify(await page.evaluate('Array.from(document.querySelector("[data-finance-candidate-editor]").elements).map(x=>({name:x.name,value:x.value,disabled:x.disabled,valid:x.validity?.valid,message:x.validationMessage,customError:x.validity?.customError}))'),null,2));
 await test('explicit-manual-save-keeps-original-event-and-human-amount',async()=>{await page.evaluate('document.querySelector("[data-finance-candidate-save]").click()');await page.waitFor('!document.querySelector("[data-finance-candidate]")');const tx=(await f.db.prepare('SELECT id,amount_minor,currency,direction FROM task16_finance_transactions WHERE user_id=?1').bind(owner).all()).results;assert.equal(tx.length,1);assert.equal(tx[0].amount_minor,8800);assert.equal(tx[0].currency,'CNY');const confirm=wire.find(w=>w.path==='/api/notification/hints/confirm');assert(confirm);await api(confirm.path,confirm.body);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions').first()).n,1);return tx;});
 await test('actual-auth-rejects-unrelated-token',async()=>assert.equal((await api('/api/finance/ai/config',undefined,'synthetic-invalid')).status,401));
 await test('no-unhandled-browser-exception',async()=>assert.deepEqual(page.runtimeErrors,[]));
 const screenshot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,'web.png'),Buffer.from(screenshot.data,'base64'));await fs.writeFile(path.join(out,'dom.txt'),await page.evaluate('document.body.innerText'));
}finally{
 if(page)await page.close().catch(()=>{});if(browser){await browser.send('Browser.close').catch(()=>{});browser.close();}child.kill();
 await new Promise(r=>server.close(r));await f.dispose();
 await fs.writeFile(path.join(out,'wire.ndjson'),wire.map(r=>JSON.stringify(r)).join('\n')+'\n');await fs.writeFile(path.join(out,'result.json'),JSON.stringify({rows,model_calls:modelCalls,model_provider:'MOCK; application HTTP/auth/D1/Chrome are actual',synthetic_only:true,phone_operations:false},null,2));
 console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length,mock_model_calls:modelCalls}));process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;
}
