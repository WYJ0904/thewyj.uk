package uk.thewyj.app.task21.payment

import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.task21.FinanceDirection

/** Redacted synthetic cases: parser tests, never actual payment/device evidence. */
class PendingTransferSafetyRegressionTest {
    @Test fun awaitingMyReceiptIsNotOutgoing() {
        val lines = listOf("¥0.10", "待你收款", "转账时间", "转账详情")
        assertFalse(PaymentPageContext.pendingOutgoing(lines))
        assertEquals(FinanceDirection.INCOME,
            PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm", lines, 1))?.direction)
    }

    @Test fun awaitingOtherPartyIsOutgoingButNotReceived() {
        val lines = listOf("￥1.00", "待对方收款", "轉帳時間", "轉帳詳情")
        assertTrue(PaymentPageContext.pendingOutgoing(lines))
        assertEquals(FinanceDirection.EXPENSE,
            PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm", lines, 1))?.direction)
    }

    @Test fun paymentChannelTitleAndNumberDoNotProveSettlement() {
        val parsed = WeChatPaymentParser.parse("微信支付", "转账199元，待对方收款", "", "", 1)
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, parsed.status)
        assertEquals(19900L, parsed.amountMinor)
    }

    @Test fun pendingReceiptCanRecoverMissingGlyphWithoutAssumingPaymentCompleted() {
        val lines = listOf("0.10", "待你收款", "转账时间", "2026年10月10日 12:00:00")
        val bounds = lines.mapIndexed { i, _ ->
            if (i == 0) OcrAmountBounds(480, 800, 960, 888)
            else OcrAmountBounds(200, 950 + i * 90, 1240, 984 + i * 90)
        }
        assertEquals(0, PaymentOcrTransferAmount.missingCurrencyIndex(lines, bounds, 1440, 3120))
        assertNull(PaymentOcrTransferAmount.missingCurrencyIndex(
            lines + "500.00", bounds + OcrAmountBounds(480, 900, 960, 988), 1440, 3120))
    }
}
