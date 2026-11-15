import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {onRequest} from '../../functions/api/[[path]].js';
import * as mail from '../../functions/_lib/email-service.mjs';
import {emailCenterIntegrated,sendTask27Code} from '../../functions/_lib/task27-email-adapter.mjs';
import {hashSecret,sessionStorageKey} from '../../functions/_lib/task12-crypto.mjs';

const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'.wrangler/task27-final/mail-compatibility',crypto.randomUUID());await mkdir(out,{recursive:true});
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('fixture')}}",compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB']});
const db=await mf.getD1Database('WYJ_DB'),integrated=emailCenterIntegrated(),password='MailFixture!Aa1-',messages=[];
let failTransport=false;
const env={WYJ_DB:db,WYJ_ENVIRONMENT:'development',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',TASK18_ADMIN_MESSAGES_ENABLED:'true',TASK20_ANDROID_APP_ENABLED:'true',TASK27_SECURITY_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',
 WYJ_TASK12_PASSWORD_PEPPER:'task27-mail-fixture-pepper-0123456789',WYJ_TASK20_DEVICE_SESSION_SECRET:'task27-mail-fixture-device-0123456789',WYJ_TASK27_CHALLENGE_SECRET:'task27-mail-fixture-challenge-0123456789',WYJ_TASK27_TOTP_KEY:Buffer.alloc(32,15).toString('base64url'),
 EMAIL_SENDING_ENABLED:'true',EMAIL_TRANSPORT:'binding',EMAIL_TEST_RECIPIENTS:'',EMAIL:{async send(payload){messages.push(payload);if(failTransport)throw new Error('synthetic transport failure');return {messageId:crypto.randomUUID(),delivered:[{email:'synthetic@example.test'}],queued:[]};}}};
