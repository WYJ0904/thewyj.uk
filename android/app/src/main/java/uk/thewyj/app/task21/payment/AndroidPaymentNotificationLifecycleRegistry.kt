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
 * stored. Removal leaves a short tombstone: an identical immediate repost keeps
 * the id, while changed evidence or a later lifecycle receives a fresh id.
 */
class AndroidPaymentNotificationLifecycleRegistry(
    context: Context,
    private val now: () -> Long = System::currentTimeMillis,
    private val idFactory: () -> String = NotificationFingerprint::stableEventId,
) : PaymentNotificationLifecycleRegistry {
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun eventId(accountId: String, input: NotificationCaptureInput, payment: uk.thewyj.app.task21.PaymentIngestOutcome?): String = synchronized(LOCK) {
        val slot = paymentNotificationSlot(input) ?: return@synchronized idFactory()
        val key = preferenceKey(accountId, slot)
        val existing = parse(preferences.getString(key, null))
        val now = now()
        val evidence = uk.thewyj.app.task21.paymentNotificationEvidence(input, payment)
        val incompleteEvidence = payment?.let {
            NotificationFingerprint.sha256Hex(
                "${input.sourcePackage}\u001F${it.paymentChannel}\u001Fincomplete",
            )
        }.orEmpty()
        val activePromotion = existing != null &&
            existing.removedAt == 0L &&
            incompleteEvidence.isNotBlank() &&
            existing.evidence == incompleteEvidence &&
            evidence != incompleteEvidence
        val reuse = existing != null && when {
            existing.removedAt == 0L ->
                existing.evidence.isBlank() || existing.evidence == evidence || activePromotion
            now - existing.removedAt <= REPOST_GRACE_MS ->
                existing.evidence.isBlank() || existing.evidence == evidence
            else -> false
        }
        val eventId = if (reuse) existing!!.eventId else idFactory()
        preferences.edit().putString(key, encode(Entry(eventId, now, evidence, 0L))).commit()
        trimLocked()
        eventId
    }

    override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
        val slot = paymentNotificationSlot(input) ?: return
        synchronized(LOCK) {
            val key = preferenceKey(accountId, slot)
            val existing = parse(preferences.getString(key, null)) ?: return@synchronized
            preferences.edit().putString(
                key,
                now().let { removed -> encode(existing.copy(seenAt = removed, removedAt = removed)) },
            ).commit()
        }
    }

    private fun preferenceKey(accountId: String, slot: String): String =
        "life:" + NotificationFingerprint.sha256Hex("$accountId\u001F$slot")

    private data class Entry(val eventId: String, val seenAt: Long, val evidence: String, val removedAt: Long)

    private fun encode(entry: Entry): String =
        listOf(entry.eventId, entry.seenAt, entry.evidence, entry.removedAt).joinToString(SEPARATOR)

    private fun parse(value: String?): Entry? {
        if (value.isNullOrBlank()) return null
        val pieces = value.split(SEPARATOR, limit = 4)
        val eventId = pieces.firstOrNull().orEmpty()
        val seenAt = pieces.getOrNull(1)?.toLongOrNull() ?: 0L
        val evidence = pieces.getOrNull(2).orEmpty()
        val removedAt = pieces.getOrNull(3)?.toLongOrNull() ?: 0L
        return eventId.takeIf { it.length in 8..80 }?.let { Entry(it, seenAt, evidence, removedAt) }
    }

    private fun trimLocked() {
        val entries = preferences.all.mapNotNull { (key, value) ->
            if (!key.startsWith("life:")) return@mapNotNull null
            val parsed = parse(value as? String) ?: return@mapNotNull key to 0L
            key to parsed.seenAt
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
        internal const val REPOST_GRACE_MS = 10_000L
        private val LOCK = Any()
    }
}
