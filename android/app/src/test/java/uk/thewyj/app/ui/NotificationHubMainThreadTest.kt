package uk.thewyj.app.ui

import android.content.Context
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Real-device crash regression (SM-S9360 / Android 16):
 *
 *   FATAL EXCEPTION: main
 *   java.lang.IllegalStateException: Cannot access database on the main thread
 *     at androidx.room.RoomDatabase.assertNotMainThread
 *
 * The notification hub used to read the pending payment count from Room on the
 * main dispatcher. This test runs the exact refresh path on the main thread with
 * a Room database that forbids main-thread queries, so any regression fails
 * here instead of crashing the app.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationHubMainThreadTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @Test
    fun pendingPaymentRefreshNeverTouchesRoomOnTheMainThread() = runBlocking {
        val state = NotificationHubState(context, "main-thread-account")
        state.refreshPendingPayments()
        state.refresh()
        state.refreshApps()
        state.refreshRules()
    }
}
