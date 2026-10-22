package uk.thewyj.app.finance

import android.app.Application
import androidx.room.Room
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.IngestResponse
import uk.thewyj.app.task21.NotificationIngestTransport
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class CurrencyReferenceRoomTest {
    private inline fun <T> CurrencyReferenceDatabase.use(block: (CurrencyReferenceDatabase) -> T): T = try { block(this) } finally { close() }
    private fun open(name: String) = Room.databaseBuilder(RuntimeEnvironment.getApplication(), CurrencyReferenceDatabase::class.java, name).allowMainThreadQueries().build()
    private fun snapshot(): JSONObject = JSONObject().put("base", "USD").put("quote", "CNY").put("requested_date", "2026-10-19")
        .put("rate_timestamp", "2026-10-19T00:00:00.000Z").put("rate", "7").put("source", "Frankfurter v2 daily reference")
        .put("fetched_at", "2026-10-21T12:00:00.000Z").put("expires_at", "2026-10-21T18:00:00.000Z").put("rounding", "HALF_EVEN")
    @Test fun nativeBookingsStampVerifiedUnitsWithoutChangingOriginalEvidence() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),uk.thewyj.app.task21.store.NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store=uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(db)
            val coordinator=uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator(store,currencyPolicyVersion=2)
            for(currency in CurrencyMoney.digits.keys){
                coordinator.onSourceEvent("synthetic-owner","com.tencent.mm",uk.thewyj.app.task21.payment.PaymentSourceType.NOTIFICATION,"synthetic-native-$currency","微信支付","已扣款 $currency 100")
                val row=store.localBookings("synthetic-owner").single{it.currency==currency}
                assertEquals(if(currency=="JPY")100L else 10000L,row.amountMinor)
                assertEquals(CurrencyMoney.exponent(currency),row.amountExponent)
                assertEquals(currency,store.recognition("synthetic-owner",row.recognitionId)!!.currency)
            }
        }finally{db.close()}
    }
    @Test fun manualCurrencyChoiceIsSeparateFromUnknownMachineEvidence() {
        val ledger=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),uk.thewyj.app.task21.store.NotificationDatabase::class.java).allowMainThreadQueries().build()
        open("synthetic-choice-${UUID.randomUUID()}.db").use { cache ->
            try {
                val store=uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(ledger)
                val coordinator=uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator(store,currencyPolicyVersion=2,
                    effectiveCurrency={record -> cache.currencies().currencyDecision(record.accountId,record.recognitionId)?.currency ?: record.currency})
                val result=coordinator.onSourceEvent("synthetic-owner","com.tencent.mm",uk.thewyj.app.task21.payment.PaymentSourceType.NOTIFICATION,"synthetic-unknown-source","微信支付","已扣款 $100.00")
                val candidate=coordinator.ensureCandidateForRecognition("synthetic-owner",result.recognitionId,10000,"EXPENSE","synthetic")!!
                assertNull(coordinator.confirmCandidate("synthetic-owner",candidate.candidateId))
                cache.currencies().putCurrencyDecision(ManualCurrencyDecision("synthetic-owner",result.recognitionId,"USD",1000))
                store.recordUserDecision("synthetic-owner",result.recognitionId,"currency_confirm:USD")
                assertNotNull(coordinator.confirmCandidate("synthetic-owner",candidate.candidateId))
                assertEquals("XXX",store.recognition("synthetic-owner",result.recognitionId)!!.currency)
                assertNull(cache.currencies().currencyDecision("other-owner",result.recognitionId))
            }finally{ledger.close()}
        }
    }
    @Test fun boundedHistoryWarmUsesRealRepositoryAndExportsVerifiedOfflineProjection() {
        open("synthetic-warm-${UUID.randomUUID()}.db").use { db ->
            db.currencies().putPreferences(CachedCurrencyPreferences("synthetic-owner","CNY","CNY",null,1))
            val rate=snapshot();val rateId=CurrencyReferenceRepository.snapshotId(rate);var calls=0
            val transport=object:NotificationIngestTransport{
                override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,405,"{}")
                override fun get(path:String,sessionToken:String):IngestResponse{
                    calls++
                    if(path.startsWith("/api/finance/transactions"))return IngestResponse(true,200,"{\"transactions\":[{\"id\":\"synthetic-transaction\",\"revision\":1,\"currency\":\"USD\",\"amount_minor\":10000}]}")
                    val reference=JSONObject(rate.toString()).put("id",rateId).put("original_minor",10000).put("converted_minor",70000).put("transaction_revision",1).put("reference_only",true).put("historical_reference",true)
                    return IngestResponse(true,200,JSONObject().put("references",JSONObject().put("synthetic-transaction:1:CNY",reference)).toString())
                }
            }
            val repository=CurrencyReferenceRepository(db)
            assertTrue(repository.warmHistory("synthetic-owner","synthetic-session",transport));assertEquals(2,calls)
            assertEquals(70000,repository.projection("synthetic-owner").getJSONObject("synthetic-transaction:1:CNY").getInt("converted_minor"))
            assertEquals(0,repository.projection("other-owner").length())
        }
    }
    @Test fun historicalReferencesSurviveCloseReopenAndOfflineWithoutChangingMoney() {
        val name = "synthetic-p04-${UUID.randomUUID()}.db"
        val rate = snapshot(); val id = CurrencyReferenceRepository.snapshotId(rate)
        var calls = 0
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String) = IngestResponse(false, 405, "{}")
            override fun get(path: String, sessionToken: String): IngestResponse {
                calls++; assertTrue(path.startsWith("/api/finance/references?"))
                val reference = JSONObject(rate.toString()).put("id", id).put("original_minor", 10000).put("converted_minor", 70000)
                    .put("transaction_revision", 1).put("reference_only", true).put("historical_reference", true)
                return IngestResponse(true, 200, JSONObject().put("references", JSONObject().put("synthetic-transaction:1:CNY", reference)).toString())
            }
        }
        open(name).use { db ->
            val result = CurrencyReferenceRepository(db).refresh("synthetic-owner", "synthetic-transaction", 1, 10000, "USD", "CNY", "synthetic-session", transport)
            assertNotNull(result); assertEquals(70000L, result!!.convertedMinor); assertEquals(10000L, result.originalMinor)
        }
        open(name).use { db ->
            val result = CurrencyReferenceRepository(db).cached("synthetic-owner", "synthetic-transaction", 1, "CNY")
            assertNotNull(result); assertEquals(70000L, result!!.convertedMinor)
            assertNull(CurrencyReferenceRepository(db).cached("other-owner", "synthetic-transaction", 1, "CNY"))
            assertNull(CurrencyReferenceRepository(db).cached("synthetic-owner", "synthetic-transaction", 2, "CNY"))
            assertEquals(1, calls)
        }
        RuntimeEnvironment.getApplication().deleteDatabase(name)
    }
    @Test fun malformedProviderDataCannotReplaceAnExistingReference() {
        open("synthetic-p04-${UUID.randomUUID()}.db").use { db ->
            val rate = snapshot(); val id = CurrencyReferenceRepository.snapshotId(rate)
            db.currencies().putRate(CachedCurrencyRate(id, CurrencyReferenceRepository.canonicalRate(rate)))
            db.currencies().putReference(CachedCurrencyReference("synthetic-owner", "synthetic-transaction", 1, "CNY", id, "USD", 10000, 70000))
            db.openHelper.writableDatabase.execSQL("UPDATE fx_rates SET snapshotJson=? WHERE id=?", arrayOf(rate.put("rate", "1").toString(), id))
            assertNull(CurrencyReferenceRepository(db).cached("synthetic-owner", "synthetic-transaction", 1, "CNY"))
        }
    }
    @Test fun preferenceAndRoleCachesKeepAccountAndSourceIdentity() {
        val context = RuntimeEnvironment.getApplication()
        val cacheAccount = "synthetic-six-currency-cache-${UUID.randomUUID()}"
        val pending = CurrencyMoney.digits.keys.map { code -> uk.thewyj.app.core.network.PendingReviewIdentity(
            "hint", "synthetic-hint-$code", "synthetic-event-$code", "synthetic-device", amountMinor = 12345, currency = code,
            amountExponent = if(code == "JPY") 0 else null) } + uk.thewyj.app.core.network.PendingReviewIdentity(
            "hint", "synthetic-legacy-jpy", "synthetic-legacy-jpy-event", "synthetic-device", amountMinor=12345, currency="JPY", amountExponent=null)
        assertTrue(uk.thewyj.app.task21.payment.CanonicalPendingCache(context, cacheAccount).save(
            uk.thewyj.app.core.network.PendingReviewSummary(java.time.Instant.now().toString(),7,7,0,false,pending)))
        assertEquals(pending,uk.thewyj.app.task21.payment.CanonicalPendingCache(context,cacheAccount).read()!!.records)
        open("synthetic-p04-${UUID.randomUUID()}.db").use { db ->
            db.currencies().putPreferences(CachedCurrencyPreferences("synthetic-owner", "HKD", "JPY", "USD", 2))
            assertEquals("USD", db.currencies().preferences("synthetic-owner")!!.defaultCurrency)
            assertNull(db.currencies().preferences("other-owner"))
            val roles = CurrencyDecision.Roles("USD", 10000, "CNY", 70000, "CNY", 1000)
            val row = CachedCurrencyRoles("synthetic-owner", "synthetic-source-event", roles.json(), 1792411200000)
            db.currencies().putRoles(row); db.currencies().putRoles(row)
            assertEquals(row, db.currencies().roles("synthetic-owner", "synthetic-source-event"))
            assertNull(db.currencies().roles("other-owner", "synthetic-source-event"))
        }
    }
}
