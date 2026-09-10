package uk.thewyj.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import kotlinx.coroutines.launch
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.permission.PermissionCenter
import uk.thewyj.app.task21.store.NotificationHistoryItem
import uk.thewyj.app.task21.store.NotificationRuleEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Native「通知」destination. It is the NotiStar-style hub: history, per-app
 * selector, keyword rules and retention. Raw notification content only exists
 * in this local database.
 */
@Composable
fun NotificationHubScreen(
    account: AccountSnapshot,
    onOpenPermissions: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val entitled = account.entitlements.contains("notification_archive_access") ||
        account.entitlements.contains("all_features_access") ||
        account.isAdmin
    if (!entitled) {
        NotificationEntitlementGate(modifier)
        return
    }
    val context = LocalContext.current
    val state = remember(account.id) { NotificationHubState(context, account.id) }
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    var notificationAccess by remember { mutableStateOf(PermissionCenter.notificationListenerGranted(context)) }

    LifecycleResumeEffect(Unit) {
        notificationAccess = PermissionCenter.notificationListenerGranted(context)
        onPauseOrDispose { }
    }

    LaunchedEffect(account.id) {
        state.refresh()
        state.refreshApps()
        state.refreshRules()
    }

    Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Text(
            "通知历史",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
        )
        Text(
            "保存 ${state.stats.activeCount} 条 · 版本 ${state.stats.revisionCount} · 本地约 ${state.stats.storedCharacters / 1024} KB",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        if (!notificationAccess) {
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("通知访问未开启", fontWeight = FontWeight.SemiBold)
                    Text(
                        "系统通知栏里的通知不会被保存，也无法用于支付金额识别。请在系统设置中允许 thewyj 的通知访问。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onOpenPermissions) { Text("去开启") }
                        TextButton(onClick = { notificationAccess = PermissionCenter.notificationListenerGranted(context) }) {
                            Text("重新检查")
                        }
                    }
                }
            }
        }
        TabRow(selectedTabIndex = tab) {
            listOf("历史", "应用", "规则与保留").forEachIndexed { index, label ->
                Tab(
                    selected = tab == index,
                    onClick = { tab = index },
                    text = { Text(label) },
                )
            }
        }
        when (tab) {
            0 -> NotificationHistorySection(state)
            1 -> NotificationAppsSection(state, scope)
            else -> NotificationRulesSection(state, scope)
        }
    }
}

@Composable
private fun NotificationEntitlementGate(modifier: Modifier) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("通知保存未开通", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            "当前账户未包含通知保存权益，采集与本地历史保持关闭。财务识别不受影响。",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotificationHistorySection(state: NotificationHubState) {
    val scope = rememberCoroutineScope()
    val appLabels = remember { mutableStateMapOf<String, String>() }
    val filterPackages = remember(state.items.toList()) {
        state.items.map { it.sourcePackage }.distinct().take(8)
    }
    LaunchedEffect(filterPackages) {
        filterPackages.forEach { packageName ->
            if (!appLabels.containsKey(packageName)) appLabels[packageName] = state.appLabel(packageName)
        }
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = state.search,
            onValueChange = { value -> scope.launch { state.setSearch(value) } },
            label = { Text("搜索标题或内容") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        )
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("包含已移除", style = MaterialTheme.typography.bodySmall)
            Switch(
                checked = state.includeRemoved,
                onCheckedChange = { value ->
                    state.includeRemoved = value
                    scope.launch { state.refresh() }
                },
            )
            if (state.selected.isEmpty()) {
                OutlinedButton(onClick = { state.selectAll() }) { Text("全选") }
            } else {
                OutlinedButton(onClick = { state.clearSelection() }) { Text("取消选择") }
            }
            if (state.selected.isNotEmpty()) {
                Button(onClick = { scope.launch { state.deleteSelected() } }) {
                    Text("删除所选 (${state.selected.size})")
                }
                OutlinedButton(onClick = { scope.launch { state.clearAll() } }) { Text("清空全部") }
            }
        }

        // 按 App 筛选是列表级操作：一条通知卡片上只保留选择与删除。
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = state.appFilter.isBlank(),
                onClick = { scope.launch { state.setAppFilter("") } },
                label = { Text("全部应用", maxLines = 1, softWrap = false) },
            )
            filterPackages.forEach { packageName ->
                FilterChip(
                    selected = state.appFilter == packageName,
                    onClick = {
                        scope.launch { state.setAppFilter(if (state.appFilter == packageName) "" else packageName) }
                    },
                    label = {
                        Text(appLabels[packageName] ?: packageName, maxLines = 1, softWrap = false)
                    },
                )
            }
        }
        if (state.appFilter.isNotBlank()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "仅看：${appLabels[state.appFilter] ?: state.appFilter}",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { scope.launch { state.setAppFilter("") } }) { Text("清除筛选") }
            }
        }
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("正在读取本地通知…") }
            state.error.isNotBlank() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(state.error) }
            state.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("还没有保存任何通知。授权通知访问后，被选中的应用会出现在这里。")
            }
            else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
                items(state.items, key = { it.instanceId }) { item ->
                    NotificationHistoryCard(
                        state = state,
                        item = item,
                        onDelete = { scope.launch { state.deleteOne(item.instanceId) } },
                    )
                }
            }
        }
    }
}

