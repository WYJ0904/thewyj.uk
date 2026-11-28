import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash,pbkdf2Sync} from 'node:crypto';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {hashSecret,sessionStorageKey} from '../../functions/_lib/task12-crypto.mjs';
import {task20DeviceDigest} from '../../functions/_lib/task20-crypto.mjs';
import {temporaryPassword} from '../../functions/_lib/task27-crypto.mjs';
import {POLICY_VERSIONS} from '../../functions/_lib/task27-policy.mjs';

const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'.wrangler/task27-increment',crypto.randomUUID());await mkdir(out,{recursive:true});
const pepper='task27-upgrade-synthetic-pepper-0123456789',oldPassword='123456',newPassword='Abcde1!x';
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
const mf=new Miniflare({modules:true,scriptPath:path.join(root,'.wrangler/functions-build/index.js'),compatibilityDate:config.compatibility_date,d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE'],bindings:{...config.env.preview.vars,WYJ_ENVIRONMENT:'development',WORKERS_AI_ENABLED:'false',EMAIL_SENDING_ENABLED:'false',TASK27_SECURITY_ENABLED:'true',
  WYJ_TASK12_PASSWORD_PEPPER:pepper,WYJ_TASK20_DEVICE_SESSION_SECRET:'task27-upgrade-synthetic-device-0123456789',WYJ_TASK27_CHALLENGE_SECRET:'task27-upgrade-synthetic-challenge-0123456789',WYJ_TASK27_TOTP_KEY:Buffer.alloc(32,3).toString('base64url')},serviceBindings:{ASSETS:()=>new Response('fixture',{status:404})}});
