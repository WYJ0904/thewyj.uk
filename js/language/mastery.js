import { getSafeStorage, safeStorageSet } from '../core/storage.js?v=20261010-aeris-task26-r3';
import { emptyLearningStore, parseLearningStore, masteryStorageKey, parseIssuedQuestion, parseMasterySummary, parseAnswerReceipt, enqueueAnswer, acknowledgeAnswer, acceptSummaryCache } from './mastery-state.js?v=20261010-aeris-task26-r3';

const LABELS={new:'尚未学习',learning:'学习中',familiar:'较熟悉',mastered:'已掌握',needs_review:'待复习'};
const REASONS={new:'新知识',weak:'巩固弱项',due:'到期复习',learning:'继续学习',spot:'掌握抽查'};
const time=value=>value?new Date(value).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'尚无安排';
export function createMasteryController({getAccount,getLanguage,features,api,apiGet,document=globalThis.document,storage=getSafeStorage(),locks=globalThis.navigator?.locks}){
 const node=id=>document.getElementById(id),text=(id,value)=>{if(node(id))node(id).textContent=value;};
 let owner='',lang='',signature='',generation=0,identityGeneration=0,store=null,question=null,receipt=null,summary=null,mode='adaptive',busy=false,syncing=false,message='',cached=false,controller=null,round=[];
 const currentOwner=()=>String(getAccount()?.id||''),currentLang=()=>['english','japanese'].includes(getLanguage())?getLanguage():'english';
 const live=ticket=>ticket===generation&&owner===currentOwner()&&lang===currentLang();
 const allowed=()=>features.enabled('mastery_score')&&features.enabled('adaptive_learning');
 function load(accountId){const raw=storage.getItem(masteryStorageKey(accountId));return parseLearningStore(raw===null?null:JSON.parse(raw),accountId);}
 async function persist(change){
  const accountId=owner,identity=identityGeneration,language=lang;
  if(!locks?.request)throw new Error('浏览器不支持安全的多窗口学习同步，请使用普通测验。');
  await locks.request(`aeris-mastery:${accountId}`,()=>{
   if(accountId!==currentOwner()||identity!==identityGeneration||language!==currentLang())throw new Error('账户或语言已切换，答题保留在原账户中。');
   const next=change(load(accountId));
   if(!safeStorageSet(storage,masteryStorageKey(accountId),JSON.stringify(next)))throw new Error('本机存储不可写，不能保证答题恢复；请保留当前答案并恢复存储。');
   store=next;
   render();
  });
 }
 function pointList(target,points){
  const container=node(target);if(!container)return;container.replaceChildren();
  if(!points.length){const p=document.createElement('p');p.className='muted';p.textContent=target==='masteryReviewList'?'目前没有到期复习。':'开始练习后，这里会显示你的知识点。';container.append(p);return;}
  for(const point of points){
   const button=document.createElement('button');button.type='button';button.className='mastery-point';
   const label=document.createElement('span');label.textContent=point.label;
   const state=document.createElement('small');state.textContent=`${LABELS[point.state]} · ${Math.round(point.score)}/100`;
   button.append(label,state);button.addEventListener('click',()=>showPoint(point));container.append(button);
  }
 }
 function showPoint(point){
  const detail=node('masteryDetail');if(!detail)return;detail.replaceChildren();detail.classList.remove('hidden');
  const heading=document.createElement('h4');heading.textContent=point.label;
  const lines=[`${LABELS[point.state]} · 掌握度 ${Math.round(point.score)}/100`,
   `答题 ${point.attempt_count} 次 · 正确 ${point.correct_count} 次 · 连续错误 ${point.consecutive_incorrect} 次`,
   `最近练习：${time(point.last_update_at)}`,`最近复习：${time(point.last_reviewed_at)}`,`下次复习：${time(point.next_review_at)}`];
  detail.append(heading,...lines.map(value=>{const p=document.createElement('p');p.textContent=value;return p;}));
  const mistakes=(summary?.recent_mistakes||[]).filter(m=>m.knowledge_id===point.knowledge_id);
  if(mistakes.length){const p=document.createElement('p');p.textContent=`近期错误 ${mistakes.length} 次，最近一次 ${time(mistakes[0].accepted_at)}。`;detail.append(p);}
  const button=document.createElement('button');button.type='button';button.textContent='练习这个知识点';button.disabled=busy||syncing||!allowed()||globalThis.navigator?.onLine===false;
  button.addEventListener('click',()=>void start('weak',point.knowledge_id));detail.append(button);
 }
 function render(){
  const pending=store?.outbox.filter(e=>e.language===lang)||[],online=globalThis.navigator?.onLine!==false,visible=Boolean(owner&&(allowed()||question&&!online));
  node('masterySection')?.classList.toggle('hidden',!visible);
  if(node('masterySection'))node('masterySection').dataset.language=lang;
  // Keep pending state visible during a temporary flag/network failure, without authorizing new requests.
  if(owner&&pending.length)node('masterySection')?.classList.remove('hidden');
  text('masterySyncStatus',pending.length?`${pending.length} 条答题待同步；当前掌握度尚未计入这些答题。`:
   summary?`${cached?'上次同步缓存':'服务端已同步'} · ${time(summary.observed_at)}${summary.projection_pending?' · 进度正在恢复':''}`:'尚未读取学习进度');
  text('masteryStatus',message||(!online?'当前离线。可完成已经加载的题目，联网后同步；普通测验仍可使用。':!allowed()?'自适应学习暂时关闭，待同步答题已保留。':''));
  text('masteryOverview',summary?`已学习 ${summary.summary.studied_count} 个知识点 · 平均掌握度 ${Math.round(summary.summary.average_mastery)}/100`:'从第一道题开始积累掌握度');
  text('masteryCounts',summary?`已掌握 ${summary.summary.mastered_count} · 学习中 ${summary.summary.learning_count} · 待复习 ${summary.summary.due_count} · 尚未学习 ${summary.summary.new_count}`:'既有测验、错题和历史保留；新的掌握度从有效答题开始。');
  node('masteryReviewArea')?.classList.toggle('hidden',!features.enabled('adaptive_review'));
  for(const id of ['masteryStartBtn','masteryWeakBtn','masteryReviewBtn'])node(id)?.toggleAttribute('disabled',busy||syncing||!online||!allowed()||pending.length>0);
  node('masteryReviewBtn')?.toggleAttribute('disabled',busy||syncing||!online||!allowed()||!features.enabled('adaptive_review')||pending.length>0);
  node('masteryRetryBtn')?.toggleAttribute('disabled',busy||syncing||!online||!allowed());
  node('masteryQuiz')?.classList.toggle('hidden',!question);
  if(question){
   text('masteryPrompt',question.prompt);text('masteryInstruction',question.instruction);text('masteryQuestionReason',REASONS[question.reason]||'巩固练习');
   const queued=pending.some(e=>e.input.ticket_id===question.ticket_id);
   node('masteryAnswerInput')?.toggleAttribute('disabled',Boolean(receipt)||busy||queued||!allowed()&&online);
   node('masterySubmitBtn')?.toggleAttribute('disabled',Boolean(receipt)||busy||queued||!allowed()&&online);
   node('masterySkipBtn')?.toggleAttribute('disabled',Boolean(receipt)||busy||queued||!online||!allowed());
   node('masteryNextBtn')?.toggleAttribute('disabled',busy||syncing||!online||!allowed()||queued);
  }
  node('masteryResult')?.classList.toggle('hidden',!receipt);
  if(receipt){text('masteryResultTitle',receipt.correct?'回答正确':'还需要练习');
   text('masteryDelta',`掌握度 ${Math.round(receipt.score_before)} → ${Math.round(receipt.score_after)}（${receipt.score_delta>=0?'+':''}${Math.round(receipt.score_delta*10)/10}）`);
   text('masteryCorrectAnswer',`课程答案：${receipt.correct_answer}`);text('masteryReviewAt',`下次复习：${time(receipt.mastery.next_review_at)}`);
   const ex=receipt.explanation||{};text('masteryCourseExplanation',`${ex.why||''} ${ex.rule||''}`);text('masteryExample',ex.example?`${ex.example} ${ex.translation||''}`:'');text('masteryConfusion',ex.confusion||'');
   node('masteryAiBtn')?.classList.toggle('hidden',receipt.correct);node('masteryAiBtn')?.toggleAttribute('disabled',busy||!online||!allowed());
  }
  text('masteryRoundSummary',round.length?`本轮 ${round.length} 题 · 正确 ${round.filter(r=>r.correct).length} · 掌握度累计变化 ${round.reduce((n,r)=>n+r.score_delta,0).toFixed(1)}`:'');
  const points=summary?.points||[];pointList('masteryWeakList',[...points].sort((a,b)=>b.review_priority-a.review_priority).slice(0,6));
  pointList('masteryReviewList',points.filter(p=>p.overdue).sort((a,b)=>b.review_priority-a.review_priority).slice(0,10));
 }
 async function refresh(){
  if(!owner||!allowed()||globalThis.navigator?.onLine===false)return;
  const ticket=generation,accountId=owner,language=lang;message='正在读取掌握度…';render();
  try{
   let response=await apiGet(`/api/learning/mastery/summary?language=${language}`,{controller});if(!live(ticket))return;
   if(response.projection_pending){response=await api('/api/learning/mastery/reconcile',{language},{controller});if(!live(ticket))return;}
   const parsed=parseMasterySummary(response,accountId,language);if(!parsed)throw new Error('学习进度响应无效，已保留上次同步数据。');
   await persist(s=>acceptSummaryCache(s,parsed));if(!live(ticket))return;summary=store.cache[language];cached=summary.observed_at!==parsed.observed_at;message=cached?'返回进度较旧，保留已确认的服务端记录。':'';
  }catch(error){if(live(ticket)&&error.name!=='AbortError')message=error.message||'进度暂不可用；普通测验仍可使用。';}
  if(live(ticket))render();
 }
 async function sync(){
  if(syncing||!owner||!allowed()||globalThis.navigator?.onLine===false||!store)return;
  const ticket=generation,accountId=owner;syncing=true;render();
  try{
   store=load(accountId);
   for(const entry of [...store.outbox]){
    if(!live(ticket)||!allowed())return;
    const response=await api('/api/learning/events',entry.input,{controller});if(!live(ticket))return;
    const parsed=parseAnswerReceipt(response,entry.input,accountId,entry.language);if(!parsed)throw new Error('答题响应不完整，事件仍保留为待同步，请重试。');
    await persist(s=>acknowledgeAnswer(s,entry,parsed));if(!live(ticket))return;
    if(entry.language===lang&&entry.input.ticket_id===question?.ticket_id){receipt=parsed;if(!round.some(r=>r.event_id===parsed.event_id))round.push(parsed);}
   }
   message='答题已同步';await refresh();
  }catch(error){if(live(ticket)&&error.name!=='AbortError')message=`${error.message||'同步失败'}；待同步答题已保留。`;}
  finally{if(live(ticket)){syncing=false;busy=false;render();}}
 }
 async function start(nextMode='adaptive',knowledgeId){
  if(busy||syncing||!owner||!allowed()||globalThis.navigator?.onLine===false||store?.outbox.some(e=>e.language===lang))return;
  const ticket=generation;busy=true;mode=nextMode;message='正在选择下一题…';render();
  try{
   const response=await api('/api/learning/adaptive/next',{language:lang,mode,...(knowledgeId?{knowledge_id:knowledgeId}:{})},{controller});if(!live(ticket))return;
   if(!response.question){question=null;receipt=null;message=mode==='review'?'本轮到期复习已完成。稍后再查看下一轮安排。':'暂时没有可用题目，请使用普通测验。';await persist(s=>{delete s.questions[lang];return s;});}
   else{
    const parsed=parseIssuedQuestion(response.question,lang);if(!parsed)throw new Error('题目响应无效，普通测验仍可使用。');
    await persist(s=>{s.questions[lang]={question:parsed,started_at:Date.now(),mode};delete s.results[lang];return s;});if(!live(ticket))return;
    question=parsed;receipt=null;message='';node('masteryAnswerInput').value='';text('masteryAiExplanation','');
   }
  }catch(error){if(live(ticket)&&error.name!=='AbortError')message=error.message||'出题暂不可用。';}
  finally{if(live(ticket)){busy=false;render();if(question&&!receipt)node('masteryAnswerInput')?.focus({preventScroll:true});}}
 }
 async function submit(event){
  event?.preventDefault();if(busy||receipt||!question||!owner||!store)return;
  const answer=node('masteryAnswerInput')?.value.trim();if(!answer){message='请先填写答案。';render();return;}
  const ticket=generation;busy=true;
  try{
   const started=store.questions[lang]?.started_at||Date.now(),entry={language:lang,input:{event_id:crypto.randomUUID(),ticket_id:question.ticket_id,kind:'answer_submitted',answer,response_ms:Math.min(600000,Math.max(0,Math.round(Date.now()-started)))}};
   await persist(s=>enqueueAnswer(s,entry));if(!live(ticket))return;message='答题已保存，等待服务端判断。';busy=false;render();await sync();
  }catch(error){if(live(ticket))message=error.message;}
  finally{if(live(ticket)){busy=false;render();}}
 }
 async function skip(){
  if(busy||!question||!allowed())return;const ticket=generation;busy=true;render();
  try{
   await persist(s=>{s.questions[lang].skip_event_id ||= crypto.randomUUID();return s;});if(!live(ticket))return;
   await api('/api/learning/events',{event_id:store.questions[lang].skip_event_id,ticket_id:question.ticket_id,kind:'skipped'},{controller});if(live(ticket)){busy=false;await start(mode);}
  }
  catch(error){if(live(ticket))message=error.message;}finally{if(live(ticket)){busy=false;render();}}
 }
 async function explain(){
  if(busy||!receipt||!allowed())return;const ticket=generation;busy=true;text('masteryAiExplanation','正在读取解析…');render();
  try{
   const eventId=receipt.event_id;const response=await api('/api/learning/explanation',{event_id:eventId},{controller});if(!live(ticket))return;
   if(response.event_id!==eventId||response.correct!==receipt.correct)throw new Error('解析响应与答题不一致。');
   const ai=response.ai;
   if(ai&&['why','rule','example','contrast'].every(k=>typeof ai[k]==='string'&&ai[k].length<=800))text('masteryAiExplanation',`AI 辅助解析：${ai.why} ${ai.rule} ${ai.example} ${ai.contrast}`);
   else text('masteryAiExplanation',`课程解析：${response.explanation?.why||receipt.explanation?.why||''} AI 暂不可用时仍可继续学习。`);
   void api('/api/learning/events',{event_id:crypto.randomUUID(),ticket_id:question.ticket_id,kind:'explanation_opened'},{controller}).catch(()=>{});
  }catch(error){if(live(ticket))text('masteryAiExplanation',`${error.message||'解析暂不可用'}；课程答案和掌握度保持不变。`);}
  finally{if(live(ticket)){busy=false;render();}}
 }
 function update(force=false){
  const nextOwner=currentOwner(),nextLang=currentLang(),nextSignature=`${nextOwner}:${nextLang}:${allowed()}:${features.enabled('adaptive_review')}:${features.channel()}`;
  if(!force&&signature===nextSignature)return;signature=nextSignature;generation++;controller?.abort();controller=new AbortController();busy=false;syncing=false;
  const switched=nextOwner!==owner||nextLang!==lang;owner=nextOwner;lang=nextLang;
  if(switched){identityGeneration++;round=[];question=null;receipt=null;summary=null;node('masteryDetail')?.classList.add('hidden');text('masteryAiExplanation','');if(node('masteryAnswerInput'))node('masteryAnswerInput').value='';}
  message='';store=null;
  if(owner){try{store=load(owner);question=store.questions[lang]?.question||null;mode=store.questions[lang]?.mode||'adaptive';
   const saved=store.results[lang];receipt=saved?.ticket_id===question?.ticket_id?parseAnswerReceipt(saved.receipt,saved.input,owner,lang):null;
   summary=store.cache[lang]||null;cached=Boolean(summary);}catch(error){message=error.message;}}
  render();if(owner&&allowed()&&store){if(store.outbox.length)void sync();else void refresh();}
 }
 node('masteryStartBtn')?.addEventListener('click',()=>void start());node('masteryWeakBtn')?.addEventListener('click',()=>void start('weak'));
 node('masteryReviewBtn')?.addEventListener('click',()=>void start('review'));node('masteryNextBtn')?.addEventListener('click',()=>void start(mode));
 node('masteryAnswerForm')?.addEventListener('submit',event=>void submit(event));node('masterySkipBtn')?.addEventListener('click',()=>void skip());
 node('masteryAiBtn')?.addEventListener('click',()=>void explain());node('masteryRetryBtn')?.addEventListener('click',()=>{void sync();if(!store?.outbox.length)void refresh();});
 globalThis.addEventListener?.('online',()=>update(true));globalThis.addEventListener?.('offline',()=>{message='当前离线，掌握度尚未同步。';render();});
 globalThis.addEventListener?.('storage',event=>{
  if(!owner||event.key!==masteryStorageKey(owner))return;
  try{
   const incoming=load(owner),nextQuestion=incoming.questions[lang]?.question||null,saved=incoming.results[lang];
   const nextReceipt=saved?.ticket_id===nextQuestion?.ticket_id?parseAnswerReceipt(saved.receipt,saved.input,owner,lang):null;
   const ticketChanged=question?.ticket_id!==nextQuestion?.ticket_id;
   if(ticketChanged||receipt?.event_id!==nextReceipt?.event_id){
    generation++;controller?.abort();controller=new AbortController();busy=false;syncing=false;
    if(ticketChanged){if(node('masteryAnswerInput'))node('masteryAnswerInput').value='';text('masteryAiExplanation','');}
    question=nextQuestion;receipt=nextReceipt;mode=incoming.questions[lang]?.mode||'adaptive';message='学习进度已由其他窗口更新。';
   }
   store=incoming;summary=store.cache[lang]||summary;cached=Boolean(summary);render();
   // Hydrate without fetching/persisting: reciprocal storage events must not
   // create a cross-window refresh/write loop or submit the ticket again.
  }catch(error){message=error.message;render();}
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)update(true);});
 render();
 return Object.freeze({update,refresh,sync});
}
