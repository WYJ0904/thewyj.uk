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
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class CurrencyDefaultReviewTest {
    @Test fun canonicalReviewDecisionSurvivesCacheAndOnlyOwnedCurrentReceiptClearsIt() {
        val context=RuntimeEnvironment.getApplication()
        val owner="synthetic-canonical-${java.util.UUID.randomUUID()}"
        val db=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db)
            val result=PaymentRecognitionCoordinator(store,defaultCurrency={"USD"},currencyPolicyVersion=2,now={1000L})
                .onSourceEvent(owner,"com.tencent.mm",PaymentSourceType.NOTIFICATION,"synthetic-canonical-source","微信支付","已扣款 $100.00 交易单号 SYNTHCANONICAL001")
            val recognition=store.recognition(owner,result.recognitionId)!!
            val booking=store.localBookings(owner).single()
            val row=uk.thewyj.app.core.network.PendingReviewIdentity("booking","synthetic-booking",booking.eventId,"synthetic-device","confirmed",booking.transactionId,
                currency="USD",currencyReviewRequired=true,currencyDecisionSource="account_default")
            fun summary(value:uk.thewyj.app.core.network.PendingReviewIdentity)=uk.thewyj.app.core.network.PendingReviewSummary("2026-10-22T00:00:00Z",0,0,0,false,listOf(value))
            val cache=CanonicalPendingCache(context,owner);assertTrue(cache.save(summary(row)))
            assertEquals(row,CanonicalPendingCache(context,owner).read()!!.records.single())
            val sync=PaymentHintSync(context,hintedStore=store,accountOverride={NotificationCaptureCoordinator.CaptureAccount(owner,"synthetic-device","synthetic-session",true)})
            val resolved=row.copy(currencyReviewRequired=false,currencyDecisionSource="user_confirmed")
            assertFalse(sync.applySummary("synthetic-other-owner",summary(resolved)).ok)
            assertTrue(store.recognition(owner,recognition.recognitionId)!!.currencyReviewRequired)
            val oldEpoch=cache.beginObservation();cache.beginObservation()
            assertFalse(sync.applySummary(owner,summary(resolved),oldEpoch).ok)
            assertTrue(store.recognition(owner,recognition.recognitionId)!!.currencyReviewRequired)
            assertTrue(sync.applySummary(owner,summary(resolved)).ok)
            val after=store.recognition(owner,recognition.recognitionId)!!
            assertFalse(after.currencyReviewRequired);assertEquals("USD",after.currency);assertEquals(10000L,after.amountMinor)
            assertEquals(booking.transactionId,store.localBookings(owner).single().transactionId)
        } finally {db.close()}
    }
    @Test fun anAccountPreferenceIsRecordedWithoutPretendingItWasInTheSource() {
        val parsed = PaymentParserRegistry.parse("com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "微信支付", "已扣款 $100.00", capturedAtMs = 1000, defaultCurrency = "USD", currencyPolicyVersion = 2)
        assertEquals(10000L, parsed.amountMinor)
        assertEquals("USD", parsed.currency)
        assertEquals("", parsed.currencyEvidence)
        assertTrue(parsed.currencyReviewRequired)
        assertEquals("account_default", parsed.currencyDecisionSource)
        val explicit = PaymentParserRegistry.parse("com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "微信支付", "已扣款 USD 100.00", capturedAtMs = 1000, defaultCurrency = "HKD", currencyPolicyVersion = 2)
        assertFalse(explicit.currencyReviewRequired)
        assertEquals("USD", explicit.currencyEvidence)
    }

    @Test fun provenPaymentBooksWithReviewAndOnlyOneReminderAcrossReopenAndPreferenceChange() {
        val context = RuntimeEnvironment.getApplication()
        val name = "synthetic-currency-default-review.db"
        var db = Room.databaseBuilder(context, NotificationDatabase::class.java, name).allowMainThreadQueries().build()
        var preference = "USD"
        val messages = mutableListOf<PaymentStatusNotificationMessage>()
        val notifier = object : PaymentStatusNotifier {
            override fun notify(message: PaymentStatusNotificationMessage): Boolean { messages += message; return true }
            override fun cancel(notificationId: Int) = Unit
        }
        val owner = "synthetic-default-owner"
        fun capture(store: RoomPaymentRecognitionStore) = PaymentRecognitionCoordinator(store, notifier = notifier,
            defaultCurrency = { preference }, currencyPolicyVersion = 2, now = { 1000L }).onSourceEvent(
            owner, "com.tencent.mm", PaymentSourceType.NOTIFICATION, "synthetic-default-source",
            "微信支付", "已扣款 $100.00 交易号 SYNTHDEFAULTREF001", uploadEventId = "synthetic-default-upload")
        try {
            val store = RoomPaymentRecognitionStore(db)
            val first = capture(store)
            assertEquals(store.recognition(owner, first.recognitionId).toString(), 1, store.localBookings(owner).size)
            val original = store.localBookings(owner).single()
            assertEquals("USD", original.currency); assertEquals(10000L, original.amountMinor)
            assertTrue(store.recognition(owner, first.recognitionId)!!.currencyReviewRequired)
            assertTrue(store.recognition(owner, first.recognitionId)!!.currencyReviewNotified)
            assertEquals(1, messages.count { it.title == "Aeris · 币种待核实" })
            db.close()
            preference = "HKD"
            db = Room.databaseBuilder(context, NotificationDatabase::class.java, name).allowMainThreadQueries().build()
            val reopened = RoomPaymentRecognitionStore(db)
            capture(reopened)
            assertEquals(original.transactionId, reopened.localBookings(owner).single().transactionId)
            assertEquals("USD", reopened.localBookings(owner).single().currency)
            assertEquals("USD", reopened.recognition(owner, first.recognitionId)!!.currency)
            assertTrue(reopened.recognition(owner, first.recognitionId)!!.currencyReviewRequired)
            assertEquals(1, messages.count { it.title == "Aeris · 币种待核实" })
            val alias = PaymentRecognitionCoordinator(reopened, notifier = notifier,
                defaultCurrency = { preference }, currencyPolicyVersion = 2, now = { 2000L }).onSourceEvent(
                owner, "com.tencent.mm", PaymentSourceType.NOTIFICATION, "synthetic-default-alias",
                "微信支付", "已扣款 $100.00 交易号 SYNTHDEFAULTREF001", uploadEventId = "synthetic-default-alias-upload")
            assertEquals(first.recognitionId, alias.recognitionId)
            assertEquals(1, reopened.localBookings(owner).size)
            assertEquals(1, messages.count { it.title == "Aeris · 币种待核实" })
        } finally { db.close() }
    }

    @Test fun structuredWireCarriesOnlyTheExplicitDefaultDecisionAndKeepsLegacyBodies() {
        val event = StructuredNotificationEvent("synthetic-default-wire", "d".repeat(64), "com.tencent.mm",
            NotificationEventType.TRANSACTION, "wechat-4", ParseStatus.PARSED, FinanceDirection.EXPENSE,
            10000, "USD", "wechat", "synthetic", "", 950, 1000, 1000,
            currencyReviewRequired = true, currencyDecisionSource = "account_default")
        val wire = JSONObject(StructuredEventJson.eventJson(event))
        assertTrue(wire.getBoolean("currency_review_required"))
        assertEquals("account_default", wire.getString("currency_decision_source"))
        assertFalse(JSONObject(StructuredEventJson.eventJson(event.copy(currencyReviewRequired = false, currencyDecisionSource = ""))).has("currency_review_required"))
        val original = "{\"schema_version\":1,\"operations\":[]}"
        val directory = java.io.File(RuntimeEnvironment.getApplication().cacheDir, "synthetic-default-queue")
        val queue = NotificationOfflineQueue.inDirectory(directory, "synthetic-owner")
        queue.enqueueRequest("synthetic-legacy-body", "/api/notification/ingest", original)
        assertEquals(original, NotificationOfflineQueue.inDirectory(directory, "synthetic-owner").peekRequests().single().body)
    }
}
