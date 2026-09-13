package uk.thewyj.app.ui

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomNotificationStore

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

    @Test
    fun notificationHistoryLoadsInBoundedWindowsInsteadOfComposingEveryRevision() = runBlocking {
        val account = "history-window-account"
        withContext(Dispatchers.IO) {
            val store = RoomNotificationStore(NotificationDatabase.get(context))
            repeat(121) { index ->
                store.record(
                    account,
                    NotificationCapture(
                        sourcePackage = "com.example.messages",
                        sourceType = "notification",
                        notificationKey = "message-$index",
                        notificationId = index + 1,
                        tag = "",
                        groupKey = "",
                        channelId = "messages",
                        postTime = 1_000L + index,
                        isGroup = false,
                        isGroupSummary = false,
                        title = "Message $index",
                        text = "Body $index",
                        bigText = "",
                        subText = "",
                    ),
                    now = 1_000L + index,
                )
            }
        }

        val state = NotificationHubState(context, account)
        state.refresh()
        assertEquals(NotificationHubState.HISTORY_PAGE_SIZE, state.items.size)
        assertTrue(state.hasMore)
        state.loadMore()
        assertEquals(NotificationHubState.HISTORY_PAGE_SIZE * 2, state.items.size)
        assertTrue(state.hasMore)
        state.loadMore()
        assertEquals(121, state.items.size)
        assertFalse(state.hasMore)
    }
}
