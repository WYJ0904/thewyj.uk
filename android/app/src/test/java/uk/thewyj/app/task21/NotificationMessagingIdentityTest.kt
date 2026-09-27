package uk.thewyj.app.task21

import android.app.Notification
import android.os.Bundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationMessagingIdentityTest {
    @Test fun repostOfOneMessageKeepsIdentityAcrossTextAndNotificationChanges() {
        val first = extras("支付提醒", 1_000L)
        val update = extras("支付成功 ¥0.01", 1_000L)
        assertEquals(
            NotificationMessagingIdentity.fromExtras(first, "com.tencent.mm", "conversation-a"),
            NotificationMessagingIdentity.fromExtras(update, "com.tencent.mm", "conversation-a"),
        )
        assertNotEquals(
            NotificationMessagingIdentity.fromExtras(first, "com.tencent.mm", "conversation-a"),
            NotificationMessagingIdentity.fromExtras(extras("支付成功 ¥0.01", 2_000L),
                "com.tencent.mm", "conversation-a"),
        )
    }

    private fun extras(text: String, timestamp: Long) = Bundle().apply {
        putParcelableArray(Notification.EXTRA_MESSAGES, arrayOf(Bundle().apply {
            putCharSequence("text", text)
            putString("sender", "微信支付")
            putLong("time", timestamp)
        }))
    }
}
