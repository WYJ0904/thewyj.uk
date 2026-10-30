import fs from 'node:fs/promises';
import path from 'node:path';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const page=await openPage({baseUrl:'http://127.0.0.1:8898',cdpUrl:'http://127.0.0.1:9238',width:1440,height:960});
const html=`<style>button{position:absolute;left:200px;top:200px;width:80px;height:80px;touch-action:none}</style><button id=h>drag</button><script>window.events=[];const h=document.getElementById('h');for(const type of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture','pointercancel','dragstart'])h.addEventListener(type,e=>events.push({type,buttons:e.buttons,cap:h.hasPointerCapture(e.pointerId),time:performance.now()}));h.addEventListener('pointerdown',e=>{e.preventDefault();h.setPointerCapture(e.pointerId)});</script>`;
const rows=[];
try{
 await page.send('Page.navigate',{url:'data:text/html,'+encodeURIComponent(html)});await page.waitFor('Boolean(document.getElementById("h"))');
 for(let n=0;n<30;n++){
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:240,y:240,buttons:0});
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:240,y:240,button:'left',buttons:1,clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:252,y:248,button:'left',buttons:1});await delay(30);
  const r=await page.send('Runtime.evaluate',{expression:'document.getElementById("h").hasPointerCapture(1)',returnByValue:true});rows.push({round:n+1,hasCapture:r.result.value});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:252,y:248,button:'left',buttons:0,clickCount:1});
 }
 const events=(await page.send('Runtime.evaluate',{expression:'events',returnByValue:true})).result.value;
 const out=path.resolve(import.meta.dirname,'../../docs/migration-evidence/aeris-p03-p07/pointer-capture-minimal-explicit-button.json');
 await fs.writeFile(out,JSON.stringify({scope:'Pure data-document control; no Aeris code or service',rows,events},null,2),{flag:'wx'});console.log(JSON.stringify({total:rows.length,captureRetained:rows.filter(r=>r.hasCapture).length}));
}finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:1,button:'left',buttons:0}).catch(()=>{});await page.close();}
