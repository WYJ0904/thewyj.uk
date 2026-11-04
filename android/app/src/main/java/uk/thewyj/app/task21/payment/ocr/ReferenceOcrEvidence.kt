package uk.thewyj.app.task21.payment.ocr

/** Raw OCR identity evidence. No money normalization, case folding or glyph substitutions. */
data class ReferenceBox(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
    fun inside(width: Int, height: Int): Boolean =
        left >= 0 && top >= 0 && right <= width && bottom <= height && this.width > 0 && this.height > 0
}

data class ReferenceFrame(
    val sourcePackage: String,
    val accountScope: String,
    val captureId: String,
    val capturedAtMs: Long,
    val imageSha256: String,
    val width: Int,
    val height: Int,
)

data class ReferenceLine(val text: String, val box: ReferenceBox)

data class ReferenceRead(
    val frame: ReferenceFrame,
    val model: String,
    val variant: String,
    val lines: List<ReferenceLine>,
    // Only for re-reading a located region; retain the original visible label and its box.
    val anchor: ReferenceLine? = null,
)

data class ReferenceCandidate(
    val reference: String,
    val read: ReferenceRead,
    val line: ReferenceLine,
    val anchor: ReferenceLine,
)

enum class ReferenceIssue {
    MISSING_REFERENCE, MALFORMED_OR_SPLIT, CLIPPED, MULTIPLE_CANDIDATES,
    READ_DISAGREEMENT, MISSING_PROVENANCE, MIXED_CAPTURES, PROMOTIONAL_CONTENT,
}

/** This comparison is informational; it is not a transaction identity or settlement decision. */
data class ReferenceSourceText(val sourcePackage: String, val accountScope: String, val reference: String)

data class ReferenceAssessment(val candidates: List<ReferenceCandidate>, val issues: Set<ReferenceIssue>) {
    val unambiguousText: String?
        get() = candidates.map { it.reference }.distinct().singleOrNull()?.takeIf { issues.isEmpty() }

    // Even perfect OCR and repeated model agreement do not independently prove a payment.
    val requiresManualReview: Boolean get() = true

    fun matchesSourceText(source: ReferenceSourceText): Boolean = unambiguousText == source.reference &&
        candidates.isNotEmpty() && candidates.all {
            it.read.frame.sourcePackage == source.sourcePackage && it.read.frame.accountScope == source.accountScope
        }
}

/** Candidate-only API, deliberately disconnected from booking, AI, tickets and P03/P04. */
object ReferenceOcrEvidence {
    private val label = Regex(
        "^\\s*(?:(?:支付宝|支付寶)?交易(?:[编編][号號]|[号號])|(?:商户|商戶)?[订訂][单單][号號]|(?:银行|銀行)?流水[号號]|微信支付[单單][号號]|[凭憑][证證][号號]|[参參]考(?:[编編][号號]|[号號])|" +
            "transaction\\s+(?:id|number|no\\.?)|order\\s+(?:id|number|no\\.?)|reference(?:\\s+(?:id|number|no\\.?))?)\\s*[:：#]?\\s*",
        RegexOption.IGNORE_CASE,
    )
    private val token = Regex("[A-Za-z0-9][A-Za-z0-9_-]{5,127}")
    private val fragment = Regex("[A-Za-z0-9_-]+")
    private val promotion = Regex("优惠券|優惠券|促销|促銷|广告|廣告|立即抢购|立即搶購|限时优惠|限時優惠|cashback offer|promo code|special offer", RegexOption.IGNORE_CASE)

    fun hasLabel(text: String): Boolean = label.containsMatchIn(text)
    fun labelEnd(text: String): Int? = label.find(text)?.range?.last?.plus(1)

    fun assess(reads: List<ReferenceRead>): ReferenceAssessment {
        val candidates = mutableListOf<ReferenceCandidate>()
        val issues = linkedSetOf<ReferenceIssue>()
        if (reads.map { it.frame }.distinct().size > 1) issues += ReferenceIssue.MIXED_CAPTURES
        val perRead = mutableListOf<Set<String>>()
        for (read in reads) {
            val frame = read.frame
            if (frame.sourcePackage.isBlank() || frame.accountScope.isBlank() || frame.captureId.isBlank() ||
                frame.capturedAtMs <= 0 || !Regex("[a-f0-9]{64}").matches(frame.imageSha256) ||
                frame.width <= 0 || frame.height <= 0 || read.model.isBlank() || read.variant.isBlank()) {
                issues += ReferenceIssue.MISSING_PROVENANCE
            }
            if (read.lines.any { promotion.containsMatchIn(it.text) }) issues += ReferenceIssue.PROMOTIONAL_CONTENT
            val current = mutableListOf<ReferenceCandidate>()
            fun add(value: String, line: ReferenceLine, anchor: ReferenceLine) {
                val raw = value.trim()
                if (!token.matches(raw)) {
                    issues += ReferenceIssue.MALFORMED_OR_SPLIT
                    return
                }
                if (!line.box.inside(frame.width, frame.height) || line.box.left <= 1 || line.box.top <= 1 ||
                    line.box.right >= frame.width - 1 || line.box.bottom >= frame.height - 1 ||
                    !anchor.box.inside(frame.width, frame.height)) issues += ReferenceIssue.CLIPPED
                current += ReferenceCandidate(raw, read, line, anchor)
            }
            if (read.anchor != null) {
                if (!hasLabel(read.anchor.text)) issues += ReferenceIssue.MISSING_PROVENANCE
                // A region must produce one complete line. Never concatenate OCR fragments.
                if (read.lines.size != 1) issues += ReferenceIssue.MALFORMED_OR_SPLIT
                read.lines.forEach { line ->
                    add(labelEnd(line.text)?.let { line.text.substring(it) } ?: line.text, line, read.anchor)
                }
            } else {
                for (line in read.lines) {
                    val end = labelEnd(line.text) ?: continue
                    val value = line.text.substring(end).trim()
                    if (value.isNotEmpty()) {
                        add(value, line, line)
                        if (read.lines.any { other -> other !== line && fragment.matches(other.text.trim()) &&
                                below(line.box, other.box) }) issues += ReferenceIssue.MALFORMED_OR_SPLIT
                    } else {
                        val near = read.lines.filter { other -> other !== line && !hasLabel(other.text) &&
                            (rightOf(line.box, other.box) || below(line.box, other.box)) }
                        if (near.size != 1) issues += ReferenceIssue.MALFORMED_OR_SPLIT
                        near.forEach { add(it.text, it, line) }
                    }
                }
            }
            candidates += current
            perRead += current.map { it.reference }.toSet()
        }
        if (candidates.isEmpty()) issues += ReferenceIssue.MISSING_REFERENCE
        if (candidates.map { it.reference }.distinct().size > 1) issues += ReferenceIssue.MULTIPLE_CANDIDATES
        if (perRead.distinct().size > 1) issues += ReferenceIssue.READ_DISAGREEMENT
        return ReferenceAssessment(candidates.toList(), issues.toSet())
    }

    private fun below(label: ReferenceBox, value: ReferenceBox): Boolean =
        value.top >= label.bottom && value.top - label.bottom <= label.height * 3 / 2 &&
            kotlin.math.abs(value.left - label.left) <= label.height && value.height in 1..label.height * 2

    private fun rightOf(label: ReferenceBox, value: ReferenceBox): Boolean =
        value.left >= label.right && value.left - label.right <= label.height * 4 &&
            minOf(value.bottom, label.bottom) - maxOf(value.top, label.top) >= minOf(label.height, value.height) / 2
}
