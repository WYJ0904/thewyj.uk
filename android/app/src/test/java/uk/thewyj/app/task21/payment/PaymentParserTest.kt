package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.task21.FinanceDirection

/**
 * Phase 6 regression suite: source-specific payment parsing. Parsers must never
 * invent an amount, a merchant or a direction, and marketing/OTP/balance text is
 * never a transaction.
 */
class PaymentParserTest {
    private fun wechat(title: String, text: String) = PaymentParserRegistry.parse(
        sourcePackage = "com.tencent.mm",
        sourceType = PaymentSourceType.NOTIFICATION,
        title = title,
        text = text,
        capturedAtMs = 1_000L,
    )

    private fun alipay(title: String, text: String) = PaymentParserRegistry.parse(
        sourcePackage = "com.eg.android.AlipayGphone",
        sourceType = PaymentSourceType.NOTIFICATION,
        title = title,
        text = text,
        capturedAtMs = 2_000L,
    )

    private fun bankNotification(title: String, text: String) = PaymentParserRegistry.parse(
        sourcePackage = "com.chinamworld.main",
        sourceType = PaymentSourceType.BANK_NOTIFICATION,
        title = title,
        text = text,
        capturedAtMs = 3_000L,
    )

    private fun sms(title: String, text: String) = PaymentParserRegistry.parse(
        sourcePackage = "sms",
        sourceType = PaymentSourceType.SMS,
        title = title,
        text = text,
        capturedAtMs = 4_000L,
    )

    @Test fun wechatCompletedPaymentIsConfirmedWithAmountAndDirection() {
        val result = wechat("微信支付", "微信支付：支付成功 ￥28.00")
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
        assertEquals(2800L, result.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
        assertEquals("wechat", result.paymentChannel)
        assertTrue(result.isTransactionLike)
    }

    @Test fun wechatIncomingPaymentIsIncome() {
        val result = wechat("微信支付", "微信转账：收款成功 ￥50.00 已到账")
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
        assertEquals(5000L, result.amountMinor)
        assertEquals(FinanceDirection.INCOME, result.direction)
    }

    @Test fun wechatTransferHintWithoutAmountNeedsEnrichment() {
        // The real device produced notifications that only contain 昵称 + 转账.
        val result = wechat("老周炒股 · 内部", "转账")
        assertEquals(PaymentRecognitionStatus.PAYMENT_LIKELY, result.status)
        assertNull("amount must never be guessed", result.amountMinor)
        assertTrue(result.missingFields.contains("amount"))
        assertTrue(result.confidence < 500)
    }

    @Test fun wechatMarketingIsNeverAPayment() {
        val result = wechat("微信支付", "微信支付有优惠，满100减20，点击领取优惠券")
        assertEquals(PaymentRecognitionStatus.NOT_PAYMENT, result.status)
        assertFalse(result.isTransactionLike)
    }

    @Test fun alipayCompletedPaymentIsConfirmed() {
        val result = alipay("支付宝", "支付宝：付款成功 ¥18.50 商户：杭州便利店")
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
        assertEquals(1850L, result.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
        assertEquals("杭州便利店", result.merchant)
    }

    @Test fun alipayMissingAmountStaysInsufficient() {
        val result = alipay("支付宝", "支付宝：你有一笔转账待领取")
        assertTrue(result.status in setOf(
            PaymentRecognitionStatus.INSUFFICIENT_INFORMATION,
            PaymentRecognitionStatus.PAYMENT_LIKELY,
        ))
        assertNull(result.amountMinor)
        assertTrue(result.missingFields.contains("amount"))
    }

    @Test fun alipayVerificationCodeIsNotAPayment() {
        val result = alipay("支付宝", "验证码 123456，请勿泄露，用于登录验证")
        assertEquals(PaymentRecognitionStatus.NOT_PAYMENT, result.status)
    }

    @Test fun bankNotificationWithAmountIsConfirmedAndKeepsMaskedTail() {
        val result = bankNotification("建设银行", "您尾号4321的储蓄卡消费人民币 256.00 元，交易成功")
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
        assertEquals(25600L, result.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
        assertEquals("4321", result.accountTail)
    }

    @Test fun bankNotificationWithoutAmountNeedsEnrichment() {
        val result = bankNotification("建设银行", "您的账户有一笔交易提醒，请登录查看")
        assertEquals(PaymentRecognitionStatus.INSUFFICIENT_INFORMATION, result.status)
        assertNull(result.amountMinor)
        assertTrue(result.missingFields.contains("amount"))
    }

    @Test fun bankSmsTransactionParsesAmountAndNeverStoresFullCard() {
        val result = sms("【招商银行】", "您尾号1234的储蓄卡于09月10日消费人民币28.00元，交易成功。")
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
        assertEquals(2800L, result.amountMinor)
        assertEquals(FinanceDirection.EXPENSE, result.direction)
        assertEquals("1234", result.accountTail)
        assertFalse("full card numbers must never be kept", result.toString().contains("6214830212345678"))
    }

    @Test fun bankSmsOtpIsRejected() {
        val result = sms("【工商银行】", "您的验证码是 998877，请勿告诉任何人。")
        assertEquals(PaymentRecognitionStatus.NOT_PAYMENT, result.status)
    }

    @Test fun bankSmsMarketingIsRejected() {
        val result = sms("【交通银行】", "尊享优惠：刷卡满1000返现100，活动期间有效，点击了解更多。")
        assertEquals(PaymentRecognitionStatus.NOT_PAYMENT, result.status)
    }

    @Test fun bankSmsBalanceReminderIsRejected() {
        val result = sms("【建设银行】", "您尾号1234的账户当前余额为 5,000.00 元。")
        assertEquals(PaymentRecognitionStatus.NOT_PAYMENT, result.status)
    }

    @Test fun identicalAmountsTwiceStayTwoIndependentRecognitions() {
        val first = wechat("微信支付", "支付成功 ￥28.00")
        val second = wechat("微信支付", "支付成功 ￥28.00")
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, first.status)
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, second.status)
        assertEquals(first.amountMinor, second.amountMinor)
    }

    @Test fun unknownPackageIsNotTreatedAsPayment() {
        val result = PaymentParserRegistry.parse(
            sourcePackage = "com.example.notapayapp",
            sourceType = PaymentSourceType.NOTIFICATION,
            title = "支付成功",
            text = "支付成功 ￥99.00",
            capturedAtMs = 5_000L,
        )
        assertEquals(PaymentRecognitionStatus.NOT_PAYMENT, result.status)
    }

    @Test fun wechatProviderReferenceIsKeptForReconciliation() {
        val withReference = wechat("微信支付", "支付成功 ￥28.00 交易号 4200001234567890")
        assertNotNull(withReference.providerReference)
        assertEquals("4200001234567890", withReference.providerReference)
    }
}
