import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceController } from '../js/finance/app.js';
import { mergeLocalNotificationReviews, mergeLocalNotificationLedger } from '../js/finance/notification-ledger.js';
import { canonicalPendingCandidates, candidatePresentation, candidateNeedsEditor } from '../js/finance/candidates.js';

const noop = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const server = (extra = {}) => ({kind:'hint', id:'review-a', event_id:'event-a', event_ids:['event-a'],
  state:'pending', source_package:'com.tencent.mm', amount_minor:null, direction:'unknown', ...extra});
const snapshot = (extra = {}) => ({account_id:'account-a', transactions:[], reviews:[server({amount_minor:123, direction:'income'})], ...extra});
const present = (records, local = snapshot(), account = 'account-a') => canonicalPendingCandidates({records:mergeLocalNotificationReviews(records, local, account)});
const txn = (id) => ({id, amount_minor:123, direction:'income', occurred_at_ms:1792116000000, status:'active', revision:1});

function harness({pending = false, holdSecond = false} = {}) {
  const listeners = new Map();
  const page = {classList:{contains:()=>false,toggle:noop},addEventListener:noop};
  globalThis.document = { getElementById:id=>id==='financePage'?page:null,
    addEventListener:(name, cb)=>listeners.set(name, cb) };
  globalThis.window = {addEventListener:(name,cb)=>listeners.set(name,cb),clearTimeout:noop,
    cancelAnimationFrame:noop,requestAnimationFrame:()=>1};
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{onLine:true}});
  let account = 'account-a', remoteFresh = false, fail = false, postFailure = false;
  let bootstrap = 0, changes = 0, posts = 0;
  const entered = deferred(), response = deferred();
  const secondEntered = deferred(), secondResponse = deferred();
  const data = new Map();
  function seed(id) { data.set('wyjFinance:v1:'+id, JSON.stringify({schema_version:1,account_id:id,
    device_id:'web:synthetic-device',hydrated:true,notification_identity_hydrated:true,server_version:1,
    transactions:{'txn:old-record':txn('txn:old-record')},categories:{},budgets:{},pending:pending?[{
      operation_id:'op:synthetic-upsert',type:'transaction.upsert',entity_id:'txn:old-record',base_revision:1,payload:txn('txn:old-record')}]:[]})); }
  seed(account);
  const storage = {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const controller = createFinanceController({account:()=>({id:account}),storage,hasEntitlement:()=>true,
    isSuperAdmin:()=>false,appVersion:'synthetic-test',
    apiGet:async route=>{
      if (fail) throw new Error('synthetic offline');
      if (route==='/api/finance/bootstrap') { bootstrap++; return {transaction_count:remoteFresh?2:1,server_version:remoteFresh?2:1}; }
      if (route.startsWith('/api/finance/transactions')) return {transactions:[txn('txn:old-record'),txn('txn:new-record')]};
      if (route.startsWith('/api/finance/changes')) {
        changes++;
        if (changes===2) { entered.resolve(); return response.promise; }
        if (holdSecond && changes===4) { secondEntered.resolve(); return secondResponse.promise; }
        return {changes:[],server_version:remoteFresh?2:1,next_since:remoteFresh?2:1,has_more:false};
      }
      throw new Error('Unexpected fixture route '+route);
    },
    api:async()=>{posts++;if(!pending||postFailure)throw new Error('synthetic POST failure');
      return {operation_results:[],changes:[],server_version:1,next_since:1,has_more:false};},
  });
  return {controller,entered:entered.promise,release:(payload)=>response.resolve(payload || {changes:[],server_version:1,next_since:1,has_more:false}),
    update:()=>{remoteFresh=true;window.WYJLocalPaymentLedger={account_id:account,transactions:[{...txn('txn:new-record'),event_id:'new-event',sync_state:'synced'}],reviews:[]};listeners.get('thewyj:payment-updated')?.();},
    online:()=>listeners.get('online')?.(),setFail:value=>{fail=value;},
    setPostFailure:value=>{postFailure=value;},remote:()=>{remoteFresh=true;},secondEntered:secondEntered.promise,
    releaseSecond:()=>secondResponse.resolve({changes:[],server_version:2,next_since:2,has_more:false}),
    changeAccount:()=>{account='account-b';seed(account);},
    stored:(id=account)=>JSON.parse(data.get('wyjFinance:v1:'+id)),counts:()=>({bootstrap,changes,posts})};
}

