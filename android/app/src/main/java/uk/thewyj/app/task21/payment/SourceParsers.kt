package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection

/** WeChat payment messages. "昵称 + 转账" is a hint, never a transaction. */
object WeChatPaymentParser : PaymentMessageParser {
    override val version = "wechat-2"
    override val channel = "wechat"

    override fun matches(sourcePackage: String, sourceType: PaymentSourceType): Boolean =
        sourceType == PaymentSourceType.NOTIFICATION && sourcePackage == "com.tencent.mm"

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        subText: String,
        capturedAtMs: Long,
    ): ParsedPaymentMessage {
        val normalized = PaymentText.normalize(title, text, bigText, subText)
        if (normalized.isEmpty()) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("empty"))
        }
        if (PaymentText.isNegative(normalized) && !PaymentText.hasCompletion(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("wechat_negative_terms"),
            )
        }
        val amount = PaymentText.amountMinor(normalized)
        val direction = PaymentText.direction(normalized)
        // A payment-channel notification ("微信支付 / 转账199元") is a real
        // settlement even without the "转账成功" wording; ordinary chat with a
        // sender prefix or chat wording stays out of the finance pipeline.
        val paymentTitle = PaymentText.isPaymentChannelTitle(title)
        // "张三：已支付100" is a chat bubble: the sender prefix wins over any
        // verb inside the message, so a friend cannot fake a ledger entry.
        if (!paymentTitle && PaymentText.hasSenderPrefix(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("wechat_chat_sender_prefix"),
            )
        }
        val explicitCompletion = PaymentText.hasCompletion(normalized)
        val completion = explicitCompletion || (paymentTitle && amount != null && direction != null)
        val hint = PaymentText.hasPaymentHint(normalized)
        val merchant = PaymentText.merchant(normalized)
        val reference = PaymentText.providerReference(normalized)

        if (!hint && amount == null) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("wechat_not_payment"))
        }
        if (!hint && !completion && amount != null && !PaymentText.hasStrongCurrencyMarker(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("wechat_amount_without_payment_context"),
            )
        }
        // WeChat chat and WeChat Pay share the same package: a chat sentence
        // that merely mentions 转账 must stay out of the finance pipeline.
        val chatContext = PaymentText.isChatLike(normalized) || PaymentText.hasSenderPrefix(normalized)
        if (!explicitCompletion && !paymentTitle && chatContext) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("wechat_chat_context"),
            )
        }
        val missing = buildSet {
            if (amount == null) add("amount")
            if (direction == null) add("direction")
        }
        return when {
            amount != null && direction != null && completion -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.CONFIRMED_PAYMENT,
                amountMinor = amount,
                currency = "CNY",
                direction = direction,
                merchant = merchant,
                paymentChannel = channel,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 940,
                reasons = listOf("wechat_completion_with_amount"),
            )
            amount != null && direction != null -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                amountMinor = amount,
                currency = "CNY",
                direction = direction,
                merchant = merchant,
                paymentChannel = channel,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 820,
                reasons = listOf("wechat_amount_without_completion"),
            )
            amount != null -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                amountMinor = amount,
                currency = "CNY",
                paymentChannel = channel,
                merchant = merchant,
                occurredAtMs = capturedAtMs,
                confidence = 700,
                reasons = listOf("wechat_amount_without_direction"),
                missingFields = setOf("direction"),
            )
            // 昵称 + 转账 without an amount: needs enrichment, never a transaction.
            else -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                paymentChannel = channel,
                occurredAtMs = capturedAtMs,
                confidence = 460,
                reasons = listOf("wechat_payment_hint_without_amount"),
                missingFields = missing,
            )
        }
    }
}

object AlipayPaymentParser : PaymentMessageParser {
    override val version = "alipay-2"
    override val channel = "alipay"

