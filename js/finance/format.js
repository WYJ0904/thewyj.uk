import { currencyDigits, moneyText } from './money.js';
const moneyFormatters = new Map();
export function formatFinanceMoney(minor, currency = 'CNY') {
  try {
    const digits = currencyDigits(currency);
    const amount = moneyText(minor ?? 0, currency);
    let formatter = moneyFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
      moneyFormatters.set(currency, formatter);
    }
    return formatter.format(amount);
  } catch (_) { return `${currency || '未知币种'} · 金额单位待核实`; }
}
