import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const hosted=process.env.WYJ_TEST_BASE==='https://ac8cec2c.thewyj-p07-ui-rc.pages.dev'&&process.env.AERIS_OWNED_PREVIEW==='true';
assert(hosted||process.env.WYJ_TEST_BASE==='http://127.0.0.1:8898');
const out=path.join(root,'docs/migration-evidence/aeris-p03-p07',`spatial-motion-${Date.now()}`);await fs.mkdir(out);
const page=await openPage({baseUrl:process.env.WYJ_TEST_BASE,cdpUrl:process.env.WYJ_CDP_URL,width:1440,height:960});const checks=[];
const sample=(card='learning')=>page.send('Runtime.evaluate',{expression:`(()=>{const r=document.querySelector('[data-home-widget=${card}]'),v=r.querySelector('.home-widget-visual'),m=new DOMMatrix(getComputedStyle(v).transform),b=r.getBoundingClientRect();return {position:getComputedStyle(r).transform,dragging:r.dataset.dragging,editing:document.querySelector('.public-hero-scene').dataset.editing,layout:document.getElementById('publicHome').dataset.widgetLayout,coarse:matchMedia('(pointer:coarse)').matches,visual:{x:m.e,y:m.f,scale:m.a},rect:{x:b.x,y:b.y,width:b.width,height:b.height},animations:v.getAnimations().map(a=>({state:a.playState,iterations:a.effect.getTiming().iterations})),path:location.pathname};})()`,returnByValue:true,userGesture:false}).then(value=>value.result.value);
const move=async(x,y)=>page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,buttons:0});
const click=async selector=>{const p=await page.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});};
try{
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete globalThis.__WYJ_TEST_MODE__;'});
 if(process.env.AERIS_STABLE_HANDLE_PRESS==='1')await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='[data-widget-drag] {transform:none !important;scale:1 !important;opacity:1 !important;}';document.head.append(s);});`});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__spatialEvents=[];const save=e=>{if(window.__spatialEvents.length<100)window.__spatialEvents.push(e)};for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','gotpointercapture','pointermove'])document.addEventListener(type,e=>save({type,target:e.target?.dataset?.widgetDrag||e.target?.id,pointerId:e.pointerId,button:e.button,buttons:e.buttons,isPrimary:e.isPrimary,hasCapture:e.target?.hasPointerCapture?.(e.pointerId),connected:e.target?.isConnected,at:performance.now()}),true);window.addEventListener('resize',()=>save({type:'resize',width:innerWidth,height:innerHeight}));const remove=Element.prototype.removeAttribute;Element.prototype.removeAttribute=function(name){if(name==='data-dragging'&&this.dataset.homeWidget==='learning')save({type:'remove-dragging',stack:new Error().stack});return remove.call(this,name);};`});
 await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await page.navigate('/');await page.waitFor("!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && document.documentElement.dataset.p07Ui==='enabled' && document.querySelectorAll('.home-widget-visual').length===3",30000);
 await delay(450);await move(5,5);await delay(220);const before=await sample();
 await move(before.rect.x+before.rect.width/2,before.rect.y+before.rect.height/2);await delay(240);const hovered=await sample();
 assert.equal(hovered.position,before.position,'hover cannot replace coordinate/rotation transform');assert(hovered.visual.y < -3,'entry animation cannot retain the transform after finishing');
 checks.push({id:'hover-after-entry-retains-position-authority',status:'PASS',before,hovered});
 await click('#homeLayoutToggle');await page.waitFor("document.querySelector('.public-hero-scene').dataset.editing==='true'");
 await page.evaluate("document.querySelector('[data-widget-drag=learning]').scrollIntoView({block:'nearest',behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
 const handle=await page.evaluate("(()=>{const n=document.querySelector('[data-widget-drag=learning]'),r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!n.contains(document.elementFromPoint(x,y)))throw Error('Drag target must be visible');return{x,y};})()");
 await move(handle.x,handle.y);
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...handle,button:'left',buttons:1,clickCount:1});
 for(let i=1;i<=6;i++){await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+i*4,y:handle.y+i*2,button:'left',buttons:1});await delay(24);}
 await delay(240);const dragged=await sample();assert(dragged.visual.scale>1.005,'drag has its own visual lift '+JSON.stringify(dragged));
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+24,y:handle.y+12,button:'left',buttons:0,clickCount:1});await delay(260);const settled=await sample();
 assert(Math.abs(settled.visual.scale-1)<.003,'release settles the visual layer');assert.equal(settled.path,'/','drag release cannot navigate');
 checks.push({id:'drag-release-settles-without-navigation',status:'PASS',dragged,settled});
 const trials=[];
 for(let round=0;round<30;round++){
  const card=['learning','finance','tools'][round%3];
  await page.evaluate(`document.querySelector('[data-widget-drag=${card}]').scrollIntoView({block:'nearest',behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const point=await page.evaluate(`(()=>{const n=document.querySelector('[data-widget-drag=${card}]'),r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!n.contains(document.elementFromPoint(x,y)))throw Error('Repeated target occluded');return{x,y};})()`);
  const sign=round%2?-1:1;await move(point.x,point.y);await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+sign*12,y:point.y+sign*8,button:'left',buttons:1});await delay(220);const active=await sample(card);
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+sign*12,y:point.y+sign*8,button:'left',buttons:0,clickCount:1});await delay(220);const final=await sample(card);
  assert.equal(active.dragging,'true');assert(active.visual.scale>1.005);assert.equal(final.path,'/');assert(Math.abs(final.visual.scale-1)<.003);
  trials.push({round:round+1,card,status:'PASS',activeScale:active.visual.scale,finalScale:final.visual.scale});
 }
 checks.push({id:'thirty-controlled-gesture-repetitions',status:'PASS',trials,uniqueScenarioCount:1});
 for(let i=0;i<10;i++){await move(i%2?settled.rect.x+60:5,i%2?settled.rect.y+60:5);await delay(18);}const interrupted=await sample();assert(interrupted.animations.length<=2);assert(interrupted.animations.every(a=>a.iterations===1));
 checks.push({id:'repeated-hover-interrupts-without-animation-accumulation',status:'PASS',interrupted});
 await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await move(settled.rect.x+60,settled.rect.y+60);await delay(80);const reduced=await sample();assert.equal(reduced.animations.length,0);assert(Math.abs(reduced.visual.y)<.01);assert(Math.abs(reduced.visual.scale-1)<.003);
 checks.push({id:'browser-reduced-motion-keeps-visual-static',status:'PASS',reduced});
 await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await page.evaluate("document.documentElement.dataset.androidReducedMotion='true';true");await delay(80);const android=await sample();assert.equal(android.animations.length,0);assert(Math.abs(android.visual.y)<.01);
 checks.push({id:'native-reduced-motion-signal-component-contract',status:'PASS',android,physicalAndroidClaim:false});
 assert.deepEqual(page.runtimeErrors,[]);assert.deepEqual(page.dialogs,[]);
}catch(error){checks.push({id:'motion-failure',status:'FAIL',error:error.stack,events:await page.evaluate('window.__spatialEvents').catch(()=>[])});}
finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:1,button:'left',buttons:0,clickCount:1}).catch(()=>{});await page.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,origin:process.env.WYJ_TEST_BASE,controlledPressAnimationOverride:process.env.AERIS_STABLE_HANDLE_PRESS==='1',scope:(hosted?'Hosted owned Preview':'Local fixture')+' actual Chrome input; synthetic guest layout only; native preference is an explicit component control',pass:checks.filter(r=>r.status==='PASS').length,fail:checks.filter(r=>r.status==='FAIL').length},null,2));console.log(JSON.stringify({output:path.relative(root,out),checks:checks.map(r=>({id:r.id,status:r.status}))}));if(checks.some(r=>r.status==='FAIL'))process.exitCode=1;}
