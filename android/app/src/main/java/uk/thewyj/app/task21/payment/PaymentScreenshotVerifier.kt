package uk.thewyj.app.task21.payment

import android.content.Context
import android.graphics.Bitmap
import java.util.Locale
import kotlinx.coroutines.sync.withLock

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
    /** A legacy CNY confirmer must never validate another currency's unit. */
    suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long, currency: String): Long? =
        if (currency == "CNY") confirmAmount(bitmap, expectedMinor) else null
}

/** Native pixel readers may retry a whole immutable page at bounded resolutions. */
interface ScalablePageOcrEngine : AmountConfirmingOcrEngine {
    val fullPageRetryReady: Boolean get() = true
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
    private val pipeline=kotlinx.coroutines.sync.Mutex()
    /** Recheck the captured content epoch after both asynchronous OCR passes. */
    suspend fun verifyCurrent(bitmap: Bitmap, sourcePackage: String, capturedAtMs: Long,
                              defaultCurrency: String?, currencyPolicyVersion: Int, stillCurrent: () -> Boolean): PaymentEnrichment? {
        if (!stillCurrent()) return null
        return pipeline.withLock {
            if (!stillCurrent()) return@withLock null
            verifyInternal(bitmap, sourcePackage, capturedAtMs, defaultCurrency, currencyPolicyVersion, true, stillCurrent).takeIf { stillCurrent() }
        }
    }
    /** Ambiguous pixels may yield a separate suggestion; existing gates stay intact. */
    suspend fun verifyCurrentWithAssistance(bitmap:Bitmap,sourcePackage:String,capturedAtMs:Long,
        defaultCurrency:String?,currencyPolicyVersion:Int,observer:(PaymentPageSnapshot)->Unit,stillCurrent:()->Boolean):PaymentEnrichment? {
        if(!stillCurrent())return null
        return pipeline.withLock {
            if(!stillCurrent())return@withLock null
            verifyInternal(bitmap,sourcePackage,capturedAtMs,defaultCurrency,currencyPolicyVersion,true,stillCurrent,observer).takeIf{stillCurrent()}
        }
    }
    /** Explicit compatibility entry for historical callers; the service uses policy2 below. */
    suspend fun verify(bitmap: Bitmap, sourcePackage: String, capturedAtMs: Long): PaymentEnrichment? =
        verify(bitmap, sourcePackage, capturedAtMs, null, 1)

    suspend fun verify(bitmap: Bitmap, sourcePackage: String, capturedAtMs: Long,
                       defaultCurrency: String?, currencyPolicyVersion: Int): PaymentEnrichment? =
        pipeline.withLock {verifyInternal(bitmap,sourcePackage,capturedAtMs,defaultCurrency,currencyPolicyVersion,false)}

