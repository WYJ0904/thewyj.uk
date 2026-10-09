package uk.thewyj.app.task21.payment

import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.task21.FinanceDirection

class PaymentAmountDeviceRegressionTest {
    @Test fun remainingScreenshotCooldownCannotScheduleInsidePageDebounce() {
        val now = 42_664L
        val retry = PaymentPageRetry("real-samsung-case3", now)
        assertTrue(retry.beginAttempt(now))
        val remainingScreenshotCooldown = PaymentScreenshotThrottle.retryDelayMs(38_751L, now, 4_000L)
        assertEquals(87L, remainingScreenshotCooldown)
        val scheduledDelay = requireNotNull(retry.nextDelayMs(now, remainingScreenshotCooldown))
        assertEquals(250L, scheduledDelay)
        assertTrue("the scheduled callback must actually be eligible", retry.beginAttempt(now + scheduledDelay))
        assertEquals(2, retry.attempts)
    }

    @Test fun debounceAdjustmentCannotExtendFiniteRetryWindow() {
        val retry = PaymentPageRetry("near-deadline", 1_000L)
        assertTrue(retry.beginAttempt(12_900L))
        assertNull(retry.nextDelayMs(12_900L, 5L))
        assertEquals(1, retry.attempts)
        assertFalse(retry.beginAttempt(13_150L))
    }
    private fun page(vararg lines: String, groups: List<List<String>> = emptyList()) = PaymentPageSemantics.extract(
        PaymentPageSnapshot("com.tencent.mm", lines.toList(), 1_000L, groups))

