// Currency cues only. No conversion, rate lookup or amount inference.
const core=new Set(['CNY','USD','EUR','HKD','GBP','JPY','AUD','CAD','BHD','CHF','SGD','NZD','KRW']);
const available=typeof Intl.supportedValuesOf==='function'?new Set(Intl.supportedValuesOf('currency')):core;
export function explicitCurrencyCodes(text) {
  const codes=new Set();
  const pattern=/(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g;
  for(const hit of String(text).matchAll(pattern)) {
    const code=hit[1].toUpperCase();if(!available.has(code)&&!core.has(code))continue;
    const before=text.slice(0,hit.index),after=text.slice(hit.index+3);
    if(/^\s*[:：]?\s*\d/.test(after)||/\d[\d.,]*\s*$/.test(before)||/(?:币种|幣種|currency)\s*[:：]?\s*$/i.test(before))codes.add(code);
  }
  if(/人民币|人民幣|RMB|[¥￥]|\d\s*元/i.test(text))codes.add('CNY');
  return [...codes];
}