    override fun matches(sourcePackage: String, sourceType: PaymentSourceType): Boolean =
        sourceType == PaymentSourceType.NOTIFICATION && sourcePackage == "com.eg.android.AlipayGphone"

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        subText: String,
        capturedAtMs: Long,
    ): ParsedPaymentMessage {
        val normalized = PaymentText.normalize(title, text, bigText, subText)
        if (normalized.isEmpty()) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("empty"))
        }
        if (PaymentText.isNegative(normalized) && !PaymentText.hasCompletion(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("alipay_negative_terms"),
            )
        }
        val amount = PaymentText.amountMinor(normalized)
        val direction = PaymentText.direction(normalized)
        val paymentTitle = PaymentText.isPaymentChannelTitle(title)
        if (!paymentTitle && PaymentText.hasSenderPrefix(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("alipay_chat_sender_prefix"),
            )
        }
        val explicitCompletion = PaymentText.hasCompletion(normalized)
        val completion = explicitCompletion || (paymentTitle && amount != null && direction != null)
        val hint = PaymentText.hasPaymentHint(normalized)
        if (!hint && amount == null) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("alipay_not_payment"))
        }
        if (!hint && !completion && amount != null && !PaymentText.hasStrongCurrencyMarker(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("alipay_amount_without_payment_context"),
            )
        }
        if (!explicitCompletion && !paymentTitle &&
            (PaymentText.isChatLike(normalized) || PaymentText.hasSenderPrefix(normalized))
        ) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("alipay_chat_context"),
            )
        }
        val merchant = PaymentText.merchant(normalized)
        val reference = PaymentText.providerReference(normalized)
        return when {
            amount != null && direction != null && completion -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.CONFIRMED_PAYMENT,
                amountMinor = amount,
                currency = "CNY",
                direction = direction,
                merchant = merchant,
                paymentChannel = channel,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 930,
                reasons = listOf("alipay_completion_with_amount"),
            )
            amount != null && direction != null -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                amountMinor = amount,
                currency = "CNY",
                direction = direction,
                merchant = merchant,
                paymentChannel = channel,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 800,
                reasons = listOf("alipay_amount_without_completion"),
            )
            amount != null -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                amountMinor = amount,
                currency = "CNY",
                paymentChannel = channel,
                merchant = merchant,
                occurredAtMs = capturedAtMs,
                confidence = 690,
                reasons = listOf("alipay_amount_without_direction"),
                missingFields = setOf("direction"),
            )
            // Payment-like copy without an amount: enrichment target only.
            else -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.INSUFFICIENT_INFORMATION,
                paymentChannel = channel,
                occurredAtMs = capturedAtMs,
                confidence = 420,
                reasons = listOf("alipay_hint_without_amount"),
                missingFields = buildSet {
                    add("amount")
                    if (direction == null) add("direction")
                },
            )
        }
    }
}

/** Bank app notifications: strong evidence once an amount is visible. */
object BankNotificationParser : PaymentMessageParser {
    override val version = "bank-notification-2"
    override val channel = "bank"

    private val bankPackages = setOf(
        "com.icbc", "com.chinamworld.main", "com.ccb.longjiLife", "cmb.pb", "com.bankcomm.Bankcomm",
        "com.cmbchina.ccd.pluto.cmbActivity", "com.spdbccc.app", "com.unionpay", "com.eg.android.AlipayGphone.Bank",
        "com.pingan.paces.ccms", "com.cgbchina.xpt", "com.bank.abc", "com.boc.bocsoft.mobile.bocmobile",
    )

    override fun matches(sourcePackage: String, sourceType: PaymentSourceType): Boolean {
        if (sourceType !in setOf(PaymentSourceType.NOTIFICATION, PaymentSourceType.BANK_NOTIFICATION)) return false
        if (sourcePackage in bankPackages) return true
        return sourcePackage.contains("bank", ignoreCase = true) ||
            sourcePackage.contains("icbc", ignoreCase = true) ||
            sourcePackage.contains("boc", ignoreCase = true) ||
            sourcePackage.contains("cmb", ignoreCase = true)
    }

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        subText: String,
        capturedAtMs: Long,
    ): ParsedPaymentMessage {
        val normalized = PaymentText.normalize(title, text, bigText, subText)
        if (normalized.isEmpty()) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("empty"))
        }
        // "请登录查看" is a normal bank message; only OTP/marketing/balance
        // wording means the notification itself is not a transaction.
        if (PaymentText.isBankExcluded(normalized) && !PaymentText.hasCompletion(normalized)) {
            return ParsedPaymentMessage(
                PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("bank_negative_terms"),
            )
        }
        val amount = PaymentText.amountMinor(normalized)
        val direction = PaymentText.direction(normalized)
        val tail = PaymentText.accountTail(normalized)
        val reference = PaymentText.providerReference(normalized)
        val transactionHint = PaymentText.hasCompletion(normalized) ||
            PaymentText.hasPaymentHint(normalized) ||
            normalized.contains("动账") || normalized.contains("動賬") ||
            normalized.contains("交易提醒")
        if (!transactionHint) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("bank_not_transaction"))
        }
        return when {
            amount != null && direction != null -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.CONFIRMED_PAYMENT,
                amountMinor = amount,
                currency = "CNY",
                direction = direction,
                paymentChannel = channel,
                accountTail = tail,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 950,
                reasons = listOf("bank_notification_amount_and_direction"),
            )
            amount != null -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                amountMinor = amount,
                currency = "CNY",
                paymentChannel = channel,
                accountTail = tail,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 760,
                reasons = listOf("bank_notification_amount_without_direction"),
                missingFields = setOf("direction"),
            )
            else -> ParsedPaymentMessage(
                status = PaymentRecognitionStatus.INSUFFICIENT_INFORMATION,
                paymentChannel = channel,
                accountTail = tail,
                occurredAtMs = capturedAtMs,
                confidence = 400,
                reasons = listOf("bank_notification_without_amount"),
                missingFields = buildSet {
                    add("amount")
                    if (direction == null) add("direction")
                },
            )
        }
    }
}

