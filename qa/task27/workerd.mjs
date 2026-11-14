import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {POLICY_VERSIONS} from '../../functions/_lib/task27-policy.mjs';
import {totpAt} from '../../functions/_lib/task27-crypto.mjs';

const root=path.resolve(import.meta.dirname,'../..'),directory=path.join(root,'.wrangler/task27-workerd',crypto.randomUUID());await mkdir(directory,{recursive:true});
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
const bindings={...config.env.preview.vars,WYJ_ENVIRONMENT:'development',WORKERS_AI_ENABLED:'false',EMAIL_SENDING_ENABLED:'false',TASK27_SECURITY_ENABLED:'true',
  WYJ_TASK12_PASSWORD_PEPPER:'task27-workerd-synthetic-pepper-0123456789',WYJ_TASK14_TEMPORARY_SECRET:'task27-workerd-synthetic-share-0123456789',WYJ_TASK20_DEVICE_SESSION_SECRET:'task27-workerd-synthetic-device-0123456789',
  WYJ_TASK27_CHALLENGE_SECRET:'task27-workerd-synthetic-challenge-0123456789',WYJ_TASK27_TOTP_KEY:Buffer.alloc(32,11).toString('base64url')};
const mf=new Miniflare({modules:true,scriptPath:path.join(root,'.wrangler/functions-build/index.js'),compatibilityDate:config.compatibility_date,d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE'],bindings,serviceBindings:{ASSETS:()=>new Response('fixture asset not found',{status:404})}});
const proof={scope:'compiled Pages worker in local workerd with isolated real D1, Web Crypto and synthetic bindings',checks:[],real_emails:0,remote_operations:0};
const password='Synthetic-Workerd-Task27-Password!',username='workerd-task27-user',device='663a75e0-0c27-4c0b-9ed7-608a8d05c235';
async function call(route,body,session='',native=false){const response=await mf.dispatchFetch('https://task27.local'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','User-Agent':native?'thewyj-android/1.3.38 Android/36':'Task27 runtime fixture',...(session?{'X-Session-Token':session}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,headers:response.headers,body:await response.json()};}
async function check(name,fn){await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
try{
 const db=await mf.getD1Database('WYJ_DB');for(const filename of(await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())await db.exec((await readFile(path.join(root,'cloudflare/migrations',filename),'utf8')).replace(/\r?\n/g,' '));
 let session,setup,codes,web,native;
 await check('actual worker registration rejects missing consent and stores affirmative versions',async()=>{
  assert.equal((await call('/api/register',{username,secret:password,confirm_secret:password})).status,428);
  const result=await call('/api/register',{username,secret:password,confirm_secret:password,terms_accepted:true,policy_versions:POLICY_VERSIONS});assert.equal(result.status,201);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM task27_policy_consents WHERE user_id=?1').bind(result.body.account.id).first()).count,1);
  session=(await call('/api/login',{username,secret:password})).body.session;assert.ok(session);
 });
 await check('actual worker AES-GCM TOTP enrollment and one-time recovery output',async()=>{
  const step=await call('/api/security/stepup',{password,scope:'mfa_change'},session);assert.equal(step.status,200);
  setup=await call('/api/security/mfa/start',{method:'totp',grant:step.body.grant},session);assert.equal(setup.status,200);
  const activated=await call('/api/security/mfa/confirm',{challenge:setup.body.challenge,code:await totpAt(setup.body.secret,Math.floor(Date.now()/30000))},session);assert.equal(activated.status,200);codes=activated.body.recovery_codes;assert.equal(codes.length,10);
  assert.equal((await call('/api/me',undefined,session)).status,401);
 });
 await check('actual worker verifies MFA before Web and Android token issuance',async()=>{
  const pending=await call('/api/login',{username,secret:password});assert.equal(pending.body.mfa_required,true);assert.equal(pending.body.session,undefined);
  const complete=await call('/api/security/login/verify',{challenge:pending.body.challenge,code:codes[0]});assert.equal(complete.status,200);web=complete.body.session;
  const app=await call('/api/app/login',{username,secret:password,device_id:device,app_version:'1.3.38'},'',true);assert.equal(app.body.access_token,undefined);assert.equal(app.headers.get('Set-Cookie'),null);
  native=await call('/api/app/login/verify',{challenge:app.body.challenge,code:codes[1],device_id:device,app_version:'1.3.38'},'',true);assert.equal(native.status,200);assert.ok(native.body.access_token&&native.body.refresh_token);
  assert.equal((await call('/api/security/login/verify',{challenge:pending.body.challenge,code:codes[0]})).status,400);
 });
 await check('actual worker revokes Android refresh and keeps current Web session',async()=>{
  const start=await call('/api/security/stepup',{password,scope:'sessions_revoke'},web);assert.equal(start.status,200);
  const grant=await call('/api/security/stepup/verify',{challenge:start.body.challenge,code:codes[2]},web);assert.equal(grant.status,200);
  assert.equal((await call('/api/security/sessions/revoke',{mode:'others',grant:grant.body.grant},web)).status,200);
  assert.equal((await call('/api/app/session/refresh',{refresh_token:native.body.refresh_token,device_id:device,app_version:'1.3.38',rotation_key:crypto.randomUUID()},'',true)).status,401);
  assert.equal((await call('/api/me',undefined,web)).status,200);
 });
 await check('actual worker inbox read-all persists and public policies render',async()=>{
  const unread=await call('/api/notifications',undefined,web);assert.ok(unread.body.unread_count>0);
  const preview=await call('/api/notifications/read-all/preview',{},web);assert.equal(preview.body.count,unread.body.unread_count);
  assert.equal((await call('/api/notifications/read-all',{confirmation:preview.body.confirmation,confirm:true},web)).body.unread_count,0);
  for(const route of ['/terms','/privacy','/security-privacy']){const result=await mf.dispatchFetch('https://task27.local'+route);assert.equal(result.status,200);const text=await result.text();assert.ok(text.includes('support@thewyj.uk'));assert.ok(!text.includes('@gmail.com'));assert.ok(!text.includes('第四部分'));}
 });
 proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;console.error(error.stack);}
finally{await writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2)+'\n');await mf.dispose();console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,evidence:path.relative(root,directory),error:proof.error}));}
