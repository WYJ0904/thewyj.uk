package uk.thewyj.app.task21.payment

import org.junit.Assert.*
import org.junit.Test

/** Payment identity is opaque. Money OCR repairs must never rewrite its glyphs. */
class PaymentReferenceNormalizationTest {
    @Test fun labelledMixedReferencesKeepExactOriginalIdentity() {
        for (reference in listOf("AB0O1I2LZ2026", "O001B2345", "SYNTH-P06-JOINT-123456")) {
            val line = "交易号 $reference"
            val result = PaymentScreenshotVerifier.normalizeOcrLines(listOf(line)).single()
            assertEquals(line, result)
            assertEquals(reference, PaymentText.providerReference(result))
        }
    }

    @Test fun standaloneOpaqueReferenceIsNotAssumedToBeMoney() {
        val values = listOf("B00123", "O1200", "A1B2C3", "ORDER-O2026")
        assertEquals(values, PaymentScreenshotVerifier.normalizeOcrLines(values))
    }

    @Test fun merchantTextWithDigitsIsNotAltered() {
        val values = listOf("收款方 O2026商户", "商户 AB0O1I2LZ2026")
        assertEquals(values, PaymentScreenshotVerifier.normalizeOcrLines(values))
    }

    @Test fun explicitMonetaryRegionsKeepExistingNumericRepair() {
        assertEquals(listOf("¥100.00", "CNY 28.00", "USD 100.00"),
            PaymentScreenshotVerifier.normalizeOcrLines(listOf("¥1OO.OO", "CNY 28.OO", "USD 1OO.OO")))
    }

    @Test fun referenceLabelDoesNotLendMoneyAuthorityToIdentifier() {
        val values = listOf("订单号 B00123", "参考号 O1200A", "transaction id O001B2345")
        assertEquals(values, PaymentScreenshotVerifier.normalizeOcrLines(values))
    }

    @Test fun whitespaceMoneyNormalizationStillPreservesReferenceLetters() {
        val value = PaymentScreenshotVerifier.normalizeOcrLines(listOf("  交易号 AB0O1I2LZ2026  ")).single()
        assertEquals("AB0O1I2LZ2026", PaymentText.providerReference(value))
    }
}
