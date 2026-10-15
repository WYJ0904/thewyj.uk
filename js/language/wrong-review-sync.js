import { WRONG_REVIEW_ALGORITHM, initialWrongReview } from './wrong-review.js?v=20261015-aeris-wrong-review-v1';

export const WRONG_REVIEW_DB = 'aeris-wrong-review-outbox-v1';
export function createWrongReviewJournal(indexedDB=globalThis.indexedDB) {
  let opened;
  async function database(){
    if(!indexedDB)throw new Error('本机无法可靠保存复习记录，请恢复浏览器存储后重试。');
    if(!opened)opened=new Promise((resolve,reject)=>{
      const request=indexedDB.open(WRONG_REVIEW_DB,1);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('events',{keyPath:['account_id','event_id']});store.createIndex('account','account_id');};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opened=null;};resolve(request.result);};
      request.onerror=request.onblocked=()=>{opened=null;reject(new Error('复习记录存储不可用，现有记录已保留。'));};
    });
    return opened;
  }
  async function transaction(mode,action){
    const db=await database();
    return new Promise((resolve,reject)=>{
      let result;
      const tx=db.transaction('events',mode,mode==='readwrite'?{durability:'strict'}:{});
      const request=action(tx.objectStore('events'));
      if(request)request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);
      tx.onabort=tx.onerror=()=>reject(new Error('复习记录未完成持久保存，请重试。'));
    });
  }
  return Object.freeze({
    put:row=>transaction('readwrite',store=>store.put(structuredClone(row))),
    list:account=>transaction('readonly',store=>store.index('account').getAll(account)),
    clear:account=>transaction('readwrite',store=>{const request=store.index('account').openKeyCursor(account);request.onsuccess=()=>{if(request.result){store.delete(request.result.primaryKey);request.result.continue();}};}),
  });
}

export function parseWrongReviewState(state){
  if(!state || state.version!==1 || state.algorithm!==WRONG_REVIEW_ALGORITHM
    || !['attempts','correct','incorrect','effective','streak','corrected'].every(key=>Number.isSafeInteger(state[key])&&state[key]>=0)
    || state.correct+state.incorrect!==state.attempts || state.effective>state.correct || state.streak>5
    || !Number.isFinite(state.score) || state.score<0 || state.score>100 || typeof state.mastered!=='boolean'
    || !Array.isArray(state.days) || state.days.length>14 || !state.days.every(day=>/^\d{4}-\d{2}-\d{2}$/.test(day))
    || !['last_effective_at','last_review_at','next_review_at','last_failure_at'].every(key=>state[key]===null||Number.isFinite(Date.parse(state[key]))))return null;
  if(state.mastered&&(state.streak<5||new Set(state.days).size<5||state.score<100))return null;
  return structuredClone(state);
}

export function parseWrongReviewReceipt(value,input,owner){
  if(!value||!input)return null;
  if(value?.account_id!==owner||value.event_id!==input.event_id||value.attempt_id!==input.attempt_id
    ||value.source_digest!==input.source_digest
    ||value.review_id!==input.review_id||value.profile!==input.profile||value.language!==input.language
    ||value.acknowledged!==true||typeof value.correct!=='boolean'||!Number.isSafeInteger(value.event_seq)||value.event_seq<1
    ||!Number.isSafeInteger(value.last_event_seq)||value.last_event_seq<value.event_seq||!Number.isFinite(Date.parse(value.accepted_at))
    ||!parseWrongReviewState(value.state))return null;
  return structuredClone(value);
}

