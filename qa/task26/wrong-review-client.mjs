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
console.log('Wrong-review client: 4 groups passed');
