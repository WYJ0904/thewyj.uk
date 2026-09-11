package uk.thewyj.app.task21.store

import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/**
 * Everything the capture pipeline needs to persist and query notifications.
 *
 * Identity rules (Phase 2):
 *  - a notification with a key maps to the live instance for that key;
 *  - without a key it maps to the live instance for package + id + tag;
 *  - a notification that has been removed starts a NEW instance on repost, so
 *    history keeps both lifecycles instead of merging them;
 *  - identical content is never a reason to merge two notifications.
 */
data class NotificationCapture(
    val sourcePackage: String,
    val sourceType: String,
    val notificationKey: String,
    val notificationId: Int,
    val tag: String,
    val groupKey: String,
    val channelId: String,
    val postTime: Long,
    val isGroup: Boolean,
    val isGroupSummary: Boolean,
    val title: String,
    val text: String,
    val bigText: String,
    val subText: String,
    val infoText: String = "",
    val summaryText: String = "",
    val textLines: List<String> = emptyList(),
    val parseStatus: String = "UNPARSED",
    val direction: String = "UNKNOWN",
    val amountMinor: Long = 0,
    val currency: String = "CNY",
    val merchant: String = "",
    val confidence: Int = 0,
)

data class NotificationHistoryItem(
    val instanceId: String,
    val sourcePackage: String,
    val postTime: Long,
    val status: String,
    val removedAt: Long,
    val revisionCount: Int,
    val financeLinked: Boolean,
    val title: String,
    val text: String,
    val bigText: String,
    val subText: String,
    val summaryText: String,
    val textLines: List<String>,
    val parseStatus: String,
    val direction: String,
    val amountMinor: Long,
    val currency: String,
    val merchant: String,
    val capturedAt: Long,
)

data class NotificationQuery(
    val search: String = "",
    val sourcePackage: String = "",
    val fromTime: Long = 0,
    val toTime: Long = 0,
    val includeRemoved: Boolean = true,
    val limit: Int = 100,
    val offset: Int = 0,
)

data class NotificationStoreStats(
    val activeCount: Int,
    val revisionCount: Int,
    val storedCharacters: Long,
    val enabledApps: Int,
)

class RoomNotificationStore(private val database: NotificationDatabase) {
    private val dao get() = database.notificationDao()

    /**
     * Persists one capture. Returns the instance id when a new revision was
     * stored, or null when the callback was an exact replay of the latest
     * revision (nothing new to record).
     */
    fun record(accountId: String, capture: NotificationCapture, now: Long = System.currentTimeMillis()): String? {
        val account = accountId.trim()
        if (account.isEmpty()) return null
        val packageName = capture.sourcePackage.trim()
        if (packageName.isEmpty()) return null
        val traceId = uk.thewyj.app.task21.CaptureTrace.traceId(
            capture.notificationKey,
            packageName,
            capture.notificationId,
        )
        val contentHash = contentHash(capture)
        val identityKey = identityKey(capture)
        val instanceId = "inst-" + UUID.randomUUID()
        val revisionId = "rev-" + UUID.randomUUID()
        val result = dao.recordCapture(
            accountId = account,
            identityKey = identityKey,
            newInstanceId = instanceId,
            newRevisionId = revisionId,
            now = now,
            instanceFactory = { createdInstanceId ->
                NotificationInstanceEntity(
                    instanceId = createdInstanceId,
                    accountId = account,
                    identityKey = identityKey,
                    sourcePackage = packageName,
                    sourceType = capture.sourceType,
                    notificationKey = capture.notificationKey,
                    notificationId = capture.notificationId,
                    tag = capture.tag,
                    groupKey = capture.groupKey,
                    channelId = capture.channelId,
                    postTime = if (capture.postTime > 0) capture.postTime else now,
                    firstSeenAt = now,
                    lastSeenAt = now,
                    removedAt = 0,
                    status = "active",
                    revisionCount = 1,
                    latestRevisionId = revisionId,
                    isGroup = if (capture.isGroup) 1 else 0,
                    isGroupSummary = if (capture.isGroupSummary) 1 else 0,
                    financeLinked = 0,
                )
            },
            revisionFactory = { targetInstanceId, createdRevisionId ->
                NotificationRevisionEntity(
                    revisionId = createdRevisionId,
                    instanceId = targetInstanceId,
                    accountId = account,
                    title = capture.title,
                    text = capture.text,
                    bigText = capture.bigText,
                    subText = capture.subText,
                    infoText = capture.infoText,
                    summaryText = capture.summaryText,
                    textLines = capture.textLines.joinToString("\n"),
                    contentHash = contentHash,
                    capturedAt = if (capture.postTime > 0) capture.postTime else now,
                    parseStatus = capture.parseStatus,
                    direction = capture.direction,
                    amountMinor = capture.amountMinor,
                    currency = capture.currency,
                    merchant = capture.merchant,
                    confidence = capture.confidence,
                )
            },
        )
        return if (result.revisionAdded) {
            uk.thewyj.app.task21.CaptureTrace.stage(traceId, "room-committed", "instance=${result.instanceId}")
            result.instanceId
        } else {
            uk.thewyj.app.task21.CaptureTrace.stage(traceId, "room-replay-no-change")
            null
        }
    }

