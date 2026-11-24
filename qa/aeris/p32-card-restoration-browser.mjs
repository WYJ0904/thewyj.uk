import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openPage} from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const results=[];
const measure=`(()=>{const gal=document.querySelector('#publicCapabilityGallery');return {viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,heroCards:document.querySelectorAll('.hero-scene-card,.bento-tile').length,tabs:document.querySelectorAll('#publicCapabilityGallery [role=tab]').length,galleryH:gal?gal.getBoundingClientRect().height:0};})()`;
for(const width of [320,390,1366,1920]){
  const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:900,mobile:width<=390});
  try{
    await page.navigate('/');await page.waitFor("document.documentElement.dataset.aerisMotionReady==='true' && !document.getElementById('entryScreen')");
    assert.equal(await page.evaluate("document.querySelectorAll('.aeris-scene-grid,.aeris-capability-list,.aeris-capability-link,#publicSplitFlap,.hero-scene-card,#publicBentoWall').length"),0);
    const ids=await page.evaluate("[...document.querySelectorAll('[id]')].map(e=>e.id)");assert.equal(new Set(ids).size,ids.length);
    for(const theme of ['light','dark']){
      await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const g=await page.evaluate(measure);
      assert.equal(g.viewport,width);assert.equal(g.heroCards,0);assert.equal(g.tabs,4);assert.ok(g.galleryH>=220);assert.ok(g.overflow<=1);
      await page.click('#publicToolsTab');await page.waitFor("!document.querySelector('#capabilityToolsBody').hidden");
      assert.equal(await page.evaluate("document.querySelector('[data-product-window]').dataset.selected"),'tools');
      await page.send('Emulation.setDeviceMetricsOverride',{width:Math.floor(width/2),height:450,deviceScaleFactor:2,mobile:false});
      const reflow=await page.evaluate(measure);assert.equal(reflow.viewport,Math.floor(width/2));assert.ok(reflow.overflow<=1);
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=390});
      assert.deepEqual(page.runtimeErrors,[]);
      results.push({width,theme,i03Replaced:true,geometry:g,reflow,errors:[]});
    }
  }finally{await page.close();}
}
const output=path.resolve(process.env.AERIS_P32_OUTPUT||'artifacts/aeris-p32-cards.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({pass:true,cases:results},null,2));console.log(JSON.stringify({pass:true,cases:results.length,bentoTilesPerCase:5}));
