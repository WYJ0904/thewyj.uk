package uk.thewyj.app.task21

import kotlin.math.roundToLong

data class ParserInput(
    val sourcePackage: String,
    val title: String,
    val text: String,
    val bigText: String,
    val subText: String,
    /** Additional local-only payload fields; never uploaded. */
    val infoText: String = "",
    val summaryText: String = "",
    val textLines: List<String> = emptyList(),
)

data class ParserOutput(
    val eventType: NotificationEventType,
    val parseStatus: ParseStatus,
    val direction: FinanceDirection,
    val amountMinor: Long,
    val currency: String,
    val paymentChannel: String,
    val merchant: String,
    val counterparty: String,
    val confidence: Int,
    val occurredAtMs: Long,
)

interface NotificationParser {
    val version: String
    val paymentChannel: String
    fun matches(sourcePackage: String): Boolean
    fun parse(input: ParserInput, receivedAtMs: Long): ParserOutput
}

private object NotificationTerms {
    val refund = listOf(
        "退款", "退回", "已退", "原路退回", "退款到账", "退款成功", "退还", "撤销交易", "冲正", "返还",
        "退款到賬", "退還", "撤銷交易", "沖正", "返還",
    )
    val income = listOf(
        "收款", "到账", "入账", "收入", "转入", "收到转账", "收到转帐", "收到付款", "向你付款",
        "向你转账", "收款成功", "红包收入", "已收款", "成功收款", "已到账", "已入账",
        "到賬", "入賬", "轉入", "收到轉賬", "收到轉帳", "向你轉賬", "紅包收入",
    )
    val expense = listOf(
        "消费", "支付成功", "付款成功", "已付款", "扣款成功", "扣费成功", "已扣款", "已扣费", "支出",
        "扫码付款", "向商家付款", "信用卡消费", "银行卡支付", "转出", "转账成功", "账户转出",
        "已支付", "已消费", "已付款",
        "消費", "扣費成功", "已扣費", "掃碼付款", "信用卡消費", "銀行卡支付", "轉出", "轉賬成功",
    )
    val strongCompletion = listOf(
        "支付成功", "付款成功", "扣款成功", "扣费成功", "已扣款", "已扣费", "退款成功", "退款到账",
        "收款成功", "已到账", "已入账", "转账成功", "支付已完成", "交易成功",
        "已支付", "已付款", "已消费", "已消費", "已转账", "已轉賬",
        "扣費成功", "已扣費", "退款到賬", "已到賬", "已入賬", "轉賬成功", "交易成功",
    )
    val marketing = listOf(
        "最高额度", "信用额度", "授信额度", "可用额度", "贷款额度", "借款额度", "额度提升", "提额",
        "最高可借", "可借", "低息贷款", "贷款推荐", "优惠券", "代金券", "折扣券", "满减", "原价",
        "到手价", "秒杀价", "商品价格", "促销", "推广", "营销", "抽奖", "赢取", "免费领取", "点击购买",
        "信用額度", "授信額度", "貸款額度", "優惠券", "代金券", "折扣券", "滿減", "促銷", "推廣", "營銷",
    )
    val verification = listOf(
        "验证码", "验证码", "校验码", "动态码", "登录验证", "身份验证", "安全验证",
        "驗證碼", "驗證碼", "校驗碼", "動態碼", "登錄驗證", "身份驗證", "安全驗證",
    )
}

private fun normalizeText(input: ParserInput): String {
    return (listOf(input.title, input.text, input.bigText, input.subText, input.infoText, input.summaryText)
        + input.textLines)
        .filter { it.isNotBlank() }
        .joinToString(" ")
        .replace(Regex("""[\r\n\u3000]+"""), " ")
        .replace(Regex("""\s+"""), " ")
        .replace(",", "")
        .trim()
}

private fun containsAny(text: String, terms: List<String>): Boolean = terms.any { text.contains(it) }

private fun extractAmountMinor(text: String): Long {
    // One shared normalizer for every payment parser: currency symbols, 元/块,
    // explicit amount labels and "payment verb + plain number" (已支付100).
    val minor = uk.thewyj.app.task21.payment.PaymentText.amountMinor(text) ?: return 0
    return if (minor in 1..100_000_000_000L) minor else 0
}

