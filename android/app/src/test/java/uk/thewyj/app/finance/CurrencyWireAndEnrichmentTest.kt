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
@Config(sdk=[34],application=Application::class)
class CurrencyWireAndEnrichmentTest {
    @Test fun newJpyWireHasExplicitUnitWhileOldSerializedRequestsRemainUnchanged() {
        val original="{\"schema_version\":\"1\",\"operations\":[{\"operation_id\":\"synthetic-old-jpy\",\"type\":\"event.ingest\",\"payload\":{\"currency\":\"JPY\",\"amount_minor\":12345}}]}"
        val event=StructuredNotificationEvent("synthetic-new-jpy","a".repeat(64),"com.tencent.mm",NotificationEventType.TRANSACTION,
            "wechat-4",ParseStatus.PARSED,FinanceDirection.EXPENSE,12345,"JPY","wechat","synthetic","",950,1000,1000,amountExponent=0)
        assertEquals(0,JSONObject(StructuredEventJson.eventJson(event)).getInt("amount_exponent"))
        assertTrue(JSONObject(StructuredEventJson.eventJson(event.copy(amountExponent=null))).isNull("amount_exponent"))
        val file=java.io.File(RuntimeEnvironment.getApplication().cacheDir,"synthetic-p04-legacy-wire")
        val queue=NotificationOfflineQueue.inDirectory(file,"synthetic-owner")
        queue.enqueueRequest("synthetic-old-jpy","/api/notification/ingest",original)
        assertEquals(original,NotificationOfflineQueue.inDirectory(file,"synthetic-owner").peekRequests().single().body)
        assertEquals("synthetic-old-jpy",queue.peekRequests().single().operationId)
    }
    @Test fun explicitPageCurrencyCanEnrichUnknownEvidenceWithoutGrantingAutomaticBooking() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db);val units=mutableMapOf<String,Int>()
            val coordinator=PaymentRecognitionCoordinator(store,tickets=PaymentTicketEngine(now={1000}),now={1000},currencyPolicyVersion=2,
                onVerifiedCurrencyUnit={_,source,_,exponent->units[source]=exponent})
            val source="synthetic-unknown-currency"
            val parsed=coordinator.onSourceEvent("synthetic-owner","com.tencent.mm",PaymentSourceType.NOTIFICATION,source,"微信支付","已扣款 $100.00")
            assertEquals("XXX",store.recognition("synthetic-owner",parsed.recognitionId)!!.currency)
            val ticket=coordinator.restartVerification("synthetic-owner",parsed.recognitionId)!!
            val enrichment=PaymentEnrichment("com.tencent.mm",100,"JPY",FinanceDirection.EXPENSE,null,null,null,1000,950,completionConfirmed=true)
            assertTrue(coordinator.onAccessibilityEnrichment("synthetic-owner",enrichment,ticket.ticketId) is EnrichmentOutcome.Applied)
            assertEquals("JPY",store.recognition("synthetic-owner",parsed.recognitionId)!!.currency)
            assertEquals(0,units[source]);assertTrue(store.localBookings("synthetic-owner").isEmpty())
        }finally{db.close()}
    }
    @Test fun pageAndLegacyOcrCannotReinterpretKnownOrUnknownCurrency() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db)
            var clock=1000L
            val coordinator=PaymentRecognitionCoordinator(store,tickets=PaymentTicketEngine(now={clock}),now={clock},currencyPolicyVersion=2)
            val first=coordinator.onSourceEvent("synthetic-owner","com.tencent.mm",PaymentSourceType.NOTIFICATION,"synthetic-unit-source","微信支付","已扣款 $100.00")
            val firstTicket=coordinator.restartVerification("synthetic-owner",first.recognitionId)!!
            val ocr=PaymentEnrichment("com.tencent.mm",10000,"CNY",FinanceDirection.EXPENSE,null,null,null,1000,950,evidenceSource=PaymentEvidenceSource.OCR,completionConfirmed=true)
            assertEquals("currency_review_required",(coordinator.onAccessibilityEnrichment("synthetic-owner",ocr,firstTicket.ticketId) as EnrichmentOutcome.Rejected).reason)
            assertEquals("XXX",store.recognition("synthetic-owner",first.recognitionId)!!.currency)
            clock+=1000
            val known=coordinator.onSourceEvent("synthetic-owner","com.tencent.mm",PaymentSourceType.NOTIFICATION,"synthetic-known-unit","微信支付","待确认 USD 100.00")
            clock+=1
            val knownTicket=coordinator.restartVerification("synthetic-owner",known.recognitionId)!!
            val changed=coordinator.onAccessibilityEnrichment("synthetic-owner",ocr.copy(evidenceSource=PaymentEvidenceSource.ACCESSIBILITY),knownTicket.ticketId)
            assertEquals("currency_evidence_conflict",(changed as EnrichmentOutcome.Rejected).reason)
            assertEquals("USD",store.recognition("synthetic-owner",known.recognitionId)!!.currency)
        }finally{db.close()}
    }
}
