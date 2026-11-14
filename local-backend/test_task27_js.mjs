import assert from 'node:assert/strict';
import { readFile,readdir,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Miniflare } from 'miniflare';
import { handleTask27Request } from '../functions/_lib/task27-api.mjs';
import { handleTask12Request } from '../functions/_lib/task12-api.mjs';
import { handleTask20Request } from '../functions/_lib/task20-api.mjs';
import { handleTask18Request } from '../functions/_lib/task18-api.mjs';
import { hashSecret,sessionStorageKey } from '../functions/_lib/task12-crypto.mjs';
import { base32,encryptTotp,totpAt } from '../functions/_lib/task27-crypto.mjs';
import { POLICY_VERSIONS } from '../functions/_lib/task27-policy.mjs';
import { DAY } from '../functions/_lib/task27-store.mjs';

const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(os.tmpdir(),'aeris-task27-'));
const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],d1Persist:temp});
const db=await runtime.getD1Database('WYJ_DB');
const messages=[];
let transport='queued';
const env={WYJ_DB:db,WYJ_ENVIRONMENT:'preview',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK18_ADMIN_MESSAGES_ENABLED:'true',TASK20_ANDROID_APP_ENABLED:'true',TASK27_SECURITY_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'true',
  WYJ_TASK12_PASSWORD_PEPPER:'synthetic-task27-password-pepper-0123456789',WYJ_TASK20_DEVICE_SESSION_SECRET:'synthetic-task27-device-secret-0123456789',
  WYJ_TASK27_CHALLENGE_SECRET:'synthetic-task27-challenge-secret-0123456789',WYJ_TASK27_TOTP_KEY:Buffer.alloc(32,19).toString('base64url'),EMAIL_SENDING_ENABLED:'true',
  EMAIL:{async send(payload){messages.push(payload);if(transport==='rate')throw new Error('429 rate limit');if(transport==='unknown')throw new Error('connection closed');return {messageId:crypto.randomUUID(),queued:transport==='queued'?[{}]:[],delivered:transport==='delivered'?[{}]:[]};}}};
