import { sha256Hex } from './cloudflare-foundation.mjs';
import { catalog, POINTS_BY_ID, COURSE_VERSION, gradeQuestion, basicExplanation } from './task26-catalog.mjs';
import { LearningError, initialMastery, assertVersion, updateMastery, masteryView, selectAdaptive, ALGORITHM_VERSION } from './task26-mastery.mjs';

export async function ensureLearningSchema(db){
 try{
  if((await db.prepare("SELECT value FROM task26_metadata WHERE key='schema_version'").first())?.value!=='1')return false;
  if((await db.prepare("SELECT value FROM task26_metadata WHERE key='algorithm_version'").first())?.value!==ALGORITHM_VERSION)return false;
  if((await db.prepare("SELECT value FROM task26_metadata WHERE key='course_version'").first())?.value!==COURSE_VERSION)return false;
  await db.batch([db.prepare('SELECT id,question_json,point_json,algorithm_version,outcome_event_id,receipt_json FROM task26_question_tickets LIMIT 0'),
   db.prepare('SELECT seq,input_digest,answer_digest,timing_verified FROM task26_learning_events LIMIT 0'),db.prepare('SELECT state_json,last_event_seq,algorithm_version FROM task26_mastery_states LIMIT 0')]);
  return true;
 }catch{return false;}
}
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
function eventForEngine(row){return {...row,correct:row.correct===1,timing_verified:row.timing_verified===1};}
function storedState(row){const s=row?JSON.parse(row.state_json):initialMastery();assertVersion(s);
 if(row?.algorithm_version&&row.algorithm_version!==s.algorithm_version)throw new LearningError('学习投影版本不一致，请按原事件版本恢复',503,'mastery_version_incompatible');return s;}

