package uk.thewyj.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationHistorySourceLabelTest {
    @Test fun mediaStoreScreenshotUsesScreenshotSemanticLabel() {
        assertEquals(
            "屏幕截图",
            notificationHistorySourceLabel(
                mediaOrigin = "media_store",
                sourcePackage = "com.android.systemui",
                title = "Screenshot_20260921.png",
                text = "",
                resolvedAppLabel = "系统界面",
            ),
        )
        assertEquals(
            "屏幕截图",
            notificationHistorySourceLabel(
                mediaOrigin = "media_store+notification",
                sourcePackage = "com.samsung.android.app.smartcapture",
                title = "截图已保存",
                text = "",
                resolvedAppLabel = "智能截屏",
            ),
        )
    }

    @Test fun screenshotNotificationFromSystemUiAlsoUsesScreenshotSemanticLabel() {
        assertEquals(
            "屏幕截图",
            notificationHistorySourceLabel(
                mediaOrigin = "notification",
                sourcePackage = "com.android.systemui",
                title = "屏幕截图已保存",
                text = "点击此处查看您的屏幕截图",
                resolvedAppLabel = "系统界面",
            ),
        )
    }

    @Test fun ordinarySystemUiNotificationKeepsResolvedApplicationLabel() {
        assertEquals(
            "系统界面",
            notificationHistorySourceLabel(
                mediaOrigin = "notification",
                sourcePackage = "com.android.systemui",
                title = "充电完成",
                text = "",
                resolvedAppLabel = "系统界面",
            ),
        )
    }

    @Test fun ordinaryNotificationKeepsResolvedApplicationLabel() {
        assertEquals(
            "微信",
            notificationHistorySourceLabel(
                mediaOrigin = "message_image",
                sourcePackage = "com.tencent.mm",
                title = "联系人",
                text = "图片",
                resolvedAppLabel = "微信",
            ),
        )
    }

    @Test fun ordinaryChatGptMediaStoreNotificationKeepsItsApplicationLabel() {
        assertEquals(
            "ChatGPT",
            notificationHistorySourceLabel(
                mediaOrigin = "media_store",
                sourcePackage = "com.openai.chatgpt",
                title = "给Codex修复问题",
                text = "普通文字通知",
                resolvedAppLabel = "ChatGPT",
            ),
        )
    }

    @Test fun ordinaryWechatImageNotificationKeepsItsApplicationLabel() {
        assertEquals(
            "微信",
            notificationHistorySourceLabel(
                mediaOrigin = "media_store+notification",
                sourcePackage = "com.tencent.mm",
                title = "联系人",
                text = "[图片]",
                resolvedAppLabel = "微信",
            ),
        )
    }
}
