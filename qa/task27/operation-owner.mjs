import assert from 'node:assert/strict';
// Import the real UI transport helper without a browser; no UI is mounted.
globalThis.document={querySelectorAll(){return [];}};
const {ownerBoundRequest,createSecurityCenter}=await import('../../js/account/security-center.js');
let owner='native-cookie:account-a',finish;
const transport=ownerBoundRequest(()=>new Promise(resolve=>{finish=resolve;}),()=>owner);
const pending=transport('/api/security/mfa/start');
owner='native-cookie:account-b';finish({secret:'synthetic-private-enrollment'});
await assert.rejects(pending,error=>error.code==='account_changed');
const stable=ownerBoundRequest(async()=>({ok:true}),()=>owner);
assert.deepEqual(await stable(),{ok:true});
console.log('PASS account switch discards pending private security responses even when the native cookie sentinel stays unchanged');

document.getElementById=()=>null;document.addEventListener=()=>{};document.hidden=false;
globalThis.window={addEventListener(){},setInterval(){return 0;}};
let account={id:'synthetic-badge-a'},calls=0;
const center=()=>createSecurityCenter({api:async()=>({}),apiGet:async()=>{calls++;return {unread_count:1};},publicApi:async()=>({}),getSession:()=> 'synthetic-badge-session',getAccount:()=>account,openModal(){},closeModal(){},onInvalidated(){}});
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async()=>new Response('{}',{status:404});
  let ui=center();await ui.refreshBadge(true);await ui.refreshBadge(true);assert.equal(calls,0);
  console.log('PASS a legacy backend without Task27 capability never receives private notification polling');
  globalThis.fetch=async()=>Response.json({security_center_ready:true});
  ui=center();await ui.refreshBadge(true);assert.equal(calls,1);
  console.log('PASS a supported backend still refreshes its authoritative unread count');
  calls=0;let release;
  globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
  ui=center();const refresh=ui.refreshBadge(true);account={id:'synthetic-badge-b'};release(Response.json({security_center_ready:true}));await refresh;assert.equal(calls,0);
  globalThis.fetch=async()=>new Response('{}',{status:503});ui=center();await ui.refreshBadge(true);assert.equal(calls,0);
  console.log('PASS a late capability response or unavailable service cannot start private polling after an account switch');
}finally{globalThis.fetch=originalFetch;}
