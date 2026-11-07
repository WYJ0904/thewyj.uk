// Extends the fixed P07-F/Chrome infrastructure; no disabled axe rules or node exclusions.
import {assert,fs,path,base,out,api,fixtures,page,pointer,session,recorder} from '../p07-r5/harness.mjs';
const reference=JSON.parse(await fs.readFile(new URL('../../docs/p07/evidence/f-a11y/BASELINE-GEOMETRY.json',import.meta.url),'utf8'));
const fixtureNames=reference.matrix.find(x=>x.name==='Admin').headings.map(h=>h.text).filter(t=>/^r5owner[AB]/.test(t));
const {admin,A}=await fixtures({usernames:fixtureNames}),p=await page(),r=recorder(p,'f-closeout-cases.json');
const baselineMode=process.env.P07_F_BASELINE==='1',axe=await fs.readFile(new URL('./vendor/axe.min.js',import.meta.url),'utf8');
const matrix=[],scans=[],styles={};
const visible=id=>`document.getElementById(${JSON.stringify(id)})?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})`;
async function key(key,code=key){for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:key==='Tab'?9:key==='Escape'?27:key==='Enter'?13:key===' '?32:0,...(key===' '&&type==='keyDown'?{text:' '}:{} )});}
async function theme(value){for(let i=0;i<3&&await p.evaluate('document.documentElement.dataset.themePreference')!==value;i++)await pointer(p,'#themeToggleBtn');await p.waitFor(`document.documentElement.dataset.theme===${JSON.stringify(value)}`,5000);}
async function shot(name){const result=await p.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(result.data,'base64'));return name+'.png';}
async function scan(name){await p.evaluate(axe);const result=await p.evaluate(`axe.run(document).then(x=>({violations:x.violations,incomplete:x.incomplete,passes:x.passes.map(p=>p.id),inapplicable:x.inapplicable.map(p=>p.id)}))`);scans.push({name,...result});await fs.writeFile(path.join(out,'f-full-axe.json'),JSON.stringify({source:process.env.P07_D_TARGET_HEAD,scope:'whole document, all default axe rules, no excludes',version:await p.evaluate('axe.version'),scans},null,2));return result;}
async function member(route){await p.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});await session(p,A.session,route);await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'",15000);}
async function ax(selector){const {root}=await p.send('DOM.getDocument');const {nodeId}=await p.send('DOM.querySelector',{nodeId:root.nodeId,selector});return(await p.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false})).nodes.map(n=>({ignored:n.ignored,role:n.role?.value,name:n.name?.value,description:n.description?.value}));}
const routes=[['Guest','/','publicHome',null],['Login','/login','authPanel',null],['Register','/register','authPanel',null],['LanguagePicker','/language','projectPicker',A],['English','/language/english','workspace',A],['Japanese','/language/japanese','workspace',A],['Finance','/finance','financePage',A],['Membership','/recharge','membershipModal',A],['Account','/account','accountModal',A],['Workflows','/tools/workflows','workflowWorkspace',A],['Transfer','/transfer','transferPage',A],['Admin','/admin','adminPanel',admin]];
const titleSelectors=['#authTitle','#membershipTitle','#accountTitle','#accountProfileUsername','.account-sync-title','.account-section-subtitle','#releaseChannelSection > :is(h2,h3)','#changeSecretForm > :is(h2,h3)','#membershipPlanHeading','#workflowWorkspace > header :is(h1,h2)','.workflow-sidebar-heading :is(h2,h3)','.workflow-template-box > :is(h2,h3)','#workflowEmptyState > :is(h2,h3)','#aiSuggestTitle','.admin-user-identity > :is(h2,h3)'];
try{
  await r.check('whole-document-axe-and-layout-matrix',async()=>{
    await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const [name,route,id,owner] of routes){
      await p.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
      if(owner)await session(p,owner.session,route);else{await p.navigate('/');await p.evaluate("localStorage.removeItem('wyjAccountSession');true");await p.navigate(route);}
      await p.waitFor(visible(id),15000);
      if(name==='Workflows')await p.waitFor("Boolean(document.querySelector('[data-workflow-template=\"text-clean\"]'))",10000);
      if(name==='Admin')await p.waitFor("document.getElementById('adminPanel').getAttribute('aria-busy')==='false'",15000);
      for(const width of [375,390,768,1024,1440]){
        await p.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:width<500});
        for(const mode of ['light','dark']){
          await theme(mode);await p.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
          const k=`${name}-${width}-${mode}`,row=await p.evaluate(`(()=>{const e=document.getElementById('${id}'),b=e.getBoundingClientRect();return{url:location.href,clientWidth:document.documentElement.clientWidth,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,visible:e.checkVisibility(),rect:{left:b.left,right:b.right,width:b.width,height:b.height},reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,headings:[...e.querySelectorAll('h1,h2,h3,h4')].filter(x=>x.checkVisibility()).map(x=>({tag:x.tagName,id:x.id,text:x.textContent.trim()}))}})()`);
          const typography=await p.evaluate(`(()=>{const result={};for(const selector of ${JSON.stringify(titleSelectors)}){const e=document.querySelector(selector);if(!e?.checkVisibility())continue;const s=getComputedStyle(e),b=e.getBoundingClientRect();result[selector]={fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,marginTop:s.marginTop,marginBottom:s.marginBottom,height:b.height,width:b.width}}return result})()`);styles[k]=typography;matrix.push({name,width,theme:mode,...row});
          if(name==='Account'||name==='Membership'){
            row.contrasts=await p.evaluate(`(()=>{const selectors=${JSON.stringify(['#accountSyncBadge','#membershipModal .membership-warning','#membershipModal .danger-note'])},parse=v=>(v.match(/[\\d.]+/g)||[]).slice(0,3).map(Number),lum=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);return selectors.map(selector=>{const e=document.querySelector(selector);if(!e?.checkVisibility())return null;const s=getComputedStyle(e),a=lum(parse(s.color)),b=lum(parse(s.backgroundColor));return{selector,color:s.color,background:s.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}}).filter(Boolean)})()`);
            matrix.at(-1).contrasts=row.contrasts;if(!baselineMode)assert.ok(row.contrasts.every(c=>c.ratio>=4.5),k+' actual contrast below 4.5:1 '+JSON.stringify(row.contrasts));
          }
          assert.ok(row.visible);assert.ok(row.scrollWidth<=row.clientWidth+1,k+' horizontal overflow');assert.ok(row.rect.left>=-1&&row.rect.right<=row.clientWidth+1,k+' clipped workspace');if(width<500)assert.equal(row.viewport,width);assert.equal(row.reducedMotion,true);
          if([375,1440].includes(width)){const result=await scan(k);if(!baselineMode&&result.violations.length)r.note('whole-document-axe-and-layout-matrix',{newViolations:result.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),name:k});}
          if(['Login','Account','Membership','Workflows'].includes(name)&&[375,1440].includes(width))await shot('F-'+k);
        }
      }
    }
    await fs.writeFile(path.join(out,'f-geometry.json'),JSON.stringify({source:process.env.P07_D_TARGET_HEAD,matrix,styles},null,2));
    const failures=scans.flatMap(x=>x.violations.map(v=>({sample:x.name,id:v.id,impact:v.impact,nodes:v.nodes.length})));
    assert.equal(failures.length,0,'full axe violations: '+JSON.stringify(failures));return{scans:scans.length,layoutSamples:matrix.length};
  });
  if(!baselineMode){
    await r.check('preview-notice-retains-a-legal-live-status-role',async()=>{
      await p.navigate('/');await p.evaluate("document.getElementById('aerisPreviewNotice').hidden=false;true");
      const result=await scan('preview-banner-explicit-local-visibility-fixture');assert.equal(result.violations.length,0);
      return{fixture:'existing Preview notice revealed locally; no Hosted environment changes',screenshot:await shot('preview-notice-status')};
    });
    await r.check('visual-typography-remains-equivalent',async()=>{
      const before=JSON.parse(await fs.readFile(process.env.P07_F_GEOMETRY_BASELINE||new URL('../../docs/p07/evidence/f-a11y/BASELINE-GEOMETRY.json',import.meta.url),'utf8'));const differences=[];
      for(const [name,old] of Object.entries(before.styles)){for(const [selector,expected] of Object.entries(old)){const actual=styles[name]?.[selector];if(!actual){differences.push({name,selector,missing:true});continue;}for(const field of ['fontSize','fontWeight','lineHeight','letterSpacing','marginTop','marginBottom','height','width'])if(typeof expected[field]==='number'?Math.abs(expected[field]-actual[field])>1:expected[field]!==actual[field])differences.push({name,selector,field,before:expected[field],after:actual[field]});}}
      r.note('visual-typography-remains-equivalent',differences);assert.deepEqual(differences,[]);return{comparedSamples:Object.keys(before.styles).length};
    });
    await r.check('auth-tabs-have-native-forms-in-associated-panels',async()=>{
      await p.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});await p.navigate('/');await p.evaluate("localStorage.removeItem('wyjAccountSession');true");await p.navigate('/login');await p.waitFor(visible('loginForm'),10000);
      const rows=[];for(const [button,panel,form] of [['showLoginBtn','loginTabPanel','loginForm'],['showRegisterBtn','registerTabPanel','registerForm'],['showLoginBtn','loginTabPanel','loginForm']]){await pointer(p,'#'+button);const s=await p.evaluate(`(()=>{const b=document.getElementById('${button}'),p=document.getElementById('${panel}'),f=document.getElementById('${form}');return{controls:b.getAttribute('aria-controls'),role:p?.getAttribute('role'),labelled:p?.getAttribute('aria-labelledby'),formRole:f.getAttribute('role'),visible:p?.checkVisibility(),selected:b.getAttribute('aria-selected')}})()`);rows.push(s);assert.equal(s.controls,panel);assert.equal(s.role,'tabpanel');assert.equal(s.labelled,button);assert.equal(s.formRole,null);assert.equal(s.visible,true);assert.equal(s.selected,'true');}return rows;
    });
    await r.check('learning-live-status-and-account-feedback',async()=>{
      await member('/language/english');const before=await p.evaluate("({role:document.getElementById('statusDot').getAttribute('role'),description:document.getElementById('statusDot').getAttribute('aria-describedby'),live:document.getElementById('modelLabel').getAttribute('aria-live'),text:document.getElementById('modelLabel').textContent})");assert.equal(before.role,'status');assert.equal(before.description,'modelLabel');assert.equal(before.live,'polite');let offline;
      try{await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await p.waitFor("document.getElementById('modelLabel').textContent==='离线模式'",5000);offline=await p.evaluate("({text:document.getElementById('modelLabel').textContent,online:document.getElementById('statusDot').classList.contains('online')})");assert.equal(offline.online,false);}
      finally{await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
      await p.waitFor("document.getElementById('statusDot').classList.contains('online')",15000);await p.navigate('/account');await p.waitFor(visible('accountModal'),10000);const account=await p.evaluate("({badge:document.getElementById('accountSyncBadge').textContent,description:document.getElementById('accountSyncStatus').textContent})");assert.equal(account.badge,'正常');assert.ok(account.description.includes('Cloudflare D1'));return{before,offline,account};
    });
    await r.check('keyboard-focus-and-real-workflow-import-execution',async()=>{
      await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await member('/tools/workflows');await p.waitFor("Boolean(document.querySelector('[data-workflow-template=\"text-clean\"]'))",10000);
      // Trusted Tab events must reach the existing input; it is not removed from keyboard order.
      await p.evaluate("document.getElementById('importWorkflowBtn').focus();true");await key('Tab');
      const focus=await p.evaluate("(()=>{const e=document.activeElement,r=document.querySelector('.workflow-import-row'),s=getComputedStyle(r);return{id:e.id,name:e.getAttribute('aria-labelledby'),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,visible:r.checkVisibility()}})()");assert.equal(focus.id,'workflowImportInput');assert.equal(focus.name,'importWorkflowBtn');assert.ok(focus.visible&&focus.outlineStyle!=='none'&&parseFloat(focus.outlineWidth)>=2);
      focus.accessibilityTree=await ax('#workflowImportInput');assert.ok(focus.accessibilityTree.some(n=>!n.ignored&&n.name==='导入 JSON'));focus.normalMotion=await p.evaluate("!matchMedia('(prefers-reduced-motion:reduce)').matches");assert.equal(focus.normalMotion,true);
      const file=path.join(out,'a11y-workflow-import.json'),date=new Date().toISOString();await fs.writeFile(file,JSON.stringify({schema_version:1,id:'wf_a11yimport',name:'A11y 实际导入',created_at:date,updated_at:date,steps:[{id:'step_a11yempty',tool_id:'remove-empty-lines',enabled:true,config:{}},{id:'step_a11ydedupe',tool_id:'dedupe-lines',enabled:true,config:{}}]}));
      await p.send('Page.setInterceptFileChooserDialog',{enabled:true});let chooserResolve;const chooser=new Promise(resolve=>chooserResolve=resolve);const listener=message=>{if(message.method==='Page.fileChooserOpened')chooserResolve(message.params);};p.client.listeners.add(listener);let chooserInfo;try{await key(' ','Space');chooserInfo=await Promise.race([chooser,new Promise((_,reject)=>setTimeout(()=>reject(Error('keyboard did not open the native file chooser')),5000))]);await p.setFile('#workflowImportInput',file);}finally{p.client.listeners.delete(listener);await p.send('Page.setInterceptFileChooserDialog',{enabled:false});}assert.ok(chooserInfo.backendNodeId);focus.chooserOpened=true;focus.screenshot=await shot('workflow-file-input-keyboard-focus');await p.waitFor("document.getElementById('workflowSaveState').textContent.includes('导入成功')",10000);await p.setFields({'#workflowTextInput':'alpha\n\nbeta\nalpha'});await pointer(p,'#runWorkflowBtn');await p.waitFor("document.getElementById('workflowRunState').dataset.status==='success'",15000);assert.equal(await p.evaluate("document.getElementById('workflowResultText').value.trim()"),'alpha\nbeta');const after=await scan('workflow-after-real-import-and-run');assert.equal(after.violations.length,0);return{focus,result:'alpha\nbeta',screenshot:await shot('workflow-import-executed')};
    });
    await r.check('modal-tab-trap-focus-visible-and-restoration',async()=>{
      await member('/account');await p.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await pointer(p,'#openDeleteAccountBtn');await p.waitFor(visible('deleteAccountModal'),5000);const stops=[];
      for(let i=0;i<8;i++){await key('Tab');stops.push(await p.evaluate("(()=>{const e=document.activeElement,s=getComputedStyle(e);return{id:e.id,inside:document.getElementById('deleteAccountModal').contains(e),visible:e.checkVisibility(),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth}})()"));}assert.ok(stops.every(x=>x.inside&&x.visible&&x.outlineStyle!=='none'&&parseFloat(x.outlineWidth)>0));const screenshot=await shot('modal-keyboard-focus');await key('Escape');await p.waitFor("!document.getElementById('appShell').inert&&document.activeElement.id==='openDeleteAccountBtn'",5000);return{stops,screenshot,restoredFocus:true,deletionSubmitted:false};
    });
  }
}finally{await fs.writeFile(path.join(out,'f-geometry.json'),JSON.stringify({source:process.env.P07_D_TARGET_HEAD,matrix,styles},null,2));await p.close();r.finish();}
