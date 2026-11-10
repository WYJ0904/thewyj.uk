import assert from 'node:assert/strict';
import { parseMoney, moneyText, convertMinor, convertCrossMinor, referenceValue, validRateDate } from '../../js/finance/money.js';
import { formatFinanceMoney, calculateFinanceSummary } from '../../js/finance/app.js';

let count = 0;
const check = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
for (const currency of ['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'JPY']) {
  const digits = currency === 'JPY' ? 0 : 2;
  for (const value of ['0', '1', '-1', '99999999999', ...(digits ? ['0.01', '-0.29', '123.45'] : [])]) {
    check(`${currency} ${value} exact unit round trip`, () => {
      const minor = parseMoney(value, currency);
      assert.equal(parseMoney(moneyText(minor, currency), currency), minor);
      assert.equal(minor, Number(BigInt(value.replace('.', '').replace(/^\+/, '')) * (value.includes('.') ? 1n : BigInt(10 ** digits))));
    });
  }
  check(`${currency} rejects excess precision`, () => assert.throws(() => parseMoney(digits ? '1.001' : '1.0', currency), /./));
}
for (const value of ['', 'NaN', 'Infinity', '1e3', '1,000', '01', '1x', '--1', '9007199254740992']) check(`invalid amount ${value}`, () => assert.throws(() => parseMoney(value, 'CNY')));
check('unknown currency cannot default to CNY', () => assert.throws(() => parseMoney('10', 'AUD')));
check('JPY formatting has no decimal scaling', () => assert.equal(formatFinanceMoney(12345, 'JPY'), new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(12345)));
check('half-even positive tie goes to even', () => { assert.equal(convertMinor(1, 'USD', 'CNY', '0.5'), 0); assert.equal(convertMinor(3, 'USD', 'CNY', '0.5'), 2); });
check('half-even negative refunds are symmetric', () => { assert.equal(convertMinor(-1, 'USD', 'CNY', '0.5'), 0); assert.equal(convertMinor(-3, 'USD', 'CNY', '0.5'), -2); });
check('JPY to CNY respects exponent change', () => assert.equal(convertMinor(10000, 'JPY', 'CNY', '0.05'), 50000));
check('CNY to JPY rounds only at the destination', () => assert.equal(convertMinor(12345, 'CNY', 'JPY', '20'), 2469));
check('cross rate avoids intermediate minor rounding', () => assert.equal(convertCrossMinor(101, 'USD', 'JPY', '2', '3'), 2));
check('inverse via exact cross quotient', () => assert.equal(convertCrossMinor(70000, 'CNY', 'USD', '7', '1'), 10000));
check('same currency requires no provider', () => assert.equal(convertMinor(123, 'JPY', 'JPY'), 123));
for (const rate of ['0', '-1', 'NaN', 'Infinity', '1/7', '1e99']) check(`invalid rate ${rate}`, () => assert.throws(() => convertMinor(100, 'USD', 'CNY', rate)));
check('overflow fails instead of producing imprecise money', () => assert.throws(() => convertMinor(Number.MAX_SAFE_INTEGER, 'USD', 'CNY', '2')));
check('invalid calendar date', () => assert.throws(() => validRateDate('2026-02-30')));
const row = (id, currency, amount, extra = {}) => ({ id, currency, amount_minor: amount, direction: 'expense', status: 'active', occurred_at_ms: Date.UTC(2026, 9, 18, 12), ...extra });
check('unpriced currencies remain separate', () => {
  const result = calculateFinanceSummary([row('cny', 'CNY', 10000), row('usd', 'USD', 10000)]);
  assert.equal(result.expense_minor, 10000); assert.equal(result.by_currency.USD.expense_minor, 10000); assert.equal(result.conversion_status, 'missing_historical_rate');
});
check('dated reference converts without changing original facts', () => {
  const transactions = [row('cny', 'CNY', 10000), row('usd', 'USD', 10000)]; const before = structuredClone(transactions);
  const result = calculateFinanceSummary(transactions, { display_currency: 'CNY', rate_snapshot: { date: '2026-10-18', rates: { USD: '7' } } });
  assert.equal(result.expense_minor, 80000); assert.deepEqual(transactions, before);
});
check('today rate cannot silently replace a historical snapshot', () => {
  const transaction = row('history', 'USD', 10000, { fx_snapshot: { date: '2026-10-18', rate: '7', display_currency: 'CNY', converted_minor: 70000 } });
  assert.equal(calculateFinanceSummary([transaction], { display_currency: 'CNY', as_of: '2026-10-19', rates: { USD: '7.2' } }).expense_minor, 70000);
});
check('expired rate is not 1:1', () => assert.equal(referenceValue(row('stale', 'USD', 100), 'CNY', { snapshots: { 'stale:0:CNY': { base: 'USD', quote: 'CNY', rate: '7', stale: true } } }).status, 'fx_rate_expired'));
check('legacy JPY units require review', () => assert.equal(referenceValue(row('old', 'JPY', 100, { money_unit_status: 'review_required' }), 'JPY').status, 'currency_unit_review_required'));
console.log(JSON.stringify({ suite: 'P04 exact monetary units and projections', PASS: count }));