    private suspend fun verifyInternal(bitmap: Bitmap, sourcePackage: String, capturedAtMs: Long,
                       defaultCurrency: String?, currencyPolicyVersion: Int, retainUnresolved: Boolean, stillCurrent: () -> Boolean = {true},
                       observer:((PaymentPageSnapshot)->Unit)?=null): PaymentEnrichment? {
        fun observe(lines:List<String>){if(observer!=null&&stillCurrent()&&!PaymentPageEvidence.blocked(lines))runCatching{observer(PaymentPageSnapshot(sourcePackage,lines,capturedAtMs))}}
        var owned: Bitmap? = null
        var working = bitmap
        try {
        var lines = runCatching { engine.recognize(working) }.getOrDefault(emptyList())
        if (!stillCurrent()) return null
        var normalized = normalizeOcrLines(lines)
        if (PaymentPageEvidence.blocked(normalized)) return null
        if (financialVeto(normalized,defaultCurrency)) {observe(normalized);return null}
        val native = engine as? ScalablePageOcrEngine
        var moneyConsensus = monetaryFingerprint(normalized, defaultCurrency)
        if (native != null && normalized.isNotEmpty() && bitmap.width >= 480) {
            // Full page only: no expected value, synthetic label, fixed crop or
            // merged numeric nodes enter the retry. Known negative states win.
            for (width in listOf(800, 1600).filter { it != bitmap.width }) {
                if (!stillCurrent()) return null
                if (!native.fullPageRetryReady || !needsFullPageRetry(normalized,defaultCurrency)) break
                val height = (bitmap.height.toLong() * width / bitmap.width).toInt()
                if (height <= 0 || width.toLong() * height > 8_000_000L) continue
                val next = Bitmap.createScaledBitmap(bitmap,width,height,true)
                val nextLines = runCatching { engine.recognize(next) }.getOrDefault(emptyList())
                owned?.recycle(); owned = next; working = next
                if (!stillCurrent()) return null
                lines = nextLines; normalized = normalizeOcrLines(lines)
                val observedMoney = monetaryFingerprint(normalized,defaultCurrency)
                if (moneyConsensus != null && observedMoney != null && moneyConsensus != observedMoney) return null
                if (moneyConsensus == null) moneyConsensus = observedMoney
                if (PaymentPageEvidence.blocked(normalized)) return null
                if (financialVeto(normalized,defaultCurrency)) {observe(normalized);return null}
            }
        }
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
            defaultCurrency, currencyPolicyVersion,
        ) ?: run {observe(normalized);return if (retainUnresolved && defaultCurrency==null && currencyPolicyVersion>=2)
            PaymentPageSemantics.unresolvedCandidate(PaymentPageSnapshot(sourcePackage,normalized,capturedAtMs))
                ?.copy(evidenceSource=PaymentEvidenceSource.OCR) else null}
        val confirmingEngine = engine as? AmountConfirmingOcrEngine
        val expectedMinor = enrichment.amountMinor
        if (confirmingEngine != null && expectedMinor != null) {
            val confirmed = runCatching {
                if (currencyPolicyVersion >= 2)
                    enrichment.currency?.let { confirmingEngine.confirmAmount(working, expectedMinor, it) }
                else confirmingEngine.confirmAmount(working, expectedMinor)
            }.getOrNull()
            PaymentDiagnostics.emit("ocr_confirmation", "expectedMinor=${enrichment.amountMinor} confirmedMinor=$confirmed agreed=${confirmed == enrichment.amountMinor}")
            if (confirmed != enrichment.amountMinor) return null
        }
        return enrichment.copy(evidenceSource = PaymentEvidenceSource.OCR)
        } finally { owned?.recycle() }
    }

    private fun needsFullPageRetry(lines: List<String>, defaultCurrency: String?): Boolean {
        val state = PaymentPageEvidence.classify(lines)
        if (PaymentPageEvidence.blocked(lines) || state in setOf(PaymentPageState.PENDING,PaymentPageState.FAILED)) return false
        val manualCandidate = PaymentPageSemantics.unresolvedCandidate(PaymentPageSnapshot("",lines,0L))
        // A real absence/ambiguous symbol is already an exact manual candidate.
        // Do not erase it by replacing the page with a weaker OCR read. Split
        // Latin glyphs only request new pixels; they never supply an ISO code.
        val fragmentedUnit = Regex("[A-Za-z]{1,2}\\s+[A-Za-z]{1,2}\\s*[0-9]").containsMatchIn(lines.joinToString(" "))
        if (manualCandidate != null && !fragmentedUnit) return false
        return monetaryFingerprint(lines,defaultCurrency)==null || PaymentPageEvidence.undecodedStatus(lines) || !PaymentPageContext.isDetail(lines) ||
            state in setOf(PaymentPageState.DETAIL,PaymentPageState.UNKNOWN)
    }
    private fun financialVeto(lines: List<String>, defaultCurrency: String?): Boolean {
        if (PaymentPageAmountSelection.select(lines).reason in setOf("conflicting_primary_amounts","ambiguous_amounts","ambiguous_grouping")) return true
        val unit = uk.thewyj.app.finance.CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY),lines.joinToString(" "),defaultCurrency,true)
        return unit.reviewReason in setOf("currency_evidence_conflict","unsupported_iso_currency","currency_symbol_ambiguous")
    }
    private fun monetaryFingerprint(lines: List<String>, defaultCurrency: String?): Pair<String,Long>? {
        val value=uk.thewyj.app.finance.CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY),lines.joinToString(" "),defaultCurrency,true)
        val unit=value.currency?.takeIf {it in uk.thewyj.app.finance.CurrencyMoney.digits} ?: return null
        if(value.reviewReason !in setOf("","currency_amount_unproven"))return null
        return PaymentPageSemantics.labelledCurrencyAmount(lines,emptyList(),unit)?.let {unit to it}
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
            // Observed Samsung OCR: the receipt label 時間 became 時閒.
            // Correct only this complete label, never prose, dates or money.
            .map { transferTimeLabel.replace(it) { match -> "${match.groupValues[1]}時間" } }
            // Exact non-monetary label variants observed on the same Samsung
            // pixels. Completion still needs a real status and transfer title.
            .map { when(it) { "轉脹時間", "轉賬時聞" -> "轉賬時間"; else -> it } }
            // Equal labels can belong to different monetary nodes; retain their positions.

        private val transferTimeLabel = Regex("^(轉帳|轉賬)時閒$")
        private val numberPattern = Regex("""(?<![A-Za-z0-9_-])[0-9OoIlSsZzBbGg]{1,12}([.,][0-9OoIlSsZzBbGg]{1,2})?(?![A-Za-z0-9_-])""")
        private val referenceLabel = Regex("订单号|訂單號|交易号|交易號|流水号|流水號|凭证号|憑證號|参考号|參考號|(?:transaction|order|reference)\\s*(?:id|number|no|[:#])", RegexOption.IGNORE_CASE)
        private val monetaryContext = Regex("[¥￥$€£]|CNY|RMB|USD|EUR|HKD|GBP|JPY|人民币|人民幣|日元|円|金额|金額|实付|實付|已付|已收|扣款|扣除|到账|到賬|退款|原价|原價|优惠|優惠|余额|餘額|手续费|手續費", RegexOption.IGNORE_CASE)

        private fun normalizeNumericTokens(line: String): String {
            // Provider identity and merchant text are opaque evidence. Repair
            // digit-shaped glyphs only in a monetary region, never inside IDs.
            if (PaymentText.providerReference(line) != null || referenceLabel.containsMatchIn(line)) return line
            if (!monetaryContext.containsMatchIn(line) && !Regex("[0-9OoIlSsZzBbGg]+[.,][0-9OoIlSsZzBbGg]{1,2}").matches(line)) return line
            return numberPattern.replace(line) { match ->
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
        }

        /** True when the recognised page mentions money in a payment context. */
        fun looksLikePaymentPage(lines: List<String>): Boolean {
            if (PaymentPageEvidence.blocked(lines)) return false
            val joined = lines.joinToString(" ").lowercase(Locale.ROOT)
            val money = joined.contains('¥') || joined.contains('￥') || joined.contains("元") ||
                joined.contains("cny") || joined.contains("rmb") ||
                Regex("[€£$]|(?<![a-z])(?:usd|eur|hkd|gbp|jpy)(?![a-z])").containsMatchIn(joined)
            val context = listOf(
                "支付成功", "付款成功", "已支付", "已付款", "支付金额", "付款金额", "实付", "已扣款",
                "转账成功", "轉賬成功", "交易成功", "转账详情", "转账金额", "收款成功", "已收款", "收款金额",
                "轉賬金額", "轉賬詳情", "到賬成功", "订单金额", "交易详情", "账单详情", "支付详情", "支付詳情", "付款详情", "付款詳情", "收款详情", "收款詳情", "退款详情", "退款詳情",
            ).any { joined.contains(it) }
            val directionOnlyDetail = listOf("交易详情", "交易詳情", "账单详情", "賬單詳情", "转账详情", "轉賬詳情")
                .any(joined::contains) && PaymentText.hasCompletion(joined) && PaymentText.direction(joined) != null
            return PaymentPageContext.isDetail(lines) && ((money && context) || directionOnlyDetail || PaymentPageContext.pendingTransfer(lines) || PaymentPageContext.pendingPaymentDetail(lines) ||
                (PaymentPageEvidence.transferReceipt(lines) && PaymentPageEvidence.transferDirection(lines) != null))
        }
    }
}