@Composable
private fun NotificationHistoryCard(
    state: NotificationHubState,
    item: NotificationHistoryItem,
    onDelete: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var label by remember(item.sourcePackage) { mutableStateOf<String?>(null) }
    LaunchedEffect(item.sourcePackage) { label = state.appLabel(item.sourcePackage) }
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
            Checkbox(
                checked = state.selected.contains(item.instanceId),
                onCheckedChange = { scope.launch { state.toggleSelection(item.instanceId) } },
            )
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        label ?: item.sourcePackage,
                        style = MaterialTheme.typography.labelLarge,
                        maxLines = 1,
                        softWrap = false,
                    )
                    if (item.status == "removed") {
                        Spacer(Modifier.width(6.dp))
                        Text("已移除", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    }
                }
                Text(
                    item.title.ifBlank { "(无标题)" },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    item.bigText.ifBlank { item.text }.ifBlank { item.summaryText }.ifBlank { "(无正文)" },
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 3,
                )
                Text(
                    "${formatTime(item.postTime)} · 版本 ${item.revisionCount}" +
                        if (item.financeLinked) " · 已关联财务" else "",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(40.dp)) {
                Icon(
                    androidx.compose.material.icons.Icons.Default.Delete,
                    contentDescription = "删除这条通知",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun formatTime(value: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(value))

@Composable
private fun NotificationAppsSection(state: NotificationHubState, scope: kotlinx.coroutines.CoroutineScope) {
    Column(Modifier.fillMaxSize()) {
        FlowRow(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { scope.launch { state.setAllAppPolicies(true) } }) { Text("全选") }
            OutlinedButton(onClick = { scope.launch { state.setAllAppPolicies(false) } }) { Text("全不选") }
            OutlinedButton(onClick = { scope.launch { state.refreshApps() } }) { Text("刷新") }
        }
        Text(
            "只有被选中的应用才会进入本地通知档案；财务识别不受此列表限制。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
            items(state.appEntries, key = { it.packageName }) { entry ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(entry.label, style = MaterialTheme.typography.bodyLarge)
                        if (!entry.installed) {
                            Text("已卸载", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                    Switch(
                        checked = entry.enabled,
                        onCheckedChange = { value -> scope.launch { state.setAppPolicy(entry.packageName, value) } },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun NotificationRulesSection(state: NotificationHubState, scope: kotlinx.coroutines.CoroutineScope) {
    var includeKeywords by remember { mutableStateOf("") }
    var excludeKeywords by remember { mutableStateOf("") }
    var ruleName by remember { mutableStateOf("") }
    val retentionOptions = listOf(-1 to "永久", 1 to "1 天", 3 to "3 天", 7 to "7 天", 30 to "30 天", 90 to "90 天", 365 to "1 年")

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("保留期限", style = MaterialTheme.typography.titleMedium)
        FlowRow(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            retentionOptions.forEach { (days, label) ->
                if (state.settingsRetentionDays == days) {
                    Button(onClick = {}) { Text(label, maxLines = 1, softWrap = false) }
                } else {
                    OutlinedButton(onClick = { scope.launch { state.updateRetention(days) } }) {
                        Text(label, maxLines = 1, softWrap = false)
                    }
                }
            }
        }
        Text(
            "缩短保留期限只会删除已移除且未关联财务的旧通知；财务流水永远不受影响。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        Text("关键词规则", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = ruleName,
            onValueChange = { ruleName = it },
            label = { Text("规则名称") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        )
        OutlinedTextField(
            value = includeKeywords,
            onValueChange = { includeKeywords = it },
            label = { Text("包含关键词（逗号分隔）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        )
        OutlinedTextField(
            value = excludeKeywords,
            onValueChange = { excludeKeywords = it },
            label = { Text("排除关键词（逗号分隔）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        )
        Button(onClick = {
            scope.launch {
                state.saveRule(
                    NotificationRuleEntity(
                        ruleId = "rule-" + UUID.randomUUID(),
                        accountId = state.accountId,
                        name = ruleName.ifBlank { "未命名规则" },
                        enabled = 1,
                        appScope = "*",
                        includeKeywords = includeKeywords,
                        excludeKeywords = excludeKeywords,
                        matchAll = 0,
                        updatedAt = System.currentTimeMillis(),
                    ),
                )
            }
        }) { Text("保存规则") }
        Spacer(Modifier.height(12.dp))
        LazyColumn {
            items(state.rules, key = { it.ruleId }) { rule ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(rule.name, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "包含：${rule.includeKeywords.ifBlank { "—" }} · 排除：${rule.excludeKeywords.ifBlank { "—" }}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    OutlinedButton(onClick = { scope.launch { state.deleteRule(rule.ruleId) } }) { Text("删除") }
                }
            }
        }
    }
}
