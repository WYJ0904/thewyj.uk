// Read-only joint verification. Deployment/configuration remains Flash's task.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openPage} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..'),out=process.env.P07_D_EVIDENCE;
const origin=new URL(process.env.P07_HOSTED_URL).origin,sha=process.env.P07_HOSTED_SHA;
assert.match(sha||'',/^[0-9a-f]{40}$/);assert.ok(new URL(origin).hostname.endsWith('.thewyj-p07-ui-rc.pages.dev'));
const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const auth=spawnSync(process.execPath,[wrangler,'auth','token','--json'],{cwd:root,encoding:'utf8',timeout:30000});
assert.equal(auth.status,0,'Read-only Cloudflare metadata authentication unavailable');
let authData;try{authData=JSON.parse(auth.stdout);}catch{throw Error('Read-only authentication metadata was not valid JSON');}
const token=authData.token||authData.oauth_token||authData.api_token;assert.ok(token);
async function cf(route){const r=await fetch('https://api.cloudflare.com/client/v4/accounts/97c274a981e8dd6703aa6388e11c4614'+route,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});const v=await r.json();assert.equal(v.success,true,'Isolated metadata HTTP '+r.status+' codes '+(v.errors||[]).map(e=>e.code).join(','));return v.result;}
const project=await cf('/pages/projects/thewyj-p07-ui-rc'),cfg=project.deployment_configs.preview;
assert.equal(cfg.d1_databases.WYJ_DB.id,'ee869f78-b54a-4018-bc99-871089ecb8cd','Hosted login requires proven isolated D1');
assert.equal(Object.keys(cfg.r2_buckets||{}).length,0);assert.equal(Object.keys(cfg.ai_bindings||{}).length,0);
assert.equal(String(cfg.env_vars.WORKERS_AI_ENABLED.value),'false');
const deployments=await cf('/pages/projects/thewyj-p07-ui-rc/deployments?env=preview&per_page=20');
const deployed=deployments.find(d=>new URL(d.url).origin===origin);assert.ok(deployed,'Origin is not an audited isolated deployment');
assert.equal(deployed.deployment_trigger.metadata.commit_hash,sha,'Preview is a different exact SHA');assert.equal(deployed.environment,'preview');
const proof={origin,deployedSha:sha,deploymentId:deployed.id,isolatedD1:cfg.d1_databases.WYJ_DB.id,r2Bindings:0,aiBindings:0,cases:[],configurationMutations:0,ledgerMutations:0};
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,maxBuffer:30*1024*1024});assert.equal(r.status,0);return r.stdout;};
proof.currentLocalHead=git('rev-parse','HEAD').toString().trim();proof.exactCurrentHeadMatch=proof.currentLocalHead===sha;
const app=git('show',sha+':app.js'),appHash=createHash('sha256').update(app).digest('hex');
const html=await (await fetch(origin+'/')).text(),entry=html.match(/\bsrc="([^\"]*\/app\.js[^\"]*)"/)?.[1];assert.ok(entry);
const liveApp=await fetch(new URL(entry,origin));assert.equal(liveApp.status,200);assert.equal(createHash('sha256').update(Buffer.from(await liveApp.arrayBuffer())).digest('hex'),appHash);proof.appSha256=appHash;
const policyResponse=await fetch(origin+'/api/ui/features'),policy=await policyResponse.json();assert.equal(policyResponse.status,200);assert.equal(policy.public_ui.enabled,true,'Real public policy is not V3 ON');proof.publicPolicy=policy.public_ui;
// Read only the explicitly supplied QA credential source; never log or commit
// its literal, and never run the peer's script as code.
let secret=process.env.P07_HOSTED_QA_SECRET;
if(!secret){const credentialSource=await fs.readFile(process.env.P07_HOSTED_CREDENTIAL_SOURCE||path.join(root,'qa/p07-r4c/run-e2e-browser-verification.mjs'),'utf8');assert.ok(credentialSource.includes('qa_lifetime_member'));const matches=[...credentialSource.matchAll(/\bsecret\s*:\s*(["'])([^"']+)\1/g)];assert.equal(matches.length,1,'Use a separate safe QA credential source');secret=matches[0][2];}
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:origin,width:1440,height:960,mobile:false});
await p.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__r4cHostedDoc=performance.timeOrigin+Math.random()'});
async function sole(id,route){await p.waitFor(`!document.getElementById('entryScreen')&&location.pathname===${JSON.stringify(route)}&&document.documentElement.dataset.interfacePolicy==='enabled'&&document.getElementById(${JSON.stringify(id)}).checkVisibility({checkOpacity:true,checkVisibilityCSS:true})`,30000,'real hosted workspace '+route);const s=await p.evaluate(`(()=>{const ids=['publicHome','projectPicker','projectApp','financePage','membershipModal','accountModal','toolsPanel','transferPage','adminPanel'];return{path:location.pathname,policy:document.documentElement.dataset.interfacePolicy,p07:document.documentElement.dataset.p07Ui,inert:document.getElementById('appShell').inert,modalOpen:document.body.classList.contains('modal-open'),shown:ids.filter(id=>{const e=document.getElementById(id);return e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('.hidden')})}})()`);assert.deepEqual(s.shown,[id]);assert.equal(s.inert,false);assert.equal(s.modalOpen,false);proof.cases.push(s);return s;}
async function click(selector){await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const h=await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,t=document.elementFromPoint(x,y);return{x,y,ownsHit:Boolean(t&&(t===e||e.contains(t))),inert:Boolean(e.closest('[inert]'))}})()`);assert.ok(h.ownsHit&&!h.inert,selector+' covered');for(const type of ['mousePressed','mouseReleased'])await p.send('Input.dispatchMouseEvent',{type,x:h.x,y:h.y,button:'left',clickCount:1});return h;}
async function capture(name){const s=await p.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(s.data,'base64'));}
try{
  await p.navigate('/');await sole('publicHome','/');assert.equal(await p.evaluate("document.getElementById('publicHome').dataset.sessionMode"),'guest');await capture('joint-guest-home');
  await p.navigate('/login');await p.waitFor("!document.getElementById('entryScreen')&&document.getElementById('usernameInput').checkVisibility()",30000);
  await p.setFields({'#usernameInput':'qa_lifetime_member','#secretInput':secret});await click('#loginSubmitBtn');await sole('publicHome','/');
  await p.waitFor("document.getElementById('publicHome').dataset.sessionMode==='authenticated'",15000);
  const session=await p.evaluate("localStorage.getItem('wyjAccountSession')");assert.ok(session);
  const headers={'X-Session-Token':session};const accountResponse=await fetch(origin+'/api/me',{headers}),account=await accountResponse.json();assert.equal(accountResponse.status,200);assert.equal(account.account.username,'qa_lifetime_member');assert.ok(!account.account.is_admin&&!account.account.is_super_admin);
  const featuresResponse=await fetch(origin+'/api/features',{headers}),features=await featuresResponse.json();assert.equal(featuresResponse.status,200);assert.equal(features.snapshot.account_id,account.account.id);assert.equal(features.snapshot.flags.p07_accessibility.enabled,true);
  proof.accountPolicy={username:'qa_lifetime_member',role:account.account.role,channel:features.snapshot.channel,p07:features.snapshot.flags.p07_accessibility};
  assert.equal((await fetch(origin+'/api/admin/users',{headers})).status,403);proof.memberAdminDenied=true;
  for(const [nav,route,id] of [['recharge','/recharge','membershipModal'],['finance','/finance','financePage'],['account','/account','accountModal'],['language','/language','projectPicker'],['workflows','/tools/workflows','toolsPanel'],['transfer','/transfer','transferPage'],['home','/','publicHome']]){
    const hit=await click(`[data-v3-nav="${nav}"]`);await sole(id,route);proof.cases.at(-1).hit=hit;
    if(nav==='account'||nav==='recharge')await capture('joint-'+nav);
  }
  await click('[data-v3-nav="account"]');await sole('accountModal','/account');await click('[data-v3-nav="recharge"]');await sole('membershipModal','/recharge');
  await p.evaluate('history.back()');await sole('accountModal','/account');await p.evaluate('history.forward()');await sole('membershipModal','/recharge');
  await click('[data-v3-nav="account"]');await sole('accountModal','/account');
  for(const hard of [false,true]){const old=await p.evaluate('globalThis.__r4cHostedDoc');await p.send('Page.reload',{ignoreCache:hard});await p.waitFor(`globalThis.__r4cHostedDoc!==${JSON.stringify(old)}&&!document.getElementById('entryScreen')`,30000);await sole('accountModal','/account');}
  proof.normalAndHardRefresh=true;proof.historyBackForward=true;proof.loggedInV3=true;proof.loggedOutV3=true;
  proof.runtimeErrors=p.runtimeErrors;assert.deepEqual(p.runtimeErrors,[]);proof.status='HOSTED_SNAPSHOT_VERIFIED';
}catch(error){proof.status='FAIL';proof.error=error.message;await capture('joint-failure').catch(()=>{});throw error;}finally{await fs.writeFile(path.join(out,'hosted-joint.json'),JSON.stringify(proof,null,2));await p.close();}
console.log(JSON.stringify({status:proof.status,deployedSha:sha,publicV3:true,accountV3:true,cases:proof.cases.length,configurationMutations:0}));
