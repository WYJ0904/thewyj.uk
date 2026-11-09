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
  NZD:/新西兰元|紐西蘭元|NZ\$/i,
  SGD:/新加坡元|(?:SG|(?<![A-Za-z])S)\$/i,
};

const CURRENCY_WORDS = 'CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|NZD|SGD|RMB|人民币|人民幣|日元|日圓|美元|美金|港币|港幣|港元|欧元|歐元|英镑|英鎊|加元|加拿大元|澳元|澳大利亚元|澳大利亞元|新西兰元|紐西蘭元|新加坡元';
const SYMBOLS = 'US\\$|HK\\$|CA\\$|AU\\$|NZ\\$|(?:SG|(?<![A-Za-z])S)\\$|JP[¥￥]|[￥¥$€£]';

const patterns=[
  new RegExp(`(?:(?:(?:${CURRENCY_WORDS})\\s*)?(?:${SYMBOLS})|${CURRENCY_WORDS})\\s*([0-9]+(?:\\.[0-9]+)?)(?![\\d.])`, 'gi'),
  /(?<![\d.\-])([0-9]+(?:\.[0-9]+)?)\s*(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|NZD|SGD|元|圓|块|塊|円|日元|日圓|美元|美金|港币|港幣|港元|欧元|歐元|英镑|英鎊)(?!\s*(?:额度|額度|优惠|優惠|券|起|每月))/gi,
  new RegExp(`(?:交易金额|交易金額|付款金额|付款金額|收款金额|收款金額|扣款金额|扣款金額|退款金额|退款金額)[:：]?\\s*(?:(?:(?:${CURRENCY_WORDS})\\s*)?(?:${SYMBOLS})\\s*)?([0-9]+(?:\\.[0-9]+)?)(?![\\d.])`, 'gi'),
  new RegExp(`(?:支付成功|付款成功|扣款成功|扣费成功|收款成功|退款成功|已扣款|已扣费|已收款|已付款)\\s*[:：]?\\s*(?:(?:(?:${CURRENCY_WORDS})\\s*)?(?:${SYMBOLS})\\s*)?([0-9]+(?:\\.[0-9]+)?)(?![\\d.])`, 'gi'),
];

const AUXILIARY_PREFIX = /(?:(?:账户|卡内|可用|当前|卡)?(?:余额|餘額)|(?:可用|剩余|剩餘|授信)?(?:额度|額度)|优惠|優惠|立减|立減|折扣|积分|積分|红包|紅包|订单号|訂單號|交易号|交易號|流水号|流水號|卡号|卡號|尾号|尾號)\s*[:：=＝]?\s*$/i;
const FEE_INCLUDED = /(?:含|包含|内含|包括)\s*(?:手续费|手續費|服务费|服務費)\s*[:：=＝]?\s*$/i;
const FEE_SEPARATE_PREFIX = /(?:另扣|另收|另外扣|另外收|另外扣除|另外收取|额外扣|额外收|额外扣除|额外收取|外加|另付|另加|另外支付)\s*(?:手续费|手續費|服务费|服務費)?\s*[:：=＝]?\s*$/i;
const FEE_ESTIMATED_PREFIX = /(?:预计|預計|预估|預估|待|未|拟|擬|计划|計劃|暂未|暫未)\s*(?:扣除|扣收|扣款|扣费|收取|支付|付)?\s*(?:手续费|手續費|服务费|服務費)\s*[:：=＝]?\s*$/i;
const FEE_GENERIC_PREFIX = /(?:手续费|手續費|服务费|服務費|佣金|规费)\s*[:：=＝]?\s*$/i;
const FEE_DEDUCTED_PREFIX = /(?:已扣款|已扣费|已扣費|扣款成功|扣费成功|扣費成功|已扣除|已扣收)\s*[:：，, ]*\s*(?:手续费|手續費|服务费|服務費)\s*[:：=＝]?\s*$/i;
const TX_PROJECTED_PREFIX = /(?:预计|預計|预估|預估|待|未|拟|擬|计划|計劃|暂未|暫未|应|應)\s*(?:扣除|扣收|扣款|扣费|收取|支付|付款|转账|轉賬|转出|轉出|支出|收款|充值)\s*[:：=＝]?\s*$/i;
const UNCOMPLETED_SUFFIX = /^\s*(?:元|圓|块|塊|円)?\s*(?:手续费|手續費|服务费|服務費)?\s*(?:待扣|待收|待付|未扣|未收|待支付|待付款|待扣款|未支付|未付款|未扣除|待确认|待確認|待结算|待結算|\(?(?:预计|預計|预估|預估)\)?)/i;
const AUXILIARY_SUFFIX = /^\s*(?:元|圓|块|塊|円)?\s*(?:(?:的)?(?:优惠|優惠|券|立减|立減|折扣|积分|積分|红包|紅包)|起|每月|\/月)/i;