    fun markRemoved(accountId: String, notificationKey: String, removedAt: Long = System.currentTimeMillis()): Int {
        if (notificationKey.isBlank()) return 0
        return dao.markRemovedByKey(accountId.trim(), notificationKey, removedAt)
    }

    fun markRemovedByInstance(accountId: String, instanceId: String, removedAt: Long = System.currentTimeMillis()): Int =
        dao.markRemoved(accountId.trim(), instanceId, removedAt)

    fun history(accountId: String, query: NotificationQuery): List<NotificationHistoryItem> =
        dao.history(
            accountId = accountId.trim(),
            includeRemoved = if (query.includeRemoved) 1 else 0,
            packageFilter = query.sourcePackage.trim(),
            fromTime = query.fromTime,
            toTime = query.toTime,
            query = query.search.trim(),
            limit = query.limit.coerceIn(1, 500),
            offset = query.offset.coerceAtLeast(0),
        ).map { row ->
            NotificationHistoryItem(
                instanceId = row.instanceId,
                sourcePackage = row.sourcePackage,
                postTime = row.postTime,
                status = row.status,
                removedAt = row.removedAt,
                revisionCount = row.revisionCount,
                financeLinked = row.financeLinked == 1,
                title = row.title,
                text = row.text,
                bigText = row.bigText,
                subText = row.subText,
                summaryText = row.summaryText,
                textLines = if (row.textLines.isBlank()) emptyList() else row.textLines.split("\n"),
                parseStatus = row.parseStatus,
                direction = row.direction,
                amountMinor = row.amountMinor,
                currency = row.currency,
                merchant = row.merchant,
                capturedAt = row.capturedAt,
            )
        }

    /**
     * Emits whenever anything is stored for the account. The notification hub
     * collects this flow, so a captured notification appears in the UI as soon
     * as the listener writes it instead of waiting for a manual refresh.
     */
    fun observeChanges(accountId: String): Flow<Unit> {
        val account = accountId.trim()
        return combine(
            dao.observeInstanceCount(account),
            dao.observeRevisionCount(account),
        ) { _, _ -> Unit }
    }

    /** Latest stored notification identity, used for the render timing trace. */
    fun observeLatestIdentity(accountId: String): Flow<String?> =
        dao.observeLatestIdentity(accountId.trim())

    fun historyCount(accountId: String, query: NotificationQuery): Int = dao.historyCount(
        accountId = accountId.trim(),
        includeRemoved = if (query.includeRemoved) 1 else 0,
        packageFilter = query.sourcePackage.trim(),
        fromTime = query.fromTime,
        toTime = query.toTime,
        query = query.search.trim(),
    )

    fun revisions(accountId: String, instanceId: String): List<NotificationRevisionEntity> =
        dao.revisions(accountId.trim(), instanceId)

    fun countsByPackage(accountId: String): List<NotificationPackageCount> = dao.countsByPackage(accountId.trim())

