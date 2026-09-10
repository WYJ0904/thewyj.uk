package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection

/**
 * Shared text analysis for payment parsers. Everything here is pure: it never
 * guesses a missing value and keeps the matched snippet as evidence.
 */
internal object PaymentText {
    private val amountPatterns = listOf(
        Regex("""(?:人民币|人民幣|RMB|CNY|￥|¥)\s*([0-9][0-9,]*\.?[0-9]{0,2})""", RegexOption.IGNORE_CASE),
        Regex("""([0-9][0-9,]*\.?[0-9]{0,2})\s*(?:元|圓|块|塊)"""),
        Regex(
            """(?:交易金额|交易金額|付款金额|付款金額|支付金额|支付金額|收款金额|收款金額|扣款金额|扣款金額|退款金额|退款金額|消费金额|消費金額|金额|金額)[:：]?\s*([0-9][0-9,]*\.?[0-9]{0,2})""",
        ),
    )

    val completionTerms = listOf(
        "支付成功", "付款成功", "已支付", "已付款", "扣款成功", "扣费成功", "已扣款", "已扣费",
        "交易成功", "消费成功", "消費成功", "收款成功", "已收款", "到账", "已到账", "入账", "已入账",
        "转账成功", "转出成功", "转入成功", "退款成功", "退款到账", "已退款", "原路退回",
        "支付已完成", "交易已完成", "扣款", "付款已完成",
        "到賬", "已到賬", "入賬", "已入賬", "轉賬成功", "退款到賬",
    )

    val paymentHints = listOf(
        "支付", "付款", "扫码", "掃碼", "消费", "消費", "扣款", "扣费", "扣費", "交易", "转账", "轉賬",
        "转帐", "轉帳", "收款", "退款", "退回", "收款码", "收款碼", "收钱", "收錢", "付款码", "付款碼",
        "花呗", "花唄", "余额宝", "餘額寶", "账单", "帳單", "钱包", "錢包", "卡包",
    )

    /** Payment-looking but never a transaction on its own. */
    val negativeTerms = listOf(
        "验证码", "驗證碼", "校验码", "校驗碼", "动态码", "動態碼", "短信验证", "安全验证", "登录验证",
        "登录", "登入", "密码", "密碼", "口令", "动态口令",
        "营销", "營銷", "推广", "推廣", "活动", "活動", "优惠", "優惠", "优惠券", "優惠券", "满减", "滿減",
        "折扣", "秒杀", "秒殺", "抽奖", "抽獎", "积分", "積分", "会员日", "會員日", "推荐", "推薦",
        "额度", "額度", "可借", "借款额度", "提额", "提額", "贷款", "貸款", "授信",
        "还款日", "還款日", "账单日", "帳單日", "请及时还款", "請及時還款",
        "余额提醒", "餘額提醒", "余额为", "餘額為", "当前余额", "當前餘額", "可用余额",
        "签到", "簽到", "红包封面", "升級", "升级活动", "新功能", "隐私政策", "服務協議", "服务协议",
    )

    val incomeTerms = listOf(
        "收款", "收到", "到账", "到賬", "入账", "入賬", "收入", "转入", "轉入", "红包", "紅包",
        "向你付款", "向你转账", "向你轉賬", "已收款", "入帳",
    )

    val expenseTerms = listOf(
        "支付", "付款", "消费", "消費", "扣款", "扣费", "扣費", "支出", "转出", "轉出", "扫码付款",
        "掃碼付款", "向商家付款", "已扣款", "已扣費",
    )

    val refundTerms = listOf("退款", "退回", "退还", "退還", "已退款", "原路退回", "冲正", "沖正", "返还", "返還")

