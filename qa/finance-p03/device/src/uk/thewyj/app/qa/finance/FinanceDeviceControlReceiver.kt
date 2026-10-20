package uk.thewyj.app.qa.finance

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import org.json.JSONArray
import org.json.JSONObject
import uk.thewyj.app.task21.ThewyjNotificationListenerService
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.io.File

/** Signature DUMP permission admits adb shell, never arbitrary app/data commands. */
class FinanceDeviceControlReceiver:BroadcastReceiver(){
    override fun onReceive(context:Context,intent:Intent){
        val action=intent.getStringExtra("operation").orEmpty()
        val tag=intent.getStringExtra("tag").orEmpty()
        if(!FinanceDeviceGate.enabled(context))return
        val manager=context.getSystemService(NotificationManager::class.java)
        when(action){
            "post","post-pair"->{
                require(tag.startsWith(FinanceDeviceGate.PREFIX)&&tag.length<=120)
                val channel="finance_p03_synthetic" // same channel as the failed instrumentation sender
                manager.createNotificationChannel(NotificationChannel(channel,"P03 合成 QA",NotificationManager.IMPORTANCE_LOW))
                val amount=if(intent.getIntExtra("variant",0)==1)"9.00" else "8.00"
                val eventWhen=if(intent.getBooleanExtra("historical_when",false))1000L else System.currentTimeMillis()
                val notice=Notification.Builder(context,channel).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("P03 合成通知").setContentText("合成 支付成功 CNY $amount").setWhen(eventWhen).build()
                manager.notify(tag,41003,notice)
                if(action=="post-pair")manager.notify(tag+"_SECOND",41004,notice)
                FinanceDeviceGate.append(context,JSONObject().put("event","sender_posted").put("tag",tag).put("notification_when",eventWhen).put("notifications_enabled",manager.areNotificationsEnabled()).put("channel_importance",manager.getNotificationChannel(channel)?.importance).put("sender_uid",android.os.Process.myUid()).put("elapsed",android.os.SystemClock.elapsedRealtime()))
            }
            "bind"->NotificationListenerService.requestRebind(ComponentName(context,ThewyjNotificationListenerService::class.java))
            "cancel"->{
                require(tag.startsWith(FinanceDeviceGate.PREFIX))
                FinanceDeviceGate.listener?.let{s->FinanceDeviceGate.activeSynthetic(s).filter{it.tag==tag}.forEach{s.cancelNotification(it.key)}}
            }
            "snapshot"->{
                val pending=goAsync()
                Thread{
                    try{
                        val account=NotificationSessionProvider(context).currentAccount()
                        check(account?.accountId==FinanceDeviceSupport.OWNER){"Synthetic account required"}
                        val db=NotificationDatabase.get(context);val rows=JSONArray()
                        db.openHelper.readableDatabase.query("SELECT sourcePackage,notificationId,tag,postTime,status,revisionCount FROM notification_instances WHERE accountId=?",arrayOf(FinanceDeviceSupport.OWNER)).use{c->while(c.moveToNext())if(c.getString(2).startsWith(FinanceDeviceGate.PREFIX))rows.put(JSONObject().put("package",c.getString(0)).put("id",c.getInt(1)).put("tag",c.getString(2)).put("post_time",c.getLong(3)).put("status",c.getString(4)).put("revision_count",c.getInt(5)))}
                        val books=RoomPaymentRecognitionStore(db).localBookings(FinanceDeviceSupport.OWNER)
                        val own=manager.activeNotifications.filter{it.tag.orEmpty().startsWith(FinanceDeviceGate.PREFIX)}.map{JSONObject().put("package",it.packageName).put("tag",it.tag).put("id",it.id).put("post_time",it.postTime)}
                        val accessibility=context.getSystemService(android.view.accessibility.AccessibilityManager::class.java)
                        val ownServiceEnabled=accessibility.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any{it.resolveInfo.serviceInfo.packageName==context.packageName}
                        val result=JSONObject().put("synthetic_only",true).put("accessibility_manager_enabled",accessibility.isEnabled).put("own_accessibility_enabled",ownServiceEnabled).put("own_accessibility_connected",uk.thewyj.app.task21.payment.PaymentAccessibilityStatus.connected).put("qa_screenshot_count",uk.thewyj.app.task21.payment.PaymentAccessibilityStatus.screenshotCount).put("notifications_enabled",manager.areNotificationsEnabled()).put("channel_importance",manager.getNotificationChannel("finance_p03_synthetic")?.importance).put("own_active",JSONArray(own)).put("archived",rows).put("formal_bookings",books.size).put("net_expense_minor",books.sumOf{if(it.direction=="REFUND")-it.amountMinor else if(it.direction=="EXPENSE")it.amountMinor else 0L})
                        val directory=File(context.filesDir,"finance-p03-device");directory.mkdirs();File(directory,"notification-snapshot.json").writeText(result.toString())
                    }finally{pending.finish()}
                }.start()
            }
        }
    }
}
