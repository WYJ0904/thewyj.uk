package uk.thewyj.app.task21.payment

import android.content.Context
import android.graphics.Bitmap
import java.util.Locale

/**
 * Task 24.1 visual verification fallback.
 *
 * The current WeChat build exposes no usable accessibility text, so when the
 * node-tree parser produces nothing and a verification ticket is open, the
 * service takes a screenshot of the target window, runs **on-device** OCR and
 * feeds the recognised lines through the same semantics layer as the node-tree
 * parser. Screenshots never leave the device and are never persisted.
 *
 * The OCR result can only complete an existing candidate/hint: a screenshot is
 * never a reason to create a transaction on its own, and anything ambiguous
 * (several amounts, price pages, chat lines, low confidence, secure windows)
 * falls through to manual confirmation.
 */
interface OcrEngine {
    /** Recognised text lines in reading order. Never persisted. */
    suspend fun recognize(bitmap: Bitmap): List<String>
}

/** Native OCR confirms the selected monetary region at a different pixel scale. */
interface AmountConfirmingOcrEngine : OcrEngine {
    suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long): Long?
}

object PaymentScreenshotTarget {
    fun resolve(eventWindowId: Int, packageWindowId: Int?): Int? =
        eventWindowId.takeIf { it >= 0 } ?: packageWindowId?.takeIf { it >= 0 }
}

object PaymentScreenshotThrottle {
    fun retryDelayMs(lastScreenshotAtMs: Long, nowMs: Long, intervalMs: Long): Long =
        (intervalMs - (nowMs - lastScreenshotAtMs)).coerceAtLeast(0L)
}

object PaymentOverlayRetryPolicy {
    private val overlayPackages = setOf("com.android.systemui", "com.samsung.android.sm_cn")

    fun shouldRetry(eventPackage: String, elapsedMs: Long): Boolean =
        eventPackage in overlayPackages && elapsedMs in 0L..8_000L
}

class PaymentScreenshotVerifier(private val engine: OcrEngine) {
    suspend fun verify(bitmap: Bitmap, sourcePackage: String, capturedAtMs: Long): PaymentEnrichment? {
        val lines = runCatching { engine.recognize(bitmap) }.getOrDefault(emptyList())
        val normalized = normalizeOcrLines(lines)
        if (normalized.isEmpty()) {
            android.util.Log.i("ThewyjAccessibility", "ocr-semantics lines=0 context=false amounts=0 decisive=false completion=false")
            return null
        }
        val joined = normalized.joinToString(" ")
        val paymentContext = looksLikePaymentPage(normalized)
        val decision = PaymentPageAmountSelection.select(normalized)
        android.util.Log.i(
            "ThewyjAccessibility",
            "ocr-semantics lines=${normalized.size} context=$paymentContext " +
                "amounts=${decision.candidates.map { it.minor }.distinct().size} decision=${decision.reason} " +
                "pendingOutgoing=${PaymentPageContext.pendingOutgoing(normalized)} " +
                "completion=${PaymentText.hasCompletion(joined)} " +
                "direction=${if (PaymentPageContext.pendingOutgoing(normalized)) "EXPENSE" else PaymentText.direction(joined)?.name ?: "unknown"}",
        )
        // A screenshot is only evidence when the page *is* a payment page. A
        // product price, a chat line that mentions money or a random ¥xx must
        // never become a payment on its own.
        if (!paymentContext) return null
        val enrichment = PaymentPageSemantics.extract(
            PaymentPageSnapshot(
                sourcePackage = sourcePackage,
                textLines = normalized,
                capturedAtMs = capturedAtMs,
            ),
        ) ?: return null
        val confirmingEngine = engine as? AmountConfirmingOcrEngine
        val expectedMinor = enrichment.amountMinor
        if (confirmingEngine != null && expectedMinor != null) {
            val confirmed = runCatching { confirmingEngine.confirmAmount(bitmap, expectedMinor) }.getOrNull()
            PaymentDiagnostics.emit("ocr_confirmation", "expectedMinor=${enrichment.amountMinor} confirmedMinor=$confirmed agreed=${confirmed == enrichment.amountMinor}")
            if (confirmed != enrichment.amountMinor) return null
        }
        return enrichment.copy(evidenceSource = PaymentEvidenceSource.OCR)
    }

