package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.NotificationOfflineQueue
import uk.thewyj.app.task21.store.*
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP02TimingTest {
    @Test fun negativeControlsNeverAutoBook() {
        val context=RuntimeEnvironment.getApplication()
        val out=File(System.getProperty("finance.p02.output")).apply{mkdirs()}
        val database=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build()
        val store=RoomPaymentRecognitionStore(database)
        val inputs=listOf("转账¥648.00，待你收款","获得50元餐券，满648元可用","验证码 SYNTHETIC_OTP，请勿泄露","微信支付提醒，请打开应用查看详情","UNPROVEN_LEGACY_RECORD")
        try {
            inputs.forEachIndexed { index,text ->
                database.clearAllTables();val owner="synthetic-negative-$index";val c=PaymentRecognitionCoordinator(store,now={1000L})
                if(index==4) {
                    store.saveRecognition(PaymentRecognitionRecord("negative-legacy",owner,"FINANCE_PENDING_CONFIRMATION",7,"com.tencent.mm","NOTIFICATION","notification#event#negative-legacy","","wechat",64800,"CNY","EXPENSE","","",1000,1000))
                    assertNull(c.autoBook(owner,"negative-legacy"))
                } else c.onSourceEvent(owner,"com.tencent.mm",PaymentSourceType.NOTIFICATION,"synthetic-negative-event-$index","合成微信",text)
                val actual=store.localBookings(owner).size
                File(out,"negative-bookings.ndjson").appendText(JSONObject().put("case_id","G-NEGATIVE-$index").put("group","G").put("layer","CURRENT_BASELINE")
                    .put("fixture",JSONObject().put("source","synthetic").put("text",text).put("expected",JSONObject().put("records",0)))
                    .put("actual",JSONObject().put("records",actual)).put("status",if(actual==0)"PASS" else "FAIL")
                    .put("coverage","REAL_COORDINATOR_ROOM_NEGATIVE_BOOKING_CONTROL").toString()+"\n")
                assertEquals(0,actual)
            }
        } finally {database.close()}
    }
    @Test fun queueAndLocalBookingTimingWithoutNetwork() {
        val context=RuntimeEnvironment.getApplication()
        val out=File(System.getProperty("finance.p02.output")).apply{mkdirs()}
        val database=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build()
        val owner="synthetic-timing-owner";val samples=JSONArray()
        val queue=NotificationOfflineQueue.inDirectory(File(out,"timing-queue"),owner)
        try {
            val store=RoomPaymentRecognitionStore(database);val c=PaymentRecognitionCoordinator(store,now={1000L})
            repeat(10) { i ->
                val event="synthetic-timing-event-$i";val rec="synthetic-timing-record-$i"
                store.saveRecognition(PaymentRecognitionRecord(rec,owner,"FINANCE_PENDING_CONFIRMATION",7,"com.tencent.mm","NOTIFICATION","notification#event#$event",event,"wechat",64800,"CNY","EXPENSE","","",1000,1000))
                repeat(3) { retry ->
                    val before=System.nanoTime();val booking=c.autoBook(owner,rec,knownTransactionId="synthetic-timing-tx-$i")
                    val room=(System.nanoTime()-before)/1_000_000.0
                    val queued=System.nanoTime();queue.enqueueRequest(event,"/api/notification/ingest","{\"events\":[]}")
                    samples.put(JSONObject().put("event",event).put("retry",retry).put("room_ms",room).put("queue_ms",(System.nanoTime()-queued)/1_000_000.0))
                    assertEquals("synthetic-timing-tx-$i",booking!!.transactionId)
                }
            }
            assertEquals(10,store.localBookings(owner).size);assertEquals(10,queue.peekRequests().size)
            File(out,"timing.json").writeText(JSONObject().put("case_id","G-QUEUE-ROOM-TIMING").put("group","G").put("layer","CURRENT_BASELINE").put("status","PASS")
                .put("expected",JSONObject().put("ledger_rows",10).put("queue_rows",10)).put("actual",JSONObject().put("ledger_rows",10).put("queue_rows",10))
                .put("samples",samples).put("coverage","JVM_ROBOLECTRIC_SQLITE_AND_FILE_IO_NOT_PHONE_HARDWARE").toString())
        } finally {database.close()}
    }
}
