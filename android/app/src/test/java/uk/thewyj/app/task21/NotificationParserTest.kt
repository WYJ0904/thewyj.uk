package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationParserTest {
    private val receivedAt = 1_700_000_000_000L

    private fun parse(sourcePackage: String, title: String, text: String) =
        NotificationParserRegistry.parserFor(sourcePackage)!!.parse(
            ParserInput(sourcePackage, title, text, "", ""),
            receivedAt,
        )

    @Test fun wechatExpenseIsParsed() {
        val output = parse("com.tencent.mm", "微信支付", "支付成功，向商户付款 ￥12.80")
        assertEquals(FinanceDirection.EXPENSE, output.direction)
        assertEquals(1280L, output.amountMinor)
        assertEquals(ParseStatus.PARSED, output.parseStatus)
        assertEquals(NotificationEventType.TRANSACTION, output.eventType)
        assertEquals("wechat", output.paymentChannel)
    }

    @Test fun alipayRefundIsRefundNotIncome() {
        val output = parse("com.eg.android.AlipayGphone", "支付宝", "退款成功，退款到账 32.50 元")
        assertEquals(FinanceDirection.REFUND, output.direction)
        assertEquals(3250L, output.amountMinor)
        assertEquals(NotificationEventType.REFUND, output.eventType)
    }

    @Test fun marketingIsUnparsed() {
        val output = parse("com.tencent.mm", "优惠活动", "最高可借 50000 元，点击领取优惠券")
        assertEquals(ParseStatus.UNPARSED, output.parseStatus)
        assertEquals(NotificationEventType.MARKETING, output.eventType)
        assertEquals(FinanceDirection.UNKNOWN, output.direction)
        assertEquals(0L, output.amountMinor)
    }

    @Test fun verificationCodeIsUnparsed() {
        val output = parse("com.tencent.mm", "登录验证", "你的验证码是 123456，5 分钟内有效")
        assertEquals(ParseStatus.UNPARSED, output.parseStatus)
        assertEquals(NotificationEventType.VERIFICATION, output.eventType)
    }

    @Test fun amountWithCommaAndChineseYuan() {
        val output = parse("com.tencent.mm", "微信支付", "支付成功 1,234.56 元")
        assertEquals(123456L, output.amountMinor)
    }

    @Test fun incomeWithDirection() {
        val output = parse("com.tencent.mm", "收款通知", "已到账 200.00 元")
        assertEquals(FinanceDirection.INCOME, output.direction)
        assertEquals(20000L, output.amountMinor)
    }

    @Test fun malformedAndEmptyAreUnparsed() {
        assertEquals(ParseStatus.UNPARSED, parse("com.tencent.mm", "", "").parseStatus)
        assertEquals(ParseStatus.UNPARSED, parse("com.tencent.mm", "通知", "没有任何金额和方向").parseStatus)
    }

    @Test fun unicodeMerchantIsExtracted() {
        val output = parse("com.tencent.mm", "付款", "支付成功 商户：咖啡店 ￥18.00")
        assertEquals("咖啡店", output.merchant)
        assertTrue(output.confidence >= 700)
    }

    @Test fun sameContentProducesStableFingerprint() {
        val a = NotificationFingerprint.fingerprint("com.tencent.mm", "标题", "支付成功 ￥1.00", "", "")
        val b = NotificationFingerprint.fingerprint("com.tencent.mm", "标题", "支付成功 ￥1.00", "", "")
        assertEquals(a, b)
    }

    /**
     * Real-device regression: "已支付 ¥1000" must be a fully parsed payment
     * with confidence high enough for the backend to write the finance
     * transaction automatically (threshold 900).
     */
    @Test fun completedWeChatPaymentReachesAutoBookConfidence() {
        val output = parse("com.tencent.mm", "微信支付", "已支付 ¥1000")
        assertEquals(ParseStatus.PARSED, output.parseStatus)
        assertEquals(100_000L, output.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, output.direction)
        assertTrue("confidence=${output.confidence}", output.confidence >= 900)
    }

    @Test fun paymentVerbWithPlainNumberIsParsed() {
        val output = parse("com.tencent.mm", "微信支付", "已支付100")
        assertEquals(ParseStatus.PARSED, output.parseStatus)
        assertEquals(10_000L, output.amountMinor)
        assertTrue(output.confidence >= 900)
    }

    /**
     * Task 24 reopen (real device 2026-09-13): the user's own WeChat message
     * 「已支付¥100」 (contact-name title, no merchant) stayed "金额待填写".
     * An explicit payment verb plus an explicit amount must always resolve to
     * 100 CNY, with or without the currency symbol / spacing, and an unknown
     * merchant must never downgrade the amount.
     */
    @Test fun explicitPaymentVerbWithAmountParsesInEveryWrittenForm() {
        listOf(
            "已支付100",
            "已支付¥100",
            "已支付￥100",
            "已支付 100",
            "支付100元",
            "已付款100",
        ).forEach { text ->
            val output = parse("com.tencent.mm", "老周横眉", text)
            assertEquals("$text must parse 100 CNY", 10_000L, output.amountMinor)
            assertEquals("$text must be an expense", FinanceDirection.EXPENSE, output.direction)
            assertTrue("$text must reach a usable confidence: ${output.confidence}", output.confidence >= 700)
        }
    }

    @Test fun referenceNumbersAndChatAmountsStayUnparsed() {
        listOf("支付订单号 202609110001", "支付时间 2026-09-11", "支付验证码 123456", "张三：100 元的事明天聊").forEach {
            val output = parse("com.tencent.mm", "微信", it)
            assertEquals("$it must not produce an amount", 0L, output.amountMinor)
        }
    }
}

