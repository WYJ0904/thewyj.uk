package uk.thewyj.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationHistorySourceLabelTest {
    @Test fun mediaStoreScreenshotUsesScreenshotSemanticLabel() {
        assertEquals("屏幕截图", notificationHistorySourceLabel("media_store", "系统界面"))
        assertEquals("屏幕截图", notificationHistorySourceLabel("media_store+notification", "智能截屏"))
    }

    @Test fun ordinaryNotificationKeepsResolvedApplicationLabel() {
        assertEquals("微信", notificationHistorySourceLabel("message_image", "微信"))
        assertEquals("系统界面", notificationHistorySourceLabel("notification", "系统界面"))
    }
}
