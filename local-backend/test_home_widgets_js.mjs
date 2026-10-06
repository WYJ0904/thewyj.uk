import assert from 'node:assert/strict';
import {defaultHomeWidgets,sanitizeHomeWidgets,homeWidgetStorageKey,rotatedWidgetBox,layoutHomeWidgets,homeWidgetDragMoved,isHomeWidgetDesktop} from '../js/core/home-widgets.js';
import {projectHomeWidgets} from '../js/core/home-widget-data.js';
const defaults=defaultHomeWidgets();
assert.deepEqual(sanitizeHomeWidgets(null),defaults);
assert.deepEqual(sanitizeHomeWidgets({version:2,learning:{size:'large'}}),defaults,'future schema is never interpreted as current');
const clean=sanitizeHomeWidgets({version:1,learning:{size:'huge',rotation:99,x:-10,y:8,contentMode:'unsafe',amount:900},finance:{size:'large',rotation:-2.24,x:.5,y:.1,contentMode:'income'}});
assert.deepEqual(clean.learning,{size:'medium',rotation:6,x:0,y:1,contentMode:'latest'});
assert.equal(clean.finance.rotation,-2);assert.equal(clean.finance.size,'large');assert.equal(clean.finance.contentMode,'income');
assert.equal(sanitizeHomeWidgets({version:1,learning:{rotation:null,x:null}}).learning.rotation,2);
assert.notEqual(homeWidgetStorageKey('user:a'),homeWidgetStorageKey('user:b'));assert.notEqual(homeWidgetStorageKey(),homeWidgetStorageKey('a'));
assert.equal(isHomeWidgetDesktop(390),false);assert.equal(isHomeWidgetDesktop(980),false);assert.equal(isHomeWidgetDesktop(981),true);
assert.equal(homeWidgetDragMoved(3,3),false);assert.equal(homeWidgetDragMoved(6,0),true);
const box=rotatedWidgetBox(286,236,-6);assert.ok(box.width>286&&box.height>236);
for(const stage of [{width:410,height:536},{width:540,height:536}])for(const rotation of [-6,2,6]) {
 const cfg=defaultHomeWidgets();for(const id of ['learning','finance','tools'])Object.assign(cfg[id],{x:1,y:1,rotation});
 const sizes={learning:{width:286,height:236},finance:{width:218,height:144},tools:{width:254,height:180}},layout=layoutHomeWidgets(cfg,stage,sizes,'learning');
 for(const {box:b}of Object.values(layout)){assert.ok(b.x>=11.99&&b.y>=11.99);assert.ok(b.x+b.width<=stage.width-11.99);assert.ok(b.y+b.height<=stage.height-11.99);}
 for(const a of Object.values(layout))for(const b of Object.values(layout))if(a!==b){const intersection=Math.max(0,Math.min(a.box.x+a.box.width,b.box.x+b.box.width)-Math.max(a.box.x,b.box.x))*Math.max(0,Math.min(a.box.y+a.box.height,b.box.y+b.box.height)-Math.max(a.box.y,b.box.y));assert.ok(intersection<Math.min(a.box.width*a.box.height,b.box.width*b.box.height)*.99,'no card is completely obscured');}
}
const now=new Date('2026-10-06T12:00:00Z'),record={id:'fixture-only',language:'japanese',finishedAt:now.toISOString(),total:6,accuracy:83};
const input={records:[record],wrongCount:35,streak:3,finance:{balance_minor:1,income_minor:2,expense_minor:1,count:1,last_sync_at:now.toISOString()},financeKnown:true,tools:{recent:[{tool_id:'json-format',name:'JSON',used_at:now.toISOString()}],favorites:[]},money:x=>'¥ '+(x/100).toFixed(2),language:x=>x==='japanese'?'日语':x,now};
const ready=projectHomeWidgets(input);assert.equal(ready.learning.modes.latest.detail,'6 题 · 正确率 83%');assert.equal(ready.finance.modes.balance.value,'¥ 0.01');assert.equal(ready.tools.continuePath,'/tools/json-format');assert.equal(ready.activity.length,2);
assert.equal(projectHomeWidgets({...input,demo:true}).activity.length,0,'guest must not project authenticated records');
assert.equal(projectHomeWidgets({financeKnown:false}).finance.modes.balance.value,'尚未读取','unread owner must not fabricate zero balance');
assert.equal(projectHomeWidgets({online:false,financeKnown:false}).finance.modes.balance.state,'error');assert.equal(projectHomeWidgets({learningStatus:{status:'syncing'}}).learning.modes.latest.state,'loading');assert.equal(projectHomeWidgets({learningStatus:{status:'failed'}}).learning.modes.latest.state,'error');assert.equal(projectHomeWidgets().tools.modes.recent.state,'empty');
console.log('Home widget preferences, projection, bounds, states and account namespaces PASS');
