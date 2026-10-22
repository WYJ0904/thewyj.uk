package uk.thewyj.app.finance

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/** Monetary facts use integer ISO units; reference conversion never edits them. */
object CurrencyMoney {
    val digits = mapOf("CNY" to 2, "USD" to 2, "EUR" to 2, "HKD" to 2, "GBP" to 2, "JPY" to 0)
    fun exponent(currency: String): Int = requireNotNull(digits[currency]) { "currency_unsupported" }
    fun parse(text: String, currency: String): Long {
        val scale = exponent(currency)
        require(Regex("-?(0|[1-9][0-9]{0,15})(\\.[0-9]+)?").matches(text.trim())) { "amount_invalid" }
        val decimal = BigDecimal(text.trim())
        require(decimal.scale() <= scale) { "amount_precision" }
        return decimal.movePointRight(scale).longValueExact().also { require(it in -9_007_199_254_740_991L..9_007_199_254_740_991L) { "amount_overflow" } }
    }
    fun decimalText(minor: Long, currency: String): String = BigDecimal.valueOf(minor, exponent(currency)).toPlainString()
    fun format(minor: Long, currency: String): String = runCatching {
        NumberFormat.getCurrencyInstance(Locale.CHINA).apply {
            this.currency = Currency.getInstance(currency)
            minimumFractionDigits = exponent(currency)
            maximumFractionDigits = exponent(currency)
            roundingMode = RoundingMode.UNNECESSARY
        }.format(BigDecimal.valueOf(minor, exponent(currency)))
    }.getOrElse { "$currency · 金额单位待核实" }
    private fun rate(text: String): BigDecimal {
        val match = Regex("([0-9]{1,24})(?:\\.([0-9]{1,18}))?(?:[eE]([+-]?[0-9]{1,2}))?").matchEntire(text)
        require(match != null && kotlin.math.abs(match.groupValues[3].ifBlank { "0" }.toInt()) <= 18) { "fx_rate_invalid" }
        return BigDecimal(text).also { require(it > BigDecimal.ZERO && it <= BigDecimal("1000000000000")) { "fx_rate_invalid" } }
    }
    private fun bounded(value: Long): Long = value.also { require(it in -9_007_199_254_740_991L..9_007_199_254_740_991L) { "amount_overflow" } }
    fun convert(minor: Long, base: String, quote: String, rate: String): Long {
        val source = exponent(base); val target = exponent(quote)
        bounded(minor)
        if (base == quote) return minor
        val decimalRate = rate(rate)
        return BigDecimal.valueOf(minor, source).multiply(decimalRate).movePointRight(target)
            .setScale(0, RoundingMode.HALF_EVEN).longValueExact().also { require(it in -9_007_199_254_740_991L..9_007_199_254_740_991L) { "amount_overflow" } }
    }
    fun cross(minor: Long, base: String, quote: String, baseRate: String, quoteRate: String): Long {
        val numerator = BigDecimal.valueOf(bounded(minor), exponent(base)).multiply(rate(quoteRate)).movePointRight(exponent(quote))
        return bounded(numerator.divide(rate(baseRate), 0, RoundingMode.HALF_EVEN).longValueExact())
    }
}
