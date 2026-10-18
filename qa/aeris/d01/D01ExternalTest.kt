package uk.thewyj.app.qa

import android.app.KeyguardManager
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.task21.payment.PaymentReviewSignals
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.io.File

/** PC drives normal Home/return or sleep/wake, because a frozen test cannot wake itself. */
class D01ExternalTest {
    private fun await(condition:()->Boolean) {
        val until=SystemClock.elapsedRealtime()+20_000
        while(SystemClock.elapsedRealtime()<until) { if(condition())return;SystemClock.sleep(60) }
        error("D01_EXTERNAL_RESUME_TIMEOUT")
    }
    @Test fun E01_homeAndExternalReturn()=exercise("home")
    @Test fun E02_screenSleepWakeExternalReturn()=exercise("screen")
    private fun exercise(mode:String) {
        val rounds=InstrumentationRegistry.getArguments().getString("rounds","1")!!.toInt()
        val target=InstrumentationRegistry.getInstrumentation().targetContext
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val keyguard=target.getSystemService(KeyguardManager::class.java)
        D01Probe.samplingMode="off"
        repeat(rounds) { i ->
            val begin=SystemClock.elapsedRealtime()
            D01Probe.stage("${i+1}:external-$mode-setup")
            val scenario=ActivityScenario.launch(StateAcceptanceActivity::class.java)
            lateinit var a:StateAcceptanceActivity
            scenario.onActivity { a=it }
            try {
                val owner="qa3-d01-external-${UUID.randomUUID()}"
                runBlocking { a.configure(owner,listOf(a.remoteRow(amount=123)),listOf(a.recognition(owner))) }
                await { a.state?.items?.singleOrNull()?.amountMinor==123L }
                await { !keyguard.isKeyguardLocked && device.hasObject(By.pkg(target.packageName).textContains("1.23")) }
                val paused=AtomicBoolean(false)
                val returned=AtomicBoolean(false)
                val stopped=AtomicBoolean(false)
                scenario.onActivity { host ->
                    host.lifecycle.addObserver(LifecycleEventObserver { _,event ->
                        if(event==Lifecycle.Event.ON_PAUSE) {
                            paused.set(true)
                            host.remote.set(host.observation(owner,listOf(host.remoteRow(amount=456))))
                            repeat(100){PaymentReviewSignals.publish()}
                        }
                        if(event==Lifecycle.Event.ON_STOP)stopped.set(true)
                        if(event==Lifecycle.Event.ON_RESUME && paused.get())returned.set(true)
                    })
                }
                D01Probe.stage("${i+1}:external-$mode-wait")
                val ack=File(target.getExternalFilesDir(null),"d01-external-ack-${UUID.randomUUID()}.json")
                D01Probe.write("external-request",JSONObject().put("round",i+1).put("mode",mode)
                    .put("instance",System.identityHashCode(a)).put("nativeInitiallyResumed",true).put("ackFile",ack.name))
                await { ack.isFile }
                if(mode=="screen" && keyguard.isKeyguardLocked) {
                    D01Probe.stage("OWNER_UNLOCK_REQUIRED:${i+1}")
                    val unlockStart=SystemClock.elapsedRealtime()
                    val unlockUntil=unlockStart+90_000
                    while(keyguard.isKeyguardLocked && SystemClock.elapsedRealtime()<unlockUntil)SystemClock.sleep(100)
                    D01Probe.write("owner-unlock-wait",JSONObject().put("round",i+1)
                        .put("durationMs",SystemClock.elapsedRealtime()-unlockStart).put("unlocked",!keyguard.isKeyguardLocked))
                    org.junit.Assume.assumeFalse("BLOCKED_OWNER_UNLOCK; no keyguard bypass",keyguard.isKeyguardLocked)
                }
                D01Probe.stage("${i+1}:external-$mode-functional-resume")
                await { !keyguard.isKeyguardLocked && returned.get() && a.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
                await { a.state?.items?.singleOrNull()?.amountMinor==456L }
                await { device.hasObject(By.pkg(target.packageName).textContains("4.56")) }
                assertEquals(Lifecycle.State.RESUMED,scenario.state)
                D01Probe.write("external-resumed",JSONObject().put("round",i+1).put("mode",mode)
                    .put("instance",System.identityHashCode(a)).put("freshAmount",true)
                    .put("pauseObserved",paused.get()).put("stopObserved",stopped.get()))
            } finally {
                D01Probe.stage("${i+1}:external-$mode-close")
                scenario.close()
                assertEquals(Lifecycle.State.DESTROYED,scenario.state)
            }
            D01Probe.write("round-pass",JSONObject().put("round",i+1).put("mode",mode).put("durationMs",SystemClock.elapsedRealtime()-begin))
        }
        D01Probe.stage("idle")
        D01Probe.write("group-pass",JSONObject().put("mode",mode).put("rounds",rounds))
    }
}
