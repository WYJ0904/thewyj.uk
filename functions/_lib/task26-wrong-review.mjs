import { sha256Hex } from './cloudflare-foundation.mjs';
import { LearningError } from './task26-mastery.mjs';
import { evaluateLocalMeaning, evaluateDictation } from '../../js/language/quiz.js';
import { initialWrongReview, reduceWrongReview, WRONG_REVIEW_ALGORITHM, wrongReviewDigest } from '../../js/language/wrong-review.js';

const fail = (message, status=400, code='wrong_review_invalid') => {throw new LearningError(message,status,code);};
const base64 = text => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const wrongRecordPrefix = (profile,scope) => `v1|wrong|${base64(profile)}|${base64(scope)}|`;
export function validateWrongReviewContext(input) {
  if (!input || typeof input.profile !== 'string' || !input.profile.trim() || input.profile.length > 40
    || !['english','japanese'].includes(input.language) || !['current','history'].includes(input.scope)) fail('错题复习范围无效');
  return input;
}
export async function ensureWrongReviewSchema(db) {
  try {await db.batch([db.prepare('SELECT seq,input_digest,attempt_id FROM task26_wrong_review_events LIMIT 0'),
    db.prepare('SELECT state_json,last_event_seq FROM task26_wrong_review_states LIMIT 0')]); return true;} catch {return false;}
}

// CAS projection; corrections replay the ledger, never turn a correction into
// new positive evidence. Pagination retains every historical event.
export async function reconcileWrongReview(db,userId,profile,language,reviewId) {
  for (let attempt=0; attempt<6; attempt++) {
    const args=[userId,profile,language,reviewId];
    const previous=await db.prepare('SELECT * FROM task26_wrong_review_states WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4').bind(...args).first();
    const expected=previous?.last_event_seq || 0;
    const correctionStat=await db.prepare("SELECT COUNT(*) AS n,MAX(seq) AS last_seq FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4 AND kind='correction'").bind(...args).first();
    const rebuild=!previous||(correctionStat.last_seq||0)>expected;
    const correctionRows=rebuild?(await db.prepare("SELECT corrects FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4 AND kind='correction'").bind(...args).all()).results:[];
    const corrected=new Set(correctionRows.map(row=>row.corrects));
    let state=rebuild?initialWrongReview():JSON.parse(previous.state_json), cursor=rebuild?0:expected;
    while (true) {
      const events=(await db.prepare('SELECT * FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4 AND seq>?5 ORDER BY seq LIMIT 512').bind(...args,cursor).all()).results;
      for (const event of events) {
        cursor=event.seq;
        if (event.kind!=='correction' && !corrected.has(event.event_id)) state=reduceWrongReview(state,{at:event.accepted_at,correct:event.correct===1,kind:event.kind});
      }
      if(events.length<512)break;
    }
    if(rebuild)state.corrected=corrected.size;
    // A correction inserted while the first query was running must be included
    // in the exclusion set before we publish any projection.
    const correctionsNow=await db.prepare("SELECT COUNT(*) AS n FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4 AND kind='correction' AND seq<=?5").bind(...args,cursor).first();
    if (correctionsNow.n!==correctionStat.n) continue;
    const result=await db.prepare(`INSERT INTO task26_wrong_review_states(user_id,profile,language,review_id,last_event_seq,state_json)
      VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(user_id,profile,language,review_id) DO UPDATE SET
      last_event_seq=excluded.last_event_seq,state_json=excluded.state_json WHERE task26_wrong_review_states.last_event_seq=?7`)
      .bind(...args,cursor,JSON.stringify(state),expected).run();
    if(result.meta.changes)return {state,last_event_seq:cursor};
  }
  fail('复习进度正在合并，请用原事件重试',409,'wrong_review_busy');
}

