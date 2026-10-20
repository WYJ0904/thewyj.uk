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
import uk.thewyj.app.task21.store.*
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP03FinalControlTest {
    private lateinit var db:NotificationDatabase
    private lateinit var store:RoomPaymentRecognitionStore
    private lateinit var c:PaymentRecognitionCoordinator
    private val account="synthetic-control-account"
    private val family="SYNTH-CONTROL-AUTH"
    private lateinit var a:PaymentRecognitionRecord
    private fun source(id:String,text:String):PaymentRecognitionRecord{
        val result=c.onSourceEvent(account,"95555",PaymentSourceType.SMS,"synthetic-control-$id","招商银行",text,
            uploadEventId="synthetic-control-event-$id",sourceUid=10001)
        return db.paymentDao().recognition(account,result.recognitionId)!!.toModel()
    }
    @Before fun setup(){db=Room.databaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java,"ctrl-${UUID.randomUUID()}.db").allowMainThreadQueries().build()
        store=RoomPaymentRecognitionStore(db);c=PaymentRecognitionCoordinator(store,now={1000L})
        a=source("auth","预授权成功 USD 200.00 授权号 $family 交易号 $family 状态版本 1")
        source("capture","部分结算成功 已扣款 USD 80.00 授权号 $family 交易号 SYNTH-CONTROL-CAP 状态版本 1")
        assertEquals(1,store.localBookings(account).size)
    }
    @After fun close(){db.close()}
    private fun reconciler()=PaymentReconciliation(db,PaymentAuthorityVerifier{_,_,_->true},now={2000L})
    private fun command(old:PaymentRecognitionRecord,e:PaymentRecognitionRecord)=JSONObject().put("operation_id","synthetic-control-correction").put("type","payment.reconcile")
        .put("payload",JSONObject().put("kind","CONTROL_REPLACE").put("evidence_event_id",e.uploadEventId).put("target_event_ids",JSONArray().put(old.uploadEventId))
            .put("detach_event_ids",JSONArray()).put("predecessor_operation_id","").put("predecessor_revision",1).put("expected_transaction_revision",0).put("proof_id","synthetic-control-proof"))
    private fun response(cmd:JSONObject,old:PaymentRecognitionRecord,e:PaymentRecognitionRecord):JSONObject {
        val p=cmd.getJSONObject("payload");val ef=JSONObject().put("amount_minor",e.amountMinor).put("currency",e.currency).put("direction",e.direction.lowercase())
            .put("financial_phase",e.financialPhase).put("lifecycle_operation",e.lifecycleOperation).put("lifecycle_revision",e.lifecycleRevision)
            .put("lifecycle_reference",e.lifecycleReference).put("provider_reference",e.providerReference).put("reference_namespace",e.referenceNamespace)
        return JSONObject().put("operation_results",JSONArray().put(JSONObject().put("account_id",account).put("operation_id",cmd.getString("operation_id"))
            .put("payload_digest",PaymentReconciliation.digest(cmd)).put("reconciliation_status","applied").put("kind","CONTROL_REPLACE").put("transaction_id","").put("transaction",JSONObject.NULL)
            .put("canonical_event_id",old.uploadEventId).put("evidence_event_id",e.uploadEventId).put("target_event_ids",p.getJSONArray("target_event_ids")).put("detach_event_ids",JSONArray()).put("effective",ef)))
    }
    @Test fun revisedAuthorizationOnlyChangesHold(){val e=source("newauth","预授权成功 USD 250.00 授权号 $family 交易号 $family 状态版本 2");val cmd=command(a,e)
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),response(cmd,a,e)))
        val balance=c.lifecycleBalance(account,"bank_card:cmb",family);assertEquals(25000L,balance.authorizedMinor);assertEquals(17000L,balance.remainingFrozenMinor);assertEquals(8000L,balance.netExpenseMinor)
        assertNotEquals("FINANCE_RECORDED",store.recognition(account,a.recognitionId)!!.state)
        assertFalse(store.recognition(account,a.recognitionId)!!.completionConfirmed)
        assertEquals(1,store.localBookings(account).size);assertEquals(20000L,db.paymentDao().recognition(account,a.recognitionId)!!.amountMinor)
    }
    @Test fun partialReleaseCanReviseSystemClosedControl(){val old=source("release","部分解除成功 USD 30.00 授权号 $family 交易号 SYNTH-CONTROL-REL 状态版本 1")
        val e=source("newrelease","部分解除成功 USD 50.00 授权号 $family 交易号 SYNTH-CONTROL-REL 状态版本 2");val cmd=command(old,e)
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),response(cmd,old,e)))
        val balance=c.lifecycleBalance(account,"bank_card:cmb",family);assertEquals(5000L,balance.releasedMinor);assertEquals(7000L,balance.remainingFrozenMinor);assertEquals(1,store.localBookings(account).size)
    }
    @Test fun explicitRejectOfSystemClosedControlStillWins(){val old=source("release","部分解除成功 USD 30.00 授权号 $family 交易号 SYNTH-CONTROL-REL 状态版本 1")
        val candidate=store.candidateForRecognition(account,old.recognitionId)!!;assertTrue(c.rejectCandidate(account,candidate.candidateId))
        val e=source("newrelease","部分解除成功 USD 50.00 授权号 $family 交易号 SYNTH-CONTROL-REL 状态版本 2")
        assertFalse(reconciler().stage(account,"synthetic-device",command(old,e).toString()));assertEquals(1,store.localBookings(account).size)
    }
    @Test fun receiptCannotCreateTransactionForAuthorization(){val e=source("newauth","预授权成功 USD 250.00 授权号 $family 交易号 $family 状态版本 2");val cmd=command(a,e)
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));val r=response(cmd,a,e);r.getJSONArray("operation_results").getJSONObject(0).put("transaction_id","synthetic-forged-transaction")
        assertFalse(reconciler().applyReceipt(account,cmd.getString("operation_id"),r));assertEquals(1,store.localBookings(account).size)
    }
    @Test fun thirtyControlReceiptsPreserveLedger(){val e=source("newauth","预授权成功 USD 250.00 授权号 $family 交易号 $family 状态版本 2");val cmd=command(a,e)
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()));val r=response(cmd,a,e);repeat(30){assertTrue(reconciler().applyReceipt(account,cmd.getString("operation_id"),r))}
        assertEquals(1,store.localBookings(account).size);assertEquals(25000L,c.lifecycleBalance(account,"bank_card:cmb",family).authorizedMinor)
    }
    @Test fun matchingButOverReleaseReceiptCannotMakeNegativeHold(){val old=source("release","部分解除成功 USD 30.00 授权号 $family 交易号 SYNTH-CONTROL-REL 状态版本 1")
        val e=source("newrelease","部分解除成功 USD 130.00 授权号 $family 交易号 SYNTH-CONTROL-REL 状态版本 2");val cmd=command(old,e)
        assertTrue(reconciler().stage(account,"synthetic-device",cmd.toString()))
        assertFalse(reconciler().applyReceipt(account,cmd.getString("operation_id"),response(cmd,old,e)))
        assertEquals(3000L,c.lifecycleBalance(account,"bank_card:cmb",family).releasedMinor)
    }
}