test('P1/T01 exact local evidence is visible without changing canonical amount or count',()=>{
  const rows=present([server()]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount_minor,0,'server amount remains unknown');
  const view=candidatePresentation(rows[0]);
  assert.equal(view.amountMinor,123);
  assert.equal(view.localEvidencePending,true);
  assert.equal(candidateNeedsEditor(rows[0]),true,'local evidence must not enable direct confirmation');
});
test('P2/T06 fresh cloud amount and trusted package keep their display meaning',()=>{
  const [row]=present([server({amount_minor:123,direction:'income',app_label:'支付宝'})]);
  const view=candidatePresentation(row);
  assert.equal(view.amountUnknown,false);
  assert.equal(row.source_package,'com.tencent.mm');
  assert.equal(view.localEvidencePending,false);
});
test('T06/T07/T08 aliases require exact account and source; equal money is not identity',()=>{
  for(const local of [snapshot({account_id:'account-b'}),snapshot({reviews:[server({event_id:'different',event_ids:['different'],amount_minor:123})]}),
    snapshot({reviews:[server({source_package:'com.eg.android.AlipayGphone',amount_minor:123})]})]) {
    assert.equal(candidatePresentation(present([server()],local)[0]).amountUnknown,true);
  }
  const rows=present([server({event_id:'alias-a',event_ids:['event-a','alias-a']}),server({id:'review-b',event_id:'event-b',event_ids:['event-b']})]);
  assert.equal(candidatePresentation(rows[0]).amountMinor,123);
  assert.equal(candidatePresentation(rows[1]).amountUnknown,true);
});
test('T09/T16 terminal canonical rows and deleted receipt never resurrect',()=>{
  for(const state of ['confirmed','ignored','deleted','expired']) assert.equal(present([server({state})]).length,0);
  const ledger={};
  assert.equal(mergeLocalNotificationLedger(ledger,snapshot({transactions:[{...txn('txn:deleted-row'),event_id:'event-a',sync_state:'synced'}]}),'account-a'),false);
  assert.deepEqual(ledger,{});
});
test('T13 conflicting amounts are explicit and require deliberate editing',()=>{
  const [row]=present([server({amount_minor:999,direction:'income'})]);
  assert.equal(row.amount_minor,999);
  assert.equal(candidatePresentation(row).evidenceConflict,true);
  assert.equal(candidateNeedsEditor(row),true);
});
test('P3/T02/T03 pending zero invalidation drains after old final response; bursts coalesce',async()=>{
  const h=harness();const first=h.controller.show();await h.entered;
  for(let i=0;i<100;i++) h.update();
  h.release();await first;
  assert.ok(h.stored().transactions['txn:new-record']);
  assert.deepEqual(h.counts(),{bootstrap:2,changes:4,posts:0});
});
test('T08 stale account response cannot write into new account or clear its run',async()=>{
  const h=harness();const old=h.controller.show();await h.entered;
  h.controller.resetAccount();h.changeAccount();await h.controller.show();
  const before=JSON.stringify(h.stored());h.release({changes:[{entity_type:'transaction',version:2,payload:{transaction:txn('txn:account-a-late')}}],server_version:2,next_since:2,has_more:false});await old;
  assert.equal(JSON.stringify(h.stored()),before);
  assert.equal(h.stored().account_id,'account-b');
});
test('T10 failure is honest and a legal retry observes fresh state',async()=>{
  const h=harness();h.setFail(true);
  assert.equal(await h.controller.syncNow(),false);
  h.setFail(false);h.update();h.release();
  assert.equal(await h.controller.syncNow(),true);
  assert.ok(h.stored().transactions['txn:new-record']);
});
test('T11 hidden page rejects delayed result; reentry rereads',async()=>{
  const h=harness();const old=h.controller.show();await h.entered;
  h.controller.hide();h.update();h.release();await old;
  assert.equal(Boolean(h.stored().transactions['txn:new-record']),false);
  await h.controller.show();
  assert.ok(h.stored().transactions['txn:new-record']);
});
test('manual refresh joins a drain that actually reads after the click',async()=>{
  const h=harness();const first=h.controller.show();await h.entered;h.remote();
  const manual=h.controller.syncNow();h.release();
  assert.equal(await manual,true);await first;
  assert.ok(h.stored().transactions['txn:new-record']);assert.equal(h.counts().bootstrap,2);
});
test('T03 last invalidation during the follow-up is not dropped',async()=>{
  const h=harness({holdSecond:true});const first=h.controller.show();await h.entered;
  h.update();h.release();await h.secondEntered;h.update();h.releaseSecond();await first;
  assert.equal(h.counts().bootstrap,3);assert.equal(h.counts().changes,6);
});
test('T02/T07 invalidation drain never resends an acknowledged POST',async()=>{
  const h=harness({pending:true});const first=h.controller.show();await h.entered;
  h.update();h.release();await first;
  assert.equal(h.counts().posts,1);assert.equal(h.stored().pending.length,0);
});
test('T10 failed POST preserves durable operation identity and stops until retry',async()=>{
  const h=harness({pending:true});h.setPostFailure(true);
  assert.equal(await h.controller.syncNow(),false);
  assert.equal(h.stored().pending[0].operation_id,'op:synthetic-upsert');
  assert.equal(h.counts().posts,1);
  h.setPostFailure(false);h.release();assert.equal(await h.controller.syncNow(),true);
  assert.equal(h.counts().posts,2);assert.equal(h.stored().pending.length,0);
});
