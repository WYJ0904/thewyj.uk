package uk.thewyj.app.task21.payment

import android.app.Application
import android.content.Context
import androidx.room.Room
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.store.*
import java.io.File

private const val OWNER="synthetic-p02-process-owner"
private const val TX="synthetic-p02-legacy-tx"
private fun output()=File(System.getProperty("finance.p02.output")).apply{mkdirs()}
private fun capture()=NotificationCaptureInput(sourcePackage="com.tencent.mm",notificationKey="synthetic-p02-slot",notificationId=7,text="支付成功 ¥648.00",postTime=1000)
private fun proof()=PaymentIngestOutcome(true,64800,FinanceDirection.EXPENSE,950,"","","wechat","synthetic",providerReference="SYNTH-JVM-REF")
private fun journal(id:String,actual:JSONObject){File(output(),"process-$id.ndjson").writeText(JSONObject().put("case_id",id).put("group","G").put("layer","CURRENT_BASELINE")
    .put("status","PASS").put("expected",JSONObject().put("records",1).put("old_transaction_id",TX)).put("actual",actual)
    .put("coverage","TWO_REAL_JVM_PROCESSES_ROOM_FILE_AND_OFFLINE_QUEUE; VIRTUAL_ANDROID_PREFS_REHYDRATED_FROM_SYNTHETIC_SNAPSHOT").toString()+"\n")}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP02SeedTest {
    @Test fun seedPersistedState() {
        val context:Context=RuntimeEnvironment.getApplication()
        val file=File(output(),"p02-process.db");check(!file.exists()){ "Do not overwrite an earlier fixture" }
        val db=Room.databaseBuilder(context,NotificationDatabase::class.java,file.absolutePath).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db)
            store.saveRecognition(PaymentRecognitionRecord("synthetic-p02-rec",OWNER,"FINANCE_PENDING_CONFIRMATION",7,"com.tencent.mm","NOTIFICATION","notification#event#synthetic-p02-event","synthetic-p02-event","wechat",64800,"CNY","EXPENSE","","",1000,1000))
            assertEquals(TX,PaymentRecognitionCoordinator(store).autoBook(OWNER,"synthetic-p02-rec",knownTransactionId=TX)!!.transactionId)
            val registry=AndroidPaymentNotificationLifecycleRegistry(context,idFactory={"synthetic-p02-persisted-id"});val event=registry.eventId(OWNER,capture(),proof())
            val preferences=context.getSharedPreferences("wyj-payment-notification-lifecycles",Context.MODE_PRIVATE)
            val saved=JSONObject().put("jvm_pid",ProcessHandle.current().pid()).put("event_id",event).put("preferences",JSONObject(preferences.all))
            File(output(),"p02-process-seed.json").writeText(saved.toString())
            val queue=NotificationOfflineQueue.inDirectory(File(output(),"offline"),OWNER)
            repeat(3){queue.enqueueRequest("synthetic-p02-operation","/api/notification/ingest","{\"events\":[]}")}
            assertEquals(1,queue.peekRequests().size)
            journal("G-PROCESS-SEED",JSONObject().put("pid",ProcessHandle.current().pid()).put("records",1).put("queue",1).put("transaction_id",TX).put("event_id",event))
        } finally {db.close()}
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP02RestoreTest {
    @Test fun restoreFromAnotherJvmWithoutNewBooking() {
        val context:Context=RuntimeEnvironment.getApplication()
        val old=JSONObject(File(output(),"p02-process-seed.json").readText());assertNotEquals(old.getLong("jvm_pid"),ProcessHandle.current().pid())
        val db=Room.databaseBuilder(context,NotificationDatabase::class.java,File(output(),"p02-process.db").absolutePath).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db);val c=PaymentRecognitionCoordinator(store)
            repeat(3){assertEquals(TX,c.autoBook(OWNER,"synthetic-p02-rec")!!.transactionId)}
            assertEquals(1,store.localBookings(OWNER).size)
            val queue=NotificationOfflineQueue.inDirectory(File(output(),"offline"),OWNER);repeat(3){queue.enqueueRequest("synthetic-p02-operation","/api/notification/ingest","{\"events\":[]}")}
            assertEquals(1,queue.peekRequests().size)
            // Robolectric creates a new virtual app directory per JVM: restore the
            // saved synthetic preference values explicitly, without claiming OS crash fidelity.
            val editor=context.getSharedPreferences("wyj-payment-notification-lifecycles",Context.MODE_PRIVATE).edit().clear()
            val values=old.getJSONObject("preferences");values.keys().forEach{editor.putString(it,values.getString(it))};editor.commit()
            val event=AndroidPaymentNotificationLifecycleRegistry(context,idFactory={"synthetic-unexpected-new-id"}).eventId(OWNER,capture().copy(postTime=9999),proof())
            assertEquals(old.getString("event_id"),event)
            journal("G-PROCESS-RESTORE",JSONObject().put("pid",ProcessHandle.current().pid()).put("old_pid",old.getLong("jvm_pid")).put("records",1).put("queue",1).put("transaction_id",TX).put("event_id",event))
        } finally {db.close()}
    }
}
