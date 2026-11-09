// Currency cues only. No conversion, rate lookup or amount inference.
const core = new Set(['CNY','USD','EUR','HKD','GBP','JPY','AUD','CAD','BHD','CHF','SGD','NZD','KRW']);
const available = typeof Intl.supportedValuesOf === 'function' ? new Set(Intl.supportedValuesOf('currency')) : core;

export function hasAmbiguousCurrencySymbol(text) {
  const str = String(text || '');
  if (!/[$¥￥]/.test(str)) return false;

  const dollarMatches = [...str.matchAll(/\$/g)];
  for (const match of dollarMatches) {
    const idx = match.index;
    const prefix2 = str.slice(Math.max(0, idx - 2), idx).toUpperCase();
    if (['US', 'HK', 'CA', 'AU', 'NZ', 'SG'].includes(prefix2)) continue;
    const before = str.slice(Math.max(0, idx - 12), idx);
    if (/(?:USD|HKD|CAD|AUD|美元|美金|港币|港幣|港元)\s*[:：]?\s*$/i.test(before)) continue;
    const after = str.slice(idx + 1);
    if (/^\s*\d+[\d.,]*\s*(?:USD|HKD|CAD|AUD|美元|美金|港币|港幣|港元)(?![A-Za-z])/i.test(after)) continue;
    return true;
  }

  const yenMatches = [...str.matchAll(/[¥￥]/g)];
  for (const match of yenMatches) {
    const idx = match.index;
    const prefix2 = str.slice(Math.max(0, idx - 2), idx).toUpperCase();
    if (prefix2 === 'JP') continue;
    const before = str.slice(Math.max(0, idx - 12), idx);
    if (/(?:JPY|日元|日圓|CNY|RMB|人民币|人民幣)\s*[:：]?\s*$/i.test(before)) continue;
    const after = str.slice(idx + 1);
    if (/^\s*\d+[\d.,]*\s*(?:JPY|日元|日圓|円|CNY|RMB|人民币|人民幣|元)(?![A-Za-z])/i.test(after)) continue;
    return true;
  }

  return false;
}

export function explicitCurrencyCodes(text) {
  const codes = new Set();
  const str = String(text || '');
  const pattern = /(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g;
  for (const hit of str.matchAll(pattern)) {
    const code = hit[1].toUpperCase();
    if (!available.has(code) && !core.has(code)) continue;
    const before = str.slice(0, hit.index), after = str.slice(hit.index + 3);
    if (/^\s*[:：]?\s*[$¥￥€£]?\s*\d/.test(after) || /\d[\d.,]*\s*[$¥￥€£]?\s*$/.test(before) || /(?:币种|幣種|currency)\s*[:：]?\s*$/i.test(before)) codes.add(code);
  }
  if (/人民币|人民幣|\bRMB\b|\d\s*元/i.test(str)) codes.add('CNY');
  if (/€|欧元|歐元/i.test(str)) codes.add('EUR');
  if (/£|英镑|英鎊/i.test(str)) codes.add('GBP');
  if (/HK\$|港币|港幣|港元/i.test(str)) codes.add('HKD');
  if (/US\$|美元|美金/i.test(str)) codes.add('USD');
  if (/JP[¥￥]|日元|日圓|円/i.test(str)) codes.add('JPY');
  if (/CA\$|加元|加拿大元/i.test(str)) codes.add('CAD');
  if (/AU\$|澳元|澳大利亚元|澳大利亞元/i.test(str)) codes.add('AUD');
  return [...codes];
}
