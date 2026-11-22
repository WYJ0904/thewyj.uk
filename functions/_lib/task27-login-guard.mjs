import {sha256Hex} from './cloudflare-foundation.mjs';
import {normalizeUsername,Task12Error} from './task12-model.mjs';

// SEC-S0-M02. These are short-lived reservations/failures, never user flags.
// A blocked request cannot extend the fixed expiry or revoke a valid session.
export const LOGIN_IDENTIFIER_LIMITS=Object.freeze({pair:8,account:24,windowSeconds:300});
export async function loginIdentifierKeys(request,username) {
  const account=normalizeUsername(username),ip=String(request.headers.get('CF-Connecting-IP') || 'anonymous').slice(0,80);
  return {pair:await sha256Hex(`task27-login-pair\0${account}\0${ip}`),account:await sha256Hex(`task27-login-account\0${account}`)};
}
async function reserve(db,key,limit,now) {
  const row=await db.prepare(`INSERT INTO task12_auth_failure_windows(bucket_key,failure_count,expires_at) VALUES(?1,1,?2)
    ON CONFLICT(bucket_key) DO UPDATE SET
      failure_count=CASE WHEN task12_auth_failure_windows.expires_at<=?3 THEN 1 ELSE failure_count+1 END,
      expires_at=CASE WHEN task12_auth_failure_windows.expires_at<=?3 THEN ?2 ELSE expires_at END
    WHERE task12_auth_failure_windows.expires_at<=?3 OR failure_count<?4
    RETURNING failure_count,expires_at`).bind(key,now+LOGIN_IDENTIFIER_LIMITS.windowSeconds,now,limit).first();
  if(row)return {key,expiresAt:Number(row.expires_at),allowed:true};
  const existing=await db.prepare('SELECT expires_at FROM task12_auth_failure_windows WHERE bucket_key=?1').bind(key).first();
  return {key,expiresAt:Number(existing?.expires_at || now+1),allowed:false};
}
async function release(db,slots) {
  if(!slots.length)return;
  await db.batch(slots.map(slot=>db.prepare(`UPDATE task12_auth_failure_windows SET failure_count=failure_count-1
    WHERE bucket_key=?1 AND expires_at=?2 AND failure_count>0`).bind(slot.key,slot.expiresAt)));
}
export async function reserveLoginAttempt(context,username) {
  const db=context.env.WYJ_DB,now=Math.floor(Date.now()/1000),keys=await loginIdentifierKeys(context.request,username);
  try{
    const pair=await reserve(db,keys.pair,LOGIN_IDENTIFIER_LIMITS.pair,now);
    if(!pair.allowed)return {allowed:false,retryAfter:Math.max(1,pair.expiresAt-now),slots:[]};
    const account=await reserve(db,keys.account,LOGIN_IDENTIFIER_LIMITS.account,now);
    if(!account.allowed){await release(db,[pair]);return {allowed:false,retryAfter:Math.max(1,account.expiresAt-now),slots:[]};}
    if(keys.account.endsWith('00'))await db.prepare('DELETE FROM task12_auth_failure_windows WHERE expires_at<?1').bind(now-3600).run();
    return {allowed:true,retryAfter:0,slots:[pair,account]};
  }catch(_){throw new Task12Error('登录保护服务暂时不可用，请稍后重试',503,'login_guard_unavailable',true);}
}
export async function acceptLoginPassword(context,ticket) {
  await context.env.WYJ_DB.batch(ticket.slots.map(slot=>context.env.WYJ_DB.prepare(
    'DELETE FROM task12_auth_failure_windows WHERE bucket_key=?1 AND expires_at=?2').bind(slot.key,slot.expiresAt)));
}
export async function settleLoginError(context,ticket,error) {
  // Correct-password but unavailable MFA/mail, invalid device payloads and
  // infrastructure failures do not consume a password-guess budget.
  if(!['invalid_credentials','password_reset_required'].includes(String(error?.code || '')))await release(context.env.WYJ_DB,ticket.slots);
}
export function publicLoginError(error) {
  if(error?.code==='password_reset_required')return new Task12Error('用户名或登录密码错误',403,'invalid_credentials');
  return error;
}
