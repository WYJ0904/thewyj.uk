// Retirement adapter for previously issued tickets; no new course questions or UI.
import { getSafeStorage, safeStorageSet } from '../core/storage.js?v=20261031-aeris-task26-p0';
import { parseLearningStore, masteryStorageKey, parseAnswerReceipt, enqueueAnswer, acknowledgeAnswer } from './mastery-state.js?v=20261031-aeris-task26-p0';
import { createMasteryJournal } from './mastery-journal.js?v=20261031-aeris-task26-p0';

export function createMasteryController({getAccount,getLanguage,api,onChange=()=>{},storage=getSafeStorage(),
  locks=globalThis.navigator?.locks,journal=createMasteryJournal()}) {
  let owner='',language='',generation=0,store=null,signature='',message='',syncing=false,controller=null;
  const currentOwner=()=>String(getAccount()?.id||'');
  const live=ticket=>ticket===generation&&owner===currentOwner()&&language===getLanguage();
  const load=account=>parseLearningStore(JSON.parse(storage.getItem(masteryStorageKey(account))||'null'),account);
  function archive(value,entry,question,closed=false){
    if(value.conflicts!==undefined&&!Array.isArray(value.conflicts))throw new Error('旧恢复记录格式不兼容，原数据已保留，请先备份。');
    value.conflicts ||= [];
    if(!value.conflicts.some(row=>row?.entry?.input?.event_id===entry.input.event_id))value.conflicts.push({entry:structuredClone(entry),question:structuredClone(question),closed});
    value.outbox=value.outbox.filter(row=>row.input.event_id!==entry.input.event_id);
    if(closed&&(value.results[entry.language]?.ticket_id!==entry.input.ticket_id||!value.results[entry.language]?.receipt))value.results[entry.language]={ticket_id:entry.input.ticket_id,input:entry.input,recovery_closed:true};
    return value;
  }
  async function persist(change){
    const account=owner,ticket=generation;
    const work=()=>{
      if(!live(ticket))throw new Error('账户或语言已切换，旧答题仍保留在原账户。');
      const next=change(load(account));
      if(!safeStorageSet(storage,masteryStorageKey(account),JSON.stringify(next)))throw new Error('旧答题尚未完成保存，原记录已保留。');
      store=next;
    };
    if(!locks?.request)throw new Error('浏览器缺少安全恢复能力，旧记录已保留。');
    await locks.request('aeris-mastery:'+account,work);onChange();
  }
  async function sync(){
    if(syncing||!owner||!store||globalThis.navigator?.onLine===false)return;
    const ticket=generation,account=owner;syncing=true;
    try{
      const durable=await journal.list(account);if(!live(ticket))return;
      store=load(account);
      for(const entry of [...store.outbox]){
        const question=durable.find(row=>row.event_id===entry.input.event_id)?.question||store.questions[entry.language]?.question;
        await journal.put(account,entry,question);if(!live(ticket))return;
        let response;
        try{response=await api('/api/learning/legacy/events',entry.input,{controller});}
        catch(error){if(error.code!=='learning_ticket_already_answered')throw error;
          await persist(value=>archive(value,entry,question,true));if(!live(ticket))return;
          await journal.remove(account,entry.input.event_id);continue;
        }
        if(!live(ticket))return;
        const parsed=parseAnswerReceipt(response,entry.input,account,entry.language);
        if(!parsed)throw new Error('旧答题确认响应无效');
        await persist(value=>acknowledgeAnswer(value,entry,parsed));if(!live(ticket))return;
        await journal.remove(account,entry.input.event_id);if(!live(ticket))return;
      }
      message='';
    }catch(error){if(live(ticket))message=(error.message||'旧答题同步失败')+'；旧记录已保存，可稍后恢复。';}
    finally{if(live(ticket)){syncing=false;onChange();}}
  }
  async function update(){
    const nextOwner=currentOwner(),nextLanguage=getLanguage(),next=JSON.stringify([nextOwner,nextLanguage]);
    if(next===signature)return;
    signature=next;generation++;controller?.abort();controller=new AbortController();owner=nextOwner;language=nextLanguage;store=null;syncing=false;message='';
    if(!owner){onChange();return;}
    const ticket=generation;
    try{
      store=load(owner);
      const rows=await journal.list(owner);if(!live(ticket))return;
      if(rows.length)await persist(value=>{
        for(const row of rows){
          if(value.results[row.entry.language]?.receipt?.event_id===row.event_id)continue;
          const saved=value.results[row.entry.language];
          const completed=saved?.ticket_id===row.entry.input.ticket_id&&parseAnswerReceipt(saved.receipt,saved.input,owner,row.entry.language);
          const duplicate=value.outbox.some(event=>event.input.ticket_id===row.entry.input.ticket_id&&event.input.event_id!==row.event_id);
          if(completed||duplicate){archive(value,row.entry,row.question,Boolean(completed));continue;}
          if(!value.outbox.some(event=>event.input.event_id===row.event_id))value=enqueueAnswer(value,row.entry);
          value.questions[row.entry.language] ||= {question:row.question,started_at:Date.now(),mode:'adaptive'};
        }
        return value;
      });
      if(live(ticket))await sync();
    }catch(error){if(live(ticket))message=error.message;}
    if(live(ticket))onChange();
  }
  function pendingQuestion(){
    if(owner!==currentOwner()||language!==getLanguage())return null;
    const saved=store?.questions[language];
    return saved&&!saved.completed ? saved.question : null;
  }
  function resultFor(question){
    const saved=store?.results[question?.language];
    if(saved?.ticket_id===question?.ticket_id&&saved.recovery_closed)return {correct:false,recovery_notice:'这道旧题已在其他窗口完成；当前草稿已保存在本机恢复备份中。',correct_answer:''};
    const receipt=saved?.ticket_id===question?.ticket_id ? parseAnswerReceipt(saved.receipt,saved.input,owner,question.language) : null;
    return receipt&&(store.conflicts||[]).some(row=>row?.entry?.input?.ticket_id===question.ticket_id)
      ?{...receipt,recovery_notice:'旧题已有确认结果；另一份草稿已保存在本机恢复备份中。'}:receipt;
  }
  async function submit(question,answer){
    if(question.ticket_id!==pendingQuestion()?.ticket_id)throw new Error('旧题已由其他窗口更新，请重新恢复。');
    const saved=resultFor(question);if(saved)return saved;
    let entry=store.outbox.find(event=>event.input.ticket_id===question.ticket_id);
    if(!entry){
      entry={language:question.language,input:{event_id:crypto.randomUUID(),ticket_id:question.ticket_id,kind:'answer_submitted',answer,
        response_ms:Math.min(600000,Math.max(0,Date.now()-(store.questions[language]?.started_at||Date.now())))}};
      await journal.put(owner,entry,question);
      await persist(value=>enqueueAnswer(value,entry));
    }
    await sync();const receipt=resultFor(question);
    if(!receipt)throw new Error(message||'旧答题已可靠保存，联网确认后可继续。');
    return receipt;
  }
  async function complete(question){await persist(value=>{if(value.questions[question.language]?.question.ticket_id===question.ticket_id)value.questions[question.language].completed=true;return value;});}
  function status(){return message||(store?.outbox.length?store.outbox.length+' 条旧答题待确认，原记录已保留。':pendingQuestion()?'有一题旧版练习可恢复。':store?.conflicts?.length?'旧题冲突草稿已保留；可随错题数据一起导出备份。':'');}
  globalThis.addEventListener?.('online',()=>void sync());
  globalThis.addEventListener?.('storage',event=>{if(owner&&event.key===masteryStorageKey(owner)){try{store=load(owner);onChange();}catch(error){message=error.message;onChange();}}});
  function backup(){if(!store||owner!==currentOwner()||language!==getLanguage()||store.conflicts!==undefined&&!Array.isArray(store.conflicts))return null;return {schema_version:1,account_id:owner,language,
    outbox:store.outbox.filter(entry=>entry.language===language),questions:{[language]:store.questions[language]||null},
    results:{[language]:store.results[language]||null},conflicts:(store.conflicts||[]).filter(row=>row?.entry?.language===language)};}
  return Object.freeze({update,sync,refresh:sync,pendingQuestion,resultFor,submit,complete,status,backup});
}
