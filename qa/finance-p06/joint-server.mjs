import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {Miniflare} from 'miniflare';
import {fixture,root} from '../finance-p04/fixture.mjs';
import {handleTask16Request} from '../../functions/_lib/task16-api.mjs';
import {handleTask21Request} from '../../functions/_lib/task21-api.mjs';
import {sessionStorageKey} from '../../functions/_lib/task12-crypto.mjs';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../finance-p03/phase-a/d1-snapshot.mjs';
const out=path.resolve(process.env.FINANCE_P06_JOINT);assert(out.startsWith(path.join(root,'docs/migration-evidence/finance-p06')+path.sep));
const config=JSON.parse(await fs.readFile(path.join(out,'private/context.json'),'utf8'));const f=await fixture();assert.equal(config.account_id,f.account.id);let mf=f.mf,db=f.db,calls=0,dropped=false,restarted=false,stopping=false;
const at=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
await db.prepare("INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'android')").bind(await sessionStorageKey(config.session),f.account.id,at,expires).run();
await db.prepare("INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at) VALUES('synthetic-p06-joint',?1,'finance_monthly',?2,?3,0,'active','fixture','synthetic','fixture','{}',?2,?2)").bind(f.account.id,at,expires).run();
const env={WYJ_DB:db,WYJ_ENVIRONMENT:'development',CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_WRITES_ENABLED:'true',TASK21_NOTIFICATION_READS_ENABLED:'true',TASK21_NOTIFICATION_WRITES_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',FINANCE_AI_ENABLED:'true',FINANCE_AI_KILL_SWITCH:'false',WORKERS_AI_ENABLED:'true',FINANCE_AI_MODEL:'@cf/synthetic/joint',FINANCE_AI_MODEL_VERSION:'joint-1',AI:{run:async(model,input)=>{
 calls++;assert(calls<=1,'Joint mock classifier hard limit');const p=JSON.parse(input.messages[1].content);assert(!/SYNTH-P06-JOINT|交易号|raw_text|session/.test(input.messages[1].content));
 return {model,response:{schema_version:2,amount_roles:p.candidates.map((c,i)=>({candidate_id:c.id,role:['actual_paid','original','discount'][i]})),selected_candidate_id:'m0',currency:p.currency,direction:p.direction,confidence_per_mille:950,refusal_reason:'none',merchant_normalized:null,category:'food'},usage:{prompt_tokens:100,completion_tokens:80}};
}}};
const index=await fs.readFile(path.join(root,'index.html'),'utf8'),start=index.indexOf('<section class="finance-page'),end=index.slice(start).indexOf('\n      <section class="');assert(start>=0&&end>0);
const html=`<!doctype html><meta charset="utf-8"><title>P06 joint isolated QA</title><style>.hidden{display:none}body{font:16px sans-serif;max-width:1000px;margin:20px auto}small{display:block}button,input,select{padding:6px;margin:4px}</style><p>Android真实SDK读取合成页面 → 本地Room/Outbox → 真实产品HTTP/D1 → 受控Mock分类 → 现有Web人工确认；非真实交易。</p><div id="appShell">${index.slice(start,start+end).replace('finance-page hidden','finance-page')}</div><script type="module">
import {createFinanceCandidatesController} from '/js/finance/candidates.js';window.owner={id:${JSON.stringify(f.account.id)}};
window.call=async(route,body)=>{const r=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'X-Session-Token':${JSON.stringify(config.session)},'X-Finance-Money-Version':'3',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.message||v.error||'unavailable'),{code:v.code});return v};
window.controller=createFinanceCandidatesController({api:window.call,apiGet:p=>window.call(p),storage:localStorage,account:()=>owner,hasEntitlement:()=>true,isSuperAdmin:()=>false});await controller.show();window.ready=true;</script>`;
async function transactions(){return (await db.prepare('SELECT id,amount_minor,currency,amount_exponent,direction,status FROM task16_finance_transactions WHERE user_id=?1 ORDER BY id').bind(f.account.id).all()).results;}
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/__qa/')){
  assert.equal(req.headers['x-session-token'],config.session);
  if(url.pathname==='/__qa/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({transactions:await transactions(),mock_model_calls:calls,dropped,restarted}));return;}
  if(url.pathname==='/__qa/restart'){assert(!restarted&&dropped);const snapshot=await dumpD1(db);await fs.writeFile(path.join(out,'d1-before-restart.json'),JSON.stringify(snapshot));await mf.dispose();mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("isolated P06 restored D1")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});db=await mf.getD1Database('DB');await restoreD1(db,snapshot);env.WYJ_DB=db;restarted=true;res.end('{"restarted":true}');return;}
  if(url.pathname==='/__qa/stop'){res.end('{}');void stop();return;}
  throw Error('Unknown owned control route');
 }
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(html);return;}
 if(/^\/js\/(finance|core)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,url.pathname)));return;}
 if(url.pathname.startsWith('/api/')){
  const chunks=[];let size=0;for await(const c of req){size+=c.length;assert(size<=262144);chunks.push(c);}const body=Buffer.concat(chunks);
  const result=await (url.pathname.startsWith('/api/notification/')?handleTask21Request:handleTask16Request)({env,request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}),data:{requestId:'synthetic-p06-joint'}});assert(result);const text=await result.text();
  await fs.appendFile(path.join(out,'wire.ndjson'),JSON.stringify({path:req.url,method:req.method,status:result.status,body:body.length?JSON.parse(body):null,response:JSON.parse(text),synthetic_only:true})+'\n');
  if(req.method==='POST'&&url.pathname==='/api/notification/hints/confirm'&&result.ok&&!dropped){assert.equal((await transactions()).length,1);dropped=true;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"synthetic_commit_succeeded_receipt_lost"}');return;}
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(text);return;
 }
 res.writeHead(404);res.end();
}catch(e){await fs.appendFile(path.join(out,'server-errors.ndjson'),JSON.stringify({error:e.stack})+'\n');res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"isolated_joint_qa_error"}');}});
async function stop(){if(stopping)return;stopping=true;const snapshot=await dumpD1(db);await fs.writeFile(path.join(out,'d1-final.json'),JSON.stringify(snapshot));await writeSqliteSnapshot(path.join(out,'d1-final.sqlite'),snapshot);await fs.writeFile(path.join(out,'server-final.json'),JSON.stringify({transactions:await transactions(),mock_model_calls:calls,dropped,restarted,production_or_preview_mutations:false},null,2));server.close();await mf.dispose();}
await new Promise(r=>server.listen(0,'127.0.0.1',r));await fs.writeFile(path.join(out,'port.json'),JSON.stringify({pid:process.pid,port:server.address().port}));setTimeout(()=>{void stop()},900000).unref();