const db=await mf.getD1Database('WYJ_DB');
const proof={scope:'synthetic pre-0035 D1 records upgraded once; actual compiled Pages worker; no real accounts or remote data',checks:[],production:'NOT_TESTED',room_or_phone_operations:0};
const run=async(sql,...values)=>db.prepare(sql).bind(...values).run();
const one=async(sql,...values)=>db.prepare(sql).bind(...values).first();
async function call(route,body,token='',native=false){const r=await mf.dispatchFetch('https://upgrade.local'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','User-Agent':native?'thewyj-android/1.3.38 Android/36':'Task27 upgrade fixture',...(token?{'X-Session-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function check(name,fn){await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function registration(username,secret){return call('/api/register',{username,secret,confirm_secret:secret,terms_accepted:true,policy_versions:POLICY_VERSIONS});}
const tables=['task12_users','task12_sessions','task20_device_sessions','task13_user_memberships','task16_finance_transactions','task11_learning_sync_records'];
let columns={};
async function snapshots(){const result={};for(const table of tables){const data=(await db.prepare(`SELECT ${columns[table].map(c=>'"'+c+'"').join(',')} FROM ${table} ORDER BY rowid`).all()).results;result[table]=createHash('sha256').update(JSON.stringify(data)).digest('hex');}return result;}
try{
 const names=(await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
 for(const name of names.filter(n=>n<'0035_'))await db.exec((await readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
 const when='2020-01-01T00:00:00Z',expiry='2099-01-01T00:00:00Z',salt=Buffer.alloc(16,7);
 const legacyHash=`pbkdf2_sha256$310000$${salt.toString('base64url')}$${pbkdf2Sync(oldPassword,salt,310000,32,'sha256').toString('base64url')}`;
 for(const [id,hash,role]of [['legacy-owner',legacyHash,'super_admin'],['legacy:cf.user@example.test',await hashSecret(oldPassword,pepper),'user']])await run(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,session_version,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,?2,'pbkdf2_sha256',310000,?3,3,?4,?4,?4,?4)`,id,hash,role,when);
 const oldWeb='synthetic-existing-web-session',oldAccess='synthetic-existing-android-access',oldRefresh='synthetic-existing-refresh',device='663a75e0-0c27-4c0b-9ed7-608a8d05c235';
 for(const token of [oldWeb,oldAccess])await run(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,'legacy:cf.user@example.test',3,?2,?2,?3,?4)`,await sessionStorageKey(token),when,expiry,token===oldWeb?'browser':'android_app');
 await run(`INSERT INTO task20_device_sessions(id,user_id,device_id_digest,refresh_token_digest,access_token_digest,session_version,app_version,created_at,last_seen_at,access_expires_at,refresh_expires_at) VALUES(?1,'legacy:cf.user@example.test',?2,?3,?4,3,'1.3.37',?5,?5,?6,?6)`,crypto.randomUUID(),await task20DeviceDigest(device),await sessionStorageKey(oldRefresh),await sessionStorageKey(oldAccess),when,expiry);
 await run(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,status,source,created_at,updated_at) VALUES('upgrade-member','legacy:cf.user@example.test','finance_monthly',?1,?2,'active','synthetic',?1,?1)`,when,expiry);
 await run(`INSERT INTO task16_finance_transactions(id,user_id,direction,amount_minor,currency,occurred_at_ms,source_kind,created_at,updated_at) VALUES('upgrade-tx-0001','legacy:cf.user@example.test','expense',12345,'CNY',1700000000000,'manual',?1,?1)`,when);
 await run(`INSERT INTO task11_learning_sync_records(user_id,data_type,record_id,payload_json,updated_at,client_id,client_version,created_at,server_updated_at) VALUES('legacy:cf.user@example.test','learning_config','synthetic-profile','{"profile":"Synthetic retained profile"}',?1,'upgrade-fixture','synthetic',?1,?1)`,when);
 for(const table of tables)columns[table]=(await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(row=>row.name);
 const before=await snapshots();
 await check('0035 and 0036 preserve all existing user, verifier, session, membership, finance and learning columns',async()=>{
  await db.exec((await readFile(path.join(root,'cloudflare/migrations/0035_task27_security_center.sql'),'utf8')).replace(/\r?\n/g,' '));
  assert.deepEqual(await snapshots(),before);
  await db.exec((await readFile(path.join(root,'cloudflare/migrations/0036_task27_email_center.sql'),'utf8')).replace(/\r?\n/g,' '));
  assert.deepEqual(await snapshots(),before);proof.pre_migration_business_digests=before;
  const state=(await db.prepare('SELECT * FROM task27_security').all()).results;assert.equal(state.length,2);assert.ok(state.every(row=>row.mfa_method==='none'&&row.must_change_password===0&&row.password_changed_at===''));
  assert.equal((await one('SELECT COUNT(*) AS count FROM task27_notifications')).count,0);
 });
 await check('existing Web session and finance membership survive without re-registration or MFA enrollment',async()=>{
  const current=await call('/api/me',undefined,oldWeb);assert.equal(current.status,200);assert.equal(current.body.account.id,'legacy:cf.user@example.test');assert.ok(current.body.account.entitlements.includes('finance_access'));assert.equal(current.body.account.role,'user');
 });
 await check('existing Android refresh credential survives the additive upgrade',async()=>{
  const current=await call('/api/app/session/refresh',{refresh_token:oldRefresh,device_id:device,app_version:'1.3.38',rotation_key:crypto.randomUUID()},'',true);assert.equal(current.status,200);assert.equal(current.body.account.id,'legacy:cf.user@example.test');assert.ok(current.body.refresh_token);
 });
 let oldUserSession,ownerSession;
 await check('six-character legacy PBKDF2 and Cloudflare verifiers still authenticate in workerd',async()=>{
  for(const username of ['legacy-owner','legacy:cf.user@example.test']){const current=await call('/api/login',{username,secret:oldPassword});assert.equal(current.status,200);assert.ok(current.body.session);assert.ok(!current.body.mfa_required&&!current.body.password_change_required);if(username==='legacy:cf.user@example.test')oldUserSession=current.body.session;else ownerSession=current.body.session;}
  assert.equal((await one("SELECT must_change_password FROM task27_security WHERE user_id='legacy:cf.user@example.test'")).must_change_password,0);
 });
 const denied=[['seven','Abcd1!x'],['upper','abcdef12!'],['lower','ABCDEF12!'],['digit','Abcdefgh!'],['symbol','Abcdef123'],['common','Password1!'],['unicode-seven','Aa1!💫xx'],['space-symbol','Abcdef123 '],['too-long','Ab1!'+'x'.repeat(125)]];
 await check('direct registration API rejects seven characters, every missing class, common weak passwords and overlength',async()=>{
  for(const [label,password]of denied){const result=await registration('deny-'+label,password);assert.equal(result.status,400);assert.ok(result.body.error);assert.equal((await one('SELECT COUNT(*) AS count FROM task12_users WHERE username_normalized=?1','deny-'+label)).count,0);}
 });
 let newAccount;
 await check('eight-character compliant, Unicode and 128-character passwords register successfully',async()=>{
  for(const [username,password]of [['new-eight',newPassword],['new-unicode','Aa1!中中中中'],['new-long','Ab1!'+'x'.repeat(124)]]){const result=await registration(username,password);assert.equal(result.status,201);if(username==='new-eight')newAccount=result.body.account;}
 });
 await check('old password can authorize a voluntary change, while the newly chosen password must satisfy new policy',async()=>{
  const step=await call('/api/security/stepup',{password:oldPassword,scope:'password_change'},oldUserSession);assert.equal(step.status,200);
  assert.equal((await call('/api/account/secret',{new_secret:'Abcd1!x',confirm_secret:'Abcd1!x',grant:step.body.grant},oldUserSession)).status,400);
  assert.equal((await call('/api/account/secret',{new_secret:newPassword,confirm_secret:newPassword,grant:step.body.grant},oldUserSession)).status,200);
  assert.equal((await call('/api/me',undefined,oldUserSession)).status,401);
  assert.equal((await call('/api/login',{username:'legacy:cf.user@example.test',secret:newPassword})).status,200);
 });
 await check('every server-generated 20-character temporary password includes all four required classes',async()=>{
  for(let i=0;i<1000;i++){const password=temporaryPassword();assert.equal(password.length,20);assert.match(password,/[A-Z]/);assert.match(password,/[a-z]/);assert.match(password,/[0-9]/);assert.match(password,/[^A-Za-z0-9]/);}
 });
 await check('legacy opaque IDs remain valid step-up/reset targets and verified-mail recipients',async()=>{
  const scope='admin_reset:legacy:cf.user@example.test',step=await call('/api/security/stepup',{password:oldPassword,scope},ownerSession);assert.equal(step.status,200);
  const reset=await call('/api/admin/secret',{user_id:'legacy:cf.user@example.test',grant:step.body.grant},ownerSession);assert.equal(reset.status,200);assert.equal(reset.body.temporary_password.length,20);
  await run("UPDATE task27_security SET verified_email='retained-fixture@example.test',email_verified_at=?1 WHERE user_id='legacy:cf.user@example.test'",new Date().toISOString());
  const draft=await call('/api/admin/email/drafts',{subject:'Synthetic existing-ID check',body:'Synthetic service integration',recipient_user_ids:['legacy:cf.user@example.test']},ownerSession);assert.equal(draft.status,200);
  const preview=await call('/api/admin/email/preview',{target_mode:'single',subject:'Synthetic existing-ID check',body:'Synthetic service integration',recipient_user_ids:['legacy:cf.user@example.test']},ownerSession);assert.equal(preview.status,200);assert.equal(preview.body.effective_recipient_count,1);
 });
 await check('unverified email cannot enable email MFA and unavailable mail never reports a sent code',async()=>{
  const login=await call('/api/login',{username:'new-eight',secret:newPassword}),token=login.body.session;
  const mfaStep=await call('/api/security/stepup',{password:newPassword,scope:'mfa_change'},token);
  const denied=await call('/api/security/mfa/start',{method:'email',grant:mfaStep.body.grant},token);assert.equal(denied.status,400);assert.equal(denied.body.code,'verified_email_required');
  const emailStep=await call('/api/security/stepup',{password:newPassword,scope:'email_change'},token);
  const binding=await call('/api/security/email/start',{email:'synthetic@example.test',grant:emailStep.body.grant},token);assert.equal(binding.status,503);assert.equal(binding.body.code,'email_sending_unavailable');assert.equal(binding.body.challenge,undefined);
  for(const username of ['new-eight','nonexistent-user']){const forgot=await call('/api/security/password/request',{username,method:'email'});assert.equal(forgot.status,503);assert.equal(forgot.body.code,'email_sending_unavailable');assert.equal(forgot.body.challenge,undefined);}
  assert.equal((await one('SELECT verified_email FROM task27_security WHERE user_id=?1',newAccount.id)).verified_email,'');
 });
 await check('voluntary password operations leave membership, finance and learning content unchanged',async()=>{
  const after=await snapshots();for(const table of ['task13_user_memberships','task16_finance_transactions','task11_learning_sync_records'])assert.equal(after[table],before[table]);
 });
 proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;console.error(error.stack);}
finally{await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');await mf.dispose();console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,evidence:path.relative(root,out),error:proof.error}));}
