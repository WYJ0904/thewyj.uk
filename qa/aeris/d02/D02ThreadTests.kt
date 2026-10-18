@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package uk.thewyj.app.qa

import android.os.Build
import android.os.SystemClock
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.UUID

private fun baseline() {
    assertEquals("SM-S9360", Build.MODEL)
    assertEquals(36, Build.VERSION.SDK_INT)
    assertEquals("uk.thewyj.app.qa.d02", InstrumentationRegistry.getInstrumentation().targetContext.packageName)
}

private fun poll(condition: () -> Boolean) {
    val end = SystemClock.elapsedRealtime() + 15_000
    while (!condition() && SystemClock.elapsedRealtime() < end) SystemClock.sleep(20)
    assertTrue("D02 condition timeout", condition())
}

class D02OrdinaryTest {
    @Before fun checkBaseline() = baseline()
    @Test fun M01_identicalMinimalRoundTripThirtyTimes() {
        ActivityScenario.launch(D02MinimalActivity::class.java).use { scenario ->
            lateinit var activity: D02MinimalActivity
            scenario.onActivity { activity = it }
            poll { activity.loaded.get() }
            repeat(30) { iteration ->
                scenario.onActivity { it.round = iteration + 1 }
                poll { activity.completed.get() == iteration + 1 }
            }
            assertEquals("Ordinary UI/IO return must stay on UI", 0, activity.errors.get())
            assertEquals(0, activity.offMainCalls.get())
            assertTrue(activity.webCalls.get() >= 120)
        }
    }
}

class D02DefaultComposeMinimalTest {
    @get:Rule val compose = createAndroidComposeRule<D02MinimalActivity>()
    @Before fun checkBaseline() = baseline()
    @Test fun M02_originalDefaultDispatcherThirtyTimes() {
        val activity = compose.activity
        compose.waitUntil(15_000) { activity.loaded.get() }
        repeat(30) { iteration ->
            compose.runOnIdle { activity.round = iteration + 1 }
            compose.waitUntil(15_000) { activity.completed.get() == iteration + 1 }
        }
        // Deliberately retains the real failure assertion in the negative control.
        assertEquals("Default Compose effects must return to WebView owner thread", 0, activity.errors.get())
        assertEquals(0, activity.offMainCalls.get())
    }
}

class D02StandardComposeMinimalTest {
    @get:Rule val compose = createAndroidComposeRule<D02MinimalActivity>(effectContext = StandardTestDispatcher())
    @Before fun checkBaseline() = baseline()
    @Test fun M03_explicitStandardDispatcherThirtyTimes() {
        val activity = compose.activity
        compose.waitUntil(15_000) { activity.loaded.get() }
        repeat(30) { iteration ->
            compose.runOnIdle { activity.round = iteration + 1 }
            compose.waitUntil(15_000) { activity.completed.get() == iteration + 1 }
        }
        assertEquals("Scheduled Compose effects must return to UI", 0, activity.errors.get())
        assertEquals(0, activity.offMainCalls.get())
        assertTrue(activity.webCalls.get() >= 120)
    }
}

class D02DefaultProductTest {
    @get:Rule val compose = createAndroidComposeRule<StateAcceptanceActivity>()
    @Before fun checkBaseline() = baseline()
    @Test fun P01_originalProductUnderDefaultCompose() {
        val activity = compose.activity
        val owner = "qa3-d02-default-" + UUID.randomUUID().toString().take(8)
        runBlocking { activity.configure(owner, listOf(activity.remoteRow()), listOf(activity.recognition(owner))) }
        compose.waitUntil(15_000) { activity.state?.canonicalObserved == true }
        activity.control(org.json.JSONObject().put("caseId", "T01").put("action", "setup").put("owner", owner))
        runBlocking { activity.web("T01") }
        compose.waitForIdle()
        activity.awaitJs("window.QA?.ready===true && window.WYJLocalPaymentLedger?.account_id===window.QA.owner")
    }
}

class D02StandardProductTest {
    @get:Rule val compose = createAndroidComposeRule<StateAcceptanceActivity>(effectContext = StandardTestDispatcher())
    @Before fun checkBaseline() = baseline()
    @Test fun P02_productRoundTripRefreshThirtyTimes() {
        val activity = compose.activity
        val owner = "qa3-d02-standard-" + UUID.randomUUID().toString().take(8)
        runBlocking { activity.configure(owner, listOf(activity.remoteRow()), listOf(activity.recognition(owner))) }
        compose.waitUntil(15_000) { activity.state?.canonicalObserved == true }
        activity.control(org.json.JSONObject().put("caseId", "T01").put("action", "setup").put("owner", owner))
        runBlocking { activity.web("T01") }
        compose.waitUntil(15_000) { activity.webViewOnMain() }
        compose.waitUntil(20_000) {
            activity.eval("Boolean(window.QA?.ready===true && window.WYJLocalPaymentLedger?.account_id===window.QA.owner)") == "true"
        }
        activity.eval("window.D02publications=0;document.addEventListener('thewyj:payment-updated',()=>window.D02publications++)")
        repeat(30) { iteration ->
            val before = activity.eval("Number(window.D02publications)").toInt()
            PaymentSignal.publish()
            compose.waitUntil(20_000) {
                activity.eval("Boolean(window.D02publications>$before && window.WYJLocalPaymentLedger?.account_id===window.QA.owner)") == "true"
            }
            compose.runOnIdle { assertNotNull(activity.webView()?.url) }
            D01Probe.write("d02-product-round", org.json.JSONObject().put("round", iteration + 1)
                .put("publicationBefore", before).put("publicationAfter", activity.eval("Number(window.D02publications)").toInt()))
        }
    }
}

private object PaymentSignal {
    fun publish() = uk.thewyj.app.task21.payment.PaymentReviewSignals.publish()
}

private fun StateAcceptanceActivity.webViewOnMain(): Boolean {
    var found = false
    InstrumentationRegistry.getInstrumentation().runOnMainSync { found = webView() != null }
    return found
}
