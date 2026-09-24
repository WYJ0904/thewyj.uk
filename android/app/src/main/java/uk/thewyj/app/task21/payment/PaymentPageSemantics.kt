package uk.thewyj.app.task21.payment

/**
 * Minimal, safe reading of a payment page. The accessibility service only ever
 * feeds text from the foreground page of the package that owns an active
 * ticket; this extractor then keeps just the fields a transaction needs.
 *
 * It never keeps the whole node tree, never takes screenshots and never returns
 * passwords, OTPs or chat history.
 */
data class PaymentPageSnapshot(
    val sourcePackage: String,
    val textLines: List<String>,
    val capturedAtMs: Long,
)

object PaymentPageSemantics {
    private val sensitiveMarkers = listOf("密码", "密碼", "验证码", "驗證碼", "身份證", "身份证", "银行卡号", "銀行卡號")

    fun extract(snapshot: PaymentPageSnapshot): PaymentEnrichment? {
        val lines = snapshot.textLines
            .map { it.trim() }
            .filter { it.isNotEmpty() && it.length <= 120 }
        if (lines.isEmpty()) return null
        val joined = lines.joinToString(" ")
        if (sensitiveMarkers.any { joined.contains(it) }) {
            // A password / OTP page is never enrichment material.
            return null
        }
        // OCR / real pages can show several amounts (order total, fee, balance).
        // Without a decisive label the page is ambiguous and must go to manual
        // confirmation instead of guessing one number.
        val amounts = PaymentText.amountsMinor(joined)
        if (amounts.size > 1 && !PaymentText.hasDecisiveAmountLabel(joined)) return null
        // With a decisive label the labelled amount wins over the first number on
        // the page (商品 ¥100 运费 ¥12 实付 ¥112 must book 112).
        val amount = PaymentText.decisiveAmountMinor(joined) ?: amounts.firstOrNull()
        // A generic "交易成功" proves completion, not whether money entered or
        // left the account. Only page wording that identifies the direction may
        // complete the booking; ambiguous pages keep the same identity pending.
        val direction = PaymentText.direction(joined)
        val detailPage = listOf("交易详情", "交易詳情", "账单详情", "賬單詳情", "转账详情", "轉賬詳情")
            .any(joined::contains)
        if (amount == null && !(detailPage && PaymentText.hasCompletion(joined) && direction != null)) return null
        val merchant = PaymentText.merchant(joined)
        val reference = PaymentText.providerReference(joined)
        val confidence = when {
            PaymentText.hasCompletion(joined) && reference != null -> 900
            PaymentText.hasCompletion(joined) -> 820
            else -> 640
        }
        return PaymentEnrichment(
            sourcePackage = snapshot.sourcePackage,
            amountMinor = amount,
            currency = "CNY",
            direction = direction,
            merchant = merchant,
            counterparty = null,
            providerReference = reference,
            occurredAtMs = snapshot.capturedAtMs,
            confidence = confidence,
        )
    }
}
