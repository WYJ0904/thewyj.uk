package uk.thewyj.app.task21.store

import uk.thewyj.app.task21.LocalNotificationArchive
import java.io.File

/**
 * One-time import of the v1 `wyj-notification-archive-v1` file into Room.
 *
 * The legacy file is never modified or deleted: if the import fails the next
 * launch retries and the user keeps their data either way.
 */
class LegacyArchiveMigration(private val database: NotificationDatabase) {
    private val store = RoomNotificationStore(database)

    data class Result(
        val state: String,
        val imported: Int,
        val error: String = "",
    ) {
        val done: Boolean get() = state == STATE_DONE
    }

    fun migrateIfNeeded(filesDir: File, accountId: String): Result {
        val account = accountId.trim()
        if (account.isEmpty()) return Result(STATE_SKIPPED, 0)
        val settings = store.ensureSettings(account)
        if (settings.legacyMigrationState == STATE_DONE) {
            return Result(STATE_DONE, settings.legacyImportedCount)
        }
        val legacy = LocalNotificationArchive.inDirectory(filesDir, account)
        val records = try {
            legacy.listRecent(LocalNotificationArchive.MAX_ARCHIVE_RECORDS).reversed()
        } catch (error: Throwable) {
            return fail(settings, error.message ?: "legacy archive unreadable")
        }
        var imported = 0
        try {
            database.runInTransaction {
                for (record in records) {
                    val stored = store.record(
                        account,
                        legacyCapture(record),
                        now = record.receivedAtMs,
                    )
                    if (stored != null) imported += 1
                }
                val persisted = database.notificationDao().historyCount(account, 1, "", 0, 0, "")
                if (persisted < records.size) {
                    throw IllegalStateException("imported $persisted of ${records.size} records")
                }
            }
        } catch (error: Throwable) {
            return fail(settings, error.message ?: "legacy import failed")
        }
        store.updateSettings(settings.copy(legacyMigrationState = STATE_DONE, legacyImportedCount = imported))
        return Result(STATE_DONE, imported)
    }

    private fun legacyCapture(record: uk.thewyj.app.task21.LocalNotificationRecord) = NotificationCapture(
        sourcePackage = record.sourcePackage,
        sourceType = "notification",
        notificationKey = "",
        notificationId = 0,
        tag = "",
        groupKey = "",
        channelId = "",
        postTime = record.receivedAtMs,
        isGroup = false,
        isGroupSummary = false,
        title = record.title,
        text = record.text,
        bigText = record.bigText,
        subText = record.subText,
        parseStatus = record.parseStatus.name,
        direction = record.direction.name,
        amountMinor = record.amountMinor,
        currency = record.currency,
        merchant = record.merchant,
        confidence = record.confidence,
    )

    private fun fail(settings: NotificationSettingsEntity, reason: String): Result {
        store.updateSettings(
            settings.copy(
                legacyMigrationState = STATE_FAILED,
                legacyImportedCount = 0,
            ),
        )
        failureReason = reason
        return Result(STATE_FAILED, 0, reason)
    }

    /** Last failure reason, for diagnostics in the notification settings screen. */
    @Volatile
    var failureReason: String = ""
        private set

    companion object {
        const val STATE_PENDING = "pending"
        const val STATE_DONE = "done"
        const val STATE_FAILED = "failed"
        const val STATE_SKIPPED = "skipped"
    }
}