const password='Synthetic-Task27-Password!';
const device='663a75e0-0c27-4c0b-9ed7-608a8d05c235';
let completed=0;
const sql=async(text,...args)=>db.prepare(text).bind(...args).run();
const one=async(text,...args)=>db.prepare(text).bind(...args).first();
async function call(route,body,token='',extra={}) {
  const tasks=[];
  const headers={'User-Agent':extra.android?'thewyj-android/1.3.38 Android/36':'Task27 synthetic browser',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{'X-Session-Token':token}:{}),...(extra.headers || {})};
  const context={request:new Request(`https://thewyj.uk${route}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),env:{...env,...extra.env},data:{requestId:crypto.randomUUID()},waitUntil(p){tasks.push(p);}};
  const response=await handleTask27Request(context)||await handleTask12Request(context)||await handleTask20Request(context)||await handleTask18Request(context);
  await Promise.all(tasks);
  assert.ok(response,'route must be handled');
  return {status:response.status,body:await response.json(),headers:response.headers};
}
async function test(name,fn){await sql('DELETE FROM cloud_rate_limit_windows');await fn();completed++;console.log(`ok ${completed} - ${name}`);}
async function seed(id,role='user') {
  const when=new Date().toISOString();
  await sql(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,?2,'pbkdf2_sha256',310000,?3,?4,?4,?4,?4)`,id,await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER),role,when);
}
async function login(id,extra={}) {const result=await call('/api/login',{username:id,secret:password},'',extra);assert.equal(result.status,200);return result.body;}
async function grant(token,scope,secret=password) {
  const result=await call('/api/security/stepup',{password:secret,scope},token);
  assert.equal(result.status,200);return result.body.grant;
}
const lastCode=()=>messages.at(-1).text.match(/验证码：(\d{6})/)[1];
async function enableTotp(id) {
  const session=(await login(id)).session;
  const start=await call('/api/security/mfa/start',{method:'totp',grant:await grant(session,'mfa_change')},session);
  assert.equal(start.status,200);
  const code=await totpAt(start.body.secret,Math.floor(Date.now()/30000));
  const finish=await call('/api/security/mfa/confirm',{challenge:start.body.challenge,code},session);
  assert.equal(finish.status,200);return {secret:start.body.secret,codes:finish.body.recovery_codes};
}
try {
  for(const name of (await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort()) {
    const source=await readFile(path.join(root,'cloudflare/migrations',name),'utf8');
    await db.exec(source.replace(/^\s*--.*$/gm,'').replace(/\r?\n/g,' '));
  }
  await seed('owner','super_admin');await seed('admin-a');await seed('admin-b');
  await sql("INSERT INTO task18_admin_roles(user_id,role,granted_by_user_id,granted_by_username,granted_at,updated_at) VALUES('admin-a','admin','owner','owner',?1,?1),('admin-b','admin','owner','owner',?1,?1)",new Date().toISOString());
  for(const id of ['alice','bob','carol','dave','email-user','reset-user','recover-user','mail-user'])await seed(id);

  await test('RFC 6238 published SHA-1 vectors, including post-2038 counters',async()=>{
    const secret=base32(new TextEncoder().encode('12345678901234567890'));
    for(const [time,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(await totpAt(secret,Math.floor(time/30),8),expected);
  });
  await test('registration requires affirmative current-version consent server-side',async()=>{
    const body={username:'registered',secret:password,confirm_secret:password};
    assert.equal((await call('/api/register',body)).status,428);
    assert.equal((await call('/api/register',{...body,terms_accepted:'true',policy_versions:POLICY_VERSIONS})).status,428);
    assert.equal((await call('/api/register',{...body,terms_accepted:true,policy_versions:{...POLICY_VERSIONS,terms:'old'}})).status,428);
    assert.equal((await one("SELECT COUNT(*) AS count FROM task12_users WHERE id='registered'")).count,0);
    const result=await call('/api/register',{...body,terms_accepted:true,policy_versions:POLICY_VERSIONS});assert.equal(result.status,201);
    const consent=await one('SELECT * FROM task27_policy_consents WHERE user_id=?1',result.body.account.id);assert.equal(consent.terms_version,POLICY_VERSIONS.terms);assert.ok(consent.accepted_at);
  });
  await test('original non-MFA Web and native sessions remain usable',async()=>{
    const alice=await login('alice');assert.ok(alice.session);assert.equal((await call('/api/me',undefined,alice.session)).status,200);
    const native=await call('/api/app/login',{username:'bob',secret:password,device_id:device,app_version:'1.3.38'},'',{android:true});assert.equal(native.status,200);assert.ok(native.body.refresh_token);
    assert.equal((await call('/api/app/session',undefined,native.body.access_token,{android:true})).status,200);
  });
  await test('email binding needs step-up and cannot replay or disclose conflicting ownership',async()=>{
    const session=(await login('email-user')).session;
    assert.equal((await call('/api/security/email/start',{email:'synthetic@example.test'},session)).status,400);
    const start=await call('/api/security/email/start',{email:'synthetic@example.test',grant:await grant(session,'email_change')},session);assert.equal(start.status,200);
    const code=lastCode();const saved=await one('SELECT code_hash FROM task27_challenges WHERE token_digest=?1',await sessionStorageKey(start.body.challenge));assert.ok(saved.code_hash&&!saved.code_hash.includes(code));
    assert.equal((await call('/api/security/email/confirm',{challenge:start.body.challenge,code},session)).status,200);
    assert.notEqual((await call('/api/me',undefined,session)).status,200);
    const fresh=(await login('email-user')).session;
    assert.notEqual((await call('/api/security/email/confirm',{challenge:start.body.challenge,code},fresh)).status,200);
  });
  await test('provider failure invalidates the email challenge and reports failure without changing binding',async()=>{
    const token=(await login('recover-user')).session;
    const result=await call('/api/security/email/start',{email:'provider-failure@example.test',grant:await grant(token,'email_change')},token,{env:{EMAIL:{async send(){throw new Error('synthetic provider offline');}}}});
    assert.equal(result.status,502);assert.equal(result.body.code,'email_delivery_failed');assert.equal(result.body.challenge,undefined);
    assert.equal((await one("SELECT verified_email FROM task27_security WHERE user_id='recover-user'")).verified_email,'');
    assert.equal((await one("SELECT COUNT(*) AS count FROM task27_challenges WHERE user_id='recover-user' AND kind='email_bind' AND consumed_at=''")).count,0);
  });
  await test('email MFA sends only after correct password and issues no pre-MFA session',async()=>{
    const session=(await login('email-user')).session;
    const start=await call('/api/security/mfa/start',{method:'email',grant:await grant(session,'mfa_change')},session);assert.equal(start.status,200);
    assert.equal((await call('/api/security/mfa/confirm',{challenge:start.body.challenge,code:lastCode()},session)).status,200);
    const before=messages.length;
    assert.equal((await call('/api/login',{username:'email-user',secret:'incorrect-password'})).status,403);assert.equal(messages.length,before);
    const pending=await login('email-user');assert.equal(pending.mfa_required,true);assert.equal(pending.session,undefined);
    assert.equal((await call('/api/me',undefined,pending.challenge)).status,401);
    const code=lastCode();const attempts=await Promise.all([1,2].map(()=>call('/api/security/login/verify',{challenge:pending.challenge,code})));
    assert.equal(attempts.filter(r=>r.status===200).length,1);assert.ok(attempts.find(r=>r.status===200).body.session);
  });
  await test('five wrong attempts, expiry and disabled enrollment never bypass existing MFA',async()=>{
    const capability=await call('/api/policies',undefined,'',{env:{TASK27_SECURITY_ENABLED:'false'}});assert.equal(capability.body.security_center_ready,true);assert.equal(capability.body.security_enrollment_enabled,false);
    const pending=await login('email-user',{env:{TASK27_SECURITY_ENABLED:'false'}}),code=lastCode();
    for(let i=0;i<5;i++)assert.notEqual((await call('/api/security/login/verify',{challenge:pending.challenge,code:'not-a-code'})).status,200);
    assert.notEqual((await call('/api/security/login/verify',{challenge:pending.challenge,code})).status,200);
    const expired=await login('email-user');await sql("UPDATE task27_challenges SET expires_at='2000-01-01T00:00:00Z' WHERE token_digest=?1",await sessionStorageKey(expired.challenge));
    assert.notEqual((await call('/api/security/login/verify',{challenge:expired.challenge,code:lastCode()})).status,200);
  });
  await test('missing schema marker cannot downgrade an account with existing MFA',async()=>{
    const marker=await one("SELECT * FROM task12_metadata WHERE key='task27_schema_version'");await sql("DELETE FROM task12_metadata WHERE key='task27_schema_version'");
    try {const result=await call('/api/login',{username:'email-user',secret:password});assert.equal(result.status,503);assert.equal(result.body.session,undefined);}
    finally {await sql('INSERT INTO task12_metadata(key,value,updated_at) VALUES(?1,?2,?3)',marker.key,marker.value,marker.updated_at);}
  });
  let totp;
  await test('TOTP setup confirms before activation, encrypts secrets and shows ten recovery codes once',async()=>{
    totp=await enableTotp('carol');assert.equal(totp.codes.length,10);
    const state=await one("SELECT * FROM task27_security WHERE user_id='carol'");assert.equal(state.mfa_method,'totp');assert.ok(!state.totp_ciphertext.includes(totp.secret));
    const codes=(await db.prepare("SELECT code_hash FROM task27_recovery_codes WHERE user_id='carol'").all()).results;assert.equal(codes.length,10);assert.ok(codes.every(row=>!totp.codes.includes(row.code_hash)));
  });
  await test('recovery codes consume atomically, cannot cross accounts or mint two sessions',async()=>{
    const pending=await login('carol');
    const results=await Promise.all([1,2].map(()=>call('/api/security/login/verify',{challenge:pending.challenge,code:totp.codes[0]})));
    assert.equal(results.filter(r=>r.status===200).length,1);
    const next=await login('carol');assert.notEqual((await call('/api/security/login/verify',{challenge:next.challenge,code:totp.codes[0]})).status,200);
    const other=await login('email-user');assert.notEqual((await call('/api/security/login/verify',{challenge:other.challenge,code:totp.codes[1]})).status,200);
  });
  await test('TOTP time-step reuse is rejected across separate login challenges',async()=>{
    await sql("UPDATE task27_security SET totp_last_step=-1 WHERE user_id='carol'");
    const a=await login('carol'),b=await login('carol'),code=await totpAt(totp.secret,Math.floor(Date.now()/30000));
    const results=await Promise.all([a,b].map(p=>call('/api/security/login/verify',{challenge:p.challenge,code})));
    assert.equal(results.filter(r=>r.status===200).length,1);
  });
  await test('Android MFA binds device and delays access, refresh and cookies until verification',async()=>{
    const pending=await call('/api/app/login',{username:'email-user',secret:password,device_id:device,app_version:'1.3.38'},'',{android:true});assert.equal(pending.body.mfa_required,true);assert.equal(pending.body.access_token,undefined);assert.equal(pending.body.refresh_token,undefined);assert.equal(pending.headers.get('Set-Cookie'),null);
    const code=lastCode();assert.equal((await call('/api/app/login/verify',{challenge:pending.body.challenge,code,device_id:crypto.randomUUID(),app_version:'1.3.38'},'',{android:true})).status,403);
    assert.equal((await call('/api/security/login/verify',{challenge:pending.body.challenge,code})).status,403);
    const complete=await call('/api/app/login/verify',{challenge:pending.body.challenge,code,device_id:device,app_version:'1.3.38'},'',{android:true});assert.equal(complete.status,200);assert.ok(complete.body.access_token&&complete.body.refresh_token);assert.ok(complete.headers.get('Set-Cookie'));
  });
  let temporary;
  await test('ordinary admin resets another admin with random 20-character password, never owner',async()=>{
    const admin=(await login('admin-a')).session;
    const noGrant=await call('/api/admin/secret',{user_id:'admin-b'},admin);assert.notEqual(noGrant.status,200);
    const result=await call('/api/admin/secret',{user_id:'admin-b',grant:await grant(admin,'admin_reset:admin-b')},admin);assert.equal(result.status,200);assert.equal(result.body.temporary_password.length,20);temporary=result.body.temporary_password;
    const blocked=await call('/api/admin/secret',{user_id:'owner',grant:await grant(admin,'admin_reset:owner')},admin);assert.equal(blocked.status,403);
    const audit=await one("SELECT COUNT(*) AS count FROM task18_admin_action_audit WHERE target_id='admin-b' AND action='password_reset'");assert.ok(audit.count>0);
  });
  await test('temporary password grants restricted change token, never business access',async()=>{
    const result=await call('/api/login',{username:'admin-b',secret:temporary});assert.equal(result.status,200);assert.equal(result.body.password_change_required,true);assert.equal(result.body.session,undefined);
    assert.equal((await call('/api/me',undefined,result.body.password_change_token)).status,401);
    const complete=await call('/api/security/password/complete',{challenge:result.body.password_change_token,new_secret:password,confirm_secret:password});assert.equal(complete.status,200);
    assert.notEqual((await call('/api/security/password/complete',{challenge:result.body.password_change_token,new_secret:password,confirm_secret:password})).status,200);
    assert.ok((await login('admin-b')).session);
  });
  await test('password reset preserves MFA and revokes old Web/native credentials',async()=>{
    const request=await call('/api/security/password/request',{username:'email-user',method:'email'});const code=lastCode();
    const result=await call('/api/security/password/reset',{challenge:request.body.challenge,code,new_secret:password,confirm_secret:password});assert.equal(result.status,200);assert.equal(result.body.mfa_preserved,true);
    assert.equal((await one("SELECT mfa_method FROM task27_security WHERE user_id='email-user'")).mfa_method,'email');assert.equal((await login('email-user')).mfa_required,true);
    const missing=await call('/api/security/password/request',{username:'no-such-account',method:'email'});assert.equal(missing.status,200);assert.equal(missing.body.message,request.body.message);
  });
  await test('administrator temporary password still requires original MFA before restricted password change',async()=>{
    const admin=(await login('admin-a')).session;
    const reset=await call('/api/admin/secret',{user_id:'email-user',grant:await grant(admin,'admin_reset:email-user')},admin);assert.equal(reset.status,200);
    const pending=await call('/api/login',{username:'email-user',secret:reset.body.temporary_password});assert.equal(pending.body.mfa_required,true);assert.equal(pending.body.password_change_token,undefined);assert.equal(pending.body.session,undefined);
    const verified=await call('/api/security/login/verify',{challenge:pending.body.challenge,code:lastCode()});assert.equal(verified.status,200);assert.equal(verified.body.password_change_required,true);assert.equal(verified.body.session,undefined);
    assert.equal((await call('/api/security/password/complete',{challenge:verified.body.password_change_token,new_secret:password,confirm_secret:password})).status,200);
    assert.equal((await login('email-user')).mfa_required,true);
  });
  await test('independent password-plus-recovery-code procedure disables lost TOTP',async()=>{
    const start=await call('/api/security/mfa/recover/request',{username:'carol',password});assert.equal(start.status,200);
    assert.notEqual((await call('/api/security/mfa/recover/confirm',{challenge:start.body.challenge,code:'123456'})).status,200);
    assert.equal((await call('/api/security/mfa/recover/confirm',{challenge:start.body.challenge,code:totp.codes[2]})).status,200);
    assert.equal((await one("SELECT mfa_method FROM task27_security WHERE user_id='carol'")).mfa_method,'none');
  });
  await test('single Android revocation prevents later refresh and exposes no credential digests',async()=>{
    const web=(await login('dave')).session;
    const native=await call('/api/app/login',{username:'dave',secret:password,device_id:device,app_version:'1.3.38'},'',{android:true});
    const overview=await call('/api/security/overview',undefined,web);assert.equal(overview.status,200);assert.ok(!JSON.stringify(overview.body).includes('sha256$'));assert.ok(!JSON.stringify(overview.body).includes(native.body.refresh_token));
    const target=overview.body.sessions.find(s=>s.kind==='android'&&s.valid);assert.ok(target);
    assert.equal((await call('/api/security/sessions/revoke',{mode:'single',kind:'android',id:target.id,grant:await grant(web,'sessions_revoke')},web)).status,200);
    assert.notEqual((await call('/api/app/session/refresh',{refresh_token:native.body.refresh_token,device_id:device,app_version:'1.3.38',rotation_key:crypto.randomUUID()},'',{android:true})).status,200);
    assert.equal((await call('/api/me',undefined,web)).status,200);
  });
  await test('step-up is scoped to action and session, one-use and generation-bound',async()=>{
    const a=(await login('alice')).session,b=(await login('alice')).session;
    const g=await grant(a,'sessions_revoke');
    assert.notEqual((await call('/api/security/mfa/disable',{grant:g},a)).status,200);
    assert.notEqual((await call('/api/security/sessions/revoke',{mode:'others',grant:g},b)).status,200);
    assert.equal((await call('/api/security/sessions/revoke',{mode:'others',grant:g},a)).status,200);
    assert.notEqual((await call('/api/security/sessions/revoke',{mode:'others',grant:g},a)).status,200);
  });
  await test('failed step-up password attempts remain rate limited before any grant',async()=>{
    const token=(await login('alice')).session;
    for(let i=0;i<5;i++)assert.equal((await call('/api/security/stepup',{password:'incorrect-password',scope:'sessions_revoke'},token)).status,403);
    assert.equal((await call('/api/security/stepup',{password,scope:'sessions_revoke'},token)).status,429);
  });
  await test('Android refresh cannot recreate access when revocation wins before its transaction',async()=>{
    const native=await call('/api/app/login',{username:'bob',secret:password,device_id:device,app_version:'1.3.38'},'',{android:true});assert.equal(native.status,200);
    let injected=false;
    const guardedDb={prepare:db.prepare.bind(db),async batch(statements){if(!injected){injected=true;await db.batch([
      db.prepare("UPDATE task20_device_sessions SET revoked=1 WHERE id=?1").bind(native.body.device_session.id),
      db.prepare("UPDATE task12_sessions SET revoked=1 WHERE token_digest=?1").bind(await sessionStorageKey(native.body.access_token)),
    ]);}return db.batch(statements);}};
    const refreshed=await call('/api/app/session/refresh',{refresh_token:native.body.refresh_token,device_id:device,app_version:'1.3.38',rotation_key:crypto.randomUUID()},'',{android:true,env:{WYJ_DB:guardedDb}});
    assert.ok(injected);assert.notEqual(refreshed.status,200);assert.equal(refreshed.body.access_token,undefined);
  });
  await test('administrator role revocation during reset invalidates the atomic authorization',async()=>{
    const admin=(await login('admin-a')).session,g=await grant(admin,'admin_reset:reset-user');
    const before=await one("SELECT password_hash FROM task12_users WHERE id='reset-user'");let injected=false;
    const guardedDb={prepare:db.prepare.bind(db),async batch(statements){if(!injected){injected=true;await sql("DELETE FROM task18_admin_roles WHERE user_id='admin-a'");}return db.batch(statements);}};
    const result=await call('/api/admin/secret',{user_id:'reset-user',grant:g},admin,{env:{WYJ_DB:guardedDb}});assert.ok(injected);assert.equal(result.status,409);
    assert.equal((await one("SELECT password_hash FROM task12_users WHERE id='reset-user'")).password_hash,before.password_hash);
    await sql("INSERT INTO task18_admin_roles(user_id,role,granted_by_user_id,granted_by_username,granted_at,updated_at) VALUES('admin-a','admin','owner','owner',?1,?1)",new Date().toISOString());
  });
  await test('30-day password advice is personal, throttled and never forces change',async()=>{
    const token=(await login('bob')).session;
    const before=await one("SELECT session_version FROM task12_users WHERE id='bob'");
    await call('/api/notifications',undefined,token);assert.equal((await one("SELECT COUNT(*) AS count FROM task27_notifications WHERE user_id='bob' AND message_type='password_advice'")).count,0);
    await sql("UPDATE task27_security SET password_age_start_at=?1,password_notice_at='' WHERE user_id='bob'",new Date(Date.now()-31*DAY).toISOString());
    const result=await call('/api/notifications',undefined,token);assert.ok(result.body.messages.some(m=>m.type==='password_advice'));
    await call('/api/notifications',undefined,token);assert.equal((await one("SELECT COUNT(*) AS count FROM task27_notifications WHERE user_id='bob' AND message_type='password_advice'")).count,1);
    assert.equal((await one("SELECT must_change_password FROM task27_security WHERE user_id='bob'")).must_change_password,0);assert.equal((await one("SELECT session_version FROM task12_users WHERE id='bob'")).session_version,before.session_version);
  });
  let inboxMessage;
  await test('broadcast/inbox channel is independent of recipients; release and policy routes enforced',async()=>{
    const admin=(await login('admin-a')).session;
    const base={title:'Synthetic notice',body:'Synthetic test content',message_type:'important',target_scope:'all',confirm_bulk_send:true,requires_confirmation:true,idempotency_key:crypto.randomUUID()};
    assert.equal((await call('/api/admin/messages',{...base,purpose:'version_update',delivery_channel:'inbox'},admin)).status,400);
    assert.equal((await call('/api/admin/messages',{...base,purpose:'policy_change',delivery_channel:'broadcast'},admin)).status,400);
    const personal=await call('/api/admin/messages',{...base,purpose:'policy_change',delivery_channel:'inbox'},admin);assert.equal(personal.status,201);inboxMessage=personal.body.message.id;
    const broadcast=await call('/api/admin/messages',{...base,requires_confirmation:false,purpose:'version_update',delivery_channel:'broadcast',idempotency_key:crypto.randomUUID()},admin);assert.equal(broadcast.status,201);
    const alice=(await login('alice')).session;
    const pending=await call('/api/messages/pending',undefined,alice);assert.ok(pending.body.messages.some(m=>m.id===broadcast.body.message.id));assert.ok(!pending.body.messages.some(m=>m.id===inboxMessage));
    assert.ok((await call('/api/notifications',undefined,alice)).body.messages.some(m=>m.id===inboxMessage));
  });
  await test('MFA advice uses one shared existing broadcast with 30-day throttle and no unread increment',async()=>{
    const a=(await login('alice')).session;
    await sql("UPDATE task27_security SET mfa_broadcast_at='' WHERE user_id='alice'");
    const count=(await call('/api/notifications',undefined,a)).body.unread_count;
    const pending=await call('/api/messages/pending',undefined,a);assert.ok(pending.body.messages.some(m=>m.purpose==='mfa_advice'));
    const repeated=await call('/api/messages/pending',undefined,a);assert.ok(!repeated.body.messages.some(m=>m.purpose==='mfa_advice'));
    assert.equal((await call('/api/notifications',undefined,a)).body.unread_count,count);
    assert.equal((await one("SELECT COUNT(*) AS count FROM admin_messages WHERE purpose='mfa_advice'")).count,1);
  });
  await test('cross-account inbox reads fail; read-all confirms count and never acknowledges mandatory messages',async()=>{
    const a=(await login('alice')).session,b=(await login('bob')).session;
    const personal=await one("SELECT id FROM task27_notifications WHERE user_id='bob' LIMIT 1");
    assert.equal((await call('/api/notifications/read',{id:personal.id,source:'security'},a)).status,404);
    const preview=await call('/api/notifications/read-all/preview',{},a);assert.ok(preview.body.count>0);
    assert.notEqual((await call('/api/notifications/read-all',{confirmation:preview.body.confirmation,confirm:true},b)).status,200);
    assert.notEqual((await call('/api/notifications/read-all',{confirmation:preview.body.confirmation,confirm:false},a)).status,200);
    assert.equal((await call('/api/notifications/read-all',{confirmation:preview.body.confirmation,confirm:true},a)).status,200);
    const receipt=await one('SELECT * FROM admin_message_receipts WHERE message_id=?1 AND user_id=?2',inboxMessage,'alice');assert.ok(receipt.read_at);assert.equal(receipt.acknowledged_at,'');
    assert.equal((await call('/api/messages/receipt',{message_id:inboxMessage,action:'acknowledge'},a)).status,200);
  });
  await test('mail previews, verified-recipient bounds, fixed identities and one-send semantics',async()=>{
    const admin=(await login('admin-a')).session;
    await sql("INSERT OR IGNORE INTO task27_security(user_id,password_age_start_at) VALUES('mail-user',?1)",new Date().toISOString());
    await sql("UPDATE task27_security SET verified_email='mail-fixture@example.test',email_verified_at=?1 WHERE user_id='mail-user'",new Date().toISOString());
    const choices=await call('/api/admin/email/recipients?q=mail-user',undefined,admin);assert.equal(choices.status,200);assert.deepEqual(choices.body.recipients.map(user=>user.id).sort(),['email-user','mail-user']);assert.ok(choices.body.recipients.every(user=>user.verified_email===undefined));
    assert.equal((await call('/api/admin/email/drafts',{subject:'Hi\r\nBcc: injected',body:'test',recipient_ids:['mail-user']},admin)).status,400);
    assert.equal((await call('/api/admin/email/drafts',{subject:'Synthetic service notice',body:'<script>synthetic</script>',recipient_ids:['alice']},admin)).status,409);
    const draft=await call('/api/admin/email/drafts',{subject:'Synthetic service notice',body:'<script>synthetic</script>',recipient_ids:['mail-user']},admin);assert.equal(draft.status,200);
    const id=draft.body.draft.id,revision=draft.body.draft.revision;
    const preview=await call('/api/admin/email/preview',{id},admin);assert.equal(preview.status,200);
    const payload={id,revision,preview:preview.body.preview,confirm:true,grant:await grant(admin,`email_send:${id}:${revision}`)};
    const sent=await call('/api/admin/email/send',payload,admin);assert.equal(sent.status,200);assert.equal(sent.body.inbox_delivery_confirmed,false);assert.ok(sent.body.jobs.some(j=>j.draft_id===id&&j.status==='queued'));
    assert.equal(messages.at(-1).from.email,'noreply@thewyj.uk');assert.equal(messages.at(-1).replyTo.email,'support@thewyj.uk');assert.ok(!messages.at(-1).html.includes('<script>'));assert.ok(messages.at(-1).headers['X-Aeris-Thread']);
    const count=messages.length;assert.notEqual((await call('/api/admin/email/send',payload,admin)).status,200);assert.equal(messages.length,count);
  });
  await test('mail uncertain outcomes are held and never automatically resent',async()=>{
    const admin=(await login('admin-a')).session;
    const d=(await call('/api/admin/email/drafts',{subject:'Synthetic unknown outcome',body:'Synthetic',recipient_ids:['mail-user']},admin)).body.draft;
    const preview=(await call('/api/admin/email/preview',{id:d.id},admin)).body;
    transport='unknown';const sent=await call('/api/admin/email/send',{id:d.id,revision:d.revision,preview:preview.preview,confirm:true,grant:await grant(admin,`email_send:${d.id}:${d.revision}`)},admin);transport='queued';
    assert.equal(sent.status,200);assert.ok(sent.body.jobs.some(j=>j.draft_id===d.id&&j.status==='unknown'));
    const again=(await call('/api/admin/email/preview',{id:d.id},admin)).body;
    const result=await call('/api/admin/email/send',{id:d.id,revision:d.revision,preview:again.preview,confirm:true,retry:true,grant:await grant(admin,`email_send:${d.id}:${d.revision}`)},admin);assert.equal(result.status,409);
  });
  await test('confirmed provider throttling permits bounded explicit retry after cooldown',async()=>{
    const admin=(await login('admin-a')).session;
    const d=(await call('/api/admin/email/drafts',{subject:'Synthetic provider throttle',body:'Synthetic',recipient_ids:['mail-user']},admin)).body.draft;
    const preview=(await call('/api/admin/email/preview',{id:d.id},admin)).body;
    transport='rate';const failed=await call('/api/admin/email/send',{id:d.id,revision:d.revision,preview:preview.preview,confirm:true,grant:await grant(admin,`email_send:${d.id}:${d.revision}`)},admin);transport='queued';
    assert.equal(failed.status,200);assert.ok(failed.body.jobs.some(j=>j.draft_id===d.id&&j.status==='failed'&&j.attempts===1));
    await sql('UPDATE task27_email_jobs SET updated_at=?2 WHERE draft_id=?1',d.id,new Date(Date.now()-61000).toISOString());
    const next=(await call('/api/admin/email/preview',{id:d.id},admin)).body;
    const retried=await call('/api/admin/email/send',{id:d.id,revision:d.revision,preview:next.preview,confirm:true,retry:true,grant:await grant(admin,`email_send:${d.id}:${d.revision}`)},admin);
    assert.equal(retried.status,200);assert.ok(retried.body.jobs.some(j=>j.draft_id===d.id&&j.status==='queued'&&j.attempts===2));
  });
  await test('current policy reacceptance gates business access and can be completed explicitly',async()=>{
    const token=(await login('alice')).session;
    await sql("UPDATE task12_metadata SET value='1' WHERE key='task27_require_policy_reaccept'");
    assert.equal((await call('/api/me',undefined,token)).status,428);
    assert.equal((await call('/api/policies/accept',{terms_accepted:true,policy_versions:POLICY_VERSIONS},token)).status,200);
    assert.equal((await call('/api/me',undefined,token)).status,200);
    await sql("UPDATE task12_metadata SET value='0' WHERE key='task27_require_policy_reaccept'");
  });
  await test('cross-origin and oversized or wrong-type inputs fail closed',async()=>{
    const token=(await login('alice')).session;
    assert.equal((await call('/api/security/stepup',{password,scope:'password_change'},token,{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await call('/api/security/stepup',{password:{malformed:true},scope:'password_change'},token)).status,400);
    assert.equal((await call('/api/security/stepup',{password:'x'.repeat(20000),scope:'password_change'},token)).status,413);
    assert.equal((await one('SELECT COUNT(*) AS count FROM task27_atomic_guard')).count,0);
  });
  console.log(`Task27: ${completed} isolated D1/API groups passed; real email, device, CI and Hosted not tested.`);
} finally {await runtime.dispose();await rm(temp,{recursive:true,force:true});}
