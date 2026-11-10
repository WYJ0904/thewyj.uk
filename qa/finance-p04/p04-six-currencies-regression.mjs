import assert from 'node:assert/strict';
import { CURRENCY_DIGITS, SUPPORTED_CURRENCIES, currencyDigits, parseMoney, moneyText, convertMinor, convertCrossMinor, referenceValue, validRateDate } from '../../js/finance/money.js';
import { formatFinanceMoney } from '../../js/finance/format.js';
import { calculateFinanceSummary } from '../../js/finance/app.js';
import { explicitCurrencyCodes, hasAmbiguousCurrencySymbol } from '../../functions/_lib/payment-currency-evidence.mjs';
import { rawCurrencyMoney } from '../../functions/_lib/finance-raw-currency.mjs';

let count = 0;
function check(name, run) {
  run();
  count++;
  console.log(`PASS ${name}`);
}

console.log('--- Suite 1: Six Currencies Display & Input Precision ---');

check('CURRENCY_DIGITS strictly defines the six approved currencies', () => {
  assert.deepEqual(Object.keys(CURRENCY_DIGITS).sort(), ['CNY', 'EUR', 'GBP', 'HKD', 'JPY', 'USD'].sort());
  assert.equal(CURRENCY_DIGITS.JPY, 0);
  assert.equal(CURRENCY_DIGITS.CNY, 2);
  assert.equal(CURRENCY_DIGITS.USD, 2);
  assert.equal(CURRENCY_DIGITS.EUR, 2);
  assert.equal(CURRENCY_DIGITS.HKD, 2);
  assert.equal(CURRENCY_DIGITS.GBP, 2);
});

check('JPY rejects any decimal digits (zero-decimal unit enforcement)', () => {
  assert.equal(parseMoney('100', 'JPY'), 100);
  assert.equal(parseMoney('0', 'JPY'), 0);
  assert.equal(parseMoney('123456789', 'JPY'), 123456789);
  assert.throws(() => parseMoney('100.5', 'JPY'), err => err.code === 'amount_precision' && /只允许 0 位小数/.test(err.message));
  assert.throws(() => parseMoney('100.0', 'JPY'), err => err.code === 'amount_precision' && /只允许 0 位小数/.test(err.message));
  assert.throws(() => parseMoney('100.00', 'JPY'), err => err.code === 'amount_precision' && /只允许 0 位小数/.test(err.message));
  assert.throws(() => parseMoney('0.01', 'JPY'), err => err.code === 'amount_precision' && /只允许 0 位小数/.test(err.message));
});

check('Non-JPY currencies (CNY, USD, EUR, HKD, GBP) allow up to 2 decimals and reject excess precision', () => {
  for (const currency of ['CNY', 'USD', 'EUR', 'HKD', 'GBP']) {
    assert.equal(parseMoney('100', currency), 10000);
    assert.equal(parseMoney('100.5', currency), 10050);
    assert.equal(parseMoney('100.55', currency), 10055);
    assert.equal(parseMoney('0.01', currency), 1);
    assert.throws(() => parseMoney('100.001', currency), err => err.code === 'amount_precision' && /只允许 2 位小数/.test(err.message));
    assert.throws(() => parseMoney('100.555', currency), err => err.code === 'amount_precision' && /只允许 2 位小数/.test(err.message));
  }
});

check('moneyText correctly converts minor units to canonical decimal text without binary floating artifacts', () => {
  assert.equal(moneyText(10000, 'CNY'), '100.00');
  assert.equal(moneyText(10050, 'USD'), '100.50');
  assert.equal(moneyText(1, 'EUR'), '0.01');
  assert.equal(moneyText(0, 'GBP'), '0.00');
  assert.equal(moneyText(-29, 'HKD'), '-0.29');
  assert.equal(moneyText(12345, 'JPY'), '12345');
  assert.equal(moneyText(0, 'JPY'), '0');
  assert.equal(moneyText(-100, 'JPY'), '-100');
});

check('formatFinanceMoney formats six currencies cleanly and safely', () => {
  assert.match(formatFinanceMoney(10000, 'CNY'), /100\.00/);
  assert.match(formatFinanceMoney(10000, 'USD'), /100\.00/);
  assert.match(formatFinanceMoney(10000, 'EUR'), /100\.00/);
  assert.match(formatFinanceMoney(10000, 'GBP'), /100\.00/);
  assert.match(formatFinanceMoney(10000, 'HKD'), /100\.00/);
  // JPY must have NO decimal point in output
  const jpyFormatted = formatFinanceMoney(12345, 'JPY');
  assert.doesNotMatch(jpyFormatted, /\./);
  assert.match(jpyFormatted, /12,345/);
});

check('formatFinanceMoney with unknown or missing currency never defaults to CNY', () => {
  assert.equal(formatFinanceMoney(100, undefined), '未知币种 · 金额单位待核实');
  assert.equal(formatFinanceMoney(100, null), '未知币种 · 金额单位待核实');
  assert.equal(formatFinanceMoney(100, ''), '未知币种 · 金额单位待核实');
  assert.equal(formatFinanceMoney(100, 'XXX'), 'XXX · 金额单位待核实');
  assert.equal(formatFinanceMoney(100, 'AUD'), 'AUD · 金额单位待核实');
});

