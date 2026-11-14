import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {ingestNotificationEvents} from '../../../functions/_lib/task21-service.mjs';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../phase-a/d1-snapshot.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);
const seed=JSON.parse(await fs.readFile(path.join(out,'seed.json'),'utf8'));assert.ok(seed.command_digest);
try{await fs.access(path.join(out,'port.json'));throw Error('Preserve bridge')}catch(e){if(e.code!=='ENOENT')throw e}
const make=()=>new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic P03-A bridge")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
let mf=make(),db=await mf.getD1Database('DB'),dropped=false,restarted=false,stopping=false,requests=0;
for(const n of(await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',n),'utf8')).replace(/\r?\n/g,' '));
const account={id:'synthetic-p03-bridge-owner',entitlements:['finance_access']},now=new Date().toISOString();await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const expected=seed.queue.map(q=>q.body.operations[0]);
const authority={verifyAuthority:async({command,commandDigest,sourceDigests,sources})=>{
 assert.equal(commandDigest,seed.command_digest);assert.deepEqual(command,seed.command);
 for(const source of sources){const original=expected.find(op=>op.type==='event.ingest'&&op.payload.event_id===source.event_id)?.payload;assert.ok(original);for(const [key,value]of Object.entries(original))assert.deepEqual(source[key],value,key)}
 return {same_operation_source_digests:sourceDigests,canonical_transaction_id:command.payload.canonical_transaction_id,transaction_revisions:command.payload.expected_transaction_revisions,command_digest:commandDigest,source_digests:sourceDigests,completed_source_digests:{[command.payload.evidence_event_id]:sourceDigests[command.payload.evidence_event_id]},completed:true,semantics:'absolute-operation-revision-v1',namespace:'bank_card:cmb',provider_account_id:'synthetic-a-bridge-bank-account',account_id:account.id};
}};
const server=createServer(async(req,res)=>{try{
 if(req.method==='POST'&&req.url==='/_p03_shutdown'){res.end('{}');void stop();return}
 if(req.method==='POST'&&req.url==='/_p03a_restart') {
  assert.ok(dropped&&!restarted);const snapshot=await dumpD1(db);await fs.writeFile(path.join(out,'d1-logical-snapshot.json'),JSON.stringify(snapshot));await writeSqliteSnapshot(path.join(out,'d1-export.sqlite'),snapshot);
  await mf.dispose();mf=make();db=await mf.getD1Database('DB');await restoreD1(db,snapshot);restarted=true;res.end(JSON.stringify({restarted:true,scope:'new D1 runtime from a closed logical snapshot, not native D1 binary backup'}));return;
 }
 assert.equal(req.method,'POST');assert.equal(req.url,'/api/notification/ingest');let size=0;const chunks=[];for await(const c of req){size+=c.length;assert.ok(size<=262144);chunks.push(c)}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests++;
 const op=body.operations[0];assert.ok(expected.some(e=>hash(e)===hash(op)),'only seeded synthetic operations');
 const reply=await ingestNotificationEvents(db,account,body,authority);
 await fs.appendFile(path.join(out,'wire.ndjson'),JSON.stringify({request:body,response:reply,synthetic_only:true})+'\n');
 if(op.type==='payment.reconcile'&&!dropped){assert.equal(reply.operation_results[0].reconciliation_status,'applied');dropped=true;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"synthetic_correction_committed_ack_lost"}');return}
 res.setHeader('content-type','application/json');res.end(JSON.stringify(reply));
 }catch(e){await fs.appendFile(path.join(out,'errors.ndjson'),JSON.stringify({error:e.stack})+'\n');res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'synthetic_bridge_error'}))}});
server.requestTimeout=10000;
async function stop(){if(stopping)return;stopping=true;const txs=(await db.prepare('SELECT id,amount_minor,currency,revision,status,system_superseded_by FROM task16_finance_transactions WHERE user_id=?').bind(account.id).all()).results;const journals=(await db.prepare('SELECT operation_id,status FROM task21_payment_reconciliations WHERE user_id=?').bind(account.id).all()).results;const status=txs.length===2&&txs.filter(t=>t.status==='active'&&t.amount_minor===9000&&t.currency==='USD'&&t.revision===2).length===1&&txs.filter(t=>t.status==='deleted'&&t.amount_minor===8000&&t.system_superseded_by===seed.command.payload.canonical_transaction_id).length===1&&journals.length===1&&journals[0].status==='applied'&&restarted&&requests>=35?'PASS':'FAIL';await fs.writeFile(path.join(out,'server-final.json'),JSON.stringify({status,txs,journals,restarted,requests,dropped503_after_commit:dropped,synthetic_only:true},null,2));server.close();await mf.dispose();if(status==='FAIL')process.exitCode=1}
await new Promise(r=>server.listen(0,'127.0.0.1',r));await fs.writeFile(path.join(out,'port.json'),JSON.stringify({port:server.address().port,pid:process.pid,synthetic_only:true}));
setTimeout(()=>{void stop()},360000).unref();
