package uk.thewyj.app.task21.store

import android.content.Context
import uk.thewyj.app.task21.CaptureTrace
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.ScreenshotMediaEvent
import uk.thewyj.app.task21.StructuredNotificationEvent
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.screenshot.ScreenshotLinkAction
import uk.thewyj.app.task21.screenshot.ScreenshotMediaOrigin

/**
 * Bridges the capture pipeline to the Room store: applies the per-account app
 * policy, runs the one-time v1 archive import and writes instances/revisions.
 */
object NotificationArchiveSinkFactory {
    fun forContext(context: Context): NotificationArchiveSink =
        RoomNotificationArchiveSink(context.applicationContext)
}

class RoomNotificationArchiveSink(private val context: Context) : NotificationArchiveSink {
    private val database get() = NotificationDatabase.get(context)
    private val store get() = RoomNotificationStore(database)
    private val media get() = NotificationMediaStore(context)

    override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?): Boolean {
        if (accountId.isBlank() || input.sourcePackage.isBlank()) return false
        runCatching { LegacyArchiveMigration(database).migrateIfNeeded(context.filesDir, accountId) }
        val traceId = uk.thewyj.app.task21.CaptureTrace.traceId(
            input.notificationKey,
            input.sourcePackage,
            input.notificationId,
        )
        if (!isAllowed(accountId, input.sourcePackage)) {
            uk.thewyj.app.task21.CaptureTrace.stage(traceId, "archive-skipped-app-disabled", "pkg=${input.sourcePackage}")
            return false
        }
        uk.thewyj.app.task21.CaptureTrace.stage(
            traceId,
            "archive-accepted",
            "pkg=${input.sourcePackage} media=${input.mediaState}",
        )
        val mediaRef = media.save(
            accountId = accountId,
            identity = mediaIdentity(input),
            bitmap = input.mediaBitmap,
        ) ?: input.mediaSourceUri.takeIf { it.isNotBlank() }?.let { uri ->
            // #6: Android published a reference instead of a bitmap. The import
            // runs on the capture executor; a URI we may not read (permission
            // revoked, row deleted, app-private store) returns null and the row
            // stays "unavailable" with the notification itself still archived.
            media.saveUri(accountId, mediaIdentity(input), uri)
        }
        val capture = captureOf(input, parsed, mediaRef)
        if (input.screenshotEvent) {
            CaptureTrace.stage(
                traceId,
                if (mediaRef != null) "media-resolved" else "media-unavailable",
                "origin=notification",
            )
            if (mediaRef != null) {
                CaptureTrace.stage(
                    traceId,
                    "notification-fallback-used",
                    "evidence=${input.mediaFingerprint.ifBlank { "-" }}",
                )
            }
        }
        if (input.screenshotEvent && input.mediaFingerprint.isNotBlank()) {
            val link = store.linkScreenshotEvidence(
                accountId = accountId,
                fingerprint = input.mediaFingerprint,
                origin = ScreenshotMediaOrigin.NOTIFICATION,
                eventAtMs = capture.postTime,
                mediaPath = capture.mediaPath,
                mediaMime = capture.mediaMime,
                mediaState = capture.mediaState,
            )
            when (link.action) {
                ScreenshotLinkAction.DUPLICATE, ScreenshotLinkAction.MERGE -> {
                    uk.thewyj.app.task21.CaptureTrace.stage(
                        traceId,
                        "duplicate-merged",
                        "evidence=${input.mediaFingerprint} action=${link.action.name.lowercase()} " +
                            "origin=notification",
                    )
                    return true
                }
                ScreenshotLinkAction.NEW_EVENT -> Unit
            }
        }
        store.record(accountId, capture)
        return true
    }

    override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
        if (input.notificationKey.isNotBlank()) {
            store.markRemoved(accountId, input.notificationKey)
            return
        }
        // #5: apps that never set a platform key still have a lifecycle. The
        // archived snapshot stays (removal only changes the state); a repost in
        // the same slot afterwards starts a new instance.
        store.markRemovedBySlot(
            accountId = accountId,
            sourcePackage = input.sourcePackage,
            notificationId = input.notificationId,
            tag = input.tag,
        )
    }

    override fun markFinanceOutcome(
        accountId: String,
        sourceEventId: String,
        state: String,
        transactionId: String,
    ): Boolean = runCatching {
        store.markFinanceOutcome(accountId, sourceEventId, state, transactionId)
    }.getOrDefault(false)

    override fun recognitionSourceEventId(accountId: String, sourceEventId: String): String = runCatching {
        store.recognitionSourceEventId(accountId, sourceEventId)
    }.getOrDefault("")

    /**
     * Task 24.1 R4: a screenshot that MediaStore delivered (Samsung replaces the
     * screenshot notification in place, so the listener cannot see later
     * captures). The picture is copied into private storage first; when that
     * fails the row is still archived with an explicit "unavailable" state and
     * never with a content URI the app may not be allowed to read later.
     */
    override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent): ScreenshotArchiveOutcome {
        if (accountId.isBlank() || event.fingerprint.isBlank() || event.sourcePackage.isBlank()) {
            return ScreenshotArchiveOutcome.SKIPPED
        }
        if (!isAllowed(accountId, event.sourcePackage)) {
            return ScreenshotArchiveOutcome.SKIPPED
        }
        val traceId = "shot:${event.fingerprint}"
        val mediaRef = if (event.mediaState == "available") {
            media.saveUri(accountId, event.fingerprint, event.mediaUri)
        } else {
            null
        }
        val mediaState = when {
            mediaRef != null -> "available"
            event.mediaState == "available" -> "unavailable"
            else -> event.mediaState.ifBlank { "unavailable" }
        }
        val identity = "shot:${event.fingerprint}"
        val link = store.linkScreenshotEvidence(
            accountId = accountId,
            fingerprint = event.fingerprint,
            origin = ScreenshotMediaOrigin.MEDIA_STORE,
            eventAtMs = event.capturedAtMs,
            mediaPath = mediaRef?.relativePath.orEmpty(),
            mediaMime = mediaRef?.mimeType ?: event.mediaMime,
            mediaState = mediaState,
        )
        uk.thewyj.app.task21.CaptureTrace.stage(traceId, "media-store-fallback-used", "action=${link.action.name.lowercase()}")
        when (link.action) {
            ScreenshotLinkAction.DUPLICATE -> {
                uk.thewyj.app.task21.CaptureTrace.stage(traceId, "duplicate-merged", "origin=media_store")
                return ScreenshotArchiveOutcome.DUPLICATE
            }
            ScreenshotLinkAction.MERGE -> {
                uk.thewyj.app.task21.CaptureTrace.stage(traceId, "duplicate-merged", "origin=media_store")
                return ScreenshotArchiveOutcome.MERGED
            }
            ScreenshotLinkAction.NEW_EVENT -> Unit
        }
        val capture = NotificationCapture(
            sourcePackage = event.sourcePackage,
            sourceType = "screenshot_media_store",
            notificationKey = "",
            notificationId = 0,
            tag = "",
            groupKey = "",
            channelId = "screenshots",
            postTime = event.capturedAtMs,
            isGroup = false,
            isGroupSummary = false,
            title = event.title,
            text = event.text,
            bigText = "",
            subText = "",
            identityOverride = identity,
            mediaPath = mediaRef?.relativePath.orEmpty(),
            mediaMime = mediaRef?.mimeType ?: event.mediaMime,
            mediaState = mediaState,
            mediaFingerprint = event.fingerprint,
            mediaOrigin = ScreenshotMediaOrigin.MEDIA_STORE.wireValue,
        )
        val instanceId = store.record(accountId, capture)
        return when {
            instanceId != null -> ScreenshotArchiveOutcome.STORED
            else -> ScreenshotArchiveOutcome.DUPLICATE
        }
    }

    /**
     * Unknown apps default to capture: only an explicit "off" row blocks a
     * package. The previous rule denied every app that was not in the selector
     * once any policy existed, which silently dropped notifications from newly
     * installed apps.
     */
    private fun isAllowed(accountId: String, sourcePackage: String): Boolean {
        val policies = store.appPolicies(accountId)
        return policies.firstOrNull { it.sourcePackage == sourcePackage }?.enabled != 0
    }

    /**
     * File name seed for the imported picture. Evidence fingerprints are
     * content addressed, so screenshot A keeps A's file even when the next
     * capture reuses the same notification key.
     */
    private fun mediaIdentity(input: NotificationCaptureInput): String = when {
        input.mediaFingerprint.isNotBlank() -> input.mediaFingerprint
        input.identityOverride.isNotBlank() -> input.identityOverride
        input.notificationKey.isNotBlank() -> input.notificationKey
        else -> "${input.sourcePackage}|${input.notificationId}|${input.tag}"
    }

    private fun captureOf(
        input: NotificationCaptureInput,
        parsed: StructuredNotificationEvent?,
        mediaRef: NotificationMediaRef?,
    ) = NotificationCapture(
        sourcePackage = input.sourcePackage,
        sourceType = input.sourceType,
        notificationKey = input.notificationKey,
        notificationId = input.notificationId,
        tag = input.tag,
        groupKey = input.groupKey,
        channelId = input.channelId,
        postTime = if (input.postTime > 0) input.postTime else input.receivedAtMs,
        isGroup = input.isGroup,
        isGroupSummary = input.isGroupSummary,
        title = input.title,
        text = input.text,
        bigText = input.bigText,
        subText = input.subText,
        infoText = input.infoText,
        summaryText = input.summaryText,
        textLines = input.textLines,
        parseStatus = parsed?.parseStatus?.name ?: "UNPARSED",
        direction = parsed?.direction?.name ?: "UNKNOWN",
        amountMinor = parsed?.amountMinor ?: 0,
        currency = parsed?.currency ?: "CNY",
        merchant = parsed?.merchant.orEmpty(),
        confidence = parsed?.confidence ?: 0,
        mediaPath = mediaRef?.relativePath ?: input.mediaPath,
        mediaMime = mediaRef?.mimeType ?: input.mediaMime,
        mediaState = when {
            mediaRef != null -> "available"
            input.mediaState == "available" -> "unavailable"
            else -> input.mediaState
        },
        identityOverride = input.identityOverride,
            mediaFingerprint = input.mediaFingerprint,
            mediaOrigin = when {
                input.mediaFingerprint.isBlank() -> ""
                else -> ScreenshotMediaOrigin.NOTIFICATION.wireValue
            },
            sourceEventId = parsed?.eventId.orEmpty(),
            coalesceWithPrevious = input.coalesceWithPrevious,
        )
}
