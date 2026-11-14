import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';

const reviewedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// Extended boundary scenarios requested by review specification:
// 1. Projected payment + another order completed (independent transaction boundary)
// 2. Separate fees with explicit / unproven indicators
// 3. Completion / pending marker placement before vs after the amount
// 4. Same numeric amounts in distinct orders
const cases = [
  // Category 1: Projected payment + another order completed
  { id: 'ext-projected-payment-with-prior-other-order-completion', text: '另一订单支付成功，预计付款 USD10.00', expected: null },
  { id: 'ext-projected-payment-with-prior-other-order-amount', text: '另一订单支付成功 USD50.00，本单预计付款 USD10.00', expected: null },

  // Category 2: Separate fees (另扣 / 另外收取 / 外加)
  { id: 'ext-separate-fee-with-additional-prefix', text: '支付成功 USD100.00，另外收取手续费 USD2.00', expected: null },
  { id: 'ext-separate-fee-with-extra-plus-prefix', text: '支付成功 USD100.00，外加手续费 USD2.00', expected: null },
  { id: 'ext-separate-fee-with-deduction-prefix', text: '已扣款 USD100.00，另外扣除手续费 USD2.00', expected: null },

  // Category 3: Marker placement before vs after amount
  { id: 'ext-completion-term-after-amount', text: 'USD100.00 支付成功', expected: 10000 },
  { id: 'ext-uncompleted-term-after-amount-with-deduction-context', text: '已扣款，USD10.00 待付款', expected: null },
  { id: 'ext-uncompleted-fee-after-amount-with-deduction-context', text: '已扣款，USD2.00 手续费待扣', expected: null },

  // Category 4: Same numeric amount in distinct orders
  { id: 'ext-same-amount-completed-and-projected-distinct-orders', text: '订单1支付成功 USD100.00，订单2待付款 USD100.00', expected: null },
  { id: 'ext-same-amount-two-completed-distinct-orders', text: '订单1支付成功 USD100.00 订单2支付成功 USD100.00', expected: null },
];

const f = await fixture(), rows = [];
try {
  for (const [i, scenario] of cases.entries()) {
    const payload = {
      source_type: 'notification',
      source_provider: 'synthetic-boundary-extension',
      source_event_id: `synthetic-boundary-ext-${i}`,
      provider_reference: `SYNTH-BOUND-EXT-${i}`,
      occurred_at_ms: 1000,
      captured_at_ms: 1000,
      text: scenario.text,
    };
    const request = delivery => ({
      schema_version: 1,
      device_id: 'synthetic-boundary-ext-device',
      platform: 'web',
      since_version: 0,
      operations: [{ operation_id: `synthetic-boundary-ext-${i}-${delivery}`, type: 'raw_event.ingest', payload }],
    });
    const first = (await syncFinance(f.db, f.account, request('first'))).operation_results[0];
    const replay = (await syncFinance(f.db, f.account, request('replay'))).operation_results[0];
    const persisted = first.transaction_id ? await f.db.prepare(
      'SELECT id,currency,amount_minor,source_kind,revision FROM task16_finance_transactions WHERE id=?1',
    ).bind(first.transaction_id).first() : null;
    const actual = {
      text: scenario.text,
      classification: first.raw_event.classification,
      reason: first.raw_event.classification_reason,
      raw_id: first.raw_event.id,
      transaction_id: first.transaction_id,
      persisted,
      replay_raw_id: replay.raw_event.id,
      replay_transaction_id: replay.transaction_id,
    };
    let status = 'PASS', error;
    try {
      assert.equal(replay.raw_event.id, first.raw_event.id);
      assert.equal(replay.transaction_id, first.transaction_id);
      if (scenario.expected === null) {
        assert.equal(first.transaction_id, '', 'Unproven boundary scenario must remain pending');
        assert.equal(first.raw_event.classification, 'pending');
        assert.equal(persisted, null);
      } else {
        assert.ok(first.transaction_id);
        assert.equal(persisted.amount_minor, scenario.expected);
        assert.equal(persisted.currency, 'USD');
      }
    } catch (failure) {
      status = 'FAIL';
      error = failure.stack;
    }
    rows.push({ id: scenario.id, status, actual, ...(error ? { error } : {}) });
    console.log(status, scenario.id, JSON.stringify(actual));
  }
  const ledgerCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
  const totals = {
    PASS: rows.filter(row => row.status === 'PASS').length,
    FAIL: rows.filter(row => row.status === 'FAIL').length,
  };
  await writeFile(
    new URL('boundary-extensions.json', outUrl),
    JSON.stringify({
      reviewed_sha: reviewedSha,
      synthetic_only: true,
      real_isolated_D1: true,
      rows,
      ledger_count: ledgerCount,
      expected_ledger_count: cases.filter(row => row.expected !== null).length,
      ...totals,
    }, null, 2) + '\n',
    { flag: 'wx' }
  );
  console.log(JSON.stringify({ reviewed_sha: reviewedSha, ...totals, ledger_count: ledgerCount }));
  if (totals.FAIL) process.exitCode = 1;
} finally {
  await f.dispose();
}
