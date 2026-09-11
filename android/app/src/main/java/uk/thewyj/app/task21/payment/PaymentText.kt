package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection

/**
 * Shared text analysis for payment parsers. Everything here is pure: it never
 * guesses a missing value and keeps the matched snippet as evidence.
 */
internal object PaymentText {
    private val amountPatterns = listOf(
        Regex("""(?:人民币|人民幣|RMB|CNY|￥|¥)\s*([0-9][0-9,]*\.?[0-9]{0,2})""", RegexOption.IGNORE_CASE),
        Regex("""([0-9][0-9,]*\.?[0-9]{0,2})\s*(?:元|圓|块|塊|CNY|RMB|人民币|人民幣)""", RegexOption.IGNORE_CASE),
        Regex(
            """(?:交易金额|交易金額|付款金额|付款金額|支付金额|支付金額|收款金额|收款金額|扣款金额|扣款金額|退款金额|退款金額|消费金额|消費金額|金额|金額)[:：]?\s*([0-9][0-9,]*\.?[0-9]{0,2})""",
        ),
    )

    /**
     * "明确支付语义 + 明确数字" is a real amount even without a currency
     * symbol: 已支付100 / 支付 100 / 付款100 元 all mean 100 CNY. The number has
     * to sit directly behind a payment verb, and order/reference/date-like
     * windows are rejected so phone numbers and order ids never become money.
     */
    private val paymentVerbs = listOf(
        "已支付", "已付款", "支付成功", "付款成功", "已扣款", "已扣费", "扣款成功", "扣费成功",
        "交易成功", "收款成功", "已收款", "已到账", "到账", "已入账", "入账", "退款成功", "已退款",
        "转账成功", "转出成功", "转入成功", "支付", "付款", "扣款", "扣费", "消费", "收款",
        "转账", "轉賬", "转帐", "轉帳", "转出", "轉出", "转入", "轉入", "退款", "退回",
    )

    private val verbAlternation = paymentVerbs.joinToString("|")

    private val bareAmountPatterns = listOf(
        // 已支付100 / 支付 100
        Regex(
            """(?:$verbAlternation)\s*[:：]?\s*([0-9][0-9,]{0,12}(?:\.[0-9]{1,2})?)(?![0-9A-Za-z\-/:])""",
        ),
        // 100 已支付 / 100元 支付成功
        Regex(
            """(?<![0-9A-Za-z])([0-9][0-9,]{0,12}(?:\.[0-9]{1,2})?)\s*(?:元|圓|块|塊)?\s*(?:$verbAlternation)""",
        ),
    )

    private val amountNoiseTerms = listOf(
        "订单号", "訂單號", "单号", "單號", "交易号", "交易號", "流水号", "流水號", "参考号", "參考號",
        "凭证号", "憑證號", "编号", "編號", "序号", "序號", "工号", "尾号", "尾號", "卡号", "卡號",
        "账号", "賬號", "账户", "賬戶", "电话", "電話", "手机", "手機", "验证码", "驗證碼", "校验码",
        "校驗碼", "动态码", "動態碼", "日期", "时间", "時間", "余额", "餘額", "额度", "額度", "积分",
        "積分", "订单", "訂單", "物流", "快递", "快遞", "车牌", "車牌", "房间", "房號", "有效期",
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
        // "向张三转账" / "转账给商家" describe an outgoing transfer. Incoming
        // wording (收款/到账/向你转账) is checked before expenses, so it wins.
        "转账", "轉賬", "转帐", "轉帳", "转给",
    )

    val refundTerms = listOf("退款", "退回", "退还", "退還", "已退款", "原路退回", "冲正", "沖正", "返还", "返還")

    /** Unambiguous "money left my account" wording. */
    private val outgoingCompletionTerms = listOf(
        "付款成功", "支付成功", "已支付", "已付款", "付款完成", "支付完成", "扣款成功", "已扣款", "消费成功",
    )

    /** Unambiguous "money arrived" wording. */
    private val incomingCompletionTerms = listOf(
        "收款成功", "已收款", "收款到账", "到账", "到賬", "入账", "入賬", "入帳", "收到转账", "收到轉賬",
    )

    /**
     * Labels that describe the *other side* of a payment. They must not decide
     * the direction: 「收款方 示例商户」 on an outgoing payment page is a payee,
     * not income.
     */
    private val payeeLabelTerms = listOf(
        "收款方", "收款账户", "收款賬戶", "收款人", "收款账号", "收款帳號", "收款方名称", "收款方名稱",
    )

