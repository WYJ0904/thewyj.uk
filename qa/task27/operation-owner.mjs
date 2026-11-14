import assert from 'node:assert/strict';
// Import the real UI transport helper without a browser; no UI is mounted.
globalThis.document={querySelectorAll(){return [];}};
const {ownerBoundRequest}=await import('../../js/account/security-center.js');
let owner='native-cookie:account-a',finish;
const transport=ownerBoundRequest(()=>new Promise(resolve=>{finish=resolve;}),()=>owner);
const pending=transport('/api/security/mfa/start');
owner='native-cookie:account-b';finish({secret:'synthetic-private-enrollment'});
await assert.rejects(pending,error=>error.code==='account_changed');
const stable=ownerBoundRequest(async()=>({ok:true}),()=>owner);
assert.deepEqual(await stable(),{ok:true});
console.log('PASS account switch discards pending private security responses even when the native cookie sentinel stays unchanged');
