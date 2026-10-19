import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {ingestNotificationEvents,confirmNotificationCandidate} from '../../../functions/_lib/task21-service.mjs';
import {readLifecycleBalance} from '../../../functions/_lib/task21-lifecycle.mjs';

const root=path.resolve(import.meta.dirname,'../../..');const output=process.env.FINANCE_P03_OUTPUT;
assert.ok(output);await fs.mkdir(output,{recursive:true});
const file=path.join(output,'clearing.ndjson');
try{await fs.access(file);throw Error('Preserve every run')}catch(e){if(e.code!=='ENOENT')throw e;}
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic closeout")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],d1Persist:false});
const db=await mf.getD1Database('DB');const rows=[];
try {
  for(const name of (await fs.readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())
    await db.exec((await fs.readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
  for(const [id,fn] of [
    ['N01-PARTIAL-CAPTURE-RELEASE',async h=>{
      await h.auth(200);for(let i=0;i<30;i++)await h.capture('one-'+i,80,'CAPTURE-ONE');await h.capture('two',90);
      assert.equal((await h.balance()).remaining_frozen_minor,3000);
      await h.release('one',10);for(let i=0;i<30;i++)await h.release('two-'+i,20,'RELEASE-TWO');
      const b=await h.balance();assert.equal(b.cleared_minor,17000);assert.equal(b.released_minor,3000);assert.equal(b.remaining_frozen_minor,0);assert.equal(await h.count(),2);return b;
    }],
    ['N02-RESERVATION-NOT-A-CHARGE-LIMIT',async h=>{
      await h.auth(100);await h.capture('over',120);const b=await h.balance();assert.equal(b.over_captured_minor,2000);assert.equal(b.remaining_frozen_minor,0);assert.equal(b.cleared_minor,12000);return b;
    }],
    ['N03-MULTIPLE-REFUNDS-AND-BOUND',async h=>{
      await h.auth(100);await h.capture('one',80);for(let i=0;i<30;i++)await h.refund('one-'+i,20,'REFUND-ONE');await h.refund('two',30);await h.refund('three',30);
      const r=await h.refund('excess',1);assert.equal(r.transaction_id,'');assert.ok(r.candidate_id);assert.equal(r.event.lifecycle_review_reason,'lifecycle_refund_exceeds_capture');
      await assert.rejects(()=>confirmNotificationCandidate(db,h.account,{candidate_id:r.candidate_id,device_id:'synthetic-closeout-device'}));
      const b=await h.balance();assert.equal(b.refunded_minor,8000);assert.equal(b.net_expense_minor,0);assert.equal(await h.count(),4);return {b,r};
    }],
    ['N04-REFUND-BEFORE-CAPTURE-AND-OLD-RECEIPT',async h=>{
      await h.auth(100);const payload=h.event('refund-first','REFUNDED',20,'REFUND-EARLY',{parse_status:'candidate',identity_review_reason:'lifecycle_capture_missing'});
      const early=await h.ingest(payload,'synthetic-old-refund-operation');assert.equal(early.transaction_id,'');assert.ok(early.candidate_id);
      await h.capture('late',80);const retry=await h.ingest(payload,'synthetic-old-refund-operation');assert.ok(retry.transaction_id);assert.equal(await h.count(),2);
      const b=await h.balance();assert.equal(b.refunded_minor,2000);assert.equal(b.net_expense_minor,6000);return {early,retry,b};
    }],
    ['N05-RELEASE-CANNOT-EXCEED-REMAINING',async h=>{
      await h.auth(100);await h.capture('one',80);const r=await h.release('bad',30);assert.equal(r.event.lifecycle_review_reason,'lifecycle_release_exceeds_remaining');
      const b=await h.balance();assert.equal(b.released_minor,0);assert.equal(b.remaining_frozen_minor,null);assert.equal(await h.count(),1);return {r,b};
    }],
    ['N06-EXPLICIT-EXPIRY-RELEASES-RESIDUAL',async h=>{
      await h.auth(100);await h.capture('one',80);await h.ingest(h.event('expiry','EXPIRED',100,h.family));const b=await h.balance();
      assert.equal(b.cleared_minor,8000);assert.equal(b.released_minor,2000);assert.equal(b.remaining_frozen_minor,0);return b;
    }],
    ['N07-LATE-AUTHORIZATION',async h=>{
      await h.capture('first',80);assert.equal((await h.balance()).authorized_minor,null);await h.auth(100);
      const b=await h.balance();assert.equal(b.remaining_frozen_minor,2000);assert.equal(await h.count(),1);return b;
    }],
    ['N08-VERSIONED-CORRECTION-QUARANTINE',async h=>{
      await h.auth(200);const a=await h.capture('one',80,'CAPTURE-VERSIONED',{lifecycle_revision:1});
      const r=await h.capture('revision',90,'CAPTURE-VERSIONED',{lifecycle_revision:2});assert.equal(r.transaction_id,'');assert.ok(r.candidate_id);
      assert.equal(r.event.lifecycle_review_reason,'lifecycle_revision_requires_reconciliation');assert.equal(r.event.lifecycle_revision,2);
      await assert.rejects(()=>confirmNotificationCandidate(db,h.account,{candidate_id:r.candidate_id,device_id:'synthetic-closeout-device'}));
      assert.equal(await h.count(),1);const t=await db.prepare('SELECT amount_minor FROM task16_finance_transactions WHERE id=?1').bind(a.transaction_id).first();assert.equal(t.amount_minor,8000);return {a,r};
    }],
    ['N09-CONCURRENT-REFUNDS-ATOMIC-BOUND',async h=>{
      await h.auth(100);await h.capture('one',80);
      const responses=await Promise.all([h.refund('race-one',60),h.refund('race-two',60)]);
      const b=await h.balance();assert.equal(b.refunded_minor,6000);assert.equal(b.net_expense_minor,2000);assert.equal(await h.count(),2);
      assert.equal(responses.filter(r=>r.transaction_id).length,1);return {responses,b};
    }],
    ['N10-SAME-RELEASE-REFERENCE-DIFFERENT-MONEY',async h=>{
      await h.auth(100);await h.release('first',10,'RELEASE-SAME');const r=await h.release('conflict',20,'RELEASE-SAME');
      assert.equal(r.event.lifecycle_review_reason,'reference_money_or_instance_conflict');assert.equal((await h.balance()).released_minor,1000);return r;
    }],
    ['N11-FAMILY-CURRENCY-CONFLICT',async h=>{
      await h.auth(100);const r=await h.capture('wrong-unit',80,undefined,{currency:'CNY',currency_evidence:'CNY'});
      assert.equal(r.transaction_id,'');assert.equal(r.event.lifecycle_review_reason,'lifecycle_currency_conflict');assert.equal(await h.count(),0);return r;
    }],
    ['N12-PARTIAL-RELEASE-BEFORE-AUTHORIZATION',async h=>{
      const r=await h.release('early',20);assert.equal(r.event.lifecycle_review_reason,'lifecycle_authorization_missing');await h.auth(100);
      const b=await h.balance();assert.equal(b.released_minor,2000);assert.equal(b.remaining_frozen_minor,8000);assert.equal(await h.count(),0);return b;
    }],
    ['N13-AMBIGUOUS-C005-CANNOT-CLAIM-A-RELEASE-AMOUNT',async h=>{
      await h.auth(200);await h.capture('legacy-one',80,h.family);
      const conflict=await h.capture('legacy-two',90,h.family);assert.equal(conflict.transaction_id,'');assert.ok(conflict.candidate_id);
      await h.ingest(h.event('full-close','RELEASED',200,h.family,{lifecycle_operation:'CLOSE'}));
      const b=await h.balance();assert.equal(b.cleared_minor,8000);assert.equal(b.remaining_frozen_minor,null);
      assert.equal(b.released_minor,null,'a full close plus ambiguous captures cannot prove the amount actually released');return {conflict,b};
    }],
    ['N14-EXPIRY-BEFORE-AUTHORIZATION',async h=>{
      await h.capture('early',80);await h.ingest(h.event('expiry-first','EXPIRED',100,h.family));
      assert.equal((await h.balance()).released_minor,null);await h.auth(100);
      const b=await h.balance();assert.equal(b.cleared_minor,8000);assert.equal(b.released_minor,2000);assert.equal(b.remaining_frozen_minor,0);return b;
    }],
    ['N15-PROCESSING-RELEASE-REQUIRES-EXACT-COMPLETED-WITNESS',async h=>{
      await h.auth(100);const intent=h.event('release-intent','RELEASED',10,'SYNTH-PROCESS-RELEASE',{identity_review_reason:'lifecycle_completion_unproven'});
      let pending;for(let i=0;i<30;i++)pending=await h.ingest(intent,'synthetic-release-intent-operation');
      assert.equal((await h.balance()).released_minor,0);assert.ok(pending.candidate_id);
      await h.release('release-done',10,'SYNTH-PROCESS-RELEASE');
      const b=await h.balance();assert.equal(b.released_minor,1000);assert.equal(b.remaining_frozen_minor,9000);
      const state=await db.prepare('SELECT status FROM task21_notification_candidates WHERE id=?1').bind(pending.candidate_id).first();assert.equal(state.status,'rejected');
      await h.ingest(intent,'synthetic-release-intent-operation');assert.equal((await h.balance()).remaining_frozen_minor,9000);assert.equal(await h.count(),0);return {b,state};
    }],
    ['N16-PROCESSING-CAPTURE-REQUIRES-EXACT-COMPLETED-WITNESS',async h=>{
      await h.auth(100);const intent=h.event('capture-intent','SETTLED',80,'SYNTH-PROCESS-CAPTURE',{parse_status:'candidate',identity_review_reason:'lifecycle_completion_unproven'});
      for(let i=0;i<30;i++)await h.ingest(intent,'synthetic-capture-intent-operation');assert.equal(await h.count(),0);
      await h.refund('waiting',20);const done=await h.capture('capture-done',80,'SYNTH-PROCESS-CAPTURE');
      const b=await h.balance();assert.equal(b.cleared_minor,8000);assert.equal(b.refunded_minor,2000);assert.equal(b.remaining_frozen_minor,2000);
      const replay=await h.ingest(intent,'synthetic-capture-intent-operation');assert.equal(replay.transaction_id,done.transaction_id);assert.equal(await h.count(),2);return {done,replay,b};
    }],
  ]) {
    const account={id:'synthetic-closeout-'+id.slice(0,3),entitlements:['finance_access']};const now=new Date().toISOString();
    await db.prepare(`INSERT INTO task12_users (id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
      VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id,now).run();
    const family='SYNTH-AUTH-'+id.slice(0,3);let seq=0;
    const event=(name,phase,amount,ref,more={})=>({event_id:'synthetic-'+id.slice(0,3)+'-event-'+name,fingerprint:'c'.repeat(64),source_package:'cmb.pb',source_type:'notification',
      event_type:phase==='REFUNDED'?'refund':'transaction',parser_version:'bank-notification-4',parse_status:['SETTLED','REFUNDED'].includes(phase)?'parsed':'candidate',
      direction:phase==='REFUNDED'?'refund':'expense',amount_minor:amount*100,currency:'USD',payment_channel:'bank_card',provider_reference:ref,
      financial_phase:phase,lifecycle_reference:family,reference_namespace:'bank_card:cmb',currency_evidence:'USD',
      lifecycle_operation:{AUTHORIZED:'AUTHORIZE',SETTLED:'CAPTURE',REFUNDED:'REFUND',RELEASED:'RELEASE',EXPIRED:'CLOSE'}[phase],
      merchant:'synthetic',counterparty:'',confidence:950,received_at_ms:1792368000000,occurred_at_ms:1792368000000,...more});
    const ingest=async(e,op)=>{
      const response=await ingestNotificationEvents(db,account,{schema_version:1,device_id:'synthetic-closeout-device',operations:[{operation_id:op||'synthetic-closeout-op-'+seq++,type:'event.ingest',payload:e}]});
      const result=response.operation_results[0];return result;
    };
    const h={account,family,event,ingest,auth:(n)=>ingest(event('auth','AUTHORIZED',n,family)),
      capture:(id,n,ref='SYNTH-CAP-'+id,more={})=>ingest(event('capture-'+id,'SETTLED',n,ref,more)),
      release:(id,n,ref='SYNTH-REL-'+id)=>ingest(event('release-'+id,'RELEASED',n,ref)),
      refund:(id,n,ref='SYNTH-REF-'+id)=>ingest(event('refund-'+id,'REFUNDED',n,ref)),
      balance:()=>readLifecycleBalance(db,account,'bank_card:cmb',family),
      count:async()=>Number((await db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions WHERE user_id=?1').bind(account.id).first()).n)};
    let actual,error;try {actual=await fn(h)}catch(e){error=e.stack;process.exitCode=1}
    const row={case_id:id,status:error?'FAIL':'PASS',actual,error:error||'',synthetic_only:true};rows.push(row);await fs.appendFile(file,JSON.stringify(row)+'\n');
  }
} finally {await mf.dispose()}
console.log(JSON.stringify(rows.map(({case_id,status})=>({case_id,status}))));
