package uk.thewyj.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Surface
import androidx.compose.material3.ModalBottomSheet
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.permission.PermissionCenter
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.task21.store.NotificationHistoryItem
import uk.thewyj.app.task21.store.NotificationRepository
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
    onOpenFinance: () -> Unit = {},
    onOpenPaymentVerification: () -> Unit = {},
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
        // Snapshot semantics: entering the page loads once. While the user stays
        // here the list never auto-refreshes (no flicker, no scroll jump); new
        // notifications keep being stored in the background.
        state.refresh()
        state.refreshApps()
        state.refreshRules()
        state.refreshPendingPayments()
    }

    // One natural vertical page: pending card + tabs + search/filter + list all
    // scroll together instead of a fixed header over a small scrolling list.
    Box(Modifier.fillMaxSize()) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .background(MaterialTheme.colorScheme.background),
    ) {
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
        if (state.pendingPayments > 0) {
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${state.pendingPayments} 笔交易待核实或待确认", fontWeight = FontWeight.SemiBold)
                    Text(
                        "识别到的支付还没进入账本。可以在这里核实金额、修改并记账，确认后会写入同一个财务账本。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (state.remotePendingPayments > 0) {
                        Text(
                            "云端还有 ${state.remotePendingPayments} 笔候选可在财务页确认。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onOpenPaymentVerification) { Text("去处理") }
                        TextButton(onClick = onOpenFinance) { Text("查看财务") }
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
        // Detail overlay: renders only from the already-loaded safe DTO, so a
        // malformed/null field can never crash the process.
        state.detail?.let { item ->
            NotificationDetailOverlay(
                item = item,
                onClose = { state.detail = null },
                onTogglePinned = { scope.launch { state.togglePinned(item) } },
                loadMedia = { path -> state.mediaFile(path) },
            )
        }
    }
}

@Composable
private fun NotificationDetailOverlay(
    item: NotificationHistoryItem,
    onClose: () -> Unit,
    onTogglePinned: () -> Unit = {},
    loadMedia: suspend (String) -> java.io.File? = { null },
) {
    val context = LocalContext.current
    val appName = remember(item.sourcePackage) {
        uk.thewyj.app.task21.payment.PaymentAppLabels.resolve(context, item.sourcePackage)
    }
    var bitmap by remember(item.revisionId) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var mediaUnavailable by remember(item.revisionId) { mutableStateOf(item.mediaState == "unavailable") }
    LaunchedEffect(item.revisionId) {
        if (item.mediaPath.isBlank()) return@LaunchedEffect
        val file = runCatching { loadMedia(item.mediaPath) }.getOrNull()
        val decoded = file?.let { android.graphics.BitmapFactory.decodeFile(it.absolutePath) }
        bitmap = decoded
        if (decoded == null) mediaUnavailable = true
    }
    BackHandler(enabled = true) { onClose() }
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = onClose, shape = ThewyjRadius.Medium) { Text("返回") }
                Spacer(Modifier.width(12.dp))
                Text(
                    appName,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                )
            }
            Text(
                formatTime(item.postTime) + " · 版本 ${item.revisionCount}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onTogglePinned, shape = ThewyjRadius.Medium) {
                    Text(if (item.pinned) "取消收藏" else "收藏这条通知")
                }
                Text(
                    if (item.pinned) "已收藏：保存期限内不会被自动删除" else "收藏后不会被自动删除",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.CenterVertically),
                )
            }
            if (item.status == "removed") {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    shape = ThewyjRadius.Small,
                ) {
                    Text(
                        "已从系统通知栏移除",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
            DetailField("标题", item.title)
            DetailField("内容", item.bigText.ifBlank { item.text })
            // Task 24.1 P0-1: the picture Android exposed is shown here; when it
            // could not be read the notification still exists and says so.
            when {
                bitmap != null -> Column(Modifier.fillMaxWidth()) {
                    Text("图片", style = MaterialTheme.typography.labelLarge)
                    androidx.compose.foundation.Image(
                        bitmap = bitmap!!.asImageBitmap(),
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        contentDescription = "通知图片",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                    )
                }
                item.mediaState != "none" || mediaUnavailable ->
                    DetailField("图片内容不可用", "该通知包含图片，但 Android 未提供可读取的图片数据；通知元数据已保存。")
                else -> Unit
            }
            if (item.subText.isNotBlank()) DetailField("副标题", item.subText)
            if (item.summaryText.isNotBlank()) DetailField("摘要", item.summaryText)
            if (item.textLines.isNotEmpty()) DetailField("多行内容", item.textLines.joinToString("\n"))
            if (item.merchant.isNotBlank() || item.amountMinor > 0 || item.parseStatus != "UNPARSED") {
                DetailField(
                    "识别结果",
                    buildString {
                        append(item.parseStatus.ifBlank { "UNPARSED" })
                        if (item.direction.isNotBlank() && item.direction != "UNKNOWN") append(" · ${item.direction}")
                        if (item.amountMinor > 0) append(" · ${formatMinor(item.amountMinor, item.currency)}")
                        if (item.merchant.isNotBlank()) append(" · ${item.merchant}")
                        if (item.financeLinked) append(" · 已关联财务")
                    },
                )
            }
            DetailField("来源应用", item.sourcePackage.ifBlank { "未知" })
        }
    }
}

