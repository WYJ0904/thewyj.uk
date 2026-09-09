package uk.thewyj.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.design.ThewyjCard
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjSpacing
import uk.thewyj.app.task21.CaptureCapability
import uk.thewyj.app.task21.CapabilityState
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.HttpNotificationIngestTransport
import uk.thewyj.app.task21.LocalNotificationArchive
import uk.thewyj.app.task21.LocalNotificationRecord
import uk.thewyj.app.task21.NotificationAccessGateway
import uk.thewyj.app.task21.NotificationCaptureCoordinator
import uk.thewyj.app.task21.NotificationOfflineQueue
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.OfflineNotificationQueue
import uk.thewyj.app.task21.ParseStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Native notification archive screen. Full notification text is read only from
 * the app-private local archive; the network fetch only returns structured
 * event/candidate status and is never used to re-download raw content.
 */
@Composable
fun NotificationArchiveScreen(account: AccountSnapshot, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refreshKey by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var records by remember { mutableStateOf<List<LocalNotificationRecord>>(emptyList()) }
    var loadError by remember { mutableStateOf("") }
    var permissionState by remember { mutableStateOf(CapabilityState.NOT_GRANTED) }
    var serverEvents by remember { mutableStateOf<Map<String, JSONObject>>(emptyMap()) }
    var candidates by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var candidatesLoading by remember { mutableStateOf(false) }
    var busyCandidateIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var pendingQueueCount by remember { mutableIntStateOf(0) }
    var queueMessage by remember { mutableStateOf("") }
    var queueRetrying by remember { mutableStateOf(false) }

    val archive = remember(context, account.id) { LocalNotificationArchive.inDirectory(context.filesDir, account.id) }
    val queue = remember(context, account.id) { NotificationOfflineQueue.inDirectory(context.filesDir, account.id) }
    val sessionProvider = remember(context) { NotificationSessionProvider(context) }
    val gateway = remember(context) { NotificationAccessGateway(context) }
    val transport = remember { HttpNotificationIngestTransport(BuildConfig.THEWYJ_BASE_URL) }
    val coordinator = remember(context, account.id, sessionProvider, transport) {
        NotificationCaptureCoordinator(
            archiveFor = { LocalNotificationArchive.inDirectory(context.filesDir, it) },
            queueFor = { NotificationOfflineQueue.inDirectory(context.filesDir, it) },
            transport = transport,
            account = sessionProvider::currentAccount,
        )
    }
    val entitled = account.isAdmin
        || account.entitlements.contains("notification_archive_access")
        || account.entitlements.contains("all_features_access")

    fun reload() {
        refreshKey += 1
    }

    fun flushMessage(result: NotificationCaptureCoordinator.FlushResult): String {
        return when {
            result.authenticationRequired -> "登录会话需要恢复，${result.pending} 项仍安全保留在本机。"
            result.retryableFailures > 0 -> "同步暂时失败，${result.pending} 项等待下次重试。"
            result.pending > 0 -> "${result.pending} 项等待同步。"
            result.discardedInvalid > 0 -> "同步完成；${result.discardedInvalid} 条无效请求已隔离。"
            result.uploaded > 0 -> "已同步 ${result.uploaded} 项。"
            else -> "已同步，没有待处理项目。"
        }
    }

    fun retryQueue() {
        if (queueRetrying) return
        queueRetrying = true
        scope.launch {
            if (sessionProvider.currentAccount() == null) {
                pendingQueueCount = withContext(Dispatchers.IO) { queue.pendingCount() }
                queueMessage = "登录会话需要恢复，$pendingQueueCount 项仍安全保留在本机。"
                queueRetrying = false
                return@launch
            }
            val result = withContext(Dispatchers.IO) { coordinator.flushDetailed() }
            pendingQueueCount = result.pending
            queueMessage = flushMessage(result)
            queueRetrying = false
            reload()
        }
    }

    fun deleteRecord(record: LocalNotificationRecord) {
        scope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    archive.delete(record.id)
                    queue.enqueueRequest(
                        operationId = "delete-" + record.eventId,
                        path = OfflineNotificationQueue.DELETE_PATH,
                        payload = JSONObject().put("event_id", record.eventId).toString(),
                    )
                    val flushed = coordinator.flushDetailed()
                    if (flushed.authenticationRequired && flushed.pending == 0) {
                        flushed.copy(pending = queue.pendingCount())
                    } else {
                        flushed
                    }
                }
            }
            result.onSuccess {
                pendingQueueCount = it.pending
                queueMessage = flushMessage(it)
                reload()
            }.onFailure {
                records = withContext(Dispatchers.IO) { archive.listRecent(500) }
                pendingQueueCount = withContext(Dispatchers.IO) { queue.pendingCount() }
                loadError = "本机记录已删除；云端结构化状态暂未同步，请点击立即重试。"
            }
        }
    }

    LaunchedEffect(refreshKey, account.id, entitled) {
        loading = true
        loadError = ""
        serverEvents = emptyMap()
        candidates = emptyList()
        val localData = withContext(Dispatchers.IO) {
            runCatching { archive.listRecent(500) to queue.pendingCount() }
        }
        localData.onSuccess {
            records = it.first
            pendingQueueCount = it.second
        }.onFailure {
            records = emptyList()
            pendingQueueCount = 0
            loadError = "无法读取本地通知历史，异常记录已自动跳过。"
        }
        permissionState = gateway.state(CaptureCapability.NOTIFICATION_ACCESS)
        val captureAccount = sessionProvider.currentAccount()
        if (entitled && captureAccount != null) {
            candidatesLoading = true
            val token = captureAccount.sessionToken
            val results = withContext(Dispatchers.IO) {
                val events = transport.get("/api/notification/events?limit=500", token)
                val candidatesResponse = transport.get("/api/notification/candidates?status=pending&limit=100", token)
                events to candidatesResponse
            }
            val eventMap = mutableMapOf<String, JSONObject>()
            if (results.first.ok) {
                runCatching {
                    val eventsJson = JSONObject(results.first.body)
                    val items = eventsJson.optJSONArray("events") ?: JSONArray()
                    for (index in 0 until items.length()) {
                        val item = items.optJSONObject(index) ?: continue
                        eventMap[item.optString("event_id")] = item
                    }
                }.onFailure {
                    loadError = "云端通知状态格式无效，本地历史仍可使用。"
                }
            } else {
                loadError = "云端通知状态暂时不可用，本地历史仍可使用。"
            }
            serverEvents = eventMap
            if (results.second.ok) {
                runCatching {
                    val candidatesJson = JSONObject(results.second.body)
                    val items = candidatesJson.optJSONArray("candidates") ?: JSONArray()
                    buildList {
                        for (index in 0 until items.length()) {
                            items.optJSONObject(index)?.let(::add)
                        }
                    }
                }.onSuccess { candidates = it }.onFailure {
                    loadError = "云端候选格式无效，本地历史仍可使用。"
                }
            } else if (loadError.isBlank()) {
                loadError = "待确认候选暂时无法加载，本地历史仍可使用。"
            }
            candidatesLoading = false
        } else if (entitled) {
            loadError = "正在等待设备会话恢复；本地历史仍可使用。"
        }
        loading = false
    }

    fun decideCandidate(candidateId: String, confirm: Boolean) {
        if (candidateId in busyCandidateIds) return
        busyCandidateIds = busyCandidateIds + candidateId
        scope.launch {
            val captureAccount = sessionProvider.currentAccount()
            val result = withContext(Dispatchers.IO) {
                val body = if (confirm) {
                    JSONObject()
                        .put("candidate_id", candidateId)
                        .put("device_id", captureAccount?.deviceId ?: "android-unknown")
                        .toString()
                } else {
                    JSONObject().put("candidate_id", candidateId).toString()
                }
                transport.post(
                    if (confirm) "/api/notification/candidates/confirm" else "/api/notification/candidates/reject",
                    captureAccount?.sessionToken ?: "",
                    body,
                )
            }
            busyCandidateIds = busyCandidateIds - candidateId
            if (!result.ok) loadError = "${if (confirm) "确认" else "拒绝"}失败（${result.status}），请稍后重试。"
            reload()
        }
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(ThewyjSpacing.Lg),
            verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Lg),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = onBack, shape = ThewyjRadius.Medium) { Text("返回") }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("通知保存", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "完整通知原文只保存在本机，云端仅接收解析后的结构化字段。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            item {
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                        Text("权限与权益", style = MaterialTheme.typography.titleMedium)
                        Text(
                            when (permissionState) {
                                CapabilityState.GRANTED -> "通知使用权已开启，系统会在本机归档新通知。"
                                CapabilityState.NOT_GRANTED -> "尚未开启通知使用权，暂时无法采集新通知。"
                                CapabilityState.NOT_IMPLEMENTED -> "该能力在当前系统不可用。"
                            },
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            if (entitled) "当前账户包含通知保存权益，采集与云端同步可用。" else "当前账户未开通通知保存，采集与上传保持关闭。",
                            color = if (entitled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                            OutlinedButton(
                                onClick = { gateway.openSystemSettings(CaptureCapability.NOTIFICATION_ACCESS) },
                                shape = ThewyjRadius.Medium,
                            ) { Text("开启权限") }
                            OutlinedButton(onClick = { reload() }, shape = ThewyjRadius.Medium) { Text("刷新状态") }
                        }
                    }
                }
            }

            item {
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                        Text("同步队列", style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (pendingQueueCount > 0) "$pendingQueueCount 项结构化操作等待同步。"
                            else "已同步，没有待处理项目。",
                            color = if (pendingQueueCount > 0) MaterialTheme.colorScheme.tertiary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (queueMessage.isNotBlank()) {
                            Text(queueMessage, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        OutlinedButton(
                            onClick = { retryQueue() },
                            enabled = entitled && !queueRetrying,
                            shape = ThewyjRadius.Medium,
                        ) { Text(if (queueRetrying) "正在同步…" else "立即重试") }
                    }
                }
            }

            if (entitled) {
                item {
                    ThewyjCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md)) {
                            Text("待确认记账候选", style = MaterialTheme.typography.titleMedium)
                            if (candidatesLoading) {
                                CircularProgressIndicator(Modifier.height(24.dp))
                            } else if (candidates.isEmpty()) {
                                Text("暂无待确认候选。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                candidates.forEach { candidate ->
                                    val candidateId = candidate.optString("id")
                                    val direction = candidate.optString("direction")
                                    val amountMinor = candidate.optLong("amount_minor")
                                    val currency = candidate.optString("currency", "CNY")
                                    val merchant = candidate.optString("merchant").ifBlank { candidate.optString("counterparty") }
                                    val confidence = candidate.optInt("confidence")
                                    val busy = candidateId in busyCandidateIds
                                    Column(Modifier.fillMaxWidth()) {
                                        Text(
                                            "${directionLabel(direction)} · ${money(amountMinor, currency)} · ${merchant.ifBlank { "未知来源" }}",
                                            style = MaterialTheme.typography.bodyLarge,
                                        )
                                        Text(
                                            "识别置信度 ${confidence}/1000",
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                                            ThewyjPrimaryButton(
                                                text = { Text(if (busy) "处理中…" else "确认记账") },
                                                enabled = !busy,
                                                onClick = { decideCandidate(candidateId, confirm = true) },
                                            )
                                            OutlinedButton(
                                                onClick = { decideCandidate(candidateId, confirm = false) },
                                                shape = ThewyjRadius.Medium,
                                                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                            ) { Text(if (busy) "处理中…" else "拒绝") }
                                        }
                                        HorizontalDivider(Modifier.padding(vertical = ThewyjSpacing.Sm))
                                    }
                                }
                            }
                        }
                    }
                }
            }

            item {
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md)) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text("本地通知历史", style = MaterialTheme.typography.titleMedium)
                                Text("仅保存在这台设备", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            OutlinedButton(
                                onClick = {
                                    scope.launch {
                                        withContext(Dispatchers.IO) { archive.clearForAccount(account.id) }
                                        reload()
                                    }
                                },
                                shape = ThewyjRadius.Medium,
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            ) { Text("清空历史") }
                        }
                        if (loadError.isNotBlank()) {
                            Text(loadError, color = MaterialTheme.colorScheme.error)
                        }
                        when {
                            loading -> CircularProgressIndicator(Modifier.height(24.dp))
                            records.isEmpty() -> Text(
                                "还没有保存的通知。开启权限后，收款与支付通知会出现在这里。",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            items(records, key = { it.id }) { record ->
                val server = serverEvents[record.eventId]
                NotificationHistoryRow(
                    record = record,
                    server = server,
                    onDelete = { deleteRecord(record) },
                )
            }
        }
    }
}

