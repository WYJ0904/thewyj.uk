import assert from 'node:assert/strict';
import {featureWriteWithBudget} from './feature-write-budget.mjs';
const limited={status:429,body:{code:'task25_rate_limited',retryable:true},retry_after:'60'};
let sent=0,waits=[];
assert.equal((await featureWriteWithBudget(async()=>++sent===1?limited:{status:200},{wait:async ms=>waits.push(ms)})).status,200);
assert.equal(sent,2);assert.deepEqual(waits,[30000,30000,250]);
for(const response of [{status:503,body:{}},{status:409,body:{code:'task25_revision_conflict'}},{status:429,body:{code:'other_limit',retryable:true}}]){
  sent=0;assert.equal(await featureWriteWithBudget(async()=>{sent++;return response;}),response);assert.equal(sent,1);
}
await assert.rejects(()=>featureWriteWithBudget(async()=>{throw new Error('ambiguous transport failure');}),/ambiguous transport/);
for(const retry_after of ['', '0','61','invalid'])await assert.rejects(()=>featureWriteWithBudget(async()=>({...limited,retry_after})),/Retry-After/);
sent=0;assert.equal((await featureWriteWithBudget(async()=>{sent++;return {...limited,retry_after:'1'};},{wait:async()=>{}})).status,429);assert.equal(sent,3);
console.log('PASS Task25 management budget: honor bounded Retry-After only for a rejected write; no ambiguous mutation retry or quota bypass.');
