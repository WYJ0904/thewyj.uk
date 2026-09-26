package uk.thewyj.app.task21.payment

import android.content.Context
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.NotificationFingerprint
import uk.thewyj.app.task21.PaymentNotificationLifecycleRegistry
import uk.thewyj.app.task21.PaymentLifecycleProof
import uk.thewyj.app.task21.paymentLifecycleProof
import uk.thewyj.app.task21.paymentNotificationSlot

/**
 * Process-resilient notification lifecycle identity for payment recognition.
 *
 * WeChat updates one notification key in place and changes `postTime`. Using
 * that timestamp as identity created a new pending payment for every update.
 * This store persists only hashed slot/structured evidence and a random event
 * id. Raw title, message, account name and credentials are never stored.
 */
class AndroidPaymentNotificationLifecycleRegistry(
    context: Context,
    private val now: () -> Long = System::currentTimeMillis,
    private val idFactory: () -> String = NotificationFingerprint::stableEventId,
) : PaymentNotificationLifecycleRegistry {
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun eventId(accountId: String, input: NotificationCaptureInput, payment: uk.thewyj.app.task21.PaymentIngestOutcome?): String = synchronized(LOCK) {
        val proof = paymentLifecycleProof(input, payment)
        val primary = paymentNotificationSlot(input)?.let { preferenceKey(accountId, it) }
        val fallback = fallbackSlot(input)?.let { preferenceKey(accountId, it) }
        val reference = proof.referenceHash.takeIf(String::isNotBlank)
            ?.let { preferenceKey(accountId, "reference:$it") }
        val message = proof.messageHash.takeIf(String::isNotBlank)
            ?.let { preferenceKey(accountId, "message:$it") }
        val keys = listOfNotNull(reference, message, primary, fallback).distinct()
        if (keys.isEmpty()) return@synchronized idFactory()
        val now = now()
        val incompleteEvidence = payment?.let {
            NotificationFingerprint.sha256Hex(
                "${input.sourcePackage}\u001F${it.paymentChannel}\u001Fincomplete",
            )
        }.orEmpty()
        val existing = keys.firstNotNullOfOrNull { key ->
            parse(preferences.getString(key, null))?.takeIf { old ->
                val prior = old.proof()
                val compatible = proof.compatible(prior)
                val sameReference = reference == key && proof.referenceHash.isNotBlank() &&
                    proof.referenceHash == prior.referenceHash
                val sameMessage = message == key && proof.messageHash.isNotBlank() &&
                    proof.messageHash == prior.messageHash
                val conflict = proof.conflictingReference(prior) ||
                    (!sameReference && proof.conflictingMessage(prior))
                val promotion = compatible && proof.enriches(prior) &&
                    (prior.amountHash.isNotBlank() || prior.direction.isNotBlank() ||
                        (incompleteEvidence.isNotBlank() && old.evidence == incompleteEvidence))
                val activeIncompleteContinuation = compatible && old.removedAt == 0L &&
                    now - old.seenAt in 0L..ACTIVE_CONTINUITY_MS &&
                    prior.channelHash.isNotBlank() && proof.channelHash.isNotBlank() &&
                    (prior.amountHash.isBlank() || prior.direction.isBlank())
                when {
                    sameReference && compatible -> true
                    sameMessage && compatible && !proof.conflictingReference(prior) -> true
                    key == primary && !conflict && old.removedAt == 0L ->
                        old.evidence == proof.evidence || promotion || activeIncompleteContinuation
                    key == primary && !conflict && now - old.removedAt in 0L..REPOST_GRACE_MS ->
                        (old.postTime > 0L && old.postTime == input.postTime && old.evidence == proof.evidence) || promotion
                    key == fallback && !conflict && now - old.seenAt in 0L..REPOST_GRACE_MS -> promotion
                    else -> false
                }
            }
        }
        val eventId = existing?.eventId ?: idFactory()
        val prior = existing?.proof()
        val entry = Entry(eventId, now, proof.evidence, 0L,
            proof.amountHash.ifBlank { prior?.amountHash.orEmpty() },
            proof.direction.ifBlank { prior?.direction.orEmpty() },
            proof.channelHash.ifBlank { prior?.channelHash.orEmpty() },
            proof.referenceHash.ifBlank { prior?.referenceHash.orEmpty() },
            proof.messageHash.ifBlank { prior?.messageHash.orEmpty() }, input.postTime)
        val editor = preferences.edit()
        if (existing != null) {
            preferences.all.forEach { (aliasKey, value) ->
                if (aliasKey.startsWith("life:") && parse(value as? String)?.eventId == eventId) {
                    editor.putString(aliasKey, encode(entry))
                }
            }
        }
        keys.forEach { editor.putString(it, encode(entry)) }
        editor.commit()
        trimLocked()
        eventId
    }

    override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
        val slot = paymentNotificationSlot(input) ?: return
        synchronized(LOCK) {
            val key = preferenceKey(accountId, slot)
            val existing = parse(preferences.getString(key, null)) ?: return@synchronized
            val removed = now()
            val editor = preferences.edit()
            preferences.all.forEach { (aliasKey, value) ->
                if (!aliasKey.startsWith("life:")) return@forEach
                val alias = parse(value as? String) ?: return@forEach
                if (alias.eventId == existing.eventId) {
                    editor.putString(aliasKey, encode(alias.copy(seenAt = removed, removedAt = removed)))
                }
            }
            editor.commit()
        }
    }

    private fun preferenceKey(accountId: String, slot: String): String =
        "life:" + NotificationFingerprint.sha256Hex("$accountId\u001F$slot")

    private fun fallbackSlot(input: NotificationCaptureInput): String? =
        if (input.notificationId != 0 || input.tag.isNotBlank())
            "slot:${input.sourcePackage}|${input.notificationId}|${input.tag}" else null

    private data class Entry(
        val eventId: String, val seenAt: Long, val evidence: String, val removedAt: Long,
        val amountHash: String = "", val direction: String = "", val channelHash: String = "",
        val referenceHash: String = "", val messageHash: String = "", val postTime: Long = 0L,
    ) {
        fun proof() = PaymentLifecycleProof(evidence, amountHash, direction, channelHash, referenceHash, messageHash)
    }

    private fun encode(entry: Entry): String =
        listOf(entry.eventId, entry.seenAt, entry.evidence, entry.removedAt, entry.amountHash,
            entry.direction, entry.channelHash, entry.referenceHash, entry.messageHash, entry.postTime)
            .joinToString(SEPARATOR)

    private fun parse(value: String?): Entry? {
        if (value.isNullOrBlank()) return null
        val pieces = value.split(SEPARATOR, limit = 10)
        val eventId = pieces.firstOrNull().orEmpty()
        val seenAt = pieces.getOrNull(1)?.toLongOrNull() ?: 0L
        val evidence = pieces.getOrNull(2).orEmpty()
        val removedAt = pieces.getOrNull(3)?.toLongOrNull() ?: 0L
        return eventId.takeIf { it.length in 8..80 }?.let {
            Entry(it, seenAt, evidence, removedAt, pieces.getOrNull(4).orEmpty(),
                pieces.getOrNull(5).orEmpty(), pieces.getOrNull(6).orEmpty(),
                pieces.getOrNull(7).orEmpty(), pieces.getOrNull(8).orEmpty(),
                pieces.getOrNull(9)?.toLongOrNull() ?: 0L)
        }
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
        internal const val ACTIVE_CONTINUITY_MS = 15_000L
        private val LOCK = Any()
    }
}
