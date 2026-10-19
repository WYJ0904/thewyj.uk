package uk.thewyj.app.task21.payment

import android.app.Application
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*

private const val CLOSE_OWNER="synthetic-p03-bridge-owner"
private const val CLOSE_AUTH="SYNTH-CLOSE-BRIDGE-AUTH"
private fun Bridge.balance()=PaymentRecognitionCoordinator(store).lifecycleBalance(CLOSE_OWNER,"bank_card:cmb",CLOSE_AUTH)

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P03CloseoutBridgeSeedTest {
    @Test fun persistPartialCapturesRefundsReleasesAndCorrectionReview() {
        val output=File(System.getProperty("finance.p03.output")).apply{mkdirs()}
        assertFalse(File(output,"bridge.db").exists())
        val offline=object:NotificationIngestTransport {override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,503,"{}")}
        Bridge(offline,0).use { b ->
            b.capture("预授权 USD 200.00 交易号 $CLOSE_AUTH",true)
            repeat(30){b.capture("部分结算成功 已扣款 USD 80.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-CAP-A",true)}
            b.capture("部分结算成功 已扣款 USD 90.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-CAP-B",true)
            repeat(30){b.capture("部分退款成功 USD 20.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-REF-A",true)}
            b.capture("部分退款成功 USD 30.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-REF-B",true)
            b.capture("预授权部分解除 USD 10.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-REL-A",true)
            b.capture("预授权部分解除 USD 20.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-REL-B",true)
            assertEquals(0L,b.balance().remainingFrozenMinor)
            b.capture("部分结算成功 已扣款 USD 85.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-CAP-A 状态版本 2",true)
            assertEquals(4,b.store.localBookings(CLOSE_OWNER).size)
            assertEquals(8,b.queue.peekRequests().size)
            assertEquals(8,b.pipeline.flushDetailed().pending)
            assertEquals(12000L,b.balance().netExpenseMinor)
            assertNull(b.balance().remainingFrozenMinor)
            File(output,"seed.json").writeText(b.snapshot().put("status","PASS").put("profile","closeout").toString(2))
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P03CloseoutBridgeRestoreTest {
    @Test fun freshJvmPreservesLifecycleMoneyAfterCommittedButLostAcknowledgement() {
        val output=File(System.getProperty("finance.p03.output"))
        val seed=JSONObject(File(output,"seed.json").readText())
        assertNotEquals(seed.getLong("pid"),ProcessHandle.current().pid())
        val port=JSONObject(File(output,"port.json").readText()).getInt("port")
        Bridge(HttpNotificationIngestTransport("http://127.0.0.1:$port"),100).use { b ->
            assertEquals(4,b.store.localBookings(CLOSE_OWNER).size)
            assertEquals(8,b.queue.peekRequests().size)
            val first=b.pipeline.flushDetailed();assertTrue(first.retryableFailures>0);assertEquals(8,first.pending)
            assertEquals(0,b.pipeline.flushDetailed().pending)
            assertTrue(b.store.localBookings(CLOSE_OWNER).all{it.syncState=="synced"})
            val ids=b.store.localBookings(CLOSE_OWNER).associate{it.eventId to it.transactionId}
            repeat(30){b.capture("部分结算成功 已扣款 USD 80.00 授权号 $CLOSE_AUTH 交易号 SYNTH-CLOSE-CAP-A",true)}
            assertEquals(0,b.pipeline.flushDetailed().pending)
            assertEquals(ids,b.store.localBookings(CLOSE_OWNER).associate{it.eventId to it.transactionId})
            ids.forEach{(event,_)->b.hook.onFinanceOutcome(CLOSE_OWNER,event,"synthetic-obsolete-receipt")}
            assertEquals(ids,b.store.localBookings(CLOSE_OWNER).associate{it.eventId to it.transactionId})
            assertEquals(20000L,b.balance().authorizedMinor)
            assertEquals(17000L,b.balance().clearedMinor)
            assertEquals(3000L,b.balance().releasedMinor)
            assertEquals(5000L,b.balance().refundedMinor)
            assertEquals(12000L,b.balance().netExpenseMinor)
            File(output,"restore.json").writeText(b.snapshot().put("status","PASS").put("old_pid",seed.getLong("pid")).put("profile","closeout").toString(2))
        }
    }
}
