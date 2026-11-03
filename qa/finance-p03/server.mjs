import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {ingestNotificationEvents, confirmNotificationCandidate, ensureTask21Schema} from '../../functions/_lib/task21-service.mjs';
import {sha256Hex} from '../../functions/_lib/cloudflare-foundation.mjs';
import {calculateFinanceSummary} from '../../js/finance/app.js';
import {syncFinance} from '../../functions/_lib/task16-service.mjs';
import {upsertNotificationHints} from '../../functions/_lib/task21-hints.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const output=process.env.FINANCE_P03_OUTPUT;
assert.ok(output,'Use a new FINANCE_P03_OUTPUT directory; preserve every run');
await fs.mkdir(output,{recursive:true});
const log=path.join(output,'server.ndjson');
// Assertions execute against product services and a real local D1.
try {await fs.access(log);throw Error('Preserve existing server.ndjson')} catch(e) {if(e.code!=='ENOENT')throw e;}
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic P03")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
const rows=[];const account={id:'synthetic-p03-server-owner',entitlements:['finance_access']};
let sequence=0;
const event=(id,more={})=>({event_id:'synthetic-p03-'+id,fingerprint:'a'.repeat(64),source_package:'cmb.pb',source_type:'notification',
  event_type:'transaction',parser_version:'bank-notification-4',parse_status:'parsed',direction:'expense',amount_minor:8000,currency:'CNY',payment_channel:'bank_card',
  provider_reference:'',lifecycle_identity:'',merchant:'synthetic merchant',counterparty:'',confidence:950,occurred_at_ms:1792368000000,received_at_ms:1792368000000,...more});
