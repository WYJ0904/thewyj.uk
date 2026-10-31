package uk.thewyj.app.qa.finance

import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** QA-only entry gate. Never inspect extras of a private or unowned source. */
object FinanceDeviceGate {
    @Volatile var listener:NotificationListenerService?=null
        private set
    const val PREFIX="FINANCE_P03_"
    private fun prefs(c:Context)=c.getSharedPreferences("finance_p03_device_guard",Context.MODE_PRIVATE)
    fun enabled(c:Context)=prefs(c).getBoolean("enabled",false)
    fun enable(c:Context,value:Boolean){check(prefs(c).edit().putBoolean("enabled",value).commit())}
    fun allow(c:Context,s:StatusBarNotification)=enabled(c)&&s.packageName in setOf("com.android.shell",c.packageName,"uk.thewyj.app.debug.p03acceptance")&&s.tag.orEmpty().startsWith(PREFIX)
    fun allowAccessibility(c:Context,pkg:String)=enabled(c)&&pkg in setOf(c.packageName,"uk.thewyj.app.debug.p03acceptance")
    @Synchronized fun connected(c:Context){listener=c as? NotificationListenerService;append(c,JSONObject().put("event","listener_connected"))}
    @Synchronized fun observed(c:Context,s:StatusBarNotification,removed:Boolean=false){
        val keys=prefs(c).getStringSet("known_keys",emptySet()).orEmpty().toMutableSet();keys.add(s.key)
        check(prefs(c).edit().putStringSet("known_keys",keys).commit())
        append(c,JSONObject().put("event",if(removed)"removed" else "posted").put("package",s.packageName).put("uid",s.uid).put("key_sha256",hash(s.key))
            .put("id",s.id).put("tag",s.tag).put("post_time",s.postTime).put("notification_when",s.notification.`when`).put("elapsed",android.os.SystemClock.elapsedRealtime()))
    }
    fun activeSynthetic(service:NotificationListenerService):Array<StatusBarNotification>{
        val keys=prefs(service).getStringSet("known_keys",emptySet()).orEmpty()
        if(!enabled(service)||keys.isEmpty())return emptyArray()
        return service.getActiveNotifications(keys.toTypedArray()).filter{allow(service,it)}.toTypedArray()
    }
    fun cleanup(c:Context){
        listener?.let{s->activeSynthetic(s).forEach{s.cancelNotification(it.key)}}
        enable(c,false)
    }
    @Synchronized fun append(c:Context,value:JSONObject){val dir=File(c.filesDir,"finance-p03-device");dir.mkdirs();File(dir,"platform.ndjson").appendText(value.put("synthetic_only",true).toString()+"\n")}
    private fun hash(s:String)=MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString(""){"%02x".format(it)}
}
