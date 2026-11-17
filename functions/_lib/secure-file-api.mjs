import { apiError, jsonResponse, enforceD1RateLimit, featureFlags, sameOriginResult } from './cloudflare-foundation.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { explicitWebSessionToken, webDownloadSessionCookie } from './task20-model.mjs';
import { secureFilesV1 } from './secure-file-service.mjs';
import { readFileJson, SecureFileError } from './secure-file-policy.mjs';
import { Task22Error, requireAllowedFields } from './task22-model.mjs';

export async function handleSecureFileRequest(context) {
  const url=new URL(context.request.url),method=context.request.method.toUpperCase();
  if(!url.pathname.startsWith('/api/files/v1/')) return null;
  const requestId=context.data?.requestId || '';
  try {
    if(!sameOriginResult(context.request).allowed) throw new SecureFileError('cross_origin_rejected','只接受同源请求',403);
    const flags=featureFlags(context.env),write=method!=='GET';
    if(!flags.task12CloudAccounts || !(write?flags.task22TransferWrites:flags.task22TransferReads)) throw new SecureFileError('files_not_enabled','文件服务尚未启用',503,true);
    const marker=await context.env.WYJ_DB.prepare("SELECT value FROM task22_metadata WHERE key='task28_schema_version'").first();
    if(marker?.value!=='1') throw new SecureFileError('task28_schema_not_ready','文件基础层尚未就绪',503,true);
    const auth=await resolveTask12Account(context);
    if(!auth.authenticated) return apiError(auth.code,'请先登录有效账户',auth.status || 401,requestId);
    const rate=await enforceD1RateLimit(context,{enabled:flags.d1RateLimit,limit:method==='GET'?120:30,windowSeconds:60,
      scope:`files-v1:${method}`,subject:auth.account.id});
    if(!rate.allowed) return apiError('file_rate_limited','文件访问过于频繁',429,requestId,{retryable:true,headers:{'Retry-After':String(rate.retryAfter || 60)}});
    let result;
    if(url.pathname==='/api/files/v1/uploads' && method==='POST') {
      result={upload:await secureFilesV1.initializeAttachment(context,auth.account,await readFileJson(context.request,8192))};
    } else {
      const match=/^\/api\/files\/v1\/attachments\/([A-Za-z0-9_-]{16,80})(?:\/(authorize|revoke))?$/.exec(url.pathname);
      if(!match) throw new SecureFileError('file_route_not_found','文件接口不存在',404);
      const handle={source:'transfer',file_id:match[1]};
      if(!match[2] && method==='GET') result={file:await secureFilesV1.metadata(context,auth.account,handle)};
      else if(match[2]==='authorize' && method==='POST') {
        const payload=await readFileJson(context.request,2048);requireAllowedFields(payload,new Set(['password']));
        result={download:await secureFilesV1.authorize(context,auth.account,{...handle,password:payload.password})};
      } else if(match[2]==='revoke' && method==='POST') {
        const payload=await readFileJson(context.request,2048);requireAllowedFields(payload,new Set());
        result={file:await secureFilesV1.revoke(context,auth.account,handle)};
      } else throw new SecureFileError('method_not_allowed','请求方法无效',405);
    }
    const responseHeaders = { 'Cache-Control': 'private, no-store' };
    if (url.pathname.endsWith('/authorize')) {
      const webToken = explicitWebSessionToken(context.request);
      if (webToken) responseHeaders['Set-Cookie'] = webDownloadSessionCookie(context.request, webToken);
    }
    return jsonResponse({ok:true,version:1,...result},url.pathname.endsWith('/uploads')?201:200,requestId,responseHeaders);
  } catch(error) {
    if(error instanceof SecureFileError || error instanceof Task22Error || ['Task12Error','Task14Error'].includes(error?.name)) {
      return apiError(error.code,error.message,error.status,requestId,{retryable:error.retryable});
    }
    console.error(JSON.stringify({event:'secure_file_error',request_id:requestId,error_name:String(error?.name || 'Error')}));
    return apiError('file_service_unavailable','文件服务暂不可用，请稍后重试',503,requestId,{retryable:true});
  }
}
