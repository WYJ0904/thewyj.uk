package uk.thewyj.app.finance

import org.json.JSONObject
import uk.thewyj.app.task21.payment.ParsedPaymentMessage
import uk.thewyj.app.task21.payment.PaymentRecognitionStatus
import uk.thewyj.app.task21.payment.PaymentText
import java.util.Currency

/** Currency and amount roles only; completion, source privacy and identity gates stay separate. */
object CurrencyDecision {
    private val referenceMetadata = Regex("(?:交易单号|交易單號|交易号|交易號|订单号|訂單號|授权号|授權號|(?:transaction|order|authorization)\\s+(?:id|reference))\\s*[:：]?\\s*[A-Za-z0-9][A-Za-z0-9_-]{0,79}", RegexOption.IGNORE_CASE)
    private fun hasUnitEvidence(text: String, marker: String): Boolean = Regex(
        "(?:$marker)\\s*[:：]?\\s*[0-9]|[0-9][0-9.,]*\\s*(?:$marker)|(?:币种|幣種|currency)\\s*[:：]?\\s*(?:$marker)(?![A-Za-z])",
        RegexOption.IGNORE_CASE).containsMatchIn(text)
    fun validatedRolesJson(text: String): String {
        val roles = JSONObject(text)
        require(roles.has("original") && roles.keys().asSequence().all { it in setOf("original", "settlement", "fee") })
        for (name in roles.keys()) {
            val role = roles.getJSONObject(name)
            require(role.keys().asSequence().toSet() == setOf("currency", "amount_minor"))
            CurrencyMoney.exponent(role.getString("currency"))
            val amount = role.get("amount_minor")
            require((amount is Long || amount is Int) && (amount as Number).toLong() in (if (name == "fee") 0L else 1L)..10_000_000_000_000L)
        }
        return roles.toString()
    }
    private val iso = Regex("(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])", RegexOption.IGNORE_CASE)
    private val number = "(?<![0-9.,-])([0-9]+(?:\\.[0-9]+)?)(?![0-9.,eE])"
    private val knownIso = Currency.getAvailableCurrencies().map { it.currencyCode }.toSet()
    data class Roles(val currency: String, val amount: Long, val settlementCurrency: String? = null, val settlementAmount: Long? = null,
                     val feeCurrency: String? = null, val feeAmount: Long? = null) {
        fun json(): String = JSONObject().put("original", JSONObject().put("currency", currency).put("amount_minor", amount)).apply {
            if (settlementCurrency != null) put("settlement", JSONObject().put("currency", settlementCurrency).put("amount_minor", settlementAmount))
            if (feeCurrency != null) put("fee", JSONObject().put("currency", feeCurrency).put("amount_minor", feeAmount))
        }.toString()
    }
    private fun role(text: String, label: String, allowZero: Boolean = false): Pair<String, Long>? {
        val unit = "(CNY|USD|EUR|HKD|GBP|JPY|人民币|人民幣)"
        // PaymentText includes a repeated first line; equal facts are one role.
        val explicit = Regex("(?:$label)\\s*[:：]?\\s*$unit\\s*$number", RegexOption.IGNORE_CASE).findAll(text).distinctBy { it.value }.toList()
        if (explicit.size != 1) return null
        val match = explicit.single(); val currency = match.groupValues[1].uppercase().let { if (it in setOf("人民币", "人民幣")) "CNY" else it }
        val amount = runCatching { CurrencyMoney.parse(match.groupValues[2], currency) }.getOrNull()?.takeIf { it > 0 || (allowZero && it == 0L) } ?: return null
        return currency to amount
    }
    fun roles(text: String): Roles? {
        val original = role(text, "原币|原幣|original(?:\\s+amount)?") ?: return null
        val settlement = role(text, "清算|结算|結算|settlement")
        val fee = role(text, "手续费|手續費|fee", true) ?: Regex("(?:手续费|手續費|fee)\\s*$number\\s*元", RegexOption.IGNORE_CASE).find(text)?.let {
            runCatching { "CNY" to CurrencyMoney.parse(it.groupValues[1], "CNY") }.getOrNull()
        }
        if (Regex("清算|结算|結算|settlement", RegexOption.IGNORE_CASE).containsMatchIn(text) && settlement == null) return null
        if (Regex("手续费|手續費|fee", RegexOption.IGNORE_CASE).containsMatchIn(text) && fee == null) return null
        return Roles(original.first, original.second, settlement?.first, settlement?.second, fee?.first, fee?.second)
    }
    fun apply(parsed: ParsedPaymentMessage, text: String, defaultCurrency: String?, strict: Boolean): ParsedPaymentMessage {
        if (parsed.status in setOf(PaymentRecognitionStatus.NOT_PAYMENT, PaymentRecognitionStatus.PARSE_ERROR)) return parsed
        val moneyText = referenceMetadata.replace(text, " ")
        val roles = roles(moneyText)
        if (!strict && roles == null) return parsed // The historical v1 entry point remains explicit compatibility.
        // An explicit unit declaration cannot disappear into an account default.
        // Keep the unrecognised code for review; never turn XYZ into CNY/USD/JPY.
        val declared = Regex("(?:币种|幣種|currency)\\s*[:：]?\\s*([A-Za-z]{3,12})(?![A-Za-z])", RegexOption.IGNORE_CASE)
            .findAll(moneyText).map { it.groupValues[1].uppercase().let { code -> if (code == "RMB") "CNY" else code } }.toSet()
        if (declared.any { it !in CurrencyMoney.digits }) return parsed.copy(
            status = PaymentRecognitionStatus.PAYMENT_LIKELY, amountMinor = null, currency = declared.singleOrNull(),
            reviewReason = "unsupported_iso_currency", currencyEvidence = declared.joinToString(","),
            missingFields = parsed.missingFields + "currency", currencyReviewRequired = false, currencyDecisionSource = "")
        val cues = iso.findAll(moneyText).filter { match ->
            val before = moneyText.substring(0, match.range.first); val after = moneyText.substring(match.range.last + 1)
            Regex("^\\s*[:：]?\\s*[0-9]").containsMatchIn(after) || Regex("[0-9][0-9.,]*\\s*$").containsMatchIn(before) || Regex("(?:币种|幣種|currency)\\s*[:：]?\\s*$", RegexOption.IGNORE_CASE).containsMatchIn(before)
        }.map { it.groupValues[1].uppercase() }.filter { it in knownIso }.toMutableSet()
        if (hasUnitEvidence(moneyText,"人民币|人民幣|RMB|元")) cues.add("CNY")
        if (hasUnitEvidence(moneyText,"€")) cues.add("EUR")
        if (hasUnitEvidence(moneyText,"£")) cues.add("GBP")
        if (hasUnitEvidence(moneyText,"HK\\$")) cues.add("HKD")
        if (hasUnitEvidence(moneyText,"US\\$")) cues.add("USD")
        if (hasUnitEvidence(moneyText,"JP[¥￥]|日元|円")) cues.add("JPY")
        val currency = roles?.currency ?: if (cues.size == 1) cues.single() else if (cues.isEmpty()) defaultCurrency else null
        val unsupported = cues.any { it !in CurrencyMoney.digits }
        fun review(reason: String) = parsed.copy(status = PaymentRecognitionStatus.PAYMENT_LIKELY, amountMinor = null,
            currency = currency, reviewReason = reason, currencyEvidence = cues.joinToString(","), missingFields = parsed.missingFields + "currency")
        if (unsupported || currency !in CurrencyMoney.digits) return review(if (unsupported) "unsupported_iso_currency" else "currency_review_required")
        if (roles == null && cues.size > 1) return review("currency_evidence_conflict")
        if (cues.isEmpty() && moneyText.contains('$') && currency !in setOf("USD", "HKD")) return review("currency_symbol_ambiguous")
        if (cues.isEmpty() && (moneyText.contains('¥') || moneyText.contains('￥')) && currency !in setOf("CNY", "JPY")) return review("currency_symbol_ambiguous")
        val unit = currency!!
        val marker = when (unit) { "CNY" -> "CNY|RMB|人民币|人民幣|元|[¥￥]"; "USD" -> "USD|US\\$|\\$"; "HKD" -> "HKD|HK\\$|\\$"; "EUR" -> "EUR|€"; "GBP" -> "GBP|£"; else -> "JPY|JP[¥￥]|日元|円|[¥￥]" }
        val found = listOf(Regex("(?:$marker)\\s*$number", RegexOption.IGNORE_CASE), Regex("$number\\s*(?:$marker)", RegexOption.IGNORE_CASE))
            .flatMap { pattern -> pattern.findAll(moneyText).map { it.groupValues[1] }.toList() }
        val candidates = (if (found.isEmpty() && cues.isEmpty() && defaultCurrency != null && !Regex("-[0-9]").containsMatchIn(moneyText)) Regex(number).findAll(moneyText).map { it.groupValues[1] }.toList() else found)
            .mapNotNull { runCatching { CurrencyMoney.parse(it, unit) }.getOrNull() }.filter { it > 0 }.distinct()
        val amount = roles?.amount ?: candidates.singleOrNull() ?: return review("currency_amount_unproven")
        val fromDefault = roles == null && cues.isEmpty() && defaultCurrency != null
        // A currency decision cannot invent a completed payment or undo identity/lifecycle review.
        val currencyOnlyReason = parsed.reviewReason in setOf("", "currency_evidence_conflict", "currency_amount_unproven", "currency_review_required")
        val completed = PaymentText.hasCompletion(text) && !PaymentText.hasIncompleteStatus(text)
        val reviewReason = if (currencyOnlyReason) "" else parsed.reviewReason
        return parsed.copy(currency = unit, amountMinor = amount, currencyEvidence = if (fromDefault) "" else unit,
            currencyReviewRequired = fromDefault, currencyDecisionSource = if (fromDefault) "account_default" else "",
            currencyRolesJson = roles?.json().orEmpty(), reviewReason = reviewReason,
            status = if (completed && reviewReason.isBlank() && parsed.direction != null && parsed.financialPhase !in setOf("AUTHORIZED", "RELEASED", "EXPIRED")) PaymentRecognitionStatus.CONFIRMED_PAYMENT else parsed.status,
            missingFields = if (reviewReason.isBlank()) parsed.missingFields - setOf("currency", "amount", "review") else parsed.missingFields)
    }
}
