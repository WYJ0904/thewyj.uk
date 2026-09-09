package uk.thewyj.app.ui

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.design.ThewyjCard
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjSpacing
import uk.thewyj.app.task22.SafTransferPicker
import uk.thewyj.app.task22.TransferApiClient
import uk.thewyj.app.task22.TransferConfig
import uk.thewyj.app.task22.TransferConfigStore
import uk.thewyj.app.task22.TransferItemStatus
import uk.thewyj.app.task22.TransferQueueStore
import uk.thewyj.app.task22.TransferShare
import uk.thewyj.app.task22.TransferUploadWorker
import uk.thewyj.app.task22.QueuedTransfer
import java.util.UUID
import java.util.Locale

@Composable
fun TransferScreen(account: AccountSnapshot, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val queueStore = remember(context, account.id) { TransferQueueStore.inDirectory(context.filesDir, account.id) }
    val configStore = remember(context, account.id) { TransferConfigStore.inDirectory(context.filesDir, account.id) }
    val api = remember(context) { TransferApiClient(context) }
    var queue by remember { mutableStateOf<List<QueuedTransfer>>(emptyList()) }
    var shares by remember { mutableStateOf<List<TransferShare>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var quota by remember { mutableStateOf("配额加载中") }
    var minutes by remember { mutableIntStateOf(configStore.load().minutes) }
    var maxDownloads by remember { mutableIntStateOf(configStore.load().maxDownloads) }
    var oneTime by remember { mutableStateOf(configStore.load().oneTime) }
    var password by remember { mutableStateOf(configStore.load().password) }
    var shareLink by remember { mutableStateOf("") }

    fun persistConfig() {
        configStore.save(TransferConfig(minutes = minutes, maxDownloads = maxDownloads, oneTime = oneTime, password = password))
    }

    val filesLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val items = queueStore.load().toMutableList()
            for (uri in uris) {
                runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                val source = SafTransferPicker.documentSource(context, uri) ?: continue
                if (source.sizeBytes <= 0) continue
                items.add(
                    QueuedTransfer(
                        localId = UUID.randomUUID().toString(),
                        source = source,
                    ),
                )
            }
            queueStore.save(items)
            queue = items
            persistConfig()
            TransferUploadWorker.enqueue(context)
        }
    }
    val folderLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        if (tree == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching { SafTransferPicker.persistAccess(context, tree) }
            val sources = withContext(Dispatchers.IO) { SafTransferPicker.treeSources(context, tree) }
            val items = queueStore.load().toMutableList()
            for (source in sources) {
                if (source.sizeBytes <= 0) continue
                items.add(QueuedTransfer(localId = UUID.randomUUID().toString(), source = source))
            }
            queueStore.save(items)
            queue = items
            persistConfig()
            TransferUploadWorker.enqueue(context)
        }
    }

    fun refreshQueue() {
        queue = queueStore.load()
    }

    LaunchedEffect(Unit) {
        refreshQueue()
        if (queue.any { it.status == TransferItemStatus.PENDING || it.status == TransferItemStatus.UPLOADING }) {
            TransferUploadWorker.enqueue(context)
        }
        runCatching { withContext(Dispatchers.IO) { api.capabilities() } }.onSuccess { payload ->
            val used = payload.optLong("used_bytes", 0)
            val limit = payload.optLong("storage_limit_bytes", 0)
            quota = "已用 ${formatBytes(used)} / ${formatBytes(limit)}"
        }.onFailure { quota = "配额暂时不可用" }
        while (true) {
            delay(700)
            queue = queueStore.load()
            if (queue.any { it.status == TransferItemStatus.DONE }) {
                runCatching { withContext(Dispatchers.IO) { api.listShares() } }.onSuccess { shares = it }.onFailure { }
            }
        }
    }

    fun completeTransfer() {
        val pending = queue.filter { it.status == TransferItemStatus.DONE }
        Log.i("T22UI", "completeTransfer invoked; pending=${pending.size} queue=${queue.map { it.status }}")
        if (pending.isEmpty()) {
            message = "还没有上传完成的文件。"
            return
        }
        busy = true
        scope.launch {
            val result = runCatching {
                val sessionId = pending.first().sessionId
                withContext(Dispatchers.IO) { api.complete(sessionId) }
            }
            result.onSuccess { share ->
                Log.i("T22UI", "complete ok share=${share.id}")
                shareLink = "https://thewyj.uk/transfer#share=${share.id}"
                message = "分享已创建。"
                queueStore.save(queue.filterNot { it.status == TransferItemStatus.DONE })
                refreshQueue()
            }.onFailure { error ->
                Log.e("T22UI", "complete failed", error)
                message = error.message ?: "创建分享失败。"
            }
            busy = false
        }
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(ThewyjSpacing.Lg),
            verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Lg),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = onBack, shape = ThewyjRadius.Medium) { Text("返回") }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("文件传输", style = MaterialTheme.typography.headlineMedium)
                        Text(quota, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item {
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md)) {
                        Text("分享设置", style = MaterialTheme.typography.titleMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md)) {
                            OutlinedButton(onClick = { filesLauncher.launch(arrayOf("*/*")) }, shape = ThewyjRadius.Medium) { Text("选择文件") }
                            OutlinedButton(onClick = { folderLauncher.launch(null) }, shape = ThewyjRadius.Medium) { Text("选择文件夹") }
                        }
                        HorizontalDivider()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("有效期", Modifier.width(96.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                                listOf(60 to "1小时", 1440 to "1天", 4320 to "3天", 10080 to "7天").forEach { (value, label) ->
                                    OutlinedButton(
                                        onClick = { minutes = value; persistConfig() },
                                        shape = ThewyjRadius.Small,
                                        colors = if (minutes == value) ButtonDefaults.outlinedButtonColors()
                                        else ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                                    ) { Text(label) }
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("最大下载次数", Modifier.width(96.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedTextField(
                                value = maxDownloads.toString(),
                                onValueChange = { value -> value.toIntOrNull()?.takeIf { it in 1..100 }?.let { maxDownloads = it; persistConfig() } },
                                modifier = Modifier.width(120.dp),
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = oneTime, onCheckedChange = { oneTime = it; persistConfig() })
                            Text("阅后即焚（下载一次后销毁）")
                        }
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it.take(120); persistConfig() },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("访问密码（可选）") },
                        )
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
                            Text("上传队列", style = MaterialTheme.typography.titleMedium)
                            ThewyjPrimaryButton(
                                text = { Text(if (busy) "处理中…" else "创建分享链接") },
                                enabled = !busy && queue.any { it.status == TransferItemStatus.DONE },
                                onClick = { completeTransfer() },
                            )
                        }
                        if (queue.isEmpty()) {
                            Text("还没有文件。选择文件或文件夹后自动开始分片上传。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            items(queue, key = { it.localId }) { item ->
                TransferItemRow(
                    item = item,
                    onPause = {
                        queueStore.upsert(item.copy(status = TransferItemStatus.PAUSED))
                        refreshQueue()
                    },
                    onResume = {
                        queueStore.upsert(item.copy(status = TransferItemStatus.PENDING))
                        refreshQueue()
                        TransferUploadWorker.enqueue(context)
                    },
                    onCancel = {
                        scope.launch {
                            runCatching { api.abort(item.sessionId) }
                            queueStore.remove(item.localId)
                            refreshQueue()
                        }
                    },
                )
            }
            if (shareLink.isNotBlank()) {
                item {
                    ThewyjCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                            Text("分享已创建", style = MaterialTheme.typography.titleMedium)
                            Text(shareLink)
                            OutlinedButton(
                                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(shareLink))) },
                                shape = ThewyjRadius.Medium,
                            ) { Text("在浏览器打开") }
                        }
                    }
                }
            }
            if (shares.isNotEmpty()) {
                item {
                    ThewyjCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                            Text("我的分享", style = MaterialTheme.typography.titleMedium)
                            shares.forEach { share ->
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column {
                                        Text("${share.fileCount} 个文件 · ${formatBytes(share.totalBytes)}")
                                        Text("下载 ${share.downloadCount}/${share.maxDownloads}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                Log.i("T22UI", "revoke invoked id=${share.id}")
                                                runCatching { withContext(Dispatchers.IO) { api.revoke(share.id) } }
                                                    .onSuccess { Log.i("T22UI", "revoke ok ${share.id}"); shares = shares.filterNot { it.id == share.id } }
                                                    .onFailure { Log.e("T22UI", "revoke failed", it); message = it.message ?: "撤销失败" }
                                            }
                                        },
                                        shape = ThewyjRadius.Small,
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                    ) { Text("撤销") }
                                }
                            }
                        }
                    }
                }
            }
            if (message.isNotBlank()) {
                item { Text(message, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable
private fun TransferItemRow(
    item: QueuedTransfer,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit,
) {
    val percent = if (item.source.sizeBytes > 0) ((item.uploadedBytes * 100) / item.source.sizeBytes).toInt() else 0
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = ThewyjRadius.Medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(ThewyjSpacing.Lg), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
            Text(item.source.relativePath, style = MaterialTheme.typography.titleSmall)
            Text(
                "${formatBytes(item.uploadedBytes)} / ${formatBytes(item.source.sizeBytes)} · ${item.status.name}${if (item.errorMessage.isNotBlank()) " · ${item.errorMessage}" else ""}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            LinearProgressIndicator(progress = { percent / 100f }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                if (item.status == TransferItemStatus.PAUSED || item.status == TransferItemStatus.ERROR || item.status == TransferItemStatus.PENDING) {
                    OutlinedButton(onClick = onResume, shape = ThewyjRadius.Small) { Text(if (item.status == TransferItemStatus.ERROR) "重试" else "继续") }
                } else if (item.status == TransferItemStatus.UPLOADING) {
                    OutlinedButton(onClick = onPause, shape = ThewyjRadius.Small) { Text("暂停") }
                }
                OutlinedButton(
                    onClick = onCancel,
                    shape = ThewyjRadius.Small,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("取消") }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.CHINA, "%.1f KB", bytes / 1024.0)
    bytes < 1024L * 1024 * 1024 -> String.format(Locale.CHINA, "%.1f MB", bytes / 1024.0 / 1024.0)
    else -> String.format(Locale.CHINA, "%.2f GB", bytes / 1024.0 / 1024.0 / 1024.0)
}
