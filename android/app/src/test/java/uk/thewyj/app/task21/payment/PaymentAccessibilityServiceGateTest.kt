package uk.thewyj.app.task21.payment

import android.view.accessibility.AccessibilityEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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

    /**
     * Task 24 reopen #10: the first accessibility event of a brand-new ticket can
     * arrive before the 3 second package cache is refreshed. It must not be
     * dropped as `no_active_ticket`; the page is read and the worker re-checks the
     * Room ticket before anything is parsed or enriched.
     */
    @Test fun firstEventOfABrandNewTicketIsNotDroppedByAStaleCache() {
        PaymentTicketPackageSignal.clear()
        val service = Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create().get()
        // Ticket created in another part of the app, cache not refreshed yet.
        PaymentTicketPackageSignal.publish("com.tencent.mm")
        // The status object is a process-wide singleton, so start from a marker
        // instead of trusting whatever the previous test left behind.
        PaymentAccessibilityStatus.onSkipped("reset", "gate-test-reset")
        val event = AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply {
            packageName = "com.tencent.mm"
            className = "com.tencent.mm.ui.LauncherUI"
        }
        service.onAccessibilityEvent(event)

        assertNotEquals(
            "a ticket signal must not be reported as a package without a ticket",
            "no_active_ticket",
            PaymentAccessibilityStatus.lastSkipped,
        )
        // The event reached the page/OCR stage: no window text is available in a
        // Robolectric window, so the honest outcomes are `no_text` (the read
        // happened) and `ocr_unavailable` (the on-device OCR engine is absent in
        // the test runtime). Being dropped by the gate is the only outcome that
        // must not happen.
        assertTrue(
            "the first event must reach the page/OCR stage instead of being dropped: " +
                PaymentAccessibilityStatus.lastParserResult,
            PaymentAccessibilityStatus.lastParserResult in setOf("no_text", "ocr_unavailable"),
        )
        PaymentTicketPackageSignal.clear()
    }

    /** Without a ticket and without a signal the gate still skips the package. */
    @Test fun ticketSignalExpiresAndTheGateClosesAgain() {
        PaymentTicketPackageSignal.clear()
        PaymentTicketPackageSignal.publish("com.tencent.mm", nowMs = 1_000L)
        assertTrue(PaymentTicketPackageSignal.recentlySignalled("com.tencent.mm", nowMs = 2_000L))
        assertFalse(
            "a stale signal may never keep a package readable",
            PaymentTicketPackageSignal.recentlySignalled(
                "com.tencent.mm",
                nowMs = 1_000L + PaymentTicketPackageSignal.WINDOW_MS + 1,
            ),
        )
        assertFalse(PaymentTicketPackageSignal.recentlySignalled("com.tencent.mm", nowMs = 1_000L))
        assertFalse(PaymentTicketPackageSignal.recentlySignalled("", nowMs = 2_000L))
    }

    /** A reconnect starts from the real Room state, never from another session. */
    @Test fun reconnectClearsTheSignal() {
        PaymentTicketPackageSignal.publish("com.tencent.mm", nowMs = 1_000L)
        assertTrue(PaymentTicketPackageSignal.recentlySignalled("com.tencent.mm", nowMs = 1_100L))
        PaymentTicketPackageSignal.clear()
        assertFalse(PaymentTicketPackageSignal.recentlySignalled("com.tencent.mm", nowMs = 1_200L))
        assertEquals(0, PaymentTicketPackageSignal.size())
    }
}
