package uk.thewyj.app.task21.store

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Local-first notification storage. Raw notification content never leaves the
 * device; these tables exist so search, filters, retention, per-app policies and
 * revision history all work on a real database instead of a rewritten file.
 *
 * Identity: one [NotificationInstanceEntity] per system notification lifecycle
 * (account + notification key/id/tag), one [NotificationRevisionEntity] per
 * genuinely different content revision of that notification.
 */
@Entity(
    tableName = "notification_instances",
    indices = [
        Index(value = ["accountId", "postTime"]),
        Index(value = ["accountId", "sourcePackage", "postTime"]),
        Index(value = ["accountId", "status", "postTime"]),
        Index(value = ["accountId", "identityKey", "status"]),
        Index(value = ["accountId", "notificationKey", "status"]),
    ],
)
data class NotificationInstanceEntity(
    @PrimaryKey val instanceId: String,
    val accountId: String,
    /** Deterministic identity: key, or package+id+tag, or a synthetic unique id. */
    val identityKey: String,
    val sourcePackage: String,
    val sourceType: String,
    val notificationKey: String,
    val notificationId: Int,
    val tag: String,
    val groupKey: String,
    val channelId: String,
    val postTime: Long,
    val firstSeenAt: Long,
    val lastSeenAt: Long,
    val removedAt: Long,
    /** active | removed */
    val status: String,
    val revisionCount: Int,
    val latestRevisionId: String,
    val isGroup: Int,
    val isGroupSummary: Int,
    /** Set when a finance candidate/transaction references this instance. */
    val financeLinked: Int,
    /** User favourite (Task 24.1): retention never removes a pinned notification. */
    val pinned: Int = 0,
    val pinnedAt: Long = 0,
)

@Entity(
    tableName = "notification_revisions",
    foreignKeys = [
        ForeignKey(
            entity = NotificationInstanceEntity::class,
            parentColumns = ["instanceId"],
            childColumns = ["instanceId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["instanceId", "capturedAt"]),
        Index(value = ["accountId", "capturedAt"]),
        Index(value = ["contentHash"]),
    ],
)
data class NotificationRevisionEntity(
    @PrimaryKey val revisionId: String,
    val instanceId: String,
    val accountId: String,
    val title: String,
    val text: String,
    val bigText: String,
    val subText: String,
    val infoText: String,
    val summaryText: String,
    /** Newline separated EXTRA_TEXT_LINES / messaging lines. */
    val textLines: String,
    /** Content hash; similarity evidence only, never an identity. */
    val contentHash: String,
    val capturedAt: Long,
    val parseStatus: String,
    val direction: String,
    val amountMinor: Long,
    val currency: String,
    val merchant: String,
    val confidence: Int,
    /**
     * Local picture Android exposed on the notification (screenshot thumbnail,
     * BigPictureStyle, large icon). Empty when the notification had none.
     */
    val mediaPath: String = "",
    val mediaMime: String = "",
    /** none | available | unavailable */
    val mediaState: String = "none",
)

@Entity(tableName = "notification_app_policies", primaryKeys = ["accountId", "sourcePackage"])
data class NotificationAppPolicyEntity(
    val accountId: String,
    val sourcePackage: String,
    val enabled: Int,
    val updatedAt: Long,
)

@Entity(tableName = "notification_rules", indices = [Index(value = ["accountId", "enabled"])])
data class NotificationRuleEntity(
    @PrimaryKey val ruleId: String,
    val accountId: String,
    val name: String,
    val enabled: Int,
    /** "*" for every selected app, otherwise a comma separated package list. */
    val appScope: String,
    val includeKeywords: String,
    val excludeKeywords: String,
    /** 0 = ANY include keyword, 1 = ALL include keywords. */
    val matchAll: Int,
    val updatedAt: Long,
)

@Entity(tableName = "notification_settings")
data class NotificationSettingsEntity(
    @PrimaryKey val accountId: String,
    /** -1 = keep forever. */
    val retentionDays: Int,
    val legacyMigrationState: String,
    val legacyImportedCount: Int,
    val updatedAt: Long,
)
