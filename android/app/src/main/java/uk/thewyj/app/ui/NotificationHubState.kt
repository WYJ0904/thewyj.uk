package uk.thewyj.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import uk.thewyj.app.task21.store.NotificationHistoryItem
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.NotificationRepository
import uk.thewyj.app.task21.store.NotificationRuleEntity
import uk.thewyj.app.task21.store.NotificationStoreStats
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import uk.thewyj.app.task21.store.NotificationDatabase

/**
 * Screen state for the native notification hub. Kept outside the composables so
 * the UI files stay small and the query/refresh behaviour is unit testable.
 */
class NotificationHubState(
    context: Context,
    val accountId: String,
) {
    private val repository = NotificationRepository(context.applicationContext, accountId)
    private val paymentStore: PaymentRecognitionStoreContract =
        RoomPaymentRecognitionStore(NotificationDatabase.get(context.applicationContext))
    private val credentialStore = uk.thewyj.app.core.auth.SecureCredentialStore(context.applicationContext)
    private val api = uk.thewyj.app.core.network.ThewyjApiClient()

    /** Emits whenever the listener stores or updates a notification. */
    val changes = repository.historyChanges()

    /** Latest stored notification identity, used for the capture timing trace. */
    val latestChange = repository.latestChangeIdentity()

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

    /**
     * Pending review count. The finance page lists backend candidates, so the
     * hub shows the same backend number whenever it is reachable (falling back
     * to the local count offline) and the two screens can never disagree.
     */
    /** Recognitions this device still has to verify or confirm. */
    var pendingPayments by mutableStateOf(0)

    /** Candidates the Finance page still lists for confirmation. */
    var remotePendingPayments by mutableStateOf(0)

    private fun query() = NotificationQuery(
        search = search,
        sourcePackage = appFilter,
        includeRemoved = includeRemoved,
        limit = 200,
    )

    suspend fun refresh() {
        loading = true
        error = ""
        try {
            val results = repository.history(query())
            items.clear()
            items.addAll(results)
            selected.clear()
            stats = repository.stats()
            settingsRetentionDays = repository.settings().retentionDays
        } catch (failure: Throwable) {
            error = failure.message ?: "读取通知历史失败"
        } finally {
            loading = false
        }
    }

    suspend fun refreshApps() {
        appEntries = repository.appEntries()
    }

    suspend fun refreshRules() {
        rules = repository.rules()
    }

    suspend fun refreshPendingPayments() {
        // Real-device crash fix: Room/Keystore access must never run on the main
        // thread, otherwise Android throws
        // "Cannot access database on the main thread" from the Compose frame.
        pendingPayments = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            // The banner is the entry point to the native pending-verification
            // screen, so it counts exactly what that screen lists: local
            // recognitions that still need the user. Backend candidates are
            // reported separately instead of being summed, otherwise an
            // uploaded payment would be counted twice.
            val local = paymentStore.recognitionsByState(
                accountId,
                uk.thewyj.app.task21.payment.PaymentVerificationCenter.ATTENTION_STATES,
            ).size
            val credentials = runCatching { credentialStore.loadActive() }.getOrNull()
            val remote = if (credentials != null && credentials.accessToken.isNotBlank()) {
                when (val result = api.pendingCandidateCount(credentials.accessToken)) {
                    is uk.thewyj.app.core.network.ApiCall.Success -> result.value
                    is uk.thewyj.app.core.network.ApiCall.Failure -> null
                }
            } else {
                null
            }
            remotePendingPayments = remote ?: 0
            local
        }
    }

    suspend fun setSearch(value: String) {
        search = value
        refresh()
    }

    suspend fun setAppFilter(value: String) {
        appFilter = value
        refresh()
    }

    suspend fun toggleSelection(instanceId: String) {
        if (selected.contains(instanceId)) selected.remove(instanceId) else selected.add(instanceId)
    }

    fun selectAll() {
        selected.clear()
        selected.addAll(items.map { it.instanceId })
    }

    fun clearSelection() {
        selected.clear()
    }

    suspend fun deleteSelected(): Int {
        val removed = repository.delete(selected.toList())
        refresh()
        return removed
    }

    suspend fun deleteOne(instanceId: String): Int {
        val removed = repository.delete(listOf(instanceId))
        refresh()
        return removed
    }

    suspend fun clearAll(): Int {
        val removed = repository.clear()
        refresh()
        return removed
    }

    suspend fun appLabel(packageName: String): String = repository.appLabel(packageName)

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
    }
}
