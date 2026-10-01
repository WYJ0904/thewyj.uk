package uk.thewyj.app.task21.payment

/**
 * Notification/SMS-only attribution. A voucher's face value, arrival in a
 * voucher wallet and a future spend threshold are not cash movements.
 *
 * Text without vouchers keeps the existing parser contract. Mixed receipts
 * keep only amounts bound to cash verbs/labels; merchant/reference extraction
 * still uses the original text. This helper is deliberately not used by the
 * accessibility or screenshot verifier.
 */
internal object NotificationCashEvidence {
    private val vouchers = Regex(
        "优惠券|優惠券|代金券|折扣券|立减券|立減券|餐券|超市券|购物券|購物券|" +
            "现金券|現金券|礼券|禮券|抵用券|消费券|消費券|券包|卡券|退券|领券|領券|赠券|贈券",
    )
    private val currency = "(?:人民币|人民幣|RMB|CNY|￥|¥)"
    private val units = "(?:元|圓|块|塊|CNY|RMB|人民币|人民幣)"
    private val futureOrVoucherGap = Regex("满|滿|可享|可获|可獲|可赠|可贈|可领|可領|后|後|即可|赠|贈|领取|領取|发放|發放|返还|返還")
    private val bareGap = Regex("[\\s:：，]*")
    private val immediateVoucher = Regex("^\\s*(?:的)?(?:" + vouchers.pattern + ")")
    private val voucherSubject = Regex("(?:" + vouchers.pattern + ")\\s*(?:已|已经|已經)?\\s*$")
    private val futureSuffix = Regex("^\\s*(?:可(?:享|获|獲|赠|贈|领|領)|即可|后|後)")
    private val genericArrival = setOf("到账", "到賬", "已到账", "已到賬", "入账", "入賬", "入帳", "已入账", "已入賬")
    private val cashReward = Regex("返现|返現|现金|現金|银行卡|銀行卡|余额|餘額")

    private data class Rule(val prefixes: String, val canonicalVerb: String)
    private val rules = listOf(
        Rule("实际退款|實際退款|退款金额|退款金額|退款成功|退款已到账|退款已到賬|退款到账|退款到賬|已退款|原路退回|退款", "退款成功"),
        Rule("实付款|實付款|实付|實付|实际支付|實際支付|实际付款|實際付款|付款金额|付款金額|支付金额|支付金額|" +
            "扣款金额|扣款金額|消费金额|消費金額|已支付|已付款|支付成功|付款成功|支付已完成|付款已完成|" +
            "已扣款|已扣费|已扣費|扣款成功|扣费成功|扣費成功|消费成功|消費成功|转出成功|轉出成功|已转出|已轉出|" +
            "支付|付款|消费|消費|扣款|扣费|扣費|转出|轉出", "支付成功"),
        Rule("收款金额|收款金額|实际收入|實際收入|现金收入|現金收入|收款成功|已收款|收到转账|收到轉賬|" +
            "转入成功|轉入成功|已转入|已轉入|返现已到账|返現已到賬|返现到账|返現到賬|" +
            "已到账|已到賬|已入账|已入賬|到账|到賬|入账|入賬|入帳|收款|转入|轉入", "收款成功"),
    )
    private val patterns = rules.map { rule ->
        rule to Regex("(${rule.prefixes})([^0-9，。；;]{0,24}?)($currency)?\\s*" +
            "([0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[0-9]{1,8}(?:\\.[0-9]{1,2})?)(?![0-9.,\\-~～–—])\\s*($units)?", RegexOption.IGNORE_CASE)
    }

    /** Null means voucher-only; otherwise the returned text describes cash. */
    fun cashText(normalized: String): String? {
        if (!vouchers.containsMatchIn(normalized)) return normalized
        val facts = mutableListOf<Pair<Int, String>>()
        for ((rule, pattern) in patterns) {
            // Rejected weak/title matches must not consume a later real
            // receipt verb in the same string (微信支付 支付成功实付¥0.01).
            val matches = generateSequence(pattern.find(normalized)) { previous ->
                pattern.find(normalized, previous.range.first + 1)
            }
            for (match in matches) {
                val prefix = match.groupValues[1]
                val gap = match.groupValues[2]
                if (voucherSubject.containsMatchIn(normalized.substring(0, match.range.first))) continue
                if (vouchers.containsMatchIn(gap) || futureOrVoucherGap.containsMatchIn(gap)) continue
                // Weak verbs cannot consume arbitrary advertising prose before
                // the number (e.g. 消费满5,000); strong receipt labels may.
                val strong = prefix.contains("成功") || prefix.startsWith("已") ||
                    prefix.contains("金额") || prefix.contains("金額") ||
                    prefix.startsWith("实") || prefix.startsWith("實") || prefix.startsWith("返现") || prefix.startsWith("返現")
                if (!strong && !bareGap.matches(gap)) continue
                val end = match.range.last + 1
                val suffix = normalized.substring(end)
                if (immediateVoucher.containsMatchIn(suffix)) continue
                if (!strong && futureSuffix.containsMatchIn(suffix)) continue
                // In 优惠券已到账¥6 the subject of 到账 is the voucher. A
                // separate actual cashback/account clause remains income.
                if (prefix in genericArrival) {
                    val clauseStart = normalized.substring(0, match.range.first)
                        .lastIndexOfAny(charArrayOf('，', '。', '；', ';', '!', '！')).let { it + 1 }
                    val subject = normalized.substring(clauseStart, match.range.first)
                    val voucherAt = vouchers.findAll(subject).lastOrNull()?.range?.last ?: -1
                    val cashAt = cashReward.findAll(subject).lastOrNull()?.range?.first ?: -1
                    if (voucherAt >= 0 && cashAt <= voucherAt) continue
                }
                val rawAmount = match.groupValues[4].replace(",", "")
                val value = rawAmount.toDoubleOrNull() ?: continue
                if (value <= 0 || value > 10_000_000) continue
                facts.add(match.range.first to "${rule.canonicalVerb} ¥$rawAmount")
            }
        }
        return facts.sortedBy { it.first }.map { it.second }.distinct()
            .takeIf { it.isNotEmpty() }?.joinToString(" ")
    }
}
