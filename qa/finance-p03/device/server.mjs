// Local HTTPS device backend. Actual application handlers/authentication and D1;
// one dedicated synthetic account, no Production bindings or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {Miniflare} from 'miniflare';
import {hashSecret} from '../../../functions/_lib/task12-crypto.mjs';
import {handleTask20Request} from '../../../functions/_lib/task20-api.mjs';
import {handleTask12Request} from '../../../functions/_lib/task12-api.mjs';
import {handleTask13Request} from '../../../functions/_lib/task13-api.mjs';
import {handleTask16Request} from '../../../functions/_lib/task16-api.mjs';
import {handleTask21Request} from '../../../functions/_lib/task21-api.mjs';
import {handleTask25Request} from '../../../functions/_lib/task25-api.mjs';
import {cloudMiddleware,statusRouteResponse} from '../../../functions/_lib/cloudflare-foundation.mjs';
import {onRequest as applicationApiRouter} from '../../../functions/api/[[path]].js';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../phase-a/d1-snapshot.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),out=path.join(root,'docs/migration-evidence/finance-p03/device');
const generation=Number(process.env.P03_DEVICE_BACKEND_RUN||6);assert.ok(Number.isInteger(generation)&&generation>=6&&generation<=20);
const runtime=path.join(out,'server-runtime'+generation);await fs.mkdir(runtime,{recursive:false});
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local synthetic device QA")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],resourcePersistencePath:path.join(runtime,'persist')});
const db=await mf.getD1Database('DB');const userId='synthetic-p03-device-owner',username='synthetic-p03-device';
const privateSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const password=privateSecret(),pepper=privateSecret(),sessionSecret=privateSecret();
const env={WYJ_DB:db,WYJ_ENVIRONMENT:'local',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK20_ANDROID_APP_ENABLED:'true',TASK16_CLOUD_READS_ENABLED:'true',TASK16_CLOUD_WRITES_ENABLED:'true',TASK21_NOTIFICATION_READS_ENABLED:'true',TASK21_NOTIFICATION_WRITES_ENABLED:'true',TASK25_FEATURE_FLAGS_ENABLED:'true',WYJ_TASK12_PASSWORD_PEPPER:pepper,WYJ_TASK20_DEVICE_SESSION_SECRET:sessionSecret,ANDROID_LATEST_VERSION_CODE:'50',ANDROID_LATEST_VERSION_NAME:'1.3.37',ANDROID_MINIMUM_VERSION_CODE:'50',D1_RATE_LIMIT_ENABLED:'false'};
env.CLOUD_FOUNDATION_ENABLED='true';env.TASK15_CLOUD_ONLY_ENABLED='true';
const restoreFile=path.join(out,'private','server'+(generation-1)+'-closed/snapshot.json');
let restored=false;try{const snapshot=JSON.parse(await fs.readFile(restoreFile,'utf8'));await restoreD1(db,snapshot);restored=true}catch(e){if(e.code!=='ENOENT')throw e}
if(!restored){
 for(const name of(await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
 const now=new Date().toISOString();await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?,?,?,?,'pbkdf2_sha256',310000,'super_admin',?,?,?,?)`).bind(userId,username,username,await hashSecret(password,pepper),now,now,now,now).run();
}else{
 // Only this one synthetic account. Rotate test credentials after the closed
 // D1 restore; preserve every financial row/receipt/ID. No real account exists.
 await db.prepare('UPDATE task12_users SET password_hash=? WHERE id=?').bind(await hashSecret(password,pepper),userId).run();
}
assert.equal((await db.prepare('SELECT COUNT(*) n FROM task12_users').first()).n,1);
const staging=await fs.readFile(path.join(root,'scripts/stage_pages_deploy.mjs'),'utf8');
const roots=[...staging.slice(staging.indexOf('const ROOT_FILES'),staging.indexOf('const ROOT_DIRECTORIES')).matchAll(/"([^"]+)"/g)].map(r=>r[1]);
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const allowed=new Set(tracked.filter(n=>roots.includes(n)||/^(js|assets|vendor)\//.test(n)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
let blocked=false,loseNextAck=false,committedLostAcks=0,requests=0,stopping=false;
async function route(request){
 const url=new URL(request.url);
 if(url.pathname==='/__qa/bootstrap')return json({synthetic_only:true,username,secret:password,account_id:userId});
 if(url.pathname==='/__qa/state'){
  const txs=(await db.prepare('SELECT id,direction,amount_minor,currency,status,revision,system_superseded_by FROM task16_finance_transactions WHERE user_id=? ORDER BY id').bind(userId).all()).results;
  return json({synthetic_only:true,requests,blocked,committed_lost_acks:committedLostAcks,transactions:txs,task21_db:6,task16_db:3});
 }
 if(url.pathname==='/__qa/network'&&request.method==='POST'){const control=await request.json();blocked=control.blocked===true;if(control.commit_then_503===true)loseNextAck=true;return json({blocked,commit_then_503:loseNextAck})}
 if(url.pathname==='/__qa/shutdown'){void stop();return json({stopping:true})}
 if(url.pathname.startsWith('/api/')){
  if(blocked&&request.method!=='GET')return json({ok:false,code:'synthetic_network_interruption'},503);
  const context={request,env,data:{requestId:crypto.randomUUID()},waitUntil(p){void p.catch(()=>{})}};
  // The actual Pages catch-all preserves the product dispatch order and health
  // dependency. No synthetic /health response or client monkey patch.
  context.next=async()=>url.pathname==='/api/status'?statusRouteResponse(context):applicationApiRouter(context);
  const response=await cloudMiddleware(context);
  if(loseNextAck&&request.method==='POST'&&url.pathname==='/api/notification/ingest'&&response.ok){
   loseNextAck=false;committedLostAcks++;return json({ok:false,code:'synthetic_committed_lost_ack'},503);
  }
  return response;
 }
 let name=decodeURIComponent(url.pathname).replace(/^\//,'');
 if(['','select','finance','account','login','register','notifications','recharge'].includes(name))name='index.html';
 if(!allowed.has(name))return new Response('QA allowlist',{status:404});
 return new Response(await fs.readFile(path.join(root,name)),{headers:{'content-type':types[path.extname(name)]||'application/octet-stream','cache-control':'no-store'}});
}
const server=createServer({key:await fs.readFile(path.join(out,'private/localhost.key')),cert:await fs.readFile(path.join(out,'generated-res/raw/p03_device_ca.pem'))},async(req,res)=>{
 const pathname=new URL(req.url,'https://localhost:19443').pathname;requests++;
 try{
  assert.ok(['localhost:19443','127.0.0.1:19443'].includes(req.headers.host));const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<=262144);chunks.push(chunk)}
  const request=new Request('https://localhost:19443'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const response=await route(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  // Paths/statuses only: never log account credentials, cookies, headers or raw payloads.
  await fs.appendFile(path.join(runtime,'requests.ndjson'),JSON.stringify({method:req.method,path:pathname,status:response.status,synthetic_only:true})+'\n');
 }catch(e){await fs.appendFile(path.join(runtime,'errors.ndjson'),JSON.stringify({path:pathname,error_type:e.name,code:e.code||'qa_internal_error'})+'\n');res.writeHead(500);res.end('{"code":"qa_internal_error"}')}
});
async function stop(){if(stopping)return;stopping=true;server.close();const snapshot=await dumpD1(db);const privateOut=path.join(out,'private','server'+generation+'-closed');await fs.mkdir(privateOut,{recursive:false});await fs.writeFile(path.join(privateOut,'snapshot.json'),JSON.stringify(snapshot));await writeSqliteSnapshot(path.join(privateOut,'export.sqlite'),snapshot);await mf.dispose();await fs.writeFile(path.join(runtime,'stopped.json'),JSON.stringify({stopped:true,requests,synthetic_only:true,private_auth_export_excluded:true}));}
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(19443,'127.0.0.1',resolve)});
await fs.writeFile(path.join(out,'server'+generation+'-ready.json'),JSON.stringify({pid:process.pid,port:19443,origin:'https://localhost:19443',synthetic_only:true,account_id:userId,private_values_logged:false,restored_closed_d1:restored,cloud_foundation:true}));
console.log('READY local synthetic device backend 19443');
