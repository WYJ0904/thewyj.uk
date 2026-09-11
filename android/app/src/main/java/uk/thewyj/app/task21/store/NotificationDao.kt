package uk.thewyj.app.task21.store

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface NotificationDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insertInstance(instance: NotificationInstanceEntity)

    @Update
    fun updateInstance(instance: NotificationInstanceEntity): Int

    @Query("SELECT * FROM notification_instances WHERE accountId = :accountId AND instanceId = :instanceId")
    fun instance(accountId: String, instanceId: String): NotificationInstanceEntity?

    @Query("SELECT * FROM notification_instances WHERE accountId = :accountId AND identityKey = :identityKey AND status = 'active' ORDER BY lastSeenAt DESC LIMIT 1")
    fun activeInstanceByIdentity(accountId: String, identityKey: String): NotificationInstanceEntity?

    /**
     * Change signal for the UI: Room re-emits whenever an instance or revision
     * row is written, so the history list observes the database instead of
     * polling on a timer.
     */
    @Query("SELECT COUNT(*) FROM notification_instances WHERE accountId = :accountId")
    fun observeInstanceCount(accountId: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM notification_revisions WHERE accountId = :accountId")
    fun observeRevisionCount(accountId: String): Flow<Int>

    /** Latest stored notification identity; drives the UI render trace. */
    @Query(
        "SELECT identityKey FROM notification_instances WHERE accountId = :accountId "
            + "ORDER BY lastSeenAt DESC, instanceId DESC LIMIT 1",
    )
    fun observeLatestIdentity(accountId: String): Flow<String?>

    @Query("SELECT * FROM notification_instances WHERE accountId = :accountId AND notificationKey = :notificationKey AND status = 'active' ORDER BY lastSeenAt DESC LIMIT 1")
    fun activeInstanceByNotificationKey(accountId: String, notificationKey: String): NotificationInstanceEntity?

    @Query("SELECT * FROM notification_instances WHERE accountId = :accountId AND sourcePackage = :sourcePackage AND notificationId = :notificationId AND tag = :tag AND status = 'active' ORDER BY lastSeenAt DESC LIMIT 1")
    fun activeInstanceBySlot(accountId: String, sourcePackage: String, notificationId: Int, tag: String): NotificationInstanceEntity?

    @Query("UPDATE notification_instances SET lastSeenAt = :seenAt, removedAt = 0, status = 'active' WHERE accountId = :accountId AND instanceId = :instanceId")
    fun touchInstance(accountId: String, instanceId: String, seenAt: Long): Int

    @Query("UPDATE notification_instances SET removedAt = :removedAt, status = 'removed' WHERE accountId = :accountId AND instanceId = :instanceId")
    fun markRemoved(accountId: String, instanceId: String, removedAt: Long): Int

    @Query("UPDATE notification_instances SET status = 'removed', removedAt = :removedAt WHERE accountId = :accountId AND notificationKey != '' AND notificationKey = :notificationKey")
    fun markRemovedByKey(accountId: String, notificationKey: String, removedAt: Long): Int

    @Query("UPDATE notification_instances SET financeLinked = 1 WHERE accountId = :accountId AND instanceId = :instanceId")
    fun markFinanceLinked(accountId: String, instanceId: String): Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insertRevision(revision: NotificationRevisionEntity)

    @Query("SELECT * FROM notification_revisions WHERE accountId = :accountId AND instanceId = :instanceId ORDER BY capturedAt DESC, revisionId DESC LIMIT 1")
    fun latestRevision(accountId: String, instanceId: String): NotificationRevisionEntity?

    @Query("SELECT * FROM notification_revisions WHERE accountId = :accountId AND instanceId = :instanceId ORDER BY capturedAt ASC, revisionId ASC")
    fun revisions(accountId: String, instanceId: String): List<NotificationRevisionEntity>

    @Query(
        """
        SELECT i.instanceId AS instanceId, i.sourcePackage AS sourcePackage, i.postTime AS postTime,
               i.status AS status, i.removedAt AS removedAt, i.revisionCount AS revisionCount,
               i.latestRevisionId AS latestRevisionId, i.financeLinked AS financeLinked,
               i.pinned AS pinned,
               r.revisionId AS revisionId, r.title AS title, r.text AS text, r.bigText AS bigText,
               r.subText AS subText, r.summaryText AS summaryText, r.textLines AS textLines,
               r.parseStatus AS parseStatus, r.direction AS direction, r.amountMinor AS amountMinor,
               r.currency AS currency, r.merchant AS merchant, r.capturedAt AS capturedAt
        FROM notification_instances AS i
        JOIN notification_revisions AS r ON r.instanceId = i.instanceId
        WHERE i.accountId = :accountId
          AND (:includeRemoved = 1 OR i.status = 'active')
          AND (:packageFilter = '' OR i.sourcePackage = :packageFilter)
          AND (:fromTime = 0 OR r.capturedAt >= :fromTime)
          AND (:toTime = 0 OR r.capturedAt <= :toTime)
          AND (:query = '' OR r.title LIKE '%' || :query || '%' OR r.text LIKE '%' || :query || '%'
               OR r.bigText LIKE '%' || :query || '%' OR r.subText LIKE '%' || :query || '%'
               OR r.summaryText LIKE '%' || :query || '%')
        ORDER BY r.capturedAt DESC, r.revisionId DESC
        LIMIT :limit OFFSET :offset
        """,
    )
    fun history(
        accountId: String,
        includeRemoved: Int,
        packageFilter: String,
        fromTime: Long,
        toTime: Long,
        query: String,
        limit: Int,
        offset: Int,
    ): List<NotificationHistoryRow>

    @Query(
        """
        SELECT COUNT(*) FROM notification_instances AS i
        JOIN notification_revisions AS r ON r.instanceId = i.instanceId
        WHERE i.accountId = :accountId
          AND (:includeRemoved = 1 OR i.status = 'active')
          AND (:packageFilter = '' OR i.sourcePackage = :packageFilter)
          AND (:fromTime = 0 OR r.capturedAt >= :fromTime)
          AND (:toTime = 0 OR r.capturedAt <= :toTime)
          AND (:query = '' OR r.title LIKE '%' || :query || '%' OR r.text LIKE '%' || :query || '%'
               OR r.bigText LIKE '%' || :query || '%' OR r.subText LIKE '%' || :query || '%'
               OR r.summaryText LIKE '%' || :query || '%')
        """,
    )
    fun historyCount(
        accountId: String,
        includeRemoved: Int,
        packageFilter: String,
        fromTime: Long,
        toTime: Long,
        query: String,
    ): Int

    @Query(
        """
        SELECT sourcePackage AS sourcePackage, COUNT(*) AS count, MAX(postTime) AS lastPostTime
        FROM notification_instances
        WHERE accountId = :accountId AND status = 'active'
        GROUP BY sourcePackage
        ORDER BY lastPostTime DESC
        """,
    )
    fun countsByPackage(accountId: String): List<NotificationPackageCount>

    @Query("SELECT COUNT(*) FROM notification_instances WHERE accountId = :accountId AND status = 'active'")
    fun activeCount(accountId: String): Int

    @Query(
        """
        SELECT COALESCE(SUM(
            LENGTH(r.title) + LENGTH(r.text) + LENGTH(r.bigText) + LENGTH(r.subText)
            + LENGTH(r.summaryText) + LENGTH(r.textLines)
        ), 0)
        FROM notification_revisions AS r WHERE r.accountId = :accountId
        """,
    )
    fun storedCharacters(accountId: String): Long

    @Query("SELECT COUNT(*) FROM notification_revisions WHERE accountId = :accountId")
    fun revisionCount(accountId: String): Int

    @Query("DELETE FROM notification_instances WHERE accountId = :accountId AND instanceId IN (:instanceIds)")
    fun deleteInstances(accountId: String, instanceIds: List<String>): Int

    @Query("DELETE FROM notification_revisions WHERE accountId = :accountId AND revisionId IN (:revisionIds)")
    fun deleteRevisions(accountId: String, revisionIds: List<String>): Int

    @Query("SELECT * FROM notification_revisions WHERE accountId = :accountId AND instanceId = :instanceId ORDER BY capturedAt DESC, revisionId DESC")
    fun revisionsNewestFirst(accountId: String, instanceId: String): List<NotificationRevisionEntity>

    @Query("SELECT COUNT(*) FROM notification_revisions WHERE accountId = :accountId AND instanceId = :instanceId")
    fun revisionCountOf(accountId: String, instanceId: String): Int

    @Query("SELECT * FROM notification_revisions WHERE accountId = :accountId AND revisionId IN (:revisionIds)")
    fun revisionsByIds(accountId: String, revisionIds: List<String>): List<NotificationRevisionEntity>

    @Query("DELETE FROM notification_instances WHERE accountId = :accountId AND instanceId = :instanceId AND (SELECT COUNT(*) FROM notification_revisions WHERE instanceId = :instanceId) = 0")
    fun deleteInstanceIfEmpty(accountId: String, instanceId: String): Int

    @Query("DELETE FROM notification_instances WHERE accountId = :accountId")
    fun clearAccount(accountId: String): Int

    @Query(
        """
        SELECT instanceId FROM notification_instances
        WHERE accountId = :accountId AND postTime < :cutoffMs
          AND financeLinked = 0 AND pinned = 0
        ORDER BY postTime ASC LIMIT :limit
        """,
    )
    fun purgeCandidates(accountId: String, cutoffMs: Long, limit: Int): List<String>

    @Query("UPDATE notification_instances SET pinned = :pinned, pinnedAt = :pinnedAt WHERE accountId = :accountId AND instanceId = :instanceId")
    fun setPinned(accountId: String, instanceId: String, pinned: Int, pinnedAt: Long): Int

    @Query("SELECT COUNT(*) FROM notification_instances WHERE accountId = :accountId AND pinned = 1")
    fun pinnedCount(accountId: String): Int

    @Query("SELECT COUNT(*) FROM notification_instances WHERE accountId = :accountId AND pinned = 1 AND postTime < :cutoffMs")
    fun pinnedOlderThan(accountId: String, cutoffMs: Long): Int

    @Query(
        """
        SELECT * FROM notification_instances
        WHERE accountId = :accountId AND removedAt > 0
        """,
    )
    fun removedInstances(accountId: String): List<NotificationInstanceEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertAppPolicy(policy: NotificationAppPolicyEntity)

    @Query("SELECT * FROM notification_app_policies WHERE accountId = :accountId ORDER BY sourcePackage")
    fun appPolicies(accountId: String): List<NotificationAppPolicyEntity>

    @Query("SELECT * FROM notification_app_policies WHERE accountId = :accountId AND sourcePackage = :sourcePackage")
    fun appPolicy(accountId: String, sourcePackage: String): NotificationAppPolicyEntity?

    @Query("SELECT COUNT(*) FROM notification_app_policies WHERE accountId = :accountId AND enabled = 1")
    fun enabledAppCount(accountId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertRule(rule: NotificationRuleEntity)

    @Query("SELECT * FROM notification_rules WHERE accountId = :accountId ORDER BY updatedAt DESC")
    fun rules(accountId: String): List<NotificationRuleEntity>

    @Query("SELECT * FROM notification_rules WHERE accountId = :accountId AND enabled = 1")
    fun enabledRules(accountId: String): List<NotificationRuleEntity>

    @Query("DELETE FROM notification_rules WHERE accountId = :accountId AND ruleId = :ruleId")
    fun deleteRule(accountId: String, ruleId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertSettings(settings: NotificationSettingsEntity)

    @Query("SELECT * FROM notification_settings WHERE accountId = :accountId")
    fun settings(accountId: String): NotificationSettingsEntity?

    @Transaction
    fun recordCapture(
        accountId: String,
        identityKey: String,
        newInstanceId: String,
        newRevisionId: String,
        now: Long,
        instanceFactory: (String) -> NotificationInstanceEntity,
        revisionFactory: (String, String) -> NotificationRevisionEntity,
    ): CaptureWriteResult {
        val existing = activeInstanceByIdentity(accountId, identityKey)
        if (existing == null) {
            val instance = instanceFactory(newInstanceId)
            val revision = revisionFactory(newInstanceId, newRevisionId)
            insertInstance(instance.copy(latestRevisionId = revision.revisionId, revisionCount = 1))
            insertRevision(revision)
            return CaptureWriteResult(instanceId = newInstanceId, revisionAdded = true, instanceCreated = true)
        }
        val latest = latestRevision(existing.accountId, existing.instanceId)
        val candidate = revisionFactory(existing.instanceId, newRevisionId)
        if (latest != null && latest.contentHash == candidate.contentHash) {
            touchInstance(existing.accountId, existing.instanceId, now)
            return CaptureWriteResult(existing.instanceId, revisionAdded = false, instanceCreated = false)
        }
        insertRevision(candidate)
        updateInstance(
            existing.copy(
                latestRevisionId = candidate.revisionId,
                revisionCount = existing.revisionCount + 1,
                lastSeenAt = now,
                removedAt = 0,
                status = "active",
                postTime = candidate.capturedAt,
            ),
        )
        return CaptureWriteResult(existing.instanceId, revisionAdded = true, instanceCreated = false)
    }
}

data class NotificationHistoryRow(
    val instanceId: String,
    val sourcePackage: String,
    val postTime: Long,
    val status: String,
    val removedAt: Long,
    val revisionCount: Int,
    val latestRevisionId: String,
    val financeLinked: Int,
    val pinned: Int = 0,
    val revisionId: String,
    val title: String,
    val text: String,
    val bigText: String,
    val subText: String,
    val summaryText: String,
    val textLines: String,
    val parseStatus: String,
    val direction: String,
    val amountMinor: Long,
    val currency: String,
    val merchant: String,
    val capturedAt: Long,
)

data class NotificationPackageCount(
    val sourcePackage: String,
    val count: Int,
    val lastPostTime: Long,
)

data class CaptureWriteResult(
    val instanceId: String,
    val revisionAdded: Boolean,
    val instanceCreated: Boolean,
)
