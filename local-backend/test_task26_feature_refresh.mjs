import assert from 'node:assert/strict';
import { createFeatureController } from '../js/core/feature-flags.js';

const realNow = Date.now;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const realAddEventListener = globalThis.addEventListener;
let now = Date.UTC(2026,9,11), nextTimer=1;
const timers = new Map();
Date.now = () => now;
globalThis.setTimeout = (fn,delay) => { const id=nextTimer++;timers.set(id,{fn,delay});return id; };
globalThis.clearTimeout = id => timers.delete(id);
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
globalThis.addEventListener = () => {};
const document = {hidden:false,getElementById:()=>null,addEventListener:()=>{}};
const owner = {id:'task26-refresh-owner'};
const snapshot = () => ({schema_version:1,account_id:owner.id,channel:'experimental',channel_revision:1,
  observed_at:new Date(now).toISOString(),expires_at:new Date(now+30000).toISOString(),max_age_seconds:30,
  flags:{adaptive_learning:{enabled:true,reason:'user_override',revision:1},mastery_score:{enabled:true,reason:'user_override',revision:1}}});
const settle = async () => {for(let i=0;i<4;i++)await Promise.resolve();};
let resolveRefresh, rejectRefresh, pending=false, controller;
const transitions=[];
try {
 controller=createFeatureController({getAccount:()=>owner,document,api:async()=>{},
   apiGet:async()=>pending?new Promise((resolve,reject)=>{resolveRefresh=resolve;rejectRefresh=reject;}):{snapshot:snapshot()},
   onChange:()=>{if(controller)transitions.push(controller.enabled('adaptive_learning'));}});
 controller.setAvailable(true);controller.updateAccount();await settle();
 assert.equal(controller.enabled('adaptive_learning'),true);
 transitions.length=0;pending=true;
 const refresh=controller.refresh();
 assert.equal(controller.enabled('adaptive_learning'),true,'Refreshing must preserve the already-verified, unexpired decision while the new request is pending');
 assert.equal(transitions.includes(false),false,'A pending renewal must not disable/cancel an active Task26 practice request');
 resolveRefresh({snapshot:snapshot()});await refresh;
 console.log('PASS valid decision survives pending refresh without a false OFF transition');

 const expiring=controller.refresh();now+=30001;
 assert.equal(controller.enabled('adaptive_learning'),false,'An unconfirmed renewal must never extend the original grant past expiry');
 resolveRefresh({snapshot:{...snapshot(),expires_at:new Date(now-1).toISOString()}});await expiring;
 assert.equal(controller.enabled('adaptive_learning'),false);
 console.log('PASS expiration and expired renewal remain fail closed');

 pending=false;await controller.refresh();assert.equal(controller.enabled('adaptive_learning'),true);
 pending=true;const failed=controller.refresh();rejectRefresh(new Error('network unavailable'));await failed;
 assert.equal(controller.enabled('adaptive_learning'),false);
 console.log('PASS failed refresh clears authority');

 pending=false;await controller.refresh();pending=true;const wrongOwner=controller.refresh();
 resolveRefresh({snapshot:{...snapshot(),account_id:'another-owner'}});await wrongOwner;
 assert.equal(controller.enabled('adaptive_learning'),false);
 console.log('PASS cross-account response remains OFF');

 pending=false;await controller.refresh();
 assert.ok([...timers.values()].some(t=>t.delay>0&&t.delay<30000),'Refresh should be scheduled before expiry');
 assert.ok([...timers.values()].some(t=>t.delay===30000),'The original expiry fence must still exist');
 console.log('PASS renewal precedes expiry while retaining the expiry fence');

 document.hidden=true;await controller.refresh();assert.equal(controller.enabled('adaptive_learning'),false);
 console.log('PASS background page remains fail closed');
} finally {
 Date.now=realNow;globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;
 if(realNavigator)Object.defineProperty(globalThis,'navigator',realNavigator);else delete globalThis.navigator;
 globalThis.addEventListener=realAddEventListener;
}