/** ML Kit implementation (bundled Chinese + Latin model). */
class MlKitOcrEngine(context: Context) : ScalablePageOcrEngine {
    private val sdkBusy=java.util.concurrent.atomic.AtomicBoolean()
    override val fullPageRetryReady: Boolean get() = !sdkBusy.get()
    private data class AmountRegion(val text: String, val legacyMinor: Long?, val bounds: android.graphics.Rect, val score: Int)
    private var amountRegions: List<AmountRegion> = emptyList()
    private var pendingPage = false
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
        amountRegions = emptyList()
        pendingPage = false
        val result = PaymentOcrTaskLifetime.await(bitmap,sdkBusy,{owned ->
            recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(owned,0)) })
            ?: return@withContext emptyList()
        val recognized = result.textBlocks.flatMap { it.lines }
        val lines = recognized.map { it.text }
        val regionLines = lines.map { PaymentScreenshotVerifier.normalizeOcrLines(listOf(it)).singleOrNull().orEmpty() }
        pendingPage = PaymentPageContext.isPendingStatus(regionLines)
        val recoveredIndex = PaymentOcrTransferAmount.missingCurrencyIndex(
            regionLines,
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
            val text = PaymentScreenshotVerifier.normalizeOcrLines(listOf(recovered[index])).singleOrNull()
                ?: return@mapIndexedNotNull null
            val decision = PaymentPageAmountSelection.select(listOf(text))
            if (decision.amountMinor == null && !currencyMarker.containsMatchIn(text)) return@mapIndexedNotNull null
            AmountRegion(text, decision.amountMinor, android.graphics.Rect(bounds), decision.candidates.maxOfOrNull { it.score } ?: 850)
        }
        val splitSymbolRegions = recognized.zipWithNext().mapNotNull { (symbol, amount) ->
            val marker = PaymentText.normalizeMoneyText(symbol.text)
            if (!currencyMarker.matches(marker)) return@mapNotNull null
            val number = PaymentScreenshotVerifier.normalizeOcrLines(listOf(amount.text)).singleOrNull()
                ?.takeIf { Regex("[0-9][0-9,]*(?:\\.[0-9]+)?").matches(it) } ?: return@mapNotNull null
            val bounds = symbol.boundingBox?.let { android.graphics.Rect(it) } ?: return@mapNotNull null
            bounds.union(amount.boundingBox ?: return@mapNotNull null)
            AmountRegion("$marker $number", PaymentPageAmountSelection.select(listOf("$marker $number")).amountMinor, bounds, 850)
        }
        val fullDecision=PaymentPageAmountSelection.select(regionLines)
        val semanticRegions=PaymentOcrTransferAmount.semanticAmountIndices(regionLines).mapNotNull {index->
            val bounds=recognized.getOrNull(index)?.boundingBox ?: return@mapNotNull null
            AmountRegion(regionLines[index],fullDecision.amountMinor,android.graphics.Rect(bounds),fullDecision.candidates.maxOfOrNull {it.score} ?: 850)
        }
        amountRegions = directRegions + splitSymbolRegions + semanticRegions
        android.util.Log.i("ThewyjAccessibility", "ocr-result blocks=${result.textBlocks.size} lines=${lines.size}")
        if (recoveredIndex != null) android.util.Log.i("ThewyjAccessibility", "ocr-currency-recovery transfer=true prominentRegion=true secondScaleRequired=true")
        recovered
    }

    override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long): Long? = confirm(bitmap, expectedMinor, null)

    override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long, currency: String): Long? =
        confirm(bitmap, expectedMinor, currency)

    private fun currencyAmount(text: String, currency: String, pending: Boolean): Long? {
        return PaymentSecondaryOcrAmount.select(listOf(text), currency, pending)
    }

    private suspend fun confirm(bitmap: Bitmap, expectedMinor: Long, currency: String?): Long? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val pending = pendingPage
        pendingPage = false
        val region = amountRegions.filter { (if (currency == null) it.legacyMinor else currencyAmount(it.text, currency, pending)) == expectedMinor }
            .sortedWith(compareByDescending<AmountRegion> { it.score }.thenByDescending { it.bounds.height() }).firstOrNull()
        amountRegions = emptyList()
        if (region == null) return@withContext null
        val padding = (region.bounds.height() / 3).coerceAtLeast(8)
        val left = (region.bounds.left - padding).coerceAtLeast(0)
        // Isolating a short integer can make the model invert its orientation
        // (observed ¥100 -> 00L夫). Retain real page context above the amount;
        // the second scale must still independently return the exact unit/value.
        val top = (region.bounds.top - maxOf(padding, region.bounds.height() * 3)).coerceAtLeast(0)
        val right = (region.bounds.right + padding).coerceAtMost(bitmap.width)
        val bottom = (region.bounds.bottom + padding).coerceAtMost(bitmap.height)
        if (right <= left || bottom <= top) return@withContext null
        val crop = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
        val width = (crop.width * 2).coerceAtMost(1600)
        val scaled = Bitmap.createScaledBitmap(crop, width, (crop.height * width / crop.width).coerceAtLeast(1), true)
        try {
            val result = PaymentOcrTaskLifetime.await(scaled,sdkBusy,{owned ->
                recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(owned,0)) }) ?: return@withContext null
            val lines = PaymentScreenshotVerifier.normalizeOcrLines(result.textBlocks.flatMap { it.lines.map { line -> line.text } })
            if (currency != null) return@withContext PaymentSecondaryOcrAmount.select(lines,currency,pending)
            val decision = PaymentPageAmountSelection.select(lines)
            decision.amountMinor ?: lines.singleOrNull()?.takeIf { Regex("[0-9]+[.,][0-9]{1,2}").matches(it) }?.let(PaymentText::parseMinor)
        } finally {
            if (scaled !== crop && scaled !== bitmap) scaled.recycle()
            if (crop !== bitmap) crop.recycle()
        }
    }

    private companion object {
        val currencyMarker = Regex("[¥￥$€£]|CNY|RMB|USD|US\\$|EUR|HKD|HK\\$|GBP|JPY|JP[¥￥]|人民币|人民幣|元|日元|円", RegexOption.IGNORE_CASE)
    }
}

