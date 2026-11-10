import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
import { parseAmountFacts } from '../../functions/_lib/finance-amount-admission.mjs';

const reviewedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const source = await readFile(new URL('../../functions/_lib/finance-amount-admission.mjs', import.meta.url), 'utf8');
const declaration = source.split(/\r?\n/).find(line => line.startsWith('const OPERATION_MARKER_REGEX = '));
const literal = declaration.slice('const OPERATION_MARKER_REGEX = '.length).replace(/;\s*$/, '');
const lastSlash = literal.lastIndexOf('/');
const independentRegex = new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
const isolatedRegexTrace = [];
for (let i = 0; i < 3; i++) {
  const before = independentRegex.lastIndex, matched = independentRegex.test('上一笔');
  isolatedRegexTrace.push({ before, matched, after: independentRegex.lastIndex });
}
// The isolated regex demonstrates JS state only. It does not establish a
// reachable admission defect in the product's private regex instance.
assert.deepEqual(isolatedRegexTrace.map(row => row.matched), [true, false, true]);

const scenarios = [
  { id: 'same-operation-completion', text: '本次付款金额 USD10.00，支付成功', decision: 'AUTO', amount: 1000 },
  { id: 'other-payment-operation', text: '本次付款金额 USD10.00，上一笔支付成功', decision: 'REVIEW' },
  { id: 'other-refund-operation', text: '本次收款金额 EUR10.00，上一笔退款成功', decision: 'REVIEW' },
];
const parserReference = scenarios.map(scenario => JSON.stringify(parseAmountFacts(scenario.text)));
const parserRows = [];
for (let round = 0; round < 12; round++) for (const [i, scenario] of scenarios.entries()) {
  const parsed = parseAmountFacts(scenario.text);
  const stable = JSON.stringify(parsed) === parserReference[i];
  parserRows.push({ round, id: scenario.id, decision: parsed.admission.decision, stable });
  assert.equal(parsed.admission.decision, scenario.decision);
  assert.ok(stable, 'Identical input must preserve admission, spans and operation scopes');
}

const f = await fixture(), rows = [];
try {
  for (let round = 0; round < 3; round++) for (const scenario of scenarios) {
    const tag = `${round}-${scenario.id}`;
    const payload = { source_type: 'notification', source_provider: 'synthetic-regex-state',
      source_event_id: `synthetic-regex-${tag}`, provider_reference: `SYNTH-REGEX-${tag}`,
      occurred_at_ms: 1000, captured_at_ms: 1000, text: scenario.text };
    const request = delivery => ({ schema_version: 1, device_id: 'synthetic-regex-state-device', platform: 'web',
      since_version: 0, operations: [{ operation_id: `synthetic-regex-${tag}-${delivery}`, type: 'raw_event.ingest', payload }] });
    const first = (await syncFinance(f.db, f.account, request('first'))).operation_results[0];
    const replay = (await syncFinance(f.db, f.account, request('replay'))).operation_results[0];
    const persisted = first.transaction_id ? await f.db.prepare(
      'SELECT id,currency,amount_minor,direction,source_kind,revision FROM task16_finance_transactions WHERE id=?1',
    ).bind(first.transaction_id).first() : null;
    let status = 'PASS', error;
    try {
      assert.equal(replay.raw_event.id, first.raw_event.id);
      assert.equal(replay.transaction_id, first.transaction_id);
      if (scenario.decision === 'AUTO') {
        assert.ok(persisted); assert.equal(persisted.currency, 'USD');
        assert.equal(persisted.amount_minor, scenario.amount); assert.equal(persisted.direction, 'expense');
      } else {
        assert.equal(first.transaction_id, ''); assert.equal(first.raw_event.classification, 'pending');
      }
    } catch (failure) { status = 'FAIL'; error = failure.stack; }
    rows.push({ round, id: scenario.id, payload, status, raw_id: first.raw_event.id,
      classification: first.raw_event.classification, transaction_id: first.transaction_id, persisted,
      replay_raw_id: replay.raw_event.id, replay_transaction_id: replay.transaction_id, ...(error ? { error } : {}) });
    console.log(status, tag, JSON.stringify(rows.at(-1)));
  }
  const ledgerCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_transactions').first()).n;
  const rawCount = (await f.db.prepare('SELECT COUNT(*) n FROM task16_finance_raw_events').first()).n;
  assert.equal(ledgerCount, 3); assert.equal(rawCount, 9);
  const totals = { PASS: rows.filter(row => row.status === 'PASS').length, FAIL: rows.filter(row => row.status === 'FAIL').length };
  await writeFile(new URL('operation-regex-state.json', outUrl), JSON.stringify({ reviewed_sha: reviewedSha,
    isolated_regex_trace: isolatedRegexTrace, isolated_trace_is_not_product_reproduction: true,
    parser_calls: parserRows.length, parser_rows: parserRows, synthetic_only: true, real_isolated_D1: true,
    rows, ledger_count: ledgerCount, raw_count: rawCount, ...totals }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reviewed_sha: reviewedSha, parser_calls: parserRows.length, ...totals, ledger_count: ledgerCount, raw_count: rawCount }));
  if (totals.FAIL) process.exitCode = 1;
} finally { await f.dispose(); }
