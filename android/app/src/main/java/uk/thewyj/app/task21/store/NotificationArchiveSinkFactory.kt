package uk.thewyj.app.task21.store

import android.content.Context
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.StructuredNotificationEvent

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
        uk.thewyj.app.task21.CaptureTrace.stage(traceId, "archive-accepted", "pkg=${input.sourcePackage}")
        store.record(accountId, captureOf(input, parsed))
        return true
    }

    override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
        if (input.notificationKey.isBlank()) return
        store.markRemoved(accountId, input.notificationKey)
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

    private fun captureOf(input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = NotificationCapture(
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
    )
}
