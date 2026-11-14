import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { currencyPreferences } from '../../functions/_lib/finance-fx.mjs';

const reviewedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const matrixBytes = await readFile(new URL('./fixtures/semantic-contract-matrix.json', import.meta.url));
const matrix = JSON.parse(matrixBytes);
const cases = matrix.cases.map(values => Object.fromEntries(matrix.fields.map((field, i) => [field, values[i]])));
assert.equal(cases.length, 35);
assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
const f = await fixture(), rows = [];
try {
  for (const scenario of cases) {
    const preference = await currencyPreferences(f.db, f.account.id);
    if (preference.default_currency !== scenario.default_currency) {
      await currencyPreferences(f.db, f.account.id, { revision: preference.revision, default_currency: scenario.default_currency });
    }
    const payload = { source_type: 'notification', source_provider: 'synthetic-semantic-matrix',
      source_event_id: `synthetic-semantic-${scenario.id}`, provider_reference: `SYNTH-SEMANTIC-${scenario.id}`,
      occurred_at_ms: 1000, captured_at_ms: 1000, text: scenario.text };
    const request = delivery => ({ schema_version: 1, device_id: 'synthetic-semantic-matrix-device', platform: 'web',
      since_version: 0, operations: [{ operation_id: `synthetic-semantic-${scenario.id}-${delivery}`, type: 'raw_event.ingest', payload }] });
    const first = (await syncFinance(f.db, f.account, request('first'))).operation_results[0];
    const replay = (await syncFinance(f.db, f.account, request('replay'))).operation_results[0];
    const persisted = first.transaction_id ? await f.db.prepare(
      'SELECT id,currency,amount_minor,direction,source_kind,revision FROM task16_finance_transactions WHERE id=?1',
    ).bind(first.transaction_id).first() : null;
    const actual = { classification: first.raw_event.classification, reason: first.raw_event.classification_reason,
      raw_id: first.raw_event.id, transaction_id: first.transaction_id, persisted,
      replay_raw_id: replay.raw_event.id, replay_transaction_id: replay.transaction_id };
    let status = 'PASS', error;
    try {
      assert.equal(replay.raw_event.id, first.raw_event.id);
      assert.equal(replay.transaction_id, first.transaction_id);
      if (scenario.decision === 'AUTO') {
        assert.equal(first.raw_event.classification, 'accepted');
        assert.ok(first.transaction_id);
        assert.equal(persisted.amount_minor, scenario.amount_minor);
        assert.equal(persisted.currency, scenario.currency);
        assert.equal(persisted.direction, scenario.direction);
        if (scenario.default_currency) {
          assert.equal(first.transaction.currency_review_required, true);
          assert.equal(first.transaction.currency_decision_source, 'account_default');
        }
      } else {
        assert.equal(first.transaction_id, '', `${scenario.decision} must not create a formal transaction`);
        assert.equal(first.raw_event.classification, scenario.decision === 'REVIEW' ? 'pending' : 'rejected');
        assert.equal(persisted, null);
      }
    } catch (failure) { status = 'FAIL'; error = failure.stack; }
    rows.push({ ...scenario, status, actual, ...(error ? { error } : {}) });
    console.log(status, scenario.id, scenario.decision, JSON.stringify(actual));
  }
  const ledgerCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
  const rawCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_raw_events').first()).n;
  const replayCardinality = ledgerCount === rows.filter(row => row.actual.transaction_id).length && rawCount === cases.length;
  const totals = { tests: rows.length, PASS: rows.filter(row => row.status === 'PASS').length,
    FAIL: rows.filter(row => row.status === 'FAIL').length };
  await writeFile(new URL('semantic-contract-matrix.json', outUrl), JSON.stringify({ reviewed_sha: reviewedSha,
    matrix_sha256: createHash('sha256').update(matrixBytes).digest('hex'), synthetic_only: true, real_isolated_D1: true,
    rows, ledger_count: ledgerCount, expected_ledger_count: cases.filter(row => row.decision === 'AUTO').length,
    raw_count: rawCount, replay_cardinality_pass: replayCardinality, ...totals }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reviewed_sha: reviewedSha, ...totals, ledger_count: ledgerCount, replay_cardinality_pass: replayCardinality }));
  if (totals.FAIL || !replayCardinality) process.exitCode = 1;
} finally { await f.dispose(); }
