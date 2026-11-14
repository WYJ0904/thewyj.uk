import { apiError, featureFlags, jsonResponse, sameOriginResult } from './cloudflare-foundation.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { accountPayload, requireAllowedFields, Task12Error } from './task12-model.mjs';
import { issueTask12Session, deleteOwnAccount, recordLoginEvent } from './task12-service.mjs';
import { enrichAccountWithTask13 } from './task13-service.mjs';
import { createTask20DeviceSession, ensureTask20Schema } from './task20-service.mjs';
import { requireTask20AndroidClient, task20AccessCookie, task20TokenFromRequest, TASK20_ACCESS_TTL_SECONDS, validateTask20DeviceId, validateTask20AppVersion } from './task20-model.mjs';
import { task20DeviceDigest } from './task20-crypto.mjs';
import { sessionStorageKey } from './task12-crypto.mjs';
import { EmailServiceError } from './email-service.mjs';
import { publicPolicyConfig, validateConsent, consentStatement } from './task27-policy.mjs';
import { atomic, fail, hasTask27, nowIso } from './task27-store.mjs';
import { beginStepup, challengeRow, createChallenge, requestPasswordReset, securityRate, task27EnrollmentEnabled, verifyChallenge, verifyStepup } from './task27-auth.mjs';
import { authorize, beginEmailBinding, beginMfa, beginMfaRecovery, changePassword, disableMfa, finishEmailBinding, finishMfa, finishMfaRecovery, finishPasswordRecovery, overview, regenerateRecovery, resetOtherPassword, revokeSessions } from './task27-security.mjs';
import { confirmReadAll, inbox, markRead, previewReadAll } from './task27-notifications.mjs';
import { listDrafts, mailRecipients, previewDraft, saveDraft, sendDraft } from './task27-mail.mjs';

