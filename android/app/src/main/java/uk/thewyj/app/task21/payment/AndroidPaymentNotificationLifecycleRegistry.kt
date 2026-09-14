package uk.thewyj.app.task21.payment

import android.content.Context
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.NotificationFingerprint
import uk.thewyj.app.task21.PaymentNotificationLifecycleRegistry
import uk.thewyj.app.task21.paymentNotificationSlot

/**
 * Process-resilient notification lifecycle identity for payment recognition.
 *
 * WeChat updates one notification key in place and changes `postTime`. Using
 * that timestamp as identity created a new pending payment for every update.
 * This store persists only a SHA-256 slot digest, a random event id and the last
 * observation time. No title, message, amount, account name or credential is
 * stored. `onNotificationRemoved` deletes the mapping, so a later notification
 * in the same platform slot receives a fresh event id.
 */
class AndroidPaymentNotificationLifecycleRegistry(
    context: Context,
    private val idFactory: () -> String = NotificationFingerprint::stableEventId,
) : PaymentNotificationLifecycleRegistry {
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun eventId(accountId: String, input: NotificationCaptureInput): String = synchronized(LOCK) {
        val slot = paymentNotificationSlot(input) ?: return@synchronized idFactory()
        val key = preferenceKey(accountId, slot)
        val existing = parse(preferences.getString(key, null))
        val eventId = existing?.first ?: idFactory()
        preferences.edit().putString(key, "$eventId$SEPARATOR${System.currentTimeMillis()}").commit()
        trimLocked()
        eventId
    }

    override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
        val slot = paymentNotificationSlot(input) ?: return
        synchronized(LOCK) {
            preferences.edit().remove(preferenceKey(accountId, slot)).commit()
        }
    }

    private fun preferenceKey(accountId: String, slot: String): String =
        "life:" + NotificationFingerprint.sha256Hex("$accountId\u001F$slot")

    private fun parse(value: String?): Pair<String, Long>? {
        if (value.isNullOrBlank()) return null
        val pieces = value.split(SEPARATOR, limit = 2)
        val eventId = pieces.firstOrNull().orEmpty()
        val seenAt = pieces.getOrNull(1)?.toLongOrNull() ?: 0L
        return eventId.takeIf { it.length in 8..80 }?.let { it to seenAt }
    }

    private fun trimLocked() {
        val entries = preferences.all.mapNotNull { (key, value) ->
            if (!key.startsWith("life:")) return@mapNotNull null
            val parsed = parse(value as? String) ?: return@mapNotNull key to 0L
            key to parsed.second
        }.sortedByDescending { it.second }
        if (entries.size <= MAX_ENTRIES) return
        val editor = preferences.edit()
        entries.drop(MAX_ENTRIES).forEach { (key, _) -> editor.remove(key) }
        editor.commit()
    }

    companion object {
        private const val PREFERENCES = "wyj-payment-notification-lifecycles"
        private const val SEPARATOR = "\u001F"
        private const val MAX_ENTRIES = 256
        private val LOCK = Any()
    }
}
