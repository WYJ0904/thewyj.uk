import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {emptyLearningStore,masteryStorageKey} from '../../js/language/mastery-state.js';

const app=readFileSync(new URL('../../app.js',import.meta.url),'utf8');
const start=app.indexOf('function clearAccountLocalData('),end=app.indexOf('\nfunction saveCurrentWordDraft(',start);
assert.ok(start>=0&&end>start,'The actual account deletion cleanup must be exercised');
const account={id:crypto.randomUUID()},other={id:crypto.randomUUID()};
const originalOther=JSON.stringify(emptyLearningStore(other.id));
const own=emptyLearningStore(account.id);own.outbox=[{language:'english',input:{event_id:crypto.randomUUID(),ticket_id:crypto.randomUUID(),kind:'answer_submitted',answer:'synthetic-private-answer',response_ms:1200}}];
const values=new Map([[masteryStorageKey(account.id),JSON.stringify(own)],[masteryStorageKey(other.id),originalOther],['unrelated-fixture','retain']]);
const storage={get length(){return values.size;},key:index=>[...values.keys()][index],removeItem:key=>values.delete(key)};
const context=vm.createContext({state:{account},localStorage:storage,sessionStorage:{removeItem(){}},masteryStorageKey,
 accountStorageId:a=>encodeURIComponent(a.id),ACCOUNT_DATA_VERSION:3,STUDY_DATA_VERSION:1,projectRuntimeKey:()=>'',clearSavedWordDrafts(){}});
vm.runInContext(app.slice(start,end),context,{timeout:1000});vm.runInContext('clearAccountLocalData(state.account)',context,{timeout:1000});
assert.equal(values.has(masteryStorageKey(account.id)),false,'Successful account deletion must remove its pending answers and mastery cache');
assert.equal(values.get(masteryStorageKey(other.id)),originalOther,'Other account learning records must survive');
assert.equal(values.get('unrelated-fixture'),'retain');
console.log('Task26 account deletion: 1 acceptance group passed; own outbox removed, other accounts retained');
