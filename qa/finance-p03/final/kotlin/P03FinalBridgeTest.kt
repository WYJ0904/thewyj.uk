package uk.thewyj.app.task21.payment

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import java.io.File

private const val OWNER="synthetic-p03-bridge-owner"
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P03FinalBridgeSeedTest {
    @Test fun persistTwoFormalIdsAndResolutionForSecondJvm(){
        val offline=object:NotificationIngestTransport{override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,503,"{}")}
        Bridge(offline,0).use{b->
            assertFalse(File(b.output,"seed.json").exists())
            b.capture("部分结算成功 已扣款 USD 80.00 授权号 SYNTH-BRIDGE-AUTH 交易号 SYNTH-BRIDGE-CAP 状态版本 1",true,"synthetic-final-first")
            b.capture("部分结算成功 已扣款 USD 80.00 授权号 SYNTH-BRIDGE-AUTH 交易号 SYNTH-BRIDGE-OLD-CAP 状态版本 1",true,"synthetic-final-second")
            b.capture("部分结算成功 已扣款 USD 90.00 授权号 SYNTH-BRIDGE-AUTH 交易号 SYNTH-BRIDGE-CAP 状态版本 2",true,"synthetic-final-evidence")
            val bookings=b.store.localBookings(OWNER);assertEquals(2,bookings.size)
            val keep=bookings.single{it.providerReference=="SYNTH-BRIDGE-CAP"}
            val e=b.store.recognitionsByState(OWNER,listOf("FINANCE_PENDING_CONFIRMATION"),100).single{it.lifecycleRevision==2L}
            val cmd=JSONObject().put("operation_id","synthetic-unified-resolution").put("type","payment.reconcile").put("payload",JSONObject()
                .put("kind","CONSOLIDATE").put("evidence_event_id",e.uploadEventId).put("target_event_ids",JSONArray(bookings.map{it.eventId})).put("detach_event_ids",JSONArray())
                .put("predecessor_operation_id","").put("predecessor_revision",1).put("expected_transaction_revision",1).put("proof_id","synthetic-unified-proof")
                .put("canonical_transaction_id",keep.transactionId).put("expected_transaction_revisions",JSONObject(bookings.associate{it.transactionId to 1})))
            val reconcile=PaymentReconciliation(b.db,PaymentAuthorityVerifier{_,_,_->true});assertTrue(reconcile.stage(OWNER,"synthetic-bridge-device",cmd.toString()));reconcile.recover(OWNER,b.queue)
            assertEquals(4,b.queue.pendingCount());File(b.output,"seed.json").writeText(b.snapshot().put("command",cmd).put("command_digest",PaymentReconciliation.digest(cmd)).toString(2))
        }
    }
}
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P03FinalBridgeRestoreTest {
    @Test fun committedLostAckAndD1RestartRetainBothIdsAndOneEffectiveExpense(){
        val output=File(System.getProperty("finance.p03.output"));val seed=JSONObject(File(output,"seed.json").readText());assertNotEquals(seed.getLong("pid"),ProcessHandle.current().pid())
        val port=JSONObject(File(output,"port.json").readText()).getInt("port");val transport=HttpNotificationIngestTransport("http://127.0.0.1:$port")
        Bridge(transport,20).use{b->
            assertEquals(4,b.queue.pendingCount());val cmd=seed.getJSONObject("command");val op=cmd.getString("operation_id");val body=b.queue.peekRequests().single{it.operationId==op}.body
            val first=b.pipeline.flushDetailed();assertEquals(3,first.uploaded);assertEquals(1,first.pending);assertTrue(first.retryableFailures>0)
            assertEquals(2,b.store.localBookings(OWNER).size);assertEquals(body,b.queue.peekRequests().single().body)
            assertTrue(transport.post("/_p03a_restart","synthetic","{}").ok)
            val second=b.pipeline.flushDetailed();assertEquals(1,second.uploaded);assertEquals(0,second.pending)
            val booking=b.store.localBookings(OWNER).single();assertEquals(9000L,booking.amountMinor);assertEquals(cmd.getJSONObject("payload").getString("canonical_transaction_id"),booking.transactionId)
            assertEquals(2,b.db.paymentDao().localBookings(OWNER).size)
            repeat(30){b.queue.enqueue(op,body);val r=b.pipeline.flushDetailed();assertEquals(1,r.uploaded);assertEquals(0,r.pending)}
            assertEquals(1,b.store.localBookings(OWNER).size);assertEquals(9000L,b.store.localBookings(OWNER).single().amountMinor)
            val journal=b.db.reconciliationDao().journal(OWNER,op)!!;assertEquals("applied",journal.state)
            File(output,"restore.json").writeText(b.snapshot().put("journal",JSONObject(journal.resultJson)).put("retained_original_count",b.db.paymentDao().localBookings(OWNER).size).toString(2))
        }
    }
}
