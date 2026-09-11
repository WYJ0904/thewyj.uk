package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.task21.FinanceDirection

/**
 * Deterministic accessibility fixtures (Task 24.1 §3).
 *
 * Real-device verdict: the current WeChat build exposes **no text** through the
 * accessibility tree (`window_content` events arrive, `rootInActiveWindow`
 * yields zero text lines), so no selector can read a WeChat transaction page.
 * The parser itself is still verified here against captured text shapes from
 * pages that *do* expose text (Alipay, bank apps, and a WeChat-like page when a
 * future version exposes one), so a real device run can never be the only
 * evidence for the parsing rules.
 */
class PaymentPageSemanticsFixtureTest {
    private fun enrichment(vararg lines: String) = PaymentPageSemantics.extract(
        PaymentPageSnapshot(
            sourcePackage = "com.eg.android.AlipayGphone",
            textLines = lines.toList(),
            capturedAtMs = 1_700_000_000_000L,
        ),
    )

    @Test fun alipayStyleTransactionPageYieldsAmountAndDirection() {
        val result = enrichment(
            "账单详情",
            "付款成功",
            "¥28.00",
            "收款方 示例商户",
            "付款方式 余额宝",
            "订单号 2026091122001451234567",
        )
        assertNotNull("a complete payment page must enrich", result)
        assertEquals(2800L, result!!.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
        assertEquals("2026091122001451234567", result.providerReference)
        assertTrue(result.confidence >= 820)
    }

    @Test fun bankStyleIncomePageYieldsIncomeDirection() {
        val result = enrichment(
            "交易详情",
            "收入",
            "人民币 1,000.00",
            "转账 张三",
            "交易时间 2026-09-11 12:30",
        )
        assertNotNull(result)
        assertEquals(100_000L, result!!.amountMinor)
        assertEquals(FinanceDirection.INCOME, result.direction)
    }

    @Test fun passwordAndOtpPagesAreNeverRead() {
        assertNull(
            enrichment(
                "请输入支付密码",
                "¥28.00",
                "验证码 123456",
            ),
        )
    }

    @Test fun pageWithoutAnAmountIsNotInvented() {
        assertNull(
            enrichment(
                "转账",
                "张三",
                "请选择付款方式",
            ),
        )
    }

    /**
     * The exact shape the device produced for WeChat: many window events but no
     * text at all. The service must report "no text" instead of parsing a page
     * it cannot see.
     */
    @Test fun emptyPageProducesNoEnrichment() {
        assertNull(enrichment())
        assertNull(
            PaymentPageSemantics.extract(
                PaymentPageSnapshot(
                    sourcePackage = "com.tencent.mm",
                    textLines = emptyList(),
                    capturedAtMs = 1_700_000_000_000L,
                ),
            ),
        )
    }

    @Test fun chatPreviewIsNotATransaction() {
        // A page that only shows the chat list must not fabricate a payment.
        assertNull(
            enrichment(
                "微信",
                "张三",
                "晚上一起吃饭吗",
                "老周横眉 · 内圈",
            ),
        )
    }
}
