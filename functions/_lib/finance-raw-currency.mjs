// Exact units for the inherited raw-event transport. No identity inference or FX.
import { currencyDigits } from '../../js/finance/money.js';
import { parseAmountFacts } from './finance-amount-admission.mjs';

export { parseAmountFacts };

export function rawCurrencyMoney(value, text, defaultCurrency = null) {
  const declared = typeof value?.currency === 'string' && value.currency.trim() ? value.currency.trim().toUpperCase() : null;
  const pending = (reason, cur = 'XXX') => {
    const res = { currency: cur, amount_minor: 0, review_reason: reason };
    Object.defineProperty(res, 'admission_decision', { value: 'REVIEW', enumerable: false, configurable: true });
    Object.defineProperty(res, 'direction', { value: 'unknown', enumerable: false, configurable: true });
    return res;
  };

  if (value?.currency != null && typeof value.currency !== 'string') {
    return pending('currency_review_required');
  }

  // Legacy import branch (no text)
  if (value?.source_type === 'legacy_import' && !text) {
    const currency = declared || defaultCurrency || 'XXX';
    let exponent;
    try { exponent = currencyDigits(currency); }
    catch { return pending('currency_review_required', currency); }
    if (!Number.isSafeInteger(value.amount_minor) || value.amount_minor <= 0 || (currency === 'JPY' && value.amount_exponent !== 0)) {
      return pending('currency_unit_review_required', currency);
    }
    const res = {
      currency,
      amount_minor: value.amount_minor,
      amount_exponent: exponent,
    };
    Object.defineProperty(res, 'admission_decision', { value: 'AUTO', enumerable: false, configurable: true });
    Object.defineProperty(res, 'direction', { value: value.direction || 'expense', enumerable: false, configurable: true });
    return res;
  }

  // Pre-checks on text format
  if (/\d(?:\.\d+)?[eE][+-]?\d/.test(text)) return pending('amount_invalid');
  for (const hit of String(value?.text || '').matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    if (hit[0].includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(hit[0])) return pending('amount_invalid');
  }
  if (/(?:^|[^\d])-\d/.test(text)) return pending('amount_invalid');

  // Unified facts and admission parsing
  const parsed = parseAmountFacts(text, { declaredCurrency: declared, defaultCurrency });
  const admission = parsed.admission;

  let currency = admission.currency;
  if (!currency || currency === 'XXX') {
    currency = declared || (defaultCurrency && ['CNY', 'JPY', 'USD', 'EUR', 'HKD', 'GBP'].includes(defaultCurrency) ? defaultCurrency : 'XXX');
  }

  if (admission.decision === 'AUTO') {
    let exponent;
    try { exponent = currencyDigits(admission.currency); }
    catch { return pending('currency_review_required', admission.currency); }

    if (value?.amount_minor !== undefined && value.amount_minor !== 0 && (!Number.isSafeInteger(value.amount_minor) || value.amount_minor !== admission.amount_minor)) {
      return pending('amount_conflict', admission.currency);
    }
    if (admission.amount_minor <= 0 || admission.amount_minor > 10000000000000) {
      return pending('amount_invalid', admission.currency);
    }
    if (value?.amount_exponent !== undefined && value.amount_exponent !== exponent) {
      return pending('currency_unit_review_required', admission.currency);
    }

    const res = {
      currency: admission.currency,
      amount_minor: admission.amount_minor,
      amount_exponent: exponent,
      ...(admission.currency_review_required ? {
        currency_review_required: true,
        currency_decision_source: 'account_default',
      } : {}),
    };
    Object.defineProperty(res, 'admission_decision', { value: 'AUTO', enumerable: false, configurable: true });
    Object.defineProperty(res, 'direction', { value: admission.direction, enumerable: false, configurable: true });
    Object.defineProperty(res, 'target_fact', { value: admission.target_fact, enumerable: false, configurable: true });
    Object.defineProperty(res, 'facts', { value: parsed.facts, enumerable: false, configurable: true });
    return res;
  }

  // Non-AUTO: REVIEW or NON_FINANCIAL
  const pendingCurrency = (admission.currency && admission.currency !== 'XXX') ? admission.currency : (declared || 'XXX');
  const res = {
    currency: pendingCurrency,
    amount_minor: 0,
    review_reason: admission.reason,
  };
  Object.defineProperty(res, 'admission_decision', { value: admission.decision, enumerable: false, configurable: true });
  Object.defineProperty(res, 'direction', { value: admission.direction || 'unknown', enumerable: false, configurable: true });
  Object.defineProperty(res, 'facts', { value: parsed.facts, enumerable: false, configurable: true });
  return res;
}