function detectAmountRole(text, start, rawNumber, totalOccurrences) {
  let before = text.slice(Math.max(0, start - 30), start);
  before = before.replace(/(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|NZD|SGD|RMB|US\$|HK\$|CA\$|AU\$|NZ\$|SG\$|S\$|JP[¥￥]|[¥￥$€£]|元|圆|块|人民币|人民幣|美元|港币|日元|欧元|英镑)\s*[:：=＝]?\s*$/i, '');
  before = before.replace(/[:：=＝\s]+$/, '');

  const after = text.slice(start + rawNumber.length, Math.min(text.length, start + rawNumber.length + 20));
  if (AUXILIARY_SUFFIX.test(after)) {
    return 'auxiliary';
  }

  if (UNCOMPLETED_SUFFIX.test(after)) {
    if (FEE_GENERIC_PREFIX.test(before) || /(?:手续费|手續費|服务费|服務費|佣金|规费)/.test(before)) {
      return 'fee_estimated';
    }
    return 'projected_transaction';
  }

  if (AUXILIARY_PREFIX.test(before)) return 'auxiliary';
  if (FEE_INCLUDED.test(before)) return 'fee_included';
  if (FEE_SEPARATE_PREFIX.test(before)) return 'fee_separate';
  if (FEE_ESTIMATED_PREFIX.test(before)) return 'fee_estimated';
  if (TX_PROJECTED_PREFIX.test(before)) return 'projected_transaction';
  if (FEE_DEDUCTED_PREFIX.test(before)) {
    if (totalOccurrences <= 1) return 'fee_deducted';
    return 'fee_separate';
  }
  if (FEE_GENERIC_PREFIX.test(before)) {
    if (/(?:预计|預計|预估|預估|待|未|拟|擬|计划|計劃)/.test(before)) {
      return 'fee_estimated';
    }
    if (totalOccurrences <= 1 && /(?:已扣款|已扣费|已扣費|扣款成功|扣费成功|扣費成功|已扣除|已扣收)/.test(text) && !/(?:预计|預計|预估|預估|待|未|拟|擬)/.test(text)) {
      return 'fee_deducted';
    }
    if (totalOccurrences > 1) {
      return 'fee_separate';
    }
    return 'fee_unproven';
  }
  return 'transaction';
}

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

    for(const occ of occurrences){
      occ.role = detectAmountRole(text, occ.start, occ.raw, occurrences.length);
    }

    const transactionOccurrences = occurrences.filter(occ => occ.role === 'transaction' || occ.role === 'fee_deducted');

    if(transactionOccurrences.length === 0){
      return pending('amount_missing');
    }

    if(hasAmbiguous && (codes.size > 0 || occurrences.length > 1)){
      return pending('currency_review_required');
    }

    if(transactionOccurrences.length > 1){
      if(hasAmbiguous || codes.size > 1) return pending('currency_review_required');
      return pending('amount_ambiguous');
    }

    if(occurrences.some(occ => occ.role === 'fee_separate' || occ.role === 'fee_unproven' || occ.role === 'fee_estimated')){
      return pending('fee_review_required');
    }

    if(occurrences.some(occ => occ.role === 'projected_transaction')){
      return pending('amount_ambiguous');
    }

    try{amount=parseMoney(transactionOccurrences[0].raw,currency)}catch(error){return pending(error.code||'amount_invalid')}
  }

  if(value.amount_minor!==undefined && value.amount_minor!==0 && (!Number.isSafeInteger(value.amount_minor)||value.amount_minor!==amount))return pending('amount_conflict');
  if(amount<=0||amount>10000000000000)return pending('amount_invalid');
  if(value.amount_exponent!==undefined&&value.amount_exponent!==exponent)return pending('currency_unit_review_required');
  const fromDefault=!declared&&codes.size===0&&defaultCurrency!==null;
  return {currency,amount_minor:amount,amount_exponent:exponent,...(fromDefault?{currency_review_required:true,currency_decision_source:'account_default'}:{})};
}