    /**
     * Ordinary chat wording. WeChat chat and WeChat Pay share one package, so a
     * message like "明天给你转账" must never become a finance candidate just
     * because it contains 转账.
     */
    val chatTerms = listOf(
        "撤回了一条消息", "拍了拍", "邀请你加入群聊", "群聊", "朋友圈", "公众号", "订阅号",
        "语音通话", "视频通话", "新消息", "未读", "在吗", "下班", "明天", "后天", "晚点",
        "一会儿", "帮我", "记得", "哈哈", "笑死", "有空", "见面", "聊", "约", "先这样",
    )

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
        return bareAmountMinor(normalized)
    }

    /**
     * Every distinct amount on the page, in reading order. Used to detect
     * ambiguous pages (order total + fee + balance) that must stay manual.
     */
    fun amountsMinor(normalized: String): List<Long> {
        val found = mutableListOf<Long>()
        for (pattern in amountPatterns) {
            for (match in pattern.findAll(normalized)) {
                val raw = match.groupValues.getOrNull(1).orEmpty().replace(",", "")
                val value = raw.toDoubleOrNull() ?: continue
                if (value <= 0.0 || value > 10_000_000.0) continue
                found.add(Math.round(value * 100.0))
            }
        }
        bareAmountMinor(normalized)?.let { found.add(it) }
        return found.distinct()
    }

    /**
     * Labels that make one amount authoritative even when the page shows more
     * than one (实付 / 订单金额 / 付款金额).
     */
    fun hasDecisiveAmountLabel(normalized: String): Boolean =
        decisiveAmountLabels.any { normalized.contains(it) }

    /**
     * The amount that follows a decisive label (实付 / 订单金额 / 付款金额 …). On a
     * page with several numbers this is the only one that may be booked.
     */
    fun decisiveAmountMinor(normalized: String): Long? {
        for (label in decisiveAmountLabels) {
            val index = normalized.indexOf(label)
            if (index < 0) continue
            val window = normalized.substring(index, minOf(normalized.length, index + label.length + 20))
            for (pattern in amountPatterns) {
                val match = pattern.find(window) ?: continue
                val raw = match.groupValues.getOrNull(1).orEmpty().replace(",", "")
                val value = raw.toDoubleOrNull() ?: continue
                if (value <= 0.0 || value > 10_000_000.0) continue
                return Math.round(value * 100.0)
            }
        }
        return null
    }

    private val decisiveAmountLabels = listOf(
        "实付", "实付款", "付款金额", "订单金额", "支付金额", "交易金额", "扣款金额", "转账金额", "收款金额",
    )

    /** Amount that is only implied by "payment verb + plain number". */
    fun bareAmountMinor(normalized: String): Long? {
        for (match in bareAmountPatterns.flatMap { pattern -> pattern.findAll(normalized).map { pattern to it } }
            .sortedBy { (_, match) -> match.range.first }) {
            val (_, hit) = match
            val raw = hit.groupValues.getOrNull(1).orEmpty().replace(",", "")
            val digits = raw.substringBefore('.').length
            val value = raw.toDoubleOrNull() ?: continue
            if (value <= 0.0 || value > 10_000_000.0) continue
            // A bare 8+ digit run is a reference number, not money.
            if (!raw.contains('.') && digits > 7) continue
            val start = (hit.range.first - 12).coerceAtLeast(0)
            val end = (hit.range.last + 13).coerceAtMost(normalized.length)
            val window = normalized.substring(start, end)
            if (amountNoiseTerms.any { window.contains(it) }) continue
            return Math.round(value * 100.0)
        }
        return null
    }

    /**
     * Real-device finding (Alipay/bank detail pages): the payee label 收款方 /
     * 收款账户 contains the income keyword 收款, so a page that says 付款成功
     * was classified as income. Explicit completion wording now wins, and payee
     * labels are removed before the weaker keyword scan.
     */
    fun direction(normalized: String): FinanceDirection? {
        if (refundTerms.any { normalized.contains(it) }) return FinanceDirection.REFUND
        val outgoing = outgoingCompletionTerms.any { normalized.contains(it) }
        val incoming = incomingCompletionTerms.any { normalized.contains(it) }
        if (outgoing && !incoming) return FinanceDirection.EXPENSE
        if (incoming && !outgoing) return FinanceDirection.INCOME
        val sanitized = payeeLabelTerms.fold(normalized) { text, label -> text.replace(label, "") }
        return when {
            incomeTerms.any { sanitized.contains(it) } -> FinanceDirection.INCOME
            expenseTerms.any { sanitized.contains(it) } -> FinanceDirection.EXPENSE
            else -> null
        }
    }

    fun isNegative(normalized: String): Boolean = negativeTerms.any { normalized.contains(it) }

    fun isChatLike(normalized: String): Boolean = chatTerms.any { normalized.contains(it) }

    /**
     * Payment-channel notification titles (微信支付 / 收款助手 / 支付宝 …).
     * WeChat chat and WeChat Pay share one package, so the title is the strongest
     * signal that a "转账199元" message is a real payment instead of a chat line.
     */
    private val paymentChannelTitles = listOf(
        "微信支付", "微信收款", "收款助手", "支付助手", "转账助手", "服务通知", "微信支付凭证",
        "支付宝", "余额宝", "花呗", "收钱码",
    )

    fun isPaymentChannelTitle(value: String): Boolean =
        paymentChannelTitles.any { value.contains(it) }

    /** "张三：转账199元" — a chat bubble with a sender prefix. */
    fun hasSenderPrefix(value: String): Boolean =
        Regex("""^[^:：\n]{1,12}[:：]\s*\S""").containsMatchIn(value.trim())

    fun isBankExcluded(normalized: String): Boolean = bankExcludedTerms.any { normalized.contains(it) }

    fun hasPaymentHint(normalized: String): Boolean = paymentHints.any { normalized.contains(it) }

    /**
     * A currency symbol or an explicit amount label. Plain "100 元" inside a
     * chat sentence is not enough on its own: without a payment word or a
     * symbol it would turn ordinary chat into a finance candidate.
     */
    fun hasStrongCurrencyMarker(normalized: String): Boolean =
        listOf("¥", "￥", "CNY", "RMB", "人民币", "人民幣", "交易金额", "交易金額", "付款金额",
            "付款金額", "支付金额", "支付金額", "收款金额", "收款金額", "扣款金额", "扣款金額",
            "退款金额", "退款金額", "消费金额", "消費金額", "金额", "金額")
            .any { marker -> normalized.contains(marker, ignoreCase = true) }

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