    companion object {
        /**
         * OCR routinely confuses letters with digits (`1OO` for `100`, `28.OO`,
         * `l0` for `10`). Only the digit-shaped characters *inside* a number are
         * rewritten; the surrounding words keep their meaning so the payment
         * context rules still decide.
         */
        fun normalizeOcrLines(lines: List<String>): List<String> = lines
            .map(PaymentText::normalizeMoneyText)
            .filter { it.isNotEmpty() && it.length <= 120 }
            .map { normalizeNumericTokens(it) }
            .distinct()

        private val numberPattern = Regex("""[0-9OoIlSsZzBbGg]{1,12}([.,][0-9OoIlSsZzBbGg]{1,2})?""")

        private fun normalizeNumericTokens(line: String): String =
            numberPattern.replace(line) { match ->
                val token = match.value
                // Only rewrite when the token actually mixes digits and letters or
                // contains a digit-like letter: pure words such as "Song" stay.
                // Rewrite only tokens that really contain a digit: standalone
                // letters ("S", "o") and words such as "Song" keep their meaning.
                val looksNumeric = token.any { it.isDigit() }
                if (!looksNumeric) return@replace token
                token.map { character ->
                    when (character) {
                        'O', 'o' -> '0'
                        'I', 'l' -> '1'
                        'S', 's' -> '5'
                        'Z', 'z' -> '2'
                        'B' -> '8'
                        'G' -> '6'
                        else -> character
                    }
                }.joinToString("")
            }

        /** True when the recognised page mentions money in a payment context. */
        fun looksLikePaymentPage(lines: List<String>): Boolean {
            val joined = lines.joinToString(" ").lowercase(Locale.ROOT)
            val money = joined.contains('¥') || joined.contains('￥') || joined.contains("元") ||
                joined.contains("cny") || joined.contains("rmb")
            val context = listOf(
                "支付成功", "付款成功", "已支付", "已付款", "支付金额", "付款金额", "实付", "已扣款",
                "转账成功", "轉賬成功", "转账金额", "收款成功", "已收款", "收款金额",
                "轉賬金額", "轉賬詳情", "到賬成功", "订单金额", "交易详情", "账单详情",
            ).any { joined.contains(it) }
            val directionOnlyDetail = listOf("交易详情", "交易詳情", "账单详情", "賬單詳情", "转账详情", "轉賬詳情")
                .any(joined::contains) && PaymentText.hasCompletion(joined) && PaymentText.direction(joined) != null
            return PaymentPageContext.isDetail(lines) && ((money && context) || directionOnlyDetail || PaymentPageContext.pendingOutgoing(lines))
        }
    }
}

/** ML Kit implementation (bundled Chinese + Latin model). */
class MlKitOcrEngine(context: Context) : AmountConfirmingOcrEngine {
    private data class AmountRegion(val minor: Long, val bounds: android.graphics.Rect, val score: Int)
    private var amountRegions: List<AmountRegion> = emptyList()
    private val appContext = context.applicationContext
    private val recognizer = run {
        // MlKitInitProvider normally runs before Application.onCreate. Some
        // Samsung dual-app accessibility callbacks reach this process before
        // that component graph is usable, so initialise through ML Kit's public
        // idempotent entry point before constructing its executor.
        runCatching { com.google.mlkit.common.MlKit.initialize(appContext) }
        val options = com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions.Builder().build()
        com.google.mlkit.vision.text.TextRecognition.getClient(options)
    }

