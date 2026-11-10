package uk.thewyj.app.task21.payment

import android.graphics.Bitmap
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Deterministic pipeline checks supplement the real bundled-model bitmap tests on Samsung. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CurrencyOcrPipelineTest {
    private fun verify(lines: List<String>, currency: String?, confirm: (Long, String) -> Long? = { n, _ -> n }): PaymentEnrichment? {
        val engine = object : AmountConfirmingOcrEngine {
            override suspend fun recognize(bitmap: Bitmap) = lines
            override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long): Long? = error("Policy2 requires a currency")
            override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long, currency: String) = confirm(expectedMinor, currency)
        }
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        return try { runBlocking { PaymentScreenshotVerifier(engine).verify(bitmap, "com.tencent.mm", 1000L, currency, 2) } }
        finally { bitmap.recycle() }
    }
    @Test fun sixCurrenciesKeepTheirOwnMinorUnitsThroughSecondScale() {
        for ((currency, text, minor) in listOf(Triple("CNY", "¥100.00", 10000L), Triple("JPY", "¥100", 100L),
            Triple("USD", "$1.00", 100L), Triple("EUR", "€1.00", 100L), Triple("HKD", "HK$1.00", 100L), Triple("GBP", "£1.00", 100L))) {
            var confirmedUnit = ""
            val result = verify(listOf("交易详情", "支付成功", text), currency) { n, unit -> confirmedUnit = unit; n }
            assertNotNull(currency, result); assertEquals(currency, result!!.currency); assertEquals(minor, result.amountMinor)
            assertEquals(currency, confirmedUnit); assertEquals(PaymentEvidenceSource.OCR, result.evidenceSource)
        }
    }
    @Test fun missingAccountOrIncompatibleDefaultCannotAssignAnAmbiguousSymbol() {
        assertNull(verify(listOf("付款成功", "¥1.00"), null))
        assertNull(verify(listOf("付款成功", "¥1.00"), "USD"))
        assertNull(verify(listOf("付款成功", "$1.00"), "CNY"))
    }
    @Test fun explicitCurrencyDoesNotDependOnAnAccountDefault() {
        val result = verify(listOf("支付成功", "USD 1.00"), null)
        assertEquals("USD", result!!.currency); assertEquals(100L, result.amountMinor)
    }
    @Test fun jpyFractionAndConflictingOrUnsupportedCurrencyStayUnparsed() {
        assertNull(verify(listOf("付款成功", "JPY 1.50"), null))
        assertNull(verify(listOf("付款成功", "USD 1.00", "EUR 1.00"), null))
        assertNull(verify(listOf("付款成功", "AUD 1.00"), null))
    }
    @Test fun aDifferentScaleStillHasToConfirmTheExactUnitAndAmount() {
        assertNull(verify(listOf("付款成功", "JPY 100"), null) { n, _ -> n * 100 })
        assertNull(verify(listOf("付款成功", "USD 1.00"), null) { _, _ -> null })
    }
    @Test fun legacyCnyConfirmerCannotApproveForeignCurrency() {
        val engine = object : AmountConfirmingOcrEngine {
            override suspend fun recognize(bitmap: Bitmap) = listOf("支付成功", "JPY 100")
            override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long) = expectedMinor
        }
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        try { assertNull(runBlocking { PaymentScreenshotVerifier(engine).verify(bitmap, "com.tencent.mm", 1000L, null, 2) }) }
        finally { bitmap.recycle() }
    }
    @Test fun currencyCannotMakeAChatPriceOrPasswordPageIntoAReceipt() {
        assertNull(verify(listOf("聊天", "晚上给你 USD 1.00"), "USD"))
        assertNull(verify(listOf("商品价格 USD 1.00", "立即购买"), "USD"))
        assertNull(verify(listOf("支付成功", "USD 1.00", "请输入支付密码"), "USD"))
    }
    @Test fun pendingIncomingPageDoesNotBecomeCompletedByCurrencyResolution() {
        val result = verify(listOf("转账详情", "待你收款", "转账时间", "CNY 0.01"), null)
        assertNotNull(result); assertEquals(1L, result!!.amountMinor); assertFalse(result.completionConfirmed)
        assertEquals(uk.thewyj.app.task21.FinanceDirection.INCOME, result.direction)
    }
}
