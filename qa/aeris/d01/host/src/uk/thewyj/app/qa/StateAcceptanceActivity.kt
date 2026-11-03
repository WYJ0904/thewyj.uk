package uk.thewyj.app.qa

import android.app.Application
import android.app.Activity
import android.os.Looper
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection
import uk.thewyj.app.AppGraph
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.auth.*
import uk.thewyj.app.core.design.ThewyjTheme
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.core.web.ThewyjWebView
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*
import uk.thewyj.app.ui.PaymentVerificationScreen
import uk.thewyj.app.ui.PaymentVerificationState

class AcceptanceApplication : Application() {
    override fun onCreate() { super.onCreate(); AppGraph.initialize(this)
        // Own-process Java stacks only. No debugger, shell privilege or private data.
        val lock=Any();val events=JSONArray();var phase="application-created";var phaseAt=SystemClock.elapsedRealtime()
        fun event(name:String){synchronized(lock){phase=name;phaseAt=SystemClock.elapsedRealtime();events.put(JSONObject().put("phase",name).put("elapsed",phaseAt))}}
        registerActivityLifecycleCallbacks(object:ActivityLifecycleCallbacks{
            override fun onActivityCreated(a:Activity,b:Bundle?){event("created")}
            override fun onActivityStarted(a:Activity){event("started")}
            override fun onActivityResumed(a:Activity){event("resumed")}
            override fun onActivityPrePaused(a:Activity){event("prePause")}
            override fun onActivityPaused(a:Activity){event("paused")}
            override fun onActivityPostPaused(a:Activity){event("postPause")}
            override fun onActivityPreStopped(a:Activity){event("preStop")}
            override fun onActivityStopped(a:Activity){event("stopped")}
            override fun onActivityPostStopped(a:Activity){event("postStop")}
            override fun onActivityPreDestroyed(a:Activity){event("preDestroy")}
            override fun onActivityDestroyed(a:Activity){event("destroyed")}
            override fun onActivitySaveInstanceState(a:Activity,b:Bundle){}
        })
        Thread({while(true){SystemClock.sleep(10_000)
            val sample=synchronized(lock){JSONObject().put("utc",java.time.Instant.now().toString()).put("phase",phase).put("phaseAgeMs",SystemClock.elapsedRealtime()-phaseAt).put("events",JSONArray(events.toString()))}
            sample.put("mainStack",JSONArray(Looper.getMainLooper().thread.stackTrace.map{it.toString()}))
            val threads=JSONArray();Thread.getAllStackTraces().forEach{(thread,stack)->if(thread.name.startsWith("Instr:"))threads.put(JSONObject().put("name",thread.name).put("stack",JSONArray(stack.map{it.toString()})))}
            sample.put("instrumentationThreads",threads)
            File(getExternalFilesDir(null),"qa3-evidence").apply{mkdirs()}.resolve("own-lifecycle-samples.ndjson").appendText(sample.toString()+"\n")
        }},"QA3OwnLifecycleSampler").apply{isDaemon=true;start()}
    }
}

