import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {openPage} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8938';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9256',baseUrl,width:390,height:900,mobile:true});
try{
 await p.navigate('/');await p.waitFor("!document.getElementById('entryScreen')");
 const r=await p.evaluate(`(async()=>{
  const {reconcileKeyedRows}=await import('/js/core/keyed-list.js?v=20261009-task25-release49');
  const {createParkedRows,rowRenderRoot}=await import('/js/core/parked-rows.js?v=20261009-task25-release49');
  const root=document.createElement('div');root.id='p6-owned-render-fixture';document.body.append(root);
  const options={key:x=>x.id,signature:x=>x.label,render:x=>'<article data-p6-id="'+x.id+'"><input value="baseline">'+x.label+'</article>',empty:'<p data-p6-empty>empty</p>'};
  const rows=[{id:'one',label:'one'},{id:'two',label:'two'},{id:'three',label:'three'}];
  reconcileKeyedRows(root,rows,options);const original=[...root.children];original[0].querySelector('input').value='0.01';
  const parked=createParkedRows(()=>root);parked.park();reconcileKeyedRows(root,rows,options);const hiddenCount=root.children.length;parked.resume();
  const identityRetained=original.every((e,i)=>e===root.children[i]),firstCount=root.children.length,draft=root.querySelector('input').value;
  parked.park();reconcileKeyedRows(root,[rows[0],rows[2]],options);const hiddenUpdateCount=root.children.length;parked.resume();
  const terminalCount=root.children.length,removedAbsent=!root.querySelector('[data-p6-id=two]'),uniqueCount=new Set([...root.children].map(e=>e.dataset.p6Id)).size;
  parked.park();reconcileKeyedRows(root,[],options);parked.resume();const emptyOnly=root.children.length===1&&!!root.querySelector('[data-p6-empty]');
  reconcileKeyedRows(root,rows,options);parked.park();parked.clear();reconcileKeyedRows(root,[{id:'new-account',label:'new'}],options);parked.resume();
  const clearedOwner=root.children.length===1&&root.firstElementChild.dataset.p6Id==='new-account'&&rowRenderRoot(root)===root;
  root.remove();return{hiddenCount,firstCount,identityRetained,draft,hiddenUpdateCount,terminalCount,removedAbsent,uniqueCount,emptyOnly,clearedOwner};
 })()`);
 assert.deepEqual(r,{hiddenCount:0,firstCount:3,identityRetained:true,draft:'0.01',hiddenUpdateCount:0,terminalCount:2,removedAbsent:true,uniqueCount:2,emptyOnly:true,clearedOwner:true});
 const nativeMotion=await p.evaluate(`(async()=>{const m=await import('/js/core/motion.js?v=20261009-task25-release49');document.documentElement.dataset.androidReducedMotion='true';const duration=m.motionDuration('expand',window),style=getComputedStyle(document.querySelector('#themeToggleBtn'));const short=style.transitionDuration.split(',').every(v=>parseFloat(v)<=.002);document.documentElement.dataset.androidReducedMotion='false';return{duration,short,normal:m.motionDuration('expand',window)}})()`);
 assert.deepEqual(nativeMotion,{duration:0,short:true,normal:200},'native reduced-motion fallback preserves browser media semantics');
 const out=path.resolve(process.env.AERIS_P6_ROWS_OUTPUT||'artifacts/aeris-p6/parked-row-regression.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2));console.log('P6 parked background render, exact identities, drafts, terminal removal, empty and account clear PASS');
}finally{await p.close();}
