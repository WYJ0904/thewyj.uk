import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const results=[];
const previews={learning:['電話','でんわ','正确'],tools:['JSON 格式化','图片压缩','SHA-256','随机密码'],finance:['收入','支出','余额','日常餐饮','月预算','非真实数据'],share:['project-notes.pdf','24 小时','3 次','share/file','无实际上传'],account:['演示账户','演示已同步','语言学习','最近更新','非当前用户状态']};
const measure=`(()=>{const gallery=document.querySelector('.capability-gallery'),active=gallery.querySelector('.capability-panel.active'),preview=active.querySelector('.product-preview'),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,columns:getComputedStyle(gallery).gridTemplateColumns.split(' ').length,span:getComputedStyle(active).gridColumnStart,gallery:rect(gallery),active:rect(active),preview:rect(preview),clipped:[preview,...preview.querySelectorAll('*')].filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>e.className),border:getComputedStyle(active).borderTopWidth,selected:active.dataset.coreCapability,visibleBodies:[...gallery.querySelectorAll('.capability-body')].filter(e=>!e.hidden).length};})()`;
for(const width of [320,390,1366,1920]){
  const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:900,mobile:width<=390});
  try{
    await page.navigate('/');await page.waitFor("document.documentElement.dataset.aerisMotionReady==='true' && !document.getElementById('entryScreen')");
    assert.equal(await page.evaluate("document.querySelectorAll('.aeris-scene-grid,.aeris-capability-list,.aeris-capability-link,#publicSplitFlap').length"),0);
    const ids=await page.evaluate("[...document.querySelectorAll('[id]')].map(e=>e.id)");assert.equal(new Set(ids).size,ids.length);
    await page.evaluate("window.__p32Nodes=[...document.querySelectorAll('.capability-body')];true");
    for(const theme of ['light','dark']){
      await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const scene=await page.evaluate("[...document.querySelectorAll('.hero-scene-card')].map(e=>{const r=e.getBoundingClientRect();return {position:getComputedStyle(e).position,x:r.x,y:r.y,width:r.width,height:r.height,transform:getComputedStyle(e).transform};})");
      assert.equal(scene.length,3);assert.ok(scene.every(s=>s.position==='absolute'));
      if(width>980){assert.ok(scene.every(s=>s.x>width/2));assert.ok(new Set(scene.map(s=>Math.round(s.x))).size===3);assert.ok(new Set(scene.map(s=>Math.round(s.y))).size===3);assert.ok(scene.every(s=>s.transform!=='none'));}
      const cards=[];
      for(const [kind,content]of Object.entries(previews)){
        await page.click(`[data-core-capability=${kind}]>.capability-trigger`);await delay(180);
        const text=await page.evaluate("document.querySelector('.capability-panel.active .product-preview').textContent");for(const token of content)assert.ok(text.includes(token),`${kind}: missing visual content ${token}`);
        const geometry=await page.evaluate(measure);assert.equal(geometry.viewport,width);assert.equal(geometry.selected,kind);assert.equal(geometry.visibleBodies,1);assert.ok(geometry.preview.width>0&&geometry.preview.height>=299);assert.ok(geometry.overflow<=1);assert.deepEqual(geometry.clipped,[]);assert.notEqual(geometry.border,'0px');
        if(width>980){assert.equal(geometry.columns,3);assert.equal(geometry.span,'span 2');assert.ok(geometry.active.width>geometry.gallery.width*.6);assert.ok(geometry.active.height>=519);}else{assert.equal(geometry.columns,1);}
        assert.equal(await page.evaluate("window.__p32Nodes.every((node,i)=>node===document.querySelectorAll('.capability-body')[i])"),true);
        cards.push(geometry);
        await page.send('Emulation.setDeviceMetricsOverride',{width:Math.floor(width/2),height:450,deviceScaleFactor:2,mobile:false});
        const reflow=await page.evaluate(measure);assert.equal(reflow.viewport,Math.floor(width/2));assert.ok(reflow.overflow<=1,`${kind} 200% reflow`);assert.deepEqual(reflow.clipped,[],`${kind} preview must remain readable at 200%`);geometry.reflow=reflow;
        await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=390});
      }
      await page.evaluate("document.querySelector('[data-core-capability=learning]>.capability-trigger').focus()");
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});assert.equal((await page.evaluate(measure)).selected,'tools');
      for(const [key,code,vk,text]of [['Enter','Enter',13,'\r'],[' ','Space',32,' ']]){await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk});await page.send('Input.dispatchKeyEvent',{type:'char',key,code,text,windowsVirtualKeyCode:vk});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});assert.equal((await page.evaluate(measure)).selected,'tools');}
      assert.equal(await page.evaluate("document.activeElement.matches('.capability-trigger:focus-visible')"),true);
      if(width<=390){await page.send('Emulation.setTouchEmulationEnabled',{enabled:true});const point=await page.evaluate("(()=>{const e=document.querySelector('[data-core-capability=finance]>.capability-trigger');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal((await page.evaluate(measure)).selected,'finance');await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});}
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.hero-scene-card')).animationName"),'none');assert.ok(await page.evaluate("parseFloat(getComputedStyle(document.querySelector('.capability-panel')).transitionDuration)<=.001"));await page.send('Emulation.setEmulatedMedia',{features:[]});
      assert.deepEqual(page.runtimeErrors,[]);results.push({width,theme,scene,cards,keyboard:true,touch:width<=390,reducedMotion:true,zoomReflow:true,errors:[]});
    }
  }finally{await page.close();}
}
const output=path.resolve(process.env.AERIS_P32_OUTPUT||'artifacts/aeris-p32-cards.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({pass:true,cases:results},null,2));console.log(JSON.stringify({pass:true,cases:results.length,previewsPerCase:5}));
