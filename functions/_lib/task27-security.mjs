import { hashSecret, PASSWORD_HASH_ITERATIONS, sessionStorageKey, verifySecret } from './task12-crypto.mjs';
import { isAdminAccount, isOwnerAccount, MIN_SECRET_LENGTH, validateSecret } from './task12-model.mjs';
import { task20TokenFromRequest } from './task20-model.mjs';
import { cleanEmailAddress,emailSendingEnabled,emailBindingConfigured,EmailServiceError,parseAllowedTestRecipients } from './email-service.mjs';
import { activeUser, assertion, atomic, changed, DAY, EVENT_TEXT, eventStatements, fail, first, generationAssertion, nowIso, rows, run, securityState, stmt, revokeAllStatements } from './task27-store.mjs';
import { base32, encryptTotp, randomBytes, randomDigits, temporaryPassword,totpUri } from './task27-crypto.mjs';
import { challengeAssertion, challengeIdentity, challengeRow, createChallenge, grantStatements, securityRate, sendCode, task27EnrollmentEnabled, verifyChallenge, verifyPassword } from './task27-auth.mjs';
import {sendTask27SecurityNotice,verifiedEmailSyncStatements} from './task27-email-adapter.mjs';

export async function identity(context,account) {
  const db=context.env.WYJ_DB;
  return {db,user:await activeUser(db,account.id),state:await securityState(db,account.id),sessionDigest:await sessionStorageKey(task20TokenFromRequest(context.request))};
}
function activeSessionAssertion(db,user,sessionDigest) {
  return assertion(db,'EXISTS(SELECT 1 FROM task12_sessions WHERE token_digest=? AND user_id=? AND revoked=0 AND expires_at>? AND session_version=?)',[sessionDigest,user.id,nowIso(),Number(user.session_version)]);
}
export async function authorize(context,account,grant,scope) {
  const value=await identity(context,account);
  return {...value,guards:await grantStatements(value.db,grant,value.user,value.state,value.sessionDigest,scope)};
}
function bumpStatements(db,user,state,assignments='',values=[]) {
  const when=nowIso();
  return [stmt(db,`UPDATE task27_security SET version=version+1${assignments ? ','+assignments : ''} WHERE user_id=?`,[...values,user.id]),
    stmt(db,'UPDATE task12_users SET session_version=session_version+1,updated_at=?2,source_updated_at=?2 WHERE id=?1',[user.id,when]),
    ...revokeAllStatements(db,user.id,when)];
}
async function notify(context,userId,event,emailOverride='') {
  const state=await securityState(context.env.WYJ_DB,userId);
  const email=emailOverride || state.verified_email;
  if (!email) return {delivery_status:'not_configured',inbox_confirmed:false};
  try {
    const result=await sendTask27SecurityNotice(context.env,{to:email,userId,event,eventSummary:EVENT_TEXT[event][1],requestId:context.data?.requestId,previouslyVerified:Boolean(emailOverride)});
    return {delivery_status:result.delivery_status,inbox_confirmed:false};
  } catch (error) { return {delivery_status:'failed',code:String(error?.code || 'email_unavailable'),inbox_confirmed:false}; }
}
function recoveryCodes() {
  return Array.from({length:10},()=>base32(randomBytes(20)).match(/.{8}/g).join('-'));
}
async function recoveryStatements(db,userId,codes) {
  return [stmt(db,'DELETE FROM task27_recovery_codes WHERE user_id=?1',[userId]),
    ...await Promise.all(codes.map(async code=>stmt(db,'INSERT INTO task27_recovery_codes(user_id,code_hash,created_at) VALUES(?1,?2,?3)',[userId,await sessionStorageKey(code),nowIso()])))];
}
function passwordStatements(db,user,hash) {
  const when=nowIso();
  return [stmt(db,`UPDATE task12_users SET password_hash=?2,password_scheme='pbkdf2_sha256',password_iterations=?3 WHERE id=?1`,[user.id,hash,PASSWORD_HASH_ITERATIONS]),
    stmt(db,"UPDATE task27_security SET password_changed_at=?2,password_age_start_at=?2,password_notice_at='',must_change_password=0 WHERE user_id=?1",[user.id,when])];
}
export async function changePassword(context,account,payload) {
  const {db,user,state,guards}=await authorize(context,account,payload.grant,'password_change');
  const secret=validateSecret(payload.new_secret);
  if (payload.confirm_secret!==secret) fail('secret_mismatch','两次输入的密码不一致');
  if ((await verifySecret(secret,user.password_hash,context.env.WYJ_TASK12_PASSWORD_PEPPER)).valid) fail('password_unchanged','请设置不同的新密码');
  const hash=await hashSecret(secret,context.env.WYJ_TASK12_PASSWORD_PEPPER);
  await atomic(db,[...guards,...passwordStatements(db,user,hash),...bumpStatements(db,user,state),...eventStatements(db,user.id,'password_changed',user.id,context.data?.requestId)]);
  return {session_invalidated:true,mail:await notify(context,user.id,'password_changed')};
}
export async function finishPasswordRecovery(context,payload,kind='password_reset') {
  const db=context.env.WYJ_DB, secret=validateSecret(payload.new_secret);
  if (payload.confirm_secret!==secret) fail('secret_mismatch','两次输入的密码不一致');
  let proof;
  if (kind==='password_change') {
    const row=await challengeRow(db,payload.challenge,kind);
    if (row.method!=='none') fail();
    const {user,state}=await challengeIdentity(db,row);
    proof={row,user,state};
  } else {
    proof=await verifyChallenge(db,context.env,payload.challenge,kind,payload.code,{allowRecovery:true});
  }
  const {user,state,row}=proof;
  const hash=await hashSecret(secret,context.env.WYJ_TASK12_PASSWORD_PEPPER);
  const event=kind==='password_change'?'password_changed':'password_recovered';
  await atomic(db,[...generationAssertion(db,user,state),...(kind==='password_change'?challengeAssertion(db,row):[]),
    ...passwordStatements(db,user,hash),...bumpStatements(db,user,state),...eventStatements(db,user.id,event,user.id,context.data?.requestId)]);
  return {session_invalidated:true,mfa_preserved:true,mail:await notify(context,user.id,event)};
}
export async function resetOtherPassword(context,account,payload) {
  const {db,user,state,guards}=await authorize(context,account,payload.grant,`admin_reset:${payload.user_id}`);
  if (!isAdminAccount(user)) fail('forbidden','无管理员权限',403);
  const target=await activeUser(db,payload.user_id);
  if (isOwnerAccount(target) || target.id===user.id) fail('owner_protected','不能通过此功能重置自身或超级管理员密码',403);
  const targetState=await securityState(db,target.id);
  const secret=validateSecret(temporaryPassword()), hash=await hashSecret(secret,context.env.WYJ_TASK12_PASSWORD_PEPPER);
  await atomic(db,[...guards,...generationAssertion(db,target,targetState),...passwordStatements(db,target,hash),
    ...bumpStatements(db,target,targetState,'must_change_password=1'),...eventStatements(db,target.id,'password_reset',user.id,context.data?.requestId),
    stmt(db,`INSERT INTO task18_admin_action_audit(id,actor_user_id,actor_username,actor_role,target_type,target_id,target_label,action,success,request_id,created_at)
      VALUES(?1,?2,?3,?4,'user',?5,'password_reset','password_reset',1,?6,?7)`,[crypto.randomUUID(),user.id,user.username,isOwnerAccount(user)?'super_admin':'admin',target.id,String(context.data?.requestId || ''),nowIso()])]);
  return {temporary_password:secret,display_once:true,session_invalidated:true,mfa_preserved:true,mail:await notify(context,target.id,'password_reset')};
}
export async function beginEmailBinding(context,account,payload) {
  const email=cleanEmailAddress(payload.email);
  const {db,user,state,sessionDigest,guards}=await authorize(context,account,payload.grant,'email_change');
  await securityRate(context,'email-bind',user.id,3,900);
  await securityRate(context,'email-bind-recipient',await sessionStorageKey(email),3,900);
  if(!emailSendingEnabled(context.env)||!emailBindingConfigured(context.env))throw new EmailServiceError('邮件服务尚不可用，验证码未发送',503,'email_sending_unavailable',true);
  const allowedRecipients=parseAllowedTestRecipients(context.env);
  if (allowedRecipients.length>0 && !allowedRecipients.includes(email)) {
    throw new EmailServiceError('email_recipient_not_allowlisted','当前测试环境已启用收件白名单限制，仅允许向授权测试邮箱发送验证码；此地址未允许发信，邮箱未完成绑定。',403);
  }
  await atomic(db,guards);
  const code=randomDigits();
  // Sending the ownership challenge does not reveal whether the address is
  // already associated with another account. Uniqueness is checked on confirm.
  const challenge=await createChallenge(db,{user,state,kind:'email_bind',method:'email',sessionDigest,code,env:context.env,data:{email}});
  let sent;
  try { sent=await sendCode(context.env,email,code,'绑定邮箱',context.data?.requestId,{userId:user.id,challengeDigest:challenge.digest}); }
  catch(error) { await run(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[challenge.digest,nowIso()]);throw error; }
  return {challenge:challenge.token,expires_at:challenge.expires_at,delivery_status:sent.delivery_status,inbox_confirmed:false,message:'验证码已交给邮件服务处理，不代表已抵达收件箱。'};
}
export async function finishEmailBinding(context,account,payload) {
  const {db,sessionDigest}=await identity(context,account);
  const {user,state,data}=await verifyChallenge(db,context.env,payload.challenge,'email_bind',payload.code,{sessionDigest});
  if (user.id!==account.id) fail();
  try {
    const when=nowIso();
    await atomic(db,[...generationAssertion(db,user,state),...activeSessionAssertion(db,user,sessionDigest),
      ...bumpStatements(db,user,state,'verified_email=?,email_verified_at=?',[data.email,when]),
      ...await verifiedEmailSyncStatements(db,user.id,data.email,when),
      ...eventStatements(db,user.id,'email_changed',user.id,context.data?.requestId)]);
  } catch(error) {
    if (/UNIQUE constraint failed: task27_security.verified_email/.test(String(error?.message))) fail('email_verification_unavailable','暂时无法验证该邮箱，请稍后重试');
    throw error;
  }
  const oldMail=state.verified_email && state.verified_email!==data.email ? await notify(context,user.id,'email_changed',state.verified_email) : null;
  return {session_invalidated:true,mail:await notify(context,user.id,'email_changed'),old_email_notice:oldMail};
}
export async function beginMfa(context,account,payload) {
  if (!task27EnrollmentEnabled(context.env)) fail('task27_enrollment_disabled','新的安全验证设置尚未开放',503);
  if (!['totp','email'].includes(payload.method)) fail('mfa_method_invalid','请选择邮箱或验证器');
  const {db,user,state,sessionDigest,guards}=await authorize(context,account,payload.grant,'mfa_change');
  const data={method:payload.method};
  let secret='',code='';
  if (payload.method==='totp') { secret=base32(randomBytes(20)); data.totp_ciphertext=await encryptTotp(context.env,user.id,secret); }
  else {
    if (!state.verified_email) fail('verified_email_required','请先绑定并验证邮箱，之后才能启用邮箱双重验证；当前双重验证方式未改变');
    if (!emailSendingEnabled(context.env)||!emailBindingConfigured(context.env)) throw new EmailServiceError('email_sending_unavailable','邮件服务尚不可用，验证码未发送；当前双重验证方式未改变',503,{retryable:true});
    const allowedRecipients=parseAllowedTestRecipients(context.env);
    if (allowedRecipients.length>0 && !allowedRecipients.includes(String(state.verified_email).trim().toLowerCase())) {
      throw new EmailServiceError('email_recipient_not_allowlisted','当前测试环境已启用收件白名单限制，您的已验证邮箱不在允许发信范围内，无法发送验证码；当前双重验证方式未改变。',403);
    }
    code=randomDigits();
  }
  await atomic(db,guards);
  const challenge=await createChallenge(db,{user,state,kind:'mfa_setup',method:payload.method,sessionDigest,code,env:context.env,data});
  let deliveryStatus='';
  if (payload.method==='email') {
    let sent;
    try { sent=await sendCode(context.env,state.verified_email,code,'开启邮箱双重验证',context.data?.requestId,{userId:user.id,challengeDigest:challenge.digest}); }
    catch(error) { await run(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[challenge.digest,nowIso()]); throw error; }
    deliveryStatus=sent.delivery_status;
  }
  return {challenge:challenge.token,method:payload.method,expires_at:challenge.expires_at,
    ...(deliveryStatus?{delivery_status:deliveryStatus,inbox_confirmed:false}:{}),
    ...(secret?{secret,otpauth_uri:totpUri(user.username,secret)}: {})};
}
export async function finishMfa(context,account,payload) {
  const {db,sessionDigest}=await identity(context,account);
  const {user,state,data,proofStep}=await verifyChallenge(db,context.env,payload.challenge,'mfa_setup',payload.code,{sessionDigest});
  if (user.id!==account.id) fail();
  const codes=data.method==='totp'?recoveryCodes():[];
  const event=state.mfa_method==='none'?'mfa_enabled':'mfa_changed';
  await atomic(db,[...generationAssertion(db,user,state),...activeSessionAssertion(db,user,sessionDigest),
    ...bumpStatements(db,user,state,'mfa_method=?,totp_ciphertext=?,totp_last_step=?',[data.method,data.totp_ciphertext || '',proofStep]),
    ...await recoveryStatements(db,user.id,codes),...eventStatements(db,user.id,event,user.id,context.data?.requestId)]);
  return {session_invalidated:true,recovery_codes:codes,display_once:true,mail:await notify(context,user.id,event)};
}
export async function disableMfa(context,account,payload) {
  const {db,user,state,guards}=await authorize(context,account,payload.grant,'mfa_change');
  await atomic(db,[...guards,...bumpStatements(db,user,state,"mfa_method='none',totp_ciphertext='',totp_last_step=-1"),
    stmt(db,'DELETE FROM task27_recovery_codes WHERE user_id=?1',[user.id]),...eventStatements(db,user.id,'mfa_disabled',user.id,context.data?.requestId)]);
  return {session_invalidated:true,mail:await notify(context,user.id,'mfa_disabled')};
}
export async function regenerateRecovery(context,account,payload) {
  const {db,user,state,guards}=await authorize(context,account,payload.grant,'recovery_regenerate');
  if (state.mfa_method!=='totp') fail('totp_required','请先开启验证器双重验证');
  const codes=recoveryCodes();
  await atomic(db,[...guards,...await recoveryStatements(db,user.id,codes),stmt(db,'UPDATE task27_security SET version=version+1 WHERE user_id=?1',[user.id]),
    ...eventStatements(db,user.id,'recovery_regenerated',user.id,context.data?.requestId)]);
  return {recovery_codes:codes,display_once:true,mail:await notify(context,user.id,'recovery_regenerated')};
}
export async function beginMfaRecovery(context,payload) {
  const db=context.env.WYJ_DB;
  if (typeof payload.username!=='string' || payload.username.length>40) fail();
  await securityRate(context,'mfa-recover-ip',undefined);
  const normalized=payload.username.trim().toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ');
  const found=await first(db,'SELECT id FROM task12_users WHERE username_normalized=?1 AND deleted=0 AND banned=0',[normalized]);
  if (!found) fail('invalid_credentials','验证未通过',403);
  await securityRate(context,'mfa-recover-account',found.id);
  const user=await verifyPassword(db,context.env,found.id,payload.password), state=await securityState(db,found.id);
  if (state.mfa_method!=='totp') fail('recovery_unavailable','该恢复方式不可用',403);
  const challenge=await createChallenge(db,{user,state,kind:'mfa_recovery',method:'recovery'});
  return {challenge:challenge.token,expires_at:challenge.expires_at};
}
export async function finishMfaRecovery(context,payload) {
  const db=context.env.WYJ_DB;
  const {user,state}=await verifyChallenge(db,context.env,payload.challenge,'mfa_recovery',payload.code,{allowRecovery:true});
  await atomic(db,[...generationAssertion(db,user,state),...bumpStatements(db,user,state,"mfa_method='none',totp_ciphertext='',totp_last_step=-1"),
    stmt(db,'DELETE FROM task27_recovery_codes WHERE user_id=?1',[user.id]),...eventStatements(db,user.id,'mfa_recovered',user.id,context.data?.requestId)]);
  return {session_invalidated:true,mail:await notify(context,user.id,'mfa_recovered')};
}
export async function listSessions(context,account) {
  const {db,user,sessionDigest}=await identity(context,account), when=nowIso();
  const web=await rows(db,`SELECT public_id,client_kind,created_at,last_seen_at,expires_at,token_digest,session_version,revoked FROM task12_sessions
    WHERE user_id=?1 AND NOT EXISTS(SELECT 1 FROM task20_device_sessions d WHERE d.access_token_digest=task12_sessions.token_digest)
    ORDER BY created_at DESC LIMIT 30`,[user.id]);
  const devices=await rows(db,'SELECT id,app_version,created_at,last_seen_at,refresh_expires_at,access_token_digest,session_version,revoked FROM task20_device_sessions WHERE user_id=?1 ORDER BY created_at DESC LIMIT 30',[user.id]);
  return [...web.map(row=>({id:row.public_id,kind:'web',client:row.client_kind,current:row.token_digest===sessionDigest,created_at:row.created_at,last_seen_at:row.last_seen_at,expires_at:row.expires_at,valid:!row.revoked&&Number(row.session_version)===Number(user.session_version)&&row.expires_at>when})),
    ...devices.map(row=>({id:row.id,kind:'android',client:`Android ${row.app_version}`,current:row.access_token_digest===sessionDigest,created_at:row.created_at,last_seen_at:row.last_seen_at,expires_at:row.refresh_expires_at,valid:!row.revoked&&Number(row.session_version)===Number(user.session_version)&&row.refresh_expires_at>when}))];
}
export async function revokeSessions(context,account,payload) {
  const {db,user,state,sessionDigest,guards}=await authorize(context,account,payload.grant,'sessions_revoke');
  const when=nowIso(); let commands=[], current=false;
  if (payload.mode==='all') { commands=bumpStatements(db,user,state); current=true; }
  else if (payload.mode==='others') {
    commands=[stmt(db,'UPDATE task12_sessions SET revoked=1,revoked_at=?3 WHERE user_id=?1 AND token_digest!=?2',[user.id,sessionDigest,when]),
      stmt(db,"UPDATE task20_device_sessions SET revoked=1,revoked_at=?3,revoke_reason='user_revoked' WHERE user_id=?1 AND access_token_digest!=?2",[user.id,sessionDigest,when])];
  } else if (payload.mode==='single' && typeof payload.id==='string' && payload.id.length<=80) {
    let digest='';
    if (payload.kind==='web') digest=(await first(db,'SELECT token_digest FROM task12_sessions WHERE user_id=?1 AND public_id=?2',[user.id,payload.id]))?.token_digest || '';
    else if (payload.kind==='android') digest=(await first(db,'SELECT access_token_digest FROM task20_device_sessions WHERE user_id=?1 AND id=?2',[user.id,payload.id]))?.access_token_digest || '';
    if (!digest) fail('session_not_found','会话不存在',404);
    current=digest===sessionDigest;
    commands=[stmt(db,'UPDATE task12_sessions SET revoked=1,revoked_at=?3 WHERE user_id=?1 AND token_digest=?2',[user.id,digest,when]),
      stmt(db,"UPDATE task20_device_sessions SET revoked=1,revoked_at=?3,revoke_reason='user_revoked' WHERE user_id=?1 AND access_token_digest=?2",[user.id,digest,when])];
  } else fail('session_operation_invalid','请选择要退出的设备');
  await atomic(db,[...guards,...commands,...eventStatements(db,user.id,'session_revoked',user.id,context.data?.requestId)]);
  return {session_invalidated:current,mail:await notify(context,user.id,'session_revoked')};
}
export async function overview(context,account) {
  const {db,state}=await identity(context,account);
  const [codes,events,sessions]=await Promise.all([
    first(db,"SELECT COUNT(*) AS count FROM task27_recovery_codes WHERE user_id=?1 AND used_at=''",[account.id]),
    rows(db,'SELECT event_type,created_at FROM task27_events WHERE user_id=?1 ORDER BY created_at DESC,id DESC LIMIT 30',[account.id]),listSessions(context,account)]);
  return {email:state.verified_email,email_verified_at:state.email_verified_at,mfa_method:state.mfa_method,recovery_codes_remaining:Number(codes.count),
    password_changed_at:state.password_changed_at,password_age_measured_from:state.password_changed_at || state.password_age_start_at,password_advice_only:true,
    enrollment_enabled:task27EnrollmentEnabled(context.env),email_sending_enabled:emailSendingEnabled(context.env)&&emailBindingConfigured(context.env),email_test_allowlist_active:parseAllowedTestRecipients(context.env).length>0,password_guidance:`为了提高账户安全性，建议使用至少 ${MIN_SECRET_LENGTH} 位、包含大小写字母、数字和特殊符号的密码。`,sessions,events};
}
