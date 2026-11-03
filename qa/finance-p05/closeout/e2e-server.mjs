import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {Miniflare} from 'miniflare';
import {fixture,root} from '../../finance-p04/fixture.mjs';
import {handleTask21Request} from '../../../functions/_lib/task21-api.mjs';
import {handleTask16Request} from '../../../functions/_lib/task16-api.mjs';
import {sessionStorageKey} from '../../../functions/_lib/task12-crypto.mjs';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../../finance-p03/phase-a/d1-snapshot.mjs';

const out=path.resolve(process.env.FINANCE_E2E_OUTPUT);assert(out.startsWith(path.join(root,'docs','migration-evidence','finance-p04','non-device-closeout')));
const config=JSON.parse(await fs.readFile(path.join(out,'private','context.json'),'utf8'));
const f=await fixture();let mf=f.mf,db=f.db,requests=0,restarted=false,dropped=false,stopping=false;
const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(config.account_id,now).run();
await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'android')`).bind(await sessionStorageKey(config.session),config.account_id,now,expires).run();
await db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at) VALUES('synthetic-closeout-membership',?1,'finance_monthly',?2,?3,0,'active','fixture','synthetic-closeout','fixture','{}',?2,?2)`).bind(config.account_id,now,expires).run();
function environment(){return {WYJ_DB:db,WYJ_ENVIRONMENT:'development',CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_WRITES_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',TASK21_NOTIFICATION_READS_ENABLED:'true',TASK21_NOTIFICATION_WRITES_ENABLED:'true'};}
// Deterministic offline reference provider. Application auth/HTTP/D1 are real;
// no rate, identity assertion or finance receipt is synthesized here.
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,...args)=>String(url).startsWith('https://api.frankfurter.dev/')?Promise.reject(Error('synthetic offline reference provider')):originalFetch(url,...args);
const index=await fs.readFile(path.join(root,'index.html'),'utf8');
const start=index.indexOf('<section class="finance-page'),following=index.slice(start).indexOf('\n      <section class="');assert(start>=0&&following>0);
const finance=index.slice(start,start+following);
const modalStart=index.indexOf('<div class="modal-layer hidden" id="financeTransactionModal"'),modalEnd=index.indexOf('<section class="project-picker');assert(modalEnd>modalStart);
const html=`<!doctype html><meta charset="utf-8"><title>Synthetic finance E2E</title><style>.hidden{display:none}body{font:16px sans-serif;max-width:1100px;margin:20px auto}small{display:block}select,input{padding:6px;margin:5px}.finance-transaction-row{padding:8px;border-bottom:1px solid #ddd}</style>
<p>本地合成端到端；独立账户／D1。不是实际支付或 Production。</p><div id="appShell">${finance.replace('finance-page hidden','finance-page')}${index.slice(modalStart,modalEnd)}</div>
<script type="module">
import {createFinanceController} from '/js/finance/app.js';
import {createFinanceCandidatesController} from '/js/finance/candidates.js';
async function call(route,body,options={}){const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'X-Session-Token':${JSON.stringify(config.session)},'X-Finance-Money-Version':'3',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:options.controller?.signal});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.message||result.error||'synthetic unavailable'),{code:result.code});return result}
const settings={account:()=>({id:${JSON.stringify(config.account_id)}}),storage:localStorage,hasEntitlement:()=>true,isSuperAdmin:()=>false,apiGet:(p,o)=>call(p,undefined,o),api:call};
window.controller=createFinanceController({...settings,appVersion:'synthetic-non-device-closeout'});window.candidates=createFinanceCandidatesController(settings);
window.store=()=>JSON.parse(localStorage.getItem('wyjFinance:v1:'+${JSON.stringify(config.account_id)}));
await controller.show();await candidates.show();window.ready=true;
</script>`;
async function transactions(){return (await db.prepare('SELECT id,amount_minor,currency,amount_exponent,direction,status,revision FROM task16_finance_transactions WHERE user_id=?1 ORDER BY id').bind(config.account_id).all()).results;}
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/__test/')){
  assert.equal(req.headers['x-session-token'],config.session);
  if(url.pathname==='/__test/snapshot'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({transactions:await transactions(),requests,restarted,dropped}));return;}
  if(url.pathname==='/__test/restart'){
   assert(!restarted&&dropped);const snapshot=await dumpD1(db);await fs.writeFile(path.join(out,'d1-before-restart.json'),JSON.stringify(snapshot));await writeSqliteSnapshot(path.join(out,'d1-before-restart.sqlite'),snapshot);
   await mf.dispose();mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic restored D1")}}',compatibilityDate:'2026-08-06',d1Databases:['DB'],d1Persist:false});db=await mf.getD1Database('DB');await restoreD1(db,snapshot);restarted=true;res.end('{"restarted":true}');return;
  }
  if(url.pathname==='/__test/stop'){res.end('{}');void stop();return;}
  throw Error('Unknown owned control route');
 }
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(html);return;}
 if(/^\/js\/(finance|core)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,url.pathname)));return;}
 if(url.pathname.startsWith('/api/finance/')||url.pathname.startsWith('/api/notification/')){
  requests++;let size=0;const chunks=[];for await(const c of req){size+=c.length;assert(size<=262144);chunks.push(c)}const body=Buffer.concat(chunks);
  const result=await (url.pathname.startsWith('/api/notification/')?handleTask21Request:handleTask16Request)({env:environment(),data:{requestId:'synthetic-closeout'},request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})})});
  const text=await result.text();await fs.appendFile(path.join(out,'wire.ndjson'),JSON.stringify({path:req.url,method:req.method,status:result.status,body:body.length?JSON.parse(body):null,response:JSON.parse(text),synthetic_only:true})+'\n');
  if(req.method==='POST'&&url.pathname==='/api/notification/ingest'&&result.ok&&!dropped&&(await transactions()).length){dropped=true;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"synthetic_commit_succeeded_receipt_lost"}');return;}
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(text);return;
 }
 res.writeHead(404);res.end();
}catch(error){await fs.appendFile(path.join(out,'server-errors.ndjson'),JSON.stringify({error:error.stack})+'\n');res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'synthetic_server_error'}));}});
async function stop(){if(stopping)return;stopping=true;const txs=await transactions(),snapshot=await dumpD1(db);await fs.writeFile(path.join(out,'d1-final.json'),JSON.stringify(snapshot));await writeSqliteSnapshot(path.join(out,'d1-final.sqlite'),snapshot);await fs.writeFile(path.join(out,'server-final.json'),JSON.stringify({transactions:txs,requests,restarted,dropped,scope:'Local authenticated product API + Miniflare D1; no manually inserted finance transactions'},null,2));server.close();await mf.dispose();}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await fs.writeFile(path.join(out,'port.json'),JSON.stringify({pid:process.pid,port:server.address().port,synthetic_only:true}));
setTimeout(()=>{void stop()},900000).unref();
