package uk.thewyj.app.qa.finance
import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import org.json.JSONObject
/** QA window lifetime only. Never changes a lock/screen/system setting. */
class FinanceDeviceInitProvider:ContentProvider(){
    override fun onCreate():Boolean{
        val app=context?.applicationContext as? Application?:return false
        app.registerActivityLifecycleCallbacks(object:Application.ActivityLifecycleCallbacks{
            private fun log(a:Activity,state:String){if(a.javaClass.name=="uk.thewyj.app.MainActivity"&&FinanceDeviceGate.enabled(app))FinanceDeviceGate.append(app,JSONObject().put("event","main_lifecycle").put("state",state).put("instance",System.identityHashCode(a)).put("elapsed",android.os.SystemClock.elapsedRealtime()))}
            override fun onActivityCreated(a:Activity,b:Bundle?){log(a,"CREATED")}
            override fun onActivityStarted(a:Activity){log(a,"STARTED")}
            override fun onActivityResumed(a:Activity){if(a.javaClass.name=="uk.thewyj.app.MainActivity"&&FinanceDeviceGate.enabled(app))a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);log(a,"RESUMED")}
            override fun onActivityPaused(a:Activity){log(a,"PAUSED")}
            override fun onActivityStopped(a:Activity){a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);log(a,"STOPPED")}
            override fun onActivitySaveInstanceState(a:Activity,b:Bundle)=Unit
            override fun onActivityDestroyed(a:Activity){log(a,"DESTROYED")}
        });return true
    }
    override fun query(u:Uri,p:Array<out String>?,s:String?,a:Array<out String>?,o:String?):Cursor?=null
    override fun getType(u:Uri):String?=null
    override fun insert(u:Uri,v:ContentValues?):Uri?=null
    override fun delete(u:Uri,s:String?,a:Array<out String>?):Int=0
    override fun update(u:Uri,v:ContentValues?,s:String?,a:Array<out String>?):Int=0
}
