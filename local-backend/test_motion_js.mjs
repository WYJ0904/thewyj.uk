import assert from 'node:assert/strict';
import { installMotionSystem, pressedReleaseDelay, motionDuration } from '../js/core/motion.js';

function fixture(reduced=false){
 let time=0,id=0;const timers=new Map(),events=new Map(),windowEvents=new Map(),observers=[];
 const view={performance:{now:()=>time},matchMedia:()=>({matches:reduced}),setTimeout:(f,ms)=>{timers.set(++id,{f,at:time+ms});return id;},clearTimeout:n=>timers.delete(n),queueMicrotask:f=>f(),addEventListener:(type,f)=>windowEvents.set(type,f),removeEventListener:type=>windowEvents.delete(type),MutationObserver:class{constructor(f){observers.push(f)}observe(){}disconnect(){}}};
 const doc={defaultView:view,hidden:false,documentElement:{},querySelectorAll:()=>[],addEventListener:(type,f)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(f);},removeEventListener:(type,f)=>events.set(type,(events.get(type)||[]).filter(x=>x!==f))};
 const button={disabled:false,attributes:new Map(),closest(selector){return selector==='[inert]'||selector==='summary'||selector==="[role='tablist']"?null:this;},getAttribute(name){return this.attributes.get(name)??null},setAttribute(name,v){this.attributes.set(name,v)},removeAttribute(name){this.attributes.delete(name)}};
 const send=(type,extra={})=>{const e={target:button,button:0,isPrimary:true,pointerId:1,defaultPrevented:false,...extra};for(const f of events.get(type)||[])f(e);return e;};
 const advance=ms=>{time+=ms;for(const [n,t]of [...timers])if(t.at<=time){timers.delete(n);t.f();}};
 return{doc,view,button,events,windowEvents,observers,send,advance,timers};
}
assert.equal(pressedReleaseDelay(0,15),65);assert.equal(pressedReleaseDelay(20,10),80);assert.equal(pressedReleaseDelay(0,90),0);
assert.equal(motionDuration('sheet',{matchMedia:()=>({matches:true})}),0);

const f=fixture();const dispose=installMotionSystem(f.doc);assert.equal(installMotionSystem(f.doc),dispose);assert.equal(f.events.get('pointerdown').length,1);
f.send('pointerdown');assert.equal(f.button.getAttribute('data-aeris-pressed'),'true');
f.advance(10);f.send('pointerup');f.advance(69);assert.equal(f.button.getAttribute('data-aeris-pressed'),'true');f.advance(1);assert.equal(f.button.getAttribute('data-aeris-pressed'),null);
// A new input interrupts an old release; its timer cannot clear the new press.
f.send('pointerdown');f.advance(5);f.send('pointerup');f.advance(5);f.send('pointerdown');f.advance(80);assert.equal(f.button.getAttribute('data-aeris-pressed'),'true');f.send('pointercancel');assert.equal(f.button.getAttribute('data-aeris-pressed'),null);
f.button.disabled=true;f.send('pointerdown');assert.equal(f.button.getAttribute('data-aeris-pressed'),null);f.button.disabled=false;
f.send('keydown',{key:' ',repeat:false});assert.equal(f.button.getAttribute('data-aeris-pressed'),'true');f.send('keyup',{key:' '});f.advance(80);assert.equal(f.button.getAttribute('data-aeris-pressed'),null);
f.send('pointerdown');f.windowEvents.get('blur')();assert.equal(f.button.getAttribute('data-aeris-pressed'),null);dispose();assert.equal(f.events.get('pointerdown').length,0);

function disclosure(reduced=false,large=false){
 const f=fixture(reduced);const animations=[];const details={tagName:'DETAILS',open:false,isConnected:true,style:{height:'',overflow:''},querySelector:()=>summary,getBoundingClientRect:()=>({height:details.open?(large?2000:140):40}),animate(keys,options){let resolve,reject;const a={keys,options,finished:new Promise((r,j)=>{resolve=r;reject=j}),finish:()=>resolve(),cancel:()=>reject(new Error('cancel'))};animations.push(a);return a;}};
 let open=false;Object.defineProperty(details,'open',{get:()=>open,set:value=>{open=value;queueMicrotask(()=>f.observers.forEach(callback=>callback([{target:details}])));}});
 const summary={parentElement:details,attributes:new Map(),setAttribute(n,v){this.attributes.set(n,v)},getBoundingClientRect:()=>({height:40}),closest:s=>s==='summary'?summary:null};installMotionSystem(f.doc);const click=()=>f.send('click',{target:summary,preventDefault(){this.defaultPrevented=true}});return{...f,details,summary,animations,click};
}
const d=disclosure();d.click();assert.equal(d.details.open,true);d.click();assert.equal(d.summary.attributes.get('aria-expanded'),'false');d.click();assert.equal(d.summary.attributes.get('aria-expanded'),'true');d.animations.at(-1).finish();await Promise.resolve();assert.equal(d.details.open,true);
// A programmatic data-owner open supersedes an in-flight close.
d.click();d.observers[0]([{target:d.details}]);await Promise.resolve();assert.equal(d.details.open,true);assert.equal(d.summary.attributes.get('aria-expanded'),'true');
// A responsive/programmatic close is equally authoritative and stays closed.
d.details.open=false;await Promise.resolve();assert.equal(d.summary.attributes.get('aria-expanded'),'false');assert.equal(d.details.open,false);
const reduced=disclosure(true);reduced.click();assert.equal(reduced.details.open,true);reduced.click();assert.equal(reduced.details.open,false);assert.equal(reduced.animations.length,0);
const large=disclosure(false,true);large.click();assert.ok(large.animations.every(a=>a.keys.every(k=>!('height'in k))));
// Selection can be committed by an async owner after event dispatch. Only the
// tablist's aria-selected mutations schedule work, and layout geometry must not
// inherit pressed scale from getBoundingClientRect().
const t=fixture();let selected;const frames=new Map();let frameId=0;
t.view.requestAnimationFrame=callback=>{frames.set(++frameId,callback);return frameId;};t.view.cancelAnimationFrame=n=>frames.delete(n);
const group={isConnected:true,classList:{add(){},remove(){}},append(node){this.indicator=node;},getBoundingClientRect:()=>({left:500,width:200}),querySelector:()=>selected};
const tab=(left)=>({offsetLeft:left,offsetWidth:100,offsetParent:group,closest:()=>group,getBoundingClientRect:()=>({left:520+left,width:85})});
const login=tab(0),register=tab(100);selected=login;t.doc.querySelectorAll=()=>[group];t.doc.createElement=()=>({style:{},setAttribute(){},remove(){}});
const stopTabs=installMotionSystem(t.doc);assert.equal(group.indicator.style.transform,'translateX(0px)');assert.equal(group.indicator.style.width,'100px');
const flush=()=>{for(const [id,callback]of [...frames]){frames.delete(id);callback();}};
selected=register;t.observers[1]([{target:register}]);selected=login;t.observers[1]([{target:login}]);assert.equal(frames.size,1);flush();assert.equal(group.indicator.style.transform,'translateX(0px)');
selected=register;t.observers[1]([{target:register}]);flush();assert.equal(group.indicator.style.transform,'translateX(100px)');assert.equal(group.indicator.style.width,'100px');
t.observers[1]([{target:register}]);stopTabs();assert.equal(frames.size,0);
console.log('PASS motion: cancellation, short tap, keyboard, duplicate install, interruption, programmatic reopen, reduced motion and large disclosure');
