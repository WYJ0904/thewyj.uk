export const MASTERY_ALGORITHM='mastery-v1';
export const MAX_PENDING_ANSWERS=40;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bounded=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
export const masteryStorageKey=accountId=>`aerisMastery:v1:${accountId}`;
export function emptyLearningStore(accountId){return {schema_version:1,account_id:accountId,outbox:[],questions:{},cache:{},results:{}};}
export function parseIssuedQuestion(q,language){
 if(!q||!UUID.test(q.ticket_id||'')||q.language!==language||!['meaning','reading','spelling','cloze'].includes(q.kind)
  ||!['prompt','instruction','knowledge_label','reason','expires_at'].every(k=>typeof q[k]==='string'&&q[k].length<=500)
  ||!Number.isFinite(Date.parse(q.expires_at)))return null;
 return {ticket_id:q.ticket_id,language,kind:q.kind,prompt:q.prompt,instruction:q.instruction,knowledge_label:q.knowledge_label,reason:q.reason,expires_at:q.expires_at};
}
export function parseMasterySummary(value,accountId,language){
 if(value?.account_id!==accountId||value.language!==language||value.algorithm_version!==MASTERY_ALGORITHM||value.state_version!==1
  ||!Number.isFinite(Date.parse(value.observed_at))||!Array.isArray(value.points)||value.points.length>256||typeof value.projection_pending!=='boolean'
  ||!value.summary||!bounded(value.summary.average_mastery,0,100))return null;
 const counts=['studied_count','catalog_total','new_count','mastered_count','due_count','learning_count'];
 if(!counts.every(k=>Number.isSafeInteger(value.summary[k])&&value.summary[k]>=0&&value.summary[k]<=10000))return null;
 if(value.points.some(p=>typeof p.knowledge_id!=='string'||!p.knowledge_id.startsWith(`${language}:`)||typeof p.label!=='string'||p.label.length>200
  ||!bounded(p.score,0,100)||!bounded(p.confidence,0,1)||!Number.isSafeInteger(p.attempt_count)||p.attempt_count<0
  ||!Number.isSafeInteger(p.last_event_seq)||p.last_event_seq<0||p.algorithm_version!==MASTERY_ALGORITHM||p.state_version!==1
  ||!['new','learning','familiar','mastered','needs_review'].includes(p.state)))return null;
 return structuredClone(value);
}
export function parseAnswerReceipt(value,input,accountId,language){
 if(value?.event_id!==input.event_id||value.account_id!==accountId||value.language!==language||value.acknowledged!==true
  ||value.algorithm_version!==MASTERY_ALGORITHM||typeof value.correct!=='boolean'||!Number.isSafeInteger(value.event_seq)||value.event_seq<1
  ||!bounded(value.score_before,0,100)||!bounded(value.score_after,0,100)||!bounded(value.score_delta,-100,100)
  ||Math.abs(value.score_after-value.score_before-value.score_delta)>.002||!bounded(value.mastery?.score,0,100)
  ||!Number.isSafeInteger(value.mastery?.last_event_seq)||value.mastery.last_event_seq<value.event_seq
  ||typeof value.correct_answer!=='string'||value.correct_answer.length>1500||typeof value.knowledge?.label!=='string')return null;
 return structuredClone(value);
}
export function parseLearningStore(value,accountId){
 if(value===null||value===undefined)return emptyLearningStore(accountId);
 if(value.schema_version!==1||value.account_id!==accountId||!Array.isArray(value.outbox)||value.outbox.length>MAX_PENDING_ANSWERS
  ||!value.questions||!value.cache||!value.results)throw new Error('本机学习数据版本无效，已保留原记录；请先恢复数据后继续。');
 const store=structuredClone(value),seen=new Set();
 for(const e of store.outbox){
  if(!['english','japanese'].includes(e.language)||!UUID.test(e.input?.event_id||'')||!UUID.test(e.input?.ticket_id||'')||seen.has(e.input.event_id)
   ||e.input.kind!=='answer_submitted'||typeof e.input.answer!=='string'||!e.input.answer.trim()||e.input.answer.length>240
   ||!Number.isSafeInteger(e.input.response_ms)||e.input.response_ms<0||e.input.response_ms>600000)throw new Error('待同步学习记录格式无效，原记录已保留。');
  seen.add(e.input.event_id);
 }
 for(const lang of ['english','japanese']){
  if(store.questions[lang]&&!parseIssuedQuestion(store.questions[lang].question,lang))throw new Error('本机题目数据格式无效，原记录已保留。');
  if(store.cache[lang]&&!parseMasterySummary(store.cache[lang],accountId,lang))delete store.cache[lang];
 }
 return store;
}
export function enqueueAnswer(store,entry){
 if(store.outbox.some(e=>e.input.ticket_id===entry.input.ticket_id))throw new Error('这道题已有待同步答题，请先重试同步。');
 if(store.outbox.length>=MAX_PENDING_ANSWERS)throw new Error('待同步答题已达上限，请联网同步后继续；现有记录会保留。');
 const next=structuredClone(store);next.outbox.push(structuredClone(entry));return next;
}
export function acknowledgeAnswer(store,entry,receipt){
 const next=structuredClone(store);next.outbox=next.outbox.filter(e=>e.input.event_id!==entry.input.event_id);
 next.results[entry.language]={ticket_id:entry.input.ticket_id,input:entry.input,receipt};return next;
}
export function acceptSummaryCache(store,summary){
 const previous=store.cache[summary.language];
 if(previous){const incoming=new Map(summary.points.map(p=>[p.knowledge_id,p.last_event_seq]));
  if(previous.points.some(p=>(incoming.get(p.knowledge_id)??-1)<p.last_event_seq))return store;}
 const next=structuredClone(store);next.cache[summary.language]=summary;return next;
}
