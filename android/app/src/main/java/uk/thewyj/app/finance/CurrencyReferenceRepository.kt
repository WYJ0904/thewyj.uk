package uk.thewyj.app.finance

import android.content.Context
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import uk.thewyj.app.task21.NotificationIngestTransport

class CurrencyReferenceRepository(private val database: CurrencyReferenceDatabase) {
    private val dao get() = database.currencies()
    fun refreshPreferences(account: String, session: String, transport: NotificationIngestTransport, context: Context? = null): Boolean = runCatching {
        val response = transport.get("/api/finance/currencies?money_version=2", session)
        check(response.ok)
        val json = JSONObject(response.body).getJSONObject("preferences")
        val base = json.getString("account_currency"); val display = json.getString("display_currency")
        CurrencyMoney.exponent(base); CurrencyMoney.exponent(display)
        val default = json.optString("default_currency").takeUnless { it.isBlank() || it == "null" }
        default?.let(CurrencyMoney::exponent)
        val next = CachedCurrencyPreferences(account, base, display, default, json.getLong("revision"))
        database.runInTransaction {
            if ((dao.preferences(account)?.revision ?: -1) <= next.revision) dao.putPreferences(next)
        }
        if (context != null) CurrencyRuntimePreferences.save(context, account, dao.preferences(account)?.defaultCurrency)
        true
    }.getOrDefault(false)

    fun cached(account: String, transaction: String, revision: Long, quote: String): CachedCurrencyReference? = runCatching {
        CurrencyMoney.exponent(quote)
        val row = dao.reference(account, transaction, revision, quote) ?: return null
        val rate = dao.rate(row.rateId) ?: return null
        val snapshot = JSONObject(rate.snapshotJson)
        validateMetadata(snapshot)
        check(rate.id == snapshotId(snapshot))
        check(snapshot.getString("base") == row.originalCurrency && snapshot.getString("quote") == quote)
        check(CurrencyMoney.convert(row.originalMinor, row.originalCurrency, quote, snapshot.getString("rate")) == row.convertedMinor)
        row
    }.getOrNull()

    fun refresh(account: String, transaction: String, revision: Long, originalMinor: Long, originalCurrency: String,
                quote: String, session: String, transport: NotificationIngestTransport): CachedCurrencyReference? {
        cached(account, transaction, revision, quote)?.let { if (it.originalMinor == originalMinor && it.originalCurrency == originalCurrency) return it }
        return runCatching {
            CurrencyMoney.exponent(originalCurrency); CurrencyMoney.exponent(quote)
            val id = URLEncoder.encode(transaction, StandardCharsets.UTF_8.name())
            val response = transport.get("/api/finance/references?ids=$id&display_currency=$quote&money_version=2", session)
            check(response.ok)
            val snapshot = JSONObject(response.body).getJSONObject("references").getJSONObject("$transaction:$revision:$quote")
            cacheSnapshot(account, transaction, revision, originalMinor, originalCurrency, quote, snapshot)
        }.getOrNull()
    }

    /** One bounded read batch; it never blocks notification uploads or enrichment. */
    fun warmHistory(account: String, session: String, transport: NotificationIngestTransport) = runCatching {
        val quote = dao.preferences(account)?.displayCurrency ?: return@runCatching
        val response = transport.get("/api/finance/transactions?limit=12&money_version=2", session)
        check(response.ok)
        val transactions = JSONObject(response.body).getJSONArray("transactions")
        val expected = (0 until transactions.length()).map { transactions.getJSONObject(it) }.filter {
            it.optString("currency") in CurrencyMoney.digits && it.optString("currency") != quote &&
                it.optString("money_unit_status") != "review_required"
        }
        if (expected.isEmpty()) return@runCatching
        val ids = expected.joinToString(",") { URLEncoder.encode(it.getString("id"), StandardCharsets.UTF_8.name()) }
        val references = transport.get("/api/finance/references?ids=$ids&display_currency=$quote&money_version=2", session)
        check(references.ok)
        val snapshots = JSONObject(references.body).getJSONObject("references")
        for (row in expected) {
            val id = row.getString("id"); val revision = row.getLong("revision")
            val snapshot = snapshots.optJSONObject("$id:$revision:$quote") ?: continue
            runCatching { cacheSnapshot(account, id, revision, row.getLong("amount_minor"), row.getString("currency"), quote, snapshot) }
        }
    }.isSuccess

