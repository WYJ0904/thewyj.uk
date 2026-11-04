package uk.thewyj.app.task21.payment.ocr

import org.junit.Assert.*
import org.junit.Test

class ReferenceOcrEvidenceTest {
    private val frame = ReferenceFrame("synthetic.wechat", "owner-A", "capture-A", 1000, "a".repeat(64), 1080, 2200)
    private fun line(text: String, y: Int = 800, x: Int = 90) = ReferenceLine(text, ReferenceBox(x, y, x + 750, y + 50))
    private fun read(vararg text: String) = ReferenceRead(frame, "chinese:16.0.1", "native",
        text.mapIndexed { index, value -> line(value, 800 + 100 * index) })
    private fun assess(vararg text: String) = ReferenceOcrEvidence.assess(listOf(read(*text)))

    @Test fun opaqueMixedIdentityKeepsEveryGlyphAndCase() {
        val ref = "Ab0O1Il5S8B-2026"
        val result = assess("交易号 $ref")
        assertEquals(ref, result.unambiguousText)
        assertTrue(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, ref)))
        assertTrue(result.requiresManualReview)
    }

    @Test fun englishAndTraditionalLabelsRetainExactValues() {
        for (label in listOf("交易號", "參考編號", "參考编號", "参考編号", "Reference no.", "Transaction ID:", "Order number:")) {
            assertEquals("abcO012345", assess("$label abcO012345").unambiguousText)
        }
    }

    @Test fun wrongGlyphsCannotBeCorrectedUsingSourceText() {
        val result = assess("交易号 AB00112LZ2026")
        assertEquals("AB00112LZ2026", result.unambiguousText)
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "AB0O1I2LZ2026")))
        assertTrue(result.requiresManualReview)
    }

    @Test fun modelAgreementOnWrongReferenceStillDoesNotVerifyActualSource() {
        val first = read("交易号 AB00112LZ2026")
        val second = first.copy(model = "latin:16.0.1")
        val result = ReferenceOcrEvidence.assess(listOf(first, second))
        assertEquals("AB00112LZ2026", result.unambiguousText)
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "AB0O1I2LZ2026")))
        assertTrue(result.requiresManualReview)
    }

    @Test fun competingReferencesAreRetainedWithoutBestMatchSelection() {
        val result = assess("交易号 ABC12345", "订单号 ABC12346")
        assertEquals(setOf("ABC12345", "ABC12346"), result.candidates.map { it.reference }.toSet())
        assertNull(result.unambiguousText)
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "ABC12345")))
    }

    @Test fun sameAmountDoesNotResolveDifferentTransactions() {
        val first = assess("付款成功 CNY 90.00", "交易号 ABC12345")
        val second = assess("付款成功 CNY 90.00", "交易号 ABC12346")
        assertNotEquals(first.unambiguousText, second.unambiguousText)
        assertFalse(second.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "ABC12345")))
        assertTrue(first.requiresManualReview && second.requiresManualReview)
    }

    @Test fun sameReferenceAcrossProvidersOrAccountsIsNotTheSameEvidence() {
        val result = assess("交易号 ABC12345")
        assertFalse(result.matchesSourceText(ReferenceSourceText("synthetic.alipay", frame.accountScope, "ABC12345")))
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, "owner-B", "ABC12345")))
    }

    @Test fun mixingCapturesCannotCreateConsensus() {
        val first = read("交易号 ABC12345")
        val second = first.copy(frame = frame.copy(captureId = "capture-B"))
        val result = ReferenceOcrEvidence.assess(listOf(first, second))
        assertTrue(ReferenceIssue.MIXED_CAPTURES in result.issues)
        assertNull(result.unambiguousText)
    }

    @Test fun noReferenceStaysManual() {
        val result = assess("付款成功 CNY 90.00", "感谢使用")
        assertTrue(result.candidates.isEmpty())
        assertTrue(ReferenceIssue.MISSING_REFERENCE in result.issues)
        assertTrue(result.requiresManualReview)
    }

    @Test fun promotionalNotificationCannotVerifyEvenAnExactToken() {
        val result = assess("限时优惠 CNY 90.00", "交易号 ABC12345")
        assertTrue(ReferenceIssue.PROMOTIONAL_CONTENT in result.issues)
        assertNull(result.unambiguousText)
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "ABC12345")))
    }

    @Test fun visibleTruncationAndOverlongTokensNeverBecomeValidPrefixes() {
        for (text in listOf("ABC123…", "ABC123...", "ABC123****", "AB12", "A".repeat(129), "ABC123/456")) {
            val result = assess("交易号 $text")
            assertTrue(text, result.candidates.isEmpty())
            assertNull(result.unambiguousText)
        }
    }

    @Test fun silentMissingCharacterRemainsUnverifiedAgainstSource() {
        val result = assess("交易号 ABC1234")
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "ABC12345")))
        assertTrue(result.requiresManualReview)
    }

    @Test fun spacesAndLineWrapsAreNotSilentlyJoined() {
        assertNull(assess("交易号 ABC123 DEF456").unambiguousText)
        val first = line("交易号 ABC123", 800)
        val next = line("DEF456", 865)
        val result = ReferenceOcrEvidence.assess(listOf(read().copy(lines = listOf(first, next))))
        assertTrue(ReferenceIssue.MALFORMED_OR_SPLIT in result.issues)
        assertNull(result.unambiguousText)
        assertFalse(result.candidates.any { it.reference == "ABC123DEF456" })
    }

    @Test fun separatedLabelCanLocateOneWholeAdjacentValue() {
        val lines = listOf(ReferenceLine("交易号", ReferenceBox(90, 800, 250, 850)), line("ABC12345", 865))
        val result = ReferenceOcrEvidence.assess(listOf(read().copy(lines = lines)))
        assertEquals("ABC12345", result.unambiguousText)
        assertEquals(lines.first(), result.candidates.single().anchor)
    }

    @Test fun multipleNearbyValuesAreAmbiguous() {
        val lines = listOf(ReferenceLine("交易号", ReferenceBox(90, 800, 250, 850)),
            line("ABC12345", 860), line("DEF12345", 910))
        assertNull(ReferenceOcrEvidence.assess(listOf(read().copy(lines = lines))).unambiguousText)
    }

    @Test fun identifierWithoutALabelHasNoAuthority() {
        assertTrue(assess("ABC12345").candidates.isEmpty())
    }

    @Test fun regionRereadRetainsOriginalAnchorEvidence() {
        val anchor = line("交易号 ABC12345")
        val region = read("ABC12345").copy(anchor = anchor, variant = "value-native")
        val result = ReferenceOcrEvidence.assess(listOf(region))
        assertEquals("ABC12345", result.unambiguousText)
        assertEquals(anchor, result.candidates.single().anchor)
        assertTrue(result.requiresManualReview)
    }

    @Test fun emptyRereadVetoesAUniquePrimaryString() {
        val first = read("交易号 ABC12345")
        val result = ReferenceOcrEvidence.assess(listOf(first, first.copy(lines = emptyList(), variant = "gray")))
        assertTrue(ReferenceIssue.READ_DISAGREEMENT in result.issues)
        assertNull(result.unambiguousText)
    }

    @Test fun edgeClippedTokenStaysManual() {
        val first = read("交易号 ABC12345")
        val result = ReferenceOcrEvidence.assess(listOf(first.copy(lines = listOf(
            ReferenceLine("交易号 ABC12345", ReferenceBox(1, 800, 800, 850))))))
        assertTrue(ReferenceIssue.CLIPPED in result.issues)
        assertNull(result.unambiguousText)
    }

    @Test fun missingScopeOrImageDigestCannotPassComparison() {
        val first = read("交易号 ABC12345")
        for (bad in listOf(frame.copy(accountScope = ""), frame.copy(imageSha256 = ""))) {
            val result = ReferenceOcrEvidence.assess(listOf(first.copy(frame = bad)))
            assertTrue(ReferenceIssue.MISSING_PROVENANCE in result.issues)
            assertNull(result.unambiguousText)
        }
    }

    @Test fun unicodeLookalikesAndCaseAreNotFoldedToMatch() {
        assertNull(assess("交易号 ＡＢＣ１２３４５").unambiguousText)
        val result = assess("交易号 abc12345")
        assertFalse(result.matchesSourceText(ReferenceSourceText(frame.sourcePackage, frame.accountScope, "ABC12345")))
    }
}
