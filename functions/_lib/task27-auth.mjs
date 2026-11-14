import { createSessionToken, sessionStorageKey, verifySecret, consumeVerificationWork } from './task12-crypto.mjs';
import { Task12Error } from './task12-model.mjs';
import { enforceD1RateLimit,sha256Hex } from './cloudflare-foundation.mjs';
import { sendTransactionalEmail } from './email-service.mjs';
import { equalText, keyedDigest, randomDigits, decryptTotp, matchingTotpStep } from './task27-crypto.mjs';
import { activeUser, assertion, atomic, changed, eventStatements, fail, first, generationAssertion, hasTask27, nowIso, run, securityState, stmt } from './task27-store.mjs';

const TTL = 5*60*1000;
export function task27EnrollmentEnabled(env) { return ['true','1'].includes(String(env.TASK27_SECURITY_ENABLED || '').toLowerCase()); }
export async function securityRate(context, scope, subject, limit = 5, windowSeconds = 300) {
  const result=await enforceD1RateLimit(context,{enabled:true,scope:`task27:${scope}`,subject,limit,windowSeconds});
  if (result.degraded) throw new Task12Error('安全限流服务暂时不可用',503,'task27_rate_limit_unavailable',true);
  if (!result.allowed) throw new Task12Error('操作过于频繁，请稍后重试',429,'task27_rate_limited',true);
}
async function clearStepupFailures(context,userId) {
  const windowStart=Math.floor(Math.floor(Date.now()/1000)/300)*300;
  const bucket=await sha256Hex(`task27:stepup-account\0${userId}\0${windowStart}`);
  await run(context.env.WYJ_DB,'DELETE FROM cloud_rate_limit_windows WHERE bucket_key=?1',[bucket]);
}
export async function createChallenge(db, {user=null,state=null,kind,method='none',sessionDigest='',scope='',data={},code='',env={}}) {
  const token=createSessionToken(), digest=await sessionStorageKey(token), when=nowIso();
  const codeHash=code ? await keyedDigest(env,`${kind}:${user?.id || ''}:${digest}`,code) : '';
  // Expired authentication artifacts are not security-event history.
  await run(db,'DELETE FROM task27_challenges WHERE expires_at < ?1',[new Date(Date.now()-86400000).toISOString()]);
  await run(db,`INSERT INTO task27_challenges(token_digest,user_id,kind,method,code_hash,session_digest,session_version,security_version,scope,context_json,created_at,expires_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,[digest,user?.id || null,kind,method,codeHash,sessionDigest,
    Number(user?.session_version || 0),Number(state?.version || 0),scope,JSON.stringify(data),when,new Date(Date.now()+TTL).toISOString()]);
  return {token,digest,expires_at:new Date(Date.now()+TTL).toISOString()};
}
export async function sendCode(env, email, code, purpose, requestId='') {
  return sendTransactionalEmail(env,{kind:'verification_code',to:email,code,purpose,requestId});
}
export async function challengeRow(db, token, kind, sessionDigest = null) {
  if (typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail();
  const row=await first(db,`SELECT * FROM task27_challenges WHERE token_digest=?1 AND kind=?2 AND consumed_at='' AND attempts<5 AND expires_at>?3`,[await sessionStorageKey(token),kind,nowIso()]);
  if (!row || (sessionDigest!==null && !equalText(row.session_digest,sessionDigest))) fail();
  return row;
}
export async function challengeIdentity(db,row) {
  if (!row.user_id) fail();
  const user=await activeUser(db,row.user_id), state=await securityState(db,user.id);
  if (Number(user.session_version)!==Number(row.session_version) || Number(state.version)!==Number(row.security_version)) fail();
  return {user,state};
}
export function challengeAssertion(db,row) {
  return assertion(db,`EXISTS(SELECT 1 FROM task27_challenges WHERE token_digest=? AND kind=? AND consumed_at='' AND expires_at>? AND attempts<=5)`,[row.token_digest,row.kind,nowIso()]);
}
export async function verifyChallenge(db,env,token,kind,code,{sessionDigest=null,allowRecovery=false}={}) {
  const row=await challengeRow(db,token,kind,sessionDigest);
  // Reserve an attempt before any comparison. Concurrent requests share five attempts.
  const reserved=await run(db,`UPDATE task27_challenges SET attempts=attempts+1 WHERE token_digest=?1 AND consumed_at='' AND expires_at>?2 AND attempts<5`,[row.token_digest,nowIso()]);
  if (!changed(reserved)) fail();
  const {user,state}=await challengeIdentity(db,row);
  if (typeof code!=='string' || code.length>80) fail();
  let proofStatements=[],proofStep=-1;
  if (allowRecovery && /^[A-Z2-7]{8}-[A-Z2-7]{8}-[A-Z2-7]{8}-[A-Z2-7]{8}$/.test(code.toUpperCase())) {
    const codeHash=await sessionStorageKey(code.toUpperCase());
    proofStatements=[...assertion(db,`EXISTS(SELECT 1 FROM task27_recovery_codes WHERE user_id=? AND code_hash=? AND used_at='')`,[user.id,codeHash]),
      stmt(db,'UPDATE task27_recovery_codes SET used_at=?3 WHERE user_id=?1 AND code_hash=?2 AND used_at=\'\'',[user.id,codeHash,nowIso()]),
      ...eventStatements(db,user.id,'recovery_used')];
  } else if (row.method==='email') {
    if (!/^\d{6}$/.test(code) || !equalText(await keyedDigest(env,`${kind}:${user.id}:${row.token_digest}`,code),row.code_hash)) fail();
  } else if (row.method==='totp') {
    const cipher=kind==='mfa_setup' ? JSON.parse(row.context_json).totp_ciphertext : state.totp_ciphertext;
    const step=await matchingTotpStep(await decryptTotp(env,user.id,cipher),code);
    if (step<0) fail();
    proofStep=step;
    proofStatements=kind==='mfa_setup'?[]:[...assertion(db,'EXISTS(SELECT 1 FROM task27_security WHERE user_id=? AND totp_last_step<? AND version=?)',[user.id,step,Number(state.version)]),
      stmt(db,'UPDATE task27_security SET totp_last_step=?2 WHERE user_id=?1',[user.id,step])];
  } else if (row.method==='recovery') {
    // An independent recovery challenge accepts recovery codes only.
    fail();
  } else if (row.method!=='none') fail();
  await atomic(db,[...generationAssertion(db,user,state),...challengeAssertion(db,row),...proofStatements,
    stmt(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[row.token_digest,nowIso()])]);
  return {row,user,state:await securityState(db,user.id),data:JSON.parse(row.context_json),proofStep};
}
export async function consumePlainChallenge(db,token,kind,sessionDigest=null) {
  const row=await challengeRow(db,token,kind,sessionDigest), identity=await challengeIdentity(db,row);
  await atomic(db,[...generationAssertion(db,identity.user,identity.state),...challengeAssertion(db,row),
    stmt(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[row.token_digest,nowIso()])]);
  return {...identity,row,data:JSON.parse(row.context_json)};
}
export async function beginTask27Login(db,user,request,options={}) {
  if (!await hasTask27(db)) return null;
  const state=await securityState(db,user.id);
  if (state.mfa_method==='none' && !state.must_change_password) return null;
  const env=options.env || {};
  await securityRate({request,env:{...env,WYJ_DB:db}},'login-challenge',user.id);
  const kind=state.mfa_method==='none' ? 'password_change' : 'login';
  const method=state.mfa_method;
  const code=method==='email' ? randomDigits() : '';
  const challenge=await createChallenge(db,{user,state,kind,method,code,env,data:{client:options.clientKind==='android_app'?'android':'web',...options.challengeData}});
  if (method==='email') {
    try { await sendCode(env,state.verified_email,code,'登录验证',options.requestId); }
    catch(error) { await run(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[challenge.digest,nowIso()]); throw error; }
  }
  if (kind==='password_change') return {password_change_required:true,password_change_token:challenge.token,expires_at:challenge.expires_at};
  return {mfa_required:true,challenge:challenge.token,method,expires_at:challenge.expires_at,recovery_available:method==='totp'};
}
export async function verifyPassword(db,env,userId,password) {
  if (typeof password!=='string' || password.length>256) fail('invalid_credentials','验证未通过',403);
  const user=await activeUser(db,userId);
  if (!(await verifySecret(password,user.password_hash,env.WYJ_TASK12_PASSWORD_PEPPER)).valid) fail('invalid_credentials','验证未通过',403);
  return user;
}
export async function beginStepup(context,account,payload,sessionDigest) {
  const {env,request}=context, db=env.WYJ_DB;
  if (typeof payload.scope!=='string' || payload.scope.length>200 || !/^(password_change|email_change|mfa_change|recovery_regenerate|sessions_revoke|account_delete|admin_reset:[A-Za-z0-9_-]{1,80}|admin_roles|admin_account|admin_entitlements|admin_features|email_send:[A-Za-z0-9_-]{1,80}:\d+)$/.test(payload.scope)) fail('stepup_scope_invalid','操作范围无效');
  await securityRate(context,'stepup-account',account.id);
  const user=await verifyPassword(db,env,account.id,payload.password), state=await securityState(db,account.id);
  const code=state.mfa_method==='email'?randomDigits():'';
  const challenge=await createChallenge(db,{user,state,kind:'stepup',method:state.mfa_method,sessionDigest,scope:payload.scope,code,env});
  if (state.mfa_method==='email') await sendCode(env,state.verified_email,code,'敏感操作验证',context.data?.requestId);
  if (state.mfa_method==='none') {
    await consumePlainChallenge(db,challenge.token,'stepup',sessionDigest);
    const grant=await createChallenge(db,{user,state,kind:'grant',sessionDigest,scope:payload.scope});
    await clearStepupFailures(context,user.id);
    return {grant:grant.token,expires_at:grant.expires_at};
  }
  return {challenge:challenge.token,method:state.mfa_method,expires_at:challenge.expires_at};
}
export async function verifyStepup(context,payload,sessionDigest) {
  const {user,state,row}=await verifyChallenge(context.env.WYJ_DB,context.env,payload.challenge,'stepup',payload.code,{sessionDigest,allowRecovery:true});
  const grant=await createChallenge(context.env.WYJ_DB,{user,state,kind:'grant',sessionDigest,scope:row.scope});
  await clearStepupFailures(context,user.id);
  return {grant:grant.token,expires_at:grant.expires_at};
}
export async function grantStatements(db,token,user,state,sessionDigest,scope) {
  const row=await challengeRow(db,token,'grant',sessionDigest);
  if (row.user_id!==user.id || row.scope!==scope || Number(row.session_version)!==Number(user.session_version) || Number(row.security_version)!==Number(state.version)) fail('stepup_required','请重新验证身份',403);
  return [...generationAssertion(db,user,state),...challengeAssertion(db,row),
    ...assertion(db,`EXISTS(SELECT 1 FROM task12_sessions WHERE token_digest=? AND user_id=? AND revoked=0 AND expires_at>? AND session_version=?)`,[sessionDigest,user.id,nowIso(),Number(user.session_version)]),
    stmt(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[row.token_digest,nowIso()])];
}
export async function requestPasswordReset(context,username,method='email') {
  const db=context.env.WYJ_DB;
  if (typeof username!=='string' || username.length>40 || !['email','totp','recovery'].includes(method)) fail('recovery_input_invalid','恢复请求无效');
  const normalized=username.trim().toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ');
  await securityRate(context,'password-recovery',await sessionStorageKey(normalized),3,900);
  const found=await first(db,'SELECT id FROM task12_users WHERE username_normalized=?1 AND deleted=0 AND banned=0',[normalized]);
  const user=found?await activeUser(db,found.id):null;
  const state=user ? await securityState(db,user.id) : null;
  const eligible=Boolean(user && state && (method==='email' ? state.verified_email : state.mfa_method==='totp'));
  const code=randomDigits();
  const challenge=await createChallenge(db,{user:eligible?user:null,state:eligible?state:null,kind:'password_reset',method,code:eligible&&method==='email'?code:'',env:context.env});
  if (eligible&&method==='email') {
    // Identical public response for nonexistent/unverified accounts and delivery failure.
    const work=sendCode(context.env,state.verified_email,code,'找回密码',context.data?.requestId).catch(async()=>{
      await run(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[challenge.digest,nowIso()]);
    });
    if (context.waitUntil) context.waitUntil(work); else await work;
  }
  return {challenge:challenge.token,expires_at:challenge.expires_at,message:'如果账户存在且已配置该恢复方式，您可以继续验证。邮箱方式请检查绑定邮箱。'};
}
