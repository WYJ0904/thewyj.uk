// Shared by the browser and D1 service. Client times are local evidence only;
// the service calls this reducer with its own acceptance time and order.
export const WRONG_REVIEW_ALGORITHM = 'wrong-review-v1';
export const WRONG_REVIEW_VERSION = 1;
export const REVIEW_DAY = 86400000;
export const REVIEW_COOLDOWN = 20 * 60000;
export const REVIEW_INTERVALS = Object.freeze([1, 3, 7, 14, 30].map(days => days * REVIEW_DAY));
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;

// Bind a queued answer to the actual grading settings it used, independently
// of aggregate counts or later device edits to the same wrong-book record.
export function wrongReviewSource(info) {
  return {word:String(info.word||'').trim().slice(0,240),language:info.language,
    question_type:info.question_type==='dictation'?'dictation':'meaning',
    grading_mode:['strict','normal','lenient'].includes(info.grading_mode)?info.grading_mode:'normal',
    correct_answer:String(info.correct_answer||'').trim().slice(0,500),
    accepted:[...new Set((Array.isArray(info.accepted)?info.accepted:[]).map(value=>String(value).trim().slice(0,500)).filter(Boolean))].slice(0,14).sort(),
    reading:String(info.rubric?.reading||'').trim().slice(0,80)};
}
export async function wrongReviewDigest(info){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(wrongReviewSource(info))));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function cleanReviewEvents(value) {
  if (!Array.isArray(value)) return [];
  const events = new Map();
  for (const item of value) {
    if (!item || !validId(item.id) || !iso(item.at) || typeof item.correct !== 'boolean'
      || !['answer', 'mistake', 'correction'].includes(item.kind)) continue;
    if (item.kind === 'correction' && !validId(item.corrects)) continue;
    const event = {id:item.id, at:iso(item.at), correct:item.correct, kind:item.kind,
      ...(item.kind === 'correction' ? {corrects:item.corrects} : {})};
    // Deterministic conflict resolution; an ID never becomes two samples.
    const previous = events.get(event.id);
    if (!previous || JSON.stringify(event) < JSON.stringify(previous)) events.set(event.id, event);
  }
  return [...events.values()].sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).slice(-128);
}

export function sanitizeWrongReview(value) {
  return {version:WRONG_REVIEW_VERSION, algorithm:WRONG_REVIEW_ALGORITHM,
    base_wrong_count:Math.max(0,Math.min(9999,Number.parseInt(value?.base_wrong_count,10)||0)),
    truncated:Boolean(value?.truncated || value?.events?.length>128),
    events:cleanReviewEvents(value?.version === 1 && value?.algorithm === WRONG_REVIEW_ALGORITHM ? value.events : [])};
}

export function mergeWrongReview(left, right) {
  const a=sanitizeWrongReview(left),b=sanitizeWrongReview(right),all=new Map();
  for(const event of [...a.events,...b.events]){const previous=all.get(event.id);if(!previous||JSON.stringify(event)<JSON.stringify(previous))all.set(event.id,event);}
  return sanitizeWrongReview({version:1, algorithm:WRONG_REVIEW_ALGORITHM,base_wrong_count:Math.max(a.base_wrong_count,b.base_wrong_count),
    truncated:a.truncated||b.truncated||all.size>128,events:[...all.values()]});
}

export function mergeWrongCounts(left,right) {
  const a=Number(left.wrong_count)||0,b=Number(right.wrong_count)||0;
  if(!left.review_id||left.review_id!==right.review_id)return Math.max(a,b);
  const evidence=mergeWrongReview(left.review,right.review);
  return evidence.truncated?Math.max(a,b):Math.min(9999,Math.max(a,b,evidence.base_wrong_count+evidence.events.filter(event=>!event.correct&&event.kind!=='correction').length));
}

export function initialWrongReview() {
  return {version:1, algorithm:WRONG_REVIEW_ALGORITHM, attempts:0, correct:0, incorrect:0,
    effective:0, streak:0, score:0, days:[], last_effective_at:null, last_review_at:null,
    next_review_at:null, mastered:false, last_failure_at:null, corrected:0};
}