console.log('--- Suite 2: Currency Symbols & Ambiguity Detection ---');

check('Ambiguous symbol ¥/￥ alone is not mapped to CNY or JPY', () => {
  assert.deepEqual(explicitCurrencyCodes('已扣款 ¥100.00'), []);
  assert.deepEqual(explicitCurrencyCodes('付款金额：￥50.00'), []);
  assert.deepEqual(explicitCurrencyCodes('消费 ¥ 12345'), []);
  assert.equal(hasAmbiguousCurrencySymbol('已扣款 ¥100.00'), true);
  assert.equal(hasAmbiguousCurrencySymbol('付款金额：￥50.00'), true);
});

check('Ambiguous symbol $ alone is not mapped to USD or HKD', () => {
  assert.deepEqual(explicitCurrencyCodes('已扣款 $100.00'), []);
  assert.deepEqual(explicitCurrencyCodes('支付金额 $50'), []);
  assert.equal(hasAmbiguousCurrencySymbol('已扣款 $100.00'), true);
});

check('Disambiguated text properly identifies explicit currency codes', () => {
  assert.deepEqual(explicitCurrencyCodes('已扣款 人民币 100.00'), ['CNY']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 100.00 元'), ['CNY']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 RMB 100.00'), ['CNY']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 US$ 100.00'), ['USD']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 美元 100.00'), ['USD']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 € 100.00'), ['EUR']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 欧元 100.00'), ['EUR']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 £ 100.00'), ['GBP']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 英镑 100.00'), ['GBP']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 HK$ 100.00'), ['HKD']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 港币 100.00'), ['HKD']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 JP¥ 10000'), ['JPY']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 日元 10000'), ['JPY']);
  assert.deepEqual(explicitCurrencyCodes('已扣款 10000 円'), ['JPY']);
  assert.equal(hasAmbiguousCurrencySymbol('已扣款 人民币 100.00'), false);
  assert.equal(hasAmbiguousCurrencySymbol('已扣款 US$ 100.00'), false);
  assert.equal(hasAmbiguousCurrencySymbol('已扣款 JP¥ 10000'), false);
});

check('rawCurrencyMoney holds unresolvable ¥ as XXX pending review, never auto-CNY', () => {
  const result = rawCurrencyMoney({ source_type: 'notification' }, '已扣款 ¥100.00', null);
  assert.equal(result.currency, 'XXX');
  assert.equal(result.amount_minor, 0);
  assert.equal(result.review_reason, 'currency_review_required');
});

check('rawCurrencyMoney with ¥ and incompatible declared currency enters review', () => {
  const result = rawCurrencyMoney({ source_type: 'notification', currency: 'USD' }, '已扣款 ¥100.00', null);
  assert.equal(result.review_reason, 'currency_review_required');
});

check('rawCurrencyMoney with account default currency explicitly records default provenance and review required', () => {
  const result = rawCurrencyMoney({ source_type: 'notification' }, '已扣款 100.00', 'USD');
  assert.equal(result.currency, 'USD');
  assert.equal(result.amount_minor, 10000);
  assert.equal(result.currency_review_required, true);
  assert.equal(result.currency_decision_source, 'account_default');
});

console.log('--- Suite 3: FX Snapshot, Conversion, Rounding & Aggregation ---');

const baseTx = (id, currency, amount, extra = {}) => ({
  id, currency, amount_minor: amount, direction: 'expense', status: 'active',
  occurred_at_ms: Date.UTC(2026, 9, 19, 12), ...extra
});

check('referenceValue returns missing_historical_rate when no snapshot exists for quote', () => {
  const tx = baseTx('t1', 'USD', 10000);
  const result = referenceValue(tx, 'CNY', {});
  assert.equal(result.status, 'missing_historical_rate');
});

check('referenceValue returns fx_rate_expired when snapshot is stale or expired', () => {
  const tx = baseTx('t2', 'USD', 10000);
  const staleSnapshot = { base: 'USD', quote: 'CNY', rate: '7.0', stale: true, date: '2026-10-19' };
  const resultStale = referenceValue(tx, 'CNY', { snapshots: { 't2:0:CNY': staleSnapshot } });
  assert.equal(resultStale.status, 'fx_rate_expired');

  const expiredSnapshot = { base: 'USD', quote: 'CNY', rate: '7.0', expires_at: '2026-10-18T00:00:00Z', date: '2026-10-19' };
  const resultExpired = referenceValue(tx, 'CNY', { snapshots: { 't2:0:CNY': expiredSnapshot }, now: Date.UTC(2026, 9, 20) });
  assert.equal(resultExpired.status, 'fx_rate_expired');
});