export function createWrongReviewController({api,apiGet,getContext,features,beforeSync=async()=>{},onChange=()=>{},
  journal=createWrongReviewJournal(),locks=globalThis.navigator?.locks}){
  let generation=0,signature='',controller=null,syncing=false,cache=new Map(),pendingIds=new Set(),pending=0,message='',onlineConfirmed=false;
  const context=()=>getContext();
  const live=(ticket,owner)=>ticket===generation&&String(context().account_id||'')===owner;
  const allowed=()=>{
    const current=context(),effective=new Set(current.entitlements||[]);
    return Boolean(current.account_id&&['english','japanese'].includes(current.language)
      &&['all_features_access','language_all_access',`language_${current.language}_access`].some(key=>effective.has(key))
      &&['adaptive_learning','mastery_score','adaptive_review'].every(key=>features.enabled(key)));
  };
  const online=()=>globalThis.navigator?.onLine!==false;
  const changed=()=>onChange();
  function confirmed(key,info){
    const item=cache.get(info.review_id);
    if((info.review?.events||[]).some(event=>pendingIds.has(event.id)))return null;
    // New offline errors invalidate an older confirmed projection.
    const last=info.review?.events?.at(-1);
    if(last && last.correct===false && Date.parse(last.at)>Date.parse(item?.state.last_review_at||''))return null;
    return item?.state||null;
  }
  async function refresh(scope=context().scope||'history'){
    const current=context(),owner=String(current.account_id||''),ticket=generation;
    if(!owner||!allowed()||!online())return;
    try{
      const response=await apiGet(`/api/learning/wrong-review?${new URLSearchParams({language:current.language,profile:current.profile,scope})}`,{controller});
      if(!live(ticket,owner))return;
      if(response.account_id!==owner||response.profile!==current.profile||response.language!==current.language||response.scope!==scope
        ||response.algorithm!==WRONG_REVIEW_ALGORITHM||!Array.isArray(response.states)||response.states.length>250)throw new Error('复习进度响应无效');
      for(const item of response.states){
        const state=parseWrongReviewState(item.state);
        if(!state||typeof item.review_id!=='string'||!Number.isSafeInteger(item.last_event_seq))throw new Error('复习进度响应无效');
        if((cache.get(item.review_id)?.last_event_seq||0)<=item.last_event_seq)cache.set(item.review_id,{state,last_event_seq:item.last_event_seq});
      }
      onlineConfirmed=true;message='';
    }catch(error){if(live(ticket,owner)){onlineConfirmed=false;message='服务端暂不可用，使用已保存错题本地复习；本地进度尚未确认。';}}
    if(live(ticket,owner))changed();
  }
  async function sync(){
    const current=context(),owner=String(current.account_id||''),ticket=generation;
    if(syncing||!owner||!allowed()||!online())return;
    syncing=true;
    try{
      // Cross-device record/tombstone synchronization precedes event acceptance.
      await beforeSync();if(!live(ticket,owner))return;
      const work=async()=>{
        const rows=(await journal.list(owner)).filter(row=>!parseWrongReviewReceipt(row.receipt,row.input,owner)&&!row.cancelled).sort((a,b)=>a.created_at-b.created_at||a.event_id.localeCompare(b.event_id));
        pending=rows.length;pendingIds=new Set(rows.map(row=>row.event_id));changed();
        for(const row of rows){
          if(!live(ticket,owner)||!allowed()||!online())return;
          try{
            const response=await api('/api/learning/wrong-review',row.input,{controller});if(!live(ticket,owner))return;
            const parsed=parseWrongReviewReceipt(response,row.input,owner);
            if(!parsed)throw new Error('复习确认响应无效，原记录已保留');
            const state=parsed.state;
            await journal.put({...row,receipt:response});if(!live(ticket,owner))return;
            if(row.input.profile===current.profile&&row.input.language===current.language){
              if((cache.get(row.input.review_id)?.last_event_seq||0)<=response.last_event_seq)cache.set(row.input.review_id,{state,last_event_seq:response.last_event_seq});
            }
            pending--;pendingIds.delete(row.event_id);onlineConfirmed=true;
          }catch(error){
            if(!live(ticket,owner))return;
            if(error.code==='wrong_review_source_deleted'||error.code==='wrong_review_source_changed'){
              // Keep an audit copy. Never recreate a deleted or replaced item.
              await journal.put({...row,cancelled:true});pending--;pendingIds.delete(row.event_id);continue;
            }
            message=`${error.message||'复习同步失败'}；待确认记录已保存，本地复习可继续。`;onlineConfirmed=false;break;
          }
        }
      };
      if(locks?.request)await locks.request(`aeris-wrong-review:${owner}`,work);else await work();
    }catch(error){if(live(ticket,owner)){message=`${error.message||'同步失败'}；本地复习可继续。`;onlineConfirmed=false;}}
    finally{if(live(ticket,owner)){syncing=false;changed();}}
  }
  async function enqueue(input,accountId,source=null){
    const existing=(await journal.list(accountId)).find(row=>row.event_id===input.event_id);
    if(!existing)await journal.put({account_id:accountId,event_id:input.event_id,created_at:Date.now(),input:structuredClone(input),source:structuredClone(source)});
    if(String(context().account_id||'')===accountId){pending++;pendingIds.add(input.event_id);onlineConfirmed=false;changed();}
  }
  async function update(){
    const current=context(),owner=String(current.account_id||'');
    const next=`${owner}:${current.profile}:${current.language}:${allowed()}`;
    if(signature===next)return;
    signature=next;generation++;controller?.abort();controller=new AbortController();cache=new Map();pendingIds=new Set();pending=0;message='';syncing=false;onlineConfirmed=false;
    if(!owner){changed();return;}
    const ticket=generation;
    try{
      const rows=await journal.list(owner);if(!live(ticket,owner))return;
      pending=rows.filter(row=>!parseWrongReviewReceipt(row.receipt,row.input,owner)&&!row.cancelled).length;
      pendingIds=new Set(rows.filter(row=>!parseWrongReviewReceipt(row.receipt,row.input,owner)&&!row.cancelled).map(row=>row.event_id));
      for(const row of rows.filter(row=>row.receipt&&row.input.profile===current.profile&&row.input.language===current.language)){
        const state=parseWrongReviewReceipt(row.receipt,row.input,owner)?.state;
        if(state&&(cache.get(row.input.review_id)?.last_event_seq||0)<=row.receipt.last_event_seq)cache.set(row.input.review_id,{state,last_event_seq:row.receipt.last_event_seq});
      }
      changed();if(allowed()){await sync();if(live(ticket,owner))await refresh();}
    }catch(error){if(live(ticket,owner)){message=error.message;changed();}}
  }
  function status(){return message||(pending?`${pending} 条复习待服务端确认，已保存在本机。`:!allowed()?'按原有错题规则复习；智能排序暂未开放。':onlineConfirmed&&online()?'服务端连接正常；未确认的复习状态标为本地。':'本地复习可用；掌握度尚未完成服务端确认。');}
  globalThis.addEventListener?.('online',()=>{void sync();void refresh();});
  globalThis.addEventListener?.('offline',()=>{onlineConfirmed=false;changed();});
  return Object.freeze({update,enqueue,sync,refresh,confirmed,status,allowed,
    clearAccount:account=>journal.clear(account),initial:initialWrongReview});
}
