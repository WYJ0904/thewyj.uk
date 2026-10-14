import {emptyLearningStore,parseLearningStore,parseIssuedQuestion,enqueueAnswer} from './mastery-state.js?v=20261014-aeris-task26-r9';

export const MASTERY_JOURNAL_DB='aeris-mastery-outbox-v1';
export function createMasteryJournal(indexedDB=globalThis.indexedDB){
 let opened;
 function open(){
  if(!indexedDB)throw new Error('浏览器缺少可靠答题存储，请使用普通测验。');
  if(!opened)opened=new Promise((resolve,reject)=>{
   const request=indexedDB.open(MASTERY_JOURNAL_DB,1);
   request.onupgradeneeded=()=>{const store=request.result.createObjectStore('events',{keyPath:['account_id','event_id']});store.createIndex('account','account_id');};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
   request.onerror=request.onblocked=()=>{opened=null;reject(new Error('可靠答题存储不可用，原记录已保留。'));};
  });
  return opened;
 }
 function owner(id){if(typeof id!=='string'||!id||id.length>128)throw new Error('答题存储账户无效。');}
 async function transaction(mode,action){
  const db=await open();
  return new Promise((resolve,reject)=>{
   let tx,result;
   try{
    tx=db.transaction('events',mode,mode==='readwrite'?{durability:'strict'}:{});
    if(mode==='readwrite'&&tx.durability!=='strict'){tx.abort();throw new Error('浏览器不能可靠保存答题，请使用普通测验。');}
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(new Error('答题持久保存未完成，原记录已保留。'));
    const request=action(tx.objectStore('events'));
    if(request)request.onsuccess=()=>{result=request.result;};
   }catch(error){reject(error);}
  });
 }
 return Object.freeze({
  async put(accountId,entry,question){
   owner(accountId);parseLearningStore(enqueueAnswer(emptyLearningStore(accountId),entry),accountId);
   const parsed=parseIssuedQuestion(question,entry.language);
   if(!parsed||parsed.ticket_id!==entry.input.ticket_id)throw new Error('答题记录与题目不一致，不能保存。');
   await transaction('readwrite',store=>store.put({account_id:accountId,event_id:entry.input.event_id,entry:structuredClone(entry),question:parsed}));
  },
  async list(accountId){owner(accountId);const rows=await transaction('readonly',store=>store.index('account').getAll(accountId));
   for(const row of rows){if(row.account_id!==accountId||row.event_id!==row.entry?.input?.event_id)throw new Error('答题存储账户不一致，原记录已保留。');parseLearningStore(enqueueAnswer(emptyLearningStore(accountId),row.entry),accountId);if(!parseIssuedQuestion(row.question,row.entry.language)||row.question.ticket_id!==row.entry.input.ticket_id)throw new Error('已保存的答题题目无效，原记录已保留。');}
   return rows;
  },
  async remove(accountId,eventId){owner(accountId);await transaction('readwrite',store=>store.delete([accountId,eventId]));},
  async clear(accountId){owner(accountId);await transaction('readwrite',store=>{const cursor=store.index('account').openKeyCursor(accountId);cursor.onsuccess=()=>{if(cursor.result){store.delete(cursor.result.primaryKey);cursor.result.continue();}};});},
 });
}
export async function clearMasteryJournalAccount(accountId){if(globalThis.indexedDB&&accountId)await createMasteryJournal().clear(accountId);}
