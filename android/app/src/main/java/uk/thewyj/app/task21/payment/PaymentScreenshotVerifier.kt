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

class PaymentScreenshotVerifier(private val engine: OcrEngine) {
    suspend fun verify(bitmap: Bitmap, sourcePackage: String, capturedAtMs: Long): PaymentEnrichment? {
        val lines = runCatching { engine.recognize(bitmap) }.getOrDefault(emptyList())
        val normalized = normalizeOcrLines(lines)
        if (normalized.isEmpty()) return null
        // A screenshot is only evidence when the page *is* a payment page. A
        // product price, a chat line that mentions money or a random ¥xx must
        // never become a payment on its own.
        if (!looksLikePaymentPage(normalized)) return null
        return PaymentPageSemantics.extract(
            PaymentPageSnapshot(
                sourcePackage = sourcePackage,
                textLines = normalized,
                capturedAtMs = capturedAtMs,
            ),
        )
    }

    companion object {
        /**
         * OCR routinely confuses letters with digits (`1OO` for `100`, `28.OO`,
         * `l0` for `10`). Only the digit-shaped characters *inside* a number are
         * rewritten; the surrounding words keep their meaning so the payment
         * context rules still decide.
         */
        fun normalizeOcrLines(lines: List<String>): List<String> = lines
            .map { it.replace('\u00A0', ' ').trim() }
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
                "订单金额", "交易详情", "账单详情",
            ).any { joined.contains(it) }
            return money && context
        }
    }
}

/** ML Kit implementation (unbundled Chinese + Latin model). */
class MlKitOcrEngine(context: Context) : OcrEngine {
    private val recognizer = com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions.Builder()
        .build()
        .let { options ->
            com.google.mlkit.vision.text.TextRecognition.getClient(options)
        }
    private val appContext = context.applicationContext

    override suspend fun recognize(bitmap: Bitmap): List<String> = kotlinx.coroutines.withContext(
        kotlinx.coroutines.Dispatchers.IO,
    ) {
        val image = com.google.mlkit.vision.common.InputImage.fromBitmap(bitmap, 0)
        val result = runCatching { com.google.android.gms.tasks.Tasks.await(recognizer.process(image)) }
            .getOrNull()
            ?: return@withContext emptyList()
        result.textBlocks.flatMap { block -> block.lines.map { line -> line.text } }
    }
}
