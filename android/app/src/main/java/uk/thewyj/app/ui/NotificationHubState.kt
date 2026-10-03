package uk.thewyj.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.snapshots.Snapshot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import uk.thewyj.app.task21.store.NotificationHistoryItem
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.NotificationRepository
import uk.thewyj.app.task21.store.NotificationRuleEntity
import uk.thewyj.app.task21.store.NotificationStoreStats
import uk.thewyj.app.task21.store.NotificationRevisionEntity
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.payment.PendingReviewReconciler

/**
 * Screen state for the native notification hub. Kept outside the composables so
 * the UI files stay small and the query/refresh behaviour is unit testable.
 */
class NotificationHubState(
    context: Context,
    val accountId: String,
    deleteWriter: (suspend (List<String>) -> Int)? = null,
    pinWriter: (suspend (String, Boolean) -> Boolean)? = null,
    historyReader: (suspend (NotificationQuery) -> List<NotificationHistoryItem>)? = null,
) {
    private val appContext = context.applicationContext
    private val repository = NotificationRepository(context.applicationContext, accountId)
    private val readHistory = historyReader ?: repository::history
    private val writeDelete = deleteWriter ?: repository::deleteSnapshots
    private val writePin = pinWriter ?: repository::setPinned
    private val pendingActions = mutableStateMapOf<String, Boolean>()
    private fun pendingPresentation(row: NotificationHistoryItem): NotificationHistoryItem =
        if (pendingActions.containsKey("pin:${row.instanceId}")) row.copy(pinned = pendingActions.getValue("pin:${row.instanceId}")) else row
    var actionMessage by mutableStateOf("")
    fun clearActionMessage() { actionMessage = "" }
    fun actionPending(item: NotificationHistoryItem): Boolean =
        pendingActions.containsKey("delete:${item.revisionId}") || pendingActions.containsKey("pin:${item.instanceId}")
    private val historyGeneration = java.util.concurrent.atomic.AtomicLong()
    private var historyRead: Deferred<HistoryRead>? = null
    private var lastLoadedQuery: NotificationQuery? = null
    var loadingMore by mutableStateOf(false)
        private set

    private data class HistoryRead(
        val rows: List<NotificationHistoryItem>,
        val stats: NotificationStoreStats,
        val retentionDays: Int,
        val pinnedCount: Int,
    )
    private val paymentStore: PaymentRecognitionStoreContract =
        RoomPaymentRecognitionStore(NotificationDatabase.get(context.applicationContext))
    private val credentialStore = uk.thewyj.app.core.auth.SecureCredentialStore(context.applicationContext)
    private val api = uk.thewyj.app.core.network.ThewyjApiClient()

    /** Emits whenever the listener stores or updates a notification. */
    val changes = repository.historyChanges()

    /** Latest stored notification identity, used for the capture timing trace. */
    val latestChange = repository.latestChangeIdentity()

    /** Favourite count, shown in the retention section. */
    var pinnedCount by mutableStateOf(0)

    var search by mutableStateOf("")
    var appFilter by mutableStateOf("")
    var includeRemoved by mutableStateOf(true)
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var stats by mutableStateOf(NotificationStoreStats(0, 0, 0, 0))
    var settingsRetentionDays by mutableStateOf(NotificationRepositoryRetentionDefault)
    var appEntries by mutableStateOf<List<NotificationRepository.AppEntry>>(emptyList())
    var rules by mutableStateOf<List<NotificationRuleEntity>>(emptyList())
    val items: SnapshotStateList<NotificationHistoryItem> = mutableStateListOf()
    val selected: SnapshotStateList<String> = mutableStateListOf()
    var detail by mutableStateOf<NotificationHistoryItem?>(null)
    var detailRevisions by mutableStateOf<List<NotificationRevisionEntity>>(emptyList())
    var hasMore by mutableStateOf(false)
        private set
    private var visibleLimit = HISTORY_PAGE_SIZE

    /** Same canonical server-backed actionable count as /finance. */
    var pendingPayments by mutableStateOf(0)

    /** Recognitions this device still has to verify or confirm. */
    var localPendingPayments by mutableStateOf(0)

    /** Hints + complete candidates the Finance page lists for confirmation. */
    var remotePendingPayments by mutableStateOf(0)

    var sharedPendingPayments by mutableStateOf(0)
    var localOnlyPendingPayments by mutableStateOf(0)
    var remoteOnlyPendingPayments by mutableStateOf(0)
    var pendingObservationAt by mutableStateOf("")
    var pendingSyncCurrent by mutableStateOf(false)
    var unresolvedPendingPayments by mutableStateOf(0)
    private var pendingGeneration = 0

    private fun query() = NotificationQuery(
        search = search,
        sourcePackage = appFilter,
        includeRemoved = includeRemoved,
        // Ask for one sentinel row so the UI can offer an explicit next page
        // without counting or composing the whole archive.
        limit = visibleLimit + 1,
    )

    suspend fun refresh() {
        val generation = historyGeneration.incrementAndGet()
        val requested = query()
        historyRead?.cancel()
        loading = true
        error = ""
        try {
            val result = coroutineScope {
                val read = async {
                    HistoryRead(readHistory(requested), repository.stats(),
                        repository.settings().retentionDays, repository.pinnedCount())
                }
                historyRead = read
                read.await()
            }
            if (generation != historyGeneration.get()) return
            val next = result.rows.filterNot { pendingActions.containsKey("delete:${it.revisionId}") }
                .take(visibleLimit).map(::pendingPresentation)
            Snapshot.withMutableSnapshot {
                // Preserve unchanged row identities; pinned/status changes replace one row.
                for (index in next.indices) {
                    if (index >= items.size) items.add(next[index])
                    else if (items[index] != next[index]) items[index] = next[index]
                }
                while (items.size > next.size) items.removeAt(items.lastIndex)
                hasMore = result.rows.size > visibleLimit
                selected.clear()
                stats = result.stats
                settingsRetentionDays = result.retentionDays
                pinnedCount = result.pinnedCount
            }
            lastLoadedQuery = requested
        } catch (cancelled: CancellationException) {
            // Superseding a read must not cancel its caller's completed pin/delete action.
            if (!currentCoroutineContext().isActive) throw cancelled
        } catch (failure: Throwable) {
            if (generation == historyGeneration.get()) error = failure.message ?: "读取通知历史失败"
        } finally {
            if (generation == historyGeneration.get()) {
                loading = false
                historyRead = null
            }
        }
    }

    suspend fun refreshIfNeeded() {
        if (lastLoadedQuery != query()) refresh()
    }

    suspend fun refreshApps() {
        appEntries = repository.appEntries()
    }

    suspend fun refreshRules() {
        rules = repository.rules()
    }

    suspend fun refreshPendingPayments() {
        val generation = ++pendingGeneration
        // Real-device crash fix: Room/Keystore access must never run on the main
        // thread, otherwise Android throws
        // "Cannot access database on the main thread" from the Compose frame.
        val result = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            // Persist cloud terminal outcomes before counting local attention rows.
            // A display-only set subtraction left those rows actionable in the
            // verification screen even after Finance had no pending candidates.
            val hintSync = uk.thewyj.app.task21.payment.PaymentHintSync(appContext)
            runCatching { hintSync.sync() }
            // The banner is the entry point to the native pending-verification
            // screen, so it counts exactly what that screen lists: local
            // recognitions that still need the user. Backend candidates are
            // reported separately instead of being summed, otherwise an
            // uploaded payment would be counted twice.
            val localBefore = paymentStore.recognitionsByState(
                accountId,
                uk.thewyj.app.task21.payment.PaymentVerificationCenter.ATTENTION_STATES,
            )
            val credentials = runCatching { credentialStore.loadActive() }.getOrNull()
            val archive = uk.thewyj.app.task21.store.RoomNotificationStore(NotificationDatabase.get(appContext))
            val requested = localBefore.flatMap { row ->
                listOf(row.uploadEventId) + archive.structuredEventIdsForRecognition(accountId, row.sourceEventId)
            }.filter(String::isNotBlank).distinct()
            val cache = uk.thewyj.app.task21.payment.CanonicalPendingCache(appContext, accountId)
            val pullEpoch = cache.epoch()
            val fetched = if (credentials != null && credentials.accessToken.isNotBlank()) {
                when (val response = api.pendingReviewSummary(credentials.accessToken, requested)) {
                    is uk.thewyj.app.core.network.ApiCall.Success -> response.value
                    is uk.thewyj.app.core.network.ApiCall.Failure -> null
                }
            } else {
                null
            }
            val observation = fetched?.let { hintSync.applySummary(accountId, it, pullEpoch) }
            val remote = if (observation?.completeObservation == true) fetched else cache.read()
            val local = paymentStore.recognitionsByState(
                accountId,
                uk.thewyj.app.task21.payment.PaymentVerificationCenter.ATTENTION_STATES,
            )
            val observedIds = remote?.records.orEmpty().flatMap { it.eventIds }.toSet()
            val resolved = local.map { row ->
                val matches = archive.structuredEventIdsForRecognition(accountId, row.sourceEventId)
                    .filter(observedIds::contains).distinct()
                if (matches.size == 1 && row.uploadEventId != matches.single()) {
                    row.copy(uploadEventId = matches.single())
                } else row
            }
            android.util.Log.i("ThewyjPending", "cloudN=${remote?.totalCount ?: -1} localN=${resolved.size}")
            val center = uk.thewyj.app.task21.payment.PaymentVerificationCenter(appContext)
            val recovery = if (observation?.completeObservation == true) {
                center.reconciledItems(accountId, observation).filter { it.recoveryOnly }
            } else {
                center.localItems(accountId).filter { it.recoveryOnly }
            }
            Triple(resolved, remote to (observation?.completeObservation == true), recovery)
        }
        if (generation != pendingGeneration) return
        val local = result.first
        val remote = result.second.first
        val fresh = result.second.second
        val recovery = result.third
        localPendingPayments = recovery.size
        if (remote == null) {
            pendingPayments = local.size
            remotePendingPayments = 0
            sharedPendingPayments = 0
            localOnlyPendingPayments = recovery.size
            remoteOnlyPendingPayments = 0
            pendingObservationAt = ""
            pendingSyncCurrent = false
            unresolvedPendingPayments = recovery.count { it.eventIds.isEmpty() }
            return
        }
        val reconciled = PendingReviewReconciler.reconcile(local, remote)
        pendingPayments = reconciled.total
        remotePendingPayments = reconciled.remote
        sharedPendingPayments = reconciled.overlap
        localOnlyPendingPayments = recovery.size
        remoteOnlyPendingPayments = reconciled.remoteOnly
        pendingObservationAt = reconciled.observedAt
        pendingSyncCurrent = fresh && reconciled.complete && reconciled.localOnly == 0
        unresolvedPendingPayments = recovery.count { it.eventIds.isEmpty() }
    }

    suspend fun setSearch(value: String) {
        setSearchText(value)
        refresh()
    }

    fun setSearchText(value: String) {
        if (search == value) return
        search = value
        visibleLimit = HISTORY_PAGE_SIZE
        historyGeneration.incrementAndGet()
        historyRead?.cancel()
    }

    suspend fun setAppFilter(value: String) {
        appFilter = value
        visibleLimit = HISTORY_PAGE_SIZE
        refresh()
    }

    suspend fun loadMore() {
        if (!hasMore || loading || loadingMore || pendingActions.keys.any { it.startsWith("delete:") }) return
        val generation = historyGeneration.get()
        val offset = items.size
        loadingMore = true
        try {
            val next = readHistory(query().copy(limit = HISTORY_PAGE_SIZE + 1, offset = offset))
            if (generation != historyGeneration.get() || offset != items.size) return
            hasMore = next.size > HISTORY_PAGE_SIZE
            val existing = items.map { it.revisionId }.toSet()
            items.addAll(next.take(HISTORY_PAGE_SIZE).filterNot { it.revisionId in existing }.map(::pendingPresentation))
            visibleLimit = items.size.coerceAtLeast(HISTORY_PAGE_SIZE)
            lastLoadedQuery = query()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Throwable) {
            if (generation == historyGeneration.get()) error = failure.message ?: "读取通知历史失败"
        } finally { loadingMore = false }
    }

    /** Selection tracks saved snapshots, matching what the list shows. */
    suspend fun toggleSelection(revisionId: String) {
        if (selected.contains(revisionId)) selected.remove(revisionId) else selected.add(revisionId)
    }

    fun selectAll() {
        selected.clear()
        selected.addAll(items.map { it.revisionId })
    }

    fun clearSelection() {
        selected.clear()
    }

    suspend fun deleteSelected(): Int {
        return deleteOptimistically(selected.toList())
    }

    suspend fun deleteOne(revisionId: String): Int {
        return deleteOptimistically(listOf(revisionId))
    }

    private suspend fun deleteOptimistically(requested: List<String>): Int {
        val ids = requested.distinct().filter { id ->
            !pendingActions.containsKey("delete:$id") && items.firstOrNull { it.revisionId == id }?.let { !actionPending(it) } == true
        }.toSet()
        if (ids.isEmpty()) return 0
        val backup = items.mapIndexedNotNull { index, item -> if (item.revisionId in ids) index to item else null }
        val selectedBefore = selected.filter { it in ids }
        ids.forEach { pendingActions["delete:$it"] = true }
        val generation = historyGeneration.incrementAndGet()
        historyRead?.cancel(); loading = false
        items.removeAll { it.revisionId in ids }; selected.removeAll(ids)
        // Complete the accepted local transaction even if navigation disposes its caller.
        return withContext(NonCancellable) {
            try {
                writeDelete(ids.toList())
            } catch (failure: Exception) {
                if (historyGeneration.get() == generation) {
                    backup.forEach { (index, item) ->
                        if (items.none { it.revisionId == item.revisionId }) items.add(index.coerceAtMost(items.size), item)
                    }
                    selected.addAll(selectedBefore.filter { !selected.contains(it) })
                } else {
                    ids.forEach { pendingActions.remove("delete:$it") }
                    refresh() // A different query owns the list; never restore old-query rows.
                }
                actionMessage = "删除失败，已恢复通知，请稍后重试。"
                0
            } finally { ids.forEach { pendingActions.remove("delete:$it") } }
        }.also {
            // Counters are independent from the committed deletion result.
            runCatching { stats = repository.stats(); pinnedCount = repository.pinnedCount() }
        }
    }

    /** Favourite / unfavourite one notification; favourites survive retention. */
    suspend fun togglePinned(item: NotificationHistoryItem): Boolean {
        if (actionPending(item)) return items.firstOrNull { it.revisionId == item.revisionId }?.pinned ?: item.pinned
        val next = !item.pinned
        val key = "pin:${item.instanceId}"
        pendingActions[key] = next
        fun patch(value: Boolean) {
            for (index in items.indices) if (items[index].instanceId == item.instanceId && items[index].pinned != value) {
                items[index] = items[index].copy(pinned = value)
            }
            if (detail?.instanceId == item.instanceId) detail = detail?.copy(pinned = value)
        }
        val delta = if (next) 1 else -1
        patch(next); pinnedCount = (pinnedCount + delta).coerceAtLeast(0)
        return withContext(NonCancellable) {
            try {
                check(writePin(item.instanceId, next)) { "notification no longer exists" }
                next
            } catch (failure: Exception) {
                patch(item.pinned); pinnedCount = (pinnedCount - delta).coerceAtLeast(0)
                actionMessage = "收藏失败，已恢复原状态，请稍后重试。"
                item.pinned
            } finally { pendingActions.remove(key) }
        }
    }

    suspend fun openDetail(item: NotificationHistoryItem) {
        detail = item
        detailRevisions = if (item.revisionCount > 1) repository.recentRevisions(item.instanceId) else emptyList()
    }

    suspend fun loadMoreRevisions() {
        val item = detail ?: return
        val next = repository.recentRevisions(item.instanceId, offset = detailRevisions.size)
        if (detail?.instanceId == item.instanceId) detailRevisions = detailRevisions + next
    }

    fun closeDetail() {
        detail = null
        detailRevisions = emptyList()
    }

    suspend fun clearAll(): Int {
        val removed = repository.clear()
        refresh()
        return removed
    }

    suspend fun appLabel(packageName: String): String = repository.appLabel(packageName)

    /** Local picture file for a snapshot (Task 24.1 P0-1 media history). */
    suspend fun mediaFile(relativePath: String): java.io.File? = repository.mediaFile(relativePath)

    suspend fun setAppPolicy(packageName: String, enabled: Boolean) {
        repository.setAppPolicy(packageName, enabled)
        refreshApps()
    }

    suspend fun setAllAppPolicies(enabled: Boolean) {
        repository.setAllPolicies(appEntries.map { it.packageName }, enabled)
        refreshApps()
    }

    suspend fun saveRule(rule: NotificationRuleEntity) {
        repository.saveRule(rule)
        refreshRules()
    }

    suspend fun deleteRule(ruleId: String) {
        repository.deleteRule(ruleId)
        refreshRules()
    }

    suspend fun retentionPreview(days: Int): Int = repository.retentionPreview(days)

    suspend fun updateRetention(days: Int): Int {
        repository.updateRetention(days)
        val removed = repository.applyRetention(days)
        settingsRetentionDays = repository.settings().retentionDays
        refresh()
        return removed
    }

    companion object {
        /** Mirrors RoomNotificationStore.DEFAULT_RETENTION_DAYS without a hard constant here. */
        const val NotificationRepositoryRetentionDefault = 30
        const val HISTORY_PAGE_SIZE = 50
    }
}