    override suspend fun recognize(bitmap: Bitmap): List<String> = kotlinx.coroutines.withContext(
        kotlinx.coroutines.Dispatchers.IO,
    ) {
        val image = com.google.mlkit.vision.common.InputImage.fromBitmap(bitmap, 0)
        val result = runCatching { com.google.android.gms.tasks.Tasks.await(recognizer.process(image)) }
            .getOrNull()
            ?: return@withContext emptyList()
        val recognized = result.textBlocks.flatMap { it.lines }
        val lines = recognized.map { it.text }
        val recoveredIndex = PaymentOcrTransferAmount.missingCurrencyIndex(
            lines.map { PaymentScreenshotVerifier.normalizeOcrLines(listOf(it)).singleOrNull().orEmpty() },
            recognized.map { line -> line.boundingBox?.let { bounds ->
                OcrAmountBounds(bounds.left, bounds.top, bounds.right, bounds.bottom)
            } }, bitmap.width, bitmap.height,
        )
        // Use original indices: normalisation for geometry must never collapse duplicates.
        val recovered = recoveredIndex?.let { index -> lines.mapIndexed { i, text ->
            if (i == index) "¥${PaymentScreenshotVerifier.normalizeOcrLines(listOf(text)).single()}" else text
        } } ?: lines
        val directRegions = recognized.mapIndexedNotNull { index, line ->
            val bounds = line.boundingBox ?: return@mapIndexedNotNull null
            val decision = PaymentPageAmountSelection.select(PaymentScreenshotVerifier.normalizeOcrLines(listOf(recovered[index])))
            val amount = decision.amountMinor ?: return@mapIndexedNotNull null
            AmountRegion(amount, android.graphics.Rect(bounds), decision.candidates.maxOf { it.score })
        }
        val splitSymbolRegions = recognized.zipWithNext().mapNotNull { (symbol, amount) ->
            if (PaymentText.normalizeMoneyText(symbol.text) != "¥") return@mapNotNull null
            val minor = PaymentText.parseMinor(amount.text) ?: return@mapNotNull null
            val bounds = symbol.boundingBox?.let { android.graphics.Rect(it) } ?: return@mapNotNull null
            bounds.union(amount.boundingBox ?: return@mapNotNull null)
            AmountRegion(minor, bounds, 850)
        }
        amountRegions = directRegions + splitSymbolRegions
        android.util.Log.i("ThewyjAccessibility", "ocr-result blocks=${result.textBlocks.size} lines=${lines.size}")
        if (recoveredIndex != null) android.util.Log.i("ThewyjAccessibility", "ocr-currency-recovery transfer=true prominentRegion=true secondScaleRequired=true")
        recovered
    }

    override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long): Long? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val region = amountRegions.filter { it.minor == expectedMinor }.sortedWith(compareByDescending<AmountRegion> { it.score }.thenByDescending { it.bounds.height() }).firstOrNull()
        amountRegions = emptyList()
        if (region == null) return@withContext null
        val padding = (region.bounds.height() / 3).coerceAtLeast(8)
        val left = (region.bounds.left - padding).coerceAtLeast(0)
        val top = (region.bounds.top - padding).coerceAtLeast(0)
        val right = (region.bounds.right + padding).coerceAtMost(bitmap.width)
        val bottom = (region.bounds.bottom + padding).coerceAtMost(bitmap.height)
        if (right <= left || bottom <= top) return@withContext null
        val crop = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
        val width = (crop.width * 2).coerceAtMost(1600)
        val scaled = Bitmap.createScaledBitmap(crop, width, (crop.height * width / crop.width).coerceAtLeast(1), true)
        try {
            val result = com.google.android.gms.tasks.Tasks.await(recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(scaled, 0)))
            val lines = PaymentScreenshotVerifier.normalizeOcrLines(result.textBlocks.flatMap { it.lines.map { line -> line.text } })
            val decision = PaymentPageAmountSelection.select(lines)
            decision.amountMinor ?: lines.singleOrNull()?.takeIf { Regex("[0-9]+[.,][0-9]{1,2}").matches(it) }?.let(PaymentText::parseMinor)
        } finally {
            if (scaled !== crop && scaled !== bitmap) scaled.recycle()
            if (crop !== bitmap) crop.recycle()
        }
    }
}
