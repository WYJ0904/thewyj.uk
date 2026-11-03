package uk.thewyj.app.qa.finance

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Own-process Java stacks and public lifecycle/power booleans only. */
object FinanceFinishProbe {
    private val installed=AtomicBoolean(false)
    private lateinit var app:Application
    @Volatile private var stage="idle"
    @Volatile private var stageAt=0L
    @Volatile private var heartbeat=0L
    private val main=Handler(Looper.getMainLooper())
    @Synchronized private fun record(row:JSONObject){
        if(!FinanceDeviceGate.enabled(app))return
        val dir=File(app.filesDir,"finance-p03-device");dir.mkdirs()
        File(dir,"finish-probe.ndjson").appendText(row.put("elapsed",SystemClock.elapsedRealtime()).put("synthetic_only",true).toString()+"\n")
    }
    fun mark(value:String){check(value.length<=120);stage=value;stageAt=SystemClock.elapsedRealtime();record(JSONObject().put("event","stage").put("stage",value))}
    fun install(application:Application){
        if(!installed.compareAndSet(false,true))return
        app=application
        val beat=object:Runnable{override fun run(){heartbeat=SystemClock.elapsedRealtime();main.postDelayed(this,250)}}
        main.post(beat)
        app.registerActivityLifecycleCallbacks(object:Application.ActivityLifecycleCallbacks{
            private fun log(a:Activity,value:String){record(JSONObject().put("event","activity").put("class",a.javaClass.name).put("instance",System.identityHashCode(a)).put("state",value).put("finishing",a.isFinishing).put("destroyed",a.isDestroyed).put("window_focus",a.hasWindowFocus()))}
            override fun onActivityCreated(a:Activity,b:Bundle?){
                log(a,"CREATED")
                a.window.decorView.viewTreeObserver.addOnWindowFocusChangeListener{focus->record(JSONObject().put("event","focus").put("class",a.javaClass.name).put("instance",System.identityHashCode(a)).put("has_focus",focus))}
            }
            override fun onActivityStarted(a:Activity)=log(a,"STARTED")
            override fun onActivityResumed(a:Activity)=log(a,"RESUMED")
            override fun onActivityPaused(a:Activity)=log(a,"PAUSED")
            override fun onActivityStopped(a:Activity)=log(a,"STOPPED")
            override fun onActivityDestroyed(a:Activity)=log(a,"DESTROYED")
            override fun onActivitySaveInstanceState(a:Activity,b:Bundle)=Unit
        })
        Thread({
            val end=SystemClock.elapsedRealtime()+600_000L;var samples=0
            while(SystemClock.elapsedRealtime()<end){
                Thread.sleep(1000)
                if(!FinanceDeviceGate.enabled(app)||stage=="idle"||SystemClock.elapsedRealtime()-stageAt<1000||samples>=240)continue
                val threads=JSONArray()
                Thread.getAllStackTraces().entries.filter{(t,_)->t.name!="finish-own-stack-probe"}.forEach{(t,frames)->
                    if(t==Looper.getMainLooper().thread||t.name.contains("Instr",true)||frames.any{it.className.startsWith("androidx.test")})threads.put(JSONObject().put("thread",t.name).put("state",t.state.name).put("stack",JSONArray(frames.take(70).map{it.toString()})))
                }
                record(JSONObject().put("event","thread_sample").put("stage",stage).put("stage_age_ms",SystemClock.elapsedRealtime()-stageAt).put("main_heartbeat_age_ms",SystemClock.elapsedRealtime()-heartbeat).put("interactive",app.getSystemService(PowerManager::class.java).isInteractive).put("keyguard_locked",app.getSystemService(KeyguardManager::class.java).isKeyguardLocked).put("threads",threads));samples++
            }
            main.removeCallbacks(beat)
        },"finish-own-stack-probe").apply{isDaemon=true;start()}
    }
}
