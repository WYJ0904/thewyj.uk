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
    /**
     * Task 24 reopen #5: an updating readout (recording timer, live status) keeps
     * exactly one archive row. The store updates that row in place instead of
     * appending a new revision, so a per-second notification cannot flood
     * history with one entry per tick.
     */
    val coalesceWithPrevious: Boolean = false,
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
        // A system screenshot notice is user content even when One UI marks it
        // ongoing and reuses the same key for the next capture: it must never be
        // coalesced away as a live readout.
        if (uk.thewyj.app.task21.screenshot.ScreenshotEvidence.isScreenshotEvent(
                sourcePackage = input.sourcePackage,
                channelId = input.channelId,
                title = input.title,
                text = input.text,
                bigText = input.bigText,
                hasMedia = input.hasMedia,
            )
        ) {
            return NotificationClassification(NotificationClass.MESSAGE, true, "screenshot_event")
        }
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
        // Second layer: some apps never set the flag. The same Android identity
        // repeating the same shape every couple of seconds (recording timer,
        // live readout whose digits change) is one updating notification. It is
        // archived once and then updated in place instead of appended again.
        val readout = coalescer.readoutDecision(
            identityKey = input.identityKey,
            title = input.title,
            text = input.text.ifBlank { input.bigText }.ifBlank { input.subText },
            occurredAtMs = input.occurredAtMs,
        )
        // A real ledger event is never an updating readout: three payment
        // receipts one second apart on the same notification id are three
        // payments, not one timer. Money-carrying captures always keep their own
        // snapshot.
        val carriesMoney = readout != NotificationReadoutDecision.NEW &&
            uk.thewyj.app.task21.payment.PaymentText.amountMinor(
                listOf(input.title, input.text, input.bigText, input.subText)
                    .filter { it.isNotBlank() }
                    .joinToString(" "),
            ) != null
        if (readout != NotificationReadoutDecision.NEW && !carriesMoney) {
            return NotificationClassification(
                NotificationClass.LIVE,
                true,
                if (readout == NotificationReadoutDecision.FAST_REPEAT) "update_in_place" else "numeric_churn",
                coalesceWithPrevious = true,
            )
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

enum class NotificationReadoutDecision {
    /** A shape this identity has not posted before: always a new revision. */
    NEW,

    /** The same shape arrived within a couple of seconds: an updating readout. */
    FAST_REPEAT,

    /** The same shape has been reposted many times inside the live window. */
    CHURN,
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

    private data class Observation(
        val sameShape: Boolean,
        val gapMs: Long,
        val firstSeenAgeMs: Long,
        val seenCount: Int,
    )

    private val entries = LinkedHashMap<String, Entry>()

    /**
     * Records the shape and reports how it relates to the previous post of the
     * same identity. Both public decisions share this bookkeeping so a caller can
     * never double-count one capture.
     */
    private fun observe(identityKey: String, title: String, text: String, occurredAtMs: Long): Observation? {
        if (identityKey.isBlank()) return null
        val normalized = normalize(title) + "\u001F" + normalize(text)
        if (normalized.isBlank() || normalized == "\u001F") return null
        val now = if (occurredAtMs > 0) occurredAtMs else System.currentTimeMillis()
        synchronized(entries) {
            val previous = entries[identityKey]
            val sameShape = previous != null && previous.normalized == normalized
            val seenCount = if (sameShape) previous!!.seenCount + 1 else 1
            val firstSeenAtMs = if (sameShape) previous!!.firstSeenAtMs else now
            val gapMs = if (sameShape) now - previous!!.lastSeenAtMs else Long.MAX_VALUE
            entries[identityKey] = Entry(normalized, firstSeenAtMs, now, seenCount)
            trim()
            return Observation(
                sameShape = sameShape,
                gapMs = gapMs,
                firstSeenAgeMs = now - firstSeenAtMs,
                seenCount = seenCount,
            )
        }
    }

    /**
     * Task 24 reopen #5: one updating notification, one archive row. Returns
     * [NotificationReadoutDecision.FAST_REPEAT] when the same identity reposts
     * the same shape within [FAST_REPEAT_MS] (a recording timer ticks every
     * second) and [NotificationReadoutDecision.CHURN] when a slower but still
     * continuous burst continues inside the live window. Two identical real
     * messages sit far apart in time, so they stay [NotificationReadoutDecision.NEW].
     */
    fun readoutDecision(identityKey: String, title: String, text: String, occurredAtMs: Long): NotificationReadoutDecision {
        val observation = observe(identityKey, title, text, occurredAtMs) ?: return NotificationReadoutDecision.NEW
        if (!observation.sameShape) return NotificationReadoutDecision.NEW
        // Two identical posts one second apart are still two messages; only a
        // real ticker (three posts inside a few seconds) is an updating readout.
        if (observation.gapMs <= FAST_REPEAT_MS && observation.seenCount >= FAST_REPEATS_BEFORE_COALESCE) {
            return NotificationReadoutDecision.FAST_REPEAT
        }
        if (observation.gapMs <= REPEAT_WINDOW_MS &&
            observation.firstSeenAgeMs <= windowMs &&
            observation.seenCount >= REPEATS_BEFORE_LIVE
        ) {
            return NotificationReadoutDecision.CHURN
        }
        return NotificationReadoutDecision.NEW
    }

    fun isNumericChurn(identityKey: String, title: String, text: String, occurredAtMs: Long): Boolean {
        val observation = observe(identityKey, title, text, occurredAtMs) ?: return false
        if (!observation.sameShape) return false
        if (observation.gapMs > REPEAT_WINDOW_MS) return false
        if (observation.firstSeenAgeMs > windowMs) return false
        // Only a long, fast burst of the *same shape* is a live readout. Real
        // messages - including repeated transfer receipts - stay well below this
        // and are always archived.
        return observation.seenCount >= REPEATS_BEFORE_LIVE
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

        /**
         * A per-second readout is recognised from its second update on: the
         * archive keeps one row and updates it, instead of writing five rows
         * before the churn detector reacts.
         */
        const val FAST_REPEAT_MS = 3_000L

        /** Fast posts of one shape before the identity counts as a ticker. */
        const val FAST_REPEATS_BEFORE_COALESCE = 3

        /** Identical shapes before the identity is treated as a live readout. */
        const val REPEATS_BEFORE_LIVE = 5
    }
}
