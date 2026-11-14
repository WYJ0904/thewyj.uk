import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { currencyPreferences } from '../../functions/_lib/finance-fx.mjs';

const reviewedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// Synthetic data, real local product ingestion.
// 1. Balance/limit amounts cannot masquerade as transaction payment amounts.
// 2. Unpaid/estimated fees cannot supply transaction payment amounts.
// 3. Explicitly deducted fees with clear deduction semantics can be booked as expenses.
// 4. Main transactions with included fees or accompanying balances book the main amount once.
const cases = [
  { id: 'balance-cannot-supply-missing-paid-amount', text: '已扣款，余额 USD100.00', expected: null },
  { id: 'unpaid-estimated-fee-cannot-supply-paid-amount', text: '转账成功，预计手续费 USD2.00', expected: null },
  { id: 'balance-and-unpaid-fee-cannot-supply-paid-amount', text: '已扣款，余额 USD100.00 预计手续费 USD2.00', expected: null },
  { id: 'explicit-deducted-fee-can-supply-paid-amount', text: '已扣款，手续费 USD2.00', expected: 200 },
  { id: 'explicit-paid-amount-with-balance', text: '已扣款 USD100.00 余额 USD50.00', expected: 10000 },
  { id: 'explicit-paid-amount-with-equal-balance', text: '已扣款 USD100.00 余额 USD100.00', expected: 10000 },
  { id: 'explicit-paid-amount-with-included-fee', text: '已扣款 USD100.00，含手续费 USD2.00', expected: 10000 },
  { id: 'explicit-paid-amount-positive-control', text: '已扣款 USD100.00', expected: 10000 },
  { id: 'bare-dollar-real-account-default-control', text: '已扣款 $100.00', expected: 10000, defaultCurrency: 'USD' },
  { id: 'bare-dollar-balance-negative-account-default', text: '已扣款，余额 $100.00', expected: null, defaultCurrency: 'USD' },
];
const f = await fixture(), rows = [];
try {
  for (const [i, scenario] of cases.entries()) {
    if (scenario.defaultCurrency) {
      const before = await currencyPreferences(f.db, f.account.id);
      await currencyPreferences(f.db, f.account.id, { revision: before.revision, default_currency: scenario.defaultCurrency });
    }
    const payload = {
      source_type: 'notification', source_provider: 'synthetic-pr139-role-provider',
      source_event_id: `synthetic-pr139-role-source-${i}`, provider_reference: `SYNTH-PR139-ROLE-${i}`,
      occurred_at_ms: 1000, captured_at_ms: 1000, text: scenario.text,
    };
    const request = delivery => ({ schema_version: 1, device_id: 'synthetic-pr139-role-device', platform: 'web',
      since_version: 0, operations: [{ operation_id: `synthetic-pr139-role-${i}-${delivery}`, type: 'raw_event.ingest', payload }] });
    const first = (await syncFinance(f.db, f.account, request('first'))).operation_results[0];
    const replay = (await syncFinance(f.db, f.account, request('replay'))).operation_results[0];
    const persisted = first.transaction_id ? await f.db.prepare(
      'SELECT id,currency,amount_minor,source_kind,revision FROM task16_finance_transactions WHERE id=?1',
    ).bind(first.transaction_id).first() : null;
    const actual = { text: scenario.text, classification: first.raw_event.classification,
      reason: first.raw_event.classification_reason, raw_id: first.raw_event.id,
      transaction_id: first.transaction_id, persisted,
      replay_raw_id: replay.raw_event.id, replay_transaction_id: replay.transaction_id };
    let status = 'PASS', error;
    try {
      assert.equal(replay.raw_event.id, first.raw_event.id);
      assert.equal(replay.transaction_id, first.transaction_id);
      if (scenario.expected === null) {
        assert.equal(first.transaction_id, '', 'Auxiliary amount must not become a formal payment');
        assert.equal(first.raw_event.classification, 'pending');
        assert.equal(persisted, null);
      } else {
        assert.ok(first.transaction_id);
        assert.equal(persisted.amount_minor, scenario.expected);
        assert.equal(persisted.currency, 'USD');
        if (scenario.defaultCurrency) {
          assert.equal(first.transaction.currency_review_required, true);
          assert.equal(first.transaction.currency_decision_source, 'account_default');
        }
      }
    } catch (failure) { status = 'FAIL'; error = failure.stack; }
    rows.push({ id: scenario.id, status, actual, ...(error ? { error } : {}) });
    console.log(status, scenario.id, JSON.stringify(actual));
  }
  const ledgerCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
  const totals = { PASS: rows.filter(r => r.status === 'PASS').length, FAIL: rows.filter(r => r.status === 'FAIL').length };
  await writeFile(new URL('role-boundary.json', outUrl), JSON.stringify({ synthetic_only: true,
    reviewed_sha: reviewedSha, real_isolated_D1: true,
    rows, ledger_count: ledgerCount, ...totals }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...totals, ledger_count: ledgerCount }));
  if (totals.FAIL) process.exitCode = 1;
} finally { await f.dispose(); }
