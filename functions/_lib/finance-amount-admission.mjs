// Pure interface for amount facts parsing and automatic admission gating.
// No FX, identity inference, or database calls.
import { currencyDigits, parseMoney } from '../../js/finance/money.js';
import { explicitCurrencyCodes, hasAmbiguousCurrencySymbol } from './payment-currency-evidence.mjs';

export const SUPPORTED_CURRENCIES = new Set(['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'JPY']);

const QUALIFIED_SYMBOLS = [
  { str: 'US$', code: 'USD' },
  { str: 'HK$', code: 'HKD' },
  { str: 'CA$', code: 'CAD' },
  { str: 'AU$', code: 'AUD' },
  { str: 'NZ$', code: 'NZD' },
  { str: 'SG$', code: 'SGD' },
  { str: 'JP¥', code: 'JPY' },
  { str: 'JP￥', code: 'JPY' },
];

const CURRENCY_WORDS_LIST = [
  { str: '澳大利亚元', code: 'AUD' },
  { str: '澳大利亞元', code: 'AUD' },
  { str: '加拿大元', code: 'CAD' },
  { str: '新西兰元', code: 'NZD' },
  { str: '紐西蘭元', code: 'NZD' },
  { str: '新加坡元', code: 'SGD' },
  { str: '人民币', code: 'CNY' },
  { str: '人民幣', code: 'CNY' },
  { str: '港币', code: 'HKD' },
  { str: '港幣', code: 'HKD' },
  { str: '港元', code: 'HKD' },
  { str: '美元', code: 'USD' },
  { str: '美金', code: 'USD' },
  { str: '欧元', code: 'EUR' },
  { str: '歐元', code: 'EUR' },
  { str: '英镑', code: 'GBP' },
  { str: '英鎊', code: 'GBP' },
  { str: '日元', code: 'JPY' },
  { str: '日圓', code: 'JPY' },
  { str: '加元', code: 'CAD' },
  { str: '澳元', code: 'AUD' },
];

const ISO_CODES = ['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'SGD', 'RMB'];

const CURRENCY_WORDS = 'CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|NZD|SGD|RMB|人民币|人民幣|日元|日圓|美元|美金|港币|港幣|港元|欧元|歐元|英镑|英鎊|加元|加拿大元|澳元|澳大利亚元|澳大利亞元|新西兰元|紐西蘭元|新加坡元';
const SYMBOLS = 'US\\$|HK\\$|CA\\$|AU\\$|NZ\\$|(?:SG|(?<![A-Za-z])S)\\$|JP[¥￥]|[￥¥$€£]';

const patterns = [
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
const TX_PROJECTED_PREFIX = /(?:预计|預計|预估|預估|待|未|拟|擬|计划|計劃|暂未|暫未|应|應)\s*(?:扣除|扣收|扣款|扣费|收取|支付|付款|转账|轉賬|转出|轉出|支出|收款|充值|收入)\s*[:：=＝]?\s*$/i;

const LABEL_PAID = /(?:付款金额|付款金額|交易金额|交易金額|扣款金额|扣款金額)\s*[:：=＝]?\s*$/i;
const LABEL_RECEIVED = /(?:收款金额|收款金額)\s*[:：=＝]?\s*$/i;
const LABEL_REFUND = /(?:退款金额|退款金額)\s*[:：=＝]?\s*$/i;

const PREFIX_PAID = /(?:实付|實際付款|已扣款|已付款|扣款成功|扣费成功|扣費成功|已扣费|已扣費|支付成功|付款成功|消费成功|消費成功|转账成功|轉賬成功|交易成功|扫码付款|掃碼付款|向商家付款|信用卡消费|信用卡消費|银行卡支付|銀行卡支付|账户转出|账户支出|消费|消費|支出|转出|轉出)\s*[:：，, ]*\s*$/i;
const PREFIX_RECEIVED = /(?:实收|實際收款|收款成功|收到付款|收到转账|收到轉賬|已到账|已到賬|已入账|已入賬|已收款|成功收款|转入|轉入|收入)\s*[:：，, ]*\s*$/i;
const PREFIX_REFUND = /(?:实际退款|實際退款|退款成功|退款到账|退款到賬|已退款|已退|退还|退還|撤销交易|撤銷交易|冲正|沖正|返还|返還)\s*[:：，, ]*\s*$/i;

const UNCOMPLETED_SUFFIX = /^\s*(?:元|圓|块|塊|円)?\s*(?:手续费|手續費|服务费|服務費)?\s*(?:待扣|待收|待付|未扣|未收|待支付|待付款|待扣款|未支付|未付款|未扣除|待确认|待確認|待结算|待結算|\(?(?:预计|預計|预估|預估)\)?)/i;
const AUXILIARY_SUFFIX = /^\s*(?:元|圓|块|塊|円)?\s*(?:(?:的)?(?:优惠|優惠|券|立减|立減|折扣|积分|積分|红包|紅包)|起|每月|\/月)/i;

const SUFFIX_PAID_COMPLETE = /^\s*(?:元|圓|块|塊|円)?\s*(?:支付成功|付款成功|扣款成功|扣费成功|已扣款|已扣费|消费成功|消費成功|转账成功|交易成功)/i;
const SUFFIX_RECEIVED_COMPLETE = /^\s*(?:元|圓|块|塊|円)?\s*(?:收款成功|已到账|已入账)/i;
const SUFFIX_REFUND_COMPLETE = /^\s*(?:元|圓|块|塊|円)?\s*(?:退款成功|退款到账)/i;

const OPERATION_MARKER_REGEX = /(?:(?:订单|訂單)[A-Za-z0-9_-]+|上一笔|上一筆|上笔|上筆|上一单|上一單|上一次|下一笔|下一筆|下笔|下筆|下一单|下一單|下一次|另一笔|另一筆|另笔|另筆|另一次|其他订单|其他訂單|其他交易|另一订单|另一訂單|本单|本單|本次|本笔|本筆|当前交易|當前交易)/gi;
const CLAUSE_DELIMITER_REGEX = /[；;\n\r。]/;

const PAYMENT_COMPLETION_PREDICATES = [
  "支付成功", "付款成功", "扣款成功", "扣费成功", "扣費成功",
  "已扣款", "已扣费", "已扣費", "已付款",
  "消费成功", "消費成功", "转账成功", "轉賬成功",
  "支付已完成", "交易成功", "实付", "實際付款",
];

const RECEIPT_COMPLETION_PREDICATES = [
  "收款成功", "收到付款", "收到转账", "收到轉賬",
  "已到账", "已到賬", "已入账", "已入賬", "已收款", "成功收款",
  "实收", "實際收款",
];

const REFUND_COMPLETION_PREDICATES = [
  "退款成功", "退款到账", "退款到賬", "已退款", "已退",
  "实际退款", "實際退款", "撤销交易", "撤銷交易",
];

function findOperationScopes(text) {
  const matches = [...text.matchAll(OPERATION_MARKER_REGEX)];
  if (matches.length === 0) {
    return [{ marker: null, start: 0, end: text.length }];
  }
  const scopes = [];
  if (matches[0].index > 0) {
    scopes.push({ marker: null, start: 0, end: matches[0].index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    scopes.push({ marker: matches[i][0], start, end });
  }
  return scopes;
}

function findClauses(text) {
  const clauses = [];
  let curStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (CLAUSE_DELIMITER_REGEX.test(text[i])) {
      clauses.push({ start: curStart, end: i, text: text.slice(curStart, i) });
      curStart = i + 1;
    }
  }
  if (curStart <= text.length) {
    clauses.push({ start: curStart, end: text.length, text: text.slice(curStart) });
  }
  return clauses;
}

function findCurrencyWordEndingAt(text, p) {
  for (const { str, code } of QUALIFIED_SYMBOLS) {
    if (p >= str.length && text.slice(p - str.length, p).toUpperCase() === str.toUpperCase()) {
      return { code, start: p - str.length, end: p, text: text.slice(p - str.length, p) };
    }
  }
  if (p >= 2 && text.slice(p - 2, p).toUpperCase() === 'S$' && (p === 2 || !/[A-Za-z]/.test(text[p - 3]))) {
    return { code: 'SGD', start: p - 2, end: p, text: text.slice(p - 2, p) };
  }
  for (const { str, code } of CURRENCY_WORDS_LIST) {
    if (p >= str.length && text.slice(p - str.length, p) === str) {
      return { code, start: p - str.length, end: p, text: str };
    }
  }
  if (p >= 3) {
    const candidate = text.slice(p - 3, p).toUpperCase();
    if (ISO_CODES.includes(candidate) && (p === 3 || !/[A-Za-z0-9]/.test(text[p - 4]))) {
      return { code: candidate === 'RMB' ? 'CNY' : candidate, start: p - 3, end: p, text: text.slice(p - 3, p) };
    }
  }
  return null;
}

function findCurrencyWordStartingAt(text, q) {
  for (const { str, code } of QUALIFIED_SYMBOLS) {
    if (q + str.length <= text.length && text.slice(q, q + str.length).toUpperCase() === str.toUpperCase()) {
      return { code, start: q, end: q + str.length, text: text.slice(q, q + str.length), isBareSymbol: false };
    }
  }
  if (q + 2 <= text.length && text.slice(q, q + 2).toUpperCase() === 'S$' && (q + 2 === text.length || !/[A-Za-z]/.test(text[q + 2]))) {
    return { code: 'SGD', start: q, end: q + 2, text: text.slice(q, q + 2), isBareSymbol: false };
  }
  if (q < text.length && text[q] === '円') {
    return { code: 'JPY', start: q, end: q + 1, text: '円', isBareSymbol: false };
  }
  if (q < text.length && ['元', '圆', '块', '塊'].includes(text[q])) {
    const rest = text.slice(q + 1);
    if (!/^\s*(?:的)?(?:优惠|優惠|券|立减|立減|折扣|积分|積分|红包|紅包|起|每月|\/月|额度|額度)/.test(rest)) {
      return { code: 'CNY', start: q, end: q + 1, text: text[q], isBareSymbol: false };
    }
  }
  if (q < text.length && text[q] === '€') {
    return { code: 'EUR', start: q, end: q + 1, text: '€', isBareSymbol: false };
  }
  if (q < text.length && text[q] === '£') {
    return { code: 'GBP', start: q, end: q + 1, text: '£', isBareSymbol: false };
  }
  if (q < text.length && text[q] === '$') {
    return { code: 'USD', start: q, end: q + 1, text: '$', isBareSymbol: true };
  }
  if (q < text.length && (text[q] === '¥' || text[q] === '￥')) {
    return { code: 'CNY', start: q, end: q + 1, text: text[q], isBareSymbol: true };
  }
  for (const { str, code } of CURRENCY_WORDS_LIST) {
    if (q + str.length <= text.length && text.slice(q, q + str.length) === str) {
      return { code, start: q, end: q + str.length, text: str, isBareSymbol: false };
    }
  }
  if (q + 3 <= text.length) {
    const candidate = text.slice(q, q + 3).toUpperCase();
    if (ISO_CODES.includes(candidate) && (q + 3 === text.length || !/[A-Za-z0-9]/.test(text[q + 3]))) {
      return { code: candidate === 'RMB' ? 'CNY' : candidate, start: q, end: q + 3, text: text.slice(q, q + 3), isBareSymbol: false };
    }
  }
  return null;
}

function detectAttachedCurrency(text, start, end, { declaredCurrency, defaultCurrency }) {
  // 1. Prefix attached immediately before start
  let p = start;
  while (p > 0 && /[:：\s]/.test(text[p - 1])) p--;

  let prefixCode = null;
  let prefixSpan = null;
  let prefixText = null;
  let isPrefixBareSymbol = false;

  const wordHit = findCurrencyWordEndingAt(text, p);
  if (wordHit) {
    prefixCode = wordHit.code;
    prefixSpan = { start: wordHit.start, end: p };
    prefixText = wordHit.text;
    isPrefixBareSymbol = false;
  } else if (p > 0 && /[$¥￥€£]/.test(text[p - 1])) {
    const ch = text[p - 1];
    prefixSpan = { start: p - 1, end: p };
    prefixText = ch;
    if (ch === '€') {
      prefixCode = 'EUR';
      isPrefixBareSymbol = false;
    } else if (ch === '£') {
      prefixCode = 'GBP';
      isPrefixBareSymbol = false;
    } else if (ch === '$') {
      prefixCode = 'USD';
      isPrefixBareSymbol = true;
    } else {
      prefixCode = 'CNY';
      isPrefixBareSymbol = true;
    }

    // Bare symbol preceded by ISO code or Chinese word (e.g. "USD $", "人民币 ¥")
    let pPre = prefixSpan.start;
    while (pPre > 0 && /[:：\s]/.test(text[pPre - 1])) pPre--;
    const preWordHit = findCurrencyWordEndingAt(text, pPre);
    if (preWordHit) {
      prefixCode = preWordHit.code;
      prefixSpan = { start: preWordHit.start, end: p };
      prefixText = text.slice(preWordHit.start, p);
      isPrefixBareSymbol = false;
    }
  }

  // 2. Suffix attached immediately after end
  let q = end;
  while (q < text.length && /[:：\s]/.test(text[q])) q++;

  let suffixCode = null;
  let suffixSpan = null;
  let suffixText = null;
  let isSuffixBareSymbol = false;

  const wordStartHit = findCurrencyWordStartingAt(text, q);
  if (wordStartHit) {
    suffixCode = wordStartHit.code;
    suffixSpan = { start: q, end: wordStartHit.end };
    suffixText = wordStartHit.text;
    isSuffixBareSymbol = wordStartHit.isBareSymbol;
  }

  // 3. Resolve attached cues
  let code = null;
  let isExplicit = false;
  let isBareSymbol = false;
  let fromDefault = false;
  let unverified = false;
  let evidenceSpan = null;
  let evidence = null;

  if (prefixCode && suffixCode) {
    if (isPrefixBareSymbol && !isSuffixBareSymbol) {
      code = suffixCode;
      isExplicit = true;
      evidenceSpan = { start: prefixSpan.start, end: suffixSpan.end };
      evidence = text.slice(prefixSpan.start, suffixSpan.end);
    } else if (!isPrefixBareSymbol && isSuffixBareSymbol) {
      code = prefixCode;
      isExplicit = true;
      evidenceSpan = { start: prefixSpan.start, end: suffixSpan.end };
      evidence = text.slice(prefixSpan.start, suffixSpan.end);
    } else if (prefixCode === suffixCode) {
      code = prefixCode;
      isExplicit = !isPrefixBareSymbol;
      isBareSymbol = isPrefixBareSymbol;
      evidenceSpan = { start: prefixSpan.start, end: suffixSpan.end };
      evidence = text.slice(prefixSpan.start, suffixSpan.end);
    } else {
      code = 'XXX';
      unverified = true;
      evidenceSpan = { start: prefixSpan.start, end: suffixSpan.end };
      evidence = text.slice(prefixSpan.start, suffixSpan.end);
    }
  } else if (prefixCode) {
    code = prefixCode;
    isExplicit = !isPrefixBareSymbol;
    isBareSymbol = isPrefixBareSymbol;
    evidenceSpan = prefixSpan;
    evidence = prefixText;
  } else if (suffixCode) {
    code = suffixCode;
    isExplicit = !isSuffixBareSymbol;
    isBareSymbol = isSuffixBareSymbol;
    evidenceSpan = suffixSpan;
    evidence = suffixText;
  }

  // 4. Bare symbol resolution
  if (isBareSymbol) {
    const sym = prefixText || suffixText;
    if (sym.includes('$')) {
      if (declaredCurrency && ['USD', 'HKD'].includes(declaredCurrency)) {
        code = declaredCurrency;
        isExplicit = true;
        isBareSymbol = false;
      } else if (defaultCurrency && ['USD', 'HKD'].includes(defaultCurrency)) {
        code = defaultCurrency;
        fromDefault = true;
        isExplicit = false;
      } else {
        code = 'XXX';
        unverified = true;
        isExplicit = false;
      }
    } else if (sym.includes('¥') || sym.includes('￥')) {
      if (declaredCurrency && ['CNY', 'JPY'].includes(declaredCurrency)) {
        code = declaredCurrency;
        isExplicit = true;
        isBareSymbol = false;
      } else if (defaultCurrency && ['CNY', 'JPY'].includes(defaultCurrency)) {
        code = defaultCurrency;
        fromDefault = true;
        isExplicit = false;
      } else {
        code = 'XXX';
        unverified = true;
        isExplicit = false;
      }
    }
  }

  // 5. If no attached currency cue
  if (!code) {
    if (declaredCurrency) {
      code = declaredCurrency;
      isExplicit = true;
      fromDefault = false;
    } else if (defaultCurrency) {
      code = defaultCurrency;
      isExplicit = false;
      fromDefault = true;
    } else {
      code = 'XXX';
      isExplicit = false;
      unverified = true;
    }
  }

  return {
    currency: code,
    isExplicit,
    isBareSymbol,
    fromDefault,
    unverified,
    evidenceSpan,
    evidence,
  };
}

export function parseAmountFacts(text, { declaredCurrency = null, defaultCurrency = null } = {}) {
  const normText = String(text || '').trim();
  const operationScopes = findOperationScopes(normText);
  const clauses = findClauses(normText);

  const globalCodes = new Set(explicitCurrencyCodes(normText));
  for (const { code } of CURRENCY_WORDS_LIST) {
    // Check if the currency word appears in normText
  }
  for (const { str, code } of QUALIFIED_SYMBOLS) {
    if (normText.toUpperCase().includes(str.toUpperCase())) globalCodes.add(code);
  }
  for (const { str, code } of CURRENCY_WORDS_LIST) {
    if (normText.includes(str)) globalCodes.add(code);
  }
  const globalCodeList = [...globalCodes];

  // Extract raw amount occurrences by unique span
  const seenSpans = new Set();
  const rawOccurrences = [];
  for (const pattern of patterns) {
    for (const match of normText.matchAll(pattern)) {
      const rawNumber = match[1];
      const relIndex = match[0].lastIndexOf(rawNumber);
      const numStart = match.index + relIndex;
      const numEnd = numStart + rawNumber.length;
      const spanKey = `${numStart}:${numEnd}`;
      if (!seenSpans.has(spanKey)) {
        seenSpans.add(spanKey);
        rawOccurrences.push({ start: numStart, end: numEnd, raw: rawNumber });
      }
    }
  }
  rawOccurrences.sort((a, b) => a.start - b.start);

  const totalOccurrences = rawOccurrences.length;
  const facts = [];

  for (const occ of rawOccurrences) {
    const { start, end, raw } = occ;

    // Locate operation scope
    const opScope = operationScopes.find(s => start >= s.start && start < s.end) || operationScopes[0];
    // Locate clause
    const clauseIndex = clauses.findIndex(c => start >= c.start && start <= c.end);
    const clause = clauses[clauseIndex] || { text: normText, start: 0, end: normText.length };

    // Clean context before & after - strip all attached currency cues and spaces
    let before = normText.slice(Math.max(0, start - 30), start);
    const trailingCurrencyRegex = /(?:CNY|USD|EUR|HKD|GBP|JPY|CAD|AUD|NZD|SGD|RMB|US\$|HK\$|CA\$|AU\$|NZ\$|SG\$|S\$|JP[¥￥]|[¥￥$€£]|元|圆|块|人民币|人民幣|美元|美金|港币|港幣|港元|日元|欧元|英镑)\s*[:：=＝]?\s*$/i;
    while (trailingCurrencyRegex.test(before) || /[:：=＝\s]+$/.test(before)) {
      before = before.replace(trailingCurrencyRegex, '');
      before = before.replace(/[:：=＝\s]+$/, '');
    }

    const after = normText.slice(end, Math.min(normText.length, end + 25));

    // Currency strictly attached to this amount occurrence
    const curInfo = detectAttachedCurrency(normText, start, end, {
      declaredCurrency,
      defaultCurrency,
    });
    const currency = curInfo.currency;

    // Role & direction
    let role = 'unknown';
    let direction = 'unknown';
    let feeRelation = 'none';
    let completionStatus = 'unknown';
    let completionEvidence = null;
    let completionEvidenceSpan = null;
    let uncompletedEvidence = null;
    let uncompletedSpan = null;

    if (AUXILIARY_SUFFIX.test(after)) {
      role = 'auxiliary';
      direction = 'unknown';
      completionStatus = 'unknown';
    } else if (UNCOMPLETED_SUFFIX.test(after)) {
      const uncompMatch = after.match(UNCOMPLETED_SUFFIX);
      uncompletedEvidence = uncompMatch ? uncompMatch[0].trim() : 'uncompleted';
      uncompletedSpan = { start: end, end: end + (uncompMatch ? uncompMatch[0].length : 0) };
      if (FEE_GENERIC_PREFIX.test(before) || /(?:手续费|手續費|服务费|服務費|佣金|规费)/.test(before)) {
        role = 'fee_estimated';
        direction = 'expense';
        feeRelation = 'estimated';
        completionStatus = 'projected';
      } else {
        role = 'projected_transaction';
        direction = 'unknown';
        completionStatus = 'projected';
      }
    } else if (SUFFIX_PAID_COMPLETE.test(after)) {
      const compMatch = after.match(SUFFIX_PAID_COMPLETE);
      role = 'paid';
      direction = 'expense';
      completionStatus = 'complete';
      completionEvidence = compMatch ? compMatch[0].trim() : 'complete';
      completionEvidenceSpan = { start: end, end: end + (compMatch ? compMatch[0].length : 0) };
    } else if (SUFFIX_RECEIVED_COMPLETE.test(after)) {
      const compMatch = after.match(SUFFIX_RECEIVED_COMPLETE);
      role = 'received';
      direction = 'income';
      completionStatus = 'complete';
      completionEvidence = compMatch ? compMatch[0].trim() : 'complete';
      completionEvidenceSpan = { start: end, end: end + (compMatch ? compMatch[0].length : 0) };
    } else if (SUFFIX_REFUND_COMPLETE.test(after)) {
      const compMatch = after.match(SUFFIX_REFUND_COMPLETE);
      role = 'refund';
      direction = 'refund';
      completionStatus = 'complete';
      completionEvidence = compMatch ? compMatch[0].trim() : 'complete';
      completionEvidenceSpan = { start: end, end: end + (compMatch ? compMatch[0].length : 0) };
    } else if (AUXILIARY_PREFIX.test(before)) {
      role = 'auxiliary';
      direction = 'unknown';
      completionStatus = 'unknown';
    } else if (FEE_INCLUDED.test(before)) {
      role = 'fee_included';
      direction = 'expense';
      feeRelation = 'included';
      completionStatus = 'complete';
    } else if (FEE_SEPARATE_PREFIX.test(before)) {
      role = 'fee_separate';
      direction = 'expense';
      feeRelation = 'separate';
      completionStatus = 'unproven';
    } else if (FEE_ESTIMATED_PREFIX.test(before)) {
      role = 'fee_estimated';
      direction = 'expense';
      feeRelation = 'estimated';
      completionStatus = 'projected';
      uncompletedEvidence = 'estimated_fee';
    } else if (TX_PROJECTED_PREFIX.test(before)) {
      role = 'projected_transaction';
      direction = 'unknown';
      completionStatus = 'projected';
      uncompletedEvidence = 'projected_tx';
    } else if (FEE_DEDUCTED_PREFIX.test(before)) {
      if (totalOccurrences <= 1) {
        role = 'fee_deducted';
        direction = 'expense';
        feeRelation = 'deducted';
        completionStatus = 'complete';
        completionEvidence = 'fee_deducted';
        const hit = PAYMENT_COMPLETION_PREDICATES.find(t => before.includes(t));
        if (hit) {
          const bIdx = normText.lastIndexOf(hit, start);
          if (bIdx >= 0) completionEvidenceSpan = { start: bIdx, end: bIdx + hit.length };
        }
      } else {
        role = 'fee_separate';
        direction = 'expense';
        feeRelation = 'separate';
        completionStatus = 'unproven';
      }
    } else if (FEE_GENERIC_PREFIX.test(before)) {
      if (/(?:预计|預計|预估|預估|待|未|拟|擬|计划|計劃)/.test(before)) {
        role = 'fee_estimated';
        direction = 'expense';
        feeRelation = 'estimated';
        completionStatus = 'projected';
        uncompletedEvidence = 'estimated_fee';
      } else if (totalOccurrences <= 1 && /(?:已扣款|已扣费|已扣費|扣款成功|扣费成功|扣費成功|已扣除|已扣收)/.test(clause.text) && !/(?:预计|預計|预估|預估|待|未|拟|擬)/.test(clause.text)) {
        role = 'fee_deducted';
        direction = 'expense';
        feeRelation = 'deducted';
        completionStatus = 'complete';
        completionEvidence = 'clause_fee_deducted';
      } else if (totalOccurrences > 1) {
        role = 'fee_separate';
        direction = 'expense';
        feeRelation = 'separate';
        completionStatus = 'unproven';
      } else {
        role = 'fee_unproven';
        direction = 'expense';
        feeRelation = 'unproven';
        completionStatus = 'unproven';
      }
    } else if (LABEL_PAID.test(before)) {
      role = 'paid_label';
      direction = 'expense';
      completionStatus = 'unproven';
    } else if (LABEL_RECEIVED.test(before)) {
      role = 'received_label';
      direction = 'income';
      completionStatus = 'unproven';
    } else if (LABEL_REFUND.test(before)) {
      role = 'refund_label';
      direction = 'refund';
      completionStatus = 'unproven';
    } else if (PREFIX_PAID.test(before)) {
      role = 'paid';
      direction = 'expense';
      completionStatus = 'complete';
      const hit = PAYMENT_COMPLETION_PREDICATES.find(t => before.includes(t));
      completionEvidence = hit || 'prefix_paid';
      if (hit) {
        const bIdx = normText.lastIndexOf(hit, start);
        if (bIdx >= 0) completionEvidenceSpan = { start: bIdx, end: bIdx + hit.length };
      }
    } else if (PREFIX_RECEIVED.test(before)) {
      role = 'received';
      direction = 'income';
      completionStatus = 'complete';
      const hit = RECEIPT_COMPLETION_PREDICATES.find(t => before.includes(t));
      completionEvidence = hit || 'prefix_received';
      if (hit) {
        const bIdx = normText.lastIndexOf(hit, start);
        if (bIdx >= 0) completionEvidenceSpan = { start: bIdx, end: bIdx + hit.length };
      }
    } else if (PREFIX_REFUND.test(before)) {
      role = 'refund';
      direction = 'refund';
      completionStatus = 'complete';
      const hit = REFUND_COMPLETION_PREDICATES.find(t => before.includes(t));
      completionEvidence = hit || 'prefix_refund';
      if (hit) {
        const bIdx = normText.lastIndexOf(hit, start);
        if (bIdx >= 0) completionEvidenceSpan = { start: bIdx, end: bIdx + hit.length };
      }
    }

    // Secondary completion check within the SAME operation scope AND matching predicate category
    if (['paid_label', 'received_label', 'refund_label'].includes(role)) {
      let allowedPredicates = [];
      if (role === 'paid_label') allowedPredicates = PAYMENT_COMPLETION_PREDICATES;
      else if (role === 'received_label') allowedPredicates = RECEIPT_COMPLETION_PREDICATES;
      else if (role === 'refund_label') allowedPredicates = REFUND_COMPLETION_PREDICATES;

      // Look strictly within the SAME operation scope
      const scopeStart = Math.max(opScope.start, clause.start);
      const scopeEnd = Math.min(opScope.end, clause.end);
      const localText = normText.slice(scopeStart, scopeEnd);

      for (const term of allowedPredicates) {
        const termPos = localText.indexOf(term);
        if (termPos !== -1) {
          const absTermStart = scopeStart + termPos;
          const absTermEnd = absTermStart + term.length;

          // Ensure no operation boundary marker intervenes between amount and predicate
          const between = absTermStart > end ? normText.slice(end, absTermStart) : normText.slice(absTermEnd, start);
          if (!OPERATION_MARKER_REGEX.test(between)) {
            completionStatus = 'complete';
            completionEvidence = term;
            completionEvidenceSpan = { start: absTermStart, end: absTermEnd };
            if (role === 'paid_label') role = 'paid';
            if (role === 'received_label') role = 'received';
            if (role === 'refund_label') role = 'refund';
            break;
          }
        }
      }
    }

    // Number parsing & precision
    let digits = 2;
    let amountMinor = 0;
    let precisionError = false;
    try {
      digits = currencyDigits(currency);
      amountMinor = parseMoney(raw, currency);
    } catch (err) {
      if (err.code === 'amount_precision') precisionError = true;
    }

    facts.push({
      raw,
      start,
      end,
      currency,
      currency_precision: digits,
      amount_minor: amountMinor,
      role,
      direction,
      scope: {
        order_id: opScope.marker,
        order_start: opScope.start,
        order_end: opScope.end,
        clause_index: clauseIndex,
      },
      completion: {
        status: completionStatus,
        evidence: completionEvidence,
        evidence_span: completionEvidenceSpan,
        uncompleted_evidence: uncompletedEvidence,
        uncompleted_span: uncompletedSpan,
      },
      fee_relation: feeRelation,
      precision_error: precisionError,
      from_default: Boolean(curInfo.fromDefault),
      is_bare_symbol: Boolean(curInfo.isBareSymbol),
      unverified_currency: Boolean(curInfo.unverified),
      currency_span: curInfo.evidenceSpan || null,
      currency_evidence: curInfo.evidence || null,
    });
  }

  // --- Admission Gating Evaluation ---
  const admission = evaluateAdmission({
    text: normText,
    facts,
    operationScopes,
    globalCodeList,
    defaultCurrency,
    declaredCurrency,
  });

  return { facts, orderScopes: operationScopes, clauses, admission };
}

function evaluateAdmission({ text, facts, operationScopes, globalCodeList, defaultCurrency, declaredCurrency }) {
  // Currency gate
  const unsupportedCodes = globalCodeList.filter(c => !SUPPORTED_CURRENCIES.has(c));
  if (unsupportedCodes.length > 0) {
    return { decision: 'REVIEW', reason: 'currency_review_required', currency: unsupportedCodes[0], amount_minor: 0, direction: 'unknown' };
  }

  // Currency digits validity
  for (const code of globalCodeList) {
    try { currencyDigits(code); } catch {
      return { decision: 'REVIEW', reason: 'currency_review_required', currency: code, amount_minor: 0, direction: 'unknown' };
    }
  }

  const distinctCurrencies = new Set(facts.map(f => f.currency).filter(c => c && c !== 'XXX'));
  if (distinctCurrencies.size > 1 || globalCodeList.length > 1) {
    return { decision: 'REVIEW', reason: 'currency_review_required', currency: [...distinctCurrencies][0] || 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  const hasAmbiguous = hasAmbiguousCurrencySymbol(text);
  if (hasAmbiguous) {
    if (globalCodeList.length > 0 || facts.length > 1 || !defaultCurrency) {
      return { decision: 'REVIEW', reason: 'currency_review_required', currency: [...distinctCurrencies][0] || 'XXX', amount_minor: 0, direction: 'unknown' };
    }
  }

  if (facts.some(f => f.unverified_currency || f.currency === 'XXX')) {
    return { decision: 'REVIEW', reason: 'currency_review_required', currency: 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  // Precision gate
  if (facts.some(f => f.precision_error)) {
    return { decision: 'REVIEW', reason: 'amount_precision', currency: facts[0]?.currency || 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  // Invalid numbers
  if (/\d(?:\.\d+)?[eE][+-]?\d/.test(text) || /(?:^|[^\d])-\d/.test(text)) {
    return { decision: 'REVIEW', reason: 'amount_invalid', currency: facts[0]?.currency || 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  // Fee review gate: separate, estimated, or unproven fees
  if (facts.some(f => f.role === 'fee_separate' || f.role === 'fee_estimated' || f.role === 'fee_unproven')) {
    return { decision: 'REVIEW', reason: 'fee_review_required', currency: facts[0]?.currency || 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  // Projected transaction gate
  if (facts.some(f => f.role === 'projected_transaction' || f.completion.status === 'projected')) {
    return { decision: 'REVIEW', reason: 'amount_ambiguous', currency: facts[0]?.currency || 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  // Distinct operation markers check
  const distinctOperations = new Set(operationScopes.filter(s => s.marker).map(s => s.marker));
  if (distinctOperations.size > 1) {
    const hasCompletedInAnyOperation = facts.some(f => ['paid', 'received', 'refund', 'fee_deducted'].includes(f.role) && f.completion.status === 'complete');
    return {
      decision: 'REVIEW',
      reason: hasCompletedInAnyOperation ? 'amount_ambiguous' : 'completion_unproven',
      currency: facts[0]?.currency || 'XXX',
      amount_minor: 0,
      direction: 'unknown',
    };
  }

  // Declared currency conflict with explicit facts
  if (declaredCurrency) {
    const explicitFacts = facts.filter(f => !f.from_default && f.currency !== 'XXX');
    if (explicitFacts.some(f => f.currency !== declaredCurrency)) {
      return { decision: 'REVIEW', reason: 'currency_review_required', currency: declaredCurrency, amount_minor: 0, direction: 'unknown' };
    }
  }

  // Candidates for formal booking
  const candidates = facts.filter(f =>
    ['paid', 'received', 'refund', 'fee_deducted'].includes(f.role) &&
    f.completion.status === 'complete'
  );

  if (candidates.length === 1) {
    const candidate = candidates[0];

    // If candidate relies on default currency, but text has explicit conflicting currency in globalCodeList:
    if (candidate.from_default && globalCodeList.some(code => code !== candidate.currency)) {
      return { decision: 'REVIEW', reason: 'currency_review_required', currency: candidate.currency, amount_minor: 0, direction: 'unknown' };
    }

    // Check if there are other unproven transaction labels that conflict
    if (facts.some(f => ['paid_label', 'received_label', 'refund_label'].includes(f.role))) {
      return { decision: 'REVIEW', reason: 'amount_ambiguous', currency: candidate.currency, amount_minor: 0, direction: 'unknown' };
    }

    return {
      decision: 'AUTO',
      reason: 'transaction_completed',
      currency: candidate.currency,
      amount_minor: candidate.amount_minor,
      direction: candidate.direction,
      amount_exponent: candidate.currency_precision,
      target_fact: candidate,
      currency_review_required: candidate.from_default || false,
      currency_decision_source: candidate.from_default ? 'account_default' : undefined,
    };
  }

  if (candidates.length > 1) {
    return {
      decision: 'REVIEW',
      reason: 'amount_ambiguous',
      currency: candidates[0].currency,
      amount_minor: 0,
      direction: 'unknown',
    };
  }

  // candidates.length === 0
  if (facts.length === 0) {
    return { decision: 'NON_FINANCIAL', reason: 'amount_missing', currency: 'XXX', amount_minor: 0, direction: 'unknown' };
  }

  const allAuxiliary = facts.every(f => f.role === 'auxiliary');
  if (allAuxiliary) {
    const allCompletionPredicates = [
      ...PAYMENT_COMPLETION_PREDICATES,
      ...RECEIPT_COMPLETION_PREDICATES,
      ...REFUND_COMPLETION_PREDICATES,
    ];
    const hasCompletionTerm = allCompletionPredicates.some(term => text.includes(term));
    if (hasCompletionTerm) {
      return { decision: 'REVIEW', reason: 'amount_missing', currency: facts[0].currency, amount_minor: 0, direction: 'unknown' };
    }
    return { decision: 'NON_FINANCIAL', reason: 'amount_missing', currency: facts[0].currency, amount_minor: 0, direction: 'unknown' };
  }

  if (facts.some(f => ['paid_label', 'received_label', 'refund_label'].includes(f.role))) {
    return { decision: 'REVIEW', reason: 'completion_unproven', currency: facts[0].currency, amount_minor: 0, direction: 'unknown' };
  }

  return { decision: 'REVIEW', reason: 'amount_missing', currency: facts[0].currency, amount_minor: 0, direction: 'unknown' };
}