    fun stats(accountId: String): NotificationStoreStats {
        val account = accountId.trim()
        return NotificationStoreStats(
            activeCount = dao.activeCount(account),
            revisionCount = dao.revisionCount(account),
            storedCharacters = dao.storedCharacters(account),
            enabledApps = dao.enabledAppCount(account),
        )
    }

    fun delete(accountId: String, instanceIds: List<String>): Int {
        if (instanceIds.isEmpty()) return 0
        return dao.deleteInstances(accountId.trim(), instanceIds)
    }

    fun clearAccount(accountId: String): Int = dao.clearAccount(accountId.trim())

    fun markFinanceLinked(accountId: String, instanceId: String): Int =
        dao.markFinanceLinked(accountId.trim(), instanceId)

    /**
     * Retention purge. Finance-linked notifications are never deleted here, so
     * shortening retention cannot remove a confirmed transaction's evidence.
     */
    fun purgeExpired(accountId: String, cutoffMs: Long, limit: Int = 500): Int {
        if (cutoffMs <= 0) return 0
        val account = accountId.trim()
        val candidates = dao.purgeCandidates(account, cutoffMs, limit)
        return if (candidates.isEmpty()) 0 else dao.deleteInstances(account, candidates)
    }

    fun estimatedPurgeCount(accountId: String, cutoffMs: Long, limit: Int = 500): Int =
        if (cutoffMs <= 0) 0 else dao.purgeCandidates(accountId.trim(), cutoffMs, limit).size

    fun setAppPolicy(accountId: String, sourcePackage: String, enabled: Boolean, updatedAt: Long = System.currentTimeMillis()) =
        dao.upsertAppPolicy(
            NotificationAppPolicyEntity(accountId.trim(), sourcePackage.trim(), if (enabled) 1 else 0, updatedAt),
        )

    fun appPolicies(accountId: String): List<NotificationAppPolicyEntity> = dao.appPolicies(accountId.trim())

    fun isCaptureAllowed(accountId: String, sourcePackage: String): Boolean {
        val policies = dao.appPolicies(accountId.trim())
        if (policies.isEmpty()) return false
        return policies.firstOrNull { it.sourcePackage == sourcePackage.trim() }?.enabled == 1
    }

    fun upsertRule(rule: NotificationRuleEntity) = dao.upsertRule(rule)

    fun rules(accountId: String): List<NotificationRuleEntity> = dao.rules(accountId.trim())

    fun deleteRule(accountId: String, ruleId: String): Int = dao.deleteRule(accountId.trim(), ruleId)

    fun settings(accountId: String): NotificationSettingsEntity? = dao.settings(accountId.trim())

    fun ensureSettings(accountId: String, defaultRetentionDays: Int = DEFAULT_RETENTION_DAYS): NotificationSettingsEntity {
        val account = accountId.trim()
        val existing = dao.settings(account)
        if (existing != null) return existing
        val created = NotificationSettingsEntity(
            accountId = account,
            retentionDays = defaultRetentionDays,
            legacyMigrationState = "pending",
            legacyImportedCount = 0,
            updatedAt = System.currentTimeMillis(),
        )
        dao.upsertSettings(created)
        return created
    }

    fun updateSettings(settings: NotificationSettingsEntity) =
        dao.upsertSettings(settings.copy(updatedAt = System.currentTimeMillis()))

    private fun identityKey(capture: NotificationCapture): String {
        val key = capture.notificationKey.trim()
        if (key.isNotEmpty()) return "key:$key"
        val tag = capture.tag.trim()
        if (capture.notificationId != 0 || tag.isNotEmpty()) {
            return "slot:${capture.sourcePackage.trim()}:${capture.notificationId}:$tag"
        }
        // No identity available from the platform: every callback is its own
        // notification rather than risking a false merge.
        return "anon:${UUID.randomUUID()}"
    }

    private fun contentHash(capture: NotificationCapture): String {
        val canonical = listOf(
            capture.title, capture.text, capture.bigText, capture.subText,
            capture.infoText, capture.summaryText, capture.textLines.joinToString("\n"),
        ).joinToString("\u0000")
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val DEFAULT_RETENTION_DAYS = 30
    }
}
