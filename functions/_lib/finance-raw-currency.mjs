// Exact units for the inherited raw-event transport. No identity inference or FX.
import {currencyDigits,parseMoney} from '../../js/finance/money.js';
import {explicitCurrencyCodes,hasAmbiguousCurrencySymbol} from './payment-currency-evidence.mjs';

const words={
  CNY:/人民币|人民幣|\bRMB\b/i,
  USD:/美元|美金|US\$/i,
  EUR:/欧元|歐元|€/i,
  HKD:/港币|港幣|港元|HK\$/i,
  GBP:/英镑|英鎊|£/i,
  JPY:/日元|日圓|円|JP[¥￥]/i,
  CAD:/加元|加拿大元|CA\$/i,
  AUD:/澳元|澳大利亚元|澳大利亞元|AU\$/i,
};

const patterns=[
  /(?:(?:(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|RMB)\s*)?(?:US\$|HK\$|CA\$|AU\$|JP[¥￥]|[￥¥$€£])|CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|人民币|人民幣|RMB)\s*([0-9]+(?:\.[0-9]+)?)(?![\d.])/gi,
  /(?<![\d.\-])([0-9]+(?:\.[0-9]+)?)\s*(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|元|圓|块|塊|円|日元|日圓|美元|美金|港币|港幣|港元|欧元|歐元|英镑|英鎊)(?!\s*(?:额度|額度|优惠|優惠|券|起|每月))/gi,
  /(?:交易金额|交易金額|付款金额|付款金額|收款金额|收款金額|扣款金额|扣款金額|退款金额|退款金額)[:：]?\s*(?:(?:(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|RMB)\s*)?(?:US\$|HK\$|CA\$|AU\$|JP[¥￥]|[￥¥$€£])\s*)?([0-9]+(?:\.[0-9]+)?)(?![\d.])/gi,
  /(?:支付成功|付款成功|扣款成功|扣费成功|收款成功|退款成功|已扣款|已扣费|已收款|已付款)\s*[:：]?\s*(?:(?:(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|RMB)\s*)?(?:US\$|HK\$|CA\$|AU\$|JP[¥￥]|[￥¥$€£])\s*)?([0-9]+(?:\.[0-9]+)?)(?![\d.])/gi,
];

export function rawCurrencyMoney(value,text,defaultCurrency=null){
  const declared=typeof value.currency==='string'&&value.currency.trim()?value.currency.trim().toUpperCase():null;
  const codes=new Set(explicitCurrencyCodes(text));
  for(const [code,pattern]of Object.entries(words))if(pattern.test(text))codes.add(code);
  let currency=declared||(codes.size===1?[...codes][0]:defaultCurrency)||'XXX';
  const pending=reason=>({currency,amount_minor:0,review_reason:reason});
  if(value.currency!=null&&typeof value.currency!=='string')return pending('currency_review_required');
  if(/\d(?:\.\d+)?[eE][+-]?\d/.test(text))return pending('amount_invalid');
  let exponent;try{exponent=currencyDigits(currency)}catch{return pending('currency_review_required')}
  if(codes.size>1||(codes.size===1&&![...codes].includes(currency))){if(!codes.has(currency))currency=[...codes][0];return pending('currency_review_required')}
  if((/[¥￥]/.test(text)&&!['CNY','JPY'].includes(currency)) || (/\$/.test(text)&&!['USD','HKD'].includes(currency)))return pending('currency_review_required');
  for(const hit of String(value.text||'').matchAll(/\d[\d,]*(?:\.\d+)?/g))if(hit[0].includes(',')&&!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(hit[0]))return pending('amount_invalid');

  let amount;
  if(value.source_type==='legacy_import'&&!text){
    if(!Number.isSafeInteger(value.amount_minor)||value.amount_minor<=0 || (currency==='JPY'&&value.amount_exponent!==0))return pending('currency_unit_review_required');
    amount=value.amount_minor;
  }else{
    if(/(?:^|[^\d])-\d/.test(text))return pending('amount_invalid');

    // Extract amount occurrences by distinct position
    const occurrences=[];
    const seenSpans=new Set();
    for(const pattern of patterns){
      for(const match of text.matchAll(pattern)){
        const rawNumber=match[1];
        const relIndex=match[0].lastIndexOf(rawNumber);
        const numStart=match.index+relIndex;
        const numEnd=numStart+rawNumber.length;
        const spanKey=`${numStart}:${numEnd}`;
        if(!seenSpans.has(spanKey)){
          seenSpans.add(spanKey);
          occurrences.push({start:numStart,end:numEnd,raw:rawNumber});
        }
      }
    }
    occurrences.sort((a,b)=>a.start-b.start);

    if(occurrences.length===0)return pending('amount_missing');

    const hasAmbiguous=hasAmbiguousCurrencySymbol(text);

    // If there are multiple amount occurrences:
    // They cannot be folded into one token even if numerical values are equal.
    // If any symbol is unresolved/ambiguous or multiple currencies exist, review required.
    if(occurrences.length>1){
      if(hasAmbiguous||codes.size>1)return pending('currency_review_required');
      return pending('amount_ambiguous');
    }

    // Exactly 1 occurrence
    // If text has an unresolved ambiguous symbol alongside an explicit currency, or declared currency that doesn't resolve it:
    if(hasAmbiguous && codes.size>0)return pending('currency_review_required');

    try{amount=parseMoney(occurrences[0].raw,currency)}catch(error){return pending(error.code||'amount_invalid')}
  }

  if(value.amount_minor!==undefined && value.amount_minor!==0 && (!Number.isSafeInteger(value.amount_minor)||value.amount_minor!==amount))return pending('amount_conflict');
  if(amount<=0||amount>10000000000000)return pending('amount_invalid');
  if(value.amount_exponent!==undefined&&value.amount_exponent!==exponent)return pending('currency_unit_review_required');
  const fromDefault=!declared&&codes.size===0&&defaultCurrency!==null;
  return {currency,amount_minor:amount,amount_exponent:exponent,...(fromDefault?{currency_review_required:true,currency_decision_source:'account_default'}:{})};
}
