package uk.thewyj.app.task21.store

import android.content.Context
import android.content.pm.PackageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Read/write API for the notification screens: history, filters, per-app
 * policies, rules, retention settings and local statistics.
 *
 * App display names and icons come from PackageManager so users never see raw
 * package names unless they open the diagnostic detail view.
 */
class NotificationRepository(
    private val context: Context,
    val accountId: String,
) {
    private val database get() = NotificationDatabase.get(context)
    private val store get() = RoomNotificationStore(database)

    data class AppEntry(
        val packageName: String,
        val label: String,
        val enabled: Boolean,
        val installed: Boolean,
    )

    suspend fun history(query: NotificationQuery): List<NotificationHistoryItem> = withContext(Dispatchers.IO) {
        runCatching { LegacyArchiveMigration(database).migrateIfNeeded(context.filesDir, accountId) }
        store.history(accountId, query)
    }

    suspend fun historyCount(query: NotificationQuery): Int = withContext(Dispatchers.IO) {
        store.historyCount(accountId, query)
    }

    suspend fun stats(): NotificationStoreStats = withContext(Dispatchers.IO) { store.stats(accountId) }

    suspend fun packagesWithCounts(): List<NotificationPackageCount> = withContext(Dispatchers.IO) {
        store.countsByPackage(accountId)
    }

    suspend fun revisions(instanceId: String): List<NotificationRevisionEntity> = withContext(Dispatchers.IO) {
        store.revisions(accountId, instanceId)
    }

    suspend fun delete(instanceIds: List<String>): Int = withContext(Dispatchers.IO) {
        store.delete(accountId, instanceIds)
    }

    suspend fun clear(): Int = withContext(Dispatchers.IO) { store.clearAccount(accountId) }

    suspend fun appEntries(): List<AppEntry> = withContext(Dispatchers.IO) {
        val policies = store.appPolicies(accountId).associateBy { it.sourcePackage }
        val manager = context.packageManager
        val packages = runCatching {
            manager.getInstalledApplications(PackageManager.GET_META_DATA)
        }.getOrDefault(emptyList())
        val entries = packages.map { info ->
            AppEntry(
                packageName = info.packageName,
                label = runCatching { manager.getApplicationLabel(info).toString() }.getOrDefault(info.packageName),
                enabled = policies[info.packageName]?.enabled == 1,
                installed = true,
            )
        }.sortedBy { it.label }
        val knownButMissing = policies.keys
            .filter { key -> entries.none { it.packageName == key } }
            .map { AppEntry(it, it, policies[it]?.enabled == 1, installed = false) }
        entries + knownButMissing
    }

    suspend fun setAppPolicy(packageName: String, enabled: Boolean) = withContext(Dispatchers.IO) {
        store.setAppPolicy(accountId, packageName, enabled)
    }

    suspend fun setAllPolicies(packages: List<String>, enabled: Boolean) = withContext(Dispatchers.IO) {
        packages.forEach { store.setAppPolicy(accountId, it, enabled) }
    }

    suspend fun rules(): List<NotificationRuleEntity> = withContext(Dispatchers.IO) { store.rules(accountId) }

    suspend fun saveRule(rule: NotificationRuleEntity) = withContext(Dispatchers.IO) { store.upsertRule(rule) }

    suspend fun deleteRule(ruleId: String) = withContext(Dispatchers.IO) { store.deleteRule(accountId, ruleId) }

    suspend fun settings(): NotificationSettingsEntity = withContext(Dispatchers.IO) {
        store.ensureSettings(accountId)
    }

    suspend fun updateRetention(days: Int): NotificationSettingsEntity = withContext(Dispatchers.IO) {
        val current = store.ensureSettings(accountId)
        val updated = current.copy(retentionDays = days)
        store.updateSettings(updated)
        updated
    }

    /** Preview of what a shorter retention would delete before the user agrees. */
    suspend fun retentionPreview(days: Int): Int = withContext(Dispatchers.IO) {
        if (days < 0) return@withContext 0
        store.estimatedPurgeCount(accountId, cutoffFor(days))
    }

    suspend fun applyRetention(days: Int): Int = withContext(Dispatchers.IO) {
        if (days < 0) return@withContext 0
        store.purgeExpired(accountId, cutoffFor(days))
    }

    suspend fun appLabel(packageName: String): String = withContext(Dispatchers.IO) {
        runCatching {
            val manager = context.packageManager
            manager.getApplicationLabel(manager.getApplicationInfo(packageName, 0)).toString()
        }.getOrDefault(packageName)
    }

    private fun cutoffFor(days: Int): Long =
        System.currentTimeMillis() - days.toLong() * 24L * 60L * 60L * 1000L
}
