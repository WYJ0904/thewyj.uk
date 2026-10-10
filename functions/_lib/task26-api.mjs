import { apiError, classifyCloudError, enforceD1RateLimit, featureFlags, jsonResponse } from './cloudflare-foundation.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { enrichAccountWithTask13 } from './task13-service.mjs';
import { hasLanguageEntitlement } from './task15-model.mjs';
import { runStructuredAi } from './task15-ai.mjs';
import { readFeatureSnapshot, ensureTask25Schema } from './task25-service.mjs';
import { LearningError } from './task26-mastery.mjs';
import { POINTS_BY_ID, basicExplanation, COURSE_VERSION } from './task26-catalog.mjs';
import { ensureLearningSchema, issueQuestion, submitLearningEvent, readMastery, reconcileLearning, explanationContext, learningMetrics } from './task26-service.mjs';

const ROUTES=new Map([
 ['POST /api/learning/adaptive/next','adaptive_learning'],['POST /api/learning/events','adaptive_learning'],
 ['GET /api/learning/mastery/summary','mastery_score'],['GET /api/learning/mastery','mastery_score'],
 ['POST /api/learning/mastery/reconcile','mastery_score'],['GET /api/learning/review','adaptive_review'],
 ['POST /api/learning/explanation','adaptive_learning'],['GET /api/admin/learning/metrics','admin'],
]);
const CLIENT_EVENTS=new Set(['answer_submitted','answer_changed','retry','skipped','timeout','explanation_opened']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reject(message='学习请求格式无效',status=400,code='learning_invalid_input'){throw new LearningError(message,status,code);}
function fields(value,allowed){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))reject();
 return value;
}
function language(value){if(!['english','japanese'].includes(value))reject('请选择英语或日语');return value;}
async function body(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))reject('请使用 JSON 请求',415,'learning_content_type');
 if(Number(request.headers.get('Content-Length')||0)>8192)reject('学习请求过大',413,'learning_request_too_large');
 const bytes=await request.arrayBuffer();if(bytes.byteLength>8192)reject('学习请求过大',413,'learning_request_too_large');
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{reject('请求 JSON 无效');}
}
function query(url,allowed){
 if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>url.searchParams.getAll(k).length>1))reject();
 return Object.fromEntries(url.searchParams);
}
function requireFeature(snapshot,key){if(!snapshot.flags[key]?.enabled)reject('此学习功能尚未向当前账户开放',403,'learning_feature_disabled');}
function requireLanguage(actor,value){if(!hasLanguageEntitlement(actor,value))reject('当前账户没有该语言的会员权益，普通测验仍可使用',403,'learning_entitlement_required');}
function knowledge(id,lang){if(id!==undefined&&(!POINTS_BY_ID.has(id)||POINTS_BY_ID.get(id).language!==lang))reject('知识点不属于当前语言');}

async function explanation(context,actor,input,snapshot){
 const {event,point,question}=await explanationContext(context.env.WYJ_DB,actor,input.event_id);
 requireLanguage(actor,event.language);
 const local=basicExplanation(point,question);
 if(!snapshot.flags.similar_word_explanation?.enabled)local.confusion='';
 const result={event_id:event.event_id,correct:event.correct===1,explanation:local,ai:null,ai_status:'not_requested'};
 // Course answers/rules remain authoritative. AI sees bounded, server-owned context only.
 if(event.correct===1||!snapshot.flags.ai_error_explanation?.enabled)return result;
 try{
  const keys=['why','rule','example','contrast'];
  const validate=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length
   &&keys.every(k=>typeof value[k]==='string'&&value[k].length<=800)&&value.why.trim().length>0&&value.rule.trim().length>0;
  const normalizedInput={task:'task26_error_explanation_v1',course_version:COURSE_VERSION,knowledge_id:point.id,question_id:question.id,mistake:event.mistake_code,
   prompt:question.prompt,answer:question.answers.join(' / '),rule:local.rule,example:local.example,
   confusion:snapshot.flags.similar_word_explanation?.enabled?point.confusion:null};
  // The existing cache has a fixed category CHECK. Use its rubric category with
  // an explicit Task26 key namespace; no legacy table rebuild or cache mutation.
  const ai=await runStructuredAi(context,{account:actor,taskType:'rubric',normalizedInput,validate,timeoutMs:3000,maxTokens:700,
   schema:{type:'object',additionalProperties:false,required:keys,properties:Object.fromEntries(keys.map(k=>[k,{type:'string',maxLength:800}]))},
   messages:[{role:'system',content:'你是英语/日语学习辅导。课程答案和规则已经确定，不得重判或输出分数。用简洁中文解释已确定的错误，提供对比和例句。只输出指定 JSON 字段，不输出 HTML。不得声称知道未提供的用户原始答案。'},
    {role:'user',content:JSON.stringify(normalizedInput)}]});
  result.ai={source:'workers_ai',...ai.result};result.ai_status=ai.cacheHit?'cached':'generated';
 }catch(error){result.ai_status='fallback';result.fallback_code=String(error?.code||'ai_unavailable').slice(0,80);}
 return result;
}

