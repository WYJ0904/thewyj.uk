package uk.thewyj.app

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.io.File

/** External test APK only. Discard all non-fixture notifications before reading content. */
class FormalNotificationObserver : NotificationListenerService() {
    override fun onListenerConnected() {
        val directory = getExternalFilesDir(null) ?: return
        directory.mkdirs()
        File(directory, "formal-observer-ready").writeText("ready")
    }
    override fun onNotificationPosted(notification: StatusBarNotification) {
        if (notification.packageName != "uk.thewyj.app") return
        val directory = getExternalFilesDir(null) ?: return
        val allowed = runCatching { File(directory, "formal-notification-ids").readLines().mapNotNull(String::toIntOrNull).toSet() }.getOrDefault(emptySet())
        if (notification.id !in allowed) return
        val entry = JSONObject().put("id", notification.id).put("post_time", notification.postTime)
            .put("title", notification.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty())
            .put("body", notification.notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty())
        synchronized(this) { File(directory, "formal-fixture-notifications.jsonl").appendText(entry.toString() + "\n") }
    }
}
