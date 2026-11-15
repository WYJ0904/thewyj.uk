import * as mail from './email-service.mjs';
import {sha256Hex} from './cloudflare-foundation.mjs';
import {first,stmt,fail} from './task27-store.mjs';

const optional=name=>Reflect.get(mail,name);
export function emailCenterIntegrated() {
  return String(mail.EMAIL_BUILD || '').startsWith('task27-email-center-')&&typeof optional('sendVerificationCodeEmail')==='function'&&typeof optional('getUserEmailBinding')==='function';
}
export async function emailCenterSchemaPresent(db) {
  return Boolean(db?.prepare&&await first(db,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='email_center_bindings'"));
}
export async function emailCenterReady(db) {
  if(!db?.prepare)return false;
  const result=await first(db,`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN
    ('email_center_metadata','email_center_bindings','email_center_templates','email_center_drafts','email_center_previews','email_center_deliveries','email_center_inbound_threads','email_center_inbound_messages')`);
  return Number(result?.count)===8;
}
async function requireMailSchema(env) {
  if(emailCenterIntegrated()&&!await emailCenterReady(env.WYJ_DB))fail('email_center_schema_not_ready','邮件中心尚未就绪，当前邮件未发送',503);
}
export async function verifiedEmailSyncStatements(db,userId,email,when) {
  if(!await emailCenterSchemaPresent(db))return [];
  return [stmt(db,`INSERT INTO email_center_bindings(user_id,email,verified,verified_at,updated_by,updated_at) VALUES(?1,?2,1,?3,?1,?3)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified=1,verified_at=excluded.verified_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,[userId,email,when])];
}
async function requireAuthoritativeBinding(env,userId,to) {
  if(!env.WYJ_DB||!userId)fail('email_verified_user_required','缺少已验证的账户邮箱',403);
  const state=await first(env.WYJ_DB,'SELECT verified_email,email_verified_at FROM task27_security WHERE user_id=?1',[userId]);
  if(!state?.email_verified_at||String(state.verified_email).toLowerCase()!==String(to).toLowerCase())fail('email_recipient_not_verified','请先验证并绑定邮箱',403);
  if(await emailCenterSchemaPresent(env.WYJ_DB)){
    const center=await first(env.WYJ_DB,'SELECT email,verified FROM email_center_bindings WHERE user_id=?1',[userId]);
    if(Number(center?.verified)===1&&String(center.email).toLowerCase()!==String(state.verified_email).toLowerCase())fail('email_binding_conflict','邮箱记录不一致，请在安全中心重新验证；当前验证码未发送',503);
  }
}
function requireAccepted(result) {
  const value=Number(result?.status_code),status=Number.isInteger(value)&&value>=400&&value<=599?value:503;
  if(result?.ok!==true)throw new mail.EmailServiceError('验证码或安全邮件未被邮件服务接受',status,String(result?.error_code || 'email_delivery_failed'),Boolean(result?.retryable),{delivery_id:result?.delivery_id||null,delivery_status:result?.delivery_status||null});
  return {...result,inbox_confirmed:false,inbox_delivery_confirmed:false};
}
export async function sendTask27Code(env,{to,code,purpose,userId,challengeDigest,requestId=''}) {
  await requireMailSchema(env);
  const bind=purpose==='绑定邮箱';
  if(!bind)await requireAuthoritativeBinding(env,userId,to);
  const idempotencyKey='t27-code:'+await sha256Hex(`${userId}\0${challengeDigest}\0${purpose}`);
  const options={to,code,userId,purpose:bind?'bind':purpose==='找回密码'?'recovery':purpose==='开启邮箱双重验证'?'mfa_enable':purpose==='登录验证'?'login_mfa':'step_up',expiresMinutes:5,idempotencyKey,requestId,requireVerifiedEmail:!bind,emailVerified:!bind};
  const sender=optional('sendVerificationCodeEmail');
  const result=emailCenterIntegrated()?await sender(env,options):await mail.sendTransactionalEmail(env,{...options,kind:'verification_code',purpose});
  return requireAccepted(result);
}
export async function sendTask27SecurityNotice(env,{to,userId,eventSummary,event,occurredAt,requestId='',previouslyVerified=false}) {
  await requireMailSchema(env);
  if(!previouslyVerified)await requireAuthoritativeBinding(env,userId,to);
  const idempotencyKey='t27-event:'+await sha256Hex(`${userId}\0${event}\0${requestId || crypto.randomUUID()}`);
  const result=await mail.sendAccountSecurityNotice(env,{to,userId,eventSummary,occurredAt,requestId,idempotencyKey,requireVerifiedEmail:!previouslyVerified,emailVerified:true});
  return requireAccepted(result);
}
