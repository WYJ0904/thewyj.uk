import fs from 'node:fs/promises';
import path from 'node:path';
import { openPage, delay } from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'docs/migration-evidence/aeris-p03-p07/hit-probe-r1');await fs.mkdir(out);
const page=await openPage({baseUrl:'http://127.0.0.1:8898',cdpUrl:'http://127.0.0.1:9238',width:1440,height:960});
const rows=[];
try{
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete globalThis.__WYJ_TEST_MODE__;'});
 for(const reduced of [true,false]){
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
  await page.navigate('/login');await page.waitFor("!document.getElementById('authPanel').classList.contains('hidden') && document.documentElement.dataset.p07Ui==='enabled'",30000);await delay(300);
  rows.push(await page.evaluate(`(()=>{const n=document.getElementById('loginSubmitBtn'),r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const style=(e,pseudo)=>{const s=getComputedStyle(e,pseudo);return {id:e.id,pseudo,content:s.content,position:s.position,zIndex:s.zIndex,pointerEvents:s.pointerEvents,transform:s.transform,animation:s.animationName,zoom:s.zoom,display:s.display}};return {reduced:${reduced},point:{x,y},hits:document.elementsFromPoint(x,y).map(e=>({id:e.id,tag:e.tagName,class:e.className})),parents:[n,n.parentElement,n.parentElement.parentElement,document.getElementById('projectApp')].flatMap(e=>[style(e),style(e,'::before'),style(e,'::after')]),dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.id),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scale:visualViewport.scale}};})()`));
  const shot=await page.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,`${reduced}.png`),Buffer.from(shot.data,'base64'));
 }
}finally{await page.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));}
