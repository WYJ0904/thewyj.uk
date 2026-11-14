import assert from 'node:assert/strict';
import test from 'node:test';
import { explicitCurrencyCodes, hasAmbiguousCurrencySymbol } from '../../functions/_lib/payment-currency-evidence.mjs';
import { rawCurrencyMoney } from '../../functions/_lib/finance-raw-currency.mjs';
import { normalizeRawEvent } from '../../functions/_lib/task16-model.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { fixture } from './fixture.mjs';

const input = (text, extra = {}) => ({
  source_type: 'notification',
  source_provider: 'synthetic-p04-unsupported',
  source_event_id: 'synth-unsupported-event',
  provider_reference: 'SYNTH-UNSUPPORTED-REF',
  occurred_at_ms: 1000,
  captured_at_ms: 1000,
  text,
  ...extra,
});

const unsupportedCases = [
  { prefix: 'NZ$', currency: 'NZD', text: '已扣款 NZ$100.00' },
  { prefix: 'SG$', currency: 'SGD', text: '已扣款 SG$100.00' },
  { prefix: 'S$', currency: 'SGD', text: '已扣款 S$100.00' },
];

for (const { prefix, currency, text } of unsupportedCases) {
  test(`explicit symbol recognition: ${prefix} resolves to ${currency}`, () => {
    assert.deepEqual(explicitCurrencyCodes(text), [currency]);
    assert.equal(hasAmbiguousCurrencySymbol(text), false);
  });

  test(`mixed symbol detection: ${prefix} with second bare dollar remains ambiguous`, () => {
    const mixed = `${text} 余额 $100.00`;
    assert.equal(hasAmbiguousCurrencySymbol(mixed), true);
    const raw = rawCurrencyMoney(input(mixed), mixed);
    assert.equal(raw.review_reason, 'currency_review_required');
    assert.equal(raw.amount_minor, 0);
  });

  test(`unsupported ${prefix} cannot inherit account default USD or CNY`, () => {
    for (const defaultCurrency of ['USD', 'CNY']) {
      const raw = rawCurrencyMoney(input(text), text, defaultCurrency);
      assert.equal(raw.currency, currency);
      assert.equal(raw.amount_minor, 0);
      assert.equal(raw.review_reason, 'currency_review_required');

      const normalized = normalizeRawEvent(input(text), { defaultCurrency, currencyPolicyVersion: 2 });
      assert.equal(normalized.currency, currency);
      assert.equal(normalized.amount_minor, 0);
      assert.equal(normalized.classification, 'pending');
      assert.equal(normalized.classification_reason, 'currency_review_required');
    }
  });

  test(`unsupported ${prefix} cannot inherit client declared USD or CNY`, () => {
    for (const declared of ['USD', 'CNY']) {
      const raw = rawCurrencyMoney(input(text, { currency: declared }), text);
      assert.equal(raw.currency, currency);
      assert.equal(raw.amount_minor, 0);
      assert.equal(raw.review_reason, 'currency_review_required');

      const normalized = normalizeRawEvent(input(text, { currency: declared }), { currencyPolicyVersion: 2 });
      assert.equal(normalized.currency, currency);
      assert.equal(normalized.amount_minor, 0);
      assert.equal(normalized.classification, 'pending');
      assert.equal(normalized.classification_reason, 'currency_review_required');
    }
  });
}

test('preserves existing CAD/AUD, JPY and bare dollar default contract', () => {
  // CAD / AUD
  for (const [prefix, cur] of [['CA$', 'CAD'], ['AU$', 'AUD']]) {
    const t = `已扣款 ${prefix}100.00`;
    assert.deepEqual(explicitCurrencyCodes(t), [cur]);
    const raw = rawCurrencyMoney(input(t), t, 'USD');
    assert.equal(raw.currency, cur);
    assert.equal(raw.amount_minor, 0);
    assert.equal(raw.review_reason, 'currency_review_required');
  }

  // JPY zero decimal
  for (const t of ['已扣款 JP¥100', '已扣款 JP￥100']) {
    const raw = rawCurrencyMoney(input(t), t);
    assert.equal(raw.currency, 'JPY');
    assert.equal(raw.amount_minor, 100);
    assert.equal(raw.review_reason, undefined);
  }

  // Standalone bare dollar with default currency provenance
  const bare = '已扣款 $100.00';
  assert.equal(hasAmbiguousCurrencySymbol(bare), true);
  assert.deepEqual(rawCurrencyMoney(input(bare), bare, 'USD'), {
    currency: 'USD',
    amount_minor: 10000,
    amount_exponent: 2,
    currency_review_required: true,
    currency_decision_source: 'account_default',
  });
});

test('real isolated D1 ingestion and replay never create transactions for unsupported NZ$/SG$', async () => {
  const f = await fixture();
  try {
    for (const [i, { prefix, currency, text }] of unsupportedCases.entries()) {
      for (const override of [{ defaultCurrency: 'USD' }, { declared: 'USD' }, { defaultCurrency: 'CNY' }, { declared: 'CNY' }]) {
        const mode = override.declared ? `decl-${override.declared.toLowerCase()}` : `def-${override.defaultCurrency.toLowerCase()}`;
        const tag = `${currency.toLowerCase()}-${i}-${mode}`;
        const payload = {
          ...input(text, override.declared ? { currency: override.declared } : {}),
          source_event_id: `synth-unsupported-src-${tag}`,
          provider_reference: `SYNTH-UNSUP-REF-${tag}`,
        };
        const request = op => ({
          schema_version: 1,
          device_id: 'synthetic-p04-device',
          platform: 'web',
          since_version: 0,
          operations: [{ operation_id: `op-${op}-${tag}`, type: 'raw_event.ingest', payload }],
        });

        const first = (await syncFinance(f.db, f.account, request('first'))).operation_results[0];
        assert.equal(first.transaction_id, '', `Must not create transaction for ${prefix} with ${JSON.stringify(override)}`);
        assert.equal(first.raw_event.classification, 'pending');
        assert.equal(first.raw_event.classification_reason, 'currency_review_required');

        const replay = (await syncFinance(f.db, f.account, request('replay'))).operation_results[0];
        assert.equal(replay.raw_event.id, first.raw_event.id);
        assert.equal(replay.transaction_id, '');
      }
    }
    const txCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
    assert.equal(txCount, 0, 'No formal transactions may exist in D1');
  } finally {
    await f.dispose();
  }
});
