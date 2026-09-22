package uk.thewyj.app.task21.payment

import android.graphics.Bitmap
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.FinanceDirection

/**
 * Task 24.1 visual verification fallback fixtures.
 *
 * The OCR engine itself is device-only, so the deterministic surface under test
 * is the pipeline around it: OCR text normalisation (letter/digit confusion),
 * the payment-context gate and the shared page semantics. Every ambiguous page
 * must stay manual, and a verification can only complete an existing
 * candidate/hint - never create another transaction.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentScreenshotOcrTest {
    private class FakeOcr(
        var lines: List<String>,
        var fail: Boolean = false,
        var confidence: Float = 0.99f,
    ) : OcrEngine {
        var calls = 0
        override suspend fun recognize(bitmap: Bitmap): List<OcrLine> {
            calls += 1
            if (fail) throw IllegalStateException("ocr unavailable")
            return lines.map { OcrLine(it, confidence) }
        }
    }

    private fun verify(
        lines: List<String>,
        failure: Boolean = false,
        sourcePackage: String = "com.tencent.mm",
        confidence: Float = 0.99f,
    ): Pair<PaymentEnrichment?, FakeOcr> {
        val engine = FakeOcr(lines, failure, confidence)
        val verifier = PaymentScreenshotVerifier(engine)
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val result = runBlocking { verifier.verify(bitmap, sourcePackage, 1_700_000_000_000L) }
        return result to engine
    }

    @Test fun paymentSuccessPageCompletesAmountAndDirection() {
        val (result, _) = verify(
            listOf("微信支付", "付款成功", "¥100.00", "收款方 示例商户", "支付方式 零钱", "订单号 2026091122001"),
        )
        assertNotNull(result)
        assertEquals(10_000L, result!!.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
    }

    @Test fun transferSuccessPageIsRecognised() {
        val (result, _) = verify(listOf("转账成功", "转账金额 ¥28.00", "收款方 张三", "2026-09-11 12:30"))
        assertNotNull(result)
        assertEquals(2800L, result!!.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
    }

    @Test fun traditionalTransferDetailUsesLabelledAmountNotTheServiceFee() {
        val (result, _) = verify(
            listOf(
                "轉賬詳情",
                "到賬成功",
                "轉帳 金額 ¥833.17",
                "服務費 ¥0.83",
                "轉賬類型 轉帳 至 個人 帳戶",
            ),
        )
        assertNotNull(result)
        assertEquals(83_317L, result!!.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
    }

    @Test fun traditionalWechatBankTransferUsesTheLabelledAmountAndOutgoingDirection() {
        val (result, _) = verify(
            listOf(
                "轉賬詳情",
                "到賬成功",
                "轉賬金額 ¥833.17",
                "服務費 ¥0.83",
                "轉賬類型 轉賬至個人賬戶",
            ),
        )
        assertNotNull(result)
        assertEquals(83_317L, result!!.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
    }

    @Test fun incomingPaymentIsIncome() {
        val (result, _) = verify(listOf("收款成功", "已收款 ¥50.00", "付款方 李四"))
        assertNotNull(result)
        assertEquals(5000L, result!!.amountMinor)
        assertEquals(FinanceDirection.INCOME, result.direction)
    }

    /** A chat line that merely mentions money must never become a payment. */
    @Test fun chatLineWithAmountIsNotAPayment() {
        val (result, _) = verify(listOf("张三", "我给你转了 ¥100 你先用", "晚上一起吃饭吗"))
        assertNull(result)
    }

    @Test fun productPricePageIsNotAPayment() {
        val (result, _) = verify(listOf("iPhone 16 Pro", "价格 ¥8999.00", "库存 12", "加入购物车", "立即购买"))
        assertNull(result)
    }

    @Test fun multipleAmountsWithoutDecisiveLabelStayManual() {
        // No 实付/订单金额 label: three different numbers cannot be booked.
        val (result, _) = verify(listOf("商品 ¥100.00", "运费 ¥12.00", "合计 ¥112.00", "付款成功"))
        assertNull("several amounts without 实付/订单金额 certainty must stay manual", result)
    }

    @Test fun decisiveAmountLabelResolvesMultipleAmounts() {
        val (result, _) = verify(listOf("商品 ¥100.00", "运费 ¥12.00", "实付 ¥112.00", "付款成功"))
        assertNotNull(result)
        assertEquals(11_200L, result!!.amountMinor)
    }

    @Test fun passwordPageIsNeverRead() {
        val (result, _) = verify(listOf("请输入支付密码", "¥100.00", "验证码 123456"))
        assertNull(result)
    }

    @Test fun emptyPageProducesNothing() {
        val (result, _) = verify(emptyList())
        assertNull(result)
    }

    /** OCR character substitutions may aid search but cannot verify money. */
    @Test fun ocrDigitConfusionCannotInventVerifiedMoney() {
        val (result, _) = verify(listOf("微信支付", "付款成功", "¥1OO.OO", "收款方 示例商户"))
        assertNull(result)
    }

    @Test fun exactSmallAmountsStayDistinctAndRemainSuggestions() {
        for ((amount, expectedMinor) in listOf(
            "0.01" to 1L, "0.10" to 10L, "1.00" to 100L,
            "9.00" to 900L, "10.00" to 1000L,
        )) {
            val (result, _) = verify(listOf("微信支付", "付款成功", "支付金额 ¥$amount"))
            assertNotNull("¥$amount must be parsed without changing its digits", result)
            assertEquals(expectedMinor, result!!.amountMinor)
            assertEquals(PaymentEvidenceSource.OCR, result.evidenceSource)
            assertTrue(result.confidence <= 700)
        }
    }

    @Test fun lowConfidenceOrIncompleteDecimalsRemainManual() {
        val (uncertain, _) = verify(
            listOf("微信支付", "付款成功", "支付金额 ¥9.00"), confidence = 0.60f,
        )
        assertNull(uncertain)
        val (incomplete, _) = verify(listOf("微信支付", "付款成功", "支付金额 ¥9"))
        assertNull(incomplete)
        val (oneDecimal, _) = verify(listOf("微信支付", "付款成功", "支付金额 ¥0.1"))
        assertNull(oneDecimal)
    }

    @Test fun ocrFailureDegradesToManual() {
        val (result, engine) = verify(listOf("¥100.00", "付款成功"), failure = true)
        assertNull("an OCR failure must never invent data", result)
        assertTrue(engine.calls >= 1)
    }

    @Test fun duplicateVerificationDoesNotCreateASecondResult() {
        val engine = FakeOcr(listOf("微信支付", "付款成功", "¥100.00", "收款方 示例商户"))
        val verifier = PaymentScreenshotVerifier(engine)
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val first = runBlocking { verifier.verify(bitmap, "com.tencent.mm", 1L) }
        val second = runBlocking { verifier.verify(bitmap, "com.tencent.mm", 2L) }
        assertNotNull(first)
        assertNotNull(second)
        // The same page yields the same enrichment; the coordinator turns it into
        // the same candidate for the same ticket instead of a new payment.
        assertEquals(first!!.amountMinor, second!!.amountMinor)
        assertEquals(2, engine.calls)
    }

    @Test fun paymentContextGateRejectsPagesWithoutMoney() {
        assertFalse(PaymentScreenshotVerifier.looksLikePaymentPage(listOf("付款成功", "感谢使用")))
        assertTrue(PaymentScreenshotVerifier.looksLikePaymentPage(listOf("付款成功", "¥100.00")))
        assertFalse(PaymentScreenshotVerifier.looksLikePaymentPage(listOf("¥100.00")))
    }

    @Test fun ocrNormalisationKeepsWordMeaning() {
        val normalized = PaymentScreenshotVerifier.normalizeOcrLines(
            listOf("  付款成功  ", "¥1OO.OO", "收款方 Song 商户", "¥28.OO"),
        )
        assertTrue(normalized.contains("付款成功"))
        assertTrue(normalized.any { it.contains("100.00") })
        assertTrue(normalized.any { it.contains("28.00") })
        assertTrue("non-numeric words stay intact", normalized.any { it.contains("Song") })
    }
}
