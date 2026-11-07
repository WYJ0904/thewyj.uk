import assert from 'node:assert/strict';
import test from 'node:test';
import {createApiClient} from '../../js/core/api.js';
globalThis.window=globalThis;
function setup(){let owner='owner-A',complete,seen;const observed=new Promise(r=>seen=r),answer=new Promise(r=>complete=r),effects=[];
  const client=createApiClient({getSession:()=>owner,backendErrorMessage:()=> 'isolated transport error',markBackendReachable:()=>effects.push('reachable'),markGetReachable:()=>effects.push('get'),markNetworkFailure:()=>effects.push('network'),handleSessionExpired:()=>{effects.push('expired');owner='';},handleMembershipRequired:()=>effects.push('membership')});
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;seen();return calls===1?answer:new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}})};
  return{client,observed,complete,switch:()=>owner='owner-B',owner:()=>owner,effects,calls:()=>calls,restore:()=>globalThis.fetch=original};
}
test('late A GET rejection cannot expire B or reissue the request as B',async()=>{
  const f=setup();try{const result=f.client.apiGet('/isolated-owner-resource');await f.observed;f.switch();f.complete(new Response(JSON.stringify({code:'canonical_session_invalid',error:'old session rejected'}),{status:401}));await assert.rejects(result,e=>e.name==='AbortError'&&e.code==='account_changed');assert.equal(f.owner(),'owner-B');assert.deepEqual(f.effects,[]);assert.equal(f.calls(),1);}finally{f.restore();}
});
test('late A POST cannot open a membership page in B context',async()=>{
  const f=setup();try{const result=f.client.api('/isolated-owner-mutation',{});await f.observed;f.switch();f.complete(new Response(JSON.stringify({code:'membership_required',error:'old membership rejected'}),{status:403}));await assert.rejects(result,e=>e.name==='AbortError'&&e.code==='account_changed');assert.equal(f.owner(),'owner-B');assert.deepEqual(f.effects,[]);}finally{f.restore();}
});
test('successful A response is discarded after the active identity changes',async()=>{
  const f=setup();try{const result=f.client.apiGet('/isolated-owner-data');await f.observed;f.switch();f.complete(new Response(JSON.stringify({ok:true,account:{id:'owner-A'}}),{status:200}));await assert.rejects(result,e=>e.name==='AbortError'&&e.code==='account_changed');assert.deepEqual(f.effects,[]);assert.equal(f.owner(),'owner-B');}finally{f.restore();}
});
