package uk.thewyj.app.task21.payment.ocr

enum class ReceiptAmountRole { ACTUAL_PAID, ORIGINAL, DISCOUNT, REFUND, FEE, BALANCE, CREDIT, ADVERTISEMENT, ORDER_TOTAL }

/** Raw fields only. Consumers must still apply P03 identity and the complete P04 money contract. */
data class ReceiptAmount(val role: ReceiptAmountRole, val rawNumber: String, val currency: String?, val line: ReferenceLine)
data class ReceiptCaptureScope(val sourcePackage: String, val accountScope: String, val captureId: String)
data class ReceiptCaptureGate(val scope: ReceiptCaptureScope, val accessibilityGranted: Boolean, val completePage: Boolean)
data class ReceiptAssessment(val amounts: List<ReceiptAmount>, val paidAmount: ReceiptAmount?, val issues: Set<String>) {
    val requiresManualReview: Boolean get() = true
}

/** Candidate-only semantic annotation. No ledger, settlement, fuzzy character repair or account lookup. */
object ReceiptOcrEvidence {
    private val roles = listOf(
        ReceiptAmountRole.ACTUAL_PAID to "实付(?:款|金额)?|實付(?:款|金額)?|实际支付|實際支付|actual paid|amount paid|paid amount",
        ReceiptAmountRole.ORIGINAL to "原价|原價|original price",
        ReceiptAmountRole.DISCOUNT to "优惠(?:金额)?|優惠(?:金額)?|折扣|discount",
        ReceiptAmountRole.REFUND to "退款(?:金额|金額)?|refund(?: amount)?",
        ReceiptAmountRole.FEE to "手续费|手續費|服务费|服務費|fee",
        ReceiptAmountRole.BALANCE to "账户余额|帳戶餘額|余额|餘額|(?:account )?balance",
        ReceiptAmountRole.CREDIT to "信用额度|信用額度|可用额度|可用額度|credit limit|available credit",
        ReceiptAmountRole.ADVERTISEMENT to "广告额度|廣告額度|advertising credit",
        ReceiptAmountRole.ORDER_TOTAL to "订单金额|訂單金額|order total",
    ).map { (role, pattern) -> role to Regex("^(?:$pattern)\\s*[:：]?\\s*", RegexOption.IGNORE_CASE) }
    private val split = Regex("[;；]|(?=实付|實付|实际支付|實際支付|原价|原價|优惠|優惠|退款|手续费|手續費|账户余额|帳戶餘額|余额|餘額|信用额度|信用額度|广告额度|廣告額度)")
    private const val units = "CNY|USD|EUR|HKD|GBP|JPY"
    private val money = Regex("(?:($units|[¥￥$€£])\\s*)?((?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?)(?:\\s*($units|[¥￥$€£]))?", RegexOption.IGNORE_CASE)
    private val completed = Regex("^(?:支付成功|付款成功|交易成功|已支付|已付款|payment successful|payment complete)$", RegexOption.IGNORE_CASE)
    private val unsettled = Regex("待支付|待付款|支付中|付款中|处理中|處理中|加载中|加載中|支付失败|支付失敗|交易关闭|交易關閉|退款成功|已退款|pending|processing|loading|failed|refunded", RegexOption.IGNORE_CASE)

    fun assess(reads: List<ReferenceRead>, gate: ReceiptCaptureGate): ReceiptAssessment {
        val issues = linkedSetOf<String>()
        val amounts = mutableListOf<ReceiptAmount>()
        val perRead = mutableListOf<Set<Pair<String?, String>>>()
        if (!gate.accessibilityGranted) issues += "permission_missing"
        if (!gate.completePage) issues += "incomplete_page"
        if (reads.isEmpty()) issues += "missing_read"
        if (reads.map { it.frame }.distinct().size > 1) issues += "mixed_captures"
        for (read in reads) {
            val frame = read.frame
            if (gate.scope != ReceiptCaptureScope(frame.sourcePackage, frame.accountScope, frame.captureId)) issues += "scope_mismatch"
            if (frame.sourcePackage.isBlank() || frame.accountScope.isBlank() || frame.captureId.isBlank() ||
                frame.capturedAtMs <= 0 || !Regex("[a-f0-9]{64}").matches(frame.imageSha256) || frame.width <= 0 || frame.height <= 0 ||
                read.model.isBlank() || read.variant.isBlank()) issues += "missing_provenance"
            if (read.anchor != null) issues += "incomplete_context"
            if (read.lines.any { !it.box.inside(frame.width, frame.height) }) issues += "invalid_geometry"
            if (read.lines.any { unsettled.containsMatchIn(it.text) }) issues += "not_settled"
            if (read.lines.none { completed.matches(it.text.trim()) }) issues += "completion_not_observed"
            val current = mutableListOf<ReceiptAmount>()
            fun parse(role: ReceiptAmountRole, payload: String, source: ReferenceLine) {
                val match = money.matchEntire(payload.trim())
                if (match == null) {
                    if (role == ReceiptAmountRole.ACTUAL_PAID) issues += "malformed_paid_amount"
                    return
                }
                val prefix = match.groupValues[1].uppercase()
                val suffix = match.groupValues[3].uppercase()
                val explicit = listOf(prefix, suffix).filter(String::isNotBlank).distinct()
                val currency = explicit.singleOrNull()?.takeIf { Regex(units).matches(it) }
                val number = match.groupValues[2]
                if (role == ReceiptAmountRole.ACTUAL_PAID && (currency == null || currency == "JPY" && '.' in number)) issues += "currency_review_required"
                current += ReceiptAmount(role, number, currency, source)
            }
            for (line in read.lines) for (part in line.text.split(split).filter(String::isNotBlank)) {
                val (role, label) = roles.firstOrNull { it.second.containsMatchIn(part.trim()) } ?: continue
                val payload = part.trim().replaceFirst(label, "").trim()
                if (payload.isNotEmpty()) parse(role, payload, line)
                else {
                    // A label can own exactly one adjacent value. Never join number fragments or columns.
                    val near = read.lines.filter { other -> other !== line && money.matches(other.text.trim()) && adjacent(line.box, other.box) }
                    if (near.size == 1) {
                        val value = near.single()
                        if (role == ReceiptAmountRole.ACTUAL_PAID && read.lines.any { other -> other !== value &&
                                money.matches(other.text.trim()) && adjacent(value.box, other.box) }) issues += "split_paid_amount"
                        parse(role, value.text, value)
                    }
                    else if (role == ReceiptAmountRole.ACTUAL_PAID) issues += "ambiguous_paid_region"
                }
            }
            amounts += current
            perRead += current.filter { it.role == ReceiptAmountRole.ACTUAL_PAID }.map { it.currency to it.rawNumber }.toSet()
        }
        if (perRead.distinct().size > 1) issues += "read_disagreement"
        val paid = amounts.filter { it.role == ReceiptAmountRole.ACTUAL_PAID }.distinctBy { it.currency to it.rawNumber }
        if (paid.size != 1) issues += "missing_or_multiple_paid_amounts"
        return ReceiptAssessment(amounts.toList(), paid.singleOrNull()?.takeIf { issues.isEmpty() }, issues.toSet())
    }

    private fun adjacent(label: ReferenceBox, value: ReferenceBox): Boolean =
        (value.left >= label.right && value.left - label.right <= label.height * 6 &&
            minOf(value.bottom, label.bottom) - maxOf(value.top, label.top) >= minOf(label.height, value.height) / 2) ||
            (value.top >= label.bottom && value.top - label.bottom <= label.height &&
                kotlin.math.abs(value.left - label.left) <= label.height && value.height in 1..label.height * 2)
}
