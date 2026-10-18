package uk.thewyj.app.qa

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Only QA process timing and stacks. No UI strings, credentials, or account ids. */
object D01Probe {
    private lateinit var app: Application
    private val lock = Any()
    @Volatile private var heartbeat = 0L
    @Volatile private var operation = "idle"
    @Volatile private var operationAt = 0L
    @Volatile private var lifecycle = "none"
    @Volatile var samplingMode = "off"
    @Volatile private var instrumentationThread: Thread? = null
    @Volatile private var stackCaptureRunning = false
    private val session = java.time.Instant.now().toString().replace(":", "-")
    private fun output() = File(app.getExternalFilesDir(null), "d01-evidence/$session").apply { mkdirs() }
    fun write(kind: String, value: JSONObject = JSONObject()) {
        value.put("kind", kind).put("elapsed", SystemClock.elapsedRealtime()).put("utc", java.time.Instant.now().toString())
        synchronized(lock) { File(output(), "events.ndjson").appendText(value.toString()+"\n") }
    }
    fun stage(name: String) {
        instrumentationThread = Thread.currentThread()
        operation = name; operationAt = SystemClock.elapsedRealtime()
        write("stage", JSONObject().put("stage", name))
    }
    fun sample(reason: String) {
        write("sample-request",JSONObject().put("reason",reason).put("stage",operation)
            .put("lifecycle",lifecycle).put("samplingMode",samplingMode)
            .put("heartbeatAgeMs",SystemClock.elapsedRealtime()-heartbeat))
        if (samplingMode == "off" || stackCaptureRunning) return
        stackCaptureRunning = true
        Thread({ try {
        val threads = JSONArray()
        listOfNotNull(instrumentationThread, Looper.getMainLooper().thread).forEach { t ->
            val stack = t.stackTrace
            threads.put(JSONObject().put("name", t.name).put("state", t.state.name)
                .put("stack", JSONArray(stack.map { it.toString() })))
            write("thread-sample",JSONObject().put("reason",reason).put("stage",operation)
                .put("name",t.name).put("stack",JSONArray(stack.map { it.toString() })))
        }
        write("sample", JSONObject().put("reason",reason).put("stage",operation).put("lifecycle",lifecycle)
            .put("heartbeatAgeMs",SystemClock.elapsedRealtime()-heartbeat).put("threads", threads))
        } finally { stackCaptureRunning=false } },"D01OwnStackCapture").apply { isDaemon=true;start() }
    }
    fun start(application: Application) {
        app = application
        val handler = Handler(Looper.getMainLooper())
        val pulse = object: Runnable { override fun run() { heartbeat=SystemClock.elapsedRealtime();handler.postDelayed(this,250) } }
        handler.post(pulse)
        application.registerActivityLifecycleCallbacks(object: Application.ActivityLifecycleCallbacks {
            private fun event(a: Activity, phase: String) {
                lifecycle=phase
                write("lifecycle",JSONObject().put("activity",a.javaClass.simpleName).put("instance",System.identityHashCode(a)).put("phase",phase))
            }
            override fun onActivityCreated(a:Activity,b:Bundle?) = event(a,"created")
            override fun onActivityStarted(a:Activity) = event(a,"started")
            override fun onActivityResumed(a:Activity) = event(a,"resumed")
            override fun onActivityPrePaused(a:Activity) = event(a,"prePause")
            override fun onActivityPaused(a:Activity) = event(a,"paused")
            override fun onActivityPostPaused(a:Activity) = event(a,"postPause")
            override fun onActivityPreStopped(a:Activity) = event(a,"preStop")
            override fun onActivityStopped(a:Activity) = event(a,"stopped")
            override fun onActivityPostStopped(a:Activity) = event(a,"postStop")
            override fun onActivityPreDestroyed(a:Activity) = event(a,"preDestroy")
            override fun onActivityDestroyed(a:Activity) = event(a,"destroyed")
            override fun onActivitySaveInstanceState(a:Activity,b:Bundle) { event(a,"saveState") }
        })
        Thread({ while (true) {
            SystemClock.sleep(2_000)
            if (operation!="idle" && SystemClock.elapsedRealtime()-heartbeat>1_500) sample("main-heartbeat-late")
            val operationLimit = when {
                operation.startsWith("T12") -> 140_000
                operation.startsWith("OWNER_UNLOCK_REQUIRED:") -> 110_000
                else -> 30_000
            }
            if (operation!="idle" && SystemClock.elapsedRealtime()-operationAt>operationLimit) {
                sample("step-watchdog-30s")
                write("WATCHDOG_FAIL",JSONObject().put("stage",operation))
                // This newly installed QA target is the only process stopped.
                check(app.packageName in setOf("uk.thewyj.app.qa.d01","uk.thewyj.app.qa.d01control"))
                android.os.Process.killProcess(android.os.Process.myPid())
            }
        }},"D01OwnWatchdog").apply { isDaemon=true;start() }
        write("application",JSONObject().put("package",app.packageName).put("hardwareAccelerationDisabled",false))
    }
}

class D01PlainActivity: Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(TextView(this).apply { text="D01 plain Activity · synthetic only";textSize=20f })
    }
}