export function reduceWrongReview(previous, event) {
  const state = structuredClone(previous || initialWrongReview());
  if (state.algorithm !== WRONG_REVIEW_ALGORITHM || state.version !== 1) throw new Error('错题复习版本不兼容');
  const now = Date.parse(event.at);
  if (!Number.isFinite(now) || typeof event.correct !== 'boolean') throw new Error('错题复习事件无效');
  state.attempts += 1;
  state.correct += Number(event.correct);
  state.incorrect += Number(!event.correct);
  state.last_review_at = event.at;
  if (!event.correct) {
    state.streak = 0; state.score = Math.max(0, state.score - 30); state.mastered = false;
    state.last_failure_at = event.at;
    state.next_review_at = new Date(now + 10 * 60000).toISOString();
  } else {
    const day = event.at.slice(0,10);
    const eligible = event.kind !== 'mistake' && !state.days.includes(day)
      && (!state.last_effective_at || now - Date.parse(state.last_effective_at) >= REVIEW_COOLDOWN)
      && (!state.next_review_at || now >= Date.parse(state.next_review_at));
    if (eligible) {
      state.effective += 1; state.streak = Math.min(5, state.streak + 1);
      state.days = [...state.days, day].slice(-14); state.last_effective_at = event.at;
      state.score = Math.min(100, state.streak * 20);
      state.mastered = state.streak >= 5 && state.days.length >= 5;
      state.next_review_at = new Date(now + REVIEW_INTERVALS[state.streak - 1]).toISOString();
    }
  }
  return state;
}

export function replayWrongReview(value) {
  const events = cleanReviewEvents(value), corrected = new Set(events.filter(e => e.kind === 'correction').map(e => e.corrects));
  const state = events.filter(e => e.kind !== 'correction' && !corrected.has(e.id)).reduce(reduceWrongReview, initialWrongReview());
  state.corrected = corrected.size;
  return state;
}

export function wrongReviewView(info, now = Date.now(), confirmed = null) {
  const state = confirmed || replayWrongReview(sanitizeWrongReview(info?.review).events);
  const due = !state.mastered && (!state.next_review_at || Date.parse(state.next_review_at) <= now);
  const legacyCorrection=info?.rejudge_result==='correct'&&state.corrected===0?1:0;
  const errors = Math.max(0, (Number(info?.wrong_count) || 0) - state.corrected-legacyCorrection);
  const age = state.last_review_at ? Math.max(0, now - Date.parse(state.last_review_at)) / REVIEW_DAY : 30;
  const recentFailure = state.last_failure_at && now - Date.parse(state.last_failure_at) < REVIEW_DAY;
  const priority = (due ? 100 : 0) + Math.min(20,errors) * 3 + (100-state.score) * .3
    + Math.min(30,age) + (recentFailure ? 30 : 0) + (state.attempts ? state.incorrect / state.attempts * 20 : 0);
  return {...state, due, priority:Math.round(priority * 100) / 100, status:state.mastered ? 'mastered' : due ? 'due' : 'scheduled'};
}

export function orderWrongReview(book, {now=Date.now(), scope='history', recent=[], confirmed=()=>null}={}) {
  const entries = Object.entries(book || {}).map(([key,info]) => ({key, info, state:wrongReviewView(info,now,confirmed(key,info))}));
  const due = entries.filter(e => e.state.due), active = entries.filter(e => !e.state.mastered);
  const source = scope === 'history' && due.length ? due : active.length ? active : entries;
  source.sort((a,b) => (b.state.priority - (recent.at(-1) === b.key ? 200 : recent.includes(b.key) ? 30 : 0))
    - (a.state.priority - (recent.at(-1) === a.key ? 200 : recent.includes(a.key) ? 30 : 0)) || a.key.localeCompare(b.key,'en'));
  return {entries:source, due:due.length, mastered:entries.filter(e => e.state.mastered).length,
    feedback:!entries.length ? 'empty' : !active.length ? 'all_mastered' : !due.length ? 'none_due' : 'due'};
}
