import assert from 'node:assert/strict';
import {createWrongReviewController,parseWrongReviewReceipt} from '../../js/language/wrong-review-sync.js';
import {initialWrongReview,reduceWrongReview} from '../../js/language/wrong-review.js';
let context={account_id:'one',profile:'我',language:'english',scope:'history',entitlements:['language_english_access']},enabled=true,fail=true,requests=[];
const rows=new Map(),journal={list:async account=>[...rows.values()].filter(row=>row.account_id===account).map(row=>structuredClone(row)),put:async row=>rows.set(row.account_id+':'+row.event_id,structuredClone(row)),clear:async account=>{for(const [key,row] of rows)if(row.account_id===account)rows.delete(key);}};
const input={event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),profile:'我',scope:'history',language:'english',record_id:'fixture-record',review_id:'fixture-review',kind:'answer',answer:'苹果'};
const accepted=new Date().toISOString(),state=reduceWrongReview(initialWrongReview(),{at:accepted,correct:true,kind:'answer'});
const receipt={account_id:'one',event_id:input.event_id,attempt_id:input.attempt_id,profile:input.profile,language:input.language,review_id:input.review_id,acknowledged:true,correct:true,event_seq:1,last_event_seq:1,accepted_at:accepted,state};
const controller=createWrongReviewController({getContext:()=>context,features:{enabled:()=>enabled},journal,locks:{request:async(_key,callback)=>callback()},
  apiGet:async()=>({account_id:context.account_id,profile:context.profile,language:context.language,scope:context.scope,algorithm:'wrong-review-v1',states:[]}),
  api:async(_route,body)=>{requests.push(body);if(fail)throw new Error('response lost after acceptance');return receipt;}});
await controller.update();await controller.enqueue(input,'one');assert.equal(requests.length,0,'Durable save precedes network and local source synchronization');
await controller.sync();assert.equal(rows.values().next().value.receipt,undefined);assert.match(controller.status(),/待确认|待服务端确认/);
fail=false;await controller.sync();assert.deepEqual(requests.map(row=>row.event_id),[input.event_id,input.event_id]);assert.equal(rows.values().next().value.receipt.event_seq,1);assert.equal(controller.confirmed('',{review_id:input.review_id}).score,20);
console.log('PASS response loss replays the original durable event and accepts one authoritative receipt');
for(const patch of [{account_id:'two'},{profile:'another'},{event_seq:0},{last_event_seq:0},{accepted_at:'bad'},{state:{...state,score:101}}])assert.equal(parseWrongReviewReceipt({...receipt,...patch},input,'one'),null);
console.log('PASS malformed, other-account, other-profile and stale receipts cannot enter confirmed state');
enabled=false;await controller.update();const off={...input,event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID()};await controller.enqueue(off,'one');await controller.sync();assert.equal(requests.length,2);
console.log('PASS disabled flags preserve pending evidence and issue no smart API calls');
let released;const late=new Promise(resolve=>{released=resolve;});
enabled=true;
const other=createWrongReviewController({getContext:()=>context,features:{enabled:()=>true},journal,locks:{request:async(_key,callback)=>callback()},api:async()=>late,apiGet:async()=>({account_id:context.account_id,profile:context.profile,language:context.language,scope:context.scope,algorithm:'wrong-review-v1',states:[]})});
const old=other.update();await new Promise(resolve=>setTimeout(resolve,10));context={...context,account_id:'two',profile:'other'};await other.update();released({...receipt,event_id:off.event_id,attempt_id:off.attempt_id});await old;
assert.equal(rows.get('one:'+off.event_id).receipt,undefined);assert.equal(other.confirmed('',{review_id:input.review_id}),null);
console.log('PASS account/profile switch rejects delayed acknowledgement and retains the original outbox');
await journal.clear('two');assert.equal(rows.size,2,'Clearing another account must preserve the original events');
enabled=true;await controller.update();
const basic={...input,event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),profile:context.profile};
const beforeBasic=requests.length;await controller.enqueue(basic,'two',null,{localOnly:true});await controller.sync();
assert.equal(requests.length,beforeBasic);assert.equal(rows.get('two:'+basic.event_id).local_only,true);
console.log('PASS basic reviews remain durably local and never become an unauthorized smart-sync backlog');
const conflict={...basic,event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID()},good={...basic,event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),review_id:'another-review'};
await journal.put({account_id:'two',event_id:conflict.event_id,input:conflict,created_at:1});await journal.put({account_id:'two',event_id:good.event_id,input:good,created_at:2});
const attempts=[];
const resilient=createWrongReviewController({getContext:()=>context,features:{enabled:()=>true},journal,
  apiGet:async()=>({account_id:'two',profile:context.profile,language:'english',scope:'history',algorithm:'wrong-review-v1',states:[]}),
  api:async(_route,body)=>{attempts.push(body.event_id);if(body.event_id===conflict.event_id)throw Object.assign(new Error('conflict'),{code:'wrong_review_idempotency_conflict'});
    return {...receipt,account_id:'two',event_id:good.event_id,attempt_id:good.attempt_id,profile:good.profile,review_id:good.review_id};}});
await resilient.update();assert.deepEqual(attempts,[conflict.event_id,good.event_id]);assert.equal(rows.get('two:'+conflict.event_id).receipt,undefined);assert.ok(rows.get('two:'+good.event_id).receipt);
assert.match(resilient.status(),/冲突/);
console.log('PASS conflicting drafts are preserved while later independent answers still synchronize');
console.log('Wrong-review client: 6 groups passed');
