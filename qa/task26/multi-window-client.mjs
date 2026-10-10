import assert from 'node:assert/strict';
import {createMasteryController} from '../../js/language/mastery.js';
import {emptyLearningStore,masteryStorageKey} from '../../js/language/mastery-state.js';

const accountId='multi-window-fixture',language='english',handlers=new Map(),values=new Map();
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const element=()=>({value:'',textContent:'',dataset:{},disabled:false,
 classList:{names:new Set(),toggle(name,force){force?this.names.add(name):this.names.delete(name);},add(name){this.names.add(name);},contains(name){return this.names.has(name);}},
 toggleAttribute(name,force){if(name==='disabled')this.disabled=force;},addEventListener(){},focus(){}});
const nodes=Object.fromEntries(['masterySection','masteryAnswerInput','masterySubmitBtn','masteryResult','masteryPrompt','masteryStatus','masteryAiExplanation'].map(name=>[name,element()]));
const document={hidden:false,getElementById:id=>nodes[id]||null,addEventListener(){}};
const question={ticket_id:crypto.randomUUID(),language,kind:'spelling',prompt:'水',instruction:'写出英语单词',knowledge_label:'英语词汇',reason:'new',expires_at:new Date(Date.now()+86400000).toISOString()};
const input={event_id:crypto.randomUUID(),ticket_id:question.ticket_id,kind:'answer_submitted',answer:'water',response_ms:1200};
const receipt={event_id:input.event_id,account_id:accountId,language,acknowledged:true,algorithm_version:'mastery-v1',event_seq:1,correct:true,score_before:0,score_after:5,score_delta:5,
 mastery:{score:5,last_event_seq:1},correct_answer:'water',knowledge:{label:'water'},explanation:{why:'课程答案water'}};
const initial=emptyLearningStore(accountId);initial.questions.english={question,started_at:Date.now(),mode:'adaptive'};
storage.setItem(masteryStorageKey(accountId),JSON.stringify(initial));
const originalListener=globalThis.addEventListener;let requests=0;
globalThis.addEventListener=(kind,callback)=>handlers.set(kind,callback);
try{
 const controller=createMasteryController({getAccount:()=>({id:accountId}),getLanguage:()=>language,features:{enabled:()=>true,channel:()=> 'experimental'},storage,locks:{request:async(_key,fn)=>fn()},document,
  api:async()=>{throw new Error('Storage notifications must not submit another answer');},apiGet:()=>{requests++;return new Promise(()=>{});}});
 controller.update();assert.equal(nodes.masterySubmitBtn.disabled,false);nodes.masteryAnswerInput.value='unfinished draft';
 const acknowledged=structuredClone(initial);acknowledged.results.english={ticket_id:question.ticket_id,input,receipt};
 storage.setItem(masteryStorageKey(accountId),JSON.stringify(acknowledged));handlers.get('storage')({key:masteryStorageKey(accountId)});
 assert.equal(nodes.masteryResult.classList.contains('hidden'),false,'Another window acknowledgement must hydrate the receipt');
 assert.equal(nodes.masteryAnswerInput.disabled,true,'An already answered ticket cannot become answerable again');
 assert.equal(nodes.masterySubmitBtn.disabled,true);
 console.log('PASS: another-window acknowledgement locks the completed ticket and shows its original receipt');
 const next=structuredClone(acknowledged);next.questions.english={question:{...question,ticket_id:crypto.randomUUID(),prompt:'书'},started_at:Date.now(),mode:'adaptive'};
 storage.setItem(masteryStorageKey(accountId),JSON.stringify(next));handlers.get('storage')({key:masteryStorageKey(accountId)});
 assert.equal(nodes.masteryPrompt.textContent,'书');assert.equal(nodes.masteryAnswerInput.value,'','A different ticket must not inherit an old draft');
 assert.equal(nodes.masteryResult.classList.contains('hidden'),true);assert.equal(nodes.masterySubmitBtn.disabled,false);
 handlers.get('storage')({key:masteryStorageKey('different-account')});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(requests,1,'Storage notifications must not cause cross-window refresh/write loops');
 console.log('PASS: another-window next ticket clears stale drafts without refetch loops or cross-account effects');
 console.log('Task26 multi-window: 2 acceptance groups passed');
}finally{if(originalListener===undefined)delete globalThis.addEventListener;else globalThis.addEventListener=originalListener;}