/** QA overlay only: no service grants, no system notification access, no real accounts. */
class StateAcceptanceActivity : ComponentActivity() {
    var ready by mutableStateOf(false)
    var mode by mutableStateOf("native")
    var account by mutableStateOf("")
    var route by mutableStateOf("/finance")
    var navigation by mutableIntStateOf(0)
    var sessionEpoch by mutableIntStateOf(0)
    var state by mutableStateOf<PaymentVerificationState?>(null)
    val remote = AtomicReference(PaymentHintSync.Result(0,0,0,true))
    val reconcileCalls = AtomicInteger(0)
    lateinit var database: NotificationDatabase
    lateinit var store: RoomPaymentRecognitionStore
    val webErrors = mutableListOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(BuildConfig.DEBUG && packageName == "uk.thewyj.app.qa.stateacceptance")
        check(BuildConfig.THEWYJ_BASE_URL == "https://127.0.0.1:18787")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        database = NotificationDatabase.get(this)
        store = RoomPaymentRecognitionStore(database)
        setContent {
            ThewyjTheme(darkTheme=false) {
                Column(Modifier.fillMaxSize().padding(top=28.dp,bottom=24.dp)) {
                    Text("Aeris QA · SYNTHETIC ONLY · Android 16")
                    if (ready) {
                        if (mode == "native") state?.let { current ->
                            PaymentVerificationScreen(current, onBack={}, onOpenFinance={}, onOpenApp={false})
                        } else {
                            ThewyjWebView(route,navigation,sessionEpoch,0,{}, {}, {}, {},
                                { message -> synchronized(webErrors) { webErrors.add(message.take(100)) } },
                                modifier=Modifier.weight(1f),active=true)
                        }
                    }
                }
            }
        }
    }

    fun observation(owner:String, rows:List<PendingReviewIdentity>):PaymentHintSync.Result {
        val pending=rows.filter{it.state=="pending"}
        return PaymentHintSync.Result(rows.size,0,0,true,completeObservation=true,
            pendingEventIds=pending.flatMap{it.eventIds+it.eventId}.toSet(),
            pendingCount=pending.size,pendingRecords=pending,accountId=owner,
            observedStates=rows.flatMap{r->(r.eventIds+r.eventId).map{it to r.state}}.toMap())
    }

    suspend fun configure(owner:String, rows:List<PendingReviewIdentity>, recognitions:List<PaymentRecognitionRecord> = emptyList(),
        tickets:List<PaymentTicket> = emptyList()) {
        check(owner.startsWith("qa3-"))
        withContext(Dispatchers.IO) {
            val now=System.currentTimeMillis()
            SecureCredentialStore(this@StateAcceptanceActivity).saveActive(DeviceCredentials(
                UUID.randomUUID().toString(),now+3_600_000,UUID.randomUUID().toString(),now+3_600_000,"qa3-device-session",
                AccountSnapshot(owner,"QA synthetic","user","QA fixture",setOf("finance_access"))))
            recognitions.forEach(store::saveRecognition);tickets.forEach(store::saveTicket)
        }
        withContext(Dispatchers.Main) {
            state?.deactivate()
            account=owner
            remote.set(observation(owner,rows))
            val center=PaymentVerificationCenter(this@StateAcceptanceActivity,hintedStore=store,
                hintedArchive=RoomNotificationStore(database),hintedQueuedRequests={emptyList()})
            reconcileCalls.set(0)
            state=PaymentVerificationState(this@StateAcceptanceActivity,owner,center,reconcileOverride={reconcileCalls.incrementAndGet();remote.get()})
            mode="native";ready=true;sessionEpoch+=1
        }
    }

    suspend fun web(caseId:String) {
        withContext(Dispatchers.Main) {
            route="/finance?qaCase=$caseId&account=$account";navigation+=1;mode="web";ready=true
        }
    }

    fun webView(root:View=window.decorView):WebView? {
        if(root is WebView)return root
        if(root is ViewGroup)for(i in 0 until root.childCount)webView(root.getChildAt(i))?.let{return it}
        return null
    }

    fun eval(code:String):String {
        check(android.os.Looper.myLooper()!=android.os.Looper.getMainLooper())
        val result=AtomicReference("null");val done=CountDownLatch(1)
        runOnUiThread { val web=webView();if(web==null){done.countDown()}else web.evaluateJavascript(code){result.set(it);done.countDown()} }
        check(done.await(15,TimeUnit.SECONDS)){"QA_EVAL_TIMEOUT"}
        return result.get()
    }

    fun awaitJs(condition:String,timeoutMs:Long=20_000) {
        val until=SystemClock.elapsedRealtime()+timeoutMs
        while(SystemClock.elapsedRealtime()<until){if(eval("Boolean($condition)")=="true")return;SystemClock.sleep(80)}
        val diagnostic=JSONObject().put("condition",condition).put("errors",JSONArray(webErrors))
        val done=CountDownLatch(1)
        runOnUiThread { val web=webView();diagnostic.put("webExists",web!=null).put("width",web?.width).put("height",web?.height)
            .put("url",web?.url?.substringBefore('?')).put("lifecycle",lifecycle.currentState.name);done.countDown() }
        done.await(5,TimeUnit.SECONDS)
        diagnostic.put("scriptState",eval("JSON.stringify({qaExists:!!window.QA,ready:window.QA?.ready,activeRequests:window.QA?.activeRequests,ledgerOwnerMatch:window.WYJLocalPaymentLedger?.account_id===window.QA?.owner,errors:window.QA_DIAGNOSTICS})"))
        File(getExternalFilesDir(null),"qa3-evidence").apply{mkdirs()}.resolve("web-timeout-${SystemClock.elapsedRealtime()}.json").writeText(diagnostic.toString(2))
        error("QA_JS_CONDITION_TIMEOUT")
    }

    fun control(body:JSONObject):JSONObject {
        check(body.optString("caseId").startsWith("T"))
        val c=URL(BuildConfig.THEWYJ_BASE_URL+"/qa/control").openConnection() as HttpsURLConnection
        c.connectTimeout=5_000;c.readTimeout=10_000;c.requestMethod="POST";c.doOutput=true
        c.setRequestProperty("Content-Type","application/json")
        try { c.outputStream.use{it.write(body.toString().toByteArray())};check(c.responseCode==200){"QA_CONTROL_HTTP_${c.responseCode}"}
            return JSONObject(c.inputStream.bufferedReader().use{it.readText()})
        } finally { c.disconnect() }
    }

    fun remoteRow(id:String="qa3-event-a",amount:Long?=null,pkg:String="com.tencent.mm",label:String="微信") =
        PendingReviewIdentity("hint","hint-$id",id,"qa3-device",sourcePackage=pkg,appLabel=label,amountMinor=amount)

    fun recognition(owner:String,id:String="qa3-event-a",amount:Long?=123,pkg:String="com.tencent.mm",direction:String="UNKNOWN",
        complete:Boolean=false) = PaymentRecognitionRecord("rec-$owner-$id",owner,PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            1,pkg,"notification","notification#event#$id",id,if(pkg=="com.tencent.mm")"wechat" else "alipay",amount,"CNY",direction,"","",
            System.currentTimeMillis(),System.currentTimeMillis(),completionConfirmed=complete)
}
