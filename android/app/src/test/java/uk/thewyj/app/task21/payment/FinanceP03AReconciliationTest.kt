package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.OfflineNotificationQueue
import uk.thewyj.app.task21.store.*
import java.io.File
import java.util.UUID

/** File-backed Room, actual coordinator, real disk outbox; synthetic authority. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP03AReconciliationTest {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private lateinit var c: PaymentRecognitionCoordinator
    private lateinit var name: String
    private val context get() = RuntimeEnvironment.getApplication()
    private val account = "synthetic-p03a-account"
    private val device = "synthetic-p03a-device"
    private val family = "SYNTH-AUTH-P03A"
    private fun open() {
        db = Room.databaseBuilder(context, NotificationDatabase::class.java, name).allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db); c = PaymentRecognitionCoordinator(store, now = { 1000L })
    }
    @Before fun setup() { name = "pa-" + UUID.randomUUID().toString().take(8) + ".db"; open() }
    @After fun close() { db.close() }
    private fun source(id: String, amount: Int, reference: String = "SYNTH-CAPTURE-P03A", revision: Int = 1, family: String = this.family, extra: String = "", reviewReason: String = ""): PaymentRecognitionRecord {
        val outcome = c.onSourceEvent(account, "95555", PaymentSourceType.SMS, "synth-source-$id", "招商银行",
            "部分结算成功 已扣款 USD $amount.00 授权号 $family 交易号 $reference 状态版本 $revision $extra", uploadEventId = "synthetic-event-$id", sourceUid = 10001, identityReviewReason = reviewReason)
        return db.paymentDao().recognition(account, outcome.recognitionId)!!.toModel()
    }
    private fun reconciler(verified: Boolean = true) = PaymentReconciliation(db, PaymentAuthorityVerifier { _, _, _ -> verified }, now = { 2000L })
    private fun command(old: PaymentRecognitionRecord, evidence: PaymentRecognitionRecord, kind: String = "REPLACE", previous: Long = 1, txRevision: Long = 1): JSONObject = JSONObject()
        .put("operation_id", "synthetic-correction-" + evidence.uploadEventId).put("type", "payment.reconcile").put("payload", JSONObject()
            .put("kind", kind).put("evidence_event_id", evidence.uploadEventId).put("target_event_ids", JSONArray().put(old.uploadEventId))
            .put("detach_event_ids", JSONArray()).put("predecessor_operation_id", "").put("predecessor_revision", previous)
            .put("expected_transaction_revision", txRevision).put("proof_id", "synthetic-authority-proof"))
    private fun receipt(cmd: JSONObject, old: PaymentRecognitionRecord, evidence: PaymentRecognitionRecord): JSONObject {
        val p = cmd.getJSONObject("payload")
        val oldBooking = store.localBooking(account, old.uploadEventId)
        val reversing=p.getString("kind")=="REVOKE"
        val canonical = if (oldBooking == null || reversing) evidence else old
        val id = if(reversing) PaymentAutoBook.transactionId(account,evidence.uploadEventId) else oldBooking?.transactionId ?: PaymentAutoBook.transactionId(account, evidence.uploadEventId)
        val effective = JSONObject().put("amount_minor", evidence.amountMinor).put("currency", evidence.currency).put("direction", evidence.direction.lowercase())
            .put("financial_phase", evidence.financialPhase).put("lifecycle_operation", evidence.lifecycleOperation).put("lifecycle_revision", evidence.lifecycleRevision)
            .put("lifecycle_reference", evidence.lifecycleReference).put("provider_reference", evidence.providerReference).put("reference_namespace", evidence.referenceNamespace)
        return JSONObject().put("operation_results", JSONArray().put(JSONObject().put("account_id",account).put("operation_id", cmd.getString("operation_id"))
            .put("payload_digest", PaymentReconciliation.digest(cmd)).put("reconciliation_status", "applied").put("transaction_id", id)
            .put("original_transaction_id",if(reversing)oldBooking!!.transactionId else "")
            .put("canonical_event_id", canonical.uploadEventId).put("evidence_event_id", evidence.uploadEventId).put("target_event_ids", p.getJSONArray("target_event_ids"))
            .put("detach_event_ids", p.getJSONArray("detach_event_ids")).put("effective", effective)
            .put("transaction", JSONObject().put("id", id).put("status", "active").put("revision", if(reversing)1L else p.getLong("expected_transaction_revision") + 1)
                .put("direction", evidence.direction.lowercase()).put("amount_minor", evidence.amountMinor).put("currency", evidence.currency).put("merchant", "synthetic").put("occurred_at_ms", 1000L))))
    }
    private fun stagePair(): Triple<PaymentRecognitionRecord, PaymentRecognitionRecord, JSONObject> {
        val old = source("old", 80); val e = source("new", 90, revision = 2); val cmd = command(old, e)
        assertTrue(reconciler().stage(account, device, cmd.toString()))
        return Triple(old, e, cmd)
    }
    @Test fun authoritativeCorrectionKeepsBookingIdAndRawEvidence() {
        val (old, e, cmd) = stagePair(); val id = store.localBooking(account, old.uploadEventId)!!.transactionId
        assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), receipt(cmd, old, e)))
        assertEquals(9000L, store.localBookings(account).single().amountMinor); assertEquals(id, store.localBookings(account).single().transactionId)
        assertEquals(8000L, db.paymentDao().recognition(account, old.recognitionId)!!.amountMinor)
        assertEquals(9000L, store.recognition(account, old.recognitionId)!!.amountMinor)
        assertEquals(9000L, c.lifecycleBalance(account, "bank_card:cmb", family).clearedMinor)
    }
    @Test fun defaultAuthorityCannotPromoteOrQueue() {
        val old = source("old", 80); val e = source("new", 90, revision = 2); val cmd = command(old, e)
        assertFalse(PaymentReconciliation(db).stage(account, device, cmd.toString()))
        val queue = OfflineNotificationQueue(File(context.filesDir, name + ".queue")); PaymentReconciliation(db).recover(account, queue)
        assertEquals(0, queue.pendingCount()); assertEquals(8000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun stagingNeverChangesMoneyBeforeCloudReceipt() { stagePair(); assertEquals(8000L, store.localBookings(account).single().amountMinor) }
    @Test fun wrongPayloadDigestCannotAcknowledgeOrChangeMoney() {
        val (old, e, cmd) = stagePair(); val r = receipt(cmd, old, e); r.getJSONArray("operation_results").getJSONObject(0).put("payload_digest", "0".repeat(64))
        assertFalse(reconciler().applyReceipt(account, cmd.getString("operation_id"), r)); assertEquals(8000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun wrongCanonicalTransactionCannotRenameSyncedId() {
        val (old, e, cmd) = stagePair(); val r = receipt(cmd, old, e); val result = r.getJSONArray("operation_results").getJSONObject(0)
        result.put("transaction_id", "synthetic-wrong-transaction"); result.getJSONObject("transaction").put("id", "synthetic-wrong-transaction")
        assertFalse(reconciler().applyReceipt(account, cmd.getString("operation_id"), r)); assertEquals(8000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun thirtyDuplicateReceiptsRemainOneCorrection() {
        val (old, e, cmd) = stagePair(); repeat(30) { assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), receipt(cmd, old, e))) }
        assertEquals(1, store.localBookings(account).size); assertEquals(9000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun anotherAccountCannotApplyOrReadTheJournal() {
        val (old, e, cmd) = stagePair(); assertFalse(reconciler().applyReceipt("synthetic-other-account", cmd.getString("operation_id"), receipt(cmd, old, e)))
        assertNull(db.reconciliationDao().journal("synthetic-other-account", cmd.getString("operation_id")))
    }
    @Test fun fileRestartRecoversTheExactOutboxBody() {
        val (_, _, cmd) = stagePair(); val before = db.reconciliationDao().journal(account, cmd.getString("operation_id"))!!
        db.close(); open(); val queue = OfflineNotificationQueue(File(context.filesDir, name + ".queue")); reconciler().recover(account, queue)
        assertEquals(before.payloadJson, queue.peekRequests().single().body); assertEquals(before.operationId, queue.peekRequests().single().operationId)
    }
    @Test fun databaseCommitBeforeQueueRemovalCanReplayAfterRestart() {
        val (old, e, cmd) = stagePair(); val r = receipt(cmd, old, e); val queue = OfflineNotificationQueue(File(context.filesDir, name + ".queue")); reconciler().recover(account, queue)
        assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), r)); db.close(); open()
        assertEquals(1, queue.pendingCount()); assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), r)); queue.remove(cmd.getString("operation_id"))
        assertEquals(0, queue.pendingCount()); assertEquals(9000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun localEditAfterStageRetainsConflictAndOutbox() {
        val (old, e, cmd) = stagePair(); val candidate = store.candidateForRecognition(account, old.recognitionId)!!
        store.saveCandidate(candidate.copy(editedAmountMinor = 7900L))
        assertFalse(reconciler().applyReceipt(account, cmd.getString("operation_id"), receipt(cmd, old, e)))
        assertEquals("conflict", db.reconciliationDao().journal(account, cmd.getString("operation_id"))!!.state)
        assertEquals(7900L, store.candidateForRecognition(account, old.recognitionId)!!.effectiveAmountMinor)
        assertEquals(8000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun explicitUserConfirmationIsProtectedEvenWithoutEdits() {
        val old = source("old", 80); store.recordUserDecision(account, old.recognitionId, "candidate_confirm")
        val e = source("new", 90, revision = 2); val cmd = command(old, e)
        assertFalse(reconciler().stage(account, device, cmd.toString())); assertEquals(8000L, store.localBookings(account).single().amountMinor)
    }
    @Test fun independentEqualMoneyOperationsRemainSeparate() {
        source("one", 80, "SYNTH-CAPTURE-ONE"); source("two", 80, "SYNTH-CAPTURE-TWO")
        assertEquals(2, store.localBookings(account).size); assertEquals(16000L, store.localBookings(account).sumOf { it.amountMinor })
    }
    @Test fun twoIndependentCapturesStillTotal170() {
        source("one", 80, "SYNTH-CAPTURE-ONE"); source("two", 90, "SYNTH-CAPTURE-TWO")
        assertEquals(17000L, store.localBookings(account).sumOf { it.amountMinor })
    }
    @Test fun reassignmentMovesProjectionWithoutDuplicatingMoney() {
        val old = source("old", 80); val e = source("move", 80, "SYNTH-CAPTURE-NEW", 2, "SYNTH-AUTH-NEW")
        val cmd = command(old, e, "REASSIGN"); assertTrue(reconciler().stage(account, device, cmd.toString()))
        assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), receipt(cmd, old, e)))
        assertEquals(1, store.localBookings(account).size); assertEquals(0L, c.lifecycleBalance(account, "bank_card:cmb", family).clearedMinor)
        assertEquals(8000L, c.lifecycleBalance(account, "bank_card:cmb", "SYNTH-AUTH-NEW").clearedMinor)
    }
    @Test fun oldOperationIdCannotAcquireAnotherPayload() {
        val (_, _, cmd) = stagePair(); cmd.getJSONObject("payload").put("kind", "REASSIGN")
        try { reconciler().stage(account, device, cmd.toString()); fail("must reject changed immutable command") } catch(e: IllegalArgumentException) { assertEquals("operation_id_conflict", e.message) }
    }
    @Test fun foreignCurrencyNeverBecomesCnyDuringCorrection() {
        val (old, e, cmd) = stagePair(); assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), receipt(cmd, old, e)))
        assertEquals("USD", store.localBookings(account).single().currency)
    }
    @Test fun staleCorrectionReceiptCannotUndoLaterAcceptedState() {
        val (old, e, cmd) = stagePair(); val r = receipt(cmd, old, e); assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), r))
        val booking = db.paymentDao().localBooking(account, old.uploadEventId)!!; db.reconciliationDao().updateBooking(booking.copy(amountMinor = 9500L))
        assertTrue(reconciler().applyReceipt(account, cmd.getString("operation_id"), r)); assertEquals(9500L, store.localBookings(account).single().amountMinor)
    }
    private fun weak(id: String, review: String): PaymentRecognitionRecord {
        val outcome=c.onSourceEvent(account,"95555",PaymentSourceType.SMS,"synth-source-$id","招商银行","支付成功 已扣款 USD 80.00",
            uploadEventId="synthetic-event-$id",sourceUid=10001,identityReviewReason=review)
        return db.paymentDao().recognition(account,outcome.recognitionId)!!.toModel()
    }
    @Test fun weakCandidatePromotesOnlyFromExplicitCompletedMapping() {
        val old=weak("weak","identity_unproven_notification");assertTrue(store.localBookings(account).isEmpty())
        val evidence=source("authority",80,revision=1,reviewReason="reconciliation_evidence")
        val cmd=command(old,evidence,"MAP",0,0);assertTrue(reconciler().stage(account,device,cmd.toString()))
        assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),receipt(cmd,old,evidence)))
        assertEquals(1,store.localBookings(account).size);assertEquals(8000L,store.localBookings(account).single().amountMinor)
        assertEquals(store.recognition(account,evidence.recognitionId)!!.recognitionId,store.recognitionByUploadEvent(account,old.uploadEventId)!!.recognitionId)
    }
    @Test fun historicalWeakBookingMapsWithoutRenamingItsFormalId() {
        val old=weak("legacy","");val id=store.localBookings(account).single().transactionId
        val evidence=source("authority",80,revision=1,reviewReason="reconciliation_evidence");val cmd=command(old,evidence,"MAP",0,1)
        assertTrue(reconciler().stage(account,device,cmd.toString()));assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),receipt(cmd,old,evidence)))
        assertEquals(id,store.localBookings(account).single().transactionId);assertEquals("SYNTH-CAPTURE-P03A",store.recognition(account,old.recognitionId)!!.providerReference)
    }
    @Test fun anotherDeviceProfileCannotBorrowAnAuthoritativeCorrection() {
        val old=source("old",80);val evidence=source("new",90,revision=2)
        db.paymentDao().upsertRecognition(evidence.copy(sourceUid=20001).toEntity());val cmd=command(old,evidence)
        assertFalse(reconciler().stage(account,device,cmd.toString()));assertEquals(8000L,store.localBookings(account).single().amountMinor)
    }
    @Test fun aSameIdTransportAckDoesNotInvalidateStagedMoneyEvidence() {
        val (old,e,cmd)=stagePair();store.acknowledgeLocalBooking(account,old.uploadEventId,store.localBookings(account).single().transactionId)
        store.saveRecognition(old.copy(updatedAtMs=9000L))
        assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),receipt(cmd,old,e)));assertEquals(9000L,store.localBookings(account).single().amountMinor)
    }
    @Test fun oneWrongAliasDetachesThenRecoversWithoutMovingTheOriginalLedger() {
        val old=source("old",80);val alias="synthetic-wrong-alias";store.saveEventAlias(account,alias,old.recognitionId)
        val evidence=source("correction",90,revision=2);val cmd=command(old,evidence);cmd.getJSONObject("payload").put("detach_event_ids",JSONArray().put(alias))
        assertTrue(reconciler().stage(account,device,cmd.toString()));assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),receipt(cmd,old,evidence)))
        val review=store.recognitionByUploadEvent(account,alias)!!;assertEquals("reconciliation_detached",review.identityReviewReason);assertNotEquals(old.recognitionId,review.recognitionId)
        assertEquals(old.recognitionId,db.paymentDao().recognitionByAlias(account,alias)!!.recognitionId)
        assertFalse(alias in store.eventAliases(account,old.recognitionId));assertEquals(9000L,store.localBookings(account).single().amountMinor)
        val proof=source("independent-proof",80,"SYNTH-INDEPENDENT-CAP",1,reviewReason="reconciliation_evidence");val map=command(review,proof,"MAP",0,0)
        assertTrue(reconciler().stage(account,device,map.toString()));assertTrue(reconciler().applyReceipt(account,map.getString("operation_id"),receipt(map,review,proof)))
        assertEquals(2,store.localBookings(account).size);assertEquals(17000L,store.localBookings(account).sumOf{it.amountMinor})
    }
    @Test fun explicitRevocationUsesRefundAndRetainsThePositiveOriginal() {
        val old=source("old",80)
        val result=c.onSourceEvent(account,"95555",PaymentSourceType.SMS,"synthetic-source-reversal","招商银行","部分退款成功 USD 80.00 授权号 $family 交易号 SYNTH-REVERSAL-CAP 状态版本 2",uploadEventId="synthetic-event-reversal",sourceUid=10001)
        val e=db.paymentDao().recognition(account,result.recognitionId)!!.toModel();val cmd=command(old,e,"REVOKE")
        assertTrue(reconciler().stage(account,device,cmd.toString()));assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),receipt(cmd,old,e)))
        assertEquals(2,store.localBookings(account).size);assertEquals(8000L,store.localBookings(account).single{it.direction=="EXPENSE"}.amountMinor)
        assertEquals(8000L,store.localBookings(account).single{it.direction=="REFUND"}.amountMinor);assertEquals(0L,c.lifecycleBalance(account,"bank_card:cmb",family).netExpenseMinor)
    }
    @Test fun aReceiptForAnotherAuthenticatedAccountIsNeverApplied() {
        val (old,e,cmd)=stagePair();val reply=receipt(cmd,old,e);reply.getJSONArray("operation_results").getJSONObject(0).put("account_id","synthetic-other-account")
        assertFalse(reconciler().applyReceipt(account,cmd.getString("operation_id"),reply));assertEquals(8000L,store.localBookings(account).single().amountMinor)
    }
    @Test fun everyHistoricalAliasReadsTheNewestAcceptedRevision() {
        val (old,second,cmd2)=stagePair();val ack2=receipt(cmd2,old,second)
        assertTrue(reconciler().applyReceipt(account,cmd2.getString("operation_id"),ack2))
        val third=source("third",95,revision=3);val cmd3=command(old,third,previous=2,txRevision=2)
        cmd3.getJSONObject("payload").put("predecessor_operation_id",cmd2.getString("operation_id"))
            .put("target_event_ids",JSONArray().put(old.uploadEventId).put(second.uploadEventId))
        assertTrue(reconciler().stage(account,device,cmd3.toString()))
        assertTrue(reconciler().applyReceipt(account,cmd3.getString("operation_id"),receipt(cmd3,old,third)))
        assertEquals(9500L,store.recognition(account,second.recognitionId)!!.amountMinor)
        assertEquals(3L,store.recognition(account,second.recognitionId)!!.lifecycleRevision)
        assertEquals(9000L,db.paymentDao().recognition(account,second.recognitionId)!!.amountMinor)
        assertTrue(reconciler().applyReceipt(account,cmd2.getString("operation_id"),ack2))
        assertEquals(9500L,store.localBookings(account).single().amountMinor)
    }
    @Test fun weakCandidateAttachesToAnAlreadyBookedCaptureAndAcknowledgesThatBooking() {
        val weak=weak("weak-existing","identity_unproven_notification")
        val authority=source("already-posted",80,revision=1)
        val original=store.localBookings(account).single();assertEquals(authority.recognitionId,original.recognitionId)
        val cmd=command(weak,authority,"MAP",0,1)
        assertTrue(reconciler().stage(account,device,cmd.toString()))
        assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),receipt(cmd,weak,authority)))
        val booking=store.localBookings(account).single();assertEquals(original.transactionId,booking.transactionId)
        assertEquals("synced",booking.syncState);assertEquals(8000L,booking.amountMinor)
        assertEquals(authority.recognitionId,store.recognitionByUploadEvent(account,weak.uploadEventId)!!.recognitionId)
    }
}
