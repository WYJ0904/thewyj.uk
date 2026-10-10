package uk.thewyj.app.task21.payment

import org.junit.Assert.*
import org.junit.Test

class PaymentOcrTransferAmountTest {
    private val receipt = listOf("500.00", "你已收款，资金已存入余额", "轉帳時間", "2026年10月09日 14:24:59", "賬單詳情")
    private fun bounds(lines: List<String>) = lines.mapIndexed { i, _ ->
        if (i == 0) OcrAmountBounds(480, 800, 960, 888) else OcrAmountBounds(200, 950 + i * 90, 1240, 984 + i * 90)
    }
    private fun recover(lines: List<String>, regions: List<OcrAmountBounds?> = bounds(lines)) =
        PaymentOcrTransferAmount.missingCurrencyIndex(lines, regions, 1440, 3120)

    @Test fun observedCompletedTransferRecoversOnlyProminentDecimalRegion() {
        assertEquals(0, recover(receipt))
        assertNull("ordinary page semantics still cannot guess the bare amount", PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm", receipt, 1))?.amountMinor)
    }

    @Test fun observedTraditionalTimeGlyphErrorIsCorrectedOnlyInTheCompleteLabel() {
        val observed = receipt.toMutableList().apply { this[2] = "轉帳時閒" }
        assertNull(recover(observed))
        val normalized = PaymentScreenshotVerifier.normalizeOcrLines(observed)
        assertEquals("轉帳時間", normalized[2])
        assertEquals(0, recover(normalized))
        assertEquals(listOf("今天空閒", "轉帳時閒提醒"), PaymentScreenshotVerifier.normalizeOcrLines(listOf("今天空閒", "轉帳時閒提醒")))
    }

    @Test fun oneCentAndFiveHundredRemainExactMinorUnits() {
        listOf("0.01" to 1L, "0.10" to 10L, "500.00" to 50000L).forEach { (amount, minor) ->
            val lines = receipt.toMutableList().apply { this[0] = amount }
            val index = requireNotNull(recover(lines))
            lines[index] = "¥${lines[index]}"
            assertEquals(minor, PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm", lines, 1))?.amountMinor)
        }
    }

    @Test fun currencyAlreadyPresentNeverUsesTheRecovery() {
        assertNull(recover(receipt.toMutableList().apply { this[0] = "¥500.00" }))
    }

    @Test fun ambiguousAmountsAndMalformedDecimalsStayManual() {
        assertNull(recover(receipt + "10.00"))
        listOf("500", "500.0", "500.001", "0500.00", "-500.00", "500,00").forEach { amount ->
            assertNull(amount, recover(receipt.toMutableList().apply { this[0] = amount }))
        }
    }

    @Test fun productChatSummarySensitiveAndUnknownDirectionCannotRecover() {
        assertNull(recover(listOf("500.00", "商品价格", "立即购买")))
        assertNull(recover(listOf("500.00", "转账时间", "账单详情", "明天转账给你")))
        assertNull(recover(receipt + "WeChat"))
        assertNull(recover(receipt + "请输入支付密码"))
        assertNull(recover(receipt.toMutableList().apply { this[1] = "交易成功" }))
        assertNull(recover(receipt.filterNot { it == "轉帳時間" }))
    }

    @Test fun smallOffCentreLowOnPageAndMissingBoundsStayManual() {
        val regions = bounds(receipt).toMutableList<OcrAmountBounds?>()
        regions[0] = OcrAmountBounds(480, 800, 960, 834); assertNull(recover(receipt, regions))
        regions[0] = OcrAmountBounds(10, 800, 200, 888); assertNull(recover(receipt, regions))
        regions[0] = OcrAmountBounds(480, 2500, 960, 2588); assertNull(recover(receipt, regions))
        regions[0] = null; assertNull(recover(receipt, regions))
    }
}
