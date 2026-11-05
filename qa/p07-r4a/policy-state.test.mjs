import assert from 'node:assert/strict';
import test from 'node:test';
import {createPublicUiPolicyController} from '../../js/core/public-ui-policy.js';
import {createFeatureController} from '../../js/core/feature-flags.js';
const policy=enabled=>{const at=Date.now();return{public_ui:{schema_version:1,flag_key:'p07_accessibility',enabled,revision:1,reason:enabled?'public_stable':'kill_switch',
  max_age_seconds:30,observed_at:new Date(at).toISOString(),expires_at:new Date(at+30000).toISOString()}};};
function dom(){const listeners=new Map();return{hidden:false,getElementById:()=>null,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),emit:k=>listeners.get(k)?.()};}
test('public pending is distinct from OFF; late policy, error and kill remain authoritative',async()=>{
  const document=dom();let resolve,fail=false,enabled=true;
  const c=createPublicUiPolicyController({document,getAccount:()=>null,apiGet:()=>fail?Promise.reject(Error('fixture failure')):new Promise(r=>resolve=r),events:{}});
  const first=c.refresh();assert.equal(c.decision().status,'pending');resolve(policy(true));await first;assert.equal(c.decision().status,'enabled');
  const second=c.refresh();assert.equal(c.decision().status,'enabled','valid authority must survive renewal');resolve(policy(false));await second;assert.equal(c.decision().status,'disabled');
  fail=true;await c.refresh();assert.equal(c.decision().status,'error');assert.equal(c.enabled(),false);c.dispose();
});
test('hidden tab closes functional flags but retains valid presentation until the exact TTL',async()=>{
  let now=Date.now(),account=null;const document=dom();
  const c=createPublicUiPolicyController({document,getAccount:()=>account,apiGet:async()=>policy(true),events:{},now:()=>now});
  await c.refresh();document.hidden=true;document.emit('visibilitychange');assert.equal(c.enabled(),false);assert.equal(c.decision().status,'enabled');
  document.hidden=false;document.emit('visibilitychange');assert.equal(c.decision().status,'enabled');
  now+=30001;assert.equal(c.decision().status,'pending');assert.equal(c.enabled(),false);c.dispose();
});
test('authenticated public requests cannot enable an account, including session restoration',async()=>{
  let hasSession=false,account=null,resolve;const document=dom();
  const c=createPublicUiPolicyController({document,getAccount:()=>account,hasSession:()=>hasSession,apiGet:()=>new Promise(r=>resolve=r),events:{}});
  const pending=c.refresh();hasSession=true;c.updateAccount();resolve(policy(true));await pending;assert.equal(c.enabled(),false);assert.equal(c.decision().status,'pending');
  account={id:'fixture'};c.updateAccount();account={id:'fixture'};c.updateAccount();assert.equal(c.decision().status,'pending');c.dispose();
});
test('account presentation does not become OFF on visibility or same-owner object replacement',async()=>{
  const document=dom();let account={id:'fixture'},enabled=true,fail=false;
  const response=()=>({snapshot:{schema_version:1,account_id:account.id,channel:'stable',channel_revision:1,max_age_seconds:30,expires_at:new Date(Date.now()+30000).toISOString(),flags:{p07_accessibility:{enabled,revision:1,reason:enabled?'enabled':'kill_switch'}}}});
  const c=createFeatureController({document,getAccount:()=>account,apiGet:async()=>{if(fail)throw Error('fixture failure');return response();}});
  c.setAvailable(true);c.updateAccount();await c.refresh();assert.equal(c.decision('p07_accessibility').status,'enabled');
  document.hidden=true;document.emit('visibilitychange');assert.equal(c.enabled('p07_accessibility'),false);assert.equal(c.decision('p07_accessibility').status,'enabled');
  account={id:'fixture'};c.updateAccount();assert.equal(c.decision('p07_accessibility').status,'enabled');
  document.hidden=false;enabled=false;await c.refresh();assert.equal(c.decision('p07_accessibility').status,'disabled');
  fail=true;await c.refresh();assert.equal(c.decision('p07_accessibility').status,'error');c.setAvailable(false);
});
