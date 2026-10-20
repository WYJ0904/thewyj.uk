package uk.thewyj.app.qa.finance
import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.ThewyjNotificationListenerService
import uk.thewyj.app.task21.store.*
import java.io.File
import java.util.UUID
@RunWith(AndroidJUnit4::class)
class FinanceDeviceNotificationTest {
    @Test fun realOsCallbacksUpdatesRemovalRepostAndUnprovenFinanceIsolation(){
        val i=InstrumentationRegistry.getInstrumentation();val c=i.targetContext
        val manager=c.getSystemService(NotificationManager::class.java)
        assertTrue("Normal owner NLS grant required",manager.isNotificationListenerAccessGranted(ComponentName(c,ThewyjNotificationListenerService::class.java)))
        assertEquals("Normal own-QA notification display grant required",PackageManager.PERMISSION_GRANTED,c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        assertTrue(FinanceDeviceGate.enabled(c))
        android.service.notification.NotificationListenerService.requestRebind(ComponentName(c,ThewyjNotificationListenerService::class.java))
        val bindDeadline=android.os.SystemClock.elapsedRealtime()+10000
        while(FinanceDeviceGate.listener==null&&android.os.SystemClock.elapsedRealtime()<bindDeadline)Thread.sleep(100)
        assertNotNull("Actual owned NLS must bind",FinanceDeviceGate.listener)
        val owner=FinanceDeviceSupport.OWNER
        val store=RoomPaymentRecognitionStore(NotificationDatabase.get(c));val original=store.localBookings(owner)
        val tag=FinanceDeviceGate.PREFIX+UUID.randomUUID().toString().replace("-","")
        val channel="finance_p03_synthetic";manager.createNotificationChannel(NotificationChannel(channel,"P03 合成 QA",NotificationManager.IMPORTANCE_LOW))
        fun notices()=File(c.filesDir,"finance-p03-device/platform.ndjson").takeIf{it.exists()}?.readLines()?.filter{it.isNotBlank()}?.map{JSONObject(it)}?.filter{it.optString("tag")==tag}.orEmpty()
        fun waitEvent(event:String,n:Int){val end=android.os.SystemClock.elapsedRealtime()+10000;while(android.os.SystemClock.elapsedRealtime()<end){if(notices().count{it.optString("event")==event}>=n)return;Thread.sleep(100)};fail("Missing actual OS callback $event number $n")}
        fun post(text:String){manager.notify(tag,41003,Notification.Builder(c,channel).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("P03 合成通知").setContentText(text).setWhen(System.currentTimeMillis()).build())}
        try{
            post("合成 支付成功 CNY 8.00");waitEvent("posted",1)
            post("合成 支付成功 CNY 8.00");waitEvent("posted",2)
            post("合成 支付成功 CNY 9.00");waitEvent("posted",3)
            manager.cancel(tag,41003);waitEvent("removed",1)
            post("合成 支付成功 CNY 8.00");waitEvent("posted",4)
            val shellTag=tag+"_SHELL"
            // Fixed synthetic text only. DONT_SUPPRESS_ACCESSIBILITY_SERVICES is retained.
            val shell=i.uiAutomation.executeShellCommand("cmd notification post -t P03_SYNTHETIC $shellTag P03_SYNTHETIC_ONLY")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(shell).use{it.readBytes()}
            val end=android.os.SystemClock.elapsedRealtime()+10000
            var archived=false
            while(android.os.SystemClock.elapsedRealtime()<end){
                archived=NotificationDatabase.get(c).notificationDao().activeInstanceBySlot(owner,c.packageName,41003,tag)!=null
                if(archived)break;Thread.sleep(100)
            }
            assertTrue("Real listener persisted own synthetic source to real Room",archived)
            assertEquals("Notification slot/time is not financial proof",original,store.localBookings(owner))
            val seen=notices();assertTrue(seen.count{it.optString("event")=="posted"}>=4)
            assertEquals(1,seen.map{it.getString("key_sha256")}.toSet().size)
            val fields=JSONArray(seen.map{JSONObject().put("event",it.getString("event")).put("key_sha256",it.getString("key_sha256")).put("post_time",it.getLong("post_time")).put("notification_when",it.getLong("notification_when"))})
            FinanceDeviceSupport.record(c,"DEVICE-NLS-IDENTITY",JSONObject().put("observations",fields).put("formal_expense_delta",0).put("actual_android_callback",true).put("source","own QA package; not WeChat or Alipay"))
        }finally{manager.cancel(tag,41003)}
    }
}
