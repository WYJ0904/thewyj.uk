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

/** Real file-backed Room and disk outbox. Authority is explicitly synthetic. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP03FinalResolutionTest {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private lateinit var coordinator: PaymentRecognitionCoordinator
    private lateinit var name: String
    private val context get() = RuntimeEnvironment.getApplication()
    private val account = "synthetic-final-account"
    private lateinit var a: PaymentRecognitionRecord
    private lateinit var b: PaymentRecognitionRecord
    private lateinit var e: PaymentRecognitionRecord
    private lateinit var cmd: JSONObject
    private fun open() {
        db = Room.databaseBuilder(context, NotificationDatabase::class.java, name).allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db); coordinator = PaymentRecognitionCoordinator(store, now = { 1000L })
    }
    private fun source(id: String, amount: Int, ref: String, revision: Int): PaymentRecognitionRecord {
        val outcome = coordinator.onSourceEvent(account, "95555", PaymentSourceType.SMS, "synthetic-source-$id", "招商银行",
            "部分结算成功 已扣款 USD $amount.00 授权号 SYNTH-FINAL-AUTH 交易号 $ref 状态版本 $revision",
            uploadEventId = "synthetic-final-$id", sourceUid = 10001)
        return db.paymentDao().recognition(account, outcome.recognitionId)!!.toModel()
    }
    @Before fun setup() {
        name = "p03final-${UUID.randomUUID()}.db"; open()
        a = source("first",80,"SYNTH-FINAL-CAP",1)
        b = source("second",80,"SYNTH-FINAL-OLD-REF",1)
        assertEquals(2, store.localBookings(account).size)
        e = source("evidence",90,"SYNTH-FINAL-CAP",2)
        val ids = store.localBookings(account).associate { it.transactionId to 1 }
        cmd = JSONObject().put("operation_id","synthetic-final-resolution").put("type","payment.reconcile").put("payload",JSONObject()
            .put("kind","CONSOLIDATE").put("evidence_event_id",e.uploadEventId)
            .put("target_event_ids",JSONArray().put(a.uploadEventId).put(b.uploadEventId)).put("detach_event_ids",JSONArray())
            .put("predecessor_operation_id","").put("predecessor_revision",1).put("expected_transaction_revision",1)
            .put("proof_id","synthetic-final-proof").put("canonical_transaction_id",store.localBooking(account,a.uploadEventId)!!.transactionId)
            .put("expected_transaction_revisions",JSONObject(ids)))
    }
    @After fun close() { db.close() }
    private fun reconciler() = PaymentReconciliation(db, PaymentAuthorityVerifier { _,_,_ -> true }, now={2000L})
    private fun response(): JSONObject {
        val p=cmd.getJSONObject("payload"); val id=p.getString("canonical_transaction_id")
        val old=store.localBookings(account).single { it.recognitionId==b.recognitionId }
        val effective=JSONObject().put("amount_minor",9000).put("currency","USD").put("direction","expense")
            .put("financial_phase","SETTLED").put("lifecycle_operation","CAPTURE").put("lifecycle_revision",2)
            .put("lifecycle_reference",e.lifecycleReference).put("provider_reference",e.providerReference).put("reference_namespace",e.referenceNamespace)
        return JSONObject().put("operation_results",JSONArray().put(JSONObject().put("account_id",account)
            .put("operation_id",cmd.getString("operation_id")).put("payload_digest",PaymentReconciliation.digest(cmd))
            .put("reconciliation_status","applied").put("kind","CONSOLIDATE").put("transaction_id",id)
            .put("canonical_event_id",a.uploadEventId).put("evidence_event_id",e.uploadEventId)
            .put("target_event_ids",p.getJSONArray("target_event_ids")).put("detach_event_ids",JSONArray()).put("effective",effective)
            .put("transaction",JSONObject().put("id",id).put("status","active").put("revision",2).put("amount_minor",9000)
                .put("currency","USD").put("direction","expense").put("merchant","synthetic").put("occurred_at_ms",1000L))
            .put("superseded_transactions",JSONArray().put(JSONObject().put("id",old.transactionId).put("status","deleted").put("revision",2)
                .put("amount_minor",8000).put("currency","USD").put("direction","expense").put("system_superseded_by",id)
                .put("system_superseded_operation",cmd.getString("operation_id"))))))
    }
    @Test fun provenMultipleIdsCountOnceAndRetainOriginalRows() {
        val original=db.paymentDao().localBookings(account).map{it.transactionId to it.amountMinor}.toMap()
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString())); val r=response()
        assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),r))
        assertEquals(9000L,store.localBookings(account).single().amountMinor)
        assertEquals(2,db.paymentDao().localBookings(account).size)
        val old=db.paymentDao().localBookings(account).single{it.recognitionId==b.recognitionId}
        assertEquals(original[old.transactionId],old.amountMinor)
        assertEquals(9000L,coordinator.lifecycleBalance(account,"bank_card:cmb",e.lifecycleReference).clearedMinor)
        assertEquals(store.localBooking(account,a.uploadEventId)!!.transactionId,store.localBooking(account,b.uploadEventId)!!.transactionId)
    }
    @Test fun defaultVerifierNeverStagesMultipleIds() {
        assertFalse(PaymentReconciliation(db).stage(account,"synthetic-device",cmd.toString()))
        assertEquals(2,store.localBookings(account).size)
    }
    @Test fun attestedSmsAndBankAppMayHaveDifferentPackageUids() {
        // Different Android packages necessarily have different UIDs. They are
        // still the same known issuer; the authority must bind both sources.
        db.paymentDao().upsertRecognition(e.copy(sourcePackage="cmb.pb",sourceUid=20002).toEntity())
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()))
    }
    @Test fun missingRetiredReceiptCannotRemoveMoney() {
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));val r=response()
        r.getJSONArray("operation_results").getJSONObject(0).put("superseded_transactions",JSONArray())
        assertFalse(reconciler().applyReceipt(account,cmd.getString("operation_id"),r));assertEquals(2,store.localBookings(account).size)
    }
    @Test fun wrongRetiredAmountCannotAcknowledge() {
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));val r=response()
        r.getJSONArray("operation_results").getJSONObject(0).getJSONArray("superseded_transactions").getJSONObject(0).put("amount_minor",7000)
        assertFalse(reconciler().applyReceipt(account,cmd.getString("operation_id"),r));assertEquals(2,store.localBookings(account).size)
    }
    @Test fun manualDecisionAfterStagePreservesBothBookingsAndQueue() {
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));val r=response()
        val queue=OfflineNotificationQueue(File(context.filesDir,name+".queue"));reconciler().recover(account,queue)
        db.reconciliationDao().decide(PaymentUserDecisionEntity(account,b.recognitionId,"owner-edit",2001))
        assertFalse(reconciler().applyReceipt(account,cmd.getString("operation_id"),r))
        assertEquals(2,store.localBookings(account).size);assertEquals(1,queue.pendingCount())
    }
    @Test fun fileRestartAndThirtyReceiptsDoNotRebookRetiredId() {
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));val r=response()
        assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),r));db.close();open()
        repeat(30){assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),r))}
        assertEquals(1,store.localBookings(account).size);assertEquals(2,db.paymentDao().localBookings(account).size)
        assertEquals(9000L,store.localBookings(account).single().amountMinor)
        assertNull(coordinator.autoBook(account,b.recognitionId)?.takeIf{it.transactionId!=store.localBookings(account).single().transactionId})
    }
}
