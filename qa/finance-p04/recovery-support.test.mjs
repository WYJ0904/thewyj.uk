import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, normalized, differences, verifyEvidence, gateVerdict, exitCodeFor } from './recovery-support.mjs';

test('equal counts cannot hide changed money, identity, revision or relationship', () => {
  const before = normalized({ schema: [], sequence: [], tables: {
    transactions: [{ id: 'synthetic-transaction', amount_minor: 123, revision: 1 }],
    links: [{ transaction_id: 'synthetic-transaction', raw_event_id: 'synthetic-event' }],
  } });
  for (const mutate of [
    s => { s.tables.transactions[0].amount_minor++; },
    s => { s.tables.transactions[0].revision++; },
    s => { s.tables.transactions[0].id = 'synthetic-other-id'; },
    s => { s.tables.links[0].raw_event_id = 'synthetic-other-event'; },
  ]) {
    const after = structuredClone(before); mutate(after);
    const diff = differences(before, after);
    assert.equal(diff.length, 1); assert.equal(diff[0].before_count, diff[0].after_count);
    assert.notEqual(diff[0].before_sha256, diff[0].after_sha256);
    assert.equal(diff[0].added.length, 1); assert.equal(diff[0].removed.length, 1);
  }
});
test('row and property order changes do not report false data loss', () => {
  const one = { schema: [], sequence: [], tables: { t: [{ id: 'b', amount: 2 }, { id: 'a', amount: 1 }] } };
  const two = { schema: [], sequence: [], tables: { t: [{ amount: 1, id: 'a' }, { amount: 2, id: 'b' }] } };
  assert.deepEqual(differences(one, two), []);
  assert.equal(hash(normalized(one)), hash(normalized(two)));
});
test('schema, sequence and missing empty tables are material differences', () => {
  const before = { schema: [], sequence: [], tables: { empty: [] } };
  for (const after of [
    { ...before, tables: {} }, { ...before, sequence: [{ name: 't', seq: 5 }] },
    { ...before, schema: [{ type: 'table', name: 't', sql: 'CREATE TABLE t(id)' }] },
  ]) assert.equal(differences(before, after).length, 1);
});
test('missing, duplicate, failed and blocked checks cannot yield green evidence', () => {
  const required = ['one', 'two'];
  const row = (id, status = 'PASS') => ({ id, status });
  verifyEvidence({ rows: required.map(id => row(id)) }, 2, required);
  for (const rows of [[], [row('one')], [row('one'), row('one')], [row('one'), row('wrong')],
    [row('one'), row('two', 'FAIL')], [row('one'), row('two', 'BLOCKED')]]) {
    assert.throws(() => verifyEvidence({ rows }, 2, required));
  }
});
test('a failed child or missing suite forces a nonzero overall exit', () => {
  const good = [{ id: 'one', status: 'PASS', exit_code: 0 }, { id: 'two', status: 'PASS', exit_code: 0 }];
  const required = ['one', 'two'];
  assert.equal(exitCodeFor(gateVerdict(good, required)), 0);
  for (const suites of [[], good.slice(1), [good[0], good[0]], [good[0], { ...good[1], exit_code: 1 }],
    [good[0], { ...good[1], status: 'FAIL' }], [good[0], { ...good[1], status: 'BLOCKED' }]]) {
    assert.equal(exitCodeFor(gateVerdict(suites, required)), 1);
  }
  assert.equal(exitCodeFor('BLOCKED'), 2); assert.equal(exitCodeFor('unknown'), 1);
});
