package uk.thewyj.app.qa

import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test

/** Re-executes the unchanged original assertions and teardown in one continuous process. */
class D01RegressionTest {
    private fun repeatOriginal(id:String,run:(StateDeviceAcceptanceTest)->Unit) {
        val rounds=InstrumentationRegistry.getArguments().getString("rounds","30")!!.toInt()
        D01Probe.samplingMode=InstrumentationRegistry.getArguments().getString("sampleMode","off")!!
        D01Probe.write("group-start",JSONObject().put("mode",id).put("rounds",rounds))
        repeat(rounds) { i ->
            val at=SystemClock.elapsedRealtime()
            val original=StateDeviceAcceptanceTest()
            D01Probe.stage("${i+1}:$id-setup")
            original.baseline()
            try {
                D01Probe.stage("${i+1}:$id-original-assertions")
                run(original)
            } finally {
                D01Probe.stage("${i+1}:$id-original-teardown")
                original.close()
            }
            D01Probe.write("round-pass",JSONObject().put("round",i+1).put("mode",id).put("durationMs",SystemClock.elapsedRealtime()-at))
        }
        D01Probe.stage("idle")
        D01Probe.write("group-pass",JSONObject().put("mode",id).put("rounds",rounds))
    }
    @Test fun R11_originalT11ThirtyTimes()=repeatOriginal("T11"){it.T11_activityBackgroundResumeReadsFreshState()}
    @Test fun R15_originalT15ThirtyTimes()=repeatOriginal("T15"){it.T15_amountOnlyChangeWhileNoSubscriberIsObservedOnReturn()}
    @Test fun R16_originalT16ThirtyTimes()=repeatOriginal("T16"){it.T16_historicalReceiptDoesNotInsertDeletedRow()}
}