let db;
async function count(){return Number((await db.prepare('SELECT COUNT(*) AS n FROM task16_finance_transactions WHERE user_id=?1').bind(account.id).first()).n)}
async function ingest(e,operationId='synthetic-operation-'+sequence++) {
  return (await ingestNotificationEvents(db,account,{schema_version:'1',device_id:'synthetic-device-a',operations:[{operation_id:operationId,type:'event.ingest',payload:e}]})).operation_results[0];
}
async function check(id,input,expected,fn) {
  const before=await count();let actual,error;try {actual=await fn()} catch(e) {error=e}
  const row={case_id:id,layer:'P03_REQUIRED',fixture:input,precondition:{ledger_rows:before,synthetic_account:account.id},expected,actual,
    status:error?'FAIL':'PASS',error:error?.stack||'',after_ledger_rows:await count(),coverage:'REAL_INGEST_SERVICE_NORMALIZER_MINIFLARE_D1_NO_NETWORK_OR_REAL_ACCOUNT'};
  rows.push(row);await fs.appendFile(log,JSON.stringify(row)+'\n');
}
try {
  db=await mf.getD1Database('DB');
  const migrations=(await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort();
  for(const name of migrations)await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
  const now=new Date().toISOString();
  await db.prepare(`INSERT INTO task12_users (id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
  VALUES (?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
  await check('S01-LEGACY-CNY',{},'one transaction; exact replay unchanged',async()=>{
    const e=event('legacy');const a=await ingest(e,'synthetic-legacy-operation');const b=await ingest(e,'synthetic-legacy-operation');
    assert.ok(a.transaction_id);assert.equal(b.transaction_id,a.transaction_id);assert.equal(await count(),1);return {a,b};
  });
  await check('S02-DIGEST-PAYLOAD-CONFLICT',{},'same operation with changed nested amount rejects',async()=>{
    await assert.rejects(()=>ingest(event('legacy',{amount_minor:9000}),'synthetic-legacy-operation'),e=>e.code==='operation_id_conflict');return {rejected:true};
  });
  await check('S03-WEAK-IDENTITY',{},'zero new ledger rows; review candidate retained',async()=>{
    const before=await count();const r=await ingest(event('weak',{parse_status:'candidate',identity_review_reason:'identity_unproven_notification'}));
    assert.equal(await count(),before);assert.ok(r.candidate_id);assert.equal(r.transaction_id,'');return r;
  });
  await check('S04-ISO-CONFLICT',{},'USD evidence cannot book CNY',async()=>{
    const before=await count();await assert.rejects(()=>ingest(event('iso-bad',{currency_evidence:'USD'})),e=>e.code==='currency_evidence_conflict');
    assert.equal(await count(),before);return {rejected:true};
  });
  const auth=event('auth',{currency:'USD',amount_minor:20000,parse_status:'candidate',provider_reference:'SYNTH-AUTH-A',financial_phase:'AUTHORIZED',lifecycle_reference:'SYNTH-AUTH-A',reference_namespace:'bank_card:cmb',currency_evidence:'USD'});
  let hold;
  await check('S05-AUTHORIZED',auth,'hold evidence + candidate, no expense',async()=>{
    const before=await count();hold=await ingest(auth);assert.equal(await count(),before);assert.ok(hold.candidate_id);assert.equal(hold.event.financial_phase,'AUTHORIZED');return hold;
  });
  await check('S06-NO-MANUAL-HOLD-BOOKING',{},'cannot turn authorization into expense through legacy confirm',async()=>{
    assert.ok(hold?.candidate_id,'hold must actually exist');await assert.rejects(()=>confirmNotificationCandidate(db,account,{candidate_id:hold.candidate_id,device_id:'synthetic-device-a'}),e=>e.code==='payment_lifecycle_not_settled');return {blocked:true};
  });
  let settled;
  await check('S07-THIRTY-SETTLEMENTS',{repeats:30,minor:17000,currency:'USD'},'one final 170 USD transaction, stable receipt',async()=>{
    const before=await count();const ids=[];
    for(let i=0;i<30;i++){const r=await ingest(event('settle-'+i,{...auth,event_id:'synthetic-p03-settle-'+i,parse_status:'parsed',amount_minor:17000,financial_phase:'SETTLED'}));assert.ok(r.transaction_id);ids.push(r.transaction_id)}
    assert.equal(await count(),before+1);assert.equal(new Set(ids).size,1);settled=ids[0];
    const tx=await db.prepare('SELECT amount_minor,currency FROM task16_finance_transactions WHERE id=?1').bind(settled).first();assert.deepEqual(tx,{amount_minor:17000,currency:'USD'});
    const ledger=(await db.prepare("SELECT * FROM task16_finance_transactions WHERE user_id=?1 AND currency='USD'").bind(account.id).all()).results;
    assert.equal(calculateFinanceSummary(ledger).expense_minor,17000);return {ids,tx,web_summary:calculateFinanceSummary(ledger)};
  });
  await check('S08-RELEASE',{},'release preserves settled ID/amount; hold no longer pending',async()=>{
    const before=await count();const r=await ingest({...auth,event_id:'synthetic-p03-release',financial_phase:'RELEASED'});assert.equal(r.transaction_id,'');assert.equal(await count(),before);
    const old=await db.prepare('SELECT status FROM task21_notification_candidates WHERE id=?1').bind(hold.candidate_id).first();assert.equal(old.status,'rejected');return {release:r,hold:old,settled};
  });
  await check('S09-ISSUER-SCOPE',{sources:['cmb.pb','95555']},'same issuer/reference across source/device produces one receipt',async()=>{
    const before=await count();const a=await ingest(event('issuer-app',{provider_reference:'SYNTH-SAME-ISSUER',reference_namespace:'bank_card:cmb'}));
    const b=await ingest(event('issuer-sms',{provider_reference:'SYNTH-SAME-ISSUER',reference_namespace:'bank_card:cmb',source_type:'sms',source_package:'95555'}));
    assert.equal(a.transaction_id,b.transaction_id);assert.equal(await count(),before+1);return {a,b};
  });
  await check('S10-DIFFERENT-ISSUER',{sources:['cmb.pb','95588']},'same literal reference across issuers remains independent',async()=>{
    const before=await count();const a=await ingest(event('issuer-other',{provider_reference:'SYNTH-SAME-ISSUER',reference_namespace:'bank_card:icbc',source_package:'95588',source_type:'sms'}));
    assert.ok(a.transaction_id);assert.equal(await count(),before+1);return a;
  });
  await check('S11-UNLINKED-SETTLEMENT',{},'missing common reference preserves pending evidence; no expense',async()=>{
    const before=await count();const r=await ingest(event('unlinked',{financial_phase:'SETTLED',identity_review_reason:'lifecycle_reference_missing',parse_status:'candidate'}));
    assert.equal(await count(),before);assert.ok(r.candidate_id);await assert.rejects(()=>confirmNotificationCandidate(db,account,{candidate_id:r.candidate_id,device_id:'synthetic-device-a'}));return r;
  });
  await check('S12-PARTIAL-CLEARING',{},'explicit partial clearing stays reviewable',async()=>{
    const before=await count();const r=await ingest(event('partial',{financial_phase:'REVIEW_REQUIRED',identity_review_reason:'partial_clearing_requires_review',parse_status:'candidate',provider_reference:'SYNTH-PARTIAL-A',lifecycle_reference:'SYNTH-PARTIAL-A'}));
    assert.equal(await count(),before);assert.ok(r.candidate_id);return r;
  });
  await check('S13-OUT-OF-ORDER-AUTH',{},'settlement before authorization creates one transaction; later hold closes',async()=>{
    const before=await count();const common={provider_reference:'SYNTH-AUTH-B',lifecycle_reference:'SYNTH-AUTH-B',reference_namespace:'bank_card:cmb',financial_phase:'SETTLED'};
    const a=await ingest(event('out-of-order-post',common));assert.ok(a.transaction_id);
    const b=await ingest(event('out-of-order-hold',{...common,financial_phase:'AUTHORIZED',amount_minor:10000,parse_status:'candidate'}));
    assert.equal(await count(),before+1);assert.equal(b.transaction_id,'');return {a,b};
  });
  await check('S14-REFUND',{},'refund has its own ID; original settlement unchanged',async()=>{
    const before=await count();const r=await ingest(event('refund',{financial_phase:'REFUNDED',provider_reference:'SYNTH-REFUND-A',lifecycle_reference:'SYNTH-AUTH-A',reference_namespace:'bank_card:cmb',direction:'refund',event_type:'refund',currency:'USD',currency_evidence:'USD',amount_minor:17000}));
    assert.ok(r.transaction_id);assert.notEqual(r.transaction_id,settled);assert.equal(await count(),before+1);return r;
  });
  await check('S15-LEGACY-RECEIPT',{},'v1 nested-incomplete digest replays only after immutable stored-event verification',async()=>{
    const e=event('legacy-receipt');const op={operation_id:'synthetic-p03-old-digest',type:'event.ingest',payload:e};const a=await ingest(e,op.operation_id);
    const v1=await sha256Hex(JSON.stringify(op,Object.keys(op).sort()));
    await db.prepare('UPDATE task21_notification_sync_operations SET payload_digest=?1 WHERE user_id=?2 AND operation_id=?3').bind(v1,account.id,op.operation_id).run();
    const b=await ingest(e,op.operation_id);assert.equal(a.transaction_id,b.transaction_id);
    await assert.rejects(()=>ingest({...e,amount_minor:9000},op.operation_id),err=>err.code==='operation_id_conflict');return {a,b};
  });
  await check('S16-SCHEMA-READY',{},'P03 schema is ready; original legacy row preserved',async()=>{
    assert.equal(await ensureTask21Schema(db),true);const row=await db.prepare('SELECT COUNT(*) AS n FROM task21_notification_events WHERE event_id=?1').bind('synthetic-p03-legacy').first();assert.equal(row.n,1);return row;
  });
  await check('S17-DURABLE-MESSAGE',{replays:30},'same qualified message identity across event IDs books once',async()=>{
    const before=await count();const ids=[];
    for(let i=0;i<30;i++)ids.push((await ingest(event('message-'+i,{source_package:'com.tencent.mm',payment_channel:'wechat',reference_namespace:'wechat',lifecycle_identity:'b'.repeat(64)}))).transaction_id);
    assert.equal(await count(),before+1);assert.equal(new Set(ids).size,1);assert.ok(ids[0]);return {ids};
  });
  await check('S18-REFERENCE-OUTRANKS-MESSAGE',{},'different reliable references remain independent despite same message tuple',async()=>{
    const before=await count();const a=await ingest(event('ref-wins-a',{source_package:'com.tencent.mm',payment_channel:'wechat',reference_namespace:'wechat',provider_reference:'SYNTH-STRONG-A',lifecycle_identity:'c'.repeat(64)}));
    const b=await ingest(event('ref-wins-b',{source_package:'com.tencent.mm',payment_channel:'wechat',reference_namespace:'wechat',provider_reference:'SYNTH-STRONG-B',lifecycle_identity:'c'.repeat(64)}));
    assert.notEqual(a.transaction_id,b.transaction_id);assert.equal(await count(),before+2);return {a,b};
  });
  await check('S19-LATER-REFERENCE',{},'later strong evidence maps new source alias to original raw/transaction IDs',async()=>{
    const before=await count();const e=event('promote',{source_package:'com.tencent.mm',payment_channel:'wechat',reference_namespace:'wechat',lifecycle_identity:'d'.repeat(64)});
    const a=await ingest(e);const b=await ingest({...e,provider_reference:'SYNTH-LATE-REF'});
    const d=await ingest({...e,event_id:'synthetic-p03-promoted-alias',provider_reference:'SYNTH-LATE-REF',lifecycle_identity:''});
    assert.equal(a.transaction_id,b.transaction_id);assert.equal(a.transaction_id,d.transaction_id);assert.equal(await count(),before+1);return {a,b,d};
  });
  await check('S20-LEGACY-ISSUER-REFERENCE',{},'known old bank source preserves receipt when issuer-scoped alias arrives',async()=>{
    const before=await count();const a=await ingest(event('legacy-issuer',{provider_reference:'SYNTH-LEGACY-ISSUER'}));
    const b=await ingest(event('legacy-issuer-new',{provider_reference:'SYNTH-LEGACY-ISSUER',reference_namespace:'bank_card:cmb',source_package:'95555',source_type:'sms'}));
    assert.equal(a.transaction_id,b.transaction_id);assert.equal(await count(),before+1);return {a,b};
  });
  const originalEvent=event('legacy');
  const originalId=(await db.prepare('SELECT finance_transaction_id AS id FROM task21_notification_events WHERE event_id=?1').bind(originalEvent.event_id).first()).id;
  const mutate=async(type,revision,payload)=>syncFinance(db,account,{schema_version:'1',device_id:'synthetic-p03-finance-device',platform:'web',device_label:'synthetic P03',client_version:'synthetic',since_version:0,
    operations:[{operation_id:'synthetic-mutation-'+sequence++,type,entity_id:originalId,base_revision:revision,...(payload?{payload}:{})}]});
  await check('S21-EDIT-LATE-INGEST',{},'old ingest receipt preserves edited amount and stable ID',async()=>{
    await mutate('transaction.upsert',1,{direction:'expense',amount_minor:7900,currency:'CNY',category_id:'',merchant:'synthetic edited',counterparty:'',note:'SYNTHETIC',occurred_at_ms:1792368000000});
    const r=await ingest(originalEvent);assert.equal(r.transaction_id,originalId);
    const tx=await db.prepare('SELECT id,amount_minor,revision FROM task16_finance_transactions WHERE id=?1').bind(originalId).first();assert.equal(tx.amount_minor,7900);assert.equal(tx.revision,2);return tx;
  });
  await check('S22-DELETE-LATE-REPLAY',{},'old payment replay cannot recreate or reactivate deleted transaction',async()=>{
    const before=await count();await mutate('transaction.delete',2);await ingest(originalEvent,'synthetic-legacy-operation');
    const tx=await db.prepare('SELECT id,status,revision FROM task16_finance_transactions WHERE id=?1').bind(originalId).first();assert.equal(tx.status,'deleted');assert.equal(await count(),before);return tx;
  });
  await check('S23-RESTORE-OLD-REVISION',{},'restore keeps ID/edited amount; obsolete mutation rejects',async()=>{
    await mutate('transaction.restore',3);
    await assert.rejects(()=>mutate('transaction.delete',2),e=>e.code==='transaction_conflict');
    const tx=await db.prepare('SELECT id,status,amount_minor,revision FROM task16_finance_transactions WHERE id=?1').bind(originalId).first();assert.equal(tx.status,'active');assert.equal(tx.amount_minor,7900);assert.equal(tx.revision,4);return tx;
  });
  await check('S24-REVIEW-CANNOT-BORROW-A-RECEIPT',{},'an instance conflict stays pending even if another event has a confirmed reference hint',async()=>{
    const e=event('hint-owner',{source_package:'com.tencent.mm',payment_channel:'wechat',reference_namespace:'wechat',provider_reference:'SYNTH-HINT-GUARD'});
    const a=await ingest(e);assert.ok(a.transaction_id);const before=await count();const now=new Date().toISOString();
    await db.prepare(`INSERT INTO task21_notification_pending_hints
      (id,user_id,source_event_id,device_id,source_type,source_package,app_label,evidence_summary,amount_minor,direction,merchant,currency,confidence,recognition_status,state,finance_entry_id,created_at,updated_at,confirmed_at,ignored_at,provider_reference,payment_channel,lifecycle_identity)
      VALUES('hint:synthetic-guard',?1,?2,'synthetic-device-a','notification','com.tencent.mm','synthetic','{}',8000,'expense','','CNY',950,'CONFIRMED_PAYMENT','confirmed',?3,?4,?4,?4,'','SYNTH-HINT-GUARD','wechat','')`)
      .bind(account.id,e.event_id,a.transaction_id,now).run();
    const b=await ingest({...e,event_id:'synthetic-p03-hint-conflict',parse_status:'candidate',identity_review_reason:'reference_money_or_instance_conflict'});
    assert.equal(b.transaction_id,'');assert.ok(b.candidate_id);assert.equal(await count(),before);return {a,b};
  });
  await check('S25-HINT-ISSUER-SCOPE',{},'hint settlement preserves issuer scope and converges with a later structured event',async()=>{
    const before=await count();const ids=[];
    for(const [i,pkg] of ['cmb.pb','com.icbc'].entries()) {
      const reply=await upsertNotificationHints(db,account,{device_id:'synthetic-device-a',hints:[{
        source_event_id:'synthetic-p03-issuer-hint-'+i,source_type:'notification',source_package:pkg,app_label:'synthetic',amount_minor:3400,direction:'expense',merchant:'synthetic',currency:'CNY',confidence:950,
        recognition_status:'CONFIRMED_PAYMENT',provider_reference:'SYNTH-ISSUER-HINT',payment_channel:'bank_card',
        evidence:{source_type:'notification',parser_version:'payment-settled-4',occurred_at_ms:1792368000000,reasons:[]}}]});
      assert.equal(reply.hints[0].state,'confirmed');assert.ok(reply.hints[0].finance_entry_id);ids.push(reply.hints[0].finance_entry_id);
    }
    assert.notEqual(ids[0],ids[1]);assert.equal(await count(),before+2);
    const actual=await ingest(event('hint-convergence',{provider_reference:'SYNTH-ISSUER-HINT',reference_namespace:'bank_card:cmb',amount_minor:3400}));
    assert.equal(actual.transaction_id,ids[0]);assert.equal(await count(),before+2);return {ids,actual};
  });
} finally {await mf.dispose()}
console.log(JSON.stringify({cases:rows.length,pass:rows.filter(r=>r.status==='PASS').length,fail:rows.filter(r=>r.status==='FAIL').length},null,2));
if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