    fun projection(account: String): JSONObject = JSONObject().apply {
        for (row in dao.references(account)) {
            if (cached(account, row.transactionId, row.revision, row.quote) == null) continue
            val rate = dao.rate(row.rateId) ?: continue
            put("${row.transactionId}:${row.revision}:${row.quote}", JSONObject(rate.snapshotJson).put("id", row.rateId)
                .put("original_minor", row.originalMinor).put("converted_minor", row.convertedMinor)
                .put("transaction_revision", row.revision).put("reference_only", true).put("historical_reference", true))
        }
    }

    private fun cacheSnapshot(account: String, transaction: String, revision: Long, originalMinor: Long, originalCurrency: String,
                              quote: String, snapshot: JSONObject): CachedCurrencyReference {
            validateMetadata(snapshot)
            check(snapshot.getString("base") == originalCurrency && snapshot.getString("quote") == quote)
            check(snapshot.getLong("original_minor") == originalMinor && snapshot.getLong("transaction_revision") == revision)
            check(snapshot.getBoolean("reference_only") && snapshot.getBoolean("historical_reference"))
            val rate = JSONObject().apply { RATE_KEYS.forEach { put(it, snapshot.getString(it)) } }
            val rateId = snapshotId(rate); check(snapshot.getString("id") == rateId)
            check(rate.getString("rounding") == "HALF_EVEN")
            val converted = CurrencyMoney.convert(originalMinor, originalCurrency, quote, rate.getString("rate"))
            check(converted == snapshot.getLong("converted_minor"))
            val row = CachedCurrencyReference(account, transaction, revision, quote, rateId, originalCurrency, originalMinor, converted)
            database.runInTransaction {
                dao.putRate(CachedCurrencyRate(rateId, canonicalRate(rate)))
                check(dao.rate(rateId)?.snapshotJson == canonicalRate(rate))
                dao.putReference(row)
                check(dao.reference(account, transaction, revision, quote) == row)
            }
            return row
    }
    companion object {
        private fun validateMetadata(snapshot: JSONObject) {
            CurrencyMoney.exponent(snapshot.getString("base")); CurrencyMoney.exponent(snapshot.getString("quote"))
            check(snapshot.getString("rounding") == "HALF_EVEN" && snapshot.getString("source").isNotBlank())
            val requested = LocalDate.parse(snapshot.getString("requested_date"))
            val observed = Instant.parse(snapshot.getString("rate_timestamp")).atZone(ZoneOffset.UTC).toLocalDate()
            check(ChronoUnit.DAYS.between(observed, requested) in 0L..7L)
            check(Instant.parse(snapshot.getString("expires_at")).isAfter(Instant.parse(snapshot.getString("fetched_at"))))
        }
        val RATE_KEYS = listOf("base", "quote", "requested_date", "rate_timestamp", "rate", "source", "fetched_at", "expires_at", "rounding")
        fun canonicalRate(json: JSONObject): String = RATE_KEYS.joinToString(prefix = "{", postfix = "}", separator = ",") { JSONObject.quote(it) + ":" + JSONObject.quote(json.getString(it)) }
        fun snapshotId(json: JSONObject): String = "fx:" + MessageDigest.getInstance("SHA-256").digest(canonicalRate(json).toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
object CurrencyRuntimePreferences {
    private const val FILE = "wyj-currency-context"
    fun defaultCurrency(context: Context, account: String): String? = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        .getString("$account:default", null)?.takeIf { it in CurrencyMoney.digits }
    fun sourceExponent(context: Context, account: String, source: String, currency: String): Int? {
        if (currency != "JPY") return CurrencyMoney.digits[currency]
        val row = CurrencyReferenceDatabase.get(context).currencies().sourceUnit(account, source)
        return row?.amountExponent?.takeIf { row.currency == currency && it == 0 }
    }
    fun save(context: Context, account: String, currency: String?) {
        require(currency == null || currency in CurrencyMoney.digits)
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().apply {
            if (currency == null) remove("$account:default") else putString("$account:default", currency)
        }.apply()
    }
}
