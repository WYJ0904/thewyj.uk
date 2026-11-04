package uk.thewyj.app.task21.payment.ocr

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.roundToInt

/** Explicit ablations, not an automatic best-output selector. Every bitmap is caller-owned. */
object ReferenceImagePreprocessor {
    enum class Treatment { NATIVE, GLYPH24, GLYPH36, GRAY, CONTRAST, OTSU, ADAPTIVE, UNSHARP }

    data class ValueRegion(val roi: ReferenceBox, val glyphHeight: Int)

    fun padded(box: ReferenceBox, width: Int, height: Int): ReferenceBox? {
        if (!box.inside(width, height)) return null
        val pad = maxOf(8, box.height)
        return ReferenceBox(maxOf(0, box.left - pad), maxOf(0, box.top - pad),
            minOf(width, box.right + pad), minOf(height, box.bottom + pad))
    }

    /** Narrow horizontal padding keeps a neighboring label out of a symbol-located value crop. */
    fun paddedValue(box: ReferenceBox, width: Int, height: Int): ReferenceBox? {
        if (!box.inside(width, height)) return null
        val horizontal = maxOf(3, box.height / 6)
        val vertical = maxOf(8, box.height)
        return ReferenceBox(maxOf(0, box.left - horizontal), maxOf(0, box.top - vertical),
            minOf(width, box.right + horizontal), minOf(height, box.bottom + vertical))
    }

    /** Use SDK symbol boxes only when they reconstruct the whole raw line exactly. */
    fun valueBox(line: ReferenceLine, symbols: List<ReferenceLine>): ReferenceBox? {
        val end = ReferenceOcrEvidence.labelEnd(line.text) ?: return null
        val prefix = line.text.substring(0, end).filterNot(Char::isWhitespace)
        val text = line.text.filterNot(Char::isWhitespace)
        if (symbols.joinToString("") { it.text } != text || prefix.length >= text.length) return null
        // A multi-codepoint SDK symbol must not straddle the label/value boundary.
        // Cropping after that symbol would silently delete the first value glyph.
        val boundaries = symbols.runningFold(0) { offset, symbol -> offset + symbol.text.length }
        if (prefix.length !in boundaries) return null
        var offset = 0
        val tail = symbols.filter { symbol ->
            val start = offset
            offset += symbol.text.length
            start >= prefix.length
        }
        if (tail.isEmpty() || tail.any { !it.box.inside(line.box.right, line.box.bottom) ||
                it.box.left < line.box.left || it.box.top < line.box.top }) return null
        return ReferenceBox(tail.minOf { it.box.left }, tail.minOf { it.box.top },
            tail.maxOf { it.box.right }, tail.maxOf { it.box.bottom })
    }

    /** Scale value glyphs using their own measured height, not a taller Chinese label. */
    fun valueRegion(line: ReferenceLine, symbols: List<ReferenceLine>, width: Int, height: Int): ValueRegion? {
        val value = valueBox(line, symbols) ?: return null
        val roi = paddedValue(value, width, height) ?: return null
        return ValueRegion(roi, value.height)
    }

    fun render(source: Bitmap, roi: ReferenceBox, glyphHeight: Int, treatment: Treatment): Bitmap {
        require(roi.inside(source.width, source.height) && glyphHeight > 0)
        require(roi.width.toLong() * roi.height <= 16_000_000L)
        val crop = Bitmap.createBitmap(source, roi.left, roi.top, roi.width, roi.height)
        val owned = crop.copy(Bitmap.Config.ARGB_8888, true)
        if (crop !== source) crop.recycle()
        if (treatment == Treatment.NATIVE) return owned
        if (treatment == Treatment.GLYPH24 || treatment == Treatment.GLYPH36) {
            val height = if (treatment == Treatment.GLYPH24) 24 else 36
            val scale = height.toDouble() / glyphHeight
            val width = (owned.width * scale).roundToInt().coerceIn(1, 2400)
            val scaled = Bitmap.createScaledBitmap(owned, width,
                (owned.height.toDouble() * width / owned.width).roundToInt().coerceAtLeast(1), true)
            if (scaled !== owned) owned.recycle()
            return scaled
        }
        val width = owned.width
        val height = owned.height
        val pixels = IntArray(width * height)
        owned.getPixels(pixels, 0, width, 0, 0, width, height)
        val gray = IntArray(pixels.size) { i ->
            val p = pixels[i]
            // Composite alpha over white before luminance. Never let transparent RGB invent edges.
            val a = Color.alpha(p)
            val luma = (77 * Color.red(p) + 150 * Color.green(p) + 29 * Color.blue(p)) / 256
            (luma * a + 255 * (255 - a)) / 255
        }
        val histogram = IntArray(256)
        gray.forEach { histogram[it]++ }
        val threshold = otsu(histogram, gray.size)
        val low = gray.minOrNull() ?: 0
        val high = gray.maxOrNull() ?: 255
        val integral = if (treatment == Treatment.ADAPTIVE) LongArray((width + 1) * (height + 1)) else null
        if (integral != null) for (y in 1..height) {
            var row = 0L
            for (x in 1..width) {
                row += gray[(y - 1) * width + x - 1]
                integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row
            }
        }
        val radius = maxOf(3, glyphHeight / 3)
        for (y in 0 until height) for (x in 0 until width) {
            val i = y * width + x
            val value = gray[i]
            val changed = when (treatment) {
                Treatment.CONTRAST -> if (high > low) (value - low) * 255 / (high - low) else value
                Treatment.OTSU -> if (value <= threshold) 0 else 255
                Treatment.ADAPTIVE -> {
                    val left = maxOf(0, x - radius); val top = maxOf(0, y - radius)
                    val right = minOf(width, x + radius + 1); val bottom = minOf(height, y + radius + 1)
                    val stride = width + 1
                    val sum = integral!![bottom * stride + right] - integral[bottom * stride + left] -
                        integral[top * stride + right] + integral[top * stride + left]
                    if (value < sum / ((right - left) * (bottom - top)) - 10) 0 else 255
                }
                Treatment.UNSHARP -> {
                    var sum = 0; var count = 0
                    for (yy in maxOf(0, y - 1)..minOf(height - 1, y + 1))
                        for (xx in maxOf(0, x - 1)..minOf(width - 1, x + 1)) { sum += gray[yy * width + xx]; count++ }
                    (value + (value - sum / count)).coerceIn(0, 255)
                }
                else -> value
            }
            pixels[i] = Color.rgb(changed, changed, changed)
        }
        owned.setPixels(pixels, 0, width, 0, 0, width, height)
        return owned
    }

    private fun otsu(histogram: IntArray, count: Int): Int {
        val total = histogram.indices.sumOf { it.toLong() * histogram[it] }
        var before = 0L; var weight = 0L; var best = -1.0; var threshold = 0
        for (i in 0..255) {
            weight += histogram[i]; before += i.toLong() * histogram[i]
            if (weight == 0L || weight == count.toLong()) continue
            val delta = before.toDouble() / weight - (total - before).toDouble() / (count - weight)
            val score = weight.toDouble() * (count - weight) * delta * delta
            if (score > best) { best = score; threshold = i }
        }
        return threshold
    }
}