/**
 * Bank SMS. Order matters: OTP, marketing and balance reminders must be
 * rejected before any amount is considered a transaction.
 */
object BankSmsParser : PaymentMessageParser {
    override val version = "bank-sms-2"
    override val channel = "bank_sms"

    private val institutions = listOf(
        "工商银行", "农业银行", "中国银行", "建设银行", "交通银行", "招商银行", "邮储银行", "邮政储蓄",
        "中信银行", "浦发银行", "民生银行", "兴业银行", "光大银行", "华夏银行", "平安银行", "广发银行",
        "北京银行", "上海银行", "宁波银行", "江苏银行", "网商银行", "微众银行",
        "ICBC", "ABC", "BOC", "CCB", "CMB", "SPDB", "CITIC", "CEB", "PSBC",
    )

    private val otpTerms = listOf(
        "验证码", "驗證碼", "校验码", "動態密碼", "动态密码", "动态码", "OTP", "一次性密码", "短信密码",
    )
    private val marketingTerms = listOf(
        "优惠", "優惠", "活动", "活動", "积分", "積分", "抽奖", "邀请", "推薦", "推荐", "升级", "禮品", "礼品",
        "贷款", "貸款", "授信", "理财", "理財", "基金", "定期存款", "分期优惠", "刷卡金", "返现活动",
    )
    private val balanceTerms = listOf(
        "余额为", "餘額為", "当前余额", "當前餘額", "可用余额", "可用額度", "额度提醒", "額度提醒",
        "账单已出", "帳單已出", "还款日", "還款日", "请及时还款", "請及時還款", "账单提醒", "帳單提醒",
    )

    override fun matches(sourcePackage: String, sourceType: PaymentSourceType): Boolean =
        sourceType == PaymentSourceType.SMS

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        subText: String,
        capturedAtMs: Long,
    ): ParsedPaymentMessage {
        val normalized = PaymentText.normalize(title, text, bigText, subText)
        if (normalized.isEmpty()) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("empty"))
        }
        if (otpTerms.any { normalized.contains(it, ignoreCase = true) }) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("sms_otp"))
        }
        if (marketingTerms.any { normalized.contains(it) }) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("sms_marketing"))
        }
        if (balanceTerms.any { normalized.contains(it) }) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("sms_balance_reminder"))
        }
        val institution = institutions.firstOrNull { normalized.contains(it, ignoreCase = true) }
        val amount = PaymentText.amountMinor(normalized)
        val direction = PaymentText.direction(normalized)
        val tail = PaymentText.accountTail(normalized)
        val reference = PaymentText.providerReference(normalized)
        val transactionLike = PaymentText.hasCompletion(normalized) || PaymentText.hasPaymentHint(normalized)
        if (!transactionLike) {
            return ParsedPaymentMessage(PaymentRecognitionStatus.NOT_PAYMENT, reasons = listOf("sms_not_transaction"))
        }
        if (amount == null) {
            return ParsedPaymentMessage(
                status = PaymentRecognitionStatus.INSUFFICIENT_INFORMATION,
                paymentChannel = channel,
                accountTail = tail,
                merchant = institution,
                occurredAtMs = capturedAtMs,
                confidence = 380,
                reasons = listOf("sms_without_amount"),
                missingFields = buildSet {
                    add("amount")
                    if (direction == null) add("direction")
                },
            )
        }
        if (direction == null) {
            return ParsedPaymentMessage(
                status = PaymentRecognitionStatus.PAYMENT_LIKELY,
                amountMinor = amount,
                currency = "CNY",
                paymentChannel = channel,
                accountTail = tail,
                merchant = institution,
                providerReference = reference,
                occurredAtMs = capturedAtMs,
                confidence = 700,
                reasons = listOf("sms_amount_without_direction"),
                missingFields = setOf("direction"),
            )
        }
        return ParsedPaymentMessage(
            status = PaymentRecognitionStatus.CONFIRMED_PAYMENT,
            amountMinor = amount,
            currency = "CNY",
            direction = direction,
            paymentChannel = channel,
            accountTail = tail,
            merchant = institution,
            providerReference = reference,
            occurredAtMs = capturedAtMs,
            confidence = 930,
            reasons = listOf("sms_transaction_with_amount"),
        )
    }
}

internal fun FinanceDirectionOrNull(value: String): FinanceDirection? =
    runCatching { FinanceDirection.valueOf(value) }.getOrNull()
