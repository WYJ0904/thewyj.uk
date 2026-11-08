// Currency cues only. No conversion, rate lookup or amount inference.
const core = new Set(['CNY','USD','EUR','HKD','GBP','JPY','AUD','CAD','BHD','CHF','SGD','NZD','KRW']);
const available = typeof Intl.supportedValuesOf === 'function' ? new Set(Intl.supportedValuesOf('currency')) : core;

export function hasAmbiguousCurrencySymbol(text) {
  const str = String(text || '');
  const hasYen = /[¥￥]/.test(str) && !/(?:JP[¥￥]|日元|日圓|円|人民币|人民幣|\bRMB\b|\d\s*元)/i.test(str);
  const hasDollar = /(?<!(?:US|HK|CA|AU))\$/i.test(str) && !/(?:US\$|HK\$|CA\$|AU\$|美元|美金|港币|港幣|港元)/i.test(str);
  return hasYen || hasDollar;
}

export function explicitCurrencyCodes(text) {
  const codes = new Set();
  const str = String(text || '');
  const pattern = /(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g;
  for (const hit of str.matchAll(pattern)) {
    const code = hit[1].toUpperCase();
    if (!available.has(code) && !core.has(code)) continue;
    const before = str.slice(0, hit.index), after = str.slice(hit.index + 3);
    if (/^\s*[:：]?\s*\d/.test(after) || /\d[\d.,]*\s*$/.test(before) || /(?:币种|幣種|currency)\s*[:：]?\s*$/i.test(before)) codes.add(code);
  }
  if (/人民币|人民幣|\bRMB\b|\d\s*元/i.test(str)) codes.add('CNY');
  if (/€|欧元|歐元/i.test(str)) codes.add('EUR');
  if (/£|英镑|英鎊/i.test(str)) codes.add('GBP');
  if (/HK\$|港币|港幣|港元/i.test(str)) codes.add('HKD');
  if (/US\$|美元|美金/i.test(str)) codes.add('USD');
  if (/JP[¥￥]|日元|日圓|円/i.test(str)) codes.add('JPY');
  return [...codes];
}
