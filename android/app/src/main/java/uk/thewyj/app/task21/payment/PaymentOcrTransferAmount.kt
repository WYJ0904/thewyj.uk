package uk.thewyj.app.task21.payment

/** Geometry stays local to one OCR screenshot; it is never an account or ticket identity. */
internal data class OcrAmountBounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val height get() = bottom - top
}

/**
 * Samsung's WeChat transfer detail can omit the currency glyph in ML Kit output.
 * Recover only its unique, prominent decimal region on an identified transfer
 * receipt. The native engine must still re-read that region at another scale.
 * General page/node/notification parsers continue to reject unlabelled numbers.
 */
internal object PaymentOcrTransferAmount {
    private val decimal = Regex("(?:0|[1-9][0-9]{0,7})\\.[0-9]{2}")
    private val transferTime = listOf("转账时间", "轉賬時間", "转帐时间", "轉帳時間")
    private val detail = setOf("账单详情", "賬單詳情", "帳單詳情", "转账详情", "轉賬詳情", "轉帳詳情")
    private val sensitive = listOf("密码", "密碼", "验证码", "驗證碼", "身份证", "身份證", "银行卡号", "銀行卡號")

    fun missingCurrencyIndex(lines: List<String>, bounds: List<OcrAmountBounds?>, width: Int, height: Int): Int? {
        if (lines.size != bounds.size || width <= 0 || height <= 0) return null
        val joined = lines.joinToString(" ")
        if (sensitive.any(joined::contains) || !PaymentPageContext.isDetail(lines)) return null
        if (!lines.any { it in detail } || !lines.any { line -> transferTime.any(line::contains) }) return null
        // The label "transfer time" identifies the layout, never money direction.
        val status = lines.filterNot { line -> transferTime.any(line::contains) }.joinToString(" ")
        if (!PaymentPageContext.pendingOutgoing(lines) &&
            (!PaymentText.hasCompletion(status) || PaymentText.direction(status) == null)) return null
        if (PaymentPageAmountSelection.select(lines).reason != "no_amount") return null
        val index = lines.indices.filter { decimal.matches(lines[it]) }.singleOrNull() ?: return null
        if (PaymentText.parseMinor(lines[index]) == null) return null
        val region = bounds[index] ?: return null
        if (region.height <= 0 || region.left < 0 || region.right > width || region.right <= region.left) return null
        // The transfer amount is centred in the upper receipt, larger than every label.
        val centreX = (region.left + region.right) / 2.0
        if (centreX !in width * 0.30..width * 0.70 || region.top < height * 0.10 || region.bottom > height * 0.60) return null
        val labelHeight = bounds.filterIndexed { i, _ -> i != index }.mapNotNull { it?.height?.takeIf { h -> h > 0 } }.maxOrNull() ?: return null
        if (region.height < labelHeight * 1.25) return null
        return index
    }
}