export async function submitWrongReview(db,actor,input,{confirmCorrection=null}={}) {
  validateWrongReviewContext(input);
  const allowed=['event_id','attempt_id','profile','scope','language','record_id','review_id','kind','answer','corrects','source_digest'];
  if(Object.keys(input).some(key=>!allowed.includes(key)) || !/^[0-9a-f-]{36}$/i.test(input.event_id||'')
    || typeof input.attempt_id!=='string' || !input.attempt_id || input.attempt_id.length>160
    || typeof input.review_id!=='string' || !input.review_id || input.review_id.length>320
    || typeof input.record_id!=='string' || input.record_id.length>2048 || !input.record_id.startsWith(wrongRecordPrefix(input.profile,input.scope))
    || !['answer','mistake','correction'].includes(input.kind) || typeof input.answer!=='string' || input.answer.length>240
    || (input.kind==='correction' && typeof input.corrects!=='string')) fail('复习事件格式无效');
  if(!/^[0-9a-f]{64}$/.test(input.source_digest||''))fail('复习判卷版本无效');
  const digest=await sha256Hex(JSON.stringify(allowed.map(key=>input[key]??null)));
  let event=await db.prepare('SELECT * FROM task26_wrong_review_events WHERE user_id=?1 AND (event_id=?2 OR attempt_id=?3)').bind(actor.id,input.event_id,input.attempt_id).first();
  if(event && event.input_digest!==digest)fail('同一次答题不能改成另一事件',409,'wrong_review_idempotency_conflict');
  if(!event){
    const row=await db.prepare("SELECT payload_json,deleted FROM task11_learning_sync_records WHERE user_id=?1 AND data_type='wrong_book' AND record_id=?2").bind(actor.id,input.record_id).first();
    if(!row)fail('错题尚未同步；保留本地答题后重试',409,'wrong_review_source_pending');
    if(row.deleted)fail('错题已由用户删除，复习事件不会恢复词条',410,'wrong_review_source_deleted');
    const info=JSON.parse(row.payload_json),word=info.word || (()=>{try{return new TextDecoder().decode(Uint8Array.from(atob(input.record_id.split('|').at(-1).replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)));}catch{return '';}})();
    if(info.language!==input.language || info.review_id!==input.review_id || !word || word.length>240
      ||!input.review_id.startsWith(`v1:${input.language}:${info.question_type==='dictation'?'dictation':'meaning'}:${word.length}:${word}:`))fail('错题范围或版本已改变',409,'wrong_review_source_changed');
    let grading=info;
    if(await wrongReviewDigest(info)!==input.source_digest){
      grading=null;
      for(let offset=0;offset<200&&!grading;offset+=16){
        const history=(await db.prepare("SELECT payload_json FROM task11_learning_sync_changes WHERE user_id=?1 AND data_type='wrong_book' AND record_id=?2 AND deleted=0 ORDER BY user_version DESC LIMIT 16 OFFSET ?3").bind(actor.id,input.record_id,offset).all()).results;
        for(const row of history){const candidate=JSON.parse(row.payload_json);if(candidate.review_id===input.review_id&&await wrongReviewDigest(candidate)===input.source_digest){grading=candidate;break;}}
        if(history.length<16)break;
      }
      if(!grading)fail('原判卷版本尚未得到服务端确认，已保留本地答案及判卷设置',409,'wrong_review_rubric_pending');
    }
    let correct=input.kind==='mistake' && input.answer==='（跳过）' ? false : grading.question_type==='dictation'
      ? evaluateDictation(word,input.answer,{language:input.language,readings:{[word]:grading.rubric?.reading||''},writtenForms:{[word]:word}}).correct
      : evaluateLocalMeaning(word,input.answer,grading,{language:input.language,gradingMode:grading.grading_mode}).correct;
    if(input.kind==='correction'){
      const original=await db.prepare("SELECT event_id FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?2 AND language=?3 AND review_id=?4 AND event_id=?5 AND (correct=0 OR kind='mistake') AND kind!='correction'")
        .bind(actor.id,input.profile,input.language,input.review_id,input.corrects).first();
      if(!original)fail('纠正必须对应已保存的原答题事件',409,'wrong_review_correction_pending');
    }
    // Only an explicit manual rejudge may reuse Task15's established server
    // verdict/cache. Ordinary wrong-book answers never invoke an LLM.
    if(input.kind==='correction'&&!correct&&grading.question_type!=='dictation'&&confirmCorrection){
      correct=(await confirmCorrection({word,answer:input.answer,rubric:grading.rubric||{gloss:grading.correct_answer,accepted:grading.accepted},mode:grading.grading_mode,language:input.language})).correct===true;
    }
    if(input.kind==='correction'){
      if(!correct)fail('纠正必须对应服务端确认的新判卷结果',409,'wrong_review_correction_pending');
    }
    const now=new Date().toISOString();
    await db.prepare(`INSERT INTO task26_wrong_review_events(user_id,event_id,attempt_id,profile,language,record_id,review_id,kind,correct,corrects,accepted_at,input_digest,algorithm_version)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,
      (SELECT MAX(?11,COALESCE(MAX(accepted_at),?11)) FROM task26_wrong_review_events WHERE user_id=?1 AND profile=?4 AND language=?5 AND review_id=?7),?12,?13)
      ON CONFLICT DO NOTHING`).bind(actor.id,input.event_id,input.attempt_id,input.profile,input.language,input.record_id,input.review_id,input.kind,Number(correct),input.corrects||null,now,digest,WRONG_REVIEW_ALGORITHM).run();
    event=await db.prepare('SELECT * FROM task26_wrong_review_events WHERE user_id=?1 AND (event_id=?2 OR attempt_id=?3)').bind(actor.id,input.event_id,input.attempt_id).first();
    if(!event || event.input_digest!==digest)fail('复习事件冲突，请保留原事件',409,'wrong_review_idempotency_conflict');
  }
  const projection=await reconcileWrongReview(db,actor.id,input.profile,input.language,input.review_id);
  return {account_id:actor.id,event_id:input.event_id,attempt_id:input.attempt_id,profile:input.profile,language:input.language,review_id:input.review_id,
    source_digest:input.source_digest,acknowledged:true,correct:event.correct===1,event_seq:event.seq,accepted_at:event.accepted_at,...projection};
}

