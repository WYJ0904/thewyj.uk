package uk.thewyj.app.task21.payment

import android.view.accessibility.AccessibilityEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Real-device regression (SM-S9360 / Android 16):
 *
 *   I/ThewyjAccessibility: accessibility-parser result=no_active_ticket lines=0
 *
 * The service performed a synchronous Room query for every accessibility event
 * on the main thread. Room threw
 * `IllegalStateException: Cannot access database on the main thread`, the
 * exception was swallowed by `runCatching`, and the user-visible result was that
 * the Accessibility feature never verified anything.
 *
 * This test drives the main-thread entry point with a SystemUI event and proves
 * that no page read and no parser run happen: the event is rejected by the
 * in-memory ticket gate before any database or node-tree work.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentAccessibilityServiceGateTest {
    @Test fun noiseEventIsSkippedBeforeAnyPageRead() {
        val service = Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create().get()
        val before = PaymentAccessibilityStatus.lastParserResult
        val event = AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED).apply {
            packageName = "com.android.systemui"
            className = "android.widget.FrameLayout"
        }

        service.onAccessibilityEvent(event)

        assertEquals("no_active_ticket", PaymentAccessibilityStatus.lastSkipped)
        assertEquals("the gate must not read any page text", 0, PaymentAccessibilityStatus.lastTextLineCount)
        assertEquals("no parser result may be produced for a package without a ticket", before, PaymentAccessibilityStatus.lastParserResult)
    }

    @Test fun ownPackageIsIgnoredEntirely() {
        val service = Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create().get()
        val event = AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply {
            packageName = "uk.thewyj.app"
            className = "uk.thewyj.app.MainActivity"
        }
        service.onAccessibilityEvent(event)
        assertTrue(PaymentAccessibilityStatus.lastTextLineCount >= 0)
        assertEquals(0, PaymentAccessibilityStatus.lastTextLineCount)
    }

    /**
     * A destroyed service instance must not leave the auditable status behind
     * claiming `connected=true`, otherwise the capability banner keeps showing
     * "无障碍已连接" for a service that no longer exists.
     */
    @Test fun destroyedServiceNeverLeavesAConnectedClaim() {
        val controller = Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create()
        PaymentAccessibilityStatus.onConnected()
        assertTrue(PaymentAccessibilityStatus.connected)

        controller.destroy()

        assertFalse(PaymentAccessibilityStatus.connected)
    }
}
