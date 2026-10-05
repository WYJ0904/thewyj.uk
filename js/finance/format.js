const moneyFormatters = new Map();
export function formatFinanceMoney(minor, currency = 'CNY') {
  const amount = Number(minor || 0) / 100;
  try {
    let formatter = moneyFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2 });
      moneyFormatters.set(currency, formatter);
    }
    return formatter.format(amount);
  } catch (_) { return `${amount.toFixed(2)} ${currency}`; }
}
