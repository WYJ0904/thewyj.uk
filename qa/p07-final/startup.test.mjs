import assert from 'node:assert/strict';
import test from 'node:test';
import * as startup from '../../js/core/startup.js';
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(){const timers=[],events=[],screen={classList:{add:x=>events.push(x)},setAttribute:()=>{},remove:()=>events.push('removed')};return{screen,events,timers,setTimer(fn,ms){const t={fn,ms,active:true};timers.push(t);return t;},clearTimer:t=>{if(t)t.active=false;},fire(ms){const t=timers.find(t=>t.active&&t.ms===ms);assert.ok(t,'missing timer '+ms);t.active=false;t.fn();}};}
test('slow readiness exits to an explicit timeout recovery, never declares ready',async()=>{
  const f=fixture(),reasons=[];let resolve;const pending=new Promise(r=>resolve=r);
  const done=startup.completeStartupSplash({...f,whenReady:()=>pending,reveal:x=>reasons.push(x?.reason)});await flush();f.fire(450);assert.deepEqual(reasons,[]);f.fire(2500);assert.deepEqual(reasons,['timeout']);f.fire(180);await done;resolve();await flush();assert.deepEqual(reasons,['timeout']);assert.ok(f.events.includes('removed'));
});
test('ready route precedes reveal without requiring an animation frame',async()=>{
  const f=fixture(),reasons=[];let resolve;const pending=new Promise(r=>resolve=r),done=startup.completeStartupSplash({...f,whenReady:()=>pending,reveal:x=>reasons.push(x?.reason)});await flush();f.fire(450);resolve();await flush();assert.deepEqual(reasons,['ready']);f.fire(180);await done;
});
test('rejected preparation reveals a recoverable error and still removes Splash',async()=>{
  const f=fixture(),reasons=[],done=startup.completeStartupSplash({...f,whenReady:()=>Promise.reject(Error('isolated prep error')),reveal:x=>reasons.push(x?.reason)});await flush();f.fire(450);assert.deepEqual(reasons,['error']);f.fire(180);await done;
});
test('missing Splash does not bypass asynchronous readiness',async()=>{
  const f=fixture();let resolve,shown=false;const pending=new Promise(r=>resolve=r),done=startup.completeStartupSplash({...f,screen:null,whenReady:()=>pending,reveal:()=>shown=true});await flush();assert.equal(shown,false);f.fire(0);resolve();await flush();await done;assert.equal(shown,true);
});
test('verified identity and known policy are both required, including supported OFF/error fallback',()=>{
  assert.equal(typeof startup.canPresentWorkspace,'function');
  for(const policyStatus of ['enabled','disabled','error','pending'])assert.equal(startup.canPresentWorkspace({sessionPresent:true,accountVerified:false,policyStatus}),false);
  assert.equal(startup.canPresentWorkspace({sessionPresent:false,policyStatus:'pending'}),false);
  for(const policyStatus of ['enabled','disabled','error']){assert.equal(startup.canPresentWorkspace({sessionPresent:true,accountVerified:true,policyStatus}),true);assert.equal(startup.canPresentWorkspace({sessionPresent:false,policyStatus}),true);}
});
test('an old login cannot finish after the active identity changes',async()=>{
  assert.equal(typeof startup.waitForPresentation,'function');let listener,state={owner:'A',sessionPresent:true,accountVerified:true,policyStatus:'pending'};
  const pending=startup.waitForPresentation({read:()=>state,subscribe:fn=>{listener=fn;return()=>listener=null;},owner:'A',strictOwner:true});state={...state,owner:'B'};listener();await assert.rejects(pending,e=>e.name==='AbortError'&&e.code==='account_changed');assert.equal(listener,null);
});
