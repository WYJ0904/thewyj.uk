import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';
const base=new URL(process.env.WYJ_TEST_BASE).origin,out=process.env.P07_D_EVIDENCE;
assert.equal(new URL(base).hostname,'127.0.0.1');
async function api(route,body=null,token=''){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
const login=await api('/api/login',{username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET});assert.equal(login.status,200);
const username='r4ce'+randomBytes(4).toString('hex'),secret=randomBytes(24).toString('base64url');
assert.equal((await api('/api/register',{username,secret,confirm_secret:secret})).status,201);
const member=await api('/api/login',{username,secret});assert.equal(member.status,200);
const permissions={anonymous:(await api('/api/admin/users')).status,member:(await api('/api/admin/users',null,member.data.session)).status,admin:(await api('/api/admin/users',null,login.data.session)).status};
assert.deepEqual(permissions,{anonymous:401,member:403,admin:200});
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:base,width:1440,height:960,mobile:false}),results=[];
await p.navigate('/login');await p.waitFor("!document.getElementById('entryScreen')");await p.evaluate(`localStorage.setItem('wyjAccountSession',${JSON.stringify(login.data.session)});true`);
const pending=[{id:'r4c-candidate-hint',kind:'hint',event_id:'r4c-event-hint',event_ids:['r4c-event-hint'],state:'pending',amount_minor:1234,direction:null,merchant:'R4C synthetic fixture',occurred_at_ms:Date.now(),source_package:'com.tencent.mm',app_label:'微信',recognition_reasons:['wechat_amount_without_direction']}];
await p.intercept([{match:'/api/notification/pending-summary',respond:()=>({body:{ok:true,records:pending,total_count:pending.length,truncated:false}})}]);
async function pointer(selector){await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const point=await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,hit:Boolean(h&&(h===e||e.contains(h))),inert:Boolean(e.closest('[inert]'))}})()`);assert.equal(point.hit,true,selector+' is covered');assert.equal(point.inert,false);for(const type of ['mousePressed','mouseReleased'])await p.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});return point;}
async function theme(value){for(let i=0;i<3&&await p.evaluate('document.documentElement.dataset.themePreference')!==value;i++)await pointer('#themeToggleBtn');await p.waitFor(`document.documentElement.dataset.theme===${JSON.stringify(value)}`);}
try{
  for(const [route,id] of [['/transfer','transferPage'],['/tools/workflows','workflowWorkspace'],['/admin','adminPanel'],['/finance','financePage']]){
    await p.navigate(route);await p.waitFor(`!document.getElementById('entryScreen')&&document.documentElement.dataset.interfacePolicy==='enabled'&&document.getElementById(${JSON.stringify(id)}).checkVisibility()`,15000);
    if(route==='/tools/workflows'){
      // R5 reveals the workflow surface before its lazy module is ready.
      // Keep the execution/geometry assertions, but wait for the real control.
      await p.waitFor("Boolean(document.querySelector('[data-workflow-template=\"text-clean\"]'))&&document.querySelector('[data-workflow-template=\"text-clean\"]').checkVisibility()",10000,'workflow template module ready');
      await pointer('[data-workflow-template="text-clean"]');const input=path.join(out,'workflow-input.txt');await fs.writeFile(input,'alpha\nbeta\nalpha\n');await p.setFile('#workflowFileInput',input);
      await pointer('#runWorkflowBtn');await p.waitFor("document.getElementById('workflowRunState').dataset.status==='success'",15000);assert.equal(await p.evaluate("document.getElementById('workflowResultText').value.trim()"),'alpha\nbeta');
      assert.equal(await p.evaluate("document.querySelector('#toolsPanel > .tools-header').checkVisibility()"),false,'duplicate toolbox header remains above workflow editor');
    }
    if(route==='/admin'){
      await p.waitFor("document.getElementById('adminPanel').getAttribute('aria-busy')==='false'",15000);await pointer('[data-admin-view="adminFeatureFlagsView"]');
      await p.waitFor("document.getElementById('adminFeatureFlagsView').classList.contains('active')",5000);assert.equal(await p.evaluate("document.getElementById('featureFlagKillSwitch').disabled"),false);
    }
    if(route==='/finance'){
      await p.waitFor("document.querySelector('[data-finance-candidate=\"r4c-candidate-hint\"]')",15000);await p.evaluate("document.getElementById('financeCandidatesSection').open=true;true");
      await pointer('[data-finance-candidate-edit="r4c-candidate-hint"]');await p.waitFor("document.querySelector('[data-finance-candidate-editor=\"r4c-candidate-hint\"]').checkVisibility()",5000);
      await pointer('[data-finance-candidate-cancel="r4c-candidate-hint"]');assert.equal(await p.evaluate("document.querySelector('[data-finance-candidate-editor=\"r4c-candidate-hint\"]').checkVisibility()"),false);
    }
    for(const width of [375,390,1024,1440]){
      await p.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width<400});
      for(const mode of ['light','dark']){
        await theme(mode);await p.evaluate('document.fonts.ready.then(()=>true)');
        const layout=await p.evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)}),r=el.getBoundingClientRect();return{viewport:document.documentElement.clientWidth,layoutViewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,visible:el.checkVisibility(),rect:{left:r.left,right:r.right,width:r.width},policy:document.documentElement.dataset.interfacePolicy,transferColumns:document.getElementById('transferPage')?.checkVisibility()?getComputedStyle(document.getElementById('transferPage')).gridTemplateColumns:null,workflowColumns:document.querySelector('.workflow-layout')?.checkVisibility()?getComputedStyle(document.querySelector('.workflow-layout')).gridTemplateColumns:null}})()`);
        assert.ok(layout.visible&&layout.rect.width>0);if(width<400)assert.equal(layout.layoutViewport,width,'mobile layout viewport must not expand to fit overflow');assert.equal(layout.policy,'enabled');assert.ok(layout.scrollWidth<=layout.viewport+1,JSON.stringify({route,width,mode,layout}));assert.ok(layout.rect.left>=0&&layout.rect.right<=layout.viewport+1,JSON.stringify({route,width,mode,layout}));
        if(route==='/transfer'&&width>=1024)assert.equal(layout.transferColumns.split(' ').length,2,'transfer auxiliary panel must have a real second column');
        const screenshot=`E-${id}-${width}-${mode}.png`,shot=await p.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,screenshot),Buffer.from(shot.data,'base64'));
        results.push({route,width,theme:mode,layout,screenshot});
      }
    }
  }
  assert.deepEqual(p.runtimeErrors,[]);
}finally{await fs.writeFile(path.join(out,'e-workspaces.json'),JSON.stringify({source:process.env.P07_D_TARGET_HEAD,permissions,results,scope:'Actual authorized local pages; pending-summary fixture goes through existing candidate controller; no AI/OCR or ledger confirmation',runtimeErrors:p.runtimeErrors},null,2));await p.close();}
console.log(JSON.stringify({checks:results.length,permissions,runtimeErrors:p.runtimeErrors}));
