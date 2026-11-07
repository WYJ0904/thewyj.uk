import assert from 'node:assert/strict';
import test from 'node:test';
import {completeStartupSplash} from '../../js/core/startup.js';
function fixture(){const timers=[],events=[],screen={classList:{add:value=>events.push(value)},setAttribute:(k,v)=>events.push([k,v]),remove:()=>events.push('removed')};return{timers,events,screen,setTimer:(fn,ms)=>timers.push({fn,ms})};}
test('startup completes without any delivered animation frame and keeps original durations',async()=>{
  const f=fixture(),done=completeStartupSplash({...f,reveal:()=>f.events.push('revealed')});
  assert.equal(f.timers[0].ms,450);f.timers.shift().fn();assert.ok(f.events.includes('revealed'));
  assert.equal(f.timers[0].ms,180);f.timers.shift().fn();await done;assert.ok(f.events.includes('removed'));
});
test('reduced motion completes without a second timer or frame',async()=>{
  const f=fixture(),done=completeStartupSplash({...f,reducedMotion:true});assert.equal(f.timers[0].ms,0);
  f.timers.shift().fn();await done;assert.equal(f.timers.length,0);assert.ok(f.events.includes('removed'));
});
test('reveal failure removes the splash and propagates to recovery',async()=>{
  const f=fixture(),failure=Error('isolated reveal failure'),done=completeStartupSplash({...f,reveal:()=>{throw failure;}});
  const rejected=assert.rejects(done,error=>error===failure);f.timers.shift().fn();f.timers.shift().fn();await rejected;assert.ok(f.events.includes('removed'));
});
test('already removed splash still performs route reveal once',async()=>{
  let calls=0;await completeStartupSplash({reveal:()=>calls++});assert.equal(calls,1);
});
