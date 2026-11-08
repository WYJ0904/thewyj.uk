import { currencyDigits, moneyText, SUPPORTED_CURRENCIES } from './money.js?v=20261031-aeris-p0-finance-r2';
const moneyFormatters = new Map();
export function formatFinanceMoney(minor, currency) {
  try {
    if (!currency || !SUPPORTED_CURRENCIES.includes(currency)) {
      return `${currency || '未知币种'} · 金额单位待核实`;
    }
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
