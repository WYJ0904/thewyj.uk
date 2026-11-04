package uk.thewyj.app.task21.payment.ocr

import org.junit.Assert.*
import org.junit.Test

class ReferenceR2RegressionTest {
    private val frame = ReferenceFrame("synthetic.bank", "owner-A", "capture-A", 1000, "a".repeat(64), 1080, 2200)

    @Test fun qualifiedProviderLabelsDoNotDiscardTheVisibleOpaqueReference() {
        for (label in listOf("银行流水号", "銀行流水號", "支付宝交易号", "支付寶交易號", "微信支付单号", "微信支付單號", "商户订单号")) {
            val raw = "$label Ab0O1Il5S2Z8B6G-2026"
            val read = ReferenceRead(frame, "chinese:16.0.1", "full-native",
                listOf(ReferenceLine(raw, ReferenceBox(60, 700, 900, 750))))
            val result = ReferenceOcrEvidence.assess(listOf(read))
            assertEquals(label, "Ab0O1Il5S2Z8B6G-2026", result.unambiguousText)
            assertEquals(raw, result.candidates.single().line.text)
            assertTrue(result.requiresManualReview)
        }
    }

    @Test fun aSymbolStraddlingTheLabelBoundaryCannotSilentlyDropAReferenceGlyph() {
        val line = ReferenceLine("交易号 ABC12345", ReferenceBox(10, 10, 200, 40))
        val symbols = listOf(
            ReferenceLine("交易号A", ReferenceBox(10, 10, 70, 40)),
            ReferenceLine("BC12345", ReferenceBox(70, 10, 175, 40)),
        )
        assertNull(ReferenceImagePreprocessor.valueBox(line, symbols))
    }

    @Test fun valueScalingMeasuresTheNumberInsteadOfTheTallerLabel() {
        val line = ReferenceLine("交易号 ABC12345", ReferenceBox(10, 10, 200, 60))
        val symbols = "交易号ABC12345".mapIndexed { i, char -> ReferenceLine(char.toString(),
            if (i < 3) ReferenceBox(10 + i * 15, 10, 25 + i * 15, 60)
            else ReferenceBox(10 + i * 15, 20, 25 + i * 15, 50)) }
        val region = ReferenceImagePreprocessor.valueRegion(line, symbols, 1080, 2200)
        assertEquals(30, region?.glyphHeight)
        assertNotEquals(line.box.height, region?.glyphHeight)
    }
}
