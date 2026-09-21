package uk.thewyj.app.task21

/**
 * Drops duplicate callbacks for the exact same platform snapshot.
 *
 * Samsung can deliver one StatusBarNotification twice to the same listener.
 * Room already rejects the duplicate revision, but payment parsing and queue
 * reconciliation were still performed twice. The gate keys the platform
 * identity, post time and hashed content/media evidence; no notification text
 * is retained.
 */
class NotificationCallbackGate(
    private val duplicateWindowMs: Long = 5_000L,
    private val maxEntries: Int = 512,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val seen = LinkedHashMap<String, Long>()

    fun shouldProcess(input: NotificationCaptureInput): Boolean {
        val identity = input.notificationKey.ifBlank {
            "${input.sourcePackage}|${input.notificationId}|${input.tag}"
        }
        val contentDigest = NotificationFingerprint.sha256Hex(
            listOf(
                input.sourcePackage, input.title, input.text, input.bigText, input.subText,
                input.infoText, input.summaryText, input.textLines.joinToString("\u001E"),
            ).joinToString("\u001F"),
        )
        val key = NotificationFingerprint.sha256Hex(
            "$identity\u001F${input.postTime}\u001F$contentDigest\u001F${input.mediaFingerprint}\u001F${input.mediaState}",
        )
        val observedAt = now()
        synchronized(seen) {
            val previous = seen[key]
            seen[key] = observedAt
            while (seen.size > maxEntries) {
                val oldest = seen.keys.firstOrNull() ?: break
                seen.remove(oldest)
            }
            return previous == null || observedAt - previous > duplicateWindowMs
        }
    }
}