    @Test fun oneCentMustNeverBecomeTenYuanAcrossCurrencyFormats() {
        listOf("¥0.01", "￥0.01", "0.01元", "¥０.０１", "¥\u00a00.01", "CNY 0.01", "¥0,01").forEach {
            assertEquals(it, 1L, page("交易详情", "付款成功", it)?.amountMinor)
        }
    }
    @Test fun exactMinorUnitsAcrossAllRequestedAmounts() {
        val values = listOf("0.01" to 1L, "0.10" to 10L, "0.99" to 99L, "1.00" to 100L, "1.01" to 101L,
            "9.99" to 999L, "10.00" to 1000L, "10.01" to 1001L, "99.99" to 9999L, "100.01" to 10001L, "1000.01" to 100001L)
        values.forEach { (text, minor) -> assertEquals(text, minor, page("付款成功", "¥$text")?.amountMinor) }
        assertEquals(123456L, PaymentText.parseMinor("1,234.56"))
    }
    @Test fun splitSymbolAndWholeAmountAreRecognised() {
        assertEquals(1L, page("付款成功", "¥", "0.01")?.amountMinor)
    }
    @Test fun decimalPointNodesRequireTheSameProvenParent() {
        val tokens = listOf("¥", "0", ".", "01")
        assertEquals(1L, page("付款成功", *tokens.toTypedArray(), groups = listOf(tokens))?.amountMinor)
        assertNull(page("付款成功", *tokens.toTypedArray())?.amountMinor)
        assertNull(page("付款成功", groups = listOf(listOf("¥", "1", "0", ".", "00")))?.amountMinor)
    }
    @Test fun timeAndOrderNodesCannotBecomeAnAmountByCrossLineJoining() {
        assertEquals(1L, page("账单详情", "¥0.01", "付款成功", "00:51:58", "收款方", "订单号 202610080001")?.amountMinor)
        assertEquals(listOf(1L), PaymentPageAmountSelection.select(listOf("¥0.01", "00:51:58", "收款" )).candidates.map { it.minor })
    }
    @Test fun discountsOriginalPriceAndFeesCannotBeatActualPayment() {
        assertEquals(1L, page("付款成功", "原价 ¥10.00", "优惠 ¥9.99", "服务费 ¥1.00", "实付 ¥0.01")?.amountMinor)
    }
    @Test fun conflictingStrongAmountsFailClosedEvenWithAnActualPaidLabel() {
        assertNull(page("付款成功", "实付 ¥0.01", "付款金额 ¥10.00"))
        assertNull(page("付款成功", "¥0.01", "¥10.00"))
    }
    @Test fun paymentSummaryOnWechatHomeOrChatCannotVerifyADetailTicket() {
        assertNull(page("WeChat", "Weixin Pay", "已支付¥50.00", "77 79 6A", "[转账]"))
        assertNull(page("Weixin Pay", "¥50.00", "账单详情", "已支付"))
    }
    @Test fun traditionalPendingTransferReadsOneCentAndNeverTreatsFutureReturnAsRefund() {
        val result = page("待示例收款", "¥0.01", "若對方在 1 天內未收款，資金將會退還給你。", "轉帳時間", "2026年10月08日 00:51:58", "賬單詳情")
        assertEquals(1L, result?.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result?.direction)
    }
    @Test fun malformedPrecisionAndGroupingAreRejectedWithoutRoundingOrTruncation() {
        listOf("0.001", "100.019", "1,00,0", "10.00.01", "-0.01", "10000001", "NaN", "Infinity").forEach { assertNull(it, PaymentText.parseMinor(it)) }
        assertNull(PaymentText.amountMinor("支付100.019"))
        assertNull(PaymentText.amountMinor("¥100.019"))
        assertNull(PaymentText.amountMinor("¥001"))
        assertNull(PaymentText.amountMinor("¥01000"))
        assertEquals(1L, PaymentText.amountMinor("已支付0,01"))
        assertEquals(1L, PaymentText.amountMinor(PaymentText.normalize("付款成功", "￥０.０１", "", "")))
    }
    @Test fun firstNullRootCanRetryButContentStormsCannotResetTheBudget() {
        val retry = PaymentPageRetry("ticket|page", 1_000L)
        assertTrue(retry.beginAttempt(1_000L))
        repeat(100) { assertFalse(retry.beginAttempt(1_010L)) }
        repeat(20) { assertFalse(retry.beginAttempt(1_250L + it * 250L, scheduledRetryPending = true)) }
        assertEquals(1, retry.attempts)
        assertEquals(250L, retry.nextDelayMs(1_000L))
        assertTrue(retry.beginAttempt(1_250L)) // A delayed root is now readable.
        repeat(6) { assertTrue(retry.beginAttempt(1_500L + it * 300L)) }
        assertFalse(retry.beginAttempt(4_000L))
        assertNull(retry.nextDelayMs(4_000L))
    }
    @Test fun knownWechatChatAndLauncherWindowsAreNeverPaymentDetails() {
        assertTrue(PaymentPageContext.blockedWechatActivity("com.tencent.mm.ui.LauncherUI"))
        assertTrue(PaymentPageContext.blockedWechatActivity("com.tencent.mm.ui.chatting.ChattingUI"))
        assertFalse(PaymentPageContext.blockedWechatActivity("com.tencent.mm.plugin.remittance.ui.RemittanceDetailUI"))
    }
    @Test fun leavingPageCancelsRetriesAndResumeGetsANewFiniteBudget() {
        val retry = PaymentPageRetry("ticket|page", 1_000L)
        retry.cancel()
        assertFalse(retry.beginAttempt(1_500L)); assertNull(retry.nextDelayMs(1_500L))
        assertTrue(PaymentPageRetry("ticket|resume", 2_000L).beginAttempt(2_000L))
        assertFalse(PaymentPageRetry("ticket|old", 1_000L).beginAttempt(13_001L))
    }
    @Test fun lowConfidenceAndConsumedTicketCannotCompleteAnotherVerification() {
        val engine = PaymentTicketEngine(now = { 1_000L })
        val ticket = engine.create("synthetic-account", "one-payment", "com.tencent.mm", "event", "wechat", missingFields = setOf("amount"))
        val evidence = PaymentEnrichment("com.tencent.mm", 1L, "CNY", FinanceDirection.EXPENSE, null, null, null, 1_000L, 640)
        assertTrue(engine.enrich(ticket, evidence) is EnrichmentOutcome.Insufficient)
        val applied = engine.enrich(ticket, evidence.copy(confidence = 820)) as EnrichmentOutcome.Applied
        assertTrue(engine.enrich(engine.markCandidateCreated(applied.ticket), evidence.copy(amountMinor = 1000L, confidence = 900)) is EnrichmentOutcome.Rejected)
    }
}
