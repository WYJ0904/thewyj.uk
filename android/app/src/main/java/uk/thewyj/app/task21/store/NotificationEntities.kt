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
    /**
     * Canonical finance state of this snapshot once the payment pipeline booked
     * it: "" | pending | confirmed | ignored | failed. Persisted (not UI state)
     * so a refresh, an app restart or a sync pull can never resurrect a
     * confirmed candidate.
     */
    val financeState: String = "",
    /** Server-side transaction identity the moment the candidate was confirmed. */
    val financeTransactionId: String = "",
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
        Index(value = ["mediaFingerprint"]),
        Index(value = ["accountId", "sourceEventId"]),
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
    /**
     * Task 24.1 R4 evidence identity for media events, strongest first:
     * `ms:<rowId>` (MediaStore row) > `uri:<sha>` > `nfb:<sha>` (sampled bitmap).
     * Screenshots are deduplicated by this evidence, never by the notification
     * key: One UI replaces its screenshot notification in place, so the key is
     * stable while the content changes.
     */
    val mediaFingerprint: String = "",
    /** Secondary evidence (the other origin that confirmed the same screenshot). */
    val mediaFingerprintAlt: String = "",
    /** "" | notification | media_store | media_store+notification */
    val mediaOrigin: String = "",
    /**
     * Stable structured-event id of the capture (the same id the payment
     * recogniser and the cloud candidate/transaction use), so
     * notification/archiveId → candidateId → financeTransactionId can be
     * followed end to end without guessing.
     */
    val sourceEventId: String = "",
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
