package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork

/**
 * Task 24.3 audit: offline capture must actually retry.
 *
 * Real sequence: payment notification arrives while the phone is offline, the
 * ingest upload fails, and nothing retries it until another notification
 * arrives or the user opens the archive screen. Opening the app with an empty
 * shade replayed nothing, so "amount identified" stayed out of Finance.
 *
 * Both recovery triggers are verified here:
 *   - the network becoming available again while the listener process is alive;
 *   - the listener reconnecting (cold start / rebind), even with an empty shade.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationListenerRetryTriggerTest {
    @Test fun networkAvailableRetriesThePendingIngestQueue() {
        val service = Robolectric.buildService(ThewyjNotificationListenerService::class.java).create().get()
        var flushes = 0
        service.pendingFlushOverride = { flushes += 1 }

        service.networkRetryCallback.onAvailable(ShadowNetwork.newInstance(1))

        assertEquals("a reconnect must drain the pending queue", 1, flushes)
    }

    @Test fun listenerReconnectRetriesThePendingIngestQueueEvenWithAnEmptyShade() {
        val service = Robolectric.buildService(ThewyjNotificationListenerService::class.java).create().get()
        var flushes = 0
        service.pendingFlushOverride = { flushes += 1 }

        service.onListenerConnected()

        assertTrue("listener connect must drain the pending queue", flushes >= 1)
    }
}
