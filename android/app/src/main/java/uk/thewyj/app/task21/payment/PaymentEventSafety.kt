package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection
import java.math.BigDecimal

/** Structured evidence only. No FX, OCR inference, body hash or time-window identity. */
internal object PaymentEventSafety {
    private val iso = Regex("(?<![A-Za-z])(?:CNY|USD|EUR|HKD|GBP|JPY)(?![A-Za-z])", RegexOption.IGNORE_CASE)
    private val supportedUnits = setOf("CNY", "USD", "EUR", "HKD", "GBP", "JPY")
    private val isoCodes by lazy { java.util.Currency.getAvailableCurrencies().map { it.currencyCode }.toSet() }
    private val additionalIso = Regex("(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])")
    private val reference = Regex("(?:授权号|授權號|授权参考号|authorization\\s+(?:id|reference))[:：]?\\s*([A-Za-z0-9_-]{6,40})", RegexOption.IGNORE_CASE)
    private val partial = Regex("(?:预授权)?部分(?:预授权)?(?:结算|清算|扣款|解除|退款)|partial\\s+(?:settlement|release|refund)", RegexOption.IGNORE_CASE)
    private val revision = Regex("(?:状态版本|状态修订|state\\s+version)[:：]?\\s*([1-9][0-9]{0,8})(?![0-9])", RegexOption.IGNORE_CASE)
    private val phases = listOf(
        "EXPIRED" to Regex("预授权(?:自动)?(?:过期|失效)|authorization\\s+expired", RegexOption.IGNORE_CASE),
        "RELEASED" to Regex("预授权(?:解除|撤销|取消)|authorization\\s+(?:release|released|cancelled)", RegexOption.IGNORE_CASE),
        "SETTLED" to Regex("(?:结算|清算)成功|posted\\s+settlement", RegexOption.IGNORE_CASE),
        "REFUNDED" to Regex("退款成功|已退款|posted\\s+refund", RegexOption.IGNORE_CASE),
        "AUTHORIZED" to Regex("预授权|預授權|pending\\s+authorization", RegexOption.IGNORE_CASE),
    )
    fun namespace(source: String, channel: String): String = when (channel) {
        "wechat", "alipay" -> channel
        "bank_card", "bank", "bank_sms" -> when (source) {
            "cmb.pb", "com.cmbchina.ccd.pluto.cmbActivity", "95555", "10695555" -> "bank_card:cmb"
            "com.icbc", "95588", "10695588" -> "bank_card:icbc"
            else -> "bank_card:" + source.lowercase()
        }
        else -> source.lowercase()
    }
    /** Money direction already separates ordinary refunds; phase separates holds from settlement. */
    fun role(phase: String): String = if (phase == "REFUNDED") "" else phase
    fun canSettle(phase: String): Boolean = phase in setOf("", "SETTLED", "REFUNDED")