    /**
     * Bank notifications may legitimately say "请登录查看"; only these terms
     * mean the message itself is not a transaction.
     */
    val bankExcludedTerms = listOf(
        "验证码", "驗證碼", "校验码", "校驗碼", "动态码", "動態碼", "动态密码", "動態密碼", "密码", "密碼",
        "营销", "營銷", "优惠", "優惠", "活动", "活動", "积分", "積分", "抽奖", "抽獎", "推荐", "推薦",
        "额度", "額度", "可借", "贷款", "貸款", "授信", "理财", "理財", "基金",
        "余额提醒", "餘額提醒", "余额为", "餘額為", "当前余额", "當前餘額", "可用余额",
        "还款日", "還款日", "账单日", "帳單日", "账单已出", "帳單已出", "请及时还款", "請及時還款",
    )

    fun normalize(title: String, text: String, bigText: String, subText: String): String =
        (listOf(title, text, bigText, subText) + listOf(text.split('\n').firstOrNull().orEmpty()))
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .replace(Regex("""[\r\n\u3000]+"""), " ")
            .replace(Regex("""\s+"""), " ")
            .replace(",", "")
            .trim()

    fun amountMinor(normalized: String): Long? {
        for (pattern in amountPatterns) {
            val match = pattern.find(normalized) ?: continue
            val raw = match.groupValues.getOrNull(1).orEmpty().replace(",", "")
            val value = raw.toDoubleOrNull() ?: continue
            if (value <= 0.0 || value > 10_000_000.0) continue
            return Math.round(value * 100.0)
        }
        return null
    }

    fun direction(normalized: String): FinanceDirection? = when {
        refundTerms.any { normalized.contains(it) } -> FinanceDirection.REFUND
        incomeTerms.any { normalized.contains(it) } -> FinanceDirection.INCOME
        expenseTerms.any { normalized.contains(it) } -> FinanceDirection.EXPENSE
        else -> null
    }

    fun isNegative(normalized: String): Boolean = negativeTerms.any { normalized.contains(it) }

    fun isBankExcluded(normalized: String): Boolean = bankExcludedTerms.any { normalized.contains(it) }

    fun hasPaymentHint(normalized: String): Boolean = paymentHints.any { normalized.contains(it) }

    fun hasCompletion(normalized: String): Boolean = completionTerms.any { normalized.contains(it) }

    /** Card or account tail such as 尾号1234 / 尾號1234 / ****1234. */
    fun accountTail(normalized: String): String? {
        val patterns = listOf(
            Regex("""(?:尾号|尾號|卡号末四位|卡號末四位|末四位|结尾|結尾)[:：]?\s*([0-9]{4})"""),
            Regex("""(?:尾号|尾號)[:：]?\s*([0-9]{4})"""),
            Regex("""\*{2,}([0-9]{4})"""),
        )
        for (pattern in patterns) {
            val match = pattern.find(normalized) ?: continue
            return match.groupValues.getOrNull(1)?.takeIf { it.length == 4 }
        }
        return null
    }

    /** Order / transaction reference provided by the source. */
    fun providerReference(normalized: String): String? {
        val patterns = listOf(
            Regex("""(?:订单号|訂單號|交易号|交易號|流水号|流水號|凭证号|憑證號|参考号|參考號)[:：]?\s*([A-Za-z0-9_-]{6,40})"""),
            Regex("""(?:订单|訂單)\s*([A-Za-z0-9_-]{8,40})"""),
        )
        for (pattern in patterns) {
            val match = pattern.find(normalized) ?: continue
            return match.groupValues.getOrNull(1)
        }
        return null
    }

    /** Merchant / counterparty after 向/在/于 with a short trailing token. */
    fun merchant(normalized: String): String? {
        val patterns = listOf(
            Regex("""(?:向|給|给)\s*([^\s，,。;；]{2,24}?)(?:付款|支付|转账|轉賬|转帐|付了)"""),
            Regex("""(?:在|于|於)\s*([^\s，,。;；]{2,24}?)(?:消费|消費|支付|付款|购买|購買)"""),
            Regex("""(?:商户|商戶|收款方|对方|對方|商家)[:：]\s*([^\s，,。;；]{2,24})"""),
        )
        for (pattern in patterns) {
            val match = pattern.find(normalized) ?: continue
            val value = match.groupValues.getOrNull(1)?.trim().orEmpty()
            if (value.isNotEmpty()) return value
        }
        return null
    }
}