/** Ledger is authoritative; transactional CAS prevents stale concurrent projections. */
export async function reconcilePoint(db,userId,language,knowledgeId){
 for(let attempt=0;attempt<6;attempt++){
  const row=await db.prepare('SELECT * FROM task26_mastery_states WHERE user_id=?1 AND language=?2 AND knowledge_id=?3').bind(userId,language,knowledgeId).first();
  let state=storedState(row);const expected=state.last_event_seq;
  const events=await rows(db,"SELECT * FROM task26_learning_events WHERE user_id=?1 AND language=?2 AND knowledge_id=?3 AND kind='answer_submitted' AND seq>?4 ORDER BY seq LIMIT 512",userId,language,knowledgeId,expected);
  if(!events.length)return state;
  const receipts=[];
  for(const event of events){
   if(event.algorithm_version!==ALGORITHM_VERSION)throw new LearningError('旧学习事件须按原版本重建',503,'mastery_version_incompatible');
   const before=state.score;state=updateMastery(state,eventForEngine(event));
   receipts.push({event,receipt:{event_id:event.event_id,correct:event.correct===1,mistake_code:event.mistake_code,score_before:before,score_after:state.score,score_delta:Math.round((state.score-before)*1000)/1000,algorithm_version:ALGORITHM_VERSION,event_seq:event.seq}});
  }
  const updates=[db.prepare(`INSERT INTO task26_mastery_states(user_id,language,knowledge_id,score,confidence,next_review_at,algorithm_version,state_version,last_event_seq,state_json,updated_at)
   VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
   ON CONFLICT(user_id,language,knowledge_id) DO UPDATE SET score=excluded.score,confidence=excluded.confidence,next_review_at=excluded.next_review_at,
   algorithm_version=excluded.algorithm_version,state_version=excluded.state_version,last_event_seq=excluded.last_event_seq,state_json=excluded.state_json,updated_at=excluded.updated_at
   WHERE task26_mastery_states.last_event_seq=?12`).bind(userId,language,knowledgeId,state.score,state.confidence,state.next_review_at,ALGORITHM_VERSION,state.state_version,state.last_event_seq,JSON.stringify(state),state.last_update_at,expected)];
  // One statement for receipts keeps recovery bounded by query count even when
  // replaying a backlog; it does not issue one D1 query per historical answer.
  updates.push(db.prepare(`UPDATE task26_question_tickets AS t SET receipt_json=(SELECT json_extract(j.value,'$.receipt') FROM json_each(?1) j
    WHERE json_extract(j.value,'$.ticket_id')=t.id AND json_extract(j.value,'$.event_id')=t.outcome_event_id)
    WHERE t.user_id=?2 AND t.language=?3 AND t.knowledge_id=?4 AND t.receipt_json IS NULL
    AND t.id IN (SELECT json_extract(j.value,'$.ticket_id') FROM json_each(?1) j)
    AND EXISTS(SELECT 1 FROM task26_mastery_states WHERE user_id=?2 AND language=?3 AND knowledge_id=?4 AND last_event_seq=?5)`)
    .bind(JSON.stringify(receipts.map(({event,receipt})=>({ticket_id:event.ticket_id,event_id:event.event_id,receipt}))),userId,language,knowledgeId,state.last_event_seq));
  const result=await db.batch(updates);
  if(result[0].meta.changes && events.length<512)return state;
 }
 throw new LearningError('学习进度更新繁忙，请以相同事件重试',409,'learning_projection_busy');
}
export async function reconcileLearning(db,actor,language){
 const dirty=await rows(db,`SELECT e.knowledge_id,MAX(e.seq) AS event_seq FROM task26_learning_events e
  LEFT JOIN task26_mastery_states s ON s.user_id=e.user_id AND s.language=e.language AND s.knowledge_id=e.knowledge_id
  WHERE e.user_id=?1 AND e.language=?2 AND e.kind='answer_submitted' GROUP BY e.knowledge_id HAVING MAX(e.seq)>COALESCE(s.last_event_seq,0) LIMIT 128`,actor.id,language);
 for(const row of dirty)await reconcilePoint(db,actor.id,language,row.knowledge_id);
 return {reconciled_points:dirty.length};
}
export async function readMastery(db,actor,language){
 const records=await rows(db,'SELECT * FROM task26_mastery_states WHERE user_id=?1 AND language=?2 ORDER BY knowledge_id LIMIT 256',actor.id,language);
 const now=Date.now(),points=records.map(r=>{const p=POINTS_BY_ID.get(r.knowledge_id);return {knowledge_id:r.knowledge_id,label:p?.label||r.knowledge_id,kind:p?.kind||'vocabulary',...masteryView(storedState(r),now)};});
 const pending=await db.prepare(`SELECT COUNT(*) AS count FROM (SELECT e.knowledge_id,MAX(e.seq) AS seq FROM task26_learning_events e WHERE e.user_id=?1 AND e.language=?2 AND e.kind='answer_submitted' GROUP BY e.knowledge_id) e
  LEFT JOIN task26_mastery_states s ON s.user_id=?1 AND s.language=?2 AND s.knowledge_id=e.knowledge_id WHERE e.seq>COALESCE(s.last_event_seq,0)`).bind(actor.id,language).first();
 const mistakes=await rows(db,"SELECT event_id,knowledge_id,question_id,mistake_code,accepted_at FROM task26_learning_events WHERE user_id=?1 AND language=?2 AND kind='answer_submitted' AND correct=0 ORDER BY seq DESC LIMIT 12",actor.id,language);
 return {account_id:actor.id,language,algorithm_version:ALGORITHM_VERSION,state_version:1,observed_at:new Date(now).toISOString(),projection_pending:Number(pending.count)>0,
  summary:{studied_count:points.length,catalog_total:catalog(language).length,new_count:catalog(language).length-points.length,
   average_mastery:points.length?Math.round(points.reduce((n,p)=>n+p.score,0)/points.length*10)/10:0,
   mastered_count:points.filter(p=>p.state==='mastered').length,due_count:points.filter(p=>p.overdue).length,learning_count:points.filter(p=>['learning','familiar'].includes(p.state)).length},
  points,weak_points:[...points].sort((a,b)=>b.review_priority-a.review_priority).slice(0,8),recent_mistakes:mistakes};
}
function platform(request){return request.headers.has('Cookie')&&request.headers.get('Cookie').includes('__Host-wyj_app_access=')?'webview':/thewyj-android/i.test(request.headers.get('User-Agent')||'')?'native':'browser';}
function eventInsert(db,ticket,actor,{eventId,kind,digest,correct=null,answerDigest='',duration=0,timing=false,mistake='',channel,request,conditional=false}){
 const now=new Date().toISOString();
 return db.prepare(`INSERT INTO task26_learning_events(user_id,event_id,ticket_id,language,knowledge_id,question_id,family,kind,correct,response_ms,timing_verified,difficulty,accepted_at,algorithm_version,source,platform,channel,input_digest,answer_digest,mistake_code)
  SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
  (SELECT MAX(?13,COALESCE(MAX(accepted_at),?13)) FROM task26_learning_events WHERE user_id=?1 AND knowledge_id=?5),?14,?15,?16,?17,?18,?19,?20
  FROM task26_question_tickets WHERE id=?3 AND user_id=?1 ${conditional?'AND outcome_event_id IS NULL AND expires_at>=?13':''}
  ON CONFLICT(user_id,event_id) DO NOTHING`).bind(actor.id,eventId,ticket.id,ticket.language,ticket.knowledge_id,ticket.question_id,JSON.parse(ticket.question_json).family,kind,correct,duration,Number(timing),JSON.parse(ticket.point_json).difficulty,now,ALGORITHM_VERSION,ticket.mode,platform(request),channel,digest,answerDigest,mistake);
}
export async function issueQuestion(db,actor,input,snapshot,request){
 await reconcileLearning(db,actor,input.language);
 const records=await rows(db,'SELECT knowledge_id,state_json,algorithm_version FROM task26_mastery_states WHERE user_id=?1 AND language=?2 LIMIT 256',actor.id,input.language);
 const states=Object.fromEntries(records.map(r=>[r.knowledge_id,storedState(r)]));
 const history=(await rows(db,'SELECT question_id,knowledge_id FROM task26_question_tickets WHERE user_id=?1 AND language=?2 ORDER BY issued_at DESC,rowid DESC LIMIT 8',actor.id,input.language)).reverse();
 const sequence=(await db.prepare('SELECT COUNT(*) AS count FROM task26_question_tickets WHERE user_id=?1 AND language=?2').bind(actor.id,input.language).first()).count;
 const selected=selectAdaptive(catalog(input.language),states,history,{userId:actor.id,sequence,mode:input.mode,knowledgeId:input.knowledge_id||null});
 if(!selected)return {question:null,reason:input.mode==='review'?'review_complete':'no_available_questions'};
 const id=crypto.randomUUID(),now=new Date().toISOString(),expires=new Date(Date.now()+7*86400000).toISOString();
 const {point,question,reason}=selected,ticket={id,language:input.language,knowledge_id:point.id,question_id:question.id,question_json:JSON.stringify(question),point_json:JSON.stringify(point),mode:input.mode};
 await db.batch([db.prepare(`INSERT INTO task26_question_tickets(id,user_id,language,knowledge_id,question_id,question_json,point_json,course_version,algorithm_version,mode,issued_at,expires_at)
  VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`).bind(id,actor.id,input.language,point.id,question.id,ticket.question_json,ticket.point_json,COURSE_VERSION,ALGORITHM_VERSION,input.mode,now,expires),
  eventInsert(db,ticket,actor,{eventId:crypto.randomUUID(),kind:'question_shown',digest:await sha256Hex(id+'shown'),channel:snapshot.channel,request}),
  ...(input.mode==='review'?[eventInsert(db,ticket,actor,{eventId:crypto.randomUUID(),kind:'review_started',digest:await sha256Hex(id+'review'),channel:snapshot.channel,request})]:[])]);
 // Opaque ticket, generic labels for spelling/grammar: no embedded answer ID/reading/gloss.
 return {question:{ticket_id:id,language:input.language,kind:question.kind,prompt:question.prompt,instruction:question.instruction,
  knowledge_label:question.kind==='spelling'?'英语词汇':question.kind==='cloze'?'语法练习':point.word,reason,expires_at:expires},algorithm_version:ALGORITHM_VERSION};
}
export async function submitLearningEvent(db,actor,input,snapshot,request){
 const ticket=await db.prepare('SELECT * FROM task26_question_tickets WHERE id=?1 AND user_id=?2').bind(input.ticket_id,actor.id).first();
 if(!ticket)throw new LearningError('题目不存在或不属于当前账户',404,'learning_ticket_not_found');
 if(ticket.algorithm_version!==ALGORITHM_VERSION)throw new LearningError('题目算法版本已变更，请获取新题目',409,'learning_ticket_version_changed');
 const digest=await sha256Hex(JSON.stringify({ticket_id:input.ticket_id,kind:input.kind,answer:input.answer??null,response_ms:input.response_ms??0}));
 let existing=await db.prepare('SELECT * FROM task26_learning_events WHERE user_id=?1 AND event_id=?2').bind(actor.id,input.event_id).first();
 if(existing&&existing.input_digest!==digest)throw new LearningError('同一事件标识不能用于不同请求',409,'learning_idempotency_conflict');
 if(!existing){
  if(Date.parse(ticket.expires_at)<Date.now())throw new LearningError('题目凭据已过期，已保存的学习记录不会删除',410,'learning_ticket_expired');
  const question=JSON.parse(ticket.question_json),point=JSON.parse(ticket.point_json),answer=input.answer||'';
  const correct=input.kind==='answer_submitted'?gradeQuestion(question,answer,ticket.language):null;
  const elapsed=Math.max(0,Date.now()-Date.parse(ticket.issued_at)),timing=elapsed<600000&&Math.abs(elapsed-(input.response_ms||0))<=5000;
  const mistake=correct===false?(question.kind==='reading'?'reading_mismatch':question.kind==='cloze'?'grammar_form':'meaning_mismatch'):'';
  const terminal=['answer_submitted','skipped','timeout'].includes(input.kind);
  const insert=eventInsert(db,ticket,actor,{eventId:input.event_id,kind:input.kind,digest,correct:correct===null?null:Number(correct),answerDigest:answer?await sha256Hex(answer):'',duration:input.response_ms||0,timing,mistake,channel:snapshot.channel,request,conditional:terminal});
  const updates=[insert];
  if(terminal)updates.push(db.prepare(`UPDATE task26_question_tickets SET outcome_event_id=?1 WHERE id=?2 AND user_id=?3 AND outcome_event_id IS NULL AND EXISTS(SELECT 1 FROM task26_learning_events WHERE user_id=?3 AND event_id=?1 AND input_digest=?4)`).bind(input.event_id,ticket.id,actor.id,digest));
  await db.batch(updates);
  existing=await db.prepare('SELECT * FROM task26_learning_events WHERE user_id=?1 AND event_id=?2').bind(actor.id,input.event_id).first();
  if(!existing)throw new LearningError('这道题已完成，请获取下一题',409,'learning_ticket_already_answered');
  if(existing.input_digest!==digest)throw new LearningError('同一事件标识不能用于不同请求',409,'learning_idempotency_conflict');
 }
 if(input.kind!=='answer_submitted')return {event_id:input.event_id,event_seq:existing.seq,acknowledged:true};
 const outcomeKind=existing.correct===1?'answer_correct':'answer_incorrect';
 await db.batch([eventInsert(db,ticket,actor,{eventId:`${input.event_id}:result`,kind:outcomeKind,digest:await sha256Hex(digest+outcomeKind),correct:existing.correct,channel:snapshot.channel,request}),
  ...(ticket.mode==='review'?[eventInsert(db,ticket,actor,{eventId:`${input.event_id}:review`,kind:'review_completed',digest:await sha256Hex(digest+'review'),channel:snapshot.channel,request})]:[])]);
 const state=await reconcilePoint(db,actor.id,ticket.language,ticket.knowledge_id);
 const saved=await db.prepare('SELECT receipt_json FROM task26_question_tickets WHERE id=?1 AND user_id=?2').bind(ticket.id,actor.id).first();
 if(!saved.receipt_json)throw new LearningError('答题已保存，进度正在恢复，请以相同事件重试',503,'learning_projection_pending');
 const question=JSON.parse(ticket.question_json),point=JSON.parse(ticket.point_json);
 return {...JSON.parse(saved.receipt_json),acknowledged:true,account_id:actor.id,language:ticket.language,mastery:masteryView(state),
  knowledge:{id:point.id,label:point.label,kind:point.kind,reading:point.reading,gloss:point.gloss},correct_answer:question.answers.join(' / '),explanation:basicExplanation(point,question)};
}
export async function explanationContext(db,actor,eventId){
 const event=await db.prepare("SELECT * FROM task26_learning_events WHERE user_id=?1 AND event_id=?2 AND kind='answer_submitted'").bind(actor.id,eventId).first();
 if(!event)throw new LearningError('只能查看本账户已经作答的题目解析',404,'learning_event_not_found');
 const ticket=await db.prepare('SELECT * FROM task26_question_tickets WHERE id=?1 AND user_id=?2').bind(event.ticket_id,actor.id).first();
 return {event,point:JSON.parse(ticket.point_json),question:JSON.parse(ticket.question_json)};
}
export async function learningMetrics(db){
 const [counts,distribution,pending]=await db.batch([db.prepare("SELECT kind,COUNT(*) AS count FROM task26_learning_events GROUP BY kind"),
  db.prepare('SELECT CAST(score/20 AS INTEGER)*20 AS score_band,COUNT(*) AS count FROM task26_mastery_states GROUP BY score_band'),
  db.prepare("SELECT COUNT(*) AS count FROM task26_question_tickets WHERE outcome_event_id IS NOT NULL AND receipt_json IS NULL AND EXISTS(SELECT 1 FROM task26_learning_events WHERE ticket_id=task26_question_tickets.id AND kind='answer_submitted')")]);
 return {algorithm_version:ALGORITHM_VERSION,event_counts:counts.results,score_distribution:distribution.results,pending_projections:pending.results[0].count};
}
