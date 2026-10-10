export const ALGORITHM_VERSION='mastery-v1';
export const STATE_VERSION=1;
export const DAY=86400000;
export class LearningError extends Error {constructor(message,status=400,code='learning_invalid_input'){super(message);this.status=status;this.code=code;}}
const bounded=(n,min,max)=>Math.max(min,Math.min(max,n));
const round=n=>Math.round(n*1000)/1000;
export function initialMastery(){return {algorithm_version:ALGORITHM_VERSION,state_version:STATE_VERSION,score:0,confidence:0,attempt_count:0,
 correct_count:0,incorrect_count:0,effective_attempt_count:0,consecutive_correct:0,consecutive_incorrect:0,
 last_response_ms:0,average_response_ms:0,last_reviewed_at:null,next_review_at:null,last_update_at:null,
 review_count:0,first_effective_at:null,evidence_days:[],families:[],recent:[],question_stats:{},effective_day:null,daily_effective_count:0,last_event_seq:0};}
export function assertVersion(state){
 if(state.algorithm_version!==ALGORITHM_VERSION||state.state_version!==STATE_VERSION)throw new LearningError('学习算法版本不兼容',503,'mastery_version_incompatible');
 for(const key of ['score','confidence','attempt_count','correct_count','incorrect_count','effective_attempt_count','last_event_seq'])if(!Number.isFinite(state[key])||state[key]<0)throw new LearningError('掌握度状态无效',503,'mastery_state_invalid');
 if(state.score>100||state.confidence>1||!Array.isArray(state.recent)||!Array.isArray(state.families)||!state.question_stats)throw new LearningError('掌握度状态无效',503,'mastery_state_invalid');
}
/** Pure deterministic reducer; event times/order/outcomes are assigned by the server. */
export function updateMastery(previous,event){
 const s=structuredClone(previous||initialMastery());assertVersion(s);
 if(!Number.isSafeInteger(event.seq)||event.seq<=s.last_event_seq)return s;
 if(typeof event.correct!=='boolean'||!Number.isSafeInteger(event.response_ms)||event.response_ms<0||event.response_ms>600000||!Number.isFinite(Date.parse(event.accepted_at))||typeof event.question_id!=='string'||typeof event.family!=='string')throw new LearningError('学习事件无效');
 const now=Date.parse(event.accepted_at),last=Date.parse(s.last_update_at||'');
 if(Number.isFinite(last)&&now<last)throw new LearningError('事件顺序无效',409,'learning_event_order');
 const difficulty=bounded(Number(event.difficulty)||1,1,5),today=event.accepted_at.slice(0,10);
 const question=s.question_stats[event.question_id]||{attempt_count:0,correct_count:0,last_effective_at:null};
 const repeated=question.last_effective_at&&now-Date.parse(question.last_effective_at)<20*60000;
 if(s.effective_day!==today){s.effective_day=today;s.daily_effective_count=0;}
 const weight=repeated||s.daily_effective_count>=6?0:1;
 question.attempt_count++;question.correct_count+=Number(event.correct);s.question_stats[event.question_id]=question;
 s.attempt_count++;s.correct_count+=Number(event.correct);s.incorrect_count+=Number(!event.correct);
 s.consecutive_correct=event.correct?s.consecutive_correct+1:0;s.consecutive_incorrect=event.correct?0:s.consecutive_incorrect+1;
 s.last_response_ms=event.response_ms;s.average_response_ms=round(s.average_response_ms+(event.response_ms-s.average_response_ms)/s.attempt_count);
 if(weight>0){
  s.effective_attempt_count=round(s.effective_attempt_count+weight);
  s.daily_effective_count++;question.last_effective_at=event.accepted_at;
  if(!s.first_effective_at)s.first_effective_at=event.accepted_at;
  s.evidence_days=[...new Set([...s.evidence_days,today])].slice(-14);s.families=[...new Set([...s.families,event.family])].slice(-16);
  const recent=s.recent.slice(-8),accuracy=recent.length?recent.filter(r=>r.correct).length/recent.length:0.5;
  const historic=s.correct_count/s.attempt_count;
  if(event.correct){
   const speed=event.timing_verified===false?1:event.response_ms<=12000?1.1:event.response_ms>45000?.75:1;
   const recall=Number.isFinite(last)&&now-last>=DAY?1.2:1;
   s.score=bounded(s.score+weight*(12*(1-s.score/120)*speed*recall*(1+(difficulty-1)*.08)*(0.85+accuracy*.1+historic*.05)),0,100);
  }else s.score=bounded(s.score-weight*Math.min(12,4+s.consecutive_incorrect*1.5)*(1+(difficulty-1)*.04),0,100);
  const minimumEvidence=s.effective_attempt_count>=6&&s.families.length>=2&&s.evidence_days.length>=2&&now-Date.parse(s.first_effective_at)>=DAY;
  if(!minimumEvidence)s.score=Math.min(79,s.score);
  s.score=round(s.score);s.confidence=round(bounded(s.effective_attempt_count/(s.effective_attempt_count+4)*(0.65+historic*.35),0,1));
  if(s.next_review_at&&Date.parse(s.next_review_at)<=now){s.review_count++;s.last_reviewed_at=event.accepted_at;}
  const intervals=[3600000,8*3600000,DAY,3*DAY,7*DAY,14*DAY,30*DAY];
  const interval=event.correct?intervals[Math.min(6,Math.floor(s.score/15))]:10*60000;
  s.next_review_at=new Date(now+interval).toISOString();
 }
 // Repeated errors still promote review urgency, without unlimited repeat scoring.
 if(!event.correct && weight===0)s.next_review_at=new Date(now+10*60000).toISOString();
 s.recent=[...s.recent,{question_id:event.question_id,family:event.family,at:event.accepted_at,correct:event.correct,effective:weight>0}].slice(-32);
 s.last_update_at=event.accepted_at;s.last_event_seq=event.seq;return s;
}
export function masteryView(state,now=Date.now()){
 const s=structuredClone(state||initialMastery());assertVersion(s);
 const age=s.last_update_at?Math.max(0,now-Date.parse(s.last_update_at))/DAY:0;
 s.confidence=round(s.confidence*Math.max(.2,Math.exp(-age/30)));
 s.overdue=Boolean(s.next_review_at&&Date.parse(s.next_review_at)<=now);
 s.state=!s.attempt_count?'new':s.overdue?'needs_review':s.score>=80&&s.confidence>=.6?'mastered':s.score>=50?'familiar':'learning';
 s.review_priority=round((s.overdue?50:0)+(100-s.score)*.3+Math.min(s.consecutive_incorrect,5)*5+(1-s.confidence)*10);
 return s;
}
export function replayMastery(events,initial=initialMastery()){return [...events].sort((a,b)=>a.seq-b.seq).reduce(updateMastery,initial);}
function hash32(text){let hash=2166136261;for(const c of String(text)){hash^=c.codePointAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}
/** Empty/malformed history is safe; course data is server owned. */
export function selectAdaptive(points,states,history,{userId,sequence=0,mode='adaptive',now=Date.now(),knowledgeId=null}={}){
 const list=Array.isArray(points)?points:[],known=states&&typeof states==='object'?states:{},recent=Array.isArray(history)?history.filter(h=>h&&typeof h.question_id==='string').slice(-8):[];
 const desired=['due','weak','new','due','learning','new','weak','due','spot','learning'][Math.abs(sequence)%10];
 let candidates=[];
 for(const point of list){if(knowledgeId&&point.id!==knowledgeId)continue;
  let s;try{s=masteryView(known[point.id],now);}catch{s=masteryView(null,now);}
  if(mode==='review'&&!s.overdue)continue;
  if(mode==='weak'&&s.score>=70&&s.attempt_count>0)continue;
  const category=s.overdue?'due':!s.attempt_count?'new':s.score<40||s.consecutive_incorrect>=2?'weak':s.score>=80?'spot':'learning';
  for(const q of point.questions||[]){
   const repeated=recent.slice(-5).some(h=>h.question_id===q.id),samePoint=recent.at(-1)?.knowledge_id===point.id;
   const priority=(category===desired?80:0)+s.review_priority+(category==='new'?12:0)-Number(repeated)*300-Number(samePoint)*90;
   candidates.push({point,question:q,reason:category,priority,tie:hash32(`${userId}\0${sequence}\0${q.id}`)});
  }
 }
 candidates.sort((a,b)=>b.priority-a.priority||a.tie-b.tie||(a.question.id<b.question.id?-1:1));
 return candidates[0]||null;
}