@Composable
private fun NotificationHistoryRow(
    record: LocalNotificationRecord,
    server: JSONObject?,
    onDelete: () -> Unit,
) {
    val statusText = when {
        server != null && server.optString("finance_transaction_id").isNotBlank() -> "已自动记账"
        server != null && server.optString("candidate_id").isNotBlank() -> "候选待确认"
        record.parseStatus == ParseStatus.PARSED -> "解析成功"
        record.parseStatus == ParseStatus.CANDIDATE -> "待确认"
        else -> "未识别"
    }
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = ThewyjRadius.Medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(ThewyjSpacing.Lg), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Xs)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(record.sourcePackage.ifBlank { "未知来源应用" }, style = MaterialTheme.typography.labelLarge)
                Text(
                    SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(record.receivedAtMs)),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(record.title.ifBlank { "（无标题）" }, style = MaterialTheme.typography.titleSmall)
            Text(record.text.ifBlank { record.bigText }.ifBlank { record.subText }.ifBlank { "（无正文）" })
            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm), verticalAlignment = Alignment.CenterVertically) {
                Text(statusText, color = MaterialTheme.colorScheme.primary)
                if (record.direction != FinanceDirection.UNKNOWN && record.amountMinor > 0) {
                    Text(
                        "${directionLabel(record.direction.name.lowercase())} ${money(record.amountMinor, record.currency)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (record.merchant.isNotBlank()) {
                    Text(record.merchant, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.weight(1f))
                OutlinedButton(
                    onClick = onDelete,
                    shape = ThewyjRadius.Small,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("删除") }
            }
        }
    }
}

private fun directionLabel(direction: String): String = when (direction) {
    "income" -> "收入"
    "expense" -> "支出"
    "refund" -> "退款"
    else -> "未识别"
}

private fun money(minor: Long, currency: String): String =
    String.format(Locale.CHINA, "%.2f %s", minor / 100.0, currency)