export async function handleTask26Request(context){
 const url=new URL(context.request.url),method=context.request.method.toUpperCase(),route=ROUTES.get(`${method} ${url.pathname}`),id=context.data?.requestId||'';
 if(!route){const allowed=[...ROUTES.keys()].filter(k=>k.endsWith(` ${url.pathname}`)).map(k=>k.split(' ')[0]);
  return allowed.length?apiError('method_not_allowed','此接口不支持当前方法',405,id,{headers:{Allow:allowed.join(', ')}}):null;}
 const flags=featureFlags(context.env);
 if(!flags.task26AdaptiveLearning)return apiError('task26_disabled','自适应学习尚未启用，普通测验仍可使用',503,id,{retryable:true});
 try{
  if(!flags.task12CloudAccounts||!flags.task25FeatureFlags||!flags.task11CloudReads||(method==='POST'&&!flags.task11CloudWrites))reject('学习依赖服务暂不可用',503,'learning_dependency_unavailable');
  const auth=await resolveTask12Account(context,{touch:false});
  if(!auth.authenticated)return apiError(auth.code,'请使用有效账户登录',auth.status,id);
  const db=context.env.WYJ_DB,actor=await enrichAccountWithTask13(db,auth.account);
  if(route==='admin'&&!actor.is_admin)reject('无管理员权限',403,'forbidden');
  if(!await ensureTask25Schema(db)||!await ensureLearningSchema(db))reject('自适应学习数据尚未就绪，普通测验仍可使用',503,'learning_schema_not_ready');
  const snapshot=await readFeatureSnapshot(db,actor.id);
  if(route!=='admin'){requireFeature(snapshot,route);if(route==='adaptive_learning')requireFeature(snapshot,'mastery_score');}
  const rate=await enforceD1RateLimit(context,{enabled:flags.d1RateLimit,limit:method==='GET'?120:url.pathname.endsWith('/explanation')?20:60,
   windowSeconds:60,scope:`task26:${method}:${url.pathname}`,subject:actor.id});
  if(!rate.allowed)return apiError('learning_rate_limited','学习操作过于频繁，请稍后重试',429,id,{retryable:true,headers:{'Retry-After':String(rate.retryAfter||60)}});
  const input=method==='POST'?await body(context.request):query(url,route==='admin'?[]:['language','knowledge_id']);
  if(method==='POST'&&url.search)reject();
  let result;
  if(route==='admin')result=await learningMetrics(db);
  else if(url.pathname==='/api/learning/events'){
   fields(input,['event_id','ticket_id','kind','answer','response_ms']);
   if(!UUID.test(input.event_id||'')||!UUID.test(input.ticket_id||'')||!CLIENT_EVENTS.has(input.kind))reject();
   if(input.kind==='answer_submitted'&&(typeof input.answer!=='string'||!input.answer.trim()||input.answer.length>240))reject();
   if(input.kind!=='answer_submitted'&&input.answer!==undefined)reject();
   if(input.response_ms!==undefined&&(!Number.isSafeInteger(input.response_ms)||input.response_ms<0||input.response_ms>600000))reject();
   const ticket=await db.prepare('SELECT language,mode FROM task26_question_tickets WHERE id=?1 AND user_id=?2').bind(input.ticket_id,actor.id).first();
   if(!ticket)reject('题目不存在或不属于当前账户',404,'learning_ticket_not_found');
   requireLanguage(actor,ticket.language);
   if(ticket.mode==='review')requireFeature(snapshot,'adaptive_review');
   result=await submitLearningEvent(db,actor,input,snapshot,context.request);
   if(result.explanation&&!snapshot.flags.similar_word_explanation?.enabled)result.explanation.confusion='';
  }else if(url.pathname==='/api/learning/explanation'){
   fields(input,['event_id']);if(!UUID.test(input.event_id||''))reject();result=await explanation(context,actor,input,snapshot);
  }else{
   const lang=language(input.language);requireLanguage(actor,lang);knowledge(input.knowledge_id,lang);
   if(url.pathname==='/api/learning/adaptive/next'){
    fields(input,['language','mode','knowledge_id']);const mode=input.mode||'adaptive';
    if(!['adaptive','weak','review'].includes(mode))reject();if(mode==='review')requireFeature(snapshot,'adaptive_review');
    result=await issueQuestion(db,actor,{...input,mode},snapshot,context.request);
   }else if(url.pathname==='/api/learning/mastery/reconcile'){
    fields(input,['language']);result={...await reconcileLearning(db,actor,lang),...await readMastery(db,actor,lang)};
   }else{
    result=await readMastery(db,actor,lang);
    if(url.pathname==='/api/learning/review'){result.points=result.points.filter(p=>p.overdue).sort((a,b)=>b.review_priority-a.review_priority);result.review_count=result.points.length;}
    if(input.knowledge_id)result.points=result.points.filter(p=>p.knowledge_id===input.knowledge_id);
   }
  }
  return jsonResponse({ok:true,...result},200,id,{'Cache-Control':'private, no-store'});
 }catch(error){
  if(error instanceof LearningError)return apiError(error.code,error.message,error.status,id,{retryable:error.status>=500||error.code==='learning_projection_busy'});
  console.error(JSON.stringify({event:'task26_error',request_id:id,kind:classifyCloudError(error)}));
  return apiError('learning_unavailable','自适应学习暂不可用，普通测验仍可使用；待同步答题请保留后重试',503,id,{retryable:true});
 }
}
