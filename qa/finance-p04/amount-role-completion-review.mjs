import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';

const reviewedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const cases = [
  { id: 'estimated-deduction-is-not-completed-fee', text: '已扣款，预计扣除手续费 USD2.00', expected: null },
  { id: 'fee-with-unpaid-suffix-is-not-completed', text: '已扣款，手续费 USD2.00 待扣', expected: null },
  { id: 'other-order-completion-cannot-authorize-projected-payment', text: '余额 USD100.00，预计付款 USD10.00，另一订单支付成功', expected: null },
  { id: 'additional-fee-without-independent-completion-remains-reviewable', text: '支付成功 USD100.00，另扣手续费 USD2.00', expected: null },
  { id: 'actually-deducted-fee-positive-control', text: '已扣款，手续费 USD2.00', expected: 200 },
  { id: 'included-fee-books-main-amount-once', text: '已扣款 USD100.00，含手续费 USD2.00', expected: 10000 },
];
const f = await fixture(), rows = [];
try {
  for (const [i, scenario] of cases.entries()) {
    const payload = { source_type: 'notification', source_provider: 'synthetic-role-completion',
      source_event_id: `synthetic-role-completion-${i}`, provider_reference: `SYNTH-ROLE-COMPLETE-${i}`,
      occurred_at_ms: 1000, captured_at_ms: 1000, text: scenario.text };
    const request = delivery => ({ schema_version: 1, device_id: 'synthetic-role-completion-device', platform: 'web',
      since_version: 0, operations: [{ operation_id: `synthetic-role-completion-${i}-${delivery}`, type: 'raw_event.ingest', payload }] });
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
        assert.equal(first.transaction_id, '', 'Unproven local completion/extra fee must remain pending');
        assert.equal(first.raw_event.classification, 'pending');
        assert.equal(persisted, null);
      } else {
        assert.ok(first.transaction_id);
        assert.equal(persisted.amount_minor, scenario.expected);
        assert.equal(persisted.currency, 'USD');
      }
    } catch (failure) { status = 'FAIL'; error = failure.stack; }
    rows.push({ id: scenario.id, status, actual, ...(error ? { error } : {}) });
    console.log(status, scenario.id, JSON.stringify(actual));
  }
  const ledgerCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
  const totals = { PASS: rows.filter(row => row.status === 'PASS').length, FAIL: rows.filter(row => row.status === 'FAIL').length };
  await writeFile(new URL('completion-boundary.json', outUrl), JSON.stringify({ reviewed_sha: reviewedSha,
    synthetic_only: true, real_isolated_D1: true, rows, ledger_count: ledgerCount,
    expected_ledger_count: cases.filter(row => row.expected !== null).length, ...totals }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reviewed_sha: reviewedSha, ...totals, ledger_count: ledgerCount }));
  if (totals.FAIL) process.exitCode = 1;
} finally { await f.dispose(); }