export async function readWrongReviews(db,actor,input) {
  validateWrongReviewContext(input);
  const records=(await db.prepare(`SELECT r.record_id,r.payload_json,s.state_json,s.last_event_seq,
    (SELECT MAX(e.seq) FROM task26_wrong_review_events e WHERE e.user_id=r.user_id AND e.profile=?3 AND e.language=?4 AND e.review_id=json_extract(r.payload_json,'$.review_id')) AS latest_seq
    FROM task11_learning_sync_records r LEFT JOIN task26_wrong_review_states s
    ON s.user_id=r.user_id AND s.profile=?3 AND s.language=?4 AND s.review_id=json_extract(r.payload_json,'$.review_id')
    WHERE r.user_id=?1 AND r.data_type='wrong_book' AND r.deleted=0 AND r.record_id LIKE ?2 ORDER BY r.record_id LIMIT 250`)
    .bind(actor.id,`${wrongRecordPrefix(input.profile,input.scope)}%`,input.profile,input.language).all()).results;
  const states=[];
  for(const row of records){
    const info=JSON.parse(row.payload_json);
    if(info.language!==input.language || typeof info.review_id!=='string')continue;
    if(row.latest_seq && row.latest_seq>(row.last_event_seq||0)){
      const projection=await reconcileWrongReview(db,actor.id,input.profile,input.language,info.review_id);
      states.push({record_id:row.record_id,review_id:info.review_id,...projection});
    }else if(row.state_json)states.push({record_id:row.record_id,review_id:info.review_id,state:JSON.parse(row.state_json),last_event_seq:row.last_event_seq});
  }
  return {account_id:actor.id,...input,algorithm:WRONG_REVIEW_ALGORITHM,observed_at:new Date().toISOString(),states};
}
