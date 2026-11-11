package uk.thewyj.app.qa.finance
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*
import java.io.File
@RunWith(AndroidJUnit4::class)
class FinanceDeviceLedgerTest {
    private val c get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val owner=FinanceDeviceSupport.OWNER
    @Test fun nativeRoomOutboxAuthenticatedHttpAndActualD1(){
        val account=NotificationSessionProvider(c).currentAccount()!!;assertEquals(owner,account.accountId)
        val store=RoomPaymentRecognitionStore(NotificationDatabase.get(c))
        val coordinator=AndroidPaymentRecognitionHook.get(c).coordinator()
        val before=store.localBookings(owner).size;assertEquals("Run once in fresh owned package",0,before)
        FinanceDeviceSupport.api("/__qa/network",JSONObject().put("blocked",true))
        fun event(id:String,text:String)=coordinator.onSourceEvent(owner,"95555",PaymentSourceType.SMS,"synthetic-device-$id","合成银行夹具",text,uploadEventId="synthetic-device-$id")
        try{
            event("auth","预授权 CNY 200.00 交易号 SYNTH-DEVICE-AUTH")
            event("cap-a","部分结算成功 已扣款 CNY 80.00 授权号 SYNTH-DEVICE-AUTH 交易号 SYNTH-DEVICE-CAP-A")
            event("cap-b","部分结算成功 已扣款 CNY 90.00 授权号 SYNTH-DEVICE-AUTH 交易号 SYNTH-DEVICE-CAP-B")
            event("release","预授权部分解除 CNY 30.00 授权号 SYNTH-DEVICE-AUTH 交易号 SYNTH-DEVICE-RELEASE")
            event("refund","部分退款成功 CNY 20.00 授权号 SYNTH-DEVICE-AUTH 交易号 SYNTH-DEVICE-REFUND")
            val bookings=store.localBookings(owner);assertEquals(3,bookings.size)
            assertEquals(17000L,bookings.filter{it.direction=="EXPENSE"}.sumOf{it.amountMinor})
            assertEquals(2000L,bookings.filter{it.direction=="REFUND"}.sumOf{it.amountMinor})
            val balance=coordinator.lifecycleBalance(owner,"bank_card:cmb","SYNTH-DEVICE-AUTH")
            assertEquals(0L,balance.remainingFrozenMinor);assertEquals(15000L,balance.netExpenseMinor)
            LocalPaymentLedger.recover(c,owner,account.deviceId)
            val queue=NotificationOfflineQueue.inDirectory(c.filesDir,owner)
            assertTrue(queue.pendingCount()>=3)
            val pipeline=NotificationCapturePipeline.create(c,NotificationSessionProvider(c))
            val offline=pipeline.flushDetailed();assertTrue(offline.retryableFailures>0);assertTrue(offline.pending>=3)
            assertEquals(0,FinanceDeviceSupport.api("/__qa/state").getJSONArray("transactions").length())
            FinanceDeviceSupport.api("/__qa/network",JSONObject().put("blocked",false).put("commit_then_503",true))
            val lost=pipeline.flushDetailed();assertTrue(lost.retryableFailures>0);assertTrue(lost.pending>=1)
            assertEquals(1,FinanceDeviceSupport.api("/__qa/state").getInt("committed_lost_acks"))
            assertTrue("Server committed while client retains durable request",FinanceDeviceSupport.api("/__qa/state").getJSONArray("transactions").length()>0)
            val online=pipeline.flushDetailed();assertEquals(0,online.pending)
            val txs=FinanceDeviceSupport.api("/__qa/state").getJSONArray("transactions");assertEquals(3,txs.length())
            assertTrue(store.localBookings(owner).all{it.syncState=="synced"})
            repeat(3){pipeline.flushDetailed();LocalPaymentLedger.recover(c,owner,account.deviceId)}
            assertEquals(3,FinanceDeviceSupport.api("/__qa/state").getJSONArray("transactions").length())
            val ledger=JSONObject(LocalPaymentLedger.snapshot(c));assertEquals(3,ledger.getJSONArray("transactions").length())
            val snapshot=JSONObject().put("pid",android.os.Process.myPid()).put("bookings",org.json.JSONArray(store.localBookings(owner).map{JSONObject().put("id",it.transactionId).put("amount",it.amountMinor).put("direction",it.direction)}))
            File(c.filesDir,"finance-p03-device/ledger-before-restart.json").writeText(snapshot.toString())
            FinanceDeviceSupport.record(c,"DEVICE-LEDGER-HTTP",JSONObject().put("native_room",true).put("actual_http_auth",true).put("actual_d1_rows",3).put("net_expense_minor",15000).put("source","typed synthetic core inputs; NOT real provider notification"))
        }finally{FinanceDeviceSupport.api("/__qa/network",JSONObject().put("blocked",false))}
    }
}
@RunWith(AndroidJUnit4::class)
class FinanceDeviceRestoreTest {
    @Test fun durableRoomOutboxAndCredentialsSurviveOwnedForceStop(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        val snapshot=JSONObject(File(c.filesDir,"finance-p03-device/ledger-before-restart.json").readText())
        assertNotEquals(snapshot.getInt("pid"),android.os.Process.myPid())
        val owner=FinanceDeviceSupport.OWNER
        assertEquals(owner,NotificationSessionProvider(c).currentAccount()!!.accountId)
        val store=RoomPaymentRecognitionStore(NotificationDatabase.get(c));val rows=store.localBookings(owner)
        assertEquals(3,rows.size);assertTrue(rows.all{it.syncState=="synced"})
        val ids=(0 until snapshot.getJSONArray("bookings").length()).map{snapshot.getJSONArray("bookings").getJSONObject(it).getString("id")}.toSet()
        assertEquals(ids,rows.map{it.transactionId}.toSet())
        assertEquals(0,NotificationOfflineQueue.inDirectory(c.filesDir,owner).pendingCount())
        NotificationCapturePipeline.create(c,NotificationSessionProvider(c)).flushDetailed()
        assertEquals(3,FinanceDeviceSupport.api("/__qa/state").getJSONArray("transactions").length())
        FinanceDeviceSupport.record(c,"DEVICE-OWN-PROCESS-RESTORE",JSONObject().put("same_ids",true).put("old_pid",snapshot.getInt("pid")).put("new_pid",android.os.Process.myPid()).put("termination","owned QA force-stop; NOT OS low-memory kill"))
    }
}
