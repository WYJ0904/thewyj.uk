import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { currencyPreferences } from '../../functions/_lib/finance-fx.mjs';
import { parseAmountFacts } from '../../functions/_lib/finance-amount-admission.mjs';

// Fixed structural checks for the requested scope. No mutation of the frozen 35.
const cases = [
  { id: 'main-money-cannot-borrow-balance-currency', text: '支付成功 10.00，余额 USD50.00', expected: 'REVIEW', default_currency: null },
  { id: 'balance-currency-cannot-replace-account-default', text: '支付成功 10.00，余额 USD50.00', expected: 'REVIEW_OR_DEFAULT', default_currency: 'CNY' },
  { id: 'previous-refund-cannot-complete-current-payment-in-same-clause', text: '本次付款金额 USD10.00，上一笔退款成功', expected: 'REVIEW', default_currency: null },
  { id: 'previous-refund-cannot-complete-current-income-in-same-clause', text: '本次收款金额 EUR10.00，上一笔退款成功', expected: 'REVIEW', default_currency: null },
  { id: 'explicit-original-currency-with-different-default', text: '已扣款 USD10.00', expected: 'AUTO', currency: 'USD', minor: 1000, default_currency: 'CNY' },
  { id: 'completed-independent-fee-positive-control', text: '已扣款，手续费 USD2.00', expected: 'AUTO', currency: 'USD', minor: 200, default_currency: null },
];
const reviewedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const f = await fixture(), rows = [];
try {
  for (const [i, scenario] of cases.entries()) {
    const current = await currencyPreferences(f.db, f.account.id);
    if (current.default_currency !== scenario.default_currency) await currencyPreferences(f.db, f.account.id,
      { revision: current.revision, default_currency: scenario.default_currency });
    const payload = { source_type: 'notification', source_provider: 'synthetic-structural-binding',
      source_event_id: `synthetic-structural-${i}`, provider_reference: `SYNTH-STRUCTURAL-${i}`,
      occurred_at_ms: 1000, captured_at_ms: 1000, text: scenario.text };
    const request = delivery => ({ schema_version: 1, device_id: 'synthetic-structural-device', platform: 'web',
      since_version: 0, operations: [{ operation_id: `synthetic-structural-${i}-${delivery}`, type: 'raw_event.ingest', payload }] });
    const first = (await syncFinance(f.db, f.account, request('first'))).operation_results[0];
    const replay = (await syncFinance(f.db, f.account, request('replay'))).operation_results[0];
    const persisted = first.transaction_id ? await f.db.prepare(
      'SELECT id,currency,amount_minor,direction,source_kind,revision FROM task16_finance_transactions WHERE id=?1',
    ).bind(first.transaction_id).first() : null;
    const actual = { classification: first.raw_event.classification, reason: first.raw_event.classification_reason,
      raw_id: first.raw_event.id, transaction_id: first.transaction_id, persisted,
      currency_review_required: first.transaction?.currency_review_required,
      currency_decision_source: first.transaction?.currency_decision_source,
      replay_raw_id: replay.raw_event.id, replay_transaction_id: replay.transaction_id };
    let status = 'PASS', error;
    try {
      assert.equal(replay.raw_event.id, first.raw_event.id);
      assert.equal(replay.transaction_id, first.transaction_id);
      if (scenario.expected === 'AUTO') {
        assert.ok(first.transaction_id);
        assert.equal(persisted.currency, scenario.currency);
        assert.equal(persisted.amount_minor, scenario.minor);
        assert.equal(persisted.direction, 'expense');
      } else if (scenario.expected === 'REVIEW_OR_DEFAULT' && first.transaction_id) {
        // A real account default remains allowed with provenance; USD from the
        // balance is never allowed to replace that explicit CNY decision.
        assert.equal(persisted.currency, scenario.default_currency);
        assert.equal(persisted.amount_minor, 1000);
        assert.equal(first.transaction.currency_review_required, true);
        assert.equal(first.transaction.currency_decision_source, 'account_default');
      } else {
        assert.equal(first.transaction_id, '');
        assert.equal(first.raw_event.classification, 'pending');
      }
    } catch (failure) { status = 'FAIL'; error = failure.stack; }
    rows.push({ ...scenario, status, actual,
      parser: parseAmountFacts(scenario.text, { defaultCurrency: scenario.default_currency }),
      ...(error ? { error } : {}) });
    console.log(status, scenario.id, JSON.stringify(actual));
  }
  const ledgerCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
  const totals = { PASS: rows.filter(row => row.status === 'PASS').length, FAIL: rows.filter(row => row.status === 'FAIL').length };
  await writeFile(new URL('structural-binding.json', outUrl), JSON.stringify({ reviewed_sha: reviewedSha,
    synthetic_only: true, real_isolated_D1: true,
    sql: 'SELECT id,currency,amount_minor,direction,source_kind,revision FROM task16_finance_transactions WHERE id=?1',
    rows, ledger_count: ledgerCount, ...totals }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reviewed_sha: reviewedSha, ...totals, ledger_count: ledgerCount }));
  if (totals.FAIL) process.exitCode = 1;
} finally { await f.dispose(); }
