package uk.thewyj.app.task21

import java.util.Locale

/**
 * Notification Classification Layer (Task 24.1).
 *
 * The archive and the payment recognition engine consume the same raw Android
 * event, but they must not share one decision: a Clash traffic update is a real
 * notification in the shade and useless history in the archive, while a WeChat
 * payment notification must still reach the payment pipeline even when the user
 * has no notification-archive entitlement.
 *
 * This layer only decides what the *archive* does. It never blocks the payment
 * pipeline.
 */
enum class NotificationClass {
    /** A normal notification a person would expect to find again. */
    MESSAGE,

    /** `FLAG_ONGOING_EVENT` / foreground service status (Clash, VPN, sync). */
    ONGOING,

    /** Download or upload progress. */
    PROGRESS,

    /** High-frequency live values (speed, percentage, signal, battery). */
    LIVE,

    /** Group summary container of other notifications. */
    GROUP_SUMMARY,
}

data class NotificationClassification(
    val kind: NotificationClass,
    val storeInArchive: Boolean,
    val reason: String,
)

data class NotificationClassificationInput(
    val sourcePackage: String,
    val channelId: String = "",
    val title: String = "",
    val text: String = "",
    val bigText: String = "",
    val subText: String = "",
    val isOngoing: Boolean = false,
    val isForegroundService: Boolean = false,
    val isGroupSummary: Boolean = false,
    /** The notification carried a picture/thumbnail Android exposed to us. */
    val hasMedia: Boolean = false,
    val identityKey: String = "",
    val occurredAtMs: Long = 0L,
)

/**
 * Real-device evidence: `com.github.metacubex.clash.meta` reposts its status
 * notification every second (`clash_status_channel`), which used to commit a new
 * Room revision - and therefore a UI refresh - every time.
 */
object NotificationClassifier {
    /** Packages that only ever produce continuous status, never messages. */
    private val LIVE_PACKAGES = setOf(
        "com.github.metacubex.clash.meta",
        "com.github.metacubex.clash",
        "com.github.kr328.clash",
        "com.wireguard.android",
        "org.amnezia.vpn",
        "de.blinkt.openvpn",
        "com.guardianproject.orfox",
    )

    /** Package-name fragments of VPN / proxy / traffic tools. */
    private val LIVE_PACKAGE_MARKERS = listOf("clash", "v2ray", "xray", "shadowsocks", "sing-box", "wireguard", "openvpn")

    /** Channel fragments used by progress and status notifications. */
    /**
     * Only genuinely continuous channels are listed here. The earlier list also
     * contained generic words like "status", "media" and "sync", which matched
     * Samsung screenshot/media channels and made a real notification disappear
     * from history entirely (real-device P0-1).
     */
    private val LIVE_CHANNEL_MARKERS = listOf(
        // Deliberately narrow: "status"/"media"/"sync"/"download" also appear on
        // perfectly normal notifications (a screenshot channel is often
        // "*_status"), and dropping those loses real history.
        "progress", "speed", "traffic", "vpn", "proxy",
    )

    /** A person reading a chat message rarely repeats the identical shape within this window. */
    private const val LIVE_WINDOW_MS = 45_000L

    private val coalescer = NotificationLiveCoalescer(windowMs = LIVE_WINDOW_MS)

    fun classify(input: NotificationClassificationInput): NotificationClassification {
        val packageName = input.sourcePackage.lowercase(Locale.ROOT)
        // A notification that carries a picture is user content, never a live
        // readout: a screenshot/media notification must be archived even when its
        // channel or package looks like a status channel.
        if (input.hasMedia) {
            return NotificationClassification(NotificationClass.MESSAGE, true, "media_content")
        }
        if (input.isGroupSummary) {
            return NotificationClassification(NotificationClass.GROUP_SUMMARY, true, "group_summary")
        }
        if (input.isProgressLike()) {
            return NotificationClassification(NotificationClass.PROGRESS, false, "progress")
        }
        if (input.isOngoing || input.isForegroundService || isLivePackage(packageName) || channelLooksLive(input.channelId)) {
            // Ongoing content still matters while it is the *only* thing that
            // changed for this identity inside a short window: a live speed
            // readout must not become one history row per second.
            return if (input.text.isBlank() && input.title.isBlank()) {
                NotificationClassification(NotificationClass.ONGOING, false, "ongoing_empty")
            } else {
                NotificationClassification(
                    if (input.isProgressLike()) NotificationClass.PROGRESS else NotificationClass.ONGOING,
                    false,
                    if (input.isOngoing) "ongoing_flag" else "live_source",
                )
            }
        }
        // Second layer: some apps never set the flag. Identical identity whose
        // text only changes in digits/units within a short window is a live
        // readout, not a new message. Real content changes are always stored.
        if (coalescer.isNumericChurn(
                identityKey = input.identityKey,
                title = input.title,
                text = input.text.ifBlank { input.bigText }.ifBlank { input.subText },
                occurredAtMs = input.occurredAtMs,
            )
        ) {
            return NotificationClassification(NotificationClass.LIVE, false, "numeric_churn")
        }
        return NotificationClassification(NotificationClass.MESSAGE, true, "message")
    }

