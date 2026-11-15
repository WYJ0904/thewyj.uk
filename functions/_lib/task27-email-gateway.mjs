import {apiError,featureFlags,sameOriginResult} from './cloudflare-foundation.mjs';
import {resolveTask12Account} from './task12-auth.mjs';
import {Task12Error} from './task12-model.mjs';
import {EmailServiceError} from './email-service.mjs';
import {emailCenterIntegrated,emailCenterReady} from './task27-email-adapter.mjs';
import {atomic,fail,hasTask27} from './task27-store.mjs';
import {authorize} from './task27-security.mjs';

const SCOPES=new Map([
  ['/api/admin/email/test-send','test'],['/api/admin/email/send','send'],
  ['/api/admin/email/deliveries/retry','retry'],['/api/admin/email/inbound/reply','reply'],
  ['/api/admin/email/templates','templates'],['/api/admin/email/inbound/status','inbound'],
]);
// The complete mail center owns this namespace when integrated. Keeping the
// legacy Task27 draft API behind it would silently mix incompatible draft IDs,
// preview tokens and delivery state. Never fall back to that API on failure.
export async function handleTask27EmailRequest(context,handler) {
  const path=new URL(context.request.url).pathname;
  if(!emailCenterIntegrated()||!path.startsWith('/api/admin/email/'))return null;
  const requestId=context.data?.requestId || '';
  try{
    if(!sameOriginResult(context.request).allowed)fail('cross_origin_rejected','只接受同源请求',403);
    if(!featureFlags(context.env).task12CloudAccounts)fail('cloud_accounts_disabled','账户服务不可用',503);
    if(!await hasTask27(context.env?.WYJ_DB))fail('task27_schema_not_ready','账户安全功能尚未开放',503);
    const authenticated=await resolveTask12Account(context);
    if(!authenticated.authenticated)throw new Task12Error('请重新登录或确认当前政策',authenticated.status || 401,authenticated.code);
    if(!authenticated.account.is_admin)fail('forbidden','无管理员权限',403);
    if(!await emailCenterReady(context.env.WYJ_DB))fail('email_center_schema_not_ready','邮件中心尚未就绪',503);
    if(context.request.method==='POST'){
      // A mail-management binding write cannot replace the user's ownership
      // proof, security generation change and session revocation in Task27.
      if(path==='/api/admin/email/user-binding')fail('email_binding_security_center_required','邮箱验证与变更必须由账户安全中心完成',403);
      const scope=SCOPES.get(path);
      if(scope){
        const {db,guards}=await authorize(context,authenticated.account,context.request.headers.get('X-Aeris-Stepup'),`email_center:${scope}`);
        await atomic(db,guards);
      }
    }
    return await handler(context)||apiError('email_route_not_found','邮件管理接口不存在',404,requestId);
  }catch(error){
    if(error instanceof Task12Error||error instanceof EmailServiceError)return apiError(error.code,error.message,error.status,requestId,{retryable:Boolean(error.retryable)});
    return apiError('email_center_unavailable','邮件中心暂时不可用',503,requestId,{retryable:true});
  }
}
