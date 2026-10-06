import assert from 'node:assert/strict';
import {defaultHomeWidgets,sanitizeHomeWidgets,homeWidgetStorageKey,legacyHomeWidgetStorageKey,rotatedWidgetBox,layoutHomeWidgets,layoutMobileWidgets,widgetProfile,homeWidgetDragMoved,isHomeWidgetDesktop} from '../js/core/home-widgets.js';
import {projectHomeWidgets} from '../js/core/home-widget-data.js';
const defaults=defaultHomeWidgets();
assert.deepEqual(sanitizeHomeWidgets(null),defaults);
assert.deepEqual(sanitizeHomeWidgets({version:99,learning:{size:'large'}}),defaults,'future schema is never interpreted as current');
const clean=sanitizeHomeWidgets({version:1,learning:{size:'huge',rotation:99,x:-10,y:8,contentMode:'unsafe',amount:900},finance:{size:'large',rotation:-2.24,x:.5,y:.1,contentMode:'income'}});
assert.deepEqual(clean.learning.layouts.desktop,{size:'medium',rotation:6,x:0,y:1});assert.equal(clean.learning.contentMode,'latest');
assert.equal(clean.finance.layouts.desktop.rotation,-2);assert.equal(clean.finance.layouts.desktop.size,'large');assert.equal(clean.finance.contentMode,'income');
assert.deepEqual(clean.finance.layouts.mobile,defaults.finance.layouts.mobile,'migration must not derive mobile geometry from desktop');
assert.equal(sanitizeHomeWidgets({version:1,learning:{rotation:null,x:null}}).learning.layouts.desktop.rotation,2);
assert.notEqual(homeWidgetStorageKey('a'),legacyHomeWidgetStorageKey('a'));assert.equal(clean.version,2);
assert.notEqual(homeWidgetStorageKey('user:a'),homeWidgetStorageKey('user:b'));assert.notEqual(homeWidgetStorageKey(),homeWidgetStorageKey('a'));
assert.equal(isHomeWidgetDesktop(390),false);assert.equal(isHomeWidgetDesktop(980),false);assert.equal(isHomeWidgetDesktop(981),true);
assert.equal(isHomeWidgetDesktop(1040,390,true),false,'landscape phone retains mobile profile');assert.equal(isHomeWidgetDesktop(1040,390,false),true);
assert.equal(homeWidgetDragMoved(3,3),false);assert.equal(homeWidgetDragMoved(6,0),true);
const box=rotatedWidgetBox(286,236,-6);assert.ok(box.width>286&&box.height>236);
for(const stage of [{width:410,height:536},{width:540,height:536}])for(const rotation of [-6,2,6]) {
 const cfg=defaultHomeWidgets();for(const id of ['learning','finance','tools'])Object.assign(cfg[id].layouts.desktop,{x:1,y:1,rotation});
 const sizes={learning:{width:286,height:236},finance:{width:218,height:144},tools:{width:254,height:180}},layout=layoutHomeWidgets(widgetProfile(cfg,'desktop'),stage,sizes,'learning');
 for(const {box:b}of Object.values(layout)){assert.ok(b.x>=11.99&&b.y>=11.99);assert.ok(b.x+b.width<=stage.width-11.99);assert.ok(b.y+b.height<=stage.height-11.99);}
 for(const a of Object.values(layout))for(const b of Object.values(layout))if(a!==b){const intersection=Math.max(0,Math.min(a.box.x+a.box.width,b.box.x+b.box.width)-Math.max(a.box.x,b.box.x))*Math.max(0,Math.min(a.box.y+a.box.height,b.box.y+b.box.height)-Math.max(a.box.y,b.box.y));assert.ok(intersection<Math.min(a.box.width*a.box.height,b.box.width*b.box.height)*.99,'no card is completely obscured');}
}
for(const viewport of [160,195,360,390,412,430,844,1040])for(const size of ['small','medium','large'])for(const rotation of [-6,-2,0,2,6])for(const x of [0,1]){
 const cfg=defaultHomeWidgets(),before=JSON.stringify(widgetProfile(cfg,'desktop'));
 for(const id of ['learning','finance','tools'])Object.assign(cfg[id].layouts.mobile,{size,rotation,x,y:1});
 const stage=viewport-32,layout=layoutMobileWidgets(widgetProfile(cfg,'mobile'),stage);
 for(const item of Object.values(layout)){assert.ok(item.box.x>=0&&item.box.y>=0);assert.ok(item.box.x+item.box.width<=stage+.001);assert.ok(item.box.y+item.box.height<=item.slotHeight+.001);assert.ok(item.width>0);}
 assert.equal(JSON.stringify(widgetProfile(cfg,'desktop')),before,'mobile edits never mutate desktop');
}
const isolated=defaultHomeWidgets(),mobileBefore=JSON.stringify(widgetProfile(isolated,'mobile'));Object.assign(isolated.learning.layouts.desktop,{size:'large',rotation:-6,x:1,y:1});assert.equal(JSON.stringify(widgetProfile(isolated,'mobile')),mobileBefore);
const now=new Date('2026-10-06T12:00:00Z'),record={id:'fixture-only',language:'japanese',finishedAt:now.toISOString(),total:6,accuracy:83};
const input={records:[record],wrongCount:35,streak:3,finance:{balance_minor:1,income_minor:2,expense_minor:1,count:1,last_sync_at:now.toISOString()},financeKnown:true,tools:{recent:[{tool_id:'json-format',name:'JSON',used_at:now.toISOString()}],favorites:[]},money:x=>'¥ '+(x/100).toFixed(2),language:x=>x==='japanese'?'日语':x,now};
const ready=projectHomeWidgets(input);assert.equal(ready.learning.modes.latest.detail,'6 题 · 正确率 83%');assert.equal(ready.finance.modes.balance.value,'¥ 0.01');assert.equal(ready.tools.continuePath,'/tools/json-format');assert.equal(ready.activity.length,2);
assert.equal(projectHomeWidgets({...input,demo:true}).activity.length,0,'guest must not project authenticated records');
assert.equal(projectHomeWidgets({financeKnown:false}).finance.modes.balance.value,'尚未读取','unread owner must not fabricate zero balance');
assert.equal(projectHomeWidgets({online:false,financeKnown:false}).finance.modes.balance.state,'error');assert.equal(projectHomeWidgets({learningStatus:{status:'syncing'}}).learning.modes.latest.state,'loading');assert.equal(projectHomeWidgets({learningStatus:{status:'failed'}}).learning.modes.latest.state,'error');assert.equal(projectHomeWidgets().tools.modes.recent.state,'empty');
console.log('Home widget preferences, projection, bounds, states and account namespaces PASS');
