package uk.thewyj.app.task21

import android.app.Notification
import android.app.Person
import android.os.Bundle
import android.os.Parcelable

/** A message timestamp and sender inside one conversation are lifecycle evidence. */
object NotificationMessagingIdentity {
    fun fromExtras(extras: Bundle?, sourcePackage: String, conversationKey: String): String {
        if (extras == null || sourcePackage.isBlank()) return ""
        val array = runCatching {
            @Suppress("DEPRECATION")
            extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        }.getOrNull()
        val messages = array?.mapNotNull { it as? Bundle }.orEmpty().ifEmpty {
            runCatching {
                @Suppress("DEPRECATION")
                extras.getParcelableArrayList<Parcelable>(Notification.EXTRA_MESSAGES)
                    ?.mapNotNull { it as? Bundle }
            }.getOrNull().orEmpty()
        }
        val latest = messages.maxByOrNull { it.getLong("time", 0L) } ?: return ""
        val timestamp = latest.getLong("time", 0L)
        if (timestamp <= 0L) return ""
        val person = runCatching {
            @Suppress("DEPRECATION")
            latest.getParcelable("sender_person") as? Person
        }.getOrNull()
        val sender = person?.key.orEmpty().ifBlank { person?.name?.toString().orEmpty() }
            .ifBlank { latest.getString("sender").orEmpty() }
        val conversation = conversationKey.ifBlank {
            extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString().orEmpty()
        }
        if (conversation.isBlank() && sender.isBlank()) return ""
        return NotificationFingerprint.sha256Hex(
            "$sourcePackage\u001F$conversation\u001F$sender\u001F$timestamp",
        )
    }
}
