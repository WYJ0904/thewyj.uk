import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';
const base=new URL(process.env.WYJ_TEST_BASE).origin,out=path.resolve(process.env.P07_D_EVIDENCE);
assert.equal(new URL(base).hostname,'127.0.0.1');
const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:base,width:1440,height:960,mobile:false});
const rows=[],failures=[],screenshots=[];
await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__p07LayoutDoc=String(performance.timeOrigin)+Math.random()'});
async function go(route){
  const old=await page.evaluate('globalThis.__p07LayoutDoc||null');
  await page.send('Page.navigate',{url:base+route});
  await page.waitFor(`globalThis.__p07LayoutDoc&&globalThis.__p07LayoutDoc!==${JSON.stringify(old)}&&document.readyState==='complete'&&!document.getElementById('entryScreen')`,30000,'new stable layout document');
}
async function click(selector){
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const p=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,h=document.elementFromPoint(x,y);return{x,y,hit:Boolean(h&&(h===e||e.contains(h)))}})()`);
  assert.ok(p.hit,'supplement pointer is obstructed '+selector);
  for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});
}
async function shot(name){const r=await page.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name),Buffer.from(r.data,'base64'));screenshots.push(name);}
function geometry(){return `(()=>{const q=document.getElementById('quizView'),a=q.querySelector('.quiz-card'),f=document.getElementById('resultPanel'),r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}};
  return{width:innerWidth,columns:getComputedStyle(q).gridTemplateColumns,card:r(a),feedback:r(f),feedbackVisible:f.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!f.closest('.hidden'),feedbackText:f.innerText.trim(),word:document.getElementById('wordText').textContent.trim()}})()`;}
try{
  await go('/');
  await click('#homeProductDetails > summary');
  await page.waitFor("document.getElementById('homeProductDetails').open",5000);
  await click('[data-core-capability="tools"] .capability-trigger');
  await shot('public-feature-cards-1440.png');
  const credentials={username:'p07r3layout'+randomBytes(5).toString('hex'),secret:randomBytes(24).toString('base64url')};
  const registered=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,confirm_secret:credentials.secret})});
  assert.equal(registered.status,201);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)}).then(r=>r.json());
  await page.evaluate(`localStorage.clear();localStorage.setItem('wyjAccountSession',${JSON.stringify(login.session)});true`);
  const fixtures={english:{words:'hello\nworld',answers:{hello:'你好',world:'世界'}},japanese:{words:'電話\n水',answers:{'電話':'电话','水':'水'}}};
  for(const language of ['english','japanese']){
    await go('/language/'+language);
    await page.waitFor("!document.getElementById('projectApp').classList.contains('hidden')",15000);
    await page.setFields({'#wordInput':fixtures[language].words,'#practiceModeSelect':'meaning'});await click('#startBtn');
    await page.waitFor("document.getElementById('quizView').classList.contains('active')",10000);
    const before=await page.evaluate(geometry());
    await page.setFields({'#answerInput':fixtures[language].answers[before.word]});await click('#submitBtn');
    await page.waitFor("document.getElementById('scoreLabel').textContent==='得分 1'&&!document.getElementById('resultPanel').classList.contains('hidden')",10000);
    const feedback=[];
    for(const width of [1024,1440,1920]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:false});
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const g=await page.evaluate(geometry());feedback.push(g);
      assert.ok(g.card.width>0&&g.word&&g.feedbackVisible&&g.feedback.width>0&&g.feedbackText,'both question and feedback columns need actual content');
      if(width===1440)await shot(language+'-actual-answer-feedback-1440.png');
    }
    const emptyTracks=before.columns.split(/\s+/).filter(x=>parseFloat(x)>0).length>1&&!before.feedbackVisible;
    if(emptyTracks)failures.push({language,issue:'reserved_empty_feedback_column_before_answer',before});
    rows.push({language,before,feedback});
  }
}catch(error){failures.push({issue:'supplement_error',error:error.message});}
finally{await page.close();}
const report={target_sha:process.env.P07_D_TARGET_HEAD,driver_sha256:createHash('sha256').update(await fs.readFile(import.meta.filename)).digest('hex'),
  scope:'additional actual content-column measurements and screenshots; known local dictionary answers, no AI inference',rows,failures,screenshots};
await fs.writeFile(path.join(out,'layout-supplement.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({target_sha:report.target_sha,rows:rows.length,failures},null,2));
if(failures.length)process.exitCode=1;
