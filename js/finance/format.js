import { currencyDigits, moneyText, SUPPORTED_CURRENCIES } from './money.js?release=20261109-aeris-p07-production-r2';
const moneyFormatters = new Map();
export function formatFinanceMoney(minor, currency) {
  try {
    const effectiveCurrency = arguments.length < 2 ? 'CNY' : currency;
    if (!effectiveCurrency || !SUPPORTED_CURRENCIES.includes(effectiveCurrency)) {
      return `${effectiveCurrency || '未知币种'} · 金额单位待核实`;
    }
    const digits = currencyDigits(effectiveCurrency);
    const amount = moneyText(minor ?? 0, effectiveCurrency);
    let formatter = moneyFormatters.get(effectiveCurrency);
    if (!formatter) {
      formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: effectiveCurrency, minimumFractionDigits: digits, maximumFractionDigits: digits });
      moneyFormatters.set(effectiveCurrency, formatter);
    }
    return formatter.format(amount);
  } catch (_) { return `${currency || '未知币种'} · 金额单位待核实`; }
}