    private fun isLivePackage(packageName: String): Boolean =
        LIVE_PACKAGES.contains(packageName) || LIVE_PACKAGE_MARKERS.any { packageName.contains(it) }

    private fun channelLooksLive(channelId: String): Boolean {
        val channel = channelId.lowercase(Locale.ROOT)
        if (channel.isBlank()) return false
        return LIVE_CHANNEL_MARKERS.any { channel.contains(it) }
    }

    private fun NotificationClassificationInput.isProgressLike(): Boolean {
        val haystack = (title + " " + text + " " + bigText).lowercase(Locale.ROOT)
        if (!haystack.contains('%')) {
            val hasProgressWord = listOf("下载", "上传", "download", "upload", "更新中", "installing", "正在下载")
                .any { haystack.contains(it) }
            if (!hasProgressWord) return false
        }
        if (haystack.contains('%')) {
            val numeric = Regex("""\d{1,3}\s*%""").containsMatchIn(haystack)
            val progressWord = listOf("下载", "上传", "download", "upload", "更新", "install", "复制", "copy", "处理")
                .any { haystack.contains(it) }
            if (numeric && progressWord) return true
        }
        return listOf("下载", "upload", "download").any { haystack.contains(it) } &&
            Regex("""\d+(\.\d+)?\s*(kb|mb|gb)/s""").containsMatchIn(haystack)
    }
}

/**
 * Small, bounded memory of the last archived shape per identity. It exists to
 * catch apps that repost the same status text with new numbers without setting
 * `FLAG_ONGOING_EVENT`; it is deliberately conservative so a chat message that
 * changes its wording is always stored.
 */
class NotificationLiveCoalescer(
    private val windowMs: Long,
    private val maxEntries: Int = 256,
) {
    private data class Entry(
        val normalized: String,
        val firstSeenAtMs: Long,
        val lastSeenAtMs: Long,
        val seenCount: Int,
    )

    private val entries = LinkedHashMap<String, Entry>()

    fun isNumericChurn(identityKey: String, title: String, text: String, occurredAtMs: Long): Boolean {
        if (identityKey.isBlank()) return false
        val normalized = normalize(title) + "\u001F" + normalize(text)
        if (normalized.isBlank() || normalized == "\u001F") return false
        val now = if (occurredAtMs > 0) occurredAtMs else System.currentTimeMillis()
        synchronized(entries) {
            val previous = entries[identityKey]
            if (previous != null && previous.normalized == normalized &&
                now - previous.lastSeenAtMs <= REPEAT_WINDOW_MS &&
                now - previous.firstSeenAtMs <= windowMs
            ) {
                val seenCount = previous.seenCount + 1
                entries[identityKey] = previous.copy(lastSeenAtMs = now, seenCount = seenCount)
                trim()
                // Only a long, fast burst of the *same shape* is a live readout.
                // Real messages - including repeated transfer receipts - stay
                // well below this and are always archived.
                return seenCount >= REPEATS_BEFORE_LIVE
            }
            entries[identityKey] = Entry(normalized, now, now, 1)
            trim()
            return false
        }
    }

    /** Digits, units and whitespace are what change in a live readout. */
    private fun normalize(value: String): String = value
        .lowercase(Locale.ROOT)
        .replace(Regex("""\d+([.,:]\d+)*"""), "#")
        .replace(Regex("""\s+"""), " ")
        .trim()

    private fun trim() {
        while (entries.size > maxEntries) {
            val oldest = entries.keys.firstOrNull() ?: return
            entries.remove(oldest)
        }
    }

    companion object {
        /** Consecutive updates must arrive this fast to count as one readout. */
        const val REPEAT_WINDOW_MS = 30_000L

        /** Identical shapes before the identity is treated as a live readout. */
        const val REPEATS_BEFORE_LIVE = 5
    }
}
