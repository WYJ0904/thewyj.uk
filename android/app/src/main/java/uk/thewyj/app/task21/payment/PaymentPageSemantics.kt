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
    val amountTokenGroups: List<List<String>> = emptyList(),
)

object PaymentPageSemantics {
    private val sensitiveMarkers = listOf("密码", "密碼", "验证码", "驗證碼", "身份證", "身份证", "银行卡号", "銀行卡號")

    /** Resolve the ISO unit first, then reuse the same semantic amount ranking. No FX conversion. */
    private fun labelledCurrencyAmount(lines: List<String>, groups: List<List<String>>, currency: String): Long? {
        val marker=when(currency) {
            "USD" -> Regex("US\\$|USD|\\$",RegexOption.IGNORE_CASE)
            "HKD" -> Regex("HK\\$|HKD|\\$",RegexOption.IGNORE_CASE)
            "EUR" -> Regex("EUR|€",RegexOption.IGNORE_CASE)
            "GBP" -> Regex("GBP|£",RegexOption.IGNORE_CASE)
            "JPY" -> Regex("JP[¥￥]|JPY|日元|円|[¥￥]",RegexOption.IGNORE_CASE)
            else -> Regex("CNY|RMB|人民币|人民幣|[¥￥]",RegexOption.IGNORE_CASE)
        }
        fun canonical(text:String)=marker.replace(text,"¥")
        val selected=PaymentPageAmountSelection.select(lines.map(::canonical),groups.map { it.map(::canonical) })
        if (selected.amountMinor==null || !selected.reason.startsWith("selected_")) return null
        val raw=selected.candidates.filter { it.minor==selected.amountMinor }.maxByOrNull { it.score }?.normalizedNumber ?: return null
        return runCatching { uk.thewyj.app.finance.CurrencyMoney.parse(raw,currency) }.getOrNull()?.takeIf { it>0 }
    }

    /** Keep an exact candidate for manual unit review without relaxing extract's compatibility contract. */
    fun unresolvedCandidate(snapshot: PaymentPageSnapshot): PaymentEnrichment? {
        val lines=snapshot.textLines.map(PaymentText::normalizeMoneyText).filter { it.isNotEmpty() && it.length<=120 }
        if (lines.isEmpty() || PaymentPageEvidence.blocked(lines) || !PaymentPageContext.isDetail(lines)) return null
        val decision=PaymentPageAmountSelection.select(lines,snapshot.amountTokenGroups)
        if (decision.amountMinor==null || !decision.reason.startsWith("selected_")) return null
        val currency=uk.thewyj.app.finance.CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY),lines.joinToString(" "),null,true)
        if (currency.reviewReason!="currency_review_required" || currency.currency!=null) return null
        val raw=decision.candidates.filter { it.minor==decision.amountMinor }.maxByOrNull { it.score }?.normalizedNumber ?: return null
        if (!Regex("(?:0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,2})?").matches(raw)) return null
        return PaymentEnrichment(snapshot.sourcePackage,null,null,null,null,null,null,null,820,
            completionConfirmed=false,sourceInstanceUncertain=true,amountDecimalCandidate=raw)
    }

    fun extract(snapshot: PaymentPageSnapshot, defaultCurrency: String? = null, currencyPolicyVersion: Int = 1): PaymentEnrichment? {
        val lines = snapshot.textLines
            .map(PaymentText::normalizeMoneyText)
            .filter { it.isNotEmpty() && it.length <= 120 }
        if (lines.isEmpty()) return null
        if (PaymentPageEvidence.blocked(lines)) return null
        if (!PaymentPageContext.isDetail(lines)) return null
        val joined = lines.joinToString(" ")
        if (sensitiveMarkers.any { joined.contains(it) }) {
            // A password / OTP page is never enrichment material.
            return null
        }
        // OCR / real pages can show several amounts (order total, fee, balance).
        // Without a decisive label the page is ambiguous and must go to manual
        // confirmation instead of guessing one number.
        val decision = PaymentPageAmountSelection.select(lines, snapshot.amountTokenGroups)
        PaymentDiagnostics.amounts(decision)
        val explicitUnit = Regex("(?<![A-Za-z])[A-Z]{3}\\s*[0-9]|[0-9]\\s*[A-Z]{3}(?![A-Za-z])|[€£$]|日元|円", RegexOption.IGNORE_CASE).containsMatchIn(joined.replace(Regex("(?<![A-Za-z])(?:CNY|RMB)(?![A-Za-z])", RegexOption.IGNORE_CASE), ""))
        val strict = currencyPolicyVersion >= 2 || explicitUnit
        if (!strict && decision.reason != "no_amount" && decision.amountMinor == null) return null
        // With a decisive label the labelled amount wins over the first number on
        // the page (商品 ¥100 运费 ¥12 实付 ¥112 must book 112).
        var amount = decision.amountMinor
        var currency = "CNY"
        // A generic "交易成功" proves completion, not whether money entered or
        // left the account. Only page wording that identifies the direction may
        // complete the booking; ambiguous pages keep the same identity pending.
        val direction = PaymentPageEvidence.direction(lines)
        if (strict) {
            val monetary = uk.thewyj.app.finance.CurrencyDecision.apply(ParsedPaymentMessage(
                PaymentRecognitionStatus.PAYMENT_LIKELY, direction = direction), joined, defaultCurrency, true)
            currency = monetary.currency ?: return null
            if (currency !in uk.thewyj.app.finance.CurrencyMoney.digits) return null
            if (monetary.reviewReason !in setOf("", "currency_amount_unproven")) return null
            amount = if (monetary.currencyRolesJson.isNotBlank()) monetary.amountMinor
                else labelledCurrencyAmount(lines,snapshot.amountTokenGroups,currency)
            if (amount == null) return null
        }
        val detailPage = listOf("交易详情", "交易詳情", "账单详情", "賬單詳情", "转账详情", "轉賬詳情")
            .any(joined::contains)
        if (amount == null && !(detailPage && PaymentText.hasCompletion(joined) && direction != null)) return null
        val merchant = PaymentText.merchant(joined)
        val reference = PaymentText.providerReference(joined)
        val confidence = when {
            PaymentText.hasCompletion(joined) && reference != null -> 900
            PaymentText.hasCompletion(joined) -> 820
            else -> 820 // An identified detail page with one strong monetary field.
        }
        return PaymentEnrichment(
            sourcePackage = snapshot.sourcePackage,
            amountMinor = amount,
            currency = currency,
            direction = direction,
            merchant = merchant,
            counterparty = null,
            providerReference = reference,
            // Capture time is an observation, never a reconstructed transaction date.
            occurredAtMs = null,
            confidence = confidence,
            completionConfirmed = PaymentPageEvidence.classify(lines) !in setOf(PaymentPageState.PENDING,PaymentPageState.FAILED) && PaymentPageEvidence.completed(lines),
        )
    }
}