const route=(auth,fields=[],run)=>({auth,fields,run});
const ROUTES=new Map([
  ['GET /api/policies',route('public',[],()=>publicPolicyConfig())],
  ['POST /api/policies/accept',route('user',['terms_accepted','policy_versions'],async(c,a,p)=>{validateConsent(p);await consentStatement(c.env.WYJ_DB,a.id,c.data?.requestId).run();return {accepted:true};})],
  ['GET /api/security/overview',route('user',[],overview)],
  ['POST /api/security/stepup',route('user',['password','scope'],async(c,a,p)=>beginStepup(c,a,p,await sessionStorageKey(task20TokenFromRequest(c.request))))],
  ['POST /api/security/stepup/verify',route('user',['challenge','code'],async(c,a,p)=>verifyStepup(c,p,await sessionStorageKey(task20TokenFromRequest(c.request))))],
  ['POST /api/security/login/verify',route('public',['challenge','code'],completeLogin)],
  ['POST /api/app/login/verify',route('public',['challenge','code','device_id','app_version'],completeLogin)],
  ['POST /api/security/password/request',route('public',['username','method'],(c,a,p)=>requestPasswordReset(c,p.username,p.method || 'email'))],
  ['POST /api/security/password/reset',route('public',['challenge','code','new_secret','confirm_secret'],(c,a,p)=>finishPasswordRecovery(c,p))],
  ['POST /api/security/password/complete',route('public',['challenge','new_secret','confirm_secret'],(c,a,p)=>finishPasswordRecovery(c,p,'password_change'))],
  ['POST /api/security/mfa/recover/request',route('public',['username','password'],(c,a,p)=>beginMfaRecovery(c,p))],
  ['POST /api/security/mfa/recover/confirm',route('public',['challenge','code'],(c,a,p)=>finishMfaRecovery(c,p))],
  ['POST /api/security/email/start',route('user',['email','grant'],beginEmailBinding)],
  ['POST /api/security/email/confirm',route('user',['challenge','code'],finishEmailBinding)],
  ['POST /api/security/mfa/start',route('user',['method','grant'],beginMfa)],
  ['POST /api/security/mfa/confirm',route('user',['challenge','code'],finishMfa)],
  ['POST /api/security/mfa/disable',route('user',['grant'],disableMfa)],
  ['POST /api/security/recovery/regenerate',route('user',['grant'],regenerateRecovery)],
  ['POST /api/security/sessions/revoke',route('user',['grant','mode','id','kind'],revokeSessions)],
  ['GET /api/notifications',route('user',[],(c,a)=>inbox(c.env.WYJ_DB,a,new URL(c.request.url).searchParams))],
  ['POST /api/notifications/read',route('user',['source','id'],(c,a,p)=>markRead(c.env.WYJ_DB,a,p))],
  ['POST /api/notifications/read-all/preview',route('user',[],previewReadAll)],
  ['POST /api/notifications/read-all',route('user',['confirm','confirmation'],confirmReadAll)],
  ['GET /api/admin/email/recipients',route('admin',[],async(c,a)=>({recipients:await mailRecipients(c,a,new URL(c.request.url).searchParams)}))],
  ['GET /api/admin/email/drafts',route('admin',[],listDrafts)],
  ['POST /api/admin/email/drafts',route('admin',['id','revision','subject','body','recipient_ids'],saveDraft)],
  ['POST /api/admin/email/preview',route('admin',['id'],previewDraft)],
  ['POST /api/admin/email/send',route('admin',['id','revision','preview','confirm','retry','grant'],sendDraft)],
  ['POST /api/account/secret',route('user',['new_secret','confirm_secret','grant'],changePassword)],
  ['POST /api/admin/secret',route('admin',['user_id','grant'],resetOtherPassword)],
]);
const LEGACY_OVERRIDES=new Set(['/api/account/secret','/api/admin/secret']);
const LEGACY_STEPUP=new Map([
  ['/api/admin/roles','admin_roles'],['/api/admin/ban','admin_account'],['/api/admin/logout-user','admin_account'],['/api/admin/delete-user','admin_account'],
  ['/api/admin/membership/manage','admin_entitlements'],['/api/admin/membership','admin_entitlements'],['/api/admin/entitlement','admin_entitlements'],
  ['/api/admin/feature-flags','admin_features'],['/api/account/delete','account_delete'],
  ['/api/admin/feature-flags/override','admin_features'],['/api/admin/recharge/process','admin_entitlements'],
]);
export async function readJsonBounded(request,maximum=16384) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail('json_content_type_required','请使用 JSON 请求',415);
  if (Number(request.headers.get('Content-Length') || 0)>maximum) fail('request_too_large','请求过大',413);
  const reader=request.body?.getReader();let size=0;const chunks=[];
  if (reader) try { while (true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();fail('request_too_large','请求过大',413);}chunks.push(value); } }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let payload;try {payload=JSON.parse(new TextDecoder().decode(bytes) || '{}');}catch(_){fail('invalid_json','JSON 格式无效');}
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) fail('invalid_json','请提供 JSON 对象');
  return payload;
}
function checkTypes(payload) {
  for (const [key,value] of Object.entries(payload)) {
    if (['confirm','retry','terms_accepted'].includes(key)) { if(typeof value!=='boolean')fail('field_type_invalid','字段类型无效'); }
    else if (key==='revision') {if(!Number.isSafeInteger(value)||value<1)fail('field_type_invalid','版本号无效');}
    else if (key==='recipient_ids') {if(!Array.isArray(value))fail('field_type_invalid','收件用户无效');}
    else if (key==='policy_versions') {if(!value||typeof value!=='object'||Array.isArray(value))fail('field_type_invalid','政策版本无效');}
    else if (typeof value!=='string' || value.length>8000) fail('field_type_invalid','字段类型或长度无效');
  }
}
async function authenticate(context,admin=false) {
  const result=await resolveTask12Account(context);
  if (!result.authenticated) throw new Task12Error('请重新登录或确认当前政策',result.status || 401,result.code);
  if (admin&&!result.account.is_admin) fail('forbidden','无管理员权限',403);
  return result.account;
}
async function completeLogin(context,_account,payload) {
  const db=context.env.WYJ_DB, android=new URL(context.request.url).pathname==='/api/app/login/verify';
  const original=await challengeRow(db,payload.challenge,'login'), data=JSON.parse(original.context_json);
  if ((data.client==='android')!==android) fail('login_client_mismatch','请在发起登录的客户端继续验证',403);
  if (android) {
    requireTask20AndroidClient(context.request);
    if (!featureFlags(context.env).task20AndroidApp || !await ensureTask20Schema(db)) fail('task20_android_app_disabled','Android 会话服务不可用',503);
    if (await task20DeviceDigest(validateTask20DeviceId(payload.device_id))!==data.device_id_digest || validateTask20AppVersion(payload.app_version)!==data.app_version) fail('app_device_mismatch','登录挑战与设备不匹配',403);
  }
  const {user,state}=await verifyChallenge(db,context.env,payload.challenge,'login',payload.code,{allowRecovery:true});
  if (state.must_change_password) {
    const challenge=await createChallenge(db,{user,state,kind:'password_change',data});
    return {password_change_required:true,password_change_token:challenge.token,expires_at:challenge.expires_at};
  }
  const options={env:context.env,passwordPepper:context.env.WYJ_TASK12_PASSWORD_PEPPER,sessionSecret:context.env.WYJ_TASK20_DEVICE_SESSION_SECRET,
    ...(android?{sessionTtlSeconds:TASK20_ACCESS_TTL_SECONDS,clientKind:'android_app'}:{})};
  const login=await issueTask12Session(db,user,context.request,options);
  let result=login;
  if (android) result=await createTask20DeviceSession(db,login,payload,options);
  let account=result.account;
  try { account=await enrichAccountWithTask13(db,account); } catch(_) {account={...account,membership_state_unavailable:true};}
  await recordLoginEvent(db,user.username,true,'mfa_success',{},user).catch(()=>undefined);
  return jsonResponse({ok:true,...result,account},200,context.data?.requestId || '',android?{'Set-Cookie':task20AccessCookie(result.access_token)}:{});
}
export async function handleTask27Request(context) {
  const url=new URL(context.request.url),method=context.request.method.toUpperCase(),key=`${method} ${url.pathname}`;
  const descriptor=ROUTES.get(key),legacyScope=method==='POST'?LEGACY_STEPUP.get(url.pathname):null;
  if (!descriptor&&!legacyScope) {
    if ([...ROUTES.keys()].some(route=>route.endsWith(` ${url.pathname}`))&&!LEGACY_OVERRIDES.has(url.pathname)) return apiError('method_not_allowed','请求方法无效',405,context.data?.requestId);
    return null;
  }
  const respond=(payload,status=200)=>jsonResponse({ok:true,...payload},status,context.data?.requestId || '',{'Cache-Control':'private, no-store'});
  try {
    if (!sameOriginResult(context.request).allowed) fail('cross_origin_rejected','只接受同源请求',403);
    if (key==='GET /api/policies') return respond({...publicPolicyConfig(),security_center_ready:await hasTask27(context.env?.WYJ_DB),security_enrollment_enabled:task27EnrollmentEnabled(context.env)});
    const ready=await hasTask27(context.env?.WYJ_DB);
    if (!ready&&(legacyScope||LEGACY_OVERRIDES.has(url.pathname))) return null;
    if (!ready) fail('task27_schema_not_ready','账户安全功能尚未开放',503);
    if (!featureFlags(context.env).task12CloudAccounts) fail('cloud_accounts_disabled','账户服务不可用',503);
    const account=descriptor?.auth==='public'?null:await authenticate(context,descriptor?.auth==='admin'||url.pathname.startsWith('/api/admin/'));
    await securityRate(context,key,account?.id,method==='GET'?120:30,60);
    if (legacyScope) {
      const {db,guards}=await authorize(context,account,context.request.headers.get('X-Aeris-Stepup'),legacyScope);
      await atomic(db,guards);
      return null;
    }
    const payload=method==='POST'?await readJsonBounded(context.request):{};
    requireAllowedFields(payload,new Set(descriptor.fields));checkTypes(payload);
    const result=await descriptor.run(context,account,payload);
    return result instanceof Response?result:respond(result);
  } catch(error) {
    if (error instanceof Task12Error || error instanceof EmailServiceError) return apiError(error.code,error.message,error.status,context.data?.requestId || '',{retryable:error.retryable,headers:error.status===429?{'Retry-After':'60'}:{}});
    console.error(JSON.stringify({event:'task27_error',request_id:context.data?.requestId || '',route:url.pathname,error_name:String(error?.name || 'Error')}));
    return apiError('task27_unavailable','账户安全服务暂时不可用，请稍后重试',503,context.data?.requestId || '',{retryable:true});
  }
}
export const __testing={ROUTES,LEGACY_STEPUP};
