// Notification/SMS attribution only. Keep this contract aligned with Android's
// NotificationCashEvidence; accessibility/OCR uses its existing page verifier.
const VOUCHERS = /优惠券|優惠券|代金券|折扣券|立减券|立減券|餐券|超市券|购物券|購物券|现金券|現金券|礼券|禮券|抵用券|消费券|消費券|券包|卡券|退券|领券|領券|赠券|贈券/u;
const CURRENCY = "(?:人民币|人民幣|RMB|CNY|￥|¥)";
const UNITS = "(?:元|圓|块|塊|CNY|RMB|人民币|人民幣)";
const FUTURE_OR_VOUCHER_GAP = /满|滿|可享|可获|可獲|可赠|可贈|可领|可領|后|後|即可|赠|贈|领取|領取|发放|發放|返还|返還/u;
const BARE_GAP = /^[\s:：，]*$/u;
const IMMEDIATE_VOUCHER = new RegExp(`^\\s*(?:的)?(?:${VOUCHERS.source})`, "u");
const VOUCHER_SUBJECT = new RegExp(`(?:${VOUCHERS.source})\\s*(?:已|已经|已經)?\\s*$`, "u");
const FUTURE_SUFFIX = /^\s*(?:可(?:享|获|獲|赠|贈|领|領)|即可|后|後)/u;
const GENERIC_ARRIVAL = new Set(["到账", "到賬", "已到账", "已到賬", "入账", "入賬", "入帳", "已入账", "已入賬"]);
const CASH_REWARD = /返现|返現|现金|現金|银行卡|銀行卡|余额|餘額/gu;
const RULES = [
  ["实际退款|實際退款|退款金额|退款金額|退款成功|退款已到账|退款已到賬|退款到账|退款到賬|已退款|原路退回|退款", "退款成功"],
  ["实付款|實付款|实付|實付|实际支付|實際支付|实际付款|實際付款|付款金额|付款金額|支付金额|支付金額|"
    + "扣款金额|扣款金額|消费金额|消費金額|已支付|已付款|支付成功|付款成功|支付已完成|付款已完成|"
    + "已扣款|已扣费|已扣費|扣款成功|扣费成功|扣費成功|消费成功|消費成功|转出成功|轉出成功|已转出|已轉出|"
    + "支付|付款|消费|消費|扣款|扣费|扣費|转出|轉出", "支付成功"],
  ["收款金额|收款金額|实际收入|實際收入|现金收入|現金收入|收款成功|已收款|收到转账|收到轉賬|"
    + "转入成功|轉入成功|已转入|已轉入|返现已到账|返現已到賬|返现到账|返現到賬|"
    + "已到账|已到賬|已入账|已入賬|到账|到賬|入账|入賬|入帳|收款|转入|轉入", "收款成功"],
].map(([prefixes, canonicalVerb]) => ({
  canonicalVerb,
  pattern: new RegExp(`(${prefixes})([^0-9，。；;]{0,24}?)(${CURRENCY})?\\s*`
    + `([0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[0-9]{1,8}(?:\\.[0-9]{1,2})?)(?![0-9.,\\-~～–—])\\s*(${UNITS})?`, "giu"),
}));

/** null means voucher-only; other text retains only attributed cash facts. */
export function notificationCashText(normalized) {
  if (!VOUCHERS.test(normalized)) return normalized;
  const facts = [];
  for (const { pattern, canonicalVerb } of RULES) {
    // A discarded weak/title match cannot hide a later actual receipt verb.
    for (const match of overlappingMatches(normalized, pattern)) {
      const prefix = match[1];
      const gap = match[2];
      if (VOUCHER_SUBJECT.test(normalized.slice(0, match.index))) continue;
      if (VOUCHERS.test(gap) || FUTURE_OR_VOUCHER_GAP.test(gap)) continue;
      const strong = /成功|金额|金額/u.test(prefix) || /^(?:已|实|實|返现|返現)/u.test(prefix);
      if (!strong && !BARE_GAP.test(gap)) continue;
      const suffix = normalized.slice(match.index + match[0].length);
      if (IMMEDIATE_VOUCHER.test(suffix)) continue;
      if (!strong && FUTURE_SUFFIX.test(suffix)) continue;
      if (GENERIC_ARRIVAL.has(prefix)) {
        const before = normalized.slice(0, match.index);
        const clauseStart = Math.max(...["，", "。", "；", ";", "!", "！"].map((separator) => before.lastIndexOf(separator))) + 1;
        const subject = normalized.slice(clauseStart, match.index);
        const voucherMatches = [...subject.matchAll(new RegExp(VOUCHERS.source, "gu"))];
        const voucher = voucherMatches.at(-1);
        const voucherAt = voucher ? voucher.index + voucher[0].length - 1 : -1;
        const cashAt = [...subject.matchAll(CASH_REWARD)].at(-1)?.index ?? -1;
        if (voucherAt >= 0 && cashAt <= voucherAt) continue;
      }
      const amount = match[4].replaceAll(",", "");
      const value = Number(amount);
      if (!(value > 0 && value <= 10000000)) continue;
      facts.push({ index: match.index, text: `${canonicalVerb} ¥${amount}` });
    }
  }
  const cashFacts = [...new Set(facts.sort((a, b) => a.index - b.index).map((fact) => fact.text))];
  return cashFacts.length ? cashFacts.join(" ") : null;
}

function* overlappingMatches(text, pattern) {
  let offset = 0;
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) return;
    yield match;
    offset = match.index + 1;
  }
}