check('referenceValue converts accurately with valid snapshot and retains historical facts', () => {
  const tx = baseTx('t3', 'USD', 10000);
  const validSnapshot = { base: 'USD', quote: 'CNY', rate: '7.0', date: '2026-10-19', rate_timestamp: '2026-10-19', original_minor: 10000 };
  const result = referenceValue(tx, 'CNY', { snapshots: { 't3:0:CNY': validSnapshot } });
  assert.equal(result.status, 'reference');
  assert.equal(result.amount_minor, 70000);
  assert.equal(result.currency, 'CNY');
});

check('convertCrossMinor avoids binary floating point error and premature minor rounding', () => {
  // USD -> EUR via base USD rate 7.0 and quote EUR rate 7.7 (EUR/USD = 1.1)
  const converted = convertCrossMinor(10000, 'USD', 'EUR', '7.0', '7.7');
  assert.equal(converted, 11000);

  // Exact inverse cross quotient
  const inverse = convertCrossMinor(70000, 'CNY', 'USD', '7', '1');
  assert.equal(inverse, 10000);

  // JPY exponent adjustment in cross rate
  const jpyToUsd = convertCrossMinor(10000, 'JPY', 'USD', '150', '1');
  assert.equal(jpyToUsd, 6667); // 10000 / 150 = 66.666... -> 66.67 USD (6667 cents)
});

check('calculateFinanceSummary aggregates multi-currency with accurate safety statuses', () => {
  // Scenario A: Missing FX rates
  const mixedMissing = [baseTx('m1', 'CNY', 10000), baseTx('m2', 'USD', 5000)];
  const summaryMissing = calculateFinanceSummary(mixedMissing, { display_currency: 'CNY' });
  assert.equal(summaryMissing.expense_minor, 10000); // only converted CNY is summed
  assert.equal(summaryMissing.unconverted.length, 1);
  assert.equal(summaryMissing.unconverted[0].reason, 'missing_historical_rate');
  assert.equal(summaryMissing.conversion_status, 'missing_historical_rate');

  // Scenario B: Expired FX rate
  const expiredSnapshot = { 'e1:0:CNY': { base: 'USD', quote: 'CNY', rate: '7.0', stale: true, date: '2026-10-19' } };
  const mixedExpired = [baseTx('e1', 'USD', 5000)];
  const summaryExpired = calculateFinanceSummary(mixedExpired, { display_currency: 'CNY', snapshots: expiredSnapshot });
  assert.equal(summaryExpired.unconverted.length, 1);
  assert.equal(summaryExpired.unconverted[0].reason, 'fx_rate_expired');
  assert.equal(summaryExpired.conversion_status, 'fx_rate_expired');

  // Scenario C: JPY unit review required
  const unreviewedJpy = [baseTx('j1', 'JPY', 10000, { money_unit_status: 'review_required' })];
  const summaryJpy = calculateFinanceSummary(unreviewedJpy, { display_currency: 'JPY' });
  assert.equal(summaryJpy.unconverted.length, 1);
  assert.equal(summaryJpy.unconverted[0].reason, 'currency_unit_review_required');
});

console.log('--- Suite 4: Duplicate Replay Protection & Idempotency ---');

check('Replaying identical transaction does not double count in calculateFinanceSummary', () => {
  const tx1 = baseTx('dup1', 'CNY', 10000);
  const txList = [tx1];
  const summary1 = calculateFinanceSummary(txList, { display_currency: 'CNY' });
  assert.equal(summary1.expense_minor, 10000);

  // A deduped list by ID retains single transaction
  const deduped = Object.values({ [tx1.id]: tx1, [tx1.id]: tx1 });
  const summary2 = calculateFinanceSummary(deduped, { display_currency: 'CNY' });
  assert.equal(summary2.expense_minor, 10000);
});

console.log('--- Suite 5: Legacy Compatibility & UI Safe Warning Text ---');

check('Legacy transactions without verified unit status require review', () => {
  const legacyJpy = baseTx('leg1', 'JPY', 12345, { money_unit_status: 'review_required' });
  const ref = referenceValue(legacyJpy, 'JPY');
  assert.equal(ref.status, 'currency_unit_review_required');
});

check('Summary text reflects accurate safety reasons for unconverted items', () => {
  const summaryWithExpired = {
    unconverted: [{ id: '1', currency: 'USD', reason: 'fx_rate_expired' }],
    expense_minor: 10000
  };
  const reasons = [];
  if (summaryWithExpired.unconverted.some(u => u.reason === 'fx_rate_expired')) reasons.push('汇率已过期');
  if (summaryWithExpired.unconverted.some(u => u.reason === 'missing_historical_rate')) reasons.push('缺少可用汇率');
  if (summaryWithExpired.unconverted.some(u => u.reason === 'currency_unit_review_required')) reasons.push('金额单位待核实');
  const reasonText = reasons.length ? `（${reasons.join('、')}）` : '';
  const statusLine = `${summaryWithExpired.unconverted.length} 笔待换算或单位待核实${reasonText}；上方仅汇总已核实部分。原币金额保留。`;
  assert.match(statusLine, /汇率已过期/);
  assert.match(statusLine, /待换算或单位待核实/);
});

console.log(`\n======================================================`);
console.log(`P04 Six Currencies & FX Deterministic Regression: ${count} PASS, 0 FAIL`);
console.log(`======================================================`);
