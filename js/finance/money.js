// Exact monetary units and reference conversions. No ledger mutation or identity.
export const MONEY_VERSION = 2;
export const CURRENCY_DIGITS = Object.freeze({ CNY: 2, USD: 2, EUR: 2, HKD: 2, GBP: 2, JPY: 0 });
export const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(CURRENCY_DIGITS));
export const MONEY_ROUNDING = 'HALF_EVEN';
const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export class MoneyError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
export function currencyDigits(currency) {
  if (!Object.hasOwn(CURRENCY_DIGITS, currency)) throw new MoneyError('currency_unsupported', '请选择支持的币种');
  return CURRENCY_DIGITS[currency];
}
export function minorInteger(value) {
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new MoneyError('amount_invalid');
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new MoneyError('amount_invalid');
  const n = BigInt(value);
  if (n > MAX_MINOR || n < -MAX_MINOR) throw new MoneyError('amount_overflow');
  return n;
}
export function parseMoney(value, currency) {
  const digits = currencyDigits(currency);
  const text = String(value ?? '').trim();
  const match = /^(-?)(0|[1-9]\d{0,15})(?:\.(\d+))?$/.exec(text);
  if (!match) throw new MoneyError('amount_invalid', '金额格式无效');
  const fraction = match[3] || '';
  if (fraction.length > digits) throw new MoneyError('amount_precision', `${currency} 只允许 ${digits} 位小数`);
  const result = (BigInt(match[2]) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')) * (match[1] ? -1n : 1n);
  return Number(minorInteger(result));
}
export function moneyText(value, currency) {
  const digits = currencyDigits(currency), n = minorInteger(value), abs = n < 0n ? -n : n;
  const factor = 10n ** BigInt(digits);
  return `${n < 0n ? '-' : ''}${abs / factor}${digits ? '.' + (abs % factor).toString().padStart(digits, '0') : ''}`;
}
export function rateFraction(rate) {
  const match = /^(\d{1,24})(?:\.(\d{1,18}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(String(rate));
  if (!match) throw new MoneyError('fx_rate_invalid');
  const exponent = Number(match[3] || 0), fraction = match[2] || '';
  if (Math.abs(exponent) > 18) throw new MoneyError('fx_rate_invalid');
  let numerator = BigInt(match[1] + fraction), denominator = 10n ** BigInt(fraction.length);
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator *= 10n ** BigInt(-exponent);
  if (numerator <= 0n || numerator > denominator * 1_000_000_000_000n) throw new MoneyError('fx_rate_invalid');
  return { numerator, denominator };
}
export function roundRatio(numerator, denominator) {
  if (denominator <= 0n) throw new MoneyError('fx_rate_invalid');
  const negative = numerator < 0n, absolute = negative ? -numerator : numerator;
  let rounded = absolute / denominator;
  const remainder = absolute % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && rounded % 2n === 1n)) rounded++;
  return negative ? -rounded : rounded;
}
export function convertMinor(amount, base, quote, rate) {
  const baseDigits = currencyDigits(base), quoteDigits = currencyDigits(quote);
  const source = minorInteger(amount);
  if (base === quote) return Number(source);
  const { numerator, denominator } = rateFraction(rate);
  return Number(minorInteger(roundRatio(source * numerator * 10n ** BigInt(quoteDigits), denominator * 10n ** BigInt(baseDigits))));
}
export function convertCrossMinor(amount, base, quote, baseRate, quoteRate) {
  const a = rateFraction(baseRate), b = rateFraction(quoteRate);
  const numerator = minorInteger(amount) * b.numerator * a.denominator * 10n ** BigInt(currencyDigits(quote));
  const denominator = b.denominator * a.numerator * 10n ** BigInt(currencyDigits(base));
  return Number(minorInteger(roundRatio(numerator, denominator)));
}
export function validRateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new MoneyError('fx_date_invalid');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new MoneyError('fx_date_invalid');
  return value;
}
export function transactionRateDate(transaction) {
  const date = new Date(transaction.occurred_at_ms);
  if (!Number.isFinite(date.getTime())) throw new MoneyError('fx_date_invalid');
  return date.toISOString().slice(0, 10);
}
export function referenceValue(transaction, quote, options = {}) {
  try {
    currencyDigits(transaction.currency); currencyDigits(quote);
    if (transaction.money_unit_status === 'review_required') return { status: 'currency_unit_review_required' };
    const original = Number(minorInteger(transaction.amount_minor));
    if (transaction.currency === quote) return { status: 'same_currency', amount_minor: original, currency: quote };
    const date = transactionRateDate(transaction);
    const persisted = transaction.fx_snapshots?.[quote] || transaction.fx_snapshot;
    let snapshot = persisted?.display_currency === quote || persisted?.quote === quote ? persisted : null;
    if (!snapshot) snapshot = options.snapshots?.[`${transaction.id}:${transaction.revision || 0}:${quote}`];
    if (!snapshot && options.rate_snapshot?.date === date && options.rate_snapshot.rates?.[transaction.currency] !== undefined) {
      snapshot = { base: transaction.currency, quote, date, rate: String(options.rate_snapshot.rates[transaction.currency]), reference_only: true };
    }
    if (!snapshot) return { status: 'missing_historical_rate' };
    const observation = snapshot.rate_timestamp?.slice(0, 10) || snapshot.date;
    if (observation) {
      validRateDate(observation);
      const lag = (Date.parse(date) - Date.parse(observation)) / 86400000;
      if (lag < 0 || lag > 7) throw new MoneyError('fx_date_mismatch');
    }
    if (snapshot.base && snapshot.base !== transaction.currency) throw new MoneyError('fx_pair_invalid');
    if (snapshot.quote && snapshot.quote !== quote) throw new MoneyError('fx_pair_invalid');
    if (snapshot.original_minor !== undefined && snapshot.original_minor !== original) throw new MoneyError('fx_snapshot_mismatch');
    if (snapshot.transaction_revision !== undefined && snapshot.transaction_revision !== Number(transaction.revision || 0)) throw new MoneyError('fx_snapshot_mismatch');
    if (snapshot.requested_date && snapshot.requested_date !== date) throw new MoneyError('fx_snapshot_mismatch');
    if ((snapshot.stale === true || (snapshot.expires_at && Date.parse(snapshot.expires_at) <= (options.now ?? Date.now()))) && !snapshot.historical_reference) return { status: 'fx_rate_expired' };
    const converted = convertMinor(original, transaction.currency, quote, snapshot.rate);
    if (snapshot.converted_minor !== undefined && snapshot.converted_minor !== converted) throw new MoneyError('fx_snapshot_mismatch');
    return { status: 'reference', amount_minor: converted, currency: quote, snapshot };
  } catch (error) {
    return { status: error.code || 'amount_invalid' };
  }
}
