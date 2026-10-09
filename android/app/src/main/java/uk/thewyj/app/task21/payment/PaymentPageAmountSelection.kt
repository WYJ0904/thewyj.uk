package uk.thewyj.app.task21.payment

data class PageAmountCandidate(val line: Int, val rawNumber: String, val normalizedNumber: String, val minor: Long, val score: Int, val reason: String)
data class PageAmountDecision(val amountMinor: Long?, val candidates: List<PageAmountCandidate>, val reason: String)

/** Page amounts stay within their logical line (or a proven sibling token group). */
object PaymentPageAmountSelection {
    private val number = "[0-9][0-9,]*(?:\\.[0-9]+)?"
    private val currency = Regex("(?:¥|￥|人民币|人民幣|RMB|CNY)\\s*($number)(?![0-9.,])|(?<![0-9.,])($number)\\s*(?:元|圓|块|塊)", RegexOption.IGNORE_CASE)
    private val finalLabel = Regex("实付款?|實付款?|实际支付|實際支付")
    private val paymentLabel = Regex("付款金[额額]|支付金[额額]|交易金[额額]|扣款金[额額]|收款金[额額]|(?:转账|轉賬|转帐|轉帳)\\s*金[额額]")
    private val excludedLabel = Regex("原价|原價|优惠|優惠|折扣|余额|餘額|服务费|服務費|手续费|手續費|运费|運費|积分|積分|订单号|訂單號|时间|時間|日期|电话|電話|手机|手機")

    fun select(lines: List<String>, tokenGroups: List<List<String>> = emptyList()): PageAmountDecision {
        val normalized = lines.map(PaymentText::normalizeMoneyText)
        val candidates = mutableListOf<PageAmountCandidate>()
        fun read(line: String, index: Int, group: Boolean = false) {
            if (excludedLabel.containsMatchIn(line) && !finalLabel.containsMatchIn(line) && !paymentLabel.containsMatchIn(line)) return
            val score = when {
                finalLabel.containsMatchIn(line) -> 950
                paymentLabel.containsMatchIn(line) -> 900
                Regex("^(?:已支付|已付款|已收款|收款成功|付款成功|支付成功|退款成功|转账成功|轉賬成功)\\s*[:：]?\\s*[¥￥]").containsMatchIn(line) -> 850
                Regex("订单金[额額]|訂單金[额額]").containsMatchIn(line) -> 700
                currency.matches(line.trim()) -> 850
                group -> 850
                else -> 500
            }
            val hits = currency.findAll(line).map { it.groupValues[1].ifBlank { it.groupValues[2] } }.toList()
            val labelled = if (hits.isEmpty() && score >= 900) Regex(number).findAll(line).map { it.value }.toList() else emptyList()
            (hits + labelled).forEach { raw ->
                val value = PaymentText.parseMinor(raw) ?: return@forEach
                candidates.add(PageAmountCandidate(index, raw, PaymentText.normalizeMoneyText(raw), value, score,
                    when (score) { 950 -> "actual_paid"; 900 -> "payment_label"; 850 -> "isolated_currency"; 700 -> "order_total"; else -> "inline_currency" }))
            }
        }
        normalized.forEachIndexed { i, line -> read(line, i) }
        // A separated currency symbol may prefix one complete number. Numeric
        // siblings are never concatenated just because they follow each other.
        normalized.forEachIndexed { i, line ->
            if (line in setOf("¥", "￥", "CNY", "RMB") && normalized.getOrNull(i + 1)?.let { Regex(number).matches(it) } == true) {
                read(line + normalized[i + 1], i, true)
            }
            if ((finalLabel.containsMatchIn(line) || paymentLabel.containsMatchIn(line)) && !Regex(number).containsMatchIn(line)) {
                val next = normalized.getOrNull(i + 1).orEmpty()
                if (currency.matches(next) || Regex(number).matches(next)) read("$line $next", i)
            }
        }
        tokenGroups.forEach { group ->
            val pieces = group.map(PaymentText::normalizeMoneyText)
            if (pieces.size == 4 && pieces.firstOrNull() in setOf("¥", "￥") &&
                Regex("[0-9]{1,8}").matches(pieces[1]) && pieces[2] == "." && Regex("[0-9]{1,2}").matches(pieces[3])) {
                read(pieces.joinToString(""), -1, true)
            }
        }
        val bestScore = candidates.maxOfOrNull { it.score } ?: return PageAmountDecision(null, candidates, "no_amount")
        val best = candidates.filter { it.score == bestScore }.map { it.minor }.distinct()
        val decision = when {
            candidates.filter { it.score >= 900 }.map { it.minor }.distinct().size > 1 -> "conflicting_primary_amounts"
            bestScore < 700 -> "weak_inline_amount"
            best.size != 1 -> "conflicting_primary_amounts"
            bestScore < 900 && candidates.map { it.minor }.distinct().size > 1 -> "ambiguous_amounts"
            else -> "selected_${candidates.first { it.score == bestScore }.reason}"
        }
        return PageAmountDecision(best.singleOrNull()?.takeIf { decision.startsWith("selected_") }, candidates, decision)
    }
}

object PaymentPageContext {
    fun blockedWechatActivity(name: String): Boolean = name.endsWith(".LauncherUI") || name.contains("ChattingUI")
    private val detail = listOf("交易详情", "交易詳情", "账单详情", "賬單詳情", "帳單詳情", "转账详情", "轉賬詳情", "轉帳詳情")
    private val success = listOf("支付成功", "付款成功", "已支付", "已付款", "转账成功", "轉賬成功", "到賬成功", "收款成功", "已收款", "退款成功", "交易成功")
    fun pendingOutgoing(lines: List<String>): Boolean = lines.any { Regex("^待.{1,30}收款$").matches(it.trim()) } &&
        lines.any { it.contains("轉帳時間") || it.contains("轉賬時間") || it.contains("转账时间") }
    fun isDetail(lines: List<String>): Boolean {
        if (lines.any { it.trim() in setOf("WeChat", "Weixin Pay", "微信", "我的账单", "我的帳單", "支付服务", "支付服務") }) return false
        return pendingOutgoing(lines) || lines.any { line -> detail.any { line.trim() == it } } ||
            lines.any { line -> success.any { line.trim() == it } } ||
            (lines.any { it.contains("轉賬金額") || it.contains("转账金额") || it.contains("实付") } && lines.any { PaymentText.hasCompletion(it) })
    }
}
