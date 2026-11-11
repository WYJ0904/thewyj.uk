/** Owner-requested self-contained local sandbox. All identities, signatures and
 * money are synthetic. No provider endpoint, credential, phone or payment. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {readWechatProviderEvidence} from '../../../functions/_lib/task21-provider-evidence.mjs';
import {ingestNotificationEvents} from '../../../functions/_lib/task21-service.mjs';
import {readLifecycleBalance} from '../../../functions/_lib/task21-lifecycle.mjs';
import {dumpD1,restoreD1,writeSqliteSnapshot} from '../phase-a/d1-snapshot.mjs';
const out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);await fs.mkdir(out,{recursive:true});const log=path.join(out,'sandbox.ndjson');await fs.writeFile(log,'',{flag:'wx'});
const root=path.resolve(import.meta.dirname,'../../..'),bytes=s=>new TextEncoder().encode(s),b64=b=>Buffer.from(b).toString('base64');
const hash=s=>createHash('sha256').update(s).digest('hex');
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const account={id:'synthetic-local-sandbox-owner',entitlements:['finance_access']};
const policy={accountId:account.id,merchantId:'synthetic-merchant',appId:'synthetic-app',payerId:'synthetic-payer',nowSeconds:1792468800,platformKeys:new Map([['synthetic-serial',keys.publicKey]]),apiV3Key:aes};
const make=()=>new Miniflare({modules:true,script:'export default {fetch(){return new Response("SYNTHETIC ONLY")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});let mf=make(),db=await mf.getD1Database('DB');
const captures=new Map();let once=false,seq=0;
const ledger=async()=>(await db.prepare('SELECT * FROM task16_finance_transactions WHERE user_id=? ORDER BY id').bind(account.id).all()).results;
const source={mchid:policy.merchantId,appid:policy.appId,payer:{openid:policy.payerId},transaction_id:'synthetic-sandbox-capture',trade_state:'SUCCESS',amount:{total:10000,payer_total:8000,currency:'CNY',payer_currency:'CNY'}};
policy.findVerifiedCapture=async id=>captures.get(id);
async function signed(s,type='TRANSACTION.SUCCESS'){
 const nonce=crypto.getRandomValues(new Uint8Array(9));const iv=Buffer.from(nonce).toString('base64'),associated_data='synthetic-resource';
 const ciphertext=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(iv),additionalData:bytes(associated_data),tagLength:128},aes,bytes(JSON.stringify(s))));
 const body=JSON.stringify({id:'synthetic-delivery-'+(++seq),event_type:type,resource:{algorithm:'AEAD_AES_256_GCM',nonce:iv,associated_data,ciphertext}});
 const headers={'Wechatpay-Serial':'synthetic-serial','Wechatpay-Timestamp':String(policy.nowSeconds),'Wechatpay-Nonce':'synthetic-request-nonce'};
 headers['Wechatpay-Signature']=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,bytes(`${policy.nowSeconds}\nsynthetic-request-nonce\n${body}\n`)));
 return {body,headers};
}
const server=createServer(async(req,res)=>{try{
 if(req.method!=='POST'||req.url!=='/synthetic/callback'){res.writeHead(404);res.end('{}');return}
 const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>65536)throw Error('synthetic bounded input');chunks.push(c)}
 const raw=Buffer.concat(chunks).toString('utf8'),fact=await readWechatProviderEvidence(raw,new Headers(req.headers),policy);
 if(fact.status!=='verified_fact'){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify(fact));return}
 const id='synthetic-callback-'+hash(raw).slice(0,36);
 // This mapping exists in QA only. Revision stays 0: the adapter did not
 // supply a real absolute operation revision or a correction authority.
 const event={event_id:id,fingerprint:hash(raw),source_package:'com.tencent.mm',source_type:'notification',event_type:fact.role==='REFUND'?'refund':'transaction',parser_version:'wechat-4',parse_status:'parsed',direction:fact.role==='REFUND'?'refund':'expense',amount_minor:fact.amount_minor,currency:fact.currency,payment_channel:'wechat',provider_reference:fact.operation_reference,financial_phase:fact.role==='REFUND'?'REFUNDED':'SETTLED',lifecycle_reference:fact.parent_reference||fact.operation_reference,reference_namespace:'wechat',currency_evidence:'CNY',lifecycle_operation:fact.role==='REFUND'?'REFUND':'CAPTURE',lifecycle_revision:0,merchant:'synthetic merchant',counterparty:'',confidence:950,received_at_ms:1792368000000,occurred_at_ms:1792368000000};
 const reply=await ingestNotificationEvents(db,account,{schema_version:1,device_id:'synthetic-sandbox-device',operations:[{operation_id:id,type:'event.ingest',payload:event}]});
 if(fact.role==='CAPTURE'&&reply.operation_results[0].transaction_id)captures.set(fact.operation_reference,fact);
 await fs.appendFile(path.join(out,'wire.ndjson'),JSON.stringify({synthetic_only:true,fact,event,result:reply})+'\n');
 if(!once){once=true;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"synthetic_commit_ack_lost"}');return}
 res.setHeader('content-type','application/json');res.end(JSON.stringify(reply));
 }catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||e.message}))}});
let origin,first;
const send=async packet=>{const response=await fetch(origin+'/synthetic/callback',{method:'POST',headers:packet.headers,body:packet.body});return {status:response.status,body:await response.json()}};
const tests=[
 ['LS01-SIGNED-HTTP-FACT-COMMITTED-WITH-LOST-ACK',async()=>{first=await signed(source);const r=await send(first);assert.equal(r.status,503);const rows=await ledger();assert.equal(rows.length,1);assert.equal(rows[0].amount_minor,8000);return {r,rows}}],
 ['LS02-PERSISTED-RETRY-AND-THIRTY-DUPLICATES',async()=>{const q=path.join(out,'synthetic-callback-outbox.json');await fs.writeFile(q,JSON.stringify({synthetic_only:true,request:first}),{flag:'wx'});const persisted=JSON.parse(await fs.readFile(q,'utf8'));for(let i=0;i<31;i++)assert.equal((await send(persisted.request)).status,200);assert.equal((await ledger()).length,1);return {retries:31,ledger:await ledger()}}],
 ['LS03-TAMPERED-AND-FOREIGN-SCOPES-REJECTED',async()=>{assert.equal((await send({...first,body:first.body+' '})).status,400);assert.equal((await send(await signed({...source,mchid:'foreign-merchant'}))).status,400);assert.equal((await send(await signed({...source,payer:{openid:'foreign-payer'}}))).status,400);assert.equal((await ledger()).length,1)}],
 ['LS04-TWO-PARTIAL-REFUNDS-AND-DUPLICATE',async()=>{const base={mchid:policy.merchantId,transaction_id:source.transaction_id,refund_status:'SUCCESS'};const a=await signed({...base,refund_id:'synthetic-refund-a',amount:{refund:2000,payer_refund:1600}},'REFUND.SUCCESS'),b=await signed({...base,refund_id:'synthetic-refund-b',amount:{refund:1000,payer_refund:800}},'REFUND.SUCCESS');assert.equal((await send(a)).status,200);assert.equal((await send(b)).status,200);assert.equal((await send(a)).status,200);const balance=await readLifecycleBalance(db,account,'wechat',source.transaction_id);assert.equal(balance.cleared_minor,8000);assert.equal(balance.refunded_minor,2400);assert.equal(balance.net_expense_minor,5600);assert.equal((await ledger()).length,3);return balance}],
 ['LS05-UNVERSIONED-AMOUNT-CHANGE-CANNOT-CORRECT',async()=>{const r=await send(await signed({...source,amount:{...source.amount,payer_total:9000}}));assert.equal(r.status,200);assert.equal(r.body.operation_results[0].transaction_id,'');assert.ok(r.body.operation_results[0].candidate_id);assert.equal((await ledger()).find(t=>t.direction==='expense').amount_minor,8000);return r}],
 ['LS06-CLOSED-EXPORT-RESTORE-RETAINS-IDS-AND-RECEIPTS',async()=>{const before=await dumpD1(db);await writeSqliteSnapshot(path.join(out,'synthetic-sandbox-backup.sqlite'),before);await fs.writeFile(path.join(out,'synthetic-logical-backup.json'),JSON.stringify(before));await mf.dispose();mf=make();db=await mf.getD1Database('DB');await restoreD1(db,before);assert.deepEqual((await dumpD1(db)).tables,before.tables);assert.deepEqual((await dumpD1(db)).sequence,before.sequence);assert.equal((await ledger()).length,3);return {tables:Object.keys(before.tables).length,ledger:await ledger()}}],
 ['LS07-NO-EXTERNAL-ROUTE-OR-CREDENTIAL-PERSISTENCE',async()=>{assert.equal((await fetch(origin+'/api/pay',{method:'POST'})).status,404);const files=await fs.readdir(out);assert.ok(!files.some(n=>/key|token|credential|pem/i.test(n)));return {origin_scope:'127.0.0.1 only',provider_requests:0,actual_payments:0,real_provider_acceptance:'NOT_TESTED'}}],
];
try{
 for(const n of(await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',n),'utf8')).replace(/\r?\n/g,' '));
 const now=new Date().toISOString();await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 for(const [case_id,fn]of tests){let error,actual;try{actual=await fn()}catch(e){error=e.stack;process.exitCode=1}await fs.appendFile(log,JSON.stringify({case_id,status:error?'FAIL':'PASS',error:error||'',actual,synthetic_only:true})+'\n');console.log(case_id,error?'FAIL':'PASS')}
 await fs.writeFile(path.join(out,'sandbox-manifest.json'),JSON.stringify({scope:'self-created local synthetic provider/finance/backup sandbox',external_requests:0,payments:0,real_user_data:false,keys:'ephemeral memory only',production_access:false,server_stopped_on_exit:true},null,2));
}finally{await new Promise(resolve=>server.close(resolve));await mf.dispose()}
