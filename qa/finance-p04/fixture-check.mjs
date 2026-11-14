import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
const f = await fixture();
try {
  const transaction = await f.transaction('JPY', 12345);
  assert.equal(transaction.amount_minor, 12345);
  assert.equal(transaction.amount_exponent, 0);
  assert.equal(transaction.money_unit_status, 'verified');
  console.log('PASS: full additive migration and exact JPY transaction through real D1');
} finally { await f.dispose(); }
