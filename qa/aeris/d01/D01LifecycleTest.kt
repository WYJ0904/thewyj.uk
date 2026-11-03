package uk.thewyj.app.qa

import android.os.Build
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.task21.payment.PaymentReviewSignals
import java.util.UUID

/** Same source is compiled against 94f5177 and f6a2ec7. Default: 30 full rounds. */
class D01LifecycleTest {
    private val args get() = InstrumentationRegistry.getArguments()
    private val device get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val pkg get() = InstrumentationRegistry.getInstrumentation().targetContext.packageName
    private fun await(check: () -> Boolean) {
        val end=SystemClock.elapsedRealtime()+8_000
        while(SystemClock.elapsedRealtime()<end) { if(check())return;SystemClock.sleep(50) }
        D01Probe.sample("condition-timeout");error("D01_CONDITION_TIMEOUT")
    }
    private fun step(round:Int, name:String, action:()->Unit) {
        D01Probe.stage("$round:$name")
        val at=SystemClock.elapsedRealtime()
        try { action();D01Probe.write("step-pass",JSONObject().put("round",round).put("step",name).put("durationMs",SystemClock.elapsedRealtime()-at)) }
        catch(t:Throwable){D01Probe.sample("step-failed");D01Probe.write("step-fail",JSONObject().put("round",round).put("step",name).put("error",t.javaClass.simpleName));throw t}
    }
    @Test fun L01_plainRepeatedLifecycle() = exercise("plain")
    @Test fun L02_nativeRepeatedLifecycle() = exercise("native")
    @Test fun L03_webRepeatedLifecycle() = exercise("web")
    private fun exercise(mode:String) {
        assertEquals("SM-S9360",Build.MODEL);assertEquals(36,Build.VERSION.SDK_INT)
        val count=args.getString("rounds","30")!!.toInt()
        D01Probe.samplingMode=args.getString("sampleMode","off")!!
        D01Probe.write("group-start",JSONObject().put("mode",mode).put("rounds",count).put("sampleMode",D01Probe.samplingMode))
        repeat(count) { index ->
            val round=index+1;val start=SystemClock.elapsedRealtime()
            if(mode=="plain") {
                lateinit var scenario:ActivityScenario<D01PlainActivity>
                step(round,"plain-launch"){scenario=ActivityScenario.launch(D01PlainActivity::class.java)}
                try {
                    step(round,"plain-first-stop"){scenario.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,scenario.state)}
                    step(round,"plain-resume"){scenario.moveToState(Lifecycle.State.RESUMED);assertEquals(Lifecycle.State.RESUMED,scenario.state)}
                    step(round,"plain-second-stop"){scenario.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,scenario.state)}
                    step(round,"plain-resume-for-recreate"){scenario.moveToState(Lifecycle.State.RESUMED)}
                    step(round,"plain-recreate"){scenario.recreate();assertEquals(Lifecycle.State.RESUMED,scenario.state)}
                } finally { step(round,"plain-close"){scenario.close();assertEquals(Lifecycle.State.DESTROYED,scenario.state)} }
            } else {
                lateinit var scenario:ActivityScenario<StateAcceptanceActivity>
                lateinit var a:StateAcceptanceActivity
                fun configure() {
                    val own="qa3-d01-${UUID.randomUUID()}"
                    runBlocking { a.configure(own,listOf(a.remoteRow(amount=123)),listOf(a.recognition(own))) }
                    if(mode=="web") {
                        a.control(JSONObject().put("caseId","T16").put("action","setup").put("owner",own))
                        runBlocking { a.web("T16") }
                        a.awaitJs("window.QA?.ready===true && window.QA.activeRequests===0 && window.WYJLocalPaymentLedger?.account_id===window.QA.owner")
                    } else {
                        await { a.state?.canonicalObserved==true }
                        await { device.hasObject(By.pkg(pkg).textContains("1.23")) }
                    }
                }
                step(round,"$mode-launch"){scenario=ActivityScenario.launch(StateAcceptanceActivity::class.java);scenario.onActivity{a=it}}
                try {
                    step(round,"$mode-configure"){configure()}
                    step(round,"$mode-first-stop"){scenario.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,scenario.state)}
                    a.remote.set(a.observation(a.account,listOf(a.remoteRow(amount=456))));repeat(100){PaymentReviewSignals.publish()}
                    step(round,"$mode-resume"){scenario.moveToState(Lifecycle.State.RESUMED);assertEquals(Lifecycle.State.RESUMED,scenario.state)}
                    step(round,"$mode-fresh-ui"){
                        if(mode=="native") {
                            await { a.state!!.items.singleOrNull()?.amountMinor==456L }
                            await { device.hasObject(By.pkg(pkg).textContains("4.56")) }
                        } else a.awaitJs("document.documentElement.dataset.androidWebActive==='true'")
                    }
                    step(round,"$mode-second-stop"){scenario.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,scenario.state)}
                    step(round,"$mode-resume-for-recreate"){scenario.moveToState(Lifecycle.State.RESUMED)}
                    step(round,"$mode-recreate"){scenario.recreate();assertEquals(Lifecycle.State.RESUMED,scenario.state);scenario.onActivity{a=it}}
                    step(round,"$mode-remount"){configure()}
                } finally { step(round,"$mode-close"){scenario.close();assertEquals(Lifecycle.State.DESTROYED,scenario.state)} }
            }
            D01Probe.write("round-pass",JSONObject().put("round",round).put("mode",mode).put("durationMs",SystemClock.elapsedRealtime()-start))
        }
        D01Probe.stage("idle")
        D01Probe.write("group-pass",JSONObject().put("mode",mode).put("rounds",count))
    }
}