const proof={scope:'isolated synthetic D1 and transport; actual combined dispatcher when EMAIL_BUILD supports the full center; no remote writes',integrated,checks:[],producer_findings:[],real_email:'NOT_TESTED'};
const sql=async(text,...args)=>db.prepare(text).bind(...args).run(),one=async(text,...args)=>db.prepare(text).bind(...args).first();
async function call(route,body,token='',headers={}){const work=[];const response=await onRequest({env,data:{requestId:crypto.randomUUID()},request:new Request('https://fixture.invalid'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),waitUntil(p){work.push(p);}});await Promise.all(work);return {status:response.status,body:await response.json()};}
async function check(name,fn){await sql('DELETE FROM cloud_rate_limit_windows');await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function login(id){const result=await call('/api/login',{username:id,secret:password});assert.equal(result.status,200,JSON.stringify(result));return result.body;}
async function grant(session,scope){const result=await call('/api/security/stepup',{password,scope},session);assert.equal(result.status,200,JSON.stringify(result));return result.body.grant;}
const code=()=>messages.at(-1).text.match(/验证码：(\d{6})/u)[1];
const snapshotColumns={};
async function snapshot(){const tables=['task12_users','task12_sessions','task20_device_sessions','task13_user_memberships','task16_finance_transactions','task11_learning_sync_records'];const result={};for(const table of tables){snapshotColumns[table] ||= (await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(row=>row.name);result[table]=createHash('sha256').update(JSON.stringify((await db.prepare(`SELECT ${snapshotColumns[table].map(column=>`"${column}"`).join(',')} FROM ${table} ORDER BY rowid`).all()).results)).digest('hex');}return result;}
async function migrate(name){await db.exec((await readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/^\s*--.*$/gm,'').replace(/\r?\n/g,' '));}
try{
 const migrations=(await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
 for(const name of migrations.filter(n=>n<'0035_'))await migrate(name);
 const when='2020-01-01T00:00:00Z',hash=await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER);
 for(const [id,role]of [['mail-owner','super_admin'],['mail-user','user'],['mail-other','user']])await sql(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,?2,'pbkdf2_sha256',310000,?3,?4,?4,?4,?4)`,id,hash,role,when);
 await sql(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,'mail-user',1,?2,?2,'2099-01-01T00:00:00Z','browser')`,await sessionStorageKey('existing-mail-fixture'),when);
 await sql(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,status,source,created_at,updated_at) VALUES('mail-member','mail-user','finance_monthly',?1,'2099-01-01T00:00:00Z','active','synthetic',?1,?1)`,when);
 await sql(`INSERT INTO task16_finance_transactions(id,user_id,direction,amount_minor,currency,occurred_at_ms,source_kind,created_at,updated_at) VALUES('mail-tx-0001','mail-user','expense',12345,'CNY',1700000000000,'manual',?1,?1)`,when);
 await sql(`INSERT INTO task11_learning_sync_records(user_id,data_type,record_id,payload_json,updated_at,client_id,client_version,created_at,server_updated_at) VALUES('mail-user','learning_config','mail-profile','{"profile":"retained synthetic"}',?1,'fixture-client','synthetic',?1,?1)`,when);
 const before=await snapshot();
 await check('0035 and optional 0036 preserve business records; unsafe raw 0035 repetition is rejected and 0036 is idempotent',async()=>{
  const next=migrations.filter(n=>n>='0035_');assert.equal(next[0],'0035_task27_security_center.sql');if(integrated)assert.equal(next[1],'0036_task27_email_center.sql');
  for(const name of next)await migrate(name);
  await assert.rejects(migrate(next[0]),/already exists/u);
  if(integrated)await migrate(next[1]);
  assert.deepEqual(await snapshot(),before);proof.preserved_business_digests=before;proof.migration_order=next;
  assert.equal((await one("SELECT COUNT(*) AS n FROM task27_security WHERE mfa_method!='none' OR must_change_password!=0")).n,0);
  assert.equal((await call('/api/me',undefined,'existing-mail-fixture')).status,200);
 });
 await check('public capabilities accurately select one mail center without changing enrollment or sending settings',async()=>{const result=await call('/api/policies');assert.equal(result.body.mail_center_integrated,integrated);assert.equal(result.body.mail_center_ready,integrated);});
 let session=(await login('mail-user')).session;
 await check('failed OTP dispatch consumes its challenge and cannot mark the email verified',async()=>{failTransport=true;const result=await call('/api/security/email/start',{email:'first@example.test',grant:await grant(session,'email_change')},session);failTransport=false;assert.ok(result.status>=400);assert.equal(result.body.challenge,undefined);assert.equal((await one("SELECT verified_email FROM task27_security WHERE user_id='mail-user'")).verified_email,'');assert.equal((await one("SELECT COUNT(*) AS n FROM task27_challenges WHERE user_id='mail-user' AND kind='email_bind' AND consumed_at=''")).n,0);});
 await check('ownership proof updates authoritative email and optional center binding together, revokes sessions and emits one notice',async()=>{
  const start=await call('/api/security/email/start',{email:'first@example.test',grant:await grant(session,'email_change')},session);assert.equal(start.status,200,JSON.stringify(start));assert.match(messages.at(-1).text,/(5|五)\s*分钟/u);assert.equal(start.body.inbox_confirmed,false);
  const otp=code(),count=messages.length,finish=await call('/api/security/email/confirm',{challenge:start.body.challenge,code:otp},session);assert.equal(finish.status,200,JSON.stringify(finish));assert.equal(messages.length-count,1);assert.equal(finish.body.mail.inbox_confirmed,false);assert.notEqual((await call('/api/me',undefined,session)).status,200);
  const state=await one("SELECT verified_email,email_verified_at FROM task27_security WHERE user_id='mail-user'");assert.equal(state.verified_email,'first@example.test');
  if(integrated){const binding=await one("SELECT * FROM email_center_bindings WHERE user_id='mail-user'");assert.equal(binding.email,state.verified_email);assert.equal(binding.verified,1);assert.equal(binding.verified_at,state.email_verified_at);const deliveries=(await db.prepare("SELECT * FROM email_center_deliveries WHERE kind IN ('verification_code','email_bind_verification','login_mfa_code')").all()).results;assert.ok(deliveries.length>0);for(const row of deliveries){assert.equal(row.target_user_id,'mail-user');assert.equal(Number(row.body_redacted),1);assert.ok(!JSON.stringify(row).includes(otp),'OTP must not enter persisted delivery data');}}
 });
 session=(await login('mail-user')).session;
 await check('unique authoritative email rejects another owner and leaves both tables and sessions unchanged',async()=>{const other=(await login('mail-other')).session,start=await call('/api/security/email/start',{email:'first@example.test',grant:await grant(other,'email_change')},other);assert.equal(start.status,200);const result=await call('/api/security/email/confirm',{challenge:start.body.challenge,code:code()},other);assert.ok(result.status>=400);assert.equal((await one("SELECT verified_email FROM task27_security WHERE user_id='mail-other'")).verified_email,'');if(integrated)assert.equal(await one("SELECT * FROM email_center_bindings WHERE user_id='mail-other'"),null);assert.equal((await call('/api/me',undefined,other)).status,200);});
 await check('MFA email failure issues no full session and only a successfully completed challenge can authenticate',async()=>{
  const start=await call('/api/security/mfa/start',{method:'email',grant:await grant(session,'mfa_change')},session);assert.equal(start.status,200,JSON.stringify(start));assert.equal((await call('/api/security/mfa/confirm',{challenge:start.body.challenge,code:code()},session)).status,200);
  const count=(await one("SELECT COUNT(*) AS n FROM task12_sessions WHERE user_id='mail-user'")).n;failTransport=true;const failed=await call('/api/login',{username:'mail-user',secret:password});failTransport=false;assert.ok(failed.status>=400);assert.equal(failed.body.session,undefined);assert.equal(failed.body.challenge,undefined);assert.equal((await one("SELECT COUNT(*) AS n FROM task12_sessions WHERE user_id='mail-user'")).n,count);
  const pending=await login('mail-user');assert.equal(pending.mfa_required,true);assert.equal(pending.session,undefined);assert.equal((await call('/api/security/login/verify',{challenge:pending.challenge,code:code()})).status,200);
 });
 if(integrated){
  await check('missing full-center schema fails before dispatch and divergent verified records cannot receive an auth code',async()=>{
   const count=messages.length;await sql("UPDATE email_center_bindings SET email='drift@example.test' WHERE user_id='mail-user'");await assert.rejects(sendTask27Code(env,{to:'first@example.test',code:'123456',purpose:'登录验证',userId:'mail-user',challengeDigest:'drift'}),error=>error.code==='email_binding_conflict');await sql("UPDATE email_center_bindings SET email='first@example.test' WHERE user_id='mail-user'");
   await sql('ALTER TABLE email_center_metadata RENAME TO fixture_missing_metadata');try{await assert.rejects(sendTask27Code(env,{to:'first@example.test',code:'123456',purpose:'登录验证',userId:'mail-user',challengeDigest:'schema'}),error=>error.code==='email_center_schema_not_ready');}finally{await sql('ALTER TABLE fixture_missing_metadata RENAME TO email_center_metadata');}assert.equal(messages.length,count);
  });
  const owner=(await login('mail-owner')).session;
  await check('the canonical mail API rejects old draft payloads, unauthorized sessions, binding writes and absent or replayed step-up',async()=>{
   assert.equal((await call('/api/admin/email/drafts')).status,401);assert.equal((await call('/api/admin/email/user-binding',{user_id:'mail-other',email:'attacker@example.test',verified:true},owner)).status,403);
   assert.ok((await call('/api/admin/email/send',{id:'legacy-draft'},owner)).status>=400);
   const token=await grant(owner,'email_center:send'),headers={'X-Aeris-Stepup':token};assert.ok((await call('/api/admin/email/send',{id:'legacy-draft'},owner,headers)).status>=400);assert.ok((await call('/api/admin/email/send',{id:'legacy-draft'},owner,headers)).status>=400);
   assert.equal((await one('SELECT COUNT(*) AS n FROM task27_email_drafts')).n,0);
   assert.equal((await call('/api/admin/email/drafts',undefined,owner)).status,200);
  });
  await check('canonical draft and preview payloads send once even with concurrent separately authorized confirmations',async()=>{
   const payload={target_mode:'single',recipient_user_ids:['mail-user'],sender_kind:'system',subject:'Synthetic canonical notice',body:'Synthetic combined mail only.'};
   const draft=await call('/api/admin/email/drafts',payload,owner);assert.equal(draft.status,200,JSON.stringify(draft));
   const preview=await call('/api/admin/email/preview',{...payload,draft_id:draft.body.draft_id},owner);assert.equal(preview.status,200,JSON.stringify(preview));
   const grants=await Promise.all([1,2].map(()=>grant(owner,'email_center:send'))),count=messages.length;
   const sends=await Promise.all(grants.map(token=>call('/api/admin/email/send',{preview_token:preview.body.preview_token,confirmed:true,subject:payload.subject,body:payload.body},owner,{'X-Aeris-Stepup':token})));
   assert.equal(sends.filter(result=>result.status===200).length,1,JSON.stringify(sends));assert.equal(messages.length-count,1);
   assert.equal((await one('SELECT COUNT(*) AS n FROM task27_email_drafts')).n,0);
  });
  await check('atomic binding bridge and concurrent identical-idempotency-key protection enforce fixed producer invariants',async()=>{
   const old=await one("SELECT version FROM task27_security WHERE user_id='mail-other'");
   await assert.rejects(()=>mail.upsertUserEmailBinding(db,{userId:'mail-other',email:'first@example.test',verified:true,actorUserId:'mail-owner'}),error=>error.code==='email_binding_conflict'&&error.status===409);
   const center=await one("SELECT email,verified FROM email_center_bindings WHERE user_id='mail-other'"),security=await one("SELECT verified_email,version FROM task27_security WHERE user_id='mail-other'");
   assert.equal(center,null,'email_center_bindings MUST roll back atomically on unique email conflict');
   assert.equal(security?.version,old.version,'task27_security.version MUST stay untouched on conflict');
   let calls=0;
   const parallelEnv={...env,EMAIL:{async send(){calls++;await new Promise(resolve=>setTimeout(resolve,80));return {messageId:crypto.randomUUID(),queued:[{}],delivered:[]};}}};
   const outcomes=await Promise.allSettled([1,2].map(()=>mail.sendTransactionalEmail(parallelEnv,{kind:'account_security_notice',to:'first@example.test',userId:'mail-user',requireVerifiedEmail:true,idempotencyKey:'synthetic-concurrent-probe',eventSummary:'Synthetic idempotency probe'})));
   assert.equal(calls,1,JSON.stringify(outcomes));
   assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);
   assert.equal(outcomes.filter(item=>item.status==='rejected'&&item.reason?.code==='email_idempotency_in_flight').length,1);
   proof.producer_probe_completed=true;
  });
 }
 proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;console.error(error.stack);}
finally{await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');await mf.dispose();console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,producer_findings:proof.producer_findings,evidence:path.relative(root,out),error:proof.error}));}

