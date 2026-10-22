import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { handleTask21Request } from '../../functions/_lib/task21-api.mjs';
import { handleTask16Request } from '../../functions/_lib/task16-api.mjs';
import { sessionStorageKey } from '../../functions/_lib/task12-crypto.mjs';
import { syncFinance, financeBootstrap, listFinanceTransactions } from '../../functions/_lib/task16-service.mjs';
import { ingestNotificationEvents } from '../../functions/_lib/task21-service.mjs';
import { upsertNotificationHints, notificationPendingSummary } from '../../functions/_lib/task21-hints.mjs';
import { readLifecycleBalance } from '../../functions/_lib/task21-lifecycle.mjs';
import { referenceRate, transactionReferences, currencyPreferences } from '../../functions/_lib/finance-fx.mjs';
import { calculateFinanceSummary } from '../../js/finance/app.js';
import { outUrl } from './output.mjs';
import { applyPaymentReconciliation,reconciliationSnapshot } from '../../functions/_lib/task21-reconciliation.mjs';

const f = await fixture(), rows = [];
const now = new Date().toISOString(), token = 'synthetic-p04-http-session';
const env = { WYJ_DB: f.db, WYJ_ENVIRONMENT: 'development', CLOUD_FOUNDATION_ENABLED: 'true', TASK12_CLOUD_ACCOUNTS_ENABLED: 'true',
  TASK13_CLOUD_READS_ENABLED: 'true', TASK16_CLOUD_READS_ENABLED: 'true', TASK16_CLOUD_WRITES_ENABLED: 'true', D1_RATE_LIMIT_ENABLED: 'false', TASK21_NOTIFICATION_READS_ENABLED: 'true', TASK21_NOTIFICATION_WRITES_ENABLED: 'true' };
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const result = await (request.url.startsWith('/api/notification/') ? handleTask21Request : handleTask16Request)({ env, data: { requestId: 'synthetic-p04-http' }, request: new Request('http://127.0.0.1' + request.url,
      { method: request.method, headers: request.headers, ...(body.length ? { body } : {}) }) });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text());
  } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function request(route, body, authenticated = true, capable = true) {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(authenticated ? { 'X-Session-Token': token } : {}),
      ...(capable ? { 'X-Finance-Money-Version': '2' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...(await response.json()) };
}
async function check(id, run) {
  try { const actual = await run(); rows.push({ id, status: 'PASS', actual }); console.log('PASS', id); }
  catch (error) { rows.push({ id, status: 'FAIL', error: error.stack }); console.error('FAIL', id, error.message); }
}
let sequence = 0;
async function sync(operation) { return syncFinance(f.db, f.account, { schema_version: 1, device_id: 'synthetic-p04-web', platform: 'web', since_version: 0, operations: [operation] }); }
const event = (id, currency, more = {}) => ({ event_id: `synthetic-p04-${id}`, fingerprint: 'a'.repeat(64), source_package: 'cmb.pb', source_type: 'notification',
  event_type: 'transaction', parser_version: 'bank-notification-4', parse_status: 'parsed', direction: 'expense', amount_minor: 10000, currency, ...(currency === 'JPY' ? {amount_exponent:0}:{}), payment_channel: 'bank_card',
  merchant: 'synthetic merchant', confidence: 950, occurred_at_ms: Date.UTC(2026,9,19,12), received_at_ms: Date.UTC(2026,9,19,12), currency_evidence: currency, ...more });
async function ingest(payload, operation = `synthetic-p04-ingest-operation-${++sequence}`) {
  return (await ingestNotificationEvents(f.db, f.account, { schema_version: '1', device_id: 'synthetic-p04-device', operations: [{ operation_id: operation, type: 'event.ingest', payload }] })).operation_results[0];
}
try {
  await check('HTTP-unauthenticated-currencies-rejected', async () => assert.equal((await request('/api/finance/currencies', undefined, false)).status, 401));
  await f.db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'browser')`)
    .bind(await sessionStorageKey(token), f.account.id, now, new Date(Date.now()+86400000).toISOString()).run();
  await check('HTTP-unentitled-reference-access-rejected', async () => assert.equal((await request('/api/finance/currencies')).status, 403));
  await f.db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at)
    VALUES('synthetic-p04-membership',?1,'finance_monthly',?2,?3,0,'active','fixture','synthetic-p04','fixture','{}',?2,?2)`)
    .bind(f.account.id, now, new Date(Date.now()+86400000).toISOString()).run();
  await check('HTTP-account-display-default-distinct', async () => {
    const initial = await request('/api/finance/currencies'); assert.equal(initial.status, 200); assert.equal(initial.preferences.default_currency, null);
    const saved = await request('/api/finance/currencies', { revision: 0, account_currency: 'HKD', display_currency: 'JPY', default_currency: 'USD' });
    assert.equal(saved.status, 200); assert.equal(saved.preferences.display_currency,'JPY'); assert.equal(saved.preferences.account_currency,'HKD'); return saved.preferences;
  });
  await check('HTTP-preferences-stale-revision-rejected', async () => assert.equal((await request('/api/finance/currencies', { revision: 0, display_currency: 'GBP' })).status,409));
  await check('preferences-concurrent-CAS-does-not-lose-a-user-edit', async () => {
    const results = await Promise.allSettled(['GBP','EUR'].map(display_currency => currencyPreferences(f.db,f.account.id,{ revision:1,display_currency })));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='currency_preferences_conflict').length,1);
  });
  const transactions = [];
  for (const currency of ['CNY','USD','EUR','HKD','GBP','JPY']) {
    await check(`HTTP-${currency}-manual-read-edit-replay`, async () => {
      const tx = await f.transaction(currency,12345); transactions.push(tx);
      const read = await request('/api/finance/transactions?limit=200'); assert.equal(read.status,200);
      const row = read.transactions.find(row=>row.id===tx.id); assert.equal(row.currency,currency); assert.equal(row.amount_minor,12345);
      if(currency==='JPY') assert.equal(row.amount_exponent,0);
      const operation = { operation_id:`synthetic-p04-manual-${currency}`,type:'transaction.upsert',entity_id:tx.id,base_revision:1,
        payload:{direction:'expense',currency,amount_minor:23456,occurred_at_ms:tx.occurred_at_ms,...(currency==='JPY'?{amount_exponent:0}:{})} };
      const first=await sync(operation), replay=await sync(operation); assert.equal(first.operation_results[0].transaction.id,tx.id);
      assert.equal(replay.operation_results[0].idempotent_replay,true); assert.equal(replay.operation_results[0].transaction.amount_minor,23456);
      return { id:tx.id,revision:first.operation_results[0].transaction.revision,currency,original:12345,edited:23456 };
    });
    await check(`${currency}-budget-retains-own-unit`, async () => {
      const result=await sync({operation_id:`synthetic-p04-budget-op-${currency}`,type:'budget.upsert',entity_id:`synthetic-p04-budget-${currency}`,base_revision:0,
        payload:{period_type:'monthly',currency,amount_minor:100000,starts_on:'2026-10-01',ends_on:'2026-10-31',...(currency==='JPY'?{amount_exponent:0}:{})}});
      assert.equal(result.operation_results[0].budget.currency,currency); if(currency==='JPY')assert.equal(result.operation_results[0].budget.amount_exponent,0);
    });
    await check(`${currency}-authorization-captures-refund-release-idempotent`, async () => {
      const family=`SYNTH-P04-${currency}-AUTH`, metadata={financial_phase:'AUTHORIZED',lifecycle_operation:'AUTHORIZE',provider_reference:family,lifecycle_reference:family,reference_namespace:'bank_card:cmb',parse_status:'candidate'};
      const auth=await ingest(event(`${currency}-auth`,currency,{...metadata,amount_minor:20000})); assert.equal(auth.transaction_id,'');
      const capture = async (id,amount)=>ingest(event(`${currency}-capture-${id}`,currency,{...metadata,parse_status:'parsed',financial_phase:'SETTLED',lifecycle_operation:'CAPTURE',provider_reference:`SYNTH-P04-${currency}-CAP-${id}`,amount_minor:amount}));
      const first=await capture('one',8000), second=await capture('two',9000), replay=await capture('one',8000);
      assert.ok(first.transaction_id,JSON.stringify(first)); assert.ok(second.transaction_id,JSON.stringify(second)); assert.equal(first.transaction_id,replay.transaction_id);
      const refund=await ingest(event(`${currency}-refund`,currency,{...metadata,parse_status:'parsed',financial_phase:'REFUNDED',lifecycle_operation:'REFUND',direction:'refund',provider_reference:`SYNTH-P04-${currency}-REFUND`,amount_minor:2000})); assert.ok(refund.transaction_id);
      const release=await ingest(event(`${currency}-release`,currency,{...metadata,financial_phase:'RELEASED',lifecycle_operation:'RELEASE',provider_reference:`SYNTH-P04-${currency}-RELEASE`,amount_minor:3000})); assert.equal(release.transaction_id,'');
      const balance=await readLifecycleBalance(f.db,f.account,'bank_card:cmb',family);
      assert.equal(balance.cleared_minor,17000); assert.equal(balance.refunded_minor,2000); assert.equal(balance.net_expense_minor,15000); assert.equal(balance.remaining_frozen_minor,0);
      const stored=await f.db.prepare('SELECT currency,amount_minor,amount_exponent FROM task16_finance_transactions WHERE id=?1').bind(first.transaction_id).first();
      assert.equal(stored.currency,currency); assert.equal(stored.amount_minor,8000); assert.equal(stored.amount_exponent,currency==='JPY'?0:2); return balance;
    });
  }
  await check('HTTP-legacy-client-JPY-list-and-budget-fail-closed', async () => {
    for (const route of ['/api/finance/transactions','/api/finance/bootstrap','/api/finance/changes?since=0']) {
      const result=await request(route,undefined,true,false); assert.equal(result.status,409); assert.equal(result.code,'currency_client_upgrade_required');
    }
  });
  await check('HTTP-legacy-notification-client-cannot-misread-JPY',async()=>{
    for(const route of ['/api/notification/candidates?status=pending','/api/notification/pending-summary']) {
      const input=event('legacy-jpy-pending','JPY',{parse_status:'candidate',identity_review_reason:'identity_unproven_notification'});
      await ingest(input);
      const old=await request(route,undefined,true,false);assert.equal(old.status,409);assert.equal(old.code,'currency_client_upgrade_required');
      assert.equal((await request(route)).status,200);
      const pending=await f.db.prepare("SELECT candidate_id FROM task21_notification_events WHERE event_id='synthetic-p04-legacy-jpy-pending'").first();
      assert.equal((await request('/api/notification/candidates/confirm',{candidate_id:pending.candidate_id,device_id:'synthetic-p04-device'},true,false)).status,409);
    }
    const ingestBody={schema_version:1,device_id:'synthetic-p04-old-device',operations:[{operation_id:'synthetic-p04-old-jpy-operation',type:'event.ingest',payload:event('old-wire-jpy','JPY')}]};
    assert.equal((await request('/api/notification/ingest',ingestBody,true,false)).status,409);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM task21_notification_events WHERE event_id='synthetic-p04-old-wire-jpy'").first()).n,0);
  });
  await check('upgraded-client-cannot-relabel-an-old-unitless-JPY-outbox',async()=>{
    const payload=event('old-unitless-jpy-queue','JPY');delete payload.amount_exponent;
    const body={schema_version:1,device_id:'synthetic-p04-upgraded-device',operations:[{operation_id:'synthetic-p04-unitless-old-operation',type:'event.ingest',payload}]};
    const result=await request('/api/notification/ingest',body);assert.equal(result.status,409);assert.equal(result.code,'currency_unit_review_required');
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM task21_notification_events WHERE event_id='synthetic-p04-old-unitless-jpy-queue'").first()).n,0);
  });
  await check('legacy-JPY-pending-unit-is-visible-and-requires-an-explicit-retyped-amount',async()=>{
    const source=event('legacy-pending-unit','JPY',{parse_status:'candidate',identity_review_reason:'identity_unproven_notification'});
    const pending=await ingest(source);
    await f.db.prepare('DELETE FROM task21_currency_units WHERE user_id=?1 AND event_id=?2').bind(f.account.id,source.event_id).run();
    const summary=await request('/api/notification/pending-summary');const row=summary.records.find(row=>row.event_id===source.event_id);
    assert.equal(row.amount_exponent,null);assert.equal(row.money_unit_status,'review_required');assert.equal(row.amount_minor,10000);
    const base={candidate_id:pending.candidate_id,device_id:'synthetic-p04-unit-review-device'};
    assert.equal((await request('/api/notification/candidates/confirm',base)).status,409);
    const confirmed=await request('/api/notification/candidates/confirm',{...base,edits:{amount_minor:10000,amount_exponent:0}});assert.equal(confirmed.status,200);
    const transaction=await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(confirmed.transaction_id).first();assert.equal(transaction.amount_exponent,0);assert.equal(transaction.amount_minor,10000);
    assert.equal((await f.db.prepare('SELECT amount_minor FROM task21_notification_events WHERE event_id=?1').bind(source.event_id).first()).amount_minor,10000);
    assert.equal(await f.db.prepare('SELECT * FROM task21_currency_units WHERE user_id=?1 AND event_id=?2').bind(f.account.id,source.event_id).first(),null);
  });
  await check('HTTP-JPY-without-explicit-zero-unit-rejected', async () => {
    const result=await request('/api/finance/sync',{schema_version:1,device_id:'synthetic-p04-old-web',platform:'web',since_version:0,
      operations:[{operation_id:'synthetic-p04-bad-jpy',type:'transaction.upsert',entity_id:'synthetic-p04-bad-jpy',base_revision:0,payload:{currency:'JPY',amount_minor:100,direction:'expense',occurred_at_ms:Date.now()}}]});
    assert.equal(result.status,409); assert.equal(result.code,'currency_unit_capability_required');
  });
  await check('unknown-currency-stays-in-review-without-ledger', async () => {
    const result=await ingest(event('unknown-unit','AUD')); assert.equal(result.transaction_id,''); assert.ok(result.candidate_id);
    const pending=await notificationPendingSummary(f.db,f.account); const row=pending.records.find(row=>row.event_id==='synthetic-p04-unknown-unit');assert.equal(row.currency,'AUD');
  });
  await check('original-settlement-fee-roles-survive-and-do-not-double-book', async () => {
    const roles={original:{currency:'USD',amount_minor:10000},settlement:{currency:'CNY',amount_minor:70000},fee:{currency:'CNY',amount_minor:1000}};
    const input=event('original-role','USD',{currency_roles:roles}); const result=await ingest(input);
    assert.ok(result.transaction_id,JSON.stringify(result)); const read=await listFinanceTransactions(f.db,f.account,{limit:200});
    const row=read.transactions.find(row=>row.id===result.transaction_id); assert.equal(row.amount_minor,10000); assert.equal(row.currency,'USD');
    assert.deepEqual(row.currency_role_evidence[0].roles,roles);
    await assert.rejects(()=>ingest({...input,currency_roles:{...roles,fee:{currency:'CNY',amount_minor:2000}}}),e=>e.code==='event_identity_conflict');
    return {id:row.id,roles:row.currency_role_evidence};
  });
  await check('zero-fee-is-evidence-and-string-minor-units-are-rejected',async()=>{
    const input=event('zero-fee-role','USD',{currency_roles:{original:{currency:'USD',amount_minor:10000},settlement:{currency:'CNY',amount_minor:70000},fee:{currency:'CNY',amount_minor:0}}});
    const result=await ingest(input);assert.ok(result.transaction_id);
    const row=await f.db.prepare("SELECT roles_json FROM task16_currency_role_evidence WHERE event_id='synthetic-p04-zero-fee-role'").first();assert.equal(JSON.parse(row.roles_json).fee.amount_minor,0);
    await assert.rejects(()=>ingest({...input,event_id:'synthetic-p04-string-role',currency_roles:{original:{currency:'USD',amount_minor:'10000'}}}),error=>error.code==='currency_roles_invalid');
  });
  await check('hint-replay-and-provider-alias-cannot-change-currency',async()=>{
    const input={device_id:'synthetic-p04-device',hints:[{source_event_id:'synthetic-p04-currency-hint',source_type:'notification',source_package:'cmb.pb',payment_channel:'bank_card',provider_reference:'SYNTH-P04-CURRENCY-HINT',amount_minor:10000,direction:'expense',currency:'USD',recognition_status:'PAYMENT_LIKELY'}]};
    await upsertNotificationHints(f.db,f.account,input);
    await assert.rejects(()=>upsertNotificationHints(f.db,f.account,{...input,hints:[{...input.hints[0],currency:'CNY'}]}),e=>e.code==='currency_evidence_conflict');
    await assert.rejects(()=>upsertNotificationHints(f.db,f.account,{...input,hints:[{...input.hints[0],source_event_id:'synthetic-p04-other-currency-hint',currency:'CNY'}]}),e=>e.code==='provider_reference_conflict');
    assert.equal((await f.db.prepare("SELECT currency FROM task21_notification_pending_hints WHERE source_event_id='synthetic-p04-currency-hint'").first()).currency,'USD');
  });
  await check('HTTP-reference-snapshot-does-not-change-ledger-or-receipt', async () => {
    const usd=transactions.find(row=>row.currency==='USD');
    const before=await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(usd.id).first();
    await referenceRate(f.db,'USD','CNY','2026-10-19',{fetcher:async()=>new Response('{"base":"USD","quote":"CNY","date":"2026-10-19","rate":7}',{headers:{'Content-Type':'application/json'}})});
    const reference=await request(`/api/finance/references?ids=${usd.id}&display_currency=CNY`); assert.equal(reference.status,200);
    assert.equal(reference.references[`${usd.id}:2:CNY`].converted_minor,164192);
    assert.deepEqual(await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(usd.id).first(),before);
    const all=await listFinanceTransactions(f.db,f.account,{limit:200}); const summary=calculateFinanceSummary(all.transactions,{display_currency:'CNY',snapshots:reference.references});
    assert.ok(summary.unconverted.length>0); assert.equal(summary.conversion_status,'missing_historical_rate');
  });
  await check('HTTP-invalid-pairs-and-preference-fields-rejected', async () => {
    assert.equal((await request('/api/finance/fx?base=AUD&quote=CNY&date=2026-10-19')).status,400);
    assert.equal((await request('/api/finance/currencies',{revision:2,display_currency:null})).status,400);
    assert.equal((await request('/api/finance/currencies',{revision:2,api_key:'synthetic-never-accepted'})).status,400);
  });
  await check('authoritative-JPY-reconciliation-requires-source-unit-before-any-monetary-write',async()=>{
    const family='synthetic-p04-jpy-reconcile-auth',reference='synthetic-p04-jpy-reconcile-cap';
    const common={financial_phase:'SETTLED',lifecycle_operation:'CAPTURE',lifecycle_reference:family,reference_namespace:'bank_card:cmb',provider_reference:reference};
    const old=event('jpy-reconcile-old','JPY',{...common,amount_minor:8000,lifecycle_revision:1});const receipt=await ingest(old);
    const next=event('jpy-reconcile-new','JPY',{...common,amount_minor:9000,lifecycle_revision:2,identity_review_reason:'reconciliation_evidence'});await ingest(next);
    await f.db.prepare('DELETE FROM task21_currency_units WHERE user_id=?1 AND event_id=?2').bind(f.account.id,next.event_id).run();
    const command={operation_id:'synthetic-p04-jpy-reconcile-operation',type:'payment.reconcile',payload:{kind:'REPLACE',evidence_event_id:next.event_id,target_event_ids:[old.event_id],detach_event_ids:[],predecessor_operation_id:'',predecessor_revision:1,expected_transaction_revision:1,proof_id:'synthetic-p04-jpy-reconcile-proof'}};
    const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
    const snapshot=await reconciliationSnapshot(f.db,f.account,command);
    const verifyAuthority=async()=>({account_id:f.account.id,namespace:'bank_card:cmb',provider_account_id:'synthetic-provider-not-live',completed:true,semantics:'absolute-operation-revision-v1',
      command_digest:createHash('sha256').update(JSON.stringify(stable(command))).digest('hex'),source_digests:Object.fromEntries(snapshot.rows.map(r=>[r.source.event_id,r.source_digest])),
      completed_source_digests:Object.fromEntries(snapshot.rows.filter(r=>r.source.event_id===next.event_id).map(r=>[r.source.event_id,r.source_digest]))});
    const before=(await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(receipt.transaction_id).first());
    const blocked=await applyPaymentReconciliation(f.db,f.account,'synthetic-p04-device',command,{verifyAuthority});
    assert.equal(blocked.reason,'currency_unit_review_required');assert.equal(blocked.transaction_id,'');
    assert.deepEqual(await f.db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(receipt.transaction_id).first(),before);
    await f.db.prepare('INSERT INTO task21_currency_units VALUES(?1,?2,?3,0)').bind(f.account.id,next.event_id,'JPY').run();
    const accepted=await applyPaymentReconciliation(f.db,f.account,'synthetic-p04-device',command,{verifyAuthority});
    assert.equal(accepted.reconciliation_status,'applied',accepted.reason);assert.equal(accepted.transaction_id,receipt.transaction_id);assert.equal(accepted.transaction.amount_minor,9000);assert.equal(accepted.transaction.amount_exponent,0);
    return{synthetic_authority_only:true,blocked_without_source_unit:true,stable_transaction_id:receipt.transaction_id};
  });
} finally {
  await new Promise(resolve=>server.close(resolve)); await f.dispose();
  await writeFile(new URL('contracts.json',outUrl),JSON.stringify({synthetic_only:true,transport:'real loopback HTTP + real Miniflare D1 + product services',rows},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({PASS:rows.filter(r=>r.status==='PASS').length,FAIL:rows.filter(r=>r.status==='FAIL').length}));
if(rows.some(row=>row.status==='FAIL'))process.exitCode=1;
