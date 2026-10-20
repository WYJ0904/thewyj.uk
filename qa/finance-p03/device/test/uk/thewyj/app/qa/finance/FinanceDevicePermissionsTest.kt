package uk.thewyj.app.qa.finance
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.MainActivity
import uk.thewyj.app.task21.payment.PaymentAccessibilityStatus
@RunWith(AndroidJUnit4::class)
class FinanceDevicePermissionsTest {
    @Test fun actualOwnedAccessibilityConnectionWithPrivateSourcesExcluded(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        ActivityScenario.launch<MainActivity>(Intent(c,MainActivity::class.java).setData(Uri.parse("thewyj://app?route=%2Ffinance"))).use{s->
            val end=android.os.SystemClock.elapsedRealtime()+10000
            while(!PaymentAccessibilityStatus.connected&&android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(100)
            assertTrue("Normal QA accessibility grant and actual binding required",PaymentAccessibilityStatus.connected)
            s.onActivity{it.window.decorView.sendAccessibilityEvent(android.view.accessibility.AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)}
            assertEquals(0L,PaymentAccessibilityStatus.screenshotCount)
            FinanceDeviceSupport.record(c,"DEVICE-A11Y-CONNECTION",JSONObject().put("actually_connected",true).put("screenshot_count",0).put("scope","own QA windows only; real payment UI enrichment NOT TESTED"))
        }
    }
}
@RunWith(AndroidJUnit4::class)
class FinanceDeviceCleanupTest {
    @Test fun leaveQaCaptureDisabledAndRemoveOnlyKnownSyntheticNotifications(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        FinanceDeviceGate.cleanup(c);assertFalse(FinanceDeviceGate.enabled(c))
        FinanceDeviceSupport.record(c,"DEVICE-CLEANUP",JSONObject().put("qa_capture_enabled",false).put("formal_permissions_changed_by_test",false))
    }
}
