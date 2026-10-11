import assert from 'node:assert/strict';
import {createMasteryController} from '../../js/language/mastery.js';
import {emptyLearningStore,masteryStorageKey} from '../../js/language/mastery-state.js';
const account='durability-fixture',lang='english',pause=()=>new Promise(r=>setTimeout(r,5));
const question={ticket_id:crypto.randomUUID(),language:lang,kind:'spelling',prompt:'水',instruction:'写出英语单词',knowledge_label:'英语词汇',reason:'new',expires_at:new Date(Date.now()+86400000).toISOString()};
const entry={language:lang,input:{event_id:crypto.randomUUID(),ticket_id:question.ticket_id,kind:'answer_submitted',answer:'water',response_ms:1200}};
function fixture(journal,{withQuestion=true,api=async()=>new Promise(()=>{})}={}){
 const values=new Map(),s=emptyLearningStore(account);if(withQuestion)s.questions[lang]={question,started_at:Date.now(),mode:'adaptive'};values.set(masteryStorageKey(account),JSON.stringify(s));
 const handlers=new Map(),nodes=new Map();
 for(const id of ['masteryAnswerForm','masteryAnswerInput','masteryStatus'])nodes.set(id,{value:'water',textContent:'',dataset:{},classList:{toggle(){},add(){}},toggleAttribute(){},addEventListener:(type,fn)=>handlers.set(id+':'+type,fn)});
 const controller=createMasteryController({getAccount:()=>({id:account}),getLanguage:()=>lang,features:{enabled:()=>true,channel:()=> 'experimental'},journal,storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},locks:{request:async(_key,fn)=>fn()},document:{getElementById:id=>nodes.get(id)||null,addEventListener(){}},api,apiGet:()=>new Promise(()=>{})});
 controller.update();return {controller,values,handlers,nodes};
}
let submitted=0,released;
const commit=new Promise(r=>{released=r;});
const a=fixture({list:async()=>[],put:()=>commit,remove:async()=>{}},{api:()=>{submitted++;return new Promise(()=>{});}});await pause();
a.nodes.get('masteryAnswerInput').value='water';a.handlers.get('masteryAnswerForm:submit')({preventDefault(){}});await pause();assert.equal(submitted,0);assert.equal(JSON.parse(a.values.get(masteryStorageKey(account))).outbox.length,0,'UI cache must not claim durable save before commit');released();await pause();assert.equal(submitted,1);
console.log('PASS: durable commit precedes cached queue and any server submission');
let deniedCalls=0;
const b=fixture({list:async()=>[],put:async()=>{throw new Error('durable commit denied');},remove:async()=>{}},{api:()=>{deniedCalls++;}});await pause();b.nodes.get('masteryAnswerInput').value='water';b.handlers.get('masteryAnswerForm:submit')({preventDefault(){}});await pause();assert.equal(deniedCalls,0);assert.equal(JSON.parse(b.values.get(masteryStorageKey(account))).outbox.length,0);assert.equal(b.nodes.get('masteryAnswerInput').value,'water');assert.match(b.nodes.get('masteryStatus').textContent,/durable commit denied/);
console.log('PASS: journal failure keeps the input and prevents false saved status or writes');
let recoveredInput;
const c=fixture({list:async()=>[{account_id:account,event_id:entry.input.event_id,entry,question}],put:async()=>{},remove:async()=>{}},{withQuestion:false,api:async(_route,input)=>{recoveredInput=input;return new Promise(()=>{});}});await pause();assert.equal(recoveredInput.event_id,entry.input.event_id);assert.equal(recoveredInput.ticket_id,question.ticket_id);assert.equal(JSON.parse(c.values.get(masteryStorageKey(account))).outbox[0].input.event_id,entry.input.event_id);
console.log('PASS: journal restores the original pending ID when the UI cache lost it');
console.log('Task26 durable outbox: 3 controller groups passed; physical storage is verified separately on Samsung.');
