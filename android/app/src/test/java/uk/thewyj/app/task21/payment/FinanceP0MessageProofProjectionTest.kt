package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.store.*

/** Accepted-overlay store fixtures, never claims of real provider authority. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP0MessageProofProjectionTest {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private lateinit var hook: AndroidPaymentRecognitionHook
    private val owner = "synthetic-message-projection"
    private val input = NotificationCaptureInput("com.tencent.mm", notificationKey = "synthetic-message-projection-slot",
        notificationId = 7, title = "微信支付", text = "支付成功 CNY 648.00", receivedAtMs = 1000,
        messageIdentity = NotificationFingerprint.sha256Hex("synthetic-projection-message"), sourceUid = 10030)
    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java).allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db)
        val archive = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
            override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
        }
        hook = AndroidPaymentRecognitionHook(RuntimeEnvironment.getApplication(), archive, store, testing = true,
            notifierOverride = object : PaymentStatusNotifier {
                override fun notify(message: PaymentStatusNotificationMessage) = true
                override fun cancel(notificationId: Int) = Unit
            })
    }
    @After fun close() = db.close()
    private fun capture(id: String, ref: String): PaymentRecognitionRecord {
        val source = input.copy(paymentEventId = id, text = input.text + " 交易号 " + ref)
        hook.onCapture(owner, source, "微信", id)
        return store.recognitionByUploadEvent(owner, id)!!
    }
    private fun overlay(record: PaymentRecognitionRecord, canonical: PaymentRecognitionRecord, excluded: Int = 0, amount: Long = 64800L) {
        db.reconciliationDao().saveEffective(PaymentEffectiveRecognitionEntity(owner, record.recognitionId, canonical.recognitionId,
            amount, canonical.financialPhase, canonical.lifecycleOperation, 2, canonical.lifecycleReference,
            canonical.providerReference, canonical.referenceNamespace, "synthetic-accepted-operation", excluded))
    }
    @Test fun acceptedCanonicalMappingIsReadByMessageProofWithoutRenamingRawFacts() {
        val a = capture("synthetic-proof-a", "SYNTH-PROOF-REF-A")
        val b = capture("synthetic-proof-b", "SYNTH-PROOF-REF-B")
        val originalIds = store.localBookings(owner).map { it.transactionId }.toSet()
        assertEquals(2, originalIds.size)
        overlay(a, a); overlay(b, a)
        val canonicalBooking = store.localBooking(owner, a.uploadEventId)!!
        val superseded = store.localBooking(owner, b.uploadEventId)!!
        db.reconciliationDao().supersede(PaymentBookingSupersessionEntity(owner, superseded.transactionId, canonicalBooking.transactionId,
            "synthetic-accepted-operation", "{\"synthetic\":true}", 2000))
        val proof = paymentMessageProof(input)
        assertEquals(listOf(a.recognitionId), store.recognitionsByMessageProof(owner, proof).map { it.recognitionId })
        val replay = input.copy(paymentEventId = "synthetic-proof-replay")
        hook.onCapture(owner, replay, "微信", replay.paymentEventId)
        assertEquals(canonicalBooking.transactionId, hook.localFinanceTransactionId(owner, replay.paymentEventId))
        assertEquals(1, store.localBookings(owner).size)
        assertEquals(0, store.pendingCandidateCount(owner))
        assertEquals("SYNTH-PROOF-REF-A", db.paymentDao().recognition(owner, a.recognitionId)!!.providerReference)
        assertEquals("SYNTH-PROOF-REF-B", db.paymentDao().recognition(owner, b.recognitionId)!!.providerReference)
        assertTrue(store.recognitionsByMessageProof("synthetic-other-owner", proof).isEmpty())
    }
    @Test fun acceptedCorrectionFactsAreProjectedByMessageProofNotOldAmount() {
        val a = capture("synthetic-correct-proof", "SYNTH-CORRECT-PROOF")
        overlay(a, a, amount = 65000)
        val proof = store.recognitionsByMessageProof(owner, paymentMessageProof(input)).single()
        assertEquals(65000L, proof.amountMinor)
        assertEquals(2L, proof.lifecycleRevision)
        assertEquals(64800L, db.paymentDao().recognition(owner, a.recognitionId)!!.amountMinor)
    }
    @Test fun excludedMessageMappingRetainsIndependentReviewState() {
        val a = capture("synthetic-excluded-proof", "SYNTH-EXCLUDED-PROOF")
        overlay(a, a, excluded = 1)
        val proof = store.recognitionsByMessageProof(owner, paymentMessageProof(input)).single()
        assertEquals("reconciliation_detached", proof.identityReviewReason)
        assertEquals("FINANCE_PENDING_CONFIRMATION", proof.state)
        assertEquals("FINANCE_RECORDED", db.paymentDao().recognition(owner, a.recognitionId)!!.state)
    }
    @Test fun detachedProofReplayCannotAutomaticallyReuseAnEarlierBooking() {
        val original = capture("synthetic-detach-source", "SYNTH-DETACH-SOURCE")
        val booking = store.localBookings(owner).single()
        overlay(original, original, excluded = 1)
        val replay = input.copy(paymentEventId = "synthetic-detached-replay")
        val payment = hook.prepareIdentity(owner, replay, hook.outcomeFor(replay)!!)
        hook.onCapture(owner, replay, "微信", replay.paymentEventId)
        assertEquals("", hook.localFinanceTransactionId(owner, replay.paymentEventId))
        assertEquals(listOf(booking), store.localBookings(owner))
        assertNotEquals(original.recognitionId, store.recognitionByUploadEvent(owner, replay.paymentEventId)!!.recognitionId)
        assertEquals("message_identity_ambiguous", payment.identityReviewReason)
        assertFalse(payment.confirmed)
        assertEquals("message_identity_ambiguous", store.recognitionByUploadEvent(owner, replay.paymentEventId)!!.identityReviewReason)
        assertEquals(1, store.pendingCandidateCount(owner))
    }
    @Test fun missingCanonicalProofReplayRequiresIndependentReview() {
        val original = capture("synthetic-missing-target-source", "SYNTH-MISSING-TARGET")
        val booking = store.localBookings(owner).single()
        // Simulate a damaged accepted projection. This identifier is a test-only
        // absent row, never a provider reference or a replacement transaction.
        db.reconciliationDao().saveEffective(PaymentEffectiveRecognitionEntity(owner, original.recognitionId,
            "synthetic-absent-canonical-row", 64800, original.financialPhase, original.lifecycleOperation, 2,
            original.lifecycleReference, original.providerReference, original.referenceNamespace,
            "synthetic-accepted-operation", 0))
        val proof = store.recognitionsByMessageProof(owner, paymentMessageProof(input)).single()
        assertEquals("reconciliation_canonical_missing", proof.identityReviewReason)
        val replay = input.copy(paymentEventId = "synthetic-missing-target-replay")
        val payment = hook.prepareIdentity(owner, replay, hook.outcomeFor(replay)!!)
        assertEquals("message_identity_ambiguous", payment.identityReviewReason)
        assertFalse(payment.confirmed)
        hook.onCapture(owner, replay, "微信", replay.paymentEventId)
        assertEquals("", hook.localFinanceTransactionId(owner, replay.paymentEventId))
        assertEquals(listOf(booking), store.localBookings(owner))
        assertNotEquals(original.recognitionId, store.recognitionByUploadEvent(owner, replay.paymentEventId)!!.recognitionId)
        assertEquals("message_identity_ambiguous", store.recognitionByUploadEvent(owner, replay.paymentEventId)!!.identityReviewReason)
        assertEquals(1, store.pendingCandidateCount(owner))
    }
}
