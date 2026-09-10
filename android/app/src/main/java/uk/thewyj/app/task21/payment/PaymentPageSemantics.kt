package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection

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
        val amount = PaymentText.amountMinor(joined) ?: return null
        val direction = PaymentText.direction(joined) ?: FinanceDirection.EXPENSE.takeIf {
            PaymentText.hasCompletion(joined)
        }
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