@Composable
private fun DetailField(label: String, value: String) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value.ifBlank { "暂无内容" },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun formatMinor(amountMinor: Long, currency: String): String {
    val symbol = if (currency.equals("CNY", ignoreCase = true)) "¥" else "$currency "
    return "$symbol${"%.2f".format(amountMinor / 100.0)}"
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

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun NotificationHistorySection(state: NotificationHubState) {
    val scope = rememberCoroutineScope()
    val appLabels = remember { mutableStateMapOf<String, String>() }
    var filterSheet by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val filterPackages = remember(state.items.toList()) {
        state.items.map { it.sourcePackage }.distinct().take(12)
    }
    LaunchedEffect(filterPackages) {
        filterPackages.forEach { packageName ->
            if (!appLabels.containsKey(packageName)) appLabels[packageName] = state.appLabel(packageName)
        }
    }

    fun manualRefresh() {
        scope.launch {
            refreshing = true
            state.refresh()
            state.refreshApps()
            state.refreshPendingPayments()
            refreshing = false
        }
    }

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = state.search,
                onValueChange = { value -> scope.launch { state.setSearch(value) } },
                label = { Text("搜索标题或内容") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(onClick = { filterSheet = true }, shape = ThewyjRadius.Medium) {
                Text(if (state.appFilter.isBlank()) "筛选" else "已筛选")
            }
            OutlinedButton(onClick = { manualRefresh() }, enabled = !refreshing, shape = ThewyjRadius.Medium) {
                Text(if (refreshing) "刷新中…" else "刷新")
            }
        }
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
        if (state.appFilter.isNotBlank()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "已筛选：${appLabels[state.appFilter] ?: state.appFilter}",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { scope.launch { state.setAppFilter("") } }) { Text("清除筛选") }
            }
        }
        if (filterSheet) {
            ModalBottomSheet(onDismissRequest = { filterSheet = false }) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("按应用筛选", style = MaterialTheme.typography.titleMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = state.appFilter.isBlank(),
                            onClick = { scope.launch { state.setAppFilter("") } },
                            label = { Text("全部应用", maxLines = 1, softWrap = false) },
                        )
                        filterPackages.forEach { packageName ->
                            FilterChip(
                                selected = state.appFilter == packageName,
                                onClick = {
                                    scope.launch {
                                        state.setAppFilter(if (state.appFilter == packageName) "" else packageName)
                                    }
                                },
                                label = { Text(appLabels[packageName] ?: packageName, maxLines = 1, softWrap = false) },
                            )
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("包含已移除", modifier = Modifier.weight(1f))
                        Switch(
                            checked = state.includeRemoved,
                            onCheckedChange = { value ->
                                state.includeRemoved = value
                                scope.launch { state.refresh() }
                            },
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            state.includeRemoved = true
                            scope.launch { state.setAppFilter("") }
                        }) { Text("重置") }
                        ThewyjPrimaryButton(text = { Text("完成") }, onClick = { filterSheet = false })
                    }
                }
            }
        }
        when {
            state.loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Text("正在读取本地通知…") }
            state.error.isNotBlank() -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Text(state.error) }
            state.items.isEmpty() -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                Text("还没有保存任何通知。授权通知访问后，被选中的应用会出现在这里。")
            }
            else -> Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                state.items.forEach { item ->
                    NotificationHistoryCard(
                        state = state,
                        item = item,
                        onOpen = { state.detail = item },
                        onDelete = { scope.launch { state.deleteOne(item.revisionId) } },
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
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var label by remember(item.sourcePackage) { mutableStateOf<String?>(null) }
    LaunchedEffect(item.sourcePackage) { label = state.appLabel(item.sourcePackage) }
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable(onClick = onOpen)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
            Checkbox(
                checked = state.selected.contains(item.revisionId),
                onCheckedChange = { scope.launch { state.toggleSelection(item.revisionId) } },
            )
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        label ?: item.sourcePackage,
                        style = MaterialTheme.typography.labelLarge,
                        maxLines = 1,
                        softWrap = false,
                    )
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
                if (item.pinned) {
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        shape = ThewyjRadius.Small,
                        modifier = Modifier.padding(top = 2.dp),
                    ) {
                        Text(
                            "已收藏 · 不会被自动删除",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                if (item.mediaState == "available" || item.mediaState == "unavailable") {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        shape = ThewyjRadius.Small,
                        modifier = Modifier.padding(top = 2.dp),
                    ) {
                        Text(
                            if (item.mediaState == "available") "含图片" else "图片内容不可用",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                // History keeps removed notifications; the state is shown as a
                // readable low-weight badge instead of nearly invisible text.
                if (item.status == "removed") {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        shape = ThewyjRadius.Small,
                        modifier = Modifier.padding(top = 2.dp),
                    ) {
                        Text(
                            "已从系统通知栏移除",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
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
    Column(Modifier.fillMaxWidth()) {
        FlowRow(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { scope.launch { state.setAllAppPolicies(true) } }) { Text("全选") }
            OutlinedButton(onClick = { scope.launch { state.setAllAppPolicies(false) } }) { Text("全不选") }
            OutlinedButton(onClick = { scope.launch { state.refreshApps() } }) { Text("刷新") }
        }
        Text(
            "被关闭的应用不会进入本地通知档案，其余应用默认保存；财务识别不受此列表限制。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
            state.appEntries.forEach { entry ->
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
    // Task 24.1: 7 天 / 30 天 / 90 天 / 1 年 / 永久（0 = 不自动删除）。
    val retentionOptions: List<Pair<Int, String>> = listOf(
        7 to "7 天",
        30 to "30 天",
        90 to "90 天",
        365 to "1 年",
        NotificationRepository.PERMANENT_RETENTION_DAYS to "永久",
    )

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
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
            "缩短保留期限只会删除超过期限的旧通知；收藏的通知不自动删除，关联财务的记录永远不受影响。" +
                if (state.pinnedCount > 0) " 当前收藏 ${state.pinnedCount} 条。" else "",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            if (state.settingsRetentionDays == NotificationRepository.PERMANENT_RETENTION_DAYS) {
                "当前为永久保存，不会自动删除任何通知。"
            } else {
                "当前保留 ${state.settingsRetentionDays} 天；占用约 ${state.stats.storedCharacters / 1024} KB / ${state.stats.revisionCount} 个版本。"
            },
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
        Column(Modifier.fillMaxWidth()) {
            state.rules.forEach { rule ->
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
