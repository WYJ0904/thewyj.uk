import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFinanceMoney } from '../../js/finance/format.js';
import { explicitCurrencyCodes, hasAmbiguousCurrencySymbol } from '../../functions/_lib/payment-currency-evidence.mjs';
import { rawCurrencyMoney } from '../../functions/_lib/finance-raw-currency.mjs';
import { normalizeRawEvent } from '../../functions/_lib/task16-model.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { fixture } from './fixture.mjs';

// Synthetic notifications only. Equal numeric tokens must not hide a second,
// independently unresolved currency occurrence.
const ambiguous = [
  '已扣款 US$100.00 余额 $100.00',
  '已扣款 HK$100.00 余额 $100.00',
  '已扣款 JP¥100 余额 ¥100',
  '已扣款 日元100 余额 ￥100',
  '已扣款 美元100.00 余额 $100.00',
  '已扣款 CNY100.00 手续费 ¥100.00',
  '已扣款 USD100.00 余额 $100.00',
];
const input = text => ({ source_type: 'notification', source_provider: 'synthetic-pr138',
  source_event_id: 'synthetic-pr138-event', provider_reference: 'SYNTH-138-REF',
  occurred_at_ms: 1000, captured_at_ms: 1000, text });

test('legacy one-argument CNY formatting cannot absorb an explicit unknown currency', () => {
  assert.equal(formatFinanceMoney(1234), formatFinanceMoney(1234, 'CNY'));
  for (const currency of [undefined, null, '', 'XXX', 'AUD', 'usd', 'USD ']) {
    assert.match(formatFinanceMoney(1234, currency), /金额单位待核实/);
    assert.doesNotMatch(formatFinanceMoney(1234, currency), /¥|￥|12\.34/);
  }
  assert.match(formatFinanceMoney(1234, 'JPY'), /1,234/);
  assert.doesNotMatch(formatFinanceMoney(1234, 'JPY'), /\.34/);
});

for (const text of ambiguous) test('each unresolved symbol survives other currency cues: ' + text, () => {
  assert.equal(hasAmbiguousCurrencySymbol(text), true);
  const raw = rawCurrencyMoney(input(text), text);
  assert.equal(raw.review_reason, 'currency_review_required');
  assert.equal(raw.amount_minor, 0);
  const normalized = normalizeRawEvent(input(text), { currencyPolicyVersion: 2 });
  assert.equal(normalized.classification, 'pending');
  assert.equal(normalized.classification_reason, 'currency_review_required');
  assert.equal(normalized.amount_minor, 0);
});

for (const [text, currency] of [
  ['已扣款 US$100.00', 'USD'], ['已扣款 HK$100.00', 'HKD'],
  ['已扣款 JP¥100', 'JPY'], ['已扣款 JP￥100', 'JPY'],
  ['已扣款 人民币 ¥100.00', 'CNY'], ['已扣款 ¥100.00 人民币', 'CNY'],
  ['已扣款 USD $100.00', 'USD'], ['已扣款 $100.00 USD', 'USD'],
]) test('a currency cue attached to the same amount remains usable: ' + text, () => {
  assert.equal(hasAmbiguousCurrencySymbol(text), false);
  assert.deepEqual(explicitCurrencyCodes(text), [currency]);
  const raw = rawCurrencyMoney(input(text), text);
  assert.equal(raw.review_reason, undefined);
  assert.equal(raw.currency, currency);
  assert.equal(raw.amount_minor, currency === 'JPY' ? 100 : 10000);
});

for (const [prefix, currency] of [['CA$', 'CAD'], ['AU$', 'AUD']]) test('unsupported qualified dollars cannot inherit the USD account default: ' + prefix, () => {
  const text = '已扣款 ' + prefix + '100.00';
  assert.deepEqual(explicitCurrencyCodes(text), [currency]);
  const raw = rawCurrencyMoney(input(text), text, 'USD');
  assert.equal(raw.currency, currency);
  assert.equal(raw.amount_minor, 0);
  assert.equal(raw.review_reason, 'currency_review_required');
});

test('one standalone ambiguous symbol keeps the explicit account-default review provenance', () => {
  const text = '已扣款 $100.00';
  assert.equal(hasAmbiguousCurrencySymbol(text), true);
  assert.equal(rawCurrencyMoney(input(text), text).currency, 'XXX');
  assert.deepEqual(rawCurrencyMoney(input(text), text, 'USD'), {
    currency: 'USD', amount_minor: 10000, amount_exponent: 2,
    currency_review_required: true, currency_decision_source: 'account_default',
  });
});

test('two explicitly different currencies remain in review even when both amounts are equal', () => {
  const text = '已扣款 US$100.00 余额 HK$100.00';
  assert.equal(rawCurrencyMoney(input(text), text).review_reason, 'currency_review_required');
});

test('real isolated D1 ingestion and replay never book mixed unresolved symbols', async () => {
  const f = await fixture();
  try {
    for (const [i, text] of ambiguous.entries()) {
      const payload = { ...input(text), source_event_id: 'synthetic-pr138-source-' + i,
        provider_reference: 'SYNTH-138-REF-' + i };
      const request = operation => ({ schema_version: 1, device_id: 'synthetic-pr138-device', platform: 'web',
        since_version: 0, operations: [{ operation_id: operation, type: 'raw_event.ingest', payload }] });
      const first = (await syncFinance(f.db, f.account, request('synthetic-pr138-first-' + i))).operation_results[0];
      assert.equal(first.transaction_id, '');
      assert.equal(first.raw_event.classification, 'pending');
      const replay = (await syncFinance(f.db, f.account, request('synthetic-pr138-replay-' + i))).operation_results[0];
      assert.equal(replay.raw_event.id, first.raw_event.id);
      assert.equal(replay.transaction_id, '');
    }
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n, 0);
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_raw_events').first()).n, ambiguous.length);
  } finally { await f.dispose(); }
});
