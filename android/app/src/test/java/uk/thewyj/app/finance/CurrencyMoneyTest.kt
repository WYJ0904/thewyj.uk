package uk.thewyj.app.finance

import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.task21.payment.PaymentParserRegistry
import uk.thewyj.app.task21.payment.PaymentSourceType
import uk.thewyj.app.task21.payment.PaymentRecognitionStatus

class CurrencyMoneyTest {
    @Test fun independentDecimalOracleAgreesAcrossAllCurrencyPairs() {
        val cases = org.json.JSONObject(java.io.File("../../qa/finance-p04/fixtures/exact-oracle.json").readText()).getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val row = cases.getJSONObject(index)
            if (row.getBoolean("overflow")) assertThrows(Exception::class.java) { CurrencyMoney.convert(row.getLong("minor"),row.getString("base"),row.getString("quote"),row.getString("rate")) }
            else assertEquals(row.getString("id"),row.getLong("expected"),CurrencyMoney.convert(row.getLong("minor"),row.getString("base"),row.getString("quote"),row.getString("rate")))
        }
    }
    @Test fun pageEnrichmentKeepsSixUnitsAndAllExistingPrivacyGates() {
        for (currency in CurrencyMoney.digits.keys) {
            val amount = if (currency == "JPY") "100" else "100.00"
            val snapshot = uk.thewyj.app.task21.payment.PaymentPageSnapshot("com.tencent.mm",listOf("交易详情","已扣款 $currency $amount"),1000)
            val parsed = uk.thewyj.app.task21.payment.PaymentPageSemantics.extract(snapshot,currencyPolicyVersion=2)
            assertNotNull(currency,parsed);assertEquals(currency,parsed!!.currency);assertEquals(if(currency=="JPY")100L else 10000L,parsed.amountMinor)
        }
        fun page(vararg lines: String) = uk.thewyj.app.task21.payment.PaymentPageSemantics.extract(
            uk.thewyj.app.task21.payment.PaymentPageSnapshot("com.tencent.mm",lines.toList(),1000),currencyPolicyVersion=2)
        assertNull(page("交易详情","支付成功 100.00"))
        assertNull(page("交易详情","支付成功 AUD 100.00"))
        assertNull(page("交易详情","支付成功 JPY 1.25"))
        assertNull(page("交易详情","支付成功 USD 100.00","验证码 123456"))
    }
    @Test fun sixCurrenciesUseTheirIsoMinorUnits() {
        CurrencyMoney.digits.forEach { (currency, digits) ->
            assertEquals(if (digits == 0) 123L else 12300L, CurrencyMoney.parse("123", currency))
            assertEquals("123" + if (digits == 0) "" else ".00", CurrencyMoney.decimalText(CurrencyMoney.parse("123", currency), currency))
        }
        assertEquals(12345L, CurrencyMoney.parse("123.45", "USD"))
        assertEquals(-29L, CurrencyMoney.parse("-0.29", "GBP"))
    }
    @Test fun jpyHasNoDecimalScalingOrFractionalInput() {
        assertEquals(12345L, CurrencyMoney.parse("12345", "JPY"))
        assertFalse(CurrencyMoney.format(12345, "JPY").contains(".45"))
        assertThrows(IllegalArgumentException::class.java) { CurrencyMoney.parse("1.0", "JPY") }
    }
    @Test fun invalidAndUnknownAmountsFailClosed() {
        for (text in listOf("", "NaN", "Infinity", "1e3", "1,000", "01", "1.001"))
            assertThrows(IllegalArgumentException::class.java) { CurrencyMoney.parse(text, "CNY") }
        assertThrows(IllegalArgumentException::class.java) { CurrencyMoney.parse("1", "AUD") }
        assertThrows(Exception::class.java) { CurrencyMoney.parse("9007199254740992", "USD") }
    }
    @Test fun conversionsRoundHalfEvenOnceAndPreserveRefundSigns() {
        assertEquals(0L, CurrencyMoney.convert(1, "USD", "CNY", "0.5"))
        assertEquals(2L, CurrencyMoney.convert(3, "USD", "CNY", "0.5"))
        assertEquals(-2L, CurrencyMoney.convert(-3, "USD", "CNY", "0.5"))
        assertEquals(50000L, CurrencyMoney.convert(10000, "JPY", "CNY", "0.05"))
        assertEquals(2469L, CurrencyMoney.convert(12345, "CNY", "JPY", "20"))
        assertEquals(2L, CurrencyMoney.cross(101, "USD", "JPY", "2", "3"))
        assertEquals(10000L, CurrencyMoney.cross(70000, "CNY", "USD", "7", "1"))
    }
    @Test fun zeroNegativeAndOversizedRatesAreNotFallbackRates() {
        for (rate in listOf("0", "-1", "NaN", "1e99")) assertThrows(Exception::class.java) { CurrencyMoney.convert(100, "USD", "CNY", rate) }
        assertThrows(Exception::class.java) { CurrencyMoney.convert(9_007_199_254_740_991, "USD", "CNY", "2") }
    }
    private fun parse(text: String, default: String? = null) = PaymentParserRegistry.parse("com.tencent.mm", PaymentSourceType.NOTIFICATION,
        "微信支付", text, capturedAtMs = 1792411200000, defaultCurrency = default, currencyPolicyVersion = 2)
    @Test fun explicitCurrenciesOverrideDefaultsAndStayInOriginalUnits() {
        for (currency in CurrencyMoney.digits.keys) {
            val result = parse("已扣款 $currency 100", "HKD")
            assertEquals(currency, result.currency)
            assertEquals(if (currency == "JPY") 100L else 10000L, result.amountMinor)
            assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
        }
    }
    @Test fun unknownAndAmbiguousCurrenciesRequireAUserDecision() {
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, parse("已扣款 100").status)
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, parse("已扣款 $100.00").status)
        assertEquals("USD", parse("已扣款 $100.00", "USD").currency)
        assertEquals(10000L, parse("已扣款 100", "HKD").amountMinor)
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, parse("已扣款 AUD 100", "CNY").status)
        assertNull(parse("已扣款 JPY 1.25").amountMinor)
        assertNull(parse("已扣款 USD 1e3", "USD").amountMinor)
        assertNull(parse("已扣款 USD -100.00", "USD").amountMinor)
    }
    @Test fun originalSettlementAndFeeRolesNeverDoubleBookOrBecomeAnFxRate() {
        val result = parse("原币 USD 100.00，清算人民币700.00元，手续费10.00元，已扣款", "USD")
        assertEquals("USD", result.currency); assertEquals(10000L, result.amountMinor)
        val roles = CurrencyDecision.roles("原币 USD 100.00，清算人民币700.00元，手续费10.00元，已扣款")!!
        assertEquals("CNY", roles.settlementCurrency); assertEquals(70000L, roles.settlementAmount)
        assertEquals(1000L, roles.feeAmount)
        val zeroFee = CurrencyDecision.roles("原币 USD 100.00，清算 CNY 700.00，手续费 CNY 0.00，已扣款")!!
        assertEquals(0L, zeroFee.feeAmount)
        assertTrue(CurrencyDecision.validatedRolesJson(zeroFee.json()).isNotBlank())
        assertEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, result.status)
    }
    @Test fun currencyCannotGrantCompletionOrOverrideLifecycleReview() {
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, parse("已扣款 USD 100.00 待确认").status)
        val hold = parse("预授权 USD 100.00")
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, hold.status)
        assertNotEquals(PaymentRecognitionStatus.CONFIRMED_PAYMENT, parse("清算成功 USD 80.00 授权号缺失").status)
    }
}