private fun extractMerchant(text: String, direction: FinanceDirection): String {
    if (direction == FinanceDirection.UNKNOWN) return ""
    val patterns = listOf(
        Regex("""(?:商户|商户名称|收款方|付款方|对方)[:：]?\s*([\p{L}\p{N}（）()·\-]{1,40})"""),
        Regex("""向\s*([\p{L}\p{N}（）()·\-]{1,40})\s*(?:付款|转账|支付)"""),
    )
    for (pattern in patterns) {
        val match = pattern.find(text) ?: continue
        val value = match.groupValues[1].trim()
        if (value.isNotBlank() && value.length <= 160) return value
    }
    return ""
}

private class StructuredParser(
    override val version: String,
    override val paymentChannel: String,
    private val packageNames: Set<String>,
) : NotificationParser {
    override fun matches(sourcePackage: String): Boolean = sourcePackage in packageNames

    override fun parse(input: ParserInput, receivedAtMs: Long): ParserOutput {
        val text = normalizeText(input)
        if (text.isBlank()) {
            return ParserOutput(
                NotificationEventType.OTHER, ParseStatus.UNPARSED, FinanceDirection.UNKNOWN,
                0, "CNY", paymentChannel, "", "", 0, receivedAtMs,
            )
        }

        val completed = containsAny(text, NotificationTerms.strongCompletion)
        if (containsAny(text, NotificationTerms.marketing) && !completed) {
            return ParserOutput(
                NotificationEventType.MARKETING, ParseStatus.UNPARSED, FinanceDirection.UNKNOWN,
                0, "CNY", paymentChannel, "", "", 0, receivedAtMs,
            )
        }
        if (containsAny(text, NotificationTerms.verification) && !completed) {
            return ParserOutput(
                NotificationEventType.VERIFICATION, ParseStatus.UNPARSED, FinanceDirection.UNKNOWN,
                0, "CNY", paymentChannel, "", "", 0, receivedAtMs,
            )
        }

        val direction = when {
            containsAny(text, NotificationTerms.refund) -> FinanceDirection.REFUND
            containsAny(text, NotificationTerms.income) -> FinanceDirection.INCOME
            containsAny(text, NotificationTerms.expense) -> FinanceDirection.EXPENSE
            else -> FinanceDirection.UNKNOWN
        }
        if (direction == FinanceDirection.UNKNOWN) {
            return ParserOutput(
                NotificationEventType.OTHER, ParseStatus.UNPARSED, FinanceDirection.UNKNOWN,
                0, "CNY", paymentChannel, "", "", 0, receivedAtMs,
            )
        }

        val amountMinor = extractAmountMinor(text)
        val merchant = extractMerchant(text, direction)
        val eventType = if (direction == FinanceDirection.REFUND) NotificationEventType.REFUND
        else NotificationEventType.TRANSACTION

        var confidence = 0
        if (direction != FinanceDirection.UNKNOWN) confidence += 250
        if (completed) confidence += 300
        if (amountMinor > 0) confidence += 300
        if (merchant.isNotBlank()) confidence += 150
        // The parser only matches supported payment packages, so a structured
        // payment notification is stronger evidence than plain text.
        if (paymentChannel.isNotBlank()) confidence += 100
        confidence = confidence.coerceIn(0, 1000)

        val parseStatus = when {
            direction != FinanceDirection.UNKNOWN && amountMinor > 0 && completed -> ParseStatus.PARSED
            direction != FinanceDirection.UNKNOWN && amountMinor > 0 -> ParseStatus.CANDIDATE
            else -> ParseStatus.UNPARSED
        }

        return ParserOutput(
            eventType, parseStatus, direction, amountMinor, "CNY", paymentChannel,
            merchant, merchant, confidence, receivedAtMs,
        )
    }
}

object WeChatNotificationParser : NotificationParser by StructuredParser(
    version = "wechat-v1",
    paymentChannel = "wechat",
    packageNames = setOf("com.tencent.mm"),
)

object AlipayNotificationParser : NotificationParser by StructuredParser(
    version = "alipay-v1",
    paymentChannel = "alipay",
    packageNames = setOf("com.eg.android.AlipayGphone", "com.alipay.android.app"),
)

object NotificationParserRegistry {
    private val parsers = listOf(WeChatNotificationParser, AlipayNotificationParser)

    fun parserFor(sourcePackage: String): NotificationParser? {
        return parsers.firstOrNull { it.matches(sourcePackage) }
    }
}

