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

private const val AOWNER="synthetic-p03-bridge-owner"
private fun aCommand(old:String,evidence:String)=JSONObject().put("operation_id","synthetic-p03a-bridge-correction").put("type","payment.reconcile").put("payload",JSONObject()
    .put("kind","REPLACE").put("evidence_event_id",evidence).put("target_event_ids",JSONArray().put(old)).put("detach_event_ids",JSONArray())
    .put("predecessor_operation_id","").put("predecessor_revision",1).put("expected_transaction_revision",1).put("proof_id","synthetic-p03a-bridge-proof"))

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P03ABridgeSeedTest {
    @Test fun persistCorrectionAndExactOriginalOutboxBeforeSecondJvm() {
        val offline=object:NotificationIngestTransport{override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,503,"{}")}
        Bridge(offline,0).use {b->
            assertFalse(File(b.output,"seed.json").exists())
            b.capture("部分结算成功 已扣款 USD 80.00 授权号 SYNTH-BRIDGE-AUTH 交易号 SYNTH-BRIDGE-CAP 状态版本 1",true,"synthetic-a-old")
            b.capture("部分结算成功 已扣款 USD 90.00 授权号 SYNTH-BRIDGE-AUTH 交易号 SYNTH-BRIDGE-CAP 状态版本 2",true,"synthetic-a-new")
            val old=b.store.localBookings(AOWNER).single();assertEquals(8000L,old.amountMinor)
            val evidence=b.store.recognitionsByState(AOWNER,listOf("FINANCE_PENDING_CONFIRMATION"),100).single {it.lifecycleRevision==2L}
            val cmd=aCommand(old.eventId,evidence.uploadEventId)
            val reconciliation=PaymentReconciliation(b.db,PaymentAuthorityVerifier{_,_,_->true})
            assertTrue(reconciliation.stage(AOWNER,"synthetic-bridge-device",cmd.toString()));reconciliation.recover(AOWNER,b.queue)
            assertEquals(3,b.queue.pendingCount());val snapshot=b.snapshot().put("command",cmd).put("command_digest",PaymentReconciliation.digest(cmd))
            File(b.output,"seed.json").writeText(snapshot.toString(2));assertEquals(8000L,b.store.localBookings(AOWNER).single().amountMinor)
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P03ABridgeRestoreTest {
    @Test fun committed503RestartsD1ThenReplaysAndKeepsOneCanonicalId() {
        val output=File(System.getProperty("finance.p03.output"));val seed=JSONObject(File(output,"seed.json").readText())
        assertNotEquals(seed.getLong("pid"),ProcessHandle.current().pid())
        val port=JSONObject(File(output,"port.json").readText()).getInt("port")
        val transport=HttpNotificationIngestTransport("http://127.0.0.1:$port")
        Bridge(transport,20).use {b->
            assertEquals(3,b.queue.pendingCount());val cmd=seed.getJSONObject("command");val op=cmd.getString("operation_id")
            val originalBody=b.queue.peekRequests().single {it.operationId==op}.body
            val first=b.pipeline.flushDetailed();assertEquals(2,first.uploaded);assertEquals(1,first.pending);assertTrue(first.retryableFailures>0)
            assertEquals(8000L,b.store.localBookings(AOWNER).single().amountMinor)
            assertEquals(originalBody,b.queue.peekRequests().single().body)
            val restarted=transport.post("/_p03a_restart","synthetic","{}")
            assertTrue(restarted.ok);assertTrue(JSONObject(restarted.body).getBoolean("restarted"))
            val second=b.pipeline.flushDetailed();assertEquals(1,second.uploaded);assertEquals(0,second.pending)
            val booking=b.store.localBookings(AOWNER).single();assertEquals(9000L,booking.amountMinor);assertEquals("USD",booking.currency)
            assertEquals(seed.getJSONArray("bookings").getJSONObject(0).getString("transaction_id"),booking.transactionId)
            repeat(30){b.queue.enqueue(op,originalBody);val r=b.pipeline.flushDetailed();assertEquals(1,r.uploaded);assertEquals(0,r.pending)}
            assertEquals(1,b.store.localBookings(AOWNER).size);assertEquals(9000L,b.store.localBookings(AOWNER).single().amountMinor)
            val journal=b.db.reconciliationDao().journal(AOWNER,op)!!;assertEquals("applied",journal.state)
            File(output,"restore.json").writeText(b.snapshot().put("journal",JSONObject(journal.resultJson)).put("original_body_digest",PaymentReconciliation.digest(JSONObject(originalBody))).toString(2))
        }
    }
}
