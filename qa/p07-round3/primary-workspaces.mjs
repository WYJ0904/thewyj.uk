import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';
const base=new URL(process.env.WYJ_TEST_BASE).origin,out=path.resolve(process.env.P07_D_EVIDENCE);
assert.equal(new URL(base).hostname,'127.0.0.1');
const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:base,width:1440,height:960,mobile:false});
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__p07PrimaryDoc=String(performance.timeOrigin)+Math.random()'});
const user={username:'p07primary'+randomBytes(5).toString('hex'),secret:randomBytes(24).toString('base64url')};
await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...user,confirm_secret:user.secret})});
const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(user)}).then(r=>r.json());
const cases=[];
async function go(route){const old=await page.evaluate('globalThis.__p07PrimaryDoc||null');await page.send('Page.navigate',{url:base+route});
  await page.waitFor(`globalThis.__p07PrimaryDoc&&globalThis.__p07PrimaryDoc!==${JSON.stringify(old)}&&document.readyState==='complete'&&!document.getElementById('entryScreen')`,30000,'new primary document');}
async function pointer(selector){
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const p=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,ownsHit:Boolean(h&&(h===e||e.contains(h)))}})()`);
  assert.ok(p.ownsHit,'fixture control covered');for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});return p;
}
async function observe(id){return page.evaluate(`(()=>{const ids=['publicHome','projectPicker','projectApp','financePage','toolsPanel','transferPage','adminPanel','membershipModal','accountModal','changelogPage','downloadPage','trialPage'];
  const rows=ids.map(id=>document.getElementById(id)).filter(e=>e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('.hidden')).map(e=>{const r=e.getBoundingClientRect();return{id:e.id,insideMain:document.getElementById('v3MainCanvas').contains(e),inViewport:r.bottom>63&&r.y<innerHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}});
  return{route:location.pathname,expected:${JSON.stringify(id)},surfaces:rows,shellInert:document.getElementById('appShell').inert,modalOpen:document.body.classList.contains('modal-open')};})()`);}
try{
  await go('/login');await page.evaluate(`localStorage.setItem('wyjAccountSession',${JSON.stringify(login.session)});true`);
  for(const [name,route,id] of [['direct-account','/account','accountModal'],['direct-membership','/recharge','membershipModal'],['finance-upgrade-membership','/finance','membershipModal']]){
    let detail=null;
    try{
      await go(route);
      if(route==='/finance'){
        await page.waitFor("!document.getElementById('financeLocked').classList.contains('hidden')",15000);await pointer('#financeUpgradeBtn');
      }
      await page.waitFor(`location.pathname===${JSON.stringify(id==='accountModal'?'/account':'/recharge')}&&!document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`,15000,'requested primary workspace');
      detail=await observe(id);
      const image=await page.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));
      assert.deepEqual(detail.surfaces.map(x=>x.id),[id],'a page route must expose exactly its own primary surface');
      assert.ok(detail.surfaces[0].insideMain&&detail.surfaces[0].inViewport,'requested workspace must be the visible main canvas');
      assert.equal(detail.shellInert,false);assert.equal(detail.modalOpen,false);
      cases.push({name,status:'PASS',detail,screenshot:name+'.png'});
    }catch(error){cases.push({name,status:'FAIL',detail,error:error.message,screenshot:name+'.png'});}
  }
}finally{await page.close();}
await fs.writeFile(path.join(out,'primary-workspaces.json'),JSON.stringify({target_sha:process.env.P07_D_TARGET_HEAD,cases},null,2));
console.log(JSON.stringify({target_sha:process.env.P07_D_TARGET_HEAD,cases:cases.map(c=>({name:c.name,status:c.status,surfaces:c.detail?.surfaces.map(x=>x.id)}))},null,2));
if(cases.some(c=>c.status==='FAIL'))process.exitCode=1;