/** Independent second-scale reading; never receives the expected numeric value. */
internal object PaymentSecondaryOcrAmount {
    fun select(lines:List<String>,currency:String,pendingPage:Boolean=false):Long? {
        val normalized=PaymentScreenshotVerifier.normalizeOcrLines(lines)
        if (PaymentPageEvidence.blocked(normalized)) return null
        val parsed=uk.thewyj.app.finance.CurrencyDecision.apply(
            ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY),normalized.joinToString(" "),currency,true)
        if(parsed.currency!=currency || parsed.reviewReason !in setOf("","currency_amount_unproven"))return null
        if(parsed.currencyRolesJson.isNotBlank())return parsed.amountMinor
        // The second scale can include a nearby discount or balance. Resolve its
        // own roles instead of combining amounts or matching the caller's value.
        PaymentPageSemantics.labelledCurrencyAmount(normalized,emptyList(),currency)?.let {return it}
        // A known pending page cannot complete a payment. Retain a uniquely
        // read exact amount despite a damaged crop label, never a competing
        // price/fee/balance or an invented unit/value. No expected value enters.
        if ((pendingPage || PaymentPageContext.isPendingStatus(normalized)) && parsed.amountMinor != null &&
            normalized.none { Regex("原价|原價|优惠|優惠|折扣|余额|餘額|手续费|手續費|服务费|服務費|运费|運費|订单|訂單|单号|單號|编号|时间|時間|日期|电话|電話|手机|手機|original price|discount|balance|fee|freight|order|reference|time|date|phone",RegexOption.IGNORE_CASE).containsMatchIn(it) }) return parsed.amountMinor
        // A crop containing exactly one bare number can confirm the primary
        // page's established unit. Prose/metadata and conflicting fields cannot.
        val bare=normalized.filter {Regex("[0-9]+(?:\\.[0-9]+)?").matches(it)}.singleOrNull() ?: return null
        if(normalized.filter {it!=bare}.any {Regex("[0-9]|原价|原價|优惠|優惠|折扣|余额|餘額|手续费|手續費|服务费|服務費|运费|運費|订单|訂單|单号|單號|编号|时间|時間|日期|电话|電話|手机|手機|original price|discount|balance|fee|freight|order|reference|time|date|phone",RegexOption.IGNORE_CASE).containsMatchIn(it)})return null
        return runCatching {uk.thewyj.app.finance.CurrencyMoney.parse(bare,currency)}.getOrNull()?.takeIf {it>0}
    }
}
