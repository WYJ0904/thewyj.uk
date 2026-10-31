import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { normalizeNotificationEvent } from '../../functions/_lib/task21-model.mjs';
import { ingestNotificationEvents } from '../../functions/_lib/task21-service.mjs';
import { listFinanceTransactions, syncFinance } from '../../functions/_lib/task16-service.mjs';
import { fixture } from './fixture.mjs';
import { upsertNotificationHints, notificationPendingSummary } from '../../functions/_lib/task21-hints.mjs';
import { outUrl } from './output.mjs';

const rows = [];
async function check(id, run) {
  try { await run(); rows.push({ id, status: 'PASS' }); }
  catch (error) { rows.push({ id, status: 'FAIL', error: error.stack }); }
  console.log(rows.at(-1).status, id);
}
const event = {
  event_id: 'synthetic-default-currency-event', fingerprint: 'd'.repeat(64), source_package: 'cmb.pb',
  source_type: 'notification', event_type: 'transaction', parser_version: 'bank-notification-4',
  parse_status: 'parsed', direction: 'expense', amount_minor: 10000, currency: 'USD',
  payment_channel: 'bank_card', provider_reference: 'SYNTH-DEFAULT-USD-001', currency_evidence: '',
  merchant: 'synthetic default currency', confidence: 950, occurred_at_ms: 1000, received_at_ms: 1000,
  currency_review_required: true, currency_decision_source: 'account_default',
};
await check('default-is-a-user-decision-not-explicit-source-currency', () => {
  const actual = normalizeNotificationEvent(event);
  assert.equal(actual.currency, 'USD');
  assert.equal(actual.currency_evidence, '');
  assert.equal(actual.currency_review_required, true);
  assert.equal(actual.currency_decision_source, 'account_default');
});
await check('default-provenance-cannot-claim-an-explicit-provider-currency', () => {
  assert.throws(() => normalizeNotificationEvent({ ...event, currency_evidence: 'USD' }),
    error => error.code === 'currency_decision_evidence_conflict');
});
await check('review-flag-must-be-a-boolean', () => {
  assert.throws(() => normalizeNotificationEvent({ ...event, currency_review_required: 'true' }),
    error => error.code === 'currency_decision_invalid');
});
await check('legacy-explicit-events-do-not-acquire-new-guessed-provenance', () => {
  const original = { ...event, currency_evidence: 'USD' };
  delete original.currency_review_required; delete original.currency_decision_source;
  const actual = normalizeNotificationEvent(original);
  assert.equal(Object.hasOwn(actual, 'currency_review_required'), false);
  assert.equal(Object.hasOwn(actual, 'currency_decision_source'), false);
});
if (!process.argv.includes('--model-only')) {
  const f = await fixture();
  const operation = { operation_id: 'synthetic-default-ingest-operation', type: 'event.ingest', payload: event };
  const body = { schema_version: '1', device_id: 'synthetic-default-device', operations: [operation] };
  let first, id;
  try {
    await check('proven-payment-books-once-with-a-nonblocking-currency-review', async () => {
      first = await ingestNotificationEvents(f.db, f.account, body);
      id = first.operation_results[0].transaction_id;
      assert.ok(id);
      const row = (await listFinanceTransactions(f.db, f.account)).transactions.find(row => row.id === id);
      assert.equal(row.amount_minor, 10000); assert.equal(row.currency, 'USD');
      assert.equal(row.currency_review_required, true);
      assert.equal(row.currency_decision_source, 'account_default');
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n, 1);
    });
    await check('default-decision-survives-an-exact-receipt-replay', async () => {
      const replay = await ingestNotificationEvents(f.db, f.account, body);
      assert.equal(replay.operation_results[0].transaction_id, id);
      const row = (await listFinanceTransactions(f.db, f.account)).transactions.find(row => row.id === id);
      assert.equal(row.currency_review_required, true);
      assert.equal(row.amount_minor, 10000);
    });
    await check('hint-and-canonical-summary-retain-the-same-review-decision', async () => {
      const result = await upsertNotificationHints(f.db,f.account,{device_id:'synthetic-default-device',hints:[{
        source_event_id:event.event_id,source_type:'notification',source_package:'cmb.pb',app_label:'synthetic bank',
        amount_minor:10000,direction:'expense',currency:'USD',recognition_status:'CONFIRMED_PAYMENT',
        provider_reference:event.provider_reference,payment_channel:'bank_card',
        currency_review_required:true,currency_decision_source:'account_default',
        evidence:{parser_version:'payment-settled-4',occurred_at_ms:1000,reasons:['synthetic-default-review']},
      }]});
      assert.equal(result.hints[0].currency_review_required,true);
      const summary = await notificationPendingSummary(f.db,f.account,{event_ids:event.event_id});
      assert.equal(summary.records.find(row=>row.event_id===event.event_id).currency_review_required,true);
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n,1);
    });
    async function edit(revision, more, number) {
      return syncFinance(f.db, f.account, { schema_version: 1, device_id: 'synthetic-default-editor', platform: 'web', since_version: 0,
        operations: [{ operation_id: 'synthetic-default-edit-' + number, type: 'transaction.upsert', entity_id: id,
          base_revision: revision, payload: { direction: 'expense', amount_minor: 10000, currency: 'USD', occurred_at_ms: 1000,
            merchant: 'synthetic edited merchant', ...more } }] });
    }
    await check('an-unrelated-edit-cannot-silently-clear-the-currency-review', async () => {
      const result = await edit(1, {}, 1);
      assert.equal(result.operation_results[0].transaction.currency_review_required, true);
    });
    await check('explicit-human-currency-correction-keeps-ID-and-source-facts', async () => {
      const result = await edit(2, { currency: 'EUR', currency_review_acknowledged: true }, 2);
      const row = result.operation_results[0].transaction;
      assert.equal(row.id, id); assert.equal(row.currency, 'EUR'); assert.equal(row.amount_minor, 10000);
      assert.notEqual(row.currency_review_required, true);
      const raw = await f.db.prepare('SELECT currency,amount_minor,metadata_json FROM task16_finance_raw_events WHERE source_event_id=?1').bind(event.event_id).first();
      assert.equal(raw.currency, 'USD'); assert.equal(raw.amount_minor, 10000);
      assert.equal(JSON.parse(raw.metadata_json).currency_review_required, true);
    });
    await check('old-receipt-cannot-undo-the-later-manual-currency-decision', async () => {
      await ingestNotificationEvents(f.db, f.account, body);
      const row = (await listFinanceTransactions(f.db, f.account)).transactions.find(row => row.id === id);
      assert.equal(row.currency, 'EUR'); assert.equal(row.revision, 3); assert.notEqual(row.currency_review_required, true);
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n, 1);
    });
    await check('manual-resolution-reaches-the-canonical-summary-without-changing-source-money', async () => {
      const summary = await notificationPendingSummary(f.db,f.account,{event_ids:event.event_id});
      const row=summary.records.find(row=>row.event_id===event.event_id);
      assert.equal(row.currency_review_required,false);
      assert.equal(row.transaction_id,id);
      const source=await f.db.prepare('SELECT currency,amount_minor FROM task21_notification_events WHERE user_id=?1 AND event_id=?2').bind(f.account.id,event.event_id).first();
      assert.equal(source.currency,'USD');assert.equal(source.amount_minor,10000);
    });
  } finally { await f.dispose(); }
}
await writeFile(new URL('default-currency.json', outUrl), JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ tests: rows.length, PASS: rows.filter(row => row.status === 'PASS').length, FAIL: rows.filter(row => row.status === 'FAIL').length }));
if (rows.some(row => row.status !== 'PASS')) process.exitCode = 1;
