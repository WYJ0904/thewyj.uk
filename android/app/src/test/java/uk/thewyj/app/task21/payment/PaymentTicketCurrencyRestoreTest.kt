package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PaymentTicketCurrencyRestoreTest {
    @Test fun roomRoundTripPreservesEnrichmentCurrencyAndProof() {
        val db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store = RoomPaymentRecognitionStore(db)
            for (unit in listOf("CNY", "USD", "EUR", "HKD", "GBP", "JPY")) {
                val ticket = PaymentTicketEngine(now = { 1000L }).create("synthetic-owner", "rec-$unit", "com.tencent.mm", "event-$unit", "wechat")
                    .copy(enrichment = PaymentEnrichment("com.tencent.mm", 100L, unit, FinanceDirection.EXPENSE,
                        null, null, "SYNTH-$unit", 1000L, 900, PaymentEvidenceSource.OCR, true, true))
                store.saveTicket(ticket)
                val restored = store.ticket(ticket.accountId, ticket.ticketId)!!
                assertEquals(unit, restored.enrichment?.currency)
                assertEquals(true, restored.enrichment?.completionConfirmed)
                assertEquals(PaymentEvidenceSource.OCR, restored.enrichment?.evidenceSource)
                assertEquals(true, restored.enrichment?.sourceInstanceUncertain)
                assertNull(store.ticket("other-owner", ticket.ticketId))
            }
        } finally { db.close() }
    }

    @Test fun unknownUnitCandidateSurvivesColdRoomReopenWithoutInventedMinorUnits() {
        val context=RuntimeEnvironment.getApplication();val name="synthetic-p05-candidate.db"
        context.deleteDatabase(name)
        fun open()=Room.databaseBuilder(context,NotificationDatabase::class.java,name).allowMainThreadQueries().build()
        var db=open()
        val engine=PaymentTicketEngine(now={1000L})
        val original=engine.create("owner","rec","com.tencent.mm","event","wechat",missingFields=setOf("amount","currency"))
        val candidate=PaymentPageSemantics.unresolvedCandidate(PaymentPageSnapshot("com.tencent.mm",
            listOf("转账详情","已被合成用户领取","¥0.01","转账时间","18:49"),1000L))!!
        val result=engine.enrich(original,candidate)
        assertTrue(result is EnrichmentOutcome.Insufficient)
        val pending=(result as EnrichmentOutcome.Insufficient).ticket
        RoomPaymentRecognitionStore(db).saveTicket(pending);db.close();db=open()
        try {
            val restored=RoomPaymentRecognitionStore(db).ticket("owner",original.ticketId)!!
            assertEquals("0.01",restored.enrichment?.amountDecimalCandidate)
            assertNull(restored.enrichment?.amountMinor);assertNull(restored.enrichment?.currency)
            assertFalse(restored.enrichment!!.completionConfirmed);assertTrue(restored.enrichment!!.sourceInstanceUncertain)
            assertEquals(original.expiresAtMs,restored.expiresAtMs)
            assertTrue(RoomPaymentRecognitionStore(db).localBookings("owner").isEmpty())
        } finally {db.close();context.deleteDatabase(name)}
    }
    @Test fun partialObservationPublishesOnlyChangedCandidateAndKeepsExistingIdentityPending() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db)
            store.saveRecognition(PaymentRecognitionRecord("rec","owner",PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name,1,
                "com.tencent.mm","NOTIFICATION","event",paymentChannel="wechat",amountMinor=null,currency="",direction="",merchant="",providerReference="",createdAtMs=1000L,updatedAtMs=1000L))
            val ticket=PaymentTicketEngine(now={1000L}).create("owner","rec","com.tencent.mm","event","wechat",missingFields=setOf("amount","currency"))
            store.saveTicket(ticket)
            val coordinator=PaymentRecognitionCoordinator(store,tickets=PaymentTicketEngine(now={1000L}),now={1000L},currencyPolicyVersion=2)
            val observation=PaymentPageSemantics.unresolvedCandidate(PaymentPageSnapshot("com.tencent.mm",listOf("交易详情","付款成功","¥0.01"),1000L))!!
            val before=PaymentReviewSignals.changes.value
            assertTrue(coordinator.onAccessibilityEnrichment("owner",observation,ticket.ticketId) is EnrichmentOutcome.Insufficient)
            assertEquals(before+1,PaymentReviewSignals.changes.value)
            coordinator.onAccessibilityEnrichment("owner",observation,ticket.ticketId)
            assertEquals(before+1,PaymentReviewSignals.changes.value)
            assertNull(store.recognition("owner","rec")!!.amountMinor)
            assertTrue(store.localBookings("owner").isEmpty())
        } finally {db.close()}
    }
    @Test fun pendingPageCanBecomeCompletedOnSameTicketWithoutDuplicateOrLateOverwrite() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            var time=1000L;val store=RoomPaymentRecognitionStore(db)
            store.saveRecognition(PaymentRecognitionRecord("rec","owner",PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name,1,
                "com.tencent.mm","NOTIFICATION","event",paymentChannel="wechat",amountMinor=null,currency="CNY",direction="EXPENSE",merchant="",providerReference="SYNTH-STATE",createdAtMs=time,updatedAtMs=time))
            val engine=PaymentTicketEngine(now={time});val ticket=engine.create("owner","rec","com.tencent.mm","event","wechat",missingFields=setOf("amount"));store.saveTicket(ticket)
            val coordinator=PaymentRecognitionCoordinator(store,tickets=engine,now={time},currencyPolicyVersion=2)
            val pending=PaymentEnrichment("com.tencent.mm",100L,"CNY",FinanceDirection.EXPENSE,null,null,"SYNTH-STATE",null,900,completionConfirmed=false)
            coordinator.onAccessibilityEnrichment("owner",pending,ticket.ticketId)
            assertTrue("Unsettled page must not consume its live ticket",engine.isActive(store.ticket("owner",ticket.ticketId)!!))
            assertTrue(store.localBookings("owner").isEmpty())
            assertTrue(coordinator.onAccessibilityEnrichment("owner",pending,ticket.ticketId) is EnrichmentOutcome.Insufficient)
            time=2000L
            coordinator.onAccessibilityEnrichment("owner",pending.copy(completionConfirmed=true),ticket.ticketId)
            assertEquals(1,store.localBookings("owner").size)
            assertEquals(100L,store.localBookings("owner").single().amountMinor)
            val before=store.localBookings("owner").single()
            assertTrue(coordinator.onAccessibilityEnrichment("owner",pending.copy(amountMinor=9999L),ticket.ticketId) is EnrichmentOutcome.Rejected)
            assertEquals(before,store.localBookings("owner").single())
            assertEquals(ticket.expiresAtMs,store.ticket("owner",ticket.ticketId)!!.expiresAtMs)
        } finally {db.close()}
    }
}
