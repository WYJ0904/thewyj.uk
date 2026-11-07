import assert from 'node:assert/strict';
import test from 'node:test';
import {createFeatureController} from '../../js/core/feature-flags.js';
import {createPublicUiPolicyController} from '../../js/core/public-ui-policy.js';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function dom(){const events=new Map();return{hidden:false,getElementById:()=>null,addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k),emit:k=>events.get(k)?.()};}
test('hidden account renewal consumes authoritative OFF but cannot extend an expired lease or inherit another identity',async()=>{
  const document=dom(),originalNow=Date.now;let now=originalNow(),account={id:'owner-A'},calls=0,enabled=true;
  Date.now=()=>now;
  const response=()=>({snapshot:{schema_version:1,account_id:account.id,channel:'stable',channel_revision:1,max_age_seconds:30,expires_at:new Date(now+30000).toISOString(),flags:{p07_accessibility:{enabled,revision:1,reason:enabled?'enabled':'kill_switch'}}}});
  const c=createFeatureController({document,getAccount:()=>account,apiGet:async()=>{calls++;return response();}});
  try{c.setAvailable(true);c.updateAccount();await flush();assert.equal(c.decision('p07_accessibility').status,'enabled');
    document.hidden=true;document.emit('visibilitychange');assert.equal(c.enabled('p07_accessibility'),false);enabled=false;const before=calls;await c.refresh();assert.equal(calls,before+1);assert.equal(c.decision('p07_accessibility').status,'disabled');
    now+=30001;const expiredCalls=calls;await c.refresh();assert.equal(calls,expiredCalls,'expired hidden lease performed a renewal');assert.equal(c.decision('p07_accessibility').status,'pending');assert.equal(c.enabled('p07_accessibility'),false);
    account={id:'owner-B'};c.updateAccount();await flush();assert.equal(calls,expiredCalls);assert.equal(c.decision('p07_accessibility').status,'pending');
  }finally{c.setAvailable(false);Date.now=originalNow;}
});
test('hidden public renewal honors Kill and exact expiry, including authenticated suppression',async()=>{
  const document=dom();let now=Date.now(),calls=0,enabled=true,hasSession=false;
  const c=createPublicUiPolicyController({document,now:()=>now,getAccount:()=>null,hasSession:()=>hasSession,events:{},apiGet:async()=>{calls++;return{public_ui:{schema_version:1,flag_key:'p07_accessibility',enabled,revision:1,reason:enabled?'public_stable':'kill_switch',max_age_seconds:30,observed_at:new Date(now).toISOString(),expires_at:new Date(now+30000).toISOString()}};}});
  try{await c.refresh();document.hidden=true;document.emit('visibilitychange');const before=calls;enabled=false;await c.refresh();assert.equal(calls,before+1);assert.equal(c.decision().status,'disabled');assert.equal(c.enabled(),false);
    now+=30001;const expiredCalls=calls;await c.refresh();assert.equal(calls,expiredCalls);assert.equal(c.decision().status,'pending');hasSession=true;c.updateAccount();await c.refresh();assert.equal(calls,expiredCalls);assert.equal(c.enabled(),false);
  }finally{c.dispose();}
});
