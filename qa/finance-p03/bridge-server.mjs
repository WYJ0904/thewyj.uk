import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {Miniflare} from 'miniflare';
import {ingestNotificationEvents} from '../../functions/_lib/task21-service.mjs';
const root=path.resolve(import.meta.dirname,'../..');const output=process.env.FINANCE_P03_OUTPUT;
assert.ok(output);await fs.access(path.join(output,'seed.json'));
try{await fs.access(path.join(output,'port.json'));throw Error('Preserve existing bridge evidence')}catch(e){if(e.code!=='ENOENT')throw e;}
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic bridge")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
const db=await mf.getD1Database('DB');
for(const name of (await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())
  await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
const account={id:'synthetic-p03-bridge-owner',entitlements:['finance_access']};const now=new Date().toISOString();
await db.prepare(`INSERT INTO task12_users (id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
VALUES (?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
let dropped=false;let stopping=false;let requests=0;
const server=createServer(async(req,res)=>{
  try {
    if(req.method==='POST' && req.url==='/_p03_shutdown') {res.end('{}');void stop();return;}
    assert.equal(req.method,'POST');assert.equal(req.url,'/api/notification/ingest');
    const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;assert.ok(bytes<=262144);chunks.push(c)}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests++;
    const reply=await ingestNotificationEvents(db,account,body);
    await fs.appendFile(path.join(output,'wire.ndjson'),JSON.stringify({request:body,response:reply,synthetic:true})+'\n');
    if(!dropped){dropped=true;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"synthetic_ack_lost_after_commit"}');return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(reply));
  } catch(e) {await fs.appendFile(path.join(output,'errors.ndjson'),JSON.stringify({error:e.stack})+'\n');res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'synthetic_bridge_error'}));}
});
server.requestTimeout=10000;
async function stop() {
  if(stopping)return;stopping=true;
  const txs=(await db.prepare('SELECT id,amount_minor,currency,direction,status FROM task16_finance_transactions WHERE user_id=?1').bind(account.id).all()).results;
  const pending=Number((await db.prepare("SELECT COUNT(*) AS n FROM task21_notification_candidates WHERE user_id=?1 AND status='pending'").bind(account.id).first()).n);
  const status=txs.length===3 && txs.filter(t=>t.currency==='CNY'&&t.amount_minor===64800).length===2 && txs.filter(t=>t.currency==='USD'&&t.amount_minor===17000).length===1 && pending===2 && requests>=9?'PASS':'FAIL';
  await fs.writeFile(path.join(output,'server-final.json'),JSON.stringify({status,requests,txs,pending_candidates:pending,synthetic_only:true},null,2));
  server.close();await mf.dispose();if(status==='FAIL')process.exitCode=1;
}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await fs.writeFile(path.join(output,'port.json'),JSON.stringify({port:server.address().port,pid:process.pid,synthetic_only:true}));
console.log('P03 loopback synthetic bridge ready');
setTimeout(()=>{void stop()},360000).unref();