    fun apply(parsed: ParsedPaymentMessage, source: String, sourceType: PaymentSourceType,
              title: String, text: String, bigText: String, subText: String): ParsedPaymentMessage {
        val all = PaymentText.normalize(title, text, bigText, subText)
        val partialMatch = partial.find(all)?.value.orEmpty()
        val phase = if (partialMatch.isNotBlank()) when {
            Regex("退款|refund", RegexOption.IGNORE_CASE).containsMatchIn(partialMatch) -> "REFUNDED"
            Regex("解除|release", RegexOption.IGNORE_CASE).containsMatchIn(partialMatch) -> "RELEASED"
            else -> "SETTLED"
        } else phases.firstOrNull { it.second.containsMatchIn(all) }?.first.orEmpty()
        // A financial lifecycle is only accepted from the existing bank/SMS parser family.
        val bankLifecycle = phase.isNotBlank() &&
            (phase != "REFUNDED" || reference.containsMatchIn(all) || !PaymentText.providerReference(all).isNullOrBlank() ||
                all.contains("预授权") || all.contains("預授權")) &&
            sourceType in setOf(PaymentSourceType.SMS, PaymentSourceType.BANK_NOTIFICATION, PaymentSourceType.NOTIFICATION) &&
            (parsed.paymentChannel == "bank_card" || sourceType == PaymentSourceType.SMS || BankNotificationParser.matches(source, sourceType))
        if (parsed.status in setOf(PaymentRecognitionStatus.NOT_PAYMENT, PaymentRecognitionStatus.PARSE_ERROR) &&
            (!bankLifecycle || PaymentText.isNegative(all))) return parsed
        var financialPhase = if (bankLifecycle) phase else ""
        val codes = iso.findAll(all).map { it.value.uppercase() }.toMutableSet()
        additionalIso.findAll(all).filter { hit ->
            val before = all.substring(0, hit.range.first)
            val after = all.substring(hit.range.last + 1)
            Regex("^\\s*[:：]?\\s*[0-9]").containsMatchIn(after) ||
                Regex("[0-9][0-9.,]*\\s*$").containsMatchIn(before) ||
                Regex("(?:币种|幣種|currency)\\s*[:：]?\\s*$", RegexOption.IGNORE_CASE).containsMatchIn(before)
        }.map { it.value.uppercase() }.filter { it in isoCodes }.forEach(codes::add)
        if (Regex("人民币|人民幣|RMB|[¥￥]", RegexOption.IGNORE_CASE).containsMatchIn(all)) codes.add("CNY")
        var currency = parsed.currency
        var amount = parsed.amountMinor
        var review = ""
        if (codes.size > 1) {
            currency = codes.first(); amount = null; review = "currency_evidence_conflict"
        } else if (codes.size == 1 && codes.first() !in supportedUnits) {
            currency = codes.first(); amount = null; review = "unsupported_iso_currency"
        } else if (codes.size == 1 && codes.first() != "CNY") {
            currency = codes.first()
            val unit = currency
            val number = "([0-9][0-9,]*(?:\\.[0-9]+)?)"
            val patterns = listOf(Regex("(?<![A-Za-z])$unit\\s*$number(?![0-9.,])", RegexOption.IGNORE_CASE),
                Regex("(?<![0-9.,])$number\\s*$unit(?![A-Za-z])", RegexOption.IGNORE_CASE))
            val amounts = patterns.flatMap { p -> p.findAll(all).map { it.groupValues[1] }.toList() }
                .mapNotNull { raw -> if (unit == "JPY") runCatching {
                    if (!Regex("[1-9][0-9]{0,7}").matches(raw)) return@runCatching null
                    BigDecimal(raw).longValueExact()
                }.getOrNull() else PaymentText.parseMinor(raw) }.distinct()
            amount = amounts.singleOrNull()
            if (amount == null) review = "currency_amount_unproven"
        }
        val ref = PaymentText.providerReference(all).orEmpty()
        val lifeRef = if (financialPhase.isNotBlank()) reference.find(all)?.groupValues?.get(1) ?: ref else ""
        if (financialPhase.isNotBlank() && lifeRef.isBlank()) review = "lifecycle_reference_missing"
        val operation = if (financialPhase.isBlank()) "" else when (financialPhase) {
            "AUTHORIZED" -> "AUTHORIZE"
            "SETTLED" -> "CAPTURE"
            "REFUNDED" -> "REFUND"
            "RELEASED" -> if (partialMatch.isNotBlank()) "RELEASE" else "CLOSE"
            "EXPIRED" -> "CLOSE"
            else -> ""
        }
        val stateRevision = revision.find(all)?.groupValues?.get(1)?.toLongOrNull() ?: 0
        // Partial facts require an independent operation reference and an explicit family.
        if (financialPhase.isNotBlank() && partialMatch.isNotBlank() &&
            (ref.isBlank() || lifeRef.isBlank() || ref == lifeRef || !reference.containsMatchIn(all))) {
            financialPhase = "REVIEW_REQUIRED"
            review = "partial_clearing_requires_review"
        }
        if (financialPhase.isNotBlank() && stateRevision > 1) review = "lifecycle_revision_requires_reconciliation"
        val direction = if (financialPhase == "REFUNDED") FinanceDirection.REFUND
            else if (financialPhase.isNotBlank()) FinanceDirection.EXPENSE else parsed.direction
        val settled = canSettle(financialPhase) && review.isBlank() && amount != null && direction != null &&
            (parsed.status == PaymentRecognitionStatus.CONFIRMED_PAYMENT || financialPhase in setOf("SETTLED", "REFUNDED"))
        return parsed.copy(
            status = if (settled) PaymentRecognitionStatus.CONFIRMED_PAYMENT else if (financialPhase.isNotBlank() || review.isNotBlank()) PaymentRecognitionStatus.PAYMENT_LIKELY else parsed.status,
            amountMinor = amount, currency = currency, direction = direction,
            providerReference = ref.ifBlank { parsed.providerReference },
            paymentChannel = if (bankLifecycle) "bank_card" else parsed.paymentChannel,
            financialPhase = financialPhase, lifecycleReference = lifeRef,
            referenceNamespace = namespace(source, if (bankLifecycle) "bank_card" else parsed.paymentChannel),
            currencyEvidence = codes.joinToString(","), reviewReason = review,
            lifecycleOperation = operation, lifecycleRevision = stateRevision,
            reasons = (parsed.reasons + listOfNotNull(financialPhase.takeIf(String::isNotBlank)?.let { "financial_phase_" + it.lowercase() }, review.takeIf(String::isNotBlank))).distinct(),
            missingFields = parsed.missingFields + if (review.isNotBlank()) setOf("review") else emptySet(),
        )
    }
}
