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

/**
 * Screen state for the native notification hub. Kept outside the composables so
 * the UI files stay small and the query/refresh behaviour is unit testable.
 */
class NotificationHubState(
    context: Context,
    val accountId: String,
) {
    private val repository = NotificationRepository(context.applicationContext, accountId)

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
